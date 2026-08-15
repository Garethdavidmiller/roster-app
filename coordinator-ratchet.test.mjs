/**
 * coordinator-ratchet.test.mjs — an already-large module may not get larger.
 * Run: node --test coordinator-ratchet.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── THE RULE THIS ENFORCES ──────────────────────────────────────────────────────────────────────
 *
 * **Coordinators coordinate; domain modules decide.** A coordinator reads the UI, calls a domain
 * function, renders the result and arranges persistence. The RULE — the thing that would be wrong
 * if it were wrong — belongs in a module of its own, where it can be tested without a DOM.
 *
 * The app is already good at this: `links-design.js`, `overtime-core.js`, `paycalc-calc.js`,
 * `calendar-data-state.js` and a dozen others exist because reasoning was pulled out of a
 * coordinator. But extraction has been an ACT OF WILL each time, and nothing stopped the next
 * feature going straight back into the big file. `links-app.js` is 3,200 lines.
 *
 * ── WHY A RATCHET AND NOT A LIMIT ───────────────────────────────────────────────────────────────
 *
 * A limit ("no file over 800 lines") would fail on the day it landed and would be waived by
 * lunchtime. A ratchet asks only that things do not get WORSE: each already-large module carries the
 * size it had when it was measured, and may not exceed it. Shrinking one is free — lower its cap in
 * the same commit and the new figure becomes the ceiling.
 *
 * ── THE HEADROOM IS DELIBERATE, AND SO IS ITS SIZE ──────────────────────────────────────────────
 *
 * Caps are the measured size PLUS 50, rounded up to the next 50 — so every file carries 50–99 lines
 * of room. Enough to fix a bug, add a comment or re-wire a call; nowhere near enough for a business
 * rule. Line count is a PROXY for the rule at the top of this file, and the proxy is only honest if
 * it leaves room for the work that does NOT violate the rule.
 *
 * The first cut rounded to the next 50 with no addition, which gave `admin-roster-upload.js` — 1,200
 * lines exactly — a cap of 1,200 and zero headroom. A guard that fails on a one-line fix is a guard
 * that gets waived, and a waived guard is worse than none.
 *
 * ── AND A NEW LARGE FILE IS A DELIBERATE ACT ────────────────────────────────────────────────────
 *
 * Anything crossing LARGE_THRESHOLD that is not in the table fails this test. That is the point: a
 * module becoming large should be a decision somebody makes and records, not something noticed two
 * years later. Adding a line to `CAPS` is cheap — it just cannot happen by accident.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const here = new URL('.', import.meta.url);
/** Newline COUNT — the same thing `wc -l` reports, which is where the caps below came from.
 *  `split('\n').length` is one higher on any file ending in a newline, i.e. all of them. */
const lines = (/** @type {string} */ f) =>
    (readFileSync(new URL(f, here), 'utf8').match(/\n/g) || []).length;

/** Below this, a module is free to grow — it has not become a coordination problem yet. */
const LARGE_THRESHOLD = 900;

/**
 * Measured size + 50, rounded up to the next 50 (August 2026, at v21.28).
 *
 * ⚠️ THESE MAY ONLY GO DOWN. If a number here needs raising, the change underneath it is the thing
 * to reconsider — that is the whole mechanism.
 */
const CAPS = {
    'links-app.js':            3250,   // ← the one the reviewer named; the next Links rule goes in a domain module
    'paycalc-app.js':          2000,
    'admin-overrides.js':      1800,
    'admin-app.js':            1800,
    'links-design.js':         1500,   // a DOMAIN module: large is less alarming here, but still capped
    'firebase-client.js':      1350,
    // 1300 → 1350 at v21.29, deliberately and after extracting first. The page-ready fix added the
    // surface-selection logic, the cache-first-paint race and their reasoning; the RULE it carried
    // ("is a roster on screen?") went to calendar-data-state.js as `showsRoster`, beside the four
    // states it reads. What is left is coordination and the argument for it, which is what this
    // file is for. The guard did its job: it made the extraction happen before the raise.
    'calendar-app.js':         1350,
    'roster-data.js':          1300,   // mostly data, not logic
    'admin-roster-upload.js':  1250,
    'nav-panel.js':            1250,
    'overtime-app.js':         1200,   // the young one — this is the cap that matters most
    'operations-reports.js':   1150,
    'service-worker.js':       1000,
};

describe('an already-large module may not get larger', () => {
    for (const [file, cap] of Object.entries(CAPS)) {
        test(`${file} stays within ${cap} lines`, () => {
            const n = lines(file);
            assert.ok(n <= cap,
                `${file} is ${n} lines, over its ${cap}-line cap.\n\n`
                + 'Coordinators coordinate; domain modules decide. If this growth is a business RULE,\n'
                + 'it belongs in a module of its own where it can be tested without a DOM. If it is\n'
                + 'genuinely coordination, and the file has earned the room, raise the cap deliberately\n'
                + 'and say why in the commit.');
        });
    }

    test('every large module is IN the table — a new one is a decision, not an accident', () => {
        const untracked = readdirSync(here)
            .filter(f => /\.js$/.test(f) && !f.includes('.test.'))
            .filter(f => !(f in CAPS))
            .filter(f => lines(f) > LARGE_THRESHOLD);
        assert.deepEqual(untracked, [],
            `these modules have crossed ${LARGE_THRESHOLD} lines and are not capped:\n  `
            + untracked.map(f => `${f} (${lines(f)})`).join('\n  ')
            + '\n\nAdd them to CAPS if that is intended — but a module becoming large should be a\n'
            + 'decision somebody makes, not something discovered later.');
    });

    test('and the caps are not quietly generous', () => {
        // GUARD THE GUARD. A cap far above the file it governs enforces nothing, and would let this
        // whole suite pass while the thing it exists to prevent happened. 200 lines of slack is well
        // beyond the next-50 rounding, so it can only mean a cap was raised and the file then shrank
        // — in which case the cap should have come down with it.
        const slack = Object.entries(CAPS)
            .map(([f, cap]) => [f, cap - lines(f)])
            .filter(([, gap]) => Number(gap) > 200)
            .map(([f, gap]) => `${f} has ${gap} lines of slack`);
        assert.deepEqual(slack, [], 'a cap has drifted above its file:\n  ' + slack.join('\n  '));
    });
});
