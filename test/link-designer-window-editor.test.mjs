// @ts-check
// @lane hygiene
/**
 * link-designer-window-editor.test.mjs — the staffed-window editor on the Link Designer Coverage card
 * (link-designer-window-editor.js), through the listeners it actually wires, on a fake DOM.
 * Run: node scripts/run-tests.mjs test/link-designer-window-editor.test.mjs   (part of `npm run test:hygiene`)
 *
 * What a window MAY be is link-designer-window.test.mjs's. What is pinned here is the editor's own half: an
 * accepted edit reaches the coordinator's `setWindow` (which is what marks the design dirty), a refused
 * one never does and says why AFTER the repaint, and an unchanged box is not an edit. The harness
 * RECORDS what `setWindow` is given rather than discarding it, so a payload can be asserted.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createWindowEditor } from '../link-designer-window-editor.js';
import { DEFAULT_WINDOW, normaliseWindow } from '../link-designer-window.js';

const IDS = ['windowEditor', 'winMonSatStart', 'winMonSatEnd', 'winSunStart', 'winSunEnd', 'winStatus', 'winMoved', 'winReset'];

/** A fake element: a value, hidden, textContent, and the listeners added to it. */
function fakeEl() {
    /** @type {Record<string, Array<(e: any) => void>>} */
    const on = {};
    return {
        value: '', hidden: false, textContent: '', selectionStart: 0, selectionEnd: 0,
        setSelectionRange(/** @type {number} */ a, /** @type {number} */ b) { this.selectionStart = a; this.selectionEnd = b; },
        addEventListener(/** @type {string} */ type, /** @type {(e: any) => void} */ fn) { (on[type] ??= []).push(fn); },
        fire(/** @type {string} */ type, /** @type {any} */ e = {}) { for (const fn of on[type] ?? []) fn(e); },
    };
}

/** @type {Record<string, ReturnType<typeof fakeEl>>} */ let els;
/** @type {any} */ let design;
/** @type {any[]} */ let given;
/** @type {() => void} */ let paint;

/** The coordinator's half, as link-designer-app.js does it: replace the window, then repaint (which repaints the editor). */
const setWindow = (/** @type {any} */ next) => { given.push(next); design = { ...design, window: next }; paint(); };

beforeEach(() => {
    els = Object.fromEntries(IDS.map(id => [id, fakeEl()]));
    /** @type {any} */ (globalThis).document = { getElementById: (/** @type {string} */ id) => els[id] ?? null };
    design = { patterns: {}, window: null };
    given = [];
    paint = createWindowEditor({ getDesign: () => design, setWindow });
    paint();
});

/** Type into a box and leave it, as a person does. @param {string} id @param {string} value */
const typeAndLeave = (id, value) => { els[id].value = value; els[id].fire('change'); els[id].fire('blur'); };

describe('painting', () => {
    test('the boxes hold the stored window, and the moved flag is down on the default', () => {
        assert.equal(els.windowEditor.hidden, false);
        assert.equal(els.winMonSatStart.value, DEFAULT_WINDOW.monSat.start);
        assert.equal(els.winSunEnd.value, DEFAULT_WINDOW.sun.end);
        assert.equal(els.winMoved.hidden, true);
    });

    test('no design hides the editor', () => {
        design = null;
        paint();
        assert.equal(els.windowEditor.hidden, true);
    });

    test('a page without the editor gets a paint that does nothing', () => {
        /** @type {any} */ (globalThis).document = { getElementById: () => null };
        const none = createWindowEditor({ getDesign: () => design, setWindow });
        assert.doesNotThrow(() => none());
    });
});

describe('an edit (rule 1)', () => {
    test('an accepted time goes to setWindow as the whole window, the other row untouched', () => {
        typeAndLeave('winMonSatStart', '05:30');
        assert.equal(given.length, 1, 'change and blur both commit, and the second finds nothing to do');
        assert.deepEqual(given[0], { monSat: { start: '05:30', end: DEFAULT_WINDOW.monSat.end }, sun: { ...DEFAULT_WINDOW.sun } });
        assert.equal(els.winMoved.hidden, false, 'the moved flag follows the change');
    });

    test('a time left as three digits is settled before it is read (rule 4)', () => {
        typeAndLeave('winSunStart', '645');
        assert.deepEqual(given.at(-1)?.sun, { start: '06:45', end: DEFAULT_WINDOW.sun.end });
    });

    test('the value the box already holds is not an edit', () => {
        typeAndLeave('winMonSatEnd', DEFAULT_WINDOW.monSat.end);
        assert.deepEqual(given, []);
    });
});

describe('a refusal (rule 2)', () => {
    test('a finish before its start is refused, never coerced: nothing reaches setWindow, the boxes go back, and it says why', () => {
        typeAndLeave('winMonSatEnd', '05:00');
        assert.deepEqual(given, []);
        assert.equal(els.winMonSatEnd.value, DEFAULT_WINDOW.monSat.end, 'the stored value is put back');
        assert.match(els.winStatus.textContent, /A finish must be after its start/, 'written AFTER the repaint, which clears it');
    });

    test('an emptied box is refused for being empty, not for its order', () => {
        typeAndLeave('winSunStart', '');
        assert.deepEqual(given, []);
        assert.match(els.winStatus.textContent, /A start and a finish are both needed/);
    });

    test('the next good edit clears the refusal', () => {
        typeAndLeave('winMonSatEnd', '05:00');
        typeAndLeave('winMonSatEnd', '22:00');
        assert.equal(els.winStatus.textContent, '');
        assert.equal(given.length, 1);
    });
});

/**
 * One change as a browser makes it: `beforeinput` with the box as it was and the selection the change replaces, then
 * the new value and `input` (clock-input.js rule 7 reads both). @param {string} id @param {number} from @param {number} to
 * @param {string} text  what replaces the selection ('' deletes) @param {string} inputType
 */
function change(id, from, to, text, inputType) {
    const el = els[id];
    el.selectionStart = from; el.selectionEnd = to;
    el.fire('beforeinput');
    el.value = el.value.slice(0, from) + text + el.value.slice(to);
    el.selectionStart = el.selectionEnd = from + text.length;
    el.fire('input', { inputType, data: text || null });
}
/** Select everything in the box and type `digits` one key at a time. @param {string} id @param {string} digits */
function retype(id, digits) {
    change(id, 0, els[id].value.length, '', 'deleteContentBackward');
    for (const c of digits) change(id, els[id].value.length, els[id].value.length, c, 'insertText');
}
const leave = (/** @type {string} */ id) => { els[id].fire('change'); els[id].fire('blur'); };

// ── A real edit, through the clock box's own listeners (external review of v26.87) ───────────────────
describe('an edit that leaves an unfinished time (rule 4)', () => {
    beforeEach(() => { design = { patterns: {}, window: { monSat: { start: '16:30', end: '22:30' }, sun: { ...DEFAULT_WINDOW.sun } } }; paint(); });

    test('Delete at the front of 16:30 is refused by name — never read as a 06:30 start', () => {
        change('winMonSatStart', 0, 1, '', 'deleteContentForward');
        assert.equal(els.winMonSatStart.value, '6:30', 'clock-input.js leaves an edit as it is');
        leave('winMonSatStart');
        assert.deepEqual(given, [], 'the window grew from six hours to sixteen without a word');
        assert.equal(design.window.monSat.start, '16:30', 'the working design is unchanged');
        assert.equal(els.winMonSatStart.value, '16:30', 'the stored time is put back');
        assert.match(els.winStatus.textContent, /“6:30” is not a whole time/);
    });

    test('a short time typed afresh is still taken: select all, 630, leave — 06:30', () => {
        retype('winMonSatStart', '630');
        leave('winMonSatStart');
        assert.deepEqual(given.at(-1)?.monSat, { start: '06:30', end: '22:30' });
        assert.equal(els.winStatus.textContent, '');
    });
});

describe('an unchanged time typed as a shortcut (rule 5)', () => {
    test('130 over a stored 01:30 shows 01:30 when left, and marks nothing dirty', () => {
        design = { patterns: {}, window: { monSat: { start: '01:30', end: '22:30' }, sun: { ...DEFAULT_WINDOW.sun } } };
        paint();
        retype('winMonSatStart', '130');
        assert.equal(els.winMonSatStart.value, '13:0', 'as typed, before the box is left');
        leave('winMonSatStart');
        assert.equal(els.winMonSatStart.value, '01:30', 'the box kept showing 13:0');
        assert.deepEqual(given, [], 'an unchanged window is not an edit');
    });
});

describe('the reset', () => {
    test('a moved window goes back to the default', () => {
        typeAndLeave('winMonSatStart', '05:30');
        els.winReset.fire('click');
        assert.deepEqual(given.at(-1), normaliseWindow(null));
        assert.equal(els.winMoved.hidden, true);
    });

    test('on the default window it is not an edit', () => {
        els.winReset.fire('click');
        assert.deepEqual(given, []);
    });
});
