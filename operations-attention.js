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
 * wiring — real card loads feeding the strip in a real browser — by e2e/pages.spec.js.
 */

/**
 * What can need attention, in display order. `label` states the count in words; `truncated`
 * (errors only) means the card's own query cap hid the true total, so the number honestly
 * becomes "100+" — the strip must not understate a backlog its target card states.
 */
export const ATTENTION_CATALOGUE = /** @type {const} */ ({
    resets: {
        emoji: '🙋',
        hash: '#reset-requests',
        short: 'Password resets',
        label: (/** @type {number} */ n) => `${n} password reset${n === 1 ? '' : 's'} waiting`,
    },
    // Grouped BY REMEDY, not by cause (v22.53): everything in `accountSetup` — no account, a
    // disabled one, a claim that was never applied — is fixed by pressing Set up accounts, so it is
    // one item. A leaver still able to sign in needs the separate confirmed disable sweep, so it is
    // its own. Splitting by cause would make the admin do that mapping; splitting by button does not.
    accountSetup: {
        emoji: '🔐',
        hash: '#login-accounts',
        short: 'Not set up',
        label: (/** @type {number} */ n) => `${n} member${n === 1 ? '' : 's'} not set up`,
    },
    accountLeavers: {
        emoji: '🚪',
        hash: '#login-accounts',
        short: 'Leavers still active',
        label: (/** @type {number} */ n) => `${n} leaver${n === 1 ? '' : 's'} can still sign in`,
    },
    // NOT HERE, deliberately: members with no work email. It looks like the same kind of omission
    // and it is not. A missing login is a mistake — somebody cannot do their job and nobody meant
    // that. A missing work email may be a CHOICE: members add their own in Settings, and it buys
    // nothing today beyond a future self-service recovery route (PASSWORD_PLAN Stage 4). An item
    // here would nag the admin about somebody else's decision, and it is a COVERAGE figure, which
    // is a different shape from an exception — a count that is normally non-zero becomes furniture,
    // and furniture in an exceptions index is how the index stops being read. Its home is the
    // Account status card's own summary line ("38/51 work email"), where a coverage figure belongs.
    errors: {
        emoji: '🐛',
        hash: '#error-log',
        short: 'Unresolved errors',
        label: (/** @type {number} */ n, /** @type {{truncated?: boolean}} */ { truncated } = {}) =>
            truncated ? '100+ unresolved errors' : `${n} unresolved error${n === 1 ? '' : 's'}`,
    },
});

/**
 * The pure decision: which items render, in catalogue order, saying what. Each item carries two
 * voices for one fact: `text` is the full sentence (the accessible name — "2 password resets
 * waiting"), `short` + `badge` are the visual pill (the card-header echo — "Password resets ‹2›",
 * where the badge matches the count chip on the card the item opens). `badge` honours the error
 * log's 100+ truncation — the strip must never understate a backlog its target card states.
 * @param {Record<string, {count: number, truncated?: boolean}>} reports
 * @returns {{id: string, hash: string, emoji: string, short: string, badge: string, text: string}[]}
 */
export function buildAttentionItems(reports) {
    const out = [];
    for (const [id, entry] of Object.entries(ATTENTION_CATALOGUE)) {
        const r = reports[id];
        if (!r) continue;                                    // never reported — unknown, not zero
        if (!(r.count > 0) && !r.truncated) continue;        // known clean — nothing to index
        out.push({
            id, hash: entry.hash, emoji: entry.emoji, short: entry.short,
            badge: r.truncated ? '100+' : String(r.count),
            text: entry.label(r.count, r),
        });
    }
    return out;
}

/**
 * Wire the strip. Renders into `container` (kept `hidden` until an item exists).
 *
 * @param {{container: HTMLElement|null, onJump?: (hash: string) => void}} cfg
 * @returns {{report: (id: string, count: number, extra?: {truncated?: boolean}) => void}}
 */
export function createAttentionStrip({ container, onJump }) {
    /** @type {Record<string, {count: number, truncated?: boolean}>} */
    const reports = {};
    if (!container) return { report: () => {} };
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

    function render() {
        const items = buildAttentionItems(reports);
        host.textContent = '';
        if (!items.length) { host.hidden = true; return; }

        // The heading speaks in the page's group-label voice (PUBLISH · MONITORING · …) — the
        // strip is a fourth, CONDITIONAL group at the top, not a banner over the page.
        const head = document.createElement('h2');
        head.className = 'attn-head';
        const glyph = document.createElement('span');
        glyph.setAttribute('aria-hidden', 'true');
        glyph.textContent = '⚠';
        head.append(glyph, ' Needs attention');

        const list = document.createElement('ul');
        list.className = 'attn-items';
        for (const item of items) {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.className = 'attn-item';
            a.href = item.hash;
            // The full sentence is the accessible name; the pill shows the card-header ECHO
            // (emoji · name · the same count chip the target card's header wears), so what you
            // tap looks like where you land.
            a.setAttribute('aria-label', item.text);
            const icon = document.createElement('span');
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = item.emoji;
            const count = document.createElement('span');
            count.className = 'card-year-chip errorlog-count-chip attn-count';
            count.textContent = item.badge;
            a.append(icon, ` ${item.short} `, count);
            li.append(a);
            list.append(li);
        }
        host.append(head, list);
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
    };
}
