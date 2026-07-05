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
        const mangas = await fetchMangaSearch(query, mode);
        renderSearchResults(mangas, query, mode);
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

    const data = await response.json();
    return data.results || [];
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
function renderSearchResults(mangas, query, mode = 'normal') {
    const resultsList = document.getElementById('resultslist');
    const titlePrefix = mode === 'deep' ? 'Результаты глубокого поиска' : 'Результаты поиска';

    setSearchStatus(`${titlePrefix} для: "${query}"`);
    resultsList.innerHTML = '';

    if (mangas.length === 0) {
        resultsList.textContent = 'Ничего не найдено';
        return;
    }

    mangas.forEach(manga => {
        const card = createMangaCard(manga);
        resultsList.appendChild(card);
    });
}

// Создает одну карточку манги.
// Здесь находятся кнопки "ИИ-перевод" и "Открыть источник".
function createMangaCard(manga) {
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

    // Открывает лучший найденный источник. Сейчас это может быть сайт для чтения или каталог.
    const originalButton = document.createElement('button');
    originalButton.type = 'button';
    originalButton.textContent = 'Открыть источник';
    originalButton.disabled = !getBestUrl(manga);
    originalButton.addEventListener('click', () => {
        const url = getBestUrl(manga);
        if (url) window.open(url, '_blank');
    });

    buttons.append(translateButton, originalButton);
    content.append(title, meta, description, buttons);
    card.appendChild(content);

    return card;
}

// Первый шаг ИИ-перевода: показываем главы MangaDex как кнопки-ссылки.
// Позже вместо перехода по ссылке будем брать chapterId, получать страницы и запускать OCR.
async function showMangaDexChapterButtons(manga, card) {
    const chaptersContainer = getOrCreateChaptersContainer(card);
    const mangaDexId = getMangaDexMangaId(manga);

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

// Возвращает ссылку, которую открывает кнопка "Открыть источник".
function getBestUrl(manga) {
    return (manga.bestSource && manga.bestSource.url) || manga.originalUrl || '';
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
