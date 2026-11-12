// @ts-check
/**
 * e2e/signed-in-fixtures.js — the page fixture for the SIGNED-IN lane: the app's real Firebase SDK,
 * talking to the local emulators, under the real security rules and the real Cloud Functions.
 *
 * ── WHY THIS LANE EXISTS (external review, 11 Nov 2026) ─────────────────────────────────────────────
 *
 * Every other browser lane swaps the Firebase SDK for a hand-written stub (e2e/fixtures.js), and the
 * security rules are tested on their own against the emulator (firestore.rules.test.mjs). Each half
 * is well tested; nothing ran the two TOGETHER except production. That is the "rule tested, the
 * wiring not" risk CLAUDE.md names: a save can satisfy the stub and still be refused by the rules,
 * or satisfy the rules in a unit test and never be sent that way by the page. This lane is the one
 * place a signed-in member, a manager and the staff PIN go through the app, the SDK, the rules and
 * the server together.
 *
 * ── THE SEAM ───────────────────────────────────────────────────────────────────────────────────────
 *
 * The same one the stub uses: the page imports the SDK from `https://www.gstatic.com/firebasejs/<v>/`.
 * Here that address answers with the REAL SDK from `node_modules/firebase` (the npm package ships the
 * same CDN builds), wrapped so the first Auth, Firestore and Storage instance connects to the local
 * emulator, and the app's project id is swapped for `demo-myb-roster` — a `demo-` project can reach
 * no real Firebase resource even by accident. The app's own code is not touched: nothing staff
 * download carries an emulator switch.
 *
 * Three refusals keep it honest:
 *   1. The SDK version the page asks for must be the version `node_modules/firebase` holds, or the
 *      file is not served — so the lane cannot test one SDK while staff run another.
 *   2. Every other request to a Google production host is aborted and recorded, and the test fails
 *      on it (`expectNothingLeftForGoogle`). The app calls three of them directly — the reset probe
 *      (identitytoolkit, the passwordStatus REST read) and its Cloud Functions — and each is rewritten
 *      to its emulator explicitly below.
 *   3. Each page keeps its OWN Content-Security-Policy, widened by the emulators' three addresses in
 *      `connect-src` and nothing else (`allowEmulatorsInCsp`). Not Playwright's `bypassCSP`: WebKit
 *      enforces a `<meta>` CSP whatever that switch says, and every page carries one (the Pages mirror
 *      serves no headers). Keeping the policy is also the stricter test — a signed-in journey that
 *      reaches an address the real CSP forbids fails here as it would on a phone.
 */
import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PROJECT, EMULATOR, REGION } from './signed-in-env.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SDK_DIR = path.join(ROOT, 'node_modules', 'firebase');
const SDK_VERSION = JSON.parse(readFileSync(path.join(SDK_DIR, 'package.json'), 'utf8')).version;

/**
 * The wrapper served at each SDK address the app imports. `export *` re-exports the real module
 * (served at the same address plus `?real`); the names declared here take precedence over it.
 * Every real SDK file imports the APP module by its plain address, so they all share one app
 * registry through the wrapper.
 * @type {Record<string, string>}
 */
const WRAPPERS = {
    'firebase-app.js': `
export * from './firebase-app.js?real';
import { initializeApp as real } from './firebase-app.js?real';
export function initializeApp(options, ...rest) { return real({ ...options, projectId: '${PROJECT}' }, ...rest); }
`,
    'firebase-auth.js': `
export * from './firebase-auth.js?real';
import { initializeAuth as realInit, getAuth as realGet, connectAuthEmulator } from './firebase-auth.js?real';
const done = new WeakSet();
const connect = (a) => { if (!done.has(a)) { done.add(a); connectAuthEmulator(a, 'http://${EMULATOR.auth}', { disableWarnings: true }); } return a; };
export function initializeAuth(...args) { return connect(realInit(...args)); }
export function getAuth(...args) { return connect(realGet(...args)); }
`,
    'firebase-firestore.js': `
export * from './firebase-firestore.js?real';
import { initializeFirestore as realInit, getFirestore as realGet, connectFirestoreEmulator } from './firebase-firestore.js?real';
const done = new WeakSet();
const connect = (db) => { if (!done.has(db)) { done.add(db); connectFirestoreEmulator(db, '${EMULATOR.firestore.split(':')[0]}', ${EMULATOR.firestore.split(':')[1]}); } return db; };
export function initializeFirestore(...args) { return connect(realInit(...args)); }
export function getFirestore(...args) { return connect(realGet(...args)); }
`,
    'firebase-storage.js': `
export * from './firebase-storage.js?real';
import { getStorage as realGet, connectStorageEmulator } from './firebase-storage.js?real';
const done = new WeakSet();
const connect = (s) => { if (!done.has(s)) { done.add(s); connectStorageEmulator(s, '${EMULATOR.storage.split(':')[0]}', ${EMULATOR.storage.split(':')[1]}); } return s; };
export function getStorage(...args) { return connect(realGet(...args)); }
`,
};

/** The emulators the page talks to directly, once the wrappers above have connected the SDK. */
const EMULATOR_HOSTS = new Set([EMULATOR.auth, EMULATOR.firestore, EMULATOR.storage]);

/**
 * A page's HTML with its `<meta>` CSP widened by exactly the emulator addresses, in `connect-src`.
 * A page with no CSP tag is returned unchanged. A tag this cannot widen THROWS, naming the page —
 * otherwise a reworded tag would surface as a sign-in that "couldn't reach sign-in", which reads like
 * an emulator fault and is not one. So does a SECOND tag: a browser enforces every CSP it is given,
 * so an unwidened second one would refuse the emulators just the same.
 * @param {string} html
 * @param {string} where  the page's address, for the error
 */
export function allowEmulatorsInCsp(html, where) {
    const metas = html.match(/<meta\b[^>]*\bContent-Security-Policy\b[^>]*>/gi) || [];
    if (metas.length === 0) return html;
    if (metas.length > 1) {
        throw new Error(`signed-in lane: ${where} has ${metas.length} CSP <meta> tags, every one of them enforced, and this widens one`);
    }
    const tag = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/i;
    const found = html.match(tag);
    if (!found) {
        throw new Error(`signed-in lane: the CSP <meta> on ${where} is not written <meta http-equiv="Content-Security-Policy" content="…">, so it cannot be widened: ${metas[0].slice(0, 120)}…`);
    }
    const directive = /(^|;)(\s*connect-src\s)([^;]*)/;
    if (!directive.test(found[2])) {
        throw new Error(`signed-in lane: the CSP on ${where} has no connect-src to add the emulators to`);
    }
    const origins = [...EMULATOR_HOSTS].map((h) => `http://${h}`).join(' ');
    const widened = found[2].replace(directive, (_, sep, name, sources) => `${sep}${name}${sources.trimEnd()} ${origins}`);
    return html.replace(tag, (_, open, _content, close) => `${open}${widened}${close}`);
}

/** Hosts the app may only reach through a rewrite below; anything else to them is a leak. */
const GOOGLE_HOST = /(^|\.)(googleapis\.com|cloudfunctions\.net|firebaseio\.com|firebaseapp\.com|google\.com)$/;

/**
 * Answer an intercepted request by sending it, from Node, to `target` instead. `route.fetch` cannot
 * change https to http, so the request is replayed through the context's own request client.
 * @param {import('@playwright/test').Route} route
 * @param {string} target
 */
async function forwardTo(route, target) {
    const req = route.request();
    const headers = { ...req.headers() };
    delete headers.host;
    const res = await route.request().frame().page().context().request.fetch(target, {
        method: req.method(),
        headers,
        data: req.postDataBuffer() ?? undefined,
        failOnStatusCode: false,
        maxRedirects: 0,
    });
    await route.fulfill({ status: res.status(), headers: res.headers(), body: await res.body() });
}

/** @type {WeakMap<import('@playwright/test').Page, string[]>} */
const leaks = new WeakMap();

/**
 * Send one page's Firebase traffic to the emulators, and record any request that would have gone to a
 * real Google address instead. The `page` fixture below calls it; a test that opens a SECOND page —
 * a colleague's phone in another context — calls it for that page too.
 * @param {import('@playwright/test').Page} page
 */
export async function wireToEmulators(page) {
    /** @type {string[]} */
    const leaked = [];
    leaks.set(page, leaked);

    // Registered FIRST, so every specific route below wins over it (Playwright asks the newest
    // route first): what reaches this one is a Google request nothing here meant to allow.
    // (Firestore's "is the internet there?" image from www.google.com never gets this far: the
    // page's own CSP refuses it, as it does on a phone. It needed an exception here only while the
    // lane bypassed the CSP.)
    await page.route((url) => GOOGLE_HOST.test(url.hostname), (route) => {
        leaked.push(route.request().url());
        return route.abort('blockedbyclient');
    });

    // Every page the dev server sends — its own CSP, widened by the emulators (header, refusal 3).
    // The emulators' own traffic is excluded by host, so nothing the SDK sends is held up here.
    await page.route((url) => url.protocol === 'http:' && !EMULATOR_HOSTS.has(url.host), async (route) => {
        if (route.request().resourceType() !== 'document') return route.fallback();
        const response = await route.fetch();
        const body = allowEmulatorsInCsp(await response.text(), route.request().url());
        return route.fulfill({ response, body });
    });

    await page.route('https://www.gstatic.com/firebasejs/**', async (route) => {
        const url = new URL(route.request().url());
        const [, version, file] = url.pathname.match(/^\/firebasejs\/([^/]+)\/([^/]+)$/) || [];
        if (version !== SDK_VERSION) {
            leaked.push(`SDK ${version} asked for, node_modules holds ${SDK_VERSION}: ${url.href}`);
            return route.abort('failed');
        }
        const wrapper = WRAPPERS[file];
        const body = (wrapper && url.search !== '?real')
            ? wrapper
            : readFileSync(path.join(SDK_DIR, file), 'utf8');
        return route.fulfill({ contentType: 'text/javascript', body });
    });

    // The app's Cloud Functions — https://europe-west2-myb-roster.cloudfunctions.net/<name>.
    await page.route('https://europe-west2-myb-roster.cloudfunctions.net/**', (route) => {
        const url = new URL(route.request().url());
        return forwardTo(route, `http://${EMULATOR.functions}/${PROJECT}/${REGION}${url.pathname}${url.search}`);
    });
    // The two REST calls the silent re-sign-in makes before it signs in (firebase-client.js →
    // probeResetAtMs): the Auth REST API and one Firestore document, both by absolute address.
    await page.route('https://identitytoolkit.googleapis.com/**', (route) => {
        const url = new URL(route.request().url());
        return forwardTo(route, `http://${EMULATOR.auth}/identitytoolkit.googleapis.com${url.pathname}${url.search}`);
    });
    await page.route('https://firestore.googleapis.com/**', (route) => {
        const url = new URL(route.request().url());
        const p = url.pathname.replace('/projects/myb-roster/', `/projects/${PROJECT}/`);
        return forwardTo(route, `http://${EMULATOR.firestore}${p}${url.search}`);
    });
}

export const test = base.extend({
    page: async ({ page }, use) => {
        await wireToEmulators(page);
        await use(page);
        await page.unrouteAll({ behavior: 'ignoreErrors' });
    },
});

/**
 * Fail if the page tried to reach a real Google address during the test.
 * @param {import('@playwright/test').Page} page
 */
export function expectNothingLeftForGoogle(page) {
    expect(leaks.get(page) || [], 'a request was aimed at a real Google address; the lane must reach only the emulators').toEqual([]);
}

export { expect };
