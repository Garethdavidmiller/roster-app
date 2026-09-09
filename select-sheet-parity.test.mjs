/**
 * select-sheet-parity.test.mjs — EVERY `<select>` IN THE APP IS EITHER ENHANCED OR NATIVE BY
 * DECISION, and the page's CSS reaches the control that replaced it.
 * Run: node --test select-sheet-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * The v23.36 sweep replaced the OS-drawn `<select>` popup across the app and missed two controls:
 * `#rosterType` on Operations (in the markup, and simply not in the list) and `#acctGradeFilter`
 * (built in JS after two Firestore reads, so an id in that list would have been skipped in
 * silence). Both were found by a second manual audit a release later. A third would have found a
 * third — hence a guard.
 *
 * THE FAILURE IS INVISIBLE FROM EVERY OTHER ANGLE, which is the whole argument for a static one:
 * the closed control looks identical either way — the popup is the part that differs, it belongs
 * to the platform, and no screenshot, axe rule or behavioural assertion can see it. Playwright's
 * `selectOption` works on both, so the e2e suite is equally green on a missed select. The only
 * thing that can notice is a scan of the tree.
 *
 * ── AND A SCAN OF THE TREE HAS TO SEE THE WHOLE TREE (v23.40) ───────────────────────────────────
 *
 * The v23.38 first cut looked in two places: `<select id>` in served HTML, and modules calling
 * `createElement('select')`. It shipped green over two families it could not see, because a
 * `<select>` also reaches a user from **a JS template literal** — and both of those are consequential:
 *
 *   · `login-overlay.js`'s `#loginGrade` / `#loginName` — the sign-in cascade, the FIRST dropdown
 *     any member touches, on all six protected pages plus the Calendar's front door.
 *   · `links-generator-targets.js`'s `.gen-slot-time` — one per shift slot in the generator table.
 *
 * The `createElement` half had a second, quieter hole: it asked whether a MODULE calls
 * `enhanceSelect` anywhere, not whether THIS select is enhanced. `links-generator-targets.js` calls
 * it for its saved-setups picker, so its slot times were reported as covered by a module that does
 * enhance — just not them. Both holes are closed by identifying each select individually, at its own
 * construction site, in all three shapes.
 *
 * REPORTING A NATIVE SELECT THAT IS THERE ON PURPOSE costs one row in NATIVE_BY_DECISION, with the
 * reason. That asymmetry is why the table holds reasons rather than bare ids: adding a row is how
 * the decision gets TAKEN, and the alternative is taking it by forgetting.
 *
 * ── AND THE CSS HALF, WHICH IS WHERE THE LIVE DEFECT WAS ────────────────────────────────────────
 *
 * The trigger is a `<button>` wearing the select's own classes, so class-based field styling
 * carries for free. An **ID** rule cannot: `#fieldMember:disabled` in admin.css exists to make the
 * locked member field read as a normal display box rather than a greyed-out control, and after the
 * enhancement it styled a select nobody can see while the trigger the reader actually looks at took
 * the generic `:disabled` grey plus shared.css's `opacity: .55` and `cursor: not-allowed` (measured,
 * both before and after). paycalc.css got this right for `#periodSelect` — all three of its id rules
 * name `#periodSelectTrigger` beside them — so the pattern was already in the tree; it was simply
 * not enforced. That contract, and the `.focus()` one below it, are the two that found live defects
 * rather than undeclared decisions.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('.', import.meta.url);
const read = (/** @type {string} */ f) => readFileSync(new URL(f, ROOT), 'utf8');

/** Block comments, line-leading `//`, and HTML comments — the same stripping card-header-parity
 *  does, and for the same reason: half the modules and both of links.html's masthead comments
 *  DISCUSS `<select>` in prose, and prose is not shipped markup. Leaving HTML comments in was the
 *  first cut, and it reported two selects in links.html that are two sentences about a select that
 *  no longer exists. */
const strip = (/** @type {string} */ s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

const GUIDES = new Set([
    'staff-guide.html', 'paycalc-guide.html', 'railcard-guide.html', 'fip-guide.html', 'rangers-guide.html',
]);
const LEGACY_REDIRECTS = new Set(['guide.html', 'fip.html']);

const APP_PAGES = readdirSync(ROOT)
    .filter(f => f.endsWith('.html') && !GUIDES.has(f) && !LEGACY_REDIRECTS.has(f))
    .sort();

/** Every root module the app ships, minus the enhancer itself — `select-sheet.js` calls
 *  `enhanceSelect` on its own behalf, and counting that would make the resolver's job impossible
 *  for no gain. `service-worker.js` is a classic worker and builds no UI. */
const MODULES = readdirSync(ROOT)
    .filter(f => f.endsWith('.js') && f !== 'select-sheet.js' && f !== 'service-worker.js'
        && f !== 'eslint.config.js' && f !== 'generate-sri.mjs')
    .sort();

const APP_STYLESHEETS = [
    'shared.css', 'index.css', 'admin.css', 'paycalc.css',
    'operations.css', 'settings.css', 'links.css', 'overtime.css',
];

/**
 * The selects that stay native, and WHY. A key is `<file>#<id>` or `<file>.<first-class>` — whatever
 * identifies the control at its construction site, which is the only handle a static scan has.
 *
 * Adding a row here is a DECISION and is expected to read like one. "It was easier" is not a reason;
 * neither is "nobody asked for it".
 */
const NATIVE_BY_DECISION = {
    'index.html#monthJumpMonth':
        'The month-jump pair sits INSIDE a lightbox. A sheet over a dialog is a second modal layer '
        + 'for a 12-item list, which is more chrome than the list is worth. DECISIONS.md, 8 Sep 2026.',
    'index.html#monthJumpYear':
        'The other half of the month-jump pair, and native for the same reason. DECISIONS.md.',

    'overtime.html#otIdentityMember':
        'DISABLED with a single option — it states who you are, it does not ask. There is nobody '
        + 'else to pick, so a popup of any kind would be a control that cannot be used. DECISIONS.md.',

    'login-overlay.js#loginGrade':
        'The sign-in cascade. NOT a decision that this should stay native — an OWNER DECISION that '
        + 'has not been taken, recorded here so the guard does not read as approval. It is the '
        + 'strongest remaining candidate in the app: the grade picker enables the name picker below '
        + 'it, the pair is the FIRST dropdown a member ever touches, and it renders on all six '
        + 'protected pages plus the Calendar front door. It is also the highest-blast-radius change '
        + 'available — e2e/auth.spec.js drives it on every one of those surfaces — which is why it '
        + 'is flagged rather than converted in passing.',
    'login-overlay.js#loginName':
        'The other half of the sign-in cascade, and the roster-length list that motivated the module '
        + 'in the first place. Same owner decision as #loginGrade above.',

    'links-generator-targets.js.gen-slot-time':
        'One per shift slot, inside the generator target TABLE — a dense grid of times a designer '
        + 'sets in a run, not fields read one at a time. Replacing every cell of a table with a '
        + 'sheet trigger is a different interaction from replacing a field, and it is a design '
        + 'question for the owner rather than a mechanical conversion. Designer-only surface.',

    // `links-app.js`'s inline grid-cell editor WAS listed here, and is not any more: v23.38
    // converted it, and the conversion is why the detached-select rule above exists. The editor now
    // builds a select purely to parse its own options and hands the groups to `openOptionSheet`,
    // which is the right answer for an ephemeral control the old blur guard would have cancelled.
};

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Reading the tree
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** @typedef {{ key: string, where: string, id: string }} Found */

/** Pull `id` and the first class off a `<select …>` open tag. */
function identify(/** @type {string} */ tag, /** @type {string} */ where) {
    const id = tag.match(/\bid=["']([^"']+)["']/)?.[1] ?? '';
    const cls = tag.match(/\bclass=["']([^"']+)["']/)?.[1]?.trim().split(/\s+/)[1]
             ?? tag.match(/\bclass=["']([^"']+)["']/)?.[1]?.trim().split(/\s+/)[0] ?? '';
    if (id) return { key: `${where}#${id}`, where, id };
    if (cls) return { key: `${where}.${cls}`, where, id: '' };
    return null;
}

/** Every `<select>` this app ships, from all three shapes. */
function findSelects() {
    const found = /** @type {Found[]} */ ([]);
    const unidentified = /** @type {string[]} */ ([]);

    const fromMarkup = (/** @type {string} */ src, /** @type {string} */ where) => {
        for (const m of strip(src).matchAll(/<select\b[^>]*>/g)) {
            const hit = identify(m[0], where);
            if (hit) found.push(hit);
            else unidentified.push(`${where}: ${m[0]} — no id and no class, so nothing can name it`);
        }
    };

    for (const page of APP_PAGES) fromMarkup(read(page), page);

    for (const f of MODULES) {
        const src = strip(read(f));
        fromMarkup(src, f);                       // shape 3: a <select> inside a template literal
        // shape 2: createElement('select'), identified from the lines that dress it
        for (const m of src.matchAll(/(?:\b(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=\s*document\.createElement\(\s*['"]select['"]\s*\)/g)) {
            const ident = m[1];
            const after = src.slice(m.index, m.index + 600);
            // A DETACHED select is not a control. `links-app.js` builds one purely to turn an
            // options string into the sheet's grouped shape via `readGroups`, and never inserts it
            // — so there is no OS popup to replace and nothing for a reader to open. Recognised per
            // SELECT, by this variable reaching `readGroups`, rather than per MODULE by the file
            // importing it: `links-generator-targets.js` both imports the enhancer and ships native
            // selects, which is exactly how a module-level answer reported them as covered.
            if (new RegExp(`readGroups\\(\\s*${ident}\\b`).test(src)) continue;
            const id  = after.match(/\.id\s*=\s*['"]([^'"]+)['"]/)?.[1] ?? '';
            const cls = after.match(/\.className\s*=\s*['"]([^'"]+)['"]/)?.[1]?.split(/\s+/)[0] ?? '';
            if (id) found.push({ key: `${f}#${id}`, where: f, id });
            else if (cls) found.push({ key: `${f}.${cls}`, where: f, id: '' });
            else unidentified.push(`${f}: createElement('select') with no id or className set near it`);
        }
    }
    return { found, unidentified };
}

/** Every select id the app actually enhances, resolved from the call sites. */
function findEnhanced() {
    const ids = new Set();
    const unresolved = /** @type {string[]} */ ([]);
    for (const f of MODULES) {
        const src = strip(read(f));
        for (const m of src.matchAll(/initSelectSheets\(\s*\[([\s\S]*?)\]\s*[,)]/g)) {
            const specs = [...m[1].matchAll(/\bid:\s*['"]([^'"]+)['"]/g)].map(x => x[1]);
            if (!specs.length) unresolved.push(`${f}: initSelectSheets([…]) with no readable ids`);
            for (const id of specs) ids.add(id);
        }
        for (const m of src.matchAll(/\benhanceSelect\(\s*([^,)]+)/g)) {
            const arg = m[1].trim();
            const direct = arg.match(/getElementById\(\s*['"]([^'"]+)['"]/);
            if (direct) { ids.add(direct[1]); continue; }
            const ident = /^[A-Za-z_$][\w$]*$/.test(arg) ? arg : null;
            const decl = ident
                && src.match(new RegExp(`\\b${ident}\\s*=[\\s\\S]{0,200}?getElementById\\(\\s*['"]([^'"]+)['"]`));
            if (decl) { ids.add(decl[1]); continue; }
            // A select the page BUILDS: `x = document.createElement('select'); x.id = '…'`. The
            // account-status filter is this shape because it does not exist until its card's read
            // returns. Resolved from the `.id =` that follows, which is the same handle the
            // construction-site scan above uses.
            const built = ident
                && src.match(new RegExp(`\\b${ident}\\s*=\\s*document\\.createElement\\(\\s*['"]select['"]\\s*\\)[\\s\\S]{0,300}?\\b${ident}\\.id\\s*=\\s*['"]([^'"]+)['"]`));
            if (built) { ids.add(built[1]); continue; }
            unresolved.push(`${f}: enhanceSelect(${arg}) — cannot resolve which select this is`);
        }
    }
    return { ids, unresolved };
}

/** Selector → declarations, for every rule in a stylesheet. Comments stripped first. */
function selectorsOf(/** @type {string} */ css) {
    return (strip(css).match(/[^{}]+\{[^{}]*\}/g) || [])
        .map(r => r.slice(0, r.indexOf('{')).trim().replace(/\s+/g, ' '))
        .filter(Boolean);
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Contract 1 — the scan can read what it is checking
// ────────────────────────────────────────────────────────────────────────────────────────────────

test('the guard can read every select and every enhancement call', () => {
    // A check that SKIPS what it cannot parse passes by not looking, which is the failure
    // pre-commit-parity.test.mjs was written about. An unreadable construction site fails here.
    const { unidentified } = findSelects();
    const { unresolved }   = findEnhanced();
    assert.deepEqual([...unidentified, ...unresolved], [],
        'the scan hit something it could not name — fix the source or teach the scan, never skip it');

    assert.ok(APP_PAGES.length >= 7, `expected the app pages, found ${APP_PAGES.join(', ') || 'none'}`);
    assert.ok(MODULES.length > 50, `expected the app modules, found ${MODULES.length}`);
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Contract 2 — every select is enhanced, or native by decision
// ────────────────────────────────────────────────────────────────────────────────────────────────

test('every <select> the app ships is enhanced, or native with a reason', () => {
    const { found } = findSelects();
    const { ids }   = findEnhanced();
    const undeclared = found
        .filter(s => !(s.id && ids.has(s.id)))
        .filter(s => !(s.key in NATIVE_BY_DECISION))
        .map(s => s.key);
    assert.deepEqual([...new Set(undeclared)].sort(), [],
        'a native <select>. Enhance it with select-sheet.js, or add it to NATIVE_BY_DECISION with '
        + 'the reason — an undeclared one is indistinguishable from an oversight');
});

test('every reason in NATIVE_BY_DECISION is a real reason, not a placeholder', () => {
    for (const [key, why] of Object.entries(NATIVE_BY_DECISION)) {
        assert.ok(why.trim().length >= 60, `${key}: the reason is too short to BE a reason`);
    }
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Contract 3 — a declaration that no longer names anything has stopped guarding
// ────────────────────────────────────────────────────────────────────────────────────────────────

test('no declared native select has been removed or quietly enhanced', () => {
    const { found } = findSelects();
    const { ids }   = findEnhanced();
    const keys = new Set(found.map(s => s.key));
    const stale = Object.keys(NATIVE_BY_DECISION).filter(k => !keys.has(k));
    assert.deepEqual(stale, [],
        'declared native, but no such <select> exists any more — delete the row');
    const contradicted = found.filter(s => s.key in NATIVE_BY_DECISION && s.id && ids.has(s.id));
    assert.deepEqual(contradicted.map(s => s.key), [],
        'declared native AND enhanced — one of the two is wrong');
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Contract 4 — an ID rule on an enhanced select needs a #<id>Trigger counterpart
// ────────────────────────────────────────────────────────────────────────────────────────────────

test('every id-level CSS rule on an enhanced select also names its trigger', () => {
    // A class travels to the trigger for free — `select-sheet.js` copies `select.className` onto the
    // button. An id cannot travel, so an id rule styles a control the reader can no longer see, and
    // the trigger silently takes whatever the generic rules give it. Nothing throws; the field just
    // looks wrong, in a state (`:disabled`) that no screenshot baseline captures.
    const { ids } = findEnhanced();
    const misses = /** @type {string[]} */ ([]);
    const allSelectors = APP_STYLESHEETS.flatMap(f => selectorsOf(read(f)).map(s => ({ f, s })));
    for (const id of ids) {
        for (const { f, s } of allSelectors) {
            for (const m of s.matchAll(new RegExp(`#${id}(:[a-z-]+)?(?![\\w-])`, 'g'))) {
                const suffix = m[1] ?? '';
                const wanted = `#${id}Trigger${suffix}`;
                if (allSelectors.some(x => x.s.includes(wanted))) continue;
                misses.push(`${f}: "${s}" styles #${id}${suffix} but nothing styles ${wanted}`);
            }
        }
    }
    assert.deepEqual([...new Set(misses)].sort(), [],
        'add the trigger beside the select in the same rule — see #periodSelect in paycalc.css');
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Contract 5 — a classless enhanced select depends on element rules, so the page must extend them
// ────────────────────────────────────────────────────────────────────────────────────────────────

test('a page whose enhanced selects carry no class of their own names .fieldpick in its CSS', () => {
    // Most enhanced selects are bare `<select id="…">` — every pixel of their look comes from the
    // page's `select { … }` element rules, and a class selector cannot inherit an element one. Such
    // a page has to have extended those rules to `.fieldpick`, or its trigger renders as the shared
    // default rather than as that page's field. A select WITH a class is fine: the class travels.
    const { ids } = findEnhanced();
    const PAGE_CSS = {
        'index.html': 'index.css', 'admin.html': 'admin.css', 'paycalc.html': 'paycalc.css',
        'operations.html': 'operations.css', 'settings.html': 'settings.css',
        'links.html': 'links.css', 'overtime.html': 'overtime.css',
    };
    const missing = /** @type {string[]} */ ([]);
    for (const [page, css] of Object.entries(PAGE_CSS)) {
        const markup = strip(read(page));
        const classless = [...markup.matchAll(/<select\b[^>]*>/g)]
            .filter(m => !/\bclass=/.test(m[0]))
            .map(m => m[0].match(/\bid=["']([^"']+)["']/)?.[1] ?? '')
            .filter(id => id && ids.has(id));
        if (classless.length && !read(css).includes('.fieldpick')) {
            missing.push(`${page}: ${classless.join(', ')} carry no class, and ${css} never names .fieldpick`);
        }
    }
    assert.deepEqual(missing, [],
        'name .fieldpick beside the page\'s `select` field rules — see admin.css or index.css');
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Contract 6 — nothing may FOCUS an enhanced select
// ────────────────────────────────────────────────────────────────────────────────────────────────

test('no module calls .focus() on a select that is enhanced', () => {
    // An enhanced select is 1px, transparent, `pointer-events: none`, `tabindex="-1"` and
    // `aria-hidden` — it is the value holder, not the control. `.focus()` on it therefore sends a
    // keyboard or screen-reader user somewhere that is not on the page: focus leaves the visible
    // UI, nothing throws, nothing renders differently, and the only person who finds out is the one
    // navigating by keyboard. There is no axe rule for it and no screenshot shows it.
    //
    // The app had exactly one of these, and it was introduced by an ENHANCEMENT rather than written
    // wrong: `filterSelect.focus()` on Operations' account-status card was correct for three
    // releases and became wrong the moment the select was enhanced, in the same commit. That is the
    // shape this contract exists for — the call site does not change, so nothing draws the eye to it.
    //
    // Focus the TRIGGER instead: `select-sheet.js` gives it the id `<selectId>Trigger`.
    const { ids } = findEnhanced();
    const offenders = /** @type {string[]} */ ([]);
    for (const f of MODULES) {
        const src = strip(read(f));
        for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*\??\.focus\(\)/g)) {
            const ident = m[1];
            // Which select is this identifier? ONLY what the FILE says it is — resolved from a
            // `getElementById` or a `createElement` in the same source. Matching the identifier's
            // NAME against the enhanced ids was the first cut and it is wrong in the direction that
            // wastes a maintainer's afternoon: an identifier is file-local and an id is page-global,
            // so `login-overlay.js`'s own `gradeSelect` variable — a select that is native by
            // decision, on a different page — was reported as paycalc's enhanced `#gradeSelect`.
            const decl = src.match(new RegExp(`\\b${ident}\\s*=[\\s\\S]{0,200}?getElementById\\(\\s*['"]([^'"]+)['"]`));
            const built = src.match(new RegExp(`\\b${ident}\\s*=\\s*document\\.createElement\\(\\s*['"]select['"]\\s*\\)[\\s\\S]{0,300}?\\b${ident}\\.id\\s*=\\s*['"]([^'"]+)['"]`));
            const resolved = decl?.[1] ?? built?.[1] ?? '';
            if (resolved && ids.has(resolved)) offenders.push(`${f}: ${ident}.focus() — #${resolved} is enhanced; focus #${resolved}Trigger instead`);
        }
        // …and the inline shape, which has no identifier to resolve at all.
        for (const m of src.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)\s*\??\.focus\(\)/g)) {
            if (ids.has(m[1])) offenders.push(`${f}: getElementById('${m[1]}').focus() — enhanced; focus #${m[1]}Trigger instead`);
        }
    }
    assert.deepEqual([...new Set(offenders)].sort(), []);
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CONTRACT 8 — A PROGRAMMATIC SELECTION SAYS SO
// ────────────────────────────────────────────────────────────────────────────────────────────────
// `option.selected = true` and `selectedIndex = n` change what a select HOLDS while mutating no
// attribute (`selected` is not reflected to the content attribute) and firing no event. Nothing can
// observe them — not the `change`/`input` listeners, not the MutationObserver — so the enhanced
// trigger, which is the only thing a reader sees, keeps whatever it last painted.
//
// That is not a theoretical shape. Both pages carrying an optgroup'd select have a helper built on
// it, because iOS Safari ignores `.value` there: `_setSelectPeriod` (paycalc-periods.js) and
// `_setSelectValue` (admin-app.js). Measured at v23.41, before the fix: ←/→/a tax-year jump left
// the pay-period picker naming "25 Sept 2026" over a page computing 11 Apr 2025, and switching
// member on Change a Shift left the AL and Absence pickers naming the previous person.
//
// The three ACCEPTED signals, in the order they actually occur:
//   · a `dispatchEvent` — the helper saying so, which is the fix;
//   · an option REBUILD in the same function (`createElement('option')` / `new Option` /
//     `innerHTML`) — the childList mutation the observer already watches;
//   · a `disabled` write — an observed attribute, and the reason admin's self-service lock
//     survived this by accident rather than by design.
test('a selection changed in code announces itself, or rebuilds, or disables', () => {
    /** Every id the app enhances — reuses the resolver the contracts above are built on. */
    const ids = findEnhanced().ids;
    const offenders = [];
    for (const f of MODULES) {
        const src = strip(read(f));
        if (!/\.selected\s*=|\.selectedIndex\s*=/.test(src)) continue;
        // Only modules that can reach an enhanced select at all. A module with none of these ids is
        // out of scope — this guards the enhancement, not every select in the world.
        if (![...ids].some(id => src.includes(id)) && !/enhanceSelect|initSelectSheets/.test(src)) continue;

        // Split on function boundaries and judge each body on its own. Crude, and deliberately so:
        // the alternative is a parser, and what this needs to know is only "is the announcement
        // anywhere near the assignment".
        const bodies = src.split(/\n(?=\s*(?:export\s+)?(?:async\s+)?function\s|\s*[A-Za-z_$][\w$]*\s*[:=]\s*(?:async\s*)?\()/);
        for (const body of bodies) {
            if (!/\.selected\s*=\s*(?!false)|\.selectedIndex\s*=/.test(body)) continue;
            const announced = /dispatchEvent\s*\(/.test(body);
            const rebuilds  = /createElement\(\s*['"]option['"]|new Option\(|\.innerHTML\s*=/.test(body);
            const disables  = /\.disabled\s*=/.test(body);
            if (!announced && !rebuilds && !disables) {
                const line = body.split('\n').find(l => /\.selected\s*=|\.selectedIndex\s*=/.test(l)) || '';
                offenders.push(`${f}: ${line.trim().slice(0, 90)} — changes the selection with no signal the trigger can hear`);
            }
        }
    }
    assert.deepEqual(offenders.sort(), [],
        'dispatch an `input` event after setting the selection (see `_setSelectPeriod`)');
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CONTRACT 9 — A TEST READS THE FACE, NOT THE BUTTON
// ────────────────────────────────────────────────────────────────────────────────────────────────
// The trigger holds TWO spans: `.fieldpick-face` (what is shown) and `.fieldpick-sizer` (a hidden
// copy of the widest option, added at v23.39 so the control does not resize when its value
// changes). A `toHaveText` on the button therefore sees the label TWICE — "CEA / BilingualCEA /
// Bilingual". Four tests written against the trigger passed before the sizer landed and failed on
// CI after it, which is a whole CI round-trip to learn something a grep can say in a second.
test('no spec asserts text on a trigger button instead of its face', () => {
    const offenders = [];
    for (const f of readdirSync(new URL('e2e/', ROOT)).filter(n => n.endsWith('.spec.js'))) {
        // Per TEST, not per file. `trigger` is the obvious name for this variable and several tests
        // in one spec use it, so a file-wide search paired one test's locator with another test's
        // assertion — contract 6's lesson (resolve from the declaration, never from the name)
        // arriving a second time by a different route.
        for (const block of strip(read(`e2e/${f}`)).split(/\n(?=test(?:\.\w+)?\s*\()/)) {
            for (const m of block.matchAll(/locator\(\s*['"`]([^'"`]*Trigger)['"`]\s*\)/g)) {
                const sel = m[1];
                if (sel.includes('fieldpick-face')) continue;
                const varName = (block.slice(Math.max(0, m.index - 80), m.index)
                    .match(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)?$/) || [])[1];
                const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // The assertion must be ON the locator, not merely NEAR it. A `{0,40}` window read
                // `expect(trigger).toBeVisible(); await expect(face).toHaveText(…)` as a hit — the
                // same proximity trap paycalc-notice-order.test.mjs records, and it fires on the
                // FIXED code, which is the worst direction for a guard to be wrong in.
                const textAssert = varName
                    ? new RegExp(`expect\\(\\s*${varName}\\s*\\)\\s*(?:\\.not)?\\s*\\.toHaveText`)
                    // `\\)?` for the inline shape's OWN closing paren: `expect(page.locator('#x')).toHaveText`
                    // puts a second `)` between the locator and the assertion, and without it the
                    // whole no-variable branch was unreachable — it passed a reintroduced defect.
                    : new RegExp(`locator\\(\\s*['"\`]${esc}['"\`]\\s*\\)\\s*\\)?\\s*(?:\\.not)?\\s*\\.toHaveText`);
                if (textAssert.test(block)) offenders.push(`e2e/${f}: '${sel}' asserted with toHaveText — read '${sel} .fieldpick-face' (the button also carries the hidden sizer)`);
            }
        }
    }
    assert.deepEqual([...new Set(offenders)].sort(), []);
});
