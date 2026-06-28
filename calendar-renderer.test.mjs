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
            return 'early-shift';
        },
        getShiftBadge(s) {
            if (!s || s === 'RD' || s === 'OFF') return '<span class="shift-badge badge-rest"><span aria-hidden="true">🏠</span><span>Rest</span></span>';
            if (s === 'SPARE') return '<span class="shift-badge badge-spare"><span aria-hidden="true">📋</span><span>Spare</span></span>';
            if (s === 'RDW')   return '<span class="shift-badge badge-rdw"><span aria-hidden="true">💼</span><span>RDW</span></span>';
            if (s === 'AL')    return '<span class="shift-badge badge-al"><span aria-hidden="true">🏖️</span><span>AL</span></span>';
            if (s === 'SICK')  return '<span class="shift-badge badge-sick"><span aria-hidden="true">🪑</span><span>Absent</span></span>';
            return '<span class="shift-badge badge-early"><span aria-hidden="true">☀️</span><span>Early</span></span>';
        },
        getWeekNumberForDate: () => 3,
        getRosterForMember:   () => ({ weekPrefix: 'CEA Week' }),
        getBaseShift:         (m, d) => _mockGetBaseShift(m, d),
        formatISO:            d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        isSunday:             dateStr => _mockIsSunday(dateStr),
        getPaydaysAndCutoffs: () => ({ paydays: [], cutoffs: [] }),
    },
});

mock.module('./calendar-member.js', {
    namedExports: { getCurrentMember: () => FAKE_MEMBER },
});

mock.module('./calendar-overrides.js', {
    namedExports: { rosterOverridesCache: _overrideCache },
});

mock.module('./override-utils.js', {
    namedExports: { isBeforeMemberStart: (m, d) => _mockIsBeforeMember(m, d) },
});

const { createCalendarHeader, createDayCell, getSwipeDirection, buildCalendarContainer } =
    await import('./calendar-renderer.js');

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
        addEventListener() {},
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
        assert.ok(html.includes('CEA Weeks 3-5'));
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
        assert.ok(html.includes('BL Weeks 1-3'));
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
