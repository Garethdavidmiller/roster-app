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
