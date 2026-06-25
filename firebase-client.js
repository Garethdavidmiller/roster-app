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
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js';
// @ts-ignore
import { initializeFirestore, getFirestore, persistentLocalCache, collection, query, where, orderBy, limit, getDocs, getDoc, addDoc, setDoc, deleteDoc, doc, serverTimestamp, writeBatch, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';
// firebase-storage (~30 kB) is dynamically imported inside uploadHuddle() — only
// operations.html actually uploads files, so index.html, admin.html, and paycalc.html avoid the cost.
// @ts-ignore
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously, signOut, setPersistence, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js';
import { orderClientErrors, expiredResolvedIds } from './client-errors.js';

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
    addDoc, setDoc, deleteDoc, doc, serverTimestamp, writeBatch,
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
};

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
    .catch(err => { console.warn('[Auth] persistence setup failed:', err); });

// Re-export auth operations so callers import from one place.
export { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously, signOut, onAuthStateChanged };

/**
 * Normalise a full display name down to a surname fragment: everything after
 * the first word, lowercased, letters only.
 *   "G. Miller"            → "miller"
 *   "C. Francisco-Charles" → "franciscocharles"
 *
 * Exported so session.js getSurname can reuse it — prevents the two
 * implementations drifting apart independently.
 * NOTE: functions/roster-parse-helpers.js contains a deliberate copy of this
 * logic (nameToPassword) because Firebase Functions cannot import browser ES
 * modules. Do not attempt to unify them — the Functions build will break.
 *
 * @param {string} fullName
 * @returns {string}
 */
export function normaliseSurname(fullName) {
    return fullName.split(' ').slice(1).join('').toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Derive a stable Firebase Auth email from a teamMembers display name.
 *
 * Convention: initial.surname@myb-roster.local
 *   "G. Miller"            → "g.miller@myb-roster.local"
 *   "C. Francisco-Charles" → "c.franciscocharles@myb-roster.local"
 *   "L. Atrakimaviciene"   → "l.atrakimaviciene@myb-roster.local"
 *
 * The @myb-roster.local domain is synthetic — these accounts are never used for
 * email delivery. Note: Firebase Auth's distinct error codes for
 * auth/user-not-found vs auth/invalid-credential can reveal whether an account
 * exists for a given email; documented in KNOWN_LIMITATIONS.md.
 *
 * @param {string} fullName - Display name exactly as stored in teamMembers
 * @returns {string} Firebase Auth email address
 */
export function nameToEmail(fullName) {
    const parts   = fullName.split(' ');
    const initial = parts[0].replace(/[^a-zA-Z]/g, '').toLowerCase();
    const surname = normaliseSurname(fullName);
    return `${initial}.${surname}@myb-roster.local`;
}

// ---- Firebase Storage ----
// Storage SDK is loaded lazily on first call to uploadHuddle().
// Cached as a module-level promise so concurrent uploads share one fetch.
let _storagePromise = null;
function _getStorageSdk() {
    if (!_storagePromise) {
        // @ts-ignore
        _storagePromise = import('https://www.gstatic.com/firebasejs/12.10.0/firebase-storage.js')
            .then(({ getStorage, ref, uploadBytes, getDownloadURL, deleteObject }) =>
                ({ storage: getStorage(app), ref, uploadBytes, getDownloadURL, deleteObject }));
    }
    return _storagePromise;
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
    const { storage, ref, uploadBytes, getDownloadURL } = await _getStorageSdk();
    const fileType   = file.name.toLowerCase().endsWith('.docx') ? 'docx' : 'pdf';
    // Explicitly set the content type rather than relying on the browser to report it.
    // On Android, .docx files sometimes arrive as 'application/zip' or 'application/octet-stream'
    // because DOCX is a ZIP archive — which can cause Firebase Storage rule mismatches.
    const mimeType   = fileType === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf';
    const storageRef = ref(storage, `huddles/${date}.${fileType}`);
    await uploadBytes(storageRef, file, { contentType: mimeType });
    // getDownloadURL returns a permanent tokenised URL (never expires). Note: huddles
    // ingested by the Cloud Function use a 1-year signed URL instead — so manual-upload
    // and PA-ingest huddles have different URL lifetimes. Both work; the difference is
    // documented so a future unification decision is deliberate.
    const storageUrl = await getDownloadURL(storageRef);
    const firestoreDoc = { date, storageUrl, fileType, uploadedAt: serverTimestamp(), uploadedBy };
    if (htmlContent !== null) firestoreDoc.htmlContent = htmlContent;
    await setDoc(doc(db, COLLECTIONS.huddles, date), firestoreDoc);
    return storageUrl;
}

// ---- Weekly Retail Circular ----

/**
 * Delete Firestore documents (and matching Storage files) for a collection
 * whose `date` field is older than 6 months. Called fire-and-forget after
 * each successful upload to cap collection growth automatically.
 * @param {string}   collectionName - 'circulars' or 'newsletters'
 * @param {object}   storage        - Firebase Storage instance
 * @param {Function} refFn          - Firebase Storage `ref` function
 * @param {Function} deleteObject   - Firebase Storage `deleteObject` function
 */
async function _pruneOldDocs(collectionName, storage, refFn, deleteObject) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 6);
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
    const q = query(collection(db, collectionName), where('date', '<', cutoffStr));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map(async d => {
        await deleteDoc(doc(db, collectionName, d.id));
        await deleteObject(refFn(storage, `${collectionName}/${d.id}.pdf`)).catch(e => console.warn(`[pruneOldDocs] ${collectionName} delete ${d.id}:`, e));
    }));
}

/**
 * Upload a Weekly Retail Circular PDF for a given date.
 * Stores at circulars/YYYY-MM-DD.pdf in Firebase Storage and writes a metadata
 * document to the `circulars` Firestore collection. Uploading for the same date
 * overwrites the previous file (latest wins). Documents older than 6 months are
 * pruned automatically after each upload.
 *
 * @param {string} date       - ISO date string, e.g. "2026-06-27"
 * @param {File}   file       - PDF file chosen by the admin
 * @param {string} uploadedBy - memberName of the uploading admin
 * @returns {Promise<string>} Download URL of the stored file
 */
export async function uploadCircular(date, file, uploadedBy) {
    const { storage, ref, uploadBytes, getDownloadURL, deleteObject } = await _getStorageSdk();
    const storageRef = ref(storage, `circulars/${date}.pdf`);
    // Check before uploading so we know whether this is a replacement.
    // On failure we only delete the Storage object when it is newly created — deleting
    // on a re-upload failure would destroy the previously-valid object while Firestore
    // still references it, turning a transient error into a permanent broken link.
    const isReplace = (await getDoc(doc(db, COLLECTIONS.circulars, date))).exists();
    let storageUrl;
    try {
        await uploadBytes(storageRef, file, { contentType: 'application/pdf' });
        storageUrl = await getDownloadURL(storageRef);
        await setDoc(doc(db, COLLECTIONS.circulars, date), {
            date, storageUrl, fileType: 'pdf', uploadedAt: serverTimestamp(), uploadedBy,
        });
    } catch (err) {
        if (!isReplace) {
            // New upload only — safe to clean up the orphaned bytes.
            deleteObject(storageRef).catch(e => console.warn('[uploadCircular] rollback delete failed:', e));
        }
        throw err;
    }
    _pruneOldDocs(COLLECTIONS.circulars, storage, ref, deleteObject).catch(e => console.error('[pruneOldDocs] circulars:', e));
    return storageUrl;
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
 * Upload a Newsletter PDF to Firebase Storage and record it in Firestore.
 * Documents older than 6 months are pruned automatically after each upload.
 * @param {string} date       - ISO date string, e.g. "2026-06-27"
 * @param {File}   file       - PDF file chosen by the admin
 * @param {string} uploadedBy - memberName of the uploading admin
 * @returns {Promise<string>} Download URL of the stored file
 */
export async function uploadNewsletter(date, file, uploadedBy) {
    const { storage, ref, uploadBytes, getDownloadURL, deleteObject } = await _getStorageSdk();
    const storageRef = ref(storage, `newsletters/${date}.pdf`);
    const isReplace = (await getDoc(doc(db, COLLECTIONS.newsletters, date))).exists();
    let storageUrl;
    try {
        await uploadBytes(storageRef, file, { contentType: 'application/pdf' });
        storageUrl = await getDownloadURL(storageRef);
        await setDoc(doc(db, COLLECTIONS.newsletters, date), {
            date, storageUrl, fileType: 'pdf', uploadedAt: serverTimestamp(), uploadedBy,
        });
    } catch (err) {
        if (!isReplace) {
            deleteObject(storageRef).catch(e => console.warn('[uploadNewsletter] rollback delete failed:', e));
        }
        throw err;
    }
    _pruneOldDocs(COLLECTIONS.newsletters, storage, ref, deleteObject).catch(e => console.error('[pruneOldDocs] newsletters:', e));
    return storageUrl;
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
    return onSnapshot(q, (snap) => {
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
    const id = await endpointId(subscription.endpoint);
    await setDoc(doc(db, COLLECTIONS.pushSubscriptions, id), {
        endpoint:     subscription.endpoint,
        keys: {
            p256dh: keyToBase64(subscription.getKey('p256dh')),
            auth:   keyToBase64(subscription.getKey('auth')),
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
    await setDoc(doc(db, COLLECTIONS.staffContact, memberName), {
        memberName,
        workEmail,
        updatedAt: serverTimestamp(),
    }, { merge: true });
}

/**
 * Delete a staff member's contact record from Firestore.
 * Allowed by Firestore rules for the owning member or an admin.
 * @param {string} memberName
 * @returns {Promise<void>}
 */
export async function deleteStaffContact(memberName) {
    await deleteDoc(doc(db, COLLECTIONS.staffContact, memberName));
}

/**
 * Fetch every staff contact record (admin-only — Firestore rules enforce this).
 * @returns {Promise<Array<{memberName: string, workEmail: string}>>}
 */
export async function getAllStaffContacts() {
    const snap = await getDocs(collection(db, COLLECTIONS.staffContact));
    return snap.docs.map(d => d.data());
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
 * @returns {Promise<Array<{id: string, memberName: string, page: string, message: string, stack: string, appVersion: string, userAgent: string, timestamp: import('firebase/firestore').Timestamp, resolved: boolean, resolvedAt?: import('firebase/firestore').Timestamp}>>}
 */
export async function getClientErrors() {
    const now = Date.now();
    const [unresolvedSnap, resolvedSnap] = await Promise.all([
        getDocs(query(collection(db, COLLECTIONS.clientErrors), where('resolved', '==', false), limit(100))),
        getDocs(query(collection(db, COLLECTIONS.clientErrors), where('resolved', '==', true),  limit(200))),
    ]);
    const unresolved = unresolvedSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const resolved   = resolvedSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Best-effort prune of resolved records past the retention window (from resolvedAt).
    for (const id of expiredResolvedIds(resolved, now)) {
        deleteDoc(doc(db, COLLECTIONS.clientErrors, id)).catch(() => {/* best-effort cleanup */});
    }
    return orderClientErrors(unresolved, resolved, now);
}

/**
 * Mark a client error record as resolved, stamping the resolution time so retention is
 * measured from when it was resolved (not when the error occurred).
 * @param {string} id - Firestore document ID
 */
export async function resolveClientError(id) {
    await setDoc(doc(db, COLLECTIONS.clientErrors, id), { resolved: true, resolvedAt: serverTimestamp() }, { merge: true });
}
