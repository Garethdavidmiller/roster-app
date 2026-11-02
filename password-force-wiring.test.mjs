// @ts-check
/**
 * password-force-wiring.test.mjs — the forced set-password overlay's ENTER key, driven through the
 * real module against a minimal fake DOM.
 * Run: node --experimental-test-module-mocks --test password-force-wiring.test.mjs   (part of test:unit)
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
/** The first save is refused as stale, so the overlay asks for the current password; later ones land. */
mock.module('./firebase-client.js', { namedExports: {
    getPasswordStatus: async () => ({}),                       // not migrated — the overlay compels
    setOwnPassword: async () => {
        setCalls++;
        if (setCalls === 1) throw Object.assign(new Error('stale'), { code: 'auth/requires-recent-login' });
        return { statusRecorded: true };
    },
    reauthenticateWithPassword: async () => { reauthCalls++; },
} });
mock.module('./auth-state.js', { namedExports: { getAuthSnapshot: () => ({ status: 'named' }) } });
mock.module('./overlay.js', { namedExports: { lockBodyScroll() {}, unlockBodyScroll() {} } });
mock.module('./ls.js', { namedExports: { lsGet: () => '1', lsDel() {} } });

// ── A minimal fake DOM: exactly the elements the overlay looks up ──────────────────────────────────
/** @type {any} */
const doc = { activeElement: null, dispatchEvent() {} };
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
        setAttribute() {}, removeAttribute() {}, hasAttribute: () => false, closest: () => null,
        contains: (/** @type {any} */ x) => !!x && Object.values(ids).includes(x),
        querySelectorAll: () => [],
    };
    return e;
}
for (const id of ['pwForceOverlay', 'pwfNew', 'pwfConfirm', 'pwfCurrentWrap', 'pwfCurrent', 'pwfToggle', 'pwfError', 'pwfSave', 'pwfEscape']) ids[id] = el(id);
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

beforeEach(() => { setCalls = 0; reauthCalls = 0; });

test('Enter in the revealed current-password field re-authenticates and saves', async () => {
    ids.pwfCurrentWrap.hidden = true;
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
