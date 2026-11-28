// @ts-check
// @lane hygiene
/**
 * glossary.test.mjs — "Glossary" (glossary.js): the words the owner asked for, one line each, and the test
 * that decides which `?` panels end with a link to it.
 * Run: node scripts/run-tests.mjs test/glossary.test.mjs   (part of `npm run test:hygiene`)
 *
 * The wiring — the drawer row, the link at a panel's foot, the panel redrawn in place — is a browser's to show
 * (e2e/glossary.spec.js).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GLOSSARY, GLOSSARY_TITLE, mentionsGlossaryTerm } from '../glossary.js';

describe('the words', () => {
    test('the words, each once, in the order a newcomer meets them', () => {
        // The owner's six (26 Nov 2026), and from 28 Nov 2026 the badges, grades and pay words the pages use without
        // explaining — BH, HPP, CEA and CES among them, so the Pay Calculator's own glossary row can go.
        assert.deepEqual(GLOSSARY.map(g => g.term), ['Early, Late, Night', 'RD', 'RDW', 'AL', 'Absent', 'Spare', 'Other', 'BH',
            'Pay cut-off', 'Lieu day', 'Year to Date', 'HPP', 'CEA', 'CES', 'Dispatcher', 'Link', 'Cover week']);
    });

    test('Spare is not a day at work: a Spare week works four of its days', () => {
        // It said "you are at work that day", and a Spare week off uses four days of leave, not six (admin-tips.js).
        const spare = GLOSSARY.find(g => g.term === 'Spare')?.line ?? '';
        assert.doesNotMatch(spare, /at work that day/);
        assert.match(spare, /four of its days/);
    });

    test('the shift classes are the app\'s own boundaries, in 24-hour times', () => {
        assert.match(GLOSSARY.find(g => g.term === 'Early, Late, Night')?.line ?? '', /04:00 to 10:59.*11:00 to 20:59.*21:00 to 03:59/);
    });

    test('one line each: one sentence, no line break, short enough to read at a glance', () => {
        for (const { term, line } of GLOSSARY) {
            assert.doesNotMatch(line, /\n/, term);
            assert.match(line, /^[A-Z][^.]*\.$/, `${term}: one sentence, ending with its full stop`);
            assert.ok(line.length <= 140, `${term}: ${line.length} characters`);
        }
    });

    test('no figure of pay or allowance — those have one home each (rule 2)', () => {
        for (const { term, line } of GLOSSARY) assert.doesNotMatch(line, /£|%|\b\d+(\.\d+)? (hours|days)\b|\b(3[24]|22)\b/, term);
    });

    test('the app\'s own words: Year to Date spelled out, the two payslip figures by name, never "sick"', () => {
        const all = GLOSSARY.map(g => g.line).join(' ');
        assert.doesNotMatch(all, /\bYTD\b|\bsick/i);
        assert.match(GLOSSARY.find(g => g.term === 'Year to Date')?.line ?? '', /Taxable Pay and Tax\sPaid/);
    });

    test('the panel title has no emoji: it is the dialog\'s name, read out', () => {
        assert.doesNotMatch(GLOSSARY_TITLE, /\p{Extended_Pictographic}/u);
    });

    test('the drawer row says the panel\'s title, so a reader knows where they have arrived', () => {
        assert.match(readFileSync('nav-panel-markup.js', 'utf8'), new RegExp(`<span class="nav-link-title">${GLOSSARY_TITLE}</span>`));
    });
});

describe('mentionsGlossaryTerm — which panels end with the link', () => {
    test('each word, short form and long', () => {
        for (const text of ['Shows as RDW 1.25 on your payslip', 'Use Rest Day Working', 'Record AL here', 'Annual leave you have booked',
            'A Spare week', 'the pay cut-off', 'Pay cut-off dates', 'a day in lieu', 'Your Year to Date figures', 'year to date',
            'Early, Late and RD, a rest day', 'a rest day in the range', 'Record Absent', 'BH 1.25', 'a bank holiday', 'HPP is paid',
            'your Holiday Pay Premium', 'For a CEA or CES', 'A Dispatcher’s Spare days', 'a cover week falls', 'Until the new link starts',
            'today’s link beside the proposals', 'the link it would replace']) {
            assert.equal(mentionsGlossaryTerm(text), true, text);
        }
    });

    test('not the ordinary word, a word inside another, or markup', () => {
        for (const text of ['If you have a spare moment', 'Totals for the year', 'Additional hours', 'normal shifts', 'answers close at the cut-off',
            '<span class="AL RDW" data-x="Spare">Nothing here</span>', '',
            // "absent" lower case is the ordinary word; RD is not inside RDW-like words; a web address is "a new link".
            'when the figure is absent', 'BRDGE', 'gives every file a new link', 'a link that opens the newest issue', 'Late answers still count']) {
            assert.equal(mentionsGlossaryTerm(text), false, text);
        }
    });

    test('a word in a panel\'s markup counts once the tags are gone', () => {
        assert.equal(mentionsGlossaryTerm('<strong>RDW</strong> is overtime'), true);
        assert.equal(mentionsGlossaryTerm('&nbsp;AL&nbsp;'), true, 'an entity beside it is not a letter');
    });
});
