// @lane unit
// @ts-nocheck
/**
 * admin-bulk-bar.test.mjs — the week card's bulk bar (admin-bulk-bar.js), through its real listeners over a fake grid.
 *
 * The rule for when Apply is greyed out is admin-bulk-apply.test.mjs's; this is the wiring around it, by what a
 * wrong answer costs: a type applied to a day it may not take (a Sunday's leave or absence — layer 2 of the Sunday
 * rule), a press that stages nothing while saying it did, and a bar left armed with a type nobody can see. The page
 * path is e2e/admin-week-grid.spec.js. A hand-rolled DOM, as admin-week-editor.test.mjs's, so the no-dependency lane
 * keeps running on a bare checkout.
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs test/admin-bulk-bar.test.mjs
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** @type {Map<string, any>} */ const byId = new Map();

/** An element: classes, dataset, attributes and listeners, enough for the bar and a row. */
function makeEl(extra = {}) {
    const on = {};
    const el = {
        dataset: {}, style: {}, textContent: '', className: '', value: '', checked: false, disabled: false, hidden: false,
        _attrs: {}, _on: on,
        classList: {
            add(c)      { const s = new Set(el.className.split(' ').filter(Boolean)); s.add(c);    el.className = [...s].join(' '); },
            remove(c)   { const s = new Set(el.className.split(' ').filter(Boolean)); s.delete(c); el.className = [...s].join(' '); },
            contains(c) { return el.className.split(' ').includes(c); },
            toggle(c, v) { if (v === undefined ? el.classList.contains(c) : !v) el.classList.remove(c); else el.classList.add(c); },
        },
        setAttribute(k, v) { el._attrs[k] = String(v); },
        getAttribute(k) { return el._attrs[k] ?? null; },
        addEventListener(t, fn) { (on[t] ??= []).push(fn); },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        contains() { return true; },
        // `setStatus` builds a glyph's line as nodes: their text is what the line reads back.
        appendChild(c) { el.textContent += c.textContent; return c; },
        ownerDocument: { createElement: () => makeEl(), createTextNode: t => ({ textContent: t }) },
        ...extra,
    };
    return el;
}
const put = (id, el = makeEl()) => { byId.set(id, el); return el; };
globalThis.document = { getElementById: id => byId.get(id) ?? null };

/** A `.day-row` for `date`, with its tick box and its six type pills. @param {string} date @param {boolean} ticked */
function row(date, ticked) {
    const r = makeEl();
    r.className = 'day-row';
    r.dataset.date = date;
    const cb = makeEl({ closest: () => r });
    cb.checked = ticked;
    const pills = ['annual_leave', 'shift', 'rdw', 'sick', 'rest_day', 'other'].map(t => { const p = makeEl(); p.dataset.type = t; return p; });
    r.querySelector = sel => sel === '.day-cb' ? cb : null;
    r.querySelectorAll = sel => sel === '.type-pill-btn' ? pills : [];
    r._cb = cb;
    return r;
}

const { initBulkBar, updateBulkSelCount, resetBulkPills } = await import('../admin-bulk-bar.js');
const { teamMembers, getBaseShift, isWorkedShift } = await import('../roster-data.js');

const MEMBER = teamMembers.find(m => m.name === 'G. Miller');
const SUNDAY = '2027-01-10', TUESDAY = '2027-01-12';
/** @type {any[]} */ let rows = [];
const calls = { changed: 0, recount: 0, said: [] };
// The bar looks its controls and the grid up once, as it wires: they exist first, as on the page, and stay.
const grid = put('weekGrid');
grid.querySelectorAll = sel => sel === '.day-row' ? rows : sel === '.day-cb:checked' ? rows.filter(r => r._cb.checked).map(r => r._cb) : [];
for (const id of ['bulkTypePills', 'bulkApplyBtn', 'bulkTimeGroup', 'bulkStart', 'bulkEnd']) put(id);
initBulkBar({
    memberDateMap: () => new Map(),
    markChanged: () => { calls.changed++; },
    showSuccess: (msg) => { calls.said.push(msg); },
    recount: () => { calls.recount++; updateBulkSelCount(); },
});

beforeEach(() => {
    rows = [row(SUNDAY, true), row(TUESDAY, true)];
    calls.changed = 0; calls.recount = 0; calls.said = [];
    for (const id of ['bulkSelCount', 'bulkApplyHint', 'bulkApplyLabel', 'bulkFeedback']) put(id);
    put('fieldMember').value = MEMBER.name;
    resetBulkPills();
});

/** Arm `type` on the bar, through its delegated click. @param {string} type */
function arm(type) {
    const pill = makeEl(); pill.dataset.type = type;
    pill.closest = () => pill;
    for (const fn of byId.get('bulkTypePills')._on.click) fn({ target: { closest: () => pill } });
    return pill;
}
const apply = () => { for (const fn of byId.get('bulkApplyBtn')._on.click) fn({}); };

test('premise: the fixture week holds a Sunday and a worked Tuesday', () => {
    assert.ok(MEMBER, 'premise: the member is on the roster');
    assert.equal(new Date(2027, 0, 10).getDay(), 0);
    assert.ok(isWorkedShift(getBaseShift(MEMBER, new Date(2027, 0, 12))), 'premise: 12 Jan is worked');
});

test('the bar counts the ticked days, and Apply waits for a type, saying why', () => {
    updateBulkSelCount();
    assert.equal(byId.get('bulkSelCount').textContent, '2 days selected');
    assert.equal(byId.get('bulkApplyBtn').disabled, true);
    assert.equal(byId.get('bulkApplyHint').textContent, 'Choose a type for the ticked days');
    // A press anyway stages nothing and says what is missing.
    apply();
    assert.equal(byId.get('bulkFeedback').textContent.includes('Choose a type in step 2 first'), true);
    assert.equal(rows.some(r => r.dataset.type), false);
});

test('Absent applied to a Sunday and a worked day stages only the worked day, and names the Sunday (layer 2)', () => {
    const pill = arm('sick');
    assert.equal(pill.getAttribute('aria-pressed'), 'true');
    assert.equal(byId.get('bulkApplyBtn').disabled, false, 'a working day among the ticked ones: Apply can act');
    apply();
    assert.equal(rows[0].dataset.type, undefined, 'the Sunday is left alone');
    assert.equal(rows[1].dataset.type, 'sick');
    assert.equal(calls.changed, 1, 'the staged rows changed, once');
    assert.ok(calls.recount >= 1, 'the editor recounts the grid');
    assert.match(calls.said.at(-1) ?? '', /Sunday skipped \(not a contracted day\)/);
});

test('resetBulkPills disarms the bar, so a later press applies nothing', () => {
    arm('annual_leave');
    resetBulkPills();
    assert.equal(byId.get('bulkApplyLabel').textContent, 'Apply to ticked days');
    apply();
    assert.equal(rows.some(r => r.dataset.type), false);
    assert.equal(calls.changed, 0);
});
