/**
 * Static (text-level) guards for storage.rules.
 *
 * The emulator-based storage.rules.test.mjs cannot practically exercise the 20 MB
 * size cap (allocating a 20 MB+ buffer per test is impractical), so the cap is
 * verified here by source inspection instead — this runs as part of `npm test`
 * (test:hygiene), with no emulator required. If a future edit accidentally drops
 * the `request.resource.size` cap from any upload block, this fails immediately
 * rather than waiting for an emulator boundary test that does not exist.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(join(__dirname, 'storage.rules'), 'utf8');

test('every upload block enforces the 20 MB size cap', () => {
    // huddles, circulars, newsletters — one cap each. Inclusive (<=): exactly 20 MiB is allowed,
    // matching the client (`> MAX` reject) and Function (`> MAX_FILE_BYTES` reject) which both accept
    // exactly 20 MiB — so all three layers agree on "maximum 20 MB, inclusive".
    const caps = rules.match(/request\.resource\.size\s*<=\s*20\s*\*\s*1024\s*\*\s*1024/g) || [];
    assert.equal(caps.length, 3,
        `expected the 20 MB size cap in all 3 upload blocks (huddles, circulars, newsletters), found ${caps.length}`);
});

test('the three named upload match blocks are present', () => {
    for (const path of ['huddles', 'circulars', 'newsletters']) {
        assert.ok(
            new RegExp(`match /${path}/`).test(rules),
            `storage.rules is missing the /${path}/ match block`);
    }
});
