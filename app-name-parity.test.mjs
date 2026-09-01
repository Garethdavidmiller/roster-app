/**
 * app-name-parity.test.mjs — "MYB" may name the STATION. It may never name the SOFTWARE.
 * Run: node --test app-name-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── WHY THIS IS A GATE AND NOT JUST A CONVENTION ────────────────────────────────────────────────
 *
 * CLAUDE.md has said the app's on-screen name is "Marylebone Roster" since v15.05. It was violated
 * twice, and neither was caught by review:
 *
 *   · `MYB Pay Calculator · Printed …` — the paycalc PRINT header, i.e. the one string that leaves
 *     the app on paper and gets handed to somebody.
 *   · `MYB member? Sign in instead` — on the Calendar's staff-PIN card, written v20.12 and caught
 *     by the owner reading the screenshot.
 *
 * A wording rule with no gate drifts, and this is the wording rule most likely to be reintroduced by
 * someone being helpful: "MYB" is genuinely how the station is spoken about all day.
 *
 * ── THE DISTINCTION THIS TEST EXISTS TO HOLD ────────────────────────────────────────────────────
 *
 * **`MYB` is Marylebone's three-letter station code**, and in that sense it is correct, expected and
 * already in the guides — "Chiltern Railways · MYB Station", "Typical MYB — Network-area journeys".
 * Those must NOT be flagged. A blanket "no MYB in copy" test would fire on them, acquire an
 * exemption list, and stop guarding anything — the failure mode this repo has written down more
 * than once.
 *
 * So the rule is scoped to what the letters NAME. `MYB` followed by a word denoting THIS SOFTWARE is
 * the violation; `MYB` followed by anything else is the station and is left alone. That needs no
 * exemption list, which is the property that makes it worth having.
 *
 * ── WHAT IT CANNOT SEE ──────────────────────────────────────────────────────────────────────────
 *
 * Copy assembled at runtime from parts, and copy in a product word this list does not know. It reads
 * source, not a rendered page. It is a floor, not a proof — but the floor covers both real defects.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (/** @type {string} */ f) => readFileSync(new URL(f, import.meta.url), 'utf8');

/** Words that denote THIS SOFTWARE rather than the station. `MYB` before any of these is the app
 *  name; `MYB` before "Station", "staff", a route or nothing is the station code. `member` is here
 *  because "MYB member" means "a member of this app", which is the same mistake in a different
 *  grammar — and is the exact string the owner caught on the staff-PIN card. */
const PRODUCT_WORDS = ['Roster', 'Calendar', 'Pay Calculator', 'Paycalc', 'App', 'app', 'member', 'Member'];

const RE = new RegExp(`\\bMYB\\s+(?:${PRODUCT_WORDS.map(w => w.replace(/ /g, '\\s+')).join('|')})\\b`, 'g');

/** Strip comments — JS block, JS line, and HTML — so the RULE may state the thing it forbids, and so
 *  a file header explaining the convention is not itself a violation. This file is proof that
 *  matters: every paragraph above names the banned strings. */
function code(/** @type {string} */ src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, ' ')
              .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
              .replace(/<!--[\s\S]*?-->/g, ' ')
              // The ONE documented exception, removed STRUCTURALLY — by the attribute, not by a
              // list of files. The iOS home-screen label has ~12 usable characters, so "Marylebone
              // Roster" truncates on the icon to something nobody recognises. Scoped this way, the
              // exemption cannot widen: it covers exactly this meta and nothing else on the page,
              // and a second "MYB Roster" anywhere in the same file is still caught.
              .replace(/<meta[^>]*apple-mobile-web-app-title[^>]*>/g, ' ');
}

/** Everything served to a browser. Test files are excluded — they must be able to name the strings
 *  they assert about, exactly as this one does. */
const SERVED = readdirSync(new URL('.', import.meta.url))
    .filter(f => /\.(html|js)$/.test(f))
    .filter(f => !f.includes('.test.') && f !== 'purify.es.mjs');

describe('"MYB" never names the app', () => {
    // THE MANIFEST IS SERVED TOO, and was outside this guard until v22.13 — it filters on
    // `.html|.js`, so `manifest.json` was never read while carrying "MYB Roster" in BOTH `name`
    // and `short_name`. That is not a stray: `short_name` is the label under the icon on every
    // ANDROID home screen, i.e. the app named itself MYB on the primary platform, and CLAUDE.md
    // said MYB "survives only in the iOS apple-mobile-web-app-title meta and in comments" —
    // a sentence made false by a file the checker could not see.
    //
    // `short_name` is EXEMPT, structurally, by key. It is the same argument the iOS meta rests on:
    // a home-screen label truncates at ~12 characters, so "Marylebone Roster" arrives as something
    // nobody recognises. `name` has no such limit — it is the install prompt and the app-info
    // screen — so the rule applies to it in full.
    test('the manifest does not call the software MYB anything', () => {
        const m = JSON.parse(read('./manifest.json'));
        const { short_name: _exempt, ...rest } = m;
        const offenders = [];
        for (const [k, v] of Object.entries(rest)) {
            if (typeof v !== 'string') continue;
            for (const hit of v.matchAll(RE)) offenders.push(`manifest.json ${k}: "${hit[0]}"`);
        }
        assert.deepEqual(offenders, [],
            'MYB may name the STATION, never the SOFTWARE — short_name is the one exempt key');
        assert.match(m.short_name, /^MYB /,
            'if short_name stops needing the truncation exemption, drop it from this test too');
    });

    test('no served file calls the software MYB anything', () => {
        /** @type {string[]} */
        const offenders = [];
        for (const f of SERVED) {
            const src = code(read('./' + f));
            for (const m of src.matchAll(RE)) {
                const line = src.slice(0, m.index).split('\n').length;
                offenders.push(`${f}:${line}  "${m[0]}"`);
            }
        }
        assert.deepEqual(offenders, [],
            'the app is called "Marylebone Roster" on screen — "MYB" names the STATION, never the '
            + 'software (CLAUDE.md → staff-facing wording conventions):\n  ' + offenders.join('\n  '));
    });

    test('the STATION CODE is untouched — the guides still say MYB, and must', () => {
        // Guard the guard, and guard the distinction. If this ever fails, the rule above has been
        // broadened into the blanket version that would have people "correcting" a correct railway
        // station code out of an operational reference sheet.
        const guides = ['./guide.html', './railcard-guide.html'].map(read).join('\n');
        assert.match(guides, /MYB Station/, 'the guide masthead lost the station code');
        assert.ok(/\bMYB\b/.test(code(read('./railcard-guide.html'))),
            'the railcard guide no longer uses the station code in its journey guidance');
    });

    test('the iOS home-screen title is the one place the app may be MYB', () => {
        // Deliberately exempt and worth stating: the home-screen label has ~12 usable characters, so
        // "Marylebone Roster" truncates to something unrecognisable on the icon.
        const idx = read('./index.html');
        assert.match(idx, /apple-mobile-web-app-title/,
            'the iOS home-screen title is gone — the icon label would fall back to the long name');
    });

    test('the pattern still catches both historical defects', () => {
        // Teeth, stated rather than assumed. Both strings shipped; a regex edit that stopped matching
        // them would leave this file passing for ever while guarding nothing.
        for (const shipped of ['MYB Pay Calculator · Printed 3 Jul 2026',
                               'MYB member? Sign in instead',
                               'Welcome to the MYB Roster app']) {
            RE.lastIndex = 0;
            assert.ok(RE.test(shipped), `the pattern no longer catches: ${shipped}`);
        }
        // ...and still lets the station code through.
        for (const fine of ['Chiltern Railways · MYB Station',
                            'Typical MYB — Network-area journeys',
                            'trains from MYB to Banbury']) {
            RE.lastIndex = 0;
            assert.equal(RE.test(fine), false, `the pattern wrongly flags the station code: ${fine}`);
        }
    });
});
