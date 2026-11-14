// guide-app-parity.test.mjs — the Staff & Admin Guide restates lists the app keeps in ONE place.
//
// ── WHY THIS EXISTS (v25.82) ────────────────────────────────────────────────────────────────────
//
// The guide is prose, and nothing compared it with the code it describes, so it fell behind three
// times without anything failing: the staff PIN began opening Trains (v24.84) and the guide's PIN
// paragraph — and the Calendar's own sign-in card — still listed "the guides" instead, which are
// open to everybody; Trains joined every member's menu (v24.81) and the guide's list of pages
// never heard; and the Admin button "Rest Day" kept the label "Rest" in the guide's table. Each was
// caught by a person reading the guide against the app. Each check below reads the app's OWN list
// and fails, naming the line to update, when the two disagree. A fact said in two places drifts;
// this is the pattern that keeps the second place honest (a parity test).
//
//  1. THE STAFF PIN. auth-policy.js → PAGE_POLICIES says which pages the PIN opens (`staffPin`).
//     The guide's PIN paragraph ([data-staff-pin]) and the Calendar card's hint must name each of
//     them in the sentence that says what the PIN opens, and must not name a page that is open to
//     everyone anyway: listing it reads as "you need the PIN for this". The paragraph must also name,
//     where it says what the PIN does NOT open, every page in every member's menu that asks for a
//     sign-in — the three a PIN visitor will meet and be turned away from.
//  2. THE MENU. nav-panel.js → NAV_PAGES: every page pill shown to every member (no `…Only` gate) is
//     named in the guide's "Pages" tile ([data-menu-pages]), and no gated one is — those are the
//     tile's "any others you have access to". Both directions, for the PIN lists too: a page that
//     stops being everyone's, or that the PIN stops opening, fails as surely as one added.
//  3. THE ADMIN TYPE BUTTONS. admin-shift-types.js → PILL_TYPES and each type's `pill` label: the
//     Shift Types table, the Change a Shift step and the Apply to Several Days step name the buttons
//     by their own labels, in their own order (the bulk bar has no Other — admin.md says why).
//  4. THE LATEST DOCUMENTS. nav-panel.js → NAV_INFORMATION: the guide's Latest tile ([data-menu-latest])
//     and the welcome email's "All under the ☰ menu" line name exactly those, in menu order. The
//     Newsletter's row shows only while its latest issue is under six weeks old (newsletter-recency.js,
//     owner, 14 Nov 2026), and static copy cannot read a date, so both say so in the same words, and
//     every place that states the window says the number of weeks NEWSLETTER_RECENT_DAYS holds.
//     (welcome-email-parity.test.mjs carries the general template's line to the three ready copies.)
//
// Part of `npm run test:hygiene`. A failure here means the GUIDE is out of date, or the app changed
// on purpose and the guide must follow in the same release — never "loosen the test".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PAGE_POLICIES } from './auth-policy.js';
import { TYPES, PILL_TYPES } from './admin-shift-types.js';
import { NEWSLETTER_RECENT_DAYS } from './newsletter-recency.js';

const read = (/** @type {string} */ f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
const GUIDE = read('staff-guide.html');

/** Visible text of an HTML fragment: tags dropped, the entities this guide uses decoded. */
function text(/** @type {string} */ html) {
    return html.replace(/<[^>]+>/g, '')
        .replace(/&rsquo;|&lsquo;/g, '’').replace(/&ldquo;|&rdquo;/g, '"')
        .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&rarr;/g, '→')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ').trim();
}

/** The element carrying `attr`, as visible text. Throws if the anchor has gone. */
function marked(/** @type {string} */ attr) {
    const m = GUIDE.match(new RegExp(`<(p|span|div)\\b[^>]*\\b${attr}\\b[^>]*>([\\s\\S]*?)</\\1>`));
    assert.ok(m, `staff-guide.html has no element marked ${attr} — the anchor this test reads has gone`);
    return text(m[2]);
}

/** What a sentence says the PIN opens: from "opens" to the end of that sentence. */
const opensClause = (/** @type {string} */ t) => t.match(/\bopens\b([^.]*)\./)?.[1] ?? '';
/** What it says the PIN does not open: from "doesn't open" / "does not open" to the sentence end. */
const notOpenClause = (/** @type {string} */ t) => t.match(/\b(?:doesn’t|doesn't|does not) open\b([^.]*)\./)?.[1] ?? '';

/** How a reader names each page in prose. A page the PIN starts to open must be added here. */
const READER_WORD = Object.freeze({
    calendar: 'roster',     // the guide and the card say "the roster"
    trains: 'Trains',
    guides: 'guides',
});

/** The page pills, read from nav-panel.js's own list: { id, name, gated }. */
function navPages() {
    const block = read('nav-panel.js').match(/const NAV_PAGES = \[([\s\S]*?)\n\];/);
    assert.ok(block, 'NAV_PAGES not found in nav-panel.js');
    return block[1].split('\n').filter(l => /\bid:\s*'/.test(l)).map(l => {
        const id = l.match(/\bid:\s*'([a-z]+)'/)?.[1];
        // The label is the emoji, a space, then the name: "💷 Pay", "🔁 New link".
        const name = l.match(/\blabel:\s*'[^\s']+\s+([^']+)'/)?.[1];
        assert.ok(id && name, `a NAV_PAGES entry this test cannot read — re-anchor it:\n  ${l.trim()}`);
        return { id, name: name.trim(), gated: /\w+Only:\s*true/.test(l) };
    });
}

const PIN_PAGES = Object.keys(PAGE_POLICIES).filter(p => PAGE_POLICIES[p].staffPin === true);
const PUBLIC_PAGES = Object.keys(PAGE_POLICIES).filter(p => !PAGE_POLICIES[p].requireNamed && !PAGE_POLICIES[p].staffPin);

test('the anchors this test reads are where it thinks they are', () => {
    assert.ok(PIN_PAGES.length >= 2, `PAGE_POLICIES lists ${PIN_PAGES.length} PIN pages — re-anchor this test`);
    assert.ok(PUBLIC_PAGES.includes('guides'), 'the guides are no longer a public page — re-read this test');
    assert.ok(navPages().length >= 5, 'NAV_PAGES read as fewer than five pills — re-anchor this test');
});

test('1. the Staff Guide names every page the staff PIN opens, and no page that is open to all', () => {
    const opens = opensClause(marked('data-staff-pin'));
    assert.ok(opens, 'the PIN paragraph no longer says what the PIN "opens" — re-anchor this test');
    for (const page of PIN_PAGES) {
        const word = READER_WORD[/** @type {keyof typeof READER_WORD} */ (page)];
        assert.ok(word, `the staff PIN now opens '${page}' (auth-policy.js) — add how a reader names it to READER_WORD here, and say it in staff-guide.html's PIN paragraph and on the Calendar's sign-in card`);
        assert.ok(opens.includes(word), `the staff PIN opens '${page}', but the Staff Guide's PIN paragraph does not say so ("${word}" is missing from: "${opens.trim()}")`);
    }
    for (const [page, word] of Object.entries(READER_WORD).filter(([pg]) => !PIN_PAGES.includes(pg))) {
        assert.ok(!opens.includes(word), PUBLIC_PAGES.includes(page)
            ? `the Staff Guide says the PIN opens "${word}", which is open to everyone without it`
            : `the Staff Guide says the PIN opens "${word}", but auth-policy.js no longer lets the PIN open '${page}'`);
    }
});

test('1. the Staff Guide says which pages in every member\'s menu the staff PIN does not open', () => {
    const notOpen = notOpenClause(marked('data-staff-pin'));
    assert.ok(notOpen, 'the PIN paragraph no longer says what the PIN "doesn\'t open" — the visitor turned away by Admin or Pay is who it is for');
    const askSignIn = navPages().filter(p => !p.gated && PAGE_POLICIES[/** @type {keyof typeof PAGE_POLICIES} */ (p.id)]?.requireNamed && !PAGE_POLICIES[/** @type {keyof typeof PAGE_POLICIES} */ (p.id)]?.staffPin);
    assert.ok(askSignIn.length >= 3, `only ${askSignIn.length} sign-in pages found in the menu — re-anchor this test`);
    for (const p of askSignIn) {
        assert.ok(notOpen.includes(p.name), `"${p.name}" asks a PIN visitor to sign in, but the Staff Guide's PIN paragraph does not name it among the pages the PIN doesn't open ("${notOpen.trim()}")`);
    }
});

test('1. the Calendar\'s sign-in card names every page the staff PIN opens, and no page that is open to all', () => {
    // Two wordings, one per state of the Newsletter's menu button (item 4): each is held to the PIN's pages.
    const m = read('calendar-lock-cards.js').match(/alternative:\s*\{[\s\S]*?hint:\s*newsletterInMenu\(\)\s*\?\s*'([^']+)'\s*:\s*'([^']+)'/);
    assert.ok(m, 'the PIN hint on the Calendar\'s sign-in card was not found in calendar-lock-cards.js — re-anchor this test');
    for (const hint of [m[1], m[2]]) {
        const opens = opensClause(hint);
        for (const page of PIN_PAGES) {
            const word = READER_WORD[/** @type {keyof typeof READER_WORD} */ (page)];
            assert.ok(word && opens.includes(word), `the staff PIN opens '${page}', but the Calendar card's hint does not say so: "${hint}"`);
        }
        for (const [page, word] of Object.entries(READER_WORD).filter(([pg]) => !PIN_PAGES.includes(pg))) {
            assert.ok(!opens.includes(word), `the Calendar card says the PIN opens "${word}", which the PIN does not open ('${page}'): "${hint}"`);
        }
    }
});

test('2. the Staff Guide\'s menu names every page every member sees', () => {
    const pages = marked('data-menu-pages');
    for (const p of navPages()) {
        if (!p.gated) assert.ok(pages.includes(p.name), `every member's menu shows "${p.name}" (nav-panel.js), but the Staff Guide's Pages tile does not name it: "${pages}"`);
        // A gated page belongs to "any others you have access to": naming it tells every member it is theirs.
        else assert.ok(!pages.includes(p.name), `the Staff Guide's Pages tile names "${p.name}", which only some people see (nav-panel.js gates it): "${pages}"`);
    }
});

/** How static copy says how long the Newsletter's row stays: in words, from the module's own number. */
const WINDOW_WORDS = `for ${{ 4: 'four', 5: 'five', 6: 'six', 8: 'eight' }[NEWSLETTER_RECENT_DAYS / 7] ?? '?'} weeks after each issue`;

/** The documents the menu's Latest section shows, read from nav-panel.js's own list, in its order. The
 *  Newsletter is the one that comes and goes, so static copy must name it WITH its window. */
function latestDocs() {
    const block = read('nav-panel.js').match(/const NAV_INFORMATION = \[([\s\S]*?)\n\];/);
    assert.ok(block, 'NAV_INFORMATION not found in nav-panel.js');
    const links = [...block[1].matchAll(/\{\s*icon:\s*'[^']*',\s*label:\s*'([^']+)'([^}]*)\}/g)]
        .map(l => ({ label: l[1].trim(), comesAndGoes: /\bnewsletter:\s*true\b/.test(l[2]) }));
    assert.ok(links.length >= 3 && links.some(l => l.comesAndGoes), `NAV_INFORMATION read as ${links.length} documents — re-anchor this test`);
    return links.map(l => (l.comesAndGoes ? `${l.label} (${WINDOW_WORDS})` : l.label));
}

test('4. the Staff Guide\'s Latest tile names exactly the documents the menu shows', () => {
    const tile = marked('data-menu-latest');
    const named = tile.replace(/^Latest\s*—\s*/, '').split(/\s*,\s*/).map(x => x.trim()).filter(Boolean);
    assert.deepEqual(named, latestDocs(), `the guide's Latest tile reads "${tile}" — name the documents the menu shows (nav-panel.js), `
        + `in menu order, the Newsletter with "(${WINDOW_WORDS})", then run npm run generate:guide-index`);
});

test('4. the welcome email names exactly the documents the menu shows', () => {
    const email = read('.claude/skills/new-starter/welcome-email.html');
    const at = email.indexOf('All under the &#9776; menu');
    assert.ok(at > -1, 'the welcome email no longer says what is "All under the ☰ menu" — re-anchor this test');
    const cell = email.slice(email.lastIndexOf('<td', at), at);
    // Each document is a <strong>; the one that comes and goes carries its window in the words after it.
    const named = [...cell.matchAll(/<strong[^>]*>([^<]+)<\/strong>(\s*\([^)]*\))?/g)]
        .map(x => x[1].trim() + (x[2] ? ` ${x[2].trim().replace(/\s+/g, ' ')}` : ''));
    assert.deepEqual(named, latestDocs(), 'the welcome email\'s menu line must name the documents the menu shows, in menu order, '
        + `the Newsletter with "(${WINDOW_WORDS})" — edit welcome-email.html, and the three ready copies to match (welcome-email-parity.test.mjs)`);
});

test('4. every place that states the Newsletter\'s window says the weeks NEWSLETTER_RECENT_DAYS holds', () => {
    const weeks = WINDOW_WORDS.split(' ')[1];
    assert.ok(weeks !== '?', `NEWSLETTER_RECENT_DAYS is ${NEWSLETTER_RECENT_DAYS}, not a number of weeks this test can say — add it to WINDOW_WORDS`);
    const hint = read('operations.html').match(/id="newsletterUploadHint">([\s\S]*?)<\/span>\s*<\/div>/)?.[1] ?? '';
    const tips = read('operations-tips.js');
    for (const [where, text] of /** @type {[string, string][]} */ ([
        ['the Operations Newsletter card\'s header', hint],
        ['the Operations card\'s ? panel', tips.slice(tips.indexOf("'newsletter': {"), tips.indexOf("'weekly-roster': {"))],
        ['the Operations upload receipt', tips.slice(tips.indexOf('export const NEWSLETTER_CARD'), tips.indexOf('export const CARD_TIPS'))],
    ])) {
        assert.ok(new RegExp(`\\b${weeks} weeks\\b`).test(text), `${where} does not say "${weeks} weeks" (NEWSLETTER_RECENT_DAYS is ${NEWSLETTER_RECENT_DAYS})`);
        for (const other of ['four', 'five', 'six', 'eight'].filter(w => w !== weeks)) {
            assert.ok(!new RegExp(`\\b${other} weeks\\b`).test(text), `${where} still says "${other} weeks"`);
        }
    }
});

/** The Admin type buttons' own labels, in their own order. */
const PILLS = PILL_TYPES.map(t => TYPES[/** @type {keyof typeof TYPES} */ (t)].pill);

test('3. the Shift Types table names every Admin type button by its own label, in order', () => {
    const table = GUIDE.match(/<table class="shift-types">([\s\S]*?)<\/table>/)?.[1];
    assert.ok(table, 'the Shift Types table was not found in staff-guide.html');
    // Each row's first cell is "<strong>EMOJI Label</strong>": drop the emoji, keep the label.
    const rows = [...table.matchAll(/<tr><td><strong>([^<]+)<\/strong>/g)].map(m => m[1].trim().split(/\s+/).slice(1).join(' '));
    assert.deepEqual(rows, PILLS, 'the Shift Types table must name the Admin buttons as the buttons do (admin-shift-types.js)');
});

test('3. the Change a Shift and Apply to Several Days steps list the buttons as Admin does', () => {
    const list = (/** @type {RegExp} */ re, /** @type {string} */ where) => {
        const li = GUIDE.match(re)?.[1];
        assert.ok(li, `the ${where} step was not found in staff-guide.html — re-anchor this test`);
        return text(li).split(/\s*·\s*/).map(s => s.trim());
    };
    assert.deepEqual(list(/<li>Tap a <strong>type<\/strong>:\s*([^<]+)<\/li>/, 'Change a Shift "Tap a type"'), PILLS);
    // The bulk bar is PILL_TYPES less Other (admin-app.js filters it; .claude/rules/admin.md says why).
    assert.deepEqual(list(/<li><strong>Choose type<\/strong>\s*—\s*([^<]+)<\/li>/, 'Apply to Several Days "Choose type"'),
        PILLS.filter(l => l !== TYPES.other.pill));
});
