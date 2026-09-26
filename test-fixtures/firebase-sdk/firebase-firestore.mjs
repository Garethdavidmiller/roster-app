// Fake of https://www.gstatic.com/firebasejs/<ver>/firebase-firestore.js — a RECORDER with a small
// in-memory store behind it. See state.mjs for why it records rather than counts.
import { state } from './state.mjs';

export const SERVER_TS = Object.freeze({ __fake: 'serverTimestamp' });
const db = { __fake: 'firestore' };

export function initializeFirestore() { return db; }
export function getFirestore() { return db; }
export function persistentLocalCache() { return {}; }
export function serverTimestamp() { return SERVER_TS; }
export function increment(n) { return { __fake: 'increment', n }; }
export function deleteField() { return { __fake: 'deleteField' }; }
export class FieldPath { constructor(...segments) { this.segments = segments; } }

export function collection(_db, name) { return { kind: 'collection', col: name }; }
export function doc(base, ...rest) {
    if (base && base.kind === 'collection') {
        const id = rest[0] ?? `auto_${state.ops.length}_${Math.random().toString(36).slice(2, 8)}`;
        return { kind: 'doc', col: base.col, id, path: `${base.col}/${id}` };
    }
    const [col, id] = rest;
    return { kind: 'doc', col, id, path: `${col}/${id}` };
}
export function where(field, opStr, value) { return { kind: 'where', field, opStr, value }; }
export function orderBy(field, dir = 'asc') { return { kind: 'orderBy', field, dir }; }
export function limit(n) { return { kind: 'limit', n }; }
export function query(ref, ...constraints) { return { kind: 'query', col: ref.col, constraints }; }

function failIfArmed(path) {
    for (const [prefix, armed] of state.failNext) {
        if (!path.startsWith(prefix)) continue;
        // A bare code fails once; { code, times } fails that many writes in a row.
        const { code, times = 1 } = typeof armed === 'string' ? { code: armed } : armed;
        if (times <= 1) state.failNext.delete(prefix); else state.failNext.set(prefix, { code, times: times - 1 });
        throw Object.assign(new Error(code), { code });
    }
}
/** A copy the caller cannot mutate the store through — except a Timestamp (anything with `toMillis`),
 *  which is passed as-is: structuredClone would strip the method the retention rules read. */
function clone(v) {
    if (!v || typeof v !== 'object' || typeof v.toMillis === 'function') return v;
    if (Array.isArray(v)) return v.map(clone);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]));
}
/** A Firestore Timestamp stand-in: the one method the client's helpers call. */
export function fakeTimestamp(ms) { return { toMillis: () => ms }; }
function snap(path, id) {
    const data = state.docs.get(path);
    return { id, exists: () => data !== undefined, data: () => (data === undefined ? undefined : clone(data)) };
}
function merge(into, patch) {
    for (const [k, v] of Object.entries(patch)) {
        if (v && typeof v === 'object' && !Array.isArray(v) && !v.__fake && into[k] && typeof into[k] === 'object') merge(into[k], v);
        else into[k] = v;
    }
    return into;
}

export async function setDoc(ref, data, opts) {
    state.ops.push({ op: 'set', path: ref.path, data, opts });
    failIfArmed(ref.path);
    const prev = state.docs.get(ref.path);
    state.docs.set(ref.path, opts && opts.merge && prev ? merge(prev, data) : { ...data });
}
export async function updateDoc(ref, data, ...rest) {
    // The (ref, FieldPath, value) form — how the usage prune deletes a key that is not a valid dotted
    // path. Recorded as the path's SEGMENTS, so a test can tell it from a dotted string, which the
    // real SDK rejects synchronously.
    if (data instanceof FieldPath || typeof data === 'string') {
        const segments = data instanceof FieldPath ? data.segments : null;
        state.ops.push({ op: 'update', path: ref.path, field: data, segments, value: rest[0] });
        failIfArmed(ref.path);
        if (segments && rest[0] && rest[0].__fake === 'deleteField') {
            const cur = state.docs.get(ref.path);
            let node = cur;
            for (const seg of segments.slice(0, -1)) node = node?.[seg];
            if (node) delete node[segments[segments.length - 1]];
        }
        return;
    }
    state.ops.push({ op: 'update', path: ref.path, data });
    failIfArmed(ref.path);
    state.docs.set(ref.path, merge(state.docs.get(ref.path) || {}, data));
}
export async function deleteDoc(ref) {
    state.ops.push({ op: 'delete', path: ref.path });
    failIfArmed(ref.path);
    state.docs.delete(ref.path);
}
export async function addDoc(colRef, data) {
    const ref = doc(colRef);
    state.ops.push({ op: 'add', path: ref.path, col: colRef.col, data });
    failIfArmed(ref.path);
    state.docs.set(ref.path, { ...data });
    return ref;
}
export async function getDoc(ref) { failIfArmed(`read:${ref.path}`); return snap(ref.path, ref.id); }
export async function getDocs(q) {
    const col = q.col;
    const wheres = (q.constraints || []).filter((c) => c.kind === 'where');
    // Only what this fake genuinely implements. Any other operator used to MATCH EVERYTHING, so the
    // first test of a range query would have passed for the wrong reason (external review, 25 Sep).
    for (const w of wheres) if (w.opStr !== '==') throw new Error(`fake getDocs: where('${w.field}', '${w.opStr}') is not implemented`);
    const cap = (q.constraints || []).filter((c) => c.kind === 'limit').map((c) => c.n).pop();
    state.reads.push({ col, wheres: wheres.map((w) => ({ field: w.field, value: w.value })), limit: cap ?? null });
    let docs = [...state.docs.keys()]
        .filter((p) => p.startsWith(`${col}/`))
        .map((p) => snap(p, p.slice(col.length + 1)))
        .filter((s) => wheres.every((w) => s.data()[w.field] === w.value));
    // limit() is APPLIED, not ignored: a caller that asks for one row too few must get one row too
    // few, or a "fetch cap + 1 to detect overflow" rule is untestable.
    if (cap !== undefined) docs = docs.slice(0, cap);
    return { docs, size: docs.length, empty: docs.length === 0 };
}
export const getDocsFromCache = getDocs;
export function onSnapshot() { return () => {}; }
export function writeBatch() {
    const pending = [];
    return {
        set: (ref, data, opts) => pending.push(() => setDoc(ref, data, opts)),
        update: (ref, data) => pending.push(() => updateDoc(ref, data)),
        delete: (ref) => pending.push(() => deleteDoc(ref)),
        commit: async () => { for (const p of pending) await p(); },
    };
}
export async function runTransaction(_db, fn) {
    return fn({ get: getDoc, set: (r, d, o) => setDoc(r, d, o), update: updateDoc, delete: deleteDoc });
}
