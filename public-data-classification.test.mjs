/**
 * public-data-classification.test.mjs — what may be shipped in a WORLD-READABLE file.
 * Run: node --test public-data-classification.test.mjs   (part of `npm run test:hygiene`)
 *
 * @nodeps-safe — runs on a bare checkout with nothing installed.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * `roster-data.js` is served to anyone who asks. Measured 4 Sep 2026 against the live site with no
 * session, no PIN and no token: 53 named staff with their roster type and cycle position, five start
 * dates and nine leave entitlements, plus `roster-cycle-data.js` carrying the patterns those numbers
 * index into. Together they let a stranger compute any named member's shift for any date.
 *
 * **That is a deliberate classification, not a leak** (owner, 4 Sep 2026): shift patterns are on the
 * station's own printed rosters and staff share them freely, so the base roster is not confidential.
 * The reasoning and the measurement live in `AUTH_PLAN.md` §2, which is the authority; this file is
 * the part a document cannot do.
 *
 * ── WHAT IT ACTUALLY GUARDS ─────────────────────────────────────────────────────────────────────
 *
 * Not the decision — the BLAST RADIUS of the decision. A classification is made once, about the
 * fields that existed on the day it was made, and then the file goes on accepting new ones. The
 * failure is not somebody publishing a phone number on purpose; it is somebody adding `mobile` or
 * `homeStation` or `payGrade` to a member record for a good reason, never learning that the file is
 * world-readable, and shipping it in the same commit. Nothing would fail. Nothing would say a word.
 * An external reviewer found the gap in the DOCUMENT this time — the next field would not be in a
 * document at all.
 *
 * So the allowlist below is the thing with teeth: a field nobody has classified fails here, and the
 * only way past is to decide, in the open, that the new field may be public too.
 *
 * **It cannot check VALUES**, only field names — `name` is allowed, and nothing here stops somebody
 * putting a home address in it. That is not a hole this test can close, and pretending otherwise
 * would be worse than saying so.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { teamMembers } from './roster-data.js';

/**
 * Every field a `teamMembers` entry may carry, each classified as safe to publish.
 *
 * ADDING A FIELD IS A DECISION, NOT A FORMALITY. Ask what a stranger learns from it, then add it
 * here with the answer. If the answer is "something they should not know", it does not belong in
 * this file at all — it belongs in Firestore behind a claim, like `staffContact` (the work email,
 * which is readable only by its owner and the admin, and is deliberately NOT here).
 */
const PUBLIC_MEMBER_FIELDS = /** @type {const} */ ({
    name:          'The display name, in the form staff already use on a printed roster.',
    role:          'CEA / CES / Dispatcher / Management — the grade, which the roster prints.',
    rosterType:    'Which shift pattern they follow. The patterns themselves are public too.',
    currentWeek:   'Where in that pattern they sit. Meaningless without the pattern, and both are public.',
    hidden:        'A display flag — leavers and management rows the picker does not offer.',
    managerOnly:   'A display flag — a login-capable account with no roster of its own.',
    startDate:     'When their roster begins. On the printed roster as the week they first appear.',
    noProRate:     'A pay flag for a secondment return. Carries no figure.',
    proRatedAL:    'A joining year’s leave entitlement in days. A number of days off, not pay.',
    rosterChanges: 'Scheduled moves between patterns — dates and pattern names, nothing personal.',
    permanentShift:'Forces an early/late badge. A display hint.',
    bilingualContract: 'Whether this CEA holds a bilingual contract, which carries 34 days\u2019 '
        + 'leave rather than 32. A contractual grade, not a language skill and not a health or '
        + 'personal fact \u2014 the same class of thing as `role`, which is already public. It '
        + 'cannot be derived from `rosterType`: a CEA on a plain contract is routinely placed on '
        + 'a bilingual line until a CEA one frees up.',
});

describe('roster-data.js is world-readable, so what it carries is a decision', () => {
    test('every field shipped in teamMembers has been classified as public', () => {
        const seen = new Set();
        for (const m of teamMembers) Object.keys(m).forEach(k => seen.add(k));
        const unclassified = [...seen].filter(k => !(k in PUBLIC_MEMBER_FIELDS)).sort();
        assert.deepEqual(unclassified, [],
            `roster-data.js ships to anyone who asks — no session, no PIN (AUTH_PLAN.md §2). These `
            + `fields are not in the public classification list:\n    ${unclassified.join(', ')}\n`
            + 'Decide whether a stranger may read them. If yes, add each to PUBLIC_MEMBER_FIELDS '
            + 'with a one-line reason. If no, it belongs in Firestore behind a claim, not in this file.');
    });

    test('and the list has not drifted into naming fields nobody ships', () => {
        // A stale allowlist is how the guard loosens without anybody deciding to loosen it: an entry
        // left behind after a field is removed silently re-permits it years later. `permanentShift`
        // is the one deliberate exception — it is documented in CLAUDE.md's field reference and no
        // current member uses it, so it is allowed to sit here unused.
        const seen = new Set();
        for (const m of teamMembers) Object.keys(m).forEach(k => seen.add(k));
        const unused = Object.keys(PUBLIC_MEMBER_FIELDS)
            .filter(k => !seen.has(k) && k !== 'permanentShift');
        assert.deepEqual(unused, [],
            `PUBLIC_MEMBER_FIELDS permits fields no member carries: ${unused.join(', ')}. `
            + 'Remove them, so the list keeps describing what is actually published.');
    });

    test('the fields deliberately kept OUT stay out', () => {
        // Named rather than implied. Each of these has a real home behind a claim, and each is the
        // shape of thing somebody would reasonably reach for when adding to a member record.
        const NEVER = ['workEmail', 'email', 'phone', 'mobile', 'address', 'homeStation',
                       'password', 'uid', 'payRate', 'salary', 'nino', 'dob', 'dateOfBirth'];
        const seen = new Set();
        for (const m of teamMembers) Object.keys(m).forEach(k => seen.add(k));
        for (const k of NEVER) {
            assert.ok(!seen.has(k),
                `teamMembers carries "${k}", which is served to anyone who asks. The work email `
                + 'lives in the `staffContact` collection, readable only by its owner and the admin '
                + '— that is the pattern to follow.');
        }
    });
});
