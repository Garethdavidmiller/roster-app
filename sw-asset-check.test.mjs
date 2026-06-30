// Deployment-hygiene checks:
//  1. Every root JS module is referenced in service-worker.js — catches the
//     "added a new module but forgot to list it in the SW" mistake.
//  2. APP_VERSION matches in all 9 bump locations (8 files) — catches a
//     partial version bump, which would serve staff a stale cached asset.
//  3. AI_MAP.md is current to the latest 0.10 milestone — makes the
//     "update docs every 0.10 version" policy (CLAUDE.md) self-enforcing
//     instead of relying on someone remembering to do the sweep.
//  4. functions/roster-members.json matches active staff in roster-data.js —
//     catches the "added a member but forgot to re-run generate-roster-members.mjs" mistake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));

/** "12.61" → 1261, "12.6" → 1260. Lets us compare versions as integers. */
function toHundredths(v) {
    const [maj, min = '0'] = v.split('.');
    return parseInt(maj, 10) * 100 + parseInt(min.padEnd(2, '0').slice(0, 2), 10);
}

test('every root JS module is in BOTH the SW network-first list and a precache list', () => {
    const sw = readFileSync(join(ROOT, 'service-worker.js'), 'utf8');

    // All root .js files except the SW itself, dev config files, and test files.
    const SW_EXCLUDED = new Set(['service-worker.js', 'eslint.config.js']);
    const rootModules = readdirSync(ROOT).filter(
        f => f.endsWith('.js') && !SW_EXCLUDED.has(f) && !f.includes('.test.')
    );

    // Extract a named array-literal's contents from the SW source so we can check
    // membership of each list SEPARATELY. The old check only required a module to
    // appear *somewhere* in the file, so a module that was network-first but never
    // precached (or vice-versa) passed silently — exactly the half-listed-module gap.
    const arrayOf = (name) => {
        const m = sw.match(new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
        return m ? m[1] : '';
    };
    const networkFirst = arrayOf('NETWORK_FIRST_FILES');
    // A module is "precached" if it is in CORE_ASSETS (core app) or SUPPLEMENTARY_ASSETS
    // (the guides, cached individually). Both are required to be offline-available.
    const precache     = arrayOf('CORE_ASSETS') + arrayOf('SUPPLEMENTARY_ASSETS');

    const inList = (list, f) =>
        list.includes(`'${f}'`)   || list.includes(`"${f}"`) ||
        list.includes(`'./${f}'`) || list.includes(`"./${f}"`);

    const missingNetworkFirst = rootModules.filter(f => !inList(networkFirst, f));
    const missingPrecache     = rootModules.filter(f => !inList(precache, f));

    assert.deepEqual(
        missingNetworkFirst, [],
        `Root JS modules missing from NETWORK_FIRST_FILES:\n  ${missingNetworkFirst.join('\n  ')}`
    );
    assert.deepEqual(
        missingPrecache, [],
        `Root JS modules missing from a precache list (CORE_ASSETS / SUPPLEMENTARY_ASSETS):\n  ${missingPrecache.join('\n  ')}`
    );
});

test('APP_VERSION matches in all 9 bump locations', () => {
    // roster-data.js is the authoritative source (per CLAUDE.md).
    const rosterData = readFileSync(join(ROOT, 'roster-data.js'), 'utf8');
    const match = rosterData.match(/export const APP_VERSION = '([\d.]+)'/);
    assert.ok(match, "APP_VERSION declaration not found in roster-data.js");
    const version = match[1];

    // service-worker.js: line 1 comment + APP_VERSION const.
    const sw = readFileSync(join(ROOT, 'service-worker.js'), 'utf8');
    assert.ok(
        sw.split('\n')[0].includes(`v${version}`),
        `service-worker.js line 1 comment does not say v${version}`
    );
    assert.ok(
        sw.includes(`APP_VERSION = '${version}'`),
        `service-worker.js APP_VERSION const is not '${version}'`
    );

    // Each app page: line 2 HTML comment.
    const pages = ['index.html', 'admin.html', 'paycalc.html',
                   'operations.html', 'settings.html', 'links.html'];
    const stale = pages.filter(
        p => !readFileSync(join(ROOT, p), 'utf8').split('\n')[1].includes(`v${version}`)
    );
    assert.deepEqual(
        stale, [],
        `Pages whose line-2 version comment is not v${version}:\n  ${stale.join('\n  ')}`
    );
});

// Every .md doc that carries a version stamp must be current to the latest 0.10
// milestone. CLAUDE.md uses a "Current app version `X.YZ`" line; the others use a
// "Last updated: … vX.YZ" header. The policy (CLAUDE.md) is that ALL the docs are
// swept every 0.10 version — this test enforces that for all of them, not just one.
const DOC_STAMPS = [
    { file: 'CLAUDE.md',               re: /Current app version[^`]*`(\d+\.\d+)`/, label: '"Current app version" line' },
    { file: 'AI_MAP.md',               re: /Last updated:[^\n]*?v(\d+\.\d+)/,       label: '"Last updated" header' },
    { file: 'OPERATIONS_REFERENCE.md', re: /Last updated:[^\n]*?v(\d+\.\d+)/,       label: '"Last updated" header' },
    { file: 'KNOWN_LIMITATIONS.md',    re: /Last updated:[^\n]*?v(\d+\.\d+)/,       label: '"Last updated" header' },
    { file: 'ROADMAP.md',              re: /Last updated:[^\n]*?v(\d+\.\d+)/,       label: '"Last updated" header' },
];

test('every versioned .md doc is current to the latest 0.10 milestone', () => {
    const rosterData = readFileSync(join(ROOT, 'roster-data.js'), 'utf8');
    const appMatch = rosterData.match(/export const APP_VERSION = '([\d.]+)'/);
    assert.ok(appMatch, 'APP_VERSION declaration not found in roster-data.js');

    // Docs are refreshed at every 0.10 boundary, so each stamp must be at least
    // the most recent 0.10 milestone at or below APP_VERSION (the app version
    // floored to the nearest 0.10). Fails the moment a bump crosses a 0.10 line
    // without the doc sweep — turning the prose policy into an executable tripwire.
    const milestone = Math.floor(toHundredths(appMatch[1]) / 10) * 10;
    const milestoneStr = `v${(milestone / 100).toFixed(2)}`;

    const stale = [];
    for (const { file, re, label } of DOC_STAMPS) {
        const src = readFileSync(join(ROOT, file), 'utf8');
        const m = src.match(re);
        assert.ok(m, `${file}: ${label} (version stamp) not found`);
        if (toHundredths(m[1]) < milestone) stale.push(`${file} (v${m[1]})`);
    }

    assert.deepEqual(
        stale, [],
        `These docs are behind the ${milestoneStr} 0.10 checkpoint (APP_VERSION v${appMatch[1]}). `
        + `Review each, apply any needed updates, then bump its version stamp:\n  ${stale.join('\n  ')}`
    );
});

test('functions/roster-members.json matches active staff in roster-data.js', async () => {
    // Dynamic import so we get the live teamMembers array without module mocks.
    const { teamMembers } = await import('./roster-data.js');
    const json = JSON.parse(readFileSync(join(ROOT, 'functions', 'roster-members.json'), 'utf8'));

    const expected = {
        cea:        teamMembers.filter(m => m.role === 'CEA'        && !m.hidden && !m.managerOnly).map(m => m.name).sort(),
        ces:        teamMembers.filter(m => m.role === 'CES'        && !m.hidden && !m.managerOnly).map(m => m.name).sort(),
        dispatcher: teamMembers.filter(m => m.role === 'Dispatcher' && !m.hidden && !m.managerOnly).map(m => m.name).sort(),
    };

    for (const grade of ['cea', 'ces', 'dispatcher']) {
        assert.deepEqual(
            [...(json[grade] ?? [])].sort(), expected[grade],
            `functions/roster-members.json ${grade} list is out of sync with roster-data.js.\n`
            + `Run: npm run generate:roster-members`
        );
    }
});

test('no unused CSS custom properties defined in :root', () => {
    // Collect every root .css file and concatenate them for cross-file var() lookups.
    const cssFiles = readdirSync(ROOT).filter(f => f.endsWith('.css'));
    const allCss = cssFiles.map(f => readFileSync(join(ROOT, f), 'utf8')).join('\n');

    // Walk :root { } blocks and collect every --token: definition.
    // :root bodies never contain nested { } (they are flat property lists),
    // so a simple scan for the matching } is safe.
    const defined = new Set();
    let idx = 0;
    while (idx < allCss.length) {
        const rootPos = allCss.indexOf(':root', idx);
        if (rootPos === -1) break;
        const openBrace = allCss.indexOf('{', rootPos);
        if (openBrace === -1) break;
        const closeBrace = allCss.indexOf('}', openBrace);
        if (closeBrace === -1) break;
        const block = allCss.slice(openBrace + 1, closeBrace);
        const propRe = /(--[\w-]+)\s*:/g;
        let m;
        while ((m = propRe.exec(block)) !== null) defined.add(m[1]);
        idx = closeBrace + 1;
    }

    // Tokens intentionally defined but not yet referenced via var() in CSS.
    // Each entry below is a known gap — document the reason so future reviewers
    // know these are decisions, not accidents. Fix by either using the token or
    // deleting it; do not grow this list without a documented reason.
    const ALLOWED_DEAD_TOKENS = new Set([
        // The three-surface model names --surface-canvas as the body background alias
        // for --primary-blue. All 6 page CSS files currently use var(--primary-blue)
        // directly. Align in a future pass by replacing body background references.
        '--surface-canvas',
        // Reserved type-scale step above --type-large (18px). No component needs it yet.
        '--type-xl',
        // Mid-range navy reference colour; no component uses it yet.
        '--navy-mid',
        // Night-shift coverage colour in links.css palette. No night column in current
        // links workspace UI — kept for consistency with the other --cov-* tokens.
        '--cov-night',
        // Hover variants for raspberry and indigo UI elements. No interactive
        // raspberry/indigo elements exist yet.
        '--raspberry-hover',
        '--indigo-hover',
        // Reserved for a row-selection UI pattern; not yet implemented.
        '--row-selected-bg',
    ]);

    // Every defined token must appear in a var() call somewhere in the combined CSS.
    const dead = [...defined].filter(
        token => !ALLOWED_DEAD_TOKENS.has(token) && !allCss.includes(`var(${token})`)
    );
    assert.deepEqual(
        dead, [],
        `CSS custom properties defined in :root but never referenced via var():\n  ${dead.join('\n  ')}`
    );
});

test('Firestore collections in firebase-client.js all have firestore.rules entries', () => {
    const client = readFileSync(join(ROOT, 'firebase-client.js'), 'utf8');
    const rules  = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');

    // Collection names from the COLLECTIONS constant object exported by firebase-client.js.
    // The code uses COLLECTIONS.name rather than bare string literals, so we parse the
    // object declaration instead of looking for collection(db, 'literal') calls.
    const clientCollections = new Set();
    const collectionsBlock = client.match(/export const COLLECTIONS\s*=\s*\{([^}]+)\}/);
    if (collectionsBlock) {
        const valueRe = /:\s*'(\w+)'/g;
        let m;
        while ((m = valueRe.exec(collectionsBlock[1])) !== null) clientCollections.add(m[1]);
    }

    // Sanity: the regex must have found at least one collection.
    // If COLLECTIONS is refactored, update the regex above rather than silently passing.
    assert.ok(
        clientCollections.size > 0,
        'Firestore collections test found zero collections — check the COLLECTIONS regex in sw-asset-check.test.mjs'
    );

    // Explicit match blocks from rules: match /name/{...}
    const ruleCollections = new Set();
    const rulesRe = /match\s+\/(\w+)\s*\/\{/g;
    let m;
    while ((m = rulesRe.exec(rules)) !== null) ruleCollections.add(m[1]);

    // 'databases' is the Firestore path root, not a collection name.
    const FIRESTORE_PATH_SEGMENTS = new Set(['databases']);
    const missing = [...clientCollections]
        .filter(c => !FIRESTORE_PATH_SEGMENTS.has(c) && !ruleCollections.has(c));

    assert.deepEqual(
        missing, [],
        `Collections in COLLECTIONS constant but missing from firestore.rules:\n  ${missing.join('\n  ')}`
    );
});

// ──────────────────────────────────────────────────────────────────────────────
// paycalc.html <link rel="modulepreload"> hints must stay in sync with paycalc's
// real static import graph. The preloads collapse the module-fetch waterfall (see
// the comment block in paycalc.html); if an import is added/removed and the hints
// aren't updated, the speed-up silently regresses for that module — and a stale
// gstatic Firebase version would preload the wrong SDK file. This guards both.
// ──────────────────────────────────────────────────────────────────────────────

/** Resolve the transitive set of LOCAL (./) static module deps reachable from `entry`. */
function staticLocalGraph(entry) {
    const seen = new Set();
    const walk = (file) => {
        if (seen.has(file)) return;
        seen.add(file);
        let src;
        try { src = readFileSync(join(ROOT, file), 'utf8'); } catch { return; }
        // Strip comments first. The `from '...'` scan below matches that substring
        // anywhere, so a module path written inside a JSDoc/usage comment (e.g.
        // "// re-exported from './foo.js'") would otherwise inject a PHANTOM module and
        // make the walker recurse into an unrelated subtree — a spurious CI failure.
        // Preserve "://" so import URLs like https://… are not mangled.
        src = src
            .replace(/\/\*[\s\S]*?\*\//g, '')        // block comments
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1');   // line comments (but not the // in a URL)
        const deps = [];
        let m;
        // "... from './path'" — covers single-line AND multiline import/export blocks
        const fromRe = /\bfrom\s*["']([^"']+)["']/g;
        while ((m = fromRe.exec(src))) deps.push(m[1]);
        // side-effect imports: import './path'
        const sideRe = /^\s*import\s*["']([^"']+)["']/gm;
        while ((m = sideRe.exec(src))) deps.push(m[1]);
        for (const p of deps) {
            if (!p.startsWith('./')) continue;   // ignore gstatic + bare specifiers
            walk(p.slice(2));
        }
    };
    walk(entry);
    return seen;
}

test('paycalc.html modulepreload hints match its real transitive module graph', () => {
    const html = readFileSync(join(ROOT, 'paycalc.html'), 'utf8');

    // The local module graph paycalc actually loads (entry script handles boot itself).
    const graph = staticLocalGraph('paycalc-boot.js');
    graph.delete('paycalc-boot.js');
    const expected = [...graph].filter(f => f.endsWith('.js')).sort();

    // The local modules paycalc.html declares as preloads.
    const preloaded = [...html.matchAll(/<link rel="modulepreload" href="\.\/([^"]+)"/g)]
        .map(x => x[1]).sort();

    const missing = expected.filter(f => !preloaded.includes(f));
    const stale   = preloaded.filter(f => !expected.includes(f));
    assert.deepEqual(
        { missing, stale }, { missing: [], stale: [] },
        'paycalc.html modulepreload list is out of sync with paycalc-boot.js\'s static graph.\n' +
        `  Add a <link rel="modulepreload"> for: ${missing.join(', ') || '(none)'}\n` +
        `  Remove the stale preload for:        ${stale.join(', ') || '(none)'}`
    );
});

test('paycalc.html gstatic Firebase preloads match the SDK version in firebase-client.js', () => {
    const client = readFileSync(join(ROOT, 'firebase-client.js'), 'utf8');
    const versions = new Set(
        [...client.matchAll(/gstatic\.com\/firebasejs\/([\d.]+)\//g)].map(x => x[1])
    );
    assert.equal(versions.size, 1, `firebase-client.js references multiple SDK versions: ${[...versions].join(', ')}`);
    const version = [...versions][0];

    const html = readFileSync(join(ROOT, 'paycalc.html'), 'utf8');
    const preloadedSdk = [...html.matchAll(
        /<link rel="modulepreload" href="https:\/\/www\.gstatic\.com\/firebasejs\/([\d.]+)\/(firebase-[a-z]+)\.js" crossorigin>/g
    )];

    // Every gstatic preload must be at the pinned version, and the three core SDK
    // modules paycalc needs on the critical path must all be preloaded.
    for (const [, v, mod] of preloadedSdk) {
        assert.equal(v, version, `paycalc.html preloads ${mod} at ${v} but firebase-client.js uses ${version}`);
    }
    const preloadedMods = new Set(preloadedSdk.map(x => x[2]));
    for (const mod of ['firebase-app', 'firebase-auth', 'firebase-firestore']) {
        assert.ok(preloadedMods.has(mod), `paycalc.html is missing a modulepreload for ${mod}.js`);
    }
});

// ──────────────────────────────────────────────────────────────────────────────
// Privacy guard: real payslip figures (MILLER_ACTUALS) must live ONLY in the test
// fixture (test-fixtures/miller-actuals.js, excluded from Firebase Hosting), never
// exported from served production JS. Moved out of roster-data.js at v14.68; this
// asserts it can't creep back in.
// ──────────────────────────────────────────────────────────────────────────────
test('roster-data.js does not export MILLER_ACTUALS (payslip data stays in the test fixture)', () => {
    const src = readFileSync(join(ROOT, 'roster-data.js'), 'utf8');
    const exportsDecl = /export\s+(?:const|let|var|function)\s+MILLER_ACTUALS\b/.test(src);
    const exportsList = /export\s*\{[^}]*\bMILLER_ACTUALS\b[^}]*\}/.test(src);
    assert.ok(
        !exportsDecl && !exportsList,
        'MILLER_ACTUALS must NOT be exported from roster-data.js — real payslip figures belong only in ' +
        'test-fixtures/miller-actuals.js (excluded from Firebase Hosting), never in served production JS.',
    );
});
