.where("summary", "==", None)
```

Firestore-queryn letar efter artiklar där `summary` är `null`. Men efter första körningen sätts `summary` till titeln (inte null). Så nästa körning hittar 9 artiklar — men det är **samma 9 artiklar om och om igen** som redan har summary = titel.

Och queryn filtrerar aldrig på `summary == ""` — den tomma strängen vi la till som fallback.

Jag skriver nu koden direkt istället för att gå via Claude Code:
```
Ersätt hela funktionen main() i scripts/summarize_news.py med exakt 
denna kod — gör inga andra ändringar:

    # Fetch articles where summary is null OR empty string
    logger.info("Querying Firestore for articles without summary...")
    
    docs_null = (
        db.collection("articles")
        .where("summary", "==", None)
        .order_by("fetched_at", direction=firestore.Query.DESCENDING)
        .limit(MAX_ARTICLES)
        .stream()
    )
    
    docs_empty = (
        db.collection("articles")
        .where("summary", "==", "")
        .order_by("fetched_at", direction=firestore.Query.DESCENDING)
        .limit(MAX_ARTICLES)
        .stream()
    )
    
    seen = set()
    articles = []
    for doc in list(docs_null) + list(docs_empty):
        if doc.id not in seen:
            seen.add(doc.id)
            articles.append((doc.id, doc.to_dict()))
    articles = articles[:MAX_ARTICLES]

Och ersätt summarize_with_claude funktionen med denna exakta version:

def summarize_with_claude(client: anthropic.Anthropic, title: str, description: str) -> dict:
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
    
    # Strip markdown backticks if present
    clean = raw.strip()
    if clean.startswith("```"):
        clean = clean.split("```")[1]
        if clean.startswith("json"):
            clean = clean[4:]
    clean = clean.strip()
    
    try:
        data = json.loads(clean)
        teaser = strip_markdown(data.get("teaser", ""))
        summary = strip_markdown(data.get("summary", ""))
        if not teaser or teaser == title:
            logger.warning("  -> teaser is empty or equals title")
        return {"teaser": teaser, "summary": summary}
    except (json.JSONDecodeError, AttributeError) as e:
        logger.error("  -> JSON parse failed: %s", e)
        logger.error("  -> Raw was: %s", raw)
        return {"teaser": "", "summary": ""}
