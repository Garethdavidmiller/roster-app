// Deployment-hygiene checks:
//  1. Every root JS module is referenced in service-worker.js — catches the
//     "added a new module but forgot to list it in the SW" mistake.
//  2. APP_VERSION matches in all 9 bump locations (8 files) — catches a
//     partial version bump, which would serve staff a stale cached asset.
//  3. AI_MAP.md is current to the latest 0.10 milestone — makes the
//     "update docs every 0.10 version" policy (CLAUDE.md) self-enforcing
//     instead of relying on someone remembering to do the sweep.
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

    // All root .js files except the SW itself and *.test.mjs / *.test.js files.
    const rootModules = readdirSync(ROOT).filter(
        f => f.endsWith('.js') && f !== 'service-worker.js' && !f.includes('.test.')
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

test('AI_MAP.md is current to the latest 0.10 documentation milestone', () => {
    const rosterData = readFileSync(join(ROOT, 'roster-data.js'), 'utf8');
    const appMatch = rosterData.match(/export const APP_VERSION = '([\d.]+)'/);
    assert.ok(appMatch, 'APP_VERSION declaration not found in roster-data.js');
    const appHundredths = toHundredths(appMatch[1]);

    const aiMap = readFileSync(join(ROOT, 'AI_MAP.md'), 'utf8');
    const docMatch = aiMap.match(/Last updated:[^\n]*?v(\d+\.\d+)/);
    assert.ok(docMatch, 'AI_MAP.md "Last updated: … vX.YZ" header not found');
    const docHundredths = toHundredths(docMatch[1]);

    // CLAUDE.md policy: docs are refreshed at every 0.10 boundary. So AI_MAP
    // must be at least the most recent 0.10 milestone at or below APP_VERSION
    // (i.e. the app version floored to the nearest 0.10). This test fails the
    // moment a version bump crosses a 0.10 line without the doc sweep — turning
    // the prose policy into an executable tripwire.
    const milestone = Math.floor(appHundredths / 10) * 10;
    assert.ok(
        docHundredths >= milestone,
        `AI_MAP.md is stale: its "Last updated" header says v${docMatch[1]}, but `
        + `APP_VERSION is v${appMatch[1]} (0.10 checkpoint = v${(milestone / 100).toFixed(2)}). `
        + `Do the documentation sweep across the .md files and bump the AI_MAP "Last updated" line.`
    );
});
