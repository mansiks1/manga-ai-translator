const searchButton = document.getElementById('searchButton');
const searchInput = document.getElementById('searchInput');

// Предпочтительный язык пользователя. Позже можно вынести в настройки.
const preferredLanguage = 'ru';

// ПОИСК МАНГИ
// Обрабатывает кнопку "Найти" и Enter: берет текст из поля, отправляет запрос на backend
// и передает найденную мангу в функцию отрисовки карточек.
async function searchManga() {
    const query = searchInput.value.trim();
    if (query === '') return;

    // Показываем пользователю, что поиск начался, и очищаем старые карточки.
    setSearchStatus(`Идет поиск для: "${query}"`);
    clearSearchResults();

    try {
        const mangas = await fetchMangaSearch(query);
        renderSearchResults(mangas, query);
    } catch (error) {
        console.error(error);
        setSearchStatus('Ошибка при поиске');
        showSearchMessage('Не получилось получить данные. Проверь, запущен ли backend.');
    }
}

// Запрос к нашему backend.
// Frontend не ходит напрямую в MangaDex/AniList/Jikan/Kitsu, этим занимается server.js.
async function fetchMangaSearch(query) {
    const url = `/api/search?q=${encodeURIComponent(query)}&lang=${encodeURIComponent(preferredLanguage)}`;
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Search request failed: ${response.status}`);
    }

    const data = await response.json();
    return data.results || [];
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
function renderSearchResults(mangas, query) {
    const resultsList = document.getElementById('resultslist');

    setSearchStatus(`Результаты поиска для: "${query}"`);
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
        console.log('ИИ-перевод:', manga);
        alert('ИИ-перевод добавим следующим этапом.');
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

// Собирает короткую строку под названием карточки:
// количество глав, список источников и лучший источник.
function getMangaMetaText(manga) {
    const sourceNames = (manga.sources || []).map(source => source.siteName);
    const uniqueSourceNames = Array.from(new Set(sourceNames));
    const chapters = manga.chaptersCount || (manga.bestSource && manga.bestSource.chaptersCount);
    const parts = [];

    if (chapters) parts.push(`Глав: ${chapters}`);
    if (uniqueSourceNames.length > 0) parts.push(`Источники: ${uniqueSourceNames.join(', ')}`);
    if (manga.bestSource) parts.push(`Лучший: ${manga.bestSource.siteName}`);

    return parts.join(' | ') || 'Источник пока не определен';
}

// Возвращает ссылку, которую открывает кнопка "Открыть источник".
function getBestUrl(manga) {
    return (manga.bestSource && manga.bestSource.url) || manga.originalUrl || '';
}

// Нажатие на кнопку поиска мышкой.
searchButton.addEventListener('click', searchManga);

// Нажатие Enter в поле поиска.
searchInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        searchManga();
    }
});
