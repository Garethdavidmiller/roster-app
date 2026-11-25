// @ts-check
/**
 * admin-confirm-bar.test.mjs — the over-allowance question on admin.html (admin-confirm-bar.js).
 * Run with: node scripts/run-tests.mjs test/admin-confirm-bar.test.mjs   (part of `npm run test:hygiene`)
 *
 * The bar is shared by four cards, and the rule worth pinning is OWNERSHIP: a card may take down only
 * its own question (review, 21 Nov 2026), while a member change, Cancel and Save anyway end whichever
 * question is showing. And the week grid's held batch carries its own receipt — the days its plan left
 * alone — through `show`, so "Save anyway" names them. Driven through the real controller and its two
 * real button handlers; the page's elements are small fakes that record what was done to them.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createConfirmBar } from '../admin-confirm-bar.js';

/** An element with the parts the bar touches, and a way to press it. */
function fakeEl(/** @type {string} */ name) {
    /** @type {Set<string>} */ const classes = new Set();
    /** @type {Function[]} */ const clicks = [];
    return /** @type {any} */ ({
        name, textContent: '', disabled: false, isConnected: true, focused: 0,
        classList: { add: (/** @type {string} */ c) => classes.add(c), remove: (/** @type {string} */ c) => classes.delete(c),
                     contains: (/** @type {string} */ c) => classes.has(c) },
        addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { if (t === 'click') clicks.push(fn); },
        focus() { this.focused++; page.active = this; },
        press: async () => { for (const fn of clicks) await fn(); },
    });
}

/** @type {{ active: any }} */
const page = { active: null };

function setUp({ busy = false } = {}) {
    page.active = null;
    const els = { bar: fakeEl('bar'), msg: fakeEl('msg'), sub: fakeEl('sub'), anyway: fakeEl('anyway'), cancel: fakeEl('cancel'),
                  weekSave: fakeEl('weekSave'), alSave: fakeEl('alSave'), sickSave: fakeEl('sickSave'), body: fakeEl('body') };
    /** @type {any[][]} */ const saved = [];
    /** @type {string[]} */ const said = [];
    let defaultResumes = 0, cancels = 0;
    const bar = createConfirmBar({
        bar: els.bar, msgEl: els.msg, subEl: els.sub, saveAnywayBtn: els.anyway, cancelBtn: els.cancel,
        activeElement: () => page.active, body: els.body,
        fallbackOpener: ({ batch, resume }) => batch ? els.weekSave : resume ? els.sickSave : els.alSave,
        isSaveInFlight: () => busy, onBusy: (m) => { said.push(m); },
        saveBatch: async (...a) => { saved.push(a); },
        resumeDefault: () => { defaultResumes++; },
        afterCancel: () => { cancels++; },
    });
    return { bar, els, saved, said, get defaultResumes() { return defaultResumes; }, get cancels() { return cancels; } };
}
const visible = (/** @type {any} */ els) => els.bar.classList.contains('visible');

describe('a card may hide only its own question', () => {
    it('the AL card\'s question survives the week grid taking its own down, and goes when the AL card does', () => {
        const t = setUp();
        t.bar.show({ msg: 'Over', sub: 'by 1', owner: 'al' });
        assert.equal(t.bar.owner(), 'al');
        for (const other of /** @type {const} */ (['week', 'sick', 'saved'])) {
            t.bar.hide(other);
            assert.ok(visible(t.els), `the ${other} card took down a question it did not ask`);
            assert.equal(t.els.anyway.disabled, false, 'and Save anyway is still armed');
        }
        t.bar.hide('al');
        assert.ok(!visible(t.els));
        assert.equal(t.bar.owner(), null);
    });

    it('the week grid\'s question survives an AL range edit', () => {
        const t = setUp();
        t.bar.show({ msg: 'Over', sub: 'by 2', batch: { toSave: [{ date: '2026-11-02' }], toDelete: [] } });
        assert.equal(t.bar.owner(), 'week', 'a batch is the week grid\'s by default');
        t.bar.hide('al');
        assert.ok(visible(t.els));
    });

    it('a bare hide — a member change — ends whichever question is showing, and disarms Save anyway', () => {
        const t = setUp();
        t.bar.show({ msg: 'Over', sub: 'by 1', resume: () => {}, owner: 'sick' });
        t.bar.hide();
        assert.ok(!visible(t.els));
        assert.equal(t.els.anyway.disabled, true, 'disarmed through the slide-out');
    });

    it('a hide for a card with nothing showing does nothing harmful', () => {
        const t = setUp();
        t.bar.hide('week');
        assert.ok(!visible(t.els));
        assert.equal(t.bar.owner(), null);
    });
});

describe('Save anyway', () => {
    it('writes the week grid\'s held batch WITH the days its plan left alone, so the receipt names them', async () => {
        const t = setUp();
        const toSave = [{ date: '2026-11-02' }], toDelete = ['x'];
        t.bar.show({ msg: 'Over', sub: 'by 1', batch: { toSave, toDelete, skipped: ['2026-11-07'], kept: ['2026-11-07'] } });
        await t.els.anyway.press();
        assert.deepEqual(t.saved, [[toSave, toDelete, ['2026-11-07'], ['2026-11-07']]]);
        assert.ok(!visible(t.els), 'and the question is over');
    });

    it('a later question does not inherit an earlier batch\'s skipped days', async () => {
        const t = setUp();
        t.bar.show({ msg: 'Over', sub: '', batch: { toSave: [1], toDelete: [], skipped: ['2026-11-07'], kept: [] } });
        t.bar.hide();
        t.bar.show({ msg: 'Over', sub: '', batch: { toSave: [2], toDelete: [] } });
        await t.els.anyway.press();
        assert.deepEqual(t.saved, [[[2], [], [], []]]);
    });

    it('runs the asking range card\'s own resume, or the AL card\'s when it handed none', async () => {
        const t = setUp();
        let resumed = 0;
        t.bar.show({ msg: 'Over', sub: '', resume: () => { resumed++; }, owner: 'sick' });
        await t.els.anyway.press();
        assert.equal(resumed, 1);
        assert.equal(t.defaultResumes, 0);
        t.bar.show({ msg: 'Over', sub: '' });
        await t.els.anyway.press();
        assert.equal(t.defaultResumes, 1);
    });

    it('a second press, or a press after the bar went, does nothing', async () => {
        const t = setUp();
        t.bar.show({ msg: 'Over', sub: '' });
        await t.els.anyway.press();
        await t.els.anyway.press();
        assert.equal(t.defaultResumes, 1, 'the press disarmed it');
    });

    it('waits for a save still sending: one write at a time, and the question stays', async () => {
        const t = setUp({ busy: true });
        t.bar.show({ msg: 'Over', sub: '', batch: { toSave: [1], toDelete: [] } });
        await t.els.anyway.press();
        assert.deepEqual(t.saved, []);
        assert.match(t.said[0], /still saving/);
        assert.ok(visible(t.els));
    });
});

describe('Cancel', () => {
    it('ends the question and returns focus to the control that asked', async () => {
        const t = setUp();
        page.active = t.els.alSave;
        t.bar.show({ msg: 'Over', sub: '' });
        assert.equal(page.active, t.els.anyway, 'Save anyway takes focus when asked');
        await t.els.cancel.press();
        assert.ok(!visible(t.els));
        assert.equal(t.cancels, 1);
        assert.equal(page.active, t.els.alSave);
    });

    it('with nothing focused (Safari), focus goes to the asking card\'s Save', async () => {
        const t = setUp();
        page.active = t.els.body;
        t.bar.show({ msg: 'Over', sub: '', batch: { toSave: [1], toDelete: [] } });
        await t.els.cancel.press();
        assert.equal(page.active, t.els.weekSave);
    });
});
