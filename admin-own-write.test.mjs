/**
 * admin-own-write.test.mjs — what a write the Admin page makes ITSELF does to the week on screen.
 * Run: node scripts/run-tests.mjs admin-own-write.test.mjs   (part of `npm run test:hygiene`)
 *
 * No mocks. The module takes the week grid's own functions by injection, so this drives the REAL
 * `syncWeekAfterOwnWrite` over a small fake grid whose rows are drawn by the real `prefillRow` and
 * staged by the real `_activateRow` / `_deactivateRow` (admin-week-row-state.js) — the same row state
 * the week save reads (`drawnDays`, `readRowDraft`). The browser half, each write path end to end
 * through the page, is e2e/admin.spec.js ("THE PAGE'S OWN WRITE IS NOT A COLLEAGUE'S").
 *
 * Organised by what a wrong answer costs:
 *   1. THE ADMIN'S OWN WORK REFUSED — a row left comparing with a record the page itself deleted or
 *      replaced, so the next Save says "Someone else has changed …" and its advice discards the week.
 *   2. A WRITE SILENTLY UNDONE — a staged change made over the day as it was, saved over the day as
 *      the page has just left it.
 *   3. A COLLEAGUE'S CHANGE WRITTEN OVER — a row that was not touched redrawn from a cache a read
 *      had put the colleague's record into, so the save compared with it and passed.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ownWriteRowAction, syncWeekAfterOwnWrite, initOwnWrite, clearedDaysLine, withClearedDays } from './admin-own-write.js';
import { prefillRow, _activateRow, _deactivateRow, drawnDays, isStagedRow } from './admin-week-row-state.js';

const MEMBER = 'G. Miller';
const MON = '2026-08-24', TUE = '2026-08-25', FRI = '2026-08-28';
const WEEK = [MON, TUE, '2026-08-26', '2026-08-27', FRI];
/** A saved record of one day, as the cache holds one. @param {string} date @param {Record<string, any>} [over] */
const rec = (date, over = {}) => ({ id: `m_${date}_G.%20Miller`, memberName: MEMBER, date, type: 'annual_leave', value: 'AL',
    note: '', source: 'manual', createdAt: { toMillis: () => 1_000 }, ...over });

// ── ownWriteRowAction — the rule, alone ─────────────────────────────────────────────────────────────
describe('ownWriteRowAction — what one row of a day the write touched does', () => {
    const al = rec(MON), staged = { date: MON, type: 'sick' }, removal = { date: MON, remove: true };

    test('a day the write did not change keeps its row — staged or not, so a staged edit there stays', () => {
        for (const s of [null, staged, removal]) {
            assert.equal(ownWriteRowAction({ drawn: null, now: null, staged: s }), 'keep');
            assert.equal(ownWriteRowAction({ drawn: al, now: al, staged: s }), 'keep');
            assert.equal(ownWriteRowAction({ drawn: al, now: { ...al }, staged: s }), 'keep', 'the same record, a fresh copy');
        }
    });

    test('an unstaged row of a day that changed is drawn as it now stands — the record a save compares with', () => {
        assert.equal(ownWriteRowAction({ drawn: al, now: null, staged: null }), 'redraw', 'deleted');
        assert.equal(ownWriteRowAction({ drawn: null, now: al, staged: null }), 'redraw', 'booked');
        assert.equal(ownWriteRowAction({ drawn: al, now: rec(MON, { leaveYear: 2025 }), staged: null }), 'redraw', 'moved to last year');
    });

    test('a staged change on a day that changed is CLEARED, never saved over the day as it now stands', () => {
        assert.equal(ownWriteRowAction({ drawn: al, now: null, staged }), 'clear');
        assert.equal(ownWriteRowAction({ drawn: null, now: al, staged }), 'clear', 'a booking over the staged day');
        assert.equal(ownWriteRowAction({ drawn: al, now: rec(MON, { leaveYear: 2025 }), staged }), 'clear');
        assert.equal(ownWriteRowAction({ drawn: al, now: rec(MON, { type: 'rdw', value: '09:00-17:00' }), staged }), 'clear');
    });

    test('a staged REMOVAL whose record the write already removed is done — redrawn, and not named', () => {
        assert.equal(ownWriteRowAction({ drawn: al, now: null, staged: removal }), 'redraw');
    });

    test('a staged removal of a day that now holds something ELSE is cleared and named — it is not removed unseen', () => {
        const uncovered = rec(MON, { id: 'imp1', source: 'roster_import', type: 'shift', value: '08:00-16:30' });
        assert.equal(ownWriteRowAction({ drawn: al, now: uncovered, staged: removal }), 'clear');
    });
});

// ── the words ─────────────────────────────────────────────────────────────────────────────────────
describe('clearedDaysLine / withClearedDays — what the card that made the write says', () => {
    test('nothing cleared: nothing said, and the line it would join is untouched', () => {
        assert.equal(clearedDaysLine([]), '');
        assert.equal(withClearedDays('✓ Deleted: G. Miller — 24 Aug 2026 (Annual Leave)', []), '✓ Deleted: G. Miller — 24 Aug 2026 (Annual Leave)');
    });

    test('one day, and several: the days named, in Change a Shift\'s own words', () => {
        assert.equal(clearedDaysLine([MON]),
            'Your unsaved change to Mon 24 Aug in Change a Shift was cleared, because that day has just changed. Set it again if you still want it.');
        assert.equal(clearedDaysLine([MON, TUE]),
            'Your unsaved changes to Mon 24 Aug and Tue 25 Aug in Change a Shift were cleared, because those days have just changed. Set them again if you still want them.');
        assert.match(clearedDaysLine([MON, TUE, '2026-08-26', '2026-08-27']), /^Your unsaved changes to Mon 24 Aug, Tue 25 Aug and 2 other days in Change a Shift were cleared/);
    });

    test('joined as the next sentence: a full stop added to a line without one, never a second', () => {
        assert.equal(withClearedDays('✓ Deleted 2 AL days for G. Miller', [MON]),
            `✓ Deleted 2 AL days for G. Miller. ${clearedDaysLine([MON])}`);
        assert.equal(withClearedDays('Saved — Tue 5 Jan now comes out of 2026’s allowance.', [MON]),
            `Saved — Tue 5 Jan now comes out of 2026’s allowance. ${clearedDaysLine([MON])}`);
    });

    test('calm and in the house terms: no exclamation mark, no "override"', () => {
        for (const line of [clearedDaysLine([MON]), clearedDaysLine([MON, TUE])]) {
            assert.doesNotMatch(line, /!/);
            assert.doesNotMatch(line, /override/i);
            assert.match(line, /Change a Shift/);
        }
    });
});

// ── syncWeekAfterOwnWrite — driven over a fake grid ───────────────────────────────────────────────
/** @typedef {{ dataset: Record<string, string>, parent?: any, cb: { checked: boolean }, [k: string]: any }} FakeRow */

/** A row as `buildWeekGridInto` draws one: its date, and — with a saved record — drawn from it. */
function drawRow(/** @type {string} */ date, /** @type {any} */ saved) {
    const classes = new Set(['day-row']);
    const cb = { checked: false };
    /** @type {any} */
    const row = {
        dataset: { date }, cb, parent: null,
        classList: {
            add: (/** @type {string[]} */ ...c) => c.forEach(x => classes.add(x)),
            remove: (/** @type {string[]} */ ...c) => c.forEach(x => classes.delete(x)),
            toggle: (/** @type {string} */ c, /** @type {boolean|undefined} */ on) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)),
            contains: (/** @type {string} */ c) => classes.has(c),
        },
        querySelector: (/** @type {string} */ sel) => (sel === '.day-cb' ? cb : null),
        querySelectorAll: () => [],
        setAttribute() {}, removeAttribute() {},
        replaceWith(/** @type {any} */ next) { const i = row.parent.rows.indexOf(row); row.parent.rows[i] = next; next.parent = row.parent; row.parent = null; },
    };
    if (saved) { row.dataset.existingId = saved.id; row.classList.add('has-override'); prefillRow(row, saved); }
    return row;
}
/** A container that holds rows, as the grid and `build`'s detached panel do. */
function container() {
    /** @type {any} */
    const c = {
        rows: /** @type {any[]} */ ([]),
        querySelectorAll: (/** @type {string} */ sel) => (sel === '.day-row' ? c.rows : []),
        querySelector: (/** @type {string} */ sel) => {
            const m = /data-date="([^"]+)"/.exec(sel);
            return m ? c.rows.find((/** @type {any} */ r) => r.dataset.date === m[1]) ?? null : null;
        },
        appendChild: (/** @type {any} */ r) => { c.rows.push(r); r.parent = c; return r; },
    };
    return c;
}
/** Stage a change on a row as a pill tap does. @param {any} row @param {string} type */
const stage = (row, type) => { row.classList.remove('prefilled-existing'); _activateRow(row, row.cb, /** @type {any} */ ([]), null, null, type); };
/** Stage the removal of a row's saved record, as re-pressing its type does. @param {any} row */
const stageRemoval = (row) => { row.classList.remove('prefilled-existing'); _deactivateRow(row, row.cb, /** @type {any} */ ([]), null, null); };

/** What each day holds in the page's records NOW — what `build` draws a fresh week from. @type {Map<string, any>} */
let cache = new Map();
/** @type {any} */ let grid;
/** @type {{ member: string, week: string }} */ let screen;
let redraws = 0, recounts = 0, marks = 0;

beforeEach(() => {
    cache = new Map(); redraws = 0; recounts = 0; marks = 0;
    screen = { member: MEMBER, week: '2026-08-27' };
    grid = container();
    /** @type {any} */ (globalThis).document = {
        getElementById: (/** @type {string} */ id) => (id === 'weekGrid' ? grid
            : id === 'fieldMember' ? { value: screen.member } : id === 'fieldDate' ? { value: screen.week } : null),
        createElement: () => container(),
    };
    initOwnWrite({
        build: (/** @type {any} */ c) => { for (const d of WEEK) c.appendChild(drawRow(d, cache.get(d) ?? null)); },
        redraw: () => { redraws++; },
        recount: () => { recounts++; },
        hasStagedEdits: () => grid.rows.some((/** @type {any} */ r) => isStagedRow(r)),
        markChanged: () => { marks++; },
    });
});
/** Draw the week on screen from the records as they are now. */
const drawWeek = () => { for (const d of WEEK) grid.appendChild(drawRow(d, cache.get(d) ?? null)); };
const rowOn = (/** @type {string} */ date) => grid.querySelector(`.day-row[data-date="${date}"]`);

describe('syncWeekAfterOwnWrite — the week on screen after the page\'s own write', () => {
    test('nothing staged: the whole week is redrawn, as it always was', () => {
        cache.set(MON, rec(MON)); drawWeek();
        const before = [...grid.rows];
        cache.delete(MON);                                         // the page deletes Monday's leave
        assert.deepEqual(syncWeekAfterOwnWrite([rec(MON)]), []);
        assert.equal(redraws, 1);
        assert.deepEqual(grid.rows, before, 'no row was replaced here: the redraw is the whole answer');
    });

    test('a staged edit on ANOTHER day: only the touched day is redrawn, and the week then compares with what it holds (cost 1)', () => {
        cache.set(MON, rec(MON)); drawWeek();
        stage(rowOn(FRI), 'sick');
        const friday = rowOn(FRI), tuesday = rowOn(TUE);
        cache.delete(MON);
        assert.deepEqual(syncWeekAfterOwnWrite([rec(MON)]), [], 'nothing staged on Monday, so nothing to name');
        assert.equal(redraws, 0, 'the staged edit must not be redrawn away');
        assert.equal(drawnDays(grid).get(MON), null, 'Monday still compared with the deleted leave');
        assert.equal(rowOn(MON).dataset.existingId, undefined);
        assert.equal(rowOn(FRI), friday, 'Friday\'s staged row was replaced');
        assert.equal(rowOn(FRI).dataset.type, 'sick');
        assert.equal(rowOn(TUE), tuesday, 'an untouched day was redrawn');
        assert.equal(recounts, 1, 'the Save button and its bars are recounted');
        assert.equal(marks, 0, 'no staged row changed');
    });

    test('a booking over a day with a staged edit CLEARS that edit and names the day (cost 2)', () => {
        drawWeek();
        stage(rowOn(TUE), 'sick'); stage(rowOn(FRI), 'sick');
        cache.set(MON, rec(MON)); cache.set(TUE, rec(TUE));         // the page books Mon–Tue as leave
        assert.deepEqual(syncWeekAfterOwnWrite([rec(MON), rec(TUE)]), [TUE]);
        assert.equal(rowOn(TUE).dataset.type, 'annual_leave', 'Tuesday shows the leave just booked');
        assert.equal(isStagedRow(rowOn(TUE)), false, 'and the staged absence is gone');
        assert.equal(drawnDays(grid).get(TUE).id, rec(TUE).id, 'a later save of Tuesday compares with the booking');
        assert.equal(isStagedRow(rowOn(FRI)), true, 'the other staged day is untouched');
        assert.equal(marks, 1, 'clearing a staged row is a change to the staged rows: the over-allowance bar\'s batch goes');
        assert.equal(recounts, 1);
    });

    test('deleting a staged day\'s record clears the edit and names it; the day then compares with nothing', () => {
        cache.set(MON, rec(MON)); drawWeek();
        stage(rowOn(MON), 'sick'); stage(rowOn(FRI), 'sick');
        cache.delete(MON);
        assert.deepEqual(syncWeekAfterOwnWrite([rec(MON)]), [MON]);
        assert.equal(drawnDays(grid).get(MON), null);
        assert.equal(rowOn(MON).dataset.type, undefined);
        assert.equal(marks, 1);
    });

    test('a staged REMOVAL of the record the page itself deleted is done: redrawn, not named', () => {
        cache.set(MON, rec(MON)); drawWeek();
        stageRemoval(rowOn(MON)); stage(rowOn(FRI), 'sick');
        cache.delete(MON);
        assert.deepEqual(syncWeekAfterOwnWrite([rec(MON)]), []);
        assert.equal(isStagedRow(rowOn(MON)), false, 'a removal of a record that is gone would delete nothing');
        assert.equal(marks, 1, 'the over-allowance bar\'s captured batch still held the removal');
    });

    test('a touched day whose record did NOT change keeps its row — and the edit staged on it', () => {
        cache.set(MON, rec(MON)); drawWeek();
        stage(rowOn(MON), 'sick');
        const monday = rowOn(MON);
        // An older duplicate of Monday deleted: the record the day shows is untouched.
        assert.deepEqual(syncWeekAfterOwnWrite([rec(MON, { id: 'older-copy' })]), []);
        assert.equal(rowOn(MON), monday);
        assert.equal(rowOn(MON).dataset.type, 'sick');
        assert.equal(recounts + marks, 0);
    });

    test('a COLLEAGUE\'S record a read put in the page is not drawn under an untouched staged row (cost 3)', () => {
        cache.set(MON, rec(MON)); cache.set(FRI, rec(FRI)); drawWeek();
        stage(rowOn(MON), 'sick');
        const theirs = rec(MON, { type: 'rdw', value: '14:00-22:00', changedBy: 'S. Manager', createdAt: { toMillis: () => 2_000 } });
        cache.set(MON, theirs);                                     // a read brings the colleague's change in
        cache.delete(FRI);                                          // …and the page deletes FRIDAY's leave
        assert.deepEqual(syncWeekAfterOwnWrite([rec(FRI)]), []);
        assert.equal(drawnDays(grid).get(MON).type, 'annual_leave', 'Monday now compares with the colleague\'s RDW, and would save over it');
        assert.equal(rowOn(MON).dataset.type, 'sick');
        assert.equal(drawnDays(grid).get(FRI), null, 'Friday follows the delete');
    });

    test('a tick on an unstaged touched row goes with the day; a cleared row\'s does not', () => {
        cache.set(MON, rec(MON)); cache.set(TUE, rec(TUE)); drawWeek();
        rowOn(MON).cb.checked = true;                               // ticked for Apply
        stage(rowOn(TUE), 'sick');                                  // staging ticks a row too
        stage(rowOn(FRI), 'sick');
        cache.delete(MON); cache.delete(TUE);
        assert.deepEqual(syncWeekAfterOwnWrite([rec(MON), rec(TUE)]), [TUE]);
        assert.equal(rowOn(MON).cb.checked, true, 'the manager\'s choice of Monday for Apply was dropped');
        assert.equal(rowOn(MON).classList.contains('selected'), true);
        assert.equal(rowOn(TUE).cb.checked, false, 'a cleared change left its tick behind');
    });

    test('another member\'s records, a bare id, or a day not on screen touch nothing', () => {
        cache.set(MON, rec(MON)); drawWeek();
        stage(rowOn(MON), 'sick');
        const monday = rowOn(MON);
        cache.delete(MON);
        assert.deepEqual(syncWeekAfterOwnWrite([{ ...rec(MON), memberName: 'A. Other' }, rec(MON).id, rec('2026-09-01')]), []);
        assert.equal(rowOn(MON), monday);
        assert.equal(recounts + marks + redraws, 0);
    });

    test('no member or no week on screen: nothing is drawn and nothing is named', () => {
        cache.set(MON, rec(MON)); drawWeek();
        stage(rowOn(MON), 'sick');
        cache.delete(MON);
        screen.week = '';
        assert.deepEqual(syncWeekAfterOwnWrite([rec(MON)]), []);
        assert.equal(rowOn(MON).dataset.type, 'sick');
        assert.equal(recounts + marks + redraws, 0);
    });
});
