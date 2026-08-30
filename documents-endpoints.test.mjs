// @ts-check
/**
 * documents-endpoints.test.mjs — the DOCUMENT domain's handlers EXECUTED, against a fake
 * Firestore, a fake Storage and a recording push transport.
 *
 * Run with: npm run test:functions   (needs firebase-admin/firebase-functions from functions/node_modules)
 *
 * This was the review's one named wiring gap: documents-client.test.mjs covers the BROWSER's upload
 * ordering, and functions-surface pins that these handlers EXIST — but nothing ever ran one. The
 * cases are organised by what a wrong answer COSTS, and the costs are not symmetrical:
 *
 *  - A DOUBLE PUSH is the loud failure: every subscribed phone pings twice for one Huddle. Three
 *    separate guards exist (the atomic create-vs-resend transaction in ingestHuddle, the
 *    power-automate skip in onHuddleCreated, and create-only trigger semantics) and each is one
 *    innocent edit from gone — so each is pinned from BOTH sides: the send that must happen, and
 *    the send that must not.
 *  - A SILENT NON-PUSH is the quiet one: staff simply never learn a document arrived, and nothing
 *    anywhere errors.
 *  - A WRITE THAT SHOULDN'T EXIST is the durable one: an unauthenticated body reaching Storage, or
 *    a rollback deleting an object a commit-ambiguous transaction may have published (the
 *    upload-commit lesson, server side: uncertainty is not permission to delete).
 *
 * The fakes go into require.cache BEFORE documents.js loads (the auth-endpoints pattern — since
 * the firebase-admin v14 migration the injection points are the MODULAR paths, where the handlers
 * actually import from). firebase-functions and roster-parse-helpers are REAL, so payload
 * assertions exercise the real buildPushPayload and the real file-signature/date validators.
 */
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fnDir = new URL('./functions/', import.meta.url).pathname;
const firePath    = require.resolve('firebase-admin/firestore', { paths: [fnDir] });
const storagePath = require.resolve('firebase-admin/storage', { paths: [fnDir] });
const pushPath    = require.resolve('./functions/push.js');
const docsPath    = require.resolve('./functions/documents.js');

const SERVER_TS = { __serverTimestamp: true };

// ── fakes ──────────────────────────────────────────────────────────────────────────────────────

/** @param {Record<string, any>} seed  path → doc data, e.g. {'huddles/2026-08-29': {...}} */
function makeDb(seed = {}) {
    const store = new Map(Object.entries(seed));
    const deletes = /** @type {string[]} */ ([]);
    /** @type {Error|null} */ let txError = null;
    const snapFor = (/** @type {string} */ path) => ({
        exists: store.has(path),
        id: path.split('/')[1],
        data: () => store.get(path),
        ref: refFor(path),
    });
    const refFor = (/** @type {string} */ path) => ({
        path,
        get: async () => snapFor(path),
        set: async (/** @type {any} */ data) => { store.set(path, data); },
        delete: async () => { store.delete(path); deletes.push(path); },
    });
    const db = {
        collection: (/** @type {string} */ name) => ({
            doc: (/** @type {string} */ id) => refFor(`${name}/${id}`),
            where: (/** @type {string} */ field, /** @type {string} */ op, /** @type {any} */ value) => ({
                get: async () => {
                    assert.equal(op, '<');
                    const docs = [...store.keys()]
                        .filter(p => p.startsWith(`${name}/`) && (store.get(p) || {})[field] < value)
                        .map(snapFor);
                    return { empty: docs.length === 0, docs };
                },
            }),
        }),
        runTransaction: async (/** @type {(tx: any) => any} */ fn) => {
            if (txError) throw txError;
            return fn({
                get: async (/** @type {any} */ ref) => snapFor(ref.path),
                set: (/** @type {any} */ ref, /** @type {any} */ data) => { store.set(ref.path, data); },
            });
        },
    };
    return { db, store, deletes, failTransaction: (/** @type {Error} */ e) => { txError = e; } };
}

/** @param {string[]} existingObjects  Storage paths that already exist */
function makeStorage(existingObjects = []) {
    const objects = new Set(existingObjects);
    const saved = /** @type {{path: string, bytes: number, contentType: string}[]} */ ([]);
    const deleted = /** @type {string[]} */ ([]);
    const bucket = {
        name: 'myb-roster.appspot.com',
        file: (/** @type {string} */ path) => ({
            name: path,
            save: async (/** @type {Buffer} */ buf, /** @type {any} */ opts) => {
                saved.push({ path, bytes: buf.length, contentType: opts?.contentType });
                objects.add(path);
            },
            setMetadata: async () => {},
            delete: async () => { deleted.push(path); objects.delete(path); },
        }),
        getFiles: async (/** @type {{prefix: string}} */ { prefix }) =>
            [[...objects].filter(p => p.startsWith(prefix)).map(p => bucket.file(p))],
    };
    return { bucket, objects, saved, deleted };
}

/**
 * Build the domain against fresh fakes.
 * @param {{seed?: Record<string, any>, objects?: string[], maxFileBytes?: number}} [opts]
 */
function build({ seed = {}, objects = [], maxFileBytes = 20 * 1024 * 1024 } = {}) {
    const fsFake = makeDb(seed);
    const stFake = makeStorage(objects);
    const sends = /** @type {{payload: any, tag: string}[]} */ ([]);
    const stub = (/** @type {string} */ p, /** @type {any} */ exports) => {
        require.cache[p] = /** @type {any} */ ({ id: p, filename: p, loaded: true, exports });
    };
    stub(firePath, { getFirestore: () => fsFake.db, FieldValue: { serverTimestamp: () => SERVER_TS } });
    stub(storagePath, { getStorage: () => ({ bucket: () => stFake.bucket }) });
    stub(pushPath, {
        setupWebPush: () => {},
        fanOutPush: async (/** @type {any} */ payload, /** @type {string} */ tag) => { sends.push({ payload, tag }); },
        // Present so a handler reaching for the targeted sender is CAUGHT by an assertion — every
        // notification in this domain is a broadcast by design (.claude/rules/notifications.md).
        sendTargetedPush: async () => { throw new Error('documents domain must not use sendTargetedPush'); },
    });
    delete require.cache[docsPath];
    const { buildDocumentEndpoints } = require('./functions/documents.js');
    /** @type {{year: number, month: number, day: number}} */
    let now = { year: 2026, month: 7, day: 30 };   // 30 Aug 2026
    const eps = buildDocumentEndpoints({
        HUDDLE_SECRET: { value: () => 'huddle-secret' },
        VAPID_PRIVATE_KEY: { value: () => 'vapid-private' },
        VAPID_PUBLIC_KEY: 'vapid-public',
        STAFF_SITE_URL: 'https://myb-roster.web.app',
        readRawBody: async (/** @type {any} */ req) => req._rawBody,
        nowInLondon: () => now,
        isRetriableFirestoreError: (/** @type {any} */ e) => !!e?._retriable,
        MAX_FILE_BYTES: maxFileBytes,
        MAX_HUDDLE_HTML_CHARS: 200_000,
    });
    return { eps, sends, setNow: (/** @type {any} */ n) => { now = n; }, ...fsFake, ...stFake };
}

// ── request/response fakes (the overtime-endpoints shape) ──────────────────────────────────────

const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

function makeReq({ method = 'POST', auth = 'Bearer huddle-secret', date = '2026-08-30',
    filename = 'huddle.pdf', body = PDF_BYTES } = {}) {
    const headers = /** @type {Record<string, string|undefined>} */ ({
        'authorization': auth ?? undefined,
        'x-huddle-date': date,
        'x-huddle-filename': filename,
        origin: 'https://myb-roster.web.app',
    });
    return {
        method, headers, url: '/', path: '/', query: {},
        _rawBody: Buffer.isBuffer(body) ? body.toString('base64') : body,
        get(/** @type {string} */ h) { return headers[String(h).toLowerCase()]; },
        header(/** @type {string} */ h) { return this.get(h); },
    };
}

function makeRes() {
    const out = { code: 200, body: /** @type {any} */ (null), headers: /** @type {Record<string, any>} */ ({}) };
    const res = /** @type {any} */ (new EventEmitter());
    let finished = false;
    const finish = () => { if (!finished) { finished = true; process.nextTick(() => res.emit('finish')); } };
    Object.assign(res, {
        status(/** @type {number} */ c) { out.code = c; return res; },
        json(/** @type {any} */ b) { out.body = b; finish(); return res; },
        send(/** @type {any} */ b) { out.body = b; finish(); return res; },
        end() { finish(); return res; },
        setHeader(/** @type {string} */ k, /** @type {any} */ v) { out.headers[k] = v; return res; },
        getHeader(/** @type {string} */ k) { return out.headers[k]; },
        removeHeader() { return res; }, set() { return res; }, vary() { return res; },
        writeHead(/** @type {number} */ c) { out.code = c; return res; },
    });
    const done = new Promise(resolve => res.on('finish', resolve));
    return { res, out, done };
}

/** Drive ingestHuddle and wait for its response. */
async function ingest(/** @type {any} */ eps, /** @type {any} */ reqOpts) {
    const { res, out, done } = makeRes();
    const p = eps.ingestHuddle(makeReq(reqOpts), res);
    await Promise.race([done, p]);
    await p?.catch?.(() => {});
    return out;
}

// ── ingestHuddle ───────────────────────────────────────────────────────────────────────────────

describe('ingestHuddle — the refusals, and that a refusal writes NOTHING', () => {
    test('a wrong bearer token is a 401 with no Storage write, no doc, no push', async () => {
        const b = build();
        const out = await ingest(b.eps, { auth: 'Bearer wrong-secret' });
        assert.equal(out.code, 401);
        assert.equal(b.saved.length, 0);
        assert.equal(b.store.size, 0);
        assert.equal(b.sends.length, 0);
    });

    test('a missing Authorization header is a 401, not a crash (timingSafeEqual length trap)', async () => {
        const b = build();
        const out = await ingest(b.eps, { auth: null });
        assert.equal(out.code, 401);
    });

    test('GET is 405; missing headers and an impossible date are 400s; junk base64 is refused', async () => {
        const b = build();
        assert.equal((await ingest(b.eps, { method: 'GET' })).code, 405);
        assert.equal((await ingest(b.eps, { date: '' })).code, 400);
        assert.equal((await ingest(b.eps, { date: '2026-02-30' })).code, 400);
        assert.equal((await ingest(b.eps, { body: '!!!not-base64!!!' })).code, 400);
        assert.equal(b.saved.length, 0, 'no refused request may reach Storage');
    });

    test('bytes that do not match the claimed extension are refused BEFORE Storage', async () => {
        const b = build();
        const out = await ingest(b.eps, { body: Buffer.from('just some text, not a pdf') });
        assert.equal(out.code, 400);
        assert.match(out.body.error, /does not match/);
        assert.equal(b.saved.length, 0);
    });

    test('a file over the size cap is a 413', async () => {
        const b = build({ maxFileBytes: 16 });
        assert.equal((await ingest(b.eps, {})).code, 413);
        assert.equal(b.saved.length, 0);
    });
});

describe('ingestHuddle — the happy path, executed to its side effects', () => {
    test('a first PDF upload saves the object, writes the metadata, notifies ONCE and responds 200', async () => {
        const b = build();
        const out = await ingest(b.eps, {});
        assert.equal(out.code, 200);
        assert.equal(out.body.success, true);

        assert.equal(b.saved.length, 1);
        assert.equal(b.saved[0].bytes, PDF_BYTES.length);
        assert.equal(b.saved[0].contentType, 'application/pdf');
        assert.match(b.saved[0].path, /^huddles\/2026-08-30-[0-9a-f]{8}\.pdf$/);

        const doc = b.store.get('huddles/2026-08-30');
        assert.ok(doc, 'metadata doc written');
        assert.equal(doc.fileType, 'pdf');
        assert.equal(doc.uploadedBy, 'power-automate');
        assert.equal(doc.storagePath, b.saved[0].path);
        assert.ok(doc.storageUrl.includes(encodeURIComponent(doc.storagePath)));
        assert.equal(out.body.storageUrl, doc.storageUrl);

        // ONE broadcast, in the design language — through the REAL buildPushPayload.
        assert.equal(b.sends.length, 1);
        assert.equal(b.sends[0].payload.title, '📋 Latest Huddle');
        assert.equal(b.sends[0].payload.tag, 'huddle');
    });

    test('a RE-SEND for a date that already has a huddle updates the doc but does NOT push again', async () => {
        const b = build({
            seed: { 'huddles/2026-08-30': { date: '2026-08-30', storagePath: 'huddles/2026-08-30-old1.pdf', fileType: 'pdf' } },
            objects: ['huddles/2026-08-30-old1.pdf'],
        });
        const out = await ingest(b.eps, {});
        assert.equal(out.code, 200);
        assert.equal(b.sends.length, 0, 'the double-notify guard: an existing date never re-broadcasts');
        // ...and the superseded object is reclaimed, the new one kept
        assert.deepEqual(b.deleted, ['huddles/2026-08-30-old1.pdf']);
        assert.ok(b.objects.has(b.saved[0].path));
    });

    test('a definite metadata failure rolls the fresh object back and reports 500', async () => {
        const b = build();
        b.failTransaction(Object.assign(new Error('permission denied'), { code: 'permission-denied' }));
        const out = await ingest(b.eps, {});
        assert.equal(out.code, 500);
        assert.equal(b.saved.length, 1, 'the object was uploaded before the metadata failed');
        assert.deepEqual(b.deleted, [b.saved[0].path], 'a definite non-commit deletes its own upload');
        assert.equal(b.sends.length, 0);
    });

    test('a COMMIT-AMBIGUOUS failure leaves the object alone — uncertainty is not permission to delete', async () => {
        const b = build();
        b.failTransaction(Object.assign(new Error('deadline exceeded'), { code: 4, _retriable: true }));
        const out = await ingest(b.eps, {});
        assert.equal(out.code, 500);
        assert.equal(b.deleted.length, 0, 'the transaction may have committed — the object must survive');
    });

    test('the post-upload prune sweeps only real out-of-window dates, Firestore before Storage', async () => {
        const b = build({
            seed: {
                'huddles/2026-04-01': { date: '2026-04-01', storagePath: 'huddles/2026-04-01-aa.pdf' },   // stale
                'huddles/not-a-date': { date: '0000-00-00' },                                              // corrupt id
                'huddles/2026-08-01': { date: '2026-08-01', storagePath: 'huddles/2026-08-01-bb.pdf' },   // in window
            },
            objects: ['huddles/2026-04-01-aa.pdf', 'huddles/2026-04-01.pdf', 'huddles/2026-08-01-bb.pdf'],
        });
        const out = await ingest(b.eps, {});
        assert.equal(out.code, 200);
        assert.ok(!b.store.has('huddles/2026-04-01'), 'stale doc pruned');
        assert.ok(b.store.has('huddles/2026-08-01'), 'in-window doc kept');
        assert.ok(b.store.has('huddles/not-a-date'), 'a non-date id is never swept — the prefix-widening guard');
        // BOTH the versioned and the legacy object for the stale date go; the in-window object stays
        assert.ok(b.deleted.includes('huddles/2026-04-01-aa.pdf'));
        assert.ok(b.deleted.includes('huddles/2026-04-01.pdf'));
        assert.ok(!b.deleted.includes('huddles/2026-08-01-bb.pdf'));
    });
});

// ── the three Firestore triggers ───────────────────────────────────────────────────────────────

describe('the create triggers — who notifies, and the halves of the double-push guard', () => {
    const snapEvent = (/** @type {string} */ date, /** @type {any} */ data) =>
        ({ params: { date }, data: data === undefined ? undefined : { data: () => data } });

    test('a MANUAL huddle upload notifies from the trigger — this is its only push path', async () => {
        const b = build();
        await b.eps.onHuddleCreated.run(snapEvent('2026-08-30', { uploadedBy: 'G. Miller' }));
        assert.equal(b.sends.length, 1);
        assert.equal(b.sends[0].payload.tag, 'huddle');
    });

    test('a POWER AUTOMATE huddle doc is skipped by the trigger — ingestHuddle already pushed', async () => {
        const b = build();
        await b.eps.onHuddleCreated.run(snapEvent('2026-08-30', { uploadedBy: 'power-automate' }));
        assert.equal(b.sends.length, 0, 'the other half of the double-notify guard');
    });

    test('a missing snapshot no-ops instead of throwing into a retry loop', async () => {
        const b = build();
        await b.eps.onHuddleCreated.run(snapEvent('2026-08-30', undefined));
        assert.equal(b.sends.length, 0);
    });

    test('circular and newsletter creates each broadcast their own design-language payload', async () => {
        const b = build();
        await b.eps.onCircularCreated.run(snapEvent('2026-08-30', {}));
        await b.eps.onNewsletterCreated.run(snapEvent('2026-08-30', {}));
        assert.equal(b.sends.length, 2);
        assert.equal(b.sends[0].payload.title, '📰 Latest Retail Circular');
        assert.equal(b.sends[0].payload.tag, 'circular');
        assert.equal(b.sends[1].payload.title, '🗞️ Latest Marylebone Newsletter');
        assert.equal(b.sends[1].payload.tag, 'newsletter');
    });
});

// ── the scheduler ──────────────────────────────────────────────────────────────────────────────

describe('sendPayReminderNotification — a daily schedule that must fire on exactly the cutoff Saturdays', () => {
    test('an ordinary day sends nothing', async () => {
        const b = build();
        b.setNow({ year: 2026, month: 7, day: 30 });            // Sun 30 Aug 2026 — not a cutoff
        await b.eps.sendPayReminderNotification.run({});
        assert.equal(b.sends.length, 0);
    });

    test('a cutoff Saturday sends the pay reminder deep-linked to the payday six days on', async () => {
        const b = build();
        b.setNow({ year: 2026, month: 1, day: 7 });             // Sat 7 Feb 2026 — the first cutoff
        await b.eps.sendPayReminderNotification.run({});
        assert.equal(b.sends.length, 1);
        const p = b.sends[0].payload;
        assert.equal(p.tag, 'pay-reminder');
        assert.match(p.title, /^💷 Payday Friday — /);
        assert.ok(p.url.includes('payday=2026-02-13'), `deep link carries the payday: ${p.url}`);
        assert.match(p.body, /13 February/);
    });
});
