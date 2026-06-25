// @ts-check
// MYB Roster — Weekly Roster Upload Pipeline
// Handles: file selection, Cloud Function call, AI-parsed shift review,
// conflict detection, and Firestore batch write.
// Called by operations-app.js via initRosterUpload().

import { teamMembers, MONTH_ABB, getShiftBadge, getBaseShift, escapeHtml, formatISO, isSunday } from './roster-data.js';
import { db, collection, query, where, getDocs, doc, writeBatch, serverTimestamp, COLLECTIONS } from './firebase-client.js';
import { shouldReplaceOverride } from './app-override-utils.js';

const RDW_PREFIX   = 'RDW|';
const isRdwEncoded = v => typeof v === 'string' && v.startsWith(RDW_PREFIX);
const stripRdw     = v => v.slice(RDW_PREFIX.length);

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Badge HTML (+ raw time for worked shifts) for one shift value in the review table.
 * Pure and stateless, so it lives at module scope and is reused across renders
 * rather than being re-created inside renderReviewTable on every parse.
 * A worked shift on a Sunday renders as RDW — Sundays are uncontracted, so any
 * Sunday shift is by definition overtime.
 *
 * @param {string} shiftStr
 * @param {string|null} _baseShift  reserved for call-site symmetry (unused)
 * @param {string|null} date       ISO date — detects a Sunday worked shift
 * @returns {string} HTML
 */
function shiftDisplay(shiftStr, _baseShift = null, date = null) {
    if (isRdwEncoded(shiftStr)) {
        const time = stripRdw(shiftStr);
        return `${getShiftBadge('RDW')}<span class="review-shift-time">${escapeHtml(time)}</span>`;
    }
    const isTime = /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(shiftStr);
    const sundayWorked = isTime && date !== null && isSunday(date);
    const badge = getShiftBadge(sundayWorked ? 'RDW' : shiftStr);
    return isTime
        ? `${badge}<span class="review-shift-time">${escapeHtml(shiftStr)}</span>`
        : badge;
}

/**
 * Initialise the weekly roster upload pipeline.
 * Wires up all DOM event listeners for the Roster Upload card in admin.html.
 *
 * @param {object}   opts
 * @param {string}   opts.currentUser    - Logged-in member name (written to changedBy on saves)
 * @param {boolean}  opts.currentIsAdmin - Whether the user has admin rights
 * @param {string}   opts.parseUrl       - Cloud Function URL for parseRosterPDF
 * @param {Function} opts.getIdToken     - Async function returning the current user's Firebase ID token
 * @param {Function} opts.loadOverrides  - Refreshes the override cache and week grid after a save
 */
export function initRosterUpload({ currentUser, currentIsAdmin, parseUrl, getIdToken, loadOverrides }) {
    if (!currentIsAdmin) return;

    const esc = escapeHtml;  // local alias

    const card           = document.getElementById('rosterUploadCard');
    const rosterTypeEl   = /** @type {HTMLSelectElement|null} */ (document.getElementById('rosterType'));
    const weekEndingEl   = /** @type {HTMLInputElement|null} */ (document.getElementById('rosterWeekEnding'));
    const fileInput      = /** @type {HTMLInputElement|null} */ (document.getElementById('rosterFileInput'));
    const fileNameEl     = document.getElementById('rosterFileName');
    const parseBtn       = /** @type {HTMLButtonElement|null} */ (document.getElementById('rosterParseBtn'));
    const parseFeedback  = document.getElementById('rosterParseFeedback');
    const reviewSection  = document.getElementById('rosterReviewSection');
    const conflictBanner = document.getElementById('rosterConflictBanner');
    const conflictTitle  = document.getElementById('rosterConflictTitle');
    const conflictDetail = document.getElementById('rosterConflictDetail');
    const reviewLabel    = document.getElementById('rosterReviewLabel');
    let   changeList     = /** @type {HTMLElement} */ (document.getElementById('rosterChangeList'));
    const applyBtn       = /** @type {HTMLButtonElement|null} */ (document.getElementById('rosterApplyBtn'));
    const cancelBtn      = document.getElementById('rosterCancelBtn');
    const applyFeedback  = document.getElementById('rosterApplyFeedback');

    if (!card || !rosterTypeEl || !weekEndingEl || !fileInput || !parseBtn) return;

    // Reveal the card for admin users
    card.style.display = '';

    // In-memory store for the parsed result and computed cell states.
    // Cleared when "Start over" is clicked.
    let _parsedResult = null;      // response from parseRosterPDF Cloud Function
    let _cellStates   = null;      // computed Map: "memberName|date" → { state, parsedShift, manualValue, manualId, chosen }

    // Default week ending to the next Saturday (roster PDFs always end on a Saturday).
    // If today is already Saturday, jump to the one after so we default to the upcoming week.
    {
        const today = new Date();
        const day   = today.getDay(); // 0=Sun … 6=Sat
        const daysUntilNextSaturday = day === 6 ? 7 : 6 - day;
        const nextSaturday = new Date(today);
        nextSaturday.setDate(today.getDate() + daysUntilNextSaturday);
        weekEndingEl.value = formatISO(nextSaturday);
    }

    // ---- Snap any non-Saturday selection to the nearest Saturday ----
    // HTML date inputs have no built-in day-of-week restriction, so we enforce
    // it here: if the user picks a date that isn't a Saturday, we move it forward
    // to the next Saturday automatically.
    weekEndingEl.addEventListener('change', () => {
        if (!weekEndingEl.value) return;
        const picked = new Date(weekEndingEl.value + 'T12:00:00');
        const day    = picked.getDay(); // 0=Sun … 6=Sat
        if (day !== 6) {
            const daysToSaturday = day === 0 ? 6 : 6 - day;
            picked.setDate(picked.getDate() + daysToSaturday);
            weekEndingEl.value = formatISO(picked);
        }
    });

    // ---- Show chosen filename and enable parse button ----
    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        parseFeedback.textContent = '';
        parseFeedback.className   = 'huddle-feedback';
        if (!file) {
            fileNameEl.classList.remove('visible');
            parseBtn.disabled = true;
            return;
        }
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            fileNameEl.classList.remove('visible');
            parseBtn.disabled         = true;
            parseFeedback.textContent = 'Please choose a PDF file';
            parseFeedback.className   = 'huddle-feedback huddle-feedback--err';
            fileInput.value           = '';
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            fileNameEl.classList.remove('visible');
            parseBtn.disabled         = true;
            parseFeedback.textContent = 'File too large — maximum 10 MB';
            parseFeedback.className   = 'huddle-feedback huddle-feedback--err';
            fileInput.value           = '';
            return;
        }
        fileNameEl.textContent = file.name;
        fileNameEl.classList.add('visible');
        parseBtn.disabled      = false;
    });

    // ---- "Read Roster" button ----
    parseBtn.addEventListener('click', async () => {
        const file       = fileInput.files[0];
        const weekEnding = weekEndingEl.value;
        const rosterType = rosterTypeEl.value;

        if (!file || !weekEnding) return;

        // Reset UI + lock the form so a mid-parse change to the roster type, week,
        // or file can't silently mismatch the in-flight request (which captured the
        // originals above).
        parseFeedback.textContent = '';
        parseFeedback.className   = 'huddle-feedback';
        reviewSection.classList.remove('visible');
        parseBtn.disabled         = true;
        parseBtn.textContent        = 'Reading…';
        rosterTypeEl.disabled       = true;
        weekEndingEl.disabled       = true;
        fileInput.disabled          = true;

        try {
            // Convert file to base64 — same technique as ingestHuddle
            const base64 = await fileToBase64(file);

            // Call the Cloud Function
            parseFeedback.textContent = 'Reading the PDF — this takes about 15 seconds…';
            parseFeedback.className   = 'huddle-feedback';

            const idToken = await getIdToken();
            // iOS Safari aborts uncontrolled fetches at around 60s — explicit
            // AbortController gives us a known 90s window and a typed AbortError.
            const abortCtrl  = new AbortController();
            const abortTimer = setTimeout(() => abortCtrl.abort(), 90_000);
            let response;
            try {
                response = await fetch(parseUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization':  `Bearer ${idToken}`,
                        'Content-Type':   'text/plain',
                        'X-Week-Ending':  weekEnding,
                        'X-Roster-Type':  rosterType,
                    },
                    body: base64,
                    signal: abortCtrl.signal,
                });
            } finally {
                clearTimeout(abortTimer);
            }

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `Server error (${response.status})`);
            }

            _parsedResult = await response.json();
            parseFeedback.textContent = '';

            // Fetch existing overrides for this week from Firestore so we can detect conflicts
            parseFeedback.textContent = 'Checking for existing schedule changes…';
            const existingOverrides = await fetchOverridesForWeek(_parsedResult.dates);
            parseFeedback.textContent = '';

            // Compute cell states and render the review table
            _cellStates = computeCellStates(_parsedResult, existingOverrides);
            renderReviewTable(_parsedResult, _cellStates);

        } catch (err) {
            console.error('[RosterUpload] Parse failed:', err);
            let userMsg;
            if (err.name === 'AbortError' || (err.name === 'TypeError' && err.message.includes('Load failed'))) {
                userMsg = 'Parsing took longer than expected. The PDF may be large — please try again, or check your connection.';
            } else if (err instanceof TypeError && err.message === 'Failed to fetch') {
                userMsg = "Couldn't reach the server — check your internet connection or try again later.";
            } else {
                userMsg = 'Unexpected error — please try again or contact support.';
            }
            parseFeedback.textContent = `Couldn't read the roster: ${userMsg}`;
            parseFeedback.className   = 'huddle-feedback huddle-feedback--err';
        } finally {
            parseBtn.disabled     = false;
            parseBtn.textContent  = 'Read roster';
            rosterTypeEl.disabled = false;
            weekEndingEl.disabled = false;
            fileInput.disabled    = false;
        }
    });

    // ---- "Start over" button ----
    cancelBtn.addEventListener('click', () => {
        reviewSection.classList.remove('visible');
        _parsedResult = null;
        _cellStates   = null;
        fileInput.value           = '';
        fileNameEl.classList.remove('visible');
        parseBtn.disabled         = true;
        applyFeedback.textContent = '';
        applyFeedback.className   = 'huddle-feedback';
    });

    // ---- "Save changes" button ----
    applyBtn.addEventListener('click', async () => {
        if (!_parsedResult || !_cellStates) return;

        // Collect all DIFF cells that are ticked (approved) + any CONFLICT cells
        // where the admin chose "Use PDF"
        const toWrite = [];

        for (const [key, state] of _cellStates) {
            const [memberName, date] = key.split('|');

            if (state.state === 'DIFF' && state.chosen !== false) {
                // Use the edited value if the admin changed it, otherwise the parsed value.
                // manualId = any existing override doc for this date, to be replaced.
                toWrite.push({ memberName, date, value: state.editedValue ?? state.parsedShift, baseShift: state.baseShift, replaceId: state.manualId });
            }
            if (state.state === 'CONFLICT' && state.chosen === 'pdf') {
                // Admin chose PDF over the existing manual entry — replace it, don't
                // leave both docs for the same date.
                toWrite.push({ memberName, date, value: state.parsedShift, baseShift: state.baseShift, replaceId: state.manualId });
            }
        }

        if (toWrite.length === 0) {
            applyFeedback.textContent = 'Nothing to save — all changes are either skipped or already up to date.';
            applyFeedback.className   = 'huddle-feedback';
            return;
        }

        applyBtn.disabled    = true;
        applyBtn.textContent = `Saving ${toWrite.length} change${toWrite.length !== 1 ? 's' : ''}…`;
        applyFeedback.textContent = '';

        try {
            // Firestore batches are capped at 500 ops. Each item can be a delete +
            // a set (2 ops), so chunk at 200 to stay well under the limit.
            const CHUNK = 200;
            for (let i = 0; i < toWrite.length; i += CHUNK) {
                const chunk = toWrite.slice(i, i + CHUNK);
                const batch = writeBatch(db);
                for (const { memberName, date, value, baseShift, replaceId } of chunk) {
                    // Map shift value to override type — pass date so Sunday shifts are
                    // correctly saved as 'rdw' and explicit RDW| prefix is honoured
                    const type = shiftValueToOverrideType(value, baseShift, date);
                    // Strip the internal "RDW|" encoding before saving — Firestore stores
                    // the plain time as the value (e.g. "14:30-22:00"), type field carries 'rdw'
                    let savedValue = isRdwEncoded(value) ? stripRdw(value) : value;
                    // Backstop for the edited-cell path: a Sunday AL/SICK is reclassified to
                    // an RD correction (Sundays are non-contracted); keep value consistent.
                    if (type === 'correction' && (value === 'AL' || value === 'SICK')) savedValue = 'RD';
                    // Replace any existing override for this member/date in the same batch,
                    // so "Use PDF" / a re-import doesn't leave a stale doc beside the new one.
                    if (replaceId) batch.delete(doc(db, COLLECTIONS.overrides, replaceId));
                    const ref  = doc(collection(db, COLLECTIONS.overrides));
                    batch.set(ref, {
                        memberName,
                        date,
                        type,
                        value: savedValue,
                        note:       '',
                        source:     'roster_import',   // marks this as auto-applied, not hand-entered
                        createdAt:  serverTimestamp(),
                        changedBy:  currentUser,
                    });
                }
                await batch.commit();
            }

            // Update the in-memory override cache so the week grid and table refresh
            // without a round-trip to Firestore.  We don't know the new doc IDs but
            // loadOverrides() will re-fetch cleanly.
            await loadOverrides();

            applyFeedback.textContent = `Done — ${toWrite.length} shift${toWrite.length !== 1 ? 's' : ''} saved to the roster.`;
            applyFeedback.className   = 'huddle-feedback huddle-feedback--ok';

            // Clear the review table so it can't be applied twice
            reviewSection.classList.remove('visible');
            _parsedResult = null;
            _cellStates   = null;
            fileInput.value = '';
            fileNameEl.classList.remove('visible');
            parseBtn.disabled = true;

        } catch (err) {
            console.error('[RosterUpload] Apply failed:', err);
            const detail = err?.code === 'permission-denied'
                ? 'your session may have expired. Try signing out and back in.'
                : (err?.message || 'Unknown error — check the browser console.');
            applyFeedback.textContent = `Couldn't save — ${detail}`;
            applyFeedback.className   = 'huddle-feedback huddle-feedback--err';
            applyBtn.disabled    = false;
            applyBtn.textContent = 'Save changes';
        }
    });

    // ------------------------------------------------------------------
    // HELPERS
    // ------------------------------------------------------------------

    /**
     * Read a File object and return its contents as a base64 string.
     * @param {File} file
     * @returns {Promise<string>}
     */
    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = () => {
                // result is "data:application/pdf;base64,AAAA…" — strip the prefix
                const base64 = /** @type {string} */ (reader.result).split(',')[1];
                resolve(base64);
            };
            reader.onerror = () => reject(new Error('Could not read the file'));
            reader.readAsDataURL(file);
        });
    }

    /**
     * Fetch all override documents for a specific set of dates from Firestore.
     * We only fetch dates in the roster week — no need to load the full cache.
     *
     * @param {string[]} dates - Array of YYYY-MM-DD strings (the 7 days of the week)
     * @returns {Promise<Array>} Array of override objects { id, memberName, date, value, source, ... }
     */
    async function fetchOverridesForWeek(dates) {
        try {
            const q    = query(collection(db, COLLECTIONS.overrides), where('date', 'in', dates));
            const snap = await getDocs(q);
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (err) {
            console.error('[RosterUpload] Could not fetch existing overrides:', err);
            return [];   // Non-fatal — means we may miss conflicts, but won't crash
        }
    }

    /**
     * Compute the state of every (member, date) cell in the review table.
     *
     * Returns a Map keyed by "memberName|date" with values:
     *   { state: 'MATCH'|'DIFF'|'CONFLICT'|'COVERED', parsedShift, baseShift,
     *     manualValue?, manualId?, chosen }
     *
     * State meanings:
     *   MATCH    — PDF matches base roster, no override → nothing to do
     *   DIFF     — PDF differs from base roster, no manual override → propose change
     *   CONFLICT — A manually entered override exists that differs from the PDF → flag it
     *   COVERED  — A manual override exists and already matches the PDF → nothing to do
     *
     * @param {object} parsedResult  - Response from parseRosterPDF
     * @param {Array}  existingOverrides - Overrides already in Firestore for this week
     * @returns {Map}
     */
    function computeCellStates(parsedResult, existingOverrides) {
        const states = new Map();

        // Build a quick lookup: "memberName|date" → best override doc.
        // Use shouldReplaceOverride so manual entries always beat roster imports,
        // and newer docs beat older ones within the same source class.
        const overrideMap = new Map();
        for (const o of existingOverrides) {
            const key = `${o.memberName}|${o.date}`;
            if (shouldReplaceOverride(overrideMap.get(key), o)) {
                overrideMap.set(key, o);
            }
        }

        for (const entry of parsedResult.parsed) {
            // Only process names that exist in teamMembers (not hidden)
            const member = teamMembers.find(m => m.name === entry.memberName && !m.hidden);
            if (!member) continue;

            for (const date of parsedResult.dates) {
                const parsedShift  = entry.shifts?.[date] || 'RD';
                const baseShift    = getBaseShift(member, new Date(date + 'T12:00:00'));
                const key          = `${entry.memberName}|${date}`;
                const existing     = overrideMap.get(key);

                // Determine whether the existing override is manual or a previous import
                const isManual = existing
                    ? (existing.source !== 'roster_import')   // no source field → treat as manual
                    : false;

                // Normalise parsedShift for comparisons — strip the "RDW|" encoding so
                // "RDW|14:30-22:00" compares correctly against a stored value "14:30-22:00"
                const parsedValue = isRdwEncoded(parsedShift) ? stripRdw(parsedShift) : parsedShift;

                // Sundays are non-contracted for all grades — a PDF marking a Sunday as
                // AL or Absent (SICK) is invalid. Treat it as RD so it matches the rest-day
                // base, classifies as MATCH, and is never written as a Sunday AL/absence
                // override. (Worked Sunday times remain RDW — handled below.)
                const isSun      = isSunday(date);
                const sundaySafe = (isSun && (parsedValue === 'AL' || parsedValue === 'SICK'))
                    ? 'RD' : parsedValue;

                // Bilingual roster uses 'OFF' for rest days; AI always returns 'RD'.
                // Treat them as identical for all comparison purposes.
                const normRest = s => (s === 'OFF' ? 'RD' : s);
                const normParsed = normRest(sundaySafe);
                const normBase   = normRest(baseShift);

                let state;
                if (!existing || !isManual) {
                    // No override, or only a previous import — compare PDF vs base roster first
                    if (normParsed === normBase) {
                        state = 'MATCH';
                    } else if (existing && !isManual &&
                               (normRest(existing.value) === normParsed)) {
                        state = 'COVERED';  // matches the previous import — nothing to re-approve
                    } else {
                        state = 'DIFF';
                    }
                } else {
                    // A manual override exists — check if it already matches the PDF
                    if (normRest(existing.value) === normParsed) {
                        state = 'COVERED';   // manual is already correct — nothing to do
                    } else if (existing.value === 'SICK' && normBase === 'RD' && normParsed === 'RD') {
                        // Absence on a rest day AND the PDF also shows rest — not a real
                        // conflict (the calendar suppresses absence on base-RD days anyway).
                        // If the PDF instead shows a worked shift (an RDW on the rest day),
                        // fall through to CONFLICT so the genuine shift isn't dropped.
                        state = 'COVERED';
                    } else {
                        state = 'CONFLICT';  // manual differs from PDF — flag it
                    }
                }

                states.set(key, {
                    state,
                    parsedShift,
                    baseShift,
                    manualValue: existing?.value ?? null,
                    manualId:    existing?.id    ?? null,
                    editedValue: null,    // set if admin edits a DIFF cell
                    chosen:      state === 'DIFF' ? true : null,
                    // 'chosen' for DIFF = true (approved) or false (skipped)
                    // 'chosen' for CONFLICT = 'manual' (default) or 'pdf'
                });
            }
        }

        return states;
    }

    /**
     * Render the post-parse review UI as a list of per-person cards.
     * Only people with at least one DIFF or CONFLICT are shown.
     * Uses event delegation on changeList so no listener accumulation on re-render.
     *
     * @param {object} parsedResult
     * @param {Map}    cellStates
     */
    function renderReviewTable(parsedResult, cellStates) {
        const { dates, parsed, weekEnding } = parsedResult;

        // Enable/disable the Save button based on whether anything will actually be
        // written: a DIFF still approved, or a CONFLICT resolved to "PDF". If nothing
        // will be written, Save is disabled (rather than tapping it for a faint
        // "nothing to save" message).
        function updateApplyState() {
            let willWrite = 0;
            for (const st of cellStates.values()) {
                if (st.state === 'DIFF' && st.chosen !== false) willWrite++;
                else if (st.state === 'CONFLICT' && st.chosen === 'pdf') willWrite++;
            }
            applyBtn.disabled = willWrite === 0;
        }

        // ---- Count totals for banner + label ----
        let diffCount = 0, conflictCount = 0;
        const conflictLines = [];
        for (const [key, s] of cellStates) {
            if (s.state === 'DIFF') diffCount++;
            if (s.state === 'CONFLICT') {
                conflictCount++;
                const [memberName, date] = key.split('|');
                const dt = new Date(date + 'T12:00:00');
                const savedLabel = s.manualValue === 'SICK' ? 'Absent' : s.manualValue;
                conflictLines.push(
                    `${esc(memberName)} — ${DAY_NAMES[dt.getDay()]} ${dt.getDate()} ${MONTH_ABB[dt.getMonth()]}: ` +
                    `saved <strong>${esc(savedLabel)}</strong>, PDF says <strong>${esc(isRdwEncoded(s.parsedShift) ? 'RDW ' + stripRdw(s.parsedShift) : s.parsedShift)}</strong>`

                );
            }
        }

        // ---- Conflict banner ----
        if (conflictCount > 0) {
            conflictTitle.textContent = `${conflictCount} conflict${conflictCount !== 1 ? 's' : ''} — manually saved entries are protected`;
            conflictDetail.innerHTML  = conflictLines.join('<br>');
            conflictBanner.classList.add('visible');
        } else {
            conflictBanner.classList.remove('visible');
        }

        // ---- Build per-person sections ----
        changeList.innerHTML = '';
        let sectionsShown = 0;

        for (const entry of parsed) {
            const member = teamMembers.find(m => m.name === entry.memberName && !m.hidden);
            if (!member) continue;

            const changedDates = dates.filter(d => {
                const s = cellStates.get(`${entry.memberName}|${d}`);
                return s && (s.state === 'DIFF' || s.state === 'CONFLICT');
            });
            if (changedDates.length === 0) continue;

            const section = document.createElement('div');
            section.className = 'roster-person-section';
            section.dataset.member = entry.memberName;

            // Person header
            section.innerHTML = `
                <div class="roster-person-header">
                    <span class="roster-person-name">${esc(entry.memberName)}</span>
                    <span class="roster-change-badge">${changedDates.length}</span>
                    <button class="roster-skip-all-btn" data-member="${esc(entry.memberName)}" aria-pressed="false">Skip all</button>
                </div>`;

            // One row per changed day
            for (const date of changedDates) {
                const key = `${entry.memberName}|${date}`;
                const s   = cellStates.get(key);
                const dt  = new Date(date + 'T12:00:00');
                const dayName = DAY_NAMES[dt.getDay()];
                const dateStr = `${dt.getDate()} ${MONTH_ABB[dt.getMonth()]}`;

                const row = document.createElement('div');
                row.className  = `roster-change-row${s.state === 'CONFLICT' ? ' roster-change-conflict' : ''}`;
                row.dataset.key = key;

                if (s.state === 'DIFF') {
                    const approved = s.chosen !== false;
                    row.innerHTML = `
                        <div class="roster-chg-day">
                            <span class="roster-day-abbr">${dayName}</span>
                            <span class="roster-day-date">${dateStr}</span>
                        </div>
                        <div class="roster-chg-vals">
                            <span class="roster-from-val">${shiftDisplay(s.baseShift)}</span>
                            <span class="roster-arrow">→</span>
                            <span class="roster-to-val">${shiftDisplay(s.parsedShift, s.baseShift, date)}</span>
                        </div>
                        <button class="roster-approve-btn ${approved ? 'is-approved' : 'is-skipped'}" data-key="${esc(key)}" aria-pressed="${approved}">
                            ${approved ? 'Save' : 'Skip'}
                        </button>`;
                } else {
                    // CONFLICT — show Manual vs PDF toggle, defaulting to Manual
                    const usesPDF = s.chosen === 'pdf';
                    row.innerHTML = `
                        <div class="roster-chg-day">
                            <span class="roster-day-abbr">${dayName}</span>
                            <span class="roster-day-date">${dateStr}</span>
                        </div>
                        <div class="roster-chg-vals">
                            <span class="roster-conflict-icon-sm">⚠</span>
                            <span class="roster-manual-val roster-cv-manual ${usesPDF ? 'val-dim' : 'val-active'}">${shiftDisplay(s.manualValue)}</span>
                            <span class="roster-vs-sep">vs</span>
                            <span class="roster-manual-val roster-cv-pdf ${usesPDF ? 'val-active' : 'val-dim'}">${shiftDisplay(s.parsedShift, s.baseShift, date)}</span>
                        </div>
                        <div class="roster-conflict-choice" role="group" aria-label="Resolve conflict">
                            <button class="roster-choice-btn ${!usesPDF ? 'is-chosen' : ''}" data-key="${esc(key)}" data-pick="manual" aria-pressed="${!usesPDF}">Manual</button>
                            <button class="roster-choice-btn ${usesPDF ? 'is-chosen' : ''}" data-key="${esc(key)}" data-pick="pdf" aria-pressed="${usesPDF}">PDF</button>
                        </div>`;
                }
                section.appendChild(row);
            }

            changeList.appendChild(section);
            sectionsShown++;
        }

        // ---- Event delegation (replace old listener to avoid accumulation) ----
        const newList = /** @type {HTMLElement} */ (changeList.cloneNode(true));
        changeList.parentNode.replaceChild(newList, changeList);
        changeList = newList;

        changeList.addEventListener('click', e => {
            const target = /** @type {Element} */ (e.target);
            // Save / Skip toggle on DIFF rows
            const approveBtn = /** @type {HTMLElement|null} */ (target.closest('.roster-approve-btn'));
            if (approveBtn) {
                const s = cellStates.get(approveBtn.dataset.key);
                if (!s) return;
                s.chosen = !s.chosen;
                const approved = s.chosen !== false;
                approveBtn.classList.toggle('is-approved', approved);
                approveBtn.classList.toggle('is-skipped',  !approved);
                approveBtn.setAttribute('aria-pressed', String(approved));
                approveBtn.textContent = approved ? 'Save' : 'Skip';
                approveBtn.closest('.roster-change-row').classList.toggle('is-skipped', !approved);
                updateApplyState();
                return;
            }

            // Skip all / Restore for a person — applies to DIFF and CONFLICT rows alike
            const skipAllBtn = /** @type {HTMLElement|null} */ (target.closest('.roster-skip-all-btn'));
            if (skipAllBtn) {
                const memberName = skipAllBtn.dataset.member;
                const sec = changeList.querySelector(`.roster-person-section[data-member="${CSS.escape(memberName)}"]`);
                if (!sec) return;
                const nowSkipped = !sec.classList.contains('section-skipped');
                sec.classList.toggle('section-skipped', nowSkipped);
                skipAllBtn.textContent = nowSkipped ? 'Restore' : 'Skip all';
                skipAllBtn.setAttribute('aria-pressed', String(nowSkipped));
                sec.querySelectorAll('.roster-change-row').forEach(rowEl => {
                    const rowHtml = /** @type {HTMLElement} */ (rowEl);
                    const s = cellStates.get(rowHtml.dataset.key);
                    if (!s) return;
                    // inert removes the row's controls from the tab order while skipped,
                    // so they aren't keyboard-focusable behind the dimmed overlay.
                    rowHtml.inert = nowSkipped;
                    if (s.state === 'DIFF') {
                        s.chosen = !nowSkipped;
                        const btn = rowEl.querySelector('.roster-approve-btn');
                        if (btn) {
                            btn.classList.toggle('is-approved', !nowSkipped);
                            btn.classList.toggle('is-skipped',  nowSkipped);
                            btn.setAttribute('aria-pressed', String(!nowSkipped));
                            btn.textContent = nowSkipped ? 'Skip' : 'Save';
                        }
                        rowEl.classList.toggle('is-skipped', nowSkipped);
                    } else if (s.state === 'CONFLICT') {
                        // Skipping cancels any "use PDF" choice (keep manual = nothing written).
                        s.chosen = 'manual';
                        rowEl.querySelectorAll('.roster-choice-btn').forEach(b => {
                            const bHtml = /** @type {HTMLElement} */ (b);
                            const on = bHtml.dataset.pick === 'manual';
                            b.classList.toggle('is-chosen', on);
                            b.setAttribute('aria-pressed', String(on));
                        });
                        const mPill = rowEl.querySelector('.roster-cv-manual');
                        const pPill = rowEl.querySelector('.roster-cv-pdf');
                        if (mPill) { mPill.classList.add('val-active'); mPill.classList.remove('val-dim'); }
                        if (pPill) { pPill.classList.add('val-dim'); pPill.classList.remove('val-active'); }
                    }
                });
                updateApplyState();
                return;
            }

            // Manual / PDF choice on CONFLICT rows
            const choiceBtn = /** @type {HTMLElement|null} */ (target.closest('.roster-choice-btn'));
            if (choiceBtn) {
                const s = cellStates.get(choiceBtn.dataset.key);
                if (!s) return;
                s.chosen = choiceBtn.dataset.pick;
                const usesPDF = s.chosen === 'pdf';
                choiceBtn.closest('.roster-conflict-choice').querySelectorAll('.roster-choice-btn').forEach(b => {
                    const bHtml = /** @type {HTMLElement} */ (b);
                    const on = bHtml.dataset.pick === s.chosen;
                    b.classList.toggle('is-chosen', on);
                    b.setAttribute('aria-pressed', String(on));
                });
                // Update the value pills to show which is active
                const row    = choiceBtn.closest('.roster-change-row');
                const mPill  = row.querySelector('.roster-cv-manual');
                const pPill  = row.querySelector('.roster-cv-pdf');
                if (mPill) { mPill.classList.toggle('val-active', !usesPDF); mPill.classList.toggle('val-dim', usesPDF); }
                if (pPill) { pPill.classList.toggle('val-active', usesPDF);  pPill.classList.toggle('val-dim', !usesPDF); }
                updateApplyState();
            }
        });

        // ---- Empty state ----
        if (sectionsShown === 0) {
            changeList.innerHTML = `<div class="roster-no-changes">✓ The roster matches what's already saved — no changes needed.</div>`;
        }
        applyBtn.textContent = 'Save changes';
        updateApplyState();   // enables Save only if something will actually be written

        // ---- Summary label ----
        // "to review" = DIFFs (default-approved); "to resolve" = conflicts that
        // need an explicit Manual/PDF choice. Kept distinct so the count doesn't
        // imply conflicts are auto-applied.
        const weekEndDate = new Date(weekEnding + 'T12:00:00');
        const formatted   = weekEndDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        const changeStr   = `${diffCount} change${diffCount !== 1 ? 's' : ''} to review`;
        const conflictStr = conflictCount > 0 ? ` · ${conflictCount} conflict${conflictCount !== 1 ? 's' : ''} to resolve` : '';
        reviewLabel.textContent = `Week ending ${formatted} — ${changeStr}${conflictStr}`;

        reviewSection.classList.add('visible');
        applyFeedback.textContent = '';
        applyFeedback.className   = 'huddle-feedback';

        // Move focus to the summary so screen-reader users are told the review is
        // ready after the ~15s parse, and the section scrolls into view.
        reviewLabel.tabIndex = -1;
        reviewLabel.focus();
    }

    /**
     * Map a shift value to the Firestore override `type` field.
     * This mirrors the existing override type vocabulary.
     *
     * @param {string} value     - e.g. "05:30-11:30", "SPARE", "AL", "SICK", "RD"
     * @param {string} baseShift - the base roster shift for that day (e.g. "RD", "06:00-12:00")
     * @param {string|null} date - ISO date string "YYYY-MM-DD" — used to detect Sunday
     * @returns {string}  override type
     */
    function shiftValueToOverrideType(value, baseShift, date = null) {
        // Sundays are non-contracted — AL and Absent cannot apply; treat as RD correction
        const isSun = date !== null && isSunday(date);
        if (isSun && (value === 'AL' || value === 'SICK')) return 'correction';
        if (value === 'AL')    return 'annual_leave';
        if (value === 'SICK')  return 'sick';
        if (value === 'SPARE') return 'spare_shift';
        if (value === 'RD' || value === 'OFF') return 'correction';
        // Pipe-encoded RDW from AI: "RDW|14:30-22:00" — explicit flag regardless of base shift
        if (isRdwEncoded(value) || value === 'RDW') return 'rdw';
        // Sunday is always uncontracted — any shift worked on a Sunday is an RDW.
        // For all other days, only classify as RDW when the AI explicitly flagged it above.
        // Staff may swap rest/working days with permission without it being an RDW.
        const isTime = /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(value);
        if (isTime && isSun) return 'rdw';
        // Spare week receiving its actual allocation — semantically distinct from overtime
        return 'shift';
    }

    // Card collapse is wired centrally in operations-app.js via initCardCollapse.
}
