// @ts-nocheck
/**
 * documents-client.test.mjs — the document upload SEQUENCE, executed.
 *
 * This code could not be tested at all until v21.90: it lived in `firebase-client.js`, which
 * imports the Firebase SDK from the gstatic CDN and therefore cannot load in Node. That is the
 * whole reason the module takes its Firebase handles as arguments — with fakes in place, the
 * interleavings that matter can be FORCED, and none of them can be produced by ordering real calls.
 *
 * Organised by what each wrong answer COSTS, because the two directions are not symmetrical:
 *
 * · **A live document pointing at nothing** — the file was deleted (or never written) while the
 *   metadata says it is there. Staff tap the Huddle button and get a 404. Silent until someone
 *   tries to read it, and unrecoverable without a re-upload.
 * · **An orphaned file** — bytes in Storage that no document references. Costs storage and nothing
 *   else; the next upload's cleanup tolerates it. This is the direction to fail in.
 * · **Reporting success for somebody else's document** — the admin walks away believing their file
 *   is the one staff will open. Worse than an error, because an error is retried.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildDocumentClient, assertFileSignature } from './documents-client.js';
import { resolveUploadCommit } from './upload-commit.js';

const PDF_BYTES  = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31]);
const DOCX_BYTES = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00]);

/** A minimal stand-in for a browser File: only `slice(...).arrayBuffer()` and `name` are read. */
function fakeFile(bytes, name = 'x.pdf', type = 'application/pdf') {
    return {
        name, type,
        slice: (a, b) => ({ arrayBuffer: async () => bytes.slice(a, b).buffer }),
    };
}

/**
 * A whole fake world: Firestore documents, Storage objects, and seams to make any step fail.
 * `deleted` and `uploaded` are the record the assertions read — what actually happened to the file.
 */
function harness(opts = {}) {
    const store   = new Map(opts.docs || []);      // "collection/date" → data
    const objects = new Set(opts.objects || []);   // storage paths that exist
    const deleted = [];
    const uploaded = [];
    const log = [];
    let setDocCalls = 0;

    const fs = {
        doc: (_db, c, d) => ({ _key: `${c}/${d}` }),
        getDoc: async (r) => {
            // The RECONCILIATION read is the one after a setDoc; the pre-read is not. Keeping them
            // apart matters: a seam that fails "the read" would fail the authoritative pre-read
            // instead and never reach the branch under test.
            const reconciling = setDocCalls > 0;
            if (reconciling) opts.beforeReconcile?.({ store, objects, deleted });
            if (opts.getDocThrows && opts.getDocThrows({ reconciling, reads: log.length })) {
                throw Object.assign(new Error('read'), { code: 'unavailable' });
            }
            // A read AFTER a failed setDoc can see a competing writer's document.
            if (reconciling && opts.liveAfterFailure !== undefined) {
                const v = opts.liveAfterFailure;
                return { exists: () => v !== null, data: () => v };
            }
            const v = store.get(r._key);
            return { exists: () => v !== undefined, data: () => v };
        },
        setDoc: async (r, data) => {
            setDocCalls++;
            const err = opts.setDocFails?.(setDocCalls);
            if (err) {
                log.push(`setDoc-fail:${err}`);
                // `commitsAnyway` is the whole hazard in one line: Firestore CAN raise
                // deadline-exceeded after the server has committed, so the store must be able to
                // hold a document the writer was told it failed to write.
                if (opts.commitsAnyway) store.set(r._key, data);
                throw Object.assign(new Error('boom'), { code: err });
            }
            store.set(r._key, data);
            log.push('setDoc-ok');
        },
        collection: (_db, c) => ({ _c: c }),
        query: (...a) => a,
        where: () => ({}), orderBy: () => ({}), limit: () => ({}),
        getDocs: async () => ({ empty: true, docs: [] }),
        onSnapshot: () => () => {},
        runTransaction: async () => {},
        serverTimestamp: () => 'TS',
    };

    const storageSdk = {
        storage: {},
        ref: (_s, path) => ({ path }),
        uploadBytes: async (r) => { objects.add(r.path); uploaded.push(r.path); },
        getDownloadURL: async (r) => `https://example.invalid/${r.path}`,
        deleteObject: async (r) => { objects.delete(r.path); deleted.push(r.path); },
    };

    const client = buildDocumentClient({
        db: {}, collections: { huddles: 'huddles', circulars: 'circulars', newsletters: 'newsletters' },
        fs,
        getStorageSdk: async () => storageSdk,
        uploadBytesWithClaimRetry: (uploadBytes, ref, file, meta) => uploadBytes(ref, file, meta),
        utils: {
            isDocxUpload: f => /\.docx$/i.test(f.name),
            uploadMimeType: t => (t === 'docx' ? 'application/vnd.openxmlformats' : 'application/pdf'),
            legacyDocPath: (c, d, t) => `${c}/${d}.${t || 'pdf'}`,
            versionedDocPath: (c, d, id, t) => `${c}/${d}-${id}.${t}`,
        },
        // The REAL rule by default (v21.96). It used to be a hand-written stand-in that restated
        // the verdicts — and restated them WRONG once the rule changed, which is how a test named
        // for the unreadable branch went on passing while asserting the behaviour that branch was
        // fixed to stop doing. A test may replace it to drive one verdict; it may not re-implement it.
        resolveUploadCommit: opts.resolveUploadCommit || resolveUploadCommit,
        pruneOldDocs: async () => { log.push('pruned'); },
    });

    return { client, store, objects, deleted, uploaded, log, setDocCalls: () => setDocCalls };
}

describe('a live document must never point at a file that is not there', () => {

    test('the happy path writes the file, then the document that names it', async () => {
        const h = harness();
        const url = await h.client.uploadHuddle('2026-09-01', fakeFile(PDF_BYTES), 'G. Miller');
        const live = h.store.get('huddles/2026-09-01');
        assert.equal(h.uploaded.length, 1, 'exactly one object uploaded');
        assert.ok(h.objects.has(live.storagePath), 'the document names a file that exists');
        assert.ok(url.endsWith(live.storagePath));
        assert.deepEqual(h.deleted, [], 'nothing deleted — there was no previous file');
    });

    test('a DEFINITE non-commit rolls the new object back, and leaves the old file alone', async () => {
        // permission-denied is not retriable: the write certainly did not happen, so the bytes we
        // just uploaded are certainly unreferenced and must go.
        const h = harness({
            docs: [['circulars/2026-09-01', { storagePath: 'circulars/2026-09-01-old.pdf', fileType: 'pdf' }]],
            objects: ['circulars/2026-09-01-old.pdf'],
            setDocFails: () => 'permission-denied',
        });
        await assert.rejects(
            () => h.client.uploadCircular('2026-09-01', fakeFile(PDF_BYTES), 'G. Miller'),
            /boom/);
        assert.equal(h.deleted.length, 1, 'the new object is rolled back');
        assert.equal(h.deleted[0], h.uploaded[0]);
        assert.ok(h.objects.has('circulars/2026-09-01-old.pdf'),
            'the OLD file survives — the old document still points at it');
    });

    test('a commit-AMBIGUOUS final failure leaves the file, because the document may name it', async () => {
        // Both attempts fail with a retriable code and the post-failure read says nothing is live.
        // Deleting here would 404 the document if the write lands late. An orphan is the cheap way
        // to be wrong; this is the asymmetry the whole rollback rule turns on.
        const h = harness({ setDocFails: () => 'unavailable', liveAfterFailure: null });
        await assert.rejects(() => h.client.uploadHuddle('2026-09-01', fakeFile(PDF_BYTES), 'G'), /boom/);
        assert.deepEqual(h.deleted, [], 'the new object is LEFT in place');
        assert.equal(h.uploaded.length, 1);
    });

    test('after a commit the superseded OLD object is swept, and only it', async () => {
        const h = harness({
            docs: [['newsletters/2026-09-01', { storagePath: 'newsletters/2026-09-01-old.pdf', fileType: 'pdf' }]],
            objects: ['newsletters/2026-09-01-old.pdf'],
        });
        await h.client.uploadNewsletter('2026-09-01', fakeFile(PDF_BYTES), 'G. Miller');
        assert.deepEqual(h.deleted, ['newsletters/2026-09-01-old.pdf']);
        const live = h.store.get('newsletters/2026-09-01');
        assert.ok(h.objects.has(live.storagePath), 'the new file is still there');
    });

    test('a PDF→DOCX swap still finds the old file, whose path carries the OLD extension', async () => {
        // legacyDocPath is asked for the OLD document's fileType, not the new one. Reading it from
        // the new upload would look for a .docx that never existed and orphan the .pdf silently.
        const h = harness({
            docs: [['circulars/2026-09-01', { fileType: 'pdf' }]],   // pre-v13.99: no storagePath
            objects: ['circulars/2026-09-01.pdf'],
        });
        await h.client.uploadCircular('2026-09-01', fakeFile(DOCX_BYTES, 'c.docx'), 'G. Miller');
        assert.deepEqual(h.deleted, ['circulars/2026-09-01.pdf']);
    });
});

describe('an ambiguous commit is resolved by READING, never by re-issuing blind', () => {

    test('when the first write had committed after all, it is NOT written again', async () => {
        let ourPath = null;
        const h = harness({
            setDocFails: n => (n === 1 ? 'deadline-exceeded' : null),
            get liveAfterFailure() { return undefined; },
            resolveUploadCommit: ({ ourPath: p, livePath }) => { ourPath = p; return 'committed'; },
        });
        await h.client.uploadHuddle('2026-09-01', fakeFile(PDF_BYTES), 'G. Miller');
        assert.equal(h.setDocCalls(), 1, 'the second setDoc never runs');
        assert.deepEqual(h.deleted, [], 'and the committed document keeps its file');
        assert.ok(ourPath, 'the verdict was actually consulted');
    });

    test('when somebody else superseded us we FAIL — success would be a lie', async () => {
        // The admin must not walk away believing their file is the one staff will open. And our
        // orphan is cleaned up on the way out.
        const h = harness({
            setDocFails: n => (n === 1 ? 'deadline-exceeded' : null),
            resolveUploadCommit: () => 'superseded',
        });
        await assert.rejects(
            () => h.client.uploadCircular('2026-09-01', fakeFile(PDF_BYTES), 'G. Miller'),
            /newer upload for this date/);
        assert.equal(h.setDocCalls(), 1, 'we do not overwrite their document');
        assert.deepEqual(h.deleted, h.uploaded, 'our orphaned object is removed');
    });

    test('a readable, unchanged state IS re-issued — the gate is a gate, not a disablement', async () => {
        // The counterpart to the two tests below. Nothing superseded us and the read PROVED it, so
        // the write must go out; a fix that simply stopped retrying would pass those and break this.
        const h = harness({ setDocFails: n => (n === 1 ? 'unavailable' : null) });
        await h.client.uploadHuddle('2026-09-01', fakeFile(PDF_BYTES), 'G. Miller');
        assert.equal(h.setDocCalls(), 2, 'the write is re-issued');
        assert.ok(h.store.get('huddles/2026-09-01'), 'and it lands');
        assert.deepEqual(h.deleted, [], 'nothing was rolled back');
    });
});

describe('when we cannot SEE, we write nothing and undo nothing', () => {

    // The previous test in this position was named for the unreadable branch and did not exercise
    // it: its harness set `getDocThrows: () => false`, so the reconciliation read succeeded, and the
    // verdict came from an injected stub that returned `retry` unconditionally. It passed on both
    // sides of the fix. These three drive the real read seam and the real rule.

    test('an unreadable reconciliation does NOT re-issue the write', async () => {
        const h = harness({
            setDocFails: n => (n === 1 ? 'unavailable' : null),
            getDocThrows: ({ reconciling }) => reconciling,
        });
        await assert.rejects(
            () => h.client.uploadHuddle('2026-09-01', fakeFile(PDF_BYTES), 'G. Miller'),
            /** @param {any} e */ (e) => e.code === 'upload/unconfirmed');
        assert.equal(h.setDocCalls(), 1, 'the write is NOT re-issued');
    });

    test('and does NOT roll the object back either — our write may be the live one', async () => {
        // The two halves are separate assertions because they are separate mistakes with opposite
        // costs. Re-issuing overwrites a colleague; rolling back leaves a live document pointing at
        // a file we have just deleted, which is the 404 this whole module exists to prevent.
        const h = harness({
            setDocFails: n => (n === 1 ? 'unavailable' : null),
            getDocThrows: ({ reconciling }) => reconciling,
        });
        await assert.rejects(() => h.client.uploadCircular('2026-09-01', fakeFile(PDF_BYTES), 'G. Miller'),
            /Could not confirm/);
        assert.deepEqual(h.deleted, [], 'the new object is left in place');
        assert.equal(h.objects.size, 1, 'so it survives as an orphan, which is the cheap outcome');
    });

    test('the exact interleaving: a superseding upload is not overwritten by a blind retry', async () => {
        // A's write COMMITS and reports deadline-exceeded. A's reconciliation read then fails. In
        // that window B — who can read — sees A's document, uploads its own, commits, and deletes
        // A's now-superseded object. The old rule sent A back to `setDoc` here, pointing the live
        // document at a path B had already removed: staff tap the Circular and get a 404, with no
        // error anywhere. This is that sequence, and the assertion is that B's document survives.
        const KEY = 'circulars/2026-09-01';
        const h = harness({
            setDocFails: n => (n === 1 ? 'deadline-exceeded' : null),
            commitsAnyway: true,
            beforeReconcile: ({ store, objects }) => {
                const ours = store.get(KEY);                 // A's committed metadata
                if (!ours || ours.storagePath === 'circulars/2026-09-01-BBB.pdf') return;
                objects.delete(ours.storagePath);            // B deletes A's superseded object
                store.set(KEY, { ...ours, storagePath: 'circulars/2026-09-01-BBB.pdf', uploadedBy: 'S. Silva' });
            },
            getDocThrows: ({ reconciling }) => reconciling,   // A cannot read any of it
        });

        await assert.rejects(() => h.client.uploadCircular('2026-09-01', fakeFile(PDF_BYTES), 'G. Miller'),
            /** @param {any} e */ (e) => e.code === 'upload/unconfirmed');

        assert.equal(h.setDocCalls(), 1, 'A did not write a second time');
        assert.equal(h.store.get(KEY).storagePath, 'circulars/2026-09-01-BBB.pdf',
            "B's document is still the live one");
        assert.deepEqual(h.deleted, [], 'and A deleted nothing on the way out');
    });
});

describe('the file is checked before anything is written', () => {

    test('a renamed non-PDF never reaches Storage', async () => {
        const h = harness();
        await assert.rejects(
            () => h.client.uploadHuddle('2026-09-01', fakeFile(new Uint8Array([1, 2, 3, 4, 5]), 'x.pdf'), 'G'),
            /SIGNATURE_MISMATCH/);
        assert.deepEqual(h.uploaded, [], 'nothing was uploaded');
        assert.equal(h.store.size, 0, 'and nothing was written');
    });

    test('a file too short to carry a signature is refused — fail CLOSED', async () => {
        await assert.rejects(() => assertFileSignature(fakeFile(new Uint8Array([0x25, 0x50])), 'pdf'),
            /SIGNATURE_MISMATCH/);
    });

    test('an unreadable file is refused too, rather than waved through', async () => {
        const unreadable = { name: 'x.pdf', slice: () => ({ arrayBuffer: async () => { throw new Error('io'); } }) };
        await assert.rejects(() => assertFileSignature(unreadable, 'pdf'), /SIGNATURE_MISMATCH/);
    });

    test('a real PDF and a real DOCX both pass, each against its own signature', async () => {
        await assertFileSignature(fakeFile(PDF_BYTES), 'pdf');
        await assertFileSignature(fakeFile(DOCX_BYTES, 'x.docx'), 'docx');
        // ...and neither passes as the other.
        await assert.rejects(() => assertFileSignature(fakeFile(PDF_BYTES), 'docx'), /SIGNATURE_MISMATCH/);
        await assert.rejects(() => assertFileSignature(fakeFile(DOCX_BYTES, 'x.docx'), 'pdf'), /SIGNATURE_MISMATCH/);
    });
});

describe('what the three collections do differently', () => {

    test('a Huddle carries its converted HTML; a PDF Huddle carries no such key at all', async () => {
        const h = harness();
        await h.client.uploadHuddle('2026-09-01', fakeFile(DOCX_BYTES, 'h.docx'), 'G', '<p>plan</p>');
        assert.equal(h.store.get('huddles/2026-09-01').htmlContent, '<p>plan</p>');

        const h2 = harness();
        await h2.client.uploadHuddle('2026-09-02', fakeFile(PDF_BYTES), 'G');
        assert.ok(!('htmlContent' in h2.store.get('huddles/2026-09-02')),
            'absent, not null — the viewer branches on presence');
    });

    test('circular and newsletter prune; the Huddle does not (its retention is server-side)', async () => {
        const c = harness(); await c.client.uploadCircular('2026-09-01', fakeFile(PDF_BYTES), 'G');
        assert.ok(c.log.includes('pruned'));
        const n = harness(); await n.client.uploadNewsletter('2026-09-01', fakeFile(PDF_BYTES), 'G');
        assert.ok(n.log.includes('pruned'));
        const hd = harness(); await hd.client.uploadHuddle('2026-09-01', fakeFile(PDF_BYTES), 'G');
        assert.ok(!hd.log.includes('pruned'));
    });

    test('a row with no storageUrl reads as ABSENT — it points at nothing', async () => {
        const h = harness();
        // getDocs is overridden per-test: one doc, no storageUrl.
        const client = buildDocumentClient({
            db: {}, collections: { huddles: 'h', circulars: 'c', newsletters: 'n' },
            fs: {
                ...{ doc: () => ({}), getDoc: async () => ({ exists: () => false }), setDoc: async () => {},
                     onSnapshot: () => () => {}, runTransaction: async () => {}, serverTimestamp: () => 'TS',
                     where: () => ({}), collection: () => ({}), query: () => ({}), orderBy: () => ({}), limit: () => ({}) },
                getDocs: async () => ({ empty: false, docs: [{ id: 'x', data: () => ({ date: '2026-09-01' }) }] }),
            },
            getStorageSdk: async () => ({}), uploadBytesWithClaimRetry: async () => {},
            utils: { isDocxUpload: () => false, uploadMimeType: () => '', legacyDocPath: () => '', versionedDocPath: () => '' },
            resolveUploadCommit: () => 'retry', pruneOldDocs: async () => {},
        });
        assert.equal(await client.getLatestCircular(), null);
        assert.equal(await client.getLatestNewsletter(), null);
        assert.ok(h);
    });
});
