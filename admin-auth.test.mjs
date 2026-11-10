/**
 * admin-auth.test.mjs — the provisioning audit AS THE CARD RUNS IT.
 * Run with: node --experimental-test-module-mocks scripts/run-tests.mjs admin-auth.test.mjs   (part of `test:unit`)
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
 * server-side, and this file is about the read that was added beside it — the button is pressed
 * here only for the re-audit it runs afterwards.
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

/** What setupRosterAuth answers when the button is pressed, or an Error for the request to throw. */
/** @type {any} */ let _setupReply = new Error('unused');

mock.module('./firebase-client.js', {
    namedExports: {
        auth: { currentUser: { uid: 'admin', getIdTokenResult: async () => ({ token: 't', claims: { admin: true } }) } },
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
    namedExports: {
        fetchWithTimeout: async () => {
            if (_setupReply instanceof Error) throw _setupReply;
            return { ok: true, json: async () => _setupReply, text: async () => '' };
        },
        isFetchTimeout: () => false,
    },
});

const { initAuthSetup } = await import('./admin-auth.js');

/** Let the audit's promise chain settle: sessionReady → loadGaps, then the awaited read inside it. */
async function drain() { for (let i = 0; i < 10; i++) await Promise.resolve(); }

/** Build the card, run init, and let the audit's promise chain settle. `withdrawals` counts the
 *  `onWithdraw` calls — one entry per call. */
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
    /** @type {true[]} */ const withdrawals = [];
    initAuthSetup({ currentIsAdmin: true, onAttention: (c) => reported.push(c), onWithdraw: () => withdrawals.push(true) });
    await drain();
    return { reported, withdrawals, gaps: els.authSetupGaps };
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

    // A body without both lists is not "no gaps found" (test audit, 7 Nov 2026). This test used to
    // check only that no GAP was invented — and the app read `{}` as the all-clear, which is the line
    // /leaver step 6 reads as proof that a leaver can no longer sign in.
    for (const [what, body] of /** @type {[string, any][]} */ ([
        ['an empty body', {}],
        ['a body with only one list', { setUp: [] }],
        ['lists that are not lists', { setUp: 'none', leavers: null }],
    ])) {
        test(`${what} is not read as clean — it says it could not check`, async () => {
            const { gaps, reported } = await wire(body);
            assert.doesNotMatch(gaps.textContent, /Everyone on the roster has a login/,
                'an unreadable answer must never render the all-clear');
            assert.match(gaps.textContent, /Couldn’t check/);
            assert.deepEqual(reported, [], 'and nothing is reported to the attention strip, in either direction');
        });
    }
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
        await drain();
        assert.equal(_calls, 2);
        assert.match(gaps.textContent, /Everyone on the roster has a login/);
    });
});

// ── A CHECK THAT CANNOT ANSWER TAKES BACK WHAT AN EARLIER ONE TOLD THE STRIP (settings-ops-6) ────
// Reporting nothing on a failure keeps a zero from being invented; it does not take back a count
// the strip already shows. The strip read "Leavers still active 2" while the card beneath it, after
// the re-audit that follows a run had failed, said it could not tell.
describe('a check that cannot answer takes back what an earlier one told the strip', () => {
    /** Answer the load with GAPPY, then press Set up accounts with the re-audit answering `after`. */
    async function runThenReaudit(/** @type {any} */ after) {
        const w = await wire(GAPPY);
        assert.deepEqual(w.reported, [{ setUp: 2, leavers: 1 }], 'premise: the load answered');
        assert.equal(w.withdrawals.length, 0, 'premise: an answer withdraws nothing');
        _setupReply = { created: [], skipped: [] };
        _next = after;
        await els.authSetupBtn.fire('click');
        await drain();
        assert.equal(_calls, 2, 'premise: the run re-audited');
        return w;
    }

    for (const [what, after] of /** @type {[string, any][]} */ ([
        ['fails', new Error('timeout')],
        ['is refused', REFUSED],
        ['cannot be read', {}],
    ])) {
        test(`a re-audit after a run that ${what} withdraws the counts`, async () => {
            const w = await runThenReaudit(after);
            assert.match(w.gaps.textContent, /Couldn’t check/);
            assert.equal(w.withdrawals.length, 1,
                'the strip would go on stating two leavers beside a card that says it cannot tell');
            assert.deepEqual(w.reported, [{ setUp: 2, leavers: 1 }], 'and nothing is reported in their place');
        });
    }

    test('a re-audit that answers reports its counts, and withdraws nothing', async () => {
        const w = await runThenReaudit(CLEAN);
        assert.equal(w.withdrawals.length, 0);
        assert.deepEqual(w.reported, [{ setUp: 2, leavers: 1 }, { setUp: 0, leavers: 0 }]);
    });

    test('a Retry that fails again withdraws again', async () => {
        const w = await wire(new Error('offline'));
        assert.equal(w.withdrawals.length, 1, 'the first load could not answer either');
        const retry = w.gaps.find((/** @type {any} */ e) => e.className === 'auth-gap-retry');
        await retry.fire('click');
        await drain();
        assert.equal(w.withdrawals.length, 2);
        assert.deepEqual(w.reported, []);
    });
});

// ── THE CLASSES IT WRITES ARE CLASSES THAT ARE STYLED (whole-app check, 10 Nov 2026) ─────────────
// `auth-gaps--warn` was toggled on every load and `auth-gap-line--setup` stamped on every set-up
// line; no rule in operations.css — the page that shows the card — reads either. A class nothing
// styles tells the next reader there is a warn state to look for, and there is not.
test('every class the block writes is one operations.css styles', async () => {
    const css = readFileSync(new URL('./operations.css', import.meta.url), 'utf8');
    /** @type {Set<string>} */ const seen = new Set();
    const walk = (/** @type {any} */ el) => {
        if (typeof el === 'string') return;
        for (const c of String(el.className || '').split(/\s+/).filter(Boolean)) seen.add(c);
        for (const c of el.classList._s) seen.add(c);
        el.children.forEach(walk);
    };
    for (const answer of [GAPPY, CLEAN, REFUSED, new Error('offline')]) walk((await wire(answer)).gaps);
    for (const c of ['auth-gap-line', 'auth-gap-line--leaver', 'auth-gap-fix', 'auth-gap-ok', 'auth-gap-unknown', 'auth-gap-retry']) {
        assert.ok(seen.has(c), `premise: ${c} was rendered`);
    }
    const unstyled = [...seen].filter(c => !new RegExp(`\\.${c}(?![\\w-])`).test(css));
    assert.deepEqual(unstyled, [], 'a class with no rule behind it');
});

test('a page without the block still initialises', async () => {
    // A page carrying the card without this element (as one once did) still gets a working button;
    // a hard requirement would take the whole Staff Login Accounts card down with it.
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
