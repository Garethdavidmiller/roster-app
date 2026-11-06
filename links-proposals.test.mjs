// links-proposals.test.mjs — the built-in shortlist (v24.47).
//
// Three things are pinned, and each fails for its own reason. The designs must be what the
// owner shortlisted — 26 lines, five cover weeks, the contract paid, inside every hard limit — because
// they are what every other design on the page is measured against. They must be FAITHFUL copies of
// the grids in docs/links-26/proposals, so the screen and the printed sheet agree. And no proposal may
// ever look like something Firestore could hold.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PROPOSALS, PROPOSAL_PREFIX, isProposalId, proposalById, proposalCopyName } from './links-proposals.js';
import { ROTATING_LINES, DAYS, normalisePatterns, weeklyHours, CONTRACTED_HOURS_PER_WEEK } from './links-design.js';
import { assessHardLimits, contractedDaysPerYear } from './links-limits.js';

// each source grid's path under docs/links-26/ — a 30-day link's is in its own folder (Common Ground's, since 5 Nov 2026)
const SOURCES = { 'ES-26-T5': 'proposals/Even-Step-ES-26-T5', 'CG-26-T8': '30-days-off/Common-Ground-CG-26-T8', 'SR-26-F1': 'proposals/Short-Run-SR-26-F1' };

describe('the shortlist as the owner chose it (these three since 5 Nov 2026)', () => {
    test('three designs, A to Z: Common Ground, Even Step and Short Run', () => {
        assert.deepEqual(PROPOSALS.map(p => p.code), ['CG-26-T8', 'ES-26-T5', 'SR-26-F1']);
        assert.deepEqual(PROPOSALS.map(p => p.name.split(' — ')[0]), ['Common Ground', 'Even Step', 'Short Run']);
    });

    test('none is recommended: the pack exports no recommendation, and the list is A to Z', () => {
        // Until 5 Nov 2026 fresh.mjs's RECOMMENDED put Even Step first here, on the shortlist sheet and in the pack's
        // twenty-minute read. The owner removed it ("Remove the marks"): the three are presented evenly, as the New
        // link page always showed them. A RECOMMENDED that came back would put a favourite back on paper unseen.
        const src = readFileSync(new URL('./docs/links-26/tooling/fresh.mjs', import.meta.url), 'utf8');
        assert.doesNotMatch(src, /export const RECOMMENDED\b/);
        const names = PROPOSALS.map(p => p.name.split(' — ')[0]);
        assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'en-GB')));
    });

    test('the same shortlist, in the same order, as the pack the owner hands round', () => {
        // The app and docs/links-26 are two copies of one decision, and the shortlist has changed five times in five
        // weeks (three designs, then four, then two, then three, then a different three on 5 Nov 2026). fresh.mjs's SHORTLIST drives the printed sheet, the summary
        // and the presentations, so the designs built in here must be exactly those — read from its source text,
        // as the deck builders do, rather than imported (it is tooling, not an app module).
        const src = readFileSync(new URL('./docs/links-26/tooling/fresh.mjs', import.meta.url), 'utf8');
        const m = src.match(/export const SHORTLIST = \[([^\]]*)\]/);
        assert.ok(m, 'fresh.mjs no longer declares SHORTLIST on one line');
        assert.deepEqual([...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]), PROPOSALS.map(p => p.name.split(' — ')[0]));
    });

    test('every shortlisted design has a source grid named here, and the file is there', () => {
        // The faithful-copy test below used to SKIP when its grid was absent — right for the one PR this test landed
        // ahead of the grids (3 Oct 2026), and since then a way to pass while checking nothing: a design added without a
        // SOURCES entry, or a SOURCES name that matches no file, skipped. The grids are tracked, so both now fail here.
        assert.deepEqual(Object.keys(SOURCES).sort(), PROPOSALS.map(p => p.code).sort());
        for (const f of Object.values(SOURCES)) assert.ok(existsSync(new URL(`./docs/links-26/${f}.json`, import.meta.url)), `no source grid: ${f}.json`);
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

            test('a faithful copy of its docs/links-26 grid', () => {
                const file = new URL(`./docs/links-26/${SOURCES[/** @type {keyof typeof SOURCES} */ (p.code)]}.json`, import.meta.url);
                const src = JSON.parse(readFileSync(file, 'utf8'));
                assert.equal(src.name, `${p.name} (${p.ref})`, 'the printed name — title and ref, as on the sheet');
                assert.deepEqual(normalisePatterns(src.patterns), p.patterns, 'the grid');
            });

            // THE REF'S FINGERPRINT IS THESE CELLS' OWN (6 Nov 2026, the 72-hour review). The test above holds the grid and
            // the ref to the pack's copy, so a grid edited in BOTH places with the ref left alone passed it, labelled with the
            // fingerprint of a rota it no longer is. Recomputed exactly as regenerate.mjs and every printed sheet compute it:
            // sha256 of the lines in order, each line's days in links-design.js's order, the first eight hex characters.
            test('its ref names the fingerprint of these cells, recomputed', () => {
                const fp = createHash('sha256')
                    .update(JSON.stringify(Object.keys(p.patterns).sort((a, b) => Number(a) - Number(b)).map(k => DAYS.map(d => p.patterns[k][d]))))
                    .digest('hex').slice(0, 8);
                assert.equal(p.ref, `${p.code} · ${fp}`);
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
        const es = PROPOSALS.find(p => p.code === 'ES-26-T5');
        assert.equal(proposalCopyName(es, []), 'Even Step — copy');
        assert.equal(proposalCopyName(es, [{ name: 'even step — COPY' }]), 'Even Step — copy 2');
        assert.doesNotMatch(proposalCopyName(es, []), /ES-26|·/);
    });
});
