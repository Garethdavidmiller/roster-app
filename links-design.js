/**
 * links-design.js — Pure link-design maths for links.html. No DOM, no Firebase.
 *
 * Owns: shift classification, custom-time validation, coverage counting,
 *   the auto-generator (rotating-window construction), and the design
 *   quality checks (weekends off, short turnarounds, longest stretch,
 *   early/late balance).
 * Edit here for: generator algorithm, check thresholds, coverage maths.
 * Tested by links-design.test.mjs.
 */

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

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
    const h = parseInt(shift.slice(0, 2), 10);
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
    return `${h1.padStart(2, '0')}:${m1}-${h2.padStart(2, '0')}:${m2}`;
}

/** Start of a timed shift in minutes since midnight, or null for RD/SPARE. */
export function startMinutes(shift) {
    const m = typeof shift === 'string' && shift.match(/^(\d{2}):(\d{2})-/);
    return m ? (+m[1]) * 60 + (+m[2]) : null;
}

/** End of a timed shift in minutes since midnight, or null for RD/SPARE. */
export function endMinutes(shift) {
    const m = typeof shift === 'string' && shift.match(/-(\d{2}):(\d{2})$/);
    return m ? (+m[1]) * 60 + (+m[2]) : null;
}

/**
 * Count early/late/spare/night/rd per day across all positions.
 * @param {Object} patterns - { "1".."N": { sun..sat } }
 * @param {number} totalPos
 */
export function calcCoverage(patterns, totalPos = 28) {
    const cov = {};
    for (const d of DAYS) cov[d] = { early: 0, late: 0, spare: 0, night: 0, rd: 0 };
    for (let pos = 1; pos <= totalPos; pos++) {
        const p = patterns[String(pos)];
        for (const d of DAYS) {
            const type = classifyShift(p ? (p[d] ?? 'RD') : 'RD');
            cov[d][type]++;
        }
    }
    return cov;
}

/**
 * Auto-generate the rotating link (lines 1..lines) from daily staffing targets.
 *
 * How it works ("rotating window"): picture the 27 lines around a wheel. Each
 * day, a window of (early+late+spare) consecutive lines is "on duty"; the
 * window slides forward a few lines every day, completing exactly one full
 * lap per week — which is what makes "everyone moves down one line each week"
 * seamless. Within the window, late shifts sit at the front and earlies at
 * the back, so as the window slides past a line its week runs
 * earlies → spare → lates → rest days: a forward (body-clock-friendly)
 * rotation. Moving your body clock LATER each day is far easier than
 * dragging it earlier, which is why the generator never produces a late
 * shift followed by an early the next morning.
 *
 * Daily targets are met EXACTLY by construction (the window size equals the
 * target headcount).
 *
 * @param {Object} opts
 * @param {{early:number, late:number, spare:number}} opts.monSat - targets for Mon–Sat
 * @param {{early:number, late:number, spare:number}} opts.sunday - targets for Sunday
 * @param {string} opts.earlyTime - e.g. '06:20-14:20'
 * @param {string} opts.lateTime  - e.g. '15:15-23:55'
 * @param {number} [opts.lines=27]
 * @returns {Object|null} patterns for "1".."lines", or null if a target exceeds lines
 */
export function generatePatterns({ monSat, sunday, earlyTime, lateTime, lines = 27 }) {
    for (const t of [monSat, sunday]) {
        if (t.early + t.late + t.spare > lines) return null;
        if (t.early < 0 || t.late < 0 || t.spare < 0) return null;
    }
    // Window start positions: strides sum to `lines` across the 7 days so the
    // wheel completes exactly one lap per week (the rotation is seamless).
    const base = Math.floor(lines / 7);
    const rem  = lines - base * 7;
    const starts = [];
    let acc = 0;
    for (let i = 0; i < 7; i++) {
        starts.push(acc);
        acc += base + (i < rem ? 1 : 0);
    }
    const patterns = {};
    for (let row = 1; row <= lines; row++) {
        const p = {};
        DAYS.forEach((d, i) => {
            const t   = i === 0 ? sunday : monSat;
            const W   = t.early + t.late + t.spare;
            const pos = (((row - 1) - starts[i]) % lines + lines) % lines;
            if (pos >= W)                    p[d] = 'RD';
            else if (pos < t.late)           p[d] = lateTime;   // front of window
            else if (pos < t.late + t.spare) p[d] = 'SPARE';
            else                             p[d] = earlyTime;  // back of window
        });
        patterns[String(row)] = p;
    }
    return patterns;
}

/**
 * Quality checks for the rotating link. Staff work line w one week, line w+1
 * the next (wrapping), so the design's quality lives BETWEEN the rows too:
 * the weekend between two weeks is Sat of line w + Sun of line w+1.
 *
 * @param {Object} patterns - { "1".."N": { sun..sat } }
 * @param {number} [rotatingLines=27] - line 28 (fixed) is excluded
 * @returns {{
 *   weekendsOff: number, totalWeeks: number,
 *   turnarounds: Array<{fromLine:number, fromDay:string, fromShift:string,
 *                       toLine:number, toDay:string, toShift:string, restMinutes:number}>,
 *   longestStretch: number,
 *   balance: { early:number, late:number, spare:number, worked:number }
 * }}
 */
export function runDesignChecks(patterns, rotatingLines = 27) {
    const shiftAt = (w, d) => patterns[String(w)]?.[d] ?? 'RD';
    const isWorked = s => s !== 'RD' && s !== 'OFF';

    // One person's journey through the whole rotation, day by day.
    const seq = [];
    for (let w = 1; w <= rotatingLines; w++) {
        for (const d of DAYS) seq.push({ line: w, day: d, shift: shiftAt(w, d) });
    }
    const N = seq.length;

    // Full weekends off: Sat of week w + Sun of week w+1 both rest days.
    let weekendsOff = 0;
    for (let w = 1; w <= rotatingLines; w++) {
        const nextW = (w % rotatingLines) + 1;
        if (!isWorked(shiftAt(w, 'sat')) && !isWorked(shiftAt(nextW, 'sun'))) weekendsOff++;
    }

    // Short turnarounds: consecutive timed shifts with less than MIN_REST_MINUTES
    // between the end of one and the start of the next. SPARE has no times, skip.
    const turnarounds = [];
    for (let t = 0; t < N; t++) {
        const a = seq[t], b = seq[(t + 1) % N];
        const end = endMinutes(a.shift), start = startMinutes(b.shift);
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

    return { weekendsOff, totalWeeks: rotatingLines, turnarounds, longestStretch, balance };
}
