// Fake of https://www.gstatic.com/firebasejs/<ver>/firebase-auth.js — see state.mjs.
import { state } from './state.mjs';

const auth = { get currentUser() { return state.currentUser; }, authStateReady: () => Promise.resolve() };
export function getAuth() { return auth; }
export function onAuthStateChanged(_auth, cb) { queueMicrotask(() => cb(state.currentUser)); return () => {}; }
export const indexedDBLocalPersistence = { type: 'indexeddb' };
export const browserLocalPersistence = { type: 'local' };
export const browserSessionPersistence = { type: 'session' };
export async function setPersistence(_auth, p) { state.authOps.push({ op: 'setPersistence', type: p.type }); }
const record = (op) => async (...args) => { state.authOps.push({ op, args: args.slice(1) }); return { user: state.currentUser }; };
export const signInWithEmailAndPassword = record('signInWithEmailAndPassword');
export const createUserWithEmailAndPassword = record('createUserWithEmailAndPassword');
export const signInAnonymously = record('signInAnonymously');
export const signInWithCustomToken = record('signInWithCustomToken');
export async function signOut() { state.authOps.push({ op: 'signOut' }); state.currentUser = null; }
export async function updatePassword(user, pw) {
    state.authOps.push({ op: 'updatePassword', uid: user.uid, pw });
    const code = state.reauthRejects.get(`update:${pw}`);
    if (code) throw Object.assign(new Error(code), { code });
}
export async function reauthenticateWithCredential(user, cred) {
    state.authOps.push({ op: 'reauthenticate', uid: user.uid, email: cred.email, pw: cred.pw });
    const code = state.reauthRejects.get(cred.pw);
    if (code) throw Object.assign(new Error(code), { code });
}
export const EmailAuthProvider = { credential: (email, pw) => ({ email, pw }) };
