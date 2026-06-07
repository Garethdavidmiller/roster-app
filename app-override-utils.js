// Override priority, member-start, and shift-classification helpers.
// Shared by app.js, app-team-view.js, and the admin modules.

/**
 * Returns true if the shift is a non-working rest day (RD or OFF).
 * @param {string} shift
 * @returns {boolean}
 */
export function isRestShift(shift) {
    return shift === 'RD' || shift === 'OFF';
}

/**
 * Converts a Firestore Timestamp or plain {seconds} object to milliseconds.
 * Returns 0 for null/undefined or unrecognised shapes.
 * @param {object|null} ts
 * @returns {number}
 */
export function tsToMillis(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    return 0;
}

/**
 * Returns true if `date` falls before the member's contracted start date.
 * Overrides should be suppressed before a member's start date — getBaseShift
 * already returns 'RD' for those dates; allowing an override would undo that.
 * Returns false if the member has no startDate.
 * @param {object} member
 * @param {Date}   date
 * @returns {boolean}
 */
export function isBeforeMemberStart(member, date) {
    if (!member.startDate) return false;
    const s = member.startDate;
    return date < new Date(s.getFullYear(), s.getMonth(), s.getDate());
}

/**
 * Returns true if `incoming` should replace `existing` in the override cache.
 *
 * Priority rules (highest first):
 *   1. Manual overrides (source !== 'roster_import') always beat roster_import.
 *   2. Among entries of equal source-class, the newer createdAt wins.
 *
 * This ensures a human-entered correction survives a roster re-upload, and
 * that if two imports exist for the same date the most recent one is used.
 *
 * @param {object|undefined} existing
 * @param {object}           incoming
 * @returns {boolean}
 */
export function shouldReplaceOverride(existing, incoming) {
    if (!existing) return true;
    const existingIsImport = (existing.source || '') === 'roster_import';
    const incomingIsImport = (incoming.source || '') === 'roster_import';
    if (existingIsImport && !incomingIsImport) return true;   // manual beats import
    if (!existingIsImport && incomingIsImport) return false;  // import can't beat manual
    return tsToMillis(incoming.createdAt) >= tsToMillis(existing.createdAt);
}
