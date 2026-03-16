#!/usr/bin/env python3
"""
One-time cleanup script: remove all TechCrunch articles from Firestore.
Run manually: FIREBASE_SERVICE_ACCOUNT='...' python scripts/cleanup_old_articles.py
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


def main() -> None:
    db = init_firestore()

    logger.info("Querying for TechCrunch articles...")
    docs = db.collection("articles").where("source", "==", "TechCrunch").stream()

    deleted = 0
    for doc in docs:
        doc.reference.delete()
        deleted += 1

    logger.info("Deleted %d TechCrunch article(s) from Firestore.", deleted)


if __name__ == "__main__":
    main()
