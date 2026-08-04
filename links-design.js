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
 */

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** The rotation length. ONE declaration (v19.38) — it previously sat as a literal in three places
 *  (links-app's TOTAL_POS + ROTATING_LINES, links-analysis's own pair, and the default parameter of
 *  every function here), with a comment in links-analysis.js claiming they "stay in step without a
 *  shared import". That is a hope, not a mechanism. Every line rotates, so the grid height, the
 *  checks window and the generator output are necessarily the SAME number — there is no reading of
 *  this app where they differ. */
export const ROTATING_LINES = 28;

/** Minimum rest between two timed shifts on consecutive days, in minutes. */
export const MIN_REST_MINUTES = 12 * 60;

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
 * @param {number} [totalPos=28]
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
 * How it works ("rotating window"): picture the 28 lines around a wheel. Each
 * day, a window of consecutive lines is "on duty"; the window slides forward
 * a few lines every day, completing exactly one lap per week — which is what
 * makes "everyone moves down one line each week" seamless. Within the window,
 * slots are ordered latest-start at the front and earliest-start at the back
 * (spare in the middle), so as the window slides past a line its week runs
 * earliest → … → latest → rest days: a forward (body-clock-friendly)
 * rotation. Moving your body clock LATER each day is far easier than dragging
 * it earlier, which is why the generator never produces a late shift followed
 * by an early start the next morning.
 *
 * Daily targets are met EXACTLY by construction (the window size equals the
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
 * @param {number} [opts.lines=28]
 * @returns {Object|null} patterns for "1".."lines", or null if invalid /
 *   any day-class total exceeds the working lines
 */
export function generatePatterns({ slots, spareLines = 0, lines = ROTATING_LINES }) {
    if (!Array.isArray(slots) || slots.length === 0) return null;
    if (!Number.isInteger(spareLines) || spareLines < 0 || spareLines >= lines) return null;

    const working = lines - spareLines;
    const classes = ['weekday', 'sat', 'sun'];
    for (const cls of classes) {
        let total = 0;
        for (const s of /** @type {Array<Record<string, any>>} */ (slots)) {
            const n = s[cls] ?? 0;
            if (!Number.isInteger(n) || n < 0) return null;
            if (startMinutes(s.time) === null) return null;
            total += n;
        }
        // The spare lines cannot carry a timed duty, so the targets have to fit
        // in what is left. Checked against `working`, not `lines`.
        if (total > working) return null;
    }

    // Front-to-back window order: latest start first, earliest last. A person's
    // position moves front-ward through their week, so they progress earliest →
    // latest across the days they work — a forward, body-clock-friendly rotation.
    const sorted = [.../** @type {Array<Record<string, any>>} */ (slots)]
        .sort((a, b) => /** @type {number} */ (startMinutes(b.time)) - /** @type {number} */ (startMinutes(a.time)));

    // Window start positions: strides sum to `working` across the 7 days so the
    // wheel completes exactly one lap per week over the WORKING lines.
    const base = Math.floor(working / 7);
    const rem  = working - base * 7;
    /** @type {number[]} */
    const starts = [];
    let acc = 0;
    for (let i = 0; i < 7; i++) {
        starts.push(acc);
        acc += base + (i < rem ? 1 : 0);
    }

    // Which of the `lines` rows are spare weeks — spread evenly around the wheel,
    // as the real roster does (main: 1, 7, 12, 17 of 20).
    const spareRows = new Set();
    for (let i = 0; i < spareLines; i++) spareRows.add(Math.round((i * lines) / spareLines) + 1);

    /** @type {Record<string, any>} */
    const patterns = {};
    let wIndex = 0;                       // position of this row within the working rotation
    for (let row = 1; row <= lines; row++) {
        /** @type {Record<string, any>} */
        const p = {};
        if (spareRows.has(row)) {
            for (const d of DAYS) p[d] = 'SPARE';
            patterns[String(row)] = p;
            continue;
        }
        DAYS.forEach((d, i) => {
            const cls = dayClass(d);
            const pos = ((wIndex - starts[i]) % working + working) % working;
            let cum = 0;
            let val = 'RD';
            for (const seg of /** @type {Array<Record<string, any>>} */ (sorted)) {
                const n = seg[cls] ?? 0;
                if (pos < cum + n) { val = seg.time; break; }
                cum += n;
            }
            p[d] = val;
        });
        patterns[String(row)] = p;
        wIndex++;
    }
    return patterns;
}

/**
 * Quality checks for the rotating link. Staff work line w one week, line w+1
 * the next (wrapping), so the design's quality lives BETWEEN the rows too:
 * the weekend between two weeks is Sat of line w + Sun of line w+1.
 *
 * @param {Object} patterns - { "1".."N": { sun..sat } }
 * @param {number} [rotatingLines=28] - all 28 lines rotate
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

    // Longest run of consecutive worked days (SPARE counts as worked),
    // measured around the full circular rotation.
    let longestStretch = 0;
    if (seq.every(s => isWorked(s.shift))) {
        longestStretch = N;
    } else {
        let run = 0;
        // Doubling the sequence handles runs that wrap across the cycle end.
        for (let t = 0; t < N * 2; t++) {
            if (isWorked(seq[t % N].shift)) {
                run++;
                if (run > longestStretch) longestStretch = Math.min(run, N);
            } else {
                run = 0;
            }
        }
    }

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
