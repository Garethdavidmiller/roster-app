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
 * Overnight ends (end <= start) are clamped to midnight — defensive only,
 * CEA shifts never wrap.
 * @param {Object} patterns - { "1".."N": { sun..sat } }
 * @param {number} [totalPos=28]
 * @returns {Object.<string,{hours:number[], spare:number}>} keyed by day
 */
export function calcHourlyCoverage(patterns, totalPos = 28) {
    const out = /** @type {Object.<string,{hours:number[], spare:number}>} */ ({});
    for (const d of DAYS) out[d] = { hours: new Array(24).fill(0), spare: 0 };
    for (let pos = 1; pos <= totalPos; pos++) {
        const p = patterns[String(pos)];
        if (!p) continue;
        for (const d of DAYS) {
            const s = p[d] ?? 'RD';
            if (s === 'RD' || s === 'OFF') continue;
            if (s === 'SPARE') { out[d].spare++; continue; }
            const st = startMinutes(s);
            const enRaw = endMinutes(s);
            if (st === null || enRaw === null) continue;
            const en = enRaw <= st ? 24 * 60 : enRaw;
            for (let h = 0; h < 24; h++) {
                if (st < (h + 1) * 60 && en > h * 60) out[d].hours[h]++;
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
 * @param {Object} opts
 * @param {Array<{time:string, weekday:number, sat:number, sun:number}>} opts.slots
 *   - one entry per distinct shift time, with target headcounts per day class
 * @param {{weekday:number, sat:number, sun:number}} [opts.spare] - standby targets
 * @param {number} [opts.lines=28]
 * @returns {Object|null} patterns for "1".."lines", or null if invalid /
 *   any day-class total exceeds lines
 */
export function generatePatterns({ slots, spare = { weekday: 0, sat: 0, sun: 0 }, lines = 28 }) {
    if (!Array.isArray(slots) || slots.length === 0) return null;
    const classes = ['weekday', 'sat', 'sun'];
    for (const cls of classes) {
        let total = spare[cls] ?? 0;
        if (!Number.isInteger(total) || total < 0) return null;
        for (const s of slots) {
            const n = s[cls] ?? 0;
            if (!Number.isInteger(n) || n < 0) return null;
            if (startMinutes(s.time) === null) return null;
            total += n;
        }
        if (total > lines) return null;
    }

    // Front-to-back window order: latest start first, earliest last, spare in
    // the middle. A person's position moves front-ward through their week, so
    // they progress earliest → spare → latest across the days they work.
    const sorted = [...slots].sort((a, b) => startMinutes(b.time) - startMinutes(a.time));
    const mid = Math.floor(sorted.length / 2);
    const segdefs = [
        ...sorted.slice(0, mid),
        { isSpare: true },
        ...sorted.slice(mid),
    ];

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
            const cls = dayClass(d);
            const pos = (((row - 1) - starts[i]) % lines + lines) % lines;
            let cum = 0;
            let val = 'RD';
            for (const seg of segdefs) {
                const n = seg.isSpare ? (spare[cls] ?? 0) : (seg[cls] ?? 0);
                if (pos < cum + n) { val = seg.isSpare ? 'SPARE' : seg.time; break; }
                cum += n;
            }
            p[d] = val;
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
export function runDesignChecks(patterns, rotatingLines = 28) {
    const shiftAt = (w, d) => patterns[String(w)]?.[d] ?? 'RD';
    const isWorked = s => s !== 'RD' && s !== 'OFF';

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

    return { weekendsOff, weekendsOffPct: Math.round(weekendsOff / rotatingLines * 100), totalWeeks: rotatingLines, unfilledLines, turnarounds, longestStretch, balance };
}
