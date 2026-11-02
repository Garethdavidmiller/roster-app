// @ts-check
/**
 * links-shortlist.js — making the SHORTLIST the saved designs (v25.09, owner, 2 Nov 2026).
 *
 * ── WHAT THE OWNER ASKED FOR ───────────────────────────────────────────────────────────────────
 *
 * "Put the new shortlist proposals as the saved options in the links designer. Remove the older
 * ones." Until now Even Step, In Step and Short Run were BUILT IN (`links-proposals.js`): read-only
 * rows at the top of the picker that open as an unsaved working copy, the owner's decision of 3 Oct
 * 2026. The saved designs underneath them were older — earlier proposals and the work that led to
 * them. This module turns the shortlist into ordinary saved designs that any designer can open,
 * change and save in place, and moves every older design to Recently deleted.
 *
 * ── WHY ONE DELIBERATE PRESS, AND NOT A MOVE ON PAGE OPEN ──────────────────────────────────────
 *
 * The 24-line designs went to the bin on page open (`isPre26Design`, 3 Oct), and that precedent
 * was looked at first. It does not carry over, for three reasons:
 *
 *  1. "Older" here means EVERY saved design, whoever saved it — not a shape a rule can recognise.
 *     Automatically, it would be decided by a date, on the first device to open the page, and the
 *     bin would name that person as having deleted three people's work.
 *  2. Nobody but the owner can see which designs that is. One press, behind a dialog that LISTS
 *     them by name and by who last saved each, shows the person who asked for it exactly what will
 *     move before anything does.
 *  3. A move on open would act on every page load that meets an old design — the whole Links test
 *     suite included, which seeds old designs to test everything else.
 *
 * So the ··· More sheet offers "Make the shortlist the saved designs" to the ADMIN, once: from the
 * moment the shortlist is saved (live or in the bin) the row is gone. Nothing is destroyed — the
 * older designs keep their patterns in the bin, and anyone can restore one.
 *
 * ── THE TWO RULES ──────────────────────────────────────────────────────────────────────────────
 *
 * **A saved shortlist design has a FIXED id** (`shortlist-<code>`). Two presses — two devices, or a
 * press whose answer was lost — therefore cannot make two Even Steps: the store's transaction finds
 * the id taken and writes nothing (`links-design-store.js`, `saveShortlist`).
 *
 * **Once any saved shortlist design exists, the built-in rows go.** Otherwise the picker would list
 * every one twice. A binned one does not bring its built-in row back — a designer who deleted Short
 * Run would otherwise see it return at the top of the list. The built-ins stay the SOURCE: the
 * patterns are copied from `PROPOSALS`, cell for cell, and `links-proposals.test.mjs` still pins
 * those to the printed sheets.
 *
 * Pure — no DOM, no Firebase.
 */

import { PROPOSALS } from './links-proposals.js';

/** The id prefix of a saved shortlist design. A proposal's is `proposal:`; this one reaches Firestore. */
export const SHORTLIST_ID_PREFIX = 'shortlist-';

/** The most designs the confirm dialog names one by one; the rest are counted. */
export const LISTED_IN_DIALOG = 12;

/**
 * The Firestore id a shortlisted design is saved under — fixed, so it can only be created once.
 * @param {{ code: string }} proposal
 */
export function shortlistDocId(proposal) {
    return SHORTLIST_ID_PREFIX + proposal.code;
}

/** Is this the saved copy of a shortlisted design? @param {unknown} id */
export function isShortlistDocId(id) {
    return typeof id === 'string' && id.startsWith(SHORTLIST_ID_PREFIX);
}

/**
 * Has the shortlist been saved in this collection — live or in the bin?
 * @param {Array<{id: string}>} designs  the live designs
 * @param {Array<{id: string}>} bin      Recently deleted
 */
export function shortlistSaved(designs, bin) {
    return [...designs, ...bin].some(d => isShortlistDocId(d?.id));
}

/**
 * The built-in proposals the picker, compare and the empty state may still offer: all of them
 * until the shortlist is saved, and none after — the saved designs replace them.
 * @template T
 * @param {Array<{id: string}>} designs @param {Array<{id: string}>} bin @param {T[]} builtIns
 * @returns {T[]}
 */
export function builtInProposals(designs, bin, builtIns) {
    return shortlistSaved(designs, bin) ? [] : builtIns;
}

/**
 * Is "Make the shortlist the saved designs" offered? To the admin, once the list has loaded, until
 * the shortlist is saved. A failed load is not "nothing saved": it is not knowing.
 * @param {{ isAdmin: boolean, loadFailed: boolean, designs: Array<{id: string}>, bin: Array<{id: string}> }} o
 */
export function canSaveShortlist({ isAdmin, loadFailed, designs, bin }) {
    return isAdmin && !loadFailed && !shortlistSaved(designs, bin);
}

/**
 * @typedef {{ id: string, name: string, patterns: Record<string, Record<string, string>> }} ShortlistSeed
 * @typedef {{ id: string, name: string, updatedBy: string }} RetiredDesign
 */

/**
 * What one press does: the shortlisted designs to save, and every older design to move to the bin.
 * Empty once the shortlist is saved, so a second press can do nothing.
 * @param {Array<{id: string, name?: string, updatedBy?: string}>} designs  the live designs
 * @param {Array<{id: string}>} bin
 * @param {ReadonlyArray<{ code: string, name: string, patterns: Record<string, Record<string, string>> }>} [proposals]
 * @returns {{ seed: ShortlistSeed[], retire: RetiredDesign[] }}
 */
export function planShortlistSave(designs, bin, proposals = PROPOSALS) {
    if (shortlistSaved(designs, bin)) return { seed: [], retire: [] };
    return {
        seed: proposals.map(p => ({ id: shortlistDocId(p), name: p.name, patterns: p.patterns })),
        retire: designs.map(d => ({ id: d.id, name: (d.name || '').trim() || 'Untitled design', updatedBy: d.updatedBy || '' })),
    };
}

/** "Even Step, In Step and Short Run" — names without the "— Dec 2026" tail. @param {ShortlistSeed[]} seed */
export function shortlistNames(seed) {
    const short = seed.map(s => s.name.replace(/\s+—\s+.*$/u, ''));
    return short.length <= 1 ? short.join('') : `${short.slice(0, -1).join(', ')} and ${short[short.length - 1]}`;
}

/**
 * The confirm dialog's message — what will be saved, every design that will move and who last saved
 * it, and the unsaved work that would be lost. `confirmDialog` keeps the line breaks.
 * @param {{ seed: ShortlistSeed[], retire: RetiredDesign[] }} plan
 * @param {{ currentUser: string, dirty: boolean }} o
 */
export function shortlistSaveMessage(plan, { currentUser, dirty }) {
    const parts = [`${shortlistNames(plan.seed)} become saved designs. Any designer can open, change and save them. The printed sheets are not changed.`];
    const n = plan.retire.length;
    if (n) {
        const who = (/** @type {RetiredDesign} */ d) => d.updatedBy === currentUser ? 'you' : d.updatedBy || 'nobody named';
        const rows = plan.retire.slice(0, LISTED_IN_DIALOG).map(d => `• ${d.name} (last saved by ${who(d)})`);
        if (n > LISTED_IN_DIALOG) rows.push(`• and ${n - LISTED_IN_DIALOG} more`);
        parts.push(`${n === 1 ? 'This design moves' : `These ${n} designs move`} to Recently deleted, where anyone can restore ${n === 1 ? 'it' : 'them'}:\n${rows.join('\n')}`);
    } else {
        parts.push('There are no other saved designs, so nothing moves to Recently deleted.');
    }
    if (dirty) parts.push('Your unsaved changes to the open design will be lost.');
    return parts.join('\n\n');
}

/**
 * The status line once it has landed. `moved` is what the transaction actually moved — a design a
 * colleague deleted in the meantime is not counted twice.
 * @param {ShortlistSeed[]} seed @param {number} moved
 */
export function shortlistSavedLine(seed, moved) {
    const saved = `${shortlistNames(seed)} are saved designs now.`;
    if (!moved) return saved;
    return `${saved} ${moved === 1 ? 'The older design is' : `The ${moved} older designs are`} in Recently deleted — restore from there if you still need ${moved === 1 ? 'it' : 'one'}.`;
}
