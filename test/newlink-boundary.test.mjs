// @ts-check
// @lane hygiene
/**
 * newlink-boundary.test.mjs — a proposal never reaches a roster surface.
 * Run: node scripts/run-tests.mjs test/newlink-boundary.test.mjs   (part of `npm run test:hygiene`)
 *
 * The new link page shows three PROPOSED rotas to the colleagues who would work one of them. The design's first
 * risk was always confusion: a proposal's week read as somebody's real roster. The page guards its own side — a flag on
 * every grid, week numbers instead of dates (newlink-render.test.mjs). This guards the other side: the surfaces a member
 * reads as THEIR roster — the Calendar, Team Week, the day panel, the Pay Calculator and Admin's Change a Shift — must not
 * be able to reach a proposal at all, whatever a later change wires up.
 *
 * It walks the real import graph from each roster page's coordinator, static and dynamic imports alike, and fails if any
 * proposal module is in reach. It does not trust names: a roster page that imports a helper that imports the proposals
 * fails just the same. And it guards itself: the surfaces it claims to cover must actually be in the walk.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

const read = (/** @type {string} */ f) => readFileSync(new URL(`./${f}`, REPO_ROOT_URL), 'utf8');

/** Every root module a module can load, by relative static or dynamic import, followed to the end. @param {string} entry */
function reach(entry) {
    const seen = new Set();
    const queue = [entry];
    while (queue.length) {
        const f = /** @type {string} */ (queue.pop());
        if (seen.has(f) || !existsSync(new URL(`./${f}`, REPO_ROOT_URL))) continue;
        seen.add(f);
        const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]\.\/([\w.-]+\.js)['"]/g)) queue.push(m[1]);
    }
    return seen;
}

/** The proposals, and everything that exists only to show them — the Links Selector's modules too (27 Nov 2026), which put a
 *  proposal on DATES and so are the likelier of the two to be mistaken for a roster if one ever reached a roster page. */
const PROPOSAL_MODULES = ['link-designer-proposals.js', 'newlink-data.js', 'newlink-render.js', 'newlink-config.js', 'newlink-app.js',
    'links-selector-core.js', 'links-selector-render.js', 'links-selector-app.js'];

/** Each roster page, and the surfaces in it a member reads as their own roster — named so the walk is checked to cover them. */
const ROSTER_PAGES = {
    'calendar-app.js': ['calendar-renderer.js', 'calendar-team-view.js', 'calendar-al-lightbox.js'],   // the month, Team Week, the day panel
    'paycalc-app.js': ['paycalc-roster-suggestions.js'],                                                 // the calculator's "from your calendar"
    'admin-app.js': ['admin-week-editor.js'],                                                            // Change a Shift
    // and the two other pages that read a member's roster (the 22 Nov 2026 review: neither reaches a proposal today, but an
    // import added there would have passed this file unseen)
    'overtime-app.js': ['overtime-roster.js'],                                                           // the roster context beside each week
    'operations-app.js': ['operations-al-sheet.js'],                                                     // the leave sheet read against the roster
};

for (const [page, surfaces] of Object.entries(ROSTER_PAGES)) {
    test(`${page} cannot reach a proposal`, () => {
        const reached = reach(page);
        // guard the guard: the walk found the surfaces this test claims to protect
        for (const s of surfaces) assert.ok(reached.has(s), `${page}'s import walk no longer reaches ${s} — the walk is broken or the surface moved; fix this test before trusting it`);
        const leaks = PROPOSAL_MODULES.filter(m => reached.has(m));
        assert.deepEqual(leaks, [], `${page} can load ${leaks.join(', ')} — a proposal is one call away from a member's own roster`);
    });
}

test('the page\'s own modules are loaded by the page alone', () => {
    // A module beside the coordinator that something else starts importing is the first step of the leak above, taken
    // somewhere this file does not walk. link-designer-proposals.js is the Link Designer's too, which is where it began.
    const own = ['newlink-data.js', 'newlink-render.js', 'newlink-config.js', 'newlink-app.js'];
    const importers = /** @type {Record<string, string[]>} */ ({});
    for (const f of readFileSync(new URL('./service-worker.js', REPO_ROOT_URL), 'utf8').match(/'[\w.-]+\.js'/g) ?? []) {
        const file = f.slice(1, -1);
        if (!existsSync(new URL(`./${file}`, REPO_ROOT_URL))) continue;
        const src = read(file);
        for (const m of own) if (file !== m && new RegExp(`['"]\\./${m.replace('.', '\\.')}['"]`).test(src)) (importers[m] ??= []).push(file);
    }
    const strangers = Object.entries(importers).flatMap(([m, fs]) => fs.filter(f => !f.startsWith('newlink')).map(f => `${f} → ${m}`));
    assert.deepEqual(strangers, [], 'only the new link page may load its modules');
    assert.deepEqual(importers['newlink-app.js'], ['newlink-boot.js'], 'the coordinator is started by its boot shim alone');
});

test('the Links Selector\'s modules are loaded by the Links Selector alone', () => {
    // It borrows the Calendar's cell builders and swipe (links-selector-render.js says why it does not borrow the Calendar's
    // month); the borrowing runs one way only. A roster module importing one of these is the leak above, a step early.
    const own = ['links-selector-core.js', 'links-selector-render.js', 'links-selector-app.js'];
    /** @type {string[]} */ const strangers = [];
    for (const f of readFileSync(new URL('./service-worker.js', REPO_ROOT_URL), 'utf8').match(/'[\w.-]+\.js'/g) ?? []) {
        const file = f.slice(1, -1);
        if (file.startsWith('links-selector') || !existsSync(new URL(`./${file}`, REPO_ROOT_URL))) continue;
        const src = read(file);
        for (const m of own) if (new RegExp(`['"]\\./${m.replace('.', '\\.')}['"]`).test(src)) strangers.push(`${file} → ${m}`);
    }
    assert.deepEqual(strangers, [], 'only the Links Selector may load its modules');
    // guard the guard: the page itself does load them, so the pattern above can match at all
    assert.ok(/['"]\.\/links-selector-core\.js['"]/.test(read('links-selector-app.js')), 'the pattern no longer matches a real import');
});
