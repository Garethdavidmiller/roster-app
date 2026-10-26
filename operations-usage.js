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
/** The last month whose page views include the reload an update triggers (v25.00 stopped counting it). */
const RELOADS_COUNTED_UNTIL = '2026-10';

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
        //
        // ── THE UNIT IS IN THE HEADING, AND THE LABELS ARE TIME WINDOWS (v25.00, Usage card review) ──
        // The two boxes said "member-devices this month" and "active in last 30 days" — one carrying
        // the unit and the other a different word, so they read as two measures. Both now name only
        // their window, as the sign-in boxes below already did, under a heading that names the unit
        // once. Last month's full figure sits beside this month's, named by its month so it cannot be
        // confused with "last 30 days": early in a month it is the only thing that says whether a
        // small number is small. Absent when there is no last month on record.
        content.appendChild(_sectionHeading('\u{1F465}', 'Roster in use — member-devices'));
        const prevMonthCount = Number((stats.monthsHistory || {})[stats.prevMonth]) || 0;
        const accounts = document.createElement('div');
        accounts.className = 'usage-stats';
        accounts.append(_stat(stats.accountsThisMonth, 'this month'));
        if (prevMonthCount) {
            const prev = _stat(prevMonthCount, `in ${_monthName(stats.prevMonth)}`);
            prev.classList.add('usage-stat--context');
            accounts.appendChild(prev);
        }
        accounts.appendChild(_stat(stats.accountsLast30, 'last 30 days'));
        content.appendChild(accounts);
        // No note here. "One person on a phone and a laptop counts twice… a trend, not a headcount"
        // is the card's own ? panel, and four blocks of dense grey micro-copy was most of what made
        // this card read as cluttered. The ? exists precisely for the standing caveats.

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
        const heading = _sectionHeading('\u{1F440}', 'Page popularity', true);
        const headingText = /** @type {HTMLElement} */ (heading.lastElementChild);
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
                    // The label WRAPS rather than ellipsising (v23.52 — `.usage-bar-label` in
                    // operations.css says why). "Weekly Retail Circular" must NOT be shortened — it
                    // is a canonical staff-facing term (CLAUDE.md wording conventions) — and the
                    // `title` that used to recover it when cut went with every other tooltip at
                    // v23.50, so the name has to fit on the row itself.
                    `<span class="usage-bar-label"><span aria-hidden="true">${emoji}</span> ${label}</span>` +
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
            headingText.textContent = `Page popularity — ${_usageMonthLabel(month)}`;
            popBody.innerHTML = '';
            if (!counts.length && !opens.length) {
                const none = document.createElement('p');
                none.className = 'usage-empty';
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
                // One rank down — the opens share Page popularity's month and its scale.
                const openLbl = document.createElement('h4');
                openLbl.className = 'speed-subhead speed-subhead--sub speed-subhead--rule';
                openLbl.innerHTML = '<span aria-hidden="true">\u{1F4C4}</span> <span>Documents &amp; guides — opens</span>';
                popBody.appendChild(openLbl);
                popBody.appendChild(_bars(opens, OPEN_META, scaleMax));
            }
            // A month counted the older way says so, and the note retires itself: once both months
            // the toggle can show are later than the change, nothing here names it any more.
            if (month <= RELOADS_COUNTED_UNTIL) {
                const was = document.createElement('p');
                was.className = 'usage-note';
                was.textContent = 'Until late October 2026 this also counted the reload the app does by itself after '
                    + 'an update — about one Calendar open in seven — so these figures run a little higher than they would now.';
                popBody.appendChild(was);
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

/**
 * A section heading: an `h3` under the card's `h2`, the same class the App Speed card's sections
 * wear, so the two reporting cards share one rank and one look. They were `<p>` labels until v25.00,
 * so a screen-reader user could not move between the sections of the longest card on the page.
 * The label is its own span, so a heading that changes (the month) can be re-written without
 * re-parsing HTML.
 * @param {string} emoji @param {string} label @param {boolean} [rule] a divider above — every section but the first
 * @returns {HTMLHeadingElement}
 */
function _sectionHeading(emoji, label, rule = false) {
    const h = document.createElement('h3');
    h.className = 'speed-subhead' + (rule ? ' speed-subhead--rule' : '');
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = emoji;
    const text = document.createElement('span');
    text.textContent = label;
    h.append(icon, text);
    return h;
}

/**
 * One figure box. No emoji in the label (v25.00): the section heading already carries one, and two
 * per box made five small pictures compete with the numbers they sit under.
 * @param {number|string} num @param {string} label
 * @returns {HTMLDivElement}
 */
function _stat(num, label) {
    const box = document.createElement('div');
    box.className = 'usage-stat';
    const n = document.createElement('span');
    n.className = 'usage-stat-num';
    n.textContent = typeof num === 'number' ? num.toLocaleString('en-GB') : num;
    const l = document.createElement('span');
    l.className = 'usage-stat-lbl';
    l.textContent = label;
    box.append(n, l);
    return box;
}

/** "September" for '2026-09' — the month alone, for a line too narrow for the year. @param {string} ym */
function _monthName(ym) {
    const [y, m] = String(ym).split('-').map(Number);
    if (!y || !m) return ym;
    return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'long' });
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
    // Its own wrapper, headed like every section after the first: a rule ABOVE the heading (v25.00).
    // The rule used to be the wrapper's, top and bottom, because the Page-popularity toggle once sat
    // above its own heading and read as filtering the addresses; that heading now leads its section
    // with a rule of its own, so one divider between two sections is drawn once, not twice.
    const sec = document.createElement('div');
    sec.className = 'usage-origins';
    content.appendChild(sec);

    sec.appendChild(_sectionHeading('\u{1F6A6}', 'Which address staff are on', true));

    if (!rows.length) {
        const empty = document.createElement('p');
        empty.className = 'usage-empty';
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
    // Each swatch and its words are ONE item (v25.00), as on the App Speed legend. As loose siblings in
    // a flex row they were spaced alike, so the browser-tab swatch sat as close to "installed app" as
    // to its own label, and the eye could pair either way.
    legend.innerHTML = '<span class="speed-legend-item"><span class="usage-origin-key usage-origin-key--installed"></span>opened from the installed app</span>'
        + '<span class="speed-legend-item"><span class="usage-origin-key usage-origin-key--browser"></span>browser tab</span>';
    sec.appendChild(legend);

    // THE INSTALLED FIGURE AS A NUMBER (v25.00). The stacked bar shows the share and nothing else,
    // and "how many have installed it on the old address" is the question this section exists for —
    // those are the people a retired address strands. One line, in bar order, so the count column
    // stays as narrow as every other bar group's.
    const inst = document.createElement('p');
    inst.className = 'usage-origin-installed-count';
    inst.append('From the installed app: ');
    rows.forEach(({ origin, accounts, installed }, i) => {
        const meta = ORIGIN_META[origin] || ORIGIN_META.other;
        const part = document.createElement('span');
        part.className = 'speed-nowrap';
        const where = meta === ORIGIN_META.other ? meta.label : `on ${meta.label}`;
        part.textContent = `${installed} of ${accounts} ${where}${i < rows.length - 1 ? ',' : ''}`;
        inst.append(part, i < rows.length - 1 ? ' ' : '');
    });
    sec.appendChild(inst);

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
    note.textContent = 'Member-devices over the last 30 days — a direction, not a headcount. '
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
    // A PLACEHOLDER, NOT A HOLE (v25.00). The section used to appear only when the Cloud Function
    // answered — a second or more on a cold start — and arrive ABOVE two sections the admin may
    // already be reading, pushing them down the screen. It now holds its place from the start:
    // the heading and three boxes with a dash, and the figures land in them. A failure still
    // removes the whole section, which is rare and is the jump this cannot avoid.
    wrap.setAttribute('aria-busy', 'true');
    wrap.appendChild(_sectionHeading('\u{1F511}', 'Accounts that have signed in', true));
    const nums = document.createElement('div');
    nums.className = 'usage-stats';
    // Labels are terse ("last 30 days", not "in the last 30 days") because three stats share the
    // row: at 375px the longer form wrapped to three lines and left the boxes cramped. The section
    // heading above already supplies the verb.
    const boxes = [_stat('—', 'last 30 days'), _stat('—', 'last 7 days'), _stat('—', 'never signed in')];
    nums.append(...boxes);
    const note = document.createElement('p');
    note.className = 'usage-note';
    // Close in length to the sentence that replaces it, so the section does not change height when
    // the figures land; the dashes and `aria-busy` are what say it is still loading.
    note.textContent = 'Exact count from Firebase — counts sign-ins, not opens.';
    wrap.append(nums, note);
    content.appendChild(wrap);

    getSignInStats().then(s => {
        // Guard against a re-render finishing first (retry, or a second initUsageCard): if this
        // wrapper is no longer in the document, its card has been replaced — drop the result.
        if (!wrap.isConnected) return;
        [s.last30, s.last7, s.neverSignedIn].forEach((v, i) => {
            const n = boxes[i].querySelector('.usage-stat-num');
            if (n) n.textContent = Number(v).toLocaleString('en-GB');
        });
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
        wrap.removeAttribute('aria-busy');
    }).catch(e => {
        // Silent by design — see the docstring. Logged for the developer only.
        console.error('[Usage] sign-in stats', e);
        wrap.remove();
    });
}
export { initUsageCard };
