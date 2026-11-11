/**
 * welcome-email-parity.test.mjs — four copies of the welcome email, kept as ONE email.
 * Run: node scripts/run-tests.mjs welcome-email-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * `.claude/skills/new-starter/` holds the welcome email four times. `welcome-email.html` is the
 * general template: a `{{GRADE}}` slot and two either/or blocks (the opening, and the Pay Calculator
 * section). The other three are ready-made copies with those choices already made, one for each
 * grade a colleague signs in under, so that everybody in a grade is sent the same email (owner:
 * the CEA's 8 Nov 2026, the supervisor's and the Dispatcher's 11 Nov 2026).
 *
 * The copies are only worth having if they ARE the same email. A correction made in one file and
 * not the other three is a colleague told something the rest were not, and four hand-kept copies
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
 * ── THE PIN ─────────────────────────────────────────────────────────────────────────────────────
 *
 * The real staff PIN must never be written into these files: it lives only in the
 * CALENDAR_VIEWER_PIN secret. No test can look for the digits, because a test that knew them would
 * be the leak. One CAN check the box they would be typed into, so in all four files the PIN box
 * must hold the placeholder and nothing else. A copy filled in for a real colleague and saved over
 * a template fails as well, because its placeholders are gone.
 *
 * And a failure must not repeat what it found. These messages land in a public CI log, so the PIN
 * box's contents are never printed, and any four-digit run in a printed snippet is masked.
 *
 * ── WHAT IT CANNOT SEE ──────────────────────────────────────────────────────────────────────────
 *
 * The PIN written anywhere other than its box. Whether the wording is RIGHT, only that the four
 * copies agree. The header comments, which differ by design.
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
});

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
 * The general template with one grade's choices made, as the three copies make them: the opening
 * for somebody already working at Marylebone, the grade, and the Pay Calculator section the app
 * says that grade gets.
 * @param {string} grade
 */
function choose(grade) {
    let html = read(GENERAL);
    // The opening: the new starter's paragraph goes (everything from its marker to the next one's),
    // and the existing-staff one, written inside a comment, comes out of it.
    html = replaceOnce(html, /<!-- OPENING A — NEW STARTER -->[\s\S]*?(?=<!-- OPENING B — EXISTING STAFF)/, '',
        'OPENING A (new starter) block');
    html = replaceOnce(html, /<!-- OPENING B — EXISTING STAFF\s*([\s\S]*?)\s*-->/, '$1',
        'OPENING B (existing staff) block');
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

/** The PIN box: the big text under the "The staff PIN" label. */
const PIN_BOX = /The staff PIN<\/div>\s*<div\b[^>]*>([\s\S]*?)<\/div>/g;

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
                `in all four files.${firstDifference(got, want)}`);
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
        const works = text.includes('so it works for you');
        const doesNot = text.includes('The Pay Calculator will not work for you yet.');
        assert.ok(works !== doesNot, `${file} should carry exactly one of the two Pay Calculator sections`);
        assert.equal(works, gradeForRole(grade) !== null,
            `${file}: the Pay Calculator ${gradeForRole(grade) ? 'has' : 'has no'} ${grade} rates ` +
            `(gradeForRole), so its email must say it ${gradeForRole(grade) ? 'works' : 'does not work yet'}`);
    }
});

test('the PIN box holds the placeholder and nothing else, in all four files', () => {
    for (const file of [GENERAL, ...Object.keys(COPIES)]) {
        const boxes = [...read(file).matchAll(PIN_BOX)];
        assert.equal(boxes.length, 1, `${file} should have one PIN box (the text under "The staff PIN")`);
        // Never print what is in the box: if this fails, what is there may be the PIN.
        assert.ok(boxes[0][1].trim() === '{{STAFF_PIN}}',
            `${file}: the PIN box holds something other than {{STAFF_PIN}}. The real PIN is never ` +
            'written into these files; it goes in the mail client.');
    }
});

test('what is left to fill is exactly what each header lists', () => {
    const left = ['{{FIRST_NAME}}', '{{PASSWORD}}', '{{ROSTER_NAME}}', '{{STAFF_PIN}}'];
    assert.deepEqual(placeholders(read(GENERAL)), ['{{FIRST_NAME}}', '{{GRADE}}', '{{PASSWORD}}', '{{ROSTER_NAME}}', '{{STAFF_PIN}}'],
        `${GENERAL} should leave its five placeholders, {{GRADE}} among them`);
    for (const file of Object.keys(COPIES)) {
        // Fewer means a copy filled in for somebody was saved over the template; more, a slot no
        // header tells the sender to fill.
        assert.deepEqual(placeholders(read(file)), left, `${file} should leave exactly ${left.join(', ')}`);
    }
});
