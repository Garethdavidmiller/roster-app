// @ts-check
/**
 * al-leave-save.test.mjs — the Annual leave sheet's Save, its upload log and its Undo (al-leave-save.js;
 * docs/AL_UPLOADER_PLAN.md §4.9–4.10), run against a fake Firestore.
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs al-leave-save.test.mjs   (part of `npm run test:unit`)
 *
 * ── THE CHECK IS THE REAL ONE ───────────────────────────────────────────────────────────────────
 *
 * Only Firebase is faked. The commit is the real `commitChecked` (admin-override-store.js), the plan the
 * real `planPerson` over the real comparison, so these tests run the production path from a sheet day
 * to the document that lands: what is written, what is refused and what an Undo takes back.
 *
 * THE FAKE TRANSACTION BEHAVES LIKE FIRESTORE'S where the Save depends on it, modelled as the store's own
 * test models it (admin-override-store.test.mjs): every document has a version, a transaction whose reads
 * went stale before it committed runs its function AGAIN, and a commit can land with its answer lost, when
 * the function also runs again and meets its own write. A fake that ran once could test the comparison,
 * never the race the comparison exists for.
 *
 * Every person is INVENTED, on a real roster pattern; every date is found from that pattern.
 */
import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getBaseShift, parseISODate, isSunday, isBankHoliday } from './roster-data.js';
import { comparePerson } from './al-leave-compare.js';
import { planPerson, logFields, dayKey } from './al-leave-plan.js';
import { manualOverrideId } from './override-id.js';
import { SIGNED_OUT_CODE } from './claim-retry.js';

// ── THE FAKE SERVER ─────────────────────────────────────────────────────────────────────────────
/** @type {Map<string, any>} "collection/id" → data */ const server = new Map();
/** @type {Map<string, number>} */ const versions = new Map();
const SERVER_TS = Object.freeze({ __serverTimestamp: true });
let clock = 1_800_000_000_000;
/** A field the server stamps arrives as a Timestamp-like with the server's clock. @param {Record<string, any>} data */
function land(data) {
    const ms = ++clock;
    return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v === SERVER_TS ? { toMillis: () => ms } : v]));
}
/** A write that lands: a committed one, or a colleague's. Null deletes. @param {string} key @param {any} data */
function serverWrite(key, data) {
    if (data === null) server.delete(key); else server.set(key, data);
    versions.set(key, (versions.get(key) ?? 0) + 1);
}
let txRuns = 0;
/** Each committed transaction's operations, as "set overrides/<id>". @type {string[][]} */ let commits = [];
/** Runs ONCE, after a transaction has read and before it commits. @type {(() => void)|null} */ let betweenReadAndCommit = null;
/** Commits that land with their answer lost. */ let landsUnanswered = 0;
/** @type {any} */ let txFails = null;
/** @type {any} */ let writeFails = null;
let cached = false;
/** A transaction that READ a document of `col` fails with `code` before it commits — after `skip` such
 *  transactions have gone through, for `times` of them. @type {{ col: string, code: string, skip?: number, times: number }|null} */
let txFailOn = null;
/** Batch commits that fail with this code, the batch then spent as Firestore spends one. @type {{ code: string, times: number }|null} */
let batchFails = null;
/** @type {any[]} */ let reads = [];
let autoIds = 0;

/** @param {Function} fn */
async function runTx(fn) {
    if (txFails) throw txFails;
    for (let attempt = 0; attempt < 5; attempt++) {
        txRuns++;
        /** @type {Map<string, number>} */ const readAt = new Map();
        /** @type {Array<[string, string, any]>} */ const ops = [];
        const result = await fn({
            get: async (/** @type {any} */ ref) => {
                readAt.set(ref.key, versions.get(ref.key) ?? 0);
                const data = server.get(ref.key);
                return { exists: () => server.has(ref.key), data: () => (data ? { ...data } : undefined) };
            },
            set: (/** @type {any} */ ref, /** @type {any} */ data) => { ops.push(['set', ref.key, data]); },
            update: (/** @type {any} */ ref, /** @type {any} */ data) => { ops.push(['update', ref.key, data]); },
            delete: (/** @type {any} */ ref) => { ops.push(['delete', ref.key, null]); },
        });   // a refusal thrown inside rejects the whole transaction, as the real one does
        if (txFailOn && txFailOn.times > 0 && [...readAt.keys()].some(k => k.startsWith(`${txFailOn.col}/`))) {
            if ((txFailOn.skip ?? 0) > 0) txFailOn.skip = /** @type {number} */ (txFailOn.skip) - 1;
            else { txFailOn.times--; throw Object.assign(new Error('never reached the server'), { code: txFailOn.code }); }
        }
        const between = betweenReadAndCommit; betweenReadAndCommit = null; between?.();
        if ([...readAt].some(([k, v]) => (versions.get(k) ?? 0) !== v)) continue;   // stale: run it again
        for (const [kind, k, data] of ops) {
            if (kind === 'update') {
                if (!server.has(k)) throw Object.assign(new Error('no document to update'), { code: 'not-found' });
                serverWrite(k, { ...server.get(k), ...land(data) });
            } else serverWrite(k, kind === 'set' ? land(data) : null);
        }
        if (ops.length) commits.push(ops.map(([kind, k]) => `${kind} ${k}`));
        if (landsUnanswered > 0) { landsUnanswered--; continue; }   // landed, answer lost: run it again
        return result;
    }
    throw Object.assign(new Error('transaction contention'), { code: 'aborted' });
}

mock.module('./firebase-client.js', {
    namedExports: {
        db: {},
        COLLECTIONS: { overrides: 'overrides', alUploads: 'alUploads' },
        collection: (/** @type {any} */ _db, /** @type {string} */ col) => ({ col }),
        where: (/** @type {string} */ f, /** @type {string} */ op, /** @type {any} */ v) => ({ f, op, v }),
        orderBy: () => ({}),
        limit: () => ({}),
        query: (/** @type {any} */ c, /** @type {any[]} */ ...wheres) => ({ col: c.col, wheres }),
        doc: (/** @type {any} */ a, /** @type {string} */ col, /** @type {string} */ id) => {
            if (a?.col && col === undefined) { const auto = `auto${++autoIds}`; return { id: auto, key: `${a.col}/${auto}` }; }
            return { id, key: `${col}/${id}` };
        },
        getDocs: async (/** @type {any} */ q) => {
            reads.push(q);
            const rows = [...server].filter(([k]) => k.startsWith(`${q.col}/`))
                .map(([k, d]) => ({ id: k.slice(q.col.length + 1), data: d }))
                .filter(r => q.wheres.every((/** @type {any} */ w) => (w.op === '==' ? r.data[w.f] === w.v : w.op === '<' ? r.data[w.f] < w.v
                    : w.op === 'in' ? w.v.includes(r.data[w.f]) : false)));
            return { metadata: { fromCache: cached },
                forEach: (/** @type {any} */ fn) => rows.forEach(r => fn({ id: r.id, metadata: { hasPendingWrites: false }, data: () => ({ ...r.data }) })) };
        },
        getDoc: async () => ({ exists: () => false, data: () => undefined, metadata: { fromCache: false } }),
        runTransaction: async (/** @type {any} */ _db, /** @type {Function} */ fn) => runTx(fn),
        writeBatch: () => {
            /** @type {string[]} */ const dels = [];
            let spent = false;
            return { set: () => {}, delete: (/** @type {any} */ ref) => { dels.push(ref.key); },
                commit: async () => {
                    // As Firestore's: a batch commits once, and a commit that FAILED has spent it too.
                    if (spent) throw new Error('A write batch can no longer be used after commit() has been called.');
                    spent = true;
                    if (batchFails && batchFails.times > 0) { batchFails.times--; throw Object.assign(new Error('refused'), { code: batchFails.code }); }
                    for (const k of dels) serverWrite(k, null); if (dels.length) commits.push(dels.map(k => `delete ${k}`));
                } };
        },
        serverTimestamp: () => SERVER_TS,
        // As the real one (claim-retry.js): a stale-claim refusal is retried once, by calling `fn` again.
        writeWithClaimRetry: async (/** @type {() => Promise<any>} */ fn) => {
            if (writeFails) throw writeFails;
            try { return await fn(); } catch (err) { if (/** @type {any} */ (err)?.code !== 'permission-denied') throw err; return fn(); }
        },
        whenOwnWritesSent: async () => true,
    },
});
mock.module('./session.js', { namedExports: { sessionReady: Promise.resolve(true) } });
mock.module('./slow-save.js', { namedExports: { withSlowSaveNotice: (/** @type {Promise<any>} */ p) => p } });

const { saveLeavePlans, readMemberRecords, readUploadLogs, writeUploadLog, newUploadLogId, pruneUploadLogs, undoUpload,
    CACHED_READ } = await import('./al-leave-save.js');

// ── INVENTED PEOPLE, REAL PATTERNS ──────────────────────────────────────────────────────────────
const YEAR = 2026;
const ADMIN = 'A. Clerkson';
/** @type {any} */ const CEA = { name: 'C. Specimen', role: 'CEA', rosterType: 'main', currentWeek: 1 };
/** @type {any} */ const CES = { name: 'D. Placeholder', role: 'CES', rosterType: 'ces', currentWeek: 1 };
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
const WORK = find(CEA, '2026-03-02', timed);
const WORK2 = find(CEA, plus(WORK, 1), timed);
const REST = find(CEA, '2026-03-02', resting);
const NEXT_JAN = find(CEA, '2027-01-04', timed);
const CES_WORK = find(CES, '2026-05-04', timed);

/** @param {any} m @param {string} date */
const leave = (m, date) => ({ name: m.name, date, kind: 'leave', foundIn: 'grid', countedBySheet: true });
/** @param {any} m */
function sheetPerson(m) {
    const printed = { carriedForward: 0, allowance: 32, used: 0, columnE: 0, remaining: 32 };
    return { name: m.name, grade: m.role, sheetRows: [{ row: 10, spelt: 'Specimen . X', grade: m.role, used: true, printed }],
        columnE: { datedDays: 0, joinerReduction: 0, lump: 0, unexplained: 0 }, corrected: { remaining: 32, because: [] } };
}
/** A record on the server, as a manager saved it. @param {any} m @param {string} date @param {string} id @param {Record<string, any>} [f] */
function seed(m, date, id, f = {}) {
    const ms = ++clock;
    serverWrite(`overrides/${id}`, { memberName: m.name, date, type: 'annual_leave', value: 'AL', note: '', source: 'manual',
        changedBy: 'E. Manager', createdAt: { toMillis: () => ms }, ...f });
}
/** Read a member as the card does, compare them with their sheet days, and plan them.
 *  @param {any} m @param {string[]} dates @param {{ confirmed?: boolean, answers?: Map<string, string> }} [o] */
async function planFor(m, dates, { confirmed = true, answers = new Map() } = {}) {
    const records = (await readMemberRecords([m.name])).get(m.name) ?? [];
    const person = comparePerson({ person: sheetPerson(m), days: dates.map(d => leave(m, d)), member: m, records, year: YEAR,
        todayStr: '2026-11-14', firstDate: '2026-01-01', lastDate: '2027-01-31' });
    const leaveYears = new Map(dates.map(d => [d, YEAR]));
    return planPerson({ person, records, answers, confirmed, leaveYears, changedBy: ADMIN });
}
/** @param {any} m @param {string} date */
const atFixed = (m, date) => server.get(`overrides/${manualOverrideId(m.name, date)}`);
/** @param {any} m @param {string} date @param {string} type @param {string} value */
const colleague = (m, date, type = 'shift', value = '06:00-14:00') => () =>
    seed(m, date, manualOverrideId(m.name, date), { type, value, changedBy: 'E. Manager' });

beforeEach(() => {
    server.clear(); versions.clear(); commits = []; reads = [];
    txRuns = 0; betweenReadAndCommit = null; landsUnanswered = 0; txFails = null; writeFails = null; cached = false;
    txFailOn = null; batchFails = null;
});

test('the premises: the found days are what their names say', () => {
    assert.ok(timed(pat(CEA, WORK)) && timed(pat(CEA, WORK2)) && timed(pat(CEA, NEXT_JAN)) && timed(pat(CES, CES_WORK)));
    assert.ok(resting(pat(CEA, REST)));
    assert.ok(NEXT_JAN.startsWith('2027-01-'));
});

describe('the Save', () => {
    test('a confirmed person’s days go in ONE checked transaction, as the Admin leave card writes them; nobody unconfirmed is touched', async () => {
        const a = await planFor(CEA, [WORK, REST, NEXT_JAN], { answers: new Map([[REST, 'swapped']]) });
        const c = await planFor(CES, [CES_WORK], { confirmed: false });
        const out = await saveLeavePlans([a, c]);
        assert.equal(out.stopped, null);
        assert.equal(out.partial, false);
        assert.deepEqual([...out.refused], []);
        assert.deepEqual([...out.saved], [[CEA.name, [WORK, REST, NEXT_JAN].sort()]]);
        assert.equal(commits.length, 1, 'one transaction for the person’s whole part');
        const w = atFixed(CEA, WORK);
        assert.deepEqual(Object.keys(w).sort(), ['changedBy', 'createdAt', 'date', 'memberName', 'note', 'source', 'type', 'value']);
        assert.deepEqual({ ...w, createdAt: undefined }, { memberName: CEA.name, date: WORK, type: 'annual_leave', value: 'AL', note: '',
            source: 'manual', changedBy: ADMIN, createdAt: undefined });
        assert.ok(w.createdAt.toMillis() > 0, 'stamped by the server');
        assert.equal(atFixed(CEA, REST).replacedType, 'shift', 'a rest day answered "swapped" costs a day');
        assert.equal(atFixed(CEA, NEXT_JAN).leaveYear, YEAR, 'a next-January day comes out of the sheet’s year');
        assert.equal(atFixed(CES, CES_WORK), undefined, 'an unconfirmed person is not written');
    });

    test('a colleague’s save of the same day after the check is refused by name, nothing of that person is written, and the next person still saves', async () => {
        const a = await planFor(CEA, [WORK, WORK2]);
        const c = await planFor(CES, [CES_WORK]);
        colleague(CEA, WORK)();
        const out = await saveLeavePlans([a, c]);
        assert.deepEqual([...out.refused], [[CEA.name, [WORK]]]);
        assert.equal(atFixed(CEA, WORK).type, 'shift', 'the colleague’s record stands');
        assert.equal(atFixed(CEA, WORK2), undefined, 'the refused part wrote nothing at all');
        assert.deepEqual([...out.saved], [[CES.name, [CES_WORK]]]);
        assert.equal(atFixed(CES, CES_WORK)?.type, 'annual_leave');
        assert.equal(out.stopped, null);
    });

    test('a change landing between the transaction’s read and its commit is met by the re-run, and refused', async () => {
        const a = await planFor(CEA, [WORK]);
        betweenReadAndCommit = colleague(CEA, WORK);
        const out = await saveLeavePlans([a]);
        assert.deepEqual([...out.refused], [[CEA.name, [WORK]]]);
        assert.equal(txRuns, 2, 'the stale attempt ran again');
        assert.equal(atFixed(CEA, WORK).type, 'shift');
    });

    test('a commit that landed with its answer lost is recognised on the re-run as its own: not refused, not written twice', async () => {
        const a = await planFor(CEA, [WORK, WORK2]);
        landsUnanswered = 1;
        const out = await saveLeavePlans([a]);
        assert.deepEqual([...out.refused], []);
        assert.deepEqual([...out.saved], [[CEA.name, [WORK, WORK2]]]);
        assert.equal(commits.length, 1, 'the re-run found the Save already there and wrote nothing');
    });

    test('a record exactly like the Save’s, there on its FIRST attempt, is the admin’s own booking by hand since the check — refused (review, 15 Nov 2026)', async () => {
        // ONE day: the person the sheet had one day missing for, booked in Admin after the check. With a
        // second day still unwritten the part could never read as already saved, so it would test nothing.
        const a = await planFor(CEA, [WORK]);
        assert.equal(atFixed(CEA, WORK), undefined, 'the premise: the check read nothing there');
        // Booked in Admin after the check, as the leave card writes it: the Save's own record, field for field.
        seed(CEA, WORK, manualOverrideId(CEA.name, WORK), { changedBy: ADMIN, replacedType: null, leaveYear: null });
        const out = await saveLeavePlans([a]);
        assert.deepEqual([...out.refused], [[CEA.name, [WORK]]], 'not taken for the Save’s own, which nothing has sent yet');
        assert.equal(out.saved.has(CEA.name), false);
        assert.equal(commits.length, 0, 'and nothing of that person was written');
    });

    test('a stored day answered "swapped" is rewritten with the swap recorded, and the copy it replaces must still be there', async () => {
        seed(CEA, REST, 'r-booked');
        const a = await planFor(CEA, [REST], { answers: new Map([[REST, 'swapped']]) });
        assert.equal(a.writes[0]?.kind, 'swap');
        const out = await saveLeavePlans([a]);
        assert.deepEqual([...out.saved], [[CEA.name, [REST]]]);
        assert.equal(server.has('overrides/r-booked'), false, 'the copy it replaces went in the same commit');
        assert.equal(atFixed(CEA, REST).replacedType, 'shift');

        server.clear();
        seed(CEA, REST, 'r-booked');
        const again = await planFor(CEA, [REST], { answers: new Map([[REST, 'swapped']]) });
        serverWrite('overrides/r-booked', null);   // a colleague deleted the leave after the check
        const refused = await saveLeavePlans([again]);
        assert.deepEqual([...refused.refused], [[CEA.name, [REST]]], 'leave cancelled since is not written back');
        assert.equal(atFixed(CEA, REST), undefined);
    });

    test('a device that knows it is offline writes nothing and tries nothing', async (t) => {
        const a = await planFor(CEA, [WORK]);
        const was = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
        Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true, writable: true });
        t.after(() => { if (was) Object.defineProperty(globalThis, 'navigator', was); else delete (/** @type {any} */ (globalThis)).navigator; });
        const out = await saveLeavePlans([a]);
        assert.equal(out.stopped, 'offline');
        assert.equal(out.partial, false);
        assert.equal(txRuns, 0);
        assert.equal(atFixed(CEA, WORK), undefined);
    });

    test('a part that never reached the server stops the whole Save, and says whether it may have landed', async () => {
        const a = await planFor(CEA, [WORK]);
        const c = await planFor(CES, [CES_WORK]);
        txFails = Object.assign(new Error('offline'), { code: 'unavailable' });
        const lost = await saveLeavePlans([a, c]);
        assert.equal(lost.stopped, 'offline');
        assert.equal(lost.code, 'unavailable');
        assert.equal(lost.partial, true, 'the last attempt may have committed, its answer lost');
        assert.deepEqual([...lost.saved], []);
        txFails = Object.assign(new Error('queued saves'), { code: 'unavailable', unsent: true });
        const unsent = await saveLeavePlans([a, c]);
        assert.equal(unsent.partial, false, 'a transaction that waited for this device’s own saves never started');
    });

    test('an account gone mid-write stops everybody, unconfirmed — it may still send once they sign back in', async () => {
        const a = await planFor(CEA, [WORK]);
        writeFails = Object.assign(new Error('signed out'), { code: SIGNED_OUT_CODE });
        const out = await saveLeavePlans([a]);
        assert.equal(out.stopped, 'unconfirmed');
        assert.equal(out.partial, true);
    });

    /** One person with 460 days, built by hand: no sheet year holds 451 days of one person's leave, and the parts are this module's. */
    function twoParts() {
        const dates = Array.from({ length: 460 }, (_, i) => plus('2030-01-01', i));
        const fieldsOf = (/** @type {string} */ date) => ({ memberName: CEA.name, date, type: 'annual_leave', value: 'AL', note: '',
            source: 'manual', changedBy: ADMIN, replacedType: null, leaveYear: null });
        /** @type {any} */ const big = { name: CEA.name, writes: dates.map(date => ({ kind: 'add', date, fixedId: manualOverrideId(CEA.name, date),
            shown: null, replaces: [], fields: fieldsOf(date) })) };
        return { dates, big };
    }

    test('a person in two parts: a refusal in the second keeps the first saved, and the next person still saves', async () => {
        const { dates, big } = twoParts();
        const c = await planFor(CES, [CES_WORK]);
        colleague(CEA, dates[455])();
        /** @type {Array<[number, number]>} */ const progress = [];
        const out = await saveLeavePlans([big, c], { onProgress: (d, n) => progress.push([d, n]) });
        assert.deepEqual(out.saved.get(CEA.name), dates.slice(0, 450));
        assert.deepEqual(out.refused.get(CEA.name), [dates[455]]);
        assert.equal(atFixed(CEA, dates[451]), undefined, 'nothing of the refused part');
        assert.deepEqual(out.saved.get(CES.name), [CES_WORK]);
        assert.deepEqual(progress, [[450, 461], [451, 461]]);
    });

    test('a refusal in a person’s FIRST part stops that person: their later part, planned from the same check, is never sent', async () => {
        const { dates, big } = twoParts();
        colleague(CEA, dates[5])();
        const out = await saveLeavePlans([big]);
        assert.deepEqual(out.refused.get(CEA.name), [dates[5]]);
        assert.equal(out.saved.has(CEA.name), false);
        assert.equal(atFixed(CEA, dates[455]), undefined, 'the second part was not sent');
        assert.equal(commits.length, 0);
    });
});

describe('reading', () => {
    test('each member is read once, by name; a read answered from the cache is no read', async () => {
        seed(CEA, WORK, 'x1');
        seed(CES, CES_WORK, 'x2');
        const got = await readMemberRecords([CEA.name, CES.name]);
        assert.deepEqual(reads.map(q => q.wheres), [[{ f: 'memberName', op: '==', v: CEA.name }], [{ f: 'memberName', op: '==', v: CES.name }]]);
        assert.deepEqual(got.get(CEA.name)?.map(r => r.id), ['x1']);
        cached = true;
        await assert.rejects(readMemberRecords([CEA.name]), (/** @type {any} */ e) => e.code === CACHED_READ && !String(e.message).includes(CEA.name));
    });

    test('the upload logs are read for a year and the year before, ids included, and never from the cache', async () => {
        // Last year's sheet ran into this January, so its log protects this file's first days too.
        serverWrite('alUploads/L1', { year: 2026, added: [] });
        serverWrite('alUploads/L2', { year: 2025, added: [] });
        serverWrite('alUploads/L3', { year: 2024, added: [] });
        const logs = await readUploadLogs(2026);
        assert.deepEqual(logs.map(l => l.id).sort(), ['L1', 'L2']);
        cached = true;
        await assert.rejects(readUploadLogs(2026), (/** @type {any} */ e) => e.code === CACHED_READ);
    });
});

/** A leave file as the card holds it, for the log's fields. */
const FILE = { year: YEAR, digest: `sha256:${'a'.repeat(64)}`,
    source: { sha256: 'b'.repeat(64), clerksLastSaved: '2026-11-12T09:30:00Z', lastSavedByClerk: true } };

describe('the upload log', () => {
    test('written once, with the server’s clock; the same Save written again writes nothing', async () => {
        const fields = /** @type {any} */ (logFields({ file: FILE, inLine: [dayKey(CEA.name, WORK)], added: [dayKey(CEA.name, WORK)], savedBy: ADMIN, appVersion: '26.12' }));
        const id = newUploadLogId();
        assert.equal(await writeUploadLog(id, fields), 'written');
        assert.equal(await writeUploadLog(id, fields), 'already');
        assert.equal(commits.length, 1);
        assert.ok(server.get(`alUploads/${id}`).savedAt.toMillis() > 0);
    });

    test('a create whose answer was lost finds itself on the re-run — the rules would refuse it sent again, as an update', async () => {
        const fields = /** @type {any} */ (logFields({ file: FILE, inLine: [dayKey(CEA.name, WORK)], added: [], savedBy: ADMIN, appVersion: '26.12' }));
        landsUnanswered = 1;
        const id = newUploadLogId();
        assert.equal(await writeUploadLog(id, fields), 'already');
        assert.equal(commits.length, 1, 'one create, and the re-run read it back');
    });

    // ACCEPTED, NOT YET WRITTEN (v26.14, backend-first). The rules take `writesMarked` a release
    // before the Save sends it (firestore.rules → alUploads). The release that writes it empties this
    // list, and from then the writer and the rule are pinned to the same fields again. Nothing else
    // may join it: a field the rules list and nobody writes is a gap, and this test exists to show one.
    const RULES_AHEAD_OF_WRITER = ['writesMarked'];

    test('its fields are exactly the ones the rules accept — the writer pinned to the rule', async () => {
        const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
        const block = rules.slice(rules.indexOf('match /alUploads/'));
        const listed = /function logFields\(\)\s*\{\s*return\s*\[([^\]]+)\]/.exec(block)?.[1];
        assert.ok(listed, 'logFields() is still in the rules block');
        const allowed = [...listed.matchAll(/'([^']+)'/g)].map(m => m[1]);
        for (const f of RULES_AHEAD_OF_WRITER) assert.ok(allowed.includes(f), `${f} is no longer in the rules' list`);
        const id = newUploadLogId();
        await writeUploadLog(id, /** @type {any} */ (logFields({ file: FILE, inLine: ['x|2026-01-05'], added: [], savedBy: ADMIN, appVersion: '26.12' })));
        assert.deepEqual(Object.keys(server.get(`alUploads/${id}`)).sort(),
            allowed.filter(f => !RULES_AHEAD_OF_WRITER.includes(f)).sort());
    });

    test('logs from before the year kept are deleted, and a read from the cache deletes nothing', async () => {
        for (const [id, year] of [['a', 2024], ['b', 2025], ['c', 2026]]) serverWrite(`alUploads/${id}`, { year });
        cached = true;
        assert.equal(await pruneUploadLogs(2025), 0);
        assert.equal(server.size, 3);
        cached = false;
        assert.equal(await pruneUploadLogs(2025), 1);
        assert.deepEqual([...server.keys()].sort(), ['alUploads/b', 'alUploads/c']);
    });

    test('a stale-claim refusal retried sends a FRESH batch: the one that was refused cannot commit again (review, 15 Nov 2026)', async () => {
        for (const [id, year] of [['a', 2023], ['b', 2024], ['c', 2026]]) serverWrite(`alUploads/${id}`, { year });
        batchFails = { code: 'permission-denied', times: 1 };
        assert.equal(await pruneUploadLogs(2025), 2);
        assert.deepEqual([...server.keys()], ['alUploads/c']);
        assert.equal(batchFails.times, 0, 'the premise: the first commit was refused');
    });
});

describe('Undo', () => {
    /** Save CEA's three days, then write the log from what landed, as the card does. */
    async function savedAndLogged() {
        const a = await planFor(CEA, [WORK, WORK2, NEXT_JAN]);
        await saveLeavePlans([a]);
        const added = [WORK, WORK2, NEXT_JAN].map(d => dayKey(CEA.name, d)).sort();
        const id = newUploadLogId();
        await writeUploadLog(id, /** @type {any} */ (logFields({ file: FILE, inLine: added, added, savedBy: ADMIN, appVersion: '26.12' })));
        const [log] = await readUploadLogs(YEAR);
        return { log, added, id };
    }
    const recordsNow = () => readMemberRecords([CEA.name]);

    test('every day the Save added that is still its own is removed, and the log records it once', async () => {
        const { log, added, id } = await savedAndLogged();
        const res = await undoUpload(log, { recordsByName: await recordsNow(), undoneBy: 'F. Example' });
        assert.deepEqual(res.removed, added);
        assert.deepEqual(res.kept, []);
        assert.equal(res.logged, 'written');
        for (const d of [WORK, WORK2, NEXT_JAN]) assert.equal(atFixed(CEA, d), undefined);
        const after = server.get(`alUploads/${id}`);
        assert.deepEqual(after.undone, added);
        assert.equal(after.undoneBy, 'F. Example');
        assert.ok(after.undoneAt.toMillis() > after.savedAt.toMillis());
    });

    test('a day a colleague changed since is kept', async () => {
        const { log, added } = await savedAndLogged();
        colleague(CEA, WORK)();
        const res = await undoUpload(log, { recordsByName: await recordsNow(), undoneBy: ADMIN });
        assert.deepEqual(res.kept, [dayKey(CEA.name, WORK)]);
        assert.deepEqual(res.removed, added.filter(k => k !== dayKey(CEA.name, WORK)));
        assert.equal(atFixed(CEA, WORK).type, 'shift');
    });

    test('a change landing just before the delete is refused and kept, and the rest of that person’s days still go', async () => {
        const { log, id } = await savedAndLogged();
        const records = await recordsNow();
        betweenReadAndCommit = colleague(CEA, WORK2);
        const res = await undoUpload(log, { recordsByName: records, undoneBy: ADMIN });
        assert.deepEqual(res.kept, [dayKey(CEA.name, WORK2)]);
        assert.deepEqual(res.removed, [dayKey(CEA.name, WORK), dayKey(CEA.name, NEXT_JAN)].sort());
        assert.equal(atFixed(CEA, WORK2).type, 'shift');
        assert.deepEqual(server.get(`alUploads/${id}`).undone, res.removed, 'the log lists only what was taken back');
    });

    test('nothing removed records nothing, so the log does not claim an undo that never happened', async () => {
        const { log, id } = await savedAndLogged();
        for (const d of [WORK, WORK2, NEXT_JAN]) colleague(CEA, d)();
        const res = await undoUpload(log, { recordsByName: await recordsNow(), undoneBy: ADMIN });
        assert.equal(res.logged, 'nothing');
        assert.equal('undoneAt' in server.get(`alUploads/${id}`), false);
    });

    test('two Undos at once remove the days once, and the log records the first only — the rules allow one', async () => {
        const { log, id } = await savedAndLogged();
        const records = await recordsNow();
        const [one, two] = await Promise.all([undoUpload(log, { recordsByName: records, undoneBy: ADMIN }),
            undoUpload(log, { recordsByName: records, undoneBy: 'F. Example' })]);
        assert.deepEqual([one.logged, two.logged].sort(), ['already', 'written']);
        assert.equal(server.get(`alUploads/${id}`).undoneBy, one.logged === 'written' ? ADMIN : 'F. Example');
        for (const d of [WORK, WORK2, NEXT_JAN]) assert.equal(atFixed(CEA, d), undefined);
    });

    test('a day of the Save’s that is gone since is taken back with the rest: the Undo withdraws the Save’s claim on it', async () => {
        const { log, id } = await savedAndLogged();
        serverWrite(`overrides/${manualOverrideId(CEA.name, WORK)}`, null);   // removed in Admin since
        const res = await undoUpload(log, { recordsByName: await recordsNow(), undoneBy: ADMIN });
        assert.deepEqual(res.removed, [dayKey(CEA.name, WORK2), dayKey(CEA.name, NEXT_JAN)].sort());
        assert.deepEqual(res.gone, [dayKey(CEA.name, WORK)]);
        assert.equal(res.logged, 'written');
        assert.deepEqual(server.get(`alUploads/${id}`).undone, [WORK, WORK2, NEXT_JAN].map(d => dayKey(CEA.name, d)).sort());
    });

    test('an Undo whose deletes landed and whose mark did not is FINISHED by pressing it again (review, 15 Nov 2026)', async () => {
        const { log, id, added } = await savedAndLogged();
        txFailOn = { col: 'alUploads', code: 'unavailable', times: 1 };
        await assert.rejects(undoUpload(log, { recordsByName: await recordsNow(), undoneBy: ADMIN }), (/** @type {any} */ e) => e.code === 'unavailable');
        for (const d of [WORK, WORK2, NEXT_JAN]) assert.equal(atFixed(CEA, d), undefined, 'the deletes landed');
        assert.equal('undoneAt' in server.get(`alUploads/${id}`), false, 'the mark did not');
        const again = await undoUpload(log, { recordsByName: await recordsNow(), undoneBy: ADMIN });
        assert.deepEqual(again.removed, [], 'nothing left to remove');
        assert.equal(again.logged, 'written', 'and the Save is marked undone, so it reads as taken back');
        assert.deepEqual(server.get(`alUploads/${id}`).undone, added);
    });

    test('…and one cut short BETWEEN two people takes back the rest on the second press, marking both', async () => {
        const a = await planFor(CEA, [WORK, WORK2]);
        const c = await planFor(CES, [CES_WORK]);
        await saveLeavePlans([a, c]);
        const added = [dayKey(CEA.name, WORK), dayKey(CEA.name, WORK2), dayKey(CES.name, CES_WORK)].sort();
        const id = newUploadLogId();
        await writeUploadLog(id, /** @type {any} */ (logFields({ file: FILE, inLine: added, added, savedBy: ADMIN, appVersion: '26.12' })));
        const [log] = await readUploadLogs(YEAR);
        const both = () => readMemberRecords([CEA.name, CES.name]);
        txFailOn = { col: 'overrides', code: 'unavailable', skip: 1, times: 1 };   // the first person goes, the second does not
        await assert.rejects(undoUpload(log, { recordsByName: await both(), undoneBy: ADMIN }), (/** @type {any} */ e) => e.code === 'unavailable');
        const left = [WORK, WORK2].filter(d => atFixed(CEA, d)).length + (atFixed(CES, CES_WORK) ? 1 : 0);
        assert.ok(left > 0 && left < 3, 'the premise: one person’s days went and the other’s did not');
        const again = await undoUpload(log, { recordsByName: await both(), undoneBy: ADMIN });
        assert.equal(again.removed.length, left);
        assert.equal(again.logged, 'written');
        assert.deepEqual(server.get(`alUploads/${id}`).undone, added, 'every day of the Save’s, both presses');
        assert.equal(atFixed(CEA, WORK) ?? atFixed(CEA, WORK2) ?? atFixed(CES, CES_WORK), undefined);
    });

    test('a failure other than a refusal stops the Undo and records nothing, so it can be pressed again', async () => {
        const { log, id } = await savedAndLogged();
        const records = await recordsNow();
        txFails = Object.assign(new Error('offline'), { code: 'unavailable' });
        await assert.rejects(undoUpload(log, { recordsByName: records, undoneBy: ADMIN }), (/** @type {any} */ e) => e.code === 'unavailable');
        assert.equal('undoneAt' in server.get(`alUploads/${id}`), false);
        txFails = null;
        const res = await undoUpload(log, { recordsByName: records, undoneBy: ADMIN });
        assert.equal(res.logged, 'written');
    });
});
