// @ts-check
// @lane unit
/**
 * paycalc-ytd-card.test.mjs — the Year to Date card's anchor on the page (paycalc-ytd-card.js).
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs test/paycalc-ytd-card.test.mjs
 *
 * The module owns no rule: `ytdSourceToStamp`, `buildYtdSourceSelect` and `ytdAnchorStatus`
 * (paycalc-periods.js) decide, and their own suites hold them. What can go wrong HERE is the
 * carrying — a guard read off the wrong box, a stamp worked out and never recorded, a chip left
 * holding the last payslip's words — so each is asserted through the real rules against a fake DOM,
 * with only the leaves (Firebase, storage, the roster) stubbed.
 */
import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const _ls = new Map();
mock.module('../ls.js', {
    namedExports: {
        lsGet: (/** @type {string} */ k) => (_ls.has(k) ? _ls.get(k) : null),
        lsSet: (/** @type {string} */ k, /** @type {any} */ v) => { _ls.set(k, String(v)); },
        lsDel: (/** @type {string} */ k) => { _ls.delete(k); }, lsKeys: () => [..._ls.keys()],
        lsSetVerified: (/** @type {string} */ k, /** @type {any} */ v) => { _ls.set(k, String(v)); return true; },
        lsMove: () => false,
    },
});
mock.module('../paycalc-roster-suggestions.js', {
    namedExports: { getRosterSuggestion: async () => ({}), fetchOverridesForPeriod: async () => {} },
});
mock.module('../roster-data.js', { namedExports: { teamMembers: [], getBankHolidays: () => [] } });   // No bank holidays (paycalc-periods.js reads them here since bhsForYear moved there, Nov 2026).

/** A fake element: a value, text, a class set, and children a select's `options` can list. */
function el(value = '') {
    const cls = new Set();
    /** @type {any[]} */ let kids = [];
    return {
        value, textContent: '', label: '', selected: false,
        set innerHTML(/** @type {string} */ v) { kids = []; this._h = v; }, get innerHTML() { return this._h ?? ''; },
        /** @type {string|undefined} */ _h: undefined,
        appendChild(/** @type {any} */ c) { kids.push(c); return c; },
        get options() { return kids.flatMap(k => (k.options.length ? k.options : [k])); },
        setAttribute() {}, dispatchEvent() { return true; },
        /** @type {Record<string, Function[]>} */ _on: {},
        addEventListener(/** @type {string} */ type, /** @type {Function} */ fn) { (this._on[type] ??= []).push(fn); },
        /** Run what the module wired for `type`, as the browser would. */
        fire(/** @type {string} */ type, /** @type {any} */ ev = {}) { for (const fn of this._on[type] ?? []) fn(ev); },
        classList: {
            toggle(/** @type {string} */ c, /** @type {boolean} */ on) { if (on) cls.add(c); else cls.delete(c); },
            contains: (/** @type {string} */ c) => cls.has(c),
        },
    };
}
/** @type {Record<string, any>} */ let els;
/** @type {any} */ (globalThis).document = {
    getElementById: (/** @type {string} */ id) => els[id] ?? null,
    createElement: () => el(),
};

const { ytdHasFigures, refreshYtdSrc, updateYtdNote, wireYtdCard } = await import('../paycalc-ytd-card.js');
const { ytdSrcKey } = await import('../paycalc-migrations.js');
const { getPeriods, CONFIG, YTD_SRC_EARLY } = await import('../paycalc-periods.js');
const TY26 = /** @type {any} */ (CONFIG.TAX_YEARS.find((/** @type {any} */ t) => t.label === '2026/27'));
const P = (/** @type {number} */ n) => /** @type {any} */ (getPeriods().find((/** @type {any} */ p) => p.num === n));

beforeEach(() => {
    _ls.clear();
    els = { ytdPay: el(), ytdTax: el(), ytdUptoNote: el(), ytdStatusChip: el() };
});

describe('the one guard: does either box hold figures?', () => {
    test('either box, after trimming — and neither means none', () => {
        assert.equal(ytdHasFigures(), false);
        els.ytdPay.value = '   ';
        assert.equal(ytdHasFigures(), false, 'spaces are not a figure');
        els.ytdTax.value = '2,100.00';
        assert.equal(ytdHasFigures(), true, 'the Tax Paid box alone');
        els.ytdTax.value = ''; els.ytdPay.value = '21,000';
        assert.equal(ytdHasFigures(), true, 'the Taxable Pay box alone');
    });
});

describe('the note and the chip carry ytdAnchorStatus, and are rewritten on every run', () => {
    test('figures in use on the payslip after their source: the live note and the green chip', () => {
        els.ytdPay.value = '21000'; els.ytdTax.value = '2100';
        updateYtdNote(TY26, P(59), 58, true, '1257L');
        assert.match(els.ytdUptoNote.innerHTML, /\S/, 'a note is written');
        assert.equal(els.ytdUptoNote.classList.contains('ytd-upto-note--live'), true);
        assert.equal(els.ytdStatusChip.classList.contains('ytd-status-chip--live'), true);
        // The next run, on a payslip they cannot sharpen: the same targets, the other words.
        updateYtdNote(TY26, P(61), 58, false, '1257L');
        assert.equal(els.ytdStatusChip.classList.contains('ytd-status-chip--live'), false, 'never left holding "in use"');
        assert.equal(els.ytdUptoNote.classList.contains('ytd-upto-note--live'), false);
    });
    test('no figures: nothing to report, so the chip is emptied rather than left as it was', () => {
        els.ytdStatusChip.textContent = '✓ in use';
        updateYtdNote(TY26, P(59), 58, false, '1257L');
        assert.equal(els.ytdStatusChip.textContent, '');
        assert.equal(els.ytdUptoNote.innerHTML, '');
    });
});

describe('the source anchor: a stamp worked out is a stamp recorded', () => {
    test('figures with no source recorded get one — and storage holds it, not only the select', () => {
        els.ytdSrcSelect = el();
        els.ytdPay.value = '21000';
        refreshYtdSrc(TY26);
        const stored = _ls.get(ytdSrcKey(TY26));
        assert.ok(stored && Number(stored) >= 48 + TY26.first, `a payslip of the year is recorded (${stored})`);
    });
    // Figures entered before any payslip of the year could be in hand (24 Nov 2026): a LOAD must never
    // file them against the first payslip that can be — that read last year's totals as April's — but
    // the member typing figures in now is a first entry again.
    test('figures held as from no payslip of the year: a load leaves them so, typing files them afresh', () => {
        els.ytdSrcSelect = el();
        els.ytdPay.value = '42000';
        _ls.set(ytdSrcKey(TY26), YTD_SRC_EARLY);
        refreshYtdSrc(TY26);
        assert.equal(_ls.get(ytdSrcKey(TY26)), YTD_SRC_EARLY, 'a load files nothing');
        refreshYtdSrc(TY26, { typed: true });
        const stored = _ls.get(ytdSrcKey(TY26));
        assert.ok(stored && Number(stored) >= 48 + TY26.first, `typed in now, they are a first entry (${stored})`);
    });
    test('without the card on the page, nothing is touched', () => {
        els.ytdPay.value = '21000';
        refreshYtdSrc(TY26);
        assert.equal(_ls.has(ytdSrcKey(TY26)), false);
    });
});

// THE WIRING (out of paycalc-app.js, 25 Nov 2026): which source a typing or a pick leaves recorded.
// On 25 Nov 2026 the payslip on screen is the one being earned (paid 18 Dec, P59), and the one the
// take-home line names to copy from is the 20 Nov payslip (P58) — the source a re-type moves to.
describe('the card\'s wiring: what a typing or a pick leaves recorded', () => {
    /** Wire a fresh card over payslip 59 with `stored` as its source; returns the calls it made. */
    const wired = (/** @type {string|null} */ stored) => {
        els.ytdSrcSelect = el(); els.periodSelect = el('59');
        if (stored != null) _ls.set(ytdSrcKey(TY26), stored);
        const calls = { saved: 0, priced: 0 };
        wireYtdCard({ saveSettings: () => { calls.saved++; }, calculate: () => { calls.priced++; } });
        return calls;
    };
    /** Type into the Taxable Pay box the way a member does: focus from outside the card, then input. */
    const type = (/** @type {string} */ v) => { els.ytdPay.fire('focus', { relatedTarget: null }); els.ytdPay.value = v; els.ytdPay.fire('input'); };

    test('figures typed AGAIN over an older source move it to the payslip the take-home line names', (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 25, 12) });
        const calls = wired('55');
        els.ytdPay.value = '19000'; els.ytdTax.value = '1900';   // figures already there: a re-type
        type('21000');
        assert.equal(_ls.get(ytdSrcKey(TY26)), '58');
        assert.deepEqual(calls, { saved: 1, priced: 1 }, 'the boxes are saved and the payslip re-priced');
    });

    test('…but typed into EMPTY boxes they come from the source already chosen', (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 25, 12) });
        wired('55');
        type('21000');
        assert.equal(_ls.get(ytdSrcKey(TY26)), '55');
    });

    test('…and a source PICKED this visit is kept, whatever is typed after it', (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 25, 12) });
        wired(null);
        els.ytdPay.value = '19000'; els.ytdTax.value = '1900';
        els.ytdSrcSelect.value = '55'; els.ytdSrcSelect.fire('change');
        assert.equal(_ls.get(ytdSrcKey(TY26)), '55', 'the pick is recorded');
        type('21000');
        assert.equal(_ls.get(ytdSrcKey(TY26)), '55', 'and not moved by the figures typed after it');
    });

    test('moving between the two boxes is ONE edit, so the second box does not re-read it', (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 25, 12) });
        wired('55');
        type('21000');                                              // empty boxes: not a re-type
        els.ytdTax.fire('focus', { relatedTarget: { id: 'ytdPay' } });
        els.ytdTax.value = '2100'; els.ytdTax.fire('input');
        assert.equal(_ls.get(ytdSrcKey(TY26)), '55', 'the Tax Paid box is the same first entry');
    });

    test('picking the blank placeholder records "not from a payslip", never deletes the record', () => {
        const calls = wired('58');
        els.ytdSrcSelect.value = ''; els.ytdSrcSelect.fire('change');
        assert.equal(_ls.get(ytdSrcKey(TY26)), '0');
        assert.equal(calls.priced, 1, 'and the payslip is re-priced, which rewrites the note and chip');
    });
});
