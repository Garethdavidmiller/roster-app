// @ts-check
/**
 * al-leave-plan.test.mjs — what one Save of the Annual leave sheet writes, what its log says, and
 * what an Undo may take back (al-leave-plan.js; docs/AL_UPLOADER_PLAN.md §4.5–4.10).
 * Run: node scripts/run-tests.mjs al-leave-plan.test.mjs   (part of `npm run test:hygiene`)
 *
 * Every person here is INVENTED. They borrow the real roster PATTERNS, because a member needs a line to
 * have rest days at all, but no real name, date of leave or figure appears.
 *
 * THE COMPARISON IS THE REAL ONE. Each person is compared by `comparePerson` (al-leave-compare.js) over
 * records shaped as Firestore returns them, so a test of the plan is a test of what the card would
 * really hand it — the states, the swap question and the winning record all come from the app's own
 * rules. Two guards do not trust a state at all (a Sunday, Christmas), and those are tested on days
 * built by hand, because no honest comparison produces them.
 *
 * THE DATES ARE FOUND, NOT WRITTEN DOWN, from each member's pattern, as al-leave-compare.test.mjs
 * finds them. Nothing reads a clock.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ANSWERS, LOG_MAX_DAYS, HELD_STATES, WRITE_KINDS, dayKey, parseDayKey, writableDate, questionsFor, planPerson,
    writesFor, saveTotals, recordsAfter, judgeUploads, saveRefusal, logLists, logFields, planUndo, landedWrites, oldestSaveableYear } from './al-leave-plan.js';
import { comparePerson, DAY_STATES } from './al-leave-compare.js';
import { getBaseShift, parseISODate, isSunday, isBankHoliday } from './roster-data.js';
import { manualOverrideId } from './override-id.js';
import { SUNDAY_FORBIDDEN_TYPES } from './override-utils.js';
import { consumesEntitlement } from './al-entitlement.js';
import { winnersByDate } from './al-leave-compare.js';
import { LEAVE_FILE_MAX_AGE_DAYS } from './al-leave-file.js';

const YEAR = 2026;
const FIRST = '2026-01-01';
const LAST = '2027-01-31';
const TODAY = '2026-11-14';
const ADMIN = 'A. Clerkson';
/** The id of the Save under test, which every one of its records carries; and another Save's. */
const UP = 'SaveUnderTest0000001';
const OTHER_UP = 'AnEarlierSave0000002';

/** @type {any} */ const CEA = { name: 'A. Example', role: 'CEA', rosterType: 'main', currentWeek: 1 };
/** @type {any} */ const CES = { name: 'B. Example', role: 'CES', rosterType: 'ces', currentWeek: 1 };

const DAY = 86_400_000;
/** @param {string} d @param {number} n */
const plus = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** @param {any} m @param {string} d */
const pat = (m, d) => getBaseShift(m, parseISODate(d));
const timed = (/** @type {string} */ s) => /^\d\d:\d\d-\d\d:\d\d$/.test(s);
const resting = (/** @type {string} */ s) => s === 'RD' || s === 'OFF';
const ordinary = (/** @type {string} */ d) => !isSunday(d) && !/-12-2[56]$/.test(d) && !isBankHoliday(parseISODate(d));
/** @param {any} m @param {string} from @param {(s: string) => boolean} want @param {string[]} [not] */
function find(m, from, want, not = []) {
    for (let d = from, i = 0; i < 400; d = plus(d, 1), i++) if (ordinary(d) && !not.includes(d) && want(pat(m, d))) return d;
    throw new Error(`no such day for ${m.name} from ${from}`);
}

let clock = 1_770_000_000;
let ids = 0;
/** A Firestore-shaped override with an id. Each newer than the last. @param {any} m @param {string} date @param {string} type @param {string} value @param {Record<string, any>} [extra] */
function rec(m, date, type, value, extra = {}) {
    return { id: `r${++ids}`, memberName: m.name, date, type, value, note: '', source: 'manual', changedBy: 'C. Manager',
        createdAt: { seconds: clock++ }, ...extra };
}
/** @param {any} m @param {string} d @param {Record<string, any>} [extra] */
const AL = (m, d, extra = {}) => rec(m, d, 'annual_leave', 'AL', extra);
/** @param {any} m @param {string} date @param {Record<string, any>} [extra] */
const leave = (m, date, extra = {}) => ({ name: m.name, date, kind: 'leave', foundIn: 'grid', countedBySheet: true, ...extra });
/** @param {any} m */
function sheetPerson(m) {
    const printed = { carriedForward: 0, allowance: 32, used: 0, columnE: 0, remaining: 32 };
    return { name: m.name, grade: m.role === 'CES' ? 'CES' : 'CEA',
        sheetRows: [{ row: 10, spelt: 'Example . X', grade: 'CEA', used: true, printed }],
        columnE: { datedDays: 0, joinerReduction: 0, lump: 0, unexplained: 0 }, corrected: { remaining: 32, because: [] } };
}
/** @param {any} m @param {any[]} days @param {any[]} [records] */
const compare = (m, days, records = []) => comparePerson({ person: sheetPerson(m), days, member: m, records,
    year: YEAR, todayStr: TODAY, firstDate: FIRST, lastDate: LAST });
/** @param {any} p @param {string} date */
const stateOf = (p, date) => p.days.find((/** @type {any} */ d) => d.date === date)?.state;
/** Plan one person, confirmed, as the admin. @param {any} person @param {any[]} records @param {Record<string, any>} [o] */
const plan = (person, records, o = {}) => planPerson({ person, records, confirmed: true, changedBy: ADMIN, ...o });

// The dates every test works from, found once from the patterns.
const WORK = find(CEA, '2026-03-02', timed);
const WORK2 = find(CEA, plus(WORK, 1), timed);
const REST = find(CEA, '2026-03-02', resting);
const REST2 = find(CEA, plus(REST, 1), resting);
const NEXT_JAN_WORK = find(CEA, '2027-01-04', timed);

test('the premises: the found days are what their names say, and the lists agree with the comparison', () => {
    assert.ok(timed(pat(CEA, WORK)) && timed(pat(CEA, WORK2)) && timed(pat(CEA, NEXT_JAN_WORK)));
    assert.ok(resting(pat(CEA, REST)) && resting(pat(CEA, REST2)));
    assert.ok(NEXT_JAN_WORK.startsWith('2027-01-'));
    for (const s of HELD_STATES) assert.ok(DAY_STATES.includes(s), `${s} is a comparison state`);
    assert.deepEqual([...ANSWERS], ['swapped', 'free']);
    assert.deepEqual([...WRITE_KINDS], ['add', 'add-swapped', 'swap']);
});

describe('what a Save writes, day by day', () => {
    test('not-in-app: leave added at the fixed id, as the Admin leave card writes it — for a confirmed person only', () => {
        const person = compare(CEA, [leave(CEA, WORK)]);
        assert.equal(stateOf(person, WORK), 'not-in-app');
        const p = plan(person, []);
        assert.equal(p.writes.length, 1);
        const w = p.writes[0];
        assert.equal(w.kind, 'add');
        assert.equal(w.fixedId, manualOverrideId(CEA.name, WORK));
        assert.equal(w.shown, null, 'nothing was there, so the fixed id must hold nothing when it is written');
        assert.deepEqual(w.replaces, []);
        assert.deepEqual(w.fields, { memberName: CEA.name, date: WORK, type: 'annual_leave', value: 'AL', note: '',
            source: 'manual', changedBy: ADMIN, replacedType: null, leaveYear: null });
        const waiting = planPerson({ person, records: [], confirmed: false, changedBy: ADMIN });
        assert.deepEqual(waiting.writes, [], 'nothing is written for a person whose row is not confirmed');
    });

    test('rest-day: asked, never defaulted — unanswered and "free" write nothing, "swapped" adds leave that costs a day', () => {
        const person = compare(CEA, [leave(CEA, REST), leave(CEA, REST2)]);
        assert.equal(stateOf(person, REST), 'rest-day');
        assert.deepEqual(questionsFor(person), [REST, REST2]);
        const none = plan(person, []);
        assert.deepEqual(none.writes, []);
        assert.deepEqual(none.unanswered, [REST, REST2]);
        const answered = plan(person, [], { answers: new Map([[REST, 'free'], [REST2, 'swapped']]) });
        assert.deepEqual(answered.leftFree, [REST], 'a free rest day is named, never written');
        assert.deepEqual(answered.unanswered, []);
        assert.equal(answered.writes.length, 1);
        const w = answered.writes[0];
        assert.equal(w.kind, 'add-swapped');
        assert.equal(w.date, REST2);
        assert.equal(w.fields.replacedType, 'shift', 'the swap is recorded, so the day costs leave');
        // And the app agrees once it is written: the day costs a day of leave.
        const after = recordsAfter([], answered);
        assert.equal(consumesEntitlement(CEA, REST2, winnersByDate(after, CEA.name)), true);
        assert.equal(stateOf(compare(CEA, [leave(CEA, REST2)], after), REST2), 'match');
    });

    test('free-in-app: "swapped" rewrites the stored leave with the swap recorded; the stored record is what must still be there', () => {
        const stored = AL(CEA, REST, { id: manualOverrideId(CEA.name, REST) });
        const person = compare(CEA, [leave(CEA, REST)], [stored]);
        assert.equal(stateOf(person, REST), 'free-in-app');
        assert.deepEqual(questionsFor(person), [REST], 'Admin would ask about leave on a rest day with nothing to say it was swapped');
        const p = plan(person, [stored], { answers: new Map([[REST, 'swapped']]) });
        assert.equal(p.writes.length, 1);
        const w = p.writes[0];
        assert.equal(w.kind, 'swap');
        assert.equal(w.shown, stored, 'the record at the fixed id is overwritten, so the check requires it unchanged');
        assert.deepEqual(w.replaces, []);
        assert.equal(w.fields.replacedType, 'shift');
        assert.equal(stateOf(compare(CEA, [leave(CEA, REST)], recordsAfter([stored], p)), REST), 'match');
    });

    test('a stored day on an older id: the winner is replaced, with every manual copy of the day — never an import that lost', () => {
        const legacy = AL(CEA, REST, { id: 'legacy-random' });
        const olderCopy = AL(CEA, REST, { id: 'older-manual', createdAt: { seconds: 1 } });
        const importLost = rec(CEA, REST, 'shift', '06:00-14:00', { id: 'an-import', source: 'roster_import' });
        const other = AL(CES, REST, { id: 'someone-else' });
        const records = [olderCopy, importLost, legacy, other];
        const person = compare(CEA, [leave(CEA, REST)], records);
        assert.equal(stateOf(person, REST), 'free-in-app', 'premise: the newest manual leave wins the day');
        const w = plan(person, records, { answers: new Map([[REST, 'swapped']]) }).writes[0];
        assert.equal(w.shown, legacy, 'nothing at the fixed id, so what must still be there is the winner');
        assert.deepEqual(w.replaces.map(r => r.id).sort(), ['legacy-random', 'older-manual']);
        assert.equal(writesFor(w), 3, 'its record and a delete for each record it replaces');
    });

    test('an older record AT the fixed id, beneath a newer winner, is the one the check compares there — and the winner goes', () => {
        const atFixed = AL(CEA, REST, { id: manualOverrideId(CEA.name, REST), createdAt: { seconds: 2 } });
        const newer = AL(CEA, REST, { id: 'newer-random' });
        const records = [atFixed, newer];
        const person = compare(CEA, [leave(CEA, REST)], records);
        assert.equal(stateOf(person, REST), 'free-in-app', 'premise: the newer record wins the day');
        const w = plan(person, records, { answers: new Map([[REST, 'swapped']]) }).writes[0];
        assert.equal(w.shown, atFixed, 'the fixed id is overwritten, so it must still hold what was loaded there');
        assert.deepEqual(w.replaces.map(r => r.id), ['newer-random']);
    });

    test('leave the app records as free for a reason of its own is never asked about, and nothing is written', () => {
        // Leave over RDW on a rest day is free, and settled by its record (owner, 10 Nov 2026).
        const overRdw = AL(CEA, REST, { replacedType: 'rdw' });
        const person = compare(CEA, [leave(CEA, REST)], [overRdw]);
        assert.equal(stateOf(person, REST), 'free-in-app');
        assert.deepEqual(questionsFor(person), []);
        const p = plan(person, [overRdw], { answers: new Map([[REST, 'swapped']]) });
        assert.deepEqual(p.writes, [], 'an answer to a question nobody asked writes nothing');
        assert.deepEqual(p.unanswered, []);
    });

    test('nothing else is ever written: agreement, a shift, an absence, a correction or work recorded there', () => {
        const days = [WORK, WORK2, REST, REST2].map(d => leave(CEA, d));
        const records = [AL(CEA, WORK), rec(CEA, WORK2, 'sick', 'SICK'), rec(CEA, REST, 'rdw', '06:00-14:00'),
            rec(CEA, REST2, 'other', 'TRG')];
        const person = compare(CEA, days, records);
        assert.deepEqual([WORK, WORK2, REST, REST2].map(d => stateOf(person, d)), ['match', 'differs', 'worked', 'worked']);
        const p = plan(person, records, { answers: new Map([[REST, 'swapped'], [REST2, 'swapped']]) });
        assert.deepEqual(p.writes, []);
    });

    test('a next-January day the sheet charges to this year is added with the leave year the sheet gives it', () => {
        const person = compare(CEA, [leave(CEA, NEXT_JAN_WORK, { leaveYear: YEAR })]);
        assert.equal(stateOf(person, NEXT_JAN_WORK), 'not-in-app');
        const w = plan(person, [], { leaveYears: new Map([[NEXT_JAN_WORK, YEAR]]) }).writes[0];
        assert.equal(w.fields.leaveYear, YEAR);
        // A year the rules would refuse is never sent: only January, and only the year before.
        const bad = plan(person, [], { leaveYears: new Map([[NEXT_JAN_WORK, YEAR - 1]]) }).writes[0];
        assert.equal(bad.fields.leaveYear, null);
        const own = plan(compare(CEA, [leave(CEA, WORK)]), [], { leaveYears: new Map([[WORK, YEAR - 1]]) }).writes[0];
        assert.equal(own.fields.leaveYear, null, 'a day outside January carries no leave year');
    });

    test('a rewrite keeps the year a stored January day already comes out of', () => {
        const restJan = find(CEA, '2027-01-04', resting);
        const stored = AL(CEA, restJan, { leaveYear: YEAR });
        const person = compare(CEA, [leave(CEA, restJan, { leaveYear: YEAR })], [stored]);
        assert.equal(stateOf(person, restJan), 'free-in-app');
        const w = plan(person, [stored], { answers: new Map([[restJan, 'swapped']]) }).writes[0];
        assert.equal(w.fields.leaveYear, YEAR);
    });
});

describe('the two guards no comparison state stands in for', () => {
    /** A day built by hand: no honest comparison produces leave to add on a Sunday or at Christmas. */
    const handMade = (/** @type {string} */ date, /** @type {string} */ state = 'not-in-app') => ({ name: CEA.name, days: [
        { date, kind: 'leave', foundIn: 'grid', countedBySheet: true, state, swapQuestion: state === 'rest-day',
          app: null, pattern: '', drawn: { shift: '', rdwTime: '', fromPattern: true, type: null }, appYear: null }] });

    test('never on a Sunday — the seventh layer of the Sunday rule, read from the one list', () => {
        assert.ok(SUNDAY_FORBIDDEN_TYPES.includes('annual_leave'), 'premise: leave is forbidden on a Sunday');
        const sunday = '2026-03-01';
        assert.ok(isSunday(sunday));
        assert.equal(writableDate(sunday), false);
        for (const state of ['not-in-app', 'rest-day']) {
            const p = plan(/** @type {any} */ (handMade(sunday, state)), [], { answers: new Map([[sunday, 'swapped']]) });
            assert.deepEqual(p.writes, [], `nothing written on a Sunday from ${state}`);
            assert.deepEqual(p.questions, [], 'and nothing asked');
        }
    });

    test('never on Christmas Day or Boxing Day', () => {
        for (const date of ['2026-12-25', '2026-12-26']) {
            assert.equal(writableDate(date), false);
            assert.deepEqual(plan(/** @type {any} */ (handMade(date)), []).writes, []);
        }
        assert.equal(writableDate('2026-12-24'), true, 'Christmas Eve is an ordinary day');
    });
});

describe('leave cancelled in the app does not come back', () => {
    test('a day an earlier Save brought into line, now holding nothing, is shown as removed since and never written', () => {
        const person = compare(CEA, [leave(CEA, WORK), leave(CEA, WORK2), leave(CEA, REST)]);
        const protectedKeys = new Set([dayKey(CEA.name, WORK), dayKey(CEA.name, REST)]);
        const p = plan(person, [], { protectedKeys, answers: new Map([[REST, 'swapped']]) });
        assert.deepEqual(p.removedSince, [WORK, REST].sort(), 'in date order, as the comparison lists the days');
        assert.deepEqual(p.writes.map(w => w.date), [WORK2], 'a day new on the sheet is still added');
        assert.deepEqual(p.questions, [], 'a rest day removed since is not asked about');
    });

    test('a protected day the app still holds as leave is simply in line', () => {
        const records = [AL(CEA, WORK)];
        const p = plan(compare(CEA, [leave(CEA, WORK)], records), records, { protectedKeys: new Set([dayKey(CEA.name, WORK)]) });
        assert.deepEqual(p.removedSince, []);
        assert.deepEqual(p.writes, []);
    });
});

describe('the Save button and the "after" figures', () => {
    test('saveTotals counts the days written and the people they belong to, by kind', () => {
        const a = plan(compare(CEA, [leave(CEA, WORK), leave(CEA, REST)]), [], { answers: new Map([[REST, 'swapped']]) });
        const b = planPerson({ person: compare(CES, [leave(CES, find(CES, '2026-03-02', timed))]), records: [], confirmed: false, changedBy: ADMIN });
        assert.deepEqual(saveTotals([a, b]), { days: 2, people: 1, added: 1, swapped: 1, rewritten: 0 });
    });

    test('recordsAfter keeps the replaced type and the leave year, and drops what the write replaces', () => {
        const legacy = AL(CEA, REST, { id: 'legacy-random' });
        const person = compare(CEA, [leave(CEA, REST)], [legacy]);
        const p = plan(person, [legacy], { answers: new Map([[REST, 'swapped']]) });
        const after = recordsAfter([legacy, AL(CES, REST)], p, new Date(0));
        assert.deepEqual(after.map(r => r.id).sort(), [manualOverrideId(CEA.name, REST), after.find(r => r.memberName === CES.name).id].sort());
        const written = after.find(r => r.id === manualOverrideId(CEA.name, REST));
        assert.equal(written.replacedType, 'shift');
        assert.ok(written.createdAt instanceof Date, 'stamped as the page stamps its own copies');
    });
});

describe('what the logs already written say about a new file', () => {
    /** @param {Partial<import('./al-leave-plan.js').UploadLog>} o @returns {any} */
    const log = (o) => ({ year: YEAR, fileDigest: 'sha256:' + 'a'.repeat(64), workbookSha256: 'b'.repeat(64),
        clerksLastSaved: '2026-11-06T10:00:00Z', lastSavedByClerk: true, savedAt: { seconds: 100 }, savedBy: ADMIN,
        appVersion: '26.12', inLine: [], added: [], ...o });
    const file = (/** @type {string|null} */ saved, digest = 'sha256:' + 'c'.repeat(64)) =>
        ({ year: YEAR, digest, source: { sha256: 'd'.repeat(64), clerksLastSaved: saved, lastSavedByClerk: true } });

    test('a copy saved before the newest one logged is older; the same copy, or a newer one, is not', () => {
        const logs = [log({ clerksLastSaved: '2026-11-06T10:00:00Z' }), log({ clerksLastSaved: '2026-10-01T09:00:00Z' })];
        assert.equal(judgeUploads({ logs, file: file('2026-11-01T08:00:00Z') }).older, true);
        assert.equal(judgeUploads({ logs, file: file('2026-11-06T10:00:00Z') }).older, false, 'the same copy again finishes a Save');
        assert.equal(judgeUploads({ logs, file: file('2026-11-12T08:00:00Z') }).older, false);
        assert.equal(judgeUploads({ logs, file: file('2026-11-01T08:00:00Z') }).newest?.clerksLastSaved, '2026-11-06T10:00:00Z');
        assert.equal(judgeUploads({ logs: [], file: file('2026-11-01T08:00:00Z') }).older, false, 'the first upload has nothing to be older than');
    });

    test('only this year’s logs say which copy is newer; last year’s still protect the January they ran into', () => {
        // Last year's sheet ran into the first days of this January (al-leave-plan.js header), so a day
        // its Save brought into line and the app has lost since must not come back from this year's.
        const other = log({ year: YEAR - 1, clerksLastSaved: '2027-01-30T10:00:00Z', inLine: [`A. Example|${YEAR}-01-05`] });
        const j = judgeUploads({ logs: [other, log({ fileDigest: 'sha256:' + 'c'.repeat(64) })], file: file('2026-11-06T10:00:00Z') });
        assert.equal(j.older, false, 'a later save time on last year’s log does not make this year’s copy older');
        assert.equal(j.newest?.year, YEAR, 'nor is it this year’s newest');
        assert.equal(j.sameFile, true);
        assert.equal(j.protectedKeys.has(`A. Example|${YEAR}-01-05`), true);
    });

    test('a sheet for a year before last is a check only: its log would be cleared by the Save that wrote it', () => {
        assert.equal(oldestSaveableYear(TODAY), Number(TODAY.slice(0, 4)) - 1);
        const judged = judgeUploads({ logs: [], file: file('2026-11-06T10:00:00Z') });
        const old = { ...file('2026-11-06T10:00:00Z'), year: Number(TODAY.slice(0, 4)) - 2 };
        assert.equal(saveRefusal({ file: old, todayStr: TODAY, judged }), 'old-year');
        assert.equal(saveRefusal({ file: { ...old, year: Number(TODAY.slice(0, 4)) - 1 }, todayStr: TODAY, judged }), null, 'last year’s may still be saved');
    });

    test('the protected days are every log’s days in line, less what its own undo took back', () => {
        const j = judgeUploads({ file: file('2026-11-12T08:00:00Z'), logs: [
            log({ inLine: ['A. Example|2026-03-02', 'A. Example|2026-03-03'], added: ['A. Example|2026-03-03'],
                  undone: ['A. Example|2026-03-03'] }),
            log({ inLine: ['B. Example|2026-04-01'] })] });
        assert.deepEqual([...j.protectedKeys].sort(), ['A. Example|2026-03-02', 'B. Example|2026-04-01']);
    });

    // A SAVE WHERE ONLY SWAPS LANDED IS LOGGED WITH NOTHING ADDED, AND IT HID THE UNDO (review of v26.22).
    // The Undo on offer is the latest Save that ADDED leave; a later log that added none is passed over,
    // and nothing further back is. The undone days leave every log written before the undo.
    describe('the Undo on offer, and a later Save that added nothing', () => {
        const A = log({ id: 'A', savedAt: { seconds: 100 }, inLine: ['A. Example|2026-03-02', 'A. Example|2026-03-03'], added: ['A. Example|2026-03-03'] });
        const B = log({ id: 'B', savedAt: { seconds: 200 }, inLine: ['A. Example|2026-03-02', 'A. Example|2026-03-03'], added: [] });
        const judge = (/** @type {any[]} */ logs) => judgeUploads({ logs, file: file('2026-11-06T10:00:00Z') });

        test('premise: the swap-only Save is the newest', () => {
            assert.equal(judge([A, B]).newest?.id, 'B');
        });

        test('its Undo is still offered, past the later Save that added nothing', () => {
            assert.equal(judge([A, B]).undoable?.id, 'A');
            assert.equal(judge([B, A]).undoable?.id, 'A', 'whatever order the logs were read in');
        });

        test('the newest Save that added is the one offered, when it is the newest', () => {
            const C = log({ id: 'C', savedAt: { seconds: 300 }, inLine: ['B. Example|2026-04-01'], added: ['B. Example|2026-04-01'] });
            assert.equal(judge([A, B, C]).undoable?.id, 'C');
        });

        test('ONE UNDO: once the latest Save that added is undone, nothing earlier is offered', () => {
            const C = log({ id: 'C', savedAt: { seconds: 300 }, inLine: ['B. Example|2026-04-01'], added: ['B. Example|2026-04-01'],
                undoneAt: { seconds: 400 }, undone: ['B. Example|2026-04-01'] });
            assert.equal(judge([A, B, C]).undoable, null, 'A is not offered behind an undone C');
            assert.equal(judge([{ ...A, undoneAt: { seconds: 300 }, undone: A.added }, B]).undoable, null);
        });

        test('nothing added anywhere: no Undo', () => {
            assert.equal(judge([B]).undoable, null);
        });

        test('an undo takes its days out of the later log too — the Undo removed them, not somebody in the app', () => {
            const undone = { ...A, undoneAt: { seconds: 300 }, undone: ['A. Example|2026-03-03'] };
            assert.deepEqual([...judge([undone, B]).protectedKeys].sort(), ['A. Example|2026-03-02'],
                'the later log still says 3 March was in line; without this, it would be stuck as "removed since"');
        });

        test('…but a log written AFTER the undo keeps its claim', () => {
            const undone = { ...A, undoneAt: { seconds: 150 }, undone: ['A. Example|2026-03-03'] };
            assert.equal(judge([undone, B]).protectedKeys.has('A. Example|2026-03-03'), true, 'B brought it back into line after the undo');
        });
    });

    test('a Save is refused before anything is written: no save time, too old, or an older copy', () => {
        const judged = judgeUploads({ logs: [], file: file('2026-11-06T10:00:00Z') });
        assert.equal(saveRefusal({ file: file(null), todayStr: TODAY, judged }), 'age-unknown');
        assert.equal(LEAVE_FILE_MAX_AGE_DAYS, 14, 'premise: the two dates below are 14 and 15 days before TODAY');
        assert.equal(saveRefusal({ file: file('2026-10-31T10:00:00Z'), todayStr: TODAY, judged }), null, 'exactly 14 days is allowed');
        assert.equal(saveRefusal({ file: file('2026-10-30T10:00:00Z'), todayStr: TODAY, judged }), 'too-old');
        const older = judgeUploads({ logs: [log({ clerksLastSaved: '2026-11-10T10:00:00Z' })], file: file('2026-11-06T10:00:00Z') });
        assert.equal(saveRefusal({ file: file('2026-11-06T10:00:00Z'), todayStr: TODAY, judged: older }), 'older-copy');
    });
});

describe('the log is built from what the app holds after the Save', () => {
    test('inLine is every held day of every compared person; added only the days the read shows are this Save’s own', () => {
        const person = compare(CEA, [leave(CEA, WORK), leave(CEA, WORK2), leave(CEA, REST)]);
        const p = plan(person, [], { answers: new Map([[REST, 'swapped']]) });
        assert.equal(p.writes.length, 3);
        const at = new Map(p.writes.map(w => [w.date, w]));
        // What the server holds after: WORK landed as this Save's own; WORK2 never landed; REST was
        // rewritten by a colleague between the Save and the read, which took the Save's mark off it.
        const read = [
            { id: manualOverrideId(CEA.name, WORK), ...at.get(WORK)?.fields, uploadId: UP, createdAt: { seconds: 5 } },
            { id: manualOverrideId(CEA.name, REST), ...at.get(REST)?.fields, changedBy: 'C. Manager', createdAt: { seconds: 6 } },
        ];
        const other = AL(CES, find(CES, '2026-03-02', timed));
        const after = [compare(CEA, [leave(CEA, WORK), leave(CEA, WORK2), leave(CEA, REST)], read),
            compare(CES, [leave(CES, other.date)], [other])];
        const lists = logLists({ after, plans: [p], recordsByName: new Map([[CEA.name, read], [CES.name, [other]]]), savedBy: ADMIN, uploadId: UP });
        assert.deepEqual(lists.inLine, [dayKey(CEA.name, WORK), dayKey(CEA.name, REST), dayKey(CES.name, other.date)].sort());
        assert.deepEqual(lists.added, [dayKey(CEA.name, WORK)]);
    });

    test('a rewrite of a stored day is never "added": an undo cannot honestly put the old record back', () => {
        const stored = AL(CEA, REST, { id: manualOverrideId(CEA.name, REST) });
        const p = plan(compare(CEA, [leave(CEA, REST)], [stored]), [stored], { answers: new Map([[REST, 'swapped']]) });
        const read = [{ id: stored.id, ...p.writes[0].fields, uploadId: UP, createdAt: { seconds: 9 } }];
        const lists = logLists({ after: [compare(CEA, [leave(CEA, REST)], read)], plans: [p], recordsByName: new Map([[CEA.name, read]]),
            savedBy: ADMIN, uploadId: UP });
        assert.deepEqual(lists.added, []);
        assert.deepEqual(lists.inLine, [dayKey(CEA.name, REST)]);
    });

    test('what the receipt counts: every write the read shows landed as written, a rewrite of a stored day included', () => {
        const person = compare(CEA, [leave(CEA, WORK), leave(CEA, WORK2), leave(CEA, REST)]);
        const p = plan(person, [], { answers: new Map([[REST, 'swapped']]) });
        const at = new Map(p.writes.map(w => [w.date, w]));
        // WORK landed; WORK2 holds a colleague's record; REST holds leave without the swap answered.
        // All three carry the Save's mark, so each check below is tested on its own.
        const read = [
            { id: manualOverrideId(CEA.name, WORK), ...at.get(WORK)?.fields, uploadId: UP, createdAt: { seconds: 5 } },
            { id: manualOverrideId(CEA.name, WORK2), ...at.get(WORK2)?.fields, changedBy: 'C. Manager', uploadId: UP, createdAt: { seconds: 6 } },
            { id: manualOverrideId(CEA.name, REST), ...at.get(REST)?.fields, replacedType: undefined, uploadId: UP, createdAt: { seconds: 7 } },
        ];
        const landed = () => landedWrites({ plans: [p], recordsByName: new Map([[CEA.name, read]]), savedBy: ADMIN, uploadId: UP });
        assert.deepEqual([...landed()], [[CEA.name, [WORK]]]);
        read[2].replacedType = at.get(REST)?.fields.replacedType;
        assert.deepEqual(landed().get(CEA.name)?.slice().sort(), [WORK, REST].sort(), 'the swap answer is part of what was written');
        assert.equal(landedWrites({ plans: [p], recordsByName: new Map(), savedBy: ADMIN, uploadId: UP }).size, 0, 'nothing read, nothing landed');
        // A rewrite (the stored day answered "swapped") landed is saved, though an Undo never takes it back.
        const stored = AL(CEA, REST2, { id: manualOverrideId(CEA.name, REST2) });
        const q = plan(compare(CEA, [leave(CEA, REST2)], [stored]), [stored], { answers: new Map([[REST2, 'swapped']]) });
        assert.equal(q.writes[0]?.kind, 'swap');
        const back = [{ id: stored.id, ...q.writes[0].fields, uploadId: UP, createdAt: { seconds: 9 } }];
        assert.deepEqual(landedWrites({ plans: [q], recordsByName: new Map([[CEA.name, back]]), savedBy: ADMIN, uploadId: UP }).get(CEA.name), [REST2]);
        assert.equal(landedWrites({ plans: [q], recordsByName: new Map([[CEA.name, [stored]]]), savedBy: ADMIN, uploadId: UP }).size, 0,
            'the stored day as it was is not the rewrite');
        assert.equal(landedWrites({ plans: [q], recordsByName: new Map([[CEA.name, back]]), savedBy: ADMIN, uploadId: UP,
            kinds: ['add', 'add-swapped'] }).size, 0);
    });

    test('a day the Save was refused on is never its own, whatever the read finds there — even a record carrying its mark (review, 15 Nov 2026)', () => {
        const days = [leave(CEA, WORK), leave(CEA, WORK2)];
        const p = plan(compare(CEA, days), []);
        const at = new Map(p.writes.map(w => [w.date, w]));
        // Both days read back exactly as the Save writes them, mark and all: WORK landed, and WORK2 is the
        // rare day a re-run was refused on after an earlier attempt of it landed with its answer lost.
        const read = [WORK, WORK2].map((d, i) => ({ id: manualOverrideId(CEA.name, d), ...at.get(d)?.fields, uploadId: UP,
            createdAt: { seconds: 5 + i } }));
        const recordsByName = new Map([[CEA.name, read]]);
        const exclude = new Map([[CEA.name, [WORK2]], [CES.name, [WORK]]]);
        assert.deepEqual(landedWrites({ plans: [p], recordsByName, savedBy: ADMIN, uploadId: UP }).get(CEA.name), [WORK, WORK2], 'the premise: alike');
        assert.deepEqual([...landedWrites({ plans: [p], recordsByName, savedBy: ADMIN, uploadId: UP, exclude })], [[CEA.name, [WORK]]],
            'not counted as saved; another person’s refusal takes nothing of this one’s');
        const lists = logLists({ after: [compare(CEA, days, read)], plans: [p], recordsByName, savedBy: ADMIN, uploadId: UP, exclude });
        assert.deepEqual(lists.added, [dayKey(CEA.name, WORK)], 'so an Undo can never take it back: kept is the side to be wrong on');
        assert.deepEqual(lists.inLine, [dayKey(CEA.name, WORK), dayKey(CEA.name, WORK2)].sort(), 'it is still in line: the app holds it as leave');
    });

    test('a record is the Save’s only while it carries the Save’s id: the admin’s own booking, field for field, is not (external review, 15 Nov 2026)', () => {
        const days = [leave(CEA, WORK), leave(CEA, WORK2)];
        const p = plan(compare(CEA, days), []);
        const at = new Map(p.writes.map(w => [w.date, w]));
        // WORK2 is exactly what the Save writes, by the same admin — booked by hand in Admin, or another tab.
        const read = [
            { id: manualOverrideId(CEA.name, WORK), ...at.get(WORK)?.fields, uploadId: UP, createdAt: { seconds: 5 } },
            { id: manualOverrideId(CEA.name, WORK2), ...at.get(WORK2)?.fields, createdAt: { seconds: 6 } },
        ];
        const recordsByName = new Map([[CEA.name, read]]);
        const landed = (/** @type {any} */ uploadId) => landedWrites({ plans: [p], recordsByName, savedBy: ADMIN, uploadId });
        assert.deepEqual([...landed(UP)], [[CEA.name, [WORK]]], 'counted only where the mark is');
        assert.equal(landed(OTHER_UP).size, 0, 'another Save’s mark is not this one’s');
        for (const none of [undefined, null, '']) assert.equal(landed(none).size, 0, `with no id (${none}) nothing landed — never every unmarked record`);
        const lists = logLists({ after: [compare(CEA, days, read)], plans: [p], recordsByName, savedBy: ADMIN, uploadId: UP });
        assert.deepEqual(lists.added, [dayKey(CEA.name, WORK)], 'so the log never calls the admin’s booking the Save’s');
        assert.deepEqual(lists.inLine, [dayKey(CEA.name, WORK), dayKey(CEA.name, WORK2)].sort());
    });

    test('logFields carries the file’s own identity, and refuses an empty log or one too long for the rules', () => {
        const file = { year: YEAR, digest: 'sha256:' + 'e'.repeat(64),
            source: { sha256: 'f'.repeat(64), clerksLastSaved: '2026-11-06T10:00:00Z', lastSavedByClerk: null } };
        assert.deepEqual(logFields({ file, inLine: ['x|2026-01-02'], added: [], savedBy: ADMIN, appVersion: '26.12' }), {
            year: YEAR, fileDigest: file.digest, workbookSha256: file.source.sha256, clerksLastSaved: '2026-11-06T10:00:00Z',
            lastSavedByClerk: null, savedBy: ADMIN, appVersion: '26.12', inLine: ['x|2026-01-02'], added: [], writesMarked: true },
            'and it says its Save marked every record, so its Undo goes by the mark');
        assert.equal(logFields({ file, inLine: [], added: [], savedBy: ADMIN, appVersion: '26.12' }), null);
        const many = Array.from({ length: LOG_MAX_DAYS + 1 }, (_, i) => `x|${i}`);
        assert.equal(logFields({ file, inLine: many, added: [], savedBy: ADMIN, appVersion: '26.12' }), null);
        assert.equal(logFields({ file: { ...file, source: { ...file.source, clerksLastSaved: null } }, inLine: ['x|2026-01-02'],
            added: [], savedBy: ADMIN, appVersion: '26.12' }), null);
    });

    test('LOG_MAX_DAYS is the cap firestore.rules puts on a log', () => {
        const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
        const block = rules.slice(rules.indexOf('match /alUploads/'));
        const cap = /inLine\.size\(\) <= (\d+)/.exec(block);
        assert.ok(cap, 'the cap on inLine was not found in the alUploads rules');
        assert.equal(Number(cap[1]), LOG_MAX_DAYS);
    });
});

describe('what an Undo may take back', () => {
    const savedAt = { seconds: 500 };
    /** A record as the Save wrote it, carrying its id. @param {string} date @param {Record<string, any>} [o] */
    const own = (date, o = {}) => ({ id: manualOverrideId(CEA.name, date), memberName: CEA.name, date, type: 'annual_leave', value: 'AL',
        note: '', source: 'manual', changedBy: ADMIN, uploadId: UP, createdAt: { seconds: 400 }, ...o });
    /** A log as a Save writes one now, saying its records carry its id. @param {string[]} added @returns {any} */
    const marked = added => ({ id: UP, savedAt, savedBy: ADMIN, writesMarked: true, added });

    test('a day still carrying the Save’s id is removed; one rewritten since, by anybody, is kept; one already gone is neither', () => {
        const log = marked([dayKey(CEA.name, WORK), dayKey(CEA.name, WORK2), dayKey(CEA.name, REST), dayKey(CEA.name, REST2), 'not a key']);
        // WORK2 rewritten since by the log's own author, as Admin writes it: no mark. REST by a colleague.
        const records = [own(WORK), own(WORK2, { uploadId: undefined, createdAt: { seconds: 600 } }),
            own(REST, { changedBy: 'C. Manager', uploadId: undefined })];
        const u = planUndo({ log, recordsByName: new Map([[CEA.name, records]]) });
        assert.deepEqual(u.remove.map(r => r.date), [WORK]);
        assert.deepEqual(u.kept, [dayKey(CEA.name, WORK2), dayKey(CEA.name, REST)]);
        assert.deepEqual(u.gone, [dayKey(CEA.name, REST2)]);
    });

    test('THE SAME ADMIN’S CHANGE BETWEEN THE SAVE AND ITS LOG is kept: stamped before the log and by its author, it has lost the mark (external review, 15 Nov 2026)', () => {
        const log = marked([dayKey(CEA.name, WORK), dayKey(CEA.name, WORK2)]);
        // The Save wrote both days (400); the admin re-saved WORK2 in another tab (450); the log came last (500).
        const changed = own(WORK2, { uploadId: undefined, createdAt: { seconds: 450 } });
        const recordsByName = new Map([[CEA.name, [own(WORK), changed]]]);
        // The reported bug, as the premise: judged by date, as before the mark, the change is the Save's.
        const byDate = planUndo({ log: { ...log, writesMarked: undefined }, recordsByName });
        assert.deepEqual(byDate.remove.map(r => r.date).sort(), [WORK, WORK2].sort(), 'the premise: the date rule undoes the admin’s change');
        const u = planUndo({ log, recordsByName });
        assert.deepEqual(u.remove.map(r => r.date), [WORK]);
        assert.deepEqual(u.kept, [dayKey(CEA.name, WORK2)]);
    });

    test('a marked log takes back nothing carrying another Save’s id, and nothing at all without an id of its own', () => {
        const log = marked([dayKey(CEA.name, WORK), dayKey(CEA.name, WORK2)]);
        const u = planUndo({ log, recordsByName: new Map([[CEA.name, [own(WORK, { uploadId: OTHER_UP }), own(WORK2)]]]) });
        assert.deepEqual(u.remove.map(r => r.date), [WORK2]);
        assert.deepEqual(u.kept, [dayKey(CEA.name, WORK)]);
        for (const id of [undefined, '']) {
            const records = [own(WORK, { uploadId: id }), own(WORK2, { uploadId: id })];
            const none = planUndo({ log: { ...log, id }, recordsByName: new Map([[CEA.name, records]]) });
            assert.deepEqual(none.remove, [], `a log with no id (${JSON.stringify(id)}) matches no record, unmarked ones least of all`);
        }
    });

    test('a day no longer leave is kept, whatever it carries', () => {
        for (const log of [marked([dayKey(CEA.name, WORK)]), { savedAt, savedBy: ADMIN, added: [dayKey(CEA.name, WORK)] }]) {
            const u = planUndo({ log: /** @type {any} */ (log), recordsByName: new Map([[CEA.name, [own(WORK, { type: 'sick', value: 'SICK' })]]]) });
            assert.deepEqual(u.remove, []);
            assert.deepEqual(u.kept, [dayKey(CEA.name, WORK)]);
        }
    });

    test('a log from before the mark (v26.13) is still judged by date: its records carry no id', () => {
        const log = /** @type {any} */ ({ savedAt, savedBy: ADMIN,
            added: [dayKey(CEA.name, WORK), dayKey(CEA.name, WORK2), dayKey(CEA.name, REST), dayKey(CEA.name, REST2), 'not a key'] });
        /** @param {string} d @param {Record<string, any>} [o] */
        const unmarked = (d, o = {}) => own(d, { uploadId: undefined, ...o });
        const records = [unmarked(WORK), unmarked(WORK2, { createdAt: { seconds: 600 } }), unmarked(REST, { changedBy: 'C. Manager' })];
        const u = planUndo({ log, recordsByName: new Map([[CEA.name, records]]) });
        assert.deepEqual(u.remove.map(r => r.date), [WORK]);
        assert.deepEqual(u.kept, [dayKey(CEA.name, WORK2), dayKey(CEA.name, REST)]);
        assert.deepEqual(u.gone, [dayKey(CEA.name, REST2)]);
    });
});

test('day keys round-trip, and anything else is not one', () => {
    assert.deepEqual(parseDayKey(dayKey('A. Example', '2026-03-02')), { name: 'A. Example', date: '2026-03-02' });
    assert.equal(parseDayKey('A. Example 2026-03-02'), null);
    assert.equal(parseDayKey(/** @type {any} */ (null)), null);
});
