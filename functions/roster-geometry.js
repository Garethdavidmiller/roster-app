/**
 * roster-geometry.js — what the roster PDF's OWN GRID says about where each cell is, and the one
 * refusal that follows from it.
 *
 * CommonJS, like every file under functions/. Tested by roster-geometry.test.mjs (test:functions).
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
 * that read it now would be the model's job done twice with two sets of failure modes.
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
 * pdfjs is PINNED to v4: this file reads `OPS.constructPath`'s argument shape directly, and pdfjs 6
 * changed that encoding — every document then fails identically with `fns is not iterable`, which
 * looks exactly like a PDF problem. If the dependency is ever bumped, `rulesFromOperatorList` is
 * the function to rewrite first.
 */

'use strict';

const { BLANK_CELL_TOKEN, reviewLabel } = require('./roster-parse-helpers');

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Nine vertical rules: NAME + seven days. Anything else is not the roster grid. */
const GRID_COLUMNS = 9;

/** Row names that are the table's own furniture, never a member. */
const FURNITURE_NAME = /^(Sunday|Weekly|MARYLEBONE|Marylebone|Week|Print Date)/i;
/** The one cell content that marks the print footer wherever its name landed. */
const FOOTER_CELL = /\bPage\s+\d+\s+of\s+\d+\b/i;

// ── 1. The drawn rules ──────────────────────────────────────────────────────────────────────────

/**
 * Every vertical and horizontal rule actually STROKED on the page, clustered to the nearest 2px.
 *
 * They are `moveTo`/`lineTo` segments, not rectangles — the first version of the experiment looked
 * only for rectangles and reported zero rules on every page, a confident wrong answer.
 *
 * @param {{ fnArray: number[], argsArray: any[] }} ops   a pdfjs operator list
 * @param {Record<string, number>} OPS                     pdfjs's OPS enum
 * @returns {{ vx: number[], hy: number[] }}               ascending x positions, ascending y positions
 */
function rulesFromOperatorList(ops, OPS) {
    const vx = new Set(), hy = new Set();
    for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] !== OPS.constructPath) continue;
        const [fns, args] = ops.argsArray[i];
        if (!fns || typeof fns[Symbol.iterator] !== 'function') continue;
        let a = 0, cx = 0, cy = 0, sx = 0, sy = 0;
        for (const fn of fns) {
            if (fn === OPS.moveTo)      { cx = args[a]; cy = args[a + 1]; sx = cx; sy = cy; a += 2; }
            else if (fn === OPS.lineTo) {
                const nx = args[a], ny = args[a + 1]; a += 2;
                if (Math.abs(nx - cx) < 0.6 && Math.abs(ny - cy) > 3) vx.add(+((nx + cx) / 2).toFixed(1));
                if (Math.abs(ny - cy) < 0.6 && Math.abs(nx - cx) > 3) hy.add(+((ny + cy) / 2).toFixed(1));
                cx = nx; cy = ny;
            }
            else if (fn === OPS.curveTo)   { a += 6; }
            else if (fn === OPS.rectangle) { a += 4; }
            else if (fn === OPS.closePath) { cx = sx; cy = sy; }
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

/** @typedef {{ available: boolean, reason?: string, rows: Array<{ name: string, cells: string[], occupancy: boolean[] }>, pagesRead: number, pagesRejected: number }} RosterGeometry */

/**
 * Read the roster PDF's grid. NEVER THROWS — every failure is a `RosterGeometry` with
 * `available: false` (nothing usable) or with fewer pages, so the import proceeds as it did before
 * this witness existed.
 *
 * @param {Buffer|Uint8Array} pdfBytes
 * @param {{ loadPdfjs?: () => Promise<any> }} [deps]   injectable for tests; default imports pdfjs-dist v4
 * @returns {Promise<RosterGeometry>}
 */
async function extractRosterGeometry(pdfBytes, { loadPdfjs, workBudgetMs = GEOMETRY_WORK_BUDGET_MS, now = Date.now } = {}) {
    /** @type {RosterGeometry} */
    const result = { available: false, rows: [], pagesRead: 0, pagesRejected: 0 };
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
        // isEvalSupported:false — a PDF's font programs must never reach `eval`, whatever pdfjs's
        // own patch state. Text and geometry need no font execution.
        task = pdfjs.getDocument({ data, useSystemFonts: true, verbosity: 0, isEvalSupported: false });
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
                const { vx, hy } = rulesFromOperatorList(await page.getOperatorList(), pdfjs.OPS);
                const rows = assignRunsToGrid({
                    items: tc.items.map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5] })),
                    vx, hy,
                });
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
    if (!result.available && !result.reason) result.reason = result.pagesRejected ? 'no-grid' : 'no-text';
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
 * @param {string} memberName
 * @param {Array<{ name: string, occupancy: boolean[] }>} rows
 * @returns {{ name: string, occupancy: boolean[] }|null}
 */
function matchGeometryRow(memberName, rows) {
    const want = nameTokens(memberName);
    if (!want.length) return null;
    const exact = rows.filter(r => nameTokens(r.name).join(' ') === want.join(' '));
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;
    const surname = want.reduce((a, b) => (b.length > a.length ? b : a), '');
    const initials = want.filter(t => t !== surname).map(t => t[0]);
    const loose = rows.filter(r => {
        const t = nameTokens(r.name);
        if (!t.includes(surname)) return false;
        const rest = t.filter(x => x !== surname).map(x => x[0]);
        return initials.every(i => rest.includes(i));
    });
    return loose.length === 1 ? loose[0] : null;
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
 *             checked: number, total: number, unmatched: string[] }}
 */
function applyGeometryWitness(safeEntries, geometry, dates) {
    const stats = { status: /** @type {'complete'|'partial'|'unavailable'} */ ('unavailable'),
        refused: /** @type {Array<{ memberName: string, dates: string[] }>} */ ([]),
        checked: 0, total: safeEntries.length, unmatched: /** @type {string[]} */ ([]) };
    if (!geometry || !geometry.available || !Array.isArray(geometry.rows) || !geometry.rows.length) return stats;
    if (!Array.isArray(dates) || dates.length < 7) return stats;

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
 * How long the caller will WAIT for the witness once the model has answered — and the reason the
 * budget is on the wait rather than on the work.
 *
 * The extraction starts before the model call and is awaited after it, so it normally runs for
 * free inside the model's own latency and costs the request nothing. What the reviewer's concern
 * is actually about (v22.39) is the tail: a pathological PDF where pdfjs never settles would hold
 * a finished parse until the Cloud Function's own 120s timeout — an OPTIONAL check extending the
 * critical path without bound, which contradicts the whole fail-open contract.
 *
 * **Stopping the wait is not stopping the work**, exactly as `fetch-timeout.js` says on the client
 * side. The extraction keeps running in the instance until it finishes or the instance goes; that
 * costs nothing on the request, and the witness has no side effects to leave half-done. The
 * `workBudgetMs` between-pages check above is the other half — it bounds the CPU, this bounds the
 * wait, and the two answer different questions.
 */
const GEOMETRY_WAIT_BUDGET_MS = 8000;

/** The absolute cap on the extraction itself, checked between pages. Generous: the whole point is
 *  that it normally runs concurrently with the model, and the corpus reads 12 documents in well
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

module.exports = {
    GEOMETRY_WAIT_BUDGET_MS,
    GEOMETRY_WORK_BUDGET_MS,
    awaitGeometryWithin,
    GRID_COLUMNS,
    rulesFromOperatorList,
    assignRunsToGrid,
    extractRosterGeometry,
    matchGeometryRow,
    applyGeometryWitness,
    // exposed for the tests that pin the vocabulary
    _isClaim: isClaim,
    _nameTokens: nameTokens,
};
