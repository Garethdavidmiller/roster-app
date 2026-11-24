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
//  1. THE STAFF PIN IS RETIRED (owner, 23 Nov 2026). It used to be a list the guide restated (the pages
//     the PIN opened, from `staffPin` in auth-policy.js). Now the guide, and the Calendar's sign-in card,
//     must not offer it at all: a reader who is told about a PIN goes looking for a box that is not there.
//  2. THE MENU. nav-destinations.js → NAV_PAGES: every page pill shown to every member (no `…Only` gate) is
//     named in the guide's "Pages" tile ([data-menu-pages]), and no gated one is — those are the
//     tile's "any others you have access to". Both directions: a page that stops being everyone's
//     fails as surely as one added.
//  3. THE ADMIN TYPE BUTTONS. admin-shift-types.js → PILL_TYPES and each type's `pill` label: the
//     Shift Types table, the Change a Shift step and the Apply to Several Days step name the buttons
//     by their own labels, in their own order (the bulk bar has no Other — admin.md says why).
//  4. THE LATEST DOCUMENTS. nav-destinations.js → NAV_INFORMATION: the guide's Latest tile ([data-menu-latest])
//     and the welcome email's "All under the ☰ menu" line name exactly those, in menu order. The
//     Newsletter's row shows only while its latest issue is under six weeks old (newsletter-recency.js,
//     owner, 14 Nov 2026), and static copy cannot read a date, so both say so in the same words, and
//     every place that states the window says the number of weeks NEWSLETTER_RECENT_DAYS holds.
//     (welcome-email-parity.test.mjs carries the general template's line to the three ready copies.)
//  5. THE CALENDAR KEY. calendar-legend.js → legendVisibility: the guide's key sentence names exactly the items a
//     month brings, and none the key always shows.
//  6. THE TICK STEP. admin.css decides what ticking a day shows — the type buttons at once, the time boxes only
//     once a type is chosen — and the Change a Shift step says what it shows.
//
// Part of `npm run test:hygiene`. A failure here means the GUIDE is out of date, or the app changed
// on purpose and the guide must follow in the same release — never "loosen the test".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PAGE_POLICIES } from './auth-policy.js';
import { TYPES, PILL_TYPES } from './admin-shift-types.js';
import { NEWSLETTER_RECENT_DAYS } from './newsletter-recency.js';
import { NAV_PAGES, NAV_INFORMATION, PILL_GATES } from './nav-destinations.js';

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

/** The page pills, from the drawer's own list (nav-destinations.js): { id, name, gated }. */
function navPages() {
    return NAV_PAGES.map(p => {
        // The label is the emoji, a space, then the name: "💷 Pay", "🔁 New link".
        const name = p.label.slice(p.label.indexOf(' ') + 1).trim();
        assert.ok(name, `a NAV_PAGES label with no name after its emoji: "${p.label}"`);
        // GATED means a ROLE opens it. `otherStaffHidden` is not one: it takes Admin and Pay from the Other Staff
        // grade (owner, 23 Nov 2026), and the Staff Guide is written for colleagues with a roster, who keep both.
        return { id: p.id, name, gated: Object.keys(PILL_GATES).some(f => f !== 'otherStaffHidden' && /** @type {any} */ (p)[f]) };
    });
}

const PUBLIC_PAGES = Object.keys(PAGE_POLICIES).filter(p => !PAGE_POLICIES[p].requireNamed);

test('the anchors this test reads are where it thinks they are', () => {
    assert.ok(PUBLIC_PAGES.includes('guides'), 'the guides are no longer a public page — re-read this test');
    assert.ok(navPages().length >= 5, 'NAV_PAGES holds fewer than five pills — re-read this test');
});

test('1. the Staff Guide no longer offers the staff PIN, nor the way to it (retired, 23 Nov 2026)', () => {
    // Visible text only: an HTML comment may tell the history.
    const shown = text(GUIDE.replace(/<!--[\s\S]*?-->/g, ''));
    for (const words of ['staff PIN', 'Use the staff PIN instead', 'End staff PIN']) {
        assert.ok(!shown.includes(words), `the Staff Guide still says "${words}" — there is no PIN to offer any more`);
    }
    assert.ok(!/\bdata-staff-pin\b/.test(GUIDE), 'the guide still carries the PIN paragraph\'s anchor');
    // …and it still tells a reader with no login what to do instead: ask the admin (an account matter).
    assert.match(shown, /No login yet\? Ask the admin/, 'the guide no longer tells somebody with no login to ask the admin');
});

test('1. the Calendar\'s sign-in card offers no alternative way in', () => {
    // The card's `alternative` was "Use the staff PIN instead", with a hint naming the PIN's pages.
    const src = read('calendar-lock-cards.js');
    const at = src.indexOf('initLoginOverlay({\n        pageLabel: \'Calendar\'');
    assert.ok(at > -1, 'the Calendar\'s sign-in card was not found — re-anchor this test');
    const front = src.slice(at, src.indexOf('});', at));
    assert.ok(!/alternative\s*:/.test(front), `the front door offers an alternative way in again:\n${front}`);
});

test('2. the Staff Guide\'s menu names every page every member sees', () => {
    const pages = marked('data-menu-pages');
    for (const p of navPages()) {
        if (!p.gated) assert.ok(pages.includes(p.name), `every member's menu shows "${p.name}" (nav-destinations.js), but the Staff Guide's Pages tile does not name it: "${pages}"`);
        // A gated page belongs to "any others you have access to": naming it tells every member it is theirs.
        else assert.ok(!pages.includes(p.name), `the Staff Guide's Pages tile names "${p.name}", which only some people see (nav-destinations.js gates it): "${pages}"`);
    }
});

/** How static copy says how long the Newsletter's row stays: in words, from the module's own number. */
const WINDOW_WORDS = `for ${{ 4: 'four', 5: 'five', 6: 'six', 8: 'eight' }[NEWSLETTER_RECENT_DAYS / 7] ?? '?'} weeks after each issue`;

/** The documents the menu's Latest section shows, from the drawer's own list (nav-destinations.js), in its
 *  order. The Newsletter is the one that comes and goes, so static copy must name it WITH its window. */
function latestDocs() {
    assert.ok(NAV_INFORMATION.length >= 3 && NAV_INFORMATION.some(l => l.newsletter), `NAV_INFORMATION holds ${NAV_INFORMATION.length} documents — re-read this test`);
    return NAV_INFORMATION.map(l => (l.newsletter ? `${l.label} (${WINDOW_WORDS})` : l.label));
}

test('4. the Staff Guide\'s Latest tile names exactly the documents the menu shows', () => {
    const tile = marked('data-menu-latest');
    const named = tile.replace(/^Latest\s*—\s*/, '').split(/\s*,\s*/).map(x => x.trim()).filter(Boolean);
    assert.deepEqual(named, latestDocs(), `the guide's Latest tile reads "${tile}" — name the documents the menu shows (nav-destinations.js), `
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

// 6. THE TICK STEP (whole-app check, Nov 2026). "Tick the day you want to change — its type buttons and time boxes
//    appear": only the type buttons do. The time boxes wait for a type, deliberately since v21.40 — a ticked row with
//    no type yet reserved their space, 170px on a Mon–Fri selection (admin.css). The step is held to the two rules
//    that decide what a tick shows: `.selected` is a ticked row with no type, `.active` one with a type.
test('6. the Change a Shift tick step says what ticking a day shows, as admin.css shows it', () => {
    const css = read('admin.css');
    assert.match(css, /\.day-row:not\(\.active\):not\(\.selected\) \.col-pills\s*\{\s*display:\s*none;\s*\}/,
        'admin.css no longer shows the type buttons on a ticked row the way this test reads it — re-read the guide\'s tick step');
    const timeWaitsForType = /\.day-row:not\(\.active\) \.col-time\s*\{\s*display:\s*none;\s*\}/.test(css);
    const li = GUIDE.match(/<li><strong>Tick the day<\/strong>([^<]*)<\/li>/)?.[1];
    assert.ok(li, 'the Change a Shift "Tick the day" step was not found in staff-guide.html — re-anchor this test');
    assert.match(text(li), /its type buttons appear/, 'the tick step must say the type buttons appear');
    assert.equal(/\btime/i.test(li), !timeWaitsForType, timeWaitsForType
        ? `the tick step promises time boxes, which wait for a type (admin.css): "${text(li)}"`
        : 'admin.css now shows the time boxes on a ticked row — the tick step should say so');
});

// 5. THE CALENDAR KEY (whole-app check, Nov 2026). The guide said the key "lists only what is actually in
//    the month", while Rest, Early, Late, Today, Bank Holiday, Pay cut-off and Payday are always there and
//    Night is the Dispatcher's; only the rest follow the month (calendar-legend.js → legendVisibility). The
//    [data-calendar-key] sentence names exactly those, each by the key's own word or by the badge the
//    guide's Shift Badges grid shows for it, and nothing the key always shows.
test('5. the Staff Guide names exactly the calendar key items that follow the month', async () => {
    const { legendVisibility } = await import('./calendar-legend.js');
    const index = read('index.html');
    /** The words the Calendar's key gives an item, by its element id (its emoji is aria-hidden, not a word). */
    const keyWords = (/** @type {string} */ id) => {
        const m = index.match(new RegExp(`id="${id}"[^>]*>[\\s\\S]*?<span class="legend-text">([\\s\\S]*?)</span></div>`));
        assert.ok(m, `index.html: no key item #${id} — re-anchor this test`);
        return text(m[1].replace(/<span aria-hidden="true">[^<]*<\/span>/g, ''));
    };
    // What an empty January shows a Dispatcher, with Easter in April: an item still hidden is one only a
    // month can bring (the Dispatcher's Night is shown, so it is not among them).
    /** @type {Record<string, boolean>} */
    const shown = legendVisibility({ types: new Set(), isDispatcher: true, displayMonth: 0, easterMonth: 3 });
    const monthly = Object.keys(shown).filter(id => !shown[id] && id !== 'legend-row-2');
    assert.ok(monthly.length >= 6, `only ${monthly.length} month-driven key items were read — re-anchor this test`);
    // The guide's badges: "🏖️ AL" over "Annual leave", so a key item may be named by its badge.
    const badges = [...GUIDE.matchAll(/<span class="sb sb-[a-z]+">[^\s<]+\s+([^<]+)<\/span><span class="badge-desc">([^<]+)<\/span>/g)]
        .map(m => ({ label: m[1].trim(), desc: m[2].trim().toLowerCase() }));
    assert.ok(badges.length >= 8, `only ${badges.length} Shift Badges were read — re-anchor this test`);
    const sentence = marked('data-calendar-key');
    /** Every way the sentence may name a key item: the key's words, their first word, or its badge. */
    const names = (/** @type {string} */ words) => [words, words.split(' ')[0],
        ...badges.filter(b => b.desc.startsWith(words.toLowerCase())).map(b => b.label)];
    const says = (/** @type {string} */ name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(sentence);
    for (const id of monthly) {
        const words = keyWords(id);
        assert.ok(names(words).some(says), `the guide's key sentence does not name "${words}" (#${id}), which only a month brings:\n  ${sentence}`);
    }
    for (const always of ['Rest', 'Early', 'Late', 'Today', 'Bank Holiday', 'Pay cut-off', 'Payday', keyWords('legend-night')]) {
        assert.ok(!says(always), `the guide's key sentence names "${always}", which the key does not take from the month:\n  ${sentence}`);
    }
});
