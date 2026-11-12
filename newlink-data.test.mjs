// @ts-check
/**
 * newlink-data.test.mjs — the new link page says what the pack says.
 * Run: node scripts/run-tests.mjs newlink-data.test.mjs   (part of `npm run test:hygiene`)
 *
 * `newlink-data.js` is GENERATED from the pack's own figures (docs/links-26/tooling/newlink-data.mjs, reading
 * what-it-means-data.mjs — the same module the one-page sheet prints from). The danger with a generated copy is the one
 * every copy has: the source moves and the copy does not. A rota re-searched, a figure re-counted, a sentence corrected
 * in the tooling — and staff read the old one in the app while the PDF in their hand says the new one.
 *
 * So the first test runs the generator in `--check` mode, which recomputes everything — every figure, every asserted
 * sentence — and fails unless the committed file is byte-for-byte what it would write now. It takes ~20s (this said ~10s;
 * measured 22s on 7 Nov 2026 — about half of it `deck-check.mjs --print`, which the generator runs first), because it is
 * the whole computation; that is the price of a check that cannot be fooled by a figure that merely LOOKS plausible.
 * The rest pin the shape the page relies on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COLUMNS, CHANGES, GAINS, COSTS, DIFFERS, DIFFER_RULE, PERSONAS, NOTES, PACK } from './newlink-data.js';
import { PROPOSALS } from './links-proposals.js';

// fileURLToPath, never `.pathname`: a checkout whose path holds a space reads as %20 and the generator is not found
const here = (/** @type {string} */ f) => fileURLToPath(new URL(f, import.meta.url));

// The generator reads the colleague decks' pay figures back with `unzip` (what-it-means-data.mjs), as the one-page sheet
// does. Every CI runner has it; a machine without it SKIPS the comparison and says why, rather than failing on a missing
// tool or passing as though the comparison had run (the payslip lane's rule: absent is a skip, broken is a failure).
const NO_UNZIP = spawnSync('unzip', ['-v'], { stdio: 'ignore' }).error
    ? 'unzip is not installed — the generator reads the colleague decks back with it, so the comparison cannot run here (CI runs it)'
    : false;

test('newlink-data.js is exactly what the generator writes from the pack today', { skip: NO_UNZIP }, () => {
    try {
        execFileSync(process.execPath, [here('./docs/links-26/tooling/newlink-data.mjs'), '--check'], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
        const err = /** @type {{ stderr?: string, stdout?: string, message: string }} */ (e);
        assert.fail(`${(err.stderr || err.stdout || err.message).trim()}\n(A claim that no longer holds stops the generator too — its message names the sentence.)`);
    }
});

test('its columns are today and the built-in proposals, A to Z', () => {
    // This page presents the three evenly, which means alphabetically, so its columns are sorted rather than copied
    // from the app's list — which is A to Z too since 5 Nov 2026, and was not for the two days before.
    const names = PROPOSALS.map(p => p.name.replace(/ — Dec 2026$/, ''));
    assert.deepEqual([...COLUMNS], ['Today', ...[...names].sort((a, b) => a.localeCompare(b, 'en-GB'))]);
});

test('six ways of working, each a sentence and rows of four figures, and only a proposal is ever marked best', () => {
    assert.equal(PERSONAS.length, 6);
    assert.equal(new Set(PERSONAS.map(p => p.id)).size, 6, 'persona ids are unique (they become element ids)');
    for (const p of PERSONAS) {
        assert.match(p.who, /^…/, `${p.id}: "who" finishes the sentence "What it means if you…"`);
        assert.ok(p.gist.length > 20 && p.icon && p.chip, `${p.id}: a sentence, an emoji and a label`);
        assert.ok(p.rows.length >= 2, `${p.id}: has figures`);
        for (const r of p.rows) {
            assert.equal(r.cells.length, COLUMNS.length, `${p.id} / ${r.label}: one figure per column`);
            assert.equal(r.cells[0].best, false, `${p.id} / ${r.label}: today is for scale and never ranked`);
            assert.ok(r.cells.every(c => c.text.trim()), `${p.id} / ${r.label}: no empty figure`);
        }
    }
    // the swap rows are left unranked on purpose (the sheet's deep review, 1 Nov 2026) — and the notes say so
    const swap = PERSONAS.find(p => p.id === 'swap');
    assert.ok(swap && swap.rows.every(r => r.cells.every(c => !c.best)), 'no swap row is marked');
    assert.ok(NOTES.some(n => /swap rows are not marked/.test(n)));
    // EVENLY: the green lands on each of the three somewhere, not on one of them everywhere
    for (let i = 1; i < COLUMNS.length; i++) {
        assert.ok(PERSONAS.some(p => p.rows.some(r => r.cells[i].best)), `${COLUMNS[i]} is the best of the three for somebody`);
    }
});

test('a way of working with no green mark says why in the notes (the bug check, 9 Nov 2026)', () => {
    // The Sunday rows carried no mark and the notes named only the swap and no-overtime rows, so a reader could not tell a
    // deliberate "not ranked" from a missing figure. Each unmarked band names itself in the notes, in the notes' own words
    const SAID = { swap: /The swap rows are not marked:/, 'no-overtime': /Nor are the no-overtime rows:/, sundays: /Nor are the Sunday rows:/ };
    const notes = NOTES.join(' ').replace(/\u00a0/g, ' ');
    const unmarked = PERSONAS.filter(p => p.rows.every(r => r.cells.every(c => !c.best)));
    assert.ok(unmarked.length > 0, 'premise: some ways of working are left unranked');
    for (const p of unmarked) {
        const said = SAID[/** @type {keyof typeof SAID} */ (p.id)];
        assert.ok(said, `${p.chip} carries no mark, and nothing here says how the notes explain it — add it to SAID and to the notes`);
        assert.match(notes, said, `${p.chip} carries no mark, and the notes do not say why`);
    }
});

test('what all three share comes as gains AND costs, never one without the other', () => {
    assert.ok(GAINS.length >= 3 && COSTS.length >= 3);
    assert.ok(CHANGES.length >= 3, 'the drafted "what has changed" lines');
});

test('a figure counted cover weeks aside says so wherever a sentence quotes it (the bug check, 9 Nov 2026)', () => {
    // The set shifts' figures — days in a row, the rest between shifts, fatigue warnings, runs of earlies or of lates — leave
    // the cover weeks out, because where a cover week's shifts fall is the roster clerk's to decide. A sentence quoting one
    // bare reads as the whole year's: "At least 14h 20m between shifts" did, one line beneath "cover weeks aside". And a
    // bare figure is kindest to whichever design a badly placed cover week hurts most — Balanced V6's 5 days in a row can be
    // 10, one more than today's worst, which the pack's sheet said and the page did not.
    // IN PLAIN WORDS SINCE 12 NOV 2026 ("for dummies"): "not counting cover weeks" where it said "cover weeks aside", and "days AT
    // WORK in a row" — which the old pattern could not see, so a reworded line would have slipped past this check unread. And
    // "Where they differ" is held to it too: "however a cover week falls" names the worst placing, which is its own basis
    const QUOTES = /days (at work )?in a row|between shifts|fatigue warning|weeks of earlies|runs of earlies/;
    const SAYS = /cover weeks? aside|not counting cover weeks|set shifts|cover week falls badly|however a cover week falls/i;
    // SENTENCE BY SENTENCE, not line by line (12 Nov 2026): "At most 5 days at work in a row (today 7). If a cover week falls
    // badly, …" passed whole, its second sentence's basis standing in for the first's — a mutation that dropped the first's
    // "not counting cover weeks" stayed green
    const lines = [...CHANGES, ...GAINS, ...COSTS, ...DIFFERS.flatMap(d => [...d.better, ...d.worse])]
        .flatMap(s => s.replace(/\u00a0/g, ' ').split(/(?<=\.)\s+(?=[A-Z])/)).filter(s => QUOTES.test(s));
    assert.ok(lines.length >= 4, `premise: the page's sentences quote the set shifts' figures (found ${lines.length})`);
    for (const s of lines) assert.match(s, SAYS, `"${s}" quotes a figure counted cover weeks aside, and does not say so`);
});

test('the key promises no margin the marks do not keep (the bug check, 9 Nov 2026)', () => {
    // isBest (what-it-means-data.mjs) marks the best of the three however small its lead. The premise finds a mark a minute
    // or two ahead of a proposal left unmarked — 8h 06m beside 8h 07m — so "the clear best", as the key said, promised a
    // gap the marks do not keep. If the marks ever gain a margin, the premise fails and says the word can come back
    const mins = (/** @type {string} */ s) => (m => m ? +m[1] * 60 + +m[2] : NaN)(/^(\d+)h\s(\d+)m$/.exec(s.replace(/\u00a0/g, ' ')));
    const close = PERSONAS.flatMap(p => p.rows).filter(r => {
        const props = r.cells.slice(1), marked = props.filter(c => c.best), plain = props.filter(c => !c.best);
        return marked.some(b => plain.some(o => Math.abs(mins(b.text) - mins(o.text)) <= 2));
    });
    assert.ok(close.length > 0, 'premise: a mark leads an unmarked proposal by two minutes or less (if not, "clear" may be true now)');
    assert.doesNotMatch(NOTES.join(' '), /\bclear(ly)? best\b/, `the key promises a clear lead; ${close.map(r => r.label).join(', ')} say otherwise`);
});

test('nothing in it names a recommendation (owner, 2 Nov 2026: "No, three evenly")', () => {
    const all = JSON.stringify({ COLUMNS, CHANGES, GAINS, COSTS, DIFFERS, DIFFER_RULE, PERSONAS, NOTES, PACK });
    assert.doesNotMatch(all, /recommend/i);
});

test('where they differ: each of the three, with something better AND something worse, and a rule that is not a score (12 Nov 2026)', () => {
    // The at-a-glance sheet's edges and costs (edge-cost.mjs), in the page's words; the generator asserts it words exactly the
    // sheet's facts. What the page relies on: the shortlist, each once; never a design with only good news or only bad, which
    // would read as a ranking; and a rule beneath them that says the margin and what a count of points does NOT mean
    assert.deepEqual(DIFFERS.map(d => d.design), COLUMNS.slice(1), 'the shortlist, A to Z, each once');
    for (const d of DIFFERS) {
        assert.ok(d.better.length >= 1 && d.worse.length >= 1, `${d.design}: something better AND something worse`);
        for (const s of [...d.better, ...d.worse]) assert.ok(s.trim().length > 20 && /[.]$/.test(s), `${d.design}: "${s}" is a sentence`);
    }
    const rule = DIFFER_RULE.replace(/\u00a0/g, ' ');
    assert.match(rule, /more than \d+% better, or worse, than both of the others/, 'the rule names its margin');
    assert.match(rule, /not a score/, 'and says the number of points is not a score');
});

test('every pack file is a PDF the repository holds, under docs/links-26', () => {
    assert.ok(PACK.length >= 4);
    for (const f of PACK) {
        // up to two folders deep since 8 Nov 2026 — Balanced V6's sheet is in 30-days-off/balanced/ — and still no segment that
        // could climb out (no "..", no leading slash: every segment is letters, digits, hyphens or underscores)
        assert.match(f.path, /^[\w-]+(\/[\w-]+){0,2}\.pdf$/, `${f.path}: a relative path, no climbing out of docs/links-26`);
        assert.ok(existsSync(here(`./docs/links-26/${f.path}`)), `${f.path} is not in docs/links-26`);
        assert.ok(f.pages > 0, `${f.path}: its pages are counted`);
    }
    // what a colleague is handed and nothing more: no two-page shortlist sheet (it recommended, once), no managers' deck, and
    // not the What it means sheet, whose rows the page draws itself. The one-page comparison IS on it, by the owner's word
    // (9 Nov 2026: "add the comparison sheet to the new links section"), so the rule names the files it keeps out exactly
    assert.ok(PACK.every(f => !/(^|\/)links-26-shortlist\.pdf$|for-managers|what-it-means/.test(f.path)), 'the pack the page offers is the colleague pack');
});

test('the full pack card names presentations only while the pack lists one (8 Nov 2026)', () => {
    // newlink.html's hint is typed; the list beneath it is generated. Until 8 Nov 2026 the list held each shortlisted design's
    // colleague deck and the hint read "The presentations, the proposal sheets and the rules". The three shortlisted that day
    // have no decks yet, so the list holds none, and a hint still promising them sends a colleague looking for files that
    // are not there. So the hint must name presentations exactly when the list has one
    const html = readFileSync(here('./newlink.html'), 'utf8');
    const hint = html.match(/id="nlPackToggleHeader"[\s\S]*?<span class="hint">([^<]*)<\/span>/)?.[1];
    assert.ok(hint, 'the full pack card keeps its hint');
    const decks = PACK.some(f => f.path.startsWith('presentations/'));
    assert.equal(/presentation/i.test(hint), decks,
        `the hint "${hint}" ${decks ? 'leaves out the presentations the list holds' : 'promises presentations the list does not hold'}`);
    // THE ONE-PAGE COMPARISON, THE SAME WAY (owner, 9 Nov 2026: "add the comparison sheet to the new links section"): on the
    // list for all three, and named by the hint exactly while the list holds it
    const glance = PACK.filter(f => f.path === 'links-26-shortlist-at-a-glance.pdf');
    assert.equal(glance.length, 1, 'the shortlist at a glance is on the pack list, once');
    assert.equal(glance[0].design, null, 'for all three, not under one design');
    assert.equal(glance[0].pages, 1, 'it is one page');
    assert.match(hint, /comparison/i, `the hint "${hint}" does not mention the one-page comparison the list holds`);
});
