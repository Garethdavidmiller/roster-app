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

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js';
import {
    initializeFirestore, getFirestore, persistentLocalCache,
    collection, query, where, orderBy, limit,
    getDocs, getDoc, addDoc, setDoc, deleteDoc,
    doc, serverTimestamp, writeBatch, onSnapshot
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';
// firebase-storage (~30 kB) is dynamically imported inside uploadHuddle() — only
// operations.html actually uploads files, so index.html, admin.html, and paycalc.html avoid the cost.
import {
    getAuth,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInAnonymously,
    signOut,
    setPersistence,
    indexedDBLocalPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js';

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
    await setDoc(doc(db, 'huddles', date), firestoreDoc);
    return storageUrl;
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
    // Requires Firestore composite index: huddles/date desc — see Firebase Console → Indexes.
    const q = query(collection(db, 'huddles'), orderBy('date', 'desc'), limit(1));
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
    await setDoc(doc(db, 'pushSubscriptions', id), {
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
    await deleteDoc(doc(db, 'pushSubscriptions', id));
}

// ---- Profile Avatars ----
// A member's profile photo lives at avatars/<slug>.jpg in Storage, with a
// pointer document at memberAvatars/<memberName> in Firestore holding the
// download URL. The pointer doc is open-read (like huddles/overrides) because
// the nav footer renders the avatar on index.html, which has no Firebase Auth
// session — and the image is already public via its tokenised Storage URL.

/**
 * Storage object path for a member's avatar. Non-alphanumeric characters in the
 * display name are collapsed to underscores so the path is filesystem-safe.
 * "G. Miller" → "avatars/G__Miller.jpg".
 * @param {string} memberName
 * @returns {string}
 */
function avatarStoragePath(memberName) {
    return `avatars/${memberName.replace(/[^a-zA-Z0-9]/g, '_')}.jpg`;
}

/**
 * Upload a compressed JPEG avatar for a member and record its download URL.
 * Overwrites any existing avatar for that member (latest wins). The caller is
 * responsible for compressing the image client-side before calling this.
 * @param {string} memberName - Display name, exact teamMembers match
 * @param {Blob}   blob       - JPEG image blob (compressed client-side)
 * @returns {Promise<string>} Public download URL of the stored avatar
 */
export async function uploadAvatar(memberName, blob) {
    const { storage, ref, uploadBytes, getDownloadURL } = await _getStorageSdk();
    const storageRef = ref(storage, avatarStoragePath(memberName));
    await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
    const url = await getDownloadURL(storageRef);
    // The pointer doc is the source of truth for display. Storage was just
    // overwritten (which rotates the download token), so a failed pointer write
    // would leave the OLD pointer URL pointing at a now-invalid token — a visibly
    // broken avatar until the next save. Retry the pointer write once so a single
    // transient blip between the two awaits doesn't strand us in that state.
    const pointer = {
        avatarUrl: url,
        updatedAt: serverTimestamp(),
        updatedBy: memberName,
    };
    try {
        await setDoc(doc(db, 'memberAvatars', memberName), pointer);
    } catch (e) {
        console.warn('[Avatar] pointer write failed, retrying once:', e);
        await setDoc(doc(db, 'memberAvatars', memberName), pointer);
    }
    return url;
}

/**
 * Remove a member's avatar. The Firestore pointer is the source of truth, so it
 * is deleted FIRST — if that fails (e.g. offline) the call rejects and the UI can
 * surface the error without having touched Storage. Once the pointer is gone the
 * Storage delete is best-effort: any failure (including 'object-not-found') is
 * logged but NOT rethrown, so a Storage hiccup never blocks a remove the user
 * sees as done. An orphaned Storage object is harmless (nothing references it).
 * @param {string} memberName
 * @returns {Promise<void>}
 */
export async function deleteAvatar(memberName) {
    await deleteDoc(doc(db, 'memberAvatars', memberName));
    try {
        const { storage, ref, deleteObject } = await _getStorageSdk();
        await deleteObject(ref(storage, avatarStoragePath(memberName)));
    } catch (e) {
        if (e?.code !== 'storage/object-not-found') {
            console.warn('[Avatar] storage delete failed (orphan left, pointer already removed):', e);
        }
    }
}

/**
 * Read a member's avatar download URL from the Firestore pointer document.
 * Resolves to the URL string, or `null` on a SUCCESSFUL read with no avatar set.
 * REJECTS on a read failure (offline, rules, cold cache) — deliberately distinct
 * from the no-avatar `null` so callers can tell "the photo was removed" (clear
 * the cache) from "couldn't reach the server" (keep the cached value). Open-read,
 * so it works without a Firebase Auth session.
 * @param {string} memberName
 * @returns {Promise<string|null>}
 */
export async function fetchAvatarUrl(memberName) {
    const snap = await getDoc(doc(db, 'memberAvatars', memberName));
    return snap.exists() ? (snap.data().avatarUrl || null) : null;
}
