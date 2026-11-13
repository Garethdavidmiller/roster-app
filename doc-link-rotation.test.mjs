// @ts-check
/**
 * doc-link-rotation.test.mjs — the rotation of the documents' permanent links
 * (functions/doc-link-rotation.js; ARCHITECTURE.md EXC-007), against a fake bucket that keeps each
 * file's keys and a fake Firestore that keeps each record's stored link.
 * Run (no mocks): node scripts/run-tests.mjs doc-link-rotation.test.mjs
 *
 * Organised by what a wrong answer COSTS, and the costs point opposite ways:
 *  - A STORED LINK THAT STOPS WORKING is the member-facing one: the stored link is the fallback a
 *    member is handed when a 15-minute link cannot be fetched, so a dead one is a document that will
 *    not open. The three-step order exists to prevent it, and the test that guards it checks the
 *    invariant after EVERY write rather than at the end, because the end state looks the same
 *    whichever order the steps ran in.
 *  - AN OLD LINK THAT STILL WORKS is the whole point failing quietly: the run reports success and
 *    the forwarded link still opens the file.
 *  - A WRITE NOBODY ASKED FOR: a preview that changes something, a record rewritten under an upload
 *    that moved it, a link this code cannot read being "fixed", a file deleted.
 * The fakes RECORD every write in one ordered log; a fake that discarded them could assert nothing
 * about order, which is the property that matters most here. And the fake bucket behaves as Cloud
 * Storage does where it matters: every file has a generation (a new upload) and a metageneration (a
 * metadata write), a write that names the wrong one is refused with 412, and a write that names
 * NEITHER is refused too — so a run that forgot its compare-and-set fails here, not on the live files.
 * It also reports each file's `timeCreated`, and models an upload the way BOTH uploaders write one —
 * a NEW path, the file and its key first, the record after. Modelling uploads only as a new version at
 * the same path hid the case where a run switched off a brand-new file's only key (review, 13 Nov
 * 2026). And it models the two retries of a write whose answer was lost: the storage library's,
 * refused with 412, and Firestore's, which runs the whole transaction again.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { rotateDocumentLinks, downloadUrl, pathOfDownloadUrl, keysOf, TOKEN_KEY, UNLINKED_MIN_AGE_MS } =
    require('./functions/doc-link-rotation.js');

const BUCKET = 'myb-roster.appspot.com';
/** @param {string} path @param {string} key */
const link = (path, key) => downloadUrl(BUCKET, path, key);
/** The key a stored link carries. @param {string} url */
const keyOfLink = (url) => new URL(url).searchParams.get('token');
/** The moment the tests that care about age run at. */
const NOW = Date.parse('2026-11-13T12:00:00.000Z');
/** When a seeded file was created, as GCS reports it: long before any run, so old enough to clear. */
const SEEDED = '2026-01-01T00:00:00.000Z';

/**
 * A world: files with their keys, records with their stored links, and one ordered log of writes.
 * After EVERY write it checks the invariant the three steps exist for — every record whose file
 * exists can still open it — and keeps any breach, so a test can assert there was none at any moment.
 * Each file has the `timeCreated` GCS reports (SEEDED unless `created` says otherwise; `null` reports
 * none), because an unused file's age decides whether it may lose its key.
 * The hooks that model what the real libraries do: `lostAnswer` lands a key write and then refuses it
 * with 412, as the storage library's retry of a write whose answer was lost is refused; `lostCommit`
 * commits a transaction and then runs it again, as Firestore does when a commit's answer is lost; and
 * `onRecordsRead` runs as each collection is read, before it answers (`nth` counts that collection's
 * reads from 1), so a test can land an upload mid-run or fail one read. `listed` is what the listing
 * reports as a file's `metadata`, as the storage library attaches it; unset, a listed file has none.
 * @param {{ files: Record<string, string[]|null>, records: Record<string, any>,
 *           created?: Record<string, string|null>,
 *           failSet?: (path: string, value: any) => boolean, failGet?: (path: string) => boolean,
 *           failTx?: (path: string) => boolean, onTxGet?: (path: string, store: Map<string, any>) => void,
 *           beforeSet?: (path: string, value: any) => void, failList?: boolean,
 *           onGet?: (path: string) => void, lostAnswer?: (path: string, value: any) => boolean,
 *           lostCommit?: (path: string) => boolean, onRecordsRead?: (name: string, nth: number) => void,
 *           listed?: (path: string) => any }} opts
 */
function world({ files, records, created = {}, failSet, failGet, failTx, onTxGet, beforeSet, failList,
    onGet, lostAnswer, lostCommit, onRecordsRead, listed }) {
    /** @type {Map<string, Record<string, string>>} path → custom metadata */
    const meta = new Map(Object.entries(files).map(([p, keys]) =>
        [p, keys ? { [TOKEN_KEY]: keys.join(','), other: 'kept' } : { other: 'kept' }]));
    /** @type {Map<string, { generation: number, metageneration: number }>} */
    const gen = new Map([...meta.keys()].map((p, i) => [p, { generation: 1000 + i, metageneration: 1 }]));
    /** @type {Map<string, string|null>} path → timeCreated, or null for a file whose age is not reported */
    const born = new Map([...meta.keys()].map(p => [p, created[p] === undefined ? SEEDED : created[p]]));
    const store = new Map(Object.entries(records));
    /** @type {Map<string, number>} */
    const reads = new Map();
    /** @type {{ kind: 'set'|'update', path: string, value: any }[]} */
    const log = [];
    /** @type {string[]} */
    const breaches = [];

    const keysNow = (/** @type {string} */ p) => keysOf({ metadata: meta.get(p) });
    const checkInvariant = (/** @type {string} */ after) => {
        for (const [rp, data] of store) {
            const fp = pathOfDownloadUrl(data && data.storageUrl, BUCKET);
            if (!fp || !meta.has(fp)) continue;
            const was = (records[rp] || {}).storageUrl;
            // Only a link that opened its file at the start owes it to the end of the run.
            if (pathOfDownloadUrl(was, BUCKET) !== fp || !keysOf({ metadata: Object.fromEntries(
                [[TOKEN_KEY, (files[fp] || []).join(',')]]) }).includes(keyOfLink(was) || '')) continue;
            if (!keysNow(fp).includes(keyOfLink(data.storageUrl) || '')) breaches.push(`${rp} dead after ${after}`);
        }
    };

    const resource = (/** @type {string} */ path) => {
        const t = born.get(path);
        return { name: path, ...gen.get(path), ...(t ? { timeCreated: t } : {}), metadata: { ...(meta.get(path) || {}) } };
    };
    /**
     * A new upload at `path`, object and record together, as the uploaders do: a new generation, its
     * own key, and the record moved onto it. A null key is a copy made outside the app, which carries none.
     * @param {string} path @param {string|null} key @param {string} [recordPath]
     */
    const reupload = (path, key, recordPath) => {
        meta.set(path, key ? { [TOKEN_KEY]: key, other: 'kept' } : { other: 'kept' });
        gen.set(path, { generation: (gen.get(path)?.generation ?? 0) + 7, metageneration: 1 });
        born.set(path, new Date(NOW).toISOString());
        if (recordPath && key) store.set(recordPath, { ...store.get(recordPath), storageUrl: link(path, key) });
    };
    /**
     * Somebody else's key write on the SAME object — a second run's, say: a new metageneration, the
     * generation unchanged. @param {string} path @param {string[]} keys
     */
    const otherWrite = (path, keys) => {
        const g = /** @type {{ generation: number, metageneration: number }} */ (gen.get(path));
        meta.set(path, { ...(meta.get(path) || {}), [TOKEN_KEY]: keys.join(',') });
        gen.set(path, { ...g, metageneration: g.metageneration + 1 });
    };
    /**
     * A new upload as BOTH uploaders really write one: a NEW path, and the file with its key saved
     * first — ingestHuddle saves it and sets its key, the Operations card's upload is given one — with
     * the record still to come. The record is the test's to write, when the uploader would.
     * @param {string} path @param {string} key @param {number} [at]  when the file was saved (default NOW)
     */
    const upload = (path, key, at = NOW) => {
        assert.ok(!meta.has(path), `an upload never reuses a path: ${path}`);
        meta.set(path, { [TOKEN_KEY]: key, other: 'kept' });
        gen.set(path, { generation: 5000 + gen.size, metageneration: 1 });
        born.set(path, new Date(at).toISOString());
    };
    const file = (/** @type {string} */ path) => ({
        name: path,
        getMetadata: async () => {
            onGet?.(path);
            if (failGet?.(path)) throw new Error('read failed');
            return [resource(path)];
        },
        setMetadata: async (/** @type {{ metadata: Record<string, any> }} */ { metadata }, /** @type {any} */ opts) => {
            beforeSet?.(path, metadata[TOKEN_KEY]);
            if (failSet?.(path, metadata[TOKEN_KEY])) throw new Error('write failed');
            const g = gen.get(path);
            if (!opts || opts.ifGenerationMatch === undefined || opts.ifMetagenerationMatch === undefined) {
                throw new Error('a key written with no compare-and-set');
            }
            if (!g || opts.ifGenerationMatch !== g.generation || opts.ifMetagenerationMatch !== g.metageneration) {
                throw Object.assign(new Error('Precondition Failed'), { code: 412 });
            }
            const cur = { ...(meta.get(path) || {}) };
            for (const [k, v] of Object.entries(metadata)) { if (v === null) delete cur[k]; else cur[k] = v; }
            meta.set(path, cur);
            gen.set(path, { ...g, metageneration: g.metageneration + 1 });
            log.push({ kind: 'set', path, value: metadata[TOKEN_KEY] });
            checkInvariant(`set ${path}`);
            // The write landed; its answer did not, and the library's retry — still naming the
            // metageneration this write moved past — is refused.
            if (lostAnswer?.(path, metadata[TOKEN_KEY])) throw Object.assign(new Error('Precondition Failed'), { code: 412 });
            return [resource(path)];
        },
    });
    const bucket = {
        name: BUCKET,
        getFiles: async (/** @type {{ prefix: string }} */ { prefix }) => {
            if (failList) throw new Error('list failed');
            return [[...meta.keys()].filter(p => p.startsWith(prefix))
                .map(p => (listed ? Object.assign(file(p), { metadata: listed(p) }) : file(p)))];
        },
    };
    const snapOf = (/** @type {string} */ p) => ({
        exists: store.has(p), id: p.split('/')[1], ref: { path: p },
        data: () => (store.has(p) ? { ...store.get(p) } : undefined),
    });
    /** One attempt at a transaction: run it, then commit what it staged. @param {(tx: any) => Promise<any>} fn */
    const attempt = async (fn) => {
        /** @type {[string, any][]} */
        const staged = [];
        const result = await fn({
            get: async (/** @type {{ path: string }} */ ref) => {
                if (failTx?.(ref.path)) throw new Error('transaction failed');
                onTxGet?.(ref.path, store);
                return snapOf(ref.path);
            },
            update: (/** @type {{ path: string }} */ ref, /** @type {any} */ data) => { staged.push([ref.path, data]); },
        });
        for (const [p, d] of staged) {
            store.set(p, { ...store.get(p), ...d });
            log.push({ kind: 'update', path: p, value: d.storageUrl });
            checkInvariant(`update ${p}`);
        }
        return { result, staged };
    };
    const db = {
        collection: (/** @type {string} */ name) => ({
            get: async () => {
                reads.set(name, (reads.get(name) ?? 0) + 1);
                onRecordsRead?.(name, /** @type {number} */ (reads.get(name)));
                return { docs: [...store.keys()].filter(p => p.startsWith(`${name}/`)).map(snapOf) };
            },
        }),
        runTransaction: async (/** @type {(tx: any) => Promise<any>} */ fn) => {
            const first = await attempt(fn);
            // The commit landed and its answer was lost: Firestore runs the whole transaction again.
            if (first.staged.some(([p]) => lostCommit?.(p))) return (await attempt(fn)).result;
            return first.result;
        },
    };
    let n = 0;
    const newKey = () => `key-${++n}`;
    return { bucket, db, newKey, meta, store, log, breaches, keysNow, reupload, upload, otherWrite };
}

/** The ordinary world: one of each kind, each record opening its own file with its own old key. */
const ORDINARY = () => ({
    files: {
        'huddles/2026-11-12-a1.pdf': ['old-h'],
        'circulars/2026-11-06-b2.docx': ['old-c'],
        'newsletters/2026-11-01-c3.pdf': ['old-n'],
    },
    records: {
        'huddles/2026-11-12': { date: '2026-11-12', storagePath: 'huddles/2026-11-12-a1.pdf', storageUrl: link('huddles/2026-11-12-a1.pdf', 'old-h') },
        'circulars/2026-11-06': { date: '2026-11-06', storagePath: 'circulars/2026-11-06-b2.docx', storageUrl: link('circulars/2026-11-06-b2.docx', 'old-c') },
        'newsletters/2026-11-01': { date: '2026-11-01', storagePath: 'newsletters/2026-11-01-c3.pdf', storageUrl: link('newsletters/2026-11-01-c3.pdf', 'old-n') },
    },
});

describe('the link the app stores is the link this code reads', () => {
    test('downloadUrl and pathOfDownloadUrl round-trip, slashes and spaces included', () => {
        for (const p of ['huddles/2026-11-12-a1.pdf', 'circulars/2026 11 06 copy.docx', 'newsletters/x/y.pdf']) {
            assert.equal(pathOfDownloadUrl(link(p, 'k'), BUCKET), p);
        }
    });

    test('anything that is not a download link into THIS bucket reads as null', () => {
        const p = encodeURIComponent('huddles/a.pdf');
        for (const url of [
            `https://firebasestorage.googleapis.com/v0/b/another-bucket/o/${p}?alt=media&token=k`,
            `http://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${p}?alt=media&token=k`,
            `https://evil.example/v0/b/${BUCKET}/o/${p}?alt=media&token=k`,
            `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/huddles/a.pdf?alt=media&token=k`,
            `https://storage.googleapis.com/${BUCKET}/huddles/a.pdf`,
            'not a url', '', null, undefined, 42,
        ]) assert.equal(pathOfDownloadUrl(url, BUCKET), null, String(url));
    });

    test('keysOf reads the comma-separated list Firebase keeps, and nothing else', () => {
        assert.deepEqual(keysOf({ metadata: { [TOKEN_KEY]: 'a, b,,c' } }), ['a', 'b', 'c']);
        assert.deepEqual(keysOf({ metadata: {} }), []);
        assert.deepEqual(keysOf({}), []);
        assert.deepEqual(keysOf(undefined), []);
    });
});

describe('a preview changes nothing — and counts what a run would touch', () => {
    test('without rotate: true there is not one write, whatever the world holds', async () => {
        for (const rotate of [false, undefined, 'true', 1, {}]) {
            const w = world(ORDINARY());
            const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: /** @type {any} */ (rotate) });
            assert.equal(r.rotate, false, `${JSON.stringify(rotate)} was taken as a real run`);
            assert.deepEqual(w.log, [], `${JSON.stringify(rotate)} wrote something`);
            assert.equal(r.files, 3);
            assert.equal(r.linked, 3);
            assert.equal(r.rotated, 0);
        }
    });

    test('every kind of file and record is counted in its own box', async () => {
        const w = world({
            files: {
                'huddles/2026-11-12-a1.pdf': ['old-h'],
                'huddles/2026-11-10-late.pdf': null,              // its record's key is no longer on it
                'huddles/2026-08-01-old.pdf': ['old-x'],          // no record points at it, still has a key
                'circulars/2026-11-13-new.pdf': ['new-k'],        // …and so does this, saved an hour ago
                'circulars/2026-05-01-gone.pdf': null,            // no record, already without a key
                'newsletters/2026-09-01-odd.pdf': ['odd-k'],      // only a link this cannot read opens it
            },
            created: { 'circulars/2026-11-13-new.pdf': new Date(NOW - 60 * 60 * 1000).toISOString() },
            records: {
                'huddles/2026-11-12': { storageUrl: link('huddles/2026-11-12-a1.pdf', 'old-h') },
                'huddles/2026-11-10': { storageUrl: link('huddles/2026-11-10-late.pdf', 'gone') },  // a dead link
                'huddles/2026-11-11': { storageUrl: link('huddles/2026-11-11-zz.pdf', 'k') },   // its file is not there
                'circulars/2026-11-06': { storageUrl: link('huddles/2026-11-12-a1.pdf', 'dead') },  // another kind's folder
                'newsletters/2026-11-01': { storageUrl: 'https://example.com/n.pdf' },          // not a download link
                'newsletters/2026-09-01': { storageUrl: 'https://cdn.example.com/n.pdf?alt=media&token=odd-k' },
                'newsletters/2026-10-01': { storagePath: 'newsletters/2026-10-01.pdf' },       // no stored link at all
            },
        });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, nowMs: NOW });
        assert.deepEqual(
            { files: r.files, linked: r.linked, unlinkedWithKey: r.unlinkedWithKey, unlinkedTooNew: r.unlinkedTooNew,
              unlinkedWithoutKey: r.unlinkedWithoutKey, held: r.held, recordsDeadLink: r.recordsDeadLink,
              recordsMissingFile: r.recordsMissingFile, recordsUnreadable: r.recordsUnreadable, recordsWithoutLink: r.recordsWithoutLink },
            { files: 6, linked: 2, unlinkedWithKey: 1, unlinkedTooNew: 1, unlinkedWithoutKey: 1, held: 1, recordsDeadLink: 1,
              recordsMissingFile: 1, recordsUnreadable: 3, recordsWithoutLink: 1 });
        assert.deepEqual(w.log, []);
    });
});

describe('a run: every old link stops working, and the stored link never does', () => {
    test('each linked file ends with ONLY its new key, and its record opens it with that key', async () => {
        const w = world(ORDINARY());
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.equal(r.rotate, true);
        assert.equal(r.rotated, 3);
        assert.deepEqual(r.failed, []);
        for (const [rp, data] of w.store) {
            const fp = /** @type {string} */ (pathOfDownloadUrl(data.storageUrl, BUCKET));
            const keys = w.keysNow(fp);
            assert.equal(keys.length, 1, `${fp} kept ${keys.join(',')}`);
            assert.equal(keyOfLink(data.storageUrl), keys[0], `${rp}'s stored link does not open its file`);
            assert.ok(!keys[0].startsWith('old-'), `${fp} still answers its old link`);
            assert.equal(w.meta.get(fp)?.other, 'kept', 'a run touched metadata that is not the key');
        }
    });

    test('guard the guard — the moment check sees a stored link go dead', async () => {
        // The obvious two-step version's first move: swap the key before the record. If the world's
        // check could not see THIS, the test below would pass over the very fault it exists for.
        const w = world(ORDINARY());
        const [[file]] = await w.bucket.getFiles({ prefix: 'huddles/' });
        const [m] = await file.getMetadata();
        await file.setMetadata({ metadata: { [TOKEN_KEY]: 'only-new' } },
            { ifGenerationMatch: m.generation, ifMetagenerationMatch: m.metageneration });
        assert.deepEqual(w.breaches, ['huddles/2026-11-12 dead after set huddles/2026-11-12-a1.pdf']);
    });

    test('at NO moment does a stored link point at a key its file no longer has (expand, migrate, contract)', async () => {
        const w = world(ORDINARY());
        await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.deepEqual(w.breaches, [], 'a stored link was dead between two steps');
        // And the order itself, file by file: old+new, then the record, then new only.
        for (const fp of Object.keys(ORDINARY().files)) {
            const mine = w.log.filter(e => e.path === fp || (e.kind === 'update' && pathOfDownloadUrl(e.value, BUCKET) === fp));
            assert.deepEqual(mine.map(e => e.kind), ['set', 'update', 'set'], fp);
            const [expand, migrate, contract] = mine;
            const fresh = keyOfLink(migrate.value);
            assert.equal(expand.value, `${ORDINARY().files[fp]?.[0]},${fresh}`, `${fp}: the first step dropped the old key`);
            assert.equal(contract.value, fresh, `${fp}: the last step kept an old key`);
        }
    });

    test('every file gets a key of its OWN — one link never opens another file', async () => {
        const w = world(ORDINARY());
        await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        const keys = [...w.store.values()].map(d => keyOfLink(d.storageUrl));
        assert.equal(new Set(keys).size, keys.length, `a key was reused: ${keys.join(', ')}`);
    });

    test('a file no record points at LOSES its key, gets none, and is not deleted', async () => {
        const w = world({ files: { 'huddles/2026-08-01-old.pdf': ['old-x', 'old-y'] }, records: {} });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.equal(r.cleared, 1);
        assert.deepEqual(w.keysNow('huddles/2026-08-01-old.pdf'), []);
        assert.ok(w.meta.has('huddles/2026-08-01-old.pdf'), 'the file went');
        assert.equal(w.meta.get('huddles/2026-08-01-old.pdf')?.other, 'kept');
    });

    test('running it again is safe: another key, the record follows, nothing is lost', async () => {
        const w = world(ORDINARY());
        await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        const first = [...w.store.values()].map(d => keyOfLink(d.storageUrl));
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.equal(r.rotated, 3);
        for (const [rp, d] of w.store) {
            const fp = /** @type {string} */ (pathOfDownloadUrl(d.storageUrl, BUCKET));
            assert.deepEqual(w.keysNow(fp), [keyOfLink(d.storageUrl)], rp);
            assert.ok(!first.includes(keyOfLink(d.storageUrl)), `${rp} kept the first run's key`);
        }
        assert.deepEqual(w.breaches, []);
    });

    test('two records on one file both move to its new key', async () => {
        const shared = 'circulars/2026-11-06-b2.docx';
        const w = world({ files: { [shared]: ['old'] }, records: {
            'circulars/2026-11-06': { storageUrl: link(shared, 'old') },
            'circulars/2026-11-07': { storageUrl: link(shared, 'old') },
        } });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.equal(r.rotated, 1);
        const [only] = w.keysNow(shared);
        for (const d of w.store.values()) assert.equal(keyOfLink(d.storageUrl), only);
    });
});

describe('a write nobody asked for', () => {
    test('a record an upload moved mid-run is not rewritten, and its old file keeps its keys', async () => {
        const fp = 'huddles/2026-11-12-a1.pdf';
        const moved = link('huddles/2026-11-12-NEW.pdf', 'upload-key');
        const w = world({ files: { [fp]: ['old-h'] }, records: { 'huddles/2026-11-12': { storageUrl: link(fp, 'old-h') } },
            // The re-upload lands between the listing and the record's transaction.
            onTxGet: (p, store) => { if (p === 'huddles/2026-11-12') store.set(p, { storageUrl: moved }); } });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.equal(r.changedDuringRun, 1);
        assert.equal(r.rotated, 0);
        assert.equal(w.store.get('huddles/2026-11-12').storageUrl, moved, 'the upload\'s fresh link was overwritten');
        assert.ok(w.keysNow(fp).includes('old-h'), 'the file was contracted under a record that had left it');
    });

    test('a link this code cannot read, a link into another kind\'s folder and a missing link are never written', async () => {
        const odd = {
            'circulars/2026-11-06': { storageUrl: link('huddles/2026-11-12-a1.pdf', 'old-h') },
            'newsletters/2026-11-01': { storageUrl: 'https://example.com/n.pdf' },
            'newsletters/2026-10-01': { storagePath: 'newsletters/2026-10-01.pdf' },
        };
        const w = world({ files: { 'huddles/2026-11-12-a1.pdf': ['old-h'] }, records: { ...odd } });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        for (const [p, data] of Object.entries(odd)) assert.deepEqual(w.store.get(p), data, p);
        // No huddles record opens that file, so it looks unused — but the circulars record's link does
        // open it, and switching its key off would break the very link this promised to leave alone.
        assert.equal(r.held, 1);
        assert.deepEqual(w.keysNow('huddles/2026-11-12-a1.pdf'), ['old-h']);
        assert.deepEqual(w.log, []);
    });

    test('a link this cannot read HOLDS the file it may open — another bucket name, another host', async () => {
        const FP = 'huddles/2026-11-12-a1.pdf';
        const otherBucket = `https://firebasestorage.googleapis.com/v0/b/myb-roster.firebasestorage.app/o/${encodeURIComponent(FP)}?alt=media&token=old-h`;
        // One record reads cleanly and one does not, both on the same file: rotating it would move the
        // first and strand the second, so the file is not touched at all.
        const w = world({
            files: { [FP]: ['old-h'], 'circulars/2026-11-06-b2.docx': ['old-c'] },
            records: {
                'huddles/2026-11-12': { storageUrl: link(FP, 'old-h') },
                'huddles/2026-11-13': { storageUrl: otherBucket },
                'circulars/2026-11-06': { storageUrl: link('circulars/2026-11-06-b2.docx', 'old-c') },
            },
        });
        const preview = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey });
        assert.deepEqual({ held: preview.held, linked: preview.linked, recordsUnreadable: preview.recordsUnreadable },
            { held: 1, linked: 1, recordsUnreadable: 1 });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.equal(r.rotated, 1, 'the file nothing holds still rotates');
        assert.deepEqual(w.keysNow(FP), ['old-h']);
        assert.equal(w.store.get('huddles/2026-11-12').storageUrl, link(FP, 'old-h'));
        assert.equal(w.store.get('huddles/2026-11-13').storageUrl, otherBucket);
        assert.ok(w.log.every(e => e.path.startsWith('circulars/')), JSON.stringify(w.log));
        assert.deepEqual(w.breaches, []);
    });

    test('a record whose file is missing is counted and left alone', async () => {
        const rec = { storageUrl: link('huddles/2026-11-11-zz.pdf', 'k') };
        const w = world({ files: {}, records: { 'huddles/2026-11-11': { ...rec } } });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.equal(r.recordsMissingFile, 1);
        assert.deepEqual(w.store.get('huddles/2026-11-11'), rec);
        assert.deepEqual(w.log, []);
    });
});

describe('every write is a compare-and-set: an upload landing mid-run is never overwritten', () => {
    const FP = 'huddles/2026-11-12-a1.pdf';
    const REC = 'huddles/2026-11-12';

    /** @param {(path: string, value: any, w: ReturnType<typeof world>) => void} when */
    const raced = async (when) => {
        /** @type {ReturnType<typeof world>} */
        let w;
        w = world({ ...ORDINARY(), beforeSet: (p, v) => when(p, v, w) });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        return { w, r };
    };
    /** Fires once. @param {(p: string, v: any) => boolean} test @param {(w: any) => void} act */
    const once = (test, act) => { let done = false; return (/** @type {string} */ p, /** @type {any} */ v, /** @type {any} */ w) => {
        if (!done && test(p, v)) { done = true; act(w); }
    }; };

    test('a new upload between the read and the first write: that file is left to the upload', async () => {
        const { w, r } = await raced(once((p, v) => p === FP && String(v).includes(','), (w) => w.reupload(FP, 'upload-key', REC)));
        assert.equal(r.changedDuringRun, 1);
        assert.deepEqual(r.failed, []);
        assert.deepEqual(w.keysNow(FP), ['upload-key']);
        assert.equal(w.store.get(REC).storageUrl, link(FP, 'upload-key'));
        assert.equal(r.rotated, 2);
        assert.deepEqual(w.breaches, []);
    });

    test('a new upload between the record and the last write: the upload\'s key survives', async () => {
        const { w, r } = await raced(once((p, v) => p === FP && v && !String(v).includes(','), (w) => w.reupload(FP, 'upload-key', REC)));
        assert.equal(r.changedDuringRun, 1);
        assert.deepEqual(w.keysNow(FP), ['upload-key'], 'the contract wrote over the upload');
        assert.equal(w.store.get(REC).storageUrl, link(FP, 'upload-key'));
        assert.deepEqual(w.breaches, []);
    });

    test('a record given a new link at the SAME path mid-run is not rewritten', async () => {
        // The object and the record both changed, path unchanged: only the exact link, token and all,
        // tells this record apart from the one that was read.
        const w = world({ ...ORDINARY(), onTxGet: (p) => { if (p === REC) w.reupload(FP, 'upload-key', REC); } });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.equal(r.changedDuringRun, 1);
        assert.equal(w.store.get(REC).storageUrl, link(FP, 'upload-key'));
        assert.deepEqual(w.keysNow(FP), ['upload-key']);
        assert.deepEqual(w.breaches, []);
    });

    test('a file deleted mid-run (a re-upload replaced it) is a change, not a failure', async () => {
        const w = world({ ...ORDINARY(), failSet: (p) => {
            if (p !== FP) return false;
            throw Object.assign(new Error('No such object'), { code: 404 });
        } });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.equal(r.changedDuringRun, 1);
        assert.deepEqual(r.failed, []);
        assert.equal(r.rotated, 2);
    });

    test('an unused file given a new upload before it is cleared keeps the upload\'s key', async () => {
        const ORPHAN = 'huddles/2026-08-01-old.pdf';
        /** @type {ReturnType<typeof world>} */
        let w;
        const fire = once((p, v) => p === ORPHAN && v === null, (x) => x.reupload(ORPHAN, 'fresh', 'huddles/2026-08-01'));
        w = world({ files: { [ORPHAN]: ['old-x'] }, records: {}, beforeSet: (p, v) => fire(p, v, w) });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.equal(r.cleared, 0);
        assert.equal(r.changedDuringRun, 1);
        assert.deepEqual(w.keysNow(ORPHAN), ['fresh']);
    });
});

describe('an upload in flight is not an unused file: a NEW path, its file and key first, its record after', () => {
    // Both uploaders write this shape — ingestHuddle saves the file and sets its key, converts a Word
    // Huddle, then writes the record; the Operations card's file is given its key on upload and the
    // record is saved after — so until the record lands, a new file looks exactly like an abandoned
    // one. The tests above model an upload as a new version at the SAME path, which a run already
    // refused to overwrite; this is the shape they could not see.
    const NEW = 'huddles/2026-11-13-ab12.pdf';
    const REC = 'huddles/2026-11-13';

    test('a file that lands after the records are read keeps its key, so its record — written after — opens it', async () => {
        /** @type {ReturnType<typeof world>} */
        let w;
        w = world({ ...ORDINARY(), onRecordsRead: (name, nth) => { if (name === 'huddles' && nth === 1) w.upload(NEW, 'fresh'); } });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true, nowMs: NOW + 5000 });
        // The uploader's record, as both write it: unconditionally, with the key the file was given.
        w.store.set(REC, { date: '2026-11-13', storagePath: NEW, storageUrl: link(NEW, 'fresh') });
        assert.deepEqual(w.keysNow(NEW), ['fresh'], 'the new record holds a dead link');
        assert.equal(r.cleared, 0);
        assert.equal(r.unlinkedTooNew, 1, 'a file left with its key is said, not hidden behind a clean report');
        assert.equal(r.rotated, 3, 'the files in use rotate as ever');
        assert.deepEqual(r.failed, []);
        assert.deepEqual(w.breaches, []);
    });

    test('an unused file loses its key once it is a day old — not a moment sooner, and not when its age is unknown', async () => {
        const DAY = 'huddles/2026-11-12-day.pdf';
        const ALMOST = 'huddles/2026-11-12-almost.pdf';
        const UNKNOWN = 'huddles/2026-11-12-unknown.pdf';
        const w = world({ files: { [DAY]: ['d'], [ALMOST]: ['a'], [UNKNOWN]: ['u'] }, records: {}, created: {
            [DAY]: new Date(NOW - UNLINKED_MIN_AGE_MS).toISOString(),
            [ALMOST]: new Date(NOW - UNLINKED_MIN_AGE_MS + 1).toISOString(),
            [UNKNOWN]: null,
        } });
        const preview = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, nowMs: NOW });
        assert.deepEqual({ unlinkedWithKey: preview.unlinkedWithKey, unlinkedTooNew: preview.unlinkedTooNew },
            { unlinkedWithKey: 1, unlinkedTooNew: 2 }, 'the preview offers to switch off only what a run would');
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true, nowMs: NOW });
        assert.deepEqual(w.keysNow(DAY), []);
        assert.deepEqual(w.keysNow(ALMOST), ['a']);
        assert.deepEqual(w.keysNow(UNKNOWN), ['u']);
        assert.deepEqual({ cleared: r.cleared, unlinkedTooNew: r.unlinkedTooNew }, { cleared: 1, unlinkedTooNew: 2 });
        assert.ok(UNLINKED_MIN_AGE_MS >= 24 * 60 * 60 * 1000, 'shorter than a day no longer outlasts a record held by a lost connection');
    });

    test('a record that arrives late, for a file already old, stops that file losing its key — and the next run rotates it', async () => {
        // A phone that lost its signal between saving a file and saving its record sends the record when
        // it next connects, perhaps days later. The file is old by then, so only the second look at the
        // records can see the record: here it lands while the run is reading the files' keys.
        const LATE = 'huddles/2026-11-10-late.pdf';
        const LREC = 'huddles/2026-11-10';
        /** @type {ReturnType<typeof world>} */
        let w;
        w = world({ files: { [LATE]: ['late-k'] }, records: {},
            onGet: (p) => { if (p === LATE) w.store.set(LREC, { storagePath: LATE, storageUrl: link(LATE, 'late-k') }); } });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.deepEqual(w.keysNow(LATE), ['late-k'], 'the late record holds a dead link');
        assert.deepEqual({ cleared: r.cleared, changedDuringRun: r.changedDuringRun }, { cleared: 0, changedDuringRun: 1 },
            'left, and said, for the next check');
        assert.deepEqual(w.log, []);
        const again = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.equal(again.rotated, 1);
        assert.deepEqual(w.keysNow(LATE), [keyOfLink(w.store.get(LREC).storageUrl)]);
    });

    test('the second look keeps the first read’s rule: a link it cannot read, written mid-run, holds the file', async () => {
        const OLD = 'huddles/2026-08-01-old.pdf';
        /** @type {ReturnType<typeof world>} */
        let w;
        w = world({ files: { [OLD]: ['old-x'] }, records: {}, onGet: (p) => {
            if (p === OLD) w.store.set('newsletters/2026-11-13', { storageUrl: 'https://cdn.example.com/n.pdf?alt=media&token=old-x' });
        } });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.deepEqual(w.keysNow(OLD), ['old-x'], 'a link this cannot read lost the key it may open the file with');
        assert.deepEqual({ cleared: r.cleared, changedDuringRun: r.changedDuringRun }, { cleared: 0, changedDuringRun: 1 });
    });

    test('the second look failing throws before any write, so "could not read" still means "nothing changed"', async () => {
        const w = world({ files: { ...ORDINARY().files, 'huddles/2026-08-01-old.pdf': ['old-x'] }, records: ORDINARY().records,
            onRecordsRead: (_name, nth) => { if (nth === 2) throw new Error('read failed'); } });
        await assert.rejects(rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true }));
        assert.deepEqual(w.log, []);
    });
});

describe('a refusal that was this run’s own write, retried after its answer was lost, is not a change', () => {
    // The storage library retries a guarded write whose answer was lost, and the retry is refused (412):
    // the first attempt moved the metageneration on. Firestore re-runs a transaction whose commit answer
    // was lost. Read as somebody else's write, a file that WAS rotated was reported as left alone — and a
    // record that DID move left its file's old key alive.
    const FP = 'huddles/2026-11-12-a1.pdf';
    const REC = 'huddles/2026-11-12';

    test('the last step landed, and its retry was refused: the file is counted as rotated', async () => {
        const w = world({ ...ORDINARY(), lostAnswer: (p, v) => p === FP && !!v && !String(v).includes(',') });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.deepEqual({ rotated: r.rotated, changedDuringRun: r.changedDuringRun, failed: r.failed },
            { rotated: 3, changedDuringRun: 0, failed: [] });
        assert.deepEqual(w.keysNow(FP), [keyOfLink(w.store.get(REC).storageUrl)]);
    });

    test('the first step landed, and its retry was refused: the run carries on, and the old link dies', async () => {
        const w = world({ ...ORDINARY(), lostAnswer: (p, v) => p === FP && String(v).includes(',') });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.deepEqual({ rotated: r.rotated, changedDuringRun: r.changedDuringRun }, { rotated: 3, changedDuringRun: 0 });
        const stored = keyOfLink(w.store.get(REC).storageUrl);
        assert.notEqual(stored, 'old-h');
        assert.deepEqual(w.keysNow(FP), [stored]);
        assert.deepEqual(w.breaches, []);
    });

    test('the record moved, and Firestore ran the transaction again: the old key still goes', async () => {
        const w = world({ ...ORDINARY(), lostCommit: (p) => p === REC });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.deepEqual({ rotated: r.rotated, changedDuringRun: r.changedDuringRun }, { rotated: 3, changedDuringRun: 0 });
        assert.ok(!w.keysNow(FP).includes('old-h'), 'the old link still opens the file');
        assert.deepEqual(w.keysNow(FP), [keyOfLink(w.store.get(REC).storageUrl)]);
    });

    test('an unused file’s key went, and the retry was refused: counted as switched off', async () => {
        const OLD = 'huddles/2026-08-01-old.pdf';
        const w = world({ files: { [OLD]: ['old-x'] }, records: {}, lostAnswer: (p, v) => p === OLD && v === null });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.deepEqual({ cleared: r.cleared, changedDuringRun: r.changedDuringRun }, { cleared: 1, changedDuringRun: 0 });
        assert.deepEqual(w.keysNow(OLD), []);
    });

    test('the same object carrying keys this run did not write is still somebody else’s change', async () => {
        // A second run's first step lands between this run's first and last: same object, its keys.
        /** @type {ReturnType<typeof world>} */
        let w;
        let fired = false;
        w = world({ ...ORDINARY(), beforeSet: (p, v) => {
            if (fired || p !== FP || !v || String(v).includes(',')) return;
            fired = true;
            w.otherWrite(FP, [...w.keysNow(FP), 'other-run']);
        } });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.deepEqual({ rotated: r.rotated, changedDuringRun: r.changedDuringRun }, { rotated: 2, changedDuringRun: 1 });
        assert.ok(w.keysNow(FP).includes('other-run'), 'the other run’s key was taken away');
        assert.deepEqual(w.breaches, []);
    });

    test('a NEW object at the path, carrying no key, is not taken for this run’s clear', async () => {
        // A copy made outside the app — from the command line, say — replaces the file between the
        // keys being read and switched off. The path has no key either way, but this run did not do it.
        const OLD = 'huddles/2026-08-01-old.pdf';
        /** @type {ReturnType<typeof world>} */
        let w;
        let fired = false;
        w = world({ files: { [OLD]: ['old-x'] }, records: {}, beforeSet: (p, v) => {
            if (fired || p !== OLD || v !== null) return;
            fired = true;
            w.reupload(OLD, null);
        } });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.deepEqual({ cleared: r.cleared, changedDuringRun: r.changedDuringRun }, { cleared: 0, changedDuringRun: 1 });
    });
});

describe('a stored link that no longer opens its file is counted, and a run mends it', () => {
    // A record can arrive holding a key its file no longer carries: one that came after a run had
    // switched its file's key off. (A browser's write re-sent after its answer was lost did the same,
    // putting the upload's first link back over the one a run gave it, until the rules refused it on
    // 13 Nov 2026 — documents-client.js.) Members still open the document through
    // the 15-minute link signed from its path; only the fallback is broken — and a check that called
    // such a record "in use" gave the admin no reason to press the one button that mends it.
    const LATE = 'huddles/2026-11-10-late.pdf';
    const LREC = 'huddles/2026-11-10';
    const SHARED = 'circulars/2026-11-07-s.pdf';

    test('a preview counts each record whose link names a key its file no longer carries — and no other', async () => {
        const w = world({
            files: { ...ORDINARY().files, [LATE]: null, [SHARED]: ['live'] },
            records: { ...ORDINARY().records, [LREC]: { storageUrl: link(LATE, 'gone') },
                'circulars/2026-11-07': { storageUrl: link(SHARED, 'live') },
                'circulars/2026-11-08': { storageUrl: link(SHARED, 'stale') } },
        });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey });
        assert.deepEqual({ linked: r.linked, recordsDeadLink: r.recordsDeadLink }, { linked: 5, recordsDeadLink: 2 });
        assert.deepEqual(w.log, []);
    });

    test('a run gives each such record a working link again, and the next check finds none', async () => {
        const w = world({ files: { [LATE]: null, [SHARED]: ['live'] }, records: {
            [LREC]: { storageUrl: link(LATE, 'gone') },
            'circulars/2026-11-07': { storageUrl: link(SHARED, 'live') },
            'circulars/2026-11-08': { storageUrl: link(SHARED, 'stale') },
        } });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.deepEqual({ rotated: r.rotated, changedDuringRun: r.changedDuringRun, failed: r.failed, recordsMended: r.recordsMended },
            { rotated: 2, changedDuringRun: 0, failed: [], recordsMended: 2 }, 'the two dead links, and not the working one beside them');
        for (const [rec, fp] of [[LREC, LATE], ['circulars/2026-11-07', SHARED], ['circulars/2026-11-08', SHARED]]) {
            assert.deepEqual(w.keysNow(fp), [keyOfLink(w.store.get(rec).storageUrl)], `${rec} still holds a dead link`);
        }
        const after = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey });
        assert.equal(after.recordsDeadLink, 0);
    });

    test('a run says how many dead links it mended, each record now opening its file — a preview mends none', async () => {
        const w = world({ files: { ...ORDINARY().files, [LATE]: null },
            records: { ...ORDINARY().records, [LREC]: { storageUrl: link(LATE, 'gone') } } });
        const preview = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey });
        assert.deepEqual({ recordsDeadLink: preview.recordsDeadLink, recordsMended: preview.recordsMended },
            { recordsDeadLink: 1, recordsMended: 0 }, 'a preview changes nothing, so it mends nothing — as it rotates nothing');
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.deepEqual({ rotated: r.rotated, recordsMended: r.recordsMended }, { rotated: 4, recordsMended: 1 },
            'three working links moved too, and none of them was dead');
        assert.deepEqual(w.keysNow(LATE), [keyOfLink(w.store.get(LREC).storageUrl)], 'the record counted as mended does not open its file');
        assert.deepEqual(w.breaches, []);
    });

    test('a dead link is counted once when Firestore ran its move again after a lost answer', async () => {
        const w = world({ files: { [LATE]: null }, records: { [LREC]: { storageUrl: link(LATE, 'gone') } },
            lostCommit: (p) => p === LREC });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.deepEqual({ rotated: r.rotated, recordsMended: r.recordsMended }, { rotated: 1, recordsMended: 1 });
        assert.deepEqual(w.keysNow(LATE), [keyOfLink(w.store.get(LREC).storageUrl)]);
    });

    test('a dead link somebody else rewrote first is not counted as mended, nor one on a held file', async () => {
        // An upload gives the record a link of its own between the plan and the record's transaction.
        const fresh = link('huddles/2026-11-10-NEW.pdf', 'upload-key');
        const w = world({ files: { [LATE]: null }, records: { [LREC]: { storageUrl: link(LATE, 'gone') } },
            onTxGet: (p, store) => { if (p === LREC) store.set(p, { storageUrl: fresh }); } });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.deepEqual({ recordsDeadLink: r.recordsDeadLink, changedDuringRun: r.changedDuringRun, recordsMended: r.recordsMended },
            { recordsDeadLink: 1, changedDuringRun: 1, recordsMended: 0 }, 'the upload mended it, not this run');
        assert.equal(w.store.get(LREC).storageUrl, fresh);
        const held = world({ files: { [LATE]: ['held-k'] }, records: {
            [LREC]: { storageUrl: link(LATE, 'gone') },
            'newsletters/2026-11-01': { storageUrl: 'https://cdn.example.com/n.pdf?alt=media&token=held-k' },
        } });
        const h = await rotateDocumentLinks({ bucket: held.bucket, db: held.db, newKey: held.newKey, rotate: true });
        assert.deepEqual({ held: h.held, recordsMended: h.recordsMended }, { held: 1, recordsMended: 0 });
        assert.equal(held.store.get(LREC).storageUrl, link(LATE, 'gone'), 'a held file’s record was rewritten');
    });

    test('a dead link on a file a link it cannot read holds is not counted — a run leaves that file alone', async () => {
        const w = world({ files: { [LATE]: ['held-k'] }, records: {
            [LREC]: { storageUrl: link(LATE, 'gone') },
            'newsletters/2026-11-01': { storageUrl: 'https://cdn.example.com/n.pdf?alt=media&token=held-k' },
        } });
        const preview = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey });
        assert.deepEqual({ held: preview.held, linked: preview.linked, recordsDeadLink: preview.recordsDeadLink },
            { held: 1, linked: 0, recordsDeadLink: 0 }, 'counted as something Replace mends, on a file Replace never touches');
    });

    test('the keys come from each file, not the listing: a listing without them breaks no link', async () => {
        // A listing that arrived without the keys — a narrower field list, a library change — would
        // otherwise report every stored link in the app as broken (the module header).
        const w = world({ ...ORDINARY(), listed: (p) => ({ name: p, timeCreated: SEEDED }) });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey });
        assert.deepEqual({ linked: r.linked, recordsDeadLink: r.recordsDeadLink }, { linked: 3, recordsDeadLink: 0 });
    });
});

describe('a failure stops ONE file at the step it reached, with its old link still working', () => {
    const FP = 'huddles/2026-11-12-a1.pdf';
    /** @param {Partial<Parameters<typeof world>[0]>} hooks */
    const run = async (hooks) => {
        const w = world({ ...ORDINARY(), ...hooks });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        return { w, r };
    };

    test('the first step fails: nothing changed for that file, and the others still rotate', async () => {
        const { w, r } = await run({ failSet: (p, v) => p === FP && String(v).includes(',') });
        assert.deepEqual(r.failed, [{ path: FP, step: 'expand' }]);
        assert.deepEqual(w.keysNow(FP), ['old-h']);
        assert.equal(keyOfLink(w.store.get('huddles/2026-11-12').storageUrl), 'old-h');
        assert.equal(r.rotated, 2);
        assert.deepEqual(w.breaches, []);
    });

    test('the record write fails: the file answers both keys, so the stored (old) link still opens it', async () => {
        const { w, r } = await run({ failTx: (p) => p === 'huddles/2026-11-12' });
        assert.deepEqual(r.failed, [{ path: FP, step: 'migrate' }]);
        assert.ok(w.keysNow(FP).includes('old-h'));
        assert.equal(keyOfLink(w.store.get('huddles/2026-11-12').storageUrl), 'old-h');
        assert.equal(r.rotated, 2);
        assert.deepEqual(w.breaches, []);
    });

    test('the last step fails: the record already has the new link, and the file still answers it', async () => {
        const { w, r } = await run({ failSet: (p, v) => p === FP && !String(v).includes(',') });
        assert.deepEqual(r.failed, [{ path: FP, step: 'contract' }]);
        const stored = keyOfLink(w.store.get('huddles/2026-11-12').storageUrl);
        assert.ok(w.keysNow(FP).includes(/** @type {string} */ (stored)));
        assert.equal(r.rotated, 2);
        assert.deepEqual(w.breaches, []);
    });

    test('no key could be made: the first step refuses rather than writing an empty one', async () => {
        const w = world(ORDINARY());
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: () => '', rotate: true });
        assert.equal(r.failed.length, 3);
        assert.ok(r.failed.every(f => f.step === 'expand'));
        assert.deepEqual(w.log, []);
    });

    test('an unlinked file whose keys cannot be read is reported, and the run goes on', async () => {
        const w = world({ files: { 'huddles/x.pdf': ['k'], ...ORDINARY().files }, records: ORDINARY().records,
            failGet: (p) => p === 'huddles/x.pdf' });
        const r = await rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true });
        assert.deepEqual(r.failed, [{ path: 'huddles/x.pdf', step: 'read' }]);
        assert.equal(r.rotated, 3);
    });

    test('the READ failing throws before any write, so "could not read" always means "nothing changed"', async () => {
        const w = world({ ...ORDINARY(), failList: true });
        await assert.rejects(rotateDocumentLinks({ bucket: w.bucket, db: w.db, newKey: w.newKey, rotate: true }));
        assert.deepEqual(w.log, []);
    });
});
