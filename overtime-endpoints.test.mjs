/**
 * overtime-endpoints.test.mjs — the Overtime endpoints, actually EXECUTED.
 * Run with: npm run test:functions   (needs firebase-admin/firebase-functions from functions/node_modules)
 *
 * ── WHY THIS EXISTS, SPECIFICALLY ───────────────────────────────────────────────────────────────
 * v20.50 is the standing lesson: `unlockCalendarViewer` was dark-deployed, signed off on a GET→405
 * and a wrong-PIN→401, and neither of those reaches `createCustomToken` — so the minting path had
 * never run in production, and it 500'd the moment a real PIN arrived. `functions-surface.test.mjs`
 * would not have caught it either: it loads the module and reads `Object.keys`, which proves the
 * handlers were DEFINED, not that any of them works.
 *
 * So this suite drives each handler end to end against a fake Firestore and a fake token verifier.
 * Everything between the HTTP boundary and the database is real code: the auth ladder, the phase
 * decision, the batch, the transaction, the conflict payload.
 *
 * ORGANISED BY WHAT GOES WRONG. Each block is a way this layer can be broken while every pure test
 * in overtime-core.test.mjs stays green — because the rules being right is not the same as the
 * orchestration calling them.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const OT = require('./functions/overtime-core.js');

// ── Fake boundaries ─────────────────────────────────────────────────────────────────────────────

/** A fixed instant the fake server timestamp resolves to, so revisions have a readable acceptedAt. */
const SERVER_NOW = Date.parse('2026-08-17T09:00:00Z');

/**
 * Minimal Firestore: paths → data, with the four shapes this module uses.
 *
 * `onRead` wraps EVERY collection read, however it was reached. Instrumenting `db.collection` from
 * outside does not work — `windowCounts` reaches its subcollections through a DOC ref, so an
 * external wrapper sees only the one top-level read and reports a concurrency of 1 for code that
 * is fully parallel. That false negative is exactly what this hook exists to prevent.
 */
/**
 * The sentinel `FieldValue.delete()` returns. A plain object identity, compared by reference — the
 * real one is opaque too, and modelling it as a magic string would let a stored string that happened
 * to match remove a field.
 */
const DELETE_SENTINEL = { __delete: true };

/** Apply a patch the way Firestore does, honouring delete sentinels. */
function applyPatch(current, patch) {
    const next = { ...(current || {}) };
    for (const [k, v] of Object.entries(patch)) {
        if (v === DELETE_SENTINEL) delete next[k];
        else next[k] = v;
    }
    return next;
}

function makeDb(seed = {}, onRead = null) {
    const store = new Map(Object.entries(seed));
    const snap = (path) => ({
        id: path.split('/').pop(),
        exists: store.has(path),
        ref: docRef(path),
        data: () => store.get(path),
    });
    /** The documents directly under a collection path — the fake's one membership rule. */
    function childKeys(path) {
        const prefix = `${path}/`;
        return [...store.keys()]
            .filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
            .sort();
    }
    function collRef(path, filter = null) {
        const keys = () => (filter ? childKeys(path).filter(filter) : childKeys(path));
        return {
            path,
            doc: (id) => docRef(`${path}/${id}`),
            // Equality AND the one inequality the code uses (`retentionUntil > now`, v21.94). The
            // ONE property worth modelling faithfully is the same for both: a document MISSING the
            // field never matches. That is why `windowCounts` counts the withdrawn and subtracts
            // instead of filtering for the rest — a fake that matched absent fields would make the
            // wrong design pass here — and it is also why the retention bound on
            // `getMyOvertimeState` is safe: every window has carried `retentionUntil` since the
            // feature shipped, and a hypothetical one without it would be dropped, not kept.
            //
            // Timestamps are compared through `toMillis()` on BOTH sides, because that is the only
            // thing the fake's stamps and `admin.firestore.Timestamp.fromMillis` have in common —
            // comparing the objects themselves would silently compare `[object Object]`.
            where: (field, op, value) => {
                assert.ok(op === '==' || op === '>', 'the fake models `==` and `>` only');
                const ms = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v);
                if (op === '==') return collRef(path, k => store.get(k)?.[field] === value);
                return collRef(path, (k) => {
                    const held = store.get(k)?.[field];
                    if (held === undefined || held === null) return false;   // missing field never matches
                    return ms(held) > ms(value);
                });
            },
            // Field projection is a wire optimisation, not a behaviour: the one caller that uses
            // `.select()` reads document IDS only, which a projection never changes. Modelling it
            // as an identity keeps the fake honest about what the code actually depends on.
            select: () => collRef(path, filter),
            // The COUNT aggregation (v20.75): the same membership rule as get(), returning only
            // the integer — which is the whole point of the production change it models. It goes
            // through `onRead` like any other read, so the parallelism instrumentation still sees
            // the overview's count fan-out.
            count: () => ({
                get: async () => {
                    const done = onRead ? onRead(path) : null;
                    await new Promise(r => setImmediate(r));
                    const n = keys().length;
                    if (done) done();
                    return { data: () => ({ count: n }) };
                },
            }),
            get: async () => {
                const done = onRead ? onRead(path) : null;
                // A real read is never synchronous. Yielding is what lets the harness observe
                // overlap at all — without it every "parallel" read resolves before the next starts.
                await new Promise(r => setImmediate(r));
                const docs = keys().map(snap);
                if (done) done();
                return { docs, size: docs.length };
            },
        };
    }
    function docRef(path) {
        return {
            path,
            id: path.split('/').pop(),
            collection: (name) => collRef(`${path}/${name}`),
            get: async () => snap(path),
            update: async (patch) => { store.set(path, applyPatch(store.get(path), patch)); },
            set: async (data, opts) => {
                store.set(path, opts?.merge ? applyPatch(store.get(path), data) : data);
            },
        };
    }
    return {
        _store: store,
        collection: collRef,
        batch: () => {
            const ops = [];
            return {
                set: (ref, data) => ops.push([ref.path, data]),
                delete: (ref) => ops.push([ref.path, null]),
                // Commit is all-or-nothing here too, so a test that expects atomicity is testing
                // the same property production relies on rather than a looser fake.
                commit: async () => {
                    for (const [p, d] of ops) { if (d === null) store.delete(p); else store.set(p, d); }
                },
            };
        },
        runTransaction: async (fn) => fn({
            get: async (ref) => snap(ref.path),
            set: (ref, data, opts) => store.set(ref.path,
                opts?.merge ? { ...(store.get(ref.path) || {}), ...data } : data),
            update: (ref, patch) => store.set(ref.path, applyPatch(store.get(ref.path), patch)),
        }),
    };
}

/**
 * Install fake firebase-admin MODULES into the CommonJS cache before overtime.js requires them.
 *
 * The injection points are `firebase-admin/auth` and `firebase-admin/firestore`, not the package
 * root: since the v14 migration the handlers import those directly, and the root export no longer
 * carries `auth`/`firestore` at all. A fake left at the root would be required by nothing, and the
 * whole suite would silently run against the real SDK.
 */
function installFakeAdmin(db, tokens) {
    const fnDir = new URL('./functions/', import.meta.url).pathname;
    const authPath = require.resolve('firebase-admin/auth', { paths: [fnDir] });
    const firePath = require.resolve('firebase-admin/firestore', { paths: [fnDir] });
    const stamp = () => ({ toMillis: () => SERVER_NOW });
    const FieldValue = { serverTimestamp: stamp, delete: () => DELETE_SENTINEL };
    const Timestamp  = { fromMillis: (ms) => ({ toMillis: () => ms }) };
    const auth = {
        verifyIdToken: async (token, checkRevoked) => {
            // Revocation checking is MANDATORY here, so the fake refuses to answer without it —
            // a handler that dropped the flag would fail loudly rather than silently accepting
            // an hour-stale token from a disabled account.
            assert.equal(checkRevoked, true, 'verifyIdToken must be called with checkRevoked');
            if (!tokens[token]) throw new Error('invalid token');
            return tokens[token];
        },
    };
    const stub = (p, exports) => { require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
    stub(authPath, { getAuth: () => auth });
    stub(firePath, { getFirestore: () => db, FieldValue, Timestamp });
    return { auth: () => auth, firestore: () => db };
}

/**
 * Express-ish response capture.
 *
 * Fuller than it looks necessary, and deliberately so: `onRequest` wraps the handler in a Promise
 * that resolves on the response's `finish` event and runs the `cors` middleware first, so a plain
 * `{status, json}` stub throws `res.on is not a function` before a single line of our code runs —
 * which would make this whole suite pass vacuously if it ever silently caught the error.
 */
function makeRes() {
    const out = { code: 200, body: null, headers: {} };
    const res = new EventEmitter();
    let done = false;
    Object.assign(res, {
        status(c) { out.code = c; return res; },
        json(b)   { out.body = b; res.end(); return res; },
        send(b)   { out.body = b; res.end(); return res; },
        setHeader(k, v) { out.headers[k] = v; return res; },
        getHeader(k)    { return out.headers[k]; },
        removeHeader(k) { delete out.headers[k]; return res; },
        set(k, v) { out.headers[k] = v; return res; },
        vary()      { return res; },
        writeHead(c) { out.code = c; return res; },
        end() {
            if (!done) { done = true; process.nextTick(() => res.emit('finish')); }
            return res;
        },
    });
    return { res, out };
}

const req = (body, token = 'tok_member', method = 'POST') => ({
    method,
    headers: { authorization: `Bearer ${token}`, origin: 'https://myb-roster.web.app' },
    body,
    url: '/', path: '/', query: {},
    get(h)    { return this.headers[String(h).toLowerCase()]; },
    header(h) { return this.get(h); },
});

// Identities, mirroring the real claim tiers.
const TOKENS = {
    tok_member:  { name: 'G. Miller', uid: 'uid_g', admin: true },     // rostered Master Admin
    tok_plain:   { name: 'S. Silva',  uid: 'uid_s' },                  // ordinary member
    tok_manager: { name: 'H. Croft',  uid: 'uid_h', manager: true },   // reviewer, not a participant
    tok_viewer:  { uid: 'calendar-viewer', calendarViewer: true },     // the shared PIN identity
};

const ROSTER = {
    maxRosterYear: 2030,
    roles: { admin: ['G. Miller'] },
    overtimeRoster: [
        { name: 'L. Springer', grade: 'CEA', startDate: null, rosterOrder: 0 },
        { name: 'G. Miller',   grade: 'CEA', startDate: null, rosterOrder: 2 },
        { name: 'S. Silva',    grade: 'CEA', startDate: null, rosterOrder: 5 },
    ],
};

const WEEK = '2026-09-05';
const M = OT.deriveMilestones(WEEK);
const DATES = OT.weekDates(M.weekStart);
const allDay = () => Object.fromEntries(DATES.map(d => [d, { mode: 'all_day' }]));
const noDays = () => Object.fromEntries(DATES.map(d => [d, { mode: 'unavailable' }]));

/** Build the endpoints against a fresh fake world. Returns handlers + the store for assertions. */
function build(seed = {}, opts = {}) {
    const db = makeDb(seed);
    installFakeAdmin(db, TOKENS);
    // Require AFTER the cache injection, and fresh each time, so the module binds the fake.
    delete require.cache[require.resolve('./functions/overtime.js')];
    const { buildOvertimeEndpoints } = require('./functions/overtime.js');
    const eps = buildOvertimeEndpoints({
        ADMIN_FUNCTION_ORIGINS: ['https://myb-roster.web.app'], rosterMembers: ROSTER, ...opts,
    });
    return { db, eps };
}

/** Invoke an onRequest handler and return { code, body }. */
async function call(handler, request) {
    const { res, out } = makeRes();
    await handler(request, res);
    return out;
}

/** A seeded, created window with G. Miller as its single restricted participant. */
function seededWindow(extra = {}) {
    return {
        [`overtimeWindows/${WEEK}`]: {
            weekEnding: WEEK, weekStart: M.weekStart,
            initialDeadlineAt: { toMillis: () => M.initialDeadlineAt },
            draftRosterDate: M.draftRosterDate,
            finalDeadlineAt: { toMillis: () => M.finalDeadlineAt },
            finalRosterDate: M.finalRosterDate,
            retentionUntil: { toMillis: () => M.retentionUntil },
            policyVersion: 1, audience: 'restricted',
        },
        [`overtimeWindows/${WEEK}/participants/G. Miller`]: {
            memberName: 'G. Miller', grade: 'CEA', rosterOrder: 2, uid: null,
        },
        ...extra,
    };
}

// Every test runs against the frozen clock below unless it says otherwise.
let realNow;
beforeEach(() => { realNow = Date.now; });
function freeze(ms) { Date.now = () => ms; }
function unfreeze() { Date.now = realNow; }

/**
 * Endpoints reached over HTTP, which is every one that owes the auth ladder.
 *
 * The exclusion is BY NAME and deliberately not "anything that doesn't look like a handler". A
 * shape test would silently drop a future HTTP endpoint whose wiring was broken — exactly the
 * endpoint most in need of sweeping — whereas an unknown name here fails the guard below and has
 * to be thought about once.
 */
const NOT_HTTP = new Set([
    // Scheduled: invoked by Cloud Scheduler, never by a browser, so there is no bearer token to
    // check and no request method to refuse. Its own protection is that it takes no input at all.
    'autoCreateOvertimeWindows',
    'purgeExpiredOvertimeWindows',
]);
const httpEndpoints = (eps) => Object.entries(eps).filter(([k]) => !NOT_HTTP.has(k));

describe('the auth ladder — the same four rungs on every endpoint', () => {
    test('the sweep below covers every HTTP endpoint there is', () => {
        // Guard the guard: the three sweeps are `for` loops, all of which pass vacuously over an
        // empty list — and a filter that over-matched would empty them without failing anything.
        const { eps } = build();
        const swept = httpEndpoints(eps).map(([k]) => k);
        assert.ok(swept.length >= 4, `only ${swept.length} endpoints swept: ${swept.join(', ')}`);
        for (const name of NOT_HTTP) {
            assert.ok(name in eps, `${name} is excluded from the auth sweep but no longer exists`);
        }
    });

    test('a GET is refused before anything else happens', async () => {
        const { eps } = build();
        for (const [name, h] of httpEndpoints(eps)) {
            const r = await call(h, req({}, 'tok_member', 'GET'));
            assert.equal(r.code, 405, name);
        }
    });

    test('an unverifiable token is 401 on every endpoint', async () => {
        const { eps } = build();
        for (const [name, h] of httpEndpoints(eps)) {
            assert.equal((await call(h, req({}, 'nonsense'))).code, 401, name);
        }
    });

    test('the Calendar viewer is refused everywhere, by name', async () => {
        // It holds `calendarViewer` and no `name`, so it falls out with every other non-member —
        // but the v20.12 audit's lesson is that "it obviously has no access" is what turns out to
        // be wrong, so it is asserted rather than inferred.
        const { eps } = build(seededWindow());
        for (const [name, h] of httpEndpoints(eps)) {
            assert.equal((await call(h, req({ weekEnding: WEEK }, 'tok_viewer'))).code, 403, name);
        }
    });

    test('an ordinary member is refused the two reviewer endpoints and allowed the two member ones', async () => {
        const { eps } = build(seededWindow());
        assert.equal((await call(eps.createOvertimeWindow, req({ weekEnding: WEEK }, 'tok_plain'))).code, 403);
        assert.equal((await call(eps.getOvertimeManagerOverview, req({}, 'tok_plain'))).code, 403);
        assert.equal((await call(eps.getMyOvertimeState, req({}, 'tok_plain'))).code, 200);
    });
});

describe('createOvertimeWindow — one code path, previewed or committed', () => {
    test('dryRun previews the exact derivation and writes NOTHING', async () => {
        freeze(Date.parse('2026-08-01T09:00:00Z'));
        const { db, eps } = build();
        const r = await call(eps.createOvertimeWindow, req({ weekEnding: WEEK, dryRun: true }));
        unfreeze();
        assert.equal(r.code, 200);
        assert.equal(r.body.dryRun, true);
        assert.equal(r.body.window.weekStart, '2026-08-30');
        assert.equal(r.body.window.expectedCount, 1, 'restricted → the admin submitter only');
        assert.equal(db._store.size, 0, 'a preview must leave no trace');
    });

    test('a real create commits the parent and every participant in ONE batch', async () => {
        freeze(Date.parse('2026-08-01T09:00:00Z'));
        const { db, eps } = build();
        const r = await call(eps.createOvertimeWindow, req({ weekEnding: WEEK }));
        unfreeze();
        assert.equal(r.body.created, true);
        assert.ok(db._store.has(`overtimeWindows/${WEEK}`));
        assert.ok(db._store.has(`overtimeWindows/${WEEK}/participants/G. Miller`));
        assert.equal(db._store.has(`overtimeWindows/${WEEK}/participants/H. Croft`), false,
            'a manager is a reviewer, never a participant');
        assert.equal(db._store.has(`overtimeWindows/${WEEK}/participants/S. Silva`), false,
            'restricted beta excludes ordinary members');
    });

    test('the preview and the committed window agree, field for field', async () => {
        // The entire reason there is no separate preview endpoint. If these ever diverge, a Manager
        // has approved a set of dates and participants that is not what was created.
        freeze(Date.parse('2026-08-01T09:00:00Z'));
        const { db, eps } = build();
        const preview = (await call(eps.createOvertimeWindow, req({ weekEnding: WEEK, dryRun: true }))).body.window;
        await call(eps.createOvertimeWindow, req({ weekEnding: WEEK }));
        unfreeze();
        const stored = db._store.get(`overtimeWindows/${WEEK}`);
        assert.equal(stored.weekStart, preview.weekStart);
        assert.equal(stored.draftRosterDate, preview.draftRosterDate);
        assert.equal(stored.finalRosterDate, preview.finalRosterDate);
        assert.equal(stored.initialDeadlineAt.toMillis(), preview.initialDeadlineAt);
        assert.equal(stored.finalDeadlineAt.toMillis(), preview.finalDeadlineAt);
        assert.equal(stored.audience, preview.audience);
    });

    test('creating the same week twice returns the existing window and does NOT re-freeze it', async () => {
        // Two reviewers pressing Create at once. The frozen participant snapshot is historical
        // truth; a second create that rewrote it would silently rewrite who was asked.
        freeze(Date.parse('2026-08-01T09:00:00Z'));
        const { db, eps } = build(seededWindow({
            [`overtimeWindows/${WEEK}/participants/SOMEONE ELSE`]: { memberName: 'SOMEONE ELSE' },
        }));
        const r = await call(eps.createOvertimeWindow, req({ weekEnding: WEEK }));
        unfreeze();
        assert.equal(r.body.existed, true);
        assert.ok(db._store.has(`overtimeWindows/${WEEK}/participants/SOMEONE ELSE`),
            'the original snapshot must survive a duplicate create');
    });

    test('validation refusals come back as machine codes, before any write', async () => {
        freeze(Date.parse('2026-08-01T09:00:00Z'));
        const { db, eps } = build();
        for (const [weekEnding, code] of [['2026-09-04', 'not-saturday'], ['2026-02-30', 'invalid-date'], ['2031-01-04', 'beyond-horizon']]) {
            const r = await call(eps.createOvertimeWindow, req({ weekEnding }));
            assert.equal(r.code, 400);
            assert.equal(r.body.error, code);
        }
        unfreeze();
        assert.equal(db._store.size, 0);
    });

    test('a population beyond the single-batch bound FAILS rather than half-creating a window', async () => {
        // A Firestore batch caps at 500 operations and creation is 1 parent + N participants. Split
        // across two batches, a window can half-exist — and a half-frozen participant population is
        // not a smaller truth, it is a false one that then reports colleagues as non-responders for
        // ever. Contrived at today's roster of ~44, which is the point: the guard has to hold when
        // nobody is thinking about it.
        freeze(Date.parse('2026-08-01T09:00:00Z'));
        const many = Array.from({ length: OT.MAX_PARTICIPANTS_PER_WINDOW + 1 },
            (_, i) => ({ name: `Member ${i}`, grade: 'CEA', startDate: null, rosterOrder: i }));
        const db = makeDb();
        installFakeAdmin(db, TOKENS);
        delete require.cache[require.resolve('./functions/overtime.js')];
        const { buildOvertimeEndpoints } = require('./functions/overtime.js');
        const eps = buildOvertimeEndpoints({
            ADMIN_FUNCTION_ORIGINS: [],
            rosterMembers: { maxRosterYear: 2030, roles: { admin: many.map(m => m.name) }, overtimeRoster: many },
        });
        const r = await call(eps.createOvertimeWindow, req({ weekEnding: WEEK }));
        unfreeze();
        assert.equal(r.code, 507);
        assert.equal(r.body.error, 'too-many-participants');
        assert.equal(db._store.size, 0, 'and nothing at all was written');
    });

    test('a window with NO participants is refused, not created empty', async () => {
        // An empty window can never receive a submission, and its counts read "0 of 0 received" —
        // which looks like a completed week rather than one nobody was asked about. The realistic
        // cause is the restricted selector finding no admin entitlement, which fails closed by
        // design, so this is where that shows up as something a reviewer can act on.
        freeze(Date.parse('2026-08-01T09:00:00Z'));
        const db = makeDb();
        installFakeAdmin(db, TOKENS);
        delete require.cache[require.resolve('./functions/overtime.js')];
        const { buildOvertimeEndpoints } = require('./functions/overtime.js');
        const eps = buildOvertimeEndpoints({
            ADMIN_FUNCTION_ORIGINS: [],
            rosterMembers: { maxRosterYear: 2030, roles: { admin: [] }, overtimeRoster: ROSTER.overtimeRoster },
        });
        const r = await call(eps.createOvertimeWindow, req({ weekEnding: WEEK }));
        unfreeze();
        assert.equal(r.code, 409);
        assert.equal(r.body.error, 'no-participants');
        assert.equal(db._store.size, 0);
    });

    test('a week whose final deadline has passed cannot be created', async () => {
        freeze(M.finalDeadlineAt + 1);
        const { eps } = build();
        const r = await call(eps.createOvertimeWindow, req({ weekEnding: WEEK }));
        unfreeze();
        assert.equal(r.body.error, 'final-deadline-passed');
    });
});

describe('getOvertimeManagerOverview — the missing window is the point', () => {
    test('the whole horizon comes back from an EMPTY database, escalating across it', async () => {
        // The single most important assertion in this file. A horizon built from existing documents
        // can only ever show what exists; the thing worth seeing is what does not.
        //
        // And the states are NOT uniform, which is the part worth pinning: the horizon starts at
        // the CURRENT week, whose deadlines went weeks ago, so a Manager opening a neglected page
        // sees the whole ladder at once — the earliest weeks already missed, one still recoverable,
        // the rest still ahead. An earlier version asserted all of them were 'not-created' and
        // failed, correctly.
        //
        // The LENGTH is read from `PLANNING_WEEKS`, never written out. It was hardcoded as 6 and
        // broke the moment the horizon grew to give six ANSWERABLE weeks — a restated count doing
        // exactly what a restated count does. The escalating prefix is what this test is really
        // about, so it is asserted directly and the tail only has to be un-created.
        freeze(Date.parse('2026-08-19T09:00:00Z'));   // a Wednesday
        const { eps } = build();
        const r = await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager'));
        unfreeze();
        assert.equal(r.code, 200);
        assert.equal(r.body.planningWeeks.length, OT.PLANNING_WEEKS);
        assert.ok(r.body.planningWeeks.every(w => w.exists === false));
        //
        // The tail reads `not-created-overdue` rather than `not-created` BECAUSE the database is
        // empty: this fixture describes a station where the schedule has never once run, so the
        // weeks it was due to create this morning and did not are exactly that. The healthy
        // steady state is asserted separately below.
        assert.deepEqual(r.body.planningWeeks.slice(0, 4).map(w => [w.weekEnding, w.state]), [
            ['2026-08-22', 'missed'],
            ['2026-08-29', 'missed'],
            ['2026-09-05', 'not-created-initial-passed'],
            ['2026-09-12', 'not-created-overdue'],
        ]);
        assert.ok(r.body.planningWeeks.slice(4).every(w => w.state === 'not-created-overdue'),
            'every week beyond the escalating prefix was due this morning and is not there');
    });

    test('a healthy schedule is silent — the weeks it made say nothing about overnight', async () => {
        // The other half of the pair, and the half that decides whether the warning is worth
        // anything: a marker that fires on a working system is a marker a reviewer learns to
        // ignore, and then it is not there when it matters. Everything the last 05:00 run was due
        // to create exists, so nothing may be flagged.
        const NOW = Date.parse('2026-08-19T09:00:00Z');
        freeze(NOW);
        const due = OT.weeksNeedingWindows(OT.lastSchedulerRun(NOW), [], { maxRosterYear: 2030 });
        assert.ok(due.length >= 2, 'fixture no longer exercises this');
        const { eps } = build(Object.fromEntries(due.map(w => [
            `overtimeWindows/${w}`, { ...OT.deriveMilestones(w), audience: 'restricted' },
        ])));
        const rows = (await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager'))).body.planningWeeks;
        unfreeze();
        assert.ok(rows.every(w => w.state !== 'not-created-overdue'),
            rows.filter(w => w.state === 'not-created-overdue').map(w => w.weekEnding).join(', '));
        // And the weeks it could never have created are untouched by any of this.
        assert.equal(rows.find(w => w.weekEnding === '2026-08-22').state, 'missed');
    });

    test('a week that only entered the horizon AFTER the last run is not called overdue', async () => {
        // The one false positive worth designing against. The horizon rolls over at midnight on a
        // Sunday and the job runs at 05:00, so for five hours a week exists on the page that no run
        // has ever been asked to create. Accusing the schedule there would fire every single week,
        // and a weekly false alarm is how a real one gets ignored.
        const NOW = Date.parse('2026-08-23T02:00:00Z');   // Sunday, 03:00 London — before 05:00
        freeze(NOW);
        const newest = OT.planningWeekEndings(NOW).at(-1);
        const dueAtLastRun = OT.weeksNeedingWindows(OT.lastSchedulerRun(NOW), [], { maxRosterYear: 2030 });
        assert.ok(!dueAtLastRun.includes(newest), 'fixture no longer exercises this');
        const { eps } = build(Object.fromEntries(dueAtLastRun.map(w => [
            `overtimeWindows/${w}`, { ...OT.deriveMilestones(w), audience: 'restricted' },
        ])));
        const rows = (await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager'))).body.planningWeeks;
        unfreeze();
        assert.equal(rows.find(w => w.weekEnding === newest).state, 'not-created',
            'the newest row is simply waiting for tonight, and must say so');
    });

    test('a missed week offers no Create, and a recoverable one does', async () => {
        // `canCreate` and `state` are computed separately, so they can disagree — and a Create
        // button on a week the server would refuse is a button that reports a failure the Manager
        // cannot act on.
        freeze(Date.parse('2026-08-19T09:00:00Z'));
        const { eps } = build();
        const rows = (await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager'))).body.planningWeeks;
        unfreeze();
        const byWeek = Object.fromEntries(rows.map(w => [w.weekEnding, w]));
        assert.equal(byWeek['2026-08-22'].canCreate, false, 'missed → no Create');
        assert.equal(byWeek['2026-09-05'].canCreate, true, 'initial passed but final still open → still creatable');
        // The FURTHEST row, read off the horizon rather than named: the horizon's length is a
        // product decision (`ANSWERABLE_WEEKS`) and a hardcoded date makes this test fail when that
        // changes, for a reason that has nothing to do with what it is checking. It did — the date
        // here was 2026-09-26, which left the horizon when six answerable weeks became three.
        assert.equal(rows[rows.length - 1].canCreate, true, 'the furthest planned week is creatable');
    });

    test('an existing week is marked created and carries derived counts', async () => {
        freeze(Date.parse('2026-08-19T09:00:00Z'));
        const { eps } = build(seededWindow());
        const r = await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager'));
        unfreeze();
        const row = r.body.planningWeeks.find(w => w.weekEnding === WEEK);
        assert.equal(row.exists, true);
        assert.equal(row.state, 'created');
        assert.equal(row.expected, 1);
        assert.equal(row.received, 0);
        assert.equal(row.noResponse, 1, 'one participant, no submission — no response, not "unavailable"');
    });

    test('counts are DERIVED, so a submission moves them without anything being recalculated', async () => {
        freeze(Date.parse('2026-08-19T09:00:00Z'));
        const { eps } = build(seededWindow({
            [`overtimeWindows/${WEEK}/submissions/G. Miller`]: { memberName: 'G. Miller', currentRevision: 1, days: allDay() },
        }));
        const r = await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager'));
        unfreeze();
        const row = r.body.planningWeeks.find(w => w.weekEnding === WEEK);
        assert.equal(row.received, 1);
        assert.equal(row.noResponse, 0);
    });

    test('a created window keeps the milestones it was CREATED with, not freshly derived ones', async () => {
        // The frozen-timetable invariant, at the boundary. A window stored under an older policy
        // must not silently acquire today's dates when a Manager opens the page.
        freeze(Date.parse('2026-08-19T09:00:00Z'));
        const odd = seededWindow();
        odd[`overtimeWindows/${WEEK}`].finalRosterDate = '1999-01-01';
        const { eps } = build(odd);
        const r = await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager'));
        unfreeze();
        assert.equal(r.body.planningWeeks.find(w => w.weekEnding === WEEK).finalRosterDate, '1999-01-01');
    });

    test('expired windows are omitted from the retained list', async () => {
        freeze(M.retentionUntil + 1);
        const { eps } = build(seededWindow());
        const r = await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager'));
        unfreeze();
        assert.equal(r.body.retained.length, 0,
            'behaviour must not depend on whether the purge has run');
    });

    test('per-week counts are fetched in parallel, not one week after another', async () => {
        // Six weeks × two subcollection reads, awaited in a loop, is twelve sequential round trips
        // before a Manager sees anything — for data with no ordering between weeks. The fake
        // records the ORDER reads are ISSUED in: parallel means every read starts before any
        // resolves, which a sequential loop can never produce.
        freeze(Date.parse('2026-08-19T09:00:00Z'));
        const seed = {};
        for (const w of ['2026-08-22', '2026-08-29', '2026-09-05']) {
            seed[`overtimeWindows/${w}`] = { ...seededWindow()[`overtimeWindows/${WEEK}`], weekEnding: w };
            seed[`overtimeWindows/${w}/participants/G. Miller`] = { memberName: 'G. Miller' };
        }
        // MEASURE the concurrency rather than assert the answers — correct counts come out of a
        // sequential loop too, so an assertion on them proves nothing about the thing under test.
        let inFlight = 0, maxInFlight = 0;
        const db = makeDb(seed, () => {
            inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
            return () => { inFlight--; };
        });
        installFakeAdmin(db, TOKENS);
        delete require.cache[require.resolve('./functions/overtime.js')];
        const { buildOvertimeEndpoints } = require('./functions/overtime.js');
        const eps = buildOvertimeEndpoints({ ADMIN_FUNCTION_ORIGINS: [], rosterMembers: ROSTER });
        const r = await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager'));
        unfreeze();
        assert.equal(r.code, 200);
        const counted = r.body.planningWeeks.filter((/** @type {any} */ w) => w.exists);
        assert.equal(counted.length, 3, 'all three seeded weeks were counted');
        assert.ok(counted.every((/** @type {any} */ w) => w.expected === 1));
        // Each week's own pair is already concurrent, so a sequential OUTER loop peaks at 2.
        // Anything above that can only come from the weeks overlapping each other.
        assert.ok(maxInFlight > 2,
            `reads peaked at ${maxInFlight} concurrent — the weeks are being counted one after another`);
    });

    test('serverNow comes back, because no client clock may decide what is shown', async () => {
        freeze(1234567890);
        const { eps } = build();
        const r = await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager'));
        unfreeze();
        assert.equal(r.body.serverNow, 1234567890);
    });
});

describe('withdrawal means the same thing to the member as to the reviewer (v21.20)', () => {
    // ── THE DEFECT ──────────────────────────────────────────────────────────────────────────────
    //
    // The reviewer's workspace has excluded withdrawn participants from its counts and panels since
    // v20.95. Both member endpoints checked only whether the participant document EXISTED — and a
    // withdrawal is a flag on that document, never a delete, precisely so the record survives. So a
    // withdrawn member kept the form, could fill it in, and got "✓ Availability submitted" back,
    // while H. Croft's screen said they were not part of the week. Two contradictory truths about
    // one week, which is the failure this whole feature is arranged to avoid.
    //
    // Found by external review of v21.18.
    const withdrawnWindow = () => seededWindow({
        [`overtimeWindows/${WEEK}/participants/G. Miller`]: {
            memberName: 'G. Miller', grade: 'CEA', rosterOrder: 2, uid: null,
            withdrawn: true, withdrawnBy: 'H. Croft',
        },
    });

    test('a withdrawn member is not offered the week at all', async () => {
        freeze(M.initialDeadlineAt - 86400000);
        const { eps } = build(withdrawnWindow());
        const r = await call(eps.getMyOvertimeState, req({}, 'tok_member'));
        unfreeze();
        assert.equal(r.code, 200);
        assert.deepEqual(r.body.windows, [],
            'the week is theirs only while they are being asked for it');
    });

    test('and cannot submit to it, even holding a page opened before the withdrawal', async () => {
        // The half that MATTERS. Hiding the window is a courtesy; a client restored from the
        // back/forward cache, or simply left open, still has the form and the button.
        freeze(M.initialDeadlineAt - 86400000);
        const { db, eps } = build(withdrawnWindow());
        const r = await call(eps.submitOvertimeAvailability,
            req({ weekEnding: WEEK, days: noDays(), ifRevision: 0,
                clientMutationId: 'mid-withdrawn-1' }, 'tok_member'));
        unfreeze();
        assert.equal(r.code, 403);
        assert.equal(r.body.error, 'withdrawn',
            'a distinct code from not-a-participant — the member was asked, and has been stood down');
        assert.equal(db._store.has(`overtimeWindows/${WEEK}/submissions/G. Miller`), false,
            'and nothing was written');
    });

    test('"Ask again" gives the week straight back', async () => {
        // Withdrawal is a flag, so restoring is the whole remedy — nothing to undelete.
        freeze(M.initialDeadlineAt - 86400000);
        const { eps } = build(withdrawnWindow());
        const back = await call(eps.withdrawOvertimeParticipant,
            req({ weekEnding: WEEK, memberName: 'G. Miller', withdrawn: false }, 'tok_member'));
        assert.equal(back.code, 200);
        const r = await call(eps.getMyOvertimeState, req({}, 'tok_member'));
        unfreeze();
        assert.equal(r.body.windows.length, 1, 'asked again, so the week is theirs again');
    });

    test('somebody who is NOT withdrawn is unaffected — guard the guard', async () => {
        freeze(M.initialDeadlineAt - 86400000);
        const { eps } = build(seededWindow());
        const r = await call(eps.getMyOvertimeState, req({}, 'tok_member'));
        unfreeze();
        assert.equal(r.body.windows.length, 1, 'the ordinary participant still gets their week');
    });
});

describe('withdrawOvertimeParticipant — the leaver who is chased every week', () => {
    const PATH = `overtimeWindows/${WEEK}/participants/G. Miller`;
    const withSecond = () => seededWindow({
        [`overtimeWindows/${WEEK}/participants/S. Silva`]: {
            memberName: 'S. Silva', grade: 'CEA', rosterOrder: 5, uid: null,
        },
    });

    test('an ordinary member cannot change who is asked', async () => {
        // The population is a reviewer's decision. A member who could withdraw themselves would
        // have found a way to stop being counted as outstanding without ever saying they are not
        // available — which is the one distinction this whole feature protects.
        freeze(M.initialDeadlineAt - 1000);
        const { eps } = build(seededWindow());
        const r = await call(eps.withdrawOvertimeParticipant,
            req({ weekEnding: WEEK, memberName: 'G. Miller', withdrawn: true }, 'tok_plain'));
        unfreeze();
        assert.equal(r.code, 403);
    });

    test('a reviewer withdraws somebody, and the record is FLAGGED rather than removed', async () => {
        freeze(M.initialDeadlineAt - 1000);
        const { eps, db } = build(seededWindow());
        const r = await call(eps.withdrawOvertimeParticipant,
            req({ weekEnding: WEEK, memberName: 'G. Miller', withdrawn: true }, 'tok_manager'));
        unfreeze();
        assert.equal(r.code, 200);
        const p = db._store.get(PATH);
        // Still there, still carrying everything it carried — the freeze is not being edited.
        assert.equal(p.memberName, 'G. Miller');
        assert.equal(p.grade, 'CEA');
        assert.equal(p.withdrawn, true);
        assert.equal(p.withdrawnBy, 'H. Croft', 'an unattributable exclusion is the thing to avoid');
        assert.ok(p.withdrawnAt, 'and it is stamped');
    });

    test('restoring REMOVES the fields rather than writing false', async () => {
        // `where('withdrawn','==',true)` never matches a missing field, and never matches an
        // explicit false either — so both work for the count. But every participant written before
        // this feature has no field at all, and leaving a written `false` behind would make two
        // shapes mean "still being asked" where one will do.
        freeze(M.initialDeadlineAt - 1000);
        const { eps, db } = build(seededWindow({
            [PATH]: { memberName: 'G. Miller', grade: 'CEA', rosterOrder: 2, uid: null,
                withdrawn: true, withdrawnAt: { toMillis: () => 1 }, withdrawnBy: 'H. Croft' },
        }));
        const r = await call(eps.withdrawOvertimeParticipant,
            req({ weekEnding: WEEK, memberName: 'G. Miller', withdrawn: false }, 'tok_manager'));
        unfreeze();
        assert.equal(r.code, 200);
        const p = db._store.get(PATH);
        assert.deepEqual(Object.keys(p).sort(), ['grade', 'memberName', 'rosterOrder', 'uid']);
    });

    test('a CLOSED week refuses, with a code the page can name', async () => {
        // Not a fault to retry — a rule. A closed week is the record the roster was planned from,
        // and a reviewer told only "that failed" would press it again.
        freeze(M.finalDeadlineAt + 1000);
        const { eps, db } = build(seededWindow());
        const r = await call(eps.withdrawOvertimeParticipant,
            req({ weekEnding: WEEK, memberName: 'G. Miller', withdrawn: true }, 'tok_manager'));
        unfreeze();
        assert.equal(r.code, 409);
        assert.equal(r.body.error, 'closed');
        assert.equal(db._store.get(PATH).withdrawn, undefined, 'and nothing was written');
    });

    test('a name that is not in the frozen population is refused, not created', async () => {
        // The population is frozen. An `update` on a missing document would throw in production and
        // a `set` would ADD somebody to a week nobody asked them about — so the existence check is
        // the thing being asserted, not the error code.
        freeze(M.initialDeadlineAt - 1000);
        const { eps, db } = build(seededWindow());
        const r = await call(eps.withdrawOvertimeParticipant,
            req({ weekEnding: WEEK, memberName: 'S. Silva', withdrawn: true }, 'tok_manager'));
        unfreeze();
        assert.equal(r.code, 404);
        assert.equal(db._store.has(`overtimeWindows/${WEEK}/participants/S. Silva`), false);
    });

    test('an id that is not a legal path segment never reaches Firestore', async () => {
        // Both fields are document IDS here, so an unvalidated one arrives as a PATH rather than as
        // data — the reason `isSafeDocId` exists at all.
        freeze(M.initialDeadlineAt - 1000);
        const { eps } = build(seededWindow());
        for (const body of [
            { weekEnding: '2026-09-06', memberName: 'G. Miller', withdrawn: true },   // not a Saturday
            { weekEnding: WEEK, memberName: 'a/b', withdrawn: true },
            { weekEnding: WEEK, memberName: '', withdrawn: true },
            { weekEnding: WEEK, withdrawn: true },
        ]) {
            const r = await call(eps.withdrawOvertimeParticipant, req(body, 'tok_manager'));
            assert.equal(r.code, 400, JSON.stringify(body));
        }
        unfreeze();
    });

    test('the overview stops expecting them — and legacy participants still count', async () => {
        // The count is where withdrawal has to land or it has done nothing. The second half is the
        // subtle one: `G. Miller` here carries no `withdrawn` field at all, which is every
        // participant document written before this feature. A filtered count would drop them too
        // and report an expectation of zero for a perfectly healthy week.
        freeze(M.initialDeadlineAt - 1000);
        const { eps } = build(withSecond());
        const before = (await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager')))
            .body.planningWeeks.find(w => w.weekEnding === WEEK);
        assert.deepEqual([before.expected, before.received, before.noResponse], [2, 0, 2]);

        await call(eps.withdrawOvertimeParticipant,
            req({ weekEnding: WEEK, memberName: 'S. Silva', withdrawn: true }, 'tok_manager'));
        const after = (await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager')))
            .body.planningWeeks.find(w => w.weekEnding === WEEK);
        unfreeze();
        assert.deepEqual([after.expected, after.received, after.noResponse], [1, 0, 1]);
    });

    test("a withdrawn person's own submission leaves the received count with them", async () => {
        // Otherwise `received` outlives `expected` and the card renders a NEGATIVE no-response
        // count — which is the shape of a number nobody trusts again, on the one figure a clerk
        // acts on. Their submission itself is untouched; it simply stops being counted here.
        freeze(M.initialDeadlineAt - 1000);
        const { eps, db } = build({
            ...withSecond(),
            [`overtimeWindows/${WEEK}/submissions/S. Silva`]: { currentRevision: 1, days: {} },
        });
        const before = (await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager')))
            .body.planningWeeks.find(w => w.weekEnding === WEEK);
        assert.deepEqual([before.expected, before.received, before.noResponse], [2, 1, 1]);

        await call(eps.withdrawOvertimeParticipant,
            req({ weekEnding: WEEK, memberName: 'S. Silva', withdrawn: true }, 'tok_manager'));
        const after = (await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager')))
            .body.planningWeeks.find(w => w.weekEnding === WEEK);
        unfreeze();
        assert.deepEqual([after.expected, after.received, after.noResponse], [1, 0, 1]);
        assert.ok(db._store.has(`overtimeWindows/${WEEK}/submissions/S. Silva`),
            'the declaration itself is kept — withdrawal changes what is expected, not what happened');
    });

    test('the nightly top-up does not quietly put them back', async () => {
        // `addMissingParticipants` adds anybody in the audience with no participant document. The
        // withdrawn person still HAS one, so they are already excluded — but only by accident of
        // that implementation, and a reviewer's decision being undone overnight is the kind of
        // thing that gets noticed weeks later, if at all.
        freeze(M.initialDeadlineAt - 1000);
        const { eps, db } = build(withSecond());
        await call(eps.withdrawOvertimeParticipant,
            req({ weekEnding: WEEK, memberName: 'S. Silva', withdrawn: true }, 'tok_manager'));
        await call(eps.createOvertimeWindow, req({ weekEnding: WEEK }, 'tok_member'));
        unfreeze();
        assert.equal(db._store.get(`overtimeWindows/${WEEK}/participants/S. Silva`).withdrawn, true);
    });
});

describe('getMyOvertimeState — the member sees their own windows and nobody else', () => {
    test('a participant gets the window, its phase and their submission', async () => {
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { eps } = build(seededWindow({
            [`overtimeWindows/${WEEK}/submissions/G. Miller`]: {
                memberName: 'G. Miller', currentRevision: 2, days: allDay(),
                updatedAt: { toMillis: () => SERVER_NOW }, lastMutationId: 'abcdefgh', schemaVersion: 1,
            },
        }));
        const r = await call(eps.getMyOvertimeState, req({}));
        unfreeze();
        assert.equal(r.body.windows.length, 1);
        assert.equal(r.body.windows[0].phase, 'INITIAL_OPEN');
        assert.equal(r.body.windows[0].submission.currentRevision, 2);
        assert.equal(r.body.windows[0].participant.grade, 'CEA');
    });

    test('a NON-participant gets an empty list, not an error', async () => {
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { eps } = build(seededWindow());
        const r = await call(eps.getMyOvertimeState, req({}, 'tok_plain'));
        unfreeze();
        assert.equal(r.code, 200);
        assert.deepEqual(r.body.windows, []);
    });

    test('a MANAGER correctly gets an empty list — and that is not a bug to fix', async () => {
        // Managers review; they do not submit. Reinterpreting manager status as participation here
        // would put a personal form in front of somebody who must not have one.
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { eps } = build(seededWindow());
        const r = await call(eps.getMyOvertimeState, req({}, 'tok_manager'));
        unfreeze();
        assert.equal(r.code, 200);
        assert.deepEqual(r.body.windows, []);
        assert.equal(typeof r.body.serverNow, 'number', 'but they still get the server clock');
    });

    test('a colleague\'s submission never appears in a member\'s state', async () => {
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { eps } = build(seededWindow({
            [`overtimeWindows/${WEEK}/participants/S. Silva`]: { memberName: 'S. Silva', grade: 'CEA', rosterOrder: 5 },
            [`overtimeWindows/${WEEK}/submissions/S. Silva`]: { memberName: 'S. Silva', currentRevision: 1, days: noDays() },
        }));
        const r = await call(eps.getMyOvertimeState, req({}));
        unfreeze();
        assert.equal(JSON.stringify(r.body).includes('S. Silva'), false,
            'no part of a colleague may leak into a member payload');
    });

    test('an expired window is omitted even though the document still exists', async () => {
        freeze(M.retentionUntil + 1);
        const { eps } = build(seededWindow());
        const r = await call(eps.getMyOvertimeState, req({}));
        unfreeze();
        assert.deepEqual(r.body.windows, []);
    });

    test('the phase reported is the SERVER\'s, and it moves as time passes', async () => {
        const seed = seededWindow();
        for (const [at, expected] of [[M.initialDeadlineAt - 1, 'INITIAL_OPEN'], [M.initialDeadlineAt, 'FINAL_OPEN'], [M.finalDeadlineAt, 'CLOSED']]) {
            freeze(at);
            const { eps } = build(seed);
            const r = await call(eps.getMyOvertimeState, req({}));
            unfreeze();
            assert.equal(r.body.windows[0].phase, expected);
        }
    });
});

describe('submitOvertimeAvailability — the only mutation', () => {
    const good = (over = {}) => ({
        weekEnding: WEEK, days: allDay(), ifRevision: 0, clientMutationId: 'mutation-0001', ...over,
    });

    test('a first submission writes the head AND revision 000001, together', async () => {
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { db, eps } = build(seededWindow());
        const r = await call(eps.submitOvertimeAvailability, req(good()));
        unfreeze();
        assert.equal(r.code, 200);
        assert.equal(r.body.revision, 1);
        const head = db._store.get(`overtimeWindows/${WEEK}/submissions/G. Miller`);
        const rev  = db._store.get(`overtimeWindows/${WEEK}/submissions/G. Miller/revisions/000001`);
        assert.ok(head && rev, 'a head without its revision would make the audit trail a fiction');
        assert.equal(head.currentRevision, rev.revision);
        assert.equal(rev.weekEnding, WEEK, 'the revision carries its own context from day one');
        assert.equal(rev.memberName, 'G. Miller');
        assert.equal(rev.mutationId, 'mutation-0001');
    });

    test('a week containing "up to 12 hours" saves end-to-end (v20.83)', async () => {
        // Through the REAL handler, not just the schema: the new mode has to survive
        // normaliseDays, the transaction, and the head+revision write like any established one.
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { db, eps } = build(seededWindow());
        const days = allDay();
        const first = Object.keys(days).sort()[0];
        days[first] = { mode: 'twelve_hours' };
        const r = await call(eps.submitOvertimeAvailability, req(good({ days })));
        unfreeze();
        assert.equal(r.code, 200);
        const head = db._store.get(`overtimeWindows/${WEEK}/submissions/G. Miller`);
        assert.deepEqual(head.days[first], { mode: 'twelve_hours' },
            'stored with its mode and nothing else — a ceiling, not a clock time');
    });

    test('a genuine amendment appends a revision and leaves the old one untouched', async () => {
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { db, eps } = build(seededWindow());
        await call(eps.submitOvertimeAvailability, req(good()));
        const r = await call(eps.submitOvertimeAvailability, req(good({ days: noDays(), ifRevision: 1, clientMutationId: 'mutation-0002' })));
        unfreeze();
        assert.equal(r.body.revision, 2);
        const first = db._store.get(`overtimeWindows/${WEEK}/submissions/G. Miller/revisions/000001`);
        assert.equal(first.days[DATES[0]].mode, 'all_day', 'history is immutable');
        assert.equal(db._store.get(`overtimeWindows/${WEEK}/submissions/G. Miller`).currentRevision, 2);
    });

    test('an identical retry with a STALE baseline succeeds, creates nothing, and records its mutation id', async () => {
        // The timeout path, end to end. The first attempt committed, its response was lost, and the
        // client retries with the baseline it last confirmed. The recorded mutation id is what lets
        // that client then prove to itself that the submission is saved.
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { db, eps } = build(seededWindow());
        await call(eps.submitOvertimeAvailability, req(good()));
        const r = await call(eps.submitOvertimeAvailability, req(good({ ifRevision: 0, clientMutationId: 'retry-000001' })));
        unfreeze();
        assert.equal(r.code, 200);
        assert.equal(r.body.noop, true);
        assert.equal(r.body.revision, 1);
        assert.equal(db._store.has(`overtimeWindows/${WEEK}/submissions/G. Miller/revisions/000002`), false);
        assert.equal(db._store.get(`overtimeWindows/${WEEK}/submissions/G. Miller`).lastMutationId, 'retry-000001');
    });

    test('a stale baseline with DIFFERENT content is a 409 carrying what is actually stored', async () => {
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { eps } = build(seededWindow());
        await call(eps.submitOvertimeAvailability, req(good()));
        const r = await call(eps.submitOvertimeAvailability, req(good({ days: noDays(), ifRevision: 0, clientMutationId: 'mutation-0003' })));
        unfreeze();
        assert.equal(r.code, 409);
        assert.equal(r.body.error, 'revision-conflict');
        assert.equal(r.body.currentRevision, 1);
        assert.ok(r.body.days, 'the client needs the authoritative content to show, not just a refusal');
    });

    test('the 409 names the mutation that won, so "somebody else" can be told from "you, earlier"', async () => {
        // The interaction two features apart: a member times out, EDITS, and retries. The content
        // now differs and the baseline is stale, so it is a genuine conflict — with their own
        // earlier successful submission. Telling them "changed on another device" would be false.
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { eps } = build(seededWindow());
        await call(eps.submitOvertimeAvailability, req(good({ clientMutationId: 'timed-out-one' })));
        const r = await call(eps.submitOvertimeAvailability, req(good({ days: noDays(), ifRevision: 0, clientMutationId: 'the-retry-xx' })));
        unfreeze();
        assert.equal(r.body.lastMutationId, 'timed-out-one');
    });

    test('after the final deadline nothing is accepted', async () => {
        freeze(M.finalDeadlineAt);
        const { db, eps } = build(seededWindow());
        const r = await call(eps.submitOvertimeAvailability, req(good()));
        unfreeze();
        assert.equal(r.code, 409);
        assert.equal(r.body.error, 'closed');
        assert.equal(db._store.has(`overtimeWindows/${WEEK}/submissions/G. Miller`), false);
    });

    test('a first submission is still accepted in the FINAL_OPEN phase', async () => {
        freeze(M.initialDeadlineAt + 1);
        const { eps } = build(seededWindow());
        const r = await call(eps.submitOvertimeAvailability, req(good()));
        unfreeze();
        assert.equal(r.code, 200);
        assert.equal(r.body.phase, 'FINAL_OPEN');
    });

    test('a non-participant cannot submit, even as Master Admin', async () => {
        // Oversight is not permission to file somebody else's declaration. The only name in play is
        // the token's, so there is no body field to try this with — the identity IS the check.
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { db, eps } = build(seededWindow());
        const r = await call(eps.submitOvertimeAvailability, req(good(), 'tok_plain'));
        unfreeze();
        assert.equal(r.code, 403);
        assert.equal(r.body.error, 'not-a-participant');
        assert.equal(db._store.has(`overtimeWindows/${WEEK}/submissions/S. Silva`), false);
    });

    test('a malformed week is refused with the reason and the offending date', async () => {
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { db, eps } = build(seededWindow());
        const partial = allDay(); delete partial[DATES[4]];
        const r = await call(eps.submitOvertimeAvailability, req(good({ days: partial })));
        unfreeze();
        assert.equal(r.code, 400);
        assert.equal(r.body.error, 'wrong-day-count');
        assert.equal(db._store.size, 2, 'nothing written');
    });

    test('a missing or malformed mutation id is refused — reconciliation depends on it', async () => {
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { eps } = build(seededWindow());
        for (const id of ['', 'short', 'x'.repeat(65), 'has spaces!!']) {
            const r = await call(eps.submitOvertimeAvailability, req(good({ clientMutationId: id })));
            assert.equal(r.body.error, 'invalid-mutation-id', `"${id}"`);
        }
        unfreeze();
    });

    test('a submission to a window that does not exist is 404, not a created one', async () => {
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { eps } = build();
        const r = await call(eps.submitOvertimeAvailability, req(good()));
        unfreeze();
        assert.equal(r.code, 404);
    });

    test('the participant uid is stamped on first contact, as the rename recovery route', async () => {
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { db, eps } = build(seededWindow());
        await call(eps.submitOvertimeAvailability, req(good()));
        unfreeze();
        assert.equal(db._store.get(`overtimeWindows/${WEEK}/participants/G. Miller`).uid, 'uid_g');
    });
});

describe('purgeExpiredOvertimeWindows — the only irreversible thing here', () => {
    const OLD = '2026-01-03';           // long past its 91-day retention at the clock below
    const NOW = Date.parse('2026-08-19T09:00:00Z');
    const OM = OT.deriveMilestones(OLD);

    /** An expired window with a full tree beneath it: participant, submission, two revisions. */
    const expiredTree = () => ({
        [`overtimeWindows/${OLD}`]: {
            weekEnding: OLD, weekStart: OM.weekStart,
            initialDeadlineAt: { toMillis: () => OM.initialDeadlineAt },
            finalDeadlineAt: { toMillis: () => OM.finalDeadlineAt },
            retentionUntil: { toMillis: () => OM.retentionUntil },
            policyVersion: 1, audience: 'restricted',
        },
        [`overtimeWindows/${OLD}/participants/G. Miller`]: { memberName: 'G. Miller', grade: 'CEA' },
        [`overtimeWindows/${OLD}/submissions/G. Miller`]: { currentRevision: 2, days: {} },
        [`overtimeWindows/${OLD}/submissions/G. Miller/revisions/0001`]: { revision: 1 },
        [`overtimeWindows/${OLD}/submissions/G. Miller/revisions/0002`]: { revision: 2 },
    });

    const run = (eps) => eps.purgeExpiredOvertimeWindows.run({});

    test('disarmed, it touches NOTHING — which is how it ships', async () => {
        // The dry run is not a formality. This is the only code in the feature that destroys data,
        // it runs unattended, and its first real work happens months after anyone last looked at
        // it. Shipping it inert is what lets the walk be proved against real documents while its
        // mistakes are still only log lines.
        freeze(NOW);
        const { eps, db } = build(expiredTree());
        const before = [...db._store.keys()].sort();
        await run(eps);
        unfreeze();
        assert.deepEqual([...db._store.keys()].sort(), before);
    });

    test('armed, it removes the window AND everything beneath it', async () => {
        // Firestore does not cascade. A parent deleted on its own leaves every participant,
        // submission and revision present, billable, and unreachable from any listing the app
        // performs — which is worse than not purging, because the data survives while the system
        // reports it as gone.
        freeze(NOW);
        const { eps, db } = build(expiredTree(), { purgeArmed: true });
        await run(eps);
        unfreeze();
        assert.deepEqual([...db._store.keys()], [], 'something survived the purge');
    });

    test('a window still inside its retention is never selected, armed or not', async () => {
        freeze(NOW);
        const { eps, db } = build({ ...expiredTree(), ...seededWindow() }, { purgeArmed: true });
        await run(eps);
        unfreeze();
        const left = [...db._store.keys()];
        assert.ok(left.every(k => k.startsWith(`overtimeWindows/${WEEK}`)),
            `a live window was purged: ${left.join(', ')}`);
        assert.ok(left.includes(`overtimeWindows/${WEEK}/participants/G. Miller`),
            'and its participants went with it');
    });

    test('the parent is deleted LAST, so an interrupted run cannot orphan the tree', async () => {
        // The one ordering that matters. If the parent went first and the run died, the children
        // would remain with nothing pointing at them and no later run would find them — the window
        // is gone, so it can never be selected as expired again.
        freeze(NOW);
        const order = [];
        const { eps, db } = build(expiredTree(), { purgeArmed: true });
        const realBatch = db.batch;
        db.batch = () => {
            const b = realBatch();
            const realDelete = b.delete;
            b.delete = (ref) => { order.push(ref.path); return realDelete(ref); };
            return b;
        };
        await run(eps);
        unfreeze();
        assert.equal(order.at(-1), `overtimeWindows/${OLD}`, 'the window parent must go last');
        assert.ok(order.indexOf(`overtimeWindows/${OLD}/submissions/G. Miller/revisions/0001`)
            < order.indexOf(`overtimeWindows/${OLD}/submissions/G. Miller`),
            'a revision must go before the submission head above it');
    });

    test('it says what it did NOT reach, rather than reading as a complete run', async () => {
        // A silently truncated list tells the same lie a run that reports only its successes does.
        // Six expired weeks against a bound of five is the case, and the arrears line is the only
        // thing that distinguishes "finished" from "still behind".
        freeze(NOW);
        const many = {};
        for (let i = 0; i < 6; i++) {
            const wk = OT.addDays(OLD, i * 7);
            const m = OT.deriveMilestones(wk);
            many[`overtimeWindows/${wk}`] = {
                weekEnding: wk, weekStart: m.weekStart,
                initialDeadlineAt: { toMillis: () => m.initialDeadlineAt },
                finalDeadlineAt: { toMillis: () => m.finalDeadlineAt },
                retentionUntil: { toMillis: () => m.retentionUntil },
                policyVersion: 1, audience: 'restricted',
            };
        }
        const logs = [];
        const realLog = console.log;
        console.log = (...a) => logs.push(a.join(' '));
        const { eps, db } = build(many, { purgeArmed: true });
        await run(eps);
        console.log = realLog;
        unfreeze();
        assert.equal([...db._store.keys()].length, 1, 'exactly one week should be left over');
        assert.ok(logs.some(l => /1 more expired window left for the next run/.test(l)),
            `the arrears were not reported: ${logs.join(' | ')}`);
    });

    test('a failed listing stands the run down rather than assuming nothing is expired', async () => {
        // The opposite failure to the creator's, and the same principle: acting on a wrong premise
        // is how a bad day becomes a bad week. Here the wrong premise is harmless by luck — an
        // empty list deletes nothing — so the assertion is that it does not THROW out of a
        // scheduled invocation, which is what would turn a transient read error into an alert.
        freeze(NOW);
        const { eps, db } = build(expiredTree(), { purgeArmed: true });
        db.collection = () => ({ get: async () => { throw new Error('unavailable'); } });
        await run(eps);
        unfreeze();
        assert.equal([...db._store.keys()].length, 5, 'nothing should have been deleted');
    });
});

describe('autoCreateOvertimeWindows — the schedule, executed', () => {
    /**
     * `.run(event)` — NOT the exported value called directly.
     *
     * A v2 scheduled function is HTTP-triggered underneath: the export is an express handler that
     * parses a CloudEvent out of the request headers, so calling it with a plain object dies on
     * `req.header is not a function` before reaching our code. `.run()` is the seam the SDK gives
     * for exactly this, and it invokes the real body.
     */
    const run = (eps) => eps.autoCreateOvertimeWindows.run({});

    test('it creates every horizon week that has none, with real participants', async () => {
        freeze(Date.parse('2026-08-11T04:00:00Z'));
        const { db, eps } = build();
        await run(eps);
        unfreeze();

        const made = [...db._store.keys()].filter(k => /^overtimeWindows\/[^/]+$/.test(k)).sort();
        // Whatever the horizon offers, and nothing else — asserted against the pure rule rather
        // than against a hand-copied list, which would drift the moment the horizon length changed.
        const due = OT.weeksNeedingWindows(Date.parse('2026-08-11T04:00:00Z'), [], { maxRosterYear: 2030 });
        assert.deepEqual(made, due.map(w => `overtimeWindows/${w}`).sort());
        assert.ok(due.length >= 3, `expected several due weeks, got ${due.length}`);

        // A window with no participants can never receive a submission, so "it created windows" is
        // not the assertion — "it created windows somebody is in" is.
        for (const w of due) {
            assert.ok(db._store.has(`overtimeWindows/${w}/participants/G. Miller`),
                `${w} has no participant document`);
        }
    });

    test('it signs its windows as automatic, so provenance is not a guess', async () => {
        freeze(Date.parse('2026-08-11T04:00:00Z'));
        const { db, eps } = build();
        await run(eps);
        unfreeze();
        const [first] = [...db._store.keys()].filter(k => /^overtimeWindows\/[^/]+$/.test(k)).sort();
        assert.equal(db._store.get(first).createdByName, 'Automatic');
        assert.equal(db._store.get(first).createdByUid, null);
    });

    test('a second run is a no-op — it never rewrites a frozen participant list', async () => {
        // The property the whole feature rests on. Running daily means this path executes six times
        // for every one that creates anything, so "harmless repeat" is the common case, not an edge.
        freeze(Date.parse('2026-08-11T04:00:00Z'));
        const { db, eps } = build();
        await run(eps);
        // Mark the snapshot so a rewrite is visible rather than merely equal.
        const [first] = [...db._store.keys()].filter(k => /^overtimeWindows\/[^/]+$/.test(k)).sort();
        const week = first.split('/')[1];
        db._store.set(`overtimeWindows/${week}/participants/G. Miller`,
            { ...db._store.get(`overtimeWindows/${week}/participants/G. Miller`), _touched: true });
        const before = db._store.size;

        await run(eps);
        unfreeze();
        assert.equal(db._store.size, before, 'a second run wrote something');
        assert.equal(db._store.get(`overtimeWindows/${week}/participants/G. Miller`)._touched, true,
            'the frozen participant snapshot was rewritten by a repeat run');
    });

    test('it leaves a hand-made week exactly as the human made it', async () => {
        freeze(Date.parse('2026-08-11T04:00:00Z'));
        const seeded = seededWindow();
        const { db, eps } = build(seeded);
        await run(eps);
        unfreeze();
        assert.equal(db._store.get(`overtimeWindows/${WEEK}`).audience, 'restricted');
        assert.equal(db._store.get(`overtimeWindows/${WEEK}`).createdByName, undefined,
            'the scheduler overwrote a window it did not create');
    });

    test('a failed listing stands the run DOWN rather than assuming nothing exists', async () => {
        // The dangerous premise. Treating a read failure as an empty collection would attempt every
        // horizon week; the `existed` branch would refuse each, but relying on a downstream guard to
        // undo a wrong premise is not the same as not holding it. Nothing is written, and the
        // horizon still shows the gap.
        freeze(Date.parse('2026-08-11T04:00:00Z'));
        const db = makeDb({});
        // Break the LISTING and nothing else. The first cut of this test replaced `db.collection`
        // wholesale, so `.doc()` and the batch were gone too — every write then failed for an
        // unrelated reason and the store was empty whichever way the code branched. It passed
        // against the exact bug it was written to catch, which is the worst kind of green.
        const realCollection = db.collection;
        db.collection = (path) => ({
            ...realCollection(path),
            select: () => ({ get: async () => { throw new Error('unavailable'); } }),
        });
        installFakeAdmin(db, TOKENS);
        delete require.cache[require.resolve('./functions/overtime.js')];
        const { buildOvertimeEndpoints } = require('./functions/overtime.js');
        const eps = buildOvertimeEndpoints({ ADMIN_FUNCTION_ORIGINS: [], rosterMembers: ROSTER });
        await eps.autoCreateOvertimeWindows.run({});
        unfreeze();
        assert.equal(db._store.size, 0);
    });

    test('one unwritable week does not abandon the others', async () => {
        freeze(Date.parse('2026-08-11T04:00:00Z'));
        const { db, eps } = build();
        const realBatch = db.batch;
        let n = 0;
        db.batch = () => (++n === 1
            ? { set: () => {}, commit: async () => { throw new Error('nope'); } }
            : realBatch());
        await run(eps);
        unfreeze();
        const made = [...db._store.keys()].filter(k => /^overtimeWindows\/[^/]+$/.test(k));
        const due = OT.weeksNeedingWindows(Date.parse('2026-08-11T04:00:00Z'), [], { maxRosterYear: 2030 });
        assert.equal(made.length, due.length - 1, 'the run stopped at the first failure');
    });
});

describe('a member invited into the beta AFTER a window was created', () => {
    // The live report: T. Bibi was added to CONFIG.OVERTIME_BETA, the Functions deploy succeeded,
    // and her page still said "No overtime availability forms are open for you right now" while
    // the admin's forms were open. This reproduces it against the real handlers.
    const WIDER = {
        ...ROSTER,
        overtimeBeta: ['S. Silva'],       // invited AFTER the window below was created
    };

    function buildWider(seed) {
        const db = makeDb(seed);
        installFakeAdmin(db, TOKENS);
        delete require.cache[require.resolve('./functions/overtime.js')];
        const { buildOvertimeEndpoints } = require('./functions/overtime.js');
        return { db, eps: buildOvertimeEndpoints({ ADMIN_FUNCTION_ORIGINS: [], rosterMembers: WIDER }) };
    }

    test('before the top-up she has nothing — the reported symptom, reproduced', async () => {
        freeze(M.initialDeadlineAt - 86400000);       // the window is OPEN
        const { eps } = buildWider(seededWindow());   // participants: G. Miller only
        const r = await call(eps.getMyOvertimeState, req({}, 'tok_plain'));
        unfreeze();
        assert.equal(r.code, 200);
        assert.deepEqual(r.body.windows, [],
            'she is in the audience but not in the frozen population — nothing has topped it up yet');
    });

    test('topping the OPEN week up gives her the form, without disturbing anyone', async () => {
        freeze(M.initialDeadlineAt - 86400000);
        const { db, eps } = buildWider(seededWindow());
        const add = await call(eps.createOvertimeWindow, req({ weekEnding: WEEK }, 'tok_member'));
        assert.equal(add.code, 200);
        assert.equal(add.body.existed, true, 'the week already existed — this is a top-up, not a create');
        assert.deepEqual(add.body.added, ['S. Silva']);

        const mine = await call(eps.getMyOvertimeState, req({}, 'tok_plain'));
        unfreeze();
        assert.equal(mine.body.windows.length, 1, 'she can now see and answer the week');
        // The existing participant is untouched — a top-up ADDS, it never rewrites the snapshot.
        assert.ok(db._store.has(`overtimeWindows/${WEEK}/participants/G. Miller`));
    });

    test('and it is IDEMPOTENT — pressing it again adds nobody', async () => {
        freeze(M.initialDeadlineAt - 86400000);
        const { eps } = buildWider(seededWindow());
        await call(eps.createOvertimeWindow, req({ weekEnding: WEEK }, 'tok_member'));
        const again = await call(eps.createOvertimeWindow, req({ weekEnding: WEEK }, 'tok_member'));
        unfreeze();
        assert.deepEqual(again.body.added, [], 'a second press must be a no-op, not a second write');
    });

    // ── THE BOUNDARY IS THE **INITIAL** DEADLINE, not the final one (v20.81) ───────────────────
    //
    // What keeps the freeze meaningful: somebody added to a week they could not answer ON TIME is a
    // manufactured false record, and it is false in two directions at once. Until they submit they
    // sit under **No response** for a deadline that pre-dates their invitation; the moment they do,
    // `deriveHistory` sees no revision before `initialDeadlineAt` and labels them **submitted after
    // the initial deadline**. Both read as a person who was asked and did not answer in time.
    //
    // v20.78 gated top-up on `isOpenPhase`, which is INITIAL_OPEN *or* FINAL_OPEN — so a window past
    // its first deadline could still gain somebody, and every judgement about them was then wrong.
    // Found by external review, Aug 2026. The fix is the phase, not a nicer label: the person joins
    // from the next week whose initial deadline is still ahead of them, and the record stays true.
    //
    // Three phases, both callers. They take different routes in — the ENDPOINT is refused by
    // `validateWeekEnding` only once the FINAL deadline has gone, so between the two deadlines it
    // reaches the top-up and is stopped there; the SCHEDULER always reaches it. Testing one would
    // leave the other unguarded, and the scheduler is the unattended one.

    test('the endpoint refuses a closed week outright, before any top-up', async () => {
        freeze(M.finalDeadlineAt + 60000);            // one minute past the final deadline
        const { db, eps } = buildWider(seededWindow());
        const r = await call(eps.createOvertimeWindow, req({ weekEnding: WEEK }, 'tok_member'));
        unfreeze();
        assert.equal(r.code, 400);
        assert.equal(r.body.error, 'final-deadline-passed');
        assert.equal(db._store.has(`overtimeWindows/${WEEK}/participants/S. Silva`), false,
            'a closed week must not gain a participant who could never have answered it');
    });

    test('and the SCHEDULER, which bypasses that guard, refuses it too', async () => {
        freeze(M.finalDeadlineAt + 60000);
        const { db, eps } = buildWider(seededWindow());
        await eps.autoCreateOvertimeWindows.run({});
        unfreeze();
        assert.equal(db._store.has(`overtimeWindows/${WEEK}/participants/S. Silva`), false,
            'the nightly top-up must respect the same boundary the endpoint does');
    });

    test('a week PAST ITS INITIAL DEADLINE is not topped up — the endpoint', async () => {
        // Still open: `validateWeekEnding` lets this through, so the refusal has to come from the
        // phase check itself. A member added here would be recorded as late for a deadline that had
        // already passed when they were invited.
        freeze(M.initialDeadlineAt + 60000);          // one minute past the FIRST deadline
        const { db, eps } = buildWider(seededWindow());
        const r = await call(eps.createOvertimeWindow, req({ weekEnding: WEEK }, 'tok_member'));
        unfreeze();
        assert.equal(r.code, 200, 'the week is still open, so the call itself succeeds');
        assert.deepEqual(r.body.added, [], 'nobody may be added once the initial deadline has gone');
        assert.equal(db._store.has(`overtimeWindows/${WEEK}/participants/S. Silva`), false);
    });

    test('a week PAST ITS INITIAL DEADLINE is not topped up — the scheduler', async () => {
        freeze(M.initialDeadlineAt + 60000);
        const { db, eps } = buildWider(seededWindow());
        await eps.autoCreateOvertimeWindows.run({});
        unfreeze();
        assert.equal(db._store.has(`overtimeWindows/${WEEK}/participants/S. Silva`), false,
            'the unattended path must hold the same boundary — this is the one nobody watches');
    });

    test('and she gets no FORM for that week either — the other half of the same boundary', async () => {
        // The consequence, from the member's side. Not being in the population is what stops her
        // being asked; the assertion above is what stops the reviewer being told she was. (The
        // reviewer's own view reads Firestore directly rather than through an endpoint, so the
        // participant document above IS what it renders — and `deriveHistory`'s `lateInitial` rule,
        // the thing that would mislabel her, is pinned in overtime-core.test.mjs.)
        freeze(M.initialDeadlineAt + 60000);
        const { eps } = buildWider(seededWindow());
        await eps.autoCreateOvertimeWindows.run({});
        const mine = await call(eps.getMyOvertimeState, req({}, 'tok_plain'));
        unfreeze();
        assert.ok(!mine.body.windows.some(w => w.weekEnding === WEEK),
            'she must not be offered a week whose first deadline had gone before she was invited');
        // ...but she IS offered the later ones the same scheduler run created, which is the whole
        // point: the remedy is a slightly later start, not exclusion. Asserting an EMPTY list here
        // would have passed against a build that gave her nothing at all.
        assert.ok(mine.body.windows.length > 0,
            'she must still join the weeks whose first deadline is ahead of her');
    });

    test('and it tops up on a day when NO window is due — the steady state (v21.20)', async () => {
        // ── THE DEFECT ──────────────────────────────────────────────────────────────────────────
        //
        // The scheduler returned early when nothing needed creating:
        //
        //     if (!due.length) { console.log('nothing due'); return; }
        //     ...create...
        //     await topUpOpenWindows(nowMs);      // ← never reached
        //
        // and "nothing due" is the NORMAL state, because the whole six-week horizon is pre-created.
        // So the top-up ran only on the one day a week a new week entered the horizon. Invite a beta
        // tester on any other day and they had no form on any already-open week until then — the
        // exact gap the job's own comment says it closes.
        //
        // The test above proves the top-up works; this one proves it RUNS. They fail for different
        // reasons and neither substitutes for the other: that one seeds a window that is also due,
        // so it passed throughout the bug.
        //
        // Found by external review of v21.18.
        freeze(M.initialDeadlineAt - 86400000);
        // Seed EVERY horizon week, so `weeksNeedingWindows` has nothing to return and the create
        // loop does no work at all — which is the condition the early return fired on.
        const seed = seededWindow();
        const base = seed[`overtimeWindows/${WEEK}`];
        for (const w of OT.weeksNeedingWindows(Date.now(), [], { maxRosterYear: WIDER.maxRosterYear })) {
            seed[`overtimeWindows/${w}`] = { ...base, weekEnding: w };
        }
        const { db, eps } = buildWider(seed);
        assert.equal(OT.weeksNeedingWindows(Date.now(), Object.keys(seed)
            .filter(k => /^overtimeWindows\/[0-9-]+$/.test(k)).map(k => k.split('/')[1]),
        { maxRosterYear: WIDER.maxRosterYear }).length, 0, 'nothing is due — the premise of this test');
        await eps.autoCreateOvertimeWindows.run({});
        unfreeze();
        assert.ok(db._store.has(`overtimeWindows/${WEEK}/participants/S. Silva`),
            'a newly-invited member joins the open week on a day with nothing to create');
    });

    test('the scheduler DOES top up an open week, unattended', async () => {
        // The durable half of the fix: an invitation takes effect overnight without anyone
        // remembering to press anything, which is what makes the beta widenable at all.
        freeze(M.initialDeadlineAt - 86400000);
        const { db, eps } = buildWider(seededWindow());
        await eps.autoCreateOvertimeWindows.run({});
        unfreeze();
        assert.ok(db._store.has(`overtimeWindows/${WEEK}/participants/S. Silva`),
            'the open week gained the newly-invited member');
    });

    test('the overview tells the reviewer the audience has outgrown the week', async () => {
        // What makes the gap visible at all. Without it a reviewer has no way to know an invitation
        // has not landed — the week looks complete ("1 of 1 received") because everyone IN it has
        // answered. `canAdd` is the difference, and it is the SERVER that works it out.
        freeze(M.initialDeadlineAt - 86400000);
        const { eps } = buildWider(seededWindow());
        const r = await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager'));
        unfreeze();
        const row = r.body.planningWeeks.find((w) => w.weekEnding === WEEK);
        assert.equal(row.expected, 1, 'the frozen population');
        assert.equal(row.canAdd, 1, 'the one person the top-up would actually add');
    });

    test('a CLOSED week reports no canAdd, because it can no longer grow', async () => {
        freeze(M.finalDeadlineAt + 60000);
        const { eps } = buildWider(seededWindow());
        const r = await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager'));
        unfreeze();
        const row = r.body.planningWeeks.find((w) => w.weekEnding === WEEK);
        assert.equal(row.canAdd, null, 'offering "Add 1" on a closed week would be a lie');
    });

    test('a FINAL_OPEN week reports no canAdd either — the top-up would refuse it', async () => {
        // The v20.85 regression, and the reason this case is not merely "closed, but earlier".
        // v20.81 narrowed `addMissingParticipants` to INITIAL_OPEN; the overview kept asking
        // `isOpenPhase`, which is true here too. So the reviewer was offered "Add 1", the endpoint
        // refused on the phase check, the flash said "Nobody new to add" and the button re-rendered
        // identically — for ever, because nothing about the week changes until it closes.
        //
        // Exactly one horizon week sits in FINAL_OPEN at any moment (the deadlines are 18 and 11
        // days out, and the weeks are 7 apart), so this fired on the first invitation after v20.81.
        freeze(M.initialDeadlineAt + 60000);
        const { eps } = buildWider(seededWindow());
        const r = await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager'));
        const row = r.body.planningWeeks.find((w) => w.weekEnding === WEEK);
        assert.equal(row.canAdd, null,
            'the offer must be gated on the phase the top-up actually acts on');
        assert.equal(row.expected, 1, 'the frozen population is unchanged — only the OFFER is withheld');
        unfreeze();
    });

    test('a WITHDRAWN participant does not become somebody to "Add" (v21.15)', async () => {
        // THE OFFER AND THE ACTION HAVE TO COUNT THE SAME POPULATION.
        //
        // The horizon row used to send `audienceCount` (the size of the current audience) and let
        // the client subtract `expected`. Those count different things: `expected` is net of
        // withdrawals, while `addMissingParticipants` compares the audience against EVERY
        // participant document — a withdrawn member already has one, and re-adding them is the one
        // thing withdrawal exists to prevent.
        //
        // So one press of "Stop asking" gave the row a permanent "Add 1". Pressing it added nobody,
        // reported "Nobody new to add", re-rendered, and offered "Add 1" again — on every load, for
        // as long as the week stayed in INITIAL_OPEN. Verified in a browser before the fix.
        //
        // Both members are in the audience here and both hold a participant document, so there is
        // genuinely nobody to add; the only question is whether withdrawing one invents somebody.
        freeze(M.initialDeadlineAt - 86400000);
        const { eps } = buildWider(seededWindow({
            [`overtimeWindows/${WEEK}/participants/S. Silva`]: {
                memberName: 'S. Silva', grade: 'CEA', rosterOrder: 3, uid: null,
                withdrawn: true, withdrawnBy: 'G. Miller',
            },
        }));
        const r = await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager'));
        unfreeze();
        const row = r.body.planningWeeks.find((w) => w.weekEnding === WEEK);
        assert.equal(row.expected, 1, 'the withdrawn member is out of the counts, as designed');
        assert.equal(row.canAdd, 0, 'and is NOT reported as somebody the top-up would add');
    });

    test('the raw population never goes over the wire, so nobody can re-derive the bad sum', async () => {
        // `participantCount` exists only so the server can compare like with like. Shipping it
        // would put the raw figure back within reach of a client doing exactly the subtraction
        // that produced the phantom button — which is how this defect happened the first time.
        freeze(M.initialDeadlineAt - 86400000);
        const { eps } = buildWider(seededWindow());
        const r = await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager'));
        unfreeze();
        const row = r.body.planningWeeks.find((w) => w.weekEnding === WEEK);
        assert.ok(!('participantCount' in row), 'the raw participant count is server-side only');
        assert.ok(!('audienceCount' in row), 'and the number it replaced is gone, not merely unused');
    });

    test('and the top-up genuinely refuses that week, which is what the null stands for', async () => {
        // The other half: asserting the button is absent proves nothing on its own if the endpoint
        // would in fact have added somebody. These two together are the claim — the offer is
        // withheld BECAUSE the capability is not there.
        freeze(M.initialDeadlineAt + 60000);
        const { db, eps } = buildWider(seededWindow());
        const r = await call(eps.createOvertimeWindow, req({ weekEnding: WEEK }, 'tok_manager'));
        unfreeze();
        assert.deepEqual(r.body.added, [], 'nobody may be added once the initial deadline has gone');
        assert.ok(!db._store.has(`overtimeWindows/${WEEK}/participants/S. Silva`),
            'and nothing was written behind the empty report');
    });
});

describe('push notices — targeted, accumulated, and never able to fail a write', () => {
    // The notify seam records what production would hand to sendTargetedPush. `uidForName` is the
    // account-resolution fake. Every EXCLUSION below must be proven by a member who would
    // otherwise have been sent to — the first cut gave the submitted member no account, so
    // reminding the submitted was invisible behind the uid filter, and the mutation that removed
    // the submitted-check survived. H. Croft is the accountless one: not in UIDS, nothing else
    // excludes him, so his absence from a send can only be the fail-closed skip.
    const UIDS = { 'G. Miller': 'uid-gm', 'S. Silva': 'uid-ss', 'L. Springer': 'uid-ls' };
    function notifySeam() {
        const sends = [];
        return {
            sends,
            notify: {
                sendPush: async (payload, uids, tag) => { sends.push({ payload, uids, tag }); return uids.length; },
                uidForName: async (name) => UIDS[name] ?? null,
            },
        };
    }
    const askedSends    = (sends) => sends.filter(s => s.payload.title.includes('form open'));
    const reminderSends = (sends) => sends.filter(s => s.payload.title.includes('due today'));

    test('creating a window tells its participants — through the design language, to uids only', async () => {
        const { sends, notify } = notifySeam();
        freeze(SERVER_NOW);
        const { eps } = build({}, { notify, STAFF_SITE_URL: 'https://myb-roster.web.app' });
        const r = await call(eps.createOvertimeWindow, req({ weekEnding: WEEK }, 'tok_member'));
        unfreeze();
        assert.equal(r.body.created, true);
        assert.equal(askedSends(sends).length, 1, 'one window, one asked notice');
        const s = askedSends(sends)[0];
        // The restricted audience is the admin alone, and the notice reaches exactly that uid.
        assert.deepEqual(s.uids, ['uid-gm']);
        // The design language, not a hand-written literal: feature emoji leading, stable tag, a
        // deep link the SW's allowlist will accept, and the LONDON deadline in the body.
        assert.ok(s.payload.title.startsWith('⏱️ Overtime'), s.payload.title);
        assert.equal(s.payload.tag, 'overtime');
        assert.ok(s.payload.url.endsWith('/overtime.html'), s.payload.url);
        assert.match(s.payload.body, /Answer by .+ 12:00/);
        assert.ok(!s.payload.title.includes('…') && !s.payload.body.includes('…'),
            'inside the truncation budgets — a clipped deadline is worse than none');
    });

    test('the scheduler asks ONE notice per member, however many windows one run creates', async () => {
        // The bootstrap run creates the whole horizon at once. Per-window sends would buzz the same
        // member once per week — the tag collapses the lock screen but not the buzzing — so the run
        // accumulates and each member hears about their SOONEST new week only.
        const { sends, notify } = notifySeam();
        freeze(SERVER_NOW);
        const { db, eps } = build({}, { notify });
        await eps.autoCreateOvertimeWindows.run({});
        unfreeze();
        const made = [...db._store.keys()].filter(k => /^overtimeWindows\/[0-9-]+$/.test(k));
        assert.ok(made.length >= 4, `the horizon bootstrap made several windows (${made.length})`);
        assert.equal(askedSends(sends).length, 1, 'and they collapsed to one notice');
        assert.deepEqual(askedSends(sends)[0].uids, ['uid-gm']);
    });

    test('the deadline-morning reminder reaches ONLY the silent, and stamps itself once', async () => {
        // Four participants, four states, one target: G. Miller has said nothing (reminded),
        // L. Springer submitted (nothing to be reminded of — and he HAS an account, so the only
        // thing keeping him out is the submitted-check), S. Silva is withdrawn (no longer asked),
        // H. Croft is silent but has no account (fail-closed skip). The morning is selected by
        // reminderDue — the frozen clock sits five hours before the seeded window's noon deadline.
        const { sends, notify } = notifySeam();
        const seed = seededWindow({
            [`overtimeWindows/${WEEK}/participants/L. Springer`]: {
                memberName: 'L. Springer', grade: 'CEA', rosterOrder: 0, uid: null,
            },
            [`overtimeWindows/${WEEK}/participants/S. Silva`]: {
                memberName: 'S. Silva', grade: 'CEA', rosterOrder: 5, uid: null, withdrawn: true,
            },
            [`overtimeWindows/${WEEK}/participants/H. Croft`]: {
                memberName: 'H. Croft', grade: 'CEA', rosterOrder: 9, uid: null,
            },
            [`overtimeWindows/${WEEK}/submissions/L. Springer`]: {
                currentRevision: 1, days: noDays(),
                firstAcceptedAt: { toMillis: () => SERVER_NOW }, updatedAt: { toMillis: () => SERVER_NOW },
            },
        });
        freeze(M.initialDeadlineAt - 5 * 3600_000);
        const { db, eps } = build(seed, { notify });
        await eps.autoCreateOvertimeWindows.run({});
        assert.equal(reminderSends(sends).length, 1, 'one due window, one reminder');
        const s = reminderSends(sends)[0];
        assert.deepEqual(s.uids, ['uid-gm'],
            'the submitted (uid-ls) and the withdrawn (uid-ss) are not reminded; the accountless (H. Croft) are skipped');
        assert.match(s.payload.body, /are due by 12:00 today/);
        assert.ok(db._store.get(`overtimeWindows/${WEEK}`).reminderSentAt, 'stamped after the attempt');

        // The same morning again — a re-run, a second scheduler instance — sends nothing more.
        await eps.autoCreateOvertimeWindows.run({});
        unfreeze();
        assert.equal(reminderSends(sends).length, 1, 'the stamp holds');
    });

    test('a push that throws costs a log line, never the window', async () => {
        // The write this announces has already committed; a notice is a courtesy on top. The seam
        // here throws on EVERY send, and the run must still create its windows and finish.
        freeze(SERVER_NOW);
        const { db, eps } = build({}, { notify: {
            sendPush: async () => { throw new Error('push transport down'); },
            uidForName: async () => 'uid-anything',
        } });
        const r = await call(eps.createOvertimeWindow, req({ weekEnding: WEEK }, 'tok_member'));
        assert.equal(r.body.created, true, 'the manual create still succeeds');
        await eps.autoCreateOvertimeWindows.run({});
        unfreeze();
        assert.ok(db._store.has(`overtimeWindows/${WEEK}`), 'and the scheduler still ran to completion');
    });
});
