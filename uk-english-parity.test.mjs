/**
 * uk-english-parity.test.mjs — the app speaks UK English (owner, 3 Nov 2026).
 * Run: node --test uk-english-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── WHY THIS IS A GATE AND NOT JUST A CONVENTION ────────────────────────────────────────────────
 *
 * The owner asked for UK English "when communicating with me and throughout the app". Measured that
 * day, the app already was: every page, guide, notification and the text of all 27 PDFs in the Links
 * 26 pack held no American spelling. The only American forms were a handful of developer comments
 * and one console message, all corrected in the same commit. So this gate does not fix anything; it
 * keeps a property that has so far held only because nobody broke it. A wording rule with no gate
 * drifts (app-name-parity.test.mjs has the history), and this is the drift most likely to arrive
 * by accident, since most tools and much code-adjacent writing default to American spelling.
 *
 * ── WHAT IT CAN AND CANNOT SEE ──────────────────────────────────────────────────────────────────
 *
 * It reads SOURCE with comments stripped: the copy staff see is in markup and string literals, and
 * a comment is free to quote an API or a browser's own message. It flags only words that are
 * American spellings and NOTHING ELSE in this codebase — no platform or library defines them as a
 * name. That is why `color` and `center` are not on the list (CSS defines both, as a property and
 * a value), nor `math` (Python's module), `program` (correct in UK English for software), `toward`
 * (both are UK English) or `license` (the verb is spelt so in UK English too). `behavior` IS a
 * platform name (`scrollIntoView({ behavior })`, `scroll-behavior`), so it is checked only where
 * it cannot be one: not followed by a colon and not part of a hyphenated property.
 * Copy assembled from parts at runtime, a word this list does not know, and the rendered page are
 * outside it. It is a floor, not a proof.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (/** @type {string} */ f) => readFileSync(new URL(f, import.meta.url), 'utf8');

/** American spellings with a UK form, none of them a name any API in this codebase defines. Each
 *  entry is a whole word with its own endings, because a shared ending list cannot know that UK
 *  English also writes "enrolled", "travelling" is the UK form of "traveling", and so on. */
const US_ONLY = [
    'favorites?', 'favor(?:s|ed|ing)?', 'honor(?:s|ed|ing|able)?', 'labor(?:s|ed)?', 'neighbor(?:s|hood|hoods|ing)?',
    'humor(?:s|ed)?', 'rumor(?:s|ed)?', 'flavor(?:s|ed)?', 'theaters?', 'catalogs?', 'defenses?', 'offenses?',
    'canceled', 'canceling', 'cancelation', 'traveled', 'traveling', 'travelers?', 'labeled', 'labeling',
    'modeled', 'modeling', 'enrolls?', 'enrollments?', 'jewelry', 'aluminum', 'judgments?', 'acknowledgments?',
    'gray(?:s|ed|er|est|ish)?',
    // Two the audit walked through (test audit, 7 Nov 2026). `color` itself stays off — CSS defines
    // it — but no platform defines `colored` or `colorful`. `authorization` stays off too: it is the
    // HTTP header's own name (`Authorization: Bearer …`), as `unauthorized` is Firebase's error code.
    'color(?:ed|ing|ful|less|s)', 'authoriz(?:e|es|ed|ing)',
    // the -ize and -yze verbs; UK English writes -ise and -yse throughout this app
    '(?:organi|recogni|reali|customi|prioriti|summari|minimi|maximi|apologi|finali|optimi|standardi|analy'
        + '|initiali|personali|categori|emphasi|memori|utili|critici|synthesi)z(?:e|es|ed|ing|ation|ations|er|ers)',
];
/** A word after `.`, `$`, `#` or `-` is a name, not copy: `dataset.initialized`, `--ease-emphasized`. */
const US_RE = new RegExp(`(?<![.$#-])\\b(?:${US_ONLY.join('|')})\\b`, 'gi');
/** `behavior` as a WORD, never as the platform's name for it (an object key, a CSS property). */
const BEHAVIOR_RE = /(?<![-\w$.`])behaviors?\b(?!\s*:)(?![-`])/gi;
/** A US locale handed to a formatter writes dates month-first and times on the 12-hour clock. */
const LOCALE_RE = /\b(?:toLocale\w*|DateTimeFormat|NumberFormat|Collator|PluralRules|RelativeTimeFormat|ListFormat)\(\s*(['"`])en-US\1/g;
/** NO locale at all is the same defect on any phone set to US English — the device's own locale is
 *  used — and passed until the test audit (7 Nov 2026): `new Date().toLocaleTimeString()` reads
 *  "2:05:00 PM" in this very container. Empty brackets, or `undefined`/`[]` where the locale goes. */
const NO_LOCALE_RE = /\b(?:toLocale(?:Date|Time)?String|DateTimeFormat|NumberFormat)\(\s*(?:\)|undefined\b|\[\s*\])/g;
/** A language tag of US English on generated markup (a page, a deck's text run): spell-checkers and
 *  screen readers act on it. The decks carried one on every run until 3 Nov 2026 (deck-polish.py). */
const LANG_RE = /\b(?:lang|altLang|xml:lang)=\\?(['"])en-US\\?\1/g;

/** Strip comments — JS block and line, HTML, CSS, Python — so a comment may quote what it must
 *  (an API name, a browser's error text). The `//` rule spares `https://`, as app-name-parity does. */
function code(/** @type {string} */ src, /** @type {string} */ file) {
    let s = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
    if (file.endsWith('.py')) return s.replace(/(^|\s)#[^\n]*/g, '$1');
    return s.replace(/(^|[^:\\'"])\/\/[^\n]*/g, '$1 ');
}

const ROOT = new URL('.', import.meta.url);
const list = (/** @type {string} */ dir, /** @type {RegExp} */ re) =>
    readdirSync(new URL(dir, ROOT)).filter(f => re.test(f) && !f.includes('.test.')).map(f => dir + f);
/** Everything staff see or receive: every served page, module, style sheet and the manifest; the
 *  Cloud Functions, which write notifications and messages; and the scripts that write the Links
 *  26 pack's sheets and read-me. Test files are excluded: they must be able to name what they test. */
const FILES = [
    ...list('./', /\.(html|js|css)$/).filter(f => f !== './purify.es.mjs'),
    './manifest.json',
    ...list('./functions/', /\.js$/),
    ...list('./docs/links-26/tooling/', /\.(mjs|py)$/),
];

/** Every hit in one source, as "file:line  word". */
function hits(/** @type {string} */ file, /** @type {string} */ src) {
    const out = [];
    // NO_LOCALE_RE is about what the APP shows. The Links 26 tooling's bare `toLocaleString()` prints
    // a count of searched tables to the developer's own terminal, which is not copy anybody receives.
    const res = [US_RE, BEHAVIOR_RE, LOCALE_RE, LANG_RE, ...(file.startsWith('./docs/') ? [] : [NO_LOCALE_RE])];
    for (const re of res) for (const m of src.matchAll(re)) {
        out.push(`${file.replace(/^\.\//, '')}:${src.slice(0, m.index).split('\n').length}  "${m[0]}"`);
    }
    return out;
}

describe('the app speaks UK English', () => {
    test('the matcher catches what it should and spares the platform\'s own names', () => {
        // Guard the guard: a list that matched nothing would pass a page full of American spelling.
        assert.deepEqual(hits('x', 'Your favorite shift was canceled; we organized it').length, 3);
        assert.deepEqual(hits('x', 'the menu’s behavior on a phone').length, 1);
        assert.deepEqual(hits('x', 'd.toLocaleDateString("en-US", opts)').length, 1);
        assert.deepEqual(hits('x', '<a:rPr lang="en-US" sz="1400">').length, 1);
        // deck-polish.py's own detector names the tag it converts, inside a pattern: that is not a tag
        assert.deepEqual(hits('x', `US_LANG = re.compile(r'\\b(lang|altLang)="en-US"')`), []);
        assert.deepEqual(hits('x', "el.scrollIntoView({ behavior: 'smooth' }); html { scroll-behavior: auto }"), []);
        assert.deepEqual(hits('x', 'colour, behaviour, cancelled, organised, analyse, grey, favourite'), []);
        assert.deepEqual(hits('x', 'size, prize, seize, travelling, labelled, enrolled'), []);
        // The test audit's additions (7 Nov 2026), and the platform names beside them they must spare.
        assert.deepEqual(hits('x', 'a colored bar; not authorized to edit').length, 2);
        assert.deepEqual(hits('x', "headers: { Authorization: 'Bearer x' }; err.code === 'storage/unauthorized'; @media (forced-colors: active) { a { color: red } }"), []);
        assert.deepEqual(hits('x', 'p.textContent = new Date().toLocaleTimeString(); n.toLocaleString(undefined, o)').length, 2);
        assert.deepEqual(hits('x', "d.toLocaleTimeString('en-GB', { hour: '2-digit' }); n.toLocaleString('en-GB')"), []);
    });

    test('every page, and the offline page the service worker writes, declares UK English', () => {
        // lang="en" left the variety to the browser: British English spell-checks what staff type,
        // and picks the voice a screen reader uses, only when the page says en-GB (3 Nov 2026).
        const pages = FILES.filter(f => f.endsWith('.html'));
        assert.ok(pages.length > 10, `found only ${pages.length} pages`);
        const wrong = [...pages, './service-worker.js'].filter(f => !/<html lang="en-GB">/.test(read(f)));
        assert.deepEqual(wrong, [], 'each of these opens without <html lang="en-GB">:\n  ' + wrong.join('\n  '));
        assert.equal(JSON.parse(read('./manifest.json')).lang, 'en-GB', 'the manifest’s lang is not en-GB');
    });

    test('no American spelling in anything staff see or receive', () => {
        assert.ok(FILES.length > 100, `read only ${FILES.length} files — the guard is checking almost nothing`);
        const offenders = FILES.flatMap(f => hits(f, code(read(f), f)));
        assert.deepEqual(offenders, [],
            'the app is written in UK English (owner, 3 Nov 2026; CLAUDE.md → How to work with the\n' +
            'owner): colour, behaviour, cancelled, organise, analyse, grey, favourite, 3 November 2026,\n' +
            '24-hour times. A name a platform defines (CSS `color`) is not copy and is not on the list:\n  ' +
            offenders.join('\n  '));
    });
});
