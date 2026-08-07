// @ts-check
/**
 * links-seed.js — the generator's TARGET SEED: read the roster people actually work, and produce
 * the shift-slot targets the auto-generator starts from (extracted from links-app.js, v19.92).
 *
 * ── WHY THIS IS ITS OWN MODULE ─────────────────────────────────────────────────────────────────
 *
 * It was already a pure function. It read imported roster constants, touched no DOM, no Firestore
 * and no coordinator state — and it still could not be unit-tested, for the single reason that it
 * was not exported. `.claude/rules/links-design.md` and `e2e/pages.spec.js` both said so out loud,
 * as a justification for covering it with an e2e instead:
 *
 *     "Pinned by an e2e that drives `↺ Reset targets from current roster`, because the seed lives
 *      in the coordinator and a unit test would be checking its own copy of it."
 *
 * That objection is real and it is entirely self-inflicted. A unit test would have been checking
 * its own copy because there was nothing else to check. Exported, there is.
 *
 * ── THE BUG THIS EXISTS TO STOP HAPPENING AGAIN ────────────────────────────────────────────────
 *
 * v19.59: the seed sampled the main roster's 20 weeks plus only the TWO bilingual weeks the two
 * bilingual members happen to sit on, then applied that 22-line sample to a 28-line design.
 * Bilingual weeks 1 and 8 are the SPARE ones and were never sampled, so the seeded spare count came
 * back as **4** where the real combined roster has **6** — two whole lines of standby cover missing
 * from every design that started from the seed.
 *
 * It was silent because the part anyone would look at was right: the per-shift daily headcounts all
 * matched the roster. Only the count of whole spare LINES was wrong, and nothing displays that
 * beside its expected value.
 *
 * ── THE LATENT REPEAT, NOW FIXABLE ─────────────────────────────────────────────────────────────
 *
 * The coordinator version hardcoded the cycle lengths as `w <= 20` and `w <= 8`, while
 * `CONFIG.MAIN_ROSTER_WEEKS` and `CONFIG.BILINGUAL_ROSTER_WEEKS` sat in `roster-data.js` holding the
 * same two numbers. A roster changing length would have left the seed sampling a prefix of it —
 * under-counting slots and spare lines in exactly the v19.59 shape, silently, again. The lengths are
 * now READ from CONFIG and a test pins that they are.
 *
 * ── THE ONE DESIGN DECISION ────────────────────────────────────────────────────────────────────
 *
 * `buildRosterTargets` takes its sources as an argument, defaulting to `rosterSeedLines()`. That is
 * what keeps the module honest: the two halves are separately testable — which LINES get sampled
 * (the v19.59 bug) and what is COUNTED from them — while the default is the real roster, so a test
 * of the whole thing is testing what the page actually runs and not a fixture standing in for it.
 * Splitting them the other way round, or injecting from the call site, would move the source
 * selection back out of reach and reinstate the gap this extraction closes.
 */

import { CONFIG, weeklyRoster, bilingualRoster } from './roster-data.js';
import { DAYS, dayClass } from './links-design.js';

/** Values that mean "this line is not working a timed duty on this day". */
const NOT_A_DUTY = new Set(['RD', 'OFF', 'SPARE']);

/**
 * The roster lines the seed samples: the WHOLE main cycle followed by the WHOLE bilingual cycle.
 *
 * Both in full, and that is the v19.59 correction. A 28-line design is 28 because it is main plus
 * bilingual, so the seed has to be main plus bilingual too — which weeks any two people happen to
 * sit on today is a fact about staffing, not about the roster's shape.
 *
 * Lengths come from CONFIG rather than literals, so a cycle that changes length cannot leave this
 * reading a prefix of it.
 *
 * @returns {Array<Record<string, string>|undefined>} one entry per line, in cycle order
 */
export function rosterSeedLines() {
    const main = /** @type {Record<number, any>} */ (weeklyRoster);
    const bili = /** @type {Record<number, any>} */ (bilingualRoster);
    const out = [];
    for (let w = 1; w <= CONFIG.MAIN_ROSTER_WEEKS; w++) out.push(main[w]);
    for (let w = 1; w <= CONFIG.BILINGUAL_ROSTER_WEEKS; w++) out.push(bili[w]);
    return out;
}

/**
 * Build the generator's target table from roster lines.
 *
 * One slot per distinct start time, carrying separate Mon–Fri / Sat / Sun headcounts, plus the count
 * of whole SPARE lines.
 *
 * Two things that look like details and are not:
 *
 * **The weekday figure is the BUSIEST Mon–Fri day for that time, not the average.** Some shifts only
 * run Tue/Thu/Fri, and the generator then staffs all five weekdays at that level. Deliberate —
 * under-staffing a day is the worse error — which is why the table's column header says
 * `busiest day` rather than implying the roster is flat across the week.
 *
 * **Spare is counted in whole LINES, never per day.** A spare line is spare on all seven days
 * because the person is cover for the week, and the real roster has no scattered spare days at all.
 * Counting spare days and dividing would produce the right total from the wrong model, which is
 * precisely how the v19.58 per-day spare headcount survived review.
 *
 * @param {Array<Record<string, string>|undefined>} [sources] roster lines; defaults to the real roster
 * @returns {{ slots: Array<{time: string, weekday: number, sat: number, sun: number}>, spareLines: number }}
 */
export function buildRosterTargets(sources = rosterSeedLines()) {
    const weekdays = DAYS.filter(d => dayClass(d) === 'weekday');

    /** @type {Record<string, Record<string, number>>} */
    const perDay = {};
    for (const src of sources) {
        for (const d of DAYS) {
            const s = src?.[d];
            if (!s || NOT_A_DUTY.has(s)) continue;
            perDay[s] = perDay[s] || /** @type {Record<string, number>} */ (
                Object.fromEntries(DAYS.map(x => [x, 0])));
            perDay[s][d]++;
        }
    }

    const slots = Object.keys(perDay).sort().map(time => ({
        time,
        weekday: Math.max(...weekdays.map(d => perDay[time][d])),
        sat:     perDay[time].sat,
        sun:     perDay[time].sun,
    }));

    // Every fully-spare source line is one spare WEEK, so counting them gives the number directly.
    const spareLines = sources.filter(src => src && DAYS.every(d => src[d] === 'SPARE')).length;

    return { slots, spareLines };
}
