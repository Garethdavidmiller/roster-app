// @ts-check
/**
 * links-design-store.js — the PERSISTENCE LIFECYCLE of a link design, and the concurrency
 * protocol that goes with it.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * The rules for writing a design to a collection several people edit at once used to be spread
 * across eight functions, each with its own variant of the protocol, and an external audit (Aug
 * 2026) found two silent overwrites of the same shape — fixing them where they lay would not stop a
 * third:
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
 * **1. A read that a write depends on happens INSIDE the write's transaction.** Not before it: a
 * transaction re-runs its callback when anything lands underneath, so a decision made inside one is
 * true at COMMIT.
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
 * too. Online, the save, the rename and the delete are transactions, so a server the device cannot
 * reach FAILS them and they are queued; the create, a plain write, is given `SLOW_SAVE_MS` to be
 * answered and is called queued after that.
 *
 * **5. A transaction waits for this device's own queued writes first.** A transaction reads the
 * SERVER, and rule 4's queued writes are not there yet: an online save read the older copy, and the
 * queued save then landed on top — older work over newer, silently (a rename undone, a binned design
 * back). So every transaction starts only once this device has nothing of its own on the way to the
 * design it touches (`runTx`, through the injected `ownWritesSent` — firebase-client.js →
 * `whenOwnWritesSentFor`, whose reasoning is claim-retry.js → `ownWritesSentFor`): the whole queue
 * drained, or that design's own record clear of this account's unsent writes (so another account's
 * leftover write cannot hold every transaction). A design of ours still on its way ends as
 * `unavailable`: a save, a rename and a delete then queue BEHIND what is waiting, so the writes land
 * in the order they were made; a restore, a purge and the automatic bin fail, as they do offline.
 *
 * **6. A queued save says how it ENDED.** `queued` is not `saved`: in a SECOND tab Firestore's cache
 * lives only in memory, so a write queued there dies with the page. So a queued create or save
 * carries `settled`, a promise that resolves `'acked'` when the server has the write, `'held'` when the
 * designer signed out with it still queued (the SDK keeps it for that account), and `'failed'` when the
 * server refused it. It never rejects. links-app.js keeps the designer's copy of the work until it
 * hears `'acked'` (unsaved-draft.js rule 6). A rename and a delete do not carry it: a lost rename or
 * bin is small and visible, where a lost save is an afternoon's grid.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────────────────────────
 *
 * No DOM, no dialogs, no confirm, no picker, no generator, no status text, and no decision about
 * what the user should SEE. A conflict comes back as `{ status: 'conflict', conflict }` and the
 * workspace decides whether to ask, overwrite or fork — which lets this file be tested against a
 * fake Firestore, the only way the interleavings above can be exercised.
 *
 * Deliberately NOT a generic repository: design revisions, soft deletion and conflict results are
 * Links concepts.
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
 * @property {Function} getDocs @property {Function} runTransaction
 * @property {Function} serverTimestamp @property {Function} deleteField
 * @property {any} designsCol                     the collection reference
 * @property {Function} withClaimRetry            wraps every write (stale-claim self-heal)
 * @property {() => boolean} [isOnline]           overridable for tests
 * @property {Function} [getDocFromCache]         the CACHE's own answer for one document, for the
 *                                                offline consult — see `cacheRead`
 * @property {(refs: any[]) => Promise<boolean>} ownWritesSent  given the design a transaction touches:
 *                                                true once this device's queued writes have reached the
 *                                                server, or when they have not but none of them is to
 *                                                that design; false otherwise (RULE 5).
 *                                                REQUIRED: a store without it would read the server
 *                                                before this device's own unsent saves
 */

/** How a queued write ENDED (rule 6): the server has it, it is held for a designer who signed out, or
 *  the server refused it. @typedef {'acked'|'held'|'failed'} Settled */

/** Firestore reports an unreachable backend as `unavailable`; the browser has its own view. */
const _offlineByDefault = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * Answers from this page's OWN write machinery (claim-retry.js): the gate refusing a write while an
 * earlier one is unconfirmed, and an account that signed out mid-write. Neither is the absence of a
 * server, whatever the browser says — read as offline, the page said "Saved in this browser" about a
 * write never issued.
 */
const NEVER_OFFLINE = new Set([UNCONFIRMED_CODE, SIGNED_OUT_CODE]);

/** The code a RENAME throws when its design is no longer live — the word `save` returns as a status. */
const DELETED_ELSEWHERE = 'deleted-elsewhere';

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
        db, doc, getDoc, setDoc, getDocs, runTransaction,
        serverTimestamp, deleteField, designsCol, withClaimRetry,
    } = deps;
    const _isOnline = deps.isOnline;
    const offlineNow = _isOnline ? () => !_isOnline() : _offlineByDefault;
    const { ownWritesSent } = deps;
    if (typeof ownWritesSent !== 'function') {
        throw new TypeError('createDesignStore: ownWritesSent is required (RULE 5) — a transaction would read the server before this device\'s own unsent saves');
    }
    /**
     * Every transaction this store runs (RULE 5): this device's own queued writes first, then the
     * server. It names the ONE design the transaction touches, so the wait can ask that record when
     * the whole queue does not drain. A record of ours still on its way — or an undrained queue and
     * an unreadable record — is answered as no server, so each caller takes its offline path.
     */
    const runTx = async (/** @type {any[]} */ refs, /** @type {(tx: any) => Promise<any>} */ fn) => {
        if (!(await ownWritesSent(refs))) {
            throw Object.assign(new Error('this device still has saves it has not sent'), { code: 'unavailable', unsent: true });
        }
        return runTransaction(db, fn);
    };
    /**
     * WHAT THIS DEVICE HOLDS for one document — the offline consult before a queued write.
     * `getDocFromCache` answers from the cache alone: a deletion the cache recorded comes back as not
     * existing, and a document it never held REJECTS. Offline, plain `getDoc` rejects for BOTH, so a
     * store given only `getDoc` cannot see a deletion its cache knows of.
     */
    const cacheRead = deps.getDocFromCache ?? getDoc;
    const isOffline = (/** @type {any} */ err) => isOfflineFailure(err, offlineNow);
    // One document of the INJECTED collection — its path read from the reference, never a second
    // copy of the collection's name beside it.
    const refFor = (/** @type {string} */ id) => doc(db, designsCol.path, id);

    /**
     * RULE 4 — send a write, and wait for the server's acknowledgement for at most `waitMs`.
     *
     * Firestore resolves a write only when the server acknowledges it — offline, "not until the
     * connection returns" — so awaiting one held the page on "Saving…" instead of reporting the queue.
     * Resolves `'acked'` when the answer comes in time and `'queued'` when it does not: the write is
     * issued and the SDK owns the queue, so a later rejection (a rules refusal on sync) is logged, the
     * one place left to see it.
     *
     * It REJECTS with any answer that comes in time, including a refusal before anything was issued
     * (the page's unconfirmed-write gate refuses inside `withClaimRetry`, so there is nothing queued).
     * The bound starts when the write is ISSUED, so it can never outrun a refusal.
     *
     * `onSettle` hears how the write ENDED, whenever that is (rule 6) — an hour later, on a page that
     * has long moved on: `'acked'`, `'held'` (signed out with it queued) or `'failed'`.
     * @param {() => Promise<any>} write
     * @param {number} waitMs  0 to issue and move on, for a device known to be offline
     * @param {(how: Settled) => void} [onSettle]
     * @returns {Promise<'acked'|'queued'>}
     */
    const sendWrite = (write, waitMs, onSettle) => new Promise((resolve, reject) => {
        /** @param {Settled} how */
        const tell = (how) => { try { onSettle?.(how); } catch (err) { console.error('[Links] A queued write\'s ending could not be reported:', err); } };
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
        }).then(() => { tell('acked'); answer(() => resolve('acked')); }, (/** @type {any} */ err) => {
            // Signed out while queued is NOT a failure: the SDK keeps it for that account.
            const held = err?.code === SIGNED_OUT_CODE;
            tell(held ? 'held' : 'failed');
            if (answer(() => reject(err))) return;
            if (held) { console.warn('[Links] Queued write held until that designer signs in again'); return; }
            console.error('[Links] Queued write failed on sync:', err);
        });
    });
    /**
     * A write for a device that is offline: issued, then answered `queued`.
     * @param {() => Promise<any>} write @param {(how: Settled) => void} [onSettle]
     */
    const queueWrite = (write, onSettle) => sendWrite(write, 0, onSettle);
    /** How one queued write will end (rule 6): `settle` is handed to `sendWrite`, `settled` to the caller. */
    const settlement = () => {
        /** @type {(how: Settled) => void} */ let settle = () => {};
        /** @type {Promise<Settled>} */ const settled = new Promise((r) => { settle = r; });
        return { settle, settled };
    };

    /**
     * The revision a QUEUED write stamps. Not `known + 1`: that is precisely what a colleague's
     * online save from the same revision commits, so the two collided and their next save matched ours
     * and overwrote it unasked. Not absent either: a document with no revision restarts at 1 on its
     * next save, and a tab left open on an old revision 1 would then match. The clock in ms is far
     * above any counter a transaction produces, and still an int >= 1 as `firestore.rules` requires;
     * `max` keeps it monotonic if an earlier queued write already moved the counter there.
     * @param {number|null} known
     */
    const queuedRevision = (known) => Math.max((known ?? 0) + 1, Date.now());

    /**
     * A rename's answer for a design that is no longer live — binned, or removed for good (`deletedData`
     * null). THROWN rather than returned: a caller that does not know this answer takes its error path,
     * where a returned one would let it rename the row on screen with nothing written.
     * @param {any} deletedData
     */
    const deletedElsewhere = (deletedData) => Object.assign(
        new Error('The design was deleted elsewhere while it was open here'), { code: DELETED_ELSEWHERE, deletedData });

    /** Read a document's server `updatedAt`, or null if it cannot be read. */
    const readStamp = async (/** @type {any} */ ref) => {
        try { return (await getDoc(ref)).data()?.updatedAt ?? null; }
        catch { return null; }
    };

    /**
     * OUR OWN QUEUED RENAMES, per design: the revision each stamped, and the revision the cache held
     * under it. Offline, the cache shows our queued rename on top — its revision, but the last saver's
     * name — so a save after our own rename read as a colleague's version. The cache is judged on the
     * revision UNDER our rename instead; a colleague's save that reached this device first is still
     * caught, because then that revision is not the one we hold.
     *
     * …AND ON WHO SAVED THE CONTENT UNDER IT, AND WHEN. Our queued rename merges only name and
     * revision, so a colleague's save while we were offline syncs as OUR revision over THEIR content,
     * stamp and name. A rename writes neither stamp nor name, so while both still match the ones we
     * cached, the content is the one we held.
     *
     * …AND ONLINE, ONCE THE RENAME HAS SYNCED: the server then holds what the cache did, so every save,
     * forced save and rename reads through it, and a colleague's save — under our rename or after it —
     * is still caught by the same checks.
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
        /** Every document in the collection, and whether the answer came from this device's CACHE — which
         *  cannot tell "no designs" from "never read here" (links-design-load.js `readCannotAnswer`).
         *  @returns {Promise<{ docs: Array<{ id: string, data: any }>, fromCache: boolean }>} */
        async loadAll() {
            const snap = await getDocs(designsCol);
            return { docs: snap.docs.map((/** @type {any} */ d) => ({ id: d.id, data: d.data() })), fromCache: !!snap.metadata?.fromCache };
        },

        /**
         * Create a design and ARM its baseline from the server.
         *
         * The read-back is what makes the first content-save guarded. Without it a just-created
         * design carried `updatedAt: null`, the guard treated that as "nothing to compare", and a
         * concurrent edit was clobbered silently.
         * @param {any} payload
         * @returns {Promise<{ id: string, updatedAt: any, queued?: boolean, settled?: Promise<Settled>, baseline: { loadedRevision: number|null, loadedUpdatedAt: number|null, baselineUnknown: boolean } }>}
         */
        async create(payload) {
            // Revision 1, stamped here rather than read back: a create has nothing to race, so the
            // number is certain without a transaction and the baseline exact from the first save.
            const body = { ...payload, revision: 1 };
            // An auto-id reference names the document BEFORE the write, so a create the server has not
            // answered still has an id to come back with — still revision 1, and still exact, because
            // nobody else can write a document whose id only this device holds.
            const ref = doc(designsCol);
            const end = settlement();   // rule 6: a queued create says how it ended
            const queued = () => ({ id: ref.id, updatedAt: null, queued: true, settled: end.settled, baseline: baselineAfterCommit(1) });
            // OFFLINE, RULE 4: a create resolves only on the server's ack, so offline it is queued and
            // returned at once.
            if (offlineNow()) { await queueWrite(() => setDoc(ref, body), end.settle); return queued(); }
            // ONLINE, BOUNDED (links-design-2): on a connection up but unable to reach Firestore, an
            // unbounded create held "Creating…". It waits as long as a slow save does, and unanswered
            // comes back queued, with its id.
            if (await sendWrite(() => setDoc(ref, body), SLOW_SAVE_MS, end.settle) === 'queued') return queued();
            return { id: ref.id, updatedAt: await readStamp(ref), baseline: baselineAfterCommit(1) };
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
         * @param {number|null} [o.loadedRevision]  the revision we hold — the exact identity
         * @param {number|null} [o.forceAgainstRevision]  the `updatedAt` millis the conflict dialog
         *                                     showed them, or null if it carried no timestamp
         * @param {number|null} [o.forceAgainstRev]  the REVISION that dialog showed them. Preferred
         *                                     over the timestamp; the timestamp remains for a design
         *                                     nobody has saved since v22.18
         * @returns {Promise<{status: 'saved'|'conflict'|'deleted-elsewhere'|'queued', conflict?: any, deletedData?: any, baseline?: any, updatedAt?: any, settled?: Promise<Settled>}>}
         */
        async save({ id, buildPayload, baseline, baselineUnknown, currentUser, loadedRevision = null,
            forcing = false, forceAgainstRevision = null, forceAgainstRev = null }) {
            const ref = refFor(id);
            /** The revision this attempt actually COMMITTED — set inside the transaction, so the
             *  baseline needs no read-back and has no window in it. */
            let committed = 0;
            if (forcing) {
                // ── WHAT THE USER ACTUALLY CONSENTED TO ─────────────────────────────────────
                // "Replace THE VERSION I WAS SHOWN", not "replace whatever exists whenever I get
                // round to pressing the button" — an unconditional write ignores the think-time:
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
                // A DELETE is a different consent again, and was never given: `docPayload`
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
                 *  timestamp for a design with no revision. @param {any} d */
                const movedOnOf = (d) => {
                    const liveRev = typeof d.revision === 'number' ? d.revision : null;
                    const liveRevision = d.updatedAt?.toMillis?.() ?? null;
                    const moved = (liveRev !== null || forceAgainstRev !== null)
                        ? liveRev !== forceAgainstRev
                        : liveRevision !== forceAgainstRevision;
                    return moved ? { by: d.updatedBy || 'Someone', at: d.updatedAt || null, rev: liveRev } : null;
                };
                try {
                    await withClaimRetry(() => runTx([ref], async (/** @type {any} */ tx) => {
                        // A retried transaction must not keep the losing attempt's verdict. Pinned by
                        // "a RETRIED forced save decides afresh" in links-design-store.test.mjs.
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
                    // OFFLINE, CONSENT IS CHECKED AGAINST THE CACHE, as an ordinary offline save
                    // consults it (a transaction cannot run without a server). Rule 2 still holds:
                    // only an offline failure gets here, and the write is queued, never awaited.
                    if (!isOffline(err)) throw err;
                    try {
                        const cached = await cacheRead(ref);
                        if (!cached.exists()) return { status: 'deleted-elsewhere', deletedData: null };   // as below
                        const d = throughOwnRename(id, cached.data() || {});
                        if (isDeleted(d)) return { status: 'deleted-elsewhere', deletedData: d };
                        const again = movedOnOf(d);
                        if (again) return { status: 'conflict', conflict: again };
                    } catch { /* nothing cached to consult — proceed, as the ordinary offline save does */ }
                    const end = settlement();   // rule 6
                    await queueWrite(() => setDoc(ref, { ...buildPayload(), revision: queuedRevision(loadedRevision) }), end.settle);
                    return { status: 'queued', baseline: baselineAfterWrite(null, false), settled: end.settled };
                }
                if (gone)         return { status: 'deleted-elsewhere', deletedData: null };
                if (deletedData)  return { status: 'deleted-elsewhere', deletedData };
                if (movedOn)      return { status: 'conflict', conflict: movedOn };
                const updatedAt = await readStamp(ref);
                return { status: 'saved', updatedAt, baseline: baselineAfterCommit(committed) };
            }
            // THE TRANSACTION IS TRIED FIRST EVEN WHEN THE BROWSER ALREADY SAYS OFFLINE, deliberately.
            // It costs six to ten seconds of "Saving…" on a device that really is offline (the SDK's
            // back-off), but `navigator.onLine` is the browser's view, not Firestore's, and a wrong
            // "offline" may not buy the path rule 2 keeps for the absence of a server. (Create and
            // delete, with no read to serialise, ask `offlineNow()` first.) `rename` tries first too.
            try {
                await withClaimRetry(() => runTx([ref], async (/** @type {any} */ tx) => {
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
                // Offline still CONSULTS what we hold before writing (usually IndexedDB): it proves
                // nothing about the server, but can carry a deletion or a co-editor's save that
                // reached this device first. A blind write over a design our cache says was deleted
                // would resurrect it on sync — what `deleted-elsewhere` exists to prevent.
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
                // A queued write may NOT increment from what we last knew (`queuedRevision`). Issued,
                // not awaited — rule 4; how it ENDS comes later, as `settled` (rule 6).
                const end = settlement();
                await queueWrite(() => setDoc(ref, { ...buildPayload(), revision: queuedRevision(loadedRevision) }), end.settle);
                // Nothing verified what the server held, so the baseline is UNKNOWN, never null.
                return { status: 'queued', baseline: baselineAfterWrite(null, false), settled: end.settled };
            }
            const updatedAt = await readStamp(ref);
            return { status: 'saved', updatedAt, baseline: baselineAfterCommit(committed) };
        },

        /**
         * Rename, deciding INSIDE the transaction whether our baseline may advance (RULE 1).
         * @param {object} o
         * @param {string} o.id @param {string} o.name @param {string} o.by
         * @param {number|null} o.preBaseline
         * @param {number|null} [o.preRevision] the revision we hold for that doc — exact, where
         *   `preBaseline` is the fallback for a design with no revision
         * @returns {Promise<{ baselineFresh: boolean, revision: number|null, updatedAt: any, queued: boolean }>}
         * @throws an error whose `code` is `'deleted-elsewhere'` when the design is no longer live, with
         *   `deletedData` (null when it was removed for good) — never a rename of the binned copy
         */
        async rename({ id, name, by, preBaseline, preRevision = null }) {
            const ref = refFor(id);
            let baselineFresh = false;
            let committed = 0;
            /** What the transaction found where a live design should be. @type {any} */
            let gone = null;
            try {
                await withClaimRetry(() => runTx([ref], async (/** @type {any} */ tx) => {
                    gone = null;
                    const snap = await tx.get(ref);
                    // IS IT STILL A LIVE DESIGN? Asked like every other transaction here: binned
                    // elsewhere, the merge renamed the binned copy; removed for good, it wrote a
                    // skeleton the rules refuse, with "check your connection" about a lost design.
                    if (!snap.exists() || isDeleted(snap.data())) { gone = { deletedData: snap.exists() ? snap.data() : null }; return; }
                    // Reassigned on every attempt: a retried transaction must not keep the verdict
                    // of the attempt that lost. Asked of the document with our own queued rename seen
                    // through (`ownRenames`), and the counter moved from the one really there.
                    const seen = throughOwnRename(id, snap.data() || {});
                    const liveRev = typeof seen.revision === 'number' ? seen.revision : null;
                    // The REVISION answers "is this still the document we loaded?" exactly (the
                    // timestamp is the fallback): advance our baseline only when nothing moved
                    // underneath us.
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
                /** @type {any} */ let snap = null;
                try { snap = await cacheRead(ref); }
                catch { /* nothing cached — the next offline save consults nothing either */ }
                // A deletion this device KNOWS of refuses here too: queued, the merge would rename the
                // binned copy on sync, or write the skeleton the rules refuse (see `cacheRead`).
                if (snap && (!snap.exists() || isDeleted(snap.data()))) {
                    throw deletedElsewhere(snap.exists() ? snap.data() : null);
                }
                /** @type {any} */ const cached = snap?.data() ?? null;
                // A SECOND offline rename sees through the first — its revision is ours, not a save.
                const under = throughOwnRename(id, cached)?.revision;
                const rev = queuedRevision(preRevision);
                await queueWrite(() => setDoc(ref, { name, revision: rev }, { merge: true }));
                // Recorded once it is ISSUED: a rename the gate refused is nobody's to see through.
                ownRenames.set(id, { rev, before: typeof under === 'number' ? under : null,   // see `ownRenames`
                    stamp: cached?.updatedAt?.toMillis?.() ?? null, by: cached?.updatedBy ?? null });
                return { baselineFresh, revision: null, updatedAt: null, queued: true };
            }
            if (gone) throw deletedElsewhere(gone.deletedData);
            // A rename that may advance the baseline advances it to the revision it COMMITTED —
            // exactly, and with no read-back to race. `updatedAt` is still returned for the picker's
            // "last saved" line, which is display only.
            return { baselineFresh, revision: baselineFresh ? committed : null,
                updatedAt: baselineFresh ? await readStamp(ref) : null, queued: false };
        },

        /**
         * Soft-delete. A MERGE, never a replace: the patterns we hold may be a stale copy of a
         * co-designer's newer version, and deleting is not a reason to overwrite them.
         *
         * IT ASKS WHAT IS THERE FIRST, inside the write (rule 1). A blind merge overwrote who deleted an
         * already-binned design and when, or wrote a skeleton the rules refuse over one removed for
         * good. Neither is a failure, so both come back as what was found (`already-deleted`, with
         * `deletedData`; `gone`), with nothing written.
         * @param {string} id @param {string} by
         * @returns {Promise<{ queued: boolean, status: 'deleted'|'already-deleted'|'gone', deletedData?: any }>}
         */
        async softDelete(id, by) {
            const ref = refFor(id);
            const binIt = () => ({ deletedAt: serverTimestamp(), deletedBy: by });
            /** Offline: consult what this device holds (`cacheRead`), then queue. @returns {Promise<any>} */
            const consultThenQueue = async () => {
                try {
                    const cached = await cacheRead(ref);
                    if (!cached.exists()) return { queued: false, status: 'gone' };
                    if (isDeleted(cached.data())) return { queued: false, status: 'already-deleted', deletedData: cached.data() };
                } catch { /* nothing cached to consult — queue, as an offline save does */ }
                await queueWrite(() => setDoc(ref, binIt(), { merge: true }));
                return { queued: true, status: 'deleted' };
            };
            // RULE 4, for the delete too: awaited offline, the late landing switched the page away and
            // dropped the edits made meanwhile. Queued, it shows now.
            if (offlineNow()) return consultThenQueue();
            /** @type {any} */ let found = null;
            try {
                await withClaimRetry(() => runTx([ref], async (/** @type {any} */ tx) => {
                    found = null;   // a retried transaction re-decides from scratch
                    const snap = await tx.get(ref);
                    if (!snap.exists()) { found = { status: 'gone' }; return; }
                    if (isDeleted(snap.data())) { found = { status: 'already-deleted', deletedData: snap.data() }; return; }
                    tx.set(ref, binIt(), { merge: true });
                }));
            } catch (err) {
                // A connection UP but unable to reach Firestore leaves the browser saying online; the
                // transaction FAILS there, after the SDK's retries, and the delete is queued like a save.
                if (!isOffline(err)) throw err;
                return consultThenQueue();
            }
            return { queued: false, ...(found ?? { status: 'deleted' }) };
        },

        /**
         * The AUTOMATIC move to the bin (designs drawn for the previous link length). Unlike
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
            await withClaimRetry(() => runTx([refFor(id)], async (/** @type {any} */ tx) => {
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
            // A restore BUMPS the revision, in a transaction, and hands the number back: otherwise the
            // restorer's next save prompts "someone else saved this" about their own restore — and a
            // false conflict is exactly what teaches people to click through the one prompt that
            // protects them.
            let committed = 0;
            /** @type {{name: any, patterns: any, window: any}|null} */
            let content = null;
            try {
                await withClaimRetry(() => runTx([ref], async (/** @type {any} */ tx) => {
                    const snap = await tx.get(ref);
                    // WHAT IS ACTUALLY THERE, asked inside the transaction, as `purge` does: the row
                    // pressed came from a bin loaded earlier. Gone for good, the merge would write a
                    // skeleton the rules refuse, reported as a connection problem.
                    if (!snap.exists()) throw new Error('design-gone');
                    // AN ALREADY-LIVE DESIGN IS A TRUE NO-OP — no write at all. Refusing invents a
                    // failure out of a benign state; writing BUMPS THE REVISION, so an editor holding
                    // the preceding one meets a false conflict about unchanged content.
                    if (!snap.data()?.deletedAt) { committed = -1; return; }
                    committed = nextRevision(snap.data());
                    // THE CONTENT COMES BACK WITH THE REVISION: rebuilt from its stale BIN ROW at the
                    // server's revision, the restorer's next save wrote over a colleague's work with no
                    // conflict. What this transaction read is the only copy entitled to that revision.

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
                await withClaimRetry(() => runTx([ref], async (/** @type {any} */ tx) => {
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
