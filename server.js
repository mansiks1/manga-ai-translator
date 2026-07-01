const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

// НАСТРОЙКИ BACKEND
// PORT можно переопределить через переменную окружения, иначе сервер стартует на 3000.
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = __dirname;
const SOURCE_TIMEOUT_MS = 8000;
const SOURCE_LIMIT = 8;
const USER_AGENT = 'manga-ai-translator/0.1 local-development';

const STATIC_CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
};

const STATIC_FILES = new Set(['/', '/index.html', '/style.css', '/script.js']);

// Список источников обычного поиска.
// Каждый адаптер должен вернуть данные в одном общем формате, чтобы frontend не зависел от конкретного API.
const sourceAdapters = [
    { name: 'MangaDex', search: searchMangaDex },
    { name: 'AniList', search: searchAniList },
    { name: 'Jikan', search: searchJikan },
    { name: 'Kitsu', search: searchKitsu }
];

// Главный HTTP-сервер: отдает frontend-файлы и API для поиска.
const server = http.createServer(async (req, res) => {
    try {
        const requestUrl = new URL(req.url, `http://${req.headers.host}`);

        if (requestUrl.pathname === '/api/search') {
            await handleSearchRequest(requestUrl, res);
            return;
        }

        await serveStaticFile(requestUrl.pathname, res);
    } catch (error) {
        console.error(error);
        sendJson(res, 500, { error: 'Internal server error' });
    }
});

server.listen(PORT, () => {
    console.log(`Server is running: http://localhost:${PORT}`);
});

// API endpoint: /api/search?q=название&lang=ru
// Проверяет запрос пользователя и запускает поиск по всем источникам.
async function handleSearchRequest(requestUrl, res) {
    const query = (requestUrl.searchParams.get('q') || '').trim();
    const preferredLanguage = (requestUrl.searchParams.get('lang') || 'ru').trim().toLowerCase();

    if (!query) {
        sendJson(res, 400, { error: 'Search query is required' });
        return;
    }

    const result = await searchAllSources(query, preferredLanguage);
    sendJson(res, 200, result);
}

// Отдает index.html, script.js и style.css без отдельного frontend-сервера.
async function serveStaticFile(pathname, res) {
    const safePathname = pathname === '/' ? '/index.html' : pathname;

    if (!STATIC_FILES.has(safePathname)) {
        sendText(res, 404, 'Not found');
        return;
    }

    const filePath = path.join(PUBLIC_DIR, safePathname);
    const ext = path.extname(filePath);
    const contentType = STATIC_CONTENT_TYPES[ext] || 'text/plain; charset=utf-8';
    const file = await fs.readFile(filePath);

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(file);
}

// ОБЫЧНЫЙ ПОИСК
// Параллельно опрашивает все источники, не падает полностью, если один сайт вернул ошибку,
// затем объединяет одинаковые тайтлы и выбирает лучший источник для каждой манги.
async function searchAllSources(query, preferredLanguage) {
    const settled = await Promise.all(sourceAdapters.map(async adapter => {
        try {
            const results = await adapter.search(query);
            return { source: adapter.name, results, error: null };
        } catch (error) {
            return { source: adapter.name, results: [], error: error.message };
        }
    }));

    const sourceErrors = settled
        .filter(item => item.error)
        .map(item => ({ source: item.source, error: item.error }));

    const rawResults = settled.flatMap(item => item.results);
    const mergedResults = mergeMangaResults(rawResults);
    const sortedResults = sortMangasByRelevance(mergedResults, query)
        .map(manga => prepareMangaResult(manga, preferredLanguage));

    return {
        query,
        preferredLanguage,
        results: sortedResults,
        sourceErrors
    };
}

// Источник MangaDex: ближе всего к сайту для чтения, поэтому помечаем его как type: reader.
async function searchMangaDex(query) {
    const url = new URL('https://api.mangadex.org/manga');
    url.searchParams.set('title', query);
    url.searchParams.set('limit', String(SOURCE_LIMIT));
    url.searchParams.append('includes[]', 'cover_art');
    url.searchParams.append('contentRating[]', 'safe');
    url.searchParams.append('contentRating[]', 'suggestive');
    url.searchParams.set('order[relevance]', 'desc');

    const json = await fetchJson(url);

    return (json.data || []).map(item => {
        const attributes = item.attributes || {};
        const title = pickLocalizedText(attributes.title) || 'Untitled';
        const description = pickLocalizedText(attributes.description);
        const coverUrl = getMangaDexCoverUrl(item);
        const chaptersCount = toNumber(attributes.lastChapter);
        const mangaUrl = `https://mangadex.org/title/${item.id}`;

        return {
            id: `mangadex:${item.id}`,
            title,
            aliases: getMangaDexAliases(attributes),
            description,
            coverUrl,
            chaptersCount,
            originalUrl: mangaUrl,
            sources: [
                {
                    siteName: 'MangaDex',
                    url: mangaUrl,
                    language: attributes.originalLanguage || 'unknown',
                    chaptersCount,
                    latestChapter: attributes.lastChapter || null,
                    type: 'reader'
                }
            ]
        };
    });
}

// Источник AniList: хороший каталог с обложками, описаниями и альтернативными названиями.
async function searchAniList(query) {
    const graphqlQuery = `
        query ($search: String) {
            Page(page: 1, perPage: ${SOURCE_LIMIT}) {
                media(search: $search, type: MANGA) {
                    id
                    title { romaji english native }
                    description(asHtml: false)
                    chapters
                    siteUrl
                    countryOfOrigin
                    coverImage { large medium }
                }
            }
        }
    `;

    const json = await fetchJson('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: graphqlQuery, variables: { search: query } })
    });

    return (((json.data || {}).Page || {}).media || []).map(item => ({
        id: `anilist:${item.id}`,
        title: item.title.english || item.title.romaji || item.title.native || 'Untitled',
        aliases: [item.title.romaji, item.title.english, item.title.native].filter(Boolean),
        description: stripHtml(item.description),
        coverUrl: (item.coverImage || {}).large || (item.coverImage || {}).medium || '',
        chaptersCount: toNumber(item.chapters),
        originalUrl: item.siteUrl,
        sources: [
            {
                siteName: 'AniList',
                url: item.siteUrl,
                language: countryToLanguage(item.countryOfOrigin),
                chaptersCount: toNumber(item.chapters),
                latestChapter: item.chapters ? String(item.chapters) : null,
                type: 'catalog'
            }
        ]
    }));
}

// Источник Jikan/MyAnimeList: каталог. Иногда может отвечать медленно или отдавать 504.
async function searchJikan(query) {
    const url = new URL('https://api.jikan.moe/v4/manga');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(SOURCE_LIMIT));

    const json = await fetchJson(url);

    return (json.data || []).map(item => ({
        id: `jikan:${item.mal_id}`,
        title: item.title_english || item.title || 'Untitled',
        aliases: [item.title, item.title_english, item.title_japanese].filter(Boolean),
        description: item.synopsis || '',
        coverUrl: (((item.images || {}).jpg || {}).large_image_url) || (((item.images || {}).jpg || {}).image_url) || '',
        chaptersCount: toNumber(item.chapters),
        originalUrl: item.url,
        sources: [
            {
                siteName: 'MyAnimeList',
                url: item.url,
                language: 'ja',
                chaptersCount: toNumber(item.chapters),
                latestChapter: item.chapters ? String(item.chapters) : null,
                type: 'catalog'
            }
        ]
    }));
}

// Источник Kitsu: еще один каталог. Требует свой Accept-заголовок для JSON:API.
async function searchKitsu(query) {
    const url = new URL('https://kitsu.io/api/edge/manga');
    url.searchParams.set('filter[text]', query);
    url.searchParams.set('page[limit]', String(SOURCE_LIMIT));

    const json = await fetchJson(url, {
        headers: { Accept: 'application/vnd.api+json' }
    });

    return (json.data || []).map(item => {
        const attributes = item.attributes || {};
        const title = attributes.canonicalTitle || pickLocalizedText(attributes.titles) || 'Untitled';
        const kitsuUrl = attributes.slug ? `https://kitsu.app/manga/${attributes.slug}` : `https://kitsu.app/manga/${item.id}`;

        return {
            id: `kitsu:${item.id}`,
            title,
            aliases: Object.values(attributes.titles || {}).filter(Boolean),
            description: attributes.synopsis || '',
            coverUrl: ((attributes.posterImage || {}).large) || ((attributes.posterImage || {}).medium) || '',
            chaptersCount: toNumber(attributes.chapterCount),
            originalUrl: kitsuUrl,
            sources: [
                {
                    siteName: 'Kitsu',
                    url: kitsuUrl,
                    language: 'unknown',
                    chaptersCount: toNumber(attributes.chapterCount),
                    latestChapter: attributes.chapterCount ? String(attributes.chapterCount) : null,
                    type: 'catalog'
                }
            ]
        };
    });
}

// Общий helper для запросов к внешним API.
// Таймаут нужен, чтобы один зависший источник не тормозил весь поиск.
async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                Accept: 'application/json',
                'User-Agent': USER_AGENT,
                ...(options.headers || {})
            }
        });

        if (!response.ok) {
            throw new Error(`${response.status} ${response.statusText}`);
        }

        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

// Объединяет результаты из разных источников по нормализованному названию.
// Например, Naruto из MangaDex и Naruto из AniList должны стать одной карточкой с несколькими sources.
function mergeMangaResults(results) {
    const merged = new Map();

    for (const manga of results) {
        const key = normalizeTitle(manga.title || manga.id);
        const existing = merged.get(key);

        if (!existing) {
            merged.set(key, {
                ...manga,
                aliases: uniqueStrings(manga.aliases || []),
                sources: uniqueSources(manga.sources || [])
            });
            continue;
        }

        existing.aliases = uniqueStrings([...(existing.aliases || []), ...(manga.aliases || [])]);
        existing.sources = uniqueSources([...existing.sources, ...(manga.sources || [])]);
        existing.description = existing.description || manga.description || '';
        existing.coverUrl = existing.coverUrl || manga.coverUrl || '';
        existing.originalUrl = existing.originalUrl || manga.originalUrl || '';
        existing.chaptersCount = maxNullable(existing.chaptersCount, manga.chaptersCount);
    }

    return Array.from(merged.values());
}

// Готовит одну мангу к отправке на frontend: копирует sources и добавляет bestSource.
function prepareMangaResult(manga, preferredLanguage) {
    const sources = uniqueSources(manga.sources || []);

    return {
        ...manga,
        sources,
        bestSource: getBestSource(sources, preferredLanguage)
    };
}

// Выбирает лучший источник внутри одной манги.
// Приоритет: язык пользователя, сайт для чтения, потом большее количество глав.
function getBestSource(sources = [], preferredLanguage) {
    if (sources.length === 0) return null;

    const bestSource = sources.slice().sort((a, b) => {
        const aLanguageScore = a.language === preferredLanguage ? 1 : 0;
        const bLanguageScore = b.language === preferredLanguage ? 1 : 0;
        if (aLanguageScore !== bLanguageScore) return bLanguageScore - aLanguageScore;

        const aTypeScore = a.type === 'reader' ? 1 : 0;
        const bTypeScore = b.type === 'reader' ? 1 : 0;
        if (aTypeScore !== bTypeScore) return bTypeScore - aTypeScore;

        return (b.chaptersCount || 0) - (a.chaptersCount || 0);
    })[0];

    return bestSource ? { ...bestSource } : null;
}

// Сортирует найденные манги по релевантности запросу, не меняя исходный массив.
function sortMangasByRelevance(mangas, query) {
    return mangas.slice().sort((a, b) => {
        const scoreDiff = getRelevanceScore(b, query) - getRelevanceScore(a, query);
        if (scoreDiff !== 0) return scoreDiff;
        return (b.chaptersCount || 0) - (a.chaptersCount || 0);
    });
}

// Оценивает совпадение названия: точное совпадение лучше, начало названия следующее,
// затем совпадение внутри названия или альтернативных названий.
function getRelevanceScore(manga, query) {
    const normalizedQuery = normalizeTitle(query);
    const titles = uniqueStrings([manga.title, ...(manga.aliases || [])]).map(normalizeTitle);

    if (titles.some(title => title === normalizedQuery)) return 100;
    if (titles.some(title => title.startsWith(normalizedQuery))) return 80;
    if (titles.some(title => title.includes(normalizedQuery))) return 60;

    return 0;
}

function getMangaDexCoverUrl(item) {
    const cover = (item.relationships || []).find(relationship => relationship.type === 'cover_art');
    const fileName = ((cover || {}).attributes || {}).fileName;
    return fileName ? `https://uploads.mangadex.org/covers/${item.id}/${fileName}.256.jpg` : '';
}

function getMangaDexAliases(attributes) {
    const altTitles = (attributes.altTitles || [])
        .flatMap(titleObject => Object.values(titleObject || {}))
        .filter(Boolean);

    return uniqueStrings([pickLocalizedText(attributes.title), ...altTitles]);
}

function pickLocalizedText(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;

    return value.en || value.ru || value.ja || value.ko || value['ja-ro'] || Object.values(value).find(Boolean) || '';
}

function stripHtml(text) {
    return text ? String(text).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() : '';
}

function normalizeTitle(title) {
    return String(title || '')
        .toLowerCase()
        .replace(/[^a-z0-9а-яё]+/gi, ' ')
        .trim();
}

function uniqueStrings(values) {
    return Array.from(new Set(values.filter(Boolean).map(value => String(value).trim()).filter(Boolean)));
}

// Убирает полностью одинаковые источники, чтобы в данных не копились дубли.
function uniqueSources(sources) {
    const map = new Map();

    for (const source of sources) {
        const key = `${source.siteName || ''}:${source.url || ''}`;
        if (!map.has(key)) {
            map.set(key, { ...source });
        }
    }

    return Array.from(map.values());
}

function toNumber(value) {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : null;
}

function maxNullable(a, b) {
    if (a == null) return b == null ? null : b;
    if (b == null) return a;
    return Math.max(a, b);
}

function countryToLanguage(country) {
    const map = {
        JP: 'ja',
        KR: 'ko',
        CN: 'zh'
    };

    return map[country] || 'unknown';
}

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

function sendText(res, statusCode, text) {
    res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(text);
}





