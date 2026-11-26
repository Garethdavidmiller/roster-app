// @ts-check
/**
 * links-design.js — Pure link-design maths for links.html. No DOM, no Firebase.
 *
 * Owns: shift classification, custom-time validation, coverage counting
 *   (per-type and hour-by-hour), the rest between two duties (`restBetween`),
 *   and the design quality checks (weekends off, short turnarounds, longest
 *   stretch, balance).
 * Does NOT own: the auto-generator — `generateLink`, its two constructions and the
 *   rest repair are `links-generate.js`, which imports the constants from here; this
 *   one imports NOTHING, so it loads anywhere.
 * Edit here for: check thresholds, coverage maths, the hours maths.
 * Tested by links-design.test.mjs.
 *
 * ── THE RULES THAT MUST SURVIVE AN EDIT ────────────────────────────────────────────────────────
 *
 * The things a future edit can silently break (the release history is git):
 *
 * `ROTATING_LINES` is the ONE declaration of the rotation length. **Never write the number down** —
 * not in a module, not in prose, not in a `max` attribute: when the length moved twice the sweep found
 * it restated in ~15 places, each describing a link that does not exist.
 * `links-rotation-parity.test.mjs` fails on a literal; markup that cannot interpolate uses a
 * `.js-rotating-lines` span. A design SAVED at an older length is left alone — trimming on load or on
 * save destroys work — so `#linksOverLengthNotice` states that the surplus rows are neither shown nor
 * counted but are kept.
 *
 * `normalisePatterns` pads a legacy unpadded time on load so this module has ONE time format, and
 * `classifyShift` and `startMinutes` cannot disagree about what a time IS (`canonicaliseShift`).
 *
 * SPARE IS A WHOLE WEEK, not a per-day headcount. `spareLines` reserves whole lines spread around
 * the wheel (a per-day count scattered a person's standby days while the daily SP total stayed
 * correct). A spare week is **four** duties of seven (`SPARE_WORKED_DAYS`); counting it as seven let
 * one bridge the blocks either side and reported the live main roster at 15 consecutive worked days
 * against a true ceiling of 9.
 *
 * The generator's own rules — the WAVES, the merged waves, the fallback's `no-rest` refusal, the
 * interleave WON'T-DO and the exact-contract refusals — moved with it to `links-generate.js`'s header.
 *
 * `weeklyHours` reports **the mean week across the whole rotation**, and two rules govern it.
 * **Sundays come out**, because Sunday is not contracted for any grade here, so counting it towards
 * 35 reports a design as delivering contracted hours using time that is not — it FLATTERS. And
 * **a cover week counts as a full contracted week** (owner): it carries no stored times, a fact about
 * the notation, not about whether the week is worked and paid. The live main cycle comes to exactly 35.00.
 * A line with worked duties but no readable time is reported through `unreadableLines` /
 * `complete`, never silently dropped — see the note at that function.
 *
 * `endMinutesAbs` is the ONE reading of a duty that runs past midnight (inline copies erred towards
 * *safer than the truth*). Unreachable from the CEA link (`normaliseCustomShift` refuses a wrapping
 * value) — keep that ban. `dutyMinutes` lives here and is re-exported by links-fatigue.js: a second
 * copy is the exact failure `endMinutesAbs` was extracted to end.
 */

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * The rotation length. ONE declaration: every line rotates, so the grid height, the checks window
 * and the generator output are necessarily the SAME number.
 *
 * ── 28 → 22 → 24 → today's length (the December 2026 plan) ─────────────────────────────────────
 *
 * It was **28 = the main 20-week cycle + the bilingual 8**. The new link **excludes the bilingual
 * roster entirely** — not its lines, its shift times or its work. It is the CEA (main) roster
 * **widened from 20 to increase staffing levels**; the bilingual roster continues separately.
 *
 * The length then moved to 22, to **24** (owner — 22 was misremembered), and once more (owner,
 * 1 Oct 2026, with five cover weeks) to the length declared below, deliberately not written in this
 * comment: a comment giving the CURRENT length is one more copy to drift (links-design.md, invariant
 * 1). Each is a business figure with **no document behind it** — evidence class C by ROADMAP.md's
 * scale: fine as a design parameter, and it must NOT be rendered to a manager as a requirement
 * without a source. See KNOWN_LIMITATIONS.md → Links.
 *
 * The first move was a sweep of ~15 literals; the second was this line and a re-measure. Do not
 * re-introduce a literal — `links-rotation-parity.test.mjs` fails on one, including one that happens
 * to be right today.
 */
export const ROTATING_LINES = 26;

/** Minimum rest between two timed shifts on consecutive days, in minutes. */
export const MIN_REST_MINUTES = 12 * 60;

/**
 * A spare WEEK is FOUR worked days of seven (owner, Aug 2026) — you are marked SPARE on all seven
 * because you are available for cover, but four is what you work, unless a Sunday or other RDW is
 * added on top. The four are Monday to Saturday — see `spareDrawsOnFour`.
 */
export const SPARE_WORKED_DAYS = 4;

/**
 * Is this line a COVER WEEK — spare on every contracted day, Monday to Saturday?
 *
 * The Sunday is deliberately not asked about. It is not contracted, so a cover week's Sunday may be
 * SPARE, a rest day or a timed RDW and the week is still four days of cover — requiring all seven
 * SPARE counted such a week as an EMPTY line, so a design over the 219-day ceiling read as under it.
 * Hours, days, spread and the roster seed ask this; the rest repair protects all-SPARE rows only.
 * @param {Record<string, any>|null|undefined} row
 * @returns {boolean}
 */
export function isCoverWeek(row) {
    return !!row && DAYS.every(d => d === 'sun' || row[d] === 'SPARE');
}

/**
 * Does a SPARE day at position `i` of a run sequence draw on its cover week's four duties?
 *
 * Monday to Saturday only (owner, 31 Oct 2026): "The 4 days can only be the contractual days which
 * are Monday to Saturday." Sunday is contracted for no grade here, so a cover week's Sunday is never
 * one of its four — but it can still be worked, as rest-day working ON TOP of them ("people could be
 * rostered for RDW on a Sunday cover week"). A worst-case scan therefore counts a spare Sunday as
 * worked without spending the week's four.
 *
 * This agrees with `links-limits.js`'s contracted days a year, and does not understate a run that
 * enters a cover week: the Sunday's overtime and four duties from the Monday is five days in a row.
 *
 * @param {number} i - index into a run sequence, SEVEN PER LINE in `DAYS` order
 */
export function spareDrawsOnFour(i) {
    return DAYS[i % 7] !== 'sun';
}

/**
 * The most consecutive worked days a link should ask anyone to do — the owner's DESIGN TARGET
 * (Aug 2026), not a limit anybody imposes.
 *
 * **One number, read in two places**: the generator builds to it (the "Most shifts in a row" box on
 * the line-order objectives) and the Design-checks panel reports against it, so the two cannot
 * disagree about one idea.
 *
 * It sits well under Chiltern's hard limit of 13 (`links-limits.js`) and is a different KIND of
 * statement: an aim the tool optimises towards, never a rule the design has to clear. The panel
 * labels it that way and must go on doing so.
 */
export const DEFAULT_MAX_RUN = 6;

/**
 * The share of weeks with a full weekend off the Design checks' Weekends off row aims for — an aim,
 * like `DEFAULT_MAX_RUN`, not a limit. Declared once because the row and its `?` panel
 * (`links-tips.js`) both quote it, and two literals are two figures waiting to disagree.
 */
export const WEEKENDS_OFF_AIM_PCT = 40;

/**
 * The longest run of consecutive worked days a line can be made to carry — the WORST CASE, because
 * a spare week's four duties can be placed on any of Monday to Saturday, its Sunday can be worked on
 * top as overtime (`spareDrawsOnFour`), and we do not know which.
 *
 * NOT A SPARE WEEK COUNTED AS SEVEN WORKED DAYS — "over-reporting is the safe direction" is not true:
 * it read the main cycle at **15** and the bilingual at **14** against true ceilings of **9** and
 * **9**. A 7/7 spare week BRIDGES the blocks either side into one phantom run; four duties on Monday
 * to Saturday cannot, as two of those six days are always rest, so a run takes at most the Sunday
 * and four of its days and stops.
 *
 * The direction matters more than the size. 13 consecutive days is Chiltern's roster limit, derived
 * from the post-Clapham Hidden standard (Clapham Junction, 1988), so a check reporting 15 reports a
 * breach that does not exist, readers learn to discount the row, and the next design that genuinely
 * passes 13 is hidden by that discount.
 *
 * The greedy scan is exact for a maximum: each run is free to spend a spare week's four duties
 * however suits IT, because two runs never need the same week's allocation at once. Two ADJACENT
 * spare weeks legitimately chain to nine (the first week's four at its end, Wednesday to Saturday;
 * then the second's Sunday as overtime and its four from the Monday) — the bilingual roster, whose
 * spare weeks are 1 and 8 of 8 and so wrap into each other.
 *
 * @param {Array<{shift: any}>} seq - one person's journey, in day order, SEVEN PER LINE
 * @returns {number} the most consecutive worked days any arrangement of the spare weeks can produce
 */
export function worstCaseWorkedRun(seq) {
    const lengths = workedRunLengths(seq);
    return lengths.length ? Math.max(...lengths) : 0;
}

/**
 * The worst-case run reachable from EVERY starting day, not just the longest of them.
 *
 * `worstCaseWorkedRun` is the max of this, and remains the number anyone reads — the array is for
 * the ORDER OPTIMISER (`links-adjacency.js`) and nothing else: a maximum is a plateau to a local
 * search (it stalled at 8 where a random search found 6), and summing the excess over all starts
 * gives it a gradient — the shape `blockExcess` uses for shift blocks.
 *
 * **Do not report this, or any total derived from it.** A run of 8 also appears as a 7 from the next
 * day, a 6 from the one after, and so on, so long runs are counted many times over — which is what
 * makes it a good gradient and a meaningless statistic.
 *
 * @param {Array<{shift: any}>} seq - one person's journey, in day order, SEVEN PER LINE
 * @returns {number[]} one worst-case run length per starting day
 *
 * ── WHY IT TAKES A PREDICATE ────────────────────────────────────────────────────────────────────
 * The spare-week budget is written once and the QUESTION is the parameter: a plain run scan for the
 * ORR's "more than 7 consecutive 8h shifts" treated a cover week as a BREAK and reported the default
 * design CLEAR at 5 against a worst case of 8 — the false assurance `links-fatigue.js` names as its
 * dominant risk. Do not move the SPARE branch into the predicate: a spare day is an unknown rather
 * than a no, so it counts towards every question, capped at four a week; a `counts` answering for it
 * would either fuse the blocks either side (15 reported against a true 9) or break the run.
 *
 * `requireMatch` exists because a cover week may EXTEND a run and must not CREATE one: without it a
 * design with no 12-hour duty anywhere reports a run of four of them, a finding about nothing (the
 * cry-wolf rule). `workedRunLengths` leaves it off, correctly: a cover week with nothing either side
 * genuinely IS a run of worked days.
 *
 * @param {(shift: any) => boolean} counts - does a NON-spare day count towards the run?
 * @param {{requireMatch?: boolean}} [opts] - when set, a run of only spare days scores 0
 */
export function runLengthsWhere(seq, counts, { requireMatch = false } = {}) {
    const N = seq.length;
    if (!N) return [];
    /** @type {number[]} */ const out = [];
    for (let start = 0; start < N; start++) {
        /** Duties already spent in each spare week by THIS run. @type {Map<number, number>} */
        const spent = new Map();
        let run = 0;
        let sawMatch = false;
        for (let k = 0; k < N; k++) {
            const i = (start + k) % N;
            const s = seq[i].shift;
            if (s === 'SPARE') {
                // A spare day is an UNKNOWN, not a no: in the worst case it satisfies whatever is
                // counted. The budget is per WEEK — four, Monday to Saturday; its Sunday is overtime
                // on top, so it counts without spending the four.
                if (spareDrawsOnFour(i)) {
                    const line = Math.floor(i / 7);
                    const used = spent.get(line) || 0;
                    if (used >= SPARE_WORKED_DAYS) break;
                    spent.set(line, used + 1);
                }
                run++;
            } else if (counts(s)) {
                run++;
                sawMatch = true;
            } else {
                break;
            }
        }
        out.push(requireMatch && !sawMatch ? 0 : Math.min(run, N));
    }
    return out;
}

/** RD, OFF or empty is rest; SPARE is NOT. The Links modules' one copy. @param {any} s */
export function isRest(s) { return !s || s === 'RD' || s === 'OFF'; }

/**
 * The worst-case run of consecutive WORKED days from every starting day.
 * Delegates, so the spare-week budget is written once. @param {Array<{shift:any}>} seq
 */
export function workedRunLengths(seq) { return runLengthsWhere(seq, s => !isRest(s)); }

/**
 * Classify a shift value into a colour/count class.
 * CEAs do not work nights — 'night' exists only as a defensive catch for
 * legacy or imported data (see .claude/rules/links-design.md → Design and save model).
 * @param {string} shift
 * @returns {'rd'|'spare'|'early'|'late'|'night'}
 */
export function classifyShift(shift) {
    if (!shift || shift === 'RD' || shift === 'OFF') return 'rd';
    if (shift === 'SPARE') return 'spare';
    // Read the hour through the SAME strict parser the coverage maths uses, so anything this calls
    // early or late is readable by startMinutes (a looser reader let a shift count in the day totals
    // while ABSENT from the heat map and every turnaround check). A value that is not a parseable
    // time falls to 'night', rendered as an `N:` count — CEAs never work nights, so any N: is a visible
    // "something here is wrong" flag. Do NOT map it to 'rd' instead: that hides it again.
    const st = startMinutes(shift);
    if (st === null) return 'night';
    const h = Math.floor(st / 60);
    if (h >= 4 && h < 11) return 'early';
    if (h >= 11 && h < 21) return 'late';
    return 'night';
}

/**
 * Validate and tidy a typed shift time. Accepts "6:00-14:00" or "06:00-14:00";
 * returns the padded "HH:MM-HH:MM" form, or null if it isn't a valid time pair.
 * Start times between 21:00 and 03:59 are rejected — CEAs do not work nights.
 * @param {string|null} raw
 * @returns {string|null}
 */
export function normaliseCustomShift(raw) {
    if (!raw) return null;
    const m = raw.trim().match(/^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const [, h1, m1, h2, m2] = m;
    if (+h1 > 23 || +h2 > 23 || +m1 > 59 || +m2 > 59) return null;
    if (+h1 >= 21 || +h1 < 4) return null; // night start — not a CEA shift
    // Reject a wrapping (over-midnight) shift, e.g. "20:00-04:00": "CEA shifts never wrap" is
    // enforced at the input boundary, the first line of defence before endMinutesAbs.
    if ((+h2 * 60 + +m2) <= (+h1 * 60 + +m1)) return null;
    return `${h1.padStart(2, '0')}:${m1}-${h2.padStart(2, '0')}:${m2}`;
}

/**
 * Put ONE shift value into the module's canonical form, or return it unchanged when it is already
 * canonical / not a time. Applied to a whole design by `normalisePatterns` on load.
 *
 * WHY THIS EXISTS. Two readers of a shift string disagreed about "6:00-14:00": it counted in the day
 * totals while absent from the heat map and exempt from every turnaround check — silent, and in the
 * worst direction. The app only writes padded values, so this is reachable through legacy/imported
 * data (including the `combined-28` migration, which copies patterns verbatim). Normalising ON LOAD is
 * deliberately preferred to loosening `TIME_PAIR`, which would leave two representations circulating
 * forever.
 *
 * @param {any} shift
 * @returns {any} the padded "HH:MM-HH:MM" form, or the input untouched
 */
export function canonicaliseShift(shift) {
    if (typeof shift !== 'string') return shift;
    const m = shift.trim().match(/^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/);
    if (!m) return shift;
    const [, h1, m1, h2, m2] = m;
    if (+h1 > 23 || +h2 > 23 || +m1 > 59 || +m2 > 59) return shift;   // not a real time — leave alone
    return `${h1.padStart(2, '0')}:${m1}-${h2.padStart(2, '0')}:${m2}`;
}

/**
 * Canonicalise every cell of a design's patterns. Pure — returns a new object, mutates nothing. A cell
 * that is not a string becomes its string form, which reads as 'night'; passed through, the grid threw.
 * @param {any} patterns - { "1".."N": { sun..sat } }
 * @returns {Record<string, any>}
 */
export function normalisePatterns(patterns) {
    const out = /** @type {Record<string, any>} */ ({});
    for (const [pos, row] of Object.entries(patterns || {})) {
        if (!row || typeof row !== 'object') continue;
        const p = /** @type {Record<string, any>} */ ({}), r = /** @type {any} */ (row);
        for (const d of DAYS) if (d in r) p[d] = canonicaliseShift(r[d] == null ? r[d] : String(r[d]));
        out[pos] = p;
    }
    return out;
}

const TIME_PAIR = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;   // read WHOLE: real times at both ends, nothing between; midnight is `00:00`

/** Start of a timed shift in minutes since midnight, or null for anything that is not one (RD, SPARE, a malformed cell). */
export function startMinutes(/** @type {any} */ shift) {
    const m = typeof shift === 'string' && shift.match(TIME_PAIR);
    return m ? (+m[1]) * 60 + (+m[2]) : null;
}

/** End of a timed shift in minutes since midnight, or null for anything that is not one. */
export function endMinutes(/** @type {any} */ shift) {
    const m = typeof shift === 'string' && shift.match(TIME_PAIR);
    return m ? (+m[3]) * 60 + (+m[4]) : null;
}

/**
 * End of a timed shift in minutes from the START day's midnight — so a duty that runs past midnight
 * returns a value ABOVE 24*60 instead of a number smaller than its own start.
 *
 * WHY THIS EXISTS. Inline readers of a duty's end made a wrapping duty look SAFER than it is: the
 * heat map lost the post-midnight hours, and a duty ending 00:30 before an 06:20 start reported ~26h
 * of rest where the truth is 5h50. CEA duties finish 23:55 and `normaliseCustomShift` rejects a
 * wrapping value (keep that ban — the first line of defence, not a duplicate of this); this covers
 * legacy/imported data, as `canonicaliseShift` does.
 * @param {any} shift
 * @returns {number|null}
 */
export function endMinutesAbs(shift) {
    const st = startMinutes(shift);
    const en = endMinutes(shift);
    if (st === null || en === null) return null;
    return en <= st ? en + 24 * 60 : en;
}

/**
 * How long a duty lasts, in minutes, or null when it carries no readable time.
 *
 * Lives HERE, beside `endMinutesAbs` (links-fatigue.js re-exports it): exactly ONE reading of a duty's
 * length, which `weeklyHours` needs too — a second copy is the whole failure mode.
 *
 * @param {any} shift
 * @returns {number|null}
 */
export function dutyMinutes(shift) {
    const a = startMinutes(shift);
    const b = endMinutesAbs(shift);
    if (a === null || b === null) return null;
    return b - a;
}

/** Contracted hours a week, Sundays excluded — 140 hours per four-week period. */
export const CONTRACTED_HOURS_PER_WEEK = 35;

/**
 * Decimal hours → "34h 59m", the ONE formatter for every hours-a-week figure.
 *
 * WHY IT ROUNDS MINUTES FIRST: two independent roundings (`Math.floor(h)` + `Math.round((h % 1) * 60)`)
 * rendered 34.9917 hours as "34h 60m" under a green tick. Rounding the TOTAL minutes first makes the
 * carry (59.5m → the next hour) arithmetic instead of a special case.
 * @param {number} hours - non-negative decimal hours
 * @returns {string}
 */
export function hmFromHours(hours) {
    const mins = Math.round(hours * 60);
    return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

/**
 * A `weeklyHours` average as every surface states it: `hm` the figure, `partial` when it covers fewer
 * lines than the design has (`complete` false), `text` the two together — "35h 00m (partial)", or "—"
 * with nothing to average. One decision, so no surface states the bare figure while another says partial.
 * @param {{ exSunday: number|null, all?: number|null, complete: boolean }} wh @param {'exSunday'|'all'} [which]
 */
export function hoursFigure(wh, which = 'exSunday') {
    const h = wh[which] ?? null, hm = h === null ? null : hmFromHours(h), partial = hm !== null && !wh.complete;
    return { hm, partial, text: hm === null ? '—' : hm + (partial ? ' (partial)' : '') };
}

/**
 * How many hours a week this design actually gives somebody — the most basic question of a roster.
 *
 * ── SUNDAYS COME OUT, AND THAT IS NOT A DETAIL ────────────────────────────────────────────────
 *
 * Sunday is **not contracted** for any grade here (the rule is enforced across the app at every
 * point that writes or shows a day — no AL, no absence, ever, on a Sunday; the forbidden types are
 * `SUNDAY_FORBIDDEN_TYPES` in `override-utils.js`). So a Sunday duty is overtime-shaped work on
 * top of the contract, and folding it into the weekly average would flatter the design: it would
 * report a link as delivering the contracted hours when a chunk of what it counted is not
 * contracted time at all. Both figures are returned; only `exSunday` is comparable to 35.
 *
 * ── A COVER WEEK IS A PAID WEEK, AND THE AVERAGE IS OVER THE WHOLE ROTATION ───────────────────
 *
 * Owner, Aug 2026: 35 hours a week averaged across all the lines, individual weeks free to vary,
 * and a spare week counted as a full contracted week — not left out of the average: it carries no
 * stored times, a fact about the notation, not the week. (Dividing by the WORKING lines agrees on the
 * requirement — `(D + 35s)/L = 35` is `D = 35 x working` — but misstates every design that misses.)
 *
 * An UNFILLED line (no duties, not marked spare) is 0 hours over 1 line and drags the mean down
 * rather than being skipped. That is right: it is a week somebody works with nothing in it, and
 * "Lines not yet designed" is the row that explains it.
 *
 * Measured, the live main cycle comes to **35.00** exactly — the check on the check.
 *
 * Every total is a FLOOR for the same reason `assessFatigue` reports one: a duty the parser cannot
 * read contributes nothing.
 *
 * @param {Record<string, any>} patterns
 * @param {number} [rotatingLines]
 * @returns {{exSunday: number|null, all: number|null, sundayHours: number, totalHours: number,
 *            exSundayHours: number, workingLines: number, coverLines: number, lines: number,
 *            duties: number, sundayDuties: number, unreadable: number, unreadableLines: number,
 *            loneSpareDays: number, complete: boolean, target: number}}
 */
export function weeklyHours(patterns, rotatingLines = ROTATING_LINES) {
    let totalMin = 0, sundayMin = 0, duties = 0, sundayDuties = 0, unreadable = 0;
    let workingLines = 0, coverLines = 0, unreadableLines = 0, loneSpareDays = 0;

    for (let w = 1; w <= rotatingLines; w++) {
        const row = /** @type {Record<string, any>} */ (patterns)?.[String(w)] || {};
        const cover = isCoverWeek(row);
        let lineIsTimed = false, lineHasWork = false;
        for (const d of DAYS) {
            const s = row[d];
            // A LONE SPARE DAY — Monday to Saturday, on a week that is not a whole cover week — is a
            // worked day whose time nobody has set. It makes the figure INCOMPLETE (`complete: false`,
            // as an unreadable line does), never zero hours under a tick.
            if (s === 'SPARE' && !cover && d !== 'sun') { loneSpareDays++; continue; }
            if (!s || s === 'RD' || s === 'OFF' || s === 'SPARE') continue;
            lineHasWork = true;
            const m = dutyMinutes(s);
            // A worked cell we cannot read is COUNTED as unreadable rather than silently skipped —
            // otherwise a design full of malformed times reports a comfortable low average and
            // nothing says why. The panel prints this count when it is non-zero.
            if (m === null) { unreadable++; continue; }
            lineIsTimed = true;
            duties++; totalMin += m;
            if (d === 'sun') { sundayDuties++; sundayMin += m; }
        }
        if (cover) coverLines++;
        else if (lineIsTimed) workingLines++;
        // ── A WHOLE LINE NOBODY COULD READ ───────────────────────────────────────────────────────
        // Worked cells but NOT ONE readable time: zero minutes and out of `workingLines`, so the
        // average is undisturbed while somebody's working week was never measured. `unreadable` counts
        // CELLS, which cannot tell that from stray cells, so the LINE is counted separately and the
        // panel refuses to call the figure on-target while any exist.
        else if (lineHasWork) unreadableLines++;
    }

    // The average is over the WHOLE rotation and a cover week is a paid week (the header says why).
    const coverMin = coverLines * CONTRACTED_HOURS_PER_WEEK * 60;
    const exSundayMin = totalMin - sundayMin;
    const hrs = (/** @type {number} */ m) => Math.round((m / 60) * 100) / 100;
    const measured = workingLines + coverLines ? rotatingLines : 0;
    return {
        // null, never 0, when there is nothing to average — "0 hours a week" about an empty design
        // is a sentence that reads as a finding, and it is not one.
        exSunday: measured ? hrs((exSundayMin + coverMin) / measured) : null,
        all:      measured ? hrs((totalMin + coverMin) / measured) : null,
        totalHours: hrs(totalMin), exSundayHours: hrs(exSundayMin), sundayHours: hrs(sundayMin),
        workingLines, coverLines, lines: rotatingLines,
        duties, sundayDuties, unreadable, unreadableLines, loneSpareDays,
        // The figure covers only the lines and days it could measure. `false` is what lets the
        // renderer show a number without endorsing it — see the notes beside `unreadableLines` and
        // `loneSpareDays` above.
        complete: unreadableLines === 0 && loneSpareDays === 0,
        target: CONTRACTED_HOURS_PER_WEEK,
    };
}

/**
 * PER-LINE totals for the grid's right-hand columns, and the average days worked — what does week 11 work?
 *
 * ── THE TWO DIVISORS ARE DIFFERENT, AND THAT IS NOT A MISTAKE ───────────────────────────────────
 *
 * Hours average over the WHOLE rotation, cover weeks included at the contracted week (`weeklyHours`
 * — this function deliberately does NOT recompute it; the grid footer reads the same figure the
 * Design-checks row and the summary strip already show, so the page cannot state a design's hours
 * two ways).
 *
 * Days worked average over the WORKING lines only (invariant 7), because a cover week does not record
 * WHICH days it works: counting it as zero would report 4.2 days a week as 3.5. It matches how the
 * owner's 4.2 was derived — `(5 x weekday + sat) / working` in `links-default-targets.js`. Both
 * divisors are named on screen.
 *
 * ── WHAT A LINE'S OWN CELLS CAN AND CANNOT SAY ──────────────────────────────────────────────────
 *
 * A COVER week is shown as the contracted week rather than zero, marked `assumed` so the renderer can
 * say it is a convention rather than a reading. Its days are `null`: unknown, not none. An UNREADABLE
 * duty contributes nothing and is counted, so a low line can say why. A LONE SPARE day (Mon–Sat SPARE
 * outside a cover week) is the same kind of floor (`loneSpare`), as in `weeklyHours`.
 *
 * @param {Record<string, any>} patterns
 * @param {number} [rotatingLines]
 * @returns {{rows: Array<{pos: number, exSundayMinutes: number, allMinutes: number,
 *            days: number|null, assumed: boolean, unreadable: number, loneSpare: number, unfilled: boolean}>,
 *            daysAverage: number|null, daysLines: number}}
 */
export function lineTotals(patterns, rotatingLines = ROTATING_LINES) {
    const rows = [];
    let daysTotal = 0, daysLines = 0;
    const contractedMin = CONTRACTED_HOURS_PER_WEEK * 60;

    for (let w = 1; w <= rotatingLines; w++) {
        const row = /** @type {Record<string, any>} */ (patterns)?.[String(w)] || {};
        let exSundayMinutes = 0, allMinutes = 0, days = 0, unreadable = 0, loneSpare = 0;
        let timed = false, hasWork = false;
        for (const d of DAYS) {
            const shift = row[d];
            if (shift === 'SPARE' && d !== 'sun') { loneSpare++; hasWork = true; continue; }
            if (!shift || shift === 'RD' || shift === 'OFF' || shift === 'SPARE') continue;
            hasWork = true;
            const m = dutyMinutes(shift);
            if (m === null) { unreadable++; continue; }
            timed = true;
            allMinutes += m;
            // Sunday is not contracted, so it is outside the Mon–Sat figure AND outside the days
            // count — the same exclusion the hours row has always made, applied to both columns.
            if (d !== 'sun') { exSundayMinutes += m; days++; }
        }
        const assumed = isCoverWeek(row);
        if (assumed) {
            // `allMinutes` here is a timed RDW Sunday, if the cover week has one — real hours on top.
            rows.push({ pos: w, exSundayMinutes: contractedMin, allMinutes: contractedMin + allMinutes,
                days: null, assumed: true, unreadable: 0, loneSpare: 0, unfilled: false });
            continue;
        }
        if (timed) { daysTotal += days; daysLines++; }
        rows.push({ pos: w, exSundayMinutes, allMinutes, days,
            assumed: false, unreadable, loneSpare, unfilled: !hasWork });
    }

    return {
        rows,
        // null, never 0 — "0 days a week" about a design nobody has filled in reads as a finding.
        daysAverage: daysLines ? Math.round((daysTotal / daysLines) * 100) / 100 : null,
        daysLines,
    };
}

/**
 * Count early/late/spare/night/rd per day across all positions.
 * @param {Object} patterns - { "1".."N": { sun..sat } }
 * @param {number} totalPos
 */
export function calcCoverage(patterns, totalPos = ROTATING_LINES) {
    /** @type {Record<string, any>} */
    const cov = {};
    for (const d of DAYS) cov[d] = { early: 0, late: 0, spare: 0, night: 0, rd: 0 };
    for (let pos = 1; pos <= totalPos; pos++) {
        const p = /** @type {Record<string, any>} */ (patterns)[String(pos)];
        for (const d of DAYS) {
            const type = classifyShift(p ? (p[d] ?? 'RD') : 'RD');
            cov[d][type]++;
        }
    }
    return cov;
}

/**
 * Day class for staffing targets: the real roster uses different shift times
 * and headcounts on Saturdays and Sundays than on weekdays.
 * @param {string} d - day key from DAYS
 * @returns {'weekday'|'sat'|'sun'}
 */
export function dayClass(d) {
    return d === 'sun' ? 'sun' : d === 'sat' ? 'sat' : 'weekday';
}

/**
 * Count on-duty headcount for each hour of the day, per day of week.
 * Spare positions have no times, so they are counted separately.
 *
 * A duty that runs past midnight is counted on BOTH days — its evening hours on the day it starts,
 * its small hours on the next day (wrapping Sat → Sun), because that is where the people are. CEA
 * duties finish 23:55, so this is reachable only through legacy/imported data.
 * @param {Object} patterns - { "1".."N": { sun..sat } }
 * @param {number} [totalPos=ROTATING_LINES]
 * @returns {Object.<string,{hours:number[], spare:number}>} keyed by day
 */
export function calcHourlyCoverage(patterns, totalPos = ROTATING_LINES) {
    const out = /** @type {Object.<string,{hours:number[], spare:number}>} */ ({});
    for (const d of DAYS) out[d] = { hours: new Array(24).fill(0), spare: 0 };
    for (let pos = 1; pos <= totalPos; pos++) {
        const p = /** @type {Record<string, any>} */ (patterns)[String(pos)];
        if (!p) continue;
        for (const [i, d] of DAYS.entries()) {
            const s = p[d] ?? 'RD';
            if (s === 'RD' || s === 'OFF') continue;
            if (s === 'SPARE') { out[d].spare++; continue; }
            const st = startMinutes(s);
            const en = endMinutesAbs(s);
            if (st === null || en === null) continue;
            for (let h = 0; h < 24; h++) {
                if (st < (h + 1) * 60 && en > h * 60) out[d].hours[h]++;
            }
            if (en > 24 * 60) {
                const spill = en - 24 * 60;
                const next = DAYS[(i + 1) % DAYS.length];
                for (let h = 0; h < 24 && spill > h * 60; h++) out[next].hours[h]++;
            }
        }
    }
    return out;
}

/**
 * The rest between one duty and the next, in minutes. Null when either has no readable time —
 * a rest day or a spare week is not a turnaround at all.
 *
 * `endMinutesAbs`, never `endMinutes`: a duty running past midnight has to eat into the rest that
 * follows it rather than be credited with a phantom extra day of it. The ONE reading of a
 * turnaround: `runDesignChecks`, the generator's rest repair (`links-generate.js`) and
 * `links-adjacency.js`'s week boundary all call it.
 * @param {string} from @param {string} to
 * @returns {number|null}
 */
export function restBetween(from, to) {
    const end = endMinutesAbs(from), start = startMinutes(to);
    if (end === null || start === null) return null;
    return (24 * 60 - end) + start;
}

/**
 * Quality checks for the rotating link. Staff work line w one week, line w+1
 * the next (wrapping), so the design's quality lives BETWEEN the rows too:
 * the weekend between two weeks is Sat of line w + Sun of line w+1.
 *
 * @param {Object} patterns - { "1".."N": { sun..sat } }
 * @param {number} [rotatingLines=ROTATING_LINES] - every line rotates
 * @returns {{
 *   weekendsOff: number, weekendsOffPct: number, totalWeeks: number,
 *   unfilledLines: number[],
 *   turnarounds: Array<{fromLine:number, fromDay:string, fromShift:string,
 *                       toLine:number, toDay:string, toShift:string, restMinutes:number}>,
 *   longestStretch: number,
 *   balance: { early:number, late:number, spare:number, worked:number, coverWeeks:number }
 * }}
 */
export function runDesignChecks(patterns, rotatingLines = ROTATING_LINES) {
    const shiftAt = (/** @type {any} */ w, /** @type {any} */ d) => /** @type {Record<string, any>} */ (patterns)[String(w)]?.[d] ?? 'RD';

    // One person's journey through the whole rotation, day by day.
    const seq = [];
    for (let w = 1; w <= rotatingLines; w++) {
        for (const d of DAYS) seq.push({ line: w, day: d, shift: shiftAt(w, d) });
    }
    const N = seq.length;

    // Unfilled lines: everyone passes through every line, so an all-rest line is an incomplete line,
    // not a "vacant" one. The link can't be authorised until all of them are filled.
    const unfilledLines = [];
    for (let w = 1; w <= rotatingLines; w++) {
        if (DAYS.every(d => isRest(shiftAt(w, d)))) unfilledLines.push(w);
    }

    // Full weekends off: Sat of week w + Sun of week w+1 both rest days.
    let weekendsOff = 0;
    for (let w = 1; w <= rotatingLines; w++) {
        const nextW = (w % rotatingLines) + 1;
        if (isRest(shiftAt(w, 'sat')) && isRest(shiftAt(nextW, 'sun'))) weekendsOff++;
    }

    // Short turnarounds: under MIN_REST_MINUTES from one timed shift's end to the next's start
    // (SPARE has no times, skip) — `restBetween`, so a duty running past midnight eats into the
    // rest it is followed by instead of being credited with a phantom extra day of it.
    const turnarounds = [];
    for (let t = 0; t < N; t++) {
        const a = seq[t], b = seq[(t + 1) % N];
        const rest = restBetween(a.shift, b.shift);
        if (rest === null) continue;
        if (rest < MIN_REST_MINUTES) {
            turnarounds.push({
                fromLine: a.line, fromDay: a.day, fromShift: a.shift,
                toLine: b.line, toDay: b.day, toShift: b.shift,
                restMinutes: rest,
            });
        }
    }

    // Longest run of consecutive worked days around the circular rotation — the WORST CASE a spare
    // week can be arranged into, never a spare week counted as seven (worstCaseWorkedRun).
    const longestStretch = worstCaseWorkedRun(seq);

    // Early/late/spare balance across the worked days: a COVER WEEK is its SPARE_WORKED_DAYS duties, as everywhere else.

    const cover = new Set(Array.from({ length: rotatingLines }, (_, i) => i + 1).filter(w => isCoverWeek(/** @type {any} */ (patterns)[String(w)])));
    const balance = { early: 0, late: 0, spare: cover.size * SPARE_WORKED_DAYS, worked: cover.size * SPARE_WORKED_DAYS, coverWeeks: cover.size };
    for (const s of seq) {
        const type = classifyShift(s.shift);
        if (type === 'rd' || (type === 'spare' && cover.has(s.line))) continue;
        balance.worked++;
        if (type === 'early') balance.early++;
        else if (type === 'spare') balance.spare++;
        else balance.late++; // night folds into late here — defensive only, CEAs have no nights
    }

    return { weekendsOff, weekendsOffPct: Math.round(weekendsOff / rotatingLines * 100), totalWeeks: rotatingLines, unfilledLines, turnarounds, longestStretch, balance };
}
