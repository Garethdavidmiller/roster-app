// @ts-check
/**
 * operations-legacy.js — the Old-format records card on operations.html (v25.28).
 *
 * Three override types can still be READ and can no longer be CREATED: `allocated`, `overtime` and
 * `swap` (`LEGACY_OVERRIDE_TYPES`, override-utils.js). The code that reads them — their labels, how
 * each is classed, the "old format" pill in Admin's Saved Changes — can only be deleted once no
 * record uses them, and until this card nothing in the app could say whether any did. It answers
 * that one question. Since v25.31 it can also CONVERT them, which is the only write it makes —
 * see "THE CONVERSION" below.
 *
 * ── TWO READS, PRICED DIFFERENTLY ───────────────────────────────────────────────────────────────
 *
 *  - THE COUNTS, on page load: one server-side count per type (`getCountFromServer`). Nothing is
 *    downloaded — Firestore charges one read per thousand records counted — and `type ==` runs on
 *    the single-field index Firestore keeps for every field unless told otherwise, so no index is
 *    added. That is what puts the total in the header chip while the card is still closed.
 *  - THE YEARS, on the first open. "How many of type X in year Y" is an equality and a range on two
 *    different fields, which needs a COMPOSITE index this project does not have
 *    (firestore.indexes.json holds one: memberName + date). Adding one for a one-off question is a
 *    backend-first, two-push change; reading the records themselves costs ONE READ EACH and needs
 *    nothing. So they are read only when the admin opens the card, never more than `YEARS_CAP` of
 *    them, and above that the card says so instead of downloading them.
 *
 * ── IT NEVER SAYS "NONE" WITHOUT A COUNT THAT SAID SO ───────────────────────────────────────────
 *
 * "None left" is the answer that gets code deleted, so it comes only from three counts the server
 * actually returned. A count that did not arrive, or arrived as anything but a whole number, is a
 * failure with a Try again — never a zero. `summariseLegacy` is the one place that decision is made,
 * which is why the reader passes the server's figure through untouched rather than checking it too:
 * two guards on one fact means deleting either leaves every test green. The Needs-attention strip
 * makes the same refusal for its own items ("a failed card load reports nothing rather than a
 * reassuring zero").
 *
 * ── THE CONVERSION (v25.31) ─────────────────────────────────────────────────────────────────────
 *
 * The card counted 131, all dated 2026 — inside the leave year and the pay periods still in use, so
 * deleting them was never on the table. The OWNER chose the mapping (4 Nov 2026), and it is not a
 * default this module may change: Allocated shift and Swap become `shift` (contracted, which is how
 * they were already classed); Overtime becomes `rdw` on a base-roster REST day and `shift` on a
 * rostered working day, and the working-day ones are shown to the admin first. Any of them on a
 * SUNDAY becomes `rdw`, because a worked Sunday is always RDW (`SUNDAY_FORBIDDEN_TYPES`) — they
 * already DISPLAY as RDW there, so that changes nothing anyone sees.
 *
 * Four things `planLegacyConversion` holds, each one a way a well-meant rewrite goes wrong:
 *
 *  - A REWRITE IS A NEW SAVE. `firestore.rules` makes `createdAt` the server's clock at this write,
 *    and between two records for one member and day the NEWER wins (`shouldReplaceOverride`). So an
 *    old record that a newer change has already superseded would win again once rewritten. Those
 *    are REMOVED instead — they show nowhere today, so removing them changes nothing on screen — and
 *    a record that ties with another is left alone and listed, because which one shows today is not
 *    decided by anything the plan can read.
 *  - THE REWRITE IS WHOLE. The rules' `hasOnly` field list refuses a document carrying anything
 *    else, and an old record may carry fields from before that list existed. So the new document is
 *    `buildOverrideWrite`'s output — the same builder every save path uses, and the one
 *    `firestore.rules.test.mjs` runs against the rules — written with a plain `set`, which replaces
 *    the document rather than merging into it.
 *  - WHAT THE RULES WOULD REFUSE IS LEFT AND LISTED, never sent: times not in today's bounded
 *    HH:MM-HH:MM, a date that is not a day, a fixed id that does not name its own day. One refused
 *    write fails the whole batch, so sending one would convert nothing at all.
 *  - IT RE-READS BEFORE IT WRITES. The admin presses Convert on a list read a minute earlier; a
 *    manager may have saved over one of those days since. The records are read again at the press,
 *    and if the plan they give would write anything different from the one on screen
 *    (`planSignature`), nothing is written and the new list is shown instead. The batch is one atomic commit, capped at `BATCH_LIMIT`, so a failure leaves
 *    every record as it was.
 *
 * Firestore point-in-time recovery is on for this project (RECOVERY_RUNBOOK.md), so for seven days
 * the originals are recoverable even after a successful run.
 *
 * ── WHAT A MEMBER SEES AFTERWARDS — said on the card before the press ───────────────────────────
 *
 *  - REST-DAY OVERTIME STARTS SHOWING AS RDW. `resolveEffectiveShift` draws only `rdw` as RDW (and
 *    the old types only on a Sunday), so those days were an ordinary Early/Late badge until now.
 *    The Pay Calculator's calendar fill starts counting them too: on a Saturday or a bank holiday it
 *    already did, but a Mon–Fri rest-day `overtime` was skipped as ambiguous (paycalc.md invariant
 *    11), and an explicit `rdw` is not ambiguous. Everything else draws, and prices, as it did —
 *    every non-`rdw` type takes the same paths through both.
 *  - "LAST SAVED BY" NAMES THE ADMIN. The rules accept only the writer's own name as `changedBy`, and
 *    the Calendar's day panel names the last writer of a hand-recorded change (`changeProvenance`).
 *    True after the run, which is why the panel says "last saved" and not "changed" (v22.79).
 *  - A WORKING-DAY OVERTIME BECOMES CONTRACTED WORK. `overtime` was voluntary and `shift` is not
 *    (`CONTRACTED_WORK_TYPES`), so leave booked over one of those days later is charged — as it would
 *    be on the rostered working day underneath anyway.
 *
 * A record the card leaves alone is fixed by hand: saving that day again in Admin's Change a Shift
 * replaces it (`idsReplacedBy`), or ✕ in Saved Changes removes it.
 *
 * ── IT IS TEMPORARY ─────────────────────────────────────────────────────────────────────────────
 *
 * When it reads "None left", this module, its card, its tips entry and its e2e go together with the
 * legacy types themselves (`admin-shift-types.js`'s sunset note lists that code).
 *
 * The reader takes its Firestore handles as arguments — the `analytics-client.js` pattern — so it
 * and the summary load in Node: `operations-legacy.test.mjs` runs both against a fake. The wiring,
 * a real page reading through the e2e stub, is `e2e/operations.spec.js`.
 */
import { LEGACY_OVERRIDE_TYPES, buildOverrideWrite, shouldReplaceOverride, isRestShift } from './override-utils.js';
import { TYPES } from './admin-shift-types.js';
import { teamMembers, getBaseShift } from './roster-data.js';
import { formatWeekdayDate } from './date-format.js';
import { _cardLoadError } from './operations-reports.js';

/** The most records the card downloads to group by year — one read each, on the admin's open. */
export const YEARS_CAP = 1000;

/** A stored override day: 'YYYY-MM-DD' (firestore.rules holds every write to that shape). */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What a record whose `date` is not a day is grouped under — shown, never dropped. */
export const NO_DATE = 'no date';

/** Firestore's ceiling on `in` values in one query. */
const IN_LIMIT = 30;

/** The most writes the conversion sends. One batch, so all or nothing (Firestore's own cap is 500). */
export const BATCH_LIMIT = 450;

/** The times a `shift` or `rdw` may carry — firestore.rules' own bounded pattern, anchored. */
const TIMES = /^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** The types `replacedType` may name (firestore.rules); anything else is dropped from the rewrite. */
const REPLACED_TYPES = new Set(['spare_shift', 'shift', 'rdw', 'annual_leave', 'correction', 'sick', 'other', ...LEGACY_OVERRIDE_TYPES]);

/**
 * The Firestore half: the counts, and the records' days. Handles are injected, so the shape of
 * every query is asserted against a fake rather than taken on trust.
 *
 * @param {{
 *   db: any,
 *   collectionName: string,
 *   fs: { collection: Function, query: Function, where: Function, limit: Function, getDocs: Function, getCountFromServer: Function,
 *         doc?: Function, writeBatch?: Function, serverTimestamp?: Function },
 * }} deps
 */
export function buildLegacyReader({ db, collectionName, fs }) {
    const col = () => fs.collection(db, collectionName);
    return {
        /**
         * One server-side count per type, in parallel. The figure is passed through as the server
         * sent it — `summariseLegacy` decides whether it can be believed (the header says why).
         * @param {readonly string[]} [types]
         * @returns {Promise<Record<string, unknown>>}
         */
        async countByType(types = LEGACY_OVERRIDE_TYPES) {
            const snaps = await Promise.all(types.map(t =>
                fs.getCountFromServer(fs.query(col(), fs.where('type', '==', t)))));
            return Object.fromEntries(types.map((t, i) => [t, snaps[i]?.data?.()?.count]));
        },
        /**
         * The records themselves, for their days — ONE READ EACH, so capped.
         * @param {readonly string[]} [types]
         * @param {number} [cap]
         * @returns {Promise<Array<{ type: string, date: string }>>}
         */
        async fetchDays(types = LEGACY_OVERRIDE_TYPES, cap = YEARS_CAP) {
            const snap = await fs.getDocs(fs.query(col(), fs.where('type', 'in', [...types]), fs.limit(cap)));
            return snap.docs.map((/** @type {any} */ d) => {
                const o = d.data() || {};
                return { type: String(o.type), date: typeof o.date === 'string' ? o.date : '' };
            });
        },
        /**
         * Every override on these days — the old records AND whatever else shares a day with them,
         * which the plan needs to know which record each day actually shows. `date in` takes
         * `IN_LIMIT` values a query, so the days go in chunks. ONE READ PER RECORD.
         * @param {string[]} dates
         * @returns {Promise<Array<{ id: string, data: any }>>}
         */
        async fetchByDates(dates) {
            const unique = [...new Set(dates.filter(d => DAY.test(d)))].sort();
            /** @type {Array<{ id: string, data: any }>} */
            const out = [];
            for (let i = 0; i < unique.length; i += IN_LIMIT) {
                const snap = await fs.getDocs(fs.query(col(), fs.where('date', 'in', unique.slice(i, i + IN_LIMIT))));
                for (const d of snap.docs) out.push({ id: d.id, data: d.data() || {} });
            }
            return out;
        },
        /**
         * Write a plan: every conversion a whole-document `set`, every superseded record a delete, in
         * ONE batch — so it lands entirely or not at all. Refuses a plan bigger than one batch rather
         * than splitting it, because a split could leave half the records converted.
         * @param {LegacyPlan} plan
         * @returns {Promise<{ converted: number, removed: number }>}
         */
        async apply(plan) {
            if (!fs.writeBatch || !fs.doc || !fs.serverTimestamp) throw new Error('No write handles');
            if (plan.convert.length + plan.remove.length > BATCH_LIMIT) throw new Error('Too many for one batch');
            const batch = fs.writeBatch(db);
            for (const c of plan.convert) batch.set(fs.doc(db, collectionName, c.id), conversionWrite(c, fs.serverTimestamp()));
            for (const r of plan.remove) batch.delete(fs.doc(db, collectionName, r.id));
            await batch.commit();
            return { converted: plan.convert.length, removed: plan.remove.length };
        },
    };
}

/**
 * @typedef {{ id: string, memberName: string, date: string, from: string, value: unknown }} LegacyRow
 * @typedef {LegacyRow & { to: 'shift'|'rdw', why: 'sunday'|'rest-day'|'working-day'|'contracted', source: string, changedBy: string, replacedType: string|null }} ConvertRow
 * @typedef {LegacyRow & { reason: string }} SetAsideRow
 * @typedef {{ convert: ConvertRow[], remove: SetAsideRow[], skip: SetAsideRow[] }} LegacyPlan
 */

/** 'YYYY-MM-DD' → a local Date, or null when it is not a real day. @param {string} iso */
function dayOf(iso) {
    if (!DAY.test(iso)) return null;
    const [y, m, d] = iso.split('-').map(Number);
    const day = new Date(y, m - 1, d);
    return day.getFullYear() === y && day.getMonth() === m - 1 && day.getDate() === d ? day : null;
}

/**
 * Decide what happens to each old-format record. PURE: it reads nothing and writes nothing — the
 * reader supplies every override on the days involved, so the same rules decide in a test, in the
 * preview and again at the press. The four things it holds are in the header.
 *
 * @param {Array<{ id: string, data: any }>} sameDay  every override on the days that hold an old record
 * @param {{ adminName: string, members?: any[], baseShift?: (member: any, day: Date) => string }} opts
 * @returns {LegacyPlan}
 */
export function planLegacyConversion(sameDay, { adminName, members = teamMembers, baseShift = getBaseShift }) {
    const legacy = new Set(LEGACY_OVERRIDE_TYPES);
    /** @type {Map<string, Array<{ id: string, data: any }>>} */
    const byKey = new Map();
    for (const r of sameDay) {
        const key = `${r.data.memberName}|${r.data.date}`;
        const list = byKey.get(key);
        if (list) list.push(r); else byKey.set(key, [r]);
    }
    /** @type {LegacyPlan} */
    const plan = { convert: [], remove: [], skip: [] };
    for (const r of sameDay) {
        const o = r.data;
        if (!legacy.has(o.type)) continue;
        /** @type {LegacyRow} */
        const row = { id: r.id, memberName: String(o.memberName ?? ''), date: String(o.date ?? ''), from: o.type, value: o.value };
        const others = (byKey.get(`${o.memberName}|${o.date}`) || []).filter(s => s !== r);
        // Superseded today → removed, so it cannot win again as a fresh save. A tie → left alone.
        if (others.some(s => shouldReplaceOverride(o, s.data) && !shouldReplaceOverride(s.data, o))) {
            plan.remove.push({ ...row, reason: 'replaced' }); continue;
        }
        if (others.some(s => shouldReplaceOverride(o, s.data) && shouldReplaceOverride(s.data, o))) {
            plan.skip.push({ ...row, reason: 'tie' }); continue;
        }
        const day = dayOf(row.date);
        const problem = !day ? 'bad-date'
            : !row.memberName || row.memberName.length >= 100 ? 'bad-name'
            : typeof row.value !== 'string' || !TIMES.test(row.value) ? 'bad-times'
            : r.id.startsWith('m_') && r.id !== `m_${row.date}_${row.memberName.replaceAll(' ', '%20')}` ? 'bad-id'
            : null;
        if (problem || !day) { plan.skip.push({ ...row, reason: problem || 'bad-date' }); continue; }
        /** @type {'shift'|'rdw'} */ let to;
        /** @type {ConvertRow['why']} */ let why;
        if (day.getDay() === 0) { to = 'rdw'; why = 'sunday'; }
        else if (o.type !== 'overtime') { to = 'shift'; why = 'contracted'; }
        else {
            const member = members.find(m => m.name === row.memberName);
            if (!member) { plan.skip.push({ ...row, reason: 'not-on-roster' }); continue; }
            if (isRestShift(baseShift(member, day))) { to = 'rdw'; why = 'rest-day'; }
            else { to = 'shift'; why = 'working-day'; }
        }
        plan.convert.push({
            ...row, to, why,
            source: o.source === 'roster_import' ? 'roster_import' : 'manual',
            changedBy: adminName,
            replacedType: typeof o.replacedType === 'string' && REPLACED_TYPES.has(o.replacedType) ? o.replacedType : null,
        });
    }
    const order = (/** @type {LegacyRow} */ a, /** @type {LegacyRow} */ b) =>
        a.date.localeCompare(b.date) || a.memberName.localeCompare(b.memberName) || a.id.localeCompare(b.id);
    plan.convert.sort(order); plan.remove.sort(order); plan.skip.sort(order);
    return plan;
}

/**
 * The document a conversion writes — `buildOverrideWrite`'s, so the rules test of that builder
 * covers it, with `note` empty (as every save writes it) and the server's clock.
 * @param {ConvertRow} c
 * @param {*} createdAt  a serverTimestamp() sentinel
 */
export function conversionWrite(c, createdAt) {
    return buildOverrideWrite({
        memberName: c.memberName, date: c.date, type: c.to, value: c.value, note: '',
        source: c.source, changedBy: c.changedBy, replacedType: c.replacedType,
    }, createdAt);
}

/**
 * Two plans that would WRITE the same thing read the same — every field a conversion writes but
 * the writer's own name (the same admin both times), and every removal. That is what makes it the
 * test at the press: the batch sends the plan that was SHOWN, so a record whose times changed since
 * the preview must stop it, or the press would write back the times read a minute earlier. What is
 * only left alone writes nothing, so a change there does not stop a press.
 * @param {LegacyPlan} p
 */
export function planSignature(p) {
    return JSON.stringify([
        p.convert.map(c => [c.id, c.to, c.memberName, c.date, c.value, c.source, c.replacedType]),
        p.remove.map(r => r.id),
    ]);
}

/** What each set-aside reason says on screen. @param {SetAsideRow} r */
export function setAsideText(r) {
    switch (r.reason) {
        case 'replaced':      return 'a newer change for that day already shows';
        case 'tie':           return 'another change for that day was saved at the same moment';
        case 'bad-times':     return `its times (“${String(r.value ?? '')}”) are not in today’s format`;
        case 'bad-date':      return 'its date is not a real day';
        case 'bad-name':      return 'it has no usable name';
        case 'bad-id':        return 'its record does not name its own day';
        case 'not-on-roster': return 'not on the roster any more, so its rest days cannot be checked';
        default:              return r.reason;
    }
}

/** One row of the preview: "S. Silva · Sat 7 Mar 2026 · Overtime 06:20-14:20 → RDW".
 *  @param {LegacyRow & { to?: string }} r */
export function previewRowText(r) {
    const day = dayOf(r.date);
    const label = (/** @type {string} */ t) => /** @type {Record<string, { label: string, pill?: string }>} */ (TYPES)[t]?.pill
        ?? /** @type {Record<string, { label: string }>} */ (TYPES)[t]?.label ?? t;
    const when = day ? formatWeekdayDate(day, true) : r.date;
    return `${r.memberName} · ${when} · ${label(r.from)} ${String(r.value ?? '')}${r.to ? ` → ${label(r.to)}` : ''}`;
}

/**
 * Group one type's records by the YEAR of the day each change is for, oldest first, with any
 * record that has no readable day last rather than left out.
 * @param {string} type
 * @param {Array<{ type: string, date: string }>} days
 * @returns {Array<{ year: string, count: number }>}
 */
function yearsFor(type, days) {
    /** @type {Map<string, number>} */
    const byYear = new Map();
    for (const d of days) {
        if (d.type !== type) continue;
        const year = DAY.test(d.date) ? d.date.slice(0, 4) : NO_DATE;
        byYear.set(year, (byYear.get(year) || 0) + 1);
    }
    return [...byYear]
        .sort(([a], [b]) => (a === NO_DATE ? 1 : b === NO_DATE ? -1 : a.localeCompare(b)))
        .map(([year, count]) => ({ year, count }));
}

/**
 * Everything the card says, decided in one place. THROWS when any count is not a whole number —
 * that is the "never a zero we were not given" rule, and the card turns the throw into a failure
 * with a Try again.
 *
 * @param {Record<string, unknown>} counts    from `countByType`
 * @param {Array<{ type: string, date: string }>|null} [days]   the records' days, or null when not read
 * @param {readonly string[]} [types]
 * @returns {{ total: number, rows: Array<{ type: string, label: string, count: number, years: Array<{ year: string, count: number }>|null }> }}
 */
export function summariseLegacy(counts, days = null, types = LEGACY_OVERRIDE_TYPES) {
    const rows = types.map(type => {
        const count = counts?.[type];
        if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
            throw new Error(`No usable count for "${type}"`);
        }
        const label = /** @type {Record<string, { label: string }>} */ (TYPES)[type]?.label ?? type;
        return { type, label, count, years: days && count ? yearsFor(type, days) : null };
    });
    return { total: rows.reduce((sum, r) => sum + r.count, 0), rows };
}

/**
 * One type's line: "Allocated shift: 9 — 2025: 7 · 2026: 2", or "Swap: none".
 * @param {{ label: string, count: number, years: Array<{ year: string, count: number }>|null }} row
 * @returns {string}
 */
export function legacyRowText(row) {
    if (!row.count) return `${row.label}: none`;
    const years = row.years?.length ? ` — ${row.years.map(y => `${y.year}: ${y.count}`).join(' · ')}` : '';
    return `${row.label}: ${row.count}${years}`;
}

/**
 * Wire the card. Reads the counts at once (the header chip shows the total while the card is
 * closed) and the years on the first open — the coordinator forwards the card's toggle here. Once
 * the years are in, the card offers the conversion: a preview first, then a press (header).
 *
 * @param {{
 *   reader: ReturnType<typeof buildLegacyReader>,
 *   withClaimRetry: (fn: () => Promise<any>) => Promise<any>,
 *   writeWithClaimRetry?: (fn: () => Promise<any>) => Promise<any>,
 *   confirmDialog?: (opts: { title: string, message: string, confirmLabel?: string, danger?: boolean }) => Promise<boolean>,
 *   getAdminName?: () => string|null,
 *   sessionReady: Promise<unknown>,
 * }} deps
 * @returns {{ onToggle: (open: boolean) => void }}
 */
export function initLegacyCard({ reader, withClaimRetry, writeWithClaimRetry = withClaimRetry, confirmDialog, getAdminName = () => null, sessionReady }) {
    const found = document.getElementById('legacyRecordsContent');
    if (!found) return { onToggle() {} };
    const content = found;   // narrowed once, for the functions below (a declaration is hoisted past a guard)
    const chip = document.getElementById('legacyRecordsCountChip');

    /** @type {Record<string, unknown>|null} */
    let counts = null;
    /** @type {Array<{ type: string, date: string }>|null} */
    let days = null;
    /** 'idle' until the first open; 'skipped' when there are none, or too many, to read. */
    let years = /** @type {'idle'|'loading'|'loaded'|'failed'|'skipped'} */ ('idle');
    let opened = false;
    /** @type {LegacyPlan|null} */
    let plan = null;
    /** 'stale' = the press found the records had changed, and the list on screen is the new one. */
    let planState = /** @type {'idle'|'loading'|'shown'|'failed'|'writing'|'stale'} */ ('idle');
    /** The outcome of the last press, kept across the recount that follows it. */
    let result = /** @type {{ text: string, failed: boolean }|null} */ (null);

    /** @param {string} text @param {string} [cls] */
    const para = (text, cls = 'auth-desc') => {
        const p = document.createElement('p');
        p.className = cls;
        p.textContent = text;
        return p;
    };
    /** @param {string} text @param {string} cls @param {() => void} onClick */
    const button = (text, cls, onClick) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = cls;
        b.textContent = text;
        b.addEventListener('click', () => { b.disabled = true; onClick(); });
        return b;
    };
    const error = (/** @type {string} */ text) => { const p = para(text, 'auth-desc legacy-records-note'); p.style.color = 'var(--error-red)'; return p; };

    function render() {
        if (!counts) return;
        const summary = summariseLegacy(counts, years === 'loaded' ? days : null);
        if (chip) chip.textContent = summary.total ? String(summary.total) : '';
        content.innerHTML = '';
        if (result) {
            const p = result.failed ? error(result.text) : para(result.text, 'auth-desc legacy-records-result');
            p.setAttribute('role', 'status');
            content.appendChild(p);
        }
        if (!summary.total) {
            content.appendChild(para('None left. No shift change in the database uses an old format, so the code that still reads them can be removed.'));
            return;
        }
        content.appendChild(para(`${summary.total} left. They still show — in the Calendar, and marked “old format” in Admin’s Saved Changes.`));
        const list = document.createElement('ul');
        list.className = 'legacy-records-list';
        for (const row of summary.rows) {
            const li = document.createElement('li');
            li.textContent = legacyRowText(row);
            list.appendChild(li);
        }
        content.appendChild(list);
        if (years === 'loaded') {
            content.appendChild(para('Years are those of the day each change is for.', 'auth-desc legacy-records-note'));
            renderConversion();
        } else if (years === 'loading') {
            content.appendChild(para('Reading their years…', 'auth-desc legacy-records-note'));
        } else if (years === 'skipped') {
            content.appendChild(para(`Too many to read for their years here — ${summary.total}, and the card reads at most ${YEARS_CAP}.`, 'auth-desc legacy-records-note'));
        } else if (years === 'failed') {
            content.append(error('Couldn’t read their years — check your connection.'),
                button('↻ Try again', 'btn-action btn-secondary card-retry-btn', () => loadYears()));
        }
    }

    /** The conversion half of the card, under the counts. */
    function renderConversion() {
        const box = document.createElement('div');
        box.className = 'legacy-convert';
        content.appendChild(box);
        if (planState === 'idle' || planState === 'failed' || !plan) {
            box.appendChild(para('Convert them to today’s types: Allocated shift and Swap become Shift, and Overtime becomes RDW on a rest day or Shift on a rostered working day. Nothing changes until you press Convert.'));
            if (planState === 'failed') box.appendChild(error('Couldn’t read the records — check your connection.'));
            if (planState === 'loading') box.appendChild(para('Reading the records and the other changes on their days…', 'auth-desc legacy-records-note'));
            else box.appendChild(button('Show what would change', 'btn-action btn-secondary', () => loadPlan()));
            return;
        }
        const p = plan;
        const parts = [p.convert.length ? `${p.convert.length} to convert` : 'None to convert'];
        if (p.remove.length) parts.push(`${p.remove.length} to remove`);
        if (p.skip.length) parts.push(`${p.skip.length} left as they are`);
        if (planState === 'stale') box.appendChild(error('The records changed since you looked. This is the up-to-date list — check it, then press Convert again.'));
        box.appendChild(para(`${parts.join(', ')}.`, 'auth-desc legacy-records-plan'));
        // The one VISIBLE change is the RDW group's, so it is the one group that says so: rest-day
        // Overtime was drawn as an ordinary shift (resolveEffectiveShift treats only `rdw` as RDW,
        // and only on a Sunday does it promote the old types). Everything else draws as it did.
        /** @type {Array<[string, Array<LegacyRow & { to?: string, why?: string, reason?: string }>, boolean, string?]>} */
        const groups = [
            ['Become Shift', p.convert.filter(c => c.to === 'shift' && c.why !== 'working-day'), false],
            ['Overtime on a rostered working day — becomes Shift', p.convert.filter(c => c.why === 'working-day'), true],
            ['Become RDW', p.convert.filter(c => c.to === 'rdw'), false,
                'In the Calendar these show as RDW. Until now, those not on a Sunday showed as an ordinary shift.'],
            ['Removed — a newer change for that day already shows', p.remove, true],
            ['Left as they are', p.skip, true],
        ];
        for (const [title, rows, openByDefault, note] of groups) {
            if (!rows.length) continue;
            const det = document.createElement('details');
            det.className = 'legacy-group';
            det.open = openByDefault;
            const sum = document.createElement('summary');
            sum.textContent = `${title} (${rows.length})`;
            det.appendChild(sum);
            if (note) det.appendChild(para(note, 'auth-desc legacy-records-note'));
            const ul = document.createElement('ul');
            ul.className = 'legacy-records-list';
            for (const r of rows) {
                const li = document.createElement('li');
                const tail = r.reason && r.reason !== 'replaced' ? ` — ${setAsideText(/** @type {SetAsideRow} */ (r))}` : r.why === 'sunday' ? ' (a Sunday)' : '';
                li.textContent = previewRowText(r) + tail;
                ul.appendChild(li);
            }
            det.appendChild(ul);
            box.appendChild(det);
        }
        const writes = p.convert.length + p.remove.length;
        if (!writes) return;
        if (writes > BATCH_LIMIT) { box.appendChild(error(`Too many to change in one go (${writes}; at most ${BATCH_LIMIT}).`)); return; }
        // WHAT A MEMBER WILL SEE. The rules accept only the writer's own name as `changedBy`, so every
        // rewrite carries the admin's — and the Calendar's day panel names the last writer of a
        // hand-recorded change (`changeProvenance`). Saved Changes shows neither name nor date; an
        // earlier draft of this line said it did.
        const admin = getAdminName();
        box.appendChild(para(admin
            ? `Each one is saved again under your name, so in the Calendar a day changed by hand will say “Last saved by ${admin}”.`
            : 'Each one is saved again under your name, so in the Calendar a day changed by hand will name you as the last to save it.',
            'auth-desc legacy-records-note'));
        if (planState === 'writing') { box.appendChild(para('Converting…', 'auth-desc legacy-records-note')); return; }
        box.appendChild(button(`Convert ${p.convert.length}${p.remove.length ? ` and remove ${p.remove.length}` : ''}`, 'btn-action btn-primary', () => convert()));
    }

    /** Read every override on the old records' days, and plan. */
    async function readPlan() {
        const all = await withClaimRetry(() => reader.fetchByDates((days || []).map(d => d.date)));
        return planLegacyConversion(all, { adminName: getAdminName() || '' });
    }

    async function loadPlan() {
        planState = 'loading'; result = null;
        render();
        try { plan = await readPlan(); planState = 'shown'; }
        catch (e) { console.error('[OldFormat] plan', e); plan = null; planState = 'failed'; }
        render();
    }

    async function convert() {
        const shown = plan;
        if (!shown) return;
        planState = 'writing';
        render();
        /** @type {LegacyPlan} */ let fresh;
        try { fresh = await readPlan(); }
        catch (e) {
            console.error('[OldFormat] recheck', e);
            result = { text: 'Couldn’t check the records again — nothing was changed. Check your connection and try again.', failed: true };
            planState = 'shown'; render(); return;
        }
        if (planSignature(fresh) !== planSignature(shown)) { plan = fresh; planState = 'stale'; render(); return; }
        const removing = shown.remove.length ? ` and remove ${shown.remove.length} that a newer change has already replaced` : '';
        const ok = confirmDialog ? await confirmDialog({
            title: 'Convert the old-format records?',
            message: `This rewrites ${shown.convert.length} in today’s format${removing}. It can’t be undone from the app.`,
            confirmLabel: 'Convert', danger: shown.remove.length > 0,
        }) : true;
        if (!ok) { planState = 'shown'; render(); return; }
        try {
            const done = await writeWithClaimRetry(() => reader.apply(shown));
            result = { text: `Done: ${done.converted} converted${done.removed ? `, ${done.removed} removed` : ''}.`, failed: false };
        } catch (e) {
            console.error('[OldFormat] convert', e);
            result = { text: 'Couldn’t convert them — nothing was changed. Check your connection and try again.', failed: true };
            planState = 'shown'; render(); return;
        }
        // Start again from the server's counts, which now describe what is left.
        plan = null; planState = 'idle'; years = 'idle'; days = null; counts = null;
        content.setAttribute('aria-busy', 'true');
        loadCounts();
    }

    async function loadYears() {
        if (!counts) return;
        const { total } = summariseLegacy(counts);
        if (!total || total > YEARS_CAP) { years = 'skipped'; render(); return; }
        years = 'loading';
        render();
        try {
            days = await withClaimRetry(() => reader.fetchDays());
            years = 'loaded';
        } catch (e) {
            console.error('[OldFormat] years', e);
            years = 'failed';
        }
        render();
    }

    async function loadCounts() {
        try {
            await sessionReady;
            const got = await withClaimRetry(() => reader.countByType());
            summariseLegacy(got);   // throws on a count it cannot believe — BEFORE it is kept
            counts = got;
            render();
            if (opened && years === 'idle') loadYears();
        } catch (e) {
            console.error('[OldFormat]', e);
            counts = null;
            if (chip) chip.textContent = '';
            _cardLoadError(content, 'Couldn’t count the old-format records — check your connection.', () => loadCounts());
        } finally {
            content.removeAttribute('aria-busy');
        }
    }

    loadCounts();
    return {
        onToggle(open) {
            if (!open) return;
            opened = true;
            if (counts && years === 'idle') loadYears();
        },
    };
}
