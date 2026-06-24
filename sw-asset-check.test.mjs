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

test('every root JS module is referenced in service-worker.js', () => {
    const sw = readFileSync(join(ROOT, 'service-worker.js'), 'utf8');

    // All root .js files except the SW itself, dev config files, and test files.
    const SW_EXCLUDED = new Set(['service-worker.js', 'eslint.config.js']);
    const rootModules = readdirSync(ROOT).filter(
        f => f.endsWith('.js') && !SW_EXCLUDED.has(f) && !f.includes('.test.')
    );

    // Each file must appear in the SW either as 'filename.js' or './filename.js'
    // (NETWORK_FIRST_FILES uses bare names; CORE_ASSETS uses the ./ prefix).
    const missing = rootModules.filter(f =>
        !sw.includes(`'${f}'`)   && !sw.includes(`"${f}"`) &&
        !sw.includes(`'./${f}'`) && !sw.includes(`"./${f}"`)
    );

    assert.deepEqual(
        missing, [],
        `Files present in root but missing from service-worker.js:\n  ${missing.join('\n  ')}`
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

    // Collection names from: collection(db, 'name')  or  doc(db, 'name', ...)
    const clientCollections = new Set();
    const clientRe = /(?:collection|doc)\s*\(\s*db\s*,\s*['"](\w+)['"]/g;
    let m;
    while ((m = clientRe.exec(client)) !== null) clientCollections.add(m[1]);

    // Explicit match blocks from rules: match /name/{...}
    const ruleCollections = new Set();
    const rulesRe = /match\s+\/(\w+)\s*\/\{/g;
    while ((m = rulesRe.exec(rules)) !== null) ruleCollections.add(m[1]);

    // 'databases' is the Firestore path root, not a collection name.
    const FIRESTORE_PATH_SEGMENTS = new Set(['databases']);
    const missing = [...clientCollections]
        .filter(c => !FIRESTORE_PATH_SEGMENTS.has(c) && !ruleCollections.has(c));

    assert.deepEqual(
        missing, [],
        `Collections used in firebase-client.js but missing from firestore.rules:\n  ${missing.join('\n  ')}`
    );
});
