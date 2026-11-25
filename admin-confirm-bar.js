// @ts-check
/**
 * admin-confirm-bar.js — the over-allowance question on admin.html: "This takes them over their
 * allowance" with Save anyway / Cancel, fixed at the foot of the page.
 *
 * Owns: whose question the bar is asking, what "Save anyway" then does (the week grid's held batch,
 *   or the asking card's own resume), and where Cancel sends focus.
 * Does NOT own: whether a save is over the allowance (admin-al-week-save.js, admin-al.js, admin-sick.js,
 *   admin-saved-changes.js and admin-period-delete.js each decide that and ASK), or the write itself.
 * Edit here for: how the bar is shown, answered or taken down. Built by admin-app.js, which hands it the
 *   page's elements and what a save does. Tested by admin-confirm-bar.test.mjs.
 *
 * ── WHY IT LEFT THE COORDINATOR (25 Nov 2026) ───────────────────────────────────────────────────
 *
 * Five pieces of state — the held batch, its skipped and kept days, the asking card, its resume and the
 * control Cancel returns to — were `let`s in admin-app.js, reset by hand in three places. The rule they
 * carry is ownership, which a test can hold without a page: a card takes down only its own question.
 *
 * ── WHOSE QUESTION THE BAR IS ASKING (review, 21 Nov 2026) ──────────────────────────────────────
 *
 * Four cards share one bar — the week grid, Annual Leave, Absence and Saved Changes — and each took it
 * down on its own routine events, so editing an AL range dismissed the week grid's question unanswered,
 * and the week's Save the AL card's. A card now takes down only its OWN question (`hide(card)`); a
 * member change, Cancel and Save anyway still clear whatever is showing (`hide()`), because each of
 * those ends the question for everybody.
 *
 * ── THE HELD BATCH CARRIES ITS OWN RECEIPT ──────────────────────────────────────────────────────
 *
 * The week grid's batch arrives WITH the staged days its plan leaves alone (`skipped`) and which of
 * those still hold leave (`kept`), so the receipt "Save anyway" produces names them, never a silent
 * drop. They travel through `show` with the batch and are dropped with it: a later save answers for
 * itself, and a hidden bar cannot hand a stale list to the next one.
 *
 * ── THE BUTTON IS DISARMED WHILE THE BAR GOES ───────────────────────────────────────────────────
 *
 * The bar slides out over 0.25s and stays hit-testable meanwhile, so a tap would fall through to the
 * range branch unchecked. Hiding disables Save anyway, and pressing it disables it first, so a double
 * tap cannot reach that branch either; `show` re-arms it.
 */

/** @typedef {'week'|'al'|'sick'|'saved'} BarOwner */
/** @typedef {{ toSave: any[], toDelete: any[], skipped?: string[], kept?: string[] }} HeldBatch */

/**
 * Build the bar's controller and wire its two buttons.
 * @param {{
 *   bar: HTMLElement, msgEl: HTMLElement, subEl: HTMLElement,
 *   saveAnywayBtn: HTMLButtonElement, cancelBtn: HTMLElement,
 *   activeElement: () => Element|null, body: Element,
 *   fallbackOpener: (o: { batch: boolean, resume: boolean }) => HTMLElement|null,
 *   beforeShow?: () => void,
 *   isSaveInFlight: () => boolean, onBusy: (msg: string) => void,
 *   saveBatch: (toSave: any[], toDelete: any[], skipped: string[], kept: string[]) => any,
 *   resumeDefault: () => void,
 *   afterCancel?: () => void,
 * }} deps
 *   `fallbackOpener` — the control Cancel returns to when nothing was focused (Safari focuses no button
 *   on a tap): the week's Save for a batch, else the asking range card's. `beforeShow` — an earlier
 *   success line's fade must not take the question down. `resumeDefault` — the Annual Leave card's
 *   "Save anyway" (admin-al.js), run when the asker handed no resume of its own.
 * @returns {{ show: (q: { msg: string, sub: string, batch?: HeldBatch|null, resume?: (() => void)|null, owner?: BarOwner }) => void,
 *            hide: (onlyFor?: BarOwner) => void, owner: () => BarOwner|null }}
 */
export function createConfirmBar(deps) {
    const { bar, msgEl, subEl, saveAnywayBtn, cancelBtn } = deps;
    /** @type {BarOwner|null} */ let owner = null;
    /** @type {HeldBatch|null} */ let batch = null;
    /** @type {(() => void)|null} */ let resume = null;
    /** @type {HTMLElement|null} */ let opener = null;

    /**
     * Ask. `batch` is the week grid's held save; without one, "Save anyway" runs `resume`, or the AL
     * card's own when there is none. `owner` defaults to the week grid for a batch, else the AL card.
     * @param {{ msg: string, sub: string, batch?: HeldBatch|null, resume?: (() => void)|null, owner?: BarOwner }} q
     */
    function show({ msg, sub, batch: held = null, resume: onAnyway = null, owner: asker }) {
        owner = asker ?? (held ? 'week' : 'al');
        deps.beforeShow?.();
        batch = held ? { toSave: held.toSave, toDelete: held.toDelete ?? [], skipped: held.skipped ?? [], kept: held.kept ?? [] } : null;
        resume = onAnyway;
        msgEl.textContent = msg;
        subEl.textContent = sub;
        saveAnywayBtn.disabled = false;   // re-arm (a press disables it to block a double tap)
        // The Save that asked, which Cancel goes back to — on Safari, which focuses no button on a tap, the fallback.
        const asked = deps.activeElement();
        opener = asked && asked !== deps.body ? /** @type {HTMLElement} */ (asked) : deps.fallbackOpener({ batch: !!held, resume: !!onAnyway });
        bar.classList.add('visible');
        saveAnywayBtn.focus();
    }

    /** Take the question down — or, given a card, only when the question showing is that card's.
     *  @param {BarOwner} [onlyFor] */
    function hide(onlyFor) {
        if (onlyFor && owner && onlyFor !== owner) return;
        owner = null;
        bar.classList.remove('visible');
        batch = null;
        resume = null;
        saveAnywayBtn.disabled = true;   // disarmed through the slide-out (header)
    }

    saveAnywayBtn.addEventListener('click', async () => {
        if (saveAnywayBtn.disabled) return;
        // ONE WRITE AT A TIME, this button too: a booking still sending holds the lock.
        if (batch && deps.isSaveInFlight()) return deps.onBusy('Another change is still saving — try again when it has finished.');
        saveAnywayBtn.disabled = true;
        if (batch) {
            const { toSave, toDelete, skipped = [], kept = [] } = batch;
            hide();
            await deps.saveBatch(toSave, toDelete, skipped, kept);
        } else {
            // A range card — delegate to the card that asked, which owns its button and flag.
            const onAnyway = resume;
            hide();
            (onAnyway ?? deps.resumeDefault)();
        }
    });

    cancelBtn.addEventListener('click', () => {
        hide();
        deps.afterCancel?.();
        // …and focus back to the Save that asked, not a hidden button.
        if (opener?.isConnected && !(/** @type {any} */ (opener)).disabled) opener.focus();
    });

    return { show, hide, owner: () => owner };
}
