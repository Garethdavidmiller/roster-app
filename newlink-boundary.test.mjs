// @ts-check
/**
 * newlink-boundary.test.mjs — a proposal never reaches a roster surface.
 * Run: node scripts/run-tests.mjs newlink-boundary.test.mjs   (part of `npm run test:hygiene`)
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

const read = (/** @type {string} */ f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');

/** Every root module a module can load, by relative static or dynamic import, followed to the end. @param {string} entry */
function reach(entry) {
    const seen = new Set();
    const queue = [entry];
    while (queue.length) {
        const f = /** @type {string} */ (queue.pop());
        if (seen.has(f) || !existsSync(new URL(`./${f}`, import.meta.url))) continue;
        seen.add(f);
        const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]\.\/([\w.-]+\.js)['"]/g)) queue.push(m[1]);
    }
    return seen;
}

/** The proposals, and everything that exists only to show them. */
const PROPOSAL_MODULES = ['links-proposals.js', 'newlink-data.js', 'newlink-render.js', 'newlink-config.js', 'newlink-app.js'];

/** Each roster page, and the surfaces in it a member reads as their own roster — named so the walk is checked to cover them. */
const ROSTER_PAGES = {
    'calendar-app.js': ['calendar-renderer.js', 'calendar-team-view.js', 'calendar-al-lightbox.js'],   // the month, Team Week, the day panel
    'paycalc-app.js': ['paycalc-roster-suggestions.js'],                                                 // the calculator's "from your calendar"
    'admin-app.js': ['admin-week-editor.js'],                                                            // Change a Shift
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
    // somewhere this file does not walk. links-proposals.js is the Links workspace's too, which is where it began.
    const own = ['newlink-data.js', 'newlink-render.js', 'newlink-config.js', 'newlink-app.js'];
    const importers = /** @type {Record<string, string[]>} */ ({});
    for (const f of readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8').match(/'[\w.-]+\.js'/g) ?? []) {
        const file = f.slice(1, -1);
        if (!existsSync(new URL(`./${file}`, import.meta.url))) continue;
        const src = read(file);
        for (const m of own) if (file !== m && new RegExp(`['"]\\./${m.replace('.', '\\.')}['"]`).test(src)) (importers[m] ??= []).push(file);
    }
    const strangers = Object.entries(importers).flatMap(([m, fs]) => fs.filter(f => !f.startsWith('newlink')).map(f => `${f} → ${m}`));
    assert.deepEqual(strangers, [], 'only the new link page may load its modules');
    assert.deepEqual(importers['newlink-app.js'], ['newlink-boot.js'], 'the coordinator is started by its boot shim alone');
});
