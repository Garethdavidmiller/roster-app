/**
 * london-clock.test.mjs — WHAT THE SPLIT PUT AT RISK.
 * Run with: node --test london-clock.test.mjs   (no mocks; part of test:hygiene)
 *
 * ── WHY THIS FILE IS SHORT, AND DELIBERATELY NOT A SECOND CLOCK SUITE ───────────────────────────
 *
 * These six functions did not arrive with this module. They were exercised before the split and are
 * exercised after it, by `overtime-core.test.mjs`'s clock block — every DST pathology, both
 * transition days, the en-CA date read — which still passes untouched, because it reaches them
 * through `overtime-core.js`'s re-export. Restating those cases here would not add a guard; it
 * would add a second copy of one, and a second copy of a rule is the thing this repo has most
 * reliably got wrong.
 *
 * This mirrors `overtime-clock.test.mjs`, which does the same job for the CLIENT-side split. Same
 * shape, same reasoning, deliberately.
 *
 * What DID arrive with the split is three structural claims the module header makes, none of which
 * any existing test can see, and each of which fails silently:
 *
 *   1. THE RE-EXPORT IS COMPLETE AND IDENTICAL. Eight call sites reach these names as `OT.x`. If
 *      the re-export were ever "tidied" into a re-DECLARATION, every call site would still resolve,
 *      every consumer would still run, and two London clocks would exist in one process with
 *      nothing to say so — the failure being an hour wide and twice a year. Identity is the
 *      assertion, not presence.
 *
 *   2. THIS MODULE REQUIRES NOTHING. That is what lets `overtime-core.test.mjs` run in
 *      `test:hygiene` — on every branch, gating the Hosting deploy — rather than only in
 *      `test:functions`, which needs `functions/node_modules` and fires on a push to main. The
 *      deadline arithmetic is too load-bearing to be checked at the wrong end of a merge. The
 *      property decays the first moment somebody wants a helper in here, and nothing visibly
 *      breaks when it does.
 *
 *   3. THIS MODULE NAMES NO HOUR OF ITS OWN. The line the header draws is: if changing it would
 *      change what the app PROMISES somebody, it is not clock code. A deadline hour, the retention
 *      boundary and the scheduler hour are all policy, and all three stay in `overtime-core.js`.
 *      Moving one in here "because it is a time" would quietly undo the split while leaving every
 *      test green — this is the only thing that would notice.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const clock = require('./functions/london-clock.js');
const core = require('./functions/overtime-core.js');

const SRC = readFileSync(new URL('./functions/london-clock.js', import.meta.url), 'utf8');

/**
 * The same source with every comment blanked, keeping byte count and newlines.
 *
 * The scans below ask what the module DOES, and a comment does nothing. Without this, claim 3
 * failed on this module's own header — which names `londonNoonTimestamp` in the course of
 * explaining that it deliberately stays in `overtime-core.js`. A guard that fires on the sentence
 * documenting the rule it enforces is a guard that gets deleted.
 */
const CODE = SRC
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

/** The names `overtime-core.js` re-exports from here. Every one is reached as `OT.x` in production. */
const RE_EXPORTED = [
    'londonOffsetMinutes',
    'londonTimestamp',
    'londonIsoDate',
    'isValidIsoDate',
    'isoDayOfWeek',
    'addDays',
];

describe('the split holds', () => {

    test('overtime-core re-exports every clock name, and re-exports the SAME function', () => {
        for (const name of RE_EXPORTED) {
            assert.equal(typeof clock[name], 'function', `london-clock.js no longer exports ${name}`);
            // Identity, not presence. A re-declaration would satisfy `typeof` and every call site
            // while running a second clock — see claim 1 in this file's header.
            assert.equal(core[name], clock[name],
                `overtime-core.js's ${name} is no longer THE london-clock.js function. If it was `
                + 'copied back in to "tidy" the require, there are now two clocks: delete the copy '
                + 'and re-export instead.');
        }
    });

    test('london-clock.js requires nothing', () => {
        // Not a style rule. It is what keeps overtime-core.js loadable with no functions/node_modules,
        // which is what keeps the deadline arithmetic in the lane that runs on every branch.
        const requires = [...CODE.matchAll(/\brequire\s*\(/g)];
        assert.deepEqual(requires.map(m => m[0]), [],
            'london-clock.js has gained a require. That moves overtime-core.test.mjs out of the '
            + 'no-dependency lane, so the London clock would only be checked in the Functions '
            + 'deploy workflow — after a merge, not before one. Inline what you need, or put the '
            + 'new code in the module that needs it.');
        assert.doesNotMatch(CODE, /^\s*import\s/m, 'london-clock.js is CommonJS and imports nothing');
    });

    test('london-clock.js names no hour of its own — the policy hours stay with the feature', () => {
        // The three that must NOT migrate here, each with the promise it encodes.
        for (const name of ['DEADLINE_HOUR_LONDON', 'SCHEDULER_HOUR_LONDON', 'londonNoonTimestamp',
            'londonMidnightTimestamp', 'lastSchedulerRun']) {
            assert.doesNotMatch(CODE, new RegExp(`\\b${name}\\b`),
                `${name} has moved into london-clock.js. It is a choice this depot made — a `
                + 'deadline, a retention boundary, a cron hour — not a fact about the timezone, '
                + 'and it belongs in overtime-core.js beside the rule it serves.');
        }
        // And the feature still owns them, so the move was not made in the other direction either.
        for (const name of ['londonNoonTimestamp', 'londonMidnightTimestamp', 'lastSchedulerRun']) {
            assert.equal(typeof core[name], 'function', `overtime-core.js no longer exports ${name}`);
        }
        assert.equal(core.DEADLINE_HOUR_LONDON, 12, 'the availability deadline is noon London');
    });

    // ── Guard the guard ────────────────────────────────────────────────────────────────────────
    // Every assertion above passes if the extractor reads an empty file, and two of them are
    // doesNotMatch, which is the direction that fails open. This pins the machinery to text that IS
    // there, so a bad path or a renamed module fails loudly instead of reporting a clean split.
    test('the source under test is really the module', () => {
        assert.ok(SRC.length > 2000, `london-clock.js read as ${SRC.length} chars — wrong path?`);
        assert.match(CODE, /function londonOffsetMinutes/, 'the clock is not in the file being scanned');
        assert.match(CODE, /\bmodule\.exports\b/, 'no export block — the require-scan would pass on anything');
        assert.equal(RE_EXPORTED.length, Object.keys(clock).length,
            'london-clock.js exports a name this suite does not know about — add it to RE_EXPORTED '
            + 'so its re-export identity is checked too, or it is a name nothing is guarding.');
    });
});
