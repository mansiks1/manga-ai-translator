const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scryptAsync = promisify(crypto.scrypt);
const PASSWORD_MIN_LENGTH = 15;
const PASSWORD_MAX_LENGTH = 128;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = {
    N: 2 ** 15,
    r: 8,
    p: 3,
    maxmem: 64 * 1024 * 1024
};
const DUMMY_PASSWORD_HASH = serializePasswordHash(
    Buffer.alloc(16),
    Buffer.alloc(SCRYPT_KEY_LENGTH)
);

// Проверяет только длину пароля. Сложные правила по составу обычно заставляют
// пользователей выбирать предсказуемые пароли и мешают использовать менеджеры паролей.
function validatePassword(password) {
    if (typeof password !== 'string') {
        return { valid: false, error: 'Password must be a string' };
    }

    const length = Array.from(password).length;
    if (length < PASSWORD_MIN_LENGTH) {
        return {
            valid: false,
            error: `Password must contain at least ${PASSWORD_MIN_LENGTH} characters`
        };
    }

    if (length > PASSWORD_MAX_LENGTH) {
        return {
            valid: false,
            error: `Password must contain no more than ${PASSWORD_MAX_LENGTH} characters`
        };
    }

    return { valid: true, error: null };
}

// Создает уникальный scrypt-хэш с солью. В базу сохраняется эта строка,
// а восстановить из нее исходный пароль невозможно.
async function hashPassword(password) {
    const validation = validatePassword(password);
    if (!validation.valid) {
        throw new TypeError(validation.error);
    }

    const salt = crypto.randomBytes(16);
    const derivedKey = await deriveKey(password, salt);
    return serializePasswordHash(salt, derivedKey);
}

// Повторяет scrypt с параметрами из сохраненной строки и сравнивает результат
// за постоянное время, чтобы не выдавать совпавшие байты по времени ответа.
async function verifyPassword(password, storedHash) {
    const parsed = parsePasswordHash(storedHash || DUMMY_PASSWORD_HASH);
    if (!parsed) {
        await deriveKey(String(password || ''), Buffer.alloc(16));
        return false;
    }

    const derivedKey = await deriveKey(String(password || ''), parsed.salt, parsed.options);
    return derivedKey.length === parsed.hash.length
        && crypto.timingSafeEqual(derivedKey, parsed.hash);
}

// Выносит дорогую операцию в один helper, чтобы регистрация и вход всегда
// использовали одинаковые параметры scrypt.
function deriveKey(password, salt, options = SCRYPT_OPTIONS) {
    return scryptAsync(password, salt, SCRYPT_KEY_LENGTH, options);
}

function serializePasswordHash(salt, hash) {
    return [
        'scrypt',
        SCRYPT_OPTIONS.N,
        SCRYPT_OPTIONS.r,
        SCRYPT_OPTIONS.p,
        salt.toString('base64url'),
        hash.toString('base64url')
    ].join('$');
}

// Разбирает только известный формат и ограничивает параметры, чтобы поврежденная
// строка из базы не заставила сервер выделить произвольный объем памяти.
function parsePasswordHash(value) {
    const [algorithm, nValue, rValue, pValue, saltValue, hashValue, extra] = String(value || '').split('$');
    const N = Number(nValue);
    const r = Number(rValue);
    const p = Number(pValue);

    if (
        extra !== undefined
        || algorithm !== 'scrypt'
        || N !== SCRYPT_OPTIONS.N
        || r !== SCRYPT_OPTIONS.r
        || p !== SCRYPT_OPTIONS.p
    ) {
        return null;
    }

    try {
        const salt = Buffer.from(saltValue, 'base64url');
        const hash = Buffer.from(hashValue, 'base64url');
        if (salt.length !== 16 || hash.length !== SCRYPT_KEY_LENGTH) return null;

        return { salt, hash, options: SCRYPT_OPTIONS };
    } catch {
        return null;
    }
}

module.exports = {
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    hashPassword,
    validatePassword,
    verifyPassword
};
