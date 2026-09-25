// links-compare-analysis.test.mjs — what the difference between two Links designs MEANS (v24.25).
// Pure: no DOM, no install. The render is pinned in links-compare.test.mjs; this pins the arithmetic.
//
// The fixtures are REAL designs: two proposal sheets from docs/proposals, whose fingerprints the
// regenerate script checks, so a comparison asserted here is one a designer would actually make.
// Organised by what a wrong answer costs: a comparison that paired the wrong rows, read a design
// against the other's hours, or hid a factor both carry would mislead the room it is taken into.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareDesigns } from './links-compare-analysis.js';
import { assessFatigue } from './links-fatigue.js';
import { assessHardLimits } from './links-limits.js';
import { calcHourlyCoverage, ROTATING_LINES } from './links-design.js';

const sheet = (/** @type {string} */ f) => JSON.parse(readFileSync(new URL(`./docs/proposals/${f}`, import.meta.url), 'utf8'));
const PT = { patterns: sheet('Pinned-Turns-PT-24-P34.json').patterns };   // zero factors present
const FT = { patterns: sheet('Fifteen-Turns-FT-24-EXT.json').patterns };  // seven present, an 11h15 rest

test('two identical designs: nothing changes, and every factor is counted as the same', () => {
    const r = compareDesigns(PT, PT);
    assert.deepEqual(r.fatigue.changed, []);
    assert.equal(r.fatigue.unchanged, assessFatigue(PT.patterns).results.length, 'every factor is accounted for');
    assert.deepEqual(r.service.uncovered.a, r.service.uncovered.b);
    for (const p of r.service.busiest) assert.equal(p.a, p.b);
});

test('a factor present in BOTH is named — it is the finding a comparison is likeliest to hide', () => {
    const r = compareDesigns(FT, FT);
    const present = assessFatigue(FT.patterns).results.filter(x => x.status === 'present');
    assert.ok(present.length > 0, 'the fixture carries present factors');
    assert.deepEqual(r.fatigue.presentInBoth.map(p => p.code + p.title), present.map(p => p.code + p.title));
});

test('the factors that moved are reported with BOTH readings, never a verdict', () => {
    const r = compareDesigns(PT, FT);
    assert.equal(r.fatigue.present.a, assessFatigue(PT.patterns).present);
    assert.equal(r.fatigue.present.b, assessFatigue(FT.patterns).present);
    const ff11 = r.fatigue.changed.find(c => c.code === 'FF11');
    assert.ok(ff11, 'FF11 moves between these two designs');
    assert.equal(ff11.a.status, 'clear');
    assert.equal(ff11.b.status, 'present');
    for (const c of r.fatigue.changed) {
        assert.ok(!('better' in c) && !('worse' in c) && !('winner' in c), 'nothing is scored');
    }
});

test('MRSF rows are paired by title, not collapsed onto one code', () => {
    // Three rows share the code MRSF. Keyed on the code alone, every MRSF row in A was compared with
    // B's LAST MRSF row, so a clear-to-present change on the first could vanish or be misreported.
    const r = compareDesigns(PT, FT);
    const mrsf = r.fatigue.changed.filter(c => c.code === 'MRSF');
    const byTitle = new Map(assessFatigue(FT.patterns).results.filter(x => x.code === 'MRSF').map(x => [x.title, x]));
    assert.ok(mrsf.length >= 2, 'more than one MRSF row moves between these designs');
    for (const c of mrsf) {
        assert.equal(c.b.status, byTitle.get(c.title)?.status, `${c.title}: B's reading is B's own row`);
        assert.equal(String(c.b.value), String(byTitle.get(c.title)?.value), `${c.title}: and its own value`);
    }
    assert.equal(new Set(mrsf.map(c => c.title)).size, mrsf.length, 'no row appears twice');
});

test('hard limits are read for each design by the limits module itself', () => {
    const r = compareDesigns(PT, FT);
    const la = assessHardLimits(PT.patterns), lb = assessHardLimits(FT.patterns);
    assert.equal(r.limits.length, la.checks.length);
    for (const c of r.limits) {
        const x = la.checks.find(k => k.id === c.id), y = lb.checks.find(k => k.id === c.id);
        assert.deepEqual(c.a, { status: x?.status, value: x?.value });
        assert.deepEqual(c.b, { status: y?.status, value: y?.value });
    }
});

test('the busiest hour is the SAME hour for both, and the counts are each design\'s own cover', () => {
    const r = compareDesigns(PT, FT);
    const ha = calcHourlyCoverage(PT.patterns, ROTATING_LINES), hb = calcHourlyCoverage(FT.patterns, ROTATING_LINES);
    const daysOf = /** @type {Record<string, string[]>} */ ({ weekday: ['mon', 'tue', 'wed', 'thu', 'fri'], sat: ['sat'], sun: ['sun'] });
    const fewest = (/** @type {any} */ h, /** @type {string[]} */ ds, /** @type {number} */ hr) => Math.min(...ds.map(d => h[d].hours[hr]));
    assert.equal(r.service.busiest.length, 3, 'Mon–Fri, Saturday and Sunday');
    for (const p of r.service.busiest) {
        assert.equal(p.a, fewest(ha, daysOf[p.cls], p.hour));
        assert.equal(p.b, fewest(hb, daysOf[p.cls], p.hour));
    }
});

/** PT with every Sunday turn starting 11:00 or later removed — the evening service then has nobody on. */
function noSundayLates() {
    const bare = structuredClone(PT.patterns);
    for (const k of Object.keys(bare)) {
        const s = bare[k].sun;
        if (typeof s === 'string' && /^\d/.test(s) && Number(s.slice(0, 2)) >= 11) bare[k].sun = 'RD';
    }
    return bare;
}

test('each design is read against its OWN staffed window, and a mismatch is flagged', () => {
    // A design staffed to 13:00 on a Sunday is not short of cover at 18:00 on its own terms; read
    // against the other design's 23:25 close, it would be. The comparison must not borrow a window —
    // the same design under two windows has to come out differently.
    const bare = noSundayLates();
    const shortSunday = { monSat: { start: '06:20', end: '23:55' }, sun: { start: '07:15', end: '13:00' } };
    const r1 = compareDesigns({ patterns: bare }, { patterns: bare, window: shortSunday });
    assert.equal(r1.windowsDiffer, true);
    assert.ok(r1.service.uncovered.a.hours > 0, 'against the full day, the Sunday evening is uncovered');
    assert.ok(r1.service.uncovered.b.hours < r1.service.uncovered.a.hours,
        'against its own short Sunday, the same design asks for cover in fewer hours');
    const r2 = compareDesigns({ patterns: bare, window: shortSunday }, { patterns: bare, window: shortSunday });
    assert.equal(r2.windowsDiffer, false);
    assert.deepEqual(r2.service.uncovered.a, r2.service.uncovered.b);
});

test('a figure that moves WITHOUT changing the finding is still reported', () => {
    // Pinned Turns and Pinned Turns 2 are both clear on FF11, at 11 and 9. Reading only the status
    // would call them identical; a designer weighing the two needs the 11 against the 9.
    const p2 = { patterns: sheet('Pinned-Turns-2-P2-24-N13.json').patterns };
    const r = compareDesigns(PT, p2);
    const ff11 = r.fatigue.changed.find(c => c.code === 'FF11');
    assert.ok(ff11, 'FF11 is reported');
    assert.equal(ff11.a.status, ff11.b.status, 'the finding is the same');
    assert.notEqual(String(ff11.a.value), String(ff11.b.value), 'the figure is not');
});

test('an hour with trains and nobody on is found, and named', () => {
    const bare = noSundayLates();
    const r = compareDesigns(PT, { patterns: bare });
    assert.equal(r.service.uncovered.a.hours, 0, 'the real design leaves no hour with trains uncovered');
    assert.ok(r.service.uncovered.b.hours > 0, 'the stripped one does');
    assert.ok(r.service.uncovered.b.where.every(w => w.day === 'sun'), 'and every one is on the Sunday');
});

// ── v24.25: the three things review found compare mode stating more strongly than the card does ──

/** Every rotating line works `wk` Mon–Thu, `fri` on Friday, and rests at the weekend. */
function weekdayDesign(/** @type {string} */ wk, /** @type {string} */ fri) {
    /** @type {Record<string, any>} */ const patterns = {};
    for (let i = 1; i <= ROTATING_LINES; i++) {
        patterns[String(i)] = { sun: 'RD', mon: wk, tue: wk, wed: wk, thu: wk, fri, sat: 'RD' };
    }
    return { patterns };
}

test('the weekday row is the FEWEST on duty on any weekday — never Monday standing in for all five', () => {
    // v24.25 read Monday's cover and labelled it Mon–Fri. A design staffed late Mon–Thu and early on
    // Friday then read as fully staffed at the weekday's busiest hour, with Friday bare.
    const lateButFriday = weekdayDesign('14:00-22:00', '06:00-14:00');
    const r = compareDesigns(lateButFriday, lateButFriday);
    const wk = r.service.busiest.find(p => p.cls === 'weekday');
    assert.ok(wk && wk.hour >= 14 && wk.hour < 22, `the fixture must straddle the busiest hour (${wk?.hour})`);
    assert.equal(wk.a, 0, 'Friday has nobody on, so the weekday figure is 0');
    assert.deepEqual(wk.fewestOn.a, ['fri'], 'and it says which day that is');
    assert.equal(wk.days, 5);
});

test('a factor that moved carries its threshold and its "to confirm" flag, as the card does', () => {
    const r = compareDesigns(PT, FT);
    const byKey = new Map(assessFatigue(FT.patterns).results.map(x => [x.code + '|' + x.title, x]));
    assert.ok(r.fatigue.changed.length > 0);
    for (const c of r.fatigue.changed) {
        const src = byKey.get(c.code + '|' + c.title);
        assert.equal(c.threshold, src?.threshold, `${c.code}: threshold travels`);
        if (src?.confirm) assert.equal(c.confirm, true, `${c.code}: still a definition to confirm`);
    }
    assert.ok(r.fatigue.changed.some(c => c.confirm), 'the fixture exercises at least one to-confirm factor');
});
