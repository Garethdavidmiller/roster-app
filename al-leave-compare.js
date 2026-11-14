// @ts-check
/**
 * al-leave-compare.js — the clerks' leave sheet beside what the app holds, person by person and day
 * by day. Phase 1 of the annual leave uploader (docs/AL_UPLOADER_PLAN.md §4): it DECIDES nothing and
 * writes nothing. It answers "where do the app and the sheet disagree, and why", which is
 * AL_WORKBOOK.md §11's reconcile-and-report — the half of an uploader that was always safe.
 *
 * ── THE APP'S OWN RULES, NEVER A RESTATEMENT ────────────────────────────────────────────────────
 *
 * Draft 1 of the plan had its own table of what each day meant, and it got Admin's rules wrong in
 * three places. So nothing here re-derives a rule. What a day COSTS is `consumesEntitlement`, with
 * the winning record resolved first (`shouldReplaceOverride`, as `countedAlDates` does). What a day
 * with nothing recorded WOULD do is `projectAlBooking` — the same pure function the Admin leave card
 * asks — so "the sheet has leave on a rest day" here is exactly the day Admin would ask "was it a
 * swapped working day?" about (al-leave-compare.test.mjs pins the two together). Where a person
 * stands is `alPosition`, the figure the Admin banner and the Calendar's leave panel read.
 *
 * ── WHAT EACH STATE MEANS ───────────────────────────────────────────────────────────────────────
 *
 * For a day of leave on the sheet (every `leave` day, counted by the sheet or not — a misspelt day
 * is still that person's leave, owner 14 Nov 2026):
 *
 *   match         the app holds leave there, it costs a day, and from the same year's allowance
 *   not-in-app    nothing recorded, and the pattern has them working: the app is a day short
 *   rest-day      nothing recorded, on a rest day — Admin would ask whether it was a swapped day
 *   free-in-app   leave recorded, but costing nothing (a rest day with no swap recorded)
 *   other-year    leave that costs a day, charged to the other year's allowance (leave-year.js)
 *   differs       a shift, an absence or a rest day recorded there instead
 *   worked        RDW, an Other day or a Spare turn recorded there — work, and pay evidence
 *   before-start  before the member's start date, where the app never holds anything
 *
 * And for a Sunday the sheet marks (`sunday-tag`, or a plain name it counts): `sunday`, with what
 * the app holds and what the pattern says, because a tagged Sunday on a rostered shift is a day the
 * member was away from work that neither side can record as leave (AL_WORKBOOK.md §4).
 *
 * App-only leave — leave the app holds on a date the sheet does not have — comes from a separate
 * pass over the member's records: a loop over the sheet's days can never find it.
 *
 * Pure: no DOM, no Firebase. The records arrive as plain objects, one member's at a time.
 */

import { getBaseShift, parseISODate } from './roster-data.js';
import { shouldReplaceOverride, isBeforeMemberStart } from './override-utils.js';
import { consumesEntitlement, alPosition, entitlementFor } from './al-entitlement.js';
import { projectAlBooking } from './admin-al-projection.js';
import { leaveYearOf } from './leave-year.js';
import { usedRow } from './al-leave-file.js';

/** The states a sheet day can be in, in the order the card lists them. */
export const DAY_STATES = Object.freeze(['not-in-app', 'rest-day', 'free-in-app', 'other-year', 'differs', 'worked',
    'before-start', 'match', 'sunday']);
/** The states that need somebody to look — everything but agreement and the two the app cannot hold. */
export const NEEDS_A_LOOK = Object.freeze(['not-in-app', 'rest-day', 'free-in-app', 'other-year', 'differs', 'worked']);
/** Work recorded on a day: never overwritten by an upload, because it is pay evidence (plan §4.5). */
const WORK_TYPES = new Set(['rdw', 'other', 'spare_shift']);

/**
 * Can the app record leave for this person in this year? `null` when it can; otherwise why not, as
 * one of the leave file's own codes (`NOT_IMPORTED_REASONS`). Stage 1 uses it to decide who goes in
 * the file at all; the card asks it again, because the roster may have changed since.
 * @param {any} member a teamMembers entry, or undefined when the name is not on the roster
 * @param {number} year
 * @returns {null|'leaver'|'manager'|'no-allowance'|'not-in-app'}
 */
export function leaveRecordability(member, year) {
    if (!member) return 'not-in-app';
    // Management is hidden as well, so it is asked first: a manager is not a leaver.
    if (member.managerOnly || member.role === 'Management') return 'manager';
    if (member.hidden) return 'leaver';
    if (entitlementFor(member, year) === null) return 'no-allowance';
    return null;
}

/**
 * The record that wins each date, across ALL of one member's records — not only their leave, the
 * same resolution `countedAlDates` makes (an orphaned leave copy beside a newer shift must not win).
 * @param {any[]} records @param {string} name
 * @returns {Map<string, any>}
 */
export function winnersByDate(records, name) {
    /** @type {Map<string, any>} */ const out = new Map();
    for (const r of records || []) {
        if (!r || r.memberName !== name || typeof r.date !== 'string') continue;
        if (shouldReplaceOverride(out.get(r.date), r)) out.set(r.date, r);
    }
    return out;
}

/**
 * @typedef {{ date: string, kind: string, foundIn: string, countedBySheet: boolean, state: string,
 *             app: { type: string, value: string, source: string|null }|null, pattern: string }} DayComparison
 * @typedef {{ name: string, grade: string, sheet: { allowance: number, carriedForward: number, used: number,
 *             columnE: number, remaining: number, corrected: number, undated: number, joinerReduction: number }|null,
 *             app: { entitlement: number|null, taken: number, booked: number, remaining: number|null },
 *             allowanceDiffers: boolean, days: DayComparison[], appOnly: Array<{ date: string, counts: boolean, source: string|null }>,
 *             counts: Record<string, number>, needsALook: boolean, otherRows: number }} PersonComparison
 */

/**
 * One person: their sheet days against their records.
 * @param {{ person: any, days: any[], member: any, records: any[], year: number, todayStr: string,
 *           firstDate: string, lastDate: string }} args
 * @returns {PersonComparison}
 */
export function comparePerson({ person, days, member, records, year, todayStr, firstDate, lastDate }) {
    const winners = winnersByDate(records, member.name);
    const mine = (records || []).filter(r => r && r.memberName === member.name);
    /** @type {DayComparison[]} */ const out = [];
    const sheetLeave = new Set();
    for (const d of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
        const ov = winners.get(d.date) ?? null;
        const app = ov ? { type: String(ov.type ?? ''), value: String(ov.value ?? ''), source: ov.source ?? null } : null;
        const pattern = getBaseShift(member, parseISODate(d.date));
        /** @type {string} */ let state;
        if (d.kind !== 'leave') {
            state = 'sunday';
        } else {
            sheetLeave.add(d.date);
            state = leaveDayState({ member, date: d.date, ov, winners, chargedTo: d.leaveYear ?? year });
        }
        out.push({ date: d.date, kind: d.kind, foundIn: d.foundIn, countedBySheet: d.countedBySheet, state, app, pattern });
    }
    // Leave the app holds that the sheet does not — the pass a loop over the sheet can never make.
    const appOnly = [];
    for (const [date, w] of [...winners].sort(([a], [b]) => a.localeCompare(b))) {
        if (w.type !== 'annual_leave' || date < firstDate || date > lastDate || sheetLeave.has(date)) continue;
        appOnly.push({ date, counts: consumesEntitlement(member, date, winners) && leaveYearOf({ ...w, date }) === year,
                       source: w.source ?? null });
    }

    /** @type {Record<string, number>} */ const counts = Object.fromEntries(DAY_STATES.map(s => [s, 0]));
    for (const d of out) counts[d.state]++;
    counts['app-only'] = appOnly.length;

    const row = usedRow(person);
    const e = person.columnE;
    const sheet = row && e ? {
        allowance: row.printed.allowance, carriedForward: row.printed.carriedForward, used: row.printed.used,
        columnE: row.printed.columnE, remaining: row.printed.remaining,
        corrected: person.corrected?.remaining ?? row.printed.remaining,
        undated: e.lump + e.unexplained, joinerReduction: e.joinerReduction,
    } : null;
    const position = alPosition({ overrides: mine, member, year, todayStr });
    // What the sheet allows, set against the app: the joiner's reduction in column E comes off the
    // printed allowance, and the days carried forward go on (AL_WORKBOOK.md §5).
    const allowanceDiffers = !!sheet && position.entitlement !== null
        && sheet.carriedForward + sheet.allowance - sheet.joinerReduction !== position.entitlement;
    const needsALook = allowanceDiffers || appOnly.length > 0 || NEEDS_A_LOOK.some(s => counts[s] > 0);
    return { name: person.name, grade: person.grade, sheet, app: position, allowanceDiffers, days: out, appOnly, counts,
             needsALook, otherRows: Math.max(0, (person.sheetRows?.length ?? 0) - 1) };
}

/**
 * What one day of sheet leave is in the app.
 * @param {{ member: any, date: string, ov: any, winners: Map<string, any>, chargedTo: number }} a
 * @returns {string}
 */
function leaveDayState({ member, date, ov, winners, chargedTo }) {
    // Before the start date the app shows and counts NOTHING, whatever is stored there: the Calendar,
    // Team Week and the pay suggestions all suppress a record dated before it (`isBeforeMemberStart`),
    // and Admin refuses to save one. So a stray shift there is no difference the app shows — asked
    // first, for any record, rather than only for leave.
    if (isBeforeMemberStart(member, parseISODate(date))) return 'before-start';
    if (ov && ov.type === 'annual_leave') {
        if (!consumesEntitlement(member, date, winners)) return 'free-in-app';
        return leaveYearOf({ ...ov, date }) === chargedTo ? 'match' : 'other-year';
    }
    if (ov) return WORK_TYPES.has(ov.type) ? 'worked' : 'differs';
    // Nothing recorded: what WOULD booking it do? The Admin leave card's own answer (header).
    const p = projectAlBooking({ member, dates: [date], ovByDate: winners });
    if (p.asked.includes(date)) return 'rest-day';
    return 'not-in-app';
}

/**
 * The whole file against the app.
 * @param {{ file: any, members: any[], recordsByName: Map<string, any[]>, todayStr: string }} args
 * @returns {{ people: PersonComparison[], notChecked: Array<{ name: string, reason: string }>,
 *             notInFile: Array<{ name: string, reason: string }>, absent: string[],
 *             totals: Record<string, number> }}
 */
export function compareLeaveFile({ file, members, recordsByName, todayStr }) {
    const byName = new Map(members.map(m => [m.name, m]));
    /** @type {Map<string, any[]>} */ const daysByName = new Map();
    for (const d of file.days) daysByName.set(d.name, [...(daysByName.get(d.name) ?? []), d]);

    /** @type {PersonComparison[]} */ const people = [];
    /** @type {Array<{ name: string, reason: string }>} */ const notChecked = [];
    for (const person of file.people) {
        const member = byName.get(person.name);
        const reason = leaveRecordability(member, file.year);
        if (reason) { notChecked.push({ name: person.name, reason }); continue; }
        people.push(comparePerson({ person, days: daysByName.get(person.name) ?? [], member,
            records: recordsByName.get(person.name) ?? [], year: file.year, todayStr,
            firstDate: file.source.firstDate, lastDate: file.source.lastDate }));
    }
    // Needs-a-look first, each group by name — the order the card shows them in.
    people.sort((a, b) => Number(b.needsALook) - Number(a.needsALook) || a.name.localeCompare(b.name));

    // In the app and nowhere in the file: what the file says, plus anybody added to the roster since.
    const listed = new Set([...file.people.map((/** @type {any} */ p) => p.name), ...file.notImported.map((/** @type {any} */ n) => n.name)]);
    const absent = new Set(file.absentFromWorkbook);
    for (const m of members) if (!listed.has(m.name) && leaveRecordability(m, file.year) === null) absent.add(m.name);

    /** @type {Record<string, number>} */ const totals = Object.fromEntries([...DAY_STATES, 'app-only'].map(s => [s, 0]));
    for (const p of people) for (const [k, v] of Object.entries(p.counts)) totals[k] += v;
    totals.people = people.length;
    totals.needsALook = people.filter(p => p.needsALook).length;
    return { people, notChecked, notInFile: [...file.notImported], absent: [...absent].sort(), totals };
}
