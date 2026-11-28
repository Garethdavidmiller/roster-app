// @ts-check
// @lane hygiene
/**
 * paycalc-save-line.test.mjs — the Pay Calculator's "not saved" line (paycalc-save-line.js).
 * Run: node scripts/run-tests.mjs test/paycalc-save-line.test.mjs   (part of `npm run test:hygiene`)
 *
 * @nodeps-safe — runs on a bare checkout with nothing installed.
 *
 * Organised by what a wrong answer costs. The expensive direction is a Retry that runs something the
 * words did not name (a Clear's delete under "Not saved — try again"), and a "saved" over a setting
 * storage never kept. The rendered page — the real writes, the real Retry button — is
 * e2e/paycalc-saving.spec.js's.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveLine } from '../paycalc-save-line.js';

const NOT_SAVED = '⚠ Not saved — try again';
const NOT_CLEARED = "⚠ Couldn't clear this payslip — its saved entries are still there. Try again";

/** A fake page: the status line, the Retry button and the live region, sharing one activeElement. */
function fakePage() {
    /** @type {any} */ const doc = { activeElement: null };
    /** @param {string} name */
    const el = (name) => {
        /** @type {any} */ const e = {
            name, hidden: false, ownerDocument: doc, kids: /** @type {any[]} */ ([]),
            get textContent() { return e.kids.map((/** @type {any} */ k) => k.textContent).join(''); },
            set textContent(v) { e.kids = v ? [{ textContent: v }] : []; },
            appendChild(/** @type {any} */ k) { e.kids.push(k); },
            setAttribute() {},
            focus() { doc.activeElement = e; },
        };
        return e;
    };
    doc.createElement = () => el('span');
    doc.createTextNode = (/** @type {string} */ t) => ({ textContent: t });
    const statusEl = el('status'), retryBtn = el('retry'), liveEl = el('live');
    retryBtn.hidden = true;
    return { doc, statusEl, retryBtn, liveEl };
}

/** Paint as updateSaveStatus does: the status line's words first, then the line. */
function paint(/** @type {ReturnType<typeof createSaveLine>} */ line, /** @type {ReturnType<typeof fakePage>} */ page, savedWords = '✓ Entries saved for this payslip') {
    page.statusEl.textContent = line.text ?? savedWords;
    line.paint(page);
}

describe('the words and what Retry runs are one failure\'s', () => {
    test('a setting refused while a Clear\'s failure stands leaves the Clear\'s words AND its Retry', () => {
        const line = createSaveLine();
        const clearPeriod = () => {}, persist = () => {};
        line.fail(NOT_CLEARED, { from: 'form', retry: clearPeriod });
        line.fail(NOT_SAVED, { from: 'setting', retry: persist, fields: ['pension'] });
        assert.equal(line.text, NOT_CLEARED, 'the words still name the Clear');
        assert.equal(line.retry, clearPeriod, '…and Retry still runs the Clear they name');
    });

    test('a form failure replaces a setting\'s line, words and Retry together', () => {
        const line = createSaveLine();
        const persist = () => {}, autosave = () => {};
        line.fail(NOT_SAVED, { from: 'setting', retry: persist, fields: ['pension'] });
        line.fail(NOT_CLEARED, { from: 'form', retry: autosave });
        assert.equal(line.text, NOT_CLEARED);
        assert.equal(line.retry, autosave);
    });
});

describe('"saved" only for what storage kept', () => {
    test('a second setting\'s write carries the first one\'s refused field', () => {
        const line = createSaveLine();
        line.fail(NOT_SAVED, { from: 'setting', retry: () => {}, fields: ['pension'] });
        assert.deepEqual(line.settingFields(['slSkip']).sort(), ['pension', 'slSkip']);
    });

    test('a setting stored without the refused field does not end the line', () => {
        const line = createSaveLine();
        line.fail(NOT_SAVED, { from: 'setting', retry: () => {}, fields: ['slSkip'] });
        line.settingStored(['pension']);
        assert.equal(line.text, NOT_SAVED, 'slSkip is still not stored');
    });

    test('a setting stored WITH the refused field ends the line', () => {
        const line = createSaveLine();
        line.fail(NOT_SAVED, { from: 'setting', retry: () => {}, fields: ['slSkip'] });
        line.settingStored(line.settingFields(['pension']));
        assert.equal(line.text, null);
        assert.equal(line.retry, null);
    });

    test('a setting stored never ends a line about the form', () => {
        const line = createSaveLine();
        line.fail(NOT_SAVED, { from: 'form', retry: () => {} });
        line.settingStored(['pension', 'slSkip']);
        assert.equal(line.text, NOT_SAVED);
    });

    test('a whole-form save or a fresh load forgets the refused fields', () => {
        const line = createSaveLine();
        line.fail(NOT_SAVED, { from: 'setting', retry: () => {}, fields: ['slSkip'] });
        line.stored();
        assert.deepEqual(line.settingFields(['pension']), ['pension']);
        line.fail(NOT_SAVED, { from: 'setting', retry: () => {}, fields: ['slSkip'] });
        line.reset();
        assert.deepEqual(line.settingFields(['pension']), ['pension']);
    });
});

describe('a hidden Retry gives its focus to the line', () => {
    test('Retry focused and nothing left to retry: focus goes to the status line', () => {
        const line = createSaveLine(), page = fakePage();
        line.fail(NOT_SAVED, { retry: () => {} });
        paint(line, page);
        assert.equal(page.retryBtn.hidden, false);
        page.doc.activeElement = page.retryBtn;
        line.stored();
        paint(line, page);
        assert.equal(page.retryBtn.hidden, true);
        assert.equal(page.doc.activeElement, page.statusEl);
    });

    test('Retry hiding without focus moves nobody\'s focus', () => {
        const line = createSaveLine(), page = fakePage();
        line.fail(NOT_SAVED, { retry: () => {} });
        paint(line, page);
        page.doc.activeElement = { name: 'satH' };
        line.stored();
        paint(line, page);
        assert.equal(page.doc.activeElement.name, 'satH');
    });
});

describe('a change of state is spoken, a keystroke is not', () => {
    test('the line going up is spoken once, not again on the next refused keystroke', () => {
        const line = createSaveLine(), page = fakePage();
        paint(line, page);
        assert.equal(page.liveEl.textContent, '', 'an ordinary save says nothing');
        line.fail(NOT_SAVED, { retry: () => {} });
        paint(line, page);
        assert.equal(page.liveEl.textContent, NOT_SAVED);
        page.liveEl.kids = [{ textContent: 'sentinel' }];
        line.fail(NOT_SAVED, { retry: () => {} });
        paint(line, page);
        assert.equal(page.liveEl.textContent, 'sentinel', 'the same line again is not re-spoken');
    });

    test('a write that ends the line speaks the recovery', () => {
        const line = createSaveLine(), page = fakePage();
        line.fail(NOT_SAVED, { retry: () => {} });
        paint(line, page);
        line.stored();
        paint(line, page);
        assert.equal(page.liveEl.textContent, '✓ Entries saved for this payslip');
    });

    test('a later ordinary save says nothing more', () => {
        const line = createSaveLine(), page = fakePage();
        line.fail(NOT_SAVED, { retry: () => {} });
        paint(line, page);
        line.stored();
        paint(line, page);
        page.liveEl.kids = [{ textContent: 'sentinel' }];
        line.stored();
        paint(line, page);
        assert.equal(page.liveEl.textContent, 'sentinel');
    });

    test('a payslip loaded afresh ends the line silently', () => {
        const line = createSaveLine(), page = fakePage();
        line.fail(NOT_SAVED, { retry: () => {} });
        paint(line, page);
        line.reset();
        paint(line, page, 'No entries saved for this payslip');
        assert.equal(page.liveEl.textContent, '');
    });

    test('where focus moved to the line, the region is emptied rather than said twice', () => {
        const line = createSaveLine(), page = fakePage();
        line.fail(NOT_SAVED, { retry: () => {} });
        paint(line, page);
        page.doc.activeElement = page.retryBtn;
        line.stored();
        paint(line, page);
        assert.equal(page.liveEl.textContent, '');
    });
});
