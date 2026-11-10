// @ts-check
/**
 * operations-attention.js — the "Needs attention" strip at the top of operations.html.
 *
 * Operations is ten collapsed cards, and finding out whether anything needs doing meant opening
 * them one by one. The strip is an INDEX OF EXCEPTIONAL STATES, and its whole design is three
 * refusals:
 *
 *  - IT RUNS NO READS. Every count arrives from the card that owns the data, via `report()`, on
 *    the same load the card paints from — a parallel query set here could disagree with the card
 *    it points at, and an index that contradicts its target is worse than none.
 *  - IT DISAPPEARS WHEN CLEAN. No "all clear" state, no empty frame: when nothing needs attention
 *    the strip does not exist, so its mere presence is the signal. (An item a card has not
 *    reported yet is likewise simply absent — the strip only ever claims what it has been told,
 *    and a failed card load reports nothing rather than a reassuring zero.)
 *  - IT OWNS NO NAVIGATION. Items are plain hash anchors into the page's existing deep-link
 *    machinery (DEEP_LINK_CARDS — the same route the reset-request push notification takes), plus
 *    an `onJump` callback so a repeat tap still opens and scrolls when the hash has not changed.
 *
 * The CATALOGUE is the one declaration of what can need attention. `report()` THROWS on an id it
 * does not know: a typo'd id silently reporting into the void would be an exceptional state that
 * never surfaces anywhere, which is this feature's own failure mode.
 *
 * Pure half (`buildAttentionItems`) tested by operations-attention.test.mjs (test:hygiene); the
 * wiring — real card loads feeding the strip in a real browser — by e2e/operations.spec.js.
 */

/**
 * What can need attention, in display order. `after` is what the item's name says AFTER its count
 * ("waiting", "members"), or nothing; `truncated` (errors only) means the card's own query cap hid
 * entries it could not read, so the number honestly becomes a floor — "2+" (`attentionBadge`) — and
 * the strip must not understate a backlog its target card states.
 */
export const ATTENTION_CATALOGUE = /** @type {const} */ ({
    resets: {
        emoji: '🙋',
        hash: '#reset-requests',
        short: 'Password resets',
        after: () => 'waiting',
    },
    // Grouped BY REMEDY, not by cause (v22.53): everything in `accountSetup` — no account, a
    // disabled one, a claim that was never applied — is fixed by pressing Set up accounts, so it is
    // one item. A leaver still able to sign in needs the separate confirmed disable sweep, so it is
    // its own. Splitting by cause would make the admin do that mapping; splitting by button does not.
    accountSetup: {
        emoji: '🔐',
        hash: '#login-accounts',
        short: 'Not set up',
        after: (/** @type {number} */ n) => (n === 1 ? 'member' : 'members'),
    },
    accountLeavers: {
        emoji: '🚪',
        hash: '#login-accounts',
        short: 'Leavers still active',
        after: () => '',
    },
    // NOT HERE, deliberately: members with no work email. It looks like the same kind of omission
    // and it is not. A missing login is a mistake — somebody cannot do their job and nobody meant
    // that. A missing work email may be a CHOICE: members add their own in Settings, and it buys
    // nothing today beyond a future self-service recovery route (SECURITY_RELEASE_PLAN track C2). An item
    // here would nag the admin about somebody else's decision, and it is a COVERAGE figure, which
    // is a different shape from an exception — a count that is normally non-zero becomes furniture,
    // and furniture in an exceptions index is how the index stops being read. Its home is the
    // Account status card's own summary line ("38/51 work email"), where a coverage figure belongs.
    errors: {
        emoji: '🐛',
        hash: '#error-log',
        short: 'Unresolved errors',
        after: () => '',
    },
});

/**
 * The ONE spelling of a count, worn by the strip's badge AND the Error Log's header chip, so the two
 * cannot disagree (Nov 2026 review). With `truncated` the card's query cap hid entries it could not
 * read, so the count is a FLOOR and says "+". It said "100+" whatever the count was — but the cap is
 * shared with slow-save diagnostics, which are listed and never counted (client-errors.js), so two
 * real errors under a cap full of diagnostics read "100+", and a cap holding none read as an empty
 * chip beside a strip saying "100+". "0+" is that last case said honestly: none of the entries shown
 * is an error, and the ones not loaded may be. Empty means known clean: the chip's `:empty` hides it
 * and the strip renders no item.
 * @param {number} count @param {boolean} [truncated]
 * @returns {string}
 */
export function attentionBadge(count, truncated = false) {
    if (truncated) return `${count}+`;
    return count > 0 ? String(count) : '';
}

/**
 * The pure decision: which items render, in catalogue order, saying what. `short` + `badge` are
 * the visual pill (the card-header echo — "Password resets ‹2›", where the badge matches the count
 * chip on the card the item opens), and `text`, the accessible name, is BUILT FROM THEM — "Password
 * resets: 2 waiting". It used to be a sentence of its own, "2 password resets waiting", which a
 * voice user could not say by reading the pill (WCAG 2.5.3 Label in Name; axe checks it from 4.14,
 * v25.27). `badge` is `attentionBadge`, so a truncated backlog reads as the floor it is — the strip
 * must never understate a backlog its target card states.
 * @param {Record<string, {count: number, truncated?: boolean}>} reports
 * @returns {{id: string, hash: string, emoji: string, short: string, badge: string, text: string}[]}
 */
export function buildAttentionItems(reports) {
    const out = [];
    for (const [id, entry] of Object.entries(ATTENTION_CATALOGUE)) {
        const r = reports[id];
        if (!r) continue;                                    // never reported — unknown, not zero
        const badge = attentionBadge(r.count, r.truncated);
        if (!badge) continue;                                // known clean — nothing to index
        const after = entry.after(r.count);
        out.push({
            id, hash: entry.hash, emoji: entry.emoji, short: entry.short, badge,
            text: `${entry.short}: ${badge}${after ? ` ${after}` : ''}`,
        });
    }
    return out;
}

/**
 * Wire the strip. Renders into `container` (kept `hidden` until an item exists).
 *
 * @param {{container: HTMLElement|null, onJump?: (hash: string) => void}} cfg
 * @returns {{report: (id: string, count: number, extra?: {truncated?: boolean}) => void, withdraw: (id: string) => void}}
 */
export function createAttentionStrip({ container, onJump }) {
    /** @type {Record<string, {count: number, truncated?: boolean}>} */
    const reports = {};
    if (!container) return { report: () => {}, withdraw: () => {} };
    // Re-bound after the guard so the closures below see a non-null type (narrowing does not
    // survive into a nested function).
    const host = container;

    host.addEventListener('click', (e) => {
        const a = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('a[href^="#"]'));
        // The anchor's default sets the hash (deep-linkable, Back-friendly); the callback opens the
        // card even when the hash is UNCHANGED — a second tap after closing the card must still work,
        // and hashchange will not fire for it.
        if (a) onJump?.(a.getAttribute('href') || '');
    });

    // UPDATED IN PLACE, never rebuilt (Nov 2026 review). Every report used to wipe the strip and draw
    // it again, and reports keep arriving — four over the first seconds, another on every return to
    // the tab — so a link a keyboard user had tabbed to was destroyed under them and focus fell to the
    // page. So the heading and list are made once, an item's link is kept for as long as its item is
    // shown and only its words change, and a new item is INSERTED in catalogue order: an existing link
    // is never moved, because moving a node drops its focus as surely as removing it.
    /** @type {HTMLUListElement|null} */ let list = null;
    /** @type {Map<string, { li: HTMLLIElement, a: HTMLAnchorElement, count: HTMLSpanElement }>} */
    const shown = new Map();

    function render() {
        const items = buildAttentionItems(reports);
        for (const [id, row] of shown) {
            if (!items.some(i => i.id === id)) { row.li.remove(); shown.delete(id); }
        }
        if (!items.length) { host.hidden = true; return; }

        if (!list) {
            // The heading speaks in the page's group-label voice (PUBLISH · MONITORING · …) — the
            // strip is a fourth, CONDITIONAL group at the top, not a banner over the page.
            const head = document.createElement('h2');
            head.className = 'attn-head';
            const glyph = document.createElement('span');
            glyph.setAttribute('aria-hidden', 'true');
            glyph.textContent = '⚠';
            head.append(glyph, ' Needs attention');
            list = document.createElement('ul');
            list.className = 'attn-items';
            host.append(head, list);
        }

        /** @type {{ li: HTMLLIElement }|null} */ let prev = null;
        for (const item of items) {
            let row = shown.get(item.id);
            if (!row) {
                const li = document.createElement('li');
                const a = document.createElement('a');
                a.className = 'attn-item';
                a.href = item.hash;
                const icon = document.createElement('span');
                icon.setAttribute('aria-hidden', 'true');
                icon.textContent = item.emoji;
                const count = document.createElement('span');
                count.className = 'card-year-chip errorlog-count-chip attn-count';
                a.append(icon, ` ${item.short} `, count);
                li.append(a);
                list.insertBefore(li, prev ? prev.li.nextSibling : list.firstChild);
                row = { li, a, count };
                shown.set(item.id, row);
            }
            // The pill shows the card-header ECHO (emoji · name · the same count chip the target
            // card's header wears), so what you tap looks like where you land; its accessible name
            // leads with those same words and then says what the count is of.
            row.a.setAttribute('aria-label', item.text);
            row.count.textContent = item.badge;
            prev = row;
        }
        host.hidden = false;
    }

    return {
        report(id, count, extra = {}) {
            if (!(id in ATTENTION_CATALOGUE)) {
                // A typo here would silently un-index an exceptional state for ever — fail loudly
                // in the first test that runs it instead.
                throw new Error(`[attention] unknown id "${id}" — add it to ATTENTION_CATALOGUE`);
            }
            reports[id] = { count, truncated: !!extra.truncated };
            render();
        },
        /**
         * Back to UNKNOWN (whole-app review, Oct 2026): a card whose RELOAD failed withdraws what it
         * reported before, rather than leaving a count it can no longer stand behind. Not a zero —
         * the header's rule is that a failed load claims nothing either way.
         * @param {string} id
         */
        withdraw(id) {
            delete reports[id];
            render();
        },
    };
}
