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

// ── CONTRACT 3: THE MODEL REPORTS AN EMPTY CELL; IT NEVER DECIDES WHAT ONE MEANS ────────────────
//
// The second instruction conflict in this prompt, found by external review (1 Sep 2026), and the
// same shape as the AL one above: a rule that was correct, and an input contract that reached past
// it.
//
// v22.19 established the domain rule from three real rosters — a blank cell is an ANSWER on Sunday
// (the uncontracted column; its blank is how the sheet says "not working") and a QUESTION every
// other day (Mon–Sat unworked days are always stated explicitly: RD, AL, SC, SN, OD, HA, ML, NA).
// `buildSafeEntries` implements exactly that. But the prompt still said, in three places, "a blank
// cell = RD" — so an obedient model returned an explicit "RD" for a physically empty Wednesday, the
// key arrived present and non-empty, and the fail-closed branch never ran. Reproduced through the
// real helper pipeline: five physically blank weekdays became five explicit Rest Days with nothing
// warning. On the duplicate-sheet case that is a second import proposing to overwrite the shifts
// the primary roster's import had just written.
//
// WHY THIS IS A TEST AND NOT A COMMENT. Both halves of this prompt's history are the same lesson:
// the deterministic code was right both times, and prose upstream of it quietly disagreed. Prose
// has no compiler. This is the only thing in the repo that can see the contradiction.
/**
 * The WHOLE prompt template literal — `const prompt = \`…\`;` — not the file around it.
 *
 * Scoping matters and the first cut got it wrong: it scanned all of functions/index.js, so a code
 * COMMENT explaining the blank-cell rule ("Sunday is uncontracted so its blank means a rest day")
 * tripped the guard meant for the INSTRUCTION. A check that fires on documentation of the rule it
 * protects is one somebody eventually deletes.
 */
function fullPrompt() {
    const start = INDEX.indexOf('const prompt = `');
    if (start < 0) throw new Error('roster-prompt-parity: the prompt literal was not found in functions/index.js');
    const from = INDEX.indexOf('`', start) + 1;
    const end  = INDEX.indexOf('`;', from);
    if (end < 0) throw new Error('roster-prompt-parity: the prompt literal has no closing backtick');
    return INDEX.slice(from, end);
}

describe('the prompt never asks the AI to interpret a blank cell', () => {
    const FULL = fullPrompt();

    test('the prompt literal is being read, and is the prompt', () => {
        assert.ok(FULL.length > 2000, `the prompt extracted as ${FULL.length} chars — anchors broken`);
        assert.match(FULL, /STAFF NAMES TO LOOK FOR/, 'that is not the roster prompt');
        assert.ok(!FULL.includes('res.status(502)'),
            'the extraction is swallowing surrounding CODE, so every check below is scanning the '
            + 'handler as well as the instruction');
        assert.match(FULL, /BLANK/, 'the prompt no longer mentions a BLANK token at all');
    });

    test('no instruction turns a blank cell into RD', () => {
        // Every shape the old instruction took, plus the near-misses a rewrite would reach for.
        // Deliberately matched across the WHOLE prompt, not one section: the three copies lived in
        // three different places (STEP 2, the code table, and RULES), and a section-scoped guard
        // would have caught one of them.
        const banned = [
            /blank cell\s*=\s*"?RD"?/i,
            /blank[^.\n]{0,40}=\s*"?RD"?/i,
            /blank[^.\n]{0,40}(?:means?|is)\s+(?:a\s+)?(?:rest day|"?RD"?)/i,
            /(?:empty|dashed)[^.\n]{0,40}=\s*"?RD"?/i,
            /write\s+"?RD"?[^.\n]{0,30}blank/i,
        ];
        const hits = banned.filter(re => re.test(FULL)).map(String);

        // A LINE-WISE MAPPING CHECK, because the phrase-anchored patterns above are not enough and
        // that is measured, not assumed. Teeth-verifying this test found that reverting the CODE
        // TABLE's copy alone — `Blank = the cell contains NO text at all (or only a dash) = "RD".`
        // — passed every one of them: it does not contain the words "blank cell", and the gap
        // between "Blank" and the "RD" it assigns is 54 characters against a 40-character budget.
        // That is one of the three places the original defect actually lived, so the guard had a
        // hole precisely where it mattered most.
        //
        // This asks the structural question instead: on any one line, is a word meaning "empty"
        // being MAPPED to RD? `"BLANK"` is stripped first so the correct form — which necessarily
        // mentions both tokens in order to contrast them — does not trip it.
        const mapsBlankToRd = FULL.split('\n')
            .map(l => l.replaceAll('"BLANK"', ''))
            .filter(l => /(?:blank|empty|dashed?)[^\n]{0,80}?(?:=|→|means?)\s*"?RD"?\b/i.test(l))
            .map(l => l.trim());
        assert.deepEqual(mapsBlankToRd, [],
            'a line of the prompt maps an empty cell to RD:\n  ' + mapsBlankToRd.join('\n  '));
        assert.deepEqual(hits, [],
            'the prompt tells the AI that a blank cell is RD. That instruction defeats the '
            + 'blank-weekday rule in buildSafeEntries: the model returns an explicit "RD", the key '
            + 'arrives non-empty, and a physically empty weekday is written as a Rest Day with '
            + 'nothing warning. The model must REPORT the blank (the BLANK token) and let the '
            + `server decide by day. Matched: ${hits.join(', ')}`);
    });

    test('the sundayScan mapping does not re-interpret the blank on the way out', () => {
        // Its own assertion because no operator-adjacent pattern can see this one: the arrow points
        // at the KEY (`→ "Sun": …`), so the value sits two tokens past the mapping operator and the
        // line-wise check above walks straight over it. Teeth-verification caught that — reverting
        // this one line to `"BLANK" → "Sun": "RD"` passed all eight tests.
        //
        // It is also the subtlest place to reintroduce the defect. The scan is the pass that reads
        // the Sunday column honestly; a mapping that converts its answer on the way into `parsed`
        // throws the blank away at the last possible moment, with the rest of the prompt looking
        // entirely correct.
        const map = /"BLANK"\s*→\s*"Sun":\s*"([A-Z]+)"/.exec(FULL);
        assert.ok(map,
            'the sundayScan → parsed mapping for a blank Sunday cell is gone. It must exist and '
            + 'must carry the blank through unchanged.');
        assert.equal(map[1], 'BLANK',
            `the sundayScan mapping turns a blank Sunday into "${map[1]}". The scan reports what it `
            + 'saw; converting it here discards the one fact the server needs to apply the day rule.');
    });

    test('it says what to write for a blank cell, and that it is not a decision', () => {
        assert.match(FULL, /blank cell\s*=\s*"BLANK"/i,
            'the prompt must state the BLANK token for an empty cell — banning "blank = RD" without '
            + 'saying what to write instead leaves the model to invent an answer');
        assert.match(FULL, /DO NOT DECIDE WHAT A BLANK CELL MEANS/i,
            'the prompt must say the model is not the one deciding. The token alone is a format '
            + 'rule; this is the reason behind it, and it is what stops the next edit "helpfully" '
            + 'restoring the interpretation.');
    });

    test('the token the prompt asks for is the token the parser recognises', () => {
        // The parser side, so the two cannot drift. A prompt saying EMPTY against a parser matching
        // BLANK would send every blank cell down the normaliseShift path as an unknown value —
        // arguably safe, and arriving as ~44 unreadable review rows per upload, which is the kind
        // of "safe" nobody keeps.
        const token = /const BLANK_CELL_TOKEN = '([^']+)'/.exec(HELPERS);
        assert.ok(token, 'BLANK_CELL_TOKEN is not declared in roster-parse-helpers.js');
        assert.ok(FULL.includes(`"${token[1]}"`),
            `the parser recognises "${token[1]}" but the prompt never asks the model to write it`);
        assert.match(HELPERS, /function isPhysicallyBlank/,
            'isPhysicallyBlank must exist — it is what makes "the model said empty" and "the model '
            + 'never mentioned this day" take the same branch');
    });

    test('the blank-Sunday rule keeps its actual job — never omit the key', () => {
        // The rule exists because the model DROPPED the Sunday key and slid the whole row one day
        // left. Changing what value it writes must not weaken the part that stops the drift.
        assert.match(FULL, /MUST write "Sun": "BLANK"/,
            'the blank-Sunday rule must still compel a Sun key. Its purpose was never the value — '
            + 'it was that an omitted key shifts the entire row and produces a silently wrong week.');
        assert.match(FULL, /WRONG example[\s\S]{0,400}Sun key is missing/,
            'the worked example of the omitted Sun key must survive');
    });
});
