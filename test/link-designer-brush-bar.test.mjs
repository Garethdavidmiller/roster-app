// @ts-check
// @lane hygiene
/**
 * link-designer-brush-bar.test.mjs — which times the Link Designer paint bar offers (link-designer-brush-bar.js).
 * Run: node scripts/run-tests.mjs test/link-designer-brush-bar.test.mjs   (part of `npm run test:hygiene`)
 *
 * The bar itself — arming, the Custom… chip, focus — is driven end to end in e2e/link-designer.spec.js
 * ("every paint chip is a shift the design actually contains"). What is pinned here is the rule the
 * chips are drawn from: the design's OWN times, never a fixed list, with the armed brush unioned in.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { brushTimes, brushSig } from '../link-designer-brush-bar.js';
import { classifyShift } from '../link-designer-design.js';
import { DEFAULT_SHIFT_TIMES } from '../link-designer-default-targets.js';

/** A design of `lines`, each line a `{ day: shift }` map. @param {Array<Record<string, string>>} lines */
const patternsOf = (lines) => Object.fromEntries(lines.map((l, i) => [String(i + 1), l]));

describe('the chips are the times this design is made of (rule 1)', () => {
    test('only the times the design holds, early and late apart, each in time order', () => {
        const p = patternsOf([
            { mon: '14:30-22:30', tue: '06:20-14:20', wed: 'RD' },
            { mon: '07:15-15:15', tue: '14:30-22:30', sat: 'SPARE', sun: 'OFF' },
        ]);
        const { early, late } = brushTimes(p, null);
        assert.deepEqual(early, ['06:20-14:20', '07:15-15:15']);
        assert.deepEqual(late, ['14:30-22:30']);
        for (const s of early) assert.notEqual(classifyShift(s), 'late');
        for (const s of late) assert.equal(classifyShift(s), 'late');
    });

    test('rest, OFF and spare are not times', () => {
        const { early, late } = brushTimes(patternsOf([{ mon: 'RD', tue: 'OFF', wed: 'SPARE', thu: '06:20-14:20' }]), null);
        assert.deepEqual([...early, ...late], ['06:20-14:20']);
    });

    test('a night or a past-midnight duty is never offered', () => {
        const { early, late } = brushTimes(patternsOf([{ mon: '22:00-06:00', tue: '15:00-00:30', wed: '06:20-14:20' }]), null);
        assert.deepEqual([...early, ...late], ['06:20-14:20']);
    });

    test('a design with no time falls back to the default table, and so does no design at all', () => {
        const all = (/** @type {any} */ t) => [...t.early, ...t.late].sort();
        assert.deepEqual(all(brushTimes(patternsOf([{ mon: 'RD' }]), null)), [...DEFAULT_SHIFT_TIMES].sort());
        assert.deepEqual(all(brushTimes(null, null)), [...DEFAULT_SHIFT_TIMES].sort());
    });
});

describe('the armed brush is unioned in (rule 2)', () => {
    test('an armed time the design does not hold stays on the bar', () => {
        const { early } = brushTimes(patternsOf([{ mon: '06:20-14:20' }]), '05:45-13:45');
        assert.deepEqual(early, ['05:45-13:45', '06:20-14:20']);
    });

    test('an armed rest or spare adds no chip — they have their own', () => {
        const p = patternsOf([{ mon: '06:20-14:20' }]);
        assert.deepEqual(brushTimes(p, 'RD'), brushTimes(p, null));
        assert.deepEqual(brushTimes(p, 'SPARE'), brushTimes(p, null));
    });
});

describe('the signature (rule 3)', () => {
    test('two readings that show the same bar have the same signature, and a new time changes it', () => {
        const p = patternsOf([{ mon: '06:20-14:20', tue: '14:30-22:30' }]);
        const before = brushSig(brushTimes(p, null));
        assert.equal(before, '06:20-14:20|14:30-22:30');
        p['1'].wed = '06:20-14:20';   // a paint that adds no new time
        assert.equal(brushSig(brushTimes(p, null)), before, 'a drag over known times must not redraw the bar');
        p['1'].thu = '07:15-15:15';
        assert.notEqual(brushSig(brushTimes(p, null)), before);
    });
});
