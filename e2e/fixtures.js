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
// doc(db, collection, id) captures its PATH (v18.97) so deleteDoc below can tell which row was
// removed. Still an opaque object to every consumer; only the delete stub reads .path.
export const doc = (...a) => ({ __stub: 'doc', path: a.slice(1).map(String).join('/') });
export const serverTimestamp = () => marker('ts');
// writeBatch RECORDS its set() payloads (v19.35) rather than swallowing them. A test that can only
// see the "Save N changes" counter is checking the outcome SUMMARY, not the write — and those are
// two separate passes over the same state that can disagree (a button promising 4 while 3 are
// written is exactly the bug worth catching). Recording is additive: every existing caller still
// sees a working batch.
export const writeBatch = () => {
    const e2e = globalThis.__E2E || (globalThis.__E2E = {});
    e2e.batchWrites = e2e.batchWrites || [];
    return {
        set: (/** @type {any} */ _ref, /** @type {any} */ data) => { e2e.batchWrites.push(data); },
        update: noop,
        delete: noop,
        commit: () => Promise.resolve(),
    };
};
// runTransaction(db, fn): runs the update fn against the SEEDED rows (v19.41 — it used to hand back
// a permanently non-existent doc). With nothing seeded it still resolves "no such doc", so every
// existing caller behaves as before; when a test seeds window.__E2E.docs the transaction sees them,
// which is what makes the Links purge testable at all — that purge re-reads inside the transaction
// precisely so a stale cached snapshot cannot destroy a restored design, and a tx.get that always
// says "gone" would let a no-op purge pass as a working one.
export const runTransaction = (_db, fn) => {
  const e2e = globalThis.__E2E || (globalThis.__E2E = {});
  // window.__E2E.txDocs, when set, is what TRANSACTIONS see — i.e. the SERVER's view, which is
  // allowed to differ from the window.__E2E.docs the page loaded. That divergence is the whole
  // point of reading inside a transaction: Firestore runs here with persistentLocalCache, so a
  // load can be served from IndexedDB and be arbitrarily stale. Without a way to express "the
  // server disagrees with your snapshot", a re-check that reads the same stale data would look
  // like it was working.
  const find = (ref) => {
    const id = ref && ref.path ? String(ref.path).split('/').pop() : null;
    const rows = Array.isArray(e2e.txDocs) ? e2e.txDocs : (Array.isArray(e2e.docs) ? e2e.docs : []);
    return rows.find(r => r.id === id) || null;
  };
  const ts = (v) => (typeof v === 'number' && v >= 1e12 ? { toDate: () => new Date(v), toMillis: () => v } : v);
  const tx = {
    get: (ref) => {
      const row = find(ref);
      return Promise.resolve({
        exists: () => !!row,
        data: () => (row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k, ts(v)])) : {}),
      });
    },
    set: (/** @type {any} */ ref, /** @type {any} */ data) => {
      e2e.setWrites = e2e.setWrites || [];
      e2e.setWrites.push({ path: (ref && ref.path) || '', data, merge: false });
    },
    delete: (/** @type {any} */ ref) => {
      e2e.deletedPaths = e2e.deletedPaths || [];
      if (ref && ref.path) e2e.deletedPaths.push(String(ref.path));
      const id = ref && ref.path ? String(ref.path).split('/').pop() : null;
      if (id && Array.isArray(e2e.docs)) e2e.docs = e2e.docs.filter(r => r.id !== id);
    },
  };
  return Promise.resolve(fn(tx));
};
// Collection reads resolve EMPTY unless a test seeds rows via window.__E2E.docs (an array of
// { id, ...fields }). Any millisecond-number field is exposed as a Firestore-Timestamp-alike so card
// code calling .toDate()/.toMillis() works unchanged. Added v18.94 because there was no way to render
// an Operations card WITH DATA — which is how the reset-requests row shipped broken at 375px (its
// name column collapsed to 18px and text painted over the label).
// NOTE: this comment lives INSIDE the FIREBASE_STUB template literal — no backticks, ever.
// window.__E2E.docsDelayMs holds every collection read open for N ms — the lever that makes a
// read/delete INTERLEAVING reproducible rather than a matter of luck.
export const getDocs = () => {
  const e2e = globalThis.__E2E || {};
  const rows = e2e.docs;
  const wrap = (v) => (e2e.docsDelayMs ? new Promise(r => setTimeout(() => r(v), e2e.docsDelayMs)) : Promise.resolve(v));
  if (!rows) return wrap({ empty: true, size: 0, docs: [], forEach: noop });
  // Only EPOCH-SCALE numbers become Timestamps (>= 1e12 ms, i.e. after Sep 2001) — the same heuristic
  // the retired work-email check used for legacy stamps. Converting every number turned a seeded count: 4 into a
  // Timestamp object, so "asked 4 times" silently vanished from the card.
  const ts = (v) => (typeof v === 'number' && v >= 1e12 ? { toDate: () => new Date(v), toMillis: () => v } : v);
  const docs = rows.map(r => ({
    id: r.id,
    data: () => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, ts(v)])),
  }));
  return wrap({ empty: false, size: docs.length, docs, forEach: cb => docs.forEach(cb) });
};
//   window.__E2E = { failGetDoc: true }  → every single-doc read rejects. Used to prove the forced
//      set-password overlay FAILS OPEN when it can't read passwordStatus (password-force.js) — the
//      property that keeps a mandatory overlay from becoming a lockout.
// Phase 1 of the calendar's two-phase load (AUTH_PLAN.md -> E1) reads the LOCAL cache. For a QUERY the
// real SDK resolves with an EMPTY snapshot when nothing is cached (it is getDocFromCache, the
// single-doc form, that rejects) — so an empty resolve is the accurate default here. Either shape is
// safe: calendar-overrides.js treats empty and thrown identically. Seed via window.__E2E.cacheDocs.
export const getDocsFromCache = () => {
  const rows = (globalThis.__E2E || {}).cacheDocs;
  if (!rows) return Promise.resolve({ empty: true, size: 0, docs: [], forEach: noop });
  const docs = rows.map(r => ({ id: r.id, data: () => r }));
  return Promise.resolve({ empty: false, size: docs.length, docs, forEach: cb => docs.forEach(cb) });
};
// window.__E2E.getDocData seeds what a SINGLE-doc read RESOLVES WITH (v19.91). The default stays
// "does not exist", which is what every existing spec is written against — notably the Settings
// password chip, whose whole suite assumes an un-migrated member. Seeding it is how a spec reaches
// the opposite state: a member who set their password on ANOTHER device, which the server knows
// about and this device does not. There is no other route to that state, because it is defined
// entirely by what the server says.
export const getDoc = () => {
  const e2e = globalThis.__E2E || {};
  if (e2e.failGetDoc) return Promise.reject(Object.assign(new Error('e2e'), { code: 'unavailable' }));
  const seeded = e2e.getDocData;
  return Promise.resolve(seeded
    ? { exists: () => true, data: () => seeded }
    : { exists: () => false, data: () => ({}) });
};
export const addDoc = () => Promise.resolve(marker('docRef'));
// setDoc RECORDS its payload (v19.41), for the same reason writeBatch does: a test that can only
// see the UI is checking the SUMMARY of a write, not the write. The Links soft delete is exactly
// that trap — a hard delete and a soft delete BOTH make the design vanish from the picker, so
// asserting the chip is gone would pass against the very implementation being replaced. The
// payload is where the two differ.
export const setDoc = (/** @type {any} */ ref, /** @type {any} */ data, /** @type {any} */ opts) => {
  const e2e = globalThis.__E2E || (globalThis.__E2E = {});
  e2e.setWrites = e2e.setWrites || [];
  e2e.setWrites.push({ path: (ref && ref.path) || '', data, merge: !!(opts && opts.merge) });
  return Promise.resolve();
};
export const updateDoc = () => Promise.resolve();
// deleteDoc REMOVES the row from the seeded set (v18.97) instead of no-opping, so a card that
// deletes and then re-reads sees the delete. Without this there was no way to test the
// reset-requests refresh race: every reload returned the original rows, so a ghost row and a
// correctly-cleared one looked identical.
export const deleteDoc = (ref) => {
  const e2e = globalThis.__E2E || (globalThis.__E2E = {});
  // Record the path too (v19.41) so a test can assert a hard delete did NOT happen — the negative
  // is the whole claim of a soft delete.
  e2e.deletedPaths = e2e.deletedPaths || [];
  if (ref && ref.path) e2e.deletedPaths.push(String(ref.path));
  const id = ref && ref.path ? String(ref.path).split('/').pop() : null;
  if (id && Array.isArray(e2e.docs)) e2e.docs = e2e.docs.filter(r => r.id !== id);
  return Promise.resolve();
};
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
// currentUser is null by default — the stub never really signs anyone in, and a great many tests
// depend on that. A test that needs a signed-in Firebase user (e.g. to reach an admin Cloud Function
// caller, which bails with "Not signed in" before it ever fetches) opts in with
// window.__E2E = { authUser: true }; everything else is unchanged.
// NOTE: this comment lives INSIDE the FIREBASE_STUB template literal — no backticks, ever.
const _viewerUser = () => ({
    uid: 'calendar-viewer',
    isAnonymous: false,
    getIdTokenResult: () => Promise.resolve({
        token: 'e2e-viewer-token',
        claims: (globalThis.__E2E || {}).viewerClaimMissing ? {} : { calendarViewer: true },
    }),
});
const _currentUser = () => {
    const e2e = globalThis.__E2E || {};
    // The viewer flag lives in sessionStorage, not only on __E2E. That is not a convenience — it is
    // what makes the stub MODEL the thing under test: the real viewer runs on browserSessionPersistence,
    // so it must survive a reload and die with the browser context. A flag on window would be lost on
    // reload, and the "stays unlocked across a reload" spec would fail against correct code.
    // A MEMBER outranks the viewer, mirroring decideAccess's own precedence. A spec that seeds both
    // (the common case once seedViewerAccess is a blanket beforeEach) must get the member, or every
    // signed-in assertion would silently be testing viewer mode instead.
    // getIdToken as well as getIdTokenResult (v20.12). The admin Cloud-Function callers are split
    // between the two — operations' roster upload uses getIdToken(), the sign-in stats card uses
    // getIdTokenResult() — and a stub with only one of them fails whichever path it does not cover
    // with an unhelpful TypeError halfway through an upload.
    if (e2e.authUser) return {
        uid: 'test', isAnonymous: false,
        getIdToken: () => Promise.resolve('e2e-token'),
        getIdTokenResult: () => Promise.resolve({ token: 'e2e-token', claims: { admin: true } }),
    };
    let stored = false;
    try { stored = sessionStorage.getItem('__e2e_viewer') === '1'; } catch (_) { stored = false; }
    if (e2e.viewerUser || stored) return _viewerUser();
    return null;
};
export const getAuth = () => ({ get currentUser() { return _currentUser(); } });
// Emits the CURRENT user, not a hardcoded null (v20.12). calendar-access.js resolves the first
// emission to decide access, so a stub that always said null would report every seeded member and
// every restored viewer as locked out — and the whole PIN suite would pass for the wrong reason.
export const onAuthStateChanged = (_auth, cb) => { Promise.resolve().then(() => cb && cb(_currentUser())); return noop; };
export const signInWithEmailAndPassword = _e2eAuth('auth/invalid-credential');
export const createUserWithEmailAndPassword = _e2eAuth('auth/operation-not-allowed');
export const signInAnonymously = _e2eAuth('auth/operation-not-allowed');
// Clears the VIEWER only, never the opt-in authUser flag. authUser is a test's declaration
// that a member is signed in on this page, and session.js legitimately signs a restored identity
// out and back in during ensureFirebaseSession — so clearing it here made the member vanish
// mid-init and took the Operations Usage card down with it.
// NOTE: inside the FIREBASE_STUB template literal — no backticks, ever.
export const signOut = () => {
    const e2e = globalThis.__E2E || (globalThis.__E2E = {});
    e2e.signOutCount = (e2e.signOutCount || 0) + 1;
    e2e.viewerUser = false;
    try { sessionStorage.removeItem('__e2e_viewer'); } catch (_) { /* private mode */ }
    return Promise.resolve();
};
export const setPersistence = () => Promise.resolve();
// Staff Calendar PIN (v20.12). Signing in with a custom token flips a flag that getAuth reads back,
// so a spec can drive the REAL unlock path — fetch is stubbed separately per spec, because the
// exchange is an ordinary HTTPS call to a Cloud Function and Playwright can intercept it directly.
// window.__E2E.viewerClaimMissing makes the token sign in WITHOUT its claim: the one failure that
// looks completely successful and then has every override read denied.
// NOTE: inside the FIREBASE_STUB template literal — no backticks, ever.
export const signInWithCustomToken = (_auth, token) => {
    const e2e = globalThis.__E2E || (globalThis.__E2E = {});
    if (e2e.failCustomToken) return Promise.reject(Object.assign(new Error('e2e'), { code: 'auth/invalid-custom-token' }));
    e2e.viewerUser = true;
    e2e.lastCustomToken = token;
    try { sessionStorage.setItem('__e2e_viewer', '1'); } catch (_) { /* private mode */ }
    return Promise.resolve({ user: _viewerUser() });
};
export const indexedDBLocalPersistence = marker('idb');
export const browserLocalPersistence = marker('local');
export const browserSessionPersistence = marker('session');
// Chosen-password change flow (settings.html Password card, v18.63). These are imported at module
// scope by firebase-client.js, so they MUST be exported here or the whole module graph fails to link
// (a link error would blank every page under the stub). Only exercised when a password change runs.
// window.__E2E.hangPasswordWrite makes the password WRITE hang until the test releases it with
// window.__E2E_releasePasswordWrite(ok) (v18.97). This is the only way to reach the INDETERMINATE
// state in a browser: the deadline passes, the UI must say it could not confirm, and then the
// original call settles late — the case that used to be reported as a flat failure.
// NOTE: inside the FIREBASE_STUB template literal — no backticks, ever.
export const updatePassword = () => {
  if (!(globalThis.__E2E || {}).hangPasswordWrite) return Promise.resolve();
  return new Promise((resolve, reject) => {
    globalThis.__E2E_releasePasswordWrite = (ok) => (ok === false
      ? reject(Object.assign(new Error('e2e late failure'), { code: 'auth/network-request-failed' }))
      : resolve());
  });
};
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
 * Switch the staff Calendar PIN OFF for one test — the "deploy dark" state (v20.16).
 *
 * Rewrites `CONFIG.CALENDAR_PIN_ACCESS` in roster-data.js as it is served, the same way
 * `enforceNamedSession` does, so the real file and the production default are untouched. Call
 * BEFORE page.goto().
 * @param {import('@playwright/test').Page} page
 */
export async function disableCalendarPin(page) {
    _setConfigOverride(page, 'CALENDAR_PIN_ACCESS',
        /CALENDAR_PIN_ACCESS:\s*(?:true|false)/, 'CALENDAR_PIN_ACCESS: false');
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
