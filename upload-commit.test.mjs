/**
 * upload-commit.test.mjs — the ambiguous-commit verdict (v21.86).
 *
 * Run: node --test upload-commit.test.mjs   (part of `npm run test:hygiene`)
 *
 * The defect this rule exists for is a live document pointing at a Storage object that has already
 * been deleted — the button 404s, nothing errors, and the upload that caused it reported success.
 * An external audit found it by walking the interleaving; no test could have, because the decision
 * lived inline in `firebase-client.js`, which imports the Firebase SDK from gstatic and therefore
 * cannot be loaded in Node at all.
 *
 * Organised by what each wrong verdict COSTS, because they are not the same size:
 *   · saying `retry` when another upload is live → **overwrites somebody else's file reference**,
 *     and the object ours points at may already be gone. This is the shipped defect.
 *   · saying `superseded` when nothing superseded us → an upload refused for no reason. Visible,
 *     annoying, and the admin can simply try again.
 *   · saying `committed` when nothing committed → the file is in Storage and NOTHING points at it.
 *     Silent, and the document is missing for the day.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveUploadCommit } from './upload-commit.js';

const OURS = 'circulars/2026-08-27-aaa111.pdf';
const OLD  = 'circulars/2026-08-27-old000.pdf';
const THEIRS = 'circulars/2026-08-27-bbb222.pdf';
const at = (o) => resolveUploadCommit({ ourPath: OURS, oldPath: OLD, livePath: null, readable: true, ...o });

describe('never overwrite an upload that superseded ours', () => {
    test('a live path belonging to someone else is SUPERSEDED', () => {
        // The audit's interleaving, at the moment it is decidable: B committed and cleaned up our
        // predecessor while our first write was in doubt.
        assert.equal(at({ livePath: THEIRS }), 'superseded');
    });

    test('and that holds when there was no document to begin with', () => {
        // Two admins uploading the first file for a date. `oldPath` is null for both, so a live
        // path that is not ours can only have arrived after we started.
        assert.equal(resolveUploadCommit({ ourPath: OURS, oldPath: null, livePath: THEIRS, readable: true }),
            'superseded');
    });
});

describe('never write again when our own write already landed', () => {
    test('a live path equal to ours is COMMITTED', () => {
        assert.equal(at({ livePath: OURS }), 'committed');
    });

    test('even if the document did not exist before', () => {
        assert.equal(resolveUploadCommit({ ourPath: OURS, oldPath: null, livePath: OURS, readable: true }),
            'committed');
    });
});

describe('retry only when the state genuinely has not moved', () => {
    test('the previous path still live means nothing of ours committed', () => {
        assert.equal(at({ livePath: OLD }), 'retry');
    });

    test('no document at all means nothing of ours committed', () => {
        assert.equal(at({ livePath: null }), 'retry');
    });

    test('an UNREADABLE state retries rather than abandoning the upload', () => {
        // Not a fourth answer — the absence of one. Abandoning here would leave a file in Storage
        // that nothing points at, on the same outage that made the read fail. Asserted for every
        // live state so the read failure is what decides, not what happens to be underneath it.
        for (const livePath of [null, OLD, OURS, THEIRS]) {
            assert.equal(resolveUploadCommit({ ourPath: OURS, oldPath: OLD, livePath, readable: false }),
                'retry', `unreadable with live=${livePath}`);
        }
    });
});

test('the verdict never depends on path ORDERING or timestamps', () => {
    // A tempting "is theirs newer than ours?" rule would need a clock both writers agree on, and
    // the versioned paths carry a client-generated id — deliberately not a sortable one. Identity
    // is the only comparison this rule may make, so a path that merely SORTS after ours but equals
    // it must still read as committed.
    assert.equal(at({ livePath: OURS }), 'committed');
    assert.equal(resolveUploadCommit({ ourPath: 'z/zzz.pdf', oldPath: 'a/aaa.pdf', livePath: 'z/zzz.pdf', readable: true }),
        'committed');
    assert.equal(resolveUploadCommit({ ourPath: 'z/zzz.pdf', oldPath: 'a/aaa.pdf', livePath: 'm/mmm.pdf', readable: true }),
        'superseded');
});
