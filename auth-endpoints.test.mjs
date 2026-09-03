/**
 * auth-endpoints.test.mjs — the ACCOUNT-AND-CREDENTIAL handlers, driven for real (v21.83, v21.85).
 *
 * Run: node --test auth-endpoints.test.mjs   (part of `npm run test:functions`)
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────
 *
 * `requestPasswordReset` is the app's only public unauthenticated endpoint, and its notification is
 * the ONE push in the whole app that must not be a broadcast: "N. Surname is locked out" sent to
 * fifty staff is a leak, not a notification. `.claude/rules/notifications.md` says so in those
 * words, and `functions/push.js` implements `sendTargetedPush` to fail closed at every step with
 * deliberately no fall-back-to-everyone branch.
 *
 * None of that was tested. What existed was the deploy-surface pin (the function is EXPORTED) and
 * the Firestore rules for its collection (who may READ the queue). Nothing asserted where the push
 * goes — so the rule lived entirely in prose and in the care of whoever edited the file next.
 *
 * Found by a wiring audit after external review, 26 Aug 2026, whose finding was that this repo
 * tests its RULES thoroughly and its WIRING hardly at all: three defects shipped in v21.79 where a
 * well-tested helper was called with the wrong argument, from the wrong context, or not at all.
 * This is that shape at its highest stakes — the helper is careful, and nothing checked it is the
 * helper being called.
 *
 * ── WHAT v21.85 ADDED, AND WHY THOSE TWO ────────────────────────────────────────────────────────
 *
 * The follow-up review's recommendation was NOT "wiring-test everything" — that buys brittle test
 * code by the yard. It was to spend the coverage where a wrong answer costs money, access, identity
 * or a destructive write. Of the four handlers in this domain that leaves a clear order:
 *
 *  · `resetMemberPassword` — DESTRUCTIVE and IDENTITY. It rewrites somebody's credential and can
 *    sign them out of every device. Its decisions (who may call, whose account, what password) are
 *    each individually tested elsewhere; nothing proved the handler asks them in the right ORDER,
 *    and "refuses with 403" is indistinguishable from "resets the account and then returns 403"
 *    unless a test looks at what was written.
 *  · `setupRosterAuth` — IDENTITY. It stamps the claim tiers every Firestore rule then trusts.
 *    `claimsForTier` and `resolveRosterAuthConfig` are both well tested in isolation, which is
 *    exactly the shape the audit warned about: B4's whole point is that the ROSTER comes from the
 *    server and not the request body, and that is a property of the wiring, not of either helper.
 *
 * `getSignInStats` is deliberately not here yet: it is a read, it returns four integers and no
 * identity, and its aggregation is already pinned by `summariseSignIns`. It is the next one to do
 * if this file grows again, not the one to do first.
 *
 * Every test drives the REAL handler against a fake Firestore, a fake Auth and a recording push
 * transport, so what it asserts is what production would send — and every fake RECORDS rather than
 * discards, because a harness that throws the payload away cannot see the defect it exists for.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// REAL time, not a pinned instant: the endpoint's throttle and coalescing windows are measured
// against `Date.now()` inside the module, so a fixture dated to a fixed day would sit hours outside
// every window and the throttled case would quietly test the un-throttled path instead.
const NOW = Date.now();

const ADMIN    = 'G. Miller';
const MEMBER   = 'L. Springer';        // on the roster, and not the admin
const MEMBER2  = 'A. Hared';           // a SECOND ordinary member, for the coalescing cases
const MANAGER  = 'S. Stewart';         // roles.manager in roster-members.json
const DESIGNER = 'M. Robson';          // roles.designer, and NOT an admin
const ADMIN_UID = 'uid_admin_gm';
const emailFor = (n) => `${n[0].toLowerCase()}.${n.split('. ')[1].toLowerCase()}@myb-roster.local`;
const uidFor   = (n) => `uid_${n.replace(/\W/g, '')}`;

// The Firestore sentinel the fake understands. A real serverTimestamp() resolves to a readable
// Timestamp on the way in; if the fake stored the raw sentinel instead, every later read would find
// it unreadable, the coalescing check would fail OPEN, and the suppression tests below would pass
// for the wrong reason — the exact "green because nothing happened" shape this file exists to avoid.
const SERVER_TS = Symbol('serverTimestamp');
const resolveTs = (v) => (v === SERVER_TS ? { toMillis: () => Date.now() } : v);

/**
 * A Firestore fake with what these endpoints touch: per-collection docs, a transaction, and a
 * field-projected select(). Every write is kept, so a test can ask what was actually stored.
 */
function makeDb(seed = {}) {
    /** @type {Map<string, Map<string, any>>} collection → (docId → data) */
    const cols = new Map();
    const col = (name) => {
        if (!cols.has(name)) cols.set(name, new Map());
        return cols.get(name);
    };
    for (const [c, docs] of Object.entries(seed)) {
        for (const [id, data] of Object.entries(docs)) col(c).set(id, { ...data });
    }
    const merge = (name, id, data) => {
        const store = col(name);
        const prev = store.get(id) || {};
        const next = { ...prev };
        for (const [k, v] of Object.entries(data)) {
            next[k] = (v && typeof v === 'object' && v.inc)
                ? (Number(prev[k]) || 0) + v.inc
                : resolveTs(v);
        }
        store.set(id, next);
    };
    const snapOf = (name, id) => ({
        id,
        exists: col(name).has(id),
        data: () => col(name).get(id) || {},
    });
    const db = {
        collection(name) {
            return {
                doc: (id) => ({ id, _col: name, set: async (data) => merge(name, id, data) }),
                select: () => ({ get: async () => ({
                    size: col(name).size,
                    docs: [...col(name).keys()].map((id) => snapOf(name, id)),
                }) }),
            };
        },
        async runTransaction(fn) {
            return fn({
                get: async (ref) => snapOf(ref._col, ref.id),
                set: (ref, data) => merge(ref._col, ref.id, data),
            });
        },
        _dump: (name) => Object.fromEntries(col(name)),
    };
    return db;
}

/**
 * Build the endpoints against a fake world.
 *
 * Both fakes go into `require.cache` BEFORE auth-endpoints.js is required, because the module
 * destructures `sendTargetedPush` at load time — patching the export afterwards would leave the
 * handler holding the real function and this suite passing while testing nothing.
 *
 * @param {object}  o
 * @param {boolean} o.adminResolves  can the admin NAME be resolved to a uid at all
 * @param {number}  o.pushAccepts    how many subscriptions accept each targeted push (0 = nobody)
 * @param {object}  o.seed           starting Firestore contents, by collection
 * @param {object}  o.authFail       force one Auth call to throw, e.g. { setCustomUserClaims: 'boom' }
 * @param {object}  o.token          what verifyIdToken resolves to (null → it throws, i.e. no token)
 * @param {object[]} o.existingUsers accounts that already exist, for listUsers / already-exists
 */
function build({
    adminResolves = true,
    pushAccepts = 1,
    seed = {},
    authFail = {},
    token = { admin: true, name: ADMIN },
    existingUsers = null,
} = {}) {
    const sends = [];
    /** Every Auth MUTATION, in order. The point of recording rather than counting: a test asking
     *  "did a refused call still reset the password?" needs the payload, not a tally. */
    const authOps = [];
    const fnDir = new URL('./functions/', import.meta.url).pathname;
    const authPath  = require.resolve('firebase-admin/auth', { paths: [fnDir] });
    const firePath  = require.resolve('firebase-admin/firestore', { paths: [fnDir] });
    const pushPath  = require.resolve('./functions/push.js');
    const db = makeDb(seed);
    const users = new Map((existingUsers || []).map((u) => [u.email, u]));

    const firestore = () => db;
    firestore.FieldValue = { serverTimestamp: () => SERVER_TS, increment: (n) => ({ inc: n }) };
    const notFound = () => { const e = new Error('nope'); e.code = 'auth/user-not-found'; throw e; };
    const auth = {
        verifyIdToken: async (bearer, checkRevoked) => {
            authOps.push({ op: 'verifyIdToken', bearer, checkRevoked });
            if (!token) throw new Error('no token');
            return token;
        },
        getUserByEmail: async (email) => {
            if (users.has(email)) return users.get(email);
            if (email === emailFor(ADMIN)) {
                if (!adminResolves) return notFound();
                return { uid: ADMIN_UID, email };
            }
            // Any other roster member resolves — these endpoints only ever ask about names they
            // have already checked against the server-owned list.
            const known = /@myb-roster\.local$/.test(email);
            return known ? { uid: `uid_${email.split('@')[0]}`, email } : notFound();
        },
        createUser: async ({ email, password, displayName }) => {
            authOps.push({ op: 'createUser', email, password, displayName });
            if (users.has(email)) { const e = new Error('exists'); e.code = 'auth/email-already-exists'; throw e; }
            const u = { uid: uidFor(displayName || email), email };
            users.set(email, u);
            return u;
        },
        updateUser: async (uid, patch) => {
            authOps.push({ op: 'updateUser', uid, patch });
            if (authFail.updateUser) throw new Error(authFail.updateUser);
            return { uid, ...patch };
        },
        revokeRefreshTokens: async (uid) => {
            authOps.push({ op: 'revokeRefreshTokens', uid });
            if (authFail.revokeRefreshTokens) throw new Error(authFail.revokeRefreshTokens);
        },
        setCustomUserClaims: async (uid, claims) => {
            authOps.push({ op: 'setCustomUserClaims', uid, claims });
            if (authFail.setCustomUserClaims) throw new Error(authFail.setCustomUserClaims);
        },
        listUsers: async () => ({ users: [...users.values()], pageToken: undefined }),
    };
    // Injected at the MODULAR entry points, which is what the handlers require since the
    // firebase-admin v14 migration — the old single `firebase-admin` root export no longer
    // carries `auth`/`firestore`, so a fake installed there would be loaded by nobody and every
    // assertion below would run against the real SDK.
    const stub = (p, exports) => { require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
    stub(authPath, { getAuth: () => auth });
    stub(firePath, { getFirestore: () => db, FieldValue: firestore.FieldValue });
    require.cache[pushPath]  = { id: pushPath, filename: pushPath, loaded: true, exports: {
        setupWebPush: () => {},
        sendTargetedPush: async (payload, uids, tag) => {
            sends.push({ payload, uids, tag });
            // The REAL sendTargetedPush returns how many subscriptions accepted the message, and
            // the reset endpoint acts on that number. A fake returning undefined would make every
            // "did it record that the admin was reached?" assertion vacuous.
            return pushAccepts;
        },
        // Present so a handler that reached for the broadcast would RUN and be caught by an
        // assertion, rather than throwing an import error that reads like a broken test.
        fanOutPush: async (payload) => { sends.push({ payload, uids: 'EVERYONE' }); return 0; },
    } };
    delete require.cache[require.resolve('./functions/auth-endpoints.js')];
    const { buildAuthEndpoints } = require('./functions/auth-endpoints.js');
    const eps = buildAuthEndpoints({
        VAPID_PRIVATE_KEY: { value: () => 'private' },
        VAPID_PUBLIC_KEY: 'public',
        STAFF_SITE_URL: 'https://myb-roster.web.app',
        ADMIN_FUNCTION_ORIGINS: ['https://myb-roster.web.app'],
    });
    return { eps, sends, db, authOps, users };
}

function makeRes() {
    const out = { code: 200, body: null };
    const res = new EventEmitter();
    let done = false;
    Object.assign(res, {
        status(c) { out.code = c; return res; },
        json(b) { out.body = b; res.end(); return res; },
        send(b) { out.body = b; res.end(); return res; },
        setHeader() { return res; }, getHeader() { return undefined; }, removeHeader() { return res; },
        set() { return res; }, vary() { return res; }, writeHead(c) { out.code = c; return res; },
        end() { if (!done) { done = true; process.nextTick(() => res.emit('finish')); } return res; },
    });
    return { res, out };
}

const reqWith = (body, headers = {}) => ({
    method: 'POST',
    headers: { origin: 'https://myb-roster.web.app', ...headers },
    body,
    url: '/', path: '/', query: {},
    get(h) { return this.headers[String(h).toLowerCase()]; },
    header(h) { return this.get(h); },
});
const reqFor = (member) => reqWith({ member });
const asAdmin = (body) => reqWith(body, { authorization: 'Bearer tok' });

/** Run one endpoint and give back its status + body. */
async function call(ep, req) {
    const { res, out } = makeRes();
    await ep(req, res);
    return out;
}

describe('the reset request tells the ADMIN, and only the admin', () => {
    test('the push is addressed to the admin uid — never to everyone', async () => {
        const { eps, sends } = build();
        const out = await call(eps.requestPasswordReset, reqFor(MEMBER));

        assert.equal(out.code, 200);
        assert.equal(sends.length, 1, 'exactly one push');
        assert.deepEqual(sends[0].uids, [ADMIN_UID], 'the resolved admin uid, and nothing else');
        assert.notEqual(sends[0].uids, 'EVERYONE');
        // The body names the member who asked — which is precisely why it must not be broadcast.
        assert.match(String(sends[0].payload.body), new RegExp(MEMBER));
    });

    test('an admin whose uid cannot be resolved sends NOTHING, rather than falling back', async () => {
        // The failure direction that matters: "no targets" must mean silence. A fall-back-to-
        // everyone here would broadcast a named colleague's lockout at the exact moment the
        // addressing failed — the worst possible time to widen an audience.
        const { eps, sends } = build({ adminResolves: false });
        const out = await call(eps.requestPasswordReset, reqFor(MEMBER));

        assert.equal(sends.length, 0);
        // ...and the REQUEST still succeeds. The row in Firestore is the doorbell; the push is a
        // courtesy on top, and losing the courtesy must never lose the request.
        assert.equal(out.code, 200);
    });

    test('a throttled repeat does not ring the admin again', async () => {
        // The per-member throttle is the notification's rate limit too — without that, anyone with
        // the URL could ring the admin's phone at will.
        const { eps, sends } = build({ seed: { resetRequests: { [MEMBER]: { requestedAt: { toMillis: () => NOW } } } } });
        await call(eps.requestPasswordReset, reqFor(MEMBER));
        assert.equal(sends.length, 0);
    });
});

describe('coalescing counts notifications SENT, not requests arrived (v21.85)', () => {
    // The distinction is the whole point. Suppressing a second member's notification is only
    // defensible if the first one actually reached somebody; otherwise a burst of two locked-out
    // colleagues produces total silence, and the log line claims the admin was told.

    test('an accepted push records that the admin was reached', async () => {
        const { eps, db } = build();
        await call(eps.requestPasswordReset, reqFor(MEMBER));
        const row = db._dump('resetRequests')[MEMBER];
        assert.ok(row.notifiedAt, 'notifiedAt is stamped once a subscription accepted the push');
        assert.equal(typeof row.notifiedAt.toMillis, 'function', 'stamped as a timestamp, not a sentinel');
    });

    test('and then coalesces the next member inside the window', async () => {
        const { eps, sends } = build();
        await call(eps.requestPasswordReset, reqFor(MEMBER));
        await call(eps.requestPasswordReset, reqFor(MEMBER2));
        assert.equal(sends.length, 1, 'one push covers the burst — the tag carries the queue depth');
    });

    test('a push NOBODY accepted is not recorded as a notification', async () => {
        // The admin's only subscription predates the `owner` stamp, or the push service had a bad
        // minute. Either way nothing was delivered, so nothing may be written down as delivered.
        const { eps, db, sends } = build({ pushAccepts: 0 });
        await call(eps.requestPasswordReset, reqFor(MEMBER));
        assert.equal(sends.length, 1, 'it was attempted');
        assert.equal(db._dump('resetRequests')[MEMBER].notifiedAt, undefined,
            'but not recorded as having reached anyone');
    });

    test('so the NEXT locked-out member still rings the phone', async () => {
        // This is the defect the v21.83 review found: under the old `requestedAt` criterion, member
        // one's failed push silenced member two for the rest of the window. Nothing was lost — the
        // rows are authoritative — but the phone stayed quiet and the logs said otherwise.
        const { eps, sends } = build({ pushAccepts: 0 });
        await call(eps.requestPasswordReset, reqFor(MEMBER));
        await call(eps.requestPasswordReset, reqFor(MEMBER2));
        assert.equal(sends.length, 2, 'both attempts go out while none of them is landing');
    });

    test('a row written before v21.85 has no notifiedAt, and fails OPEN', async () => {
        // The transition itself: every existing row carries requestedAt and no notifiedAt. Reading
        // an absent stamp as "recently notified" would silence the queue for a whole window on the
        // deploy; reading it as "no evidence" notifies, which is the right way for this to be wrong.
        const { eps, sends } = build({
            seed: { resetRequests: { [MEMBER2]: { requestedAt: { toMillis: () => NOW } } } },
        });
        await call(eps.requestPasswordReset, reqFor(MEMBER));
        assert.equal(sends.length, 1);
    });
});

describe('resetMemberPassword refuses BEFORE it writes', () => {
    // Every guard here is individually tested elsewhere. What is not is the order: a handler that
    // reset the account and then returned 403 would satisfy every status-code assertion ever
    // written about it. So each refusal case asserts on the Auth operations that did NOT happen.

    const passwordWrites = (authOps) =>
        authOps.filter((o) => o.op === 'updateUser' && o.patch && 'password' in o.patch);

    test('a non-admin token is refused, and no password is rewritten', async () => {
        const { eps, authOps } = build({ token: { name: MEMBER } });   // signed in, not an admin
        const out = await call(eps.resetMemberPassword, asAdmin({ member: MEMBER }));
        assert.equal(out.code, 403);
        assert.deepEqual(passwordWrites(authOps), [], 'nothing was reset on the way to the refusal');
    });

    test('a manager claim is not enough — only admin', async () => {
        // `manager` writes overrides on members' behalf all day; it must not reach a credential.
        const { eps, authOps } = build({ token: { manager: true, name: MANAGER } });
        const out = await call(eps.resetMemberPassword, asAdmin({ member: MEMBER }));
        assert.equal(out.code, 403);
        assert.deepEqual(passwordWrites(authOps), []);
    });

    test('an unverifiable token is refused', async () => {
        const { eps, authOps } = build({ token: null });
        const out = await call(eps.resetMemberPassword, asAdmin({ member: MEMBER }));
        assert.equal(out.code, 401);
        assert.deepEqual(passwordWrites(authOps), []);
    });

    test('the token is checked for REVOCATION, not merely for signature', async () => {
        // A disabled admin's cached ID token stays cryptographically valid for up to an hour.
        // checkRevoked is the difference between "was an admin" and "is an admin", on the one
        // endpoint that can hand somebody else's account a guessable password.
        const { eps, authOps } = build();
        await call(eps.resetMemberPassword, asAdmin({ member: MEMBER }));
        const verify = authOps.find((o) => o.op === 'verifyIdToken');
        assert.equal(verify.checkRevoked, true);
    });

    test('a member the SERVER roster does not know is refused, whatever the body says', async () => {
        // B4: the target list is server-owned. A client-supplied name reaching updateUser would let
        // an admin account reset something outside the roster entirely.
        const { eps, authOps } = build();
        const out = await call(eps.resetMemberPassword, asAdmin({ member: 'Z. Nobody' }));
        assert.equal(out.code, 404);
        assert.deepEqual(passwordWrites(authOps), []);
    });
});

describe('resetMemberPassword does the whole job when it does proceed', () => {
    test('it resets the right account, revokes, and flags them un-migrated', async () => {
        const { eps, authOps, db } = build();
        const out = await call(eps.resetMemberPassword, asAdmin({ member: MEMBER }));

        assert.equal(out.code, 200);
        const write = authOps.find((o) => o.op === 'updateUser');
        assert.equal(write.uid, `uid_${emailFor(MEMBER).split('@')[0]}`, "the member's own account");
        // The surname default, lowercased and padded to Firebase's six-character minimum. Asserted
        // by VALUE: a reset that set some other string would lock the member out of the very
        // account this endpoint exists to give them back.
        assert.equal(write.patch.password, 'springer');
        assert.ok(authOps.some((o) => o.op === 'revokeRefreshTokens'),
            'other devices are signed out — a reset that left them running is not a reset');
        assert.ok(db._dump('passwordStatus')[MEMBER].resetAt,
            'stamped back to surname-default so the migration nudge returns');
        assert.equal(out.body.stamped, true);
    });

    test('revoke:false leaves working sessions alone', async () => {
        // The migration-nudge path. Signing everyone out to prompt a password change would be a
        // bigger interruption than the thing being prompted.
        const { eps, authOps } = build();
        await call(eps.resetMemberPassword, asAdmin({ member: MEMBER, revoke: false }));
        assert.equal(authOps.filter((o) => o.op === 'revokeRefreshTokens').length, 0);
    });

    test('a failed REVOCATION does not report the reset as failed either', async () => {
        // v21.86, external audit. Revocation used to be a bare await inside the outer try, so a
        // failure took the whole call to the generic 500 — skipping the resetAt stamp on the way.
        // The admin was told nothing happened about an account now sitting on the surname default,
        // whose reasonable next step is to retry, or to tell the member their old password is fine.
        const { eps, authOps, db } = build({ authFail: { revokeRefreshTokens: 'network' } });
        const out = await call(eps.resetMemberPassword, asAdmin({ member: MEMBER }));

        assert.equal(out.code, 200, 'the password change is irreversible — it is reported');
        assert.equal(out.body.revoked, false, 'and `revoked` says what HAPPENED');
        assert.equal(out.body.revokeFailed, true, 'named explicitly, because a live session may remain');
        assert.ok(authOps.some((o) => o.op === 'updateUser' && o.patch.password),
            'the password really was rewritten');
        assert.ok(db._dump('passwordStatus')[MEMBER].resetAt,
            'and the stamp still ran — it used to be skipped, leaving the table wrong as well');
    });

    test('`revoked` reports the outcome, not the request', async () => {
        // The old field echoed the REQUEST back, so it read `true` on exactly the path where the
        // revocation had failed. A caller cannot distinguish those, and this one now can.
        const { eps } = build({ authFail: { revokeRefreshTokens: 'network' } });
        const out = await call(eps.resetMemberPassword, asAdmin({ member: MEMBER, revoke: true }));
        assert.equal(out.body.revoked, false);

        const { eps: ok } = build();
        const good = await call(ok.resetMemberPassword, asAdmin({ member: MEMBER, revoke: true }));
        assert.equal(good.body.revoked, true);
        assert.equal(good.body.revokeFailed, undefined, 'and nothing is flagged when nothing failed');
    });

    test('a failed Firestore stamp does not report the reset as failed', async () => {
        // The password IS changed and the sessions ARE revoked by this point. Reporting 500 here
        // told an admin "nothing changed" about an account that had just been reset — they would
        // reasonably then tell the member their old password still works.
        const { eps } = build();
        // Break only the stamp: the passwordStatus doc refuses the write.
        const { eps: eps2 } = (() => {
            const built = build();
            const orig = built.db.collection.bind(built.db);
            built.db.collection = (name) => (name === 'passwordStatus'
                ? { doc: () => ({ set: async () => { throw new Error('firestore down'); } }) }
                : orig(name));
            return { eps: built.eps };
        })();
        assert.ok(eps);   // the unbroken build is only here to prove the fixture itself is sound

        const out = await call(eps2.resetMemberPassword, asAdmin({ member: MEMBER }));
        assert.equal(out.code, 200, 'the reset stands');
        assert.equal(out.body.stamped, false, 'and says plainly that the flag did not get written');
    });
});

describe('setupRosterAuth stamps claims from the SERVER roster, never the request', () => {
    // This is B4's entire promise, and it is a property of the wiring: `claimsForTier` and
    // `resolveRosterAuthConfig` are each thoroughly tested, and both would keep passing if the
    // handler fed them the request body.

    const claimFor = (authOps, name) =>
        authOps.find((o) => o.op === 'setCustomUserClaims' && o.uid === uidFor(name))?.claims;

    test('a body claiming the caller is an admin changes nobody s tier', async () => {
        const { eps, authOps } = build();
        await call(eps.setupRosterAuth, asAdmin({
            // Everything a tampered client could try: promote a member, demote the real admin,
            // and shrink the roster to just themselves.
            members: [MEMBER],
            admin:   [MEMBER],
            manager: [MEMBER],
            designer: [MEMBER],
            adminNames: [MEMBER],
        }));

        assert.deepEqual(claimFor(authOps, MEMBER), { name: MEMBER },
            'an ordinary member gets the name claim and nothing else, however they ask');
        assert.deepEqual(claimFor(authOps, ADMIN), { admin: true, name: ADMIN, linksDesigner: true },
            'and the real admin keeps admin — the body could not demote them either');
    });

    test('the manager and designer tiers come from the server lists too', async () => {
        const { eps, authOps } = build();
        await call(eps.setupRosterAuth, asAdmin({}));
        assert.deepEqual(claimFor(authOps, MANAGER), { manager: true, name: MANAGER });
        assert.deepEqual(claimFor(authOps, DESIGNER), { name: DESIGNER, linksDesigner: true });
    });

    test('every provisioned account is given a name claim', async () => {
        // The `name` claim is what per-member override isolation and staffContact ownership are
        // built on. An account without one can sign in and then write nowhere, which presents as
        // "the app is broken for me" rather than as an auth error.
        const { eps, authOps } = build();
        await call(eps.setupRosterAuth, asAdmin({}));
        const claims = authOps.filter((o) => o.op === 'setCustomUserClaims');
        assert.ok(claims.length >= 50, 'the whole roster was processed');
        assert.ok(claims.every((c) => typeof c.claims.name === 'string' && c.claims.name),
            'no account is left without a name claim');
    });

    test('a non-admin caller creates no accounts and sets no claims', async () => {
        const { eps, authOps } = build({ token: { manager: true, name: MANAGER } });
        const out = await call(eps.setupRosterAuth, asAdmin({}));
        assert.equal(out.code, 403);
        assert.deepEqual(authOps.filter((o) => o.op !== 'verifyIdToken'), [],
            'the refusal happens before any account work');
    });
});

describe('setupRosterAuth previews leavers before it disables them', () => {
    const leaver = { uid: 'uid_leaver', email: 'x.gone@myb-roster.local', disabled: false };

    test('removeOrphans alone is a DRY RUN — it disables nobody', async () => {
        const { eps, authOps } = build({ existingUsers: [leaver] });
        const out = await call(eps.setupRosterAuth, asAdmin({ removeOrphans: true }));

        assert.equal(out.body.orphanDryRun, true);
        assert.ok(out.body.orphansToDisable.some((l) => l.includes('x.gone')), 'it is listed');
        assert.ok(!authOps.some((o) => o.op === 'updateUser' && o.uid === leaver.uid && o.patch.disabled),
            'and nothing was disabled without a confirm');
    });

    test('with the confirm it disables AND revokes', async () => {
        // Disabling alone blocks the next sign-in and leaves an already-issued token working for
        // up to an hour — on an account that has just been declared a leaver.
        const { eps, authOps } = build({ existingUsers: [leaver] });
        const out = await call(eps.setupRosterAuth,
            asAdmin({ removeOrphans: true, confirmOrphanRemoval: true }));

        assert.ok(out.body.disabled.some((l) => l.includes('x.gone')));
        assert.ok(authOps.some((o) => o.op === 'updateUser' && o.uid === leaver.uid && o.patch.disabled === true));
        assert.ok(authOps.some((o) => o.op === 'revokeRefreshTokens' && o.uid === leaver.uid));
    });

    test('a current member is never swept, even one whose account already existed', async () => {
        const existing = { uid: uidFor(MEMBER), email: emailFor(MEMBER), disabled: false };
        const { eps, authOps } = build({ existingUsers: [existing] });
        await call(eps.setupRosterAuth, asAdmin({ removeOrphans: true, confirmOrphanRemoval: true }));
        assert.ok(!authOps.some((o) => o.op === 'updateUser' && o.uid === existing.uid && o.patch.disabled === true),
            'the active set is built from the members actually processed, not from the request');
    });
});

test('the module never reaches for a broadcast sender', () => {
    // A static twin of the first case. The handler could acquire `fanOutPush` in a refactor that no
    // behavioural test happens to exercise — an error path, a "no targets" fallback — and the cost
    // of finding that out in production is a leak, so the import surface is pinned as well.
    const src = readFileSync(new URL('./functions/auth-endpoints.js', import.meta.url), 'utf8');
    assert.ok(!/fanOutPush/.test(src),
        'auth-endpoints.js must not reference fanOutPush — this notification names one person');
});


// ── getAccountSetupGaps ───────────────────────────────────────────────────────

/**
 * The provisioning audit, driven for real. `summariseAccountGaps` is thoroughly tested next door in
 * roster-parse-helpers.test.mjs, and that is exactly the shape this file exists to distrust: a
 * perfect rule reached with the wrong argument, in the wrong access context, or with its answer
 * discarded. Four properties are WIRING and cannot be seen from the pure side —
 *
 *   · the roster it compares against is the SERVER's, never anything in the request;
 *   · it is a READ, so it must not create, disable or re-claim a single account while looking;
 *   · a non-admin gets nothing — this response carries names, which the sign-in stats deliberately
 *     do not;
 *   · the refusal survives the trip, rather than being flattened into "no gaps found".
 *
 * That last one is the difference between "nobody needs setting up" and "we could not tell", and
 * the strip on the other end renders those two identically unless the endpoint keeps them apart.
 */
describe('getAccountSetupGaps — the provisioning audit', () => {
    const { resolveRosterAuthConfig, claimsForTier, nameToEmail } =
        require('./functions/roster-parse-helpers.js');
    const rosterCfg = resolveRosterAuthConfig(require('./functions/roster-members.json'));
    const SETS = {
        adminSet:    new Set(rosterCfg.admin),
        managerSet:  new Set(rosterCfg.manager),
        designerSet: new Set(rosterCfg.designer),
    };
    /** The whole roster, provisioned exactly as Set up accounts would leave it. */
    const fullyProvisioned = () => rosterCfg.processMembers.map((name) => ({
        uid: uidFor(name), email: nameToEmail(name), displayName: name,
        disabled: false, customClaims: claimsForTier(name, SETS),
    }));
    const getReq = (headers = { authorization: 'Bearer tok' }) => ({
        ...reqWith(undefined, headers), method: 'GET',
    });
    /** Anything that would CHANGE an account. verifyIdToken is a read and is expected. */
    const MUTATIONS = ['createUser', 'updateUser', 'setCustomUserClaims', 'revokeRefreshTokens'];

    test('a fully provisioned roster reports nothing, and refuses nothing', async () => {
        const { eps } = build({ existingUsers: fullyProvisioned() });
        const out = await call(eps.getAccountSetupGaps, getReq());
        assert.equal(out.code, 200);
        assert.deepEqual(out.body, { setUp: [], leavers: [] });
    });

    test('a member with no account comes back BY NAME', async () => {
        // A count the admin cannot act on is worse than none — the name is the deliverable.
        const victim = rosterCfg.processMembers.find((n) => !SETS.adminSet.has(n));
        const { eps } = build({ existingUsers: fullyProvisioned().filter((u) => u.displayName !== victim) });
        const out = await call(eps.getAccountSetupGaps, getReq());
        assert.deepEqual(out.body.setUp, [{ name: victim, why: 'no-account' }]);
    });

    test('a leaver still enabled comes back too, in the OTHER group', async () => {
        const { eps } = build({ existingUsers: [...fullyProvisioned(), {
            uid: 'uid_gone', email: 'z.gone@myb-roster.local', displayName: 'Z. Gone',
            disabled: false, customClaims: { name: 'Z. Gone' },
        }] });
        const out = await call(eps.getAccountSetupGaps, getReq());
        assert.deepEqual(out.body.setUp, [], 'a leaver is not something Set up accounts fixes');
        assert.deepEqual(out.body.leavers, ['Z. Gone']);
    });

    test('it compares against the SERVER roster — a request body cannot shrink it', async () => {
        // B4's whole point, and a property of the wiring rather than of either helper: pass a
        // roster in the body and the endpoint must not notice it exists.
        const victim = rosterCfg.processMembers.find((n) => !SETS.adminSet.has(n));
        const { eps } = build({ existingUsers: fullyProvisioned().filter((u) => u.displayName !== victim) });
        const req = { ...getReq(), body: { activeMembers: [], roles: { admin: [ADMIN] } } };
        const out = await call(eps.getAccountSetupGaps, req);
        assert.deepEqual(out.body.setUp, [{ name: victim, why: 'no-account' }]);
    });

    test('it changes NOTHING while it looks', async () => {
        // The read-only property, and the reason it is a property rather than a convention: an
        // audit that quietly repaired what it found would make the gap invisible again, which is
        // the exact state this feature exists to end. Assert on the recorded ops, not on intent.
        const victim = rosterCfg.processMembers.find((n) => !SETS.adminSet.has(n));
        const { eps, authOps, db } = build({ existingUsers: fullyProvisioned().filter((u) => u.displayName !== victim) });
        await call(eps.getAccountSetupGaps, getReq());
        const mutated = authOps.filter((o) => MUTATIONS.includes(o.op));
        assert.deepEqual(mutated, [], 'the audit must not create, disable or re-claim anything');
        assert.deepEqual(db._dump('passwordStatus'), {}, 'and it writes no Firestore either');
    });

    describe('and it is admin-only, because this one carries names', () => {
        test('no token → 401, and nothing is read', async () => {
            const { eps } = build({ token: null, existingUsers: fullyProvisioned() });
            const out = await call(eps.getAccountSetupGaps, getReq({}));
            assert.equal(out.code, 401);
            assert.equal(out.body.setUp, undefined);
        });

        test('a member token → 403', async () => {
            const { eps } = build({ token: { name: MEMBER }, existingUsers: fullyProvisioned() });
            const out = await call(eps.getAccountSetupGaps, getReq());
            assert.equal(out.code, 403);
            assert.equal(out.body.setUp, undefined);
        });

        test('a MANAGER token → 403 as well', async () => {
            // Managers write on members' behalf all day; provisioning is not theirs, and `admin`
            // is checked strictly rather than "is elevated".
            const { eps } = build({ token: { manager: true, name: MANAGER }, existingUsers: fullyProvisioned() });
            assert.equal((await call(eps.getAccountSetupGaps, getReq())).code, 403);
        });

        test('a POST is refused — this endpoint only ever reads', async () => {
            const { eps } = build({ existingUsers: fullyProvisioned() });
            const out = await call(eps.getAccountSetupGaps, asAdmin({}));
            assert.equal(out.code, 405);
        });
    });

    test('“we could not tell” survives the trip as a refusal, not as “no gaps”', async () => {
        // With no accounts visible the pure rule refuses rather than naming the whole roster. If
        // the handler dropped `refused`, the caller would render a clean bill of health at the one
        // moment the data is least trustworthy.
        const { eps } = build({ existingUsers: [] });
        const out = await call(eps.getAccountSetupGaps, getReq());
        assert.equal(out.code, 200);
        assert.equal(out.body.refused, 'no-accounts-visible');
        assert.deepEqual(out.body.setUp, []);
    });
});
