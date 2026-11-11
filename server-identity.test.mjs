// server-identity.test.mjs — a Playwright run never tests a server that serves a DIFFERENT checkout.
//
// e2e/dev-server.mjs derives the dev server's port from the checkout's path, and every local config
// reuses whatever server already answers there. On 10 November 2026, with about 25 worktrees active,
// three pairs of checkouts drew the same port and one checkout's runs tested another's files in
// silence. e2e/server-identity.mjs is the globalSetup that now refuses such a server. These run it
// against real HTTP servers — one serving the checkout, one serving somewhere else — through the
// same devServer() block the configs use, and hold every config that uses devServer() to it.
// Needs nothing installed. Part of test:hygiene.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertServesCheckout, CHECKOUT } from './e2e/server-identity.mjs';
import { devServer, devServerPort, SERVER_IDENTITY_SETUP, BROWSER_REFUSED_PORTS } from './e2e/dev-server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * A static file server for `root` on a free port, like the configs' http-server, recording every path
 * it is asked for. `answer`, when given, handles a request itself and returns true.
 * @param {any} t
 * @param {string} root
 * @param {(res: import('node:http').ServerResponse) => boolean} [answer]
 */
async function serve(t, root, answer) {
    /** @type {string[]} */
    const asked = [];
    const server = createServer((req, res) => {
        const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
        asked.push(path);
        if (answer && answer(res)) return;
        try {
            const body = readFileSync(join(root, path));
            res.writeHead(200);
            res.end(body);
        } catch {
            res.writeHead(404);
            res.end('Not found');
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(undefined)));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(() => resolve(undefined)); }));
    const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
    return { url: `http://127.0.0.1:${port}`, port, asked };
}

/** A scratch folder that goes however the test ends. @param {any} t */
function scratch(t) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'server-identity-')));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}

/** The token files the check left behind in a root — there must never be any. @param {string} root */
function leftovers(root) {
    try { return readdirSync(join(root, 'test-results')).filter(f => f.startsWith('server-identity-')); } catch { return []; }
}

/**
 * Run `fn` with these environment variables set, or removed where the value is undefined, and put
 * them back afterwards — CI and E2E_DEV_PORT decide the port, so every test states both.
 * @param {Record<string, string | undefined>} vars @param {() => any} fn
 */
async function withEnv(vars, fn) {
    const was = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
    const apply = (/** @type {Record<string, string | undefined>} */ set) => {
        for (const [k, v] of Object.entries(set)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    };
    apply(vars);
    try { return await fn(); } finally { apply(was); }
}

/** The globalSetup exactly as Playwright loads it: from the path devServer() hands the configs. */
async function loadSetup() {
    return (await import(pathToFileURL(devServer(4001).globalSetup).href)).default;
}

describe('the identity check refuses a server that does not serve this checkout', () => {
    test('a server serving this checkout passes, and the token it wrote is gone afterwards', async (t) => {
        const root = scratch(t);
        const { url, asked } = await serve(t, root);
        await assertServesCheckout(url, root);
        assert.equal(asked.length, 1, 'one request — the token');
        assert.match(asked[0], /^\/test-results\/server-identity-[0-9a-f]{32}\.txt$/);
        assert.deepEqual(leftovers(root), []);
    });

    test('a server serving ANOTHER folder is refused, naming the port and both ways out', async (t) => {
        const mine = scratch(t);
        const { url, port } = await serve(t, scratch(t));
        await assert.rejects(assertServesCheckout(url, mine), (/** @type {Error} */ err) => {
            assert.match(err.message, /is NOT serving this checkout/);
            assert.ok(err.message.includes(mine), 'it names the checkout that was expected');
            assert.match(err.message, /answered: HTTP 404/);
            assert.ok(err.message.includes(`on port ${port}`), 'it names the port');
            assert.ok(err.message.includes(`lsof -iTCP:${port} -sTCP:LISTEN`), 'way out 1: find and stop the other server');
            assert.ok(err.message.includes('E2E_DEV_PORT=<port>'), 'way out 2: pin this checkout to a free port');
            return true;
        });
        assert.deepEqual(leftovers(mine), [], 'a refusal cleans up too');
    });

    test('a server that answers EVERY path with one page is refused — the body is compared, not the status', async (t) => {
        const mine = scratch(t);
        const { url } = await serve(t, scratch(t), res => { res.writeHead(200); res.end('<!doctype html><title>app</title>'); return true; });
        await assert.rejects(assertServesCheckout(url, mine), /answered: a different file \(\d+ bytes\)/);
        assert.deepEqual(leftovers(mine), []);
    });

    // The test's own timeout is the backstop: without the check's, this would wait forever.
    test('a listener that never answers is refused within the timeout, not waited on', { timeout: 10_000 }, async (t) => {
        const mine = scratch(t);
        const { url } = await serve(t, scratch(t), () => true);   // accepts, never replies
        const started = Date.now();
        await assert.rejects(assertServesCheckout(url, mine, 200), /answered: no answer/);
        assert.ok(Date.now() - started < 5000, 'refused promptly');
        assert.deepEqual(leftovers(mine), []);
    });

    test('nothing listening at all is refused', async (t) => {
        const mine = scratch(t);
        const server = createServer();
        await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(undefined)));
        const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
        await new Promise(resolve => server.close(() => resolve(undefined)));
        await assert.rejects(assertServesCheckout(`http://127.0.0.1:${port}`, mine), /answered: no answer/);
        assert.deepEqual(leftovers(mine), []);
    });
});

describe('the globalSetup, through the devServer() block every config uses', () => {
    test('devServer() hands over this checkout\'s check as an absolute path', () => {
        const { globalSetup } = devServer(4001);
        assert.equal(globalSetup, SERVER_IDENTITY_SETUP);
        // Absolute, because a scratch config that spreads one of ours resolves a relative path
        // against its OWN folder, where no such file exists.
        assert.ok(isAbsolute(globalSetup), globalSetup);
        assert.equal(globalSetup, join(HERE, 'e2e', 'server-identity.mjs'));
    });

    test('CHECKOUT is the folder every http-server serves, wherever its config lives', () => {
        assert.equal(realpathSync(CHECKOUT), realpathSync(HERE));
        assert.ok(existsSync(join(CHECKOUT, 'playwright.config.mjs')));
        const { webServer } = devServer(4001);
        assert.match(webServer.command, /^npx http-server \. /, 'the server serves `.`, the folder it is started in');
        // ...and that folder is the checkout, NAMED. Playwright starts a webServer in its CONFIG's
        // folder unless told otherwise, so without this e2e/playwright.signed-in.mjs would serve e2e/.
        assert.equal(webServer.cwd, CHECKOUT, 'devServer() must start its server in the checkout, not in the config\'s folder');
    });

    test('locally, a reused server serving this checkout passes and one serving another folder stops the run', async (t) => {
        const setup = await loadSetup();
        const before = new Set(leftovers(CHECKOUT));
        const own = await serve(t, CHECKOUT);
        await withEnv({ CI: undefined, E2E_DEV_PORT: String(own.port) }, async () => {
            const { webServer } = devServer(4001);
            assert.equal(webServer.reuseExistingServer, true, 'premise: locally, a server on the port is adopted');
            assert.equal(webServer.url, own.url);
            await setup({ webServer });
        });
        assert.equal(own.asked.length, 1, 'the check asked the server it would reuse');

        const other = await serve(t, scratch(t));
        await withEnv({ CI: undefined, E2E_DEV_PORT: String(other.port) }, async () => {
            await assert.rejects(setup({ webServer: devServer(4002).webServer }),
                new RegExp(`NOT serving this checkout[\\s\\S]*on port ${other.port}:`));
        });
        assert.equal(other.asked.length, 1);
        assert.deepEqual(leftovers(CHECKOUT).filter(f => !before.has(f)), [], 'no token left in the checkout');
    });

    test('on CI nothing is adopted, so nothing is fetched or written — the behaviour there is unchanged', async (t) => {
        const setup = await loadSetup();
        const watcher = await serve(t, scratch(t));
        await withEnv({ CI: 'true', E2E_DEV_PORT: undefined }, async () => {
            const { webServer } = devServer(4001);
            assert.equal(webServer.reuseExistingServer, false);
            await setup({ webServer: { ...webServer, url: watcher.url } });
        });
        await setup({ webServer: null });   // a config with no server of its own
        assert.deepEqual(watcher.asked, [], 'a server Playwright starts itself needs no proof');
    });
});

describe('E2E_DEV_PORT — the way out the refusal names', () => {
    test('a pinned port is used by every config in the checkout, for the server and the tests alike', async () => {
        await withEnv({ CI: undefined, E2E_DEV_PORT: '5123' }, () => {
            for (const base of [4001, 4002, 4003]) {
                assert.equal(devServerPort(base), 5123);
                const { baseURL, webServer } = devServer(base);
                assert.equal(baseURL, 'http://127.0.0.1:5123');
                assert.equal(webServer.url, baseURL);
                assert.match(webServer.command, / -p 5123 /);
            }
        });
    });

    test('an unusable pin is refused, not half-used', async () => {
        assert.ok(BROWSER_REFUSED_PORTS.includes(4045), 'premise');
        for (const bad of ['abc', '80', '1023', '65536', '4053.5', '4045']) {
            await withEnv({ CI: undefined, E2E_DEV_PORT: bad }, () => {
                assert.throws(() => devServerPort(4001), new RegExp(`E2E_DEV_PORT=${bad.replace('.', '\\.')} is not a usable port`), bad);
            });
        }
    });

    test('CI ignores the pin: one checkout per runner, and its logs name the base port', async () => {
        await withEnv({ CI: 'true', E2E_DEV_PORT: '5123' }, () => {
            assert.equal(devServerPort(4001), 4001);
            assert.equal(devServerPort(4003), 4003);
        });
    });
});

describe('every config with a dev server runs the check', () => {
    // The root's configs and e2e/'s, where the signed-in lane's lives (its header says why).
    const isConfig = (/** @type {string} */ f) => /^playwright\..*\.mjs$/.test(f);
    const configs = [
        ...readdirSync(HERE).filter(isConfig),
        ...readdirSync(join(HERE, 'e2e')).filter(isConfig).map(f => `e2e/${f}`),
    ].sort().map(f => ({ f, src: readFileSync(join(HERE, f), 'utf8') }));
    const users = configs.filter(c => /\bdevServer\(\d+\)/.test(c.src));

    test('the configs were read', () => {
        assert.deepEqual(users.map(c => c.f),
            ['e2e/playwright.signed-in.mjs', 'playwright.config.mjs', 'playwright.offline.mjs', 'playwright.visual-webkit.mjs', 'playwright.visual.mjs'],
            'smoke, offline, visual, visual-webkit and signed-in call devServer() — a new one belongs in this list');
    });

    test('each passes on devServer()\'s globalSetup beside its webServer', () => {
        for (const { f, src } of users) {
            assert.match(src, /^\s*webServer:\s*DEV\.webServer\s*,/m, `${f}: the webServer block must be devServer()'s`);
            assert.match(src, /^\s*globalSetup:\s*DEV\.globalSetup\s*,/m,
                `${f} reuses a running server locally, so it must run devServer()'s globalSetup — without it a server from another checkout is adopted in silence`);
        }
    });

    test('no config writes a webServer or a globalSetup of its own, which would drop the check', () => {
        // playwright.webkit.mjs spreads the smoke config and so inherits both; one that set either key
        // itself would replace the checked pair with an unchecked one.
        for (const { f, src } of configs) {
            for (const m of src.matchAll(/^\s*(webServer|globalSetup):\s*(.+)$/gm)) {
                assert.match(m[2], /^DEV\.(webServer|globalSetup)\s*,/, `${f}: \`${m[1]}: ${m[2].trim()}\` bypasses devServer()`);
            }
        }
    });
});
