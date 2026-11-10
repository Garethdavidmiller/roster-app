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
 * **4. A queued (offline) write is started, not awaited, and never stamps a revision a colleague's
 * online save could also produce.** See `sendWrite` and `queuedRevision`. A save, a rename, a delete
 * and a create alike — the create names its document with an auto-id reference so it can be queued
 * too — and an online delete the server does not answer within `SLOW_SAVE_MS` is answered as queued.
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
import { SIGNED_OUT_CODE, UNCONFIRMED_CODE } from './claim-retry.js';
import { SLOW_SAVE_MS } from './slow-save.js';

/**
 * @typedef {object} StoreDeps
 * @property {any} db
 * @property {Function} doc @property {Function} getDoc @property {Function} setDoc
 * @property {Function} addDoc @property {Function} getDocs @property {Function} runTransaction
 * @property {Function} serverTimestamp @property {Function} deleteField
 * @property {any} designsCol                     the collection reference
 * @property {Function} withClaimRetry            wraps every write (stale-claim self-heal)
 * @property {() => boolean} [isOnline]           overridable for tests
 * @property {number} [ackWaitMs]                 how long an online delete waits for the server
 *                                                before it is answered as queued; overridable for tests
 * @property {Function} [getDocFromCache]         the CACHE's own answer for one document, for the
 *                                                offline consult — see `cacheRead`
 */

/** Firestore reports an unreachable backend as `unavailable`; the browser has its own view. */
const _offlineByDefault = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * Answers from this page's OWN write machinery (claim-retry.js): the gate refusing a write while an
 * earlier one is unconfirmed, and an account that signed out mid-write. Neither is the absence of a
 * server, whatever the browser says. Read as offline, the gate's refusal took the queued path and the
 * page said "Saved in this browser" about a write that was never issued (whole-app fix, Nov 2026).
 */
const NEVER_OFFLINE = new Set([UNCONFIRMED_CODE, SIGNED_OUT_CODE]);

/**
 * Was this failure the absence of a server, rather than a server that said no?
 * @param {any} err @param {() => boolean} isOfflineNow  true when the device reports itself OFFLINE
 * @returns {boolean}
 */
export function isOfflineFailure(err, isOfflineNow = _offlineByDefault) {
    if (NEVER_OFFLINE.has(err?.code)) return false;
    if (isOfflineNow()) return true;
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
    const ackWaitMs = deps.ackWaitMs ?? SLOW_SAVE_MS;
    /**
     * WHAT THIS DEVICE HOLDS for one document — the offline consult before a queued write (whole-app
     * fix, Nov 2026). `getDocFromCache` answers from the cache alone: a deletion the cache recorded
     * comes back as not existing, and a document it never held REJECTS. Offline, plain `getDoc`
     * rejects for BOTH (read in the SDK, and run against it with the network off), so a store given
     * only `getDoc` cannot see a deletion its cache knows of, and queues as if nothing were cached.
     */
    const cacheRead = deps.getDocFromCache ?? getDoc;
    const isOffline = (/** @type {any} */ err) => isOfflineFailure(err, offlineNow);
    const refFor = (/** @type {string} */ id) => doc(db, 'linkDesigns', id);

    /**
     * RULE 4 — send a write, and wait for the server's acknowledgement for at most `waitMs`.
     *
     * Firestore resolves a write only when the server acknowledges it — offline, "not until the
     * connection returns" — so awaiting one held the page on "Saving…" instead of reporting the queue.
     * Resolves `'acked'` when the answer comes in time and `'queued'` when it does not: the write is
     * issued and the SDK owns the queue, so a later rejection (a rules refusal on sync) is logged, the
     * one place left to see it.
     *
     * It REJECTS with any answer that comes in time, and that includes a refusal before anything was
     * issued: the page's unconfirmed-write gate refuses inside `withClaimRetry`, so there is no write
     * to queue. Started-not-awaited, that refusal was only logged and the store answered "queued" for
     * nothing (whole-app fix, Nov 2026). The bound starts when the write is ISSUED, so it can never
     * outrun a refusal.
     * @param {() => Promise<any>} write
     * @param {number} waitMs  0 to issue and move on, for a device known to be offline
     * @returns {Promise<'acked'|'queued'>}
     */
    const sendWrite = (write, waitMs) => new Promise((resolve, reject) => {
        let answered = false;
        /** @type {any} */ let timer = null;
        /** The first answer wins, once. @param {() => void} settle */
        const answer = (settle) => {
            if (answered) return false;
            answered = true;
            clearTimeout(timer);
            settle();
            return true;
        };
        withClaimRetry(() => {
            if (timer === null) timer = setTimeout(() => answer(() => resolve('queued')), waitMs);
            return write();
        }).then(() => { answer(() => resolve('acked')); }, (/** @type {any} */ err) => {
            if (answer(() => reject(err))) return;
            // Signed out while queued is NOT a failure: the SDK keeps it for that account (v24.37).
            if (err?.code === SIGNED_OUT_CODE) { console.warn('[Links] Queued write held until that designer signs in again'); return; }
            console.error('[Links] Queued write failed on sync:', err);
        });
    });
    /** A write for a device that is offline: issued, then answered `queued`. @param {() => Promise<any>} write */
    const queueWrite = (write) => sendWrite(write, 0);

    /**
     * The revision a QUEUED write stamps. Not `known + 1`: that is precisely what a colleague's
     * online save from the same revision commits, so the two collided and her next save matched ours
     * and overwrote it unasked. Not absent either: a document with no revision restarts at 1 on its
     * next save, and a tab left open on an old revision 1 would then match. The clock in ms is far
     * above any counter a transaction produces, and still an int >= 1 as `firestore.rules` requires;
     * `max` keeps it monotonic if an earlier queued write already moved the counter there.
     * @param {number|null} known
     */
    const queuedRevision = (known) => Math.max((known ?? 0) + 1, Date.now());

    /** Read a document's server `updatedAt`, or null if it cannot be read. */
    const readStamp = async (/** @type {any} */ ref) => {
        try { return (await getDoc(ref)).data()?.updatedAt ?? null; }
        catch { return null; }
    };

    /**
     * OUR OWN QUEUED RENAMES, per design: the revision each stamped, and the revision the cache held
     * under it (whole-app review, Oct 2026). Offline, a save consults the CACHE, and the cache shows
     * our queued rename on top of whatever was there — its revision, but the last saver's name. So a
     * save after our own offline rename read as "S. Silva saved a different version". The cache is
     * judged on the revision UNDER our rename instead; a colleague's save that reached this device
     * first is still caught, because then that revision is not the one we hold.
     *
     * …AND ON WHO SAVED THE CONTENT UNDER IT, AND WHEN (48-hour review, Nov 2026). Our queued rename
     * merges only name and revision, so if a colleague saved while we were offline, the synced
     * document carries OUR revision over HER content, stamp and name — and the revision alone took it
     * for our rename and queued an overwrite of her save unasked. A rename writes neither stamp nor
     * name, so while both still match the ones we cached, the content is the one we held.
     *
     * …AND ONLINE, ONCE THE RENAME HAS SYNCED (whole-app fix, Nov 2026). The server then holds what
     * the cache did, and the transactions read it raw, so the first ONLINE save after a queued rename
     * met the same false conflict about S. Silva. Every save, forced save and rename now reads through
     * it, and a colleague's save — under our rename or after it — is still caught by the same checks.
     * @type {Map<string, {rev: number, before: number|null, stamp: number|null, by: string|null}>}
     */
    const ownRenames = new Map();
    /** What the cached copy says once our own queued rename is seen through. @param {string} id @param {any} data */
    const throughOwnRename = (id, data) => {
        const own = ownRenames.get(id);
        return own && data?.revision === own.rev
            && (data?.updatedAt?.toMillis?.() ?? null) === own.stamp && (data?.updatedBy ?? null) === own.by
            ? { ...data, revision: own.before } : data;
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
         * @returns {Promise<{ id: string, updatedAt: any, queued?: boolean, baseline: { loadedRevision: number|null, loadedUpdatedAt: number|null, baselineUnknown: boolean } }>}
         */
        async create(payload) {
            // Revision 1, stamped here rather than discovered by reading back (v22.18). A create has
            // nothing to race — the document did not exist — so this is the one place the number is
            // certain without a transaction, and the baseline is exact from the first save onward.
            const body = { ...payload, revision: 1 };
            // OFFLINE, RULE 4 (Sep 2026 re-review): `addDoc` resolves only on the server's ack, so it
            // held "Saving…" until the signal came back. An auto-id reference names the document
            // BEFORE the write, so it is queued and returned at once — still revision 1, and still
            // exact, because nobody else can write a document whose id only this device holds.
            if (offlineNow()) {
                const queuedRef = doc(designsCol);
                await queueWrite(() => setDoc(queuedRef, body));
                return { id: queuedRef.id, updatedAt: null, queued: true, baseline: baselineAfterCommit(1) };
            }
            // Online the create is AWAITED, so on a connection that is up but cannot reach Firestore it
            // has no bound, unlike the delete below (whole-app fix, Nov 2026). Bounding it needs the
            // document named BEFORE the write, as the branch above does, so that an unanswered create
            // can still come back as queued with its id; the e2e double mints no id for `doc(col)`
            // and models a create only through `addDoc`, so that change waits on e2e/fixtures.js.
            const ref = await withClaimRetry(() => addDoc(designsCol, body));
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
                /** Consent is per VERSION, and the revision names it exactly. Falls back to the
                 *  timestamp for a design nobody has saved since v22.18, so an in-flight dialog
                 *  opened before this release still resolves correctly (v22.18). @param {any} d */
                const movedOnOf = (d) => {
                    const liveRev = typeof d.revision === 'number' ? d.revision : null;
                    const liveRevision = d.updatedAt?.toMillis?.() ?? null;
                    const moved = (liveRev !== null || forceAgainstRev !== null)
                        ? liveRev !== forceAgainstRev
                        : liveRevision !== forceAgainstRevision;
                    return moved ? { by: d.updatedBy || 'Someone', at: d.updatedAt || null, rev: liveRev } : null;
                };
                try {
                    await withClaimRetry(() => runTransaction(db, async (/** @type {any} */ tx) => {
                        // A retried transaction must not keep the losing attempt's verdict — the same
                        // reset `rename` makes below, for the same reason. Pinned by "a RETRIED forced
                        // save decides afresh" in links-design-store.test.mjs, whose fake runs this
                        // body twice (test audit, 7 Nov 2026; until then nothing could see it).
                        deletedData = null; gone = false; movedOn = null;
                        const snap = await tx.get(ref);
                        if (!snap.exists()) { gone = true; return; }
                        const d = snap.data() || {};
                        if (isDeleted(d)) { deletedData = d; return; }
                        movedOn = movedOnOf(throughOwnRename(id, d));   // see `ownRenames`
                        if (movedOn) return;
                        committed = nextRevision(d);
                        tx.set(ref, { ...buildPayload(), revision: committed });
                    }));
                } catch (err) {
                    // OFFLINE, CONSENT IS CHECKED AGAINST THE CACHE — the same thing an ordinary
                    // offline save consults (whole-app review, Oct 2026). The conflict being answered
                    // usually CAME from the cache, and a transaction cannot run without a server, so
                    // "Replace" failed every time it was offered offline. Rule 2 still holds: only an
                    // offline failure gets here, and the write is queued, never awaited.
                    if (!isOffline(err)) throw err;
                    try {
                        const cached = await cacheRead(ref);
                        if (!cached.exists()) return { status: 'deleted-elsewhere', deletedData: null };   // as below
                        const d = throughOwnRename(id, cached.data() || {});
                        if (isDeleted(d)) return { status: 'deleted-elsewhere', deletedData: d };
                        const again = movedOnOf(d);
                        if (again) return { status: 'conflict', conflict: again };
                    } catch { /* nothing cached to consult — proceed, as the ordinary offline save does */ }
                    await queueWrite(() => setDoc(ref, { ...buildPayload(), revision: queuedRevision(loadedRevision) }));
                    return { status: 'queued', baseline: baselineAfterWrite(null, false) };
                }
                if (gone)         return { status: 'deleted-elsewhere', deletedData: null };
                if (deletedData)  return { status: 'deleted-elsewhere', deletedData };
                if (movedOn)      return { status: 'conflict', conflict: movedOn };
                const updatedAt = await readStamp(ref);
                return { status: 'saved', updatedAt, baseline: baselineAfterCommit(committed) };
            }
            // THE TRANSACTION IS TRIED FIRST EVEN WHEN THE BROWSER ALREADY SAYS OFFLINE, and that is
            // deliberate (whole-app fix, Nov 2026). It costs six to ten seconds of "Saving…" on a device
            // that really is offline — the SDK runs the body five times with back-off before giving up
            // (measured against the real SDK with the network off) — where create and delete, with no
            // read to serialise, ask `offlineNow()` first. But `navigator.onLine` is the browser's view,
            // not Firestore's, and a device that reports itself offline while it can reach the server
            // must still get the compare-and-set: a wrong "offline" may not buy the path rule 2 keeps for
            // the absence of a server. `rename` tries first for the same reason.
            try {
                await withClaimRetry(() => runTransaction(db, async (/** @type {any} */ tx) => {
                    const snap = await tx.get(ref);
                    // A document that has GONE (removed for good from the bin) takes the same exit
                    // as the forced path's `gone`, with no deleter. Writing here would recreate it
                    // at revision 1 — a delete undone by somebody who never saw it.
                    if (!snap.exists() || isDeleted(snap.data())) {
                        const e = /** @type {any} */ (new Error('design-deleted'));
                        e.deletedData = snap.exists() ? snap.data() : null;
                        throw e;
                    }
                    const c = conflictOf(throughOwnRename(id, snap.data() || {}), snap.exists(),   // see `ownRenames`
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
                    const cached = await cacheRead(ref);
                    // NOT EXISTING here is the read KNOWING it was removed for good: through
                    // `getDocFromCache`, the cache's own record of the deletion; through plain `getDoc`,
                    // only a server answer, because offline `getDoc` rejects for a document it does not
                    // hold, a known deletion included (`cacheRead`). A read that cannot tell lands in the
                    // catch below, and the write is queued with nothing to consult.
                    if (!cached.exists()) return { status: 'deleted-elsewhere', deletedData: null };
                    if (isDeleted(cached.data())) {
                        return { status: 'deleted-elsewhere', deletedData: cached.data() };
                    }
                    const c = conflictOf(throughOwnRename(id, cached.data() || {}), cached.exists(),
                        { loadedRevision, loadedUpdatedAt: baseline, baselineUnknown, currentUser });
                    if (c) return { status: 'conflict', conflict: c };
                } catch { /* no cached state either — nothing to consult, proceed */ }
                // A queued write may NOT increment from what we last knew: `known + 1` is exactly
                // the number a colleague's online save from the same revision commits, so when ours
                // landed the two matched and her next save overwrote ours with no prompt. See
                // `queuedRevision`. Issued, not awaited — rule 4.
                await queueWrite(() => setDoc(ref, { ...buildPayload(), revision: queuedRevision(loadedRevision) }));
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
                    // of the attempt that lost. Asked of the document with our own queued rename seen
                    // through (`ownRenames`), and the counter moved from the one really there.
                    const seen = throughOwnRename(id, snap.data() || {});
                    const liveRev = typeof seen.revision === 'number' ? seen.revision : null;
                    // The REVISION answers "is this still the document we loaded?" exactly; the
                    // timestamp is the fallback for a design nobody has saved since v22.18. Same
                    // rule as before — advance our baseline only when nothing moved underneath us —
                    // asked with a value that cannot be raced.
                    baselineFresh = (liveRev !== null || preRevision !== null)
                        ? liveRev === preRevision
                        : canAdvanceBaseline(seen.updatedAt?.toMillis?.() ?? null, preBaseline);
                    committed = nextRevision(snap.data());
                    // On a STALE baseline the name and the revision are written and the "last saved
                    // by" is not: the content under this rename is a colleague's save we never took
                    // in, and signing it as ours made our next conflict dialog name US as the one
                    // whose version would be replaced — so we replaced theirs believing it our own.
                    // The revision still moves, which is all the guard needs.
                    tx.set(ref, baselineFresh
                        ? { name, revision: committed, updatedAt: serverTimestamp(), updatedBy: by }
                        : { name, revision: committed }, { merge: true });
                }));
            } catch (err) {
                if (!isOffline(err)) throw err;
                // A queued rename is fine — it is small and non-destructive — but nothing verified
                // the server, so the baseline may not move (RULE 3). It moves the REVISION, though:
                // left alone, a colleague holding the current one saved over the new name unasked.
                // And like any unverified rename it does not sign the content as ours (above).
                baselineFresh = canAdvanceBaseline(null, preBaseline, false);
                /** @type {any} */ let cached = null;
                try { cached = (await cacheRead(ref)).data() ?? null; }
                catch { /* nothing cached — the next offline save consults nothing either */ }
                // A SECOND offline rename sees through the first — its revision is ours, not a save.
                const under = throughOwnRename(id, cached)?.revision;
                const rev = queuedRevision(preRevision);
                await queueWrite(() => setDoc(ref, { name, revision: rev }, { merge: true }));
                // Recorded once it is ISSUED: a rename the gate refused is nobody's to see through.
                ownRenames.set(id, { rev, before: typeof under === 'number' ? under : null,   // see `ownRenames`
                    stamp: cached?.updatedAt?.toMillis?.() ?? null, by: cached?.updatedBy ?? null });
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
            const write = () => setDoc(refFor(id), { deletedAt: serverTimestamp(), deletedBy: by }, { merge: true });
            // RULE 4, for the delete too (whole-app review, Oct 2026). Awaited offline, it held until
            // the signal came back: nothing changed on screen, the designer kept editing, and the late
            // landing then switched the page away and dropped those edits unasked. Queued, it shows now.
            if (offlineNow()) { await queueWrite(write); return { queued: true }; }
            // …and on a connection that is UP but cannot reach Firestore the browser says online, so
            // the same wait had no end at all (whole-app fix, Nov 2026). Bounded by the app's one
            // figure for a write the server has not answered (slow-save.js): past it the delete is in
            // the SDK's queue, and saying so is the answer the press is owed.
            return { queued: await sendWrite(write, ackWaitMs) === 'queued' };
        },

        /**
         * The AUTOMATIC move to the bin (v24.47 — designs drawn for the old link length). Unlike
         * `softDelete`, nobody pressed anything: the decision was made from a list read earlier,
         * possibly from the offline cache, and a colleague may have restored or redrawn the design
         * since. So the rule is asked again INSIDE the transaction (this module's rule 1), and a
         * design that no longer matches it is left alone. A transaction also never QUEUES offline —
         * it fails, and the next open asks again — where a plain merge would sit in the write queue
         * and land days later over whatever the design had become.
         * @param {string} id @param {string} by @param {(data: any) => boolean} stillMatches
         * @returns {Promise<'moved'|'skipped'>}
         */
        async binIfStill(id, by, stillMatches) {
            let moved = false;
            await withClaimRetry(() => runTransaction(db, async (/** @type {any} */ tx) => {
                moved = false;
                const snap = await tx.get(refFor(id));
                if (!snap.exists() || isDeleted(snap.data()) || !stillMatches(snap.data())) return;
                tx.set(refFor(id), { deletedAt: serverTimestamp(), deletedBy: by }, { merge: true });
                moved = true;
            }));
            return moved ? 'moved' : 'skipped';
        },

        /**
         * Restore from the bin, clearing the two fields with `deleteField()` on a merge — a full
         * replace would push our load-time copy over whatever the design carried when it was
         * deleted. Re-arms the baseline, which matters MORE here than for a new design: this is an
         * old document a co-editor may still hold open.
         * Returns `{ status }`: `ok` with the new revision AND `data` — the name, patterns and window
         * the transaction read, which the caller must build the restored design from (never from
         * its bin row) — or `gone` when somebody removed the design for good in the meantime, so
         * the workspace can say what happened instead of blaming the network for a state no retry
         * will change.
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
            /** @type {{name: any, patterns: any, window: any}|null} */
            let content = null;
            try {
                await withClaimRetry(() => runTransaction(db, async (/** @type {any} */ tx) => {
                    const snap = await tx.get(ref);
                    // WHAT IS ACTUALLY THERE, asked inside the transaction — the same rule `purge`
                    // already follows, and for the same reason: the row that was pressed came from
                    // a bin loaded some time ago, and a colleague may have acted on it since.
                    //
                    // Without this the merge write RECREATES a hard-deleted design as a skeleton —
                    // no name, no patterns. The Firestore rules refuse that shape, so production
                    // never actually resurrects one; what the designer gets instead is "check your
                    // connection and try again", about a design that is not coming back however
                    // many times they retry. The rules make it a wording problem rather than a
                    // data-integrity one, which is why this is a small fix and not an urgent one.
                    if (!snap.exists()) throw new Error('design-gone');
                    // AN ALREADY-LIVE DESIGN IS A TRUE NO-OP — no write at all (v22.32, external
                    // review). Refusing it was written and removed, correctly: refusing invents a
                    // failure out of a benign state. But the version that replaced it went on to
                    // WRITE, and that is not a no-op either — it clears already-clear fields and
                    // BUMPS THE REVISION, so an editor holding the immediately preceding revision
                    // meets a conflict about a design whose content nobody changed.
                    //
                    // Which is the hazard the comment directly above this one names: a false
                    // conflict is what teaches people to click through the one prompt that protects
                    // them. Restoring something already restored asks for a state that is already
                    // true, so the honest answer is to leave the document alone and say so.
                    if (!snap.data()?.deletedAt) { committed = -1; return; }
                    committed = nextRevision(snap.data());
                    // THE CONTENT COMES BACK WITH THE REVISION (whole-app review, Oct 2026). The
                    // caller used to rebuild the design from its BIN ROW, read when the bin opened,
                    // and stamp it with this revision. If a colleague saved, restored or re-binned
                    // the design since, the server held their version while the restorer held their
                    // own stale copy at the server's revision, so their next save matched, raised no
                    // conflict, and wrote over the colleague's work. What this transaction read is
                    // what the merge brought back, so it is the only copy entitled to that revision.
                    const { name, patterns, window } = snap.data() ?? {};
                    content = { name, patterns, window };
                    tx.set(ref, {
                        deletedAt: deleteField(), deletedBy: deleteField(), revision: committed,
                        updatedAt: serverTimestamp(), updatedBy: by,
                    }, { merge: true });
                }));
            } catch (err) {
                if (err instanceof Error && err.message === 'design-gone') return { status: 'gone' };
                throw err;
            }
            // `-1` is the sentinel the transaction sets when it wrote nothing. A separate status,
            // not `ok`: the caller must not advance a local baseline to a revision no write
            // produced, which is this module's third rule.
            if (committed === -1) return { status: 'already-restored' };
            return { status: 'ok', updatedAt: await readStamp(ref), revision: committed, data: content };
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
