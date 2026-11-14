/**
 * Static guard for the four pages' CARD_TIPS content.
 * Run: node scripts/run-tests.mjs tips-content.test.mjs   (part of `npm run test:hygiene`)
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
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROTATING_LINES, DEFAULT_MAX_RUN, MIN_REST_MINUTES } from './links-design.js';
// trains-tips.js reads its dates and numbers from the page's own modules (v24.83), so it is evaluated
// with the same values.
import { CHANGE_DATE, FURTHER_CHANGES_UNTIL, DEC_VALID_UNTIL, LEAF_FALL } from './trains-data.js';
import { MAX_SHIFT_MIN, NEAR_WINDOW_MIN, dateWords, JOURNEY_PLANNER_URL } from './trains-change.js';
import { DAYTIME, renderFurtherChanges } from './trains-render.js';

/**
 * Pages that own a CARD_TIPS block, paired with the HTML whose `?` buttons consume it.
 *
 * `scope` names the coordinator constants a page's tips strings interpolate. Only Links has any:
 * four of its entries state the rotation length and one states the main cycle's length, and
 * `links-rotation-parity.test.mjs` requires the former to be DERIVED rather than typed (the length
 * went 28 → 22 at v19.98 and left prose behind in fifteen places). So the two guards pull in
 * opposite directions unless this one supplies the binding — and it supplies the modules' REAL
 * constants, not stand-ins, so a tips string quoting the wrong number would still have to be wrong
 * about something else to pass.
 */
const PAGES = [
    { js: 'admin-app.js',      html: 'admin.html' },
    { js: 'operations-tips.js', html: 'operations.html' },
    { js: 'settings-app.js',   html: 'settings.html' },
    { js: 'links-tips.js',     html: 'links.html', scope: { ROTATING_LINES, DEFAULT_MAX_RUN, MIN_REST_MINUTES } },
    { js: 'overtime-tips.js',  html: 'overtime.html' },
    { js: 'trains-tips.js',    html: 'trains.html', scope: { CHANGE_DATE, FURTHER_CHANGES_UNTIL, DEC_VALID_UNTIL, LEAF_FALL, MAX_SHIFT_MIN, NEAR_WINDOW_MIN, dateWords, DAYTIME, JOURNEY_PLANNER_URL, renderFurtherChanges } },
];

/**
 * Extract and evaluate the CARD_TIPS object literal. Evaluating rather than regexing is deliberate:
 * the defect that prompted this file was a SHAPE error, and a regex for `sections:` would have
 * happily matched the string "sections" anywhere in the entry's HTML.
 * @param {string} file
 * @param {Record<string, unknown>} [scope] coordinator constants the strings interpolate
 */
function readCardTips(file, scope = {}) {
    const src = readFileSync(file, 'utf8');
    const at = src.indexOf('CARD_TIPS = {');
    assert.ok(at > -1, `${file}: no CARD_TIPS block found`);
    const start = src.indexOf('{', at);
    let depth = 0, end = -1;
    for (let i = start; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) { end = i; break; }
    }
    assert.ok(end > -1, `${file}: CARD_TIPS block is not brace-balanced`);
    // The scope is passed as real parameters rather than assembled into the source string: a
    // textual prelude would make an undefined identifier resolve to whatever the harness happened
    // to have lying about, which is how a guard stops guarding without anyone noticing.
    const names = Object.keys(scope);
    return new Function(...names, 'return (' + src.slice(start, end + 1) + ');')(
        ...names.map(n => scope[n]));
}

/** The `data-card` values actually wired to a `?` button. @param {string} file */
function readWiredCards(file) {
    const html = readFileSync(file, 'utf8');
    return [...html.matchAll(/class="[^"]*btn-card-tips[^"]*"[^>]*data-card="([^"]+)"/g)].map(m => m[1]);
}

// paycalc has the SAME contract under a different name, and it was unguarded until this review.
// `HELP_CONTENT` (paycalc-help.js) is keyed by `data-help`, lives in a different file from its
// renderer (paycalc-lightboxes.js), and is consumed with `data.tips.map(...)` — so a missing `tips`
// throws exactly like `tips.sections` did, and a missing key gives the same silently-inert button.
// It is clean today; it is covered here so it stays that way. (The nav-panel arrays are deliberately
// NOT covered: they are module-internal constants sitting directly above their own renderer, so an
// editor sees both at once — the cross-FILE separation is what let the reset-requests bug through.)
const { HELP_CONTENT } = await import('./paycalc-help.js');   // top level: .mjs allows it

describe('paycalc-help.js — HELP_CONTENT', () => {
    const html = readFileSync('paycalc.html', 'utf8');
    const wired = [...html.matchAll(/data-help="([^"]+)"/g)].map(m => m[1]);

    test('every entry has a title and a non-empty tips ARRAY', () => {
        const broken = Object.entries(HELP_CONTENT)
            .filter(([, v]) => !v || typeof v.title !== 'string' || !Array.isArray(v.tips) || !v.tips.length)
            .map(([k, v]) => `${k} (tips: ${JSON.stringify(v && v.tips)})`);
        assert.deepEqual(broken, [],
            `paycalc-help.js: ${broken.join(', ')} — the renderer does \`data.tips.map(...)\`, so a ` +
            'missing or non-array tips throws the moment the ? is tapped.');
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
        const { GRADES } = await import('./paycalc-calc.js');
        const tipOf = (/** @type {any} */ mod) => mod.HELP_CONTENT.hours.tips.find((/** @type {string} */ t) => t.startsWith('Your contract includes'));
        assert.match(tipOf({ HELP_CONTENT }), new RegExp(`${GRADES.cea.contr} hours per period`));
        const saved = [GRADES.cea.contr, GRADES.ces.contr];
        try {
            GRADES.cea.contr = 150; GRADES.ces.contr = 150;
            assert.match(tipOf(await import('./paycalc-help.js?same')), /150 hours per period.*both 150 hours/);
            GRADES.ces.contr = 147;
            assert.match(tipOf(await import('./paycalc-help.js?differ')), /CEA 150, CES 147/);
        } finally { [GRADES.cea.contr, GRADES.ces.contr] = saved; }
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
        const hint = /<span class="hint">Staff who tapped “([^”]+)”/.exec(readFileSync('operations.html', 'utf8'))?.[1];
        assert.ok(hint && link.startsWith(hint), `operations.html quotes "${hint}"; the link reads "${link}"`);
    });

    test('the ? panel quotes the link in full', () => {
        const first = readCardTips('operations-tips.js')['reset-requests'].sections[0].items[0].html;
        assert.equal(/“([^”]+)”/.exec(first)?.[1], link);
    });
});

// ── WHAT SETTINGS SAYS YOU WILL GET (Nov 2026 review) ───────────────────────────────────────────
// The Notifications card lists the kinds of notification a member agrees to; its ? panel lists them
// again. The card gained "Timetable changes" at v24.97 and the panel did not, under a comment insisting
// it named every kind. Each list is held to the other: every kind on the card is named in the panel's
// "What you'll get", and the panel names nothing the card does not. The card uses the short form of a
// name ("Retail Circular"), the panel the full one ("Weekly Retail Circular"), so the panel's name must
// END with the card's.
describe('settings — the ? panel names the notifications the card lists', () => {
    const card = [...readFileSync('settings.html', 'utf8').matchAll(/<span class="notif-kind">([^<]+?)(?: ·)?<\/span>/g)]
        .map(m => m[1].trim());
    const got = readCardTips('settings-app.js').notifications.sections.find((/** @type {any} */ s) => /get/.test(s.heading ?? ''));
    const named = (got?.items ?? []).map((/** @type {any} */ i) => /<strong>([^<]+)<\/strong>/.exec(i.html)?.[1] ?? '');

    test('premise: both lists were found', () => {
        assert.ok(card.length >= 4, `settings.html: found ${card.length} .notif-kind spans`);
        assert.ok(named.length >= 4, 'settings-app.js: no "What you\'ll get" section in the notifications tips');
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

// ── THE PAY REMINDER SAYS WHO IT REACHES (whole-app check, 10 Nov 2026) ─────────────────────────
// Since contracts-b-3 the server sends it only to the grades the Pay Calculator prices, and the panel
// still promised it to everybody — a Dispatcher or a manager agreed to a reminder that never comes.
// The grades are read from the server's own list, so the panel and the send cannot part.
describe('settings — the ? panel says who the pay reminder is for', () => {
    const server = readFileSync('functions/pay-reminder.js', 'utf8');
    const list = /PAY_REMINDER_GRADES\s*=\s*Object\.freeze\(\[([^\]]*)\]\)/.exec(server)?.[1] ?? '';
    const grades = [...list.matchAll(/'(\w+)'/g)].map(m => m[1].toUpperCase());
    const got = readCardTips('settings-app.js').notifications.sections.find((/** @type {any} */ s) => /get/.test(s.heading ?? ''));
    const item = (got?.items ?? []).map((/** @type {any} */ i) => String(i.html)).find((/** @type {string} */ h) => h.startsWith('<strong>Pay reminder</strong>')) ?? '';

    test('premise: the server\'s grades and the panel\'s item were found', () => {
        assert.ok(grades.length > 0, 'functions/pay-reminder.js: PAY_REMINDER_GRADES was not found');
        assert.ok(item, 'settings-app.js: no Pay reminder item in "What you\'ll get"');
    });
    test('the item names every grade the server sends it to', () => {
        for (const g of grades) assert.match(item, new RegExp(`\\b${g}\\b`), `the panel promises the reminder without saying it is for ${g} colleagues: ${item}`);
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
    const tip = readCardTips('settings-app.js')['work-email'].sections.flatMap((/** @type {any} */ s) => s.items)
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

// ── links-tips.js says what the Links page DRAWS (whole-app fix, Nov 2026 — links-app-13) ────────────
// The structural checks below cannot see prose, and four Links panels had stopped describing the page:
// a blank Coverage cell was "nobody on duty" and a red 0 a mid-day hole, after the staffed window made
// a gap any OPEN hour; the generator named a "Custom time…" option that reads "Custom…"; Generate was
// said to refuse only an underpaying table; and the Design checks panel explained five rows of a card
// that is mostly hours, company limits and ORR factors. Each test ties a sentence to the code that draws
// what it describes, so a change to either side breaks here rather than on a colleague's screen.
describe('links-tips.js — the ? panels describe the page as drawn', () => {
    const src = (/** @type {string} */ f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
    /** A panel's words, tags stripped. @param {any} tips @param {string} key */
    const words = (tips, key) => tips[key].sections.flatMap((/** @type {any} */ s) => s.items.map((/** @type {any} */ i) => i.html))
        .join(' ').replace(/<[^>]+>/g, '');

    test('Coverage: a red 0 is an OPEN hour with nobody on, and a grey hour is the station shut', async () => {
        const { CARD_TIPS } = await import('./links-tips.js');
        const note = src('links-analysis.js');
        assert.match(note, /Red 0 = the station is open and nobody is on\. Grey = outside the staffed window\./,
            'the card\'s own note changed — re-read the coverage tip against it');
        const tip = words(CARD_TIPS, 'links-coverage');
        assert.match(tip, /red 0 means a gap — the station is open and nobody is on duty/);
        assert.match(tip, /grey hour is outside the staffed window/);
        assert.doesNotMatch(tip, /blank = nobody|in the middle of that day/, 'the pre-window reading of the heat map');
    });

    test('the generator names its custom option by the label the option carries', async () => {
        const { CARD_TIPS } = await import('./links-tips.js');
        const label = src('links-app.js').match(/opt\('__custom__', '([^']+)'\)/)?.[1];
        assert.ok(label, 'the custom option\'s label was not found in links-app.js');
        const tip = words(CARD_TIPS, 'links-generator');
        assert.ok(tip.includes(`choose ${label}`), `the tip should send the designer to "${label}"`);
        assert.doesNotMatch(tip, /Custom time/);
    });

    test('the refusal is described both ways, each with its own remedies', async () => {
        const { CARD_TIPS } = await import('./links-tips.js');
        const gen = src('links-design.js');
        for (const reason of ['short-hours', 'over-hours']) assert.ok(gen.includes(`'${reason}'`), `generateLink no longer refuses with ${reason}`);
        const tip = words(CARD_TIPS, 'links-grid');
        assert.match(tip, /does not pay the contracted week exactly — under it or over it/);
        assert.match(tip, /more duties, longer ones, or more spare weeks/);
        assert.match(tip, /fewer duties, shorter ones, or fewer spare weeks/);
    });

    test('Design checks: every section the card draws is explained', async () => {
        const { CARD_TIPS } = await import('./links-tips.js');
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
        const { CARD_TIPS } = await import('./links-tips.js');
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
    test('the minimum rest is read from MIN_REST_MINUTES in the tip, and stamped into the page\'s note', () => {
        const tip = (/** @type {number} */ min) => words(readCardTips('links-tips.js', { ROTATING_LINES, DEFAULT_MAX_RUN, MIN_REST_MINUTES: min }), 'links-checks');
        assert.match(tip(MIN_REST_MINUTES), new RegExp(`for less than ${MIN_REST_MINUTES / 60} hours rest`));
        assert.match(tip(11 * 60), /for less than 11 hours rest/, 'a moved minimum moves the tip');
        const note = src('links.html').match(/<p class="gen-obj-note">([\s\S]*?)<\/p>/)?.[1] ?? '';
        assert.match(note, /less than <span class="js-min-rest-hours">\d+<\/span> hours between a Saturday finish/,
            'the note states the minimum through the stamped span');
        assert.match(src('links-app.js'), /'\.js-min-rest-hours'\)\) el\.textContent = String\(MIN_REST_MINUTES \/ 60\)/,
            'and links-app.js stamps it from the constant');
    });
});

for (const { js, html, scope } of PAGES) {
    describe(`${js} — tips content`, () => {
        const tips = readCardTips(js, scope);

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
    });
}
