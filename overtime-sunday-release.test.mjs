/**
 * overtime-sunday-release.test.mjs — asking to be taken off a rostered Sunday.
 * Run: node --test overtime-sunday-release.test.mjs   (part of `npm run test:hygiene`)
 *
 * Three conditions decide whether the control is offered at all, and the third — an unknown roster
 * — is the one that would do damage if it went the other way: offering there invites a member to
 * ask to be released from a duty nobody could read.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    offersSundayRelease, releaseRequestLine, SUNDAY_RELEASE_ASKED, SUNDAY_RELEASE_LABEL,
} from './overtime-sunday-release.js';

const SUN = '2026-06-14';   // Sunday
const MON = '2026-06-15';   // Monday
const WORKING = { isRest: false };
const REST    = { isRest: true };

describe('offersSundayRelease', () => {
    test('a Sunday the member is rostered to work — the only yes', () => {
        assert.equal(offersSundayRelease(SUN, WORKING), true);
    });

    test('never on a rest day: there is nothing to be taken off', () => {
        assert.equal(offersSundayRelease(SUN, REST), false);
    });

    test('never on any other weekday, however the day is rostered', () => {
        assert.equal(offersSundayRelease(MON, WORKING), false);
        assert.equal(offersSundayRelease(MON, REST), false);
    });

    test('NEVER WHEN THE ROSTER IS UNKNOWN — the one that matters', () => {
        // A null context is a failed read, not a rest day. Offering here would invite a member to
        // ask to come off a duty that may not exist — the same class of error as offering
        // "Available after 15:00" anchored to a shift nobody could read.
        assert.equal(offersSundayRelease(SUN, null), false);
        assert.equal(offersSundayRelease(SUN, undefined), false);
    });

    test('a context with no isRest field is treated as rostered, not as unknown', () => {
        // `isRest` absent is different from the CONTEXT being absent: the day was read, and nothing
        // said it was a rest day. Withholding here would hide the control on a real duty.
        assert.equal(offersSundayRelease(SUN, {}), true);
    });
});

describe('the wording promises nothing', () => {
    test('the confirmation says who decides and claims no outcome', () => {
        assert.match(SUNDAY_RELEASE_ASKED, /roster team will decide/);
        for (const word of ['approved', 'granted', 'agreed', 'confirmed', 'accepted']) {
            assert.ok(!SUNDAY_RELEASE_ASKED.toLowerCase().includes(word),
                `the confirmation must not read as granted — it says "${word}"`);
            assert.ok(!SUNDAY_RELEASE_LABEL.toLowerCase().includes(word),
                `the label must not read as granted — it says "${word}"`);
        }
    });

    test('the label is an ASK, in the app\'s calm voice', () => {
        assert.match(SUNDAY_RELEASE_LABEL, /^Ask to be taken off/);
        assert.ok(!/[!]/.test(SUNDAY_RELEASE_LABEL + SUNDAY_RELEASE_ASKED), 'no exclamation marks');
    });
});

describe('releaseRequestLine — the reviewer\'s flag', () => {
    test('only when the member actually asked', () => {
        assert.equal(releaseRequestLine({ mode: 'all_day', releaseRequested: true }),
            'Asked to come off this Sunday');
        assert.equal(releaseRequestLine({ mode: 'all_day' }), '');
        assert.equal(releaseRequestLine(null), '');
        assert.equal(releaseRequestLine(undefined), '');
    });

    test('a non-boolean is not a request', () => {
        // The field is written only when true, so anything else is either absent or corrupt; both
        // mean nobody asked, and inventing a request on somebody's behalf is the one thing this
        // feature must never do.
        for (const bad of ['true', 1, {}, []]) {
            assert.equal(releaseRequestLine({ mode: 'all_day', releaseRequested: bad }), '',
                `${JSON.stringify(bad)} must not read as a request`);
        }
    });

    test('it is SEPARATE from the day\'s overtime answer', () => {
        // Invariant 1 of this feature is that two different answers may never be collapsed into
        // one. The request rides beside `answerCopy`, and this function knows nothing about modes.
        assert.equal(releaseRequestLine({ mode: 'unavailable', releaseRequested: true }),
            'Asked to come off this Sunday',
            'an unavailable member can still have asked — the two are independent');
    });
});
