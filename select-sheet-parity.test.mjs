// @ts-check
/**
 * select-sheet-parity.test.mjs — EVERY `<select>` IN THE APP IS EITHER ENHANCED OR EXEMPT.
 *
 * WHY THIS EXISTS. The v23.36 sweep replaced the OS-drawn `<select>` popup across the app and
 * missed two controls: `#rosterType` on Operations (in the markup, and simply not in the list) and
 * `#acctGradeFilter` (built in JS after two Firestore reads, so an id in that list would have been
 * skipped in silence). Both were found by a second manual audit a release later. A third would
 * have found a third.
 *
 * THE FAILURE IS INVISIBLE FROM EVERY OTHER ANGLE, which is the whole argument for a static guard:
 * the closed control looks identical either way — the popup is the part that differs, it belongs
 * to the platform, and no screenshot, axe rule or behavioural assertion can see it. Playwright's
 * `selectOption` works on both, so the e2e suite is equally green on a missed select. The only
 * thing that can notice is a scan of the tree.
 *
 * IT SCANS THE SOURCE, NOT A LIST. Both halves are derived — served HTML for markup selects, the
 * root modules for ones built at runtime — because a hand-maintained page list is precisely what
 * `page-contract-parity.test.mjs` was written to stop (four suites went green on a new page by
 * not looking at it). An exemption is a NAMED id with a reason beside it, so a decision to leave
 * a control native reads as a decision.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const PAGES = ['index.html', 'admin.html', 'paycalc.html', 'operations.html',
    'settings.html', 'links.html', 'overtime.html'];

/**
 * Selects deliberately left native. Each is a decision recorded in docs/DECISIONS.md; the reason
 * here is the short form. Adding an id to this table is how you take that decision — which is the
 * point, because the alternative is taking it by forgetting.
 */
const EXEMPT = {
    monthJumpMonth: 'Month jump: a sheet over a dialog is a second modal layer, for 12 options',
    monthJumpYear:  'Month jump: as above — the pair is one control',
    otIdentityMember: 'Overtime identity bar: disabled, one option — there is no popup to replace',
};

/** Every root JS module's source, keyed by filename. */
function rootModules() {
    /** @type {Record<string, string>} */
    const out = {};
    for (const f of readdirSync('.')) {
        if (f.endsWith('.js') && !f.endsWith('.test.mjs')) out[f] = readFileSync(f, 'utf8');
    }
    return out;
}

/**
 * The ids the tree actually enhances, resolved from the two call shapes rather than from the id
 * appearing anywhere near the word "select".
 *
 * THE FIRST CUT OF THIS FUNCTION WAS A GREP FOR THE ID, and it had no teeth at all: deleting the
 * real `initSelectSheets` call for `#rosterType` left the suite green, because a DIFFERENT module
 * reads that select (`admin-roster-upload.js` disables it during a parse) and its
 * `getElementById('rosterType')` satisfied the pattern. A guard that passes because somebody
 * merely READS the control is not guarding anything.
 * @param {Record<string, string>} modules
 * @returns {Set<string>}
 */
function enhancedIds(modules) {
    const ids = new Set();
    for (const src of Object.values(modules)) {
        // Shape 1 — `initSelectSheets([{ id: 'x', … }, …])`: take the id literals inside the call.
        for (const call of src.matchAll(/initSelectSheets\s*\(([\s\S]*?)\n\s*\]/g)) {
            for (const m of call[1].matchAll(/\bid:\s*['"`]([\w-]+)['"`]/g)) ids.add(m[1]);
        }
        // Shape 2 — `enhanceSelect(someVar, …)`: resolve the variable to the id it was assigned
        // from, in the same module. An element, not an id, is what this entry point takes.
        for (const m of src.matchAll(/enhanceSelect\s*\(\s*([A-Za-z_$][\w$]*)/g)) {
            const decl = new RegExp(`\\b${m[1]}\\s*=[^;]*?getElementById\\(['"\`]([\\w-]+)['"\`]\\)`);
            const hit = decl.exec(src);
            if (hit) ids.add(hit[1]);
        }
    }
    return ids;
}

test('every <select> in served markup is enhanced, or exempt by name', () => {
    const enhanced = enhancedIds(rootModules());
    /** @type {string[]} */
    const missed = [];
    for (const page of PAGES) {
        const html = readFileSync(page, 'utf8');
        for (const m of html.matchAll(/<select[^>]*\bid="([^"]+)"/g)) {
            const id = m[1];
            if (id in EXEMPT) continue;
            if (!enhanced.has(id)) missed.push(`${page} #${id}`);
        }
    }
    assert.deepEqual(missed, [],
        `these <select>s reach a user with the OS's own popup, and nothing else can see it:\n  ${missed.join('\n  ')}\n`
        + 'Enhance them with select-sheet.js, or add the id to EXEMPT here with the reason.');
});

test('a module that BUILDS a select at runtime enhances it there', () => {
    /** @type {string[]} */
    const missed = [];
    for (const [name, src] of Object.entries(rootModules())) {
        if (!/createElement\(['"`]select['"`]\)/.test(src)) continue;
        // The one legitimate shape that is not a control: a detached select used purely to PARSE
        // an options string into the sheet's grouped shape (links-app.js's cell editor). It is
        // never inserted, so it has no popup — and it is recognised by the module importing
        // `readGroups`, which is what that shape is for.
        // `enhanceSelect\s*\(` — the CALL, never the bare name. The first cut matched the name,
        // which the module's own `import { …, enhanceSelect }` line satisfies, so deleting the
        // real call left this green. The same trap overlay-parity.test.mjs records: a guard an
        // unused import can satisfy.
        const enhances = /enhanceSelect\s*\(/.test(src);
        // The one legitimate shape that is not a control: a detached select used purely to PARSE
        // an options string into the sheet's grouped shape (links-app.js's cell editor). It is
        // never inserted, so it has no popup — and it is recognised by the module importing
        // `readGroups`, which is what that shape is for.
        if (/readGroups\s*\(/.test(src) && !enhances) continue;
        if (!enhances) missed.push(name);
    }
    assert.deepEqual(missed, [],
        `these modules build a <select> after boot and never enhance it — an id in initSelectSheets\n`
        + `would have been skipped silently, so it must be enhanced where it is created:\n  ${missed.join('\n  ')}`);
});

test('the exemptions name real controls, so the table cannot rot', () => {
    const html = PAGES.map(p => readFileSync(p, 'utf8')).join('\n');
    for (const [id, reason] of Object.entries(EXEMPT)) {
        assert.ok(new RegExp(`<select[^>]*\\bid="${id}"`).test(html),
            `EXEMPT names #${id}, which no served page carries any more — remove the row rather `
            + 'than leaving an exemption for a control that is gone.');
        assert.ok(reason.length > 20, `#${id}'s exemption needs a reason, not a placeholder`);
    }
});
