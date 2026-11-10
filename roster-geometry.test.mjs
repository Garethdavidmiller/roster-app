/**
 * roster-geometry.test.mjs — the PDF's own grid as a witness, organised by what a wrong answer COSTS.
 *
 * Run: node --test roster-geometry.test.mjs   (part of `npm run test:functions` — the adapter cases
 * need `pdfjs-dist` from functions/node_modules; everything else here is pure).
 *
 * @nodeps-safe — the pdfjs cases SKIP THEMSELVES by name when the parser is absent (see
 * `REAL_PDFJS_SKIP` below), so the other thirty-odd assertions run on a bare checkout with nothing
 * installed. `scripts/test-nodeps.mjs` reads this marker; without it, being listed in
 * `test:functions` excluded the whole file and those assertions went unrun by the one runner whose
 * job is to run everything that can run (v22.45, external review — measured by invoking this suite
 * directly). If the pure blocks below ever grow a hard dependency, delete this line.
 *
 * Two directions, and they are not symmetrical:
 *   · A FALSE REFUSAL teaches an admin the witness cries wolf, and a witness nobody trusts is muted
 *     — the corpus measured zero, and the honest-read cases here pin that.
 *   · A MISSED refusal is the shipped bug: a week written onto the wrong days with nothing on
 *     screen to say so. The shifted-row cases pin the catch.
 * A third block covers what the witness must NOT claim to see (a fully worked week, an unmatched
 * name, a duplicate name), because a guard that is confidently wrong about its own reach is how
 * "the AI complied" became a safety mechanism for six versions.
 *
 * The adapter is tested through the REAL pdfjs against a PDF built by hand in this file — the
 * repository holds no roster PDFs (private data), and a fixture that draws its own rules and places
 * its own text is the only way to prove the ops-list reading and the coordinate arithmetic on the
 * actual library, not on a restatement of it. The builder writes PDF 1.4 by hand: a page, Helvetica,
 * stroked `m`/`l`/`S` segments for the rules, `BT … Tj ET` for the text. Any xref mistake and pdfjs
 * refuses the file, which the garbage-bytes case also relies on.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

// ── IS THE REAL pdfjs HERE, AND SHOULD IT BE? ──────────────────────────────────────────────────
//
// The block at the bottom drives the REAL parser, so it needs `pdfjs-dist` — a dependency of
// `functions/`, which a bare checkout does not have. Without this, that block produced FIVE failing
// assertions on an unzipped archive, and an external reviewer had to decide for themselves that
// they were environmental rather than defects. That judgement should not be theirs to make: a
// reviewer cannot tell "this did not run" from "this is broken" by reading a red assertion, and
// the repo already has the honest form of this — `module-parse.test.mjs` skips with its reason
// named when its flag is absent.
//
// So it skips, and says why. What it must NEVER do is go quiet where the dependency IS installed:
// there a failed import is a real breakage (a bad install, a version that moved off the v4 pin the
// adapter reads), and skipping it would leave the roster import's only non-AI witness untested
// with the suite green. Hence two questions, not one — is it loadable, and is it supposed to be.
const PDFJS_SPECIFIER = 'pdfjs-dist/legacy/build/pdf.mjs';
// ASKED FROM WHERE THE ADAPTER ASKS (test audit, 7 Nov 2026). `functions/roster-geometry.js` imports
// pdfjs by bare name, so Node looks in `functions/node_modules` first. This file sits at the root, and
// asking from here gave the wrong answer wherever only `cd functions && npm ci` had been run: the
// real-pdfjs cases skipped and told the reader to run the command they had just run, while the
// adapter beside them read the grid fine.
const adapterRequire = createRequire(new URL('./functions/roster-geometry.js', import.meta.url));
const pdfjsLoads = await (async () => {
    try { await import(pathToFileURL(adapterRequire.resolve(PDFJS_SPECIFIER)).href); return true; } catch { return false; }
})();
const pdfjsInstalled = (() => {
    try { adapterRequire.resolve('pdfjs-dist/package.json'); return true; } catch { return false; }
})();
// Skip ONLY the genuinely-absent case. Installed-but-unloadable falls through and fails loudly.
const REAL_PDFJS_SKIP = (!pdfjsLoads && !pdfjsInstalled)
    && 'needs pdfjs-dist — run `cd functions && npm ci`, or `npm run test:functions`';
const {
    GRID_COLUMNS, rulesFromOperatorList, assignRunsToGrid, extractRosterGeometry,
    matchGeometryRow, applyGeometryWitness, geometryCoverage, awaitGeometryWithin,
    GEOMETRY_WAIT_BUDGET_MS, GEOMETRY_WORK_BUDGET_MS, _isClaim, _nameTokens,
} = require('./functions/roster-geometry.js');

import { VX, COL_X, NAME_X, DATES, ROSTER_FIXTURE, rosterPage, buildPdf } from './test-fixtures/roster-pdf.mjs';

// The measured grid, the hand-built PDF and the roster it draws now live in
// `test-fixtures/roster-pdf.mjs`, so that `index-endpoints.test.mjs` can drive the REAL handler at
// the SAME document this file proves the adapter against. Two fixtures would drift, and the one the
// handler used would slowly stop resembling the one the adapter is trusted on — see that file's
// header for why the joining test exists at all (v24.12 shipped exactly that gap).

/** Build one page's runs from rows of [name, cell0..cell6]; '' leaves the cell physically empty. */
function pageFrom(rowSpecs, { top = 700, rowH = 50 } = {}) {
    const hy = [];
    const items = [];
    for (let r = 0; r <= rowSpecs.length; r++) hy.push(top - r * rowH);
    rowSpecs.forEach(([name, ...cells], r) => {
        const y = top - r * rowH - rowH / 2;
        if (name) items.push({ str: name, x: NAME_X, y });
        cells.forEach((c, i) => { if (c) items.push({ str: c, x: COL_X[i], y }); });
    });
    return { items, vx: [...VX], hy };
}

// ── The grid, from the ops list ─────────────────────────────────────────────────────────────────

describe('rulesFromOperatorList — the drawn rules', () => {
    // A fake OPS enum and a fake operator list in pdfjs's shape: [fns[], args[]] per constructPath.
    // curveTo2/curveTo3 are PDF `v`/`y`, with pdfjs v4's own numbers; the enum lacked them until
    // import-server-7, which is how the reader came to skip them without stepping over their operands.
    const OPS = { constructPath: 91, moveTo: 13, lineTo: 14, rectangle: 19, curveTo: 15, curveTo2: 16, curveTo3: 17, closePath: 18 };
    const seg = (x1, y1, x2, y2) => [[OPS.moveTo, OPS.lineTo], [x1, y1, x2, y2]];
    const ops = (...paths) => ({ fnArray: paths.map(() => OPS.constructPath), argsArray: paths });

    test('vertical and horizontal segments are read as rules; a rectangle is not', () => {
        const { vx, hy } = rulesFromOperatorList(ops(
            seg(154.8, 100, 154.8, 700),          // vertical
            seg(25.3, 650, 822.5, 650),           // horizontal
            [[OPS.rectangle], [10, 10, 50, 50]],  // a filled box, not a rule
        ), OPS);
        assert.deepEqual(vx, [154.8]);
        assert.deepEqual(hy, [650]);
    });

    test('rules within 2px are one rule — the same line stroked twice does not become two columns', () => {
        const { vx } = rulesFromOperatorList(ops(seg(154.8, 100, 154.8, 700), seg(155.9, 100, 155.9, 700)), OPS);
        assert.equal(vx.length, 1);
    });

    test('a short tick and a diagonal are neither', () => {
        const { vx, hy } = rulesFromOperatorList(ops(seg(100, 100, 100, 102), seg(100, 100, 200, 300)), OPS);
        assert.deepEqual(vx, []); assert.deepEqual(hy, []);
    });

    test('a `v` or `y` curve steps over its four operands, so the rest of its path is read true', () => {
        // m 400 20 · v 400.2 60 420 40 · l 430 45 — a curve, then a short diagonal: no rule at all.
        // With the curve's operands left unread, the line took 400.2 60 for its end point, and a
        // vertical "rule" at x 400 gave the page ten columns and cost it the grid.
        for (const op of [OPS.curveTo2, OPS.curveTo3]) {
            const { vx, hy } = rulesFromOperatorList(ops([[OPS.moveTo, op, OPS.lineTo], [400, 20, 400.2, 60, 420, 40, 430, 45]]), OPS);
            assert.deepEqual([vx, hy], [[], []], `op ${op}`);
            // …and a rule drawn after the curve in the same path is still found where it is.
            const after = rulesFromOperatorList(ops([[OPS.moveTo, op, OPS.moveTo, OPS.lineTo],
                [10, 10, 1, 2, 3, 4, 154.8, 100, 154.8, 700]]), OPS);
            assert.deepEqual(after.vx, [154.8], `op ${op}`);
        }
    });

    test('the pdfjs-6 encoding (a non-iterable fns) is skipped, not thrown — the v4 pin, stated', () => {
        assert.deepEqual(rulesFromOperatorList({ fnArray: [OPS.constructPath], argsArray: [[42, [0, 0]]] }, OPS), { vx: [], hy: [] });
    });
});

// ── The sheet's own week (roster-week-heading.js — import-server-2) ─────────────────────────────
//
// Measured on a real CEA roster (10 Nov 2026): page 1 prints the label "Week Ending:" and a
// DD/MM/YYYY date above the grid, as two text runs on one line; continuation pages do not repeat it,
// and the footer's "Print Date:" carries a date that is never the week. Every run below is
// SYNTHETIC: no text from a real sheet is in this repository.

const { weekEndingsOnPage, checkSheetWeek } = require('./functions/roster-week-heading.js');

describe('the sheet\'s own week — read from its printed heading, never guessed', () => {
    const run = (/** @type {string} */ str, /** @type {number} */ x, /** @type {number} */ y) => ({ str, x, y });

    test('the label and the date are two runs on one line, as the real sheet prints them', () => {
        assert.deepEqual(weekEndingsOnPage([run('A Roster Title', 25, 543.7), run('Week Ending:', 635, 544.7), run('05/09/2026', 712, 544.7)]),
            [{ printed: '05/09/2026', iso: '2026-09-05' }]);
    });

    test('one run carrying both, in any case or spacing, reads the same', () => {
        for (const s of ['Week Ending:  05/09/2026', 'WEEK ENDING 5/9/2026', 'week ending: 05 / 09 / 2026']) {
            assert.deepEqual(weekEndingsOnPage([run(s, 600, 540)]).map(h => h.iso), ['2026-09-05'], s);
        }
    });

    test('the footer\'s print date is never the week, and no other form is guessed at', () => {
        for (const s of ['Print Date: 27/08/2026', 'Week Ending: 05.09.2026', 'Week Ending: 05/09/26', '05/09/2026']) {
            assert.deepEqual(weekEndingsOnPage([run(s, 30, 40)]), [], s);
        }
        assert.deepEqual(weekEndingsOnPage([run('Week Ending:', 635, 544), run('05/09/2026', 712, 520)]), [],
            'a label and a date on different lines are not one heading');
    });

    test('a date that is not a real Saturday is read, and marked unusable', () => {
        assert.deepEqual(weekEndingsOnPage([run('Week Ending: 04/09/2026', 600, 540), run('Week Ending: 31/02/2026', 600, 500)]),
            [{ printed: '04/09/2026', iso: null }, { printed: '31/02/2026', iso: null }]);
    });

    test('the week chosen passes; another week refuses, naming both in the app\'s date style', () => {
        const geo = (/** @type {string[]} */ ...iso) => ({ weekEndings: iso.map(i => ({ printed: '', iso: i })), pagesRead: 1, pagesRejected: 0 });
        assert.equal(checkSheetWeek(geo('2026-09-05'), '2026-09-05').status, 'match');
        const c = checkSheetWeek(geo('2026-09-05'), '2026-09-12');
        assert.equal(c.status, 'mismatch');
        assert.equal(c.message, 'This roster is for the week ending Saturday 5 September 2026, but the week chosen is '
            + 'Saturday 12 September 2026. Choose the matching week and upload it again.');
        assert.equal(c.sheetWeek, '2026-09-05');
        const two = checkSheetWeek(geo('2026-09-05', '2026-09-12'), '2026-09-12');
        assert.equal(two.status, 'mismatch', 'a PDF holding two weeks is refused, even when one is the week chosen');
        assert.match(two.message ?? '', /more than one week — the weeks ending Saturday 5 September 2026 and Saturday 12 September 2026/);
    });

    test('no heading read is NOT a refusal: the read goes on, and the log says why', () => {
        /** @type {Array<[any, RegExp]>} */
        const cases = [
            [{ weekEndings: [], pagesRead: 1, pagesRejected: 0 }, /prints no "Week Ending: DD\/MM\/YYYY" heading/],
            [{ weekEndings: [{ printed: '04/09/2026', iso: null }], pagesRead: 1, pagesRejected: 0 }, /04\/09\/2026\) is not a Saturday/],
            [{ available: false, reason: 'no-text', rows: [], pagesRead: 0, pagesRejected: 0, weekEndings: [] }, /text was not read \(no-text\)/],
            [{ available: false, reason: 'wait-timeout', rows: [], pagesRead: 0, pagesRejected: 0 }, /text was not read \(wait-timeout\)/],
            [null, /text was not read/],
        ];
        for (const [geometry, why] of cases) {
            const c = checkSheetWeek(geometry, '2026-09-05');
            assert.equal(c.status, 'unread');
            assert.equal(c.message, undefined, 'nothing for the admin to act on');
            assert.match(c.note, why);
        }
    });
});

// ── Runs → cells ────────────────────────────────────────────────────────────────────────────────

describe('assignRunsToGrid — every run lands in its physical cell', () => {
    test('the exact row that drifts: the Sunday cell is empty as a matter of fact', () => {
        const rows = assignRunsToGrid(pageFrom([
            ['Sunday', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],           // the header row
            ['G. Miller', '', 'RD', '06:20-14:20', '06:20-14:20', 'RD', '07:00-16:00', '07:00-15:00'],
        ]));
        assert.equal(rows.length, 1, 'the header row is furniture, not a member');
        assert.equal(rows[0].name, 'G. Miller');
        assert.deepEqual(rows[0].occupancy, [false, true, true, true, true, true, true]);
        assert.equal(rows[0].cells[0], '');
        assert.equal(rows[0].cells[2], '06:20-14:20');
    });

    test('two lines in one cell join top-down with the separator the corpus uses', () => {
        const page = pageFrom([['A. Person', '', '', '', '', '', '', '']]);
        const y = 700 - 25;
        page.items.push({ str: '06:20-14:20', x: COL_X[2], y: y + 6 }, { str: 'CEA 1', x: COL_X[2], y: y - 6 });
        const [row] = assignRunsToGrid(page);
        assert.equal(row.cells[2], '06:20-14:20 | CEA 1');
        assert.equal(row.occupancy[2], true);
    });

    test('the print footer is NOT a member — by its name, and by "Page N of M" wherever it landed', () => {
        const rows = assignRunsToGrid(pageFrom([
            ['G. Miller', 'RD', 'RD', 'RD', 'RD', 'RD', 'RD', 'RD'],
            ['Print Date: 27/08/2026', '', '09:52', 'Page 1 of 3', '', '', '', ''],
            ['', '', '', 'Page 2 of 3', '', '', '', ''],                         // a footer with no name at all
            // …and the one the NAME filter cannot see: a footer whose first cell is just the
            // date/time. Only the "Page N of M" content catches it, and deleting that filter
            // passed every other case here — which is how this row came to exist.
            ['27/08/2026 09:52', '', '', 'Page 3 of 3', '', '', '', ''],
        ]));
        assert.deepEqual(rows.map(r => r.name), ['G. Miller']);
    });

    test('"Vacant" rows are kept — they are real rows, and the MATCHER is what refuses to pick one', () => {
        const rows = assignRunsToGrid(pageFrom([
            ['Vacant', '', '06:00-14:00', '', '', '', '', ''],
            ['Vacant', '', '', '', '', '', '', '14:00-22:00'],
        ]));
        assert.equal(rows.length, 2);
    });

    test('a page without the nine-column grid is REJECTED, never guessed at', () => {
        const page = pageFrom([['G. Miller', 'RD', 'RD', 'RD', 'RD', 'RD', 'RD', 'RD']]);
        assert.equal(assignRunsToGrid({ ...page, vx: page.vx.slice(0, 3) }), null, 'three rules');
        assert.equal(assignRunsToGrid({ ...page, vx: [...page.vx, 900] }), null, 'ten rules');
        assert.equal(assignRunsToGrid({ ...page, hy: [700] }), null, 'no row bands');
    });

    test('a run outside every column or row band is dropped, not forced into a neighbour', () => {
        const page = pageFrom([['G. Miller', '', 'RD', 'RD', 'RD', 'RD', 'RD', 'RD']]);
        page.items.push({ str: 'stray', x: 5, y: 675 }, { str: 'stray', x: NAME_X, y: 900 });
        const [row] = assignRunsToGrid(page);
        assert.equal(row.name, 'G. Miller');
        assert.equal(row.occupancy[0], false);
    });

    test(`GRID_COLUMNS is ${GRID_COLUMNS}: name plus seven days`, () => {
        assert.equal(GRID_COLUMNS, 9);
    });
});

// ── Names ───────────────────────────────────────────────────────────────────────────────────────

describe('matchGeometryRow — one row, or none', () => {
    const rows = (...names) => names.map(name => ({ name, occupancy: [] }));

    test('letters in any order: "G. Miller" is "Miller G" is "Miller, G."', () => {
        assert.equal(matchGeometryRow('G. Miller', rows('Miller G')).name, 'Miller G');
        assert.equal(matchGeometryRow('G. Miller', rows('Miller, G.')).name, 'Miller, G.');
        assert.deepEqual(_nameTokens('Miller, G.'), ['g', 'miller']);
    });

    test('a full first name matches on surname + initial, only when unique', () => {
        assert.equal(matchGeometryRow('G. Miller', rows('Gareth Miller', 'S. Silva')).name, 'Gareth Miller');
        assert.equal(matchGeometryRow('G. Miller', rows('Gareth Miller', 'Grace Miller')), null, 'two G. Millers → no signal');
        assert.equal(matchGeometryRow('G. Miller', rows('Tom Miller')), null, 'wrong initial');
    });

    test('a name that appears more than once gets NO signal — three real Vacant rows', () => {
        assert.equal(matchGeometryRow('Vacant', rows('Vacant', 'Vacant', 'G. Miller')), null);
    });

    // ── THE TIE THAT IS BROKEN, AND THE THREE THAT ARE NOT (v24.03) ────────────────────────────
    //
    // Found on a real Dispatch sheet: an EMPTY `S Faure` placeholder row sits above the real
    // `S. Faure` row. The two tokenise identically, so the rule above refused both and that member
    // got NO geometry signal on any Dispatch import — the witness quietly skipping one person every
    // week. Measured before and after on the three real rosters: Dispatch goes 12 to 13 matched,
    // CEA (25) and Supervisors (9) unchanged, so this narrows exactly the tie it is meant to.
    const occ = (...days) => days.map(Boolean);
    const EMPTY = occ(0, 0, 0, 0, 0, 0, 0);
    const WORKED = occ(0, 1, 1, 1, 1, 1, 1);
    const row = (name, occupancy) => ({ name, occupancy });

    test('a tie is broken when exactly ONE of the tied rows says anything', () => {
        const got = matchGeometryRow('S. Faure',
            [row('Vacancy', EMPTY), row('S Faure', EMPTY), row('S. Faure', WORKED)]);
        assert.equal(got && got.name, 'S. Faure', 'the empty placeholder must not blind the real row');
    });

    test('and it is NOT broken when both tied rows carry content — that sheet really is ambiguous', () => {
        assert.equal(matchGeometryRow('S. Faure', [row('S Faure', WORKED), row('S. Faure', WORKED)]), null);
    });

    test('nor when neither does — an empty row states nothing to prefer', () => {
        assert.equal(matchGeometryRow('S. Faure', [row('S Faure', EMPTY), row('S. Faure', EMPTY)]), null);
    });

    test('it can never PROMOTE a non-match: a lone wrong name stays unmatched however full it is', () => {
        assert.equal(matchGeometryRow('S. Faure', [row('T. Nowak', WORKED)]), null);
    });

    test('an unmatched member is null, never the nearest row', () => {
        assert.equal(matchGeometryRow('S. Silva', rows('G. Miller', 'M. Robson')), null);
        assert.equal(matchGeometryRow('', rows('G. Miller')), null);
    });
});

// ── The witness ─────────────────────────────────────────────────────────────────────────────────

describe('applyGeometryWitness — refused, not weighed', () => {
    const geo = (...rowSpecs) => ({ available: true, pagesRead: 1, pagesRejected: 0, rows: assignRunsToGrid(pageFrom(rowSpecs)) });
    const MILLER = ['G. Miller', '', 'RD', '06:20-14:20', '06:20-14:20', 'RD', '07:00-16:00', '07:00-15:00'];
    const honest = () => ({ memberName: 'G. Miller', shifts: {
        [DATES[0]]: 'RD', [DATES[1]]: 'RD', [DATES[2]]: '06:20-14:20', [DATES[3]]: '06:20-14:20',
        [DATES[4]]: 'RD', [DATES[5]]: '07:00-16:00', [DATES[6]]: '07:00-15:00' } });

    // ── the honest read contradicts nothing (a false refusal is the muted-guard direction) ──
    test('the honest read passes: RD on the empty Sunday, every duty on an occupied day', () => {
        const entries = [honest()];
        const s = applyGeometryWitness(entries, geo(MILLER), DATES);
        assert.deepEqual(s.refused, []);
        assert.equal(s.status, 'complete');
        assert.equal(entries[0].shifts[DATES[2]], '06:20-14:20', 'nothing touched');
    });

    test('a BLANK token, an RD, an OFF and an already-UNKNOWN cell are not claims — an empty cell cannot refute them', () => {
        const e = honest();
        e.shifts[DATES[0]] = 'BLANK';
        const e2 = honest(); e2.shifts[DATES[0]] = 'OFF';
        const e3 = honest(); e3.shifts[DATES[0]] = 'UNKNOWN|no Sunday cell was read';
        for (const entry of [e, e2, e3]) {
            const s = applyGeometryWitness([entry], geo(MILLER), DATES);
            assert.deepEqual(s.refused, [], entry.shifts[DATES[0]]);
        }
        assert.equal(_isClaim('RD'), false); assert.equal(_isClaim('rd'), false);
        assert.equal(_isClaim('06:20-14:20'), true); assert.equal(_isClaim('AL'), true);
        assert.equal(_isClaim('SICK'), true); assert.equal(_isClaim('RDW|06:00-14:00'), true);
    });

    // ── the shipped bug: the blank Sunday collapses and the week slides a day left ──
    test('the one-day-LEFT collapse is refused at the Sunday cell, and the ROW is reported', () => {
        const e = honest();
        // Monday's value lands in Sunday; every later day takes the next one; Saturday empties.
        const v = DATES.map(d => e.shifts[d]);
        DATES.forEach((d, i) => { e.shifts[d] = v[i + 1] ?? 'RD'; });
        assert.equal(e.shifts[DATES[0]], 'RD', 'the collapse puts Monday (RD) in Sunday — not detectable here');
        // …and the witness, handed it, refuses nothing (test audit, 7 Nov 2026: this fixture was built
        // and never run). An RD on an empty cell is what the honest read says, and every other value
        // sits on an occupied cell, so this is the reach it states — not a miss to "fix".
        assert.deepEqual(applyGeometryWitness([e], geo(MILLER), DATES).refused, [], 'a collapse onto a rest Monday is invisible here');
        // …so use a row whose Monday is a DUTY, which is the case that actually bites.
        const e2 = honest(); e2.shifts[DATES[0]] = '06:20-14:20';   // a duty claimed on the empty Sunday
        const s = applyGeometryWitness([e2], geo(MILLER), DATES);
        assert.deepEqual(s.refused, [{ memberName: 'G. Miller', dates: [DATES[0]] }]);
        assert.match(e2.shifts[DATES[0]], /^UNKNOWN\|/, 'the refused cell is UNREADABLE — it can never be written');
        assert.match(e2.shifts[DATES[0]], /empty on the PDF/, 'and says why in the admin\'s words');
        assert.doesNotMatch(e2.shifts[DATES[0]], /SICK/, 'never the internal absence value');
        assert.equal(e2.shifts[DATES[2]], '06:20-14:20', 'the other cells are left for the client to untick — nothing else is rewritten');
    });

    test('an absence code claimed on an empty cell is refused too, in app language', () => {
        const e = honest(); e.shifts[DATES[0]] = 'SICK';
        applyGeometryWitness([e], geo(MILLER), DATES);
        assert.match(e.shifts[DATES[0]], /^UNKNOWN\|Absent was read here/);
    });

    test('several empty cells contradicted on one row are all named, once per row', () => {
        const e = { memberName: 'G. Miller', shifts: Object.fromEntries(DATES.map(d => [d, '06:00-14:00'])) };
        const s = applyGeometryWitness([e], geo(['G. Miller', '', '06:00-14:00', '', '06:00-14:00', '', '06:00-14:00', '']), DATES);
        assert.deepEqual(s.refused, [{ memberName: 'G. Miller', dates: [DATES[0], DATES[2], DATES[4], DATES[6]] }]);
    });

    // ── what it must not claim to see ──
    test('a FULLY occupied week cannot be refused, however wrong — the witness speaks only where the grid is empty', () => {
        const full = ['G. Miller', '06:00-14:00', '06:00-14:00', '06:00-14:00', '06:00-14:00', '06:00-14:00', '06:00-14:00', '06:00-14:00'];
        const e = honest();   // a completely different week, all claims
        DATES.forEach(d => { e.shifts[d] = '22:00-06:00'; });
        const s = applyGeometryWitness([e], geo(full), DATES);
        assert.deepEqual(s.refused, []);
        assert.equal(s.checked, 1, 'checked, and found nothing to say');
    });

    test('an unmatched name is NO signal, counted so the admin can see the witness did not cover them', () => {
        const e = honest(); e.memberName = 'S. Silva'; e.shifts[DATES[0]] = '06:00-14:00';
        const s = applyGeometryWitness([e], geo(MILLER), DATES);
        assert.deepEqual(s.refused, []);
        assert.deepEqual(s.unmatched, ['S. Silva']);
        assert.equal(s.status, 'unavailable', 'nobody matched → the witness did not run for this read');
        assert.equal(e.shifts[DATES[0]], '06:00-14:00', 'untouched');
    });

    test('partial coverage is reported as partial, never as complete', () => {
        const a = honest(); const b = honest(); b.memberName = 'S. Silva';
        const s = applyGeometryWitness([a, b], geo(MILLER), DATES);
        assert.equal(s.status, 'partial'); assert.equal(s.checked, 1); assert.equal(s.total, 2);
    });

    test('no geometry at all → unavailable, nothing touched', () => {
        for (const g of [null, undefined, { available: false, rows: [] }, { available: true, rows: [] }]) {
            const e = honest(); e.shifts[DATES[0]] = '06:00-14:00';
            const s = applyGeometryWitness([e], g, DATES);
            assert.equal(s.status, 'unavailable'); assert.deepEqual(s.refused, []);
            assert.equal(e.shifts[DATES[0]], '06:00-14:00');
        }
    });

    // Two same-named rows that BOTH say something is the case the real sheet actually produces:
    // measured on the CEA roster, both `Vacant` rows carry duties (XXXXXXX and .XXXXXX). That stays
    // refused. The v24.03 tie-break narrows only the OTHER shape — one row empty, one occupied —
    // which is the real `S Faure` / `S. Faure` placeholder pair on the Dispatch sheet. The two are
    // asserted together here because it is the contrast that makes either meaningful.
    test('a member matched to two rows that BOTH carry content gets no signal (real: Vacant ×2)', () => {
        const e = { memberName: 'Vacant', shifts: Object.fromEntries(DATES.map(d => [d, '06:00-14:00'])) };
        const s = applyGeometryWitness([e], geo(
            ['Vacant', '06:20-14:20', '', '', '', '', '', ''],
            ['Vacant', '06:00-14:00', '', '', '', '', '', ''],
        ), DATES);
        assert.deepEqual(s.refused, []); assert.deepEqual(s.unmatched, ['Vacant']);
    });

    test('but an EMPTY duplicate no longer blinds the row that says something', () => {
        const e = { memberName: 'Vacant', shifts: Object.fromEntries(DATES.map(d => [d, '06:00-14:00'])) };
        // One empty row, one that works Monday only: the witness should now speak, and refuse the
        // six days the occupied row leaves blank. Before v24.03 it was silent on all seven.
        const s = applyGeometryWitness([e], geo(
            ['Vacant', '', '', '', '', '', '', ''],
            ['Vacant', '', '06:00-14:00', '', '', '', '', ''],
        ), DATES);
        assert.deepEqual(s.unmatched, [], 'the tie is broken, so the member is checked');
        assert.equal(s.refused.length, 1);
        assert.equal(s.refused[0].dates.length, 6, 'every day the occupied row leaves blank');
    });

    test('rows from several pages are one table', () => {
        const g = geo(MILLER);
        g.rows.push(...assignRunsToGrid(pageFrom([['S. Silva', '', 'RD', 'RD', 'RD', 'RD', 'RD', 'RD']])));
        const a = honest(); const b = honest(); b.memberName = 'S. Silva'; b.shifts[DATES[0]] = 'AL';
        const s = applyGeometryWitness([a, b], g, DATES);
        assert.deepEqual(s.refused, [{ memberName: 'S. Silva', dates: [DATES[0]] }]);
        assert.equal(s.status, 'complete');
    });
});

// ── geometryCoverage — the figure the ADMIN reads ──────────────────────────────────────────────
//
// A separate block from the witness above because it answers a different question. The witness asks
// *is this cell supportable?* and gets it right; this asks *how much of what you are looking at did
// I check?* — and until v22.45 it answered about rows the admin would never see.
//
// Organised by what a wrong answer costs, and here the loud direction is the one that shipped:
//   · UNDER-STATING coverage cries wolf. A fully-checked review wearing "1 of 2 rows checked —
//     check the rest carefully" teaches an admin the banner is noise, and a witness nobody reads is
//     a witness that is not there.
//   · OVER-STATING it is silent and far worse: "complete" over rows nothing looked at. The
//     `ran: false` case is the whole trap, because `unmatched` is empty when the witness never ran,
//     so a naive recount would call every row checked.
describe('geometryCoverage — counted over the rows that reach the review', () => {
    const stats = (o) => ({ checked: 0, total: 0, unmatched: [], ran: true, ...o });

    test('a hallucinated name no longer drags a fully-checked review down to partial', () => {
        // The reported case: the model returned one real member and one invention. The invention
        // can never match a physical row, so the raw figure was 1 of 2.
        const raw = stats({ checked: 1, total: 2, unmatched: ['J. Imaginary'] });
        assert.equal(raw.checked / raw.total, 0.5, 'the raw figure really is the pessimistic one');
        const c = geometryCoverage(raw, ['G. Miller']);
        assert.deepEqual(c, { status: 'complete', checked: 1, total: 1 });
    });

    test('a REAL member the witness could not match still shows as partial', () => {
        // The other direction: recounting must not launder a genuine gap. C. Reen reaches the
        // review and was never checked, so the admin must still be told.
        const c = geometryCoverage(stats({ checked: 1, total: 2, unmatched: ['C. Reen'] }),
            ['G. Miller', 'C. Reen']);
        assert.deepEqual(c, { status: 'partial', checked: 1, total: 2 });
    });

    test('a witness that never ran is unavailable, NOT complete', () => {
        // THE TRAP. `unmatched` is empty on every early return — no grid, no pdfjs, a wait timeout —
        // so filtering by it would find nothing unmatched and report a check that never happened.
        for (const why of ['no grid', 'pdfjs absent', 'wait-timeout']) {
            const c = geometryCoverage(stats({ ran: false }), ['G. Miller', 'C. Reen']);
            assert.equal(c.status, 'unavailable', why);
            assert.equal(c.checked, 0, why);
            assert.equal(c.total, 2, `${why}: the denominator still names what was NOT checked`);
        }
    });

    test('the witness ran and matched nobody is unavailable too', () => {
        // Distinct from the case above in cause and identical in consequence: there is no signal.
        const c = geometryCoverage(stats({ unmatched: ['G. Miller', 'C. Reen'] }), ['G. Miller', 'C. Reen']);
        assert.equal(c.status, 'unavailable');
    });

    test('missing stats are unavailable rather than a thrown import', () => {
        // This runs inside parseRosterPDF, whose whole contract is that the witness fails open.
        assert.equal(geometryCoverage(/** @type {any} */ (null), ['G. Miller']).status, 'unavailable');
    });

    test('it composes with the real applyGeometryWitness, not a restatement of it', () => {
        // The rule is only worth testing against the shape the production path actually produces —
        // a hand-written `stats` literal could agree with a `ran` flag the witness never sets.
        const geo = (...rowSpecs) => ({ available: true, pagesRead: 1, pagesRejected: 0, rows: assignRunsToGrid(pageFrom(rowSpecs)) });
        const real = ['G. Miller', '', 'RD', 'RD', 'RD', 'RD', 'RD', 'RD'];
        const entries = [
            { memberName: 'G. Miller', shifts: Object.fromEntries(DATES.map(d => [d, 'RD'])) },
            { memberName: 'J. Imaginary', shifts: Object.fromEntries(DATES.map(d => [d, 'RD'])) },
        ];
        const raw = applyGeometryWitness(entries, geo(real), DATES);
        assert.equal(raw.ran, true, 'the witness must report that it ran');
        assert.equal(raw.status, 'partial', 'raw: one of the two entries had no physical row');
        // Now count over what the review will actually list.
        assert.deepEqual(geometryCoverage(raw, ['G. Miller']), { status: 'complete', checked: 1, total: 1 });
    });
});

// ── The adapter, through the REAL pdfjs on a PDF built by hand ─────────────────────────────────

// An OPTIONAL check that can extend the critical path without bound is not optional (v22.39
// external review). Organised by what each wrong answer costs, and they are opposite in kind:
//
//   WAITING FOR EVER holds a finished parse — the model has already answered, the review is ready
//   to render — until the Cloud Function's own 120s timeout kills the whole request. The admin
//   gets an error for an import that actually worked.
//
//   GIVING UP TOO EASILY loses the only witness the model cannot influence, on a file that would
//   have been read a moment later. That is why the budget is on the WAIT and not on the work: the
//   extraction has already had the entire model call for free before the clock starts.
describe('the budgets — an optional witness may not hold the request open', () => {
    test('a witness that never settles is given up on, and says so', async () => {
        const never = new Promise(() => {});
        const g = await awaitGeometryWithin(/** @type {any} */ (never), 20);
        assert.equal(g.available, false);
        assert.equal(g.reason, 'wait-timeout');
        // The shape must be the one applyGeometryWitness already handles, or the timeout lands as
        // a crash instead of as the fail-open it is meant to be.
        const stats = applyGeometryWitness([{ memberName: 'G. Miller', shifts: {} }], g, DATES);
        assert.equal(stats.status, 'unavailable');
        assert.deepEqual(stats.refused, []);
    });

    test('a witness that answers in time is returned untouched', async () => {
        const real = { available: true, rows: [{ name: 'G. Miller', cells: [], occupancy: [true] }], pagesRead: 1, pagesRejected: 0 };
        assert.deepEqual(await awaitGeometryWithin(Promise.resolve(/** @type {any} */ (real)), 1000), real);
    });

    test('a witness that REJECTS fails open rather than failing the import', async () => {
        // It is documented never to throw. If that is ever untrue, the import must still proceed —
        // the whole design says this check can be absent.
        const g = await awaitGeometryWithin(Promise.reject(new Error('boom')), 1000);
        assert.equal(g.available, false);
        assert.equal(g.reason, 'threw');
    });

    test('the wait budget sits below the function\u2019s own 120s timeout, with room to spare', () => {
        // If it did not, it would never fire and the guard would be decorative.
        assert.ok(GEOMETRY_WAIT_BUDGET_MS > 0 && GEOMETRY_WAIT_BUDGET_MS <= 30_000,
            `${GEOMETRY_WAIT_BUDGET_MS}ms is not a bound on a 120s request`);
        assert.ok(GEOMETRY_WORK_BUDGET_MS > GEOMETRY_WAIT_BUDGET_MS,
            'the work budget bounds CPU and must outlive the wait, which bounds the request');
    });

    // The only test in this block that needs pdfjs: the other three are pure. Skipped on the
    // same terms as the real-pdfjs block below, so a bare checkout reports a skip rather than
    // an assertion failure a reviewer has to judge as environmental.
    test('the work budget stops between pages and KEEPS what it read', { skip: REAL_PDFJS_SKIP }, async () => {
        // Partial evidence is real evidence about the rows it covers — and `partial` is now stated
        // in the review, so stopping early is reported rather than silently narrowed.
        const pdf = buildPdf([rosterPage(ROSTER_FIXTURE), rosterPage(ROSTER_FIXTURE)]);
        let calls = 0;
        // A clock that jumps past the deadline once the first page has been read.
        const now = () => (calls++ < 2 ? 0 : 10_000);
        const g = await extractRosterGeometry(pdf, { workBudgetMs: 5_000, now });
        assert.equal(g.pagesRead, 1, 'the first page is kept');
        assert.equal(g.reason, 'work-budget');
        assert.ok(g.rows.length > 0, 'and so are its rows');
    });
});

describe('extractRosterGeometry — the real pdfjs, a hand-built roster', { skip: REAL_PDFJS_SKIP }, () => {
    const ROSTER = ROSTER_FIXTURE;

    test('reads the grid, the rows, and the empty Sunday — and skips the empty page and the footer', async () => {
        const pdf = buildPdf([rosterPage(ROSTER), []]);     // page 2 is completely empty
        const g = await extractRosterGeometry(pdf);
        assert.equal(g.available, true);
        assert.equal(g.pagesRead, 1);
        assert.equal(g.pagesRejected, 0, 'an empty page is skipped, not rejected');
        assert.deepEqual(g.rows.map(r => r.name), ['G. Miller', 'S. Silva', 'Vacant']);
        const miller = g.rows[0];
        assert.deepEqual(miller.occupancy, [false, true, true, true, true, true, true]);
        assert.equal(miller.cells[2], '06:20-14:20');
        assert.deepEqual(g.rows[1].occupancy, [true, true, true, true, true, true, true]);
    });

    test('END TO END: a claim on the empty Sunday is refused after the real read', async () => {
        const g = await extractRosterGeometry(buildPdf([rosterPage(ROSTER)]));
        const entry = { memberName: 'G. Miller', shifts: Object.fromEntries(DATES.map((d, i) =>
            [d, ['RD', '06:20-14:20', '06:20-14:20', 'RD', '07:00-16:00', '07:00-15:00', 'RD'][i]])) };
        // …that is the whole week slid one day LEFT, and Sunday now holds Monday's RD — so shift
        // once more to the real failure: put a DUTY in Sunday.
        entry.shifts[DATES[0]] = '06:20-14:20';
        const s = applyGeometryWitness([entry], g, DATES);
        assert.deepEqual(s.refused.map(r => r.memberName), ['G. Miller']);
        assert.match(entry.shifts[DATES[0]], /^UNKNOWN\|/);
    });

    test('a page whose rules are not the nine-column grid is rejected, and the read is unavailable', async () => {
        const g = await extractRosterGeometry(buildPdf([rosterPage(ROSTER, { vx: VX.slice(0, 4) })]));
        assert.equal(g.available, false);
        assert.equal(g.pagesRejected, 1);
        assert.equal(g.reason, 'no-grid');
    });

    test('a scanned sheet — a PDF with no text layer — is unavailable, not a refusal of everything', async () => {
        const g = await extractRosterGeometry(buildPdf([['q 0.5 w 100 100 m 100 700 l S Q']]));
        assert.equal(g.available, false);
        assert.equal(g.reason, 'no-text');
    });

    test('the sheet\'s own week is read from above the grid, and a spill page changes no row (import-server-2)', async () => {
        // Synthetic, in the measured shape: the heading's label and date as two runs on one line above
        // the top rule, and a spill page — a few runs at the left margin, no drawn rules.
        const page = rosterPage(ROSTER);
        page.push('BT /F1 9 Tf 635 760 Td (Week Ending:) Tj ET', 'BT /F1 9 Tf 712 760 Td (05/09/2026) Tj ET');
        const spill = ['BT /F1 9 Tf 23 400 Td (06:00) Tj ET', 'BT /F1 9 Tf 23 380 Td (14:00) Tj ET'];
        const g = await extractRosterGeometry(buildPdf([page, spill]));
        assert.deepEqual(g.weekEndings, [{ printed: '05/09/2026', iso: '2026-09-05' }]);
        assert.deepEqual(g.rows.map(r => r.name), ['G. Miller', 'S. Silva', 'Vacant'], 'the heading is no row, and the spill adds none');
        assert.deepEqual([g.pagesRead, g.pagesRejected], [1, 1], 'the spill page has no grid, and is rejected by content');
        // …and a heading on a page the grid read REJECTS is still read: the heading is not grid furniture.
        const cover = ['BT /F1 9 Tf 300 600 Td (Week Ending: 12/09/2026) Tj ET'];
        const g2 = await extractRosterGeometry(buildPdf([cover, rosterPage(ROSTER)]));
        assert.deepEqual(g2.weekEndings.map(h => h.iso), ['2026-09-12']);
    });

    test('a stroked `v` or `y` curve beside the table does not cost the page its grid (import-server-7)', async () => {
        // Through the REAL pdfjs, which routes both operators into the same path data as the rules.
        for (const curve of ['400 20 m 400.2 60 420 40 v 430 45 l S', '400 20 m 400.2 60 420 40 y 430 45 l S']) {
            const page = rosterPage(ROSTER);
            page.push(`q 0.5 w ${curve} Q`);
            const g = await extractRosterGeometry(buildPdf([page]));
            assert.equal(g.available, true, `${curve}: ${g.reason}`);
            assert.deepEqual(g.rows.map(r => r.name), ['G. Miller', 'S. Silva', 'Vacant']);
        }
    });

    test('a page read that places no member row says so — not "no-text", which means a scanned sheet', async () => {
        // The grid and its heading only.
        const headingOnly = await extractRosterGeometry(buildPdf([rosterPage([ROSTER[0]])]));
        assert.deepEqual([headingOnly.available, headingOnly.pagesRead, headingOnly.reason], [false, 1, 'no-rows']);
        // The whole fixture drawn twice the size under a halving `cm`. It LOOKS the same, but its rules
        // are read raw and its text transformed (the module header), so no run lands in the grid.
        const k = 2, top = 700, rowH = 50;
        const lines = [`${1 / k} 0 0 ${1 / k} 0 0 cm`, 'q 0.5 w'];
        for (const x of VX) lines.push(`${x * k} ${100 * k} m ${x * k} ${top * k} l S`);
        for (let r = 0; r <= ROSTER.length; r++) lines.push(`${25.3 * k} ${(top - r * rowH) * k} m ${822.5 * k} ${(top - r * rowH) * k} l S`);
        lines.push('Q');
        ROSTER.forEach(([name, ...cells], r) => {
            const y = (top - r * rowH - rowH / 2) * k;
            const text = (/** @type {string} */ s, /** @type {number} */ x) => lines.push(`BT /F1 ${9 * k} Tf ${x * k} ${y} Td (${s}) Tj ET`);
            if (name) text(name, NAME_X);
            cells.forEach((c, i) => { if (c) text(c, COL_X[i]); });
        });
        const scaled = await extractRosterGeometry(buildPdf([lines]));
        assert.deepEqual([scaled.available, scaled.pagesRead, scaled.reason], [false, 1, 'no-rows']);
    });

    test('garbage bytes never throw', async () => {
        const g = await extractRosterGeometry(Buffer.from('%PDF-1.4 this is not a pdf'));
        assert.equal(g.available, false);
        assert.equal(g.reason, 'unreadable-pdf');
    });

    test('pdfjs missing never throws — the import behaves as it did before the witness existed', async () => {
        const g = await extractRosterGeometry(buildPdf([rosterPage(ROSTER)]), { loadPdfjs: async () => { throw new Error('Cannot find package'); } });
        assert.equal(g.available, false);
        assert.equal(g.reason, 'pdfjs-unavailable');
        assert.equal(applyGeometryWitness([{ memberName: 'G. Miller', shifts: { [DATES[0]]: 'AL' } }], g, DATES).status, 'unavailable');
    });
});
