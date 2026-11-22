// @ts-check
/**
 * links-app.js — Coordinator for links.html.
 *
 * Owns: the page gate, the working copy and its `dirty` state, what a grid cell MEANS and the paint
 *   bar's brush (links-grid-input.js operates the grid), every path that can replace or discard the
 *   working copy and the question each one asks, the Build press, and the wiring of the modules
 *   below. It makes no Firestore read or write of its own: designs go through links-design-store.js.
 * Does NOT own: the masthead and its sheets (links-design-header.js), compare mode (links-compare.js),
 *   the analysis panels (links-analysis.js), the generator's targets (links-generator-targets.js), the
 *   bin, import and shortlist (links-design-library.js), or any of the maths (links-design.js and its
 *   siblings — no DOM, no Firebase there). The module table is .claude/rules/links-design.md.
 */

import { CONFIG, escapeHtml } from './roster-data.js';
import { printedStamp, formatClock, formatDayMonthYear } from './date-format.js';
import { db, doc, getDoc, getDocFromCache, setDoc, deleteField, collection, getDocs, serverTimestamp, runTransaction, COLLECTIONS, writeWithClaimRetry, whenOwnWritesSent } from './firebase-client.js';
import { initNavPanel } from './nav-panel.js';
import { archiveNotice } from './notice-archive.js';
import { initLoginOverlay, dismissLoginOverlay } from './login-overlay.js';
import { getSession, ensureNamedSession, sessionReady, resolveSession, reconcileExpiredIdentity } from './session.js';
import { requirePage, navGatesFor } from './auth-policy.js';
import { initCardCollapse, createLightbox, confirmDialog, promptDialog, openNoticeIfClear } from './overlay.js';
import { openOptionSheet, readGroups } from './select-sheet.js';
import { MAX_DESIGN_NAME, checkDesignName, proposeCopyName } from './links-design-naming.js';
import { createDesignHeader, proposeNewDesignName, lastSaveTime } from './links-design-header.js';
import { initAboutLightbox, wireHeaderLogo } from './about-lightbox.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { CARD_TIPS } from './links-tips.js';
import { registerServiceWorker, reloadForUpdate } from './sw-register.js';
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
    normaliseCustomShift, normalisePatterns,
    calcCoverage,
    generateLink,
    hmFromHours, hoursFigure,
    lineTotals,
    weeklyHours,
    MIN_REST_MINUTES,
    SPARE_WORKED_DAYS,
} from './links-design.js';
import { initLinksAnalysis } from './links-analysis.js';
import { createGridInput, trackPaintBarHeight } from './links-grid-input.js';
import { DAY_LABELS, shiftLabel, cellName, cellAriaName, emptyPattern, isUnfilledPattern, editCellHtml, coverCellsHtml } from './links-grid-cells.js';
import { deepCopyPatterns, designFromDoc, binEntryFromDoc, docPayload, workingCopy, binEntryFrom, restoredEntryFrom, lastSavedLabel, recordSave, isPre26Design, PREVIOUS_LINK_LENGTH } from './links-design-doc.js';
import { splitDesignDocs, binOldOnLoad, binOldOnRefresh, readCannotAnswer, migratesLegacy, byDesignName, designToOpen } from './links-design-load.js';
import { createDesignLibrary } from './links-design-library.js';
import { DEFAULT_SHIFT_TIMES } from './links-default-targets.js';
import { PROPOSALS, PROPOSAL_NAMES, isProposalId, proposalById, proposalCopyName, proposalDisplayName } from './links-proposals.js';
import { createTargetPanel, customShiftRefusal } from './links-generator-targets.js';
import { assessTargetHours } from './links-target-hours.js';
import { overCapacityLine, refusalLine, buildConfirm, withSurplusLines, createBuildCounter, builtStatusLine } from './links-build-press.js';
import { reorderLines, applyOrder, cost, DEFAULT_BLOCK_TARGET } from './links-adjacency.js';
import { normaliseWindow, formatWindow, isDefaultWindow, windowEditRefusal, canonicaliseWindowTime } from './links-window.js';
import { formatClockInput, finaliseClockInput } from './clock-input.js';
import { printOrExplain, explainNoPrint } from './print-guard.js';
import { createPrintPrep } from './links-print.js';
import { shiftOptionLists, currentLinkBaseline } from './links-today.js';
import { initLinksCompare } from './links-compare.js';
import { baselineFromEntry, listRowSig, mergeListAnswer } from './links-concurrency.js';
import { createDesignStore } from './links-design-store.js';
import { setStatus } from './status-text.js';
import { createQueuedSaves, stillUnsaved, refusedMakeLine } from './links-queued-saves.js';
import { unconfirmedWriteLine, hasUnconfirmedWrite } from './claim-retry.js';
import { guardNamedSession, askBeforeSignOut, askBeforeLeavingByDrawer, signOutAndLeave, warnOnUnload, reloadIfRestoredForSomeoneElse, keepDraftWhenHidden } from './page-session.js';
import { createDraftSlot, draftBaseline } from './unsaved-draft.js';
import {
    sortByDeleted, deleteOutcomeLine, renameRefusedLine,
} from './links-deletion.js';


// The body is an exported init(), called by links-boot.js (CSP blocks an inline module script), so the
// access gate can RETURN early instead of throwing, and an in-place sign-in can run it again.

// The CURRENT init pass's `dirty`: with an in-place sign-in init() runs twice and the service worker is
// registered on the first, whose own `dirty` stays false for ever — a direct closure would reload
// without the unsaved-changes question.
let _isDirty = () => false;

export function init() {
    reloadIfRestoredForSomeoneElse();
    // Before the access gate: a signed-out visit returns below and would otherwise never update the SW.
    registerServiceWorker({
        isBusy: () => _isDirty() || hasUnconfirmedWrite(),   // a notification tap asks first
        async beforeReload() {   // sw-register ignores the return, so the async dialog below is safe
            // A write of UNKNOWN outcome holds the update outright (AUTH_AND_SESSIONS 22).
            if (hasUnconfirmedWrite()) return;
            if (!_isDirty() || await confirmDialog({
                title: 'Update available',
                message: 'Reload to apply the update? Your unsaved changes are kept in this browser, and you’ll be asked whether to restore them.',
                confirmLabel: 'Reload',
            })) {
                reloadForUpdate();   // not a bare reload: it notes a release caused the next load
            }
        },
    });
    // An expired session's lingering identity is torn down, so a deep link cannot keep an old credential live.
    reconcileExpiredIdentity().catch(() => {});   // it logs its own failures

    // ── SESSION: Links designers only ──
    const currentSession  = getSession();
    const currentUser     = currentSession?.name ?? null;
    const isAdmin         = CONFIG.ADMIN_NAMES.includes(currentUser);

    // The local session decides the first render (auth-policy.js); the named session confirms it below.
    const _access = requirePage({ status: currentUser ? 'named' : 'signedOut', member: currentUser }, 'links');
    if (_access.decision === 'login') {
        // The in-place sign-in runs init() again, once, with the new session. Never resolveSession(false) here: the
        // one-shot sessionReady would be spent before that pass. A reload if init() throws, or if the session did
        // not save (iOS private mode) — re-entering then would soft-lock.
        const onSuccess = () => { try { if (!getSession()) { window.location.reload(); return; } init(); } catch { window.location.reload(); } };
        initLoginOverlay({ pageLabel: 'Links', onSuccess });
        return;
    }
    if (_access.decision === 'forbidden') {
        window.location.replace('./admin.html');
        return;
    }
    dismissLoginOverlay();   // re-entered from the in-place sign-in

    // The designer's OWN named session, re-established on every load, or every write fails.
    const _linksAuth = ensureNamedSession(currentUser);
    resolveSession(_linksAuth);
    // An own session that cannot be confirmed signs in again now; one revoked LATER does too
    // (page-session.js — the same follow-up every named page runs).
    guardNamedSession({ page: 'links', pageLabel: 'Links', member: currentUser, established: _linksAuth });

    document.body.classList.add('auth-ready');   // the page is on screen from here
    markPageReady();

    /** @type {any} */ let openAboutLightbox = null;
    /** The About panel's close: "How this workspace works", a row inside it, dismisses it first. */
    /** @type {any} */ let closeAboutLightbox = null;

    initNavPanel({
        authReady: sessionReady,   // the drawer's documents read once the session is in (AUTH_PLAN.md → E1)
        currentPage:     'links',
        memberName:      currentUser,
        ...navGatesFor(currentUser),   // the pill gates (auth-policy.js); the page gate above already required the designer role
        onLogoClick:     () => openAboutLightbox?.(),
        // Asked BEFORE the drawer releases this device's push record, so a cancel leaves it intact.
        beforeSignOut: askBeforeSignOut(() => dirty),
        onSignOut:     () => signOutAndLeave({ to: './' }),
    });

    const TOTAL_POS = ROTATING_LINES;   // the one declaration is links-design.js's: every line rotates
    const DESIGNS_COL = collection(db, COLLECTIONS.linkDesigns);
    const ACTIVE_KEY = 'myb_links_active_design';   // the design open last visit

    // The shift times offered — the MAIN roster's, and for the cell sheet the default table's too (links-today.js).
    const { early: EARLY_SHIFTS, earlyOptions: EARLY_OPTIONS, lateOptions: LATE_OPTIONS } = shiftOptionLists();

    // ── STATE ──
    /** The working copy; `id` null while unsaved. @type {{ id: string|null, name: string, patterns: Object, window?: any } | null} */
    let design = null;
    let dirty  = false;
    _isDirty = () => dirty;   // this pass's flag, for the service worker's reload
    // Unsaved work kept for a page that goes without asking — offered only with a grid it can restore WHOLE.
    const draftSlot = createDraftSlot({ page: 'links', by: currentUser ?? '', usable: (d) => !!d.patterns && typeof d.patterns === 'object' && Object.keys(d.patterns).length > 0 });
    /** Designs with a save in flight — by id, or 'unsaved' for ANY first save. Never the design object: a window
     *  edit or a build replaces it mid-save, re-enabling Save for a second create. PER DESIGN, so a write that
     *  cannot finish never locks the others. */
    const savingKeys = new Set();
    const savingHere = () => savingKeys.has(activeDesignId ?? 'unsaved');
    /** Moves whenever the working copy is replaced, so a write that lands later knows the page has moved on. */
    let activation = 0;
    /** True until the designs' read has answered (links-app-1): it REPLACES the working copy when it lands, so
     *  until then nothing that would make or open a design is offered. */
    let listLoading = true;
    /** The loading state's words, read from the markup (written as the loading state), so a retry says the same. */
    const LOADING_COPY = {
        title: document.querySelector('#linksEmptyState .links-empty-title')?.textContent ?? '',
        msg:   document.getElementById('linksEmptyMsg')?.innerHTML ?? '',
    };
    let loadFailed      = false;
    // The concurrency baseline: `loadedRevision` moves only to a revision this page committed or read;
    // `loadedUpdatedAt` (millis) is the fallback; `baselineUnknown` says a read-back failed, so the next save
    // asks rather than reading "no document" as safe (invariant 5; links-concurrency.js).
    /** @type {number|null} */ let loadedRevision = null;
    /** @type {any} */ let loadedUpdatedAt = null;
    let baselineUnknown = false;

    /** @type {any} */ let brush = null;   // the armed paint shift, or null
    /** @type {Array<{id:string, name:string, patterns:Object, window?:*, updatedAt:*, savedAt?:Date, updatedBy:string, revision?:number|null}>} */
    let designs         = [];
    /** @type {any} */ let activeDesignId  = null;   // null while unsaved
    /** The proposal whose unsaved copy is open, or null — opened with NO activeDesignId, so no write can address it. */
    /** @type {string|null} */ let activeProposalId = null;
    let binnedOnLoad = 0;
    const PROPOSAL_ENTRIES = PROPOSALS.map(p => ({ id: p.id, name: proposalDisplayName(p), ref: p.ref, patterns: p.patterns, window: null, updatedAt: null, updatedBy: '' }));
    /** The import panel, the bin and Keep only the shortlist (links-design-library.js), once the store exists. @type {any} */
    let library = null;
    const _bin = () => library ? library.binList() : [];   // newest first, the library's

    /**
     * The staffed-window editor on the Coverage card. An edit marks the design DIRTY — the window is part of the
     * proposal — and an invalid pair is REFUSED, never coerced: a coerced window prints as one the designer chose.
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
        // A phone's numeric keypad has no colon, so a time is shaped as it is typed; and it commits on BLUR as well as
        // change, because setting `.value` from `input` resets WebKit's change baseline (admin-week-editor.js) and
        // `change` never fired on an iPhone. `commit` is idempotent.
        for (const row of /** @type {const} */ (['monSat', 'sun'])) {
            for (const el of [els[row].start, els[row].end]) {
                el?.addEventListener('input', () => { el.value = formatClockInput(el.value); });
                el?.addEventListener('blur', () => commit(row));
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
            // The moved flag sits beside the "Staffed window" label; `.win-status` is for a refusal only.
            if (moved) moved.hidden = isDefaultWindow(w);
            if (status) status.textContent = '';
        }

        /** @param {'monSat'|'sun'} row */
        function commit(row) {
            if (!design) return;
            const typed = [els[row].start, els[row].end].map(el => finaliseClockInput(el?.value ?? ''));   // "240" left as typed is 02:40
            const refused = windowEditRefusal(typed[0], typed[1]);   // the reason that applies, or null
            if (refused) {
                // Put the stored value back and say why — AFTER paint(), which clears the status line.
                paint();
                if (status) status.textContent = refused;
                return;
            }
            const start = canonicaliseWindowTime(typed[0]) || '', end = canonicaliseWindowTime(typed[1]) || '', candidate = { start, end };
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
    // The Coverage CARD — heat map, window editor and the summary strip — is ONE call: as three, the first build
    // painted the chart and not the editor (v19.55).
    function renderCoverageCard() { renderCoverageChart(); paintWindowEditor(); renderSummary(); }
    const { renderCoverageChart, renderDesignChecks, renderSummary } = initLinksAnalysis({
        getDesign: () => design,
        getBaseline: () => currentLinkBaseline(),   // today's link, measured once (links-today.js)
        // A thunk: `compare` owns compare mode and is declared below.
        isComparing: () => compare.isCompareMode(),
    });
    paintWindowEditor = initWindowEditor();

    /**
     * The options of any shift list: the cell sheet's (`includeRdSpare`) or the generator's time selects. CEAs work
     * no nights, so no night time is offered; `normaliseCustomShift` refuses one typed.
     * @param {string|null} currentVal @param {boolean} includeRdSpare
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
            // The paint chip's own label: longer text cut itself mid-word in the phone's narrow 16px column.
            opt('__custom__', 'Custom…'),
        ].join('');
    }

    // Compare mode OWNS its state (links-compare.js); the coordinator only asks for it or resets it.
    const compare = initLinksCompare({
        getDesigns: () => [...designs, ...PROPOSAL_ENTRIES], getActiveDesignId: () => activeDesignId ?? activeProposalId, getDesign: () => design,
        renderDesignPicker, renderGrid, renderBrushBar, dearmBrush,
    });

    // ── DESIGN MANAGEMENT ──
    /** @type {ReturnType<typeof createDesignHeader>|null} the masthead (links-design-header.js) */
    let header = null;
    /** Both Save buttons — the masthead's and the sticky row's. One label, one state. */
    const _saveBtns = () => /** @type {HTMLButtonElement[]} */ (['linksSaveBtnTop', 'linksSaveBtn'].map(id => document.getElementById(id)).filter(Boolean));
    /** The designs whose last write is only in THIS BROWSER's queue (links-app-4): the masthead's pill says "Saved in
     *  this browser" for the open one, where "Saved" read as everybody having it. @type {Set<string>} */
    const queuedIds = new Set();
    /** The SAVES only this browser holds, whose copies are kept until the server answers (links-queued-saves.js). */
    const queuedSaves = createQueuedSaves();
    const _headerState = () => ({
        designs, activeId: activeDesignId, design, dirty, currentUser, saving: savingHere(),
        proposals: PROPOSAL_ENTRIES, proposalId: activeProposalId,
        queued: !!activeDesignId && queuedIds.has(activeDesignId),
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
            // Disabled state only: its click is a `sheetActions` row, and in `renameButtons` it would fire twice.
            renameMenuButton: /** @type {HTMLButtonElement|null} */ ($('designRenameMenuBtn')),
            deleteButton: /** @type {HTMLButtonElement|null} */ ($('designDeleteBtn')),
            sheetAvatar: $('designSheetAvatar'), sheetName: $('designSheetName'), sheetSub: $('designSheetSub'),
        }, { onSelect: selectDesign, onRename }, {
            moreButton: /** @type {HTMLButtonElement|null} */ ($('designMoreBtn')),
            // First focus on the first row that can be USED, asked as the sheet opens (links-app-17): a disabled row
            // takes no focus. (The overlay and `create` share a line: overlay-parity.test.mjs reads them together.)
            sheet:  { overlay: $('designMoreLb'),   create: createLightbox, content: $('designMoreContent'), closeBtn: $('designMoreClose'),
                      initialFocus: /** @type {any} */ (() => /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('#designMoreContent .dm-menu-btn')])
                          .find(b => !b.disabled && b.offsetParent !== null) ?? null) },
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
        // The empty state's actions. The primary one only SCROLLS: a build fired from an empty card makes a design nobody chose.
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

        wrap.style.display = '';   // always shown: the empty state points at its sheet
        const binBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('designBinBtn'));
        if (binBtn) {
            binBtn.style.display = _bin().length > 0 ? '' : 'none';
            const label = binBtn.querySelector('span:last-child');
            if (label) label.textContent = `Recently deleted (${_bin().length})`;
        }

        header?.render(_headerState());
        // Shut until the designs are in (`listLoading`); otherwise the face's `disabled` is the masthead's decision.
        const moreBtn   = /** @type {HTMLButtonElement|null} */ (document.getElementById('designMoreBtn'));
        const pickerBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('designPickerBtn'));
        if (moreBtn) moreBtn.disabled = listLoading;
        if (pickerBtn && listLoading) pickerBtn.disabled = true;

        _renderPrintMasthead();   // which version of the design a printed sheet is — the save row is hidden on paper
        if (dupBtn) dupBtn.disabled = !activeDesignId;
        const cmpMode = compare.isCompareMode();
        const cmpId   = compare.getCompareId();
        if (compareBtn) {
            compareBtn.disabled = !design || designs.length + PROPOSAL_ENTRIES.length < 2;
            compareBtn.classList.toggle('compare-active', cmpMode);
            compareBtn.setAttribute('aria-pressed', cmpMode ? 'true' : 'false');
            const lbl = document.getElementById('compareBtnLabel');
            if (lbl) lbl.textContent = cmpMode ? 'Stop comparing' : 'Compare with…';
        }

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


    /** A design action's outcome on the status line ON SCREEN — the save row's, or the empty state's while no design is
     *  open — so a refusal is never silent. `''` is the neutral voice: under way, or queued in this browser.
     *  @param {string} msg @param {'ok'|'err'|''} [kind] @param {boolean} [onSaveRow]  a LOAD's outcome: the design it opens shows it */
    function _designActionStatus(msg, kind = 'err', onSaveRow = !!design) {
        const status = document.getElementById(onSaveRow ? 'linksSaveStatus' : 'linksEmptyStatus');
        if (status) { status.textContent = msg; status.className = (onSaveRow ? 'links-save-status' : 'links-save-status links-empty-status') + (kind ? ' ' + kind : ''); }
    }

    /** What a write QUEUED in this browser says: never "✓ Saved", and never "when you're back online", which promised an
     *  upload a closed page cannot make (iPhone audit, Nov 2026). */
    const QUEUED_SAVE = 'Saved in this browser — it uploads the next time Links is open here with a connection';
    /** What an open design says when the server REFUSED the save queued in this browser (store rule 6). */
    const REFUSED_SAVE = 'Not saved — the server refused the save made in this browser. Your changes are still here; if saving fails again, contact the admin.';

    /** What the kept draft holds while nothing on the page is unsaved: the newest unconfirmed save, or nothing. A clean
     *  hide calls it, and an ANSWERED leave or sign-out — a discard of unsaved edits, and a save is not one. */
    function _keepUnconfirmedOrForget() {
        const newest = queuedSaves.newest();
        if (!newest) { draftSlot.forget(); return; }
        const { written, baseline } = newest.save;
        draftSlot.keep({ design: newest.id }, { patterns: written.patterns, window: written.window ?? null, baseline });
    }

    /**
     * Hear how a write QUEUED in this browser ENDED (store rule 6). `'acked'`: the line says "✓ Saved", the pill drops
     * "in this browser" and the kept copy goes. `'failed'`: the design is unsaved again, on its baseline from before
     * the save, and says so (again on reopening — `_activateDesign`). `'held'` (signed out with it queued): the page is
     * going, and the copy stays. A new design, a copy or an import (no `seq`) is heard for the pill alone, unless refused.
     * @param {string} id @param {Promise<string>|undefined} settled @param {number} [seq]
     * @param {boolean} [created]  the write MADE the design: a new design, a copy, an import or a first save
     */
    function _whenQueuedEnds(id, settled, seq, created = seq === undefined) {
        settled?.then((how) => {
            const unmade = queuedSaves.heard(id, how, created);   // asked first: it outlives a later save's answer
            if (!queuedSaves.counts(id, seq) || how === 'held') return;   // a later save of this design answers for it
            queuedIds.delete(id);
            if (how === 'failed' && unmade) { _createRefused(id); return; }
            const open = activeDesignId === id;
            const status = document.getElementById('linksSaveStatus');
            const u = how === 'acked' ? null : queuedSaves.refused(id);
            if (how === 'acked') {
                queuedSaves.acked(id);
                if (open && status?.textContent === QUEUED_SAVE) { setStatus(status, '✓ Saved'); status.className = 'links-save-status ok'; }
                if (!dirty) _keepUnconfirmedOrForget();
            } else if (u) {
                if (open) {
                    ({ loadedRevision, loadedUpdatedAt, baselineUnknown } = u.baseline);
                    dirty = true;
                    updateSaveBtn();
                    if (status) { setStatus(status, REFUSED_SAVE); status.className = 'links-save-status err'; }
                } else {
                    const name = designs.find(x => x.id === id)?.name;
                    _designActionStatus(`${name ? `“${name}”` : 'A design'} was not saved — the server refused the save made in this browser. Open it to save it again.`);
                }
            }
            header?.render(_headerState());
        }).catch((err) => console.error('[Links] How a queued write ended could not be shown:', err));
    }

    /** The server REFUSED to make this design, so it holds no document (links-queued-saves.js rule 7): it leaves the list,
     *  and open, it is an UNSAVED design again whose next Save makes it (links-design.md → Concurrency). @param {string} id */
    function _createRefused(id) {
        const name = designs.find(x => x.id === id)?.name ?? '', open = activeDesignId === id && !!design;
        designs = designs.filter(x => x.id !== id);
        if (!open || !design) queuedSaves.refused(id);   // a first save's copy, where there is one, stays kept and marked (rule 4)
        else {
            queuedSaves.acked(id);   // forgotten: the work is on screen, unsaved, and a hide keeps that copy
            _setWorkingCopy(null, { copy: { ...design, id: null, name: '' } });   // no name until its first save (header rule 3)
            updateLastSaved(null, null);
        }
        renderDesignPicker(); if (open) updateSaveBtn();   // before the line: it clears a dirty design's status
        _designActionStatus(refusedMakeLine(name, open));
    }

    /** The open design's CONTENT, so a write that lands late can tell whether anything was edited meanwhile (links-app-3).
     *  Not the name: a rename is saved as it is made. */
    const _contentKey = () => JSON.stringify(design ? [design.patterns, normaliseWindow(design.window)] : null);

    /** The design New blank design or Save a copy as… is making: null, '' while asking, its name in flight. One at a time —
     *  a second press passed the duplicate-name check before the first was in the list (links-app-3). */
    let making = /** @type {string|null} */ (null);

    /**
     * A design New blank design or Save a copy as… made has LANDED (links-app-3). It joins the list, and OPENS only if
     * the page is where the press left it — opened regardless, it replaced every edit made while the server was slow.
     * @param {any} d the entry, already in `designs`
     * @param {{ act: number, before: string, queued: boolean, made: string, settled?: Promise<string> }} o  `made` names it in a sentence
     */
    function _openMade(d, { act, before, queued, made, settled }) {
        if (queued) { queuedIds.add(d.id); _whenQueuedEnds(d.id, settled); }
        if (activation === act && _contentKey() === before) {
            _activateDesign(d);
            if (queued) _designActionStatus(QUEUED_SAVE, '');
            return;
        }
        renderDesignPicker();
        const why = activation !== act ? 'another design was opened meanwhile'
            : 'the open design was edited meanwhile — those edits are still here, not saved';
        _designActionStatus(`${made} is in the list${queued ? `, saved in this browser — it uploads the next time Links is open here with a connection` : ''}. `
            + `It was not opened, because ${why}.`, queued ? '' : 'ok');
    }

    /** True, and says why, when a typed design name may not be used. @param {string} name @param {string|null} [exceptId] */
    function _designNameRejected(name, exceptId = null) {
        const v = checkDesignName(name, { designs, proposalNames: PROPOSAL_NAMES, exceptId });   // a proposal's name too (links-design-6)
        if (!v.ok) _designActionStatus(v.message || 'That name cannot be used.');
        return !v.ok;
    }

    /** Create a new blank design. */
    async function createDesign() {
        if (making !== null) { if (making) _designActionStatus(`“${making}” is still being created — try again once it is in the list.`, ''); return; }
        making = '';
        try {
            // Unsaved work is asked about FIRST: the decision that might cancel the action must not come last.
            if (dirty && !await confirmDialog({ message: 'You have unsaved changes in the current design. Create a new one anyway?', confirmLabel: 'Create new' })) return;
            const name = (await promptDialog({ title: 'New design', message: 'Name for this design (e.g. “Option A”):', placeholder: 'Option A', maxLength: MAX_DESIGN_NAME, confirmLabel: 'Create' }))?.trim();
            if (!name) return;
            if (_designNameRejected(name)) return;
            making = name;
            _designActionStatus(`Creating “${name}”…`, '');
            const act = activation, before = _contentKey();
            // On the default window; the store arms its baseline from the server, so its FIRST save is guarded too.
            const { id: newId, updatedAt: createdTs, baseline: newBase, queued, settled } = await store.create(
                docPayload({ name, patterns: {}, window: null },
                           { updatedBy: currentUser, updatedAt: serverTimestamp() }));
            const d = restoredEntryFrom({ id: newId, name, patterns: {}, window: null }, { updatedAt: createdTs, updatedBy: currentUser, revision: newBase.loadedRevision });
            designs.push(d);
            _sortDesigns();
            _openMade(d, { act, before, queued: !!queued, made: `“${name}”`, settled });
        } catch (err) {
            console.error('[Links] Create design failed:', err);
            _designActionStatus(unconfirmedWriteLine(err, 'this change', 'the design list') ?? 'Couldn’t create the design — check your connection and try again.');
        } finally {
            making = null;
        }
    }

    /** Save a copy as…: the LIVE patterns and window, unsaved edits included — "copy what I'm looking at".
     * @param {boolean} [chosen] the designer has just pressed "Save mine as new" (a save that met a deletion or someone else's
     *   version): "goes back to its last save" would ask again about a choice made, or about an original not there. */
    async function duplicateDesign(chosen = false) {
        if (!activeDesignId || !design) return;
        if (making !== null) { if (making) _designActionStatus(`“${making}” is still being created — try again once it is in the list.`, ''); return; }
        making = '';
        try {
            // Deliberately NOT "changes will be lost": the work goes INTO the copy and the original reverts to its last
            // save (links-design.md → Every way of losing unsaved work). Asked before the name, as `createDesign` asks.
            if (dirty && !chosen && !await confirmDialog({
                title: 'Save a copy as…',
                message: `Your unsaved changes will go into the copy, and “${design.name || 'this design'}” will go back to its last save. Save the copy anyway?`,
                confirmLabel: 'Save copy',
            })) return;
            const name = (await promptDialog({ title: 'Save a copy as…', message: 'Name for the copy:', defaultValue: proposeCopyName(design.name || 'Design', designs), maxLength: MAX_DESIGN_NAME, confirmLabel: 'Save copy' }))?.trim();
            if (!name) return;
            if (_designNameRejected(name)) return;
            if (!design) return;   // the dialogs await; the page is the same one, but the type checker cannot know that
            making = name;
            const patterns = deepCopyPatterns(design.patterns);
            // The window too: patterns alone re-base the copy on the standard hours, unnoticed.
            const window = normaliseWindow(design.window);
            _designActionStatus(`Saving a copy as “${name}”…`, '');
            const act = activation, before = _contentKey();
            const { id: dupId, updatedAt: dupTs, baseline: dupBase, queued, settled } = await store.create(
                docPayload({ name, patterns, window },
                           { updatedBy: currentUser, updatedAt: serverTimestamp() }));
            const d = restoredEntryFrom({ id: dupId, name, patterns, window }, { updatedAt: dupTs, updatedBy: currentUser, revision: dupBase.loadedRevision });
            designs.push(d);
            _sortDesigns();
            _openMade(d, { act, before, queued: !!queued, made: `The copy “${name}”`, settled });
        } catch (err) {
            console.error('[Links] Duplicate design failed:', err);
            _designActionStatus(unconfirmedWriteLine(err, 'this change', 'the design list') ?? 'Couldn’t save the copy — check your connection and try again.');
        } finally {
            making = null;
        }
    }

    /** The list's one order (`byDesignName`), so a create, copy or rename lands where a load would put it. */
    function _sortDesigns() {
        designs.sort(byDesignName);
    }

    /** @param {any} id */
    async function renameDesign(id) {
        const d = designs.find(x => x.id === id);
        if (!d) return;
        const name = (await promptDialog({ title: 'Rename design', message: 'New name:', defaultValue: d.name, maxLength: MAX_DESIGN_NAME, confirmLabel: 'Rename' }))?.trim();
        if (!name || name === d.name) return;
        if (_designNameRejected(name, d.id)) return;
        try {
            // A rename moves the revision, or a co-editor's next save would silently revert it (v16.19); the baseline here
            // moves only when nobody else saved since (`baselineFresh`, decided in the store's transaction), or the next
            // save would skip "Someone else saved" over their work (v16.23).
            const _preBaseline = (id === activeDesignId) ? loadedUpdatedAt : (d.updatedAt?.toMillis?.() ?? null);
            const _preRevision = (id === activeDesignId) ? loadedRevision : (d.revision ?? null);
            const { baselineFresh, updatedAt: renamedAt, revision: renamedRev } = await store.rename(
                { id, name, by: currentUser, preBaseline: _preBaseline, preRevision: _preRevision });
            d.name = name;
            if (id === activeDesignId && design) design.name = name;
            if (baselineFresh) {
                d.updatedBy = currentUser;
                if (renamedAt) { d.updatedAt = renamedAt; delete d.savedAt; }   // server time wins (see recordSave)
                // To the revision the rename COMMITTED, never one a read-back happened to see (v22.18).
                if (typeof renamedRev === 'number') d.revision = renamedRev;
                if (id === activeDesignId) {
                    loadedUpdatedAt = d.updatedAt?.toMillis?.() ?? loadedUpdatedAt;
                    if (typeof renamedRev === 'number') loadedRevision = renamedRev;
                    updateLastSaved(d.updatedBy, lastSaveTime(d));
                }
            }
            _sortDesigns();
            renderDesignPicker();
            // A rename is quiet, and clears a failed attempt's line: nothing reopens the design to clear it.
            const _renameStatus = document.getElementById('linksSaveStatus');
            if (_renameStatus) { _renameStatus.textContent = ''; _renameStatus.className = 'links-save-status'; }
        } catch (err) {
            // Binned or removed by somebody else (links-design-5): no retry can rename it, so it leaves the list, as a
            // save that finds it deleted does, and the line says what happened.
            if (/** @type {any} */ (err)?.code === 'deleted-elsewhere') {
                const binned = /** @type {any} */ (err).deletedData ?? null;
                designs = designs.filter(x => x.id !== id);
                if (binned) library.upsertBin(binEntryFromDoc(id, binned));
                renderDesignPicker();
                _designActionStatus(renameRefusedLine(d.name, binned));
                return;
            }
            console.error('[Links] Rename failed:', err);
            _designActionStatus(unconfirmedWriteLine(err, 'this change', 'the design list') ?? 'Couldn’t rename the design — check your connection and try again.');
        }
    }

    /**
     * A SOFT delete: the design moves to Recently deleted, where it stays until somebody restores it or removes it
     * for good (links-deletion.js). The last saved design may go too: the first shortlisted proposal opens in its place.
     * @param {any} id
     */
    async function deleteDesign(id) {
        if (deleting.has(id)) return;
        const d = designs.find(x => x.id === id);
        if (!d) return;
        deleting.add(id);
        try { await _deleteDesign(id, d); } finally { deleting.delete(id); }
    }
    /** Designs with a delete under way: one at a time, or a second press binned it twice. @type {Set<string>} */
    const deleting = new Set();
    /** @param {string} id @param {any} d its entry in `designs` */
    async function _deleteDesign(id, d) {
        // UNSAVED WORK IS NOT IN THE BIN, which holds the last SAVED version (v22.56). So it SAVES first rather than
        // warns: restoring then brings back what was on screen. No "delete without saving" button — that needs a
        // three-action dialog in the shared overlay.js, and cancelling then switching away already discards.
        if (id === activeDesignId && dirty) {
            if (!await confirmDialog({
                title: 'Delete design',
                message: `“${d.name}” has unsaved changes.\n\nRecently deleted keeps the last saved version, so those changes would be lost.\n\nSaving first means the deleted copy has everything — restoring it brings back what is on screen now.`,
                confirmLabel: 'Save, then delete',
                danger: true,
            })) return;
            await saveChanges();
            // The save can end elsewhere — declined, deleted by somebody else, forked into a copy — and then this is
            // not the delete the dialog described.
            if (dirty || activeDesignId !== id) {
                _designActionStatus(`Couldn’t save “${d.name}”, so nothing was deleted.`);
                return;
            }
        } else if (!await confirmDialog({
            title: 'Delete design',
            // No countdown: the bin is permanent, and a deadline in copy is a promise (links-deletion.js).
            message: `Delete “${d.name}”?\n\nIt moves to Recently deleted, where it stays until someone restores it or removes it for good.`,
            confirmLabel: 'Delete',
            danger: true,
        })) return;
        try {
            // Said while under way, and checked again when it lands: the designer carries on meanwhile.
            _designActionStatus(`Deleting “${d.name}”…`, '');
            const before = _contentKey();
            const { status: found, deletedData } = await store.softDelete(id, currentUser);
            designs = designs.filter(x => x.id !== id);
            // A save of it only this browser holds is not unsaved work any more: kept, it came back as "your unsaved changes".
            queuedIds.delete(id); queuedSaves.acked(id);
            if (!dirty) _keepUnconfirmedOrForget();
            // The bin row is what the delete FOUND: binned already, THEIR delete; removed for good, none. Our own has
            // `deletedAt` null until the server resolves it, never a client clock's invented time.
            if (found === 'already-deleted') library.upsertBin(binEntryFromDoc(id, deletedData));
            else if (found !== 'gone') library.addToBin(binEntryFrom(d, currentUser));
            const outcome = deleteOutcomeLine(found, d.name, deletedData);
            const wasOpen = id === activeDesignId;
            const newActive = wasOpen && _contentKey() === before ? (designs[0] ?? PROPOSAL_ENTRIES[0] ?? null) : null;
            // Compare ends if the deleted design was compared, fewer than two are left, the next design IS the compared
            // one (a design compared with itself), or the open design went with nothing in its place. A comparison on
            // ANOTHER design is the designer's own, and stays (whole-app check, Nov 2026).
            const cmpId = compare.getCompareId();
            if (id === cmpId || designs.length + PROPOSAL_ENTRIES.length < 2 || (newActive && newActive.id === cmpId) || (wasOpen && !newActive)) {
                compare.resetCompare();
            }
            if (newActive) {
                _activateDesign(newActive);
                // Our own delete needs no line; one that found it already gone is news, and so is a proposal in its place.
                if (found !== 'deleted') _designActionStatus(outcome, '');
                else if (isProposalId(newActive.id)) _designActionStatus(`${outcome} No saved design is left, so a shortlisted proposal is open.`, 'ok');
                return;
            }
            // Edited while its delete was in flight: the edits stay, as an unsaved NEW design.
            if (wasOpen && design) _openAsNew(design.patterns, design.window);
            _renderAll();
            _designActionStatus(wasOpen
                ? `${outcome} What you changed while it was being deleted is still here, not saved — Save keeps it as a new design.`
                : outcome, wasOpen || found !== 'deleted' ? '' : 'ok');
        } catch (err) {
            console.error('[Links] Delete failed:', err);
            _designActionStatus(unconfirmedWriteLine(err, 'this change', 'the design list') ?? 'Couldn’t delete the design — check your connection and try again.');
        }
    }

    /** Switch design, asking first if dirty. @param {any} id */
    async function selectDesign(id) {
        if (id === activeDesignId || (id === activeProposalId && !activeDesignId)) return;
        // Not while its save is in flight, and before anything is asked: its entry still holds the version from BEFORE
        // the save, and the next save met that save as somebody else's — "This design changed", in your own name (Nov 2026).
        const saving = savingKeys.has(id) ? designs.find(x => x.id === id) : null;
        if (saving) { renderDesignPicker(); _designActionStatus(`“${saving.name}” is still saving — open it again once its save has finished.`, ''); return; }
        // A switch that does NOT happen must put the picker back (links-design-header.js's render, v23.33).
        if (dirty && !await confirmDialog({ message: 'You have unsaved changes. Switch to another design? Changes will be lost.', confirmLabel: 'Switch' })) { renderDesignPicker(); return; }
        const d = designs.find(x => x.id === id) ?? PROPOSAL_ENTRIES.find(x => x.id === id);
        if (!d) { renderDesignPicker(); return; }
        if (id === compare.getCompareId()) compare.resetCompare();
        _activateDesign(d);
    }

    /**
     * The ONE way the working copy is replaced. `entry` — a saved design or a proposal — opens CLEAN on the baseline
     * `baselineFromEntry` derives (never `baselineUnknown = false` beside a possibly-null stamp: the v17.18 bug); a
     * proposal opens with no saved id, so every write path treats it as new (links-proposals.js). With no entry, `copy`
     * is a NEW unsaved design — no id, no name until its first save — on the baseline already held. `activation` moves,
     * so a write in flight knows the page no longer shows what it wrote. The caller renders (`_renderAll`).
     * @param {any} entry @param {{ copy?: any, remember?: boolean }} [o]  `remember`: open it again on the next visit
     */
    function _setWorkingCopy(entry, { copy = null, remember = true } = {}) {
        activation++;
        activeProposalId = entry && isProposalId(entry.id) ? entry.id : null;
        activeDesignId = entry && !activeProposalId ? entry.id : null;
        if (remember) lsSet(ACTIVE_KEY, entry?.id ?? '');
        design = entry ? workingCopy(entry) : copy;
        if (entry) ({ loadedRevision, loadedUpdatedAt, baselineUnknown } = baselineFromEntry(entry));
        dirty = !entry && !!copy;
    }
    /** Draw everything the working copy feeds: the masthead, the grid (and the Coverage card with it), the paint bar,
     *  the checks, compare mode and the Save buttons. */
    function _renderAll() { renderDesignPicker(); renderGrid(); renderBrushBar(); renderDesignChecks(); compare.renderCompare(); updateSaveBtn(); }

    /** Open a saved design or a proposal, clean. @param {any} d */
    function _activateDesign(d) {
        if (!d) return;
        _setWorkingCopy(d);
        // A prior design's "✓ Saved" or "Save failed" is not this design's (v16.19): updateSaveBtn clears it only while dirty.
        const _switchStatus = document.getElementById('linksSaveStatus');
        if (_switchStatus) _switchStatus.textContent = '';
        dearmBrush();
        _renderAll();
        updateLastSaved(d.updatedBy, lastSaveTime(d));
        refreshGenTargetsForDesign();   // targets are per design
        // ITS LAST SAVE WAS REFUSED (store rule 6): the entry holds what the server does not, so it opens unsaved, on the
        // baseline from before that save.
        const refused = queuedSaves.get(activeDesignId);
        if (refused?.failed) {
            ({ loadedRevision, loadedUpdatedAt, baselineUnknown } = refused.baseline);
            dirty = true;
            updateSaveBtn();
            if (_switchStatus) { setStatus(_switchStatus, REFUSED_SAVE); _switchStatus.className = 'links-save-status err'; }
        }
    }

    /** A kept draft back as the UNSAVED working copy (unsaved-draft.js), on its own design with the baseline it was edited
     *  against, so a colleague's save since still asks; a design gone from the list, or never saved, comes back as a new
     *  one, which Save names. @param {any} kept */
    function restoreDraft(kept) {
        const entry = [...designs, ...PROPOSAL_ENTRIES].find(x => x.id === kept.scope.design);
        const patterns = normalisePatterns(kept.data.patterns), window = normaliseWindow(kept.data.window);
        if (entry) {
            _activateDesign(entry);
            design = { id: design?.id ?? null, name: design?.name ?? '', patterns, window };   // on the copy `_activateDesign` just made
            if (activeDesignId) ({ loadedRevision, loadedUpdatedAt, baselineUnknown } = draftBaseline(kept.data.baseline));
            dirty = true;
        } else _openAsNew(patterns, window);
        _renderAll();
    }

    /** A kept draft its design now holds exactly is not unsaved work — a queued save that landed (links-queued-saves.js
     *  rule 6). @param {any} kept */
    const _draftStillUnsaved = (kept) => stillUnsaved(kept, [...designs, ...PROPOSAL_ENTRIES].find(x => x.id === kept.scope.design));

    /**
     * The working copy as a NEW unsaved design: work whose design is not in the list (a draft of one never saved or
     * since deleted, edits made while its delete was in flight). Nothing may go on describing the design it came from —
     * its "Last saved by" and its generator table both stayed behind once (links-app-9). The caller renders.
     * @param {any} patterns @param {any} window
     */
    function _openAsNew(patterns, window) {
        _setWorkingCopy(null, { copy: { id: null, name: '', patterns, window } });
        compare.resetCompare();
        updateLastSaved(null, null);
        refreshGenTargetsForDesign();
    }

    // ── PAINT BRUSH ──

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
     * The paint chips: the times THIS DESIGN is made of (v21.14). A fixed list painted shifts the design did not contain
     * and could not paint the ones it did — measured once, an overlap of zero — and still looked as if it worked. The
     * armed brush is unioned in, so a chip cannot vanish mid-paint, and an empty design falls back to the default table.
     */
    function brushTimes() {
        const out = new Set();
        for (const row of Object.values(design?.patterns || {})) {
            for (const s of Object.values(/** @type {any} */ (row) || {})) {
                if (s && s !== 'RD' && s !== 'OFF' && s !== 'SPARE' && normaliseCustomShift(s)) out.add(s);   // never a night or past-midnight duty
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

        // A chip shows BOTH times, as the cell it paints does: several shifts share a start, and start-only chips were
        // identical pairs painting different shifts (v19.43). Its name is `cellName`'s, what it shows first.
        const chip = (/** @type {any} */ shift, /** @type {any} */ label, /** @type {any} */ typeClass, /** @type {any} */ extra = '', /** @type {any} */ spokenLabel = null) => {
            const say = spokenLabel ?? label;
            return `<button class="brush-chip type-${typeClass}${extra}" data-shift="${escapeHtml(shift)}" ` +
                `aria-pressed="false" aria-label="Paint: ${escapeHtml(say)}">${escapeHtml(label)}</button>`;
        };

        bar.innerHTML = [
            '<span class="brush-bar-label">Paint:</span>',
            chip('RD',    'RD',     'rd',    '', cellName('RD')),
            chip('SPARE', 'SP',     'spare', '', cellName('SPARE')),
            ...barEarly.map(s => chip(s, shiftLabel(s), 'early', '', cellName(s))),
            ...barLate.map(s  => chip(s, shiftLabel(s), 'late',  '', cellName(s))),
            `<button class="brush-chip brush-chip--custom" data-shift="__custom__" aria-pressed="false">Custom…</button>`,
        ].join('');
        // The chips are new elements: re-light the armed one, or the brush stays armed with nothing lit.
        if (brush) armBrush(brush);

        bar.querySelectorAll('.brush-chip').forEach(c => {
            c.addEventListener('click', async () => {
                const custom = /** @type {HTMLElement} */ (c).dataset.shift === '__custom__';
                let shift = /** @type {HTMLElement} */ (c).dataset.shift;
                if (custom) {
                    const typed = await askCustomShift(CUSTOM_SHIFT_PROMPT);
                    if (!typed) return;
                    shift = typed;
                }
                if (brush === shift) dearmBrush();
                else armBrush(shift);
                // A Custom… time is usually not on the bar, so arming it lit nothing (links-app-6): the bar is drawn again
                // with it, and focus goes to its chip, the Custom… button having been replaced.
                if (custom) {
                    renderBrushBar();
                    /** @type {HTMLElement|null} */ (bar.querySelector(`.brush-chip[data-shift="${CSS.escape(brush ?? '__custom__')}"]`))?.focus();
                }
            });
        });
    }

    /** What Custom… asks, from the paint bar and the cell sheet alike. */
    const CUSTOM_SHIFT_PROMPT = 'Type the shift as start–finish in 24-hour time, e.g. 06:00-14:00. It must start between 04:00 and 20:59 and finish the same day.';
    /**
     * A Custom… shift time for the paint bar and the cell sheet: the tidy time, or null. A REFUSED time says so, in
     * `customShiftRefusal`'s words (links-app-7): closing as a Cancel does, it read as the app losing input.
     * @param {string} message @param {string} [defaultValue]
     */
    async function askCustomShift(message, defaultValue = '') {
        const raw = await promptDialog({ title: 'Custom shift', message, defaultValue, placeholder: '06:00-14:00', confirmLabel: 'Set' });
        if (raw === null || !raw.trim()) return null;   // cancelled, or nothing typed: nothing to explain
        const typed = normaliseCustomShift(raw);
        if (!typed) _designActionStatus(customShiftRefusal(raw));
        return typed;
    }

    // ── GRID ──

    /** Open the Build a link card in code, chevron and ARIA included: `initCardCollapse` syncs `aria-expanded` only on a
     *  real click, and one of two call sites once left it "false" over an open card (v19.70). */
    function _openGenerator() {
        const body    = document.getElementById('generatorBody');
        const chevron = document.getElementById('generatorChevron');
        if (body && !body.classList.contains('open')) body.classList.add('open');
        if (chevron) {
            chevron.classList.add('open');
            chevron.setAttribute('aria-expanded', 'true');
        }
    }

    /** The grid card's hint, which must not describe a grid that is not on screen (v19.66). @param {boolean} hasDesign */
    function _setGridHint(hasDesign) {
        const el = document.getElementById('linksGridHint');
        if (el) el.textContent = hasDesign
            ? 'Choose any shift cell to change it. Use the Paint bar to fill cells quickly. Save when done.'
            : `A link is ${TOTAL_POS} lines — everyone works line 1 one week, line 2 the next, all the way round.`;
    }

    /**
     * A design holding MORE lines than the rotation (v19.98). Nothing about opening one looks wrong — the grid and every
     * panel read the rotation's lines, and the next save writes the rest back — so it is assessed as one thing and stored
     * as another. The data is left alone (dropped on load or on save, it is somebody's work gone) and the fact is said.
     * A statement, not a `confirm()`: there is no decision to take now.
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
            renderSummary();   // hidden with the save row, but a stale strip would flash on the next design
            // FOUR states, and only the last two may offer to make a design: while LOADING it would be replaced when the
            // list lands (links-app-1), and after a FAILURE — or a cached answer that cannot tell "none" from "never read
            // here" (links-app-5) — "No designs yet" would be a lie, and a new design a duplicate.
            const state = listLoading ? 'loading' : loadFailed ? 'failed' : binnedOnLoad && _bin().length ? 'binned' : 'empty';
            const offers = state === 'binned' || state === 'empty';
            const emptyMsg   = document.getElementById('linksEmptyMsg');
            const emptyTitle = document.querySelector('#linksEmptyState .links-empty-title');
            const emptyActs  = /** @type {HTMLElement|null} */ (document.querySelector('#linksEmptyState .links-empty-actions'));
            const retry      = document.getElementById('linksEmptyRetry');
            if (emptyTitle) emptyTitle.textContent = state === 'loading' ? LOADING_COPY.title : state === 'failed' ? 'Couldn’t load your designs' : state === 'binned' ? `Your ${PREVIOUS_LINK_LENGTH}-line designs are in Recently deleted` : 'No designs yet';
            if (emptyMsg) emptyMsg.innerHTML = state === 'loading' ? LOADING_COPY.msg
                : state === 'failed' ? `Check your connection and try again. Nothing has been lost — saved designs are kept on the server.`
                // No month: the day the new link starts is not set (owner, 8 Nov 2026); the length is true whenever read.
                : state === 'binned' ? `The link is now ${TOTAL_POS} lines, so ${binnedOnLoad === 1 ? 'the design' : `the ${binnedOnLoad} designs`} drawn for ${PREVIOUS_LINK_LENGTH} moved there. Restore one from <strong>Recently deleted</strong>, in the <span aria-hidden="true">···</span><span class="sr-only">More</span> menu above, if you still need it.`
                : `Build a rotating pattern from staffing targets with the Build a link card below, open one of the shortlisted proposals, or start from an empty <span class="links-nowrap">${TOTAL_POS}-line</span> grid.`;
            if (emptyActs) emptyActs.style.display = offers ? '' : 'none';
            // An installed app has no reload button.
            if (retry) retry.style.display = state === 'failed' ? '' : 'none';
            _setGridHint(false);
            _renderOverLengthNotice();   // `design` is null here, so this hides it
            if (wrapper)    wrapper.style.display    = 'none';
            if (emptyState) emptyState.style.display = '';
            if (saveRow)    saveRow.style.display    = 'none';
            if (tbody)      tbody.innerHTML          = '';
            if (tfoot)      tfoot.innerHTML          = '';
            document.body.classList.remove('links-compare-on');
            if (offers) _openGenerator();
            renderBrushBar();
            renderCoverageCard();
            renderDesignChecks();
            return;
        }

        if (emptyState) emptyState.style.display = 'none';
        if (saveRow)    saveRow.style.display    = '';
        const emptyStatus = document.getElementById('linksEmptyStatus'); if (emptyStatus) emptyStatus.textContent = '';   // done with
        _setGridHint(true);

        // In compare mode the grid is hidden on SCREEN only (body class): print always outputs the open design.
        if (wrapper) wrapper.style.display = '';
        document.body.classList.toggle('links-compare-on', compare.isCompareMode());

        const totals = lineTotals(design.patterns, TOTAL_POS);
        const rows = [];
        for (let pos = 1; pos <= TOTAL_POS; pos++) {
            const posStr  = String(pos);
            const p        = (/** @type {Record<string, any>} */ (design.patterns))[posStr] || emptyPattern();
            const rowClass = isUnfilledPattern(p) ? 'row-unfilled' : '';

            const dayCells = DAYS.map(d => editCellHtml(posStr, d, p[d] ?? 'RD', classifyShift)).join('');

            rows.push(
                `<tr class="${rowClass}" data-pos="${posStr}">` +
                `<td class="pos-num">${posStr}</td>` +
                dayCells +
                _totalCells(totals.rows[pos - 1]) +
                `</tr>`
            );
        }
        grid.render(rows.join(''));   // one Tab stop among the cells, and focus kept if a cell held it
        _renderOverLengthNotice();

        const cov = calcCoverage(design.patterns);
        renderFooter(cov, totals);
        renderCoverageCard();
    }

    // The grid's input is links-grid-input.js's; what a cell MEANS — paint it, or open the sheet — is here.
    const grid = createGridInput(document.getElementById('linksGridBodyRows'), {
        lines: TOTAL_POS, days: DAYS, ready: () => !!design, armed: () => brush !== null,
        paint: (pos, day) => applyShift(pos, day, brush), edit: openCellEdit,
    });
    trackPaintBarHeight(document.getElementById('brushBar'), document.getElementById('linksGridTable'));

    /** Paint one cell and repaint what reads it. @param {any} pos @param {any} day @param {any} shift */
    function applyShift(pos, day, shift) {
        if (!design) return;
        const pats = /** @type {Record<string, any>} */ (design.patterns);
        if (!pats[pos]) pats[pos] = emptyPattern();
        // The value it already holds is not a change, or a stray tap arms every unsaved-work question (v19.38).
        if (pats[pos][day] === shift) return;
        pats[pos][day] = shift;
        dirty = true;
        updateSaveBtn();

        const tbody = document.getElementById('linksGridBodyRows');
        const btn = /** @type {HTMLElement|null} */ (tbody?.querySelector(`.shift-cell-btn[data-pos="${pos}"][data-day="${day}"]`) ?? null);
        if (btn) repaintCellBtn(btn, pos, day, shift);

        const tr = tbody?.querySelector(`tr[data-pos="${pos}"]`);
        if (tr) tr.classList.toggle('row-unfilled', isUnfilledPattern(pats[pos]));

        const cov = calcCoverage(design.patterns);
        // Only the EDITED row's totals: a whole-grid render would tear out the cell under the pointer.
        const totals = lineTotals(design.patterns, TOTAL_POS);
        if (tr) {
            tr.querySelectorAll('.tot-cell').forEach(el => el.remove());
            tr.insertAdjacentHTML('beforeend', _totalCells(totals.rows[Number(pos) - 1]));
        }
        renderFooter(cov, totals);
        // The bar is the design's times, so it is redrawn only when they change: a drag paints cell by cell.
        const sig = _brushSig();
        if (sig !== _lastBrushSig) renderBrushBar();
        renderCoverageCard();
        renderDesignChecks();
    }

    /**
     * One line's three totals (v21.09). A COVER week shows the contracted week, muted, because it is a convention and
     * not a reading; its days are a dash — unknown, not none. An unfilled line is dashes, not "0h 00m" noise.
     * @param {{exSundayMinutes: number, allMinutes: number, days: number|null, assumed: boolean,
     *          unreadable: number, loneSpare?: number, unfilled: boolean}|undefined} t
     */
    function _totalCells(t) {
        // The reason ADDS to the figure (links-app-15): a cell's name replaces its content, and the total went unread.
        const cell = (/** @type {string} */ text, /** @type {string} */ extra = '', /** @type {string} */ why = '') =>
            `<td class="tot-cell${extra}"${why ? ` aria-label="${escapeHtml(`${text === '—' ? 'Not known' : text}. ${why}`)}"` : ''}>${escapeHtml(text)}</td>`;
        if (!t || t.unfilled) return cell('—') + cell('—') + cell('—');
        if (t.assumed) {   // a timed Sunday overtime turn is real hours on top, and the footer counts it
            const h = hmFromHours(t.exSundayMinutes / 60), all = hmFromHours(t.allMinutes / 60);
            const why = 'Cover week — counted as the contracted week; it carries no stored times';
            return cell(h, ' tot-assumed', why) + cell(all, ' tot-assumed', all === h ? why : 'Cover week — the contracted week, plus its Sunday overtime')
                + cell('—', ' tot-assumed', 'A cover week does not record which days it works');
        }
        // A floor — an unreadable duty, or a lone spare day with no times (lineTotals) — is orange and ends in "+".
        const floor = t.unreadable + (t.loneSpare ?? 0);
        const flag = floor ? ' tot-uncertain' : '';
        // A line with no Sunday duty has the same figure twice; muting the repeat lets the Sunday lines stand out.
        const same = !floor && t.allMinutes === t.exSundayMinutes ? ' tot-same' : '';
        const why  = floor ? [
            t.unreadable ? `${t.unreadable} duty time${t.unreadable === 1 ? '' : 's'} on this line could not be read` : '',
            t.loneSpare ? `${t.loneSpare} spare day${t.loneSpare === 1 ? '' : 's'} on this line carr${t.loneSpare === 1 ? 'ies' : 'y'} no times` : '',
        ].filter(Boolean).join(', and ') + ', so these totals are a floor' : '';
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
        const cells = coverCellsHtml(cov);
        // The hours averages are `weeklyHours`', as the checks row and the strip read them; only the DAYS average is the
        // footer's own, over the WORKING lines (invariant 7), so both divisors are printed.
        const wh  = weeklyHours(design.patterns, TOTAL_POS);
        // "(partial)" says what `hoursFigure` says on the checks row and the strip, on a line of its own under the
        // figure: beside it, it widened the last columns past the card at 769px. Not a "+" floor — a line with no
        // readable time is LEFT OUT of the average, which can then be high as well as low.
        const avg = (/** @type {number|null} */ v, /** @type {string} */ text, /** @type {string} */ note, partial = false) =>
            `<td class="tot-cell tot-avg">` +
            (v === null ? `<span class="tot-avg-num">—</span>`
                : `<span class="tot-avg-num">${escapeHtml(text)}</span>`) +
            (partial && v !== null ? `<span class="tot-avg-note tot-avg-partial">(partial)</span>` : '') +
            `<span class="tot-avg-note">${escapeHtml(note)}</span></td>`;
        const lineWord = (/** @type {number} */ n, /** @type {string} */ w) => `over ${n} ${w}${n === 1 ? '' : 's'}`;
        const avgCells = totals
            ? avg(wh.exSunday, hoursFigure(wh).hm ?? '—', lineWord(TOTAL_POS, 'line'), hoursFigure(wh).partial)
            + avg(wh.all, hoursFigure(wh, 'all').hm ?? '—', lineWord(TOTAL_POS, 'line'), hoursFigure(wh, 'all').partial)
            + avg(totals.daysAverage, String(totals.daysAverage ?? ''), lineWord(totals.daysLines, 'working line'))
            : '';
        tfoot.innerHTML = `<tr><td class="col-pos cov-foot-label">Cover</td>${cells}${avgCells}</tr>`;
    }

    /**
     * The app's own sheet over one cell — never a native `<select>`, whose popup the OS draws (v23.38). The button stays
     * put, so a dismissed sheet has changed nothing. The options are `buildShiftOptions`', read off a detached select by
     * the sheet's `readGroups`: one producer, its `<optgroup>`s the sheet's headings.
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
            searchLabel: 'Search shift times',
            groups: readGroups(holder),
            current,
            createLightbox,
            onPick: async value => {
                let newVal = value;
                if (newVal === '__custom__') {
                    const typed = await askCustomShift(CUSTOM_SHIFT_PROMPT, current.includes('-') ? current : '');
                    if (!typed) return;   // cancelled or refused: the cell was never taken apart
                    newVal = typed;
                }
                // `applyShift` alone decides whether this is a change (v19.38).
                applyShift(pos, day, newVal);
            },
        });
    }

    /**
     * Repaint a cell's button IN PLACE: replaced, it dropped focus to `<body>` after every keyboard edit.
     * @param {HTMLElement} btn @param {any} pos @param {any} day @param {any} shift
     */
    function repaintCellBtn(btn, pos, day, shift) {
        btn.className = `shift-cell-btn type-${classifyShift(shift)}`;
        btn.setAttribute('aria-label', cellAriaName(pos, day, shift));
        btn.textContent = shiftLabel(shift);
    }

    // ── BUILD THE LINK ──

    const targets = createTargetPanel({
        getActiveDesignId: () => activeDesignId,
        currentUser,
        isAdmin,
        sessionReady,
        buildShiftOptions,
        defaultSlotTime: EARLY_SHIFTS[0] || '06:20-14:20',
    });
    const refreshGenTargetsForDesign = targets.refreshForDesign;
    /** Build the link's answer while the designs are still loading; the load clears it when it lands. */
    const STILL_LOADING = 'Your saved designs are still loading — build the link once they are in.';

    (function initGenerator() {
        if (!document.getElementById('genSlotRows')) return;
        // Which build of these inputs this is (links-build-press.js rule 5): one per page life.
        const builds = createBuildCounter();

        document.getElementById('genApplyBtn')?.addEventListener('click', async () => {
            const errEl = document.getElementById('genError');
            if (errEl) errEl.textContent = '';
            // A failed press must not leave the previous success under the button, beside a fresh error.
            const _mirrorEl = document.getElementById('genStatus');
            if (_mirrorEl) { _mirrorEl.hidden = true; _mirrorEl.textContent = ''; }
            // Not until the designs are in (links-app-1): the load replaces the working copy when it lands.
            if (listLoading) { if (errEl) errEl.textContent = STILL_LOADING; return; }

            const { slots: genSlots, spareLines: genSpareLines } = targets.getTable();
            if (genSlots.length === 0) { if (errEl) errEl.textContent = 'Add at least one shift row first.'; return; }
            const overCapacity = overCapacityLine(targets.totals(), TOTAL_POS);
            if (overCapacity) { if (errEl) errEl.textContent = overCapacity; return; }

            const built = generateLink({ slots: genSlots, spareLines: genSpareLines, lines: ROTATING_LINES });
            const generated = built.patterns;
            if (!generated) {
                if (errEl) errEl.textContent = refusalLine(built, { lines: TOTAL_POS, spareLines: genSpareLines,
                    hoursPerLine: assessTargetHours(genSlots, { spareLines: genSpareLines, totalLines: TOTAL_POS }).hoursPerLine });
                return;
            }

            const _hasWork = !!design && Object.values(/** @type {Record<string, any>} */ (design.patterns || {}))
                .some(p => DAYS.some(d => { const v = p?.[d]; return v && v !== 'RD' && v !== 'OFF'; }));
            // Read BEFORE the confirm: the button's position (the dialog locks the scroll), and whether the build opens a
            // NEW design, as the question said — a copy's first save landing meanwhile made a proposal a saved design.
            const _btnEl = document.getElementById('genApplyBtn');
            const _btnViewTop = _btnEl?.getBoundingClientRect().top;
            const _asNew = !design || !!activeProposalId;
            if (!await confirmDialog(buildConfirm({ lines: TOTAL_POS, name: design?.name ?? '', proposal: !!activeProposalId, dirty, hasWork: _hasWork }))) return;

            // SAY IT, THEN DO IT (links-app-21): the line-order search runs on the main thread after the confirm,
            // about 0.2–0.7 s on a desktop and several times that on a phone. So the button is HELD and says so,
            // a frame is given to paint that, and the release is booked BEFORE the search, so a tap during it is
            // dropped and nothing the search throws can leave the button held.
            if (_mirrorEl) { _mirrorEl.textContent = 'Building the link…'; _mirrorEl.hidden = false; }
            _designActionStatus('Building the link…', '');
            if (_btnEl) /** @type {HTMLButtonElement} */ (_btnEl).disabled = true;
            await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
            requestAnimationFrame(() => { if (_btnEl) /** @type {HTMLButtonElement} */ (_btnEl).disabled = false; });
            const _chk = (/** @type {string} */ id) =>
                !!(/** @type {HTMLInputElement|null} */ (document.getElementById(id))?.checked);
            const _on = {
                variety: _chk('objVariety'), maxRun: _chk('objMaxRun'), gentle: _chk('objGentle'),
                weekends: _chk('objWeekends'), longWeekends: _chk('objLongWeekends'),
            };
            // A box's own figure, never a falsy one swapped for the default (links-app-8): "at least 0" is a real
            // answer. Only a box holding no number falls back; one under its minimum is raised to it. Either way
            // the box is written back, so it never shows a figure the build did not use.
            const _num = (/** @type {string} */ id, /** @type {number} */ dflt, min = 0) => {
                const el = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
                const typed = parseInt(el?.value ?? '', 10);
                const n = Number.isFinite(typed) ? Math.max(min, typed) : dflt;
                if (el && el.value !== String(n)) el.value = String(n);
                return n;
            };
            const _target = _num('objLongTarget', 4);
            const _blockTarget = _num('objBlockTarget', DEFAULT_BLOCK_TARGET, 1);
            const _maxRunTarget = _num('objMaxRunTarget', DEFAULT_MAX_RUN, 1);
            // The fingerprint is the whole input surface, so a nudged headcount starts again at the canonical build.
            const attempt = builds.next(JSON.stringify([genSlots, genSpareLines, _on, _target, _blockTarget, _maxRunTarget]));
            const _ord = reorderLines(generated, {
                on: _on, longWeekendTarget: _target, blockTarget: _blockTarget,
                maxRunTarget: _maxRunTarget, attempt,
            });
            const _final = _ord.changed ? applyOrder(generated, _ord.order) : generated;

            if (_asNew || !design) {
                // A proposal is not yours to overwrite: a NEW unsaved design, named on its first save.
                _setWorkingCopy(null, { copy: { id: null, name: '', patterns: _final, window: design?.window } });
            } else {
                // Lines past the rotation an older, longer design holds are kept, as its notice promises (rule 6).
                design = { ...design, patterns: withSurplusLines(_final, design.patterns, TOTAL_POS) };
            }

            dirty = true;
            compare.resetCompare();
            dearmBrush();
            _renderAll();
            // HOLD THE BUTTON STILL THROUGH THE REFLOW (v20.54): the first build grows the card above by a whole
            // grid. The dialog's unlock ends in `window.scrollTo(0, saved)` after this handler, so the loop
            // VERIFIES rather than trusts — measure, shift, repeat to 1px — with two budgets, one to wait for the
            // unlock and one to converge (v21.83: one budget was spent waiting on a loaded runner).
            if (_btnEl && _btnViewTop !== undefined) {
                const _waitUntil = performance.now() + 3000;
                const _workUntil = performance.now() + 5000;
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

            const _statusText = builtStatusLine(built, _ord, { attempt, maxRunOn: _on.maxRun, maxRunTarget: _maxRunTarget,
                explore: builds.explore(_ord.order.join(','), cost(_ord.after, _on, _target, _blockTarget)) });
            // Written where the pressing happens as well as where the saving does (v20.54): the save row is a card
            // above the button. The save row's copy carries the aria-live; the mirror is aria-hidden.
            const status = document.getElementById('linksSaveStatus');
            if (status) { status.textContent = _statusText; status.className = 'links-save-status ok'; }
            const mirror = document.getElementById('genStatus');
            if (mirror) { mirror.textContent = _statusText; mirror.hidden = false; }
        });
    })();

    // ── SAVE / LOAD ──

    /** Both Save buttons, label and state, are the masthead's; a dirty design's old status line goes. */
    function updateSaveBtn() {
        const status = document.getElementById('linksSaveStatus');
        header?.render(_headerState());
        if (status && dirty) status.textContent = '';
    }

    /** Build the print-only masthead: which design, which version, printed when — stamped on every prepare, so a page
     *  left open for a week cannot print yesterday's date on today's sheet. */
    function _renderPrintMasthead() {
        const el = document.getElementById('printDesignName');
        if (!el) return;
        if (!design) { el.textContent = ''; return; }
        const entry = designs.find(x => x.id === activeDesignId);
        const when  = lastSaveTime(entry);
        // The provenance is the SAVED document's and the grid the LIVE one's, so unsaved edits are SAID on the paper: the
        // sheet goes to the assessing manager under somebody's name (v19.62).
        const unsaved = dirty ? ' · includes unsaved changes' : '';
        const saved = activeProposalId ? `Shortlisted proposal ${proposalById(activeProposalId)?.ref ?? ''}, built into the app${unsaved}` : entry?.updatedBy
            ? `Last saved by ${entry.updatedBy}${when ? ` · ${formatDayMonthYear(when)}` : ''}${unsaved}`
            : `Not saved yet${unsaved}`;
        // The time too: a design is reprinted repeatedly, and the manager may hold two of them.
        const printedNow = new Date();
        const printed = printedStamp(printedNow, formatClock(printedNow));
        // And the window it was designed to: read away from the app, a moved window is otherwise invisible (v19.54).
        const win = formatWindow(design.window);
        const moved = isDefaultWindow(design.window) ? '' : ' (moved)';
        el.innerHTML =
            `<span class="print-design-title">${escapeHtml(design.name || 'Link design')}</span>` +
            `<span class="print-design-meta">${escapeHtml(saved)} · ${escapeHtml(printed)}</span>` +
            `<span class="print-design-meta">Staffed window: ${escapeHtml(win + moved)}</span>`;
    }
    // Every disclosure opened for paper, the masthead stamped on every prepare, and the page put back however the
    // print ends — the reader's next touch, key or scroll included, because iOS sends no `afterprint` (links-print.js).
    const printPrep = createPrintPrep({ stamp: _renderPrintMasthead });
    document.getElementById('linksPrintBtn')?.addEventListener('click', () => {
        // In a home-screen app on iOS 27 `window.print()` does nothing, so the tap explains and offers Safari (v24.61).
        // Prepared only when a print will follow: the restore waits on events a print that never happens never sends.
        printOrExplain({ print: () => printPrep.printNow(() => window.print()), explain: () => explainNoPrint(confirmDialog) });
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
        // The WHEN is one unbreakable phrase: squeezed by the chips, the line broke inside the date.
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
        // A design gets its name at its FIRST save (header rule 3), asked before "Saving…": a cancel is not a failure.
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
        // WHAT THIS SAVE IS FOR, fixed before the first await: the page moves on while it is in flight, and a result
        // applied to what is on screen then called unwritten edits saved and put this id on another design. `written`
        // is filled INSIDE the write (a transaction may run it twice), so it is the payload that went.
        const dsn = design, savingId = activeDesignId, act = activation;
        const here = () => act === activation;
        // Which save this is, and the baseline a kept copy of it is restored onto if the server never hears of it.
        const seq = queuedSaves.next(), before = { loadedRevision, loadedUpdatedAt, baselineUnknown };
        /** @type {any} */ let written = null;
        const buildDoc = () => {
            written = { patterns: deepCopyPatterns(dsn.patterns), window: normaliseWindow(dsn.window) };
            return docPayload({ ...dsn, ...written }, { updatedBy: currentUser, updatedAt: serverTimestamp() });
        };
        /** A write landed: record it, and clear `dirty` only if nothing was edited since it was built. A QUEUED one clears
         *  `dirty` too — a re-save would queue a duplicate — but never says the server has it, and its copy is kept until
         *  the server answers (store rule 6): a second tab's queue dies with the page. */
        const landed = (/** @type {string} */ id, /** @type {any} */ base, /** @type {any} */ updatedAt, queued = false, /** @type {Promise<string>|undefined} */ settled = undefined) => {
            const entry = designs.find(x => x.id === id);
            recordSave(entry, written, currentUser, updatedAt, base.loadedRevision);
            if (queued) {
                queuedIds.add(id);   // what the masthead's pill says (links-app-4)
                queuedSaves.queued(id, seq, written, before);
                _whenQueuedEnds(id, settled, seq, !savingId);   // a FIRST save made the design: refused, it made nothing
            } else { queuedIds.delete(id); queuedSaves.confirmed(id); }
            if (!here()) return;
            ({ loadedRevision, loadedUpdatedAt, baselineUnknown } = base);
            const same = JSON.stringify([design?.patterns, normaliseWindow(design?.window)])
                === JSON.stringify([written.patterns, written.window]);
            dirty = !same;
            if (same) _keepUnconfirmedOrForget();   // saved: no unsaved copy — but one only queued is kept until it lands
            updateSaveBtn();
            const [said, lead] = queued ? [QUEUED_SAVE, 'Saved in this browser'] : ['✓ Saved', '✓ Saved'];
            if (status) { setStatus(status, same ? said : `${lead} — your later changes are not saved yet`); status.className = `links-save-status${queued ? '' : ' ok'}`; }
            updateLastSaved(currentUser, lastSaveTime(entry) ?? new Date());
        };
        const key = savingId ?? 'unsaved';   // see savingKeys
        savingKeys.add(key);
        for (const b of btns) { b.disabled = true; b.textContent = 'Saving…'; }
        header?.render(_headerState());
        if (status) { status.textContent = 'Saving…'; status.className = 'links-save-status'; }

        try {
            await sessionReady;

            if (!savingId) {
                // A first save is the store's one create, so its baseline is armed as every other new design's is.
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
                landed(created.id, created.baseline, created.updatedAt, !!created.queued, created.settled);
                renderDesignPicker();
                return;
            }

            // The compare-and-set is the store's (links-design-store.js); what is here is the conversation with the designer.
            const confirmOverwrite = (/** @type {{by:string, at:any}} */ c) => {
                // `formatClock`, never toLocaleTimeString, which can fall back to 12-hour beside a save row in 24.
                const at = c.at?.toDate?.();
                const when = at instanceof Date && !Number.isNaN(at.getTime()) ? formatClock(at) : '';
                // Your OWN name is another tab or device, or an unchecked rename: there is no "them".
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
            // Not "Refreshing the page would discard them": a hidden page keeps unsaved work (keepDraftWhenHidden).
            const markNotSaved = () => {
                updateSaveBtn();
                if (status) {
                    status.textContent = 'Not saved — your changes are still here. Save asks again, and can keep them as a new design.';
                    status.className   = 'links-save-status err';
                }
            };
            // A refused save is news about the LIST: re-read it, or compare and reopening show the designer's own old copy as
            // the colleague's. An edited working copy keeps its baseline, so a later Save still asks.
            const refreshAfterRefusal = () => _refreshLists().then(() => {
                const entry = here() ? designs.find(x => x.id === savingId) : null;
                if (entry) updateLastSaved(entry.updatedBy, lastSaveTime(entry));
            }).catch((/** @type {any} */ err) => console.error('[Links] Refreshing the list after a refused save failed:', err));
            // Deleted by a colleague while open: never overwritten, which would undo their delete unseen (v19.41). Out of the
            // live list, even when the page has moved on, and the work offered as a NEW design.
            const dropDeleted = (/** @type {any} */ data) => {
                designs = designs.filter(x => x.id !== savingId);
                // Upserted: after "Not now" each further Save lands here again.
                if (data) library.upsertBin(binEntryFromDoc(savingId, data));
                renderDesignPicker();
            };
            const deletedElsewhere = async (/** @type {any} */ data) => {
                markNotSaved();
                refreshAfterRefusal();   // asked BEFORE the drop, so an answer that has not heard of the delete cannot list it again
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

            // Declining is never a dead end: keep both (v19.38). Worded like the dialog it answers, and its "Save mine as new"
            // is the choice made, so the copy asks nothing more.
            const declineOrFork = async (/** @type {any} */ c) => {
                markNotSaved();
                refreshAfterRefusal();
                if (await confirmDialog({
                    title: 'Keep your version too?',
                    message: `${c?.by === currentUser ? 'That' : 'Their'} version stays as it is. Yours can be saved as a NEW design, so nothing is lost either way.`,
                    confirmLabel: 'Save mine as new',
                    cancelLabel: 'Not now',
                })) await duplicateDesign(true);
            };

            // The protocol is the store's, which never asks; what to ASK, and what to do with the answer, is here.
            const res = await store.save({
                id: savingId,
                buildPayload: buildDoc,
                baseline: loadedUpdatedAt,
                loadedRevision,
                baselineUnknown,
                currentUser,
            });

            if (res.status === 'deleted-elsewhere' && queuedSaves.neverMade(savingId)) return;   // never MADE, not deleted: already said
            // Nothing written, and another design is open: the conversation below would act on THAT one.
            if (!here() && (res.status === 'conflict' || res.status === 'deleted-elsewhere')) {
                refreshAfterRefusal();   // so "Open it to check" opens the version it changed to; asked before the drop, as in deletedElsewhere
                if (res.status === 'deleted-elsewhere') dropDeleted(res.deletedData);
                _designActionStatus(`“${dsn.name}” was not saved — it ${res.status === 'conflict' ? 'changed elsewhere while saving. Open it to check.' : 'was deleted elsewhere while saving.'}`);
                return;
            }
            if (res.status === 'deleted-elsewhere') { await deletedElsewhere(res.deletedData); return; }
            if (res.status === 'conflict') {
                // CONSENT IS PER VERSION (v21.96): a save made while the question sat open is asked about in turn, a
                // bounded number of times.
                let pending = res.conflict;
                for (let round = 0; ; round++) {
                    if (!await confirmOverwrite(pending)) { await declineOrFork(pending); return; }
                    const forced = await store.save({
                        id: savingId, buildPayload: buildDoc,
                        baseline: loadedUpdatedAt, loadedRevision, baselineUnknown, currentUser,
                        forcing: true,
                        // Both: `rev` is exact, `at` the fallback for a design with no revision yet.
                        forceAgainstRev: pending?.rev ?? null,
                        forceAgainstRevision: pending?.at?.toMillis?.() ?? null,
                    });
                    if (forced.status === 'deleted-elsewhere') { await deletedElsewhere(forced.deletedData); return; }
                    if (forced.status === 'conflict') {
                        if (round >= 2) { await declineOrFork(forced.conflict); return; }
                        pending = forced.conflict;
                        continue;
                    }
                    landed(savingId, forced.baseline, forced.updatedAt, forced.status === 'queued', forced.settled);
                    break;
                }
            } else {
                landed(savingId, res.baseline, res.updatedAt, res.status === 'queued', res.settled);
            }
        } catch (err) {
            console.error('[Links] Save failed:', err);
            if (here()) {
                dirty = true;
                // Signed out mid-save: an online transaction may or may not have landed, so say check, and keep it unsaved.
                if (status) { status.textContent = unconfirmedWriteLine(err, 'this save', 'the design') ?? 'Save failed — try again'; status.className = 'links-save-status err'; }
            }
        } finally {
            savingKeys.delete(key);
            header?.render(_headerState());   // not updateSaveBtn: that would wipe the status just written
        }
    }

    // Every design read and write, with its Firebase handles passed in so the interleavings are testable.
    const store = createDesignStore({
        db, doc, getDoc, setDoc, getDocs, runTransaction,
        serverTimestamp, deleteField, designsCol: DESIGNS_COL,
        withClaimRetry: writeWithClaimRetry,
        getDocFromCache,   // offline, plain getDoc cannot tell "removed for good" from "never held" (links-design-12)
        ownWritesSent: whenOwnWritesSent,   // its own queued saves before any transaction (store rule 5)
    });
    library = createDesignLibrary({
        store, currentUser,
        getDesigns: () => designs,
        addDesign: (d) => { designs.push(d); _sortDesigns(); },
        activate: _activateDesign,
        isDirty: () => dirty,
        activeId: () => activeDesignId,   // Keep only the shortlist warns only when the open design moves (links-design-10)
        markQueued: (id, settled) => { queuedIds.add(id); _whenQueuedEnds(id, settled); },   // an import queued in this browser
        hasOpenDesign: () => !!design,
        renderPicker: renderDesignPicker,
        refreshLists: _refreshLists,
        actionStatus: _designActionStatus,
        getHeader: () => header,
        // Keep only the shortlist: the moved designs leave the list, and an open one gives way to the next or to the first
        // proposal — unless it was EDITED while the moves ran, when the edits stay as a new design. Compare is reset, so the
        // page is drawn again either way (links-app-10).
        snapshot: () => ({ act: activation, before: _contentKey() }),
        removeDesigns: (/** @type {Set<string>} */ ids, /** @type {any} */ mark) => {
            designs = designs.filter(d => !ids.has(d.id));
            compare.resetCompare();
            const edited = ids.has(activeDesignId) && dirty && !!design && !!mark && (mark.act !== activation || mark.before !== _contentKey());
            if (edited && design) _openAsNew(design.patterns, design.window);
            if (ids.has(activeDesignId) && !edited) _activateDesign(designs[0] ?? PROPOSAL_ENTRIES[0]);
            else _renderAll();
            return edited;
        },
    });

    const binFailed = new Set();   // old-length designs whose move to the bin FAILED this visit — shown live
    const binMoves = new Set();    // old-length designs whose move STARTED and has not failed or been skipped
    /** Re-read and repaint the LISTS, never `loadDesigns`, which rebuilt the working copy over unsaved edits. */
    async function _refreshLists() {
        // The answer is older than the page, so it is applied only to the rows the page left alone (`mergeListAnswer`).
        const listed = new Map(designs.map(d => [d.id, listRowSig(d)]));
        const binnedThen = new Map(library.binList().map((/** @type {any} */ b) => [b.id, listRowSig(b)]));
        const openId = activeDesignId, act = activation;
        try {
            // The load's own split, but the bin shows only a move this page started.
            const { docs, fromCache } = await store.loadAll();
            const split = splitDesignDocs(docs, { binOld: binOldOnRefresh(binMoves), currentUser });
            // A cached answer holding no live design cannot say the list is empty: applied, it would empty the picker.
            if (readCannotAnswer(fromCache, split)) console.warn('[Links] List refresh skipped: a cached read holds no live design');
            else _applyListAnswer(split, listed, binnedThen, openId, act);
        } catch (err) { console.error('[Links] List refresh failed:', err); }
        renderDesignPicker(); library.renderBinList(); compare.renderCompare();
    }
    /** @param {{ named: any[], binned: any[] }} split @param {Map<string, string>} listed @param {Map<string, string>} binnedThen
     *  @param {string|null} openId @param {number} act  the open design and the activation when the read went out */
    function _applyListAnswer({ named, binned }, listed, binnedThen, openId, act) {
        // A save only this browser has — queued, or refused and kept (links-queued-saves.js rule 4) — keeps its row.
        designs = mergeListAnswer(designs, named, listed, (id) => !!queuedSaves.get(id)); _sortDesigns();
        library.setBin(sortByDeleted(mergeListAnswer(library.binList(), binned, binnedThen)));
        // A CLEAN open design follows a newer save of it (Nov 2026): the masthead and the printed sheet read the
        // entry, so a grid left on the older version went out under the colleague's name. Edited, it stays as it
        // is, on its own baseline, so its next Save still asks.
        if (!openId || act !== activation || dirty || savingKeys.has(openId)) return;
        const entry = designs.find(x => x.id === openId);
        if (entry && listRowSig(entry) !== listed.get(openId)) _followEntry(entry);
    }

    /** The open design becomes its entry's version, baseline included — nothing on it is unsaved. @param {any} entry */
    function _followEntry(entry) {
        design = workingCopy(entry);
        ({ loadedRevision, loadedUpdatedAt, baselineUnknown } = baselineFromEntry(entry));
        updateLastSaved(entry.updatedBy, lastSaveTime(entry));
        renderGrid(); renderBrushBar(); renderDesignChecks(); updateSaveBtn();
    }

    /** Bin the old-length designs, each re-checked in a transaction (`binIfStill`), never from a cached read and never
     *  queued; a restore or purge of one waits for its move (`trackBinMove`). Said at once. @param {string[]} ids */
    function _binPre26(ids) {
        binnedOnLoad = ids.length;
        if (!ids.length) return;
        let failed = 0;
        const say = () => _designActionStatus(binnedOnLoad
            ? `${binnedOnLoad} design${binnedOnLoad === 1 ? '' : 's'} drawn for the ${PREVIOUS_LINK_LENGTH}-line link ${binnedOnLoad === 1 ? 'is' : 'are'} in Recently deleted — restore from there if you still need ${binnedOnLoad === 1 ? 'it' : 'them'}.`
            : failed ? `${failed === 1 ? 'A design' : `${failed} designs`} drawn for the ${PREVIOUS_LINK_LENGTH}-line link could not be moved to Recently deleted, so ${failed === 1 ? 'it is' : 'they are'} still in your list.` : '', binnedOnLoad || !failed ? 'ok' : 'err', true);
        say();
        // Settled OUTSIDE the bin: stop claiming it, and an empty page opens it, as a load would.
        const backInList = () => { binnedOnLoad--; _refreshLists().then(() => { if (!design && !loadFailed) _activateDesign(designs[0]); say(); }); };
        for (const id of ids) {
            binMoves.add(id);   // a refresh now shows it in the bin too, until the move says otherwise
            library.trackBinMove(id, store.binIfStill(id, currentUser, isPre26Design)
                .then((/** @type {string} */ r) => { if (r === 'skipped') { binMoves.delete(id); backInList(); } })   // restored or redrawn since: show it live
                // A FAILED move leaves it live: shown in the bin, its Restore blamed a colleague.
                .catch((/** @type {any} */ err) => { console.error('[Links] Binning an old-length design failed:', err); binMoves.delete(id); binFailed.add(id); failed++; backInList(); }));
        }
    }

    /** Load every named design (the store's `loadAll`, which says whether the cache answered), and migrate the legacy
     *  `combined-28` document into a named design the first time a collection that has never held one is read. */
    async function loadDesigns() {
        listLoading = true;
        loadFailed = false;
        /** @type {any} */ let open = null;   // what the working copy becomes once the list is in
        try {
            await sessionReady;
            const { docs, fromCache } = await store.loadAll();
            // What the answer MEANS is links-design-load.js's: an empty cached one is the FAILED state (links-app-5).
            const split = splitDesignDocs(docs, { binOld: binOldOnLoad(fromCache, binFailed), currentUser });
            if (readCannotAnswer(fromCache, split)) throw new Error('a cached read holds no live design, so whether any exist is unknown');
            const { named, binned, legacyData, toBin } = split;
            _binPre26(toBin);

            // ONE-TIME migration of combined-28, through the shared mapping (`migratesLegacy`).
            if (migratesLegacy(split)) {
                const migrated = designFromDoc('', { ...legacyData, name: 'Design 1' });
                // Stamped as the person migrating, now: the rules accept only the writer's own name
                // at the server's time (22 Nov 2026), so copying the legacy pair would be refused.
                const { id: migratedId, baseline: migratedBase } = await store.create(docPayload(migrated, {
                    updatedBy: currentUser,
                    updatedAt: serverTimestamp(),
                }));   // its revision too, or the first save met revision 1 holding none: a false conflict
                named.push({ ...migrated, id: migratedId, updatedBy: currentUser, revision: migratedBase.loadedRevision });
            }

            named.sort(byDesignName);   // auto-ids come back in random order
            designs = named;
            library.setBin(sortByDeleted(binned));   // the bin is PERMANENT: nothing here deletes anything (links-deletion.js)
            // The design (or proposal) open last visit, else the first saved one; nothing saved opens nothing.
            open = designToOpen(designs, PROPOSAL_ENTRIES, lsGet(ACTIVE_KEY));
        } catch (err) {
            console.error('[Links] Load failed:', err);
            loadFailed = true;
        }
        // Replaced HERE, after the awaits, so `activation` moves only when the page really moves on (links-app-1).
        _setWorkingCopy(open, { remember: !!open });
        if (open) updateLastSaved(open.updatedBy, lastSaveTime(open));
        listLoading = false;
        const genErr = document.getElementById('genError');
        if (genErr?.textContent === STILL_LOADING) genErr.textContent = '';
        _renderAll();
        refreshGenTargetsForDesign();   // the open design's remembered generator targets
    }

    // Figures the static markup carries, stamped from their constants so the HTML cannot go stale: the rotation length
    // (fifteen prose copies of an old one once did, v19.98), the minimum rest in the line-order note, a cover week's duties.
    for (const el of document.querySelectorAll('.js-rotating-lines')) el.textContent = String(TOTAL_POS);
    for (const el of document.querySelectorAll('.js-min-rest-hours')) el.textContent = String(MIN_REST_MINUTES / 60);
    for (const el of document.querySelectorAll('.js-spare-worked-days')) el.textContent = String(SPARE_WORKED_DAYS);
    for (const el of document.querySelectorAll('.js-cover-week-run')) el.textContent = String(SPARE_WORKED_DAYS + 1);
    // A cover week is a whole line, so one line at least is left to work.
    document.getElementById('genSpareLines')?.setAttribute('max', String(TOTAL_POS - 1));
    document.getElementById('objLongTarget')?.setAttribute('max', String(TOTAL_POS));

    initCardCollapse('linksGridToggleHeader', 'linksGridBody',  'linksGridChevron');
    initCardCollapse('generatorToggleHeader', 'generatorBody',  'generatorChevron');
    initCardCollapse('coverageToggleHeader',  'coverageBody',   'coverageChevron');
    initCardCollapse('checksToggleHeader',    'checksBody',     'checksChevron');

    for (const b of _saveBtns()) b.addEventListener('click', saveChanges);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && brush !== null) dearmBrush();
    });

    // ── UNSAVED WORK ──
    warnOnUnload(() => dirty);
    // The exits nothing can ask about — iOS discarding a hidden page, a swipe back — keep the working copy and its
    // baseline, offered on the next load. Edits on top of a save only this browser holds keep that save's earlier
    // baseline, as the server may never get it. ONE slot: unsaved edits win it over another design's queued save.
    keepDraftWhenHidden(() => dirty && !!design, {
        keep: () => draftSlot.keep({ design: activeDesignId ?? activeProposalId }, { patterns: design?.patterns, window: design?.window ?? null,
            baseline: queuedSaves.get(activeDesignId)?.baseline ?? { loadedRevision, loadedUpdatedAt, baselineUnknown } }),
        forget: _keepUnconfirmedOrForget,
    });

    // A drawer link or the About panel's Operations link asks first, with the shared question (links-app-18).
    askBeforeLeavingByDrawer(() => dirty);

    // ── ABOUT, TIPS AND ORIENTATION ──
    (function () {
        const about = initAboutLightbox({
            appLabel: 'Marylebone Roster — Links',
            getUserName: () => currentUser,
        });
        if (about) { openAboutLightbox = about.open; closeAboutLightbox = about.close; }

        // Operations is the admin's: for anybody else the link is a dead end (operations.html sends them to Admin).
        const opsLink = document.getElementById('linksOpsLink');
        if (opsLink && isAdmin) opsLink.hidden = false;

        // Header logo: back to the calendar, through the unsaved-changes question (about-lightbox.js).
        wireHeaderLogo(async () => {
            if (dirty && !await confirmDialog({ message: 'You have unsaved changes. Leave anyway?', confirmLabel: 'Leave' })) return;
            dirty = false;   // answered: no second "Leave site?"
            window.location.href = './';
        });
    })();

    initTipsLightbox(CARD_TIPS);   // the `?` panels; the content is links-tips.js

    // ORIENTATION, on a device's first visit and from its row in the About panel for ever after. It holds the three
    // things a newcomer cannot work out from the screen: nothing here touches the live roster, the checks report rather
    // than approve, and designs are shared. So it NEVER expires — as an expiring notice it was marked seen unshown
    // (v22.59). The ANNOUNCEMENT half is archived once, on the first close, and listed in App Notices for 180 days
    // (since v26.46). Its own key since v19.51; the old beta key stays on devices, inert.
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
                // Archived once: a manual reopen would file it again under a date nobody read it on.
                if (lsGet(WELCOME_KEY)) return;
                lsSet(WELCOME_KEY, '1');
                archiveNotice({
                    id:      'links-workspace-2026',
                    title:   'Links workspace',
                    section: 'Links',
                    date:    NOTICE_DATE,
                    body:    'Changes in the Links workspace only affect the link-design document, never the live roster. The Design checks report which ORR fatigue factors a pattern features — they do not pass or fail a design. Designs are shared, and a deleted one stays in Recently deleted until someone removes it for good.',
                });
            },
        });

        // Never gated on the seen flag. About closes FIRST: two overlays open together share one Escape, and the buried
        // one was archived unseen. 500ms is `dismissOverlay`'s fallback, as about-lightbox.js's print button waits.
        document.getElementById('linksHowBtn')?.addEventListener('click', () => {
            closeAboutLightbox?.();
            setTimeout(() => welcome.open(), 500);
        });

        if (lsGet(WELCOME_KEY)) return;
        // Never stacked on another overlay: deferred, it is unopened AND unflagged, and gets its turn on the next load.
        openNoticeIfClear(welcome);
    })();

    sessionReady.then(() => { initErrorReporter(); recordUsage('links', currentUser); recordPageLatency('links', currentUser); });
    // The forced set-password overlay, called NOW with the session as its barrier, so the sign-in's one-shot marker is
    // spent as the page opens: behind `sessionReady.then` a designer who left first met it on a later load.
    initPasswordForce(currentUser, { ready: sessionReady }).catch(() => {});   // it fails open itself

    // ── BOOT ──
    // A kept draft is offered once the list is in, never over a FAILED load: its design is not there to restore onto.
    const openDesigns = () => loadDesigns().then(() => { if (!loadFailed) return draftSlot.offer({ ask: confirmDialog, apply: restoreDraft, unsaved: _draftStillUnsaved }); })
        .catch((err) => console.error('[Links] The unsaved-changes offer failed:', err));
    // A failed load's "Try again" (links-app-5): back to loading, then the same read. A failed load opened nothing.
    document.getElementById('linksEmptyRetry')?.addEventListener('click', () => {
        listLoading = true;
        renderDesignPicker();
        renderGrid();
        openDesigns();
    });
    openDesigns();

}
