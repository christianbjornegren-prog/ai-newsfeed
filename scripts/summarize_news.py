#!/usr/bin/env python3
"""
Summarize articles stored in Firestore using Claude API.
"""

import json
import logging
import os
import sys

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
    return text.replace("**", "").replace("*", "").replace("#", "")


def init_firestore():
    service_account_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if not service_account_json:
        logger.error("FIREBASE_SERVICE_ACCOUNT is not set.")
        sys.exit(1)
    try:
        service_account_info = json.loads(service_account_json)
    except json.JSONDecodeError as exc:
        logger.error("Failed to parse FIREBASE_SERVICE_ACCOUNT: %s", exc)
        sys.exit(1)
    cred = credentials.Certificate(service_account_info)
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)
    return firestore.client()


def fetch_article_text(url: str):
    try:
        resp = requests.get(url, timeout=15, headers={
            "User-Agent": "Mozilla/5.0 (compatible; AI-Newsfeed-Bot/1.0)"
        })
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style", "nav", "header", "footer"]):
            tag.decompose()
        text = soup.get_text(separator=" ", strip=True)
        return text[:5000] if text else None
    except Exception as exc:
        logger.warning("Could not fetch article text from %s: %s", url, exc)
        return None


def summarize_with_claude(client, title: str, description: str) -> dict:
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
    logger.info("  -> Raw Claude response: %s", raw)

    clean = raw.strip()
    if clean.startswith("```"):
        parts = clean.split("```")
        if len(parts) > 1:
            clean = parts[1]
            if clean.startswith("json"):
                clean = clean[4:]
    clean = clean.strip()

    try:
        data = json.loads(clean)
        teaser = strip_markdown(data.get("teaser", ""))
        summary = strip_markdown(data.get("summary", ""))
        logger.info("  -> Parsed teaser: %s", teaser)
        logger.info("  -> Parsed summary: %s", summary)
        return {"teaser": teaser, "summary": summary}
    except (json.JSONDecodeError, AttributeError) as e:
        logger.error("  -> JSON parse failed: %s", e)
        logger.error("  -> Raw was: %s", raw)
        return {"teaser": "", "summary": ""}


def main():
    api_key = os.environ.get("CLAUDE_API_KEY")
    if not api_key:
        logger.error("CLAUDE_API_KEY is not set.")
        sys.exit(1)

    db = init_firestore()
    client = anthropic.Anthropic(api_key=api_key)

    logger.info("Querying Firestore for articles without summary...")

    docs_null = list(
        db.collection("articles")
        .where("summary", "==", None)
        .order_by("fetched_at", direction=firestore.Query.DESCENDING)
        .limit(MAX_ARTICLES)
        .stream()
    )

    docs_empty = list(
        db.collection("articles")
        .where("summary", "==", "")
        .order_by("fetched_at", direction=firestore.Query.DESCENDING)
        .limit(MAX_ARTICLES)
        .stream()
    )

    seen = set()
    articles = []
    for doc in docs_null + docs_empty:
        if doc.id not in seen:
            seen.add(doc.id)
            articles.append((doc.id, doc.to_dict()))
    articles = articles[:MAX_ARTICLES]

    logger.info("Found %d articles to summarize.", len(articles))

    summarized = 0
    errors = 0

    for doc_id, article in articles:
        title = article.get("title", "")
        url = article.get("url", "")
        rss_description = article.get("rss_description", "")
        logger.info("Processing: %s", title)

        try:
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
                    logger.info("  -> Using title only")

            result = summarize_with_claude(client, title, description)
            db.collection("articles").document(doc_id).update({
                "teaser": result["teaser"],
                "summary": result["summary"],
            })
            logger.info("  -> Firestore updated: %s", doc_id)
            summarized += 1
        except Exception as exc:
            logger.error("  -> Error: %s", exc)
            errors += 1

    logger.info("--- Summary ---")
    logger.info("  Summarized: %d", summarized)
    logger.info("  Errors: %d", errors)
    logger.info("---------------")


if __name__ == "__main__":
    main()
