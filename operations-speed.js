// @ts-check
/**
 * operations-speed.js — the App Speed card on operations.html (Project 0 latency).
 *
 * One of the three reporting cards split out of operations-reports.js at v21.32 — see that
 * module's header for why. It awaits `sessionReady`, reads Firestore, and renders into its own
 * card by id; it touches no coordinator state and no other card.
 */
import { sessionReady } from './session.js';
import { withClaimRetry, getPerfStats } from './firebase-client.js';
import { SPEED_GROUPS, perfVerdict, summarisePerfBy, PERF_DIMENSIONS, summariseBootPhases, summariseStartMilestones, summariseReadySource, THIN_SAMPLE } from './perf-stats.js';
import { escapeHtml } from './roster-data.js';
import { PRIVACY_FOOTER, PAGE_META, _cardLoadError, _usageMonthLabel } from './operations-reports.js';

// ── App speed card (Project 0 latency, surfaced in plain language) ──────────────
async function initPageSpeedCard() {
    const content = document.getElementById('pageSpeedContent');
    if (!content) return;

    // `thin` renders like `none` — neutral, no colour verdict. The percentage is still shown; it
    // is the CLAIM that is withheld, not the number.
    const TONE_CLASS = { good: 'good', ok: 'ok', bad: 'bad', none: 'none', thin: 'none' };
    /** width:% segments (good/ok/slow) from a {quick,ok,slow,total} band row.
     *  @param {{quick:number, ok:number, slow:number, total:number}} b */
    const segs = (b) => {
        if (!b.total) return '';
        const w = (/** @type {number} */ n) => (n / b.total) * 100;
        return `<span class="speed-seg speed-seg--good" style="width:${w(b.quick)}%"></span>` +
               `<span class="speed-seg speed-seg--ok"   style="width:${w(b.ok)}%"></span>` +
               `<span class="speed-seg speed-seg--bad"  style="width:${w(b.slow)}%"></span>`;
    };
    /** A small "🔑 Signing in" / "📄 Opening pages" section heading. @param {string} emoji @param {string} label */
    const subhead = (emoji, label, rule = false) => {
        const p = document.createElement('p');
        // `rule` draws a divider above, the way the Usage card separates its bar groups. Without it
        // the card is one continuous scroll and a new subject has nothing marking where it begins.
        p.className = 'speed-subhead' + (rule ? ' speed-subhead--rule' : '');
        p.innerHTML = `<span aria-hidden="true">${emoji}</span> ${label}`;
        return p;
    };
    /** A full-width overall band bar (Quick/A moment/Slow) — used for the aggregate login section,
     *  so it shows the SAME three bands as the per-page bars (not just a single headline %).
     *  @param {{quick:number, ok:number, slow:number, total:number, pctQuick:number, pctOk:number, pctSlow:number}} b */
    const overallBar = (b) => {
        const wrap = document.createElement('div');
        wrap.className = 'speed-bar speed-bar--overall';
        wrap.setAttribute('role', 'img');
        wrap.setAttribute('aria-label', `${b.pctQuick}% quick, ${b.pctOk}% a moment, ${b.pctSlow}% slow`);
        wrap.innerHTML = segs(b);
        return wrap;
    };
    /** The shared colour key (Quick/A moment/Slow) — explains both the login bar and the page bars. */
    const legendEl = () => {
        const legend = document.createElement('div');
        legend.className = 'speed-legend';
        legend.innerHTML = /** @type {Array<'quick'|'ok'|'slow'>} */ (['quick', 'ok', 'slow']).map(g => {
            const grp = SPEED_GROUPS[g];
            return `<span class="speed-legend-item"><span class="speed-dot speed-dot--${grp.tone}"></span>${grp.label} <span class="speed-legend-sub">(${grp.sub})</span></span>`;
        }).join('');
        return legend;
    };
    /** A toned verdict banner: big % "quick" + plain sentence + a sub line.
     *  @param {{tone:'good'|'ok'|'bad'|'none'|'thin', text:string}} verdict
     *  @param {{pctQuick:number, pctOk:number, pctSlow:number}} overall @param {number} total @param {string} unit
     *  @param {string} [windowLabel] - "this month" / "last month", for the sub line */
    const verdictBanner = (verdict, overall, total, unit, windowLabel = 'this month') => {
        const div = document.createElement('div');
        div.className = `speed-verdict speed-verdict--${TONE_CLASS[verdict.tone]}`;
        // NO "(few)" MARKER HERE, deliberately — `perfVerdict` already returns a whole sentence
        // saying it ("Too few sign-ins yet to read as a trend"), and this line sits directly under
        // that sentence. v21.16 added one anyway and it was doing nothing twice over: it repeated
        // the sentence above it, and `.speed-thin` is `--text-mid`/400 against a sub-line that is
        // ALREADY `--text-mid`/400 — measured identical in colour, weight and size, so it read as
        // three more words rather than as a mark. The marker earns its place on the breakdown rows
        // and the per-page table, where the label beside it is `--text-dark` and there is no
        // sentence; it does not earn it here.
        // ALL THREE BANDS, not just the headline one (v21.71). The big number is `pctQuick` — the
        // share within a second — while the banner's COLOUR is driven by `pctSlow` crossing 20%.
        // Two different measures, and the reader was given only one of them in words: a red panel
        // over "32%" reads as "32% bad" when it means "32% good, and separately a fifth over three
        // seconds". Measured on a real reader — the author of this card's own review misread it
        // exactly that way from the source. Naming the split removes the ambiguity at the point it
        // arises, which no legend further up the card can do once it has scrolled away.
        const sub = total
            ? `${overall.pctQuick}% within a second · ${overall.pctOk}% 1–3s · ${overall.pctSlow}% over 3s`
              + ` · ${total.toLocaleString('en-GB')} ${unit} ${windowLabel}`
            : (windowLabel === 'this month'
                ? 'Fills in as staff use the app over the coming days.'
                : 'No data recorded last month.');
        div.innerHTML =
            `<span class="speed-verdict-num">${total ? overall.pctQuick + '%' : '—'}</span>` +
            `<span class="speed-verdict-text">${verdict.text}<span class="speed-verdict-sub">${sub}</span></span>`;
        return div;
    };

    /** A lighter sub-heading for the two "opening a page" milestones. @param {string} emoji @param {string} label */
    const subMilestone = (emoji, label) => {
        const p = document.createElement('p');
        p.className = 'speed-subhead speed-subhead--sub';
        p.innerHTML = `<span aria-hidden="true">${emoji}</span> ${label}`;
        return p;
    };
    /** A small muted framing line. @param {string} text */
    const noteLine = (text) => {
        const p = document.createElement('p');
        p.className = 'speed-note';
        p.textContent = text;
        return p;
    };
    /** Per-page rows showing ALL THREE milestones — appears, code loaded, usable — so the same page's
     *  speeds sit together and one page's stage can be scanned against every other's.
     *
     *  The third column is the point (v20.80). With two columns the second one was labelled "ready"
     *  and carried `domReady`, which is when the SCRIPTS finished, not when the page was usable — on
     *  the Calendar those are now different by seconds. A page that never marks the milestone leaves
     *  its cell EMPTY rather than borrowing another bar, exactly as a page with no paint data does.
     *  @param {Array<any>} fcpByPage @param {Array<any>} pagesByPage @param {Array<any>} readyByPage @param {string} month */
    const dualRows = (fcpByPage, pagesByPage, readyByPage, month) => {
        const frag = document.createDocumentFragment();
        const heading = document.createElement('p');
        heading.className = 'usage-section-label';
        heading.textContent = `By page — ${_usageMonthLabel(month)}`;
        frag.appendChild(heading);

        const fcpMap   = new Map(fcpByPage.map(p => [p.page, p]));
        const pagesMap = new Map(pagesByPage.map(p => [p.page, p]));
        const readyMap = new Map((readyByPage || []).map(p => [p.page, p]));
        const allPages = [...new Set([...pagesMap.keys(), ...fcpMap.keys(), ...readyMap.keys()])]
            .sort((a, b) => (pagesMap.get(b)?.total || 0) - (pagesMap.get(a)?.total || 0)
                         || (fcpMap.get(b)?.total   || 0) - (fcpMap.get(a)?.total   || 0)
                         || a.localeCompare(b));

        const rows = document.createElement('div');
        rows.className = 'speed-rows';
        const head = document.createElement('div');
        head.className = 'speed-row speed-row--dual speed-dual-head';
        // The last cell was EMPTY until v21.34, which left the one number in this table as the only
        // unlabelled figure on the card — every other numeric column here names itself ("over 1s",
        // "over ½s", "opens").
        //
        // ── ONE QUANTITY, ONE WORD (v21.35) ─────────────────────────────────────────────────────
        // This column said "opens" and the three breakdown blocks below said "loads", for the same
        // thing: one page being opened once. Two words for one quantity on a single card makes a
        // reader look for the distinction, and there is none — the prose here has always said
        // "page opens". They are all "opens" now, including the shared privacy footer. If you add
        // another count to this card, it is an OPEN.
        head.innerHTML = '<span></span><span class="speed-dual-label">Appears</span>' +
                         '<span class="speed-dual-label">Code</span>' +
                         '<span class="speed-dual-label">Usable</span>' +
                         '<span class="speed-dual-label">opens</span>';
        rows.appendChild(head);

        allPages.forEach(pg => {
            const meta  = PAGE_META[pg];
            const emoji = meta ? meta.emoji : '📄';
            const label = meta ? meta.label : escapeHtml(pg);
            const f = fcpMap.get(pg);
            const r = pagesMap.get(pg);
            const u = readyMap.get(pg);
            const count = (r?.total) || (f?.total) || (u?.total) || 0;
            const row = document.createElement('div');
            row.className = 'speed-row speed-row--dual';
            row.innerHTML =
                // A page with three opens can render a full-width RED bar and mean nothing at all.
                // Same marker, same threshold and same reasoning as the breakdown rows below — it
                // was simply never applied here, where the bar is at its most emphatic.
                `<span class="speed-row-label"><span class="speed-row-name">`
                    + `<span aria-hidden="true">${emoji}</span> ${label}</span>`
                    + `${count && count < THIN_SAMPLE ? '<span class="speed-thin">(few)</span>' : ''}</span>` +
                `<span class="speed-bar" role="img" aria-label="appears: ${f ? f.pctQuick : 0}% quick">${f ? segs(f) : ''}</span>` +
                `<span class="speed-bar" role="img" aria-label="code loaded: ${r ? r.pctQuick : 0}% quick">${r ? segs(r) : ''}</span>` +
                (u ? `<span class="speed-bar" role="img" aria-label="usable: ${u.pctQuick}% quick">${segs(u)}</span>`
                   // An EMPTY bar is not the honest mark for "this page does not report the
                   // milestone" — an unfilled track sitting beside a filled one reads as 0%, which
                   // is a measurement, and the wrong one. A dash says there is no number.
                   : '<span class="speed-bar-none" aria-label="usable: not reported">—</span>') +
                // MUTED, not bold navy (v21.34). It wore `.speed-row-count` — the class that, three
                // blocks down in this same card, means "the figure you are hunting". Here the only
                // number in the row is the SAMPLE SIZE, so the emphasis sat on the least
                // interesting thing on the line and the bars beside it competed with it. The
                // breakdown rows already got this right: bold for the finding, muted for how many
                // loads it rests on. Same class, same role, and its 4ch floor also stops the bars
                // reflowing when a page crosses into five digits.
                `<span class="speed-row-sub">${count.toLocaleString('en-GB')}</span>`;
            rows.appendChild(row);
        });
        frag.appendChild(rows);
        return frag;
    };

    // The thin-sample threshold now lives in perf-stats.js, so the headline verdict and the per-page
    // table are governed by the same number as these rows (v21.16). It used to be declared here and
    // therefore applied only here — which is exactly how a card ends up marking a 10-sample row
    // "(few)" while making a confident claim from 19 samples two sections above it.

    /** One breakdown block: the busiest page's samples split by a single dimension.
     *
     *  `metric` was HARDCODED to `domReady` until v22.28, which mattered more than it looks — see
     *  `startSignalRows` below. The three blocks it renders still split `domReady`, because that is
     *  the whole-load figure the per-page table above them reports and a version regression shows up
     *  there first.
     *  @param {Record<string, number>} samples @param {string} page
     *  @param {'conn'|'mode'|'version'} dimension
     *  @param {string} [metric] @param {string} [label] */
    const breakdownRows = (samples, page, dimension, metric = 'domReady', label = '') => {
        const { rows } = summarisePerfBy(samples, { page, metric, dimension, minSamples: THIN_SAMPLE });
        if (rows.length < 2) return null;   // one group explains nothing — it IS the page total
        const frag = document.createDocumentFragment();
        // The SAME class the "By page" group above uses. These are the same kind of thing — a label
        // over a set of bars — and they were styled three ranks apart: bold dark, bold muted, and
        // plain muted body text. Two structural ranks, five treatments, was the whole problem.
        const heading = document.createElement('p');
        heading.className = 'usage-section-label speed-dim-label';
        heading.textContent = label || PERF_DIMENSIONS[dimension].label;
        frag.appendChild(heading);

        const list = document.createElement('div');
        list.className = 'speed-rows';
        // A column header, borrowing the idiom the per-page dual rows already established. It is
        // what lets each row drop the repeated "over 1s" and become a number — three words per row
        // that never change are noise, and on a 390px screen they were most of the column.
        const head = document.createElement('div');
        head.className = 'speed-row speed-row--why speed-dual-head';
        head.innerHTML = '<span></span><span></span>'
            + '<span class="speed-dual-label">over 1s</span>'
            + '<span class="speed-dual-label">opens</span>';
        list.appendChild(head);
        rows.forEach(r => {
            const row = document.createElement('div');
            row.className = 'speed-row speed-row--why';
            const thin = r.total < THIN_SAMPLE;
            // ── WHICH NUMBER GOES HERE ──────────────────────────────────────────────────────
            //
            // It said "% slow" first, and the first real data showed that was the wrong band. Every
            // row read 0–3% slow while its bar carried a wide amber middle: the Calendar's tail is
            // not "over 3 seconds", it is "over ONE second", which is 13% of opens and the band the
            // whole card is framed around ("86% within a second"). A number reporting 3% next to a
            // bar that is visibly a quarter amber makes the reader trust the number and miss the
            // finding.
            //
            // So the row states the complement of the headline — everything NOT under a second —
            // and the bar keeps showing how that splits. The full three-way breakdown stays in the
            // aria-label, which is where a screen-reader user gets what sighted users read off the
            // bar.
            const overOneSecond = 100 - r.pctQuick;
            row.innerHTML =
                `<span class="speed-row-label"><span class="speed-row-name">${escapeHtml(r.label)}</span>`
                    + `${thin ? '<span class="speed-thin">(few)</span>' : ''}</span>` +
                `<span class="speed-bar" role="img" aria-label="${r.pctQuick}% quick, ${r.pctOk}% a moment, ${r.pctSlow}% slow">${segs(r)}</span>` +
                `<span class="speed-row-count">${overOneSecond}%</span>` +
                `<span class="speed-row-sub">${r.total.toLocaleString('en-GB')}</span>`;
            list.appendChild(row);
        });
        frag.appendChild(list);
        return frag;
    };

    /**
     * ── DOES THE START TRACK THE NETWORK? (v22.28) ──────────────────────────────────────────────
     *
     * `LATENCY_PLAN.md` has one open owner decision — whether the Calendar may paint before the
     * `accounts:lookup` round trip returns — and one check gating it: **if the wall is that round
     * trip, `Recognised` should track connection quality far more strongly than `Getting ready`
     * does.** A slow network moves a network wall and barely moves a code-parse one.
     *
     * The plan called that comparison "a reading, not a build". **It was not readable.** Every
     * dimensional split on this card ran against `domReady`, so the only milestone anyone could
     * split by connection was the one the plan's own evidence says is fine (`Getting ready` finishes
     * inside ½s on 100% of opens). The dimensions have been recorded on the ladder samples since
     * v21.30 — `mode` and `conn` go onto every milestone write — so this is a read of a month of
     * data already collected, not new instrumentation.
     *
     * **Both rows use the card's normal bands and the same dimension**, one group under the other,
     * because the finding is the SPREAD WITHIN each group and two blocks on different bands could
     * not be compared. The reader is told what to compare rather than left to infer it.
     *
     * It answers a question and it does not decide anything. A spread here is evidence for the
     * round-trip finding; its absence means the finding is wrong and the decision should wait.
     * @param {Record<string, number>} samples @param {string} page
     */
    const startSignalRows = (samples, page) => {
        const groups = [
            // Just the milestone name: the heading above already says "by connection", and
            // repeating it in both sub-labels put the same three words on screen four times.
            { metric: 'authBoot', label: 'Recognised' },
            { metric: 'appBoot',  label: 'Getting ready' },
        ].map(g => ({ ...g, block: breakdownRows(samples, page, 'conn', g.metric, g.label) }))
         .filter(g => g.block);
        // BOTH or NEITHER. One alone is not the comparison — it is a single row of percentages with
        // nothing to read them against, and a reader would take it for a finding.
        if (groups.length < 2) return null;
        const frag = document.createDocumentFragment();
        const heading = document.createElement('p');
        heading.className = 'usage-section-label speed-dim-label';
        heading.textContent = 'Does the connection slow the start?';
        frag.appendChild(heading);
        frag.appendChild(noteLine('Restoring your sign-in talks to the server; loading this page\u2019s code does not. If the first group spreads across connection speeds and the second does not, the wait is the network rather than the app.'));
        groups.forEach(g => frag.appendChild(/** @type {DocumentFragment} */ (g.block)));
        return frag;
    };

    /** The boot-phase block (v20.33): the busiest page's opens split into the three STAGES of
     *  starting up, in boot order. Same row grammar as the dimensional blocks — but where those
     *  split the opens into groups, these rows are contiguous SPANS of every open, so the opens
     *  column reads near-identical down the rows and each row answers "how often did THIS stage
     *  run long". The stated number is the share over ½ SECOND — a stage-scaled threshold, named
     *  in the column header exactly like the dimensional blocks name theirs (the v20.19 rule: a
     *  number must state its own band): the load-level bands call under-a-second Quick, but one
     *  STAGE eating 500ms+ is precisely what pushes a whole open into the amber band.
     *  Renders nothing until updated devices report — no scaffolding for future data.
     *  @param {Record<string, number>} samples @param {string} page */
    const phaseRows = (samples, page) => {
        const { rows } = summariseBootPhases(samples, { page });
        if (!rows.length) return null;
        const frag = document.createDocumentFragment();
        const heading = document.createElement('p');
        heading.className = 'usage-section-label speed-dim-label';
        heading.textContent = 'By stage of start-up';
        frag.appendChild(heading);
        // This block declares its OWN bands — the one place on the card the top legend does not
        // apply, so the note must say so or the legend silently lies about these three bars.
        frag.appendChild(noteLine('Every open passes through all three stages, so these bars use finer bands: green under ½ second, amber to 1 second, red over. One long stage is what makes a slow open slow.'));

        const list = document.createElement('div');
        list.className = 'speed-rows';
        const head = document.createElement('div');
        head.className = 'speed-row speed-row--why speed-dual-head';
        head.innerHTML = '<span></span><span></span>'
            + '<span class="speed-dual-label">over ½s</span>'
            + '<span class="speed-dual-label">opens</span>';
        list.appendChild(head);
        rows.forEach(r => {
            const row = document.createElement('div');
            row.className = 'speed-row speed-row--why';
            const thin = r.total < THIN_SAMPLE;
            // The aria-label states the PHASE bands, because this block's bars do not follow the
            // card legend — a screen-reader user must not be told "quick/a moment/slow" here.
            row.innerHTML =
                `<span class="speed-row-label"><span class="speed-row-name">${escapeHtml(r.label)}</span>`
                    + `${thin ? '<span class="speed-thin">(few)</span>' : ''}</span>` +
                `<span class="speed-bar" role="img" aria-label="${escapeHtml(r.sub)}: ${r.pctQuick}% under half a second, ${r.pctOk}% between half and one second, ${r.pctSlow}% over a second">${segs(r)}</span>` +
                `<span class="speed-row-count">${r.pctOver500}%</span>` +
                `<span class="speed-row-sub">${r.total.toLocaleString('en-GB')}</span>`;
            list.appendChild(row);
        });
        frag.appendChild(list);
        return frag;
    };

    /** The START LADDER — four cumulative milestones, in order, on the card's NORMAL bands.
     *
     *  Sits between the boot stages and the dimensional splits because it answers the question in
     *  between: the stages say which part of LOADING ran long and stop at DOMContentLoaded, and on
     *  the Calendar everything expensive happens after that. Before this the card could say a page
     *  was slow and nothing about where the time went.
     *
     *  Read by comparing ADJACENT rows, which is why they are cumulative and why the note says so:
     *  signed in quickly but unlocked slowly points at the gate, unlocked quickly but shifts slow
     *  points at Firestore. Subtracting is not asked of the reader — the rows already nest.
     *
     *  Renders nothing until updated devices report, and each row appears only when IT has data —
     *  so a partly-reported ladder shows the rungs it has rather than a row of zeroes.
     *  @param {Record<string, number>} samples @param {string} page */
    const ladderRows = (samples, page) => {
        const { rows } = summariseStartMilestones(samples, { page });
        if (!rows.length) return null;
        const frag = document.createDocumentFragment();
        const heading = document.createElement('p');
        heading.className = 'usage-section-label speed-dim-label';
        heading.textContent = 'How far the start gets';
        frag.appendChild(heading);
        frag.appendChild(noteLine('Each step includes the ones above it, so compare neighbouring rows: a big jump is where the time went. Same bands as the rest of the card.'));

        const list = document.createElement('div');
        list.className = 'speed-rows';
        const head = document.createElement('div');
        head.className = 'speed-row speed-row--why speed-dual-head';
        head.innerHTML = '<span></span><span></span>'
            + '<span class="speed-dual-label">over 1s</span>'
            + '<span class="speed-dual-label">opens</span>';
        list.appendChild(head);
        rows.forEach(r => {
            const row = document.createElement('div');
            row.className = 'speed-row speed-row--why';
            const thin = r.total < THIN_SAMPLE;
            row.innerHTML =
                `<span class="speed-row-label"><span class="speed-row-name">${escapeHtml(r.label)}</span>`
                    + `${thin ? '<span class="speed-thin">(few)</span>' : ''}</span>` +
                `<span class="speed-bar" role="img" aria-label="${escapeHtml(r.sub)}: ${r.pctQuick}% quick, ${r.pctOk}% a moment, ${r.pctSlow}% slow">${segs(r)}</span>` +
                `<span class="speed-row-count">${r.pctOver1s}%</span>` +
                `<span class="speed-row-sub">${r.total.toLocaleString('en-GB')}</span>`;
            list.appendChild(row);
        });
        frag.appendChild(list);
        return frag;
    };

    /** WHAT SERVED THE FIRST GRID (v21.99) — the reading `LATENCY_PLAN.md` Phase 2 turns on.
     *
     *  Phase 2 narrows the Calendar's authoritative Firestore read. A load the local cache already
     *  served never touches the network on that path, so narrowing it cannot move that load by a
     *  millisecond — which makes "how many loads waited for the read?" the whole question, and it
     *  was one the card could not answer.
     *
     *  The note is load-bearing: **these two do not sum to the row above them.** A page that does
     *  not know its source reports `ready` alone, so reading them as a partition would understate
     *  whichever way the remainder fell. Same shape and bands as the ladder, so the two blocks read
     *  as one idiom.
     *  @param {Record<string, number>} samples @param {string} page */
    const readySourceRows = (samples, page) => {
        const { rows } = summariseReadySource(samples, { page });
        if (!rows.length) return null;
        const frag = document.createDocumentFragment();
        const heading = document.createElement('p');
        heading.className = 'usage-section-label speed-dim-label';
        heading.textContent = 'What put the shifts on screen';
        frag.appendChild(heading);
        frag.appendChild(noteLine('A grid from the saved copy never waited for the server. Only the Calendar reports this, so the two do not add up to “Shifts shown” above.'));

        const list = document.createElement('div');
        list.className = 'speed-rows';
        const head = document.createElement('div');
        head.className = 'speed-row speed-row--why speed-dual-head';
        head.innerHTML = '<span></span><span></span>'
            + '<span class="speed-dual-label">over 1s</span>'
            + '<span class="speed-dual-label">opens</span>';
        list.appendChild(head);
        rows.forEach(r => {
            const row = document.createElement('div');
            row.className = 'speed-row speed-row--why';
            const thin = r.total < THIN_SAMPLE;
            row.innerHTML =
                `<span class="speed-row-label"><span class="speed-row-name">${escapeHtml(r.label)}</span>`
                    + `${thin ? '<span class="speed-thin">(few)</span>' : ''}</span>` +
                `<span class="speed-bar" role="img" aria-label="${escapeHtml(r.sub)}: ${r.pctQuick}% quick, ${r.pctOk}% a moment, ${r.pctSlow}% slow">${segs(r)}</span>` +
                `<span class="speed-row-count">${r.pctOver1s}%</span>` +
                `<span class="speed-row-sub">${r.total.toLocaleString('en-GB')}</span>`;
            list.appendChild(row);
        });
        frag.appendChild(list);
        return frag;
    };

    /** The whole "why" section, for the page with the most samples.
     *
     *  Deliberately NOT hardcoded to the Calendar, even though the Calendar is what prompted it and
     *  is ~74% of all opens: pinning a page id here would leave the section quietly answering about
     *  the wrong page the first time that changes. The busiest page is the one whose distribution
     *  drives the headline figure, which is the same reason the Calendar is the interesting one now.
     *  @param {Record<string, number>} samples @param {Array<any>} byPage */
    const whySection = (samples, byPage) => {
        const busiest = byPage[0];
        if (!busiest || !busiest.total) return null;
        const meta = PAGE_META[busiest.page];
        const frag = document.createDocumentFragment();
        // A top-level SECTION, at the same rank as "Signing in" and "Opening pages" — it answers a
        // question of its own. It was rendered at milestone rank (the "First appears" tier), which
        // put the card's third subject one level below the two it sits beside.
        frag.appendChild(subhead('🔍', `Why some are slower — ${meta ? meta.emoji + ' ' + meta.label : busiest.page}`, true));
        frag.appendChild(noteLine(
            `The busiest page (${busiest.total.toLocaleString('en-GB')} opens), split by what was already being recorded with each one.`));
        let any = false;
        // Boot stages FIRST — "which part of starting up ran long" is the question the dimensional
        // splits below can only gesture at, so when the data exists it leads.
        const phases = phaseRows(samples, busiest.page);
        if (phases) { frag.appendChild(phases); any = true; }
        // Then how far the START had got — the stages above stop at DOMContentLoaded, and on the
        // Calendar the auth restore, the access decision and Firestore all happen after it.
        const ladder = ladderRows(samples, busiest.page);
        if (ladder) { frag.appendChild(ladder); any = true; }
        // Immediately after the ladder, because it splits ONE of its rungs — "Shifts shown" — and
        // reading it anywhere else would leave the reader to remember which row it belonged to.
        const source = readySourceRows(samples, busiest.page);
        if (source) { frag.appendChild(source); any = true; }
        // Then the ladder's FIRST rung against the network, beside the stage that does not touch it
        // — the comparison `LATENCY_PLAN.md` gates its open decision on. It sits here because both
        // halves are milestones the two blocks above have just named.
        const signal = startSignalRows(samples, busiest.page);
        if (signal) { frag.appendChild(signal); any = true; }
        for (const dim of /** @type {Array<'conn'|'mode'|'version'>} */ (['conn', 'mode', 'version'])) {
            // `conn` is the ONE dimension now used twice on this card — the block above splits two
            // milestones by it — so this one has to say which figure it is splitting or a reader
            // meets a third "By connection" and cannot tell. The other two need no such help,
            // and giving it to them anyway would be four words of noise apiece.
            // …and it keeps its siblings' "By …" opening rather than leading with the figure: the
            // three read as one group, and the qualifier is what distinguishes this one. The e2e
            // guard asserts on "By connection", so leading with anything else silently drops it.
            const block = breakdownRows(samples, busiest.page, dim, 'domReady',
                dim === 'conn' ? 'By connection — whole load' : '');
            if (block) { frag.appendChild(block); any = true; }
        }
        return any ? frag : null;
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
            const w = stats[/** @type {'thisMonth'|'lastMonth'} */ (active)];   // { month, login, fcp, pages }
            const windowLabel = active === 'thisMonth' ? 'this month' : 'last month';
            body.innerHTML = '';

            // The colour key belongs to the WHOLE card — every bar in it uses these three bands. It
            // used to sit after the sign-in bar, which was ambiguous and became wrong the moment
            // section dividers arrived: it read as part of "Signing in" rather than as the key to
            // everything below it. First position, before any bars, is the only place it is
            // unambiguous.
            if (w.login.total || w.fcp.total || w.pages.total) body.appendChild(legendEl());

            // Section 1 — Signing in (a distinct journey).
            body.appendChild(subhead('🔑', 'Signing in'));
            body.appendChild(noteLine('Only fresh sign-ins are timed — normally fewer than the accounts on the Usage card, since a saved session opens the app without signing in again.'));
            body.appendChild(verdictBanner(perfVerdict(w.login.overall, 'login'), w.login.overall, w.login.total, 'sign-ins', windowLabel));
            if (w.login.total) body.appendChild(overallBar(w.login.overall));

            // Section 2 — Opening a page: two milestones in timeline order (appears → ready).
            body.appendChild(subhead('📄', 'Opening pages', true));
            body.appendChild(noteLine('Three moments when a page opens — when something first appears, when the app’s code has loaded, and when the page is actually usable.'));
            body.appendChild(subMilestone('✨', 'First appears'));
            body.appendChild(verdictBanner(perfVerdict(w.fcp.overall, 'fcp'), w.fcp.overall, w.fcp.total, 'page opens', windowLabel));
            if (w.fcp.total) body.appendChild(overallBar(w.fcp.overall));
            body.appendChild(subMilestone('📦', 'Code loaded'));
            body.appendChild(verdictBanner(perfVerdict(w.pages.overall, 'pages'), w.pages.overall, w.pages.total, 'page opens', windowLabel));
            if (w.pages.total) body.appendChild(overallBar(w.pages.overall));
            // The one an admin should read as "how fast is the app". The two above are stages of
            // getting there and neither is the answer: "appears" is the splash painting, and "code
            // loaded" fires while the Calendar can still be blank — it waits on the access decision,
            // which is asynchronous and happens after DOMContentLoaded (v20.80).
            body.appendChild(subMilestone('✅', 'Usable'));
            body.appendChild(verdictBanner(perfVerdict(w.ready.overall, 'ready'), w.ready.overall, w.ready.total, 'page opens', windowLabel));
            // The bar belongs under EVERY headline, not only the login one it started on (v21.71):
            // the three page milestones are the numbers a reader compares, and a proportion is far
            // easier to compare as a shape than as a percentage read against a legend that is by
            // now several screens up. It also shows the middle band, which no number on the panel
            // states — the 1-to-3-second majority was invisible.
            if (w.ready.total) body.appendChild(overallBar(w.ready.overall));
            body.appendChild(noteLine('“Usable” is counted only on pages that report it, so its total is smaller than the two above — it is not a sign of fewer opens.'));

            if (w.fcp.total || w.pages.total || w.ready.total) {
                body.appendChild(dualRows(w.fcp.byPage, w.pages.byPage, w.ready.byPage, w.month));
            }

            // Section 3 — WHY. The per-page rows above say which page is slow; this says for whom.
            const why = whySection(w.samples || {}, w.pages.byPage);
            if (why) body.appendChild(why);

            const note = document.createElement('p');
            note.className = 'usage-note';
            note.textContent = 'Speeds are how long the app took to respond. Groups marked "(few)" have too few opens to read into. ' + PRIVACY_FOOTER;
            body.appendChild(note);
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
