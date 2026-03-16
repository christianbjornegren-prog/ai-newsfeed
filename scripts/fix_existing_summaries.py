#!/usr/bin/env python3
"""
Fix existing articles in Firestore:
- Strip markdown characters (#, **, *) from summary
- Set teaser to first 15 words of summary if missing
"""

import json
import logging
import os
import sys

import firebase_admin
from firebase_admin import credentials, firestore

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
logger = logging.getLogger(__name__)


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


def main() -> None:
    db = init_firestore()

    logger.info("Fetching all articles from Firestore...")
    docs = db.collection("articles").stream()

    fixed = 0
    for doc in docs:
        data = doc.to_dict()
        summary = data.get("summary", "") or ""
        teaser = data.get("teaser")

        needs_fix = "#" in summary or "**" in summary
        needs_teaser = teaser is None

        if not needs_fix and not needs_teaser:
            continue

        update = {}

        if needs_fix:
            update["summary"] = strip_markdown(summary)

        if needs_teaser:
            clean = strip_markdown(summary)
            words = clean.split()
            update["teaser"] = " ".join(words[:15])

        db.collection("articles").document(doc.id).update(update)
        fixed += 1
        logger.info("Fixed: %s", data.get("title", doc.id))

    logger.info("--- Fix summary ---")
    logger.info("  Fixed: %d documents", fixed)
    logger.info("-------------------")


if __name__ == "__main__":
    main()
