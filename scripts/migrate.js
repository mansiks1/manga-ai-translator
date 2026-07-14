const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { loadEnvFile } = require('../lib/env');

const PROJECT_DIR = path.join(__dirname, '..');
const MIGRATIONS_DIR = path.join(PROJECT_DIR, 'db', 'migrations');

loadEnvFile(path.join(PROJECT_DIR, '.env'));

// Применяет каждый SQL-файл ровно один раз и фиксирует его имя в schema_migrations.
// Advisory lock не позволяет двум запущенным серверам мигрировать одну базу одновременно.
async function migrate() {
    const databaseUrl = process.env.DATABASE_URL || '';
    if (!databaseUrl) {
        throw new Error('DATABASE_URL is required for PostgreSQL migrations');
    }

    const pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();

    try {
        await client.query("SELECT pg_advisory_lock(hashtext('manga_ai_translator_migrations'))");
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                filename TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        const files = (await fs.readdir(MIGRATIONS_DIR))
            .filter(fileName => fileName.endsWith('.sql'))
            .sort();
        const appliedResult = await client.query('SELECT filename FROM schema_migrations');
        const appliedFiles = new Set(appliedResult.rows.map(row => row.filename));

        for (const fileName of files) {
            if (appliedFiles.has(fileName)) continue;

            const sql = await fs.readFile(path.join(MIGRATIONS_DIR, fileName), 'utf8');
            await client.query('BEGIN');

            try {
                await client.query(sql);
                await client.query(
                    'INSERT INTO schema_migrations (filename) VALUES ($1)',
                    [fileName]
                );
                await client.query('COMMIT');
                console.log(`Applied migration: ${fileName}`);
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
        }
    } finally {
        await client.query("SELECT pg_advisory_unlock(hashtext('manga_ai_translator_migrations'))")
            .catch(() => {});
        client.release();
        await pool.end();
    }
}

migrate().catch(error => {
    console.error(`Migration failed: ${error.message}`);
    process.exitCode = 1;
});
