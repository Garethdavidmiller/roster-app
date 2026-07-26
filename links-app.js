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

import { CONFIG, teamMembers, weeklyRoster, bilingualRoster, escapeHtml } from './roster-data.js';
import { db, doc, getDoc, setDoc, addDoc, deleteDoc, collection, getDocs, serverTimestamp, runTransaction, COLLECTIONS, writeWithClaimRetry } from './firebase-client.js';
import { initNavPanel, resetNavPanel, archiveNotice, isNoticeExpired } from './nav-panel.js';
import { initLoginOverlay, dismissLoginOverlay } from './login-overlay.js';
import { getSession, clearSession, ensureNamedSession, sessionReady, resolveSession, reconcileExpiredIdentity } from './session.js';
import { requirePage } from './auth-policy.js';
import { getAuthSnapshot } from './auth-state.js';
import { initCardCollapse, createLightbox, confirmDialog, promptDialog } from './overlay.js';
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
    classifyShift,
    normaliseCustomShift,
    dayClass,
    calcCoverage,
    generatePatterns,
} from './links-design.js';
import { initLinksAnalysis } from './links-analysis.js';
import { initLinksCompare } from './links-compare.js';


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
    const TOTAL_POS     = 28;
    const ROTATING_LINES = 28;

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
     * @type {{ id: string|null, name: string, patterns: Object } | null}
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
    let genSpare = { weekday: 0, sat: 0, sun: 0 };

    // Multi-design state
    /** @type {Array<{id:string, name:string, patterns:Object, updatedAt:*, updatedBy:string}>} */
    let designs         = [];
    /** @type {any} */ let activeDesignId  = null; // null = design not yet saved to Firestore

    // Read-only analysis panels (Coverage heat map + Design quality checks) — extracted to
    // links-analysis.js (v17.70). They read only the live active design, via this getter.
    const { renderCoverageChart, renderDesignChecks } = initLinksAnalysis({ getDesign: () => design });

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

    /**
     * Start-time portion of a shift string for compact chip labels: "06:20-14:20" → "06:20".
     * @param {any} shift
     */
    function formatShortTime(shift) {
        const dash = shift.indexOf('-');
        return dash > 0 ? shift.slice(0, dash) : shift;
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

        // Only show the picker once at least one design exists
        wrap.style.display = designs.length > 0 ? '' : 'none';

        // Render main design chips. A chip is a <div> wrapping separate <button>s —
        // buttons must NOT nest (the HTML parser force-closes an open <button> when
        // another one starts, which silently breaks the markup).
        if (chipsEl) {
            const canDelete = designs.length > 1;
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

        // Print-only label naming the design being printed
        const nameLabel = document.getElementById('printDesignName');
        if (nameLabel) nameLabel.textContent = design?.name ?? '';

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
        const name = (await promptDialog({ title: 'New design', message: 'Name for this design (e.g. "Option A"):', placeholder: 'Option A', maxLength: 100, confirmLabel: 'Create' }))?.trim();
        if (!name) return;
        if (_designNameTooLong(name)) return;
        if (dirty && !await confirmDialog({ message: 'You have unsaved changes in the current design. Create a new one anyway?', confirmLabel: 'Create new' })) return;
        try {
            const ref = await writeWithClaimRetry(() => addDoc(DESIGNS_COL, {
                name,
                patterns:  {},
                updatedAt: serverTimestamp(),
                updatedBy: currentUser,
            }));
            // Arm the concurrency baseline: read back the server updatedAt so loadedUpdatedAt
            // is non-null from the first content-save. Without this, a just-created design's
            // guard was bypassed (updatedAt:null) and a concurrent edit was silently clobbered.
            let createdTs = null;
            try { createdTs = (await getDoc(ref)).data()?.updatedAt ?? null; } catch { /* offline — no concurrent editor to guard */ }
            const d = { id: ref.id, name, patterns: {}, updatedAt: createdTs, updatedBy: currentUser };
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
        try {
            const ref = await writeWithClaimRetry(() => addDoc(DESIGNS_COL, {
                name,
                patterns,
                updatedAt: serverTimestamp(),
                updatedBy: currentUser,
            }));
            // Arm the concurrency baseline (see createDesign).
            let dupTs = null;
            try { dupTs = (await getDoc(ref)).data()?.updatedAt ?? null; } catch { /* offline */ }
            const d = { id: ref.id, name, patterns, updatedAt: dupTs, updatedBy: currentUser };
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
                baselineFresh = preTs === _preBaseline;
            } catch { /* offline — treat as mismatch, don't advance */ }
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
     * Delete a design (with confirmation). The last design can't be deleted —
     * the ✕ button is disabled in that state, so this guard is just a backstop.
     * @param {any} id
     */
    async function deleteDesign(id) {
        if (designs.length <= 1) return;
        const d = designs.find(x => x.id === id);
        if (!d) return;
        if (!await confirmDialog({ title: 'Delete design', message: `Delete "${d.name}"? This can't be undone.`, confirmLabel: 'Delete', danger: true })) return;
        try {
            await writeWithClaimRetry(() => deleteDoc(doc(db, COLLECTIONS.linkDesigns, id)));
            designs = designs.filter(x => x.id !== id);
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
        design          = { id: d.id, name: d.name, patterns: deepCopyPatterns(d.patterns) };
        loadedUpdatedAt = d.updatedAt?.toMillis?.() ?? null; baselineUnknown = false;
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
        renderCoverageChart();
        compare.renderCompare();
        updateSaveBtn();
        updateLastSaved(d.updatedBy, d.updatedAt);
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

        const chip = (/** @type {any} */ shift, /** @type {any} */ label, /** @type {any} */ typeClass, /** @type {any} */ extra = '') =>
            `<button class="brush-chip type-${typeClass}${extra}" data-shift="${escapeHtml(shift)}" ` +
            `aria-pressed="false" aria-label="Paint: ${escapeHtml(label)}" title="${escapeHtml(label)}">${escapeHtml(label)}</button>`;

        bar.innerHTML = [
            '<span class="brush-bar-label">Paint:</span>',
            chip('RD',    'RD',     'rd'),
            chip('SPARE', 'SP',     'spare'),
            ...EARLY_SHIFTS.map(s => chip(s, formatShortTime(s), 'early')),
            ...LATE_SHIFTS.map(s  => chip(s, formatShortTime(s), 'late')),
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

    function renderGrid() {
        const tbody      = document.getElementById('linksGridBodyRows');
        const tfoot      = document.getElementById('linksCoverageFoot');
        const wrapper    = document.getElementById('linksGridWrapper');
        const emptyState = document.getElementById('linksEmptyState');
        const saveRow    = document.getElementById('linksSaveRow');

        if (!design) {
            const emptyMsg = document.getElementById('linksEmptyMsg');
            if (emptyMsg) emptyMsg.innerHTML = loadFailed
                ? `Couldn't load the saved design — check your connection and refresh the page.`
                : `No designs saved yet — use the Auto-generate card below to create one, or tap <strong>+ New</strong> for a blank canvas.`;
            if (wrapper)    wrapper.style.display    = 'none';
            if (emptyState) emptyState.style.display = '';
            if (saveRow)    saveRow.style.display    = 'none';
            if (tbody)      tbody.innerHTML          = '';
            if (tfoot)      tfoot.innerHTML          = '';
            document.body.classList.remove('links-compare-on');
            // Auto-expand the generator so the user sees it without having to discover it
            if (!loadFailed) {
                const genBody    = document.getElementById('generatorBody');
                const genChevron = document.getElementById('generatorChevron');
                if (genBody && !genBody.classList.contains('open')) {
                    genBody.classList.add('open');
                    if (genChevron) {
                        genChevron.classList.add('open');
                        // Keep the collapse control's ARIA state in step with the class-only
                        // open so a screen reader hears "expanded" (initCardCollapse only
                        // syncs aria-expanded on click; this programmatic open bypasses it).
                        genChevron.setAttribute('aria-expanded', 'true');
                    }
                }
            }
            renderBrushBar();
            renderCoverageChart();
            renderDesignChecks();
            return;
        }

        if (emptyState) emptyState.style.display = 'none';
        if (saveRow)    saveRow.style.display    = '';

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
        renderCoverageChart();
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
        renderCoverageChart();
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
     * Derive generator targets from the current roster: the main 20-week link
     * plus the two bilingual lines the design uses. Weekday count = the busiest
     * Mon–Fri day for that time (some shifts only run Tue/Thu/Fri).
     */
    function buildRosterTargets() {
        const sources = [];
        const _weeklyRoster = /** @type {Record<number, any>} */ (weeklyRoster);
        const _bilingualRoster = /** @type {Record<number, any>} */ (bilingualRoster);
        for (let w = 1; w <= 20; w++) sources.push(_weeklyRoster[w]);
        const blMembers = teamMembers.filter(m => m.rosterType === 'bilingual' && !m.hidden);
        for (let i = 0; i < 2; i++) sources.push(_bilingualRoster[blMembers[i]?.currentWeek || (i + 1)]);

        const weekdays = DAYS.filter(d => dayClass(d) === 'weekday');
        const perDay = /** @type {Record<string, any>} */ ({});
        const spareByDay = /** @type {Record<string, any>} */ (Object.fromEntries(DAYS.map(d => [d, 0])));
        for (const src of sources) {
            for (const d of DAYS) {
                const s = src?.[d];
                if (!s || s === 'RD' || s === 'OFF') continue;
                if (s === 'SPARE') { spareByDay[d]++; continue; }
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
        const spare = {
            weekday: Math.max(...weekdays.map(d => spareByDay[d])),
            sat:     spareByDay.sat,
            sun:     spareByDay.sun,
        };
        return { slots, spare };
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
        const tot = /** @type {Record<string, any>} */ ({ weekday: genSpare.weekday, sat: genSpare.sat, sun: genSpare.sun });
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

    (function initGenerator() {
        const tbody = document.getElementById('genSlotRows');
        if (!tbody) return;

        ({ slots: genSlots, spare: genSpare } = buildRosterTargets());
        /** @type {HTMLInputElement} */ (document.getElementById('genSpareWeekday')).value = String(genSpare.weekday);
        /** @type {HTMLInputElement} */ (document.getElementById('genSpareSat')).value     = String(genSpare.sat);
        /** @type {HTMLInputElement} */ (document.getElementById('genSpareSun')).value     = String(genSpare.sun);
        renderGenTable();

        tbody.addEventListener('input', e => {
            const input = /** @type {HTMLInputElement|null} */ (/** @type {Element} */ (e.target).closest('.gen-slot-count'));
            if (!input) return;
            const slot = genSlots[+(input.dataset.slot ?? '')];
            if (!slot) return;
            (/** @type {Record<string, any>} */ (slot))[input.dataset.class ?? ''] = Math.max(0, parseInt(input.value, 10) || 0);
            updateGenTotals();
        });

        tbody.addEventListener('change', async e => {
            const select = /** @type {HTMLSelectElement|null} */ (/** @type {Element} */ (e.target).closest('.gen-slot-time'));
            if (!select) return;
            const slot = genSlots[+(select.dataset.slot ?? '')];
            if (!slot) return;
            if (select.value === '__custom__') {
                const typed = normaliseCustomShift(
                    await promptDialog({ title: 'Custom shift', message: 'Type the shift as start–end, e.g. 09:30-17:30 (start between 04:00 and 20:59):', defaultValue: slot.time, placeholder: '09:30-17:30', confirmLabel: 'Set' }));
                if (typed) slot.time = typed;
                renderGenTable();
                return;
            }
            slot.time = select.value;
        });

        tbody.addEventListener('click', e => {
            const btn = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.gen-remove-btn'));
            if (!btn) return;
            genSlots.splice(+(btn.dataset.slot ?? ''), 1);
            renderGenTable();
        });

        for (const [id, cls] of [['genSpareWeekday', 'weekday'], ['genSpareSat', 'sat'], ['genSpareSun', 'sun']]) {
            document.getElementById(id)?.addEventListener('input', e => {
                (/** @type {Record<string, any>} */ (genSpare))[cls] = Math.max(0, parseInt(/** @type {HTMLInputElement} */ (e.target).value, 10) || 0);
                updateGenTotals();
            });
        }

        document.getElementById('genAddSlotBtn')?.addEventListener('click', () => {
            genSlots.push({ time: EARLY_SHIFTS[0] || '06:20-14:20', weekday: 1, sat: 0, sun: 0 });
            renderGenTable();
        });

        document.getElementById('genSeedBtn')?.addEventListener('click', () => {
            ({ slots: genSlots, spare: genSpare } = buildRosterTargets());
            /** @type {HTMLInputElement} */ (document.getElementById('genSpareWeekday')).value = String(genSpare.weekday);
            /** @type {HTMLInputElement} */ (document.getElementById('genSpareSat')).value     = String(genSpare.sat);
            /** @type {HTMLInputElement} */ (document.getElementById('genSpareSun')).value     = String(genSpare.sun);
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

            const generated = generatePatterns({ slots: genSlots, spare: genSpare, lines: ROTATING_LINES });
            if (!generated) {
                if (errEl) errEl.textContent = `Can't generate — check every row has a valid time and whole-number targets.`;
                return;
            }

            if (!await confirmDialog({ title: 'Apply pattern', message: 'Apply the generated pattern to all 28 lines?', confirmLabel: 'Apply' })) return;

            if (!design) {
                // No active design yet — load into an unsaved in-memory design
                design = { id: null, name: 'Design 1', patterns: generated };
                activeDesignId = null;
            } else {
                design = { ...design, patterns: generated };
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
            if (status) { status.textContent = 'Link generated — review and save when ready.'; status.className = 'links-save-status ok'; }
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
                    loadedUpdatedAt = savedAt?.toMillis?.() ?? null; baselineUnknown = (loadedUpdatedAt == null);
                } catch { loadedUpdatedAt = null; baselineUnknown = true; }
                const newEntry = { id: ref.id, name: design.name, patterns: deepCopyPatterns(design.patterns), updatedAt: savedAt, updatedBy: currentUser };
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
                updatedAt: serverTimestamp(),
                updatedBy: currentUser,
            });
            // Server doc vs our load baseline → { by, at } on conflict, else null. Single source used by
            // BOTH the transaction and the offline fallback so they can't drift.
            const conflictOf = (/** @type {any} */ data, /** @type {boolean} */ exists) => {
                const freshTs = exists ? (data.updatedAt?.toMillis?.() ?? null) : null;
                const tsMismatch = loadedUpdatedAt !== null && freshTs !== null && freshTs !== loadedUpdatedAt;
                const unknownButOthers = baselineUnknown && freshTs !== null
                    && data.updatedBy && data.updatedBy !== currentUser;
                return (tsMismatch || unknownButOthers) ? { by: data.updatedBy || 'Someone', at: data.updatedAt || null } : null;
            };
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
                    status.textContent = 'Not saved — refresh the page to see the latest version.';
                    status.className   = 'links-save-status err';
                }
            };

            let committed = false;
            try {
                await writeWithClaimRetry(() => runTransaction(db, async (/** @type {any} */ tx) => {
                    const snap = await tx.get(designRef);
                    const c = conflictOf(snap.data() || {}, snap.exists());
                    if (c) { const e = /** @type {any} */ (new Error('concurrent-edit')); e.conflict = c; throw e; }
                    tx.set(designRef, buildDoc());
                }));
                committed = true;
            } catch (txErr) {
                const _e = /** @type {any} */ (txErr);
                if (_e && _e.message === 'concurrent-edit') {
                    // The transaction saw a co-editor's newer version. Ask; on overwrite write
                    // UNCONDITIONALLY (the user accepted the replace) — a plain setDoc, which also
                    // queues offline. On decline, stop without writing.
                    if (!await confirmOverwrite(_e.conflict)) { markNotSaved(); return; }
                    await writeWithClaimRetry(() => setDoc(designRef, buildDoc()));
                    committed = true;
                }
                // else: offline / transaction unsupported → fall through to the legacy path below.
            }
            if (!committed) {
                // Legacy fallback (offline, or the transaction failed for a non-conflict reason):
                // getDoc-check then a queued setDoc, exactly as before the transaction was added.
                try {
                    const fresh = await getDoc(designRef);
                    const c = conflictOf(fresh.data() || {}, fresh.exists());
                    if (c && !await confirmOverwrite(c)) { markNotSaved(); return; }
                } catch { /* offline — no reachable server state to compare; proceed with the queued write */ }
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
                loadedUpdatedAt = after.data()?.updatedAt?.toMillis?.() ?? null; baselineUnknown = false;
                if (entry) entry.updatedAt = after.data()?.updatedAt;
            } catch { loadedUpdatedAt = null; baselineUnknown = true; }
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
            let legacyData = null;
            for (const d of snap.docs) {
                const data = d.data();
                if (typeof data.name === 'string' && data.name.trim()) {
                    named.push({
                        id:        d.id,
                        name:      data.name.trim(),
                        patterns:  data.patterns || {},
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

            if (designs.length > 0) {
                // Re-open the design that was active last visit, else the first
                const d = designs.find(x => x.id === lsGet(ACTIVE_KEY)) || designs[0];
                activeDesignId  = d.id;
                lsSet(ACTIVE_KEY, d.id);
                design          = { id: d.id, name: d.name, patterns: deepCopyPatterns(d.patterns) };
                loadedUpdatedAt = d.updatedAt?.toMillis?.() ?? null; baselineUnknown = false;
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
        updateSaveBtn();
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
                ]}],
            },
            'links-checks': {
                title: 'Design checks',
                sections: [{ items: [
                    { icon: '🔄', html: '<strong>All lines designed</strong> — every one of the 28 rotating lines must carry a real pattern. A line that is all rest days is unfinished (not a vacancy), and the link can\'t be authorised until they are all filled.' },
                    { icon: '✅', html: '<strong>Weekends off</strong> — a full weekend = Saturday rest + the following Sunday rest. Aim for at least 40% of weeks.' },
                    { icon: '⏱️', html: '<strong>Rest between shifts</strong> — checks every transition across the rotation for less than 12 hours rest. Late-to-early next morning is the classic short turnaround.' },
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
    // BETA NOTICE LIGHTBOX — shown once on first visit
    // ============================================
    (function () {
        const NOTICE_DATE = '9 Jun 2026';
        const BETA_KEY    = 'myb_links_beta_seen';
        if (lsGet(BETA_KEY)) return;
        if (isNoticeExpired(NOTICE_DATE)) { lsSet(BETA_KEY, '1'); return; }

        const lb = document.getElementById('betaLightbox');
        if (!lb) return;

        const beta = createLightbox({
            overlay:  lb,
            content:  /** @type {HTMLElement} */ (document.getElementById('betaLightboxContent')),
            closeBtn: /** @type {HTMLElement} */ (document.getElementById('betaLightboxClose')),
            onClose() {
                lsSet(BETA_KEY, '1');
                archiveNotice({
                    id:      'links-beta-2026',
                    title:   'Links Workspace',
                    section: 'Links',
                    date:    NOTICE_DATE,
                    body:    'The Links workspace is in early beta — a working sketch for designing the 28-line link. Changes here only affect the link-design document, never the live roster.',
                });
            },
        });

        beta.open();
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
