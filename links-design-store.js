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

import { conflictOf, baselineAfterWrite, baselineAfterCommit, canAdvanceBaseline, nextRevision } from './links-concurrency.js';
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
         * @returns {Promise<{ id: string, updatedAt: any, baseline: { loadedRevision: number|null, loadedUpdatedAt: number|null, baselineUnknown: boolean } }>}
         */
        async create(payload) {
            // Revision 1, stamped here rather than discovered by reading back (v22.18). A create has
            // nothing to race — the document did not exist — so this is the one place the number is
            // certain without a transaction, and the baseline is exact from the first save onward.
            const ref = await withClaimRetry(() => addDoc(designsCol, { ...payload, revision: 1 }));
            const updatedAt = await readStamp(ref);
            return {
                id: ref.id,
                updatedAt,
                baseline: baselineAfterCommit(1),
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
         * @param {boolean} [o.forcing]        this is the second attempt, after the user accepted
         *                                     an overwrite. `forceAgainstRevision` then names WHICH
         *                                     revision they approved replacing.
         * @param {number|null} [o.loadedRevision]  the revision we hold — the exact identity (v22.18)
         * @param {number|null} [o.forceAgainstRevision]  the `updatedAt` millis the conflict dialog
         *                                     showed them, or null if it carried no timestamp
         * @param {number|null} [o.forceAgainstRev]  the REVISION that dialog showed them. Preferred
         *                                     over the timestamp; the timestamp remains for a design
         *                                     nobody has saved since v22.18
         * @returns {Promise<{status: 'saved'|'conflict'|'deleted-elsewhere'|'queued', conflict?: any, deletedData?: any, baseline?: any, updatedAt?: any}>}
         */
        async save({ id, buildPayload, baseline, baselineUnknown, currentUser, loadedRevision = null,
            forcing = false, forceAgainstRevision = null, forceAgainstRev = null }) {
            const ref = refFor(id);
            /** The revision this attempt actually COMMITTED — set inside the transaction, so the
             *  baseline needs no read-back and has no window in it (v22.18). */
            let committed = 0;
            if (forcing) {
                // ── WHAT THE USER ACTUALLY CONSENTED TO ─────────────────────────────────────
                // "Replace THE VERSION I WAS SHOWN", not "replace whatever exists whenever I get
                // round to pressing the button". Until v21.96 this was an unconditional `setDoc`,
                // on the reasoning that the decision had been made — and the gap it ignored is the
                // same human think-time the delete check below was added for:
                //
                //     Alice loads R1. Bob saves R2. Alice saves; the dialog names Bob's R2.
                //     Charlie saves R3 while Alice reads it. Alice presses Replace.
                //     R3 is destroyed. Alice never saw it and never agreed to replace it.
                //
                // So the approved revision is re-checked INSIDE the transaction, and anything else
                // comes back as a fresh conflict for the user to consent to on its own terms. That
                // is the same rule as the first attempt, with a different baseline — which is why
                // this is a compare-and-set and not a second kind of write.
                //
                // A DELETE is a different consent again, and was never given (v21.92): `docPayload`
                // carries no `deletedAt`, so an unguarded force STRIPS the deletion and the design
                // reappears in the picker with its deleter never told. A document that has gone
                // ENTIRELY (purged from the bin while the dialog sat open) takes the same exit with
                // no data — the workspace's offer, "save mine as new", is right for both, and only
                // one line of its copy assumes the bin.
                let deletedData = null;
                let gone = false;
                /** @type {{by: string, at: any, rev: number|null}|null} */
                let movedOn = null;
                await withClaimRetry(() => runTransaction(db, async (/** @type {any} */ tx) => {
                    // A retried transaction must not keep the losing attempt's verdict — the same
                    // reset `rename` makes below, for the same reason. NOT covered by a test: the
                    // suite's fake calls the callback exactly once, so it cannot express a retry.
                    // Stated rather than left to look tested.
                    deletedData = null; gone = false; movedOn = null;
                    const snap = await tx.get(ref);
                    if (!snap.exists()) { gone = true; return; }
                    const d = snap.data() || {};
                    if (isDeleted(d)) { deletedData = d; return; }
                    // Consent is per VERSION, and the revision names it exactly. Falls back to the
                    // timestamp for a design nobody has saved since v22.18, so an in-flight dialog
                    // opened before this release still resolves correctly (v22.18).
                    const liveRev = typeof d.revision === 'number' ? d.revision : null;
                    const liveRevision = d.updatedAt?.toMillis?.() ?? null;
                    const movedOnFromApproved = (liveRev !== null || forceAgainstRev !== null)
                        ? liveRev !== forceAgainstRev
                        : liveRevision !== forceAgainstRevision;
                    if (movedOnFromApproved) {
                        movedOn = { by: d.updatedBy || 'Someone', at: d.updatedAt || null, rev: liveRev };
                        return;
                    }
                    committed = nextRevision(d);
                    tx.set(ref, { ...buildPayload(), revision: committed });
                }));
                if (gone)         return { status: 'deleted-elsewhere', deletedData: null };
                if (deletedData)  return { status: 'deleted-elsewhere', deletedData };
                if (movedOn)      return { status: 'conflict', conflict: movedOn };
                const updatedAt = await readStamp(ref);
                return { status: 'saved', updatedAt, baseline: baselineAfterCommit(committed) };
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
                        { loadedRevision, loadedUpdatedAt: baseline, baselineUnknown, currentUser });
                    if (c) { const e = /** @type {any} */ (new Error('concurrent-edit')); e.conflict = c; throw e; }
                    // Reassigned on EVERY attempt, from what THIS attempt read — a retried
                    // transaction that kept the losing attempt's number would write a revision the
                    // server has already used, and every later comparison would agree wrongly.
                    committed = nextRevision(snap.data());
                    tx.set(ref, { ...buildPayload(), revision: committed });
                }));
            } catch (err) {
                const e = /** @type {any} */ (err);
                if (e?.message === 'design-deleted')  return { status: 'deleted-elsewhere', deletedData: e.deletedData };
                if (e?.message === 'concurrent-edit') return { status: 'conflict', conflict: e.conflict };
                // RULE 2. Only the absence of a server may take the unserialised path.
                if (!isOffline(e)) throw err;
                // Offline still CONSULTS what we hold before writing. Firestore runs with
                // persistentLocalCache, so this read is usually served from IndexedDB — it cannot
                // prove anything about the server, but it can carry a deletion or a co-editor's
                // save that reached this device before the connection went. Queueing a blind write
                // over a design our own cache says was deleted would resurrect it on sync, which is
                // the one outcome `deleted-elsewhere` exists to prevent. (Preserved from the path
                // this replaced; dropping it was a regression I introduced and caught in review.)
                try {
                    const cached = await getDoc(ref);
                    if (cached.exists() && isDeleted(cached.data())) {
                        return { status: 'deleted-elsewhere', deletedData: cached.data() };
                    }
                    const c = conflictOf(cached.data() || {}, cached.exists(),
                        { loadedRevision, loadedUpdatedAt: baseline, baselineUnknown, currentUser });
                    if (c) return { status: 'conflict', conflict: c };
                } catch { /* no cached state either — nothing to consult, proceed */ }
                // A queued write increments from what we last KNEW. If we were right, the counter
                // stays monotonic; if somebody saved while we were offline, theirs is >= ours and
                // the mismatch surfaces as a conflict on the next save. Both directions are safe,
                // which is the only claim available here — nothing verified the server.
                await withClaimRetry(() => setDoc(ref,
                    { ...buildPayload(), revision: (loadedRevision ?? 0) + 1 }));
                // Nothing verified what the server held, so the baseline is UNKNOWN, never null.
                return { status: 'queued', baseline: baselineAfterWrite(null, false) };
            }
            const updatedAt = await readStamp(ref);
            return { status: 'saved', updatedAt, baseline: baselineAfterCommit(committed) };
        },

        /**
         * Rename, deciding INSIDE the transaction whether our baseline may advance (RULE 1).
         * @param {object} o
         * @param {string} o.id @param {string} o.name @param {string} o.by
         * @param {number|null} o.preBaseline
         * @param {number|null} [o.preRevision] the revision we hold for that doc (v22.18) — exact,
         *   where `preBaseline` is the pre-v22.18 fallback
         * @returns {Promise<{ baselineFresh: boolean, revision: number|null, updatedAt: any, queued: boolean }>}
         */
        async rename({ id, name, by, preBaseline, preRevision = null }) {
            const ref = refFor(id);
            let baselineFresh = false;
            let committed = 0;
            try {
                await withClaimRetry(() => runTransaction(db, async (/** @type {any} */ tx) => {
                    const snap = await tx.get(ref);
                    // Reassigned on every attempt: a retried transaction must not keep the verdict
                    // of the attempt that lost.
                    const liveRev = typeof snap.data()?.revision === 'number' ? snap.data().revision : null;
                    // The REVISION answers "is this still the document we loaded?" exactly; the
                    // timestamp is the fallback for a design nobody has saved since v22.18. Same
                    // rule as before — advance our baseline only when nothing moved underneath us —
                    // asked with a value that cannot be raced.
                    baselineFresh = (liveRev !== null || preRevision !== null)
                        ? liveRev === preRevision
                        : canAdvanceBaseline(snap.data()?.updatedAt?.toMillis?.() ?? null, preBaseline);
                    committed = nextRevision(snap.data());
                    tx.set(ref, { name, revision: committed, updatedAt: serverTimestamp(), updatedBy: by }, { merge: true });
                }));
            } catch (err) {
                if (!isOffline(err)) throw err;
                // A queued rename is fine — it is small and non-destructive — but nothing verified
                // the server, so the baseline may not move (RULE 3).
                baselineFresh = canAdvanceBaseline(null, preBaseline, false);
                await withClaimRetry(() => setDoc(ref,
                    { name, updatedAt: serverTimestamp(), updatedBy: by }, { merge: true }));
                return { baselineFresh, revision: null, updatedAt: null, queued: true };
            }
            // A rename that may advance the baseline advances it to the revision it COMMITTED —
            // exactly, and with no read-back to race. `updatedAt` is still returned for the picker's
            // "last saved" line, which is display only.
            return { baselineFresh, revision: baselineFresh ? committed : null,
                updatedAt: baselineFresh ? await readStamp(ref) : null, queued: false };
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
            // A restore BUMPS the revision, in a transaction, and hands the number back (v22.18).
            // It is a write everyone else sees, so leaving the counter alone would make the design
            // reappear still wearing its pre-deletion revision — and the restorer's entry, which
            // carries no revision, would then disagree with the server on the very next save and
            // prompt "someone else saved this" about their own restore. Not destructive (the safe
            // direction), and a false conflict is exactly what teaches people to click through the
            // one prompt that protects them.
            let committed = 0;
            await withClaimRetry(() => runTransaction(db, async (/** @type {any} */ tx) => {
                committed = nextRevision((await tx.get(ref)).data());
                tx.set(ref, {
                    deletedAt: deleteField(), deletedBy: deleteField(), revision: committed,
                    updatedAt: serverTimestamp(), updatedBy: by,
                }, { merge: true });
            }));
            return { updatedAt: await readStamp(ref), revision: committed };
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
