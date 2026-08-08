/**
 * links-limits.test.mjs — the HARD limits (v19.80).
 * Run: node --test links-limits.test.mjs   (part of `npm run test:hygiene`)
 *
 * WHY THE WEIGHTING HERE IS DIFFERENT FROM links-fatigue.test.mjs. That suite guards a panel that
 * reports advisory factors and never passes or fails a design, so its dangerous failure is a design
 * showing nothing and being read as approved. This one guards a check that DOES pass or fail, against
 * a hard ceiling — so its dangerous failure is narrower and sharper: **saying `ok` when the answer
 * is not known, or when the design permits a breach it does not always produce.**
 *
 * Every case below is pointed at one of those two.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assessHardLimits, MAX_CONSECUTIVE_WORKED_DAYS, POLICY_SOURCE_CONFIRMED } from './links-limits.js';
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
const only = (patterns, lines) => assessHardLimits(patterns, lines).checks[0];

describe('the 13-consecutive-day limit', () => {
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
        const a = assessHardLimits({}, 28);
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
        const a = assessHardLimits(design(wk(R, W, W, W, W, W, R)), 28);
        assert.equal(a.assessable, true);
        assert.equal(a.checks[0].status, 'ok');
    });
});

describe('the answer is the worst case, which is what makes it a hard-limit check', () => {
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
    test('both are within the 13-day limit, and the figures are the corrected ones', () => {
        // These read 15 and 14 before v19.79, when a spare week counted as seven worked days — i.e.
        // the tool reported a breach on the roster people are actually working. Pinned here so
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
    test('a hard-limit check is NOT one of assessFatigue\'s results', () => {
        // The whole reason this lives in its own module. If a hard limit ever appears in the
        // fatigue results array it will be tallied into "N present · N standing", wear the amber
        // edge, and collapse into the quiet-rows disclosure when it passes — none of which would
        // look wrong on screen.
        const fat = assessFatigue(weeklyRoster, 20);
        for (const r of fat.results) {
            assert.notEqual(r.id, 'consecutive-days');
            assert.doesNotMatch(String(r.family || ''), /legal/i);
        }
    });

    test('a hard-limit status is never one of the fatigue vocabulary words', () => {
        // `present` / `standing` / `clear` / `n/a` are advisory words — a hard limit must not borrow
        // them, or a future render could pick up the fatigue module's icon and colour maps by name
        // and quietly turn a breach amber.
        const statuses = new Set(['ok', 'breach', 'unknown']);
        for (const patterns of [weeklyRoster, bilingualRoster, {}]) {
            for (const c of assessHardLimits(patterns, 20).checks) assert.ok(statuses.has(c.status));
        }
    });
});

// ── THE CLAIM, NOT JUST THE NUMBER (v19.85, external review P1; re-sourced v19.90) ──────────────
// This module has carried three different attributions for the same 13, and that is why the claim
// is pinned as hard as the number. It first called it "the UK railway legal maximum" and printed
// "cannot be run" in red on a sheet going to an assessing manager, sourced only to "owner,
// Aug 2026"; an external review could not substantiate that, so v19.85 reclassified it as a
// Chiltern company limit. True and safe, but it understated the provenance. The owner then supplied
// the real source: the **Hidden report** into the Clapham Junction crash of 1988, whose
// working-hours recommendations the industry adopted.
//
// So there are now TWO things to hold at once, and each has failed once: the row must name a source
// that can actually be checked, AND it must not present that source as legislation — Hidden is an
// inquiry report, not statute. The ORR's framing is different again (more than 13 shifts without a
// 48h BREAK, as advisory factor FF11 — a different measurement, done separately in
// links-fatigue.js), so the two must not be conflated either.
//
// The number was already pinned before any of this. Pinning a number does not pin the CLAIM around
// it, which is why the whole comprehensive suite went on asserting an unsupported premise without a
// murmur.
describe('the basis names the Hidden report and never claims to be law', () => {
    const everyString = (/** @type {any} */ r) => [r.title, r.basis, r.detail].join(' ');

    test('the basis cites Hidden, not a house rule and not legislation', () => {
        const c = assessHardLimits(design(wk(W, W, W, W, W, R, R)), 1).checks[0];
        assert.match(c.basis, /Hidden/i);
        assert.doesNotMatch(c.basis, /legal|statut|law|UK railway/i);
    });

    test('every assessable row quotes the source in its prose too, not only in `basis`', () => {
        // `basis` renders as a small note beside the title; the detail is the sentence a reader
        // actually reads on the printed sheet. A pass and a breach build separate strings, so a
        // re-sourcing that updated only one of them would leave the other quoting the old
        // attribution — which is exactly how "Chiltern company limit" ended up in three files.
        for (const patterns of [design(wk(W, W, W, W, W, R, R)),
                                design(wk(W, W, W, W, W, W, W), wk(W, W, W, W, W, W, W))]) {
            const c = assessHardLimits(patterns, 2).checks[0];
            assert.match(c.detail, /Hidden/i, `a "${c.status}" row must name its source: ${c.detail}`);
        }
    });

    test('no row anywhere claims to be law — in ANY state', () => {
        // Breach, pass and unknown each build their own strings, so each is checked. A wording
        // change that only ever fires on a breach would otherwise slip through untested.
        for (const patterns of [design(wk(W, W, W, W, W, R, R)), {}, design(wk(R, R, R, R, R, R, R))]) {
            for (const c of assessHardLimits(patterns, 1).checks) {
                assert.doesNotMatch(everyString(c), /\blegal\b|\blaw\b|statut|legislation/i,
                    `a "${c.status}" row must not present itself as law: ${everyString(c)}`);
            }
        }
    });

    test('and it is still a HARD limit — the reclassification must not soften the verdict', () => {
        // The point of the change is the SOURCE, not the strength. A breach must still be a breach.
        const long = {};
        for (let i = 1; i <= 3; i++) long[String(i)] = Object.fromEntries(DAYS.map(d => [d, W]));
        const r = assessHardLimits(long, 3);
        assert.equal(r.checks[0].status, 'breach');
        assert.equal(r.breaches, 1);
    });
});

// ── SOURCE EVIDENCE, FOR EVERY LIMIT — NOT JUST THE ONE THAT EXISTS TODAY ───────────────────────
// External review, v19.89 P2: a value this app prints in red as something a design "cannot" exceed,
// on a sheet that goes to an assessing manager, has to say where it came from. At the time that was
// written the answer was "owner, Aug 2026" — an attribution to a person, which is not a source: it
// cannot be looked up, it carries no date, and nobody reading the sheet can check it.
//
// The block above pins the ONE limit that exists. This one pins the RULE, so the next limit added
// here cannot arrive without evidence. That distinction is the whole lesson of this module's three
// attributions: each was fixed by editing the strings, and each time every test still passed,
// because the tests described the limit rather than the standard it had to meet.
//
// Deliberately NOT asserting the word "Hidden" — a second limit may legitimately come from a
// different document. What it may never do is cite a person, a placeholder, or nothing at all.
describe('every hard limit carries checkable evidence, whatever it is', () => {
    const EVERY_STATE = [
        design(wk(W, W, W, W, W, R, R)),                              // ok
        design(wk(W, W, W, W, W, W, W), wk(W, W, W, W, W, W, W)),     // breach
        {},                                                           // unknown
        design(wk(R, R, R, R, R, R, R)),                              // unknown (all rest)
        design(wk(W, W, W, R, R, S, S)),                              // spare weeks in play
    ];
    const everyCheck = function* () {
        for (const patterns of EVERY_STATE) {
            for (const c of assessHardLimits(patterns, 2).checks) yield c;
        }
    };

    test('a basis is present, in every state, on every check', () => {
        let seen = 0;
        for (const c of everyCheck()) {
            assert.equal(typeof c.basis, 'string', `${c.id}: basis must be a string`);
            assert.ok(c.basis.trim().length >= 10,
                `${c.id} ("${c.status}"): basis "${c.basis}" is too short to identify a source`);
            seen++;
        }
        // Guard the guard: if a refactor ever returns no checks, the loop above passes vacuously.
        assert.ok(seen >= EVERY_STATE.length, `expected at least one check per state, saw ${seen}`);
    });

    test('a basis names a SOURCE, never a person and never a placeholder', () => {
        // "owner, Aug 2026" is the exact string this test exists to reject, so it is listed first.
        const NOT_A_SOURCE = /\bowner\b|\bgareth\b|\bG\. ?Miller\b|\bme\b|\bTBC\b|\bTODO\b|\bunknown\b|\bassumed\b/i;
        for (const c of everyCheck()) {
            assert.doesNotMatch(c.basis, NOT_A_SOURCE,
                `${c.id}: "${c.basis}" attributes the limit to a person or a placeholder, not to a source`);
        }
    });

    test('a basis carries a DATE or a document name — something that can be looked up', () => {
        // A year is the cheapest thing that makes a citation checkable, and every standard this app
        // could quote has one. Accepts either a 4-digit year or an explicit "report"/"standard"/
        // "agreement"/"guideline" noun, so a future limit citing an undated house standard by name
        // still passes — but a bare adjective like "industry limit" does not.
        for (const c of everyCheck()) {
            assert.match(c.basis, /\b(19|20)\d{2}\b|\breport\b|\bstandard\b|\bagreement\b|\bguideline/i,
                `${c.id}: "${c.basis}" names nothing a reader could go and check`);
        }
    });

    test('the limit itself is a number, and the row states it', () => {
        // A limit rendered without its threshold is an assertion, not a check.
        for (const c of everyCheck()) {
            assert.equal(typeof c.limit, 'number', `${c.id}: limit must be numeric`);
            assert.match(c.title, new RegExp(String(c.limit)),
                `${c.id}: the title must quote the limit it was measured against`);
        }
    });

    // ── AND THE SOURCE MUST BE CITED IN THE RIGHT TENSE (v19.96, external review P1) ────────────
    // The two rules below are what the v19.90 attribution broke, and neither of the ones above
    // could see it: the basis named a real, dated, checkable document — the Hidden report — and
    // passed every assertion in this block. What it got wrong was the TENSE. It presented a
    // standard withdrawn in 2007 as the current industry limit, under a heading reading
    // "Industry limits · Hidden report — must be met".
    //
    // That is worse than a vague citation, because it fails in the one place it is meant to work:
    // an assessing manager who takes the invitation to go and check finds a nineteen-year-old
    // withdrawn standard, and is then entitled to discount every other number on the sheet.

    test('a row that says "must be met" names WHOSE limit it is', () => {
        // A hard limit is somebody's rule. "13 is the limit" prompts "says who?"; "Chiltern's
        // roster policy sets 13" can be actioned — the manager knows which document to ask for.
        // Accepts any duty holder or instrument, not Chiltern specifically: a limit that genuinely
        // came from a live national standard would name that instead.
        for (const c of everyCheck()) {
            assert.match(c.basis, /chiltern|company|policy|agreement|regulation/i,
                `${c.id}: "${c.basis}" states a limit without saying whose it is`);
        }
    });

    test('a WITHDRAWN standard is never cited as if it were current', () => {
        // The Hidden working-hours limits were carried by a group standard withdrawn in 2007; the
        // ORR now expects a risk-based fatigue management system, and RAIB describes them as
        // historic and superseded. Citing Hidden is right — it is where the number came from and it
        // is what Chiltern's policy is derived from — but it has to be marked as an ORIGIN.
        //
        // Keyed on the citation rather than on a blocklist of present-tense phrasings: any row
        // naming Hidden must also carry a word placing it in the past, in every string a reader
        // sees. That fails on "the Hidden limit of 13" (v19.90's wording) and passes on "the
        // historic Hidden standard", which is the distinction that actually matters.
        const HISTORIC = /legacy|historic|former|withdrawn|derived from/i;
        for (const c of everyCheck()) {
            for (const [field, text] of [['basis', c.basis], ['detail', c.detail]]) {
                if (!/hidden/i.test(String(text))) continue;
                assert.match(String(text), HISTORIC,
                    `${c.id}: ${field} cites Hidden as current — "${text}". That standard was withdrawn in 2007; ` +
                    `cite it as the ORIGIN of the company limit, not as the limit itself`);
            }
        }
    });

    // ── AND AN UNPRODUCED CITATION IS A STATE, NOT A COMMENT (v20.08, external review P1) ───────
    // Every rule above is satisfied by a basis that names Chiltern policy and marks Hidden historic
    // — and the v20.07 strings did all of that while the policy itself had never been produced.
    // What the row could not say was that difference, so the sheet read as sourced. The evidence
    // state now lives in `POLICY_SOURCE_CONFIRMED` and every string is derived from it; these two
    // assertions are the pair that make the flag load-bearing rather than decorative, and they fail
    // in BOTH directions so the day the citation lands is a test failure, not a forgotten edit.
    test('the basis discloses an outstanding citation, and stops once it is not', () => {
        for (const c of everyCheck()) {
            if (POLICY_SOURCE_CONFIRMED) {
                assert.doesNotMatch(c.basis, /outstanding|unconfirmed|to be confirmed/i,
                    `${c.id}: the policy source is confirmed, so "${c.basis}" should cite it, not hedge`);
            } else {
                assert.match(c.basis, /outstanding|unconfirmed|not confirmed|to be confirmed/i,
                    `${c.id}: "${c.basis}" reads as a sourced limit, but the policy document has never ` +
                    'been produced. ROADMAP.md class C cannot be rendered as though it were A or B');
            }
        }
    });

    test('an unconfirmed limit reports the measurement, never the verdict', () => {
        // "It cannot be run as drawn." is a CONSEQUENCE, and a consequence needs the rule behind it.
        // Until then the row may say what the design reaches and what to go and check — which is
        // still actionable, and is the honest form of the same finding.
        if (POLICY_SOURCE_CONFIRMED) return;
        for (const c of everyCheck()) {
            assert.doesNotMatch(c.detail, /cannot be run|must not be run|is not permitted/i,
                `${c.id}: "${c.detail}" states a verdict on an unconfirmed limit`);
        }
    });

    test('and no row claims the limit is industry-wide TODAY', () => {
        // The complement of the rule above, for the phrasing that does not mention Hidden at all.
        // "an industry limit" was true in 1990 and is not true now; on a sheet with no date on it,
        // an unqualified present-tense claim reads as current.
        for (const c of everyCheck()) {
            const text = [c.title, c.basis, c.detail].join(' ');
            const m = text.match(/\b(industry|national|railway)[- ](limit|standard|maximum|rule)s?\b/i);
            if (!m) continue;
            const before = text.slice(Math.max(0, m.index - 40), m.index);
            assert.match(before, /legacy|historic|former|withdrawn/i,
                `${c.id}: "${m[0]}" presents the limit as currently industry-wide: ${text}`);
        }
    });
});
