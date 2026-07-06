# Manga Search AI

Local web app for searching manga across multiple sources and preparing AI-assisted chapter translation.

## Current Features

- Normal manga search.
- Deep search using rule-based query variants plus optional OpenAI-generated title aliases.
- Preferred translation language selector: `RU`, `EN`, `JA`, `KO`, `ZH`, `All`.
- Latest chapter lookup, primarily through MangaDex.
- Manga cards with cover, description, sources, best source, and latest chapter.
- MangaDex chapter buttons for the future AI translation flow.

## Sources

- MangaDex
- MangaUpdates
- AniList
- Jikan / MyAnimeList
- Kitsu

MangaUpdates is also used to discover official links such as Manga Plus, Shueisha, Viz, Naver, Kakao Page, and others when they are listed in the series description.

## Run Locally

```bash
npm start
```

Then open:

```txt
http://localhost:3000
```

The site needs the Node.js backend because browser JavaScript cannot reliably call all external APIs directly.

## AI Deep Search

Deep search works without an AI key, but if `OPENAI_API_KEY` is configured the backend asks OpenAI for extra manga title variants using a strict JSON schema:

```json
{
  "queries": ["Sousou no Frieren", "Frieren Beyond Journey's End", "Frieren"]
}
```

Create a local `.env` file:

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

## Project Structure

```txt
manga-ai-translator/
  index.html
  style.css
  script.js
  server.js
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
