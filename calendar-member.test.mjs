/**
 * Unit tests for calendar-member.js — team member selection logic.
 * Run: node --experimental-test-module-mocks --test calendar-member.test.mjs
 *
 * Tests stale-member detection, session-based auto-selection, hidden-member
 * filtering on BOTH sides (the saved-name lookup and the dropdown the page builds),
 * and validateTeamMembers shape checks.
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
let _session = null;

const FAKE_MEMBERS = [
    { name: 'A. Smith', currentWeek: 1, role: 'CEA',        rosterType: 'main' },
    { name: 'B. Jones', currentWeek: 2, role: 'CES',        rosterType: 'ces'  },
    { name: 'C. Brown', currentWeek: 1, role: 'Dispatcher', rosterType: 'dispatcher', hidden: true },
];

// The LIVE roster and the REAL entitlement rule, reached past the mock below: `mock.module` keys on
// the resolved module URL, so `?real` is a different module and is not intercepted, and this import
// runs before any mock is registered. The dropdown tests need both — what the filter has to remove
// is a property of the roster people are actually on, and what removing it would expose is a
// property of `getALEntitlement`. A fixture could state neither.
const { teamMembers: LIVE_MEMBERS, getALEntitlement: realGetALEntitlement } =
    await import('./roster-data.js?real');

mock.module('./ls.js', {
    namedExports: {
        lsGet: k      => (store.has(k) ? store.get(k) : null),
        lsSet: (k, v) => { store.set(k, String(v)); },
        lsDel: k      => { store.delete(k); },
    },
});
mock.module('./session.js', {
    namedExports: {
        getSession:     () => _session,
        AUTH_KEY:       'myb_auth',
        sessionReady:   Promise.resolve(true),
        resolveSession: () => {},
        saveSession:    () => {},
        clearSession:   () => {},
        getSurname:     () => null,
    },
});
mock.module('./roster-data.js', {
    namedExports: {
        CONFIG:      { DEFAULT_MEMBER_NAME: 'A. Smith' },
        teamMembers: FAKE_MEMBERS,
    },
});

const {
    takeStaleMemberName, getDefaultMemberIndex,
    getSelectedMemberIndex, saveSelectedMember,
    getCurrentMember, validateTeamMembers, populateTeamMemberDropdown,
    isFirstRun, _resetSelectionFallbackForTest,
} = await import('./calendar-member.js');

const MEMBER_KEY = 'myb_roster_selected_member';

beforeEach(() => {
    store.clear();
    _session = null;
    takeStaleMemberName();               // clear any stale name left by the previous test
    _resetSelectionFallbackForTest();   // clear the in-memory selection backstop between tests
});

// ── getDefaultMemberIndex ─────────────────────────────────────────────────────

describe('getDefaultMemberIndex', () => {
    test('returns the index of DEFAULT_MEMBER_NAME in teamMembers', () => {
        assert.equal(getDefaultMemberIndex(), 0);   // 'A. Smith' is at index 0
    });
});

// ── takeStaleMemberName ───────────────────────────────────────────────────────

describe('takeStaleMemberName', () => {
    test('returns null when no stale detection has occurred', () => {
        assert.equal(takeStaleMemberName(), null);
    });

    test('returns the stale name after a failed saved-name lookup', () => {
        store.set(MEMBER_KEY, 'Z. Nobody');    // name not in roster
        getSelectedMemberIndex();              // triggers stale detection
        assert.equal(takeStaleMemberName(), 'Z. Nobody');
    });

    test('is consumed on first call — subsequent calls return null', () => {
        store.set(MEMBER_KEY, 'Z. Nobody');
        getSelectedMemberIndex();
        takeStaleMemberName();                 // consume
        assert.equal(takeStaleMemberName(), null);
    });

    test('clears the saved localStorage key when a stale name is detected', () => {
        store.set(MEMBER_KEY, 'Z. Nobody');
        getSelectedMemberIndex();
        assert.equal(store.get(MEMBER_KEY), undefined);   // lsDel was called
    });
});

// ── getSelectedMemberIndex ────────────────────────────────────────────────────

describe('getSelectedMemberIndex', () => {
    test('returns the index of a valid saved member name', () => {
        store.set(MEMBER_KEY, 'B. Jones');
        assert.equal(getSelectedMemberIndex(), 1);
    });

    test('treats a hidden saved member as not-found, falls back to default', () => {
        // C. Brown is hidden: true — teamMembers.findIndex skips hidden members.
        store.set(MEMBER_KEY, 'C. Brown');
        const idx = getSelectedMemberIndex();
        assert.equal(idx, 0);   // default
    });

    test('falls back to default and sets stale name when saved name is not in roster', () => {
        store.set(MEMBER_KEY, 'Z. Nobody');
        const idx = getSelectedMemberIndex();
        assert.equal(idx, 0);
        assert.equal(takeStaleMemberName(), 'Z. Nobody');
    });

    test('auto-selects the session member when no saved name is stored', () => {
        _session = { name: 'B. Jones' };
        assert.equal(getSelectedMemberIndex(), 1);
    });

    test('session-based selection persists the choice to localStorage', () => {
        _session = { name: 'B. Jones' };
        getSelectedMemberIndex();
        assert.equal(store.get(MEMBER_KEY), 'B. Jones');
    });

    test('session member that is hidden is not auto-selected (falls back to default)', () => {
        _session = { name: 'C. Brown' };   // hidden
        assert.equal(getSelectedMemberIndex(), 0);
    });

    test('falls back to default when no saved name and no session', () => {
        assert.equal(getSelectedMemberIndex(), 0);
    });
});

// ── saveSelectedMember ────────────────────────────────────────────────────────

describe('saveSelectedMember', () => {
    test('writes the member name to localStorage', () => {
        saveSelectedMember(1);   // B. Jones
        assert.equal(store.get(MEMBER_KEY), 'B. Jones');
    });

    test('out-of-range index does not write to localStorage', () => {
        saveSelectedMember(99);
        assert.equal(store.get(MEMBER_KEY), undefined);
    });
});

// ── isFirstRun (first-run onboarding, H1) ─────────────────────────────────────

describe('isFirstRun', () => {
    // Note: the _hadSavedMemberAtStart (module-load snapshot) axis can't vary within a single
    // module instance, so it's covered by the e2e suite. These test the two runtime axes plus
    // the in-memory selection backstop.
    test('true for a brand-new visitor: no saved member, no session, nothing picked', () => {
        assert.equal(isFirstRun(), true);
    });

    test('false when a saved member name is present', () => {
        store.set(MEMBER_KEY, 'B. Jones');
        assert.equal(isFirstRun(), false);
    });

    test('false when a signed-in session is present', () => {
        _session = { name: 'B. Jones' };
        assert.equal(isFirstRun(), false);
    });

    test('false after a name is picked, even if the localStorage write did not persist', () => {
        // Simulate iOS private mode: saveSelectedMember records the in-memory backstop, then we
        // clear the store to mimic lsSet() having silently no-opped. isFirstRun must stay false.
        saveSelectedMember(1);
        store.clear();
        assert.equal(isFirstRun(), false);
    });
});

// ── in-memory selection backstop (private-mode fix) ───────────────────────────

describe('getSelectedMemberIndex — in-memory backstop', () => {
    test('returns the picked index even when the localStorage write did not persist', () => {
        // iOS private mode: lsSet no-ops, so no saved name — the backstop must still return the pick.
        saveSelectedMember(1);   // B. Jones
        store.clear();           // mimic the failed persist
        assert.equal(getSelectedMemberIndex(), 1);
    });
});

// ── getCurrentMember ──────────────────────────────────────────────────────────

describe('getCurrentMember', () => {
    test('returns the member object for the selected index', () => {
        store.set(MEMBER_KEY, 'B. Jones');
        const m = getCurrentMember();
        assert.equal(m.name, 'B. Jones');
    });
});

// ── validateTeamMembers ───────────────────────────────────────────────────────

describe('validateTeamMembers', () => {
    test('returns no errors for the valid FAKE_MEMBERS fixture', () => {
        assert.deepEqual(validateTeamMembers(), []);
    });
});

// ── THE PICKER MAY ONLY OFFER PEOPLE WHO ARE ON THE ROSTER ─────────────────────────────────────
//
// One expression builds the list — `.filter(({ member }) => !member.hidden)` — and `hidden` is
// carrying two different jobs at once on the live roster: LEAVERS, and MANAGEMENT accounts that
// exist to sign in and have no rota of their own. Deleting it offers both to everybody, and the two
// costs are different:
//
//   A LEAVER REAPPEARS in fifty pickers, with a roster the app happily projects forward from their
//   last known cycle position. Nothing errors; it reads as a colleague still on the books.
//
//   A MANAGEMENT ROW REACHES `getALEntitlement`'s null branch — the one CLAUDE.md describes as
//   "not reachable today… because every Management row carries `hidden: true`". That is a guard
//   whose entire safety argument is that nobody can get to it, and THIS LINE is the argument. The
//   branch exists because the fall-through it replaced handed such a row a CEA's 32 days: a
//   complete, plausible leave figure belonging to somebody else. So the filter is not a tidiness
//   rule about who appears in a list — it is what makes a documented reachability claim true.
//
//   The cheap direction, for contrast, is REFUSING somebody who is on the roster: their own name is
//   missing from their own picker, which is loud, immediate and reported the same day.
//
// The fixture cases run on FAKE_MEMBERS; the ones that matter run on the LIVE roster, swapped into
// the same array the module reads, so a hiring or a leaver cannot turn an assertion into a
// tautology. (Measured when written: 54 rows, 10 of them hidden.)
describe('populateTeamMemberDropdown — who the picker offers', () => {
    /** Minimal element: enough for `innerHTML = ''`, `appendChild`, and the fields the module sets. */
    function makeEl(tag) {
        const el = {
            _tag: tag, _children: [],
            value: '', textContent: '', label: '', selected: false, disabled: false,
            appendChild(c) { this._children.push(c); return c; },
        };
        Object.defineProperty(el, 'innerHTML', {
            get() { return ''; },
            set(_v) { el._children.length = 0; },     // the module clears the list this way
        });
        return el;
    }

    /** Build the real dropdown against a fake document; return the flat `<option>` list. */
    function buildDropdown() {
        const select = makeEl('select');
        global.document = {
            getElementById: id => (id === 'teamMemberSelect' ? select : null),
            createElement: tag => makeEl(tag),
        };
        populateTeamMemberDropdown();
        /** @type {any[]} */
        const options = [];
        const walk = node => node._children.forEach(c => (c._tag === 'option' ? options.push(c) : walk(c)));
        walk(select);
        return { select, options };
    }

    /** Run `fn` with `members` standing in for the roster — same array object the module reads. */
    function withRoster(members, fn) {
        const saved = FAKE_MEMBERS.slice();
        FAKE_MEMBERS.length = 0;
        FAKE_MEMBERS.push(...members);
        try { return fn(); } finally {
            FAKE_MEMBERS.length = 0;
            FAKE_MEMBERS.push(...saved);
        }
    }

    /** The names the picker offers — what the reader can actually choose. */
    const offeredNames = () => buildDropdown().options
        .map(o => o.textContent)
        .filter(name => name !== '— Choose your name —');

    describe('never offers somebody who is not on the roster', () => {
        test('a hidden member is absent from the list — not merely unselected', () => {
            assert.deepEqual(offeredNames(), ['A. Smith', 'B. Jones']);   // C. Brown is hidden: true
        });

        test('the live roster: every hidden row is filtered out, by name', () => {
            withRoster(LIVE_MEMBERS, () => {
                const offered = new Set(offeredNames());
                const leaked = LIVE_MEMBERS.filter(m => m.hidden && offered.has(m.name))
                    .map(m => `${m.name} (${m.role})`);
                assert.deepEqual(leaked, [],
                    'these rows are hidden and were offered anyway:\n  ' + leaked.join('\n  '));
            });
        });

        test('and the sweep is not vacuous — the live roster really does carry hidden rows', () => {
            assert.ok(LIVE_MEMBERS.some(m => m.hidden),
                'nothing on the roster is hidden, so the filter has nothing to remove and the test '
                + 'above would pass with it deleted — the fixture case still covers the rule');
        });

        test('nobody the entitlement rule cannot answer for can be selected', () => {
            // The reachability claim itself. Every row `getALEntitlement` returns null for must be
            // unreachable through the picker, because a caller that forgets the null test computes
            // `null - taken - booked` — a NUMBER, not NaN, so it renders as a leave balance.
            const unanswerable = LIVE_MEMBERS.filter(m => realGetALEntitlement(m, 2026, []) === null);
            assert.ok(unanswerable.length,
                'precondition: the live roster still has rows with no entitlement on record — if it '
                + 'does not, this test is asserting nothing and the null branch has a new argument');

            withRoster(LIVE_MEMBERS, () => {
                const offered = new Set(offeredNames());
                const reachable = unanswerable.filter(m => offered.has(m.name))
                    .map(m => `${m.name} (${m.role})`);
                assert.deepEqual(reachable, [],
                    'these accounts have no AL entitlement on record and the picker offers them, so '
                    + "CLAUDE.md's \"not reachable today\" no longer holds:\n  " + reachable.join('\n  '));
            });
        });
    });

    describe('and never refuses somebody who is', () => {
        test('the live roster: every visible member is offered, exactly once', () => {
            withRoster(LIVE_MEMBERS, () => {
                const offered = offeredNames();
                const expected = LIVE_MEMBERS.filter(m => !m.hidden).map(m => m.name);
                assert.deepEqual([...offered].sort(), [...expected].sort(),
                    'the picker must offer every visible member and no name twice');
            });
        });

        test('a saved member is the SELECTED option, not merely present', () => {
            store.set(MEMBER_KEY, 'B. Jones');
            const chosen = buildDropdown().options.filter(o => o.selected).map(o => o.textContent);
            assert.deepEqual(chosen, ['B. Jones']);
        });

        test('first run selects no real name — only the placeholder', () => {
            const { options } = buildDropdown();
            assert.equal(options[0].textContent, '— Choose your name —');
            assert.deepEqual(options.filter(o => o.selected).map(o => o.textContent),
                ['— Choose your name —'],
                'a brand-new visitor must not be shown somebody else\'s roster as though it were theirs');
        });
    });
});
