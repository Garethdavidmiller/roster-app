/**
 * roster-geometry.test.mjs — the PDF's own grid as a witness, organised by what a wrong answer COSTS.
 *
 * Run: node --test roster-geometry.test.mjs   (part of `npm run test:functions` — the adapter cases
 * need `pdfjs-dist` from functions/node_modules; everything else here is pure).
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
const pdfjsLoads = await (async () => {
    try { await import(PDFJS_SPECIFIER); return true; } catch { return false; }
})();
const pdfjsInstalled = (() => {
    try { require.resolve('pdfjs-dist/package.json'); return true; } catch { return false; }
})();
// Skip ONLY the genuinely-absent case. Installed-but-unloadable falls through and fails loudly.
const REAL_PDFJS_SKIP = (!pdfjsLoads && !pdfjsInstalled)
    && 'needs pdfjs-dist — run `cd functions && npm ci`, or `npm run test:functions`';
const {
    GRID_COLUMNS, rulesFromOperatorList, assignRunsToGrid, extractRosterGeometry,
    matchGeometryRow, applyGeometryWitness, awaitGeometryWithin,
    GEOMETRY_WAIT_BUDGET_MS, GEOMETRY_WORK_BUDGET_MS, _isClaim, _nameTokens,
} = require('./functions/roster-geometry.js');

// The measured grid from experiments/roster-pdf-geometry — the same nine x positions on every
// content page of every roster type and week-ending in the corpus.
const VX = [25.3, 154.8, 250.3, 347.0, 442.3, 537.5, 633.5, 729.5, 822.5];
const DATES = ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'];
/** x just inside each DAY column (index 0 = Sunday). */
const COL_X = VX.slice(1, 8).map(v => v + 40);
const NAME_X = 28.2;

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
    const OPS = { constructPath: 91, moveTo: 13, lineTo: 14, rectangle: 19, curveTo: 15, closePath: 18 };
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

    test('the pdfjs-6 encoding (a non-iterable fns) is skipped, not thrown — the v4 pin, stated', () => {
        assert.deepEqual(rulesFromOperatorList({ fnArray: [OPS.constructPath], argsArray: [[42, [0, 0]]] }, OPS), { vx: [], hy: [] });
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

    test('a member matched to a duplicate row (Vacant ×2) gets no signal rather than the first one', () => {
        const e = { memberName: 'Vacant', shifts: Object.fromEntries(DATES.map(d => [d, '06:00-14:00'])) };
        const s = applyGeometryWitness([e], geo(['Vacant', '', '', '', '', '', '', ''], ['Vacant', '06:00-14:00', '', '', '', '', '', '']), DATES);
        assert.deepEqual(s.refused, []); assert.deepEqual(s.unmatched, ['Vacant']);
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

// ── The adapter, through the REAL pdfjs on a PDF built by hand ─────────────────────────────────

/**
 * Write a PDF 1.4 file: one or more pages, each a list of content-stream lines. Rules are stroked
 * `x y m x y l S`; text is `BT /F1 9 Tf x y Td (…) Tj ET`. Offsets computed for the xref table.
 * @param {string[][]} pages
 */
function buildPdf(pages) {
    const enc = (/** @type {string} */ s) => Buffer.from(s, 'latin1');
    /** @type {Buffer[]} */
    const objs = [];
    const pageIds = pages.map((_, i) => 3 + i * 2);
    objs.push(enc('<< /Type /Catalog /Pages 2 0 R >>'));
    objs.push(enc(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`));
    const fontId = 3 + pages.length * 2;
    pages.forEach((lines, i) => {
        const content = enc(lines.join('\n') + '\n');
        objs.push(enc(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`));
        objs.push(Buffer.concat([enc(`<< /Length ${content.length} >>\nstream\n`), content, enc('\nendstream')]));
    });
    objs.push(enc('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'));
    let out = enc('%PDF-1.4\n');
    /** @type {number[]} */
    const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out = Buffer.concat([out, enc(`${i + 1} 0 obj\n`), o, enc('\nendobj\n')]); });
    const xref = out.length;
    let tail = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const o of offs) tail += `${String(o).padStart(10, '0')} 00000 n \n`;
    tail += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.concat([out, enc(tail)]);
}

/** A roster page: the nine drawn rules, row bands, and rows of [name, cell0..cell6]. */
function rosterPage(rowSpecs, { top = 700, rowH = 50, vx = VX } = {}) {
    const lines = ['q 0.5 w'];
    for (const x of vx) lines.push(`${x} 100 m ${x} ${top} l S`);
    for (let r = 0; r <= rowSpecs.length; r++) { const y = top - r * rowH; lines.push(`25.3 ${y} m 822.5 ${y} l S`); }
    lines.push('Q');
    rowSpecs.forEach(([name, ...cells], r) => {
        const y = top - r * rowH - rowH / 2;
        const text = (/** @type {string} */ s, /** @type {number} */ x) => lines.push(`BT /F1 9 Tf ${x} ${y} Td (${s.replace(/[()\\]/g, '\\$&')}) Tj ET`);
        if (name) text(name, NAME_X);
        cells.forEach((c, i) => { if (c) text(c, COL_X[i]); });
    });
    return lines;
}

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
/** The hand-built roster both the budget block and the pdfjs block read. Hoisted so a fixture is
 *  not duplicated: it is the same document either way. */
const ROSTER_FIXTURE = [
    ['Sunday', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    ['G. Miller', '', 'RD', '06:20-14:20', '06:20-14:20', 'RD', '07:00-16:00', '07:00-15:00'],
    ['S. Silva', '08:00-16:00', 'RD', 'RD', '08:00-16:00', '08:00-16:00', '08:00-16:00', '08:00-16:00'],
    ['Vacant', '', '', '', '', '', '', ''],
    ['Print Date: 27/08/2026', '', '09:52', 'Page 1 of 2', '', '', '', ''],
];

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
