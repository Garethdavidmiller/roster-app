/**
 * links-seed.test.mjs — the generator's target seed (v19.92).
 * Run: node --test links-seed.test.mjs   (part of `npm run test:hygiene`)
 *
 * THIS SUITE IS THE POINT OF THE EXTRACTION. `buildRosterTargets` was already a pure function; it
 * simply was not exported, and both `.claude/rules/links-design.md` and `e2e/pages.spec.js` recorded
 * that as the reason it was covered by an e2e instead — "a unit test would be checking its own copy
 * of it". It would have been. It isn't now.
 *
 * The failure this guards is quiet by construction. The seed's visible output is a table of per-shift
 * headcounts, and at v19.59 every one of those was CORRECT while the roster was being under-sampled:
 * only the count of whole spare LINES came out wrong (4 against a true 6), and nothing on the page
 * shows that number beside what it should be. So the cases below lean on the two things nobody looks
 * at — which lines get sampled, and how spare is counted — rather than on the figures that would
 * have looked fine throughout.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRosterTargets, rosterSeedLines, EXTRA_SPARE_WEEKS } from './links-seed.js';
import { ROTATING_LINES } from './links-design.js';
import { CONFIG, weeklyRoster, bilingualRoster } from './roster-data.js';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** A line from seven day values, in DAYS order. */
const line = (...d) => Object.fromEntries(DAYS.map((k, i) => [k, d[i]]));
const RD = 'RD', SP = 'SPARE', E = '06:20-14:20', L = '15:15-23:55';

describe('which lines get sampled — the v19.59 bug, and the v19.98 change of subject', () => {
    test('the seed takes the WHOLE main cycle — not a sample of it', () => {
        // v19.59's bug was the sample being too NARROW: main's 20 weeks plus only the TWO bilingual
        // weeks the two bilingual members happen to sit on. Bilingual 1 and 8 are the spare weeks
        // and were never seen, so the spare count came back 4 against a then-true 6.
        assert.equal(rosterSeedLines().length, CONFIG.MAIN_ROSTER_WEEKS);
    });

    test('every main week is present, by identity', () => {
        // Length alone would pass on 20 lines drawn from the wrong places. These are the actual
        // objects, so a prefix, a duplicate or a substitution all fail.
        const got = rosterSeedLines();
        for (let w = 1; w <= CONFIG.MAIN_ROSTER_WEEKS; w++) {
            assert.ok(got.includes(weeklyRoster[w]), `main week ${w} is missing from the seed`);
        }
    });

    test('the BILINGUAL roster is not sampled at all — the v19.98 change', () => {
        // The mirror image of v19.59: the sample being too WIDE. The December 2026 link is 22 lines
        // of the CEA roster widened and does not take on the bilingual roster's work, so seeding
        // from it would target shift times no line in the design can legitimately work. This is the
        // SAME rule as the test above — the seed samples exactly what the design represents — and
        // both failures are silent, which is why each gets its own case rather than one length
        // assertion standing in for both.
        const got = rosterSeedLines();
        for (let w = 1; w <= CONFIG.BILINGUAL_ROSTER_WEEKS; w++) {
            assert.ok(!got.includes(bilingualRoster[w]),
                `bilingual week ${w} is being sampled into a design that excludes it`);
        }
        // And by VALUE, not just identity: a future refactor that copies the lines rather than
        // referencing them would slip past the check above while seeding the same wrong times.
        const bilingualOnly = new Set();
        for (let w = 1; w <= CONFIG.BILINGUAL_ROSTER_WEEKS; w++) {
            for (const v of Object.values(bilingualRoster[w])) {
                if (v && v !== 'RD' && v !== 'OFF' && v !== 'SPARE') bilingualOnly.add(v);
            }
        }
        for (let w = 1; w <= CONFIG.MAIN_ROSTER_WEEKS; w++) {
            for (const v of Object.values(weeklyRoster[w])) bilingualOnly.delete(v);
        }
        // Every bilingual time is bilingual-ONLY (measured Aug 2026: 10 of them, zero overlap with
        // main's 18), so this set is a genuine discriminator rather than a vacuous one.
        assert.ok(bilingualOnly.size > 0, 'the two rosters now share every time — this check is vacuous');
        for (const slot of buildRosterTargets().slots) {
            assert.ok(!bilingualOnly.has(slot.time),
                `${slot.time} is a bilingual-only shift and must not be seeded`);
        }
    });

    test('the cycle length is READ, not written down again', () => {
        // The coordinator version looped to a literal 20 while CONFIG held the same number, so a
        // roster that changed length would have left the seed reading a prefix of it — the v19.59
        // shape exactly, silently, again. A behavioural check cannot see this while the literal
        // still agrees with CONFIG, so the source is what gets asserted.
        const src = readFileSync(new URL('./links-seed.js', import.meta.url), 'utf8');
        assert.match(src, /CONFIG\.MAIN_ROSTER_WEEKS/);
        // …and no loop bound is a bare number. Comments are stripped first: this file discusses the
        // literals it must not contain, and a naive scan matches its own explanation.
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        assert.doesNotMatch(code, /<=\s*\d/, 'a numeric loop bound has come back into the seed');
    });
});

describe('what is counted from them', () => {
    test('spare is counted in whole LINES', () => {
        const sources = [
            line(SP, SP, SP, SP, SP, SP, SP),
            line(E, E, E, E, E, RD, RD),
            line(SP, SP, SP, SP, SP, SP, SP),
        ];
        // `rosterSpareLines`, not `spareLines`: this block is about what the COUNTING does with a
        // set of lines, and `spareLines` carries the seeded uplift on top of it (EXTRA_SPARE_WEEKS).
        // Asserting the seeded figure here would make every counting test depend on a decision that
        // has nothing to do with counting.
        assert.equal(buildRosterTargets(sources).rosterSpareLines, 2);
    });

    test('scattered spare days do NOT add up to a spare line, however many there are', () => {
        // THE CASE THAT SEPARATES THE TWO MODELS, and the one the first draft of this suite missed.
        // Seven lines carrying one spare day each is seven spare DAYS — which the v19.58 per-day
        // model reports as one spare line, and the correct model reports as none. CLAUDE.md records
        // why that bug survived: "the daily SP headcount came out right, which is why it went
        // unnoticed". A test whose fixtures only ever hold whole spare weeks cannot tell the two
        // apart, and mine did not until the mutation was tried (teeth-verified).
        const scattered = Array.from({ length: 7 }, (_, i) =>
            line(...DAYS.map((_d, j) => (j === i ? SP : E))));
        assert.equal(buildRosterTargets(scattered).rosterSpareLines, 0);
    });

    test('a line that is spare on only SOME days is not a spare line', () => {
        // The v19.58 model took a per-day spare headcount, which produced the right daily total from
        // the wrong model — the reason it survived review. A partly-spare line is not a spare week,
        // and it must not contribute a timed slot for its SPARE days either.
        const sources = [line(SP, SP, SP, E, E, RD, RD)];
        const { slots, rosterSpareLines } = buildRosterTargets(sources);
        assert.equal(rosterSpareLines, 0);
        assert.deepEqual(slots.map(s => s.time), [E]);
    });

    test('the weekday figure is the BUSIEST Mon–Fri day, never an average', () => {
        // Some shifts only run Tue/Thu/Fri. Averaging would under-staff the days they do run, and
        // under-staffing is the worse error — which is why the column header says "busiest day".
        const sources = [line(RD, RD, E, RD, E, E, RD)];   // Tue, Thu, Fri only
        const [slot] = buildRosterTargets(sources).slots;
        assert.equal(slot.weekday, 1);

        // Two lines on the same time on ONE weekday, one on another: the answer is 2, not 1.5.
        const busier = [
            line(RD, RD, E, RD, RD, RD, RD),
            line(RD, RD, E, RD, RD, RD, RD),
            line(RD, RD, RD, E, RD, RD, RD),
        ];
        assert.equal(buildRosterTargets(busier).slots[0].weekday, 2);
    });

    test('Saturday and Sunday are counted separately, and are not folded into the weekday figure', () => {
        // Three different commitments — Sunday is not even contracted — so one number for all seven
        // days would be a different roster from the one being seeded.
        const sources = [line(E, RD, RD, RD, RD, RD, E)];  // Sun + Sat only
        const [slot] = buildRosterTargets(sources).slots;
        assert.deepEqual([slot.weekday, slot.sat, slot.sun], [0, 1, 1]);
    });

    test('rest days never become a slot', () => {
        const { slots } = buildRosterTargets([line(RD, 'OFF', RD, RD, RD, RD, RD)]);
        assert.deepEqual(slots, []);
    });

    test('slots come back in time order, so the table is stable between runs', () => {
        const { slots } = buildRosterTargets([line(L, E, L, E, RD, RD, RD)]);
        assert.deepEqual(slots.map(s => s.time), [E, L]);
    });

    test('an empty or absent line is skipped rather than throwing', () => {
        // rosterSeedLines() indexes the roster maps directly, so a gap arrives here as undefined.
        assert.deepEqual(buildRosterTargets([undefined, line(E, RD, RD, RD, RD, RD, RD)]).slots.length, 1);
    });
});

describe('the live roster — the figures the workspace actually seeds from', () => {
    test('18 slots; the roster provides 4 spare weeks and the seed targets 5', () => {
        // 4 is main lines 1/7/12/17 — MEASURED. It was 6 while the bilingual roster was in scope
        // (its 1 and 8), and 4 for the WRONG reason before v19.59, when the under-sample happened to
        // drop exactly those two bilingual spare weeks. The figure has therefore read 4 twice meaning
        // different things, which is precisely why the identity checks above exist rather than this
        // number alone.
        //
        // 5 is what the generator is SEEDED with: the measured 4 plus the cover week the widened link
        // adds (EXTRA_SPARE_WEEKS, an owner decision at v20.01). Both are asserted, and separately —
        // if they were one number a reader could not tell which half was observed and which chosen.
        const { slots, spareLines, rosterSpareLines } = buildRosterTargets();
        assert.equal(rosterSpareLines, 4, 'the roster itself has four spare weeks');
        assert.equal(spareLines, rosterSpareLines + EXTRA_SPARE_WEEKS);
        assert.equal(slots.length, 18);
    });

    test('the extra spare week is ADDED, never baked into the measurement', () => {
        // The whole point of keeping it a separate constant: with the uplift off, this still answers
        // "what does this roster provide?" — the question the v19.59 bug got wrong. A future edit
        // that folded the uplift into the counting loop would pass every other test in this file.
        const { spareLines, rosterSpareLines } = buildRosterTargets(undefined, { extraSpareLines: 0 });
        assert.equal(spareLines, rosterSpareLines);
        assert.equal(spareLines, 4);
    });

    test('the added spare week comes out of the WORKING lines, and the seed still fits', () => {
        // An extra spare line does not create capacity, it removes a line from the pool that carries
        // the duties — so it must still leave room for the work. Measured at 24 lines: 19 working
        // against 78 timed duties a week, i.e. 2.89 rest days per working line (3.10 without it).
        // Asserted as a relationship rather than as those numbers, so it survives the next length
        // change; the figures are recorded in LINKS_DEC2026_PLAN.md, which is where they belong.
        const { slots, spareLines } = buildRosterTargets();
        const working = ROTATING_LINES - spareLines;
        assert.ok(working > 0, 'the spare weeks have eaten the whole rotation');
        for (const dayClass of ['weekday', 'sat', 'sun']) {
            const total = slots.reduce((n, s) => n + s[dayClass], 0);
            assert.ok(total <= working,
                `${dayClass} seeds ${total} duties into ${working} working lines — the generator ` +
                'validates against exactly this and would refuse its own seed');
        }
    });

    test('every seeded slot is a real time, and the totals fit the design', () => {
        const { slots, spareLines } = buildRosterTargets();
        for (const s of slots) {
            assert.match(s.time, /^\d{2}:\d{2}-\d{2}:\d{2}$/, `not a padded time: ${s.time}`);
        }
        // The generator validates targets against the WORKING lines (lines − spareLines), so a seed
        // that could not fit its own design would refuse on first use. This is the one test that
        // ties the seed to ROTATING_LINES: a rotation shrunk below what the roster already provides
        // would make the workspace's default targets unusable on arrival.
        const working = ROTATING_LINES - spareLines;
        for (const dayClass of ['weekday', 'sat', 'sun']) {
            const total = slots.reduce((n, s) => n + s[dayClass], 0);
            assert.ok(total <= working,
                `${dayClass} seeds ${total} duties into ${working} working lines`);
        }
    });
});
