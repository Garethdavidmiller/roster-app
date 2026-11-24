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
import { test, describe, mock, beforeEach, afterEach } from 'node:test';
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
        append(...kids) { for (const k of kids) if (k && typeof k === 'object') k._parent = this; this.children.push(...kids); },
        appendChild(k) { k._parent = this; this.children.push(k); return k; },
        /** Out of its parent, as the PIN's line is taken down before it is drawn again. */
        remove() { if (this._parent) this._parent.children = this._parent.children.filter((/** @type {any} */ c) => c !== this); },
        /** A single-class selector, which is all the card asks (`.auth-gap-line--pin`). @param {string} sel */
        querySelector(sel) { const cls = sel.replace(/^\./, ''); return this.find((/** @type {any} */ c) => String(c.className).split(/\s+/).includes(cls)); },
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

/** What setupRosterAuth answers when the button is pressed, or an Error for the request to throw.
 *  An ARRAY is a queue: each request takes the next answer (the dry run, then the confirm). */
/** @type {any} */ let _setupReply = new Error('unused');
/** Every setupRosterAuth request body, parsed — what the card actually SENT. @type {any[]} */
let _setupSent = [];
/** The claims on the admin's fresh ID token. @type {Record<string, any>} */
let _claims = { admin: true };

mock.module('./firebase-client.js', {
    namedExports: {
        auth: { currentUser: { uid: 'admin', getIdTokenResult: async () => ({ token: 't', claims: _claims }) } },
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
        fetchWithTimeout: async (/** @type {string} */ _url, /** @type {any} */ init) => {
            _setupSent.push(JSON.parse(init.body));
            const reply = Array.isArray(_setupReply) ? _setupReply.shift() : _setupReply;
            if (reply instanceof Error) throw reply;
            return { ok: true, json: async () => reply, text: async () => '' };
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
    const card = initAuthSetup({ currentIsAdmin: true, onAttention: (c) => reported.push(c), onWithdraw: () => withdrawals.push(true) });
    await drain();
    return { reported, withdrawals, gaps: els.authSetupGaps, card };
}

const CLEAN   = { setUp: [], leavers: [] };
const REFUSED = { refused: 'no-accounts-visible', setUp: [], leavers: [] };
const GAPPY   = {
    setUp: [{ name: 'B. Toth', why: 'no-account' }, { name: 'S. Silva', why: 'claims' }],
    leavers: ['B. Khalil'],
};

beforeEach(() => { _calls = 0; _setupSent = []; _claims = { admin: true }; });

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
        assert.deepEqual(reported, [{ setUp: 0, leavers: 0, pinLockout: null }]);
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
        assert.deepEqual(reported, [{ setUp: 2, leavers: 1, pinLockout: null }]);
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
        assert.deepEqual(reported, [{ setUp: 0, leavers: 1, pinLockout: null }]);
    });

    test('one of each is singular, two is plural', async () => {
        const { gaps } = await wire({ setUp: [{ name: 'B. Toth', why: 'disabled' }], leavers: ['B. Khalil'] });
        assert.match(gaps.textContent, /1 member is not set up/);
        assert.match(gaps.textContent, /1 leaver can still sign in/);
    });
});

// ── WHAT PRESSING WILL DO, SAID BEFORE IT IS PRESSED (sign-in audit E6, Nov 2026) ───────────────────────────────────
// Set up accounts TAKES BACK an account with no permissions at all and RE-ENABLES a disabled one, each on the surname
// default with every device signed out. Both were listed with "Press Set up accounts below." and nothing more, so the
// admin learned from the result that colleagues had been put back on their surname. A wrong tier is only re-stamped.
describe('the members Set up accounts will reset are named, before it is pressed', () => {
    /** The remedy lines of the set-up line, in order. @param {any} gaps */
    const remedies = (gaps) => {
        const line = gaps.find((/** @type {any} */ e) => e.className === 'auth-gap-line');
        return line.children.filter((/** @type {any} */ c) => typeof c !== 'string' && c.className === 'auth-gap-fix').map((/** @type {any} */ c) => c.textContent);
    };

    test('no permissions and a disabled account say what pressing will do to them, by name, each on its own line', async () => {
        const { gaps, reported } = await wire({ setUp: [
            { name: 'B. Toth', why: 'no-account' }, { name: 'S. Silva', why: 'unstamped' }, { name: 'B. Khalil', why: 'disabled' },
        ], leavers: [] });
        assert.match(gaps.textContent, /S\. Silva \(no permissions\)/);
        assert.match(gaps.textContent, /B\. Khalil \(account disabled\)/);
        assert.deepEqual(remedies(gaps), ['Press Set up accounts below.',
            'It will reset the passwords of S. Silva and B. Khalil to their surnames and sign them out — tell them afterwards.']);
        assert.deepEqual(reported, [{ setUp: 3, leavers: 0, pinLockout: null }], 'the strip counts every gap, reset or not');
    });

    test('one member is told in the singular', async () => {
        const { gaps } = await wire({ setUp: [{ name: 'B. Khalil', why: 'disabled' }], leavers: [] });
        assert.equal(remedies(gaps)[1], 'It will reset B. Khalil’s password to their surname and sign them out — tell them afterwards.');
    });

    test('three are listed as a sentence lists them', async () => {
        const { gaps } = await wire({ setUp: ['A. One', 'B. Two', 'C. Three'].map(name => ({ name, why: 'unstamped' })), leavers: [] });
        assert.match(remedies(gaps)[1], /of A\. One, B\. Two and C\. Three to their surnames/);
    });

    test('a wrong tier, or no account at all, warns of no reset — neither is put back on a surname by the press', async () => {
        const { gaps } = await wire({ setUp: [{ name: 'B. Toth', why: 'no-account' }, { name: 'S. Silva', why: 'claims' }], leavers: [] });
        assert.deepEqual(remedies(gaps), ['Press Set up accounts below.']);
        assert.match(gaps.textContent, /S\. Silva \(wrong permissions\)/, 'an older server sends this for no permissions too, and it still reads');
    });

    test('a reason this page does not know is shown as the server sent it, and warns of nothing', async () => {
        const { gaps } = await wire({ setUp: [{ name: 'B. Toth', why: 'something-new' }], leavers: [] });
        assert.match(gaps.textContent, /B\. Toth \(something-new\)/);
        assert.deepEqual(remedies(gaps), ['Press Set up accounts below.']);
    });
});

// ── TWO REASONS SET UP ACCOUNTS REFUSES (review D3, Nov 2026) ───────────────────────────────────
// The shared PIN account at a member's address, and an account whose permissions name another member,
// came back as "wrong permissions" with "Press Set up accounts below." — and the press only reported
// the refusal. Each now says what the button says when it refuses it.
describe('the gaps Set up accounts cannot mend say so, with their own remedy', () => {
    /** @param {any} gaps */
    const remedies = (gaps) => gaps.find((/** @type {any} */ e) => e.className === 'auth-gap-line').children
        .filter((/** @type {any} */ c) => typeof c !== 'string' && c.className === 'auth-gap-fix').map((/** @type {any} */ c) => c.textContent);

    test('each is named in words, and its remedy is the refusal\'s — the press is not offered for them alone', async () => {
        const { gaps, reported } = await wire({ setUp: [
            { name: 'B. Toth', why: 'viewer-linked' }, { name: 'S. Silva', why: 'other-member' }, { name: 'A. Hared', why: 'other-member' },
        ], leavers: [] });
        assert.match(gaps.textContent, /B\. Toth \(linked to the staff PIN account\)/);
        assert.match(gaps.textContent, /S\. Silva \(account claimed for another member\)/);
        assert.doesNotMatch(gaps.textContent, /wrong permissions/);
        assert.deepEqual(remedies(gaps), [
            'B. Toth: the address is linked to the shared staff PIN account, which Set up accounts will not take over. With the staff PIN retired nothing in the app clears it: delete the staff PIN account in the Firebase console (the retirement’s last step), then press Set up accounts.',
            'S. Silva and A. Hared: the account at that address is claimed for another member, so Set up accounts will not adopt it. Check it in the Firebase console.',
        ]);
        assert.deepEqual(reported, [{ setUp: 3, leavers: 0, pinLockout: null }], 'still counted: each is a member who cannot sign in properly');
    });

    test('beside a gap the press DOES mend, the press is offered first', async () => {
        const { gaps } = await wire({ setUp: [{ name: 'B. Toth', why: 'no-account' }, { name: 'S. Silva', why: 'viewer-linked' }], leavers: [] });
        const r = remedies(gaps);
        assert.equal(r[0], 'Press Set up accounts below.');
        assert.match(r[1], /^S\. Silva: the address is linked to the shared staff PIN account/);
    });
});

// ── THE CONFIRM SENDS WHAT THE PREVIEW NAMED (review D1, Nov 2026) ──────────────────────────────
// The server disables only the overlap of these uids with the leavers it finds at the confirm, and
// names the two differences; this is the card's half — what it sends, and what it then says.
describe('the leaver confirm is tied to the preview the admin read', () => {
    const PREVIEW = { created: [], skipped: [], orphanDryRun: true, orphansToDisable: ['X. Gone', 'Y. Gone'], orphanUids: ['u1', 'u2'] };

    /** Press Set up accounts with the leavers box ticked, then Confirm. @param {any[]} replies */
    async function previewThenConfirm(replies) {
        await wire(CLEAN);
        els.authSetupOrphans.checked = true;
        els.authConfirmOrphans = makeEl('button', 'authConfirmOrphans');   // what the preview's HTML holds
        _setupReply = [...replies];
        await els.authSetupBtn.fire('click');
        await drain();
        await els.authConfirmOrphans.fire('click');
        await drain();
        return els.authSetupResult.textContent;
    }

    test('the confirm carries the previewed uids', async () => {
        await previewThenConfirm([PREVIEW, { created: [], skipped: [], disabled: ['X. Gone', 'Y. Gone'] }]);
        assert.deepEqual(_setupSent, [{ removeOrphans: true },
            { removeOrphans: true, confirmOrphanRemoval: true, confirmUids: ['u1', 'u2'] }]);
    });

    test('what the server left alone is named — a skipped uid by the label the admin read', async () => {
        const text = await previewThenConfirm([PREVIEW,
            { created: [], skipped: [], disabled: ['X. Gone'], confirmSkipped: ['u2'], notPreviewed: ['Z. New'] }]);
        assert.match(text, /🚫 Disabled leavers \(1\): X\. Gone/);
        assert.match(text, /⏭️ Not disabled — no longer found as a leaver since the preview \(1\): Y\. Gone/);
        assert.match(text, /⚠️ Not disabled — not in the preview you confirmed \(1\): Z\. New — press Set up accounts again with the leavers box ticked to preview them\./);
    });

    test('a preview from an older server (no uids) confirms with an EMPTY list — never "everyone it finds"', async () => {
        const { orphanUids: _drop, ...older } = PREVIEW;
        await previewThenConfirm([older, { created: [], skipped: [], disabled: [] }]);
        assert.deepEqual(_setupSent[1].confirmUids, []);
    });

    test('an older server\'s confirm answer — neither list — reads as it always did', async () => {
        const text = await previewThenConfirm([PREVIEW, { created: [], skipped: [], disabled: ['X. Gone', 'Y. Gone'] }]);
        assert.match(text, /🚫 Disabled leavers \(2\): X\. Gone, Y\. Gone/);
        assert.doesNotMatch(text, /Not disabled/);
    });
});

// The Firebase console cannot set a custom claim (review D2, Nov 2026): the card sent the admin there.
test('a missing admin claim points at the runbook, never at the console, and sends nothing', async () => {
    await wire(CLEAN);
    _claims = {};
    await els.authSetupBtn.fire('click');
    await drain();
    const text = els.authSetupResult.textContent;
    assert.match(text, /The Firebase console cannot restore it: follow “Restoring a lost admin claim” in RECOVERY_RUNBOOK\.md/);
    assert.doesNotMatch(text, /Set the admin claim in the Firebase console/);
    assert.deepEqual(_setupSent, [], 'the call would only be refused');
    const runbook = readFileSync(new URL('./docs/RECOVERY_RUNBOOK.md', import.meta.url), 'utf8');
    assert.match(runbook, /^#+ .*Restoring a lost admin claim/m, 'the section the card names exists');
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
        assert.deepEqual(w.reported, [{ setUp: 2, leavers: 1, pinLockout: null }], 'premise: the load answered');
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
            assert.deepEqual(w.reported, [{ setUp: 2, leavers: 1, pinLockout: null }], 'and nothing is reported in their place');
        });
    }

    test('a re-audit that answers reports its counts, and withdraws nothing', async () => {
        const w = await runThenReaudit(CLEAN);
        assert.equal(w.withdrawals.length, 0);
        assert.deepEqual(w.reported, [{ setUp: 2, leavers: 1, pinLockout: null }, { setUp: 0, leavers: 0, pinLockout: null }]);
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

// ── THE STAFF PIN SHUT FOR EVERYONE, ON THE SAME ANSWER (owner, Nov 2026) ───────────────────────
// The audit's answer carries `pinLockout` (getAccountSetupGaps). The wiring: an object draws a line on
// the card and reports the count; `null` draws none and reports 0; ABSENT — an older server, or a
// record it could not read — draws none and reports `null`, which the strip turns into a WITHDRAW.
describe('the staff PIN lockout rides on the audit, and unknown is never "none"', () => {
    // The clock is the test's: a block on the card sets the card's next drawing for when it ends.
    const NOW = Date.UTC(2026, 10, 16, 14, 10);        // 14:10 London (GMT)
    beforeEach(() => { mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW }); });
    afterEach(() => { mock.timers.reset(); });
    const running = { active: true, blockedUntil: NOW + 10 * 60_000, lastBlockedAt: NOW - 5 * 60_000, blocks: 1 };

    test('a block running now: a line on the card, a count for the strip', async () => {
        const { gaps, reported } = await wire({ ...CLEAN, pinLockout: running });
        assert.match(gaps.textContent, /The staff PIN is blocked for everyone until \d{2}:\d{2}/);
        assert.match(gaps.textContent, /members can still sign in with their password/);
        assert.match(gaps.textContent, /Everyone on the roster has a login/, 'the audit\'s own answer still shows');
        assert.deepEqual(reported, [{ setUp: 0, leavers: 0, pinLockout: 1 }]);
    });

    test('none: no line, and a zero the strip can clear an old item with', async () => {
        const { gaps, reported } = await wire({ ...CLEAN, pinLockout: null });
        assert.doesNotMatch(gaps.textContent, /staff PIN/);
        assert.deepEqual(reported, [{ setUp: 0, leavers: 0, pinLockout: 0 }]);
    });

    test('absent (an older server): no line, and UNKNOWN to the strip — never a zero', async () => {
        const { gaps, reported } = await wire(CLEAN);
        assert.doesNotMatch(gaps.textContent, /staff PIN/);
        assert.deepEqual(reported, [{ setUp: 0, leavers: 0, pinLockout: null }]);
    });
});

// ── ASKED AGAIN, AND JUDGED BY THE CLOCK (whole-app check, 17 Nov 2026) ─────────────────────────
// The audit ran once, at load, and its PIN line was judged once, as the answer came. So the admin's
// "Staff PIN — blocked station-wide" push, tapped with Operations already open, landed on a card with no
// block on it; and a line drawn during a block went on saying "blocked until 14:20" at 15:00. The card
// now hands the page a `refresh` (operations-app.js calls it on that tap and on a return to the tab),
// the answer asked LAST is the one drawn, and the PIN's line is drawn again whenever its words change.
describe('the audit is asked again on demand, and its PIN line is judged by the clock', () => {
    const MIN = 60_000;
    const NOW = Date.UTC(2026, 10, 16, 14, 10);        // 14:10 London (GMT)
    beforeEach(() => { mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW }); });
    afterEach(() => { mock.timers.reset(); });
    const running = () => ({ active: true, blockedUntil: Date.now() + 10 * MIN, lastBlockedAt: Date.now() - 5 * MIN, blocks: 1 });
    /** The PIN's lines in the block — one at most, however often it is drawn. @param {any} gaps */
    const pinLines = (gaps) => gaps.children.filter((/** @type {any} */ e) => typeof e !== 'string' && /auth-gap-line--pin/.test(e.className));

    test('refresh asks again, and draws the newer answer — the PIN push on a page already open', async () => {
        const { gaps, reported, card } = await wire({ ...CLEAN, pinLockout: null });
        assert.doesNotMatch(gaps.textContent, /staff PIN/, 'premise: no block when the page loaded');
        _next = { ...CLEAN, pinLockout: running() };       // the block begins; its push is tapped
        await card.refresh();
        await drain();
        assert.equal(_calls, 2, 'the tap asked the server again');
        assert.match(gaps.textContent, /The staff PIN is blocked for everyone until 14:20/);
        assert.deepEqual(reported.at(-1), { setUp: 0, leavers: 0, pinLockout: 1 });
    });

    test('the answer asked LAST is the one drawn, whichever lands last', async () => {
        const { gaps, reported, card } = await wire(CLEAN);
        /** @type {(v: any) => void} */ let land = () => {};
        _next = new Promise(r => { land = r; });          // an earlier check, still on its way…
        const earlier = card.refresh();
        _next = GAPPY;                                     // …and a later one that answers first
        await card.refresh();
        await drain();
        assert.match(gaps.textContent, /B\. Toth/);
        land(CLEAN);                                       // the earlier answer lands after it
        await earlier;
        await drain();
        assert.match(gaps.textContent, /B\. Toth/, 'an answer from before was painted over the one after');
        assert.deepEqual(reported.at(-1), { setUp: 2, leavers: 1, pinLockout: null });
        assert.equal(reported.length, 2, 'and the stale answer reported nothing to the strip');
    });

    test('a block that ends while the page is open is drawn again as ended, then taken down when its day is over', async () => {
        const { gaps, reported } = await wire({ ...CLEAN, pinLockout: running() });
        assert.match(gaps.textContent, /The staff PIN is blocked for everyone until 14:20/);
        mock.timers.tick(10 * MIN + 1000);                // 14:20 has passed
        assert.doesNotMatch(gaps.textContent, /is blocked for everyone/, 'the line still said "blocked until 14:20" after 14:20');
        assert.match(gaps.textContent, /The staff PIN was blocked for everyone from 14:05 to 14:20/);
        assert.equal(pinLines(gaps).length, 1, 'drawn again, not drawn twice');
        assert.deepEqual(reported.at(-1), { setUp: 0, leavers: 0, pinLockout: 1 }, 'still counted for its day');
        mock.timers.tick(24 * 60 * MIN);                   // past midnight, and a day after it began
        assert.doesNotMatch(gaps.textContent, /staff PIN/, 'a day after it began, the line goes');
        assert.equal(pinLines(gaps).length, 0);
        assert.deepEqual(reported.at(-1), { setUp: 0, leavers: 0, pinLockout: 0 }, 'and the strip\'s item with it');
    });

    test('a check that cannot answer stops the drawing — nothing is reported after the withdraw', async () => {
        const { reported, withdrawals, card } = await wire({ ...CLEAN, pinLockout: running() });
        _next = new Error('offline');
        await card.refresh();
        await drain();
        assert.equal(withdrawals.length, 1);
        const before = reported.length;
        mock.timers.tick(30 * MIN);
        assert.equal(reported.length, before, 'a drawing after the withdraw reported counts nobody knows any more');
    });
});
