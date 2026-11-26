// @ts-check
// @lane hygiene
/**
 * glossary.test.mjs — "Words used in the app" (glossary.js): the words the owner asked for, one line each, and the test
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
    test('the six the owner asked for, each once', () => {
        assert.deepEqual(GLOSSARY.map(g => g.term), ['RDW', 'AL', 'Spare', 'Pay cut-off', 'Lieu day', 'Year to Date']);
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
            'A Spare week', 'the pay cut-off', 'Cut-off dates', 'a day in lieu', 'Your Year to Date figures', 'year to date']) {
            assert.equal(mentionsGlossaryTerm(text), true, text);
        }
    });

    test('not the ordinary word, a word inside another, or markup', () => {
        for (const text of ['If you have a spare moment', 'Totals for the year', 'Additional hours', 'normal shifts',
            '<span class="AL RDW" data-x="Spare">Nothing here</span>', '']) {
            assert.equal(mentionsGlossaryTerm(text), false, text);
        }
    });

    test('a word in a panel\'s markup counts once the tags are gone', () => {
        assert.equal(mentionsGlossaryTerm('<strong>RDW</strong> is overtime'), true);
        assert.equal(mentionsGlossaryTerm('&nbsp;AL&nbsp;'), true, 'an entity beside it is not a letter');
    });
});
