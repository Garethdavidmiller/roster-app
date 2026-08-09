// calendar-data-state.test.mjs — the Calendar's override-knowledge model.
//
// Organised around the two failure directions rather than around the functions, because a
// per-function suite would pass on exactly the code that produced the v20.32 bug:
//
//   showing too much  — a base roster presented as current when nobody has read the overrides.
//                       This is the shipped defect. A member on annual leave sees the shift they
//                       are not working, drawn in the app's own style with nothing to suggest
//                       anything is outstanding.
//
//   showing too little — a grid hidden behind a wait state that never clears, on a device holding
//                       perfectly good cached data. This is the failure a hasty fix produces, and
//                       it is why `cached` exists as its own state rather than being lumped in
//                       with `unknown`.
//
// Pure module: no DOM, no Firebase, no mocks. Part of test:hygiene.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { noteKnowledge, forget, knowledgeOf, worstKnowledge, decideDisplay, _reset }
    from './calendar-data-state.js';

const JAN = '2026-0', FEB = '2026-1', MAR = '2026-2';

beforeEach(() => _reset());

describe('the default is UNKNOWN, and unknown is not clear', () => {
    test('a month nobody has looked at is unknown', () => {
        assert.equal(knowledgeOf(JAN), 'unknown');
    });

    test('unknown never renders a grid — this is the shipped bug, asserted directly', () => {
        // The old code treated "no cached override document" as "no override exists" and drew the
        // base roster. That is the one outcome this module exists to prevent.
        assert.equal(decideDisplay('unknown'), 'loading');
    });
});

describe('the four states map to four different answers', () => {
    test('each state has its own outcome — none is a synonym for another', () => {
        assert.equal(decideDisplay('authoritative'), 'render');
        assert.equal(decideDisplay('cached'), 'stale');
        assert.equal(decideDisplay('error'), 'unavailable');
        assert.equal(decideDisplay('unknown'), 'loading');
        // Four distinct outcomes. Collapsing any pair loses something a person needs: the staleness
        // label, or the retry, or the distinction between "wait" and "this failed".
        assert.equal(new Set(['authoritative', 'cached', 'error', 'unknown'].map(decideDisplay)).size, 4);
    });

    test('only an authoritative read may be presented as current', () => {
        for (const k of ['unknown', 'cached', 'error']) {
            assert.notEqual(decideDisplay(/** @type {any} */ (k)), 'render',
                `${k} must not render as current — only an authoritative read may`);
        }
    });

    test('a cached month still shows its grid, because hiding good data is its own failure', () => {
        // The over-correction guard. A device with cached data and no network must not be reduced
        // to a spinner — it has a previously-known effective roster, which beats nothing.
        assert.equal(decideDisplay('cached'), 'stale');
        assert.notEqual(decideDisplay('cached'), 'loading');
    });
});

describe('knowledge is monotonic, because these fetches race', () => {
    test('a late cached result cannot walk an authoritative month backwards', () => {
        // The boot fetch, a navigation fetch and a manual retry can all be outstanding at once and
        // settle in any order. A late `cached` landing after `authoritative` must not re-hide a
        // grid the user is already reading.
        noteKnowledge(JAN, 'authoritative');
        noteKnowledge(JAN, 'cached');
        assert.equal(knowledgeOf(JAN), 'authoritative');
    });

    test('a late error cannot demote a month that has since succeeded', () => {
        noteKnowledge(JAN, 'authoritative');
        noteKnowledge(JAN, 'error');
        assert.equal(knowledgeOf(JAN), 'authoritative',
            'a stale failure must not unseat a newer success — the retry already won');
    });

    test('but knowledge does improve: unknown → cached → authoritative all take', () => {
        assert.equal(knowledgeOf(JAN), 'unknown');
        noteKnowledge(JAN, 'cached');        assert.equal(knowledgeOf(JAN), 'cached');
        noteKnowledge(JAN, 'authoritative'); assert.equal(knowledgeOf(JAN), 'authoritative');
    });

    test('error outranks unknown, so a failed month keeps its retry', () => {
        // Both mean "not current", but only one is actionable. If a later no-op could downgrade a
        // failed month to `unknown`, its Retry would silently become a wait state.
        noteKnowledge(JAN, 'error');
        noteKnowledge(JAN, 'unknown');
        assert.equal(knowledgeOf(JAN), 'error');
        assert.equal(decideDisplay(knowledgeOf(JAN)), 'unavailable');
    });

    test('forget is the ONE legitimate downgrade, and it is explicit', () => {
        // Used when access is lost: continuing to show a roster the session may no longer read is
        // worse than showing nothing.
        noteKnowledge(JAN, 'authoritative');
        forget(JAN);
        assert.equal(knowledgeOf(JAN), 'unknown');
    });

    test('forget with no argument clears everything', () => {
        noteKnowledge([JAN, FEB, MAR], 'authoritative');
        forget();
        assert.equal(worstKnowledge([JAN, FEB, MAR]), 'unknown');
    });
});

describe('a view is only as trustworthy as its least-known month', () => {
    test('a week straddling a known and an unknown month is not known', () => {
        // Team View's actual shape. Returning the BEST knowledge — or the first month's — would let
        // a half-known week render as settled, which is the same defect one surface over.
        noteKnowledge(JAN, 'authoritative');
        assert.equal(worstKnowledge([JAN, FEB]), 'unknown');
        assert.equal(decideDisplay(worstKnowledge([JAN, FEB])), 'loading');
    });

    test('all-authoritative months render; one error spoils the range', () => {
        noteKnowledge([JAN, FEB], 'authoritative');
        assert.equal(worstKnowledge([JAN, FEB]), 'authoritative');
        noteKnowledge(FEB, 'error');
        // FEB was already authoritative, so the monotonic rule protects it — the range stays good.
        assert.equal(worstKnowledge([JAN, FEB]), 'authoritative');
        // A month that has NEVER succeeded does spoil it.
        assert.equal(worstKnowledge([JAN, FEB, MAR]), 'unknown');
    });

    test('a cached month drags an authoritative range down to stale, not to loading', () => {
        noteKnowledge(JAN, 'authoritative');
        noteKnowledge(FEB, 'cached');
        assert.equal(worstKnowledge([JAN, FEB]), 'cached');
        assert.equal(decideDisplay(worstKnowledge([JAN, FEB])), 'stale');
    });

    test('an empty range is unknown, not vacuously authoritative', () => {
        // `[].reduce` with an optimistic seed is the classic way this goes wrong: no months would
        // report as fully known, and a bug that produced an empty range would render confidently.
        assert.equal(worstKnowledge([]), 'unknown');
    });
});

describe('noteKnowledge takes one key or many', () => {
    test('the three-month boot fetch marks its whole window in one call', () => {
        noteKnowledge([JAN, FEB, MAR], 'authoritative');
        assert.equal(worstKnowledge([JAN, FEB, MAR]), 'authoritative');
    });

    test('a single key works without wrapping it in an array', () => {
        noteKnowledge(JAN, 'cached');
        assert.equal(knowledgeOf(JAN), 'cached');
    });
});
