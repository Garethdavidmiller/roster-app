// @ts-check
/**
 * links-design-load.js — PURE: what a read of the design collection MEANS. Which designs are live,
 * which are in the bin, which old-length designs move there, whether a cached answer can be trusted,
 * whether the legacy grid migrates, the order the list is kept in, and which design opens.
 *
 * ── ONE RULE FOR EVERY READER ──────────────────────────────────────────────────────────────────
 *
 * Two reads of `linkDesigns` reach the page: the load that opens it (`loadDesigns` in links-app.js)
 * and the refresh that re-reads only the lists (`_refreshLists`, after a refused save, or a bin row a
 * colleague settled). Both split the documents here, so a design cannot be live to one reader and in
 * the bin to the other. They differ in one thing only — which old-length designs a read may SHOW in
 * the bin — and `binOldOnLoad` and `binOldOnRefresh` hold that difference side by side, each with its
 * reason. The same goes for the list's order: the load sorted inline while create, duplicate and
 * rename sorted through a second copy of the comparator, which is how an in-session create once sat
 * at the end of the list until a reload (v16.19). Every path now keeps `byDesignName`, and
 * links-design-load.test.mjs fails if the coordinator writes a comparator or a split of its own.
 *
 * The page keeps everything with a side effect: the read itself (it needs `metadata.fromCache`), the
 * migration's write, the background moves to the bin, and the state the answer becomes. Every
 * document → object mapping stays in links-design-doc.js, and what counts as deleted in
 * links-deletion.js; this module only decides which mapping each document gets.
 */

import { LEGACY_DOC_ID, designFromDoc, binEntryFromDoc, binEntryFrom, isPre26Design } from './links-design-doc.js';
import { isDeleted } from './links-deletion.js';

/**
 * A collection read → live designs, the bin, and the legacy singleton. A binned design keeps its
 * patterns, so a restore is a field-clearing merge (v19.41). A design drawn for the old link length
 * goes to the bin (owner, 3 Oct 2026; the rule is `isPre26Design`) when `binOld` says this read may
 * show it there: it is shown in the bin AT ONCE, filed as the reader's own move, and `toBin` lists it
 * for the move the page then makes in the background.
 * @param {Array<{ id: string, data: any }>} docs
 * @param {{ binOld: (id: string) => boolean, currentUser: string }} opts
 * @returns {{ named: any[], binned: any[], legacyData: any, toBin: string[] }}
 */
export function splitDesignDocs(docs, { binOld, currentUser }) {
    /** @type {any[]} */ const named = [], binned = [];
    /** @type {string[]} */ const toBin = [];
    let legacyData = null;
    for (const { id, data } of docs) {
        const hasName = typeof data.name === 'string' && data.name.trim();
        if (hasName && isDeleted(data)) binned.push(binEntryFromDoc(id, data));
        else if (hasName && isPre26Design(data) && binOld(id)) { binned.push(binEntryFrom(designFromDoc(id, data), currentUser)); toBin.push(id); }
        else if (hasName) named.push(designFromDoc(id, data));
        else if (id === LEGACY_DOC_ID && data.patterns) legacyData = data;
    }
    return { named, binned, legacyData, toBin };
}

/**
 * Which old-length designs the page LOAD may show in the bin: on a server answer, every one whose move
 * has not already failed this visit (the move follows); on a CACHED answer, none — a cached read moves
 * nothing, so it may claim nothing moved. A failed move left the design live on the server, so it is
 * shown live: in the bin, a Restore met a design never deleted and blamed a colleague (Oct 2026).
 * @param {boolean} fromCache
 * @param {ReadonlySet<string>} failed  moves that failed this visit
 * @returns {(id: string) => boolean}
 */
export const binOldOnLoad = (fromCache, failed) => (id) => !fromCache && !failed.has(id);

/**
 * …and the list REFRESH: only one whose move this page started and has not failed or been skipped. A
 * refresh starts no move, so it may claim none (whole-app fix, Nov 2026: after an offline load moved
 * nothing, a refresh showed the old designs in the bin, and restoring one said someone else had).
 * @param {ReadonlySet<string>} started
 * @returns {(id: string) => boolean}
 */
export const binOldOnRefresh = (started) => (id) => started.has(id);

/**
 * Whether a read cannot say what the collection holds. A CACHED answer (offline, or the server out of
 * reach) is whatever this device happened to keep, which can be nothing at all (links-app-5): with no
 * live design in it, it cannot tell "you have none" from "this device never read them", so the page
 * shows its failed state — never "No designs yet" and its create actions. A cached answer that holds
 * designs is shown: stale, but real.
 * @param {boolean} fromCache
 * @param {{ named: any[] }} split
 */
export const readCannotAnswer = (fromCache, { named }) => fromCache && named.length === 0;

/**
 * Whether the legacy `combined-28` grid migrates into a named design — once, and it has to STAY once
 * (Oct 2026 review). The gate was only "no live design", which the 26-line release made true again by
 * binning every pre-26 design: the legacy grid came back as "Design 1", was binned on the next load,
 * and returned again. A collection that has EVER held a design, live or binned, is past it. Only a
 * server answer gets this far — `readCannotAnswer` stops an empty cached one first — because the
 * migration needs the server's word that the collection is empty.
 * @param {{ named: any[], binned: any[], legacyData: any }} split
 */
export const migratesLegacy = ({ named, binned, legacyData }) => named.length === 0 && binned.length === 0 && !!legacyData;

/**
 * The list's one order: by name, as a reader sorts it. The picker and the compare chips read the list
 * in this order, and every path that adds to it keeps it.
 * @param {{ name: string }} a
 * @param {{ name: string }} b
 */
export const byDesignName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

/**
 * Which design the page opens: the one open last visit — a saved design or a built-in proposal — else
 * the first saved design. Nothing saved, and nothing remembered, opens NOTHING: the empty state offers
 * the shortlist rather than choosing for you (links-design.md → Line numbering, the built-in shortlist).
 * @template {{ id: string }} T
 * @param {T[]} designs    the saved designs, in list order
 * @param {T[]} proposals  the built-in shortlist
 * @param {string|null|undefined} rememberedId
 * @returns {T|null}
 */
export function designToOpen(designs, proposals, rememberedId) {
    return [...designs, ...proposals].find(x => x.id === rememberedId) || designs[0] || null;
}
