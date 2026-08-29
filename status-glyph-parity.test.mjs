/**
 * status-glyph-parity.test.mjs — a decorative glyph stays out of the announcement (v21.85).
 *
 * Run: node --test status-glyph-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * `status-text.js` exists so that `✓ Settings saved` is READ as "Settings saved". Nothing stops the
 * next status line being written the old way: `el.textContent = '✓ Saved'` is shorter, it is what
 * the surrounding code looked like for two years, and it produces pixel-identical output. Neither
 * axe nor a visual baseline nor an e2e assertion can tell the two apart — `textContent` reads back
 * the same string either way, which is deliberate and is exactly why this guard is needed.
 *
 * So the rule is enforced structurally, in the three shapes it can be broken:
 *   1. a served page with the glyph baked into a live region's markup,
 *   2. a module assigning a glyph-leading string straight to `.textContent`,
 *   3. an `innerHTML` template leading with one.
 *
 * ── THE ONE EXEMPTION, AND WHY IT IS BY NAME ────────────────────────────────────────────────────
 *
 * BUTTONS are out of scope: `✓ Resolve` is a stable accessible NAME, announced once when the
 * control is focused, and `getByRole('button', { name })` matches on it. That is a different
 * problem with a different risk, and it was decided separately rather than swept in.
 *
 * The exemption is a NAME match (`btn`/`button`/`chip`), which is loose — someone could call a live
 * region `feedbackBtn` and slip through. That is accepted rather than unnoticed: the alternative is
 * resolving each variable to an element, which no static test can do in this codebase, and the
 * honest comparison is against having no guard at all.
 *
 * ── WIDENED AT v21.94, AFTER IT MISSED TEN LIVE SITES ───────────────────────────────────────────
 *
 * Both JS rules were anchored too tightly to see the shapes the app actually writes:
 *
 *   · Rule 2 required the string literal IMMEDIATELY after the `=`, so **every ternary evaded it**
 *     — and a ternary is the natural way to write "offline, or something else went wrong". Six
 *     live regions were writing a bare glyph through one, including `#alFeedback` / `#sickFeedback`
 *     and the roster review's cross-check note.
 *   · Rule 3 inspected only the FIRST character of an `innerHTML` template, so a glyph one opening
 *     tag in — `'<p class="…">✓ No outstanding requests.'` — was invisible.
 *
 * Both now scan the whole right-hand side / the template past one opening tag. The `<span
 * aria-hidden` opener is skipped deliberately: that IS the fix, so a template starting with it
 * must pass.
 *
 * ── WHAT IT STILL CANNOT SEE, STATED RATHER THAN IMPLIED ────────────────────────────────────────
 *
 * Two shapes remain outside any regex, and both exist in the app today. Neither is a reason to
 * trust the guard less than it deserves; they are the reason not to trust it more:
 *
 *   · **The glyph lives in the DATA, not the template.** `admin-auth.js` builds `✅ Created (3): …`
 *     as a plain string and renders `lines.map(l => \`<p>${escapeHtml(l)}</p>\`)`. The template is
 *     clean; the glyph arrives at runtime.
 *   · **A pure builder returns markup with no assignment target.** `buildActualCheck`
 *     (paycalc-breakdown.js) returns a `<div>` that `calculate()` puts into `#actualVerdict`, which
 *     is `aria-live`. There is nothing here to attribute the return value to, so that one is kept
 *     right by hand and says so in a comment beside it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { STATUS_GLYPHS } from './status-text.js';

const ROOT = new URL('./', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const GLYPH_CLASS = STATUS_GLYPHS.map((g) => g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

/** Comments are stripped first: a long comment quoting a status line must not fail the guard. */
const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const HTML = readdirSync(new URL('./', ROOT))
    .filter((f) => f.endsWith('.html'));
const JS = readdirSync(new URL('./', ROOT))
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'purify.es.mjs');

describe('served markup never bakes a glyph into a live region', () => {
    // The two that were found this way (`#pensionWarn`, `#satWarn`) had been in paycalc.html since
    // before the a11y gate existed, and every automated pass over the app read straight past them:
    // they are correct HTML, they are correctly marked as alerts, and the glyph is real text.
    const LIVE_OPEN = new RegExp(
        `<[^>]*(?:aria-live=|role="(?:status|alert|alertdialog)")[^>]*>\\s*(?:${GLYPH_CLASS})\\s`,
        'g');

    for (const file of HTML) {
        test(file, () => {
            const hits = [...read(file).matchAll(LIVE_OPEN)].map((m) => m[0].slice(0, 110));
            assert.deepEqual(hits, [],
                `wrap the glyph: <span aria-hidden="true">✓</span> — it is decoration, and the text beside it already says what happened`);
        });
    }
});

describe('a status line goes through setStatus, not straight to textContent', () => {
    // The whole right-hand side, up to the statement's `;` — NOT just the token after the `=`.
    // Anchoring on the `=` is what let every ternary through (see the header).
    const ASSIGN = new RegExp(
        `([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*)\\.textContent\\s*=\\s*([^;]{0,600});`, 'gs');
    const LEADING = new RegExp(`(['"\`])\\s?(?:${GLYPH_CLASS})\\s`);
    const BUTTONISH = /btn|button|chip/i;

    for (const file of JS) {
        test(file, () => {
            const offenders = [...stripComments(read(file)).matchAll(ASSIGN)]
                .filter((m) => LEADING.test(m[2]))
                .map((m) => m[1])
                .filter((target) => !BUTTONISH.test(target));
            assert.deepEqual(offenders, [],
                `use setStatus(el, '…') from status-text.js so the leading glyph is not announced`);
        });
    }
});

describe('an innerHTML template wraps its leading glyph', () => {
    // `setStatus` cannot help here — these templates carry markup of their own — so the span is
    // written by hand, and this is what checks it was.
    // Past ONE opening tag, because a glyph is rarely the very first character of a template —
    // `'<p class="…">✓ …'` was the shape that got through. `<span aria-hidden` is skipped: that
    // opener IS the fix, so a template beginning with it must pass.
    const TEMPLATE = new RegExp(
        `\\.innerHTML\\s*\\+?=\\s*(['"\`])((?:\\\\.|(?!\\1)[\\s\\S]){0,200})`, 'g');
    const LEADS_WITH_GLYPH = new RegExp(`^(?:\\s*<(?!span\\s+aria-hidden)[^>]*>\\s*)?\\s?(?:${GLYPH_CLASS})\\s`);

    for (const file of JS) {
        test(file, () => {
            const hits = [...stripComments(read(file)).matchAll(TEMPLATE)]
                .filter((m) => LEADS_WITH_GLYPH.test(m[2]))
                .map((m) => m[0].slice(0, 110));
            assert.deepEqual(hits, [],
                'lead with <span aria-hidden="true">…</span> instead of the bare glyph');
        });
    }
});

test('the helper is actually imported where it is used', () => {
    // A file could call setStatus without importing it — which throws at runtime on the one path
    // that shows a status message, i.e. the error path, i.e. the least-exercised code in the app.
    const missing = [];
    for (const file of JS) {
        const src = read(file);
        if (!/(?:^|[^.\w])setStatus\s*\(/.test(stripComments(src))) continue;
        if (file === 'status-text.js') continue;
        if (!/from '\.\/status-text\.js'/.test(src)) missing.push(file);
    }
    assert.deepEqual(missing, []);
});
