const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    AccountConflictError,
    InsufficientCreditsError,
    MemoryAccountStore
} = require('../lib/account-store');

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

test('registers the anonymous user without losing credits', async () => {
    const { store, user } = await createTestAccount(7);
    const registeredUser = await store.registerUser(
        user.id,
        'Reader@Example.com',
        'stored-password-hash'
    );
    const authUser = await store.findAuthUserByEmail('reader@example.com');

    assert.equal(registeredUser.id, user.id);
    assert.equal(registeredUser.credits, 7);
    assert.equal(registeredUser.email, 'reader@example.com');
    assert.equal(authUser.passwordHash, 'stored-password-hash');
});

test('prevents duplicate case-insensitive email registrations', async () => {
    const first = await createTestAccount();
    const secondUser = await first.store.createSessionUser({
        userId: crypto.randomUUID(),
        sessionHash: crypto.randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        initialCredits: 0
    });

    await first.store.registerUser(first.user.id, 'reader@example.com', 'hash-one');
    await assert.rejects(
        first.store.registerUser(secondUser.id, 'READER@example.com', 'hash-two'),
        error => error instanceof AccountConflictError && error.code === 'EMAIL_IN_USE'
    );
});

test('creates and revokes a rotated session', async () => {
    const { store, sessionHash, user } = await createTestAccount();
    const rotatedHash = crypto.randomBytes(32).toString('hex');

    await store.createSessionForUser({
        userId: user.id,
        sessionHash: rotatedHash,
        expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    await store.deleteSession(sessionHash);

    assert.equal(await store.findUserBySession(sessionHash), null);
    assert.equal((await store.findUserBySession(rotatedHash)).id, user.id);
});
