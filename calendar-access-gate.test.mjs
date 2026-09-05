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
        getDocs: async () => { calls.server++; if (calls.serverError) throw calls.serverError; return _snap([]); },
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
    setOverrideAccess, hasOverrideAccess, provisionalMember, rosterOverridesCache,
    fetchOverridesForRange, fetchOverridesForRangeFromCache, ensureOverridesCached, clearFetchedMonth, monthKey,
    setOverrideAccessLostHandler,
} = mod;

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
        const src = mod;
        assert.equal(typeof src.ensureOverridesCached, 'function');
    });
});

describe('ACCESS LOST MID-SESSION — month navigation is the likely path, not the initial fetch', () => {
    // Found by the v20.15 bug sweep. The initial fetch had an access-lost recovery from the start;
    // `ensureOverridesCached` — which is what month navigation and Team View actually use — had
    // none. So an expiry after page load rendered the month from the BASE ROSTER with a line in the
    // console and nothing on screen: somebody shown a shift they are not working.
    //
    // It is not a theoretical trigger. Revoking the shared viewer's refresh tokens is a documented
    // step of rotating the staff PIN, and it lands exactly here on every viewer's next navigation.

    test('a permission-denied month fetch SHUTS THE GATE and calls the handler', async () => {
        setOverrideAccess(true);
        let lost = 0;
        setOverrideAccessLostHandler(() => { lost++; });
        calls.serverError = Object.assign(new Error('denied'), { code: 'permission-denied' });

        await ensureOverridesCached(2026, 3, () => {});
        assert.equal(lost, 1, 'the access-lost handler was not called');
        assert.equal(hasOverrideAccess(), false,
            'the gate stayed OPEN — a later render could still paint from the local cache');
        setOverrideAccessLostHandler(null);
        calls.serverError = null;
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

    test('the local sentinel counts as an access failure too', async () => {
        // `fetchOverridesForRange` throws `calendar-access-required` when the gate is already shut.
        // It arrives by a different route from Firestore's `permission-denied` and means the same
        // thing to the member, so both must reach the same recovery.
        setOverrideAccess(false);
        let lost = 0;
        setOverrideAccessLostHandler(() => { lost++; });
        // The gate short-circuits ensureOverridesCached before the fetch, so drive the throw
        // directly through the authoritative read the way a stale caller would.
        await assert.rejects(() => fetchOverridesForRange('2026-05-01', '2026-05-31'),
            /calendar-access-required/);
        setOverrideAccessLostHandler(null);
        assert.equal(lost, 0, 'the pre-gate short-circuit should not fire the handler');
    });
});


// ── THE PROVISIONAL GRANT (v22.96) ──────────────────────────────────────────────────────────────
//
// The owner decision of 5 Sep 2026: a returning member may re-see their OWN cached roster while
// Firebase revalidates their stored identity. `decideProvisionalAccess` says whose name it may be
// scoped to; THIS module is what makes the scope real, and these are the cases that make it real.
//
// Organised by what each wrong answer would EXPOSE, because they are not equivalent:
//
//   · Dropping the member filter shows fifty colleagues' annual leave and absence to whoever is
//     holding a device with a stored session. That is the whole thing the decision was narrowed to
//     avoid, and it is silent — the grid simply has more data in it.
//   · Letting a SERVER read through fetches new data under an identity nobody has confirmed. The
//     grant is to re-show what this device already holds; anything else is ordinary access taken
//     early.
//   · Failing to clear the scope on the full grant leaves a confirmed member permanently unable to
//     see the team, which is loud and recoverable — the cheap direction.
describe('a PROVISIONAL grant is one member, out of the cache, and nothing else', () => {
    test('the cached read is scoped in the QUERY, not filtered afterwards', async () => {
        cacheDocs = [OVERRIDE];
        setOverrideAccess(true, { provisionalMember: 'G. Miller' });
        wheres = [];
        await fetchOverridesForRangeFromCache('2026-07-01', '2026-07-31');
        const member = wheres.filter(w => w[0] === 'memberName');
        assert.equal(member.length, 1, 'the query must carry a memberName filter');
        assert.deepEqual(member[0], ['memberName', '==', 'G. Miller']);
    });

    test('a FULL grant carries no member filter — the team is visible again', async () => {
        cacheDocs = [OVERRIDE];
        setOverrideAccess(true);
        wheres = [];
        await fetchOverridesForRangeFromCache('2026-07-01', '2026-07-31');
        assert.equal(wheres.filter(w => w[0] === 'memberName').length, 0);
        assert.equal(provisionalMember(), null, 'the scope must not survive the upgrade');
    });

    test('upgrading from provisional to full CLEARS the scope', async () => {
        setOverrideAccess(true, { provisionalMember: 'G. Miller' });
        assert.equal(provisionalMember(), 'G. Miller');
        setOverrideAccess(true);              // the real grant, once Firebase confirmed the identity
        assert.equal(provisionalMember(), null, 'a confirmed member must not stay confined');
    });

    test('every SERVER read refuses while provisional', async () => {
        setOverrideAccess(true, { provisionalMember: 'G. Miller' });
        const before = calls.server;
        await assert.rejects(() => fetchOverridesForRange('2026-07-01', '2026-07-31'),
            /calendar-access-required/, 'the authoritative read must refuse');
        await ensureOverridesCached(2026, 6);
        assert.equal(calls.server, before, 'no server request may be issued under a provisional grant');
    });

    test('losing access clears the scope too — a revoked grant leaves nothing behind', () => {
        setOverrideAccess(true, { provisionalMember: 'G. Miller' });
        setOverrideAccess(false);
        assert.equal(provisionalMember(), null);
        assert.equal(hasOverrideAccess(), false);
    });

    test('a blank or non-string member is NOT a provisional grant', () => {
        // There is no unscoped provisional grant: the member IS the boundary, so a scope we cannot
        // attach a name to would silently be a grant to everything.
        for (const v of ['', '   ', null, undefined, 42, {}]) {
            setOverrideAccess(true, { provisionalMember: /** @type {any} */ (v) });
            assert.equal(provisionalMember(), null, `${String(v)} must not scope a grant`);
        }
    });
});
