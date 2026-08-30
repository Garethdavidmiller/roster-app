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
        label: (/** @type {number} */ n) => `${n} password reset${n === 1 ? '' : 's'} waiting`,
    },
    errors: {
        emoji: '🐛',
        hash: '#error-log',
        label: (/** @type {number} */ n, /** @type {{truncated?: boolean}} */ { truncated } = {}) =>
            truncated ? '100+ unresolved errors' : `${n} unresolved error${n === 1 ? '' : 's'}`,
    },
});

/**
 * The pure decision: which items render, in catalogue order, saying what.
 * @param {Record<string, {count: number, truncated?: boolean}>} reports
 * @returns {{id: string, hash: string, emoji: string, text: string}[]}
 */
export function buildAttentionItems(reports) {
    const out = [];
    for (const [id, entry] of Object.entries(ATTENTION_CATALOGUE)) {
        const r = reports[id];
        if (!r) continue;                                    // never reported — unknown, not zero
        if (!(r.count > 0) && !r.truncated) continue;        // known clean — nothing to index
        out.push({ id, hash: entry.hash, emoji: entry.emoji, text: entry.label(r.count, r) });
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

        const head = document.createElement('h2');
        head.className = 'attn-head';
        const glyph = document.createElement('span');
        glyph.setAttribute('aria-hidden', 'true');
        glyph.textContent = '⚠️';
        head.append(glyph, ' Needs attention');

        const list = document.createElement('ul');
        list.className = 'attn-items';
        for (const item of items) {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.className = 'attn-item';
            a.href = item.hash;
            const icon = document.createElement('span');
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = item.emoji;
            a.append(icon, ` ${item.text}`);
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
