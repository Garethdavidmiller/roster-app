// @ts-check
/**
 * al-leave-plan.js — what one Save of the Annual leave sheet would write, person by person; what its
 * upload log says; and what an Undo of it may take back. Phase 2b of the annual leave uploader
 * (docs/AL_UPLOADER_PLAN.md §4.5–4.10). Pure: no DOM, no Firebase. The writer is al-leave-save.js and
 * the card is operations-al-sheet.js.
 *
 * ── THE DAYS IT WRITES, AND THE ONES IT NEVER DOES ──────────────────────────────────────────────
 *
 * It starts from the comparison (al-leave-compare.js), which has already asked the app's own rules
 * what each day is, and adds only what is specific to a Save (plan §4.5):
 *
 *   not-in-app    ADD leave, for a person the admin has confirmed
 *   rest-day      ASKED, as the Admin leave card asks: "swapped" adds leave that costs a day,
 *                 "free" writes nothing and is named on the receipt, unanswered writes nothing
 *   free-in-app   asked only where Admin asks (`swapQuestion`): "swapped" rewrites the leave with the
 *                 swap recorded, so it costs a day; otherwise nothing
 *   anything else NOTHING. Leave that already agrees needs nothing; a shift, an absence or a
 *                 correction there is a conflict, which is Phase 3; and RDW, an Other day or a Spare
 *                 turn is work and pay evidence, which an upload never overwrites (plan §4.5)
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
 * ── LEAVE CANCELLED IN THE APP MUST NOT COME BACK (plan §4.6) ───────────────────────────────────
 *
 * The workbook is always older than the upload, and a deletion leaves no trace. So a sheet day that
 * an earlier Save's log says was in line, and that the app now holds nothing on, was REMOVED IN THE
 * APP SINCE: it is shown and never written, and Admin's leave card puts it back if it should be there.
 * That is narrower than the plan, which left such a day unticked for the admin to tick: this release
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
 * ── THE LOG IS WRITTEN FROM WHAT THE SERVER SAYS, NOT FROM WHAT WAS SENT ────────────────────────
 *
 * After a Save the app reads every compared person again, and `logLists` builds the upload log from
 * that read: `inLine` is every sheet leave day the app then holds as leave, and `added` only the days
 * the read shows this Save created. A part that ended with no answer from the server may still have
 * landed, so nothing about it is assumed either way.
 */

import { manualOverrideId } from './override-id.js';
import { nextReplacedType, isForbiddenOnSunday, shouldReplaceOverride, tsToMillis } from './override-utils.js';
import { replacedTypeForSwap } from './al-swapped-days.js';
import { nextLeaveYear, isValidLeaveYear } from './leave-year.js';
import { isSunday } from './roster-data.js';
import { isChristmasClosureDate } from './christmas-leave.js';
import { LEAVE_FILE_MAX_AGE_DAYS, leaveFileAgeDays } from './al-leave-file.js';

/** The two answers to "was it a swapped working day?". */
export const ANSWERS = Object.freeze(['swapped', 'free']);
/** The most days one upload log may list — firestore.rules caps `inLine` at the same figure, and
 *  al-leave-plan.test.mjs reads the rules to hold the two together. */
export const LOG_MAX_DAYS = 4000;
/** The comparison states where the app holds the sheet's day as leave: the days a log calls in line. */
export const HELD_STATES = Object.freeze(['match', 'carried', 'other-year', 'free-in-app']);
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
 * figures (plan §4.7). Every field the write carries is kept, `replacedType` and `leaveYear`
 * included, which `overridesAfterSave` (admin-al-projection.js) drops: there a swapped rest day would
 * read as free. The new records are stamped with the device's clock, as the page's own copies are,
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
 *             inLine: string[], added: string[], undoneAt?: any, undoneBy?: string, undone?: string[], id?: string }} UploadLog
 */

/**
 * What the logs already written for this year say about a new file (plan §4.6): whether it may be
 * saved at all, and which days earlier Saves brought into line.
 *   · A copy saved BEFORE the newest one logged is refused by name. The same copy again is allowed:
 *     what its last Save wrote shows as already right, so a Save that stopped half way is finished
 *     by uploading it again.
 *   · `protectedKeys`: every day any log calls in line, less what that log's undo took back.
 * @param {{ logs: UploadLog[], file: any }} a
 * @returns {{ newest: UploadLog|null, older: boolean, sameFile: boolean, protectedKeys: Set<string> }}
 */
export function judgeUploads({ logs, file }) {
    const ofYear = (logs || []).filter(l => l && l.year === file.year && typeof l.clerksLastSaved === 'string');
    /** @type {UploadLog|null} */ let newest = null;
    for (const l of ofYear) {
        if (!newest || l.clerksLastSaved > newest.clerksLastSaved
            || (l.clerksLastSaved === newest.clerksLastSaved && tsToMillis(l.savedAt) > tsToMillis(newest.savedAt))) newest = l;
    }
    const saved = file?.source?.clerksLastSaved;
    const older = !!newest && typeof saved === 'string' && saved < newest.clerksLastSaved;
    /** @type {Set<string>} */ const protectedKeys = new Set();
    for (const l of ofYear) {
        const undone = new Set(Array.isArray(l.undone) ? l.undone : []);
        for (const k of Array.isArray(l.inLine) ? l.inLine : []) if (!undone.has(k)) protectedKeys.add(k);
    }
    return { newest, older, sameFile: ofYear.some(l => l.fileDigest === file?.digest), protectedKeys };
}

/**
 * Why a Save of this file is refused before anything is written, or null when it may go ahead. Each
 * is a code the card puts into words; none quotes the file.
 *   · 'age-unknown' — the file cannot say when the clerks last saved the workbook, so it cannot be
 *     ordered against another copy or aged;
 *   · 'too-old'     — older than the limit (decision 4, LEAVE_FILE_MAX_AGE_DAYS): get a fresh copy;
 *   · 'older-copy'  — a newer copy of the workbook has already been saved (`judgeUploads`).
 * @param {{ file: any, todayStr: string, judged: ReturnType<typeof judgeUploads> }} a
 * @returns {null|'age-unknown'|'too-old'|'older-copy'}
 */
export function saveRefusal({ file, todayStr, judged }) {
    const age = leaveFileAgeDays(file, todayStr);
    if (age === null) return 'age-unknown';
    if (age > LEAVE_FILE_MAX_AGE_DAYS) return 'too-old';
    if (judged.older) return 'older-copy';
    return null;
}

/**
 * The two lists of an upload log, built from the comparison of what the app holds AFTER the Save
 * (header): `inLine`, every sheet leave day of every compared person the app now holds as leave; and
 * `added`, the days of `plans` this Save created that the read shows are its own record — at the
 * fixed id, annual leave, written by `savedBy`. Sorted, each once.
 * @param {{ after: import('./al-leave-compare.js').PersonComparison[], plans: PersonPlan[],
 *           recordsByName: Map<string, any[]>, savedBy: string }} a
 * @returns {{ inLine: string[], added: string[] }}
 */
export function logLists({ after, plans, recordsByName, savedBy }) {
    const inLine = new Set();
    for (const p of after) {
        for (const d of p.days) if (d.kind === 'leave' && HELD_STATES.includes(d.state)) inLine.add(dayKey(p.name, d.date));
    }
    const added = new Set();
    for (const plan of plans) {
        const byId = new Map((recordsByName.get(plan.name) ?? []).map(r => [r.id, r]));
        for (const w of plan.writes) {
            if (w.kind === 'swap') continue;
            const r = byId.get(w.fixedId);
            if (r && r.type === LEAVE && r.memberName === plan.name && r.date === w.date && r.changedBy === savedBy
                && (r.source ?? '') === 'manual') added.add(dayKey(plan.name, w.date));
        }
    }
    // Only a day that is in line can have been added: the rules hold `added` to no more than `inLine`.
    for (const k of added) inLine.add(k);
    return { inLine: [...inLine].sort(), added: [...added].sort() };
}

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
        savedBy, appVersion, inLine, added };
}

/**
 * What an Undo of `log` may take back (plan §4.10): each day the Save ADDED whose record is still
 * the Save's own — at the fixed id, annual leave, written by the log's author, and stamped no later
 * than the log, which was written last. A day rewritten since by anybody carries a newer stamp and is
 * kept; a day already gone is neither. A rewrite of a stored day ('swap') is never undone: the rules
 * stamp every write afresh, so a "restored" record would be a new one claiming to be the old.
 * @param {{ log: UploadLog, recordsByName: Map<string, any[]> }} a
 * @returns {{ remove: any[], kept: string[], gone: string[] }} `remove`: the rows to delete, as read
 */
export function planUndo({ log, recordsByName }) {
    /** @type {any[]} */ const remove = [];
    /** @type {string[]} */ const kept = [];
    /** @type {string[]} */ const gone = [];
    const savedAt = tsToMillis(log.savedAt);
    for (const key of log.added ?? []) {
        const day = parseDayKey(key);
        if (!day) continue;
        const r = (recordsByName.get(day.name) ?? []).find(x => x?.id === manualOverrideId(day.name, day.date));
        if (!r) { gone.push(key); continue; }
        const own = r.type === LEAVE && r.memberName === day.name && r.date === day.date && (r.source ?? '') === 'manual'
            && r.changedBy === log.savedBy && savedAt > 0 && tsToMillis(r.createdAt) > 0 && tsToMillis(r.createdAt) <= savedAt;
        if (own) remove.push(r); else kept.push(key);
    }
    return { remove, kept, gone };
}
