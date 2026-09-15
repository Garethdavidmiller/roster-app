// @ts-check
/**
 * al-copy-parity.test.mjs — the Annual Leave help must teach the rule the app actually follows.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
 *
 * v23.75 changed what leave on a base-roster REST DAY means: the app stopped deciding silently and
 * started ASKING, per day, whether the member had swapped a working day onto it. Four staff-facing
 * surfaces went on saying the old thing — "rest days and Sundays are skipped automatically" — for
 * fifteen releases, and an external review found them by reading, because nothing in ~5,000 tests
 * could. The copy is not decoration on this card: it is the instruction a manager follows while
 * booking somebody's leave, and it was describing a rule the save no longer uses.
 *
 * ── WHAT IT PINS, AND THE HALF THAT IS EASY TO GET WRONG ───────────────────────────────────────
 *
 * ANNUAL LEAVE may not claim rest days are handled automatically, and must name the question.
 * ABSENCE still skips rest days — that flow was deliberately never wired to the swap question
 * (CLAUDE.md: "Never wire it to the Absence card") — so its copy is RIGHT and this pins it too.
 * A sweep that "fixed" both would break the one that was true, which is exactly the shape of
 * mistake a find-and-replace makes.
 *
 * The tips are SLICED OUT OF THE SOURCE by their `CARD_TIPS` keys rather than imported: they live
 * in a const inside a 1,700-line `init()` behind the session guard. The slice throws if the anchors
 * move, which is the sw-internals.test.mjs / override-utils.test.mjs pattern — re-anchor it, never
 * delete it.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (/** @type {string} */ p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const adminSrc = read('./admin-app.js');
const adminHtml = read('./admin.html');
const guide = read('./staff-guide.html');

/**
 * One CARD_TIPS entry's source text, by its key. Throws rather than returning '' — an empty slice
 * would pass every "must not say" assertion below and fail nothing.
 * @param {string} key
 */
function tipsBlock(key) {
    const start = adminSrc.indexOf(`            '${key}': {`);
    if (start === -1) {
        throw new Error(`al-copy-parity: CARD_TIPS['${key}'] not found in admin-app.js — it has moved `
            + 'or been renamed. Re-anchor rather than deleting these tests.');
    }
    // The next key at the same indentation ends the block; the last one ends at the closing brace.
    const next = adminSrc.indexOf(`\n            '`, start + 1);
    const end = next === -1 ? adminSrc.indexOf('\n        };', start) : next;
    const block = adminSrc.slice(start, end === -1 ? undefined : end);
    if (block.length < 200) throw new Error(`al-copy-parity: CARD_TIPS['${key}'] sliced to ${block.length} chars — the anchors are wrong.`);
    return block;
}

/** The claims that stopped being true for LEAVE at v23.75. Matched loosely on purpose. */
const AUTOMATIC_CLAIMS = [
    /rest\s+days?[^.]{0,60}skipped\s+automatically/i,
    /skipped\s+automatically[^.]{0,60}rest\s+days?/i,
    /rest\s+days?[^.]{0,60}already\s+taken\s+out/i,
];

/** @param {string} text @param {string} where */
function assertNoAutomaticClaim(text, where) {
    for (const re of AUTOMATIC_CLAIMS) {
        const m = re.exec(text);
        assert.equal(m, null,
            `${where} still says leave skips rest days automatically — the app ASKS since v23.75:\n  ${m?.[0]}`);
    }
}

describe('Annual Leave copy states the rule the save follows', () => {
    const al = tipsBlock('annual-leave');

    test('the Record Annual Leave tips do not claim rest days are handled automatically', () => {
        assertNoAutomaticClaim(al, "admin-app.js CARD_TIPS['annual-leave']");
    });

    test('and they NAME the question — both audiences, since each has its own line', () => {
        // Guard on the guard: the slice must actually hold both variants, or "contains swapped"
        // could pass on one line while the other still taught the old rule.
        assert.match(al, /adminOnly:\s*true/, 'the admin variant is missing from the slice');
        assert.match(al, /staffOnly:\s*true/, 'the self-service variant is missing from the slice');
        const lines = al.split('\n').filter(l => /adminOnly:\s*true|staffOnly:\s*true/.test(l));
        assert.equal(lines.length, 2, 'expected exactly the two audience variants');
        for (const line of lines) {
            assert.match(line, /swapped/i, `this variant never mentions the swap question:\n  ${line.trim()}`);
        }
    });

    test('the PREVIEW tip does not promise a count with rest days already removed', () => {
        // It used to say "with rest days and Sundays already taken out of that count", which is now
        // only half true: a rest day answered "swapped" IS in the count, and that is the whole point.
        const preview = al.split('\n').find(l => l.includes('how many working days'));
        assert.ok(preview, "the preview tip ('how many working days') is no longer in this block");
        assertNoAutomaticClaim(preview, 'the AL preview tip');
        assert.match(preview, /swapped/i, 'the preview tip does not say when a rest day IS counted');
    });

    test("the card's own hint asks about rest days rather than claiming to skip them", () => {
        const hint = /<span class="hint">([^<]*)<\/span>/.exec(
            adminHtml.slice(adminHtml.indexOf('id="alToggleHeader"')));
        assert.ok(hint, 'the Annual Leave card hint is not where this test looks for it');
        assertNoAutomaticClaim(hint[1], "admin.html's Annual Leave hint");
        assert.match(hint[1], /rest day/i, 'the hint says nothing about a rest day at all');
    });

    test('nothing REWRITES that hint at runtime — one sentence, one home', () => {
        // The self-service branch used to overwrite it with the pre-v23.75 sentence, so the members
        // least likely to know the rule were the only ones shown the wrong one (v23.90).
        assert.equal(/alHint\s*\)?\s*\.?\s*textContent\s*=/.test(adminSrc), false,
            'admin-app.js assigns the Annual Leave hint again — admin.html owns that sentence');
    });
});

describe('the Staff Guide teaches the same rule', () => {
    const section = guide.slice(guide.indexOf('id="sg-leave-absence"'),
        guide.indexOf('<h2', guide.indexOf('id="sg-leave-absence"') + 10));

    test('the Leave & Absence section is where this test thinks it is', () => {
        assert.ok(section.length > 200, 'sg-leave-absence sliced to nothing — re-anchor this test');
        assert.match(section, /Record Annual Leave/);
    });

    test('it does not teach the automatic-skip rule for leave', () => {
        assertNoAutomaticClaim(section, "staff-guide.html's Leave & Absence section");
    });

    test('it names the swap question', () => {
        assert.match(section, /swapped/i,
            'the guide describes booking leave without mentioning the rest-day question');
    });
});

describe('ABSENCE copy is the one that still skips, and must not be swept with the rest', () => {
    const sick = tipsBlock('sick-days');

    test('the Record Absence tips still say rest days are skipped automatically', () => {
        // CLAUDE.md: the swap question is never wired to the Absence card. Being off sick on a rest
        // day costs nothing and asks nobody anything, so this sentence is TRUE here — and a
        // find-and-replace over the phrase above would have broken it.
        assert.match(sick, /rest days and sundays inside the range are skipped automatically/i,
            'the Absence tips no longer state the rule that flow actually follows');
    });

    test('and they do NOT mention the swap question', () => {
        assert.equal(/swapped/i.test(sick), false,
            'the Absence card has been told about a question it never asks');
    });
});
