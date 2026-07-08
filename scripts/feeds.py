#!/usr/bin/env python3
"""
Single source of truth for all RSS feeds.

Imported by fetch_news.py (production fetching) and verify_sources.py
(diagnostics) so the two can never drift apart. Keep this module free of
third-party dependencies — verify_sources runs with only feedparser installed.
"""

RSS_FEEDS = [
    # --- Officiella bolagsbloggar ---
    {"url": "https://openai.com/blog/rss.xml", "source": "OpenAI Blog"},
    {"url": "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml", "source": "Anthropic News"},
    {"url": "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_engineering.xml", "source": "Anthropic Engineering"},
    {"url": "https://blog.google/technology/ai/rss/", "source": "Google AI Blog"},
    {"url": "https://research.google/blog/rss/", "source": "Google Research Blog"},
    {"url": "https://deepmind.google/blog/rss.xml", "source": "Google DeepMind"},
    {"url": "https://blogs.microsoft.com/feed/", "source": "Microsoft Official Blog"},
    {"url": "https://huggingface.co/blog/feed.xml", "source": "Hugging Face Blog"},

    # --- Oberoende journalistik ---
    {"url": "https://www.technologyreview.com/topic/artificial-intelligence/feed/", "source": "MIT Technology Review AI"},
    {"url": "https://the-decoder.com/feed/", "source": "The Decoder"},
    {"url": "https://techcrunch.com/category/artificial-intelligence/feed/", "source": "TechCrunch AI"},
    {"url": "https://techcrunch.com/region/europe/feed/", "source": "TechCrunch Europe"},
    {"url": "https://arstechnica.com/tag/ai/feed/", "source": "Ars Technica AI"},
    {"url": "https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss", "source": "IEEE Spectrum AI"},
    {"url": "https://www.marktechpost.com/feed/", "source": "MarkTechPost AI"},
    {"url": "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", "source": "The Verge AI"},
    {"url": "https://venturebeat.com/category/ai/feed/", "source": "VentureBeat AI"},
    {"url": "https://eu-startups.com/feed", "source": "EU-Startups"},

    # --- Användarpulsen: vad praktiker faktiskt bygger och pratar om ---
    {"url": "https://simonwillison.net/atom/everything/", "source": "Simon Willison"},
    {"url": "https://hnrss.org/newest?q=AI&points=150", "source": "Hacker News AI"},
]
