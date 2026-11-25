// @ts-check
/**
 * e2e/clock-box-properties.spec.js — a REAL text clock box, driven through random edit sequences in a
 * real browser, with the rules checked after every one (maintainability item, 25 Nov 2026).
 *
 * ── WHY A MACHINE WRITES THESE SEQUENCES ─────────────────────────────────────────────────────────
 *
 * Two defects shipped past every unit test in clock-input.test.mjs, and both for the same reason: a
 * unit test IMITATES the box — it writes the value it thinks the browser would hold and calls the
 * shaper — and the imitation was wrong where the bug was. (1) The "30" of 22:30 selected, a 4 typed
 * over it and the box left settled to 02:24, a valid time nobody typed. (2) The first 2 of 22:30
 * deleted re-split the box to "23:0", which put the caret at the END, so the 1 typed to make 12:30
 * made 23:01. Both were fixed on 25 Nov 2026; the hand-written sequences in admin-week-grid.spec.js now pin
 * them. This spec is for the NEXT one: it lets a seeded generator choose the sequences, and the
 * browser — not an imitation — decide what each key does.
 *
 * ── THE BOX, AND HOW IT IS RESET ─────────────────────────────────────────────────────────────────
 *
 * The finish box of the first Admin week-grid row that takes a Shift (admin-time-inputs.js wires it
 * to `shapeClockBox` on input and `settleClockBox` on focusout, as every clock box is). The page is
 * opened ONCE per block and the box reset between sequences, which is what keeps a block to seconds.
 * Each sequence begins in one of four states:
 *   • empty — everything selected and deleted with a real Backspace;
 *   • typed — emptied, then a time typed key by key, caret at its end;
 *   • page  — the box emptied, sometimes a few keys typed, then a time ASSIGNED to it by script, as the
 *             page does when it prefills or redraws a row, with the caret where a tap put it — so the
 *             box's memory holds what was typed, not what it now shows;
 *   • drawn — the same, on a box the page has just DRAWN: the element is replaced by a clone, so its
 *             memory (the WeakMap in clock-input.js) has never seen it, as after `renderWeekGrid`.
 * Then one to eight actions, each a real key: a digit, Backspace, Delete, ArrowLeft/Right, Home/End,
 * Shift+Arrow and Shift+Home/End selection, select-all then a digit, select-all then a real clipboard
 * paste, or a paste at the caret. Then the box is LEFT (focus moves to the start box), which runs the
 * page's own settle.
 *
 * ── THE ORACLE ───────────────────────────────────────────────────────────────────────────────────
 *
 * Three listeners on `window` record every edit without touching it: `beforeinput` (capture) — the
 * box and its selection before the key; `input` (capture, before the page's handler) — the RAW value
 * the browser made; `input` (bubble, after the page's handler) — the SHAPED value and where the caret
 * now is. The oracle reads only those, and its own definition of a time (`isTime`, which agrees with
 * `isClockTime`); it never calls the rules it judges.
 *
 * ONE PIECE OF STATE: whether a leading 0 may still be supplied — the "window". A 0 the member did not
 * type is a shortcut for a NEW time typed short ("630" → 06:30, "130" left → 01:30), and never for
 * what is left of an old one. The window is OPEN from an empty box; it CLOSES when a key deletes from,
 * or types over part of, a complete time the box shows; it OPENS again when the box is down to one
 * digit or none, or when a key replaces EVERY digit in it (select all, then type or paste — rule 2's
 * "a new time, shortcuts and all"). A slip while typing a new time ("135", Backspace) does not close
 * it: what was deleted from was no time. The checks:
 *   (a) SHAPE — every value the box shows, and the value it settles to, is digits and at most one
 *       colon, at most four digits: either a valid HH:MM or something `isClockTime` refuses.
 *   (b) NO INVENTED TIME — if the settled value is a valid time, its digits are the digits visible
 *       when the box was left, or those with ONE leading 0, and the 0 only while the window is open.
 *       The same holds for every reshape while typing (the digits typed, past the fourth dropped).
 *   (c) A held time, only NAVIGATED (no key changed the value), settles unchanged.
 *   (d) A KEY LANDS WHERE THE CARET WAS PUT — when the page reshapes the box, the caret keeps the
 *       same number of digits before it (one more if a 0 was supplied). The colon may move; the caret
 *       may not jump past a digit. Bug (2) above is this check: "2:30" with the caret at 0 re-split
 *       to "23:0" with it at the end. (b) alone cannot see it — 23:01 is the digits the box showed.
 *   (e) THE SHORTCUT STILL HAPPENS — the other direction (review, 25 Nov 2026). While the window is open,
 *       three digits starting 3 to 9 show with their 0 at once, and three left in the box settle with it
 *       when that reads as a time ("130" → 01:30). (a)–(d) only ask that nothing is invented, so a shortcut
 *       that stopped happening — or one that came back too eagerly, "2400" padded to 02:40 — passed them.
 *
 * ── SEEDS, REPLAY, AND COST ──────────────────────────────────────────────────────────────────────
 *
 * The seeds are FIXED, so CI runs the same sequences every time and a red run is never luck; a
 * failure prints the seed, the sequence (shrunk to the fewest actions that still fail), each value
 * the box held, and a one-line replay. To explore further, `CLOCK_BOX_SEED=<n>` moves every block's
 * seed and `CLOCK_BOX_RUNS=<n>` sets the sequences per block; `CLOCK_BOX_REPLAY='<json>'` runs one
 * printed sequence alone. A block collects the first counterexample of EACH check before failing,
 * so one defect does not hide another.
 *
 * WHAT IT HAS FOUND. Written against clock-input.js as it stood before 25 Nov 2026 (`257b5313`), it finds both
 * shipped defects: the exact 22:54 → "22:4" → 02:24 under (b), and the re-split of "2:30" under (d). It then found
 * two more in the code that fixed them — a deleted colon put back with the caret thrown to the end, and a box the
 * page wrote judged by a stale memory (rules 5 and 6) — and a model of it run 200,000 times found the gaps in
 * those fixes that rule 7 closed: a page-written time beginning with the member's own digits, and a paste,
 * composition or autofill over part of a time. Each is in clock-input.js's header.
 *
 * Desktop projects only (`chromium`, `webkit`): the keys reach the box the same way under touch
 * emulation, so the phone projects would double the minutes and prove nothing new. Keys go through
 * `page.keyboard`, not `locator.press`, because the box keeps focus throughout and an actionability
 * wait per key is most of a sequence's cost.
 */
import { test, expect } from './fixtures.js';
import { seedSession, clickInView, isTouchProject, collectFatalErrors } from './helpers.js';

// ── The generator ─────────────────────────────────────────────────────────────────────────────

/** mulberry32: a small seeded PRNG, so a printed seed replays exactly. @param {number} seed */
function prng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** @template T @param {() => number} rnd @param {Array<[T, number]>} table @returns {T} */
function weighted(rnd, table) {
    let r = rnd() * table.reduce((n, [, w]) => n + w, 0);
    for (const [v, w] of table) { if ((r -= w) < 0) return v; }
    return table[table.length - 1][0];
}

// Times whose digits make the dangerous readings likely: a first digit of 1 or 2, so three digits left
// of them read as a time with a zero dropped (22:4 → 02:24), and the two times the shipped bugs used.
const FAVOURITE_TIMES = ['22:30', '16:30', '12:30', '23:45', '21:15', '13:05', '10:20', '19:30'];
// What a 'page' box was last typed to before the page wrote its time: its memory, which the next key is judged by.
// Two-digit priors that BEGIN a favourite time matter most: the page writes the time back over what the member typed
// (Links' window editor does), and a memory that matched the new time's start fooled rule 5 (review, 25 Nov 2026).
const PRIORS = ['', '7', '13', '223', '2230', '0915', '10', '22', '19', '1', '135'];
const PASTES = ['630', '130', '1:30', '0730', '22:30', '2400', '12', '7', '9:5', '12345', '1a3', '4', '8', '5', '1'];

/** @param {() => number} rnd */
function randomTime(rnd) {
    if (rnd() < 0.5) return FAVOURITE_TIMES[Math.floor(rnd() * FAVOURITE_TIMES.length)];
    const h = rnd() < 0.7 ? 10 + Math.floor(rnd() * 14) : Math.floor(rnd() * 10);
    const m = Math.floor(rnd() * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Low digits more often: they make valid times, which is where an invented time can hide. @param {() => number} rnd */
const randomDigit = rnd => String(rnd() < 0.6 ? Math.floor(rnd() * 4) : Math.floor(rnd() * 10));

/**
 * @typedef {{ kind: 'empty' | 'typed' | 'page' | 'drawn', value: string, caret: number, prior: string }} Start
 * @typedef {{ start: Start, actions: string[] }} Sequence
 */

/** One random sequence. @param {() => number} rnd @returns {Sequence} */
function randomSequence(rnd) {
    const kind = weighted(rnd, /** @type {Array<[Start['kind'], number]>} */ ([['empty', 2], ['typed', 2.5], ['page', 3], ['drawn', 2.5]]));
    const value = kind === 'empty' ? '' : randomTime(rnd);
    const caret = kind === 'page' || kind === 'drawn' ? Math.floor(rnd() * 6) : value.length;
    const prior = kind === 'page' ? PRIORS[Math.floor(rnd() * PRIORS.length)] : '';
    const n = 1 + Math.floor(rnd() * 8);
    /** @type {string[]} */
    const actions = [];
    for (let i = 0; i < n; i++) {
        const a = weighted(rnd, [
            ['digit', 7], ['Backspace', 3], ['Delete', 2], ['ArrowLeft', 2], ['ArrowRight', 2],
            ['Home', 1.5], ['End', 1.5], ['Shift+ArrowLeft', 2.5], ['Shift+ArrowRight', 1.5],
            ['Shift+Home', 0.5], ['Shift+End', 0.5], ['all-digit', 1], ['all-paste', 1], ['paste', 0.5],
        ]);
        if (a === 'digit') actions.push(randomDigit(rnd));
        else if (a === 'all-digit') actions.push(`all+${randomDigit(rnd)}`);
        else if (a === 'all-paste') actions.push(`all+paste:${PASTES[Math.floor(rnd() * PASTES.length)]}`);
        else if (a === 'paste') actions.push(`paste:${PASTES[Math.floor(rnd() * PASTES.length)]}`);
        else if (a.startsWith('Shift+Arrow') && rnd() < 0.5) {
            // A selection is usually more than one key wide (the "30" of 22:30), and a key typed over it is
            // where both shipped bugs began, so a selecting key is often doubled and followed by a digit.
            actions.push(a, a);
            // …and as often by a single digit PASTED over it — a paste, a composition and an autofill are
            // changes too, and only a typed key used to count as typing over (review, 25 Nov 2026).
            if (rnd() < 0.5) actions.push(rnd() < 0.3 ? `paste:${randomDigit(rnd)}` : randomDigit(rnd));
        } else actions.push(a);
    }
    return { start: { kind, value, caret, prior }, actions };
}

// ── Driving the box ───────────────────────────────────────────────────────────────────────────

const BOX = '[data-property-box]';
const LEAVE = '[data-property-leave]';

/** Open Admin, put a row into Shift so its time boxes are live, and listen to the finish box.
 *  @param {import('@playwright/test').Page} page @param {import('@playwright/test').BrowserContext} context */
async function openBox(page, context) {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});   // Chromium needs it for a real paste
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    const row = page.locator('.day-row').filter({ has: page.locator('.type-pill-btn[data-type="shift"]:not([disabled])') }).first();
    await clickInView(row.locator('.type-pill-btn[data-type="shift"]'));
    await expect(row.locator('.day-end'), 'premise: Shift prefills the rostered finish').toHaveValue(/^\d\d:\d\d$/);
    await row.evaluate(r => {
        r.querySelector('.day-end')?.setAttribute('data-property-box', '');
        r.querySelector('.day-start')?.setAttribute('data-property-leave', '');
        const w = /** @type {any} */ (window);
        w.__clockLog = [];
        /** @param {Event} e */
        const box = e => e.target instanceof HTMLInputElement && e.target.hasAttribute('data-property-box') ? e.target : null;
        /** @param {string} t @returns {(e: Event) => void} */
        const rec = t => e => {
            const b = box(e);
            if (!b) return;
            const ie = /** @type {InputEvent} */ (e);
            w.__clockLog.push({ t, type: ie.inputType ?? '', data: ie.data ?? null, v: b.value, s: b.selectionStart, e: b.selectionEnd });
        };
        window.addEventListener('beforeinput', rec('before'), true);
        window.addEventListener('input', rec('raw'), true);
        window.addEventListener('input', rec('shaped'), false);
    });
}

/** Put the box into a sequence's starting state; returns the value it then holds. Every state is built from
 *  scratch, the box's memory included, so a printed sequence replays alone exactly as it ran in its block.
 *  @param {import('@playwright/test').Page} page @param {Start} start @returns {Promise<string>} */
async function begin(page, start) {
    if (start.kind !== 'drawn') {
        const held = await page.evaluate(sel => {
            const b = /** @type {HTMLInputElement} */ (document.querySelector(sel));
            b.focus();
            b.select();
            return b.value;
        }, BOX);
        if (held) await page.keyboard.press('Backspace');
        const keys = start.kind === 'typed' ? start.value.replace(':', '') : start.kind === 'page' ? start.prior : '';
        if (keys) await page.keyboard.type(keys);
    }
    return page.evaluate(({ sel, kind, value, caret }) => {
        let b = /** @type {HTMLInputElement} */ (document.querySelector(sel));
        if (kind === 'drawn') { const c = /** @type {HTMLInputElement} */ (b.cloneNode(true)); b.replaceWith(c); b = c; }
        if (kind === 'page' || kind === 'drawn') {
            b.value = value;
            b.focus();
            b.setSelectionRange(caret, caret);
        }
        /** @type {any} */ (window).__clockLog = [];
        return b.value;
    }, { sel: BOX, ...start });
}

/** One action, as real keys. @param {import('@playwright/test').Page} page @param {string} a */
async function act(page, a) {
    let rest = a;
    if (rest.startsWith('all+')) { await page.keyboard.press('ControlOrMeta+a'); rest = rest.slice(4); }
    if (rest.startsWith('paste:')) {
        await page.evaluate(text => navigator.clipboard.writeText(text), rest.slice(6));
        await page.keyboard.press('ControlOrMeta+v');
    } else {
        await page.keyboard.press(rest);
    }
}

/**
 * @typedef {{ t: string, type: string, data: string | null, v: string, s: number, e: number }} Entry
 * @typedef {{ start: string, left: string, settled: string, log: Entry[] }} Outcome
 */

/** Run one sequence end to end. A paste that did not carry the text written to the clipboard (another
 *  writer reached it first) is the harness's fault, not the box's, so the sequence is run again.
 *  @param {import('@playwright/test').Page} page @param {Sequence} seq @returns {Promise<Outcome>} */
async function run(page, seq) {
    const pasted = seq.actions.filter(a => a.includes('paste:')).map(a => a.slice(a.indexOf('paste:') + 6));
    for (let attempt = 1; ; attempt++) {
        const start = await begin(page, seq.start);
        for (const a of seq.actions) await act(page, a);
        /** @type {Omit<Outcome, 'start'>} */
        const out = await page.evaluate(async ({ box, leave }) => {
            const b = /** @type {HTMLInputElement} */ (document.querySelector(box));
            const left = b.value;
            /** @type {HTMLElement} */ (document.querySelector(leave)).focus();
            await new Promise(r => setTimeout(r, 0));
            return { left, settled: b.value, log: /** @type {any} */ (window).__clockLog };
        }, { box: BOX, leave: LEAVE });
        const got = out.log.filter(x => x.t === 'before' && x.type === 'insertFromPaste').map(x => x.data);
        if (got.every((d, i) => d === null || d === pasted[i]) || attempt === 3) {
            expect(got.every((d, i) => d === null || d === pasted[i]), `premise: each paste carried the text written for it (${JSON.stringify(got)})`).toBe(true);
            return { start, ...out };
        }
    }
}

// ── The oracle ────────────────────────────────────────────────────────────────────────────────

/** A real HH:MM — the oracle's own, equal to `isClockTime`. @param {string} v */
const isTime = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
/** @param {string} v */
const digits = v => v.replace(/[^0-9]/g, '');
/** Digits and at most one colon, at most four digits. @param {string} v */
const wellFormed = v => /^[0-9:]*$/.test(v) && (v.match(/:/g) ?? []).length <= 1 && digits(v).length <= 4;

/**
 * @typedef {{ check: string, why: string }} Violation
 */

/** Every rule the outcome breaks (the first per check). @param {Sequence} seq @param {Outcome} o @returns {Violation[]} */
function judge(seq, o) {
    /** @type {Map<string, string>} */
    const found = new Map();
    /** @param {string} check @param {string} why */
    const fail = (check, why) => { if (!found.has(check)) found.set(check, why); };

    /** @type {Array<{ before: Entry | null, raw: Entry, shaped: Entry }>} */
    const edits = [];
    /** @type {Entry | null} */ let pending = null;
    /** @type {{ before: Entry | null, raw: Entry } | null} */ let cur = null;
    for (const x of o.log) {
        if (x.t === 'before') pending = x;
        else if (x.t === 'raw') { cur = { before: pending, raw: x }; pending = null; }
        else if (x.t === 'shaped' && cur) { edits.push({ ...cur, shaped: x }); cur = null; }
    }

    let open = seq.start.kind === 'empty' || digits(o.start).length <= 1;
    let changed = false;
    let shown = o.start;
    for (const [i, { before, raw, shaped }] of edits.entries()) {
        const was = before ? before.v : shown;
        const selFrom = before ? before.s : was.length, selTo = before ? before.e : was.length;
        if (raw.v !== was || shaped.v !== was) changed = true;
        const step = `edit ${i + 1} (${raw.type || 'input'}${raw.data ? ` "${raw.data}"` : ''}): "${was}" → raw "${raw.v}" → shown "${shaped.v}"`;
        // The window.
        const insertion = raw.type.startsWith('insert');
        const replacesAll = insertion && selFrom !== selTo && digits(was).length > 0
            && digits(was.slice(selFrom, selTo)) === digits(was);
        if (isTime(was) && raw.v !== was) {
            if (raw.type.startsWith('delete')) open = false;
            else if (insertion && selFrom !== selTo && !replacesAll) open = false;
        }
        if (replacesAll) open = true;
        if (digits(raw.v).length <= 1) open = true;
        // (a) what the box shows.
        if (!wellFormed(shaped.v)) fail('a', `${step}: the box shows something that is neither a time nor an unfinished one`);
        // (b) the digits typed, past the fourth dropped, or one leading 0 while the window is open — and while
        // TYPING only where no fourth digit could follow, a first digit of 3 to 9: a 0 supplied to "240" makes
        // 02:40 a full box, and the last 0 of 24:00 can never be typed (the Oct 2026 bug; review, 25 Nov 2026).
        const rd = digits(raw.v), sd = digits(shaped.v);
        const padded = open && rd.length === 3 && +rd[0] >= 3 && sd === `0${rd}`;
        if (sd !== rd.slice(0, 4) && !padded)
            fail('b', `${step}: the box changed the digits typed${rd.length === 3 && sd === `0${rd}` ? ' — a leading 0 supplied to what is left of a time' : ''}`);
        // (e) …and the other direction: a NEW time typed short takes its zero where nothing else can follow.
        // Three digits starting 3 to 9 cannot begin an hour, so while the window is open they show with it at once.
        if (open && rd.length === 3 && +rd[0] >= 3 && sd !== `0${rd}`)
            fail('e', `${step}: three digits typed as a new time, starting ${rd[0]}, did not take their leading 0`);
        // (d) the caret keeps its digits.
        if (shaped.v !== raw.v && raw.s === raw.e) {
            const want = Math.min(digits(raw.v.slice(0, raw.s)).length + (padded ? 1 : 0), sd.length);
            const got = digits(shaped.v.slice(0, shaped.s ?? shaped.v.length)).length;
            if (got !== want)
                fail('d', `${step}: the caret had ${want} digit(s) before it and now has ${got} — the next key lands somewhere the member did not put it`);
        }
        shown = shaped.v;
    }

    const step = `left as "${o.left}", settled "${o.settled}"`;
    if (!wellFormed(o.settled)) fail('a', `${step}: neither a time nor an unfinished one`);
    const ld = digits(o.left), sd = digits(o.settled);
    if (sd !== ld.slice(0, 4) && !(ld.length === 3 && sd === `0${ld}`))
        fail('b', `${step}: leaving the box changed its digits`);
    else if (isTime(o.settled) && sd !== ld && !open)
        fail('b', `${step}: a leading 0 supplied to what is left of a time — a valid time nobody typed`);
    // (e) A new time typed short, left with three digits, is read with its zero dropped when that is a time — the
    // owner's "130" → 01:30 (24 Nov 2026). Without this the test could not see a shortcut that stopped happening.
    const dropped = ld.length === 3 ? `0${ld[0]}:${ld.slice(1)}` : '';
    if (open && dropped && isTime(dropped) && o.settled !== dropped)
        fail('e', `${step}: three digits typed as a new time were not read with their zero dropped (${dropped})`);
    if (!changed && o.settled !== o.start)
        fail('c', `${step}: no key changed the box, yet leaving it changed "${o.start}"`);
    return [...found].map(([check, why]) => ({ check, why }));
}

// ── Reporting ─────────────────────────────────────────────────────────────────────────────────

/** @param {Sequence} seq */
function describeSequence(seq) {
    const { kind, value, caret, prior } = seq.start;
    const start = kind === 'empty' ? 'an empty box' : kind === 'typed' ? `"${value}" typed key by key`
        : kind === 'drawn' ? `"${value}" put there by the page on a box it just drew, caret at ${caret}`
        : `the box emptied${prior ? `, "${prior}" typed` : ''}, then "${value}" put there by the page, caret at ${caret}`;
    return `${start}; then ${seq.actions.join(', ')}; then the box left`;
}

/** The fewest actions that still break `check` (greedy: drop one at a time while it still fails).
 *  @param {import('@playwright/test').Page} page @param {Sequence} seq @param {string} check @param {Outcome} outcome  seq's own */
async function shrink(page, seq, check, outcome) {
    let best = seq;
    for (let progress = true; progress;) {
        progress = false;
        for (let i = 0; i < best.actions.length && best.actions.length > 1; i++) {
            const trial = { start: best.start, actions: best.actions.filter((_, j) => j !== i) };
            const o = await run(page, trial);
            if (judge(trial, o).some(v => v.check === check)) { best = trial; outcome = o; progress = true; break; }
        }
    }
    return { seq: best, outcome };
}

/** @param {Outcome} o */
const trail = o => [o.start, ...o.log.filter(x => x.t === 'shaped').map(x => x.v)].map(v => `"${v}"`).join(' → ') + ` → left, settled "${o.settled}"`;

// ── The tests ─────────────────────────────────────────────────────────────────────────────────

const BLOCKS = 4;
const RUNS = Number(process.env.CLOCK_BOX_RUNS) || 45;
const BASE_SEED = Number(process.env.CLOCK_BOX_SEED) || 20261125;
const DESKTOP_ONLY = 'the keys reach the box the same way under touch emulation; the desktop projects carry the run';

/**
 * Run sequences and fail with the first counterexample of each check, shrunk and replayable.
 * @param {import('@playwright/test').Page} page @param {Array<{ seq: Sequence, label: string }>} cases
 * @param {{ shrinking?: boolean }} [opts]  `shrinking: false` reports a replayed sequence exactly as given
 */
async function check(page, cases, { shrinking = true } = {}) {
    /** @type {Map<string, string>} */
    const failures = new Map();
    for (const { seq, label } of cases) {
        const o = await run(page, seq);
        for (const v of judge(seq, o)) {
            if (failures.has(v.check)) continue;
            const small = shrinking ? await shrink(page, seq, v.check, o) : { seq, outcome: o };
            const why = judge(small.seq, small.outcome).find(x => x.check === v.check)?.why ?? v.why;
            failures.set(v.check, [
                `check (${v.check}) failed — ${label}`,
                `  sequence: ${describeSequence(small.seq)}`,
                `  the box:  ${trail(small.outcome)}`,
                `  why:      ${why}`,
                `  replay:   CLOCK_BOX_REPLAY='${JSON.stringify(small.seq)}' npx playwright test e2e/clock-box-properties.spec.js --project=${test.info().project.name}`,
            ].join('\n'));
        }
    }
    expect([...failures.values()].join('\n\n'), 'every edit sequence ends as the time typed, or as one the box refuses').toBe('');
}

// No trace: a block is hundreds of keys, recording each one is most of the run, and a failure's message
// already carries the shrunk sequence, every value the box held, and its replay.
test.use({ trace: 'off' });

test.describe('a text clock box under random edit sequences', () => {
    const replay = process.env.CLOCK_BOX_REPLAY;
    if (replay) {
        test('clock box: the replayed sequence', async ({ page, context }, info) => {
            test.skip(isTouchProject(info), DESKTOP_ONLY);
            const errors = collectFatalErrors(page);
            await openBox(page, context);
            await check(page, [{ seq: JSON.parse(replay), label: 'replayed' }], { shrinking: false });
            expect(errors).toEqual([]);
        });
        return;
    }
    for (let b = 0; b < BLOCKS; b++) {
        const seed = BASE_SEED + b;
        test(`clock box: ${RUNS} random edit sequences end as the time typed or as one the box refuses (seed ${seed})`, async ({ page, context }, info) => {
            test.skip(isTouchProject(info), DESKTOP_ONLY);
            test.setTimeout(120_000);
            const errors = collectFatalErrors(page);
            await openBox(page, context);
            const rnd = prng(seed);
            const cases = Array.from({ length: RUNS }, (_, i) => ({ seq: randomSequence(rnd), label: `seed ${seed}, sequence ${i + 1} of ${RUNS}` }));
            await check(page, cases);
            expect(errors, 'no page error while typing').toEqual([]);
        });
    }
});
