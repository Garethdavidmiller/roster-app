// @ts-nocheck
/**
 * admin-week-editor.test.mjs — the week grid, by what a wrong answer COSTS.
 *
 * This module had no unit suite at all. Its own header names three rules whose failure is silent,
 * and this file is organised around them rather than around its exports, because every one of them
 * is a statement the screen makes confidently while being wrong.
 *
 *   THROWING AWAY WORK THAT IS STAGED AND NOT YET SAVED. `_hasStagedEdits` is what stops a
 *   background refresh repainting over an admin mid-edit, and it has to count BOTH directions — a
 *   row given a type (a staged change) and a prefilled row un-ticked (a staged REMOVAL). Counting
 *   only the first has shipped here before: the refresh discarded staged removals while the dirty
 *   flag stayed true, which blocked the week swipe and left a phantom unsaved-changes warning
 *   behind. The removal half is the expensive one because an un-tick leaves nothing on screen to
 *   look wrong.
 *
 *   A WEEK NOBODY HAS READ LOOKING LIKE A WEEK WITH NOTHING IN IT. The override load is staged per
 *   member, so this grid can be asked to draw somebody whose slice never arrived. Seven base-roster
 *   days with no overrides on them is exactly what a genuinely clear week looks like, and an admin
 *   reading it concludes there is nothing recorded. "Loading…" over a load that has already FAILED
 *   is the same false claim in the patient direction — they wait instead of retrying.
 *
 *   THE BASE COLUMN NAMING A SHIFT INSTEAD OF STATING IT. The column is headed "Base roster" and it
 *   exists so a manager can see what the day already was before they change it. "Early" is a
 *   classification; 07:00–15:00 is the fact they are checking against the paper roster.
 *
 * ── WHAT THE DOM HERE IS, AND WHAT IT IS NOT ───────────────────────────────────────────────────
 *
 * A hand-rolled fake, because the no-dependency lane (`npm run test:nodeps`) has to keep running on
 * a bare checkout. It stores `innerHTML` as a string rather than parsing it, which is why the grid
 * is built with NO existing overrides in every case that reaches `buildWeekGridInto` — with none,
 * every path after the markup is written is guarded on an element the fake returns as absent, so
 * the real function runs to completion. The row markup is then asserted as text. The prefill and
 * pill-interaction paths need a parser and are out of scope here; they are exercised in
 * e2e/pages.spec.js, where a real browser builds the rows.
 */

import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── The fake document ──────────────────────────────────────────────────────────────────────────

/** @type {Map<string, any>} */
const byId = new Map();

function makeEl(tag = 'div') {
    const el = {
        tagName: tag.toUpperCase(),
        dataset: {},
        style: {},
        innerHTML: '',
        textContent: '',
        hidden: false,
        disabled: false,
        checked: false,
        value: '',
        children: [],
        className: '',
        classList: {
            add(c)      { const s = new Set(el.className.split(' ').filter(Boolean)); s.add(c);    el.className = [...s].join(' '); },
            remove(c)   { const s = new Set(el.className.split(' ').filter(Boolean)); s.delete(c); el.className = [...s].join(' '); },
            contains(c) { return el.className.split(' ').includes(c); },
            toggle(c, on) { if (on === undefined ? el.classList.contains(c) : !on) el.classList.remove(c); else el.classList.add(c); },
        },
        appendChild(child) { el.children.push(child); return child; },
        // Not a parser: the markup this module writes is asserted as text, and every consumer of a
        // lookup inside it is guarded on the element being absent.
        querySelector()    { return null; },
        querySelectorAll() { return []; },
        setAttribute()     {},
        getAttribute()     { return null; },
        addEventListener() {},
        focus()            {},
        remove()           {},
    };
    return el;
}

/** Register an element under an id so `document.getElementById` finds it. */
function put(id, el = makeEl()) { byId.set(id, el); return el; }

globalThis.document = {
    getElementById: id => byId.get(id) ?? null,
    createElement:  tag => makeEl(tag),
    querySelector:  () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    body: { classList: { add() {}, remove() {}, toggle() {} } },
    head: { appendChild() {} },
};

// ── admin-override-store is the staged load: what the grid is allowed to assume it knows ───────
let _authority = true;
let _failed    = false;
const _loadCalls = [];
mock.module('./admin-override-store.js', {
    namedExports: {
        hasOverrideAuthorityFor: () => _authority,
        loadFailedFor:           () => _failed,
        loadOverrides:           (...a) => { _loadCalls.push(a); },
    },
});

const { _hasStagedEdits, buildWeekGridInto, renderWeekGrid, updateSaveBtn, initWeekEditor }
    = await import('./admin-week-editor.js');
const { teamMembers, getBaseShift, formatISO } = await import('./roster-data.js');

const _changed = [];
initWeekEditor({
    currentIsAdmin: true,
    showError:   () => {},
    showSuccess: () => {},
    markChanged: () => { _changed.push(1); },
    memberDateMap: () => new Map(),   // no existing overrides — see the header
});

/** A `.day-row` in one of the four states the grid can hold it in. */
function row({ type = '', existingId = '', prefilled = false } = {}) {
    const r = makeEl();
    r.className = 'day-row' + (prefilled ? ' prefilled-existing' : '');
    if (type) r.dataset.type = type;
    if (existingId) r.dataset.existingId = existingId;
    return r;
}

/** Install a #weekGrid holding `rows`. */
function grid(rows) {
    const g = put('weekGrid');
    g.querySelectorAll = sel => (sel === '.day-row' ? rows : []);
    return g;
}

beforeEach(() => {
    byId.clear();
    _authority = true;
    _failed    = false;
    _loadCalls.length = 0;
    _changed.length   = 0;
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// THROWING AWAY STAGED WORK
// ───────────────────────────────────────────────────────────────────────────────────────────────

describe('staged work is noticed in BOTH directions', () => {
    test('a row given a type is staged', () => {
        grid([row({ type: 'annual_leave' })]);
        assert.equal(_hasStagedEdits(), true);
    });

    test('a prefilled row that has been UN-TICKED is staged — the half that shipped wrong', () => {
        // This is the expensive direction and the quiet one: the admin has removed a saved change
        // and there is now nothing on the row to look unsaved. A refresh that does not see it
        // repaints the row back and the removal is gone, with the dirty flag still set — which is
        // what left the phantom unsaved-changes warning and blocked the week swipe.
        grid([row({ existingId: 'ov1' })]);
        assert.equal(_hasStagedEdits(), true,
            'a prefilled row with its type removed is a staged DELETION, not an empty row');
    });

    test('an untouched prefilled row is NOT staged', () => {
        // The other way to be wrong: every loaded week would report itself dirty, so no refresh
        // could ever land and the "unsaved changes" warning would be permanent.
        grid([row({ type: 'annual_leave', existingId: 'ov1', prefilled: true })]);
        assert.equal(_hasStagedEdits(), false);
    });

    test('a clean week is not staged, and a week with one dirty row among clean ones is', () => {
        grid([row(), row({ type: 'shift', existingId: 'ov1', prefilled: true }), row()]);
        assert.equal(_hasStagedEdits(), false);
        grid([row(), row({ type: 'shift', existingId: 'ov1', prefilled: true }), row({ type: 'rdw' })]);
        assert.equal(_hasStagedEdits(), true);
    });

    test('no grid on the page answers false rather than throwing', () => {
        assert.equal(_hasStagedEdits(), false);
    });
});

describe('the Save button counts the same rows _hasStagedEdits does', () => {
    // The header says `_hasStagedEdits` "mirrors updateSaveBtn's save/delete counts". Two functions
    // that must agree, in one file, with nothing checking that they do — and a divergence is
    // invisible: the Save button would enable over work the refresh guard does not protect, or the
    // guard would hold a week whose Save is greyed out.
    function saveEnabledFor(rows) {
        grid(rows);
        put('saveBtn');
        put('stagedBar');
        put('stagedCount');
        put('gridPreview');
        put('saveBtnHint');
        const fm = put('fieldMember'); fm.value = 'G. Miller';
        updateSaveBtn();
        return !byId.get('saveBtn').disabled;
    }

    const CASES = [
        ['nothing staged',            [row(), row()]],
        ['one staged change',         [row({ type: 'rdw' })]],
        ['one staged removal',        [row({ existingId: 'ov1' })]],
        ['an untouched prefill',      [row({ type: 'shift', existingId: 'ov1', prefilled: true })]],
        ['a change and a removal',    [row({ type: 'rdw' }), row({ existingId: 'ov1' })]],
    ];

    for (const [label, rows] of CASES) {
        test(`${label}: Save and the refresh guard agree`, () => {
            const enabled = saveEnabledFor(rows);
            grid(rows);
            assert.equal(enabled, _hasStagedEdits(),
                'the Save button and the refresh guard disagree about whether this week holds '
                + 'unsaved work — one of them is about to discard it or block on nothing');
        });
    }

    test('the staged bar states both halves separately', () => {
        saveEnabledFor([row({ type: 'rdw' }), row({ type: 'shift' }), row({ existingId: 'ov1' })]);
        assert.equal(byId.get('stagedCount').textContent, '2 days, 1 to remove');
        assert.equal(byId.get('stagedBar').hidden, false);
    });

    test('with nothing staged the bar is hidden and the hint tells the admin what to do', () => {
        saveEnabledFor([row(), row()]);
        assert.equal(byId.get('stagedBar').hidden, true);
        assert.match(byId.get('saveBtnHint').textContent, /Select a type on at least one day/);
    });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// AN UNREAD WEEK IS NOT AN EMPTY WEEK
// ───────────────────────────────────────────────────────────────────────────────────────────────

describe('a member whose saved changes have not arrived', () => {
    function renderFor(name, dateStr = '2026-09-07') {
        put('weekGrid');
        put('bulkBar');
        put('saveBtn');
        put('weekNavLabel');
        const fm = put('fieldMember'); fm.value = name;
        const fd = put('fieldDate');   fd.value = dateStr;
        renderWeekGrid();
        return byId.get('weekGrid');
    }

    const MEMBER = teamMembers.find(m => !m.hidden).name;

    test('draws a LOADING state, never seven blank base-roster days', () => {
        _authority = false;
        const g = renderFor(MEMBER);
        assert.match(g.innerHTML, /Loading this member’s saved changes|Loading this member's saved changes/,
            'an unread member must say so — base-roster days with no overrides on them are '
            + 'indistinguishable from a week with nothing recorded');
        assert.equal(g.children.length, 0, 'no week panel may be built over an unread slice');
        assert.equal(byId.get('saveBtn').disabled, true, 'saving into an unread week is refused');
        assert.equal(byId.get('bulkBar').style.display, 'none');
    });

    test('a FAILED load says so and offers a retry — waiting is not the same as stuck', () => {
        _authority = false;
        _failed    = true;
        const g = renderFor(MEMBER);
        assert.doesNotMatch(g.innerHTML, /Loading/,
            '"Loading…" over a load that has stopped leaves the admin waiting instead of acting');
        assert.match(g.innerHTML, /Couldn’t load|Couldn't load/);
        assert.match(g.innerHTML, /role="alert"/, 'a stopped load is an alert, not a status');
        assert.match(g.innerHTML, /Retry/);
    });

    test('once the slice has arrived the week is built', () => {
        // Guard on the guard: without this, a render that silently did nothing would satisfy both
        // cases above.
        _authority = true;
        const g = renderFor(MEMBER);
        assert.equal(g.children.length, 1, 'the week panel is appended');
        assert.equal(g.children[0].children.length, 8, 'a header plus seven day rows');
        assert.equal(byId.get('bulkBar').style.display, 'block');
    });

    test('no member selected is its own state, and does not claim to be loading', () => {
        const g = renderFor('');
        assert.match(g.innerHTML, /Select a staff member and date above/);
        assert.doesNotMatch(g.innerHTML, /Loading/);
    });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// THE BASE COLUMN STATES THE TIME
// ───────────────────────────────────────────────────────────────────────────────────────────────

describe('the "Base roster" column says what the day WAS', () => {
    /** Builds the real grid for the week containing `dateStr` and returns its seven rows. */
    function buildWeek(memberName, dateStr) {
        const fm = put('fieldMember'); fm.value = memberName;
        const container = makeEl();
        buildWeekGridInto(container, dateStr);
        return container.children;
    }

    /** A worked day in the next few weeks for a member who actually works timed shifts. */
    function findWorkedDay() {
        for (const m of teamMembers) {
            if (m.hidden) continue;
            for (let i = 0; i < 60; i++) {
                const d = new Date(2026, 8, 7 + i);
                const shift = getBaseShift(m, d);
                if (typeof shift === 'string' && /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(shift)) {
                    return { member: m, date: formatISO(d), shift };
                }
            }
        }
        return null;
    }

    test('a worked day shows its TIMES, not "Early" or "Late"', () => {
        const found = findWorkedDay();
        assert.ok(found, 'precondition: somebody on the roster works a timed shift in the sample window');
        const rows = buildWeek(found.member.name, found.date);
        // THE ROW FOR THAT DATE, not the first col-base in the week. The first cut asserted over
        // the whole week's markup and matched Sunday's rest badge, so removing `showTime` from the
        // real template left it green — the mutation this test exists for. A rest day has no time
        // to lose, which is exactly why it cannot stand in for a worked one.
        const row = rows.find(r => r.dataset.date === found.date);
        assert.ok(row, `no row was built for ${found.date}`);
        const baseCol = row.innerHTML.match(/<div class="col-base">[^]*?<\/div>/);
        assert.ok(baseCol, 'the base column was not rendered at all — the harness, not the rule, is wrong');
        assert.ok(baseCol[0].includes(found.shift),
            `the base column must state ${found.shift} for ${found.member.name} on ${found.date}. `
            + 'A classification ("Early") is not the fact a manager is checking against the paper roster');
        // The VISIBLE text only. The correct badge names the kind in its aria-label on purpose
        // ("Early shift, 08:00 to 16:30") so a screen reader loses nothing — it is the printed
        // body that must be the time, and matching the raw markup fails on the label instead.
        const visible = baseCol[0].replace(/ aria-label="[^"]*"/g, '');
        assert.doesNotMatch(visible, /Early|Late|Night/,
            'the base column PRINTS no shift kind — the badge is asked for showTime');
        assert.ok(baseCol[0].includes('aria-label='),
            'the kind must survive as the accessible name; dropping it loses the word entirely');
    });

    test('the header, then seven rows in date order, each carrying its own ISO date', () => {
        const found = findWorkedDay();
        const rows  = buildWeek(found.member.name, found.date);
        assert.equal(rows.length, 8);
        assert.equal(rows[0].className, 'week-grid-header');
        const dates = rows.slice(1).map(r => r.dataset.date);
        assert.equal(dates.length, 7);
        assert.deepEqual(dates, [...dates].sort(), 'the seven days run Sunday to Saturday in order');
        assert.equal(new Date(dates[0] + 'T12:00:00').getDay(), 0, 'the week starts on a Sunday');
    });

    test('a rest day is marked on the ROW, so the Other-day RDW tick can bake itself in', () => {
        const found = findWorkedDay();
        const rows  = buildWeek(found.member.name, found.date).slice(1);
        const flags = rows.map(r => ({ date: r.dataset.date, rd: r.dataset.baseIsRd === '1' }));
        const member = found.member;
        for (const f of flags) {
            const base = getBaseShift(member, new Date(f.date + 'T12:00:00'));
            const isRest = base === 'RD' || base === 'OFF';
            assert.equal(f.rd, isRest,
                `${f.date}: baseIsRd must follow the base roster (${base}) — the Other-day RDW tick `
                + 'is ticked and locked from it, and the pay it implies differs');
        }
    });

    test('every Sunday row carries the reason its pills are unavailable, in words', () => {
        // v23.50 moved this out of a `title`, which no phone ever showed. It is the only thing on
        // the row explaining why four pills are grey.
        const found = findWorkedDay();
        const rows  = buildWeek(found.member.name, found.date).slice(1);
        const sunday = rows.find(r => new Date(r.dataset.date + 'T12:00:00').getDay() === 0);
        assert.ok(sunday, 'the week must contain a Sunday');
        assert.match(sunday.innerHTML, /sunday-note/);
        assert.match(sunday.innerHTML, /isn’t a contracted day|isn't a contracted day/);
        const monday = rows.find(r => new Date(r.dataset.date + 'T12:00:00').getDay() === 1);
        assert.doesNotMatch(monday.innerHTML, /sunday-note/, 'only Sunday rows carry it');
    });
});
