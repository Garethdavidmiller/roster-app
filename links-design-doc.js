// @ts-check
/**
 * links-design-doc.js — the SHAPE of a link design, in memory and in Firestore, and every
 * conversion between the two (extracted from links-app.js, v19.94).
 *
 * ── WHY ────────────────────────────────────────────────────────────────────────────────────────
 *
 * Eleven sites in the coordinator hand-assembled a design object, in four different shapes, and two
 * of them (the save transaction and its offline fallback) were near-identical copies of the same
 * write payload. Nothing checked that they agreed, and the way they fail is silent: a field left
 * out of one site is not an error, it is a design that quietly loses something.
 *
 * That has happened. v19.55: the bin kept `patterns` but not `window`, so a restore handed back a
 * design wearing the app default — and the next save wrote that default straight over the moved
 * boundary the design had actually been built to. The proposal still looked fine; it was simply no
 * longer the proposal.
 *
 * The extraction found a second, older instance immediately, in the one path nobody looks at — the
 * one-time `combined-28` legacy migration. See `LEGACY_DOC_ID` below.
 *
 * ── THE THREE RULES ────────────────────────────────────────────────────────────────────────────
 *
 * 1. **Every shape carries `window`.** It is not optional metadata; it is what the coverage heat map
 *    measures gaps against, so a design that loses it is assessed against a span nobody chose.
 *
 * 2. **Everything arriving FROM Firestore is normalised; nothing already in memory is re-normalised.**
 *    That asymmetry is deliberate and is why this is a design job rather than a sweep. Canonicalising
 *    on the way in means exactly one time format exists in memory — a legacy unpadded `"6:00-14:00"`
 *    classified as a worked early (so it counted in the day totals) while `startMinutes` returned
 *    null, making it invisible in the heat map and exempt from every turnaround check. In-memory
 *    values have already been through that gate.
 *
 * 3. **The live working copy DEEP COPIES its patterns.** The grid mutates it cell by cell; sharing
 *    the row objects with the `designs[]` entry would mean the concurrency baseline is compared
 *    against data that has already changed underneath it.
 */

import { normalisePatterns } from './links-design.js';
import { normaliseWindow } from './links-window.js';

/**
 * The pre-multi-design singleton (v12.46), migrated to a named design on first load and thereafter
 * ignored. Named here because the migration is where this module's second defect lived.
 *
 * **It was the ONLY read path that skipped `normalisePatterns`** — both into memory and into the new
 * Firestore document, so the un-canonicalised times were persisted permanently. Of every document in
 * the collection this is the one guaranteed to be legacy: it predates multi-design, so it is the
 * likeliest to hold the unpadded times `canonicaliseShift` exists for. It also wrote no `window`.
 *
 * Neither was reachable for a workspace that already has named designs (the migration is gated on
 * `named.length === 0`), which is exactly why it survived — it runs once, for one document, on a
 * visit nobody is watching.
 */
export const LEGACY_DOC_ID = 'combined-28';

/** A design row read from Firestore, normalised for use in memory.
 * @typedef {{id: string, name: string, patterns: Record<string, any>, window: any,
 *            updatedAt: any, updatedBy: string, revision: number|null}} DesignEntry */

/** A design in the Recently-deleted bin.
 * @typedef {{id: string, name: string, patterns: Record<string, any>, window: any,
 *            deletedAt: any, deletedBy: string}} BinEntry */

/**
 * Deep-copy a patterns map — one fresh row object per line.
 *
 * A shallow copy is not enough: the grid writes `patterns[pos][day]`, so sharing the ROW objects
 * still lets an edit reach through into whatever the copy was made from.
 * @param {Record<string, any>|null|undefined} patterns
 * @returns {Record<string, any>}
 */
export function deepCopyPatterns(patterns) {
    /** @type {Record<string, any>} */
    const copy = {};
    for (const [k, v] of Object.entries(patterns || {})) copy[k] = { ...(/** @type {any} */ (v)) };
    return copy;
}

/**
 * A LIVE design read from a Firestore document.
 * @param {string} id
 * @param {Record<string, any>} data
 * @returns {DesignEntry}
 */
export function designFromDoc(id, data) {
    return {
        id,
        name:      String(data?.name ?? '').trim(),
        patterns:  normalisePatterns(data?.patterns || {}),
        window:    normaliseWindow(data?.window),
        updatedAt: data?.updatedAt ?? null,
        updatedBy: data?.updatedBy || '',
        // The CONCURRENCY IDENTITY (v22.18), carried through so the coordinator can arm its
        // baseline from a load without a second read. Absent on every design nobody has saved since
        // — `conflictOf` falls back to the timestamp for those, and `null` is what says so.
        revision:  typeof data?.revision === 'number' ? data.revision : null,
    };
}

/**
 * A DELETED design read from a Firestore document.
 *
 * `deletedAt` is passed through as-is, INCLUDING the null a `serverTimestamp()` reads back as on the
 * device that just wrote it. `links-deletion.js` depends on that distinction: an unresolved
 * `deletedAt` counts as deleted (so the design leaves the picker immediately) but never as
 * purgeable (an age you cannot read is not an age that has expired). Coercing it here would collapse
 * the two.
 * @param {string} id
 * @param {Record<string, any>} data
 * @returns {BinEntry}
 */
export function binEntryFromDoc(id, data) {
    return {
        id,
        name:      String(data?.name ?? '').trim(),
        patterns:  normalisePatterns(data?.patterns || {}),
        window:    normaliseWindow(data?.window),
        deletedAt: data?.deletedAt ?? null,
        deletedBy: data?.deletedBy || '',
    };
}

/**
 * The Firestore write body for a design.
 *
 * `updatedAt` is the CALLER's (a `serverTimestamp()` sentinel, or a preserved value on the legacy
 * migration) because this module must not import the Firebase SDK — it is the one thing that would
 * stop it loading in Node, which is the whole point of extracting it.
 *
 * `firestore.rules` allows exactly `['name','patterns','updatedAt','updatedBy']` plus the optional
 * deleted pair, and `window` — so nothing else may be added here without the rules moving first, or
 * every save permission-denies.
 * @param {{name?: string, patterns?: Record<string, any>, window?: any}} design
 * @param {{updatedBy: string, updatedAt: any}} meta
 */
export function docPayload(design, { updatedBy, updatedAt }) {
    return {
        name:      design?.name || 'Design 1',
        patterns:  design?.patterns || {},
        window:    normaliseWindow(design?.window),
        updatedAt,
        updatedBy,
    };
}

/**
 * The live, editable copy of a design — what the grid renders and mutates.
 *
 * Carries no `updatedAt`/`updatedBy`: those describe the SAVED document, and holding them on the
 * working copy is how a sheet ends up printing somebody else's "Last saved by" over your unsaved
 * edits. The coordinator reads them from the `designs[]` entry instead.
 * @param {{id: string, name?: string, patterns?: Record<string, any>, window?: any, revision?: number|null}} entry
 */
export function workingCopy(entry) {
    return {
        id:       entry.id,
        name:     entry.name ?? '',
        patterns: deepCopyPatterns(entry.patterns),
        window:   normaliseWindow(entry.window),
    };
}

/**
 * Move a live entry into the bin. Patterns are carried, not dropped: a restore is then a
 * field-clearing merge and can never re-upload a stale copy of the design.
 * @param {{id: string, name?: string, patterns?: Record<string, any>, window?: any, revision?: number|null}} entry
 * @param {string} deletedBy
 * @returns {BinEntry}
 */
export function binEntryFrom(entry, deletedBy) {
    return {
        id:        entry.id,
        name:      entry.name ?? '',
        patterns:  entry.patterns || {},
        window:    normaliseWindow(entry.window),
        deletedAt: null,
        deletedBy,
    };
}

/**
 * Move a binned entry back to the live list. THIS is the v19.55 path — the window has to come with
 * it, or the next save writes the app default over the boundary the design was built to.
 * @param {BinEntry|{id: string, name?: string, patterns?: Record<string, any>, window?: any, revision?: number|null}} entry
 * @param {{updatedAt: any, updatedBy: string, revision?: number|null}} meta
 * @returns {DesignEntry}
 */
export function restoredEntryFrom(entry, { updatedAt, updatedBy, revision = null }) {
    return {
        id:        entry.id,
        name:      entry.name ?? '',
        patterns:  entry.patterns || {},
        window:    normaliseWindow(entry.window),
        updatedAt: updatedAt ?? null,
        updatedBy,
        // A restore is a WRITE, so the caller passes the revision it committed. Defaulting to null
        // rather than carrying the bin entry's old one is deliberate: the design has just been
        // written, and claiming the pre-deletion revision would be a baseline for a version that no
        // longer exists (v22.18).
        revision,
    };
}

/**
 * "Last saved by …" for the sticky save row (v21.08).
 *
 * It used to print the TIME alone — "Last saved by G. Miller at 15:06" — which is right for the
 * common case and quietly wrong for the one that matters: a design last touched three days ago says
 * "at 15:06" and reads as today. The line exists so you can tell a design you have just been
 * working on from one you opened out of the list, and without a date it cannot. The print header
 * has always carried the full date; this is the same fact, on screen.
 *
 * TODAY is stated as a time, because that is what "today" means to somebody reading it — adding
 * today's date to every save would be noise on every save. Anything older gains the day and month,
 * and a different year gains the year, since a design proposed for December 2026 may well be read
 * the following spring.
 *
 * @param {string|null|undefined} updatedBy
 * @param {Date|null|undefined} when   the save time, or null if unknown
 * @param {Date} [now]                 injected so the today/not-today boundary is testable
 * @returns {string} the label, or '' when there is nothing to say
 */
export function lastSavedLabel(updatedBy, when, now = new Date()) {
    if (!updatedBy) return '';
    if (!when || Number.isNaN(when.getTime())) return `Last saved by ${updatedBy}`;
    const sameDay = when.getFullYear() === now.getFullYear()
        && when.getMonth() === now.getMonth()
        && when.getDate() === now.getDate();
    const time = when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return `Last saved by ${updatedBy} at ${time}`;
    const opts = when.getFullYear() === now.getFullYear()
        ? { day: 'numeric', month: 'short' }
        : { day: 'numeric', month: 'short', year: 'numeric' };
    return `Last saved by ${updatedBy} · ${when.toLocaleDateString('en-GB', /** @type {any} */ (opts))} at ${time}`;
}
