// @ts-check
/**
 * calendar-snapshot.js — the member's OWN roster, kept on this device so the Calendar can show it
 * the moment it opens, while the sign-in check is still running (v24.59, owner decision Oct 2026).
 *
 * Owns: the stored copy (one member, a few months of their own leave, absences and shift changes),
 *   every rule about when it may be READ, and its deletion.
 * Does NOT own: when to paint it or how (calendar-app.js), the access decision (calendar-access.js),
 *   or the live override cache (calendar-overrides.js) — which this module never writes to.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────────────────────────
 *
 * Every Calendar open waits on the network round trip Firebase makes to confirm a stored sign-in
 * (`accounts:lookup`), and the roster is withheld until it answers (CALENDAR_DATA.md 3, 10). The
 * Firestore cache cannot help: its reads queue behind that same round trip, which is why the
 * provisional paint retired on 26 Sep 2026 fired on about one open in eight hundred. DECISIONS.md
 * named the only shape that can beat it — an APP-OWNED copy, read from plain storage, not through
 * Firestore — and the owner approved it: "The roster is not private information. It is available
 * to the whole business."
 *
 * ── THE RULES IT KEEPS (each one is a reason to refuse a read) ──────────────────────────────────
 *
 *   ONE MEMBER, AND ONLY THEIR OWN ROWS. Written only from a confirmed named grant, for the member
 *     signed in, from records naming that member. A read for anybody else returns nothing and
 *     deletes the copy — a different member signing in on a shared device ends it.
 *   NEVER A SOURCE OF TRUTH. It is painted LABELLED ("Checking for changes…") and handed over the
 *     moment the live read settles. It is never written into `rosterOverridesCache` and never marks
 *     a month known (`noteKnowledge`), so nothing that decides access or counts leave can see it.
 *   IT DIES WITH THE SESSION. `clearSession()` deletes it (every sign-out goes through there), and
 *     so does a failed or refused grant, a PIN unlock, and a member mismatch.
 *   IT AGES OUT. A month older than MAX_AGE_MS is dropped on read; an empty copy is deleted.
 *   IT IS BOUNDED. Only months near today are kept (MONTHS_BEFORE / MONTHS_AFTER), so it cannot grow
 *     into a history of somebody's leave.
 *
 * Everything here is synchronous and storage-only on purpose: the paint it feeds has to happen
 * before the first await of the access decision, or it is not instant.
 */

import { lsGet, lsSet, lsDel } from './ls.js';
import { CALENDAR_SNAPSHOT } from './storage-keys.js';

/** Bumped when the stored shape changes; an older copy is discarded, never migrated. */
export const SNAPSHOT_VERSION = 1;
/** How long a stored month may be shown for. Owner decision: 14 days. */
export const MAX_AGE_MS = 14 * 86_400_000;
/** The window kept around today, in months. */
export const MONTHS_BEFORE = 1;
export const MONTHS_AFTER  = 3;
/** A month whose content has not changed is still re-stamped after this long, so it does not age out
 *  while the member keeps opening the app. */
const RESTAMP_AFTER_MS = 86_400_000;

/**
 * @typedef {{ type: string, value: string, source?: string, changedBy?: string }} SnapshotRecord
 * @typedef {{ savedAt: number, days: Record<string, SnapshotRecord> }} SnapshotMonth
 * @typedef {{ v: number, member: string, months: Record<string, SnapshotMonth> }} Snapshot
 */

/** `YYYY-MM` for a year and 0-indexed month — the same key `calendar-overrides.js` uses. */
function monthKeyOf(/** @type {number} */ year, /** @type {number} */ month) {
    return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/** Whether a `YYYY-MM` key lies inside the kept window around `now`. */
export function inWindow(/** @type {string} */ key, /** @type {number} */ now) {
    const d = new Date(now);
    const here = d.getFullYear() * 12 + d.getMonth();
    const [y, m] = key.split('-').map(Number);
    const there = y * 12 + (m - 1);
    return Number.isFinite(there) && there >= here - MONTHS_BEFORE && there <= here + MONTHS_AFTER;
}

/** The fields of a cache record a paint needs, and no more. @param {any} r @returns {SnapshotRecord} */
function trim(r) {
    /** @type {SnapshotRecord} */
    const out = { type: String(r.type), value: String(r.value) };
    if (r.source) out.source = String(r.source);
    if (r.changedBy) out.changedBy = String(r.changedBy);
    return out;
}

/** The stored copy, parsed, or null. Never throws. @returns {Snapshot|null} */
function load() {
    try {
        const raw = lsGet(CALENDAR_SNAPSHOT);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (!s || s.v !== SNAPSHOT_VERSION || typeof s.member !== 'string' || !s.months || typeof s.months !== 'object') return null;
        return s;
    } catch { return null; }
}

/** Delete the stored copy. Every route that ends a member's hold on this device calls this. */
export function clearSnapshot() { lsDel(CALENDAR_SNAPSHOT); }

/**
 * The stored copy for THIS member, with aged and out-of-window months dropped — or null, in which
 * case nothing may be painted. A copy for anybody else is deleted, not merely ignored.
 * @param {string} memberName @param {number} [now]
 * @returns {Snapshot|null}
 */
export function readSnapshot(memberName, now = Date.now()) {
    const s = load();
    if (!s) { if (lsGet(CALENDAR_SNAPSHOT)) clearSnapshot(); return null; }   // unreadable: gone
    if (!memberName || s.member !== memberName) { clearSnapshot(); return null; }
    /** @type {Record<string, SnapshotMonth>} */
    const months = {};
    for (const [key, m] of Object.entries(s.months)) {
        if (m && typeof m.savedAt === 'number' && now - m.savedAt <= MAX_AGE_MS && now >= m.savedAt - 60_000
            && inWindow(key, now) && m.days && typeof m.days === 'object') months[key] = m;
    }
    if (!Object.keys(months).length) { clearSnapshot(); return null; }
    return { v: s.v, member: s.member, months };
}

/**
 * One month of a member's stored copy, as the renderer reads overrides: a Map of `YYYY-MM-DD` to
 * record. Null when that month is not held.
 * @param {string} memberName @param {number} year @param {number} month 0-indexed @param {number} [now]
 * @returns {Map<string, SnapshotRecord>|null}
 */
export function snapshotMonth(memberName, year, month, now = Date.now()) {
    const s = readSnapshot(memberName, now);
    const m = s?.months[monthKeyOf(year, month)];
    return m ? new Map(Object.entries(m.days)) : null;
}

/**
 * Store the months the live read has just SETTLED for this member. Called only from a confirmed
 * named grant on the member's own calendar. `months` maps `YYYY-MM` to that member's winning records
 * for the month (an empty array is a real answer: a month with nothing changed). Months outside the
 * window are ignored; the write is skipped when nothing would change, so it can run on every render.
 * @param {string} memberName
 * @param {Record<string, any[]>} months
 * @param {number} [now]
 */
export function saveSnapshotMonths(memberName, months, now = Date.now()) {
    if (!memberName) return;
    const prior = load();
    /** @type {Snapshot} */
    const next = { v: SNAPSHOT_VERSION, member: memberName, months: {} };
    if (prior && prior.member === memberName) {
        for (const [key, m] of Object.entries(prior.months)) if (inWindow(key, now)) next.months[key] = m;
    }
    let changed = !prior || prior.member !== memberName;
    for (const [key, records] of Object.entries(months)) {
        if (!inWindow(key, now)) continue;
        /** @type {Record<string, SnapshotRecord>} */
        const days = {};
        for (const r of records) if (r && r.memberName === memberName && typeof r.date === 'string') days[r.date] = trim(r);
        const old = next.months[key];
        const same = old && JSON.stringify(old.days) === JSON.stringify(days);
        if (same && now - old.savedAt < RESTAMP_AFTER_MS) continue;
        next.months[key] = { savedAt: now, days };
        changed = true;
    }
    // Nothing left in the window: no copy at all, rather than an empty one.
    if (!Object.keys(next.months).length) { if (prior) clearSnapshot(); return; }
    if (prior && Object.keys(prior.months).length !== Object.keys(next.months).length) changed = true;
    if (changed) lsSet(CALENDAR_SNAPSHOT, JSON.stringify(next));
}
