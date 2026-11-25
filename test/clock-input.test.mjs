// @lane hygiene
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isClockTime, formatClockInput, finaliseClockInput, shapeClockBox, settleClockBox } from '../clock-input.js';

// clock-input.test.mjs — the two rules of a TEXT clock box, moved here with the module at v24.61.
// Organised by cost: accepting nonsense is the expensive direction for `isClockTime` (a `29:00`
// reaches every duration helper downstream), and for `formatClockInput` it is shaping a value the
// guard will then refuse — which from a phone reads as a box that cannot be filled.

describe('formatClockInput — a numeric keypad has no colon, so the box supplies it (v24.61)', () => {
    it('four digits become HH:MM, and are what isClockTime then accepts', () => {
        assert.equal(formatClockInput('0730'), '07:30');
        assert.equal(formatClockInput('2355'), '23:55');
        assert.equal(isClockTime(formatClockInput('0730')), true);
    });
    it('the colon goes in after the hour as soon as there is one, and a typed colon is not doubled', () => {
        assert.equal(formatClockInput('0'), '0');
        assert.equal(formatClockInput('07'), '07');
        assert.equal(formatClockInput('073'), '07:3');
        assert.equal(formatClockInput('07:30'), '07:30');
        assert.equal(formatClockInput('7:30'), '07:30', 'a dropped leading zero is restored');
    });
    it('"630" is 06:30, never 63:0 — the week editor\'s own three-digit rule, applied as it is typed', () => {
        assert.equal(formatClockInput('630'), '06:30');
        assert.equal(formatClockInput('123'), '12:3', 'a three-digit entry that could still be a valid hour is left to finish');
    });
    it('a four-digit run that is not a time is left for isClockTime to refuse — never reshaped into one (24-hour review)', () => {
        // The first cut padded any run whose first pair exceeded 23, so a typed "2400" (a midnight
        // finish, which the roster writes 00:00) became the VALID time 02:40 and saved.
        assert.equal(formatClockInput('2400'), '24:00');
        assert.equal(isClockTime(formatClockInput('2400')), false);
        assert.equal(formatClockInput('6300'), '63:00');
        assert.equal(isClockTime(formatClockInput('6300')), false);
        assert.equal(formatClockInput('06300'), '06:30', 'the trailing zero somebody types after a shaped 630 changes nothing');
    });
    it('anything beyond four digits, and anything that is not a digit, is dropped', () => {
        assert.equal(formatClockInput('07:30:00'), '07:30');
        assert.equal(formatClockInput('ab'), '');
        assert.equal(formatClockInput(''), '');
        assert.equal(formatClockInput(/** @type {any} */ (null)), '');
    });
});

// ── A BOX IS FILLED ONE KEY AT A TIME (whole-app review, Oct 2026) ───────────────────────────────
//
// Every assertion above feeds a WHOLE string, and "2400" passed as a whole string while the box
// saved 02:40: after "240" the shaper read a dropped zero, the box held "02:40" — five characters,
// full — and the last 0 of a midnight finish was never typed. `type` fills a maxlength-5 box the
// way the input handler sees it, so the test meets the box as a person does.
describe('a box filled key by key, and settled only when it is left', () => {
    /** @param {string} keys */
    const type = (keys) => {
        let v = '';
        for (const k of keys) { if ((v + k).length <= 5) v = formatClockInput(v + k); }
        return v;
    };
    it('"2400" typed key by key is 24:00 and refused — never the valid 02:40 it used to fill itself with', () => {
        assert.equal(type('2400'), '24:00');
        assert.equal(isClockTime(type('2400')), false);
        assert.equal(isClockTime(finaliseClockInput(type('2400'))), false, 'leaving the box must not rescue it into a time nobody typed');
    });
    it('every first pair from 24 to 29 waits for its fourth key', () => {
        for (const keys of ['2400', '2530', '2615', '2959']) {
            assert.equal(type(keys), `${keys.slice(0, 2)}:${keys.slice(2)}`, keys);
            assert.equal(isClockTime(type(keys)), false, keys);
        }
    });
    it('three such digits LEFT in the box are a dropped zero — 240 is 02:40 once nothing more is coming', () => {
        assert.equal(type('240'), '24:0', 'still typing: it may yet be 2400');
        assert.equal(finaliseClockInput(type('240')), '02:40');
        assert.equal(finaliseClockInput(type('253')), '02:53');
    });
    it('a first digit of 3 to 9 begins no hour, so it is settled as it is typed', () => {
        assert.equal(type('630'), '06:30');
        assert.equal(type('0730'), '07:30');
        assert.equal(type('2355'), '23:55');
    });
    it('leaving a box changes nothing that is already a time, or already impossible, or unfinished', () => {
        for (const v of ['06:30', '23:55', '00:00', '24:00', '19:75', '19:9', '07', ''])
            assert.equal(finaliseClockInput(v), formatClockInput(v), v);
    });
    // …and ANY three digits left are a dropped zero when that reads as a time (owner, 24 Nov 2026): "130" stayed
    // "13:0" and was refused at Save, though it can only mean 01:30.
    it('three digits left in the box read as a dropped zero whenever that is a time — 130 is 01:30', () => {
        assert.equal(type('130'), '13:0', 'still typing: it may yet be 1300');
        assert.equal(finaliseClockInput(type('130')), '01:30');
        assert.equal(finaliseClockInput(type('123')), '01:23');
        assert.equal(finaliseClockInput(type('059')), '00:59');
        assert.equal(finaliseClockInput('1:30'), '01:30', 'a keyboard that types the colon');
        assert.equal(finaliseClockInput(type('199')), '19:9', 'no time either way: left as typed');
    });
});

describe('isClockTime — the guard TEXT boxes need and `<input type="time">` gave for free', () => {
    // Two places in the app type times into text: the roster review's entry control and Overtime's
    // custom-hours row. Both refused `type="time"` on a measurement (12-hour rendering from the OS
    // against 24-hour badges), and the price is that nothing in the browser validates any more.
    // The expensive direction is ACCEPTING nonsense: `29:00` reaches every duration helper
    // downstream and is read as a real shift, silently.
    it('a real time is accepted at both ends of the day', () => {
        for (const v of ['00:00', '06:00', '13:30', '23:59']) assert.equal(isClockTime(v), true, v);
    });
    it('the shape of a time is not a time', () => {
        // Each of these matches /^\d{2}:\d{2}$/ and none of them is a clock time.
        for (const v of ['29:00', '99:99', '24:00', '25:61']) assert.equal(isClockTime(v), false, v);
    });
    it('24:00 is refused specifically, because midnight is written 00:00', () => {
        // `15:00-00:00` appears on the real Supervisor sheet; an overnight range is end < start.
        assert.equal(isClockTime('24:00'), false);
        assert.equal(isClockTime('00:00'), true);
    });
    it('anything that is not two-and-two is refused, including the half-typed', () => {
        for (const v of ['6:00', '06:0', '0600', '9am', '', ':30', '06:00 ', null, undefined])
            assert.equal(isClockTime(/** @type {any} */ (v)), false, String(v));
    });
});

// ── AN EDIT IS NOT A NEW TIME TYPED SHORT (external review of v26.79) ───────────────────────────────
// An admin opened 22:30, deleted the last 0 and left the box: "22:3", the digits 223, which the
// dropped-zero reading settled as 02:23 — a valid time, so it saved. These drive a box the way the
// pages do: `shapeClockBox` on every input event, `settleClockBox` when the box is left.
describe('a box remembers whether its digits are what is left of a time', () => {
    /** A box as the page has it, holding `value`, and a key pressed into it. */
    const box = (value = '') => ({ value });
    /** @param {{ value: string }} b @param {string} digit */
    const key = (b, digit) => { b.value += digit; b.value = shapeClockBox(b, { inputType: 'insertText' }); };
    /** Backspace at the end of the box (a colon left trailing goes with it, as on a phone). @param {{ value: string }} b */
    const backspace = b => { b.value = b.value.slice(0, -1).replace(/:$/, ''); b.value = shapeClockBox(b, { inputType: 'deleteContentBackward' }); };

    it('22:30 with its last digit deleted stays unfinished when left — never 02:23', () => {
        const b = box('22:30');   // drawn by the page from a stored time; never typed in
        backspace(b);
        assert.equal(b.value, '22:3');
        assert.equal(settleClockBox(b), '22:3');
        assert.equal(isClockTime(settleClockBox(b)), false, 'refused at Save like any unfinished time');
    });

    it('the same when the time was typed in this visit, then edited', () => {
        const b = box();
        for (const d of '2235') key(b, d);
        assert.equal(b.value, '22:35');
        backspace(b);
        assert.equal(settleClockBox(b), '22:3');
        backspace(b);
        key(b, '5');
        assert.equal(settleClockBox(b), '22:5', 'two digits deleted and one typed is still what is left of 22:35');
    });

    it('deleting the first digit of 16:30 does not make it 06:30 as it is typed', () => {
        const b = box('16:30');
        b.value = '6:30';
        b.value = shapeClockBox(b, { inputType: 'deleteContentBackward' });
        assert.equal(b.value, '6:30', 'the box keeps what is there, colon and all');
        assert.equal(settleClockBox(b), '6:30');
        assert.equal(isClockTime(settleClockBox(b)), false, 'refused at Save, never guessed as 06:30');
    });

    // The three gaps the 24-hour review found (25 Nov 2026), each the module header's rule of that number.
    it('rule 1: an edit keeps the colon where it was, so the digit typed next lands where it is typed', () => {
        const b = box();
        for (const d of '2230') key(b, d);
        b.value = '2:30';                          // the first 2 deleted, the caret left before the remaining 2
        b.value = shapeClockBox(b, { inputType: 'deleteContentBackward' });
        assert.equal(b.value, '2:30', 'not re-split as 23:0, which threw the caret to the end');
        b.value = '12:30';                         // the 1 typed where the 2 was
        b.value = shapeClockBox(b, { inputType: 'insertText', data: '1' });
        assert.equal(b.value, '12:30');
        assert.equal(settleClockBox(b), '12:30');
    });

    it('rule 2: typing over part of a time is an edit too — never 02:24', () => {
        for (const start of [() => { const b = box(); for (const d of '2230') key(b, d); return b; }, () => box('22:30')]) {
            const b = start();
            b.value = '22:4';                      // the 30 selected, a 4 typed over it
            b.value = shapeClockBox(b, { inputType: 'insertText', data: '4' });
            assert.equal(b.value, '22:4');
            assert.equal(settleClockBox(b), '22:4', 'what is left of 22:30, refused at Save');
        }
    });

    it('rule 2: replacing the WHOLE time is a new one, with its shortcut', () => {
        const b = box('22:30');
        b.value = '630';                           // all of it selected, 630 pasted over it
        b.value = shapeClockBox(b, { inputType: 'insertFromPaste', data: '630' });
        assert.equal(b.value, '06:30');
        assert.equal(settleClockBox(b), '06:30');
    });

    it('rule 4: an edit finished as a time ends, so a time pasted in later keeps its shortcut', () => {
        const b = box();
        for (const d of '2235') key(b, d);
        backspace(b);
        key(b, '5');
        assert.equal(b.value, '22:35');
        b.value = '130';
        b.value = shapeClockBox(b, { inputType: 'insertFromPaste', data: '130' });
        assert.equal(settleClockBox(b), '01:30');
    });

    it('a new time typed short still takes its zero: 130 is 01:30 and 630 is 06:30', () => {
        const a = box();
        for (const d of '130') key(a, d);
        assert.equal(a.value, '13:0', 'still typing: it may yet be 1300');
        assert.equal(settleClockBox(a), '01:30');
        const c = box();
        for (const d of '630') key(c, d);
        assert.equal(c.value, '06:30');
    });

    it('emptying the box starts a new time, so the shortcut comes back', () => {
        const b = box('22:30');
        while (b.value) backspace(b);
        for (const d of '130') key(b, d);
        assert.equal(settleClockBox(b), '01:30');
        // Select-all and type is the same: the first key leaves one digit.
        const s = box('22:30');
        s.value = '1'; s.value = shapeClockBox(s, { inputType: 'insertText' });
        key(s, '3'); key(s, '0');
        assert.equal(settleClockBox(s), '01:30');
        // …even after an edit in the same visit: one digit left is a new start, whatever came before.
        const e = box('22:30');
        backspace(e);
        e.value = '1'; e.value = shapeClockBox(e, { inputType: 'insertText' });
        key(e, '3'); key(e, '0');
        assert.equal(settleClockBox(e), '01:30');
    });

    it('a slip while typing a new time is not an edit: 1, 3, 5, delete, 0 is 01:30', () => {
        const b = box();
        for (const d of '135') key(b, d);
        backspace(b);
        key(b, '0');
        assert.equal(settleClockBox(b), '01:30');
    });

    it('a box the page has set since it was last typed in is read the safe way', () => {
        const b = box();
        for (const d of '13') key(b, d);
        b.value = '22:3';   // not by a key: the page put it there
        assert.equal(settleClockBox(b), '22:3');
    });

    it('a box never typed in keeps what it holds', () => {
        assert.equal(settleClockBox(box('07:00')), '07:00');
        assert.equal(settleClockBox(box('')), '');
    });
});
