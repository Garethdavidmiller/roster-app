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
import { createRequire } from 'node:module';

// The prompt→parser direction below has to CALL the parser, not read it as prose. CommonJS, and
// dependency-free, so it loads in the no-install lane exactly like every other file here.
const { normaliseShift } = createRequire(import.meta.url)('./functions/roster-parse-helpers.js');

const INDEX   = readFileSync('functions/index.js', 'utf8');
const HELPERS = readFileSync('functions/roster-parse-helpers.js', 'utf8');
const PROMPTS = readFileSync('functions/roster-prompt.js', 'utf8');

/**
 * The code table — ONE copy, read where it now lives (v24.04).
 *
 * It was inline in `functions/index.js` until the geometry-first read gave the import a SECOND
 * prompt. Two prompts with two copies of this table is precisely the rot this file exists to
 * prevent, and only one copy would have been guarded — so the table moved to
 * `functions/roster-prompt.js` as `SHIFT_VOCABULARY`, both prompts interpolate it, and this reads
 * it there. The anchors are unchanged; only the file is.
 */
function promptSection() {
    const start = PROMPTS.indexOf('WHAT THE CODES MEAN:');
    const end   = PROMPTS.indexOf('`;', start);
    if (start < 0 || end < 0) {
        throw new Error('roster-prompt-parity: could not locate SHIFT_VOCABULARY in '
            + 'functions/roster-prompt.js ("WHAT THE CODES MEAN:" … the closing backtick). If it was '
            + 'restructured, update these anchors — do NOT delete this test: it guards a defect that '
            + 'silently dropped annual leave.');
    }
    return PROMPTS.slice(start, end);
}

// ── ONE TABLE, AND BOTH PROMPTS MUST ACTUALLY USE IT (v24.04) ─────────────────────────────────
//
// Sharing the table only helps if both prompts interpolate it. A prompt that quietly grew its own
// copy would pass every test below — they read the shared const — while instructing the model from
// a table nothing checks. That is the same failure this file was written for, one level up.
describe('the code table has ONE home, and both prompts interpolate it', () => {
    test('the PDF prompt interpolates SHIFT_VOCABULARY rather than carrying a copy', () => {
        assert.match(INDEX, /\$\{SHIFT_VOCABULARY\}/,
            'functions/index.js no longer interpolates the shared table');
        assert.ok(!INDEX.includes('WHAT THE CODES MEAN:'),
            'functions/index.js carries its own copy of the code table again — there must be exactly one');
    });

    test('the cell prompt interpolates it too', () => {
        const cellPrompt = PROMPTS.slice(PROMPTS.indexOf('function buildCellPrompt'));
        assert.match(cellPrompt, /\$\{SHIFT_VOCABULARY\}/,
            'buildCellPrompt does not include the shared code table, so the geometry-first read is '
            + 'asking the model to normalise with no vocabulary');
    });
});

// ── THE DIRECTION NOBODY WAS CHECKING (v24.04) ────────────────────────────────────────────────
//
// Test 2 below checks parser → prompt: every code `normaliseShift` accepts is asked for. The
// MIRROR was never checked, and three real rosters found what was hiding in it: the prompt says
// "NA or N/A or NS = Not available. Return \"RD\"", and `normaliseShift('NA')` returns
// `UNKNOWN|NA`. It works today only because the prompt makes the MODEL do the conversion, so the
// parser never sees the code — a division of labour nothing wrote down and nothing enforced.
//
// It stops being harmless the moment a cell reaches the parser unconverted, which is exactly what
// the geometry-first read and any deterministic pass do. Asserted here as a WAIVER LIST rather
// than a blanket rule: a code the prompt asks the model to translate is legitimate, but it has to
// be named, so that adding one is a decision instead of an accident.
describe('every code the PROMPT names is either accepted by the parser or waived', () => {
    /**
     * Codes the prompt tells the MODEL to convert, so `normaliseShift` never receives them.
     * Each needs a reason, because an unexplained entry here is how the rule gets hollowed out.
     *
     *   NA · N/A · NS  "Not available" — the prompt asks for "RD" directly, and the parser has
     *                  never been taught the code. Harmless while a model is in the loop; it is
     *                  the first thing to fix if a deterministic pass ever replaces it (phase 3).
     *   GER            NOT a status code at all — Gerrards Cross, a LOCATION marker. The prompt
     *                  asks for the time beside it. The parser reads "06:00-12:00 GER" (time
     *                  first, trailing content) but not "GER 06:00-12:00", so the model's
     *                  reordering is doing real work here rather than none.
     */
    const TRANSLATED_BY_THE_MODEL = new Set(['NA', 'N/A', 'NS', 'GER']);

    test('no unwaived prompt code falls through to UNKNOWN', () => {
        const section = promptSection();
        /** Codes named in a "- CODE or CODE = meaning" row. */
        const named = new Set();
        for (const line of section.split('\n')) {
            const m = /^-\s+([A-Z][A-Z/.]{0,5}(?:\s+or\s+[A-Z][A-Z/.]{0,5})*)\s*=/.exec(line.trim());
            if (!m) continue;
            m[1].split(/\s+or\s+/).forEach(c => named.add(c.trim()));
        }
        assert.ok(named.size >= 8, `only ${named.size} codes parsed out of the prompt — the row shape changed`);
        const orphaned = [...named].filter((c) => {
            if (TRANSLATED_BY_THE_MODEL.has(c)) return false;
            const warn = console.warn; console.warn = () => {};
            try { return String(normaliseShift(c)).startsWith('UNKNOWN|'); } finally { console.warn = warn; }
        });
        assert.deepEqual(orphaned, [],
            'The prompt names these codes but `normaliseShift` rejects them, so a cell carrying one '
            + 'becomes UNREADABLE the moment it reaches the parser without the model translating it '
            + '— which is what the geometry-first read does:\n  ' + orphaned.join(', ')
            + '\n\nEither teach the parser the code, or add it to TRANSLATED_BY_THE_MODEL with a '
            + 'reason. Do not widen the regex to make it disappear.');
    });
});

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

/** Pull a hardcoded code list out of normaliseShift by its `.includes(` guard. */
function codeList(after) {
    const i = HELPERS.indexOf(after);
    if (i < 0) throw new Error(`roster-prompt-parity: anchor "${after}" no longer in roster-parse-helpers.js`);
    const m = HELPERS.slice(i).match(/\[([^\]]*)\]\.includes\(/);
    if (!m) throw new Error(`roster-prompt-parity: no code array found after "${after}"`);
    return [...m[1].matchAll(/'([A-Z]+)'/g)].map(x => x[1]);
}

describe('every code the parser accepts is documented in the prompt', () => {
    test('the day-status and absence codes all appear in the prompt', () => {
        const prompt = promptSection();
        const codes = [
            ...codeList("// Strip dots/slashes so punctuated paper-roster forms"),
            // SN sits in its OWN list because it is not an absence (v22.53) — it is read here so
            // splitting it out cannot quietly drop it from this contract, which is how a code
            // becomes unreachable: the parser accepts it, the prompt never asks for it.
            ...codeList('// SN = sick on a day the person was NOT booked to work'),
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

describe('every paid-absence code has its own row asking for SICK', () => {
    // Contract 2 asks only that a code is MENTIONED somewhere in the prompt, and the CELL LAYOUT
    // rules enumerate the status codes too — so deleting a code's ROW from the table leaves it
    // green. Verified with scripts/mutate.mjs when CL was added (Sep 2026): removing
    // `- CL = paid absence. Return "SICK".` passed every existing contract.
    //
    // That is not cosmetic. The row is the only place the prompt says what the model should RETURN.
    // Without it the model is told the letters are a status code and left to invent the value, and
    // an absence the parser would have mapped correctly never arrives as one.
    test('each code in the paid-absence list is its own `- XX = … "SICK"` row', () => {
        const prompt = promptSection();
        const codes = codeList('// Paid-absence roster codes');
        assert.ok(codes.length >= 5,
            `expected the parser's paid-absence list, found ${codes.join(',')}`);
        for (const c of codes) {
            const row = prompt.match(new RegExp(`^- ${c}\\b[^\\n]*`, 'm'));
            assert.ok(row,
                `no \`- ${c} = …\` row in the prompt's code table. ${c} is in normaliseShift's `
                + 'paid-absence list, so the parser maps it — but the prompt never tells the model '
                + 'to return SICK for it, and the model decides for itself what the letters mean.');
            assert.match(row[0], /"SICK"/,
                `the \`- ${c}\` row does not tell the model to return "SICK". Every code in the `
                + 'paid-absence list resolves to the app\'s Absent day; a row that asks for '
                + 'anything else contradicts the parser.');
        }
    });
});

describe('SC and SN are two codes, not one', () => {
    // Contract 2 above asks only that a code is MENTIONED somewhere in the prompt, and "SN" also
    // appears in the layout rules — so deleting its row from the code table leaves that test green
    // (verified). That weakness is exactly the shape of the defect here: SC and SN shared one row,
    // `- SC or SN = Sick`, and the two are not synonyms. SC is sickness against a booked turn (an
    // absence); SN is sickness on a day off, so the day recorded is the rest day it already was.
    test('each has its own row, and they return different values (v22.53)', () => {
        const prompt = promptSection();
        assert.ok(!/\bSC\s+or\s+SN\b/i.test(prompt),
            'the prompt documents SC and SN on one line again. They mean different things: SC is an '
            + 'absence on a booked day, SN is sickness on a day that was not booked and stays a rest day.');
        const sc = prompt.match(/^- SC\b[^\n]*/m);
        const sn = prompt.match(/^- SN\b[^\n]*/m);
        assert.ok(sc, 'no `- SC = …` row in the prompt code table');
        assert.ok(sn, 'no `- SN = …` row in the prompt code table');
        assert.match(sc[0], /"SICK"/, 'SC must tell the model to return SICK');
        assert.match(sn[0], /"RD"/, 'SN must tell the model to return RD — it is a rest day, not an absence');
        assert.ok(!/"SICK"/.test(sn[0].replace(/never\s+"SICK"/i, '')),
            'the SN row must not ask for SICK except to forbid it');
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
