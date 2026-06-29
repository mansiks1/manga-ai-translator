const searchButton = document.getElementById('searchButton');
const searchInput = document.getElementById('searchInput');

//ПОИСК МАНГИ(обработка нажатия кнопки и нажатия Enter будет после всех функций)
async function searchManga() {
    // возьмем значение из поля ввода и удалим пробелы в начале и конце
    const query = searchInput.value.trim();
    if (query == "") return; // если поле пустое, ничего не делаем
    //showSearchTitle(query) должна показывать пользователю, что именно он ищет.
    showSearchStatus(query);
    
    //далее будет запрос к API
    //const mangas = await fetchMangaSearch(query);

    //renderSearchResults(mangas); //Показывает список найденной манги.
}
                //ВСТАВИТЬ ТЕКСТ В renderSearchResults после того как сделаю
//Добавить setSearchStatus(). нужно, чтобы показать состояние загрузки, пока идет запрос к API.
//setSearchStatus(`Результаты поиска для: "${query}"`);

//Фунция для отображения пользователю того, что он ищет.
function showSearchStatus(query) {
    const searchStatus = document.getElementById('searchStatus');
    searchStatus.textContent = `Идет поиск для: "${query}"`;
    const resultsDiv = document.getElementById('results');
    resultsDiv.style.display = 'block'; // Показываем блок результатов
}

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

//нажатие на кнопку поиска, сначала мышкой, потом Enter
searchButton.addEventListener('click', searchManga);
searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        searchManga();
    }
});