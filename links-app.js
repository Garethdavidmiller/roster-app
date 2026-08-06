// @ts-check
/**
 * links-app.js — Coordinator for links.html.
 *
 * Owns: auth guard, Firestore load/save for named link-design documents,
 *   28-line design grid, design picker, compare mode, paint-mode brush bar,
 *   coverage analysis, design quality checks, and the auto-generator.
 * Pure maths (classifyShift, calcCoverage, generatePatterns, runDesignChecks)
 *   live in links-design.js — no DOM, no Firebase there.
 */

import { CONFIG, weeklyRoster, bilingualRoster, escapeHtml } from './roster-data.js';
import { db, doc, getDoc, setDoc, addDoc, deleteField, collection, getDocs, serverTimestamp, runTransaction, COLLECTIONS, writeWithClaimRetry } from './firebase-client.js';
import { initNavPanel, resetNavPanel, archiveNotice, isNoticeExpired } from './nav-panel.js';
import { initLoginOverlay, dismissLoginOverlay } from './login-overlay.js';
import { getSession, clearSession, ensureNamedSession, sessionReady, resolveSession, reconcileExpiredIdentity } from './session.js';
import { requirePage } from './auth-policy.js';
import { getAuthSnapshot } from './auth-state.js';
import { initCardCollapse, createLightbox, confirmDialog, promptDialog, openNoticeIfClear } from './overlay.js';
import { initAboutLightbox } from './about-lightbox.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { registerServiceWorker } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';
import { initPasswordForce } from './password-force.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency } from './perf-reporter.js';
import { lsGet, lsSet } from './ls.js';
import {
    DAYS,
    ROTATING_LINES,
    classifyShift,
    normaliseCustomShift,
    normalisePatterns,
    dayClass,
    calcCoverage,
    generateLink,
} from './links-design.js';
import { initLinksAnalysis } from './links-analysis.js';
import { reorderLines, applyOrder, DEFAULT_BLOCK_TARGET } from './links-adjacency.js';
import { normaliseWindow, formatWindow, isDefaultWindow, isValidWindowRow, canonicaliseWindowTime } from './links-window.js';
import { assessFatigue } from './links-fatigue.js';
import { initLinksCompare } from './links-compare.js';
import { conflictOf as _conflictOf, baselineAfterWrite, canAdvanceBaseline } from './links-concurrency.js';
import {
    SOFT_DELETE_RETENTION_DAYS, isDeleted, isPurgeable, purgeableIds, deletedLabel, canSoftDelete, sortByDeleted,
} from './links-deletion.js';


/**
 * Phase 4a.2 (ARCHITECTURE_PLAN.md): the coordinator body is an exported init()
 * called by links-boot.js (a 2-line bootstrap — CSP `script-src 'self'` blocks
 * inline module scripts). This replaces the former top-level `throw`s (which
 * aborted module evaluation on the login/forbidden gate) with explicit early
 * `return`s, and lets a test import this module WITHOUT auto-running it. Body
 * unchanged otherwise — same statements, same order, one indent level in.
 */

// Read-through to the CURRENT init pass's `dirty` flag (v16.23). The SW registration now runs at
// the top of init() (so a signed-out visit still registers/updates the SW — the operations v16.21
// fix, applied here too), but `dirty` is declared inside the authorised body, and with in-place
// sign-in init() runs TWICE (login pass registers; authorised pass is a no-op via sw-register's
// once-guard). A direct closure would read the login pass's forever-false `dirty` and reload
// without the unsaved-changes confirm — this indirection always reads the latest pass's flag.
let _isDirty = () => false;

export function init() {
    // Register the SW before the access gate — a signed-out visit early-returns below and would
    // otherwise never register/update the SW for that load (v16.23; matches operations/settings).
    registerServiceWorker({
        async beforeReload() {
            // sw-register.js ignores the return value (this callback reloads itself), so an async
            // dialog is safe here — it just reloads once the user confirms.
            if (!_isDirty() || await confirmDialog({
                title: 'Update available',
                message: 'Reload to apply the update? Unsaved changes will be lost.',
                confirmLabel: 'Reload',
            })) {
                window.location.reload();
            }
        },
    });
    // Tear down a lingering privileged Firebase identity whose local app session has expired, so a
    // direct deep-link to this page can't keep an old credential live (review item 7 / Finding #9).
    // Fire-and-forget, login-safe: no-op on a valid session, stands down if a login supersedes it.
    reconcileExpiredIdentity().catch(() => {});
    // ============================================
    // SESSION — guard access to LINKS_DESIGNERS only
    // ============================================
    const currentSession  = getSession();
    const currentUser     = currentSession?.name ?? null;
    const isAdmin         = CONFIG.ADMIN_NAMES.includes(currentUser);

    // Page-access decision via the Phase-3 policy (auth-policy.js → ARCHITECTURE_PLAN.md Phase 5).
    // The "local-derived" snapshot maps the localStorage session to an identity status — present →
    // 'named' (optimistic fast render from local), absent → 'signedOut' — and requirePage applies the
    // Links policy (designer-only). Behaviour is identical to the prior two-gate form; this routes the
    // same decision (the LINKS_DESIGNERS membership test now lives in rolesFor) through the shared
    // authz layer instead of an inline CONFIG.LINKS_DESIGNERS check.
    const _access = requirePage({ status: currentUser ? 'named' : 'signedOut', member: currentUser }, 'links');
    if (_access.decision === 'login') {
        // Not signed in → show the shared in-place sign-in (no redirect). On success: INPLACE_LOGIN off
        // (default) → reload (today's path) + resolveSession(false) on this non-auth load; on → re-invoke
        // init() in place (the authorised body below never ran on this pass, so re-entering runs it
        // exactly once with the just-saved session — no reload, no double-wiring). Do NOT
        // resolveSession(false) when in-place, or the one-shot sessionReady is poisoned before the
        // in-place pass can resolve it true. (ARCHITECTURE_PLAN.md Phase 9.)
        // In-place re-invocation falls back to a reload if init() throws mid-wiring, so the in-place
        // path is never less robust than the reload path (the overlay is already torn down by then).
        const onSuccess = CONFIG.INPLACE_LOGIN.links
            // Reload (fresh overlay) rather than re-invoke init() into a soft-lock if saveSession
            // silently failed (iOS private mode) and getSession() is still null. See operations-app.js.
            ? () => { try { if (!getSession()) { window.location.reload(); return; } init(); } catch { window.location.reload(); } }
            : () => window.location.reload();
        initLoginOverlay({ pageLabel: 'Links', onSuccess });
        if (!CONFIG.INPLACE_LOGIN.links) resolveSession(false);
        return;
    }
    if (_access.decision === 'forbidden') {
        // Signed in but NOT a Links designer — access control, not a login divert.
        window.location.replace('./admin.html');
        return;
    }
    // _access.decision === 'allow' → proceed (signed-in designer).
    // In-place sign-in: remove the still-mounted overlay if we re-entered via onSuccess. No-op on a
    // normal already-signed-in load (no overlay present).
    dismissLoginOverlay();

    // B1.2 enforcement, now decided via the policy. Once the named session resolves, the store (fed by
    // the Phase-2 bridge inside ensureNamedSession) reflects the terminal Firebase identity, so
    // `requirePage(getAuthSnapshot(), 'links')` returns 'login' exactly when the designer's OWN named
    // session could not be confirmed — equivalent to the old `if (ENFORCE && !named)`. Flag OFF → the
    // snapshot is 'named'/'anonymous' and the decision is 'allow', so this never fires (unchanged).
    const _linksAuth = ensureNamedSession(currentUser);
    resolveSession(_linksAuth);
    _linksAuth.then(() => {
        if (CONFIG.ENFORCE_NAMED_SESSION && requirePage(getAuthSnapshot(), 'links').decision === 'login') {
            clearSession();
            // resetNavPanel() before the overlay (v16.69, mirrors settings' v16.25 fix) — the
            // drawer is wired with the now-cleared member's identity on a shared device.
            resetNavPanel();
            initLoginOverlay({ pageLabel: 'Links', onSuccess: () => window.location.reload() });
        }
    });

    // ============================================
    // PAGE INIT
    // ============================================
    document.body.classList.add('auth-ready');

    /** @type {any} */ let openAboutLightbox = null;

    initNavPanel({
        // Drawer Circular/Newsletter read waits for the session (AUTH_PLAN.md → E1).
        authReady: sessionReady,
        currentPage:     'links',
        memberName:      currentUser,
        isAdmin,
        isLinksDesigner: true,
        onLogoClick:     () => openAboutLightbox?.(),
        onSignOut: async () => {
            if (dirty && !await confirmDialog({ message: 'You have unsaved changes. Sign out anyway?', confirmLabel: 'Sign out', danger: true })) return;
            clearSession();
            window.location.href = './';
        },
    });

    // ============================================
    // CONSTANTS
    // ============================================
    const DAY_LABELS    = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    // ONE declaration of the rotation length, imported from links-design.js (v19.38). The grid
    // height and the generator's output are necessarily the same number — every line rotates.
    const TOTAL_POS = ROTATING_LINES;

    /** Firestore collection holding all named design documents. */
    const DESIGNS_COL = collection(db, COLLECTIONS.linkDesigns);

    /** localStorage key remembering the last active design across visits. */
    const ACTIVE_KEY = 'myb_links_active_design';

    // Shift option lists derived from actual roster data so they always match real shifts.
    const { EARLY_SHIFTS, LATE_SHIFTS } = (() => {
        const all = new Set();
        for (const roster of [weeklyRoster, bilingualRoster]) {
            for (const week of Object.values(roster)) {
                for (const shift of Object.values(week)) {
                    if (shift && shift !== 'RD' && shift !== 'OFF' && shift !== 'SPARE') all.add(shift);
                }
            }
        }
        const early = [], late = [];
        for (const s of [...all].sort()) {
            const cls = classifyShift(s);
            if (cls === 'early') early.push(s);
            else if (cls === 'late') late.push(s);
            // 'night' never appears here — CEAs do not work nights.
        }
        return { EARLY_SHIFTS: early, LATE_SHIFTS: late };
    })();

    // ============================================
    // STATE
    // ============================================
    /**
     * The currently active design. `id` is null for a freshly generated (not-yet-saved) design.
     * @type {{ id: string|null, name: string, patterns: Object, window?: any } | null}
     */
    let design = null;
    let dirty  = false;
    _isDirty = () => dirty;   // point the SW beforeReload at THIS pass's flag (v16.23)
    let loadFailed      = false;
    /** @type {any} */ let loadedUpdatedAt = null; // millis — for save concurrency check
    // True when a post-save updatedAt read-back FAILED: the baseline is unknown, not "no doc".
    // The overwrite-confirm guard then falls back to comparing updatedBy — without this, one
    // dropped read-back silently disabled the guard and the next save clobbered a co-designer's
    // version with no prompt (v16.69 review fix).
    let baselineUnknown = false;

    // Paint-mode brush: string = armed shift, null = no brush
    /** @type {any} */ let brush = null;

    // Generator targets
    /** @type {Array<{time:string, weekday:number, sat:number, sun:number}>} */
    let genSlots = [];
    let genSpareLines = 0;      // whole LINES that are spare weeks (v19.58) — not a per-day count

    // Multi-design state
    /** @type {Array<{id:string, name:string, patterns:Object, window?:*, updatedAt:*, updatedBy:string}>} */
    let designs         = [];
    /** @type {any} */ let activeDesignId  = null; // null = design not yet saved to Firestore
    /** Deleted designs, newest first — the "Recently deleted" bin (v19.41). Held in memory with
     *  their patterns so a restore is a field-clearing merge, never a re-upload of a stale copy.
     *  @type {Array<{id:string, name:string, patterns:Object, window?:*, deletedAt:*, deletedBy:string}>} */
    let deletedDesigns  = [];

    // Read-only analysis panels (Coverage heat map + Design quality checks) — extracted to
    // links-analysis.js (v17.70). They read only the live active design, via this getter.
    /**
     * The CURRENT link's fatigue profile, for comparison (v19.46).
     *
     * Computed over each REAL rotation at its OWN length — the main cycle is 20 lines and the
     * bilingual 8 — never spliced into one 28. Concatenating two unrelated rotations reports a
     * longest run of 19 days, which is a property of the join rather than of either roster; the
     * per-cycle answers are 15 and 14. A proposal reporting "15 consecutive shifts" reads very
     * differently once you know that is also where today's link sits.
     */
    function currentLinkBaseline() {
        try {
            const toPatterns = (/** @type {any} */ cycle) => {
                /** @type {Record<string, any>} */ const p = {}; let i = 1;
                for (const k of Object.keys(cycle)) p[String(i++)] = cycle[k];
                return { p, lines: i - 1 };
            };
            const main = toPatterns(weeklyRoster);
            const bl   = toPatterns(bilingualRoster);
            const a = assessFatigue(main.p, main.lines);
            const b = assessFatigue(bl.p, bl.lines);
            const pick = (/** @type {any} */ r, /** @type {string} */ code) =>
                r.results.find((/** @type {any} */ x) => x.code === code && x.status !== 'n/a');
            const ff11a = pick(a, 'FF11'), ff11b = pick(b, 'FF11');
            const ff15a = pick(a, 'FF15');
            return {
                summary: `Today's link already features ${a.present} of these factors on the main ${main.lines}-line cycle`
                    + ` and ${b.present} on the ${bl.lines}-line bilingual cycle.`,
                detail: `Longest run without a 48h break: ${ff11a?.value} (main) and ${ff11b?.value} (bilingual), against FF11's 13.`
                    + ` Longest run of consecutive early starts: ${ff15a?.value} (main), against FF15's 4.`
                    + ` Measured per cycle at its own length, not spliced into one rotation.`,
            };
        } catch (err) {
            console.warn('[Links] Baseline unavailable:', err);
            return null;   // the panel simply omits the comparison rather than showing a wrong one
        }
    }

    /**
     * The staffed-window editor on the Coverage card (v19.54).
     *
     * Edits mark the design DIRTY like any cell edit — the window is part of the proposal, not a
     * view preference — so it saves with everything else and travels with the design.
     *
     * An invalid pair (finish at or before start, or a cleared field) is REFUSED rather than
     * silently coerced: coercing would hand the designer a window they did not choose and then
     * print it on the sheet as though they had.
     */
    function initWindowEditor() {
        const box = /** @type {HTMLElement|null} */ (document.getElementById('windowEditor'));
        if (!box) return () => {};
        const els = {
            monSat: { start: /** @type {HTMLInputElement|null} */ (document.getElementById('winMonSatStart')),
                      end:   /** @type {HTMLInputElement|null} */ (document.getElementById('winMonSatEnd')) },
            sun:    { start: /** @type {HTMLInputElement|null} */ (document.getElementById('winSunStart')),
                      end:   /** @type {HTMLInputElement|null} */ (document.getElementById('winSunEnd')) },
        };
        const status = document.getElementById('winStatus');
        const moved  = /** @type {HTMLElement|null} */ (document.getElementById('winMoved'));
        const reset  = document.getElementById('winReset');

        function paint() {
            if (!box) return;
            box.hidden = !design;
            if (!design) return;
            const w = normaliseWindow(design.window);
            for (const row of /** @type {const} */ (['monSat', 'sun'])) {
                if (els[row].start) els[row].start.value = w[row].start;
                if (els[row].end)   els[row].end.value   = w[row].end;
            }
            // The moved flag sits in the EYEBROW row beside the "Staffed window" label, where it
            // qualifies the fields it describes. `.win-status` below is for a REFUSAL only.
            if (moved) moved.hidden = isDefaultWindow(w);
            if (status) status.textContent = '';
        }

        /** @param {'monSat'|'sun'} row */
        function commit(row) {
            if (!design) return;
            // Pad what was typed — "6:20" and "06:20" are the same instruction, and the stored
            // value must be the one canonical form the rest of the workspace reads.
            const start = canonicaliseWindowTime(els[row].start?.value) || '';
            const end   = canonicaliseWindowTime(els[row].end?.value) || '';
            const candidate = { start, end };
            if (!isValidWindowRow(candidate)) {
                // Put the stored value back so the field never sits showing something that is not
                // in force, and say why — a silently reverted input reads as the app losing input.
                // ORDER MATTERS: paint() rewrites `status` from the stored window, so the message
                // has to be written AFTER it or it is wiped in the same tick and the field appears
                // to revert for no reason at all.
                paint();
                if (status) status.textContent = 'A finish must be after its start — that change wasn’t applied.';
                return;
            }
            const next = normaliseWindow(design.window);
            if (next[row].start === start && next[row].end === end) return;
            next[row] = candidate;
            design = { ...design, window: next };
            dirty = true;
            updateSaveBtn();
            renderCoverageCard();   // repaints the editor, so the moved flag follows the change
        }

        for (const row of /** @type {const} */ (['monSat', 'sun'])) {
            els[row].start?.addEventListener('change', () => commit(row));
            els[row].end?.addEventListener('change', () => commit(row));
        }
        reset?.addEventListener('click', () => {
            if (!design) return;
            if (isDefaultWindow(design.window)) return;
            design = { ...design, window: normaliseWindow(null) };
            dirty = true;
            updateSaveBtn();
            renderCoverageCard();   // repaints the editor too — no separate paint() needed
        });
        return paint;
    }

    /** @type {() => void} */ let paintWindowEditor = () => {};
    /**
     * Render the whole Coverage CARD — the heat map AND the staffed-window editor above it.
     *
     * ONE call, because they are one card and every call site would otherwise have to remember
     * both. It did not: the generator (the only way to create a design) refreshed the chart via
     * renderGrid but never painted the editor, so the very first design a designer made had no
     * visible window control until they reloaded.
     */
    // The Coverage CARD is chart + window editor + the sticky summary strip in the grid card above
    // it — one call, because as separate calls every site had to remember all three, and the
    // generator (the only way to create a design) already proved that does not happen (v19.55).
    function renderCoverageCard() { renderCoverageChart(); paintWindowEditor(); renderSummary(); }
    const { renderCoverageChart, renderDesignChecks, renderSummary } = initLinksAnalysis({
        getDesign: () => design,
        getBaseline: currentLinkBaseline,
    });
    paintWindowEditor = initWindowEditor();

    // ============================================
    // HELPERS
    // ============================================

    /**
     * Compact two-line label for a shift button: "06:20\n14:20" or "RD" / "SP".
     * @param {any} shift
     */
    function shiftLabel(shift) {
        if (!shift || shift === 'RD' || shift === 'OFF') return 'RD';
        if (shift === 'SPARE') return 'SP';
        const dash = shift.indexOf('-');
        return dash > 0 ? `${shift.slice(0, dash)}\n${shift.slice(dash + 1)}` : shift;
    }

    /** All-RD pattern — a starting blank for an as-yet-undesigned line. */
    const emptyPattern = () => Object.fromEntries(DAYS.map(d => [d, 'RD']));

    /** An all-rest line is "not yet designed" — flagged amber, not muted. */
    const isUnfilledPattern = (/** @type {any} */ p) => DAYS.every(d => {
        const s = p?.[d] ?? 'RD';
        return s === 'RD' || s === 'OFF';
    });

    /**
     * Deep-copy a patterns object so edits don't mutate the designs array.
     * @param {any} patterns
     */
    function deepCopyPatterns(patterns) {
        const copy = /** @type {Record<string, any>} */ ({});
        for (const [k, v] of Object.entries(patterns || {})) copy[k] = { ...(/** @type {any} */ (v)) };
        return copy;
    }

    /**
     * Shared HTML options for any shift dropdown.
     * @param {string|null} currentVal — currently selected value
     * @param {boolean} includeRdSpare — true for cell-edit dropdowns, false for generator time selects
     * CEAs do not work night shifts — night times are never offered here.
     * normaliseCustomShift() also rejects starts between 21:00 and 03:59.
     */
    function buildShiftOptions(currentVal, includeRdSpare = false) {
        const opt = (/** @type {any} */ val, /** @type {any} */ label) => {
            const sel = val === currentVal ? ' selected' : '';
            return `<option value="${escapeHtml(val)}"${sel}>${escapeHtml(label)}</option>`;
        };
        const known = new Set([...EARLY_SHIFTS, ...LATE_SHIFTS]);
        const isUnknown = currentVal && currentVal !== 'RD' && currentVal !== 'SPARE' && !known.has(currentVal);
        return [
            ...(includeRdSpare ? [opt('RD', 'RD — Rest Day'), opt('SPARE', 'SPARE — Standby')] : []),
            ...(isUnknown ? (includeRdSpare
                ? ['<optgroup label="Current">', opt(currentVal, `${currentVal} (current)`), '</optgroup>']
                : [opt(currentVal, currentVal)]) : []),
            ...(EARLY_SHIFTS.length ? [
                `<optgroup label="Early${includeRdSpare ? ' (starting before 11:00)' : ''}">`,
                ...EARLY_SHIFTS.map(s => opt(s, s)), '</optgroup>',
            ] : []),
            ...(LATE_SHIFTS.length ? [
                `<optgroup label="Late${includeRdSpare ? ' (starting 11:00 or after)' : ''}">`,
                ...LATE_SHIFTS.map(s => opt(s, s)), '</optgroup>',
            ] : []),
            opt('__custom__', 'Custom time…'),
        ].join('');
    }

    // Compare mode — extracted to links-compare.js (v17.71). It OWNS compareMode/compareDesignId
    // (single source of truth); the coordinator only reads them (compare.isCompareMode/getCompareId)
    // or resets them (compare.resetCompare). Placed after emptyPattern/isUnfilledPattern (const
    // arrows) so those injected deps exist; the render deps are hoisted function declarations.
    const compare = initLinksCompare({
        getDesigns: () => designs, getActiveDesignId: () => activeDesignId, getDesign: () => design,
        renderDesignPicker, renderGrid, renderBrushBar, dearmBrush, emptyPattern, isUnfilledPattern, shiftLabel,
    });

    // ============================================
    // DESIGN MANAGEMENT
    // ============================================

    /** Wire design picker buttons — called once on page load. */
    function initDesignPicker() {
        // Delegated clicks on the main chips container
        document.getElementById('designChips')?.addEventListener('click', e => {
            const t = /** @type {Element} */ (e.target);
            const renameBtn = /** @type {HTMLElement|null} */ (t.closest('.design-chip-rename'));
            const deleteBtn = /** @type {HTMLElement|null} */ (t.closest('.design-chip-delete'));
            const nameBtn   = /** @type {HTMLElement|null} */ (t.closest('.design-chip-name'));
            if (renameBtn)      renameDesign(renameBtn.dataset.id);
            else if (deleteBtn) deleteDesign(deleteBtn.dataset.id);
            else if (nameBtn)   selectDesign(nameBtn.dataset.id);
        });
        // Delegated clicks on compare chips
        document.getElementById('compareChips')?.addEventListener('click', e => {
            const nameBtn = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.design-chip-name'));
            if (nameBtn) compare.selectCompareDesign(nameBtn.dataset.id);
        });
        document.getElementById('newDesignBtn')?.addEventListener('click',     createDesign);
        // The empty state's two actions (v19.66). They do not duplicate any behaviour — the blank
        // one calls the SAME `createDesign` the picker's "+ New" does, and the primary one only
        // scrolls, because generating needs targets the designer has to look at first. Offering
        // "Generate" straight from an empty card would fire the generator against whatever the
        // roster seed happened to produce, which is a design nobody chose.
        document.getElementById('linksEmptyNew')?.addEventListener('click',    createDesign);
        document.getElementById('linksEmptyGenerate')?.addEventListener('click', () => {
            _openGenerator();
            document.getElementById('generatorCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        document.getElementById('dupDesignBtn')?.addEventListener('click',     duplicateDesign);
        document.getElementById('compareBtn')?.addEventListener('click',       compare.toggleCompareMode);
    }
    initDesignPicker();

    /** Rebuild the design picker HTML from the current state. */
    function renderDesignPicker() {
        const wrap           = document.getElementById('designPickerWrap');
        const chipsEl        = document.getElementById('designChips');
        const compareChipsEl = document.getElementById('compareChips');
        const comparePickerRow = document.getElementById('comparePickerRow');
        const compareBtn     = /** @type {HTMLButtonElement|null} */ (document.getElementById('compareBtn'));
        const dupBtn         = /** @type {HTMLButtonElement|null} */ (document.getElementById('dupDesignBtn'));
        if (!wrap) return;

        // The picker strip is ALWAYS shown (v19.43). It used to appear only once a design existed,
        // which contradicted the empty state's own instruction — "tap + New for a blank canvas"
        // pointed at a button inside this very wrapper, so on a first visit the message named a
        // control that was not on the page. It also hid the bin: "Recently deleted" lives here
        // too, and zero live designs with a full bin is exactly when restore matters most (v19.41).
        // Duplicate and Compare disable themselves when they have nothing to act on, so an empty
        // strip is honest rather than misleading.
        wrap.style.display = '';

        // Render main design chips. A chip is a <div> wrapping separate <button>s —
        // buttons must NOT nest (the HTML parser force-closes an open <button> when
        // another one starts, which silently breaks the markup).
        // Recently-deleted button: present only when the bin has something in it, so the workspace
        // gains no permanent extra control for a feature most sessions never touch.
        const binBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('designBinBtn'));
        if (binBtn) {
            binBtn.style.display = deletedDesigns.length > 0 ? '' : 'none';
            binBtn.textContent   = `🗑 Recently deleted (${deletedDesigns.length})`;
        }

        if (chipsEl) {
            const canDelete = canSoftDelete(designs.length);
            chipsEl.innerHTML = designs.map(d => {
                const isActive = d.id === activeDesignId;
                const actions = isActive
                    ? `<button class="design-chip-rename" data-id="${escapeHtml(d.id)}" type="button" ` +
                      `title="Rename" aria-label="Rename ${escapeHtml(d.name)}">✎</button>` +
                      `<button class="design-chip-delete" data-id="${escapeHtml(d.id)}" type="button" ` +
                      `title="Delete" aria-label="Delete ${escapeHtml(d.name)}"` +
                      `${canDelete ? '' : ' disabled'}>✕</button>`
                    : '';
                return `<div class="design-chip${isActive ? ' design-chip--active' : ''}">` +
                    `<button class="design-chip-name" data-id="${escapeHtml(d.id)}" type="button"` +
                    `${isActive ? ' aria-current="true"' : ''}>${escapeHtml(d.name)}</button>${actions}</div>`;
            }).join('');
        }

        // Print-only masthead. It named the design and nothing else, which left a printed sheet
        // with no way to tell WHICH version of that design you were holding (v19.45) — and the
        // save row that carries "last saved by X at HH:MM" is hidden in print, so the provenance
        // existed on screen and was dropped on paper. A link design is circulated for comment and
        // revised repeatedly; an undated copy is the one thing it must not be.
        _renderPrintMasthead();

        // Duplicate button state
        if (dupBtn) dupBtn.disabled = !activeDesignId;

        // Compare button state (compare state is owned by links-compare.js)
        const cmpMode = compare.isCompareMode();
        const cmpId   = compare.getCompareId();
        if (compareBtn) {
            compareBtn.disabled = designs.length < 2;
            compareBtn.classList.toggle('compare-active', cmpMode);
            compareBtn.setAttribute('aria-pressed', cmpMode ? 'true' : 'false');
        }

        // Compare picker row
        if (comparePickerRow) comparePickerRow.style.display = cmpMode ? '' : 'none';
        if (cmpMode && compareChipsEl) {
            compareChipsEl.innerHTML = designs
                .filter(d => d.id !== activeDesignId)
                .map(d => {
                    const isActive = d.id === cmpId;
                    return `<div class="design-chip${isActive ? ' design-chip--active' : ''}">` +
                        `<button class="design-chip-name" data-id="${escapeHtml(d.id)}" type="button">` +
                        `${escapeHtml(d.name)}</button></div>`;
                }).join('');
        }
    }

    // The Firestore rule (v17.02) rejects a design `name` longer than 100 chars, and these flows
    // used prompt() with no cap — an over-long name threw straight into `catch { console.error }`
    // with NO user feedback, so the create/rename appeared to silently do nothing (whole-codebase
    // review, links finding #4). Cap client-side, and surface any write failure on the save-status line.
    const MAX_DESIGN_NAME = 100;

    /** Surface a design create/rename/duplicate outcome (or a client-side validation error) on the
     *  shared save-status line, so a rules rejection is never silent. @param {string} msg @param {'ok'|'err'} [kind] */
    function _designActionStatus(msg, kind = 'err') {
        const status = document.getElementById('linksSaveStatus');
        if (status) { status.textContent = msg; status.className = 'links-save-status ' + kind; }
    }

    /** Validate a user-entered design name against the Firestore rule's 1–100 char bound.
     *  Returns true (and shows an error) when the name is too long. @param {string} name */
    function _designNameTooLong(name) {
        if (name.length <= MAX_DESIGN_NAME) return false;
        _designActionStatus(`That name is too long (max ${MAX_DESIGN_NAME} characters). Please shorten it.`);
        return true;
    }

    /** Create a new blank design. */
    async function createDesign() {
        // Ask about unsaved work FIRST (v19.38). This used to run after the name prompt, so you typed
        // a name and were only then asked whether to abandon your changes — the decision that might
        // cancel the whole action came last.
        if (dirty && !await confirmDialog({ message: 'You have unsaved changes in the current design. Create a new one anyway?', confirmLabel: 'Create new' })) return;
        const name = (await promptDialog({ title: 'New design', message: 'Name for this design (e.g. "Option A"):', placeholder: 'Option A', maxLength: 100, confirmLabel: 'Create' }))?.trim();
        if (!name) return;
        if (_designNameTooLong(name)) return;
        try {
            const ref = await writeWithClaimRetry(() => addDoc(DESIGNS_COL, {
                name,
                patterns:  {},
                window:    normaliseWindow(null),   // a blank design starts on the app default
                updatedAt: serverTimestamp(),
                updatedBy: currentUser,
            }));
            // Arm the concurrency baseline: read back the server updatedAt so loadedUpdatedAt
            // is non-null from the first content-save. Without this, a just-created design's
            // guard was bypassed (updatedAt:null) and a concurrent edit was silently clobbered.
            let createdTs = null;
            try { createdTs = (await getDoc(ref)).data()?.updatedAt ?? null; } catch { /* offline — no concurrent editor to guard */ }
            const d = { id: ref.id, name, patterns: {}, window: normaliseWindow(null), updatedAt: createdTs, updatedBy: currentUser };
            designs.push(d);
            _sortDesigns();
            _activateDesign(d);
        } catch (err) {
            console.error('[Links] Create design failed:', err);
            _designActionStatus('Couldn’t create the design — check your connection and try again.');
        }
    }

    /** Duplicate the current design as a new named design.
     * Copies the LIVE in-memory patterns, so unsaved edits are included —
     * "duplicate what I'm looking at", not "duplicate the last save". */
    async function duplicateDesign() {
        if (!activeDesignId || !design) return;
        const name = (await promptDialog({ title: 'Duplicate design', message: 'Name for the duplicate:', defaultValue: `${design.name || 'Design'} copy`, maxLength: 100, confirmLabel: 'Duplicate' }))?.trim();
        if (!name) return;
        if (_designNameTooLong(name)) return;
        const patterns = deepCopyPatterns(design.patterns);
        // A duplicate inherits the window it was designed to. Copying the patterns alone would
        // silently re-base the copy on the standard hours, which is the one thing a designer
        // duplicating a moved-boundary proposal is least likely to notice.
        const window = normaliseWindow(design.window);
        try {
            const ref = await writeWithClaimRetry(() => addDoc(DESIGNS_COL, {
                name,
                patterns,
                window,
                updatedAt: serverTimestamp(),
                updatedBy: currentUser,
            }));
            // Arm the concurrency baseline (see createDesign).
            let dupTs = null;
            try { dupTs = (await getDoc(ref)).data()?.updatedAt ?? null; } catch { /* offline */ }
            const d = { id: ref.id, name, patterns, window, updatedAt: dupTs, updatedBy: currentUser };
            designs.push(d);
            _sortDesigns();
            _activateDesign(d);
        } catch (err) {
            console.error('[Links] Duplicate design failed:', err);
            _designActionStatus('Couldn’t duplicate the design — check your connection and try again.');
        }
    }

    /** Keep `designs` in the same alpha order loadDesigns applies, so in-session
     *  create / duplicate / rename don't drift the picker + compare-chip order vs a fresh
     *  reload (they used to push to the end and only re-sort on reload). (v16.19) */
    function _sortDesigns() {
        designs.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    }

    /**
     * Rename an existing design.
     * @param {any} id
     */
    async function renameDesign(id) {
        const d = designs.find(x => x.id === id);
        if (!d) return;
        const name = (await promptDialog({ title: 'Rename design', message: 'New name:', defaultValue: d.name, maxLength: 100, confirmLabel: 'Rename' }))?.trim();
        if (!name || name === d.name) return;
        if (_designNameTooLong(name)) return;
        try {
            // Bump updatedAt/updatedBy too (was name-only): otherwise a rename was invisible to the
            // concurrency guard — a co-editor's loadedUpdatedAt stayed unchanged, so their next save
            // wrote their stale cached name and silently REVERTED the rename with no prompt (v16.19).
            //
            // BUT advance our local baseline ONLY when nobody else saved since we loaded (v16.23).
            // Pre-read the doc BEFORE the rename write: if its updatedAt already differs from our
            // baseline, a co-editor's save landed in between — blindly advancing the baseline to
            // OUR rename's timestamp made the next saveChanges skip the "X saved a different
            // version" confirm and silently overwrite their patterns with our stale copy. On
            // mismatch (or an offline pre-read) the baseline stays put, so the next save prompts.
            let baselineFresh = false;
            const _preBaseline = (id === activeDesignId) ? loadedUpdatedAt : (d.updatedAt?.toMillis?.() ?? null);
            try {
                const preTs = (await getDoc(doc(db, COLLECTIONS.linkDesigns, id))).data()?.updatedAt?.toMillis?.() ?? null;
                baselineFresh = canAdvanceBaseline(preTs, _preBaseline);
            } catch { baselineFresh = canAdvanceBaseline(null, _preBaseline, false); }
            await writeWithClaimRetry(() => setDoc(doc(db, COLLECTIONS.linkDesigns, id),
                { name, updatedAt: serverTimestamp(), updatedBy: currentUser }, { merge: true }));
            d.name = name;
            if (id === activeDesignId && design) design.name = name;
            if (baselineFresh) {
                d.updatedBy = currentUser;
                try { d.updatedAt = (await getDoc(doc(db, COLLECTIONS.linkDesigns, id))).data()?.updatedAt ?? d.updatedAt; }
                catch { /* offline — baseline stays as-is */ }
                if (id === activeDesignId) {
                    loadedUpdatedAt = d.updatedAt?.toMillis?.() ?? loadedUpdatedAt;
                    updateLastSaved(d.updatedBy, d.updatedAt);
                }
            }
            _sortDesigns();
            renderDesignPicker();
            // The rename write succeeded — clear any stale "couldn't rename" error a PRIOR failed attempt
            // left on the shared save-status line (createDesign/duplicate clear it via _activateDesign;
            // rename doesn't reactivate, so it must clear its own). No positive text — a rename is quiet.
            const _renameStatus = document.getElementById('linksSaveStatus');
            if (_renameStatus) { _renameStatus.textContent = ''; _renameStatus.className = 'links-save-status'; }
        } catch (err) {
            console.error('[Links] Rename failed:', err);
            _designActionStatus('Couldn’t rename the design — check your connection and try again.');
        }
    }

    /**
     * Delete a design — a SOFT delete since v19.41: it moves to "Recently deleted" for
     * SOFT_DELETE_RETENTION_DAYS and can be restored, instead of being destroyed on the spot.
     * The last LIVE design can't be deleted — the ✕ button is disabled in that state, so this
     * guard is just a backstop.
     * @param {any} id
     */
    async function deleteDesign(id) {
        if (!canSoftDelete(designs.length)) return;
        const d = designs.find(x => x.id === id);
        if (!d) return;
        if (!await confirmDialog({
            title: 'Delete design',
            message: `Delete "${d.name}"?\n\nIt moves to Recently deleted, where you can restore it for the next ${SOFT_DELETE_RETENTION_DAYS} days.`,
            confirmLabel: 'Delete',
            danger: true,
        })) return;
        try {
            // A merge write, not a replace: the patterns we hold could be a stale copy of a
            // co-designer's newer version, and deleting is not a reason to overwrite them.
            await writeWithClaimRetry(() => setDoc(doc(db, COLLECTIONS.linkDesigns, id),
                { deletedAt: serverTimestamp(), deletedBy: currentUser }, { merge: true }));
            designs = designs.filter(x => x.id !== id);
            // deletedAt is null until the server resolves it — deliberately kept as null rather
            // than stamped with a client clock, so the row reads "Deleted by X" until the real
            // time is known instead of showing a countdown built from an invented figure.
            deletedDesigns.unshift({ id: d.id, name: d.name, patterns: d.patterns, window: normaliseWindow(d.window), deletedAt: null, deletedBy: currentUser });
            const newActive = (id === activeDesignId) ? designs[0] : null;
            // Exit compare mode if the compare target was deleted, the delete drops below the 2
            // designs compare needs, OR the newly-promoted active design IS the current compare
            // target — otherwise a design would be compared against ITSELF (every cell "identical",
            // its compare chip filtered out) until the user manually toggles compare off. Deleting
            // the ACTIVE design while comparing also used to leave a <2-design self-compare soft-lock.
            const cmpId = compare.getCompareId();
            if (id === cmpId || designs.length < 2 || (newActive && newActive.id === cmpId)) {
                compare.resetCompare();
            }
            if (newActive) _activateDesign(newActive);
            else { renderDesignPicker(); renderGrid(); compare.renderCompare(); }
        } catch (err) {
            console.error('[Links] Delete failed:', err);
            // Was console-only: a rules rejection or a dropped connection looked like the button
            // simply doing nothing. Every other design action surfaces here (v19.41).
            _designActionStatus('Couldn’t delete the design — check your connection and try again.');
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
        const d = deletedDesigns.find(x => x.id === id);
        if (!d) return;
        try {
            await writeWithClaimRetry(() => setDoc(doc(db, COLLECTIONS.linkDesigns, id), {
                deletedAt: deleteField(), deletedBy: deleteField(),
                updatedAt: serverTimestamp(), updatedBy: currentUser,
            }, { merge: true }));
            deletedDesigns = deletedDesigns.filter(x => x.id !== id);
            // Arm the concurrency baseline by reading the server timestamp back, exactly as
            // createDesign/duplicateDesign do. A restored design is an OLD document a co-editor may
            // still hold, so entering it with no baseline is worse here than for a new one: the
            // next save would skip the "someone else saved" confirm entirely. On a failed read-back
            // the entry keeps a null timestamp, which _activateDesign now correctly reads as an
            // UNKNOWN baseline (guard on) rather than "nothing to compare" (guard off).
            let restoredTs = null;
            try { restoredTs = (await getDoc(doc(db, COLLECTIONS.linkDesigns, id))).data()?.updatedAt ?? null; }
            catch { /* offline — the unknown-baseline flag covers it */ }
            designs.push({ id: d.id, name: d.name, patterns: d.patterns, window: normaliseWindow(d.window), updatedAt: restoredTs, updatedBy: currentUser });
            _sortDesigns();
            renderDesignPicker();
            renderBinList();
            _binStatus(`“${d.name}” restored.`, 'ok');
        } catch (err) {
            console.error('[Links] Restore failed:', err);
            _binStatus('Couldn’t restore that design — check your connection and try again.');
        }
    }

    /**
     * Remove a deleted design for good (the only hard delete left in the workspace).
     * @param {any} id
     */
    async function purgeDesign(id) {
        const d = deletedDesigns.find(x => x.id === id);
        if (!d) return;
        if (!await confirmDialog({
            title: 'Remove for good',
            message: `Permanently remove "${d.name}"?\n\nThis one can't be undone.`,
            confirmLabel: 'Remove for good',
            danger: true,
        })) return;
        try {
            // RE-CHECK ON THE SERVER, INSIDE A TRANSACTION (v19.84, external review P1).
            //
            // This used to be a bare `deleteDoc` on the strength of `deletedDesigns` — the list
            // loaded when the bin was opened. `purgeExpiredDeletions` below has carried a long
            // comment for several versions explaining why that is unsafe, and this path, which is
            // the more dangerous of the two, ignored it: a human pressing a button on a stale row
            // is far likelier than an expiry sweep landing in the same window.
            //
            // The race is real in a workspace built for several designers. A opens the bin, B
            // restores "Old idea", A's row is now stale, A presses Remove for good — and a LIVE
            // design that someone deliberately rescued is destroyed with no undo. Firestore runs
            // here with persistentLocalCache, so A's snapshot can also simply be an old read
            // served from IndexedDB.
            //
            // Reading inside the transaction makes the decision and the deletion inseparable.
            // Offline it fails and nothing is destroyed, which is the right way for a permanent
            // delete to fail.
            const ref = doc(db, COLLECTIONS.linkDesigns, id);
            await writeWithClaimRetry(() => runTransaction(db, async (/** @type {any} */ tx) => {
                const snap = await tx.get(ref);
                if (!snap.exists()) return;                    // already gone — nothing to do
                if (!isDeleted(snap.data())) throw new Error('design-restored');
                tx.delete(ref);
            }));
            deletedDesigns = deletedDesigns.filter(x => x.id !== id);
            renderDesignPicker();
            renderBinList();
            _binStatus(`“${d.name}” removed.`, 'ok');
        } catch (err) {
            if (err instanceof Error && err.message === 'design-restored') {
                // Say what happened rather than "couldn't remove": someone put it back on purpose,
                // and the right next step is to look at it again, not to retry.
                deletedDesigns = deletedDesigns.filter(x => x.id !== id);
                renderBinList();
                await loadDesigns();
                _binStatus(`“${d.name}” was restored by someone else, so it was not removed.`);
                return;
            }
            console.error('[Links] Permanent delete failed:', err);
            _binStatus('Couldn’t remove that design — check your connection and try again.');
        }
    }

    /** Rebuild the Recently-deleted list. */
    function renderBinList() {
        const list = document.getElementById('designBinList');
        if (!list) return;
        if (deletedDesigns.length === 0) {
            list.innerHTML = '<p class="bin-empty">Nothing here. Deleted designs appear in this list.</p>';
            return;
        }
        const now = Date.now();
        list.innerHTML = deletedDesigns.map(d => {
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
        document.getElementById('designBinBtn')?.addEventListener('click', () => lb.open());
        document.getElementById('designBinList')?.addEventListener('click', e => {
            const t = /** @type {Element} */ (e.target);
            const restore = /** @type {HTMLElement|null} */ (t.closest('.bin-restore'));
            const purge   = /** @type {HTMLElement|null} */ (t.closest('.bin-purge'));
            if (restore)    restoreDesign(restore.dataset.id);
            else if (purge) purgeDesign(purge.dataset.id);
        });
    }
    initDesignBin();

    /**
     * Remove deleted designs that have aged out of the recovery window.
     *
     * Fire-and-forget on load, following the same client-side pruning pattern the circular /
     * newsletter / analytics sweeps use. The decision itself is `purgeableIds` in
     * links-deletion.js, which fails closed on an unresolved or future `deletedAt` — this runs on
     * whatever the device thinks the time is, so it must never treat "I can't tell how old this
     * is" as "old enough to destroy".
     *
     * ⚠️ NOT WIRED UP since v19.86 (external review P2) — hence the underscore. It is kept, rather
     * than deleted, because the transactional re-check below is the hard-won part and a server-time
     * expiry will want it verbatim. What is missing is only the CLOCK: a device running more than
     * 30 days fast makes every recent deletion look expired, and this function would then agree
     * with itself and destroy a colleague's design. Re-enable only once the age comes from the
     * server (a scheduled Cloud Function), never by restoring the call site.
     */
    function _purgeExpiredDeletions() {
        const ids = purgeableIds(deletedDesigns, Date.now());
        if (ids.length === 0) return;
        deletedDesigns = deletedDesigns.filter(d => !ids.includes(d.id));
        for (const id of ids) {
            const ref = doc(db, COLLECTIONS.linkDesigns, id);
            // Re-check inside a TRANSACTION rather than deleting on the strength of the load
            // snapshot. That snapshot is not necessarily current: this app runs Firestore with
            // persistentLocalCache, so a load made offline (or during a blip) is served from
            // IndexedDB and can be arbitrarily stale — it could show a design as deleted-and-expired
            // that a colleague restored days ago, and the queued delete would then destroy a LIVE
            // design. A transaction reads from the server and commits atomically, so the decision
            // and the deletion cannot be separated by someone else's restore. Offline it simply
            // fails and nothing is destroyed, which is the right way for this one to fail.
            writeWithClaimRetry(() => runTransaction(db, async (/** @type {any} */ tx) => {
                const snap = await tx.get(ref);
                if (!snap.exists()) return;                          // already gone
                if (!isPurgeable(snap.data(), Date.now())) return;   // restored, or not actually expired
                tx.delete(ref);
            })).catch(err => console.warn('[Links] Purge of an expired deletion failed (will retry next load):', err));
        }
    }

    /**
     * Switch the active design. Warns if dirty.
     * @param {any} id
     */
    async function selectDesign(id) {
        if (id === activeDesignId) return;
        if (dirty && !await confirmDialog({ message: 'You have unsaved changes. Switch to another design? Changes will be lost.', confirmLabel: 'Switch' })) return;
        const d = designs.find(x => x.id === id);
        if (!d) return;
        // If selecting the current compare target, exit compare mode first
        if (id === compare.getCompareId()) compare.resetCompare();
        _activateDesign(d);
    }

    /**
     * Internal: set a design as active and refresh all UI.
     * @param {any} d
     */
    function _activateDesign(d) {
        if (!d) return;
        activeDesignId  = d.id;
        lsSet(ACTIVE_KEY, d.id);
        design          = { id: d.id, name: d.name, patterns: deepCopyPatterns(d.patterns), window: normaliseWindow(d.window) };
        // Derive the baseline through the tested rule rather than hardcoding `baselineUnknown =
        // false` beside a possibly-null timestamp — that pair is precisely the v17.18 bug
        // (neither a known baseline nor a flag saying it is unknown, so conflictOf reads it as
        // "safe to overwrite"). It was harmless while every entry came from the server snapshot or
        // from create/duplicate, both of which arm a real timestamp; v19.41's RESTORE added a third
        // producer whose entry can carry null, and selecting it then switched the guard off.
        ({ loadedUpdatedAt, baselineUnknown } = baselineAfterWrite(d.updatedAt?.toMillis?.()));
        dirty           = false;
        // Clear a prior design's "✓ Saved" / "Save failed" status — updateSaveBtn only clears it
        // while dirty, so without this it carried over to the newly selected design, falsely
        // implying that design's save state (v16.19).
        const _switchStatus = document.getElementById('linksSaveStatus');
        if (_switchStatus) _switchStatus.textContent = '';
        dearmBrush();
        renderDesignPicker();
        renderGrid();
        renderBrushBar();
        renderDesignChecks();
        renderCoverageCard();
        paintWindowEditor();
        compare.renderCompare();
        updateSaveBtn();
        updateLastSaved(d.updatedBy, d.updatedAt);
        refreshGenTargetsForDesign();   // targets are per design (v19.38)
    }

    // COMPARE MODE was extracted to links-compare.js (v17.71); wired via `compare` above.

    // ============================================
    // PAINT BRUSH
    // ============================================

    /** @param {any} shift */
    function armBrush(shift) {
        brush = shift;
        document.querySelectorAll('.brush-chip').forEach(c => {
            const on = /** @type {HTMLElement} */ (c).dataset.shift === shift;
            c.classList.toggle('brush-chip--active', on);
            c.setAttribute('aria-pressed', String(on));
        });
    }

    function dearmBrush() {
        brush = null;
        document.querySelectorAll('.brush-chip').forEach(c => {
            c.classList.remove('brush-chip--active');
            c.setAttribute('aria-pressed', 'false');
        });
    }

    function renderBrushBar() {
        const bar = document.getElementById('brushBar');
        if (!bar) return;
        if (!design || compare.isCompareMode()) { bar.style.display = 'none'; return; }
        bar.style.display = '';

        // The chip shows BOTH times, on two lines, exactly as the grid cell it paints does
        // (v19.43). It used to show the start only — and the roster has five distinct shifts
        // starting 06:20, three starting 08:00, and so on, so the bar rendered as seven pairs of
        // visually IDENTICAL chips that paint different shifts. The start time also went into the
        // title and aria-label, so nothing anywhere disambiguated them: the only way to tell which
        // 06:20 you had armed was to paint a cell and read the result.
        const spoken = (/** @type {any} */ shift) => {
            const dash = String(shift).indexOf('-');
            return dash > 0 ? `${String(shift).slice(0, dash)} to ${String(shift).slice(dash + 1)}` : String(shift);
        };
        const chip = (/** @type {any} */ shift, /** @type {any} */ label, /** @type {any} */ typeClass, /** @type {any} */ extra = '', /** @type {any} */ spokenLabel = null) => {
            const say = spokenLabel ?? label;
            return `<button class="brush-chip type-${typeClass}${extra}" data-shift="${escapeHtml(shift)}" ` +
                `aria-pressed="false" aria-label="Paint: ${escapeHtml(say)}" title="${escapeHtml(say)}">${escapeHtml(label)}</button>`;
        };

        bar.innerHTML = [
            '<span class="brush-bar-label">Paint:</span>',
            chip('RD',    'RD',     'rd',    '', 'Rest day'),
            chip('SPARE', 'SP',     'spare', '', 'Spare'),
            ...EARLY_SHIFTS.map(s => chip(s, shiftLabel(s), 'early', '', spoken(s))),
            ...LATE_SHIFTS.map(s  => chip(s, shiftLabel(s), 'late',  '', spoken(s))),
            `<button class="brush-chip brush-chip--custom" data-shift="__custom__" aria-pressed="false" title="Custom time…">Custom…</button>`,
        ].join('');

        bar.querySelectorAll('.brush-chip').forEach(c => {
            c.addEventListener('click', async () => {
                let shift = /** @type {HTMLElement} */ (c).dataset.shift;
                if (shift === '__custom__') {
                    const typed = normaliseCustomShift(
                        await promptDialog({ title: 'Custom shift', message: 'Enter a shift time, e.g. 06:00-14:00 (start between 04:00 and 20:59):', placeholder: '06:00-14:00', confirmLabel: 'Set' }));
                    if (!typed) return;
                    shift = typed;
                }
                if (brush === shift) dearmBrush();
                else armBrush(shift);
            });
        });
    }

    // ============================================
    // GRID RENDERING
    // ============================================

    /**
     * Open the generator card programmatically, chevron and ARIA included.
     *
     * ONE implementation, because the two call sites had already drifted (found in the v19.70
     * regression pass). `initCardCollapse` only syncs `aria-expanded` on a real click, so anything
     * that opens the card in code has to do it by hand — the auto-expand in `renderGrid` did, and
     * the v19.66 empty-state button did not. Collapse the generator, then press "Go to
     * Auto-generate": the body opened while the chevron still pointed collapsed and a screen reader
     * was told `aria-expanded="false"` over an open card. Harmless on the default path only because
     * `renderGrid` has usually opened it already — which is exactly how the gap stayed invisible.
     */
    function _openGenerator() {
        const body    = document.getElementById('generatorBody');
        const chevron = document.getElementById('generatorChevron');
        if (body && !body.classList.contains('open')) body.classList.add('open');
        if (chevron) {
            chevron.classList.add('open');
            chevron.setAttribute('aria-expanded', 'true');
        }
    }

    /**
     * The grid card's header hint describes the GRID, which is not on screen in the empty state
     * (v19.66) — it told you to tap a shift cell and use the Paint bar when neither existed. Both
     * strings live here rather than in two render branches so they cannot drift apart.
     * @param {boolean} hasDesign
     */
    function _setGridHint(hasDesign) {
        const el = document.getElementById('linksGridHint');
        if (el) el.textContent = hasDesign
            ? 'Tap any shift cell to change it. Use the Paint bar to fill cells quickly. Save when done.'
            : 'A link is 28 lines — everyone works line 1 one week, line 2 the next, all the way round.';
    }

    function renderGrid() {
        const tbody      = document.getElementById('linksGridBodyRows');
        const tfoot      = document.getElementById('linksCoverageFoot');
        const wrapper    = document.getElementById('linksGridWrapper');
        const emptyState = document.getElementById('linksEmptyState');
        const saveRow    = document.getElementById('linksSaveRow');

        if (!design) {
            // renderGrid early-returns here, so renderCoverageCard — and with it renderSummary —
            // never runs on this path. The save row is hidden below, so a stale strip would not be
            // VISIBLE; it would still be wrong, and the next design to load would flash it. This is
            // the one place the summary needs asking for by name.
            renderSummary();
            // The empty state has a TITLE and ACTIONS as well as this sentence (v19.66), and a load
            // FAILURE is not the same state as "you have not made one yet" — offering "No designs
            // yet" to someone whose designs exist but did not load would be a lie, and inviting
            // them to generate a new one is how a connection blip turns into a duplicate design.
            const emptyMsg   = document.getElementById('linksEmptyMsg');
            const emptyTitle = document.querySelector('#linksEmptyState .links-empty-title');
            const emptyActs  = document.querySelector('#linksEmptyState .links-empty-actions');
            if (emptyTitle) emptyTitle.textContent = loadFailed ? 'Couldn’t load your designs' : 'No designs yet';
            if (emptyMsg) emptyMsg.innerHTML = loadFailed
                ? `Check your connection and refresh the page. Nothing has been lost — saved designs are on the server.`
                : `Build a rotating pattern from staffing targets with the Auto-generate card below, or start from an empty 28-line grid.`;
            if (emptyActs) /** @type {HTMLElement} */ (emptyActs).style.display = loadFailed ? 'none' : '';
            _setGridHint(false);
            if (wrapper)    wrapper.style.display    = 'none';
            if (emptyState) emptyState.style.display = '';
            if (saveRow)    saveRow.style.display    = 'none';
            if (tbody)      tbody.innerHTML          = '';
            if (tfoot)      tfoot.innerHTML          = '';
            document.body.classList.remove('links-compare-on');
            // Auto-expand the generator so the user sees it without having to discover it.
            // Shares `_openGenerator` with the empty state's button — see the note there for why
            // the ARIA sync has to be explicit, and what happened when only one site did it.
            if (!loadFailed) _openGenerator();
            renderBrushBar();
            renderCoverageCard();
            renderDesignChecks();
            return;
        }

        if (emptyState) emptyState.style.display = 'none';
        if (saveRow)    saveRow.style.display    = '';
        _setGridHint(true);

        // In compare mode the main grid is hidden on SCREEN ONLY (body class +
        // screen-scoped CSS) but stays fully rendered — print must always output
        // the active design, and an inline display:none would leak into print.
        if (wrapper) wrapper.style.display = '';
        document.body.classList.toggle('links-compare-on', compare.isCompareMode());

        const rows = [];
        for (let pos = 1; pos <= TOTAL_POS; pos++) {
            const posStr  = String(pos);
            const p        = (/** @type {Record<string, any>} */ (design.patterns))[posStr] || emptyPattern();
            const rowClass = isUnfilledPattern(p) ? 'row-unfilled' : '';

            const dayCells = DAYS.map((d, di) => {
                const shift = p[d] ?? 'RD';
                const type  = classifyShift(shift);
                const label = shiftLabel(shift);
                return `<td class="shift-cell">` +
                    `<button class="shift-cell-btn type-${type}" ` +
                    `data-pos="${posStr}" data-day="${d}" ` +
                    `aria-label="Line ${posStr} ${DAY_LABELS[di]}: ${escapeHtml(shift)}">` +
                    `${escapeHtml(label)}</button></td>`;
            }).join('');

            rows.push(
                `<tr class="${rowClass}" data-pos="${posStr}">` +
                `<td class="pos-num">${posStr}</td>` +
                dayCells +
                `</tr>`
            );
        }
        if (tbody) tbody.innerHTML = rows.join('');

        const cov = calcCoverage(design.patterns);
        renderFooter(cov);
        renderCoverageCard();
    }

    // Delegated grid events — one listener instead of one per cell button.
    (function wireGridEvents() {
        const tbody = document.getElementById('linksGridBodyRows');
        if (!tbody) return;

        tbody.addEventListener('click', e => {
            const btn = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.shift-cell-btn'));
            if (!btn || !design) return;

            const pos = btn.dataset.pos;
            const day = btn.dataset.day;

            if (brush !== null) {
                applyShift(pos, day, brush);
            } else {
                openCellEdit(btn);
            }
        });
    })();

    /**
     * Apply a shift value to a cell, update state and re-render coverage.
     * @param {any} pos
     * @param {any} day
     * @param {any} shift
     */
    function applyShift(pos, day, shift) {
        if (!design) return;
        const pats = /** @type {Record<string, any>} */ (design.patterns);
        if (!pats[pos]) pats[pos] = emptyPattern();
        // Painting a cell with the value it ALREADY holds is not a change (v19.38). It used to set
        // the dirty flag anyway, so one stray tap in paint mode armed the unsaved-changes guard —
        // the beforeunload prompt, the "changes will be lost" confirm on every design switch and on
        // sign-out — for an edit that did not happen. Found by an e2e that painted RD onto a rest
        // day and saw Save light up.
        if (pats[pos][day] === shift) return;
        pats[pos][day] = shift;
        dirty = true;
        updateSaveBtn();

        const tbody = document.getElementById('linksGridBodyRows');
        const oldBtn = tbody?.querySelector(`.shift-cell-btn[data-pos="${pos}"][data-day="${day}"]`);
        if (oldBtn) restoreBtn(oldBtn.parentElement, pos, day, shift);

        const tr = tbody?.querySelector(`tr[data-pos="${pos}"]`);
        if (tr) tr.classList.toggle('row-unfilled', isUnfilledPattern(pats[pos]));

        const cov = calcCoverage(design.patterns);
        renderFooter(cov);
        renderCoverageCard();
        renderDesignChecks();
    }

    /** @param {any} cov */
    function renderFooter(cov) {
        const tfoot = document.getElementById('linksCoverageFoot');
        if (!tfoot || !design || !cov) return;
        const cells = DAYS.map(d => {
            const { early, late, spare, night } = cov[d];
            const worked = early + late + spare + night;
            return `<td class="cov-cell">` +
                `<span class="cov-num">${worked}</span>` +
                `<span class="cov-label-e"> E:${early}</span>` +
                ` <span class="cov-label-l">L:${late}</span>` +
                (night ? ` <span class="cov-label-n">N:${night}</span>` : '') +
                (spare ? ` <span class="cov-label-s">SP:${spare}</span>` : '') +
                `</td>`;
        }).join('');
        tfoot.innerHTML = `<tr><td class="col-pos cov-foot-label">Cover</td>${cells}</tr>`;
    }

    // ============================================
    // INLINE CELL EDITING (dropdown mode)
    // ============================================

    /** @param {any} btn */
    function openCellEdit(btn) {
        if (!design) return;
        const cell     = btn.parentElement;
        const pos      = btn.dataset.pos;
        const day      = btn.dataset.day;
        const dayLabel = DAY_LABELS[DAYS.indexOf(day)];
        const current  = (/** @type {Record<string, any>} */ (design.patterns))[pos]?.[day] ?? 'RD';

        const select = document.createElement('select');
        select.className = 'shift-cell-select';
        select.setAttribute('aria-label', `Line ${pos} ${dayLabel}: change shift`);
        select.innerHTML = buildShiftOptions(current, true);

        let committed = false;

        function cancel() {
            committed = true;
            cell.innerHTML = '';
            restoreBtn(cell, pos, day, current);
        }

        select.addEventListener('change', async () => {
            committed = true;   // set BEFORE the await so the blur guard below never cancels mid-dialog
            let newVal = select.value;
            if (newVal === '__custom__') {
                const typed = normaliseCustomShift(
                    await promptDialog({ title: 'Custom shift', message: 'Type the shift as start–end, e.g. 06:00-14:00 (CEA shifts start between 04:00 and 20:59)', defaultValue: current.includes('-') ? current : '', placeholder: '06:00-14:00', confirmLabel: 'Set' }));
                if (!typed) { cancel(); return; }
                newVal = typed;
            }
            cell.innerHTML = '';
            restoreBtn(cell, pos, day, newVal);
            applyShift(pos, day, newVal);
        });

        select.addEventListener('keydown', e => {
            if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
        });

        select.addEventListener('blur', () => {
            if (!committed) cancel();
        });

        cell.innerHTML = '';
        cell.appendChild(select);
        requestAnimationFrame(() => select.focus());
    }

    /**
     * @param {any} cell
     * @param {any} pos
     * @param {any} day
     * @param {any} shift
     */
    function restoreBtn(cell, pos, day, shift) {
        const type   = classifyShift(shift);
        const label  = shiftLabel(shift);
        const dayIdx = DAYS.indexOf(day);
        const btn    = document.createElement('button');
        btn.className   = `shift-cell-btn type-${type}`;
        btn.dataset.pos = pos;
        btn.dataset.day = day;
        btn.setAttribute('aria-label', `Line ${pos} ${DAY_LABELS[dayIdx]}: ${shift}`);
        btn.textContent = label;
        cell.innerHTML  = '';
        cell.appendChild(btn);
    }

    // COVERAGE HEAT MAP + DESIGN QUALITY CHECKS were extracted to links-analysis.js (v17.70);
    // `renderCoverageChart` / `renderDesignChecks` are wired via initLinksAnalysis above.

    // ============================================
    // AUTO-GENERATOR
    // ============================================

    /**
     * Derive generator targets from the current roster.
     *
     * ALL 28 REAL LINES — the main 20-week link and the whole 8-week bilingual one (v19.59). It used
     * to take the main 20 plus only the TWO bilingual weeks the two bilingual members happen to sit
     * on, then apply that 22-line sample to a 28-line design. Bilingual weeks 1 and 8 are the SPARE
     * ones and were never sampled, so the seeded spare count came back as 4 when the roster the
     * design represents has SIX — main 1/7/12/17 plus bilingual 1/8. Two whole lines of standby
     * cover, missing by default, from a number nobody had reason to re-check.
     *
     * The design is 28 lines because that is main + bilingual, so the seed has to be main +
     * bilingual too. `teamMembers` is no longer read here: which weeks two people are on today is a
     * fact about staffing, not about the roster's shape.
     *
     * Weekday count = the busiest Mon–Fri day for that time (some shifts only run Tue/Thu/Fri). That
     * is deliberately the MAX and not an average — under-staffing a day is the worse error — but it
     * does mean a generated design staffs every weekday at the busiest weekday's level, which the
     * real roster does not. The column header says so.
     */
    function buildRosterTargets() {
        const sources = [];
        const _weeklyRoster = /** @type {Record<number, any>} */ (weeklyRoster);
        const _bilingualRoster = /** @type {Record<number, any>} */ (bilingualRoster);
        for (let w = 1; w <= 20; w++) sources.push(_weeklyRoster[w]);
        for (let w = 1; w <= 8; w++) sources.push(_bilingualRoster[w]);

        const weekdays = DAYS.filter(d => dayClass(d) === 'weekday');
        const perDay = /** @type {Record<string, any>} */ ({});
        for (const src of sources) {
            for (const d of DAYS) {
                const s = src?.[d];
                if (!s || s === 'RD' || s === 'OFF' || s === 'SPARE') continue;
                perDay[s] = perDay[s] || Object.fromEntries(DAYS.map(x => [x, 0]));
                perDay[s][d]++;
            }
        }
        const slots = Object.keys(perDay).sort().map(time => ({
            time,
            weekday: Math.max(...weekdays.map(d => perDay[time][d])),
            sat:     perDay[time].sat,
            sun:     perDay[time].sun,
        }));
        // Spare is a whole WEEK in the real roster, so the seed is a count of lines, not a per-day
        // headcount. Every roster source line that is spare is spare on all seven days, so counting
        // the fully-spare sources gives the right number directly.
        const spareLines = sources.filter(src => src && DAYS.every(d => src[d] === 'SPARE')).length;
        return { slots, spareLines };
    }


    function renderGenTable() {
        const tbody = document.getElementById('genSlotRows');
        if (!tbody) return;
        tbody.innerHTML = genSlots.map((slot, i) =>
            `<tr data-slot="${i}">` +
            `<td class="gen-td-time"><select class="gen-select gen-slot-time" data-slot="${i}" ` +
            `aria-label="Shift time for row ${i + 1}">${buildShiftOptions(slot.time)}</select></td>` +
            ['weekday', 'sat', 'sun'].map(cls =>
                `<td><input type="number" class="gen-input gen-slot-count" min="0" max="28" ` +
                `value="${(/** @type {Record<string, any>} */ (slot))[cls]}" data-slot="${i}" data-class="${cls}" ` +
                `aria-label="${cls === 'weekday' ? 'Mon–Fri' : cls === 'sat' ? 'Saturday' : 'Sunday'} target for ${escapeHtml(slot.time)}"></td>`
            ).join('') +
            `<td class="gen-td-remove"><button class="gen-remove-btn" data-slot="${i}" type="button" ` +
            `aria-label="Remove ${escapeHtml(slot.time)} row" title="Remove this shift">✕</button></td>` +
            `</tr>`
        ).join('');
        updateGenTotals();
    }

    function updateGenTotals() {
        // The spare LINES cannot carry a timed duty, so they are part of every day's total.
        const tot = /** @type {Record<string, any>} */ ({ weekday: genSpareLines, sat: genSpareLines, sun: genSpareLines });
        for (const s of genSlots) {
            tot.weekday += s.weekday; tot.sat += s.sat; tot.sun += s.sun;
        }
        for (const [cls, id] of [['weekday', 'genTotWeekday'], ['sat', 'genTotSat'], ['sun', 'genTotSun']]) {
            const el = document.getElementById(id);
            if (!el) continue;
            el.textContent = `${tot[cls]} / 28`;
            el.classList.toggle('gen-total-over', tot[cls] > 28);
        }
        return tot;
    }

    // ── Generator targets: remembered per design (v19.38) ──────────────────────────────────────
    // The DESIGN was saved but the INPUTS that produced it were not — every load re-seeded the table
    // from the current roster, so a designer who tuned the targets lost that work on reload and
    // could never answer "what targets produced this design?" when reviewing it. Stored in
    // localStorage rather than on the Firestore doc: the doc's rules pin it to
    // hasOnly(['name','patterns','updatedAt','updatedBy']), so a new field would need a rules deploy,
    // and these are one designer's working notes rather than shared truth.
    const GEN_KEY_PREFIX = 'myb_links_gen_';
    const _genTargetsKey = () => GEN_KEY_PREFIX + (activeDesignId || 'unsaved');

    /** Persist the current target table for the active design. Silent — losing it is a nuisance,
     *  never a failure worth interrupting a designer for. */
    function saveGenTargets() {
        try { lsSet(_genTargetsKey(), JSON.stringify({ slots: genSlots, spareLines: genSpareLines })); }
        catch { /* quota / private mode — the roster seed remains the fallback */ }
    }

    /** Read back a stored target table, VALIDATED. This is localStorage: it can hold anything, and a
     *  malformed slot would reach generatePatterns and produce a silently wrong link. Anything that
     *  fails the shape check is discarded in favour of the roster seed. */
    function loadGenTargets() {
        let raw;
        try { raw = lsGet(_genTargetsKey()); } catch { return null; }
        if (!raw) return null;
        try {
            const v = JSON.parse(raw);
            const int = (/** @type {any} */ n) => Number.isInteger(n) && n >= 0;
            const okCounts = (/** @type {any} */ o) => !!o && int(o.weekday) && int(o.sat) && int(o.sun);
            if (!v || !Array.isArray(v.slots)) return null;
            // TWO accepted shapes, and both must stay accepted. v19.58 replaced the per-day `spare`
            // object with a single `spareLines` count; a validator that demanded only the new one
            // would reject every table stored before the change, and a validator that demanded only
            // the old one rejects everything written after it — silently, because the fallback is a
            // perfectly plausible roster seed. There is no error, just the designer's tuning quietly
            // gone. Accept either, reject anything that is neither.
            const legacy = okCounts(v.spare);
            if (!int(v.spareLines) && !legacy) return null;
            if (!v.slots.every((/** @type {any} */ sl) => sl && typeof sl.time === 'string' && okCounts(sl))) return null;
            return {
                slots: v.slots.map((/** @type {any} */ sl) => ({ time: sl.time, weekday: sl.weekday, sat: sl.sat, sun: sl.sun })),
                spareLines: int(v.spareLines) ? v.spareLines : null,
                spare: legacy ? { weekday: v.spare.weekday, sat: v.spare.sat, sun: v.spare.sun } : null,
            };
        } catch { return null; }
    }

    /** Put a target table on screen (state + the three spare inputs + the rows). */
    function applyGenTargets(/** @type {any} */ t) {
        genSlots = t.slots;
        // Remembered targets predating v19.58 hold a per-day `spare` object. Read the largest of the
        // three as the line count: it is the day that needed the most cover, so it never LOSES
        // capacity in the migration. Reading only `weekday` would silently shrink a design whose
        // Saturday carried more.
        genSpareLines = Number.isInteger(t.spareLines)
            ? t.spareLines
            : Math.max(0, ...Object.values(/** @type {any} */ (t.spare) || {}).map(Number).filter(Number.isFinite));
        const set = (/** @type {string} */ id, /** @type {number} */ n) => {
            const el = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
            if (el) el.value = String(n);
        };
        set('genSpareLines', genSpareLines);
        renderGenTable();
    }

    /** Show the active design's remembered targets, or the roster seed when it has none. */
    function refreshGenTargetsForDesign() {
        if (!document.getElementById('genSlotRows')) return;
        applyGenTargets(loadGenTargets() ?? buildRosterTargets());
    }

    (function initGenerator() {
        const tbody = document.getElementById('genSlotRows');
        if (!tbody) return;

        // Remembered targets for whatever design ends up active, else the roster seed. loadDesigns
        // calls refreshGenTargetsForDesign() again once it knows which design that is.
        applyGenTargets(loadGenTargets() ?? buildRosterTargets());

        tbody.addEventListener('input', e => {
            const input = /** @type {HTMLInputElement|null} */ (/** @type {Element} */ (e.target).closest('.gen-slot-count'));
            if (!input) return;
            const slot = genSlots[+(input.dataset.slot ?? '')];
            if (!slot) return;
            (/** @type {Record<string, any>} */ (slot))[input.dataset.class ?? ''] = Math.max(0, parseInt(input.value, 10) || 0);
            updateGenTotals();
            saveGenTargets();
        });

        tbody.addEventListener('change', async e => {
            const select = /** @type {HTMLSelectElement|null} */ (/** @type {Element} */ (e.target).closest('.gen-slot-time'));
            if (!select) return;
            const slot = genSlots[+(select.dataset.slot ?? '')];
            if (!slot) return;
            if (select.value === '__custom__') {
                const typed = normaliseCustomShift(
                    await promptDialog({ title: 'Custom shift', message: 'Type the shift as start–end, e.g. 09:30-17:30 (start between 04:00 and 20:59):', defaultValue: slot.time, placeholder: '09:30-17:30', confirmLabel: 'Set' }));
                if (typed) { slot.time = typed; saveGenTargets(); }
                renderGenTable();
                return;
            }
            slot.time = select.value;
            saveGenTargets();
        });

        tbody.addEventListener('click', e => {
            const btn = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.gen-remove-btn'));
            if (!btn) return;
            genSlots.splice(+(btn.dataset.slot ?? ''), 1);
            renderGenTable();
            saveGenTargets();
        });

        for (const [id, cls] of [['genSpareLines', 'lines']]) {
            document.getElementById(id)?.addEventListener('input', e => {
                void cls;
                genSpareLines = Math.max(0, parseInt(/** @type {HTMLInputElement} */ (e.target).value, 10) || 0);
                updateGenTotals();
                saveGenTargets();
            });
        }

        document.getElementById('genAddSlotBtn')?.addEventListener('click', () => {
            genSlots.push({ time: EARLY_SHIFTS[0] || '06:20-14:20', weekday: 1, sat: 0, sun: 0 });
            renderGenTable();
            saveGenTargets();
        });

        document.getElementById('genSeedBtn')?.addEventListener('click', () => {
            // Re-seeding is an explicit "forget my tuning" — persist the roster values over it.
            ({ slots: genSlots, spareLines: genSpareLines } = buildRosterTargets());
            saveGenTargets();
            /** @type {HTMLInputElement} */ (document.getElementById('genSpareLines')).value = String(genSpareLines);
            renderGenTable();
            const errEl = document.getElementById('genError');
            if (errEl) errEl.textContent = '';
        });

        document.getElementById('genApplyBtn')?.addEventListener('click', async () => {
            const errEl = document.getElementById('genError');
            if (errEl) errEl.textContent = '';

            if (genSlots.length === 0) {
                if (errEl) errEl.textContent = 'Add at least one shift row first.';
                return;
            }
            const tot = updateGenTotals();
            const over = ['weekday', 'sat', 'sun'].filter(c => tot[c] > 28);
            if (over.length) {
                if (errEl) {
                    const names = /** @type {Record<string, any>} */ ({ weekday: 'Mon–Fri', sat: 'Saturday', sun: 'Sunday' });
                    errEl.textContent = `Can't generate: ${over.map(c => `${names[c]} totals ${tot[c]}`).join(', ')} — ` +
                        `each day's total (shifts + spare) can't exceed 28 lines.`;
                }
                return;
            }

            const built = generateLink({ slots: genSlots, spareLines: genSpareLines, lines: ROTATING_LINES });
            const generated = built.patterns;
            if (!generated) {
                // `no-rest` is its own message. It means the targets ask for so much cover that no
                // arrangement leaves a person a rest day between a late finish and an early start —
                // a real answer about the targets, not a typo in them, and the generic message would
                // send the designer hunting for a bad row that does not exist.
                if (errEl) {
                    errEl.textContent = built.reason === 'no-rest'
                        ? `Can't generate — these targets leave no room for rest days, so every line would `
                          + `finish late and start early the next morning. Reduce a day's headcount or add spare weeks.`
                        : `Can't generate — check every row has a valid time and whole-number targets.`;
                }
                return;
            }

            // Name what is at stake (v19.38). The message used to be the same whether the active design
            // was blank or full of hand-tuned work — and Apply overwrites all 28 lines either way.
            const _hasWork = !!design && Object.values(/** @type {Record<string, any>} */ (design.patterns || {}))
                .some(p => DAYS.some(d => { const v = p?.[d]; return v && v !== 'RD' && v !== 'OFF'; }));
            const _genMsg = _hasWork
                ? `This replaces all 28 lines of “${design?.name || 'this design'}” with the generated pattern. Any edits you have made will be lost.`
                : 'Apply the generated pattern to all 28 lines?';
            if (!await confirmDialog({
                title: 'Apply pattern',
                message: _genMsg,
                confirmLabel: _hasWork ? 'Replace all 28 lines' : 'Apply',
                danger: _hasWork,
            })) return;

            // Tune the ORDER of the lines to whichever objectives are switched on. This is free with
            // respect to coverage — permuting rows cannot change how many people work shift X on day
            // D — so it can only ever trade the objectives against each other, and the status line
            // states what that trade actually was rather than leaving the designer to trust it.
            //
            // AFTER the confirm, deliberately: the 2-opt sweep is ~150ms on a desktop and several
            // times that on the phones this is used from, and run before the dialog that is the
            // button sitting dead with nothing on screen to explain it.
            const _chk = (/** @type {string} */ id) =>
                !!(/** @type {HTMLInputElement|null} */ (document.getElementById(id))?.checked);
            const _on = {
                variety: _chk('objVariety'), gentle: _chk('objGentle'), weekends: _chk('objWeekends'),
                longWeekends: _chk('objLongWeekends'), turnarounds: _chk('objTurnarounds'),
            };
            const _num = (/** @type {string} */ id, /** @type {number} */ dflt, min = 0) => Math.max(min, parseInt(
                /** @type {HTMLInputElement|null} */ (document.getElementById(id))?.value ?? String(dflt), 10) || dflt);
            const _target = _num('objLongTarget', 4);
            const _blockTarget = _num('objBlockTarget', DEFAULT_BLOCK_TARGET, 1);
            const _ord = reorderLines(generated, {
                on: _on, longWeekendTarget: _target, blockTarget: _blockTarget,
            });
            const _final = _ord.changed ? applyOrder(generated, _ord.order) : generated;

            if (!design) {
                // No active design yet — load into an unsaved in-memory design
                design = { id: null, name: 'Design 1', patterns: _final };
                activeDesignId = null;
            } else {
                design = { ...design, patterns: _final };
            }

            dirty = true;
            compare.resetCompare();
            dearmBrush();
            renderDesignPicker();
            renderGrid();
            renderBrushBar();
            renderDesignChecks();
            compare.renderCompare();
            updateSaveBtn();

            const status = document.getElementById('linksSaveStatus');
            if (status) {
                // State the trade. A reorder that improved one figure at another's expense must say
                // so — a bare "generated" would let the designer assume everything got better.
                const b = _ord.before, a = _ord.after;
                const bits = _ord.changed
                    ? [`longest block ${b.longestBlock}→${a.longestBlock} weeks`,
                        `week-to-week ${b.gentleMean}→${a.gentleMean} min`,
                        `weekends off ${b.weekends}→${a.weekends}`,
                        `long ${b.longWeekends}→${a.longWeekends}`]
                    : [];
                // Name the construction. The two produce visibly different designs — settled weeks
                // keep a line inside one wave, the fallback walks it across the whole day — and a
                // designer who is not told which they got cannot account for the difference.
                const how = built.mode === 'settled'
                    ? `Link generated — settled weeks, ${built.waves} wave${built.waves === 1 ? '' : 's'}`
                    : 'Link generated — rotating weeks (targets would not fit settled ones)';
                status.textContent = how + (bits.length ? ` — ${bits.join(', ')}.` : '. Review and save when ready.');
                status.className = 'links-save-status ok';
            }
        });
    })();

    // ============================================
    // SAVE / LOAD
    // ============================================

    function updateSaveBtn() {
        const btn    = /** @type {HTMLButtonElement|null} */ (document.getElementById('linksSaveBtn'));
        const status = document.getElementById('linksSaveStatus');
        if (btn) btn.disabled = !dirty;
        if (status && dirty) status.textContent = '';
    }

    /**
     * Build the print-only masthead: which design, which version, printed when.
     *
     * The date is stamped at BEFOREPRINT rather than at render, so a page left open for a week
     * cannot print yesterday's date on today's sheet.
     */
    function _renderPrintMasthead() {
        const el = document.getElementById('printDesignName');
        if (!el) return;
        if (!design) { el.textContent = ''; return; }
        const entry = designs.find(x => x.id === activeDesignId);
        const when  = entry?.updatedAt?.toDate?.();
        // The provenance line describes the SAVED document; the grid prints the LIVE in-memory
        // patterns. With unsaved edits those are two different designs, so a sheet showing your
        // changes would carry someone else's "Last saved by" — and this sheet goes to the assessing
        // manager. Say so on the paper rather than refusing to print: printing a work in progress is
        // a perfectly reasonable thing to want (v19.62).
        const unsaved = dirty ? ' · includes unsaved changes' : '';
        const saved = entry?.updatedBy
            ? `Last saved by ${entry.updatedBy}${when ? ` · ${when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}${unsaved}`
            : `Not saved yet${unsaved}`;
        const printed = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        // The printed sheet states the window it was designed to (v19.54). A circulated sheet is
        // read away from the app, so without this a proposal built to a moved Sunday finish is
        // indistinguishable from one built to the standard hours.
        const win = formatWindow(design.window);
        const moved = isDefaultWindow(design.window) ? '' : ' (moved)';
        el.innerHTML =
            `<span class="print-design-title">${escapeHtml(design.name || 'Link design')}</span>` +
            `<span class="print-design-meta">${escapeHtml(saved)} · Printed ${escapeHtml(printed)}</span>` +
            `<span class="print-design-meta">Staffed window: ${escapeHtml(win + moved)}</span>`;
    }
    // Re-stamp on the way to the printer so the "Printed" date is the real one.
    window.addEventListener('beforeprint', _renderPrintMasthead);

    // The print button (v19.62). `window.print()` fires `beforeprint`, so it goes through exactly the
    // same path as the browser's own menu item — the masthead stamp and the open-every-`details`
    // handler above are shared, not duplicated here.
    document.getElementById('linksPrintBtn')?.addEventListener('click', () => window.print());

    /**
     * Open every `<details>` before printing, and put them back afterwards (v19.57).
     *
     * The fatigue panel's "N factors with nothing to report" disclosure is collapsed by default on
     * screen, and CSS **cannot** open it: Chromium hides a closed `details`'s content through its own
     * internal slot, which no author `display` rule reaches. Measured — a `@media print` override
     * still printed 13 of 24 rows.
     *
     * That is not a cosmetic loss. The printed sheet is what gets circulated to the assessing
     * manager, so a silent drop of 17 completed checks would be precisely the false-assurance failure
     * this panel was built to prevent: a design that looks like it was assessed against fewer factors
     * than it actually was. On paper the panel is a record, so it prints whole.
     *
     * `afterprint` restores the on-screen state — printing must not be a way to permanently expand
     * something the designer had deliberately collapsed.
     */
    let _reopenAfterPrint = /** @type {HTMLDetailsElement[]} */ ([]);
    window.addEventListener('beforeprint', () => {
        _reopenAfterPrint = /** @type {HTMLDetailsElement[]} */ (
            [...document.querySelectorAll('details:not([open])')]);
        for (const d of _reopenAfterPrint) d.open = true;
    });
    window.addEventListener('afterprint', () => {
        for (const d of _reopenAfterPrint) d.open = false;
        _reopenAfterPrint = [];
    });

    /**
     * @param {any} updatedBy
     * @param {any} updatedAt
     */
    function updateLastSaved(updatedBy, updatedAt) {
        const el = document.getElementById('linksLastSaved');
        if (!el) return;
        if (!updatedBy) { el.textContent = ''; return; }
        const d       = updatedAt?.toDate?.();
        const timeStr = d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
        el.textContent = `Last saved by ${updatedBy}` + (timeStr ? ` at ${timeStr}` : '');
    }

    async function saveChanges() {
        const btn    = /** @type {HTMLButtonElement|null} */ (document.getElementById('linksSaveBtn'));
        const status = document.getElementById('linksSaveStatus');
        if (!design) return;
        if (btn) btn.disabled = true;
        if (status) { status.textContent = 'Saving…'; status.className = 'links-save-status'; }

        try {
            await sessionReady;

            if (!activeDesignId) {
                // First save of a generator-created design — create the Firestore document
                const dsn = design; // capture non-null (guarded above) so the retry closure keeps narrowing
                const ref = await writeWithClaimRetry(() => addDoc(DESIGNS_COL, {
                    name:      dsn.name || 'Design 1',
                    patterns:  dsn.patterns,
                    window:    normaliseWindow(dsn.window),
                    updatedAt: serverTimestamp(),
                    updatedBy: currentUser,
                }));
                activeDesignId = ref.id;
                design.id = ref.id;
                lsSet(ACTIVE_KEY, ref.id);
                // Read back to capture the server timestamp for concurrency tracking
                let savedAt = null;
                try {
                    const snap = await getDoc(doc(db, COLLECTIONS.linkDesigns, ref.id));
                    savedAt = snap.data()?.updatedAt ?? null;
                    // Mirror the v17.18 saveChanges invariant: a null (unresolved) read-back must
                    // pair loadedUpdatedAt=null with baselineUnknown=true, else the NEXT save sees
                    // neither a known timestamp nor the unknown-baseline flag and can clobber a
                    // co-editor's intervening write with no conflict prompt.
                    ({ loadedUpdatedAt, baselineUnknown } = baselineAfterWrite(savedAt?.toMillis?.()));
                } catch { ({ loadedUpdatedAt, baselineUnknown } = baselineAfterWrite(null, false)); }
                const newEntry = { id: ref.id, name: design.name, patterns: deepCopyPatterns(design.patterns), window: normaliseWindow(design.window), updatedAt: savedAt, updatedBy: currentUser };
                designs.push(newEntry);
                _sortDesigns();
                dirty = false;
                updateSaveBtn();
                renderDesignPicker();
                if (status) { status.textContent = '✓ Saved'; status.className = 'links-save-status ok'; }
                updateLastSaved(currentUser, { toDate: () => new Date() });
                return;
            }

            // Concurrency: two designers can have this page open at once. Prefer an ATOMIC
            // compare-and-set — read the doc's updatedAt and write in ONE transaction — so a
            // co-designer's save that lands between our read and our write can no longer be silently
            // clobbered (the old getDoc-then-setDoc was a check-then-act race; Finding #13). A
            // transaction needs connectivity, so on offline / any transaction failure we fall back to
            // the previous getDoc-check + queued setDoc (persistentLocalCache syncs it) — offline-first
            // preserved, never worse than before.
            const designRef = doc(db, COLLECTIONS.linkDesigns, activeDesignId);
            const dsn = design; // capture non-null (guarded above) so the retry closures keep narrowing
            const buildDoc = () => ({
                name:      dsn.name || 'Design 1',
                patterns:  dsn.patterns,
                window:    normaliseWindow(dsn.window),
                updatedAt: serverTimestamp(),
                updatedBy: currentUser,
            });
            // Server doc vs our load baseline → { by, at } on conflict, else null. Single source used by
            // BOTH the transaction and the offline fallback so they can't drift.
            // The RULE lives in links-concurrency.js (v19.38) — pure and tested, because three silent
            // overwrites have come out of it (v16.19 / v16.23 / v17.18) and it had no seam.
            const conflictOf = (/** @type {any} */ data, /** @type {boolean} */ exists) =>
                _conflictOf(data, exists, { loadedUpdatedAt, baselineUnknown, currentUser });
            const confirmOverwrite = (/** @type {{by:string, at:any}} */ c) => {
                const when = c.at?.toDate?.()?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) ?? '';
                return confirmDialog({
                    title: 'Someone else saved',
                    message: `${c.by} saved a different version${when ? ` at ${when}` : ''} after you opened this page.\n\n` +
                        `Save anyway and replace their changes?`,
                    confirmLabel: 'Replace',
                    danger: true,
                });
            };
            const markNotSaved = () => {
                if (btn) btn.disabled = false;
                if (status) {
                    status.textContent = 'Not saved — your changes are still here. Refreshing the page would discard them.';
                    status.className   = 'links-save-status err';
                }
            };
            // Declining the overwrite used to be a dead end: the status said "refresh to see the
            // latest version", and refreshing THROWS AWAY everything you just did. The only two
            // outcomes were clobber your colleague or lose your own work. Offer the third (v19.38) —
            // keep both, by forking your version into a new design. The machinery already exists.
            // A co-designer may have DELETED this design while we had it open (v19.41). That is
            // not the same event as "someone saved a different version", and it must not be
            // reported as one: the design is in their bin, and a plain overwrite here would
            // silently resurrect it — a delete undone by someone who never saw the delete. Offer
            // the fork instead, which keeps our work without contradicting their action.
            const deletedElsewhere = async (/** @type {any} */ data) => {
                markNotSaved();
                const by = (data?.deletedBy || '').trim();
                if (await confirmDialog({
                    title: 'This design was deleted',
                    message: `${by || 'Someone'} deleted this design while you had it open. It is in Recently deleted.\n\n` +
                        'Your version can be saved as a NEW design so your work is not lost.',
                    confirmLabel: 'Save mine as new',
                    cancelLabel: 'Not now',
                })) await duplicateDesign();
                return true;
            };

            const declineOrFork = async () => {
                markNotSaved();
                if (await confirmDialog({
                    title: 'Keep your version too?',
                    message: 'Their version stays as it is. Yours can be saved as a NEW design, so nothing is lost either way.',
                    confirmLabel: 'Save mine as new',
                    cancelLabel: 'Not now',
                })) await duplicateDesign();
            };

            let committed = false;
            try {
                await writeWithClaimRetry(() => runTransaction(db, async (/** @type {any} */ tx) => {
                    const snap = await tx.get(designRef);
                    if (snap.exists() && isDeleted(snap.data())) {
                        const e = /** @type {any} */ (new Error('design-deleted'));
                        e.deletedData = snap.data();
                        throw e;
                    }
                    const c = conflictOf(snap.data() || {}, snap.exists());
                    if (c) { const e = /** @type {any} */ (new Error('concurrent-edit')); e.conflict = c; throw e; }
                    tx.set(designRef, buildDoc());
                }));
                committed = true;
            } catch (txErr) {
                const _e = /** @type {any} */ (txErr);
                if (_e && _e.message === 'design-deleted') { await deletedElsewhere(_e.deletedData); return; }
                if (_e && _e.message === 'concurrent-edit') {
                    // The transaction saw a co-editor's newer version. Ask; on overwrite write
                    // UNCONDITIONALLY (the user accepted the replace) — a plain setDoc, which also
                    // queues offline. On decline, stop without writing.
                    if (!await confirmOverwrite(_e.conflict)) { await declineOrFork(); return; }
                    await writeWithClaimRetry(() => setDoc(designRef, buildDoc()));
                    committed = true;
                }
                // else: offline / transaction unsupported → fall through to the legacy path below.
            }
            if (!committed) {
                // Legacy fallback (offline, or the transaction failed for a non-conflict reason):
                // getDoc-check then a queued setDoc, exactly as before the transaction was added.
                let deletedByOther = false;
                try {
                    const fresh = await getDoc(designRef);
                    if (fresh.exists() && isDeleted(fresh.data())) {
                        await deletedElsewhere(fresh.data());
                        deletedByOther = true;
                    } else {
                        const c = conflictOf(fresh.data() || {}, fresh.exists());
                        if (c && !await confirmOverwrite(c)) { await declineOrFork(); return; }
                    }
                } catch { /* offline — no reachable server state to compare; proceed with the queued write */ }
                if (deletedByOther) return;
                await writeWithClaimRetry(() => setDoc(designRef, buildDoc()));
            }
            // Refresh the in-memory cache entry UNCONDITIONALLY after the successful write — the
            // saved patterns are authoritative regardless of whether the updatedAt read-back below
            // succeeds. Previously this lived inside the getDoc try, so a read-back failure left the
            // designs[] entry with STALE patterns while design.patterns held the new content, and
            // switching away then back reverted the grid to the pre-save patterns (v16.19).
            const entry = designs.find(x => x.id === activeDesignId);
            if (entry) { entry.patterns = deepCopyPatterns(design.patterns); entry.updatedBy = currentUser; }
            try {
                const after = await getDoc(designRef);
                ({ loadedUpdatedAt, baselineUnknown } = baselineAfterWrite(after.data()?.updatedAt?.toMillis?.()));
                if (entry) entry.updatedAt = after.data()?.updatedAt;
            } catch { ({ loadedUpdatedAt, baselineUnknown } = baselineAfterWrite(null, false)); }
            // ^ On a post-save read-back failure the baseline is UNKNOWN, not "no baseline": leaving
            // baselineUnknown=false here meant the NEXT save saw neither a known timestamp
            // (loadedUpdatedAt=null) nor an unknown-baseline flag, so a co-editor's intervening save
            // was overwritten with NO conflict warning. Mirrors the transaction path's catch (v17.18).

            dirty = false;
            updateSaveBtn();
            if (status) { status.textContent = '✓ Saved'; status.className = 'links-save-status ok'; }
            updateLastSaved(currentUser, { toDate: () => new Date() });
        } catch (err) {
            console.error('[Links] Save failed:', err);
            dirty = true;
            if (btn) btn.disabled = false;
            if (status) { status.textContent = 'Save failed — try again'; status.className = 'links-save-status err'; }
        }
    }

    /**
     * Load all named designs from Firestore.
     * Migrates the legacy combined-28 document into a named design on first run.
     */
    async function loadDesigns() {
        loadFailed = false;
        try {
            await sessionReady;
            const snap = await getDocs(DESIGNS_COL);

            const named = [];
            /** @type {any[]} */ const binned = [];
            let legacyData = null;
            for (const d of snap.docs) {
                const data = d.data();
                if (typeof data.name === 'string' && data.name.trim() && isDeleted(data)) {
                    // In the bin (v19.41) — kept in memory WITH its patterns so a restore is a
                    // field-clearing merge and never re-uploads a stale copy of the design.
                    binned.push({
                        id:        d.id,
                        name:      data.name.trim(),
                        patterns:  normalisePatterns(data.patterns || {}),
                        // Carry the WINDOW into the bin too (v19.55). Without it a restore handed
                        // back a design wearing the app default, and the next save wrote that
                        // default over the moved boundary the design was actually built to.
                        window:    normaliseWindow(data.window),
                        deletedAt: data.deletedAt ?? null,
                        deletedBy: data.deletedBy || '',
                    });
                } else if (typeof data.name === 'string' && data.name.trim()) {
                    named.push({
                        id:        d.id,
                        name:      data.name.trim(),
                        // Canonicalise on the way IN (v19.38) so exactly one time format exists in
                        // memory. A legacy unpadded "6:00-14:00" classified as a worked early (so it
                        // counted in the day totals) while startMinutes/endMinutes returned null —
                        // making it invisible in the coverage heat map and exempt from every
                        // short-turnaround check. See links-design.js → canonicaliseShift.
                        patterns:  normalisePatterns(data.patterns || {}),
                        // The staffed window travels with the design (v19.54). Normalised on the
                        // way in, so a design saved before the field existed reads as the default
                        // and nothing already saved changes.
                        window:    normaliseWindow(data.window),
                        updatedAt: data.updatedAt,
                        updatedBy: data.updatedBy || '',
                    });
                } else if (d.id === 'combined-28' && data.patterns) {
                    legacyData = data;
                }
            }

            // One-time migration: convert combined-28 to a named design
            if (named.length === 0 && legacyData) {
                const ref = await writeWithClaimRetry(() => addDoc(DESIGNS_COL, {
                    name:      'Design 1',
                    patterns:  legacyData.patterns,
                    updatedAt: legacyData.updatedAt ?? serverTimestamp(),
                    updatedBy: legacyData.updatedBy ?? currentUser,
                }));
                named.push({
                    id:        ref.id,
                    name:      'Design 1',
                    patterns:  legacyData.patterns,
                    updatedAt: legacyData.updatedAt,
                    updatedBy: legacyData.updatedBy || currentUser,
                });
            }

            // Sort by name — getDocs returns documents in (random) auto-ID order,
            // which would shuffle the picker between machines and visits.
            named.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
            designs = named;
            // Bin: newest deletion first. The ordering rule (incl. the unresolved-timestamp case,
            // which must not go through Infinity - Infinity) is pure and tested.
            deletedDesigns = sortByDeleted(binned);
            // AUTOMATIC PERMANENT DELETION IS SUSPENDED (v19.86, external review P2).
            //
            // `purgeExpiredDeletions` is kept and still correct — it re-reads inside a transaction
            // and `isPurgeable` fails closed on an unresolved or FUTURE `deletedAt`. What none of
            // that can defend against is a device clock running more than 30 days FAST: every recent
            // deletion then looks expired, the transaction re-checks with the same wrong local time
            // and agrees, and a colleague's design is destroyed for good. The whole point of the bin
            // is that a delete is recoverable, so a path that can silently empty it early defeats
            // the feature it belongs to.
            //
            // The correct fix is expiry on SERVER time — a scheduled Cloud Function. Until that
            // exists, nothing here deletes anything automatically: the bin keeps what it has, the
            // panel shows each design's age, and removal is a deliberate act through "Remove for
            // good" (which IS transactional, and now re-checks that the design is still deleted).
            // The cost is a bin that grows; with three designers and a handful of designs that is
            // nothing against permanently losing somebody's work to a wrong clock.
            //
            // Do NOT re-enable this by simply calling it again — it needs a server clock first.

            if (designs.length > 0) {
                // Re-open the design that was active last visit, else the first
                const d = designs.find(x => x.id === lsGet(ACTIVE_KEY)) || designs[0];
                activeDesignId  = d.id;
                lsSet(ACTIVE_KEY, d.id);
                design          = { id: d.id, name: d.name, patterns: deepCopyPatterns(d.patterns), window: normaliseWindow(d.window) };
                ({ loadedUpdatedAt, baselineUnknown } = baselineAfterWrite(d.updatedAt?.toMillis?.()));
                updateLastSaved(d.updatedBy, d.updatedAt);
            } else {
                design = null;
                activeDesignId = null;
            }
        } catch (err) {
            console.error('[Links] Load failed:', err);
            design = null;
            loadFailed = true;
        }
        dirty = false;
        renderDesignPicker();
        renderGrid();
        renderBrushBar();
        renderDesignChecks();
        // loadDesigns sets the active design INLINE rather than through _activateDesign, so the
        // paint hook there does not cover a fresh page open — exactly the gap the generator targets
        // hit at v19.38 (see the note below). Without this the window editor stayed hidden and
        // empty until the designer switched design.
        paintWindowEditor();
        updateSaveBtn();
        // Show the ACTIVE design's remembered generator targets (v19.38). loadDesigns sets the
        // active design inline rather than through _activateDesign, so the hook there does not cover
        // the initial load — without this the table always showed the roster seed on a fresh page
        // and the remembered targets only appeared after switching design and back.
        refreshGenTargetsForDesign();
    }

    // ============================================
    // COLLAPSIBLE CARDS
    // ============================================
    initCardCollapse('linksGridToggleHeader', 'linksGridBody',  'linksGridChevron');
    initCardCollapse('generatorToggleHeader', 'generatorBody',  'generatorChevron');
    initCardCollapse('coverageToggleHeader',  'coverageBody',   'coverageChevron');
    initCardCollapse('checksToggleHeader',    'checksBody',     'checksChevron');

    // ============================================
    // BUTTON HANDLERS
    // ============================================
    document.getElementById('linksSaveBtn')?.addEventListener('click', saveChanges);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && brush !== null) dearmBrush();
    });

    // ============================================
    // UNSAVED CHANGES GUARD
    // ============================================
    window.addEventListener('beforeunload', e => {
        if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });

    document.addEventListener('click', e => {
        if (!dirty) return;
        const link = /** @type {HTMLAnchorElement|null} */ (/** @type {Element} */ (e.target).closest('.nav-panel a[href]'));
        if (!link) return;
        // A target="_blank" link opens a NEW tab — this page and its unsaved work stay put, so there
        // is nothing to guard; let it through untouched. (No drawer link is _blank today — the guide
        // links became same-tab at v18.81 and now correctly route through this guard like the page
        // pills — but the exception stays as future-proofing for any external link that joins the drawer.)
        if (link.target === '_blank') return;
        // The custom dialog is async, so it can't decide preventDefault() inline the way the native
        // confirm() did. Intercept the same-tab nav-drawer click, ask, and navigate on confirm.
        e.preventDefault();
        e.stopPropagation();
        const href = link.href;
        confirmDialog({ message: 'You have unsaved changes. Leave this page anyway?', confirmLabel: 'Leave' })
            .then(ok => { if (ok) { dirty = false; window.location.href = href; } });   // clear dirty so beforeunload doesn't double-prompt
    }, true);

    // ============================================
    // ICON LIGHTBOX — About panel (shared about-lightbox.js)
    // ============================================
    (function () {
        const about = initAboutLightbox({
            appLabel: 'Marylebone Roster — Links',
            bugLinkId: 'linksBugReportLink',
            getUserName: () => currentUser,
        });
        if (about) openAboutLightbox = about.open;

        // The 🔧 Operations shortcut in the About panel is admin-only: operations.html
        // redirects a non-admin designer (e.g. S. Silva) straight to admin.html, so
        // showing them the link is a dead end. Reveal it only for admins, and route it
        // through the unsaved-changes guard (the capture-phase guard above only covers
        // nav-drawer links, and mobile browsers suppress the beforeunload dialog).
        const opsLink = document.getElementById('linksOpsLink');
        if (opsLink && isAdmin) {
            opsLink.hidden = false;
            opsLink.addEventListener('click', e => {
                if (!dirty) return;
                e.preventDefault();   // async dialog — intercept, then follow the link on confirm
                const href = /** @type {HTMLAnchorElement} */ (opsLink).href;
                confirmDialog({ message: 'You have unsaved changes. Leave anyway?', confirmLabel: 'Leave' })
                    .then(ok => { if (ok) { dirty = false; window.location.href = href; } });
            });
        }

        // Header logo is a back-to-calendar button (About moved to the drawer logo).
        const headerIcon = document.getElementById('appIcon');
        if (!headerIcon) return;
        headerIcon.title = 'Back to calendar';
        headerIcon.setAttribute('aria-label', 'Back to calendar');
        // Keyboard-operable: the logo is an interactive control (was a non-focusable <img>). v18.29.
        headerIcon.setAttribute('role', 'button');
        headerIcon.tabIndex = 0;
        headerIcon.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); headerIcon.click(); } });
        headerIcon.addEventListener('click', async () => {
            if (dirty && !await confirmDialog({ message: 'You have unsaved changes. Leave anyway?', confirmLabel: 'Leave' })) return;
            dirty = false;   // clear so beforeunload doesn't double-prompt
            window.location.href = './';
        });
    })();

    // ============================================
    // TIPS LIGHTBOX — ? button on each card
    // Lifecycle, renderer, and button wiring live in tips-lightbox.js — only the
    // content data is owned here.
    // ============================================
    (function () {
        const CARD_TIPS = {
            'links-grid': {
                title: 'Link design grid',
                sections: [
                    { heading: 'How it works', items: [
                        { icon: '📋', html: 'Each <strong>row</strong> is one of the 28 lines. Each <strong>column</strong> is a day of the week (Sun–Sat).' },
                        { icon: '🔄', html: 'All 28 lines rotate — everyone passes through every line over the cycle, so <strong>all 28 must be filled</strong> with a real pattern before the link can be authorised.' },
                        { icon: '🖌️', html: '<strong>Paint mode</strong> — arm a shift in the Paint bar above the grid, then click cells to fill them. Click the same chip again (or press Escape) to stop painting.' },
                        { icon: '✏️', html: '<strong>Single-cell edit</strong> — with no brush armed, tap any cell to pick a shift from the dropdown, or choose <strong>Custom time…</strong> to type a new one.' },
                        { icon: '💾', html: 'Tap <strong>Save changes</strong> when done.' },
                    ]},
                    { heading: 'Multiple designs', items: [
                        { icon: '➕', html: '<strong>+ New</strong> starts a fresh blank design. <strong>⎘ Duplicate</strong> copies the current one so you can try a variation.' },
                        { icon: '⇔', html: '<strong>Compare</strong> shows two designs side-by-side — cells that differ are highlighted in gold. Only available when you have at least two designs.' },
                        { icon: '🗑', html: 'Deleting a design does not destroy it — it moves to <strong>Recently deleted</strong>, where you can restore it for 30 days. The button only appears when something is in there.' },
                    ]},
                    { heading: 'Filling the lines', items: [
                        { icon: '⬜', html: 'A line shown as <strong>all rest days</strong> is <em>not yet designed</em> — its line number turns amber. Fill it manually or with the generator. The Design checks card lists any that are still empty.' },
                        { icon: '🙋', html: 'Empty lines are <strong>not vacancies</strong> — a vacancy is a missing person, not a missing pattern. The link must be a complete 28 so it still works whoever is in post.' },
                    ]},
                ],
            },
            'links-coverage': {
                title: 'Coverage analysis',
                sections: [{ items: [
                    { icon: '📊', html: 'Each cell shows how many people are <strong>on duty during that hour</strong> — rows are days, columns are hours of the day' },
                    { icon: '🔵', html: 'Darker blue = more people on at once; blank = nobody on duty' },
                    { icon: '🔴', html: 'A red <strong>0</strong> means a gap — nobody on duty in the middle of that day\'s working hours' },
                    { icon: '🟡', html: '<strong>SP</strong> column = spares on standby that day (no fixed time, so they aren\'t in the hourly cells)' },
                    { icon: '💡', html: 'This shows the real <em>shape</em> of the day — opens, the morning build, the afternoon peak, and the taper to close. Updates live as you edit cells.' },
                    { icon: '🚆', html: 'The orange <strong>Trains per hour</strong> rows underneath are the December 2026 <em>service</em> — arrivals and departures together, weighted by train length, so a 9-car evening train counts for more than a 3-car midday one.' },
                    { icon: '📐', html: 'The two halves are shaded on <em>separate</em> scales — people and cars are different units, so compare the <strong>shapes</strong>, not the depth of colour.' },
                    { icon: '➖', html: 'An underlined demand cell means some of that hour\'s trains fall <strong>outside the staffed window</strong> — the note names them to the minute. That is stated, never scored: where the window sits is a business decision.' },
                ]}],
            },
            'links-checks': {
                title: 'Design checks',
                sections: [{ items: [
                    { icon: '🔄', html: '<strong>All lines designed</strong> — every one of the 28 rotating lines must carry a real pattern. A line that is all rest days is unfinished (not a vacancy), and the link can\'t be authorised until they are all filled.' },
                    { icon: '✅', html: '<strong>Weekends off</strong> — a full weekend = Saturday rest + the following Sunday rest. Aim for at least 40% of weeks.' },
                    { icon: '⏱️', html: '<strong>Rest between shifts</strong> — checks every transition between two <em>timed</em> shifts across the rotation for less than 12 hours rest. Late-to-early next morning is the classic short turnaround. A spare day has no times, so a transition either side of one can\'t be measured and isn\'t counted.' },
                    { icon: '📅', html: '<strong>Longest run</strong> — how many consecutive working days appear anywhere in the 28-line cycle. Over 7 days is flagged.' },
                    { icon: '⚖️', html: '<strong>Shift balance</strong> — how the worked days split between early, late, and spare across the full rotation.' },
                    { icon: '🔄', html: 'Checks cover the <em>rotation</em>, not a single week — turnarounds and run lengths wrap across line boundaries.' },
                ]}],
            },
            'links-generator': {
                title: 'Auto-generator',
                sections: [
                    { heading: 'What it does', items: [
                        { icon: '⚡', html: 'Builds a fair 28-line rotating pattern from a <strong>list of shifts</strong> — one row per start time, each with its own headcount for Mon–Fri, Saturday, and Sunday.' },
                        { icon: '🌊', html: 'The station is staffed in <strong>waves</strong> — opens, mid-morning, middles, afternoons, closes — so you can add as many shift rows as the day needs, not just one early and one late.' },
                        { icon: '🌅', html: 'Within each person\'s week, start times only move <strong>later</strong> — never a late finish then an early start — so body clocks shift in the easy direction.' },
                        { icon: '✅', html: 'Daily targets are met <strong>exactly</strong> by construction.' },
                    ]},
                    { heading: 'How to use it', items: [
                        { icon: '↺', html: 'The table starts <strong>pre-filled from the current roster</strong> — what today\'s 22 active lines actually provide. Edit from there, or use the reset link to get back to it.' },
                        { icon: '➕', html: '<strong>+ Add another shift</strong> for a new start time; ✕ removes a row. Pick times from the dropdown or choose Custom time….' },
                        { icon: '⚠️', html: 'Each day\'s total (all shifts + spare) can\'t exceed 28 — watch the Total row.' },
                        { icon: '3️⃣', html: 'Tap <strong>Generate link</strong>, then review the Coverage analysis and Design checks before saving.' },
                    ]},
                ],
            },
        };

        initTipsLightbox(CARD_TIPS);
    })();

    // ============================================
    // FIRST-VISIT NOTICE — shown once, never again after close
    // ============================================
    // Replaced the v12.33 beta notice at v19.51. Two things changed with it, both deliberate:
    //
    // A NEW STORAGE KEY. Reusing `myb_links_beta_seen` would have meant every current designer —
    // all three of whom closed the beta notice months ago — never saw the replacement, which is the
    // entire point of bringing it back. The old key is left on devices; it is an inert device flag.
    //
    // A 14-DAY WINDOW (owner, Aug 2026), against the skill's 28-day default. This is a small,
    // known audience on a page they visit deliberately, so a fortnight is long enough for everyone
    // to arrive; past that it self-dismisses rather than greeting someone months later with news.
    // NOTE what expiry actually does: it marks the notice seen WITHOUT showing it, so after 16 Aug
    // this lightbox is dead code on every device that had not already opened the page. That is
    // correct for a one-time notice and is the reason both of the app's previous notices were
    // silently inert — see CLAUDE.md's notice table, which now records expiry state.
    (function () {
        const NOTICE_DATE   = '2 Aug 2026';
        const NOTICE_DAYS   = 14;
        const WELCOME_KEY   = 'myb_links_welcome_seen';
        if (lsGet(WELCOME_KEY)) return;
        if (isNoticeExpired(NOTICE_DATE, NOTICE_DAYS)) { lsSet(WELCOME_KEY, '1'); return; }

        const lb = document.getElementById('linksWelcomeLb');
        if (!lb) return;

        const welcome = createLightbox({
            overlay:  lb,
            content:  /** @type {HTMLElement} */ (document.getElementById('linksWelcomeContent')),
            closeBtn: /** @type {HTMLElement} */ (document.getElementById('linksWelcomeClose')),
            onClose() {
                lsSet(WELCOME_KEY, '1');
                archiveNotice({
                    id:      'links-workspace-2026',
                    title:   'Links Workspace',
                    section: 'Links',
                    date:    NOTICE_DATE,
                    body:    'Changes in the Links workspace only affect the link-design document, never the live roster. The Design checks report which ORR fatigue factors a pattern features — they do not pass or fail a design. Designs are shared, and a deleted one is restorable for 30 days.',
                });
            },
        });

        // Not `welcome.open()`: a one-time notice must never open stacked with another overlay —
        // if it did, one Escape used to dismiss both and the buried one was flagged seen for good.
        // Deferring leaves it unopened AND unflagged, so it gets its turn on the next load.
        openNoticeIfClear(welcome);
    })();

    // ============================================
    // registerServiceWorker moved to the top of init() (before the access gate) — v16.23.
    sessionReady.then(() => { initErrorReporter(); recordUsage('links', currentUser); recordPageLatency('links', currentUser); });
    // Forced set-password overlay (PASSWORD_PLAN.md Phase 2) — fire-and-forget, never on the login
    // critical path. Inside the sessionReady callback so `currentUser` is read LATE: on the in-place
    // sign-in path the module loaded signed-out and the identity is only refreshed inside
    // initAuthorised(), so passing it eagerly here would pass null and silently never compel anyone.
    sessionReady.then(() => initPasswordForce(currentUser));

    // ============================================
    // BOOT
    // ============================================
    loadDesigns();

}
