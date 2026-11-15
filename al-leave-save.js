// @ts-check
/**
 * al-leave-save.js — the Annual leave sheet's Save, its upload log and its Undo, against Firestore.
 * Phase 2b of the annual leave uploader (docs/AL_UPLOADER_PLAN.md §4.9–4.10). WHAT is written is
 * decided by al-leave-plan.js; this module sends it, checked, and reads back what landed. The card
 * (operations-al-save.js) wires it.
 *
 * ── EVERY PART IS CHECKED, ADDITIONS INCLUDED ───────────────────────────────────────────────────
 *
 * The roster import adds in plain batches, because its records take random ids and lose to manual
 * ones (roster-import-save.js). The uploader writes MANUAL records at fixed ids, as the Admin leave
 * card does, so a plain add would silently replace whatever a manager saved there after the check
 * read the day. So every part commits through `commitChecked` (admin-override-store.js): one
 * transaction that refuses, writing nothing and naming the days, unless each day still holds what the
 * check read and each fixed id holds nothing the check did not see. It waits for this device's own
 * unsent saves first, and recognises its own write after an answer was lost — on a RE-RUN only
 * (`lostAnswerOnly`), and only by the Save's own id on the record: on a first attempt nothing of the
 * Save's can be there yet, and on any attempt a record exactly like it without that id is the admin's
 * own booking of the day, made by hand after the check, refused like any other change (reviews,
 * 15 Nov 2026). The store is loaded with a check that can be saved, never
 * with the page (`preloadSaveStore`): a page load only reads, and Operations loads none of Admin's
 * store until a Save is on offer (e2e/operations.spec.js). Loading it then, from the release the page
 * came from, means an update arriving later cannot hand the Save a newer store than its page; when it
 * cannot load at all, the Save says it never started (`STORE_UNLOADED`), because nothing was sent.
 *
 * OPERATIONS HAS NO ADMIN CACHE. `commitChecked` looks an id up in Admin's page cache, which this page
 * never fills, so here an id passed without its row means "must hold nothing at all". Every record a
 * part overwrites or replaces is therefore passed as the ROW the check read (the plan's `shown` and
 * `replaces`), and only the fixed id of a day that held nothing goes as an id alone.
 *
 * ── OFFLINE, NOTHING IS HELD ────────────────────────────────────────────────────────────────────
 *
 * `holdOffline: false`. A check needs the server, and a batch held on the device could not be
 * checked when it landed, hours later, over whatever the day held by then. A device that knows it is
 * offline writes nothing at all; a part that cannot reach the server writes nothing and stops the
 * Save; one whose ANSWER was lost may have landed (`partial`), which the read after the Save settles.
 *
 * ── ONE PERSON AT A TIME, IN PARTS UNDER FIRESTORE'S LIMIT ──────────────────────────────────────
 *
 * Each person's writes are cut into parts of at most 450 operations (`chunkByWrites`); a year of one
 * person's leave is one part. A part refused because a day changed stops THAT person, whose later
 * parts were planned from a check that is now wrong about them, and the others go on. Losing the
 * server, or the account, stops everybody.
 *
 * ── THE LOG IS WRITTEN LAST, ONCE ───────────────────────────────────────────────────────────────
 *
 * After the Save the card reads every compared person again (`readMemberRecords`), builds the log
 * from that read (`logLists`, `logFields`) and writes it here, in a transaction that reads first. A
 * create whose answer is lost is sent again, and the copy arrives as an UPDATE, which the rules refuse
 * (firestore.rules → alUploads). So the id is minted once per Save (`newUploadLogId`), before its first
 * write, which carries it — as every record of the Save does — and a run that finds the log already
 * there writes nothing. Logs older than last year are then deleted
 * (`pruneUploadLogs`): a log is only needed while its year's sheet can still be saved, which is this
 * year's and last year's (al-leave-plan.js → `saveRefusal`). The deleting is housekeeping, and the
 * Save does not wait for it: a batch with no answer waits for the connection, and held the card on
 * "Saving…" (review). Each attempt builds its own batch, because a batch commits once.
 *
 * The logs read for a check are this year's AND last year's (`readUploadLogs`): last year's sheet ran
 * into this January, so its log protects this file's first days too.
 *
 * ── UNDO TAKES BACK ONLY WHAT IS STILL THE SAVE'S OWN ───────────────────────────────────────────
 *
 * `planUndo` keeps any day changed since the Save: any rewrite of a day, by anybody, takes the Save's
 * id off its record (al-leave-plan.js → header). A colleague's change landing between that read and
 * the delete is refused by the check, and the refused days are kept while the rest of the person's
 * days still go — because the log can be marked undone only ONCE, so a refusal that kept a whole
 * person would leave their days with no Undo at all.
 *
 * AN UNDO CUT SHORT IS FINISHED BY PRESSING IT AGAIN (review, 15 Nov 2026). Its deletes can land and
 * its mark not, or the connection can go between two people. Marking only what that press removed left
 * a button that removed nothing and marked nothing, for good, and the first press's days "removed in
 * the app since" for ever. So the mark is made whenever an Undo runs to its end having anything to
 * mark, and it takes back every day of the Save's that is now gone, whoever removed it: the Undo
 * withdraws the Save, and its claim on a day goes with it. A day kept because somebody changed it stays
 * the changer's; an Undo that finds every day changed marks nothing, as before.
 *
 * ── NOTHING HERE QUOTES A NAME INTO A LOG ───────────────────────────────────────────────────────
 *
 * Names and dates go back to the card, which draws them; nothing is passed to `console` except an
 * error's code, because the Error Log would keep it.
 */

import { db, collection, query, where, getDocs, doc, runTransaction, writeBatch, serverTimestamp, writeWithClaimRetry,
    COLLECTIONS } from './firebase-client.js';
import { buildOverrideWrite, chunkByWrites } from './override-utils.js';
import { overrideFromSnapshot } from './override-compare.js';
import { writesFor, planUndo, dayKey } from './al-leave-plan.js';
import { withSlowSaveNotice } from './slow-save.js';
import { SIGNED_OUT_CODE, UNCONFIRMED_CODE } from './claim-retry.js';

/** How many members' records are read at once: enough to be quick, few enough to be gentle. */
const READ_CONCURRENCY = 6;
/** How a transaction ends when it never reached the server. */
const NO_SERVER = new Set(['unavailable', 'deadline-exceeded']);
/** The code a read answered from this device's cache throws with: no read at all (header). */
export const CACHED_READ = 'offline';
/** What a refused part says; the card names the person and the days itself. */
const REFUSED_LINE = 'A day changed after the check, so nothing was written for this person.';

/** @param {any} snap @returns {void} */
function refuseCached(snap) {
    if (snap?.metadata?.fromCache) throw Object.assign(new Error('read served from the offline cache'), { code: CACHED_READ });
}

/**
 * Every listed member's records, read whole (`where('memberName', '==', …)`), a few at a time. A read
 * answered from this device's cache is no read: it can be partial or empty, so it stops the lot. A
 * record this device saved but has not sent is read as its own copy (`overrideFromSnapshot`).
 * Throws `{ code }` on the first failure, and never with a name in it.
 * @param {string[]} names @returns {Promise<Map<string, any[]>>}
 */
export async function readMemberRecords(names) {
    /** @type {Map<string, any[]>} */ const out = new Map();
    let next = 0;
    async function worker() {
        while (next < names.length) {
            const name = names[next++];
            const snap = await getDocs(query(collection(db, COLLECTIONS.overrides), where('memberName', '==', name)));
            refuseCached(snap);
            /** @type {any[]} */ const rows = [];
            snap.forEach(/** @param {any} d */ d => rows.push(overrideFromSnapshot(d)));
            out.set(name, rows);
        }
    }
    await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, names.length) }, worker));
    return out;
}

/**
 * Every upload log for a year AND the year before (header: last year's sheet runs into this January),
 * ids included — refused when answered from the cache, like a record read: a log this device has not
 * seen would let an older copy through.
 * @param {number} year @returns {Promise<Array<import('./al-leave-plan.js').UploadLog & { id: string }>>}
 */
export async function readUploadLogs(year) {
    const snap = await getDocs(query(collection(db, COLLECTIONS.alUploads), where('year', 'in', [year - 1, year])));
    refuseCached(snap);
    /** @type {any[]} */ const logs = [];
    snap.forEach(/** @param {any} d */ d => logs.push({ ...d.data(), id: d.id }));
    return logs;
}

/**
 * @typedef {{ saved: Map<string, string[]>, refused: Map<string, string[]>,
 *             stopped: null|'offline'|'unconfirmed'|'failed'|'not-started', code: string|null, partial: boolean }} SaveOutcome
 *   `saved`: each person's dates whose part committed; `refused`: each person's dates a colleague
 *   changed after the check (nothing of that part was written, nor of their later parts); `stopped`:
 *   why the Save ended early, with the error's `code` — 'not-started' when the store could not load,
 *   or the Save had no id to mark its records with, and nothing was sent; `partial`: a part may have landed without saying so, so only the read after
 *   the Save can say what is there
 */

/** What an Undo or a Save throws, or stops with, when Admin's checked commit could not be loaded. */
export const STORE_UNLOADED = 'leave-sheet/store-unloaded';
/** What a Save stops with, before sending anything, when it was given no id to mark its records with. */
const NO_UPLOAD_ID = 'leave-sheet/no-upload-id';

/** Admin's checked commit, loaded with a check that can be saved, not with the page (header). */
const adminStore = () => import('./admin-override-store.js').catch((/** @type {any} */ err) => {
    throw Object.assign(new Error('the checked commit could not be loaded'), { code: STORE_UNLOADED, cause: err });
});

/** Load the checked commit now, ahead of a Save (header). Never throws. @returns {Promise<boolean>} */
export const preloadSaveStore = () => adminStore().then(() => true, () => false);

/**
 * How a part's failure ends the Save, or null for a refusal, which ends only its person's part.
 * @param {any} err @param {string} refused the store's refusal code (`DELETE_REFUSED`)
 * @returns {{ stopped: 'offline'|'unconfirmed'|'failed', partial: boolean }|null}
 */
function stopFor(err, refused) {
    const code = err?.code;
    if (code === refused) return null;
    // A transaction that never reached the server may still have committed — unless it never started,
    // because this device's own unsent saves had not drained in time (`unsent`, commitIfUnchanged).
    if (NO_SERVER.has(code)) return { stopped: 'offline', partial: !err?.unsent };
    // The account went mid-write: it may still send once they sign back in (claim-retry.js). An
    // earlier write's unknown outcome refused this one before it started.
    if (code === SIGNED_OUT_CODE) return { stopped: 'unconfirmed', partial: true };
    if (code === UNCONFIRMED_CODE) return { stopped: 'unconfirmed', partial: false };
    return { stopped: 'failed', partial: false };
}

/**
 * Send the planned writes, person by person, part by part, each part checked (header). Every record
 * written carries `uploadId`, the id of the log this Save will write (al-leave-plan.js → header): it
 * is how the Save's records are told from everybody else's, by its read-back and by its Undo.
 * @param {import('./al-leave-plan.js').PersonPlan[]} plans
 * @param {{ uploadId: string, onProgress?: (done: number, total: number) => void }} opts
 * @returns {Promise<SaveOutcome>}
 */
export async function saveLeavePlans(plans, { uploadId, onProgress } = /** @type {any} */ ({})) {
    /** @type {SaveOutcome} */
    const out = { saved: new Map(), refused: new Map(), stopped: null, code: null, partial: false };
    // Never a record without the mark: nothing could tell it from the admin's own booking afterwards, so
    // the read-back would call it not saved, and no Undo could take it back (al-leave-plan.js → header).
    if (typeof uploadId !== 'string' || !uploadId) return { ...out, stopped: 'not-started', code: NO_UPLOAD_ID };
    if (globalThis.navigator?.onLine === false) return { ...out, stopped: 'offline', code: 'unavailable' };
    /** @type {Awaited<ReturnType<typeof adminStore>>} */ let store;
    try { store = await adminStore(); } catch { return { ...out, stopped: 'not-started', code: STORE_UNLOADED }; }
    const { commitChecked, DELETE_REFUSED } = store;
    const writing = plans.filter(p => p.writes.length);
    const total = writing.reduce((n, p) => n + p.writes.length, 0);
    let done = 0;
    for (const plan of writing) {
        for (const part of chunkByWrites(plan.writes, writesFor)) {
            const shownByDate = new Map(part.map(w => [w.date, w.shown]));
            const removed = part.flatMap(w => w.replaces);
            /** The part's writes, onto the recorder and then the transaction — which may run again. @param {any} w */
            const fill = (w) => {
                for (const pw of part) {
                    for (const r of pw.replaces) w.delete(doc(db, COLLECTIONS.overrides, r.id));
                    w.set(doc(db, COLLECTIONS.overrides, pw.fixedId), buildOverrideWrite(pw.fields, serverTimestamp(), { uploadId }));
                }
            };
            try {
                await withSlowSaveNotice(writeWithClaimRetry(() => commitChecked(fill, {
                    shownFor: (/** @type {string} */ _name, /** @type {string} */ date) => shownByDate.get(date) ?? null,
                    removed, line: REFUSED_LINE, holdOffline: false, lostAnswerOnly: true })), { batched: true, held: false });
            } catch (err) {
                const e = /** @type {any} */ (err);
                const stop = stopFor(e, DELETE_REFUSED);
                if (!stop) {
                    out.refused.set(plan.name, Array.isArray(e?.dates) && e.dates.length ? e.dates : part.map(w => w.date));
                    break;   // this person stops; the others go on (header)
                }
                console.error('[AL sheet] a part of the Save failed:', e?.code ?? e?.name ?? 'unknown');
                return { ...out, stopped: stop.stopped, code: typeof e?.code === 'string' ? e.code : null, partial: stop.partial };
            }
            out.saved.set(plan.name, [...(out.saved.get(plan.name) ?? []), ...part.map(w => w.date)]);
            done += part.length;
            onProgress?.(done, total);
        }
    }
    return out;
}

/** A new upload log's id, minted once per Save, before anything is sent: every record the Save writes
 *  carries it, and every attempt to write the log lands on the same document (header). @returns {string} */
export function newUploadLogId() {
    return doc(collection(db, COLLECTIONS.alUploads)).id;
}

/**
 * Write the upload log, once: read first, and write only if it is not there.
 * @param {string} id @param {Omit<import('./al-leave-plan.js').UploadLog, 'savedAt'>} fields
 * @returns {Promise<'written'|'already'>}
 */
export async function writeUploadLog(id, fields) {
    const ref = doc(db, COLLECTIONS.alUploads, id);
    return writeWithClaimRetry(() => runTransaction(db, async (/** @type {any} */ tx) => {
        if ((await tx.get(ref)).exists()) return 'already';
        tx.set(ref, { ...fields, savedAt: serverTimestamp() });
        return 'written';
    }));
}

/**
 * Delete every upload log of a year before `keepFrom` (header). Housekeeping: a failure says so in the
 * console by its code and is tried again on the next Save, and a read from the cache deletes nothing.
 * @param {number} keepFrom @returns {Promise<number>} how many were deleted
 */
export async function pruneUploadLogs(keepFrom) {
    try {
        const snap = await getDocs(query(collection(db, COLLECTIONS.alUploads), where('year', '<', keepFrom)));
        if (snap?.metadata?.fromCache) return 0;
        /** @type {string[]} */ const ids = [];
        snap.forEach(/** @param {any} d */ d => ids.push(d.id));
        for (let i = 0; i < ids.length; i += 450) {
            const these = ids.slice(i, i + 450);
            // A batch commits once, even a commit that failed: each attempt builds its own (header).
            await writeWithClaimRetry(() => {
                const batch = writeBatch(db);
                for (const id of these) batch.delete(doc(db, COLLECTIONS.alUploads, id));
                return batch.commit();
            });
        }
        return ids.length;
    } catch (err) {
        console.error('[AL sheet] old upload logs were not deleted:', /** @type {any} */ (err)?.code ?? 'unknown');
        return 0;
    }
}

/**
 * Undo one Save (plan §4.10, header): delete each day it ADDED that is still its own — person by
 * person, each part checked, a refused day kept and the rest sent again — then mark the log, once:
 * taken back, every day of the Save's now gone, this press's and any earlier one's. A failure other
 * than a refusal stops it before the mark, so pressing it again finishes it.
 * @param {import('./al-leave-plan.js').UploadLog & { id: string }} log
 * @param {{ recordsByName: Map<string, any[]>, undoneBy: string }} a
 * @returns {Promise<{ removed: string[], kept: string[], gone: string[], logged: 'written'|'already'|'missing'|'nothing' }>}
 */
export async function undoUpload(log, { recordsByName, undoneBy }) {
    const plan = planUndo({ log, recordsByName });
    const { commitChecked, DELETE_REFUSED } = await adminStore();
    /** @type {string[]} */ const removed = [];
    /** @type {string[]} */ const kept = [...plan.kept];
    /** @type {Map<string, any[]>} */ const byPerson = new Map();
    for (const r of plan.remove) byPerson.set(r.memberName, [...(byPerson.get(r.memberName) ?? []), r]);
    for (const rows of byPerson.values()) {
        for (let part of chunkByWrites(rows, () => 1)) {
            while (part.length) {
                try {
                    const these = part;
                    await withSlowSaveNotice(writeWithClaimRetry(() => commitChecked(
                        (/** @type {any} */ w) => { for (const r of these) w.delete(doc(db, COLLECTIONS.overrides, r.id)); },
                        { shownFor: () => null, removed: these, line: REFUSED_LINE, holdOffline: false })), { batched: true, held: false });
                    removed.push(...these.map(r => dayKey(r.memberName, r.date)));
                    break;
                } catch (err) {
                    const e = /** @type {any} */ (err);
                    if (e?.code !== DELETE_REFUSED) throw err;
                    const changed = new Set(Array.isArray(e.dates) ? e.dates : []);
                    const rest = part.filter(r => !changed.has(r.date));
                    // Keep what changed; send the rest again. A refusal that names no day of this part keeps it all.
                    const keep = rest.length < part.length ? part.filter(r => changed.has(r.date)) : part;
                    kept.push(...keep.map(r => dayKey(r.memberName, r.date)));
                    part = rest.length < part.length ? rest : [];
                }
            }
        }
    }
    // Nothing taken back and nothing gone: every day was changed by somebody since, and the log claims
    // no undo that never happened. Anything else is marked (header): gone now, by this press or an
    // earlier one cut short, either way the Save no longer has it.
    if (!removed.length && !plan.gone.length) return { removed, kept: kept.sort(), gone: plan.gone, logged: 'nothing' };
    const ref = doc(db, COLLECTIONS.alUploads, log.id);
    const undone = [...new Set([...removed, ...plan.gone])].sort();
    const logged = await writeWithClaimRetry(() => runTransaction(db, async (/** @type {any} */ tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return 'missing';
        if ('undoneAt' in (snap.data() ?? {})) return 'already';
        tx.update(ref, { undoneAt: serverTimestamp(), undoneBy, undone });
        return 'written';
    }));
    return { removed: removed.sort(), kept: kept.sort(), gone: plan.gone, logged: /** @type {any} */ (logged) };
}
