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
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bookedYears, pickBookedYear, splitAtYearEnd, createBookedPeriods } from './admin-booked-periods.js';

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
describe('the Christmas row — every year already on screen, and a stored record deletable', () => {
    class El {
        constructor(/** @type {string} */ tag) { this.tag = tag; /** @type {any[]} */ this.children = []; /** @type {Record<string,string>} */ this.attrs = {};
            this.className = ''; this._text = ''; this.hidden = false; /** @type {Record<string, Function[]>} */ this.on = {};
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
        contains() { return false; }
        querySelector() { return null; }
    }
    const all = (/** @type {any} */ el, /** @type {(e: any) => boolean} */ pred, /** @type {any[]} */ out = []) => {
        if (el && typeof el === 'object') { if (pred(el)) out.push(el); for (const c of el.children) all(c, pred, out); }
        return out;
    };
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
