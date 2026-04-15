#!/usr/bin/env python3
"""
Re-classify topic for all existing articles in Firestore using Claude API.

One-shot script — updates only the topic field, leaves teaser and summary intact.
"""

import json
import logging
import os
import sys

import anthropic

import firebase_admin
from firebase_admin import credentials, firestore

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
logger = logging.getLogger(__name__)

MAX_ARTICLES = 60

SYSTEM_PROMPT = (
    "You are a news editor creating a feed card for an AI industry newsletter.\n"
    "Given an article title and description, respond with ONLY a valid JSON "
    "object — no markdown, no explanation, no extra text:\n"
    "{\n"
    '  "teaser": "<one sentence, max 12 words, what happened>",\n'
    '  "summary": "<2-3 sentences, what happened, who is involved, '
    'why it matters for AI. Same language as the input.>",\n'
    '  "topic": "<Choose the MOST SPECIFIC topic that applies. '
    "Use company names when the article is primarily about that company: "
    "OpenAI, Anthropic, Google AI, Meta AI, Microsoft AI, Mistral, "
    "Apple AI, xAI, Nvidia, Hugging Face. "
    "Use these topic names for broader themes ONLY when no specific "
    "company is the focus: "
    "AI Safety, AI Policy, AI Health, AI Education, AI Coding, "
    "AI Agents, AI Models, AI Investment, AI Hardware. "
    "NEVER use just 'AI' as a topic — always be more specific. "
    "If truly no other topic fits, use the most prominent noun in "
    'the title.>"\n'
    "}\n"
    "If the description is empty or unhelpful, base all fields on the title only.\n"
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


def get_topic_from_claude(client, title: str, description: str) -> str:
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
        topic = strip_markdown(data.get("topic", "")) or "AI"
        return topic
    except (json.JSONDecodeError, AttributeError):
        logger.error("  -> JSON parse failed, raw: %s", raw)
        return "AI"


def main():
    api_key = os.environ.get("CLAUDE_API_KEY")
    if not api_key:
        logger.error("CLAUDE_API_KEY is not set.")
        sys.exit(1)

    db = init_firestore()
    client = anthropic.Anthropic(api_key=api_key)

    logger.info("Fetching all articles from Firestore...")
    docs = list(
        db.collection("articles")
        .order_by("fetched_at", direction=firestore.Query.DESCENDING)
        .limit(MAX_ARTICLES)
        .stream()
    )
    logger.info("Found %d articles to re-topic.", len(docs))

    updated = 0
    errors = 0

    for doc in docs:
        article = doc.to_dict()
        title = article.get("title", "")
        rss_description = article.get("rss_description", "")
        logger.info("Processing: %s", title)

        try:
            topic = get_topic_from_claude(client, title, rss_description)
            db.collection("articles").document(doc.id).update({"topic": topic})
            logger.info("  -> topic: %s", topic)
            updated += 1
        except Exception as exc:
            logger.error("  -> Error: %s", exc)
            errors += 1

    logger.info("--- Re-topic summary ---")
    logger.info("  Updated: %d", updated)
    logger.info("  Errors:  %d", errors)
    logger.info("------------------------")


if __name__ == "__main__":
    main()
