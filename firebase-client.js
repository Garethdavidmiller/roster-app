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
export { collection, query, where, getDocs, getDoc, addDoc, setDoc, deleteDoc, doc, serverTimestamp, writeBatch };

// ---- Firebase Storage ----

const storage = getStorage(app);

/**
 * Upload a Huddle PDF for a given date.
 *
 * Stores the file at huddles/YYYY-MM-DD.pdf in Firebase Storage and writes
 * a metadata document to the `huddles` Firestore collection. If a Huddle
 * was already uploaded for that date, this overwrites it (latest wins).
 *
 * @param {string} date       - ISO date string, e.g. "2026-03-18"
 * @param {File}   file       - PDF file chosen by the admin
 * @param {string} uploadedBy - memberName of the uploading admin
 * @returns {Promise<string>} Publicly accessible download URL of the stored PDF
 */
export async function uploadHuddle(date, file, uploadedBy) {
    const storageRef = ref(storage, `huddles/${date}.pdf`);
    await uploadBytes(storageRef, file);
    const storageUrl = await getDownloadURL(storageRef);
    await setDoc(doc(db, 'huddles', date), {
        date,
        storageUrl,
        uploadedAt: serverTimestamp(),
        uploadedBy,
    });
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
