// @ts-check
/**
 * e2e/server-identity.mjs — Playwright `globalSetup`: the server a run is about to test serves THIS
 * checkout, or the run stops before its first test.
 *
 * dev-server.mjs derives each checkout's port from its path, so two worktrees USUALLY get two ports —
 * only usually. Each config draws from 120 ports, which is a birthday problem: on 10 November 2026,
 * with about 25 worktrees active, three pairs shared a port (4025, 4089, 4113). `reuseExistingServer`
 * then adopted the OTHER checkout's server and runs silently tested the wrong tree — the 11 Sep 2026
 * incident dev-server.mjs's header describes, back by a different road. Widening the range only makes
 * a collision rarer, so identity is CHECKED rather than inferred from the port.
 *
 * The check: a fresh random token is written into this checkout's `test-results/` (served by the dev
 * server, gitignored, and Playwright's own scratch folder) and fetched through the server's URL. Only a
 * server serving this checkout can return it; a 404, any other body, or no answer stops the run,
 * naming the port and the two ways out. The BODY is compared, not just the status, because a server
 * that answers every path with one page (a single-page-app fallback) would pass a status check.
 *
 * It runs only where a server may be ADOPTED (`reuseExistingServer`, so never on CI): elsewhere the
 * server is always Playwright's own, started in this checkout, and a port already taken is an error
 * Playwright raises itself. CI's behaviour is unchanged. Playwright runs it after the webServer is up
 * (adopted or started) and before the first test.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** The checkout this file belongs to — the folder the configs live in and their server serves. */
export const CHECKOUT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Throw unless the server at `url` is serving `root`: write a fresh token under `root/test-results/`,
 * fetch it through the server, and remove it again.
 * @param {string} url the server's base URL, e.g. http://127.0.0.1:4053
 * @param {string} [root] the checkout it must be serving
 * @param {number} [timeoutMs] how long to wait for an answer — a listener that never replies is refused, not waited on forever
 * @returns {Promise<void>}
 */
export async function assertServesCheckout(url, root = CHECKOUT, timeoutMs = 10_000) {
    const token = randomBytes(16).toString('hex');
    const name = `server-identity-${token}.txt`;
    const dir = join(root, 'test-results');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), token);
    let answer;
    try {
        const res = await fetch(`${url.replace(/\/$/, '')}/test-results/${name}`,
            { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
        const body = res.status === 200 ? (await res.text()).trim() : '';
        answer = res.status !== 200 ? `HTTP ${res.status}` : body === token ? token : `a different file (${body.length} bytes)`;
    } catch (e) {
        answer = `no answer (${/** @type {Error} */ (e).message})`;
    } finally {
        rmSync(join(dir, name), { force: true });
    }
    if (answer === token) return;
    const port = new URL(url).port;
    throw new Error([
        `The server at ${url} is NOT serving this checkout (${root}).`,
        `Asked for a file written into this checkout a moment ago, it answered: ${answer}.`,
        `Another checkout's run is almost certainly on port ${port}: ports are derived from the checkout's`,
        'path and can collide, and Playwright reuses whatever already answers there — so these tests would',
        'have run against that checkout\'s files. Either:',
        `  · stop the other server (lsof -iTCP:${port} -sTCP:LISTEN names it), or`,
        '  · pin this checkout to a free port: E2E_DEV_PORT=<port> npx playwright test …',
    ].join('\n'));
}

/**
 * The globalSetup entry point: check every server the config would reuse. Playwright passes its
 * resolved config, whose `webServer` is the config's own object (or null).
 * @param {{ webServer?: { url?: string, reuseExistingServer?: boolean } | { url?: string, reuseExistingServer?: boolean }[] | null }} config
 * @returns {Promise<void>}
 */
export default async function serverIdentity(config) {
    for (const server of [config.webServer ?? []].flat()) {
        if (!server.reuseExistingServer || !server.url) continue;   // never adopted: Playwright starts its own
        await assertServesCheckout(server.url);
    }
}
