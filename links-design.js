// @ts-check
/**
 * links-design.js — Pure link-design maths for links.html. No DOM, no Firebase.
 *
 * Owns: shift classification, custom-time validation, coverage counting
 *   (per-type and hour-by-hour), the auto-generator (rotating-window
 *   construction from per-shift staffing targets), and the design quality
 *   checks (weekends off, short turnarounds, longest stretch, balance).
 * Edit here for: generator algorithm, check thresholds, coverage maths.
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
 * `generateLink` groups slots into WAVES by start time (within `WAVE_SPAN_MINUTES`, the FF19
 * threshold) and gives each wave a contiguous block of lines, so a line never leaves its wave.
 * Two rules were wrong on the first attempt and both made the link UNFAIR: a wave too small to fund
 * a line is **merged into its nearer neighbour** (two weekend-only slots once held a whole line, so
 * somebody worked two days a week), and a lap is **spread across the week, never front-loaded**.
 * The older rotating construction is kept as a fallback and **refuses** (`no-rest`) when strides
 * cannot fund a lap, rather than shipping the phantom "only moves later" guarantee it used to
 * claim — positions read mod `working`, so every line wrapped front-to-back once a week.
 * Interleaving the waves inside the generator is a WON'T-DO: tried and reverted, it fixes raw block
 * length but puts a late wave's 23:55 Saturday beside a morning wave's 06:20 Sunday. The generator
 * owns the SHAPE; `links-adjacency.js` owns the ORDER. A test fails if the interleave returns.
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
 * **`generateLink` REFUSES targets that cannot pay that mean** (`short-hours`, v20.98). The check is
 * on the TARGETS, because the arithmetic is settled before a cell is laid out and no arrangement can
 * rescue a short table. Over-contract still builds — those hours are paid or absorbed.
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
 * ── 28 → 22 → 24 (v19.98 then v20.01; the December 2026 plan, twice) ───────────────────────────
 *
 * It was **28 = the main 20-week cycle + the bilingual 8**, because the design modelled both as one
 * rotation. That is no longer what is being built. The new link **excludes the bilingual roster
 * entirely** — not its lines, not its shift times, not its work. It is the CEA (main) roster
 * **widened from 20 to increase staffing levels**; the bilingual roster continues separately and is
 * simply out of scope.
 *
 * The LENGTH then moved again: 22 at v19.98, corrected to **24** at v20.01 (owner — the earlier
 * figure was misremembered). Both are business figures with **no document behind them**, which makes
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
export const ROTATING_LINES = 24;

/** Minimum rest between two timed shifts on consecutive days, in minutes. */
export const MIN_REST_MINUTES = 12 * 60;

/**
 * A spare WEEK is FOUR worked days of seven (owner, Aug 2026) — you are marked SPARE on all seven
 * because you are available for cover, but four is what you work, unless a Sunday or other RDW is
 * added on top.
 */
export const SPARE_WORKED_DAYS = 4;

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
 * The longest run of consecutive worked days a line can be made to carry — the WORST CASE, because
 * a spare week's four duties can be placed anywhere in its seven days and we do not know where.
 *
 * THIS REPLACES COUNTING A SPARE WEEK AS SEVEN WORKED DAYS (v19.79), which is what both run checks
 * did, and which the comment justified as "over-reporting is the safe direction for a fatigue
 * check". It is not, and the live roster is the proof: it reported the main cycle at **15** and the
 * bilingual at **14** when the true ceilings are **9** and **8**. The error is not a rounding — a
 * spare week that is 7/7 worked BRIDGES the blocks either side of it and fuses them into one long
 * phantom run. Four duties in seven days cannot bridge anything: there is always a rest day inside
 * the week, so a run can take at most four of its days and must then stop.
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
 * ADJACENT spare weeks legitimately chain to eight (the first week's four at its end, the second's
 * four at its start) — that is the bilingual roster, whose spare weeks are 1 and 8 of 8 and so wrap
 * into each other.
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
 */
export function workedRunLengths(seq) {
    const N = seq.length;
    if (!N) return [];
    const isRestDay = (/** @type {any} */ s) => !s || s === 'RD' || s === 'OFF';
    /** @type {number[]} */ const out = [];
    for (let start = 0; start < N; start++) {
        /** Duties already spent in each spare week by THIS run. @type {Map<number, number>} */
        const spent = new Map();
        let run = 0;
        for (let k = 0; k < N; k++) {
            const i = (start + k) % N;
            const s = seq[i].shift;
            if (s === 'SPARE') {
                // Which line this day belongs to — the budget is per WEEK, not per day.
                const line = Math.floor(i / 7);
                const used = spent.get(line) || 0;
                if (used >= SPARE_WORKED_DAYS) break;
                spent.set(line, used + 1);
                run++;
            } else if (!isRestDay(s)) {
                run++;
            } else {
                break;
            }
        }
        out.push(Math.min(run, N));
    }
    return out;
}

/**
 * Classify a shift value into a colour/count class.
 * CEAs do not work nights — 'night' exists only as a defensive catch for
 * legacy or imported data (see CLAUDE.md → Links design model).
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
 * preferred to loosening the two regexes: loosening leaves two representations circulating forever
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
 * Canonicalise every cell of a design's patterns. Pure — returns a new object, mutates nothing.
 * @param {any} patterns - { "1".."N": { sun..sat } }
 * @returns {Record<string, any>}
 */
export function normalisePatterns(patterns) {
    /** @type {Record<string, any>} */
    const out = {};
    for (const [pos, row] of Object.entries(patterns || {})) {
        if (!row || typeof row !== 'object') continue;
        /** @type {Record<string, any>} */
        const p = {};
        for (const d of DAYS) if (d in /** @type {any} */ (row)) p[d] = canonicaliseShift(/** @type {any} */ (row)[d]);
        out[pos] = p;
    }
    return out;
}

/** Start of a timed shift in minutes since midnight, or null for RD/SPARE. */
export function startMinutes(/** @type {any} */ shift) {
    const m = typeof shift === 'string' && shift.match(/^(\d{2}):(\d{2})-/);
    return m ? (+m[1]) * 60 + (+m[2]) : null;
}

/** End of a timed shift in minutes since midnight, or null for RD/SPARE. */
export function endMinutes(/** @type {any} */ shift) {
    const m = typeof shift === 'string' && shift.match(/-(\d{2}):(\d{2})$/);
    return m ? (+m[1]) * 60 + (+m[2]) : null;
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
 * How many hours a week this design actually gives somebody — the question the panel could not
 * answer until v20.04, and the most basic one anybody asks of a roster.
 *
 * ── SUNDAYS COME OUT, AND THAT IS NOT A DETAIL ────────────────────────────────────────────────
 *
 * Sunday is **not contracted** for any grade here (the rule is enforced in five places across the
 * app — no AL, no absence, ever, on a Sunday). So a Sunday duty is overtime-shaped work sitting on
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
 *            complete: boolean, target: number}}
 */
export function weeklyHours(patterns, rotatingLines = ROTATING_LINES) {
    let totalMin = 0, sundayMin = 0, duties = 0, sundayDuties = 0, unreadable = 0;
    let workingLines = 0, coverLines = 0, unreadableLines = 0;

    for (let w = 1; w <= rotatingLines; w++) {
        const row = /** @type {Record<string, any>} */ (patterns)?.[String(w)] || {};
        let lineIsTimed = false, lineHasWork = false;
        for (const d of DAYS) {
            const s = row[d];
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
        if (DAYS.every(d => row[d] === 'SPARE')) coverLines++;
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

    // ── THE AVERAGE IS OVER THE WHOLE ROTATION, AND A COVER WEEK IS A PAID WEEK (v20.98) ────────
    //
    // Owner, Aug 2026: 35 hours a week averaged across all the lines, and a spare week counts as a
    // full contracted week. Individual weeks vary — 22h here, 42h there — and only the average is
    // the contract.
    //
    // Until v20.98 this divided ex-Sunday duty by the WORKING lines and left cover weeks out of
    // both halves. The reasoning recorded against that was sound as far as it went — dividing by all
    // the lines charges the average with weeks of zero and reports a week nobody works — but the
    // conclusion was wrong: the answer is not to exclude a cover week, it is to stop treating it as
    // zero. A spare week is a person's paid, contracted week; they carry no stored TIMES, which is a
    // fact about how the design is written down, not about whether the week is worked.
    //
    // The two definitions agree on the REQUIREMENT and disagree on the READING, which is why this
    // was invisible: (D + 35s)/L = 35 is exactly D = 35 x working, so a design that satisfies one
    // satisfies the other. They diverge on everything that does NOT hit the target — a short design
    // read the old way looked worse than it is, because the cover weeks that are being paid for were
    // simply not in the sum.
    //
    // An UNFILLED line — no duties, not marked spare — is 0 hours over 1 line, and now drags the
    // average down instead of being skipped. That is correct: it is a week somebody works with
    // nothing in it, the design is not finished, and "Lines not yet designed" says so directly.
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
        duties, sundayDuties, unreadable, unreadableLines,
        // The figure covers only the lines it could measure. `false` is what lets the renderer show
        // a number without endorsing it — see the note beside `unreadableLines` above.
        complete: unreadableLines === 0,
        target: CONTRACTED_HOURS_PER_WEEK,
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
 * Auto-generate the rotating link (lines 1..lines) from per-shift staffing targets.
 *
 * The real roster staffs the day in WAVES — opens around 06:20, a morning
 * build 07:00–08:30, middles 11:00–12:00, afternoons 13:30–14:30, closes
 * 15:00+ running to midnight — so the generator takes a list of shift slots,
 * each with its own time and per-day-class headcount, rather than a single
 * "early" and "late".
 *
 * TWO CONSTRUCTIONS, and the DEFAULT changed at v19.59. `generateLink` tries the
 * settled-week construction first and falls back to the original rotating window
 * only when the targets cannot be met that way. Which one ran is REPORTED, never
 * silent — the two produce visibly different designs.
 *
 * ── 1. SETTLED WEEKS (default, v19.59) ─────────────────────────────────────
 * Measured against the real roster, the old construction was giving people a week
 * nobody at Marylebone has ever worked. Within-week start spread averaged 7h58 and
 * EVERY line exceeded 4h; the real main roster averages 3h44 with 7 of 16 above 4h,
 * because it hands out WEEKS — week 2 is all lates, week 3 all earlies, week 9 all
 * 11:00 middles. FF19 (successive starts more than 2h apart) counted 6 on the real
 * roster and 29 on the generated one. The tool reports FF19, and its own generator
 * was the thing inflating it.
 *
 * So: group the slots into WAVES — start times within `WAVE_SPAN_MINUTES` of each
 * other, the same 2h threshold FF19 uses — give each wave a contiguous BLOCK of
 * lines sized by how much duty it carries, and slide a window inside each block to
 * decide who works which day. A line therefore stays in one wave all week: its exact
 * time can move between 06:20 and 07:15, never between 06:20 and 15:25.
 *
 * Waves rather than exact times, deliberately. Per-TIME blocks are infeasible here —
 * the roster seed produces 23 distinct times over 24 working lines, and several are
 * Saturday-only, so a block per time would need more lines than exist. Waves are also
 * what the real roster does: line 3 works 06:20-14:20 midweek and 06:20-14:00 on the
 * Saturday. Grouping by the FF19 threshold means the within-week movement this
 * construction still allows is, by definition, movement FF19 does not count.
 *
 * ── 2. ROTATING WINDOW (fallback) ──────────────────────────────────────────
 * Picture the lines around a wheel. Each day a window of consecutive lines is on duty
 * and slides forward a few lines, completing exactly one lap per week. Within the
 * window slots run latest-start at the front, earliest at the back.
 *
 * Its documented promise — "a person's week only moves later, never a late finish
 * then an early start" — was NOT TRUE and is now enforced rather than asserted
 * (v19.59). Positions are read mod `working`, so every line wraps from the front of
 * the order to the back exactly once a week; that wrap IS a late-finish-to-early-start
 * step, and it lands on a rest day only when the day's target leaves enough lines
 * resting. At high staffing it does not: with all three slots filling every line of
 * the then-28-line rotation the construction produced **27** short turnarounds, `15:15-23:55` into
 * `06:20-14:20` — 6h25 rest — and the test that "asserted" the promise used a fixture
 * staffing 13 of 24 lines, where the wrap always landed on RD.
 *
 * The strides are no longer near-equal. Each day's stride is capped at
 * `working − (next day's total)`, which is exactly the condition for every wrapping
 * line to be resting the following day, and the lap is distributed in proportion to
 * those caps. When the caps cannot sum to a full lap the targets leave less than one
 * rest day per line per week; the generator REFUSES rather than shipping the phantom
 * guarantee (`restFeasible`).
 *
 * Daily targets are met EXACTLY by both constructions (the window size equals the
 * target headcount for that day).
 *
 * SPARE IS A WHOLE WEEK, NOT A SCATTER OF DAYS (v19.58, owner). A spare line is
 * spare on all seven days: you are cover, you work four days of that week, and
 * you can be put on any range of shifts. The real roster is built this way —
 * main lines 1, 7, 12 and 17 are `SPARE` on every day, and there is not one
 * scattered spare day anywhere in it.
 *
 * The previous model took a per-day-class spare HEADCOUNT and fed it to the
 * window as one more segment. Because the window slides daily, that gave each
 * person spare on some days and a timed duty on others — the opposite of a
 * spare week, and a shape the roster has never had. Daily SP headcount came out
 * right, which is why it went unnoticed: the total was correct and the
 * distribution was wrong.
 *
 * So `spareLines` whole lines are reserved and spread evenly around the wheel,
 * and the rotation is built over the REMAINING lines. Daily targets are still
 * met exactly — the working lines carry them — and every day now shows exactly
 * `spareLines` on standby, as the real roster does.
 *
 * SUNDAY IS NOT CONTRACTED, and the generator does NOT model that (owner, Aug 2026). Sundays appear
 * on the roster as agreed RDW — overtime by agreement, not contracted hours — but here `sun` is
 * simply a third day class with its own headcount, exactly like `weekday` and `sat`. Nothing in this
 * module, `runDesignChecks` or `links-fatigue.js` treats a Sunday duty as voluntary.
 *
 * That is mostly harmless — the cover still has to be found, and for FATIGUE purposes an hour worked
 * is an hour worked however it is paid — but two readings do change:
 *   · the Sunday column is cover you HOPE to fill, not cover you can require, so a Sunday target the
 *     generator meets exactly is a plan rather than a commitment;
 *   · "weekends off" counts Sat-not-worked plus Sun-not-worked, and a Sunday you do not work is the
 *     DEFAULT. `links-adjacency.js` splits days-off from contracted-days-GIVEN for that reason.
 *
 * A SPARE WEEK'S FOUR DAYS COME FROM MON–SAT. The Sunday of a spare week stays RDW if the roster
 * clerk gives it, on top of the four; it is not one of them. All seven days are still marked SPARE,
 * which is what the real roster does and what "available for cover" means — but a reader should not
 * take the four out of seven.
 *
 * @param {Object} opts
 * @param {Array<{time:string, weekday:number, sat:number, sun:number}>} opts.slots
 *   - one entry per distinct shift time, with target headcounts per day class
 * @param {number} [opts.spareLines=0] - how many WHOLE lines are spare weeks
 * @param {number} [opts.lines=ROTATING_LINES]
 * @param {boolean} [opts.requireContract=true] - see `generateLink`; leave it alone outside the
 *   construction tests
 * @returns {Object|null} patterns for "1".."lines", or null if invalid / any day-class total
 *   exceeds the working lines / the targets cannot pay the contracted week
 */
export function generatePatterns(opts) {
    return generateLink(opts).patterns;
}

/** Slots whose starts sit within this span are one WAVE — the same threshold FF19 uses, so the
 *  movement a settled week still allows is by definition movement FF19 does not count. */
export const WAVE_SPAN_MINUTES = 2 * 60;

const TARGET_CLASSES = ['weekday', 'sat', 'sun'];
/** How many days of the week carry each day class — the weight a class has in a week's duty total. */
const CLASS_DAYS = /** @type {Record<string, number>} */ ({ weekday: 5, sat: 1, sun: 1 });

/**
 * The ex-Sunday duty a TARGET TABLE asks for, in minutes per week of rotation.
 *
 * Sunday counts are read and deliberately discarded: Sunday is not contracted, so a Sunday duty
 * sits on TOP of the contracted week and can never help a design reach it. Folding it in would let
 * a link that pays people short look compliant by rostering more Sundays — which is the same
 * flattering error `weeklyHours` excludes Sundays to avoid, arriving from the targets instead of
 * from the patterns.
 *
 * Minutes, not hours, because the comparison it feeds is an equality: `working x 35h` is a whole
 * number of minutes, every duty is a whole number of minutes, and rounding to hours first is how
 * "exactly 35" becomes "about 35".
 * @param {Array<Record<string, any>>} slots
 * @returns {number|null} null when a slot carries a time that cannot be read
 */
export function targetExSundayMinutes(slots) {
    let total = 0;
    for (const s of slots || []) {
        const a = startMinutes(s.time), b = endMinutesAbs(s.time);
        if (a === null || b === null) return null;
        total += (b - a) * (CLASS_DAYS.weekday * (s.weekday ?? 0) + CLASS_DAYS.sat * (s.sat ?? 0));
    }
    return total;
}

/**
 * Group slots into waves: each wave holds every slot starting within `span` of its earliest.
 * Pure and deterministic; slots are read in start-time order, so the wave list is stable.
 * @param {Array<{time:string, weekday:number, sat:number, sun:number}>} slots
 * @param {number} [span]
 * @returns {Array<Array<any>>}
 */
export function groupIntoWaves(slots, span = WAVE_SPAN_MINUTES) {
    const sorted = [...(slots || [])]
        .filter(s => s && startMinutes(s.time) !== null)
        .sort((a, b) => /** @type {number} */ (startMinutes(a.time)) - /** @type {number} */ (startMinutes(b.time)));
    /** @type {Array<Array<any>>} */
    const waves = [];
    for (const s of sorted) {
        const cur = waves[waves.length - 1];
        const from = cur ? /** @type {number} */ (startMinutes(cur[0].time)) : 0;
        if (cur && /** @type {number} */ (startMinutes(s.time)) - from <= span) cur.push(s);
        else waves.push([s]);
    }
    return waves;
}

/** Total headcount a group of slots needs on one day class. */
const classTotal = (/** @type {Array<any>} */ group, /** @type {string} */ cls) =>
    group.reduce((a, s) => a + (s[cls] ?? 0), 0);

/** Duties a group of slots generates in a week — the size of the block it has to be given. */
const waveDuty = (/** @type {Array<any>} */ group) =>
    TARGET_CLASSES.reduce((a, c) => a + CLASS_DAYS[c] * classTotal(group, c), 0);

/** The widest a wave has to be to hold its busiest day — the floor on its block. */
const waveNeed = (/** @type {Array<any>} */ group) =>
    Math.max(...TARGET_CLASSES.map(c => classTotal(group, c)));

/**
 * Merge away any wave too small to fund the lines it needs, into whichever neighbour is closer in
 * time. Returns a new wave list; deterministic, and it always terminates because each pass removes
 * one wave.
 *
 * WHY (measured, v19.59). Splitting purely on the 2h span left the roster seed with a wave holding
 * only the two 08:30 weekend slots — 2 duties, but a floor of 1 line, so one whole line existed to
 * work Saturday and Sunday and nothing else. Days worked per line came out 2 to 6 where the real
 * roster runs 3 to 6 clustered at 5, and the old rotating construction — whose single global window
 * shares the work across every line — was FAIRER. A shape improvement paid for with an unfair link
 * is not an improvement.
 *
 * The real roster solves it the same way: line 3 works 06:20-14:20 midweek and 06:20-14:00 on the
 * Saturday, so its weekend duty comes from its own wave rather than from a weekend-only line.
 *
 * Merging widens a wave past the FF19 threshold (06:20…08:30 is 2h10), so the movement inside it can
 * be a factor the panel counts. That is the right way round: the panel reports it, and a link where
 * somebody works two days a week is the worse answer with nothing to report it at all.
 * @param {Array<Array<any>>} waves
 * @param {number} working
 */
function mergeUnfundedWaves(waves, working) {
    let cur = waves.map(w => w.slice());
    for (let guard = 0; cur.length > 1 && guard < waves.length; guard++) {
        const total = cur.reduce((a, w) => a + waveDuty(w), 0);
        if (!total) break;
        const short = cur.findIndex(w => working * waveDuty(w) / total < waveNeed(w));
        if (short < 0) break;
        // Nearest neighbour by the gap between the two waves' adjoining start times.
        const gapBefore = short > 0
            ? /** @type {number} */ (startMinutes(cur[short][0].time)) - /** @type {number} */ (startMinutes(cur[short - 1][cur[short - 1].length - 1].time))
            : Infinity;
        const gapAfter = short < cur.length - 1
            ? /** @type {number} */ (startMinutes(cur[short + 1][0].time)) - /** @type {number} */ (startMinutes(cur[short][cur[short].length - 1].time))
            : Infinity;
        const into = gapBefore <= gapAfter ? short - 1 : short + 1;
        const merged = into < short ? [...cur[into], ...cur[short]] : [...cur[short], ...cur[into]];
        cur = cur.filter((_, i) => i !== short && i !== into);
        cur.splice(Math.min(into, short), 0, merged);
    }
    return cur;
}

/**
 * Share the working lines out between the waves, in proportion to the duty each carries.
 *
 * Two constraints, and the second is the one that decides feasibility: a wave's block can never be
 * smaller than its busiest day, or the window would have to be wider than the block it slides in.
 * Largest-remainder for the proportional part, then deficient waves are raised to that floor and the
 * surplus taken back from whoever has the most slack — deterministic at every step.
 * @param {Array<Array<any>>} waves
 * @param {number} working
 * @returns {number[]|null} lines per wave, or null when the floors cannot fit
 */
function allocateWaveLines(waves, working) {
    const need = waves.map(waveNeed);
    const duties = waves.map(waveDuty);
    const totalDuty = duties.reduce((a, b) => a + b, 0);
    if (totalDuty === 0) return null;

    const raw = duties.map(d => working * d / totalDuty);
    const out = raw.map(Math.floor);
    let left = working - out.reduce((a, b) => a + b, 0);
    const byRemainder = raw
        .map((v, i) => ({ frac: v - Math.floor(v), i }))
        .sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let k = 0; left > 0; k++, left--) out[byRemainder[k % byRemainder.length].i]++;

    for (let i = 0; i < out.length; i++) if (out[i] < need[i]) out[i] = need[i];
    let over = out.reduce((a, b) => a + b, 0) - working;
    while (over > 0) {
        let best = -1, slack = 0;
        for (let i = 0; i < out.length; i++) {
            const s = out[i] - need[i];
            if (s > slack) { slack = s; best = i; }
        }
        if (best < 0) return null;          // every wave is already at its floor — infeasible
        out[best]--; over--;
    }
    return out.some(n => n <= 0) ? null : out;
}

/**
 * Window starts for a block of `n` lines: strides sum to `n`, one lap per week, and the movement is
 * spread ACROSS the seven days rather than front-loaded into the first few.
 *
 * The obvious `base + (i < rem)` form is wrong for a small block and quietly unfair (v19.59). With
 * n = 3 it gives strides [1,1,1,0,0,0,0], so the window laps in three days and then sits still from
 * Wednesday to Saturday — the same lines work all four of those days and one line catches almost
 * nothing. Measured on the roster seed it produced a line working TWO days a week.
 *
 * `floor((i+1)·n/7) − floor(i·n/7)` distributes the same total evenly (n = 3 → [0,0,1,0,1,0,1]),
 * which shares the work out exactly: all three lines get four days instead of 6/4/2.
 */
function evenStarts(/** @type {number} */ n) {
    /** @type {number[]} */ const starts = [];
    for (let i = 0; i < 7; i++) starts.push(Math.floor(i * n / 7));
    return starts;
}

/**
 * Window starts for the ROTATING fallback, capped so a wrapping line is always resting the next day.
 *
 * A line's position is read mod `working`, so every line wraps from the front of the slot order
 * (latest) to the back (earliest) exactly once a week. That wrap is a late-finish-to-early-start
 * step unless the following day's window has already closed behind it, which is exactly
 * `stride ≤ working − nextTotal`. Distributed in proportion to those caps.
 *
 * Returns null when the caps cannot fund a full lap — the targets then leave under one rest day per
 * line per week, and no phasing can avoid the step. Refusing beats shipping the old promise.
 * @param {number} working
 * @param {number[]} totals - duties on each day, in DAYS order
 * @returns {number[]|null}
 */
function cappedStarts(working, totals) {
    const cap = totals.map((_, i) => Math.max(0, working - totals[(i + 1) % 7]));
    const capSum = cap.reduce((a, b) => a + b, 0);
    if (capSum < working) return null;

    const raw = cap.map(c => working * c / capSum);
    const stride = raw.map(Math.floor);
    let left = working - stride.reduce((a, b) => a + b, 0);
    const byRemainder = raw
        .map((v, i) => ({ frac: v - Math.floor(v), i }))
        .sort((a, b) => b.frac - a.frac || a.i - b.i);
    // Only ever hand a spare unit to a day still under its cap; capSum ≥ working guarantees one exists.
    for (let guard = 0; left > 0 && guard < 7 * working; guard++) {
        const { i } = byRemainder[guard % 7];
        if (stride[i] < cap[i]) { stride[i]++; left--; }
    }
    if (left > 0) return null;

    /** @type {number[]} */ const starts = [];
    let acc = 0;
    for (let i = 0; i < 7; i++) { starts.push(acc); acc += stride[i]; }
    return starts;
}

/**
 * THE WAVES ARE DEALT IN CONTIGUOUS BLOCKS, AND INTERLEAVING THEM HERE WAS TRIED AND REVERTED
 * (v19.60). Read this before "fixing" it again.
 *
 * Laying the waves out contiguously means every morning line, then every middles line, then every
 * afternoon line — and since you move one line a week, that is **11 consecutive weeks of mornings
 * followed by 11 of afternoons** (owner: "a bit excessive and would be unpopular"; the live roster's
 * longest run on much the same shift is 3). The obvious fix is to deal them interleaved, and it does
 * take the raw output from 11 to 2.
 *
 * It is still the wrong place to fix it, measured both ways on the real roster seed:
 *
 *                          raw block   raw short turnarounds   with every switch on
 *   interleaved here            2               2              block 3 · 95min · 8 weekends · 5 long
 *   contiguous (kept)          11               0              block 3 · 95min · 8 weekends · 7 long
 *
 * Alternating waves puts a late wave's 23:55 Saturday next to a morning wave's 06:20 Sunday — a 6h25
 * turnaround the construction had been free of. And it constrains the reorder into a WORSE local
 * optimum: two fewer long weekends for no gain, because both routes reach a longest block of 3
 * anyway.
 *
 * The order of the lines belongs to ONE place — `links-adjacency.js` — and its `variety` objective,
 * on by default, is what keeps the blocks short. That objective has to exist regardless, because
 * `gentle` pulls the other way and would otherwise re-block whatever the generator handed it.
 */

/** Which rows are spare weeks — spread evenly around the wheel so no one gets two cover weeks
 *  back to back. (The real roster's 1/7/12/17 of 20 is roughly, not exactly, even.) */
function spareRowSet(/** @type {number} */ spareLines, /** @type {number} */ lines) {
    const rows = new Set();
    for (let i = 0; i < spareLines; i++) rows.add(Math.round((i * lines) / spareLines) + 1);
    return rows;
}

/**
 * Walk the `lines` rows, filling spare weeks with SPARE and handing every other row to `dayValue`,
 * which is given the row's index within the working rotation.
 * @param {number} lines
 * @param {Set<any>} spareRows
 * @param {(wIndex:number, dayIndex:number, day:string) => string} dayValue
 */
function layOutRows(lines, spareRows, dayValue) {
    /** @type {Record<string, any>} */
    const patterns = {};
    let wIndex = 0;
    for (let row = 1; row <= lines; row++) {
        /** @type {Record<string, any>} */
        const p = {};
        if (spareRows.has(row)) {
            for (const d of DAYS) p[d] = 'SPARE';
            patterns[String(row)] = p;
            continue;
        }
        DAYS.forEach((d, i) => { p[d] = dayValue(wIndex, i, d); });
        patterns[String(row)] = p;
        wIndex++;
    }
    return patterns;
}

/** Pick the slot a position lands on, walking `group` in order against that day class's targets. */
function slotAt(/** @type {Array<any>} */ group, /** @type {string} */ cls, /** @type {number} */ pos) {
    let cum = 0;
    for (const seg of group) {
        const n = seg[cls] ?? 0;
        if (pos < cum + n) return seg.time;
        cum += n;
    }
    return 'RD';
}

/**
 * Generate a link, reporting WHICH construction produced it.
 *
 * `generatePatterns` is the thin wrapper that returns only the patterns; it keeps the older
 * signature because the docs, tests and every existing caller are written against it. Use this one
 * where the mode matters — the two constructions give visibly different designs, and a designer who
 * is not told which they got cannot account for the difference.
 *
 * @param {Object} opts
 * @param {Array<{time:string, weekday:number, sat:number, sun:number}>} opts.slots
 * @param {number} [opts.spareLines=0]
 * @param {number} [opts.lines=ROTATING_LINES]
 * @param {boolean} [opts.settled=true]
 * @param {boolean} [opts.requireContract=true] refuse targets that cannot pay the contracted week - false forces the rotating fallback (for comparison)
 * @returns {{patterns: Object|null, mode: 'settled'|'rotating'|null, waves: number,
 *            reason: string|null, askedMinutes?: number, needMinutes?: number, working?: number}}
 *   The three extra fields accompany `short-hours` ONLY. They are the whole actionable content of
 *   that refusal — a caller told merely that the targets are short cannot say by how much, and the
 *   gap is the only number a designer can do anything with.
 */
export function generateLink({ slots, spareLines = 0, lines = ROTATING_LINES, settled = true,
                               requireContract = true }) {
    const fail = (/** @type {string} */ reason) => ({ patterns: null, mode: null, waves: 0, reason });

    if (!Array.isArray(slots) || slots.length === 0) return fail('no-slots');
    if (!Number.isInteger(spareLines) || spareLines < 0 || spareLines >= lines) return fail('bad-spare-lines');

    const working = lines - spareLines;
    /** @type {Record<string, number>} */
    const totalFor = {};
    for (const cls of TARGET_CLASSES) {
        let total = 0;
        for (const s of /** @type {Array<Record<string, any>>} */ (slots)) {
            const n = s[cls] ?? 0;
            if (!Number.isInteger(n) || n < 0) return fail('bad-target');
            if (startMinutes(s.time) === null) return fail('bad-time');
            total += n;
        }
        // The spare lines cannot carry a timed duty, so the targets have to fit
        // in what is left. Checked against `working`, not `lines`.
        if (total > working) return fail('over-capacity');
        totalFor[cls] = total;
    }

    // ── THE CONTRACT IS A CONSTRAINT ON THE TARGETS, NOT A REPORT ON THE RESULT (v20.98) ────────
    //
    // Owner, Aug 2026: a generated link must average exactly the contracted week ex-Sunday, and one
    // that falls short must not be produced at all.
    //
    // It is checked HERE, against the targets, rather than against the finished patterns — and the
    // difference is not tidiness. The arithmetic is settled before a single cell is laid out: the
    // duty a target table asks for is fixed, the working lines are fixed, and every construction
    // places exactly those duties on exactly those lines. So no arrangement can rescue a short
    // table, and a check on the output would be re-measuring an answer already determined by the
    // input — reporting a build failure for what is really a decision about how much work there is.
    //
    // Refusing on SHORT only. Over-contract is a different thing entirely: those hours get paid as
    // overtime or absorbed by adding lines, so the design is workable and the Design-checks row
    // already says so. Refusing it here would block the ordinary case of a link built to carry a
    // known surplus.
    //
    // MINUTES, and an exact comparison. `working x 35h` is a whole number of minutes and every duty
    // is a whole number of minutes, so "exactly" can be meant literally; rounding to hours first is
    // how exactly-35 quietly becomes about-35.
    // ── THE OPT-OUT, AND WHY IT IS NOT A BACK DOOR ──────────────────────────────────────────────
    //
    // `requireContract` defaults ON, so every real call is gated: `links-app.js` never passes it,
    // and `links-contract-parity.test.mjs` fails if it ever does. What passes `false` is the
    // CONSTRUCTION tests — wave containment, spare spread, turnarounds, fairness — whose fixtures
    // describe a rotation shape rather than a week's worth of work.
    //
    // Making those fixtures carry 35 hours was tried first and rejected: an exact-fit target set
    // exists, but adopting it would change which waves merge and how the load spreads, which are
    // the very things those tests assert. Altering a scenario to satisfy an unrelated rule leaves
    // the test green and no longer about what it says it is about.
    if (requireContract) {
        const askedMin = targetExSundayMinutes(/** @type {any} */ (slots));
        if (askedMin === null) return fail('bad-time');
        const needMin = working * CONTRACTED_HOURS_PER_WEEK * 60;
        if (askedMin < needMin) {
            return { ...fail('short-hours'), askedMinutes: askedMin, needMinutes: needMin, working };
        }
    }

    const spareRows = spareRowSet(spareLines, lines);
    // A slot nobody works on any day is dropped before grouping — it would otherwise claim a wave,
    // and a wave with no duty has no lines to give it.
    const used = slots.filter(s => TARGET_CLASSES.reduce((a, c) => a + (/** @type {any} */ (s)[c] ?? 0), 0) > 0);
    const waves = mergeUnfundedWaves(groupIntoWaves(used), working);

    if (settled && waves.length) {
        const alloc = allocateWaveLines(waves, working);
        if (alloc) {
            // Each wave owns a contiguous block of the working rotation, and slides its own window
            // inside it. A line therefore never leaves its wave, which is what makes the week settled.
            /** @type {Array<{group:Array<any>, n:number, starts:number[]}>} */
            const plans = waves.map((w, i) => ({ group: w, n: alloc[i], starts: evenStarts(alloc[i]) }));
            /** @type {Array<[number, number]>} */
            const owner = [];
            plans.forEach((plan, wi) => { for (let k = 0; k < plan.n; k++) owner.push([wi, k]); });

            const patterns = layOutRows(lines, spareRows, (wIndex, i, d) => {
                const [wi, idx] = owner[wIndex];
                const plan = plans[wi];
                const pos = ((idx - plan.starts[i]) % plan.n + plan.n) % plan.n;
                return slotAt(plan.group, dayClass(d), pos);
            });
            return { patterns, mode: 'settled', waves: waves.length, reason: null };
        }
    }

    // Fallback: the original rotating window, with the rest-feasible stride caps.
    const totals = DAYS.map(d => totalFor[dayClass(d)]);
    const starts = cappedStarts(working, totals);
    if (!starts) return fail('no-rest');

    // Front-to-back window order: latest start first, earliest last, so a person's position moves
    // front-ward through their week and their shifts progress earliest → latest.
    const sorted = [.../** @type {Array<Record<string, any>>} */ (slots)]
        .sort((a, b) => /** @type {number} */ (startMinutes(b.time)) - /** @type {number} */ (startMinutes(a.time)));

    const patterns = layOutRows(lines, spareRows, (wIndex, i, d) => {
        const pos = ((wIndex - starts[i]) % working + working) % working;
        return slotAt(sorted, dayClass(d), pos);
    });
    return { patterns, mode: 'rotating', waves: waves.length, reason: null };
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
 *   balance: { early:number, late:number, spare:number, worked:number }
 * }}
 */
export function runDesignChecks(patterns, rotatingLines = ROTATING_LINES) {
    const shiftAt = (/** @type {any} */ w, /** @type {any} */ d) => /** @type {Record<string, any>} */ (patterns)[String(w)]?.[d] ?? 'RD';
    const isWorked = (/** @type {any} */ s) => s !== 'RD' && s !== 'OFF';

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
        if (DAYS.every(d => !isWorked(shiftAt(w, d)))) unfilledLines.push(w);
    }

    // Full weekends off: Sat of week w + Sun of week w+1 both rest days.
    let weekendsOff = 0;
    for (let w = 1; w <= rotatingLines; w++) {
        const nextW = (w % rotatingLines) + 1;
        if (!isWorked(shiftAt(w, 'sat')) && !isWorked(shiftAt(nextW, 'sun'))) weekendsOff++;
    }

    // Short turnarounds: consecutive timed shifts with less than MIN_REST_MINUTES
    // between the end of one and the start of the next. SPARE has no times, skip.
    // `endMinutesAbs` (not `endMinutes`) so a duty running past midnight eats into the rest it is
    // followed by instead of being credited with a phantom extra day of it — see that function.
    const turnarounds = [];
    for (let t = 0; t < N; t++) {
        const a = seq[t], b = seq[(t + 1) % N];
        const end = endMinutesAbs(a.shift), start = startMinutes(b.shift);
        if (end === null || start === null) continue;
        const rest = (24 * 60 - end) + start;
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

    // Early/late/spare balance across all worked cells.
    const balance = { early: 0, late: 0, spare: 0, worked: 0 };
    for (const s of seq) {
        const type = classifyShift(s.shift);
        if (type === 'rd') continue;
        balance.worked++;
        if (type === 'early') balance.early++;
        else if (type === 'spare') balance.spare++;
        else balance.late++; // night folds into late here — defensive only, CEAs have no nights
    }

    return { weekendsOff, weekendsOffPct: Math.round(weekendsOff / rotatingLines * 100), totalWeeks: rotatingLines, unfilledLines, turnarounds, longestStretch, balance };
}
