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
import { initializeFirestore, getFirestore, persistentLocalCache, collection, query, where, orderBy, limit, getDocs, getDoc, addDoc, setDoc, deleteDoc, doc, serverTimestamp, writeBatch, runTransaction, onSnapshot, increment, updateDoc, deleteField, FieldPath } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
// firebase-storage (~30 kB) is dynamically imported via `_getStorageSdk()` (used by the shared
// `_transactionalUpload` engine behind huddle/circular/newsletter uploads, v16.38) — only
// operations.html actually uploads files, so index.html, admin.html, and paycalc.html avoid the cost.
// @ts-ignore
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously, signOut, setPersistence, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { orderClientErrors, expiredResolvedIds } from './client-errors.js';
import { monthKey, prevMonthKey, sumDailyWindow, orderPageCounts, staleDailyKeys } from './usage-stats.js';
import { perfSampleKey, summarisePerf } from './perf-stats.js';
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
    getDocs, getDoc, onSnapshot,
    // writes
    addDoc, setDoc, deleteDoc, doc, serverTimestamp, writeBatch, runTransaction,
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
    clientErrors:      'clientErrors',
    overrides:         'overrides',
    linkDesigns:       'linkDesigns',
    analytics:         'analytics',
};

// isSafeStorageUrl + isDocxUpload live in the pure, import-free storage-utils.js so they can be
// unit-tested directly (this module can't be imported in a Node test — it pulls the Firebase SDK
// from the gstatic CDN). isSafeStorageUrl is re-exported so existing `from './firebase-client.js'`
// importers (nav-panel, calendar-doc-viewer, the Huddle viewer) are unaffected; isDocxUpload is used
// internally by the upload paths. officeViewerUrl is re-exported for the DOCX circular/newsletter
// open path (nav-panel, calendar-doc-viewer).
import { isSafeStorageUrl, isDocxUpload, officeViewerUrl, sixMonthCutoffISO } from './storage-utils.js';
export { isSafeStorageUrl, officeViewerUrl };

// ---- Firebase Authentication ----

/** Shared Firebase Auth instance. */
export const auth = getAuth(app);

// Explicit persistence chain: IndexedDB (longest-lived) → localStorage → sessionStorage.
// iOS ITP can evict IndexedDB after 7 days of no PWA use, causing silent sign-outs.
// Exported so callers can `await authReady` before signing in — guarantees persistence
// is configured before the auth token is written, otherwise iOS may drop the session.
export const authReady = setPersistence(auth, indexedDBLocalPersistence)
    .catch(() => setPersistence(auth, browserLocalPersistence))
    .catch(() => setPersistence(auth, browserSessionPersistence))
    .catch(/** @param {any} err */ err => { console.warn('[Auth] persistence setup failed:', err); });

// Re-export auth operations so callers import from one place.
export { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously, signOut, onAuthStateChanged };

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
    try {
        return await fn();
    } catch (err) {
        const user = auth.currentUser;
        if (/** @type {any} */ (err)?.code === 'permission-denied' && user) {
            // Force a token refresh to pick up a newly-set claim, then retry once. If the refresh
            // itself fails (offline/flaky), do NOT let its network error REPLACE the original
            // permission-denied — the caller keys its user-facing message on `err.code`, so a genuine
            // authorisation denial must not be reported to staff as a connectivity problem.
            try {
                await user.getIdToken(true);   // force refresh → pick up the newly-set claim
            } catch {
                throw err;                     // preserve the original permission-denied
            }
            return await fn();               // retry once with the fresh token
        }
        throw err;
    }
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
    try {
        return await uploadBytes(storageRef, file, metadata);
    } catch (err) {
        const user = auth.currentUser;
        if (/** @type {any} */ (err)?.code === 'storage/unauthorized' && user) {
            try { await user.getIdToken(true); }
            catch { throw err; }              // preserve the original storage/unauthorized
            return await uploadBytes(storageRef, file, metadata);
        }
        throw err;
    }
}

// normaliseSurname + nameToEmail (the account-identity derivations) live in the pure, import-free
// auth-identity.js so they can be unit-tested directly (this module can't load in a Node test — it
// pulls the Firebase SDK from the gstatic CDN). Re-exported so existing importers (session.js) are
// unaffected. The deliberate functions/roster-parse-helpers.js duplicate + surname-parity.test.mjs
// source-equivalence check now read auth-identity.js.
import { normaliseSurname, nameToEmail } from './auth-identity.js';
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

/**
 * Verify a chosen file's leading bytes (magic number) actually match its declared
 * type before it is uploaded. Browser uploads otherwise trust only the file
 * extension / reported MIME, so a renamed non-PDF (e.g. a `.txt` saved as `.pdf`)
 * would be stored behind a trusted in-app document link. This mirrors the
 * server-side `fileSignatureMatches` check the Cloud Function ingest path already
 * performs (`functions/roster-parse-helpers.js`) — PDF must start with `%PDF-`,
 * DOCX (a ZIP container) with `PK\x03\x04`.
 *
 * **Fails CLOSED** (v14.99): a file that can't be read, or is shorter than the 5-byte
 * signature window, can't be a genuine PDF/DOCX — a real one is always ≥5 bytes and reads
 * fine — so reject it rather than wave it through. This is an admin-only manual-upload path,
 * so a rejection is retryable (it never affects the server-side daily Huddle ingest, which
 * runs its own `fileSignatureMatches` check). Throws on a read error, a too-short file, or a
 * positive content mismatch.
 *
 * @param {File}            file - the chosen file
 * @param {'pdf'|'docx'}    expectedType - the type derived from the filename
 * @returns {Promise<void>} resolves when valid; throws `Error('SIGNATURE_MISMATCH')` when invalid/unreadable
 */
async function assertFileSignature(file, expectedType) {
    let bytes;
    try {
        bytes = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    } catch {
        throw new Error('SIGNATURE_MISMATCH'); // can't read the file — fail CLOSED (admin-only, retryable)
    }
    if (bytes.length < 5) throw new Error('SIGNATURE_MISMATCH'); // too short to be a real PDF/DOCX — fail closed
    // %PDF-  → 25 50 44 46 2D
    const isPdfSig = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
                     bytes[3] === 0x46 && bytes[4] === 0x2D;
    // PK\x03\x04 → 50 4B 03 04 (ZIP container; DOCX is a ZIP)
    const isZipSig = bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04;
    if (expectedType === 'pdf'  && !isPdfSig) throw new Error('SIGNATURE_MISMATCH');
    if (expectedType === 'docx' && !isZipSig) throw new Error('SIGNATURE_MISMATCH');
}

/** Firestore error codes that warrant a single retry — transient service unavailability only. */
const _RETRIABLE_FIRESTORE_CODES = new Set(['unavailable', 'deadline-exceeded', 'internal']);

/**
 * Shared transactional upload engine for the date-keyed document collections (huddles / circulars /
 * newsletters). Extracted (v16.38) from the byte-identical uploadHuddle / _uploadDoc paths — both were
 * incident-hardened in lockstep and had begun to drift, so the rollback / commit-ambiguity rules now
 * live in ONE place. Flow: read the old storagePath → write a VERSIONED Storage object → getDownloadURL
 * → setDoc (single retry on a retriable Firestore code) → on failure roll back the new object ONLY for a
 * NON-retriable (definite non-commit) error (a still-retriable final error is commit-AMBIGUOUS — the doc
 * may have committed after the response was lost — so the file is LEFT, to avoid a committed doc pointing
 * at nothing) → best-effort delete of the superseded old object after commit.
 * @param {string} collectionName  Firestore collection AND Storage folder prefix (e.g. 'huddles')
 * @param {string} date            ISO "YYYY-MM-DD" (also the Firestore doc id)
 * @param {File}   file            PDF or Word (.docx)
 * @param {string} uploadedBy      memberName of the uploading admin
 * @param {{ extraFields?: Record<string, any>, postCommit?: (sdk: { storage: any, ref: any, deleteObject: any }) => void, logTag?: string }} [opts]
 *        extraFields → merged into the Firestore doc (e.g. the huddle's converted htmlContent);
 *        postCommit  → runs after a successful commit (e.g. _uploadDoc's 6-month prune); logTag → console prefix.
 * @returns {Promise<string>} the permanent tokenised download URL of the stored file
 */
async function _transactionalUpload(collectionName, date, file, uploadedBy, opts = {}) {
    const { extraFields = {}, postCommit, logTag = collectionName } = opts;
    // Detect by extension OR the docx MIME so it matches the accept predicate (isDocxFile) — a .docx
    // accepted via its MIME (a cloud/Android picker with no .docx in the name) would otherwise be
    // mis-detected as 'pdf' and rejected by the signature check with a confusing "not a valid" error.
    const fileType = isDocxUpload(file) ? 'docx' : 'pdf';
    await assertFileSignature(file, fileType);   // reject a renamed/mismatched file before Storage
    // Set the MIME explicitly — Android sometimes reports a .docx (a ZIP archive) as application/zip
    // or application/octet-stream, which can trip the Storage content-type rule.
    const mimeType = fileType === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf';
    const { storage, ref, uploadBytes, getDownloadURL, deleteObject } = await _getStorageSdk();

    // Read the previous storagePath first (storagePath added v13.99 — fall back for legacy docs, using
    // the OLD doc's fileType so a PDF↔DOCX swap still finds and cleans up the previous file).
    const oldSnap = await getDoc(doc(db, collectionName, date));
    const oldData = oldSnap.exists() ? /** @type {any} */ (oldSnap.data()) : null;
    const oldStoragePath = oldData ? (oldData.storagePath ?? `${collectionName}/${date}.${oldData.fileType ?? 'pdf'}`) : null;

    // Versioned path keeps the old file alive until Firestore commits — a re-upload (incl. a PDF↔DOCX
    // swap, which changes the extension) never orphans the old file mid-commit.
    const uploadId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const newStoragePath = `${collectionName}/${date}-${uploadId}.${fileType}`;
    const storageRef = ref(storage, newStoragePath);

    let storageUrl;
    try {
        await _uploadBytesWithClaimRetry(uploadBytes, storageRef, file, { contentType: mimeType });
        storageUrl = await getDownloadURL(storageRef);   // permanent tokenised (bearer) URL — never expires
        /** @type {Record<string, any>} */
        const firestoreDoc = {
            date, storageUrl, storagePath: newStoragePath, fileType,
            uploadedAt: serverTimestamp(), uploadedBy, ...extraFields,
        };
        // Retry setDoc once on a RETRIABLE code before treating it as a real failure: a
        // deadline-exceeded/unavailable can be raised AFTER the server committed, and the date-keyed
        // setDoc is idempotent, so a re-issue of a genuinely-committed write just succeeds (no rollback).
        try {
            await setDoc(doc(db, collectionName, date), firestoreDoc);
        } catch (setErr) {
            const e = /** @type {any} */ (setErr);
            if (!_RETRIABLE_FIRESTORE_CODES.has(e?.code)) throw setErr;
            console.warn(`[upload] ${logTag} setDoc attempt 1 failed (${e?.code}) — retrying once`);
            await new Promise(r => setTimeout(r, 2000));
            await setDoc(doc(db, collectionName, date), firestoreDoc);
        }
    } catch (err) {
        // Old file is unaffected. Roll back the new object ONLY on a non-retriable failure (definite
        // non-commit). A still-retriable FINAL error is commit-ambiguous — deleting could leave a
        // committed doc pointing at nothing (staff taps 404 until re-upload) — so leave the file (at
        // most one orphan, which the next upload's cleanup tolerates).
        if (!_RETRIABLE_FIRESTORE_CODES.has(/** @type {any} */ (err)?.code)) {
            deleteObject(storageRef).catch(/** @param {any} e */ e => console.warn(`[upload] ${logTag} rollback failed:`, e));
        } else {
            console.warn(`[upload] ${logTag} commit-ambiguous failure — leaving new Storage object in place:`, /** @type {any} */ (err)?.code);
        }
        throw err;
    }

    // Firestore committed: asynchronously remove the superseded old object (best-effort).
    if (oldStoragePath && oldStoragePath !== newStoragePath) {
        deleteObject(ref(storage, oldStoragePath)).catch(
            /** @param {any} e */ e => console.warn(`[upload] ${logTag} old-file cleanup failed (orphaned):`, e)
        );
    }

    postCommit?.({ storage, ref, deleteObject });
    return storageUrl;
}

/**
 * Upload a Huddle file (PDF or Word .docx) for a given date.
 *
 * Stores the file at huddles/YYYY-MM-DD.pdf or huddles/YYYY-MM-DD.docx in
 * Firebase Storage and writes a metadata document to the `huddles` Firestore
 * collection. If a Huddle was already uploaded for that date, this overwrites
 * it (latest wins). The `fileType` field in Firestore tells the app whether
 * to open the file directly (PDF) or via Office Online viewer (docx).
 *
 * @param {string}      date        - ISO date string, e.g. "2026-03-18"
 * @param {File}        file        - PDF or .docx file chosen by the admin
 * @param {string}      uploadedBy  - memberName of the uploading admin
 * @param {string|null} htmlContent - Pre-converted HTML string for DOCX files; null for PDF
 * @returns {Promise<string>} Publicly accessible download URL of the stored file
 */
export async function uploadHuddle(date, file, uploadedBy, htmlContent = null) {
    // Thin wrapper over the shared _transactionalUpload engine. 3-month huddle retention is pruned
    // server-side by the ingestHuddle Cloud Function (not here), so there is no postCommit.
    return _transactionalUpload(COLLECTIONS.huddles, date, file, uploadedBy, {
        logTag: 'huddle',
        // DOCX carries the pre-converted htmlContent so the viewer can render inline; PDF has none.
        extraFields: htmlContent !== null ? { htmlContent } : {},
    });
}

// ---- Weekly Retail Circular / Newsletter ----

/**
 * Delete Firestore documents (and matching Storage files) for a collection
 * whose `date` field is older than 6 months. Called fire-and-forget after
 * each successful upload to cap collection growth automatically.
 *
 * Each document is deleted independently — a failure on one does not abort the rest.
 * Firestore is deleted first; Storage follows only on success. This ordering means a
 * partial failure leaves an orphaned Storage file (invisible to users) rather than a
 * Firestore doc with a broken storageUrl (user-facing 404).
 *
 * @param {string}   collectionName - 'circulars' or 'newsletters'
 * @param {string}   excludeDate    - Date string of the just-uploaded doc to skip — prevents
 *                                    immediately pruning a historical correction (date > 6 months old)
 * @param {object}   storage        - Firebase Storage instance
 * @param {Function} refFn          - Firebase Storage `ref` function
 * @param {Function} deleteObject   - Firebase Storage `deleteObject` function
 * @returns {Promise<void>}
 */
async function _pruneOldDocs(collectionName, excludeDate, storage, refFn, deleteObject) {
    // The month-underflow-safe 6-month cutoff lives in storage-utils.js so it can be unit-tested.
    const cutoffStr = sixMonthCutoffISO(new Date());
    const q = query(collection(db, collectionName), where('date', '<', cutoffStr));
    const snap = await getDocs(q);
    await Promise.all(snap.docs
        .filter(/** @param {any} d */ d => d.id !== excludeDate)
        .map(/** @param {any} d */ async d => {
            // storagePath added at v13.99; fall back to the legacy fixed-path convention
            // for older documents uploaded before the versioned upload scheme.
            const storagePath = d.data()?.storagePath ?? `${collectionName}/${d.id}.pdf`;
            try {
                await deleteDoc(doc(db, collectionName, d.id));
                await deleteObject(refFn(storage, storagePath))
                    .catch(/** @param {any} e */ e => console.warn(`[pruneOldDocs] ${collectionName} Storage delete ${d.id}:`, e));
            } catch (/** @param {any} e */ e) {
                console.error(`[pruneOldDocs] ${collectionName} Firestore delete ${d.id}:`, e);
            }
        }));
}

/**
 * Upload a PDF to Firebase Storage and upsert a metadata document in Firestore.
 * Shared implementation for uploadCircular and uploadNewsletter.
 *
 * Uses a versioned Storage path (`{collection}/{date}-{uploadId}.pdf`) so the old
 * file is not overwritten until Firestore is committed. This closes the data-loss
 * window where a Firestore failure on a replacement would leave both old and new
 * bytes inaccessible (pre-v13.99 used a fixed path that overwrote on upload).
 *
 * Failure handling:
 *   - Storage fails:                                    nothing written; throws.
 *   - Storage OK, setDoc fails (either attempt):        new bytes rolled back via deleteObject;
 *                                                       old file unaffected; throws.
 *   - Storage OK, setDoc succeeds, old-file cleanup fails: orphaned old Storage file
 *                                                       (invisible to users); not thrown.
 *   - setDoc retry: only for retriable Firestore codes (unavailable, deadline-exceeded,
 *                   internal). Non-retriable codes throw immediately with no delay.
 *                   setDoc on a date-keyed doc is idempotent so a double-write is safe.
 *
 * @param {string}   collectionName - 'circulars' | 'newsletters'
 * @param {string}   date           - ISO date string, e.g. "2026-06-27"
 * @param {File}     file           - PDF or Word (.docx) file chosen by the admin
 * @param {string}   uploadedBy     - memberName of the uploading admin
 * @returns {Promise<string>} Download URL of the stored file
 */
async function _uploadDoc(collectionName, date, file, uploadedBy) {
    // Thin wrapper over the shared _transactionalUpload engine. Circular/newsletter files are
    // download-only (no inline conversion, so no extraFields); the 6-month prune runs post-commit.
    return _transactionalUpload(collectionName, date, file, uploadedBy, {
        logTag: collectionName,
        postCommit: ({ storage, ref, deleteObject }) =>
            _pruneOldDocs(collectionName, date, storage, ref, deleteObject)
                .catch(e => console.error(`[pruneOldDocs] ${collectionName}:`, e)),
    });
}

/**
 * Upload a Weekly Retail Circular (PDF or Word .docx) for a given date.
 * Stores at circulars/YYYY-MM-DD.pdf in Firebase Storage and writes a metadata
 * document to the `circulars` Firestore collection. Uploading for the same date
 * overwrites the previous file (latest wins). Documents older than 6 months are
 * pruned automatically after each upload.
 *
 * @param {string} date       - ISO date string, e.g. "2026-06-27"
 * @param {File}   file       - PDF or Word (.docx) file chosen by the admin
 * @param {string} uploadedBy - memberName of the uploading admin
 * @returns {Promise<string>} Download URL of the stored file
 */
export async function uploadCircular(date, file, uploadedBy) {
    return _uploadDoc(COLLECTIONS.circulars, date, file, uploadedBy);
}

/**
 * Fetch the most recent Retail Circular document from Firestore (one-shot read).
 * @returns {Promise<object|null>} Latest circular data object or null if none uploaded
 */
export async function getLatestCircular() {
    const q = query(collection(db, COLLECTIONS.circulars), orderBy('date', 'desc'), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const data = snap.docs[0].data();
    return data.storageUrl ? data : null;
}

/**
 * Upload a Newsletter (PDF or Word .docx) to Firebase Storage and record it in Firestore.
 * Documents older than 6 months are pruned automatically after each upload.
 * @param {string} date       - ISO date string, e.g. "2026-06-27"
 * @param {File}   file       - PDF or Word (.docx) file chosen by the admin
 * @param {string} uploadedBy - memberName of the uploading admin
 * @returns {Promise<string>} Download URL of the stored file
 */
export async function uploadNewsletter(date, file, uploadedBy) {
    return _uploadDoc(COLLECTIONS.newsletters, date, file, uploadedBy);
}

/**
 * Fetch the most recent Newsletter document from Firestore (one-shot read).
 * @returns {Promise<object|null>} Latest newsletter data object or null if none uploaded
 */
export async function getLatestNewsletter() {
    const q = query(collection(db, COLLECTIONS.newsletters), orderBy('date', 'desc'), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const data = snap.docs[0].data();
    return data.storageUrl ? data : null;
}

/**
 * Subscribe to real-time updates for the latest Huddle document.
 * Fires immediately with cached data (IndexedDB) on repeat visits, then again
 * when the network confirms — so the Huddle button becomes active almost instantly.
 * Also fires whenever a new huddle arrives, so staff don't need to refresh.
 *
 * @param {function} onData  - Called with huddle data object or null (no huddle yet)
 * @param {function} onError - Called with Firestore error if the listener fails
 * @returns {function} Unsubscribe function (call to clean up the listener)
 */
export function subscribeToLatestHuddle(onData, onError) {
    // Single-field orderBy — Firestore auto-indexes this; no composite index needed.
    const q = query(collection(db, COLLECTIONS.huddles), orderBy('date', 'desc'), limit(1));
    return onSnapshot(q, /** @param {any} snap */ (snap) => {
        if (snap.empty) { onData(null); return; }
        const data = snap.docs[0].data();
        if (!data.storageUrl) console.warn('[Huddle] Document missing storageUrl:', snap.docs[0].id);
        onData(data.storageUrl ? data : null);
    }, onError);
}

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
    await setDoc(doc(db, COLLECTIONS.pushSubscriptions, id), {
        endpoint:     subscription.endpoint,
        keys: {
            p256dh: keyToBase64(p256dh),
            auth:   keyToBase64(authKey),
        },
        subscribedAt: serverTimestamp(),
    });
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
    const truncated      = unresolvedSnap.size > UNRESOLVED_CAP;
    const unresolvedDocs = unresolvedSnap.docs.slice(0, UNRESOLVED_CAP); // show at most the cap
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
// usage-stats.js module; this is just the Firestore I/O. See ROADMAP → "Usage analytics".

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
 * `fcp` (a page first appearing on screen) and `pages` (a page being fully ready, the 'domReady'
 * metric). Computed by the pure perf-stats module. No identity is involved.
 * @returns {Promise<{ thisMonth: PerfWindow, lastMonth: PerfWindow }>}
 * @typedef {{ month: string, login: ReturnType<typeof summarisePerf>, fcp: ReturnType<typeof summarisePerf>, pages: ReturnType<typeof summarisePerf> }} PerfWindow
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
        };
    };
    return { thisMonth: windowFor(thisSnap, m), lastMonth: windowFor(lastSnap, pm) };
}

/**
 * Read the usage figures for the Operations "Usage" card (admin-only). Also prunes
 * daily buckets outside the retention window, fire-and-forget, so the rolling doc
 * stays bounded (mirrors the resolved-error prune in getClientErrors).
 * @returns {Promise<{ month: string, prevMonth: string, pageCounts: Array<{page: string, count: number}>, prevPageCounts: Array<{page: string, count: number}>, accountsThisMonth: number, accountsLast30: number, monthsHistory: Record<string, number> }>}
 */
export async function getUsageStats() {
    const now = new Date();
    const m = monthKey(now);
    const pm = prevMonthKey(now);
    const [pvSnap, pvPrevSnap, aaSnap] = await Promise.all([
        getDoc(doc(db, COLLECTIONS.analytics, `pv_${m}`)),
        getDoc(doc(db, COLLECTIONS.analytics, `pv_${pm}`)),
        getDoc(doc(db, COLLECTIONS.analytics, 'activeAccounts')),
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

    return {
        month: m,
        prevMonth: pm,
        pageCounts: orderPageCounts(pv.counts || {}),
        prevPageCounts: orderPageCounts(pvPrev.counts || {}),
        accountsThisMonth: Number((aa.months || {})[m]) || 0,
        accountsLast30: sumDailyWindow(daily, now),
        monthsHistory: aa.months || {},
    };
}
