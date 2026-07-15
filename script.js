const searchButton = document.getElementById('searchButton');
const deepSearchButton = document.getElementById('deepSearchButton');
const searchInput = document.getElementById('searchInput');
const languageButtons = document.querySelectorAll('.language-option');
const creditBalance = document.getElementById('creditBalance');
const deepSearchPrice = document.getElementById('deepSearchPrice');
const addCreditsButton = document.getElementById('addCreditsButton');
const creditActivity = document.getElementById('creditActivity');
const accountIdentity = document.getElementById('accountIdentity');
const openAuthButton = document.getElementById('openAuthButton');
const logoutButton = document.getElementById('logoutButton');
const authDialog = document.getElementById('authDialog');
const authTitle = document.getElementById('authTitle');
const closeAuthButton = document.getElementById('closeAuthButton');
const loginModeButton = document.getElementById('loginModeButton');
const registerModeButton = document.getElementById('registerModeButton');
const authForm = document.getElementById('authForm');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authPasswordConfirmLabel = document.getElementById('authPasswordConfirmLabel');
const authPasswordConfirm = document.getElementById('authPasswordConfirm');
const passwordHint = document.getElementById('passwordHint');
const authError = document.getElementById('authError');
const authSubmitButton = document.getElementById('authSubmitButton');

// Предпочтительный язык перевода.
// Сейчас влияет на последнюю главу MangaDex, позже будет использоваться для ИИ-перевода.
let preferredLanguage = 'ru';
let lastSearchMode = 'normal';
let accountState = null;
// Платный поиск включаем только после получения session cookie и баланса, иначе два
// одновременных первых запроса могли бы создать для одного браузера разные сессии.
let accountReady = false;
let searchInProgress = false;
let authMode = 'login';

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
    if (isDeepSearch) {
        setCreditActivity('Проверяем стоимость запроса...');
    }
    clearSearchResults();
    setSearchButtonsDisabled(true);

    try {
        const searchData = await fetchMangaSearch(query, mode);
        updateAccountFromBilling(searchData.billing);
        renderSearchResults(searchData.results || [], query, mode, searchData);
    } catch (error) {
        console.error(error);
        updateAccountFromSearchError(error);
        setSearchStatus('Ошибка при поиске');
        showSearchMessage(getSearchErrorMessage(error));
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
    const data = await response.json().catch(() => null);

    if (!response.ok) {
        const error = new Error((data && data.error) || `Search request failed: ${response.status}`);
        error.status = response.status;
        error.retryAfterSeconds = data && data.retryAfterSeconds;
        error.requiredCredits = data && data.requiredCredits;
        error.balance = data && data.balance;
        throw error;
    }

    return data;
}

function getSearchErrorMessage(error) {
    if (error.status === 402) {
        const required = Number.isFinite(error.requiredCredits) ? error.requiredCredits : 1;
        const balance = Number.isFinite(error.balance) ? error.balance : 0;
        return `Недостаточно кредитов: нужно ${required}, на балансе ${balance}.`;
    }

    if (error.status === 429) {
        const retryText = error.retryAfterSeconds
            ? ` Попробуй снова через ${error.retryAfterSeconds} сек.`
            : '';
        return `Слишком много глубоких запросов.${retryText}`;
    }

    if (error.status === 400) {
        return error.message || 'Проверь текст запроса.';
    }

    return 'Не получилось получить данные. Проверь, запущен ли backend.';
}

// Загружает локального пользователя и цену платного действия. HttpOnly session cookie
// создается backend и недоступна JavaScript, поэтому frontend хранит только показанные данные.
async function loadAccountState() {
    try {
        const response = await fetch('/api/me');
        const data = await response.json().catch(() => null);

        if (!response.ok || !data) {
            throw new Error((data && data.error) || 'Account request failed');
        }

        renderAccountState(data);
    } catch (error) {
        console.error(error);
        creditBalance.textContent = '—';
        deepSearchPrice.textContent = '';
        addCreditsButton.hidden = true;
        setCreditActivity('Баланс временно недоступен.');
    }
}

// Обновляет весь блок аккаунта из ответа /api/me или локального dev-пополнения.
function renderAccountState(data) {
    accountState = data;
    accountReady = true;

    const credits = Number((data.user || {}).credits);
    const user = data.user || {};
    const deepSearchCost = Number((data.pricing || {}).deepSearchCredits);
    const devTopUp = data.devTopUp || {};

    accountIdentity.textContent = user.authenticated ? user.email : 'Гость';
    accountIdentity.title = user.authenticated ? user.email : '';
    openAuthButton.hidden = Boolean(user.authenticated);
    logoutButton.hidden = !user.authenticated;
    creditBalance.textContent = Number.isFinite(credits) ? String(credits) : '0';
    deepSearchPrice.textContent = Number.isFinite(deepSearchCost)
        ? `Глубокий поиск: ${deepSearchCost}`
        : '';

    addCreditsButton.hidden = !devTopUp.enabled;
    addCreditsButton.textContent = Number.isFinite(Number(devTopUp.amount))
        ? `Тестово +${devTopUp.amount}`
        : 'Тестовое пополнение';
    deepSearchButton.disabled = searchInProgress;
}

// Локальное пополнение позволяет проверить весь платный сценарий без подключения кассы.
// В production соответствующий backend endpoint отключается автоматически.
async function addDevelopmentCredits() {
    addCreditsButton.disabled = true;
    setCreditActivity('Пополняем тестовый баланс...');

    try {
        const response = await fetch('/api/dev/add-credits', { method: 'POST' });
        const data = await response.json().catch(() => null);

        if (!response.ok || !data) {
            throw new Error((data && data.error) || 'Credit top-up failed');
        }

        renderAccountState(data);
        setCreditActivity('Тестовый баланс пополнен.');
    } catch (error) {
        console.error(error);
        setCreditActivity('Не получилось пополнить тестовый баланс.');
    } finally {
        addCreditsButton.disabled = false;
    }
}

// Открывает одну общую форму в нужном режиме. Нативный dialog удерживает фокус
// внутри окна и поддерживает закрытие клавишей Escape без отдельной библиотеки.
function openAuthDialog(mode = 'login') {
    setAuthMode(mode);
    authError.textContent = '';
    authForm.reset();
    authDialog.showModal();
    authEmail.focus();
}

// Переключает подписи, autocomplete и доступные подсказки между входом и регистрацией.
function setAuthMode(mode) {
    authMode = mode === 'register' ? 'register' : 'login';
    const isRegistration = authMode === 'register';

    authTitle.textContent = isRegistration ? 'Регистрация' : 'Вход';
    authSubmitButton.textContent = isRegistration ? 'Создать аккаунт' : 'Войти';
    authPassword.autocomplete = isRegistration ? 'new-password' : 'current-password';
    passwordHint.hidden = !isRegistration;
    authPasswordConfirmLabel.hidden = !isRegistration;
    authPasswordConfirm.hidden = !isRegistration;
    authPasswordConfirm.required = isRegistration;
    if (!isRegistration) authPasswordConfirm.value = '';
    authError.textContent = '';

    loginModeButton.classList.toggle('active', !isRegistration);
    loginModeButton.setAttribute('aria-selected', String(!isRegistration));
    registerModeButton.classList.toggle('active', isRegistration);
    registerModeButton.setAttribute('aria-selected', String(isRegistration));
}

// Отправляет только JSON с email и паролем. Успешный ответ уже содержит новый
// баланс и состояние аккаунта, поэтому дополнительный запрос /api/me не нужен.
async function submitAuthForm(event) {
    event.preventDefault();
    if (!authForm.reportValidity()) return;
    if (authMode === 'register' && authPassword.value !== authPasswordConfirm.value) {
        authError.textContent = 'Пароли не совпадают.';
        authPasswordConfirm.focus();
        return;
    }

    setAuthFormDisabled(true);
    authError.textContent = '';

    try {
        const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: authEmail.value.trim(),
                password: authPassword.value
            })
        });
        const data = await response.json().catch(() => null);

        if (!response.ok || !data) {
            const error = new Error((data && data.error) || 'Authentication failed');
            error.status = response.status;
            error.code = data && data.code;
            error.retryAfterSeconds = data && data.retryAfterSeconds;
            throw error;
        }

        renderAccountState(data);
        authDialog.close();
        authForm.reset();
        setCreditActivity(authMode === 'register' ? 'Аккаунт создан.' : 'Вход выполнен.');
    } catch (error) {
        console.error(error);
        authError.textContent = getAuthErrorMessage(error);
    } finally {
        setAuthFormDisabled(false);
    }
}

// Удаляет текущую серверную сессию, затем получает нового анонимного пользователя
// тем же способом, которым страница инициализируется при первом открытии.
async function logoutAccount() {
    logoutButton.disabled = true;
    setCreditActivity('Выходим из аккаунта...');

    try {
        const response = await fetch('/api/auth/logout', { method: 'POST' });
        if (!response.ok) throw new Error('Logout failed');

        accountReady = false;
        deepSearchButton.disabled = true;
        await loadAccountState();
        setCreditActivity('Вы вышли из аккаунта.');
    } catch (error) {
        console.error(error);
        setCreditActivity('Не получилось выйти из аккаунта.');
    } finally {
        logoutButton.disabled = false;
    }
}

function setAuthFormDisabled(disabled) {
    authEmail.disabled = disabled;
    authPassword.disabled = disabled;
    authPasswordConfirm.disabled = disabled;
    authSubmitButton.disabled = disabled;
    loginModeButton.disabled = disabled;
    registerModeButton.disabled = disabled;
    closeAuthButton.disabled = disabled;
}

function getAuthErrorMessage(error) {
    if (error.status === 401) return 'Неверный email или пароль.';
    if (error.code === 'EMAIL_IN_USE') return 'Аккаунт с таким email уже существует.';
    if (error.code === 'ACCOUNT_ALREADY_REGISTERED') return 'Этот аккаунт уже зарегистрирован.';
    if (error.status === 429) {
        const retryText = error.retryAfterSeconds ? ` Повтори через ${error.retryAfterSeconds} сек.` : '';
        return `Слишком много попыток.${retryText}`;
    }
    if (error.status === 400) {
        if (error.message.includes('at least')) return 'Пароль должен содержать минимум 15 символов.';
        if (error.message.includes('no more')) return 'Пароль не должен быть длиннее 128 символов.';
        if (error.message.includes('email')) return 'Введи корректный email.';
    }

    return 'Не получилось выполнить запрос. Попробуй еще раз.';
}

// Backend возвращает billing отдельно от общего поискового результата. Так frontend
// сразу показывает реальное списание, бесплатный кэш или возврат при техническом сбое.
function updateAccountFromBilling(billing) {
    if (!billing) return;

    updateDisplayedCreditBalance(billing.balance);

    if (billing.chargedCredits > 0) {
        setCreditActivity(`Списано: ${billing.chargedCredits}.`);
        return;
    }

    const messages = {
        cache_hit: 'Списано: 0. Результат получен из кэша.',
        shared_request: 'Списано: 0. Использован уже выполняющийся запрос.',
        source_failure: 'Списано: 0. Источники не ответили, credit возвращен.'
    };
    setCreditActivity(messages[billing.reason] || 'Списано: 0.');
}

// После ошибки синхронизирует известный баланс, чтобы 402 сразу отображался
// корректно и не требовал дополнительного запроса к /api/me.
function updateAccountFromSearchError(error) {
    if (Number.isFinite(error.balance)) {
        updateDisplayedCreditBalance(error.balance);
    }

    if (error.status === 402) {
        setCreditActivity('Недостаточно кредитов для нового глубокого поиска.');
    }
}

// Меняет число в блоке баланса и локальную копию состояния аккаунта.
function updateDisplayedCreditBalance(value) {
    const credits = Number(value);
    if (!Number.isFinite(credits)) return;

    creditBalance.textContent = String(credits);
    if (accountState && accountState.user) {
        accountState.user.credits = credits;
    }
}

// Пишет короткий результат последней операции в aria-live область баланса.
function setCreditActivity(text) {
    creditActivity.textContent = text;
}

// Меняет предпочтительный язык перевода.
// Если результаты уже показаны, сразу повторяем поиск с тем же режимом.
function setPreferredLanguage(language) {
    preferredLanguage = language;

    languageButtons.forEach(button => {
        button.classList.toggle('active', button.dataset.language === language);
    });

    const results = document.getElementById('results');
    if (
        lastSearchMode === 'normal'
        && results.style.display !== 'none'
        && searchInput.value.trim() !== ''
    ) {
        runSearch(lastSearchMode);
    } else if (lastSearchMode === 'deep' && results.style.display !== 'none') {
        setCreditActivity('Язык изменен. Повторный глубокий поиск запускается отдельно.');
    }
}

// Блокирует поиск и смену языка, пока backend еще отвечает, чтобы один жест
// пользователя случайно не создал несколько платных глубоких запросов.
function setSearchButtonsDisabled(disabled) {
    searchInProgress = disabled;
    searchButton.disabled = disabled;
    deepSearchButton.disabled = disabled || !accountReady;
    languageButtons.forEach(button => {
        button.disabled = disabled;
    });
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

    card.appendChild(createMangaCoverElement(manga));

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

function createMangaCoverElement(manga) {
    if (manga.coverUrl) {
        const cover = document.createElement('img');
        cover.className = 'manga-cover';
        cover.src = manga.coverUrl;
        cover.alt = `Обложка ${manga.title}`;
        return cover;
    }

    const placeholder = document.createElement('div');
    placeholder.className = 'manga-cover manga-cover-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    return placeholder;
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

        const links = createSourceLinks(source);
        if (links) {
            row.appendChild(links);
        }

        list.appendChild(row);
    });

    container.appendChild(list);
}

function createSourceLinks(source) {
    const links = document.createElement('div');
    links.className = 'source-links';

    if (source.url) {
        links.appendChild(createSourceLink(source.url, 'Открыть'));
    }

    if (source.fallbackUrl && source.fallbackUrl !== source.url) {
        links.appendChild(createSourceLink(source.fallbackUrl, 'Поиск'));
    }

    return links.childElementCount > 0 ? links : null;
}

function createSourceLink(url, text) {
    const link = document.createElement('a');
    link.className = 'chapter-button source-open-link';
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = text;

    return link;
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
        fallbackUrl: source.fallbackUrl || '',
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

// Тестовое пополнение показывается только когда backend разрешил dev-режим.
addCreditsButton.addEventListener('click', addDevelopmentCredits);

// Открытие, переключение режима и закрытие формы аккаунта.
openAuthButton.addEventListener('click', () => openAuthDialog('login'));
logoutButton.addEventListener('click', logoutAccount);
closeAuthButton.addEventListener('click', () => authDialog.close());
loginModeButton.addEventListener('click', () => setAuthMode('login'));
registerModeButton.addEventListener('click', () => setAuthMode('register'));
authForm.addEventListener('submit', submitAuthForm);

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

// При открытии страницы сразу получаем локальную сессию и актуальный баланс.
loadAccountState();
