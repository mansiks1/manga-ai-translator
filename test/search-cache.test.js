const test = require('node:test');
const assert = require('node:assert/strict');
const {
    SEARCH_CACHE_SCOPES,
    getSearchCacheKey
} = require('../lib/search-cache');

test('separates normal, deep result, and deep source-query cache keys', () => {
    const query = 'Vagabond';
    const language = 'ru';
    const keys = new Set([
        getSearchCacheKey(SEARCH_CACHE_SCOPES.NORMAL_RESULT, query, language),
        getSearchCacheKey(SEARCH_CACHE_SCOPES.DEEP_RESULT, query, language),
        getSearchCacheKey(SEARCH_CACHE_SCOPES.DEEP_SOURCE_QUERY, query, language)
    ]);

    assert.equal(keys.size, 3);
});

test('separates the same mode and query by preferred language', () => {
    const russianKey = getSearchCacheKey(
        SEARCH_CACHE_SCOPES.DEEP_RESULT,
        'Vagabond',
        'ru'
    );
    const englishKey = getSearchCacheKey(
        SEARCH_CACHE_SCOPES.DEEP_RESULT,
        'Vagabond',
        'en'
    );
    const allLanguagesKey = getSearchCacheKey(
        SEARCH_CACHE_SCOPES.DEEP_RESULT,
        'Vagabond',
        ''
    );

    assert.notEqual(russianKey, englishKey);
    assert.notEqual(russianKey, allLanguagesKey);
    assert.notEqual(englishKey, allLanguagesKey);
});

test('normalizes harmless query formatting inside one cache scope', () => {
    const firstKey = getSearchCacheKey(
        SEARCH_CACHE_SCOPES.NORMAL_RESULT,
        '  "Vagabond   Manga"  ',
        'RU'
    );
    const secondKey = getSearchCacheKey(
        SEARCH_CACHE_SCOPES.NORMAL_RESULT,
        'vagabond manga',
        'ru'
    );

    assert.equal(firstKey, secondKey);
});
