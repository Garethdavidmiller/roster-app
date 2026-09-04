/**
 * Unit tests for calendar-renderer.js — pure helpers and grid builder.
 * Run: node --experimental-test-module-mocks --test calendar-renderer.test.mjs
 *
 * Pure-function tests (createCalendarHeader, createDayCell, getSwipeDirection) need
 * no DOM. buildCalendarContainer tests use a minimal hand-rolled DOM factory so the
 * cell objects' classes, attributes and datasets can be inspected directly.
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Mock-controllable state ───────────────────────────────────────────────────

const _overrideCache = new Map();
let _mockGetBaseShift    = () => 'RD';
let _mockIsBeforeMember  = () => false;
let _mockIsPayday        = () => false;
let _mockIsCutoffDate    = () => false;
let _mockIsSameDay       = () => false;
let _mockIsBH            = () => false;
let _mockIsXmas          = () => false;
let _mockIsEaster        = () => false;
// Real Sunday check — avoid timezone drift by pinning noon.
const _realIsSunday = dateStr => new Date(dateStr + 'T12:00:00').getDay() === 0;
let _mockIsSunday = _realIsSunday;

const FAKE_MEMBER = { name: 'G. Miller', currentWeek: 1, rosterType: 'main' };
// Swappable so a test can exercise a rosterChanges transition member; getCurrentMember reads it live.
let _member = FAKE_MEMBER;

// ── Mocks ─────────────────────────────────────────────────────────────────────

mock.module('./roster-data.js', {
    namedExports: {
        DAY_NAMES:   ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
        MONTH_NAMES: ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'],
        SWIPE_THRESHOLD: 75,
        SWIPE_VELOCITY:  0.4,
        isSameDay:        (a, b) => _mockIsSameDay(a, b),
        isBankHoliday:    d  => _mockIsBH(d),
        isChristmasDay:   d  => _mockIsXmas(d),
        isEasterSunday:   d  => _mockIsEaster(d),
        isPayday:         d  => _mockIsPayday(d),
        isCutoffDate:     d  => _mockIsCutoffDate(d),
        getShiftKind:     () => 'early',
        getShiftClass(s) {
            if (s === 'RD' || s === 'OFF') return 'rest-day';
            if (s === 'SPARE') return 'spare-day';
            if (s === 'RDW')   return 'rdw-day';
            if (s === 'AL')    return 'al-day';
            if (s === 'SICK')  return 'sick-day';
            if (/^(TRG|IND|ASSESS)( RDW)?/.test(s)) return 'other-day';
            return 'early-shift';
        },
        getShiftBadge(s) {
            if (!s || s === 'RD' || s === 'OFF') return '<span class="shift-badge badge-rest"><span aria-hidden="true">🏠</span><span>Rest</span></span>';
            if (s === 'SPARE') return '<span class="shift-badge badge-spare"><span aria-hidden="true">📋</span><span>Spare</span></span>';
            if (s === 'RDW')   return '<span class="shift-badge badge-rdw"><span aria-hidden="true">💼</span><span>RDW</span></span>';
            if (s === 'AL')    return '<span class="shift-badge badge-al"><span aria-hidden="true">🏖️</span><span>AL</span></span>';
            if (s === 'SICK')  return '<span class="shift-badge badge-sick"><span aria-hidden="true">🪑</span><span>Absent</span></span>';
            // Faithful copy of the real training branch — badge = 🏷️ + short flavour word
            const _t = /^(TRG|IND|ASSESS)( RDW)?( ([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d)?$/.exec(s);
            if (_t) {
                const word = { TRG: 'Train', IND: 'Ind', ASSESS: 'Assess' }[_t[1]];
                return `<span class="shift-badge badge-other"><span aria-hidden="true">🏷️</span><span>${word}</span></span>`;
            }
            return '<span class="shift-badge badge-early"><span aria-hidden="true">☀️</span><span>Early</span></span>';
        },
        getWeekNumberForDate: () => 3,
        getRosterForMember:   () => ({ weekPrefix: 'CEA Week' }),
        // Faithful mini-copy: the latest rosterChanges entry whose `from` ≤ date wins; no changes → unchanged.
        resolveMemberRoster:  (m, d) => {
            if (m && m.rosterChanges && d) {
                const hit = m.rosterChanges.filter(c => d >= c.from).pop();
                if (hit) return { ...m, rosterType: hit.rosterType, currentWeek: hit.currentWeek };
            }
            return m;
        },
        getBaseShift:         (m, d) => _mockGetBaseShift(m, d),
        formatISO:            d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        isSunday:             dateStr => _mockIsSunday(dateStr),
        isWorkedShift:        s => s !== 'RD' && s !== 'OFF' && s !== 'SPARE' && s !== 'AL' && s !== 'SICK',
        paydayForCutoff:      () => null,
        escapeHtml:           s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])),
    },
});

mock.module('./calendar-member.js', {
    namedExports: { getCurrentMember: () => _member },
});

mock.module('./calendar-overrides.js', {
    namedExports: {
        rosterOverridesCache: _overrideCache,
        // The real one — the renderer looks a month's KNOWLEDGE up under this key, so a stubbed
        // format here would make every lookup miss and the grid would be withheld in every test
        // for a reason no assertion would name.
        monthKey: (year, month) => `${year}-${String(month + 1).padStart(2, '0')}`,
    },
});

mock.module('./override-utils.js', {
    namedExports: {
        isBeforeMemberStart: (m, d) => _mockIsBeforeMember(m, d),
        // Real (pure) training-grammar helpers — inlined because a module mock replaces the
        // WHOLE module: the renderer needs these to classify training values faithfully.
        isRestShift: (s) => s === 'RD' || s === 'OFF',
        // Faithful copy of the real display-suppression predicate (v16.37).
        isOverrideDisplaySuppressed: (ov, baseShift, sunday) =>
            ov.type === 'sick'         ? (baseShift === 'RD' || baseShift === 'OFF' || sunday)
          : ov.type === 'annual_leave' ? sunday
          : ov.type === 'other'        ? sunday
          : false,
        isOtherValue: (v) => typeof v === 'string' && /^(TRG|IND|ASSESS)( RDW)?( ([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d)?$/.test(v),
        parseOtherValue: (v) => {
            const m = typeof v === 'string' ? v.match(/^(TRG|IND|ASSESS)( RDW)?( ([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d)?$/) : null;
            return m ? { flavour: m[1], rdw: !!m[2], time: m[3] ? m[3].trim() : null } : null;
        },
        OTHER_FLAVOURS: {
            TRG:    { badge: 'Train',  full: 'Training'   },
            IND:    { badge: 'Ind',    full: 'Induction'  },
            ASSESS: { badge: 'Assess', full: 'Assessment' },
        },
        // Faithful copy of the real override→effective-shift resolver (override-utils.js, v16.48)
        // — the renderer now consumes this instead of re-branching on override.type itself.
        resolveEffectiveShift: (override, baseShift, sunday) => {
            const suppressed = override && (
                override.type === 'sick'         ? (baseShift === 'RD' || baseShift === 'OFF' || sunday)
              : override.type === 'annual_leave' ? sunday
              : override.type === 'other'        ? sunday
              : false);
            if (!override || suppressed) return { shift: baseShift, rdwTime: '', derivedRdw: false, note: '' };
            const note = override.note || '';
            if (override.type === 'rdw') return { shift: 'RDW', rdwTime: override.value, derivedRdw: false, note };
            const pm = override.type === 'other' && typeof override.value === 'string'
                ? override.value.match(/^(TRG|IND|ASSESS)( RDW)?( ([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d)?$/) : null;
            if (pm) {
                const rdw = !!pm[2], time = pm[3] ? pm[3].trim() : null;
                const derivedRdw = rdw || baseShift === 'RD' || baseShift === 'OFF';
                const rdwTime = time ?? (derivedRdw ? 'RDW' : (/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(baseShift) ? baseShift : ''));
                return { shift: override.value, rdwTime, derivedRdw, note };
            }
            return { shift: override.value, rdwTime: '', derivedRdw: false, note };
        },
    },
});

// NOT mocked — pure, no imports of its own, and the renderer's grid/no-grid decision comes from it.
// Stubbing it would mean these tests assert against a model that is not the shipped one.
const { noteKnowledge, _reset: _resetKnowledge } = await import('./calendar-data-state.js');

const { createCalendarHeader, createDayCell, getSwipeDirection, buildCalendarContainer } =
    await import('./calendar-renderer.js');

/** The month every grid test builds. Since v20.40 a container is only POPULATED when the month's
 *  overrides are known, so the shift-class/marker/structure suites below have to say so — otherwise
 *  they would all pass against a withheld grid, asserting nothing. */
const TEST_MONTH = { month: 0, year: 2026 };
function knowTestMonth() { noteKnowledge('2026-01', 'authoritative'); }

// ── Minimal DOM factory ───────────────────────────────────────────────────────

function makeEl(tag) {
    const _classes = new Set();
    const _attrs   = {};
    const _children = [];
    const el = {
        _tag: tag, _classes, _children,
        dataset: {},
        innerHTML: '', textContent: '', style: {},
        disabled: false, type: '',
        setAttribute(k, v) { _attrs[k] = String(v); },
        getAttribute(k)    { return _attrs[k] !== undefined ? _attrs[k] : null; },
        appendChild(c)     { _children.push(c); return c; },
        remove()           { this._removed = true; },
        focus()            {},
        // Records handlers so a test can FIRE one. A no-op listener meant a button's behaviour was
        // untestable — the suite could assert a control existed and never that pressing it worked.
        _listeners: {},
        addEventListener(type, fn) { this._listeners[type] = fn; },
        querySelectorAll(sel) {
            // Supports '.class' and '.class:not(.other)' patterns.
            const notMatch = sel.match(/^\.([^:]+):not\(\.([^)]+)\)$/);
            const results = [];
            if (notMatch) {
                const [, cls, notCls] = notMatch;
                const walk = n => {
                    if (n._classes?.has(cls) && !n._classes?.has(notCls)) results.push(n);
                    n._children?.forEach(walk);
                };
                this._children.forEach(walk);
            } else {
                const cls = sel.startsWith('.') ? sel.slice(1) : null;
                const walk = n => {
                    if (cls && n._classes?.has(cls)) results.push(n);
                    n._children?.forEach(walk);
                };
                this._children.forEach(walk);
            }
            return results;
        },
        classList: {
            add(...cls)    { cls.forEach(c => _classes.add(c)); },
            remove(...cls) { cls.forEach(c => _classes.delete(c)); },
            contains:  c  => _classes.has(c),
        },
    };
    Object.defineProperty(el, 'className', {
        get() { return [..._classes].join(' '); },
        set(v) { _classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => _classes.add(c)); },
        enumerable: true, configurable: true,
    });
    return el;
}

beforeEach(() => {
    _resetKnowledge();
    knowTestMonth();
    _overrideCache.clear();
    _mockGetBaseShift   = () => 'RD';
    _mockIsBeforeMember = () => false;
    _mockIsPayday       = () => false;
    _mockIsCutoffDate   = () => false;
    _mockIsSameDay      = () => false;
    _mockIsBH           = () => false;
    _mockIsXmas         = () => false;
    _mockIsEaster       = () => false;
    _mockIsSunday       = _realIsSunday;

    global.document = { createElement: tag => makeEl(tag), getElementById: () => null };
    global.window   = { matchMedia: () => ({ matches: false }) };
});

// ── Helper: find an in-month day cell by day number (January 2026) ────────────
// January 2026 starts on Thursday → 4 leading other-month cells.

function getDayCell(container, dayNum) {
    const grid = container._children[1];
    return grid._children.find(c => {
        const label = c.getAttribute?.('aria-label') || '';
        return new RegExp(`\\b${dayNum} January 2026\\b`).test(label);
    });
}

// ── createCalendarHeader ──────────────────────────────────────────────────────

describe('createCalendarHeader', () => {
    test('renders month name and year', () => {
        const html = createCalendarHeader(3, 3, 'CEA Week', 0, 2026);
        assert.ok(html.includes('January 2026'));
    });

    test('single week → singular label', () => {
        const html = createCalendarHeader(3, 3, 'CEA Week', 0, 2026);
        assert.ok(html.includes('CEA Week 3'));
        assert.ok(!html.includes('CEA Weeks'));
    });

    test('multiple weeks → plural label with range', () => {
        const html = createCalendarHeader(3, 5, 'CEA Week', 0, 2026);
        assert.ok(html.includes('CEA Weeks 3–5')); // en-dash range (v18.19)
    });

    test('empty weekPrefix → no week-info-text span', () => {
        const html = createCalendarHeader(3, 3, '', 0, 2026);
        assert.ok(!html.includes('week-info-text'));
    });

    test('aria-label on month-year div includes Jump to month and month/year', () => {
        const html = createCalendarHeader(3, 3, 'CEA Week', 0, 2026);
        assert.ok(html.includes('Jump to month'));
        assert.ok(html.includes('January 2026'));
    });

    test('BL Week prefix pluralises correctly → BL Weeks', () => {
        const html = createCalendarHeader(1, 3, 'BL Week', 0, 2026);
        assert.ok(html.includes('BL Weeks 1–3')); // en-dash range (v18.19)
    });
});

// ── buildCalendarContainer — the grid is WITHHELD until the month is known (v20.40) ───────────────
//
// These are the tests the shipped bug would have failed. Everything else in this file asserts what a
// day cell looks like; none of it could tell you whether the cells should have been drawn at all.

describe('buildCalendarContainer — withheld grid', () => {
    test('an UNKNOWN month draws no day cells — the base roster is not a fact yet', () => {
        _resetKnowledge();                          // nobody has read this month
        _mockGetBaseShift = () => '06:00-14:00';    // and the base roster would happily show a shift
        const container = buildCalendarContainer(TEST_MONTH.month, TEST_MONTH.year);
        assert.equal(container.querySelectorAll('.calendar-day').length, 0,
            'a month nobody has read must not paint a single day');
        assert.equal(container.querySelectorAll('.calendar-grid').length, 0);
        assert.equal(container.dataset.overrideState, 'loading');
    });

    test('the month HEADER survives — it holds the label and the sync chip mounts on it', () => {
        _resetKnowledge();
        const container = buildCalendarContainer(TEST_MONTH.month, TEST_MONTH.year);
        const header = container.querySelectorAll('.calendar-header')[0];
        assert.ok(header, 'header must exist in the withheld state');
        assert.ok(header.innerHTML.includes('January 2026'));
    });

    test('a FAILED month says so, and offers the retry — where unknown only offers a wait', () => {
        _resetKnowledge();
        noteKnowledge('2026-01', 'error');
        let retried = null;
        const container = buildCalendarContainer(TEST_MONTH.month, TEST_MONTH.year, {
            onRetryMonth: (y, m) => { retried = [y, m]; },
        });
        assert.equal(container.dataset.overrideState, 'unavailable');
        const panel = container.querySelectorAll('.calendar-pending')[0];
        assert.ok(panel, 'a failed month still gets a panel');
        assert.ok(panel.classList.contains('calendar-pending--failed'));
        assert.equal(panel.getAttribute('role'), 'alert');
        const btn = container.querySelectorAll('.calendar-pending-retry')[0];
        assert.ok(btn, 'a failure the user can act on must carry the action');
        // The panel reports the month it was BUILT for, not whatever is on display — the swipe
        // carousel builds panels for adjacent months, so passing the wrong one would retry the
        // wrong month and look like the button did nothing.
        btn._listeners.click();
        assert.deepEqual(retried, [2026, 0]);
    });

    test('no retry callback ⇒ no button — an inert control is worse than none', () => {
        _resetKnowledge();
        noteKnowledge('2026-01', 'error');
        const container = buildCalendarContainer(TEST_MONTH.month, TEST_MONTH.year);
        assert.equal(container.querySelectorAll('.calendar-pending-retry').length, 0);
    });

    test('a wait state is role=status, not alert — it must not interrupt on every load', () => {
        _resetKnowledge();
        const panel = buildCalendarContainer(TEST_MONTH.month, TEST_MONTH.year)
            .querySelectorAll('.calendar-pending')[0];
        assert.equal(panel.getAttribute('role'), 'status');
        assert.ok(!panel.classList.contains('calendar-pending--failed'));
    });

    test('a CACHED month DOES draw its grid — hiding good data is its own failure', () => {
        _resetKnowledge();
        noteKnowledge('2026-01', 'cached');
        const container = buildCalendarContainer(TEST_MONTH.month, TEST_MONTH.year);
        assert.ok(container.querySelectorAll('.calendar-day').length > 0,
            'a device holding cached data must not be reduced to a spinner');
        assert.equal(container.dataset.overrideState, 'stale');
        assert.equal(container.querySelectorAll('.calendar-pending').length, 0);
    });

    test('an authoritative month renders as current', () => {
        knowTestMonth();
        const container = buildCalendarContainer(TEST_MONTH.month, TEST_MONTH.year);
        assert.ok(container.querySelectorAll('.calendar-day').length > 0);
        assert.equal(container.dataset.overrideState, 'render');
    });

    test('knowledge is per MONTH — knowing January says nothing about February', () => {
        _resetKnowledge();
        noteKnowledge('2026-01', 'authoritative');
        assert.ok(buildCalendarContainer(0, 2026).querySelectorAll('.calendar-day').length > 0);
        assert.equal(buildCalendarContainer(1, 2026).querySelectorAll('.calendar-day').length, 0,
            'February was never read — swiping to it must not inherit January\'s confidence');
    });
});

// ── buildCalendarContainer — rosterChanges transition month (week label suppressed) ───────────────

describe('buildCalendarContainer — transition-month week label', () => {
    test('a member crossing a rosterChanges boundary mid-month shows NO week range (not "Weeks 3–3")', () => {
        // main → fixed from the 15th: firstDay (main) and lastDay (fixed) resolve to different rosters,
        // so a numeric "Weeks X–Y" range would be nonsensical — the label must be suppressed instead.
        _member = { name: 'S. Test', currentWeek: 3, rosterType: 'main',
            rosterChanges: [{ from: new Date(2026, 0, 15), rosterType: 'fixed', currentWeek: 2 }] };
        try {
            const container = buildCalendarContainer(0, 2026);   // January 2026
            const header = /** @type {any} */ (container).querySelectorAll('.calendar-header')[0];
            const html = header.innerHTML;
            assert.ok(html.includes('January 2026'), 'month/year still shown');
            assert.ok(!/Week/.test(html), 'no "Week"/"Weeks" label in a transition month');
        } finally {
            _member = FAKE_MEMBER;   // restore for the other buildCalendarContainer tests
        }
    });

    test('a normal (non-transition) member still shows the week label', () => {
        _member = FAKE_MEMBER;
        const container = buildCalendarContainer(0, 2026);
        const header = /** @type {any} */ (container).querySelectorAll('.calendar-header')[0];
        assert.ok(/CEA Week/.test(header.innerHTML), 'week label present for a non-transition month');
    });
});

// ── createDayCell ─────────────────────────────────────────────────────────────

describe('createDayCell', () => {
    const JAN_1 = new Date(2026, 0, 1);

    test('RD shift → rest badge, no shift-time div', () => {
        const html = createDayCell(JAN_1, 'RD', undefined, false);
        assert.ok(html.includes('badge-rest'));
        assert.ok(!html.includes('shift-time'));
    });

    test('AL shift → AL badge', () => {
        const html = createDayCell(JAN_1, 'AL', undefined, false);
        assert.ok(html.includes('badge-al'));
    });

    test('SICK shift → absence badge', () => {
        const html = createDayCell(JAN_1, 'SICK', undefined, false);
        assert.ok(html.includes('badge-sick'));
    });

    test('RDW → RDW badge and rdwTime in output', () => {
        const html = createDayCell(JAN_1, 'RDW', undefined, true, '09:00-17:00');
        assert.ok(html.includes('badge-rdw'));
        assert.ok(html.includes('09:00-'));
    });

    test('worked shift with permanentShift=early → early badge overrides getShiftBadge', () => {
        const html = createDayCell(JAN_1, '06:00-14:00', 'early', true);
        assert.ok(html.includes('badge-early'));
    });

    test('worked shift with permanentShift=late → late badge overrides getShiftBadge', () => {
        const html = createDayCell(JAN_1, '11:00-19:00', 'late', true);
        assert.ok(html.includes('badge-late'));
    });

    test('worked shift with no permanentShift → shift-time div present', () => {
        const html = createDayCell(JAN_1, '06:00-14:00', undefined, true);
        assert.ok(html.includes('shift-time'));
        assert.ok(html.includes('06:00-'));
    });

    test('training → 🏷️ badge with the flavour word, side-channel time in the hours slot', () => {
        // A rostered-day training: shift is the training value, the hours slot shows the
        // BASE shift time passed via the rdwTime side-channel (same mechanism as RDW).
        const html = createDayCell(JAN_1, 'TRG', undefined, true, '06:00-14:00');
        assert.ok(html.includes('badge-other'), 'training badge');
        assert.ok(html.includes('>Train<'), 'short flavour word');
        assert.ok(html.includes('06:00-'), 'base time in the hours slot');
    });

    test('training rest-day → hours slot reads RDW', () => {
        const html = createDayCell(JAN_1, 'TRG RDW', undefined, true, 'RDW');
        assert.ok(html.includes('badge-other'));
        assert.ok(html.includes('<div class="shift-time">RDW</div>'), 'RDW in the hours slot');
    });

    test('training always gets its own badge even when permanentShift is set (no early/late misfire)', () => {
        const html = createDayCell(JAN_1, 'IND', 'early', true, '09:00-16:00');
        assert.ok(html.includes('badge-other'), 'training badge wins');
        assert.ok(html.includes('>Ind<'), 'Induction short word');
        assert.ok(!html.includes('badge-early'), 'permanentShift badge must not override training');
    });

    test('training hours slot shows for permanentShift members too (RDW/training exempt from the gate)', () => {
        // Fixed-roster members (permanentShift) normally show no time line — but for training
        // the hours slot is the only cell-level carrier of the times/RDW detail.
        const html = createDayCell(JAN_1, 'TRG RDW', 'early', true, 'RDW');
        assert.ok(html.includes('<div class="shift-time">RDW</div>'), 'hours slot visible despite permanentShift');
        const html2 = createDayCell(JAN_1, 'RDW', 'early', true, '09:00-17:00');
        assert.ok(html2.includes('09:00-'), 'RDW time also visible despite permanentShift (consistency fix)');
    });

    test('training never leaks its raw value into the hours slot', () => {
        // Spare-week training: no base time to show → side-channel empty → badge only.
        const html = createDayCell(JAN_1, 'TRG', undefined, true, '');
        assert.ok(!html.includes('shift-time'), 'no hours line when the side-channel is blank');
    });

    test('RDW always gets its own badge even when permanentShift is set', () => {
        const html = createDayCell(JAN_1, 'RDW', 'early', true, '09:00-17:00');
        assert.ok(html.includes('badge-rdw'), 'should use RDW badge');
        assert.ok(!html.includes('badge-early'), 'permanentShift early badge should not override RDW');
    });

    test('day number is rendered inside day-number div', () => {
        const html = createDayCell(JAN_1, 'RD', undefined, false);
        assert.ok(html.includes('<div class="day-number">1</div>'));
    });
});

// ── getSwipeDirection ─────────────────────────────────────────────────────────

describe('getSwipeDirection', () => {
    test('horizontal left swipe over threshold → "left"', () => {
        // 120px left in 300ms → distance > 75, mostly horizontal
        assert.equal(getSwipeDirection(200, 100, 80, 100, 300), 'left');
    });

    test('horizontal right swipe over threshold → "right"', () => {
        assert.equal(getSwipeDirection(80, 100, 200, 100, 300), 'right');
    });

    test('below distance threshold AND below velocity threshold → null', () => {
        // 50px in 300ms = 0.167 px/ms < 0.4; 50px < 75px threshold
        assert.equal(getSwipeDirection(100, 100, 50, 100, 300), null);
    });

    test('diagonal swipe (45°) → null', () => {
        // Equal x and y — 45° from horizontal, > 30° limit
        assert.equal(getSwipeDirection(0, 0, 100, 100, 300), null);
    });

    test('fast flick: below distance threshold but velocity ≥ 0.4 → commits', () => {
        // 50px in 50ms = 1.0 px/ms > 0.4 — fast flick to left
        assert.equal(getSwipeDirection(100, 100, 50, 100, 50), 'left');
    });

    test('zero elapsed → velocity treated as 0; distance alone decides', () => {
        // 100px left, elapsed=0 → velocity=0 but distance(100) > threshold(75)
        assert.equal(getSwipeDirection(200, 100, 100, 100, 0), 'left');
    });

    test('small distance with zero elapsed → null', () => {
        // 30px left, elapsed=0 → velocity=0, distance(30) < threshold(75)
        assert.equal(getSwipeDirection(100, 100, 70, 100, 0), null);
    });
});

// ── buildCalendarContainer — shift class rendering ────────────────────────────

describe('buildCalendarContainer — shift classes', () => {
    test('base RD shift → rest-day class on cell', () => {
        const container = buildCalendarContainer(0, 2026);
        const cell = getDayCell(container, 1);
        assert.ok(cell, 'day 1 cell should exist');
        assert.ok(cell._classes.has('rest-day'));
    });

    test('AL override → al-day class', () => {
        _mockGetBaseShift = () => '06:00-14:00';
        // Jan 2 2026 is a Friday — not a Sunday
        _overrideCache.set('G. Miller|2026-01-02', { type: 'annual_leave', value: 'AL', note: '', source: 'manual' });
        const container = buildCalendarContainer(0, 2026);
        const cell = getDayCell(container, 2);
        assert.ok(cell?._classes.has('al-day'), 'AL override → al-day');
    });

    test('SICK override on a worked weekday → sick-day class', () => {
        _mockGetBaseShift = () => '06:00-14:00';
        // Jan 2 2026 is a Friday
        _overrideCache.set('G. Miller|2026-01-02', { type: 'sick', value: 'SICK', note: '', source: 'manual' });
        const container = buildCalendarContainer(0, 2026);
        const cell = getDayCell(container, 2);
        assert.ok(cell?._classes.has('sick-day'), 'SICK on weekday → sick-day');
    });

    test('SICK override on a Sunday is suppressed — base shift class kept', () => {
        _mockGetBaseShift = () => '06:00-14:00';
        // Jan 4 2026 is a Sunday — _realIsSunday returns true
        _overrideCache.set('G. Miller|2026-01-04', { type: 'sick', value: 'SICK', note: '', source: 'manual' });
        const container = buildCalendarContainer(0, 2026);
        const cell = getDayCell(container, 4);
        assert.ok(cell, 'day 4 cell should exist');
        assert.ok(!cell._classes.has('sick-day'), 'SICK on Sunday must be suppressed');
        assert.ok(cell._classes.has('early-shift'), 'base worked-shift class should remain');
    });

    test('SICK override when base shift is RD is suppressed — rest-day kept', () => {
        // Default _mockGetBaseShift returns 'RD'
        // Jan 2 is Friday, but base is RD so sick is invalid
        _overrideCache.set('G. Miller|2026-01-02', { type: 'sick', value: 'SICK', note: '', source: 'manual' });
        const container = buildCalendarContainer(0, 2026);
        const cell = getDayCell(container, 2);
        assert.ok(!cell?._classes.has('sick-day'), 'SICK on base RD must be suppressed');
        assert.ok(cell?._classes.has('rest-day'), 'rest-day class should remain');
    });

    test('RDW override → rdw-day class and tooltip includes shift time', () => {
        _overrideCache.set('G. Miller|2026-01-02', { type: 'rdw', value: '09:00-17:00', note: '', source: 'manual' });
        const container = buildCalendarContainer(0, 2026);
        const cell = getDayCell(container, 2);
        assert.ok(cell?._classes.has('rdw-day'), 'RDW override → rdw-day');
        assert.ok(cell?.dataset.tooltip?.includes('09:00-17:00'), 'tooltip should include RDW time');
    });

    test('override suppressed before member startDate', () => {
        _mockIsBeforeMember = () => true;
        _overrideCache.set('G. Miller|2026-01-02', { type: 'annual_leave', value: 'AL', note: '', source: 'manual' });
        const container = buildCalendarContainer(0, 2026);
        const cell = getDayCell(container, 2);
        assert.ok(!cell?._classes.has('al-day'), 'override before startDate should be suppressed');
        assert.ok(cell?._classes.has('rest-day'), 'base class should be kept');
    });
});

// ── buildCalendarContainer — special day markers ──────────────────────────────

// ── WHAT THE ROSTER SAID BEFORE THE CHANGE (v22.64) ─────────────────────────────────────────────
//
// Reported from a phone: the day panel said "Early shift 07:00-16:00" and nothing said the week
// underneath was a SPARE week. Those are different weeks of somebody's life — a spare week is one
// with no assigned duties, so being given a turn on it is not the same fact as a rostered turn
// being moved — and the panel had no way to tell them apart.
//
// Organised by what a wrong answer COSTS. Saying nothing when the roster DID change is the reported
// defect and is silent. Claiming a change that did not happen is worse in a different way: it
// invites a member to query a shift with their manager that nobody ever altered.
describe('buildCalendarContainer — the base-roster line', () => {
    test('an override over a SPARE week says so — the reported case', () => {
        _mockGetBaseShift = () => 'SPARE';
        _overrideCache.set('G. Miller|2026-01-02', { type: 'shift', value: '07:00-16:00', note: '', source: 'manual' });
        const cell = getDayCell(buildCalendarContainer(0, 2026), 2);
        assert.equal(cell?.dataset.detailBase, 'Spare day',
            'a shift given on a spare week does not say the week was spare — the panel reads exactly '
            + 'like an ordinary rostered turn, which is the defect this was written for');
        assert.match(String(cell?.dataset.detailShift), /Early shift 07:00-16:00/);
    });

    test('no override → NO base line, because nothing changed', () => {
        _mockGetBaseShift = () => '06:00-14:00';
        const cell = getDayCell(buildCalendarContainer(0, 2026), 2);
        assert.equal(cell?.dataset.detailBase, undefined,
            'an unchanged day claims a change. "Changed from Early shift" under "Early shift" is '
            + 'both noise and an invitation to query a shift nobody altered');
    });

    test('an override that resolves BACK to the base claims no change', () => {
        // A SICK override on a Sunday is display-suppressed, so the effective shift IS the base.
        _mockGetBaseShift = () => '06:00-14:00';
        _overrideCache.set('G. Miller|2026-01-04', { type: 'sick', value: 'SICK', note: '', source: 'manual' });
        const cell = getDayCell(buildCalendarContainer(0, 2026), 4);   // Jan 4 2026 is a Sunday
        assert.equal(cell?.dataset.detailBase, undefined,
            'a suppressed override produced a base line, so the panel announces a change the rest of '
            + 'the app has deliberately decided not to show');
    });

    test('AL over a rostered turn names the turn it replaced', () => {
        _mockGetBaseShift = () => '06:00-14:00';
        _overrideCache.set('G. Miller|2026-01-02', { type: 'annual_leave', value: 'AL', note: '', source: 'manual' });
        const cell = getDayCell(buildCalendarContainer(0, 2026), 2);
        assert.equal(cell?.dataset.detailBase, 'Early shift 06:00-14:00');
    });

    test('a permanent-shift member still gets the TIME on the base line', () => {
        // Their badge never varies, so the effective label omits the time by design. The base line
        // is the one place the time is the whole answer: without it a 06:20 changed to 07:00 reads
        // "Changed from Early shift", which states that something changed and not what.
        _member = { name: 'G. Miller', currentWeek: 1, rosterType: 'main', permanentShift: 'early' };
        _mockGetBaseShift = () => '06:20-14:20';
        _overrideCache.set('G. Miller|2026-01-02', { type: 'shift', value: '07:00-16:00', note: '', source: 'manual' });
        const cell = getDayCell(buildCalendarContainer(0, 2026), 2);
        assert.equal(cell?.dataset.detailBase, 'Early shift 06:20-14:20');
        _member = FAKE_MEMBER;
    });
});

describe('buildCalendarContainer — special markers', () => {
    test('payday cell → payday class and data-payday-iso set', () => {
        _mockIsPayday = () => true;
        const container = buildCalendarContainer(0, 2026);
        const cell = getDayCell(container, 1);
        assert.ok(cell?._classes.has('payday'));
        assert.equal(cell?.dataset.paydayIso, '2026-01-01');
    });

    test('cutoff cell → cutoff class and data-cutoff-iso set', () => {
        _mockIsCutoffDate = () => true;
        const container = buildCalendarContainer(0, 2026);
        const cell = getDayCell(container, 1);
        assert.ok(cell?._classes.has('cutoff'));
        assert.equal(cell?.dataset.cutoffIso, '2026-01-01');
    });

    test('today cell → today class and tabindex=0', () => {
        // Only Jan 15 counts as today
        _mockIsSameDay = (a) => a.getDate() === 15;
        const container = buildCalendarContainer(0, 2026);
        const todayCell = getDayCell(container, 15);
        assert.ok(todayCell?._classes.has('today'));
        assert.equal(todayCell?.getAttribute('tabindex'), '0');
    });

    test('non-today cells have tabindex=-1 (except the roving anchor)', () => {
        // No today → first cell is the roving anchor at tabindex=0; all others at -1
        const container = buildCalendarContainer(0, 2026);
        const cell5 = getDayCell(container, 5);
        assert.equal(cell5?.getAttribute('tabindex'), '-1');
    });

    test('bank holiday cell → bank-holiday class', () => {
        _mockIsBH = () => true;
        const container = buildCalendarContainer(0, 2026);
        const cell = getDayCell(container, 1);
        assert.ok(cell?._classes.has('bank-holiday'));
    });

    test('payday aria-label includes Payday', () => {
        _mockIsPayday = d => d.getDate() === 1;
        const container = buildCalendarContainer(0, 2026);
        const cell = getDayCell(container, 1);
        assert.ok(cell?.getAttribute('aria-label')?.includes('Payday'));
    });

    test('override note appears in data-tooltip', () => {
        _overrideCache.set('G. Miller|2026-01-02', { type: 'annual_leave', value: 'AL', note: 'Annual holiday', source: 'manual' });
        const container = buildCalendarContainer(0, 2026);
        const cell = getDayCell(container, 2);
        assert.ok(cell?.dataset.tooltip?.includes('Annual holiday'));
    });
});

// ── buildCalendarContainer — grid structure ───────────────────────────────────

describe('buildCalendarContainer — grid structure', () => {
    test('container has calendar-container class', () => {
        const container = buildCalendarContainer(0, 2026);
        assert.ok(container._classes.has('calendar-container'));
    });

    test('exactly 31 in-month day cells built for January 2026', () => {
        const container = buildCalendarContainer(0, 2026);
        const grid = container._children[1];
        const inMonthCells = grid._children.filter(c =>
            !c._classes.has('other-month') && (c.getAttribute?.('aria-label') || '').includes('January 2026')
        );
        assert.equal(inMonthCells.length, 31);
    });

    test('4 leading other-month cells for January 2026 (starts Thursday)', () => {
        // Jan 2026 starts Thursday (day-index 4) → 4 leading filler cells
        const container = buildCalendarContainer(0, 2026);
        const grid = container._children[1];
        // Skip 7 day-header divs; next 4 should be other-month
        const leading = grid._children.slice(7, 11);
        leading.forEach((c, i) => {
            assert.ok(c._classes.has('other-month'), `leading cell ${i} should be other-month`);
            assert.equal(c.getAttribute('aria-hidden'), 'true', `leading cell ${i} should be aria-hidden`);
        });
    });

    test('7 day-header columns present', () => {
        const container = buildCalendarContainer(0, 2026);
        const grid = container._children[1];
        const headers = grid._children.slice(0, 7);
        assert.equal(headers.length, 7);
        assert.ok(headers.every(h => h._classes.has('day-header')));
    });

    test('day cells have role=button', () => {
        const container = buildCalendarContainer(0, 2026);
        const cell = getDayCell(container, 1);
        assert.equal(cell?.getAttribute('role'), 'button');
    });
});
