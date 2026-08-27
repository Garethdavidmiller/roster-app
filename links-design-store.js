// @ts-check
/**
 * links-design-store.js — the PERSISTENCE LIFECYCLE of a link design, and the concurrency
 * protocol that goes with it.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * `links-app.js` owned two unrelated things: the workspace (grid, paint, generator, dialogs,
 * picker) and the rules for writing a design to a collection several people edit at once. The
 * second was spread across EIGHT functions and twenty-seven direct Firestore calls, each one
 * implementing its own variant of the same protocol.
 *
 * That is not a tidiness complaint. An external audit (Aug 2026) found two silent overwrites in
 * that code, in different functions, both the same shape — and fixing them where they lay did
 * nothing to stop a third being written the next time somebody added a write path:
 *
 *   · RENAME read the current revision, decided its baseline was fresh, and then wrote. A
 *     co-editor's save landing in that gap survived the rename (a merge) but left our baseline
 *     pointing at a revision whose CONTENT we had never taken in — so our next save saw
 *     server == baseline, raised no conflict, and wrote our stale copy over theirs.
 *   · SAVE used a transaction and then fell back to `getDoc` → check → `setDoc` on any
 *     non-conflict failure, including online ones.
 *
 * ── THE RULES THIS MODULE OWNS, AND WHICH IT MAKES UNWRITABLE ───────────────────────────────────
 *
 * **1. A read that a write depends on happens INSIDE the write's transaction.** Not before it. The
 * pure helpers in `links-concurrency.js` were correct every time they were called; they were being
 * asked about a moment that had already passed. A transaction re-runs its callback when anything
 * lands underneath, so a decision made inside one is true at COMMIT.
 *
 * **2. There is no weaker fallback while online.** Offline is a different kind of thing, not a
 * lesser degree of online: transactions need the server, this app is deliberately offline-first,
 * and a device with no connection has no competing writer to lose a race to. An online transaction
 * failure is reported, and the caller keeps its unsaved state.
 *
 * **3. The local baseline only advances to a revision this module verified.** Everything else is
 * `baselineUnknown`, which makes the next save prompt. Being asked once too often costs a tap;
 * being asked once too seldom costs somebody else's afternoon.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────────────────────────
 *
 * No DOM, no dialogs, no confirm, no picker, no generator, no status text, and no decision about
 * what the user should SEE. A conflict comes back as `{ status: 'conflict', conflict }` and the
 * workspace decides whether to ask, overwrite or fork. That split is what lets this file be tested
 * against a fake Firestore, which is the only way the interleavings above can be exercised at all.
 *
 * It is also deliberately NOT a generic repository or CRUD service. It understands design
 * revisions, soft deletion and conflict results, because those are Links concepts; a
 * `FirestoreRepository<T>` would be an abstraction over the wrong thing.
 *
 * Every Firebase handle is INJECTED (`createDesignStore`). `links-app.js` passes the real ones.
 */

import { conflictOf, baselineAfterWrite, canAdvanceBaseline } from './links-concurrency.js';
import { isDeleted } from './links-deletion.js';

/**
 * @typedef {object} StoreDeps
 * @property {any} db
 * @property {Function} doc @property {Function} getDoc @property {Function} setDoc
 * @property {Function} addDoc @property {Function} getDocs @property {Function} runTransaction
 * @property {Function} serverTimestamp @property {Function} deleteField
 * @property {any} designsCol                     the collection reference
 * @property {Function} withClaimRetry            wraps every write (stale-claim self-heal)
 * @property {() => boolean} [isOnline]           overridable for tests
 */

/** Firestore reports an unreachable backend as `unavailable`; the browser has its own view. */
const _offlineByDefault = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * Was this failure the absence of a server, rather than a server that said no?
 * @param {any} err @param {() => boolean} isOnlineCheck
 * @returns {boolean}
 */
export function isOfflineFailure(err, isOnlineCheck = _offlineByDefault) {
    if (isOnlineCheck()) return true;
    return err?.code === 'unavailable' || /offline|client is offline/i.test(String(err?.message || ''));
}

/**
 * @param {StoreDeps} deps
 */
export function createDesignStore(deps) {
    const {
        db, doc, getDoc, setDoc, addDoc, getDocs, runTransaction,
        serverTimestamp, deleteField, designsCol, withClaimRetry,
    } = deps;
    const _isOnline = deps.isOnline;
    const offlineNow = _isOnline ? () => !_isOnline() : _offlineByDefault;
    const isOffline = (/** @type {any} */ err) => isOfflineFailure(err, offlineNow);
    const refFor = (/** @type {string} */ id) => doc(db, 'linkDesigns', id);

    /** Read a document's server `updatedAt`, or null if it cannot be read. */
    const readStamp = async (/** @type {any} */ ref) => {
        try { return (await getDoc(ref)).data()?.updatedAt ?? null; }
        catch { return null; }
    };

    return {
        /** Every design in the collection, split live vs binned. Raw docs — mapping stays outside. */
        async loadAll() {
            const snap = await getDocs(designsCol);
            return snap.docs.map((/** @type {any} */ d) => ({ id: d.id, data: d.data() }));
        },

        /**
         * Create a design and ARM its baseline from the server.
         *
         * The read-back is what makes the first content-save guarded. Without it a just-created
         * design carried `updatedAt: null`, the guard treated that as "nothing to compare", and a
         * concurrent edit was clobbered silently.
         * @param {any} payload
         * @returns {Promise<{ id: string, updatedAt: any, baseline: { loadedUpdatedAt: number|null, baselineUnknown: boolean } }>}
         */
        async create(payload) {
            const ref = await withClaimRetry(() => addDoc(designsCol, payload));
            const updatedAt = await readStamp(ref);
            return {
                id: ref.id,
                updatedAt,
                baseline: baselineAfterWrite(updatedAt?.toMillis?.()),
            };
        },

        /**
         * Save the open design, honouring the concurrency protocol.
         *
         * @param {object} o
         * @param {string} o.id
         * @param {() => any} o.buildPayload   called fresh inside each attempt
         * @param {number|null} o.baseline     our loaded revision (loadedUpdatedAt)
         * @param {boolean} o.baselineUnknown
         * @param {string} o.currentUser       whose save this is — `conflictOf` needs it to tell a
         *                                     stranger's write from our own on an unknown baseline
         * @param {boolean} [o.force]          the user accepted an overwrite — write unconditionally
         * @returns {Promise<{status: 'saved'|'conflict'|'deleted-elsewhere'|'queued', conflict?: any, deletedData?: any, baseline?: any, updatedAt?: any}>}
         */
        async save({ id, buildPayload, baseline, baselineUnknown, currentUser, force = false }) {
            const ref = refFor(id);
            if (force) {
                // The user has SEEN the conflict and chosen to replace. An unconditional write is
                // the decision they made, so there is nothing left to check.
                await withClaimRetry(() => setDoc(ref, buildPayload()));
                const updatedAt = await readStamp(ref);
                return { status: 'saved', updatedAt, baseline: baselineAfterWrite(updatedAt?.toMillis?.()) };
            }
            try {
                await withClaimRetry(() => runTransaction(db, async (/** @type {any} */ tx) => {
                    const snap = await tx.get(ref);
                    if (snap.exists() && isDeleted(snap.data())) {
                        const e = /** @type {any} */ (new Error('design-deleted'));
                        e.deletedData = snap.data();
                        throw e;
                    }
                    const c = conflictOf(snap.data() || {}, snap.exists(),
                        { loadedUpdatedAt: baseline, baselineUnknown, currentUser });
                    if (c) { const e = /** @type {any} */ (new Error('concurrent-edit')); e.conflict = c; throw e; }
                    tx.set(ref, buildPayload());
                }));
            } catch (err) {
                const e = /** @type {any} */ (err);
                if (e?.message === 'design-deleted')  return { status: 'deleted-elsewhere', deletedData: e.deletedData };
                if (e?.message === 'concurrent-edit') return { status: 'conflict', conflict: e.conflict };
                // RULE 2. Only the absence of a server may take the unserialised path.
                if (!isOffline(e)) throw err;
                await withClaimRetry(() => setDoc(ref, buildPayload()));
                // Nothing verified what the server held, so the baseline is UNKNOWN, never null.
                return { status: 'queued', baseline: baselineAfterWrite(null, false) };
            }
            const updatedAt = await readStamp(ref);
            return { status: 'saved', updatedAt, baseline: baselineAfterWrite(updatedAt?.toMillis?.()) };
        },

        /**
         * Rename, deciding INSIDE the transaction whether our baseline may advance (RULE 1).
         * @param {object} o
         * @param {string} o.id @param {string} o.name @param {string} o.by
         * @param {number|null} o.preBaseline
         * @returns {Promise<{ baselineFresh: boolean, updatedAt: any, queued: boolean }>}
         */
        async rename({ id, name, by, preBaseline }) {
            const ref = refFor(id);
            let baselineFresh = false;
            try {
                await withClaimRetry(() => runTransaction(db, async (/** @type {any} */ tx) => {
                    const snap = await tx.get(ref);
                    // Reassigned on every attempt: a retried transaction must not keep the verdict
                    // of the attempt that lost.
                    baselineFresh = canAdvanceBaseline(snap.data()?.updatedAt?.toMillis?.() ?? null, preBaseline);
                    tx.set(ref, { name, updatedAt: serverTimestamp(), updatedBy: by }, { merge: true });
                }));
            } catch (err) {
                if (!isOffline(err)) throw err;
                // A queued rename is fine — it is small and non-destructive — but nothing verified
                // the server, so the baseline may not move (RULE 3).
                baselineFresh = canAdvanceBaseline(null, preBaseline, false);
                await withClaimRetry(() => setDoc(ref,
                    { name, updatedAt: serverTimestamp(), updatedBy: by }, { merge: true }));
                return { baselineFresh, updatedAt: null, queued: true };
            }
            return { baselineFresh, updatedAt: baselineFresh ? await readStamp(ref) : null, queued: false };
        },

        /**
         * Soft-delete. A MERGE, never a replace: the patterns we hold may be a stale copy of a
         * co-designer's newer version, and deleting is not a reason to overwrite them.
         * @param {string} id @param {string} by
         */
        async softDelete(id, by) {
            await withClaimRetry(() => setDoc(refFor(id),
                { deletedAt: serverTimestamp(), deletedBy: by }, { merge: true }));
        },

        /**
         * Restore from the bin, clearing the two fields with `deleteField()` on a merge — a full
         * replace would push our load-time copy over whatever the design carried when it was
         * deleted. Re-arms the baseline, which matters MORE here than for a new design: this is an
         * old document a co-editor may still hold open.
         * @param {string} id @param {string} by
         */
        async restore(id, by) {
            const ref = refFor(id);
            await withClaimRetry(() => setDoc(ref, {
                deletedAt: deleteField(), deletedBy: deleteField(),
                updatedAt: serverTimestamp(), updatedBy: by,
            }, { merge: true }));
            return { updatedAt: await readStamp(ref) };
        },

        /**
         * Delete an EXPIRED bin entry, re-checking its expiry on the server.
         *
         * The sweep this belongs to is DISARMED (`_purgeExpiredDeletions` is never called — see its
         * header, and KNOWN_LIMITATIONS): a device clock 30 days fast makes every recent deletion
         * look expired, and the re-read agrees with itself because it uses the same wrong local
         * time. That is a decision about WHEN, and it is not this module's to make.
         *
         * What is this module's is the same rule as `purge`: read and delete inseparably, so a
         * colleague's restore cannot be overtaken by a queued delete. Kept here rather than left in
         * the coordinator so the sweep, if it is ever re-armed on server time, is re-armed against
         * a path that already has the protocol.
         * @param {string} id
         * @param {(data: any) => boolean} stillExpired
         */
        async purgeIfExpired(id, stillExpired) {
            const ref = refFor(id);
            await withClaimRetry(() => runTransaction(db, async (/** @type {any} */ tx) => {
                const snap = await tx.get(ref);
                if (!snap.exists()) return;                 // already gone
                if (!stillExpired(snap.data())) return;     // restored, or not actually expired
                tx.delete(ref);
            }));
        },

        /**
         * Permanent delete — the only hard delete left in the workspace, and transactional for the
         * reason that applies to every human-pressed destructive button: the row that was pressed
         * may be stale. A restores, B presses Remove for good on a list loaded before that, and a
         * design somebody deliberately rescued is destroyed with no undo. Reading inside the
         * transaction makes the decision and the deletion inseparable; offline it simply fails,
         * which is the right way for a permanent delete to fail.
         * @param {string} id
         * @returns {Promise<'removed'|'gone'|'restored-elsewhere'>}
         */
        async purge(id) {
            const ref = refFor(id);
            let outcome = /** @type {'removed'|'gone'} */ ('removed');
            try {
                await withClaimRetry(() => runTransaction(db, async (/** @type {any} */ tx) => {
                    const snap = await tx.get(ref);
                    if (!snap.exists()) { outcome = 'gone'; return; }
                    if (!isDeleted(snap.data())) throw new Error('design-restored');
                    tx.delete(ref);
                }));
            } catch (err) {
                if (err instanceof Error && err.message === 'design-restored') return 'restored-elsewhere';
                throw err;
            }
            return outcome;
        },
    };
}
