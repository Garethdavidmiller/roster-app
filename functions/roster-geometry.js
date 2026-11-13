/**
 * roster-geometry.js — what the roster PDF's OWN GRID says about where each cell is, and the one
 * refusal that follows from it.
 *
 * CommonJS, like every file under functions/. Tested by roster-geometry.test.mjs (test:functions).
 * The pipeline's contract — every other defence, and where this one sits among them — is
 * `.claude/rules/roster-import.md`.
 *
 * ── THE PROBLEM THIS IS THE ONLY ANSWER TO ──────────────────────────────────────────────────────
 *
 * The import's day-drift defences — the row read, `sundayScan`, `columnScan` — are three readings
 * by ONE model of ONE PDF in ONE call. They are not independent witnesses: when the model visually
 * collapses a blank Sunday cell and slides the week a day left, every one of them repeats the same
 * positional mistake and every cross-check agrees with the wrong answer. `roster-alignment.js`
 * compares against the member's base roster instead — genuinely independent, but WEAK by design,
 * because a published roster legitimately carries leave, absence, overtime and swaps.
 *
 * A STRONG witness turns out to be in the file. The table's rules are DRAWN — stroked `moveTo`/
 * `lineTo` segments at nine fixed x positions, identical on every content page of every roster type
 * and every week-ending measured (12 documents, `experiments/roster-pdf-geometry/`). Assigning each
 * text run to a cell by coordinate places every member × every day correctly, and on the exact row
 * that drifts, NOT ONE text object falls inside the Sunday column. The cell is empty as a matter of
 * physical fact. The flattened text stream the model reads loses exactly that.
 *
 * ── WHAT THIS DOES, AND — DELIBERATELY — WHAT IT DOES NOT (ROADMAP phase 1) ───────────────────
 *
 * It answers one question per cell: does the physical cell hold ANY text? And it applies one rule:
 *
 *     An AI day the physical cell cannot support is REFUSED, not weighed.
 *
 * No probability, no second opinion, no repair. A claim (a duty, an absence, anything that is not a
 * rest day) landing in an empty cell becomes an UNREADABLE review cell, and the member's row is
 * reported to the client so the WHOLE row starts unticked — because a claim in an empty cell means
 * the row is misaligned, and the cells that happen to land on occupied days are wrong too, just
 * invisibly. Measured on the corpus: **zero false refusals**, and it refuses every one of the
 * blank-Sunday collapses that are the reported bug.
 *
 * What it cannot see, stated rather than implied: a member whose week is FULLY occupied has no
 * empty cell for a shifted claim to contradict, so a drift on that row passes this witness (it may
 * still trip `roster-alignment.js`). And `RD` written into an occupied cell is not checked here —
 * telling a printed "RD" from a printed duty means READING the text, which is phase 3, and a rule
 * that read it now would be the model's job done twice with two sets of failure modes. (The one
 * sub-case that needs only "is the cell filled at all" — an EMPTY read of a filled cell on the
 * geometry path — is `reviewBlankReadsOfFilledCells` in roster-prompt.js, whole-app review H3; its
 * reverse, a rest day read for an EMPTY weekday cell, is `reviewRestReadsOfEmptyCells` beside it.)
 *
 * ── FAIL OPEN, EVERYWHERE, AND SAY SO ───────────────────────────────────────────────────────────
 *
 * pdfjs missing, a page without the grid, a member whose name the PDF spells differently, a
 * scanned sheet with no text layer: each is "no signal for that cell", never an error, and never a
 * refusal. The import behaved without this witness for two years; a witness that could take the
 * import down would be a worse trade than none. The stats it returns exist so the client can SHOW
 * the admin when the witness did not run — a fail-open that is invisible is the v16.70 lesson.
 *
 * ── THE HAZARDS GEOMETRY INTRODUCES IN EXCHANGE FOR THE ONE IT REMOVES ─────────────────────────
 *
 * All three were found on real files and each has a test:
 *   · **The print footer sits INSIDE the grid.** `Print Date: 27/08/2026 | 09:52 | Page 1 of 3`
 *     parses as a member row with `Page 1 of 3` in the Tuesday column. Filtered by name AND by
 *     content, because one of the two is not enough.
 *   · **`Vacant` is a real row name, three times.** Rows are not uniquely keyed by name, so a
 *     member matched to MORE than one geometry row gets no signal rather than the first one.
 *   · **Three of six pages can be empty** (no text items at all). Skipped by CONTENT, never by
 *     page number.
 *
 * One it has not met: the rules are read from the path's RAW coordinates and the text from pdfjs's
 * TRANSFORMED ones, so a page drawn under a scaling `cm` puts its text beside its grid rather than in
 * it. The corpus draws none; such a page places no row and fails open as `no-rows`.
 *
 * pdfjs is PINNED EXACTLY, to 6.5.438 (v25.91), in functions/package.json and the root's copy for
 * the tests — dependency-pin-parity.test.mjs holds the two together. This file reads
 * `OPS.constructPath`'s argument shape directly, and pdfjs has changed it before (5.1.91, and the
 * codes renumbered at 5.4.394): a change does not throw, it makes every document `no-grid`, so the
 * witness stops SILENTLY. The real-pdfjs tests in roster-geometry.test.mjs are what say so — run
 * them on any new version before the pin moves. What the move from v4 established:
 *   · the encoding is `rulesFromOperatorList`'s header. A `re` arrives as lines and is skipped
 *     (`isRectangleOp`), or a page clip or a shaded cell adds columns. Compared with 4.10.38 on
 *     eleven ways of drawing the table (13 Nov 2026), the rows read were the same to the byte on
 *     every one but rows drawn as closed boxes in a `re`'s own corner order: there 6.x reads no
 *     grid, fails open, and the review says so. No real roster was to hand that day, so the first
 *     import after the move is the check — its review must not say the layout check couldn't run;
 *   · the legacy build stays — from 5.x it polyfills `Map.prototype.getOrInsertComputed`, which
 *     neither Node 22 nor Node 24.22 has (measured 4 Nov 2026);
 *   · `isEvalSupported` is gone (pdf.js PR 21005), and with it every route from a PDF to `eval`:
 *     the 6.5.438 builds hold no `Function` constructor but a polyfill's fixed `return this`
 *     (counted 13 Nov 2026). What a PDF CAN still become is WebAssembly, so the adapter turns that
 *     off (`useWasm: false`, below);
 *   · NEVER below 6.5.438: every 5.x and 6.x before it can HANG synchronously on a malformed
 *     Type 4 function (its tree builder had no work limit until pdf.js PR 22365; 5.7.284's is
 *     byte-identical to 6.4.299's), and no time budget in this file can stop a synchronous loop;
 *   · its optional native canvas is pinned too (`overrides`, 1.1.0), so an install cannot take a
 *     release younger than the two weeks every dependency here waits;
 *   · the in-app PDF viewer does NOT follow: it stays on PDF.js 4.10.38, because 6.x's legacy build
 *     targets Safari 18 and the app supports iOS 16.4 (pdf-viewer.js; DECISIONS.md).
 */

'use strict';

const { BLANK_CELL_TOKEN, reviewLabel } = require('./roster-parse-helpers');
const { weekEndingsOnPage } = require('./roster-week-heading');

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Nine vertical rules: NAME + seven days. Anything else is not the roster grid. */
const GRID_COLUMNS = 9;

/** Row names that are the table's own furniture, never a member. */
const FURNITURE_NAME = /^(Sunday|Weekly|MARYLEBONE|Marylebone|Week|Print Date)/i;
/** The one cell content that marks the print footer wherever its name landed. */
const FOOTER_CELL = /\bPage\s+\d+\s+of\s+\d+\b/i;

// ── 1. The drawn rules ──────────────────────────────────────────────────────────────────────────

/**
 * The codes pdfjs writes into a path's data, since 5.4.394 (its `DrawOPS`, which the library does
 * not export, so they are restated here). A renumbering would read no rule at all — every roster
 * `no-grid`, silently — and the real-pdfjs test that pins these codes to the installed library is
 * what says so (roster-geometry.test.mjs).
 */
const PATH_OP = Object.freeze({ moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 });
/** How many numbers follow each code. A code missing here cannot be stepped over safely. */
const PATH_OPERANDS = Object.freeze({ 0: 2, 1: 2, 2: 6, 3: 4, 4: 0 });

/**
 * Split one path's data into subpaths — `[{ points: [[x, y], …], ops: [code, …] }]`. Null when the
 * data holds a code this reader does not know, or runs short: an operand cannot be stepped over
 * without knowing how many there are, and reading past one turns every later number into a phantom
 * point (the import-server-7 lesson). The caller reads nothing from such a path.
 * @param {ArrayLike<number>} data
 */
function subpathsOf(data) {
    /** @type {Array<{ ops: number[], points: number[][] }>} */
    const subpaths = [];
    let current = null;
    for (let k = 0; k < data.length;) {
        const op = data[k];
        const n = PATH_OPERANDS[op];
        if (n === undefined || k + 1 + n > data.length) return null;
        if (op === PATH_OP.moveTo || !current) { current = { ops: [], points: [] }; subpaths.push(current); }
        current.ops.push(op);
        // The operands' LAST pair is where the pen ends: a line's or a move's only point, and a
        // curve's end point (a closePath has none).
        current.points.push(n ? [data[k + n - 1], data[k + n]] : []);
        k += 1 + n;
    }
    return subpaths;
}

/**
 * Whether a subpath is EXACTLY what pdfjs writes for a PDF `re` (`buildPath` in its worker, read at
 * 6.5.438): a move to the corner, a line along x, a line along y, a line back along x, then a close —
 * or, when the width or height is zero, a move, one straight line and a close. v4 kept every `re`
 * out of the rules, and the corner order is the only trace of one that 6.x leaves.
 *
 * So a box drawn by hand in any other order — down the page first, as a table drawing each cell as a
 * closed path may — cannot be a `re`; v4 read its sides, and so does this. One drawn by hand in a
 * `re`'s own order cannot be told from one, and is skipped. That is the one drawing on which 6.5.438
 * reads LESS than 4.10.38 did (measured 13 Nov 2026, on synthetic pages: rows drawn as closed boxes
 * in that order cost the page its grid). Reading less fails open, and the review says so ("The extra
 * PDF layout check couldn't run"); reading more could hand the cell read a WRONG grid, and a wrong
 * grid puts a duty on the wrong day — the failure this whole module exists to stop.
 * @param {{ ops: number[], points: number[][] }} subpath
 */
function isRectangleOp({ ops: codes, points: pts }) {
    const { moveTo: M, lineTo: L, closePath: Z } = PATH_OP;
    if (codes.length === 5 && codes[0] === M && codes[1] === L && codes[2] === L && codes[3] === L && codes[4] === Z) {
        const [p0, p1, p2, p3] = pts;
        return p1[1] === p0[1] && p2[0] === p1[0] && p3[1] === p2[1] && p3[0] === p0[0];
    }
    if (codes.length === 3 && codes[0] === M && codes[1] === L && codes[2] === Z) {
        const [p0, p1] = pts;
        return p1[0] === p0[0] || p1[1] === p0[1];
    }
    return false;
}

/**
 * Every vertical and horizontal rule actually STROKED on the page, clustered to the nearest 2px.
 *
 * They are `moveTo`/`lineTo` segments, not rectangles — the first version of the experiment looked
 * only for rectangles and reported zero rules on every page, a confident wrong answer.
 *
 * The 5.4.394+ encoding (pdf.js PR 19689 changed it at 5.1.91, and 5.4.394 renumbered the codes):
 * each `constructPath` carries `[paintOp, [pathData…], bbox]`, and each path's data is ONE flat
 * array of codes (`PATH_OP`) and absolute coordinates. Anything else — the v4 shape included — has
 * no array where the paths are, so it reads no rule and the page fails open as `no-grid`.
 *
 * A RECTANGLE IS NOT A RULE, and the new encoding no longer says which subpaths were rectangles: a
 * PDF `re` arrives as lines and a close. So exactly what a `re` becomes is skipped (`isRectangleOp`),
 * as v4 skipped its `rectangle` operator — a page clip or a shaded cell otherwise adds columns
 * (measured on 6.4.299, 4 Nov 2026). A box drawn BY HAND is not skipped wholesale: a table can draw
 * its cells as closed boxes, and v4 read their sides (`isRectangleOp` says which ones it cannot).
 *
 * A curve's end point is NOT taken as the current point, exactly as under v4 — the corpus was
 * measured that way (experiments/roster-pdf-geometry), and the rules are straight. Its operands are
 * still stepped over (`subpathsOf`), which is what import-server-7 was about.
 *
 * @param {{ fnArray: number[], argsArray: any[] }} ops   a pdfjs operator list
 * @param {Record<string, number>} OPS                     pdfjs's OPS enum
 * @returns {{ vx: number[], hy: number[] }}               ascending x positions, ascending y positions
 */
function rulesFromOperatorList(ops, OPS) {
    const vx = new Set(), hy = new Set();
    for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] !== OPS.constructPath) continue;
        const paths = ops.argsArray[i]?.[1];
        if (!Array.isArray(paths)) continue;
        for (const data of paths) {
            if (!data || typeof data.length !== 'number') continue;
            const subpaths = subpathsOf(data);
            if (!subpaths) continue;
            for (const subpath of subpaths) {
                if (isRectangleOp(subpath)) continue;
                const { ops: codes, points } = subpath;
                let cx = 0, cy = 0, sx = 0, sy = 0;
                codes.forEach((code, j) => {
                    const [x, y] = points[j];
                    if (code === PATH_OP.moveTo) { cx = x; cy = y; sx = x; sy = y; }
                    else if (code === PATH_OP.lineTo) {
                        if (Math.abs(x - cx) < 0.6 && Math.abs(y - cy) > 3) vx.add(+((x + cx) / 2).toFixed(1));
                        if (Math.abs(y - cy) < 0.6 && Math.abs(x - cx) > 3) hy.add(+((y + cy) / 2).toFixed(1));
                        cx = x; cy = y;
                    }
                    else if (code === PATH_OP.closePath) { cx = sx; cy = sy; }
                    // A curve (2) or quadratic (3): operands already stepped over; the pen stays put.
                });
            }
        }
    }
    const cluster = (/** @type {Set<number>} */ set, /** @type {number} */ tol) => {
        /** @type {number[]} */
        const out = [];
        for (const v of [...set].sort((p, q) => p - q)) {
            if (out.length && Math.abs(v - out[out.length - 1]) <= tol) continue;
            out.push(v);
        }
        return out;
    };
    return { vx: cluster(vx, 2), hy: cluster(hy, 2) };
}

// ── 2. Text runs → cells ────────────────────────────────────────────────────────────────────────

/**
 * Assign every text run on one page to its physical (row, column) cell.
 *
 * PURE: takes the runs and the rules, returns member rows. The pdfjs shapes are flattened first so
 * this can be driven from a JSON fixture without a PDF.
 *
 * @param {{ items: Array<{ str: string, x: number, y: number }>, vx: number[], hy: number[] }} page
 * @returns {Array<{ name: string, cells: string[], occupancy: boolean[] }>|null}
 *   null when the page does not carry the nine-column grid (the caller counts it as rejected)
 */
function assignRunsToGrid({ items, vx, hy }) {
    if (!Array.isArray(vx) || vx.length !== GRID_COLUMNS) return null;
    if (!Array.isArray(hy) || hy.length < 2) return null;

    // Rows: the horizontal rules, top to bottom (PDF y grows upwards). A member's row is the band
    // between two of them.
    const rows = [...hy].sort((p, q) => q - p);
    /** @type {Map<number, { name: string[], cells: Array<Array<{ s: string, x: number, y: number }>> }>} */
    const byRow = new Map();
    for (const it of items || []) {
        const s = String(it.str ?? '').trim();
        if (!s) continue;
        const { x, y } = it;
        const ri = rows.findIndex((r, i) => y < r && (i + 1 >= rows.length || y >= rows[i + 1]));
        if (ri < 0) continue;
        const ci = vx.findIndex((v, i) => i + 1 < vx.length && x >= v - 1 && x < vx[i + 1]);
        if (ci < 0) continue;
        if (!byRow.has(ri)) byRow.set(ri, { name: [], cells: DAY_LABELS.map(() => []) });
        const r = /** @type {any} */ (byRow.get(ri));
        if (ci === 0) r.name.push(s); else r.cells[ci - 1].push({ s, x, y });
    }

    /** @type {Array<{ name: string, cells: string[], occupancy: boolean[] }>} */
    const out = [];
    for (const [, r] of [...byRow.entries()].sort((p, q) => p[0] - q[0])) {
        const name = r.name.join(' ').replace(/\s+/g, ' ').trim();
        if (!name || FURNITURE_NAME.test(name)) continue;
        const cells = r.cells.map(cellRuns => {
            // Group by line (y), top line first; within a line, left to right.
            /** @type {Map<number, Array<{ s: string, x: number, y: number }>>} */
            const lines = new Map();
            for (const run of cellRuns) {
                const key = Math.round(run.y);
                const k = [...lines.keys()].find(v => Math.abs(v - key) < 4) ?? key;
                if (!lines.has(k)) lines.set(k, []);
                /** @type {any} */ (lines.get(k)).push(run);
            }
            return [...lines.entries()].sort((p, q) => q[0] - p[0])
                .map(([, runs]) => runs.sort((p, q) => p.x - q.x).map(i => i.s).join('').replace(/\s+/g, ' ').trim())
                .filter(Boolean).join(' | ');
        });
        // The footer, by CONTENT — its name is not always the first thing in the row.
        if (cells.some(c => FOOTER_CELL.test(c))) continue;
        out.push({ name, cells, occupancy: cells.map(c => c.length > 0) });
    }
    return out;
}

// ── 3. The adapter — the only code that touches pdfjs ───────────────────────────────────────────

/** @typedef {{ available: boolean, reason?: string, rows: Array<{ name: string, cells: string[], occupancy: boolean[] }>, pagesRead: number, pagesRejected: number, weekEndings?: Array<{ printed: string, iso: string|null }> }} RosterGeometry */

/**
 * Read the roster PDF's grid. NEVER THROWS — every failure is a `RosterGeometry` with
 * `available: false` (nothing usable) or with fewer pages, so the import proceeds as it did before
 * this witness existed. It also gathers the sheet's own `Week Ending:` headings (`weekEndings`) from
 * every page with text, grid or not: the heading sits above the grid (roster-week-heading.js).
 *
 * @param {Buffer|Uint8Array} pdfBytes
 * @param {{ loadPdfjs?: () => Promise<any> }} [deps]   injectable for tests; default imports the pinned pdfjs-dist (6.5.438)
 * @returns {Promise<RosterGeometry>}
 */
async function extractRosterGeometry(pdfBytes, { loadPdfjs, workBudgetMs = GEOMETRY_WORK_BUDGET_MS, now = Date.now } = {}) {
    /** @type {RosterGeometry} */
    const result = { available: false, rows: [], pagesRead: 0, pagesRejected: 0, weekEndings: [] };
    const deadline = now() + workBudgetMs;
    let pdfjs;
    try {
        pdfjs = await (loadPdfjs || (() => import('pdfjs-dist/legacy/build/pdf.mjs')))();
    } catch (err) {
        result.reason = 'pdfjs-unavailable';
        console.warn(`[roster-geometry] pdfjs-dist could not be loaded — the geometry witness did not run: ${err && err.message}`);
        return result;
    }
    let task = null;
    try {
        const data = pdfBytes instanceof Uint8Array ? new Uint8Array(pdfBytes) : new Uint8Array(Buffer.from(pdfBytes));
        // useWasm:false — nothing in a PDF is compiled into code that runs here. PDF.js 6 has no
        // `eval` left to switch off (`isEvalSupported` went with it: glyphs become path data), but by
        // default it compiles a PDF's Type 4 functions to WebAssembly; off, it runs them from its own
        // instruction list. Text and geometry need neither. The hang a malformed Type 4 function
        // caused is bounded on BOTH routes only from 6.5.438 (pdf.js PR 22365): never pin below it.
        task = pdfjs.getDocument({ data, useSystemFonts: true, verbosity: 0, useWasm: false });
        const doc = await task.promise;
        for (let p = 1; p <= doc.numPages; p++) {
            // Checked BETWEEN pages, where the loop is genuinely between awaits. Pages already read
            // are kept: they are real evidence about the rows they cover, and stopping early is
            // reported honestly as `partial` rather than thrown away as nothing.
            if (now() >= deadline) {
                result.reason = 'work-budget';
                console.warn(`[roster-geometry] stopped after ${result.pagesRead} page(s) — the ${workBudgetMs}ms work budget was spent`);
                break;
            }
            try {
                const page = await doc.getPage(p);
                const tc = await page.getTextContent();
                if (!tc.items.length) continue;                       // an empty page is not a rejection
                const items = tc.items.map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));
                result.weekEndings.push(...weekEndingsOnPage(items)); // before the grid: it may reject the page
                const { vx, hy } = rulesFromOperatorList(await page.getOperatorList(), pdfjs.OPS);
                const rows = assignRunsToGrid({ items, vx, hy });
                if (rows === null) { result.pagesRejected++; continue; }
                result.pagesRead++;
                result.rows.push(...rows);
            } catch (err) {
                result.pagesRejected++;
                console.warn(`[roster-geometry] page ${p} could not be read: ${err && err.message}`);
            }
        }
    } catch (err) {
        result.reason = 'unreadable-pdf';
        console.warn(`[roster-geometry] the PDF could not be opened — the geometry witness did not run: ${err && err.message}`);
        return result;
    } finally {
        try { if (task) await task.destroy(); } catch { /* nothing left to free */ }
    }
    result.available = result.rows.length > 0;
    // A page READ is a page with text and the nine-column grid, so when such a page placed no member
    // row the honest reason is that — not `no-text`, which sent the reader to a scanned sheet.
    if (!result.available && !result.reason) {
        result.reason = result.pagesRead ? 'no-rows' : result.pagesRejected ? 'no-grid' : 'no-text';
    }
    return result;
}

// ── 4. The witness ──────────────────────────────────────────────────────────────────────────────

/** Letters only, lower-cased, as a sorted token list — "G. Miller", "Miller G" and "Miller, G." agree. */
function nameTokens(name) {
    return String(name || '').toLowerCase().split(/[^a-z]+/).filter(Boolean).sort();
}

/**
 * The geometry rows for one member — exactly one, or none.
 *
 * Tier 1: the same letters in any order ("G. Miller" ≡ "Miller G"). Tier 2, only if tier 1 finds
 * nothing: a unique row sharing the longest token (the surname) whose other token starts with the
 * same letter ("Gareth Miller" for "G. Miller"). More than one candidate at either tier is NO
 * signal — `Vacant` appears three times on one real sheet.
 *
 * ── THE ONE WAY A TIE IS BROKEN, AND WHY IT IS SAFE (v24.03) ───────────────────────────────────
 *
 * A real Dispatch sheet carries TWO rows for the same person: an EMPTY `S Faure` placeholder above
 * the real `S. Faure` row. They tokenise identically, so the tie rule above refused both and she
 * got no geometry signal on any Dispatch import — the witness silently skipping one member, every
 * week, which is exactly the shape of failure this module exists to remove.
 *
 * So a tie is broken when EXACTLY ONE of the tied rows has any content at all. An empty row states
 * nothing, and cannot be the row that was meant. Note what this deliberately does NOT do: two tied
 * rows that BOTH carry content stay refused, because then the sheet really is ambiguous and picking
 * either would be a guess. It can only ever narrow a tie the old rule dropped — it can never
 * promote a non-match, and it never chooses between two rows that both say something.
 *
 * @param {string} memberName
 * @param {Array<{ name: string, occupancy: boolean[] }>} rows
 * @returns {{ name: string, occupancy: boolean[] }|null}
 */
function matchGeometryRow(memberName, rows) {
    const want = nameTokens(memberName);
    if (!want.length) return null;
    const exact = rows.filter(r => nameTokens(r.name).join(' ') === want.join(' '));
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return soleOccupied(exact);
    const surname = want.reduce((a, b) => (b.length > a.length ? b : a), '');
    const initials = want.filter(t => t !== surname).map(t => t[0]);
    const loose = rows.filter(r => {
        const t = nameTokens(r.name);
        if (!t.includes(surname)) return false;
        const rest = t.filter(x => x !== surname).map(x => x[0]);
        return initials.every(i => rest.includes(i));
    });
    return loose.length === 1 ? loose[0] : soleOccupied(loose);
}

/**
 * The one tied row that says anything — or null when none does, or more than one does.
 * @param {Array<{ name: string, occupancy: boolean[] }>} tied
 * @returns {{ name: string, occupancy: boolean[] }|null}
 */
function soleOccupied(tied) {
    const occupied = tied.filter(r => Array.isArray(r.occupancy) && r.occupancy.some(Boolean));
    return occupied.length === 1 ? occupied[0] : null;
}

/** A parsed value that asserts SOMETHING happened on the day — the only kind an empty cell can refute. */
function isClaim(v) {
    if (typeof v !== 'string') return false;
    const s = v.trim();
    if (!s || s.startsWith('UNKNOWN|')) return false;
    const u = s.toUpperCase();
    return u !== 'RD' && u !== 'OFF' && u !== BLANK_CELL_TOKEN;
}

/**
 * Refuse every AI day the PDF's own grid cannot support (modifies `safeEntries` in place).
 *
 * @param {Array<{ memberName: string, shifts: Record<string, string> }>} safeEntries
 * @param {RosterGeometry|null|undefined} geometry
 * @param {string[]} dates   7 ISO dates, Sunday first
 * @returns {{ status: 'complete'|'partial'|'unavailable', refused: Array<{ memberName: string, dates: string[] }>,
 *             checked: number, total: number, unmatched: string[], ran: boolean }}
 *   `ran` says whether the witness got past its own preconditions at all. It exists because
 *   `checked === 0` cannot distinguish "there was no grid to compare against" from "there was a
 *   grid and it matched nobody", and `geometryCoverage` below has to tell those apart.
 */
function applyGeometryWitness(safeEntries, geometry, dates) {
    const stats = { status: /** @type {'complete'|'partial'|'unavailable'} */ ('unavailable'),
        refused: /** @type {Array<{ memberName: string, dates: string[] }>} */ ([]),
        checked: 0, total: safeEntries.length, unmatched: /** @type {string[]} */ ([]), ran: false };
    if (!geometry || !geometry.available || !Array.isArray(geometry.rows) || !geometry.rows.length) return stats;
    if (!Array.isArray(dates) || dates.length < 7) return stats;
    stats.ran = true;

    for (const entry of safeEntries) {
        const row = matchGeometryRow(entry.memberName, geometry.rows);
        if (!row) { stats.unmatched.push(entry.memberName); continue; }
        stats.checked++;
        /** @type {string[]} */
        const refusedDates = [];
        for (let i = 0; i < 7; i++) {
            const d = dates[i];
            const v = entry.shifts[d];
            if (!isClaim(v) || row.occupancy[i]) continue;
            // THE RULE. Not weighed, not repaired — refused, with both facts stated.
            console.warn(`[parseRosterPDF] ${entry.memberName} ${d}: "${v}" was read for ${DAY_LABELS[i]}, but the PDF's ${DAY_LABELS[i]} cell on that row is EMPTY — refused (the row is probably a day out)`);
            entry.shifts[d] = `UNKNOWN|${reviewLabel(v)} was read here, but this cell is empty on the PDF — the row may be a day out`;
            refusedDates.push(d);
        }
        if (refusedDates.length) stats.refused.push({ memberName: entry.memberName, dates: refusedDates });
    }
    stats.status = stats.checked === 0 ? 'unavailable' : stats.checked >= stats.total ? 'complete' : 'partial';
    return stats;
}

/**
 * The coverage figure the ADMIN is shown — counted over the rows that reach the review, not over
 * everything the model returned (v22.45, external review).
 *
 * THE DEFECT. `applyGeometryWitness` runs before hallucinated names are filtered out, because a
 * refusal has to be stamped into the entry while the entry still exists. A name the roster does not
 * contain can never match a physical row, so it lands in `unmatched` and inflates `total` — and
 * only `total`. One real member fully checked alongside one invented name reported `1 of 2 rows
 * checked — partial`, and the admin then read a "check the remaining rows carefully" banner about a
 * review in which every row HAD been checked. Nothing bad is written; the warning is simply
 * pessimistic, and a warning that cries wolf is how a witness stops being read.
 *
 * WHY THIS IS NOT THE v16.76 MISTAKE, which the column cross-check carries a comment about: there
 * the bug was MIXING populations — a numerator counted over everything against a denominator
 * counted over the filtered rows, so a hallucinated row with strong column signal pushed the ratio
 * to 'complete' while a real member went unchecked. Both figures here come from the same
 * population, and the asymmetry that makes it safe is specific: a hallucinated name can only ever
 * be `unmatched`, never `checked`, because matching requires a row bearing that name in the PDF.
 * So recounting can only ever REMOVE an unchecked row, never add a checked one.
 *
 * @param {{ checked: number, total: number, unmatched: string[], ran: boolean }} stats  from applyGeometryWitness
 * @param {string[]} reviewedNames  the member names that actually reach the review table
 * @returns {{ status: 'complete'|'partial'|'unavailable', checked: number, total: number }}
 */
function geometryCoverage(stats, reviewedNames) {
    // The witness never ran — no grid, no pdfjs, a timeout. `unmatched` is empty in that case, so
    // recounting would call every reviewed row "checked" and report a check that never happened.
    // This branch is the whole reason `ran` exists.
    if (!stats || !stats.ran) return { status: 'unavailable', checked: 0, total: reviewedNames.length };
    const unmatched = new Set(stats.unmatched);
    const total = reviewedNames.length;
    const checked = reviewedNames.filter(n => !unmatched.has(n)).length;
    return { status: checked === 0 ? 'unavailable' : checked >= total ? 'complete' : 'partial', checked, total };
}

/**
 * How long the caller will WAIT for the grid read, each time it waits — and the reason the budget
 * is on the wait rather than on the work.
 *
 * Since phase 2 (v24.04) the read is awaited BEFORE the model call, because a usable grid decides
 * which prompt is sent, so it sits on the critical path: under a second a document on the corpus,
 * at most this budget. Only a wait that gave up is repeated after the model has answered
 * (`settledGeometry`), so a pathological PDF costs two budgets at worst. That tail is what the bound
 * is for (v22.39): a PDF where pdfjs never settles would otherwise hold a finished parse until the
 * Cloud Function's own 120s timeout — an OPTIONAL check extending the critical path without bound,
 * which contradicts the whole fail-open contract.
 *
 * **Stopping the wait is not stopping the work**, exactly as `fetch-timeout.js` says on the client
 * side. The extraction keeps running in the instance until it finishes or the instance goes; that
 * costs nothing on the request, and the witness has no side effects to leave half-done. The
 * `workBudgetMs` between-pages check above is the other half — it bounds the CPU, this bounds the
 * wait, and the two answer different questions.
 */
const GEOMETRY_WAIT_BUDGET_MS = 8000;

/** The absolute cap on the extraction itself, checked between pages. Generous: a read that outlasts
 *  the first wait goes on running through the model call, and the corpus reads 12 documents in well
 *  under a second each — this is for the pathological case, not the ordinary one. */
const GEOMETRY_WORK_BUDGET_MS = 45000;

/**
 * Wait for the witness, but not for ever. Returns whatever it produced, or a fail-open
 * `RosterGeometry` saying it timed out — the same shape `applyGeometryWitness` already handles, so
 * the timeout lands on `status: 'unavailable'` and reaches the admin through the review banner
 * rather than being assumed away.
 * @param {Promise<RosterGeometry>} promise
 * @param {number} [ms]
 * @returns {Promise<RosterGeometry>}
 */
async function awaitGeometryWithin(promise, ms = GEOMETRY_WAIT_BUDGET_MS) {
    /** @type {any} */
    let timer;
    /** @type {RosterGeometry} */
    const timedOut = { available: false, reason: 'wait-timeout', rows: [], pagesRead: 0, pagesRejected: 0 };
    try {
        return await Promise.race([
            // A rejection here would be a bug in a function documented never to throw, but the
            // whole point of this file is that the import survives one — so it fails open too.
            promise.catch(err => {
                console.warn(`[roster-geometry] the witness rejected, which it is not meant to do: ${err && err.message}`);
                return { available: false, reason: 'threw', rows: [], pagesRead: 0, pagesRejected: 0 };
            }),
            new Promise(resolve => { timer = setTimeout(() => {
                console.warn(`[roster-geometry] gave up waiting after ${ms}ms — the import proceeds without the second witness`);
                resolve(timedOut);
            }, ms); }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Reuse a settled geometry result, and ask again ONLY when the early wait gave up.
 *
 * ── WHY THIS IS A FUNCTION AND NOT TWO LINES IN THE COORDINATOR (v24.05) ───────────────────────
 *
 * Phase 2 moved the first `awaitGeometryWithin` in FRONT of the model call so the cells could be
 * handed over already separated. The first cut of that then reused the early result for the
 * phase-1 witness further down, on the reasoning that the promise had settled by then.
 *
 * It has not settled when the early wait TIMED OUT. `awaitGeometryWithin` is a `Promise.race`: the
 * extraction keeps running and the caller is holding the fail-open object. Reusing it threw away a
 * witness the PRE-phase-2 ordering would have had — before, the only await came after the model
 * call, so a slow extraction had the model's whole latency plus the budget; after, it had the
 * budget alone, and a PDF that overran it lost BOTH the geometry path and the witness. A safety net
 * getting smaller as a side effect of a change that was meant to add one.
 *
 * It lives here rather than inline because it was a WIRING mistake, not a rule mistake — the
 * helpers were both correct and the coordinator used them wrongly, which is the one shape a unit
 * test of either helper can never catch. As a named function it is drivable directly, and the
 * coordinator's use of it is a single call with no branch left to get wrong.
 *
 * @param {RosterGeometry|null|undefined} early   what the pre-model wait returned
 * @param {Promise<RosterGeometry>} promise       the SAME extraction, still running on a timeout
 * @param {(p: Promise<RosterGeometry>) => Promise<RosterGeometry>} [again]  injectable for tests
 * @returns {Promise<RosterGeometry>}
 */
async function settledGeometry(early, promise, again = awaitGeometryWithin) {
    if (early && early.reason === 'wait-timeout') return again(promise);
    return /** @type {any} */ (early);
}

module.exports = {
    settledGeometry,
    GEOMETRY_WAIT_BUDGET_MS,
    GEOMETRY_WORK_BUDGET_MS,
    awaitGeometryWithin,
    GRID_COLUMNS,
    rulesFromOperatorList,
    assignRunsToGrid,
    extractRosterGeometry,
    matchGeometryRow,
    geometryCoverage,
    applyGeometryWitness,
    // exposed for the tests that pin the vocabulary
    _isClaim: isClaim,
    _nameTokens: nameTokens,
    // …and the path codes, which the real-pdfjs test holds to the installed library
    _PATH_OP: PATH_OP,
};
