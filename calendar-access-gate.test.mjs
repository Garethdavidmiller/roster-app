/**
 * calendar-access-gate.test.mjs — no access, no override data. Ever.
 * Run: node --experimental-test-module-mocks --test calendar-access-gate.test.mjs
 *
 * ── THE INVARIANT ───────────────────────────────────────────────────────────────────────────────
 *
 * Tightening `firestore.rules` does NOT stop the Calendar showing yesterday's roster, and believing
 * it does is the single most likely way this feature ships broken. Rules are evaluated on the
 * SERVER. `getDocsFromCache` reads IndexedDB and never contacts one, so a browser that unlocked
 * yesterday still holds every override it saw — annual leave and absence for fifty named
 * colleagues — and would happily paint it before anybody typed a PIN.
 *
 * The shipped app has TWO defences. `calendar-app.js` does not initialise the Calendar at all while
 * locked, so nothing here is even reached; and this module refuses at source. This file tests the
 * second, because the first is a property of the CALL ORDER in a 1,000-line coordinator, which a
 * future edit can break with every existing test still green.
 *
 * ── WHY IT IS TESTED THROUGH MOCKED FIRESTORE ───────────────────────────────────────────────────
 *
 * The mocks record whether `getDocs`/`getDocsFromCache` were CALLED. That is the assertion that
 * matters: a gate that returned early but still issued the query would leave the cache read
 * happening and only the painting suppressed — which is a difference no assertion about the return
 * value could see.
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (/** @type {string} */ f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');

/** @type {{ server: number, cache: number }} */
const calls = { server: 0, cache: 0, serverError: null };
/** Every `where(...)` the module built, so a test can assert the QUERY was scoped rather than the
 *  results filtered afterwards. A mock that returned `{}` could not tell those apart — and the
 *  difference is whether a colleague's overrides were read out of the cache at all. */
let wheres = [];
/** Docs the fake Firestore will hand back — stands in for a populated IndexedDB cache. */
let cacheDocs = [];

mock.module('./firebase-client.js', {
    namedExports: {
        db: {},
        collection: () => ({}),
        query: (...a) => ({ a }),
        where: (/** @type {any} */ f, /** @type {any} */ op, /** @type {any} */ v) => { wheres.push([f, op, v]); return {}; },
        getDocs: async () => { calls.server++; const wait = calls.serverWait, err = calls.serverError; if (wait) await wait; if (err) throw err; return _snap([]); },
        getDocsFromCache: async () => { calls.cache++; return _snap(cacheDocs); },
        COLLECTIONS: { overrides: 'overrides' },
    },
});

function _snap(rows) {
    return {
        size: rows.length,
        empty: rows.length === 0,
        forEach: (/** @type {any} */ fn) => rows.forEach(r => fn({ data: () => r })),
        docs: rows.map(r => ({ data: () => r })),
    };
}

const mod = await import('./calendar-overrides.js');
const {
    setOverrideAccess, hasOverrideAccess, rosterOverridesCache,
    fetchOverridesForRange, fetchOverridesForRangeFromCache, ensureOverridesCached, clearFetchedMonth, monthKey,
    setOverrideAccessLostHandler,
} = mod;
// NOT mocked, and that is the point: `calendar-data-state.js` is pure and holds the module state
// the calendar reads back to decide what it may SHOW. A month the gate was supposed to skip
// entirely, left recorded as `error`, is the difference between a cached grid and a failure panel.
const { knowledgeOf, forget } = await import('./calendar-data-state.js');
// Also not mocked: the classifier every caller of the authoritative read keys its recovery on.
const { isAccessFailure } = await import('./claim-retry.js');

const OVERRIDE = {
    date: '2026-08-12', memberName: 'G. Miller', type: 'annual_leave',
    value: 'AL', note: '', source: 'manual', createdAt: { toMillis: () => 1 },
};

beforeEach(() => {
    calls.server = 0;
    calls.cache = 0;
    calls.serverError = null;
    cacheDocs = [];
    rosterOverridesCache.clear();
    setOverrideAccess(false);
    wheres = [];
    // Release every month this file touches, so one test's fetch cannot mark a month claimed for
    // the next — `fetchedMonths` is module state and does not reset with the cache.
    for (let m = 0; m < 12; m++) clearFetchedMonth(monthKey(2026, m));
    forget();   // same reason, for what the calendar KNOWS about those months
});

describe('the gate is CLOSED until something opens it', () => {
    test('access defaults to false on a freshly-loaded module', () => {
        // The default is the security property. A gate that defaulted open would protect only the
        // paths somebody remembered to close.
        assert.equal(hasOverrideAccess(), false);
    });

    test('only a literal true opens it — no truthy values', () => {
        for (const v of ['yes', 1, {}, [], 'true']) {
            setOverrideAccess(/** @type {any} */ (v));
            assert.equal(hasOverrideAccess(), false, `${JSON.stringify(v)} opened the gate`);
        }
        setOverrideAccess(true);
        assert.equal(hasOverrideAccess(), true);
    });
});

describe('THE CACHE PAINT — the read firestore.rules cannot stop', () => {
    test('with no access it neither queries the cache nor changes anything on screen', () => {
        cacheDocs = [OVERRIDE];
        return fetchOverridesForRangeFromCache('2026-08-01', '2026-08-31').then(painted => {
            assert.equal(calls.cache, 0, 'the local cache was queried before access was granted');
            assert.equal(painted, false, 'the caller was told there was something to paint');
            assert.equal(rosterOverridesCache.size, 0, 'override data reached the render cache while locked');
        });
    });

    test('the SAME cache paints normally once access is granted', async () => {
        // The gate must be a gate, not a disablement. If this half did not pass, the test above
        // would be satisfied by a module that simply never worked.
        cacheDocs = [OVERRIDE];
        setOverrideAccess(true);
        const painted = await fetchOverridesForRangeFromCache('2026-08-01', '2026-08-31');
        assert.equal(calls.cache, 1);
        assert.equal(painted, true);
        assert.ok(rosterOverridesCache.size > 0, 'the cache read produced nothing — this test is checking nothing');
    });

    test('a browser that unlocked YESTERDAY cannot paint today before unlocking again', async () => {
        // The exact scenario, walked end to end: unlock, populate the cache, then a fresh browser
        // session (module state re-armed to locked) with the same IndexedDB behind it.
        setOverrideAccess(true);
        cacheDocs = [OVERRIDE];
        await fetchOverridesForRangeFromCache('2026-08-01', '2026-08-31');
        assert.ok(rosterOverridesCache.size > 0);

        // New browser session: the viewer's session-only Firebase identity is gone, so the
        // coordinator never grants access — but IndexedDB survived.
        rosterOverridesCache.clear();
        setOverrideAccess(false);
        calls.cache = 0;
        const painted = await fetchOverridesForRangeFromCache('2026-08-01', '2026-08-31');
        assert.equal(painted, false);
        assert.equal(calls.cache, 0);
        assert.equal(rosterOverridesCache.size, 0);
    });
});

describe('the authoritative read', () => {
    test('with no access it THROWS rather than resolving quietly', async () => {
        // Deliberately different from the cache path. A caller that reaches the authoritative read
        // without access has a real ordering bug, and the sync chip's error state is the visible,
        // retryable place for that to surface. Resolving quietly would leave the Calendar showing
        // the base roster as though it were current — the one outcome this feature must prevent.
        await assert.rejects(() => fetchOverridesForRange('2026-08-01', '2026-08-31'),
            /calendar-access-required/);
        assert.equal(calls.server, 0, 'a network read was issued while locked');
    });

    test('it runs once access is granted', async () => {
        setOverrideAccess(true);
        await fetchOverridesForRange('2026-08-01', '2026-08-31');
        assert.equal(calls.server, 1);
    });
});

describe('month navigation and Team View obey the same gate', () => {
    test('ensureOverridesCached does nothing while locked — and does so SILENTLY', async () => {
        // The silence is what this asserts, and it is the only observable difference. The gate here
        // is the third layer: without it, `fetchOverridesForRange` still throws and nothing leaks,
        // but the throw lands in this function's catch — which logs `[Firestore] Failed to fetch
        // overrides` on every month a locked visitor swipes past. That is a real cost (a console
        // full of errors is how a genuine fetch failure gets overlooked) and it is the reason to
        // return here rather than rely on the layer below. Verified by removing the gate: this test
        // fails, the other two do not.
        const errs = [];
        const orig = console.error;
        console.error = (...a) => errs.push(a.join(' '));
        try {
            let rendered = 0;
            await ensureOverridesCached(2026, 7, () => { rendered++; });
            assert.equal(calls.server, 0, 'month navigation fetched overrides while locked');
            assert.equal(rendered, 0);
            assert.deepEqual(errs, [], 'a locked month navigation logged an error');
        } finally { console.error = orig; }
    });

    test('a month touched while LOCKED is not left claimed — it fetches after unlocking', async () => {
        // The gate returns BEFORE `fetchedMonths.add`. Without that ordering, a swipe made while
        // locked would mark the month fetched, and the real read after unlocking would be skipped
        // for the rest of the session — a month permanently stuck on the base roster.
        await ensureOverridesCached(2026, 7, () => {});
        setOverrideAccess(true);
        await ensureOverridesCached(2026, 7, () => {});
        assert.equal(calls.server, 1, 'the month was claimed while locked and never fetched');
    });

    test('Team View reaches Firestore through this same function, so it cannot bypass the gate', () => {
        // Structural, not behavioural: since v18.76 the Team Week View has no fetch of its own and
        // is handed `ensureOverridesCached`. Asserting that keeps the gate's coverage honest — a
        // second fetch path re-introduced there would be invisible to every test above.
        //
        // Both halves are read from the SOURCE (test audit, 7 Nov 2026). This test used to assert
        // only `typeof ensureOverridesCached === 'function'`, which cannot fail: handing Team View a
        // wrapper that read `getDocsFromCache` itself left every suite green.
        //
        // 1. The coordinator hands Team View the very binding it imported from this module. A
        //    wrapper in its place could read the cache before the gate is asked.
        const app = read('calendar-app.js');
        assert.match(app, /^import \{[^}]*\bensureOverridesCached\b[^}]*\} from '\.\/calendar-overrides\.js';$/m,
            'calendar-app.js no longer imports ensureOverridesCached from calendar-overrides.js');
        const entry = _callArgEntries(app, 'initTeamView(').find(p => /^ensureOverridesCached\b/.test(p));
        assert.ok(entry, 'initTeamView is no longer handed ensureOverridesCached — where does Team View read overrides now?');
        assert.match(entry, /^ensureOverridesCached(\s*:\s*ensureOverridesCached)?$/,
            `Team View must be handed the imported ensureOverridesCached itself, not "${entry}" — `
            + 'anything else can reach Firestore without passing through this gate');

        // 2. Team View cannot reach Firestore on its own: nothing it imports, statically or lazily,
        //    leads to the Firebase client or the SDK.
        const { modules, external } = _importClosure('calendar-team-view.js');
        assert.ok(modules.has('calendar-data-state.js'), 'guard: the walk must actually follow imports');
        assert.ok(!modules.has('firebase-client.js'),
            'calendar-team-view.js now reaches firebase-client.js — a second override read that this gate does not see');
        assert.deepEqual(external, [],
            'calendar-team-view.js now reaches a module outside the app (the Firebase SDK is one) — Team View must not read Firestore itself');
    });
});

/** Source with comments removed, so an import named in a JSDoc example is not counted. */
function _stripComments(/** @type {string} */ src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * The top-level entries of the object literal passed to the ONE call starting `anchor`, e.g.
 * `initTeamView({ a, b: () => ({ c }) })` → `['a', 'b: () => ({ c })']`. Strings are skipped so a
 * brace or comma inside one cannot move the split.
 */
function _callArgEntries(/** @type {string} */ src, /** @type {string} */ anchor) {
    const code = _stripComments(src);
    const at = code.indexOf(`${anchor}{`);
    assert.ok(at !== -1 && code.indexOf(`${anchor}{`, at + 1) === -1, `expected exactly one ${anchor}{ … } call`);
    const entries = [];
    let depth = 0, start = at + anchor.length + 1;
    for (let i = start; i < code.length; i++) {
        const ch = code[i];
        if (ch === "'" || ch === '"' || ch === '`') {
            for (i++; i < code.length && code[i] !== ch; i++) if (code[i] === '\\') i++;
        } else if ('({['.includes(ch)) depth++;
        else if (')]'.includes(ch) || (ch === '}' && depth > 0)) depth--;
        else if (ch === '}' || (ch === ',' && depth === 0)) {
            entries.push(code.slice(start, i).trim());
            if (ch === '}') return entries.filter(Boolean);
            start = i + 1;
        }
    }
    assert.fail(`${anchor}{ … } never closed`);
}

/** Every local module `entry` reaches through static, side-effect and dynamic imports, and every
 *  non-local specifier met on the way (a CDN URL, a bare package). */
function _importClosure(/** @type {string} */ entry) {
    const modules = new Set(), external = [];
    const queue = [entry];
    while (queue.length) {
        const f = /** @type {string} */ (queue.shift());
        if (modules.has(f)) continue;
        modules.add(f);
        const code = _stripComments(read(f));
        for (const re of [/from\s+['"]([^'"]+)['"]/g, /^\s*import\s+['"]([^'"]+)['"]/gm, /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g]) {
            for (const [, spec] of code.matchAll(re)) {
                if (!spec.startsWith('./')) { external.push(`${f} → ${spec}`); continue; }
                const next = spec.slice(2);
                assert.ok(existsSync(new URL(`./${next}`, import.meta.url)), `${f} imports ${spec}, which does not exist`);
                queue.push(next);
            }
        }
    }
    return { modules, external };
}

describe('ACCESS LOST MID-SESSION — month navigation is the likely path, not the initial fetch', () => {
    // Found by the v20.15 bug sweep. The initial fetch had an access-lost recovery from the start;
    // `ensureOverridesCached` — which is what month navigation and Team View actually use — had
    // none. So an expiry after page load rendered the month from the BASE ROSTER with a line in the
    // console and nothing on screen: somebody shown a shift they are not working.
    //
    // It is not a theoretical trigger. Revoking the shared viewer's refresh tokens is a documented
    // step of rotating the staff PIN, and it lands exactly here on every viewer's next navigation.

    test('a permission-denied month fetch SHUTS THE GATE, forgets what was known and calls the handler', async () => {
        setOverrideAccess(true);
        // A month read while access held, so there is something to forget. Without it the forget
        // below could be deleted with this test green, and was (test audit, 7 Nov 2026): a month
        // still known `authoritative` after the session lost its right to read it would draw that
        // roster again the moment anything re-rendered it.
        await ensureOverridesCached(2026, 2, () => {});
        assert.equal(knowledgeOf(monthKey(2026, 2)), 'authoritative', 'guard: the earlier month must be known first');
        let lost = 0;
        setOverrideAccessLostHandler(() => { lost++; });
        calls.serverError = Object.assign(new Error('denied'), { code: 'permission-denied' });

        await ensureOverridesCached(2026, 3, () => {});
        assert.equal(lost, 1, 'the access-lost handler was not called');
        assert.equal(hasOverrideAccess(), false,
            'the gate stayed OPEN — a later render could still paint from the local cache');
        assert.equal(knowledgeOf(monthKey(2026, 2)), 'unknown',
            'a month read under the lost access is still known — it would be drawn as current');
        setOverrideAccessLostHandler(null);
        calls.serverError = null;
    });

    test('SHUTTING the gate forgets what every month knew — whichever route shut it (cal-data-6)', async () => {
        // The first load's read and its chip's retry lose access through the coordinator's wrapper,
        // which shuts the gate and nothing else; only the month read above forgot beside it. A month
        // still known after the lock was drawn as current by the next grant — and stayed current when
        // that grant's own read failed.
        setOverrideAccess(true);
        await ensureOverridesCached(2026, 5, () => {});
        assert.equal(knowledgeOf(monthKey(2026, 5)), 'authoritative', 'guard: a month must be known first');
        setOverrideAccess(false);
        assert.equal(knowledgeOf(monthKey(2026, 5)), 'unknown', 'shutting the gate kept a month known as current');
    });

    test('an ORDINARY network failure does NOT re-lock — that would be a loop nobody can win', async () => {
        // The whole point of separating these: an offline blip must keep the last-good calendar and
        // the retry chip. Re-locking on it would demand a PIN from someone whose PIN is fine.
        setOverrideAccess(true);
        let lost = 0;
        setOverrideAccessLostHandler(() => { lost++; });
        calls.serverError = Object.assign(new Error('unavailable'), { code: 'unavailable' });

        await ensureOverridesCached(2026, 4, () => {});
        assert.equal(lost, 0, 'a network failure was treated as an access failure');
        assert.equal(hasOverrideAccess(), true, 'a network blip closed the access gate');
        setOverrideAccessLostHandler(null);
        calls.serverError = null;
    });

    test('a refusal from an EARLIER grant does not re-lock the grant that replaced it (v24.56)', async () => {
        // The PIN rotates, a read issued under the old token is still in flight, the viewer
        // re-enters the PIN — and then the old read's refusal arrives. It said "access has
        // expired" straight after a correct PIN, and dropped the new grant's claim on the month.
        setOverrideAccess(true);
        let lost = 0;
        setOverrideAccessLostHandler(() => { lost++; });
        /** @type {() => void} */ let land = () => {};
        /** @type {any} */ (calls).serverWait = new Promise(r => { land = () => r(undefined); });
        calls.serverError = Object.assign(new Error('denied'), { code: 'permission-denied' });
        const stale = ensureOverridesCached(2026, 7, () => {});
        /** @type {any} */ (calls).serverWait = null;
        calls.serverError = null;
        setOverrideAccess(false);
        setOverrideAccess(true);              // the re-unlock
        land();
        await stale;
        assert.equal(lost, 0, 'an old grant\'s refusal re-locked the new one');
        assert.equal(hasOverrideAccess(), true);
        setOverrideAccessLostHandler(null);
    });

    test('the local sentinel counts as an access failure too', async () => {
        // `fetchOverridesForRange` throws `calendar-access-required` when the gate is already shut.
        // It arrives by a different route from Firestore's `permission-denied` and means the same
        // thing to the member, so both must reach the same recovery.
        setOverrideAccess(false);
        let lost = 0;
        setOverrideAccessLostHandler(() => { lost++; });
        // The gate short-circuits ensureOverridesCached before the fetch, so drive the throw
        // directly through the authoritative read the way a stale caller would.
        const err = await fetchOverridesForRange('2026-05-01', '2026-05-31').then(() => null, (/** @type {any} */ e) => e);
        assert.match(String(err?.message), /calendar-access-required/, 'the shut gate must refuse with its sentinel');
        // What the name says, asserted (test audit, 7 Nov 2026). This used to check only that the
        // handler was NOT called, which is true of every error this read throws. The callers'
        // recovery is keyed on `isAccessFailure`, whose own tests hand it a built `{ code }` — and
        // the error this read really throws carries the sentinel in its MESSAGE. So the real error
        // goes through the real classifier here.
        assert.equal(isAccessFailure(err), true,
            'the shut gate\'s own error is not recognised as an access failure — its callers would offer a retry that cannot win');
        setOverrideAccessLostHandler(null);
        assert.equal(lost, 0, 'the read itself fires no handler — its callers do, through isAccessFailure');
    });
});


// ── THERE IS ONE KIND OF GRANT (the provisional scope, retired 26 Sep 2026) ─────────────────────
//
// From v22.97 a grant could carry a member SCOPE: a returning member's own rows, read out of the
// cache before Firebase confirmed who they were. It was retired by owner decision (DECISIONS.md →
// "The provisional paint"), and both defects it shipped lived in the gap between a scoped and an
// unscoped grant — a scoped hit marked months known for everyone. So what is pinned now is that the
// gap cannot come back quietly: a granted cache read is the whole window, never one member's slice.
describe('a grant is never scoped to one member', () => {
    test('the cached read carries no member filter, whatever a stale caller passes', async () => {
        cacheDocs = [OVERRIDE];
        // A caller still passing the retired option must get the ordinary grant, not a narrowed one.
        /** @type {any} */ (setOverrideAccess)(true, { provisionalMember: 'G. Miller' });
        wheres = [];
        await fetchOverridesForRangeFromCache('2026-07-01', '2026-07-31');
        assert.equal(calls.cache, 1, 'guard: the cache read must actually have run');
        assert.deepEqual(wheres.filter(w => w[0] === 'memberName'), [],
            'a granted cache read was scoped to one member — the provisional paint is back');
    });
});
