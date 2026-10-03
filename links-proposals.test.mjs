// links-proposals.test.mjs — the built-in shortlist (v24.47).
//
// Three things are pinned, and each fails for its own reason. The designs must be what the
// owner shortlisted — 26 lines, five cover weeks, the contract paid, inside every hard limit — because
// they are what every other design on the page is measured against. They must be FAITHFUL copies of
// the grids in docs/links-26/proposals, once those files are in the checkout, so the screen and the
// printed sheet agree. And no proposal may ever look like something Firestore could hold.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PROPOSALS, PROPOSAL_PREFIX, isProposalId, proposalById, proposalCopyName } from './links-proposals.js';
import { ROTATING_LINES, DAYS, normalisePatterns, weeklyHours, CONTRACTED_HOURS_PER_WEEK } from './links-design.js';
import { assessHardLimits, contractedDaysPerYear } from './links-limits.js';

const SOURCES = { 'SE-26-F1': 'Second-Edition-SE-26-F1', 'EK-26-H1': 'Even-Keel-EK-26-H1', 'SR-26-F1': 'Short-Run-SR-26-F1' };

describe('the shortlist as the owner chose it (3 Oct 2026)', () => {
    test('three designs: Second Edition, Even Keel, Short Run — in that order', () => {
        assert.deepEqual(PROPOSALS.map(p => p.code), ['SE-26-F1', 'EK-26-H1', 'SR-26-F1']);
        assert.deepEqual(PROPOSALS.map(p => p.name.split(' — ')[0]), ['Second Edition', 'Even Keel', 'Short Run']);
    });

    for (const p of PROPOSALS) {
        describe(p.name, () => {
            test('every line of the link, every day, and nothing else', () => {
                assert.deepEqual(Object.keys(p.patterns), Array.from({ length: ROTATING_LINES }, (_, i) => String(i + 1)));
                for (const row of Object.values(p.patterns)) assert.deepEqual(Object.keys(row).sort(), [...DAYS].sort());
            });

            test('stored canonically — what the page would load is exactly what is written here', () => {
                assert.deepEqual(normalisePatterns(p.patterns), p.patterns);
            });

            test('five whole cover weeks', () => {
                const cover = Object.values(p.patterns).filter(r => DAYS.every(d => r[d] === 'SPARE')).length;
                assert.equal(cover, 5);
            });

            test('pays the contracted week exactly, inside every hard limit', () => {
                assert.equal(weeklyHours(p.patterns, ROTATING_LINES).exSunday, CONTRACTED_HOURS_PER_WEEK);
                const h = assessHardLimits(p.patterns);
                assert.equal(h.assessable, true);
                assert.equal(h.breaches, 0, JSON.stringify(h.checks));
                assert.equal(contractedDaysPerYear(p.patterns, ROTATING_LINES).toFixed(1), '218.6');
            });

            test('a faithful copy of its docs/links-26 grid, whenever that file is in the checkout', (t) => {
                const file = new URL(`./docs/links-26/proposals/${SOURCES[/** @type {'SE-26-F1'} */ (p.code)]}.json`, import.meta.url);
                if (!existsSync(file)) { t.skip('source grid not in this checkout yet'); return; }
                const src = JSON.parse(readFileSync(file, 'utf8'));
                assert.equal(src.name, `${p.name} (${p.ref})`, 'the printed name — title and ref, as on the sheet');
                assert.deepEqual(normalisePatterns(src.patterns), p.patterns, 'the grid');
            });
        });
    }
});

describe('a proposal can never be mistaken for a saved design', () => {
    test('every id carries the prefix, and a Firestore auto-id never does', () => {
        for (const p of PROPOSALS) { assert.ok(p.id.startsWith(PROPOSAL_PREFIX)); assert.equal(isProposalId(p.id), true); }
        for (const id of ['aB3dE5fG7hJ9kL1mN2pQ', '', null, undefined, 42]) assert.equal(isProposalId(id), false);
        assert.equal(proposalById(PROPOSALS[1].id), PROPOSALS[1]);
        assert.equal(proposalById('nope'), null);
    });

    test('the data is frozen — a working copy can only ever be a copy', () => {
        assert.ok(Object.isFrozen(PROPOSALS));
        for (const p of PROPOSALS) assert.ok(Object.isFrozen(p));
    });

    test('the first save suggests "<Name> — copy", without the sheet\'s fingerprint, numbered if taken', () => {
        const se = PROPOSALS[0];
        assert.equal(proposalCopyName(se, []), 'Second Edition — copy');
        assert.equal(proposalCopyName(se, [{ name: 'second edition — COPY' }]), 'Second Edition — copy 2');
        assert.doesNotMatch(proposalCopyName(se, []), /SE-26|·/);
    });
});
