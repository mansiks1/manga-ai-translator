const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { InsufficientCreditsError, MemoryAccountStore } = require('../lib/account-store');

// Создает независимого пользователя для каждого теста и возвращает его вместе с store.
async function createTestAccount(initialCredits = 1) {
    const store = new MemoryAccountStore();
    const sessionHash = crypto.randomBytes(32).toString('hex');
    const user = await store.createSessionUser({
        userId: crypto.randomUUID(),
        sessionHash,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        initialCredits
    });

    return { store, sessionHash, user };
}

test('restores a user by hashed session token', async () => {
    const { store, sessionHash, user } = await createTestAccount(3);
    const restoredUser = await store.findUserBySession(sessionHash);

    assert.equal(restoredUser.id, user.id);
    assert.equal(restoredUser.credits, 3);
});

test('applies an idempotent credit change only once', async () => {
    const { store, user } = await createTestAccount(2);
    const details = {
        reason: 'deep_search',
        idempotencyKey: 'deep-search-test-charge'
    };

    const first = await store.changeCredits(user.id, -1, details);
    const repeated = await store.changeCredits(user.id, -1, details);

    assert.equal(first.applied, true);
    assert.equal(repeated.applied, false);
    assert.equal(repeated.user.credits, 1);
});

test('never allows concurrent charges to make a balance negative', async () => {
    const { store, user } = await createTestAccount(1);
    const results = await Promise.allSettled([
        store.changeCredits(user.id, -1, { idempotencyKey: 'parallel-charge-a' }),
        store.changeCredits(user.id, -1, { idempotencyKey: 'parallel-charge-b' })
    ]);

    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    assert.ok(results.find(result => result.status === 'rejected').reason instanceof InsufficientCreditsError);

    const currentUser = store.users.get(user.id);
    assert.equal(currentUser.credits, 0);
});
