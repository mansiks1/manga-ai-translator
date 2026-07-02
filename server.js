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
    { name: 'MangaUpdates', search: searchMangaUpdates },
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
            const results = await adapter.search(query, preferredLanguage);
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
async function searchMangaDex(query, preferredLanguage) {
    const url = new URL('https://api.mangadex.org/manga');
    url.searchParams.set('title', query);
    url.searchParams.set('limit', String(SOURCE_LIMIT));
    url.searchParams.append('includes[]', 'cover_art');
    url.searchParams.append('contentRating[]', 'safe');
    url.searchParams.append('contentRating[]', 'suggestive');
    url.searchParams.set('order[relevance]', 'desc');

    const json = await fetchJson(url);

    return Promise.all((json.data || []).map(async item => {
        const attributes = item.attributes || {};
        const title = pickLocalizedText(attributes.title) || 'Untitled';
        const description = pickLocalizedText(attributes.description);
        const coverUrl = getMangaDexCoverUrl(item);
        const aggregate = await getMangaDexAggregate(item.id, preferredLanguage);
        const chaptersCount = null;
        const latestChapter = aggregate.latestChapter || attributes.lastChapter || null;
        const mangaUrl = `https://mangadex.org/title/${item.id}`;

        return {
            id: `mangadex:${item.id}`,
            title,
            aliases: getMangaDexAliases(attributes),
            description,
            coverUrl,
            chaptersCount,
            latestChapter,
            originalUrl: mangaUrl,
            sources: [
                {
                    siteName: 'MangaDex',
                    url: mangaUrl,
                    language: attributes.originalLanguage || 'unknown',
                    chaptersCount,
                    latestChapter,
                    type: 'reader'
                }
            ]
        };
    }));
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
        latestChapter: item.chapters ? String(item.chapters) : null,
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

// Источник MangaUpdates: полезен для альтернативных названий, latest_chapter
// и официальных ссылок на оригиналы/переводы из описания.
async function searchMangaUpdates(query) {
    const json = await fetchJson('https://api.mangaupdates.com/v1/series/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            search: query,
            stype: 'title',
            perpage: SOURCE_LIMIT
        })
    });

    const records = (json.results || [])
        .map(result => result.record)
        .filter(Boolean)
        .slice(0, SOURCE_LIMIT);

    return Promise.all(records.map(async record => {
        const details = await getMangaUpdatesDetails(record.series_id);
        const manga = details || record;
        const officialSources = extractOfficialSourcesFromText(manga.description || '');
        const latestChapter = manga.latest_chapter ? String(manga.latest_chapter) : null;
        const chaptersCount = toNumber(manga.latest_chapter);

        return {
            id: `mangaupdates:${manga.series_id}`,
            title: manga.title || 'Untitled',
            aliases: [
                manga.title,
                ...((manga.associated || []).map(item => item.title))
            ].filter(Boolean),
            description: manga.description || '',
            coverUrl: (((manga.image || {}).url || {}).original) || (((manga.image || {}).url || {}).thumb) || '',
            chaptersCount,
            latestChapter,
            originalUrl: manga.url,
            sources: [
                {
                    siteName: 'MangaUpdates',
                    url: manga.url,
                    language: 'unknown',
                    chaptersCount,
                    latestChapter,
                    type: 'catalog'
                },
                ...officialSources.map(source => ({
                    ...source,
                    chaptersCount,
                    latestChapter
                }))
            ]
        };
    }));
}

async function getMangaUpdatesDetails(seriesId) {
    try {
        return await fetchJson(`https://api.mangaupdates.com/v1/series/${seriesId}`);
    } catch {
        return null;
    }
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
        latestChapter: item.chapters ? String(item.chapters) : null,
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
            latestChapter: attributes.chapterCount ? String(attributes.chapterCount) : null,
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
        const key = findMergeKey(merged, manga) || getPrimaryMergeKey(manga);
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
        existing.latestChapter = maxChapter(existing.latestChapter, manga.latestChapter);
    }

    return Array.from(merged.values());
}

// Готовит одну мангу к отправке на frontend: копирует sources и добавляет bestSource.
function prepareMangaResult(manga, preferredLanguage) {
    const sources = uniqueSources(manga.sources || []);
    const bestSource = getBestSource(sources, preferredLanguage);

    return {
        ...manga,
        sources,
        latestChapter: manga.latestChapter || (bestSource && bestSource.latestChapter) || null,
        bestSource
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

        const aTypeScore = getSourceTypeScore(a.type);
        const bTypeScore = getSourceTypeScore(b.type);
        if (aTypeScore !== bTypeScore) return bTypeScore - aTypeScore;

        return getChapterNumber(b.latestChapter) - getChapterNumber(a.latestChapter);
    })[0];

    return bestSource ? { ...bestSource } : null;
}

function getSourceTypeScore(type) {
    const scores = {
        reader: 3,
        official: 2,
        catalog: 1
    };

    return scores[type] || 0;
}

// Сортирует найденные манги по релевантности запросу, не меняя исходный массив.
function sortMangasByRelevance(mangas, query) {
    return mangas.slice().sort((a, b) => {
        const scoreDiff = getRelevanceScore(b, query) - getRelevanceScore(a, query);
        if (scoreDiff !== 0) return scoreDiff;
        return getChapterNumber(b.latestChapter) - getChapterNumber(a.latestChapter);
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

async function getMangaDexAggregate(mangaId, translatedLanguage) {
    try {
        const preferredAggregate = await fetchMangaDexAggregate(mangaId, translatedLanguage);

        if (preferredAggregate.latestChapter || !translatedLanguage) {
            return preferredAggregate;
        }

        // Если на выбранном языке переводов нет, показываем общую последнюю главу,
        // чтобы one-shot и редкие тайтлы не выглядели полностью пустыми.
        return await fetchMangaDexAggregate(mangaId);
    } catch {
        return { chaptersCount: null, latestChapter: null };
    }
}

async function fetchMangaDexAggregate(mangaId, translatedLanguage) {
    const url = new URL(`https://api.mangadex.org/manga/${mangaId}/aggregate`);
    if (translatedLanguage) {
        url.searchParams.append('translatedLanguage[]', translatedLanguage);
    }

    const json = await fetchJson(url);
    return getChapterInfoFromMangaDexAggregate(json);
}

function getChapterInfoFromMangaDexAggregate(json) {
    const chapters = Object.values(json.volumes || {})
        .flatMap(volume => Object.values((volume || {}).chapters || {}));

    if (chapters.length === 0) {
        return { chaptersCount: null, latestChapter: null };
    }

    const chapterNumbers = chapters
        .map(chapter => toNumber(chapter.chapter))
        .filter(number => number !== null);

    const latestChapter = chapterNumbers.length > 0
        ? String(Math.max(...chapterNumbers))
        : null;

    return {
        chaptersCount: null,
        latestChapter
    };
}

function pickLocalizedText(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;

    return value.en || value.ru || value.ja || value.ko || value['ja-ro'] || Object.values(value).find(Boolean) || '';
}

function stripHtml(text) {
    return text ? String(text).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() : '';
}

function extractOfficialSourcesFromText(text) {
    const matches = String(text || '').matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g);
    const sources = [];

    for (const match of matches) {
        const label = match[1].trim();
        const url = match[2].trim();

        sources.push({
            siteName: getSiteNameFromUrl(url, label),
            url,
            language: getLanguageFromSourceLabel(label),
            chaptersCount: null,
            latestChapter: null,
            type: 'official'
        });
    }

    return uniqueSources(sources);
}

function getSiteNameFromUrl(url, fallback) {
    try {
        const hostname = new URL(url).hostname.replace(/^www\./, '');
        const knownSites = {
            'mangaplus.shueisha.co.jp': 'Manga Plus',
            'shonenjumpplus.com': 'Shonen Jump+',
            'shueisha.co.jp': 'Shueisha',
            'viz.com': 'Viz',
            'kakaopage.com': 'Kakao Page',
            'page.kakao.com': 'Kakao Page',
            'series.naver.com': 'Naver Series',
            'ridibooks.com': 'Ridibooks'
        };

        return knownSites[hostname] || hostname;
    } catch {
        return fallback || 'Official source';
    }
}

function getLanguageFromSourceLabel(label) {
    const normalizedLabel = String(label || '').toLowerCase();
    const languageMap = [
        ['russian', 'ru'],
        ['рус', 'ru'],
        ['english', 'en'],
        ['french', 'fr'],
        ['spanish', 'es'],
        ['korean', 'ko'],
        ['japanese', 'ja'],
        ['original', 'ja']
    ];

    const match = languageMap.find(([name]) => normalizedLabel.includes(name));
    return match ? match[1] : 'unknown';
}

function normalizeTitle(title) {
    return String(title || '')
        .toLowerCase()
        .replace(/[^a-z0-9а-яё]+/gi, ' ')
        .trim();
}

function getTitleKeys(manga) {
    return uniqueStrings([manga.title, ...(manga.aliases || [])])
        .map(normalizeTitle)
        .filter(Boolean);
}

function getPrimaryMergeKey(manga) {
    return getTitleKeys(manga)[0] || normalizeTitle(manga.id);
}

function findMergeKey(merged, manga) {
    const mangaKeys = getTitleKeys(manga);

    for (const [key, existing] of merged.entries()) {
        const existingKeys = getTitleKeys(existing);
        const sharedKey = existingKeys.find(existingKey => mangaKeys.includes(existingKey));

        if (sharedKey && shouldMergeBySharedTitle(existing, manga, sharedKey)) {
            return key;
        }
    }

    return null;
}

function shouldMergeBySharedTitle(existing, manga, sharedKey) {
    const existingPrimary = normalizeTitle(existing.title);
    const mangaPrimary = normalizeTitle(manga.title);

    if (existingPrimary === sharedKey && mangaPrimary === sharedKey) {
        return true;
    }

    if (hasDifferentSpecialType(existingPrimary, mangaPrimary)) {
        return false;
    }

    return getTitleSimilarity(sharedKey, existingPrimary) >= 0.65
        && getTitleSimilarity(sharedKey, mangaPrimary) >= 0.65;
}

function hasDifferentSpecialType(aTitle, bTitle) {
    const specialWords = ['doujinshi', 'one shot', 'oneshot', 'novel'];
    return specialWords.some(word => aTitle.includes(word) !== bTitle.includes(word));
}

function getTitleSimilarity(aTitle, bTitle) {
    const aLength = normalizeTitle(aTitle).length;
    const bLength = normalizeTitle(bTitle).length;

    if (aLength === 0 || bLength === 0) return 0;
    return Math.min(aLength, bLength) / Math.max(aLength, bLength);
}

function uniqueStrings(values) {
    return Array.from(new Set(values.filter(Boolean).map(value => String(value).trim()).filter(Boolean)));
}

// Убирает дубли источников внутри одной карточки.
// Если один и тот же сайт вернул несколько похожих записей, оставляем более полезную.
function uniqueSources(sources) {
    const map = new Map();

    for (const source of sources) {
        const key = source.siteName || source.url || '';
        const existing = map.get(key);

        if (!existing || compareSources(source, existing) < 0) {
            map.set(key, { ...source });
        }
    }

    return Array.from(map.values());
}

function compareSources(a, b) {
    const aTypeScore = getSourceTypeScore(a.type);
    const bTypeScore = getSourceTypeScore(b.type);
    if (aTypeScore !== bTypeScore) return bTypeScore - aTypeScore;

    return getChapterNumber(b.latestChapter) - getChapterNumber(a.latestChapter);
}

function toNumber(value) {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : null;
}

function getChapterNumber(value) {
    return toNumber(value) || 0;
}

function maxNullable(a, b) {
    if (a == null) return b == null ? null : b;
    if (b == null) return a;
    return Math.max(a, b);
}

function maxChapter(a, b) {
    const aNumber = toNumber(a);
    const bNumber = toNumber(b);

    if (aNumber == null) return b || null;
    if (bNumber == null) return a || null;

    return String(Math.max(aNumber, bNumber));
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





