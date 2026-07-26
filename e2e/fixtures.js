/**
 * Playwright fixtures — hermetic Firebase for the smoke suite.
 *
 * WHY THIS EXISTS (the root cause of the "takes ages then all fails" CI flake):
 * Every app page statically imports `./firebase-client.js`, which in turn
 * statically imports the Firebase SDK from `https://www.gstatic.com/firebasejs/...`.
 * In ES modules a static import that fails to resolve aborts the WHOLE module
 * graph — so if that CDN is slow, throttled, or blocked on the CI runner, none
 * of the app's JavaScript ever runs. The calendar never renders, dropdowns stay
 * empty, the operations/links redirects never fire, and every assertion times
 * out. No timeout increase or retry count can fix a hard dependency failure —
 * which is why the earlier timeout/retry/reporter tweaks never stuck.
 *
 * The smoke suite explicitly does NOT test Firestore (see smoke.spec.js header).
 * So we intercept the gstatic Firebase modules and serve tiny local stubs that
 * export every symbol `firebase-client.js` imports. firebase-client.js then
 * loads instantly with no network, the real app JS runs, and the tests verify
 * what they are meant to: that our own code renders and behaves correctly.
 *
 * Production is unchanged — this stubbing lives only in the test fixture, so the
 * CDN-only architecture (no bundler) is preserved.
 */

import { test as base, expect } from '@playwright/test';

// A valid ES module exporting every name firebase-client.js pulls from the
// three gstatic SDK entrypoints (app, firestore, auth) plus the lazily-imported
// storage entrypoint. All three import URLs are served this same body — extra
// exports an importer doesn't name are simply ignored. Reads resolve to empty
// snapshots and writes resolve to no-ops, so offline-first app code that awaits
// Firestore never throws an unfiltered error.
const FIREBASE_STUB = `
const noop = () => {};
const marker = (tag) => ({ __stub: tag });

// ---- firebase-app ----
export const initializeApp = () => marker('app');

// ---- firestore ----
export const initializeFirestore = () => marker('db');
export const getFirestore = () => marker('db');
export const persistentLocalCache = () => marker('cache');
export const collection = () => marker('collection');
export const query = () => marker('query');
export const where = () => marker('where');
export const orderBy = () => marker('orderBy');
export const limit = () => marker('limit');
export const doc = () => marker('doc');
export const serverTimestamp = () => marker('ts');
export const writeBatch = () => ({ set: noop, update: noop, delete: noop, commit: () => Promise.resolve() });
// runTransaction(db, fn): run the update fn with a stub tx whose get() returns a non-existent doc,
// so the links-app.js concurrency transaction (Finding #13) links + executes in the hermetic suite.
export const runTransaction = (_db, fn) => Promise.resolve(fn({ get: () => Promise.resolve({ exists: () => false, data: () => ({}) }), set: noop }));
export const getDocs = () => Promise.resolve({ empty: true, size: 0, docs: [], forEach: noop });
//   window.__E2E = { failGetDoc: true }  → every single-doc read rejects. Used to prove the forced
//      set-password overlay FAILS OPEN when it can't read passwordStatus (password-force.js) — the
//      property that keeps a mandatory overlay from becoming a lockout.
export const getDoc = () => (globalThis.__E2E || {}).failGetDoc
    ? Promise.reject(Object.assign(new Error('e2e'), { code: 'unavailable' }))
    : Promise.resolve({ exists: () => false, data: () => ({}) });
export const addDoc = () => Promise.resolve(marker('docRef'));
export const setDoc = () => Promise.resolve();
export const updateDoc = () => Promise.resolve();
export const deleteDoc = () => Promise.resolve();
export const increment = () => marker('increment');   // FieldValue sentinel (usage counters)
export const deleteField = () => marker('deleteField'); // FieldValue sentinel (usage prune)
export class FieldPath {}                               // literal field path (usage daily-bucket prune)
export const onSnapshot = () => noop; // returns the unsubscribe fn; never fires in tests

// ---- auth ----
// Sign-in normally resolves. Two test hooks (set via addInitScript before page scripts, read at
// CALL time so they're honoured after init):
//   window.__E2E = { failSignIn: true }  → every sign-in path rejects with a persistent (non-
//      transient) code so ensureNamedSession does not retry — the B1 named-session enforcement tests.
//   window.__E2E = { hangSignIn: true }  → every sign-in path returns a promise that NEVER resolves
//      — exercises the login overlay's in-flight state (the "Signing in…" button + the disabled Back
//      link that the v14.79 guard added). hangSignIn takes precedence over failSignIn.
const _e2eAuth = (code) => () => {
    const e2e = globalThis.__E2E || {};
    if (e2e.hangSignIn) return new Promise(() => {});
    if (e2e.failSignIn) return Promise.reject(Object.assign(new Error('e2e'), { code }));
    return Promise.resolve({ user: { uid: 'test' } });
};
export const getAuth = () => ({ currentUser: null });
export const onAuthStateChanged = (_auth, cb) => { Promise.resolve().then(() => cb && cb(null)); return noop; };
export const signInWithEmailAndPassword = _e2eAuth('auth/invalid-credential');
export const createUserWithEmailAndPassword = _e2eAuth('auth/operation-not-allowed');
export const signInAnonymously = _e2eAuth('auth/operation-not-allowed');
export const signOut = () => Promise.resolve();
export const setPersistence = () => Promise.resolve();
export const indexedDBLocalPersistence = marker('idb');
export const browserLocalPersistence = marker('local');
export const browserSessionPersistence = marker('session');
// Chosen-password change flow (settings.html Password card, v18.63). These are imported at module
// scope by firebase-client.js, so they MUST be exported here or the whole module graph fails to link
// (a link error would blank every page under the stub). Only exercised when a password change runs.
export const updatePassword = () => Promise.resolve();
export const reauthenticateWithCredential = () => Promise.resolve({ user: { uid: 'test' } });
export const EmailAuthProvider = { credential: (email, password) => marker('cred:' + email + ':' + password) };

// ---- storage (only operations upload uses these; included for completeness) ----
export const getStorage = () => marker('storage');
export const ref = () => marker('ref');
export const uploadBytes = () => Promise.resolve();
export const getDownloadURL = () => Promise.resolve('about:blank');
export const deleteObject = () => Promise.resolve();
`;

/**
 * Per-page CONFIG overrides applied to roster-data.js as it is served.
 *
 * ONE route handler applies ALL of them (registered in the `page` fixture below), because Playwright
 * runs only the most-recently-registered matching handler and `route.fetch()` inside it bypasses the
 * rest — so the previous shape (a `page.route('**\/roster-data.js')` per helper) meant a test calling
 * two flag helpers silently got only one of them. Nothing did yet, but adding a third flag made that
 * a matter of when. Helpers now just RECORD an override.
 *
 * @type {WeakMap<import('@playwright/test').Page, Record<string, [RegExp, string]>>}
 */
const _configOverrides = new WeakMap();

/**
 * Record a CONFIG rewrite for this page. `key` de-duplicates (a helper called twice wins once).
 * @param {any} page
 * @param {string} key
 * @param {RegExp} pattern   what to find in the served roster-data.js
 * @param {string} value     what to replace it with
 */
function _setConfigOverride(page, key, pattern, value) {
    const current = _configOverrides.get(page) || {};
    current[key] = [pattern, value];
    _configOverrides.set(page, current);
}

export const test = base.extend({
    // Auto-apply the routes before any test navigates. Registering them inside the
    // `page` fixture guarantees they are in place before the first page.goto().
    page: async ({ page }, use) => {
        await page.route('https://www.gstatic.com/firebasejs/**', route =>
            route.fulfill({ contentType: 'text/javascript', body: FIREBASE_STUB }));

        await page.route('**/roster-data.js', async route => {
            const res = await route.fetch();
            let body  = await res.text();
            // DEFAULT OFF for the whole suite: the forced set-password overlay (PASSWORD_PLAN Phase 2)
            // fires after any confirmed sign-in for a member the stubbed Firestore reports as
            // un-migrated — which, since `getDoc` resolves `exists: () => false`, is EVERY member. It
            // would therefore cover the page in every test that signs in through the overlay and break
            // assertions that have nothing to do with passwords. Compel tests opt back in with
            // `forcePasswordSet(page)`.
            body = body.replace(/FORCE_PASSWORD_SET:\s*(?:true|false)/, 'FORCE_PASSWORD_SET: false');
            for (const [pattern, value] of Object.values(_configOverrides.get(page) || {})) {
                body = body.replace(pattern, value);
            }
            await route.fulfill({ response: res, body, contentType: 'text/javascript' });
        });
        await use(page);
    },
});

/**
 * Turn the B1 named-session kill-switch ON for one test by rewriting roster-data.js as it is
 * served — forces `ENFORCE_NAMED_SESSION` to `true` **regardless of the production default**
 * (it is `true` in prod today; matching either literal keeps this fixture correct if the
 * kill-switch is ever flipped back to `false`). Call BEFORE page.goto(). Pair with
 * `window.__E2E = { failSignIn: true }` (set via addInitScript) to exercise the enforcement paths.
 * @param {import('@playwright/test').Page} page
 */
export async function enforceNamedSession(page) {
    _setConfigOverride(page, 'ENFORCE_NAMED_SESSION',
        /ENFORCE_NAMED_SESSION:\s*(?:true|false)/, 'ENFORCE_NAMED_SESSION: true');
}

/**
 * Turn in-place sign-in ON (for ALL coordinators) for one test by rewriting roster-data.js as it is
 * served — flips every per-page key in the `INPLACE_LOGIN: { … }` object to `true` without touching the
 * real file or the production default. Call BEFORE page.goto(). Each test only exercises one page, so
 * enabling all is harmless and keeps the helper simple. (ARCHITECTURE_PLAN.md Phase 9.)
 * @param {import('@playwright/test').Page} page
 */
export async function enableInplaceLogin(page) {
    _setConfigOverride(page, 'INPLACE_LOGIN', /INPLACE_LOGIN:\s*\{[^}]*\}/,
        'INPLACE_LOGIN: { operations: true, links: true, paycalc: true, admin: true, settings: true }');
}

/**
 * Turn the forced set-password overlay ON for one test (PASSWORD_PLAN.md Phase 2). The suite-wide
 * default is OFF — see the `page` fixture — because the stubbed Firestore reports every member as
 * un-migrated, so leaving it on would put the overlay over every sign-in test. Call BEFORE page.goto().
 * @param {import('@playwright/test').Page} page
 */
export async function forcePasswordSet(page) {
    _setConfigOverride(page, 'FORCE_PASSWORD_SET',
        /FORCE_PASSWORD_SET:\s*(?:true|false)/, 'FORCE_PASSWORD_SET: true');
}

export { expect };
