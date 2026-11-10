/**
 * paycalc-role-card.test.mjs — what the Pay Calculator says to somebody it will not price (v25.50).
 * Run: node scripts/run-tests.mjs paycalc-role-card.test.mjs   (part of `npm run test:hygiene`)
 *
 * The WORDS are the feature here: the calculator already refused a Dispatcher and a manager (v21.78),
 * and what changed is that each is now told what the calculator is for, in terms true of THEM. So the
 * assertions are about the properties of each message that would be wrong if they went — a promise
 * with a date, a "will be added" to a manager, a PIN line implying the PIN signs anybody in — rather
 * than about the exact strings, which may be reworded freely. The browser side (that the right card
 * actually shows, with the calculator withheld) is `e2e/paycalc.spec.js`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { unsupportedRoleCopy, paintRoleCard, PAYCALC_SIGN_IN_ABOUT, PAYCALC_GUIDE_URL } from './paycalc-role-card.js';

const ALL = (/** @type {{ title: string, what: string|null, why: string }} */ c) => [c.title, c.what ?? '', c.why].join(' ');
/** An undated promise, in any of the forms staff copy has used (CLAUDE.md → "account recovery"). */
const UNDATED_PROMISE = /coming soon|in a future update|in due course|shortly/i;

test('a Dispatcher is told their pay is not covered YET — and the real condition for adding it, never a date', () => {
    const c = unsupportedRoleCopy('Dispatcher');
    assert.match(c.title, /Dispatcher pay yet/);
    assert.match(c.why, /once Dispatcher rates are confirmed/, 'the condition is information the admin must obtain — say so');
    assert.doesNotMatch(ALL(c), UNDATED_PROMISE);
    assert.doesNotMatch(ALL(c), /\b(19|20)\d\d\b|January|February|March|April|May|June|July|August|September|October|November|December/,
        'no date: the condition is the rates, not a calendar');
});

test('a manager is told who the calculator is for and why they might point their team at it — with nothing promised', () => {
    const c = unsupportedRoleCopy('Management');
    assert.match(c.title, /for CEAs and CESs/);
    assert.match(c.why, /team/);
    // Managers are not in line for it, so "yet" or "will be added" would be untrue for this reader.
    assert.doesNotMatch(ALL(c), /\byet\b|will be added|ask the admin/i);
});

test('a role nobody planned for gets the general refusal, which names the gap and the way to ask', () => {
    const c = unsupportedRoleCopy('Station Manager');
    assert.match(c.title, /isn't available for your role yet/);
    assert.match(c.why, /confirmed rates for CEA and CES/);
    assert.match(c.why, /ask the admin/, 'an app matter goes to the admin (CLAUDE.md wording conventions)');
});

test('a name the roster no longer holds is told THAT — not a role gap, and not a description of a page it cannot use', () => {
    for (const role of [undefined, null, '']) {
        const c = unsupportedRoleCopy(role);
        assert.match(c.title, /isn't on the current roster/);
        assert.equal(c.what, null);
        assert.match(c.why, /Ask the admin to check your name/);
    }
});

test('every refusal that explains the calculator names both grades IN FULL on first sight, and what it works out', () => {
    for (const role of ['Dispatcher', 'Management', 'Station Manager']) {
        const what = /** @type {string} */ (unsupportedRoleCopy(role).what);
        assert.match(what, /Customer Experience Ambassador's or Supervisor's \(CEA or CES\)/, `${role}: expand the term before using it`);
        assert.match(what, /take-home pay/);
        assert.match(what, /tax, National Insurance and pension/);
    }
});

test('no refusal is written as a warning — calm and factual, no exclamation marks', () => {
    for (const role of ['Dispatcher', 'Management', 'Station Manager', undefined]) {
        assert.doesNotMatch(ALL(unsupportedRoleCopy(role)), /!/);
    }
});

test('the sign-in explanation names both grades in full, says the PIN does not open the page, and links the guide', () => {
    const text = PAYCALC_SIGN_IN_ABOUT.lines.join(' ');
    assert.match(text, /Customer Experience Ambassadors and Supervisors \(CEA and CES\)/);
    assert.match(text, /you sign in as yourself/);
    assert.match(text, /staff PIN doesn't open it/);
    // AUTH_AND_SESSIONS.md 18: the PIN is a barrier, not a sign-in — no surface may imply it signs anybody in.
    assert.doesNotMatch(text + ' ' + PAYCALC_SIGN_IN_ABOUT.footnote, /PIN\b[^.]*\b(signs?|logs?) (you |them |somebody |anyone )?in\b/i);
    assert.match(PAYCALC_SIGN_IN_ABOUT.footnote, /shared screen/);
    assert.equal(PAYCALC_SIGN_IN_ABOUT.link.href, PAYCALC_GUIDE_URL);
    assert.doesNotMatch(text + ' ' + PAYCALC_SIGN_IN_ABOUT.footnote, /!/);
});

test('the guide every card links to exists, as a same-origin relative path the sign-in card will accept', () => {
    assert.equal(PAYCALC_GUIDE_URL, './paycalc-guide.html');
    assert.ok(existsSync(new URL('./paycalc-guide.html', import.meta.url)), 'paycalc-guide.html is missing');
    // login-overlay.js → fillAbout drops a link that is not a relative path, silently: pin the shape here.
    assert.match(PAYCALC_SIGN_IN_ABOUT.link.href, /^\.\/[\w.\-/#?=&]*$/);
});

test('paintRoleCard writes the three slots, and hides the whole "What it does" box where a card has none', () => {
    /** @type {Record<string, { textContent: string, hidden: boolean }>} */
    const els = {
        unsupportedGradeTitle: { textContent: '', hidden: false },
        unsupportedGradeWhat:  { textContent: '', hidden: false },
        unsupportedGradeWhy:   { textContent: '', hidden: false },
        unsupportedGradeAbout: { textContent: '', hidden: false },
    };
    const doc = /** @type {any} */ ({ getElementById: (/** @type {string} */ id) => els[id] ?? null });

    paintRoleCard({ role: 'Dispatcher' }, doc);
    assert.equal(els.unsupportedGradeTitle.textContent, unsupportedRoleCopy('Dispatcher').title);
    assert.equal(els.unsupportedGradeWhy.textContent, unsupportedRoleCopy('Dispatcher').why);
    assert.equal(els.unsupportedGradeAbout.hidden, false);
    assert.match(els.unsupportedGradeWhat.textContent, /take-home pay/);

    // A leaver after a Dispatcher on the same page object: the explanation must go, not linger —
    // and the BOX goes, heading and guide link included, not only its sentence.
    paintRoleCard({ role: null }, doc);
    assert.match(els.unsupportedGradeTitle.textContent, /isn't on the current roster/);
    assert.equal(els.unsupportedGradeAbout.hidden, true);
    assert.equal(els.unsupportedGradeWhat.textContent, '');

    // ...and a manager after the leaver gets it back.
    paintRoleCard({ role: 'Management' }, doc);
    assert.equal(els.unsupportedGradeAbout.hidden, false);

    paintRoleCard(null, doc);   // no member at all — the coordinator passes one built from the session name
    assert.match(els.unsupportedGradeTitle.textContent, /isn't on the current roster/);
});
