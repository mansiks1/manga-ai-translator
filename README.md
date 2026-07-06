# Manga Search AI

Local web app for searching manga across multiple sources and preparing AI-assisted chapter translation.

## Current Features

- Normal manga search.
- Deep search using several query variants.
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
