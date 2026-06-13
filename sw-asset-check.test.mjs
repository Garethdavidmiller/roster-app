// Deployment-hygiene checks:
//  1. Every root JS module is referenced in service-worker.js — catches the
//     "added a new module but forgot to list it in the SW" mistake.
//  2. APP_VERSION matches in all 9 bump locations (8 files) — catches a
//     partial version bump, which would serve staff a stale cached asset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));

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
