// @ts-check
/**
 * calendar-al-lightbox.test.mjs — the Calendar's leave panel and day panel, through the real
 * `initCalendarLightboxes`.
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs calendar-al-lightbox.test.mjs   (part of test:unit)
 *
 * WHY THIS FILE EXISTS (17 Nov 2026). The leave panel's load was tested by its SOURCE TEXT only
 * (al-entitlement.test.mjs pins the read's bounds), so nothing ran it, and the one rule that matters
 * most on a shared phone had no test at all: a balance is kept on this device only for the reader's
 * OWN panel, and only while it still is. A read can outlive what made it theirs — access lost, a
 * sign-out or session expiry in another tab, another member signed in — and each of those deletes
 * the stored copy (CALENDAR_DATA.md 17). The panel decided whether to save before the read went out
 * and acted on that answer after it came back, so the late answer wrote the balance back.
 *
 * Driven through the real panel, the real access state, the real stored copy (calendar-snapshot.js)
 * and the real leave maths. Mocked: the DOM (only what the panels touch), Firestore (a read the test
 * answers by hand), the lightbox lifecycle, the session, the access KIND and the member selector.
 * The access kind mirrors the real `getAccessType`: 'none' whenever the one access state has shut.
 * The names are invented.
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** The day panel's change caption as index.html has it — read from the markup, so a test cannot pass
 *  on words the page does not carry. */
const HTML = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const CAPTION_BASE = /<span class="ddc-eyebrow" id="dayDetailChangeFrom"[^>]*>([^<]*)<\/span>/.exec(HTML)?.[1] ?? '';

// ── This device's storage — ls.js reads the global ──────────────────────────────────────────────
/** @type {Map<string, string>} */
const store = new Map();
globalThis.localStorage = /** @type {any} */ ({
    getItem: (/** @type {string} */ k) => (store.has(k) ? store.get(k) : null),
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => { store.set(k, String(v)); },
    removeItem: (/** @type {string} */ k) => { store.delete(k); },
    key: (/** @type {number} */ i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
});

// ── A DOM with exactly what the panels touch ────────────────────────────────────────────────────
/** @param {string|null} id @param {string} [tag] */
function fakeEl(id, tag = 'div') {
    /** @type {Record<string, Function[]>} */
    const listeners = {};
    /** @type {Record<string, string>} */
    const attrs = {};
    const classes = new Set();
    const el = {
        id, tagName: tag.toUpperCase(), hidden: false, disabled: false, textContent: '', href: '',
        isConnected: true, onclick: null,
        /** @type {Record<string, string>} */ dataset: {},
        /** @type {any[]} */ children: [],
        get className() { return [...classes].join(' '); },
        set className(v) { classes.clear(); for (const c of String(v).split(/\s+/)) if (c) classes.add(c); },
        classList: {
            add: (/** @type {string[]} */ ...c) => c.forEach(x => classes.add(x)),
            remove: (/** @type {string[]} */ ...c) => c.forEach(x => classes.delete(x)),
            toggle: (/** @type {string} */ c, /** @type {boolean} */ on) => { if (on) classes.add(c); else classes.delete(c); },
            contains: (/** @type {string} */ c) => classes.has(c),
        },
        setAttribute(/** @type {string} */ k, /** @type {any} */ v) { attrs[k] = String(v); },
        getAttribute(/** @type {string} */ k) { return attrs[k] ?? null; },
        hasAttribute(/** @type {string} */ k) { return k in attrs; },
        removeAttribute(/** @type {string} */ k) { delete attrs[k]; },
        addEventListener(/** @type {string} */ t, /** @type {Function} */ fn) { (listeners[t] ||= []).push(fn); },
        fire(/** @type {string} */ t, /** @type {any} */ e = {}) { for (const fn of listeners[t] || []) fn(e); },
        replaceChildren(/** @type {any[]} */ ...kids) { el.children = kids; },
        append(/** @type {any[]} */ ...kids) { el.children.push(...kids); },
        appendChild(/** @type {any} */ kid) { el.children.push(kid); return kid; },
        focus() {},
    };
    return el;
}
/** @type {Map<string, any>} */
const els = new Map();
const byId = (/** @type {string} */ id) => { if (!els.has(id)) els.set(id, fakeEl(id)); return els.get(id); };
// The could-not-load line keeps its markup's words: the panel reads them once, as it starts.
byId('alLbError').textContent = 'Couldn’t load — check your connection';
// …and so does the day panel's change caption.
byId('dayDetailChangeFrom').textContent = CAPTION_BASE;
const statsEl = fakeEl(null);
globalThis.document = /** @type {any} */ ({
    getElementById: byId,
    querySelector: (/** @type {string} */ sel) => (sel === '.al-lb-stats' ? statsEl : null),
    querySelectorAll: () => [],
    createElement: (/** @type {string} */ tag) => fakeEl(null, tag),
    activeElement: null,
});

// ── Firestore: each read waits for the test to answer it ────────────────────────────────────────
/** @type {{ resolve: (snap: any) => void, reject: (e: any) => void }[]} */
let reads = [];
mock.module('./firebase-client.js', { namedExports: {
    db: {}, COLLECTIONS: { overrides: 'overrides' },
    collection: () => ({}), query: () => ({}), where: () => ({}),
    getDocs: () => new Promise((resolve, reject) => { reads.push({ resolve, reject }); }),
} });

// ── The lightbox lifecycle: open runs onOpen, close runs onClose, nothing else ──────────────────
/** Every close, in order, and every link click handed to `followLinkOutOf`. @type {string[]} */
let closes = [];
/** @type {Array<{ lb: any, e: any }>} */
let followed = [];
/** What waits for the close's history echo — run by hand, so a test can see what came first. @type {Array<() => void>} */
let settleWaiters = [];
mock.module('./overlay.js', { namedExports: {
    createLightbox: (/** @type {any} */ { overlay, onOpen, onClose }) => ({ overlay, open: () => onOpen?.(), close: () => { closes.push(overlay?.id); onClose?.(); } }),
    // The real ones are overlay-history.test.mjs's; here what matters is that the panels hand them their exits.
    followLinkOutOf: (/** @type {any} */ lb, /** @type {any} */ e) => { followed.push({ lb, e }); return true; },
    whenHistorySettled: (/** @type {() => void} */ fn) => { settleWaiters.push(fn); },
} });

/** The member session.js holds, or null once signed out. @type {{ name: string }|null} */
let session = null;
mock.module('./session.js', { namedExports: { getSession: () => session } });

const accessState = await import('./calendar-access-state.js');
/** WHICH access is held. Read through the one state, as the real `getAccessType` is: 'none' once it has shut. */
let kind = 'named';
mock.module('./calendar-access.js', { namedExports: {
    getAccessType: () => (accessState.hasCalendarAccess() ? kind : 'none'),
} });

/** Whose calendar is on screen. @type {any} */
let shown = null;
/** A first run: nobody has chosen a name on this device. */
let firstRun = false;
mock.module('./calendar-member.js', { namedExports: { getCurrentMember: () => shown, isFirstRun: () => firstRun } });
const THIS_YEAR = new Date().getFullYear();
let displayYear = THIS_YEAR;
mock.module('./calendar-state.js', { namedExports: { getDisplayYear: () => displayYear } });

const { setCalendarAccess, onCalendarAccess } = accessState;
const { clearSnapshot, saveLeaveBalance, readLeaveBalance } = await import('./calendar-snapshot.js');
const { CALENDAR_SNAPSHOT } = await import('./storage-keys.js');
const { alPosition } = await import('./al-entitlement.js');
const { getPaydaysAndCutoffs, formatISO, CONFIG } = await import('./roster-data.js');
const { initCalendarLightboxes } = await import('./calendar-al-lightbox.js');

// calendar-app.js's own listener, wired as the page wires it: a Calendar that has lost access keeps
// no copy (CALENDAR_DATA.md 17).
onCalendarAccess(({ open }) => { if (!open) clearSnapshot(); });
/** Team Week View on screen, where the name picker is hidden. */
let teamViewOn = false;
/** Every jump the day panel's Pay estimate asked for, with the closes that had happened by then. @type {Array<{ to: string, closedBefore: string[], waitersLeft: number }>} */
const jumps = [];
const { openDayDetail } = initCalendarLightboxes({
    navigateToPaycalc: (payday) => { jumps.push({ to: payday, closedBefore: [...closes], waitersLeft: settleWaiters.length }); },
    isTeamView: () => teamViewOn,
});

/** Two invented CEAs on the main line. */
const PERSON  = Object.freeze({ name: 'A. Person',  role: 'CEA', rosterType: 'main', currentWeek: 1 });
const EXAMPLE = Object.freeze({ name: 'Q. Example', role: 'CEA', rosterType: 'main', currentWeek: 2 });

/** Let every await after an answer run. */
const settle = () => new Promise(r => setTimeout(r, 0));
/** Open the leave panel, as the 🏖️ button does. */
const openLeavePanel = () => byId('alBtn').fire('click');
/** Answer the oldest read still out, as the server would. @param {any[]} [rows] */
async function answer(rows = []) {
    const read = reads.shift();
    assert.ok(read, 'premise: the panel issued its read');
    read.resolve({ metadata: { fromCache: false }, forEach: (/** @type {Function} */ fn) => rows.forEach(r => fn({ data: () => r })) });
    await settle();
}
/** The stored copy, parsed, or null. */
const storedCopy = () => { const raw = store.get(CALENDAR_SNAPSHOT); return raw ? JSON.parse(raw) : null; };

beforeEach(() => {
    store.clear();
    reads = [];
    session = { name: PERSON.name };
    kind = 'named';
    shown = PERSON;
    firstRun = false;
    teamViewOn = false;
    displayYear = THIS_YEAR;
    setCalendarAccess(true);
});

describe('a first run asks for a name where a name can be chosen', () => {
    test('in the month view, "choose your name"; in Team View, where the picker is hidden, back to 📅 Month first', () => {
        firstRun = true;
        shown = null;   // as the real selector answers on a first run: nobody's
        openLeavePanel();
        assert.equal(byId('alLbError').textContent, 'Choose your name first to see your leave.');
        teamViewOn = true;
        openLeavePanel();
        assert.equal(byId('alLbError').textContent, 'Go back to 📅 Month and choose your name to see your leave.',
            'in Team View the hint sent the member to a picker that is not on screen');
        assert.equal(reads.length, 0, 'nobody\'s leave was read');
        // The words name the button that leaves Team View, as Team View labels it.
        assert.match(readFileSync(new URL('./calendar-team-view.js', import.meta.url), 'utf8'),
            /'<span class="btn-ico" aria-hidden="true">📅<\/span> Month'/, 'the month view\'s button is no longer "📅 Month"');
    });
});

describe('a balance is kept only while it is still the reader\'s own — asked again as the read lands', () => {
    test('the reader\'s own panel keeps the balance it confirmed (premise: the rest are not vacuous)', async () => {
        openLeavePanel();
        await answer();
        assert.equal(storedCopy()?.member, PERSON.name);
        assert.ok(storedCopy()?.leave?.[String(THIS_YEAR)], 'the confirmed balance was not kept');
    });

    test('access lost while the read was out: the late answer keeps nothing', async () => {
        openLeavePanel();
        setCalendarAccess(false);   // the shut: the page deletes the copy, the panel closes
        assert.equal(store.get(CALENDAR_SNAPSHOT), undefined, 'premise: the copy is gone');
        await answer();
        assert.equal(store.get(CALENDAR_SNAPSHOT), undefined,
            'the balance was written back on a device that has lost access');
    });

    test('signed out in another tab while the read was out: the late answer keeps nothing', async () => {
        openLeavePanel();
        session = null;     // the other tab's clearSession…
        clearSnapshot();    // …which deletes the copy with it
        await answer();
        assert.equal(store.get(CALENDAR_SNAPSHOT), undefined,
            'the balance was written back after the member signed out');
    });

    test('another member signed in meanwhile: their copy is left alone', async () => {
        openLeavePanel();
        session = { name: EXAMPLE.name };
        clearSnapshot();
        saveLeaveBalance(EXAMPLE.name, THIS_YEAR, { taken: 1, booked: 2, entitlement: 32 });
        await answer();
        assert.equal(storedCopy()?.member, EXAMPLE.name,
            'the first member\'s late answer replaced the copy of the member now signed in');
        assert.equal(readLeaveBalance(PERSON.name, THIS_YEAR), null);
    });

    test('the staff PIN took over while the read was out: the late answer keeps nothing', async () => {
        openLeavePanel();
        kind = 'viewer';
        session = null;
        setCalendarAccess(false);
        setCalendarAccess(true);   // a viewer grant: still a Calendar, nobody's in particular
        await answer();
        assert.equal(store.get(CALENDAR_SNAPSHOT), undefined,
            'a balance was kept on a device unlocked with the staff PIN');
    });
});

describe('a year with no allowance says why, and ‹ stops at the member\'s first year', () => {
    const JOINER = Object.freeze({ ...PERSON, startDate: new Date(THIS_YEAR, 2, 2) });

    test('a joiner\'s ‹ stops at the year they started — the year before has no allowance to show', async () => {
        shown = JOINER;
        openLeavePanel();
        await answer();
        assert.equal(byId('alLbPrevYear').disabled, true, '‹ steps back into a year before the start date');
        byId('alLbPrevYear').fire('click');
        assert.equal(reads.length, 0, 'a click on ‹ still loaded the year before the start date');
        assert.equal(byId('alLbYear').textContent, String(THIS_YEAR));
    });

    test('opened on a year before the start date (the calendar can show one): the dashes come with words', async () => {
        shown = JOINER;
        displayYear = THIS_YEAR - 1;
        openLeavePanel();
        await answer();
        assert.equal(byId('alLbRemaining').textContent, '—');
        assert.equal(byId('alLbError').hidden, false, 'four dashes and no words');
        assert.equal(byId('alLbError').textContent, `No allowance for ${THIS_YEAR - 1}: that is before their start date.`);
    });

    test('a year in a grade the app keeps no leave figures for says so', async () => {
        shown = { name: 'M. Sample', role: 'Management', rosterType: 'fixed', currentWeek: 1 };
        session = { name: 'M. Sample' };
        openLeavePanel();
        await answer();
        assert.equal(byId('alLbError').hidden, false, 'four dashes and no words');
        assert.match(byId('alLbError').textContent, new RegExp(`^No allowance on record for ${THIS_YEAR}: .*CEA, CES and Dispatcher`));
    });
});

describe('the figures are alPosition\'s — the Admin banner\'s own answer', () => {
    test('taken, booked and the entitlement match it for a year of leave either side of today', async () => {
        // Every weekday of the year as annual leave, so whichever the pattern works, some are counted
        // on each side of today; the panel must split them exactly as the banner does.
        const rows = [];
        for (let d = new Date(THIS_YEAR, 0, 1); d.getFullYear() === THIS_YEAR; d.setDate(d.getDate() + 1)) {
            if (d.getDay() !== 0) rows.push({ memberName: PERSON.name, date: formatISO(d), type: 'annual_leave', value: 'AL' });
        }
        openLeavePanel();
        await answer(rows);
        const want = alPosition({ overrides: rows, member: PERSON, year: THIS_YEAR, todayStr: formatISO(new Date()) });
        assert.ok(want.taken + want.booked > 0, 'premise: the fixture counts some leave');
        assert.equal(byId('alLbTaken').textContent, String(want.taken));
        assert.equal(byId('alLbBooked').textContent, String(want.booked));
        assert.equal(byId('alLbEntitlement').textContent, String(want.entitlement));
    });
});

describe('the day panel', () => {
    /** A day cell as the renderer writes one. @param {Record<string, string>} dataset */
    const cell = (dataset) => ({ dataset: { detailDay: 'Monday 16 November 2026', ...dataset } });

    test('a change is ONE sentence of visually hidden text — not an aria-label on a role-less div', () => {
        openDayDetail(cell({ detailShiftValue: 'AL', detailShift: 'Annual leave', detailBase: 'Early shift 06:00-14:00',
            detailBaseShift: '06:00-14:00', detailNowShift: 'AL', detailBy: 'Changed by A. Person' }));
        assert.equal(byId('dayDetailChangeSaid').textContent,
            'Base roster Early shift 06:00-14:00, changed to Annual leave. Changed by A. Person');
        assert.equal(byId('dayDetailChange').getAttribute('aria-label'), null,
            'a label on a plain <div> names nothing, and a screen reader may skip it');
        const [from] = byId('dayDetailChangePair').children;
        assert.equal(from.getAttribute('aria-label'), null, 'a badge inside the hidden pair is labelled for nobody');
        // An unchanged day says nothing in that slot.
        openDayDetail(cell({ detailShiftValue: '06:00-14:00', detailShift: 'Early shift 06:00-14:00' }));
        assert.equal(byId('dayDetailChangeSaid').textContent, '');
    });

    test('the panel says WHOSE day it is, under the date and in the dialog\'s name — as the leave panel does', () => {
        openDayDetail(cell({ detailShiftValue: 'RD', detailShift: 'Rest day', detailWho: 'Q. Example' }));
        assert.equal(byId('dayDetailWho').textContent, 'Q. Example');
        assert.equal(byId('dayDetailWho').hidden, false, 'the day panel never says whose day it is');
        assert.equal(byId('dayDetailLightbox').getAttribute('aria-label'), 'Day details, Q. Example',
            'a screen reader is not told whose day the dialog is about');
        // A cell that names nobody (an older renderer's) shows no name, and the dialog its plain name.
        openDayDetail(cell({ detailShiftValue: 'RD', detailShift: 'Rest day' }));
        assert.equal(byId('dayDetailWho').hidden, true, 'the last member\'s name outlived their day');
        assert.equal(byId('dayDetailLightbox').getAttribute('aria-label'), 'Day details');
    });

    test('25/26 December: a day a record changed FROM Christmas leave is captioned and said as that leave', () => {
        // The left badge is the Christmas leave there, and the base roster was the very turn on the
        // right: "Changed from base roster 🏖️ AL → 🌙 13:30-21:00" said otherwise (18 Nov 2026).
        assert.equal(CAPTION_BASE, 'Changed from base roster', 'premise: the markup\'s caption for an ordinary day');
        openDayDetail(cell({ detailShiftValue: '13:30-21:00', detailShift: 'Late shift 13:30-21:00', detailBase: 'Annual leave',
            detailBaseShift: 'AL', detailNowShift: '13:30-21:00', detailFromChristmas: '1', detailBy: 'Last saved by A. Person' }));
        assert.equal(byId('dayDetailChangeFrom').textContent, 'Changed from Christmas leave');
        assert.equal(byId('dayDetailChangeSaid').textContent,
            'Changed from Christmas leave to Late shift 13:30-21:00. Last saved by A. Person');
        // The next ordinary change puts the markup's own caption back.
        openDayDetail(cell({ detailShiftValue: '07:00-16:00', detailShift: 'Early shift 07:00-16:00', detailBase: 'Spare day',
            detailBaseShift: 'SPARE', detailNowShift: '07:00-16:00' }));
        assert.equal(byId('dayDetailChangeFrom').textContent, CAPTION_BASE);
        assert.equal(byId('dayDetailChangeSaid').textContent, 'Base roster Spare day, changed to Early shift 07:00-16:00');
    });

    test('the spoken sentence says the new value WITH its time, as the renderer hands it over', () => {
        // A member whose turns all wear one kind: the headline is "Late shift", and the change may be
        // nothing but the time, so the sentence reads the renderer's `detailNowSaid`.
        openDayDetail(cell({ detailShiftValue: '06:00-14:00', detailShift: 'Late shift', detailPermanentShift: 'late',
            detailBase: 'Late shift 07:00-15:00', detailBaseShift: '07:00-15:00', detailNowShift: '06:00-14:00',
            detailNowSaid: 'Late shift 06:00-14:00' }));
        assert.equal(byId('dayDetailChangeSaid').textContent, 'Base roster Late shift 07:00-15:00, changed to Late shift 06:00-14:00');
    });

    test('a pay cut-off says what one is, and which payday it feeds', () => {
        const { paydays, cutoffs } = getPaydaysAndCutoffs(THIS_YEAR);
        const payday = paydays[3], cutoff = formatISO(cutoffs[3]);
        openDayDetail(cell({ detailShiftValue: 'RD', detailShift: 'Rest day', cutoffIso: cutoff }));
        const line = byId('dayDetailCutoff');
        assert.equal(line.hidden, false, 'a cut-off day says nothing about what a cut-off is');
        const when = payday.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
        assert.equal(line.textContent,
            `Pay cut-off: shifts up to and including this day are paid on ${when}. Shifts after it are paid on the payday after that.`);
        assert.match(when, new RegExp(`^Friday|^Thursday|^Wednesday`), 'premise: a payday is a weekday');
        openDayDetail(cell({ detailShiftValue: 'RD', detailShift: 'Rest day' }));
        assert.equal(line.hidden, true, 'the line outlived its day');
    });

    test('a member whose turns are all one kind: the glyph and the pair wear it, as the cell does', () => {
        openDayDetail(cell({ detailShiftValue: '06:00-14:00', detailShift: 'Late shift', detailPermanentShift: 'late',
            detailBase: 'Late shift', detailBaseShift: '07:00-15:00', detailNowShift: '06:00-14:00' }));
        assert.equal(byId('dayDetailShiftGlyph').textContent, '🌙', 'a Late cell opened a panel led by the early glyph');
        const [from, to] = byId('dayDetailChangePair').children;
        assert.match(from.className, /\bbadge-late\b/);
        assert.match(to.children[1].className, /\bbadge-late\b/);
        // …and a member without one keeps the time's own kind.
        openDayDetail(cell({ detailShiftValue: '06:00-14:00', detailShift: 'Early shift 06:00-14:00' }));
        assert.equal(byId('dayDetailShiftGlyph').textContent, '☀️');
    });
});

// ── EVERY EXIT FROM A PANEL LEAVES NO DEAD STEP IN BACK (lightbox review, 22 Nov 2026) ──────────────
// The browser proof is e2e/calendar.spec.js ("one Back from …"); this is the wiring, which the browser
// can only show through the history it leaves behind.
describe('a panel\'s ways out', () => {
    /** A day cell as the renderer writes one. @param {Record<string, string>} dataset */
    const cell = (dataset) => ({ dataset: { detailDay: 'Monday 16 November 2026', ...dataset } });
    test('a click inside the leave panel is handed to followLinkOutOf, for the leave panel', () => {
        followed = [];
        const click = { type: 'click', button: 0, target: {} };
        byId('alLightboxContent').fire('click', click);
        assert.equal(followed.length, 1, '"Record leave" and "Leave dates" stack Admin on the panel\'s own history entry');
        assert.equal(followed[0].e, click);
        assert.equal(followed[0].lb.overlay?.id, 'alLightbox', 'handed for the wrong lightbox, whose entry is not the top one');
    });

    test('a click inside the day panel is handed to followLinkOutOf, for the day panel', () => {
        followed = [];
        const click = { type: 'click', button: 0, target: {} };
        byId('dayDetailContent').fire('click', click);
        assert.equal(followed.length, 1, '"Leave dates" stacks Admin on the day panel\'s own history entry');
        assert.equal(followed[0].lb.overlay?.id, 'dayDetailLightbox');
    });

    test('Pay estimate closes the panel and jumps only once the close\'s Back has landed', () => {
        const { paydays } = getPaydaysAndCutoffs(THIS_YEAR);
        const payday = formatISO(paydays[3]);
        openDayDetail(cell({ detailShiftValue: 'RD', detailShift: 'Rest day', paydayIso: payday }));
        const pay = byId('dayDetailPayBtn');
        assert.equal(pay.hidden, false, 'premise: the reader\'s own pay day offers the jump');
        closes = []; settleWaiters = []; jumps.length = 0;
        pay.onclick();
        assert.deepEqual(closes, ['dayDetailLightbox'], 'the panel closes first');
        assert.equal(jumps.length, 0, 'the jump raced the close\'s history.back() — it must wait for the echo');
        assert.equal(settleWaiters.length, 1);
        settleWaiters.shift()?.();
        assert.deepEqual(jumps, [{ to: payday, closedBefore: ['dayDetailLightbox'], waitersLeft: 0 }]);
    });
});

test('premise: the year bounds the panel steps within are the calendar\'s own', () => {
    assert.ok(CONFIG.MIN_YEAR < THIS_YEAR && THIS_YEAR < CONFIG.MAX_YEAR, 'this suite assumes today is inside the navigable years');
});
