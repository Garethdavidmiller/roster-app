// @ts-check
/**
 * operations-reports.js — what the three reporting cards SHARE, and the one import they present.
 *
 * Owns: the failure/retry helper every card on the page uses, the page and document metadata both
 *   the Usage and App Speed cards read, the privacy footer they close on, and two formatters.
 * Does NOT own: any card. Error Log is `operations-errors.js`, Usage is `operations-usage.js`,
 *   App Speed is `operations-speed.js`, and each is imported DIRECTLY by `operations-app.js`.
 *
 * There is deliberately no re-export barrel here. The first cut had one, and `import-graph.test.mjs`
 * refused it immediately: a barrel that re-exports the cards while the cards import the shared
 * helpers from it is a cycle, however tidily it reads. One import line saved is not worth a cycle
 * in the module every page's Operations card depends on.
 *
 * ── WHY THE SPLIT (v21.32) ──────────────────────────────────────────────────────────────────────
 *
 * This was one 1,137-line module holding three cards, and the coordinator ratchet was one edit from
 * refusing it. The response was SPLIT rather than EXTRACT because no RULE was in here to take out —
 * the maths already lives in `perf-stats.js`, `usage-stats.js` and `client-errors.js`, and what
 * remained was three unrelated jobs sharing a file. Three subjects, three files.
 *
 * They were always independent: each awaits `sessionReady`, reads Firestore, and renders into its
 * own card by id, and none touches coordinator state. That is what made the split mechanical rather
 * than a redesign — and it is why the shared surface below is four small things and no logic.
 */

/**
 * The privacy footer both reporting cards end on — ONE declaration, two consumers (v21.29).
 *
 * It was written twice, and the two copies had drifted into saying the same two things in the
 * opposite order and slightly different words. That matters more here than ordinary duplication:
 * it is the app's most-repeated promise to staff, and a promise phrased differently each time it
 * appears reads as approximate. Exclusion first, anonymity last, so both cards close on the
 * stronger claim.
 */
const PRIVACY_FOOTER = 'Your own (admin) opens are excluded. Anonymous — we never record who.';

/**
 * Emoji + label for each page id — shared by the Usage and App Speed cards (was defined
 * identically inside both). One source so a label change (or a new page) is edited once.
 *
 * ── A MISSING ENTRY IS INVISIBLE UNTIL THE PAGE HAS TRAFFIC ─────────────────────────────────────
 *
 * Both cards fall back to the raw id and a generic 📄 when a page is not listed here, so `overtime`
 * shipped at v20.59 and rendered lower-case beside six title-case names for twenty-five releases —
 * until it had enough opens to appear at all. That is the whole failure mode: the fallback is
 * silent, the counter itself works, and nothing surfaces the gap while the page is quiet. Every
 * emoji matches the page's own nav pill (`NAV_PAGES`), which is what makes the two surfaces read as
 * one app. `page-contract-parity.test.mjs` now fails when a served page has no entry.
 * @type {Record<string, { emoji: string, label: string }>}
 */
const PAGE_META = {
    calendar:   { emoji: '📅', label: 'Calendar' },
    admin:      { emoji: '📝', label: 'Admin' },
    paycalc:    { emoji: '💷', label: 'Pay calculator' },
    operations: { emoji: '🔧', label: 'Operations' },
    settings:   { emoji: '⚙️', label: 'Settings' },
    links:      { emoji: '🔗', label: 'Links' },
    overtime:   { emoji: '⏱️', label: 'Overtime' },
};

/** Document/guide OPEN counters (v18.20) — share the pv_ counts map with the page ids above but
 *  render as their own "opens" group (an open is a different act from a page view). Emojis match
 *  each feature's in-app icon (nav drawer / notification signature).
 * @type {Record<string, { emoji: string, label: string }>}
 */
const OPEN_META = {
    'huddle':         { emoji: '📋', label: 'Daily Huddle' },
    'circular':       { emoji: '📰', label: 'Weekly Retail Circular' },
    'newsletter':     { emoji: '🗞️', label: 'Marylebone Newsletter' },
    // All four guides, not two (v19.95). The Staff & Admin Guide and the Pay Calculator Guide are
    // the two most likely to answer a question staff would otherwise ask a manager, and they were
    // the two with no counter at all — so the group answered "which of the two REFERENCE guides is
    // read more" while reading as "which guides are read". Emojis match NAV_GUIDES.
    'guide-staff':    { emoji: '📘', label: 'Staff & Admin Guide' },
    'guide-paycalc':  { emoji: '💷', label: 'Pay Calculator Guide' },
    'guide-railcard': { emoji: '🎫', label: 'Railcard Guide' },
    'guide-fip':      { emoji: '🇪🇺', label: 'FIP Travel Guide' },
    'guide-rangers':  { emoji: '🗺️', label: 'Rangers & Rovers' },
};

/**
 * Render a monitoring-card load failure with a "Try again" button that re-runs JUST this card
 * (B2). Previously each card's catch told the admin to "reload" — a full page reload that re-runs
 * every other card too, for a blip on one. The button clears the card and re-invokes its own init
 * function, so a transient failure costs one tap, not a whole-page refresh.
 * @param {HTMLElement} content   the card's content container
 * @param {string} message        the failure message (no "reload" wording — the button IS the retry)
 * @param {() => void} retryFn     the card's own init function
 */
function _cardLoadError(content, message, retryFn) {
    content.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'auth-desc';
    p.style.color = 'var(--error-red)';
    p.textContent = message;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-action btn-secondary card-retry-btn';
    btn.textContent = '↻ Try again';
    btn.addEventListener('click', () => { btn.disabled = true; content.setAttribute('aria-busy', 'true'); retryFn(); });
    content.appendChild(p);
    content.appendChild(btn);
}

/** "2026-06" → "June 2026" for the Usage card heading. */
function _usageMonthLabel(/** @type {string} */ ym) {
    const [y, m] = String(ym).split('-').map(Number);
    if (!y || !m) return ym;
    return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
}

/** Format a relative time string with the exact time appended, e.g. "3h ago · 22 Jun 14:23".
 *  EXPORTED (v18.93) so the Password Reset Requests card in operations-app.js reads identically to the
 *  Error Log rows beside it — a second formatter would have drifted. */
function _relativeTime(/** @type {Date} */ date) {
    const secs = Math.floor((Date.now() - date.getTime()) / 1000);
    const exact = date.toLocaleString('en-GB', {
        day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit',
    });
    let rel;
    if (secs < 60)    rel = `${secs}s ago`;
    else if (secs < 3600)  rel = `${Math.floor(secs / 60)}m ago`;
    else if (secs < 86400) rel = `${Math.floor(secs / 3600)}h ago`;
    else                   rel = `${Math.floor(secs / 86400)}d ago`;
    return `${rel} · ${exact}`;
}

export { PRIVACY_FOOTER, PAGE_META, OPEN_META, _cardLoadError, _usageMonthLabel, _relativeTime };
