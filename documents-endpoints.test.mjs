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
const authPath    = require.resolve('firebase-admin/auth', { paths: [fnDir] });
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
            // `orderBy(field, 'desc').limit(n).get()` — what getDocumentUrl uses to find the LATEST
            // of a kind. Sorts on the real field rather than on insertion order, so a seed written
            // out of date order still answers correctly; that is the whole point of the query.
            orderBy: (/** @type {string} */ field, /** @type {string} */ dir) => {
                assert.equal(dir, 'desc', 'only the latest-first ordering is faked');
                const sorted = () => [...store.keys()]
                    .filter(pth => pth.startsWith(`${name}/`))
                    .sort((a, b) => String((store.get(b) || {})[field])
                        .localeCompare(String((store.get(a) || {})[field])));
                const page = (/** @type {number} */ n) => {
                    const docs = sorted().slice(0, n).map(snapFor);
                    return { empty: docs.length === 0, docs };
                };
                return { limit: (/** @type {number} */ n) => ({ get: async () => page(n) }),
                    get: async () => page(Infinity) };
            },
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
    const signed = /** @type {{path: string, action: string, expires: number}[]} */ ([]);
    let signFails = false;
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
            // RECORDS rather than discards: "refused" and "signed and then refused" are the same
            // status line, and only the recording tells them apart (this file's own lesson).
            getSignedUrl: async (/** @type {any} */ opts) => {
                if (signFails) throw Object.assign(new Error('sign failed'), { code: 403 });
                signed.push({ path, action: opts && opts.action, expires: opts && opts.expires });
                return [`https://signed.example/${encodeURIComponent(path)}?exp=${opts && opts.expires}`];
            },
        }),
        getFiles: async (/** @type {{prefix: string}} */ { prefix }) =>
            [[...objects].filter(p => p.startsWith(prefix)).map(p => bucket.file(p))],
    };
    return { bucket, objects, saved, deleted, signed, failSigning: () => { signFails = true; } };
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
    // The token world. `tokenClaims === null` means verifyIdToken THROWS — an absent, expired or
    // REVOKED token are the same refusal to the handler and must stay so.
    let tokenClaims = /** @type {any} */ (null);
    stub(authPath, { getAuth: () => ({
        verifyIdToken: async (/** @type {string} */ t) => {
            if (!t || tokenClaims === null) throw new Error('bad token');
            return tokenClaims;
        },
    }) });
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
        ADMIN_FUNCTION_ORIGINS: ['https://myb-roster.web.app'],
    });
    return { eps, sends, setNow: (/** @type {any} */ n) => { now = n; },
        setClaims: (/** @type {any} */ c) => { tokenClaims = c; }, ...fsFake, ...stFake };
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

// ── the retention sweep, by what it DESTROYS ───────────────────────────────────────────────────
//
// pruneOldHuddles runs INSIDE the ingest request, against a collection that same request has just
// written to. The costs are not symmetrical:
//
//  - DESTROYING THE UPLOAD IT WAS CALLED ABOUT is silent and total. A back-dated Huddle — a
//    catch-up upload, or a Power Automate run whose date header lags — lands outside the retention
//    window the instant it is written, so the sweep's own query returns it. The doc goes, the
//    prefix sweep takes the object uploaded seconds earlier, staff have already been pushed a
//    notification for it, and the endpoint answers 200 with a storageUrl that 404s. Nothing logs a
//    failure, because nothing failed. `excludeDate` is the whole defence.
//  - Leaving a genuinely stale huddle behind only costs storage, and the next ingest sweeps it.
describe('the retention sweep — the upload it was called about is never its own victim', () => {
    test('a back-dated huddle survives the sweep its own ingest triggers', async () => {
        const b = build();                                         // now = 30 Aug 2026 ⇒ cutoff 30 May 2026
        const out = await ingest(b.eps, { date: '2026-04-01' });    // four months old on arrival
        assert.equal(out.code, 200);
        assert.ok(b.store.has('huddles/2026-04-01'), 'the doc this request wrote must still be there');
        assert.equal(b.deletes.length, 0, 'no Firestore delete at all — the excluded date was the only match');
        const uploaded = b.saved[0].path;
        assert.ok(!b.deleted.includes(uploaded), 'the object this request uploaded must survive the prefix sweep');
        assert.ok(b.objects.has(uploaded), 'and it is still in the bucket');
        assert.equal(b.sends.length, 1, 'staff were told it arrived — so it had better still exist');
        assert.ok(out.body.storageUrl.includes(encodeURIComponent(uploaded)),
            'the 200 hands Power Automate a URL for the object that survived');
    });

    test('a back-dated RE-upload loses only the version it replaced, never the one it wrote', async () => {
        // The sweep deletes by the `huddles/<date>` prefix, which matches every version for a date.
        // Excluding the date is what keeps that prefix off the object written moments earlier; the
        // superseded object is reclaimed by the ingest's own targeted cleanup instead.
        const b = build({
            seed: { 'huddles/2026-04-01': { date: '2026-04-01', storagePath: 'huddles/2026-04-01-old.pdf' } },
            objects: ['huddles/2026-04-01-old.pdf'],
        });
        const out = await ingest(b.eps, { date: '2026-04-01' });
        assert.equal(out.code, 200);
        const uploaded = b.saved[0].path;
        assert.ok(b.store.has('huddles/2026-04-01'), 'the replacement metadata stays');
        assert.equal(b.store.get('huddles/2026-04-01').storagePath, uploaded);
        assert.ok(!b.deleted.includes(uploaded), 'the new object is not swept by its own date prefix');
        assert.ok(b.deleted.includes('huddles/2026-04-01-old.pdf'), 'the superseded version still goes');
    });

    test('an out-of-window date that is NOT this upload is still swept — an exclusion, not a stop', async () => {
        // The other direction: excluding one date must not disarm the sweep. Without this case the
        // two above would pass equally well on a pruneOldHuddles that had stopped deleting anything.
        const b = build({
            seed: { 'huddles/2026-03-02': { date: '2026-03-02', storagePath: 'huddles/2026-03-02-aa.pdf' } },
            objects: ['huddles/2026-03-02-aa.pdf'],
        });
        await ingest(b.eps, { date: '2026-04-01' });
        assert.ok(b.store.has('huddles/2026-04-01'), 'the excluded date survives');
        assert.ok(!b.store.has('huddles/2026-03-02'), 'the other stale date does not');
        assert.ok(b.deleted.includes('huddles/2026-03-02-aa.pdf'));
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

// ── getDocumentUrl — the short-lived URL (v24.16) ──────────────────────────────────────────────
//
// EXECUTED, not merely defined. `functions-surface.test.mjs` proves this endpoint exists; v20.50 is
// the standing lesson about the difference — an endpoint signed off on a 405 and a 401, neither of
// which reaches the line that mints anything.
//
// Organised by what each wrong answer costs:
//   · a door too wide      → a way to read a document firestore.rules refuses
//   · a caller-named path  → an arbitrary read of the whole bucket
//   · a permanent URL      → the very thing this endpoint exists to stop
//   · a hard failure       → a member meets a dead button instead of the old, working way

/** Drive getDocumentUrl and wait for its response. */
async function askForUrl(/** @type {any} */ eps, /** @type {any} */ body, /** @type {string|null} */ auth = 'Bearer tok') {
    const { res, out, done } = makeRes();
    const headers = /** @type {Record<string, string|undefined>} */ ({
        authorization: auth ?? undefined, origin: 'https://myb-roster.web.app',
    });
    const req = {
        method: 'POST', headers, url: '/', path: '/', query: {}, body,
        get(/** @type {string} */ h) { return headers[String(h).toLowerCase()]; },
        header(/** @type {string} */ h) { return this.get(h); },
    };
    const p = eps.getDocumentUrl(req, res);
    await Promise.race([done, p]);
    await p?.catch?.(() => {});
    return out;
}

/** A world with one published document of each kind. */
const PUBLISHED = {
    'huddles/2026-08-30':     { date: '2026-08-30', storagePath: 'huddles/2026-08-30.pdf',  fileType: 'pdf' },
    'circulars/2026-08-28':   { date: '2026-08-28', storagePath: 'circulars/2026-08-28.docx', fileType: 'docx' },
    'newsletters/2026-08-01': { date: '2026-08-01', storagePath: 'newsletters/2026-08-01.docx', fileType: 'docx' },
};

describe('getDocumentUrl — the door, and that it is exactly the rules\' door', () => {

    test('no token, a bad token and a REVOKED token are the same 401 — and nothing is signed', async () => {
        const w = build({ seed: PUBLISHED });
        w.setClaims(null);                       // verifyIdToken throws: absent / expired / revoked
        assert.equal((await askForUrl(w.eps, { kind: 'huddle' })).code, 401);
        assert.equal((await askForUrl(w.eps, { kind: 'huddle' }, null)).code, 401);
        assert.deepEqual(w.signed, [], 'a refused caller reached the signer');
    });

    test('a token with NO door is 403, and still nothing is signed', async () => {
        const w = build({ seed: PUBLISHED });
        w.setClaims({ uid: 'x' });               // authenticated, but no name / admin / calendarViewer
        assert.equal((await askForUrl(w.eps, { kind: 'huddle' })).code, 403);
        assert.deepEqual(w.signed, [], 'a caller the rules would refuse got a URL');
    });

    test('each of the three doors is admitted', async () => {
        for (const claims of [{ name: 'G. Miller' }, { admin: true }, { calendarViewer: true }]) {
            const w = build({ seed: PUBLISHED });
            w.setClaims(claims);
            const out = await askForUrl(w.eps, { kind: 'huddle' });
            assert.equal(out.code, 200, `${JSON.stringify(claims)} was refused: ${JSON.stringify(out.body)}`);
        }
    });

    test('GET is refused before anything else happens', async () => {
        const w = build({ seed: PUBLISHED });
        w.setClaims({ admin: true });
        const { res, out, done } = makeRes();
        const p = w.eps.getDocumentUrl({ method: 'GET', headers: {}, get: () => undefined, header: () => undefined }, res);
        await Promise.race([done, p]);
        assert.equal(out.code, 405);
        assert.deepEqual(w.signed, []);
    });
});

describe('getDocumentUrl — the caller names a KIND and never a path', () => {

    test('the three kinds resolve to their own collections', async () => {
        for (const [kind, path] of [['huddle', 'huddles/2026-08-30.pdf'],
            ['circular', 'circulars/2026-08-28.docx'], ['newsletter', 'newsletters/2026-08-01.docx']]) {
            const w = build({ seed: PUBLISHED });
            w.setClaims({ name: 'G. Miller' });
            const out = await askForUrl(w.eps, { kind });
            assert.equal(out.code, 200, `${kind}: ${JSON.stringify(out.body)}`);
            assert.equal(w.signed.at(-1).path, path, `${kind} signed the wrong object`);
        }
    });

    test('a path, a collection name or junk in `kind` is a 400 that signs nothing', async () => {
        for (const kind of ['huddles', '../secrets/x', 'circulars/2026-08-28', '', null, 7, { }]) {
            const w = build({ seed: PUBLISHED });
            w.setClaims({ admin: true });
            const out = await askForUrl(w.eps, { kind });
            assert.equal(out.code, 400, `${JSON.stringify(kind)} was accepted`);
            assert.deepEqual(w.signed, [], `${JSON.stringify(kind)} reached the signer`);
        }
    });

    test('a storagePath the SERVER wrote badly fails closed rather than reaching the signer', async () => {
        const w = build({ seed: { 'huddles/2026-08-30': { date: '2026-08-30' } } });   // no storagePath
        w.setClaims({ admin: true });
        const out = await askForUrl(w.eps, { kind: 'huddle' });
        assert.equal(out.code, 503);
        assert.deepEqual(w.signed, []);
    });

    test('nothing published yet is a 404, not an error', async () => {
        const w = build({ seed: {} });
        w.setClaims({ admin: true });
        const out = await askForUrl(w.eps, { kind: 'newsletter' });
        assert.equal(out.code, 404);
        assert.match(String(out.body.error), /Newsletter/, 'the refusal should name what is missing');
    });
});

describe('getDocumentUrl — the body may not be parsed, and that must not read as a bad kind', () => {

    // THE WIRING, not the rule. `kindFromBody` is unit-tested in doc-url-core.test.mjs, but a
    // handler reading `req.body.kind` directly would pass every one of those and still refuse a
    // perfectly good request whose Content-Type was not application/json. Reverting the handler to
    // `req.body.kind` passes the whole of the rest of this file, which is why this block exists.
    test('a RAW BUFFER body is honoured, exactly as a parsed object is', async () => {
        const w = build({ seed: PUBLISHED });
        w.setClaims({ name: 'G. Miller' });
        const out = await askForUrl(w.eps, Buffer.from(JSON.stringify({ kind: 'huddle' })));
        assert.equal(out.code, 200,
            `an unparsed body was refused (${out.code}: ${JSON.stringify(out.body)}). firebase-functions `
            + 'parses req.body only on Content-Type: application/json; without the fallback the caller '
            + 'is told "unknown kind" about a kind that was fine.');
        assert.equal(w.signed.at(-1).path, 'huddles/2026-08-30.pdf');
    });

    test('a raw STRING body is honoured too', async () => {
        const w = build({ seed: PUBLISHED });
        w.setClaims({ admin: true });
        assert.equal((await askForUrl(w.eps, '{"kind":"circular"}')).code, 200);
    });

    test('but the fallback widens NOTHING — a bad kind in a raw body is still a 400', async () => {
        const w = build({ seed: PUBLISHED });
        w.setClaims({ admin: true });
        for (const body of [Buffer.from('{"kind":"../secrets"}'), '{"kind":"huddles"}', Buffer.from('not json')]) {
            const out = await askForUrl(w.eps, body);
            assert.equal(out.code, 400, `${String(body).slice(0, 30)} was accepted`);
        }
        assert.deepEqual(w.signed, [], 'a refused raw body reached the signer');
    });
});

describe('getDocumentUrl — the URL is SHORT-LIVED, which is the whole point', () => {

    test('it signs for READ, with an expiry a quarter of an hour out', async () => {
        const w = build({ seed: PUBLISHED });
        w.setClaims({ name: 'G. Miller' });
        const before = Date.now();
        const out = await askForUrl(w.eps, { kind: 'circular' });
        assert.equal(out.code, 200);
        const call = w.signed.at(-1);
        assert.equal(call.action, 'read', 'signed for something other than reading');
        const window = call.expires - before;
        assert.ok(window > 14 * 60_000 && window <= 15 * 60_000 + 2_000,
            `the signing window is ${Math.round(window / 1000)}s — it must outlive the Office viewer's `
            + 'server-side fetch, and must not drift back towards permanent');
        assert.equal(out.body.expiresAt, call.expires, 'the client is told a different expiry than was signed');
    });

    test('the response carries the fileType, because the client picks the viewer from it', async () => {
        const w = build({ seed: PUBLISHED });
        w.setClaims({ admin: true });
        assert.equal((await askForUrl(w.eps, { kind: 'circular' })).body.fileType, 'docx');
        assert.equal((await askForUrl(w.eps, { kind: 'huddle' })).body.fileType, 'pdf');
    });

    test('the permanent storageUrl is NEVER returned', async () => {
        const w = build({ seed: { 'huddles/2026-08-30': {
            date: '2026-08-30', storagePath: 'huddles/2026-08-30.pdf',
            storageUrl: 'https://firebasestorage.example/permanent?token=forever',
        } } });
        w.setClaims({ admin: true });
        const out = await askForUrl(w.eps, { kind: 'huddle' });
        assert.equal(out.code, 200);
        assert.doesNotMatch(JSON.stringify(out.body), /token=forever/,
            'the permanent bearer URL was handed back — this endpoint exists to stop exactly that');
    });
});

describe('getDocumentUrl — a signing failure must not strand a member', () => {

    test('the IAM case answers 503, so the client can fall back rather than show a dead button', async () => {
        const w = build({ seed: PUBLISHED });
        w.setClaims({ name: 'G. Miller' });
        w.failSigning();
        const out = await askForUrl(w.eps, { kind: 'huddle' });
        assert.equal(out.code, 503,
            'a signing failure — overwhelmingly the missing serviceAccountTokenCreator grant — must '
            + 'be a 503 the client treats as "use the old way", not a 500 and not a 200 with no url');
        assert.equal(out.body.url, undefined);
    });
});
