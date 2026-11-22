// @ts-check
/**
 * links-print.test.mjs — preparing the Links page for paper, and putting it back (links-print.js).
 * Run: node scripts/run-tests.mjs links-print.test.mjs   (part of `npm run test:hygiene`)
 *
 * A fake window and document that record their listeners, so a test can send exactly the events an
 * engine sends — or, on iOS AirPrint, does not.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createPrintPrep } from './links-print.js';

function makePage({ closed = 3, open = 1 } = {}) {
    /** @type {Record<string, Function[]>} */ const winOn = {}, docOn = {};
    const details = [...Array(closed).fill(false), ...Array(open).fill(true)].map(o => ({ open: o }));
    let printMedia = false;
    const win = /** @type {any} */ ({
        scrollY: 0,
        matchMedia: () => ({ matches: printMedia }),
        addEventListener: (/** @type {string} */ t, /** @type {Function} */ f) => { (winOn[t] ??= []).push(f); },
        removeEventListener: (/** @type {string} */ t, /** @type {Function} */ f) => { winOn[t] = (winOn[t] ?? []).filter(x => x !== f); },
    });
    const doc = /** @type {any} */ ({
        visibilityState: 'visible',
        querySelectorAll: (/** @type {string} */ sel) => { assert.equal(sel, 'details:not([open])'); return details.filter(d => !d.open); },
        addEventListener: (/** @type {string} */ t, /** @type {Function} */ f) => { (docOn[t] ??= []).push(f); },
    });
    let stamps = 0;
    const prep = createPrintPrep({ stamp: () => { stamps++; }, win, doc });
    return {
        prep, details, win,
        stamps: () => stamps,
        /** @param {string} type @param {any} [ev] */
        fire: (type, ev = {}) => { for (const f of [...(winOn[type] ?? [])]) f({ type, ...ev }); },
        /** @param {string} type */
        fireDoc: (type) => { for (const f of [...(docOn[type] ?? [])]) f({ type }); },
        listening: (/** @type {string} */ type) => (winOn[type] ?? []).length,
        setPrintMedia: (/** @type {boolean} */ v) => { printMedia = v; },
    };
}
const allOpen = (/** @type {any[]} */ ds) => ds.every(d => d.open);

describe('a print opens every disclosure, and puts back only what it opened', () => {
    test('beforeprint opens them; afterprint closes the ones it opened, and leaves the open one open', () => {
        const p = makePage();
        p.fire('beforeprint');
        assert.ok(allOpen(p.details));
        p.fire('afterprint');
        assert.deepEqual(p.details.map(d => d.open), [false, false, false, true]);
    });
    test('preparing twice takes one snapshot (rule 3) — and stamps both times (rule 2)', () => {
        const p = makePage();
        p.prep.prepare(); p.fire('beforeprint');
        assert.equal(p.stamps(), 2);
        p.fire('afterprint');
        assert.deepEqual(p.details.map(d => d.open), [false, false, false, true], 'a second snapshot would have recorded every one as open');
    });
    test('becoming visible again restores, for the engine that sends no afterprint', () => {
        const p = makePage();
        p.prep.prepare();
        p.fireDoc('visibilitychange');
        assert.equal(p.prep.isPrepared(), false);
    });
});

describe('a print is over when the reader is back (rule 4)', () => {
    for (const type of ['pointerdown', 'keydown']) {
        test(`a ${type} after a prepare ends it, and the net comes down`, () => {
            const p = makePage();
            p.prep.prepare();
            assert.equal(p.listening(type), 1);
            p.fire(type);
            assert.equal(p.prep.isPrepared(), false);
            assert.deepEqual(p.details.map(d => d.open), [false, false, false, true]);
            assert.equal(p.listening(type), 0, 'nothing left listening');
        });
    }
    test('a scroll ends it only once the page has moved from where the prepare left it, and only on screen', () => {
        const p = makePage();
        p.win.scrollY = 400;
        p.prep.prepare();             // the disclosures opening moved the page to here
        p.win.scrollY = 402;
        p.fire('scroll');
        assert.equal(p.prep.isPrepared(), true, 'the prepare\'s own move, within 2px, is not the reader');
        p.setPrintMedia(true);
        p.win.scrollY = 0;
        p.fire('scroll');
        assert.equal(p.prep.isPrepared(), true, 'laying the page out for paper scrolls without the reader');
        p.setPrintMedia(false);
        p.fire('scroll');
        assert.equal(p.prep.isPrepared(), false);
    });
    test('nothing listens before a prepare', () => {
        const p = makePage();
        for (const t of ['pointerdown', 'keydown', 'scroll']) assert.equal(p.listening(t), 0);
    });
});

describe('the Print button starts from the page on screen (rule 1)', () => {
    test('a print still in force from a sheet that never ended is put back, and the new one is stamped afresh', () => {
        const p = makePage();
        p.prep.prepare();                         // AirPrint: no afterprint, no visibility change, no touch yet
        p.details[3].open = false;                // …and the reader closed one meanwhile
        let printed = 0;
        p.prep.printNow(() => { printed++; assert.ok(allOpen(p.details), 'prepared before the print'); });
        assert.equal(printed, 1);
        assert.equal(p.stamps(), 2, 'the "Printed" time is this press\'s');
        p.fire('afterprint');
        assert.deepEqual(p.details.map(d => d.open), [false, false, false, false], 'the second print restores to the page as it was');
    });
});
