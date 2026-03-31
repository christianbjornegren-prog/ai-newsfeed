#!/usr/bin/env python3
"""
Summarize articles stored in Firestore using Claude API.
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone

import anthropic
import requests
from bs4 import BeautifulSoup

import firebase_admin
from firebase_admin import credentials, firestore

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
logger = logging.getLogger(__name__)

MAX_ARTICLES = 20
SYSTEM_PROMPT = (
    "You are a news editor creating a feed card for an AI industry newsletter.\n"
    "Given an article title and description, respond with ONLY a valid JSON "
    "object — no markdown, no explanation, no extra text:\n"
    "{\n"
    '  "teaser": "<one sentence, max 12 words, what happened>",\n'
    '  "summary": "<2-3 sentences, what happened, who is involved, '
    'why it matters for AI. Same language as the input.>"\n'
    "}\n"
    "If the description is empty or unhelpful, base both fields on the title only.\n"
    "Never say 'I cannot summarize' or ask for more information.\n"
    "Never use markdown formatting in your response."
)


def strip_markdown(text: str) -> str:
    """Remove markdown formatting characters from text."""
    return text.replace("**", "").replace("*", "").replace("#", "")


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
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)
    return firestore.client()


def fetch_article_text(url: str) -> str | None:
    """Try to fetch the full text of an article from its URL."""
    try:
        resp = requests.get(url, timeout=15, headers={
            "User-Agent": "Mozilla/5.0 (compatible; AI-Newsfeed-Bot/1.0)"
        })
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        # Remove script and style elements
        for tag in soup(["script", "style", "nav", "header", "footer"]):
            tag.decompose()

        text = soup.get_text(separator=" ", strip=True)
        # Limit text length to avoid excessive API costs
        return text[:5000] if text else None
    except Exception as exc:
        logger.warning("Could not fetch article text from %s: %s", url, exc)
        return None


def summarize_with_claude(client: anthropic.Anthropic, title: str, description: str) -> dict:
    """Send article title and description to Claude API and return teaser and summary."""
    if description:
        user_content = f"Title: {title}\nDescription: {description}"
    else:
        user_content = (
            f"Title: {title}\n"
            "Description: (not available)\n\n"
            "Based on the title only, write a teaser and summary. "
            "Do not say you cannot summarize."
        )

    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=300,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
    )
    raw = message.content[0].text
    try:
        data = json.loads(raw)
        teaser = strip_markdown(data.get("teaser", title))
        summary = strip_markdown(data.get("summary", title))
    except (json.JSONDecodeError, AttributeError):
        teaser = title
        summary = title
    return {"teaser": teaser, "summary": summary}


def main() -> None:
    api_key = os.environ.get("CLAUDE_API_KEY")
    if not api_key:
        logger.error("Environment variable CLAUDE_API_KEY is not set.")
        sys.exit(1)

    db = init_firestore()
    client = anthropic.Anthropic(api_key=api_key)

    # Fetch articles where summary is null
    logger.info("Querying Firestore for articles without summary...")
    docs = (
        db.collection("articles")
        .where("summary", "==", None)
        .order_by("fetched_at", direction=firestore.Query.DESCENDING)
        .limit(MAX_ARTICLES)
        .stream()
    )

    articles = [(doc.id, doc.to_dict()) for doc in docs]
    logger.info("Found %d articles to summarize.", len(articles))

    summarized = 0
    skipped = 0
    errors = 0

    for doc_id, article in articles:
        title = article.get("title", "")
        url = article.get("url", "")
        rss_description = article.get("rss_description", "")
        logger.info("Processing: %s", title)

        try:
            # Use rss_description if available, otherwise fall back to scraping
            if rss_description:
                description = rss_description
                logger.info("  -> Using RSS description")
            else:
                scraped = fetch_article_text(url)
                if scraped:
                    description = scraped
                    logger.info("  -> Using scraped text")
                else:
                    description = ""
                    logger.info("  -> Using title only (will ask Claude to summarize from title)")

            result = summarize_with_claude(client, title, description)
            db.collection("articles").document(doc_id).update({
                "teaser": result["teaser"],
                "summary": result["summary"],
            })
            summarized += 1
            logger.info("  -> Summarized successfully.")
        except Exception as exc:
            logger.error("  -> Error summarizing '%s': %s", title, exc)
            errors += 1

    logger.info("--- Summarize summary ---")
    logger.info("  Summarized : %d", summarized)
    logger.info("  Skipped    : %d (text could not be fetched, used title only)", skipped)
    logger.info("  Errors     : %d", errors)
    logger.info("-------------------------")


if __name__ == "__main__":
    main()
