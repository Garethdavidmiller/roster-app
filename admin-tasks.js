// @ts-check
/**
 * admin-tasks.js — the four things an admin actually came here to do.
 *
 * ── WHY (v21.38, external review) ───────────────────────────────────────────────────────────────
 *
 * Admin is one page carrying four distinct jobs — change a shift, record leave, record an absence,
 * find something already saved — and it presented them as four cards of roughly equal weight, all
 * competing for the top of the screen. A user arrives with exactly one of those four in mind, and
 * the page made them find it.
 *
 * This is a FOCUS control, not navigation. Everything stays on one page, and that is the point:
 * the selected member is the context all four jobs share, so splitting them across pages would mean
 * reselecting somebody to do the second thing — the small-team workflow this page exists for is
 * "pick Gareth once, then book his leave AND check his week".
 *
 * ── IT REORDERS NOTHING ─────────────────────────────────────────────────────────────────────────
 *
 * Admin's desktop layout is an explicit two-column grid whose row order is fixed so the SAME source
 * order gives a good mobile stack — `.claude/rules/css-tokens.md` records that moving cards to fix
 * one column only relocates the problem and regresses the other. So focusing a task OPENS its card,
 * collapses the others and scrolls to it. No DOM moves, no grid changes, nothing for the layout to
 * disagree about.
 *
 * ── THE DEFAULT IS ALWAYS CHANGE A SHIFT ────────────────────────────────────────────────────────
 *
 * For everybody, admin and self-service alike, and it is deliberately NOT remembered between visits
 * (owner decision, Aug 2026). A default that varies by role or by what you did last means the page
 * is a different page each time you open it, which costs more than it saves: the value of a
 * consistent starting point is that muscle memory works, and that only holds if it is the same
 * starting point every time. It is the same reasoning as the nav drawer rendering the current page
 * as an inert pill rather than omitting it — being in a predictable place beats being optimal.
 *
 * ── COLLAPSING IS NOT HIDING ────────────────────────────────────────────────────────────────────
 *
 * Every card stays present, in its place, with its header readable. A collapsed card is one tap from
 * open and the chips are one tap from switching. Nothing here removes a capability, which is what
 * keeps this a focus aid rather than a mode.
 *
 * Tested by admin-tasks.test.mjs (the pure half) and driven in a browser by e2e/pages.spec.js.
 */

/**
 * The four tasks, in the order they appear. `card` is the element focused; `body`/`chevron` are the
 * collapsible pair where the card has one — Change a Shift is always open, being the default and the
 * primary surface, so it has no toggle at all.
 * @type {ReadonlyArray<{ id: string, label: string, card: string, body?: string, chevron?: string }>}
 */
export const ADMIN_TASKS = /** @type {const} */ ([
    { id: 'shift',   label: 'Change a shift', card: 'change-shift' },
    { id: 'leave',   label: 'Annual leave',   card: 'book-annual-leave', body: 'alBody',        chevron: 'alChevron' },
    { id: 'absence', label: 'Absence',        card: 'record-sick-days',  body: 'sickBody',      chevron: 'sickChevron' },
    { id: 'saved',   label: 'Saved changes',  card: 'overridesCard',     body: 'overridesBody', chevron: 'overridesChevron' },
]);

/** The task a fresh page open lands on. Never role-dependent, never remembered — see the header. */
export const DEFAULT_TASK = 'shift';

/**
 * Which task a deep link is asking for, if any.
 *
 * Admin already supports `#book-annual-leave`-style deep links (the calendar's AL lightbox uses
 * one), and those must keep working and must select the matching chip — a link that opened the
 * right card while the chips said something else would be two answers on one screen.
 * @param {string} hash `location.hash`, with or without the leading `#`
 * @returns {string|null} a task id, or null when the hash names something else
 */
export function taskForHash(hash) {
    let id = String(hash || '').replace(/^#/, '');
    if (!id) return null;
    // DECODE LIKE THE DEEP-LINK HANDLER DOES (v21.38, review). It calls `decodeURIComponent` and
    // this did not, so `#book%2Dannual%2Dleave` opened the Annual Leave card with the Change-a-shift
    // chip lit — the page and its own control disagreeing, from one link. A malformed escape throws,
    // and is treated as "names no task": the same fail-safe the handler uses.
    try { id = decodeURIComponent(id); } catch { return null; }
    const hit = ADMIN_TASKS.find(t => t.card === id);
    return hit ? hit.id : null;
}

/**
 * Decide the page's opening task.
 * @param {string} hash `location.hash`
 * @returns {string} a task id — always one of `ADMIN_TASKS`
 */
export function initialTask(hash) {
    return taskForHash(hash) ?? DEFAULT_TASK;
}

/**
 * Wire the chip row and focus the opening task.
 *
 * @param {object} deps
 * @param {(id: string) => void} [deps.onFocus] notified after each switch (used to lazy-refresh a
 *   card's preview when it becomes the focused one)
 * @returns {{ focusTask: (id: string) => void } | null} null when the row is absent (a page state
 *   that never rendered it — never throw over a progressive enhancement)
 */
export function initAdminTasks({ onFocus } = {}) {
    const row = document.getElementById('adminTaskRow');
    if (!row) return null;

    row.innerHTML = ADMIN_TASKS.map(t =>
        `<button type="button" class="admin-task-chip" data-task="${t.id}" aria-pressed="false">${t.label}</button>`
    ).join('');

    /**
     * Set a collapsible card open or closed BY OPERATING ITS OWN CONTROL.
     *
     * Deliberately not by setting classes. The collapse state is three things kept in step by
     * `initCardCollapse` — `.open` on the body, `.open` on the chevron, `aria-expanded` on the
     * control — and a second writer that sets one of them leaves an arrow pointing the wrong way
     * over a card whose state it disagrees with. That exact drift is recorded twice already in this
     * repo (the nav drawer's `.open`-versus-`aria-expanded` note, and the guides section that
     * inverted its arrow for good). Clicking the real control cannot desynchronise, because there
     * is still only one implementation.
     * @param {{ body?: string, chevron?: string }} task @param {boolean} want
     */
    const setCardOpen = (task, want) => {
        if (!task.body || !task.chevron) return;         // no toggle — always open
        const body = document.getElementById(task.body);
        if (!body || body.classList.contains('open') === want) return;
        document.getElementById(task.chevron)?.click();
    };

    /** Open exactly one card, collapse the rest, and bring it into view. */
    const focusTask = (/** @type {string} */ id) => {
        const chosen = ADMIN_TASKS.find(t => t.id === id) ?? ADMIN_TASKS[0];
        ADMIN_TASKS.forEach(t => {
            const card = document.getElementById(t.card);
            if (!card) return;
            const on = t.id === chosen.id;
            card.classList.toggle('task-focused', on);
            card.classList.toggle('task-dimmed', !on);
            setCardOpen(t, on);
        });
        row.querySelectorAll('.admin-task-chip').forEach(btn => {
            const el = /** @type {HTMLElement} */ (btn);
            el.setAttribute('aria-pressed', String(el.dataset.task === chosen.id));
        });
        // SCROLL SO THE ROW STAYS REACHABLE (v21.38, review). Scrolling the CARD to the top put the
        // chip row above the viewport on its own first tap — the control whose entire point is
        // one-tap switching between four jobs removed itself the instant it was used, and switching
        // again meant scrolling back past the card just opened. Scrolling the ROW instead keeps the
        // chips on screen with the focused card directly beneath them, which is the arrangement the
        // row was placed in. `nearest` so a card already in view does not jump at all.
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        onFocus?.(chosen.id);
    };

    row.addEventListener('click', e => {
        const btn = /** @type {HTMLElement} */ (e.target)?.closest?.('.admin-task-chip');
        if (btn) focusTask(/** @type {HTMLElement} */ (btn).dataset.task ?? DEFAULT_TASK);
    });

    // The opening task. A deep link wins so `#book-annual-leave` still lands where it always did —
    // and now selects the matching chip rather than leaving the row disagreeing with the page.
    focusTask(initialTask(location.hash));
    return { focusTask };
}
