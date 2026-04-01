#!/usr/bin/env python3
"""
Fetch AI news from RSS feeds and save to Firestore.
"""

import json
import logging
import os
import sys
from datetime import datetime, timedelta, timezone

import feedparser
import firebase_admin
import requests
from bs4 import BeautifulSoup
from dateutil import parser as dateutil_parser
from firebase_admin import credentials, firestore

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
logger = logging.getLogger(__name__)

MAX_PER_SOURCE = 4

RSS_FEEDS = [
    {"url": "https://openai.com/blog/rss.xml", "source": "OpenAI Blog"},
    {"url": "https://raw.githubusercontent.com/taobojlen/anthropic-rss-feed/main/anthropic_news_rss.xml", "source": "Anthropic News"},
    {"url": "https://blogs.microsoft.com/ai/feed/", "source": "Microsoft AI Blog"},
    {"url": "https://www.technologyreview.com/topic/artificial-intelligence/feed/", "source": "MIT Technology Review AI"},
    {"url": "https://venturebeat.com/category/ai/feed/", "source": "VentureBeat AI"},
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


def parse_published_at(entry) -> datetime | None:
    """Extract and parse the published date from a feed entry.

    Returns None if no date could be parsed.
    """
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
    return None


def strip_html(text: str) -> str:
    """Remove HTML tags from text using BeautifulSoup."""
    cleaned = BeautifulSoup(text, "html.parser").get_text()
    return cleaned if len(cleaned) >= 20 else ""


def fetch_og_image(url: str) -> str | None:
    """Fetch the Open Graph image URL from a page."""
    try:
        resp = requests.get(url, timeout=10, headers={
            "User-Agent": "Mozilla/5.0 (compatible; AI-Newsfeed-Bot/1.0)"
        })
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        tag = soup.find("meta", property="og:image")
        if tag and tag.get("content"):
            return tag["content"]
    except Exception:
        pass
    return None


def fetch_entries(feed_config: dict) -> list[dict]:
    """Fetch and parse entries from a single RSS feed."""
    url = feed_config["url"]
    source = feed_config["source"]

    logger.info("Fetching feed: %s (%s)", source, url)
    parsed = feedparser.parse(url)

    if parsed.bozo and not parsed.entries:
        logger.warning("Failed to parse feed %s: %s", source, parsed.bozo_exception)
        return []

    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    entries = []
    filtered_old = 0

    for entry in parsed.entries:
        link = getattr(entry, "link", None)
        title = getattr(entry, "title", None)
        if not link or not title:
            continue

        published_at = parse_published_at(entry)

        # Filter out articles older than 7 days (keep if no date available)
        if published_at is not None and published_at < cutoff:
            filtered_old += 1
            continue

        rss_description = strip_html((getattr(entry, "summary", "") or "").strip())

        entries.append(
            {
                "title": title.strip(),
                "url": link.strip(),
                "source": source,
                "published_at": published_at or datetime.now(timezone.utc),
                "rss_description": rss_description,
            }
        )

    # Sort by published date descending, keep only the latest per source
    entries.sort(key=lambda e: e["published_at"], reverse=True)
    entries = entries[:MAX_PER_SOURCE]

    logger.info(
        "  -> %d entries found in %s (keeping %d, filtered %d old)",
        len(parsed.entries), source, len(entries), filtered_old,
    )
    return entries


def get_existing_urls(db: firestore.Client) -> set[str]:
    """Retrieve all URLs already stored in Firestore."""
    docs = db.collection("articles").select(["url"]).stream()
    return {doc.get("url") for doc in docs if doc.get("url")}


def save_article(db: firestore.Client, article: dict):
    """Save a single article document to Firestore and return the doc reference."""
    _, doc_ref = db.collection("articles").add(article)
    return doc_ref


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
        if entry["url"] in existing_urls:
            skipped += 1
            continue

        article = {
            "title": entry["title"],
            "url": entry["url"],
            "source": entry["source"],
            "published_at": entry["published_at"],
            "fetched_at": datetime.now(timezone.utc),
            "rss_description": entry.get("rss_description", ""),
            "summary": None,
            "category": None,
            "image_url": None,
        }
        doc_ref = save_article(db, article)
        existing_urls.add(entry["url"])
        saved += 1

        # Fetch OG image after article is saved — errors must not block saving
        try:
            image_url = fetch_og_image(entry["url"])
            if image_url:
                doc_ref.update({"image_url": image_url})
        except Exception:
            pass

    logger.info("--- Run summary ---")
    logger.info("  Fetched : %d", fetched)
    logger.info("  Saved   : %d", saved)
    logger.info("  Skipped : %d", skipped)
    logger.info("-------------------")


if __name__ == "__main__":
    main()
