// @ts-check
/**
 * firebase-client.js — Single source of truth for Firebase initialisation.
 *
 * All app pages that use Firebase import from here, which means:
 *   - The project config (API key, project ID etc.) lives in one place only.
 *   - The Firebase SDK version appears in one place only — update it here
 *     and all pages pick up the change automatically.
 *   - Firebase is initialised once; the same `db` instance is shared.
 *
 * All Firestore operation functions (collection, getDocs, writeBatch etc.)
 * are re-exported so callers never need to import from the CDN directly.
 */

// @ts-ignore
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
// @ts-ignore
import { initializeFirestore, getFirestore, persistentLocalCache, collection, query, where, orderBy, limit, getDocs, getDocsFromCache, getDoc, addDoc, setDoc, deleteDoc, doc, serverTimestamp, writeBatch, runTransaction, onSnapshot, increment, updateDoc, deleteField, FieldPath } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
// firebase-storage (~30 kB) is dynamically imported via `_getStorageSdk()` (handed to the shared
// upload engine in documents-client.js, which is where the huddle/circular/newsletter sequence
// lives since v21.90) — only
// operations.html actually uploads files, so index.html, admin.html, and paycalc.html avoid the cost.
// @ts-ignore
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously, signInWithCustomToken, signOut, setPersistence, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { orderClientErrors, expiredResolvedIds, capUnresolvedErrors } from './client-errors.js';
import { runWithClaimRetry } from './claim-retry.js';
import { monthKey, prevMonthKey, sumDailyWindow, orderPageCounts, staleDailyKeys, originKey, summariseOrigins, staleOriginKeys } from './usage-stats.js';
import { perfSampleKey, summarisePerf } from './perf-stats.js';
import { APP_VERSION } from './roster-data.js';

// Boot-phase waypoint (v20.33): the moment this module's body runs is the moment the Firebase SDK
// has finished loading, parsing and executing — static imports execute before their importer's body.
// perf-reporter.js reads this mark to split a slow cold start into "reaching the app's engine" vs
// "the app's own modules after it" (the phases the App Speed card can now allocate). A mark, not an
// export, so nothing couples to it: absence simply records no phase samples.
try { performance.mark('myb-sdk-ready'); } catch { /* Performance API unavailable — phases skipped */ }

const firebaseConfig = {
    apiKey:            'AIzaSyBxB7eJ9LKkL5U9I9-IjNOVE_1RNeRGZWM',
    authDomain:        'myb-roster.firebaseapp.com',
    projectId:         'myb-roster',
    storageBucket:     'myb-roster.firebasestorage.app',
    messagingSenderId: '532910998075',
    appId:             '1:532910998075:web:b8360ba6a582554481921e'
};

const app = initializeApp(firebaseConfig);

/**
 * Shared Firestore database instance.
 * persistentLocalCache stores query results in IndexedDB so the app can
 * show last-seen data instantly on repeat visits while the network catches up.
 *
 * iOS Safari Private Browsing exposes `indexedDB` but operations may still
 * fail at init time. Wrap the call in try/catch so we fall back to the
 * default memory cache rather than breaking the whole app.
 */
/** @type {any} */
let db;
try {
    db = initializeFirestore(app, { localCache: persistentLocalCache() });
} catch (err) {
    console.warn('[Firebase] Persistent cache unavailable; using memory cache:', err);
    // getFirestore() returns the existing instance if initializeFirestore already
    // registered it internally before throwing — unlike a second initializeFirestore()
    // call, which would throw "Firestore has already been started".
    db = getFirestore(app);
}
export { db };

// Re-export Firestore operation functions so callers import from one place.
export {
    // queries
    collection, query, where, orderBy, limit,
    // reads
    // getDocsFromCache reads ONLY the persistent local cache: no network, and — because
    // Firestore rules are evaluated server-side — no rule evaluation either. That is what lets the
    // calendar paint before an auth session exists (AUTH_PLAN.md → E1). It REJECTS on a cache miss.
    getDocs, getDocsFromCache, getDoc, onSnapshot,
    // writes
    addDoc, setDoc, deleteDoc, doc, serverTimestamp, writeBatch, runTransaction,
    // `deleteField` re-exported v19.41 for the Links soft-delete RESTORE: clearing deletedAt/
    // deletedBy with a merge write leaves the rest of the document untouched, where a full setDoc
    // would replace patterns with whatever the restoring device happens to hold.
    deleteField,
};

/** Firestore collection name constants — single source of truth. Import these
 *  instead of bare string literals to prevent silent typos across modules.
 */
export const COLLECTIONS = {
    huddles:           'huddles',
    circulars:         'circulars',
    newsletters:       'newsletters',
    pushSubscriptions: 'pushSubscriptions',
    staffContact:      'staffContact',
    passwordStatus:    'passwordStatus',
    clientErrors:      'clientErrors',
    overrides:         'overrides',
    linkDesigns:       'linkDesigns',
    linkTargetSets:    'linkTargetSets',
    analytics:         'analytics',
    resetRequests:     'resetRequests',
};

// isSafeStorageUrl + isDocxUpload live in the pure, import-free storage-utils.js so they can be
// unit-tested directly (this module can't be imported in a Node test — it pulls the Firebase SDK
// from the gstatic CDN). isSafeStorageUrl is re-exported so existing `from './firebase-client.js'`
// importers (nav-panel, calendar-doc-viewer, the Huddle viewer) are unaffected; isDocxUpload is used
// internally by the upload paths. officeViewerUrl is re-exported for the DOCX circular/newsletter
// open path (nav-panel, calendar-doc-viewer).
import { isSafeStorageUrl, isDocxUpload, officeViewerUrl, legacyDocPath, versionedDocPath, uploadMimeType } from './storage-utils.js';
import { fetchWithTimeout, isFetchTimeout } from './fetch-timeout.js';
export { isSafeStorageUrl, officeViewerUrl };

// ---- Firebase Authentication ----

/** Shared Firebase Auth instance. */
export const auth = getAuth(app);

/**
 * Explicit persistence chain for a MEMBER identity: IndexedDB (longest-lived) → localStorage →
 * sessionStorage. iOS ITP can evict IndexedDB after 7 days of no PWA use, causing silent sign-outs,
 * so the fallbacks are real rather than theoretical.
 *
 * Factored into a function at v20.12 because there are now TWO persistence modes and the app has to
 * be able to move between them (see `setViewerPersistence`). Signing a member in after a Calendar
 * viewer session must restore THIS chain — and the member paths call it through
 * `restoreMemberPersistence`, never by repeating the three-step ladder, so the fallback order
 * cannot drift between the two call sites.
 * @returns {Promise<'indexeddb'|'local'|'session'>} the mode that took; rejects if none did
 */
function _setMemberPersistence() {
    // THE RESULT IS OBSERVABLE, AND TOTAL FAILURE IS NOT SUCCESS (v20.39, audit §25).
    // This used to swallow the final `.catch` and resolve with `undefined`, so a caller could not
    // distinguish "stored in IndexedDB" from "no persistence could be established at all" — every
    // outcome looked identical. That is tolerable for an ordinary member login (an in-memory session
    // still works for this tab) and NOT tolerable for the viewer↔member transitions, which reason
    // about which persistence mode the identity is in. Resolves with the mode that took; rejects if
    // none did, so a security-sensitive caller can fail closed.
    return setPersistence(auth, indexedDBLocalPersistence).then(() => /** @type {const} */ ('indexeddb'))
        .catch(() => setPersistence(auth, browserLocalPersistence).then(() => /** @type {const} */ ('local')))
        .catch(() => setPersistence(auth, browserSessionPersistence).then(() => /** @type {const} */ ('session')))
        .catch(/** @param {any} err */ err => {
            console.warn('[Auth] persistence setup failed:', err);
            throw err instanceof Error ? err : new Error('no persistence mode could be established');
        });
}

// PURE, and imported for the same reason session.js imports it: the question "is this identity the
// shared Calendar viewer?" must have ONE answer, and the boot-persistence decision below is a place
// where a second local copy of that predicate would be a second place a bypass could be introduced.
// calendar-access-core.js imports nothing, so this adds no cycle (import-graph.test.mjs).
import { isViewerUser } from './calendar-access-core.js';

/** Resolve the FIRST auth emission (the persisted-user restore), bounded so a wedged auth layer
 *  cannot hold `authReady` — and with it every page's boot — hostage. Local and minimal: the shared
 *  `restoreFirstAuthUser` lives in session.js, which imports THIS module, so using it here would be
 *  a cycle. On timeout resolves null, and the boot proceeds exactly as it would for a signed-out
 *  visitor. @returns {Promise<any>} */
function _firstAuthUserAtBoot() {
    return new Promise(resolve => {
        /** @type {null | (() => void)} */
        let unsub       = null;
        let settled     = false;
        let detachEarly = false;   // the listener fired before onAuthStateChanged returned
        // Same TDZ-safe detach shape as session.js's restoreFirstAuthUser, for the same reason:
        // Firebase does not emit synchronously, but a shape that would throw if it ever did does
        // not belong on the one promise every page's boot awaits.
        const detach = () => {
            if (unsub) { try { unsub(); } catch { /* already gone */ } unsub = null; }
            else detachEarly = true;
        };
        /** @type {any} */
        let timer;
        const finish = (/** @type {any} */ u) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            detach();
            resolve(u || null);
        };
        timer = setTimeout(() => finish(null), 8000);
        try { unsub = onAuthStateChanged(auth, (/** @type {any} */ u) => finish(u)); }
        catch { finish(null); }
        if (detachEarly) detach();
    });
}

// BOOT MUST NOT INHERIT THE STRICTER POLICY (v20.39). `_setMemberPersistence` rejects when no
// mode could be established, which is what the viewer↔member transitions need — but this promise is
// awaited at boot by every page, mostly without a catch, so propagating here would turn a rare
// storage failure into an unhandled rejection and a blank app. An in-memory session still works for
// the current tab, which is the right trade for ordinary use. Security-sensitive callers use
// `restoreMemberPersistence()` and get the rejection.
//
// ── THE RESTORED USER IS READ FIRST, AND THE CALENDAR VIEWER KEEPS SESSION PERSISTENCE ──────────
//
// This used to apply the member chain unconditionally, and that quietly broke the PIN feature's one
// security property. `setPersistence` MIGRATES the current user between stores (SDK: AuthImpl.
// setPersistence → getCurrentUser → removeCurrentUser → setCurrentUser under the new persistence) —
// so on any page load of a browser holding the shared Calendar viewer, the unconditional
// setPersistence(indexedDB) here lifted the viewer OUT of sessionStorage and INTO IndexedDB, where
// it survives the browser closing. One ordinary reload of an unlocked Calendar was enough, and the
// next person at a shared office PC then got the roster with no PIN. Measured in a real Chromium
// against the Auth emulator (experiments/viewer-persistence-proof/): unlock → reload → browser
// restart → still signed in; without the reload, correctly gone.
//
// So the boot now waits for the restore FIRST — which costs nothing, because setPersistence already
// queues behind the SDK's initialization and that initialization IS the restore — and only then
// chooses: the viewer re-asserts session-only persistence (a no-op when it is already there, and a
// MIGRATION BACK OUT of IndexedDB for any browser the old behaviour has already leaked into, which
// is what heals the office PCs affected before this fix); everyone else gets the member chain
// exactly as before. Member sign-ins that REPLACE a viewer are unaffected — they run through
// `shedCalendarViewer`, which signs the viewer out before calling `restoreMemberPersistence()`.
// ── ONE BOOT AUTHORITY (v21.29, external latency review) ────────────────────────────────────────
//
// The question "who did this browser restore?" was being asked THREE times, by three separate
// `onAuthStateChanged` subscriptions with three separate timeouts:
//
//   `_firstAuthUserAtBoot` here (8s)   → and it then THREW THE ANSWER AWAY, returning only the
//                                        persistence mode
//   `restoreFirstAuthUser` in session.js  → re-asked, for `reconcileExpiredIdentity`
//   `firstAuthUser` in calendar-access.js (6s) → re-asked again, for the access decision
//
// In normal operation Firebase answers a new subscriber immediately, so this cost nothing and was
// invisible. In the degraded case it COMPOUNDED: the Calendar gave the reconcile 6.5s and then gave
// its own restore another 6s, so one wedged auth layer could hold the access decision for ~12.5s.
//
// So the boot now resolves the pair — the restored user AND the persistence that was established for
// them — once, and everything downstream consumes it. `authReady` is unchanged in meaning and still
// yields the mode; it is now derived rather than separately computed.
/** @type {Promise<{ user: any, persistence: 'indexeddb'|'local'|'session'|'none' }>} */
export const authBootstrap = (async () => {
    const user = await _firstAuthUserAtBoot();
    if (isViewerUser(user)) {
        try { await setPersistence(auth, browserSessionPersistence); return { user, persistence: /** @type {const} */ ('session') }; }
        catch { return { user, persistence: /** @type {const} */ ('none') }; }
    }
    return { user, persistence: await _setMemberPersistence() };
})().catch(() => ({ user: null, persistence: /** @type {const} */ ('none') }));

// Unchanged in meaning: awaited before signing in, so persistence is configured before the auth
// token is written (otherwise iOS may drop the session). Derived now rather than separately computed.
export const authReady = authBootstrap.then(b => b.persistence);

/**
 * Who is signed in, once the one boot restore has had its chance?
 *
 * The shared replacement for "subscribe to `onAuthStateChanged` and wait for the first emission",
 * which is a BOOT-TIME question that three modules were each answering for themselves.
 *
 * **It returns ground truth, not the boot snapshot** — deliberately, and it is the reason this is
 * safe to share. Returning `authBootstrap`'s remembered user would resurrect an identity that has
 * signed out since boot, and two of the callers (`ensureFirebaseSession`, `admin-auth.js`) would
 * then believe a session exists when it does not. Waiting for the bootstrap and then reading
 * `auth.currentUser` answers the question the callers are actually asking, and Firebase sets
 * `currentUser` before it notifies listeners, so nothing is lost by reading it afterwards.
 *
 * Still bounded, because `setPersistence` sits inside the bootstrap and a storage layer that never
 * answers must not hold a page for ever. The bound no longer STACKS: whichever caller arrives first
 * pays the wait, and the rest find it settled.
 *
 * @param {number} [timeoutMs] how long to wait for the boot restore before answering from whatever
 *        is there. Callers with a deadline of their own pass their remaining budget.
 * @returns {Promise<any>} the signed-in user, or null
 */
export async function currentUserAfterBoot(timeoutMs = 8000) {
    if (auth.currentUser) return auth.currentUser;          // already known — no wait at all
    let timer;
    try {
        await Promise.race([
            authBootstrap,
            new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); }),
        ]);
    } catch { /* the bootstrap never rejects; a future change must not make this throw */ }
    finally { clearTimeout(timer); }
    return auth.currentUser || null;
}

/**
 * Re-arm the long-lived MEMBER persistence chain.
 *
 * Called by `session.js` immediately AFTER shedding a Calendar viewer and BEFORE signing a member
 * in. The order is the whole point: `setPersistence` migrates the CURRENT user into the new
 * persistence, so doing this while the viewer is still signed in would move the shared viewer
 * session into IndexedDB — where it would survive the browser closing, which is exactly the
 * property that makes unlocking a shared office PC safe to do.
 * @returns {Promise<'indexeddb'|'local'|'session'>} the mode that took; rejects if none did
 */
export function restoreMemberPersistence() { return _setMemberPersistence(); }

/**
 * Switch to SESSION-ONLY persistence, for the shared Calendar viewer.
 *
 * This is the security boundary of the whole PIN feature: the viewer must die with the browser
 * session so that a PC left signed into a Windows account does not carry the roster into the next
 * person's day. There is deliberately NO fallback ladder here — if session persistence cannot be
 * set, the correct outcome is a rejected promise and a failed unlock, because every fallback
 * available is LONGER-lived than what was asked for. Degrading a security boundary quietly is worse
 * than refusing to cross it.
 * @returns {Promise<void>}
 */
export function setViewerPersistence() { return setPersistence(auth, browserSessionPersistence); }

// Re-export auth operations so callers import from one place.
export { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously, signInWithCustomToken, signOut, onAuthStateChanged, updatePassword, reauthenticateWithCredential, EmailAuthProvider };

/**
 * Run a Firestore thunk (read OR write), self-healing a stale-claim `permission-denied` once
 * (SECURITY_RELEASE_PLAN.md → B3 "Live invariant — writeWithClaimRetry"; v15.07 review H3). The operation is
 * read/write-agnostic — `writeWithClaimRetry` is a back-compat alias for the many write call sites;
 * operations-app.js reads use `withClaimRetry` directly (it previously duplicated this as the
 * byte-identical `adminReadWithRetry`, v17.08).
 *
 * Why: a freshly-provisioned or claim-changed MANAGER can appear signed in yet hold a Firebase token
 * minted *before* their `manager` claim existed (Firebase only refreshes ID tokens ~hourly). The
 * per-member override-isolation rule then rejects their on-behalf write with `permission-denied`
 * until the token naturally refreshes. Forcing one token refresh + one retry picks up the claim
 * immediately, so the manager isn't told to "sign out and back in" for what is really a stale token.
 *
 * IMPORTANT: pass a thunk that BUILDS AND COMMITS a fresh batch each call — a Firestore `WriteBatch`
 * cannot be re-committed after `commit()` (even a failed commit marks it used), so the retry must
 * reconstruct the batch. Whatever the thunk returns is passed straight through.
 *
 * Fail-safe: only retries on `permission-denied` with a live user; any other error (offline, a
 * genuinely unauthorised token) is re-thrown, and it retries at most once so a truly forbidden write
 * still surfaces to the caller's catch.
 * @template T
 * @param {() => Promise<T>} fn  The read/write thunk; re-runnable (a write thunk must build a FRESH
 *   batch each call — a committed WriteBatch can't be re-committed). Its return value passes through.
 * @returns {Promise<T>}
 */
export async function withClaimRetry(fn) {
    // The retry DECISION (only `permission-denied` with a live user, at most once, preserve the
    // original error if the refresh itself fails) is the pure runWithClaimRetry in claim-retry.js,
    // unit-tested in claim-retry.test.mjs. This wrapper only injects the Firebase auth dependencies.
    return runWithClaimRetry(fn, {
        retryCode: 'permission-denied',
        hasUser: () => !!auth.currentUser,
        refresh: () => /** @type {any} */ (auth.currentUser).getIdToken(true),
    });
}

/** Back-compat alias for the write call sites (admin-overrides, admin-roster-upload, links-app, …).
 *  Identical to withClaimRetry — the retry is read/write-agnostic. */
export const writeWithClaimRetry = withClaimRetry;

/**
 * Run a Storage `uploadBytes`, self-healing a stale-claim `storage/unauthorized` once — the
 * Storage-side mirror of {@link writeWithClaimRetry}. Document uploads (huddle/circular/newsletter)
 * hit Storage BEFORE any Firestore write, so a just-re-provisioned admin whose ID token predates the
 * `admin` claim would fail the upload before the Firestore-side retry could ever run. Force one token
 * refresh + one retry so the claim is picked up immediately. Only retries `storage/unauthorized` with
 * a live user; any other error (offline, a genuinely forbidden account) is re-thrown, at most once, so
 * a truly unauthorised upload still surfaces to the caller. The versioned storageRef is stable, so the
 * retry simply re-attempts the same object.
 * @param {(ref:any, data:any, meta:any)=>Promise<any>} uploadBytes  the lazily-loaded SDK fn
 * @param {any} storageRef @param {any} file @param {any} metadata
 */
async function _uploadBytesWithClaimRetry(uploadBytes, storageRef, file, metadata) {
    // Storage-side mirror of withClaimRetry — same pure runner, keyed on `storage/unauthorized`.
    return runWithClaimRetry(() => uploadBytes(storageRef, file, metadata), {
        retryCode: 'storage/unauthorized',
        hasUser: () => !!auth.currentUser,
        refresh: () => /** @type {any} */ (auth.currentUser).getIdToken(true),
    });
}

// normaliseSurname + nameToEmail (the account-identity derivations) live in the pure, import-free
// auth-identity.js so they can be unit-tested directly (this module can't load in a Node test — it
// pulls the Firebase SDK from the gstatic CDN). Re-exported so existing importers (session.js) are
// unaffected. The deliberate functions/roster-parse-helpers.js duplicate + surname-parity.test.mjs
// source-equivalence check now read auth-identity.js.
import { normaliseSurname, nameToEmail, credentialCandidatesFor, isCredentialRejection } from './auth-identity.js';
import { resolveUploadCommit } from './upload-commit.js';
import { pruneOldDocs } from './doc-retention.js';
import { buildDocumentClient } from './documents-client.js';
export { normaliseSurname, nameToEmail };

// ---- Firebase Storage ----
// Storage SDK is loaded lazily on first call to uploadHuddle().
// Cached as a module-level promise so concurrent uploads share one fetch.
/** @type {any} */
let _storagePromise = null;
function _getStorageSdk() {
    if (!_storagePromise) {
        // @ts-ignore
        _storagePromise = import('https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js')
            .then(({ getStorage, ref, uploadBytes, getDownloadURL, deleteObject }) =>
                ({ storage: getStorage(app), ref, uploadBytes, getDownloadURL, deleteObject }))
            // Reset on rejection (v16.23): a rejected promise is truthy, so without this ONE
            // transient CDN failure was memoised forever — every later upload failed instantly
            // ("Upload failed — please try again" that could never succeed) until a full reload.
            .catch(err => { _storagePromise = null; throw err; });
    }
    return _storagePromise;
}

// ---- The three date-keyed document collections ----
// Huddle · Circular · Newsletter. The upload SEQUENCE — signature check, versioned path, and what
// a failed or ambiguous commit does to the file — moved to documents-client.js at v21.90. It takes
// every Firebase handle as an argument, which is both what keeps the import graph acyclic (this
// module re-exports it) and what lets the ordering be replayed in Node against fakes; the reasoning
// is in that module's header.
const _docs = buildDocumentClient({
    db, collections: COLLECTIONS,
    fs: {
        doc, getDoc, setDoc, collection, query, where, orderBy, limit,
        getDocs, onSnapshot, runTransaction, serverTimestamp,
    },
    getStorageSdk: _getStorageSdk,
    uploadBytesWithClaimRetry: _uploadBytesWithClaimRetry,
    utils: { isDocxUpload, uploadMimeType, legacyDocPath, versionedDocPath },
    resolveUploadCommit, pruneOldDocs,
});

export const uploadHuddle            = _docs.uploadHuddle;
export const uploadCircular          = _docs.uploadCircular;
export const uploadNewsletter        = _docs.uploadNewsletter;
export const getLatestCircular       = _docs.getLatestCircular;
export const getLatestNewsletter     = _docs.getLatestNewsletter;
export const subscribeToLatestHuddle = _docs.subscribeToLatestHuddle;

// ---- Push Notification Subscriptions ----

/**
 * Derive a short stable Firestore document ID from a push endpoint URL.
 * Uses SHA-256 so the endpoint URL (which can be very long) becomes a
 * fixed-length 20-char hex string safe to use as a document ID.
 * @param {string} endpoint
 * @returns {Promise<string>}
 */
async function endpointId(endpoint) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 20);
}

/**
 * Converts an ArrayBuffer from getKey() into a URL-safe base64 string for Firestore.
 * The spread is safe here: VAPID keys are always ≤65 bytes (p256dh) and 16 bytes
 * (auth), so the argument list never risks a stack overflow.
 */
/** @param {any} buffer */
function keyToBase64(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Save a browser PushSubscription to Firestore so the Cloud Function can
 * fan out notifications when a new Huddle is uploaded.
 * Overwrites any previous subscription for this device (same endpoint).
 * @param {PushSubscription} subscription
 */
export async function savePushSubscription(subscription) {
    const p256dh = subscription.getKey('p256dh');
    // Named authKey (not `auth`) so it can't shadow the module-level Firebase `auth` instance —
    // a future claim check added here would otherwise silently read this 16-byte key buffer. (v17.40)
    const authKey = subscription.getKey('auth');
    if (!p256dh || !authKey) {
        // Partially-initialised subscription — keys absent on some browsers/edge cases. THROW rather
        // than silently returning: a silent skip let the caller mark the device "subscribed" (fingerprint
        // + prompt-dismissed) with NO server record, so the bell showed "on" forever while the device got
        // no pushes and never self-healed (fanOutPush's 410 cleanup never runs — nothing was written).
        // The caller (notif.js subscribe) now rolls back the browser subscription on this throw. (review B2)
        console.warn('[pushSubscriptions] subscription missing p256dh/auth keys — not saved');
        throw new Error('push/subscription-missing-keys');
    }
    const id = await endpointId(subscription.endpoint);
    /** @type {Record<string, any>} */
    const data = {
        endpoint:     subscription.endpoint,
        keys: {
            p256dh: keyToBase64(p256dh),
            auth:   keyToBase64(authKey),
        },
        subscribedAt: serverTimestamp(),
    };
    // Stamp the owner (Firebase Auth uid) so only THIS identity can delete the subscription
    // (F-SEC-5 / A5). Optional in the rules for backward-compat, so omit it only in the
    // (rule-rejected) unauthenticated case rather than writing a null.
    const owner = auth.currentUser?.uid;
    if (owner) data.owner = owner;
    await setDoc(doc(db, COLLECTIONS.pushSubscriptions, id), data);
}

/**
 * Remove a push subscription from Firestore (user unsubscribed or revoked permission).
 * @param {string} endpoint
 */
export async function deletePushSubscription(endpoint) {
    if (!endpoint) return;
    const id = await endpointId(endpoint);
    await deleteDoc(doc(db, COLLECTIONS.pushSubscriptions, id));
}

// ---- Staff Contact ----

/**
 * Load a staff member's contact record from Firestore.
 * Returns the data object or null if no record exists yet.
 * @param {string} memberName
 * @returns {Promise<{memberName: string, workEmail: string, updatedAt?: import('firebase/firestore').Timestamp}|null>}
 */
export async function getStaffContact(memberName) {
    const snap = await getDoc(doc(db, COLLECTIONS.staffContact, memberName));
    return snap.exists() ? snap.data() : null;
}

/**
 * Save or overwrite a staff member's work email in Firestore.
 * May be called by the member themselves (via settings.html) or by an admin
 * on their behalf (via operations.html). Firestore rules allow both paths.
 * @param {string} memberName
 * @param {string} workEmail
 * @returns {Promise<void>}
 */
export async function saveStaffContact(memberName, workEmail) {
    // writeWithClaimRetry: staffContact writes require the member's own `name` claim. A
    // just-provisioned member (or one whose token predates the claim) would otherwise get an
    // unrecoverable permission-denied when saving their email before the ~hourly token
    // refresh — self-heal by forcing a refresh + one retry, like every other name-gated write.
    await writeWithClaimRetry(() => setDoc(doc(db, COLLECTIONS.staffContact, memberName), {
        memberName,
        workEmail,
        updatedAt: serverTimestamp(),
    }, { merge: true }));
}

/**
 * Delete a staff member's contact record from Firestore.
 * Allowed by Firestore rules for the owning member or an admin.
 * @param {string} memberName
 * @returns {Promise<void>}
 */
export async function deleteStaffContact(memberName) {
    await writeWithClaimRetry(() => deleteDoc(doc(db, COLLECTIONS.staffContact, memberName)));
}

/**
 * Fetch every staff contact record (admin-only — Firestore rules enforce this).
 * @returns {Promise<Array<{memberName: string, workEmail: string}>>}
 */
export async function getAllStaffContacts() {
    const snap = await getDocs(collection(db, COLLECTIONS.staffContact));
    return snap.docs.map(/** @param {any} d */ d => d.data());
}

// ---- Password migration status (PASSWORD_PLAN.md §6) ----
// `passwordStatus/{memberName}` (doc id = display name). `resetAt` is written ONLY by the
// resetMemberPassword Cloud Function (Admin SDK, bypasses rules); `passwordSetAt` is written by the
// member's own client after a successful updatePassword. Migrated ⇔ passwordSetAt newer than any
// resetAt. Kept SEPARATE from staffContact so the security-sensitive resetAt never shares a
// member-writable doc.

/**
 * Read a member's password-migration record. Owner or admin (Firestore rules).
 * @param {string} memberName
 * @returns {Promise<{ resetAt?: any, passwordSetAt?: any } | null>}
 */
export async function getPasswordStatus(memberName) {
    const snap = await getDoc(doc(db, COLLECTIONS.passwordStatus, memberName));
    return snap.exists() ? snap.data() : null;
}

/**
 * The member marks their own account as migrated, right after a successful `updatePassword`. `merge`
 * preserves any server-written `resetAt`; the rules require ONLY `passwordSetAt` to change and pin it
 * to the server clock (request.time), so a wrong device clock can't fake ordering against `resetAt`.
 * Name-gated write → writeWithClaimRetry self-heals a stale claim.
 * @param {string} memberName
 * @returns {Promise<void>}
 */
export async function savePasswordSetAt(memberName) {
    await writeWithClaimRetry(() => setDoc(doc(db, COLLECTIONS.passwordStatus, memberName), {
        passwordSetAt: serverTimestamp(),
    }, { merge: true }));
}

/**
 * Every password-status record (admin-only — Firestore rules enforce). Doc id is the member name.
 * @returns {Promise<Array<{ memberName: string, resetAt?: any, passwordSetAt?: any }>>}
 */
export async function getAllPasswordStatus() {
    const snap = await getDocs(collection(db, COLLECTIONS.passwordStatus));
    return snap.docs.map(/** @param {any} d */ d => ({ memberName: d.id, ...d.data() }));
}

/**
 * Re-authenticate the currently signed-in member with their typed CURRENT password — required by
 * Firebase before `updatePassword`. Uses the same GATED candidate list as sign-in (auth-identity), so
 * an un-migrated member typing their surname (any case / short-surname padding) reauths correctly.
 * @param {string} memberName
 * @param {string} typed
 * @returns {Promise<void>} resolves on success; rejects with the last Firebase error otherwise
 */
export async function reauthenticateWithPassword(memberName, typed) {
    const user = auth.currentUser;
    if (!user || !user.email) throw new Error('Not signed in');
    const candidates = credentialCandidatesFor(memberName, typed);
    if (!candidates.length) throw Object.assign(new Error('empty password'), { code: 'auth/missing-password' });
    let lastErr;
    for (const pw of candidates) {
        try {
            await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, pw));
            return;
        } catch (e) {
            lastErr = e;
            // Only fall through to the NEXT candidate on a DEFINITIVE credential rejection (mirrors the
            // sign-in ladder, session.js). A transient failure — network / rate-limit / provider outage /
            // requires-recent-login — must stop immediately: retrying the surname candidate would
            // duplicate traffic, worsen rate-limiting, and return a misleading final error
            // (PASSWORD_PLAN.md §3.2). The one shared classifier keeps the two ladders in step.
            if (!isCredentialRejection(/** @type {any} */ (e)?.code)) break;
        }
    }
    throw lastErr;
}

/**
 * Set the signed-in member's OWN Firebase Auth password to a new value (after a fresh reauth), then
 * stamp `passwordSetAt`. Standard secure client flow — the server never sees the password.
 *
 * Ordering matters: the `passwordSetAt` stamp is a SEPARATE Firestore write that can fail
 * independently of the (already-committed) password change (transient/`unavailable`, a
 * `permission-denied` surviving the claim retry, an offline queue rejection). If a stamp failure
 * were allowed to reject this function, the caller would surface "password change failed" — telling
 * the user to retry with a password that NO LONGER EXISTS and routing a Firestore error into the
 * "current password incorrect" branch, leaving them stuck. So a stamp failure is swallowed and
 * reported via `statusRecorded:false` — the password genuinely changed either way; only the
 * migration record (a monitoring signal, not a security control) is missing and self-heals on the
 * next successful set.
 * @param {string} memberName
 * @param {string} newPassword
 * @returns {Promise<{ statusRecorded: boolean }>} `statusRecorded` is false when the password
 *   changed but the migration stamp did not persist.
 */
export async function setOwnPassword(memberName, newPassword) {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in');
    await updatePassword(user, newPassword);   // (A) the password is now genuinely changed
    try {
        await savePasswordSetAt(memberName);   // (B) record migration — best-effort, must not undo (A)
        return { statusRecorded: true };
    } catch (e) {
        console.warn('[Auth] password changed, but passwordSetAt stamp failed:', e);
        return { statusRecorded: false };
    }
}

/** Admin-only Cloud Function that resets a member's Firebase password back to their surname default
 *  and stamps `passwordStatus.resetAt` (server-side). Mirrors admin-auth.js's setupRosterAuth caller:
 *  a FRESH admin ID token as a Bearer header on every call. */
const RESET_PASSWORD_URL = 'https://europe-west2-myb-roster.cloudfunctions.net/resetMemberPassword';

/**
 * Reset a member's password to the surname default (admin break-glass). Requires the caller's admin
 * claim (enforced server-side). `revoke` signs the member out of their other devices — true for a
 * real reset, false for a Phase-2 migration nudge.
 * @param {string} memberName
 * @param {{ revoke?: boolean }} [opts]
 * @returns {Promise<any>} the function's JSON response
 */
export async function resetMemberPassword(memberName, { revoke = true } = {}) {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in');
    const { token } = await user.getIdTokenResult(/* forceRefresh */ true);
    // 65s: above the endpoint's own 60s ceiling (see fetch-timeout.js — a client that gives up
    // first reports a working server as broken).
    let r;
    try {
        r = await fetchWithTimeout(RESET_PASSWORD_URL, {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ member: memberName, revoke }),
        }, 65_000);
    } catch (err) {
        // A WRITE. The abort stopped us waiting, not the server working, so this must not claim the
        // reset did not happen — the admin needs to go and look rather than reset a second time.
        if (isFetchTimeout(err)) throw new Error('Timed out waiting for the server — the reset may still have gone through. Check Account status before trying again.', { cause: err });
        throw err;
    }
    if (!r.ok) { const e = await r.text(); throw new Error(`Server responded ${r.status}: ${e}`); }
    return r.json();
}

/** Admin-only Cloud Function returning the EXACT unique-account sign-in counts (v18.96). */
const SIGN_IN_STATS_URL = 'https://europe-west2-myb-roster.cloudfunctions.net/getSignInStats';

/**
 * How many distinct accounts have actually signed in (admin only — enforced server-side).
 *
 * The counterpart to `getUsageStats`'s active-account figure, which is deduped on the DEVICE and so
 * counts a member with a phone and a laptop twice. This one is exact because Firebase Auth already
 * holds one `lastSignInTime` per account — uniqueness is a property of the data, so no new
 * per-account record has to be stored to get it. The response is four integers; no identity is
 * returned. Read-only, hence GET.
 *
 * @returns {Promise<{ total: number, last7: number, last30: number, neverSignedIn: number }>}
 */
export async function getSignInStats() {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in');
    const { token } = await user.getIdTokenResult(/* forceRefresh */ true);
    // A READ, so a timeout may say plainly that it failed. 65s clears the 60s server ceiling.
    const r = await fetchWithTimeout(SIGN_IN_STATS_URL, {
        method:  'GET',
        headers: { 'Authorization': `Bearer ${token}` },
    }, 65_000);
    if (!r.ok) { const e = await r.text(); throw new Error(`Server responded ${r.status}: ${e}`); }
    return r.json();
}

/** The public `requestPasswordReset` endpoint (PASSWORD_PLAN.md — the request queue). */
const REQUEST_RESET_URL = 'https://europe-west2-myb-roster.cloudfunctions.net/requestPasswordReset';

/**
 * Ask the admin to reset a member's password. Called from the LOGIN OVERLAY, by someone who is
 * therefore NOT signed in — so unlike every other function caller here it sends **no auth token**.
 * That is the whole reason this route exists as a server endpoint: a locked-out member has no Firebase
 * identity, so they cannot write to Firestore at all (the `resetRequests` rules deny every client
 * write). The endpoint validates the name against the server-owned roster and records a request; it
 * never resets anything.
 * @param {string} memberName  the name the member picked in the login dropdown (never free-typed)
 * @returns {Promise<any>}
 */
export async function requestPasswordReset(memberName) {
    // 35s: above the endpoint's own 30s ceiling. This is the call the review named — a stalled
    // transport left the login card's button on "Sending…" indefinitely, with no way back.
    let r;
    try {
        r = await fetchWithTimeout(REQUEST_RESET_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ member: memberName }),
        }, 35_000);
    } catch (err) {
        // The request MAY have been recorded — the server writes the row before responding. So the
        // login overlay's copy for this case says "couldn't confirm", never "not sent"; a member
        // told it failed would ask again, and the throttle would then silently drop the repeat.
        if (isFetchTimeout(err)) throw new Error('Timed out waiting for the server — your request may still have been sent.', { cause: err });
        throw err;
    }
    if (!r.ok) { const e = await r.text(); throw new Error(`Server responded ${r.status}: ${e}`); }
    return r.json();
}

/**
 * All outstanding password-reset requests, newest first (admin only — enforced by the rules).
 * @returns {Promise<Array<{memberName: string, requestedAt?: any, count?: number, provisioned?: boolean}>>}
 */
export async function getResetRequests() {
    const snap = await getDocs(collection(db, COLLECTIONS.resetRequests));
    return snap.docs
        // memberName AFTER the spread (v18.94): the doc ID is the thing the rules and the endpoint
        // actually bound, so it must win over a field that could in principle differ. With the old
        // order, Clear deleted `resetRequests/<field>` — a no-op Firestore reports as success, so a
        // divergent row would silently reappear on every re-render and be unclearable.
        .map(/** @param {any} d */ d => ({ ...d.data(), memberName: d.id }))
        .sort((/** @type {any} */ a, /** @type {any} */ b) =>
            (b.requestedAt?.toMillis?.() ?? 0) - (a.requestedAt?.toMillis?.() ?? 0));
}

/**
 * Clear one request once the admin has actioned it (admin-only delete per the rules).
 * @param {string} memberName
 * @returns {Promise<void>}
 */
export async function clearResetRequest(memberName) {
    await withClaimRetry(() => deleteDoc(doc(db, COLLECTIONS.resetRequests, memberName)));
}

// ---- Client Error Reporting ----

/**
 * Write a client-side uncaught error to Firestore.
 * Called by error-reporter.js — fire-and-forget, never throws.
 * @param {{ memberName: string, page: string, message: string, stack: string, appVersion: string, userAgent: string }} data
 */
export function logClientError({ memberName, page, message, stack, appVersion, userAgent }) {
    addDoc(collection(db, COLLECTIONS.clientErrors), {
        memberName, page, message, stack, appVersion, userAgent,
        timestamp: serverTimestamp(),
        resolved:  false,
    }).catch(() => {/* swallow — never throw from an error reporter */});
}

/**
 * Fetch client error records for the admin error log (admin-only).
 *
 * Unresolved errors get their OWN equality query, prioritised ahead of resolved ones —
 * the previous single newest-first window could hide them once 100 resolved records
 * piled up. Within expected operational volume (< 100 unresolved at once) none are missed. Resolved
 * records are fetched with a bounded query and used both for display context and to
 * prune anything past the post-resolution retention window, so the collection stays
 * bounded at this app's scale (not just the newest rows being cleaned up).
 *
 * Both queries are single-field equality filters (auto-indexed) — no composite index.
 * Ordering and retention are pure logic in client-errors.js (unit-tested); this
 * function is only the Firestore I/O around them.
 *
 * The unresolved query is capped at `UNRESOLVED_CAP` shown, with NO `orderBy` (that would
 * need the composite index this design deliberately avoids), so once the cap is exceeded the
 * shown set is an arbitrary — not the newest — 100. That only happens above the documented
 * operating volume (< 100 unresolved), but the error log is the admin's own "see problems"
 * surface, so a genuinely-hidden overflow must be surfaced, never silently swallowed (the
 * app's no-silent-caps rule). We query `CAP + 1` and set `truncated` only when the extra row
 * comes back (i.e. > 100 actually exist) — exactly 100 with none hidden is NOT truncated.
 * @returns {Promise<{ errors: Array<{id: string, memberName: string, page: string, message: string, stack: string, appVersion: string, userAgent: string, timestamp: import('firebase/firestore').Timestamp, resolved: boolean, resolvedAt?: import('firebase/firestore').Timestamp}>, truncated: boolean }>}
 */
export async function getClientErrors() {
    const now = Date.now();
    const UNRESOLVED_CAP = 100;
    // Fetch ONE more than the display cap: if the 101st exists we KNOW there are more than
    // 100 (truncated), whereas a plain limit(100) can't tell "exactly 100" from "100+".
    const [unresolvedSnap, resolvedSnap] = await Promise.all([
        getDocs(query(collection(db, COLLECTIONS.clientErrors), where('resolved', '==', false), limit(UNRESOLVED_CAP + 1))),
        getDocs(query(collection(db, COLLECTIONS.clientErrors), where('resolved', '==', true),  limit(200))),
    ]);
    // Pure truncation split (client-errors.capUnresolvedErrors, unit-tested): show at most the cap;
    // `truncated` is true only when the (cap+1)th row came back, i.e. > cap genuinely exist.
    const { shown: unresolvedDocs, truncated } = capUnresolvedErrors(unresolvedSnap.docs, UNRESOLVED_CAP);
    const unresolved = unresolvedDocs.map(/** @param {any} d */ d => ({ id: d.id, ...d.data() }));
    const resolved   = resolvedSnap.docs.map(/** @param {any} d */ d => ({ id: d.id, ...d.data() }));

    // Best-effort prune of resolved records past the retention window (from resolvedAt).
    for (const id of expiredResolvedIds(resolved, now)) {
        deleteDoc(doc(db, COLLECTIONS.clientErrors, id)).catch(() => {/* best-effort cleanup */});
    }
    return { errors: orderClientErrors(unresolved, resolved, now), truncated };
}

/**
 * Mark a client error record as resolved, stamping the resolution time so retention is
 * measured from when it was resolved (not when the error occurred).
 * @param {string} id - Firestore document ID
 */
export async function resolveClientError(id) {
    // clientErrors is admin-only. Wrap in writeWithClaimRetry so a just-re-provisioned admin whose
    // ID token hasn't refreshed self-heals (force-refresh + retry once) instead of a dead Resolve
    // button — parity with every other admin write path.
    await writeWithClaimRetry(() => setDoc(doc(db, COLLECTIONS.clientErrors, id), { resolved: true, resolvedAt: serverTimestamp() }, { merge: true }));
}

// ── Anonymous usage analytics ──────────────────────────────────────────────────
// Aggregate integer counters only — no member identity is ever stored. Page popularity
// lives in one doc per month (analytics/pv_<YYYY-MM>); active-account counts live in a
// single analytics/activeAccounts doc. Uniqueness of active accounts is deduped on the
// client (usage-reporter.js) so these writes only ever carry "+1". All writes are
// fire-and-forget — usage tracking must never affect the app. Decision math is the pure
// usage-stats.js module; this is just the Firestore I/O. See ROADMAP_HISTORY.md → "Usage analytics".

/**
 * Increment the anonymous page-view counter for the current month.
 * @param {string} pageId - stable page id ('calendar', 'admin', 'paycalc', …)
 */
export function recordPageView(pageId) {
    const m = monthKey(new Date());
    setDoc(
        doc(db, COLLECTIONS.analytics, `pv_${m}`),
        { month: m, counts: { [pageId]: increment(1) } },
        { merge: true },
    ).catch(() => {/* best-effort analytics */});
}

/**
 * Increment the anonymous active-account counters. The caller (usage-reporter.js) has
 * already decided, from client-side dedup, whether this account is new this month
 * and/or new within the rolling window — pass the bucket key for each that should tick.
 * @param {{ month?: string|null, day?: string|null }} buckets
 */
export function recordActiveAccount({ month = null, day = null } = {}) {
    /** @type {Record<string, any>} */
    const data = {};
    if (month) data.months = { [month]: increment(1) };
    if (day)   data.daily  = { [day]:   increment(1) };
    if (!month && !day) return;
    setDoc(doc(db, COLLECTIONS.analytics, 'activeAccounts'), data, { merge: true })
        .catch(() => {/* best-effort analytics */});
}

/**
 * Increment the anonymous per-ADDRESS counters (v19.23) — `analytics/origins` = `{ daily: {…} }`,
 * keyed `YYYY-MM-DD|<origin>` and `YYYY-MM-DD|<origin>|pwa`. Answers "how far through the move off
 * the GitHub Pages mirror are we", which nothing recorded before. No identity: uniqueness is deduped
 * client-side in usage-reporter.js, so the server only ever sees "+1".
 *
 * A SEPARATE DOC from `activeAccounts`, deliberately. That doc's rule pins it to
 * `hasOnly(['months','daily'])` and Firestore evaluates the RESULTING document — so the moment a
 * client wrote an extra key there, the doc would permanently contain it and every later write,
 * including the existing counters, would be denied until the rules deploy caught up. Hosting and
 * rules ship from the same push via separate workflows with no ordering guarantee, so that window is
 * real. Here, a rules lag costs only the new metric.
 *
 * The two counters are gated INDEPENDENTLY by the caller: `countVisit` false with `installed` true
 * is the real case where an account already counted as a visit this window has now opened the
 * installed app for the first time. Incrementing the visit again there would break the "unique
 * accounts" guarantee the whole metric rests on.
 *
 * @param {{ day: string, origin: string, installed?: boolean, countVisit?: boolean }} o
 */
export function recordOriginUse({ day, origin, installed = false, countVisit = true }) {
    if (!day || !origin) return;
    /** @type {Record<string, any>} */
    const daily = {};
    if (countVisit) daily[originKey(day, origin)] = increment(1);
    if (installed)  daily[originKey(day, origin, true)] = increment(1);
    if (!Object.keys(daily).length) return;
    setDoc(doc(db, COLLECTIONS.analytics, 'origins'), { daily }, { merge: true })
        .catch(() => {/* best-effort analytics */});
}

/**
 * Increment an anonymous page-load latency counter (Project 0 instrumentation). Lives in one doc per
 * month, `analytics/perf_<YYYY-MM>`, as `{ month, samples: { <key>: int } }`. The key bundles only
 * non-identifying dimensions (app version, page, metric, duration BUCKET, PWA mode, connection class)
 * — never a member or a raw millisecond value. Decision/bucketing maths is the pure perf-stats.js
 * module; this is just the Firestore I/O. Fire-and-forget — telemetry must never affect the app.
 * @param {{ page: string, metric: string, bucket: string, mode: string, conn: string }} sample
 */
export function recordPerfSample({ page, metric, bucket, mode, conn }) {
    if (!bucket) return;
    const m = monthKey(new Date());
    const key = perfSampleKey({ version: APP_VERSION, page, metric, bucket, mode, conn });
    setDoc(
        doc(db, COLLECTIONS.analytics, `perf_${m}`),
        { month: m, samples: { [key]: increment(1) } },
        { merge: true },
    ).catch(() => {/* best-effort analytics */});
}

/**
 * Read latency for the Operations "App speed" card (admin-only), for THIS month and LAST month (the
 * comparison window — trend across deploys, and a stable reference early in a month). Each window
 * carries plain-language quick/ok/slow summaries for THREE journeys: `login` (sign-in to usable),
 * `fcp` (a page first appearing on screen), `pages` (the page's CODE finishing — the 'domReady'
 * metric) and `ready` (the page's own content on screen — v20.80). Computed by the pure perf-stats
 * module. No identity is involved.
 * @returns {Promise<{ thisMonth: PerfWindow, lastMonth: PerfWindow }>}
 * @typedef {{ month: string, login: ReturnType<typeof summarisePerf>, fcp: ReturnType<typeof summarisePerf>, pages: ReturnType<typeof summarisePerf>, ready: ReturnType<typeof summarisePerf>, samples: Record<string, number> }} PerfWindow
 */
export async function getPerfStats() {
    const now = new Date();
    const m = monthKey(now);
    const pm = prevMonthKey(now);
    const [thisSnap, lastSnap] = await Promise.all([
        getDoc(doc(db, COLLECTIONS.analytics, `perf_${m}`)),
        getDoc(doc(db, COLLECTIONS.analytics, `perf_${pm}`)),
    ]);
    /** @param {any} snap @param {string} month @returns {PerfWindow} */
    const windowFor = (snap, month) => {
        const samples = (snap.exists() ? /** @type {any} */ (snap.data()) : {}).samples || {};
        return {
            month,
            login: summarisePerf(samples, { metric: 'loginTotal' }),
            fcp:   summarisePerf(samples, { metric: 'fcp' }),
            pages: summarisePerf(samples, { metric: 'domReady' }),
            // 'ready' — the page's content actually on screen (perf-reporter.markPageReady, v20.80).
            // A different population from the three above: only pages that mark it appear here, so
            // its `total` is legitimately smaller and the card says so rather than hiding the bar.
            ready: summarisePerf(samples, { metric: 'ready' }),
            // The RAW map, carried through so the card can break the busiest page down by
            // connection / install mode / version (`summarisePerfBy`). Summarising every dimension
            // here instead would mean deciding in the data layer which page the admin is asking
            // about, and re-reading the document to change that answer. The map is a few hundred
            // small integer counters and is already in memory.
            samples,
        };
    };
    return { thisMonth: windowFor(thisSnap, m), lastMonth: windowFor(lastSnap, pm) };
}

/**
 * Read the usage figures for the Operations "Usage" card (admin-only). Also prunes
 * daily buckets outside the retention window, fire-and-forget, so the rolling doc
 * stays bounded (mirrors the resolved-error prune in getClientErrors).
 * @returns {Promise<{ month: string, prevMonth: string, pageCounts: Array<{page: string, count: number}>, prevPageCounts: Array<{page: string, count: number}>, accountsThisMonth: number, accountsLast30: number, monthsHistory: Record<string, number>, origins: Array<{origin: string, accounts: number, installed: number}> }>}
 */
export async function getUsageStats() {
    const now = new Date();
    const m = monthKey(now);
    const pm = prevMonthKey(now);
    const [pvSnap, pvPrevSnap, aaSnap, orgSnap] = await Promise.all([
        getDoc(doc(db, COLLECTIONS.analytics, `pv_${m}`)),
        getDoc(doc(db, COLLECTIONS.analytics, `pv_${pm}`)),
        getDoc(doc(db, COLLECTIONS.analytics, 'activeAccounts')),
        // Missing until the first write after v19.23 — an absent doc is the empty picture, not an error.
        getDoc(doc(db, COLLECTIONS.analytics, 'origins')).catch(() => null),
    ]);
    const pv = pvSnap.exists() ? /** @type {any} */ (pvSnap.data()) : { counts: {} };
    const pvPrev = pvPrevSnap.exists() ? /** @type {any} */ (pvPrevSnap.data()) : { counts: {} };
    const aa = aaSnap.exists() ? /** @type {any} */ (aaSnap.data()) : { months: {}, daily: {} };
    const daily = aa.daily || {};

    // Best-effort prune of daily buckets past the retention window. Wrapped in try/catch
    // and using FieldPath (literal segments) — NOT a `daily.<key>` dotted string. A day key
    // like "2026-06-25" is an INVALID dotted field path (a segment may not start with a digit
    // or contain hyphens), so updateDoc would throw SYNCHRONOUSLY, bypass the `.catch`, and
    // reject getUsageStats — breaking the whole Usage card. The prune must never do that.
    try {
        const stale = staleDailyKeys(daily, now);
        if (stale.length) {
            const ref = doc(db, COLLECTIONS.analytics, 'activeAccounts');
            stale.forEach(k => {
                updateDoc(ref, new FieldPath('daily', k), deleteField()).catch(() => {/* best-effort */});
            });
        }
    } catch (_e) { /* prune is best-effort — never let it break the usage read */ }

    // Same prune for the per-address counters, on the same terms (FieldPath, never a dotted string —
    // an origin key contains hyphens AND a `|`, so a dotted path would throw synchronously).
    const originDaily = (orgSnap && orgSnap.exists() ? /** @type {any} */ (orgSnap.data()).daily : null) || {};
    try {
        const staleO = staleOriginKeys(originDaily, now);
        if (staleO.length) {
            const ref = doc(db, COLLECTIONS.analytics, 'origins');
            staleO.forEach(k => {
                updateDoc(ref, new FieldPath('daily', k), deleteField()).catch(() => {/* best-effort */});
            });
        }
    } catch (_e) { /* prune is best-effort */ }

    return {
        month: m,
        prevMonth: pm,
        pageCounts: orderPageCounts(pv.counts || {}),
        prevPageCounts: orderPageCounts(pvPrev.counts || {}),
        accountsThisMonth: Number((aa.months || {})[m]) || 0,
        accountsLast30: sumDailyWindow(daily, now),
        monthsHistory: aa.months || {},
        origins: summariseOrigins(originDaily, now),
    };
}
