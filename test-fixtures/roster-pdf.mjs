/**
 * test-fixtures/roster-pdf.mjs — a real, openable roster PDF, built by hand.
 *
 * ── WHY THIS IS SHARED RATHER THAN COPIED (v24.15) ──────────────────────────────────────────────
 *
 * `roster-geometry.test.mjs` built this document inline and drove the real `pdfjs-dist` parser at
 * it, which proved the GEOMETRY ADAPTER reads a drawn grid correctly. `index-endpoints.test.mjs`
 * drove the `parseRosterPDF` HANDLER, with `buildCellTable` stubbed, which proved the COORDINATOR
 * behaves once a grid is usable.
 *
 * Neither proved the two agree. A stub returning a shape the real extractor never produces leaves
 * both suites green and the wiring broken — which is precisely the defect v24.12 shipped: phase 2
 * geometry was present, and the coordinator rejected every document it placed, because it still
 * demanded `columnHeaders` the cell prompt does not ask for. The architecture was ahead of the
 * wiring, and nothing could see the gap. An external reviewer asked for the joining test by name.
 *
 * So the fixture moved here, and both suites import it. A SECOND hand-built PDF would have been
 * the same mistake in a new place: two fixtures drift, and the one the handler uses would slowly
 * stop resembling the one the adapter is proven against.
 *
 * ── WHAT THE GEOMETRY MEANS ─────────────────────────────────────────────────────────────────────
 *
 * The x positions are MEASURED, not invented — `experiments/roster-pdf-geometry/` found the same
 * nine vertical rules on every content page of every roster type and week-ending in the corpus.
 * Rules are stroked (`x y m x y l S`), text is `BT /F1 9 Tf x y Td (…) Tj ET`, and the xref offsets
 * are computed. Any mistake in those offsets and pdfjs rejects the file outright — which is the
 * point: this is a document a real parser opens, not a mock that agrees with us.
 *
 * Nothing here is app code and nothing imports it at runtime. It requires nothing.
 */

/** The measured grid: nine x positions bounding a name column and seven day columns. */
export const VX = [25.3, 154.8, 250.3, 347.0, 442.3, 537.5, 633.5, 729.5, 822.5];

/** x just inside each DAY column (index 0 = Sunday). */
export const COL_X = VX.slice(1, 8).map(v => v + 40);

/** x of the member-name column. */
export const NAME_X = 28.2;

/** The Sunday→Saturday dates the fixture's week stands for. */
export const DATES = ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'];

/**
 * The roster both the geometry suite and the handler suite read — the same document either way.
 *
 * Deliberate properties, each one a case the pipeline has to survive:
 *   · G. Miller's SUNDAY is physically EMPTY — the blank-cell contract, and the exact cell whose
 *     visual collapse used to shift a whole row onto the wrong days.
 *   · S. Silva works all seven, so a shifted claim would land in no empty cell and the phase-1
 *     witness alone could not refuse it. That is why phase 2 exists.
 *   · `Vacant` is a row with a name and no cells; the print-date line is page furniture. Both must
 *     survive extraction without becoming a member.
 */
export const ROSTER_FIXTURE = [
    ['Sunday', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    ['G. Miller', '', 'RD', '06:20-14:20', '06:20-14:20', 'RD', '07:00-16:00', '07:00-15:00'],
    ['S. Silva', '08:00-16:00', 'RD', 'RD', '08:00-16:00', '08:00-16:00', '08:00-16:00', '08:00-16:00'],
    ['Vacant', '', '', '', '', '', '', ''],
    ['Print Date: 27/08/2026', '', '09:52', 'Page 1 of 2', '', '', '', ''],
];

/**
 * One page's content-stream lines: the drawn rules, the row bands, and rows of
 * `[name, cell0..cell6]`. An empty string leaves that cell PHYSICALLY empty — no text run at all,
 * which is the only way to exercise occupancy.
 * @param {string[][]} rowSpecs
 * @param {{ top?: number, rowH?: number, vx?: number[] }} [opts]
 */
export function rosterPage(rowSpecs, { top = 700, rowH = 50, vx = VX } = {}) {
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

/**
 * Write a PDF 1.4 file from one or more pages of content-stream lines, xref offsets and all.
 * @param {string[][]} pages
 * @returns {Buffer}
 */
export function buildPdf(pages) {
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

/** The whole fixture as a single-page PDF buffer — the common case both suites want. */
export function rosterPdfBuffer() {
    return buildPdf([rosterPage(ROSTER_FIXTURE)]);
}
