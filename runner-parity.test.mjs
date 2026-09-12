/**
 * runner-parity.test.mjs — AN OPT-IN SPEC MUST NOT RUN IN THE BEHAVIOURAL LANES.
 * Run: node --test runner-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────
 *
 * `playwright.config.mjs` points at `./e2e` and runs EVERYTHING in it except what `testIgnore`
 * names. Six specs are opt-in and have their own config — the CSP proof, the offline proof, the
 * live health check, and the three pixel suites — and each one is kept out of the default run by a
 * hand-typed entry in that single list.
 *
 * `playwright.webkit.mjs` spreads the base config, so it inherits the same list. **One omission
 * therefore leaks into three lanes at once**, and two of them are gates.
 *
 * That is not a hypothetical. `visual-webkit.spec.js` was added at v23.71 and not listed:
 * `smoke` and both `mobile-safari` shards each picked up its six baselines, compared them against
 * the wrong engine's committed PNGs, and failed twelve tests apiece. The suite itself was correct
 * and passing in its own lane the whole time — `visual-webkit` was green on the same run.
 *
 * The failure is also badly disguised. A pixel spec run in the wrong lane does not error with
 * anything resembling "this should not be here"; it reports a screenshot mismatch, which reads
 * like a genuine visual regression and sends the next person to regenerate baselines that were
 * never wrong.
 *
 * ── WHAT IT ASSERTS, AND WHY IT IS DERIVED ──────────────────────────────────────────────────────
 *
 * Every `playwright.*.mjs` other than the base config names the spec(s) it owns in `testMatch`.
 * This reads those names out of the configs and requires each to appear in the base `testIgnore`.
 * Nothing here is a hardcoded list of specs — add a seventh opt-in config tomorrow and the
 * requirement extends itself, which is the whole point. A guard that had to be updated alongside
 * the list it guards would fail in exactly the situation it exists for.
 *
 * It does the reverse too: an entry in `testIgnore` that no config claims means a spec that runs
 * NOWHERE. That is the quieter of the two failures — nothing goes red, a suite simply stops
 * existing — and it is the same shape as `doc-parity`'s "every root TEST file is actually RUN by
 * one of the npm scripts", which was written after exactly that happened.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const BASE = 'playwright.config.mjs';

/** Every string in a `testMatch:` / `testIgnore:` declaration, whether it is one literal or an
 *  array of them. A regex rather than an import: these configs pull in `@playwright/test` and the
 *  dev server, and this suite runs in the lane that needs nothing installed. */
function specList(src, key) {
    const m = new RegExp(`${key}:\\s*(\\[[^\\]]*\\]|'[^']*')`).exec(src);
    if (!m) return null;
    return [...m[1].matchAll(/'([^']+\.spec\.js)'/g)].map(x => x[1]);
}

const configs = readdirSync(ROOT)
    .filter(f => /^playwright\..*\.mjs$/.test(f) && f !== BASE)
    .map(f => ({ file: f, src: readFileSync(join(ROOT, f), 'utf8') }));

const baseSrc = readFileSync(join(ROOT, BASE), 'utf8');
const ignored = specList(baseSrc, 'testIgnore') ?? [];

describe('the opt-in lanes and the default lane agree', () => {
    test('guard the guard — the configs and the ignore list were actually read', () => {
        assert.ok(configs.length >= 4, `only ${configs.length} opt-in configs found — this test is checking nothing`);
        assert.ok(ignored.length >= 4, `testIgnore parsed as ${ignored.length} entries — the regex has stopped matching`);
    });

    test('every spec owned by its own config is ignored by the default run', () => {
        const leaked = [];
        for (const { file, src } of configs) {
            for (const spec of specList(src, 'testMatch') ?? []) {
                if (!ignored.includes(spec)) leaked.push(`${spec} (owned by ${file})`);
            }
        }
        assert.deepEqual(leaked, [],
            'these specs have their OWN Playwright config but are not in playwright.config.mjs\'s\n'
            + 'testIgnore, so the default run — and playwright.webkit.mjs, which spreads it — will run\n'
            + 'them too:\n  ' + leaked.join('\n  ') + '\n\n'
            + 'A pixel spec in the wrong lane fails as a SCREENSHOT MISMATCH, which reads like a real\n'
            + 'visual regression and invites regenerating baselines that were never wrong.');
    });

    test('and nothing is ignored that no config claims — a spec that runs NOWHERE', () => {
        const owned = new Set(configs.flatMap(({ src }) => specList(src, 'testMatch') ?? []));
        const orphans = ignored.filter(s => !owned.has(s));
        assert.deepEqual(orphans, [],
            'these are excluded from the default run but no other config runs them, so they execute\n'
            + 'nowhere at all:\n  ' + orphans.join('\n  ') + '\n\n'
            + 'Either give the spec a config, or take it out of testIgnore. Nothing goes red when a\n'
            + 'suite silently stops running, which is why this is asserted rather than noticed.');
    });
});
