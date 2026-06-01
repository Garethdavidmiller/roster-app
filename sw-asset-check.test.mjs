// Verifies every root JS module is referenced in service-worker.js.
// Catches the "added a new module but forgot to list it in the SW" mistake
// before it reaches production.
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
