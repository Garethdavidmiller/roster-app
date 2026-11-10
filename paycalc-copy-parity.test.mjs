/**
 * paycalc-copy-parity.test.mjs — the copy that decides WHERE a member types a number.
 * Run: node --test paycalc-copy-parity.test.mjs   (part of `npm run test:hygiene`)
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
    return sub[1].replace(/<[^>]+>/g, '').trim();
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
        const card = /<span class="pay-name">([^<]*)<span class="pay-rate">\+2 hrs<\/span>/.exec(guide);
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
