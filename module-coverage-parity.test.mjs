// @ts-check
/**
 * module-coverage-parity.test.mjs — A RUNTIME MODULE THAT NO TEST HAS HEARD OF.
 * Run with: node --test module-coverage-parity.test.mjs
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * `admin-range-booking.js` — the shared save skeleton behind BOTH the Annual Leave card and the
 * Absence card, the code that decides which member and which dates reach `recordRangeOverrides` —
 * went untested for its entire life. Not thinly tested: no unit suite, no e2e spec, and neither of
 * its two wrappers driven either. It was found by a sweep during a review, not by the estate.
 *
 * That is a strange thing to be possible in a repo with ~5,000 tests, and the reason is worth
 * naming: **every guard here is aimed at a rule somebody thought to write down.** There was nothing
 * asking the negative question — *is there a module nobody thought about at all?* A file with no
 * tests produces no failures, so the suite is greenest exactly where it is blindest, and the more
 * tests the estate accumulates the more convincing that green looks.
 *
 * So this asks the negative question, once, cheaply, and forever.
 *
 * ── WHAT IT CAN AND CANNOT SEE ──────────────────────────────────────────────────────────────────
 *
 * It matches a module's FILENAME anywhere in the test and e2e sources. That is deliberately crude,
 * and crude in the safe direction: it cannot tell a thorough suite from a passing mention, so it
 * will never claim a module is well covered. It can only report the one thing it is sure of — that
 * nothing in the estate so much as names this file.
 *
 * The inverse is the real risk and is handled by the allowlist rather than by cleverness: a module
 * can be exercised thoroughly through BEHAVIOUR without its name appearing anywhere (the three
 * Operations cards are driven by e2e/pages.spec.js through their DOM, never by filename). A first
 * naive cut of this sweep reported twelve modules and ten of them were that case. So an entry here
 * is not "untested" — it is "unnamed, and here is why that is acceptable".
 *
 * ── THE LIST IS A RATCHET ───────────────────────────────────────────────────────────────────────
 *
 * Shrinking it is free. Adding to it is a decision somebody makes, in the commit that adds it, with
 * a reason a reader can disagree with — the same shape as `coordinator-ratchet.test.mjs` and
 * `focus-ring-parity.test.mjs`'s `NO_INDICATOR_EXEMPT`. A new module that nothing names fails here
 * rather than joining the estate silently, which is the whole point: the next
 * `admin-range-booking.js` announces itself on the commit that creates it.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const here = (/** @type {string} */ f) => new URL('./' + f, import.meta.url);
const read = (/** @type {string} */ f) => readFileSync(here(f), 'utf8');

/** Not runtime modules: tooling that ships with the repo but never with the app. */
const NOT_RUNTIME = new Set(['eslint.config.js', 'generate-sri.mjs']);

/**
 * Modules no test or spec NAMES, each with the reason that is acceptable.
 *
 * Two legitimate kinds, and nothing else should be here:
 *   · BOOT SHIM — two lines, no branches, and `page-contract-parity.test.mjs` already asserts every
 *     page has one. There is nothing a unit test could add.
 *   · DRIVEN BY BEHAVIOUR — an e2e spec exercises the module through the DOM it owns, so the
 *     coverage is real and only the NAME is absent. Each entry says which spec.
 */
const UNNAMED_BY_DESIGN = {
    'operations-boot.js': 'boot shim — 13 lines, no branches; page-contract-parity asserts it exists',
    'overtime-boot.js':   'boot shim — 13 lines, no branches; page-contract-parity asserts it exists',

    'operations-errors.js': 'driven through its card by e2e/pages.spec.js (Error Log)',
    'operations-usage.js':  'driven through its card by e2e/pages.spec.js (Usage)',
    'operations-speed.js':  'driven through its card by e2e/pages.spec.js (App Speed)',
    'calendar-al-lightbox.js': 'driven by e2e/calendar.spec.js (the `day detail:` block) and pinned by lightbox-transform-parity + day-detail-explains',
    'calendar-keyboard.js': 'driven by e2e/calendar.spec.js (arrow-key navigation and the hover tooltip)',
    'admin-sick.js':        'a thin config wrapper over admin-range-booking.js, whose factory is now directly tested; the Absence card is driven by e2e/pages.spec.js',
    'railcard-guide.js':    'guide-page chrome (print, chip-bar); content is pinned by guide-sources + guide-index-parity',
    'rangers-guide.js':     'guide-page chrome; evidence states pinned by guide-sources.test.mjs',

    // ── NO GENUINE GAPS REMAIN ──────────────────────────────────────────────────────────────────
    // `paycalc-year-card.js` sat here from v23.69 as the one entry that was debt rather than a
    // decision, with the external reviewer's own ordering attached — test it eventually, but
    // nowhere near above the Admin range writer. It was paid at v23.70 by
    // `paycalc-year-card.test.mjs`, and writing that suite found a real defect (a fill that threw
    // left a dead, relabelled button and said nothing), which is the argument for this file in one
    // line: the module nobody had thought about was the module with the bug in it.
    //
    // Every entry above is now a DECISION — a boot shim, or a module an e2e spec drives through
    // its DOM. Keep it that way: a "KNOWN GAP" entry is a legitimate thing to add when the honest
    // answer is not-yet, but it should be uncomfortable to leave, and it should never be the
    // quickest way past a failing run.
};

/** THIS FILE IS EXCLUDED FROM ITS OWN CORPUS, and that is load-bearing rather than tidy.
 *  `UNNAMED_BY_DESIGN` spells out every exempt module's filename, so including this file would make
 *  the allowlist name its own entries — every exemption would read as "covered", the stale check
 *  would fire on all of them at once, and the main check would be satisfied by the very list it is
 *  meant to police. A guard that reads its own answer back is not a guard. */
const SELF = 'module-coverage-parity.test.mjs';
function testCorpus() {
    return [
        ...readdirSync(here('')).filter(f => f.endsWith('.test.mjs') && f !== SELF).map(f => read(f)),
        ...readdirSync(here('e2e')).filter(f => f.endsWith('.js'))
            .map(f => readFileSync(new URL('./e2e/' + f, import.meta.url), 'utf8')),
    ].join('\n');
}

describe('every runtime module is known to the test estate', () => {
    test('a module nothing names is either a boot shim or declared, with a reason', () => {
        const modules = readdirSync(here(''))
            .filter(f => f.endsWith('.js') && !f.includes('.test.') && !NOT_RUNTIME.has(f));
        assert.ok(modules.length > 100, `only ${modules.length} modules found — this test is checking nothing`);

        const corpus = testCorpus();

        const unnamed = modules.filter(m => !corpus.includes(m));
        const undeclared = unnamed.filter(m => !(m in UNNAMED_BY_DESIGN));

        assert.deepEqual(undeclared, [],
            'no test and no e2e spec so much as NAMES these modules:\n  ' + undeclared.join('\n  ') +
            '\n\nThat is how admin-range-booking.js — the shared save path behind both booking cards —\n' +
            'went its whole life untested. Give it a suite, or add it to UNNAMED_BY_DESIGN with the\n' +
            'reason it does not need one (a boot shim, or an e2e spec that drives it through the DOM,\n' +
            'named). An entry there is a decision; silence is not.');
    });

    test('the allowlist has no stale entries', () => {
        // A ratchet needs teeth in BOTH directions. An entry left behind after a module gains a
        // suite makes the list read as longer-standing debt than it is, and a guard whose exemptions
        // nobody prunes stops being read at all.
        const modules = new Set(readdirSync(here('')).filter(f => f.endsWith('.js')));
        const corpus = testCorpus();

        const stale = Object.keys(UNNAMED_BY_DESIGN).filter(m => !modules.has(m) || corpus.includes(m));
        assert.deepEqual(stale, [],
            'these are listed as unnamed but are now named by a test (or no longer exist). Remove\n' +
            'them from UNNAMED_BY_DESIGN — the list may only shrink:\n  ' + stale.join('\n  '));
    });

    test('every reason is a real sentence, not a placeholder', () => {
        // The list is only worth having if a reader can disagree with an entry. "TODO" cannot be
        // disagreed with.
        const weak = Object.entries(UNNAMED_BY_DESIGN)
            .filter(([, why]) => why.trim().length < 25 || /^(todo|n\/a|none|-)$/i.test(why.trim()))
            .map(([m, why]) => `${m}: ${JSON.stringify(why)}`);
        assert.deepEqual(weak, [], 'these exemptions do not say anything:\n  ' + weak.join('\n  '));
    });
});
