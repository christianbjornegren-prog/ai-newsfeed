#!/usr/bin/env python3
"""
Verify RSS sources – standalone diagnostic script.

Tests each RSS feed and prints a terminal report showing article counts,
latest entries, and description quality warnings.
"""

import sys
import feedparser

SOURCES = [
    {"name": "Google AI Blog",
     "url": "https://blog.google/technology/ai/rss/"},
    {"name": "Google Research Blog",
     "url": "https://research.google/blog/rss/"},
    {"name": "Microsoft Official Blog",
     "url": "https://blogs.microsoft.com/feed/"},
    {"name": "IEEE Spectrum AI",
     "url": "https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss"},
    {"name": "Legora Blog",
     "url": "https://legora.com/blog/rss.xml"},
    {"name": "Lovable Blog",
     "url": "https://lovable.dev/blog/feed"},
    {"name": "Olshansk RSS (Cursor, xAI, Mistral m.fl.)",
     "url": "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_cursor.xml"},
    {"name": "xAI News (Olshansk)",
     "url": "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_xainews.xml"},
    {"name": "MarkTechPost AI",
     "url": "https://www.marktechpost.com/feed/"},
    {"name": "ZDNET AI (specifik)",
     "url": "https://www.zdnet.com/topic/artificial-intelligence/rss.xml"},
    {"name": "Sifted (European tech/AI)",
     "url": "https://sifted.eu/feed"},
    {"name": "import AI (Jack Clark)",
     "url": "https://importai.substack.com/feed"},
]

TIMEOUT_SECONDS = 10
MAX_DESC_LENGTH = 150


def get_description(entry):
    """Return the best available description text for a feed entry."""
    for field in ("summary", "description"):
        value = getattr(entry, field, None)
        if value:
            return value.strip()
    return ""


def get_published(entry):
    """Return a human-readable published date, or 'ok\u00e4nt datum'."""
    for field in ("published", "updated"):
        value = getattr(entry, field, None)
        if value:
            return value
    return "ok\u00e4nt datum"


def format_description(title, desc):
    """Format description with status indicator."""
    if not desc:
        return "(tom description) \u274c"
    if desc.strip() == title.strip():
        return "(identisk med titel) \u26a0\ufe0f"
    truncated = desc[:MAX_DESC_LENGTH]
    if len(desc) > MAX_DESC_LENGTH:
        truncated += "..."
    return f'"{truncated}" \u2705'


def verify_source(source):
    """Fetch and report on a single RSS source."""
    name = source["name"]
    url = source["url"]

    print(f"\n=== {name} ===")

    try:
        feed = feedparser.parse(url, request_headers={"User-Agent": "ai-newsfeed-verifier/1.0"})

        if feed.bozo and not feed.entries:
            error = feed.bozo_exception
            print(f"FEL: Could not parse feed ({error}) \u274c")
            return False

        entries = feed.entries
        print(f"Artiklar i feed: {len(entries)}")

        if not entries:
            print("Inga artiklar hittades \u274c")
            return False

        labels = ["Senaste artikel", "N\u00e4st senaste"]
        for i, label in enumerate(labels):
            if i >= len(entries):
                break
            entry = entries[i]
            title = entry.get("title", "(ingen titel)")
            date = get_published(entry)
            desc = get_description(entry)

            print(f'{label}: "{title}" ({date})')
            print(f"  Description: {format_description(title, desc)}")

        return True

    except Exception as exc:
        print(f"FEL: {exc} \u274c")
        return False


def main():
    print("=" * 60)
    print("  RSS Source Verification Report")
    print("=" * 60)

    ok = 0
    fail = 0

    for source in SOURCES:
        if verify_source(source):
            ok += 1
        else:
            fail += 1

    print("\n" + "=" * 60)
    print(f"  Resultat: {ok} OK, {fail} fel av {len(SOURCES)} k\u00e4llor")
    print("=" * 60)

    if fail > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
