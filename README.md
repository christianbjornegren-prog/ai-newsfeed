# AI Newsfeed

Ett personligt, automatiserat AI-nyhetsflöde. Hämtar nyheter från 20 ledande
AI-källor fyra gånger om dagen, låter Claude (Haiku) sammanfatta varje artikel
på originalspråket, och visar dem grupperade efter ämne i en mobilfirst
PWA-dashboard.

**Filosofi:** Robust kodbas framför quick fixes. Långsiktig arkitektur framför
kortsiktiga lösningar. Produkten ska fungera på riktigt — inte imponera på pappret.

## Arkitektur

```
RSS-källor (20 st)
      │  GitHub Actions: 03:00, 09:00, 13:00, 18:00 (UTC-schema i fetch-news.yml)
      ▼
scripts/fetch_news.py      – parallell hämtning, timeout per feed,
      │                      URL-normalisering (spårningsparametrar bort), dedup
      ▼
Google Firestore (articles)
      │
scripts/summarize_news.py  – Claude Haiku: teaser + summary + topic per artikel
      │
      ▼
docs/ (GitHub Pages)       – statisk PWA: klustring per ämne, filter-chips,
                             sök, lässtatus, offline-cache via service worker
```

### Kataloger

| Fil/katalog | Roll |
|---|---|
| `scripts/feeds.py` | **Single source of truth** för alla RSS-källor. Importeras av både `fetch_news.py` och `verify_sources.py` så listorna aldrig glider isär. |
| `scripts/fetch_news.py` | Hämtar alla feeds parallellt (8 workers, 20 s timeout per feed), normaliserar URL:er, dedupar mot Firestore, hämtar OG-bilder. |
| `scripts/summarize_news.py` | Sammanfattar osammanfattade artiklar med Claude Haiku (max 30/körning). |
| `scripts/verify_sources.py` | Diagnostik: testar produktionskällorna och rapporterar kvalitet. Körs manuellt via workflow `verify-sources.yml`. |
| `scripts/retopic_articles.py` | Engångsscript: omklassificerar topic för befintliga artiklar. |
| `docs/` | Hela frontenden. Ingen byggpipeline — vanilla HTML/CSS/JS som deployas direkt via GitHub Pages. |
| `docs/sw.js` | Service worker: network-first med offline-fallback. |

### Frontendens dataflöde

1. **Direktrendering:** senaste flödet cachas i `localStorage` och renderas
   omedelbart vid start, medan färsk data hämtas i bakgrunden.
2. **Firestore-query:** de 100 senaste artiklarna med `summary != null`.
3. **Tidsfönster:** visa senaste 3 dagarna; färre än 10 träffar → utöka till
   7 dagar; fortfarande tomt → visa allt. Flödet är aldrig tomt i onödan.
4. **Klustring:** artiklar grupperas per `topic`; 2+ artiklar blir ett kluster.
   Huvudartikeln väljs smart: bland de tre senaste föredras en med både bild
   och sammanfattning.
5. **Personligt lager (helt lokalt, ingen tracking):** lästa artiklar dimmas,
   artiklar hämtade efter ditt senaste besök får NY-badge. Allt lagras i
   `localStorage` på enheten.

## Källor

Tre spår, definierade i `scripts/feeds.py`:

- **Officiella bolagsbloggar** – OpenAI, Anthropic, Google (AI/Research/DeepMind),
  Microsoft, Hugging Face
- **Oberoende journalistik** – MIT Technology Review, The Decoder, TechCrunch
  (AI + Europe), Ars Technica, IEEE Spectrum, MarkTechPost, The Verge,
  VentureBeat, EU-Startups
- **Användarpulsen** – Simon Willison, Hacker News AI (endast ≥150 poäng)

Ny källa? Lägg till i `feeds.py` och kör workflowen **Verify RSS Sources**
för att bekräfta att feeden svarar och har vettiga descriptions.

## GitHub Actions

| Workflow | Trigger | Gör |
|---|---|---|
| `fetch-news.yml` | Schema 4×/dag + manuell | Hämta + sammanfatta. Concurrency-skyddad, 20 min timeout. |
| `verify-sources.yml` | Manuell | Testrapport för alla produktionskällor. |
| `retopic.yml` | Manuell | Omklassificera topics. |
| `fix-summaries.yml` | Manuell | Reparera trasiga sammanfattningar. |

**Secrets som krävs:** `FIREBASE_SERVICE_ACCOUNT` (service account-JSON),
`CLAUDE_API_KEY`.

## Lokal utveckling

```bash
# Frontend — servera docs/ och öppna localhost:8123
cd docs && python3 -m http.server 8123

# Backend-scripten kräver secrets:
FIREBASE_SERVICE_ACCOUNT='{"...": "..."}' python scripts/fetch_news.py
```

Frontenden är avsiktligt byggstegs-fri: en HTML-fil, en CSS-fil, en JS-modul.
Firestore-läsning sker direkt från klienten (publik läsbehörighet via
security rules; skrivning kräver service account).

## PWA

Appen är installerbar (manifest + ikoner + service worker). Lägg till på
hemskärmen från webbläsaren så beter den sig som en native app, inklusive
offline-läge: senaste flödet visas från cache och uppdateras när nätet
kommer tillbaka.
