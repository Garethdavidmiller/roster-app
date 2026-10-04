// @ts-check
/**
 * override-id.js — the ONE document id a manual override for a member on a date is written to (v24.48).
 *
 * ── WHY ────────────────────────────────────────────────────────────────────────────────────────
 *
 * Every manual write used to mint a random id, after deleting the id it had LOADED. Two editors who
 * loaded the same day both deleted the same old document — Firestore accepts deleting what is gone —
 * and each created its own new one, so two records survived for one member and date (external review,
 * Oct 2026, reproduced). The display picks the newest and hides the other, until the newest is removed
 * and the older resurfaces; and anything that COUNTS — leave taken, booked, the entitlement a manager
 * books against — counts both.
 *
 * A fixed id makes that impossible rather than unlikely: Firestore holds one document per id, so two
 * saves of one day land on the SAME document and the later one wins — exactly what two saves made one
 * after the other already did. It is server-enforced identity with no rules change and no read.
 *
 * ── WHAT IT DELIBERATELY DOES NOT COVER ────────────────────────────────────────────────────────
 *
 * Roster IMPORTS keep random ids: a manual record and an import for the same day coexist by design
 * (the manual one wins, `shouldReplaceOverride` in override-utils.js), so they must never share one.
 * And the second editor is not WARNED — see KNOWN_LIMITATIONS.md → "Two editors on one day".
 *
 * Its own module, and not override-utils.js, because that file sits at the 900-line line past which
 * a module must be argued into the size ratchet; one pure function is not that argument.
 */

/**
 * `encodeURIComponent` because it is injective — two names can never meet on one id — and never
 * emits `/`, the one character a Firestore id cannot hold.
 * @param {string} memberName @param {string} date YYYY-MM-DD @returns {string}
 */
export function manualOverrideId(memberName, date) {
    return `m_${date}_${encodeURIComponent(memberName)}`;
}
