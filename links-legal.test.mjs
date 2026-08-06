/**
 * links-legal.test.mjs — the HARD limits (v19.80).
 * Run: node --test links-legal.test.mjs   (part of `npm run test:hygiene`)
 *
 * WHY THE WEIGHTING HERE IS DIFFERENT FROM links-fatigue.test.mjs. That suite guards a panel that
 * reports advisory factors and never passes or fails a design, so its dangerous failure is a design
 * showing nothing and being read as approved. This one guards a check that DOES pass or fail, against
 * a legal ceiling — so its dangerous failure is narrower and sharper: **saying `ok` when the answer
 * is not known, or when the design permits a breach it does not always produce.**
 *
 * Every case below is pointed at one of those two.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assessLegalLimits, MAX_CONSECUTIVE_WORKED_DAYS } from './links-legal.js';
import { assessFatigue } from './links-fatigue.js';
import { weeklyRoster, bilingualRoster } from './roster-cycle-data.js';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const W = '06:20-14:20';
const R = 'RD';
const S = 'SPARE';
const design = (...weeks) => {
    const p = {};
    weeks.forEach((w, i) => { p[String(i + 1)] = Object.fromEntries(DAYS.map((d, j) => [d, w[j]])); });
    return p;
};
const wk = (...d) => d;
const only = (patterns, lines) => assessLegalLimits(patterns, lines).checks[0];

describe('the 13-consecutive-day company limit', () => {
    test('the limit is 13 and the row quotes the constant, not a literal', () => {
        assert.equal(MAX_CONSECUTIVE_WORKED_DAYS, 13);
        const c = only(design(wk(W, W, W, W, W, R, R)), 1);
        assert.equal(c.limit, 13);
        assert.match(c.title, /13/);
    });

    test('13 is within the limit and 14 breaches it — the boundary, both sides', () => {
        // 13 worked then a rest: exactly at the ceiling.
        const at13 = design(
            wk(W, W, W, W, W, W, W),
            wk(W, W, W, W, W, W, R),
        );
        assert.equal(only(at13, 2).status, 'ok');
        assert.equal(only(at13, 2).value, 13);

        // One more day and it cannot be run.
        const at14 = design(
            wk(W, W, W, W, W, W, W),
            wk(W, W, W, W, W, W, W),
            wk(R, R, R, R, R, R, R),
        );
        assert.equal(only(at14, 3).status, 'breach');
        assert.equal(only(at14, 3).value, 14);
    });

    test('an EMPTY design is `unknown`, never `ok`', () => {
        // The single most dangerous sentence this module could produce is "no breach found" about a
        // design with nothing in it. `toSequence` fills a missing line with RD, so an empty design
        // yields a full-length run of rest days and a longest run of 0 — which reads as a
        // comfortable pass unless this is handled explicitly.
        const a = assessLegalLimits({}, 28);
        assert.equal(a.checks[0].status, 'unknown');
        assert.equal(a.checks[0].value, null);
        assert.equal(a.assessable, false);
        assert.equal(a.breaches, 0);
    });

    test('an all-rest design is `unknown` too — it is not a compliant design, it is no design', () => {
        assert.equal(only(design(wk(R, R, R, R, R, R, R), wk(R, R, R, R, R, R, R)), 2).status, 'unknown');
    });

    test('a part-built design with real duties IS assessed', () => {
        // The unknown guard must not swallow a design that is merely incomplete — otherwise the
        // check goes quiet for the whole time somebody is building, which is when they need it.
        const a = assessLegalLimits(design(wk(R, W, W, W, W, W, R)), 28);
        assert.equal(a.assessable, true);
        assert.equal(a.checks[0].status, 'ok');
    });
});

describe('the answer is the worst case, which is what makes it a legal check', () => {
    test('a spare week is counted at four duties, not seven', () => {
        // 7 worked + a spare week. At 7/7 the spare week bridges and the answer would be 14 (breach);
        // four duties cannot fill a week, so the real ceiling is 7 + 4 = 11.
        const c = only(design(wk(W, W, W, W, W, W, W), wk(S, S, S, S, S, S, S), wk(R, R, R, R, R, R, R)), 3);
        assert.equal(c.value, 11);
        assert.equal(c.status, 'ok');
    });

    test('a design that only SOMETIMES reaches 14 still breaches — the link permits it', () => {
        // 10 worked days running into a spare week. Most placements of that week's four duties keep
        // the run under 13; the placement that puts all four at the start of the week gives 14. The
        // roster clerk chooses week by week, so the link allows a breach and must say so.
        const c = only(design(
            wk(R, R, R, R, W, W, W),
            wk(W, W, W, W, W, W, W),
            wk(S, S, S, S, S, S, S),
            wk(R, R, R, R, R, R, R),
        ), 4);
        assert.equal(c.value, 14);
        assert.equal(c.status, 'breach');
    });

    test('the detail says it is a worst case WHENEVER a spare week could move it', () => {
        const withSpare = only(design(wk(W, W, W, R, R, S, S)), 1);
        assert.match(withSpare.detail, /worst case/i);
        // …and does not claim a caveat that does not apply.
        const without = only(design(wk(W, W, W, R, R, R, R)), 1);
        assert.doesNotMatch(without.detail, /worst case/i);
    });
});

describe('the live rosters', () => {
    test('both are within the company limit, and the figures are the corrected ones', () => {
        // These read 15 and 14 before v19.79, when a spare week counted as seven worked days — i.e.
        // the tool reported a legal breach on the roster people are actually working. Pinned here so
        // that cannot come back silently.
        assert.deepEqual(
            [only(weeklyRoster, 20).value, only(bilingualRoster, 8).value],
            [9, 8],
        );
        assert.equal(only(weeklyRoster, 20).status, 'ok');
        assert.equal(only(bilingualRoster, 8).status, 'ok');
    });
});

describe('the separation from the advisory ORR factors', () => {
    test('a legal check is NOT one of assessFatigue\'s results', () => {
        // The whole reason this lives in its own module. If a legal limit ever appears in the
        // fatigue results array it will be tallied into "N present · N standing", wear the amber
        // edge, and collapse into the quiet-rows disclosure when it passes — none of which would
        // look wrong on screen.
        const fat = assessFatigue(weeklyRoster, 20);
        for (const r of fat.results) {
            assert.notEqual(r.id, 'consecutive-days');
            assert.doesNotMatch(String(r.family || ''), /legal/i);
        }
    });

    test('a legal status is never one of the fatigue vocabulary words', () => {
        // `present` / `standing` / `clear` / `n/a` are advisory words — a hard limit must not borrow
        // them, or a future render could pick up the fatigue module's icon and colour maps by name
        // and quietly turn a breach amber.
        const statuses = new Set(['ok', 'breach', 'unknown']);
        for (const patterns of [weeklyRoster, bilingualRoster, {}]) {
            for (const c of assessLegalLimits(patterns, 20).checks) assert.ok(statuses.has(c.status));
        }
    });
});

// ── THE CLAIM, NOT JUST THE NUMBER (v19.85, external review P1) ─────────────────────────────────
// Until v19.85 this module called 13 "the UK railway legal maximum" and printed "cannot be run" in
// red on a sheet going to an assessing manager, sourced only to "owner, Aug 2026". An external
// review could not substantiate that, and the ORR's own framing is different again: it treats more
// than 13 shifts WITHOUT A 48h BREAK as fatigue factor FF11 — a different measurement, which
// links-fatigue.js does separately — and says its guidelines are not prescriptive limits.
//
// The number was already pinned. Pinning a number does not pin the CLAIM around it, which is why
// the whole comprehensive suite went on asserting an unsupported premise without a murmur. These
// assert the classification, so the wording cannot drift back to law.
describe('the basis is a COMPANY limit and never a legal claim', () => {
    const everyString = (/** @type {any} */ r) => [r.title, r.basis, r.detail].join(' ');

    test('the basis names Chiltern, not legislation', () => {
        const c = assessLegalLimits(design(wk(W, W, W, W, W, R, R)), 1).checks[0];
        assert.match(c.basis, /Chiltern/i);
        assert.doesNotMatch(c.basis, /legal|statut|law|UK railway/i);
    });

    test('no row anywhere claims to be law — in ANY state', () => {
        // Breach, pass and unknown each build their own strings, so each is checked. A wording
        // change that only ever fires on a breach would otherwise slip through untested.
        for (const patterns of [design(wk(W, W, W, W, W, R, R)), {}, design(wk(R, R, R, R, R, R, R))]) {
            for (const c of assessLegalLimits(patterns, 1).checks) {
                assert.doesNotMatch(everyString(c), /\blegal\b|\blaw\b|statut|legislation/i,
                    `a "${c.status}" row must not present itself as law: ${everyString(c)}`);
            }
        }
    });

    test('and it is still a HARD limit — the reclassification must not soften the verdict', () => {
        // The point of the change is the SOURCE, not the strength. A breach must still be a breach.
        const long = {};
        for (let i = 1; i <= 3; i++) long[String(i)] = Object.fromEntries(DAYS.map(d => [d, W]));
        const r = assessLegalLimits(long, 3);
        assert.equal(r.checks[0].status, 'breach');
        assert.equal(r.breaches, 1);
    });
});
