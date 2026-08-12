// @ts-check
/**
 * links-target-sets.js — the SAVED SETS of generator targets, and who may overwrite each one.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
 *
 * Owner, Aug 2026: "I want others to be able to mess about but not lose my shift times set."
 *
 * Until v21.04 the generator's target table had exactly one memory — the per-design working copy
 * in localStorage — which is per-DEVICE and per-DESIGN: invisible to the other designers, and
 * overwritten by whoever edits next. Neither half of the ask survives that. So named sets live in
 * a shared Firestore collection (`linkTargetSets`), like the designs themselves, and carry ONE
 * rule the server enforces: anyone may save a NEW set; only the person who created a set — or the
 * admin — may overwrite or delete it. A colleague opening your set gets a working copy to change
 * freely; the moment they want to keep their version, they save it AS THEIR OWN set. Your set is
 * not merely "please don't" protected — `firestore.rules` refuses the write.
 *
 * ── WHERE EACH PIECE OF THE RULE LIVES ─────────────────────────────────────────────────────────
 *
 * `canOverwriteTargetSet` here is the CLIENT's copy of the ownership rule, and it exists for the
 * button, not for the security: it decides whether "Save changes" is offered at all, because a
 * button that permission-denies after a tap is a worse answer than one that says up front whose
 * set this is. The rule the app actually RELIES on is the same statement in `firestore.rules`
 * (creator or admin; `createdBy` immutable on update, pinned to the writer's own `name` claim on
 * create so ownership cannot be forged or transferred). If the two ever drift, the server wins
 * and the button merely lies about what will happen — which is why the rules test asserts the
 * server side of every case this module's test asserts client-side.
 *
 * ── `targetSetFromDoc` IS A TRUST BOUNDARY, like `validateBackup` and `parseDesignImport` ──────
 *
 * A set is a document three designers can write, arriving over the network into the table the
 * generator builds from. A corrupt one must become a REFUSAL (null — the picker skips it), never
 * a half-set: a set that loads with three rows missing looks like a lighter week, and every panel
 * downstream then reports confidently about it. The checks mirror what the generator itself
 * refuses (`bad-target` / `bad-time`), so nothing this function accepts can wedge the card.
 *
 * Pure — no DOM, no Firebase. The caller injects the timestamp (`serverTimestamp()`), the same
 * seam `links-design-doc.js` uses, so this stays loadable in Node and testable without mocks.
 */

/** The longest a set name may be — matches the design-name bound in `firestore.rules`. */
export const MAX_SET_NAME = 60;

/** The most rows a set may carry — far above any real table (the default runs ~31). */
export const MAX_SET_SLOTS = 60;

/** A shift-time string the generator can read: "HH:MM-HH:MM". Shape only — ranges are its job. */
const TIME_RE = /^\d{2}:\d{2}-\d{2}:\d{2}$/;

/** A usable headcount: a non-negative integer (the generator refuses anything else as bad-target). */
const okCount = (/** @type {any} */ n) => Number.isInteger(n) && n >= 0;

/**
 * A saved set read from a Firestore document — or null, never a half-set.
 *
 * @param {string} id
 * @param {any} data
 * @returns {{ id: string, name: string, slots: Array<{time: string, weekday: number, sat: number, sun: number}>,
 *            spareLines: number, createdBy: string, updatedBy: string, updatedAt: any }|null}
 */
export function targetSetFromDoc(id, data) {
    if (!data || typeof data !== 'object') return null;
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name || name.length > MAX_SET_NAME) return null;
    // `createdBy` is the ownership key — a set without one cannot be protected, so it cannot be
    // a set. (The rules make it unwritable-without, so this refuses only hand-made corruption.)
    if (typeof data.createdBy !== 'string' || !data.createdBy) return null;
    if (!Array.isArray(data.slots) || data.slots.length === 0 || data.slots.length > MAX_SET_SLOTS) return null;
    if (!Number.isInteger(data.spareLines) || data.spareLines < 0) return null;
    const slots = [];
    for (const s of data.slots) {
        if (!s || typeof s.time !== 'string' || !TIME_RE.test(s.time)) return null;
        if (!okCount(s.weekday) || !okCount(s.sat) || !okCount(s.sun)) return null;
        slots.push({ time: s.time, weekday: s.weekday, sat: s.sat, sun: s.sun });
    }
    return {
        id, name, slots,
        spareLines: data.spareLines,
        createdBy:  data.createdBy,
        updatedBy:  typeof data.updatedBy === 'string' ? data.updatedBy : data.createdBy,
        updatedAt:  data.updatedAt ?? null,
    };
}

/**
 * The document payload for saving a set — fresh copies throughout, so the caller's working table
 * and the saved snapshot cannot end up sharing objects (the generator edits its table in place).
 *
 * `createdBy` is included on CREATE and must be the writer's own name — the rules refuse anything
 * else. On OVERWRITE the caller passes the existing set's `createdBy` unchanged, because the rules
 * also refuse an update that moves it (ownership is not transferable by editing).
 *
 * @param {{ name: string, slots: Array<{time: string, weekday: number, sat: number, sun: number}>, spareLines: number }} table
 * @param {string} createdBy  the owner this document records
 * @param {string} updatedBy  whoever is writing now
 * @param {any} now           serverTimestamp() from the caller — injected so this stays pure
 */
export function targetSetPayload(table, createdBy, updatedBy, now) {
    return {
        name: String(table.name).trim().slice(0, MAX_SET_NAME),
        slots: table.slots.map(s => ({ time: s.time, weekday: s.weekday, sat: s.sat, sun: s.sun })),
        spareLines: table.spareLines,
        createdBy,
        updatedBy,
        updatedAt: now,
    };
}

/**
 * May this user overwrite (or delete) this set? The creator, or the admin — nobody else.
 *
 * The client half of the server rule; see the module header for which one the app relies on.
 *
 * @param {{ createdBy: string }} set
 * @param {string|null|undefined} userName
 * @param {boolean} [isAdmin]
 */
export function canOverwriteTargetSet(set, userName, isAdmin = false) {
    if (isAdmin === true) return true;
    return !!userName && set.createdBy === userName;
}

/**
 * What the sets row should SAY and OFFER about the currently-picked set (v21.08).
 *
 * Extracted rather than written inline because every defect this feature has had was a wrong
 * SENTENCE, not wrong data: v21.06 printed "yours to change. Others can load it but not overwrite
 * it" to the admin, over a set somebody else owned — false on both halves, and the second half
 * inverted. A string built inside a 2,800-line coordinator has no seam to test through; this one is
 * pinned case-by-case in `links-target-sets.test.mjs`.
 *
 * It answers TWO independent questions and joins them, which is why the old two-branch version kept
 * going wrong — it had been collapsing them into one:
 *
 *   · WHOSE is it — ownership, which decides what the buttons may offer. Being ALLOWED to overwrite
 *     (the admin) is not the same as OWNING, and the sentence must not claim the second from the
 *     first.
 *   · WHERE IS THE TABLE relative to it — not loaded, loaded and matching, or loaded and since
 *     changed. Nothing said this before, so "Save changes" was a leap of faith: you could not tell
 *     whether the table on screen was the set, or your own work about to overwrite it.
 *
 * @param {{ name: string, createdBy: string }|null} set   the picked set, or null for none
 * @param {{ userName?: string|null, isAdmin?: boolean, isLoaded?: boolean, changed?: boolean }} ctx
 * @returns {{ owned: boolean, canWrite: boolean, canDelete: boolean, text: string }}
 */
export function describeSetState(set, ctx = {}) {
    const { userName = null, isAdmin = false, isLoaded = false, changed = false } = ctx;
    if (!set) {
        return {
            owned: false, canWrite: false, canDelete: false,
            text: 'Save the table above as a named set to share it between designers.',
        };
    }
    const owned    = !!userName && set.createdBy === userName;
    const canWrite = canOverwriteTargetSet(set, userName, isAdmin);
    // Deleting and overwriting are the same rule in `firestore.rules` — creator or admin — so they
    // are deliberately the same answer here. Kept as its own field because they are different
    // BUTTONS, and a future rule that separated them should not need the call sites to change.
    const canDelete = canWrite;

    // Short sentences, and no dash inside a clause: the name is already joined to the rest with one,
    // and a second inside the ownership clause made the line read as a list of fragments.
    const whose = owned
        ? 'yours to change.'
        : canWrite
            ? `saved by ${set.createdBy}. You can overwrite it as the admin.`
            : `saved by ${set.createdBy}. Only they can overwrite it.`;

    const where = !isLoaded
        ? 'Press Load to use these shift times.'
        : !changed
            ? 'Loaded — the table above still matches it.'
            : canWrite
                ? 'You have changed the table since loading it — Save changes updates the set, Save as new keeps both.'
                : 'You have changed the table since loading it — Save as new keeps your version, theirs untouched.';

    return { owned, canWrite, canDelete, text: `${set.name} — ${whose} ${where}` };
}

/**
 * Picker order: name, case-insensitively, ties by id so the order is total and stable.
 * @param {Array<{name: string, id: string}>} sets
 */
export function sortTargetSets(sets) {
    return [...sets].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id));
}
