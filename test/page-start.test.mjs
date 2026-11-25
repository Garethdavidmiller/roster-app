// @ts-check
// @lane unit
/**
 * page-start.test.mjs — the one start-up every card-opening page goes through (page-start.js).
 * Run with: node --test --experimental-test-module-mocks test/page-start.test.mjs
 *
 * The skeleton's real `startPage` is driven against recording stand-ins for everything it touches —
 * the Back guard, the policy, the card, the session, the reporters — and the assertions are on the
 * ORDER of what happened, because order is the substance: a page run before the Back guard, a page run
 * for a login it is not for, or a page run for nobody are each a defect this module exists to end.
 * page-contract-parity.test.mjs proves each coordinator starts through it; this proves what it does.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

/** Everything the skeleton did, in order. @type {string[]} */
let log = [];
/** @type {{ name: string }|null} */ let session = null;
/** What the policy answers, by member (null = signed out). @type {(member: string|null) => string} */
let policy = (m) => (m ? 'allow' : 'login');
/** The card as last opened. @type {any} */ let card = null;
/** `sessionReady`'s waiting callbacks, fired by `ready()`. @type {Function[]} */ let readyCbs = [];
const sessionReady = { then(/** @type {Function} */ cb) { readyCbs.push(cb); return this; } };
const ready = () => { const cbs = readyCbs; readyCbs = []; cbs.forEach(cb => cb(true)); };

mock.module('../session.js', { namedExports: {
    getSession: () => session,
    ensureNamedSession: (/** @type {string} */ n) => { log.push(`ensure:${n}`); return Promise.resolve(true); },
    resolveSession: (/** @type {any} */ v) => log.push(v === false ? 'resolve:false' : 'resolve'),
    sessionReady,
} });
mock.module('../page-session.js', { namedExports: {
    reloadIfRestoredForSomeoneElse: () => log.push('backGuard'),
    rebaseRestoreGuard: () => log.push('rebase'),
    guardNamedSession: (/** @type {any} */ o) => log.push(`guard:${o.page}:${o.member}${o.about ? ':about' : ''}${o.beforeSignIn ? ':before' : ''}`),
} });
mock.module('../auth-policy.js', { namedExports: {
    requirePage: (/** @type {any} */ snap, /** @type {string} */ page) => {
        log.push(`decide:${page}:${snap.status}:${snap.member}`);
        return { decision: policy(snap.member), reason: 'test' };
    },
} });
mock.module('../login-overlay.js', { namedExports: {
    initLoginOverlay: (/** @type {any} */ o) => { card = o; log.push(`card:${o.pageLabel}`); },
    dismissLoginOverlay: () => log.push('dismiss'),
} });
mock.module('../password-force.js', { namedExports: { initPasswordForce: (/** @type {string} */ n) => { log.push(`pwForce:${n}`); return Promise.resolve(false); } } });
mock.module('../error-reporter.js', { namedExports: { initErrorReporter: () => log.push('errorReporter') } });
mock.module('../usage-reporter.js', { namedExports: { recordUsage: (/** @type {string} */ p, /** @type {string} */ n) => log.push(`usage:${p}:${n}`) } });
mock.module('../perf-reporter.js', { namedExports: { recordPageLatency: (/** @type {string} */ p, /** @type {string} */ n) => log.push(`latency:${p}:${n}`) } });

global.window = /** @type {any} */ ({ location: { reload: () => log.push('reload') } });

const { startPage } = await import('../page-start.js');

/** A card-opening page with recording parts, as a coordinator writes one. @param {Record<string, any>} [over] */
const spec = (over = {}) => ({
    page: 'admin', label: 'Admin',
    run: (/** @type {string} */ m, /** @type {any} */ ctx) => log.push(`run:${m}${ctx.inPlace ? ':inPlace' : ''}`),
    refuse: (/** @type {any} */ d, /** @type {any} */ ctx) => log.push(`refuse:${d.decision}:${ctx.member}${ctx.inPlace ? ':inPlace' : ''}`),
    ...over,
});
/** Sign in on the card that is up: the card has saved the session, then calls its onSuccess. @param {string|null} name */
const signInAs = (name) => { session = name ? { name } : null; log = []; card.onSuccess(name); };

beforeEach(() => { log = []; session = null; card = null; readyCbs = []; policy = (m) => (m ? 'allow' : 'login'); });

describe('startPage — at load', () => {
    test('allowed: the Back guard FIRST, then the decision, the session step, and only then the page', () => {
        session = { name: 'A. Member' };
        startPage(spec());
        assert.deepEqual(log, ['backGuard', 'decide:admin:named:A. Member', 'dismiss',
            'ensure:A. Member', 'resolve', 'guard:admin:A. Member', 'pwForce:A. Member', 'run:A. Member']);
        log = []; ready();
        assert.deepEqual(log, ['errorReporter', 'usage:admin:A. Member', 'latency:admin:A. Member'],
            'the reporter and the counts wait for the session — never bare (AUTH_AND_SESSIONS 13)');
    });

    test('signed out: the card, and nothing of the page or the session', () => {
        startPage(spec({ about: { lines: ['What Admin is.'] } }));
        assert.deepEqual(log, ['backGuard', 'decide:admin:signedOut:null', 'card:Admin']);
        assert.deepEqual(card.about, { lines: ['What Admin is.'] }, 'the card carries the page\'s explanation');
        assert.deepEqual(readyCbs, [], 'nothing waits on a session that does not exist yet — sessionReady is one-shot');
    });

    test('refused: the refusal, with sessionReady settled false — never the page, never a session started', () => {
        session = { name: 'O. Staff' };
        policy = () => 'forbidden';
        startPage(spec());
        assert.deepEqual(log, ['backGuard', 'decide:admin:named:O. Staff', 'dismiss', 'resolve:false', 'refuse:forbidden:O. Staff']);
    });

    test('refused, where the refusal is a page of its own: the session step too, but no latency sample', () => {
        session = { name: 'O. Staff' };
        policy = () => 'forbidden';
        startPage(spec({ refusalKeepsSession: true }));
        assert.deepEqual(log, ['backGuard', 'decide:admin:named:O. Staff', 'dismiss',
            'ensure:O. Staff', 'resolve', 'guard:admin:O. Staff', 'pwForce:O. Staff', 'refuse:forbidden:O. Staff']);
        log = []; ready();
        assert.deepEqual(log, ['errorReporter', 'usage:admin:O. Staff'], 'a refusal is a real view, counted; nothing loads, so nothing is timed');
    });

    test('a page that owns its auth chain (establish: false) has no session touched on any path', () => {
        session = { name: 'A. Member' };
        startPage(spec({ establish: false }));
        policy = () => 'forbidden';
        startPage(spec({ establish: false }));
        assert.deepEqual(log.filter(e => /^(ensure|resolve|guard|pwForce)/.test(e)), []);
        assert.deepEqual(readyCbs, []);
    });

    test('recordLatency: false leaves the latency sample to the page', () => {
        session = { name: 'A. Member' };
        startPage(spec({ recordLatency: false }));
        log = []; ready();
        assert.deepEqual(log, ['errorReporter', 'usage:admin:A. Member']);
    });

    test('the page\'s own decision is asked with the session and the policy\'s answer to hand', () => {
        session = { name: 'A. Member' };
        /** @type {any[]} */ const seen = [];
        startPage(spec({ decide: (/** @type {any} */ s, /** @type {() => any} */ byPolicy) => { seen.push(s.name); return byPolicy(); } }));
        assert.deepEqual(seen, ['A. Member']);
        assert.ok(log.includes('run:A. Member'));
    });

    test('the lost-session card is told what the page is and what to put away first', () => {
        session = { name: 'A. Member' };
        startPage(spec({ about: { lines: ['x'] }, beforeSignInAgain: () => {} }));
        assert.ok(log.includes('guard:admin:A. Member:about:before'));
    });

    test('a page that hands over both a run and an again — or neither — is refused at once', () => {
        assert.throws(() => startPage(spec({ again: () => {} })), TypeError);
        assert.throws(() => startPage(spec({ run: undefined })), TypeError);
        assert.deepEqual(log, [], 'before the Back guard: nothing is half-started');
    });
});

describe('startPage — the card waits for what the page puts up first', () => {
    test('a beforeCard that returns nothing: the card at once, after it', () => {
        startPage(spec({ beforeCard: () => { log.push('drawer'); } }));
        assert.deepEqual(log, ['backGuard', 'decide:admin:signedOut:null', 'drawer', 'card:Admin']);
    });

    test('a beforeCard that returns a promise: the card only once it settles — and still if it rejects', async () => {
        /** @type {(v?: any) => void} */ let release = () => {};
        startPage(spec({ beforeCard: () => new Promise(r => { release = r; }) }));
        assert.ok(!log.includes('card:Admin'), 'the card went up before the teardown had finished');
        release();
        await new Promise(r => setImmediate(r));
        assert.ok(log.includes('card:Admin'));
        log = [];
        startPage(spec({ beforeCard: () => Promise.reject(new Error('teardown')) }));
        await new Promise(r => setImmediate(r));
        assert.ok(log.includes('card:Admin'), 'a failed wait must not leave the visitor with no way to sign in');
    });
});

describe('startPage — after an in-place sign-in (the card\'s onSuccess)', () => {
    test('allowed: the Back guard rebased, decided AGAIN for whoever signed in, then the page — in place', () => {
        startPage(spec());
        signInAs('B. Member');
        assert.deepEqual(log, ['rebase', 'decide:admin:named:B. Member', 'dismiss',
            'ensure:B. Member', 'resolve', 'guard:admin:B. Member', 'pwForce:B. Member', 'run:B. Member:inPlace']);
    });

    test('a login the page is not for gets the refusal, and the page NEVER runs (the v26.85 defect)', () => {
        startPage(spec({ refusalKeepsSession: true }));
        policy = (m) => (m === 'O. Staff' ? 'forbidden' : m ? 'allow' : 'login');
        signInAs('O. Staff');
        assert.ok(!log.some(e => e.startsWith('run:')), 'the page ran for a login it refuses');
        assert.deepEqual(log, ['rebase', 'decide:admin:named:O. Staff', 'dismiss',
            'ensure:O. Staff', 'resolve', 'guard:admin:O. Staff', 'pwForce:O. Staff', 'refuse:forbidden:O. Staff:inPlace'],
            'the card is dismissed, then the refusal is drawn for them');
    });

    test('no session by then: a reload into a fresh sign-in, and the page never runs for nobody', () => {
        startPage(spec());
        signInAs(null);
        assert.deepEqual(log, ['reload']);
    });

    test('a page that throws mid-wiring reloads, never stays half-built', () => {
        startPage(spec({ run: (/** @type {string} */ m, /** @type {any} */ ctx) => { log.push('run'); if (ctx.inPlace) throw new Error('wiring'); } }));
        signInAs('B. Member');
        assert.deepEqual(log.slice(-2), ['run', 'reload']);
    });

    test('a decision that still says sign in, after a sign-in, reloads rather than re-open the card over itself', () => {
        startPage(spec());
        policy = () => 'login';
        signInAs('B. Member');
        assert.deepEqual(log, ['rebase', 'decide:admin:named:B. Member', 'reload']);
    });
});

describe('startPage — a page whose start is the rest of its init (again)', () => {
    /** An `init` written as Operations, Links and the Pay Calculator write theirs. */
    function makeInit(/** @type {Record<string, any>} */ over = {}) {
        const init = () => {
            log.push('init');
            if (!startPage({ page: 'operations', label: 'Operations', again: init,
                refuse: (/** @type {any} */ d, /** @type {any} */ ctx) => log.push(`refuse:${ctx.member}${ctx.inPlace ? ':inPlace' : ''}`), ...over })) return;
            log.push(`body:${session?.name}`);
        };
        return init;
    }

    test('allowed at load: the session step, then startPage says carry on', () => {
        session = { name: 'G. Admin' };
        makeInit()();
        assert.deepEqual(log, ['init', 'backGuard', 'decide:operations:named:G. Admin', 'dismiss',
            'ensure:G. Admin', 'resolve', 'guard:operations:G. Admin', 'pwForce:G. Admin', 'body:G. Admin']);
    });

    test('signed out: the card, and the body is not reached', () => {
        makeInit()();
        assert.deepEqual(log, ['init', 'backGuard', 'decide:operations:signedOut:null', 'card:Operations']);
    });

    test('after a sign-in: init runs again, decided afresh, and the body runs once', () => {
        makeInit()();
        signInAs('G. Admin');
        assert.deepEqual(log, ['rebase', 'init', 'backGuard', 'decide:operations:named:G. Admin', 'dismiss',
            'ensure:G. Admin', 'resolve', 'guard:operations:G. Admin', 'pwForce:G. Admin', 'body:G. Admin']);
    });

    test('after a sign-in the page is not for: the refusal, in place, and the body is never reached', () => {
        makeInit()();
        policy = (m) => (m === 'A. Member' ? 'forbidden' : m ? 'allow' : 'login');
        signInAs('A. Member');
        assert.ok(!log.some(e => e.startsWith('body:')), 'the page ran for a login it refuses');
        assert.deepEqual(log.slice(-3), ['dismiss', 'resolve:false', 'refuse:A. Member:inPlace']);
    });

    test('a load after that is not "in place": the re-entry flag does not outlive its pass', () => {
        makeInit()();
        signInAs('G. Admin');
        log = []; policy = () => 'forbidden';
        makeInit()();
        assert.deepEqual(log.slice(-1), ['refuse:G. Admin']);
    });
});
