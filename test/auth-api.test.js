const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const PROJECT_DIR = path.join(__dirname, '..');

// Запускает отдельный сервер с memory store, чтобы интеграционный тест не менял
// локальную PostgreSQL пользователя и не зависел от ее доступности.
async function startTestServer() {
    const port = 45_000 + Math.floor(Math.random() * 10_000);
    const child = spawn(process.execPath, ['server.js'], {
        cwd: PROJECT_DIR,
        env: {
            ...process.env,
            PORT: String(port),
            DATABASE_URL: '',
            INITIAL_USER_CREDITS: '4',
            AUTH_RATE_LIMIT_MAX: '100',
            DEV_CREDIT_TOP_UP_ENABLED: 'false'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Test server startup timed out')), 10_000);
        let stderr = '';

        child.stderr.on('data', chunk => {
            stderr += chunk.toString();
        });
        child.stdout.on('data', chunk => {
            if (!chunk.toString().includes('Server is running:')) return;
            clearTimeout(timeout);
            resolve();
        });
        child.once('exit', code => {
            clearTimeout(timeout);
            reject(new Error(`Test server exited with code ${code}: ${stderr}`));
        });
        child.once('error', error => {
            clearTimeout(timeout);
            reject(error);
        });
    });

    return { child, baseUrl: `http://127.0.0.1:${port}` };
}

function getSessionCookie(response) {
    return String(response.headers.get('set-cookie') || '').split(';')[0];
}

async function sendCredentials(baseUrl, endpoint, cookie, email, password) {
    return fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Cookie: cookie
        },
        body: JSON.stringify({ email, password })
    });
}

test('registers, logs out, and logs back into the same credited account', { timeout: 30_000 }, async t => {
    const { child, baseUrl } = await startTestServer();
    t.after(() => child.kill());

    const guestResponse = await fetch(`${baseUrl}/api/me`);
    const guest = await guestResponse.json();
    const guestCookie = getSessionCookie(guestResponse);

    assert.equal(guest.user.authenticated, false);
    assert.equal(guest.user.credits, 4);
    assert.ok(guestCookie.startsWith('manga_session='));

    const password = 'correct horse battery staple';
    const registerResponse = await sendCredentials(
        baseUrl,
        '/api/auth/register',
        guestCookie,
        'Reader@Example.com',
        password
    );
    const registered = await registerResponse.json();
    const accountCookie = getSessionCookie(registerResponse);

    assert.equal(registerResponse.status, 201);
    assert.equal(registered.user.id, guest.user.id);
    assert.equal(registered.user.email, 'reader@example.com');
    assert.equal(registered.user.credits, 4);
    assert.notEqual(accountCookie, guestCookie);

    const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { Cookie: accountCookie }
    });
    assert.equal(logoutResponse.status, 200);

    const afterLogoutResponse = await fetch(`${baseUrl}/api/me`, {
        headers: { Cookie: accountCookie }
    });
    const afterLogout = await afterLogoutResponse.json();
    const anonymousCookie = getSessionCookie(afterLogoutResponse);
    assert.equal(afterLogout.user.authenticated, false);
    assert.notEqual(afterLogout.user.id, registered.user.id);

    const invalidLoginResponse = await sendCredentials(
        baseUrl,
        '/api/auth/login',
        anonymousCookie,
        'reader@example.com',
        'this password is incorrect'
    );
    assert.equal(invalidLoginResponse.status, 401);
    assert.equal((await invalidLoginResponse.json()).error, 'Invalid email or password');

    const loginResponse = await sendCredentials(
        baseUrl,
        '/api/auth/login',
        anonymousCookie,
        'reader@example.com',
        password
    );
    const loggedIn = await loginResponse.json();

    assert.equal(loginResponse.status, 200);
    assert.equal(loggedIn.user.id, registered.user.id);
    assert.equal(loggedIn.user.credits, 4);
    assert.equal(loggedIn.user.authenticated, true);
});
