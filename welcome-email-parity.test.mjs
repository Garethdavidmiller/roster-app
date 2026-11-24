/**
 * welcome-email-parity.test.mjs — the welcome email five times over, kept as ONE email.
 * Run: node scripts/run-tests.mjs welcome-email-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * `.claude/skills/new-starter/` holds the welcome email five times. `welcome-email.html` is the
 * general template: a `{{GRADE}}` slot and three either/or blocks (the opening, What it does, and the
 * Pay Calculator section). The other four are ready-made copies with those choices already made, one
 * for each grade a colleague signs in under, so that everybody in a grade is sent the same email
 * (owner: the CEA's 8 Nov 2026, the supervisor's and the Dispatcher's 11 Nov 2026, Other Staff's
 * 24 Nov 2026, when the staff PIN those colleagues used gave way to a login of their own).
 *
 * The copies are only worth having if they ARE the same email. A correction made in one file and
 * not the others is a colleague told something the rest were not, and five hand-kept copies
 * of 200 lines drift. So each ready-made copy is BUILT here from the general template, by making
 * its choices, and compared with the file as its reader sees it: comments dropped (the reader never
 * sees them, and each copy's header is its own) and runs of spacing collapsed. Anything else that
 * differs fails, and the message says where.
 *
 * ── THE PAY CALCULATOR SECTION IS THE APP'S ANSWER, NOT THIS FILE'S ─────────────────────────────
 *
 * Which section a grade gets is read from `gradeForRole` (roster-data.js), the question the Pay
 * Calculator asks before it shows a figure: a grade it has rates for gets "it works for you", any
 * other gets "it will not work for you yet". When Dispatcher rates are added this fails on the
 * Dispatcher copy, which is the point: that email would otherwise go on telling Dispatchers to
 * ignore a calculator that now works for them.
 *
 * ── OTHER STAFF HAVE NO ROSTER OF THEIR OWN ─────────────────────────────────────────────────────
 *
 * An Other Staff login (`isOtherStaff`, roster-data.js) sees everyone's roster, read-only, and nothing
 * of a member's own: no leave to record, no Pay Calculator in its menu (auth-policy.js → `otherStaff`).
 * So its copy takes the OTHER STAFF opening and What it does, drops section 4 whole, and is pinned
 * below never to say "your roster", offer to record leave or name the calculator.
 *
 * ── NO STAFF PIN ────────────────────────────────────────────────────────────────────────────────
 *
 * Section 5, "The staff PIN", and its `{{STAFF_PIN}}` box went with the PIN (owner, 23 Nov 2026):
 * only a member's own sign-in opens the app. So no file may carry that box, its placeholder or the
 * words that sent a reader to it, and the placeholder test below no longer expects it. Nor the line
 * that sign-in was needed only "to record annual leave or an absence, or to use the Pay Calculator":
 * true while the PIN showed the roster to anybody, and now a reader's reason to think they need not. A failure
 * here never prints a four-digit run (`masked`), as when the box held one.
 *
 * ── IT FITS A PHONE ─────────────────────────────────────────────────────────────────────────────
 *
 * The card used to be a fixed 600px, so a phone's mail app shrank the whole email to fit and its
 * 16px text came out at about 10px (owner, 11 Nov 2026). It is fluid now: 100% wide, capped at
 * 600px. Classic Outlook on Windows ignores the cap, so a wrapper only Outlook reads holds it at
 * 600px there. What is pinned here is what keeps it so: nothing fixed wider than the narrowest
 * phone, the card's own width 100%, and Outlook's wrapper around it. The big one-word box, the
 * password, may wrap, because a surname is one word and the longest on the roster do not fit a
 * small phone in 28px type. This reads the source. The fit itself was measured in a browser, at 320
 * to 412px with the longest surname, when the card was made fluid; it is not re-run.
 *
 * ── WHAT IT CANNOT SEE ──────────────────────────────────────────────────────────────────────────
 *
 * Whether the wording is RIGHT, only that the five copies agree. The header comments, which differ
 * by design. How a real mail app draws any of it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { CONFIG, gradeForRole } from './roster-data.js';

const DIR = new URL('./.claude/skills/new-starter/', import.meta.url);
const read = (/** @type {string} */ f) => readFileSync(new URL(f, DIR), 'utf8');

const GENERAL = 'welcome-email.html';

/** Each ready-made copy, and the grade it is for: the label the sign-in list shows. */
const COPIES = /** @type {const} */ ({
    'welcome-email-cea.html':        'CEA',
    'welcome-email-ces.html':        'CES',
    'welcome-email-dispatcher.html': 'Dispatcher',
    'welcome-email-other-staff.html': 'Other Staff',
});

/** The grade whose login has no roster of its own (roster-member-data.js → `otherStaff`). */
const OTHER_STAFF = 'Other Staff';

/** What the reader sees: comments out, spacing collapsed. Tags and inline styles stay, because the
 *  copies must LOOK the same as well as say the same. */
const visible = (/** @type {string} */ html) =>
    html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\s+/g, ' ').trim();

/** Never print a PIN: mask any run of exactly four digits in a snippet bound for the log. */
const masked = (/** @type {string} */ s) => s.replace(/\b\d{4}\b/g, '####');

/**
 * Replace the ONE match of `re`, or fail saying the general template has changed shape, which is
 * a change to this test as much as to the template.
 * @param {string} html @param {RegExp} re @param {string} by @param {string} what
 */
function replaceOnce(html, re, by, what) {
    const found = html.match(new RegExp(re.source, 'g')) || [];
    assert.equal(found.length, 1,
        `${GENERAL} should have ONE ${what} in the form this test reads, and has ${found.length}. ` +
        'If its either/or blocks were reworked, update choose() in this file to match.');
    return html.replace(re, by);
}

/**
 * The general template with one grade's choices made, as the four ready-made copies make them: the opening
 * for somebody already working at Marylebone, the grade, What it does, and the Pay Calculator section
 * the app says that grade gets — none at all for Other Staff, whose menu has no calculator.
 * @param {string} grade
 */
function choose(grade) {
    let html = read(GENERAL);
    const other = grade === OTHER_STAFF;
    // The opening: the new starter's paragraph goes (everything from its marker to the next one's),
    // and the chosen one, written inside a comment, comes out of it; the third goes whole.
    html = replaceOnce(html, /<!-- OPENING A — NEW STARTER -->[\s\S]*?(?=<!-- OPENING B — EXISTING STAFF)/, '',
        'OPENING A (new starter) block');
    html = replaceOnce(html, /<!-- OPENING B — EXISTING STAFF\s*([\s\S]*?)\s*-->/, other ? '' : '$1',
        'OPENING B (existing staff) block');
    html = replaceOnce(html, /<!-- OPENING C — OTHER STAFF[^\n]*\s*([\s\S]*?)\s*-->/, other ? '$1' : '',
        'OPENING C (Other Staff) block');
    // What it does: a member's own roster (A, written live), or the station's (B, inside a comment).
    if (other) {
        html = replaceOnce(html, /<!-- WHAT IT DOES A — WITH A ROSTER[\s\S]*?(?=<!-- WHAT IT DOES B — OTHER STAFF)/, '',
            'WHAT IT DOES A (with a roster) block');
        html = replaceOnce(html, /<!-- WHAT IT DOES B — OTHER STAFF[^\n]*\s*([\s\S]*?)\s*-->/, '$1',
            'WHAT IT DOES B (Other Staff) block');
        // Section 4, heading and both variants: the Pay Calculator is not in their menu.
        html = replaceOnce(html, /<!-- ── 4\. PAY CALCULATOR[\s\S]*?(?=<!-- ── SIGN OFF)/, '',
            'section 4 (the Pay Calculator), heading to sign-off');
        return html.replaceAll('{{GRADE}}', grade);
    }
    html = replaceOnce(html, /<!-- WHAT IT DOES B — OTHER STAFF[\s\S]*?-->/, '',
        'WHAT IT DOES B (Other Staff) block');
    if (gradeForRole(grade)) {
        html = replaceOnce(html, /<!-- VARIANT B — DISPATCHER[\s\S]*?-->/, '',
            'Pay Calculator VARIANT B (it will not work for you) block');
    } else {
        html = replaceOnce(html, /<!-- VARIANT A — CEA and CES -->[\s\S]*?(?=<!-- VARIANT B — DISPATCHER)/, '',
            'Pay Calculator VARIANT A (it works for you) block');
        html = replaceOnce(html, /<!-- VARIANT B — DISPATCHER\s*([\s\S]*?)\s*-->/, '$1',
            'Pay Calculator VARIANT B (it will not work for you) block');
    }
    return html.replaceAll('{{GRADE}}', grade);
}

/** Where two strings first part company, as two masked snippets. */
function firstDifference(/** @type {string} */ a, /** @type {string} */ b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const around = (/** @type {string} */ s) => masked(s.slice(Math.max(0, i - 70), i + 70));
    return `\n  this file: …${around(a)}…\n  expected:  …${around(b)}…`;
}

/** The placeholders the reader would see, sorted and de-duplicated. */
const placeholders = (/** @type {string} */ html) =>
    [...new Set(visible(html).match(/\{\{[A-Z_]+\}\}/g) || [])].sort();

describe('each ready-made copy is the general template with its choices made', () => {
    for (const [file, grade] of Object.entries(COPIES)) {
        test(`${file}: the ${grade} email, word for word and style for style`, () => {
            const got = visible(read(file));
            const want = visible(choose(grade));
            assert.ok(got === want,
                `${file} is not ${GENERAL} with the ${grade} choices made. A change to the wording belongs ` +
                `in all five files.${firstDifference(got, want)}`);
        });
    }
});

test('every ready-made copy is registered here, and each is for a grade the sign-in list offers', () => {
    // A fifth copy dropped into the folder would otherwise drift with nothing checking it.
    const onDisk = readdirSync(DIR).filter(f => /^welcome-email-.+\.html$/.test(f)).sort();
    assert.deepEqual(onDisk, Object.keys(COPIES).sort(),
        'every welcome-email-*.html in .claude/skills/new-starter/ needs a row in COPIES above');
    // The email says "choose <grade>". A label the list does not show sends somebody looking for it.
    for (const [file, grade] of Object.entries(COPIES)) {
        assert.ok(CONFIG.GRADE_ORDER.includes(grade),
            `${file} tells its reader to choose "${grade}", which the sign-in list does not offer`);
    }
});

test('the Pay Calculator section follows the app: the copy for a grade without rates says so', () => {
    // A guard on choose() itself, so the comparison above cannot pass by building the wrong thing.
    // The wording is the general template's own: VARIANT A's first sentence, and VARIANT B's.
    for (const [file, grade] of Object.entries(COPIES)) {
        const text = visible(read(file));
        if (grade === OTHER_STAFF) continue;   // no section at all: the next test
        const works = text.includes('so it works for you');
        const doesNot = text.includes('The Pay Calculator will not work for you yet.');
        assert.ok(works !== doesNot, `${file} should carry exactly one of the two Pay Calculator sections`);
        assert.equal(works, gradeForRole(grade) !== null,
            `${file}: the Pay Calculator ${gradeForRole(grade) ? 'has' : 'has no'} ${grade} rates ` +
            `(gradeForRole), so its email must say it ${gradeForRole(grade) ? 'works' : 'does not work yet'}`);
    }
});

test('the Other Staff copy promises nothing a login without a roster cannot do', () => {
    // A guard on choose() as much as on the copy: the comparison above cannot pass by building the
    // wrong thing. These are the general template's own words for the things such a login lacks.
    const file = Object.keys(COPIES).find(f => COPIES[/** @type {keyof typeof COPIES} */ (f)] === OTHER_STAFF);
    assert.ok(file, 'there should be an Other Staff copy');
    const text = visible(read(/** @type {string} */ (file)));
    for (const [what, re] of /** @type {const} */ ([
        ['"your roster"', /your roster/i],
        ['recording leave or an absence', /Record annual leave/],
        ['the Pay Calculator', /Pay Calculator/],
    ])) assert.doesNotMatch(text, re, `${file} offers ${what}, which an Other Staff login does not have`);
    assert.match(text, /The station&rsquo;s roster/, `${file} should say what it does show: the station's roster`);
});

test('no file carries the staff PIN — its section, its box, its placeholder or its link (retired 23 Nov 2026)', () => {
    for (const file of [GENERAL, ...Object.keys(COPIES)]) {
        const seen = visible(read(file));
        for (const [what, re] of /** @type {const} */ ([
            ['the PIN section or box', /staff PIN/i],
            ['the PIN placeholder', /\{\{STAFF_PIN\}\}/],
            ['the PIN link', /Use the staff PIN instead/i],
            ['the PIN-era sign-in line', /signed in to record annual leave/i],
        ])) {
            // Never print what matched: masked, as when the box could hold the digits.
            const m = seen.match(re);
            assert.equal(m, null, `${file} still carries ${what}: …${m ? masked(seen.slice(Math.max(0, m.index - 60), m.index + 60)) : ''}…`);
        }
    }
});
/** The narrowest phone still in use. Nothing in the email may be fixed wider than this. */
const PHONE = 320;

test('the card fits a phone, and classic Outlook still gets 600px, in all five files', () => {
    for (const file of [GENERAL, ...Object.keys(COPIES)]) {
        const raw = read(file);
        const seen = visible(raw);   // what every mail app but classic Outlook reads
        // The card: as wide as the screen, and never wider than 600px.
        const cards = seen.match(/<table\b[^>]*max-width:600px[^>]*>/g) || [];
        assert.equal(cards.length, 1, `${file} should have one card capped at max-width:600px`);
        assert.match(cards[0], /[";]width:100%;/,
            `${file}: the card's own width must be 100%, or a phone shrinks the whole email to fit it`);
        // Nothing else fixed wider than a phone: a CSS width in px, or a width attribute that the
        // element's own CSS does not replace with 100% (the card keeps width="600" for mail apps
        // that ignore CSS, which then get the old fixed card rather than something worse).
        const tooWide = [
            ...[...seen.matchAll(/(?<![-\w])width:\s*(\d+)px/g)].filter(m => +m[1] > PHONE).map(m => m[0]),
            ...[...seen.matchAll(/<\w+\b[^>]*\swidth="(\d+)"[^>]*>/g)]
                .filter(m => +m[1] > PHONE && !/[";]width:100%;/.test(m[0])).map(m => `width="${m[1]}"`),
        ];
        assert.deepEqual(tooWide, [], `${file} has something fixed wider than a ${PHONE}px phone`);
        // Classic Outlook ignores max-width, so the card sits inside a table only Outlook reads.
        const mso = raw.match(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/g) || [];
        assert.equal(mso.length, 2, `${file} should open and close Outlook's 600px wrapper, once each`);
        assert.match(mso[0], /<table\b[^>]*width="600"/, `${file}: Outlook's wrapper should hold the card at 600px`);
        assert.match(mso[1], /<\/td><\/tr><\/table>/, `${file}: Outlook's wrapper should close after the card`);
        const at = raw.search(/<table\b[^>]*max-width:600px/);   // the card's tag, not a header's mention
        assert.ok(raw.indexOf(mso[0]) < at && at < raw.indexOf(mso[1]), `${file}: Outlook's wrapper should surround the card`);
        // The big one-word box may wrap when it must.
        for (const [label, slot] of [['password', '{{PASSWORD}}']]) {
            const box = seen.match(new RegExp(`<div\\b[^>]*>${slot.replace(/[{}]/g, '\\$&')}</div>`));
            assert.ok(box && box[0].includes('overflow-wrap:anywhere'),
                `${file}: the ${label} box must be allowed to wrap, or a long surname pushes the email off a phone`);
        }
    }
});

test('what is left to fill is exactly what each header lists', () => {
    const left = ['{{FIRST_NAME}}', '{{PASSWORD}}', '{{ROSTER_NAME}}'];
    assert.deepEqual(placeholders(read(GENERAL)), ['{{FIRST_NAME}}', '{{GRADE}}', '{{PASSWORD}}', '{{ROSTER_NAME}}'],
        `${GENERAL} should leave its four placeholders, {{GRADE}} among them`);
    for (const file of Object.keys(COPIES)) {
        // Fewer means a copy filled in for somebody was saved over the template; more, a slot no
        // header tells the sender to fill.
        assert.deepEqual(placeholders(read(file)), left, `${file} should leave exactly ${left.join(', ')}`);
    }
});
