/**
 * roster-prompt-parity.test.mjs — the roster-parse PROMPT is code, and nothing was checking it.
 * Run: node --test roster-prompt-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * WHY THIS EXISTS — a staff-reported defect, Jul 2026: "the roster uploader only gets AL right 50%
 * of the time." It was not OCR, and not the parser. In the real PDF a cell's SECOND line holds the
 * train duty code on a worked day ("CEA 24") and the STATUS code on a non-worked one ("AL"). The
 * prompt said "Duty/diagram codes on a second line … ignore them. Only the first line of each cell
 * is the shift value", and separately "Blank … = RD". For an AL cell those two rules compose into:
 * ignore the AL, see an empty first line, return RD. The model was being instructed to discard
 * annual leave. The 50% was the signature of an INSTRUCTION CONFLICT — a contradiction resolved
 * differently run to run — not of a hard-to-read document.
 *
 * It survived because RD sits on that same second line and is RIGHT BY ACCIDENT: "ignore the second
 * line" + "blank = RD" yields RD, which is what an RD cell means anyway. The rule only did damage
 * where the correct answer DIFFERS from a rest day — AL, SPARE, and every absence code — so it read
 * the majority of the table perfectly while silently dropping leave and sickness.
 *
 * Two contracts, and note they are different things:
 *   1. THE REGRESSION (test 1). The prompt must not carry a line-position rule that can swallow a
 *      status code, and must say a status code on the second line IS the value. This is the one that
 *      would have caught the bug.
 *   2. CODE-TABLE PARITY (test 2). Every code `normaliseShift` accepts must be documented in the
 *      prompt. This would NOT have caught it (AL was documented) — it catches the mirror-image
 *      failure: teaching the parser a code the prompt never asks for makes that code unreachable,
 *      silently, because the AI never emits it.
 *
 * Prose, so read as source text (the prompt is a template literal inside a request handler and can
 * not be imported). Extraction THROWS if the anchors stop matching, rather than vacuously passing.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const INDEX   = readFileSync('functions/index.js', 'utf8');
const HELPERS = readFileSync('functions/roster-parse-helpers.js', 'utf8');

/** The prompt region: from the code table to the end of the layout rules. */
function promptSection() {
    const start = INDEX.indexOf('WHAT THE CODES MEAN:');
    const end   = INDEX.indexOf('RULES:', start);
    if (start < 0 || end < 0) {
        throw new Error('roster-prompt-parity: could not locate the prompt section in functions/index.js '
            + '("WHAT THE CODES MEAN:" … "RULES:"). If the prompt was restructured, update these anchors — '
            + 'do NOT delete this test: it guards a defect that silently dropped annual leave.');
    }
    return INDEX.slice(start, end);
}

describe('the roster prompt must not tell the AI to ignore a status code', () => {
    const prompt = promptSection();

    test('no line-POSITION rule that would swallow a second-line status code', () => {
        // The exact instruction that caused it. A cell's status code (AL/SP/SC/SN/OD/HA/ML) is on the
        // SECOND line, so any rule of the form "only the first line is the shift value" discards it.
        const banned = /only the first line[^.]*(?:is the shift value|shift value)/i;
        assert.ok(!banned.test(prompt),
            'The prompt tells the AI that only the FIRST line of a cell is the shift value. In the real '
            + 'roster a non-worked day has no time at all and its status code (AL, SP, SC, SN, OD, HA, ML) '
            + 'sits on the SECOND line — so this rule instructs the model to discard annual leave and '
            + 'absence. It reads correctly on rest days only because "blank = RD" happens to give the '
            + 'right answer there. Make the rule about WHAT the text is (duty code vs status code), '
            + 'never about which line it sits on.');
    });

    test('the layout rule says a second-line status code IS the value', () => {
        // Meaning, not exact wording — but the meaning has to be present somewhere.
        assert.match(prompt, /status code/i,
            'the prompt must distinguish a STATUS code from a DUTY code — that distinction is the fix');
        assert.match(prompt, /second line/i,
            'the prompt must say where a status code actually sits (the second line of the cell)');
        assert.match(prompt, /\bAL\b[^\n]*\bNOT\b[^\n]*(?:blank|rest day)/i,
            'the prompt must state explicitly that a cell showing only "AL" is annual leave and NOT a '
            + 'blank/rest day — that single sentence is the one the failing case turned on');
    });
});

describe('every code the parser accepts is documented in the prompt', () => {
    /** Pull a hardcoded code list out of normaliseShift by its `.includes(` guard. */
    function codeList(after) {
        const i = HELPERS.indexOf(after);
        if (i < 0) throw new Error(`roster-prompt-parity: anchor "${after}" no longer in roster-parse-helpers.js`);
        const m = HELPERS.slice(i).match(/\[([^\]]*)\]\.includes\(/);
        if (!m) throw new Error(`roster-prompt-parity: no code array found after "${after}"`);
        return [...m[1].matchAll(/'([A-Z]+)'/g)].map(x => x[1]);
    }

    test('the day-status and absence codes all appear in the prompt', () => {
        const prompt = promptSection();
        const codes = [
            ...codeList("// Strip dots/slashes so punctuated paper-roster forms"),
            ...codeList('// Paid-absence roster codes'),
        ];
        assert.ok(codes.length >= 9, `expected the parser's code lists, found ${codes.join(',')}`);
        // Word-boundaried: "SC" must not be satisfied by the "SC" inside some other token.
        const undocumented = codes.filter(c => !new RegExp(`\\b${c}\\b`).test(prompt)).sort();
        assert.deepEqual(undocumented, [],
            `normaliseShift accepts these codes but the prompt never mentions them:\n  ${undocumented.join('\n  ')}\n`
            + 'The AI will therefore never return them, so the parser branch is unreachable and the day '
            + 'is silently read as something else. Add each to the prompt\'s code table.');
    });
});
