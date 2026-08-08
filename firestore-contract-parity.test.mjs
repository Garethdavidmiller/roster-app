/**
 * firestore-contract-parity.test.mjs — the CLIENT ↔ firestore.rules contracts that nothing guarded.
 *
 * WHY THIS FILE EXISTS. This app's real architecture is hand-maintained cross-file contracts held
 * together by hygiene tests (doc stamps, SW asset lists, CSP meta parity, surname parity, payday
 * parity, card-header parity, colour parity). Nearly every defect found in the v18.9x reviews was a
 * contract that had NO guard yet. Three such contracts run between the client and firestore.rules —
 * two of them already documented in CLAUDE.md with a "remember to update the allowlist" note, which
 * is exactly the kind of instruction a test should be enforcing instead of a human.
 *
 * These are STATIC checks: they read both sources and compare. No emulator, so they run in
 * `npm test` (test:hygiene) rather than the emulator-gated `npm run test:rules`. That matters — the
 * rules suite proves the rules behave as written; this proves the rules were written to match what
 * the client actually sends, which is a different failure and a much quieter one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT  = new URL('./', import.meta.url);
const read  = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const RULES = read('firestore.rules');
/** Every root-level JS module (where the client-side halves of these contracts live). */
const APP_JS = readdirSync(new URL('./', ROOT))
    .filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))
    .map(f => read(f))
    .join('\n');

// ── 1. Analytics counter ids ────────────────────────────────────────────────────────────────────
// The QUIETEST of the three. analytics writes are fire-and-forget (`.catch(() => {})` in
// firebase-client.js), so an id the rules don't allow isn't an error anyone sees — the counter
// simply never increments, and the Usage card under-reports for as long as nobody notices. The ids
// live in three places: the rules allowlist, the recordUsage() call sites, and OPEN_META.
test('every analytics id the client can write is allowed by firestore.rules', () => {
    const m = RULES.match(/request\.resource\.data\.counts\.keys\(\)\.hasOnly\(\[([\s\S]*?)\]\)/);
    assert.ok(m, 'analytics counts allowlist not found in firestore.rules — has the rule been reshaped?');
    const allowed = new Set([...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]));

    // Page views: the id each coordinator passes to recordUsage().
    const pageIds = new Set([...APP_JS.matchAll(/recordUsage\('([a-z-]+)'/g)].map(x => x[1]));
    assert.ok(pageIds.size >= 6, `expected the six page ids, found ${pageIds.size}`);

    // Document/guide opens: the card's own render map is the authoritative list of open ids.
    const om = read('operations-reports.js').match(/const OPEN_META = \{([\s\S]*?)\n\};/);
    assert.ok(om, 'OPEN_META not found in operations-reports.js');
    const openIds = new Set([...om[1].matchAll(/'([a-z-]+)':/g)].map(x => x[1]));

    const clientIds = new Set([...pageIds, ...openIds]);
    const missing = [...clientIds].filter(id => !allowed.has(id)).sort();
    assert.deepEqual(missing, [],
        'ids the client writes but firestore.rules rejects — the write fails SILENTLY (fire-and-forget), so the counter just stops');

    // The reverse direction too: a leftover id in the rules is dead allowlist surface, and usually
    // means a counter was renamed on the client and the rule kept the old spelling.
    const stale = [...allowed].filter(id => !clientIds.has(id)).sort();
    assert.deepEqual(stale, [],
        'ids allowed by firestore.rules that no client code writes — stale allowlist entries');
});

// The guide open ids have a FOURTH home — NAV_GUIDES in nav-panel.js, which is what actually emits
// them. A guide added there without an `openId` renders a perfectly good link that counts nothing,
// which is the quietest failure of the lot: the bar is simply absent, and an absent bar reads as
// "nobody opens it". (This is the same shape as tips-content.test.mjs's missing-key case, where the
// `?` button is inert rather than broken.) Until v19.95 the handler matched the href instead, and
// two of the four guides had no branch at all — so the group answered a narrower question than its
// heading claimed for five months.
test('every guide in the nav drawer has an open counter, and every guide counter is emitted', () => {
    const NAV = read('nav-panel.js');
    const g = NAV.match(/const NAV_GUIDES = \[([\s\S]*?)\n\];/);
    assert.ok(g, 'NAV_GUIDES not found in nav-panel.js');
    /** One entry per line: assert on the LINE, so a url with no openId is a named failure. */
    const entries = g[1].split('\n').filter(l => l.includes('url:'));
    assert.equal(entries.length, 4, `expected the four guides, found ${entries.length}`);
    const navIds = new Set();
    for (const line of entries) {
        const id = line.match(/openId:\s*'([a-z-]+)'/)?.[1];
        assert.ok(id, `a NAV_GUIDES entry has no openId, so opening it counts nothing:\n  ${line.trim()}`);
        navIds.add(id);
    }

    const om = read('operations-reports.js').match(/const OPEN_META = \{([\s\S]*?)\n\};/);
    assert.ok(om, 'OPEN_META not found in operations-reports.js');
    const metaGuideIds = new Set([...om[1].matchAll(/'(guide-[a-z-]+)':/g)].map(x => x[1]));

    // Both directions. A nav id missing from OPEN_META writes a counter that renders with the
    // fallback 📄 and a raw id for a label; a stale OPEN_META id is a bar that can never appear.
    assert.deepEqual([...navIds].sort(), [...metaGuideIds].sort(),
        'NAV_GUIDES openIds and OPEN_META guide ids have drifted');

    // …and the handler must read the id off the element rather than guessing it from the href.
    // `'./paycalc-guide.html'.includes('guide.html')` is TRUE, so a substring test would count the
    // Pay Calculator Guide as the Staff Guide and both bars would still look plausible.
    assert.match(NAV, /data-open-id="\$\{g\.openId\}"/,
        'the guide link no longer carries data-open-id — the open counter has lost its id source');
    assert.doesNotMatch(NAV, /_href\.includes\('(guide|fip)/,
        'guide open ids must not be matched from the href — see the substring trap above');
});

// ── 2. The "Other" day-family flavour grammar ───────────────────────────────────────────────────
// OTHER_FLAVOURS in override-utils.js is the documented single source (CLAUDE.md → "grammar
// single-source"), and the CLIENT already derives its own accept-set from it (v18.91). But the
// rules restate the alternation as a literal. A seventh flavour would therefore compose fine on the
// client and be REJECTED by the rules — a failed save with a permission error, which reads like a
// claim problem rather than a grammar one. Not hypothetical: this family gained Union at v18.56 and
// Meeting at v18.61, so it changes roughly every other month.
test('the Other-family flavours in firestore.rules match OTHER_FLAVOURS exactly', () => {
    const src = read('override-utils.js');
    const of = src.match(/export const OTHER_FLAVOURS = \{([\s\S]*?)\n\};/);
    assert.ok(of, 'OTHER_FLAVOURS not found in override-utils.js — has it been renamed?');
    // Keys are the sentinels: TRG, IND, ASSESS, … (uppercase, at the start of a line).
    const clientFlavours = [...of[1].matchAll(/^\s{4}([A-Z]+):/gm)].map(x => x[1]).sort();
    assert.ok(clientFlavours.length >= 6, `expected the Other flavours, found ${clientFlavours.join(',')}`);

    const rm = RULES.match(/\(((?:[A-Z]+\|){2,}[A-Z]+)\)\( RDW\)\?/);
    assert.ok(rm, 'the Other-family value alternation was not found in firestore.rules');
    const ruleFlavours = rm[1].split('|').sort();

    assert.deepEqual(ruleFlavours, clientFlavours,
        'OTHER_FLAVOURS and the firestore.rules value grammar disagree — the client would compose a value the rules reject');
});

// ── 3. Override types the client can create ─────────────────────────────────────────────────────
// PILL_TYPES is the single authoritative pill list (CLAUDE.md). `spare_shift` is the documented
// special case: it lives in the Other submenu but keeps its own type. Every type the client can
// produce must be creatable under the rules, or the save fails with a permission error that looks
// like an auth problem.
test('every override type the client can create is permitted by firestore.rules', () => {
    const pt = read('admin-overrides.js').match(/export const PILL_TYPES = \[([^\]]*)\]/);
    assert.ok(pt, 'PILL_TYPES not found in admin-overrides.js');
    const pillTypes = [...pt[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]);

    const rt = RULES.match(/request\.resource\.data\.type in \[([\s\S]*?)\]/);
    assert.ok(rt, 'the creatable override-type list was not found in firestore.rules');
    const ruleTypes = new Set([...rt[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]));

    // spare_shift is written by the Other submenu rather than a top-level pill (v15.57), so it is
    // creatable without appearing in PILL_TYPES.
    const clientTypes = [...new Set([...pillTypes, 'spare_shift'])].sort();
    const missing = clientTypes.filter(t => !ruleTypes.has(t));
    assert.deepEqual(missing, [],
        'override types the client can create but firestore.rules rejects — every save of that type fails');
});
