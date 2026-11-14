/**
 * al-leave-words.test.mjs — every sentence the Annual leave sheet card says (al-leave-words.js).
 * Run: node scripts/run-tests.mjs al-leave-words.test.mjs   (part of `npm run test:hygiene`)
 *
 * Two kinds of check. The SENTENCES — what each day, figure and chip says, singular and plural. And
 * the BINDING — every code the leave file can carry (al-leave-file.js) and every state the comparison
 * can reach (al-leave-compare.js) has words of its own. That half is the one that matters: a new
 * code with no words falls through to a default ("On the sheet", "not compared"), which reads as an
 * answer and says nothing, and no browser test would notice, because the card still draws.
 *
 * Invented people only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    dayLabel, sheetWords, patternWords, recordWords, appWords, figuresLine, personNotes,
    chipsFor, totalsLines, reasonWords, ageWords, CARD_WORDS, checkedWords, overallWords, oldWords,
    unplacedWords, appOnlyWords, moreDaysWords, notComparedWords,
} from './al-leave-words.js';
import { FOUND_IN, NOT_IMPORTED_REASONS } from './al-leave-file.js';
import { DAY_STATES, NEEDS_A_LOOK } from './al-leave-compare.js';

/** A person's comparison, the shape al-leave-compare.js returns, with only what the words read. */
function person(over = {}) {
    return {
        name: 'Q. Example', grade: 'CEA',
        sheet: { allowance: 32, carriedForward: 0, used: 20, columnE: 0, remaining: 12, corrected: 12, undated: 0, joinerReduction: 0 },
        app: { entitlement: 32, taken: 18, booked: 2, remaining: 12 },
        allowanceDiffers: false, days: [], appOnly: [], counts: {}, needsALook: false, otherRows: 0,
        ...over,
    };
}

test('every date carries its weekday and its year — the sheet runs into the next January', () => {
    assert.equal(dayLabel('2026-02-24'), 'Tue 24 Feb 2026');
    assert.equal(dayLabel('2027-01-04'), 'Mon 4 Jan 2027');
});

test('every place a day can be found has words of its own', () => {
    for (const [foundIn, { kinds }] of Object.entries(FOUND_IN)) {
        for (const kind of kinds) {
            const words = sheetWords(foundIn, kind);
            assert.ok(words && words !== 'On the sheet', `${foundIn}/${kind} falls through to the default`);
        }
    }
    // Each says something different: two places sharing a sentence could not be told apart.
    const all = Object.keys(FOUND_IN).map(f => sheetWords(f, 'leave'));
    assert.equal(new Set(all).size, all.length);
    assert.match(sheetWords('grid', 'sunday-counted'), /Sunday — the sheet counts it/);
    assert.match(sheetWords('grid-misspelt', 'leave'), /own total misses it/);
    assert.equal(sheetWords('somewhere-new', 'leave'), 'On the sheet');
});

test('a pattern shift and a record in words', () => {
    assert.equal(patternWords('RD'), 'a rest day');
    assert.equal(patternWords('OFF'), 'a rest day');
    assert.equal(patternWords('SPARE'), 'a spare day');
    assert.equal(patternWords('06:20-14:20'), '06:20–14:20');
    assert.equal(patternWords('TRG'), 'TRG');
    assert.equal(recordWords(null), 'nothing');
    assert.equal(recordWords({ type: 'annual_leave', value: 'AL' }), 'annual leave');
    assert.equal(recordWords({ type: 'sick', value: 'SICK' }), 'an absence');
    assert.equal(recordWords({ type: 'correction', value: 'RD' }), 'a rest day');
    assert.equal(recordWords({ type: 'rdw', value: '06:20-14:20' }), 'rest day working (RDW)');
    assert.equal(recordWords({ type: 'shift', value: '13:45-21:45' }), 'a shift, 13:45–21:45');
    assert.equal(recordWords({ type: 'shift', value: '' }), 'a shift');
    assert.equal(recordWords({ type: 'spare_shift', value: 'SPARE' }), 'a Spare turn');
    assert.match(recordWords({ type: 'other', value: 'TRG' }), /Other day/);
});

test('every state the comparison can reach has a sentence', () => {
    for (const state of DAY_STATES) {
        const words = appWords({ state, app: null, pattern: 'RD' }, 2026);
        assert.ok(words.length > 0, `${state} says nothing`);
    }
});

test('the two days only the booker can settle ask Admin’s own question', () => {
    for (const state of ['rest-day', 'free-in-app']) {
        assert.match(appWords({ state, app: null, pattern: 'RD' }, 2026), /Was it a swapped working day\?$/);
    }
    assert.doesNotMatch(appWords({ state: 'not-in-app', app: null, pattern: '06:20-14:20' }, 2026), /swapped/);
});

test('a day’s app words say what is recorded and, where it matters, the year', () => {
    assert.equal(appWords({ state: 'not-in-app', app: null, pattern: '06:20-14:20' }, 2026),
        'Not in the app — 06:20–14:20 on their pattern');
    assert.match(appWords({ state: 'other-year', app: { type: 'annual_leave', value: 'AL' }, pattern: '06:20-14:20' }, 2026),
        /the sheet counts it in 2026$/);
    assert.equal(appWords({ state: 'differs', app: { type: 'sick', value: 'SICK' }, pattern: '06:20-14:20' }, 2026),
        'The app has an absence instead');
    assert.match(appWords({ state: 'worked', app: { type: 'rdw', value: '06:20-14:20' }, pattern: 'RD' }, 2026),
        /never overwrite/);
    assert.equal(appWords({ state: 'sunday', app: null, pattern: 'RD' }, 2026),
        'The app has a rest day on their pattern that Sunday');
    assert.equal(appWords({ state: 'sunday', app: { type: 'rdw', value: '08:00-16:00' }, pattern: 'RD' }, 2026),
        'The app has rest day working (RDW) that Sunday');
});

test('the figures line shows both sides, and the sheet’s corrected figure only when it differs', () => {
    assert.equal(figuresLine(person()), 'Sheet: 12 left · App: 12 left');
    assert.equal(figuresLine(person({ sheet: { ...person().sheet, corrected: 10 } })),
        'Sheet: 12 left (10 with the days its total misses) · App: 12 left');
    assert.equal(figuresLine(person({ sheet: null })), 'Sheet: no totals row · App: 12 left');
    assert.equal(figuresLine(person({ app: { entitlement: null, taken: 0, booked: 0, remaining: null } })),
        'Sheet: 12 left · App: no allowance on record');
});

test('the notes explain an allowance, undated days and a second row', () => {
    assert.deepEqual(personNotes(person(), { role: 'CEA' }), []);
    const differs = person({ allowanceDiffers: true, sheet: { ...person().sheet, carriedForward: 2, joinerReduction: 1 } });
    assert.deepEqual(personNotes(differs, { role: 'CEA' }), ['The sheet allows 33 and the app 32.']);
    assert.match(personNotes(differs, { role: 'Dispatcher' })[0], /a day in lieu for each bank holiday worked/);
    assert.match(personNotes(person({ sheet: { ...person().sheet, undated: 1 } }), {})[0], /1 more day over quota with no date, so it cannot/);
    assert.match(personNotes(person({ sheet: { ...person().sheet, undated: 3 } }), {})[0], /3 more days over quota with no date, so they cannot/);
    assert.deepEqual(personNotes(person({ otherRows: 1 }), {}), ['The sheet lists them on 2 rows; this uses the one with their days.']);
});

test('a chip for every state that needs a look — a person in that list always says why', () => {
    for (const state of [...NEEDS_A_LOOK, 'app-only']) {
        const chips = chipsFor({ [state]: 1 });
        assert.equal(chips.length, 1, `${state} has no chip`);
        assert.equal(chips[0].key, state);
    }
    // An allowance that differs is a reason on its own, and comes first.
    assert.deepEqual(chipsFor({}, true), [{ key: 'allowance', text: 'allowance differs' }]);
    assert.equal(chipsFor({ 'not-in-app': 2 }, true)[0].key, 'allowance');
    // Agreement and the days the app cannot hold get no chip.
    assert.deepEqual(chipsFor({ match: 30, 'before-start': 2, sunday: 4 }), []);
    assert.deepEqual(chipsFor({ 'not-in-app': 1, 'rest-day': 2 }).map(c => c.text),
        ['1 not in the app', '2 rest days to ask about']);
});

test('the summary lines, singular and plural, for differences only', () => {
    assert.deepEqual(totalsLines({ match: 400, sunday: 30, people: 40, needsALook: 0 }), []);
    assert.deepEqual(totalsLines({ 'not-in-app': 1 }), ['1 day of leave on the sheet is not in the app']);
    assert.deepEqual(totalsLines({ 'not-in-app': 3 }), ['3 days of leave on the sheet are not in the app']);
    assert.deepEqual(totalsLines({}, 1), ['1 person’s allowance differs between the sheet and the app']);
    assert.deepEqual(totalsLines({ 'app-only': 2 }, 4),
        ['4 people’s allowances differ between the sheet and the app', '2 days of leave are in the app and not on the sheet']);
    for (const state of [...NEEDS_A_LOOK, 'app-only']) assert.equal(totalsLines({ [state]: 2 }).length, 1, `${state} has no summary line`);
});

test('every reason somebody is not compared has words of its own', () => {
    for (const reason of NOT_IMPORTED_REASONS) assert.notEqual(reasonWords(reason), 'not compared', reason);
    assert.equal(reasonWords('something-new'), 'not compared');
});

test('the age line: today, yesterday, days ago, and old only PAST the limit', () => {
    assert.match(ageWords({ saved: '2026-11-06T09:12:00Z', ageDays: 0, maxAge: 14 }).line, /on 6 Nov 2026 \(today\)/);
    assert.match(ageWords({ saved: '2026-11-06T09:12:00Z', ageDays: 1, maxAge: 14 }).line, /\(yesterday\)/);
    assert.equal(ageWords({ saved: '2026-11-06T09:12:00Z', ageDays: 8, maxAge: 14 }).line,
        'The clerks last saved this sheet on 6 Nov 2026 (8 days ago). Anything booked since then shows as only in the app.');
    assert.equal(ageWords({ saved: '2026-11-06T09:12:00Z', ageDays: 14, maxAge: 14 }).old, false);
    assert.equal(ageWords({ saved: '2026-11-06T09:12:00Z', ageDays: 15, maxAge: 14 }).old, true);
    // No date at all is treated as old: nothing says how fresh it is.
    const unknown = ageWords({ saved: null, ageDays: null, maxAge: 14 });
    assert.equal(unknown.old, true);
    assert.match(unknown.line, /does not say when/);
});

test('the voice: calm, and never names the admin — the reader is the admin', () => {
    const sentences = [
        ...Object.keys(FOUND_IN).map(f => sheetWords(f, 'leave')),
        ...DAY_STATES.map(state => appWords({ state, app: { type: 'shift', value: '06:20-14:20' }, pattern: 'RD' }, 2026)),
        ...chipsFor(Object.fromEntries([...NEEDS_A_LOOK, 'app-only'].map(k => [k, 2])), true).map(c => c.text),
        ...totalsLines(Object.fromEntries([...NEEDS_A_LOOK, 'app-only'].map(k => [k, 2])), 2),
        ...NOT_IMPORTED_REASONS.map(reasonWords),
        ageWords({ saved: '2026-11-06T09:12:00Z', ageDays: 20, maxAge: 14 }).line,
        ...personNotes(person({ allowanceDiffers: true, otherRows: 1, sheet: { ...person().sheet, undated: 2 } }), { role: 'Dispatcher' }),
    ];
    for (const s of sentences) {
        assert.doesNotMatch(s, /!/, s);
        assert.doesNotMatch(s, /\bthe admin\b(?! page)/i, s);
        assert.doesNotMatch(s, /\boverride\b/i, s);
    }
});

test('the counted lines, singular and plural', () => {
    assert.equal(checkedWords(1), 'Checked 1 person against the app. Nothing was saved.');
    assert.equal(checkedWords(40), 'Checked 40 people against the app. Nothing was saved.');
    assert.equal(overallWords(3, 40), '3 of 40 people need a look.');
    assert.equal(overallWords(1, 1), '1 of 1 person needs a look.');
    assert.equal(overallWords(0, 40), 'All 40 agree with the app.');
    assert.equal(overallWords(0, 1), 'The one person compared agrees with the app.');
    assert.equal(overallWords(0, 0), 'Nobody on the sheet could be compared with the app.');
    assert.match(oldWords(14), /more than 14 days old/);
    assert.equal(unplacedWords(1), '1 Sunday tag on the sheet could not be tied to anybody the app holds.');
    assert.equal(unplacedWords(2), '2 Sunday tags on the sheet could not be tied to anybody the app holds.');
    assert.equal(appOnlyWords(true), 'Costs a day in the app');
    assert.equal(appOnlyWords(false), 'Costs nothing in the app');
    assert.equal(moreDaysWords(1), '1 more day on the sheet that agrees, or that the app cannot hold');
    assert.equal(moreDaysWords(5), '5 more days on the sheet that agree, or that the app cannot hold');
    assert.equal(notComparedWords({ name: 'Z. Example', reason: 'leaver' }), 'Z. Example — has left (not on the roster any more)');
});

test('the fixed lines: the offline one says why a cached read is not used, and the closing one where to act', () => {
    assert.match(CARD_WORDS.offline, /this device’s copy could call leave missing that isn’t/);
    assert.match(CARD_WORDS.checkOnly, /nothing has been saved/);
    assert.match(CARD_WORDS.checkOnly, /Change a Shift/);
    for (const [key, line] of Object.entries(CARD_WORDS)) {
        assert.doesNotMatch(line, /!/, key);
        assert.doesNotMatch(line, /\bthe admin\b(?! page)/i, key);
    }
});
