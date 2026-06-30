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
export const getDocs = () => Promise.resolve({ empty: true, size: 0, docs: [], forEach: noop });
export const getDoc = () => Promise.resolve({ exists: () => false, data: () => ({}) });
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

// ---- storage (only operations upload uses these; included for completeness) ----
export const getStorage = () => marker('storage');
export const ref = () => marker('ref');
export const uploadBytes = () => Promise.resolve();
export const getDownloadURL = () => Promise.resolve('about:blank');
export const deleteObject = () => Promise.resolve();
`;

export const test = base.extend({
    // Auto-apply the route before any test navigates. Registering it inside the
    // `page` fixture guarantees it is in place before the first page.goto().
    page: async ({ page }, use) => {
        await page.route('https://www.gstatic.com/firebasejs/**', route =>
            route.fulfill({ contentType: 'text/javascript', body: FIREBASE_STUB }));
        await use(page);
    },
});

/**
 * Turn the B1 named-session kill-switch ON for one test by rewriting roster-data.js as it is
 * served — flips `ENFORCE_NAMED_SESSION: false` to `true` without touching the real file or the
 * production default. Call BEFORE page.goto(). Pair with `window.__E2E = { failSignIn: true }`
 * (set via addInitScript) to exercise the enforcement paths.
 * @param {import('@playwright/test').Page} page
 */
export async function enforceNamedSession(page) {
    await page.route('**/roster-data.js', async route => {
        const res  = await route.fetch();
        const body = (await res.text()).replace(/ENFORCE_NAMED_SESSION:\s*false/, 'ENFORCE_NAMED_SESSION: true');
        await route.fulfill({ response: res, body, contentType: 'text/javascript' });
    });
}

/**
 * Turn in-place sign-in ON (for ALL coordinators) for one test by rewriting roster-data.js as it is
 * served — flips every per-page key in the `INPLACE_LOGIN: { … }` object to `true` without touching the
 * real file or the production default. Call BEFORE page.goto(). Each test only exercises one page, so
 * enabling all is harmless and keeps the helper simple. (ARCHITECTURE_PLAN.md Phase 9.)
 * @param {import('@playwright/test').Page} page
 */
export async function enableInplaceLogin(page) {
    await page.route('**/roster-data.js', async route => {
        const res  = await route.fetch();
        const body = (await res.text()).replace(/INPLACE_LOGIN:\s*\{[^}]*\}/,
            'INPLACE_LOGIN: { operations: true, links: true, paycalc: true, admin: true, settings: true }');
        await route.fulfill({ response: res, body, contentType: 'text/javascript' });
    });
}

export { expect };
