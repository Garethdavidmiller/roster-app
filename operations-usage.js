// @ts-check
/**
 * operations-usage.js — the Usage card on operations.html.
 *
 * One of the three reporting cards split out of operations-reports.js at v21.32 — see that
 * module's header for why. It awaits `sessionReady`, reads Firestore, and renders into its own
 * card by id; it touches no coordinator state and no other card.
 */
import { sessionReady } from './session.js';
import { withClaimRetry, getUsageStats, getSignInStats } from './firebase-client.js';
import { escapeHtml } from './roster-data.js';
import { PRIVACY_FOOTER, PAGE_META, OPEN_META, _cardLoadError, _usageMonthLabel } from './operations-reports.js';

// ============================================
// USAGE CARD
// ============================================
async function initUsageCard() {
    const content = document.getElementById('usageContent');
    if (!content) return;

    try {
        await sessionReady;
        const stats = await withClaimRetry(getUsageStats);
        content.innerHTML = '';

        // Active-use headline numbers. These are the DEVICE-deduped trend: a member using a
        // phone and a laptop counts twice, which is the price of the server never learning who was
        // active. The exact unique count is the separate section below.
        // The card used to OPEN on two hero numbers with no heading, then hit a second set under
        // "Accounts that have signed in" — five big numbers, only one block labelled, so nothing said
        // how they related or which was authoritative. Both blocks are now headed and paired.
        //
        // ── WHY THIS IS NOT CALLED "ACCOUNTS ACTIVE" ANY MORE (v20.08, external review P2) ───────
        // It said that from v14.14 to v20.07, sitting directly above a block headed "Accounts that
        // have signed in" — so the two read as the same measure at different precisions, and the
        // upper one as the authoritative headcount. It is neither. The unit is a MEMBER ON A DEVICE
        // (a phone and a laptop are two), and since v19.95 the identity for a calendar-only visitor
        // is the member SELECTED on that device, which on a shared phone need not be the person
        // holding it. Every one of those caveats was already written down in the ? panel; what was
        // missing was a label that did not contradict them at a glance. "Accounts" is the word this
        // app uses for a provisioned Firebase identity, which is precisely what this is not counting.
        const accountsLabel = document.createElement('p');
        accountsLabel.className = 'usage-section-label';
        accountsLabel.innerHTML = '<span aria-hidden="true">\u{1F465}</span> Roster in use — by member and device';
        content.appendChild(accountsLabel);

        const accounts = document.createElement('div');
        accounts.className = 'usage-stats';
        accounts.innerHTML =
            `<div class="usage-stat"><span class="usage-stat-num">${stats.accountsThisMonth}</span>` +
            `<span class="usage-stat-lbl"><span aria-hidden="true">👥</span> member-devices this month</span></div>` +
            `<div class="usage-stat"><span class="usage-stat-num">${stats.accountsLast30}</span>` +
            `<span class="usage-stat-lbl"><span aria-hidden="true">📅</span> active in last 30 days</span></div>`;
        content.appendChild(accounts);
        // No note here. "Counted per account-device… a trend, not a headcount" is stated verbatim by
        // the card's own ? panel (the 📱 tip), and four blocks of dense grey micro-copy was most of
        // what made this card read as cluttered. The ? exists precisely for the standing caveats.

        // Exact unique accounts, from Firebase Auth's own lastSignInTime (v18.96). Rendered as its
        // own section, NOT merged into the numbers above, because it measures something different:
        // sign-ins rather than activity. Appended asynchronously and independently — it is a second
        // network call to a Cloud Function, and it must never delay or break the card that already
        // has its data.
        _appendSignInSection(content);

        // Which ADDRESS is each account on (v19.23) — the migration picture while the app is served
        // from both myb-roster.web.app and the GitHub Pages mirror.
        _appendOriginSection(content, stats.origins || []);

        // Page popularity — This month / Last month toggle (trend; stable early in a month).
        let popActive = 'this';
        const popToggle = document.createElement('div');
        popToggle.className = 'speed-toggle';
        popToggle.setAttribute('role', 'group');
        popToggle.setAttribute('aria-label', 'Time window');
        const heading = document.createElement('p');
        heading.className = 'usage-section-label';
        const popBody = document.createElement('div');

        /** Build one bar list (page views or opens). Both groups share ONE scale (`max`)
         * so a document opened once shows a proportional sliver, not a full-width bar as
         * long as the busiest page — bar length stays honest across the whole card.
         * @param {Array<{page:string,count:number}>} items @param {Record<string,{emoji:string,label:string}>} metaMap @param {number} max */
        const _bars = (items, metaMap, max) => {
            const list = document.createElement('div');
            list.className = 'usage-bars';
            items.forEach(({ page, count }) => {
                const meta  = metaMap[page];
                const emoji = meta ? meta.emoji : '📄';
                // Known labels are static/safe; an unknown page key (a tampered client
                // could write one) is escaped before it reaches innerHTML.
                const label = meta ? meta.label : escapeHtml(page);
                const pct   = Math.max(4, Math.round((count / max) * 100));
                const row = document.createElement('div');
                row.className = 'usage-bar-row';
                row.innerHTML =
                    // `title` so a truncated label is still recoverable. "Weekly Retail Circular"
                    // ellipsises at 390px and must NOT be shortened — it is a canonical staff-facing
                    // term (CLAUDE.md wording conventions), so the name stays and the tooltip carries it.
                    `<span class="usage-bar-label" title="${label}"><span aria-hidden="true">${emoji}</span> ${label}</span>` +
                    `<span class="usage-bar-track"><span class="usage-bar-fill" style="width:${pct}%"></span></span>` +
                    `<span class="usage-bar-count">${count.toLocaleString('en-GB')}</span>`;
                list.appendChild(row);
            });
            return list;
        };

        const renderPop = () => {
            const all   = popActive === 'this' ? stats.pageCounts : stats.prevPageCounts;
            const month = popActive === 'this' ? stats.month : stats.prevMonth;
            // Split the shared counts map: page views vs document/guide opens (v18.20).
            const counts = all.filter(c => !OPEN_META[c.page]);
            const opens  = all.filter(c => OPEN_META[c.page]);
            // Emoji + label on every section heading — the card had four different patterns
            // (none / bare / emoji / bare-with-date), which is what made the sections read as a
            // pile rather than a sequence.
            // NOT \u{1F4CA} — that is the Usage card's OWN header icon, and a section should not
            // wear its parent's identity. \u{1F440} says what the number is: what gets looked at.
            heading.innerHTML = '<span aria-hidden="true">\u{1F440}</span> Page popularity — '
                + _usageMonthLabel(month);
            popBody.innerHTML = '';
            if (!counts.length && !opens.length) {
                const none = document.createElement('p');
                none.className = 'auth-desc';
                none.textContent = popActive === 'this'
                    ? 'No page views recorded yet this month.'
                    : 'No page views recorded last month.';
                popBody.appendChild(none);
                return;
            }
            // One shared scale across both groups (busiest count anywhere on the card).
            const scaleMax = Math.max(counts[0]?.count || 0, opens[0]?.count || 0) || 1;
            if (counts.length) popBody.appendChild(_bars(counts, PAGE_META, scaleMax));
            if (opens.length) {
                const openLbl = document.createElement('p');
                openLbl.className = 'usage-section-label usage-section-label--sub';
                openLbl.innerHTML = '<span aria-hidden="true">\u{1F4C4}</span> Documents &amp; guides — opens';
                popBody.appendChild(openLbl);
                popBody.appendChild(_bars(opens, OPEN_META, scaleMax));
            }
        };

        [['this', 'This month'], ['last', 'Last month']].forEach(([key, label]) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'speed-toggle-btn' + (key === popActive ? ' speed-toggle-btn--on' : '');
            btn.textContent = label;
            btn.setAttribute('aria-pressed', String(key === popActive));
            btn.addEventListener('click', () => {
                if (popActive === key) return;
                popActive = key;
                popToggle.querySelectorAll('.speed-toggle-btn').forEach((b, i) => {
                    const on = (i === 0 ? 'this' : 'last') === popActive;
                    b.classList.toggle('speed-toggle-btn--on', on);
                    b.setAttribute('aria-pressed', String(on));
                });
                renderPop();
            });
            popToggle.appendChild(btn);
        });

        // Heading FIRST, then its toggle. Appended the other way round, the "This month / Last
        // month" buttons sat above the only text that says what they filter — so they read as
        // controlling whatever section happened to precede them.
        content.appendChild(heading);
        content.appendChild(popToggle);
        content.appendChild(popBody);
        renderPop();

        const note = document.createElement('p');
        note.className = 'usage-note';
        note.textContent = PRIVACY_FOOTER;
        content.appendChild(note);

    } catch (e) {
        console.error('[Usage]', e);
        _cardLoadError(content, 'Couldn\'t load usage — check your connection.', initUsageCard);
    } finally {
        content.removeAttribute('aria-busy');
    }
}

/** Short labels for the addresses the app is served from, each with the text that says what it
 *  actually IS. `other` is deliberately vague — it is localhost and anything not yet named, and
 *  naming it precisely would imply we know what it is. */
/** @type {Record<string, {emoji: string, label: string, explain: string}>} */
// Labels kept SHORT so these rows can share the same label column as every other bar group in the
// card (38%). The v19.24 fix widened this section to 47% to stop "GitHub Pages mirror" truncating at
// 390px — which cured the truncation and left the three bar groups no longer lining up with each
// other, a worse kind of untidy.
//
// v19.29 — but a short label needs its meaning somewhere VISIBLE, and a `title` tooltip is not that.
// The owner, who owns both addresses, could not tell what the `web.app` row meant: a title needs a
// hover, and this card is read on a phone, so the one thing explaining these rows was unreachable on
// the device they are read on. `explain` is now rendered as a KEY under the bars (and still feeds the
// desktop title, but nothing depends on that). Every row gets a line, `elsewhere` included — it is
// the least self-explanatory label of the four, so omitting it would leave the same gap in miniature.
const ORIGIN_META = {
    web:   { emoji: '\u2705', label: 'web.app', explain: 'myb-roster.web.app' },
    pages: { emoji: '\u{1F4E6}', label: 'GitHub Pages', explain: 'garethdavidmiller.github.io/roster-app/' },
    fb:    { emoji: '\u{1F517}', label: 'firebaseapp', explain: 'myb-roster.firebaseapp.com' },
    other: { emoji: '\u2753', label: 'elsewhere', explain: 'localhost, or an address not recognised' },
};

/**
 * Render the migration picture: unique accounts per address over the last 30 days, and how many of
 * them opened the INSTALLED app rather than a browser tab.
 *
 * Deliberately states what it CANNOT see. The counters record opens, so an install that nobody has
 * opened in 30 days is invisible — and those are exactly the people a migration strands, which makes
 * the caveat load-bearing rather than boilerplate.
 *
 * @param {HTMLElement} content
 * @param {Array<{origin:string,accounts:number,installed:number}>} rows
 */
function _appendOriginSection(content, rows) {
    // Its own wrapper with a rule top AND bottom, exactly as `.usage-signin` does. Without the
    // bottom rule the Page-popularity "This month / Last month" toggle sits directly under this
    // section's note and reads as though it filters the ADDRESSES — the toggle's own heading is
    // below it, so nothing else says otherwise.
    const sec = document.createElement('div');
    sec.className = 'usage-origins';
    content.appendChild(sec);

    const label = document.createElement('p');
    label.className = 'usage-section-label';
    label.innerHTML = '<span aria-hidden="true">\u{1F6A6}</span> Which address staff are on';
    sec.appendChild(label);

    if (!rows.length) {
        const empty = document.createElement('p');
        empty.className = 'usage-note';
        // Says it is a STATE, not a fault, and when to look again. The old wording named the
        // version it shipped in, which is developer-speak in user-facing copy and goes stale —
        // in six months "after v19.23" tells the reader nothing at all.
        empty.textContent = 'No opens recorded yet. This fills in as staff open the app, and reads '
            + 'properly once it has a full 30 days.';
        sec.appendChild(empty);
        return;
    }

    const total = rows.reduce((n, r) => n + r.accounts, 0);
    const bars = document.createElement('div');
    bars.className = 'usage-bars';
    rows.forEach(({ origin, accounts, installed }) => {
        const meta = ORIGIN_META[origin] || ORIGIN_META.other;
        const pct  = total ? Math.round((accounts / total) * 100) : 0;
        const row  = document.createElement('div');
        row.className = 'usage-bar-row';
        const name = document.createElement('span');
        name.className = 'usage-bar-label';
        name.textContent = `${meta.emoji} ${meta.label}`;
        name.title = meta.explain;
        // A STACKED bar, not a longer count column. "22 · 17 installed" made this the only group in
        // the card whose count column was wide enough to shorten the tracks, so its bars no longer
        // lined up with the ones above and below. Nesting the installed share inside the accounts
        // share says the same thing — and says the RELATIONSHIP, which the text could not: installed
        // is a subset of these accounts, never a second population.
        const track = document.createElement('span');
        track.className = 'usage-bar-track';
        const fill = document.createElement('span');
        fill.className = 'usage-origin-fill';
        fill.style.width = `${Math.max(pct, accounts ? 2 : 0)}%`;
        const inner = document.createElement('span');
        inner.className = 'usage-origin-installed';
        inner.style.width = `${accounts ? Math.round((installed / accounts) * 100) : 0}%`;
        fill.appendChild(inner);
        track.appendChild(fill);
        const num = document.createElement('span');
        num.className = 'usage-bar-count';
        num.textContent = String(accounts);
        row.append(name, track, num);
        bars.appendChild(row);
    });
    sec.appendChild(bars);

    const legend = document.createElement('p');
    legend.className = 'usage-origin-legend';
    legend.innerHTML = '<span class="usage-origin-key usage-origin-key--installed"></span> opened from the installed app'
        + '<span class="usage-origin-key usage-origin-key--browser"></span> browser tab';
    sec.appendChild(legend);

    // The KEY (v19.29). Built from the rows actually SHOWN, in bar order, one line each — so it
    // never names an address nobody is on, and the eye can map each line back onto its bar. A
    // run-on sentence ("web.app is X, GitHub Pages is Y") is the shape that cannot be mapped back.
    const key  = document.createElement('ul');
    const seen = new Set();
    key.className = 'usage-origin-addr';
    rows.forEach(({ origin }) => {
        const meta = ORIGIN_META[origin] || ORIGIN_META.other;
        if (seen.has(meta.label)) return;
        seen.add(meta.label);
        const li = document.createElement('li');
        const name = document.createElement('b');
        name.textContent = meta.label;
        li.append(name, ` \u2014 ${meta.explain}`);
        key.appendChild(li);
    });
    sec.appendChild(key);

    const note = document.createElement('p');
    note.className = 'usage-note';
    // "Unique accounts" was too strong (v19.86, external review P2) and this figure is the one most
    // likely to be acted on — it is the evidence for deciding an old address can be retired, and a
    // count that reads as exact invites retiring one while staff are still on it. Deduplication is
    // a localStorage flag per identity per origin, so one person on two devices counts twice,
    // clearing browser data allows another count, a shared device counts each member picked, and
    // somebody using both addresses appears in both bars — which is what half-migrated looks like
    // and is exactly why the figure must not claim to be a headcount. The EXACT unique count is a
    // different measure altogether and sits in its own section below, from Firebase Auth.
    note.textContent = 'Account-device signals over the last 30 days — directional, not an exact headcount. '
        + 'One person can count on more than one device or address.';
    sec.appendChild(note);
}

/**
 * Append the EXACT unique-account sign-in figures (v18.96) to the Usage card.
 *
 * Deliberately its own section rather than more numbers in the row above, because it answers a
 * different question. The figures above count ACTIVITY, deduped per device; these count distinct
 * accounts that have SIGNED IN, which Firebase Auth already tracks exactly. Both are true and
 * neither replaces the other, so the card says which is which rather than picking one.
 *
 * Runs detached and swallows its own failure: it is a second network call (a Cloud Function, not
 * Firestore) hanging off a card that already has everything else it needs. A slow or failed call
 * must degrade to "this section is absent", never to a failed Usage card — so this is intentionally
 * NOT awaited by initUsageCard and never calls _cardLoadError.
 *
 * @param {HTMLElement} content
 * @returns {void}
 */
function _appendSignInSection(content) {
    const wrap = document.createElement('div');
    wrap.className = 'usage-signin';
    content.appendChild(wrap);

    getSignInStats().then(s => {
        // Guard against a re-render finishing first (retry, or a second initUsageCard): if this
        // wrapper is no longer in the document, its card has been replaced — drop the result.
        if (!wrap.isConnected) return;
        const label = document.createElement('p');
        label.className = 'usage-section-label';
        label.innerHTML = '<span aria-hidden="true">\u{1F511}</span> Accounts that have signed in';
        const nums = document.createElement('div');
        nums.className = 'usage-stats';
        // Labels are terse ("last 30 days", not "in the last 30 days") because three stats share the
        // row: at 375px the longer form wrapped to three lines and left the boxes cramped. The
        // section heading above already supplies the verb. 💤 for never-signed-in reads as dormant
        // and stays legible at 12px — 🕳️ was tried first and renders as an illegible dark smudge.
        nums.innerHTML =
            `<div class="usage-stat"><span class="usage-stat-num">${s.last30}</span>` +
            `<span class="usage-stat-lbl"><span aria-hidden="true">🔑</span> last 30 days</span></div>` +
            `<div class="usage-stat"><span class="usage-stat-num">${s.last7}</span>` +
            `<span class="usage-stat-lbl"><span aria-hidden="true">📆</span> last 7 days</span></div>` +
            `<div class="usage-stat"><span class="usage-stat-num">${s.neverSignedIn}</span>` +
            `<span class="usage-stat-lbl"><span aria-hidden="true">💤</span> never signed in</span></div>`;
        const note = document.createElement('p');
        note.className = 'usage-note';
        // State the caveats rather than let the number be read as "active staff". Until v20.47 there
        // was a tidy relationship to lean on: sessions capped at 30 days, so a live session REQUIRED
        // a sign-in inside 30 days and this figure was a slight OVER-count of active people. **That
        // is no longer true and the direction has flipped** — at 60 days (`SESSION_MS`, session.js)
        // someone can sign in once and use the app daily for two months without ever re-entering
        // this window, so the count now misses active people as well as including stopped ones. It
        // is a sign-in count and nothing more, which is exactly what the visible note says; do not
        // re-add a claim about active staff in either direction unless the window is derived from
        // SESSION_MS. `neverSignedIn` is the actionable one: provisioned staff who may not know the
        // app exists.
        // "staff accounts", never "active accounts": THIS CARD already uses "active" for the
        // device-deduped activity figure directly above, so reusing the word here would make two
        // different numbers appear to measure the same thing.
        note.textContent =
            `Exact count across ${s.total} staff accounts — counts sign-ins, not opens.`;
        wrap.append(label, nums, note);
    }).catch(e => {
        // Silent by design — see the docstring. Logged for the developer only.
        console.error('[Usage] sign-in stats', e);
        wrap.remove();
    });
}
export { initUsageCard };
