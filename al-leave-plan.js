// @ts-check
/**
 * al-leave-plan.js — what one Save of the Annual leave sheet would write, person by person; what its
 * upload log says; and what an Undo of it may take back. Phase 2b of the annual leave uploader
 * (docs/DECISIONS.md → The annual leave uploader). Pure: no DOM, no Firebase. The writer is al-leave-save.js and
 * the card is operations-al-sheet.js.
 *
 * ── THE DAYS IT WRITES, AND THE ONES IT NEVER DOES ──────────────────────────────────────────────
 *
 * It starts from the comparison (al-leave-compare.js), which has already asked the app's own rules
 * what each day is, and adds only what is specific to a Save:
 *
 *   not-in-app    ADD leave, for a person the admin has confirmed
 *   rest-day      ASKED, as the Admin leave card asks: "swapped" adds leave that costs a day,
 *                 "free" writes nothing and is named on the receipt, unanswered writes nothing
 *   free-in-app   asked only where Admin asks (`swapQuestion`): "swapped" rewrites the leave with the
 *                 swap recorded, so it costs a day; otherwise nothing
 *   anything else NOTHING. Leave that already agrees needs nothing; a shift, an absence or a
 *                 correction there is a conflict, which is Phase 3; and RDW, an Other day or a Spare
 *                 turn is work and pay evidence, which an upload never overwrites (DECISIONS.md → The annual leave uploader)
 *
 * Nothing at all is written for a person whose row is not confirmed: their answers wait with them.
 *
 * Two guards that no comparison state stands in for, because a mistake on either is silent:
 *   · NEVER ON A SUNDAY. Annual leave cannot be recorded on a Sunday (`SUNDAY_FORBIDDEN_TYPES`,
 *     override-utils.js). This is that rule's SEVENTH enforcement layer (CLAUDE.md numbers them, and
 *     says to append rather than renumber). A Sunday the sheet tags is Phase 3's, never leave.
 *   · NEVER ON 25 OR 26 DECEMBER. From 2026 the app's own Christmas leave decides those days
 *     (christmas-leave.js), and a stored record there is one nothing counts.
 *
 * ── LEAVE CANCELLED IN THE APP MUST NOT COME BACK ────────────────────────────────────────────────
 *
 * The workbook is always older than the upload, and a deletion leaves no trace. So a sheet day that
 * an earlier Save's log says was in line, and that the app now holds nothing on, was REMOVED IN THE
 * APP SINCE: it is shown and never written, and Admin's leave card puts it back if it should be there.
 * That is narrower than the plan of record (now in git), which left such a day unticked for the admin to tick: this release
 * has no tick on a single day, and never writing one is the safe half of that choice.
 *
 * ── EACH WRITE IS THE ADMIN LEAVE CARD'S OWN WRITE OF THE DAY ───────────────────────────────────
 *
 * A manual record at the day's fixed id (`manualOverrideId`), exactly as `recordRangeOverrides` writes
 * one (admin-overrides.js):
 *   · `replacedType` from `nextReplacedType`, or from `replacedTypeForSwap` for an answered swap;
 *   · `leaveYear` from `nextLeaveYear` for a rewrite, or the file's own for a next-January day the
 *     sheet charges to this year;
 *   · the records it replaces deleted with it: whatever won the day, and every other manual copy of
 *     it, never the fixed id itself (`idsReplacedBy`'s rule).
 * Every record a write replaces, and the one it overwrites, travels as the ROW the check loaded. The
 * checked commit compares rows (`commitChecked`, admin-override-store.js), and Operations has no Admin
 * cache to look an id up in: there, an id given without its row must hold nothing at all.
 *
 * ── EVERY RECORD A SAVE WRITES CARRIES THAT SAVE'S ID (external review, 15 Nov 2026) ────────────
 *
 * The upload log's id is minted before anything is sent, and every write carries it (`uploadId`,
 * buildOverrideWrite's third argument; firestore.rules takes it only on manual annual leave written by
 * the admin). Every other writer builds its record without it, so the mark goes with the first rewrite
 * of the day by anybody — a colleague, the same admin in Admin or in another tab, a leave-year move —
 * and a record still carrying it is that Save's write, unchanged. That is how a day is known to be the
 * Save's everywhere below: what landed (`landedWrites`), what the log calls added (`logLists`) and what
 * an Undo may take back (`planUndo`).
 *
 * It replaced a judgement by date. The log is written last, after the records and a read of them, and
 * the first rule took any record its author wrote no later than the log for the Save's own — so a change
 * the same admin made in the gap between the Save and its log was undone with it. A log written before
 * the mark (no `writesMarked`: a Save before v26.15, 15 Nov 2026) has no marked records, so nothing can
 * tell its days from a change made since. ITS UNDO IS NOT OFFERED, and `planUndo` takes nothing back for
 * it (review, 18 Nov 2026): judged by date, as it was until then, it took back the very change the mark
 * exists to protect. Its days are removed by hand in Admin instead — the side to be wrong on (below).
 * Such logs go with their year (al-leave-save.js → `pruneUploadLogs`).
 *
 * ── THE LOG IS WRITTEN FROM WHAT THE SERVER SAYS, NOT FROM WHAT WAS SENT ────────────────────────
 *
 * After a Save the app reads every compared person again, and `logLists` builds the upload log from
 * that read: `inLine` is every sheet leave day the app then holds as leave, and `added` only the days
 * the read shows this Save created, still carrying its id. A part that ended with no answer from the
 * server may still have landed, so nothing about it is assumed either way.
 *
 * A DAY THE SAVE WAS REFUSED ON IS NEVER ITS OWN (review, 15 Nov 2026). The admin's own booking of the
 * same day, made by hand after the check, is the Save's record field for field but for the id it lacks.
 * The refusal names the days that had changed, and those are `exclude`d from what landed too, so a
 * receipt never counts a day for a person it says was refused. (A part refused on a re-run, after an
 * attempt whose answer was lost, can leave the Save's own record on such a day. It is not claimed, so an
 * Undo keeps it: the side to be wrong on, since a day kept can be removed by hand and one undone is gone.)
 *
 * ── PROTECTION REACHES ACROSS THE NEW YEAR ──────────────────────────────────────────────────────
 *
 * Each year's sheet runs into the first days of the next January, so last year's log can call a day
 * of this file in line. `judgeUploads` takes every log it is given for protection, and the card reads
 * last year's with this year's; which copy is newer is still this year's logs' question alone. And a
 * sheet for a year before last is a check only: its logs are deleted by every Save (`pruneUploadLogs`),
 * so its own log would go the moment it was written, and with it the protection.
 */

import { manualOverrideId } from './override-id.js';
import { nextReplacedType, isForbiddenOnSunday, shouldReplaceOverride, tsToMillis } from './override-utils.js';
import { replacedTypeForSwap } from './al-swapped-days.js';
import { nextLeaveYear, isValidLeaveYear } from './leave-year.js';
import { isSunday } from './roster-data.js';
import { isChristmasClosureDate } from './christmas-leave.js';
import { LEAVE_FILE_MAX_AGE_DAYS, leaveFileAgeDays } from './al-leave-file.js';

/**
 * The oldest year whose sheet may still be saved: last year's — the year whose logs every Save keeps
 * (al-leave-save.js → `pruneUploadLogs`). @param {string} todayStr
 */
export const oldestSaveableYear = todayStr => Number(todayStr.slice(0, 4)) - 1;

/** The two answers to "was it a swapped working day?". */
export const ANSWERS = Object.freeze(['swapped', 'free']);
/** The most days one upload log may list — firestore.rules caps `inLine` at the same figure, and
 *  al-leave-plan.test.mjs reads the rules to hold the two together. */
export const LOG_MAX_DAYS = 4000;
/** The comparison states where the app holds the sheet's day as leave: the days a log calls in line. */
export const HELD_STATES = Object.freeze(['match', 'carried', 'other-year', 'free-in-app', 'spare-week']);
/** What a Save writes on a day: leave added, leave added on a rest day answered "swapped", or a
 *  stored day of leave rewritten with the swap recorded. Only the first two are undone by Undo. */
export const WRITE_KINDS = Object.freeze(['add', 'add-swapped', 'swap']);

const LEAVE = 'annual_leave';

/**
 * A day's key across the planner and in an upload log — the override cache key's form.
 * @param {string} name @param {string} date @returns {string}
 */
export const dayKey = (name, date) => `${name}|${date}`;

/**
 * The name and date in a key. Null for anything that is not one.
 * @param {string} key @returns {{ name: string, date: string }|null}
 */
export function parseDayKey(key) {
    const m = /^(.+)\|(\d{4}-\d{2}-\d{2})$/.exec(typeof key === 'string' ? key : '');
    return m ? { name: m[1], date: m[2] } : null;
}

/**
 * May a Save ever write leave on this date? Never on a Sunday (the seventh layer) or at Christmas.
 * @param {string} date @returns {boolean}
 */
export function writableDate(date) {
    return !(isSunday(date) && isForbiddenOnSunday(LEAVE)) && !isChristmasClosureDate(date);
}

/**
 * @typedef {{ kind: 'add'|'add-swapped'|'swap', date: string, fixedId: string, shown: any|null,
 *             replaces: any[], fields: { memberName: string, date: string, type: string, value: string,
 *             note: string, source: string, changedBy: string, replacedType: string|null, leaveYear: number|null } }} PlannedWrite
 *   `shown`: the record the check loaded at the fixed id, or else whatever won the day, or null —
 *   what the checked commit requires the day still to hold; `replaces`: the rows deleted with it
 * @typedef {{ name: string, confirmed: boolean, writes: PlannedWrite[], leftFree: string[],
 *             unanswered: string[], removedSince: string[], questions: string[] }} PersonPlan
 *   `writes` is empty unless `confirmed`; the date lists are the person's, confirmed or not
 */

/**
 * The questions a person's days raise: every date where Admin would ask "was it a swapped working
 * day?" and an answer could still change what is written — not a day removed in the app since.
 * @param {import('./al-leave-compare.js').PersonComparison} person
 * @param {Set<string>} [protectedKeys] the days earlier Saves brought into line (`judgeUploads`)
 * @returns {string[]}
 */
export function questionsFor(person, protectedKeys = new Set()) {
    return person.days.filter(d => d.swapQuestion && writableDate(d.date)
        && (d.state === 'rest-day' || d.state === 'free-in-app')
        && !(d.state === 'rest-day' && protectedKeys.has(dayKey(person.name, d.date))))
        .map(d => d.date);
}

/**
 * One person's part of a Save.
 * @param {{ person: import('./al-leave-compare.js').PersonComparison, records: any[],
 *           answers?: Map<string, string>, confirmed?: boolean, protectedKeys?: Set<string>,
 *           leaveYears?: Map<string, number>, changedBy: string }} a
 *   `records`: every record of the member's as the check read it, ids included; `leaveYears`: the
 *   file's own `leaveYear` for each of the person's days that carries one
 * @returns {PersonPlan}
 */
export function planPerson({ person, records, answers = new Map(), confirmed = false, protectedKeys = new Set(),
    leaveYears = new Map(), changedBy }) {
    const name = person.name;
    const mine = (records || []).filter(r => r && r.memberName === name && typeof r.date === 'string');
    /** @type {PersonPlan} */
    const plan = { name, confirmed, writes: [], leftFree: [], unanswered: [], removedSince: [], questions: questionsFor(person, protectedKeys) };
    for (const d of person.days) {
        if (d.kind !== 'leave' || !writableDate(d.date)) continue;
        const nothingThere = d.state === 'not-in-app' || d.state === 'rest-day';
        if (nothingThere && protectedKeys.has(dayKey(name, d.date))) { plan.removedSince.push(d.date); continue; }
        /** @type {'add'|'add-swapped'|'swap'|null} */ let kind = null;
        if (d.state === 'not-in-app') kind = 'add';
        else if ((d.state === 'rest-day' || d.state === 'free-in-app') && d.swapQuestion) {
            const answer = answers.get(d.date);
            if (answer === 'swapped') kind = d.state === 'rest-day' ? 'add-swapped' : 'swap';
            else if (answer === 'free') plan.leftFree.push(d.date);
            else plan.unanswered.push(d.date);
        }
        if (kind && confirmed) plan.writes.push(writeFor({ kind, name, date: d.date, mine, leaveYear: leaveYears.get(d.date) ?? null, changedBy }));
    }
    return plan;
}

/**
 * One day's write, as the Admin leave card would make it (header).
 * @param {{ kind: 'add'|'add-swapped'|'swap', name: string, date: string, mine: any[], leaveYear: number|null, changedBy: string }} a
 * @returns {PlannedWrite}
 */
function writeFor({ kind, name, date, mine, leaveYear, changedBy }) {
    const fixedId = manualOverrideId(name, date);
    const onDay = mine.filter(r => r.date === date);
    /** @type {any} */ let winner = null;
    for (const r of onDay) if (shouldReplaceOverride(winner ?? undefined, r)) winner = r;
    const atFixed = onDay.find(r => r.id === fixedId) ?? null;
    // Whatever won the day, and every manual copy of it, except the fixed id, which is overwritten.
    /** @type {Map<string, any>} */ const replaces = new Map();
    for (const r of onDay) {
        if (r.id === fixedId) continue;
        if (r === winner || (r.source ?? '') !== 'roster_import') replaces.set(r.id, r);
    }
    const replacedType = kind === 'add' ? nextReplacedType(winner, LEAVE) : replacedTypeForSwap(winner, LEAVE);
    const year = kind === 'swap' ? nextLeaveYear(winner, LEAVE, date)
        : (isValidLeaveYear(date, leaveYear) ? leaveYear : nextLeaveYear(winner, LEAVE, date));
    return { kind, date, fixedId, shown: atFixed ?? winner, replaces: [...replaces.values()],
        fields: { memberName: name, date, type: LEAVE, value: 'AL', note: '', source: 'manual', changedBy,
            replacedType: replacedType ?? null, leaveYear: year ?? null } };
}

/**
 * How many Firestore writes one planned day costs: its record, and a delete per record it replaces.
 * @param {PlannedWrite} w @returns {number}
 */
export const writesFor = (w) => 1 + w.replaces.length;

/**
 * What the Save button names: the days it writes and for how many people.
 * @param {PersonPlan[]} plans @returns {{ days: number, people: number, added: number, swapped: number, rewritten: number }}
 */
export function saveTotals(plans) {
    const writing = plans.filter(p => p.writes.length);
    const all = writing.flatMap(p => p.writes);
    return { days: all.length, people: writing.length,
        added: all.filter(w => w.kind === 'add').length,
        swapped: all.filter(w => w.kind === 'add-swapped').length,
        rewritten: all.filter(w => w.kind === 'swap').length };
}

/**
 * A member's records as they would be after this person's part of the Save — for the "after"
 * figures. Every field the write carries is kept, `replacedType` and `leaveYear`
 * included — as `overridesAfterSave` (admin-al-projection.js) now keeps them too (`writtenRecord`,
 * 21 Nov 2026), so the two agree: dropped, a swapped rest day would read as free. The new records are stamped with the device's clock, as the page's own copies are,
 * which `shouldReplaceOverride` ranks newest.
 * @param {any[]} records @param {PersonPlan} plan @param {Date} [now]
 * @returns {any[]}
 */
export function recordsAfter(records, plan, now = new Date()) {
    const gone = new Set(plan.writes.flatMap(w => [w.fixedId, ...w.replaces.map(r => r.id)]));
    return [...(records || []).filter(r => !gone.has(r?.id)),
        ...plan.writes.map(w => ({ id: w.fixedId, ...w.fields, createdAt: now }))];
}

/**
 * @typedef {{ year: number, fileDigest: string, workbookSha256: string, clerksLastSaved: string,
 *             lastSavedByClerk: boolean|null, savedAt?: any, savedBy: string, appVersion: string,
 *             inLine: string[], added: string[], writesMarked?: true, undoneAt?: any, undoneBy?: string, undone?: string[],
 *             id?: string }} UploadLog
 *   `writesMarked`: every record of this Save carries its id (header); absent on a log from v26.13
 */

/**
 * What the logs already written say about a new file (header): whether it may be saved at all, and
 * which days earlier Saves brought into line. `logs` are this year's and last year's (header).
 *   · A copy saved BEFORE the newest one logged for its year is refused by name. The same copy again
 *     is allowed: what its last Save wrote shows as already right, so a Save that stopped half way is
 *     finished by uploading it again.
 *   · `protectedKeys`: every day any log calls in line, less what an undo took back AFTER that log was
 *     written — its own, or a later one's (below).
 *   · `undoable`: the Save whose Undo is offered, or null (below).
 *
 * ── THE UNDO ON OFFER IS THE LATEST SAVE THAT ADDED LEAVE (review of v26.22) ─────────────────────
 *
 * A Save where only rewrites landed (swaps) is logged, for its days in line and its copy of the
 * workbook, with nothing `added` — so it has no Undo of its own, and as the newest log it took the
 * earlier Save's Undo off the screen. A log that added nothing is now passed over; nothing further
 * back is: one Undo, of the latest Save that added leave, and none once that is undone (the rules let
 * a log be undone once). Taking it back past a later Save is safe because an Undo removes only a record
 * still carrying its Save's mark (`planUndo`), and a later swap rewrites the record without it. A Save
 * from before the mark is that Save all the same, but its Undo is withheld (header): it comes back as
 * `unmarked`, so the card can name it and say why there is no Undo, rather than show nothing.
 *
 * And the later log still calls the undone days in line, which protected them as "removed in the app
 * since" — so an undo takes a day out of every log written BEFORE it, as it always took it out of its
 * own: the Undo removed the day, not somebody in the app. A log written after the undo keeps its claim.
 * @param {{ logs: UploadLog[], file: any }} a
 * @returns {{ newest: UploadLog|null, undoable: UploadLog|null, unmarked: UploadLog|null, older: boolean, sameFile: boolean,
 *             protectedKeys: Set<string> }}
 */
export function judgeUploads({ logs, file }) {
    const all = (logs || []).filter(l => l && typeof l.clerksLastSaved === 'string');
    /** Newest first: by the workbook copy, then by when it was saved here. @param {UploadLog} a @param {UploadLog} b */
    const newerFirst = (a, b) => (a.clerksLastSaved === b.clerksLastSaved ? tsToMillis(b.savedAt) - tsToMillis(a.savedAt)
        : a.clerksLastSaved > b.clerksLastSaved ? -1 : 1);
    const ofYear = all.filter(l => l.year === file.year).sort(newerFirst);
    const newest = ofYear[0] ?? null;
    const lastAdding = ofYear.find(l => Array.isArray(l.added) && l.added.length > 0) ?? null;
    const saved = file?.source?.clerksLastSaved;
    const older = !!newest && typeof saved === 'string' && saved < newest.clerksLastSaved;
    const undos = all.filter(l => Array.isArray(l.undone) && l.undone.length)
        .map(u => ({ log: u, at: tsToMillis(u.undoneAt), keys: new Set(u.undone) }));
    /** @type {Set<string>} */ const protectedKeys = new Set();
    // Every log given, last year's included (header): its next-January days are this file's first ones.
    for (const l of all) {
        const savedAt = tsToMillis(l.savedAt);
        /** @param {string} k */
        const undoneSince = k => undos.some(u => u.keys.has(k) && (u.log === l || (u.at > 0 && savedAt > 0 && u.at > savedAt)));
        for (const k of Array.isArray(l.inLine) ? l.inLine : []) if (!undoneSince(k)) protectedKeys.add(k);
    }
    const offered = lastAdding && !('undoneAt' in lastAdding) ? lastAdding : null;
    const marked = offered?.writesMarked === true;
    return { newest, undoable: marked ? offered : null, unmarked: marked ? null : offered,
        older, sameFile: ofYear.some(l => l.fileDigest === file?.digest), protectedKeys };
}

/**
 * Why a Save of this file is refused before anything is written, or null when it may go ahead. Each
 * is a code the card puts into words; none quotes the file.
 *   · 'old-year'    — a sheet for a year before last (header: its log would not outlive its Save);
 *   · 'age-unknown' — the file cannot say when the clerks last saved the workbook, so it cannot be
 *     ordered against another copy or aged;
 *   · 'too-old'     — older than the limit (decision 4, LEAVE_FILE_MAX_AGE_DAYS): get a fresh copy;
 *   · 'older-copy'  — a newer copy of the workbook has already been saved (`judgeUploads`).
 * @param {{ file: any, todayStr: string, judged: ReturnType<typeof judgeUploads> }} a
 * @returns {null|'old-year'|'age-unknown'|'too-old'|'older-copy'}
 */
export function saveRefusal({ file, todayStr, judged }) {
    if (!(file?.year >= oldestSaveableYear(todayStr))) return 'old-year';
    const age = leaveFileAgeDays(file, todayStr);
    if (age === null) return 'age-unknown';
    if (age > LEAVE_FILE_MAX_AGE_DAYS) return 'too-old';
    if (judged.older) return 'older-copy';
    return null;
}

/**
 * The two lists of an upload log, built from the comparison of what the app holds AFTER the Save
 * (header): `inLine`, every sheet leave day of every compared person the app now holds as leave; and
 * `added`, the days of `plans` this Save created that the read shows are still its own record — at
 * the fixed id, annual leave, written by `savedBy`, carrying the Save's `uploadId`. Sorted, each once.
 * @param {{ after: import('./al-leave-compare.js').PersonComparison[], plans: PersonPlan[],
 *           recordsByName: Map<string, any[]>, savedBy: string, uploadId: string, exclude?: Map<string, string[]> }} a
 *   `uploadId`: the Save's own id, the log's (`landedWrites`); `exclude`: each person's days the Save was refused on
 * @returns {{ inLine: string[], added: string[] }}
 */
export function logLists({ after, plans, recordsByName, savedBy, uploadId, exclude }) {
    const inLine = new Set();
    for (const p of after) {
        for (const d of p.days) if (d.kind === 'leave' && HELD_STATES.includes(d.state)) inLine.add(dayKey(p.name, d.date));
    }
    const added = new Set();
    for (const [name, dates] of landedWrites({ plans, recordsByName, savedBy, uploadId, kinds: ADDING, exclude })) {
        for (const date of dates) added.add(dayKey(name, date));
    }
    // Only a day that is in line can have been added: the rules hold `added` to no more than `inLine`.
    for (const k of added) inLine.add(k);
    return { inLine: [...inLine].sort(), added: [...added].sort() };
}

/** The kinds of write that create a record, which an Undo may take back; a 'swap' rewrites one. */
const ADDING = ['add', 'add-swapped'];

/**
 * The writes of `plans` that a read made after the Save shows landed as written, by person: the
 * record at the write's fixed id is annual leave for that person and day, written by `savedBy` as
 * Admin's leave card writes it, with the write's own swap answer, and still carries the Save's
 * `uploadId` (header). It is what the receipt counts once the server has been read, because a Save
 * whose answer was lost on the way back may have landed whole, and "Nothing was saved" would then be
 * untrue (14 Nov 2026). `kinds` narrows it to the writes that create a record (`logLists`); `exclude`
 * takes out the days the Save was refused on, whatever the read finds there (header).
 * @param {{ plans: PersonPlan[], recordsByName: Map<string, any[]>, savedBy: string, uploadId: string,
 *           kinds?: string[], exclude?: Map<string, string[]> }} a  `uploadId`: with none, nothing landed
 * @returns {Map<string, string[]>}
 */
export function landedWrites({ plans, recordsByName, savedBy, uploadId, kinds, exclude }) {
    /** @type {Map<string, string[]>} */ const out = new Map();
    for (const plan of plans) {
        const byId = new Map((recordsByName.get(plan.name) ?? []).map(r => [r.id, r]));
        const refused = new Set(exclude?.get(plan.name) ?? []);
        const dates = plan.writes.filter(w => (!kinds || kinds.includes(w.kind)) && !refused.has(w.date)
            && landedAs(w, byId.get(w.fixedId), plan.name, savedBy, uploadId))
            .map(w => w.date);
        if (dates.length) out.set(plan.name, dates);
    }
    return out;
}

/** @param {PlannedWrite} w @param {any} r the record read at its fixed id @param {string} name @param {string} savedBy @param {string} uploadId */
const landedAs = (w, r, name, savedBy, uploadId) => markedBy(r, uploadId) && r.type === LEAVE && r.memberName === name
    && r.date === w.date && r.changedBy === savedBy && (r.source ?? '') === 'manual'
    && (r.replacedType ?? null) === (w.fields.replacedType ?? null);

/**
 * Does `r` still carry the mark of the Save whose id is `id` (header)? Never with no id to look for:
 * a record without a mark must not pass for the mark of a Save that had none.
 * @param {any} r @param {unknown} id @returns {boolean}
 */
const markedBy = (r, id) => typeof id === 'string' && id !== '' && !!r && r.uploadId === id;

/**
 * The upload log's fields, all but the server's `savedAt`. Null when there is nothing in line to
 * record, or more than a log may hold — the rules would refuse it, and the receipt says so instead.
 * @param {{ file: any, inLine: string[], added: string[], savedBy: string, appVersion: string }} a
 * @returns {Omit<UploadLog, 'savedAt'>|null}
 */
export function logFields({ file, inLine, added, savedBy, appVersion }) {
    if (!inLine.length || inLine.length > LOG_MAX_DAYS) return null;
    const saved = file?.source?.clerksLastSaved;
    if (typeof saved !== 'string') return null;
    return { year: file.year, fileDigest: file.digest, workbookSha256: file.source.sha256, clerksLastSaved: saved,
        lastSavedByClerk: typeof file.source.lastSavedByClerk === 'boolean' ? file.source.lastSavedByClerk : null,
        savedBy, appVersion, inLine, added, writesMarked: true };
}

/**
 * What an Undo of `log` may take back (header): each day the Save ADDED whose record is still
 * the Save's own — at the fixed id, annual leave, written by the log's author, and still carrying the
 * log's id (header). A day rewritten since, by anybody, has lost the mark and is kept; a day already
 * gone is neither. So a log written before the mark (no `writesMarked`) takes NOTHING back: its
 * records carry no id, so none is still its own, and every day it added that is still there is kept
 * (header: its Undo is not offered either — this is the second lock behind that one). A rewrite of a
 * stored day ('swap') is never undone: the rules stamp every write afresh, so a "restored" record
 * would be a new one claiming to be the old.
 * @param {{ log: UploadLog, recordsByName: Map<string, any[]> }} a
 * @returns {{ remove: any[], kept: string[], gone: string[] }} `remove`: the rows to delete, as read
 */
export function planUndo({ log, recordsByName }) {
    /** @type {any[]} */ const remove = [];
    /** @type {string[]} */ const kept = [];
    /** @type {string[]} */ const gone = [];
    for (const key of log.added ?? []) {
        const day = parseDayKey(key);
        if (!day) continue;
        const r = (recordsByName.get(day.name) ?? []).find(x => x?.id === manualOverrideId(day.name, day.date));
        if (!r) { gone.push(key); continue; }
        const own = r.type === LEAVE && r.memberName === day.name && r.date === day.date && (r.source ?? '') === 'manual'
            && r.changedBy === log.savedBy && markedBy(r, log.id);
        if (own) remove.push(r); else kept.push(key);
    }
    return { remove, kept, gone };
}
