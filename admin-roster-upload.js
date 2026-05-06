// MYB Roster — Weekly Roster Upload Pipeline
// Handles: file selection, Cloud Function call, AI-parsed shift review,
// conflict detection, and Firestore batch write.
// Extracted from admin-app.js at v8.55 to keep admin-app.js manageable.
// Called by admin-app.js via initRosterUpload().

import { teamMembers, MONTH_ABB, getShiftBadge, getBaseShift, escapeHtml, formatISO } from './roster-data.js?v=8.76';
import { db, collection, query, where, getDocs, doc, writeBatch, serverTimestamp } from './firebase-client.js?v=8.76';

/**
 * Initialise the weekly roster upload pipeline.
 * Wires up all DOM event listeners for the Roster Upload card in admin.html.
 *
 * @param {object}   opts
 * @param {string}   opts.currentUser    - Logged-in member name (written to changedBy on saves)
 * @param {boolean}  opts.currentIsAdmin - Whether the user has admin rights
 * @param {string}   opts.parseUrl       - Cloud Function URL for parseRosterPDF
 * @param {string}   opts.rosterSecret   - Bearer token for parseRosterPDF
 * @param {Function} opts.loadOverrides  - Refreshes the override cache and week grid after a save
 */
export function initRosterUpload({ currentUser, currentIsAdmin, parseUrl, rosterSecret, loadOverrides }) {
    if (!currentIsAdmin) return;

    const esc = escapeHtml;  // local alias

    const card           = document.getElementById('rosterUploadCard');
    const rosterTypeEl   = document.getElementById('rosterType');
    const weekEndingEl   = document.getElementById('rosterWeekEnding');
    const fileInput      = document.getElementById('rosterFileInput');
    const fileNameEl     = document.getElementById('rosterFileName');
    const parseBtn       = document.getElementById('rosterParseBtn');
    const parseFeedback  = document.getElementById('rosterParseFeedback');
    const reviewSection  = document.getElementById('rosterReviewSection');
    const conflictBanner = document.getElementById('rosterConflictBanner');
    const conflictTitle  = document.getElementById('rosterConflictTitle');
    const conflictDetail = document.getElementById('rosterConflictDetail');
    const reviewLabel    = document.getElementById('rosterReviewLabel');
    let   changeList     = document.getElementById('rosterChangeList');
    const applyBtn       = document.getElementById('rosterApplyBtn');
    const cancelBtn      = document.getElementById('rosterCancelBtn');
    const applyFeedback  = document.getElementById('rosterApplyFeedback');

    if (!card || !rosterTypeEl || !weekEndingEl || !fileInput || !parseBtn) return;

    // Reveal the card for admin users
    card.style.display = '';

    // In-memory store for the parsed result and computed cell states.
    // Cleared when "Start over" is clicked.
    let _parsedResult = null;      // response from parseRosterPDF Cloud Function
    let _cellStates   = null;      // computed Map: "memberName|date" → { state, parsedShift, manualValue, manualId, chosen }

    // ---- Week ending defaults to next Saturday ----
    // All roster PDFs end on a Saturday. If today is already Saturday, default
    // to next Saturday (the upcoming week, not today).
    (function setDefaultWeekEnding() {
        const today = new Date();
        const day   = today.getDay(); // 0=Sun … 6=Sat
        const daysUntilNextSaturday = day === 6 ? 7 : 6 - day;
        const nextSaturday = new Date(today);
        nextSaturday.setDate(today.getDate() + daysUntilNextSaturday);
        weekEndingEl.value = formatISO(nextSaturday);
    })();

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
            fileNameEl.style.display = 'none';
            parseBtn.disabled        = true;
            return;
        }
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            fileNameEl.style.display = 'none';
            parseBtn.disabled        = true;
            parseFeedback.textContent = 'Please choose a PDF file';
            parseFeedback.className   = 'huddle-feedback huddle-feedback--err';
            fileInput.value           = '';
            return;
        }
        if (file.size > 20 * 1024 * 1024) {
            fileNameEl.style.display = 'none';
            parseBtn.disabled        = true;
            parseFeedback.textContent = 'File too large — maximum 20 MB';
            parseFeedback.className   = 'huddle-feedback huddle-feedback--err';
            fileInput.value           = '';
            return;
        }
        fileNameEl.textContent   = file.name;
        fileNameEl.style.display = '';
        parseBtn.disabled        = false;
    });

    // ---- "Read Roster" button ----
    parseBtn.addEventListener('click', async () => {
        const file       = fileInput.files[0];
        const weekEnding = weekEndingEl.value;
        const rosterType = rosterTypeEl.value;

        if (!file || !weekEnding) return;

        // Reset UI
        parseFeedback.textContent = '';
        parseFeedback.className   = 'huddle-feedback';
        reviewSection.style.display = 'none';
        parseBtn.disabled           = true;
        parseBtn.textContent        = 'Reading…';

        try {
            // Convert file to base64 — same technique as ingestHuddle
            const base64 = await fileToBase64(file);

            // Call the Cloud Function
            parseFeedback.textContent = 'Reading the PDF — this takes about 15 seconds…';
            parseFeedback.className   = 'huddle-feedback';

            const response = await fetch(parseUrl, {
                method: 'POST',
                headers: {
                    'Authorization':  `Bearer ${rosterSecret}`,
                    'Content-Type':   'text/plain',
                    'X-Week-Ending':  weekEnding,
                    'X-Roster-Type':  rosterType,
                },
                body: base64,
            });

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
            const userMsg = (err instanceof TypeError && err.message === 'Failed to fetch')
                ? 'Could not reach the server — check your internet connection or try again later.'
                : 'Unexpected error — please try again or contact support.';
            parseFeedback.textContent = `Could not read the roster: ${userMsg}`;
            parseFeedback.className   = 'huddle-feedback huddle-feedback--err';
        } finally {
            parseBtn.disabled    = false;
            parseBtn.textContent = 'Read Roster';
        }
    });

    // ---- "Start over" button ----
    cancelBtn.addEventListener('click', () => {
        reviewSection.style.display = 'none';
        _parsedResult = null;
        _cellStates   = null;
        fileInput.value           = '';
        fileNameEl.style.display  = 'none';
        parseBtn.disabled         = true;
        applyFeedback.textContent = '';
        applyFeedback.className   = 'huddle-feedback';
    });

    // ---- "Apply approved changes" button ----
    applyBtn.addEventListener('click', async () => {
        if (!_parsedResult || !_cellStates) return;

        // Collect all DIFF cells that are ticked (approved) + any CONFLICT cells
        // where the admin chose "Use PDF"
        const toWrite = [];

        for (const [key, state] of _cellStates) {
            const [memberName, date] = key.split('|');

            if (state.state === 'DIFF' && state.chosen !== false) {
                // Use the edited value if the admin changed it, otherwise the parsed value
                toWrite.push({ memberName, date, value: state.editedValue ?? state.parsedShift, baseShift: state.baseShift });
            }
            if (state.state === 'CONFLICT' && state.chosen === 'pdf') {
                toWrite.push({ memberName, date, value: state.parsedShift, baseShift: state.baseShift });
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
            const batch = writeBatch(db);

            for (const { memberName, date, value, baseShift } of toWrite) {
                // Map shift value to override type — pass date so Sunday shifts are
                // correctly saved as 'rdw' and explicit RDW| prefix is honoured
                const type = shiftValueToOverrideType(value, baseShift, date);
                // Strip the internal "RDW|" encoding before saving — Firestore stores
                // the plain time as the value (e.g. "14:30-22:00"), type field carries 'rdw'
                const savedValue = value.startsWith('RDW|') ? value.slice(4) : value;
                const ref  = doc(collection(db, 'overrides'));
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

            // Update the in-memory override cache so the week grid and table refresh
            // without a round-trip to Firestore.  We don't know the new doc IDs but
            // loadOverrides() will re-fetch cleanly.
            await loadOverrides();

            applyFeedback.textContent = `Done — ${toWrite.length} shift${toWrite.length !== 1 ? 's' : ''} saved to the roster.`;
            applyFeedback.className   = 'huddle-feedback huddle-feedback--ok';

            // Clear the review table so it can't be applied twice
            reviewSection.style.display = 'none';
            _parsedResult = null;
            _cellStates   = null;
            fileInput.value          = '';
            fileNameEl.style.display = 'none';
            parseBtn.disabled        = true;

        } catch (err) {
            console.error('[RosterUpload] Apply failed:', err);
            const detail = err?.code === 'permission-denied'
                ? 'Permission denied — the Firestore security rules may need updating. Check the browser console for details.'
                : (err?.message || 'Unknown error — check the browser console.');
            applyFeedback.textContent = `Could not save: ${detail}`;
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
                const base64 = reader.result.split(',')[1];
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
            const q    = query(collection(db, 'overrides'), where('date', 'in', dates));
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

        // Build a quick lookup: "memberName|date" → override doc
        const overrideMap = new Map();
        for (const o of existingOverrides) {
            overrideMap.set(`${o.memberName}|${o.date}`, o);
        }

        for (const entry of parsedResult.parsed) {
            // Only process names that exist in teamMembers (not hidden)
            const member = teamMembers.find(m => m.name === entry.memberName && !m.hidden);
            if (!member) continue;

            for (const date of parsedResult.dates) {
                const parsedShift  = entry.shifts[date] || 'RD';
                const baseShift    = getBaseShift(member, new Date(date + 'T12:00:00'));
                const key          = `${entry.memberName}|${date}`;
                const existing     = overrideMap.get(key);

                // Determine whether the existing override is manual or a previous import
                const isManual = existing
                    ? (existing.source !== 'roster_import')   // no source field → treat as manual
                    : false;

                // Normalise parsedShift for comparisons — strip the "RDW|" encoding so
                // "RDW|14:30-22:00" compares correctly against a stored value "14:30-22:00"
                const parsedValue = parsedShift.startsWith('RDW|') ? parsedShift.slice(4) : parsedShift;

                let state;
                if (!existing || !isManual) {
                    // No override, or only a previous import — compare PDF vs base roster first
                    if (parsedShift === baseShift || parsedValue === baseShift) {
                        state = 'MATCH';
                    } else if (existing && !isManual &&
                               (existing.value === parsedValue || existing.value === parsedShift)) {
                        state = 'COVERED';  // matches the previous import — nothing to re-approve
                    } else {
                        state = 'DIFF';
                    }
                } else {
                    // A manual override exists — check if it already matches the PDF
                    if (existing.value === parsedShift || existing.value === parsedValue) {
                        state = 'COVERED';   // manual is already correct — nothing to do
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
        const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

        // Returns badge HTML + the raw time for worked shifts so the user sees
        // both the shift type (Early/Late/Night/RDW etc.) and the actual times.
        //
        // The AI now returns "RDW|HH:MM-HH:MM" (pipe-encoded) for cells explicitly
        // marked RDW in the PDF — this works on any base shift including SPARE weeks.
        // RDW is only inferred (without the prefix) for Sunday shifts, which are always
        // uncontracted — any Sunday shift is by definition an RDW.
        function shiftDisplay(shiftStr, baseShift = null, date = null) {
            // Pipe-encoded RDW: "RDW|14:30-22:00" — explicit flag from AI
            if (typeof shiftStr === 'string' && shiftStr.startsWith('RDW|')) {
                const time  = shiftStr.slice(4);
                const badge = getShiftBadge('RDW');
                return `${badge}<span class="review-shift-time">${esc(time)}</span>`;
            }
            const isTime = /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(shiftStr);
            // Sunday is always uncontracted — any shift worked on a Sunday is an RDW
            const isSunday = isTime && date !== null && new Date(date + 'T12:00:00Z').getUTCDay() === 0;
            const badge  = getShiftBadge(isSunday ? 'RDW' : shiftStr);
            return isTime
                ? `${badge}<span class="review-shift-time">${esc(shiftStr)}</span>`
                : badge;
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
                conflictLines.push(
                    `${esc(memberName)} — ${DAY_NAMES[dt.getDay()]} ${dt.getDate()} ${MONTH_ABB[dt.getMonth()]}: ` +
                    `saved <strong>${esc(s.manualValue)}</strong>, PDF says <strong>${esc(s.parsedShift.startsWith('RDW|') ? 'RDW ' + s.parsedShift.slice(4) : s.parsedShift)}</strong>`
                );
            }
        }

        // ---- Conflict banner ----
        if (conflictCount > 0) {
            conflictTitle.textContent    = `${conflictCount} conflict${conflictCount !== 1 ? 's' : ''} — manually saved entries are protected`;
            conflictDetail.innerHTML     = conflictLines.join('<br>');
            conflictBanner.style.display = '';
        } else {
            conflictBanner.style.display = 'none';
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
                    <button class="roster-skip-all-btn" data-member="${esc(entry.memberName)}">Skip all</button>
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
                        <button class="roster-approve-btn ${approved ? 'is-approved' : 'is-skipped'}" data-key="${esc(key)}">
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
                            <span class="roster-manual-val ${usesPDF ? 'val-dim' : 'val-active'}">${shiftDisplay(s.manualValue)}</span>
                            <span class="roster-vs-sep">vs</span>
                            <span class="roster-manual-val ${usesPDF ? 'val-active' : 'val-dim'}">${shiftDisplay(s.parsedShift, s.baseShift, date)}</span>
                        </div>
                        <div class="roster-conflict-choice">
                            <button class="roster-choice-btn ${!usesPDF ? 'is-chosen' : ''}" data-key="${esc(key)}" data-pick="manual">Manual</button>
                            <button class="roster-choice-btn ${usesPDF ? 'is-chosen' : ''}" data-key="${esc(key)}" data-pick="pdf">PDF</button>
                        </div>`;
                }
                section.appendChild(row);
            }

            changeList.appendChild(section);
            sectionsShown++;
        }

        // ---- Event delegation (replace old listener to avoid accumulation) ----
        const newList = changeList.cloneNode(true);
        changeList.parentNode.replaceChild(newList, changeList);
        changeList = newList;

        changeList.addEventListener('click', e => {
            // Save / Skip toggle on DIFF rows
            const approveBtn = e.target.closest('.roster-approve-btn');
            if (approveBtn) {
                const s = cellStates.get(approveBtn.dataset.key);
                if (!s) return;
                s.chosen = !s.chosen;
                approveBtn.classList.toggle('is-approved', s.chosen !== false);
                approveBtn.classList.toggle('is-skipped',  s.chosen === false);
                approveBtn.textContent = (s.chosen !== false) ? 'Save' : 'Skip';
                approveBtn.closest('.roster-change-row').classList.toggle('is-skipped', s.chosen === false);
                return;
            }

            // Skip all / Restore for a person
            const skipAllBtn = e.target.closest('.roster-skip-all-btn');
            if (skipAllBtn) {
                const memberName = skipAllBtn.dataset.member;
                const sec = changeList.querySelector(`.roster-person-section[data-member="${CSS.escape(memberName)}"]`);
                if (!sec) return;
                const nowSkipped = !sec.classList.contains('section-skipped');
                sec.classList.toggle('section-skipped', nowSkipped);
                skipAllBtn.textContent = nowSkipped ? 'Restore' : 'Skip all';
                sec.querySelectorAll('.roster-approve-btn').forEach(btn => {
                    const s = cellStates.get(btn.dataset.key);
                    if (!s) return;
                    s.chosen = !nowSkipped;
                    btn.classList.toggle('is-approved', !nowSkipped);
                    btn.classList.toggle('is-skipped',  nowSkipped);
                    btn.textContent = nowSkipped ? 'Skip' : 'Save';
                });
                return;
            }

            // Manual / PDF choice on CONFLICT rows
            const choiceBtn = e.target.closest('.roster-choice-btn');
            if (choiceBtn) {
                const s = cellStates.get(choiceBtn.dataset.key);
                if (!s) return;
                s.chosen = choiceBtn.dataset.pick;
                choiceBtn.closest('.roster-conflict-choice').querySelectorAll('.roster-choice-btn').forEach(b => {
                    b.classList.toggle('is-chosen', b.dataset.pick === s.chosen);
                });
                // Update the value pills to show which is active
                const row = choiceBtn.closest('.roster-change-row');
                const manualPill = row.querySelector('.roster-manual-val');
                const pdfVal     = row.querySelector('.roster-to-val');
                if (manualPill) manualPill.classList.toggle('val-active', s.chosen === 'manual');
                if (manualPill) manualPill.classList.toggle('val-dim',    s.chosen === 'pdf');
                if (pdfVal)     pdfVal.classList.toggle('val-active', s.chosen === 'pdf');
                if (pdfVal)     pdfVal.classList.toggle('val-dim',    s.chosen === 'manual');
            }
        });

        // ---- Empty state ----
        if (sectionsShown === 0) {
            changeList.innerHTML = `<div class="roster-no-changes">✓ The roster matches what's already saved — no changes needed.</div>`;
            applyBtn.disabled = true;
        } else {
            applyBtn.disabled    = false;
            applyBtn.textContent = 'Save changes';
        }

        // ---- Summary label ----
        const weekEndDate = new Date(weekEnding + 'T12:00:00');
        const formatted   = weekEndDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        reviewLabel.textContent = `Week ending ${formatted} — ${diffCount} change${diffCount !== 1 ? 's' : ''}, ${conflictCount} conflict${conflictCount !== 1 ? 's' : ''}`;

        reviewSection.style.display = '';
        applyFeedback.textContent   = '';
        applyFeedback.className     = 'huddle-feedback';
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
        if (value === 'AL')    return 'annual_leave';
        if (value === 'SICK')  return 'sick';
        if (value === 'SPARE') return 'spare_shift';
        if (value === 'RD' || value === 'OFF') return 'correction';
        // Pipe-encoded RDW from AI: "RDW|14:30-22:00" — explicit flag regardless of base shift
        if (value.startsWith('RDW|') || value === 'RDW') return 'rdw';
        // Sunday is always uncontracted — any shift worked on a Sunday is an RDW.
        // For all other days, only classify as RDW when the AI explicitly flagged it above.
        // Staff may swap rest/working days with permission without it being an RDW.
        const isTime = /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(value);
        if (isTime && date !== null && new Date(date + 'T12:00:00Z').getUTCDay() === 0) return 'rdw';
        // Spare week receiving its actual allocation — semantically distinct from overtime
        return 'shift';
    }

    // ---- Collapse / expand ----
    (function initCollapse() {
        const header  = document.getElementById('rosterUploadToggleHeader');
        const body    = document.getElementById('rosterUploadBody');
        const chevron = document.getElementById('rosterUploadChevron');
        if (!header || !body || !chevron) return;
        header.addEventListener('click', () => {
            const isOpen = body.classList.toggle('open');
            chevron.classList.toggle('open', isOpen);
        });
    })();
}
