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
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
// @ts-ignore
import { initializeFirestore, getFirestore, persistentLocalCache, collection, query, where, orderBy, limit, getDocs, getDocsFromCache, getDoc, getDocFromCache, getDocFromServer, addDoc, setDoc, deleteDoc, doc, serverTimestamp, writeBatch, runTransaction, onSnapshot, increment, updateDoc, deleteField, FieldPath, waitForPendingWrites } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
// firebase-storage (~30 kB) is dynamically imported via `_getStorageSdk()` (handed to the shared
// upload engine in documents-client.js) — only operations.html uploads files, so the other pages
// avoid the cost.
// @ts-ignore
import { initializeAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import { runWithClaimRetry, runWatchedClaimRetry, abandonOnSignOut, runGatedWrite, trackBackgroundWrite, ownWritesSent, ownWritesSentFor } from './claim-retry.js';
import { buildAnalyticsClient } from './analytics-client.js';
import { APP_VERSION } from './roster-data.js';

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
    // calendar paint before an auth SESSION exists (AUTH_AND_SESSIONS.md → "The two-phase load (E1)") — but not before Auth has
    // initialised, which for a stored user is after `accounts:lookup` (CALENDAR_DATA.md 10). REJECTS on a miss.
    // getDocFromCache is its single-document form, for the Link Designer store's offline consult: offline,
    // plain getDoc rejects for a document the cache KNOWS was deleted exactly as for one it never
    // held, and this one tells them apart — a recorded deletion resolves as not existing, a miss REJECTS.
    getDocs, getDocsFromCache, getDoc, getDocFromCache, onSnapshot,
    // writes
    addDoc, setDoc, deleteDoc, doc, serverTimestamp, writeBatch, runTransaction,
    // `deleteField` for the Link Designer soft-delete RESTORE: clearing deletedAt/deletedBy with a merge write
    // leaves the rest of the document untouched, where a full setDoc would replace patterns with
    // whatever the restoring device happens to hold.
    deleteField,
};

/** Firestore collection name constants — single source of truth. Import these
 *  instead of bare string literals to prevent silent typos across modules. */
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
    alUploads:         'alUploads',
};

// isSafeStorageUrl + isDocxUpload live in the pure, import-free storage-utils.js so they can be
// unit-tested directly (this module can't be imported in a Node test — it pulls the Firebase SDK
// from the gstatic CDN). isSafeStorageUrl and resolveDocumentOpenUrl are re-exported for existing
// importers; the openers call resolveDocumentOpenUrl, which applies the .docx wrap.
import { isSafeStorageUrl, isDocxUpload, resolveDocumentOpenUrl, legacyDocPath, versionedDocPath, uploadMimeType } from './storage-utils.js';
import { fetchWithTimeout } from './fetch-timeout.js';
import { requestSignedDocumentUrl } from './document-url.js';
import { functionUrl } from './function-url.js';
export { isSafeStorageUrl, resolveDocumentOpenUrl };

// ---- Firebase Authentication ----

/**
 * Shared Firebase Auth instance — `initializeAuth`, NOT `getAuth`.
 * `getAuth` adds the popup/redirect resolver, which on mobile, Safari and iOS the SDK initialises
 * proactively and AWAITS before restoring the user (auth 1.13.6: `_shouldInitProactively`) — loading
 * `apis.google.com` and a `firebaseapp.com` iframe, up to 30s on a dead connection, ahead of every
 * `authReady`, Admin save and Calendar decision. This app never uses a popup or redirect. The
 * persistence list is `getAuth`'s own, in its order, so a restore behaves exactly as before.
 */
export const auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
});

/**
 * Explicit persistence chain for a MEMBER identity: IndexedDB (longest-lived) → localStorage →
 * sessionStorage. On iPhones an IndexedDB read can fail (WebKit closes IndexedDB connections in
 * hidden pages), so the fallbacks are real rather than theoretical. Safari's seven-day rule is NOT
 * that case: it deletes all of a tab's storage together, these fallbacks included (KNOWN_LIMITATIONS
 * → "One interaction to expect on iOS").
 *
 * A function so the boot path calls it rather than repeating the three-step ladder.
 * @returns {Promise<'indexeddb'|'local'|'session'>} the mode that took; rejects if none did
 */
function _setMemberPersistence() {
    // THE RESULT IS OBSERVABLE, AND TOTAL FAILURE IS NOT SUCCESS (audit §25). Resolves with the mode
    // that took; rejects if none did. A member login can tolerate an in-memory session, so boot catches
    // the rejection (`authBootstrap`).
    return setPersistence(auth, indexedDBLocalPersistence).then(() => /** @type {const} */ ('indexeddb'))
        .catch(() => setPersistence(auth, browserLocalPersistence).then(() => /** @type {const} */ ('local')))
        .catch(() => setPersistence(auth, browserSessionPersistence).then(() => /** @type {const} */ ('session')))
        .catch(/** @param {any} err */ err => {
            console.warn('[Auth] persistence setup failed:', err);
            throw err instanceof Error ? err : new Error('no persistence mode could be established');
        });
}

// The one restore bound (8s), shared with session.js and login-core.js — silent-sign-in.js says why it lives there.
import { AUTH_RESTORE_TIMEOUT_MS } from './silent-sign-in.js';

/** Resolve the FIRST auth emission (the persisted-user restore), bounded at 8s; null on timeout.
 *  The app's one such subscription: session.js's `restoreFirstAuthUser` awaits it via `currentUserAfterBoot`.
 *  **It bounds the emission, NOT `authReady`** (measured, browser SDK build, Sep 2026): Auth's
 *  initialisation includes the stored user's `accounts:lookup`, and `setPersistence` queues behind
 *  it — so `authReady` settles when the lookup does, up to the SDK's 30s API timeout.
 *  @returns {Promise<any>} */
function _firstAuthUserAtBoot() {
    return new Promise(resolve => {
        /** @type {null | (() => void)} */
        let unsub       = null;
        let settled     = false;
        let detachEarly = false;   // the listener fired before onAuthStateChanged returned
        // A TDZ-safe detach: Firebase does not emit synchronously, but a shape that would throw if
        // it ever did does not belong on the one promise every page's boot awaits.
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
        timer = setTimeout(() => finish(null), AUTH_RESTORE_TIMEOUT_MS);
        try { unsub = onAuthStateChanged(auth, (/** @type {any} */ u) => finish(u)); }
        catch { finish(null); }
        if (detachEarly) detach();
    });
}

// BOOT MUST NOT INHERIT THE STRICTER POLICY. `_setMemberPersistence` rejects when no mode could be
// established, but this promise is awaited at boot by every page, mostly without a catch, so
// propagating here would turn a rare storage failure into an unhandled rejection and a blank app. An
// in-memory session still works for the current tab.
//
// ── THE RESTORED USER IS READ FIRST ─────────────────────────────────────────────────────────────
//
// The boot waits for the restore before setting persistence — which costs nothing, because
// setPersistence already queues behind the SDK's initialisation and that initialisation IS the
// restore. (Until the staff PIN's cleanup release, 27 Nov 2026, the order also let a restored PIN
// viewer keep session-only persistence: `setPersistence` MIGRATES the current user between stores.)
//
// ── ONE BOOT AUTHORITY ───────────────────────────────────────────────────────────────────────────
//
// "Who did this browser restore?" is answered ONCE, here: the restored user AND the persistence
// established for them, which everything downstream consumes (`currentUserAfterBoot`, session.js's
// `restoreFirstAuthUser`, calendar-access.js). Three separate subscriptions with their own timeouts
// COMPOUNDED in the degraded case — one wedged auth layer held the access decision for ~12.5s.
// `authReady` still yields the mode, derived from this.
/** @type {Promise<{ user: any, persistence: 'indexeddb'|'local'|'session'|'none' }>} */
export const authBootstrap = (async () => {
    let user = await _firstAuthUserAtBoot();
    // A TIMED-OUT emission is not "nobody signed in": setPersistence below waits for the restore
    // anyway, then migrates whoever it restored, so the answer is read once that has happened.
    if (!user) { try { await auth.authStateReady(); } catch { /* nobody restored */ } user = auth.currentUser; }
    return { user, persistence: await _setMemberPersistence() };
})().catch(() => ({ user: null, persistence: /** @type {const} */ ('none') }));

// Awaited before signing in, so persistence is configured before the auth token is written
// (otherwise iOS may drop the session).
export const authReady = authBootstrap.then(b => b.persistence);

/**
 * Who is signed in, once the one boot restore has had its chance?
 *
 * The shared replacement for "subscribe to `onAuthStateChanged` and wait for the first emission".
 *
 * **It returns ground truth, not the boot snapshot** — deliberately, and it is the reason this is
 * safe to share. Returning `authBootstrap`'s remembered user would resurrect an identity that has
 * signed out since boot, and two of the callers (`ensureFirebaseSession`, `admin-auth.js`) would
 * then believe a session exists when it does not. Waiting for the bootstrap and then reading
 * `auth.currentUser` answers the question the callers are actually asking, and Firebase sets
 * `currentUser` before it notifies listeners, so nothing is lost by reading it afterwards.
 *
 * Still bounded, because `setPersistence` sits inside the bootstrap and a storage layer that never
 * answers must not hold a page for ever. The bound does not STACK: whichever caller arrives first
 * pays the wait, and the rest find it settled.
 *
 * @param {number} [timeoutMs] how long to wait for the boot restore before answering from whatever
 *        is there. Callers with a deadline of their own pass their remaining budget.
 * @returns {Promise<any>} the signed-in user, or null
 */
export async function currentUserAfterBoot(timeoutMs = AUTH_RESTORE_TIMEOUT_MS) {
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

// Re-export auth operations so callers import from one place.
export { signInWithEmailAndPassword, signOut, onAuthStateChanged };

/**
 * Run a Firestore thunk (read OR write), self-healing a stale-claim `permission-denied` once
 * (AUTH_AND_SESSIONS.md → "Write isolation (B0–B3)"). The operation is
 * read/write-agnostic: writes go through `writeWithClaimRetry` below (this, behind the write gate),
 * and reads — the Operations cards among them — call `withClaimRetry` directly.
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
    // original error if the refresh itself fails) and WHERE the sign-out watch sits are the pure
    // runWatchedClaimRetry in claim-retry.js, unit-tested in claim-retry.test.mjs. Each attempt is
    // watched by abandonOnSignOut, which stops waiting on an account that has gone, whose commit
    // Firestore never settles ("stuck on Saving…") — but not the token refresh between them: a refused
    // refresh signs the account out after the server has ALREADY refused the write, and a refusal is
    // not a write of unknown outcome (claim-retry.js says why).
    return runWatchedClaimRetry(fn, {
        retryCode: 'permission-denied',
        hasUser: () => !!auth.currentUser,
        refresh: () => /** @type {any} */ (auth.currentUser).getIdToken(true),
        uid: auth.currentUser?.uid,
        currentUid: () => auth.currentUser?.uid,   // the retry only as the account that asked (claim-retry.js)
        watch: cb => onAuthStateChanged(auth, cb),
    });
}

/** withClaimRetry for WRITES, through `runGatedWrite` (claim-retry.js): after an unconfirmed
 *  write no new one starts until reload. @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
export function writeWithClaimRetry(fn) { return runGatedWrite(() => withClaimRetry(fn)); }
/** Whether this device's queued writes reach the server within `ms` — a checked write asks first (claim-retry.js → ownWritesSent). @param {number} [ms] */
export const whenOwnWritesSent = (ms) => ownWritesSent(() => waitForPendingWrites(db), ms);
/**
 * For a checked save that knows its documents (claim-retry.js → `ownWritesSentFor`): true when none of
 * `refs` has this account's own write still queued. Online the records are asked FIRST, so another
 * account's leftover write — which the SDK's whole-queue wait never sees past — holds up nothing.
 * @param {Iterable<any>} refs  every document the save writes or deletes
 * @param {number} [ms]
 */
export const whenOwnWritesSentFor = (refs, ms) => ownWritesSentFor(() => waitForPendingWrites(db), getDocFromCache, refs, ms,
    { online: () => globalThis.navigator?.onLine !== false });

/** A READ THE OFFLINE CACHE ANSWERED IS A FAILED LOAD (settings-ops-1) — for the admin reads below, which
 *  Operations painted as current offline ("✓ No outstanding requests", "0/51"). analytics-client.js keeps the
 *  same guard, with the argument and why it throws `unavailable`. @template T @param {T} snap @returns {T} */
function refuseCachedRead(snap) {
    if (/** @type {any} */ (snap)?.metadata?.fromCache) throw Object.assign(new Error('Read was served from the offline cache'), { code: 'unavailable' });
    return snap;
}

/**
 * Run a Storage `uploadBytes`, self-healing a stale-claim `storage/unauthorized` once — the
 * Storage-side mirror of {@link writeWithClaimRetry}. Document uploads hit Storage BEFORE any
 * Firestore write, so a just-re-provisioned admin whose ID token predates the `admin` claim would
 * fail before the Firestore-side retry could run. Only retries `storage/unauthorized` with a live
 * user, at most once; any other error is re-thrown. The versioned storageRef is stable, so the retry
 * simply re-attempts the same object.
 * @param {(ref:any, data:any, meta:any)=>Promise<any>} uploadBytes  the lazily-loaded SDK fn
 * @param {any} storageRef @param {any} file @param {any} metadata
 */
async function _uploadBytesWithClaimRetry(uploadBytes, storageRef, file, metadata) {
    // Storage-side mirror of withClaimRetry — same pure runner, keyed on `storage/unauthorized`.
    return runWithClaimRetry(() => uploadBytes(storageRef, file, metadata), {
        retryCode: 'storage/unauthorized',
        hasUser: () => !!auth.currentUser,
        refresh: () => /** @type {any} */ (auth.currentUser).getIdToken(true),
        uid: auth.currentUser?.uid,
        currentUid: () => auth.currentUser?.uid,   // never retried as another account (claim-retry.js)
    });
}

// normaliseSurname + nameToEmail live in the pure, import-free auth-identity.js so they can be
// unit-tested directly, and are re-exported here for existing importers (session.js). The deliberate
// functions/roster-parse-helpers.js duplicate is held to it by surname-parity.test.mjs.
import { normaliseSurname, nameToEmail, resetAtFromRestDoc, isRestCredentialRejection, isRestThrottled } from './auth-identity.js';
import { buildPasswordClient } from './own-password.js';
import { buildAccountCalls } from './account-calls.js';
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
        _storagePromise = import('https://www.gstatic.com/firebasejs/13.4.0/firebase-storage.js')
            .then(({ getStorage, ref, uploadBytes, getDownloadURL, deleteObject }) =>
                ({ storage: getStorage(app), ref, uploadBytes, getDownloadURL, deleteObject }))
            // Reset on rejection: a rejected promise is truthy, so ONE transient CDN failure would be
            // memoised for ever — every later upload failing instantly until a full reload.
            .catch(err => { _storagePromise = null; throw err; });
    }
    return _storagePromise;
}

// ---- The three date-keyed document collections ----
// Huddle · Circular · Newsletter. The upload SEQUENCE lives in documents-client.js, which takes every
// Firebase handle as an argument so it can be replayed in Node; its header has why.
const _docs = buildDocumentClient({
    db, collections: COLLECTIONS,
    fs: {
        doc, getDoc, getDocFromServer, setDoc, collection, query, where, orderBy, limit,
        getDocs, onSnapshot, runTransaction, serverTimestamp,
    },
    getStorageSdk: _getStorageSdk,
    uploadBytesWithClaimRetry: _uploadBytesWithClaimRetry,
    utils: { isDocxUpload, uploadMimeType, legacyDocPath, versionedDocPath },
    resolveUploadCommit, pruneOldDocs,
    guardCommit: (/** @type {Promise<any>} */ p) => abandonOnSignOut(p, { uid: auth.currentUser?.uid, watch: cb => onAuthStateChanged(auth, cb) }),
});

export const uploadHuddle            = _docs.uploadHuddle;
export const uploadCircular          = _docs.uploadCircular;
export const uploadNewsletter        = _docs.uploadNewsletter;
export const getLatestCircular       = _docs.getLatestCircular;
export const getLatestNewsletter     = _docs.getLatestNewsletter;
export const getLatestHuddle         = _docs.getLatestHuddle;
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

/** The signed-in Firebase uid, or null — what `savePushSubscription` stamps as `owner`. notif.js
 *  compares it with the uid it last saved under, so a device that changes hands re-saves at once. */
export function currentAuthUid() { return auth.currentUser?.uid ?? null; }

/**
 * Save a browser PushSubscription to Firestore so the Cloud Function can
 * fan out notifications when a new Huddle is uploaded.
 * Overwrites any previous subscription for this device (same endpoint).
 * @param {PushSubscription} subscription
 */
export async function savePushSubscription(subscription) {
    const p256dh = subscription.getKey('p256dh');
    // Named authKey (not `auth`) so it can't shadow the module-level Firebase `auth` instance —
    // a future claim check added here would otherwise silently read this 16-byte key buffer.
    const authKey = subscription.getKey('auth');
    if (!p256dh || !authKey) {
        // Partially-initialised subscription — keys absent on some browsers. THROW rather than
        // silently returning: a silent skip let the caller mark the device "subscribed" with NO server
        // record, so the bell showed "on" for ever while the device got no pushes. The caller
        // (notif.js subscribe) rolls back the browser subscription on this throw. (review B2)
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
    // Bounded by the account — else a sign-out left the bell on "Enabling…"; the id is fixed.
    await abandonOnSignOut(setDoc(doc(db, COLLECTIONS.pushSubscriptions, id), data), { uid: owner, watch: cb => onAuthStateChanged(auth, cb) });
}

/**
 * Remove a push subscription from Firestore (user unsubscribed or revoked permission).
 * @param {string} endpoint
 */
export async function deletePushSubscription(endpoint) {
    if (!endpoint) return;
    // NO OWNER, NO DELETE: the rule would refuse it anyway, after a round trip a sign-out's 1.5s
    // time-box may not have. `releaseDevicePush` then drops the BROWSER subscription instead.
    const u = auth.currentUser;
    if (!u || u.isAnonymous) throw Object.assign(new Error('push/no-owner-session'), { code: 'push/no-owner-session' });
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
    // writeWithClaimRetry: staffContact writes require the member's own `name` claim, and a token
    // that predates the claim self-heals by a forced refresh + one retry, like every name-gated write.
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
    const snap = refuseCachedRead(await getDocs(collection(db, COLLECTIONS.staffContact)));
    return snap.docs.map(/** @param {any} d */ d => d.data());
}

// ---- Password migration status (AUTH_AND_SESSIONS.md → "Password migration status") ----
// `passwordStatus/{memberName}` (doc id = display name). `resetAt` is written ONLY by Cloud Functions
// (Admin SDK, bypasses rules) — resetMemberPassword, and setupRosterAuth wherever it puts an account on
// the surname default (a new account, a take-back, a re-enable); `passwordSetAt` is written by the
// member's own client after a successful updatePassword. Migrated ⇔ passwordSetAt newer than any
// resetAt. Kept SEPARATE from staffContact so the security-sensitive resetAt never shares a
// member-writable doc.

/**
 * Read a member's password-migration record (owner or admin, Firestore rules). A `passwordSetAt` not yet confirmed reads as
 * its local ESTIMATE, not null — as null it told a member who had just chosen a password they were on their surname.
 * @param {string} memberName @returns {Promise<{ resetAt?: any, passwordSetAt?: any } | null>}
 */
export async function getPasswordStatus(memberName) {
    const snap = await getDoc(doc(db, COLLECTIONS.passwordStatus, memberName));
    return snap.exists() ? snap.data({ serverTimestamps: 'estimate' }) : null;
}

/**
 * The member's last admin reset, asked BEFORE the app signs in. Asked after, the
 * SDK had already announced and stored the user, so the Calendar granted the lost phone first and a
 * reload mid-check skipped the check. This signs in over the Identity Toolkit REST API (a token the
 * SDK never sees, stores or announces) and reads `passwordStatus/{name}` over Firestore REST with it.
 *
 * @param {string} email
 * @param {string} password   the surname default the silent path is about to try
 * @param {string} memberName
 * @param {number} timeoutMs  for the two requests together
 * @returns {Promise<number|null|'credential'|'throttled'>} ms (0 = never reset); null = could not be
 *   confirmed; 'credential' = the sign-in was REFUSED (`isRestCredentialRejection`: a wrong password,
 *   and also no such account and a disabled one) — the caller STOPS there, without the SDK sign-in,
 *   and remembers it (session.js); 'throttled' = Google's rate limit, which the caller does NOT retry
 */
export async function probeResetAtMs(email, password, memberName, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    const left = () => Math.max(1, deadline - Date.now());
    try {
        const r = await fetchWithTimeout(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseConfig.apiKey}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, password, returnSecureToken: true }) }, left());
        const body = await r.json().catch(() => null);
        if (isRestCredentialRejection(r.status, body)) return 'credential';
        if (isRestThrottled(r.status, body)) return 'throttled';
        const token = r.ok ? body?.idToken : null;
        if (!token) return null;
        const d = await fetchWithTimeout(
            `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/${COLLECTIONS.passwordStatus}/${encodeURIComponent(memberName)}`,
            { headers: { Authorization: `Bearer ${token}` } }, left());
        return resetAtFromRestDoc(d.status, await d.json().catch(() => null));
    } catch { return null; }
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
    const snap = refuseCachedRead(await getDocs(collection(db, COLLECTIONS.passwordStatus)));
    // The id AFTER the spread, as in getResetRequests: what the rules bind must win.
    return snap.docs.map(/** @param {any} d */ d => ({ ...d.data(), memberName: d.id }));
}

// ---- The member's OWN password (own-password.js) ----
// Re-authentication and the change itself — Settings' card's and the forced change's — built once with
// every handle injected, so the rules run in Node; the two names are re-exported here, unchanged.
const _ownPassword = buildPasswordClient({ auth, reauthenticateWithCredential, EmailAuthProvider, updatePassword, savePasswordSetAt, trackBackgroundWrite });
export const reauthenticateWithPassword = _ownPassword.reauthenticateWithPassword;
export const changeOwnPassword          = _ownPassword.changeOwnPassword;

// ---- Three account endpoints' callers (account-calls.js) ----
// The admin's Reset and provisioning audit, and the locked-out member's reset request: built once with
// the one handle they need, and re-exported here under their old names, so no caller changed.
const _accountCalls = buildAccountCalls({ auth });
export const resetMemberPassword  = _accountCalls.resetMemberPassword;
export const getAccountSetupGaps  = _accountCalls.getAccountSetupGaps;
export const requestPasswordReset = _accountCalls.requestPasswordReset;

/**
 * A SHORT-LIVED url for the latest Huddle / Circular / Newsletter, or `null` to use the stored one.
 *
 * The RULE — which failures mean "fall back", and why every one of them is ordinary — lives in
 * `document-url.js`, which imports no Firebase and is therefore testable in Node. This is the
 * three lines that cannot live there: the current user, and their ID token.
 *
 * @param {'huddle'|'circular'|'newsletter'} kind
 * @returns {Promise<import('./document-url.js').SignedDocumentUrl|null>}  url + expiry + the signed file's type
 */
export async function fetchSignedDocumentUrl(kind) {
    const user = auth.currentUser;
    // No session, no ID token, so the request could only 401. Returning here keeps a signed-out
    // visitor's open instant rather than costing them a round trip to be refused.
    if (!user) return null;
    return requestSignedDocumentUrl(kind, () => user.getIdToken());
}

/** Admin-only Cloud Function returning the EXACT unique-account sign-in counts. */
const SIGN_IN_STATS_URL = functionUrl('getSignInStats');

/**
 * How many distinct accounts have actually signed in (admin only — enforced server-side).
 *
 * The counterpart to `getUsageStats`'s active-account figure, which is deduped on the DEVICE and so
 * counts a member with a phone and a laptop twice. This one is exact because Firebase Auth holds one
 * `lastSignInTime` per account. The response is four integers; no identity is returned. Read-only,
 * hence GET.
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

/**
 * All outstanding password-reset requests, newest first (admin only — enforced by the rules).
 * @returns {Promise<Array<{memberName: string, requestedAt?: any, count?: number, provisioned?: boolean, disabled?: boolean}>>}
 */
export async function getResetRequests() {
    const snap = refuseCachedRead(await getDocs(collection(db, COLLECTIONS.resetRequests)));
    return snap.docs
        // memberName AFTER the spread: the doc ID is what the rules and the endpoint bound, so it must
        // win over a field that could differ — otherwise Clear deleted `resetRequests/<field>`, a no-op
        // Firestore reports as success, and the row could never be cleared.
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
    await writeWithClaimRetry(() => deleteDoc(doc(db, COLLECTIONS.resetRequests, memberName)));
}

// ---- The error log and the usage/speed counters ----
// The Firestore I/O lives in analytics-client.js, which takes every handle as an argument so it
// loads in Node; its header has the two properties every function there keeps.
const _analytics = buildAnalyticsClient({
    db, collections: COLLECTIONS,
    fs: {
        doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, updateDoc, collection, query, where, limit,
        serverTimestamp, increment, deleteField, FieldPath,
    },
    writeWithClaimRetry, appVersion: APP_VERSION,
    // The prunes' clock: when this session's ID token was issued, by the token service's clock — never
    // this device's (analytics-client.js header). No user or no token → null, and nothing is pruned.
    trustedNow: async () => {
        const t = await auth.currentUser?.getIdTokenResult();
        return t ? Date.parse(t.issuedAtTime) : null;
    },
});

export const logClientError      = _analytics.logClientError;
export const getClientErrors     = _analytics.getClientErrors;
export const resolveClientError  = _analytics.resolveClientError;
export const recordPageView      = _analytics.recordPageView;
export const recordActiveAccount = _analytics.recordActiveAccount;
export const recordOriginUse     = _analytics.recordOriginUse;
export const recordPerfSample    = _analytics.recordPerfSample;
export const getPerfStats        = _analytics.getPerfStats;
export const getUsageStats       = _analytics.getUsageStats;
