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
 *   · saying `retry` when we cannot SEE — the second external audit's finding, and this file used
 *     to assert it. An unreadable state is the same overwrite as the first bullet, arrived at by
 *     assuming rather than by reading. The verdict is now `ambiguous`, and the test below is the
 *     inverse of the one it replaces.
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

});

describe('uncertainty is not permission to write', () => {
    test('an UNREADABLE state is AMBIGUOUS — never retry', () => {
        // Asserted for every live state, and the point is now the opposite of what it was: under an
        // unreadable read `livePath` is not evidence, it is whatever the caller happened to hold. A
        // rule that consulted it would be right by luck on two of these four and wrong on the two
        // that matter. So the read failure decides, alone.
        for (const livePath of [null, OLD, OURS, THEIRS]) {
            assert.equal(resolveUploadCommit({ ourPath: OURS, oldPath: OLD, livePath, readable: false }),
                'ambiguous', `unreadable with live=${livePath}`);
        }
    });

    test('the verdict that costs a colleague their file can never be reached without a read', () => {
        // The whole rule, stated once: `retry` — the only verdict that WRITES — requires
        // `readable`. Everything else is a refusal of one kind or another, and refusals are safe.
        for (const livePath of [null, OLD, OURS, THEIRS]) {
            assert.notEqual(resolveUploadCommit({ ourPath: OURS, oldPath: OLD, livePath, readable: false }),
                'retry', `unreadable must never write (live=${livePath})`);
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
