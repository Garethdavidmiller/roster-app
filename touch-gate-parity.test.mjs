/**
 * touch-gate-parity.test.mjs — A TOUCH-ONLY TEST MUST RUN ON EVERY TOUCH ENGINE.
 *
 * The failure this exists for is the quietest kind there is: a test that does not run reports as
 * SKIPPED, and a skip is green. Nine day-panel tests were gated to `mobile-chrome` ALONE, so the
 * app's only touch route to what a day IS never once ran on the engine every iPhone uses — while
 * `mobile-safari` sat in CI the whole time as a full, paid-for job. Nothing failed, nothing warned,
 * and the suite looked complete.
 *
 * It had already happened once and been fixed once: v22.12 found exactly the same shape in the
 * 16px-focusable-field rule — *"the guard for an iOS behaviour never once ran on the iOS engine"* —
 * and widened that one gate. What it did not do was stop the next one, and there were nine.
 *
 * ── WHAT IS ACTUALLY CHECKED ───────────────────────────────────────────────────────────────────
 *
 * Not "every test runs everywhere", which is false and would be noise. The rule is narrower: a test
 * that gates ITSELF on being a touch device must use the shared list, so it cannot name one engine
 * and quietly mean both. A test with a genuinely engine-neutral reason to stay narrow (WCAG tap
 * targets are a standard, not a rendering behaviour) keeps its gate and says so HERE, by name —
 * the `NO_INDICATOR_EXEMPT` idiom from focus-ring-parity, which makes a narrow gate a decision
 * somebody made rather than a line somebody typed.
 *
 * Contract 3 is the one that will catch the next instance rather than this one: `TOUCH_PROJECTS` is
 * checked against the mobile projects the Playwright configs actually declare. Adding a third
 * mobile engine and forgetting the list is the same bug again, and it would otherwise be invisible
 * until somebody counted skips.
 *
 * Part of test:hygiene — static, no browser, nothing installed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const SPEC_DIR = './e2e';
const SPECS = readdirSync(SPEC_DIR).filter(f => f.endsWith('.spec.js'));

/**
 * Gates that name ONE touch project on purpose, each with the reason it does not cross engines.
 * A reason here must be about the RULE, never about the test being awkward to run elsewhere.
 */
const SINGLE_PROJECT_EXEMPT = [
    {
        file: 'pages.spec.js',
        match: "'a thumb, not a mouse'",
        why: 'WCAG 2.2 SC 2.5.8 tap-target sizing. A standard about geometry, not about rendering — '
           + 'the number is the same on both engines, so a second run would cost time and prove nothing.',
    },
];

describe('a touch-only test runs on every touch engine', () => {
    test('the shared list is used — no spec names one touch project by hand', () => {
        /** @type {string[]} */
        const offenders = [];
        for (const f of SPECS) {
            const src = readFileSync(`${SPEC_DIR}/${f}`, 'utf8');
            src.split('\n').forEach((line, i) => {
                // Only SKIP gates: an `if (name === 'mobile-chrome')` branch inside a test is
                // choosing a viewport or an expectation, not deciding whether the test runs.
                if (!/test\.skip\(/.test(line)) return;
                if (!/project\.name\s*[!=]==\s*'mobile-(chrome|safari)'/.test(line)) return;
                if (SINGLE_PROJECT_EXEMPT.some(e => e.file === f && line.includes(e.match))) return;
                offenders.push(`${f}:${i + 1}  ${line.trim()}`);
            });
        }
        assert.deepEqual(offenders, [],
            'these tests decide whether to run by naming ONE touch project, so they cover one engine '
          + 'and read as covering touch. Use `isTouchProject(info)` from e2e/helpers.js, or add a '
          + 'NAMED exemption above with the reason the rule genuinely does not cross engines:\n  '
          + offenders.join('\n  '));
    });

    test('every exemption still matches a real line — a stale one is a gate nobody is watching', () => {
        for (const e of SINGLE_PROJECT_EXEMPT) {
            const src = readFileSync(`${SPEC_DIR}/${e.file}`, 'utf8');
            assert.ok(src.includes(e.match),
                `${e.file} no longer contains ${e.match} — drop the exemption rather than leaving it `
              + 'to excuse something else later');
            assert.ok(e.why && e.why.length > 40, `${e.match} needs a reason, not a placeholder`);
        }
    });

    test('TOUCH_PROJECTS names every mobile project the configs declare', async () => {
        // The contract that catches the NEXT instance rather than this one: a third mobile engine
        // added to a config and not to the list would silently stop being covered by every gate
        // above, and nothing else in the repo would notice.
        const declared = new Set();
        for (const cfg of ['playwright.config.mjs', 'playwright.webkit.mjs']) {
            for (const m of readFileSync(`./${cfg}`, 'utf8').matchAll(/name:\s*'([\w-]+)'/g)) {
                if (m[1].startsWith('mobile-')) declared.add(m[1]);
            }
        }
        assert.ok(declared.size >= 2,
            `expected the mobile projects to be found in the configs, got [${[...declared]}] — if the `
          + 'naming convention changed, this scan must change with it');

        const { TOUCH_PROJECTS } = await import('./e2e/helpers.js');
        assert.deepEqual([...TOUCH_PROJECTS].sort(), [...declared].sort(),
            'TOUCH_PROJECTS and the configs disagree about which projects are touch devices. Every '
          + 'touch-gated test keys on that list, so a mobile project missing from it is a project '
          + 'those tests silently stop running on.');
    });
});
