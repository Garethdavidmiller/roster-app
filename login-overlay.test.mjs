/**
 * Unit tests for the login-overlay.js sign-in CORE: runNamedSignIn().
 * Run with: node --experimental-test-module-mocks scripts/run-tests.mjs login-overlay.test.mjs
 *
 * WHY THIS EXISTS: the suite covered session helpers and overlay presence, but NOT the sign-in
 * click path — which is exactly where the v14.72–75 login-freeze regressions lived (local session
 * saved before auth completed; no timeout on the auth step). See ROADMAP_HISTORY.md → "The login freeze".
 *
 * The logic under test (runNamedSignIn) is DOM-free and takes ALL its dependencies as arguments, so
 * most tests drive it directly with recording stubs — no fake DOM, no real Firebase. The block at
 * the end drives it through `signInDeps`, the wiring the card's submit uses, against the REAL
 * session.js: so session.js is not mocked here, firebase-client.js (→ the CDN SDK) is, along with
 * the browser-only modules the card imports (overlay.js, the picker, the perf reporter) and ls.js.
 *
 * Mostly NOT covered here (deliberate): the DOM wiring of attempt() itself (reading form values, button
 * text, the lockout, the in-place vs reload onSuccess) is exercised by the Playwright suite
 * (e2e/auth.spec.js). The exception is the last block, which mounts the real card on a minimal fake
 * DOM for what a browser test cannot time reliably: a change of person WHILE a sign-in is in flight. The load-bearing contract — "commit the local session ONLY
 * after auth genuinely resolves, time-boxed" — lives entirely in runNamedSignIn and is fully
 * exercised below.
 */
import { test, describe, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

/** A minimal element for the card's block at the end of this file — only what initLoginOverlay touches. */
class FakeEl {
    /** @param {string} [id] */
    constructor(id = '') {
        this.id = id; this.value = ''; this.disabled = false; this.hidden = false; this.type = '';
        this.textContent = ''; this.className = ''; this._html = '';
        /** @type {any[]} */ this.options = [];
        /** @type {Map<string, string>} */ this._attrs = new Map();
        /** @type {Record<string, Function[]>} */ this._on = {};
        /** @type {Set<string>} */ const cls = new Set();
        this.classList = {
            add: (/** @type {string} */ c) => { cls.add(c); },
            remove: (/** @type {string} */ c) => { cls.delete(c); },
            contains: (/** @type {string} */ c) => cls.has(c),
            toggle: (/** @type {string} */ c, /** @type {boolean} */ on) => { if (on ?? !cls.has(c)) cls.add(c); else cls.delete(c); },
        };
    }
    set innerHTML(v) { this._html = v; if (v === '') this.options = []; }
    get innerHTML() { return this._html; }
    /** @param {any} child */ appendChild(child) { this.options.push(child); return child; }
    remove() {}
    /** @param {string} k @param {any} v */ setAttribute(k, v) { this._attrs.set(k, String(v)); }
    /** @param {string} k */ getAttribute(k) { return this._attrs.get(k) ?? null; }
    /** @param {string} k */ removeAttribute(k) { this._attrs.delete(k); }
    /** @param {string} type @param {Function} fn */ addEventListener(type, fn) { (this._on[type] ??= []).push(fn); }
    /** @param {any} e */ dispatchEvent(e) { for (const fn of this._on[e.type] ?? []) fn(e); return true; }
    focus() { /** @type {any} */ (globalThis).document.activeElement = this; }
    get isConnected() { return true; }
}

// A fake of the Firebase SDK behind firebase-client.js — just what session.js calls on a TYPED
// sign-in. Each control is a code the SDK call rejects with, or 'ok'.
const realIdentity = await import('./auth-identity.js');
const fakeAuth = { currentUser: /** @type {any} */ (null) };
let signInCode  = 'ok';
let signOutCode = 'ok';
/** When set, every typed sign-in waits on it — how the card's block holds an attempt IN FLIGHT. @type {Promise<void>|null} */
let signInGate = null;
/** The server's record of the sign-in the fake hands back (`metadata.lastSignInTime`), or none. @type {string|undefined} */
let serverSignInTime;
mock.module('./firebase-client.js', { namedExports: {
    auth:                       fakeAuth,
    authReady:                  Promise.resolve('indexeddb'),
    currentUserAfterBoot:       async () => fakeAuth.currentUser,
    nameToEmail:                realIdentity.nameToEmail,
    normaliseSurname:           realIdentity.normaliseSurname,
    signInWithEmailAndPassword: async (/** @type {any} */ _auth, /** @type {string} */ email) => {
        if (signInGate) await signInGate;
        if (signInCode !== 'ok') throw Object.assign(new Error(signInCode), { code: signInCode });
        fakeAuth.currentUser = { uid: 'u-member', isAnonymous: false, email, getIdToken: async () => 't',
            ...(serverSignInTime ? { metadata: { lastSignInTime: serverSignInTime } } : {}) };
    },
    signOut: async () => {
        if (signOutCode !== 'ok') throw Object.assign(new Error(signOutCode), { code: signOutCode });
        fakeAuth.currentUser = null;
    },
    restoreMemberPersistence:   async () => 'indexeddb',
    letViewerWritesGo:          async () => false,
    probeResetAtMs:             async () => 0,
    // password-force.js's, which the card imports for `withTimeout`; nothing here opens that overlay.
    getPasswordStatus:          async () => null,
    changeOwnPassword:          async () => ({ stamp: Promise.resolve(true) }),
    reauthenticateWithPassword: async () => {},
} });
// A RECORDER: a failure that clears ANOTHER member's session releases this device's push record (audit A1).
let releases = 0;
mock.module('./notif.js', { namedExports: { releaseDevicePush: async () => { releases++; } } });
const store = new Map();
mock.module('./ls.js', { namedExports: {
    lsGet: (/** @type {string} */ k) => store.get(k) ?? null,
    lsSet: (/** @type {string} */ k, /** @type {any} */ v) => { store.set(k, String(v)); },
    lsDel: (/** @type {string} */ k) => { store.delete(k); },
} });
let unlocks = 0;   // scroll-lock releases — see dismissLoginOverlay below
mock.module('./overlay.js', { namedExports: { lockBodyScroll: () => {}, unlockBodyScroll: () => { unlocks++; }, trapFocus: () => {}, createLightbox: () => ({ open() {}, close() {} }) } });
// The sign-in pickers go through the app's own sheet (v23.49). Its own behaviour is covered by
// select-sheet.test.mjs (the rules), the parity suite (the wiring) and e2e/auth.spec.js (a real click
// on a real row, which is the only place the z-index defect this shipped with could ever have been
// seen), so here it is a stand-in: a trigger per select, named `<id>Trigger` as the real one is, whose
// repaint copies `disabled` across — the one property of the real paint the card's block below reads.
/** @type {Map<string, any>} */
const triggers = new Map();
mock.module('./select-sheet.js', { namedExports: { enhanceSelect: (/** @type {any} */ select) => {
    const t = new FakeEl(`${select.id}Trigger`);
    triggers.set(t.id, t);
    const paint = () => { t.disabled = !!select.disabled; };
    paint();
    return paint;
} } });
mock.module('./perf-reporter.js', { namedExports: { markLoginStart: () => {}, clearLoginStart: () => {}, recordPageLatency: () => {}, markAwaitingInput: () => {} } });

const { runNamedSignIn, signInDeps, isAboutLinkAllowed, dismissLoginOverlay, resetRequestFailureLine, initLoginOverlay } = await import('./login-overlay.js');
const { getMembersForGrade, CONFIG } = await import('./roster-data.js');

// The card's DOM-free rules live in login-core.js (Nov 2026) and are re-exported here: the SAME
// functions, so every test below that reaches them through login-overlay.js tests the real ones.
test('login-core.js\'s three rules are what login-overlay.js exports', async () => {
    const core = await import('./login-core.js');
    assert.equal(runNamedSignIn, core.runNamedSignIn);
    assert.equal(isAboutLinkAllowed, core.isAboutLinkAllowed);
    assert.equal(resetRequestFailureLine, core.resetRequestFailureLine);
});
const { CALENDAR_VIEWER_UID } = await import('./calendar-access-core.js');
// The REAL teardown and the same staff-pin-ended.js instance the card listens to (audit B2/C2, below).
const { reconcileExpiredIdentity } = await import('./session.js');
const { onStaffPinEnded } = await import('./staff-pin-ended.js');

/** Build a deps object with call-recording session helpers and sensible defaults. */
function makeDeps(over = {}) {
    const calls = { save: 0, clear: 0 };
    const deps = {
        ensureNamedSession: async () => true,
        saveSession:        () => { calls.save++; return true; },
        clearSession:       () => { calls.clear++; },
        getAuthError:       () => null,
        isTransient:        () => false,
        timeoutMs:          8000,
        ...over,
    };
    return { deps, calls };
}

describe('runNamedSignIn — local session committed ONLY after auth resolves', () => {
    test('success (named resolves true) → saves session, ok:true, never clears', async () => {
        const { deps, calls } = makeDeps({ ensureNamedSession: async () => true });
        const r = await runNamedSignIn(deps);
        assert.deepEqual(r, { ok: true });
        assert.equal(calls.save, 1);
        assert.equal(calls.clear, 0);
    });

    test('named false + a CREDENTIAL rejection → NO save, clears, ok:false, kind:credential + credential message', async () => {
        const { deps, calls } = makeDeps({ ensureNamedSession: async () => false, getAuthError: () => 'auth/invalid-credential' });
        const r = await runNamedSignIn(deps);
        assert.equal(r.ok, false);
        assert.equal(r.kind, 'credential', 'a definitive failure drives the client lockout');
        // Covers both a forgotten password AND a never-provisioned account (auth/user-not-found) —
        // so it points at "the admin" without promising a reset an unset-up account can't use.
        assert.match(/** @type {string} */ (r.error), /Password not recognised.*ask the admin/);
        assert.equal(calls.save, 0);
        assert.equal(calls.clear, 1);
    });

    test('named false with NO error code is not called a wrong password (sessions-2)', async () => {
        // A typed attempt overtaken by a newer one ends with whatever code that one recorded, or none.
        // Nothing says the password was wrong, so nothing may count it towards the lockout.
        const { deps, calls } = makeDeps({ ensureNamedSession: async () => false, getAuthError: () => undefined });
        const r = await runNamedSignIn(deps);
        assert.equal(r.ok, false);
        assert.equal(r.kind, 'other');
        assert.doesNotMatch(/** @type {string} */ (r.error), /password/i);
        assert.equal(calls.save, 0);
        assert.equal(calls.clear, 1, 'a failure still never leaves somebody else\'s session behind');
    });

    test('named false + too-many-requests → kind:ratelimit, distinct message, NOT credential', async () => {
        const { deps } = makeDeps({
            ensureNamedSession: async () => false,
            getAuthError: () => 'auth/too-many-requests',
            isTransient: () => true,
        });
        const r = await runNamedSignIn(deps);
        assert.equal(r.ok, false);
        assert.equal(r.kind, 'ratelimit', 'must NOT count toward the wrong-password lockout');
        assert.match(/** @type {string} */ (r.error), /Too many attempts/);
    });

    test('named false + TRANSIENT error → connection message', async () => {
        const { deps } = makeDeps({
            ensureNamedSession: async () => false,
            getAuthError: () => 'network-request-failed',
            isTransient: () => true,
        });
        const r = await runNamedSignIn(deps);
        assert.equal(r.ok, false);
        assert.equal(r.kind, 'transient');
        assert.match(/** @type {string} */ (r.error), /reach sign-in — check your connection/);
    });

    test('auth TIMEOUT (never resolves) → NO save, clears, ok:false (the core freeze fix)', async () => {
        const { deps, calls } = makeDeps({ ensureNamedSession: () => new Promise(() => {}), timeoutMs: 30 });
        const r = await runNamedSignIn(deps);
        assert.equal(r.ok, false);
        assert.equal(r.kind, 'timeout');
        assert.match(/** @type {string} */ (r.error), /complete sign-in — check your connection/);
        assert.equal(calls.save, 0, 'must NOT write a local session on timeout (no half-signed-in state)');
        assert.equal(calls.clear, 1);
    });

    test('a failure for the member whose session this device holds leaves that session alone (v24.56)', async () => {
        // The Calendar's come-back card: their 60-day session is live, their Firebase identity has
        // gone. A typo, or a timeout on weak signal, must not sign them out of the device.
        for (const over of [{ ensureNamedSession: async () => false }, { ensureNamedSession: () => new Promise(() => {}), timeoutMs: 30 }]) {
            const { deps, calls } = makeDeps({ ...over, keepsLocalSession: () => true });
            const r = await runNamedSignIn(deps);
            assert.equal(r.ok, false);
            assert.equal(calls.clear, 0, 'their own session survives a failed attempt');
        }
    });

    test('but a stored session for somebody ELSE is still cleared on a failed sign-in', async () => {
        const { deps, calls } = makeDeps({ ensureNamedSession: async () => false, keepsLocalSession: () => false });
        await runNamedSignIn(deps);
        assert.equal(calls.clear, 1);
    });

    test('auth THROWS → treated as not signed in: NO save, clears, ok:false', async () => {
        const { deps, calls } = makeDeps({ ensureNamedSession: async () => { throw new Error('auth blew up'); } });
        const r = await runNamedSignIn(deps);
        assert.equal(r.ok, false);
        assert.equal(calls.save, 0);
        assert.equal(calls.clear, 1);
    });

    test('storage blocked (saveSession returns false) → clears, ok:false with storage message', async () => {
        // iOS Private Browsing: lsSet swallows the SecurityError, so saveSession's read-back returns
        // false. runNamedSignIn must fail cleanly (sign back out, explain) instead of returning ok:true
        // and handing off to onSuccess, which would loop back to the overlay (getSession() stays null).
        const { deps, calls } = makeDeps({ saveSession: () => { calls.save++; return false; } });
        const r = await runNamedSignIn(deps);
        assert.equal(r.ok, false);
        assert.equal(r.kind, 'storage');
        assert.match(/** @type {string} */ (r.error), /blocking storage/i);
        assert.equal(calls.save, 1, 'save was attempted');
        assert.equal(calls.clear, 1, 'signed back out so no Firebase identity is stranded');
    });

    test('a timeout hands back the attempt itself, which still answers (external review, 23 Nov 2026)', async () => {
        /** @type {(v: boolean) => void} */ let answer = () => {};
        const { deps } = makeDeps({ ensureNamedSession: () => new Promise(res => { answer = res; }), timeoutMs: 20 });
        const r = await runNamedSignIn(deps);
        assert.equal(r.kind, 'timeout');
        assert.ok(r.late instanceof Promise, 'the card can still hear the answer');
        answer(true);
        assert.equal(await r.late, true);
    });

    test('a sign-in that THREW has nothing left to arrive: no `late`', async () => {
        const { deps } = makeDeps({ ensureNamedSession: async () => { throw new Error('auth blew up'); } });
        const r = await runNamedSignIn(deps);
        assert.equal(r.kind, 'timeout', 'said as before');
        assert.equal(r.late, undefined);
    });

    test('the app ends an attempt well after the 8 seconds a SAVED identity may take to be found', async () => {
        const { SIGN_IN_GIVE_UP_MS } = await import('./login-core.js');
        const { AUTH_RESTORE_TIMEOUT_MS } = await import('./silent-sign-in.js');
        assert.ok(SIGN_IN_GIVE_UP_MS >= 3 * AUTH_RESTORE_TIMEOUT_MS, `${SIGN_IN_GIVE_UP_MS} ms`);
    });

    test('while auth is still PENDING the session is not saved (the half-signed-in regression)', async () => {
        /** @type {(v: boolean) => void} */ let resolveAuth = () => {};
        const { deps, calls } = makeDeps({
            ensureNamedSession: () => new Promise(res => { resolveAuth = res; }),
            timeoutMs: 5000,
        });
        const p = runNamedSignIn(deps);
        await Promise.resolve();   // let microtasks run — auth has NOT resolved yet
        assert.equal(calls.save, 0, 'session must not be saved while auth is pending');
        resolveAuth(true);
        assert.deepEqual(await p, { ok: true });
        assert.equal(calls.save, 1);
    });
});

// ── WHAT THE CARD IS TOLD, FOR EACH WAY THE REAL SIGN-IN FAILS (sessions-2, Nov 2026) ───────────
// Through `signInDeps` — the dependencies the card's submit hands the core — and the REAL session.js,
// with only the SDK faked. Until then every failure that was neither a connection problem nor a rate
// limit came back as a wrong password: the card said "Password not recognised", counted it towards
// the 30-second lockout and, from the second, pushed the reset link — for a site missing from the
// API key's allowed referrers, a disabled account, or a Calendar viewer that could not be signed out,
// none of which a reset can fix. The browser suite checks what the card then DOES with each kind.
describe('signInDeps → runNamedSignIn: the real sign-in path, classified (sessions-2)', () => {
    beforeEach(() => { signInCode = 'ok'; signOutCode = 'ok'; fakeAuth.currentUser = null; store.clear(); });
    const attempt = () => runNamedSignIn(signInDeps('G. Miller', 'a-password-of-my-own-7'));

    test('a wrong password and an account that does not exist get ONE sentence, so the card never says which', async () => {
        /** @type {Set<string|undefined>} */ const said = new Set();
        for (const code of ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-login-credentials']) {
            signInCode = code;
            const r = await attempt();
            assert.equal(r.kind, 'credential', code);
            said.add(r.error);
        }
        assert.equal(said.size, 1, 'one sentence for every credential rejection');
        assert.match(String([...said][0]), /^Password not recognised/);
    });

    test('a refusal no password could fix is NOT a wrong password — and it reads the same for every cause', async () => {
        /** @type {Set<string|undefined>} */ const said = new Set();
        for (const code of [
            'auth/requests-from-referer-http://localhost-are-blocked.',   // the site missing from the key's referrers
            'auth/user-disabled',
            'auth/operation-not-allowed',                                 // password sign-in switched off
            'auth/invalid-api-key',
        ]) {
            signInCode = code;
            const r = await attempt();
            assert.equal(r.ok, false, code);
            assert.equal(r.kind, 'other', `${code} must not count towards the lockout or push a reset`);
            said.add(r.error);
        }
        // The SAME sentence whether the account exists (disabled) or the request never reached any
        // account (the referrer block): the card names no account state.
        assert.equal(said.size, 1);
        const line = String([...said][0]);
        assert.doesNotMatch(line, /password/i, 'it must not send the member to fix their password');
        assert.doesNotMatch(line, /connection/i, 'nor to fix their signal');
        assert.match(line, /ask the admin/, 'an app or account matter → the admin (house wording rule)');
    });

    test('a Calendar viewer that cannot be signed out abandons the sign-in — and that is not a wrong password either', async () => {
        fakeAuth.currentUser = { uid: CALENDAR_VIEWER_UID, isAnonymous: false };
        signOutCode = 'auth/internal-error';
        const r = await attempt();
        assert.equal(r.kind, 'other');
    });

    test('a rate limit and a dropped connection keep their own kinds on the real path', async () => {
        signInCode = 'auth/too-many-requests';
        assert.equal((await attempt()).kind, 'ratelimit');
        signInCode = 'auth/network-request-failed';   // retried twice by ensureNamedSession first
        assert.equal((await attempt()).kind, 'transient');
    });

    // AUTH_AND_SESSIONS 1, second half, through the wiring the card uses (audit F2): only the browser
    // suite caught `keepsLocalSession` reduced to `() => false`, which signs a returning member out of
    // their own device on one mistyped password or one timeout on weak signal.
    const holdSession = (/** @type {string} */ name) => store.set('myb_admin_session', JSON.stringify({ name, ver: 2, expiry: Date.now() + 86_400_000 }));
    test('a failed sign-in by the member whose session this device holds leaves that session alone', async () => {
        holdSession('G. Miller');
        signInCode = 'auth/invalid-credential';
        assert.equal((await attempt()).kind, 'credential', 'premise: the sign-in failed');
        assert.equal(JSON.parse(store.get('myb_admin_session') ?? 'null')?.name, 'G. Miller', 'their own session was cleared by a typo');
    });

    // …and that member's push record goes with it (audit A1 — an end of a hold that released nothing).
    // The release is fire-and-forget behind a dynamic import (session.js), so each test here waits for
    // it — or long enough to know none came — rather than let it land in the next test's count.
    const releaseSettles = async (/** @type {number} */ want) => { for (let i = 0; i < 50 && releases < want; i++) await new Promise(r => setTimeout(r, 2)); };
    test('…but a failed sign-in by ANOTHER member clears the session this device held, and releases its push record', async () => {
        releases = 0;
        holdSession('S. Silva');
        signInCode = 'auth/invalid-credential';
        assert.equal((await attempt()).kind, 'credential', 'premise: the sign-in failed');
        assert.equal(store.has('myb_admin_session'), false, 'somebody else\'s session survived a failed sign-in on their device');
        await releaseSettles(1);
        assert.equal(releases, 1, 'their targeted notices would go on arriving on a device they no longer hold');
    });

    test('…and releases nothing for the member\'s OWN session kept, nor where no session was held', async () => {
        for (const held of ['G. Miller', null]) {
            releases = 0;
            store.clear();
            if (held) holdSession(held);
            signInCode = 'auth/invalid-credential';
            await attempt();
            await releaseSettles(1);
            assert.equal(releases, 0, held ? 'the member\'s own hold did not end, so nothing is released' : 'nobody\'s hold ended');
        }
    });

    test('and a sign-in that works saves the session for the member named', async () => {
        const r = await attempt();
        assert.deepEqual(r, { ok: true });
        assert.equal(JSON.parse(store.get('myb_admin_session')).name, 'G. Miller');
    });

    // THE PIN'S END IS STICKY FOR THE PAGE — UNTIL A MEMBER SIGNS IN THERE (audit B2/C2). Kept for
    // good, the card a member met after signing in here in place and later losing their identity said
    // again that the PIN had ended, and pointed a member at the shared code.
    test('a sign-in that works makes the PIN\'s end old news: a LATER card on this page is not told', async () => {
        fakeAuth.currentUser = { uid: CALENDAR_VIEWER_UID, isAnonymous: false };
        await reconcileExpiredIdentity();                      // this page ends the PIN, the real way
        assert.equal(fakeAuth.currentUser, null, 'premise: the teardown signed the PIN out');
        let first = 0;
        const stopFirst = onStaffPinEnded(() => { first++; });
        await Promise.resolve();
        assert.equal(first, 1, 'premise: the card up now is told');
        stopFirst();
        assert.deepEqual(await attempt(), { ok: true });      // a member signs in on that card, in place
        let later = 0;
        onStaffPinEnded(() => { later++; });                  // …and is later shown a card again
        await Promise.resolve(); await Promise.resolve();
        assert.equal(later, 0, 'a later card on the same page told a signed-in member the PIN had ended');
    });

    // The session the card saves begins when the SERVER says this sign-in happened (audit A2): a phone
    // a day ahead stamped a start a day late, and a reset later that day then looked older than it.
    test('…and dates it by the server\'s record of this sign-in, not by a device clock a day ahead', async () => {
        const server = Math.floor((Date.now() - 86_400_000) / 1000) * 1000;
        serverSignInTime = new Date(server).toUTCString();
        try {
            assert.deepEqual(await attempt(), { ok: true });
        } finally { serverSignInTime = undefined; }
        const saved = JSON.parse(store.get('myb_admin_session') ?? 'null');
        assert.equal(saved.createdAt, server, 'the session was dated by the device clock');
    });
});

// ── TAKING THE CARD DOWN RELEASES ONLY THE LOCK IT TOOK (cal-data-9's lead, Nov 2026) ─────────────
// Eight pages call dismissLoginOverlay on their authorised path, and the Calendar is to call it when a
// grant lands under its sign-in form. Only the MODAL card locks the page's scroll; the inline one (the
// Calendar's front door) never does, and releasing a lock for it releases somebody else's — the scroll
// lock is depth-counted, so a drawer or lightbox open over the page would lose its own.
describe('dismissLoginOverlay', () => {
    /** Serve `card` as #loginOverlay for the duration of `fn`. @param {any} card @param {() => void} fn */
    function withCard(card, fn) {
        const saved = /** @type {any} */ (globalThis).document;
        /** @type {any} */ (globalThis).document = { getElementById: (/** @type {string} */ id) => (id === 'loginOverlay' ? card : null) };
        try { fn(); } finally { /** @type {any} */ (globalThis).document = saved; }
    }
    /** @param {boolean} inline */
    const card = (inline) => {
        const c = { removed: false, remove() { c.removed = true; },
            classList: { contains: (/** @type {string} */ cls) => inline && cls === 'login-overlay--inline' } };
        return c;
    };

    test('a modal card is removed and its scroll lock released', () => {
        unlocks = 0;
        const c = card(false);
        withCard(c, dismissLoginOverlay);
        assert.equal(c.removed, true);
        assert.equal(unlocks, 1);
    });

    test('an inline card is removed and NOTHING is released — it never locked the page', () => {
        unlocks = 0;
        const c = card(true);
        withCard(c, dismissLoginOverlay);
        assert.equal(c.removed, true);
        assert.equal(unlocks, 0, 'an unbalanced release would free a drawer\'s or a lightbox\'s lock');
    });

    test('no card at all: nothing happens', () => {
        unlocks = 0;
        withCard(null, dismissLoginOverlay);
        assert.equal(unlocks, 0);
    });
});

// A page's explanation on its sign-in card may carry ONE link (v25.50 — the Pay Calculator's guide).
// The card is every page's way in, so the link may only lead somewhere else in the app.
describe('isAboutLinkAllowed — the sign-in card links only within the app', () => {
    test('a relative path to a page of the app is allowed, with a hash or a query', () => {
        for (const href of ['./paycalc-guide.html', './fip-guide.html#coupons', './index.html?m=2026-11']) {
            assert.equal(isAboutLinkAllowed(href), true, href);
        }
    });

    test('anything that could leave the app, or run code, is refused', () => {
        for (const href of ['https://example.com/', '//example.com/x', 'javascript:alert(1)', 'data:text/html,x',
            '/paycalc-guide.html', 'paycalc-guide.html', './x.html"onmouseover="y', ' ./x.html', '', null, undefined, 42]) {
            assert.equal(isAboutLinkAllowed(href), false, String(href));
        }
    });
});

// A REFUSED reset request is an ANSWER, not a lost connection (audit C12): the server's staff list
// lacks the name (404), or requests are switched off (503). Read as "check your connection", the
// member retried something no retry could change. The errors are built exactly as
// `requestPasswordReset` builds them; firebase-client.test.mjs pins that shape from its side.
describe('resetRequestFailureLine — what a failed reset request says', () => {
    const refused = (/** @type {number} */ status, /** @type {string} */ body) => new Error(`Server responded ${status}: ${body}`);

    test('404: the name is not on the server\'s list yet — contact the admin, not "check your connection"', () => {
        const line = resetRequestFailureLine(refused(404, '{"error":"Unknown member"}'), false);
        assert.equal(line, 'Your name isn’t on the app’s list for reset requests yet — contact the admin directly.');
    });

    test('503: requests are switched off — contact the admin', () => {
        const line = resetRequestFailureLine(refused(503, '{"error":"Reset requests are temporarily unavailable"}'), false);
        assert.equal(line, 'Reset requests aren’t available at the moment — contact the admin directly.');
    });

    test('a timeout may have arrived, whatever the error says — the wording that stops a repeat stays', () => {
        for (const err of [new Error('Timed out waiting for the server'), refused(404, '')]) {
            assert.match(resetRequestFailureLine(err, true), /^Couldn’t confirm the request reached the admin — it may have gone through\./);
        }
    });

    test('anything else keeps the connection line — a status only counts at the START of the message', () => {
        for (const err of [new TypeError('Failed to fetch'), refused(500, 'Server roster config invalid'), refused(429, ''),
            new Error('proxy said: Server responded 404: x'), null, undefined]) {
            assert.equal(resetRequestFailureLine(err, false), 'Couldn’t send the request — check your connection, or contact the admin directly.', String(err));
        }
    });

    test('no line names the PIN or tells the member to wait and retry for a refusal', () => {
        for (const line of [resetRequestFailureLine(refused(404, ''), false), resetRequestFailureLine(refused(503, ''), false)]) {
            assert.match(line, /contact the admin directly\.$/);
            assert.doesNotMatch(line, /connection|try again|PIN|!/i);
        }
    });
});

// ── THE CARD ITSELF: A CHANGE OF PERSON WHILE A SIGN-IN IS IN FLIGHT (review, Nov 2026) ──────────────
// The grade and name pickers stayed live during the round trip, so a member could change the name
// under an attempt — and the EARLIER person's failure then landed on the new one: the reset link
// raised, the 30-second lock on the button, the password they had just typed wiped. Two defences, one
// test each: the pickers are inert in flight, and an attempt that settles for somebody no longer in
// the card paints nothing on it. The real card, the real sign-in core and the real session.js, on a
// fake DOM just wide enough for them; only the Firebase SDK is faked (above), and held by `signInGate`.
describe('the sign-in card — a sign-in in flight belongs to the person it was for', () => {
    const grade = CONFIG.GRADE_ORDER.find((/** @type {string} */ g) => getMembersForGrade(g).length >= 2);
    const [A, B] = getMembersForGrade(grade).map((/** @type {any} */ m) => m.name);

    /** @type {any} */ let savedDocument;
    /** @type {any} */ let savedWindow;
    /** @type {any} */ let savedOption;
    before(() => {
        // The lock's 30-second timer is FAKED, so no test waits it out (or leaves it holding the run
        // open); the waits below are on `setImmediate`, which is left real.
        mock.timers.enable({ apis: ['setTimeout'] });
        savedDocument = /** @type {any} */ (globalThis).document;
        savedWindow = /** @type {any} */ (globalThis).window;
        savedOption = /** @type {any} */ (globalThis).Option;
    });
    after(() => {
        mock.timers.reset();
        /** @type {any} */ (globalThis).document = savedDocument;
        /** @type {any} */ (globalThis).window = savedWindow;
        /** @type {any} */ (globalThis).Option = savedOption;
    });
    beforeEach(() => {
        signInCode = 'auth/invalid-credential'; signOutCode = 'ok'; signInGate = null;
        fakeAuth.currentUser = null; store.clear(); triggers.clear();
    });

    /** Mount a fresh inline card and hand back its controls. @param {string} [presetName] @param {(name: string) => void} [onSuccess] */
    function mount(presetName = '', onSuccess = () => {}) {
        /** @type {Map<string, any>} */ const els = new Map();
        const absent = new Set(['#loginAbout', '.login-about-link', '#loginFootnote', '#loginNotice', '#loginAlternative', '#loginAlternativeHint']);
        const overlay = new FakeEl('loginOverlay');
        /** @type {any} */ (overlay).querySelector = (/** @type {string} */ sel) => {
            if (absent.has(sel)) return null;
            if (sel.endsWith('Trigger')) return triggers.get(sel.slice(1)) ?? null;
            const key = sel === 'a.login-back' ? '.login-back' : sel;
            if (!els.has(key)) els.set(key, new FakeEl(key.replace(/^[#.]/, '')));
            return els.get(key);
        };
        /** @type {any} */ (globalThis).document = {
            activeElement: null,
            getElementById: () => null,
            createElement: () => overlay,
        };
        /** @type {any} */ (globalThis).window = {};
        /** @type {any} */ (globalThis).Option = class { constructor(/** @type {string} */ text, /** @type {string} */ value) { this.textContent = text; this.value = value; } };
        initLoginOverlay({ pageLabel: 'Settings', onSuccess, host: /** @type {any} */ ({ appendChild() {} }), presetName });
        const $ = (/** @type {string} */ sel) => /** @type {any} */ (overlay).querySelector(sel);
        return {
            grade: $('#loginGrade'), name: $('#loginName'), password: $('#loginPassword'), submit: $('#loginSubmit'),
            error: $('#loginError'), reset: $('#loginResetRequest'), status: $('#loginStatus'),
            gradeTrigger: () => triggers.get('loginGradeTrigger'), nameTrigger: () => triggers.get('loginNameTrigger'),
            send: () => $('#loginForm').dispatchEvent({ type: 'submit', preventDefault() {} }),
        };
    }
    /** Let an attempt run to the end: its awaits are promise jobs, and `setImmediate` comes after them. @param {any} card */
    async function settle(card) {
        for (let i = 0; i < 200 && card.submit.textContent === 'Signing in…'; i++) await new Promise(r => setImmediate(r));
        assert.notEqual(card.submit.textContent, 'Signing in…', 'premise: the attempt settled');
    }
    /** Hold every sign-in open until the returned function is called. @returns {() => void} */
    function hold() {
        /** @type {() => void} */ let open = () => {};
        signInGate = new Promise(r => { open = () => { signInGate = null; r(); }; });
        return () => open();
    }

    // ── A SLOW ANSWER IS NOT A FAILURE (external review, 23 Nov 2026) ─────────────────────────────────
    // On patchy Wi-Fi the card said "Couldn’t complete sign-in" at 8 seconds, and Firebase signed the
    // colleague in a moment later. 8 seconds now says the attempt is taking longer; the app ends it only at
    // `SIGN_IN_GIVE_UP_MS`; and an answer that still arrives opens the page.
    /** Let promise jobs and a few `setImmediate` turns run, the mocked clock standing still. */
    const turns = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
    /** A saved app session on this device for `name` — a returning colleague's. @param {string} name */
    const holdSession = (name) => store.set('myb_admin_session', JSON.stringify({ name, ver: 2, expiry: Date.now() + 86_400_000 }));

    test('at 8 seconds a sign-in still out says it is taking longer — no failure — and the answer opens the page', async () => {
        signInCode = 'ok';
        /** @type {string[]} */ const opened = [];
        const card = mount(A, (n) => { opened.push(n); });
        const release = hold();
        card.password.value = 'their-right-password-1';
        card.send();
        await turns();
        mock.timers.tick(8000);
        await turns();
        assert.match(card.status.textContent, /taking longer than usual/, 'the card says it is slow');
        assert.equal(card.error.classList.contains('visible'), false, 'and says nothing has failed');
        assert.equal(card.submit.textContent, 'Signing in…', 'the attempt is still the card’s');
        release();
        await turns(60);
        assert.deepEqual(opened, [A], 'the answer, when it came, opened the page');
    });

    // THE REVIEWER'S CASE: a returning colleague, whose saved app session the ended attempt keeps (v24.56).
    test('ended by the app at 30 seconds, an answer that still signs a RETURNING colleague in opens the page', async () => {
        signInCode = 'ok';
        holdSession(A);
        /** @type {string[]} */ const opened = [];
        const card = mount(A, (n) => { opened.push(n); });
        const release = hold();
        card.password.value = 'their-right-password-1';
        card.send();
        await turns();
        mock.timers.tick(30_000);
        await settle(card);
        assert.equal(card.error.classList.contains('visible'), true, 'premise: the app ended the attempt and said so');
        assert.deepEqual(opened, []);
        release();
        await turns(60);
        assert.deepEqual(opened, [A], 'the late sign-in was not thrown away');
    });

    // A NEW sign-in has no saved session to keep: the ended attempt clears the device, and a request that lands
    // after it is signed back out (session.js, v24.38 — on a shared device nothing is left signed in behind
    // a card that said it failed). That safeguard stands: nothing opens.
    test('…but a first sign-in the app ended stays ended: a late landing is undone, and nothing opens', async () => {
        signInCode = 'ok';
        /** @type {string[]} */ const opened = [];
        const card = mount(A, (n) => { opened.push(n); });
        const release = hold();
        card.password.value = 'their-right-password-1';
        card.send();
        await turns();
        mock.timers.tick(30_000);
        await settle(card);
        release();
        await turns(60);
        assert.deepEqual(opened, []);
        assert.equal(fakeAuth.currentUser, null, 'the late landing was signed back out');
    });

    test('…and not once the card has moved to somebody else', async () => {
        signInCode = 'ok';
        holdSession(A);
        /** @type {string[]} */ const opened = [];
        const card = mount(A, (n) => { opened.push(n); });
        const release = hold();
        card.password.value = 'their-right-password-1';
        card.send();
        await turns();
        mock.timers.tick(30_000);
        await settle(card);
        card.name.value = B;
        release();
        await turns(60);
        assert.deepEqual(opened, [], 'A’s late answer opened nothing on a card now showing B');
    });

    test('premise: a grade with two members to switch between', () => {
        assert.ok(grade && A && B && A !== B);
    });

    test('the grade and name pickers, and their triggers, are inert while the sign-in is in flight — and come back after', async () => {
        const card = mount(A);
        assert.equal(card.name.value, A, 'premise: the preset chose the person');
        const release = hold();
        card.password.value = 'not-their-password-1';
        card.send();
        assert.equal(card.grade.disabled, true, 'the grade picker stayed live in flight');
        assert.equal(card.name.disabled, true, 'the name picker stayed live in flight');
        assert.equal(card.gradeTrigger().disabled, true, 'the grade trigger stayed tappable in flight');
        assert.equal(card.nameTrigger().disabled, true, 'the name trigger stayed tappable in flight');
        release();
        await settle(card);
        assert.equal(card.grade.disabled, false);
        assert.equal(card.name.disabled, false, 'a grade is chosen, so the name is choosable again');
        assert.equal(card.gradeTrigger().disabled, false);
        assert.equal(card.nameTrigger().disabled, false);
    });

    test('a failure that lands after the card has moved to somebody else is not painted on them — and still counts for its own person', async () => {
        const card = mount(A);
        // A's first two wrong passwords: the second raises the reset link, as it should — for A.
        for (let i = 0; i < 2; i++) { card.password.value = `wrong-${i}-for-A`; card.send(); await settle(card); }
        assert.equal(card.reset.classList.contains('login-reset-request--prompted'), true, 'premise: A was pointed at a reset');
        // A's THIRD, held in flight; meanwhile the card moves to B (a pick from a sheet already closing
        // when Enter was pressed lands like this) and B types their own password.
        const release = hold();
        card.password.value = 'wrong-2-for-A';
        card.send();
        card.name.value = B;
        card.name.dispatchEvent({ type: 'change' });
        card.password.value = 'what-B-typed';
        release();
        await settle(card);
        assert.equal(card.password.value, 'what-B-typed', 'A’s failure wiped the password B had typed');
        assert.equal(card.error.classList.contains('visible'), false, 'A’s error was shown to B');
        assert.equal(card.reset.classList.contains('login-reset-request--prompted'), false, 'A’s reset emphasis was put on B');
        assert.equal(card.submit.disabled, false, 'A’s 30-second lock was put on B');
        assert.equal(card.submit.textContent, 'Sign in →');
        // …and it was A's third failure all the same: back to A, the lock is theirs.
        card.name.value = A;
        card.name.dispatchEvent({ type: 'change' });
        assert.equal(card.submit.textContent, 'Try again in 30s', 'the failure was dropped rather than counted for A');
        assert.equal(card.submit.disabled, true);
    });

    // THE BUTTON AS THE CARD STANDS WHEN THE ATTEMPT SETTLES (24-hour check, 22 Nov 2026): a change of person in
    // flight cannot repaint the button (`showLockFor` stands aside while `_signingIn`), so the attempt does it on
    // the way out. Without that, a card moved back to a LOCKED person mid-flight offered them "Sign in →".
    test('a card moved back to a locked person while somebody else’s sign-in is in flight shows their lock when it settles', async () => {
        const card = mount(B);
        for (let i = 0; i < 3; i++) { card.password.value = `wrong-${i}-for-B`; card.send(); await settle(card); }
        assert.equal(card.submit.textContent, 'Try again in 30s', 'premise: B is locked');
        card.name.value = A;
        card.name.dispatchEvent({ type: 'change' });
        assert.equal(card.submit.textContent, 'Sign in →', 'premise: the lock is B’s alone');
        const release = hold();
        card.password.value = 'wrong-for-A';
        card.send();
        card.name.value = B;   // back to B, mid-flight (a pick from a sheet already closing)
        card.name.dispatchEvent({ type: 'change' });
        release();
        await settle(card);
        assert.equal(card.submit.textContent, 'Try again in 30s', 'B was offered a sign-in inside their own lock');
        assert.equal(card.submit.disabled, true);
    });

    test('"Choose your name first." sends the caret to the name picker’s trigger, as the grade line does', async () => {
        const card = mount();
        card.grade.value = grade;
        card.grade.dispatchEvent({ type: 'change' });
        card.submit.focus();   // where a tap on the button leaves it
        card.password.value = 'anything-at-all';
        card.send();
        await new Promise(r => setImmediate(r));
        assert.equal(card.error.textContent, 'Choose your name first.');
        assert.equal(/** @type {any} */ (globalThis).document.activeElement, card.nameTrigger(), 'the caret stayed on the button');
    });
});
