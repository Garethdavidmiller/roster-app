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
 *
 * ── A PORT THE BROWSER REFUSES (3 Nov 2026) ─────────────────────────────────────────────────────
 *
 * Browsers refuse to open a short list of ports at all: the navigation fails with
 * `net::ERR_UNSAFE_PORT` before any request is made, whatever is listening. 4045 is one, and
 * 4001 + 44 is 4045, so a checkout whose path hashed there would have failed EVERY browser test
 * with an error that names no file of ours — one path in 120, per config. Measured in Chromium 141:
 * of 4001–4300, 4045 is the only port refused.
 *
 * A refused port moves up past every block (below), out of the range every other checkout draws
 * from — not to the next port, which is another checkout's: two checkouts on one port adopt each
 * other's server, the very failure above. CI is untouched; its base ports are not refused.
 *
 * ── ONE BLOCK OF PORTS PER CONFIG (6 Nov 2026 review) ─────────────────────────────────────────
 *
 * The bases are one apart (4001, 4002, 4003) and each drew from the 120 ports above it, so the
 * ranges overlapped almost entirely: checkout A's offline server on 4002 + 9 and checkout B's smoke
 * server on 4001 + 10 were the same port, and one config could adopt ANOTHER checkout's server — the
 * 11 Sep wrong-files failure again, by a different road. 120 of the 122 reachable ports could be
 * reached from more than one config. So each base now draws from a block of its own, in BASES order:
 * smoke and visual keep 4001–4120 exactly as before, offline takes 4122–4241 and visual-webkit
 * 4243–4362. A base not in BASES throws, so a new config cannot quietly overlap one that exists.
 */
import { createHash } from 'node:crypto';

/** How many ports above the base a derived port may land. Keeps the whole range well inside the
 *  unprivileged space and far from the Firebase emulator ports (4000, 5000, 8080, 9099, 9199). */
export const SPREAD = 120;

/**
 * Ports above 1023 that Chromium refuses to navigate to — each one MEASURED (3 Nov 2026, Chromium
 * 141), not taken from memory: two that memory supplied, 4190 and 6679, loaded normally and are not
 * here. Only 4045 lies where a derived port can land today; the rest are listed so a changed base or
 * SPREAD cannot walk into one unnoticed (workflow-hygiene.test.mjs checks every reachable port).
 */
export const BROWSER_REFUSED_PORTS = Object.freeze([
    1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

/** The configs' base ports, in block order: each derives its local ports from its OWN block of
 *  SPREAD ports starting at `base + index × SPREAD` (the header's last section). CI uses the base. */
export const BASES = Object.freeze([4001, 4002, 4003]);

/**
 * The port for a base and a path hash — pure, so every value it can return is checked by a test.
 * @param {number} base the config's historical port, one of BASES
 * @param {number} hash an unsigned 16-bit value from the checkout path's digest
 * @returns {number}
 */
export function portFor(base, hash) {
    const block = BASES.indexOf(base);
    if (block < 0) throw new Error(`dev-server: base port ${base} is not in BASES (${BASES.join(', ')}). Add it there, so its local ports get a block of their own and never overlap another config's.`);
    let port = base + block * SPREAD + (hash % SPREAD);
    // Past EVERY block, never into the next one: that is another config's, and so another checkout's.
    while (BROWSER_REFUSED_PORTS.includes(port)) port += SPREAD * BASES.length;
    return port;
}

/**
 * The port this checkout's dev server should bind for a given base.
 * @param {number} base the config's historical port (4001 smoke/visual, 4002 offline, 4003 visual-webkit)
 * @returns {number}
 */
export function devServerPort(base) {
    if (process.env.CI) return base;
    // The checkout ROOT, not the cwd of whatever invoked us — a spec run from a subdirectory must
    // resolve to the same server as one run from the top, or the same files get two ports.
    const root = process.cwd();
    const digest = createHash('sha256').update(root).digest();
    return portFor(base, digest.readUInt16BE(0));
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
