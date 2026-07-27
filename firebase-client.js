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
// firebase-storage (~30 kB) is dynamically imported via `_getStorageSdk()` (used by the shared
// `_transactionalUpload` engine behind huddle/circular/newsletter uploads, v16.38) — only
// operations.html actually uploads files, so index.html, admin.html, and paycalc.html avoid the cost.
// @ts-ignore
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously, signOut, setPersistence, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { orderClientErrors, expiredResolvedIds, capUnresolvedErrors } from './client-errors.js';
import { runWithClaimRetry } from './claim-retry.js';
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
    // getDocsFromCache reads ONLY the persistent local cache: no network, and — because
    // Firestore rules are evaluated server-side — no rule evaluation either. That is what lets the
    // calendar paint before an auth session exists (AUTH_PLAN.md → E1). It REJECTS on a cache miss.
    getDocs, getDocsFromCache, getDoc, onSnapshot,
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
    passwordStatus:    'passwordStatus',
    clientErrors:      'clientErrors',
    overrides:         'overrides',
    linkDesigns:       'linkDesigns',
    analytics:         'analytics',
    resetRequests:     'resetRequests',
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
export { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously, signOut, onAuthStateChanged, updatePassword, reauthenticateWithCredential, EmailAuthProvider };

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
            // storagePath added at v13.99; fall back to the legacy fixed-path convention for older
            // documents uploaded before the versioned upload scheme. Honour the doc's own fileType
            // in that fallback (default 'pdf') rather than hardcoding '.pdf' — a legacy .docx would
            // otherwise orphan its Storage object. (Belt-and-braces: DOCX support postdates
            // storagePath, so no such doc exists today — but this matches _transactionalUpload's
            // fileType-aware cleanup and removes the latent assumption.)
            const _docData    = d.data() || {};
            const storagePath = _docData.storagePath ?? `${collectionName}/${d.id}.${_docData.fileType || 'pdf'}`;
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
    const r = await fetch(RESET_PASSWORD_URL, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ member: memberName, revoke }),
    });
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
    const r = await fetch(SIGN_IN_STATS_URL, {
        method:  'GET',
        headers: { 'Authorization': `Bearer ${token}` },
    });
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
    const r = await fetch(REQUEST_RESET_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ member: memberName }),
    });
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
