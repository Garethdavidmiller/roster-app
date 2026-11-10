// @ts-check
/**
 * links-design-header.js — the design MASTHEAD on links.html: which design is open, whose it is,
 * whether it is saved, and the one Save button (v23.30, owner request).
 *
 * WHY A MASTHEAD AND NOT A ROW OF PILLS. The picker was a strip of grey pills — one per design —
 * with ✎ and ✕ glyphs inside the active one, and five more buttons (New, Duplicate, Import,
 * Compare, Recently deleted) at the same visual weight beside them. Nothing on the card stated the
 * design's NAME as a title, who had saved it lived in fine print two screens down in the sticky save
 * row, and a design fresh from the generator was silently called "Design 1" and left unsaved. Three
 * designers found it unreadable; the owner's words were "really not user friendly or obvious".
 *
 * The masthead is the shape every document editor uses: the name as the heading, the owner beside
 * it, the saved state as a coloured dot, one primary Save, and everything else behind one "More"
 * control. It answers the three questions in the order a reader asks them — which, whose, saved? —
 * and it does so at the top of the card, where the eye lands.
 *
 * FOUR RULES AN EDIT CAN SILENTLY BREAK:
 *
 * 1. **The picker is a SHEET of buttons, and the `<select>` it replaced is the argument to read
 *    first (v23.35).** Until now this was a native select sitting invisibly over the heading, and
 *    the case for it was good: free grouping, free keyboard handling, real screen-reader semantics,
 *    one focus-trap fewer, and the one control every colleague already knows. This very rule said
 *    "do not replace it with a hand-rolled list."
 *
 *    It was wrong about the only thing that decides a control — what it looks like where it runs.
 *    A select's popup is drawn by the OS and no page CSS can reach it, so on Android it is a
 *    full-bleed Material radio list: the app's own design disappears at the exact moment a designer
 *    is choosing between designs, and a real name ("By the Book — Dec 2026 (BB-24-D7 · 0f14abce)")
 *    wraps to three lines of oversized type per row. Reported from a phone, which is the only place
 *    it is visible — the desktop select renders as a tidy grouped dropdown and hides the fault.
 *
 *    It is now a `createLightbox` dialog of plain `<button>` rows, the SAME construction as the
 *    ··· More sheet one button along, and it emits the SHARED `.picker-opt` classes that
 *    `select-sheet.js` uses for every other dropdown in the app, so there is one dropdown rather
 *    than several that resemble each other. Buttons in a modal dialog need no `role="listbox"`
 *    machinery to be operable: createLightbox already supplies Tab, Escape and the focus trap, and
 *    `aria-current` plus a tick marks the open design without relying on colour. What is given up
 *    is the OS picker's familiarity and its native type-ahead — and the face, being aria-hidden,
 *    needs an `aria-label` naming the open design, which the select announced for free.
 *
 *    ONE BUG CLASS WENT WITH IT. A `<select>` holds a value, so `change` moved it the instant the
 *    reader picked and a DECLINED switch left the picker naming a design nobody had opened — fixed
 *    at v23.33 by re-pointing the select on every render. The sheet holds no value at all: it
 *    reports an id and closes, and the face is rendered from `design`/`activeId`. The coordinator
 *    still re-renders on the decline path, which is right for its own reasons, but the desync it
 *    was patching can no longer happen here.
 *
 * 2. **Grouped by designer, your own designs first, newest first within a group.** `groupDesigns`
 *    is the one ordering; the face, the picker sheet and the More sheet read it. It groups by
 *    `updatedBy`, which is LAST SAVED BY, not creator — a design moves group when a colleague saves
 *    it. That is a known wobble and the owner chose to live with it rather than add a `createdBy`
 *    field (a rules change, backend-first). **The LABELS now say that** (v23.66, external review):
 *    they read "Last saved by you" / "Last saved by S. Silva", not "Your designs" / "S. Silva's
 *    designs", because the old wording claimed OWNERSHIP the grouping cannot support — your own
 *    design silently moved into a colleague's group the moment they saved it, and the heading then
 *    stated something untrue about who it belongs to rather than something true about who touched
 *    it last. The fix is the words, not the schema. If `createdBy` ever arrives, this is still the
 *    one function to change — and the labels would go back to ownership, because then they could. There is deliberately NO filter-by-designer step in front of the list: a two-step
 *    picker costs a tap on every switch and buys nothing below a few dozen designs.
 *
 * 3. **An unsaved design has no name until its FIRST SAVE.** The generator used to hand every new
 *    design the name "Design 1", so the first thing a designer saw was a thing they had not named,
 *    with no sign it was not on the server. Now the face reads "Untitled design", the status is the
 *    gold "Not saved yet", and the Save button reads "Save as…" — the coordinator's `saveChanges`
 *    asks for the name at that moment and pre-fills `proposeNewDesignName`, so a blank field never
 *    blocks anyone. `saveButtonLabel` owns the three labels; do not write them at the call sites.
 *
 * 4. **The picker list is rebuilt only when its CONTENT changes.** `render` runs on every dirty flip
 *    and `applyShift` fires once per cell during a paint drag, so an unconditional rebuild would
 *    tear down and re-create every row dozens of times a second — and would destroy the row under
 *    a reader's finger while the sheet is open. The signature compares ids, names, saved-dates and
 *    the active id — the same shape the brush bar uses for the same reason — and, for an open
 *    PROPOSAL only, whether it has been edited: its row is the one whose words follow `dirty`, and
 *    that flips once per edit session, not once per cell. The click handler is DELEGATED to the
 *    list for the same reason: a rebuild can then never orphan a listener.
 *
 * What it deliberately does NOT own: the decision to save, the conflict protocol, naming validation
 * (`links-design-naming.js`), compare mode, the bin. Every handle is injected; the module reaches for
 * no id of its own, so it loads in Node and `links-design-header.test.mjs` drives the copy rules and
 * the render against a fake DOM.
 */

import { avatarInitials, avatarHue } from './roster-data.js';
import { formatDayMonth, formatDayMonthYear, formatClock } from './date-format.js';
import { nameConflict } from './links-design-naming.js';

/**
 * @typedef {{ id: string, name: string, updatedAt?: any, savedAt?: any, updatedBy?: string, ref?: string }} DesignEntry
 * @typedef {{ label: string, own: boolean, designs: DesignEntry[] }} DesignGroup
 */

/** Firestore Timestamp, Date, epoch ms or nothing → Date or null. @param {any} v */
export function toDate(v) {
    if (!v) return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    if (typeof v.toDate === 'function') { const d = v.toDate(); return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null; }
    if (typeof v === 'number') return new Date(v);
    return null;
}

/**
 * WHEN A DESIGN WAS LAST SAVED, for display — the newer of the server's stamp and this device's
 * record of a save that came back without one (Sep 2026 polish; `recordSave` in
 * links-design-doc.js writes `savedAt` and says why it is a separate field). A queued save, or one
 * whose read-back failed, has no server stamp, and reading `updatedAt` alone left the pill on the
 * PREVIOUS save's time beside a save row stating the new one. Display only: the concurrency
 * baseline stays `updatedAt`, which is the one thing that must never hold a local clock value.
 * @param {{updatedAt?: any, savedAt?: any}|null|undefined} entry
 * @returns {Date|null}
 */
export function lastSaveTime(entry) {
    const server = toDate(entry?.updatedAt);
    const local  = toDate(entry?.savedAt);
    if (!server) return local;
    if (!local) return server;
    return local.getTime() > server.getTime() ? local : server;
}

/**
 * The group key for a design with no `updatedBy`. A control character, so it cannot collide with
 * any real trimmed name — and written as an ESCAPE, never as a literal.
 *
 * It was a literal NUL byte from v23.30 until v23.33, which worked (the value is identical) and
 * cost something invisible: a source file containing a NUL is BINARY to git, so this module landed
 * with `Bin 0 -> 17180 bytes` in its own diffstat and every later change to it would have shown as
 * no diff at all on a pull request. A module nobody can review a diff of is the one place a silent
 * change lives. Keep the escape.
 */
const NO_DESIGNER = '\u0000';

/**
 * Group designs for the picker: the current user's own first, then other designers alphabetically,
 * newest save first within each group (a name tie-break keeps the order stable when dates match).
 * A design with no `updatedBy` is grouped under "Last saver not recorded" rather than dropped — a document
 * the picker cannot show is a document nobody can open.
 *
 * @param {DesignEntry[]} designs
 * @param {string} currentUser
 * @returns {DesignGroup[]}
 */
export function groupDesigns(designs, currentUser) {
    /** @type {Map<string, DesignEntry[]>} */
    const by = new Map();
    for (const d of designs || []) {
        if (!d) continue;
        const key = (d.updatedBy || '').trim() || NO_DESIGNER;
        if (!by.has(key)) by.set(key, []);
        /** @type {DesignEntry[]} */ (by.get(key)).push(d);
    }
    const me = (currentUser || '').trim();
    const keys = [...by.keys()].sort((a, b) => {
        if (a === me) return -1;
        if (b === me) return 1;
        if (a === NO_DESIGNER) return 1;
        if (b === NO_DESIGNER) return -1;
        return a.localeCompare(b, 'en', { sensitivity: 'base' });
    });
    return keys.map(key => ({
        label: key === me ? 'Last saved by you'
             : key === NO_DESIGNER ? 'Last saver not recorded'
             : `Last saved by ${key}`,
        own: key === me,
        designs: /** @type {DesignEntry[]} */ (by.get(key)).slice().sort((x, y) => {
            const tx = toDate(x.updatedAt)?.getTime() ?? 0;
            const ty = toDate(y.updatedAt)?.getTime() ?? 0;
            if (ty !== tx) return ty - tx;
            return String(x.name || '').localeCompare(String(y.name || ''), 'en', { sensitivity: 'base' });
        }),
    }));
}

/**
 * The Save button's label. Three states, one place.
 * @param {{ saved: boolean, dirty: boolean, proposal?: boolean }} s  `saved` = the design has a Firestore
 *   document; `proposal` = the open design is a built-in proposal's working copy (links-proposals.js).
 */
export function saveButtonLabel({ saved, dirty, proposal = false }) {
    if (proposal) return 'Save a copy…';
    if (!saved) return 'Save as…';
    return dirty ? 'Save' : 'Saved';
}

/** @param {Date} when @param {Date} now */
function shortDate(when, now) {
    return when.getFullYear() === now.getFullYear() ? formatDayMonth(when) : formatDayMonthYear(when);
}
/** @param {Date} when @param {Date} now */
function sameDay(when, now) {
    return when.getFullYear() === now.getFullYear() && when.getMonth() === now.getMonth() && when.getDate() === now.getDate();
}

/**
 * The status pill's words and tone. `long` is the desktop sentence, `short` the phone one — the
 * phone row has room for a dot and two words beside the badge and two buttons.
 *
 * `queued` (links-app-4): the open design's last write is only in THIS BROWSER's queue — made offline,
 * or not answered by the server — so nobody else has it yet. It is neither a success nor a failure,
 * and its tone has no colour of its own: the pill's neutral base. Saying "Saved", or "Saved today at
 * 14:20" off this device's clock, would tell the designer a colleague can already see it.
 *
 * @param {{ saved: boolean, dirty: boolean, saving?: boolean, updatedAt?: any, now?: Date, proposal?: boolean, queued?: boolean }} s
 * @returns {{ tone: 'saved'|'dirty'|'new'|'saving'|'proposal'|'queued', long: string, short: string }}
 */
export function statusCopy({ saved, dirty, saving = false, updatedAt = null, now = new Date(), proposal = false, queued = false }) {
    if (saving) return { tone: 'saving', long: 'Saving…', short: 'Saving…' };
    // A built-in proposal, untouched (v24.47): it is not "not saved" — there is nothing of yours to
    // lose. Once edited it is an unsaved working copy, and says so like any other.
    if (proposal) return dirty ? { tone: 'dirty', long: 'Unsaved changes — save a copy to keep them', short: 'Unsaved' }
                               : { tone: 'proposal', long: 'Read-only', short: 'Read-only' };
    if (!saved)  return { tone: 'new', long: 'Not saved yet', short: 'Not saved' };
    if (dirty)   return { tone: 'dirty', long: 'Unsaved changes', short: 'Unsaved' };
    if (queued)  return { tone: 'queued', long: 'Saved in this browser', short: 'Saved here' };
    const when = toDate(updatedAt);
    if (!when) return { tone: 'saved', long: 'Saved', short: 'Saved' };
    const time = formatClock(when);   // the app's one 24-hour clock — the save row beside it uses it too
    if (sameDay(when, now)) return { tone: 'saved', long: `Saved today at ${time}`, short: `Saved ${time}` };
    const date = shortDate(when, now);
    return { tone: 'saved', long: `Saved ${date} at ${time}`, short: `Saved ${date}` };
}

/**
 * Who the badge names and what the line under the name says.
 * @param {{ saved: boolean, updatedBy?: string|null, currentUser: string }} s
 * @returns {{ name: string, role: string }}
 */
export function whoCopy({ saved, updatedBy, currentUser }) {
    if (!saved || !updatedBy) return { name: currentUser, role: 'Will be saved by you' };
    return { name: updatedBy, role: updatedBy === currentUser ? 'Last saved by you' : 'Last saved by' };
}

/**
 * The name pre-filled into the first-save prompt: `"G. Miller · 8 Sep"`, then `"… 2"`, `"… 3"` if
 * that is already taken. Honest rather than clever — it says who and when, which is what a
 * colleague scanning the list actually wants to know about a design nobody has named yet.
 *
 * @param {string} currentUser
 * @param {Array<{id?: string, name?: string}>} existing
 * @param {Date} [now]
 */
export function proposeNewDesignName(currentUser, existing = [], now = new Date()) {
    const base = `${(currentUser || 'Design').trim()} · ${formatDayMonth(now)}`;
    if (!nameConflict(base, existing)) return base;
    for (let n = 2; n < 1000; n++) {
        const candidate = `${base} ${n}`;
        if (!nameConflict(candidate, existing)) return candidate;
    }
    return base;
}

/**
 * @typedef {object} HeaderEls
 * @property {HTMLElement|null} pickList        the picker sheet's row container
 * @property {HTMLElement|null} pickerSub       the "N saved designs" line in its head
 * @property {HTMLButtonElement|null} pickerButton the masthead face that opens it
 * @property {HTMLElement|null} faceName
 * @property {HTMLElement|null} eyebrow
 * @property {HTMLElement|null} count
 * @property {HTMLElement|null} masthead
 * @property {HTMLElement|null} avatar
 * @property {HTMLElement|null} whoName
 * @property {HTMLElement|null} whoRole
 * @property {HTMLElement|null} status
 * @property {HTMLElement|null} statusLong
 * @property {HTMLElement|null} statusShort
 * @property {HTMLButtonElement[]} saveButtons   both Save buttons — masthead and sticky row
 * @property {HTMLButtonElement[]} renameButtons the pencil — these get a click listener AND the
 *   disabled state. A row already wired through `sheetActions` must NOT be listed here or it
 *   would fire twice; it goes in `renameMenuButton`/`deleteButton` for the disabled state alone.
 * @property {HTMLButtonElement|null} [renameMenuButton] the ··· sheet's Rename row — disable only
 * @property {HTMLButtonElement|null} deleteButton
 * @property {HTMLElement|null} sheetAvatar
 * @property {HTMLElement|null} sheetName
 * @property {HTMLElement|null} sheetSub
 */

/**
 * @typedef {object} HeaderState
 * @property {DesignEntry[]} designs
 * @property {string|null} activeId
 * @property {{ name?: string }|null} design   the working copy, or null when nothing is open
 * @property {boolean} dirty
 * @property {boolean} [saving]
 * @property {string} currentUser
 * @property {Date} [now]
 * @property {DesignEntry[]} [proposals]  built-in proposals (links-proposals.js), listed in their own group
 * @property {string|null} [proposalId]   the proposal whose working copy is open, while it has not been saved
 * @property {boolean} [queued]  the open design's last write is only in this browser's queue (`statusCopy`)
 */

/**
 * One row of the picker sheet. A plain `<button>`, so the sheet needs no listbox ARIA:
 * `aria-current` marks where you are and the tick shows it without relying on colour alone.
 * The classes are the SHARED `.picker-opt` set from shared.css, which `select-sheet.js` also
 * emits — one dropdown in the app, one definition of what its rows look like.
 * @param {{ id?: string, name: string, meta: string, current: boolean }} row
 */
function pickRow({ id, name, meta, current }) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = current ? 'picker-opt is-current' : 'picker-opt';
    if (id) b.dataset.id = id;
    if (current) b.setAttribute('aria-current', 'true');
    if (!id) b.disabled = true;          // the open-but-unsaved row has no id to select by
    const text = document.createElement('span');
    text.className = 'picker-opt-text';
    const n = document.createElement('span');
    n.className = 'picker-opt-name';
    n.textContent = (name || '').trim() || 'Untitled design';
    const m = document.createElement('small');
    m.textContent = meta;
    text.append(n, m);
    const tick = document.createElement('span');
    tick.className = 'picker-opt-tick';
    tick.setAttribute('aria-hidden', 'true');
    tick.textContent = current ? '✓' : '';
    b.append(text, tick);
    return b;
}

/**
 * Wire the masthead once and return its renderer. Every element is injected; a missing one is
 * skipped, so the module cannot throw on a page that lacks part of the markup.
 *
 * BOTH sheets are built here, from injected elements, and every action closes its sheet first and
 * runs once the close has landed — the pattern `#linksHowBtn` established for the About panel.
 * Stacking a dialog over an open sheet leaves the sheet behind a finished action, and acting in the
 * same tick as close() races the sheet's history.back() against the dialog's pushState. One action
 * per opening (`closeThen`); with no sheet injected at all there is no fade to wait out, so the
 * action runs at once.
 *
 * @typedef {{ overlay: HTMLElement|null, content: HTMLElement|null, closeBtn?: HTMLElement|null,
 *             initialFocus?: HTMLElement|null,
 *             create: (opts: any) => { open: () => void, close: () => void } }} SheetCfg
 *
 * @param {HeaderEls} els
 * @param {{ onSelect: (id: string) => void, onRename: () => void }} handlers
 * @param {{ moreButton?: HTMLElement|null, sheet?: SheetCfg, picker?: SheetCfg,
 *           sheetActions?: Array<[HTMLElement|null, () => void]> }} [extra]
 */
export function createDesignHeader(els, handlers, extra = {}) {
    let pickSignature = '';

    for (const b of els.renameButtons || []) b?.addEventListener('click', () => handlers.onRename());

    // `create` is the coordinator's createLightbox, INJECTED: overlay.js touches `window` at import,
    // and this module has to load in Node for its copy rules to be tested.
    const build = (/** @type {any} */ cfg) => cfg?.overlay && cfg.content && cfg.create
        ? cfg.create({ overlay: cfg.overlay, content: cfg.content, closeBtn: cfg.closeBtn ?? undefined, initialFocus: cfg.initialFocus ?? undefined })
        : null;
    const sheet  = build(extra.sheet);
    const picker = build(extra.picker);

    /**
     * ONE ACTION PER OPENING (whole-app fix, Nov 2026). A sheet stays tappable through its fade, and a
     * second `close()` hands back the same landing promise, so each extra tap ran the row again: a
     * double tap on Delete stacked two confirms and filed the design in the bin twice. The first
     * action spends the opening and `openSheet` re-arms it — select-sheet.js's "one tap, one pick".
     */
    const spent = new WeakSet();
    const openSheet = (/** @type {any} */ lb) => { if (!lb) return; spent.delete(lb); lb.open(); };
    /**
     * Close `lb`, then run `fn` once the close has LANDED: the fade finished and the history echo of
     * its `history.back()` arrived, which `createLightbox`'s `close()` resolves on. A fixed 500 ms
     * stood in for that until Nov 2026 — a wait with no promise about the echo, and a dialog opened
     * before the echo pops itself (select-sheet.js has the account). `fn` gets no argument, whatever
     * the close resolves with.
     */
    const closeThen = (/** @type {any} */ lb, /** @type {() => void} */ fn) => {
        if (!lb) { fn(); return; }   // nothing to fade, so nothing to wait out
        if (spent.has(lb)) return;
        spent.add(lb);
        Promise.resolve(lb.close()).then(() => fn())
            .catch((/** @type {any} */ err) => console.error('[Links] A sheet action failed:', err));
    };

    extra.moreButton?.addEventListener('click', () => openSheet(sheet));
    /** Close the ··· More sheet, then run `fn`. Exposed for a row wired elsewhere (the bin). */
    const viaSheet = (/** @type {() => void} */ fn) => closeThen(sheet, fn);
    for (const [el, run] of extra.sheetActions || []) el?.addEventListener('click', () => viaSheet(run));

    // NOTE the button comes from `els`, not `extra`: `render` has to disable it, so it belongs with
    // the other rendered handles. Reading it from `extra` here is what shipped first, and the face
    // then had no listener at all while every unit test still passed.
    els.pickerButton?.addEventListener('click', () => openSheet(picker));
    // ONE delegated handler on the list, so a rebuild never leaves listeners behind or drops them.
    els.pickList?.addEventListener('click', (/** @type {any} */ ev) => {
        const row = ev.target?.closest?.('.picker-opt[data-id]');
        const id  = row?.dataset?.id;
        if (id) closeThen(picker, () => handlers.onSelect(id));
    });

    /** @param {HeaderState} state */
    function render(state) {
        const { designs, activeId, design, dirty, currentUser, saving = false, now = new Date(),
                proposals = [], proposalId = null, queued = false } = state;
        const saved = !!activeId;
        const open  = !!design;
        const isProposal = !saved && open && !!proposalId;
        const entry = saved ? designs.find(d => d.id === activeId) : null;
        const groups = groupDesigns(designs, currentUser);

        // ── the picker list (rebuilt only on a content change — rule 4) ──
        if (els.pickList) {
            const sig = JSON.stringify([saved, activeId, open, proposalId, isProposal && dirty, proposals.map(d => d.id), groups.map(g => [g.label, g.designs.map(d => [d.id, d.name, lastSaveTime(d)?.getTime() ?? 0])])]);
            if (sig !== pickSignature) {
                pickSignature = sig;
                els.pickList.textContent = '';
                // The open-but-unsaved design has no id to select BY, so its row states where you
                // are and is inert — leaving it out would show the picker with nothing current.
                if (!saved && open && !isProposal) {
                    els.pickList.appendChild(pickRow({ name: 'Untitled design', meta: 'Not saved yet', current: true }));
                }
                // THE SHORTLIST FIRST (v24.47): the designs everything is measured against,
                // built in and read-only. A group of their own, so they cannot be mistaken for
                // somebody's saved work — "Last saved by" would be a claim about nobody.
                if (proposals.length) {
                    const wrap = document.createElement('div');
                    wrap.className = 'picker-group picker-group--proposals';
                    wrap.setAttribute('role', 'group');
                    wrap.setAttribute('aria-label', 'Shortlisted proposals');
                    const h = document.createElement('div');
                    h.className = 'picker-group-label';
                    h.setAttribute('aria-hidden', 'true');
                    h.textContent = 'Shortlisted proposals';
                    wrap.appendChild(h);
                    for (const d of proposals) {
                        wrap.appendChild(pickRow({ id: d.id, name: d.name,
                            meta: isProposal && d.id === proposalId && dirty ? 'Open · edited, not saved'
                                : d.ref ? `${d.ref} · read-only` : 'Built in · read-only',
                            current: isProposal && d.id === proposalId }));
                    }
                    els.pickList.appendChild(wrap);
                }
                for (const g of groups) {
                    const wrap = document.createElement('div');
                    wrap.className = 'picker-group';
                    wrap.setAttribute('role', 'group');
                    wrap.setAttribute('aria-label', g.label);
                    const h = document.createElement('div');
                    h.className = 'picker-group-label';
                    h.setAttribute('aria-hidden', 'true');
                    h.textContent = g.label;
                    wrap.appendChild(h);
                    for (const d of g.designs) {
                        const when = lastSaveTime(d);
                        wrap.appendChild(pickRow({
                            id: d.id,
                            name: d.name,
                            // Every row here HAS a document; with no time yet (a queued create, a failed
                            // read-back) it says what the pill says, never "Not saved yet".
                            meta: when ? `Saved ${shortDate(when, now)}` : 'Saved',
                            current: saved && d.id === activeId,
                        }));
                    }
                    els.pickList.appendChild(wrap);
                }
                if (!open && designs.length === 0) {
                    const empty = document.createElement('p');
                    empty.className = 'picker-empty';
                    empty.textContent = 'No designs saved yet.';
                    els.pickList.appendChild(empty);
                }
            }
        }
        // With the shortlist above them, "0 saved designs" over rows you can open reads as wrong.
        if (els.pickerSub) els.pickerSub.textContent = (proposals.length ? `${proposals.length} shortlisted · ` : '')
            + (designs.length === 1 ? '1 saved design' : `${designs.length} saved designs`);
        if (els.pickerButton) els.pickerButton.disabled = designs.length === 0 && !open && !proposals.length;

        // ── the face ──
        const name = open ? (design?.name || '').trim() || 'Untitled design' : 'No design open';
        const eyebrow = !open ? 'Designs' : saved ? 'Editing' : isProposal ? (dirty ? 'Copy of a proposal' : 'Shortlisted proposal') : 'New design';
        const count = `${designs.length} saved`;
        if (els.faceName) els.faceName.textContent = name;
        if (els.eyebrow)  els.eyebrow.textContent = eyebrow;
        if (els.count)    els.count.textContent = count;
        // The face's spans are aria-hidden — they are a styled title, not a label — so the button
        // needs a name that says WHICH design is open. The <select> announced that for free.
        // The name is the face's own words, in the face's order, then the action (v25.27, WCAG
        // 2.5.3 Label in Name): a voice user says what they see. Below 760px only the design's name
        // shows and from 760px the eyebrow and count above it too, and this one name holds both.
        els.pickerButton?.setAttribute('aria-label', `${eyebrow}, ${count}, ${name} — choose a different design`);
        els.masthead?.classList.toggle('is-unnamed', open && !saved && !isProposal);
        els.masthead?.classList.toggle('is-proposal', isProposal);
        els.masthead?.classList.toggle('is-empty', !open);

        // ── who + status ──
        // A proposal has no author to draw initials for — "S" for "Shortlist" read as a person. It
        // gets a mark instead, and its ref (code · fingerprint) is the line under it: the one detail
        // that matches the grid on screen to the printed sheet.
        const who = isProposal
            ? { name: 'Shortlisted', role: proposals.find(d => d.id === proposalId)?.ref || 'Built-in proposal' }
            : whoCopy({ saved, updatedBy: entry?.updatedBy, currentUser });
        for (const a of [els.avatar, els.sheetAvatar]) {
            if (!a) continue;
            a.textContent = isProposal ? '★' : avatarInitials(who.name);
            a.style.background = isProposal ? 'var(--primary-blue)' : avatarHue(who.name);
        }
        if (els.whoName) els.whoName.textContent = who.name;
        if (els.whoRole) els.whoRole.textContent = who.role;
        const st = statusCopy({ saved, dirty, saving, updatedAt: lastSaveTime(entry), now, proposal: isProposal, queued });
        if (els.status) {
            els.status.className = `dm-status dm-status--${st.tone}`;
            els.status.hidden = !open;
        }
        if (els.statusLong)  els.statusLong.textContent  = st.long;
        if (els.statusShort) els.statusShort.textContent = st.short;

        // ── the sheet's header ──
        if (els.sheetName) els.sheetName.textContent = name;
        if (els.sheetSub) {
            // The LAST SAVE, read with dirty/saving off — the pill's own words ("Unsaved changes",
            // "Saving…") describe the working copy and read as nonsense after "Saved by".
            const lastSave = statusCopy({ saved, dirty: false, saving: false, updatedAt: lastSaveTime(entry), now, queued });
            els.sheetSub.textContent = !open ? 'Start a new design, import one, or restore one from Recently deleted.'
                : isProposal ? 'A shortlisted proposal, built in. Change anything — saving makes your own copy.'
                : !saved ? 'Not saved yet. Save it to give it a name.'
                : `Saved by ${who.name} ${lastSave.long.replace(/^Saved\s*/, '')}`.trim();
        }

        // ── the buttons ──
        const label = saveButtonLabel({ saved, dirty, proposal: isProposal });
        for (const b of els.saveButtons || []) {
            if (!b) continue;
            if (!saving) { b.textContent = label; b.disabled = !open || !(dirty || !saved); }
            b.classList.toggle('is-new', open && !saved);
        }
        // Rename needs a saved design, and it is offered TWICE — the pencil and the sheet's row.
        // Both are disabled from the one condition: a control that is live in one place and
        // greyed in another reads as a bug in whichever the reader found first (v23.33).
        for (const b of els.renameButtons || []) if (b) b.disabled = !saved;
        if (els.renameMenuButton) els.renameMenuButton.disabled = !saved;
        // Delete needs a saved design, and nothing else: the last one may go too (links-app-23).
        if (els.deleteButton) els.deleteButton.disabled = !saved;
    }

    return { render, viaSheet };
}
