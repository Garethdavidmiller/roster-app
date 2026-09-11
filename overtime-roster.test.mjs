/**
 * overtime-roster.test.mjs — WHOSE ROSTER ENDED UP ON THIS MEMBER'S PHONE, AND WHETHER IT WAS READ.
 * Run with: node --experimental-test-module-mocks --test overtime-roster.test.mjs
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────
 *
 * `overtime-roster.js` had no unit suite at all. A mutation sweep deleted the `memberName` filter
 * from `loadRosterContext`'s query and every lane stayed green — unit, e2e, rules — because
 * `firestore.rules` grants `overrides` read to ANY `name` claim, so the unfiltered query does not
 * fail, it SUCCEEDS and returns more. A member opening their own availability form then downloads
 * every colleague's leave, absence and shift change for those seven dates, which this module's
 * header forbids in as many words.
 *
 * ── ORGANISED BY WHAT A WRONG ANSWER COSTS ──────────────────────────────────────────────────────
 *
 *   1. A COLLEAGUE'S ROSTER ON A MEMBER'S DEVICE. The leak is the smaller half. The accumulator is
 *      keyed by DATE ALONE, so the last document read for a date wins whoever it belongs to: the
 *      member is shown somebody else's duty, offered "available after my shift" anchored to times
 *      they do not work, and that literal time is what they submit and a clerk acts on.
 *   2. AN UNREAD ROSTER PRESENTED AS FACT. On a failed read the module must say `error`. Swallow it
 *      and the base roster — a rotating pattern computed locally, wrong for anybody with leave, an
 *      absence, a changed shift or an RDW — is returned as `authoritative`, and every option the
 *      form derives from it is built on a shift the member may not be working.
 *   3. NOTHING AT ALL. The opposite direction, and the reason neither guard may be "simplified"
 *      into refusing everything: a filter that returns no overrides, or an error state reached on a
 *      good read, hides the member's own leave from their own form.
 *
 * ── THE FAKE ────────────────────────────────────────────────────────────────────────────────────
 *
 * Only `firebase-client.js` is mocked. `roster-data.js`, `override-utils.js` and `overtime-format.js`
 * are the REAL modules, so the base roster, the override→display ladder and the shift maths under
 * test are the shipped ones rather than a restatement — the member names and base shifts below come
 * from the real roster table.
 *
 * The fake `getDocs` APPLIES the constraints it was handed instead of re-implementing the intended
 * filter, which is the whole point: a harness that filters by its own idea of the rule cannot see
 * the rule being removed. Drop the `memberName` clause and this fake behaves exactly as Firestore
 * does — it hands back the colleague's document.
 *
 * ── ONE GUARD THIS SUITE PROVABLY CANNOT COVER ──────────────────────────────────────────────────
 *
 * `loadRosterForMembers` skips a document whose `memberName` is not a string. Deleting that clause
 * leaves every assertion here green, and no assertion could catch it: the orphan simply accumulates
 * under the key `undefined`, and `byMember` is built by walking the REQUESTED names, so nothing an
 * outside caller can ask for ever reads it. It is defence in depth with no observable consequence
 * through this module's API, and saying so is better than a case pretending otherwise.
 */

import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── THE FAKE FIRESTORE ──────────────────────────────────────────────────────────────────────────

/** @type {{ id: string, data: Record<string, any> }[]} */
let _docs = [];
/** @type {null | Error} */
let _readFails = null;
/** Every query actually ISSUED, constraints and all. */
let _queries = [];

/** Apply ONE recorded constraint to a document's data — as the server would, not as we hope. */
function matches(c, data) {
    const actual = data?.[c.field];
    switch (c.op) {
        case '==': return actual === c.value;
        case 'in': return Array.isArray(c.value) && c.value.includes(actual);
        // A loud failure rather than a quiet pass: an operator this fake does not model is an
        // assertion nobody is making, and silence there is how a harness stops seeing.
        default: throw new Error(`fake Firestore: unmodelled operator ${JSON.stringify(c.op)}`);
    }
}

mock.module('./firebase-client.js', {
    namedExports: {
        db: {},
        COLLECTIONS: { overrides: 'overrides' },
        collection: (_db, name) => ({ name }),
        where: (field, op, value) => ({ field, op, value }),
        query: (coll, ...constraints) => ({ coll, constraints }),
        getDocs: async (q) => {
            _queries.push(q);
            if (_readFails) throw _readFails;
            const hits = _docs.filter(d => q.constraints.every(c => matches(c, d.data)));
            return { forEach: (cb) => hits.forEach(d => cb({ id: d.id, data: () => d.data })) };
        },
    },
});

const { loadRosterContext, loadRosterForMembers } = await import('./overtime-roster.js');

// ── THE WEEK ────────────────────────────────────────────────────────────────────────────────────

const MEMBER    = 'G. Miller';
const COLLEAGUE = 'M. Robson';
/** Sunday → Saturday, the shape an Overtime window carries. */
const DATES = ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'];
const WED = '2026-09-16';   // G. Miller's base roster: RD
const THU = '2026-09-17';   // G. Miller's base roster: RD
const FRI = '2026-09-18';   // G. Miller's base roster: 08:00-16:30

const ov = (memberName, date, type, value) => ({
    id: `${memberName}|${date}`,
    data: { memberName, date, type, value },
});

beforeEach(() => { _docs = []; _readFails = null; _queries = []; });

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe('a colleague\'s roster must never reach a member\'s device', () => {
// ────────────────────────────────────────────────────────────────────────────────────────────────

    test('the query is SCOPED to the member — the one clause holding the whole property', async () => {
        await loadRosterContext(MEMBER, DATES);
        assert.equal(_queries.length, 1, 'one bounded read per window');
        const cs = _queries[0].constraints;
        assert.ok(
            cs.some(c => c.field === 'memberName' && c.op === '==' && c.value === MEMBER),
            'loadRosterContext must ask for this member only',
        );
        assert.ok(
            cs.some(c => c.field === 'date' && c.op === 'in' && c.value.length === DATES.length),
            'and for exactly the window\'s dates, in one query',
        );
    });

    test('a COLLEAGUE\'s override never enters byDate, however the read is shaped', async () => {
        // Both land on days this member is rostered RD, which is when the form asks the question
        // that matters. Unfiltered, the accumulator keys by DATE alone and the colleague's row wins.
        _docs = [
            ov(COLLEAGUE, WED, 'annual_leave', 'AL'),
            ov(COLLEAGUE, THU, 'shift', '05:00-13:00'),
        ];
        const { knowledge, byDate } = await loadRosterContext(MEMBER, DATES);

        assert.equal(knowledge, 'authoritative');
        assert.equal(byDate[WED].shift, 'RD', 'a colleague\'s leave is not this member\'s day');
        assert.equal(byDate[THU].shift, 'RD');
    });

    test('and the ANCHOR TIMES stay the member\'s own — the part that gets submitted', async () => {
        // "Available after my shift" is built from `start`/`end`. Anchored to somebody else's duty,
        // the member declares a literal time they never work and the roster clerk acts on it.
        _docs = [ov(COLLEAGUE, THU, 'shift', '05:00-13:00')];
        const { byDate } = await loadRosterContext(MEMBER, DATES);

        assert.equal(byDate[THU].hasTime, false, 'a rest day offers no shift anchor');
        assert.equal(byDate[THU].start, '');
        assert.equal(byDate[THU].end, '');
        assert.equal(byDate[THU].rosteredMinutes, 0);
        assert.equal(byDate[THU].isRest, true);
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe('an unread roster is never presented as fact', () => {
// ────────────────────────────────────────────────────────────────────────────────────────────────

    test('a failed read is `error` and carries NO days', async () => {
        // The dangerous shape is not a thrown error — it is a swallowed one. The base roster is
        // computed locally and always available, so a swallow returns seven confident, plausible
        // days with every override invisible: leave gone, a changed shift gone, nothing to see.
        _docs = [ov(MEMBER, FRI, 'annual_leave', 'AL')];
        _readFails = Object.assign(new Error('offline'), { code: 'unavailable' });

        const { knowledge, byDate } = await loadRosterContext(MEMBER, DATES);
        assert.equal(knowledge, 'error', 'never `authoritative` over a read that did not happen');
        assert.deepEqual(Object.keys(byDate), [], 'and no day is described at all');
    });

    test('a member this client\'s roster does not know is `error`, not an invented week', async () => {
        const { knowledge, byDate } = await loadRosterContext('Nobody At All', DATES);
        assert.equal(knowledge, 'error');
        assert.deepEqual(byDate, {});
    });

    test('no dates is `error`, and issues no read', async () => {
        const { knowledge } = await loadRosterContext(MEMBER, []);
        assert.equal(knowledge, 'error');
        assert.deepEqual(_queries, [], 'an unbounded `in` clause is never sent');
    });

    test('the reviewer\'s read fails the same way — a half-read week beside availability', async () => {
        _readFails = new Error('permission-denied');
        const { knowledge, byMember } = await loadRosterForMembers([MEMBER, COLLEAGUE], DATES);
        assert.equal(knowledge, 'error');
        assert.deepEqual(byMember, {});
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe('and it still answers for the member themselves', () => {
// ────────────────────────────────────────────────────────────────────────────────────────────────

    test('the member\'s OWN override is applied — the filter is a scope, not a refusal', async () => {
        _docs = [
            ov(MEMBER, FRI, 'annual_leave', 'AL'),
            ov(COLLEAGUE, FRI, 'shift', '05:00-13:00'),   // same date, someone else: must lose
        ];
        const { knowledge, byDate } = await loadRosterContext(MEMBER, DATES);

        assert.equal(knowledge, 'authoritative');
        assert.equal(byDate[FRI].shift, 'AL', 'their own leave shows on their own form');
        assert.equal(byDate[FRI].hasTime, false);
        assert.equal(Object.keys(byDate).length, DATES.length, 'every day of the window is described');
    });

    test('an untouched day resolves through the REAL base roster, with its times', async () => {
        const { byDate } = await loadRosterContext(MEMBER, DATES);
        assert.equal(byDate[FRI].shift, '08:00-16:30');
        assert.equal(byDate[FRI].hasTime, true);
        assert.equal(byDate[FRI].start, '08:00');
        assert.equal(byDate[FRI].end, '16:30');
        assert.equal(byDate[FRI].rosteredMinutes, 510);
        assert.equal(byDate[FRI].isRest, false);
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe('the reviewer\'s read is wide ON PURPOSE, and still attributes every row', () => {
// ────────────────────────────────────────────────────────────────────────────────────────────────

    test('no memberName clause — and each override lands under ITS OWN member', async () => {
        // The widening is deliberate: a reviewer's rules already grant the whole collection and
        // their job is the team's week, so ~50 per-member round trips buy nothing. What must hold
        // is ATTRIBUTION — one query, many people, and a document keyed by date alone would put a
        // colleague's leave on the row the clerk is about to ring.
        _docs = [
            ov(MEMBER,    WED, 'annual_leave', 'AL'),
            ov(COLLEAGUE, WED, 'shift', '05:00-13:00'),
        ];
        const { knowledge, byMember } = await loadRosterForMembers([MEMBER, COLLEAGUE], DATES);

        assert.equal(knowledge, 'authoritative');
        assert.equal(_queries.length, 1, 'one query for the whole workspace');
        assert.equal(
            _queries[0].constraints.some(c => c.field === 'memberName'), false,
            'the reviewer read is unfiltered by member — see the module header',
        );
        assert.equal(byMember[MEMBER][WED].shift, 'AL');
        assert.equal(byMember[COLLEAGUE][WED].shift, '05:00-13:00');
    });

    test('a document with no memberName is DROPPED, never attributed to somebody', async () => {
        _docs = [{ id: 'orphan', data: { date: WED, type: 'annual_leave', value: 'AL' } }];
        const { byMember } = await loadRosterForMembers([MEMBER], DATES);
        assert.equal(byMember[MEMBER][WED].shift, 'RD', 'an unowned row belongs to nobody');
    });

    test('a participant this client\'s roster does not know gets NO entry, not a fabricated one', async () => {
        const { byMember } = await loadRosterForMembers([MEMBER, 'Nobody At All'], DATES);
        assert.ok(byMember[MEMBER], 'the known participant is still resolved');
        assert.equal('Nobody At All' in byMember, false);
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe('the week is keyed to the day the ISO string NAMES, wherever the device is', () => {
// ────────────────────────────────────────────────────────────────────────────────────────────────

    // `resolveWeek` hands `getBaseShift` a Date built by `parseISODate`, which anchors at LOCAL
    // NOON. Written as `new Date(date)` it would be UTC midnight, and in any timezone behind UTC
    // that is the previous calendar day — so all seven days resolve to the shift before them.
    // Nothing errors: a plausible week comes back, one day out, and the form then offers
    // "available after 15:00" anchored to a duty the member is not working that day.
    //
    // The cases above DO catch that, and only on a machine already set behind UTC. CI runs in UTC,
    // where the two parses are indistinguishable and the mutation is invisible — so the timezone is
    // FORCED here rather than inherited. Node applies a `process.env.TZ` change to the next `Date`
    // it constructs, which is what makes this possible without a second process.
    //
    // Pacific/Midway (UTC-11) is the discriminating case. Ahead of UTC the two parses agree —
    // measured at UTC+14 — so an ahead-of-UTC arm would pass with the bug in, and is not written.

    /** Run `fn` as though the device were somewhere else, and put the clock back afterwards. */
    async function inTimezone(tz, fn) {
        const was = process.env.TZ;
        process.env.TZ = tz;
        try { return await fn(); } finally {
            if (was === undefined) delete process.env.TZ; else process.env.TZ = was;
        }
    }

    test('a phone eleven hours behind UTC reads Friday as Friday, not Thursday', async () => {
        const { byDate } = await inTimezone('Pacific/Midway', () => loadRosterContext(MEMBER, DATES));

        // FRI is a worked day and THU is a rest day, so a one-day slip is not a subtle difference
        // in this member's week — it is a duty appearing where the member has none.
        assert.equal(byDate[FRI].shift, '08:00-16:30', 'Friday must resolve to Friday\'s duty');
        assert.equal(byDate[FRI].start, '08:00', 'and the anchor times are the ones a member submits');
        assert.equal(byDate[FRI].end, '16:30');
        assert.equal(byDate[THU].shift, 'RD', 'Thursday stays the rest day it is');
        assert.equal(byDate[THU].hasTime, false);
    });

    test('and the same week read from UTC agrees with it, day for day', async () => {
        // The pair is the assertion: one timezone alone cannot say whether a week is right or
        // merely self-consistent. A base roster is a rotating pattern with no timezone in it, so
        // two devices reading the same seven dates must produce the same seven answers.
        const here  = (await inTimezone('UTC',            () => loadRosterContext(MEMBER, DATES))).byDate;
        const there = (await inTimezone('Pacific/Midway', () => loadRosterContext(MEMBER, DATES))).byDate;
        assert.deepEqual(there, here, 'the roster a member sees must not depend on where they are');
    });
});
