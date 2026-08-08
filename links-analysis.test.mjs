// Tests for links-analysis.js — the read-only analysis panels (Coverage heat map + Design checks)
// extracted from links-app.js. Fake DOM, no module mocks → runs in `npm run test:hygiene`.
// The pure maths is covered by links-design.test.mjs; here we prove the RENDER + the getDesign seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROTATING_LINES } from './links-design.js';

// Minimal DOM: getElementById returns a per-id stub element with { innerHTML, style }.
const els = /** @type {Record<string, any>} */ ({});
const el = () => ({ innerHTML: '', style: {} });
function resetDom() { for (const id of ['coverageHeatmap', 'coverageEmptyMsg', 'checksContent']) els[id] = el(); }
resetDom();
global.document = /** @type {any} */ ({ getElementById: (/** @type {string} */ id) => els[id] || null });

const { initLinksAnalysis } = await import('./links-analysis.js');

/**
 * A fully-designed rotation (every line worked Mon–Fri, rest Sat/Sun).
 *
 * Sized from ROTATING_LINES, not a literal. The panel reads the same constant, so a fixture with
 * its own number would drift the moment the rotation changed — and it would drift QUIETLY in the
 * safe direction: a 28-line fixture against a 22-line panel still reports "all lines designed",
 * because 22 of the 28 are filled. It read 28 against 22 for exactly one release (v19.98).
 */
function fullPatterns() {
    const p = /** @type {Record<string, any>} */ ({});
    for (let i = 1; i <= ROTATING_LINES; i++) {
        p[String(i)] = { sun: 'RD', mon: '06:00-14:00', tue: '06:00-14:00', wed: '06:00-14:00', thu: '06:00-14:00', fri: '06:00-14:00', sat: 'RD' };
    }
    return p;
}

test('empty state (getDesign → null) shows the empty messages and hides the heatmap', () => {
    resetDom();
    const a = initLinksAnalysis({ getDesign: () => null });
    a.renderCoverageChart();
    assert.equal(els.coverageHeatmap.style.display, 'none');
    assert.equal(els.coverageEmptyMsg.style.display, '');   // shown
    a.renderDesignChecks();
    // Asserted on the STRUCTURE, not the sentence (v19.66). Pinning the copy made a wording change
    // fail a test whose subject is "does the empty branch render at all" — and `links-empty-panel`
    // is the load-bearing part anyway: it is what the stylesheet and the class-exists guard key on,
    // so a render that lost it would be the actual regression.
    assert.match(els.checksContent.innerHTML, /class="links-empty-panel"/);
});

test('designed state renders the coverage heat map + the checks panel', () => {
    resetDom();
    const design = { patterns: fullPatterns() };
    const a = initLinksAnalysis({ getDesign: () => design });

    a.renderCoverageChart();
    assert.equal(els.coverageHeatmap.style.display, '');       // visible
    assert.equal(els.coverageEmptyMsg.style.display, 'none');
    assert.match(els.coverageHeatmap.innerHTML, /cov-heat/);   // the table rendered
    assert.match(els.coverageHeatmap.innerHTML, /Peak this week/);

    a.renderDesignChecks();
    assert.match(els.checksContent.innerHTML, /check-rows/);
    assert.match(els.checksContent.innerHTML, /All lines designed/); // every line filled
    assert.match(els.checksContent.innerHTML, /Shift balance/);
});

test('the panel states that its hours figures are a FLOOR', () => {
    // `assessFatigue` has returned `hoursAreFloor` since v19.46 with a comment saying it exists "so
    // the UI can say so" — and for thirteen versions the UI did not. It matters more since v19.58
    // made spare a whole WEEK: a spare line carries no times, so it contributes seven worked days
    // and ZERO hours, and every hours figure understates by a standby week per spare line.
    // Under-reporting hours is the FLATTERING direction, which is the one thing this panel exists
    // not to do quietly.
    resetDom();
    const a = initLinksAnalysis({ getDesign: () => ({ patterns: fullPatterns() }) });
    a.renderDesignChecks();
    assert.match(els.checksContent.innerHTML, /floor, not an estimate/);
});

test('getDesign is read lazily — a later design change is reflected on the next render', () => {
    resetDom();
    let current = /** @type {any} */ (null);
    const a = initLinksAnalysis({ getDesign: () => current });

    a.renderDesignChecks();
    assert.match(els.checksContent.innerHTML, /class="links-empty-panel"/);   // null → empty panel
    current = { patterns: fullPatterns() };
    a.renderDesignChecks();
    assert.match(els.checksContent.innerHTML, /All lines designed/);   // now designed
});

test('an unfilled (all-rest) line is reported by the checks panel', () => {
    resetDom();
    const patterns = fullPatterns();
    patterns['7'] = { sun: 'RD', mon: 'RD', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
    const a = initLinksAnalysis({ getDesign: () => ({ patterns }) });
    a.renderDesignChecks();
    assert.match(els.checksContent.innerHTML, /Lines not yet designed/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Every row class this panel emits must actually EXIST in links.css (v19.48).
//
// This is the one static guard worth having here, because the failure it catches is silent in
// exactly the way the repo keeps re-learning: v19.46 shipped ~15 rows carrying `check-info`, a class
// no stylesheet defines. Nothing threw, every behavioural test passed (they assert text), and the
// rows simply rendered with no surface at all while every neighbour had one — visible only to
// someone looking at the page, or to computed styles.
//
// A pixel baseline would also catch it, but a class-name typo is a STRING problem and this checks
// the string directly: cheap, deterministic, and immune to the rendering-environment sensitivity
// that keeps the visual suite opt-in.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';

/**
 * The class-name families this panel is allowed to emit. A PREFIX list, not a class list — and it is
 * the second test below that keeps it honest, by failing when the module starts emitting a family
 * that is not named here.
 *
 * The v19.49 pass made the scan generic within `check-*` for exactly the right reason: an enumerated
 * list stops covering whatever arrives next. v19.56 then added the demand rows under `dem-*` and
 * `cov-demand`, and the guard — generic within its one prefix — did not see a single one of them.
 * Same failure mode, one level up. So the prefix set is checked too.
 */
const CLASS_PREFIXES = ['check-', 'dem-', 'cov-', 'heat-', 'links-', 'sum-', 'btn-'];

/** Sentinel for a `${…}` interpolation, so a token that touches one is recognisably incomplete. */
// Written as an ESCAPE, not a literal NUL byte: a literal one makes this file `binary` to
// git, so its diffs render as "Bin 11394 -> 16766 bytes" and the file cannot be reviewed at
// all. Same value at runtime (found during the v19.97 regression pass; it predates it).
const DYN = '\u0000';

/** Every class-shaped token `links-analysis.js` can put on an element. */
function emittedClasses(js) {
    /** @type {Set<string>} */
    const clean = new Set();     // whole tokens straight out of a class attribute
    /** @type {Set<string>} */
    const all = new Set();       // those plus ones assembled inside an interpolation

    for (const m of js.matchAll(/class="([^"]*)"/g)) {
        const masked = m[1].replace(/\$\{[^}]*\}/g, DYN);
        for (const c of masked.split(/\s+/)) {
            if (!c) continue;
            if (c.includes(DYN)) continue;     // `heat-b${bucket}` — a stem, not a class
            clean.add(c);
        }
    }
    // Classes built inside an interpolation (`${shut ? ' dem-shut' : ''}`, the status→class map).
    // A string literal made only of class-shaped words; prose is excluded by the prefix filter, not
    // by trying to recognise English.
    for (const m of js.matchAll(/'(\s*[a-z][\w-]*(?:\s+[a-z][\w-]*)*\s*)'/g)) {
        for (const c of m[1].trim().split(/\s+/)) if (c) all.add(c);
    }
    for (const c of clean) all.add(c);
    return { clean, all };
}

test('every class the panel emits is defined in links.css', () => {
    const js  = readFileSync(new URL('./links-analysis.js', import.meta.url), 'utf8');
    const css = readFileSync(new URL('./links.css', import.meta.url), 'utf8');

    const used = new Set(
        [...emittedClasses(js).all].filter(c => CLASS_PREFIXES.some(p => c.startsWith(p))),
    );

    assert.ok(used.size >= 12, `expected to find the row classes, found ${used.size}: ${[...used]}`);
    for (const expected of ['check-code', 'check-family', 'check-section-meta', 'dem-shut', 'cov-demand',
        'check-quiet', 'sum-chip', 'btn-text-link']) {
        assert.ok(used.has(expected), `the scan must reach ${expected}`);
    }
    assert.ok(used.has('check-neutral'), 'the neutral/info surface must be among them');

    // `(?![\w-])`, NOT `\b`. A hyphen is a word boundary, so `\.check-info\b` happily matches inside
    // `.check-info-icon` — which is precisely the pair in this stylesheet, so the first version of
    // this guard passed against the exact bug it was written for. A class name only ends where a
    // character that cannot be part of one begins.
    const missing = [...used].filter(c => !new RegExp(`\\.${c}(?![\\w-])`).test(css));
    assert.deepEqual(missing, [], `class(es) emitted by links-analysis.js with no rule in links.css: ${missing.join(', ')}`);
});

test('the panel emits no class family the guard above does not police', () => {
    // Without this, the check above is only as complete as CLASS_PREFIXES — and a hand-maintained
    // list quietly stops covering what arrives after it, which is the whole failure this pair of
    // tests exists to prevent. A new family must be a loud failure here, not an invisible gap there.
    const js = readFileSync(new URL('./links-analysis.js', import.meta.url), 'utf8');
    const stray = [...emittedClasses(js).clean]
        .filter(c => !CLASS_PREFIXES.some(p => c.startsWith(p)));
    assert.deepEqual(stray, [], `class family not covered by CLASS_PREFIXES: ${stray.join(', ')}`);
});

// The rollup depends on links-analysis.js's NIGHT_FAMILY matching the `family` string
// links-fatigue.js stamps. A mismatch fails SILENTLY — the rollup simply stops matching and seven
// near-identical rows print instead — so it is asserted behaviourally rather than by comparing two
// string literals (v19.52).
test('the night-shift factors roll up to one row, and lose the rollup when a night appears', () => {
    const nightless = fullPatterns();
    resetDom();
    initLinksAnalysis({ getDesign: () => ({ patterns: nightless }) }).renderDesignChecks();
    const html = els.checksContent.innerHTML;
    assert.match(html, /Night-shift factors do not apply/, 'the rollup row must render');
    assert.equal((html.match(/FF6/g) || []).length, 1, 'FF6 appears once — in the rollup, not as its own row');
    assert.doesNotMatch(html, /not applicable<\/div>/i, 'no heading may assert a verdict');

    // Give one line a night duty: the rollup must disappear and the factors report individually.
    const withNight = JSON.parse(JSON.stringify(nightless));
    withNight['1'].mon = '22:00-06:00';
    resetDom();
    initLinksAnalysis({ getDesign: () => ({ patterns: withNight }) }).renderDesignChecks();
    const html2 = els.checksContent.innerHTML;
    assert.doesNotMatch(html2, /Night-shift factors do not apply/, 'a night duty must end the rollup');
    assert.ok((html2.match(/FF6/g) || []).length >= 1, 'FF6 must still be reported');
    assert.doesNotMatch(html2, /Night \(not applicable\)/, 'the heading must not claim not-applicable over present rows');
});

// ── THE HARD-LIMIT HEADING IS ITS OWN CLAIM, AND NOTHING TIED IT TO THE MODULE (v19.96) ─────────
// `links-limits.js` returns the row's `basis`; this file writes the SECTION HEADING as a separate
// hardcoded string. So the two can say different things, and from v19.90 to v19.95 they did — the
// heading read "Industry limits · Hidden report — must be met" while the module's own tests were
// busy pinning the basis. The heading is the more prominent of the two and makes the stronger
// claim, and it had no test at all.
//
// The Hidden working-hours limits were carried by a group standard withdrawn in 2007; the ORR now
// expects a risk-based fatigue management system. So this heading may say the limit must be met —
// it is Chiltern's policy — but it may not say the industry currently requires it.
test('the hard-limit section heading names a company limit, not a current industry one', () => {
    resetDom();
    initLinksAnalysis({ getDesign: () => ({ patterns: fullPatterns() }) }).renderDesignChecks();
    const html = els.checksContent.innerHTML;

    const head = html.match(/<div class="check-section-head"><span>([^<]*)<span class="check-note">([^<]*)</);
    assert.ok(head, 'the hard-limit section heading did not render');
    const [, title, note] = head;
    assert.match(`${title} ${note}`, /must be met/i,
        'the first section is expected to be the hard limits — has the panel been reordered?');

    assert.doesNotMatch(`${title} ${note}`, /\bindustry\b/i,
        `the heading claims the limit is industry-wide: "${title}${note}". It is Chiltern's policy; ` +
        'the standard the number came from was withdrawn in 2007');
    assert.match(`${title} ${note}`, /chiltern|company|policy/i,
        `the heading states a hard limit without saying whose it is: "${title}${note}"`);

    // …and it must still assert the limit. The correction is about WHOSE rule it is, never its
    // strength — a reclassification that quietly downgraded it to advice would be the opposite
    // failure, and this panel's whole structure depends on the hard half not reading like the
    // advisory half below it.
    assert.match(`${title} ${note}`, /must be met/i, 'the hard-limit heading must still state that it is a limit');
});

// ── RECOMMENDATION 5: ANYTHING RENDERED AS "MUST BE MET" CARRIES EVIDENCE (v19.96) ──────────────
// The external review's own wording: *anything rendered to managers as "must be met" must have a
// current identifiable source, not merely a numeric test*. `links-limits.test.mjs` enforces that on
// the checks `assessHardLimits` returns — but the assertion is made on the PAGE, by a heading this
// file writes as a hardcoded string, and today there is exactly one such section.
//
// So the rule is applied to whatever the panel renders rather than to the one section that exists:
// EVERY heading claiming a limit must be met has to sit above rows that name where the limit comes
// from. A second compliance section added later — the plan already has three more candidates
// waiting (max turn length, minimum rest, the weekly ceiling; see .claude/rules/links-design.md) —
// then cannot arrive as an unsourced assertion in red.
//
// It is deliberately NOT keyed on the string "Company limits": a section that renamed itself would
// slip a hardcoded-list check while making exactly the same claim.
test('every section claiming "must be met" carries a source on its rows', () => {
    resetDom();
    initLinksAnalysis({ getDesign: () => ({ patterns: fullPatterns() }) }).renderDesignChecks();
    const html = els.checksContent.innerHTML;

    // Split the panel into sections at each heading, so each claim is judged against its OWN rows.
    const parts = html.split(/<div class="check-section-head">/).slice(1);
    assert.ok(parts.length >= 2, `expected at least the two sections, found ${parts.length}`);

    let asserted = 0;
    for (const part of parts) {
        const head = part.slice(0, part.indexOf('</div>'));
        if (!/must be met|cannot be run|required|mandatory/i.test(head)) continue;
        asserted++;

        // The heading says whose requirement it is…
        assert.match(head, /chiltern|company|policy|agreement|regulation/i,
            `a section claims "must be met" without saying whose requirement it is: ${head}`);

        // …and every row under it names a source. `.check-note` is where `basis` renders; a row
        // asserting a limit with no note beside it is a bare number in red on a manager's sheet.
        const rows = part.split('<div class="check-row').slice(1);
        assert.ok(rows.length, 'a compliance section rendered no rows at all');
        for (const row of rows) {
            assert.match(row, /class="check-note"/,
                `a row in a "must be met" section carries no source: ${row.slice(0, 160)}`);
            const note = row.match(/class="check-note">([^<]*)</);
            assert.ok(note && note[1].trim().length >= 10,
                `a row's source is too short to identify anything: "${note?.[1] ?? ''}"`);
        }
    }
    assert.equal(asserted, 1,
        `expected exactly one compliance section today, found ${asserted} — if a second has been ` +
        'added, confirm it is sourced and update this count deliberately');
});
