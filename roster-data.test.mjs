/**
 * Unit tests for roster-data.js utility functions.
 * Run with: node --test roster-data.test.mjs
 *
 * Uses Node's built-in test runner (no dependencies required).
 * Covers: bank holidays, Easter, paydays, cutoffs, AL entitlement, validation.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    getBankHolidays,
    isBankHoliday,
    isChristmasDay,
    isEasterSunday,
    getPaydaysAndCutoffs,
    isPayday,
    isCutoffDate,
    getALEntitlement,
    projectAnnualLeaveOverage,
    validateRosterPatterns,
    isChristmasRD,
    isEarlyShift,
    isNightShift,
    getShiftKind,
    getShiftClass,
    getShiftBadge,
    shiftBadgeParts,
    getWeekNumberForDate,
    getRosterForMember,
    resolveMemberRoster,
    getBaseShift,
    isSameDay,
    teamMembers,
    computeEaster,
    escapeHtml,
    parseSmartFloat,
    avatarInitials,
    avatarHue,
    getSpecialDayBadges,
    isSunday,
    parseISODate,
    formatISO,
    CONFIG,
    fixedRoster,
    isValidEmail,
    isChilternWorkEmail,
    workEmailLocalPart,
    workEmailFrom,
    getMembersForGrade,
    parseSmartFloatOrNull,
} from './roster-data.js';

describe('isChilternWorkEmail', () => {
    test('accepts a valid Chiltern work email (any case on the domain)', () => {
        assert.equal(isChilternWorkEmail('john.smith@chilternrailways.co.uk'), true);
        assert.equal(isChilternWorkEmail('  John.Smith@ChilternRailways.CO.UK  '), true);
    });
    test('rejects a valid email on the wrong domain', () => {
        assert.equal(isChilternWorkEmail('john.smith@gmail.com'), false);
        assert.equal(isChilternWorkEmail('john@arriva.co.uk'), false);
    });
    test('rejects look-alike and subdomain spoofs', () => {
        assert.equal(isChilternWorkEmail('x@evil-chilternrailways.co.uk'), false);
        assert.equal(isChilternWorkEmail('x@sub.chilternrailways.co.uk'), false);
        assert.equal(isChilternWorkEmail('x@chilternrailways.co.uk.evil.com'), false);
    });
    test('rejects non-emails and non-strings', () => {
        assert.equal(isChilternWorkEmail('notanemail'), false);
        assert.equal(isChilternWorkEmail(''), false);
        assert.equal(isChilternWorkEmail(/** @type {any} */ (null)), false);
    });
    test('uses CONFIG.WORK_EMAIL_DOMAIN as the single source', () => {
        assert.equal(CONFIG.WORK_EMAIL_DOMAIN, 'chilternrailways.co.uk');
        assert.equal(isChilternWorkEmail('a@' + CONFIG.WORK_EMAIL_DOMAIN), true);
    });
});

// The Settings field shows `@chilternrailways.co.uk` beside itself, so it holds the LOCAL
// PART. Organised by what each wrong answer costs, because the two directions are not
// remotely symmetrical:
//
//   SILENTLY CHANGING AN ADDRESS is the dangerous one. Strip any `@…` rather than only our
//   own, and `g.miller@gmail.com` becomes `g.miller`, which the save path then completes
//   into a Chiltern address the member never gave — stored, validated, and pointing at
//   somebody else's mailbox for the account recovery this field exists to enable. Nothing
//   errors; the card says "✓ Saved".
//
//   SHOWING THE DOMAIN TWICE is the reported defect (v22.39 external review) — visible the
//   moment a member with a saved address opens the card, and it costs them a retype.
describe('workEmailLocalPart / workEmailFrom', () => {
    describe('never silently changes an address', () => {
        test('a foreign domain survives the strip, so the validator can refuse it', () => {
            assert.equal(workEmailLocalPart('g.miller@gmail.com'), 'g.miller@gmail.com');
            assert.equal(workEmailFrom('g.miller@gmail.com'),      'g.miller@gmail.com');
            assert.equal(isChilternWorkEmail(workEmailFrom('g.miller@gmail.com')), false);
        });
        test('a look-alike domain is not treated as ours', () => {
            assert.equal(workEmailLocalPart('x@evil-chilternrailways.co.uk'), 'x@evil-chilternrailways.co.uk');
            assert.equal(workEmailLocalPart('x@sub.chilternrailways.co.uk'),  'x@sub.chilternrailways.co.uk');
        });
        test('an empty field saves nothing rather than a bare domain', () => {
            assert.equal(workEmailFrom(''),     '');
            assert.equal(workEmailFrom('   '),  '');
            assert.equal(workEmailFrom(/** @type {any} */ (null)), '');
        });
    });

    describe('never shows the domain twice', () => {
        test('a saved full address loads as the local part', () => {
            assert.equal(workEmailLocalPart('g.miller@chilternrailways.co.uk'), 'g.miller');
        });
        test('autofill in any case is stripped', () => {
            assert.equal(workEmailLocalPart('G.Miller@ChilternRailways.CO.UK'), 'G.Miller');
            assert.equal(workEmailLocalPart('  g.miller@CHILTERNRAILWAYS.CO.UK  '), 'g.miller');
        });
        test('a local part is left alone', () => {
            assert.equal(workEmailLocalPart('g.miller'), 'g.miller');
            assert.equal(workEmailLocalPart(''), '');
            assert.equal(workEmailLocalPart(/** @type {any} */ (undefined)), '');
        });
    });

    describe('the round trip', () => {
        test('full → local → full is the same address', () => {
            for (const e of ['g.miller@chilternrailways.co.uk', 's.silva@chilternrailways.co.uk']) {
                assert.equal(workEmailFrom(workEmailLocalPart(e)), e);
            }
        });
        test('local → full → local is the same local part', () => {
            for (const l of ['g.miller', 'm.robson', "o'brien.x"]) {
                assert.equal(workEmailLocalPart(workEmailFrom(l)), l);
            }
        });
        test('completing a local part produces an address the validator accepts', () => {
            assert.equal(isChilternWorkEmail(workEmailFrom('g.miller')), true);
        });
        test('workEmailFrom is idempotent, so calling it on an autofilled value is safe', () => {
            const once = workEmailFrom('g.miller');
            assert.equal(workEmailFrom(once), once);
        });
        test('both read the domain from CONFIG rather than a literal', () => {
            assert.equal(workEmailFrom('a'), 'a@' + CONFIG.WORK_EMAIL_DOMAIN);
            assert.equal(workEmailLocalPart('a@' + CONFIG.WORK_EMAIL_DOMAIN), 'a');
        });
    });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a local-noon Date to match the app's DST-safe convention. */
const d = (year, month, day) => new Date(year, month - 1, day, 12, 0, 0);

// ---------------------------------------------------------------------------
// Bank holidays
// ---------------------------------------------------------------------------

test('getBankHolidays: returns 8 bank holidays for 2026', () => {
    // England has exactly 8 fixed bank holidays in a standard year.
    assert.equal(getBankHolidays(2026).length, 8);
});

test('getBankHolidays: New Year\'s Day 2026 is 1 Jan (weekday — no substitute)', () => {
    // 1 Jan 2026 is a Thursday.
    const bhs = getBankHolidays(2026);
    const newYear = bhs.find(h => h.getMonth() === 0);
    assert.ok(newYear, 'New Year\'s Day not found');
    assert.equal(newYear.getDate(), 1);
});

test('getBankHolidays: Good Friday 2026 is 3 Apr', () => {
    // Easter Sunday 2026 = 5 Apr → Good Friday = 3 Apr.
    const bhs = getBankHolidays(2026);
    const gf = bhs.find(h => h.getMonth() === 3 && h.getDate() === 3);
    assert.ok(gf, 'Good Friday 3 Apr 2026 not found in bank holidays');
});

test('getBankHolidays: Easter Monday 2026 is 6 Apr', () => {
    const bhs = getBankHolidays(2026);
    const em = bhs.find(h => h.getMonth() === 3 && h.getDate() === 6);
    assert.ok(em, 'Easter Monday 6 Apr 2026 not found in bank holidays');
});

test('getBankHolidays: Summer Bank Holiday 2026 is 31 Aug (last Monday in August)', () => {
    // Aug 31 2026 is a Monday.
    const bhs = getBankHolidays(2026);
    const sbh = bhs.find(h => h.getMonth() === 7);
    assert.ok(sbh, 'Summer Bank Holiday not found');
    assert.equal(sbh.getDate(), 31);
});

test('getBankHolidays: returns empty array for year below MIN_YEAR', () => {
    assert.deepEqual(getBankHolidays(2023), []);
});

test('isBankHoliday: 3 Apr 2026 (Good Friday) is a bank holiday', () => {
    assert.ok(isBankHoliday(d(2026, 4, 3)));
});

test('isBankHoliday: 4 Apr 2026 (Saturday before Easter) is not a bank holiday', () => {
    assert.equal(isBankHoliday(d(2026, 4, 4)), false);
});

// ---------------------------------------------------------------------------
// Christmas and Easter
// ---------------------------------------------------------------------------

test('isChristmasDay: 25 Dec returns true', () => {
    assert.ok(isChristmasDay(d(2026, 12, 25)));
});

test('isChristmasDay: 26 Dec returns false', () => {
    assert.equal(isChristmasDay(d(2026, 12, 26)), false);
});

test('isEasterSunday: 5 Apr 2026 is Easter Sunday', () => {
    assert.ok(isEasterSunday(d(2026, 4, 5)));
});

test('isEasterSunday: 6 Apr 2026 (Easter Monday) is not Easter Sunday', () => {
    assert.equal(isEasterSunday(d(2026, 4, 6)), false);
});

// ---------------------------------------------------------------------------
// Paydays and cutoffs
// ---------------------------------------------------------------------------

test('getPaydaysAndCutoffs: 13 Feb 2026 is a payday (known reference date)', () => {
    // CONFIG.FIRST_PAYDAY = 13 Feb 2026.
    assert.ok(isPayday(d(2026, 2, 13)));
});

test('getPaydaysAndCutoffs: 14 Feb 2026 is not a payday', () => {
    assert.equal(isPayday(d(2026, 2, 14)), false);
});

test('getPaydaysAndCutoffs: cutoff for 13 Feb 2026 payday is 7 Feb (previous Saturday)', () => {
    // 13 Feb is Friday → 6 days back = 7 Feb (Saturday).
    assert.ok(isCutoffDate(d(2026, 2, 7)));
});

test('getPaydaysAndCutoffs: 8 Feb 2026 is not a cutoff date', () => {
    assert.equal(isCutoffDate(d(2026, 2, 8)), false);
});

test('getPaydaysAndCutoffs: returns empty paydays for year below MIN_YEAR', () => {
    const result = getPaydaysAndCutoffs(2023);
    assert.deepEqual(result.paydays, []);
    assert.deepEqual(result.cutoffs, []);
});

// ---------------------------------------------------------------------------
// Annual leave entitlement
// ---------------------------------------------------------------------------

test('getALEntitlement: CEA on main roster gets 32 days', () => {
    assert.equal(getALEntitlement({ role: 'CEA', rosterType: 'main' }), 32);
});

test('getALEntitlement: a CEA on a FIXED roster (C. Reen) gets 32, not 34 (pins the Jun-2026 correction)', () => {
    // Guards the header comment in roster-data.js from re-diverging: C. Reen is contractually CEA
    // (not CEA-BL), so 32 — the same as every other CEA, regardless of the fixed rosterType.
    assert.equal(getALEntitlement({ role: 'CEA', rosterType: 'fixed' }), 32);
});

test('getALEntitlement: CES gets 34 days', () => {
    assert.equal(getALEntitlement({ role: 'CES', rosterType: 'ces' }), 34);
});

test('getALEntitlement: Dispatcher base entitlement is 22 days (no BH worked)', () => {
    // Dispatchers earn 22 base days + 1 lieu day per bank holiday actually worked.
    // A member with no valid roster (no currentWeek) works no bank holidays, so returns 22.
    assert.equal(getALEntitlement({ role: 'Dispatcher', rosterType: 'dispatcher' }), 22);
});

// Format a Date to the YYYY-MM-DD override-key string (local time, matching the count's own keying).
const _bhKey = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('getALEntitlement: Dispatcher earns +1 lieu day per bank holiday WORKED', () => {
    // The incremental branch (countDispatcherBankHolidaysWorked) — previously untested. Override EVERY
    // 2026 BH to RD (so the base roster can't add lieu days) except one worked RDW → 22 + 1 = 23.
    const member = { name: 'D. Test', role: 'Dispatcher', rosterType: 'dispatcher', currentWeek: 1 };
    const bhs = getBankHolidays(2026);
    const overrides = bhs.map(d => ({ memberName: 'D. Test', date: _bhKey(d), value: 'RD', type: 'correction', source: 'manual' }));
    overrides[0] = { memberName: 'D. Test', date: _bhKey(bhs[0]), value: '09:00-17:00', type: 'rdw', source: 'manual' };
    assert.equal(getALEntitlement(member, 2026, overrides), 23);
});

test('getALEntitlement: Dispatcher lieu count honours override precedence (manual RDW beats a stale import RD on a BH)', () => {
    // The lieu count uses shouldReplaceOverride, not last-in-array-wins: a stale roster_import RD listed
    // AFTER the manual RDW must not shadow it (that would miscount the entitlement by Firestore order).
    const member = { name: 'D. Test', role: 'Dispatcher', rosterType: 'dispatcher', currentWeek: 1 };
    const bhs = getBankHolidays(2026);
    // Every OTHER BH → RD; on bhs[0] a manual RDW competes with a stale import RD listed after it.
    const overrides = bhs.slice(1).map(d => ({ memberName: 'D. Test', date: _bhKey(d), value: 'RD', type: 'correction', source: 'manual' }));
    overrides.push({ memberName: 'D. Test', date: _bhKey(bhs[0]), value: '09:00-17:00', type: 'rdw',       source: 'manual',        createdAt: { seconds: 50 } });
    overrides.push({ memberName: 'D. Test', date: _bhKey(bhs[0]), value: 'RD',          type: 'correction', source: 'roster_import', createdAt: { seconds: 100 } });
    assert.equal(getALEntitlement(member, 2026, overrides), 23, 'manual RDW wins → the BH counts as worked');
});

test('getALEntitlement: all CEAs incl. fixed-line (C. Reen) get the standard 32 — no fixed premium', () => {
    assert.equal(getALEntitlement({ name: 'C. Reen', role: 'CEA', rosterType: 'fixed' }), 32);
    assert.equal(getALEntitlement({ name: 'K. Jedlinski', role: 'CEA', rosterType: 'fixed' }), 32);
});

test('getALEntitlement: an unresolved member is refused, not defaulted', () => {
    // v22.45: an unresolved member is REFUSED, not handed a CEA's 32. See the null-entitlement
    // block in al-entitlement.test.mjs for why a fall-through default is the dangerous answer here.
    assert.equal(getALEntitlement(null), null);
});

// ---------------------------------------------------------------------------
// projectAnnualLeaveOverage — the shared over-entitlement projection (v16.40)
// ---------------------------------------------------------------------------
const _proj = (existing, newDates, entitlement, name = 'G. Miller', year = '2026') =>
    projectAnnualLeaveOverage({ name, year, existingALDates: new Set(existing), newALDates: newDates, entitlement });

test('projectAnnualLeaveOverage: within entitlement → null', () => {
    assert.equal(_proj(['2026-01-05', '2026-01-06'], ['2026-02-10'], 32), null);
});

test('projectAnnualLeaveOverage: exactly at the cap → null (not over)', () => {
    assert.equal(_proj([], ['2026-02-10', '2026-02-11'], 2), null);
});

test('projectAnnualLeaveOverage: one over the cap → over:1 with the confirm strings', () => {
    const r = _proj(['2026-02-10'], ['2026-02-11', '2026-02-12'], 2);
    assert.equal(r.over, 1);
    assert.equal(r.projectedTotal, 3);
    assert.equal(r.headline, 'G. Miller will be 1 day over their 2026 AL entitlement');
    assert.equal(r.detail, '3 days used of 2 allowed in 2026');
});

test('projectAnnualLeaveOverage: pluralises "days" when 2+ over', () => {
    const r = _proj([], ['2026-03-01', '2026-03-02', '2026-03-03'], 1);
    assert.equal(r.over, 2);
    assert.match(r.headline, /will be 2 days over/);
});

test('projectAnnualLeaveOverage: a new date already in existing is NOT double-counted', () => {
    // Re-booking a day already marked AL must not consume a second entitlement day.
    const r = _proj(['2026-04-01', '2026-04-02'], ['2026-04-02', '2026-04-03'], 3);
    // existing 2 + new (only 04-03 is genuinely new) 1 = 3 → within a 3-day cap → null.
    assert.equal(r, null);
});

test('projectAnnualLeaveOverage: full overlap adds nothing (all new dates already existing)', () => {
    assert.equal(_proj(['2026-05-01', '2026-05-02'], ['2026-05-01', '2026-05-02'], 2), null);
});

// ---------------------------------------------------------------------------
// Roster pattern validation
// ---------------------------------------------------------------------------

test('validateRosterPatterns: all roster patterns are valid (returns 0 errors)', () => {
    assert.equal(validateRosterPatterns(), 0);
});

// ---------------------------------------------------------------------------
// Annual leave entitlement — edge cases
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// isChristmasRD
// ---------------------------------------------------------------------------

test('isChristmasRD: 25 Dec is always a rest day', () => {
    assert.ok(isChristmasRD(d(2026, 12, 25)));
});

test('isChristmasRD: 26 Dec is a rest day (can be overridden to RDW via Firestore)', () => {
    assert.ok(isChristmasRD(d(2026, 12, 26)));
});

test('isChristmasRD: 24 Dec is not a Christmas rest day', () => {
    assert.equal(isChristmasRD(d(2026, 12, 24)), false);
});

// ---------------------------------------------------------------------------
// Shift classification — isEarlyShift, isNightShift, getShiftClass
// ---------------------------------------------------------------------------

test('isEarlyShift: 04:00-12:00 is an early shift', () => {
    assert.ok(isEarlyShift('04:00-12:00'));
});

test('isEarlyShift: 11:00-19:00 is not an early shift (starts at threshold)', () => {
    assert.equal(isEarlyShift('11:00-19:00'), false);
});

test('isNightShift: 21:00-05:00 is a night shift', () => {
    assert.ok(isNightShift('21:00-05:00'));
});

test('isNightShift: 14:00-22:00 is not a night shift', () => {
    assert.equal(isNightShift('14:00-22:00'), false);
});

test('getShiftClass: early shift returns "early-shift"', () => {
    assert.equal(getShiftClass('06:00-14:00'), 'early-shift');
});

test('getShiftClass: night shift returns "night-shift"', () => {
    assert.equal(getShiftClass('22:00-06:00'), 'night-shift');
});

test('getShiftClass: late shift returns "late-shift"', () => {
    assert.equal(getShiftClass('14:00-22:00'), 'late-shift');
});

test('getShiftClass: every training grammar form returns "other-day" (never unknown-day)', () => {
    for (const v of ['TRG', 'IND', 'ASSESS', 'TRG RDW', 'ASSESS RDW', 'IND 08:00-16:00', 'TRG RDW 08:00-16:00']) {
        assert.equal(getShiftClass(v), 'other-day', v);
    }
});

// ── `showTime`: the badge says WHAT, not what KIND (v22.21) ─────────────────────────────────────
//
// Admin's Change-a-Shift week grid showed `☀️ EARLY` and nothing else, so the one thing an admin
// needs to decide whether to change a day — what the person is actually rostered to work — was the
// one thing missing. Owner report, with a screenshot: "you can't see the default shift time as
// reference, only early or late."
//
// The option, rather than a second badge builder, because two builders drift. The direction that
// matters is the DEFAULT: every existing caller — the calendar cell, the month legend, Team View —
// must render exactly as before, since a calendar cell prints the time beside the badge already.

// ── THE BADGE HAS ONE DECLARATION, AND TWO CONSUMERS (v22.69) ───────────────────────────────────
//
// `getShiftBadge` returns MARKUP, which the calendar's day-detail panel cannot use: writing markup
// out of a `data-` attribute is how an attribute becomes an injection surface. So the panel builds
// real elements from `shiftBadgeParts`, and `getShiftBadge` builds its HTML from the same function.
//
// The risk this pins is drift: the day a shift is one colour in the grid and another in the panel
// that describes it, which is a fault nobody would think to look for and which no behavioural test
// asserts. Driven over every KIND rather than a sample, so a tenth badge cannot be added to one and
// not the other.
test('each shift kind keeps its established colour', () => {
    // A LITERAL TABLE, deliberately. The parity test below proves the two builders AGREE — and
    // since they now share a source, agreement is cheap: a mutation changing SPARE from purple to
    // the rest-day grey passed it, because both consumers changed together. Agreement is not
    // correctness, and the thing that matters to a member is that 📋 is the same purple in the
    // panel as it is in the cell they tapped.
    //
    // These pairings are the app's visual vocabulary — staff read them daily and the guides print
    // them — so they are contract, not implementation detail, and pinning them is the point.
    const EXPECTED = {
        RD: 'badge-rest', OFF: 'badge-rest', SPARE: 'badge-spare', RDW: 'badge-rdw',
        AL: 'badge-al', SICK: 'badge-sick', TRG: 'badge-other',
        '06:30-15:00': 'badge-early', '14:00-22:00': 'badge-late', '22:00-06:00': 'badge-night',
        'not-a-shift': 'badge-unknown',
    };
    for (const [shift, cls] of Object.entries(EXPECTED)) {
        assert.equal(shiftBadgeParts(shift).cls, cls, `'${shift}' changed colour`);
    }
});

test('only a TIMED kind may trade its word for the time', () => {
    // `timed` is what lets the day panel show `☀️ 06:20-14:50 → ☀️ 06:30-15:00` instead of
    // `☀️ EARLY → ☀️ EARLY`. A same-kind change — a time tweak, probably the commonest change
    // there is — otherwise renders as two identical pills either side of an arrow, which reads as
    // "nothing changed" directly under a headline saying it did.
    for (const t of ['06:30-15:00', '14:00-22:00', '22:00-06:00']) {
        assert.equal(shiftBadgeParts(t).timed, true, `'${t}' is a timed shift`);
    }
    for (const k of ['RD', 'SPARE', 'AL', 'SICK', 'RDW', 'TRG', 'not-a-shift']) {
        assert.ok(!shiftBadgeParts(k).timed,
            `'${k}' has no time to show, so the panel would print the raw value as its label`);
    }
});

test('shiftBadgeParts and getShiftBadge agree on every shift kind', () => {
    const KINDS = ['RD', 'OFF', '', 'SPARE', 'RDW', 'AL', 'SICK', 'TRG', 'IND', 'MEET',
                   '06:30-15:00', '14:00-22:00', '22:00-06:00', 'not-a-shift'];
    for (const k of KINDS) {
        const { cls, emoji, word } = shiftBadgeParts(k);
        const html = getShiftBadge(k);
        assert.ok(html.includes(`shift-badge ${cls}`),
            `getShiftBadge('${k}') does not carry the class shiftBadgeParts reports (${cls}) — the `
            + 'grid and the day panel would colour the same shift differently');
        assert.ok(html.includes(`>${emoji}</span>`),
            `emoji mismatch for '${k}': parts say ${emoji}`);
        assert.ok(html.includes(`<span>${word}</span>`),
            `word mismatch for '${k}': parts say ${word}`);
    }
});

test('every badge kind has a colour class, an emoji and a word — colour is never alone', () => {
    // The app's WCAG 1.4.1 rule: a badge never carries meaning in colour alone. The panel's pill
    // reuses these parts, so a kind that lost its word would become colour-only there too.
    for (const k of ['RD', 'SPARE', 'RDW', 'AL', 'SICK', 'TRG', '06:30-15:00', '22:00-06:00', 'xx']) {
        const p = shiftBadgeParts(k);
        assert.match(p.cls, /^badge-[a-z]+$/, `no colour class for '${k}'`);
        assert.ok(p.emoji && p.emoji.length > 0, `no emoji for '${k}'`);
        assert.ok(p.word && p.word.length > 0, `no word for '${k}' — the badge would be colour alone`);
    }
});

test('getShiftBadge showTime: a worked shift shows its TIME instead of Early/Late/Night', () => {
    assert.match(getShiftBadge('06:20-14:20', { showTime: true }), />06:20-14:20</);
    assert.match(getShiftBadge('06:20-14:20', { showTime: true }), /badge-early/, 'still classified');
    assert.match(getShiftBadge('06:20-14:20', { showTime: true }), /☀️/, 'and still carries the icon');
    assert.match(getShiftBadge('14:30-22:00', { showTime: true }), />14:30-22:00</);
    assert.match(getShiftBadge('14:30-22:00', { showTime: true }), /badge-late/);
    assert.match(getShiftBadge('22:00-06:00', { showTime: true }), />22:00-06:00</);
    assert.match(getShiftBadge('22:00-06:00', { showTime: true }), /badge-night/);
    // The word is not lost — it moves into the accessible name, which a screen reader gets and
    // which the icon (aria-hidden) never gave it in the first place.
    assert.match(getShiftBadge('06:20-14:20', { showTime: true }), /aria-label="Early shift, 06:20 to 14:20"/);
    assert.match(getShiftBadge('22:00-06:00', { showTime: true }), /aria-label="Night shift, 22:00 to 06:00"/);
});

test('getShiftBadge showTime: a value with no time is untouched — its word IS the information', () => {
    for (const v of ['RD', 'OFF', 'SPARE', 'AL', 'SICK', 'RDW', 'TRG', 'IND 08:00-16:00', 'nonsense']) {
        assert.equal(getShiftBadge(v, { showTime: true }), getShiftBadge(v),
            `${v} has no time to show, so the option must change nothing`);
    }
});

test('getShiftBadge: the DEFAULT is byte-identical — the calendar must not move', () => {
    // The load-bearing half. `showTime` was added for ONE caller; every other surface renders the
    // classification and a regression there would be silent, because a badge is a badge.
    for (const v of ['06:20-14:20', '14:30-22:00', '22:00-06:00', 'RD', 'AL', 'SPARE']) {
        assert.equal(getShiftBadge(v), getShiftBadge(v, {}), 'an empty options object is the default');
        assert.equal(getShiftBadge(v), getShiftBadge(v, { showTime: false }));
        assert.doesNotMatch(getShiftBadge(v), /aria-label/, 'and the default adds no label');
    }
    assert.match(getShiftBadge('06:20-14:20'), />Early</);
    assert.match(getShiftBadge('14:30-22:00'), />Late</);
    assert.match(getShiftBadge('22:00-06:00'), />Night</);
});

test('getShiftBadge: Other-family flavours get 🏷️ + the SHORT word (Train/Ind/Assess)', () => {
    assert.match(getShiftBadge('TRG'),    /badge-other/);
    assert.match(getShiftBadge('TRG'),    /🏷️/);
    assert.match(getShiftBadge('TRG'),    />Train</);
    assert.match(getShiftBadge('IND'),    />Ind</);
    assert.match(getShiftBadge('ASSESS'), />Assess</);
    assert.match(getShiftBadge('MEET'),   />Meet</);   // Meeting flavour (roster "MTG")
    // RDW/timed variants keep the same flavour badge — the detail lives in the hours slot / tap label
    assert.match(getShiftBadge('TRG RDW'),            />Train</);
    assert.match(getShiftBadge('IND 08:00-16:00'),    />Ind</);
    // and never the ❓ Unknown fallthrough
    assert.doesNotMatch(getShiftBadge('TRG RDW'), /badge-unknown/);
});

// ---------------------------------------------------------------------------
// getShiftKind
// ---------------------------------------------------------------------------

test('getShiftKind: 04:00 start is early (lower boundary)', () => {
    assert.equal(getShiftKind('04:00-12:00'), 'early');
});

test('getShiftKind: 10:59 start is early (upper boundary)', () => {
    assert.equal(getShiftKind('10:59-18:59'), 'early');
});

test('getShiftKind: 11:00 start is late (boundary)', () => {
    assert.equal(getShiftKind('11:00-19:00'), 'late');
});

test('getShiftKind: 20:59 start is late (upper boundary)', () => {
    assert.equal(getShiftKind('20:59-04:59'), 'late');
});

test('getShiftKind: 21:00 start is night (boundary)', () => {
    assert.equal(getShiftKind('21:00-05:00'), 'night');
});

test('getShiftKind: 03:59 start is night (wraps past midnight)', () => {
    assert.equal(getShiftKind('03:59-11:59'), 'night');
});

test('getShiftKind: permanentShift early wins over a late time', () => {
    assert.equal(getShiftKind('14:30-22:30', { permanentShift: 'early' }), 'early');
});

test('getShiftKind: permanentShift late wins over an early time', () => {
    assert.equal(getShiftKind('06:00-14:00', { permanentShift: 'late' }), 'late');
});

test('getShiftKind: member without permanentShift falls back to time-based', () => {
    assert.equal(getShiftKind('06:00-14:00', { name: 'X' }), 'early');
});

// ---------------------------------------------------------------------------
// getShiftBadge
// ---------------------------------------------------------------------------

test('getShiftBadge: RD returns rest badge', () => {
    const badge = getShiftBadge('RD');
    assert.ok(badge.includes('🏠'), `Expected 🏠 in "${badge}"`);
});

test('getShiftBadge: AL returns annual leave badge', () => {
    const badge = getShiftBadge('AL');
    assert.ok(badge.includes('🏖️'), `Expected 🏖️ in "${badge}"`);
});

test('getShiftBadge: SPARE returns spare badge', () => {
    const badge = getShiftBadge('SPARE');
    assert.ok(badge.includes('📋'), `Expected 📋 in "${badge}"`);
});

test('getShiftBadge: RDW returns RDW badge', () => {
    const badge = getShiftBadge('RDW');
    assert.ok(badge.includes('💼'), `Expected 💼 in "${badge}"`);
});

test('getShiftBadge: early worked shift shows early badge', () => {
    const badge = getShiftBadge('06:00-14:00');
    assert.ok(badge.includes('☀️') && badge.includes('Early'), `Expected early badge in "${badge}"`);
});

// ---------------------------------------------------------------------------
// isSameDay
// ---------------------------------------------------------------------------

test('isSameDay: same date returns true', () => {
    assert.ok(isSameDay(d(2026, 6, 15), d(2026, 6, 15)));
});

test('isSameDay: different dates return false', () => {
    assert.equal(isSameDay(d(2026, 6, 15), d(2026, 6, 16)), false);
});

test('isSameDay: same day different times return true', () => {
    assert.ok(isSameDay(new Date(2026, 5, 15, 0, 0), new Date(2026, 5, 15, 23, 59)));
});

// ---------------------------------------------------------------------------
// getRosterForMember
// ---------------------------------------------------------------------------

test('getRosterForMember: main roster member returns weeklyRoster', () => {
    const member = teamMembers.find(m => m.rosterType === 'main');
    assert.ok(member, 'No main roster member found in teamMembers');
    const roster = getRosterForMember(member);
    assert.ok(roster, 'getRosterForMember returned falsy');
    assert.ok(roster.data, 'Roster has no data property');
    assert.equal(roster.type, 'main', 'Roster type should be main');
});

test('getRosterForMember: fixed roster member returns fixedRoster', () => {
    const member = teamMembers.find(m => m.rosterType === 'fixed');
    assert.ok(member, 'No fixed roster member found in teamMembers');
    const roster = getRosterForMember(member);
    assert.ok(roster, 'getRosterForMember returned falsy');
});

// ---------------------------------------------------------------------------
// getWeekNumberForDate
// ---------------------------------------------------------------------------

test('getWeekNumberForDate: returns a number between 1 and roster cycle length', () => {
    const member = teamMembers.find(m => m.rosterType === 'main');
    assert.ok(member, 'No main roster member found');
    const week = getWeekNumberForDate(d(2026, 3, 17), member);
    assert.ok(typeof week === 'number', 'Expected a number');
    assert.ok(week >= 1 && week <= 20, `Week ${week} out of range for 20-week main roster`);
});

// Pinned exact-value tests.  The reference date for the main roster is
// Sun 8 Feb 2026 (G. Miller on Week 3).  The noon helper avoids DST issues.

test('getWeekNumberForDate: G. Miller on the main reference date (8 Feb 2026) → week 3', () => {
    const miller = teamMembers.find(m => m.name === 'G. Miller');
    assert.ok(miller, 'G. Miller not found');
    assert.equal(getWeekNumberForDate(d(2026, 2, 8), miller), 3);
});

test('getWeekNumberForDate: G. Miller one week after reference (15 Feb 2026) → week 4', () => {
    const miller = teamMembers.find(m => m.name === 'G. Miller');
    assert.ok(miller);
    assert.equal(getWeekNumberForDate(d(2026, 2, 15), miller), 4);
});

test('getWeekNumberForDate: G. Miller one week before reference (1 Feb 2026) → week 2', () => {
    const miller = teamMembers.find(m => m.name === 'G. Miller');
    assert.ok(miller);
    assert.equal(getWeekNumberForDate(d(2026, 2, 1), miller), 2);
});

test('getWeekNumberForDate: G. Miller 8 weeks after reference (5 Apr 2026) → week 11', () => {
    const miller = teamMembers.find(m => m.name === 'G. Miller');
    assert.ok(miller);
    assert.equal(getWeekNumberForDate(d(2026, 4, 5), miller), 11);
});

test('getWeekNumberForDate: T. Nsuala (week 20) advances past cycle end → wraps to week 1', () => {
    // T. Nsuala is on week 20 as of the reference date.  One week later she wraps to 1.
    const nsuala = teamMembers.find(m => m.name === 'T. Nsuala');
    assert.ok(nsuala, 'T. Nsuala not found');
    assert.equal(getWeekNumberForDate(d(2026, 2, 8),  nsuala), 20); // on reference date
    assert.equal(getWeekNumberForDate(d(2026, 2, 15), nsuala),  1); // wraps
});

test('getWeekNumberForDate: L. Springer (week 1) goes back before reference → wraps to week 20', () => {
    const springer = teamMembers.find(m => m.name === 'L. Springer');
    assert.ok(springer, 'L. Springer not found');
    assert.equal(getWeekNumberForDate(d(2026, 2, 8), springer),  1); // on reference date
    assert.equal(getWeekNumberForDate(d(2026, 2, 1), springer), 20); // wraps backward
});

// CES roster — separate reference date (Sun 15 Feb 2026, F. Mohamed on CES Week 1)

test('getWeekNumberForDate: F. Mohamed on CES reference date (15 Feb 2026) → week 1', () => {
    const mohamed = teamMembers.find(m => m.name === 'F. Mohamed');
    assert.ok(mohamed, 'F. Mohamed not found');
    assert.equal(getWeekNumberForDate(d(2026, 2, 15), mohamed), 1);
});

test('getWeekNumberForDate: F. Mohamed one week after CES reference (22 Feb 2026) → week 2', () => {
    const mohamed = teamMembers.find(m => m.name === 'F. Mohamed');
    assert.ok(mohamed);
    assert.equal(getWeekNumberForDate(d(2026, 2, 22), mohamed), 2);
});

test('getWeekNumberForDate: F. Mohamed one week before CES reference (8 Feb 2026) → wraps to week 10', () => {
    // CES cycle is 10 weeks.  Week 1 minus 1 = week 10.
    const mohamed = teamMembers.find(m => m.name === 'F. Mohamed');
    assert.ok(mohamed);
    assert.equal(getWeekNumberForDate(d(2026, 2, 8), mohamed), 10);
});

// ---------------------------------------------------------------------------
// resolveMemberRoster — scheduled roster transitions
// ---------------------------------------------------------------------------

test('resolveMemberRoster: returns member unchanged when no rosterChanges', () => {
    const member = { name: 'X', rosterType: 'main', currentWeek: 3 };
    assert.strictEqual(resolveMemberRoster(member, d(2026, 7, 1)), member);
});

test('resolveMemberRoster: keeps base fields before the first change date', () => {
    const member = {
        name: 'X', rosterType: 'fixed', currentWeek: 1,
        rosterChanges: [{ from: new Date(2026, 6, 1), rosterType: 'ces', currentWeek: 4 }],
    };
    const eff = resolveMemberRoster(member, d(2026, 6, 30)); // 30 Jun — before 1 Jul
    assert.equal(eff.rosterType, 'fixed');
    assert.equal(eff.currentWeek, 1);
});

test('resolveMemberRoster: applies the change on the from date (inclusive)', () => {
    const member = {
        name: 'X', rosterType: 'fixed', currentWeek: 1,
        rosterChanges: [{ from: new Date(2026, 6, 1), rosterType: 'ces', currentWeek: 4 }],
    };
    const eff = resolveMemberRoster(member, d(2026, 7, 1)); // 1 Jul — on the boundary
    assert.equal(eff.rosterType, 'ces');
    assert.equal(eff.currentWeek, 4);
});

// ---------------------------------------------------------------------------
// B. Khalil — new CES starter on the CES rotation from his 9 Jun 2026 start
// (no bespoke fixed induction line — corrected June 2026)
// ---------------------------------------------------------------------------

test('B. Khalil: RD before his 9 Jun 2026 start date', () => {
    const k = teamMembers.find(m => m.name === 'B. Khalil');
    assert.ok(k, 'B. Khalil not found in teamMembers');
    assert.equal(getBaseShift(k, d(2026, 6, 8)), 'RD'); // 8 Jun — day before start
});

test('B. Khalil: on the CES rotation (not a fixed line) from June', () => {
    const k = teamMembers.find(m => m.name === 'B. Khalil');
    assert.equal(getRosterForMember(k, d(2026, 6, 10)).type, 'ces'); // June already the CES roster
    assert.equal(getBaseShift(k, d(2026, 6, 10)), '05:40-14:30');    // Wed 10 Jun — CES week-1 early shift
});

test('B. Khalil: works CES early shifts incl. some Saturdays (not a fixed 12:00-19:00 line)', () => {
    const k = teamMembers.find(m => m.name === 'B. Khalil');
    assert.equal(getBaseShift(k, d(2026, 6, 13)), '05:40-15:00'); // Sat 13 Jun — CES week-1 works the Saturday
});

test('B. Khalil: stays on the CES roster across the 1 July boundary', () => {
    const k = teamMembers.find(m => m.name === 'B. Khalil');
    assert.equal(getRosterForMember(k, d(2026, 6, 30)).type, 'ces');
    assert.equal(getRosterForMember(k, d(2026, 7, 1)).type, 'ces');
});

// ---------------------------------------------------------------------------
// getBaseShift
// ---------------------------------------------------------------------------

test('getBaseShift: returns a valid shift for a known member on a weekday', () => {
    const member = teamMembers.find(m => m.rosterType === 'main' && !m.hidden);
    assert.ok(member, 'No visible main roster member found');
    // Any Monday in 2026 — use a stable date
    const shift = getBaseShift(member, d(2026, 3, 16)); // Mon 16 Mar 2026
    assert.ok(
        /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(shift) || ['RD', 'SPARE', 'OFF'].includes(shift),
        `Expected a valid shift string, got "${shift}"`
    );
});

test('getBaseShift: fixed-roster member on a weekend returns RD', () => {
    const member = teamMembers.find(m => m.rosterType === 'fixed');
    assert.ok(member, 'No fixed roster member found');
    // Fixed roster is Mon–Fri; Saturday should be RD
    const shift = getBaseShift(member, d(2026, 3, 14)); // Sat 14 Mar 2026
    assert.equal(shift, 'RD');
});

test('getBaseShift: startDate suppression — returns RD before member joins', () => {
    // M. Okeke has startDate = new Date(2026, 3, 20) = 20 Apr 2026
    const member = teamMembers.find(m => m.name === 'M. Okeke');
    assert.ok(member, 'M. Okeke not found in teamMembers');
    // One day before startDate
    const shiftBefore = getBaseShift(member, d(2026, 4, 19)); // 19 Apr 2026
    assert.equal(shiftBefore, 'RD', 'Expected RD for date before startDate');
    // On startDate itself — should return normal shift (not suppressed)
    const shiftOn = getBaseShift(member, d(2026, 4, 20)); // 20 Apr 2026
    assert.ok(shiftOn !== undefined, 'Expected a value on startDate');
});

// Regression: v13.97 — getBaseShift previously accessed member.startDate without
// a null guard; a null/undefined member would throw TypeError. Sibling helpers
// (getWeekNumberForDate, getRosterForMember, getALEntitlement) all guard !member.
test('getBaseShift: null member returns RD without throwing', () => {
    assert.equal(getBaseShift(null, d(2026, 3, 16)), 'RD');
});

test('getBaseShift: undefined member returns RD without throwing', () => {
    assert.equal(getBaseShift(undefined, d(2026, 3, 16)), 'RD');
});

test('getBaseShift: Christmas Day (Dec 25) always returns RD regardless of roster', () => {
    // isChristmasRD() is applied before base roster lookup — Dec 25 is always RD.
    const member = teamMembers.find(m => m.rosterType === 'main' && !m.hidden);
    assert.ok(member, 'No visible main roster member found');
    assert.equal(getBaseShift(member, d(2026, 12, 25)), 'RD');
});

// ---------------------------------------------------------------------------
// getALEntitlement
// ---------------------------------------------------------------------------

test('getALEntitlement: proRatedAL overrides standard entitlement for the joining year', () => {
    // M. Okeke has proRatedAL: { 2026: 23 }; standard CEA entitlement is 32
    const member = teamMembers.find(m => m.name === 'M. Okeke');
    assert.ok(member, 'M. Okeke not found in teamMembers');
    assert.equal(getALEntitlement(member, 2026), 23, 'Expected pro-rated AL of 23 for joining year');
    assert.equal(getALEntitlement(member, 2027), 32, 'Expected standard CEA AL of 32 from year after joining');
});

// ---------------------------------------------------------------------------
// computeEaster
// ---------------------------------------------------------------------------

test('computeEaster: 2026 Easter Sunday is 5 April', () => {
    const e = computeEaster(2026);
    assert.equal(e.getMonth(), 3);  // April = month index 3
    assert.equal(e.getDate(), 5);
});

test('computeEaster: 2025 Easter Sunday is 20 April', () => {
    const e = computeEaster(2025);
    assert.equal(e.getMonth(), 3);
    assert.equal(e.getDate(), 20);
});

test('computeEaster: 2024 Easter Sunday is 31 March', () => {
    const e = computeEaster(2024);
    assert.equal(e.getMonth(), 2);  // March = month index 2
    assert.equal(e.getDate(), 31);
});

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

test('escapeHtml: null returns empty string', () => {
    assert.equal(escapeHtml(null), '');
});

test('escapeHtml: undefined returns empty string', () => {
    assert.equal(escapeHtml(undefined), '');
});

test('escapeHtml: plain string with no special chars is unchanged', () => {
    assert.equal(escapeHtml('Hello world'), 'Hello world');
});

test('escapeHtml: escapes < and >', () => {
    assert.equal(escapeHtml('<b>bold</b>'), '&lt;b&gt;bold&lt;/b&gt;');
});

test('escapeHtml: escapes &', () => {
    assert.equal(escapeHtml('fish & chips'), 'fish &amp; chips');
});

test('escapeHtml: escapes double-quotes', () => {
    assert.equal(escapeHtml('"quoted"'), '&quot;quoted&quot;');
});

test('escapeHtml: escapes all four special chars together', () => {
    assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

test('escapeHtml: number is coerced to string', () => {
    assert.equal(escapeHtml(42), '42');
});

// ---------------------------------------------------------------------------
// parseSmartFloat
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// getMembersForGrade — pinned against LIVE data
// ---------------------------------------------------------------------------

test('getMembersForGrade(Management) returns every CONFIG.MANAGER_NAMES manager (live-data regression)', () => {
    // Every ACTIVE manager row carries hidden:true as the standing convention, so the Management
    // filter must NOT exclude hidden — a `!m.hidden` filter here once emptied the login group,
    // locking all managers out and exposing their accounts to "Disable accounts for leavers".
    const names = getMembersForGrade('Management').map(m => m.name);
    for (const mgr of CONFIG.MANAGER_NAMES) {
        assert.ok(names.includes(mgr), `Management login group must include active manager ${mgr}`);
    }
    assert.ok(names.length >= CONFIG.MANAGER_NAMES.length, 'Management group must not be empty');
});

test('parseSmartFloat: empty/null/undefined returns 0', () => {
    assert.equal(parseSmartFloat(''), 0);
    assert.equal(parseSmartFloat(null), 0);
    assert.equal(parseSmartFloat(undefined), 0);
});

test('parseSmartFloat: plain numeric string parses', () => {
    assert.equal(parseSmartFloat('20.74'), 20.74);
    assert.equal(parseSmartFloat('  21.81 '), 21.81);
});

test('parseSmartFloat: unparseable string returns 0', () => {
    assert.equal(parseSmartFloat('abc'), 0);
});

test('parseSmartFloat: strips thousands separators and £ sign (payslip figures pasted verbatim)', () => {
    assert.equal(parseSmartFloat('23,456.78'), 23456.78);
    assert.equal(parseSmartFloat('£1,234.56'), 1234.56);
    assert.equal(parseSmartFloat('1,000'), 1000);
});

test('parseSmartFloat: iOS smart minus is normalised so parseFloat succeeds', () => {
    // U+2212 MINUS SIGN — raw parseFloat('−5') returns NaN; the strip fixes it.
    assert.equal(parseSmartFloat('−5'), -5);
});

test('parseSmartFloat: curly quote is stripped before parse', () => {
    // A trailing curly quote must not break an otherwise-valid number.
    assert.equal(parseSmartFloat('20.74’'), 20.74);
});

// ---------------------------------------------------------------------------
// avatarInitials
// ---------------------------------------------------------------------------

test('avatarInitials: null returns "?"', () => {
    assert.equal(avatarInitials(null), '?');
});

test('avatarInitials: empty string returns "?"', () => {
    assert.equal(avatarInitials(''), '?');
});

test('avatarInitials: "G. Miller" → "GM"', () => {
    assert.equal(avatarInitials('G. Miller'), 'GM');
});

test('avatarInitials: "C. Reen" → "CR"', () => {
    assert.equal(avatarInitials('C. Reen'), 'CR');
});

test('avatarInitials: single word uses first letter only', () => {
    assert.equal(avatarInitials('Alice'), 'A');
});

test('avatarInitials: hyphenated surname uses first letter of last token', () => {
    // 'C. Francisco-Charles' → parts = ['C.','Francisco-Charles'], first='C', last='F'
    assert.equal(avatarInitials('C. Francisco-Charles'), 'CF');
});

test('avatarInitials: result is always uppercase', () => {
    const initials = avatarInitials('g. miller');
    assert.equal(initials, initials.toUpperCase());
});

// ---------------------------------------------------------------------------
// avatarHue
// ---------------------------------------------------------------------------

test('avatarHue: returns a CSS oklch() string', () => {
    const colour = avatarHue('G. Miller');
    assert.match(colour, /^oklch\(52% 0\.12 \d+(\.\d+)?deg\)$/);
});

test('avatarHue: same name always produces the same colour', () => {
    assert.equal(avatarHue('G. Miller'), avatarHue('G. Miller'));
});

test('avatarHue: different names produce different hues (probabilistic)', () => {
    // Not exhaustive — just a basic sanity check that the hash varies
    assert.notEqual(avatarHue('G. Miller'), avatarHue('C. Reen'));
});

test('avatarHue: empty/null name returns a valid oklch string (h=0)', () => {
    assert.match(avatarHue(''), /^oklch\(52% 0\.12 0deg\)$/);
    // null: length is 0, h stays 0
    assert.match(avatarHue(null), /^oklch\(52% 0\.12 0deg\)$/);
});

// ---------------------------------------------------------------------------
// getSpecialDayBadges
// ---------------------------------------------------------------------------

// 2026-02-13 is the first payday (Friday). Cutoff = Sat 7 Feb 2026.
const PAYDAY_2026   = new Date(2026, 1, 13, 12, 0, 0);  // Feb 13
const CUTOFF_2026   = new Date(2026, 1,  7, 12, 0, 0);  // Feb 7 (Saturday before Feb 13)
const EASTER_2026   = new Date(2026, 3,  5, 12, 0, 0);  // Apr 5 — Easter Sunday
const XMAS_2026     = new Date(2026, 11, 25, 12, 0, 0); // Dec 25
const PLAIN_WEEKDAY = new Date(2026, 5, 17, 12, 0, 0);  // Jun 17 (Wednesday, no special day)

test('getSpecialDayBadges: plain weekday returns empty array', () => {
    const badges = getSpecialDayBadges(PLAIN_WEEKDAY, '2026-06-17');
    assert.deepEqual(badges, []);
});

test('getSpecialDayBadges: payday includes 💷 badge', () => {
    const badges = getSpecialDayBadges(PAYDAY_2026, '2026-02-13');
    assert.ok(badges.some(b => b.icon === '💷'), 'Expected payday badge');
});

test('getSpecialDayBadges: cutoff date includes ✂️ badge', () => {
    const badges = getSpecialDayBadges(CUTOFF_2026, '2026-02-07');
    assert.ok(badges.some(b => b.icon === '✂️'), 'Expected cutoff badge');
});

test('getSpecialDayBadges: Good Friday is a bank holiday — includes ⭐ badge', () => {
    const goodFriday = new Date(2026, 3, 3, 12, 0, 0); // Apr 3 2026
    const badges = getSpecialDayBadges(goodFriday, '2026-04-03');
    assert.ok(badges.some(b => b.icon === '⭐'), 'Expected bank holiday badge');
});

test('getSpecialDayBadges: Easter Sunday includes 🐣 badge', () => {
    const badges = getSpecialDayBadges(EASTER_2026, '2026-04-05');
    assert.ok(badges.some(b => b.icon === '🐣'), 'Expected Easter Sunday badge');
});

test('getSpecialDayBadges: Christmas Day includes 🎄 badge', () => {
    const badges = getSpecialDayBadges(XMAS_2026, '2026-12-25');
    assert.ok(badges.some(b => b.icon === '🎄'), 'Expected Christmas Day badge');
});

test('getSpecialDayBadges: Christmas Day is also a bank holiday — includes both 🎄 and ⭐', () => {
    const badges = getSpecialDayBadges(XMAS_2026, '2026-12-25');
    assert.ok(badges.some(b => b.icon === '🎄'), '🎄 badge missing');
    assert.ok(badges.some(b => b.icon === '⭐'), '⭐ badge missing');
});

test('getSpecialDayBadges: returns objects with icon and title fields', () => {
    const badges = getSpecialDayBadges(PAYDAY_2026, '2026-02-13');
    for (const b of badges) {
        assert.ok(typeof b.icon  === 'string', 'icon should be a string');
        assert.ok(typeof b.title === 'string', 'title should be a string');
    }
});

// ---------------------------------------------------------------------------
// parseISODate
// ---------------------------------------------------------------------------

test('parseISODate: parses YYYY-MM-DD to the correct local calendar day at noon', () => {
    const d = parseISODate('2026-03-18');
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 2);      // March (0-indexed)
    assert.equal(d.getDate(), 18);
    assert.equal(d.getHours(), 12);     // noon anchor — the DST/BST off-by-one guard
});

test('parseISODate: round-trips with formatISO', () => {
    for (const iso of ['2026-01-01', '2026-03-29', '2026-10-25', '2026-12-31']) {
        assert.equal(formatISO(parseISODate(iso)), iso, `round-trip failed for ${iso}`);
    }
});

// isSunday
// ---------------------------------------------------------------------------

test('isSunday: returns true for a known Sunday', () => {
    assert.equal(isSunday('2026-06-14'), true);  // June 14 2026 is Sunday
});

test('isSunday: returns true for another Sunday', () => {
    assert.equal(isSunday('2026-06-21'), true);  // June 21 2026 is Sunday
});

test('isSunday: returns false for Monday', () => {
    assert.equal(isSunday('2026-06-15'), false);  // June 15 2026 is Monday
});

test('isSunday: returns false for Saturday', () => {
    assert.equal(isSunday('2026-06-20'), false);  // June 20 2026 is Saturday
});

test('isSunday: returns false for a mid-week day', () => {
    assert.equal(isSunday('2026-06-17'), false);  // June 17 2026 is Wednesday
});

// ---------------------------------------------------------------------------
// teamMembers roster integrity
// ---------------------------------------------------------------------------

const ROSTER_CYCLE_LENGTHS = {
    main:       CONFIG.MAIN_ROSTER_WEEKS,
    bilingual:  CONFIG.BILINGUAL_ROSTER_WEEKS,
    // Fixed rosters don't rotate, but `currentWeek` selects which fixed pattern a member sits
    // on, so the valid range is the number of defined fixed patterns (derive it so adding a
    // pattern auto-updates the bound).
    fixed:      Object.keys(fixedRoster).length,
    ces:        CONFIG.CES_ROSTER_WEEKS,
    dispatcher: CONFIG.DISPATCHER_ROSTER_WEEKS,
};
const VALID_ROSTER_TYPES = new Set(Object.keys(ROSTER_CYCLE_LENGTHS));
const VALID_ROLES        = new Set(['CEA', 'CES', 'Dispatcher', 'Management']);

test('every teamMember has a valid rosterType', () => {
    const bad = teamMembers.filter(m => !VALID_ROSTER_TYPES.has(m.rosterType));
    assert.deepEqual(
        bad.map(m => m.name), [],
        `Members with invalid rosterType:\n  ${bad.map(m => `${m.name}: '${m.rosterType}'`).join('\n  ')}`
    );
});

test('every teamMember has a valid role', () => {
    const bad = teamMembers.filter(m => !VALID_ROLES.has(m.role));
    assert.deepEqual(
        bad.map(m => m.name), [],
        `Members with invalid role:\n  ${bad.map(m => `${m.name}: '${m.role}'`).join('\n  ')}`
    );
});

test('every teamMember.currentWeek is in range for their rosterType', () => {
    const bad = teamMembers.filter(m => {
        const len = ROSTER_CYCLE_LENGTHS[m.rosterType];
        return len === undefined || m.currentWeek < 1 || m.currentWeek > len;
    });
    assert.deepEqual(
        bad.map(m => m.name), [],
        `Members whose currentWeek is out of range:\n  ${bad.map(m =>
            `${m.name}: week ${m.currentWeek}, rosterType ${m.rosterType} (max ${ROSTER_CYCLE_LENGTHS[m.rosterType]})`
        ).join('\n  ')}`
    );
});

test('every teamMember.startDate is a Date instance when present', () => {
    const bad = teamMembers.filter(m => m.startDate !== undefined && !(m.startDate instanceof Date));
    assert.deepEqual(
        bad.map(m => m.name), [],
        `Members with non-Date startDate:\n  ${bad.map(m => `${m.name}: ${m.startDate}`).join('\n  ')}`
    );
});

test('every teamMember.rosterChanges is sorted ascending by from date', () => {
    const bad = [];
    for (const m of teamMembers) {
        if (!m.rosterChanges || m.rosterChanges.length < 2) continue;
        for (let i = 1; i < m.rosterChanges.length; i++) {
            if (m.rosterChanges[i].from <= m.rosterChanges[i - 1].from) {
                bad.push(`${m.name}: entry ${i} is not after entry ${i - 1}`);
                break;
            }
        }
    }
    assert.deepEqual(bad, [], `rosterChanges not sorted ascending:\n  ${bad.join('\n  ')}`);
});

test('every rosterChanges entry has a valid rosterType and currentWeek', () => {
    const bad = [];
    for (const m of teamMembers) {
        if (!m.rosterChanges) continue;
        for (const change of m.rosterChanges) {
            const len = ROSTER_CYCLE_LENGTHS[change.rosterType];
            if (!VALID_ROSTER_TYPES.has(change.rosterType)) {
                bad.push(`${m.name}: rosterChanges entry has invalid rosterType '${change.rosterType}'`);
            } else if (change.currentWeek < 1 || change.currentWeek > len) {
                bad.push(`${m.name}: rosterChanges entry currentWeek ${change.currentWeek} out of range for ${change.rosterType} (max ${len})`);
            }
        }
    }
    assert.deepEqual(bad, [], `Invalid rosterChanges entries:\n  ${bad.join('\n  ')}`);
});

// ── Pinned roster transitions (live roster facts — June/July 2026) ─────────────
// Pin the exact K. Jedlinski / S. Boyle / B. Khalil transitions so a future roster-data
// edit can't silently shift them. getBaseShift / resolveMemberRoster take Date objects
// (month 0-based). fixedRoster[2] = 09:00–16:00 Mon–Fri, RD weekends.

test('K. Jedlinski: pre-start RD, fixed pattern 2 (3–27 Jun), then main wk10 (28 Jun+)', () => {
    const m = teamMembers.find(x => x.name === 'K. Jedlinski');
    assert.ok(m, 'K. Jedlinski not found');
    assert.equal(getBaseShift(m, new Date(2026, 5, 2)),  'RD');           // 2 Jun — before startDate (3 Jun)
    assert.equal(getBaseShift(m, new Date(2026, 5, 10)), '09:00-16:00');  // Wed 10 Jun — fixed pattern 2
    assert.equal(getBaseShift(m, new Date(2026, 5, 13)), 'RD');           // Sat 13 Jun — fixed pattern 2 weekend
    const r = resolveMemberRoster(m, new Date(2026, 5, 28));              // 28 Jun onward
    assert.equal(r.rosterType, 'main');
    assert.equal(r.currentWeek, 10);
});

test('S. Boyle: main wk10 until 27 Jun, then fixed pattern 2 (28 Jun+)', () => {
    const m = teamMembers.find(x => x.name === 'S. Boyle');
    assert.ok(m, 'S. Boyle not found');
    const before = resolveMemberRoster(m, new Date(2026, 5, 27));
    assert.equal(before.rosterType, 'main');
    assert.equal(before.currentWeek, 10);
    const after = resolveMemberRoster(m, new Date(2026, 5, 28));
    assert.equal(after.rosterType, 'fixed');
    assert.equal(after.currentWeek, 2);
    assert.equal(getBaseShift(m, new Date(2026, 5, 29)), '09:00-16:00');  // Mon 29 Jun — fixed pattern 2
    assert.equal(getBaseShift(m, new Date(2026, 6, 4)),  'RD');           // Sat 4 Jul — fixed pattern 2 weekend
});

test('B. Khalil: pre-start RD, then CES rotation from 9 Jun and across 1 Jul', () => {
    const m = teamMembers.find(x => x.name === 'B. Khalil');
    assert.ok(m, 'B. Khalil not found');
    assert.equal(getBaseShift(m, new Date(2026, 5, 8)), 'RD');                       // 8 Jun — before startDate (9 Jun)
    assert.equal(resolveMemberRoster(m, new Date(2026, 5, 9)).rosterType,  'ces');   // on start
    const jul = resolveMemberRoster(m, new Date(2026, 6, 1));                        // across 1 Jul — still CES
    assert.equal(jul.rosterType,  'ces');
    assert.equal(jul.currentWeek, 5);
});


// ── parseSmartFloatOrNull — the null-preserving signed-field parser (v16.69) ──

describe('parseSmartFloatOrNull', () => {
    test('parses valid values incl. smart-punctuation and pasted payslip formats', () => {
        assert.equal(parseSmartFloatOrNull('147.36'), 147.36);
        assert.equal(parseSmartFloatOrNull('£23,456.78'), 23456.78);
        assert.equal(parseSmartFloatOrNull('−5'), -5);      // U+2212 minus
        assert.equal(parseSmartFloatOrNull('0'), 0);        // a REAL zero stays zero
    });
    test('empty / missing → null (not provided), never 0', () => {
        assert.equal(parseSmartFloatOrNull(''), null);
        assert.equal(parseSmartFloatOrNull('   '), null);
        assert.equal(parseSmartFloatOrNull(null), null);
        assert.equal(parseSmartFloatOrNull(undefined), null);
    });
    test('non-empty garbage → null — the £0-YTD tax-collapse guard (v16.69 review fix)', () => {
        // parseSmartFloat floors these to 0; for the Year-to-Date fields that asserted "£0 taxable
        // pay to date" and flipped computeTax into cumulative mode → Income Tax £0.00.
        assert.equal(parseSmartFloatOrNull('.'), null);
        assert.equal(parseSmartFloatOrNull('-'), null);
        assert.equal(parseSmartFloatOrNull('abc'), null);
        assert.equal(parseSmartFloatOrNull('£'), null);
    });
});

// ── A JOINER'S RECORD IS COMPLETE, OR IT INVENTS A LEAVE BALANCE (3 Sep 2026) ───────────────────
//
// Adding a member is a hand-edit to `teamMembers` followed by a checklist, and the field most easily
// left off is `proRatedAL`. Leaving it off is not an error anybody sees: `getALEntitlement` falls
// through to the role's FULL-YEAR entitlement, so a member who joined in October is credited a whole
// year's leave. The figure is plausible, it renders everywhere a real one would, and the only person
// positioned to notice is the member — who has no reason to think it is wrong.
//
// `noProRate: true` is the deliberate opposite (a secondment return: mid-year start, full-year pay
// and leave), so it satisfies the rule too. What the rule refuses is SILENCE: a start date with
// neither answer beside it.
//
// Verified against the live roster when written — all five members carrying a start date declare one
// or the other, so this pins the current state rather than describing an aspiration.
describe('every mid-year joiner says what their leave should be', () => {
    test('a startDate carries proRatedAL for that year, or noProRate', () => {
        const missing = teamMembers
            .filter(m => m.startDate)
            .filter(m => !m.noProRate && m.proRatedAL?.[m.startDate.getFullYear()] === undefined)
            .map(m => `${m.name} (${m.role}, started ${m.startDate.toISOString().slice(0, 10)})`);

        assert.deepEqual(missing, [],
            'these members joined mid-year with no leave entitlement recorded for that year, so '
            + `getALEntitlement gives them a FULL year's:\n  ${missing.join('\n  ')}\n`
            + 'Add proRatedAL: { <year>: N }, or noProRate: true if their leave really is full-year.');
    });

    test('and startDate is midnight, because the pay pro-rata depends on it', () => {
        // `calcProRateFactor` subtracts a midnight start from a NOON cutoff and rounds the result,
        // relying on the difference always landing on X.5. A time component breaks that by less than
        // a day — which is exactly the size of error that changes one period's hours and nothing else,
        // so it never looks like a bug in the date.
        const notMidnight = teamMembers
            .filter(m => m.startDate)
            .filter(m => m.startDate.getHours() || m.startDate.getMinutes()
                || m.startDate.getSeconds() || m.startDate.getMilliseconds())
            .map(m => `${m.name} (${m.startDate.toISOString()})`);

        assert.deepEqual(notMidnight, [],
            `startDate must be midnight local — new Date(year, month-1, day):\n  ${notMidnight.join('\n  ')}`);
    });
});

// ── A DISPATCHER'S LIEU DAYS SURVIVE PRO-RATING (v22.50, owner decision 3 Sep 2026) ─────────────
//
// A Dispatcher's entitlement is 22 plus one day for each bank holiday they actually work. Those two
// halves mean different things: the 22 is an allowance for a year's service, so a part-year deserves
// part of it; a lieu day is owed because a specific day was worked, and joining in June does not make
// that day less worked.
//
// `proRatedAL` used to be checked before the Dispatcher branch and returned outright, so a mid-year
// Dispatcher's joining year skipped the lieu count entirely — B. Toth was credited a flat 12 against
// two rostered bank holidays. Nothing errors when a leave balance is two days short: it renders, it
// books against, and the only person who could notice is the member.
describe('a Dispatcher who joined mid-year keeps the days they earned', () => {
    const dispatcher = (extra = {}) => ({
        name: 'T. Test', role: 'Dispatcher', rosterType: 'dispatcher', currentWeek: 1, ...extra,
    });
    // One override the counter must see as a worked bank holiday, and one it must not.
    const workedBH = [{ memberName: 'T. Test', date: '2026-08-31', type: 'rdw' }];

    test('proRatedAL scales the BASE — the lieu count is still added', () => {
        const m = dispatcher({ startDate: new Date(2026, 5, 29), proRatedAL: { 2026: 12 } });
        const lieu = getALEntitlement(dispatcher({ startDate: new Date(2026, 5, 29) }), 2026, workedBH) - 22;
        assert.equal(getALEntitlement(m, 2026, workedBH), 12 + lieu,
            'a pro-rated Dispatcher must still be credited the bank holidays they worked');
        assert.notEqual(getALEntitlement(m, 2026, workedBH), 12,
            'returning the pro-rated figure alone is the v22.50 defect — it discards earned days');
    });

    test('a year with no proRatedAL is unchanged — base 22 plus lieu', () => {
        const m = dispatcher({ startDate: new Date(2026, 5, 29), proRatedAL: { 2026: 12 } });
        const lieu = getALEntitlement(m, 2027, []) - 22;
        assert.equal(getALEntitlement(m, 2027, []), 22 + lieu);
    });

    test('and no OTHER role gained a lieu component', () => {
        // The fix reorders two checks. The risk in reordering is the branch you did not mean to move:
        // for every other role proRatedAL is the whole answer, because there is nothing earned in it.
        for (const [role, full] of [['CEA', 32], ['CES', 34]]) {
            const joiner = { name: 'X', role, rosterType: 'main', currentWeek: 1, proRatedAL: { 2026: 19 } };
            assert.equal(getALEntitlement(joiner, 2026, workedBH), 19, `${role} joiner keeps its pro-rated figure`);
            assert.equal(getALEntitlement({ ...joiner, proRatedAL: undefined }, 2026, workedBH), full);
        }
    });

    test('an unresolved member is still null, not a number', () => {
        assert.equal(getALEntitlement(null, 2026, []), null);
        assert.equal(getALEntitlement({ name: 'Y', role: 'Management' }, 2026, []), null);
    });
});
