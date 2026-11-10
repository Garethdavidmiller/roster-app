// @ts-check
/**
 * admin-booked-periods.test.mjs — WHICH YEAR OF SOMEBODY'S LEAVE IS ON SCREEN.
 *
 * Organised by what a wrong answer COSTS, because the two directions are not close to symmetrical.
 *
 *   · SHOWING A YEAR WITH NO BOOKINGS is silent and it lies. The chips render, a year is selected,
 *     the list under it is empty — and an empty Recorded Annual Leave dates card reads as "nothing
 *     recorded for this person". That is v23.08's false statement reached from the other direction:
 *     there the card went quiet over a read that failed, here it would go quiet over a year that
 *     simply has nothing in it, and neither is distinguishable on screen from a member with no
 *     leave. Every case below that pins the RETURN VALUE INTO `years` is guarding that.
 *   · CHOOSING AN UNHELPFUL BUT REAL YEAR costs one tap. It is worth getting right — landing on the
 *     year you are already working in is the difference between a selector you never touch and one
 *     you always do — but nothing is misstated while you do it.
 *
 * A per-function suite would pass on exactly the code that produces the first: `pickBookedYear` is
 * trivially right about every year it is HANDED, and the defect is handing it one that is not there.
 */
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { bookedYears, pickBookedYear, splitAtYearEnd, createBookedPeriods } from './admin-booked-periods.js';

// The delete control's "Confirm?" disarms itself after 5 s on a REAL timer, and nothing here waits
// for it — so it held the process open after the last test, 5.1 s of wall for ~100 ms of tests
// (test audit, 7 Nov 2026). Mocked, it is a fake timer the reset throws away. Not
// `--test-force-exit`, which has silently dropped tests in this repo.
beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }); });
afterEach(() => { mock.timers.reset(); });

/** @param {string[]} starts */
const periods = starts => starts.map(s => ({ start: s, end: s, count: 1 }));

describe('bookedYears — the years a chip may exist for', () => {
    it('is ascending and deduped, so the chip row reads like a timeline', () => {
        assert.deepEqual(bookedYears(periods(['2027-06-21', '2026-01-01', '2026-08-13'])),
            ['2026', '2027']);
    });

    it('lists BOTH years of a booking cut at the year end — it is only ever fed split segments', () => {
        // 28 Dec 2026 → 1 Jan 2027 reaches this function as two segments, because the renderer runs
        // `splitAtYearEnd` first (v23.11, owner decision: a date appears in the year it FALLS in).
        // This case used to hand it the unsplit booking and assert `['2026']`, with a comment
        // defending the start-year rule the owner had overturned — it passed only because the
        // function is naive about input it no longer receives. Pinned the right way round.
        assert.deepEqual(bookedYears(splitAtYearEnd(
            [{ start: '2026-12-28', end: '2027-01-01', count: 5 }],
            ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01'])),
            ['2026', '2027']);
    });

    it('survives the shapes a cache can actually hand it', () => {
        // Not defensive programming for its own sake: an override document with no date reaches
        // this list from the roster importer, and a crash here takes the whole Admin card down.
        assert.deepEqual(bookedYears([]), []);
        assert.deepEqual(bookedYears(/** @type {any} */ (null)), []);
        assert.deepEqual(bookedYears(/** @type {any} */ ([null, {}, { start: '' }, { start: 5 }])), []);
    });
});

describe('pickBookedYear — showing a year that is not there is the expensive answer', () => {
    it('NEVER returns a year outside the list, whatever it was asked for', () => {
        // The one property that matters. A pinned or preferred year that has no bookings must not
        // survive — it renders an empty list, which reads as "this member has no leave recorded".
        const years = ['2026'];
        assert.equal(pickBookedYear({ pinned: '2031', preferred: '2030', years }), '2026');
        assert.equal(pickBookedYear({ pinned: null, preferred: '2027', years }), '2026');
    });

    it('returns null rather than a year when there are no bookings at all', () => {
        // null is what makes the caller HIDE the box. Any string here would show a chip row over
        // an empty list — a card claiming a year it has nothing to say about.
        assert.equal(pickBookedYear({ pinned: '2026', preferred: '2026', years: [] }), null);
    });

    it('a tapped chip outranks the year the rest of the card is discussing', () => {
        // Otherwise the next re-render — a save, a delete, the date picker moving — silently
        // throws the reader back to the banner's year while they are reading another one.
        assert.equal(pickBookedYear({ pinned: '2027', preferred: '2026', years: ['2026', '2027'] }),
            '2027');
    });

    it('with nothing pinned, follows the year the banner is describing', () => {
        assert.equal(pickBookedYear({ pinned: null, preferred: '2026', years: ['2025', '2026', '2027'] }),
            '2026');
    });

    it('falls back to the MOST RECENT year, not the first', () => {
        // A leaver, or a member whose leave is all historic: neither the pin nor the banner's year
        // exists in the data. Oldest-first would open the card on 2024 for somebody with a 2027
        // booking, which is the year they are least likely to want.
        assert.equal(pickBookedYear({ pinned: null, preferred: '2029', years: ['2024', '2025', '2027'] }),
            '2027');
    });

    it('ignores a non-string pin rather than treating it as a choice', () => {
        assert.equal(pickBookedYear({ pinned: /** @type {any} */ (2027), preferred: '2026', years: ['2026', '2027'] }),
            '2026');
    });
});

describe('splitAtYearEnd — every date in the year it falls in, exactly once', () => {
    // The owner's own case: Mon 28 Dec 2026 → Fri 1 Jan 2027, a working week with no Sunday in it.
    const XMAS = ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01'];
    const merged = [{ start: '2026-12-28', end: '2027-01-01', count: 5 }];

    it('puts the January day under January\'s year — the shipped defect', () => {
        // Filed under 2026, a member opening 2027 to see their leave found no 1 January.
        const segs = splitAtYearEnd(merged, XMAS);
        assert.deepEqual(segs.map(s => [s.start, s.end, s.count]), [
            ['2026-12-28', '2026-12-31', 4],
            ['2027-01-01', '2027-01-01', 1],
        ]);
        assert.deepEqual(bookedYears(segs), ['2026', '2027']);
    });

    it('never shows a date twice, and never loses one at the boundary', () => {
        const segs = splitAtYearEnd(merged, XMAS);
        const total = segs.reduce((n, s) => n + s.count, 0);
        assert.equal(total, XMAS.length, 'the segments must account for every booked date once');
    });

    it('counts booked DATES per segment, not calendar days — a bridged rest day is not leave', () => {
        // Thu 31 Dec and Sat 2 Jan booked, Fri 1 Jan a rest day the merge bridged. Dividing the
        // parent count would be wrong in both segments; recounting from the dates is right.
        const dates = ['2026-12-30', '2026-12-31', '2027-01-02'];
        const segs = splitAtYearEnd([{ start: '2026-12-30', end: '2027-01-02', count: 3 }], dates);
        assert.deepEqual(segs.map(s => [s.start, s.end, s.count]), [
            ['2026-12-30', '2026-12-31', 2],
            ['2027-01-02', '2027-01-02', 1],
        ]);
    });

    it('marks both halves as pieces of one booking, so a lone 1 Jan can say where it came from', () => {
        const segs = splitAtYearEnd(merged, XMAS);
        assert.ok(segs.every(s => s.splitFrom === '2026-12-28' && s.splitTo === '2027-01-01'));
    });

    it('leaves a booking inside one year exactly as it came — no marker, no recount', () => {
        const p = { start: '2026-06-30', end: '2026-07-04', count: 5 };
        const [seg] = splitAtYearEnd([p], ['2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04']);
        assert.equal(seg, p);
        assert.equal(seg.splitFrom, undefined);
    });

    it('cuts a booking that crosses two year ends into three', () => {
        const dates = ['2026-12-31', '2027-01-01', '2027-12-31', '2028-01-01'];
        const segs = splitAtYearEnd([{ start: '2026-12-31', end: '2028-01-01', count: 4 }], dates);
        assert.deepEqual(segs.map(s => s.start.slice(0, 4)), ['2026', '2027', '2028']);
    });
});

// ── THE CHRISTMAS ROW: on every year already on screen, and deletable when it is stored ──────────
//
// 6 Nov 2026 review. The list's Christmas map stopped at this calendar year, so a later year on
// screen anyway (it had bookings, or the Calendar's link pinned it) showed no Christmas row, and a
// link to a year holding only Christmas fell back to another year. And the row had no ✕, so a leave
// RECORD stored on a Christmas day could not be deleted from the list at all. The real render, with
// a DOM just big enough to build rows and press buttons.
// ── A DOM JUST BIG ENOUGH TO BUILD ROWS AND PRESS BUTTONS ───────────────────────────────────────
// `querySelector(All)` understands the one shape the module asks — dot-joined classes — and `focus`
// moves the fake document's `activeElement`, so where focus lands after a delete can be read back.
/** @type {{ activeElement: any }} */ const _focusDoc = { activeElement: null };
class El {
    constructor(/** @type {string} */ tag) { this.tag = tag; /** @type {any[]} */ this.children = []; /** @type {Record<string,string>} */ this.attrs = {};
        this.className = ''; this._text = ''; this.hidden = false; this.disabled = false; /** @type {Record<string, Function[]>} */ this.on = {};
        /** @type {Record<string,string>} */ this.dataset = {};
        this.classList = { contains: (/** @type {string} */ c) => this.className.split(' ').includes(c),
            add: (/** @type {string} */ c) => { if (!this.classList.contains(c)) this.className = `${this.className} ${c}`.trim(); },
            remove: (/** @type {string} */ c) => { this.className = this.className.split(' ').filter(x => x !== c).join(' '); } }; }
    set textContent(/** @type {string} */ t) { this._text = String(t); this.children = []; }
    get textContent() { return this._text + this.children.map(c => typeof c === 'string' ? c : c.textContent).join(''); }
    set innerHTML(/** @type {string} */ _) { this.children = []; this._text = ''; }
    appendChild(/** @type {any} */ c) { this.children.push(c); return c; }
    append(/** @type {any[]} */ ...cs) { this.children.push(...cs); }
    prepend(/** @type {any} */ c) { this.children.unshift(c); }
    setAttribute(/** @type {string} */ k, /** @type {string} */ v) { this.attrs[k] = v; }
    getAttribute(/** @type {string} */ k) { return this.attrs[k]; }
    addEventListener(/** @type {string} */ t, /** @type {Function} */ f) { (this.on[t] ||= []).push(f); }
    click() { for (const f of this.on.click || []) f(); }
    focus() { _focusDoc.activeElement = this; }
    contains(/** @type {any} */ x) { return all(this, e => e === x).length > 0; }
    querySelectorAll(/** @type {string} */ sel) {
        const want = sel.split('.').filter(Boolean);
        return all(this, e => e !== this && want.every(c => e.className.split(' ').includes(c)));
    }
    querySelector(/** @type {string} */ sel) { return this.querySelectorAll(sel)[0] ?? null; }
}
/** Every element under `el` (itself included) that `pred` accepts, in document order. */
function all(/** @type {any} */ el, /** @type {(e: any) => boolean} */ pred, /** @type {any[]} */ out = []) {
    if (el && typeof el === 'object') { if (pred(el)) out.push(el); for (const c of el.children ?? []) all(c, pred, out); }
    return out;
}

describe('the Christmas row — every year already on screen, and a stored record deletable', () => {
    const XMAS = { '2026': ['2026-12-25', '2026-12-26'], '2027': ['2027-12-25'] };
    const setup = (/** @type {any[]} */ entries, /** @type {string|null} */ pinYear = null, preferred = '2026') => {
        const els = { box: new El('div'), body: new El('div'), fb: new El('div') };
        /** @type {any[]} */ const deleted = [];
        const bp = createBookedPeriods({
            doc: { getElementById: (/** @type {string} */ id) => /** @type {any} */ (els)[id] || null, createElement: (/** @type {string} */ t) => new El(t), activeElement: null },
            getEntries: () => entries, hasAuthority: () => true, memberFor: () => ({ name: 'X' }),
            isSunday: () => false, isRestGap: () => false,
            mergePeriods: (/** @type {string[]} */ dates) => dates.map(d => ({ start: d, end: d, count: 1 })),
            addDays: (/** @type {string} */ d) => d, memberDateMap: () => new Map(),
            fmtDate: (/** @type {string} */ d) => d, fmtRange: (/** @type {string} */ a, /** @type {string} */ b) => `${a} – ${b}`,
            monthAbb: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
            onDelete: (/** @type {any[]} */ ...args) => { deleted.push(args.slice(0, 4).concat(args[6])); },
        });
        if (pinYear) bp.pin('box', pinYear);
        bp.render({ type: 'annual_leave', memberName: 'X', boxId: 'box', bodyId: 'body', feedbackId: 'fb',
            consumes: (/** @type {any} */ _m, /** @type {string} */ d) => !/-12-2[56]$/.test(d), countFn: (/** @type {number} */ n) => `${n} days`,
            countClass: 'al-period-count', preferredYear: preferred,
            christmas: { '2026': XMAS['2026'] }, christmasFor: (/** @type {string} */ y) => /** @type {any} */ (XMAS)[y] || [] });
        const chips = all(els.body, e => e.className.includes('al-year-chip')).map(e => e.textContent);
        const active = all(els.body, e => e.className.includes('al-year-chip') && e.className.includes('is-active')).map(e => e.textContent)[0];
        const xmasRows = all(els.body, e => e.className.includes('al-period-row--christmas'));
        return { chips, active, xmasRows, deleted };
    };
    const al = (/** @type {string} */ date) => ({ memberName: 'X', date, type: 'annual_leave', value: 'AL' });

    it('a later year with bookings shows its Christmas row — reached by the banner\'s year, with no pin', () => {
        const r = setup([al('2027-03-01')], null, '2027');
        assert.deepEqual(r.chips, ['2026', '2027']);
        assert.equal(r.active, '2027');
        assert.equal(r.xmasRows.length, 1, 'Christmas 2027 is on record, as the Calendar shows it');
        assert.match(r.xmasRows[0].textContent, /2027-12-25/);
    });

    it('a linked year holding only Christmas opens on it, instead of falling back', () => {
        const r = setup([], '2027');
        assert.equal(r.active, '2027');
        assert.equal(r.xmasRows.length, 1);
    });

    it('a later year nobody asked for grows no chip from Christmas alone', () => {
        assert.deepEqual(setup([]).chips, ['2026']);
    });

    it('a leave RECORD on a Christmas day gets the two-tap ✕, which deletes the stored days only', () => {
        const r = setup([al('2026-12-26')]);
        const btns = all(r.xmasRows[0], e => e.tag === 'button');
        assert.equal(btns.length, 1);
        assert.equal(btns[0].getAttribute('aria-label'), 'Delete the leave recorded on 2026-12-26');
        btns[0].click();
        assert.equal(btns[0].getAttribute('aria-label'), 'Confirm delete the leave recorded on 2026-12-26');
        assert.equal(r.deleted.length, 0, 'the first tap only arms it');
        btns[0].click();
        assert.deepEqual(r.deleted, [['annual_leave', 'X', '2026-12-26', '2026-12-26', 1]]);
    });

    it('the roster\'s own Christmas leave has nothing stored, so nothing to delete', () => {
        const r = setup([]);
        assert.equal(all(r.xmasRows[0], e => e.tag === 'button').length, 0);
    });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// WHAT A ROW'S ✕ DELETES, WHAT A ROW SAYS, AND WHERE FOCUS GOES (whole-app check, 10 Nov 2026)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Render one list with stand-in rules and return what a test needs: the body, the rows' ✕ in
 * document order, and every `onDelete` call. `counted` decides `consumes`, `rest` the rest days
 * (`isRestGap`), `sundays` the Sundays; a period is one merged run, as the real merger makes it.
 * @param {{ entries: any[], counted: string[], rest?: string[], sundays?: string[], year?: string,
 *           onDelete?: Function }} o
 */
function renderList({ entries, counted, rest = [], sundays = [], year = '2026', onDelete }) {
    const els = { box: new El('div'), body: new El('div'), fb: new El('div') };
    /** @type {any[]} */ const calls = [];
    const addDay = (/** @type {string} */ d, /** @type {number} */ n) => {
        const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10);
    };
    const doc = { getElementById: (/** @type {string} */ id) => /** @type {any} */ (els)[id] || null,
        createElement: (/** @type {string} */ t) => new El(t), get activeElement() { return _focusDoc.activeElement; } };
    const list = { entries };
    const bp = createBookedPeriods({
        doc: /** @type {any} */ (doc), getEntries: () => list.entries, hasAuthority: () => true, memberFor: () => ({ name: 'X' }),
        isSunday: (/** @type {string} */ d) => sundays.includes(d), isRestGap: (/** @type {string} */ d) => rest.includes(d) || sundays.includes(d),
        mergePeriods: (/** @type {string[]} */ dates, /** @type {Function} */ gap, /** @type {Function} */ next) => {
            /** @type {any[]} */ const out = [];
            for (const d of dates) {
                const p = out.at(-1);
                let c = p ? next(p.end) : null;
                while (c && c < d && gap(c)) c = next(c);
                if (p && c === d) { p.end = d; p.count++; } else out.push({ start: d, end: d, count: 1 });
            }
            return out;
        },
        addDays: addDay, memberDateMap: () => new Map(),
        fmtDate: (/** @type {string} */ d) => d, fmtRange: (/** @type {string} */ a, /** @type {string} */ b) => `${a} – ${b}`,
        monthAbb: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
        onDelete: (/** @type {any[]} */ ...args) => { calls.push(args); return onDelete?.(...args); },
    });
    const cfg = { type: 'annual_leave', memberName: 'X', boxId: 'box', bodyId: 'body', feedbackId: 'fb',
        consumes: (/** @type {any} */ _m, /** @type {string} */ d) => counted.includes(d), countFn: (/** @type {number} */ n) => `${n} days`,
        countClass: 'al-period-count', preferredYear: year };
    bp.render(cfg);
    const xs = () => all(els.body, e => e.className.split(' ').includes('btn-period-delete'));
    return { els, xs, calls, rerender: () => bp.render(cfg), list };
}
/** A leave entry as the winner map hands it over. */
const leaveOn = (/** @type {string} */ date, /** @type {any} */ over = {}) => ({ memberName: 'X', date, type: 'annual_leave', value: 'AL', ...over });
/** Arm, then confirm — the two taps. */
const twoTaps = (/** @type {any} */ btn) => { btn.click(); btn.click(); };
/** Let a settled delete's `.finally` run. */
const settled = () => new Promise(res => setImmediate(res));

describe('a row\'s ✕ takes the uncounted leave at its edges, and no further', () => {
    // Mon 23 – Sat 28 Nov 2026: four worked days listed, Fri and Sat rest days holding leave that
    // costs nothing — the pre-v23.88 week-grid booking the finding describes.
    const WEEK = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28'];
    const COUNTED = WEEK.slice(0, 4);

    it('the ✕ on "Mon – Thu" deletes through the Saturday', () => {
        const r = renderList({ entries: WEEK.map(d => leaveOn(d)), counted: COUNTED, rest: ['2026-11-27', '2026-11-28'], sundays: ['2026-11-29'] });
        assert.equal(r.xs().length, 1, 'premise: one listed period');
        twoTaps(r.xs()[0]);
        assert.deepEqual(r.calls[0].slice(2, 4), ['2026-11-23', '2026-11-28']);
        assert.equal(r.calls[0][6], 4, 'it still reports the four days the row listed');
    });

    it('…and back to a leading rest day the same way', () => {
        const r = renderList({ entries: COUNTED.map(d => leaveOn(d)), counted: COUNTED.slice(1), rest: ['2026-11-23'] });
        twoTaps(r.xs()[0]);
        assert.deepEqual(r.calls[0].slice(2, 4), ['2026-11-23', '2026-11-26']);
    });

    it('a rest day with NO leave on it is walked through, but is not where the delete ends', () => {
        const r = renderList({ entries: COUNTED.map(d => leaveOn(d)), counted: COUNTED, rest: ['2026-11-27', '2026-11-28'] });
        twoTaps(r.xs()[0]);
        assert.deepEqual(r.calls[0].slice(2, 4), ['2026-11-23', '2026-11-26'], 'nothing beyond the row to take');
    });

    it('stops at a worked day, at a Sunday and at the year end', () => {
        // Fri is WORKED (not a rest day), so Saturday's leave is not this row's.
        const worked = renderList({ entries: WEEK.map(d => leaveOn(d)), counted: COUNTED, rest: ['2026-11-28'] });
        twoTaps(worked.xs()[0]);
        assert.deepEqual(worked.calls[0].slice(2, 4), ['2026-11-23', '2026-11-26']);
        // The rest-day leave sits on the far side of a Sunday: another week's.
        const sunday = renderList({ entries: [...COUNTED, '2026-11-30'].map(d => leaveOn(d)), counted: COUNTED,
            rest: ['2026-11-27', '2026-11-28', '2026-11-30'], sundays: ['2026-11-29'] });
        twoTaps(sunday.xs()[0]);
        assert.deepEqual(sunday.calls[0].slice(2, 4), ['2026-11-23', '2026-11-26']);
        // Leave on 1 Jan beyond a 31 Dec row belongs to next year's list.
        const yearEnd = renderList({ entries: ['2026-12-30', '2026-12-31', '2027-01-01'].map(d => leaveOn(d)),
            counted: ['2026-12-30', '2026-12-31'], rest: ['2027-01-01'] });
        twoTaps(yearEnd.xs()[0]);
        assert.deepEqual(yearEnd.calls[0].slice(2, 4), ['2026-12-30', '2026-12-31']);
    });
});

// THE ENTRY POINT, NOT ONLY THE RULE: the real merger, the real rest-day rule, the real entitlement
// rule and the real delete-set builder, on a member and week found from the roster, so the case
// moves with it. The finding's week: four worked days listed, a Friday and a Saturday rest day
// holding leave — and after the ✕, nothing of the booking may be left on record.
describe('the ✕, through the real pipeline, leaves nothing of the booking behind', () => {
    it('deletes the Friday and Saturday leave the old ✕ left on record', async () => {
        const rd = await import('./roster-data.js');
        const ou = await import('./override-utils.js');
        const pd = await import('./admin-period-dates.js');
        const { consumesEntitlement } = await import('./al-entitlement.js');
        /** @type {any} */ let found = null;
        for (const m of rd.teamMembers.filter(x => !x.hidden)) {
            for (let i = 0; i < 120 && !found; i++) {
                const d = new Date(2026, 10, 2 + i);
                if (d.getDay() !== 1) continue;
                const iso = (/** @type {number} */ k) => rd.formatISO(new Date(d.getFullYear(), d.getMonth(), d.getDate() + k));
                const rest = (/** @type {number} */ k) => ou.isRestShift(rd.getBaseShift(m, rd.parseISODate(iso(k))));
                if (![0, 1, 2, 3].some(rest) && rest(4) && rest(5)) found = { m, dates: [0, 1, 2, 3, 4, 5].map(iso) };
            }
            if (found) break;
        }
        assert.ok(found, 'premise: some member works Mon–Thu with the Friday and Saturday off');
        const ovs = found.dates.map((/** @type {string} */ date, /** @type {number} */ i) =>
            ({ id: `al${i}`, memberName: found.m.name, date, type: 'annual_leave', value: 'AL', source: 'manual' }));
        const byDate = new Map(ovs.map((/** @type {any} */ o) => [o.date, o]));
        const els = { box: new El('div'), body: new El('div'), fb: new El('div') };
        /** @type {string[][]} */ const deleted = [];
        const bp = createBookedPeriods({
            doc: /** @type {any} */ ({ getElementById: (/** @type {string} */ id) => /** @type {any} */ (els)[id] || null,
                createElement: (/** @type {string} */ t) => new El(t), activeElement: null }),
            getEntries: () => ovs, hasAuthority: () => true, memberFor: () => found.m,
            isSunday: rd.isSunday, mergePeriods: ou.mergeBookedPeriods, isRestGap: pd.isRestGap, addDays: pd.addDays,
            monthAbb: rd.MONTH_ABB, memberDateMap: () => byDate, fmtDate: pd.fmtPeriodDate, fmtRange: pd.fmtPeriodRange,
            onDelete: (/** @type {string} */ type, /** @type {string} */ memberName, /** @type {string} */ start, /** @type {string} */ end) => {
                deleted.push(ou.computePeriodDeleteIds(ovs, { type, memberName, start, end, isRestGap: (/** @type {string} */ d) => pd.isRestGap(d, found.m) }));
            },
        });
        bp.render({ type: 'annual_leave', memberName: found.m.name, boxId: 'box', bodyId: 'body', feedbackId: 'fb',
            consumes: consumesEntitlement, countFn: (/** @type {number} */ n) => `${n} days`, countClass: 'al-period-count', preferredYear: '2026' });
        const rows = all(els.body, e => e.className === 'al-period-row');
        assert.equal(rows.length, 1, 'premise: the four worked days are one listed period');
        assert.match(rows[0].textContent, /4 days/, 'premise: the rest-day leave is not counted');
        twoTaps(all(rows[0], e => e.className.split(' ').includes('btn-period-delete'))[0]);
        assert.deepEqual([...deleted[0]].sort(), ovs.map((/** @type {any} */ o) => o.id).sort(),
            `left on record: ${ovs.filter((/** @type {any} */ o) => !deleted[0].includes(o.id)).map((/** @type {any} */ o) => o.date)}`);
    });
});

describe('a January day moved to the year before says so, in both years\' lists (v25.18)', () => {
    // 1 Jan 2027 comes out of 2026's allowance; 4 Jan stays on 2027's. One listed run, Fri 1 – Mon 4.
    const JAN = [leaveOn('2027-01-01', { leaveYear: 2026 }), leaveOn('2027-01-04')];
    const opts = { counted: ['2026-12-14', '2027-01-01', '2027-01-04'], rest: ['2027-01-02'], sundays: ['2027-01-03'] };

    it('its row in 2027 names the year it comes out of', () => {
        const r = renderList({ ...opts, entries: [leaveOn('2026-12-14'), ...JAN], year: '2027' });
        const row = all(r.els.body, e => e.className === 'al-period-row').find(e => /2027-01-01/.test(e.textContent));
        assert.ok(row, 'premise: the January row is on screen');
        const note = all(row, e => e.className === 'al-period-note')[0];
        assert.equal(note?.textContent, '1 day from 2026’s allowance');
    });

    it('2026, where the banner counts it, ends by naming it — its own list cannot show it', () => {
        const r = renderList({ ...opts, entries: [leaveOn('2026-12-14'), ...JAN], year: '2026' });
        const foot = all(r.els.body, e => e.className === 'ly-note')[0];
        assert.equal(foot?.textContent, 'Also from 2026’s allowance: 1 day in January 2027, listed under 2027.');
    });

    it('a day on its own year, or a leaveYear the rules would refuse, is not marked', () => {
        const refused = [leaveOn('2026-12-14'), leaveOn('2027-01-01', { leaveYear: 2025 }), leaveOn('2027-01-04')];
        assert.equal(all(renderList({ ...opts, entries: refused, year: '2027' }).els.body, e => e.className === 'al-period-note').length, 0);
        assert.equal(all(renderList({ ...opts, entries: refused, year: '2026' }).els.body, e => e.className === 'ly-note').length, 0);
    });
});

describe('after a delete from the keyboard, focus is handed on — never dropped to the page', () => {
    const THREE = ['2026-11-02', '2026-11-04', '2026-11-06'];   // three one-day rows: Mon, Wed, Fri
    /** The delete as the page does it: the row's records go, and the box re-renders. */
    const landing = (/** @type {any} */ r) => async (/** @type {string} */ _t, /** @type {string} */ _m, /** @type {string} */ start) => {
        r.list.entries = r.list.entries.filter((/** @type {any} */ e) => e.date !== start);
        r.rerender();
    };

    it('to the ✕ now in the deleted row\'s place', async () => {
        /** @type {any} */ const del = renderList({ entries: THREE.map(d => leaveOn(d)), counted: THREE, onDelete: (/** @type {any[]} */ ...a) => landing(del)(...a) });
        del.xs()[1].focus();
        twoTaps(del.xs()[1]);
        await settled();
        assert.equal(del.xs().length, 2, 'premise: the Wednesday row went');
        assert.equal(_focusDoc.activeElement, del.xs()[1], 'focus belongs on the Friday row\'s ✕, now second');
    });

    it('to the line saying what happened, when the list emptied and hid', async () => {
        /** @type {any} */ const del = renderList({ entries: [leaveOn('2026-11-02')], counted: ['2026-11-02'],
            onDelete: async () => { del.list.entries = []; del.rerender(); } });
        del.xs()[0].focus();
        twoTaps(del.xs()[0]);
        await settled();
        assert.equal(del.els.box.hidden, true, 'premise: nothing left, so the box hid');
        assert.equal(_focusDoc.activeElement, del.els.fb);
    });

    it('and back to the same ✕ when the delete was refused', async () => {
        const del = renderList({ entries: THREE.map(d => leaveOn(d)), counted: THREE,
            onDelete: async () => { _focusDoc.activeElement = null; throw new Error('refused'); } });
        const x = del.xs()[2];
        x.focus();
        twoTaps(x);
        await settled();
        assert.equal(_focusDoc.activeElement, x);
        assert.equal(x.textContent, '✕', 'and it is idle again');
    });

    it('a mouse delete moves nothing', async () => {
        /** @type {any} */ const del = renderList({ entries: THREE.map(d => leaveOn(d)), counted: THREE, onDelete: (/** @type {any[]} */ ...a) => landing(del)(...a) });
        _focusDoc.activeElement = null;
        twoTaps(del.xs()[0]);
        await settled();
        assert.equal(_focusDoc.activeElement, null);
    });
});

describe('the two-tap ✕ keeps ONE disarm timer (the copy Saved Changes had fixed, now shared)', () => {
    it('a re-arm after a quick failure gets its own five seconds', async () => {
        const del = renderList({ entries: [leaveOn('2026-11-02')], counted: ['2026-11-02'], onDelete: async () => { throw new Error('refused'); } });
        const x = del.xs()[0];
        x.click();                                       // t=0: armed (first timer due at 5s)
        mock.timers.tick(1000);
        x.click();                                       // t=1s: confirmed — refused at once
        for (let i = 0; i < 5; i++) await Promise.resolve();
        assert.equal(x.textContent, '✕', 'premise: the refusal disarmed it');
        mock.timers.tick(1000);
        x.click();                                       // t=2s: re-armed (its own timer due at 7s)
        mock.timers.tick(3500);                          // t=5.5s: the FIRST arm's five seconds are up
        assert.equal(x.textContent, 'Confirm?', 'the first arming must not disarm the second');
        x.click();
        assert.equal(del.calls.length, 2, 'the confirming tap deletes');
    });

    it('a slow delete keeps its in-flight mark — the timer does not put ✕ back over it', async () => {
        /** @type {Function} */ let finish = () => {};
        const del = renderList({ entries: [leaveOn('2026-11-02')], counted: ['2026-11-02'],
            onDelete: (/** @type {any[]} */ ...a) => { const btn = a[5]; btn.disabled = true; btn.textContent = '…';
                return new Promise(res => { finish = () => { btn.disabled = false; res(undefined); }; }); } });
        const x = del.xs()[0];
        twoTaps(x);
        mock.timers.tick(6000);
        assert.equal(x.textContent, '…', 'the request is still running');
        finish();
        for (let i = 0; i < 5; i++) await Promise.resolve();
        assert.equal(x.textContent, '✕');
    });

    it('the countdown is the control\'s own `armTimer` — what e2e/axe.spec.js clears to hold a confirm for its scan', () => {
        // The Saved Changes copy kept it there, and the a11y scan of both armed deletes depends on it:
        // a private map would let the confirm lapse mid-scan and the scan's "still armed" check fail.
        const del = renderList({ entries: [leaveOn('2026-11-02')], counted: ['2026-11-02'] });
        const x = del.xs()[0];
        x.click();
        assert.ok(/** @type {any} */ (x).armTimer, 'armed: the countdown is on the control');
        clearTimeout(/** @type {any} */ (x).armTimer);   // exactly what the axe spec does
        mock.timers.tick(6000);
        assert.equal(x.textContent, 'Confirm?', 'held open past its five seconds');
    });
});
