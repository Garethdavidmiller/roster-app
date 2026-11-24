// @ts-check
/**
 * links-build-press.test.mjs — what the Links Build press says and remembers (links-build-press.js).
 * Run: node scripts/run-tests.mjs test/links-build-press.test.mjs   (part of `npm run test:hygiene`)
 *
 * The press itself — the confirm, the held button, the scroll anchor — is driven end to end in
 * e2e/links.spec.js. What is pinned here is the words and the bookkeeping, through the same calls the
 * press makes: `generateLink`'s real refusals, `assessTargetHours`'s real average, `reorderLines`'s
 * real result.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { overCapacityLine, refusalLine, buildConfirm, withSurplusLines, createBuildCounter, builtStatusLine } from '../links-build-press.js';
import { generateLink, ROTATING_LINES, CONTRACTED_HOURS_PER_WEEK, DAYS, hmFromHours } from '../links-design.js';
import { assessTargetHours } from '../links-target-hours.js';
import { reorderLines } from '../links-adjacency.js';
import { buildDefaultTargets } from '../links-default-targets.js';

const L = ROTATING_LINES;

describe('a table asking for more lines than the link has', () => {
    test('names the day, its count, the link\'s length and the two remedies', () => {
        assert.equal(overCapacityLine({ weekday: L + 1, sat: 3, sun: 2 }, L),
            `Can't build the link — Mon–Fri needs ${L + 1} lines (duties plus cover weeks) and the link has ${L}. `
            + 'Lower a Mon–Fri count or use fewer cover weeks.');
    });
    test('names every day over, and says nothing when the table fits', () => {
        assert.match(overCapacityLine({ weekday: L + 1, sat: L + 2, sun: 0 }, L), new RegExp(`Mon–Fri needs ${L + 1} lines, Saturday needs ${L + 2} lines .*Lower those days’ counts`));
        assert.equal(overCapacityLine({ weekday: L, sat: L, sun: L }, L), '');
    });
});

describe('each refusal names its own remedy (rule 1)', () => {
    /** A table of one duty, `n` a day, with `spare` cover weeks. @param {number} n @param {number} spare */
    const table = (n, spare) => ({ slots: [{ time: '06:20-14:20', weekday: n, sat: n, sun: 0 }], spareLines: spare });
    /** The press's own two calls, as it makes them. @param {{ slots: any[], spareLines: number }} t */
    const refuse = (t) => {
        const built = generateLink({ ...t, lines: L });
        return { built, line: refusalLine(built, { lines: L, spareLines: t.spareLines,
            hoursPerLine: assessTargetHours(t.slots, { spareLines: t.spareLines, totalLines: L }).hoursPerLine }) };
    };

    test('short of the contract: the gap, the card\'s average, and the short remedies — never "more lines"', () => {
        const t = table(2, 4);
        const { built, line } = refuse(t);
        assert.equal(built.reason, 'short-hours');
        const avg = assessTargetHours(t.slots, { spareLines: 4, totalLines: L }).hoursPerLine;
        assert.ok(line.startsWith(`Can't build the link — These targets average ${hmFromHours(/** @type {number} */ (avg))} a week across all ${L} lines, and the contract is ${CONTRACTED_HOURS_PER_WEEK}h.`), line);
        assert.match(line, /a week of duty missing across the rotation\. Add duties, lengthen them, or use more cover weeks\.$/);
        assert.doesNotMatch(line, /more lines|spare week/);
    });
    test('a table with no Mon–Sat duty has no average to quote — never "0h 00m"', () => {
        const t = { slots: [{ time: '06:20-14:20', weekday: 0, sat: 0, sun: 3 }], spareLines: 4 };
        const { built, line } = refuse(t);
        assert.equal(built.reason, 'short-hours');
        assert.match(line, /^Can't build the link — These targets hold no duty from Monday to Saturday, and the contract is \d+h a week\./);
        assert.doesNotMatch(line, /0h 00m a week across/);
    });
    test('over the contract: the opposite remedies, and why a surplus is not a lesser fault', () => {
        const { built, line } = refuse(table(L - 4, 4));
        assert.equal(built.reason, 'over-hours');
        assert.match(line, /a week of duty more than the rotation is paid for\. Remove duties, shorten them, or use fewer cover weeks — the surplus would be permanent overtime nobody has agreed to\.$/);
    });
    test('no rest day: said only when a week asks more than six duties of each working line, as `cappedStarts` refuses', () => {
        const working = L - 1;
        const slots = [{ time: '06:20-14:20', weekday: working, sat: working, sun: working }];
        const built = generateLink({ slots, spareLines: 1, lines: L, settled: false, requireContract: false, requireRest: false });
        assert.equal(built.reason, 'no-rest');
        assert.ok(DAYS.length * working > 6 * working, 'the week asks more than six duties of each working line');
        assert.equal(refusalLine(built, { lines: L, spareLines: 1 }),
            "Can't build the link — these targets ask for more than six duties a week from each working line, so not every line can have a rest day. Reduce a day's headcount, or use fewer cover weeks.");
    });
    test('short rest names the gap and the minimum, in shifts', () => {
        assert.match(refusalLine({ reason: 'short-rest', shortRest: 11 * 60 + 45 }, { lines: L, spareLines: 4 }),
            /^Can't build the link — one shift would follow another with only 11h 45m rest, and the minimum is 12h 00m\. No arrangement of these lines fixes it\./);
    });
    test('a cover-week count that leaves no working line, and anything else', () => {
        assert.equal(refusalLine({ reason: 'bad-spare-lines' }, { lines: L, spareLines: L }),
            `Can't build the link — ${L} cover weeks leaves no working lines. Cover weeks must be fewer than the ${L} lines.`);
        assert.equal(refusalLine({ reason: 'bad-time' }, { lines: L, spareLines: 4 }),
            "Can't build the link — check every row has a valid time and whole-number targets.");
    });
});

describe('the question before a build replaces what is on screen', () => {
    test('a drawn design: what is replaced, that the saved version stays, and the loss only when there is one', () => {
        const clean = buildConfirm({ lines: L, name: 'Option A', proposal: false, dirty: false, hasWork: true });
        assert.deepEqual(clean, { title: 'Build the link', confirmLabel: 'Build', danger: true,
            message: `This replaces all ${L} lines of “Option A” on screen with the built pattern. The saved version stays as it is until you press Save.` });
        assert.match(buildConfirm({ lines: L, name: 'Option A', proposal: false, dirty: true, hasWork: true }).message, / Your unsaved changes will be lost\.$/);
    });
    test('a proposal is not replaced, and a blank design loses nothing', () => {
        const p = buildConfirm({ lines: L, name: 'Middle Ground', proposal: true, dirty: false, hasWork: true });
        assert.equal(p.message, 'A new design opens with the built pattern. “Middle Ground” stays in the shortlist.');
        assert.equal(p.danger, false);
        const blank = buildConfirm({ lines: L, name: '', proposal: false, dirty: false, hasWork: false });
        assert.equal(blank.message, `Build the pattern into all ${L} lines?`);
        assert.equal(blank.danger, false);
    });
});

describe('lines past the rotation are kept (rule 6)', () => {
    test('a longer design keeps its surplus lines; the rotation\'s own are the built ones', () => {
        const built = { 1: { mon: '06:20-14:20' } };
        const previous = { 1: { mon: 'RD' }, [L + 1]: { mon: '07:00-15:00' }, [L + 2]: { mon: 'RD' } };
        assert.deepEqual(withSurplusLines(built, previous, L), { 1: { mon: '06:20-14:20' }, [L + 1]: { mon: '07:00-15:00' }, [L + 2]: { mon: 'RD' } });
        assert.equal(withSurplusLines(built, { 1: {} }, L), built, 'nothing to carry: the built patterns themselves');
    });
});

describe('pressing again explores, numbered the same everywhere (rule 5)', () => {
    test('same inputs advance the attempt; any change goes back to the first build', () => {
        const c = createBuildCounter();
        assert.deepEqual([c.next('a'), c.next('a'), c.next('a'), c.next('b'), c.next('b')], [0, 1, 2, 0, 1]);
    });
    test('the first build invites another; a better one says so; a worse one says how to get the best back', () => {
        const c = createBuildCounter();
        c.next('a');
        assert.equal(c.explore('o1', 10), ' Press Build again for a different line order — same cover, different arrangement.');
        c.next('a');
        assert.equal(c.explore('o2', 5), ' The best arrangement so far on the ticked objectives.');
        c.next('a');
        assert.equal(c.explore('o3', 9), ' Design 2 scored better on the ticked objectives — close and reopen Links, then press Build the link 2 times to get it back.');
    });
    test('an order already seen is that design again, never renumbered — and new inputs forget it', () => {
        const c = createBuildCounter();
        c.next('a'); c.explore('o1', 10);
        c.next('a');
        assert.equal(c.explore('o1', 10), ' Same arrangement as design 1 — press Build again to keep exploring.');
        c.next('b');
        assert.match(c.explore('o1', 10), /^ Press Build again/);
    });
});

describe('the line a build reports names its construction and its figures as the checkboxes do', () => {
    const built = generateLink({ ...buildDefaultTargets(), lines: L });
    const on = { variety: true, maxRun: true, gentle: true, weekends: true, longWeekends: true };
    test('settled weeks, with the figures before → after', () => {
        assert.equal(built.mode, 'settled');
        const ord = reorderLines(/** @type {any} */ (built.patterns), { on, attempt: 0 });
        const line = builtStatusLine(built, ord, { attempt: 0, maxRunOn: true, maxRunTarget: 99, explore: ' X' });
        assert.ok(line.startsWith(`Link built — each line kept to one wave of similar start times (${built.waves} waves)`), line);
        const b = ord.before, a = ord.after;
        assert.ok(line.includes(`same shift type in a row ${b.longestBlock} → ${a.longestBlock} weeks, shifts in a row ${b.longestRun} → ${a.longestRun}, `
            + `average week-to-week move ${b.gentleMean} → ${a.gentleMean} min, full weekends off ${b.weekends} → ${a.weekends}, long weekends ${b.longWeekends} → ${a.longWeekends}.`), line);
        assert.ok(line.endsWith(' X'));
    });
    test('the fallback, a missed run cap, and the design number after the first press', () => {
        const ord = { changed: true, before: { longestBlock: 3, longestRun: 9, gentleMean: 1, weekends: 1, longWeekends: 1 },
            after: { longestBlock: 3, longestRun: 8, gentleMean: 1, weekends: 1, longWeekends: 1 } };
        const line = builtStatusLine({ mode: 'rotating' }, ord, { attempt: 2, maxRunOn: true, maxRunTarget: 6, explore: '' });
        assert.ok(line.startsWith('Design 3 — Link built — lines move across the whole day (the targets would not fit one wave per line)'), line);
        assert.match(line, / Shifts in a row came down only to 8 \(target 6\) without giving up more elsewhere — turn other objectives off to push it further\.$/);
        assert.doesNotMatch(builtStatusLine({ mode: 'rotating' }, ord, { attempt: 0, maxRunOn: false, maxRunTarget: 6, explore: '' }), /came down only/);
    });
    test('an order left alone says to review and save', () => {
        assert.equal(builtStatusLine({ mode: 'settled', waves: 1 }, { changed: false, before: {}, after: {} }, { attempt: 0, maxRunOn: false, maxRunTarget: 6, explore: '' }),
            'Link built — each line kept to one wave of similar start times (1 wave). Review and save when ready.');
    });
});
