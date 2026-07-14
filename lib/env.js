const fs = require('node:fs');

// Загружает простой KEY=value файл без внешней зависимости dotenv.
// Уже заданные переменные окружения имеют приоритет над локальным файлом.
function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return;

    const envText = fs.readFileSync(filePath, 'utf8');

    for (const line of envText.split(/\r?\n/)) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith('#')) continue;

        const separatorIndex = trimmedLine.indexOf('=');
        if (separatorIndex === -1) continue;

        const key = trimmedLine.slice(0, separatorIndex).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) {
            continue;
        }

        const value = trimmedLine.slice(separatorIndex + 1).trim();
        process.env[key] = stripEnvQuotes(value);
    }
}

// Позволяет использовать в .env значения в одинарных или двойных кавычках.
function stripEnvQuotes(value) {
    if (value.length < 2) return value;

    const firstChar = value[0];
    const lastChar = value[value.length - 1];

    if ((firstChar === '"' && lastChar === '"') || (firstChar === "'" && lastChar === "'")) {
        return value.slice(1, -1);
    }

    return value;
}

module.exports = { loadEnvFile };
