// Verifies every root JS module parses as an ES module.
//
// Added at v12.50 after a leftover fragment of deleted code in settings-app.js
// (orphaned by the v12.28 sw-register.js extraction) shipped a fatal module
// SyntaxError — the entire Settings page ran no JS for ~20 releases and nothing
// caught it: `node --check` parses .js as CommonJS and missed it, and no test
// imported the page coordinators. This test parses each file exactly the way
// browsers do (ES module goal) without executing anything, so a module that
// would brick its page fails CI instead.
//
// Run with: node --experimental-vm-modules --test module-parse.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = dirname(fileURLToPath(import.meta.url));

test('every root JS module parses as an ES module', { skip: !vm.SourceTextModule && 'requires --experimental-vm-modules' }, () => {
    // All root .js files (page coordinators, shared modules, the service worker)
    // plus the self-hosted .mjs vendor file. Test files are exercised by the
    // test runner itself, so they're excluded.
    const files = readdirSync(ROOT).filter(
        f => (f.endsWith('.js') || f === 'purify.es.mjs') && !f.includes('.test.')
    );
    assert.ok(files.length > 20, `expected to find the app's modules, got ${files.length} files`);

    const failures = [];
    for (const f of files) {
        try {
            new vm.SourceTextModule(readFileSync(join(ROOT, f), 'utf8'), { identifier: f });
        } catch (e) {
            failures.push(`${f}: ${e.message}`);
        }
    }
    assert.deepEqual(failures, [], `Modules with syntax errors:\n  ${failures.join('\n  ')}`);
});
