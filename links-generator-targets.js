// @ts-check
/**
 * links-generator-targets.js — the NUMBERS the generator will run against, where they came from,
 * and what is allowed to replace them.
 *
 * Extracted from `links-app.js` at v22.76. Not a size split: `genSlots`/`genSpareLines` and the four
 * provenance fields beside them were the only coordinator state nothing outside the generator card
 * touched, and they exist to answer ONE question the card has to keep answering — *are these numbers
 * the default, today's roster, this design's own memory, or a colleague's saved setup, and have they
 * been changed since?* Four states with no dirty flag between them, because the table is written to
 * localStorage on every keystroke and so is always "saved".
 *
 * THE FOUR RULES THAT ARE EASY TO UNDO, each the fix to a reported defect:
 *
 * 1. **`genOriginTable` is a DEEP copy, taken on every load.** The table is edited in place, so an
 *    aliased snapshot compares equal to itself for ever and every destructive button goes back to
 *    being silent. It is what tells "this IS Set A" from "this started as Set A and is now mine".
 *
 * 2. **An ordinary edit drops the set attribution.** `saveGenTargets`'s `setName` defaults to `''`
 *    precisely because every keystroke reaches it without one — otherwise the note goes on claiming
 *    the numbers on screen are still that designer's saved set.
 *
 * 3. **`loadGenTargets` accepts TWO stored shapes and stamps its own.** A validator that demanded
 *    only the post-v19.58 `spareLines` would discard every table written before it, silently, in
 *    favour of a perfectly plausible roster seed. The version stamp is what retires an old default
 *    without touching anything a designer edited.
 *
 * 4. **`activeDesignId` arrives as a GETTER; the identity does not, and the difference is real.**
 *    The design id is reassigned three times after this panel is built — a new design, a load, a
 *    delete — so a captured copy keys every design's remembered targets to `'unsaved'` and all of
 *    them silently share one table. `currentUser`/`isAdmin` are `const` in the coordinator, fixed
 *    before the access gate lets `init()` reach this line, so they are passed as VALUES. The
 *    signature is the documentation: one of the three moves.
 *
 *    That distinction was drawn the wrong way round in this header's first draft, and a mutation
 *    found it — capturing the user survived every suite, correctly, because there is nothing to
 *    catch. Capturing the design id does not survive.
 *
 * The RULES it renders come from elsewhere and are not restated here: `links-target-sets.js` owns
 * what a set is and who may overwrite one, `links-target-sets-store.js` the Firestore half and its
 * conflict window, `links-target-hours.js` the verdict, `links-default-targets.js` and
 * `links-seed.js` the two tables the reset buttons offer. This module owns only which of them is on
 * screen, and what happens when one replaces another.
 *
 * The GENERATE button stays in the coordinator: pressing it writes patterns, re-renders the grid and
 * marks the design dirty, which is coordination. It reads the table through `getTable()`.
 */

import { APP_VERSION, escapeHtml } from './roster-data.js';
import { db, doc, addDoc, collection, getDocs, serverTimestamp, runTransaction, COLLECTIONS, writeWithClaimRetry } from './firebase-client.js';
import { confirmDialog, promptDialog } from './overlay.js';
import { lsGet, lsSet } from './ls.js';
import { ROTATING_LINES, normaliseCustomShift } from './links-design.js';
import { buildRosterTargets } from './links-seed.js';
import { buildDefaultTargets, sameTargetTable, isSupersededMemory } from './links-default-targets.js';
import { assessTargetHours, targetHoursLines, targetProvenanceNote } from './links-target-hours.js';
import { targetSetPayload, describeSetState, describeSetList, MAX_SET_NAME } from './links-target-sets.js';
import { createTargetSetStore } from './links-target-sets-store.js';
import { checkName } from './links-design-naming.js';

/**
 * Build the generator's target-table panel and wire it to the card.
 *
 * `getActiveDesignId` is a function because the id MOVES (see rule 4); `currentUser` and `isAdmin`
 * are values because they do not.
 *
 * @param {{
 *   getActiveDesignId: () => string|null|undefined,
 *   currentUser: string|null,
 *   isAdmin: boolean,
 *   sessionReady: Promise<any>,
 *   buildShiftOptions: (currentVal: string, includeRdSpare?: boolean) => string,
 *   defaultSlotTime: string,
 * }} deps
 */
export function createTargetPanel(deps) {
    const { getActiveDesignId, currentUser, isAdmin, sessionReady,
            buildShiftOptions, defaultSlotTime } = deps;

    const TOTAL_POS = ROTATING_LINES;
    /** @type {Array<any>} */
    let genSlots = [];
    let genSpareLines = 0;      // whole LINES that are spare weeks (v19.58) — not a per-day count

    function renderGenTable() {
        const tbody = document.getElementById('genSlotRows');
        if (!tbody) return;
        // WHICH DAY'S BLOCK a row belongs to — the FIRST day class it staffs, not the whole set
        // (v21.10). The set was the wrong key the moment the default table began sharing rows
        // between the weekday and the Saturday: a row serving both reads as neither, so the runs
        // fragmented and the rules stopped being drawn where the reader needs them. A shared row
        // belongs to the first block it appears in, which is also where it is listed.
        const _primary = (/** @type {any} */ sl) =>
            ['weekday', 'sat', 'sun'].find(c => (sl[c] ?? 0) > 0) ?? '';
        // A rule is drawn where a real block BEGINS — a run of at least two rows. A table whose rows
        // each staff a different day would otherwise take a rule on every row, which is the same as
        // no rules but heavier; and the common designer's table, where every row staffs all three
        // days, has ONE run and takes none, which is right.
        //
        // The run ABOVE is deliberately not consulted (v21.12). It was, until the default table
        // compacted to two blocks — Mon–Sat, then Sunday — with Saturday's fourth closer sitting in
        // the Mon–Sat block as a run of one. Requiring both sides to be substantial then suppressed
        // the ONE rule the table needs, because the row above the Sunday block was that singleton.
        // Whether the row above was a stray is not the reader's question; where the next block
        // starts is.
        const _runs = genSlots.map(_primary);
        const _runLen = (/** @type {number} */ at) => {
            let a = at, b = at;
            while (a > 0 && _runs[a - 1] === _runs[at]) a--;
            while (b < _runs.length - 1 && _runs[b + 1] === _runs[at]) b++;
            return b - a + 1;
        };
        let prevSig = '';
        tbody.innerHTML = genSlots.map((slot, i) => {
            const sig = _primary(slot);
            const newBlock = i > 0 && sig !== prevSig && !!sig && !!prevSig && _runLen(i) >= 2;
            prevSig = sig;
            return `<tr data-slot="${i}"${newBlock ? ' class="gen-slot-newblock"' : ''}>` +
            `<td class="gen-td-time"><select class="gen-select gen-slot-time" data-slot="${i}" ` +
            `aria-label="Shift time for row ${i + 1}">${buildShiftOptions(slot.time)}</select></td>` +
            ['weekday', 'sat', 'sun'].map(cls =>
                `<td><input type="number" class="gen-input gen-slot-count${
                    (/** @type {Record<string, any>} */ (slot))[cls] > 0 ? '' : ' is-zero'}" min="0" max="${TOTAL_POS}" ` +
                `value="${(/** @type {Record<string, any>} */ (slot))[cls]}" data-slot="${i}" data-class="${cls}" ` +
                `aria-label="${cls === 'weekday' ? 'Mon–Fri' : cls === 'sat' ? 'Saturday' : 'Sunday'} target for ${escapeHtml(slot.time)}"></td>`
            ).join('') +
            `<td class="gen-td-remove"><button class="gen-remove-btn" data-slot="${i}" type="button" ` +
            `aria-label="Remove ${escapeHtml(slot.time)} row" title="Remove this shift">✕</button></td>` +
            `</tr>`;
        }).join('');
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
            el.textContent = `${tot[cls]} / ${TOTAL_POS}`;
            el.classList.toggle('gen-total-over', tot[cls] > TOTAL_POS);
        }
        _updateGenHours();
        _updateMemoryNote();
        // The sets row states whether the table still matches the set it came from, so it has to be
        // refreshed by the same funnel every edit already passes through. Via a hook because
        // `refreshSetControls` lives inside initGenerator and this function does not.
        _onTargetTableChanged();
        return tot;
    }

    /** Write the target-table verdict into the card. The RULE and the WORDS are
     *  `links-target-hours.js`; this only puts them on screen. */
    function _updateGenHours() {
        const valEl = document.getElementById('genHoursValue');
        const noteEl = document.getElementById('genHoursNote');
        if (!valEl || !noteEl) return;
        const { value, tone, note } = targetHoursLines(
            assessTargetHours(genSlots, { spareLines: genSpareLines, totalLines: TOTAL_POS }));
        valEl.textContent = value;
        valEl.className = tone === 'none' ? '' : tone === 'ok' ? 'gen-hours-ok' : 'gen-hours-off';
        noteEl.textContent = note;
    }

    // ── Generator targets: remembered per design (v19.38) ──────────────────────────────────────
    // The DESIGN was saved but the INPUTS that produced it were not — every load re-seeded the table
    // from the current roster, so a designer who tuned the targets lost that work on reload and
    // could never answer "what targets produced this design?" when reviewing it. Stored in
    // localStorage rather than on the Firestore doc: the doc's rules pin it to
    // hasOnly(['name','patterns','updatedAt','updatedBy']), so a new field would need a rules deploy,
    // and these are one designer's working notes rather than shared truth.
    const GEN_KEY_PREFIX = 'myb_links_gen_';
    const _genTargetsKey = () => GEN_KEY_PREFIX + (getActiveDesignId() || 'unsaved');

    // Whether the table ON SCREEN came from this device's memory rather than the default — and has
    // not been touched this visit. Drives the one-line provenance note: a remembered table that
    // differs from the current default looks exactly like "the new default is wrong" (the v21.05
    // report), and the note is what tells those two states apart. Any edit or reset clears it —
    // once touched, it is the designer's table and they know what it is.
    let genFromMemory = false;
    /** The saved set this table was last loaded from, if any — the note NAMES it (v21.07). */
    let genFromSetName = '';
    /** The set id the table came from, so the sets row can say whether it still matches (v21.08). */
    let genFromSetId = '';
    /**
     * The table AS IT ARRIVED — a deep copy taken every time one is loaded (a set, the default, the
     * seed, or this device's memory). Everything destructive compares against it, so a mis-tap on
     * Load can no longer throw away an afternoon's tuning without asking, and the sets row can tell
     * "this IS Set A" apart from "this started as Set A and is now mine". Nothing else can answer
     * that: the target table is written to localStorage on every keystroke, so it is always
     * "saved" and has no dirty flag of its own the way a design does.
     * @type {{slots: Array<any>, spareLines: number}|null}
     */
    let genOriginTable = null;
    /** Set by initGenerator so the module-scope table edits can refresh the sets row (v21.08). */
    let _onTargetTableChanged = () => {};

    /** A frozen-enough copy for comparison — the table is edited in place, so this must not alias. */
    const _copyTable = () => ({
        slots: genSlots.map((/** @type {any} */ sl) => ({ ...sl })), spareLines: genSpareLines,
    });
    /** Has the table been changed since it was loaded? */
    const _tableChanged = () =>
        !!genOriginTable && !sameTargetTable({ slots: genSlots, spareLines: genSpareLines }, genOriginTable);

    function _updateMemoryNote() {
        const el = document.getElementById('genMemoryNote');
        if (!el) return;
        const note = targetProvenanceNote({
            fromMemory: genFromMemory,
            differsFromDefault: !sameTargetTable(
                { slots: genSlots, spareLines: genSpareLines }, buildDefaultTargets()),
            setName: genFromSetName,
        });
        el.hidden = !note;
        if (note) el.textContent = note;
    }

    /** Persist the current target table for the active design. Silent — losing it is a nuisance,
     *  never a failure worth interrupting a designer for. */
    function saveGenTargets(source = 'edited', setName = '', setId = '') {
        genFromMemory = false;
        // Default '' is load-bearing: every ordinary edit reaches this function without a name, so
        // typing in the table drops the set attribution rather than leaving the note claiming the
        // numbers on screen are still that designer's saved set.
        genFromSetName = setName;
        genFromSetId   = setId;
        _updateMemoryNote();
        // STAMPED with who wrote it and under which app version (v21.06). Content comparison alone
        // could only ever recognise two tables — the roster seed and the CURRENT default — so a
        // device holding an INTERMEDIATE default (v21.00 through v21.05, four of them in as many
        // days) kept it and showed a note instead. The stamp answers the question directly: a table
        // this app wrote as a default, under a version that is no longer current, has nothing to
        // say and is retired. `source: 'edited'` is the safe default — anything that reaches this
        // function without declaring itself is treated as somebody's work and kept forever.
        try {
            lsSet(_genTargetsKey(), JSON.stringify({
                slots: genSlots, spareLines: genSpareLines, source, ver: APP_VERSION, setName, setId,
            }));
        } catch { /* quota / private mode — the default remains the fallback */ }
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
            // A remembered table the app stored ON ITS OWN must not outlive a changed default
            // (v21.05, widened v21.06). TWO routes, because they catch different devices:
            //
            //   · STAMPED — the table declares it was written by a reset button under a named app
            //     version. If that version is not the current one, it is an old default with
            //     nothing to say, whoever's device it is on. This is what reaches the other
            //     designers, whose devices hold v21.00–v21.05 defaults that no content check could
            //     recognise (there were four of them in as many days).
            //   · CONTENT — for tables written before stamping existed: equal to the roster seed
            //     (the auto-stored default from v19.38 to v21.00) or to the current default.
            //
            // Neither route can touch a table somebody edited: an edit stamps `source: 'edited'`,
            // and an unstamped edited table matches neither comparison.
            const stamped = typeof v.source === 'string' && typeof v.ver === 'string';
            const staleDefault = stamped && v.source !== 'edited' && v.ver !== APP_VERSION;
            if (int(v.spareLines) && (staleDefault
                || (!stamped && isSupersededMemory({ slots: v.slots, spareLines: v.spareLines }, buildRosterTargets())))) {
                try { lsSet(_genTargetsKey(), ''); } catch { /* best-effort */ }
                return null;
            }
            return {
                slots: v.slots.map((/** @type {any} */ sl) => ({ time: sl.time, weekday: sl.weekday, sat: sl.sat, sun: sl.sun })),
                setName: typeof v.setName === 'string' ? v.setName : '',
                setId:   typeof v.setId === 'string' ? v.setId : '',
                spareLines: int(v.spareLines) ? v.spareLines : null,
                spare: legacy ? { weekday: v.spare.weekday, sat: v.spare.sat, sun: v.spare.sun } : null,
            };
        } catch { return null; }
    }

    /** Put a target table on screen (state + the three spare inputs + the rows). */
    function applyGenTargets(/** @type {any} */ t) {
        genSlots = t.slots;
        genFromSetName = typeof t.setName === 'string' ? t.setName : '';
        genFromSetId   = typeof t.setId === 'string' ? t.setId : '';
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
        // AFTER the spare-line migration above, not before: a legacy table's line count is derived
        // there, and an origin snapshot taken first would differ from the table on screen — every
        // load would then look like an unsaved change and warn on the next press.
        genOriginTable = _copyTable();
        renderGenTable();
    }

    /**
     * Show the active design's remembered targets, or the DEFAULT table when it has none.
     *
     * The default stopped being the roster seed at v21.00. Those duties pay 16 working lines and
     * this rotation has 19, so since v20.98 the generator refuses them — a designer opening the
     * card met a refusal before typing anything, which is a poor way to be told that widening a
     * link needs more work in it. `links-default-targets.js` pays the contract exactly, so Generate
     * works on arrival; the roster seed is one button away and is still the answer to a different
     * question.
     */
    function refreshGenTargetsForDesign() {
        if (!document.getElementById('genSlotRows')) return;
        const remembered = loadGenTargets();
        genFromMemory = !!remembered;
        applyGenTargets(remembered ?? buildDefaultTargets());
    }

    (function initTargets() {
        const tbody = document.getElementById('genSlotRows');
        if (!tbody) return;

        // Remembered targets for whatever design ends up active, else the default table. loadDesigns
        // calls refreshGenTargetsForDesign() again once it knows which design that is.
        {
            const remembered = loadGenTargets();
            genFromMemory = !!remembered;
            applyGenTargets(remembered ?? buildDefaultTargets());
        }

        tbody.addEventListener('input', e => {
            const input = /** @type {HTMLInputElement|null} */ (/** @type {Element} */ (e.target).closest('.gen-slot-count'));
            if (!input) return;
            const slot = genSlots[+(input.dataset.slot ?? '')];
            if (!slot) return;
            const n = Math.max(0, parseInt(input.value, 10) || 0);
            (/** @type {Record<string, any>} */ (slot))[input.dataset.class ?? ''] = n;
            // Live, so a cell typed to 0 recedes as you type. The BLOCK rules are deliberately NOT
            // recomputed here: re-rendering the table under a keystroke would take the focus out of
            // the cell being typed into.
            input.classList.toggle('is-zero', n === 0);
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
            // The hours row is derived from the TIMES, so it has to be recomputed here — not just
            // when a count changes (v21.07). Without this, changing a duty from 8h to 9h left the
            // contracted-hours figure reading whatever it said before the change: the one number
            // this card exists to show, silently stale, and green while the generator would refuse.
            updateGenTotals();
            saveGenTargets();
        });

        tbody.addEventListener('click', e => {
            const btn = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.gen-remove-btn'));
            if (!btn) return;
            genSlots.splice(+(btn.dataset.slot ?? ''), 1);
            renderGenTable();
            saveGenTargets();
        });

        document.getElementById('genSpareLines')?.addEventListener('input', e => {
            genSpareLines = Math.max(0, parseInt(/** @type {HTMLInputElement} */ (e.target).value, 10) || 0);
            updateGenTotals();
            saveGenTargets();
        });

        document.getElementById('genAddSlotBtn')?.addEventListener('click', () => {
            genSlots.push({ time: defaultSlotTime, weekday: 1, sat: 0, sun: 0 });
            renderGenTable();
            saveGenTargets();
        });

        // The two resets answer different questions and both are worth having: the default is a
        // table DESIGNED against the December 2026 service, the seed is a MEASUREMENT of what is
        // worked today. Either is an explicit "forget my tuning", so both persist over it.
        const _resetTargets = (/** @type {{slots: any[], spareLines: number}} */ t, source = 'edited', setName = '', setId = '') => {
            ({ slots: genSlots, spareLines: genSpareLines } = t);
            saveGenTargets(source, setName, setId);
            /** @type {HTMLInputElement} */ (document.getElementById('genSpareLines')).value = String(genSpareLines);
            genOriginTable = _copyTable();
            renderGenTable();
            const errEl = document.getElementById('genError');
            if (errEl) errEl.textContent = '';
        };
        /**
         * Ask before replacing a table somebody has CHANGED (v21.08).
         *
         * All three of these buttons overwrite the working table outright, and until now did it
         * silently: a mis-tap on Load next to the dropdown discarded an afternoon of tuning with no
         * confirm, no undo, and nothing on screen afterwards to say what had happened. Designs have
         * warned on every equivalent act since v16 — switching design, starting a new one, signing
         * out, closing the tab. This is the same guard for the other thing on this page you can lose.
         *
         * It asks ONLY when the table differs from what was loaded, so the common case — open the
         * card, press Load — is still one press. A guard that fires when nothing is at stake is one
         * people learn to dismiss without reading.
         */
        const _confirmDiscard = async (/** @type {string} */ what) => {
            if (!_tableChanged()) return true;
            return confirmDialog({
                title: 'Replace these shift times?',
                message: `You have changed the table since loading it. ${what} will replace it, and the changes are not kept anywhere.`,
                confirmLabel: 'Replace',
            });
        };
        document.getElementById('genDefaultBtn')?.addEventListener('click', async () => {
            if (await _confirmDiscard('The recommended Dec 2026 staffing')) _resetTargets(buildDefaultTargets(), 'default');
        });
        document.getElementById('genSeedBtn')?.addEventListener('click', async () => {
            if (await _confirmDiscard("Today's roster")) _resetTargets(buildRosterTargets(), 'seed');
        });

        // ── Saved sets (v21.04) ──────────────────────────────────────────────────────────────────
        //
        // Named snapshots of the target table, SHARED between the designers (Firestore, like the
        // designs), so "mess about without losing my set" actually holds across devices: loading a
        // set copies it into this design's working table; keeping a changed version means saving a
        // NEW set. Overwriting belongs to the set's creator or the admin — `canOverwriteTargetSet`
        // here only decides what the Save button OFFERS; `firestore.rules` is what refuses, so a
        // drift between them mis-labels a button without ever exposing anyone's set.
        const SETS_COL = collection(db, COLLECTIONS.linkTargetSets);
        const setStore = createTargetSetStore({
            db, doc, getDocs, runTransaction, writeWithClaimRetry,
            setsCol: SETS_COL, collectionPath: COLLECTIONS.linkTargetSets,
        });
        /** @type {Array<any>} */
        let targetSets = [];
        // WHETHER WE HAVE THE LIST IS ITS OWN QUESTION (v22.57). `targetSets` says what is in it;
        // this says whether it is worth believing. `describeSetList` turns the pair into what the
        // picker may claim — see its header for why an empty array must not speak for a failed read.
        /** @type {'loading'|'ready'|'error'} */
        let setsStatus = 'loading';
        const _setSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('genSetSelect'));
        const _setHint = document.getElementById('genSetHint');
        const _selectedSet = () => targetSets.find(t => t.id === _setSelect?.value) ?? null;

        function renderSetPicker(select = '') {
            if (!_setSelect) return;
            const keep = select || _setSelect.value;
            const list = describeSetList(setsStatus, targetSets);
            _setSelect.innerHTML = list.placeholder
                ? `<option value="">${escapeHtml(list.placeholder)}</option>`
                : targetSets.map(t =>
                    `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)} — ${escapeHtml(t.createdBy)}</option>`).join('');
            if (keep && targetSets.some(t => t.id === keep)) _setSelect.value = keep;
            refreshSetControls();
        }

        function refreshSetControls() {
            const set = _selectedSet();
            const loadBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('genSetLoadBtn'));
            const saveBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('genSetSaveBtn'));
            const delBtn  = /** @type {HTMLButtonElement|null} */ (document.getElementById('genSetDeleteBtn'));
            // WHOSE it is and WHERE THE TABLE IS relative to it are two questions, answered together
            // by the pure `describeSetState` (v21.08) — see its header for why this is not written
            // inline any more.
            const isLoaded = !!set && set.id === genFromSetId;
            const state = describeSetState(set, {
                userName: currentUser, isAdmin: isAdmin, isLoaded, changed: isLoaded && _tableChanged(),
            });
            // A list we do not have cannot be acted on, and `usable` is false for BOTH the
            // still-loading and the failed read — a control armed against an unknown list is how a
            // designer overwrites a set the picker never showed them.
            const list = describeSetList(setsStatus, targetSets);
            if (loadBtn) loadBtn.disabled = !set || !list.usable;
            if (saveBtn) saveBtn.disabled = !state.canWrite || !list.usable;
            if (delBtn) {
                delBtn.disabled = !state.canDelete || !list.usable;
                const label = set ? `Delete “${set.name}”` : 'Delete this set';
                delBtn.title = label;
                delBtn.setAttribute('aria-label', label);   // the word alone does not say WHICH set
            }
            // Save as new is deliberately NOT gated on `usable`: it creates a document, needs
            // nothing from the list, and on a failed read it is the only way to keep this table.
            const retry = document.getElementById('genSetRetryBtn');
            if (retry) retry.hidden = !list.canRetry;
            if (_setHint) _setHint.textContent = list.hint ?? state.text;
        }
        // Every table edit re-asks the question, so "still matches Set A" becomes "you have changed
        // it" on the keystroke that changes it rather than on the next reload.
        _onTargetTableChanged = refreshSetControls;

        // `select` re-selects a set by id once the list is back — used after Save as new set, whose
        // document does not exist until the write lands.
        async function loadTargetSets(select = '') {
            try {
                // AWAIT THE SESSION FIRST (v21.07). `initGenerator` runs synchronously during page
                // init, well before Firebase auth has restored, so this read used to fire
                // unauthenticated: the rules refused it, the catch below swallowed the refusal, and
                // the picker sat on "No staffing setups saved yet" until the designer reloaded — with their
                // sets apparently gone. `loadDesigns` has awaited `sessionReady` for exactly this
                // reason; this read is under the same rule and needs the same wait.
                await sessionReady;
                const res = await setStore.list();
                setsStatus = res.status;
                // NOT `targetSets = []` on a failure (v22.57, external review). Collapsing the two
                // is what made a failed read indistinguishable from an empty account — see
                // `describeSetList`. The last good list is kept: stale, but truer than nothing.
                if (res.status === 'ready') targetSets = res.sets;
            } catch {
                setsStatus = 'error';
            }
            renderSetPicker(select);
        }

        _setSelect?.addEventListener('change', refreshSetControls);
        document.getElementById('genSetRetryBtn')?.addEventListener('click', () => {
            setsStatus = 'loading';
            renderSetPicker();
            loadTargetSets();
        });

        document.getElementById('genSetLoadBtn')?.addEventListener('click', async () => {
            const set = _selectedSet();
            if (!set) return;
            if (!await _confirmDiscard(`“${set.name}”`)) return;
            // Fresh copies — targetSets keeps its own snapshot, and the table edits in place.
            _resetTargets({ slots: set.slots.map((/** @type {any} */ sl) => ({ ...sl })), spareLines: set.spareLines },
                'edited', set.name, set.id);
            refreshSetControls();
        });

        // The write-if-unchanged transaction moved to `links-target-sets-store.js` (v22.57). It was
        // untestable here — a conflict window inside a coordinator that imports the gstatic SDK, so
        // nothing about it could load in Node. Its rules and the seam that tests them: that header.

        // DELETE — the verb the feature shipped without (v21.08). `firestore.rules` has allowed the
        // creator or the admin to delete a set since v21.04; there was simply no way to ask, so sets
        // could only ever accumulate. The confirm names the set and is marked destructive, because
        // unlike a design there is no bin behind this one: a deleted set is gone.
        document.getElementById('genSetDeleteBtn')?.addEventListener('click', async () => {
            const set = _selectedSet();
            if (!set || !describeSetState(set, { userName: currentUser, isAdmin: isAdmin }).canDelete) return;
            const sure = await confirmDialog({
                title: 'Delete this set?',
                message: `“${set.name}” will be removed for every designer. The table above is not affected.`,
                confirmLabel: 'Delete',
                danger: true,
            });
            if (!sure) return;
            try {
                // AGAINST THE VERSION THEY WERE SHOWN (v21.96, external review). The picker's copy
                // of a set can be minutes old, and this dialog adds however long it takes to read.
                // A bare `deleteDoc` destroys whatever is there now — including an update somebody
                // made in that gap, which the person confirming never saw and did not agree to
                // remove. There is no bin behind a set, so that is final.
                if (!await setStore.writeIfUnchanged(set, null)) {
                    // Refresh FIRST, then say why. `loadTargetSets` repaints the hint from the
                    // reloaded row, so setting the message before it wrote a sentence nobody ever
                    // saw — the refusal would have looked like a button that did nothing.
                    await loadTargetSets(set.id);
                    if (_setHint) _setHint.textContent = `“${set.name}” was changed by someone else just now — reload and check before deleting it.`;
                    return;
                }
                // The table itself stays exactly as it is — deleting the SET does not take the shift
                // times off the screen. It is no longer FROM a set, though, so the row must stop
                // claiming it is, or the hint would name a set that no longer exists.
                // Through saveGenTargets, not by clearing the two variables: the set name is also in
                // this device's stored stamp, so clearing only the in-memory pair left the memory
                // note naming a deleted set after the next reload. The table is unchanged; it has
                // simply stopped being FROM a set, which is exactly what an ordinary edit records.
                if (genFromSetId === set.id) saveGenTargets();
                await loadTargetSets();
            } catch {
                if (_setHint) _setHint.textContent = `Couldn't delete “${set.name}” — check you're signed in and try again.`;
            }
        });

        document.getElementById('genSetSaveBtn')?.addEventListener('click', async () => {
            const set = _selectedSet();
            if (!set || !describeSetState(set, { userName: currentUser, isAdmin: isAdmin }).canWrite) return;
            const sure = await confirmDialog({
                title: 'Overwrite this set?',
                message: `Replace “${set.name}” with the table above? Everyone who loads it will get this version.`,
                confirmLabel: 'Overwrite',
            });
            if (!sure) return;
            try {
                // `createdBy` is passed through UNCHANGED — the rules refuse an update that moves
                // it, so ownership survives every overwrite including the admin's. And the write
                // only lands on the version the picker showed: see `_writeSetIfUnchanged`.
                const _payload = targetSetPayload({ name: set.name, slots: genSlots, spareLines: genSpareLines },
                    set.createdBy, currentUser ?? '', serverTimestamp());
                if (!await setStore.writeIfUnchanged(set, _payload)) {
                    // Refresh FIRST, then say why. `loadTargetSets` repaints the hint from the
                    // reloaded row, so setting the message before it wrote a sentence nobody ever
                    // saw — the refusal would have looked like a button that did nothing.
                    await loadTargetSets(set.id);
                    if (_setHint) _setHint.textContent = `“${set.name}” was changed by someone else just now — reload it and try again if you still want to overwrite.`;
                    return;
                }
                // The table IS this set again — an overwrite is the other way of making them match,
                // so the row must stop saying "you have changed it since".
                genFromSetId = set.id; genFromSetName = set.name;
                genOriginTable = _copyTable();
                await loadTargetSets();
            } catch {
                if (_setHint) _setHint.textContent = `Couldn't save “${set.name}” — check you're signed in and try again.`;
            }
        });

        document.getElementById('genSetSaveAsBtn')?.addEventListener('click', async () => {
            // Named, so the type narrows past the dialog below and the payload cannot be handed a
            // null author. Only an owner may ever overwrite a set, so a set written without one
            // would be unmaintainable by the person who made it.
            const author = currentUser;
            if (!author) return;
            const name = await promptDialog({
                title: 'Save as a new staffing setup',
                message: 'Name these staffing numbers — e.g. Winter cover. Every designer can see it; only you can overwrite it.',
                placeholder: 'Setup name',
                maxLength: MAX_SET_NAME,
            });
            if (!name?.trim()) return;
            const setCheck = checkName(name, { existing: targetSets, noun: 'staffing setup' });
            if (!setCheck.ok) { if (_setHint) _setHint.textContent = setCheck.message || ''; return; }
            try {
                // Select the set that was just created (v21.07). The picker is sorted by name, so
                // without this the new set is saved and the selection lands on whatever sorts first
                // — reading as though the save had gone somewhere else, and leaving Save changes
                // pointed at a different designer's set.
                const ref = await writeWithClaimRetry(() => addDoc(SETS_COL,
                    targetSetPayload({ name, slots: genSlots, spareLines: genSpareLines },
                        author, author, serverTimestamp())));
                genFromSetId = ref?.id ?? ''; genFromSetName = name.trim();
                genOriginTable = _copyTable();
                await loadTargetSets(ref?.id ?? '');
            } catch {
                if (_setHint) _setHint.textContent = 'Couldn\'t save the new staffing setup — check you\'re signed in and try again.';
            }
        });

        loadTargetSets();    })();

    return {
        /** Show the active design's remembered targets, or the default table. */
        refreshForDesign: refreshGenTargetsForDesign,
        /** The table the Generate button runs against. LIVE, not a copy — the loop reads it once
         *  per press and must see what is on screen at that moment. */
        getTable: () => ({ slots: genSlots, spareLines: genSpareLines }),
        /** The hours/coverage totals, recomputed. The Generate button asks before running so it can
         *  refuse a table that does not pay the contract. */
        totals: updateGenTotals,
    };
}
