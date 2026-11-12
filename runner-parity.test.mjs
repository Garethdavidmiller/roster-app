/**
 * runner-parity.test.mjs — AN OPT-IN SPEC MUST NOT RUN IN THE BEHAVIOURAL LANES.
 * Run: node scripts/run-tests.mjs runner-parity.test.mjs   (part of `npm run test:hygiene`)
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
 * Every `playwright.*.mjs` other than the base config names the spec(s) it owns in `testMatch` —
 * at the root, or in `e2e/` (where e2e/playwright.signed-in.mjs lives, because a new ROOT file would
 * be served from the staff app's own domain; its header has the argument). This reads those names
 * out of the configs and requires each to appear in the base `testIgnore`.
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

/** A LANE's own specs are the `testMatch` at its config's TOP level. One inside `projects:` only
 *  narrows which of the lane's specs a project runs — playwright.webkit.mjs gives the Links specs
 *  projects of their own that way (12 Nov 2026) — and read as a lane's, it would demand those specs
 *  leave the default run, which is the DEPLOY gate's. So the read stops where the projects begin. */
function laneHead(/** @type {string} */ src) {
    const at = src.search(/^\s*projects:\s*\[/m);
    return at === -1 ? src : src.slice(0, at);
}

const isConfig = (/** @type {string} */ f) => /^playwright\..*\.mjs$/.test(f);
const configs = [
    ...readdirSync(ROOT).filter(f => isConfig(f) && f !== BASE),
    ...readdirSync(join(ROOT, 'e2e')).filter(isConfig).map(f => `e2e/${f}`),
].map(f => ({ file: f, src: readFileSync(join(ROOT, f), 'utf8') }));

const baseSrc = readFileSync(join(ROOT, BASE), 'utf8');
const ignored = specList(baseSrc, 'testIgnore') ?? [];

describe('the opt-in lanes and the default lane agree', () => {
    test('guard the guard — the configs and the ignore list were actually read', () => {
        assert.ok(configs.length >= 4, `only ${configs.length} opt-in configs found — this test is checking nothing`);
        assert.ok(configs.some(c => c.file.startsWith('e2e/')),
            'no config found in e2e/ — the signed-in lane\'s lives there, so the folder has stopped being read');
        assert.ok(ignored.length >= 4, `testIgnore parsed as ${ignored.length} entries — the regex has stopped matching`);
    });

    test('every spec owned by its own config is ignored by the default run', () => {
        const leaked = [];
        for (const { file, src } of configs) {
            for (const spec of specList(laneHead(src), 'testMatch') ?? []) {
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
        const owned = new Set(configs.flatMap(({ src }) => specList(laneHead(src), 'testMatch') ?? []));
        const orphans = ignored.filter(s => !owned.has(s));
        assert.deepEqual(orphans, [],
            'these are excluded from the default run but no other config runs them, so they execute\n'
            + 'nowhere at all:\n  ' + orphans.join('\n  ') + '\n\n'
            + 'Either give the spec a config, or take it out of testIgnore. Nothing goes red when a\n'
            + 'suite silently stops running, which is why this is asserted rather than noticed.');
    });

    test('a testMatch inside projects narrows a lane — it is not a lane of its own', () => {
        // The shape playwright.webkit.mjs would have with its constant written out: no testMatch at
        // the top, one per project. Read as a lane's, the first test above would ask for the Links
        // specs to leave the default run, and with them the deploy gate's Chromium smoke.
        const narrowed = "export default {\n    ...base,\n    projects: [\n"
            + "        { name: 'one-links', testMatch: 'links*.spec.js' },\n    ],\n};";
        assert.equal(specList(laneHead(narrowed), 'testMatch'), null,
            'a project\'s testMatch was read as the lane\'s own specs');
        const lane = "export default {\n    testMatch: ['own.spec.js'],\n    projects: [{ name: 'one' }],\n};";
        assert.deepEqual(specList(laneHead(lane), 'testMatch'), ['own.spec.js'], 'a lane\'s own testMatch is still read');
    });
});

// ── A STRAY `test.only` MUST NOT QUIETLY SHRINK A LANE (test audit, 7 Nov 2026) ─────────────────────
//
// When any `test.only` or `describe.only` is present, Playwright runs ONLY the focused tests and
// reports the result as an ordinary green run. Until this guard no config set `forbidOnly`, so a single
// leftover `.only` would have made branch CI and the Hosting deploy gate run one test and pass — the
// whole suite gone, nothing red, and nothing in the summary to say so. `forbidOnly: !!process.env.CI`
// makes it an error on every CI runner ("item focused with '.only' is not allowed", measured) and
// leaves it usable locally, which is what `.only` is for.
//
// Node's runner does not need this: it ignores `.only` unless started with `--test-only`, and no
// script here passes that flag.
describe('no lane can be quietly focused', () => {
    /** True when a non-comment line of `src` sets forbidOnly from CI. A commented-out line does not count. */
    const forbids = (src) => src.split('\n').some(l => /^\s*forbidOnly:\s*!!process\.env\.CI\s*,/.test(l));
    const all = [{ file: BASE, src: baseSrc }, ...configs];

    test('every Playwright config refuses `.only` on CI, or inherits that from the base', () => {
        assert.ok(forbids(baseSrc), `${BASE} must set \`forbidOnly: !!process.env.CI\``);
        const missing = all.filter(({ src }) => !forbids(src) && !/\.\.\.base\b/.test(src)).map(c => c.file);
        assert.deepEqual(missing, [],
            'these configs do not set `forbidOnly: !!process.env.CI`, so a stray `test.only` would make\n'
            + 'their lane run one test and report green:\n  ' + missing.join('\n  '));
    });

    test('and a config that spreads the base does not switch it back off', () => {
        const overrides = all.filter(({ src }) => /\.\.\.base\b/.test(src)
            && src.split('\n').some(l => /^\s*forbidOnly\s*:/.test(l) && !/!!process\.env\.CI/.test(l)))
            .map(c => c.file);
        assert.deepEqual(overrides, [], `these configs override the base's forbidOnly: ${overrides.join(', ')}`);
    });
});
