// @ts-check
// @lane hygiene
// Tests for claim-retry.js — the pure stale-claim self-heal runner extracted from firebase-client.js
// (v18.28). No mocks needed; the runner is Firebase-agnostic (deps injected). Part of test:hygiene.
import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isClaimRetryable, runWithClaimRetry, isAccessFailure, abandonOnSignOut, SIGNED_OUT_CODE, saveFailureMessage, signedOutLine, watchIdentityLoss,
    runGatedWrite, hasUnconfirmedWrite, _resetUnconfirmedWrites, UNCONFIRMED_CODE, UNCONFIRMED_LINE, unconfirmedWriteLine,
    trackBackgroundWrite, backgroundWritesInFlight, ownWritesSent, ownWritesSentFor, recordsClearOfOwnWrites, OWN_WRITES_WAIT_MS, watchOwnWritesWaits, runWatchedClaimRetry } from '../claim-retry.js';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

// ── trackBackgroundWrite (review, 11 Nov 2026) — a write no page started, counted until it settles ──
describe('trackBackgroundWrite', () => {
    it('counts a write until it lands or fails, and hands the caller the same promise', async () => {
        const base = backgroundWritesInFlight();
        /** @type {(v?: any) => void} */ let land = () => {};
        /** @type {(e?: any) => void} */ let fail = () => {};
        const a = new Promise((r) => { land = r; });
        const b = new Promise((_r, j) => { fail = j; });
        assert.equal(trackBackgroundWrite(a), a, 'not the same promise — the caller would lose its outcome');
        trackBackgroundWrite(b).catch(() => {});
        assert.equal(backgroundWritesInFlight(), base + 2);
        land(true); await a;
        await new Promise((r) => setImmediate(r));
        assert.equal(backgroundWritesInFlight(), base + 1, 'one landed, one still on its way');
        fail(new Error('refused')); await b.catch(() => {});
        await new Promise((r) => setImmediate(r));
        assert.equal(backgroundWritesInFlight(), base, 'a failed write was counted for ever');
    });
});

// ── watchIdentityLoss (v24.37; narrowed v24.38) — sign-in offered only when the account is really gone ──
describe('watchIdentityLoss', () => {
    /** Manual timers so "settled for settleMs" is a step the test takes, not a real wait. */
    /** @param {{ lost?: boolean }} [o] */
    function setup({ lost = true } = {}) {
        /** @type {Set<(u: any) => void>} */ const subs = new Set();
        /** @type {Map<number, () => void>} */ const timers = new Map();
        let id = 0, fired = 0;
        const state = { lost };
        watchIdentityLoss({
            uid: 'u1',
            watch: cb => { subs.add(cb); return () => subs.delete(cb); },
            stillLost: () => state.lost,
            onLost: () => { fired++; },
            setTimer: fn => { timers.set(++id, fn); return id; },
            clearTimer: t => { timers.delete(t); },
        });
        return {
            emit: (/** @type {any} */ u) => [...subs].forEach(cb => cb(u)),
            settle: () => { const fns = [...timers.values()]; timers.clear(); fns.forEach(f => f()); },
            state, subs, timers, get fired() { return fired; },
        };
    }
    it('fires once when nobody is signed in and it lasts, then detaches', () => {
        const w = setup();
        w.emit({ uid: 'u1' });
        w.emit(null);
        assert.equal(w.fired, 0, 'not before it has lasted');
        w.settle();
        w.emit(null); w.settle();
        assert.equal(w.fired, 1);
        assert.equal(w.subs.size, 0);
    });
    it('SHARED PC: a colleague signing in from another tab (out, then in as them) is left alone', () => {
        const w = setup();
        w.emit(null);
        w.emit({ uid: 'bob' });
        w.settle();
        assert.equal(w.fired, 0, 'the v24.37 regression signed the colleague out here');
        assert.equal(w.timers.size, 0, 'the pending check was cancelled');
    });
    it('a different account alone is never a loss', () => {
        const w = setup();
        w.emit({ uid: 'bob' });
        w.settle();
        assert.equal(w.fired, 0);
    });
    it('a DELIBERATE sign-out (local session already cleared or changed) shows nothing', () => {
        const w = setup({ lost: false });
        w.emit(null); w.settle();
        assert.equal(w.fired, 0);
    });
    it('no account at the start watches nothing', () => {
        let subscribed = false;
        watchIdentityLoss({ uid: null, watch: () => { subscribed = true; return () => {}; }, stillLost: () => true, onLost: () => {} });
        assert.equal(subscribed, false);
    });
});

test('signedOutLine — says unconfirmed and where to check, never "failed"', () => {
    const line = signedOutLine('this delete', 'Saved Changes');
    assert.equal(line, 'You were signed out before this delete was confirmed. Sign in again, then check Saved Changes.');
    assert.doesNotMatch(line, /fail|lost/i);
});

// ── abandonOnSignOut (v24.36) — a save must not wait on an account that has gone ──────────────────
/** A fake onAuthStateChanged: `emit(user)` drives every live subscriber. */
function fakeAuth() {
    /** @type {Set<(u: any) => void>} */ const subs = new Set();
    return {
        watch: (/** @type {(u: any) => void} */ cb) => { subs.add(cb); return () => subs.delete(cb); },
        emit: (/** @type {any} */ u) => [...subs].forEach(cb => cb(u)),
        get live() { return subs.size; },
    };
}
const never = () => new Promise(() => {});

describe('abandonOnSignOut', () => {
    it('a sign-out while the request is pending rejects with SIGNED_OUT_CODE — the Firestore hang', async () => {
        const a = fakeAuth();
        const p = abandonOnSignOut(never(), { uid: 'u1', watch: a.watch });
        a.emit({ uid: 'u1' });           // the first emission is the current account — not a loss
        a.emit(null);
        await assert.rejects(p, e => /** @type {any} */ (e).code === SIGNED_OUT_CODE);
        assert.equal(a.live, 0, 'the auth listener is detached');
    });
    it('a DIFFERENT account counts as gone too', async () => {
        const a = fakeAuth();
        const p = abandonOnSignOut(never(), { uid: 'u1', watch: a.watch });
        a.emit({ uid: 'u2' });
        await assert.rejects(p, e => /** @type {any} */ (e).code === SIGNED_OUT_CODE);
    });
    it('passes the result and the error through untouched, and detaches', async () => {
        const a = fakeAuth();
        assert.equal(await abandonOnSignOut(Promise.resolve('ok'), { uid: 'u1', watch: a.watch }), 'ok');
        await assert.rejects(abandonOnSignOut(Promise.reject({ code: 'unavailable' }), { uid: 'u1', watch: a.watch }),
            e => /** @type {any} */ (e).code === 'unavailable');
        await new Promise(r => setTimeout(r, 0));
        assert.equal(a.live, 0);
        a.emit(null);                    // a later sign-out reaches nothing
    });
    it('no account at the start → the request is returned unwatched', () => {
        const a = fakeAuth();
        const req = Promise.resolve(1);
        assert.equal(abandonOnSignOut(req, { uid: null, watch: a.watch }), req);
        assert.equal(a.live, 0);
    });
    it('a watcher that reports synchronously on subscribe is handled', async () => {
        const p = abandonOnSignOut(never(), { uid: 'u1', watch: cb => { cb(null); return () => {}; } });
        await assert.rejects(p, e => /** @type {any} */ (e).code === SIGNED_OUT_CODE);
    });
});

// THE WIRING. firebase-client.js loads in Node only behind the fake SDK, so the helper above could be
// perfect and never called: removing it from withClaimRetry left every suite green. Every Admin write
// goes through withClaimRetry, so this is the one line that has to hold. (Its behaviour through the
// real module: firebase-client.test.mjs → "a write the rules refused stays a refusal".)
test('withClaimRetry is runWatchedClaimRetry, watching the live auth state for the account it started as', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./firebase-client.js', REPO_ROOT_URL), 'utf8');
    // BOTH markers must be found, in this order (test audit, 7 Nov 2026). The end marker used to read
    // `export const writeWithClaimRetry`, which does not exist, so the slice ran to the end of the file
    // and the uid and watch patterns below also matched guardCommit and the push save — any one of the
    // three holding kept all three assertions green, and dropping the uid here survived every lane.
    const start = src.indexOf('export async function withClaimRetry(');
    const end = src.indexOf('export function writeWithClaimRetry');
    assert.ok(start > -1 && end > start, `withClaimRetry was not found where expected (start ${start}, end ${end})`);
    const body = src.slice(start, end);
    assert.match(body, /return runWatchedClaimRetry\(fn, \{/, 'each attempt runs inside the sign-out watch, the refresh outside it');
    assert.doesNotMatch(body, /abandonOnSignOut\(runWithClaimRetry\(/,
        'the watch is back around the whole run: a refused token refresh signs the account out, and a write the rules '
        + 'REFUSED is then reported "not confirmed" and blocks every later write until a reload');
    assert.match(body, /uid: auth\.currentUser\?\.uid/, 'the account is captured when the request starts');
    assert.match(body, /currentUid: \(\) => auth\.currentUser\?\.uid/,
        'the retry is not asked about the account signed in NOW, so it can go out as another member (17 Nov 2026)');
    assert.match(body, /watch: cb => onAuthStateChanged\(auth, cb\)/, 'the watch is the real auth state');
    // The Storage upload's retry is the same runner, and owes the same check.
    const up = src.slice(src.indexOf('async function _uploadBytesWithClaimRetry('));
    const upBody = up.slice(0, up.indexOf('\n}\n'));
    assert.match(upBody, /uid: auth\.currentUser\?\.uid,\s*currentUid: \(\) => auth\.currentUser\?\.uid/,
        'an upload\'s retry can go out as an account that signed in during the refresh');
});

// ── runWatchedClaimRetry (review, 17 Nov 2026) — the watch covers each ATTEMPT, never the refresh ──
//
// A stand-in for Firebase Auth in the SDK's own order, read in node_modules rather than assumed:
// listeners are told in a MICROTASK (its ObserverProxy), and a refused token refresh signs the account
// out BEFORE it re-throws (`_logoutIfInvalidated` awaits `auth.signOut()`). With the watch around the
// whole run, that order let the sign-out end the wait before the refusal came back.
/** @param {string} [uid] */
function sdkOrderedAuth(uid = 'u1') {
    /** @type {{ uid: string }|null} */ let user = { uid };
    /** @type {Set<(u: any) => void>} */ const listeners = new Set();
    const notify = () => { for (const l of listeners) Promise.resolve().then(() => l(user)); };
    return {
        get user() { return user; },
        watch: (/** @type {(u: any) => void} */ cb) => {
            listeners.add(cb);
            Promise.resolve().then(() => cb(user));
            return () => { listeners.delete(cb); };
        },
        /** The account goes now: another tab signed out, or a refresh was refused. */
        signOut: () => { user = null; notify(); },
        /** Another account signs in on this browser. @param {string} other */
        switchTo: (other) => { user = { uid: other }; notify(); },
        get listening() { return listeners.size; },
    };
}
const refusal = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
const hangs = () => new Promise(() => {});

describe('runWatchedClaimRetry — a sign-out ends the wait only for a write on its way', () => {
    it('THE REFUSED REFRESH: a write the rules refused stays refused, and the next write is not blocked', async () => {
        // Refusal and revocation at once: the write is refused (nothing written), the forced refresh is
        // refused because the account was disabled, and the SDK signs it out before re-throwing. The
        // reader is told to sign in again, which is true, and no later write on the page is refused
        // for a write whose outcome was never in doubt.
        _resetUnconfirmedWrites();
        const auth = sdkOrderedAuth();
        let commits = 0;
        const original = refusal();
        const fn = async () => { commits++; throw original; };
        const refresh = async () => {
            auth.signOut();
            await Promise.resolve();
            throw Object.assign(new Error('token refused'), { code: 'auth/user-disabled' });
        };
        const err = await runGatedWrite(() => runWatchedClaimRetry(fn, {
            retryCode: 'permission-denied', hasUser: () => !!auth.user, refresh, uid: auth.user?.uid, watch: auth.watch,
        })).then(() => null, e => e);
        assert.equal(err, original, `the caller must get the server's refusal, as itself — it got ${err?.code}`);
        assert.equal(commits, 1, 'the refresh was refused, so the write was never retried');
        assert.equal(hasUnconfirmedWrite(), false, 'a refused write is not one of unknown outcome');
        assert.match(saveFailureMessage(err), /sign in again/);
        assert.doesNotMatch(saveFailureMessage(err), /confirmed/);
        let ran = false;
        await runGatedWrite(async () => { ran = true; });
        assert.equal(ran, true, 'the next write on the page is let through');
        assert.equal(auth.listening, 0, 'no watch is left behind');
        _resetUnconfirmedWrites();
    });

    it('a sign-out while the write is ON ITS WAY still ends the wait as unconfirmed (v24.36)', async () => {
        _resetUnconfirmedWrites();
        const auth = sdkOrderedAuth();
        const p = runGatedWrite(() => runWatchedClaimRetry(hangs, {
            retryCode: 'permission-denied', hasUser: () => !!auth.user, refresh: async () => {}, uid: auth.user?.uid, watch: auth.watch,
        }));
        await new Promise(r => setTimeout(r, 0));   // the watch reports the current account first
        auth.signOut();
        await assert.rejects(p, e => /** @type {any} */ (e).code === SIGNED_OUT_CODE);
        assert.equal(hasUnconfirmedWrite(), true, 'Firestore may still send it, so the gate closes');
        _resetUnconfirmedWrites();
    });

    it('the RETRY is watched too: a sign-out while it is on its way is unconfirmed', async () => {
        _resetUnconfirmedWrites();
        const auth = sdkOrderedAuth();
        let calls = 0;
        /** @type {(v?: any) => void} */ let retrying = () => {};
        const retryStarted = new Promise(r => { retrying = r; });
        const fn = () => { calls++; if (calls === 1) return Promise.reject(refusal()); retrying(); return hangs(); };
        const p = runGatedWrite(() => runWatchedClaimRetry(fn, {
            retryCode: 'permission-denied', hasUser: () => !!auth.user, refresh: async () => 'fresh-token', uid: auth.user?.uid, watch: auth.watch,
        }));
        await retryStarted;
        await new Promise(r => setTimeout(r, 0));
        auth.signOut();
        await assert.rejects(p, e => /** @type {any} */ (e).code === SIGNED_OUT_CODE);
        assert.equal(calls, 2);
        assert.equal(hasUnconfirmedWrite(), true);
        _resetUnconfirmedWrites();
    });

    it('ANOTHER ACCOUNT signed in during the refresh: no retry goes out as it, and the refusal stands (17 Nov 2026)', async () => {
        // A shared PC: somebody else signs in on another tab while the token is refreshed. Until 17 Nov
        // the retry went out AS them — a write nobody on that account asked for — and was then reported
        // "not confirmed", shutting the page's writes. The first attempt was refused: nothing written.
        _resetUnconfirmedWrites();
        const auth = sdkOrderedAuth('u1');
        let calls = 0;
        const original = refusal();
        const fn = () => (++calls === 1 ? Promise.reject(original) : hangs());
        const err = await runGatedWrite(() => runWatchedClaimRetry(fn, {
            retryCode: 'permission-denied', hasUser: () => !!auth.user,
            refresh: async () => { auth.switchTo('u2'); await Promise.resolve(); },
            uid: auth.user?.uid, currentUid: () => auth.user?.uid, watch: auth.watch,
        })).then(() => null, e => e);
        assert.equal(calls, 1, 'the retry was sent as the account that signed in during the refresh');
        assert.equal(err, original, `the caller must get the first attempt's refusal, as itself — it got ${err?.code}`);
        assert.equal(hasUnconfirmedWrite(), false, 'a refused write, never retried, is not one of unknown outcome');
        assert.match(saveFailureMessage(err), /sign in again/);
        await new Promise(r => setTimeout(r, 0));
        assert.equal(auth.listening, 0, 'no watch is left behind');
        _resetUnconfirmedWrites();
    });

    it('an account that changed and came BACK during the refresh is the same account: the retry goes out', async () => {
        const auth = sdkOrderedAuth('u1');
        let calls = 0;
        const out = await runWatchedClaimRetry(() => (++calls === 1 ? Promise.reject(refusal()) : Promise.resolve('saved')), {
            retryCode: 'permission-denied', hasUser: () => !!auth.user,
            refresh: async () => { auth.switchTo('u2'); auth.switchTo('u1'); await Promise.resolve(); },
            uid: auth.user?.uid, currentUid: () => auth.user?.uid, watch: auth.watch,
        });
        assert.equal(out, 'saved');
        assert.equal(calls, 2);
    });

    it('a call that STARTED with no account is not retried as one that signed in since', async () => {
        // hasUser() is true by the time the refusal comes back, so the retry is attempted — but the
        // page asked with nobody signed in, and the account now present is not its to write as.
        let user = /** @type {{ uid: string }|null} */ (null);
        let calls = 0;
        const original = refusal();
        const err = await runWithClaimRetry(async () => { calls++; if (calls === 1) { user = { uid: 'u9' }; throw original; } return 'saved'; }, {
            retryCode: 'permission-denied', hasUser: () => !!user, refresh: async () => {},
            uid: null, currentUid: () => user?.uid,
        }).then(() => null, e => e);
        assert.equal(err, original);
        assert.equal(calls, 1);
    });

    it('a refusal that survives the refresh is passed on as the refusal, and no watch is left', async () => {
        const auth = sdkOrderedAuth();
        let calls = 0;
        await assert.rejects(runWatchedClaimRetry(async () => { calls++; throw refusal(); }, {
            retryCode: 'permission-denied', hasUser: () => !!auth.user, refresh: async () => {}, uid: auth.user?.uid, watch: auth.watch,
        }), e => /** @type {any} */ (e).code === 'permission-denied');
        assert.equal(calls, 2);
        await new Promise(r => setTimeout(r, 0));
        assert.equal(auth.listening, 0);
    });

    it('no account at the start: nothing is watched, and the result passes through', async () => {
        let subscribed = 0;
        const out = await runWatchedClaimRetry(async () => 'ok', {
            retryCode: 'permission-denied', hasUser: () => false, refresh: async () => {}, uid: null,
            watch: () => { subscribed++; return () => {}; },
        });
        assert.equal(out, 'ok');
        assert.equal(subscribed, 0);
    });
});

test('saveFailureMessage — signed-out says unconfirmed, never lost; the other two unchanged', () => {
    const out = saveFailureMessage({ code: SIGNED_OUT_CODE });
    assert.match(out, /signed out/);
    assert.match(out, /Saved Changes/);
    assert.doesNotMatch(out, /lost|not saved/i);
    assert.match(saveFailureMessage({ code: 'permission-denied' }), /sign in again/);
    assert.match(saveFailureMessage({ code: 'unavailable' }), /check your connection/);
    assert.match(saveFailureMessage(undefined), /check your connection/);
});

test('saveFailureMessage — a write whose outcome is unknown says so, and never invites a retry', () => {
    // No test passed this code, so its line could be deleted green — and then it fell through to
    // "check your connection and try again", when a retry of a write that may have landed writes a
    // second copy (AUTH_AND_SESSIONS 22). The page refuses new writes until reload; the words must say that.
    const out = saveFailureMessage({ code: UNCONFIRMED_CODE });
    assert.equal(out, UNCONFIRMED_LINE);
    assert.doesNotMatch(out, /try again/i);
});

const PD = 'permission-denied';

test('isClaimRetryable — only the matching code WITH a user', () => {
    assert.equal(isClaimRetryable({ code: PD }, PD, true), true);
    assert.equal(isClaimRetryable({ code: PD }, PD, false), false, 'no user → not retryable');
    assert.equal(isClaimRetryable({ code: 'unavailable' }, PD, true), false, 'wrong code');
    assert.equal(isClaimRetryable(null, PD, true), false, 'no error');
    assert.equal(isClaimRetryable({ code: 'storage/unauthorized' }, 'storage/unauthorized', true), true);
});

test('success on first try — no refresh, no retry, value passes through', async () => {
    let calls = 0, refreshed = 0;
    const out = await runWithClaimRetry(() => { calls++; return Promise.resolve('ok'); }, {
        retryCode: PD, hasUser: () => true, refresh: async () => { refreshed++; },
    });
    assert.equal(out, 'ok');
    assert.equal(calls, 1);
    assert.equal(refreshed, 0);
});

test('permission-denied with a user → refresh once then retry succeeds', async () => {
    let calls = 0, refreshed = 0;
    const out = await runWithClaimRetry(() => {
        calls++;
        if (calls === 1) return Promise.reject({ code: PD });
        return Promise.resolve('healed');
    }, { retryCode: PD, hasUser: () => true, refresh: async () => { refreshed++; } });
    assert.equal(out, 'healed');
    assert.equal(calls, 2, 'ran twice (original + one retry)');
    assert.equal(refreshed, 1, 'refreshed exactly once');
});

test('at most ONE retry — a second permission-denied surfaces to the caller', async () => {
    let calls = 0;
    await assert.rejects(
        runWithClaimRetry(() => { calls++; return Promise.reject({ code: PD }); }, {
            retryCode: PD, hasUser: () => true, refresh: async () => {},
        }),
        (e) => /** @type {any} */ (e).code === PD,
    );
    assert.equal(calls, 2, 'original + one retry, then gives up');
});

test('no user → not retried, original error re-thrown, no refresh', async () => {
    let calls = 0, refreshed = 0;
    await assert.rejects(
        runWithClaimRetry(() => { calls++; return Promise.reject({ code: PD }); }, {
            retryCode: PD, hasUser: () => false, refresh: async () => { refreshed++; },
        }),
        (e) => /** @type {any} */ (e).code === PD,
    );
    assert.equal(calls, 1);
    assert.equal(refreshed, 0);
});

test('non-retryable error re-throws immediately (offline etc.)', async () => {
    let calls = 0, refreshed = 0;
    await assert.rejects(
        runWithClaimRetry(() => { calls++; return Promise.reject({ code: 'unavailable' }); }, {
            retryCode: PD, hasUser: () => true, refresh: async () => { refreshed++; },
        }),
        (e) => /** @type {any} */ (e).code === 'unavailable',
    );
    assert.equal(calls, 1);
    assert.equal(refreshed, 0);
});

test('a FAILED refresh preserves the ORIGINAL permission-denied (never masked by the refresh error)', async () => {
    // The security-critical invariant: a genuine auth denial must not be reported to staff as a
    // connectivity problem just because the token refresh happened to fail.
    let calls = 0;
    await assert.rejects(
        runWithClaimRetry(() => { calls++; return Promise.reject({ code: PD, marker: 'ORIGINAL' }); }, {
            retryCode: PD, hasUser: () => true,
            refresh: async () => { throw { code: 'network-request-failed' }; },
        }),
        (e) => /** @type {any} */ (e).code === PD && /** @type {any} */ (e).marker === 'ORIGINAL',
    );
    assert.equal(calls, 1, 'fn not retried when the refresh itself failed');
});

test('storage/unauthorized path uses the same runner with its own code', async () => {
    let calls = 0;
    const out = await runWithClaimRetry(() => {
        calls++;
        if (calls === 1) return Promise.reject({ code: 'storage/unauthorized' });
        return Promise.resolve('uploaded');
    }, { retryCode: 'storage/unauthorized', hasUser: () => true, refresh: async () => {} });
    assert.equal(out, 'uploaded');
    assert.equal(calls, 2);
});

// ── isAccessFailure ─────────────────────────────────────────────────────────────────────────────
//
// ORGANISED BY WHAT A WRONG ANSWER COSTS, and the two directions are not the same size.
//
// SAYING "NETWORK" TO A REFUSED READER is the expensive one, and it is what shipped: from v23.18,
// when the document collections began requiring a claim, the nav drawer told a member on five pages
// to check a signal that was fine. That is the loop `calendar-access.js` describes — the member
// retries, the retry fails identically, and the app looks broken. Nothing errors and nothing in the
// UI is out of place; the sentence is simply about the wrong thing.
//
// SAYING "SIGN IN AGAIN" TO SOMEBODY OFFLINE is cheaper but not free: it sends a member to re-enter
// a password over a connection that cannot carry the sign-in either, and it teaches them that the
// message is noise. So the classifier must be NARROW — an access refusal is a specific, recognisable
// answer, and everything else keeps the retry.
describe('isAccessFailure', () => {
    describe('a refusal must be recognised — the direction that shipped wrong', () => {
        it('recognises Firestore\'s own permission-denied code', () => {
            assert.equal(isAccessFailure({ code: 'permission-denied' }), true);
        });
        it('recognises the Calendar gate\'s local sentinel, which never reaches Firestore', () => {
            assert.equal(isAccessFailure({ code: 'calendar-access-required' }), true);
        });
        it('recognises a rejection carrying the code in its MESSAGE, not as a code', () => {
            // Not every rejection that reaches a caller is a FirebaseError — a wrapper may have
            // re-thrown, and `fetch-timeout.js` already documents that shape for the endpoints.
            assert.equal(isAccessFailure(new Error('permission-denied')), true);
        });
        it('recognises a denial wrapped in a longer sentence', () => {
            assert.equal(isAccessFailure({ code: 'firestore/permission-denied (read)' }), true);
        });
    });

    describe('a network fault must NOT be dressed as a refusal', () => {
        it('an offline rejection is not an access failure', () => {
            assert.equal(isAccessFailure({ code: 'unavailable' }), false);
        });
        it('the drawer\'s own 8s document timeout is not an access failure', () => {
            // The literal the nav drawer rejects with — pinned here because that timeout and a
            // refusal arrive at the SAME catch, and only one of them may blame the session.
            assert.equal(isAccessFailure(new Error('doc-fetch-timeout')), false);
        });
        it('a deadline-exceeded is not an access failure', () => {
            assert.equal(isAccessFailure({ code: 'deadline-exceeded' }), false);
        });
        it('an unauthenticated code is NOT matched — it is a different answer with different words', () => {
            assert.equal(isAccessFailure({ code: 'unauthenticated' }), false);
        });
    });

    describe('nothing at all is not a refusal', () => {
        for (const empty of [null, undefined, {}, '', 0]) {
            it(`${JSON.stringify(empty)} is not an access failure`, () => {
                assert.equal(isAccessFailure(empty), false);
            });
        }
    });
});

// ── runGatedWrite (v24.39, external review) — an unconfirmed write stops the next ──────────────────
describe('runGatedWrite', () => {
    it('passes results and ordinary errors through, and leaves the gate open', async () => {
        _resetUnconfirmedWrites();
        assert.equal(await runGatedWrite(async () => 'ok'), 'ok');
        await assert.rejects(runGatedWrite(async () => { throw Object.assign(new Error('x'), { code: 'unavailable' }); }));
        assert.equal(hasUnconfirmedWrite(), false, 'a plain failure is not unconfirmed');
    });
    it('a write ended by a sign-out closes the gate; the next is refused BEFORE it runs', async () => {
        _resetUnconfirmedWrites();
        await assert.rejects(runGatedWrite(async () => { throw Object.assign(new Error('gone'), { code: SIGNED_OUT_CODE }); }),
            e => /** @type {any} */ (e).code === SIGNED_OUT_CODE);
        assert.equal(hasUnconfirmedWrite(), true);
        let ran = false;
        await assert.rejects(runGatedWrite(async () => { ran = true; }), e => /** @type {any} */ (e).code === UNCONFIRMED_CODE);
        assert.equal(ran, false, 'a refused write never reaches Firestore — that is the duplicate prevented');
        _resetUnconfirmedWrites();
    });
    it('unconfirmedWriteLine names both codes and leaves others to the caller', () => {
        assert.match(unconfirmedWriteLine({ code: SIGNED_OUT_CODE }, 'this delete', 'Saved Changes') ?? '', /signed out/);
        assert.match(unconfirmedWriteLine({ code: UNCONFIRMED_CODE }, 'x', 'y') ?? '', /Reload the page/);
        assert.equal(unconfirmedWriteLine({ code: 'unavailable' }, 'x', 'y'), null);
    });
});

test('WIRING: every write, the document commit and the push record are bounded by the account', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./firebase-client.js', REPO_ROOT_URL), 'utf8');
    assert.match(src, /export function writeWithClaimRetry\(fn\) \{ return runGatedWrite\(\(\) => withClaimRetry\(fn\)\); \}/);
    // The ACCOUNT each watch is bounded by, not only that a watch exists (test audit, 7 Nov 2026): with
    // the uid set to null, abandonOnSignOut has nobody to watch for, and both survived every lane.
    assert.match(src, /guardCommit: \(\/\*\* @type \{Promise<any>\} \*\/ p\) => abandonOnSignOut\(p, \{ uid: auth\.currentUser\?\.uid, watch: cb => onAuthStateChanged\(auth, cb\) \}\)/);
    assert.match(src, /await abandonOnSignOut\(setDoc\(doc\(db, COLLECTIONS\.pushSubscriptions, id\), data\), \{ uid: owner, watch: cb => onAuthStateChanged\(auth, cb\) \}\)/);
    assert.match(src, /const owner = auth\.currentUser\?\.uid;/, 'the push record is bounded by the uid it is stamped with');
});

// ── ownWritesSent — a checked write waits for this device's own queue first (v25.95) ───────────────
// The wiring (that firebase-client.js asks about its own Firestore) is firebase-client.test.mjs; the
// use (no transaction before the answer, and what each answer does) is admin-override-store.test.mjs
// block 8 and admin-roster-upload.test.mjs. What is pinned here is the rule's three answers.
describe('ownWritesSent — how long a checked write waits for this device\'s queued saves', () => {
    it('true as soon as the queue has drained', async () => {
        assert.equal(await ownWritesSent(async () => {}, 1_000), true);
    });
    it('false when it has not drained in time — never a wait without end, which offline would be', async () => {
        const started = Date.now();
        assert.equal(await ownWritesSent(() => new Promise(() => {}), 30), false);
        assert.ok(Date.now() - started < 1_000);
    });
    it('a wait the SDK abandons (the account changed) is passed on, not read as "sent"', async () => {
        const cancelled = Object.assign(new Error('user changed'), { code: 'cancelled' });
        await assert.rejects(ownWritesSent(() => Promise.reject(cancelled), 1_000), (/** @type {any} */ e) => e.code === 'cancelled');
    });
    it('waits long enough for a queue to drain on a returning signal, and not so long a person gives up', () => {
        // Firestore spends about eight seconds on a transaction that cannot reach the server before it
        // gives up; the wait matches it, so a save is never refused sooner than it would have been.
        assert.ok(OWN_WRITES_WAIT_MS >= 5_000 && OWN_WRITES_WAIT_MS <= 10_000, `OWN_WRITES_WAIT_MS is ${OWN_WRITES_WAIT_MS}`);
    });
});

// ── …and says how each wait went, for the slow-save diagnostic (22 Nov 2026) ───────────────────────
// Three reports from one installed iPhone app took exactly 8.1s each; eight seconds is this limit. The
// summary for a save is slow-save.test.mjs (trackOwnWritesWaits); the line, error-reporter-wiring.test.mjs.
describe('ownWritesSent — tells how the wait ended, and never changes the answer by telling', () => {
    /** A clock the test moves, so a reported length is exact. */
    const clock = (/** @type {number[]} */ ...readings) => { let i = 0; return () => readings[Math.min(i++, readings.length - 1)]; };

    it('drained: the outcome and how long the wait took', async () => {
        /** @type {any[]} */ const told = [];
        assert.equal(await ownWritesSent(async () => {}, 1_000, { onSettled: w => told.push(w), now: clock(5_000, 5_120) }), true);
        assert.deepEqual(told, [{ ms: 120, outcome: 'drained' }]);
    });
    it('ran out: the limit fired first', async () => {
        /** @type {any[]} */ const told = [];
        assert.equal(await ownWritesSent(() => new Promise(() => {}), 20, { onSettled: w => told.push(w), now: clock(0, 8_003) }), false);
        assert.deepEqual(told, [{ ms: 8_003, outcome: 'ran out' }]);
    });
    it('failed: the SDK abandoned the wait — told, and the rejection still passed on', async () => {
        /** @type {any[]} */ const told = [];
        const cancelled = Object.assign(new Error('user changed'), { code: 'cancelled' });
        await assert.rejects(ownWritesSent(() => Promise.reject(cancelled), 1_000, { onSettled: w => told.push(w), now: clock(10, 15) }),
            (/** @type {any} */ e) => e === cancelled);
        assert.deepEqual(told, [{ ms: 5, outcome: 'failed' }]);
    });
    it('told before the caller sees the answer, so a save\'s span always contains its own wait', async () => {
        /** @type {string[]} */ const order = [];
        await ownWritesSent(async () => {}, 1_000, { onSettled: () => order.push('told') }).then(() => order.push('answered'));
        assert.deepEqual(order, ['told', 'answered']);
    });
    it('a listener that throws changes nothing — the diagnostic never disturbs the save', async () => {
        const boom = () => { throw new Error('listener broke'); };
        assert.equal(await ownWritesSent(async () => {}, 1_000, { onSettled: boom }), true);
        assert.equal(await ownWritesSent(() => new Promise(() => {}), 10, { onSettled: boom }), false);
        const cancelled = Object.assign(new Error('user changed'), { code: 'cancelled' });
        await assert.rejects(ownWritesSent(() => Promise.reject(cancelled), 1_000, { onSettled: boom }), (/** @type {any} */ e) => e === cancelled);
    });
    it('a clock set back mid-wait reports 0, never a negative wait', async () => {
        /** @type {any[]} */ const told = [];
        await ownWritesSent(async () => {}, 1_000, { onSettled: w => told.push(w), now: clock(9_000, 4_000) });
        assert.deepEqual(told, [{ ms: 0, outcome: 'drained' }]);
    });
    it('by default every watcher hears it, until it unsubscribes — and one that throws silences no other', async () => {
        /** @type {any[]} */ const heard = [];
        const stopBroken = watchOwnWritesWaits(() => { throw new Error('a broken listener'); });
        const stop = watchOwnWritesWaits(w => heard.push(w.outcome));
        try {
            assert.equal(await ownWritesSent(async () => {}, 1_000), true);
            assert.equal(await ownWritesSent(() => new Promise(() => {}), 10), false);
            assert.deepEqual(heard, ['drained', 'ran out']);
        } finally { stop(); stopBroken(); }
        await ownWritesSent(async () => {}, 1_000);
        assert.deepEqual(heard, ['drained', 'ran out'], 'an unsubscribed watcher hears nothing more');
    });
});

// ── WHEN THE WAIT RUNS OUT, ASK THE RECORDS (24 Nov 2026) ───────────────────────────────────────────
// A phone whose queue holds ANOTHER account's leftover write ran out every checked save's wait (the SDK's
// whole-queue wait cannot see past it), so a removal was refused as offline, online. The fallback asks
// only the records the save touches, and only a 'clear' from every one lets the transaction through.
describe('recordsClearOfOwnWrites — is any record this save touches still on its way from this account?', () => {
    const read = (/** @type {Record<string, any>} */ answers) => async (/** @type {any} */ ref) => {
        const a = answers[ref.id];
        if (a instanceof Error) throw a;
        return { metadata: { hasPendingWrites: a === 'queued' } };
    };
    const notCached = Object.assign(new Error('Failed to get document from cache'), { code: 'unavailable' });
    test('none queued → clear', async () => {
        assert.equal(await recordsClearOfOwnWrites(read({ a: 'sent', b: 'sent' }), [{ id: 'a' }, { id: 'b' }]), 'clear');
    });
    test('one queued among them → queued, whatever the others say', async () => {
        assert.equal(await recordsClearOfOwnWrites(read({ a: 'sent', b: 'queued' }), [{ id: 'a' }, { id: 'b' }]), 'queued');
    });
    test('a record the cache never held cannot have a queued write of ours → clear', async () => {
        assert.equal(await recordsClearOfOwnWrites(read({ a: notCached }), [{ id: 'a' }]), 'clear');
    });
    test('any other failure → unknown, which never lets a transaction through', async () => {
        const broken = Object.assign(new Error('IndexedDB went away'), { code: 'internal' });
        assert.equal(await recordsClearOfOwnWrites(read({ a: 'sent', b: broken }), [{ id: 'a' }, { id: 'b' }]), 'unknown');
        assert.equal(await recordsClearOfOwnWrites(read({ a: 'queued', b: broken }), [{ id: 'a' }, { id: 'b' }]), 'queued',
            'a record known to be queued outranks one that could not be read');
    });
    test('a reader that throws before it reads anything → unknown', async () => {
        assert.equal(await recordsClearOfOwnWrites(() => { throw new Error('sync'); }, [{ id: 'a' }]), 'unknown');
    });
});

// ── ONLINE, THE RECORDS ARE ASKED FIRST — ON EVERY PHONE (27 Nov 2026) ───────────────────────────
// What a checked save needs is that none of ITS records still has this account's write on its way. The
// records answer that directly, so online they are asked first and the SDK's whole-queue wait — which
// another account's leftover holds up for good — is only for a record that IS still queued, or one the
// cache cannot answer. Offline the wait comes first, as it always did: a save held as a batch must join
// the queue behind what is there. These replaced the per-phone leftover NOTE (25 Nov 2026), which made
// every affected phone spend eight seconds on its first checked save, and again once a week.
describe('ownWritesSentFor — online: the records first, and the wait only for a record still on its way', () => {
    const neverDrains = () => new Promise(() => {});
    const clearReads = async () => ({ metadata: { hasPendingWrites: false } });
    const queuedReads = async () => ({ metadata: { hasPendingWrites: true } });
    const brokenReads = async () => { throw Object.assign(new Error('x'), { code: 'internal' }); };
    const online = () => true;
    test('records clear → true at once: the SDK wait is never started, told "skipped, its records clear"', async () => {
        let waited = 0;
        /** @type {any[]} */ const told = [];
        const ok = await ownWritesSentFor(() => { waited++; return neverDrains(); }, clearReads, [{ id: 'a' }, { id: 'b' }], 60_000,
            { onSettled: (/** @type {any} */ w) => told.push(w.outcome), online });
        assert.equal(ok, true);
        assert.equal(waited, 0, 'a phone holding another account\'s leftover would sit here for the whole wait');
        assert.deepEqual(told, ['skipped, its records clear']);
    });
    test('online is the DEFAULT — a caller that says nothing gets records-first', async () => {
        let waited = 0;
        assert.equal(await ownWritesSentFor(() => { waited++; return neverDrains(); }, clearReads, [{ id: 'a' }], 60_000, { onSettled: () => {} }), true);
        assert.equal(waited, 0);
    });
    test('a record of ours still queued → it WAITS; the queue drains → true, told "drained"', async () => {
        let waited = 0;
        /** @type {any[]} */ const told = [];
        const ok = await ownWritesSentFor(async () => { waited++; }, queuedReads, [{ id: 'a' }], 1_000,
            { onSettled: (/** @type {any} */ w) => told.push(w.outcome), online });
        assert.equal(ok, true);
        assert.equal(waited, 1);
        assert.deepEqual(told, ['drained']);
    });
    test('a record of ours still queued, and the wait runs out → false: held or refused, writing nothing', async () => {
        /** @type {any[]} */ const told = [];
        assert.equal(await ownWritesSentFor(neverDrains, queuedReads, [{ id: 'a' }], 10,
            { onSettled: (/** @type {any} */ w) => told.push(w.outcome), online }), false);
        assert.deepEqual(told, ['ran out, a record still queued']);
    });
    test('one record queued among several is enough to wait', async () => {
        let waited = 0;
        const reads = async (/** @type {any} */ ref) => ({ metadata: { hasPendingWrites: ref.id === 'b' } });
        await ownWritesSentFor(() => { waited++; return neverDrains(); }, reads, [{ id: 'a' }, { id: 'b' }], 10, { onSettled: () => {}, online });
        assert.equal(waited, 1);
    });
    test('a record the cache cannot answer → it waits, and a wait that runs out is false', async () => {
        let waited = 0;
        assert.equal(await ownWritesSentFor(() => { waited++; return neverDrains(); }, brokenReads, [{ id: 'a' }], 10, { onSettled: () => {}, online }), false);
        assert.equal(waited, 1, 'a check the device cannot answer never lets a transaction through unwaited');
    });
    test('the records were queued, the wait ran out, and they are clear by then → true', async () => {
        let asked = 0;
        const reads = async () => ({ metadata: { hasPendingWrites: ++asked === 1 } });
        assert.equal(await ownWritesSentFor(neverDrains, reads, [{ id: 'a' }], 10, { onSettled: () => {}, online }), true);
        assert.equal(asked, 2, 'asked first, and again once the wait had run out');
    });
    test('an online that throws reads as online — the same as navigator.onLine being unknown', async () => {
        let waited = 0;
        await ownWritesSentFor(() => { waited++; return neverDrains(); }, clearReads, [{ id: 'a' }], 10,
            { onSettled: () => {}, online: () => { throw new Error('x'); } });
        assert.equal(waited, 0);
    });
});

describe('ownWritesSentFor — offline: the wait first, as before', () => {
    const neverDrains = () => new Promise(() => {});
    const clearReads = async () => ({ metadata: { hasPendingWrites: false } });
    const offline = () => false;
    test('a queue that drains: true, and no record is read', async () => {
        let reads = 0;
        assert.equal(await ownWritesSentFor(async () => {}, async () => { reads++; return {}; }, [{ id: 'a' }], 1_000, { onSettled: () => {}, online: offline }), true);
        assert.equal(reads, 0);
    });
    test('records clear but OFFLINE → it still waits: an offline save is held behind the queue, never sent ahead of it', async () => {
        let waited = 0;
        await ownWritesSentFor(() => { waited++; return neverDrains(); }, clearReads, [{ id: 'a' }], 10, { onSettled: () => {}, online: offline });
        assert.equal(waited, 1);
    });
    test('runs out, its records clear → true: the save goes on to ask the server', async () => {
        assert.equal(await ownWritesSentFor(neverDrains, clearReads, [{ id: 'a' }], 10, { onSettled: () => {}, online: offline }), true);
    });
    test('runs out, a record still queued → false', async () => {
        const reads = async (/** @type {any} */ ref) => ({ metadata: { hasPendingWrites: ref.id === 'b' } });
        assert.equal(await ownWritesSentFor(neverDrains, reads, [{ id: 'a' }, { id: 'b' }], 10, { onSettled: () => {}, online: offline }), false);
    });
    test('runs out, a record unreadable → false', async () => {
        const reads = async () => { throw Object.assign(new Error('x'), { code: 'internal' }); };
        assert.equal(await ownWritesSentFor(neverDrains, reads, [{ id: 'a' }], 10, { onSettled: () => {}, online: offline }), false);
    });
    test('the wait is told ONCE, with what the records said — the slow-save line\'s words', async () => {
        /** @type {any[]} */ const told = [];
        const opts = { onSettled: (/** @type {any} */ w) => told.push(w.outcome), online: offline };
        await ownWritesSentFor(async () => {}, clearReads, [{ id: 'a' }], 1_000, opts);
        await ownWritesSentFor(neverDrains, clearReads, [{ id: 'a' }], 10, opts);
        await ownWritesSentFor(neverDrains, async () => ({ metadata: { hasPendingWrites: true } }), [{ id: 'a' }], 10, opts);
        await ownWritesSentFor(neverDrains, async () => { throw new Error('x'); }, [{ id: 'a' }], 10, opts);
        assert.deepEqual(told, ['drained', 'ran out, its records clear', 'ran out, a record still queued', 'ran out, records unreadable']);
    });
});

describe('ownWritesSentFor — what it tells, and an abandoned wait', () => {
    const neverDrains = () => new Promise(() => {});
    test('a wait the SDK abandons (the account changed) is passed on and told as failed', async () => {
        const cancelled = Object.assign(new Error('cancelled'), { code: 'cancelled' });
        /** @type {any[]} */ const told = [];
        await assert.rejects(ownWritesSentFor(() => Promise.reject(cancelled), async () => ({ metadata: { hasPendingWrites: true } }), [{ id: 'a' }], 1_000,
            { onSettled: (/** @type {any} */ w) => told.push(w.outcome) }), (/** @type {any} */ e) => e === cancelled);
        assert.deepEqual(told, ['failed']);
    });
    test('by default every watcher hears it, once', async () => {
        /** @type {any[]} */ const heard = [];
        const stop = watchOwnWritesWaits((w) => heard.push(w.outcome));
        try {
            await ownWritesSentFor(neverDrains, async () => ({ metadata: { hasPendingWrites: false } }), [{ id: 'a' }], 10);
            await ownWritesSentFor(neverDrains, async () => ({ metadata: { hasPendingWrites: true } }), [{ id: 'a' }], 10);
        } finally { stop(); }
        assert.deepEqual(heard, ['skipped, its records clear', 'ran out, a record still queued']);
    });
    test('a watcher that throws never disturbs the save', async () => {
        assert.equal(await ownWritesSentFor(neverDrains, async () => ({ metadata: { hasPendingWrites: false } }), [{ id: 'a' }], 10,
            { onSettled: () => { throw new Error('x'); } }), true);
    });
});
