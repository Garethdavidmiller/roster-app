/**
 * al-leave-words.test.mjs — every sentence the Annual leave sheet card says (al-leave-words.js).
 * Run: node scripts/run-tests.mjs al-leave-words.test.mjs   (part of `npm run test:hygiene`)
 *
 * Two kinds of check. The SENTENCES — what each day, figure and chip says, singular and plural. And
 * the BINDING — every code the leave file can carry (al-leave-file.js) and every state and reason the
 * comparison can reach (al-leave-compare.js) has words of its own. That half is the one that matters:
 * a new code with no words falls through to a default ("On the sheet", "not compared"), which reads as
 * an answer and says nothing, and no browser test would notice, because the card still draws.
 *
 * Invented people only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    dayLabel, sheetWords, patternWords, drawnWords, appWords, figuresLine, personNotes,
    chipsFor, totalsLines, totalsEntries, reasonWords, ageWords, CARD_WORDS, checkedWords, overallWords, oldWords,
    unplacedWords, appOnlyWords, moreDaysWords, notComparedWords, beyondHeadWords,
} from './al-leave-words.js';
import { FOUND_IN, NOT_IMPORTED_REASONS } from './al-leave-file.js';
import { DAY_STATES, NEEDS_A_LOOK, COUNT_KEYS } from './al-leave-compare.js';

/** A person's comparison, the shape al-leave-compare.js returns, with only what the words read. */
function person(over = {}) {
    return {
        name: 'Q. Example', grade: 'CEA',
        sheet: { allowance: 32, carriedForward: 0, used: 20, columnE: 0, remaining: 12, corrected: 12, undated: 0, joinerReduction: 0 },
        app: { entitlement: 32, taken: 18, booked: 2, remaining: 12, note: null },
        allowanceDiffers: false, carried: 0, days: [], appOnly: [], beyond: [], counts: {}, figuresGap: 0, needsALook: false, otherRows: 0,
        ...over,
    };
}
/** What the Calendar draws: the pattern by default. */
const PATTERN = { shift: 'RD', rdwTime: '', fromPattern: true, type: null };
/** A day as the comparison returns it, with only what the words read. */
function day(over = {}) {
    return { state: 'match', pattern: 'RD', drawn: PATTERN, appYear: null, swapQuestion: false, ...over };
}
/** The count keys that need a look — every key but agreement, Sundays and the explained carry-over. */
const LOOK_KEYS = COUNT_KEYS.filter(k => !['match', 'sunday', 'carried'].includes(k));

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

test('a pattern shift in words', () => {
    assert.equal(patternWords('RD'), 'a rest day');
    assert.equal(patternWords('OFF'), 'a rest day');
    assert.equal(patternWords('SPARE'), 'a spare day');
    assert.equal(patternWords('06:20-14:20'), '06:20–14:20');
    assert.equal(patternWords('TRG'), 'TRG');
});

test('what the Calendar draws, in words — the drawn day, never the stored record', () => {
    const drawn = (/** @type {any} */ d, pattern = 'RD') => drawnWords({ pattern, drawn: { rdwTime: '', fromPattern: false, type: 'shift', ...d } });
    // The pattern itself: no record, or one no surface shows (leave on a Sunday, an absence on a rest day).
    assert.equal(drawnWords({ pattern: '07:15-15:45', drawn: { ...PATTERN, shift: '07:15-15:45' } }), '07:15–15:45 on their pattern');
    assert.equal(drawnWords({ pattern: 'RD', drawn: PATTERN }), 'a rest day on their pattern');
    assert.equal(drawn({ shift: 'RD', type: 'correction' }), 'a rest day');
    assert.equal(drawn({ shift: 'SICK', type: 'sick' }), 'an absence');
    assert.equal(drawn({ shift: 'AL', type: 'annual_leave' }), 'annual leave');
    assert.equal(drawn({ shift: 'SPARE', type: 'spare_shift' }), 'a Spare turn');
    assert.equal(drawn({ shift: 'RDW', rdwTime: '06:20-14:20', type: 'rdw' }), 'rest day working (RDW), 06:20–14:20');
    assert.equal(drawn({ shift: 'RDW', rdwTime: '', type: 'rdw' }), 'rest day working (RDW)');
    // An old timed shift on a Sunday is DRAWN as rest day working, so it is called that (review, 14 Nov 2026).
    assert.equal(drawn({ shift: 'RDW', rdwTime: '08:00-16:00', type: 'shift' }), 'rest day working (RDW), 08:00–16:00');
    assert.equal(drawn({ shift: '13:45-21:45', type: 'shift' }), 'a shift, 13:45–21:45');
    assert.match(drawn({ shift: 'TRG', type: 'other' }), /Other day/);
    assert.equal(drawn({ shift: 'SOMETHING', type: 'shift' }), 'a change of shift');
});

test('every state the comparison can reach has a sentence', () => {
    for (const state of DAY_STATES) assert.ok(appWords(day({ state, appYear: 2025 }), 2026).length > 0, `${state} says nothing`);
});

test('the swap question is asked exactly where Admin asks it, and nowhere else', () => {
    // Nothing recorded on a rest day: Admin asks.
    assert.match(appWords(day({ state: 'rest-day', swapQuestion: true }), 2026), /Was it a swapped working day\?$/);
    // Leave recorded on a rest day Admin would ask about — and the same leave its record has already
    // settled (over a correction, RDW, an Other day or a Spare turn), where Admin never asks.
    assert.match(appWords(day({ state: 'free-in-app', swapQuestion: true }), 2026), /on a rest day on their pattern.*Was it a swapped working day\?$/);
    assert.equal(appWords(day({ state: 'free-in-app', swapQuestion: false }), 2026), 'In the app, but recorded over a rest day, so it costs nothing there');
    for (const state of DAY_STATES.filter(s => !['rest-day', 'free-in-app'].includes(s))) {
        assert.doesNotMatch(appWords(day({ state, appYear: 2025, swapQuestion: false }), 2026), /swapped/, state);
    }
});

test('a day’s app words say what the app shows and, where it matters, the year', () => {
    assert.equal(appWords(day({ state: 'not-in-app', pattern: '06:20-14:20' }), 2026), 'Not in the app — 06:20–14:20 on their pattern');
    // Another year's allowance is NAMED, and never "the sheet counts it" — beside a misspelt day the
    // sheet's own total misses (review, 14 Nov 2026).
    assert.equal(appWords(day({ state: 'other-year', appYear: 2027 }), 2026), 'In the app, but from 2027’s allowance — the sheet has it as a 2026 day');
    assert.equal(appWords(day({ state: 'carried', appYear: 2026 }), 2027),
        'In the app from 2026’s allowance — the sheet counts it in 2027 and carries a day forward from 2026 to pay for it');
    assert.equal(appWords(day({ state: 'differs', drawn: { shift: 'SICK', rdwTime: '', fromPattern: false, type: 'sick' } }), 2026), 'The app shows an absence instead');
    // An absence on a rest day is never drawn: the words say what IS drawn.
    assert.equal(appWords(day({ state: 'differs' }), 2026), 'The app shows a rest day on their pattern instead');
    assert.match(appWords(day({ state: 'worked', drawn: { shift: 'RDW', rdwTime: '06:20-14:20', fromPattern: false, type: 'rdw' } }), 2026),
        /^The app shows rest day working \(RDW\), 06:20–14:20 — work, which an upload would never overwrite$/);
    assert.equal(appWords(day({ state: 'before-start' }), 2026), 'Before their start date in the app, which shows and counts nothing then');
    // A Sunday: what is drawn, which for leave or an absence there is the pattern (review, 14 Nov 2026).
    assert.equal(appWords(day({ state: 'sunday', pattern: '07:15-15:45', drawn: { ...PATTERN, shift: '07:15-15:45' } }), 2026),
        'The app shows 07:15–15:45 on their pattern that Sunday');
    assert.equal(appWords(day({ state: 'sunday', drawn: { shift: 'RDW', rdwTime: '08:00-16:00', fromPattern: false, type: 'rdw' } }), 2026),
        'The app shows rest day working (RDW), 08:00–16:00 that Sunday');
});

test('the figures line shows both sides, the corrected figure only when it differs, and an overdraw as Admin says it', () => {
    assert.equal(figuresLine(person()), 'Sheet: 12 left · App: 12 left');
    assert.equal(figuresLine(person({ sheet: { ...person().sheet, corrected: 10 } })), 'Sheet: 12 left (corrected: 10 left) · App: 12 left');
    assert.equal(figuresLine(person({ sheet: null })), 'Sheet: no totals row · App: 12 left');
    assert.equal(figuresLine(person({ app: { entitlement: null, taken: 0, booked: 0, remaining: null, note: null } })),
        'Sheet: 12 left · App: no allowance on record');
    // "N over limit" is the Admin banner's own phrase (admin-app.js); "-1 left" was the first cut.
    assert.equal(figuresLine(person({ sheet: { ...person().sheet, remaining: -2, corrected: -2 }, app: { ...person().app, remaining: -1 } })),
        'Sheet: 2 over limit · App: 1 over limit');
    assert.equal(figuresLine(person({ sheet: { ...person().sheet, remaining: 0, corrected: 0 } })), 'Sheet: 0 left · App: 12 left');
});

test('a corrected sheet figure says which way each day moved it — a counted Sunday RAISES it', () => {
    const corrected = (/** @type {any[]} */ days, remaining, correctedTo) =>
        personNotes(person({ days, sheet: { ...person().sheet, remaining, corrected: correctedTo } }), 2026)[0];
    assert.equal(corrected([day({ foundIn: 'grid-misspelt', kind: 'leave' }), day({ foundIn: 'grid-misspelt', kind: 'leave' })], 12, 10),
        'Corrected, the sheet leaves 10, not 12: its total misses 2 days under another spelling.');
    assert.equal(corrected([day({ foundIn: 'column-e-uncounted', kind: 'leave' })], 12, 11),
        'Corrected, the sheet leaves 11, not 12: 1 day is dated over quota with the count beside it left blank.');
    assert.equal(corrected([day({ foundIn: 'grid', kind: 'sunday-counted', state: 'sunday' })], 12, 13),
        'Corrected, the sheet leaves 13, not 12: it counts 1 Sunday, and a Sunday is never annual leave.');
    assert.equal(corrected([day({ foundIn: 'grid-misspelt', kind: 'leave' }), day({ foundIn: 'grid', kind: 'sunday-counted', state: 'sunday' })], 13, 12),
        'Corrected, the sheet leaves 12, not 13: its total misses 1 day under another spelling; it counts 1 Sunday, and a Sunday is never annual leave.');
    // One of each cancels out: the figure does not move, so there is nothing to explain.
    assert.deepEqual(personNotes(person({ days: [day({ foundIn: 'grid-misspelt', kind: 'leave' }), day({ foundIn: 'grid', kind: 'sunday-counted', state: 'sunday' })] }), 2026), []);
});

test('the allowance is explained from each side’s own parts, never a cause guessed here', () => {
    assert.deepEqual(personNotes(person(), 2026), []);
    // The sheet's carried-forward days and joiner's reduction; the app's own note (entitlementNote).
    const differs = person({ allowanceDiffers: true, sheet: { ...person().sheet, carriedForward: 2, joinerReduction: 1 } });
    assert.deepEqual(personNotes(differs, 2026), ['The sheet allows 33 (32, plus 2 carried forward, less 1 for starting part way through the year), and the app 32.']);
    assert.deepEqual(personNotes(person({ allowanceDiffers: true, app: { ...person().app, entitlement: 33, note: 'Includes 1 day in lieu for working Boxing Day' } }), 2026),
        ['The sheet allows 32, and the app 33 (includes 1 day in lieu for working Boxing Day).']);
    // A Dispatcher whose sheet carries days forward is LOWER in the app: the first cut said the app
    // "adds a day in lieu for each bank holiday worked", which could not be the cause (review, 14 Nov 2026).
    const disp = personNotes(person({ allowanceDiffers: true, sheet: { ...person().sheet, allowance: 27, carriedForward: 3 },
        app: { ...person().app, entitlement: 27, note: '22 base + 5 BH lieu' } }), 2026)[0];
    assert.equal(disp, 'The sheet allows 30 (27, plus 3 carried forward), and the app 27 (22 base + 5 BH lieu).');
    assert.doesNotMatch(disp, /adds/);
});

test('the carry-over is explained, and only what it does not explain is an allowance difference', () => {
    const carried = person({ carried: 3, sheet: { ...person().sheet, carriedForward: 3 } });
    assert.deepEqual(personNotes(carried, 2027),
        ['The sheet carries 3 days forward from 2026; the app takes 3 January days from 2026’s allowance instead, marked as carried below.']);
    const part = personNotes(person({ carried: 2, allowanceDiffers: true, sheet: { ...person().sheet, carriedForward: 3 } }), 2027);
    assert.match(part[0], /carries 3 days forward from 2026; the app takes 2 January days/);
    assert.equal(part[1], 'The sheet allows 33 (32, plus 1 carried forward), and the app 32.');
});

test('the other notes: undated days, a gap nothing explains, a second row', () => {
    assert.match(personNotes(person({ sheet: { ...person().sheet, undated: 1 } }), 2026)[0], /1 more day over quota with no date, so it cannot/);
    assert.match(personNotes(person({ sheet: { ...person().sheet, undated: 3 } }), 2026)[0], /3 more days over quota with no date, so they cannot/);
    assert.deepEqual(personNotes(person({ counts: { figures: 1 }, sheet: { ...person().sheet, corrected: 12 }, app: { ...person().app, remaining: 11 } }), 2026),
        ['The sheet leaves 12 and the app 11, and nothing on the sheet shows why.']);
    assert.deepEqual(personNotes(person({ otherRows: 1 }), 2026), ['The sheet lists them on 2 rows; this uses the one with their days.']);
});

test('a chip for every reason a person needs a look — a closed row in that list always says why', () => {
    for (const key of LOOK_KEYS) {
        const chips = chipsFor({ [key]: 1 });
        assert.equal(chips.length, 1, `${key} has no chip`);
        assert.equal(chips[0].key, key);
    }
    // NEEDS_A_LOOK's day states are all among them.
    for (const s of NEEDS_A_LOOK) assert.ok(LOOK_KEYS.includes(s), s);
    // An allowance that differs is a reason on its own, and comes first.
    assert.deepEqual(chipsFor({}, true), [{ key: 'allowance', text: 'allowance differs' }]);
    assert.equal(chipsFor({ 'not-in-app': 2 }, true)[0].key, 'allowance');
    // Agreement, Sundays and the explained carry-over get no chip.
    assert.deepEqual(chipsFor({ match: 30, sunday: 4, carried: 3 }), []);
});

test('the chips, singular and plural — no "2 other year" or "2 work recorded"', () => {
    const texts = (/** @type {number} */ n) => chipsFor(Object.fromEntries(LOOK_KEYS.map(k => [k, n]))).map(c => c.text);
    assert.deepEqual(texts(1), ['1 not in the app', '1 rest day to ask about', '1 costs nothing in the app', '1 from another year’s allowance',
        '1 differs', '1 with work recorded', '1 before their start date', '1 only in the app', '1 after the sheet ends',
        '1 undated over quota', 'figures differ']);
    assert.deepEqual(texts(2), ['2 not in the app', '2 rest days to ask about', '2 cost nothing in the app', '2 from another year’s allowance',
        '2 differ', '2 with work recorded', '2 before their start date', '2 only in the app', '2 after the sheet ends',
        '2 undated over quota', 'figures differ']);
});

test('the summary lines, singular and plural, for differences only', () => {
    assert.deepEqual(totalsLines({ match: 400, sunday: 30, carried: 3, people: 40, needsALook: 0 }), []);
    assert.deepEqual(totalsLines({ 'not-in-app': 1 }), ['1 day of leave on the sheet is not in the app']);
    assert.deepEqual(totalsLines({ 'not-in-app': 3 }), ['3 days of leave on the sheet are not in the app']);
    assert.deepEqual(totalsLines({}, 1), ['1 person’s allowance differs between the sheet and the app']);
    assert.deepEqual(totalsLines({ 'app-only': 2 }, 4),
        ['4 people’s allowances differ between the sheet and the app', '2 days of leave are in the app and not on the sheet']);
    assert.deepEqual(totalsLines({ undated: 8 }), ['8 days over quota are on the sheet with no date, so they cannot be checked']);
    assert.deepEqual(totalsLines({ figures: 1 }), ['1 person’s figures differ with nothing on the sheet to show why']);
    for (const key of LOOK_KEYS) {
        assert.equal(totalsLines({ [key]: 1 }).length, 1, `${key} has no summary line`);
        assert.equal(totalsLines({ [key]: 2 }).length, 1, `${key} has no summary line`);
    }
});

test('each summary line carries the kind its chips wear, so the card can colour it like them', () => {
    // The card colours a line by its key through the same declarations as the chips (operations.css),
    // so a key that is not a chip's key would leave its bullet grey with nothing failing.
    const all = Object.fromEntries(LOOK_KEYS.map(k => [k, 2]));
    const entries = totalsEntries(all, 3);
    assert.deepEqual(entries.map(e => e.key), chipsFor(all, true).map(c => c.key),
        'the summary lists its kinds in the chips’ order, the allowance first');
    assert.deepEqual(entries.map(e => e.text), totalsLines(all, 3), 'the words are totalsLines’ own');
    assert.deepEqual(totalsEntries({ match: 9 }), []);
});

test('every reason somebody is not compared has words of its own — the re-asked one too', () => {
    for (const reason of [...NOT_IMPORTED_REASONS, 'since']) assert.notEqual(reasonWords(reason), 'not compared', reason);
    assert.match(reasonWords('since'), /a new leave file would include them/);
    assert.equal(reasonWords('something-new'), 'not compared');
});

test('the age line: today, yesterday, days ago, old only PAST the limit, and unknown when the file does not say', () => {
    assert.match(ageWords({ saved: '2026-11-06T09:12:00Z', ageDays: 0, maxAge: 14 }).line, /on 6 Nov 2026 \(today\)/);
    assert.match(ageWords({ saved: '2026-11-06T09:12:00Z', ageDays: 1, maxAge: 14 }).line, /\(yesterday\)/);
    assert.equal(ageWords({ saved: '2026-11-06T09:12:00Z', ageDays: 8, maxAge: 14 }).line,
        'The clerks last saved this sheet on 6 Nov 2026 (8 days ago). Anything booked since then shows as only in the app.');
    assert.equal(ageWords({ saved: '2026-11-06T09:12:00Z', ageDays: 14, maxAge: 14 }).old, false);
    assert.equal(ageWords({ saved: '2026-11-06T09:12:00Z', ageDays: 15, maxAge: 14 }).old, true);
    // No date at all is UNKNOWN, not "more than 14 days old" — which the file cannot support (review, 14 Nov 2026).
    const unknown = ageWords({ saved: null, ageDays: null, maxAge: 14 });
    assert.deepEqual([unknown.old, unknown.unknown], [false, true]);
    assert.match(unknown.line, /does not say when/);
    assert.equal(ageWords({ saved: '2026-11-06T09:12:00Z', ageDays: 15, maxAge: 14 }).unknown, false);
    assert.doesNotMatch(CARD_WORDS.ageUnknown, /\d+ days old/);
});

test('the voice: calm, and never names the admin — the reader is the admin', () => {
    const sentences = [
        ...Object.keys(FOUND_IN).map(f => sheetWords(f, 'leave')),
        ...DAY_STATES.map(state => appWords(day({ state, appYear: 2025, swapQuestion: true }), 2026)),
        ...chipsFor(Object.fromEntries(LOOK_KEYS.map(k => [k, 2])), true).map(c => c.text),
        ...totalsLines(Object.fromEntries(LOOK_KEYS.map(k => [k, 2])), 2),
        ...[...NOT_IMPORTED_REASONS, 'since'].map(reasonWords),
        ageWords({ saved: '2026-11-06T09:12:00Z', ageDays: 20, maxAge: 14 }).line,
        beyondHeadWords(2026),
        ...personNotes(person({ allowanceDiffers: true, carried: 1, otherRows: 1, counts: { figures: 1 },
            days: [day({ foundIn: 'grid-misspelt', kind: 'leave' })],
            sheet: { ...person().sheet, carriedForward: 2, corrected: 11, undated: 2 } }), 2026),
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
    // The verb agrees with the one who needs a look, not with the forty (review, 14 Nov 2026).
    assert.equal(overallWords(1, 40), '1 of 40 people needs a look.');
    assert.equal(overallWords(1, 1), 'The one person compared needs a look.');
    assert.equal(overallWords(0, 40), 'All 40 agree with the app.');
    assert.equal(overallWords(0, 1), 'The one person compared agrees with the app.');
    assert.equal(overallWords(0, 0), 'Nobody on the sheet could be compared with the app.');
    assert.match(oldWords(14), /more than 14 days old/);
    assert.equal(unplacedWords(1), '1 Sunday tag on the sheet could not be tied to anybody the app holds.');
    assert.equal(unplacedWords(2), '2 Sunday tags on the sheet could not be tied to anybody the app holds.');
    // Which year's allowance, named — "costs nothing" said otherwise of a day charged to next year.
    assert.equal(appOnlyWords(2026), 'Costs a day of 2026’s allowance in the app');
    assert.equal(appOnlyWords(2027), 'Costs a day of 2027’s allowance in the app');
    assert.equal(appOnlyWords(null), 'Costs nothing in the app');
    assert.equal(beyondHeadWords(2026), 'Leave after the sheet ends that comes out of 2026’s allowance in the app');
    assert.equal(moreDaysWords(1), '1 more day on the sheet that agrees, or that the app cannot hold');
    assert.equal(moreDaysWords(5), '5 more days on the sheet that agree, or that the app cannot hold');
    assert.equal(notComparedWords({ name: 'Z. Example', reason: 'leaver' }), 'Z. Example — has left (not on the roster any more)');
});

test('the fixed lines: the offline one says why a cached read is not used, and the closing one where to act', () => {
    assert.match(CARD_WORDS.offline, /this device’s copy could call leave missing that isn’t/);
    assert.match(CARD_WORDS.checkOnly, /nothing has been saved/);
    assert.match(CARD_WORDS.checkOnly, /Change a Shift/);
    assert.match(CARD_WORDS.failed, /Nothing was saved/);
    for (const [key, line] of Object.entries(CARD_WORDS)) {
        assert.doesNotMatch(line, /!/, key);
        assert.doesNotMatch(line, /\bthe admin\b(?! page)/i, key);
    }
});
