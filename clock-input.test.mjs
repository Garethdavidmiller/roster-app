import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isClockTime, formatClockInput } from './clock-input.js';

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
        assert.equal(formatClockInput('6300'), '06:30', 'the trailing zero somebody types anyway changes nothing');
        assert.equal(formatClockInput('123'), '12:3', 'a three-digit entry that could still be a valid hour is left to finish');
    });
    it('anything beyond four digits, and anything that is not a digit, is dropped', () => {
        assert.equal(formatClockInput('07:30:00'), '07:30');
        assert.equal(formatClockInput('ab'), '');
        assert.equal(formatClockInput(''), '');
        assert.equal(formatClockInput(/** @type {any} */ (null)), '');
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
