// @ts-check
/**
 * roster-import-save.js — what one Save of the weekly roster review writes, and the check it makes
 * before it deletes anything (v25.92).
 *
 * ── WHY THE CHECK IS ABOUT WHAT THE IMPORT DELETES, AND NOTHING ELSE ──────────────────────────────
 *
 * Between the roster being read and the admin pressing Save, a manager can change one of the same
 * days in Admin. Until v25.92 the import wrote in plain batches, so the Save went through regardless
 * ("Two editors on one day", KNOWN_LIMITATIONS.md). But an import can only LOSE such an edit in one
 * way. A manual record always outranks an import record (`shouldReplaceOverride`, override-utils.js),
 * so a record the import ADDS can never hide a colleague's day — theirs still shows. What can is a
 * record the import DELETES: "Use new roster" over a manual change, a stale import cleared, a day's
 * older copies swept up (`replaceId`, `alsoDelete`). If a colleague rewrote that record after the
 * read, the delete destroys their newer version.
 *
 * So every part of the Save that deletes is ONE transaction: it re-reads each record it deletes and
 * refuses — writing nothing, `IMPORT_CHANGED_CODE`, naming the days — unless each is still the
 * record the review loaded (`sameOverrideRecord`), or already gone. Gone is no difference: deleting
 * what is not there harms nobody, and the day then holds what the admin chose. A record the review
 * never loaded is refused outright, never deleted on trust.
 *
 * A part that only ADDS records stays a plain batch, exactly as before — held on the device when the
 * signal drops and sent when it returns. It cannot hide anybody's day, and offline-first is the
 * older promise.
 *
 * ── ONE TRANSACTION PER PART, AND ITS NEW IDS ARE MINTED ONCE ────────────────────────────────────
 *
 * An import record takes a NEW random id (override-id.js says why imports keep them). Firestore runs
 * a transaction's function again when a record it read changes before the commit, and after a commit
 * whose answer was lost — so ids minted INSIDE the function would write a second copy of every row on
 * a re-run. They are minted once, before it, and a re-run writes the same documents again, which
 * changes nothing but their timestamps.
 *
 * A transaction needs the server, so a part that deletes is never held offline — the rule every
 * removal has kept since v25.89. If it fails without reaching the server, whether its commit landed
 * is unknown, so the error is marked `partialCommit` even on the first part: the review closes, and
 * reading the roster again shows what was saved (admin-roster-upload.js).
 *
 * ── WHAT IT DOES NOT SEE ────────────────────────────────────────────────────────────────────────
 *
 * A second IMPORT of the same week running at the same time: its records take random ids, which a
 * transaction cannot look up without a query. Only the admin imports, so this is two tabs of one
 * person; KNOWN_LIMITATIONS.md records it.
 *
 * Pure of the DOM: the coordinator (admin-roster-upload.js) hands it the rows and the records its
 * review loaded, and turns a refusal into words with `refusalLine`. Tested through
 * admin-roster-upload.test.mjs (the save) and e2e/operations.spec.js (a colleague's edit, end to end).
 */

import { db, collection, doc, writeBatch, runTransaction, serverTimestamp, writeWithClaimRetry, COLLECTIONS } from './firebase-client.js';
import { buildOverrideWrite, nextReplacedType, nextLeaveYear, chunkByWrites } from './override-utils.js';
import { sameOverrideRecord } from './override-compare.js';
import { replacedTypeForSwap } from './al-swapped-days.js';
import { shiftValueToOverrideType, isZeroLengthRange } from './roster-cell-rules.js';
import { isRdwEncoded, stripRdw } from './roster-review-states.js';
import { MONTH_ABB, parseISODate } from './roster-data.js';
import { withSlowSaveNotice } from './slow-save.js';

/** The code a Save refused for a day that changed since the read throws with. Its `days` name them. */
export const IMPORT_CHANGED_CODE = 'roster-import/changed';

/** How a transaction ends when it never reached the server. */
const NO_SERVER = new Set(['unavailable', 'deadline-exceeded']);

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * @typedef {{memberName: string, date: string, value: string|null, baseShift: string, replaceId?: string|null,
 *   alsoDelete?: string[], deleteOnly?: boolean, swapped?: boolean, replacedFrom?: any}} RosterWrite
 */

/**
 * One part's operations, built ONCE: the deletes, and each new record on an id minted here.
 * A zero-length worked range is refused before anything — it deletes nothing either (v20.39: the day
 * keeps what it had rather than gaining a shift the maths would read as 24 hours).
 * @param {RosterWrite[]} chunk @param {string} currentUser
 * @returns {{ deletes: Array<{ id: string, memberName: string, date: string }>, sets: Array<{ ref: any, data: any }> }}
 */
function planChunk(chunk, currentUser) {
    /** @type {Array<{ id: string, memberName: string, date: string }>} */ const deletes = [];
    /** @type {Array<{ ref: any, data: any }>} */ const sets = [];
    const stamp = serverTimestamp();
    for (const { memberName, date, value, replaceId, deleteOnly, replacedFrom, swapped, alsoDelete } of chunk) {
        const drop = () => {
            if (replaceId) deletes.push({ id: replaceId, memberName, date });
            for (const id of alsoDelete ?? []) deletes.push({ id, memberName, date });
        };
        if (deleteOnly) { drop(); continue; }   // REMOVE_IMPORT, or a rest day over a base rest day: clear, write nothing
        if (typeof value === 'string' && isZeroLengthRange(value)) {
            console.warn(`[roster-upload] Refused zero-length shift "${value}" for ${memberName} ${date} — not written`);
            continue;
        }
        // Sunday shifts save as 'rdw' and an explicit RDW| prefix is honoured (the date decides).
        const type = shiftValueToOverrideType(/** @type {string} */ (value), date);
        // Firestore stores the plain time; `type` carries the RDW-ness.
        let savedValue = isRdwEncoded(value) ? stripRdw(value) : value;
        // A correction always means "set as Rest Day": its canonical value is 'RD' (bilingual OFF, a
        // Sunday AL/SICK…), or the rules refuse the whole part.
        if (type === 'correction') savedValue = 'RD';
        drop();
        // The import deletes the record it replaces like every other write path, so it keeps what that
        // record SAID (v21.56, v25.18): over a swapped-in day the evidence the member was contracted to
        // work it, over a moved January leave day which year's allowance it comes out of.
        sets.push({ ref: doc(collection(db, COLLECTIONS.overrides)), data: buildOverrideWrite(
            { memberName, date, type, value: savedValue, note: '', source: 'roster_import', changedBy: currentUser,
              replacedType: swapped ? replacedTypeForSwap(replacedFrom, type) : nextReplacedType(replacedFrom, type),
              leaveYear: nextLeaveYear(replacedFrom, type, date) },
            stamp) });
    }
    return { deletes, sets };
}

/**
 * Write the reviewed roster changes, in parts of at most ~450 operations. A part that deletes is
 * checked (the module header); a part that only adds is a batch. Each part runs inside
 * `writeWithClaimRetry`, so a stale admin claim refreshes and retries once.
 *
 * @param {RosterWrite[]} toWrite                 what the review's Save collected (`collectRosterWrites`)
 * @param {string} currentUser                    written to `changedBy`
 * @param {Map<string, any>} [shown]              every record the review LOADED, by id — what each
 *                                                deleted record must still be
 * @returns {Promise<number>} how many rows were REFUSED as zero-length and not written (v24.38)
 * @throws an error with `code: IMPORT_CHANGED_CODE`, `days` and `savedEarlier` when a part was refused
 *         for a changed day; one marked `partialCommit` when what landed is unknown
 */
export async function saveRosterWrites(toWrite, currentUser, shown = new Map()) {
    const refused = toWrite.filter(w => !w.deleteOnly && typeof w.value === 'string' && isZeroLengthRange(w.value)).length;
    // A part is cut by OPERATIONS: a row is a delete + a set + a delete per older copy.
    const chunks = chunkByWrites(toWrite, w => 2 + (w.alsoDelete?.length ?? 0));
    let committed = 0;
    for (const chunk of chunks) {
        const { deletes, sets } = planChunk(chunk, currentUser);
        /** @param {any} w a batch or a transaction */
        const apply = (w) => {
            for (const { id } of deletes) w.delete(doc(db, COLLECTIONS.overrides, id));
            for (const { ref, data } of sets) w.set(ref, data);
        };
        try {
            await withSlowSaveNotice(writeWithClaimRetry(async () => {
                if (!deletes.length) {
                    const batch = writeBatch(db);
                    apply(batch);
                    await batch.commit();
                    return;
                }
                await runTransaction(db, async (/** @type {any} */ tx) => {
                    const snaps = await Promise.all(deletes.map(({ id }) => tx.get(doc(db, COLLECTIONS.overrides, id))));
                    const changed = deletes.filter((d, i) => snaps[i].exists() && !sameOverrideRecord(shown.get(d.id), snaps[i].data()));
                    if (changed.length) {
                        const seen = new Set();
                        const days = changed.filter(d => !seen.has(`${d.memberName}|${d.date}`) && seen.add(`${d.memberName}|${d.date}`))
                            .map(({ memberName, date }) => ({ memberName, date }))
                            .sort((a, b) => a.date.localeCompare(b.date) || a.memberName.localeCompare(b.memberName));
                        throw Object.assign(new Error('a day changed after the roster was read'),
                            { code: IMPORT_CHANGED_CODE, days, savedEarlier: committed > 0 });
                    }
                    apply(tx);
                });
            }), { batched: chunks.length > 1 });
            committed++;
        } catch (err) {
            const e = /** @type {any} */ (err);
            // A refused part wrote nothing; what earlier parts wrote is said by `savedEarlier`.
            if (e?.code === IMPORT_CHANGED_CODE) throw err;
            // Earlier parts committed, or a transaction that never reached the server may have: either
            // way some of the roster may be saved, and the caller re-reads rather than inviting a
            // second copy (v16.25; v24.39 for the same reasoning on a sign-out).
            if (committed > 0 || (deletes.length && NO_SERVER.has(e?.code))) e.partialCommit = true;
            throw err;
        }
    }
    return refused;
}

/**
 * What the admin is told when a Save was refused because days changed after the read — named, as
 * Admin's own refusals name them. `redrawn`: the review was read again and now shows those days as
 * they are; otherwise it closed, and reading the roster again is the way back.
 * @param {Array<{ memberName: string, date: string }>} days
 * @param {{ savedEarlier?: boolean, redrawn?: boolean }} [opts]
 * @returns {string}
 */
export function refusalLine(days, { savedEarlier = false, redrawn = false } = {}) {
    const name = (/** @type {{ memberName: string, date: string }} */ d) => {
        const dt = parseISODate(d.date);
        return `${d.memberName} on ${DAY_NAMES[dt.getDay()]} ${dt.getDate()} ${MONTH_ABB[dt.getMonth()]}`;
    };
    const shown = days.slice(0, 4).map(name);
    const more = days.length - shown.length;
    const list = more > 0 ? `${shown.join(', ')} and ${more} more`
        : shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : (shown[0] ?? 'a day');
    const one = days.length <= 1;
    const lead = savedEarlier ? 'Part of the roster was saved, but not the rest' : 'Nothing was saved';
    return `${lead}: ${list} changed after the roster was read. `
        + (redrawn ? `The review now shows ${one ? 'that day' : 'those days'} as ${one ? 'it is' : 'they are'} — check, then save again.`
            : 'Read the roster again to see the latest, then save again.');
}
