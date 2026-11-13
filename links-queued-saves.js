// @ts-check
/**
 * links-queued-saves.js — the Links saves only THIS BROWSER's queue holds, until the server answers
 * (links-design-store.js rule 6; v26.03).
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────────────────────────
 *
 * Offline, a save is queued and the page says "Saved in this browser". In a SECOND tab Firestore's
 * queue lives in memory — the IndexedDB lease is the first tab's — so a save queued there died with
 * the page, which had already called itself saved and kept no copy: an afternoon's grid, gone with a
 * closed tab. So until the server answers, the copy that save WROTE is kept as the unsaved-work draft
 * (unsaved-draft.js). This module decides which copy, on which baseline, and whether an answer still
 * counts; `links-app.js` owns what the page shows. Pure: no DOM, no Firebase, no storage.
 *
 * ── THE RULES ───────────────────────────────────────────────────────────────────────────────────
 *
 *   1. ONE ENTRY PER DESIGN: its latest queued save. A save's number (`next`) names it, so the answer
 *      to an earlier save never clears a later one. A new design, a copy or an import has no number:
 *      its answer counts only while no save of that design is waiting.
 *   2. THE EARLIEST BASELINE. A second queued save of a design came after a first the server may never
 *      get, so the last state the server is KNOWN to hold is the one from before both — what a kept copy
 *      is restored onto, so a colleague's save since still asks.
 *   3. A CONFIRMED SAVE ANSWERS FOR EVERY EARLIER ONE. An online save commits only after this device's
 *      queue has drained (store rule 5), so it forgets the design's entry outright.
 *   4. A REFUSED SAVE STAYS, marked `failed`. The copy is still the work, and the server does not have it.
 *   5. ONE DRAFT SLOT. With nothing unsaved on screen, the NEWEST unconfirmed save is the one kept;
 *      unsaved edits on screen win the slot over all of them (links-app.js keeps those).
 *   6. A KEPT COPY ITS DESIGN NOW HOLDS EXACTLY IS NOT UNSAVED WORK (unsaved-draft.js rule 6) — a queued
 *      save that has since landed, from this tab's queue or the first tab's, which outlives a page.
 *      Compared as the page compares: canonical patterns and window.
 *
 * Tested by links-queued-saves.test.mjs; end to end in e2e/links.spec.js ("A SAVE ONLY THIS BROWSER
 * HOLDS IS KEPT UNTIL THE SERVER HAS IT").
 */

import { normalisePatterns } from './links-design.js';
import { normaliseWindow } from './links-window.js';

/**
 * @typedef {{ loadedRevision: number|null, loadedUpdatedAt: number|null, baselineUnknown: boolean }} Baseline
 * @typedef {{ seq: number, written: { patterns: any, window: any }, baseline: Baseline, failed?: boolean }} QueuedSave
 */

/** The queued saves of one page life. */
export function createQueuedSaves() {
    /** @type {Map<string, QueuedSave>} */
    const saves = new Map();
    let last = 0;
    return {
        /** The number of the save about to start (rule 1). */
        next: () => ++last,
        /**
         * A save was QUEUED: keep what it wrote, on the earliest baseline still unconfirmed (rule 2).
         * @param {string} id @param {number} seq @param {{ patterns: any, window: any }} written
         * @param {Baseline} before  the baseline its edits were made against
         */
        queued(id, seq, written, before) {
            saves.set(id, { seq, written, baseline: saves.get(id)?.baseline ?? before });
        },
        /** A save of this design was CONFIRMED online (rule 3). @param {string} id */
        confirmed(id) { saves.delete(id); },
        /**
         * Does this answer still count — is it for the design's latest save (rule 1)?
         * @param {string} id @param {number} [seq]  none for a new design, a copy or an import
         */
        counts(id, seq) {
            const waiting = saves.get(id);
            return seq === undefined ? !waiting : waiting?.seq === seq;
        },
        /** The server has the design's latest save. @param {string} id */
        acked(id) { saves.delete(id); },
        /** The server REFUSED it: kept, and marked (rule 4). @param {string} id @returns {QueuedSave|null} */
        refused(id) {
            const waiting = saves.get(id) ?? null;
            if (waiting) waiting.failed = true;
            return waiting;
        },
        /** @param {string|null} id @returns {QueuedSave|null} */
        get: (id) => (id && saves.get(id)) || null,
        /** The newest unconfirmed save, which a clean page keeps (rule 5). @returns {{ id: string, save: QueuedSave }|null} */
        newest() {
            /** @type {{ id: string, save: QueuedSave }|null} */ let found = null;
            for (const [id, save] of saves) if (!found || save.seq > found.save.seq) found = { id, save };
            return found;
        },
    };
}

/**
 * What is still UNSAVED in a kept Links draft (rule 6): null when its design now holds exactly what
 * it holds, else the draft's data, whole. A draft whose design is not in the list is all unsaved.
 * @param {{ data: { patterns?: any, window?: any } }} kept
 * @param {{ patterns?: any, window?: any }|null|undefined} design  the design (or proposal) it was kept for
 * @returns {Record<string, any>|null}
 */
export function stillUnsaved(kept, design) {
    const key = (/** @type {any} */ x) => JSON.stringify([normalisePatterns(x?.patterns), normaliseWindow(x?.window)]);
    return design && key(design) === key(kept.data) ? null : kept.data;
}
