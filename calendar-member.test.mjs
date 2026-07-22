/**
 * Unit tests for calendar-member.js — team member selection logic.
 * Run: node --experimental-test-module-mocks --test calendar-member.test.mjs
 *
 * Tests stale-member detection, session-based auto-selection, hidden-member
 * filtering, and validateTeamMembers shape checks.
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
    getCurrentMember, validateTeamMembers,
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
