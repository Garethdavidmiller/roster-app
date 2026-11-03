/**
 * page-identity-parity.test.mjs — each page's colour is declared ONCE, and everything that wears it
 * agrees (v25.14). No browser: it reads the served stylesheets and the drawer's page list.
 *
 * WHY THIS FILE EXISTS. Until v25.14 every page restated its colour in two hand-written rules — the
 * header badge and the About badge — and the copies had already drifted: Links' About badge had a
 * full-strength border where every other page's was a 35% tint. v25.14 made the colour three tokens
 * each page declares in its own `:root` (shared.css → "Page identity"), read by the header badge,
 * the About badge, a picker sheet's current row and — since v25.16 — every chosen control. Four
 * things keep that true, one test each:
 *
 *   1. Every card page declares the whole trio, once, at the top level of its own stylesheet. A
 *      missing token is not an error anything reports — the browser falls back to the default, so a
 *      page that forgot `--page-accent-text` reads its About badge in the Calendar's gold on its own
 *      tint, and looks nearly right.
 *   2. No page stylesheet restates a badge's colour. That is exactly the drift the trio replaced,
 *      and it comes back one well-meant rule at a time.
 *   3. The colour a page declares is the colour of the drawer pill that takes you there. The pill you
 *      tap and the badge you arrive at are one identity held in two hand-written places — the page
 *      stylesheets and the drawer's pill rules — so only a check keeps them in step.
 *   4. A CHOSEN control fills with its page's colour (v25.16). Before, a chosen tab was navy on most
 *      pages, raspberry on one Trains row and a gold tint on Links, so one screen could show two
 *      colours for one idea — the owner's screenshots showed Trains' raspberry view above a navy day.
 *      Each chosen colour was right where it was written; only reading them all together showed the
 *      drift, so that is what the test does. A choice with a MEANING (a shift type, yes or no) keeps
 *      its meaning's colour, and is named below with the reason.
 *
 * Admin is the one exception to 2 and 3, by decision: its header badge and its drawer pill are navy
 * with gold text rather than a gold fill (admin.css → #adminBadge says why). It still declares the
 * trio, because its About badge and its chosen controls are gold like everything else gold.
 *
 * Part of `npm run test:hygiene`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cardPageFiles, pageStylesheets } from './scripts/app-pages.mjs';

const read = (/** @type {string} */ f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
const stripComments = (/** @type {string} */ css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const TRIO = ['--page-accent', '--page-accent-ink', '--page-accent-text'];
const SHEETS = pageStylesheets();
const CARD_PAGES = cardPageFiles();

/** The one page whose badge and pill are worn differently, and why: see the header above. */
const WORN_DIFFERENTLY = 'admin.html';

/**
 * Every rule in a stylesheet, with its nesting depth — a small brace walker, enough for this
 * repo's CSS (no braces inside strings). `@media` blocks come back as rules too, and the rules
 * inside them carry depth 1.
 * @param {string} css
 * @returns {Array<{ selector: string, body: string, depth: number }>}
 */
function rules(css) {
    const s = stripComments(css);
    /** @type {Array<{ selector: string, body: string, depth: number }>} */
    const out = [];
    /** @type {Array<{ selector: string, start: number }>} */
    const open = [];
    let preludeStart = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '{') {
            open.push({ selector: s.slice(preludeStart, i).trim(), start: i + 1 });
            preludeStart = i + 1;
        } else if (c === '}') {
            const block = open.pop();
            if (block) out.push({ selector: block.selector, body: s.slice(block.start, i), depth: open.length });
            preludeStart = i + 1;
        } else if (c === ';') {
            preludeStart = i + 1;
        }
    }
    return out;
}

/**
 * The page-identity tokens a stylesheet declares in a TOP-LEVEL `:root`, name → value text. A
 * `:root` inside a media query is deliberately not read: the colour would hold at some widths only.
 * @param {string} css
 */
function declaredTrio(css) {
    /** @type {Record<string, string>} */
    const found = {};
    for (const r of rules(css)) {
        if (r.depth !== 0 || r.selector !== ':root') continue;
        for (const m of r.body.matchAll(/(--page-accent(?:-ink|-text)?)\s*:\s*([^;]+);/g)) found[m[1]] = m[2].trim();
    }
    return found;
}

/** A top-level rule's declared value for one property, or undefined. */
function declared(/** @type {string} */ css, /** @type {string} */ selector, /** @type {string} */ prop) {
    const rule = rules(css).find(r => r.depth === 0 && r.selector === selector);
    const m = rule && new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+);`).exec(rule.body);
    return m ? m[1].trim() : undefined;
}

test('shared.css declares the page-identity defaults, and they are the Calendar\'s gold', () => {
    const base = declaredTrio(read('shared.css'));
    assert.deepEqual(Object.keys(base).sort(), [...TRIO].sort(),
        'shared.css :root must declare all three defaults — every rule that wears a page colour reads them');
});

test('shared.css\'s badge rules and the picker\'s current row read the page\'s tokens', () => {
    // The other half of the wiring. The page declares; these rules must READ — a badge rule that
    // went back to a literal gold would make every page gold while every declaration stayed right.
    const shared = read('shared.css');
    assert.equal(declared(shared, '.badge-page', 'background'), 'var(--page-accent)');
    assert.equal(declared(shared, '.badge-page', 'color'), 'var(--page-accent-ink)');
    assert.equal(declared(shared, '.lightbox-badge', 'color'), 'var(--page-accent-text)');
    assert.match(declared(shared, '.lightbox-badge', 'background') ?? '', /var\(--page-accent\)/);
    // A picker sheet's current row (v25.16 — both were the Calendar's gold on every page). The tint
    // is mixed with WHITE: an oklch mix towards --surface drags every tint blue.
    assert.match(declared(shared, '.picker-opt.is-current', 'background') ?? '',
        /^color-mix\(in oklch, var\(--page-accent\) \d+%, white\)$/,
        'the current row is a pale tint of the page\'s colour, mixed with white');
    assert.equal(declared(shared, '.picker-opt-tick', 'color'), 'var(--page-accent-text)',
        'the tick beside the current row is the page\'s colour as text — the token made for text on its own tint');
});

test('every card page declares its colour — all three tokens, once — at the top of its own stylesheet', () => {
    for (const page of CARD_PAGES) {
        const css = read(SHEETS[page]);
        const trio = declaredTrio(css);
        const missing = TRIO.filter(t => !(t in trio));
        assert.deepEqual(missing, [],
            `${SHEETS[page]} must declare ${missing.join(', ')} in a top-level :root. A missing token is ` +
            'silently the default — the Calendar\'s gold — so the page looks nearly right and is not.');
        for (const t of TRIO) {
            const count = [...stripComments(css).matchAll(new RegExp(`${t}\\s*:`, 'g'))].length;
            assert.equal(count, 1, `${SHEETS[page]} declares ${t} ${count} times — a page's colour is declared once`);
        }
    }
});

test('no page stylesheet restates a badge colour — the shared rules read the page\'s tokens', () => {
    // The header badge ids are read from the pages themselves, not listed here, so a page added
    // later is covered the day it ships.
    const ids = CARD_PAGES.flatMap(p => [...read(p).matchAll(/class="badge-page"[^>]*\bid="([\w-]+)"/g)].map(m => m[1]));
    assert.ok(ids.length >= CARD_PAGES.length, `expected a header badge on every card page, found ${ids.join(', ')}`);
    const BADGE = new RegExp(`\\.lightbox-badge|\\.badge-page|${ids.map(id => `#${id}\\b`).join('|')}`);
    const COLOUR = /(?:^|[;\s])(?:background(?:-color)?|color|border(?:-color)?)\s*:/;
    const offenders = [];
    for (const sheet of new Set(Object.values(SHEETS))) {
        for (const r of rules(read(sheet))) {
            if (r.selector.startsWith('@') || !BADGE.test(r.selector) || !COLOUR.test(r.body)) continue;
            if (sheet === SHEETS[WORN_DIFFERENTLY] && r.selector === '#adminBadge') continue;
            offenders.push(`${sheet}: ${r.selector}`);
        }
    }
    assert.deepEqual(offenders, [],
        'a page sets its colour in its :root trio, and shared.css\'s badge rules read it. A page rule ' +
        'colouring a badge is the hand-written copy the trio replaced, and copies drift.');
});

test('the colour a page declares is the colour of the drawer pill that takes you there', () => {
    // The drawer's page list is read as TEXT: nav-panel.js is a browser module and is not imported.
    const nav = read('nav-panel.js');
    /** @type {Record<string, string>} */
    const pillFor = {};
    for (const m of nav.matchAll(/url:\s*'\.\/([\w-]*\.html)?'\s*,\s*colorClass:\s*'(nav-panel-pill--[\w-]+)'/g)) {
        pillFor[m[1] || 'index.html'] = m[2];
    }
    const shared = read('shared.css');
    const base = declaredTrio(shared);
    const pages = ['index.html', ...CARD_PAGES.filter(p => p !== WORN_DIFFERENTLY)];
    for (const page of pages) {
        const pill = pillFor[page];
        assert.ok(pill, `${page} has no drawer pill in nav-panel.js's NAV_PAGES`);
        // The Calendar declares nothing: its colour IS the shared default.
        const trio = page === 'index.html' ? base : declaredTrio(read(SHEETS[page]));
        assert.equal(declared(shared, `.${pill}`, 'background'), trio['--page-accent'],
            `${page}: the drawer pill .${pill} and the page's --page-accent must be the same colour`);
        assert.equal(declared(shared, `.${pill}`, 'color'), trio['--page-accent-ink'],
            `${page}: the drawer pill's text and the page's --page-accent-ink must match`);
    }
});

// ── 4. A chosen control wears its page's colour ──────────────────────────────────────────────────

/** What says "this one is chosen" in a selector: the pressed, selected and checked states, and the
 *  classes the pages use for the same idea. `.is-current-week` is a marker, not a choice, and the
 *  lookahead keeps it out. `--on` and `.compare-active` joined at v25.20: Operations' month toggle and
 *  Links' compare-mode tile were still navy and gold after v25.16, unseen, because the walk could not
 *  read how they spelled "chosen". The date pickers' chosen day, week and range and Trains' chosen
 *  column joined at v25.21, when they took the page's colour (until then they were navy, outside it). */
const CHOSEN = /\[aria-(?:pressed|selected|checked)="true"\]|\.(?:active|is-active|is-on|is-chosen|is-current|compare-active|dp-sel|dp-inweek|rp-from|rp-to|rp-in-range|tr-col-on)(?![\w-])|--(?:active|on)(?![\w-])/;

/** A rule FILLS a control when it declares a background. A ring, an edge or a text colour is not a
 *  fill, and the brush chips' armed ring (links.css) is one of those, deliberately. */
const FILL = /(?:^|[;\s])background(?:-color)?\s*:\s*([^;]+)/;

/**
 * Every chosen fill that does NOT read --page-accent, by stylesheet and exact selector, each with its
 * reason. A selector here that stops existing fails the test too, so the list cannot outlive its rules.
 */
const MEANING = {
    'admin.css': {
        'a shift TYPE: the colour is the type, the same one the Calendar shows for that day': [
            '.pill-shift.active', '.pill-rdw.active', '.pill-annual_leave.active', '.pill-sick.active',
            '.pill-correction.active', '.pill-other.active',
        ],
        'an Other flavour: a kind of day, coloured as that kind of day (Spare is purple everywhere)': [
            '.other-flavour-btn.active', '.other-flavour-spare.active',
        ],
        'an answer about ANNUAL LEAVE (was this day swapped? which year\'s allowance?), in leave\'s own colour': [
            '.al-swap-btn[aria-pressed="true"]', '.swapday-opt[aria-pressed="true"]', '.leaveyear-opt[aria-pressed="true"]',
        ],
        'the week grid\'s ROW being edited: a row state, not a chosen control': [
            '.day-row.active', '.day-row.has-override.active', '.day-row.active .overwrite-badge',
        ],
    },
    'operations.css': {
        'a shift TYPE: the colour is the type — Admin\'s pills, held to the same tokens by the test below': [
            '.roster-entry-pill.is-on[data-entry-type="annual_leave"]', '.roster-entry-pill.is-on[data-entry-type="shift"]',
            '.roster-entry-pill.is-on[data-entry-type="rdw"]', '.roster-entry-pill.is-on[data-entry-type="sick"]',
            '.roster-entry-pill.is-on[data-entry-type="correction"]', '.roster-entry-pill.is-on[data-entry-type="other"]',
        ],
        'an answer about ANNUAL LEAVE (was this day swapped?), in leave\'s own colour, as on Admin': [
            '.roster-entry-swap-btn.is-on', '.roster-choice-btn[data-swap].is-chosen',
        ],
        'an Other flavour: a kind of day, coloured as that kind of day': ['.roster-entry-flavour.is-on'],
        'enter or skip an unreadable cell: green for the one that writes, grey for the one that does not': [
            '.roster-choice-btn.is-chosen', '.roster-choice-btn--skip.is-chosen',
        ],
        'a choice the review has BLOCKED: sunken, because it cannot be acted on': [
            '.roster-blocked .roster-choice-btn.is-chosen', '.roster-blocked .roster-choice-btn[data-swap].is-chosen',
        ],
    },
    'trains.css': {
        'a chosen COLUMN of times: a light tint down the table so the times stay readable; its heading\'s underline wears the page colour': [
            '.tr-grid .tr-col-on',
        ],
    },
    'overtime.css': {
        'available or not: a yes and a no, which are not the same kind of answer': [
            '.ot-mode--yes[aria-checked="true"]', '.ot-mode--no[aria-checked="true"]',
        ],
        'a FOLDER tab: the chosen tab is the card surface it opens onto, joined to the panel below': [
            '.ot-tab[aria-selected="true"]',
        ],
    },
};

/** `sel` with every `:not(...)` removed — a `:not(.active)` hover rule is about the UNCHOSEN ones. */
function dropNot(/** @type {string} */ sel) {
    let out = '';
    for (let i = 0; i < sel.length;) {
        if (sel.startsWith(':not(', i)) {
            let depth = 0, j = i + 4;
            for (; j < sel.length; j++) {
                if (sel[j] === '(') depth++;
                else if (sel[j] === ')' && --depth === 0) break;
            }
            i = j + 1;
        } else out += sel[i++];
    }
    return out;
}

/** A selector list split at its top-level commas. */
function selectorsOf(/** @type {string} */ list) {
    const out = []; let depth = 0, cur = '';
    for (const ch of list) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim());
    return out;
}

test('a chosen control fills with its page\'s colour — or is a choice with a meaning, named here', () => {
    const sheets = new Set(['shared.css', ...Object.values(SHEETS)]);
    const offenders = [], seen = new Set();
    let accented = 0;
    for (const sheet of sheets) {
        for (const r of rules(read(sheet))) {
            if (r.selector.startsWith('@')) continue;
            const fill = FILL.exec(r.body);
            if (!fill) continue;
            for (const sel of selectorsOf(r.selector)) {
                if (!CHOSEN.test(dropNot(sel))) continue;
                // A pseudo-element is drawn ON the control — today's dot on a chosen date — not the
                // control's fill, so it is not what this rule is about (v25.21).
                if (/::?(?:before|after)\b/.test(sel)) continue;
                // NEVER NAVY, exceptions included: navy is the colour of a button that does something,
                // and a chosen state in it is the very confusion this rule ended. A named exception is
                // trusted with its colour, but not with that one.
                if (/var\(--primary-blue/.test(fill[1])) { offenders.push(`${sheet}: ${sel} → ${fill[1].trim()} (navy)`); continue; }
                if (/var\(--page-accent\)/.test(fill[1])) { accented++; continue; }
                const named = Object.values(MEANING[sheet] ?? {}).some(list => list.includes(sel));
                if (named) seen.add(`${sheet} ${sel}`);
                else offenders.push(`${sheet}: ${sel} → ${fill[1].trim()}`);
            }
        }
    }
    assert.deepEqual(offenders, [],
        'a chosen control fills with var(--page-accent) and takes var(--page-accent-ink) for its text ' +
        '(shared.css → "CHOSEN = THE PAGE\'S COLOUR"). Navy is for a button that DOES something, so a ' +
        'navy chosen state looks like an action. If this choice has a MEANING of its own — a shift ' +
        'type, a yes or a no — add it to MEANING in this file with the reason.');
    const stale = Object.entries(MEANING).flatMap(([sheet, groups]) =>
        Object.values(groups).flat().map(sel => `${sheet} ${sel}`)).filter(k => !seen.has(k));
    assert.deepEqual(stale, [], 'these exceptions no longer match a chosen fill in their stylesheet — remove them');
    assert.ok(accented >= 15, `only ${accented} chosen fills read --page-accent — the walk has stopped finding them`);
});

// ── 5. A shift type is ONE colour on both pages ──────────────────────────────────────────────────

test('Operations\' type pills wear Admin\'s type colours, type by type — idle and chosen', () => {
    // v25.21: from v25.16 every chosen type in Operations' hand-entry box was the page's orange, so a
    // chosen AL was orange there and teal in Change a Shift. The two pages restate the mapping (one
    // keyed on `.pill-<type>`, the other on `data-entry-type`), and a copy is what stops matching —
    // so the tokens are compared here, for every type Admin colours.
    const admin = read('admin.css'), ops = read('operations.css');
    const adminTypes = [...admin.matchAll(/\.pill-([a-z_]+)\.active\s*\{\s*background:\s*(var\(--[\w-]+\))/g)];
    assert.ok(adminTypes.length >= 6, `found only ${adminTypes.length} of Admin's type colours — the pattern has stopped matching`);
    for (const [, type, fill] of adminTypes) {
        const idle = new RegExp(`\\.pill-${type}\\s*\\{\\s*color:\\s*(var\\(--[\\w-]+\\))`).exec(admin)?.[1];
        const opsFill = new RegExp(`\\.roster-entry-pill\\.is-on\\[data-entry-type="${type}"\\]\\s*\\{\\s*background:\\s*(var\\(--[\\w-]+\\))`).exec(ops)?.[1];
        const opsIdle = new RegExp(`\\.roster-entry-pill\\[data-entry-type="${type}"\\]\\s*\\{\\s*color:\\s*(var\\(--[\\w-]+\\))`).exec(ops)?.[1];
        assert.equal(opsFill, fill, `a chosen ${type} pill is ${fill} on Admin and ${opsFill ?? 'not coloured'} in Operations' hand entry`);
        assert.equal(opsIdle, idle, `an idle ${type} pill's text is ${idle} on Admin and ${opsIdle ?? 'not coloured'} in Operations' hand entry`);
    }
});
