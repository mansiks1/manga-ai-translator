const searchButton = document.getElementById('searchButton');
const searchInput = document.getElementById('searchInput');

//ПОИСК МАНГИ(обработка нажатия кнопки и нажатия Enter будет после всех функций)
async function searchManga() {

    // возьмем значение из поля ввода и удалим пробелы в начале и конце
    const query = searchInput.value.trim();
    if (query == "") return; // если поле пустое, ничего не делаем

    //setSearchStatus(query) должна показывать пользователю, что именно он ищет.
    setSearchStatus(`Идет поиск для: "${query}"`);

    //далее будет запрос к API
    //const mangas = await fetchMangaSearch(query);

    //ТЕСТОВЫЕ ДАННЫЕ, ПОКА НЕ РЕАЛИЗОВАН fetchMangaSearch
    const mangas = testMangas.filter(manga =>
        manga.title.toLowerCase().includes(query.toLowerCase())
    );


    //Сортируем найденные манги по языку, количеству глав и т.д. и выбираем лучший вариант.
    const sortedMangas = sortMangasByRelevance(mangas, query);

    //Надо сортировать у каждой манги источники по языку, количеству глав и т.д. и выбрать лучший источник.
    //prepareMangaResults(mangas,preferredLanguage) //сортирует по языку, количеству глав и т.д.;

    renderSearchResults(sortedMangas, query); //Показывает список найденной манги.
}
//ВСТАВИТЬ ТЕКСТ В renderSearchResults после того как сделаю
//Добавить setSearchStatus(). нужно, чтобы показать состояние загрузки, пока идет запрос к API.
//setSearchStatus(`Результаты поиска для: "${query}"`);


//Функция для отображения состояния поиска (например, "Идет поиск...")
function setSearchStatus(text) {
    const results = document.getElementById('results');
    const searchStatus = document.getElementById('searchStatus');

    results.style.display = 'block';
    searchStatus.textContent = text;
}

//нужно реализовать:
// searchManga()          // управляет порядком действий
// fetchMangaSearch()     // получает данные
// renderSearchResults()  // рисует результаты
// createMangaCard()      // создает одну карточку
// deepSearchManga()          // глубокий поиск
// fetchDeepMangaData()       // обращение к backend/ИИ-поиску
// renderDeepSearchResult()   // расширенная карточка с главами/языками

// async function fetchMangaSearch(query) {

// }

//Сортирует найденные манги по релевантности (сначала точное совпадение, потом совпадение в начале, потом совпадение в середине)
function sortMangasByRelevance(mangas, query) {
    const normalizedQuery = query.toLowerCase();

    return mangas.slice().sort((a, b) => {
        const aTitle = a.title.toLowerCase();
        const bTitle = b.title.toLowerCase();

        if (aTitle === normalizedQuery && bTitle !== normalizedQuery) return -1;
        if (aTitle !== normalizedQuery && bTitle === normalizedQuery) return 1;

        if (aTitle.startsWith(normalizedQuery) && !bTitle.startsWith(normalizedQuery)) return -1;
        if (!aTitle.startsWith(normalizedQuery) && bTitle.startsWith(normalizedQuery)) return 1;

        if (aTitle.includes(normalizedQuery) && !bTitle.includes(normalizedQuery)) return -1;
        if (!aTitle.includes(normalizedQuery) && bTitle.includes(normalizedQuery)) return 1;

        return 0;
    });
}

//Функция для выбора лучшего источника для одной манги на основе предпочтительного языка и количества глав
function getBestSource(sources = [], preferredLanguage) {
    if (sources.length === 0) return null;

    const bestSource = sources
        .slice()
        .sort((a, b) => {
            if (a.language === preferredLanguage && b.language !== preferredLanguage) return -1;
            if (a.language !== preferredLanguage && b.language === preferredLanguage) return 1;

            return b.chaptersCount - a.chaptersCount;
        })[0];

    return bestSource ? { ...bestSource } : null;
}

//Функция для выбора лучшего источника манги на основе предпочтительного языка
function prepareMangaResults(mangas, preferredLanguage) {
    return mangas.map(manga => {
        const sources = manga.sources ? manga.sources.map(source => ({ ...source })) : [];

        return {
            ...manga,
            sources,
            bestSource: getBestSource(sources, preferredLanguage)
        };
    });
}

//Тестовая выборка для проверки отрисовки карточек
const testMangas = [
    {
        id: 1,
        title: 'One Piece',
        description: 'Приключения пиратской команды в поисках легендарного сокровища.',
        coverUrl: '',
        originalUrl: 'https://mangaplus.shueisha.co.jp/titles/100020',
        chaptersCount: 1100
    },
    {
        id: 2,
        title: 'Solo Leveling',
        description: 'Охотник низкого ранга получает шанс стать сильнейшим.',
        coverUrl: '',
        originalUrl: 'https://www.tappytoon.com/en/book/solo-leveling-official',
        chaptersCount: 200
    },
    {
        id: 3,
        title: 'One Piece: Romance Dawn',
        description: 'Предыстория One Piece, рассказывающая о ранних приключениях Луффи.',
        coverUrl: '',
        originalUrl: 'https://mangaplus.shueisha.co.jp/titles/100020',
        chaptersCount: 10
    }
];
//Отрисовка карточек
function createMangaCard(manga) {
    const card = document.createElement('div');
    card.className = 'manga-card';

    const title = document.createElement('h3');
    title.textContent = manga.title;

    const description = document.createElement('p');
    description.textContent = manga.description;

    const chapters = document.createElement('p');
    chapters.textContent = `Глав: ${manga.chaptersCount}`;

    //Можно добавить, если у меня будет встроенный ридер, но пока что не нужно.
    //Тогда "Читать" может открывать “лучший доступный вариант” автоматически
    // const readButton = document.createElement('button');
    // readButton.textContent = 'Читать';
    // readButton.addEventListener('click', () => {
    //     console.log('Открыть чтение:', manga);
    // });

    const translateButton = document.createElement('button');
    translateButton.textContent = 'ИИ-перевод';
    translateButton.addEventListener('click', () => {
        console.log('Перевести:', manga);
    });

    const originalButton = document.createElement('button');
    originalButton.textContent = 'Оригинал';
    originalButton.addEventListener('click', () => {
        window.open(manga.originalUrl, '_blank');
    });

    card.append(title, description, chapters, translateButton, originalButton);

    return card;
}

//функция для отрисовки результатов поиска(показывает отрисованные карточки)
function renderSearchResults(mangas, query) {
    const results = document.getElementById('results');
    const searchStatus = document.getElementById('searchStatus');
    const resultsList = document.getElementById('resultslist');

    results.style.display = 'block';
    searchStatus.textContent = `Результаты поиска для: "${query}"`;
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
//нажатие на кнопку поиска, сначала мышкой, потом Enter
searchButton.addEventListener('click', searchManga);
searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        searchManga();
    }
});