// Tests for links-analysis.js — the read-only analysis panels (Coverage heat map + Design checks)
// extracted from links-app.js. Fake DOM, no module mocks → runs in `npm run test:hygiene`.
// The pure maths is covered by links-design.test.mjs; here we prove the RENDER + the getDesign seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROTATING_LINES } from './links-design.js';
import { POLICY_SOURCE_CONFIRMED } from './links-limits.js';
import { assessFatigue } from './links-fatigue.js';

// Minimal DOM: getElementById returns a per-id stub element with { innerHTML, style }.
const els = /** @type {Record<string, any>} */ ({});
const el = () => ({ innerHTML: '', style: {} });
function resetDom() { for (const id of ['coverageHeatmap', 'coverageEmptyMsg', 'checksContent', 'linksSummary']) els[id] = el(); }
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

/**
 * A design whose longest worked run sits BETWEEN the owner's design target (7) and Chiltern's
 * company limit (13) — the band where the panel reports the same figure amber in one section and
 * green in the other. Nine consecutive worked days, then two rest days.
 *
 * The run is measured across the rotation's wrap, so this only needs one continuous block: line 1
 * Mon–Sat plus line 2 Sun–Tue is nine, with Wed/Thu rest to close it.
 */
function longRunPatterns() {
    const p = fullPatterns();
    const W = '06:00-14:00';
    p['1'] = { sun: 'RD',  mon: W, tue: W, wed: W, thu: W, fri: W, sat: W };
    p['2'] = { sun: W,     mon: W, tue: W, wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
    for (let i = 3; i <= ROTATING_LINES; i++) {
        p[String(i)] = { sun: 'RD', mon: W, tue: W, wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
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

    // SELECTED BY ITS `data-claim`, NOT BY ITS POSITION AND NOT BY ITS WORDING (v20.08). It was
    // position until v20.04 (broke the moment a section was added above), then the phrase "must be
    // met" — which stopped existing at v20.08 when that phrase turned out to be the finding. Both
    // anchors shared a fault: they were the thing under test. The renderer now DECLARES which
    // section asserts a limit, so this test can police what it says without depending on it.
    const heads = [...html.matchAll(/<div class="check-section-head"([^>]*)><span>([^<]*)<span class="check-note">([^<]*)</g)]
        .map(m => ({ attrs: m[1], title: m[2], note: m[3] }));
    assert.ok(heads.length, 'no section headings rendered at all');
    const head = heads.find(h => /data-claim="limit"/.test(h.attrs));
    // Fails LOUD rather than vacuously: a panel that stopped asserting a hard limit anywhere would
    // otherwise make every assertion below unreachable and this test silently meaningless.
    assert.ok(head, `no section declares data-claim="limit" — the hard-limit section is the point ` +
        `of this test, so its absence is a failure, not a pass. Headings found: ` +
        heads.map(h => `"${h.title}${h.note}"`).join(', '));
    const { title, note } = head;

    assert.doesNotMatch(`${title} ${note}`, /\bindustry\b/i,
        `the heading claims the limit is industry-wide: "${title}${note}". It is Chiltern's policy; ` +
        'the standard the number came from was withdrawn in 2007');
    assert.match(`${title} ${note}`, /chiltern|company|policy/i,
        `the heading states a hard limit without saying whose it is: "${title}${note}"`);
});

// ── THE CLAIM MAY ONLY BE AS STRONG AS THE EVIDENCE, IN BOTH DIRECTIONS (v20.08, review P1) ──────
// ROADMAP.md's gate: anything rendered to a manager as *must be met* needs class A or B evidence.
// This limit has class C — the owner's account of Chiltern practice — and the panel said "must be
// met" anyway, over a row printing "It cannot be run as drawn." in red. The app was breaking its own
// rule in the loudest place it has.
//
// The wording is now derived from `POLICY_SOURCE_CONFIRMED`, and this test reads the SAME flag, so
// it fails in BOTH directions and that is the point of it existing at all:
//
//   flag false, heading says "must be met"     → the v20.07 violation, back again
//   flag true,  heading still hedges           → the citation arrived and the sheet never said so
//
// A test that only checked the current wording would have to be edited on the day the citation
// lands, which is precisely the edit that has been forgotten four times in this file's history.
test('the strength of the limit claim matches whether its source is confirmed', () => {
    resetDom();
    initLinksAnalysis({ getDesign: () => ({ patterns: fullPatterns() }) }).renderDesignChecks();
    const html = els.checksContent.innerHTML;
    const section = html.split(/<div class="check-section-head"[^>]*data-claim="limit"/)[1];
    assert.ok(section, 'the limit section did not render');
    const head = section.slice(0, section.indexOf('</div>'));

    if (POLICY_SOURCE_CONFIRMED) {
        assert.match(head, /must be met/i,
            'the policy source is confirmed, so the sheet must say the limit has to be met: ' + head);
        assert.doesNotMatch(head, /outstanding|unconfirmed|to be confirmed/i,
            'the source is confirmed but the heading still hedges: ' + head);
    } else {
        assert.doesNotMatch(head, /must be met|mandatory|cannot be run/i,
            `the heading asserts the limit must be met, but POLICY_SOURCE_CONFIRMED is false — the ` +
            `evidence is the owner's account of practice (class C), and ROADMAP.md requires A or B ` +
            `for that phrase: ${head}`);
        assert.match(head, /outstanding|unconfirmed|not confirmed|to be confirmed/i,
            `the heading neither claims nor disclaims: with the source unconfirmed it must say so, ` +
            `or a reader takes a bare "Company limits" as settled: ${head}`);
    }
});

// The same rule applied to the PROSE, which is what actually gets read on the printed sheet. The
// heading and the row build separate strings in separate files, which is how "Chiltern company
// limit" once ended up in three places and stale in one.
test('no row states a consequence the evidence does not support', () => {
    for (const [label, patterns] of [['a clean design', fullPatterns()], ['a design over the limit', longRunPatterns()]]) {
        resetDom();
        initLinksAnalysis({ getDesign: () => ({ patterns }) }).renderDesignChecks();
        const text = els.checksContent.innerHTML.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
        if (POLICY_SOURCE_CONFIRMED) continue;
        assert.doesNotMatch(text, /cannot be run|must not be run|is not permitted/i,
            `${label}: the panel states the design cannot be run, on a limit whose policy source is ` +
            'not confirmed. Report the measurement and what to check, not the verdict.');
    }
});

// ── A PARTIAL HOURS FIGURE MUST NOT WEAR THE TICK (v20.08, external review P2) ──────────────────
// A line whose worked cells are all unreadable leaves the average arithmetically untouched — see
// links-design.test.mjs for why that is the worst shape this figure can fail in. The maths now
// reports it as `complete: false`; this is the half that matters to a reader, because a green tick
// beside "35h 00m" is what a designer actually takes away from the panel. Both places the figure
// appears are checked: the row, and the summary chip in the sticky save bar — which is the copy most
// edits ever see, and would otherwise have gone on saying ✓ while the row below it said "partial".
test('an unmeasurable working line downgrades the hours figure in BOTH places it appears', () => {
    const good = { sun: 'RD', mon: '09:00-16:00', tue: '09:00-16:00', wed: '09:00-16:00',
        thu: '09:00-16:00', fri: '09:00-16:00', sat: 'RD' };
    const opaque = { sun: 'RD', mon: 'gibberish', tue: 'gibberish', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
    const withOpaque = /** @type {Record<string, any>} */ ({});
    for (let i = 1; i <= ROTATING_LINES; i++) withOpaque[String(i)] = i === ROTATING_LINES ? opaque : good;

    // The premise, asserted rather than assumed: the readable lines land exactly on contract, so
    // without the `complete` gate this design earns a genuine green tick.
    const clean = /** @type {Record<string, any>} */ ({});
    for (let i = 1; i <= ROTATING_LINES; i++) clean[String(i)] = good;
    resetDom();
    const api = initLinksAnalysis({ getDesign: () => ({ patterns: clean }) });
    api.renderDesignChecks();
    assert.match(els.checksContent.innerHTML, /Hours a week/, 'the hours row did not render');
    const cleanRow = els.checksContent.innerHTML.split('Hours a week')[0];
    assert.match(cleanRow.slice(-260), /check-good/, 'premise: the clean design really does tick');

    resetDom();
    initLinksAnalysis({ getDesign: () => ({ patterns: withOpaque }) }).renderDesignChecks();
    const html = els.checksContent.innerHTML;
    const before = html.split('Hours a week')[0].slice(-260);
    assert.doesNotMatch(before, /check-good/,
        'a design with a whole unmeasured line still ticks "Hours a week" — the average was computed ' +
        'over fewer lines than the design has, and the tick was earned by the lines it could read');
    assert.match(html, /partial/i, 'the row does not say the figure is partial');
    assert.match(html, /whole line/i, 'the row does not say a whole line went unmeasured');

    // …and the chip in the sticky save bar, rendered by a separate code path into its own element.
    // `renderSummary` returns void, so reading a return value here would skip this half silently —
    // the vacuous-guard failure. It is read out of the element, and the clean case is asserted first
    // so a strip that stopped rendering the chip at all cannot pass as "not on-target".
    for (const [label, patterns, expectOk] of /** @type {[string, any, boolean][]} */ ([
        ['the clean design', clean, true],
        ['the design with an unmeasured line', withOpaque, false],
    ])) {
        resetDom();
        initLinksAnalysis({ getDesign: () => ({ patterns }) }).renderSummary();
        const strip = els.linksSummary.innerHTML;
        const idx = strip.indexOf('a week');
        assert.ok(idx > 0, `${label}: the hours chip did not render in the summary strip`);
        const chipHtml = strip.slice(0, idx);
        assert.equal(/sum-chip--ok(?![\w-])/.test(chipHtml.slice(chipHtml.lastIndexOf('<span class="sum-chip'))), expectOk,
            `${label}: the summary chip's on-target state is wrong — it is the copy most edits ever ` +
            'see, so a partial average wearing ✓ here outlives the row that says "partial"');
    }
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
// slip a hardcoded-list check while making exactly the same claim. Since v20.08 the trigger is the
// renderer's own `data-claim="limit"` marker OR any of the assertion phrases — either is enough, so
// a section that asserts a limit without declaring itself is still caught.
test('every section asserting a limit carries a source on its rows', () => {
    resetDom();
    initLinksAnalysis({ getDesign: () => ({ patterns: fullPatterns() }) }).renderDesignChecks();
    const html = els.checksContent.innerHTML;

    // Split the panel into sections at each heading, so each claim is judged against its OWN rows.
    const parts = html.split(/<div class="check-section-head"/).slice(1);
    assert.ok(parts.length >= 2, `expected at least the two sections, found ${parts.length}`);

    let asserted = 0;
    for (const part of parts) {
        const head = part.slice(0, part.indexOf('</div>'));
        if (!/data-claim="limit"|must be met|cannot be run|required|mandatory/i.test(head)) continue;
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

// ── THE CITATION RULE APPLIES TO THE WHOLE PANEL, NOT ONE SECTION (v20.00) ──────────────────────
// The v19.96 review corrected "Hidden report — must be met" in two places: the `basis` strings in
// `links-limits.js` and this file's section heading. It missed a THIRD — a `.check-sub` on the
// "Longest run" row, in this very file, reading *"The Hidden limit is 13."*
//
// Neither existing guard could see it, and for a reason worth stating rather than patching around:
// both were scoped to where the claim was LAST found. `links-limits.test.mjs` reads the objects
// `assessHardLimits` returns; the test above walks sections whose heading claims something must be
// met. The stray copy was a plain advisory row making no such claim, so it sat outside both.
//
// This one is scoped to the RENDERED PANEL instead. Anywhere the sheet says "Hidden" it must mark
// the standard historic, because it was withdrawn in 2007 and a manager who checks the citation
// finds that out — and the 13 must never be attributed to Hidden as though Hidden still imposed it.
// Chiltern's policy carries the number; Hidden is where it came from.
//
// Deliberately not keyed on the word "Longest": the failure was a SECOND COPY appearing somewhere
// nobody was looking, so a guard aimed at the place it appeared this time would repeat the mistake.
//
// WHAT IT DOES NOT CATCH, measured rather than assumed. The unit is a sentence, and one historic
// marker satisfies every mention inside it — so dropping "historic" from the hard-limit row's detail
// while its `basis` still says "legacy" passes here (verified). That is the right trade: the row
// still reads correctly to a human, and tightening to one-marker-per-mention would fail on prose
// that is perfectly honest. The failure this exists for is a mention with NO marker anywhere near
// it, which is what a stray second copy looks like, and both that and the all-markers-removed case
// are teeth-verified.
test('nothing the panel renders presents the Hidden standard as current', () => {
    // Both branches of the run row: within the design target, and over it (where the sub-line that
    // carried the stray citation is the one that renders).
    for (const [label, patterns] of [['a clean design', fullPatterns()], ['a design over the target', longRunPatterns()]]) {
        resetDom();
        initLinksAnalysis({ getDesign: () => ({ patterns }) }).renderDesignChecks();
        const html = els.checksContent.innerHTML;
        const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

        for (const m of text.matchAll(/[^.]*\bHidden\b[^.]*\./g)) {
            const sentence = m[0].trim();
            assert.match(sentence, /historic|legacy|withdrawn|origin|former/i,
                `${label}: "${sentence}" names the Hidden standard without marking it historic. It was ` +
                'withdrawn in 2007; a manager who checks the citation finds a superseded document and ' +
                'is entitled to discount everything else on the sheet.');
            assert.doesNotMatch(sentence, /\bthe Hidden limit\b/i,
                `${label}: "${sentence}" attributes the limit to Hidden. It is Chiltern's policy limit; ` +
                'Hidden is its origin.');
        }
    }
});

// ── THE SAME NUMBER, TWO STATUSES — EACH ROW STATES ITS OWN THRESHOLD (v20.00) ──────────────────
// On a design between 8 and 13 consecutive days the panel reports the identical figure twice: amber
// on "Longest run" (against the owner's design target of 7) and green in the hard-limit section
// (against Chiltern's 13). That is correct and useful — they are different questions — but only
// while each row says which figure it was measured against. Unlabelled it reads as the panel
// contradicting itself, which is exactly the FF13 defect of v19.48 (a hardcoded green tick directly
// beneath the amber row it duplicated) arriving in a different form.
test('a run between the design target and the company limit labels both thresholds', () => {
    resetDom();
    initLinksAnalysis({ getDesign: () => ({ patterns: longRunPatterns() }) }).renderDesignChecks();
    const html = els.checksContent.innerHTML;
    const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

    // The premise: both rows really are reporting the same figure, or there is nothing to label.
    assert.match(text, /Longest run/, 'the run row did not render');
    assert.match(text, /consecutive days worked/, 'the hard-limit row did not render');

    assert.match(text, /design target/i,
        'the amber run row does not say the 7 is a design AIM rather than a limit, so it reads as a ' +
        'contradiction of the green row below it');
    assert.match(text, /limit of 13|13 consecutive/i,
        'the hard-limit row does not state the figure it was measured against');
});

// ── THE CODE COLUMN IS FIXED-WIDTH, SO A LONGER CODE MUST FAIL LOUDLY (v20.00) ──────────────────
// `.check-code` is `width: 52px` rather than `min-width`, because the point is that every tag is
// the same size — that is what aligns the TITLES after them, not just the tags' own left edges. It
// was `min-width: 44px` until v20.00 and `MRSF`/`FF8b` overflowed it, so the second column wandered
// over 20px down a 30-row list.
//
// A fixed width buys alignment at the cost of a ceiling, and CSS enforces neither: a five-character
// code would simply overflow its box and quietly reintroduce the ragged edge it was meant to end.
// The code set is closed and comes from the ORR's own p3 list, so the ceiling is checkable here.
test('no fatigue code is wider than the fixed code column can hold', () => {
    resetDom();
    initLinksAnalysis({ getDesign: () => ({ patterns: fullPatterns() }) }).renderDesignChecks();
    const codes = [...els.checksContent.innerHTML.matchAll(/class="check-code">([^<]*)</g)].map(m => m[1]);
    // 17, not 24: the seven night factors roll up into one `\u00d77` row. The premise that matters is
    // not the count but that the WIDEST codes are among them — a test over a subset that happened to
    // exclude MRSF and FF8b would be checking nothing, since those are the two that overflowed 44px.
    assert.ok(codes.length >= 15, `expected the rendered ORR code set, found ${codes.length}`);
    for (const widest of ['MRSF', 'FF8b']) {
        assert.ok(codes.includes(widest), `${widest} did not render — it is one of the two codes this guards`);
    }

    // 52px at 11px/700 tabular-nums, less 10px of padding, holds 4 characters comfortably. Asserted
    // on character count rather than measured width because there is no layout engine here — the
    // number is the CONTRACT with the CSS, and the CSS carries the same note.
    const MAX = 4;
    const tooLong = codes.filter(c => c.length > MAX);
    assert.deepEqual(tooLong, [],
        `these codes exceed the ${MAX}-character width of .check-code and will overflow it, ` +
        `un-aligning every title in the column: ${tooLong.join(', ')}. Widen the CSS and this ` +
        'number together, or the fix is invisible until someone looks at the panel.');

    // …and the width must actually be FIXED. `min-width` looks equivalent and is the thing that was
    // wrong, so assert the declaration rather than trusting the comment above it.
    const css = readFileSync(new URL('./links.css', import.meta.url), 'utf8');
    const rule = css.slice(css.indexOf('.check-code {'), css.indexOf('}', css.indexOf('.check-code {')));
    assert.match(rule, /\bwidth:\s*52px/, '.check-code must set a fixed width');
    assert.doesNotMatch(rule, /min-width/,
        '.check-code is back on min-width, which aligns the tags but not the titles beside them');
});

// ── A SUMMARY CHIP MAY NOT REPORT ONE OF TWO COUNTS (v22.56, external review) ───────────────────
//
// Two chips summarised a PAIR the domain module deliberately returns separately, and both kept the
// flattering half. `summariseDemand` splits `uncovered` (staffed hours with nobody on duty — a
// finding) from `outside` (trains running while the station is shut — a fact, because the window is
// a business decision). `assessFatigue` returns `present` beside `standing`. The strip read only the
// first of each and announced "All service covered" and "No fatigue factors".
//
// Neither module was wrong. This is the same failure the calendar's knowledge states exist to stop —
// an absent count is not proof of an absent thing — arriving in a one-line render instead.
//
// It is tested on the STRIP because that is where the claim is made: the detailed panel already
// distinguishes all four figures, which is precisely why nobody noticed the chip did not.
test('the summary never claims full cover — only that the STAFFED hours have none missing', () => {
    resetDom();
    initLinksAnalysis({ getDesign: () => ({ patterns: fullPatterns() }) }).renderSummary();
    const strip = els.linksSummary.innerHTML;
    // The design is Mon–Fri days only, so the Dec 2026 evening and Sunday service runs outside it.
    assert.doesNotMatch(strip, /service covered/i,
        'the strip claims all service is covered. It only knows about hours INSIDE the staffed '
        + 'window — `outside` movements are a separate figure it never reads, and under the '
        + 'December 2026 service that figure is large. Say what the number is: staffed hours.');
    assert.match(strip, /staffed hours?/i, 'the cover chip no longer says which hours it means');
});

test('the summary never says "no fatigue factors" while standing factors exist', () => {
    resetDom();
    const patterns = fullPatterns();          // 06:00 starts ⇒ at least one STANDING early factor
    const { standing, present } = assessFatigue(patterns, ROTATING_LINES);
    assert.ok(standing > 0,
        'fixture no longer produces a standing factor, so this test cannot see the defect — give it '
        + 'a design with early starts rather than deleting the assertion');
    initLinksAnalysis({ getDesign: () => ({ patterns }) }).renderSummary();
    const strip = els.linksSummary.innerHTML;
    assert.doesNotMatch(strip, /No<\/strong> fatigue/i,
        `the strip says "No fatigue factors" over ${standing} standing one(s). The fatigue model is `
        + 'right that standing characteristics are not design findings — but ordinary English does '
        + 'not carry that distinction, and the reader takes the chip at its word.');
    assert.match(strip, new RegExp(`${standing} standing`),
        'the strip does not state the standing count, so the two numbers are still one number');
    if (!present) {
        assert.match(strip, /0<\/strong> to act on/,
            'with nothing to act on the chip should say so explicitly rather than saying "No"');
    }
});
