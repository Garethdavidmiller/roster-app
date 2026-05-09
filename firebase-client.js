/**
 * firebase-client.js — Single source of truth for Firebase initialisation.
 *
 * Both index.html and admin.html import from here, which means:
 *   - The project config (API key, project ID etc.) lives in one place only.
 *   - The Firebase SDK version appears in one place only — update it here
 *     and both apps pick up the change automatically.
 *   - Firebase is initialised once; the same `db` instance is shared.
 *
 * All Firestore operation functions (collection, getDocs, writeBatch etc.)
 * are re-exported so callers never need to import from the CDN directly.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js';
import {
    initializeFirestore, persistentLocalCache,
    collection, query, where, orderBy, limit,
    getDocs, getDoc, addDoc, setDoc, deleteDoc,
    doc, serverTimestamp, writeBatch, onSnapshot
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-storage.js';
import {
    getAuth,
    signInWithEmailAndPassword,
    signOut,
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
 */
export const db = initializeFirestore(app, { localCache: persistentLocalCache() });

// Re-export Firestore operation functions so callers import from one place.
export { collection, query, where, orderBy, limit, getDocs, getDoc, addDoc, setDoc, deleteDoc, doc, serverTimestamp, writeBatch, onSnapshot };

// ---- Firebase Authentication ----

/** Shared Firebase Auth instance. */
export const auth = getAuth(app);

// Re-export auth operations so callers import from one place.
export { signInWithEmailAndPassword, signOut };

/**
 * Derive a stable Firebase Auth email from a teamMembers display name.
 *
 * Convention: initial.surname@myb-roster.local
 *   "G. Miller"            → "g.miller@myb-roster.local"
 *   "C. Francisco-Charles" → "c.franciscocharles@myb-roster.local"
 *   "L. Atrakimaviciene"   → "l.atrakimaviciene@myb-roster.local"
 *
 * The @myb-roster.local domain is synthetic — these accounts are never used for email.
 * The password matches the existing localStorage password (surname, lowercase, alpha only).
 *
 * @param {string} fullName - Display name exactly as stored in teamMembers
 * @returns {string} Firebase Auth email address
 */
export function nameToEmail(fullName) {
    const parts   = fullName.split(' ');
    const initial = parts[0].replace(/[^a-zA-Z]/g, '').toLowerCase();
    const surname = parts.slice(1).join('').toLowerCase().replace(/[^a-z]/g, '');
    return `${initial}.${surname}@myb-roster.local`;
}

// ---- Firebase Storage ----

const storage = getStorage(app);

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
    const fileType   = file.name.toLowerCase().endsWith('.docx') ? 'docx' : 'pdf';
    // Explicitly set the content type rather than relying on the browser to report it.
    // On Android, .docx files sometimes arrive as 'application/zip' or 'application/octet-stream'
    // because DOCX is a ZIP archive — which can cause Firebase Storage rule mismatches.
    const mimeType   = fileType === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf';
    const storageRef = ref(storage, `huddles/${date}.${fileType}`);
    await uploadBytes(storageRef, file, { contentType: mimeType });
    const storageUrl = await getDownloadURL(storageRef);
    const firestoreDoc = { date, storageUrl, fileType, uploadedAt: serverTimestamp(), uploadedBy };
    if (htmlContent !== null) firestoreDoc.htmlContent = htmlContent;
    await setDoc(doc(db, 'huddles', date), firestoreDoc);
    return storageUrl;
}

/**
 * Retrieve the Huddle document for a given date from Firestore.
 *
 * Returns null — rather than throwing — when no Huddle has been uploaded,
 * so callers can degrade silently without showing an error to staff.
 *
 * @param {string} date - ISO date string, e.g. "2026-03-18"
 * @returns {Promise<{date: string, storageUrl: string, uploadedBy: string}|null>}
 */
export async function getTodaysHuddle(date) {
    const snap = await getDoc(doc(db, 'huddles', date));
    return snap.exists() ? snap.data() : null;
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
    const q = query(collection(db, 'huddles'), orderBy('date', 'desc'), limit(1));
    return onSnapshot(q, (snap) => {
        if (snap.empty) { onData(null); return; }
        const data = snap.docs[0].data();
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

/** Converts an ArrayBuffer from getKey() into a URL-safe base64 string for Firestore. */
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
    const id = await endpointId(endpoint);
    await deleteDoc(doc(db, 'pushSubscriptions', id));
}
