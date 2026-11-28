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
import { createSaveLine, saveStatusWords } from '../paycalc-save-line.js';

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

// ── THE STATUS LINE'S WORDS (saveStatusWords, out of paycalc-app.js on 28 Nov 2026) ──────────────
// What a wrong answer costs: "saved" over figures storage never kept, or "No entries saved" over
// entries that cannot be read — the member types over them believing there was nothing there.
describe('saveStatusWords — what the status line says about a payslip', () => {
    const DEF = 147.36;
    /** @param {any} data */ const saved = (data) => ({ data, error: false });

    test('a failure on the line is said as it stands, whatever storage holds', () => {
        assert.deepEqual(saveStatusWords({ failure: NOT_SAVED, saved: saved({ satH: 3 }), defaultPension: DEF }),
            { text: NOT_SAVED, cls: 'failed' });
    });

    test('entries that cannot be read say so, never "No entries saved"', () => {
        const w = saveStatusWords({ failure: null, saved: { data: null, error: 'bad' }, defaultPension: DEF });
        assert.equal(w.cls, 'corrupt');
        assert.match(w.text, /Couldn't read this payslip's saved entries/);
    });

    test('entries, or a pension of the payslip\'s own, are "saved"; the default pension alone is not', () => {
        const yes = { text: '✓ Entries saved for this payslip', cls: 'saved' };
        assert.deepEqual(saveStatusWords({ failure: null, saved: saved({ satH: 3 }), defaultPension: DEF }), yes);
        assert.deepEqual(saveStatusWords({ failure: null, saved: saved({ pension: 0 }), defaultPension: DEF }), yes, 'a £0 opt-out is an entry');
        assert.deepEqual(saveStatusWords({ failure: null, saved: saved({ pension: 147.37 }), defaultPension: DEF }), yes);
        assert.equal(saveStatusWords({ failure: null, saved: saved({ pension: 147.364 }), defaultPension: DEF }).cls, 'unsaved',
            'within half a penny of the default is the default');
    });

    test('only payslip figures are named as the comparison they are', () => {
        assert.equal(saveStatusWords({ failure: null, saved: saved({ actualNet: 0 }), defaultPension: DEF }).text, '✓ Take-home comparison saved');
        assert.equal(saveStatusWords({ failure: null, saved: saved({ actualTax: 12 }), defaultPension: DEF }).text, '✓ Payslip comparison saved');
    });

    test('nothing stored, or an empty record, is "No entries saved"', () => {
        const no = { text: 'No entries saved for this payslip', cls: 'unsaved' };
        assert.deepEqual(saveStatusWords({ failure: null, saved: null, defaultPension: DEF }), no);
        assert.deepEqual(saveStatusWords({ failure: null, saved: saved({ satH: 0, slSkip: false }), defaultPension: DEF }), no);
    });
});
