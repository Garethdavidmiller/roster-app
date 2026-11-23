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
 * swapped working day?" about (al-leave-compare.test.mjs pins the two together), and a recorded rest
 * day is asked about only where Admin would ask too. Where a person stands is `alPosition`, the
 * figure the Admin banner and the Calendar's leave panel read, and what the app SHOWS on a day is
 * `resolveDayShift`, the one function every surface that draws a day calls.
 *
 * ── WHAT EACH STATE MEANS ───────────────────────────────────────────────────────────────────────
 *
 * For a day of leave on the sheet (every `leave` day, counted by the sheet or not — a misspelt day
 * is still that person's leave, owner 14 Nov 2026):
 *
 *   match         the app holds leave there, it costs a day, and from the same year's allowance
 *   not-in-app    nothing recorded, and the pattern has them working: the app is a day short
 *   rest-day      nothing recorded, on a rest day — Admin would ask whether it was a swapped day
 *   free-in-app   leave recorded, but costing nothing (a rest day; asked about only where Admin asks)
 *   spare-week    leave recorded on a Spare day past its week's four, costing nothing (owner, 21 Nov
 *                 2026) — an explained difference, so not one that needs a look; whether the sheet books
 *                 such a day at all is AL_WORKBOOK.md §10 question 17
 *   other-year    leave that costs a day, charged to the other year's allowance (leave-year.js)
 *   carried       an other-year day the sheet pays for with a day carried forward (below)
 *   differs       a shift, an absence or a rest day recorded there instead
 *   worked        RDW, an Other day or a Spare turn recorded there — work, and pay evidence
 *   before-start  before the member's start date, where the app shows and counts nothing
 *
 * And for a Sunday the sheet marks (`sunday-tag`, or a plain name it counts): `sunday`, with what
 * the app shows and what the pattern says, because a tagged Sunday on a rostered shift is a day the
 * member was away from work that neither side can record as leave (AL_WORKBOOK.md §4).
 *
 * App-only leave — leave the app holds on a date the sheet does not have — comes from a separate
 * pass over the member's records: a loop over the sheet's days can never find it. Leave the app
 * takes from this year's allowance AFTER the sheet's last date is a third list, `beyond`. A day of
 * NEXT January that the app leaves on its own year is next year's leave, for next year's sheet: it
 * is not this sheet's to hold, so it is no difference here (review, 15 Nov 2026 — every member who
 * booked January leave in December was put under "Needs a look" by it).
 *
 * ── "AGREE" MEANS THE FIGURES AGREE ─────────────────────────────────────────────────────────────
 *
 * The first cut filed a person under "Agree" whenever no DAY differed, so two figures that plainly
 * disagreed on the same closed row — an undated over-quota day, a moved January day after the sheet
 * ends — read as agreement (review, 14 Nov 2026). The gap between the sheet's corrected figure and
 * the app's is the sum of the reasons below, every one a chip on the closed row: the allowance, the
 * day states in NEEDS_A_LOOK, app-only leave (the days of it that cost this year are its share of the
 * gap), `beyond`, and the sheet's undated days. So a person needs a look whenever any reason is present — and, as a safety net for a cause
 * this module does not know, whenever the figures differ at all (`counts.figures`).
 *
 * THE CARRY-OVER IS AN EXPLAINED DIFFERENCE (AL_WORKBOOK.md §9). The sheet adds days carried forward
 * from last year to this year's allowance and counts the January days in this year; the app takes
 * the same January days from LAST year's allowance (leave-year.js). The two leave the same figure, so
 * as many moved-back days as the sheet carries are `carried`, not `other-year`, and come off the
 * sheet's allowance before the two allowances are compared.
 *
 * Pure: no DOM, no Firebase. The records arrive as plain objects, one member's at a time.
 */

import { getBaseShift, parseISODate, isSunday, isOtherStaff } from './roster-data.js';
import { shouldReplaceOverride, isBeforeMemberStart, isOverrideDisplaySuppressed, isChristmasOrBoxingDay } from './override-utils.js';
import { consumesEntitlement, costsWithoutSpareCap, alPosition, entitlementFor, entitlementNote, countedAlDates } from './al-entitlement.js';
import { projectAlBooking } from './admin-al-projection.js';
import { isChristmasClosureDate, isChristmasLeaveDay, resolveDayShift } from './christmas-leave.js';
import { leaveYearOf } from './leave-year.js';
import { usedRow } from './al-leave-file.js';

/** The states a sheet day can be in, in the order the card lists them. */
export const DAY_STATES = Object.freeze(['not-in-app', 'rest-day', 'free-in-app', 'other-year', 'differs', 'worked',
    'before-start', 'carried', 'match', 'spare-week', 'sunday']);
/** The day states that need somebody to look: every one where the sheet and the app count the day differently. */
export const NEEDS_A_LOOK = Object.freeze(['not-in-app', 'rest-day', 'free-in-app', 'other-year', 'differs', 'worked',
    'before-start']);
/** Every count a person (and the whole file) carries: the day states, then the reasons that are not days. */
export const COUNT_KEYS = Object.freeze([...DAY_STATES, 'app-only', 'beyond', 'undated', 'figures']);
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
    const allowance = entitlementFor(member, year);
    // Management is hidden as well, so it is asked first: a manager is not a leaver. And the YEAR
    // decides, not today's grade (owner, 16 Nov 2026: "role at the time"): a member who moved into
    // Management keeps the allowance of the graded post they held that year (`allowanceRole`), so that
    // year's leave is checked like anybody's. Only a year with no figure on record is a manager's.
    if (member.managerOnly || member.role === 'Management') return allowance === null ? 'manager' : null;
    // An Other Staff login is hidden too, and is not a leaver: the app holds no leave allowance for them.
    if (isOtherStaff(member)) return 'no-allowance';
    if (member.hidden) return 'leaver';
    if (allowance === null) return 'no-allowance';
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
 * @typedef {{ shift: string, rdwTime: string, fromPattern: boolean, type: string|null }} DrawnDay
 *   what the Calendar draws: `resolveDayShift`'s shift and time, whether that is the pattern itself
 *   (no record, or one no surface shows), and the type of the record it shows
 * @typedef {{ date: string, kind: string, foundIn: string, countedBySheet: boolean, state: string,
 *             app: { type: string, value: string, source: string|null }|null, pattern: string,
 *             drawn: DrawnDay, appYear: number|null, swapQuestion: boolean }} DayComparison
 *   `appYear` is the year whose allowance the app takes the day from (null when it costs nothing);
 *   `swapQuestion` is true where the Admin leave card would ask "was it a swapped working day?"
 * @typedef {{ name: string, grade: string, sheet: { allowance: number, carriedForward: number, used: number,
 *             columnE: number, remaining: number, corrected: number, undated: number, joinerReduction: number }|null,
 *             app: { entitlement: number|null, taken: number, booked: number, remaining: number|null, note: string|null },
 *             allowanceDiffers: boolean, carried: number, days: DayComparison[],
 *             appOnly: Array<{ date: string, chargedTo: number|null, source: string|null }>, beyond: string[],
 *             counts: Record<string, number>, figuresGap: number, needsALook: boolean, otherRows: number,
 *             otherCarry: number[] }} PersonComparison
 *   `app.note` is the app's own word on its allowance (`entitlementNote`); `figuresGap` is the sheet's
 *   corrected figure less the app's, 0 when either is missing
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
        const day = parseISODate(d.date);
        const pattern = getBaseShift(member, day);
        const drawn = drawnDay({ member, day, date: d.date, ov, pattern });
        /** @type {{ state: string, appYear: number|null, swapQuestion: boolean }} */ let s;
        if (d.kind !== 'leave') {
            s = { state: 'sunday', appYear: null, swapQuestion: false };
        } else {
            sheetLeave.add(d.date);
            s = leaveDayState({ member, date: d.date, ov, winners, chargedTo: d.leaveYear ?? year });
        }
        out.push({ date: d.date, kind: d.kind, foundIn: d.foundIn, countedBySheet: d.countedBySheet, ...s, app, pattern, drawn });
    }
    // The carry-over (header): the earliest moved-back days first, as many as the sheet carries.
    const row = usedRow(person);
    const carriedForward = row?.printed.carriedForward ?? 0;
    let carried = 0;
    for (const d of out) {
        if (carried >= carriedForward) break;
        if (d.state === 'other-year' && d.appYear === year - 1) { d.state = 'carried'; carried++; }
    }

    // Leave the app holds that the sheet does not — the pass a loop over the sheet can never make.
    // A record no surface SHOWS is left out: leave on a Sunday (display layer 5,
    // `isOverrideDisplaySuppressed`) or before the start date. Neither costs anything or appears
    // anywhere, so listing one put a person under "Needs a look" for a record nobody could find.
    // Nor Christmas Day or Boxing Day: the sheet marks both Closed and never counts them, and from
    // 2026 the app never counts leave there either (`isChristmasClosureDate`) — a stored record there
    // was listed while the same leave shown from the pattern was not (review, 14 Nov 2026).
    const appOnly = [];
    for (const [date, w] of [...winners].sort(([a], [b]) => a.localeCompare(b))) {
        if (w.type !== 'annual_leave' || date < firstDate || date > lastDate || sheetLeave.has(date)) continue;
        const day = parseISODate(date);
        if (isBeforeMemberStart(member, day) || isOverrideDisplaySuppressed(w, getBaseShift(member, day), isSunday(date), isChristmasOrBoxingDay(date))) continue;
        if (isChristmasClosureDate(date)) continue;
        // Next January belongs here only when the app takes it from THIS year (header).
        if (date > `${year}-12-31` && leaveYearOf({ ...w, date }) !== year) continue;
        // WHICH year's allowance it costs, not only whether: a this-January day moved back costs last
        // year a day, and "costs nothing" would say otherwise (review, 14 Nov 2026).
        appOnly.push({ date, chargedTo: consumesEntitlement(member, date, winners) ? leaveYearOf({ ...w, date }) : null,
                       source: w.source ?? null });
    }
    // Leave the app takes from this year's allowance after the sheet's last date — a January day
    // moved back (leave-year.js). The sheet cannot hold it, and `alPosition` counts it, so it is part
    // of the gap between the two figures and is listed on its own. The app's own count decides it.
    const beyond = [...countedAlDates({ overrides: mine, member, year })].filter(d => d > lastDate).sort();

    const e = person.columnE;
    const sheet = row && e ? {
        allowance: row.printed.allowance, carriedForward: row.printed.carriedForward, used: row.printed.used,
        columnE: row.printed.columnE, remaining: row.printed.remaining,
        corrected: person.corrected?.remaining ?? row.printed.remaining,
        undated: e.lump + e.unexplained, joinerReduction: e.joinerReduction,
    } : null;
    const position = alPosition({ overrides: mine, member, year, todayStr });
    // What the sheet allows, set against the app: the joiner's reduction in column E comes off the
    // printed allowance, the days carried forward go on (AL_WORKBOOK.md §5) — less the ones already
    // explained by the carry-over above.
    const allowanceDiffers = !!sheet && position.entitlement !== null
        && sheet.carriedForward - carried + sheet.allowance - sheet.joinerReduction !== position.entitlement;

    /** @type {Record<string, number>} */ const counts = Object.fromEntries(COUNT_KEYS.map(s => [s, 0]));
    for (const d of out) counts[d.state]++;
    counts['app-only'] = appOnly.length;
    counts.beyond = beyond.length;
    counts.undated = sheet?.undated ?? 0;
    const reasons = allowanceDiffers || counts['app-only'] > 0 || counts.beyond > 0 || counts.undated > 0
        || NEEDS_A_LOOK.some(s => counts[s] > 0);
    // The safety net (header): the two figures differ and no reason above says why.
    const figuresGap = sheet && position.remaining !== null ? sheet.corrected - position.remaining : 0;
    // …except a gap the Spare week's rule explains (21 Nov 2026): the sheet charges a day the app leaves
    // free past the week's four, so the sheet's balance is lower by exactly those days. The days are
    // still listed, and the summary names them for the clerks (AL_WORKBOOK.md §10 question 17).
    const spareExplained = out.filter(d => d.state === 'spare-week' && d.countedBySheet).length;
    counts.figures = !reasons && figuresGap !== 0 && figuresGap !== -spareExplained ? 1 : 0;
    return { name: person.name, grade: person.grade, sheet,
             app: { ...position, note: entitlementNote({ member, year, overrides: mine }) },
             allowanceDiffers, carried, days: out, appOnly, beyond, counts, figuresGap,
             needsALook: reasons || counts.figures > 0, otherRows: Math.max(0, (person.sheetRows?.length ?? 0) - 1),
             // Each other row of theirs that carries a different number of days forward: the row used
             // here may have lost them, and only the clerks can say which is right (review, 15 Nov 2026).
             otherCarry: (person.sheetRows ?? []).filter((/** @type {any} */ r) => r && r !== row && r.printed
                 && r.printed.carriedForward !== (row?.printed?.carriedForward ?? 0)).map((/** @type {any} */ r) => r.printed.carriedForward) };
}

/**
 * What the Calendar DRAWS on a day — every surface asks `resolveDayShift`, so the card's words
 * describe what the admin will find there, not the stored record: leave or an absence on a Sunday,
 * and an absence on a rest day, are never drawn, and a timed shift on a Sunday is drawn as RDW.
 * Before the start date nothing is drawn but the pattern's rest day.
 * @param {{ member: any, day: Date, date: string, ov: any, pattern: string }} a
 * @returns {DrawnDay}
 */
function drawnDay({ member, day, date, ov, pattern }) {
    const sunday = isSunday(date);
    const before = isBeforeMemberStart(member, day);
    const xmas = isChristmasOrBoxingDay(date);
    const r = resolveDayShift(before ? null : ov, pattern, sunday, isChristmasLeaveDay(member, day), xmas);
    const shown = !before && !!ov && !isOverrideDisplaySuppressed(ov, pattern, sunday, xmas);
    return { shift: r.shift, rdwTime: r.rdwTime, fromPattern: !shown && !r.christmasLeave, type: shown ? String(ov.type ?? '') : null };
}

/**
 * What one day of sheet leave is in the app.
 * @param {{ member: any, date: string, ov: any, winners: Map<string, any>, chargedTo: number }} a
 * @returns {{ state: string, appYear: number|null, swapQuestion: boolean }}
 */
function leaveDayState({ member, date, ov, winners, chargedTo }) {
    // Before the start date the app shows and counts NOTHING, whatever is stored there: the Calendar,
    // Team Week and the pay suggestions all suppress a record dated before it (`isBeforeMemberStart`),
    // and Admin refuses to save one. So a stray shift there is no difference the app shows — asked
    // first, for any record, rather than only for leave.
    if (isBeforeMemberStart(member, parseISODate(date))) return { state: 'before-start', appYear: null, swapQuestion: false };
    // Would the Admin leave card ask "was it a swapped working day?" — its own answer, asked of a day
    // holding leave as much as an empty one. Leave over a correction, RDW, or an Other day or Spare turn
    // on a rest day is settled by its record, and Admin never asks about it (review, 14 Nov 2026).
    const asks = () => projectAlBooking({ member, dates: [date], ovByDate: winners }).asked.includes(date);
    if (ov && ov.type === 'annual_leave') {
        if (!consumesEntitlement(member, date, winners)) {
            // Free because a Spare week's four is spent, not because it is a rest day (review, 21 Nov 2026):
            // it was told "recorded over a rest day" and put the person under "needs a look".
            if (costsWithoutSpareCap(member, date, winners)) return { state: 'spare-week', appYear: null, swapQuestion: false };
            return { state: 'free-in-app', appYear: null, swapQuestion: asks() };
        }
        const appYear = leaveYearOf({ ...ov, date });
        return { state: appYear === chargedTo ? 'match' : 'other-year', appYear, swapQuestion: false };
    }
    if (ov) return { state: WORK_TYPES.has(ov.type) ? 'worked' : 'differs', appYear: null, swapQuestion: false };
    // Nothing recorded: what WOULD booking it do? The Admin leave card's own answer (header).
    if (asks()) return { state: 'rest-day', appYear: null, swapQuestion: true };
    return { state: 'not-in-app', appYear: null, swapQuestion: false };
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

    // The file's own lists say what the roster was when the file was made, so each is asked again of
    // TODAY's roster, as the people compared are (review, 14 Nov 2026). "In the app, not on the sheet"
    // keeps only those the app can still record leave for, plus anybody added to the roster since; a
    // person left out of the file is shown with why they would be left out now — and one the app
    // could compare today, but whose days the file does not carry, as `since`.
    const listed = new Set([...file.people.map((/** @type {any} */ p) => p.name), ...file.notImported.map((/** @type {any} */ n) => n.name)]);
    const recordable = (/** @type {string} */ n) => leaveRecordability(byName.get(n), file.year) === null;
    const absent = new Set(file.absentFromWorkbook.filter(recordable));
    for (const m of members) if (!listed.has(m.name) && leaveRecordability(m, file.year) === null) absent.add(m.name);
    const notInFile = file.notImported.map((/** @type {any} */ n) => ({
        name: n.name, reason: leaveRecordability(byName.get(n.name), file.year) ?? 'since' }));

    /** @type {Record<string, number>} */ const totals = Object.fromEntries(COUNT_KEYS.map(s => [s, 0]));
    for (const p of people) for (const [k, v] of Object.entries(p.counts)) totals[k] += v;
    totals.people = people.length;
    totals.needsALook = people.filter(p => p.needsALook).length;
    return { people, notChecked, notInFile, absent: [...absent].sort(), totals };
}
