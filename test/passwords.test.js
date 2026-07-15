const test = require('node:test');
const assert = require('node:assert/strict');
const {
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    hashPassword,
    validatePassword,
    verifyPassword
} = require('../lib/passwords');

test('hashes and verifies a password without storing the original value', async () => {
    const password = 'correct horse battery staple';
    const passwordHash = await hashPassword(password);

    assert.notEqual(passwordHash, password);
    assert.match(passwordHash, /^scrypt\$/);
    assert.equal(await verifyPassword(password, passwordHash), true);
    assert.equal(await verifyPassword('different password value', passwordHash), false);
});

test('enforces password length without composition rules', () => {
    assert.equal(validatePassword('a'.repeat(PASSWORD_MIN_LENGTH - 1)).valid, false);
    assert.equal(validatePassword('ф'.repeat(PASSWORD_MIN_LENGTH)).valid, true);
    assert.equal(validatePassword('a'.repeat(PASSWORD_MAX_LENGTH + 1)).valid, false);
});

test('spends a normal verification pass on a missing hash', async () => {
    assert.equal(await verifyPassword('unknown account password', null), false);
});
