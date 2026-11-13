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
import { readFileSync } from 'node:fs';
import { buildDocumentClient, assertFileSignature } from './documents-client.js';
import { resolveUploadCommit } from './upload-commit.js';

const PDF_BYTES  = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31]);
const DOCX_BYTES = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00]);

/** A minimal stand-in for a browser File: `slice(...).arrayBuffer()`, `arrayBuffer()` and `name` are read. */
function fakeFile(bytes, name = 'x.pdf', type = 'application/pdf') {
    return {
        name, type,
        slice: (a, b) => ({ arrayBuffer: async () => bytes.slice(a, b).buffer }),
        arrayBuffer: async () => bytes.buffer,
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
    /** what each upload was handed — a Blob copy, never the picked File (v24.61) */
    const uploadedBodies = [];
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
        // The SERVER read a refused write is settled by (13 Nov 2026), apart from `getDoc` on
        // purpose: `liveAfterFailure` above can then play a cache still holding the record as it was
        // before the upload, which a refusal must never be judged by. `beforeServerRead` puts the
        // server where an interleaving leaves it; `serverReadThrows` makes the read fail.
        getDocFromServer: async (r) => {
            log.push('server-read');
            opts.beforeServerRead?.({ store, objects, deleted });
            if (opts.serverReadThrows) throw Object.assign(new Error('read'), { code: 'unavailable' });
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
        // A REAL transaction, because the CAS retry writes through it (v22.19). It was
        // `async () => {}` — a no-op that never called its callback — so the moment the retry moved
        // inside a transaction the write silently stopped happening and two tests failed for a
        // reason neither was about. `onTxRead` is the seam a competing writer lands in, which is the
        // interleaving the CAS exists for and which no ordering of real calls can force.
        runTransaction: async (_db, fn) => {
            // STAGED, then committed — a transaction's writes do not land until it commits, and
            // modelling that is what lets the same `setDocFails` injection fail a transactional
            // attempt the way it fails a plain one. Writing through `tx.set` directly made an
            // always-failing storage succeed on the retry, which broke a test about the ambiguous
            // branch for a reason that branch has nothing to do with.
            const staged = [];
            const out = await fn({
                get: async (r) => {
                    opts.onTxRead?.(store);          // a competing writer lands HERE
                    const v = store.get(r._key);
                    return { exists: () => v !== undefined, data: () => v };
                },
                set: (r, data) => { staged.push([r._key, data]); },
            });
            setDocCalls++;
            const err = opts.setDocFails?.(setDocCalls);
            if (err) { log.push(`tx-fail:${err}`); throw Object.assign(new Error('boom'), { code: err }); }
            for (const [k, d] of staged) store.set(k, d);
            log.push('tx-commit');
            return out;
        },
        serverTimestamp: () => 'TS',
    };

    const storageSdk = {
        storage: {},
        ref: (_s, path) => ({ path }),
        uploadBytes: async (r, data) => { objects.add(r.path); uploaded.push(r.path); uploadedBodies.push(data); },
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
        // The real client waits 2 s before re-reading after an ambiguous write; that pause proves
        // nothing here and cost two seconds per ambiguous-commit case (v24.28 review).
        sleep: async () => {},
        ...(opts.guardCommit ? { guardCommit: opts.guardCommit } : {}),
    });

    return { client, store, objects, deleted, uploaded, uploadedBodies, log, setDocCalls: () => setDocCalls };
}

describe('a live document must never point at a file that is not there', () => {

    test('the happy path writes the file, then the document that names it', async () => {
        const h = harness();
        const url = await h.client.uploadHuddle('2026-09-01', fakeFile(PDF_BYTES), 'G. Miller');
        assert.equal(h.uploadedBodies.length, 1);
        assert.ok(h.uploadedBodies[0] instanceof Blob, 'Storage is handed an in-memory Blob, not the picked File (iOS 26.5–27 sends a File body empty — WebKit 319985)');
        assert.deepEqual(new Uint8Array(await h.uploadedBodies[0].arrayBuffer()), PDF_BYTES, 'and it carries the file\'s bytes');
        assert.equal(h.uploadedBodies[0].type, 'application/pdf');
        const live = h.store.get('huddles/2026-09-01');
        assert.equal(h.uploaded.length, 1, 'exactly one object uploaded');
        assert.ok(h.objects.has(live.storagePath), 'the document names a file that exists');
        assert.ok(url.endsWith(live.storagePath));
        assert.deepEqual(h.deleted, [], 'nothing deleted — there was no previous file');
    });

    test('a DEFINITE non-commit rolls the new object back, and leaves the old file alone', async () => {
        // permission-denied is not retriable, and the server's record still names the old file: the
        // write certainly did not happen, so the bytes we just uploaded are certainly unreferenced and
        // must go. (A refusal whose record names OUR file is a different case — the block below.)
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

    test('a commit-AMBIGUOUS final failure leaves the file, because the document may name it — and is reported UNCONFIRMED', async () => {
        // Both attempts fail with a retriable code and the post-failure read says nothing is live.
        // Deleting here would 404 the document if the write lands late. An orphan is the cheap way
        // to be wrong; this is the asymmetry the whole rollback rule turns on.
        //
        // And what the admin is TOLD must match it (whole-app review, 10 Nov 2026): the engine keeps
        // the file because the document may be live, so the error it hands the card is
        // `upload/unconfirmed` — the "couldn't confirm" line — never the raw `unavailable`, which the
        // card reads as "Upload failed — please try again". The original rides on `cause`.
        const h = harness({ setDocFails: () => 'unavailable', liveAfterFailure: null });
        await assert.rejects(() => h.client.uploadHuddle('2026-09-01', fakeFile(PDF_BYTES), 'G'),
            (e) => /** @type {any} */ (e).code === 'upload/unconfirmed' && /** @type {any} */ (e).cause?.code === 'unavailable');
        assert.deepEqual(h.log, ['setDoc-fail:unavailable', 'tx-fail:unavailable'],
            'it is the compare-and-set RETRY that ended retriable — the state cal-docs-12 is about');
        assert.deepEqual(h.deleted, [], 'the new object is LEFT in place');
        assert.equal(h.uploaded.length, 1);
    });

    test('signed out mid-commit (v24.39): a SIGN-OUT, not a hang, and the new file is kept', async () => {
        // The commit's account went, so Firestore will never answer it — the watcher rejects in its
        // place. The write may still land when that admin signs back in, so nothing is rolled back.
        //
        // It keeps its own code (whole-app review, 10 Nov 2026). Renamed `upload/unconfirmed`, the
        // card said "the connection dropped mid-save" to somebody who needed to sign in again, and
        // the page's write gate — which counts only SIGNED_OUT_CODE — never heard of it.
        const { SIGNED_OUT_CODE } = await import('./claim-retry.js');
        const h = harness({ guardCommit: () => Promise.reject(Object.assign(new Error('gone'), { code: SIGNED_OUT_CODE })) });
        await assert.rejects(() => h.client.uploadHuddle('2026-09-01', fakeFile(PDF_BYTES), 'G'),
            (e) => /** @type {any} */ (e).code === SIGNED_OUT_CODE);
        assert.deepEqual(h.deleted, [], 'the new object is LEFT — the document may yet name it');
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

// ── THE RETRY IS A COMPARE-AND-SET (v22.19, external review) ────────────────────────────────────
//
// The reconciliation read closed the first TOCTOU: a `deadline-exceeded` can be raised AFTER the
// server committed, so the retry reads before re-issuing. But the read and the write are still two
// calls, and a competing upload can commit BETWEEN them — the same race, one step later. A blind
// second `setDoc` there overwrites their file reference with a Storage path their upload has
// already deleted, so the live document 404s behind the staff Huddle button and nothing errors.
//
// `onTxRead` runs the competitor at the exact instant between the transaction's read and its
// commit, which is the interleaving no ordering of real calls can force.
describe('the retry cannot overwrite somebody who committed while it was deciding', () => {

    test('THE BUG: a competitor landing inside the retry window is refused, not overwritten', async () => {
        const theirs = { storagePath: 'huddles/2026-09-01-THEIRS.pdf', fileType: 'pdf', uploadedBy: 'S. Silva' };
        const h = harness({
            setDocFails: n => (n === 1 ? 'unavailable' : null),
            liveAfterFailure: null,                       // the reconciliation read sees nothing live
            onTxRead: (store) => store.set('huddles/2026-09-01', theirs),   // …and now they commit
        });
        await assert.rejects(() => h.client.uploadHuddle('2026-09-01', fakeFile(PDF_BYTES), 'G. Miller'),
            /** @param {any} e */ (e) => e.code === 'upload/superseded');
        assert.deepEqual(h.store.get('huddles/2026-09-01'), theirs,
            'their document is untouched — ours must not overwrite a reference we never saw');
    });

    test('and our own object is rolled back, because the live document does not name it', async () => {
        const theirs = { storagePath: 'huddles/2026-09-01-THEIRS.pdf', fileType: 'pdf' };
        const h = harness({
            setDocFails: n => (n === 1 ? 'unavailable' : null),
            liveAfterFailure: null,
            onTxRead: (store) => store.set('huddles/2026-09-01', theirs),
        });
        await assert.rejects(() => h.client.uploadHuddle('2026-09-01', fakeFile(PDF_BYTES), 'G. Miller'));
        assert.equal(h.deleted.length, 1, 'the orphan goes — superseded is a DEFINITE non-commit');
        assert.ok(!h.deleted.includes(theirs.storagePath), 'and it is ours, never theirs');
    });

    test('our OWN write landing in the window is not re-written — not even its link', async () => {
        // The first attempt's commit arrives late, after the reconciliation read said nothing was
        // live. Re-issuing it is NOT harmless (13 Nov 2026): Operations → Document links may have
        // moved the record's link onto a new key in between, and writing our first link back would
        // leave it naming a key that run then took away. So a record already naming our path is ours,
        // whatever key it carries, and is left exactly as it is — the guard ingestHuddle's re-run has.
        // `let h` so the hook can read the path THIS upload generated — it carries a random suffix,
        // so the fixture cannot name it in advance.
        const rotated = 'https://example.invalid/after-replace?alt=media&token=rotated';
        /** @type {any} */ let h;
        h = harness({
            setDocFails: (/** @type {number} */ n) => (n === 1 ? 'unavailable' : null),
            liveAfterFailure: null,
            onTxRead: (/** @type {any} */ store) =>
                store.set('huddles/2026-09-01', { storagePath: h.uploaded[0], fileType: 'pdf', storageUrl: rotated }),
        });
        await h.client.uploadHuddle('2026-09-01', fakeFile(PDF_BYTES), 'G. Miller');
        const ourPath = h.uploaded[0];
        assert.equal(h.store.get('huddles/2026-09-01').storagePath, ourPath);
        assert.equal(h.store.get('huddles/2026-09-01').storageUrl, rotated, 'the retry wrote its first link back over a newer one');
        assert.deepEqual(h.deleted, [], 'nothing rolled back — it committed');
    });

    test('an uncontested retry still writes, through the transaction', async () => {
        // The gate is a gate, not a disablement — the counterpart to all three above.
        const h = harness({ setDocFails: n => (n === 1 ? 'unavailable' : null), liveAfterFailure: null });
        await h.client.uploadHuddle('2026-09-01', fakeFile(PDF_BYTES), 'G. Miller');
        assert.ok(h.store.get('huddles/2026-09-01'), 'the document lands');
        assert.deepEqual(h.deleted, [], 'and nothing is rolled back');
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

// ── A REFUSAL IS READ BEFORE IT IS BELIEVED (13 Nov 2026) ───────────────────────────────────────
//
// firestore.rules refuses a browser write that keeps a record's path and changes its link. So when
// our first write committed, its acknowledgement was lost, and Operations → Document links moved the
// record onto a new key before the SDK sent the write again, the re-send is refused — and the refusal
// arrives on OUR `setDoc`, as `permission-denied`. Taken at its word, that is a definite non-commit,
// and the rollback deletes the file the live record names: a 404 behind the staff Huddle button.
// `replaced()` is that world: by the time the server is read, the record names our path, with
// Replace's link.
describe('a refused write is settled by reading the SERVER, never by rolling back on its word', () => {
    const KEY = 'circulars/2026-09-01';
    const OLD = 'circulars/2026-09-01-old.pdf';
    const rotated = 'https://example.invalid/after-replace?alt=media&token=rotated';
    /** Our first send committed and Replace moved its link. `h` is read late: our path is random. */
    const replaced = (extra = {}) => {
        /** @type {any} */ let h;
        h = harness({
            docs: [[KEY, { storagePath: OLD, fileType: 'pdf', storageUrl: 'https://example.invalid/old' }]],
            objects: [OLD],
            setDocFails: () => 'permission-denied',
            beforeServerRead: ({ store }) => store.set(KEY, { storagePath: h.uploaded[0], fileType: 'pdf', storageUrl: rotated }),
            ...extra,
        });
        return h;
    };

    test('the server names OUR path: it was our commit — a success, our file kept, the superseded one swept', async () => {
        const h = replaced();
        const url = await h.client.uploadCircular('2026-09-01', fakeFile(PDF_BYTES), 'G. Miller');
        const ours = h.uploaded[0];
        assert.equal(url, `https://example.invalid/${ours}`, 'it resolves with the URL of the file it stored');
        assert.ok(h.objects.has(ours), 'our file is NOT rolled back — the live record names it');
        assert.deepEqual(h.deleted, [OLD], 'and the file it superseded is swept, as on any success');
        assert.equal(h.store.get(KEY).storageUrl, rotated, 'Replace\'s link stands');
        assert.ok(h.log.includes('pruned'), 'the post-commit sweep runs, as on any success');
        assert.equal(h.setDocCalls(), 1, 'and nothing is written again after a refusal');
    });

    test('the server names any other path: the refusal stands, and our file is rolled back', async () => {
        // Unchanged since we began (`retry`), and somebody else's (`superseded`): neither is ours.
        for (const live of [{ storagePath: OLD, fileType: 'pdf' }, { storagePath: 'circulars/2026-09-01-THEIRS.pdf', fileType: 'pdf' }]) {
            const h = harness({
                docs: [[KEY, { storagePath: OLD, fileType: 'pdf' }]],
                objects: [OLD],
                setDocFails: () => 'permission-denied',
                beforeServerRead: ({ store }) => store.set(KEY, live),
            });
            await assert.rejects(() => h.client.uploadCircular('2026-09-01', fakeFile(PDF_BYTES), 'G. Miller'),
                (/** @type {any} */ e) => e.code === 'permission-denied');
            assert.ok(h.log.includes('server-read'), 'the refusal was read first');
            assert.deepEqual(h.deleted, h.uploaded, `our orphan is rolled back (the server named ${live.storagePath})`);
            assert.ok(h.objects.has(OLD), 'and the old file survives');
            assert.equal(h.setDocCalls(), 1, 'and nothing is written again');
        }
    });

    test('the server cannot be read: UNCONFIRMED, and nothing is deleted', async () => {
        const h = replaced({ serverReadThrows: true });
        await assert.rejects(() => h.client.uploadCircular('2026-09-01', fakeFile(PDF_BYTES), 'G. Miller'),
            (/** @type {any} */ e) => e.code === 'upload/unconfirmed' && e.cause?.code === 'permission-denied');
        assert.deepEqual(h.deleted, [], 'our file may be the live one, so it stays — and so does the old one');
        assert.equal(h.setDocCalls(), 1, 'and nothing is written again');
    });

    test('it asks the SERVER: a cache still holding the record as it was before the upload is not consulted', async () => {
        // `liveAfterFailure` is what `getDoc` — which may answer from this device's cache — returns
        // once a write has failed: here, the record from before the upload. Settled from that, the
        // refusal would stand, and the rollback would delete the file the live record names.
        const h = replaced({ liveAfterFailure: { storagePath: OLD, fileType: 'pdf' } });
        await h.client.uploadCircular('2026-09-01', fakeFile(PDF_BYTES), 'G. Miller');
        assert.ok(h.log.includes('server-read'), 'the record was read from the server');
        assert.ok(h.objects.has(h.uploaded[0]), 'and our file, the live one, was kept');
    });

    // The fakes above hand the engine every Firestore function it takes, so one the PRODUCTION build
    // forgot would pass all of them — and fail quietly: an absent `getDocFromServer` throws inside the
    // refusal's read, which counts as a read that failed, so a genuine refusal would be reported
    // unconfirmed and its file kept. firebase-client.js cannot run an upload in Node (it has no Storage
    // fake), so what it hands over is read as text.
    test('firebase-client.js hands the engine every Firestore function the engine takes', () => {
        const engine = readFileSync(new URL('./documents-client.js', import.meta.url), 'utf8');
        const wanted = /const \{([^}]*)\} = fs;/.exec(engine)?.[1].split(',').map(s => s.trim()).filter(Boolean) ?? [];
        assert.ok(wanted.includes('getDocFromServer') && wanted.length >= 10, `could not read what the engine takes: ${wanted}`);
        const client = readFileSync(new URL('./firebase-client.js', import.meta.url), 'utf8');
        const built = /buildDocumentClient\(\{[\s\S]*?\bfs: \{([^}]*)\}/.exec(client)?.[1].split(',').map(s => s.trim()).filter(Boolean);
        assert.ok(built, 'could not find the `fs` firebase-client.js hands to buildDocumentClient');
        assert.deepEqual(wanted.filter(n => !built.includes(n)), [], 'firebase-client.js does not hand the engine these');
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

// ── ONLY THE SERVER CAN SAY "NONE" (whole-app review, 10 Nov 2026) ──────────────────────────────────
// Offline, `getDocs` resolves from the device's cache, and an EMPTY cache said "No Weekly Retail
// Circular has been uploaded yet" in the drawer and the viewer alike — the exact false claim the Huddle
// viewer was fixed for. Both callers already answer a rejection with "couldn't connect" and a retry.
describe('the latest Circular or Newsletter: an empty cache is not "none uploaded"', () => {
    /** A client whose one-shot read answers with `snap`. */
    const reading = (snap) => buildDocumentClient({
        db: {}, collections: { huddles: 'h', circulars: 'c', newsletters: 'n' },
        fs: { doc: () => ({}), getDoc: async () => ({ exists: () => false }), setDoc: async () => {}, onSnapshot: () => () => {},
              runTransaction: async () => {}, serverTimestamp: () => 'TS', where: () => ({}), collection: () => ({}),
              query: () => ({}), orderBy: () => ({}), limit: () => ({}), getDocs: async () => snap },
        getStorageSdk: async () => ({}), uploadBytesWithClaimRetry: async () => {},
        utils: { isDocxUpload: () => false, uploadMimeType: () => '', legacyDocPath: () => '', versionedDocPath: () => '' },
        resolveUploadCommit: () => 'retry', pruneOldDocs: async () => {},
    });

    test('an EMPTY answer from this device\'s cache alone is a read that failed', async () => {
        const client = reading({ empty: true, docs: [], metadata: { fromCache: true } });
        for (const read of [client.getLatestCircular, client.getLatestNewsletter]) {
            await assert.rejects(read, (/** @type {any} */ e) => e.code === 'documents/cache-only-empty',
                'an offline device was told nothing has been uploaded');
        }
    });

    test('…and a CONNECTION failure, not an access one — the drawer says "check your signal", never "signed out"', async () => {
        // nav-panel.js words a rejection by `isAccessFailure`: true is "you may have been signed out",
        // false is "Couldn't connect — check your signal". An empty offline cache is the second.
        const { isAccessFailure } = await import('./claim-retry.js');
        const client = reading({ empty: true, docs: [], metadata: { fromCache: true } });
        const err = await client.getLatestCircular().then(() => null, e => e);
        assert.ok(err, 'it rejected');
        assert.equal(isAccessFailure(err), false);
    });

    test('the SERVER\'s empty answer is "none uploaded" — the gate is a gate, not a disablement', async () => {
        const client = reading({ empty: true, docs: [], metadata: { fromCache: false } });
        assert.equal(await client.getLatestCircular(), null);
        assert.equal(await client.getLatestNewsletter(), null);
    });

    test('a document the cache DOES hold is still returned — a saved copy is a copy, not a failure', async () => {
        const row = { date: '2026-11-06', storageUrl: 'https://example.invalid/c.pdf', fileType: 'pdf' };
        const client = reading({ empty: false, docs: [{ id: 'x', data: () => row }], metadata: { fromCache: true } });
        assert.deepEqual(await client.getLatestCircular(), row);
    });
});
