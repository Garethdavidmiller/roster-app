// @ts-check
/**
 * links-app.js — Coordinator for links.html.
 *
 * Owns: auth guard, Firestore load/save for named link-design documents,
 *   the design grid (ROTATING_LINES rows), design picker, compare mode, paint-mode brush bar,
 *   coverage analysis, design quality checks, and the auto-generator.
 * Pure maths (classifyShift, calcCoverage, generatePatterns, runDesignChecks)
 *   live in links-design.js — no DOM, no Firebase there.
 */

import { CONFIG, weeklyRoster, escapeHtml } from './roster-data.js';
import { printedStamp, formatClock, formatDayMonthYear } from './date-format.js';
import { db, doc, getDoc, setDoc, addDoc, deleteField, collection, getDocs, serverTimestamp, runTransaction, COLLECTIONS, writeWithClaimRetry } from './firebase-client.js';
import { initNavPanel, archiveNotice } from './nav-panel.js';
import { initLoginOverlay, dismissLoginOverlay } from './login-overlay.js';
import { getSession, ensureNamedSession, sessionReady, resolveSession, reconcileExpiredIdentity } from './session.js';
import { requirePage, canOpenOvertime } from './auth-policy.js';
import { initCardCollapse, createLightbox, confirmDialog, promptDialog, openNoticeIfClear } from './overlay.js';
import { openOptionSheet, readGroups } from './select-sheet.js';
import { MAX_DESIGN_NAME, checkName, proposeCopyName } from './links-design-naming.js';
import { createDesignHeader, proposeNewDesignName, lastSaveTime } from './links-design-header.js';
import { initAboutLightbox } from './about-lightbox.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { CARD_TIPS } from './links-tips.js';
import { registerServiceWorker } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';
import { initPasswordForce } from './password-force.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency, markPageReady } from './perf-reporter.js';
import { lsGet, lsSet } from './ls.js';
import {
    DAYS,
    ROTATING_LINES,
    DEFAULT_MAX_RUN,
    classifyShift,
    normaliseCustomShift,
    calcCoverage,
    generateLink,
    CONTRACTED_HOURS_PER_WEEK,
    hmFromHours,
    lineTotals,
    weeklyHours,
    MIN_REST_MINUTES,
} from './links-design.js';
import { initLinksAnalysis } from './links-analysis.js';
import { LEGACY_DOC_ID, deepCopyPatterns, designFromDoc, binEntryFromDoc, docPayload, workingCopy, binEntryFrom, restoredEntryFrom, lastSavedLabel, recordSave, isPre26Design, PREVIOUS_LINK_LENGTH } from './links-design-doc.js';
import { createDesignLibrary } from './links-design-library.js';
import { DEFAULT_SHIFT_TIMES } from './links-default-targets.js';
import { PROPOSALS, isProposalId, proposalById, proposalCopyName } from './links-proposals.js';
import { createTargetPanel } from './links-generator-targets.js';
import { reorderLines, applyOrder, cost, DEFAULT_BLOCK_TARGET } from './links-adjacency.js';
import { normaliseWindow, formatWindow, isDefaultWindow, isValidWindowRow, canonicaliseWindowTime } from './links-window.js';
import { formatClockInput } from './clock-input.js';
import { printOrExplain, explainNoPrint } from './print-guard.js';
import { assessFatigue } from './links-fatigue.js';
import { initLinksCompare } from './links-compare.js';
import { baselineFromEntry } from './links-concurrency.js';
import { createDesignStore } from './links-design-store.js';
import { setStatus } from './status-text.js';
import { unconfirmedWriteLine } from './claim-retry.js';
import { guardNamedSession, askBeforeSignOut, signOutAndLeave, warnOnUnload, reloadIfRestoredForSomeoneElse } from './page-session.js';
import {
    isDeleted, canSoftDelete, sortByDeleted,
} from './links-deletion.js';


/**
 * Phase 4a.2 (AUTH_ARCHITECTURE.md): the coordinator body is an exported init()
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
    reloadIfRestoredForSomeoneElse();
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

    // Page-access decision via the Phase-3 policy (auth-policy.js → AUTH_ARCHITECTURE.md Phase 5).
    // The "local-derived" snapshot maps the localStorage session to an identity status — present →
    // 'named' (optimistic fast render from local), absent → 'signedOut' — and requirePage applies the
    // Links policy (designer-only). Behaviour is identical to the prior two-gate form; this routes the
    // same decision (the LINKS_DESIGNERS membership test now lives in rolesFor) through the shared
    // authz layer instead of an inline CONFIG.LINKS_DESIGNERS check.
    const _access = requirePage({ status: currentUser ? 'named' : 'signedOut', member: currentUser }, 'links');
    if (_access.decision === 'login') {
        // Not signed in → show the shared in-place sign-in (no redirect). On success, re-invoke init()
        // in place (the authorised body below never ran on this pass, so re-entering runs it exactly
        // once with the just-saved session — no reload, no double-wiring). Do NOT resolveSession(false)
        // here, or the one-shot sessionReady is poisoned before the in-place pass can resolve it true.
        // (AUTH_ARCHITECTURE.md Phase 9.)
        // In-place re-invocation falls back to a reload if init() throws mid-wiring, so the in-place
        // path is never less robust than the reload path (the overlay is already torn down by then).
        // Reload (fresh overlay) rather than re-invoke init() into a soft-lock if saveSession
        // silently failed (iOS private mode) and getSession() is still null. See operations-app.js.
        const onSuccess = () => { try { if (!getSession()) { window.location.reload(); return; } init(); } catch { window.location.reload(); } };
        initLoginOverlay({ pageLabel: 'Links', onSuccess });
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
    // session could not be confirmed.
    const _linksAuth = ensureNamedSession(currentUser);
    resolveSession(_linksAuth);
    // An own session that cannot be confirmed signs in again now; one revoked LATER does too
    // (page-session.js — the same follow-up every named page runs).
    guardNamedSession({ page: 'links', pageLabel: 'Links', member: currentUser, established: _linksAuth });

    // ============================================
    // PAGE INIT
    // ============================================
    document.body.classList.add('auth-ready');
    // The page's content is on screen from this line: `.container` is `display:none` until
    // `auth-ready`, so everything before it was a blank page (v20.80). See markPageReady.
    markPageReady();

    /** @type {any} */ let openAboutLightbox = null;
    /** The About panel's CLOSE, exposed for the same reason as its open: the panel is built inside
     *  its own IIFE, and "How this workspace works" — a row INSIDE that panel — has to dismiss it
     *  before opening the orientation lightbox, from a block further down the file. */
    /** @type {any} */ let closeAboutLightbox = null;

    initNavPanel({
        // Drawer Circular/Newsletter read waits for the session (AUTH_PLAN.md → E1).
        authReady: sessionReady,
        currentPage:     'links',
        memberName:      currentUser,
        isAdmin,
        isLinksDesigner: true,
        canOpenOvertime: canOpenOvertime(currentUser),
        onLogoClick:     () => openAboutLightbox?.(),
        // Asked BEFORE the drawer releases this device's push record, so a cancel leaves it intact.
        beforeSignOut: askBeforeSignOut(() => dirty),
        onSignOut:     () => signOutAndLeave({ to: './' }),
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
    //
    // The MAIN roster only, since v19.98. The December 2026 link is the CEA roster WIDENED (20 → 24
    // lines at v20.01) and does not take on the bilingual roster's work, so offering the bilingual times
    // would put ten shifts in the brush bar and the cell dropdown that no line in this design can
    // legitimately work. All ten are bilingual-only — there is zero overlap with main's 18 — so
    // this removes exactly those and nothing a designer needs.
    const { EARLY_SHIFTS, LATE_SHIFTS } = (() => {
        const all = new Set();
        for (const roster of [weeklyRoster]) {
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

    // The DROPDOWNS offer the roster's times AND the ones the default target table proposes
    // (v21.00), so a cell can always be changed to any time the workspace knows about.
    //
    // A design generated from the default is built out of times the roster has never worked, so a
    // dropdown listing only the roster leaves a designer unable to change one row to another row's
    // time — the values are right there on screen and unselectable, with `Custom time…` and a
    // re-typed clock as the only route. That is a hole, and a `<select>` costs nothing to lengthen.
    //
    // The BRUSH BAR is a different question and is answered in `renderBrushBar` — it offers the
    // times THIS DESIGN is made of, which is neither of these lists.
    const { EARLY_OPTIONS, LATE_OPTIONS } = (() => {
        const early = new Set(EARLY_SHIFTS), late = new Set(LATE_SHIFTS);
        for (const t of DEFAULT_SHIFT_TIMES) {
            const cls = classifyShift(t);
            if (cls === 'early') early.add(t);
            else if (cls === 'late') late.add(t);
        }
        return { EARLY_OPTIONS: [...early].sort(), LATE_OPTIONS: [...late].sort() };
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
    /** Designs with a save in flight — by id, or by working copy before the first save. Their Save
     *  stays disabled and a second press is ignored; PER DESIGN, so a write that cannot finish (no
     *  signal) never locks every other design's Save with it (Sep 2026 re-review). */
    const savingKeys = new Set();
    const savingHere = () => savingKeys.has(activeDesignId ?? design);
    /** Bumped whenever another design becomes the working copy, so a save that lands after a
     *  switch knows the page no longer shows what it saved (see `saveChanges`). */
    let activation = 0;
    let loadFailed      = false;
    // The concurrency baseline. `loadedRevision` is the exact identity (v22.18) and moves only to
    // a revision this page committed or read; `loadedUpdatedAt` is the fallback for a design nobody
    // has saved since. Why a revision at all: links-concurrency.js, `conflictOf` path 0.
    /** @type {number|null} */ let loadedRevision = null;
    /** @type {any} */ let loadedUpdatedAt = null;   // millis
    // True when a post-save updatedAt read-back FAILED: the baseline is unknown, not "no doc".
    // The overwrite-confirm guard then falls back to comparing updatedBy — without this, one
    // dropped read-back silently disabled the guard and the next save clobbered a co-designer's
    // version with no prompt (v16.69 review fix).
    let baselineUnknown = false;

    // Paint-mode brush: string = armed shift, null = no brush
    /** @type {any} */ let brush = null;

    // Generator targets
    /** @type {Array<{time:string, weekday:number, sat:number, sun:number}>} */

    // Multi-design state
    /** @type {Array<{id:string, name:string, patterns:Object, window?:*, updatedAt:*, savedAt?:Date, updatedBy:string, revision?:number|null}>} */
    let designs         = [];
    /** @type {any} */ let activeDesignId  = null; // null = design not yet saved to Firestore
    /** The built-in proposal whose unsaved working copy is open (links-proposals.js), or null. A
     *  proposal is opened with NO activeDesignId, so no write path can ever address it. */
    /** @type {string|null} */ let activeProposalId = null;
    let binnedOnLoad = 0;
    const PROPOSAL_ENTRIES = PROPOSALS.map(p => ({ id: p.id, name: p.name, ref: p.ref, patterns: p.patterns, window: null, updatedAt: null, updatedBy: '' }));
    /** The import panel and the Recently deleted bin (links-design-library.js), built once the store
     *  exists. Null until then, so anything that renders before it reads an empty bin. @type {any} */
    let library = null;
    /** The bin, newest first — owned by the library. */
    const _bin = () => library ? library.binList() : [];

    // Read-only analysis panels (Coverage heat map + Design quality checks) — extracted to
    // links-analysis.js (v17.70). They read only the live active design, via this getter.
    /**
     * The CURRENT link's fatigue profile, for comparison (v19.46; main-only since v19.98).
     *
     * Computed over the REAL main rotation at its OWN length — 20 lines, never padded or spliced.
     * Two things this must not become:
     *
     * **Do not splice cycles together.** Concatenating main and bilingual reported a longest run of
     * 19 days, which is a property of the JOIN rather than of either roster. That was the v19.46
     * reason for measuring each separately, and it still applies to any future pairing.
     *
     * **The bilingual row is gone, and the summary says why rather than leaving a hole.** A design
     * is now the main roster WIDENED (20 → 26 lines) and excludes the bilingual roster entirely, so a
     * bilingual figure would be a comparison against a rotation the proposal does not replace. The
     * summary names the comparator — the main 20-line cycle, which the design replaces — and reads
     * the length from `ROTATING_LINES` rather than restating it,
     * so its absence reads as a decision and not as a missing number.
     */
    function currentLinkBaseline() {
        try {
            const toPatterns = (/** @type {any} */ cycle) => {
                /** @type {Record<string, any>} */ const p = {}; let i = 1;
                for (const k of Object.keys(cycle)) p[String(i++)] = cycle[k];
                return { p, lines: i - 1 };
            };
            const main = toPatterns(weeklyRoster);
            const a = assessFatigue(main.p, main.lines);
            const pick = (/** @type {any} */ r, /** @type {string} */ code) =>
                r.results.find((/** @type {any} */ x) => x.code === code && x.status !== 'n/a');
            const ff11a = pick(a, 'FF11');
            const ff15a = pick(a, 'FF15');
            return {
                summary: `Today's link already features ${a.present} of these factors on the main ${main.lines}-line cycle,`
                    + ` which this ${TOTAL_POS}-line design replaces.`,
                detail: `Longest run without a 48h break: ${ff11a?.value}, against FF11's 13.`
                    + ` Longest run of consecutive early starts: ${ff15a?.value}, against FF15's 4.`
                    + ` Measured on the main cycle at its own length, not spliced into one rotation.`,
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
        // The boxes are a numeric keypad on a phone, and that keypad has no colon (v24.61, iOS audit):
        // "0730" typed there was reverted as not a time. Shape it as it is typed, as the admin week
        // grid does; `commit` below still canonicalises and validates what is finally there.
        for (const row of /** @type {const} */ (['monSat', 'sun'])) {
            for (const el of [els[row].start, els[row].end]) {
                el?.addEventListener('input', () => { el.value = formatClockInput(el.value); });
            }
        }

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
            compare.renderCompare();   // the column heads and the analysis read the window too (v24.25)
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
            compare.renderCompare();
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
        // A thunk, not a value: `compare` is the single source of truth for compare mode and is
        // declared further down. Reading it lazily also means the strip cannot go stale — every
        // path that toggles compare already re-renders the grid, and the grid renders this.
        isComparing: () => compare.isCompareMode(),
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
        const known = new Set([...EARLY_OPTIONS, ...LATE_OPTIONS]);
        const isUnknown = currentVal && currentVal !== 'RD' && currentVal !== 'SPARE' && !known.has(currentVal);
        return [
            ...(includeRdSpare ? [opt('RD', 'RD — Rest Day'), opt('SPARE', 'SPARE — Standby')] : []),
            ...(isUnknown ? (includeRdSpare
                ? ['<optgroup label="Current">', opt(currentVal, `${currentVal} (current)`), '</optgroup>']
                : [opt(currentVal, currentVal)]) : []),
            ...(EARLY_OPTIONS.length ? [
                `<optgroup label="Early${includeRdSpare ? ' (starting before 11:00)' : ''}">`,
                ...EARLY_OPTIONS.map(s => opt(s, s)), '</optgroup>',
            ] : []),
            ...(LATE_OPTIONS.length ? [
                `<optgroup label="Late${includeRdSpare ? ' (starting 11:00 or after)' : ''}">`,
                ...LATE_OPTIONS.map(s => opt(s, s)), '</optgroup>',
            ] : []),
            // 'Custom…' — the brush chip's label: on a phone this select is 16px (the iOS-zoom
            // rule) in a deliberately narrow column, so the longer text cut itself mid-word.
            opt('__custom__', 'Custom…'),
        ].join('');
    }

    // Compare mode — extracted to links-compare.js (v17.71). It OWNS compareMode/compareDesignId
    // (single source of truth); the coordinator only reads them (compare.isCompareMode/getCompareId)
    // or resets them (compare.resetCompare). Placed after emptyPattern/isUnfilledPattern (const
    // arrows) so those injected deps exist; the render deps are hoisted function declarations.
    const compare = initLinksCompare({
        getDesigns: () => [...designs, ...PROPOSAL_ENTRIES], getActiveDesignId: () => activeDesignId ?? activeProposalId, getDesign: () => design,
        renderDesignPicker, renderGrid, renderBrushBar, dearmBrush, emptyPattern, isUnfilledPattern, shiftLabel,
    });

    // ============================================
    // DESIGN MANAGEMENT
    // ============================================

    /** @type {ReturnType<typeof createDesignHeader>|null} the masthead (links-design-header.js) */
    let header = null;
    /** Both Save buttons — the masthead's and the sticky row's. One label, one state. */
    const _saveBtns = () => /** @type {HTMLButtonElement[]} */ (['linksSaveBtnTop', 'linksSaveBtn'].map(id => document.getElementById(id)).filter(Boolean));
    const _headerState = () => ({
        designs, activeId: activeDesignId, design, dirty, currentUser, saving: savingHere(),
        canDelete: canSoftDelete(designs.length), proposals: PROPOSAL_ENTRIES, proposalId: activeProposalId,
    });

    /** Wire the masthead + its two sheets (picker, ··· More), once. The More rows keep their ids. */
    function initDesignPicker() {
        const $ = (/** @type {string} */ id) => document.getElementById(id);
        const onRename = () => { if (activeDesignId) renameDesign(activeDesignId); };
        header = createDesignHeader({
            pickList: $('designPickList'), pickerSub: $('designPickerSub'), pickerButton: /** @type {HTMLButtonElement|null} */ ($('designPickerBtn')),
            faceName: $('designFaceName'), eyebrow: $('designEyebrow'), count: $('designCount'),
            masthead: $('designMasthead'), avatar: $('designAvatar'),
            whoName: $('designWhoName'), whoRole: $('designWhoRole'),
            status: $('designStatus'), statusLong: $('designStatusLong'), statusShort: $('designStatusShort'),
            saveButtons: _saveBtns(),
            renameButtons: /** @type {HTMLButtonElement[]} */ ([$('designRenameBtn')].filter(Boolean)),
            // Disabled state ONLY (v23.33) — click is wired via `sheetActions`; listing it in
            // `renameButtons` would fire it twice. Same split as `deleteButton`.
            renameMenuButton: /** @type {HTMLButtonElement|null} */ ($('designRenameMenuBtn')),
            deleteButton: /** @type {HTMLButtonElement|null} */ ($('designDeleteBtn')),
            sheetAvatar: $('designSheetAvatar'), sheetName: $('designSheetName'), sheetSub: $('designSheetSub'),
        }, { onSelect: selectDesign, onRename }, {
            moreButton: /** @type {HTMLButtonElement|null} */ ($('designMoreBtn')),
            sheet:  { overlay: $('designMoreLb'),   content: $('designMoreContent'),   closeBtn: $('designMoreClose'),   initialFocus: $('dupDesignBtn'), create: createLightbox },
            picker: { overlay: $('designPickerLb'), content: $('designPickerContent'), closeBtn: $('designPickerClose'), create: createLightbox },
            sheetActions: [
                [$('dupDesignBtn'), duplicateDesign], [$('designRenameMenuBtn'), onRename], [$('compareBtn'), compare.toggleCompareMode],
                [$('newDesignBtn'), createDesign], [$('importDesignBtn'), () => library?.openImport()], [$('designDeleteBtn'), () => { if (activeDesignId) deleteDesign(activeDesignId); }],
            ],
        });
        $('compareChips')?.addEventListener('click', e => {
            const nameBtn = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.design-chip-name'));
            if (nameBtn) compare.selectCompareDesign(nameBtn.dataset.id);
        });
        // The empty state's two actions (v19.66): blank → the same `createDesign`; the primary one
        // only SCROLLS — a Generate fired from an empty card builds a design nobody chose.
        $('linksEmptyNew')?.addEventListener('click',    createDesign);
        $('linksEmptyProposals')?.addEventListener('click', () => $('designPickerBtn')?.click());
        $('linksEmptyGenerate')?.addEventListener('click', () => {
            _openGenerator();
            document.getElementById('generatorCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }
    initDesignPicker();

    /** Repaint the masthead, the sheet and the compare picker from the current state. */
    function renderDesignPicker() {
        const wrap           = document.getElementById('designPickerWrap');
        const compareChipsEl = document.getElementById('compareChips');
        const comparePickerRow = document.getElementById('comparePickerRow');
        const compareBtn     = /** @type {HTMLButtonElement|null} */ (document.getElementById('compareBtn'));
        const dupBtn         = /** @type {HTMLButtonElement|null} */ (document.getElementById('dupDesignBtn'));
        if (!wrap) return;

        wrap.style.display = '';   // ALWAYS shown (v19.43): the empty state points at the sheet
        // Recently-deleted row: present only when the bin has something in it.
        const binBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('designBinBtn'));
        if (binBtn) {
            binBtn.style.display = _bin().length > 0 ? '' : 'none';
            const label = binBtn.querySelector('span:last-child');
            if (label) label.textContent = `Recently deleted (${_bin().length})`;
        }

        header?.render(_headerState());

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
            compareBtn.disabled = !design || designs.length + PROPOSAL_ENTRIES.length < 2;
            compareBtn.classList.toggle('compare-active', cmpMode);
            compareBtn.setAttribute('aria-pressed', cmpMode ? 'true' : 'false');
            const lbl = document.getElementById('compareBtnLabel');
            if (lbl) lbl.textContent = cmpMode ? 'Stop comparing' : 'Compare with…';
        }

        // Compare picker row
        if (comparePickerRow) comparePickerRow.style.display = cmpMode ? '' : 'none';
        if (cmpMode && compareChipsEl) {
            compareChipsEl.innerHTML = [...designs, ...PROPOSAL_ENTRIES]
                .filter(d => d.id !== (activeDesignId ?? activeProposalId))
                .map(d => {
                    const isActive = d.id === cmpId;
                    return `<div class="design-chip${isActive ? ' design-chip--active' : ''}">` +
                        `<button class="design-chip-name" data-id="${escapeHtml(d.id)}" type="button">` +
                        `${escapeHtml(d.name)}</button></div>`;
                }).join('');
        }
    }


    /** Surface a design create/rename/duplicate outcome (or a client-side validation error) on the
     *  shared save-status line, so a rules rejection is never silent. @param {string} msg @param {'ok'|'err'} [kind] */
    function _designActionStatus(msg, kind = 'err') {
        const status = document.getElementById('linksSaveStatus');
        if (status) { status.textContent = msg; status.className = 'links-save-status ' + kind; }
    }

    /** Decide a typed design name — length AND the ambiguous-duplicate rule (links-design-naming.js).
     *  Returns true (and shows why) when the name may not be used. @param {string} name @param {string|null} [exceptId] */
    function _designNameRejected(name, exceptId = null) {
        const v = checkName(name, { existing: designs, exceptId, noun: 'design' });
        if (!v.ok) _designActionStatus(v.message || 'That name cannot be used.');
        return !v.ok;
    }

    /** Create a new blank design. */
    async function createDesign() {
        // Ask about unsaved work FIRST (v19.38). This used to run after the name prompt, so you typed
        // a name and were only then asked whether to abandon your changes — the decision that might
        // cancel the whole action came last.
        if (dirty && !await confirmDialog({ message: 'You have unsaved changes in the current design. Create a new one anyway?', confirmLabel: 'Create new' })) return;
        const name = (await promptDialog({ title: 'New design', message: 'Name for this design (e.g. "Option A"):', placeholder: 'Option A', maxLength: MAX_DESIGN_NAME, confirmLabel: 'Create' }))?.trim();
        if (!name) return;
        if (_designNameRejected(name)) return;
        try {
            // A blank design starts on the app default window — docPayload normalises it. The
            // store arms the baseline from the server, so the FIRST content-save is guarded;
            // without that a new design carried updatedAt:null, the guard read it as "nothing to
            // compare", and a concurrent edit was clobbered silently.
            const { id: newId, updatedAt: createdTs, baseline: newBase } = await store.create(
                docPayload({ name, patterns: {}, window: null },
                           { updatedBy: currentUser, updatedAt: serverTimestamp() }));
            const d = restoredEntryFrom({ id: newId, name, patterns: {}, window: null }, { updatedAt: createdTs, updatedBy: currentUser, revision: newBase.loadedRevision });
            designs.push(d);
            _sortDesigns();
            _activateDesign(d);
        } catch (err) {
            console.error('[Links] Create design failed:', err);
            _designActionStatus(unconfirmedWriteLine(err, 'this change', 'the design list') ?? 'Couldn’t create the design — check your connection and try again.');
        }
    }

    // IMPORT and the RECENTLY DELETED bin are links-design-library.js (v24.51) — wired below, after the store.

    /** Duplicate the current design as a new named design.
     * Copies the LIVE in-memory patterns, so unsaved edits are included —
     * "duplicate what I'm looking at", not "duplicate the last save".
     * @param {boolean} [originalGone] the copy rescues a design deleted elsewhere — there is no
     *   original to "go back to its last save", so that confirm would describe a thing not there. */
    async function duplicateDesign(originalGone = false) {
        if (!activeDesignId || !design) return;
        // The fifth path that can lose the working copy to start asking (v22.62; import the sixth).
        // Its wording is deliberately NOT the others' "changes will be lost" — the copy is taken
        // from the LIVE patterns, so the work goes INTO it and the original reverts to its last
        // save. Full reasoning: `.claude/rules/links-design.md`. Asked before the name prompt, per
        // `createDesign`: the decision that might cancel the action must not come last.
        if (dirty && !originalGone && !await confirmDialog({
            message: 'Your unsaved changes will go into the copy, and "' + (design.name || 'this design')
                   + '" will go back to its last save. Duplicate anyway?',
            confirmLabel: 'Duplicate',
        })) return;
        const name = (await promptDialog({ title: 'Duplicate design', message: 'Name for the duplicate:', defaultValue: proposeCopyName(design.name || 'Design', designs), maxLength: MAX_DESIGN_NAME, confirmLabel: 'Duplicate' }))?.trim();
        if (!name) return;
        if (_designNameRejected(name)) return;
        const patterns = deepCopyPatterns(design.patterns);
        // A duplicate inherits the window it was designed to. Copying the patterns alone would
        // silently re-base the copy on the standard hours, which is the one thing a designer
        // duplicating a moved-boundary proposal is least likely to notice.
        const window = normaliseWindow(design.window);
        try {
            const { id: dupId, updatedAt: dupTs, baseline: dupBase } = await store.create(
                docPayload({ name, patterns, window },
                           { updatedBy: currentUser, updatedAt: serverTimestamp() }));
            const d = restoredEntryFrom({ id: dupId, name, patterns, window }, { updatedAt: dupTs, updatedBy: currentUser, revision: dupBase.loadedRevision });
            designs.push(d);
            _sortDesigns();
            _activateDesign(d);
        } catch (err) {
            console.error('[Links] Duplicate design failed:', err);
            _designActionStatus(unconfirmedWriteLine(err, 'this change', 'the design list') ?? 'Couldn’t duplicate the design — check your connection and try again.');
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
        const name = (await promptDialog({ title: 'Rename design', message: 'New name:', defaultValue: d.name, maxLength: MAX_DESIGN_NAME, confirmLabel: 'Rename' }))?.trim();
        if (!name || name === d.name) return;
        if (_designNameRejected(name, d.id)) return;
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
            // The transaction, the baseline decision and the offline fallback are the store's
            // (v21.87). What stays here is the naming of a thing on screen.
            const _preBaseline = (id === activeDesignId) ? loadedUpdatedAt : (d.updatedAt?.toMillis?.() ?? null);
            const _preRevision = (id === activeDesignId) ? loadedRevision : (d.revision ?? null);
            const { baselineFresh, updatedAt: renamedAt, revision: renamedRev } = await store.rename(
                { id, name, by: currentUser, preBaseline: _preBaseline, preRevision: _preRevision });
            d.name = name;
            if (id === activeDesignId && design) design.name = name;
            if (baselineFresh) {
                d.updatedBy = currentUser;
                if (renamedAt) { d.updatedAt = renamedAt; delete d.savedAt; }   // server time wins (see recordSave)
                // The rename COMMITTED a revision it knows, so the entry and the baseline both move
                // to that rather than to whatever a read-back happened to see (v22.18).
                if (typeof renamedRev === 'number') d.revision = renamedRev;
                if (id === activeDesignId) {
                    loadedUpdatedAt = d.updatedAt?.toMillis?.() ?? loadedUpdatedAt;
                    if (typeof renamedRev === 'number') loadedRevision = renamedRev;
                    updateLastSaved(d.updatedBy, lastSaveTime(d));
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
            _designActionStatus(unconfirmedWriteLine(err, 'this change', 'the design list') ?? 'Couldn’t rename the design — check your connection and try again.');
        }
    }

    /**
     * Delete a design — a SOFT delete since v19.41: it moves to "Recently deleted", where it can be
     * restored, instead of being destroyed on the spot. It stays there until a designer removes it
     * for good; nothing expires it (automatic expiry was removed at v24.10 — see `links-deletion.js`).
     * The last LIVE design can't be deleted — the ✕ button is disabled in that state, so this
     * guard is just a backstop.
     * @param {any} id
     */
    async function deleteDesign(id) {
        if (!canSoftDelete(designs.length)) return;
        const d = designs.find(x => x.id === id);
        if (!d) return;
        // ── UNSAVED WORK IS NOT IN THE BIN (v22.56, external review) ────────────────────────
        // Recently deleted holds the last SAVED version. Deleting the design you are editing
        // therefore threw away every change since that save — silently, because the dialog spoke
        // only about the document. Every other path that can lose the working copy already asks:
        // New design, switching design, signing out and leaving the page. Delete was the one that
        // did not, and it is the only one of the five with no undo.
        //
        // The fix SAVES rather than warns. Told the truth, a designer's answer is almost always
        // "keep my work", and saving first puts everything in the bin — so restoring returns what
        // was on screen instead of a version from some earlier point. The review proposed a third
        // "delete without saving" button; that needs a three-action dialog, and `confirmDialog`
        // lives in shared `overlay.js`, which every lightbox on all seven pages is built from. Not
        // a change to make for a convenience on one path used by three people — and discarding is
        // still available by cancelling and switching away, which already offers it.
        if (id === activeDesignId && dirty) {
            if (!await confirmDialog({
                title: 'Delete design',
                message: `"${d.name}" has unsaved changes.\n\nRecently deleted keeps the last saved version, so those changes would be lost.\n\nSaving first means the deleted copy has everything — restoring it brings back what is on screen now.`,
                confirmLabel: 'Save, then delete',
                danger: true,
            })) return;
            await saveChanges();
            // `saveChanges` clears `dirty` only when the write actually landed, and it can end
            // somewhere else entirely — a declined overwrite, a design deleted by somebody else, a
            // fork into a duplicate that becomes the active design. Any of those means the delete
            // this dialog described is no longer the one that would happen, so stop and say so
            // rather than deleting against a state nobody agreed to.
            if (dirty || activeDesignId !== id) {
                _designActionStatus(`Couldn’t save "${d.name}", so nothing was deleted.`);
                return;
            }
        } else if (!await confirmDialog({
            title: 'Delete design',
            // States what actually happens (v19.96). It promised "the next 30 days" while nothing
            // has expired a design since v19.86 — an under-promise, but the bin's own intro says
            // the opposite two taps later, and a designer who believes a deadline may hurry.
            message: `Delete "${d.name}"?\n\nIt moves to Recently deleted, where it stays until someone restores it or removes it for good.`,
            confirmLabel: 'Delete',
            danger: true,
        })) return;
        try {
            await store.softDelete(id, currentUser);
            designs = designs.filter(x => x.id !== id);
            // deletedAt is null until the server resolves it — deliberately kept as null rather
            // than stamped with a client clock, so the row reads "Deleted by X" until the real
            // time is known instead of showing a countdown built from an invented figure.
            library.addToBin(binEntryFrom(d, currentUser));
            const newActive = (id === activeDesignId) ? designs[0] : null;
            // Exit compare mode if the compare target was deleted, the delete drops below the 2
            // designs compare needs, OR the newly-promoted active design IS the current compare
            // target — otherwise a design would be compared against ITSELF (every cell "identical",
            // its compare chip filtered out) until the user manually toggles compare off. Deleting
            // the ACTIVE design while comparing also used to leave a <2-design self-compare soft-lock.
            const cmpId = compare.getCompareId();
            if (id === cmpId || designs.length + PROPOSAL_ENTRIES.length < 2 || (newActive && newActive.id === cmpId) || !newActive) {
                compare.resetCompare();
            }
            if (newActive) _activateDesign(newActive);
            else { renderDesignPicker(); renderGrid(); compare.renderCompare(); }
        } catch (err) {
            console.error('[Links] Delete failed:', err);
            // Was console-only: a rules rejection or a dropped connection looked like the button
            // simply doing nothing. Every other design action surfaces here (v19.41).
            _designActionStatus(unconfirmedWriteLine(err, 'this change', 'the design list') ?? 'Couldn’t delete the design — check your connection and try again.');
        }
    }

    /**
     * Switch the active design. Warns if dirty.
     * @param {any} id
     */
    async function selectDesign(id) {
        if (id === activeDesignId || (id === activeProposalId && !activeDesignId)) return;
        // A switch that does NOT happen must put the picker back — `change` has already moved the
        // select. Argued in links-design-header.js's render (v23.33).
        if (dirty && !await confirmDialog({ message: 'You have unsaved changes. Switch to another design? Changes will be lost.', confirmLabel: 'Switch' })) { renderDesignPicker(); return; }
        const d = designs.find(x => x.id === id) ?? PROPOSAL_ENTRIES.find(x => x.id === id);
        if (!d) { renderDesignPicker(); return; }
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
        activation++;
        // A proposal opens as an UNSAVED working copy — no saved-design id, so save/rename/delete
        // all treat it as new and its first save creates a copy (links-proposals.js).
        activeProposalId = isProposalId(d.id) ? d.id : null;
        activeDesignId  = activeProposalId ? null : d.id;
        lsSet(ACTIVE_KEY, d.id);
        design          = workingCopy(d);
        // Derive the baseline through the tested rule rather than hardcoding `baselineUnknown =
        // false` beside a possibly-null timestamp — that pair is precisely the v17.18 bug
        // (neither a known baseline nor a flag saying it is unknown, so conflictOf reads it as
        // "safe to overwrite"). It was harmless while every entry came from the server snapshot or
        // from create/duplicate, both of which arm a real timestamp; v19.41's RESTORE added a third
        // producer whose entry can carry null, and selecting it then switched the guard off.
        ({ loadedRevision, loadedUpdatedAt, baselineUnknown } = baselineFromEntry(d));
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
        updateLastSaved(d.updatedBy, lastSaveTime(d));
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

    /**
     * The times the brush bar offers: THE ONES THIS DESIGN IS ACTUALLY MADE OF (v21.14).
     *
     * It offered the ROSTER's times from v12.09 to v21.13, and that stopped being useful the moment
     * a new design started from the designed default rather than the roster seed (v21.00). Measured
     * on the shipped default at v21.13: the bar carried 18 chips, the design on screen was built
     * from 19 times, and the OVERLAP WAS ZERO. Every chip painted a shift the design does not
     * contain, and not one of the design's own times could be painted at all — on a bar whose card
     * header says "use the Paint bar to fill cells quickly". Four default retunes widened that gap
     * one release at a time, and nothing failed, because a bar full of plausible chips looks
     * exactly like a bar that works.
     *
     * Deriving it from the design fixes it by construction and keeps fixing it: an imported
     * proposal paints in its own times, a roster-seeded design paints in the roster's, and a design
     * nobody has touched paints in the default's. It also answers the vertical-space objection the
     * old comment raised — 19 chips against 18 is not a taller page, and every one of them is now a
     * shift somewhere in the grid.
     *
     * The armed brush is unioned in so a chip can never vanish from under a designer mid-paint:
     * painting away the last cell of a time would otherwise leave the brush armed with nothing
     * highlighted. An empty design falls back to the default table, so the bar is never bare.
     */
    function brushTimes() {
        const out = new Set();
        for (const row of Object.values(design?.patterns || {})) {
            for (const s of Object.values(/** @type {any} */ (row) || {})) {
                if (s && s !== 'RD' && s !== 'OFF' && s !== 'SPARE') out.add(s);
            }
        }
        if (!out.size) for (const t of DEFAULT_SHIFT_TIMES) out.add(t);
        if (brush && brush !== 'RD' && brush !== 'SPARE') out.add(brush);
        const early = [], late = [];
        for (const s of [...out].sort()) {
            const cls = classifyShift(s);
            if (cls === 'late') late.push(s); else early.push(s);
        }
        return { early, late };
    }

    /** What the bar WOULD show, as one comparable string — see the guard in `applyShift`. */
    let _lastBrushSig = '';
    function _brushSig() {
        const { early, late } = brushTimes();
        return early.join(',') + '|' + late.join(',');
    }

    function renderBrushBar() {
        const bar = document.getElementById('brushBar');
        if (!bar) return;
        if (!design || compare.isCompareMode()) { bar.style.display = 'none'; return; }
        bar.style.display = '';
        const { early: barEarly, late: barLate } = brushTimes();
        _lastBrushSig = barEarly.join(',') + '|' + barLate.join(',');

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
                `aria-pressed="false" aria-label="Paint: ${escapeHtml(say)}">${escapeHtml(label)}</button>`;
        };

        bar.innerHTML = [
            '<span class="brush-bar-label">Paint:</span>',
            chip('RD',    'RD',     'rd',    '', 'Rest day'),
            chip('SPARE', 'SP',     'spare', '', 'Spare'),
            ...barEarly.map(s => chip(s, shiftLabel(s), 'early', '', spoken(s))),
            ...barLate.map(s  => chip(s, shiftLabel(s), 'late',  '', spoken(s))),
            `<button class="brush-chip brush-chip--custom" data-shift="__custom__" aria-pressed="false">Custom…</button>`,
        ].join('');
        // Re-apply the armed state: the chips above are brand-new elements, so a rebuild during a
        // paint session would otherwise leave the brush armed with nothing highlighted.
        if (brush) armBrush(brush);

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
            : `A link is ${TOTAL_POS} lines — everyone works line 1 one week, line 2 the next, all the way round.`;
    }

    /**
     * A design holding MORE lines than the rotation is now — and why it cannot be silent (v19.98).
     *
     * The rotation went 28 → 22 (v19.98) and then 22 → 24 (v20.01), and every design saved at an
     * older length is still in Firestore.
     * Nothing about opening one LOOKS wrong: the grid loops `1..TOTAL_POS`, so lines 23–28 simply
     * are not drawn; every analysis (`toSequence`, coverage, the checks, the fatigue factors) reads
     * the same range and therefore reports on the CURRENT length; and `workingCopy` DEEP COPIES the whole
     * patterns object, so the next save writes all 28 back. The result is a design that is assessed
     * as one thing and stored as another, indefinitely, with no symptom.
     *
     * Which half to fix was the decision. Dropping the surplus on load would destroy six lines of
     * somebody's work on a page visit — the same class of failure as the v19.84 stale hard-delete —
     * and dropping it on SAVE would do it at the moment the designer is least expecting it. So the
     * data is left exactly as it is and the fact is put on screen: the rows are dormant, the panels
     * below describe the current length, and deleting the design is the designer's call to make deliberately.
     *
     * Deliberately not a `confirm()`: it is a statement about the design, not a decision to take now.
     */
    function _renderOverLengthNotice() {
        const el = document.getElementById('linksOverLengthNotice');
        if (!el) return;
        const held = Object.keys(/** @type {Record<string, any>} */ (design?.patterns || {})).length;
        if (!design || held <= TOTAL_POS) { el.style.display = 'none'; el.textContent = ''; return; }
        el.style.display = '';
        el.textContent = `This design holds ${held} lines and the rotation is now ${TOTAL_POS}. `
            + `Lines ${TOTAL_POS + 1}–${held} are not shown and are not counted in Coverage or Design `
            + `checks, but they are still stored and are saved with the design. It was built for the `
            + `${held}-line link; build the new one fresh rather than editing this.`;
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
            if (emptyTitle) emptyTitle.textContent = loadFailed ? 'Couldn’t load your designs' : binnedOnLoad && _bin().length ? `Your ${PREVIOUS_LINK_LENGTH}-line designs are in Recently deleted` : 'No designs yet';
            if (emptyMsg) emptyMsg.innerHTML = loadFailed
                ? `Check your connection and refresh the page. Nothing has been lost — saved designs are on the server.`
                : binnedOnLoad && _bin().length ? `The link is ${TOTAL_POS} lines from December, so ${binnedOnLoad === 1 ? 'the design' : `the ${binnedOnLoad} designs`} drawn for ${PREVIOUS_LINK_LENGTH} moved there. Restore one from <strong>Recently deleted</strong>, in the <span aria-hidden="true">···</span><span class="sr-only">More</span> menu above, if you still need it.`
                : `Build a rotating pattern from staffing targets with the Auto-generate card below, open one of the shortlisted proposals, or start from an empty <span class="links-nowrap">${TOTAL_POS}-line</span> grid.`;
            if (emptyActs) /** @type {HTMLElement} */ (emptyActs).style.display = loadFailed ? 'none' : '';
            _setGridHint(false);
            _renderOverLengthNotice();   // `design` is null here, so this hides it
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

        const totals = lineTotals(design.patterns, TOTAL_POS);
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
                _totalCells(totals.rows[pos - 1]) +
                `</tr>`
            );
        }
        if (tbody) tbody.innerHTML = rows.join('');
        _renderOverLengthNotice();

        const cov = calcCoverage(design.patterns);
        renderFooter(cov, totals);
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
        // Only the EDITED row's totals are rewritten, never the whole tbody: a full re-render here
        // would tear out the cell the designer is working in — this runs from the paint brush as
        // well as from a committed dropdown, and the brush leaves the pointer over the cell.
        const totals = lineTotals(design.patterns, TOTAL_POS);
        if (tr) {
            tr.querySelectorAll('.tot-cell').forEach(el => el.remove());
            tr.insertAdjacentHTML('beforeend', _totalCells(totals.rows[Number(pos) - 1]));
        }
        renderFooter(cov, totals);
        // The bar is derived from the design (v21.14), so a paint that introduces a time — or
        // removes the last cell of one — changes what it should offer. Guarded on the SIGNATURE
        // rather than run unconditionally: `applyShift` fires once per cell during a drag-paint,
        // and rebuilding the chips on every one of those is work for nothing.
        const sig = _brushSig();
        if (sig !== _lastBrushSig) renderBrushBar();
        renderCoverageCard();
        renderDesignChecks();
    }

    /** @param {any} cov */
    /**
     * The three right-hand cells for ONE line (v21.09).
     *
     * A COVER week shows the contracted week rather than a zero — the app's settled position since
     * v20.98, that a spare week is somebody's paid week carrying no stored times — but muted and
     * titled, because it is a convention rather than a reading of the row. Its DAYS are a dash:
     * unknown, not none, since the design does not record which days a cover week works.
     *
     * An unfilled line is a dash in all three. Twenty-four rows of "0h 00m" is noise, and the row
     * already carries `row-unfilled`; a dash says the same thing without competing with the figures
     * on the lines that have been designed.
     *
     * @param {{exSundayMinutes: number, allMinutes: number, days: number|null, assumed: boolean,
     *          unreadable: number, unfilled: boolean}|undefined} t
     */
    function _totalCells(t) {
        const cell = (/** @type {string} */ text, /** @type {string} */ extra = '', /** @type {string} */ title = '') =>
            `<td class="tot-cell${extra}"${title ? ` aria-label="${escapeHtml(title)}"` : ''}>${escapeHtml(text)}</td>`;
        if (!t || t.unfilled) return cell('—') + cell('—') + cell('—');
        if (t.assumed) {
            const h = hmFromHours(t.exSundayMinutes / 60);
            const why = 'Cover week — counted as the contracted week; it carries no stored times';
            return cell(h, ' tot-assumed', why) + cell(h, ' tot-assumed', why)
                + cell('—', ' tot-assumed', 'A cover week does not record which days it works');
        }
        const flag = t.unreadable ? ' tot-uncertain' : '';
        // A line with no Sunday duty has the same figure in both hour columns, and repeated over
        // twenty rows that identical pair is what the eye has to read past to find the lines that
        // DO work a Sunday. Muting the repeat leaves those standing out on their own.
        const same = !t.unreadable && t.allMinutes === t.exSundayMinutes ? ' tot-same' : '';
        const why  = t.unreadable
            ? `${t.unreadable} duty${t.unreadable === 1 ? '' : ' times'} on this line could not be read, so these totals are a floor`
            : '';
        return cell(hmFromHours(t.exSundayMinutes / 60), flag, why)
            + cell(hmFromHours(t.allMinutes / 60), flag + same, same ? 'No Sunday duty on this line' : why)
            + cell(String(t.days ?? '—'), flag, why);
    }

    /**
     * @param {any} cov
     * @param {any} [totals]  from lineTotals — the per-line rows this footer averages
     */
    function renderFooter(cov, totals) {
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
        // THE HOURS AVERAGES ARE NOT RECOMPUTED HERE. They come from `weeklyHours`, the same call
        // the Design-checks row and the summary strip read, so the page cannot state a design's
        // hours two ways four seconds apart. Only the DAYS average is this feature's own, and it
        // uses a different divisor — working lines, not the whole rotation — because a cover week
        // does not record which days it works. Both divisors are printed for that reason.
        const wh  = weeklyHours(design.patterns, TOTAL_POS);
        const avg = (/** @type {number|null} */ v, /** @type {string} */ text, /** @type {string} */ note) =>
            `<td class="tot-cell tot-avg">` +
            (v === null ? `<span class="tot-avg-num">—</span>`
                : `<span class="tot-avg-num">${escapeHtml(text)}</span>`) +
            `<span class="tot-avg-note">${escapeHtml(note)}</span></td>`;
        const lineWord = (/** @type {number} */ n, /** @type {string} */ w) => `over ${n} ${w}${n === 1 ? '' : 's'}`;
        const avgCells = totals
            ? avg(wh.exSunday, wh.exSunday === null ? '' : hmFromHours(wh.exSunday), lineWord(TOTAL_POS, 'line'))
            + avg(wh.all, wh.all === null ? '' : hmFromHours(wh.all), lineWord(TOTAL_POS, 'line'))
            + avg(totals.daysAverage, String(totals.daysAverage ?? ''), lineWord(totals.daysLines, 'working line'))
            : '';
        tfoot.innerHTML = `<tr><td class="col-pos cov-foot-label">Cover</td>${cells}${avgCells}</tr>`;
    }

    // ============================================
    // INLINE CELL EDITING (dropdown mode)
    // ============================================

    /**
     * Open the app's own dropdown over one grid cell.
     *
     * IT USED TO SWAP THE CELL FOR A NATIVE `<select>` (v23.38 replaced it). The cell's button was
     * destroyed, a select built in its place, focused on the next frame, and restored on blur —
     * which meant the popup a designer actually chose from was the OS's, in the one card on this
     * page where the app draws every other pixel itself: the grid, the paint chips, the compare
     * diff and the heat map. On Android it arrived as a full-bleed Material sheet over a 24-line
     * rotation grid.
     *
     * The button now stays put and the sheet opens over it, which also removes the three pieces of
     * machinery that existed only to manage a control living in a cell — the `committed` flag, the
     * blur-cancels guard, and the `requestAnimationFrame` focus. There is nothing to cancel: a
     * dismissed sheet has changed nothing, and the cell was never taken apart.
     *
     * The options still come from `buildShiftOptions`, parsed by the sheet's own `readGroups` off a
     * detached `<select>` rather than rebuilt in the sheet's shape. One producer, so the brush
     * chips and this list cannot drift apart, and its `<optgroup>` labels become the sheet's
     * headings for free.
     * @param {any} btn
     */
    function openCellEdit(btn) {
        if (!design) return;
        const pos      = btn.dataset.pos;
        const day      = btn.dataset.day;
        const dayLabel = DAY_LABELS[DAYS.indexOf(day)];
        const current  = (/** @type {Record<string, any>} */ (design.patterns))[pos]?.[day] ?? 'RD';

        const holder = document.createElement('select');
        holder.innerHTML = buildShiftOptions(current, true);

        openOptionSheet({
            title: `Line ${pos} · ${dayLabel}`,
            groups: readGroups(holder),
            current,
            createLightbox,
            onPick: async value => {
                let newVal = value;
                if (newVal === '__custom__') {
                    const typed = normaliseCustomShift(
                        await promptDialog({ title: 'Custom shift', message: 'Type the shift as start–end, e.g. 06:00-14:00 (CEA shifts start between 04:00 and 20:59)', defaultValue: current.includes('-') ? current : '', placeholder: '06:00-14:00', confirmLabel: 'Set' }));
                    if (!typed) return;   // cancelled: the cell was never taken apart, so nothing to restore
                    newVal = typed;
                }
                // No `newVal === current` check here: `applyShift` has owned "is this actually a
                // change" since v19.38, where a duplicate of that decision armed the
                // unsaved-changes guard for an edit that did not happen. One owner.
                applyShift(pos, day, newVal);
            },
        });
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

    const targets = createTargetPanel({
        getActiveDesignId: () => activeDesignId,
        currentUser,
        isAdmin,
        sessionReady,
        buildShiftOptions,
        defaultSlotTime: EARLY_SHIFTS[0] || '06:20-14:20',
    });
    const refreshGenTargetsForDesign = targets.refreshForDesign;

    (function initGenerator() {
        if (!document.getElementById('genSlotRows')) return;

        // Attempt state for the explore loop (v20.07). Session-scoped on purpose: reloading and
        // pressing Generate k times replays the same k designs, so a variant is recoverable, and
        // two designers who count their presses are looking at the same design.
        let _genFingerprint = '';
        let _genAttempt = 0;
        /** @type {{c: number, n: number}|null} best-so-far on the ticked objectives */
        let _genBest = null;
        let _genLastOrder = '';

        document.getElementById('genApplyBtn')?.addEventListener('click', async () => {
            const errEl = document.getElementById('genError');
            if (errEl) errEl.textContent = '';
            // A failed press must not leave the PREVIOUS success message sitting under the button —
            // beside a fresh red error it would read as describing this press.
            const _mirrorEl = document.getElementById('genStatus');
            if (_mirrorEl) { _mirrorEl.hidden = true; _mirrorEl.textContent = ''; }

            const { slots: genSlots, spareLines: genSpareLines } = targets.getTable();
            if (genSlots.length === 0) {
                if (errEl) errEl.textContent = 'Add at least one shift row first.';
                return;
            }
            const tot = targets.totals();
            const over = ['weekday', 'sat', 'sun'].filter(c => tot[c] > TOTAL_POS);
            if (over.length) {
                if (errEl) {
                    const names = /** @type {Record<string, any>} */ ({ weekday: 'Mon–Fri', sat: 'Saturday', sun: 'Sunday' });
                    errEl.textContent = `Can't generate: ${over.map(c => `${names[c]} totals ${tot[c]}`).join(', ')} — ` +
                        `each day's total (shifts + spare) can't exceed ${TOTAL_POS} lines.`;
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
                    // `short-hours` / `over-hours` name the SIZE of the gap, because that is the only
                    // actionable fact about either. The gap is arithmetic — the duty in the table
                    // against the working lines it has to fill — so "add rows" or "take some out" is
                    // not advice, it is the whole answer, and the designer needs the number.
                    const asked = built.askedMinutes ?? 0;
                    const need = built.needMinutes ?? 0;
                    const working = built.working || 1;
                    // The SAME reading as every other hours figure on the page: each spare week
                    // counted as a full contracted week, divided by the whole rotation. A refusal
                    // quoting a different average from the row it is refusing on behalf of would be
                    // two numbers for one fact, arriving in the same second.
                    const avg = (asked + (TOTAL_POS - working) * CONTRACTED_HOURS_PER_WEEK * 60) / 60 / TOTAL_POS;
                    // One sentence of arithmetic, then the remedies — and the remedies are opposites,
                    // which is the whole reason the two refusals are not one message with a sign in
                    // it. A designer reading "add duties" under a surplus would make it worse.
                    const gap = `These targets average ${hmFromHours(avg)} a week across all `
                        + `${TOTAL_POS} lines, and the contract is ${CONTRACTED_HOURS_PER_WEEK}h.`;
                    errEl.textContent = built.reason === 'short-hours'
                        ? `Can't generate — ${gap} That is `
                          + `${hmFromHours((need - asked) / 60)} a week of duty missing across the `
                          + `rotation. Add duties, lengthen them, or use more spare weeks — spreading the `
                          + `same work over more lines cannot reach it.`
                        : built.reason === 'over-hours'
                        ? `Can't generate — ${gap} That is `
                          + `${hmFromHours((asked - need) / 60)} a week of duty more than the rotation is `
                          + `paid for. Remove duties, shorten them, or use fewer spare weeks — the surplus `
                          + `would be permanent overtime nobody has agreed to.`
                        : built.reason === 'no-rest'
                        ? `Can't generate — these targets leave no room for rest days, so every line would `
                          + `finish late and start early the next morning. Reduce a day's headcount or add spare weeks.`
                        // The one refusal whose remedy is a SHIFT TIME rather than a headcount
                        // (v21.11). It fires only when no rearrangement can give somebody the
                        // minimum rest, so it names the gap and the two times that produce it —
                        // "make the rest work" is not advice a designer can act on, and the pair is.
                        : built.reason === 'short-rest'
                        ? `Can't generate — one turn would follow another with only `
                          + `${hmFromHours((built.shortRest ?? 0) / 60)} rest, and the minimum is `
                          + `${hmFromHours(MIN_REST_MINUTES / 60)}. No arrangement of these lines fixes it. `
                          + `Move a late finish earlier or a following start later.`
                        // Reachable by TYPING a spare count the input's max doesn't stop (max only
                        // gates the spinner) with day totals that still fit. The generic message
                        // below sends the designer hunting through rows that are all fine.
                        : built.reason === 'bad-spare-lines'
                            ? `Can't generate — ${genSpareLines} spare weeks leaves no working lines. `
                              + `Spare weeks must be fewer than the ${TOTAL_POS} lines.`
                            : `Can't generate — check every row has a valid time and whole-number targets.`;
                }
                return;
            }

            // Name what is at stake (v19.38). The message used to be the same whether the active design
            // was blank or full of hand-tuned work — and Apply overwrites every line either way.
            const _hasWork = !!design && Object.values(/** @type {Record<string, any>} */ (design.patterns || {}))
                .some(p => DAYS.some(d => { const v = p?.[d]; return v && v !== 'RD' && v !== 'OFF'; }));
            // A proposal is not replaced — Apply opens a NEW design beside it — so it gets its own words.
            const _lose = activeProposalId ? dirty : _hasWork;
            const _genMsg = activeProposalId ? `A new design opens with the generated pattern. “${design?.name}” stays in the shortlist${dirty ? ' — your unsaved changes to it will be lost' : ''}.`
                : _hasWork ? `This replaces all ${TOTAL_POS} lines of “${design?.name || 'this design'}” with the generated pattern. Any edits you have made will be lost.`
                : `Apply the generated pattern to all ${TOTAL_POS} lines?`;
            // Captured BEFORE the confirm opens: the dialog's lockBodyScroll puts the body in
            // position:fixed, so a measurement taken after the await reads locked coordinates.
            const _btnEl = document.getElementById('genApplyBtn');
            const _btnViewTop = _btnEl?.getBoundingClientRect().top;
            if (!await confirmDialog({
                title: 'Apply pattern',
                message: _genMsg,
                confirmLabel: _hasWork && !activeProposalId ? `Replace all ${TOTAL_POS} lines` : 'Apply',
                danger: _lose,
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
                variety: _chk('objVariety'), maxRun: _chk('objMaxRun'), gentle: _chk('objGentle'),
                weekends: _chk('objWeekends'), longWeekends: _chk('objLongWeekends'),
                turnarounds: _chk('objTurnarounds'),
            };
            const _num = (/** @type {string} */ id, /** @type {number} */ dflt, min = 0) => Math.max(min, parseInt(
                /** @type {HTMLInputElement|null} */ (document.getElementById(id))?.value ?? String(dflt), 10) || dflt);
            const _target = _num('objLongTarget', 4);
            const _blockTarget = _num('objBlockTarget', DEFAULT_BLOCK_TARGET, 1);
            const _maxRunTarget = _num('objMaxRunTarget', DEFAULT_MAX_RUN, 1);
            // PRESSING GENERATE AGAIN EXPLORES (v20.07 — owner: "you press generate and it gives
            // you the same design each time"). Same targets and switches → the attempt counter
            // advances and reorderLines starts its search somewhere else; any input change → back
            // to attempt 0, the canonical design. The fingerprint is the whole input surface, so a
            // designer who nudges one headcount is not silently handed variant 4 of the new targets.
            const _fp = JSON.stringify([genSlots, genSpareLines, _on, _target, _blockTarget, _maxRunTarget]);
            if (_fp === _genFingerprint) { _genAttempt += 1; } else { _genAttempt = 0; _genBest = null; _genLastOrder = ''; }
            _genFingerprint = _fp;
            const _ord = reorderLines(generated, {
                on: _on, longWeekendTarget: _target, blockTarget: _blockTarget,
                maxRunTarget: _maxRunTarget, attempt: _genAttempt,
            });
            const _final = _ord.changed ? applyOrder(generated, _ord.order) : generated;

            if (!design || activeProposalId) {
                // No active design yet (or a proposal open — it is not yours to overwrite) — an unsaved in-memory design
                design = { id: null, name: '', patterns: _final, window: design?.window };   // named on its FIRST SAVE (links-design-header.js rule 3)
                activeDesignId = null; activeProposalId = null; lsSet(ACTIVE_KEY, '');
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
            // HOLD THE BUTTON STILL THROUGH THE REFLOW (v20.54). On the FIRST generate the grid card
            // above grows from a ~160px empty state to the full grid, ~1,500px inserted ABOVE the scroll
            // position, stranding the presser mid-grid with the button and its feedback off-screen.
            // Re-anchoring keeps them where they pressed, which also keeps the explore loop pressable.
            //
            // TIMING IS THE WHOLE TRICK. The dialog's unlockBodyScroll ends in `window.scrollTo(0,
            // saved)` on transitionend (or the 500ms fallback) — AFTER this handler — and clobbers any
            // earlier adjustment; a scrollBy in the first frame after the lock lifts also no-ops. So
            // the loop VERIFIES rather than trusts: measure, shift, repeat until ≤1px residual, bounded
            // so a stuck lock cannot loop it forever and self-terminating so it never fights the user.
            //
            // TWO BUDGETS, IN TIME (v21.83). One 120-frame budget was spent WAITING for the unlock on a
            // loaded CI runner (stranded 1112px) — and a budget Android is the same machine. Waiting
            // and working now have separate bounds. NOT DIRECTLY GUARDED: on an idle machine the unlock
            // takes ~30 frames, so the e2e passes either way; a simulation was tried and measured the
            // harness instead. Reasoned from a real CI failure, covered only in its normal path.
            if (_btnEl && _btnViewTop !== undefined) {
                const _waitUntil = performance.now() + 3000;   // the unlock is not ours to hurry
                const _workUntil = performance.now() + 5000;   // ...and then this much to converge
                const _reanchor = () => {
                    if (document.body.classList.contains('lb-open')) {
                        if (performance.now() > _waitUntil) return;
                        requestAnimationFrame(_reanchor); return;
                    }
                    if (performance.now() > _workUntil) return;
                    const shift = _btnEl.getBoundingClientRect().top - /** @type {number} */ (_btnViewTop);
                    if (Math.abs(shift) <= 1) return;
                    window.scrollBy(0, shift);
                    requestAnimationFrame(_reanchor);
                };
                _reanchor();
            }

            // State the trade. A reorder that improved one figure at another's expense must say
            // so — a bare "generated" would let the designer assume everything got better.
            const b = _ord.before, a = _ord.after;
            const bits = _ord.changed
                ? [`longest block ${b.longestBlock}→${a.longestBlock} weeks`,
                    `shifts in a row ${b.longestRun}→${a.longestRun}`,
                    `week-to-week ${b.gentleMean}→${a.gentleMean} min`,
                    `weekends off ${b.weekends}→${a.weekends}`,
                    `long ${b.longWeekends}→${a.longWeekends}`]
                : [];
            // SAY SO WHEN THE CAP WAS NOT MET. The box names a target, and a target the design
            // silently misses is the phantom guarantee this module has already shipped once —
            // the rotating construction's "a person's week only moves later", documented and
            // untrue. Measured on the live seed: with the switch on alone the reorder reaches 6;
            // with the whole set on it reaches 8, because shortening runs and creating 48-hour
            // breaks pull against each other. That is a real trade and it belongs on screen.
            const _missed = _on.maxRun && _ord.changed && a.longestRun > _maxRunTarget
                ? ` Shifts in a row could not be brought below ${a.longestRun} (target ${_maxRunTarget}) `
                  + `without giving up more elsewhere — turn other objectives off to push it further.`
                : '';
            // Name the construction. The two produce visibly different designs — settled weeks
            // keep a line inside one wave, the fallback walks it across the whole day — and a
            // designer who is not told which they got cannot account for the difference.
            const how = built.mode === 'settled'
                ? `Link generated — settled weeks, ${built.waves} wave${built.waves === 1 ? '' : 's'}`
                : 'Link generated — rotating weeks (targets would not fit settled ones)';

            // THE EXPLORE LOOP'S VOICE (v20.07). Three sentences it has to be able to say, and
            // each earns its place: which design this is (attempt counter — "design 3" means
            // the same design on every device, since attempts are seeded); whether pressing
            // again is worth it (the best-so-far note is what turns cycling into IMPROVING —
            // without it the designer is comparing five status lines from memory); and the
            // honest dead-end (the constraint filter can fall back to design 1, and a repeat
            // wearing a new number would read as the tool pretending to explore).
            //
            // NOTE this state machine runs UNCONDITIONALLY — until v20.54 it sat inside an
            // `if (status)` element guard, so a missing element would silently stop the attempt
            // tracking as well as the display.
            const _orderKey = _ord.order.join(',');
            const _c = cost(_ord.after, _on, _target, _blockTarget);
            let _explore;
            if (_genAttempt === 0) {
                _genBest = { c: _c, n: 1 };
                _explore = ' Generate again for a different line order — same cover, different arrangement.';
            } else if (_orderKey === _genLastOrder) {
                _explore = ` Same arrangement as design ${_genAttempt} — generate again to keep exploring.`;
            } else if (!_genBest || _c < _genBest.c) {
                _genBest = { c: _c, n: _genAttempt + 1 };
                _explore = ' The best arrangement so far on the ticked objectives.';
            } else {
                _explore = ` Design ${_genBest.n} scored better on the ticked objectives — reload and generate ${_genBest.n} time${_genBest.n === 1 ? '' : 's'} to get it back.`;
            }
            _genLastOrder = _orderKey;

            const _label = _genAttempt > 0 ? `Design ${_genAttempt + 1} — ` : '';
            const _statusText = _label + how + (bits.length ? ` — ${bits.join(', ')}.` : '. Review and save when ready.') + _missed + _explore;

            // THE FEEDBACK IS WRITTEN WHERE THE PRESSING HAPPENS AS WELL AS WHERE THE SAVING
            // HAPPENS (v20.54). #linksSaveStatus lives in the grid card's sticky save row, a full
            // card above this button — measured after a real press it sat 448px above the viewport
            // at 1280×900 and 569px above at 390×844, so the whole explore-loop voice (the design
            // numbering, the best-so-far note, the how-to-get-it-back instruction) was invisible
            // from the one place it is read: beside the button being pressed. The save-row copy
            // keeps the aria-live (it announced correctly throughout — screen-reader users were
            // the only ones getting the message); the mirror is aria-hidden so it is not announced
            // twice.
            const status = document.getElementById('linksSaveStatus');
            if (status) {
                status.textContent = _statusText;
                status.className = 'links-save-status ok';
            }
            const mirror = document.getElementById('genStatus');
            if (mirror) {
                mirror.textContent = _statusText;
                mirror.hidden = false;
            }
        });
    })();

    // ============================================
    // SAVE / LOAD
    // ============================================

    function updateSaveBtn() {
        const status = document.getElementById('linksSaveStatus');
        // Both Save buttons — label AND state — are the masthead's (links-design-header.js).
        header?.render(_headerState());
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
        const when  = lastSaveTime(entry);
        // The provenance line describes the SAVED document; the grid prints the LIVE in-memory
        // patterns. With unsaved edits those are two different designs, so a sheet showing your
        // changes would carry someone else's "Last saved by" — and this sheet goes to the assessing
        // manager. Say so on the paper rather than refusing to print: printing a work in progress is
        // a perfectly reasonable thing to want (v19.62).
        const unsaved = dirty ? ' · includes unsaved changes' : '';
        const saved = activeProposalId ? `Shortlisted proposal ${proposalById(activeProposalId)?.ref ?? ''}, built into the app${unsaved}` : entry?.updatedBy
            ? `Last saved by ${entry.updatedBy}${when ? ` · ${formatDayMonthYear(when)}` : ''}${unsaved}`
            : `Not saved yet${unsaved}`;
        // The TIME matters more here than anywhere: a design is edited and reprinted repeatedly
        // on the way to a proposal, and the assessing manager may be holding two of them. See
        // roster-data.js → "the provenance line every printable surface closes on".
        const printedNow = new Date();
        const printed = printedStamp(printedNow, formatClock(printedNow));
        // The printed sheet states the window it was designed to (v19.54). A circulated sheet is
        // read away from the app, so without this a proposal built to a moved Sunday finish is
        // indistinguishable from one built to the standard hours.
        const win = formatWindow(design.window);
        const moved = isDefaultWindow(design.window) ? '' : ' (moved)';
        el.innerHTML =
            `<span class="print-design-title">${escapeHtml(design.name || 'Link design')}</span>` +
            `<span class="print-design-meta">${escapeHtml(saved)} · ${escapeHtml(printed)}</span>` +
            `<span class="print-design-meta">Staffed window: ${escapeHtml(win + moved)}</span>`;
    }
    // Re-stamp on the way to the printer so the "Printed" date is the real one.
    // Kept ALONGSIDE the `_preparePrint` registration below, deliberately: that one is idempotent,
    // so if a print dialog is cancelled on an engine that never fires `afterprint`, the next print
    // would re-use the first run's stamp. This listener re-stamps the "Printed" date every time.
    window.addEventListener('beforeprint', _renderPrintMasthead);

    // The print button (v19.62; prepares synchronously since v23.20). It no longer RELIES on
    // `window.print()` firing `beforeprint` — see `_preparePrint` below for why that assumption was
    // not safe on the engine half this station reads on. The preparation is still shared, not
    // duplicated: both routes call the one function, and it is idempotent.
    document.getElementById('linksPrintBtn')?.addEventListener('click', () => {
        // Guarded (v24.61): in a home-screen app on iOS 27 `window.print()` does nothing, so the tap
        // explains and offers Safari. Prepare only when a print will follow — the preparation's
        // restore waits on events a print that never happens would never send.
        printOrExplain({ print: () => { _preparePrint(); window.print(); }, explain: () => explainNoPrint(confirmDialog) });
    });

    let _reopenAfterPrint = /** @type {HTMLDetailsElement[]} */ ([]);
    let _printPrepared = false;
    /**
     * Open every `<details>` for paper, and put them back afterwards (v19.57).
     *
     * CSS **cannot** do the opening: Chromium hides a closed `details`'s content through its own
     * internal slot, which no author `display` rule reaches — measured, a `@media print` override
     * still printed 13 of the fatigue panel's 24 rows. And that is not cosmetic. The sheet is what
     * gets circulated to the assessing manager, so dropping 17 completed checks is precisely the
     * false-assurance failure that panel exists to prevent: a design that looks assessed against
     * fewer factors than it actually was. Restoring afterwards matters for the mirror-image reason
     * — printing must not permanently expand what the designer deliberately collapsed.
     *
     * Called from the Print button BEFORE `window.print()` as well as from `beforeprint` (v23.20);
     * `fip-guide.js` carries the argument for why the event alone was not safe, and the
     * measurement. IDEMPOTENT ON PURPOSE: where both routes fire, a second snapshot would record
     * every `details` as already open and the restore would leave the workspace expanded.
     */
    function _preparePrint() {
        if (_printPrepared) return;
        _printPrepared = true;
        _renderPrintMasthead();
        _reopenAfterPrint = /** @type {HTMLDetailsElement[]} */ (
            [...document.querySelectorAll('details:not([open])')]);
        for (const d of _reopenAfterPrint) d.open = true;
    }
    function _restoreAfterPrint() {
        if (!_printPrepared) return;   // afterprint can fire twice, or not at all
        _printPrepared = false;
        for (const d of _reopenAfterPrint) d.open = false;
        _reopenAfterPrint = [];
    }
    window.addEventListener('beforeprint', _preparePrint);
    window.addEventListener('afterprint', _restoreAfterPrint);
    // The restore needs the same defence the prepare got (v23.27): `afterprint` is the same event
    // from the same engine that does not fire `beforeprint` for AirPrint, so on the route this
    // station prints from the workspace was left permanently expanded. Becoming visible again is
    // the signal every engine sends; where `afterprint` fires this is a no-op. The full argument
    // and its measurement are in `fip-guide.js`, beside the identical net.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') _restoreAfterPrint();
    });

    /**
     * @param {any} updatedBy
     * @param {Date|null} savedTime  from `lastSaveTime` — the reading the masthead pill takes too, so the
     *                          two surfaces cannot state two different save times at once
     */
    function updateLastSaved(updatedBy, savedTime) {
        const el = document.getElementById('linksLastSaved');
        if (!el) return;
        const label = lastSavedLabel(updatedBy, savedTime);
        // The WHEN is one unbreakable phrase (Sep 2026 polish). The meta column is squeezed by the
        // summary chips beside it, and at 1280 the line broke inside the date — "· 24 / Jun at
        // 16:40". Only the part after the separator is held together; the name side still wraps.
        const cut = label.indexOf(' · ');
        if (cut < 0) { el.textContent = label; return; }
        const when = document.createElement('span');
        when.className = 'links-last-saved-when';
        when.textContent = label.slice(cut + 3);
        el.replaceChildren(label.slice(0, cut + 3), when);
    }

    async function saveChanges() {
        const btns   = _saveBtns();
        const status = document.getElementById('linksSaveStatus');
        if (!design || savingHere()) return;
        // THE FIRST SAVE IS WHERE A DESIGN GETS ITS NAME (v23.30; links-design-header.js rule 3).
        // Asked BEFORE the "Saving…" state, because a cancel here is a decision and not a failure.
        if (!activeDesignId) {
            const name = (await promptDialog({
                title: 'Name this design',
                message: 'Colleagues will see this name in the list. You can rename it later.',
                defaultValue: activeProposalId ? proposalCopyName(/** @type {any} */ (proposalById(activeProposalId)), designs) : proposeNewDesignName(currentUser, designs),
                maxLength: MAX_DESIGN_NAME, confirmLabel: 'Save',
            }))?.trim();
            if (!name) return;
            if (_designNameRejected(name)) return;
            design.name = name;
        }
        // WHAT THIS SAVE IS FOR, fixed before the first await. The page moves on while a write is
        // in flight — more edits, another design opened — and a result applied to whatever is on
        // screen when it lands recorded edits that were never written as "✓ Saved", and stamped
        // this design's id and baseline onto a different one. `written` is filled INSIDE the write
        // (a transaction may run it twice), so it is always the payload that actually went.
        const dsn = design, savingId = activeDesignId, act = activation;
        const here = () => act === activation;
        /** @type {any} */ let written = null;
        const buildDoc = () => {
            written = { patterns: deepCopyPatterns(dsn.patterns), window: normaliseWindow(dsn.window) };
            return docPayload({ ...dsn, ...written }, { updatedBy: currentUser, updatedAt: serverTimestamp() });
        };
        /** A write landed: record it, and clear `dirty` only if nothing was edited since it was built. */
        // `queued`: offline, the write sits in this device's persistent Firestore queue and uploads on
        // reconnect — so `dirty` clears (a re-save would queue a duplicate, and a leave-page warning
        // would lie), but the words must not claim the server has it.
        const landed = (/** @type {string} */ id, /** @type {any} */ base, /** @type {any} */ updatedAt, queued = false) => {
            const entry = designs.find(x => x.id === id);
            recordSave(entry, written, currentUser, updatedAt, base.loadedRevision);
            if (!here()) return;
            ({ loadedRevision, loadedUpdatedAt, baselineUnknown } = base);
            const same = JSON.stringify([design?.patterns, normaliseWindow(design?.window)])
                === JSON.stringify([written.patterns, written.window]);
            dirty = !same;
            updateSaveBtn();
            const [said, lead] = queued ? ['Saved on this device — it will upload when you’re back online', 'Saved on this device'] : ['✓ Saved', '✓ Saved'];
            if (status) { setStatus(status, same ? said : `${lead} — your later changes are not saved yet`); status.className = `links-save-status${queued ? '' : ' ok'}`; }
            updateLastSaved(currentUser, lastSaveTime(entry) ?? new Date());
        };
        const key = savingId ?? dsn;
        savingKeys.add(key);
        for (const b of btns) { b.disabled = true; b.textContent = 'Saving…'; }
        header?.render(_headerState());
        if (status) { status.textContent = 'Saving…'; status.className = 'links-save-status'; }

        try {
            await sessionReady;

            if (!savingId) {
                // First save of a generator-created design — create the Firestore document.
                // One create primitive, so the baseline invariant cannot differ between a design
                // made by the picker and one made by the generator (v21.87): an unresolved
                // read-back must pair loadedUpdatedAt=null with baselineUnknown=true, or the next
                // save sees neither and clobbers a co-editor with no prompt.
                const created = await store.create(buildDoc());
                designs.push(restoredEntryFrom({ id: created.id, name: dsn.name, ...written },
                    { updatedAt: created.updatedAt, updatedBy: currentUser, revision: created.baseline.loadedRevision }));
                _sortDesigns();
                if (here() && design) {
                    activeDesignId = created.id; activeProposalId = null;
                    design.id = created.id;
                    lsSet(ACTIVE_KEY, created.id);
                    targets.adoptUnsaved();   // the targets tuned while it had no id come with it
                }
                landed(created.id, created.baseline, created.updatedAt, !!created.queued);
                renderDesignPicker();
                return;
            }

            // Two designers can have this page open at once. The compare-and-set that guards
            // against that is the store's now (v21.87) — including the rule that only an OFFLINE
            // failure may take an unserialised path, which three silent overwrites came out of
            // (v16.19 / v16.23 / v17.18) and which was reinstated by accident as recently as the
            // v21.86 audit. What remains below is the conversation with the designer.
            const confirmOverwrite = (/** @type {{by:string, at:any}} */ c) => {
                const when = c.at?.toDate?.()?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) ?? '';
                // Your OWN name here is another tab or device, or a rename that could not be
                // checked — "replace their changes" would have you overwrite yourself unasked.
                const mine = c.by === currentUser;
                return confirmDialog({
                    title: mine ? 'This design changed' : 'Someone else saved',
                    message: (mine
                        ? `A different version was saved${when ? ` at ${when}` : ''} after you opened this page — from another tab or device, or under a rename.\n\nSave anyway and replace that version?`
                        : `${c.by} saved a different version${when ? ` at ${when}` : ''} after you opened this page.\n\nSave anyway and replace their changes?`),
                    confirmLabel: 'Replace',
                    danger: true,
                });
            };
            const markNotSaved = () => {
                updateSaveBtn();
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
            // Out of the live list: it stayed in the picker, counted towards the last-design rule, and
            // set off Duplicate's "goes back to its last save" confirm. Also when the page moved on.
            const dropDeleted = (/** @type {any} */ data) => {
                designs = designs.filter(x => x.id !== savingId);
                // Once (48-hour review): "Not now" leaves the design open, so each further Save
                // lands here again, and every one of them added another copy to Recently deleted.
                if (data) library.upsertBin(binEntryFromDoc(savingId, data));
                renderDesignPicker();
            };
            const deletedElsewhere = async (/** @type {any} */ data) => {
                markNotSaved();
                dropDeleted(data);
                const by = (data?.deletedBy || '').trim();
                if (await confirmDialog({
                    title: 'This design was deleted',
                    message: (data ? `${by || 'Someone'} deleted this design while you had it open. It is in Recently deleted.`
                        : 'Someone removed this design for good while you had it open.') + '\n\n' +
                        'Your version can be saved as a NEW design so your work is not lost.',
                    confirmLabel: 'Save mine as new',
                    cancelLabel: 'Not now',
                })) await duplicateDesign(true);
                return true;
            };

            // Worded like the conflict dialog it answers: with your OWN name on it, there is no "them".
            const declineOrFork = async (/** @type {any} */ c) => {
                markNotSaved();
                if (await confirmDialog({
                    title: 'Keep your version too?',
                    message: `${c?.by === currentUser ? 'That' : 'Their'} version stays as it is. Yours can be saved as a NEW design, so nothing is lost either way.`,
                    confirmLabel: 'Save mine as new',
                    cancelLabel: 'Not now',
                })) await duplicateDesign();
            };

            // ── THE PROTOCOL LIVES IN links-design-store.js (v21.87) ────────────────────────
            // This function used to hold the transaction, the conflict comparison, the offline
            // fallback and the baseline arithmetic inline — one of five write paths each doing its
            // own version of that, which is how the same defect reached production twice. What is
            // left here is the part that genuinely belongs to a workspace: what to ASK, and what to
            // do with the answer. The store never asks anything.
            const res = await store.save({
                id: savingId,
                buildPayload: buildDoc,
                baseline: loadedUpdatedAt,
                loadedRevision,
                baselineUnknown,
                currentUser,
            });

            // Nothing written, and another design is open now: the conversation below would act on
            // THAT one, so say so and stop.
            if (!here() && (res.status === 'conflict' || res.status === 'deleted-elsewhere')) {
                if (res.status === 'deleted-elsewhere') dropDeleted(res.deletedData);
                _designActionStatus(`“${dsn.name}” was not saved — it ${res.status === 'conflict' ? 'changed elsewhere while saving. Open it to check.' : 'was deleted elsewhere while saving.'}`);
                return;
            }
            if (res.status === 'deleted-elsewhere') { await deletedElsewhere(res.deletedData); return; }
            if (res.status === 'conflict') {
                // ── CONSENT IS PER VERSION, SO THE ASK CAN REPEAT (v21.96) ──────────────────
                // Accepting "replace their changes" names ONE version — the one the dialog showed.
                // If somebody else saves while that dialog sits open, the store refuses and hands
                // back the NEW conflict rather than writing over a version nobody was asked about,
                // so the honest response is to ask again about that one. The loop is bounded: a
                // colleague saving faster than this admin can read is not a state to sit in, and an
                // unbounded prompt cycle would be its own defect.
                let pending = res.conflict;
                for (let round = 0; ; round++) {
                    if (!await confirmOverwrite(pending)) { await declineOrFork(pending); return; }
                    const forced = await store.save({
                        id: savingId, buildPayload: buildDoc,
                        baseline: loadedUpdatedAt, loadedRevision, baselineUnknown, currentUser,
                        forcing: true,
                        // BOTH, deliberately: `rev` is exact and `at` is the fallback for a design
                        // nobody has saved since v22.18. Consent is per version either way.
                        forceAgainstRev: pending?.rev ?? null,
                        forceAgainstRevision: pending?.at?.toMillis?.() ?? null,
                    });
                    if (forced.status === 'deleted-elsewhere') { await deletedElsewhere(forced.deletedData); return; }
                    if (forced.status === 'conflict') {
                        if (round >= 2) { await declineOrFork(forced.conflict); return; }
                        pending = forced.conflict;
                        continue;
                    }
                    landed(savingId, forced.baseline, forced.updatedAt);
                    break;
                }
            } else {
                landed(savingId, res.baseline, res.updatedAt, res.status === 'queued');
            }
        } catch (err) {
            console.error('[Links] Save failed:', err);
            if (here()) {
                dirty = true;
                // Signed out mid-save. An ONLINE save is a transaction, which is never queued, so it
                // may or may not have landed: say check, and keep the work unsaved (dirty) (v24.38).
                if (status) { status.textContent = unconfirmedWriteLine(err, 'this save', 'the design') ?? 'Save failed — try again'; status.className = 'links-save-status err'; }
            }
        } finally {
            savingKeys.delete(key);
            header?.render(_headerState());   // not updateSaveBtn: that would wipe the status just written
        }
    }

    /**
     * Load all named designs from Firestore.
     * Migrates the legacy combined-28 document into a named design on first run.
     */
    // The design collection's persistence lifecycle and its concurrency protocol (v21.87). Every
    // Firestore handle it needs is passed in, which is what makes the interleavings testable —
    // see links-design-store.js for why that mattered enough to extract.
    const store = createDesignStore({
        db, doc, getDoc, setDoc, addDoc, getDocs, runTransaction,
        serverTimestamp, deleteField, designsCol: DESIGNS_COL,
        withClaimRetry: writeWithClaimRetry,
    });
    library = createDesignLibrary({
        store, currentUser,
        getDesigns: () => designs,
        addDesign: (d) => { designs.push(d); _sortDesigns(); },
        activate: _activateDesign,
        isDirty: () => dirty,
        hasOpenDesign: () => !!design,
        renderPicker: renderDesignPicker,
        refreshLists: _refreshLists,
        actionStatus: _designActionStatus,
        getHeader: () => header,
    });

    /** A collection read → live designs, the bin, and the legacy singleton. One rule for both readers.
     *  A binned design keeps its patterns so a restore is a field-clearing merge (v19.41); every
     *  doc → object mapping is links-design-doc.js (v19.94). `binOld` is false for a CACHED read, which may not claim a move it cannot make.
     *  @param {Array<{id: string, data: any}>} docs @param {boolean} [binOld] */
    function _splitDocs(docs, binOld = true) {
        /** @type {any[]} */ const named = [], binned = [], toBin = [];
        let legacyData = null;
        for (const { id, data } of docs) {
            const hasName = typeof data.name === 'string' && data.name.trim();
            if (hasName && isDeleted(data)) binned.push(binEntryFromDoc(id, data));
            // A design drawn for the old link length goes to the bin (owner, 3 Oct 2026; rule: isPre26Design).
            // Shown there AT ONCE; the soft-delete write follows in the background (_binPre26).
            else if (hasName && binOld && isPre26Design(data)) { binned.push(binEntryFrom(designFromDoc(id, data), currentUser)); toBin.push(id); }
            else if (hasName) named.push(designFromDoc(id, data));
            else if (id === LEGACY_DOC_ID && data.patterns) legacyData = data;
        }
        return { named, binned, legacyData, toBin };
    }

    /** Re-read and repaint the LISTS only. A bin row settled by a colleague used to call
     *  `loadDesigns`, which rebuilt the working copy — discarding unsaved edits — and blanked the
     *  grid if the read failed. The open design, its baseline and `dirty` are not a bin row's. */
    async function _refreshLists() {
        try {
            const { named, binned } = _splitDocs(await store.loadAll());
            designs = named; _sortDesigns(); library.setBin(sortByDeleted(binned));
        } catch (err) { console.error('[Links] List refresh failed:', err); }
        renderDesignPicker(); library.renderBinList(); compare.renderCompare();
    }

    /** Bin the old-length designs in the background, each re-checked in a transaction (store.binIfStill)
     *  — never from a cached read, never queued offline. A restore or purge of one waits for its move
     *  (the library's `trackBinMove`), or it would meet a design not yet deleted and blame a colleague. Said AT ONCE:
     *  the empty state names them too, since on release day the list is often empty. @param {string[]} ids */
    function _binPre26(ids) {
        binnedOnLoad = ids.length;
        if (!ids.length) return;
        _designActionStatus(`${ids.length} design${ids.length === 1 ? '' : 's'} drawn for the ${PREVIOUS_LINK_LENGTH}-line link ${ids.length === 1 ? 'is' : 'are'} in Recently deleted — restore from there if you still need ${ids.length === 1 ? 'it' : 'them'}.`, 'ok');
        for (const id of ids) {
            library.trackBinMove(id, store.binIfStill(id, currentUser, isPre26Design)
                .then((/** @type {string} */ r) => { if (r === 'skipped') _refreshLists(); })   // restored or redrawn since: show it live
                .catch((/** @type {any} */ err) => console.error('[Links] Binning an old-length design failed:', err)));
        }
    }

    async function loadDesigns() {
        loadFailed = false;
        activation++;
        try {
            await sessionReady;
            const snap = await getDocs(DESIGNS_COL);
            const { named, binned, legacyData, toBin } = _splitDocs(snap.docs.map((/** @type {any} */ d) => ({ id: d.id, data: d.data() })), !snap.metadata?.fromCache);
            _binPre26(toBin);

            // One-time migration: convert combined-28 to a named design
            if (named.length === 0 && legacyData) {
                // Through the SHARED mapping (v19.94): it once skipped `normalisePatterns` and the
                // `window` field, persisting legacy unpadded times for good. History: git log.
                const migrated = designFromDoc('', { ...legacyData, name: 'Design 1' });
                const { id: migratedId } = await store.create(docPayload(migrated, {
                    updatedBy: legacyData.updatedBy ?? currentUser,
                    updatedAt: legacyData.updatedAt ?? serverTimestamp(),
                }));
                named.push({ ...migrated, id: migratedId, updatedBy: legacyData.updatedBy || currentUser });
            }

            // Sort by name — getDocs returns (random) auto-ID order, which shuffles the picker.
            named.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
            designs = named;
            // Bin: newest deletion first (pure, tested rule — incl. the unresolved-timestamp case).
            library.setBin(sortByDeleted(binned));
            // THE BIN IS PERMANENT (owner, 19 Sep 2026): nothing here deletes anything automatically.
            // Removal is a deliberate "Remove for good". The argument: links-deletion.js's header.

            // Re-open the design (or proposal) active last visit, else the first saved one. Nothing
            // saved opens NOTHING: the empty state offers the shortlist rather than choosing for you.
            const d = [...designs, ...PROPOSAL_ENTRIES].find(x => x.id === lsGet(ACTIVE_KEY)) || designs[0];
            if (d) {
                activeProposalId = isProposalId(d.id) ? d.id : null;
                activeDesignId  = activeProposalId ? null : d.id;
                lsSet(ACTIVE_KEY, d.id);
                design          = workingCopy(d);
                ({ loadedRevision, loadedUpdatedAt, baselineUnknown } = baselineFromEntry(d));
                updateLastSaved(d.updatedBy, lastSaveTime(d));
            } else {
                design = null;
                activeDesignId = null; activeProposalId = null;
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

    // The rotation length appears in static markup too (the grid card's title, the empty-state
    // sentence). Stamped from ROTATING_LINES so the HTML cannot go stale independently of the
    // constant — which is exactly what happened to fifteen prose copies of "28" (v19.98).
    for (const el of document.querySelectorAll('.js-rotating-lines')) el.textContent = String(TOTAL_POS);
    // Same for the two numeric ceilings the markup carries. A spare week is a whole line, so at
    // least one line has to be left to work — hence TOTAL_POS - 1 rather than TOTAL_POS.
    document.getElementById('genSpareLines')?.setAttribute('max', String(TOTAL_POS - 1));
    document.getElementById('objLongTarget')?.setAttribute('max', String(TOTAL_POS));

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
    for (const b of _saveBtns()) b.addEventListener('click', saveChanges);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && brush !== null) dearmBrush();
    });

    // ============================================
    // UNSAVED CHANGES GUARD
    // ============================================
    warnOnUnload(() => dirty);

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
        if (about) { openAboutLightbox = about.open; closeAboutLightbox = about.close; }

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
    // Lifecycle, renderer and button wiring live in tips-lightbox.js; the content is
    // links-tips.js (extracted v22.32 — see its header for why the generator card's prose
    // moved there, and for the two untrue tips the move retired).
    // ============================================
    initTipsLightbox(CARD_TIPS);

    // ============================================
    // ORIENTATION — first visit, and for ever after from the header button
    // ============================================
    // IT STOPPED REACHING ANYBODY (v22.59, external review). This shipped at v19.51 as a one-time
    // NOTICE with a 14-day window, and `isNoticeExpired` marks a notice seen WITHOUT showing it — so
    // from 16 Aug 2026 a designer opening Links for the first time was flagged and shown nothing.
    // Expiry is right for an announcement and wrong for what this panel actually holds: the three
    // things a newcomer cannot work out from the screen — nothing here touches the live roster, the
    // fatigue checks report rather than approve, and designs are shared so anyone can edit or delete
    // one. Someone who does not know the first is afraid to touch anything; someone who does not know
    // the second can take a clean panel into a meeting as an approval.
    //
    // So the two ideas are split. The ANNOUNCEMENT is over and is not replayed — it stays in the App
    // Notices archive, written once, on the first close. The ORIENTATION never expires until that
    // device has actually seen it, and `#linksHowBtn` above the first card reopens it whenever anyone wants
    // it, which is also what stops this being a pop-up nobody can get back to.
    //
    // A NEW STORAGE KEY was taken at v19.51 and is kept: reusing `myb_links_beta_seen` would have
    // meant every current designer, all three of whom closed the beta notice months ago, never saw
    // this. The old key is left on devices as an inert flag.
    (function () {
        const NOTICE_DATE   = '2 Aug 2026';
        const WELCOME_KEY   = 'myb_links_welcome_seen';
        const lb = document.getElementById('linksWelcomeLb');
        if (!lb) return;

        const welcome = createLightbox({
            overlay:  lb,
            content:  /** @type {HTMLElement} */ (document.getElementById('linksWelcomeContent')),
            closeBtn: /** @type {HTMLElement} */ (document.getElementById('linksWelcomeClose')),
            onClose() {
                // The archive entry is the ANNOUNCEMENT half and is written once. Re-archiving on
                // every manual open would file the same notice repeatedly under a date that is no
                // longer when anybody read it.
                if (lsGet(WELCOME_KEY)) return;
                lsSet(WELCOME_KEY, '1');
                archiveNotice({
                    id:      'links-workspace-2026',
                    title:   'Links Workspace',
                    section: 'Links',
                    date:    NOTICE_DATE,
                    body:    'Changes in the Links workspace only affect the link-design document, never the live roster. The Design checks report which ORR fatigue factors a pattern features — they do not pass or fail a design. Designs are shared, and a deleted one stays in Recently deleted until someone removes it for good.',
                });
            },
        });

        // Reachable for ever, from the About panel's own list of page links (v22.83). It is
        // unconditional — never gated on the seen flag — which is the whole point of the split
        // above.
        //
        // CLOSE ABOUT FIRST, then open this after the exit transition. Two overlays open together
        // is the stacking hazard `openNoticeIfClear` exists for: one Escape ran both `onClose`
        // callbacks, and the buried one was archived and flagged seen by somebody who never saw it.
        // The 500ms matches `dismissOverlay`'s fallback — the same figure, for the same reason, as
        // the About panel's own print button in about-lightbox.js.
        document.getElementById('linksHowBtn')?.addEventListener('click', () => {
            closeAboutLightbox?.();
            setTimeout(() => welcome.open(), 500);
        });

        if (lsGet(WELCOME_KEY)) return;
        // Not `welcome.open()`: a one-time notice must never open stacked with another overlay —
        // if it did, one Escape used to dismiss both and the buried one was flagged seen for good.
        // Deferring leaves it unopened AND unflagged, so it gets its turn on the next load.
        openNoticeIfClear(welcome);
    })();

    // ============================================
    // registerServiceWorker moved to the top of init() (before the access gate) — v16.23.
    sessionReady.then(() => { initErrorReporter(); recordUsage('links', currentUser); recordPageLatency('links', currentUser); });
    // Forced set-password overlay (PASSWORD_DESIGN.md Phase 2) — fire-and-forget, never on the login
    // critical path. Inside the sessionReady callback so `currentUser` is read LATE: on the in-place
    // sign-in path the module loaded signed-out and the identity is only refreshed inside
    // initAuthorised(), so passing it eagerly here would pass null and silently never compel anyone.
    sessionReady.then(() => initPasswordForce(currentUser));

    // ============================================
    // BOOT
    // ============================================
    loadDesigns();

}
