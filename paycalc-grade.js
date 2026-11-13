// @ts-check
// ============================================
// A PAYSLIP'S GRADE — which grade each of its days was worked under
// ============================================
//
// The Pay Calculator used to hold ONE grade for a member, so a promotion re-priced every payslip they
// had ever had at the new grade's rates, and a payslip that SPANNED the change could be right for
// neither side. A grade now has a date (`roleHistory`, read by roster-roles.js), and this module turns
// that into what a payslip needs: the grades its 28 days were worked under, with the days on each.
//
//   gradeDays(member, p, setting)  → [{ grade, days }]   the payslip's days, by grade
//   byDays(parts, valueOf)         → one figure for the payslip, each grade's figure weighted by its days
//   settingFromLegacy(...)         → what a device's pre-dated saved grade becomes (one migration)
//   windowGrade(parts)             → the grade an award's backdated months were worked under
//   gradeSplitLine(...)            → the sentence the changeover payslip carries under its rate
//   rosterStretches(member, a, b)  → the roster's grades over a span, each with its first and last day
//   rosterGradeLine(stretches)     → those in words, under the Grade box
//   gradeChangeNote(stretches, d)  → the one-time line for a member whose grade changes on the roster
//
// THE SETTING. `grade` is 'roster' (the default: follow the roster's dated grades) or a grade the
// member chose themselves ('cea' | 'ces'), which covers every payslip from `from` (a period number)
// on; the payslips before it still follow the roster. A manual grade is for what the roster cannot
// know — acting up, or a roster row not yet corrected — and it applies to WHOLE payslips: only the
// roster's own dates split one.
//
// BY DAYS, NOT BY SHIFTS (owner decision, 13 Nov 2026). A payslip that spans a change of grade is
// priced at each grade's rate weighted by the days on each side: 7 days as a CEA and 21 as a CES is
// (7 × £21.49 + 21 × £22.60) / 28 = £22.3225 an hour. For the contracted hours that is exactly what
// paying each day at its own grade gives (35h + 105h of the 140); for premium hours it is an
// estimate, because hours are stored per PAYSLIP and nothing finer says which side of the change a
// Saturday fell on — the back-pay card's first-period fraction makes the same choice for the same
// reason (paycalc.md → "THE FIRST PERIOD IS A FRACTION"). Inventing a split would look more precise
// and be less true. VALIDATION_REGISTER.md holds the row to confirm against the real payslip.
//
// ONE FIGURE, EXACTLY, WHEN THE GRADES AGREE. `byDays` returns the shared value itself whenever every
// part has the same figure — every payslip of a member who never changed grade — so nothing that was
// priced before this module existed moves by a rounding error. Pure: no DOM, no storage.

import { GRADES } from './paycalc-calc.js';
import { gradeForRole } from './roster-data.js';
import { rolesInRange } from './roster-roles.js';
import { formatWeekdayDate, formatDayMonthYear } from './date-format.js';

/** The setting's value for "follow the roster's dated grades". */
export const FROM_ROSTER = 'roster';

/** @typedef {{ grade: string, from: number }} GradeSetting  grade: 'roster' | 'cea' | 'ces'; from: the first payslip (p.num) a chosen grade covers */
/** @typedef {{ grade: string|null, days: number }} GradePart  grade: 'cea' | 'ces', or null for days under a role with no confirmed rates */

/** Whole calendar days from `a` to `b`, both inclusive, read from LOCAL dates. @param {Date} a @param {Date} b */
function spanDays(a, b) {
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
    - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000) + 1;
}

/**
 * The grades a payslip's days were worked under, in order, each with its days (28 in all for a full
 * payslip). A chosen grade covers the whole payslip from its `from` on; otherwise the roster's dated
 * grades (`rolesInRange`) decide, day by day, and a role this app has no rates for comes back as
 * `grade: null` — it is never priced as something else (paycalc.md invariant 13).
 * @param {any} member  teamMembers entry, or null when nobody is signed in
 * @param {any} p       a period from getPeriods() — `{ num, start, cutoff }`
 * @param {GradeSetting|null|undefined} setting
 * @returns {GradePart[]}  [] without a period, or — when the roster decides — without a member or
 *   the period's dates (a bare `{ payday }` asks no question the roster can answer)
 */
export function gradeDays(member, p, setting) {
  if (!p) return [];
  const dated = p.start instanceof Date && p.cutoff instanceof Date;
  if (setting && setting.grade !== FROM_ROSTER && GRADES[setting.grade] && (p.num ?? Infinity) >= (setting.from || 0)) {
    return [{ grade: setting.grade, days: dated ? spanDays(p.start, p.cutoff) : 28 }];
  }
  if (!member || !dated) return [];
  /** @type {GradePart[]} */
  const out = [];
  for (const { role, days } of rolesInRange(member, p.start, p.cutoff)) {
    const grade = gradeForRole(role);
    const tail = out[out.length - 1];
    if (tail && tail.grade === grade) tail.days += days;   // two roles with no rates are one unpriced stretch
    else out.push({ grade, days });
  }
  return out;
}

/**
 * One figure for a payslip: each grade's figure weighted by its days. When every part has the same
 * figure — every payslip of a member who never changed grade, and the contracted hours, which both
 * grades share — that figure comes back ITSELF, not recomputed, so it is exact. null when there are
 * no days, or when any part has no figure (a day under a role with no rates is never guessed).
 * @param {GradePart[]} parts
 * @param {(grade: string) => number|null|undefined} valueOf
 * @returns {number|null}
 */
export function byDays(parts, valueOf) {
  /** @type {Array<[number, number]>} */
  const priced = [];
  for (const { grade, days } of parts) {
    if (!(days > 0)) continue;
    const v = grade ? valueOf(grade) : null;
    if (v == null || !Number.isFinite(v)) return null;
    priced.push([v, days]);
  }
  if (!priced.length) return null;
  if (priced.every(([v]) => v === priced[0][0])) return priced[0][0];
  let total = 0, sum = 0;
  for (const [v, days] of priced) { total += days; sum += v * days; }
  return sum / total;
}

/**
 * What a grade saved before grades had dates becomes. That grade was written on a first visit from
 * the roster — or chosen by hand, and the two cannot be told apart from the value alone — so:
 *   - a grade the member KEPT over the roster's (the grade question's "Keep") was a choice: it stays,
 *     covering every payslip, exactly as before;
 *   - a grade the roster itself gives them on some day of the payslips they can see came from the
 *     roster: the roster takes over, dates and all — which is the whole point for a member promoted
 *     since (their earlier payslips stay on the old grade, the later ones move);
 *   - any other grade stays, covering every payslip, exactly as before — and the grade question asks
 *     about it as it always has.
 * Nothing saved (or nothing usable) is the roster's to decide.
 * @param {{ saved: string|null|undefined, kept: string|null|undefined, rosterGrades: Array<string|null>, firstNum: number }} o
 *   rosterGrades — the grades the roster gives the member over the payslips they can see;
 *   firstNum — the first of those payslips, where a kept grade starts
 * @returns {GradeSetting}
 */
export function settingFromLegacy({ saved, kept, rosterGrades, firstNum }) {
  if (!saved || !GRADES[saved]) return { grade: FROM_ROSTER, from: 0 };
  if (kept && GRADES[kept] && kept !== saved) return { grade: saved, from: firstNum };
  if (rosterGrades.includes(saved)) return { grade: FROM_ROSTER, from: 0 };
  return { grade: saved, from: firstNum };
}

/**
 * The grade an award's backdated months were worked under — the back-pay card prices one grade's
 * old and new rates. `mixed` is true when those months span a change of grade, which no member's
 * dates do today (paycalc-grade-wiring.test.mjs fails if one ever does): the card then prices the grade held
 * at the END of the window and its caller says so, rather than splitting a lump nobody has checked.
 * @param {GradePart[]} parts  every period of the window's parts, in order
 * @returns {{ grade: string|null, mixed: boolean }}
 */
export function windowGrade(parts) {
  const priced = parts.filter(x => x.grade && x.days > 0);
  if (!priced.length) return { grade: null, mixed: false };
  return {
    grade: /** @type {string} */ (priced[priced.length - 1].grade),
    mixed: new Set(priced.map(x => x.grade)).size > 1,
  };
}

/** The day `days` after `d`, at local midnight. @param {Date} d @param {number} days */
function dayAfter(d, days) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days); }

/** A calendar day as one comparable number (yyyymmdd), from the Date's LOCAL fields. @param {Date} d */
function dayKey(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }

/**
 * The line a payslip that spans a change of grade carries under its rate, or '' for any other:
 * "Your grade changed on Sun 22 Nov 2026, part-way through this payslip: 7 days at the CEA rate
 * (£21.49/hr) and 21 at the CES rate (£22.60/hr), so its hours are priced at £22.32/hr — the two
 * rates weighted by their days." The verb follows the date — "changes" while the day is still ahead
 * — and a payslip with more than one change names none of them, because one date would be wrong.
 * '' too when any of its days has no rate: those are never priced (byDays), so there is no blend to
 * explain.
 * @param {{ parts: GradePart[], rateOf: (grade: string) => number|null|undefined, start: Date, today: Date }} o
 *   start — the payslip's first day (p.start); today — the date the verb is read against
 * @returns {string}
 */
export function gradeSplitLine({ parts, rateOf, start, today }) {
  const counted = parts.filter(x => x.days > 0);
  if (counted.length < 2 || counted.some(x => !x.grade)) return '';
  const blended = byDays(counted, rateOf);
  if (blended == null) return '';
  const each = counted.map(({ grade, days }, i) => {
    const r = /** @type {number} */ (rateOf(/** @type {string} */ (grade)));
    return `${days}${i === 0 ? ` day${days === 1 ? '' : 's'}` : ''} at the ${String(grade).toUpperCase()} rate (£${r.toFixed(2)}/hr)`;
  });
  const list = `${each.slice(0, -1).join(', ')} and ${each[each.length - 1]}`;
  const when = counted.length === 2
    ? (() => {
        const on = dayAfter(start, counted[0].days);
        return `${dayKey(on) > dayKey(today) ? 'changes' : 'changed'} on ${formatWeekdayDate(on, true)}, part-way through this payslip`;
      })()
    : 'changed more than once during this payslip';
  return `Your grade ${when}: ${list}, so its hours are priced at £${blended.toFixed(2)}/hr — `
    + `the ${counted.length === 2 ? 'two ' : ''}rates weighted by their days.`;
}

/** @typedef {{ role: string|undefined, grade: string|null, from: Date, until: Date }} RosterStretch */

/**
 * The roster's grades over an inclusive span, in order, each with its first and last day (local
 * midnight) — `rolesInRange` with the dates put back. This DESCRIBES the roster, for the line under
 * the Grade box and the one-time note, so it keeps roles apart where pricing (`gradeDays`) merges by
 * pay grade. [] without a member or either date.
 * @param {any} member @param {Date} start @param {Date} end
 * @returns {RosterStretch[]}
 */
export function rosterStretches(member, start, end) {
  if (!member || !(start instanceof Date) || !(end instanceof Date)) return [];
  /** @type {RosterStretch[]} */
  const out = [];
  let from = dayAfter(start, 0);
  for (const { role, days } of rolesInRange(member, start, end)) {
    out.push({ role, grade: gradeForRole(role), from, until: dayAfter(from, days - 1) });
    from = dayAfter(from, days);
  }
  return out;
}

/**
 * What the roster says about the member's grade, in words, for the line under the Grade box:
 * "The roster lists you as CEA until 21 Nov 2026, then CES from 22 Nov 2026." — or, with no change in
 * the span, "The roster lists you as CES." '' when there is nothing to say.
 * @param {RosterStretch[]} stretches
 * @returns {string}
 */
export function rosterGradeLine(stretches) {
  const named = stretches.filter(x => x.role);
  if (!named.length) return '';
  if (named.length === 1) return `The roster lists you as ${named[0].role}.`;
  const words = named.map((x, i) =>
    i === 0 ? `${x.role} until ${formatDayMonthYear(x.until)}`
      : i === named.length - 1 ? `then ${x.role} from ${formatDayMonthYear(x.from)}`
        : `then ${x.role} from ${formatDayMonthYear(x.from)} until ${formatDayMonthYear(x.until)}`);
  return `The roster lists you as ${words.join(', ')}.`;
}

/**
 * The one-time line for a member whose roster grade changes within the payslips they can see — the
 * LATEST change between two grades this calculator has rates for — or null. `key` is the change's
 * first day as YYYY-MM-DD: the device remembers the change it was shown, so a later change is shown
 * in its turn. The verb follows the date, as in gradeSplitLine.
 * @param {RosterStretch[]} stretches
 * @param {Date} today
 * @returns {{ key: string, text: string }|null}
 */
export function gradeChangeNote(stretches, today) {
  for (let i = stretches.length - 1; i > 0; i--) {
    const before = stretches[i - 1], after = stretches[i];
    if (!before.grade || !after.grade || before.grade === after.grade) continue;
    const on = after.from;
    const key = `${on.getFullYear()}-${String(on.getMonth() + 1).padStart(2, '0')}-${String(on.getDate()).padStart(2, '0')}`;
    return {
      key,
      text: `Your grade on the roster ${dayKey(on) > dayKey(today) ? 'changes' : 'changed'} from ${before.role} to ${after.role} `
        + `on ${formatWeekdayDate(on, true)}. Each payslip is priced at the grade you held while you worked it, `
        + 'so there is nothing for you to change.',
    };
  }
  return null;
}
