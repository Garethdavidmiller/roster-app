// @ts-check
/**
 * links-design.js — Pure link-design maths for links.html. No DOM, no Firebase.
 *
 * Owns: shift classification, custom-time validation, coverage counting
 *   (per-type and hour-by-hour), the rest between two duties (`restBetween`),
 *   and the design quality checks (weekends off, short turnarounds, longest
 *   stretch, balance).
 * Does NOT own: the auto-generator — `generateLink`, its two constructions and the
 *   rest repair are `links-generate.js` (moved out 25 Nov 2026, when this module
 *   reached its line cap). That module imports the constants from here; this one
 *   still imports NOTHING, so it loads anywhere.
 * Edit here for: check thresholds, coverage maths, the hours maths.
 * Tested by links-design.test.mjs.
 *
 * ── THE RULES THAT MUST SURVIVE AN EDIT ────────────────────────────────────────────────────────
 *
 * Moved here from CLAUDE.md's file tree at v20.11. It had accumulated twelve version stamps there
 * — a changelog living in a routing table, loaded into every session and read on almost none. The
 * release history stays in git and in LINKS_DEC2026_PLAN.md; what belongs beside the code is the
 * set of things a future edit can silently break. Those are:
 *
 * `ROTATING_LINES` is the ONE declaration of the rotation length. **Never write the number down** —
 * not in a module, not in prose, not in a `max` attribute. It was a literal in three files kept in
 * step by a comment until v19.38, and when the length moved twice (28 → 22 → 24) the sweep found it
 * restated in ~15 places, every one of which rendered perfectly while describing a link that does
 * not exist. `links-rotation-parity.test.mjs` fails on a literal; markup that cannot interpolate
 * uses a `.js-rotating-lines` span. A design SAVED at an older length is left alone — trimming on
 * load destroys work on a page visit, trimming on save does it at the worst possible moment — so
 * `#linksOverLengthNotice` states that the surplus rows are neither shown nor counted but are kept.
 *
 * `normalisePatterns` pads a legacy unpadded time on load so this module has ONE time format.
 * Before it, `classifyShift` and `startMinutes` could disagree about what a time IS: "6:00-14:00"
 * classified as a normal early while `startMinutes` returned null, so it counted in the day totals
 * yet was ABSENT from the hourly heat map and exempt from every turnaround check.
 *
 * SPARE IS A WHOLE WEEK, not a per-day headcount. `spareLines` reserves whole lines spread around
 * the wheel. Feeding a spare count to the sliding window instead scattered a person's standby days
 * across the week while the daily SP total stayed correct — which is exactly why nobody noticed.
 * The real roster has whole spare weeks only. A spare week is **four** duties of seven
 * (`SPARE_WORKED_DAYS`); counting it as seven let one bridge the blocks either side of it and
 * reported the live main roster at 15 consecutive worked days against a true ceiling of 9.
 *
 * The generator's own rules — the WAVES, the merged waves, the fallback's `no-rest` refusal, the
 * interleave WON'T-DO and the exact-contract refusals — moved with it to `links-generate.js`'s header.
 *
 * `weeklyHours` reports **the mean week across the whole rotation**, and two rules govern it.
 * **Sundays come out**, because Sunday is not contracted for any grade here, so counting it towards
 * 35 reports a design as delivering contracted hours using time that is not — it FLATTERS. And
 * **a cover week counts as a full contracted week** (v20.98, owner): it carries no stored times,
 * which is a fact about how the design is written down rather than about whether the week is
 * worked and paid. Validated against the roster itself: the live main cycle comes to exactly 35.00.
 * A line with worked duties but no readable time is reported through `unreadableLines` /
 * `complete`, never silently dropped — see the note at that function.
 *
 * `endMinutesAbs` is the ONE reading of a duty that runs past midnight. Both former inline copies
 * erred towards *safer than the truth*: the heat map dropped the post-midnight hours entirely, and
 * the turnaround check credited a 00:30 finish with ~26h of rest before an 06:20 start instead of
 * 5h50. Unreachable from the CEA link (`normaliseCustomShift` refuses a wrapping value) — keep that
 * ban. `dutyMinutes` lives here rather than in links-fatigue.js and is re-exported there: a second
 * copy is the exact failure `endMinutesAbs` was extracted to end.
 */

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * The rotation length. ONE declaration (v19.38) — it previously sat as a literal in three places
 * (links-app's TOTAL_POS + ROTATING_LINES, links-analysis's own pair, and the default parameter of
 * every function here), with a comment in links-analysis.js claiming they "stay in step without a
 * shared import". That is a hope, not a mechanism. Every line rotates, so the grid height, the
 * checks window and the generator output are necessarily the SAME number — there is no reading of
 * this app where they differ.
 *
 * ── 28 → 22 → 24 → today's length (v19.98, v20.01, v24.47; the December 2026 plan) ─────────────
 *
 * It was **28 = the main 20-week cycle + the bilingual 8**, because the design modelled both as one
 * rotation. That is no longer what is being built. The new link **excludes the bilingual roster
 * entirely** — not its lines, not its shift times, not its work. It is the CEA (main) roster
 * **widened from 20 to increase staffing levels**; the bilingual roster continues separately and is
 * simply out of scope.
 *
 * The LENGTH then moved again: 22 at v19.98, corrected to **24** at v20.01 (owner — the earlier
 * figure was misremembered) — and once more at v24.47 (owner, 1 Oct 2026, with five cover weeks) to
 * the length declared below, which is deliberately not written in this comment: a comment giving the
 * CURRENT length is one more copy to drift (links-design.md, invariant 1). Every one of these is a
 * business figure with **no document behind it**, which makes
 * this evidence class C by ROADMAP.md's scale: fine as a design parameter, and it must NOT be
 * rendered to a manager as a requirement without a source. See KNOWN_LIMITATIONS.md → Links.
 *
 * **That second change is the argument for the first one's design.** Moving 28 → 22 was a sweep of
 * ~15 literals across five files plus a compare-mode copy nobody knew was there; moving 22 → 24 was
 * this line, four static fallbacks the parity test names for you, and a re-measure. If a number can
 * change once it can change twice, and the second time is the one that finds out whether it was
 * really centralised. Do not re-introduce a literal — `links-rotation-parity.test.mjs` fails on one,
 * including a literal that happens to be right today.
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
 * SPARE, a rest day or a timed RDW and the week is still four days of cover (v25.06, whole-app
 * review). Requiring all seven SPARE let a cover week written with its Sunday as a rest day count as
 * an EMPTY line — no days towards the 219-day ceiling, no hours towards the contract — so a design
 * over the ceiling read as under it. Hours, days, spread and the roster seed ask this; the rest repair protects all-SPARE rows only.
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
 * Until v25.03 the four could fall on any of the seven days, Sunday included. That disagreed with
 * everything else here that counts a cover week — contracted days a year (`links-limits.js`) count
 * its four as Monday to Saturday — and it understated every run that enters a cover week by one: the
 * Sunday's overtime and four duties from the Monday is five days in a row, where four from the
 * Sunday was four.
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
 * **One number, read in two places**, and that is the point of it being here. The generator builds
 * to it (the "Most shifts in a row" box on the line-order objectives) and the Design-checks panel
 * reports against it. Until v20.02 those were 6 and 7 respectively, in different files — so a design
 * built to the generator's aim could still be handed to the checks panel and told it was fine, and a
 * reader had two numbers for one idea. That is the same defect v20.00 fixed between the design
 * target and the company limit, one level down.
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
 * THIS REPLACES COUNTING A SPARE WEEK AS SEVEN WORKED DAYS (v19.79), which is what both run checks
 * did, and which the comment justified as "over-reporting is the safe direction for a fatigue
 * check". It is not, and the live roster is the proof: it reported the main cycle at **15** and the
 * bilingual at **14** when the true ceilings were **9** and **8** (9 and 9 since v25.03, when the
 * Sunday stopped being one of the four). The error is not a rounding — a spare week that is 7/7
 * worked BRIDGES the blocks either side of it and fuses them into one long phantom run. Four duties
 * on Monday to Saturday cannot bridge anything: two of those six days are always rest days, so a run
 * can take at most the Sunday and four of its days and must then stop.
 *
 * Why the direction matters more than the size. 13 consecutive days is Chiltern's roster limit,
 * derived from the post-Clapham Hidden standard (Clapham
 * Junction, 1988), not a preference — so a check that reports 15 is not being cautious, it is reporting a
 * breach that does not exist, on the roster people are working today. Every reader who knows the
 * real link then learns to discount the row, and the next design that genuinely goes past 13 is
 * hidden by that discount. Over-reporting is only "safe" while nothing is riding on the number.
 *
 * The greedy scan is exact for a maximum: each run is free to spend a spare week's four duties
 * however suits IT, because two different runs never need the same week's allocation at once. Two
 * ADJACENT spare weeks legitimately chain to nine (the first week's four at its end, Wednesday to
 * Saturday; then the second's Sunday as overtime and its four from the Monday) — that is the
 * bilingual roster, whose spare weeks are 1 and 8 of 8 and so wrap into each other. It was eight
 * until v25.03, when the four could still include the Sunday (`spareDrawsOnFour`).
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
 * the ORDER OPTIMISER (`links-adjacency.js`) and nothing else. It exists because a maximum is a
 * terrible thing for a local search to climb: almost every pair swap leaves it unchanged, so the
 * whole space is a plateau with no gradient, and the optimiser stalled at 8 where a random search
 * found 6 (measured v20.02, at 30 passes as well as 6). Summing the excess over all starts gives it
 * something to follow, which is exactly the shape `blockExcess` already uses for shift blocks.
 *
 * **Do not report this, or any total derived from it.** A run of 8 also appears as a 7 from the next
 * day, a 6 from the one after, and so on, so long runs are counted many times over — which is what
 * makes it a good gradient and a meaningless statistic.
 *
 * @param {Array<{shift: any}>} seq - one person's journey, in day order, SEVEN PER LINE
 * @returns {number[]} one worst-case run length per starting day
 *
 * ── WHY IT TAKES A PREDICATE (v21.98) ───────────────────────────────────────────────────────────
 * The spare-week budget above is the hard part of this function and it was written for exactly one
 * question, "is this a worked day?". A second question then arrived — the ORR's "more than 7
 * consecutive 8h shifts" — and answering it with a plain run scan treated a cover week as a BREAK,
 * which reported the shipped default design as CLEAR at 5 against a worst case of 8. That is the
 * false-assurance failure `links-fatigue.js` names as its dominant risk, arrived at by asking the
 * right question with the wrong tool.
 *
 * So the budget is written once and the QUESTION is the parameter. What must not be moved into the
 * predicate is the SPARE branch: a spare day is an unknown rather than a no, so it counts towards
 * every question, capped at four a week — and a `counts` that tried to answer for it would either
 * fuse the blocks either side (the v19.79 defect, 15 reported against a true 9) or break the run.
 *
 * `requireMatch` exists because a cover week may EXTEND a run and must not CREATE one. Without it,
 * a design containing no 12-hour duty anywhere still reports a run of four of them — the cover
 * week's own days, counted as unknowns that might be anything. That is a finding about nothing, and
 * a panel that produces them teaches the reader to skip the row (the same cry-wolf rule the demand
 * overlay's finding/fact split follows). `workedRunLengths` leaves it off, correctly: a cover week
 * with nothing either side genuinely IS a run of worked days.
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
                // A spare day is an UNKNOWN, not a no — it is a duty whose times are not yet
                // assigned, so in the worst case it satisfies whatever is being counted. It is
                // therefore handled here rather than by `counts`, for every predicate: the budget
                // is per WEEK, not per day, and four is what a cover week actually works — on
                // Monday to Saturday. Its Sunday is overtime on top, so it counts without
                // spending the four.
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

/** RD, OFF or empty is rest; SPARE is NOT. The Links modules' one copy (v25.23 — fatigue and adjacency each had one). @param {any} s */
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
    // Read the hour through the SAME strict parser the coverage maths uses (v19.38). This used to be
    // `parseInt(shift.slice(0, 2))`, which is looser than startMinutes/endMinutes — so "6:00-14:00"
    // classified as a perfectly ordinary early while startMinutes returned null, and the shift
    // counted in the day totals and the early/late balance yet was ABSENT from the hourly coverage
    // heat map and exempt from every short-turnaround check. Two readers of one string disagreeing
    // about what a time is.
    //
    // Now they cannot disagree: anything this calls early or late is by construction readable by
    // startMinutes. A value that is not a parseable time falls to 'night', which the grid footer
    // renders as an `N:` count — and since CEAs never work nights, any N: at all is a visible
    // "something here is wrong" flag rather than a shift masquerading as normal. Do NOT map it to
    // 'rd' instead: that hides it again, which is the whole failure being escaped.
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
    // Reject a wrapping (over-midnight) shift, e.g. "20:00-04:00". The start-hour guard
    // alone let an evening start through, but a next-day end breaks the module's
    // "CEA shifts never wrap" invariant: calcHourlyCoverage drops the past-midnight hours
    // and runDesignChecks computes a phantom ~26h rest, reporting a genuinely dangerous
    // short turnaround as compliant. Enforce non-wrapping at the input boundary.
    if ((+h2 * 60 + +m2) <= (+h1 * 60 + +m1)) return null;
    return `${h1.padStart(2, '0')}:${m1}-${h2.padStart(2, '0')}:${m2}`;
}

/**
 * Put ONE shift value into the module's canonical form, or return it unchanged when it is already
 * canonical / not a time. Applied to a whole design by `normalisePatterns` on load.
 *
 * WHY THIS EXISTS (v19.38). The module has two readers of a shift string and they disagreed about
 * what counts as a time:
 *   · `classifyShift` reads the hour with `slice(0, 2)`, so "6:00-14:00" parses as 6 → early.
 *   · `startMinutes`/`endMinutes` demand two digits, so the same value returns null.
 * The result was a shift that COUNTED in the day totals and the early/late balance while being
 * completely absent from the hourly coverage heat map and exempt from every short-turnaround check
 * — silent, and in the worst direction, since the heat map is the artefact used to spot gaps.
 *
 * The app itself only ever writes padded values (`normaliseCustomShift` pads; roster-derived options
 * are already padded), so this is reachable through legacy/imported data — including the
 * `combined-28` migration, which copies patterns verbatim. Normalising ON LOAD is deliberately
 * preferred to loosening `TIME_PAIR`: loosening leaves two representations circulating forever
 * and every future reader has to know about both. One canonical form has no such tail.
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
 * WHY THIS EXISTS (v19.47). Two readers of a duty's end each handled the past-midnight case with
 * their own inline expression, and both were wrong in the same direction — they made a wrapping duty
 * look SAFER than it is:
 *   · `calcHourlyCoverage` clamped the end to 24:00, so the post-midnight hours simply vanished from
 *     the heat map — the artefact used to spot coverage gaps.
 *   · `runDesignChecks` computed rest as `(1440 − end) + start`, so a duty ending 00:30 followed by an
 *     06:20 start reported ~26h of rest where the truth is 5h50 — a genuinely dangerous turnaround
 *     scoring as compliant.
 * Nothing in the CEA link reaches either: duties finish 23:55 and `normaliseCustomShift` rejects a
 * wrapping value at the input boundary (keep that ban — it is the first line of defence, not a
 * duplicate of this). It is reachable through legacy/imported data, the same route
 * `canonicaliseShift` exists for, and a latent rule that fails silently towards "compliant" is worth
 * closing before someone relies on it.
 *
 * One helper rather than two expressions, for the reason recorded on `canonicaliseShift`: two readers
 * of one string with their own idea of what it means is how they came to disagree in the first place.
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
 * Lives HERE, beside `endMinutesAbs`, rather than in `links-fatigue.js` where it was first written
 * (which re-exports it, so nothing that imported it there had to change). The reason is the rule
 * `endMinutesAbs` already exists for: there must be exactly ONE reading of a duty's length, because
 * the two hand-rolled copies it replaced both erred towards *safer than the truth*. `weeklyHours`
 * below needs the same reading, and `links-fatigue.js` imports this module — so writing a second
 * copy here was the only alternative, and a second copy is the whole failure mode.
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
 * WHY IT ROUNDS MINUTES FIRST (v20.54). Three hand-rolled copies formatted this figure as
 * `Math.floor(h)` + `Math.round((h % 1) * 60)` — two independent roundings, so 34.9917 hours
 * rendered as "34h 60m", live, wearing the generator row's green "on target" tick. The two copies
 * in links-analysis.js were safe only by ACCIDENT: `weeklyHours` pre-rounds its figures to 2 dp,
 * which happens to cap the fraction below the carry point — a dependency nothing recorded and the
 * next unrounded caller would have broken. Rounding the TOTAL minutes first makes the carry
 * arithmetic (59.5m → the next hour) instead of a special case.
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
 * How many hours a week this design actually gives somebody — the question the panel could not
 * answer until v20.04, and the most basic one anybody asks of a roster.
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
 * and a spare week counted as a full contracted week.
 *
 * Until v20.98 this divided by the WORKING lines and left cover weeks out of both halves. The
 * reasoning recorded against that was half right — dividing by all the lines DOES charge the average
 * with weeks of zero and report a number nobody works — and the conclusion did not follow: the
 * answer is to stop treating a cover week as zero, not to leave it out. It carries no stored times,
 * which is a fact about the notation, not about the week.
 *
 * The two readings agree on the REQUIREMENT and disagree on the FIGURE, which is why the difference
 * hid for so long: `(D + 35s)/L = 35` is exactly `D = 35 x working`, so a design that satisfies one
 * satisfies the other. They diverge on everything that MISSES — and a short design read the old way
 * looked worse than it is, because the cover weeks being paid for were not in the sum at all.
 *
 * An UNFILLED line (no duties, not marked spare) is 0 hours over 1 line and drags the mean down
 * rather than being skipped. That is right: it is a week somebody works with nothing in it, and
 * "Lines not yet designed" is the row that explains it.
 *
 * Measured, the live main cycle comes to **35.00** exactly — the check on the check, and it holds
 * under both readings, which is what makes it a fair test of the new one.
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
            // worked day whose time nobody has set (Nov 2026). Skipped as rest, it added no hours and
            // the figure still wore the tick; the contracted-days ceiling counted it as no day while
            // the run checks counted it as worked. It is counted here, and it makes the figure
            // INCOMPLETE — the same `complete: false` an unreadable line gives — never zero hours.
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
        // ── A WHOLE LINE NOBODY COULD READ (v20.08, external review P2) ──────────────────────────
        // A line with worked cells but NOT ONE readable time contributes zero minutes AND drops out
        // of `workingLines`, so it leaves the average completely undisturbed. That is the worst
        // available failure for this figure: 20 readable lines averaging exactly 35.00 while a
        // twenty-first line — somebody's actual working week — was never measured at all, and the
        // row reads as a clean tick. `unreadable` counts CELLS, which does not surface it either: a
        // handful of stray cells scattered across otherwise-fine lines and one entirely unmeasured
        // line can produce the identical count. So the LINE is counted separately, and the panel
        // refuses to call the figure on-target while any exist.
        else if (lineHasWork) unreadableLines++;
    }

    // The average is over the WHOLE rotation and a cover week is a paid week — the argument is the
    // function's header, stated once (it was stated here a second time until Nov 2026).
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
 * PER-LINE totals for the grid's right-hand columns, and the average days worked (v21.09) — the
 * first question anybody asks of a rotation they are about to be put on: what does week 11 work?
 *
 * ── THE TWO DIVISORS ARE DIFFERENT, AND THAT IS NOT A MISTAKE ───────────────────────────────────
 *
 * Hours average over the WHOLE rotation, cover weeks included at the contracted week (`weeklyHours`
 * — this function deliberately does NOT recompute it; the grid footer reads the same figure the
 * Design-checks row and the summary strip already show, so the page cannot state a design's hours
 * two ways).
 *
 * Days worked average over the WORKING lines only, because a cover week does not record WHICH days
 * it works. Counting it as zero days would report a rotation of 4.2 days a week as 3.5, and
 * inventing days for it would be worse. This also matches how the owner's 4.2 was derived in the
 * first place — `(5 x weekday + sat) / working` in `links-default-targets.js` — so the design's
 * measured figure is directly comparable with the target that produced it. Both divisors are named
 * on screen for exactly this reason.
 *
 * ── WHAT A LINE'S OWN CELLS CAN AND CANNOT SAY ──────────────────────────────────────────────────
 *
 * A COVER week is shown as the contracted week rather than zero — the app's settled position since
 * v20.98 — but marked `assumed` so the renderer can say it is a convention rather than a reading.
 * Its days are `null`: unknown, not none. An UNREADABLE duty contributes nothing and is counted, so
 * a line reading low can say why instead of looking like a light week. A LONE SPARE day — Mon–Sat
 * SPARE on a line that is not a whole cover week — is a duty with no times, and is the same kind of
 * floor (`loneSpare`): counted as no hours read as a light week (Nov 2026, as `weeklyHours` does).
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
 * its small hours on the next day (wrapping Sat → Sun), because that is where the people are. Until
 * v19.47 the end was clamped to 24:00 and those hours disappeared, which is the wrong direction for
 * an artefact whose whole job is showing where cover is thin. CEA duties finish 23:55, so this is
 * reachable only through legacy/imported data.
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
 * turnaround (25 Nov 2026): `runDesignChecks`, the generator's rest repair (`links-generate.js`) and
 * `links-adjacency.js`'s week boundary all call it — three copies of the formula used to be kept in
 * step by a comment.
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

    // Unfilled lines: a line with no worked day at all is not yet designed.
    // Every rotating line MUST carry a real pattern — in the rotation everyone
    // passes through every line, so an all-rest line is an incomplete line, not
    // a "vacant" one. The link can't be authorised until all of them are filled.
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

    // Longest run of consecutive worked days around the full circular rotation — the WORST CASE a
    // spare week can be arranged into, NOT a spare week counted as seven worked days. See
    // worstCaseWorkedRun: the old reading fused the blocks either side of a spare week and reported
    // the live main roster at 15 against a true ceiling of 9, on a figure whose limit is 13.
    const longestStretch = worstCaseWorkedRun(seq);

    // Early/late/spare balance across the worked days: a COVER WEEK is its SPARE_WORKED_DAYS duties, as everywhere else (Nov 2026).
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
