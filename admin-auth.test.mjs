/**
 * admin-auth.test.mjs — the provisioning audit AS THE CARD RUNS IT.
 * Run with: node --experimental-test-module-mocks --test admin-auth.test.mjs   (part of `test:unit`)
 *
 * ── WHY THE CARD AND NOT THE RULE ───────────────────────────────────────────────────────────────
 *
 * `summariseAccountGaps` is tested exhaustively in roster-parse-helpers.test.mjs and the endpoint
 * around it in auth-endpoints.test.mjs. Neither can see the thing this file is about, which is what
 * the CARD does with the answer — and CLAUDE.md names that gap by name: the rule tested, the wiring
 * not. A perfect audit whose result is dropped, or whose failure renders as a tick, is exactly as
 * silent as the gap it was written to end, and strictly worse: the admin now has a surface that
 * says everything is fine.
 *
 * ── ORGANISED BY WHAT A WRONG ANSWER COSTS ──────────────────────────────────────────────────────
 *
 * A FALSE ALL-CLEAR is the failure with teeth, and it has two doors. The card can render the tick
 * when the check did not run; and it can REPORT zero to the Needs-attention strip when it does not
 * know, which is worse still, because the strip's whole contract is that an unreported item is
 * unknown while an absent one means nothing to do. Report a zero you did not earn and the strip
 * says "nothing needs attention" on the authority of a request that failed.
 *
 * A FALSE ALARM costs the feature its readership. An admin who is told three people are unprovisioned
 * and finds they are not stops reading the block, and then the real one goes past too.
 *
 * NOT COVERED HERE: the Set up accounts button itself. It is a write, it is well covered
 * server-side, and this file is about the read that was added beside it.
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── A DOM, just enough ──────────────────────────────────────────────────────────────────────────
function makeEl(tag = 'div', id = '') {
    /** @type {any} */
    const el = {
        tag, id, hidden: false, disabled: false, type: '', checked: false,
        className: '', style: {}, attrs: /** @type {Record<string, string>} */ ({}),
        children: /** @type {any[]} */ ([]), listeners: /** @type {Record<string, Function[]>} */ ({}),
        _text: '',
        set textContent(v) { this._text = String(v); this.children = []; },
        get textContent() {
            return this._text + this.children.map(c => (typeof c === 'string' ? c : c.textContent)).join('');
        },
        set innerHTML(v) { this._text = String(v); this.children = []; },
        get innerHTML() { return this.textContent; },
        append(...kids) { this.children.push(...kids); },
        appendChild(k) { this.children.push(k); return k; },
        insertAdjacentHTML(_pos, html) { this.children.push(String(html)); },
        setAttribute(k, v) { this.attrs[k] = String(v); },
        removeAttribute(k) { delete this.attrs[k]; },
        getAttribute(k) { return this.attrs[k] ?? null; },
        classList: {
            _s: new Set(),
            add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
            contains(c) { return this._s.has(c); },
        },
        addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
        /** Fire every handler for an event, as a click would. */
        fire(ev) { return Promise.all((this.listeners[ev] || []).map(fn => fn({}))); },
        /** Depth-first search of the rendered subtree. */
        find(pred) {
            for (const c of this.children) {
                if (typeof c === 'string') continue;
                if (pred(c)) return c;
                const hit = c.find?.(pred);
                if (hit) return hit;
            }
            return null;
        },
    };
    return el;
}

/** @type {Record<string, any>} */ let els = {};
global.document = /** @type {any} */ ({
    getElementById: (/** @type {string} */ id) => els[id] ?? null,
    createElement: (/** @type {string} */ tag) => makeEl(tag),
});

// ── THE REST OF THE APP ─────────────────────────────────────────────────────────────────────────
/** What getAccountSetupGaps does on the next call: a value to resolve, or an Error to throw. */
/** @type {any} */ let _next;
let _calls = 0;

mock.module('./firebase-client.js', {
    namedExports: {
        auth: { currentUser: { uid: 'admin' } },
        getAccountSetupGaps: async () => {
            _calls += 1;
            if (_next instanceof Error) throw _next;
            return _next;
        },
    },
});
mock.module('./session.js', {
    namedExports: {
        sessionReady: Promise.resolve(),
        getFirebaseAuthError: () => null,
        restoreFirstAuthUser: async () => ({ uid: 'admin' }),
    },
});
mock.module('./roster-data.js', {
    namedExports: { escapeHtml: (/** @type {string} */ s) => String(s) },
});
mock.module('./fetch-timeout.js', {
    namedExports: { fetchWithTimeout: async () => { throw new Error('unused'); }, isFetchTimeout: () => false },
});

const { initAuthSetup } = await import('./admin-auth.js');

/** Build the card, run init, and let the audit's promise chain settle. */
async function wire(response) {
    els = {
        authSetupCard:    makeEl('div', 'authSetupCard'),
        authSetupBtn:     makeEl('button', 'authSetupBtn'),
        authSetupOrphans: makeEl('input', 'authSetupOrphans'),
        authSetupResult:  makeEl('div', 'authSetupResult'),
        authSetupGaps:    makeEl('div', 'authSetupGaps'),
    };
    _next = response;
    /** @type {any[]} */ const reported = [];
    initAuthSetup({ currentIsAdmin: true, onAttention: (c) => reported.push(c) });
    // Two microtask drains: sessionReady → loadGaps, then the awaited read inside it.
    for (let i = 0; i < 6; i++) await Promise.resolve();
    return { reported, gaps: els.authSetupGaps };
}

const CLEAN   = { setUp: [], leavers: [] };
const REFUSED = { refused: 'no-accounts-visible', setUp: [], leavers: [] };
const GAPPY   = {
    setUp: [{ name: 'B. Toth', why: 'no-account' }, { name: 'S. Silva', why: 'claims' }],
    leavers: ['B. Khalil'],
};

beforeEach(() => { _calls = 0; });

describe('a false all-clear — the failure this card exists to prevent', () => {
    test('a FAILED check reports nothing to the strip', async () => {
        const { reported } = await wire(new Error('offline'));
        assert.deepEqual(reported, [],
            'reporting {setUp:0, leavers:0} here would tell the strip the roster is clean on the '
            + 'authority of a request that never completed');
    });

    test('a failed check says so, rather than showing the tick', async () => {
        const { gaps } = await wire(new Error('offline'));
        assert.match(gaps.textContent, /Couldn’t check/);
        assert.ok(!/Everyone on the roster/.test(gaps.textContent));
        assert.equal(gaps.hidden, false, 'and it is visible — a silent failure is the same as a tick');
    });

    test('a REFUSED check reports nothing either', async () => {
        // The server saw no roster accounts and declined to name everybody as missing. "We could
        // not tell" and "there is nothing wrong" are different sentences and this is the first.
        const { reported, gaps } = await wire(REFUSED);
        assert.deepEqual(reported, []);
        assert.match(gaps.textContent, /didn’t load/);
        assert.ok(!/Everyone on the roster/.test(gaps.textContent));
    });

    test('a clean answer DOES report zeros, because that is knowledge', async () => {
        // The mirror image, and the reason the two cannot share a code path: a known-clean roster
        // must report so, or an item raised on an earlier load could never be cleared.
        const { reported, gaps } = await wire(CLEAN);
        assert.deepEqual(reported, [{ setUp: 0, leavers: 0 }]);
        assert.match(gaps.textContent, /Everyone on the roster has a login/);
    });

    test('a garbled response is not read as clean', async () => {
        // A body with neither array is not "no gaps found" — but it IS an answered request, so the
        // guard that matters is that nothing is invented from it.
        const { gaps } = await wire({});
        assert.ok(!/not set up/.test(gaps.textContent));
    });
});

describe('and the gaps themselves reach both the card and the strip', () => {
    test('the two groups are reported separately, never as one total', async () => {
        const { reported } = await wire(GAPPY);
        assert.deepEqual(reported, [{ setUp: 2, leavers: 1 }]);
    });

    test('the block NAMES people — a count alone cannot be acted on', async () => {
        const { gaps } = await wire(GAPPY);
        assert.match(gaps.textContent, /B\. Toth/);
        assert.match(gaps.textContent, /S\. Silva/);
        assert.match(gaps.textContent, /B\. Khalil/);
    });

    test('each name carries WHY, in words rather than the wire value', async () => {
        const { gaps } = await wire(GAPPY);
        assert.match(gaps.textContent, /B\. Toth \(no account\)/);
        assert.match(gaps.textContent, /S\. Silva \(wrong permissions\)/);
        assert.ok(!/no-account/.test(gaps.textContent), 'the code is for the wire, not for a person');
    });

    test('each line says which BUTTON fixes it', async () => {
        // The grouping is by remedy; a group that does not state its remedy has thrown away the
        // only thing that made the grouping worth doing.
        const { gaps } = await wire(GAPPY);
        assert.match(gaps.textContent, /Press Set up accounts below/);
        assert.match(gaps.textContent, /Tick the leavers box below/);
    });

    test('a leaver alone does not claim anybody needs setting up', async () => {
        const { gaps, reported } = await wire({ setUp: [], leavers: ['B. Khalil'] });
        assert.ok(!/not set up/.test(gaps.textContent));
        assert.match(gaps.textContent, /can still sign in/);
        assert.deepEqual(reported, [{ setUp: 0, leavers: 1 }]);
    });

    test('one of each is singular, two is plural', async () => {
        const { gaps } = await wire({ setUp: [{ name: 'B. Toth', why: 'disabled' }], leavers: ['B. Khalil'] });
        assert.match(gaps.textContent, /1 member is not set up/);
        assert.match(gaps.textContent, /1 leaver can still sign in/);
    });
});

describe('the retry', () => {
    test('a failed check offers one, and it asks again', async () => {
        const { gaps } = await wire(new Error('offline'));
        const retry = gaps.find((/** @type {any} */ e) => e.className === 'auth-gap-retry');
        assert.ok(retry, 'a check that cannot be re-run leaves the admin with a dead line of text');
        assert.equal(_calls, 1);
        _next = CLEAN;
        await retry.fire('click');
        for (let i = 0; i < 6; i++) await Promise.resolve();
        assert.equal(_calls, 2);
        assert.match(gaps.textContent, /Everyone on the roster has a login/);
    });
});

test('a page without the block still initialises', async () => {
    // admin.html has the card's siblings but not this element; a hard requirement would take the
    // whole Staff Login Accounts card down with it.
    els = {
        authSetupCard:    makeEl('div', 'authSetupCard'),
        authSetupBtn:     makeEl('button', 'authSetupBtn'),
        authSetupOrphans: makeEl('input', 'authSetupOrphans'),
        authSetupResult:  makeEl('div', 'authSetupResult'),
    };
    _next = CLEAN;
    assert.doesNotThrow(() => initAuthSetup({ currentIsAdmin: true }));
    for (let i = 0; i < 6; i++) await Promise.resolve();
});
