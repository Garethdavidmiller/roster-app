// @ts-check
/**
 * links-design-library.js — the Links workspace's design LIBRARY: the import panel and the
 * Recently deleted bin (v24.51, split out of links-app.js).
 *
 * ── WHY THIS IS ITS OWN MODULE ─────────────────────────────────────────────────────────────────
 *
 * An external technical-debt review (5 Oct 2026) named links-app.js as the app's largest controller
 * — one `init()` scope coordinating import, the bin, the picker, painting, cell editing, printing
 * and saving — and proposed this cut first: managing the COLLECTION of designs, apart from EDITING
 * the one that is open. The two halves share very little: the library needs the list of live designs
 * to check a name, a way to add one and open it, and to know whether leaving the open design would
 * lose work. That is the whole of `ctx` below, and keeping it that small is the point — a split that
 * passed dozens of callbacks would only move the coupling into a parameter list.
 *
 * ── WHAT THIS MODULE OWNS ──────────────────────────────────────────────────────────────────────
 *
 * The BIN LIST itself (`bin`, read through `binList()` and replaced through `setBin()`), the
 * automatic moves still in flight (`trackBinMove`, v24.48 — a restore or purge of a design whose
 * move has not landed waits for it), restore and permanent removal, and the import panel's
 * check-then-save flow. Every Firestore write still goes through the design store
 * (links-design-store.js), and every rule through its own module (links-import.js,
 * links-deletion.js, links-design-naming.js) — this file is the panels.
 *
 * ── WHAT STAYS IN links-app.js, AND WHY ────────────────────────────────────────────────────────
 *
 * Rename, duplicate and delete. Each one changes the OPEN design's concurrency baseline
 * (`loadedRevision`, `loadedUpdatedAt`) or its unsaved state, so moving them would mean exporting
 * the editor's state — the reverse of the boundary this draws.
 */

import { escapeHtml } from './roster-data.js';
import { serverTimestamp } from './firebase-client.js';
import { createLightbox, confirmDialog } from './overlay.js';
import { checkName } from './links-design-naming.js';
import { ROTATING_LINES } from './links-design.js';
import { docPayload, restoredEntryFrom } from './links-design-doc.js';
import { parseDesignImport, summariseImport } from './links-import.js';
import { deletedLabel } from './links-deletion.js';
import { unconfirmedWriteLine } from './claim-retry.js';

/**
 * @typedef {object} LibraryContext
 * @property {any} store                     the design store (links-design-store.js)
 * @property {any} currentUser               who is signed in (a name) — stamps a write, attributes a delete
 * @property {() => any[]} getDesigns        the live designs, for the duplicate-name rule
 * @property {(d: any) => void} addDesign    add a created or restored design to the list, in order
 * @property {(d: any) => void} activate     open a design in the editor
 * @property {() => boolean} isDirty         would leaving the open design lose unsaved work?
 * @property {() => boolean} hasOpenDesign   is any design open? (a restore into an empty workspace opens it)
 * @property {() => void} renderPicker       repaint the design picker
 * @property {() => Promise<void>} refreshLists  re-read both lists from the server
 * @property {(msg: string, kind?: 'ok'|'err') => void} actionStatus  the workspace's status line
 * @property {() => any} getHeader           the masthead, once built (the bin opens from its ··· sheet)
 */

/**
 * Build the library and wire its two panels. Call once, after the design store exists.
 * @param {LibraryContext} ctx
 */
export function createDesignLibrary(ctx) {
    /** Deleted designs, newest first — the "Recently deleted" bin (v19.41). Held in memory with
     *  their patterns so a restore is a field-clearing merge, never a re-upload of a stale copy.
     *  @type {Array<{id:string, name:string, patterns:Object, window?:*, deletedAt:*, deletedBy:string}>} */
    let bin = [];
    /** Automatic moves to the bin still in flight (v24.48). @type {Map<string, Promise<any>>} */
    const _pending = new Map();

    // ── Import a pasted design ──────────────────────────────────────────────────────────────────
    //
    // The RULES are all in `links-import.js`; everything here is the panel. Two things about the
    // shape of this flow are deliberate:
    //
    //  1. CHECK BEFORE SAVE, always, even when the paste is perfect. A design is 168 cells the
    //     reader has never seen as a grid, and it came from somebody else — so "it parsed" is not
    //     the same as "this is what I meant to import". The check states what would be written and
    //     any assumption made on the way, and only then does Save appear.
    //  2. It saves as a NEW design and never touches the open one. An import that could overwrite
    //     the design in front of you is one mis-tap from destroying work, and the workspace already
    //     has a bin full of reasons to be careful about that.

    /** The parse result the check produced, or null. Cleared whenever the text changes. */
    /** @type {any} */
    let _importParsed = null;
    /** The import lightbox handle, assigned by `initDesignImport` below. @type {any} */
    let _importLb = null;

    /** @param {string} id */
    function _importEl(id) { return /** @type {any} */ (document.getElementById(id)); }

    /** Write the status line in one of its three voices. */
    /** @param {string} msg @param {string|null} tone */
    function _importStatus(msg, tone) {
        const el = _importEl('linksImportStatus');
        if (!el) return;
        el.textContent = msg;
        el.className = 'li-status' + (tone ? ` li-status--${tone}` : '');
    }

    /** Back to "nothing checked yet" — called on open and on every edit of the PASTE. */
    function _importReset() {
        _importParsed = null;
        const save = _importEl('linksImportSave');
        const check = _importEl('linksImportCheck');
        if (save) save.hidden = true;
        if (check) check.hidden = false;
        _importStatus('', null);
    }

    async function openImport() {
        // An import ends in `_activateDesign`, so it replaces the working copy like the other paths
        // that ask first — and asks here, before any typing, as `createDesign` does.
        if (ctx.isDirty() && !await confirmDialog({ message: 'You have unsaved changes in the current design. Import a new one anyway? Your changes will be lost.', confirmLabel: 'Import' })) return;
        const text = _importEl('linksImportText');
        const name = _importEl('linksImportName');
        if (!text) return;
        text.value = '';
        if (name) name.value = '';
        _importReset();
        _importLb?.open();
    }

    /** Parse what is in the box and report it. Never writes anything. */
    function checkImport() {
        const text = _importEl('linksImportText');
        const r = parseDesignImport(text?.value ?? '', { lines: ROTATING_LINES });
        if (!r.ok) {
            _importParsed = null;
            // Belt and braces: any edit to either field already ran `_importReset`, so the button
            // is normally hidden before this line runs. Kept so the refusal branch does not depend
            // on a listener wired two hundred lines away — and noted here because a mutation
            // removing it survives the e2e for exactly that reason.
            const save = _importEl('linksImportSave');
            if (save) save.hidden = true;
            _importStatus(r.error, 'bad');
            return;
        }
        _importParsed = r;
        // A pasted name only fills the field when the reader has not typed one — their own name for
        // a colleague's proposal is the more considered of the two.
        const nameEl = _importEl('linksImportName');
        if (nameEl && !nameEl.value.trim() && r.name) nameEl.value = r.name;

        const s = summariseImport(r.patterns, ROTATING_LINES);
        const lines = [`${s.filled} of ${s.lines} lines · ${s.worked} duties · ${s.spare} spare days · ${s.rest} rest days.`];
        // Warnings BEFORE the save, never after it — a decision reported once the write has
        // happened is a notification rather than a choice.
        for (const w of r.warnings) lines.push(`• ${w}`);
        _importStatus(lines.join('\n'), r.warnings.length ? 'warn' : 'ok');

        const save = _importEl('linksImportSave');
        const check = _importEl('linksImportCheck');
        if (save) save.hidden = false;
        if (check) check.hidden = true;
    }

    /** Write the checked design as a new one. */
    async function saveImport() {
        if (!_importParsed) return;
        const name = (_importEl('linksImportName')?.value ?? '').trim();
        if (!name) { _importStatus('Give the design a name first.', 'bad'); return; }
        const nameCheck = checkName(name, { existing: ctx.getDesigns(), noun: 'design' });
        if (!nameCheck.ok) { _importStatus(nameCheck.message || 'That name cannot be used.', 'bad'); return; }
        const btn = _importEl('linksImportSave');
        if (btn) btn.disabled = true;
        _importStatus('Saving…', null);
        try {
            const patterns = _importParsed.patterns;
            // An imported design starts on the app default window, like a new one — the paste
            // describes duties, and a window it never mentioned must not be inferred from them.
            // Through the store, so the baseline is armed identically however a design is born.
            const { id: importedId, updatedAt: ts, baseline: impBase } = await ctx.store.create(
                docPayload({ name, patterns, window: null },
                           { updatedBy: ctx.currentUser, updatedAt: serverTimestamp() }));
            const d = restoredEntryFrom({ id: importedId, name, patterns, window: null }, { updatedAt: ts, updatedBy: ctx.currentUser, revision: impBase.loadedRevision });
            ctx.addDesign(d);
            _importLb?.close();
            ctx.activate(d);
            ctx.actionStatus(`Imported “${name}”. Check it against the sheet it came from.`, 'ok');   // a success, not an error (it rendered RED until v23.30)
        } catch (err) {
            console.error('[Links] Import failed:', err);
            _importStatus(unconfirmedWriteLine(err, 'this design', 'the design list') ?? 'Couldn’t save the design — check your connection and try again.', 'bad');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ============================================
    // RECENTLY DELETED (soft delete, v19.41)
    // ============================================

    /** Bin-panel feedback line. @param {string} msg @param {'ok'|'err'} [kind] */
    function _binStatus(msg, kind = 'err') {
        const el = document.getElementById('designBinStatus');
        if (el) { el.textContent = msg; el.className = 'bin-status ' + kind; }
    }

    /**
     * Restore a deleted design.
     *
     * Clears the two fields with `deleteField()` on a MERGE write rather than re-writing the whole
     * document: the patterns held here were read when the page loaded, and a full replace would
     * push that copy over anything the design carried at the moment it was deleted.
     * @param {any} id
     */
    async function restoreDesign(id) {
        const d = bin.find(x => x.id === id);
        if (!d) return;
        // The duplicate-name rule every other way in already holds — the bin was the way round it.
        if (checkName(d.name, { existing: ctx.getDesigns(), noun: 'design' }).reason === 'duplicate') {
            _binStatus(`There is already a design called “${d.name}”. Rename that one first, then restore this — two with the same name cannot be told apart in the list.`);
            return;
        }
        try {
            await _pending.get(id);
            const res = await ctx.store.restore(id, ctx.currentUser);
            // TWO OUTCOMES A COLLEAGUE ALREADY SETTLED — neither changed by retrying, and both
            // once read "check your connection", blaming the network for somebody's deliberate
            // act. One handler: the reaction is identical and only the sentence differs. The store
            // reports the state; the wording is the workspace's.
            const settledElsewhere = /** @type {Record<string, string>} */ ({
                gone: `“${d.name}” was already removed for good by someone else, so there was nothing to restore.`,
                'already-restored': `“${d.name}” had already been restored by someone else — it is back in the list.`,
            })[res.status];
            if (settledElsewhere) {
                await ctx.refreshLists();
                _binStatus(settledElsewhere);
                return;
            }
            const { updatedAt: restoredTs, revision: restoredRev } = res;
            bin = bin.filter(x => x.id !== id);
            // The store armed the baseline from the server. A restored design is an OLD document a
            // co-editor may still hold, so entering it with no baseline is worse than for a new
            // one: the next save would skip the "someone else saved" confirm entirely. A null
            // stamp reads as an UNKNOWN baseline (guard on), never "nothing to compare".
            const restored = restoredEntryFrom(d, { updatedAt: restoredTs, updatedBy: ctx.currentUser, revision: restoredRev });
            ctx.addDesign(restored);
            // Restoring into an EMPTY workspace OPENS the design — the masthead names the open one.
            if (!ctx.hasOpenDesign()) ctx.activate(restored); else ctx.renderPicker();
            renderBinList();
            _binStatus(`“${d.name}” restored.`, 'ok');
        } catch (err) {
            console.error('[Links] Restore failed:', err);
            _binStatus(unconfirmedWriteLine(err, 'this change', 'the design list') ?? 'Couldn’t restore that design — check your connection and try again.');
        }
    }

    /**
     * Remove a deleted design for good (the only hard delete left in the workspace).
     * @param {any} id
     */
    async function purgeDesign(id) {
        const d = bin.find(x => x.id === id);
        if (!d) return;
        if (!await confirmDialog({
            title: 'Remove for good',
            message: `Permanently remove "${d.name}"?\n\nThis one can't be undone.`,
            confirmLabel: 'Remove for good',
            danger: true,
        })) return;
        try {
            // The re-read-inside-the-transaction rule is the store's (v21.87). It matters most
            // here: this is the only hard delete left in the workspace, and the row that was
            // pressed may be stale — A opens the bin, B restores, A presses Remove for good.
            await _pending.get(id);
            const outcome = await ctx.store.purge(id);
            if (outcome === 'restored-elsewhere') {
                // Say what happened rather than "couldn't remove": someone put it back on purpose,
                // and the right next step is to look at it again, not to retry.
                await ctx.refreshLists();
                _binStatus(`“${d.name}” was restored by someone else, so it was not removed.`);
                return;
            }
            bin = bin.filter(x => x.id !== id);
            ctx.renderPicker();
            renderBinList();
            _binStatus(`“${d.name}” removed.`, 'ok');
        } catch (err) {
            console.error('[Links] Permanent delete failed:', err);
            _binStatus(unconfirmedWriteLine(err, 'this change', 'the design list') ?? 'Couldn’t remove that design — check your connection and try again.');
        }
    }

    /** Rebuild the Recently-deleted list. */
    function renderBinList() {
        const list = document.getElementById('designBinList');
        if (!list) return;
        if (bin.length === 0) {
            list.innerHTML = '<p class="bin-empty">Nothing here. Deleted designs appear in this list.</p>';
            return;
        }
        const now = Date.now();
        list.innerHTML = bin.map(d => {
            const id = escapeHtml(d.id);
            return `<div class="bin-row">` +
                `<div class="bin-row-main">` +
                    `<span class="bin-row-name">${escapeHtml(d.name)}</span>` +
                    `<span class="bin-row-meta">${escapeHtml(deletedLabel(d, now))}</span>` +
                `</div>` +
                // The app's canonical dialog button pair — same recipe, same 44px touch target and
                // press feedback as every confirm dialog (v19.43). These were a third, page-local
                // recipe: ~26px tall pills with no press animation.
                `<div class="bin-row-actions">` +
                    `<button class="bin-restore dialog-btn dialog-btn-confirm" data-id="${id}" type="button">Restore</button>` +
                    `<button class="bin-purge dialog-btn dialog-btn-cancel" data-id="${id}" type="button" ` +
                        `aria-label="Remove ${escapeHtml(d.name)} for good">Remove for good</button>` +
                `</div></div>`;
        }).join('');
    }

    /** Wire the bin button + panel — called once on page load. */
    function initDesignBin() {
        const overlay = document.getElementById('designBinLightbox');
        const content = document.getElementById('designBinContent');
        const closeBtn = document.getElementById('designBinClose');
        if (!overlay || !content || !closeBtn) return;
        const lb = createLightbox({
            overlay,
            content:  /** @type {HTMLElement} */ (content),
            closeBtn: /** @type {HTMLElement} */ (closeBtn),
            onOpen() { _binStatus('', 'ok'); renderBinList(); },
        });
        document.getElementById('designBinBtn')?.addEventListener('click', () => { const h = ctx.getHeader(); if (h) h.viaSheet(() => lb.open()); else lb.open(); });   // via the ··· sheet
        document.getElementById('designBinList')?.addEventListener('click', e => {
            const t = /** @type {Element} */ (e.target);
            const restore = /** @type {HTMLElement|null} */ (t.closest('.bin-restore'));
            const purge   = /** @type {HTMLElement|null} */ (t.closest('.bin-purge'));
            if (restore)    restoreDesign(restore.dataset.id);
            else if (purge) purgeDesign(purge.dataset.id);
        });
    }

    /** Wire the import panel — called once on page load, like the bin. */
    function initDesignImport() {
        const overlay = document.getElementById('linksImportLb');
        const content = document.getElementById('linksImportContent');
        const closeBtn = document.getElementById('linksImportClose');
        if (!overlay || !content || !closeBtn) return;
        _importLb = createLightbox({
            overlay,
            content:  /** @type {HTMLElement} */ (content),
            closeBtn: /** @type {HTMLElement} */ (closeBtn),
            initialFocus: () => document.getElementById('linksImportText'),
        });
        document.getElementById('linksImportCheck')?.addEventListener('click', checkImport);
        document.getElementById('linksImportSave')?.addEventListener('click', saveImport);
        document.getElementById('linksImportCancel')?.addEventListener('click', () => _importLb?.close());
        // EDITING THE PASTE invalidates the check. Without this, editing the text after a
        // successful check would leave Save armed against the PREVIOUS parse — the reader would be
        // shown one design and save another, which is the one outcome this two-step exists to stop.
        //
        // THE NAME DOES NOT, and used to (v22.62, external review P2). Nothing about the parse
        // depends on it: `_importParsed` is a function of the TEXT alone, and `saveImport` reads
        // the name fresh from the field and validates it there. Worse, resetting on it fired on the
        // commonest path — `checkImport` pre-fills the name from the paste, so a reader who then
        // makes it their own name for a colleague's proposal watched Save disappear and had to
        // press Check again. The old test filled the name BEFORE checking, which is why nothing saw
        // it.
        document.getElementById('linksImportText')?.addEventListener('input', _importReset);
    }

    initDesignBin();
    initDesignImport();

    return {
        openImport,
        renderBinList,
        /** @returns {any[]} the bin, newest first */
        binList: () => bin,
        /** Replace the bin wholesale — a fresh read of the collection. @param {any[]} list */
        setBin: (list) => { bin = list; },
        /** A design the workspace just deleted, at the top. @param {any} entry */
        addToBin: (entry) => { bin.unshift(entry); },
        /** Put this entry at the top, replacing any older copy of it. @param {any} entry */
        upsertBin: (entry) => { bin = [entry, ...bin.filter(x => x.id !== entry.id)]; },
        /** Register an automatic move still in flight; a restore or purge of it waits. @param {string} id @param {Promise<any>} p */
        trackBinMove: (id, p) => { _pending.set(id, p.finally(() => _pending.delete(id))); },
    };
}
