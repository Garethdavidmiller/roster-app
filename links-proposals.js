// @ts-check
/**
 * links-proposals.js — the SHORTLISTED 26-line designs, built into the Links workspace (v24.47).
 *
 * ── WHAT THESE ARE ─────────────────────────────────────────────────────────────────────────────
 *
 * The designs shortlisted for the new link (from 1 January 2027) — Balanced V6, Level Crossing and
 * Middle Ground, since 8 Nov 2026 (v25.52) — copied cell for cell from each design's `.json` in
 * `docs/links-26/30-days-off/` (Balanced V6's in its `balanced/` subfolder). The shortlist was Second
 * Edition, Even Keel and Short Run on 3 Oct 2026; Closing Time joined it on 30 Oct (v25.01) and the
 * same day it was cut to two, In Step and Short Run (v25.02); Even Step, In Step's weeks with nothing
 * over 8h 30m Monday to Saturday, joined on 31 Oct as the recommendation (v25.04). On 5 Nov Common
 * Ground, which keeps seven of today's shift times and today's leave, took In Step's place, and the
 * same day the recommendation went (owner: "Remove the marks"): the three are listed A to Z, as the pack
 * lists them (`docs/links-26/tooling/fresh.mjs` → SHORTLIST) and as the New link page shows them — which
 * still sorts them itself, so neither list can quietly decide the other's order. On 8 Nov 2026 the
 * shortlist was drawn again for a new design target, no two closing weeks side by side (owner: "Put
 * Level Crossing, Middle Ground and Balanced V6 as the shortlist for now"): each of the three keeps
 * closing weeks apart and today's leave, where Common Ground, Even Step and Short Run each put closing
 * weeks together. The designs that left it are still in the pack and can still be imported — they are
 * just no longer built in.
 * The printed sheet names each one "<name> (<ref>)" — `ref` is the design code and the fingerprint
 * of its grid. They are held apart here because the name is a TITLE, and a title carrying a hash
 * truncated to "Even Keel — Dec 2026 (EK-..." on a phone (it was on the shortlist then); the ref
 * is shown beside it instead (the picker row, the masthead's who line, the printout), so a grid on
 * screen can still be matched to the paper in somebody's hand.
 *
 * ── WHY BUILT IN, AND NOT SAVED DESIGNS ────────────────────────────────────────────────────────
 *
 * Owner decision (3 Oct 2026): read-only proposals in the picker, not documents in `linkDesigns`.
 * A saved design can be edited, renamed, deleted and overwritten by any designer — which is right
 * for work in progress and wrong for the designs everything else is measured against. Built
 * in, they cannot be changed or binned by accident, there is no first-open write that two designers
 * could race into duplicates, and every designer sees the same shortlist. Opening one gives a WORKING
 * COPY that has never been saved: edit it freely, and the first save asks for a name and creates a
 * new design — the proposal itself is untouched.
 *
 * ── THE ONE RULE ───────────────────────────────────────────────────────────────────────────────
 *
 * **A proposal id never reaches Firestore.** Ids carry the `proposal:` prefix, and the coordinator
 * opens a proposal with NO saved-design id, so every write path (save, rename, delete) already
 * treats it as unsaved. `links-proposals.test.mjs` pins that each design is 26 lines, meets the
 * hard limits, and matches its fingerprinted source.
 *
 * If the shortlist changes, re-copy from the pack (the grids are the `patterns` of each `.json`, in
 * `docs/links-26/proposals/`, `docs/links-26/30-days-off/` or its `balanced/` subfolder), keep the printed
 * name, and the test will say whether the copy is faithful.
 */

/** @typedef {{ id: string, code: string, name: string, ref: string, patterns: Record<string, Record<string, string>> }} Proposal */

const DAYS = /** @type {const} */ (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);

/** Rows of [sun, mon, tue, wed, thu, fri, sat] → `{ "1": { sun, … }, … }`. @param {string[][]} rows */
function grid(rows) {
    /** @type {Record<string, Record<string, string>>} */ const p = {};
    rows.forEach((r, i) => { p[String(i + 1)] = Object.fromEntries(DAYS.map((d, j) => [d, r[j]])); });
    return p;
}

/** The id prefix every built-in proposal carries. */
export const PROPOSAL_PREFIX = 'proposal:';

/** @type {ReadonlyArray<Readonly<Proposal>>} */
export const PROPOSALS = Object.freeze([
    Object.freeze({
        id: PROPOSAL_PREFIX + 'MB-26-V6', code: 'MB-26-V6',
        name: "Balanced V6 — Dec 2026", ref: "MB-26-V6 · 1818a1c2",
        patterns: grid([
            ["SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE"],
            ["RD", "15:45-23:55", "RD", "15:45-23:55", "15:45-23:55", "RD", "RD"],
            ["RD", "RD", "06:20-14:20", "RD", "07:30-16:00", "07:30-16:00", "08:00-16:30"],
            ["07:15-15:45", "07:30-16:00", "RD", "06:20-14:20", "06:20-14:20", "RD", "RD"],
            ["RD", "RD", "15:45-23:55", "15:45-23:55", "RD", "14:00-22:30", "14:30-22:30"],
            ["SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE"],
            ["15:15-23:25", "15:45-23:55", "15:45-23:55", "15:45-23:55", "15:45-23:55", "RD", "RD"],
            ["RD", "12:00-20:30", "12:00-20:30", "12:00-20:30", "RD", "RD", "06:20-15:00"],
            ["07:15-15:45", "06:20-13:35", "RD", "06:20-13:45", "06:20-14:20", "06:20-13:35", "06:20-14:50"],
            ["RD", "RD", "13:30-22:00", "14:00-22:30", "14:00-22:30", "15:45-23:55", "15:00-23:55"],
            ["SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE"],
            ["RD", "06:20-14:20", "07:30-16:00", "07:30-16:00", "07:30-16:00", "06:20-14:20", "RD"],
            ["RD", "07:30-16:00", "07:30-16:00", "07:30-16:00", "RD", "RD", "06:20-14:50"],
            ["07:15-15:45", "06:20-13:45", "RD", "RD", "12:00-20:30", "14:00-22:30", "14:30-22:30"],
            ["14:30-22:30", "13:30-22:00", "RD", "13:30-22:00", "13:30-22:00", "13:30-22:00", "15:00-23:55"],
            ["SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE"],
            ["15:15-23:25", "15:45-23:55", "15:45-23:55", "RD", "15:45-23:55", "15:45-23:55", "RD"],
            ["RD", "14:00-22:30", "14:00-22:30", "RD", "RD", "06:20-13:45", "06:20-14:50"],
            ["RD", "RD", "13:30-22:00", "13:30-22:00", "13:30-22:00", "13:30-22:00", "14:00-22:30"],
            ["RD", "RD", "06:20-13:35", "07:30-16:00", "07:30-16:00", "07:30-16:00", "06:20-14:50"],
            ["SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE"],
            ["07:15-15:45", "07:30-16:00", "07:30-16:00", "RD", "RD", "07:30-16:00", "08:00-16:30"],
            ["09:00-18:00", "RD", "06:20-13:45", "06:20-14:20", "06:20-13:35", "06:20-14:20", "RD"],
            ["RD", "06:20-14:20", "06:20-14:20", "06:20-13:35", "06:20-13:45", "RD", "RD"],
            ["14:30-22:30", "13:30-22:00", "14:00-22:30", "RD", "RD", "12:00-20:30", "14:00-22:30"],
            ["15:15-23:25", "14:00-22:30", "RD", "14:00-22:30", "14:00-22:30", "15:45-23:55", "15:15-23:55"],
        ]),
    }),
    Object.freeze({
        id: PROPOSAL_PREFIX + 'LC-26-T10', code: 'LC-26-T10',
        name: "Level Crossing — Dec 2026", ref: "LC-26-T10 · 32241e32",
        patterns: grid([
            ["SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE"],
            ["15:15-23:25", "RD", "RD", "14:00-22:30", "14:00-22:30", "14:00-22:30", "15:15-23:55"],
            ["14:30-22:30", "RD", "15:45-23:55", "15:45-23:55", "15:45-23:55", "15:45-23:55", "RD"],
            ["RD", "06:20-14:50", "07:30-16:00", "07:30-16:00", "06:20-13:45", "06:20-13:45", "RD"],
            ["RD", "06:20-13:45", "06:20-13:45", "06:20-13:45", "RD", "RD", "07:15-15:45"],
            ["SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE"],
            ["14:30-22:30", "14:00-22:30", "RD", "RD", "RD", "14:00-22:30", "15:15-23:55"],
            ["15:15-23:25", "14:00-22:30", "14:00-22:30", "RD", "RD", "11:00-19:30", "RD"],
            ["RD", "15:45-23:55", "15:45-23:55", "15:45-23:55", "15:45-23:55", "15:45-23:55", "RD"],
            ["RD", "14:00-22:30", "14:00-22:30", "14:00-22:30", "14:00-22:30", "RD", "14:30-22:30"],
            ["SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE"],
            ["07:15-15:45", "06:20-14:20", "RD", "RD", "06:20-14:20", "06:20-14:20", "06:20-14:50"],
            ["RD", "RD", "07:30-16:00", "07:30-16:00", "06:20-13:45", "06:20-13:45", "06:20-14:50"],
            ["RD", "RD", "06:20-14:50", "06:20-14:50", "06:20-14:50", "06:20-14:50", "RD"],
            ["RD", "11:00-19:30", "11:00-19:30", "11:00-19:30", "11:00-19:30", "RD", "14:00-22:30"],
            ["SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE"],
            ["15:15-23:25", "15:45-23:55", "RD", "RD", "15:45-23:55", "15:45-23:55", "15:15-23:55"],
            ["RD", "RD", "14:00-22:30", "14:00-22:30", "14:00-22:30", "14:00-22:30", "14:30-22:30"],
            ["RD", "14:00-22:30", "14:00-22:30", "14:00-22:30", "14:00-22:30", "14:00-22:30", "RD"],
            ["RD", "15:45-23:55", "15:45-23:55", "15:45-23:55", "RD", "RD", "14:00-22:30"],
            ["SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE"],
            ["07:15-15:45", "07:30-16:00", "RD", "RD", "07:30-16:00", "07:30-16:00", "06:20-14:45"],
            ["07:15-15:45", "07:30-16:00", "RD", "RD", "07:30-16:00", "07:30-16:00", "07:15-15:45"],
            ["09:00-18:00", "RD", "06:20-14:20", "06:20-14:20", "06:20-14:20", "06:20-14:20", "RD"],
            ["RD", "06:20-14:20", "06:20-14:20", "06:20-14:20", "RD", "RD", "06:20-14:45"],
            ["07:15-15:45", "06:20-13:45", "06:20-13:45", "06:20-13:45", "RD", "RD", "07:15-15:45"],
        ]),
    }),
    Object.freeze({
        id: PROPOSAL_PREFIX + 'MG-26-T8', code: 'MG-26-T8',
        name: "Middle Ground — Dec 2026", ref: "MG-26-T8 · 20668ac9",
        patterns: grid([
            ["SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE"],
            ["07:15-15:30", "07:00-15:30", "RD", "RD", "07:00-15:30", "07:00-15:30", "08:00-16:30"],
            ["RD", "11:00-19:30", "11:00-19:30", "11:00-19:30", "11:00-19:30", "11:00-19:30", "RD"],
            ["RD", "15:45-23:55", "15:45-23:55", "15:45-23:55", "RD", "RD", "14:00-22:30"],
            ["14:30-22:30", "14:00-22:30", "RD", "RD", "RD", "14:00-22:30", "13:30-22:00"],
            ["SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE"],
            ["09:00-17:30", "RD", "07:00-15:30", "07:00-15:30", "07:00-15:30", "RD", "RD"],
            ["RD", "07:00-15:30", "06:20-14:20", "06:20-14:20", "06:20-14:20", "06:20-14:20", "RD"],
            ["RD", "07:00-15:30", "07:00-15:30", "07:00-15:30", "RD", "RD", "06:20-14:50"],
            ["07:15-15:30", "06:20-14:20", "06:20-14:20", "06:20-14:20", "RD", "RD", "07:00-15:30"],
            ["SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE"],
            ["07:15-15:30", "06:20-14:20", "RD", "RD", "06:20-14:20", "06:20-14:20", "06:20-14:20"],
            ["RD", "RD", "14:00-22:30", "14:00-22:30", "14:00-22:30", "14:00-22:30", "RD"],
            ["RD", "15:45-23:55", "15:45-23:55", "15:45-23:55", "15:45-23:55", "15:45-23:55", "RD"],
            ["RD", "14:00-22:30", "14:00-22:30", "14:00-22:30", "14:00-22:30", "RD", "15:45-23:55"],
            ["SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE"],
            ["07:15-15:30", "06:20-13:45", "RD", "RD", "06:20-13:45", "06:20-13:45", "06:20-14:50"],
            ["RD", "RD", "06:20-13:45", "07:00-15:30", "07:00-15:30", "07:00-15:30", "06:20-13:45"],
            ["RD", "RD", "06:20-14:20", "06:20-14:20", "06:20-14:20", "06:20-14:20", "RD"],
            ["RD", "06:20-14:20", "07:00-15:30", "06:20-13:45", "RD", "07:00-15:30", "08:00-16:30"],
            ["SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE", "SPARE"],
            ["14:30-22:30", "15:45-23:55", "RD", "RD", "15:45-23:55", "15:45-23:55", "15:45-23:55"],
            ["15:15-23:25", "RD", "RD", "14:00-22:30", "14:00-22:30", "14:00-22:30", "14:30-22:30"],
            ["15:15-23:25", "RD", "15:45-23:55", "15:45-23:55", "15:45-23:55", "15:45-23:55", "RD"],
            ["RD", "14:00-22:30", "14:00-22:30", "14:00-22:30", "14:00-22:30", "RD", "14:30-22:30"],
            ["15:15-23:25", "14:00-22:30", "14:00-22:30", "RD", "RD", "14:00-22:30", "15:45-23:55"],
        ]),
    }),
].map(p => /** @type {Readonly<Proposal>} */ (p)));

/** Is this id a built-in proposal's? @param {unknown} id */
export function isProposalId(id) {
    return typeof id === 'string' && id.startsWith(PROPOSAL_PREFIX);
}

/** The proposal with this id, or null. @param {unknown} id */
export function proposalById(id) {
    return PROPOSALS.find(p => p.id === id) ?? null;
}

/**
 * The name the first save of a proposal's working copy suggests: the design's own name, without the
 * date and never the ref, plus "— copy", numbered if taken. A copy is a new design, and
 * carrying the fingerprint over would label an edited grid with the fingerprint of one it no longer
 * matches.
 * @param {Readonly<Proposal>} proposal
 * @param {Array<{ name?: string }>} existing
 */
export function proposalCopyName(proposal, existing = []) {
    const base = proposal.name.split(' — ')[0].trim() + ' — copy';
    const taken = new Set(existing.map(d => String(d.name || '').trim().toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; n < 1000; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
    return base;
}
