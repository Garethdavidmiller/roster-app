// @ts-check
/**
 * e2e/dev-server.mjs — WHICH static server a Playwright run talks to, and when reusing one is safe.
 *
 * Owns one decision and nothing else: the port the local `http-server` binds, and therefore which
 * already-running server `reuseExistingServer` is allowed to adopt.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * Three configs (smoke, visual, offline) each hardcoded a fixed port and set
 * `reuseExistingServer: !process.env.CI`, whose comment said it was there "to speed up iteration".
 * It does — and the two halves together are a correctness hole, because a port says nothing about
 * WHAT is being served. Playwright adopts any listener that answers on the port, from any
 * directory, and reports nothing.
 *
 * That is not hypothetical. On 11 Sep 2026, with several `git worktree` checkouts active at once,
 * a mutation check ran against a DIFFERENT worktree's files: the guard under test was deleted, the
 * browser fetched an unmutated copy from the server another checkout had already started, and three
 * teeth checks "passed" while measuring nothing. The mutation was invisible for exactly the reason
 * the suite exists to catch — the thing under test was never loaded.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────────────────────────
 *
 *   Reuse a server only when it is serving THIS checkout.
 *
 * The port is therefore derived from the checkout's own path. Two worktrees get two ports and never
 * adopt each other; two configs in the SAME checkout share a port and may reuse freely, which is
 * correct — they serve identical bytes, and that is the speed the original comment wanted.
 *
 * **CI keeps the base port unchanged.** There is one checkout per runner and `reuseExistingServer`
 * is already false there, so the hazard cannot arise; a derived port would only make a CI failure
 * harder to reproduce from the logs.
 *
 * Deliberately NOT a random or ephemeral port: a stable one per checkout means a developer can open
 * the same URL by hand between runs, and a stale listener from a killed run is adopted rather than
 * colliding.
 */
import { createHash } from 'node:crypto';

/** How many ports above the base a derived port may land. Keeps the whole range well inside the
 *  unprivileged space and far from the Firebase emulator ports (4000, 5000, 8080, 9099, 9199). */
const SPREAD = 120;

/**
 * The port this checkout's dev server should bind for a given base.
 * @param {number} base the config's historical port (4001 smoke/visual, 4002 offline)
 * @returns {number}
 */
export function devServerPort(base) {
    if (process.env.CI) return base;
    // The checkout ROOT, not the cwd of whatever invoked us — a spec run from a subdirectory must
    // resolve to the same server as one run from the top, or the same files get two ports.
    const root = process.cwd();
    const digest = createHash('sha256').update(root).digest();
    return base + (digest.readUInt16BE(0) % SPREAD);
}

/**
 * The `baseURL` and `webServer` block for a config, already agreed with each other.
 *
 * Returned as one object on purpose: the two used to be written separately in each config, and a
 * port changed in one and not the other is a readiness probe that hangs rather than an error.
 *
 * @param {number} base
 * @returns {{ baseURL: string, webServer: { command: string, url: string, reuseExistingServer: boolean } }}
 */
export function devServer(base) {
    const port = devServerPort(base);
    const url  = `http://127.0.0.1:${port}`;
    return {
        baseURL: url,
        webServer: {
            command: `npx http-server . -p ${port} -a 127.0.0.1 -c-1 --silent`,
            url,
            // Safe now that the port names the checkout: an adopted server is serving these files.
            reuseExistingServer: !process.env.CI,
        },
    };
}
