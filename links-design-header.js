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
 *    field (a rules change, backend-first). If that field ever arrives, this is the one function to
 *    change. There is deliberately NO filter-by-designer step in front of the list: a two-step
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
 *    the active id — the same shape the brush bar uses for the same reason. The click handler is
 *    DELEGATED to the list for the same reason: a rebuild can then never orphan a listener.
 *
 * What it deliberately does NOT own: the decision to save, the conflict protocol, naming validation
 * (`links-design-naming.js`), compare mode, the bin. Every handle is injected; the module reaches for
 * no id of its own, so it loads in Node and `links-design-header.test.mjs` drives the copy rules and
 * the render against a fake DOM.
 */

import { avatarInitials, avatarHue } from './roster-data.js';
import { nameConflict } from './links-design-naming.js';

/**
 * @typedef {{ id: string, name: string, updatedAt?: any, updatedBy?: string }} DesignEntry
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
 * A design with no `updatedBy` is grouped under "Other designs" rather than dropped — a document
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
        label: key === me ? 'Your designs' : key === NO_DESIGNER ? 'Other designs' : `${key}'s designs`,
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
 * @param {{ saved: boolean, dirty: boolean }} s  `saved` = the design has a Firestore document.
 */
export function saveButtonLabel({ saved, dirty }) {
    if (!saved) return 'Save as…';
    return dirty ? 'Save' : 'Saved';
}

/** @param {Date} when @param {Date} now */
function shortDate(when, now) {
    const opts = when.getFullYear() === now.getFullYear()
        ? { day: 'numeric', month: 'short' }
        : { day: 'numeric', month: 'short', year: 'numeric' };
    return when.toLocaleDateString('en-GB', /** @type {any} */ (opts));
}
/** @param {Date} when @param {Date} now */
function sameDay(when, now) {
    return when.getFullYear() === now.getFullYear() && when.getMonth() === now.getMonth() && when.getDate() === now.getDate();
}

/**
 * The status pill's words and tone. `long` is the desktop sentence, `short` the phone one — the
 * phone row has room for a dot and two words beside the badge and two buttons.
 *
 * @param {{ saved: boolean, dirty: boolean, saving?: boolean, updatedAt?: any, now?: Date }} s
 * @returns {{ tone: 'saved'|'dirty'|'new'|'saving', long: string, short: string }}
 */
export function statusCopy({ saved, dirty, saving = false, updatedAt = null, now = new Date() }) {
    if (saving) return { tone: 'saving', long: 'Saving…', short: 'Saving…' };
    if (!saved)  return { tone: 'new', long: 'Not saved yet', short: 'Not saved' };
    if (dirty)   return { tone: 'dirty', long: 'Unsaved changes', short: 'Unsaved' };
    const when = toDate(updatedAt);
    if (!when) return { tone: 'saved', long: 'Saved', short: 'Saved' };
    const time = when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
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
    const base = `${(currentUser || 'Design').trim()} · ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
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
 * @property {boolean} [canDelete]  false while the bin rule forbids deleting the last design
 * @property {string} currentUser
 * @property {Date} [now]
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
 * runs after the fade — the pattern `#linksHowBtn` established for the About panel. Stacking a
 * dialog over an open sheet leaves the sheet behind a finished action, and acting in the same tick
 * as close() races the sheet's history.back() against the dialog's pushState. The 500ms matches
 * `dismissOverlay`'s fallback; with no sheet injected at all there is no fade to wait out, so the
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

    /** Close `lb`, then run `fn` after its fade. */
    const closeThen = (/** @type {any} */ lb, /** @type {() => void} */ fn) => {
        if (!lb) { fn(); return; }   // nothing to fade, so nothing to wait out
        lb.close();
        setTimeout(fn, 500);
    };

    extra.moreButton?.addEventListener('click', () => sheet?.open());
    /** Close the ··· More sheet, then run `fn`. Exposed for a row wired elsewhere (the bin). */
    const viaSheet = (/** @type {() => void} */ fn) => closeThen(sheet, fn);
    for (const [el, run] of extra.sheetActions || []) el?.addEventListener('click', () => viaSheet(run));

    // NOTE the button comes from `els`, not `extra`: `render` has to disable it, so it belongs with
    // the other rendered handles. Reading it from `extra` here is what shipped first, and the face
    // then had no listener at all while every unit test still passed.
    els.pickerButton?.addEventListener('click', () => picker?.open());
    // ONE delegated handler on the list, so a rebuild never leaves listeners behind or drops them.
    els.pickList?.addEventListener('click', (/** @type {any} */ ev) => {
        const row = ev.target?.closest?.('.picker-opt[data-id]');
        const id  = row?.dataset?.id;
        if (id) closeThen(picker, () => handlers.onSelect(id));
    });

    /** @param {HeaderState} state */
    function render(state) {
        const { designs, activeId, design, dirty, currentUser, saving = false, canDelete = true, now = new Date() } = state;
        const saved = !!activeId;
        const open  = !!design;
        const entry = saved ? designs.find(d => d.id === activeId) : null;
        const groups = groupDesigns(designs, currentUser);

        // ── the picker list (rebuilt only on a content change — rule 4) ──
        if (els.pickList) {
            const sig = JSON.stringify([saved, activeId, open, groups.map(g => [g.label, g.designs.map(d => [d.id, d.name, toDate(d.updatedAt)?.getTime() ?? 0])])]);
            if (sig !== pickSignature) {
                pickSignature = sig;
                els.pickList.textContent = '';
                // The open-but-unsaved design has no id to select BY, so its row states where you
                // are and is inert — leaving it out would show the picker with nothing current.
                if (!saved && open) {
                    els.pickList.appendChild(pickRow({ name: 'Untitled design', meta: 'Not saved yet', current: true }));
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
                        const when = toDate(d.updatedAt);
                        wrap.appendChild(pickRow({
                            id: d.id,
                            name: d.name,
                            meta: when ? `Saved ${shortDate(when, now)}` : 'Not saved yet',
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
        if (els.pickerSub) els.pickerSub.textContent = designs.length === 1 ? '1 saved design' : `${designs.length} saved designs`;
        if (els.pickerButton) els.pickerButton.disabled = designs.length === 0 && !open;

        // ── the face ──
        const name = open ? (design?.name || '').trim() || 'Untitled design' : 'No design open';
        if (els.faceName) els.faceName.textContent = name;
        if (els.eyebrow)  els.eyebrow.textContent = !open ? 'Designs' : saved ? 'Editing' : 'New design';
        if (els.count)    els.count.textContent = `${designs.length} saved`;
        // The face's spans are aria-hidden — they are a styled title, not a label — so the button
        // needs a name that says WHICH design is open. The <select> announced that for free.
        els.pickerButton?.setAttribute('aria-label', `Design: ${name}. Choose a different design`);
        els.masthead?.classList.toggle('is-unnamed', open && !saved);
        els.masthead?.classList.toggle('is-empty', !open);

        // ── who + status ──
        const who = whoCopy({ saved, updatedBy: entry?.updatedBy, currentUser });
        for (const a of [els.avatar, els.sheetAvatar]) {
            if (!a) continue;
            a.textContent = avatarInitials(who.name);
            a.style.background = avatarHue(who.name);
        }
        if (els.whoName) els.whoName.textContent = who.name;
        if (els.whoRole) els.whoRole.textContent = who.role;
        const st = statusCopy({ saved, dirty, saving, updatedAt: entry?.updatedAt, now });
        if (els.status) {
            els.status.className = `dm-status dm-status--${st.tone}`;
            els.status.hidden = !open;
        }
        if (els.statusLong)  els.statusLong.textContent  = st.long;
        if (els.statusShort) els.statusShort.textContent = st.short;

        // ── the sheet's header ──
        if (els.sheetName) els.sheetName.textContent = name;
        if (els.sheetSub) {
            els.sheetSub.textContent = !open ? 'Start a new design, import one, or restore one from Recently deleted.'
                : !saved ? 'Not saved yet. Save it to give it a name.'
                : `Saved by ${who.name} ${st.long.replace(/^Saved\s*/, '')}`.trim();
        }

        // ── the buttons ──
        const label = saveButtonLabel({ saved, dirty });
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
        if (els.deleteButton) els.deleteButton.disabled = !saved || !canDelete;
    }

    return { render, viaSheet };
}
