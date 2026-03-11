#!/usr/bin/env python3
"""
Fetch AI news from RSS feeds and save to Firestore.
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone

import feedparser
import firebase_admin
from dateutil import parser as dateutil_parser
from firebase_admin import credentials, firestore

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
logger = logging.getLogger(__name__)

MAX_ARTICLES = 20

RSS_FEEDS = [
    {"url": "https://feeds.feedburner.com/oreilly/radar", "source": "O'Reilly Radar"},
    {"url": "https://rss.beehiiv.com/feeds/thenewstack.io.xml", "source": "The New Stack"},
    {"url": "https://techcrunch.com/feed/", "source": "TechCrunch"},
]


def init_firestore() -> firestore.Client:
    """Initialize Firebase app and return Firestore client."""
    service_account_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if not service_account_json:
        logger.error("Environment variable FIREBASE_SERVICE_ACCOUNT is not set.")
        sys.exit(1)

    try:
        service_account_info = json.loads(service_account_json)
    except json.JSONDecodeError as exc:
        logger.error("Failed to parse FIREBASE_SERVICE_ACCOUNT as JSON: %s", exc)
        sys.exit(1)

    cred = credentials.Certificate(service_account_info)
    firebase_admin.initialize_app(cred)
    return firestore.client()


def parse_published_at(entry) -> datetime:
    """Extract and parse the published date from a feed entry."""
    for field in ("published", "updated"):
        value = getattr(entry, field, None)
        if value:
            try:
                dt = dateutil_parser.parse(value)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt
            except (ValueError, OverflowError):
                continue
    return datetime.now(timezone.utc)


def fetch_entries(feed_config: dict) -> list[dict]:
    """Fetch and parse entries from a single RSS feed."""
    url = feed_config["url"]
    source = feed_config["source"]

    logger.info("Fetching feed: %s (%s)", source, url)
    parsed = feedparser.parse(url)

    if parsed.bozo and not parsed.entries:
        logger.warning("Failed to parse feed %s: %s", source, parsed.bozo_exception)
        return []

    entries = []
    for entry in parsed.entries:
        link = getattr(entry, "link", None)
        title = getattr(entry, "title", None)
        if not link or not title:
            continue

        entries.append(
            {
                "title": title.strip(),
                "url": link.strip(),
                "source": source,
                "published_at": parse_published_at(entry),
            }
        )

    logger.info("  -> %d entries found in %s", len(entries), source)
    return entries


def get_existing_urls(db: firestore.Client) -> set[str]:
    """Retrieve all URLs already stored in Firestore."""
    docs = db.collection("articles").select(["url"]).stream()
    return {doc.get("url") for doc in docs if doc.get("url")}


def save_article(db: firestore.Client, article: dict) -> None:
    """Save a single article document to Firestore."""
    db.collection("articles").add(article)


def main() -> None:
    db = init_firestore()

    # Collect all entries from all feeds
    all_entries: list[dict] = []
    for feed_config in RSS_FEEDS:
        all_entries.extend(fetch_entries(feed_config))

    logger.info("Total entries fetched across all feeds: %d", len(all_entries))

    # Load existing URLs for deduplication
    logger.info("Loading existing article URLs from Firestore for deduplication...")
    existing_urls = get_existing_urls(db)
    logger.info("Existing articles in Firestore: %d", len(existing_urls))

    fetched = len(all_entries)
    saved = 0
    skipped = 0

    for entry in all_entries:
        if saved >= MAX_ARTICLES:
            skipped += fetched - saved - skipped
            break

        if entry["url"] in existing_urls:
            skipped += 1
            continue

        article = {
            "title": entry["title"],
            "url": entry["url"],
            "source": entry["source"],
            "published_at": entry["published_at"],
            "fetched_at": datetime.now(timezone.utc),
            "summary": None,
            "category": None,
        }
        save_article(db, article)
        existing_urls.add(entry["url"])
        saved += 1

    # Remaining entries that were not processed due to MAX_ARTICLES cap
    remaining = fetched - saved - skipped
    if remaining > 0:
        skipped += remaining

    logger.info("--- Run summary ---")
    logger.info("  Fetched : %d", fetched)
    logger.info("  Saved   : %d", saved)
    logger.info("  Skipped : %d", skipped)
    logger.info("-------------------")


if __name__ == "__main__":
    main()
