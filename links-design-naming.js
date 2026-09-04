// @ts-check
/**
 * links-design-naming.js — what a design or a staffing setup may be CALLED.
 *
 * Extracted at v22.66 (external review) because the coordinator sat exactly on its ratchet cap and
 * the cap's own comment says where the next Links rule goes. It is a real invariant with one owner,
 * not a size-driven split: four naming flows — new, import, duplicate, rename — plus the saved
 * setups each had to reach the same answer, and only the length half was ever shared.
 *
 * THE RULE THE REVIEW ASKED FOR. Two designs called "Option A" are perfectly distinct to Firestore,
 * which keys on a document id, and indistinguishable to a person, who is offered a NAME in a
 * dropdown. That gap was tolerable while the picker only loaded; it stopped being tolerable once the
 * same list started driving Compare, Delete and shared staffing setups — all three act on the row
 * you point at, and pointing is done by reading. The failure is quiet and it is somebody else's
 * work: you compare against, or delete, the wrong "Option A".
 *
 * IT REFUSES RATHER THAN DISAMBIGUATING SILENTLY. Auto-renaming the second one to "Option A copy"
 * without saying so would leave a designer certain they had saved "Option A" and unable to find it.
 * `proposeCopyName` exists for the ONE flow where a new name is the point rather than a surprise —
 * Duplicate, which already pre-fills a suggestion the designer sees and can edit.
 *
 * CASE- AND SPACE-INSENSITIVE, because the collision is what a reader's eye makes of two rows, not
 * what a byte comparison makes of two strings: "Option A", "option a" and "Option  A" are one name
 * in a dropdown. Comparison folds internal whitespace for the same reason.
 *
 * Pure — no DOM, no Firebase — so both the designs and the setups can use it and it is testable in
 * Node. Tested by links-design-naming.test.mjs.
 */

/** The Firestore rule (v17.02) rejects a `name` longer than this; the client caps it so an
 *  over-long name is a message rather than a silent `catch { console.error }`. */
export const MAX_DESIGN_NAME = 100;

/**
 * The form a name is COMPARED in. Never stored — what the designer typed is what is saved.
 * @param {string|null|undefined} name
 */
export function nameKey(name) {
    return String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The existing entry this name would be confused with, or null.
 *
 * `exceptId` is load-bearing on RENAME: an entry never collides with itself, or correcting the
 * capitalisation of your own design would refuse.
 *
 * @param {string} name
 * @param {Array<{id?: string, name?: string}>} existing
 * @param {string|null} [exceptId]
 * @returns {{id?: string, name?: string}|null}
 */
export function nameConflict(name, existing = [], exceptId = null) {
    const key = nameKey(name);
    if (!key) return null;
    return existing.find(e => e && e.id !== exceptId && nameKey(e.name) === key) || null;
}

/**
 * Decide a typed name, for every flow. One answer, so the four prompts cannot drift.
 *
 * Returns `{ ok }` plus the MESSAGE to show — the caller owns where it appears (the designs use the
 * save-status line, the import card its own status), which is the only part that differs.
 *
 * @param {string} name
 * @param {{ existing?: Array<{id?: string, name?: string}>, exceptId?: string|null, noun?: string }} [ctx]
 * @returns {{ ok: boolean, reason?: 'empty'|'too-long'|'duplicate', message?: string }}
 */
export function checkName(name, ctx = {}) {
    const { existing = [], exceptId = null, noun = 'design' } = ctx;
    const trimmed = String(name ?? '').trim();
    if (!trimmed) return { ok: false, reason: 'empty', message: `Give the ${noun} a name first.` };
    if (trimmed.length > MAX_DESIGN_NAME) {
        return { ok: false, reason: 'too-long',
                 message: `That name is too long (max ${MAX_DESIGN_NAME} characters). Please shorten it.` };
    }
    const clash = nameConflict(trimmed, existing, exceptId);
    if (clash) {
        // Names the EXISTING one back, because "already used" on its own invites the designer to
        // assume they mis-clicked. Quoting it is what makes the refusal checkable against the list.
        return { ok: false, reason: 'duplicate',
                 message: `There is already a ${noun} called “${clash.name}”. Pick a different name — two with the same name cannot be told apart in the list.` };
    }
    return { ok: true };
}

/**
 * A free name for a copy: "X copy", then "X copy 2", "X copy 3"…
 *
 * Starts unnumbered because that is what a person writes, and only numbers once it has to. Bounded,
 * and returns the last candidate if every one is taken — the caller still runs `checkName`, so an
 * exhausted search surfaces as an ordinary refusal rather than a loop.
 *
 * @param {string} base @param {Array<{id?: string, name?: string}>} existing
 */
export function proposeCopyName(base, existing = []) {
    const stem = String(base ?? '').trim() || 'Design';
    let candidate = `${stem} copy`;
    for (let n = 2; n <= 99 && nameConflict(candidate, existing); n++) candidate = `${stem} copy ${n}`;
    return candidate.slice(0, MAX_DESIGN_NAME);
}
