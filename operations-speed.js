// @ts-check
/**
 * operations-speed.js — the App Speed card on operations.html (Project 0 latency).
 *
 * One of the three reporting cards split out of operations-reports.js at v21.32 — see that
 * module's header for why. It awaits `sessionReady`, reads Firestore, and renders into its own
 * card by id; it touches no coordinator state and no other card.
 *
 * ── WHAT IT SHOWS, AND WHAT IT STOPPED SHOWING (App Speed review, Oct 2026) ──────────────────────
 *
 * Three sections: Signing in; Opening pages — three moments, then each page's bars; and a closer
 * look at the busiest page — the stored copy of a member's own roster, the wait after a release, and
 * "Usable" by app version and by how the page was opened. Those four have a live question behind
 * them. Everything else the old "Why some are slower" section carried (the boot stages, the start
 * ladder, the saved-copy/server split, the retired fast path, the service worker's file count and
 * the connection comparisons) served the sign-in speed investigation `LATENCY.md` closed on 19
 * September, and went — with its writes (perf-reporter.js), except the connection class, which is
 * part of every sample's key rather than a write of its own. It was about two thirds of the card.
 *
 * ── FOUR RULES EVERY FIGURE KEEPS ─────────────────────────────────────────────────────────────────
 *
 *   · A NUMBER SAYS WHAT IT IS. The big figure on each panel is the share that was QUICK, while its
 *     colour comes from the slow share — so it carries the word "quick" under it. A red "46%" was
 *     read as "46% bad", by the author of a review of this card among others.
 *   · NOTHING IN COLOUR ALONE. The slow segment is striped as well as red (operations.css), and every
 *     bar's figures are in its label: to red-green colour blindness the green and the red are close.
 *   · AN EXPLANATION IS ON SCREEN. A row's one-line description is drawn beneath it. Until Oct 2026 it
 *     went into the screen-reader label alone, and a sighted reader met bare labels.
 *   · A SHARE NEVER ROUNDS TO A LIE. A real share under 1% reads "<1%", not "0%"; one short of the
 *     whole reads ">99%", not "100%" (`compactPct`).
 */
import { sessionReady } from './session.js';
import { withClaimRetry, getPerfStats } from './firebase-client.js';
import {
    SPEED_GROUPS, perfVerdict, summarisePerfBy, PERF_DIMENSIONS, summariseEarlyRoster, earlyRosterShareLabel,
    summariseUpdateOpens, UPDATE_OPENS_FROM, CLEAN_TIMINGS_FROM, shareMeasuredBefore, perfRecordFullness,
    compactPct, THIN_SAMPLE,
} from './perf-stats.js';
import { escapeHtml } from './roster-data.js';
import { PRIVACY_FOOTER, PAGE_META, _cardLoadError, _usageMonthLabel } from './operations-reports.js';

/** @typedef {{ quick: number, ok: number, slow: number, total: number, pctQuick: number, pctOk: number, pctSlow: number }} Bands */
/** @typedef {Bands & { label: string, sub?: string }} BandRow */

/**
 * The three moments a page open passes, in the order they happen. "Usable" is the one to read as how
 * fast the app is: "First appears" is the loading screen painting on the Calendar, and "Code loaded"
 * fires while the Calendar can still be blank — it waits on the access decision, which is
 * asynchronous and lands after DOMContentLoaded (v20.80). Each says so in a line under its heading.
 */
const MOMENTS = /** @type {const} */ ([
    { key: 'fcp',   emoji: '✨', label: 'First appears', explain: 'Something is on screen — on the Calendar, the loading screen.' },
    { key: 'pages', emoji: '📦', label: 'Code loaded',   explain: 'The app’s code has run. The page can still be filling in.' },
    { key: 'ready', emoji: '✅', label: 'Usable',        explain: 'The page’s own content is on screen and ready to use — the one to read as how fast the app is.' },
]);

// ── App speed card (Project 0 latency, surfaced in plain language) ──────────────
async function initPageSpeedCard() {
    const content = document.getElementById('pageSpeedContent');
    if (!content) return;

    // `thin` renders like `none` — neutral, no colour verdict. The percentage is still shown; it
    // is the CLAIM that is withheld, not the number.
    const TONE_CLASS = { good: 'good', ok: 'ok', bad: 'bad', none: 'none', thin: 'none' };

    /** "46% quick, 40% a moment, 14% slow" — every bar's label, in the card's own words. @param {Bands} b */
    const bandWords = (b) =>
        `${compactPct(b.pctQuick, b.quick, b.total)} quick, ${compactPct(b.pctOk, b.ok, b.total)} a moment, ${compactPct(b.pctSlow, b.slow, b.total)} slow`;

    /** The share over a second — the complement of quick, so every column reads bad-when-high. @param {Bands} b */
    const over1s = (b) => compactPct(100 - b.pctQuick, b.ok + b.slow, b.total);

    /** width:% segments (good/ok/slow) from a band row. @param {Bands} b */
    const segs = (b) => {
        if (!b.total) return '';
        const w = (/** @type {number} */ n) => (n / b.total) * 100;
        return `<span class="speed-seg speed-seg--good" style="width:${w(b.quick)}%"></span>` +
               `<span class="speed-seg speed-seg--ok"   style="width:${w(b.ok)}%"></span>` +
               `<span class="speed-seg speed-seg--bad"  style="width:${w(b.slow)}%"></span>`;
    };

    /** A section heading — 🔑 Signing in, 📄 Opening pages, 🔍 A closer look. An `h3` under the card's
     *  `h2`, so a screen-reader user can move between the sections of a long card; they were
     *  paragraphs until Oct 2026. `rule` draws a divider above, as the Usage card separates its
     *  groups. @param {string} emoji @param {string} label trusted HTML @param {boolean} [rule] */
    const sectionHeading = (emoji, label, rule = false) => {
        const h = document.createElement('h3');
        h.className = 'speed-subhead' + (rule ? ' speed-subhead--rule' : '');
        h.innerHTML = `<span aria-hidden="true">${emoji}</span> ${label}`;
        return h;
    };
    /** A heading one rank down: the three moments and "By page" under Opening pages. One builder for
     *  this rank on purpose — "By page" spent three releases at the section rank, announcing itself as
     *  a peer of its own parent, because it was assembled by hand. @param {string} emoji @param {string} label */
    const subHeading = (emoji, label) => {
        const h = document.createElement('h4');
        h.className = 'speed-subhead speed-subhead--sub';
        h.innerHTML = `<span aria-hidden="true">${emoji}</span> ${label}`;
        return h;
    };
    /** A block's label inside "A closer look" — the same rank as `subHeading`, drawn as an eyebrow.
     *  @param {string} text */
    const blockHeading = (text) => {
        const h = document.createElement('h4');
        h.className = 'usage-section-label speed-dim-label';
        h.textContent = text;
        return h;
    };
    /** A small muted framing line. @param {string} text */
    const noteLine = (text) => {
        const p = document.createElement('p');
        p.className = 'speed-note';
        p.textContent = text;
        return p;
    };

    /** A full-width band bar under a headline, so a proportion can be compared as a shape — and so
     *  the middle band, which no single number states, is visible at all. @param {Bands} b */
    const overallBar = (b) => {
        const wrap = document.createElement('div');
        wrap.className = 'speed-bar speed-bar--overall';
        wrap.setAttribute('role', 'img');
        wrap.setAttribute('aria-label', bandWords(b));
        wrap.innerHTML = segs(b);
        return wrap;
    };
    /** The shared colour key — every bar on the card uses these three bands. */
    const legendEl = () => {
        const legend = document.createElement('div');
        legend.className = 'speed-legend';
        legend.innerHTML = /** @type {Array<'quick'|'ok'|'slow'>} */ (['quick', 'ok', 'slow']).map(g => {
            const grp = SPEED_GROUPS[g];
            return `<span class="speed-legend-item"><span class="speed-dot speed-dot--${grp.tone}"></span>${grp.label} <span class="speed-legend-sub">${grp.sub}</span></span>`;
        }).join('');
        return legend;
    };
    /** A toned verdict panel: the big quick share, a plain sentence, and all three bands in words.
     *  @param {{tone:'good'|'ok'|'bad'|'none'|'thin', text:string}} verdict
     *  @param {Bands} overall @param {number} total @param {string} unit
     *  @param {string} windowLabel "this month" / "last month"
     *  @param {boolean} [fillHint] an empty panel says the month "fills in" — once per card, not on
     *         every empty panel, which printed the same sentence four times on the 1st of the month */
    const verdictBanner = (verdict, overall, total, unit, windowLabel, fillHint = false) => {
        const div = document.createElement('div');
        div.className = `speed-verdict speed-verdict--${TONE_CLASS[verdict.tone]}`;
        // NO "(few)" MARKER HERE, deliberately — `perfVerdict` already returns a whole sentence
        // saying it ("Too few sign-ins to read as a trend"), directly above this line.
        // ALL THREE BANDS, not just the headline one (v21.71): the panel's COLOUR is driven by the
        // slow share and its big number by the quick share, so naming the split removes the
        // ambiguity at the point it arises, which no legend further up the card can do.
        // EACH FIGURE WRAPS WHOLE (polish pass, Oct 2026). On a phone this line ran into a leading
        // "· 1,859 page opens" and split "this / month" at 320px; each figure now carries its own "·"
        // and breaks only between figures, and the count takes a line of its own below 480px
        // (`.speed-verdict-count`), where it is a different kind of number from the split.
        const nowrap = (/** @type {string} */ t) => `<span class="speed-nowrap">${escapeHtml(t)}</span>`;
        const sub = total
            ? [`${compactPct(overall.pctQuick, overall.quick, total)} under 1s ·`,
               `${compactPct(overall.pctOk, overall.ok, total)} 1–3s ·`,
               `${compactPct(overall.pctSlow, overall.slow, total)} over 3s`].map(nowrap).join(' ')
              + `<span class="speed-verdict-count"><span class="speed-sep"> · </span>${nowrap(`${total.toLocaleString('en-GB')} ${unit} ${windowLabel}`)}</span>`
            : (fillHint ? escapeHtml('Fills in as staff use the app over the coming days.') : '');
        // The WORD under the number (App Speed review, Oct 2026). A red "46%" read as "46% bad"; it
        // is 46% QUICK, under a panel coloured by how many were slow.
        const num = total
            ? `<span class="speed-verdict-figure">${escapeHtml(compactPct(overall.pctQuick, overall.quick, total))}</span>`
              + '<span class="speed-verdict-cap">quick</span>'
            : '—';
        div.innerHTML =
            `<span class="speed-verdict-num">${num}</span>` +
            `<span class="speed-verdict-text">${escapeHtml(verdict.text)}`
                + (sub ? `<span class="speed-verdict-sub">${sub}</span>` : '') + '</span>';
        return div;
    };

    /** A row of column labels over a list. Hidden from screen readers: each figure below carries its
     *  own words instead, because a header is not associated with the cells under it here.
     *  @param {string} rowClass @param {string[]} labels '' for an unlabelled column */
    const columnHead = (rowClass, labels) => {
        const head = document.createElement('div');
        head.className = `speed-row ${rowClass} speed-dual-head`;
        head.setAttribute('aria-hidden', 'true');
        head.innerHTML = labels.map(l => l ? `<span class="speed-dual-label">${l}</span>` : '<span></span>').join('');
        return head;
    };

    /** One row: the label (with "(few)" on a thin one), the bar, the share over a second, how many
     *  opens it rests on — bold for the finding, muted for the sample size — and, when the row has
     *  one, its explanation on a line of its own beneath. @param {BandRow} r */
    const barRow = (r) => {
        const row = document.createElement('div');
        row.className = 'speed-row speed-row--why';
        row.innerHTML =
            `<span class="speed-row-label"><span class="speed-row-name">${escapeHtml(r.label)}</span>`
                + `${r.total < THIN_SAMPLE ? '<span class="speed-thin">(few)</span>' : ''}</span>` +
            `<span class="speed-bar" role="img" aria-label="${escapeHtml(bandWords(r))}">${segs(r)}</span>` +
            `<span class="speed-row-count">${escapeHtml(over1s(r))}<span class="visually-hidden"> over a second</span></span>` +
            `<span class="speed-row-sub">${r.total.toLocaleString('en-GB')}<span class="visually-hidden"> opens</span></span>` +
            (r.sub ? `<span class="speed-row-expl">${escapeHtml(r.sub)}</span>` : '');
        return row;
    };
    /** Rows under an "over 1s · opens" header — the complement of the headline, because every other
     *  number in the section is bad-when-high. @param {BandRow[]} rows */
    const rowList = (rows) => {
        const list = document.createElement('div');
        list.className = 'speed-rows';
        list.appendChild(columnHead('speed-row--why', ['', '', 'over 1s', 'opens']));
        rows.forEach(r => list.appendChild(barRow(r)));
        return list;
    };

    /** Each page's three moments side by side, so one page's stages scan against every other's
     *  (v20.80).
     *
     *  EACH BAR ANSWERS FOR ITSELF (App Speed review, Oct 2026). The row's "(few)" came from the
     *  code-loaded count, so a Usable bar built from 6 opens beside 500 code-loaded ones wore no
     *  marker and read as a finding; and a page with no figure for a moment drew an empty track,
     *  which reads as 0%. Now a thin bar carries "(few)" beneath it and its label names its own
     *  count, and every missing moment is a dash. The "opens" column is the page's code-loaded
     *  count: every watched open records that moment.
     *  @param {Array<any>} fcpByPage @param {Array<any>} pagesByPage @param {Array<any>} readyByPage @param {string} month */
    const byPageRows = (fcpByPage, pagesByPage, readyByPage, month) => {
        const frag = document.createDocumentFragment();
        frag.appendChild(subHeading('📑', `By page — ${_usageMonthLabel(month)}`));

        const fcpMap   = new Map(fcpByPage.map(p => [p.page, p]));
        const pagesMap = new Map(pagesByPage.map(p => [p.page, p]));
        const readyMap = new Map((readyByPage || []).map(p => [p.page, p]));
        const allPages = [...new Set([...pagesMap.keys(), ...fcpMap.keys(), ...readyMap.keys()])]
            .sort((a, b) => (pagesMap.get(b)?.total || 0) - (pagesMap.get(a)?.total || 0)
                         || (fcpMap.get(b)?.total   || 0) - (fcpMap.get(a)?.total   || 0)
                         || a.localeCompare(b));

        /** One moment's cell. @param {any} b @param {string} name */
        const cell = (b, name) => {
            if (!b) return `<span class="speed-bar-none" role="img" aria-label="${name}: not reported">—</span>`;
            const thin = b.total < THIN_SAMPLE;
            const bar = `<span class="speed-bar" role="img" aria-label="${name}: ${escapeHtml(bandWords(b))}, `
                + `from ${b.total.toLocaleString('en-GB')} opens${thin ? ', too few to read into' : ''}">${segs(b)}</span>`;
            return thin ? `<span class="speed-cell">${bar}<span class="speed-cell-few" aria-hidden="true">(few)</span></span>` : bar;
        };

        const rows = document.createElement('div');
        rows.className = 'speed-rows';
        // One quantity, one word: every count on this card is an OPEN (v21.35). And the moments are
        // named as their headings name them, so "appears" and "First appears" are not two things.
        rows.appendChild(columnHead('speed-row--dual', ['', 'first appears', 'code loaded', 'usable', 'opens']));
        allPages.forEach(pg => {
            const meta  = PAGE_META[pg];
            const emoji = meta ? meta.emoji : '📄';
            // escapeHtml: the id is a sample key any signed-in session can write, and this is innerHTML.
            const label = meta ? meta.label : escapeHtml(pg);
            const f = fcpMap.get(pg);
            const r = pagesMap.get(pg);
            const u = readyMap.get(pg);
            const count = (r?.total) || (f?.total) || (u?.total) || 0;
            const row = document.createElement('div');
            row.className = 'speed-row speed-row--dual';
            row.innerHTML =
                `<span class="speed-row-label"><span class="speed-row-name"><span aria-hidden="true">${emoji}</span> ${label}</span></span>` +
                cell(f, 'first appears') + cell(r, 'code loaded') + cell(u, 'usable') +
                // MUTED, not bold navy (v21.34): the only number in the row is the sample size.
                `<span class="speed-row-sub">${count.toLocaleString('en-GB')}<span class="visually-hidden"> opens</span></span>`;
            rows.appendChild(row);
        });
        frag.appendChild(rows);
        return frag;
    };

    /** BEFORE THE SIGN-IN CHECK (v24.85) — when a member first sees their shifts, from the copy of
     *  their own roster kept on their phone (calendar-snapshot.js). "Usable" times the grid AFTER the
     *  check, so it cannot say whether the copy is doing its job; this row can, and the share says how
     *  often it had the chance. The share is against "Usable" on the versions that can record a copy
     *  (`earlyRosterShareLabel`) — every version's printed 19% for a true 60% in the month it shipped.
     *  @param {Record<string, number>} samples @param {string} page @param {string} windowLabel */
    const earlyRosterRows = (samples, page, windowLabel) => {
        const { rows } = summariseEarlyRoster(samples, { page });
        if (!rows.length) return null;
        const share = earlyRosterShareLabel(samples, { page });
        const frag = document.createDocumentFragment();
        frag.appendChild(blockHeading('Before the sign-in check'));
        frag.appendChild(noteLine(
            'A signed-in member sees their own roster straight away, from the copy kept on their phone, while the sign-in check runs. Timed only when there was a copy to show'
            // A no-break space before the dash, so a phone never starts a line with it (polish pass).
            + (share ? `\u00a0— ${share} of the opens counted under “Usable” ${windowLabel}, on versions that record it.` : '.')));
        frag.appendChild(rowList(rows));
        return frag;
    };

    /** AFTER A RELEASE (v22.92; the WAIT since Oct 2026). The Calendar reloads onto an update while
     *  nobody is looking, so the load itself kept nobody waiting; what is timed is the wait somebody
     *  then had (perf-reporter.js). Older versions timed the background load, so the block reads only
     *  from UPDATE_OPENS_FROM (`summariseUpdateOpens`) and says so. No share of the opens above: a
     *  reload nobody watched is not in "Usable", so the two counts are different populations.
     *  @param {Record<string, number>} samples @param {string} page */
    const updateOpenRows = (samples, page) => {
        const { rows } = summariseUpdateOpens(samples, { page });
        if (!rows.length) return null;
        const frag = document.createDocumentFragment();
        frag.appendChild(blockHeading('After a release'));
        frag.appendChild(noteLine(
            `When an update installs, the page reloads onto it — on the Calendar while nobody is looking, so nobody is interrupted mid-read. Counted from v${UPDATE_OPENS_FROM}.`));
        frag.appendChild(rowList(rows));
        return frag;
    };

    /** One page's "Usable" opens split by app version or by how the page was opened. Usable, not
     *  "Code loaded", since Oct 2026: the splits ran on code loading while their readers took them
     *  for the whole load, and LATENCY.md read "newer versions are slower" off rows that measured only
     *  the app's code arriving — which the fresh download after every update explains on its own.
     *  @param {Record<string, number>} samples @param {string} page @param {'mode'|'version'} dimension */
    const breakdownRows = (samples, page, dimension) => {
        const { rows } = summarisePerfBy(samples, { page, metric: 'ready', dimension, minSamples: THIN_SAMPLE, splitAt: CLEAN_TIMINGS_FROM });
        if (rows.length < 2) return null;   // one group explains nothing — it IS the page total
        const frag = document.createDocumentFragment();
        frag.appendChild(blockHeading(`${PERF_DIMENSIONS[dimension].label} — Usable`));
        // A version row never mixes the two ways of timing (`_bucketVersions`), but the rows either
        // side of the change still differ by method as well as by release, so the note says which.
        if (dimension === 'version' && rows.some(r => r.afterSplit) && rows.some(r => !r.afterSplit)) {
            frag.appendChild(noteLine(
                `From v${CLEAN_TIMINGS_FROM} the app leaves out loads nobody was watching and time spent typing, so those versions read faster for that reason as well. No row mixes the two.`));
        }
        frag.appendChild(rowList(rows));
        return frag;
    };

    /** A CLOSER LOOK at the page with the most opens — not hardcoded to the Calendar, which is what
     *  it is today: pinning an id would leave the section answering about the wrong page the first
     *  time that changes. Four readings, each with a live question (see the header); nothing renders
     *  when none has data. @param {Record<string, number>} samples @param {Array<any>} byPage @param {string} windowLabel */
    const closerLook = (samples, byPage, windowLabel) => {
        const busiest = byPage[0];
        if (!busiest || !busiest.total) return null;
        const blocks = [
            earlyRosterRows(samples, busiest.page, windowLabel),
            updateOpenRows(samples, busiest.page),
            breakdownRows(samples, busiest.page, 'version'),
            breakdownRows(samples, busiest.page, 'mode'),
        ].filter(Boolean);
        if (!blocks.length) return null;
        const meta = PAGE_META[busiest.page];
        const frag = document.createDocumentFragment();
        // escapeHtml: the id is a sample key any signed-in session can write, and the heading is innerHTML.
        frag.appendChild(sectionHeading('🔍', `A closer look — ${meta ? meta.emoji + ' ' + meta.label : escapeHtml(busiest.page)}`, true));
        frag.appendChild(noteLine(`The busiest page, with ${busiest.total.toLocaleString('en-GB')} opens ${windowLabel}.`));
        blocks.forEach(b => frag.appendChild(/** @type {DocumentFragment} */ (b)));
        return frag;
    };

    /** THE MONTH THE MEASUREMENT CHANGED. From CLEAN_TIMINGS_FROM a load nobody watched and time spent
     *  typing are left out (perf-reporter.js); older versions counted both. A month timed wholly or
     *  partly the older way says so, rather than letting the change read as the app getting faster.
     *  A month with under 5% of its opens from older versions is not marked.
     *  @param {Record<string, number>} samples @param {string} windowLabel */
    const timingNote = (samples, windowLabel) => {
        const before = shareMeasuredBefore(samples, CLEAN_TIMINGS_FROM);
        if (before < 0.05) return null;
        const p = document.createElement('p');
        p.className = 'speed-note speed-note--transition';
        p.innerHTML = before >= 0.95
            ? `<strong>Timed the older way.</strong> Before v${CLEAN_TIMINGS_FROM} the app also counted loads nobody was watching, and time spent typing a password or the staff PIN. Later figures leave both out, so they will read faster for that reason alone.`
            : `<strong>Two ways of timing ${windowLabel}.</strong> From v${CLEAN_TIMINGS_FROM} the app leaves out loads nobody was watching and time spent typing a password or the staff PIN. ${Math.round(before * 100)}% of these opens were timed the older way, which counted both, so the figures read slower than the app now is.`;
        return p;
    };

    /** How full this month's record is (`perfRecordFullness`): once full, every later write that
     *  month is refused and the card simply stops changing, which nothing else would show.
     *  @param {Record<string, number>} samples */
    const recordLine = (samples) => {
        const full = perfRecordFullness(samples);
        const p = document.createElement('p');
        p.className = 'usage-note' + (full >= 0.75 ? ' speed-note--warn' : '');
        p.textContent = full >= 1
            ? 'This month’s speed record is full, so these figures have stopped changing. They start again next month.'
            : `This month’s speed record is ${full < 0.01 ? 'under 1%' : `${Math.floor(full * 100)}%`} full. Each release adds to it, and once it is full these figures stop changing until next month.`;
        return p;
    };

    /** The card's closing note. "(few)" is one token and must not break across a line. */
    const footer = () => {
        const note = document.createElement('p');
        note.className = 'usage-note';
        const few = document.createElement('span');
        few.className = 'speed-token';
        few.textContent = '“(few)”';
        note.append('Speeds are how long the app took to respond. Groups marked ', few, ` have too few opens to read into. ${PRIVACY_FOOTER}`);
        return note;
    };

    try {
        await sessionReady;
        const stats = await withClaimRetry(getPerfStats);   // { thisMonth, lastMonth }
        content.innerHTML = '';

        // ── Window toggle: This month / Last month (trend across deploys; stable early in a month) ──
        let active = 'thisMonth';
        const toggle = document.createElement('div');
        toggle.className = 'speed-toggle';
        toggle.setAttribute('role', 'group');
        toggle.setAttribute('aria-label', 'Time window');
        const body = document.createElement('div');

        /** Render the body for the active window. */
        const render = () => {
            const w = stats[/** @type {'thisMonth'|'lastMonth'} */ (active)];   // { month, login, fcp, pages, ready, samples }
            const windowLabel = active === 'thisMonth' ? 'this month' : 'last month';
            const samples = w.samples || {};
            body.innerHTML = '';

            // The colour key belongs to the WHOLE card, so it comes before any bar.
            if (w.login.total || w.fcp.total || w.pages.total || w.ready.total) body.appendChild(legendEl());
            const transition = timingNote(samples, windowLabel);
            if (transition) body.appendChild(transition);

            // The first empty panel this month says the figures fill in; the rest just say they are empty.
            let hinted = false;
            /** @param {any} s a summary @param {'login'|'fcp'|'pages'|'ready'} kind @param {string} unit */
            const panel = (s, kind, unit) => {
                const hint = !s.total && active === 'thisMonth' && !hinted;
                if (hint) hinted = true;
                return verdictBanner(perfVerdict(s.overall, kind), s.overall, s.total, unit, windowLabel, hint);
            };

            // Section 1 — Signing in (a distinct journey).
            body.appendChild(sectionHeading('🔑', 'Signing in'));
            body.appendChild(noteLine('Timed from pressing “Sign in” until the page is usable. Only fresh sign-ins count — normally fewer than the accounts on the Usage card, since a saved session opens the app without signing in again.'));
            body.appendChild(panel(w.login, 'login', 'sign-ins'));
            if (w.login.total) body.appendChild(overallBar(w.login.overall));

            // Section 2 — Opening pages: three moments, in the order they happen, then each page.
            body.appendChild(sectionHeading('📄', 'Opening pages', true));
            for (const m of MOMENTS) {
                const s = /** @type {any} */ (w)[m.key];
                body.appendChild(subHeading(m.emoji, m.label));
                body.appendChild(noteLine(m.explain));
                body.appendChild(panel(s, m.key, 'page opens'));
                if (s.total) body.appendChild(overallBar(s.overall));
            }
            // Only beside a figure it explains: with no "Usable" opens there is no smaller total.
            if (w.ready.total) {
                body.appendChild(noteLine('“Usable” leaves out pages that do not report it, and opens where somebody had to sign in or type the staff PIN first, so its total is smaller than the two above.'));
            }
            if (w.fcp.total || w.pages.total || w.ready.total) {
                body.appendChild(byPageRows(w.fcp.byPage, w.pages.byPage, w.ready.byPage, w.month));
            }

            // Section 3 — a closer look at the busiest page.
            const closer = closerLook(samples, w.pages.byPage, windowLabel);
            if (closer) body.appendChild(closer);

            if (active === 'thisMonth') body.appendChild(recordLine(samples));
            body.appendChild(footer());
        };

        [['thisMonth', 'This month'], ['lastMonth', 'Last month']].forEach(([key, label]) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'speed-toggle-btn' + (key === active ? ' speed-toggle-btn--on' : '');
            btn.textContent = label;
            btn.setAttribute('aria-pressed', String(key === active));
            btn.addEventListener('click', () => {
                if (active === key) return;
                active = key;
                toggle.querySelectorAll('.speed-toggle-btn').forEach((b, i) => {
                    const on = (i === 0 ? 'thisMonth' : 'lastMonth') === active;
                    b.classList.toggle('speed-toggle-btn--on', on);
                    b.setAttribute('aria-pressed', String(on));
                });
                render();
            });
            toggle.appendChild(btn);
        });

        content.appendChild(toggle);
        content.appendChild(body);
        render();

    } catch (e) {
        console.error('[AppSpeed]', e);
        _cardLoadError(content, 'Couldn\'t load app speed — check your connection.', initPageSpeedCard);
    } finally {
        content.removeAttribute('aria-busy');
    }
}
export { initPageSpeedCard };
