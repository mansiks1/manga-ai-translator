# Manga Search AI

Local web app for searching manga across multiple sources and preparing AI-assisted chapter translation.

## Current Features

- Normal manga search.
- Deep search using rule-based query variants plus optional Gemini/OpenAI title aliases.
- Preferred translation language selector: `RU`, `EN`, `JA`, `KO`, `ZH`, `All`.
- Latest chapter lookup, primarily through MangaDex.
- Manga cards with cover, description, sources, best source, and latest chapter.
- MangaDex chapter buttons for the future AI translation flow.
- Registration, login, logout, and server-side cookie sessions.
- Optional PostgreSQL persistence for users, sessions, and the credit ledger.
- Free cache hits, IP rate limits, and automatic credit refunds on total source failure.

## Sources

- MangaDex
- MangaLib
- MangaUpdates
- AniList
- Jikan / MyAnimeList
- Kitsu

MangaUpdates is also used to discover official links such as Manga Plus, Shueisha, Viz, Naver, Kakao Page, and others when they are listed in the series description.

## Run Locally

```bash
npm.cmd start
```

Then open:

```txt
http://localhost:3000
```

The site needs the Node.js backend because browser JavaScript cannot reliably call all external APIs directly.

## AI Deep Search

Deep search works without an AI key, but if an AI provider key is configured the backend asks the model for extra manga title variants using a strict JSON schema:

```json
{
  "queries": ["Sousou no Frieren", "Frieren Beyond Journey's End", "Frieren"]
}
```

Create a local `.env` file:

```txt
AI_SEARCH_PROVIDER=gemini
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.5-flash-lite
```

Provider options:

```txt
# Cheapest default for deep search.
AI_SEARCH_PROVIDER=gemini

# Use the existing OpenAI implementation.
AI_SEARCH_PROVIDER=openai

# Try Gemini first, then OpenAI if Gemini is unavailable or fails.
AI_SEARCH_PROVIDER=auto
```

OpenAI fallback settings:

```txt
OPENAI_API_KEY=sk-your-openai-api-key
OPENAI_MODEL=gpt-4o-mini
```

Optional settings:

```txt
AI_SEARCH_TIMEOUT_MS=10000
DEEP_SEARCH_QUERY_LIMIT=8
```

The model only generates search queries. Manga results are still verified through MangaDex, MangaUpdates, AniList, Jikan, and Kitsu.

## Accounts And Local Credits

The browser first receives an anonymous server-side account through an HttpOnly cookie. Registration adds an email and a scrypt password hash to that same user, so its credits are preserved. Login and registration rotate the session token, and logout revokes it server-side.

Locally a new anonymous user starts with 3 credits, and a successful deep search that was not served from cache costs 1 credit. Use the development top-up button to test replenishment.

```txt
INITIAL_USER_CREDITS=3
DEEP_SEARCH_CREDIT_COST=1
DEV_CREDIT_TOP_UP_ENABLED=true
DEV_CREDIT_TOP_UP_AMOUNT=10
```

Without `DATABASE_URL`, the balance and append-only ledger live in memory and reset when the server restarts. In `NODE_ENV=production`, the initial balance is forced to 0 and the development replenishment endpoint is disabled even if local env values were copied.

## PostgreSQL Storage

Set a PostgreSQL connection string to persist registered and anonymous users, hashed browser sessions, balances, and ledger entries:

```txt
DATABASE_URL=postgresql://postgres:password@localhost:5432/manga_ai_translator
```

Apply migrations once, then use the usual start command:

```powershell
npm.cmd run db:migrate
npm.cmd start
```

The server checks the schema before opening its port and prints `Account storage: postgres` when persistence is active. Without `DATABASE_URL`, it prints `Account storage: memory`. Before accepting real payments, add email verification, password recovery, payment webhooks, CSRF/origin checks, and a distributed Redis rate limiter.

Authentication throttling can be adjusted locally:

```txt
AUTH_RATE_LIMIT_WINDOW_MS=600000
AUTH_RATE_LIMIT_MAX=10
```

## Project Structure

```txt
manga-ai-translator/
  index.html
  style.css
  script.js
  server.js
  lib/
    account-store.js
    env.js
    passwords.js
  db/migrations/
  scripts/migrate.js
  test/
  package.json
  .gitignore
  README.md
```

## Planned AI Translation Flow

```txt
ИИ-перевод button
-> select MangaDex chapter
-> fetch chapter pages
-> run OCR
-> translate recognized text with an AI model
-> cache result
-> show translated text near the manga page
```

Recommended OCR stack:

- `manga-ocr` for Japanese manga.
- `PaddleOCR` for Chinese, Korean, English, and general multilingual OCR.

API keys and secrets must stay on the backend in `.env`, never in `script.js`.

## Production Planning

See:

- `docs/production-architecture.md`
- `docs/billing-and-credits.md`
- `db/migrations/001_accounts_and_billing.sql`
- `db/migrations/002_auth_accounts.sql`
