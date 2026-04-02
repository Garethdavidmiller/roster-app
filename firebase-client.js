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
    getFirestore,
    collection, query, where, orderBy, limit,
    getDocs, getDoc, addDoc, setDoc, deleteDoc,
    doc, serverTimestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-storage.js';

const firebaseConfig = {
    apiKey:            'AIzaSyBxB7eJ9LKkL5U9I9-IjNOVE_1RNeRGZWM',
    authDomain:        'myb-roster.firebaseapp.com',
    projectId:         'myb-roster',
    storageBucket:     'myb-roster.firebasestorage.app',
    messagingSenderId: '532910998075',
    appId:             '1:532910998075:web:b8360ba6a582554481921e'
};

const app = initializeApp(firebaseConfig);

/** Shared Firestore database instance. */
export const db = getFirestore(app);

// Re-export Firestore operation functions so callers import from one place.
export { collection, query, where, orderBy, limit, getDocs, getDoc, addDoc, setDoc, deleteDoc, doc, serverTimestamp, writeBatch };

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
 * Retrieve the most recently uploaded Huddle document from Firestore,
 * regardless of date. Used to keep the Huddle button always active —
 * staff can always access the latest briefing, not just today's.
 *
 * @returns {Promise<{date: string, storageUrl: string, uploadedBy: string}|null>}
 */
export async function getLatestHuddle() {
    const q    = query(collection(db, 'huddles'), orderBy('date', 'desc'), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const data = snap.docs[0].data();
    // Guard against a document that somehow has no storageUrl — opening undefined would fail silently
    return data.storageUrl ? data : null;
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
