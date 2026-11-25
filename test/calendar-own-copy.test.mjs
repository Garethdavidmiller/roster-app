// @ts-check
// @lane hygiene
/**
 * calendar-own-copy.test.mjs — what the Calendar keeps of the member's own roster, and when it may
 * offer it (calendar-own-copy.js, 25 Nov 2026).
 * Run with: node scripts/run-tests.mjs test/calendar-own-copy.test.mjs   (part of test:hygiene)
 *
 * The RULE is `ownMonthsToStore`: only months the server settled, and only the member's own records,
 * with the name and date the cache keeps outside a record put back. It is tested on its own, and then
 * through `createOwnCopy(...).save`, the line the page calls after every render — the helper can be
 * right and the wiring still hand it the wrong months or the wrong cache. The storage rules beneath
 * (one member, ageing, the window) are calendar-snapshot.test.mjs's; the paint before the grant is
 * e2e/calendar-access.spec.js's.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** A localStorage stand-in — ls.js reads the global. @type {Map<string, string>} */
const store = new Map();
globalThis.localStorage = /** @type {any} */ ({
    getItem: (/** @type {string} */ k) => store.has(k) ? store.get(k) : null,
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => { store.set(k, String(v)); },
    removeItem: (/** @type {string} */ k) => { store.delete(k); },
    get length() { return store.size; },
    key: (/** @type {number} */ i) => [...store.keys()][i] ?? null,
});

const { ownMonthsToStore, ownCopyWindow, createOwnCopy } = await import('../calendar-own-copy.js');
const { noteKnowledge, _reset: resetKnowledge } = await import('../calendar-data-state.js');
const { MONTHS_BEFORE, MONTHS_AFTER } = await import('../calendar-snapshot.js');
const { CALENDAR_SNAPSHOT, SELECTED_MEMBER, TEAM_VIEW } = await import('../storage-keys.js');

/** calendar-overrides.js's key, which the page hands in (that module needs Firebase). */
const monthKey = (/** @type {number} */ y, /** @type {number} */ m) => `${y}-${String(m + 1).padStart(2, '0')}`;
const ME = 'G. Miller', COLLEAGUE = 'S. Boyle';
const rec = (extra = {}) => ({ type: 'annual_leave', value: 'AL', source: 'manual', changedBy: ME, ...extra });

describe('ownCopyWindow — the months kept around today', () => {
    test('MONTHS_BEFORE before to MONTHS_AFTER after, across a year end', () => {
        const keys = ownCopyWindow(new Date(2026, 11, 15), monthKey);   // 15 Dec 2026
        assert.equal(keys.length, MONTHS_BEFORE + MONTHS_AFTER + 1);
        assert.equal(keys[MONTHS_BEFORE], '2026-12', 'today\'s month sits after the months before it');
        assert.ok(keys.includes('2027-01'), 'the window crosses into the next year');
        assert.deepEqual([...keys].sort(), keys, 'in order, oldest first');
    });
});

describe('ownMonthsToStore — the rule', () => {
    const cache = new Map([
        [`${ME}|2026-11-03`, rec()],
        [`${ME}|2026-11-04`, rec({ type: 'sick', value: 'SICK' })],
        [`${COLLEAGUE}|2026-11-03`, rec({ changedBy: COLLEAGUE })],
        [`${ME}|2026-12-24`, rec()],
    ]);
    const known = (/** @type {Record<string, string>} */ map) => (/** @type {string} */ k) => map[k] ?? 'unknown';

    test('keeps the member\'s own records of a month the server settled, with name and date put back', () => {
        const out = ownMonthsToStore(ME, cache, ['2026-11'], known({ '2026-11': 'authoritative' }));
        assert.deepEqual(out, { '2026-11': [
            { ...rec(), memberName: ME, date: '2026-11-03' },
            { ...rec({ type: 'sick', value: 'SICK' }), memberName: ME, date: '2026-11-04' },
        ] }, 'a colleague\'s record in the shared cache must never reach the member\'s copy');
    });

    test('a month answered from the device cache, failed or unread, is not kept', () => {
        for (const k of ['cached', 'error', 'unknown']) {
            assert.deepEqual(ownMonthsToStore(ME, cache, ['2026-11'], known({ '2026-11': k })), {},
                `a ${k} month was kept — the copy would later show it as the member's roster`);
        }
    });

    test('a settled month with nothing in it is kept as EMPTY — "no changes" is an answer', () => {
        assert.deepEqual(ownMonthsToStore(ME, cache, ['2027-01'], known({ '2027-01': 'authoritative' })), { '2027-01': [] });
    });

    test('a record is filed under its own month, never a neighbour\'s', () => {
        const out = ownMonthsToStore(ME, cache, ['2026-11', '2026-12'], known({ '2026-11': 'authoritative', '2026-12': 'authoritative' }));
        assert.deepEqual(out['2026-12'].map(r => r.date), ['2026-12-24']);
        assert.ok(out['2026-11'].every(r => r.date.startsWith('2026-11-')));
    });

    test('a name that begins another\'s keeps only its own', () => {
        const prefixed = new Map([[`${ME}son|2026-11-05`, rec()], [`${ME}|2026-11-06`, rec()]]);
        assert.deepEqual(ownMonthsToStore(ME, prefixed, ['2026-11'], known({ '2026-11': 'authoritative' }))['2026-11'].map(r => r.date),
            ['2026-11-06']);
    });
});

// ── THROUGH THE ENTRY POINT: what the page calls after every render ─────────────────────────────
describe('createOwnCopy — save and snapshotFor, wired as the page wires them', () => {
    const now = new Date();
    const thisMonth = monthKey(now.getFullYear(), now.getMonth());
    const today = `${thisMonth}-01`;
    /** @type {Map<string, any>} */ const cache = new Map();
    const world = { session: /** @type {string|undefined} */ (ME), access: 'named', team: false, shown: /** @type {string|undefined} */ (ME) };
    const copy = createOwnCopy({
        sessionName: () => world.session,
        accessType: () => world.access,
        isTeamViewMode: () => world.team,
        currentMemberName: () => world.shown,
        cache,
        monthKey,
        buildCalendarContainer: () => { throw new Error('not drawn here'); },
        markMilestone: () => {},
    });
    const stored = () => JSON.parse(store.get(CALENDAR_SNAPSHOT) ?? 'null');

    beforeEach(() => {
        store.clear();
        resetKnowledge();
        cache.clear();
        Object.assign(world, { session: ME, access: 'named', team: false, shown: ME });
        cache.set(`${ME}|${today}`, rec());
        cache.set(`${COLLEAGUE}|${today}`, rec({ changedBy: COLLEAGUE }));
        noteKnowledge(thisMonth, 'authoritative');
    });

    test('the member\'s own calendar keeps this month\'s settled records, and only theirs', () => {
        copy.save();
        const s = stored();
        assert.equal(s?.member, ME);
        assert.deepEqual(Object.keys(s.months[thisMonth].days), [today]);
        assert.deepEqual([...copy.snapshotFor(ME, now.getFullYear(), now.getMonth())?.keys() ?? []], [today],
            'what was saved is what the renderer is offered');
    });

    test('nothing is kept from a colleague\'s calendar, Team View, or anything but a named grant', () => {
        for (const change of [{ shown: COLLEAGUE }, { team: true }, { access: 'none' }, { session: undefined }]) {
            store.clear();
            Object.assign(world, { session: ME, access: 'named', team: false, shown: ME }, change);
            copy.save();
            assert.equal(store.get(CALENDAR_SNAPSHOT), undefined, `kept with ${JSON.stringify(change)}`);
        }
    });

    test('the renderer is offered the copy only for the reader\'s own view', () => {
        copy.save();
        const ask = () => copy.snapshotFor(ME, now.getFullYear(), now.getMonth());
        assert.ok(ask(), 'guard: the own view is offered the copy');
        assert.equal(copy.snapshotFor(COLLEAGUE, now.getFullYear(), now.getMonth()), null, 'a colleague\'s calendar');
        store.set(SELECTED_MEMBER, COLLEAGUE);
        assert.equal(ask(), null, 'another name picked on this device');
        store.delete(SELECTED_MEMBER);
        store.set(TEAM_VIEW, '1');
        assert.equal(ask(), null, 'Team View saved as open');
        store.delete(TEAM_VIEW);
        world.team = true;
        assert.equal(ask(), null, 'Team View open');
        world.team = false;
        world.access = 'none';
        assert.equal(ask(), null, 'no named grant');
    });
});
