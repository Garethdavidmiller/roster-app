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
 * unsent saves first, and recognises its own write after an answer was lost. The store is loaded with
 * the first Save or Undo, never with the page (`adminStore`): a check only reads, and Operations loads
 * none of Admin's store until something is to be written (e2e/operations.spec.js).
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
 * (firestore.rules → alUploads). So the id is minted once per Save (`newUploadLogId`), and a run that
 * finds the log already there writes nothing. Logs older than last year are then deleted
 * (`pruneUploadLogs`): a log is only needed while its year's sheet can still be uploaded.
 *
 * ── UNDO TAKES BACK ONLY WHAT IS STILL THE SAVE'S OWN ───────────────────────────────────────────
 *
 * `planUndo` keeps any day changed since the Save. A colleague's change landing between that read and
 * the delete is refused by the check, and the refused days are kept while the rest of the person's
 * days still go — because the log can be marked undone only ONCE, so a refusal that kept a whole
 * person would leave their days with no Undo at all. Nothing is recorded when nothing was removed.
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
 * Every upload log for a year, ids included — refused when answered from the cache, like a record
 * read: a log this device has not seen would let an older copy through.
 * @param {number} year @returns {Promise<Array<import('./al-leave-plan.js').UploadLog & { id: string }>>}
 */
export async function readUploadLogs(year) {
    const snap = await getDocs(query(collection(db, COLLECTIONS.alUploads), where('year', '==', year)));
    refuseCached(snap);
    /** @type {any[]} */ const logs = [];
    snap.forEach(/** @param {any} d */ d => logs.push({ ...d.data(), id: d.id }));
    return logs;
}

/**
 * @typedef {{ saved: Map<string, string[]>, refused: Map<string, string[]>,
 *             stopped: null|'offline'|'unconfirmed'|'failed', code: string|null, partial: boolean }} SaveOutcome
 *   `saved`: each person's dates whose part committed; `refused`: each person's dates a colleague
 *   changed after the check (nothing of that part was written, nor of their later parts); `stopped`:
 *   why the Save ended early, with the error's `code`; `partial`: a part may have landed without
 *   saying so, so only the read after the Save can say what is there
 */

/** Admin's checked commit, loaded with the first Save or Undo, not with the page (header). */
const adminStore = () => import('./admin-override-store.js');

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
 * Send the planned writes, person by person, part by part, each part checked (header).
 * @param {import('./al-leave-plan.js').PersonPlan[]} plans
 * @param {{ onProgress?: (done: number, total: number) => void }} [opts]
 * @returns {Promise<SaveOutcome>}
 */
export async function saveLeavePlans(plans, { onProgress } = {}) {
    /** @type {SaveOutcome} */
    const out = { saved: new Map(), refused: new Map(), stopped: null, code: null, partial: false };
    if (globalThis.navigator?.onLine === false) return { ...out, stopped: 'offline', code: 'unavailable' };
    const { commitChecked, DELETE_REFUSED } = await adminStore();
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
                    w.set(doc(db, COLLECTIONS.overrides, pw.fixedId), buildOverrideWrite(pw.fields, serverTimestamp()));
                }
            };
            try {
                await withSlowSaveNotice(writeWithClaimRetry(() => commitChecked(fill, {
                    shownFor: (/** @type {string} */ _name, /** @type {string} */ date) => shownByDate.get(date) ?? null,
                    removed, line: REFUSED_LINE, holdOffline: false })), { batched: true, held: false });
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

/** A new upload log's id, minted once per Save so every attempt lands on the same document (header). @returns {string} */
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
            const batch = writeBatch(db);
            for (const id of ids.slice(i, i + 450)) batch.delete(doc(db, COLLECTIONS.alUploads, id));
            await writeWithClaimRetry(() => batch.commit());
        }
        return ids.length;
    } catch (err) {
        console.error('[AL sheet] old upload logs were not deleted:', /** @type {any} */ (err)?.code ?? 'unknown');
        return 0;
    }
}

/**
 * Undo one Save (plan §4.10, header): delete each day it ADDED that is still its own — person by
 * person, each part checked, a refused day kept and the rest sent again — then record on the log what
 * was taken back, once, when anything was. A failure other than a refusal stops it, recording nothing,
 * so it can be pressed again.
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
    if (!removed.length) return { removed, kept: kept.sort(), gone: plan.gone, logged: 'nothing' };
    const ref = doc(db, COLLECTIONS.alUploads, log.id);
    const undone = [...removed].sort();
    const logged = await writeWithClaimRetry(() => runTransaction(db, async (/** @type {any} */ tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return 'missing';
        if ('undoneAt' in (snap.data() ?? {})) return 'already';
        tx.update(ref, { undoneAt: serverTimestamp(), undoneBy, undone });
        return 'written';
    }));
    return { removed: undone, kept: kept.sort(), gone: plan.gone, logged: /** @type {any} */ (logged) };
}
