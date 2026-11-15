/**
 * paycalc-copy-parity.test.mjs — the copy that decides WHERE a member types a number.
 * Run: node scripts/run-tests.mjs paycalc-copy-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * @nodeps-safe — runs on a bare checkout with nothing installed.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * Most of the Pay Calculator's correctness is arithmetic, and the arithmetic is well covered. This
 * file guards the other half: a member reading the form and deciding which box a figure goes in.
 * Put the same hours in the wrong box and every calculation downstream is perfect and the answer is
 * still wrong — by about £43 on an eight-hour day, in the case this file was written for.
 *
 * ── THE CASE, BECAUSE IT IS THE WHOLE ARGUMENT ──────────────────────────────────────────────────
 *
 * Sunday is uncontracted, so EVERY Sunday hour is 1.5× whether or not it was rostered. Saturday is
 * the one that splits — rostered (Rostered Saturday) or not (Rest Day Working) — so "was I rostered
 * for it?" is a question you must ask about a Saturday and must NOT ask about a Sunday.
 *
 * The payslip works against that. A worked Sunday prints as **"RDW Sun 1.5"** — it starts with RDW.
 * A member matching payslip lines to boxes therefore finds *Rest Day Working*, whose own subtitle
 * ("came in on a rest day") describes exactly what they did, and types it there at 1.25×.
 *
 * A real member did this on 4 Sep 2026. **The fact was already in the app, stated perfectly** — the
 * Pay Calculator Guide has a "Sunday vs RDW" tip that says precisely the right thing. It did not
 * help, because a guide has to be OPENED and she was looking at the form. That is the ROADMAP's
 * "Plain-English education pass" thesis demonstrated rather than argued: **presence somewhere is
 * not discoverability**, and the fix is to carry the fact to the point of use — not to write it a
 * fourth time somewhere new.
 *
 * ── WHAT IS ASSERTED, AND WHAT DELIBERATELY IS NOT ──────────────────────────────────────────────
 *
 * Not the wording — copy should stay free to improve. What is pinned is that the DISTINCTION is
 * present where the decision is made, in both directions, and that the payslip's own misleading
 * word is named rather than left to ambush the reader. A rewrite that keeps the meaning passes; a
 * rewrite that drops it does not, which is the only thing standing between this and a repeat.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./paycalc.html', import.meta.url), 'utf8');

/**
 * The `.h-sub` line beneath a row TITLE — the sentence a member reads before typing.
 *
 * Split on the title element rather than searching for the words. Two earlier cuts got this wrong
 * in the same direction: `indexOf(title)` resolved "Rest Day Working" to the SATURDAY row, whose
 * subtitle names it in a redirect, and a regex meant to fix that matched the first row for every
 * lookup. Both made assertions run against the wrong row, and one passed anyway. A helper that can
 * quietly return the wrong row makes every test using it meaningless, so this one is dull on purpose.
 */
const ROWS = html.split('<div class="h-title">').slice(1);
function subtitleFor(title) {
    const row = ROWS.find(chunk => chunk.slice(0, chunk.indexOf('</div>')).includes(title));
    assert.ok(row, `no row titled "${title}" in paycalc.html`);
    const sub = /<div class="h-sub">([\s\S]*?)<\/div>/.exec(row);
    assert.ok(sub, `the "${title}" row has no .h-sub explaining it`);
    return sub[1].replace(/<[^>]+>/g, '').replace(/&nbsp;|\u00a0/g, ' ').trim();   // the words, as read
}

// ── A PICKER SHEET IS TITLED WITH ITS FIELD'S OWN LABEL (whole-app review, Nov 2026) ──────────────
// The title heads the sheet AND is the trigger's accessible name (select-sheet.js → `${title}. …`),
// so a title that is not the label is a control named one thing and read as another (WCAG 2.5.3,
// Label in Name). The student-loan stop opened as "Paid off from which period?" — the "repaid"
// wording paycalc.md rules out for a loan moved to direct debit with a balance still owed.
describe('picker sheets carry their field\'s visible label', () => {
    const app = readFileSync(new URL('./paycalc-app.js', import.meta.url), 'utf8');
    // A spec may carry more after its title (a `searchLabel`, shared-ui-5), so the match runs to the brace.
    const specs = [...app.matchAll(/\{\s*id:\s*'(\w+)',\s*title:\s*'([^']+)'[^{}]*\}/g)].map(m => ({ id: m[1], title: m[2] }));
    /** The `<label for=id>` text, without its `.note` aside. @param {string} id */
    const labelFor = id => {
        const m = new RegExp(`<label for="${id}">([\\s\\S]*?)</label>`).exec(html);
        return m ? m[1].replace(/<span class="note">[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, '').trim() : null;
    };

    test('fixture: the sheets are found, and the labelled ones have labels', () => {
        assert.ok(specs.length >= 7, `initSelectSheets lists the page's dropdowns (${specs.length})`);
        for (const id of ['pensionOptOutFrom', 'slPaidOffFrom', 'ytdSrcSelect', 'backPayPeriod']) {
            assert.ok(specs.some(s => s.id === id), `${id} has a sheet`);
            assert.ok(labelFor(id), `${id} has a visible label`);
        }
    });

    test('every labelled field\'s sheet title contains its label, word for word', () => {
        for (const { id, title } of specs) {
            const label = labelFor(id);
            if (!label) continue;   // the period picker has no visible label to carry
            assert.ok(title.toLowerCase().includes(label.toLowerCase()),
                `#${id}: the sheet is titled "${title}" but the field reads "${label}"`);
        }
    });

    test('no sheet says a loan was repaid or paid off — only that deductions stopped', () => {
        for (const { id, title } of specs) assert.ok(!/repaid|paid off/i.test(title), `#${id}: "${title}"`);
    });
});

describe('Sunday vs Rest Day Working, at the point of use', () => {
    test('the Rest Day Working row sends a Sunday elsewhere', () => {
        // The row she was reading. Its Saturday sibling has always done this — "if you weren't
        // scheduled to work that Saturday, use Rest Day Working instead" — and this one did not,
        // so the redirect existed in one direction only.
        const sub = subtitleFor('Rest Day Working');
        assert.match(sub, /Sunday/i,
            'Rest Day Working says nothing about Sundays. Its own description ("came in on a rest '
            + 'day") fits a worked Sunday exactly, so without the redirect it collects them — at '
            + '1.25× instead of 1.5×.');
        assert.match(sub, /Sunday Working/,
            'it must name the box to use instead, not merely say "not Sundays"');
    });

    test('and it names the payslip line that sends people there', () => {
        // The mechanism, not just the rule. Somebody reading their payslip sees RDW and follows it;
        // being told the payslip is the misleading part is what stops the next person.
        assert.match(subtitleFor('Rest Day Working'), /RDW Sun/,
            'the trap is that the payslip calls a worked Sunday "RDW Sun 1.5". A member matching '
            + 'payslip lines to boxes needs that named here, where they are about to get it wrong.');
    });

    test('the Sunday Working row closes the "but I was not rostered" doubt', () => {
        // The other direction. A member who picked up an unrostered Sunday reasonably wonders
        // whether the Sunday box is really for them — Saturday, after all, splits on exactly that.
        const sub = subtitleFor('Sunday Working');
        assert.match(sub, /rostered or not|whether or not|always pays/i,
            'Sunday Working must say it applies whether or not the Sunday was rostered — that is '
            + 'the doubt that sends somebody to Rest Day Working in the first place.');
        assert.match(sub, /1\.5/, 'and state the rate, so the two boxes are visibly different');
    });

    test('both rows still name their payslip line', () => {
        // The app's own "name → one sentence → where you see it in the real world" pattern. It is
        // what makes the rows checkable against a payslip at all, which is what a member does.
        for (const row of ['Sunday Working', 'Rest Day Working', 'Rostered Saturday']) {
            assert.match(subtitleFor(row), /on your payslip/,
                `${row} no longer tells the member what to look for on the payslip`);
        }
    });

    test('the guide still carries the full explanation, as the deep dive', () => {
        // Point-of-use copy is a sentence; the guide is where the reasoning lives. Moving the fact
        // to the form must not mean deleting it from the place somebody goes to understand it.
        const guide = readFileSync(new URL('./paycalc-guide.html', import.meta.url), 'utf8');
        assert.match(guide, /Sunday vs RDW/,
            'the guide\'s "Sunday vs RDW" tip is the deep-dive layer for this distinction');
    });
});

// ── A ROW OR A CARD SAYS WHAT IT IS FOR, AND ONLY THAT ──────────────────────────────────────────
describe('a row or a card says what it is for, and only that', () => {
    const guide = readFileSync(new URL('./paycalc-guide.html', import.meta.url), 'utf8');
    const text = (/** @type {string} */ s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

    test('peer training never reads as the training a member attends (paycalc-3-18)', () => {
        // The Calendar calls a day a member ATTENDS training a Training day. A stepper row titled
        // "Training Days", each press adding two hours' basic pay, invited a trainee to count their
        // own. Peer training has no payslip line of its own (paycalc.md), so nothing ties it to that
        // name — the row says what it is, in the form and in the guide.
        const row = ROWS.find(chunk => chunk.includes('id="peerPlus"'));
        assert.ok(row, 'the peer-training stepper row is missing from paycalc.html');
        const title = text(row.slice(0, row.indexOf('</div>')));
        assert.match(title, /peer|colleague/i, `the stepper row is titled "${title}"`);
        // The rate carries its Pay-page badge colour as a modifier since v25.82 (`pay-rate--peer`).
        const card = /<span class="pay-name">([^<]*)<span class="pay-rate(?: pay-rate--[a-z]+)?">\+2 hrs<\/span>/.exec(guide);
        assert.ok(card, 'the guide\'s "+2 hrs" pay type is missing');
        assert.match(card[1], /peer|colleague/i, `the guide calls it "${card[1].trim()}"`);
    });

    test('no help tip offers "Clear all entries" as an undo (paycalc-3-11)', async () => {
        // It empties the WHOLE payslip, and the figures a Replace overwrote do not come back — so the
        // tip that paired it with "Replace … will overwrite them" sent a member to lose more, not less.
        const { HELP_CONTENT } = await import('./paycalc-help.js');
        const tips = Object.values(HELP_CONTENT).flatMap(h => h.tips).map(text);
        assert.ok(tips.some(t => /Replace with calendar values/.test(t)), 'premise: the hours help explains Replace');
        for (const t of tips) assert.doesNotMatch(t, /Clear all entries[^.]*undo|undo[^.]*Clear all entries/i, t.slice(0, 80));
    });

    test('the payslip comparison asks for the pay figure it compares: Taxable Pay (paycalc-1-15)', async () => {
        // The table sets the payslip's Taxable Pay — after the pension — against the estimate's pay
        // after the pension, and its row says so. The box it is typed into asked for "Total pay",
        // placeholder "Gross": the figure BEFORE the pension, so a member reading it typed the wrong
        // line and the row showed the whole pension as a difference.
        const { buildActualComparison } = await import('./paycalc-breakdown.js');
        const table = buildActualComparison({ actual: { gross: 1, pension: null, tax: null, ni: null, net: null },
            estimate: { gross: 1, pension: 0, tax: 0, ni: 0, net: 0 } });
        const row = /<th scope="row">([^<]+)<\/th>/.exec(table)?.[1];
        assert.equal(row, 'Taxable Pay', 'premise: the comparison names the payslip\'s own line');
        const box = /<label class="check-more-field">([^<]*)<span class="pfx">(?:(?!<\/label>)[\s\S])*?id="actualGrossInput"[^>]*placeholder="([^"]*)"/.exec(html);
        assert.ok(box, 'the comparison\'s pay box is missing from paycalc.html');
        assert.equal(text(box[1]), row, 'the box asks for one figure and the row compares another');
        assert.equal(box[2], row, 'the placeholder names a different payslip line');
    });

    test('the guide promises only the conversion the converter makes (paycalc-3-10)', () => {
        // The card has ONE input, a decimal from the payslip, and answers in hours and minutes. The
        // guide said it converted "and back", so a member typed 7:30 to get a decimal — and read "7 hrs".
        const card = html.slice(html.indexOf('id="decimalConverterCard"'), html.indexOf('id="payTransferCard"'));
        assert.equal((card.match(/<input\b/g) || []).length, 1,
            'the converter has gained a second input — the guide may now describe a reverse conversion');
        const section = guide.slice(guide.indexOf('id="pg-decimal-hours-converter"'), guide.indexOf('id="pg-data-privacy"'));
        assert.ok(section.length > 0, 'the guide\'s converter section is missing');
        assert.doesNotMatch(text(section), /and back|both ways|either way|the other way/i,
            'the guide promises a conversion the card does not make');
    });
});

// ── THE PRIVACY LINE CLAIMS WHAT THE APP CONTROLS, AND NO MORE (external review, 14 Nov 2026) ─────
// It said the figures were "never sent to any server or seen by anyone". The first half is the app's
// to promise and holds: nothing on this page uploads them (error reports carry an error's own words,
// the page and the version; a bug report is an email the member writes). The second is not: anyone
// holding the phone while the member is signed in can open the page, and the app itself makes
// readable copies (Move Your Pay Data). A promise the app cannot keep is the one a member remembers
// when it turns out untrue, so the line now says where the figures are and that the app never sends
// them anywhere — two facts, both checkable.
describe('the privacy line promises only what the app controls', () => {
    const guide = readFileSync(new URL('./paycalc-guide.html', import.meta.url), 'utf8');
    const words = (/** @type {string} */ s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const OVERCLAIM = /seen by anyone|(?:no ?one|nobody)(?: else)? (?:can|could|will) see|only you can see/i;
    /** The note at the top (first visit) and the one at the foot (every visit), by their own markup. */
    const notes = () => [
        /id="privacyNoteTop">([\s\S]*?)<\/div>/.exec(html)?.[1],
        /class="disclaimer-privacy">([\s\S]*?)<\/p>/.exec(html)?.[1],
    ];

    test('the page and the guide never promise that nobody can see the figures', () => {
        for (const [where, text] of [['paycalc.html', html], ['paycalc-guide.html', guide]]) {
            assert.doesNotMatch(words(text), OVERCLAIM,
                `${where} promises that nobody can see the pay figures — the app cannot keep that promise`);
        }
    });

    test('both notes say the same sentence: where the figures are, and that the app never sends them', () => {
        const [top, foot] = notes();
        assert.ok(top && foot, 'premise: both privacy notes are found in paycalc.html');
        assert.equal(words(top), words(foot), 'the two privacy notes have drifted apart');
        assert.match(words(foot), /this browser on this device/,
            'the note no longer says WHERE — on an iPhone, Safari and the Home Screen app keep separate copies');
        assert.match(words(foot), /never sends it to a server/, 'the note no longer says the app keeps it off the server');
    });
});

// ── THE SETTINGS CARD SAYS A FACT WHERE IT IS NEEDED, AND THE ? PANEL KEEPS THE REST (review, 15 Nov 2026) ─
// A first visit opens Settings with every hint showing, and four of them said what was already on the
// screen or what only some members need: how a promotion is priced, that the pension is kept per
// payslip (the label names the payslip), what the pension tick means (its own words again), and that
// a loan applies to every payslip (most members have no loan). Each fact MOVED rather than went, and
// this pins where each one went, so a later trim cannot take the last copy with it. Two lines were
// kept on purpose and are not tested here: the rate's "updates with each pay award on its own" (often
// the only mention, since #rateStepNote shows only on a pre-award payslip) and the Postgraduate Loan's
// "in addition to any plan above" (a member with only that loan needs it).
describe('Settings: a fact the card stopped repeating still has a home', () => {
    const words = (/** @type {string} */ s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;|\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const settingsTips = async () => (await import('./paycalc-help.js')).HELP_CONTENT.settings.tips.map(words);
    /** The markup of the element carrying this id, to the first `</div>` that ends a `<div>` it opened. */
    const block = (/** @type {string} */ id) => {
        const at = html.indexOf(`id="${id}"`);
        assert.ok(at !== -1, `#${id} is missing from paycalc.html`);
        const open = html.lastIndexOf('<div', at);
        let depth = 0;
        for (const m of html.slice(open).matchAll(/<div\b|<\/div>/g)) {
            depth += m[0] === '</div>' ? -1 : 1;
            if (depth === 0) return html.slice(open, open + /** @type {number} */ (m.index) + m[0].length);
        }
        assert.fail(`#${id} is never closed`);
    };

    test('the ? panel explains Grade — the roster, a promotion, and a grade picked by hand', async () => {
        const tip = (await settingsTips()).find(t => /^Grade:/.test(t));
        assert.ok(tip, 'the Settings help has no Grade tip, and the card no longer says how a promotion is priced');
        assert.match(tip, /From the roster/, 'the tip must explain the default the box shows');
        assert.match(tip, /promotion/i, 'the tip must say what happens when the grade changes');
        assert.match(tip, /first payslip/i, 'a grade picked by hand applies from a payslip the member names');
        // The card still expands both grades on first sight — a member may not know the letters.
        const hint = words(/id="gradeRateHint">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '');
        assert.match(hint, /Customer Experience Ambassador/);
        assert.match(hint, /Customer Experience Supervisor/);
    });

    test('the pension stays explained: per payslip, and what the not-in-the-scheme tick is for', async () => {
        const tips = await settingsTips();
        assert.ok(tips.some(t => /^Pension contribution:/.test(t) && /saved separately for each period/i.test(t)),
            'the ? panel no longer says the pension is kept per payslip');
        assert.ok(tips.some(t => /^Not in the pension scheme:/.test(t) && /opted out of or left/i.test(t)),
            'the ? panel no longer says what the tick is for');
        // The label names the payslip being edited on every visit (paycalc-app.js writes it).
        assert.match(html, /<label for="pensionAmt">Pension contribution <span id="pensionPeriodLabel"/);
    });

    test('a loan\'s every-payslip rule is said once a loan is chosen, and names the tick it sends you to', async () => {
        // Under the plan, every first visit read it and most members have no loan. #slPaidOffField
        // shows only once a loan is chosen — the condition that puts the tick under Hours (`_anyLoan`).
        const field = block('slPaidOffField');
        const rule = /id="slEveryPayslip">([\s\S]*?)<\/div>/.exec(field)?.[1];
        assert.ok(rule, 'the every-payslip rule has left the block that shows only with a loan');
        assert.match(words(rule), /every payslip/);
        const planHint = words(/<select id="studentLoan">[\s\S]*?<\/select>\s*<div class="field-hint">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '');
        assert.ok(planHint, 'premise: the plan box has its hint');
        assert.doesNotMatch(planHint, /every payslip/, 'the plan hint says it again, so every first visit reads it twice');
        // Both copies send the member to the Hours section and the tick by their real names.
        const section = words(/id="hoursShowMoreLabel">([^<]*)</.exec(html)?.[1] ?? '');
        const tick = words(/id="slSkipRow">[\s\S]*?<span class="toggle-row-text">([\s\S]*?)<\/span>\s*<\/label>/.exec(html)?.[1] ?? '');
        assert.ok(section && tick, 'premise: the Hours section and the not-deducted tick are found');
        assert.ok(words(rule).includes(section), `the Settings line names a section that is not "${section}"`);
        const loanTip = (await settingsTips()).find(t => /^Student loan:/.test(t));
        assert.ok(loanTip, 'the Settings help has no Student loan tip');
        assert.ok(loanTip.includes(tick), `the ? tip does not name the tick as it reads: "${tick}"`);
        assert.ok(loanTip.includes(section), `the ? tip does not name the section as it reads: "${section}"`);
    });
});
