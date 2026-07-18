const SEARCH_CACHE_SCOPES = Object.freeze({
    NORMAL_RESULT: 'normal-result',
    DEEP_RESULT: 'deep-result',
    DEEP_SOURCE_QUERY: 'deep-source-query',
    AI_PLAN: 'ai-plan'
});

// Включает в ключ назначение поиска и язык. Поэтому один и тот же текст в
// обычном/глубоком режимах или с RU/EN никогда не обращается к одной записи.
function getSearchCacheKey(scope, query, preferredLanguage) {
    const normalizedScope = String(scope || '').trim();
    if (!normalizedScope) {
        throw new TypeError('Search cache scope is required');
    }

    return JSON.stringify([
        normalizedScope,
        normalizeSearchLanguage(preferredLanguage),
        normalizeSearchQuery(query).toLowerCase()
    ]);
}

// Пустой язык означает режим "Все" и получает стабильное имя в ключе кэша.
function normalizeSearchLanguage(value) {
    return String(value || '').trim().toLowerCase() || 'all';
}

// Одинаково нормализует запрос перед внешним API и перед построением cache key.
function normalizeSearchQuery(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^["'`]+|["'`]+$/g, '')
        .trim();
}

module.exports = {
    SEARCH_CACHE_SCOPES,
    getSearchCacheKey,
    normalizeSearchLanguage,
    normalizeSearchQuery
};
