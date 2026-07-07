const searchButton = document.getElementById('searchButton');
const deepSearchButton = document.getElementById('deepSearchButton');
const searchInput = document.getElementById('searchInput');
const languageButtons = document.querySelectorAll('.language-option');

// Предпочтительный язык перевода.
// Сейчас влияет на последнюю главу MangaDex, позже будет использоваться для ИИ-перевода.
let preferredLanguage = 'ru';
let lastSearchMode = 'normal';

// ПОИСК МАНГИ
// Обычный поиск быстро обращается к backend и ищет по введенному названию.
async function searchManga() {
    await runSearch('normal');
}

// ГЛУБОКИЙ ПОИСК
// Глубокий поиск пробует несколько вариантов названия и лучше подходит для альтернативных названий.
async function deepSearchManga() {
    await runSearch('deep');
}

// Общая функция для обычного и глубокого поиска.
async function runSearch(mode) {
    const query = searchInput.value.trim();
    if (query === '') return;

    lastSearchMode = mode;
    const isDeepSearch = mode === 'deep';

    setSearchStatus(`${isDeepSearch ? 'Идет глубокий поиск' : 'Идет поиск'} для: "${query}"`);
    clearSearchResults();
    setSearchButtonsDisabled(true);

    try {
        const searchData = await fetchMangaSearch(query, mode);
        renderSearchResults(searchData.results || [], query, mode, searchData);
    } catch (error) {
        console.error(error);
        setSearchStatus('Ошибка при поиске');
        showSearchMessage('Не получилось получить данные. Проверь, запущен ли backend.');
    } finally {
        setSearchButtonsDisabled(false);
    }
}

// Запрос к нашему backend.
// Frontend не ходит напрямую в MangaDex/AniList/Jikan/Kitsu, этим занимается server.js.
async function fetchMangaSearch(query, mode = 'normal') {
    const endpoint = mode === 'deep' ? '/api/deep-search' : '/api/search';
    const url = `${endpoint}?q=${encodeURIComponent(query)}&lang=${encodeURIComponent(preferredLanguage)}`;
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Search request failed: ${response.status}`);
    }

    return await response.json();
}

// Меняет предпочтительный язык перевода.
// Если результаты уже показаны, сразу повторяем поиск с тем же режимом.
function setPreferredLanguage(language) {
    preferredLanguage = language;

    languageButtons.forEach(button => {
        button.classList.toggle('active', button.dataset.language === language);
    });

    const results = document.getElementById('results');
    if (results.style.display !== 'none' && searchInput.value.trim() !== '') {
        runSearch(lastSearchMode);
    }
}

// Блокирует кнопки поиска, пока backend еще отвечает.
function setSearchButtonsDisabled(disabled) {
    searchButton.disabled = disabled;
    deepSearchButton.disabled = disabled;
}

// Общая функция для статуса поиска: "Идет поиск", "Результаты поиска", "Ошибка".
function setSearchStatus(text) {
    const results = document.getElementById('results');
    const searchStatus = document.getElementById('searchStatus');

    results.style.display = 'block';
    searchStatus.textContent = text;
}

// Удаляет старые карточки перед новым поиском.
function clearSearchResults() {
    document.getElementById('resultslist').innerHTML = '';
}

// Показывает короткое сообщение вместо списка карточек.
function showSearchMessage(text) {
    const resultsList = document.getElementById('resultslist');
    resultsList.textContent = text;
}

// ОТРИСОВКА РЕЗУЛЬТАТОВ
// Получает уже готовый массив манги и добавляет карточки в HTML.
function renderSearchResults(mangas, query, mode = 'normal', searchData = {}) {
    const resultsList = document.getElementById('resultslist');
    const titlePrefix = getSearchResultsTitlePrefix(mode, searchData);

    setSearchStatus(`${titlePrefix} для: "${query}"`);
    resultsList.innerHTML = '';

    if (mangas.length === 0) {
        resultsList.textContent = 'Ничего не найдено';
        return;
    }

    mangas.forEach(manga => {
        const card = createMangaCard(manga, mode);
        resultsList.appendChild(card);
    });
}

// Для глубокого поиска backend возвращает aiSearch.used.
// Если ИИ не использовался, явно показываем это в заголовке результатов.
function getSearchResultsTitlePrefix(mode, searchData = {}) {
    if (mode !== 'deep') {
        return 'Результаты поиска';
    }

    const aiWasUsed = Boolean((searchData.aiSearch || {}).used);
    return aiWasUsed
        ? 'Результаты глубокого поиска'
        : 'Результаты глубокого поиска (без использования ИИ)';
}

// Создает одну карточку манги.
// В обычном поиске источник открывается сразу, в глубоком поиске можно выбрать источник из списка.
function createMangaCard(manga, mode = 'normal') {
    const card = document.createElement('article');
    card.className = 'manga-card';

    if (manga.coverUrl) {
        const cover = document.createElement('img');
        cover.className = 'manga-cover';
        cover.src = manga.coverUrl;
        cover.alt = `Обложка ${manga.title}`;
        card.appendChild(cover);
    }

    const content = document.createElement('div');
    content.className = 'manga-card-content';

    const title = document.createElement('h3');
    title.textContent = manga.title;

    const description = document.createElement('p');
    description.className = 'manga-description';
    description.textContent = manga.description || 'Описание пока не найдено.';

    const meta = document.createElement('p');
    meta.className = 'manga-meta';
    meta.textContent = getMangaMetaText(manga);

    const buttons = document.createElement('div');
    buttons.className = 'manga-actions';

    // TODO: подключить отдельный экран/режим ИИ-перевода.
    const translateButton = document.createElement('button');
    translateButton.type = 'button';
    translateButton.textContent = 'ИИ-перевод';
    translateButton.addEventListener('click', () => {
        showMangaDexChapterButtons(manga, card);
    });

    const sourceButton = mode === 'deep'
        ? createSourcePickerButton(manga, card)
        : createOpenSourceButton(manga);

    buttons.append(translateButton, sourceButton);
    content.append(title, meta, description, buttons);
    card.appendChild(content);

    return card;
}

function createSourcePickerButton(manga, card) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Выбрать источник';
    button.disabled = getDisplaySources(manga).length === 0;
    button.addEventListener('click', () => {
        showMangaSourceOptions(manga, card);
    });

    return button;
}

function createOpenSourceButton(manga) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Открыть источник';
    button.disabled = !getBestUrl(manga);
    button.addEventListener('click', () => {
        const url = getBestUrl(manga);
        if (url) window.open(url, '_blank');
    });

    return button;
}

// Показывает под карточкой список источников в такой же раскрывающейся зоне,
// как список глав для будущего ИИ-перевода.
function showMangaSourceOptions(manga, card) {
    const sourceContainer = getOrCreateSourceContainer(card);
    const sources = getDisplaySources(manga);

    hideCardPanel(card, '.chapter-list');
    sourceContainer.style.display = 'block';
    renderMangaSourceOptions(sourceContainer, sources);
}

function renderMangaSourceOptions(container, sources) {
    container.innerHTML = '';

    const title = document.createElement('p');
    title.className = 'chapter-list-title';
    title.textContent = sources.length > 0
        ? `Найдено источников: ${sources.length}`
        : 'Источники пока не найдены.';
    container.appendChild(title);

    if (sources.length === 0) return;

    const list = document.createElement('div');
    list.className = 'source-options';

    sources.forEach(source => {
        const row = document.createElement('div');
        row.className = 'source-option';

        const info = document.createElement('div');
        info.className = 'source-option-info';

        const name = document.createElement('strong');
        name.textContent = source.isBest ? `${source.siteName} · лучший` : source.siteName;

        const details = document.createElement('span');
        details.textContent = getSourceDetailsText(source);

        info.append(name, details);
        row.appendChild(info);

        if (source.url) {
            const link = document.createElement('a');
            link.className = 'chapter-button source-open-link';
            link.href = source.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = 'Открыть';
            row.appendChild(link);
        }

        list.appendChild(row);
    });

    container.appendChild(list);
}

function getOrCreateSourceContainer(card) {
    let container = card.querySelector('.source-list');

    if (!container) {
        container = document.createElement('div');
        container.className = 'source-list';
        card.appendChild(container);
    }

    return container;
}

// Первый шаг ИИ-перевода: показываем главы MangaDex как кнопки-ссылки.
// Позже вместо перехода по ссылке будем брать chapterId, получать страницы и запускать OCR.
async function showMangaDexChapterButtons(manga, card) {
    const chaptersContainer = getOrCreateChaptersContainer(card);
    const mangaDexId = getMangaDexMangaId(manga);

    hideCardPanel(card, '.source-list');
    chaptersContainer.style.display = 'block';
    chaptersContainer.textContent = '';

    if (!mangaDexId) {
        chaptersContainer.textContent = 'Для ИИ-перевода пока поддерживаются только тайтлы с источником MangaDex.';
        return;
    }

    chaptersContainer.textContent = 'Загружаем главы MangaDex...';

    try {
        const result = await fetchMangaDexChapters(mangaDexId);
        renderMangaDexChapterButtons(chaptersContainer, result.chapters, result.error);
    } catch (error) {
        console.error(error);
        chaptersContainer.textContent = 'Не получилось загрузить главы MangaDex.';
    }
}

async function fetchMangaDexChapters(mangaDexId) {
    const url = `/api/mangadex/chapters?mangaId=${encodeURIComponent(mangaDexId)}&lang=${encodeURIComponent(preferredLanguage)}`;
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`MangaDex chapters request failed: ${response.status}`);
    }

    const data = await response.json();
    return {
        chapters: data.chapters || [],
        error: data.error || ''
    };
}

function renderMangaDexChapterButtons(container, chapters, error = '') {
    container.innerHTML = '';

    const title = document.createElement('p');
    title.className = 'chapter-list-title';
    title.textContent = error
        ? `Не получилось загрузить главы MangaDex: ${error}`
        : chapters.length > 0
        ? `Найдено глав: ${chapters.length}`
        : 'Главы на выбранном языке не найдены.';
    container.appendChild(title);

    if (error || chapters.length === 0) return;

    const list = document.createElement('div');
    list.className = 'chapter-buttons';

    chapters.forEach(chapter => {
        const link = document.createElement('a');
        link.className = 'chapter-button';
        link.href = chapter.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = getChapterButtonText(chapter);
        link.title = `Язык главы: ${getLanguageName(chapter.language)}`;
        list.appendChild(link);
    });

    container.appendChild(list);
}

function getOrCreateChaptersContainer(card) {
    let container = card.querySelector('.chapter-list');

    if (!container) {
        container = document.createElement('div');
        container.className = 'chapter-list';
        card.appendChild(container);
    }

    return container;
}

function hideCardPanel(card, selector) {
    const panel = card.querySelector(selector);
    if (panel) {
        panel.style.display = 'none';
    }
}

function getMangaDexMangaId(manga) {
    if (typeof manga.id === 'string' && manga.id.startsWith('mangadex:')) {
        return manga.id.replace('mangadex:', '');
    }

    const mangaDexSource = (manga.sources || []).find(source => source.siteName === 'MangaDex');
    if (!mangaDexSource) return '';

    const match = String(mangaDexSource.url || '').match(/mangadex\.org\/title\/([^/?#]+)/);
    return match ? match[1] : '';
}

function getChapterButtonText(chapter) {
    const chapterNumber = chapter.chapter || '?';
    const language = getLanguageLabel(chapter.language);
    const baseText = chapter.title ? `Глава ${chapterNumber}: ${chapter.title}` : `Глава ${chapterNumber}`;

    return `${baseText} [${language}]`;
}

function getLanguageLabel(language) {
    return String(language || 'unknown').toUpperCase();
}

function getLanguageName(language) {
    const languages = {
        ru: 'русский',
        en: 'английский',
        ja: 'японский',
        ko: 'корейский',
        zh: 'китайский',
        'zh-hk': 'китайский',
        'pt-br': 'португальский',
        es: 'испанский',
        fr: 'французский',
        de: 'немецкий',
        it: 'итальянский',
        pl: 'польский',
        tr: 'турецкий',
        vi: 'вьетнамский',
        id: 'индонезийский',
        th: 'тайский',
        unknown: 'неизвестный'
    };

    return languages[language] || language || 'неизвестный';
}

// Собирает короткую строку под названием карточки:
// последняя глава, список источников и лучший источник.
function getMangaMetaText(manga) {
    const sourceNames = (manga.sources || []).map(source => source.siteName);
    const uniqueSourceNames = Array.from(new Set(sourceNames));
    const latestChapter = (manga.bestSource && manga.bestSource.latestChapter) ?? manga.latestChapter;
    const parts = [];

    parts.push(`Последняя глава: ${latestChapter || 'неизвестно'}`);
    if (uniqueSourceNames.length > 0) parts.push(`Источники: ${uniqueSourceNames.join(', ')}`);
    if (manga.bestSource) parts.push(`Лучший: ${manga.bestSource.siteName}`);

    return parts.join(' | ') || 'Источник пока не определен';
}

// Возвращает ссылку, которую открывает кнопка обычного поиска.
function getBestUrl(manga) {
    return (manga.bestSource && manga.bestSource.url) || manga.originalUrl || '';
}

// Собирает источники для панели выбора. Если backend дал только originalUrl,
// показываем его как запасной источник, чтобы пользователь не терял ссылку.
function getDisplaySources(manga) {
    const bestSource = manga.bestSource || null;
    const sources = (manga.sources || []).map(source => normalizeDisplaySource(source, bestSource));

    if (manga.originalUrl && !sources.some(source => source.url === manga.originalUrl)) {
        sources.push(normalizeDisplaySource({
            siteName: 'Основной источник',
            url: manga.originalUrl,
            language: 'unknown',
            latestChapter: manga.latestChapter || null,
            chaptersCount: manga.chaptersCount || null,
            type: 'catalog'
        }, bestSource));
    }

    return uniqueDisplaySources(sources).sort(compareDisplaySources);
}

function normalizeDisplaySource(source, bestSource) {
    const siteName = source.siteName || 'Неизвестный источник';

    return {
        siteName,
        url: source.url || '',
        language: source.language || 'unknown',
        latestChapter: source.latestChapter || null,
        chaptersCount: source.chaptersCount ?? null,
        type: source.type || 'catalog',
        isBest: Boolean(bestSource && source.siteName === bestSource.siteName && source.url === bestSource.url)
    };
}

function uniqueDisplaySources(sources) {
    const map = new Map();

    sources.forEach(source => {
        const key = source.url || `${source.siteName}:${source.type}:${source.language}`;
        const existing = map.get(key);

        if (!existing || compareDisplaySources(source, existing) < 0) {
            map.set(key, source);
        }
    });

    return Array.from(map.values());
}

function compareDisplaySources(a, b) {
    if (a.isBest !== b.isBest) return a.isBest ? -1 : 1;

    const typeDiff = getSourceTypePriority(b.type) - getSourceTypePriority(a.type);
    if (typeDiff !== 0) return typeDiff;

    return getChapterNumber(b.latestChapter) - getChapterNumber(a.latestChapter);
}

function getSourceTypePriority(type) {
    const priorities = {
        reader: 3,
        official: 2,
        catalog: 1
    };

    return priorities[type] || 0;
}

function getSourceDetailsText(source) {
    const details = [
        `Последняя глава: ${source.latestChapter || 'неизвестно'}`,
        `Тип: ${getSourceTypeLabel(source.type)}`,
        `Язык: ${getLanguageName(source.language)}`
    ];

    if (source.chaptersCount != null) {
        details.push(`Глав: ${source.chaptersCount}`);
    }

    return details.join(' | ');
}

function getSourceTypeLabel(type) {
    const labels = {
        reader: 'читалка',
        official: 'официальный',
        catalog: 'каталог'
    };

    return labels[type] || type || 'неизвестно';
}

function getChapterNumber(value) {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : 0;
}

// Нажатие на кнопку обычного поиска мышкой.
searchButton.addEventListener('click', searchManga);

// Нажатие на кнопку глубокого поиска мышкой.
deepSearchButton.addEventListener('click', deepSearchManga);

// Нажатие Enter в поле поиска запускает обычный поиск.
searchInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        searchManga();
    }
});

// Выбор предпочтительного языка перевода.
languageButtons.forEach(button => {
    button.addEventListener('click', () => {
        setPreferredLanguage(button.dataset.language);
    });
});
