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

test('document reads are admin-only in all three blocks', () => {
    // The only DIRECT Storage reader is the admin upload (getDownloadURL on the object it has just
    // written); staff open a URL minted elsewhere. A read open to `request.auth != null` let any
    // session — an anonymous sign-in included — list the bucket and fetch every file's permanent
    // download token, walking round the v23.18 PIN/password decision.
    for (const path of ['huddles', 'circulars', 'newsletters']) {
        const block = rules.split(`match /${path}/`)[1].split(/\n {4}match /)[0];
        const read = block.match(/allow read\s*:\s*if ([^;]+);/);
        assert.ok(read, `/${path}/ has no read rule`);
        assert.match(read[1], /request\.auth\.token\.admin\s*==\s*true/,
            `/${path}/ read must require the admin claim — got: ${read[1].trim()}`);
    }
});
