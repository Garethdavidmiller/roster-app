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
    collection, query, where,
    getDocs, getDoc, addDoc, setDoc, deleteDoc,
    doc, serverTimestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';

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
