const crypto = require('node:crypto');

class InsufficientCreditsError extends Error {
    constructor(balance) {
        super('Insufficient credits');
        this.name = 'InsufficientCreditsError';
        this.code = 'INSUFFICIENT_CREDITS';
        this.balance = Number(balance) || 0;
    }
}

class AccountConflictError extends Error {
    constructor(code) {
        super(code === 'EMAIL_IN_USE' ? 'Email is already in use' : 'Account is already registered');
        this.name = 'AccountConflictError';
        this.code = code;
    }
}

// Выбирает постоянное PostgreSQL-хранилище только при наличии DATABASE_URL.
// Без него локальная разработка продолжает работать полностью в памяти.
function createAccountStore(options = {}) {
    if (options.databaseUrl) {
        return new PostgresAccountStore(options);
    }

    return new MemoryAccountStore();
}

class MemoryAccountStore {
    constructor() {
        this.kind = 'memory';
        this.persistent = false;
        this.users = new Map();
        this.sessions = new Map();
        this.userIdsByEmail = new Map();
        this.creditLedger = [];
        this.ledgerByIdempotencyKey = new Map();
    }

    // Для памяти инициализация и закрытие не требуют внешних ресурсов.
    async initialize() {}

    async close() {}

    // Возвращает копию пользователя, чтобы обработчик запроса не мог случайно
    // изменить сохраненный баланс в обход журнала операций.
    async findUserBySession(sessionHash) {
        const session = this.sessions.get(sessionHash);
        if (session && new Date(session.expiresAt).getTime() <= Date.now()) {
            this.sessions.delete(sessionHash);
            return null;
        }

        const user = session ? this.users.get(session.userId) : null;
        if (!user) return null;

        user.lastSeenAt = new Date().toISOString();
        return cloneUser(user);
    }

    // Создает анонимного пользователя и первую сессию как одну синхронную операцию.
    async createSessionUser(options) {
        const now = new Date().toISOString();
        const user = {
            id: options.userId,
            email: null,
            credits: 0,
            createdAt: now,
            updatedAt: now,
            lastSeenAt: now
        };

        this.users.set(user.id, user);
        this.sessions.set(options.sessionHash, {
            userId: user.id,
            expiresAt: options.expiresAt
        });

        if (options.initialCredits > 0) {
            await this.changeCredits(user.id, options.initialCredits, {
                reason: 'initial_grant',
                referenceType: 'session',
                idempotencyKey: `initial_grant:${user.id}`
            });
        }

        return this.findUserBySession(options.sessionHash);
    }

    // Превращает текущего анонимного пользователя в зарегистрированного, поэтому
    // накопленные credits и история операций остаются привязаны к тому же userId.
    async registerUser(userId, email, passwordHash) {
        const user = this.users.get(userId);
        if (!user) throw new Error('Account user was not found');
        if (user.email) throw new AccountConflictError('ACCOUNT_ALREADY_REGISTERED');

        const normalizedEmail = normalizeEmail(email);
        if (this.userIdsByEmail.has(normalizedEmail)) {
            throw new AccountConflictError('EMAIL_IN_USE');
        }

        user.email = normalizedEmail;
        user.passwordHash = passwordHash;
        user.updatedAt = new Date().toISOString();
        this.userIdsByEmail.set(normalizedEmail, user.id);
        return cloneUser(user);
    }

    // Возвращает passwordHash только внутреннему обработчику входа. Публичный
    // account payload собирается отдельно и никогда не включает это поле.
    async findAuthUserByEmail(email) {
        const userId = this.userIdsByEmail.get(normalizeEmail(email));
        return cloneUser(userId ? this.users.get(userId) : null);
    }

    // Создает новую сессию для существующего пользователя. Она нужна для ротации
    // токена после регистрации и каждого успешного входа.
    async createSessionForUser(options) {
        if (!this.users.has(options.userId)) {
            throw new Error('Account user was not found');
        }

        this.sessions.set(options.sessionHash, {
            userId: options.userId,
            expiresAt: options.expiresAt
        });
        return this.findUserBySession(options.sessionHash);
    }

    // Удаляет серверную часть сессии: одной очистки cookie недостаточно, потому
    // что украденный токен иначе оставался бы действительным до истечения срока.
    async deleteSession(sessionHash) {
        this.sessions.delete(sessionHash);
    }

    // В памяти операция выполняется без await между проверкой и записью, поэтому
    // два запроса в одном Node.js процессе не могут создать отрицательный баланс.
    async changeCredits(userId, delta, details = {}) {
        validateCreditDelta(delta);
        const idempotencyKey = getIdempotencyKey(details);
        const existingEntry = this.ledgerByIdempotencyKey.get(idempotencyKey);

        if (existingEntry) {
            if (existingEntry.userId !== userId) {
                throw new Error('Idempotency key belongs to another user');
            }

            return {
                applied: false,
                user: cloneUser(this.users.get(userId)),
                ledgerEntry: { ...existingEntry }
            };
        }

        const user = this.users.get(userId);
        if (!user) throw new Error('Account user was not found');

        const nextBalance = user.credits + delta;
        if (nextBalance < 0) {
            throw new InsufficientCreditsError(user.credits);
        }

        user.credits = nextBalance;
        user.updatedAt = new Date().toISOString();

        const ledgerEntry = createLedgerEntry(user, delta, details, idempotencyKey);
        this.creditLedger.push(ledgerEntry);
        this.ledgerByIdempotencyKey.set(idempotencyKey, ledgerEntry);

        return {
            applied: true,
            user: cloneUser(user),
            ledgerEntry: { ...ledgerEntry }
        };
    }
}

class PostgresAccountStore {
    constructor(options) {
        const { Pool } = require('pg');

        this.kind = 'postgres';
        this.persistent = true;
        this.pool = new Pool({ connectionString: options.databaseUrl });
    }

    // Проверяет не только соединение, но и наличие миграций до начала приема запросов.
    async initialize() {
        const result = await this.pool.query(`
            SELECT to_regclass('public.users') AS users_table,
                   to_regclass('public.user_sessions') AS sessions_table,
                   to_regclass('public.credit_ledger') AS ledger_table,
                   to_regclass('public.users_email_lower_unique_idx') AS auth_email_index
        `);
        const schema = result.rows[0];
        if (
            !schema.users_table
            || !schema.sessions_table
            || !schema.ledger_table
            || !schema.auth_email_index
        ) {
            throw new Error('PostgreSQL schema is missing. Run: npm.cmd run db:migrate');
        }
    }

    // Освобождает пул соединений при завершении или ошибке запуска сервера.
    async close() {
        await this.pool.end();
    }

    // Одним CTE обновляет last_seen_at и возвращает пользователя только для живой сессии.
    async findUserBySession(sessionHash) {
        const result = await this.pool.query(`
            WITH touched_session AS (
                UPDATE user_sessions
                SET last_seen_at = NOW()
                WHERE token_hash = $1 AND expires_at > NOW()
                RETURNING user_id, last_seen_at
            )
            SELECT u.id, u.email, u.credits_balance, u.created_at, u.updated_at,
                   touched_session.last_seen_at
            FROM touched_session
            JOIN users u ON u.id = touched_session.user_id
        `, [sessionHash]);

        return result.rows[0] ? mapPostgresUser(result.rows[0]) : null;
    }

    // Пользователь, сессия и стартовое начисление создаются в одной транзакции.
    async createSessionUser(options) {
        const client = await this.pool.connect();

        try {
            await client.query('BEGIN');
            const userResult = await client.query(`
                INSERT INTO users (id, email, credits_balance)
                VALUES ($1, NULL, $2)
                RETURNING id, email, credits_balance, created_at, updated_at
            `, [options.userId, options.initialCredits]);

            await client.query(`
                INSERT INTO user_sessions (id, user_id, token_hash, expires_at)
                VALUES ($1, $2, $3, $4)
            `, [crypto.randomUUID(), options.userId, options.sessionHash, options.expiresAt]);

            if (options.initialCredits > 0) {
                await client.query(`
                    INSERT INTO credit_ledger (
                        id, user_id, delta, balance_after, reason,
                        reference_type, reference_id, idempotency_key
                    )
                    VALUES ($1, $2, $3, $3, 'initial_grant', 'session', NULL, $4)
                `, [
                    crypto.randomUUID(),
                    options.userId,
                    options.initialCredits,
                    `initial_grant:${options.userId}`
                ]);
            }

            await client.query('COMMIT');
            return mapPostgresUser({
                ...userResult.rows[0],
                last_seen_at: new Date()
            });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    // Регистрирует текущего анонимного пользователя внутри транзакции. UPDATE
    // сохраняет его баланс и ledger, меняя только учетные данные аккаунта.
    async registerUser(userId, email, passwordHash) {
        const client = await this.pool.connect();

        try {
            await client.query('BEGIN');
            const currentResult = await client.query(`
                SELECT id, email
                FROM users
                WHERE id = $1
                FOR UPDATE
            `, [userId]);

            if (!currentResult.rows[0]) {
                throw new Error('Account user was not found');
            }
            if (currentResult.rows[0].email) {
                throw new AccountConflictError('ACCOUNT_ALREADY_REGISTERED');
            }

            const updatedResult = await client.query(`
                UPDATE users
                SET email = $2, password_hash = $3, updated_at = NOW()
                WHERE id = $1
                RETURNING id, email, credits_balance, created_at, updated_at
            `, [userId, normalizeEmail(email), passwordHash]);

            await client.query('COMMIT');
            return mapPostgresUser(updatedResult.rows[0]);
        } catch (error) {
            await client.query('ROLLBACK');
            if (error.code === '23505') {
                throw new AccountConflictError('EMAIL_IN_USE');
            }
            throw error;
        } finally {
            client.release();
        }
    }

    // Ищет учетные данные по регистронезависимому индексу email. passwordHash
    // используется только для проверки пароля и не попадает в ответы API.
    async findAuthUserByEmail(email) {
        const result = await this.pool.query(`
            SELECT id, email, password_hash, credits_balance, created_at, updated_at
            FROM users
            WHERE LOWER(email) = LOWER($1)
            LIMIT 1
        `, [normalizeEmail(email)]);
        const row = result.rows[0];
        return row ? { ...mapPostgresUser(row), passwordHash: row.password_hash } : null;
    }

    // Создает свежую сессию после подтверждения учетных данных и возвращает
    // актуального пользователя из той же базы.
    async createSessionForUser(options) {
        await this.pool.query(`
            INSERT INTO user_sessions (id, user_id, token_hash, expires_at)
            VALUES ($1, $2, $3, $4)
        `, [crypto.randomUUID(), options.userId, options.sessionHash, options.expiresAt]);

        return this.findUserBySession(options.sessionHash);
    }

    // Немедленно отзывает конкретную сессию при выходе или ротации cookie.
    async deleteSession(sessionHash) {
        await this.pool.query('DELETE FROM user_sessions WHERE token_hash = $1', [sessionHash]);
    }

    // FOR UPDATE сериализует изменения одного баланса. Проверка, обновление пользователя
    // и запись ledger выполняются атомарно и защищены idempotency key.
    async changeCredits(userId, delta, details = {}) {
        validateCreditDelta(delta);
        const idempotencyKey = getIdempotencyKey(details);
        const client = await this.pool.connect();

        try {
            await client.query('BEGIN');
            const userResult = await client.query(`
                SELECT id, email, credits_balance, created_at, updated_at
                FROM users
                WHERE id = $1
                FOR UPDATE
            `, [userId]);

            if (!userResult.rows[0]) {
                throw new Error('Account user was not found');
            }

            const existingResult = await client.query(`
                SELECT id, user_id, delta, balance_after, reason, reference_type,
                       reference_id, idempotency_key, created_at
                FROM credit_ledger
                WHERE idempotency_key = $1
            `, [idempotencyKey]);

            if (existingResult.rows[0]) {
                if (existingResult.rows[0].user_id !== userId) {
                    throw new Error('Idempotency key belongs to another user');
                }

                await client.query('COMMIT');
                return {
                    applied: false,
                    user: mapPostgresUser(userResult.rows[0]),
                    ledgerEntry: mapPostgresLedgerEntry(existingResult.rows[0])
                };
            }

            const currentBalance = Number(userResult.rows[0].credits_balance);
            const nextBalance = currentBalance + delta;
            if (nextBalance < 0) {
                throw new InsufficientCreditsError(currentBalance);
            }

            const updatedResult = await client.query(`
                UPDATE users
                SET credits_balance = $2, updated_at = NOW()
                WHERE id = $1
                RETURNING id, email, credits_balance, created_at, updated_at
            `, [userId, nextBalance]);

            const ledgerResult = await client.query(`
                INSERT INTO credit_ledger (
                    id, user_id, delta, balance_after, reason,
                    reference_type, reference_id, idempotency_key
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id, user_id, delta, balance_after, reason, reference_type,
                          reference_id, idempotency_key, created_at
            `, [
                crypto.randomUUID(),
                userId,
                delta,
                nextBalance,
                details.reason || 'adjustment',
                details.referenceType || null,
                details.referenceId || null,
                idempotencyKey
            ]);

            await client.query('COMMIT');
            return {
                applied: true,
                user: mapPostgresUser(updatedResult.rows[0]),
                ledgerEntry: mapPostgresLedgerEntry(ledgerResult.rows[0])
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

// Не позволяет случайно записать дробную или пустую операцию в credit ledger.
function validateCreditDelta(delta) {
    if (!Number.isInteger(delta) || delta === 0) {
        throw new Error('Credit delta must be a non-zero integer');
    }
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

// Сгенерированный ключ подходит для обычной операции, а платежи и задачи передают
// собственный стабильный ключ, чтобы безопасно повторять запрос после сетевой ошибки.
function getIdempotencyKey(details) {
    return details.idempotencyKey || crypto.randomUUID();
}

// Приводит запись memory ledger к тому же формату, который возвращает PostgreSQL.
function createLedgerEntry(user, delta, details, idempotencyKey) {
    return {
        id: crypto.randomUUID(),
        userId: user.id,
        delta,
        balanceAfter: user.credits,
        reason: details.reason || 'adjustment',
        referenceType: details.referenceType || null,
        referenceId: details.referenceId || null,
        idempotencyKey,
        createdAt: new Date().toISOString()
    };
}

// Не отдает наружу ссылку на изменяемый объект из Map.
function cloneUser(user) {
    return user ? { ...user } : null;
}

// Преобразует snake_case и PostgreSQL timestamp в публичный формат accountStore.
function mapPostgresUser(row) {
    return {
        id: row.id,
        email: row.email || null,
        credits: Number(row.credits_balance),
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
        lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null
    };
}

// Приводит строку credit_ledger из PostgreSQL к формату memory-хранилища.
function mapPostgresLedgerEntry(row) {
    return {
        id: row.id,
        userId: row.user_id,
        delta: Number(row.delta),
        balanceAfter: Number(row.balance_after),
        reason: row.reason,
        referenceType: row.reference_type,
        referenceId: row.reference_id,
        idempotencyKey: row.idempotency_key,
        createdAt: new Date(row.created_at).toISOString()
    };
}

module.exports = {
    AccountConflictError,
    InsufficientCreditsError,
    MemoryAccountStore,
    PostgresAccountStore,
    createAccountStore
};
