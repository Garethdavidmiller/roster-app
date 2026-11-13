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
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { teamMembers, gradeForRole } from './roster-data.js';

const require = createRequire(import.meta.url);
const fnDir = new URL('./functions/', import.meta.url).pathname;
const firePath    = require.resolve('firebase-admin/firestore', { paths: [fnDir] });
const storagePath = require.resolve('firebase-admin/storage', { paths: [fnDir] });
const pushPath    = require.resolve('./functions/push.js');
const authPath    = require.resolve('firebase-admin/auth', { paths: [fnDir] });
const docsPath    = require.resolve('./functions/documents.js');
// The pay reminder's audience and send. Reloaded with documents.js on every build: a cached copy would
// keep the push transport and the Auth fake of whichever build loaded it FIRST, and record its sends there.
const payPath     = require.resolve('./functions/pay-reminder.js');
const webpushPath = require.resolve('web-push', { paths: [fnDir] });

/** The REAL server-owned roster — the pay reminder's audience is read from it. */
const ROSTER = require('./functions/roster-members.json');
const { nameToEmail } = require('./functions/roster-parse-helpers.js');

const SERVER_TS = { __serverTimestamp: true };

/**
 * The Auth world every roster member lives in: one account per name, at the email that name
 * derives to, with the claims Set up accounts stamps. `getUserByEmail` is what the pay reminder
 * resolves its audience through; an unknown email is `user-not-found`, exactly as the SDK says it.
 * @param {(email: string) => any} [override]  return a record, or throw, for one email
 */
function rosterAccounts(override) {
    /** @type {Map<string, any>} */
    const byEmail = new Map();
    for (const name of ROSTER.activeMembers) {
        const email = nameToEmail(name).toLowerCase();
        byEmail.set(email, { uid: `uid:${name}`, email, customClaims: { name, member: name } });
    }
    return async (/** @type {string} */ email) => {
        const key = String(email).toLowerCase();
        if (override) {
            const got = override(key);
            if (got !== undefined) return got;
        }
        if (!byEmail.has(key)) throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
        return byEmail.get(key);
    };
}

// ── fakes ──────────────────────────────────────────────────────────────────────────────────────

/** @param {Record<string, any>} seed  path → doc data, e.g. {'huddles/2026-08-29': {...}} */
function makeDb(seed = {}) {
    const store = new Map(Object.entries(seed));
    const deletes = /** @type {string[]} */ ([]);
    /** @type {Error|null} */ let txError = null;
    /** @type {Error|null} */ let latestReadError = null;
    /** Runs ONCE, right after the stale-date query has answered — a write landing between the query
     *  and the delete it decided on (v25.89). @type {(() => void)|null} */
    let afterStaleQuery = null;
    /** The next transaction's commit LANDS but its answer is lost: this runs, and then Firestore runs
     *  the whole transaction again, as the Admin SDK does after a lost commit answer. Fires once.
     *  @type {(() => Promise<void>|void)|null} */
    let lostCommitAnswer = null;
    /** The next transaction's FIRST attempt runs, and then Firestore cannot be reached: every attempt
     *  after it fails, so runTransaction rejects with `err`, as the Admin SDK does once its retries run
     *  out. `landed`: that attempt's commit reached the server before the answers stopped. `readsFail`:
     *  a plain read fails from then on too. Fires once.
     *  @type {{ err: Error, landed: boolean, readsFail: boolean }|null} */
    let unreachable = null;
    /** @type {Error|null} */ let docReadError = null;
    // A snapshot holds the data AS READ, like Firestore's: a lazy `() => store.get(path)` would show a
    // transaction the write it made after reading, which the real SDK never does.
    const snapFor = (/** @type {string} */ path) => {
        const data = store.get(path);
        return { exists: store.has(path), id: path.split('/')[1], data: () => data, ref: refFor(path) };
    };
    const refFor = (/** @type {string} */ path) => ({
        path,
        get: async () => { if (docReadError) throw docReadError; return snapFor(path); },
        set: async (/** @type {any} */ data) => { store.set(path, data); },
        delete: async () => { store.delete(path); deletes.push(path); },
    });
    const db = {
        collection: (/** @type {string} */ name) => ({
            doc: (/** @type {string} */ id) => refFor(`${name}/${id}`),
            // The whole collection — what the link rotation reads every record of a kind with.
            get: async () => {
                const docs = [...store.keys()].filter(p => p.startsWith(`${name}/`)).map(snapFor);
                return { empty: docs.length === 0, docs };
            },
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
                    if (latestReadError) throw latestReadError;
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
                    const hook = afterStaleQuery; afterStaleQuery = null; hook?.();
                    return { empty: docs.length === 0, docs };
                },
            }),
        }),
        runTransaction: async (/** @type {(tx: any) => any} */ fn) => {
            if (txError) throw txError;
            const tx = {
                get: async (/** @type {any} */ ref) => snapFor(ref.path),
                set: (/** @type {any} */ ref, /** @type {any} */ data) => { store.set(ref.path, data); },
                delete: (/** @type {any} */ ref) => { store.delete(ref.path); deletes.push(ref.path); },
                // A partial write, merged — the link rotation changes `storageUrl` and nothing else.
                update: (/** @type {any} */ ref, /** @type {any} */ data) => {
                    store.set(ref.path, { ...(store.get(ref.path) || {}), ...data });
                },
            };
            const cut = unreachable; unreachable = null;
            // What the store held before the attempt: a commit that never landed leaves it so.
            const before = cut && !cut.landed ? new Map(store) : null;
            const first = await fn(tx);
            if (cut) {
                if (before) { store.clear(); for (const [p, d] of before) store.set(p, d); }
                if (cut.readsFail) docReadError = cut.err;
                throw cut.err;
            }
            const lost = lostCommitAnswer; lostCommitAnswer = null;
            if (!lost) return first;
            await lost();
            return fn(tx);
        },
    };
    return { db, store, deletes, failTransaction: (/** @type {Error} */ e) => { txError = e; },
        failLatestRead: (/** @type {Error} */ e) => { latestReadError = e; },
        afterStaleQuery: (/** @type {() => void} */ fn) => { afterStaleQuery = fn; },
        loseCommitAnswerOnce: (/** @type {() => Promise<void>|void} */ fn) => { lostCommitAnswer = fn; },
        unreachableAfterFirstAttempt: (/** @type {Error} */ err,
            /** @type {{ landed: boolean, readsFail?: boolean }} */ { landed, readsFail = false }) => {
            unreachable = { err, landed, readsFail };
        } };
}

/**
 * @param {string[]} existingObjects  Storage paths that already exist
 * @param {Record<string, string>} [keys]  path → its download key(s), comma-separated as Firebase keeps them
 */
function makeStorage(existingObjects = [], keys = {}) {
    const objects = new Set(existingObjects);
    /** When each object was created, as GCS lists it (`metadata.timeCreated`): a seeded object is a year
     *  old, one saved during the test is new — the age the orphan sweep reads (v25.89). @type {Map<string, string|undefined>} */
    const created = new Map(existingObjects.map(p => [p, '2025-08-30T12:00:00.000Z']));
    /** Runs ONCE, just before the next listing — an upload landing mid-sweep. @type {(() => void)|null} */
    let beforeList = null;
    const signed = /** @type {{path: string, action: string, expires: number}[]} */ ([]);
    let signFails = false;
    let listFails = false;
    const saved = /** @type {{path: string, bytes: number, contentType: string}[]} */ ([]);
    const deleted = /** @type {string[]} */ ([]);
    /** Custom metadata per object, KEPT (the link rotation reads and writes the download key here).
     *  @type {Map<string, Record<string, string>>} */
    const meta = new Map(Object.entries(keys).map(([p, k]) => [p, { firebaseStorageDownloadTokens: k }]));
    /** Every metadata write, in order — recorded rather than discarded, with whether it was a
     *  compare-and-set. @type {{path: string, metadata: any, guarded: boolean}[]} */
    const metaWrites = [];
    /** GCS's two counters: a new upload is a new generation, a metadata write a new metageneration.
     *  @type {Map<string, {generation: number, metageneration: number}>} */
    let nextGen = 100;
    const gens = new Map();
    const genOf = (/** @type {string} */ p) => {
        if (!gens.has(p)) gens.set(p, { generation: nextGen++, metageneration: 1 });
        return /** @type {{generation: number, metageneration: number}} */ (gens.get(p));
    };
    const bucket = {
        name: 'myb-roster.appspot.com',
        file: (/** @type {string} */ path) => ({
            name: path,
            metadata: { timeCreated: created.get(path) },
            save: async (/** @type {Buffer} */ buf, /** @type {any} */ opts) => {
                saved.push({ path, bytes: buf.length, contentType: opts?.contentType });
                objects.add(path);
                created.set(path, new Date().toISOString());
                gens.set(path, { generation: nextGen++, metageneration: 1 });
            },
            // GCS semantics: custom keys MERGE into what is there, and a null value removes one; a
            // write that names a generation or metageneration is refused (412) when it is not current.
            setMetadata: async (/** @type {any} */ opts, /** @type {any} */ pre) => {
                const g = genOf(path);
                const guarded = !!pre && pre.ifGenerationMatch !== undefined && pre.ifMetagenerationMatch !== undefined;
                if (pre && ((pre.ifGenerationMatch !== undefined && pre.ifGenerationMatch !== g.generation)
                    || (pre.ifMetagenerationMatch !== undefined && pre.ifMetagenerationMatch !== g.metageneration))) {
                    throw Object.assign(new Error('Precondition Failed'), { code: 412 });
                }
                const cur = { ...(meta.get(path) || {}) };
                for (const [k, v] of Object.entries((opts && opts.metadata) || {})) {
                    if (v === null) delete cur[k]; else cur[k] = /** @type {string} */ (v);
                }
                meta.set(path, cur);
                g.metageneration++;
                metaWrites.push({ path, metadata: opts && opts.metadata, guarded });
                return [{ name: path, ...g, timeCreated: created.get(path), metadata: { ...cur } }];
            },
            // The whole object resource, as GCS answers it — `timeCreated` included, which the link
            // rotation reads to keep an upload still writing its record from losing its key.
            getMetadata: async () => [{ name: path, ...genOf(path), timeCreated: created.get(path), metadata: { ...(meta.get(path) || {}) } }],
            delete: async () => { deleted.push(path); objects.delete(path); },
            // RECORDS rather than discards: "refused" and "signed and then refused" are the same
            // status line, and only the recording tells them apart (this file's own lesson).
            getSignedUrl: async (/** @type {any} */ opts) => {
                if (signFails) throw Object.assign(new Error('sign failed'), { code: 403 });
                signed.push({ path, action: opts && opts.action, expires: opts && opts.expires });
                return [`https://signed.example/${encodeURIComponent(path)}?exp=${opts && opts.expires}`];
            },
        }),
        getFiles: async (/** @type {{prefix: string}} */ { prefix }) => {
            if (listFails) throw new Error('listing failed');
            const hook = beforeList; beforeList = null; hook?.();
            return [[...objects].filter(p => p.startsWith(prefix)).map(p => bucket.file(p))];
        },
    };
    return { bucket, objects, saved, deleted, signed, created, meta, metaWrites,
        failSigning: () => { signFails = true; }, failListing: () => { listFails = true; },
        beforeList: (/** @type {() => void} */ fn) => { beforeList = fn; } };
}

/**
 * Build the domain against fresh fakes.
 * @param {{seed?: Record<string, any>, objects?: string[], keys?: Record<string, string>, maxFileBytes?: number}} [opts]
 */
function build({ seed = {}, objects = [], keys = {}, maxFileBytes = 20 * 1024 * 1024 } = {}) {
    const fsFake = makeDb(seed);
    const stFake = makeStorage(objects, keys);
    const sends = /** @type {{payload: any, tag: string}[]} */ ([]);
    /** Every TARGETED send, with the uids it was addressed to. */
    const targeted = /** @type {{payload: any, uids: string[], tag: string}[]} */ ([]);
    const stub = (/** @type {string} */ p, /** @type {any} */ exports) => {
        require.cache[p] = /** @type {any} */ ({ id: p, filename: p, loaded: true, exports });
    };
    stub(firePath, { getFirestore: () => fsFake.db, FieldValue: { serverTimestamp: () => SERVER_TS } });
    // The token world. `tokenClaims === null` means verifyIdToken THROWS — an absent, expired or
    // REVOKED token are the same refusal to the handler and must stay so.
    let tokenClaims = /** @type {any} */ (null);
    // A REVOKED token is a separate state, not another `null` (test audit, 7 Nov 2026). The real SDK
    // verifies a revoked token perfectly by signature and refuses it only when the caller passes
    // `checkRevoked = true`; this fake used to ignore the argument and model revocation as a throw
    // that happened either way, so dropping `true` from the handler left every test green — and a
    // disabled member, or a viewer whose PIN was rotated, could have gone on minting document links
    // for the rest of the token's hour.
    let tokenRevoked = false;
    stub(authPath, { getAuth: () => ({
        verifyIdToken: async (/** @type {string} */ t, /** @type {boolean} */ checkRevoked) => {
            if (!t || tokenClaims === null) throw new Error('bad token');
            if (tokenRevoked && checkRevoked === true) {
                throw Object.assign(new Error('revoked'), { code: 'auth/id-token-revoked' });
            }
            return tokenClaims;
        },
        getUserByEmail: rosterAccounts(),
    }) });
    stub(storagePath, { getStorage: () => ({ bucket: () => stFake.bucket }) });
    stub(pushPath, {
        setupWebPush: () => {},
        fanOutPush: async (/** @type {any} */ payload, /** @type {string} */ tag) => { sends.push({ payload, tag }); },
        // Recorded APART from the broadcasts. The documents are broadcasts and the pay reminder is
        // targeted (owner decision, 10 Nov 2026), so a handler on the wrong sender shows up as a
        // send in the wrong array — never as the right count in the right one.
        sendTargetedPush: async (/** @type {any} */ payload, /** @type {string[]} */ uids, /** @type {string} */ tag) => {
            targeted.push({ payload, uids, tag });
            return uids.length;
        },
    });
    delete require.cache[payPath];
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
        rosterMembers: ROSTER,
    });
    return { eps, sends, targeted, setNow: (/** @type {any} */ n) => { now = n; },
        setClaims: (/** @type {any} */ c) => { tokenClaims = c; },
        setRevoked: (/** @type {boolean} */ r) => { tokenRevoked = r; }, ...fsFake, ...stFake };
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

/** A REAL member's decoded token (v24.23): the name, on the password account that name derives to.
 *  A bare `{ name }` is what a self-renamed anonymous session looks like, and is refused now. */
const MEMBER_GM = { name: 'G. Miller', member: 'G. Miller', email: 'g.miller@myb-roster.local', firebase: { sign_in_provider: 'password' } };

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
        assert.equal(b.targeted.length, 0, 'the Huddle is for everybody — never a targeted send');
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

// ── A BIG .docx MUST NOT TAKE THE INGEST DOWN (functions-core-3, whole-app check 10 Nov 2026) ───
//
// The ingest accepts files up to 20 MB and declared no memory, so it ran on the platform default
// (256 MiB). Measured on its own sequence: converting a 10 MB .docx peaks near 240 MB, a 19 MB one
// near 350 MB, before the Storage and Firestore clients — and the HTML that comes out of anything
// that size is millions of characters, far over the cap, and thrown away. A killed instance writes
// nothing, notifies nobody, and staff keep reading yesterday's Huddle.
// Firestore runs the record transaction again after a commit whose ANSWER was lost, and that attempt
// reads the record the first one wrote. If Operations → Document links ran in between, the record's link
// had been moved onto a new key and the first key taken away; setting the record again put the first
// link back, naming a key its file no longer carries. Driven here through BOTH real handlers.
describe('ingestHuddle — a re-run of its record transaction never undoes a link Replace gave the record', () => {
    test('Replace landing between the commit and the re-run keeps its link: the re-run writes nothing over it', async () => {
        const b = build();
        b.setClaims({ admin: true });   // the Replace run's door; the ingest's is its bearer secret
        b.loseCommitAnswerOnce(async () => {
            const run = await askToRotate(b.eps, { rotate: true });
            assert.equal(run.body.rotated, 1, JSON.stringify(run.body));
        });
        assert.equal((await ingest(b.eps, {})).code, 200);
        const doc = b.store.get('huddles/2026-08-30');
        assert.equal(doc.storagePath, b.saved[0].path);
        const keys = String(b.meta.get(doc.storagePath)?.firebaseStorageDownloadTokens ?? '').split(',');
        assert.ok(keys.includes(String(new URL(doc.storageUrl).searchParams.get('token'))),
            `the re-run wrote its first link back: the record holds a key its file no longer has (${keys})`);
    });

    test('a first upload whose commit answer was lost is still announced, once', async () => {
        const b = build();
        b.loseCommitAnswerOnce(() => {});
        assert.equal((await ingest(b.eps, {})).code, 200);
        assert.equal(b.sends.length, 1, 'the re-run read its own record as a re-send, and a new Huddle went unannounced');
    });
});

// When the commit lands, its answer is lost and every retry after it fails too, the transaction ends in
// a retriable error with the Huddle already live. The ingest answered 500 and told nobody, and Power
// Automate's retry — a new request — found the flow's own record and stayed silent as a re-send. Now it
// reads the record back: its own path there means the commit landed, and it finishes as usual. No
// record, another path or a failed read keeps the 500, the object left: uncertainty is not permission
// to delete.
describe('ingestHuddle — a commit that landed is finished, even when every answer after it was lost', () => {
    const lostEverything = () => Object.assign(new Error('unavailable'), { code: 14, _retriable: true });
    const doc = (/** @type {string} */ id, /** @type {string} */ by) => ({ 'huddles/2026-08-30':
        { date: '2026-08-30', storagePath: `huddles/2026-08-30-${id}.pdf`, fileType: 'pdf', uploadedBy: by } });

    test('the record names this upload: 200, announced once, and the version it replaced is cleaned up', async () => {
        const b = build({ seed: doc('man1', 'G. Miller'), objects: ['huddles/2026-08-30-man1.pdf'] });
        b.unreachableAfterFirstAttempt(lostEverything(), { landed: true });
        const out = await ingest(b.eps, {});
        assert.equal(out.code, 200, JSON.stringify(out.body));
        const live = b.store.get('huddles/2026-08-30');
        assert.equal(live.storagePath, b.saved[0].path);
        assert.equal(out.body.storageUrl, live.storageUrl);
        assert.equal(b.sends.length, 1, 'the Huddle is live and nobody was told');
        assert.deepEqual(b.deleted, ['huddles/2026-08-30-man1.pdf'], 'the version it replaced was left behind');
        assert.ok(b.objects.has(b.saved[0].path));
    });

    test('what the committing attempt saw decides the notice: a first upload is announced, the flow’s own re-send is not', async () => {
        for (const [seed, objects, told] of /** @type {[any, string[], number][]} */ ([
            [{}, [], 1],
            [doc('pa1', 'power-automate'), ['huddles/2026-08-30-pa1.pdf'], 0],
        ])) {
            const b = build({ seed, objects });
            b.unreachableAfterFirstAttempt(lostEverything(), { landed: true });
            assert.equal((await ingest(b.eps, {})).code, 200);
            assert.equal(b.sends.length, told, `seeded ${JSON.stringify(seed)}`);
            assert.deepEqual(b.deleted, objects, 'the version it replaced');
        }
    });

    test('the commit never landed: 500 as before — the object left, the record untouched, nobody told', async () => {
        // No record, and a record naming another upload: neither is this one's own.
        for (const [seed, objects] of /** @type {[any, string[]][]} */ ([[{}, []], [doc('man1', 'G. Miller'), ['huddles/2026-08-30-man1.pdf']]])) {
            const b = build({ seed, objects });
            b.unreachableAfterFirstAttempt(lostEverything(), { landed: false });
            const out = await ingest(b.eps, {});
            assert.equal(out.code, 500, `seeded ${JSON.stringify(seed)}`);
            assert.deepEqual(b.store.get('huddles/2026-08-30'), seed['huddles/2026-08-30']);
            assert.deepEqual(b.deleted, [], 'uncertainty is not permission to delete — this upload or the one before it');
            assert.ok(b.objects.has(b.saved[0].path));
            assert.equal(b.sends.length, 0);
        }
    });

    test('the read after the failure fails too: 500 as before — the object left, nobody told', async () => {
        const b = build();
        b.unreachableAfterFirstAttempt(lostEverything(), { landed: true, readsFail: true });
        const out = await ingest(b.eps, {});
        assert.equal(out.code, 500);
        assert.equal(b.store.get('huddles/2026-08-30')?.storagePath, b.saved[0].path, 'the commit did land');
        assert.deepEqual(b.deleted, []);
        assert.ok(b.objects.has(b.saved[0].path));
        assert.equal(b.sends.length, 0, 'a read that failed was taken for an answer');
    });
});

describe('a large .docx Huddle is stored without a conversion whose HTML could never be kept', () => {
    const mammothPath = require.resolve('mammoth', { paths: [fnDir] });
    /** A file that passes the .docx signature check, of exactly `bytes` bytes. */
    const docxOf = (/** @type {number} */ bytes) => Buffer.concat([Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.alloc(bytes - 4, 0x20)]);
    /** @param {(calls: number[]) => Promise<void>} body */
    const withMammoth = async (body) => {
        const calls = /** @type {number[]} */ ([]);
        require.cache[mammothPath] = /** @type {any} */ ({ id: mammothPath, filename: mammothPath, loaded: true, exports: {
            convertToHtml: async (/** @type {{buffer: Buffer}} */ { buffer }) => { calls.push(buffer.length); return { value: '<p>Huddle</p>' }; },
        } });
        try { await body(calls); } finally { delete require.cache[mammothPath]; }
    };

    test('the ingest declares enough memory for the files it accepts', () => {
        const b = build();
        const mb = b.eps.ingestHuddle.__endpoint.availableMemoryMb;
        assert.ok(Number.isFinite(mb) && mb >= 512,
            `ingestHuddle runs on ${typeof mb === 'number' ? `${mb} MB` : 'the platform default (256 MiB)'} for files up to 20 MB`);
    });

    test('a .docx over the conversion limit is stored, announced and opened as a file — never converted', async () => {
        await withMammoth(async (calls) => {
            const b = build();
            const out = await ingest(b.eps, { filename: 'huddle.docx', body: docxOf(2 * 1024 * 1024 + 1) });
            assert.equal(out.code, 200);
            assert.deepEqual(calls, [], 'a conversion ran whose HTML could only be discarded');
            const doc = b.store.get('huddles/2026-08-30');
            assert.equal(doc.fileType, 'docx');
            assert.equal(doc.htmlContent, undefined, 'no inline HTML — the viewer offers the file instead');
            assert.equal(b.sends.length, 1, 'and staff are still told it arrived');
        });
    });

    test('an ordinary .docx is still converted for the in-app viewer', async () => {
        await withMammoth(async (calls) => {
            const b = build();
            const out = await ingest(b.eps, { filename: 'huddle.docx', body: docxOf(40 * 1024) });
            assert.equal(out.code, 200);
            assert.deepEqual(calls, [40 * 1024]);
            assert.equal(b.store.get('huddles/2026-08-30').htmlContent, '<p>Huddle</p>');
        });
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

// ── THE SWEEP DELETES ONLY WHAT IT SELECTED (v25.89, external review) ──────────────────────────
//
// It deleted an expired date's document and then every object under `huddles/<date>`. A replacement
// upload completing between the two kept its new document and lost its file: a Huddle pointing at
// nothing. Now the document is deleted only if it is still the version the query found, only that
// version's object is deleted by name, and an orphan goes only when no upload can still own it.
describe('the retention sweep deletes only what it selected — never a replacement landing mid-sweep', () => {
    const OLD = 'huddles/2026-04-01-old.pdf', NEW = 'huddles/2026-04-01-new.pdf';
    const staleSeed = () => build({
        seed: { 'huddles/2026-04-01': { date: '2026-04-01', storagePath: OLD } },
        objects: [OLD],
    });
    /** A back-dated upload for the same date: its file is saved first, its document after. */
    const upload = (/** @type {any} */ b, { withDoc = true, createdAt = new Date().toISOString() } = {}) => {
        b.objects.add(NEW); b.created.set(NEW, createdAt);
        if (withDoc) b.store.set('huddles/2026-04-01', { date: '2026-04-01', storagePath: NEW });
    };

    test('a replacement completing after the stale document went keeps its file (the review\'s reproduction)', async () => {
        const b = staleSeed();
        b.beforeList(() => upload(b));
        assert.equal((await ingest(b.eps, {})).code, 200);
        assert.ok(b.deleted.includes(OLD), 'the version the sweep selected still goes');
        assert.ok(!b.deleted.includes(NEW), "the replacement's file was swept");
        assert.equal(b.store.get('huddles/2026-04-01')?.storagePath, NEW);
        assert.ok(b.objects.has(NEW), 'and the document points at a file that exists');
    });

    test('a file saved before its document is written is protected by its AGE alone', async () => {
        // Between `file.save` and the metadata transaction, nothing names the new file.
        const b = staleSeed();
        b.beforeList(() => upload(b, { withDoc: false }));
        await ingest(b.eps, {});
        assert.ok(!b.deleted.includes(NEW), 'a file whose upload had not yet written its document was swept');
    });

    test('a file the live document names is never swept, even when its age reads old (a clock out of step)', async () => {
        const b = staleSeed();
        b.beforeList(() => upload(b, { createdAt: '2025-01-01T00:00:00.000Z' }));
        await ingest(b.eps, {});
        assert.ok(!b.deleted.includes(NEW), 'the file a live Huddle names was swept');
    });

    test('a replacement landing between the query and the delete is left whole — document and file', async () => {
        const b = staleSeed();
        b.afterStaleQuery(() => upload(b));
        await ingest(b.eps, {});
        assert.equal(b.store.get('huddles/2026-04-01')?.storagePath, NEW, 'the fresh document was deleted');
        assert.ok(!b.deleted.includes(NEW));
        assert.ok(!b.deletes.includes('huddles/2026-04-01'));
    });

    test("a corrupted storagePath can never reach another date's file", async () => {
        const b = build({
            seed: { 'huddles/2026-04-01': { date: '2026-04-01', storagePath: 'huddles/2026-08-01-bb.pdf' },
                    'huddles/2026-08-01': { date: '2026-08-01', storagePath: 'huddles/2026-08-01-bb.pdf' } },
            objects: ['huddles/2026-08-01-bb.pdf'],
        });
        await ingest(b.eps, {});
        assert.ok(!b.store.has('huddles/2026-04-01'), 'the stale document still goes');
        assert.ok(!b.deleted.includes('huddles/2026-08-01-bb.pdf'), 'an in-window Huddle lost its file');
    });

    test('an orphan whose age cannot be read is kept — a stray file costs storage, a lost one is a broken link', async () => {
        const b = staleSeed();
        b.objects.add('huddles/2026-04-01-unknown.pdf'); b.created.set('huddles/2026-04-01-unknown.pdf', undefined);
        await ingest(b.eps, {});
        assert.ok(b.deleted.includes(OLD));
        assert.ok(!b.deleted.includes('huddles/2026-04-01-unknown.pdf'));
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
        assert.equal(b.targeted.length, 0, 'a document arrival is for everybody — never a targeted send');
        assert.equal(b.sends.length, 2);
        assert.equal(b.sends[0].payload.title, '📰 Latest Retail Circular');
        assert.equal(b.sends[0].payload.tag, 'circular');
        assert.equal(b.sends[1].payload.title, '🗞️ Latest Marylebone Newsletter');
        assert.equal(b.sends[1].payload.tag, 'newsletter');
    });
});

// ── "Latest" means the latest — and a hand upload never silences the automatic one ──────────────
//
// Whether staff were told used to be decided by "was a document CREATED for this date". Two real
// sequences break that (functions-core-1, whole-app check 10 Nov 2026):
//  · The card files a hand upload under TODAY; the automatic flow files the evening Huddle under the
//    day it was RECEIVED — also today. So a Huddle uploaded by hand in the morning made that
//    evening's automatic Huddle a "re-send", and nobody was told the next day's plan had arrived.
//  · A back-filled OLDER document was announced as "Latest …", and the tap opened the newer one
//    staff had already read.
// The re-send guard keeps its real job: the automatic flow arriving on its OWN earlier upload (a
// retry, or two concurrent runs) stays silent.
describe('a notice says "Latest" only of the latest, and a hand upload never silences the automatic Huddle', () => {
    const snapEvent = (/** @type {string} */ date, /** @type {any} */ data) =>
        ({ params: { date }, data: data === undefined ? undefined : { data: () => data } });

    test('the automatic Huddle that lands on a hand-uploaded date IS announced', async () => {
        const b = build({
            seed: { 'huddles/2026-08-30': { date: '2026-08-30', storagePath: 'huddles/2026-08-30-man1.pdf', fileType: 'pdf', uploadedBy: 'G. Miller' } },
            objects: ['huddles/2026-08-30-man1.pdf'],
        });
        const out = await ingest(b.eps, { date: '2026-08-30' });
        assert.equal(out.code, 200);
        assert.equal(b.store.get('huddles/2026-08-30').uploadedBy, 'power-automate');
        assert.equal(b.sends.length, 1, 'a Huddle uploaded by hand this morning silenced this evening\'s automatic one');
        assert.equal(b.sends[0].payload.tag, 'huddle');
    });

    test('the automatic flow arriving on its OWN earlier upload stays silent (a retry, a double run)', async () => {
        const b = build({
            seed: { 'huddles/2026-08-30': { date: '2026-08-30', storagePath: 'huddles/2026-08-30-pa1.pdf', fileType: 'pdf', uploadedBy: 'power-automate' } },
            objects: ['huddles/2026-08-30-pa1.pdf'],
        });
        assert.equal((await ingest(b.eps, { date: '2026-08-30' })).code, 200);
        assert.equal(b.sends.length, 0);
    });

    test('an automatic Huddle OLDER than the latest is stored, and not announced as "Latest"', async () => {
        const b = build({ seed: { 'huddles/2026-08-31': { date: '2026-08-31', storagePath: 'huddles/2026-08-31-x.pdf', fileType: 'pdf', uploadedBy: 'G. Miller' } } });
        const out = await ingest(b.eps, { date: '2026-08-30' });
        assert.equal(out.code, 200);
        assert.ok(b.store.has('huddles/2026-08-30'), 'the back-filled Huddle is still kept');
        assert.equal(b.sends.length, 0, 'a tap on "Latest Huddle" would have opened the 31st, which staff already had');
    });

    for (const [name, collection, older, newer] of [
        ['onCircularCreated', 'circulars', '2026-10-30', '2026-11-06'],
        ['onNewsletterCreated', 'newsletters', '2026-09-01', '2026-10-01'],
        ['onHuddleCreated', 'huddles', '2026-08-29', '2026-08-30'],
    ]) {
        test(`${name}: a back-filled older document is not announced; the newest still is`, async () => {
            const doc = (/** @type {string} */ d) => ({ date: d, storagePath: `${collection}/${d}-a.pdf`, fileType: 'pdf', uploadedBy: 'G. Miller' });
            const b = build({ seed: { [`${collection}/${older}`]: doc(older), [`${collection}/${newer}`]: doc(newer) } });
            await b.eps[name].run(snapEvent(older, doc(older)));
            assert.equal(b.sends.length, 0, `${older} was announced as the latest while ${newer} is`);
            await b.eps[name].run(snapEvent(newer, doc(newer)));
            assert.equal(b.sends.length, 1, 'the newest document must still be announced');
        });
    }

    test('when the latest cannot be read, the arrival is still announced — silence is the failure nobody sees', async () => {
        const b = build({ seed: { 'circulars/2026-11-06': { date: '2026-11-06', storagePath: 'circulars/2026-11-06-a.pdf' } } });
        b.failLatestRead(Object.assign(new Error('unavailable'), { code: 14 }));
        await b.eps.onCircularCreated.run(snapEvent('2026-11-06', { date: '2026-11-06' }));
        assert.equal(b.sends.length, 1);
    });

    test('an ingest dated after London\'s tomorrow is refused before Storage — it would shadow every later Huddle', async () => {
        const b = build();                                           // now = 30 Aug 2026
        const out = await ingest(b.eps, { date: '2026-09-01' });
        assert.equal(out.code, 400);
        assert.equal(b.saved.length, 0);
        assert.equal(b.store.size, 0);
        assert.equal((await ingest(b.eps, { date: '2026-08-31' })).code, 200, 'tomorrow is a real date for a Huddle, as on the card');
    });
});

// ── the scheduler ──────────────────────────────────────────────────────────────────────────────

describe('sendPayReminderNotification — a daily schedule that must fire on exactly the cutoff Saturdays', () => {
    test('an ordinary day sends nothing', async () => {
        const b = build();
        b.setNow({ year: 2026, month: 7, day: 30 });            // Sun 30 Aug 2026 — not a cutoff
        await b.eps.sendPayReminderNotification.run({});
        assert.equal(b.sends.length, 0);
        assert.equal(b.targeted.length, 0);
    });

    test('a cutoff Saturday sends the pay reminder deep-linked to the payday six days on', async () => {
        const b = build();
        b.setNow({ year: 2026, month: 1, day: 7 });             // Sat 7 Feb 2026 — the first cutoff
        await b.eps.sendPayReminderNotification.run({});
        assert.equal(b.sends.length, 0, 'the pay reminder is never a broadcast (owner decision, 10 Nov 2026)');
        assert.equal(b.targeted.length, 1);
        const p = b.targeted[0].payload;
        assert.equal(p.tag, 'pay-reminder');
        assert.match(p.title, /^💷 Payday Friday — /);
        assert.ok(p.url.includes('payday=2026-02-13'), `deep link carries the payday: ${p.url}`);
        assert.match(p.body, /13 February/);
    });
});

// ── WHOSE PHONES the pay reminder reaches (owner decision, 10 November 2026) ────────────────────
//
// The block above stubs the transport, which answers "was it sent" and not "to whose phone". A
// targeted send is only as narrow as the uids it is handed AND the owner query that turns them into
// devices, so this block runs the REAL push.js — its owner query, its endpoint guard, its fail-closed
// branches — against a fake web-push that records the ENDPOINTS it was asked to reach.
//
// The expected audience is not typed here. It comes from the client's own `gradeForRole`, the
// function the Pay Calculator turns a member away with, so pricing another grade there without
// adding it to PAY_REMINDER_GRADES (functions/pay-reminder.js) fails this block rather than missing
// those members.

/** Everybody the Pay Calculator prices, among the people on the roster today (a leaver is hidden). */
const PRICED = new Set(teamMembers
    .filter(m => !m.hidden && !m.managerOnly && gradeForRole(m.role) !== null)
    .map(m => m.name));
const roleOf = (/** @type {string} */ name) => (teamMembers.find(m => m.name === name) || {}).role;
const deviceOf = (/** @type {string} */ name) => `https://fcm.googleapis.com/fcm/send/${encodeURIComponent(name)}`;
const LEGACY_DEVICE = 'https://fcm.googleapis.com/fcm/send/legacy-unowned';
const PIN_DEVICE    = 'https://fcm.googleapis.com/fcm/send/shared-pin-pc';

/**
 * Every member on the server roster has one subscribed phone. Beside them sit the two devices a
 * targeted send must never reach: a legacy record with no owner, and a station PC on the PIN account.
 * @param {{ lookup?: (email: string) => any }} [opts]  answer (or throw) for particular emails
 */
function buildDeviceWorld({ lookup } = {}) {
    const subs = [
        ...ROSTER.activeMembers.map((/** @type {string} */ name) => ({ id: `dev:${name}`, owner: `uid:${name}`, endpoint: deviceOf(name) })),
        { id: 'legacy', owner: undefined, endpoint: LEGACY_DEVICE },
        { id: 'pin-pc', owner: 'calendar-viewer', endpoint: PIN_DEVICE },
    ];
    const sent = /** @type {{endpoint: string, payload: any}[]} */ ([]);
    const docFor = (/** @type {any} */ s) => ({
        id: s.id,
        data: () => ({ endpoint: s.endpoint, keys: { p256dh: 'p', auth: 'a' }, owner: s.owner }),
        ref: { delete: async () => {} },
    });
    const collection = (/** @type {string} */ name) => {
        assert.equal(name, 'pushSubscriptions', `the pay reminder read the ${name} collection`);
        return {
            get: async () => ({ docs: subs.map(docFor), size: subs.length, empty: subs.length === 0 }),
            where: (/** @type {string} */ field, /** @type {string} */ op, /** @type {any} */ value) => {
                // The operator is part of the query: '!=' would be everybody else's phones.
                if (op !== '==') throw new Error(`fake where(): only '==' is modelled, got ${JSON.stringify(op)}`);
                const hit = subs.filter((/** @type {any} */ s) => s[field] === value);
                return { get: async () => ({ docs: hit.map(docFor), size: hit.length, empty: hit.length === 0 }) };
            },
        };
    };
    const stub = (/** @type {string} */ p, /** @type {any} */ exports) => {
        require.cache[p] = /** @type {any} */ ({ id: p, filename: p, loaded: true, exports });
    };
    stub(firePath, { getFirestore: () => ({ collection }), FieldValue: { serverTimestamp: () => SERVER_TS } });
    stub(authPath, { getAuth: () => ({ getUserByEmail: rosterAccounts(lookup) }) });
    stub(storagePath, { getStorage: () => ({ bucket: () => makeStorage().bucket }) });
    stub(webpushPath, {
        setVapidDetails: () => {},
        sendNotification: async (/** @type {any} */ sub, /** @type {string} */ payload) => {
            sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
        },
    });
    delete require.cache[pushPath];   // the REAL transport, loaded against the fakes above
    delete require.cache[payPath];
    delete require.cache[docsPath];
    const { buildDocumentEndpoints } = require('./functions/documents.js');
    const eps = buildDocumentEndpoints({
        HUDDLE_SECRET: { value: () => 'huddle-secret' },
        VAPID_PRIVATE_KEY: { value: () => 'vapid-private' },
        VAPID_PUBLIC_KEY: 'vapid-public',
        STAFF_SITE_URL: 'https://myb-roster.web.app',
        readRawBody: async (/** @type {any} */ req) => req._rawBody,
        nowInLondon: () => ({ year: 2026, month: 10, day: 14 }),   // Sat 14 Nov 2026 — the cutoff before payday 20 Nov
        isRetriableFirestoreError: () => false,
        MAX_FILE_BYTES: 20 * 1024 * 1024,
        MAX_HUDDLE_HTML_CHARS: 200_000,
        ADMIN_FUNCTION_ORIGINS: ['https://myb-roster.web.app'],
        rosterMembers: ROSTER,
    });
    return { eps, sent, reached: () => new Set(sent.map(s => s.endpoint)) };
}

describe('the pay reminder reaches CEA and CES phones only — never a Dispatcher\'s or a manager\'s', () => {

    test('the roster holds every audience this block is about, so it cannot pass by being empty', () => {
        const onRoster = (/** @type {string} */ role) => ROSTER.activeMembers.filter((/** @type {string} */ n) => roleOf(n) === role);
        for (const role of ['CEA', 'CES', 'Dispatcher', 'Management']) {
            assert.ok(onRoster(role).length > 0, `no ${role} member on the server roster — the test below would prove nothing about them`);
        }
        assert.ok([...PRICED].every(n => ['CEA', 'CES'].includes(roleOf(n))),
            'gradeForRole now prices a grade beyond CEA and CES — decide whether the pay reminder goes to it (PAY_REMINDER_GRADES, functions/pay-reminder.js)');
    });

    test('a cutoff Saturday reaches every CEA and CES phone, and no Dispatcher or manager phone', async () => {
        const w = buildDeviceWorld();
        await w.eps.sendPayReminderNotification.run({});
        const reached = w.reached();
        for (const name of ROSTER.activeMembers) {
            assert.equal(reached.has(deviceOf(name)), PRICED.has(name),
                PRICED.has(name)
                    ? `a ${roleOf(name)} member's phone was not sent the pay reminder`
                    : `a ${roleOf(name)} member's phone was sent the pay reminder — the calculator turns them away`);
        }
        assert.ok(!reached.has(LEGACY_DEVICE), 'a record with no owner was reached — a targeted send never guesses an owner');
        assert.ok(!reached.has(PIN_DEVICE), 'the shared PIN PC was reached');
        assert.equal(w.sent.length, reached.size, 'a phone was sent the reminder twice');
        for (const s of w.sent) {
            assert.equal(s.payload.tag, 'pay-reminder');
            assert.ok(s.payload.url.endsWith('/paycalc.html?payday=2026-11-20'), s.payload.url);
            assert.match(s.payload.body, /20 November/);
        }
    });

    test('when no member can be resolved, nothing is sent — never a fall-back to everyone', async () => {
        const w = buildDeviceWorld({ lookup: () => { throw Object.assign(new Error('auth unavailable'), { code: 'auth/internal-error' }); } });
        await w.eps.sendPayReminderNotification.run({});
        assert.deepEqual(w.sent, [], 'an Auth outage turned the targeted reminder into a broadcast');
    });

    test('one member whose lookup fails is skipped, and everyone else is still reached', async () => {
        const skipped = ROSTER.cea[0];
        const w = buildDeviceWorld({ lookup: (email) => {
            if (email === nameToEmail(skipped).toLowerCase()) throw Object.assign(new Error('blip'), { code: 'auth/internal-error' });
            return undefined;
        } });
        await w.eps.sendPayReminderNotification.run({});
        const reached = w.reached();
        assert.ok(!reached.has(deviceOf(skipped)));
        assert.equal(reached.size, PRICED.size - 1, 'one failed lookup cost more than that one member');
    });

    test('a roster email linked to the shared PIN account is refused — the PIN PCs are not that member', async () => {
        // A PIN holder can link a roster email to the shared account before Set up accounts reaches
        // that member. The lookup then answers with the VIEWER's uid, and every station PC on the PIN
        // would get a reminder meant for one person. Set up accounts and the admin reset refuse the
        // same account (isViewerAccount); so does this.
        const linked = ROSTER.ces[0];
        const w = buildDeviceWorld({ lookup: (email) => (email === nameToEmail(linked).toLowerCase()
            ? { uid: 'calendar-viewer', email, customClaims: { calendarViewer: true } }
            : undefined) });
        await w.eps.sendPayReminderNotification.run({});
        const reached = w.reached();
        assert.ok(!reached.has(PIN_DEVICE), 'the PIN account was treated as the member whose email it holds');
        assert.equal(reached.size, PRICED.size - 1);
    });
});

describe('sendTimetableReminder — one broadcast, on the evening before the timetable change (v24.94)', () => {
    // Daily at 18:00 London with a one-date guard, not a yearly cron: a function nobody remembers to
    // delete must not fire on 12 December of some later year. Organised by what a wrong answer costs —
    // a day early and the Sunday is "this Sunday" to nobody; the day itself and it announces a change
    // that happened this morning; another year and 50 staff are told about a timetable that is not coming.
    test('an ordinary evening sends nothing', async () => {
        const b = build();
        b.setNow({ year: 2026, month: 11, day: 11 });           // Fri 11 Dec 2026
        await b.eps.sendTimetableReminder.run({});
        assert.equal(b.sends.length, 0);
    });

    test('the day itself sends nothing — the reminder is for the evening before', async () => {
        const b = build();
        b.setNow({ year: 2026, month: 11, day: 13 });           // Sun 13 Dec 2026, the change
        await b.eps.sendTimetableReminder.run({});
        assert.equal(b.sends.length, 0);
    });

    test('Saturday 12 December 2026 sends the reminder to everyone, deep-linked to the Trains page', async () => {
        const b = build();
        b.setNow({ year: 2026, month: 11, day: 12 });
        await b.eps.sendTimetableReminder.run({});
        assert.equal(b.sends.length, 1);
        const { payload, tag } = b.sends[0];
        assert.equal(tag, '[timetable]');
        assert.equal(payload.tag, 'timetable');
        assert.equal(payload.title, '🚆 New timetable from Sunday');
        assert.match(payload.body, /13 December/);
        assert.doesNotMatch(payload.body, /!/, 'calm tone — no exclamation marks');
        assert.ok(payload.url.endsWith('/trains.html'), payload.url);
    });

    test('the change date lives in two files and one weekday, and they agree (v24.96)', () => {
        // functions/documents.js guards the push on TIMETABLE_CHANGE; trains-data.js draws the page from
        // CHANGE_DATE; the headline says "from Sunday". Three places, read as text so the check needs no
        // import of either, and so the next change cannot move one without the others.
        const here = new URL('.', import.meta.url);
        const fn = readFileSync(new URL('./functions/documents.js', here), 'utf8');
        const data = readFileSync(new URL('./trains-data.js', here), 'utf8');
        const m = /TIMETABLE_CHANGE = Object\.freeze\(\{ year: (\d{4}), month: (\d{1,2}), day: (\d{1,2}) \}\)/.exec(fn);
        const c = /export const CHANGE_DATE = '(\d{4})-(\d{2})-(\d{2})'/.exec(data);
        assert.ok(m && c, 'both constants are where this test expects them');
        const fromFn = `${m[1]}-${String(Number(m[2]) + 1).padStart(2, '0')}-${m[3].padStart(2, '0')}`;
        assert.equal(fromFn, `${c[1]}-${c[2]}-${c[3]}`, 'the push and the page name the same change date');
        assert.equal(new Date(Date.UTC(Number(c[1]), Number(c[2]) - 1, Number(c[3]))).getUTCDay(), 0, 'the headline says "from Sunday" — the date must be one');
        assert.match(fn, /TIMETABLE_CHANGE_WORDS/, 'the body takes its words from the constant, not a typed date');
    });

    test('the same date in another year sends nothing', async () => {
        const b = build();
        b.setNow({ year: 2027, month: 11, day: 12 });
        await b.eps.sendTimetableReminder.run({});
        assert.equal(b.sends.length, 0);
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

    test('a token that still verifies by signature but has been REVOKED is refused (checkRevoked)', async () => {
        // The handler's own header calls this load-bearing: Firebase does not check revocation unless
        // asked. Every door is tried, because each is a different way a token reaches the signer.
        for (const claims of [MEMBER_GM, { admin: true }, { calendarViewer: true, firebase: { sign_in_provider: 'custom' } }]) {
            const w = build({ seed: PUBLISHED });
            w.setClaims(claims);
            w.setRevoked(true);
            assert.equal((await askForUrl(w.eps, { kind: 'huddle' })).code, 401, `${JSON.stringify(claims)} was let through`);
            assert.deepEqual(w.signed, [], 'a revoked caller reached the signer');
        }
    });

    test('a token with NO door is 403, and still nothing is signed', async () => {
        const w = build({ seed: PUBLISHED });
        w.setClaims({ uid: 'x' });               // authenticated, but no name / admin / calendarViewer
        assert.equal((await askForUrl(w.eps, { kind: 'huddle' })).code, 403);
        assert.deepEqual(w.signed, [], 'a caller the rules would refuse got a URL');
    });

    test('a `name` that is not the member\'s own account is NO door (v24.23)', async () => {
        // Firebase copies a self-set display name into `name`. Each of these is a real way a token
        // arrives carrying "G. Miller" without being him, and the member door must refuse all of them.
        for (const claims of [
            { name: 'G. Miller', firebase: { sign_in_provider: 'anonymous' } },
            { name: 'G. Miller', firebase: { sign_in_provider: 'custom' } },
            { name: 'G. Miller', email: 'attacker@myb-roster.local', firebase: { sign_in_provider: 'password' } },
            { name: 'G. Miller' },
        ]) {
            const w = build({ seed: PUBLISHED });
            w.setClaims(claims);
            assert.equal((await askForUrl(w.eps, { kind: 'huddle' })).code, 403, `${JSON.stringify(claims)} got a URL`);
            assert.deepEqual(w.signed, [], 'an impostor reached the signer');
        }
    });

    test('each of the three doors is admitted', async () => {
        for (const claims of [MEMBER_GM, { admin: true }, { calendarViewer: true, firebase: { sign_in_provider: 'custom' } }]) {
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
            w.setClaims(MEMBER_GM);
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
        w.setClaims(MEMBER_GM);
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
        w.setClaims(MEMBER_GM);
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

    test('the response names the FILE it signed — the exact path, not merely the kind (v24.33)', async () => {
        // The client reads "the latest" from Firestore and this endpoint reads it again; an upload
        // between the two leaves the client holding one document and a url for another. The path is
        // versioned per upload, so it is what the client compares — and it must be the path the
        // SIGNER was given, or the comparison is checking a claim rather than the file.
        const w = build({ seed: PUBLISHED });
        w.setClaims({ admin: true });
        for (const kind of ['huddle', 'circular', 'newsletter']) {
            const out = await askForUrl(w.eps, { kind });
            assert.equal(out.code, 200);
            assert.equal(out.body.storagePath, w.signed.at(-1).path,
                `${kind}: the response names a different file from the one that was signed`);
        }
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
        w.setClaims(MEMBER_GM);
        w.failSigning();
        const out = await askForUrl(w.eps, { kind: 'huddle' });
        assert.equal(out.code, 503,
            'a signing failure — overwhelmingly the missing serviceAccountTokenCreator grant — must '
            + 'be a 503 the client treats as "use the old way", not a 500 and not a 200 with no url');
        assert.equal(out.body.url, undefined);
    });
});

// ── The two v24.18 properties, both invisible from the response ────────────────────────────────
//
// Neither of these changes a status code or a body, so every test above passes either way. That is
// precisely why they need their own block: an endpoint can be correct to its caller and wrong to
// the person it is about, or wrong about which FILE it just released.
describe('getDocumentUrl — it signs the kind it was asked for, and says nothing about who asked', () => {

    test('a document whose storagePath belongs to another collection is REFUSED, not signed', async () => {
        // The external review's finding, driven through the real handler. The signer bypasses
        // storage.rules, so this path would otherwise have come back as a working read URL for a
        // file the circulars read rule never covered.
        const w = build({ seed: {
            'circulars/2026-08-28': { date: '2026-08-28', storagePath: 'roster/2026-08-28.pdf', fileType: 'pdf' },
        } });
        w.setClaims(MEMBER_GM);
        const out = await askForUrl(w.eps, { kind: 'circular' });
        assert.equal(out.code, 503, 'a cross-collection storagePath was signed');
        assert.equal(out.body.url, undefined);
    });

    test('and a HUDDLE path in a circulars document is refused too — both are real paths', async () => {
        // Not a strawman: `huddles/…` is a path this app writes every day. What makes it unsignable
        // here is only that it is paired with the wrong kind, which is the whole point of binding.
        const w = build({ seed: {
            'circulars/2026-08-28': { date: '2026-08-28', storagePath: 'huddles/2026-08-28.pdf', fileType: 'pdf' },
        } });
        w.setClaims(MEMBER_GM);
        assert.equal((await askForUrl(w.eps, { kind: 'circular' })).code, 503);
    });

    test('the happy path still signs — the binding refuses the wrong file, not every file', async () => {
        // The direction a tightening gets wrong. Without this, deleting the whole check and
        // returning false would leave the two tests above green.
        const w = build({ seed: PUBLISHED });
        w.setClaims(MEMBER_GM);
        const out = await askForUrl(w.eps, { kind: 'circular' });
        assert.equal(out.code, 200);
        assert.ok(out.body.url, 'a correctly-pathed circular did not sign');
    });

    test('no successful signing writes a member name to the log', async () => {
        // Once the client calls this endpoint, every document a member opens goes through here. A
        // named log line would make that a named access trail, at the exact release that shipped
        // the privacy improvement — and against how the app treats the same question elsewhere:
        // `recordOpen` sends an increment and keeps the identity on-device.
        const said = [];
        const realLog = console.log;
        console.log = (...a) => { said.push(a.map(String).join(' ')); };
        try {
            const w = build({ seed: PUBLISHED });
            w.setClaims(MEMBER_GM);
            assert.equal((await askForUrl(w.eps, { kind: 'huddle' })).code, 200);
        } finally {
            console.log = realLog;
        }
        const signed = said.filter(l => l.includes('[getDocumentUrl]'));
        assert.ok(signed.length > 0,
            'nothing was logged at all — this test would then pass on an endpoint that had stopped '
            + 'logging for some other reason, and prove nothing about the name');
        for (const line of signed) {
            assert.doesNotMatch(line, /G\. Miller/,
                `the signing log names the member: "${line}". Log the DOOR (member / admin / pin), `
                + 'never the person — see the comment beside that line in functions/documents.js.');
        }
    });
});

// ── rotateDocumentLinks ─────────────────────────────────────────────────────────────────────────
//
// The rotation's own rules are doc-link-rotation.test.mjs, against plain fakes. These run the REAL
// handler — the admin door, the body that turns a preview into a run, the 503 that promises nothing
// changed — through to the resulting records and keys, because a perfect helper behind the wrong
// door, or behind a body reader that took "true" for true, is the failure those tests cannot see.

/** Drive rotateDocumentLinks and wait for its answer. */
async function askToRotate(/** @type {any} */ eps, /** @type {any} */ body,
    { auth = /** @type {string|null} */ ('Bearer tok'), method = 'POST', rawBody = /** @type {any} */ (undefined) } = {}) {
    const { res, out, done } = makeRes();
    const headers = /** @type {Record<string, string|undefined>} */ ({
        authorization: auth ?? undefined, origin: 'https://myb-roster.web.app',
    });
    const req = {
        method, headers, url: '/', path: '/', query: {}, body, rawBody,
        get(/** @type {string} */ h) { return headers[String(h).toLowerCase()]; },
        header(/** @type {string} */ h) { return this.get(h); },
    };
    const p = eps.rotateDocumentLinks(req, res);
    await Promise.race([done, p]);
    await p?.catch?.(() => {});
    return out;
}

const ROT_BUCKET = 'myb-roster.appspot.com';
const dlink = (/** @type {string} */ path, /** @type {string} */ key) =>
    `https://firebasestorage.googleapis.com/v0/b/${ROT_BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=${key}`;
/** A Huddle and a Circular whose stored links open their files with an OLD key, and one file nothing points at. */
const ROTATABLE = () => ({
    seed: {
        'huddles/2026-11-12':   { date: '2026-11-12', storagePath: 'huddles/2026-11-12-a1.pdf', fileType: 'pdf',
            storageUrl: dlink('huddles/2026-11-12-a1.pdf', 'old-h') },
        'circulars/2026-11-06': { date: '2026-11-06', storagePath: 'circulars/2026-11-06-b2.docx', fileType: 'docx',
            storageUrl: dlink('circulars/2026-11-06-b2.docx', 'old-c') },
    },
    objects: ['huddles/2026-11-12-a1.pdf', 'circulars/2026-11-06-b2.docx', 'huddles/2026-08-01-left.pdf'],
    keys: { 'huddles/2026-11-12-a1.pdf': 'old-h', 'circulars/2026-11-06-b2.docx': 'old-c', 'huddles/2026-08-01-left.pdf': 'old-l' },
});
const keyIn = (/** @type {string} */ url) => new URL(url).searchParams.get('token');

describe('rotateDocumentLinks — the admin door, and a preview unless asked', () => {
    test('no token, a revoked admin, a member, a manager and a PIN viewer are refused — and nothing is written', async () => {
        const doors = [
            [null, false, 401], [{ admin: true }, true, 401],
            [MEMBER_GM, false, 403], [{ ...MEMBER_GM, manager: true }, false, 403],
            [{ calendarViewer: true, firebase: { sign_in_provider: 'custom' } }, false, 403],
        ];
        for (const [claims, revoked, code] of /** @type {[any, boolean, number][]} */ (doors)) {
            const w = build(ROTATABLE());
            w.setClaims(claims);
            w.setRevoked(revoked);
            const out = await askToRotate(w.eps, { rotate: true });
            assert.equal(out.code, code, `${JSON.stringify(claims)} (revoked: ${revoked}) got ${out.code}`);
            assert.deepEqual(w.metaWrites, [], `${JSON.stringify(claims)} reached a file`);
            assert.equal(keyIn(w.store.get('huddles/2026-11-12').storageUrl), 'old-h', `${JSON.stringify(claims)} reached a record`);
        }
    });

    test('GET is refused before anything else happens', async () => {
        const w = build(ROTATABLE());
        w.setClaims({ admin: true });
        assert.equal((await askToRotate(w.eps, undefined, { method: 'GET' })).code, 405);
        assert.deepEqual(w.metaWrites, []);
    });

    test('an admin whose body does not say rotate: true exactly gets a PREVIEW, and nothing changes', async () => {
        for (const body of [undefined, {}, { rotate: 'true' }, { rotate: 1 }, { preview: true }]) {
            const w = build(ROTATABLE());
            w.setClaims({ admin: true });
            const out = await askToRotate(w.eps, body);
            assert.equal(out.code, 200, JSON.stringify(out.body));
            assert.equal(out.body.rotate, false, `${JSON.stringify(body)} ran the rotation`);
            assert.equal(out.body.files, 3);
            assert.equal(out.body.linked, 2);
            assert.equal(out.body.unlinkedWithKey, 1);
            assert.deepEqual(w.metaWrites, [], `${JSON.stringify(body)} changed a file`);
            assert.equal(keyIn(w.store.get('huddles/2026-11-12').storageUrl), 'old-h');
        }
    });
});

describe('rotateDocumentLinks — asked to rotate, every old link stops and the stored links follow', () => {
    test('each record\'s stored link now opens its file with a NEW key, the only key that file accepts', async () => {
        const w = build(ROTATABLE());
        w.setClaims({ admin: true });
        const out = await askToRotate(w.eps, { rotate: true });
        assert.equal(out.code, 200, JSON.stringify(out.body));
        assert.equal(out.body.rotate, true);
        assert.equal(out.body.rotated, 2);
        assert.equal(out.body.cleared, 1);
        assert.deepEqual(out.body.failed, []);
        for (const [rec, fp, old] of [['huddles/2026-11-12', 'huddles/2026-11-12-a1.pdf', 'old-h'],
            ['circulars/2026-11-06', 'circulars/2026-11-06-b2.docx', 'old-c']]) {
            const data = w.store.get(rec);
            const fresh = keyIn(data.storageUrl);
            assert.notEqual(fresh, old, `${rec} kept its old link`);
            assert.match(String(fresh), /^[0-9a-f-]{36}$/, `${rec}'s new key is not a random UUID: ${fresh}`);
            assert.equal(w.meta.get(fp)?.firebaseStorageDownloadTokens, fresh, `${fp} still answers another key`);
            assert.equal(data.storagePath, fp, 'the rotation touched more of the record than its link');
        }
        assert.equal(w.meta.get('huddles/2026-08-01-left.pdf')?.firebaseStorageDownloadTokens, undefined,
            'a file nothing points at kept a key');
        assert.ok(w.objects.has('huddles/2026-08-01-left.pdf'), 'a file was deleted');
        assert.deepEqual(w.deleted, []);
        // Through the real handler too: every key write named the object it read, so an upload landing
        // mid-run is refused (412) rather than overwritten.
        assert.ok(w.metaWrites.length > 0 && w.metaWrites.every(m => m.guarded), JSON.stringify(w.metaWrites));
    });

    test('an upload whose file lands mid-run, its record still to come, keeps its key — on the handler’s own clock', async () => {
        // The uploaders' real shape: a NEW path, the file and its key first, the record after. The
        // handler passes no clock, so this is the production age check, against the time now.
        const NEW = 'huddles/2026-11-13-ab12.pdf';
        const w = build(ROTATABLE());
        w.setClaims({ admin: true });
        w.beforeList(() => {
            w.objects.add(NEW);
            w.created.set(NEW, new Date().toISOString());
            w.meta.set(NEW, { firebaseStorageDownloadTokens: 'fresh' });
        });
        const out = await askToRotate(w.eps, { rotate: true });
        w.store.set('huddles/2026-11-13', { date: '2026-11-13', storagePath: NEW, fileType: 'pdf', storageUrl: dlink(NEW, 'fresh') });
        assert.equal(out.code, 200, JSON.stringify(out.body));
        assert.equal(w.meta.get(NEW)?.firebaseStorageDownloadTokens, 'fresh', 'the new record holds a dead link');
        assert.deepEqual({ rotated: out.body.rotated, cleared: out.body.cleared, unlinkedTooNew: out.body.unlinkedTooNew },
            { rotated: 2, cleared: 1, unlinkedTooNew: 1 }, 'the year-old unused file still loses its key');
    });

    test('the body may arrive unparsed — rotate: true in raw bytes is still a run', async () => {
        const w = build(ROTATABLE());
        w.setClaims({ admin: true });
        const raw = Buffer.from(JSON.stringify({ rotate: true }));
        const out = await askToRotate(w.eps, raw, { rawBody: raw });
        assert.equal(out.body.rotate, true);
        assert.equal(out.body.rotated, 2);
    });

    test('a read failure is a 503 that says nothing changed — and nothing did', async () => {
        const w = build(ROTATABLE());
        w.setClaims({ admin: true });
        w.failListing();
        const out = await askToRotate(w.eps, { rotate: true });
        assert.equal(out.code, 503);
        assert.match(out.body.error, /nothing was changed/);
        assert.equal(out.body.changed, false, 'the card reads this field, not the words');
        assert.deepEqual(w.metaWrites, []);
        assert.equal(keyIn(w.store.get('huddles/2026-11-12').storageUrl), 'old-h');
    });
});
