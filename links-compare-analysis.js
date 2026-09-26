// @ts-check
/**
 * links-compare-analysis.js — what the difference between two Links designs MEANS, for compare mode.
 * Pure: no DOM, no Firebase. `links-compare.js` renders it; `links-compare-analysis.test.mjs` pins it.
 *
 * ── WHY THIS EXISTS (v24.25) ────────────────────────────────────────────────────────────────────
 *
 * Compare mode showed two grids with a gold cell diff, and from v22.60 a strip of four headline
 * figures. The Coverage and Design-checks cards below still described only the ACTIVE design. So the
 * two reasons anybody compares proposals — their cover against the service, and their fatigue
 * findings — were the one thing compare mode did not do. LINKS_DEC2026_PLAN.md recorded it as
 * "deliberately deferred, not rejected … built once there are two real proposals to compare", and by
 * September 2026 there were twenty-two.
 *
 * ── FOUR RULES AN EDIT CAN BREAK ────────────────────────────────────────────────────────────────
 *
 * 1. **Every figure comes from the function the single-design card calls, called the same way.**
 *    `summariseDemand` with the design's OWN window, `peakHours` on the same profile,
 *    `assessHardLimits`, `assessFatigue`. A comparison that computed any of these its own way would
 *    let the two views report one design differently a few seconds apart — the failure the v22.60
 *    strip was written to rule out.
 * 2. **It scores nothing and picks no winner.** Each row is `A → B`. The fatigue panel's own rule
 *    stands here too: a factor is PRESENT, STANDING or CLEAR, never good or bad, and nothing here may
 *    turn a count into a verdict.
 * 3. **An unchanged figure is still reported.** "The same in both" and "not measured" must never look
 *    alike — the app's most repeated defect. Fatigue factors that read the same are COUNTED, and the
 *    ones present in both are NAMED, because a factor both designs carry is exactly the finding a
 *    reader comparing them could miss.
 * 4. **Each design is read against its own window**, and the result says when the two differ. Compare
 *    mode diffs cells, not windows; two designs built to different spans are not like for like, and
 *    the uncovered-hours figure is where that would otherwise hide.
 */
import { DAYS, ROTATING_LINES, calcHourlyCoverage } from './links-design.js';
import { assessFatigue } from './links-fatigue.js';
import { assessHardLimits } from './links-limits.js';
import { normaliseWindow, windowForDay, windowMinutes, windowsDiffer } from './links-window.js';
import { DEC_2026_DEMAND, DEC_2026_MOVEMENTS, DAY_CLASSES, peakHours, summariseDemand } from './links-demand.js';

/** The five days the weekday demand class stands for. */
const WEEKDAYS = Object.freeze(['mon', 'tue', 'wed', 'thu', 'fri']);

/** A window row's staffed span, in minutes — the same conversion links-analysis.js makes. */
const minutesOf = (/** @type {{start: string, end: string}} */ row) => ({
    start: /** @type {number} */ (windowMinutes(row.start)),
    end:   /** @type {number} */ (windowMinutes(row.end)),
});

/**
 * One design read against the service, exactly as the Coverage card reads it.
 * @param {{ patterns: Record<string, any>, window?: any }} design
 * @param {number} lines
 */
function readAgainstService(design, lines) {
    const hourly = calcHourlyCoverage(design.patterns, lines);
    const win = normaliseWindow(design.window);
    const sum = summariseDemand({
        profile: DEC_2026_DEMAND,
        movements: DEC_2026_MOVEMENTS,
        hourly,
        days: DAYS,
        windowFor: (day) => minutesOf(windowForDay(win, day)),
    });
    return { hourly, sum };
}

/**
 * @typedef {{ status: string, value: any }} Reading
 * @typedef {{ code: string, title: string, family: string, confirm: boolean, threshold?: number|string,
 *             a: Reading, b: Reading }} FactorChange
 */

/**
 * What the difference between two designs means.
 *
 * @param {{ patterns: Record<string, any>, window?: any }} a  the ACTIVE design
 * @param {{ patterns: Record<string, any>, window?: any }} b  the one it is compared with
 * @param {{ lines?: number }} [opts]
 */
export function compareDesigns(a, b, { lines = ROTATING_LINES } = {}) {
    const sa = readAgainstService(a, lines), sb = readAgainstService(b, lines);

    // THE BUSIEST HOUR OF EACH DAY CLASS, BY TRAIN LENGTH — the measure the heat map's demand row is
    // shaded by. Taken from the profile, not from either design, so both are asked about the same
    // hour. A class with no busiest hour (an empty profile row) is left out rather than invented.
    //
    // THE WEEKDAY CLASS IS FIVE DAYS OF COVER, NOT ONE. `DAY_CLASSES` names Monday as the weekday
    // representative, which is right for the DEMAND profile (the timetable is the same Mon–Fri) and
    // wrong for a design's cover, which varies by day. v24.25 read Monday's cover and labelled it
    // Mon–Fri, so a design bare at 17:00 on a Friday read as fully staffed. The figure is now the
    // FEWEST on duty on any weekday, and `where` names the day(s) that have it.
    const busiest = [];
    for (const { cls, day, label } of DAY_CLASSES) {
        const hour = peakHours(DEC_2026_DEMAND, cls).byCars;
        if (hour === null) continue;
        const days = cls === 'weekday' ? WEEKDAYS : [day];
        const fewest = (/** @type {any} */ hourly) => {
            const on = days.map(d => ({ d, n: hourly?.[d]?.hours?.[hour] ?? 0 }));
            const n = Math.min(...on.map(x => x.n));
            return { n, where: on.filter(x => x.n === n).map(x => x.d) };
        };
        const fa = fewest(sa.hourly), fb = fewest(sb.hourly);
        busiest.push({ cls, label, hour, a: fa.n, b: fb.n,
            fewestOn: { a: fa.where, b: fb.where }, days: days.length });
    }

    const uncovered = (/** @type {ReturnType<typeof summariseDemand>} */ sum) =>
        ({ hours: sum.uncovered.length, cars: sum.uncoveredCars, where: sum.uncovered });

    // Hard limits, check by check. Both designs run the same list, so the ids pair up; a check only
    // one side reports (an empty design reports `unknown`) is still shown, with the other side blank.
    const la = assessHardLimits(a.patterns, lines), lb = assessHardLimits(b.patterns, lines);
    const ids = [...new Set([...la.checks.map(c => c.id), ...lb.checks.map(c => c.id)])];
    const limits = ids.map((id) => {
        const x = la.checks.find(c => c.id === id), y = lb.checks.find(c => c.id === id);
        return {
            id, title: (x ?? y)?.title ?? id,
            a: x ? { status: x.status, value: x.value } : null,
            b: y ? { status: y.status, value: y.value } : null,
        };
    });

    // Fatigue, factor by factor. A factor CHANGES when its status or its value moves; the rest are
    // counted, and those present in BOTH are named (rule 3).
    const fa = assessFatigue(a.patterns, lines), fb = assessFatigue(b.patterns, lines);
    // Paired on code AND title, never code alone: MRSF is three rows under one code (the most
    // restrictive, the second and the third), and a Map keyed on the code keeps only the last, so each
    // MRSF row in A would be compared with B's THIRD.
    const key = (/** @type {{code: string, title: string}} */ r) => `${r.code}|${r.title}`;
    const byCode = new Map(fb.results.map(r => [key(r), r]));
    /** @type {FactorChange[]} */
    const changed = [];
    /** @type {Array<{code: string, title: string}>} */
    const presentInBoth = [];
    let unchanged = 0;
    for (const r of fa.results) {
        const o = byCode.get(key(r));
        if (!o) continue;
        // Present on both sides is named whatever the figures — asked BEFORE the same-reading test,
        // or a factor both designs carry at different values is never listed as carried by both.
        if (r.status === 'present' && o.status === 'present') presentInBoth.push({ code: r.code, title: r.title });
        const same = r.status === o.status && String(r.value ?? '') === String(o.value ?? '');
        if (same) { unchanged++; continue; }
        // The CAVEATS travel with the reading (v24.25). v24.25 kept only status and value, so a factor
        // whose definition is still to be confirmed read here as a bare fact, and a figure lost the
        // threshold that says what it is measured against. The Design checks card shows both; a
        // comparison that dropped them would state the same finding more strongly than the card does.
        changed.push({ code: r.code, title: r.title, family: r.family,
            confirm: Boolean(r.confirm || o.confirm), threshold: r.threshold ?? o.threshold,
            a: { status: r.status, value: r.value }, b: { status: o.status, value: o.value } });
    }

    return {
        windowsDiffer: windowsDiffer(a.window, b.window),
        service: { uncovered: { a: uncovered(sa.sum), b: uncovered(sb.sum) }, busiest },
        limits,
        fatigue: { present: { a: fa.present, b: fb.present }, changed, presentInBoth, unchanged,
            // Either side's hours being a floor makes every hours comparison a floor (spare weeks).
            hoursAreFloor: Boolean(fa.hoursAreFloor || fb.hoursAreFloor) },
    };
}
