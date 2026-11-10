/**
 * Unit tests for the login-overlay.js sign-in CORE: runNamedSignIn().
 * Run with: node --experimental-test-module-mocks scripts/run-tests.mjs login-overlay.test.mjs
 *
 * WHY THIS EXISTS: the suite covered session helpers and overlay presence, but NOT the sign-in
 * click path — which is exactly where the v14.72–75 login-freeze regressions lived (local session
 * saved before auth completed; no timeout on the auth step). See LOGIN_INCIDENT.md.
 *
 * The logic under test (runNamedSignIn) is DOM-free and takes ALL its dependencies as arguments, so
 * most tests drive it directly with recording stubs — no fake DOM, no real Firebase. The block at
 * the end drives it through `signInDeps`, the wiring the card's submit uses, against the REAL
 * session.js: so session.js is not mocked here, firebase-client.js (→ the CDN SDK) is, along with
 * the browser-only modules the card imports (overlay.js, the picker, the perf reporter) and ls.js.
 *
 * NOT covered here (deliberate): the DOM wiring of attempt() itself (reading form values, button
 * text, the lockout, the in-place vs reload onSuccess) is exercised by the Playwright suite
 * (e2e/auth.spec.js), not this unit file. The load-bearing contract — "commit the local session ONLY
 * after auth genuinely resolves, time-boxed" — lives entirely in runNamedSignIn and is fully
 * exercised below.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

// A fake of the Firebase SDK behind firebase-client.js — just what session.js calls on a TYPED
// sign-in. Each control is a code the SDK call rejects with, or 'ok'.
const realIdentity = await import('./auth-identity.js');
const fakeAuth = { currentUser: /** @type {any} */ (null) };
let signInCode  = 'ok';
let signOutCode = 'ok';
mock.module('./firebase-client.js', { namedExports: {
    auth:                       fakeAuth,
    authReady:                  Promise.resolve('indexeddb'),
    currentUserAfterBoot:       async () => fakeAuth.currentUser,
    nameToEmail:                realIdentity.nameToEmail,
    normaliseSurname:           realIdentity.normaliseSurname,
    signInWithEmailAndPassword: async (/** @type {any} */ _auth, /** @type {string} */ email) => {
        if (signInCode !== 'ok') throw Object.assign(new Error(signInCode), { code: signInCode });
        fakeAuth.currentUser = { uid: 'u-member', isAnonymous: false, email, getIdToken: async () => 't' };
    },
    signOut: async () => {
        if (signOutCode !== 'ok') throw Object.assign(new Error(signOutCode), { code: signOutCode });
        fakeAuth.currentUser = null;
    },
    restoreMemberPersistence:   async () => 'indexeddb',
    probeResetAtMs:             async () => 0,
    // password-force.js's, which the card imports for `withTimeout`; nothing here opens that overlay.
    getPasswordStatus:          async () => null,
    changeOwnPassword:          async () => ({ stamp: Promise.resolve(true) }),
    reauthenticateWithPassword: async () => {},
} });
mock.module('./notif.js', { namedExports: { releaseDevicePush: async () => {} } });
const store = new Map();
mock.module('./ls.js', { namedExports: {
    lsGet: (/** @type {string} */ k) => store.get(k) ?? null,
    lsSet: (/** @type {string} */ k, /** @type {any} */ v) => { store.set(k, String(v)); },
    lsDel: (/** @type {string} */ k) => { store.delete(k); },
} });
let unlocks = 0;   // scroll-lock releases — see dismissLoginOverlay below
mock.module('./overlay.js', { namedExports: { lockBodyScroll: () => {}, unlockBodyScroll: () => { unlocks++; }, trapFocus: () => {}, createLightbox: () => ({ open() {}, close() {} }) } });
// The sign-in pickers go through the app's own sheet (v23.49). This suite is about `runNamedSignIn`
// — what it commits and when — so the picker is stubbed to a no-op returning a no-op refresher
// rather than driven here: its own behaviour is covered by select-sheet.test.mjs (the rules), the
// parity suite (the wiring) and e2e/auth.spec.js (a real click on a real row, which is the only
// place the z-index defect this shipped with could ever have been seen).
mock.module('./select-sheet.js', { namedExports: { enhanceSelect: () => () => {} } });
mock.module('./perf-reporter.js', { namedExports: { markLoginStart: () => {}, clearLoginStart: () => {}, recordPageLatency: () => {}, markAwaitingInput: () => {} } });

const { runNamedSignIn, signInDeps, isAboutLinkAllowed, dismissLoginOverlay } = await import('./login-overlay.js');
const { CALENDAR_VIEWER_UID } = await import('./calendar-access-core.js');

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

    test('and a sign-in that works saves the session for the member named', async () => {
        const r = await attempt();
        assert.deepEqual(r, { ok: true });
        assert.equal(JSON.parse(store.get('myb_admin_session')).name, 'G. Miller');
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
