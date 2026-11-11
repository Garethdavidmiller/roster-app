/**
 * calendar-access-state.test.mjs — whether Calendar access is held, kept ONCE (Calendar step 2, v25.74).
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs calendar-access-state.test.mjs   (part of `test:unit`)
 *
 * ── WHAT THIS FILE IS FOR ───────────────────────────────────────────────────────────────────────
 *
 * Until v25.74 the roster reads and the three documents each had a flag of their own, and the
 * Calendar's coordinator set the pair by hand: on a grant, and again on each way access is lost
 * mid-session. Nothing was wrong with any copy. What nothing protected was the COPYING — a new way
 * of losing access that shut one gate and forgot the other leaves this device's saved copy of fifty
 * colleagues' leave and absence readable behind the lock card, and no server rule can see a cache
 * read. The two gates now ask one module instead, and this file is the proof of what that buys.
 *
 * Two halves:
 *   · THE STATE ITSELF — shut as loaded, opened by a literal `true` only, written before anybody is
 *     told, and every `true` a grant.
 *   · THE TWO GATES BESIDE IT — `calendar-overrides.js` and `calendar-doc-access.js` are loaded for
 *     REAL and driven through every writer the app has. At no step may they disagree, and a refused
 *     read must shut the documents with nothing to copy the fact across.
 *
 * Firestore is mocked so the reads can be COUNTED: a gate that returned early but still issued the
 * query would be invisible to any assertion on a return value (calendar-access-gate.test.mjs says
 * the same, and its sixteen tests still pin the roster gate one read at a time — unchanged by v25.74).
 *
 * The coordinator (`calendar-app.js`) cannot be loaded here, so its three lines of wiring are pinned
 * from the SOURCE at the foot, and walked in a real browser by e2e/calendar-pin.spec.js.
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (/** @type {string} */ f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');

/** @type {{ server: number, cache: number, serverError: any }} */
const calls = { server: 0, cache: 0, serverError: null };

mock.module('./firebase-client.js', {
    namedExports: {
        db: {},
        collection: () => ({}),
        query: (/** @type {any[]} */ ...a) => ({ a }),
        where: () => ({}),
        getDocs: async () => { calls.server++; const err = calls.serverError; if (err) throw err; return _snap(); },
        getDocsFromCache: async () => { calls.cache++; return _snap(); },
        COLLECTIONS: { overrides: 'overrides' },
    },
});
function _snap() { return { size: 0, empty: true, forEach: () => {}, docs: [] }; }

const { hasCalendarAccess, grantNumber, setCalendarAccess, onCalendarAccess } = await import('./calendar-access-state.js');
const {
    setOverrideAccess, hasOverrideAccess, setOverrideAccessLostHandler, ensureOverridesCached,
    clearFetchedMonth, monthKey, issueReadTicket, answerStillWanted,
} = await import('./calendar-overrides.js');
const { hasDocumentAccess, setDocumentAccess, onDocumentAccess, documentAccess, _resetDocumentAccessForTests }
    = await import('./calendar-doc-access.js');
const { knowledgeOf, forget } = await import('./calendar-data-state.js');

// Read AT IMPORT, before any test and before any reset can run: the value a real page gets, because
// nothing in the app resets the state. Every reader the app has is sampled, since each is a separate
// expression and any one of them could be the one that answers `true`.
const AT_LOAD = {
    state: hasCalendarAccess(), roster: hasOverrideAccess(), documents: hasDocumentAccess(),
    handle: documentAccess.has(), grant: grantNumber(),
};

/** Every writer the app has for the one fact. Two are the gates' own names for it. */
const WRITERS = /** @type {[string, (v: any) => void][]} */ ([
    ['setCalendarAccess', setCalendarAccess],
    ['setOverrideAccess', setOverrideAccess],
    ['setDocumentAccess', setDocumentAccess],
]);

/** What each reader says, as one comparable value. */
const answers = () => ({ state: hasCalendarAccess(), roster: hasOverrideAccess(), documents: hasDocumentAccess(), handle: documentAccess.has() });
const ALL = (/** @type {boolean} */ v) => ({ state: v, roster: v, documents: v, handle: v });

/** Listeners this file added, taken off again so no test hears the next one's writes. */
/** @type {(() => void)[]} */ let offs = [];
const listen = (/** @type {(w: { open: boolean, changed: boolean }) => void} */ fn) => { offs.push(onCalendarAccess(fn)); };

beforeEach(() => {
    for (const off of offs) off();
    offs = [];
    _resetDocumentAccessForTests();   // drops the documents' subscribers, then shuts the state
    setOverrideAccessLostHandler(null);
    calls.server = 0; calls.cache = 0; calls.serverError = null;
    for (let m = 0; m < 12; m++) clearFetchedMonth(monthKey(2031, m));
    forget();
});

// ── THE STATE ITSELF ────────────────────────────────────────────────────────────────────────────

describe('the one copy: shut until a literal true', () => {
    test('SHUT AS LOADED — through every reader, before anything could have reset it', () => {
        // The default is the security property. A module that loaded open would have a locked
        // Calendar serving the local cache from its first line, and every test below would still
        // pass, because each starts from a reset.
        assert.deepEqual({ state: AT_LOAD.state, roster: AT_LOAD.roster, documents: AT_LOAD.documents, handle: AT_LOAD.handle },
            ALL(false), 'a gate answered open on a freshly loaded page');
        assert.equal(AT_LOAD.grant, 0, 'a grant was counted before anything granted');
    });

    for (const [name, write] of WRITERS) {
        test(`only a literal true opens it — ${name}`, () => {
            for (const v of ['yes', 1, {}, [], 'true', 'G. Miller']) {
                write(v);
                assert.deepEqual(answers(), ALL(false), `${JSON.stringify(v)} opened a gate through ${name}`);
            }
            write(true);
            assert.deepEqual(answers(), ALL(true));
        });
    }

    test('every true is a GRANT, even over a Calendar already open; a shut is not one', () => {
        const g0 = grantNumber();
        setCalendarAccess(true);
        assert.equal(grantNumber(), g0 + 1);
        setCalendarAccess(true);   // a second grant with no lock between: a new number all the same
        assert.equal(grantNumber(), g0 + 2, 'a grant over an open Calendar kept the old number — reads still out would settle its months');
        setCalendarAccess(false);
        setCalendarAccess(false);
        assert.equal(grantNumber(), g0 + 2, 'losing access counted as a grant');
    });
});

describe('the one copy: who is told, and when', () => {
    test('listeners hear EVERY write, and `changed` only when the answer moved', () => {
        /** @type {string[]} */ const heard = [];
        listen(({ open, changed }) => heard.push(`${open ? 'open' : 'shut'}${changed ? '*' : ''}`));
        setCalendarAccess(false);   // already shut
        setCalendarAccess(true);
        setCalendarAccess(true);    // a grant over an open Calendar
        setCalendarAccess(false);
        setCalendarAccess(false);
        assert.deepEqual(heard, ['shut', 'open*', 'open', 'shut*', 'shut']);
    });

    test('WRITTEN BEFORE ANYONE IS TOLD — a listener reading through either gate finds the new answer', () => {
        // The order is the property. Told first, a listener that repaints on a loss would read through
        // a gate still open, and one that repaints on a grant through a gate still shut — which claims
        // nothing and leaves the month on "Checking this month" for the session.
        /** @type {any[]} */ const seen = [];
        listen(({ open }) => seen.push({ told: open, ...answers(), grant: grantNumber() }));
        const g0 = grantNumber();
        setCalendarAccess(true);
        setCalendarAccess(false);
        assert.deepEqual(seen, [
            { told: true,  ...ALL(true),  grant: g0 + 1 },
            { told: false, ...ALL(false), grant: g0 + 1 },
        ]);
    });

    test('a listener that throws does not stop the next hearing that access is GONE', () => {
        /** @type {boolean[]} */ const heard = [];
        const errs = []; const orig = console.error; console.error = (...a) => errs.push(a);
        try {
            listen(() => { throw new Error('boom'); });
            listen(({ open }) => heard.push(open));
            setCalendarAccess(true);
            setCalendarAccess(false);
        } finally { console.error = orig; }
        assert.deepEqual(heard, [true, false], 'whatever sits behind the broken listener must still lock');
        assert.equal(hasCalendarAccess(), false, 'a throwing listener left the state open');
        assert.equal(errs.length, 2, 'the failure was swallowed without a word');
    });

    test('unsubscribing stops the news', () => {
        let n = 0;
        const off = onCalendarAccess(() => { n++; });
        setCalendarAccess(true);
        off();
        setCalendarAccess(false);
        assert.equal(n, 1);
    });
});

// ── THE TWO GATES BESIDE IT ─────────────────────────────────────────────────────────────────────

describe('the roster gate and the document gate cannot disagree', () => {
    test('one answer after every write, whichever writer made it', () => {
        // The fault this step removes: two flags, each right, set by hand in two places. Every
        // writer the app has is used in turn, opening and shutting, twice over.
        for (const open of [true, true, false, false, true, false]) {
            for (const [name, write] of WRITERS) {
                write(open);
                assert.deepEqual(answers(), ALL(open), `after ${name}(${open}) the gates gave different answers`);
            }
        }
    });

    test('a REFUSED month read shuts the documents too — with nothing to copy it across', async () => {
        // The route that mattered. A read refused for access shuts as it notices (v20.15); before
        // v25.74 that shut the ROSTER reads only, and the documents stayed open unless the
        // coordinator's wrapper remembered them. Here there is no coordinator at all.
        setCalendarAccess(true);
        /** @type {boolean[]} */ const docsHeard = [];
        onDocumentAccess(open => docsHeard.push(open));
        /** @type {any[]} */ const atHandler = [];
        setOverrideAccessLostHandler(() => atHandler.push(answers()));
        calls.serverError = Object.assign(new Error('denied'), { code: 'permission-denied' });

        await ensureOverridesCached(2031, 3, () => {});

        assert.deepEqual(answers(), ALL(false), 'a gate stayed open after the read was refused');
        assert.deepEqual(docsHeard, [false], 'the documents were not told to lock');
        // SHUT BEFORE THE CARD. The handler is what puts the lock card up, so everything must
        // already be shut when it is called — never a card over a gate still open.
        assert.deepEqual(atHandler, [ALL(false)], 'the handler ran with a gate still open behind the card it puts up');
    });

    test('an ordinary network failure shuts NEITHER', async () => {
        setCalendarAccess(true);
        setOverrideAccessLostHandler(() => {});
        calls.serverError = Object.assign(new Error('offline'), { code: 'unavailable' });
        const orig = console.error; console.error = () => {};
        try { await ensureOverridesCached(2031, 4, () => {}); } finally { console.error = orig; }
        assert.deepEqual(answers(), ALL(true), 'a network blip locked the Calendar');
    });

    test('a second grant over an OPEN Calendar: the roster reads start afresh, the documents are not told again', async () => {
        // The two halves want different things, which is why one flag could not serve both. A month
        // claimed under one grant must be read again under the next; a Huddle subscription already
        // listening must NOT be attached a second time.
        let docsTold = 0;
        onDocumentAccess(() => { docsTold++; });
        setCalendarAccess(true);
        await ensureOverridesCached(2031, 5, () => {});
        assert.equal(calls.server, 1, 'guard: the month must have been read once');
        const stale = issueReadTicket();

        setCalendarAccess(true);

        assert.equal(docsTold, 1, 'the documents were told about a grant that changed nothing for them');
        assert.equal(answerStillWanted(stale), false, 'a read issued under the earlier grant is still wanted under the new one');
        await ensureOverridesCached(2031, 5, () => {});
        assert.equal(calls.server, 2, 'the month stayed claimed across the grant — it would never be read again');
    });

    test('a read\'s ticket carries the grant number the STATE holds', () => {
        setCalendarAccess(true);
        const t = issueReadTicket();
        assert.equal(t.grant, grantNumber());
        assert.equal(answerStillWanted(t), true);
        setDocumentAccess(false);   // shut through the other gate's writer
        assert.equal(answerStillWanted(t), false, 'an answer was still wanted after access was shut');
    });

    for (const [name, write] of WRITERS) {
        test(`a shut forgets what every month was known to be — through ${name}`, async () => {
            setCalendarAccess(true);
            await ensureOverridesCached(2031, 6, () => {});
            assert.equal(knowledgeOf(monthKey(2031, 6)), 'authoritative', 'guard: the month must be known first');
            write(false);
            assert.equal(knowledgeOf(monthKey(2031, 6)), 'unknown', 'a month read under the lost access is still known — the next grant would draw it as current');
        });
    }
});

// ── WHERE THE WRITE LIVES, AND WHAT THE COORDINATOR NO LONGER DOES (from the source) ─────────────
//
// `calendar-app.js` builds the whole page at module scope and cannot be loaded here, so these read
// it. That is weaker than running it, and e2e/calendar-pin.spec.js is what runs it — but the browser
// suite cannot say "nobody else writes this", and that is the half that keeps the next route honest.

/** Source with comments removed, so a name in prose is not counted as a call. */
const code = (/** @type {string} */ f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

/** The app's own top-level modules: what a page can actually load. */
const APP_MODULES = readdirSync(new URL('./', import.meta.url))
    .filter(f => f.endsWith('.js') && !f.endsWith('.config.js'));

describe('the write has three homes, and the coordinator is not one of them', () => {
    test('guard: the scan reads real modules', () => {
        assert.ok(APP_MODULES.length > 100, `only ${APP_MODULES.length} modules found — the scan is wrong`);
        assert.ok(APP_MODULES.includes('calendar-app.js') && APP_MODULES.includes('calendar-access-state.js'));
        assert.match(code('calendar-access.js'), /setCalendarAccess\(true\)/, 'guard: the comment stripper must leave code alone');
    });

    test('only the access layer and the two gates write the state', () => {
        const writers = APP_MODULES.filter(f => f !== 'calendar-access-state.js' && /\bsetCalendarAccess\s*\(/.test(code(f))).sort();
        assert.deepEqual(writers, ['calendar-access.js', 'calendar-doc-access.js', 'calendar-overrides.js'],
            'a new module writes Calendar access — a grant or a loss has ONE call each (calendar-access.js), and anything else listens');
    });

    test('nothing outside its own module calls a gate\'s own writer', () => {
        // `setOverrideAccess` is how a refused read shuts, inside calendar-overrides.js; both names
        // are otherwise for the gates' tests. A page calling either is the old hand-copying coming back.
        for (const [name, home] of [['setOverrideAccess', 'calendar-overrides.js'], ['setDocumentAccess', 'calendar-doc-access.js']]) {
            const users = APP_MODULES.filter(f => f !== home && new RegExp(`\\b${name}\\b`).test(code(f)));
            assert.deepEqual(users, [], `${name} is used outside ${home} — access is written through the state, once`);
        }
    });

    test('the coordinator ends BOTH ways of losing access in the one call, wired before access is decided', () => {
        const app = code('calendar-app.js');
        assert.match(app, /^\s*onAccessLost: handleAccessLost,$/m,
            'the first load\'s lost-access route no longer ends in handleAccessLost alone');
        assert.match(app, /^setOverrideAccessLostHandler\(handleAccessLost\);$/m,
            'a refused month read no longer reaches handleAccessLost — or is wired inside a function, so it can be missing when a read is refused');
        assert.ok(app.indexOf('setOverrideAccessLostHandler(handleAccessLost);') < app.indexOf('initCalendarAccess({'),
            'the lost-access handler is wired after access is decided');
        // The member's stored copy is the coordinator's own, and it follows the state.
        assert.match(app, /^onCalendarAccess\(\(\{ open \}\) => \{ if \(!open\) clearSnapshot\(\); \}\);$/m,
            'a Calendar that has lost access no longer clears the member\'s stored copy');
    });

    test('neither gate, nor the state, depends on the sign-in code', () => {
        // The gates back the access layer UP: a way round the sign-in must not open them, and they
        // must load in Node without Firebase's auth. So the state imports nothing, the document gate
        // imports only the state, and the roster gate reaches neither the access layer nor the session.
        const imports = (/** @type {string} */ f) => [...code(f).matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)].map(m => m[1]);
        assert.deepEqual(imports('calendar-access-state.js'), []);
        assert.doesNotMatch(code('calendar-access-state.js'), /\bimport\b/);
        assert.deepEqual(imports('calendar-doc-access.js'), ['calendar-access-state.js']);
        const seen = new Set(), queue = ['calendar-overrides.js'];
        while (queue.length) {
            const f = /** @type {string} */ (queue.shift());
            if (seen.has(f)) continue;
            seen.add(f);
            queue.push(...imports(f));
        }
        assert.ok(seen.has('calendar-access-state.js') && seen.has('calendar-data-state.js'), 'guard: the walk must follow imports');
        for (const banned of ['calendar-access.js', 'calendar-lock-cards.js', 'session.js', 'login-overlay.js']) {
            assert.ok(!seen.has(banned), `calendar-overrides.js now reaches ${banned} — the gate depends on the code it backs up`);
        }
    });
});
