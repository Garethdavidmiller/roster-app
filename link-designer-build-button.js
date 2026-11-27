// @ts-check
/**
 * link-designer-build-button.js — the Link Designer "Build the link" press, end to end: read the target table and
 * the line-order switches, generate, reorder, hand the result to the coordinator, hold the button
 * still through the reflow, and say what was built. What the press SAYS and remembers is
 * link-designer-build-press.js's (pure); the generator is link-designer-generate.js and the line order
 * link-designer-adjacency.js.
 *
 * Moved out of link-designer-app.js on 25 Nov 2026 (the coordinator's maintainability split), its body and
 * comments as they were. The working copy stays the coordinator's: the press READS it through
 * getters before its question, and hands the built patterns back through `applyBuilt`, which
 * replaces the copy (a proposal or an empty page gets a NEW unsaved design), marks it dirty and
 * redraws. `_asNew` is decided BEFORE the question, as it always was.
 *
 * ── RULES AN EDIT CAN BREAK ─────────────────────────────────────────────────────────────────────
 *
 * 1. **Nothing is built until the designs are in** (links-app-1): the load replaces the working copy
 *    when it lands, so a design built before it would vanish unasked (`STILL_LOADING`).
 * 2. **The app never opts out of a generator gate** — neither the contract gate's opt-out nor the
 *    minimum-rest gate's is ever passed here (link-designer-contract.test.mjs reads this file for both names).
 * 3. **Say it, then do it** (links-app-21): the line-order search runs on the main thread after the
 *    confirm, so the button is HELD and says so, a frame is given to paint that, and the release is
 *    booked BEFORE the search, so a tap during it is dropped and nothing the search throws can leave
 *    the button held.
 * 4. **A box's own figure, never a falsy one swapped for the default** (links-app-8, `boxFigure`):
 *    "at least 0" is a real answer. Only a box holding no number falls back; one under its minimum
 *    is raised to it; and the box is written back, so it never shows a figure the build did not use.
 * 5. **The fingerprint is the whole input surface**, so a nudged headcount starts again at the
 *    canonical build (`createBuildCounter`, link-designer-build-press.js rule 5).
 * 6. **The button is held still through the reflow** (v20.54): the first build grows the card above
 *    by a whole grid, and the dialog's unlock scrolls after this handler, so the loop VERIFIES rather
 *    than trusts, with two budgets — one to wait for the unlock, one to converge (v21.83).
 * 7. **The line is written where the pressing happens as well as where the saving does** — the save
 *    row's copy carries the `aria-live`, the mirror beside the button is `aria-hidden`.
 *
 * `boxFigure` is tested by link-designer-build-button.test.mjs; the press by e2e/link-designer.spec.js.
 */

import { confirmDialog } from './overlay.js';
import { DAYS, ROTATING_LINES, DEFAULT_MAX_RUN } from './link-designer-design.js';
import { generateLink } from './link-designer-generate.js';
import { assessTargetHours } from './link-designer-target-hours.js';
import { overCapacityLine, refusalLine, buildConfirm, createBuildCounter, builtStatusLine } from './link-designer-build-press.js';
import { reorderLines, applyOrder, cost, DEFAULT_BLOCK_TARGET } from './link-designer-adjacency.js';

const TOTAL_POS = ROTATING_LINES;   // the one declaration is link-designer-design.js's: every line rotates

/** Build the link's answer while the designs are still loading; the load clears it when it lands. */
export const STILL_LOADING = 'Your saved designs are still loading — build the link once they are in.';

/**
 * The figure a number box holds (rule 4): its own, raised to `min`, or `dflt` only when it holds no number.
 * @param {string} value  the box's text @param {number} dflt @param {number} [min]
 */
export function boxFigure(value, dflt, min = 0) {
    const typed = parseInt(value, 10);
    return Number.isFinite(typed) ? Math.max(min, typed) : dflt;
}

/**
 * Wire the Build the link button, once. A page without the generator's table wires nothing.
 * @param {object} deps
 * @param {{ getTable: () => { slots: any[], spareLines: number }, totals: () => Record<string, number> }} deps.targets  link-designer-generator-targets.js
 * @param {() => boolean} deps.isLoading  the designs' read has not answered yet
 * @param {() => ({ name?: string, patterns: Record<string, any>, window?: any } | null)} deps.getDesign
 * @param {() => string|null} deps.getProposalId  the proposal whose unsaved copy is open, or null
 * @param {() => boolean} deps.isDirty
 * @param {(msg: string, kind?: 'ok'|'err'|'') => void} deps.actionStatus  the design action's status line
 * @param {(patterns: Record<string, any>, asNew: boolean) => void} deps.applyBuilt  the working copy becomes the
 *   built patterns — a NEW unsaved design when `asNew` — dirty, with compare reset, the brush disarmed and all redrawn
 */
export function initBuildButton({ targets, isLoading, getDesign, getProposalId, isDirty, actionStatus, applyBuilt }) {
    if (!document.getElementById('genSlotRows')) return;
    // Which build of these inputs this is (link-designer-build-press.js rule 5): one per page life.
    const builds = createBuildCounter();

    document.getElementById('genApplyBtn')?.addEventListener('click', async () => {
        const errEl = document.getElementById('genError');
        if (errEl) errEl.textContent = '';
        // A failed press must not leave the previous success under the button, beside a fresh error.
        const _mirrorEl = document.getElementById('genStatus');
        if (_mirrorEl) { _mirrorEl.hidden = true; _mirrorEl.textContent = ''; }
        // Not until the designs are in (links-app-1): the load replaces the working copy when it lands.
        if (isLoading()) { if (errEl) errEl.textContent = STILL_LOADING; return; }

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

        const design = getDesign(), activeProposalId = getProposalId();
        const _hasWork = !!design && Object.values(/** @type {Record<string, any>} */ (design.patterns || {}))
            .some(p => DAYS.some(d => { const v = p?.[d]; return v && v !== 'RD' && v !== 'OFF'; }));
        // Read BEFORE the confirm: the button's position (the dialog locks the scroll), and whether the build opens a
        // NEW design, as the question said — a copy's first save landing meanwhile made a proposal a saved design.
        const _btnEl = document.getElementById('genApplyBtn');
        const _btnViewTop = _btnEl?.getBoundingClientRect().top;
        const _asNew = !design || !!activeProposalId;
        if (!await confirmDialog(buildConfirm({ lines: TOTAL_POS, name: design?.name ?? '', proposal: !!activeProposalId, dirty: isDirty(), hasWork: _hasWork }))) return;

        // SAY IT, THEN DO IT (links-app-21): the line-order search runs on the main thread after the confirm,
        // about 0.2–0.7 s on a desktop and several times that on a phone. So the button is HELD and says so,
        // a frame is given to paint that, and the release is booked BEFORE the search, so a tap during it is
        // dropped and nothing the search throws can leave the button held.
        if (_mirrorEl) { _mirrorEl.textContent = 'Building the link…'; _mirrorEl.hidden = false; }
        actionStatus('Building the link…', '');
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
            const n = boxFigure(el?.value ?? '', dflt, min);
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

        // A proposal is not yours to overwrite: `_asNew` makes a NEW unsaved design, named on its first save.
        applyBuilt(_final, _asNew);
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
        if (status) { status.textContent = _statusText; status.className = 'link-designer-save-status ok'; }
        const mirror = document.getElementById('genStatus');
        if (mirror) { mirror.textContent = _statusText; mirror.hidden = false; }
    });
}
