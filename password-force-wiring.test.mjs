// @ts-check
/**
 * password-force-wiring.test.mjs — the forced set-password overlay's ENTER key, driven through the
 * real module against a minimal fake DOM.
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs password-force-wiring.test.mjs   (part of test:unit)
 *
 * WHY THIS IS NOT AN E2E. The browser suite's Firebase stub has no signed-in Firebase user by design
 * (`getAuth()` returns `currentUser: null`, which a dozen specs branch on), so every save there fails
 * with "Not signed in" — and the path this file is about begins with a save that fails for a
 * DIFFERENT reason, `auth/requires-recent-login`, which reveals and focuses the current-password box.
 * That box cannot be reached in a browser without changing the stub for every other spec. Here the
 * three Firebase calls are mocked and the overlay is the real one.
 *
 * WHAT IT PINS (48-hour review, Nov 2026). The overlay's Enter handler was narrowed to the
 * new-password fields so that Enter on "Continue for now" stops re-submitting (v25.06) — and the
 * narrowing left the current-password box out, so on a mandatory screen its Enter and the phone's Go
 * key did nothing. All three fields submit; a button never does.
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let setCalls = 0, reauthCalls = 0;
// Settable per test, and RECORDED (test audit, 7 Nov 2026). These were fixed — the auth status always
// `named`, the save always "stale then fine", `lsDel` a no-op — so three wiring lines could be broken
// with this file green: the one-shot marker never consumed (the overlay then ambushes every load),
// the auth status hard-coded (the lockout guard gone), and no escape on a rate limit (trapped).
let authStatus = 'named';
/** @type {null | (() => Promise<any>)} */ let setImpl = null;
/** @type {string[]} */ const lsDeleted = [];
/** By default the first save is refused as stale, so the overlay asks for the current password; later ones land. */
mock.module('./firebase-client.js', { namedExports: {
    getPasswordStatus: async () => ({}),                       // not migrated — the overlay compels
    changeOwnPassword: async () => {
        setCalls++;
        if (setImpl) return setImpl();
        if (setCalls === 1) throw Object.assign(new Error('stale'), { code: 'auth/requires-recent-login' });
        return { stamp: Promise.resolve(true) };
    },
    reauthenticateWithPassword: async () => { reauthCalls++; },
} });
mock.module('./auth-state.js', { namedExports: { getAuthSnapshot: () => ({ status: authStatus }) } });
mock.module('./overlay.js', { namedExports: { lockBodyScroll() {}, unlockBodyScroll() {} } });
mock.module('./ls.js', { namedExports: { lsGet: () => '1', lsDel(/** @type {string} */ k) { lsDeleted.push(k); } } });

// ── A minimal fake DOM: exactly the elements the overlay looks up ──────────────────────────────────
/** Every event the overlay dispatched on the document, by type — the host page's cue. @type {string[]} */
const dispatched = [];
/** @type {any} */
const doc = { activeElement: null, dispatchEvent(/** @type {any} */ ev) { dispatched.push(ev.type); } };
/** @type {Record<string, any>} */
const ids = {};
function el(/** @type {string} */ id) {
    /** @type {Record<string, Function[]>} */
    const on = {};
    /** @type {any} */
    const e = {
        id, hidden: false, value: '', type: 'password', textContent: '', disabled: false, isConnected: true, offsetParent: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        addEventListener(/** @type {string} */ t, /** @type {Function} */ f) { (on[t] ||= []).push(f); },
        fire(/** @type {string} */ t, /** @type {any} */ ev) { for (const f of on[t] || []) f(ev); },
        click() { e.fire('click', { target: e }); },
        focus() { doc.activeElement = e; },
        /** @type {Record<string, string>} */ attrs: {},
        setAttribute(/** @type {string} */ k, /** @type {any} */ v) { e.attrs[k] = String(v); },
        removeAttribute(/** @type {string} */ k) { delete e.attrs[k]; },
        hasAttribute: (/** @type {string} */ k) => k in e.attrs, closest: () => null,
        contains: (/** @type {any} */ x) => !!x && Object.values(ids).includes(x),
        querySelectorAll: () => [],
    };
    return e;
}
/**
 * A FRESH set of elements for every test. The overlay mounts once and is reused (`_mount`), and each
 * open adds its listeners to whatever it finds — so with one shared set, an earlier test's overlay
 * went on answering this test's keys: one Enter ran two saves. The app never opens it twice in a page
 * (sign-out and every second sign-in reload the page), so this is the harness's problem, not the app's.
 */
function freshDom() {
    for (const id of ['pwForceOverlay', 'pwfNew', 'pwfConfirm', 'pwfCurrentWrap', 'pwfCurrent', 'pwfToggle', 'pwfError', 'pwfSave', 'pwfEscape']) ids[id] = el(id);
    ids.pwfCurrentWrap.hidden = true;                          // as mounted: the box appears only when asked for
    ids.pwfEscape.hidden = true;                               // and so does the way out
    doc.activeElement = null;
}
freshDom();
doc.getElementById = (/** @type {string} */ id) => ids[id] ?? null;
globalThis.document = /** @type {any} */ (doc);
/** @type {any} */ (globalThis).CustomEvent = class { constructor(/** @type {string} */ t) { /** @type {any} */ (this).type = t; } };

const { initPasswordForce } = await import('./password-force.js');

const settle = () => new Promise(r => setTimeout(r, 20));
/** Press Enter with focus on `target`; report whether the overlay took the key. */
function enter(/** @type {any} */ target) {
    let prevented = false;
    ids.pwForceOverlay.fire('keydown', { key: 'Enter', target, preventDefault() { prevented = true; } });
    return prevented;
}

beforeEach(() => { setCalls = 0; reauthCalls = 0; authStatus = 'named'; setImpl = null; lsDeleted.length = 0; dispatched.length = 0; freshDom(); });

/** Let promise chains and the overlay's handlers run (setImmediate, so a mocked setTimeout cannot hold it). */
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
/** Open the overlay and wait for it to take focus. `done` resolves when it closes.
 *  @returns {Promise<{ done: Promise<boolean> }>} */
async function openOverlay() {
    const done = initPasswordForce('G. Miller');
    for (let i = 0; i < 40 && doc.activeElement !== ids.pwfNew; i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(doc.activeElement, ids.pwfNew, 'premise: the overlay is up');
    return { done };
}

test('a password that HAS changed closes the overlay while its stamp is still on its way (settings-ops-2)', async () => {
    // The 8-second deadline covered the migration stamp as well — a Firestore write that settles only
    // when the server acknowledges it — so where commits were slow, a password that had changed read
    // "We couldn't confirm whether your password was updated", with Save stuck on "Still saving…".
    setImpl = async () => ({ stamp: new Promise(() => {}) });   // changed; the stamp is never acknowledged
    const { done } = await openOverlay();
    ids.pwfNew.value = ids.pwfConfirm.value = 'a-real-password-9';
    enter(ids.pwfConfirm);
    const closed = await Promise.race([done, new Promise(r => setTimeout(() => r('still open'), 300))]);
    assert.equal(closed, true, 'the member was held on an overlay for a stamp, not for their password');
    assert.ok(dispatched.includes('myb:password-set'), 'and the host page was told');
    assert.equal(ids.pwfEscape.hidden, true, 'nothing went wrong, so no escape was offered');
});

test('after "Continue for now", a password change that lands late still tells the host page', async (t) => {
    // The overlay is HIDDEN by the escape, not removed, so the late outcome still reaches the page —
    // the Settings card re-reads the member's status on it. The member was already told to keep and
    // try the new password, which is right under both outcomes.
    /** @type {() => void} */ let land = () => {};
    setImpl = () => new Promise(r => { land = () => r({ stamp: Promise.resolve(true) }); });
    await openOverlay();
    t.mock.timers.enable({ apis: ['setTimeout'] });
    ids.pwfNew.value = ids.pwfConfirm.value = 'a-real-password-9';
    enter(ids.pwfConfirm);
    await flush();
    t.mock.timers.tick(8000);                                   // SAVE_TIMEOUT_MS passes, the change still out
    await flush();
    assert.equal(ids.pwfEscape.hidden, false, 'premise: the outcome is unknown, so the escape is offered');
    ids.pwfEscape.click();                                      // Continue for now
    assert.deepEqual(dispatched, [], 'premise: nothing told yet');
    land();
    await flush();
    assert.deepEqual(dispatched, ['myb:password-set']);
});

test('Enter in the revealed current-password field re-authenticates and saves', async () => {
    void initPasswordForce('G. Miller');                       // resolves only when the overlay closes
    for (let i = 0; i < 40 && doc.activeElement !== ids.pwfNew; i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(doc.activeElement, ids.pwfNew, 'premise: the overlay is up');

    ids.pwfNew.value = ids.pwfConfirm.value = 'a-real-password-9';
    assert.equal(enter(ids.pwfConfirm), true, 'a new-password field still submits');
    await settle();
    assert.equal(setCalls, 1);
    assert.equal(ids.pwfCurrentWrap.hidden, false, 'premise: the stale sign-in revealed the current-password box');
    assert.equal(doc.activeElement, ids.pwfCurrent, 'premise: and focused it');

    assert.equal(enter(ids.pwfEscape), false, 'a button never takes the key — it activates itself');
    await settle();
    assert.equal(reauthCalls, 0);

    ids.pwfCurrent.value = 'miller';
    assert.equal(enter(ids.pwfCurrent), true, 'the current-password box submits too');
    await settle();
    assert.equal(reauthCalls, 1, 'the re-authentication ran');
    assert.equal(setCalls, 2, 'and the save was retried');
});

test('the one-shot marker is consumed, so an ordinary later load is never compelled', async () => {
    authStatus = 'none';                                       // refused below — this is about the marker
    assert.equal(await initPasswordForce('G. Miller'), false);
    assert.ok(lsDeleted.includes('myb_pw_force_pending_G. Miller'),
        'the marker was left in place, so the NEXT ordinary page load would be ambushed too');
});

test('a load whose identity is not a named member is never compelled — whatever the marker says', async () => {
    for (const status of ['none', 'viewer', 'anonymous', 'initialising']) {
        doc.activeElement = null;
        authStatus = status;
        const r = await Promise.race([initPasswordForce('G. Miller'), new Promise(res => setTimeout(() => res('opened'), 200))]);
        assert.equal(r, false, `the overlay compelled a ${status} load`);
        assert.notEqual(doc.activeElement, ids.pwfNew, `the overlay opened for a ${status} load`);
    }
});

test('Show is a plain button that names what it will do — never a toggle as well (sessions-5)', async () => {
    // With `aria-pressed` beside the changing name, a screen reader read "Hide password, pressed": a
    // toggle's label must not change with its state (WAI-ARIA APG, Button). The name has to change
    // here, because it carries the visible "Show"/"Hide" — so the pressed state is what goes.
    void initPasswordForce('G. Miller');                       // resolves only when the overlay closes
    for (let i = 0; i < 40 && doc.activeElement !== ids.pwfNew; i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(doc.activeElement, ids.pwfNew, 'premise: the overlay is up');
    ids.pwfToggle.click();
    assert.equal(ids.pwfNew.type, 'text');
    assert.equal(ids.pwfConfirm.type, 'text', 'both new-password fields are shown together');
    assert.equal(ids.pwfToggle.textContent, 'Hide');
    assert.equal(ids.pwfToggle.attrs['aria-label'], 'Hide password');
    assert.equal('aria-pressed' in ids.pwfToggle.attrs, false, 'a changing name AND a pressed state contradict each other');
    ids.pwfToggle.click();
    assert.equal(ids.pwfNew.type, 'password');
    assert.equal(ids.pwfToggle.attrs['aria-label'], 'Show password');
});

test('a rate-limited save offers the escape — the member cannot proceed by typing', async () => {
    setImpl = async () => { throw Object.assign(new Error('slow down'), { code: 'auth/too-many-requests' }); };
    const done = initPasswordForce('G. Miller');               // resolves when the overlay closes
    for (let i = 0; i < 40 && doc.activeElement !== ids.pwfNew; i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(doc.activeElement, ids.pwfNew, 'premise: the overlay is up');
    ids.pwfNew.value = ids.pwfConfirm.value = 'a-real-password-9';
    enter(ids.pwfConfirm);
    await settle();
    assert.equal(setCalls, 1, 'premise: the save was tried');
    assert.equal(ids.pwfEscape.hidden, false, 'a rate-limited member was left with no way out');
    ids.pwfEscape.click();                                     // leave, so the overlay is not open for later tests
    await Promise.race([done, settle()]);
});

