// THE 26-LINE LINK, STATED ONCE (1 Oct 2026). Every script in this folder reads the line count, the cover weeks and the
// contract from here, so a change to any of them is one edit, not a sweep. The 24-line tooling this was copied from
// (`../../links-24/tooling/`) wrote "24" and "four cover weeks" into a dozen files; that is what this file replaces.
// The rules themselves are `../RULES.md` (owner, 1 Oct 2026). The Links page's own `ROTATING_LINES` (links-design.js)
// is still 24 until its own release, which is why every app function here is passed LINES rather than left to default.
import { startMinutes, endMinutes, DAYS } from '../../../links-design.js';

export const LINES = 26;
export const COVER_WEEKS = 5;
export const WORKING_LINES = LINES - COVER_WEEKS;                 // 21
export const CONTRACT_MINUTES = WORKING_LINES * 35 * 60;           // 44,100 Monday-to-Saturday minutes a week
// contracted days a year, today's figure (RULES.md). DAYS_CEILING=<n> in the environment judges against another ceiling,
// for the owner's what-if of 2 Oct 2026 ("what if we said 217 was the maximum"); unset, every sheet is judged at 219.
export const DAYS_CEILING = Number(process.env.DAYS_CEILING ?? 219);
/** A default placement for a new design: as even as 26 allows (gaps 5, 5, 5, 5, 6). */
export const COVER_LINES = [1, 6, 11, 16, 21];
/** The headcounts the duty tables are built to: fourteen on a Saturday (F1), ten on a Sunday (S4), and the weekday
 *  figure the days ceiling leaves: 89 Mon–Sat duties at most, 14 of them Saturday's, so 15 a weekday. */
export const HEADS = { weekday: 15, sat: 14, sun: 10 };

const timed = s => !!s && s !== 'RD' && s !== 'SPARE' && s !== 'OFF' && startMinutes(s) !== null;
/** Contracted days a year: Monday to Saturday, a cover week counted as four days, Sunday left out (it is overtime). */
export function daysAYear(p) {
  const keys = Object.keys(p); let duties = 0, cover = 0;
  for (const k of keys) { const r = p[k]; if (DAYS.every(d => r[d] === 'SPARE')) { cover++; continue; }
    for (const d of DAYS) if (d !== 'sun' && timed(r[d])) duties++; }
  return (duties + 4 * cover) / keys.length * 365 / 7;
}
/** The cover lines of a design, and whether they are as evenly spread as the link allows: gaps differing by one at most. */
export function coverSpread(p) {
  const keys = Object.keys(p).sort((a, b) => a - b), L = keys.length;
  const at = keys.filter(k => DAYS.every(d => p[k][d] === 'SPARE')).map(Number);
  const gaps = at.map((l, i) => i < at.length - 1 ? at[i + 1] - l : at[0] + L - l);
  return { lines: at, gaps, even: at.length > 0 && Math.max(...gaps) - Math.min(...gaps) <= 1 };
}
/** Monday-to-Saturday duty minutes, the figure the contract fixes at CONTRACT_MINUTES. */
export function monSatMinutes(p) {
  let m = 0; for (const r of Object.values(p)) for (const d of DAYS) if (d !== 'sun' && timed(r[d])) m += (endMinutes(r[d]) - startMinutes(r[d]) + 1440) % 1440;
  return m;
}
