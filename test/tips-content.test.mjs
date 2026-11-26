// @lane unit
/**
 * Guard for the pages' CARD_TIPS content.
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs test/tips-content.test.mjs   (part of `npm run test:unit`)
 *
 * WHY THIS FILE EXISTS — a real staff-reported error, v19.13:
 *
 *     TypeError: tips.sections is not iterable
 *         at render (tips-lightbox.js:49)
 *
 * Tapping the `?` on Operations → Password Reset Requests threw and the panel never opened. The
 * entry had been hand-written in the OLD flat shape — `{ title, items: [...] }` — while the renderer
 * has required `{ title, sections: [{ items: [...] }] }` since the four copy-pasted implementations
 * were unified into `tips-lightbox.js`. Nine sibling entries in the same object were correct; this
 * one was added later, by hand, at the wrong indentation, and nothing looked.
 *
 * It could not have been caught by anything already in the suite: the content is a plain object
 * literal inside a 1,900-line coordinator, the renderer is only reachable through a DOM click, and
 * the e2e suite opens no tips panel. So it needed a human to press that one button on that one page.
 *
 * These checks are STRUCTURAL — they say the content matches the shape the renderer consumes, and
 * that every `?` button has content behind it. They say nothing about whether the wording is any good.
 *
 * Each page's `CARD_TIPS` is IMPORTED from its tips module, so what is checked is the object the page
 * renders, built from the constants its own module imports. Until 25 Nov 2026 the object literal was
 * cut out of the source text by brace-matching and evaluated with a hand-passed list of constants —
 * a copy, and a list that had to be kept in step with each module's imports by hand. Where a test
 * needs a tip built from a DIFFERENT constant (a stand-in, to prove the words follow it), the
 * constant's module is replaced for one fresh import of the tips module (`tipsWith`), which is why
 * this file is in the unit lane.
 */
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROTATING_LINES, MIN_REST_MINUTES, WEEKENDS_OFF_AIM_PCT } from '../links-design.js';
import { DEFAULT_TABLE_FIGURES } from '../links-tips.js';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

/**
 * Pages that own a CARD_TIPS block, paired with the HTML whose `?` buttons consume it.
 *
 * Links, Trains and Operations' leave-file age interpolate constants into their tips strings. Links:
 * four of its entries state the rotation length and one states the main cycle's length, and
 * `links-rotation-parity.test.mjs` requires the former to be DERIVED rather than typed (the length
 * went 28 → 22 at v19.98 and left prose behind in fifteen places). Importing the module builds each
 * string from the module's REAL constants, so a tips string quoting the wrong number would still have
 * to be wrong about something else to pass.
 */
const PAGES = [
    { js: 'admin-tips.js',     html: 'admin.html' },
    { js: 'operations-tips.js', html: 'operations.html' },
    { js: 'settings-tips.js',  html: 'settings.html' },
    { js: 'links-tips.js',     html: 'links.html' },
    { js: 'overtime-tips.js',  html: 'overtime.html' },
    // The Calendar's one ? is drawn by Team View (calendar-team-view.js), so that file is where its button is read.
    { js: 'calendar-tips.js',  html: 'calendar-team-view.js', noCardHeading: true },
    { js: 'trains-tips.js',    html: 'trains.html' },
    { js: 'newlink-tips.js',   html: 'newlink.html' },
];

// settings-tips.js lists Timetable changes only while one is due (`timetableListed`, notif-card-core.js),
// as the card does at runtime; settings.html carries the card's kind in its markup either way. So the
// settings panel is read as it stands while a change is due — the state in which both list it — and
// the runtime filter is asserted on its own below. Without this the comparison would change its answer
// on the evening before the change date.
const NOTIF_CARD_CORE = await import('../notif-card-core.js');
let timetableDue = true;
mock.module('../notif-card-core.js', { namedExports: { ...NOTIF_CARD_CORE, timetableListed: () => timetableDue } });

/** @type {Record<string, any>} */
const TIPS = {};
for (const { js } of PAGES) TIPS[js] = (await import(`../${js}`)).CARD_TIPS;

let fresh = 0;
/**
 * A tips module's CARD_TIPS built with one of its constants replaced: the constant's module is
 * swapped for this one fresh import of the tips module, then put back.
 * @param {string} tipsFile  @param {string} constFile  @param {Record<string, unknown>} overrides
 */
async function tipsWith(tipsFile, constFile, overrides) {
    const real = await import(`../${constFile}`);
    const swap = mock.module(`../${constFile}`, { namedExports: { ...real, ...overrides } });
    try { return (await import(`../${tipsFile}?stand-in-${++fresh}`)).CARD_TIPS; }
    finally { swap.restore(); }
}

/** The `data-card` values actually wired to a `?` button. @param {string} file */
function readWiredCards(file) {
    const html = readFileSync(file, 'utf8');
    return [...html.matchAll(/class="[^"]*btn-card-tips[^"]*"[^>]*data-card="([^"]+)"/g)].map(m => m[1]);
}

// paycalc has the SAME contract under a different name, and it was unguarded until this review.
// `HELP_CONTENT` (paycalc-help.js) is keyed by `data-help`, lives in a different file from its
// renderer, and a missing key gives the same silently-inert button. Since Nov 2026 it is rendered by
// the shared `initTipsLightbox` (paycalc-lightboxes.js passes `.help-btn[data-help]` as its trigger:
// the Pay "?" panels were a see-through glass sheet of bullet lists of their own until then), so it is
// held to the SAME shape as every CARD_TIPS block — `{ title, sections: [{ heading, items: [{ icon,
// html }] }] }`. (The nav-panel arrays are deliberately NOT covered: they are module-internal constants
// sitting directly above their own renderer, so an editor sees both at once — the cross-FILE
// separation is what let the reset-requests bug through.)
const { HELP_CONTENT } = await import('../paycalc-help.js');   // top level: .mjs allows it
/** Every item's html in one entry, in order. @param {any} entry @returns {string[]} */
const helpItems = entry => entry.sections.flatMap((/** @type {any} */ s) => s.items).map((/** @type {any} */ i) => i.html);

describe('paycalc-help.js — HELP_CONTENT', () => {
    const html = readFileSync('paycalc.html', 'utf8');
    const wired = [...html.matchAll(/data-help="([^"]+)"/g)].map(m => m[1]);

    test('every entry is in the shape the shared Tips panel renders', () => {
        // The renderer does `for (const section of tips.sections)` and `for (const item of section.items)`.
        const broken = [];
        for (const [key, v] of Object.entries(HELP_CONTENT)) {
            if (!v || typeof v.title !== 'string' || !Array.isArray(v.sections) || !v.sections.length) {
                broken.push(`${key} has no title or no sections array`);
                continue;
            }
            v.sections.forEach((/** @type {any} */ sec, /** @type {number} */ i) => {
                if (!Array.isArray(sec.items) || !sec.items.length) { broken.push(`${key}.sections[${i}] has no items`); return; }
                sec.items.forEach((/** @type {any} */ item, /** @type {number} */ j) => {
                    if (typeof item.icon !== 'string' || !item.icon.trim() || typeof item.html !== 'string' || !item.html.trim()) {
                        broken.push(`${key}.sections[${i}].items[${j}] is missing its icon or html`);
                    }
                });
            });
        }
        assert.deepEqual(broken, [],
            `paycalc-help.js: ${broken.join('; ')} — a wrong shape throws, or shows an empty row, the moment the ? is tapped.`);
    });

    test('every section has a short heading, as the other pages\' panels do', () => {
        const bare = Object.entries(HELP_CONTENT).flatMap(([k, v]) => v.sections
            .map((/** @type {any} */ s, /** @type {number} */ i) => [s.heading, `${k}.sections[${i}]`])
            .filter(([h]) => typeof h !== 'string' || !h.trim() || h.length > 40).map(([, at]) => at));
        assert.deepEqual(bare, [], 'a section with no heading, or one too long to be a heading');
    });

    test('the page opens its ? buttons through the shared panel, and carries that panel\'s markup', () => {
        assert.match(readFileSync('paycalc-lightboxes.js', 'utf8'),
            /initTipsLightbox\(HELP_CONTENT, \{ trigger: \{ selector: '\.help-btn\[data-help\]', key: 'help' \} \}\)/);
        for (const id of ['tipsLightbox', 'tipsLightboxContent', 'tipsLightboxClose', 'tipsLbTitle', 'tipsLbBody']) {
            assert.match(html, new RegExp(`id="${id}"`), `paycalc.html: #${id} is missing — initTipsLightbox returns early without it`);
        }
    });

    test('every data-help button in paycalc.html has an entry', () => {
        const missing = wired.filter(k => !(k in HELP_CONTENT));
        assert.deepEqual(missing, [],
            `paycalc.html: help button(s) with no HELP_CONTENT entry: ${missing.join(', ')} — the ` +
            'renderer returns early, so the button is inert rather than broken.');
    });

    test('every entry is reachable from a button', () => {
        const orphans = Object.keys(HELP_CONTENT).filter(k => !wired.includes(k));
        assert.deepEqual(orphans, [],
            `paycalc-help.js: entries no button opens: ${orphans.join(', ')}`);
    });

    test('the contracted-hours tip reads the grade table, so it follows a change of hours', async () => {
        // It said "140 hours" by hand. Change the table, load a fresh copy of the help, and the tip
        // must say the new figure — per grade when the two grades differ.
        const { GRADES } = await import('../paycalc-calc.js');
        const tipOf = (/** @type {any} */ mod) => helpItems(mod.HELP_CONTENT.hours).find((/** @type {string} */ t) => t.startsWith('Your contract includes'));
        assert.match(tipOf({ HELP_CONTENT }), new RegExp(`${GRADES.cea.contr} hours per period`));
        const saved = [GRADES.cea.contr, GRADES.ces.contr];
        try {
            GRADES.cea.contr = 150; GRADES.ces.contr = 150;
            assert.match(tipOf(await import('../paycalc-help.js?same')), /150 hours per period.*both 150 hours/);
            GRADES.ces.contr = 147;
            assert.match(tipOf(await import('../paycalc-help.js?differ')), /CEA 150, CES 147/);
        } finally { [GRADES.cea.contr, GRADES.ces.contr] = saved; }
    });

    test('the premium panel names WHICH January pays which year, read from the tax-year table', async () => {
        // It said "a single lump sum on a January payslip every year", and a member entering 2026/27 hours
        // read that as January 2027 — whose payslip carries 2025/26's premium (paycalc.md invariant 4:
        // the first January AFTER the year ends). The years come from TAX_YEARS, so the rollover moves them.
        const { TAX_YEARS } = await import('../paycalc-calc.js');
        const words = helpItems(HELP_CONTENT.hpp).join(' ');
        const cur = TAX_YEARS[TAX_YEARS.length - 1], prev = TAX_YEARS[TAX_YEARS.length - 2];
        assert.ok(cur.hppPaidJan > Number(cur.label.slice(0, 4)) + 1, 'premise: a year\'s premium is paid the January after it ends');
        assert.match(words, new RegExp(`premium for ${cur.label} comes on your January ${cur.hppPaidJan} payslip`));
        assert.match(words, new RegExp(`January ${prev.hppPaidJan} payslip carries the premium for ${prev.label}`));
        assert.doesNotMatch(words, /a January payslip<\/strong> every year/);
        // A new year in the table moves the sentence with it.
        TAX_YEARS.push({ ...cur, label: '2099/00', hppPaidJan: 2101 });
        try {
            const moved = helpItems((await import('../paycalc-help.js?rollover')).HELP_CONTENT.hpp).join(' ');
            assert.match(moved, /premium for 2099\/00 comes on your January 2101 payslip/);
            assert.match(moved, new RegExp(`January ${cur.hppPaidJan} payslip carries the premium for ${cur.label}`));
        } finally { TAX_YEARS.pop(); }
    });
});

// ── WHAT OPERATIONS' RESET QUEUE QUOTES (Nov 2026 review) ───────────────────────────────────────
// The queue's hint quoted "ask the admin to reset my password" while the sign-in link reads "Can’t get
// in? Ask the admin to reset your password" — a quote nobody could find on the screen it names. Both
// the hint and the ? panel are held to the link's own words, read from login-overlay.js.
describe('operations — the reset queue quotes the sign-in link as it reads', () => {
    const m = /const RESET_BTN_LABEL = ([\s\S]*?);\n/.exec(readFileSync('login-overlay.js', 'utf8'));
    assert.ok(m, 'login-overlay.js: RESET_BTN_LABEL not found — update this test to read the link from its new home');
    const link = String(new Function(`return (${m[1]});`)()).replace(/<[^>]+>/g, '');

    test('the card hint quotes the link\'s opening words', () => {
        const hint = /<span class="hint">Staff who selected “([^”]+)”/.exec(readFileSync('operations.html', 'utf8'))?.[1];
        assert.ok(hint && link.startsWith(hint), `operations.html quotes "${hint}"; the link reads "${link}"`);
    });

    test('the ? panel quotes the link in full', () => {
        const first = TIPS['operations-tips.js']['reset-requests'].sections[0].items[0].html;
        assert.equal(/“([^”]+)”/.exec(first)?.[1], link);
    });
});

// ── WHAT OPERATIONS' DOCUMENT CARDS PROMISE (whole-app check, 17 Nov 2026) ──────────────────────
// Three lines told the admin something the app does not do. The Huddle header said staff open "today's"
// — the ☰ link opens the newest Huddle by its date, whichever day that is. The ? panel said a Word Huddle
// is "displayed inside the app" — one whose converted page is over the cap, or uploaded while the
// converter could not be reached, has no page to show, and opens in Microsoft's Word viewer. And an old
// Newsletter's sign-out line sent the admin to "the Calendar with #newsletter on the end of its address":
// a developer's words, for a link that opens the NEWEST issue, not the one just filed. The reset queue's
// panel title also wore an emoji, the only Operations panel title that did.
describe('operations — the document cards promise only what the app does', () => {
    const tips = TIPS['operations-tips.js'];

    test('the Huddle header says staff open the latest, not today\'s', () => {
        const hint = /Daily Huddle<\/h2>\s*<span class="hint">(.*)<\/span>\s*<\/div>/.exec(readFileSync('operations.html', 'utf8'))?.[1];
        assert.ok(hint, 'premise: the Daily Huddle card\'s header hint was found');
        assert.match(hint, /the latest/);
        assert.doesNotMatch(hint, /today|tomorrow/i);
    });

    test('the Word line says when a Word Huddle is not shown inside the app', () => {
        const huddle = readFileSync('huddle.js', 'utf8');
        assert.match(huddle, /html\.length <= MAX_HUDDLE_HTML_CHARS \? html : null/, 'premise: a converted page over the cap is dropped');
        assert.match(huddle, /message === 'load'\) \{/, 'premise: a converter that cannot be reached uploads the file with no page');
        assert.match(readFileSync('storage-utils.js', 'utf8'), /pick\.type === 'docx' \? officeViewerUrl\(pick\.url\)/,
            'premise: a Word file with no page opens in the Office viewer');
        const word = tips['daily-huddle'].sections.flatMap((/** @type {any} */ s) => s.items)
            .map((/** @type {any} */ i) => i.html).find((/** @type {string} */ h) => /\.docx/.test(h)) ?? '';
        assert.match(word, /too large to convert/);
        assert.match(word, /converter could not be reached/);
        assert.match(word, /Word viewer/);
    });

    test('an old Newsletter\'s sign-out line names no address to type', async () => {
        const { NEWSLETTER_CARD } = await import('../operations-tips.js');
        const old = NEWSLETTER_CARD.whereToCheck('2020-01-06');
        assert.doesNotMatch(old, /#|address|Calendar/);
        assert.match(old, /upload it again/);
    });

    test('no panel title wears an emoji — the card\'s header carries it', () => {
        const worn = Object.entries(tips).filter(([, v]) => /\p{Extended_Pictographic}/u.test(v.title)).map(([k, v]) => `${k}: ${v.title}`);
        assert.deepEqual(worn, []);
    });
});

// ── WHAT SETTINGS SAYS YOU WILL GET (Nov 2026 review) ───────────────────────────────────────────
// The Notifications card lists the kinds of notification a member agrees to; its ? panel lists them
// again. The card gained "Timetable changes" at v24.97 and the panel did not, under a comment insisting
// it named every kind. Each list is held to the other: every kind on the card is named in the panel's
// "What you'll get", and the panel names nothing the card does not. The panel's name must END with the
// card's, which allowed a short form on the card; since 17 Nov 2026 it gives the two documents their
// whole names too ("Weekly Retail Circular", "Marylebone Newsletter" — CLAUDE.md's canonical terms).
// A kind may carry an id and `hidden` (the pay reminder, shown only to those it is sent to).
describe('settings — the ? panel names the notifications the card lists', () => {
    const card = [...readFileSync('settings.html', 'utf8').matchAll(/<span class="notif-kind"[^>]*>([^<]+?)(?: ·)?<\/span>/g)]
        .map(m => m[1].trim());
    const got = TIPS['settings-tips.js'].notifications.sections.find((/** @type {any} */ s) => /get/.test(s.heading ?? ''));
    const named = (got?.items ?? []).map((/** @type {any} */ i) => /<strong>([^<]+)<\/strong>/.exec(i.html)?.[1] ?? '');

    test('premise: both lists were found', () => {
        assert.ok(card.length >= 4, `settings.html: found ${card.length} .notif-kind spans`);
        assert.ok(named.length >= 4, 'settings-tips.js: no "What you\'ll get" section in the notifications tips');
    });
    test('every kind on the card is in the panel', () => {
        const missing = card.filter(k => !named.some(n => n.endsWith(k)));
        assert.deepEqual(missing, [], `the card lists ${missing.join(', ')}; the ? panel does not`);
    });
    test('the panel names nothing the card does not', () => {
        const extra = named.filter(n => !card.some(k => n.endsWith(k)));
        assert.deepEqual(extra, [], `the ? panel lists ${extra.join(', ')}; the card does not`);
    });
});

// ── …AND THE TIMETABLE CHANGE ONLY WHILE ONE IS DUE ─────────────────────────────────────────────
// The card stops listing Timetable changes once the change has passed (notif-card-core.js), and the ?
// panel drops its item at the same moment, by the same function — run here both ways.
describe('settings — the ? panel lists the timetable change exactly while the card does', () => {
    /** @param {any} tips */
    const trains = (tips) => tips.notifications.sections.flatMap((/** @type {any} */ s) => s.items)
        .filter((/** @type {any} */ i) => i.icon === '🚆');
    test('while a change is due, the panel names it', () => {
        assert.equal(trains(TIPS['settings-tips.js']).length, 1);
    });
    test('once it has passed, the panel says nothing of it', async () => {
        timetableDue = false;
        try { assert.deepEqual(trains((await import('../settings-tips.js?timetable-passed')).CARD_TIPS), []); }
        finally { timetableDue = true; }
    });
});

// ── THE PAY REMINDER SAYS WHO IT REACHES (whole-app check, 10 Nov 2026) ─────────────────────────
// Since contracts-b-3 the server sends it only to the grades the Pay Calculator prices, and the panel
// still promised it to everybody — a Dispatcher or a manager agreed to a reminder that never comes.
// The grades are read from the server's own list, so the panel and the send cannot part.
describe('settings — the ? panel says who the pay reminder is for', () => {
    const server = readFileSync('functions/pay-reminder.js', 'utf8');
    const list = /PAY_REMINDER_GRADES\s*=\s*Object\.freeze\(\[([^\]]*)\]\)/.exec(server)?.[1] ?? '';
    const grades = [...list.matchAll(/'(\w+)'/g)].map(m => m[1].toUpperCase());
    const got = TIPS['settings-tips.js'].notifications.sections.find((/** @type {any} */ s) => /get/.test(s.heading ?? ''));
    const item = (got?.items ?? []).map((/** @type {any} */ i) => String(i.html)).find((/** @type {string} */ h) => h.startsWith('<strong>Pay reminder</strong>')) ?? '';

    test('premise: the server\'s grades and the panel\'s item were found', () => {
        assert.ok(grades.length > 0, 'functions/pay-reminder.js: PAY_REMINDER_GRADES was not found');
        assert.ok(item, 'settings-tips.js: no Pay reminder item in "What you\'ll get"');
    });
    test('the item names every grade the server sends it to', () => {
        for (const g of grades) assert.match(item, new RegExp(`\\b${g}\\b`), `the panel promises the reminder without saying it is for ${g} colleagues: ${item}`);
    });
});

// ── …AND SO DOES EVERY OTHER PLACE THAT PROMISES IT (whole-app check, 17 Nov 2026) ──────────────────
// The ? panel was put right on 10 Nov; the card's subtitle and list, its two status lines, the Calendar's
// notification strip and the Staff Guide still promised the reminder to everybody. A page that knows the
// member shows it only to a member it is sent to — the card's pay pieces start hidden, and notif-card.js and
// calendar-notif-prompt.js show them (each driven in its own tests: e2e/settings.spec.js and
// calendar-notif-prompt.test.mjs) — and a page that cannot know, the guide, says who it is for.
describe('the pay reminder is promised only to the grades it is sent to, everywhere', () => {
    const settings = readFileSync('settings.html', 'utf8');
    const card = readFileSync('notif-card-core.js', 'utf8');
    const guide = readFileSync('staff-guide.html', 'utf8').replace(/\s+/g, ' ');
    const server = readFileSync('functions/pay-reminder.js', 'utf8');
    const grades = [...(/PAY_REMINDER_GRADES\s*=\s*Object\.freeze\(\[([^\]]*)\]\)/.exec(server)?.[1] ?? '').matchAll(/'(\w+)'/g)].map(m => m[1].toUpperCase());

    test('premise: the server still sends it to some grades and not all', () => {
        assert.deepEqual(grades, ['CEA', 'CES']);
    });
    test('Settings: the subtitle\'s and the list\'s pay pieces start hidden — the page shows them to those it is sent to', () => {
        assert.match(settings, /<span class="hint">Get alerts for staff updates<span id="notifHintPay" hidden> and pay reminders<\/span><\/span>/);
        assert.match(settings, /<span class="notif-kind" id="notifKindPay" hidden>Pay reminder ·<\/span>/);
    });
    // Since 22 Nov 2026 the status lines name no kind at all: they point at the list above them, which is
    // the member's own (the pay reminder shown only to those it is sent to, the timetable change only
    // while one is due). A line that named the pay reminder would promise it to everybody again.
    test('Settings: the status lines promise nothing the member\'s own list does not', () => {
        assert.doesNotMatch(card, /pay cut-off|pay reminder/i, 'a status line names the pay reminder, which only some members are sent');
        assert.match(card, /'Notifications are on for this device — you’ll get each alert listed above\.'/);
        assert.match(card, /'Select “Turn on notifications” to get the alerts listed above\.'/);
    });
    test('the Staff Guide, which cannot know who reads it, says whom the reminder is for', () => {
        const line = /<strong>Notifications<\/strong>[^<]*(?:<[^>]+>[^<]*)*?Settings/.exec(guide)?.[0] ?? '';
        assert.ok(line, 'premise: the guide\'s notifications line was found');
        if (/pay reminder/i.test(line)) for (const g of grades) assert.match(line, new RegExp(`\\b${g}\\b`), `the guide promises it without saying it is for ${g}: ${line}`);
    });
    test('Settings names the two documents by their whole names', () => {
        assert.match(settings, /<span class="notif-kind">Weekly Retail Circular ·<\/span> <span class="notif-kind">Marylebone Newsletter ·<\/span>/);
    });
});

// ── WHAT THE WORK EMAIL IS FOR (Nov 2026 review) ────────────────────────────────────────────────
// CLAUDE.md's wording convention: the email is for "account recovery", and "Self-service recovery isn't
// available yet. For now, ask the admin if you forget your password." The card says exactly that; its ?
// panel kept the roadmap promise the convention replaced ("one day you can reset your own password by
// email. That is not built yet"). The panel is held to the card's own sentence.
describe('settings — the Work Email ? panel says what the card says the email is for', () => {
    const html = readFileSync('settings.html', 'utf8').replace(/\s+/g, ' ');
    const sentence = /Self-service recovery isn’t available yet\. For now, ask the admin if you forget your password/.exec(html)?.[0];
    const tip = TIPS['settings-tips.js']['work-email'].sections.flatMap((/** @type {any} */ s) => s.items)
        .map((/** @type {any} */ i) => i.html.replace(/<[^>]+>/g, '')).join(' ');

    test('premise: the card states the convention', () => {
        assert.ok(sentence, 'settings.html: the Work Email card no longer carries the convention\'s sentence');
    });
    test('the panel names account recovery and carries the card\'s sentence', () => {
        assert.match(tip, /account recovery/);
        assert.ok(sentence && tip.includes(sentence), `the Work Email ? panel reads: ${tip}`);
    });
    test('and makes no roadmap promise', () => {
        assert.doesNotMatch(tip, /one day|not built yet|coming soon/i);
    });
});

// ── …AND NEITHER DO THE CARD AND THE GUIDE (whole-app check, 17 Nov 2026) ─────────────────────────
// The card's explainer added "saving your email means it will be ready when it is", and the Staff Guide
// "worth adding now, ready for when it is" and "the surname default is on its way out": undated promises
// a reader takes as a plan. The convention states what works today, and both now say exactly that.
describe('the work email and password lines state today, and promise nothing', () => {
    const settings = readFileSync('settings.html', 'utf8').replace(/\s+/g, ' ');
    const guide = readFileSync('staff-guide.html', 'utf8').replace(/\s+/g, ' ');

    test('the card and the guide both give today\'s route', () => {
        assert.match(settings, /Self-service recovery isn’t available yet\. For now, ask the admin if you forget your password\./);
        assert.match(guide, /Self-service recovery isn't available yet: for now, ask the admin if you forget your password\./);
    });
    test('neither makes an undated promise', () => {
        for (const [where, text] of [['settings.html', settings], ['staff-guide.html', guide]]) {
            assert.doesNotMatch(text, /ready (?:for )?when it is|on its way out|coming soon/i, `${where} promises a future it does not date`);
        }
    });
});

// ── WHO CAN SEE THE SAVED EMAIL IS SAID OF THE EMAIL (18 Nov 2026) ───────────────────────────────
// The 17 Nov wording put "…ask the admin if you forget your password." straight before "Only you and the
// admin can see it", so the nearest noun was the password — which nobody can see, as the Password card's
// own ? panel says. The card, its ? panel and the Staff Guide name the email, so the "it" has nothing to
// attach to.
describe('who can see the saved work email is said of the email, never of the password', () => {
    const settings = readFileSync('settings.html', 'utf8').replace(/\s+/g, ' ');
    const guide = readFileSync('staff-guide.html', 'utf8').replace(/\s+/g, ' ');
    const tip = TIPS['settings-tips.js']['work-email'].sections.flatMap((/** @type {any} */ s) => s.items)
        .map((/** @type {any} */ i) => i.html.replace(/<[^>]+>/g, '')).join(' ');

    for (const [where, text] of [['the Work Email card', settings], ['its ? panel', tip], ['the Staff Guide', guide]]) {
        test(`${where} names the email`, () => {
            assert.match(text, /Only you and the admin can see this email\b/);
            assert.doesNotMatch(text, /Only you and the admin can see it\b/, 'an "it" here reads as the password');
        });
    }
});

// ── THE DAY PANEL'S "CHANGED" LINE (whole-app check, 17 Nov 2026) ────────────────────────────────
// The guide said a changed day shows "what your manager recorded instead", and members record their own
// leave and absence — the guide says so itself a little further down.
describe('the Staff Guide does not say only a manager changes a day', () => {
    const guide = readFileSync('staff-guide.html', 'utf8').replace(/\s+/g, ' ');
    test('premise: the guide says members record their own leave and absence', () => {
        assert.match(guide, /You can record leave and absence for <strong>yourself<\/strong>/);
    });
    test('the day panel line says what was recorded, not who recorded it', () => {
        assert.match(guide, /<strong>✓ As rostered<\/strong> if it still matches your pattern, or what was recorded instead/);
        assert.doesNotMatch(guide, /what your manager recorded instead/);
    });
});

// ── links-tips.js says what the Links page DRAWS (whole-app fix, Nov 2026 — links-app-13) ────────────
// The structural checks below cannot see prose, and four Links panels had stopped describing the page:
// a blank Coverage cell was "nobody on duty" and a red 0 a mid-day hole, after the staffed window made
// a gap any OPEN hour; the generator named a "Custom time…" option that reads "Custom…"; Generate was
// said to refuse only an underpaying table; and the Design checks panel explained five rows of a card
// that is mostly hours, company limits and ORR factors. Each test ties a sentence to the code that draws
// what it describes, so a change to either side breaks here rather than on a colleague's screen.
describe('links-tips.js — the ? panels describe the page as drawn', () => {
    const src = (/** @type {string} */ f) => readFileSync(new URL(`./${f}`, REPO_ROOT_URL), 'utf8');
    /** A panel's words, tags stripped. @param {any} tips @param {string} key */
    const words = (tips, key) => tips[key].sections.flatMap((/** @type {any} */ s) => s.items.map((/** @type {any} */ i) => i.html))
        .join(' ').replace(/<[^>]+>/g, '');

    test('Coverage: a red 0 is an OPEN hour with nobody on, and a grey hour is the station shut', async () => {
        const { CARD_TIPS } = await import('../links-tips.js');
        const note = src('links-analysis.js');
        assert.match(note, /Red 0 = the station is open and nobody is on\. Grey = outside the staffed window\./,
            'the card\'s own note changed — re-read the coverage tip against it');
        const tip = words(CARD_TIPS, 'links-coverage');
        assert.match(tip, /red 0 means a gap — the station is open and nobody is on duty/);
        assert.match(tip, /grey hour is outside the staffed window/);
        assert.doesNotMatch(tip, /blank = nobody|in the middle of that day/, 'the pre-window reading of the heat map');
    });

    test('the generator names its custom option by the label the option carries', async () => {
        const { CARD_TIPS } = await import('../links-tips.js');
        // The shift list is links-grid.js's since 25 Nov 2026 (`shiftOptionsHtml`, out of links-app.js).
        const label = src('links-grid.js').match(/opt\('__custom__', '([^']+)'\)/)?.[1];
        assert.ok(label, 'the custom option\'s label was not found in links-grid.js');
        const tip = words(CARD_TIPS, 'links-generator');
        assert.ok(tip.includes(`choose ${label}`), `the tip should send the designer to "${label}"`);
        assert.doesNotMatch(tip, /Custom time/);
    });

    // ONE ROW PER SHIFT TIME (17 Nov 2026): the card's intro and the tip said "one row per start time", and the
    // default table opens with three rows that start at 06:20 and finish at different times.
    test('the generator\'s table is one row per SHIFT time, start and finish — the card and the tip say so', async () => {
        const { CARD_TIPS } = await import('../links-tips.js');
        const { DEFAULT_SHIFT_TIMES } = await import('../links-default-targets.js');
        const starts = DEFAULT_SHIFT_TIMES.map(t => t.slice(0, 5));
        assert.ok(new Set(starts).size < starts.length, 'premise: two rows of the default table start together');
        const tip = words(CARD_TIPS, 'links-generator');
        const intro = src('links.html').match(/<p class="links-desc">List the shifts([\s\S]*?)<\/p>/)?.[1] ?? '';
        assert.ok(intro, 'the generator card\'s intro was not found in links.html');
        for (const [where, text] of [['the tip', tip], ['the card\'s intro', intro]]) {
            assert.match(text, /one row per shift time, its start and finish/, `${where} says what a row is`);
            assert.doesNotMatch(text, /start time(?!s)/, `${where} still calls a row a start time`);
        }
    });

    test('the refusal is described both ways, each with its own remedies', async () => {
        const { CARD_TIPS } = await import('../links-tips.js');
        const gen = src('links-generate.js');   // the generator moved out of links-design.js (25 Nov 2026)
        for (const reason of ['short-hours', 'over-hours']) assert.ok(gen.includes(`'${reason}'`), `generateLink no longer refuses with ${reason}`);
        // The generator's panel, since Nov 2026: the refusal is the generator's, of a table of targets.
        const tip = words(CARD_TIPS, 'links-generator');
        assert.match(tip, /refuses a table of targets that does not pay the contracted week exactly — under it or over it/);
        assert.match(tip, /more duties, longer ones, or more cover weeks/);
        assert.match(tip, /fewer duties, shorter ones, or fewer cover weeks/);
        // The line count is fixed, so spreading the work over more lines is no remedy and is not offered.
        assert.doesNotMatch(words(CARD_TIPS, 'links-grid') + tip, /more lines never can|over more lines/);
    });

    // THE DEFAULT TABLE'S FIGURES ARE READ, NOT TYPED (Nov 2026), and the panel's claim that the
    // shortlisted designs staff the same duties each day is checked against every shortlisted grid.
    test('the default table: its figures are the table\'s, and the shortlist claim holds', async () => {
        const { CARD_TIPS } = await import('../links-tips.js');
        const { PROPOSALS } = await import('../links-proposals.js');
        const { isCoverWeek } = await import('../links-design.js');
        const F = DEFAULT_TABLE_FIGURES;
        const tip = words(CARD_TIPS, 'links-generator');
        assert.ok(tip.includes(`${F.weekday} on each weekday, ${F.sat} on a Saturday, ${F.sun} on a Sunday, with ${F.cover} cover weeks`));
        assert.ok(tip.includes(`at ${F.days} contracted days a year — under the ${F.ceiling} ceiling`));
        // …and the VERDICT words beside those figures are typed, so they are checked here against the table
        // itself (24-hour check, Nov 2026): a table that moved off the contract, or up to the ceiling, would
        // otherwise keep "exactly" and "under" while the figures interpolated beside them said otherwise.
        const { buildDefaultTargets } = await import('../links-default-targets.js');
        const { assessTargetHours } = await import('../links-target-hours.js');
        const t = buildDefaultTargets();
        assert.match(tip, /Mon–Sat pays exactly the contracted week/);
        assert.equal(assessTargetHours(t.slots, { spareLines: t.spareLines, totalLines: ROTATING_LINES }).onTarget, true,
            'the default table no longer pays exactly the contracted week — the tip says it does');
        assert.ok(Number(F.days) < F.ceiling, `${F.days} contracted days a year is not under the ${F.ceiling} ceiling — the tip says it is`);
        assert.match(tip, /no longer on the shortlist — the shortlisted designs staff the same number of duties each day/);
        assert.ok(PROPOSALS.length > 0, 'premise: there is a shortlist');
        for (const p of PROPOSALS) {
            /** @type {Record<string, number>} */ const n = {};
            let cover = 0;
            for (const row of Object.values(p.patterns)) {
                if (isCoverWeek(row)) cover++;
                for (const [d, v] of Object.entries(row)) if (/^\d/.test(String(v))) n[d] = (n[d] ?? 0) + 1;
            }
            for (const d of ['mon', 'tue', 'wed', 'thu', 'fri']) assert.equal(n[d], F.weekday, `${p.name}: ${d}`);
            assert.equal(n.sat, F.sat, `${p.name}: Saturday`);
            assert.equal(n.sun, F.sun, `${p.name}: Sunday`);
            assert.equal(cover, F.cover, `${p.name}: cover weeks`);
        }
        assert.ok(words(CARD_TIPS, 'links-checks').includes(`Aim for at least ${WEEKENDS_OFF_AIM_PCT}% of weeks`));
    });

    test('Design checks: every section the card draws is explained', async () => {
        const { CARD_TIPS } = await import('../links-tips.js');
        const card = src('links-analysis.js');
        const tip = words(CARD_TIPS, 'links-checks');
        for (const [drawn, said] of [['<strong>Hours a week</strong>', 'Hours a week'], ['Company limits <span', 'Company limits'],
            ['Fatigue factors <span', 'Fatigue factors'], ['For comparison — today\'s link', 'For comparison — today\'s link']]) {
            assert.ok(card.includes(drawn), `links-analysis.js no longer draws "${said}" — re-read the checks tip`);
            assert.ok(tip.includes(said), `the checks tip does not explain "${said}"`);
        }
        assert.match(tip, /not pass\/fail limits/, 'the ORR factors are explained as factors present, never pass or fail');
    });

    // A CELL COUNTS EVERYONE ON AT ANY POINT IN ITS HOUR (links-analysis-1, routed to links-tips.js): the
    // tip said "more people on at once", and the card now reports a gap inside an hour whose cell is not 0.
    test('Coverage: a cell counts everyone on at some point in its hour, and a shorter gap is named by the note', async () => {
        const { CARD_TIPS } = await import('../links-tips.js');
        assert.match(src('links-analysis.js'), /Each cell counts everyone on duty at any point in that hour/,
            'the card\'s own note changed — re-read the coverage tip against it');
        const tip = words(CARD_TIPS, 'links-coverage');
        assert.match(tip, /more people on duty at some point in that hour/);
        assert.doesNotMatch(tip, /at once/);
        assert.match(tip, /gap shorter than an hour .* still shows a number/);
    });

    // THE MINIMUM REST IS THE GENERATOR'S OWN CONSTANT (links-analysis-14's twins, routed here): the
    // rest tip and the line-order card's load-bearing note each TYPED "12 hours". Both are 12 today, so
    // the tip is evaluated with a stand-in minimum, and the note must be a stamped span, never a figure.
    test('the minimum rest is read from MIN_REST_MINUTES in the tip, and stamped into the page\'s note', async () => {
        assert.match(words(TIPS['links-tips.js'], 'links-checks'), new RegExp(`for less than ${MIN_REST_MINUTES / 60} hours rest`));
        const moved = await tipsWith('links-tips.js', 'links-design.js', { MIN_REST_MINUTES: 11 * 60 });
        assert.match(words(moved, 'links-checks'), /for less than 11 hours rest/, 'a moved minimum moves the tip');
        const note = src('links.html').match(/<p class="gen-obj-note">([\s\S]*?)<\/p>/)?.[1] ?? '';
        assert.match(note, /less than <span class="js-min-rest-hours">\d+<\/span> hours between a Saturday finish/,
            'the note states the minimum through the stamped span');
        assert.match(src('links-app.js'), /'\.js-min-rest-hours'\)\) el\.textContent = String\(MIN_REST_MINUTES \/ 60\)/,
            'and links-app.js stamps it from the constant');
    });
});

for (const { js, html, noCardHeading } of PAGES) {
    describe(`${js} — tips content`, () => {
        const tips = TIPS[js];

        test('every entry has a title and a non-empty sections ARRAY', () => {
            const broken = Object.entries(tips)
                .filter(([, v]) => !v || typeof v.title !== 'string' || !Array.isArray(v.sections) || !v.sections.length)
                .map(([k, v]) => `${k} (sections: ${JSON.stringify(v && v.sections)})`);
            assert.deepEqual(broken, [],
                `${js}: these entries do not match the shape tips-lightbox.js renders:\n  ` +
                broken.join('\n  ') +
                '\nThe renderer does `for (const section of tips.sections)`, so a flat ' +
                '`{ title, items }` throws "tips.sections is not iterable" the moment the ? is tapped.');
        });

        test('every section carries an items array, and every item an icon + html', () => {
            const broken = [];
            for (const [key, v] of Object.entries(tips)) {
                (v.sections || []).forEach((sec, i) => {
                    if (!Array.isArray(sec.items) || !sec.items.length) {
                        broken.push(`${key}.sections[${i}] has no items array`);
                        return;
                    }
                    sec.items.forEach((item, j) => {
                        if (typeof item.icon !== 'string' || typeof item.html !== 'string') {
                            broken.push(`${key}.sections[${i}].items[${j}] is missing icon/html`);
                        }
                    });
                });
            }
            assert.deepEqual(broken, [], `${js}:\n  ${broken.join('\n  ')}`);
        });

        test(`every ? button in ${html} has content behind it`, () => {
            // The other half of the same failure: a button whose key is absent hits the renderer's
            // `if (!tips) return`, so it throws nothing and does nothing — a silently dead control,
            // which is harder to notice than a crash.
            const missing = readWiredCards(html).filter(k => !(k in tips));
            assert.deepEqual(missing, [],
                `${html}: ? button(s) with no CARD_TIPS entry: ${missing.join(', ')}. The panel opens ` +
                'to nothing — the button is inert rather than broken, so no error is ever reported.');
        });

        test(`every entry in ${js} is reachable from a ? button`, () => {
            const wired = new Set(readWiredCards(html));
            const orphans = Object.keys(tips).filter(k => !wired.has(k));
            assert.deepEqual(orphans, [],
                `${js}: CARD_TIPS entries no button can open: ${orphans.join(', ')}. Either the card ` +
                'lost its ? button or the key was renamed on one side only.');
        });

        // ── HOUSE STYLE, AS RENDERED (lightbox review R2, Nov 2026) ─────────────────────────────────
        // Visible copy uses ’ and “ ”, and a straight quote had drifted into four of these modules (36
        // apostrophes and 4 double quotes) because nothing looked. Read as the lightbox shows it, tags
        // stripped, so an attribute's own quotes (an href) are not counted.
        // links-tips.js is left out of both checks below only because another session owns the Links page.
        if (js !== 'links-tips.js') test(`no tip in ${js} shows a straight apostrophe or double quote`, () => {
            const straight = [];
            for (const [key, v] of Object.entries(tips)) {
                const texts = [v.title, ...v.sections.flatMap((/** @type {any} */ s) => [s.heading ?? '', ...s.items.map((/** @type {any} */ i) => i.html)])];
                for (const t of texts.map(h => String(h).replace(/<[^>]+>/g, ''))) {
                    if (/[A-Za-z]'[A-Za-z]|"/.test(t)) straight.push(`${key}: ${t.slice(0, 80)}`);
                }
            }
            assert.deepEqual(straight, [], `${js}: use ’ for an apostrophe and “ ” for quotes in visible copy`);
        });

        // A panel title is the dialog's aria-label (tips-lightbox.js), so an emoji there is read out before
        // the title; the card's header carries the emoji. And the title is the card's heading, so the
        // panel a reader opens is named as the card they opened it from ("Weekly Roster upload" was not).
        // Team Week View has no card, so no h2 to match: its title is the view's own name, checked with no emoji below.
        if (js !== 'links-tips.js' && !noCardHeading) test(`every panel title in ${js} is its card's heading, with no emoji`, () => {
            const page = readFileSync(html, 'utf8');
            const wrong = [];
            for (const m of page.matchAll(/class="[^"]*btn-card-tips[^"]*"[^>]*data-card="([^"]+)"/g)) {
                const h2 = [...page.slice(0, m.index).matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].pop()?.[1] ?? '';
                const heading = h2.replace(/<span aria-hidden="true">[^<]*<\/span>/g, '').replace(/<[^>]+>/g, '').trim();
                const title = tips[m[1]]?.title ?? '';
                if (/\p{Extended_Pictographic}/u.test(title) || title !== heading) wrong.push(`${m[1]}: title “${title}”, card “${heading}”`);
            }
            assert.deepEqual(wrong, []);
        });
    });
}

// ── THE LEAVE SHEET'S AGE LIMIT IS THE FILE'S OWN CONSTANT (R2-19) ──────────────────────────────
// "14 days" was typed twice in the panel while al-leave-file.js holds LEAVE_FILE_MAX_AGE_DAYS. Built
// with a stand-in, the panel must say the stand-in in both places.
describe('operations-tips.js — the leave sheet panel reads LEAVE_FILE_MAX_AGE_DAYS', () => {
    test('both of its age lines follow the constant', async () => {
        const text = JSON.stringify((await tipsWith('operations-tips.js', 'al-leave-file.js', { LEAVE_FILE_MAX_AGE_DAYS: 21 }))['annual-leave-sheet']);
        assert.equal(text.match(/more than 21 days old/g)?.length, 2, text);
        assert.doesNotMatch(text, /\b14 days\b/);
    });
});
