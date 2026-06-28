const searchButton = document.getElementById('searchButton');
const searchInput = document.getElementById('searchInput');
searchButton.addEventListener('click', () => {
    alert(`Поиск манги: ${searchInput.value}`);
});