// @ts-check
/**
 * links-analysis.js — the two read-only "analysis" panels on links.html: the hourly Coverage heat
 * map and the Design quality checks. Extracted from links-app.js (v17.70, extraction programme).
 *
 * Both are pure render-from-a-pure-result: the maths already lives in links-design.js
 * (`calcHourlyCoverage` / `runDesignChecks`); these functions only read the CURRENT design's
 * patterns and write to their own container, so they carry none of the coordinator's save /
 * concurrency / dirty state. That is what makes this a clean first extraction.
 *
 * `initLinksAnalysis({ getDesign, getBaseline })` returns `{ renderCoverageChart, renderDesignChecks,
 * renderSummary }` — the third being the live strip in the grid card's sticky bar (v19.57).
 * The coordinator passes a getter for the live active design (or null) and calls the two renderers on
 * every pattern change. `getBaseline` (v19.46) supplies the CURRENT link's fatigue profile so a
 * design's findings can be read against what today's roster already scores — without it, a proposal
 * reporting "15 consecutive shifts" reads as something the proposal introduced.
 *
 * ── TWO CONTRACTS THIS MODULE IS HELD TO (moved from CLAUDE.md's file tree, v20.11) ────────────
 *
 * **Every class this module emits must exist in `links.css`.** v19.46 shipped ~15 rows on
 * `check-info`, a class no stylesheet defines: nothing threw, every behavioural test passed (they
 * assert text), and those rows rendered with NO surface beside neighbours that had one. The guard
 * in `links-analysis.test.mjs` covers a PREFIX SET rather than one family — it was `check-*`-only,
 * and the demand rows then arrived under `dem-*` / `cov-demand` and not one of them was policed. A
 * new family is a loud failure rather than an invisible hole.
 *
 * **Anything rendered as a limit that *must be met* has to name whose requirement it is, and every
 * row beneath it has to carry a source in a `.check-note`.** ROADMAP.md's evidence gate puts that
 * phrase at class A or B. The rule is applied to whatever the panel RENDERS, not to the one section
 * that exists today: three more limits in that family are already computed and waiting to be
 * promoted, and each would otherwise be able to arrive as a bare number in red on a manager's
 * sheet. Not keyed on the section's name — a section that renamed itself would slip a hardcoded
 * list while making the identical claim.
 */
import { DAYS, ROTATING_LINES, DEFAULT_MAX_RUN, calcHourlyCoverage, runDesignChecks,
    weeklyHours, CONTRACTED_HOURS_PER_WEEK, hmFromHours } from './links-design.js';
import { assessFatigue } from './links-fatigue.js';
import { assessHardLimits, POLICY_SOURCE_CONFIRMED } from './links-limits.js';
import { normaliseWindow, heatSpan, isHourStaffed, windowForDay, windowMinutes } from './links-window.js';
import {
    DEC_2026_DEMAND, DEC_2026_MOVEMENTS, DEC_2026_SOURCE, DAY_CLASSES,
    demandAt, demandBucket, peakCars, peakHours, summariseDemand, describeHours, describeMovements,
} from './links-demand.js';
import { escapeHtml } from './roster-data.js';

// Presentation constant. The rotation LENGTH is imported (v19.38) — it used to be a local copy of
// 28 alongside links-app.js's own pair, with a comment claiming they "stay in step without a shared
// import". Three literals kept in step by hope is how a grid renders one number of rows while the
// checks examine a different one, silently — and the rotation has since gone 28 -> 22 (v19.98),
// which would have made all three wrong in three different ways.
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TOTAL_POS = ROTATING_LINES;

/**
 * The ORR family whose rows this panel ROLLS UP into one line while they are all not-applicable.
 * It must equal the `family` string `links-fatigue.js` stamps on those factors — a mismatch would
 * silently stop the rollup and print seven near-identical rows instead, so it is named once here
 * rather than written out at each of the three use sites (v19.52).
 */
const NIGHT_FAMILY = 'Night shifts';

/**
 * The scale the demand row is shaded against — the profile's own busiest hour, computed once at
 * module load because the profile is a constant.
 *
 * Deliberately NOT the cover grid's peak. The two rows measure different things in different units
 * (people on duty · cars per hour), so a shared scale would be arithmetic with no meaning. What each
 * row shows is its own shape, and it is the shapes a reader puts side by side.
 */
const DEMAND_PEAK = peakCars(DEC_2026_DEMAND);

/** A window row's staffed span, in minutes since midnight. */
const minutesOf = (/** @type {{start: string, end: string}} */ row) => ({
    start: /** @type {number} */ (windowMinutes(row.start)),
    end:   /** @type {number} */ (windowMinutes(row.end)),
});

/** "17:00" from an hour index. */
const hhmm = (/** @type {number|null} */ h) => `${String(h ?? 0).padStart(2, '0')}:00`;

/**
 * @param {object} deps
 * @param {() => ({ name?: string, patterns: Record<string, any>, window?: any } | null)} deps.getDesign - the live active design, or null
 * @param {() => ({ summary: string, detail: string } | null)} [deps.getBaseline] - the current link's profile
 * @param {() => boolean} [deps.isComparing] - true while compare mode shows TWO designs (v20.00)
 * @returns {{ renderCoverageChart: () => void, renderDesignChecks: () => void, renderSummary: () => void }}
 */
export function initLinksAnalysis({ getDesign, getBaseline = () => null, isComparing = () => false }) {
    /** Hourly on-duty heat map for the active design (or the empty-state message). */
    function renderCoverageChart() {
        const design = getDesign();
        const wrap     = document.getElementById('coverageHeatmap');
        const emptyMsg = document.getElementById('coverageEmptyMsg');
        if (!wrap) return;

        if (!design) {
            wrap.style.display = 'none';
            if (emptyMsg) emptyMsg.style.display = '';
            return;
        }

        if (emptyMsg) emptyMsg.style.display = 'none';
        wrap.style.display = '';

        const hourly = calcHourlyCoverage(design.patterns, TOTAL_POS);
        const win = normaliseWindow(design.window);

        // Span and gaps both come from the WINDOW now, not from the design's own extremes (v19.54).
        // The old rule ran first-worked-hour → last-worked-hour and called an hour a gap only if it
        // fell strictly BETWEEN them, so missing cover at either end of the day could not be seen:
        // the span just shrank to fit and those hours left the table. A design where everybody
        // finished at 14:20 — leaving the station unstaffed until the 23:55 close — rendered as
        // solid colour with NO gaps flagged. That is the defect this feature exists for.
        const { minH, maxH } = heatSpan(win, hourly, DAYS);
        let maxCount = 0;
        for (const d of DAYS) {
            for (const n of hourly[d].hours) if (n > maxCount) maxCount = n;
        }

        const hourTh = [];
        for (let h = minH; h < maxH; h++) {
            hourTh.push(`<th class="cov-heat-hour">${String(h).padStart(2, '0')}</th>`);
        }

        // Read the design against the service ONCE, and hand the same result to both the rows and
        // the prose. Two calls would be two chances for the cells and the sentence under them to
        // disagree about the very comparison the card exists to make.
        const sum = summariseDemand({
            profile: DEC_2026_DEMAND,
            movements: DEC_2026_MOVEMENTS,
            hourly,
            days: DAYS,
            windowFor: (day) => minutesOf(windowForDay(win, day)),
        });

        let gapCount = 0, outsideCount = 0;
        const rows = DAYS.map((/** @type {string} */ d, /** @type {number} */ di) => {
            const { hours, spare } = hourly[d];
            const cells = [];
            for (let h = minH; h < maxH; h++) {
                const n = hours[h];
                const staffed = isHourStaffed(win, d, h);
                const bucket = n === 0 ? 0 : Math.max(1, Math.ceil((n / maxCount) * 5));
                // A GAP is now "the station is open and nobody is on" — a real hole, wherever it
                // falls. An hour OUTSIDE the window is not a hole, it is a closed station, and it
                // is shaded so the two can never be mistaken for each other. Someone rostered
                // outside the window is neither: it shows as ordinary cover on a shut-station
                // column, which is exactly the anomaly a reviewer should notice.
                const isGap = staffed && n === 0;
                const cls = isGap ? ' heat-gap' : (!staffed ? ' heat-closed' : '');
                if (isGap) gapCount++;
                if (!staffed && n > 0) outsideCount++;
                cells.push(`<td class="cov-heat-cell heat-b${bucket}${cls}">${n || (isGap ? '0' : '')}</td>`);
            }
            return `<tr>` +
                `<th class="cov-heat-day">${DAY_LABELS[di]}</th>` +
                cells.join('') +
                `<td class="cov-heat-spare">${spare || ''}</td>` +
                `</tr>`;
        }).join('');

        const gapNote = gapCount
            ? ` <strong>${gapCount} staffed hour${gapCount === 1 ? '' : 's'} with nobody on duty.</strong>`
            : '';
        const outNote = outsideCount
            ? ` ${outsideCount} hour${outsideCount === 1 ? ' is' : 's are'} rostered outside the staffed window.`
            : '';

        wrap.innerHTML =
            // `tabindex="0"` + a role and name, because below 1024px this wrapper scrolls
            // horizontally (`overflow-x: auto`; desktop drops it for the sticky thead) and contains
            // nothing focusable — every cell is a `<td>`. A keyboard user could therefore never
            // reach the later hours at all. Caught the day the axe gate was first pointed at a
            // LOADED page: the violation is older than the demand rows, it had simply never been
            // scanned, because the gate only ever rendered the empty state.
            `<div class="cov-heat-wrap" tabindex="0" role="region" aria-label="Coverage and demand by hour">` +
            `<table class="cov-heat">` +
            `<thead><tr><th class="cov-heat-day"></th>${hourTh.join('')}<th class="cov-heat-spare-h">SP</th></tr></thead>` +
            `<tbody>${rows}</tbody>` +
            demandBody(sum, minH, maxH) +
            `</table></div>` +
            `<p class="cov-heat-note">Each cell shows how many people are on duty during that hour — darker means more. ` +
            `Red 0 = the station is open and nobody is on. Grey = outside the staffed window. ` +
            `SP = spares on standby (no fixed time). Peak this week: ${maxCount}.${gapNote}${outNote}</p>` +
            demandNote(sum, minH, maxH);
    }

    /**
     * The service the design has to cover, as three rows in the SAME table as the cover — one per
     * day class, because the timetable has three shapes and not seven.
     *
     * In the same table on purpose: a reader comparing cover against service is comparing columns,
     * and two tables side by side would put that comparison at the mercy of two independent
     * horizontal scrolls. It is a second `<tbody>`, not more rows in the first, so the two halves
     * can be told apart at a glance and by a screen reader.
     *
     * @param {ReturnType<typeof summariseDemand>} sum
     * @param {number} minH
     * @param {number} maxH
     */
    function demandBody(sum, minH, maxH) {
        // Which cells hold service the window does not staff — keyed `label|hour`, from the SAME
        // summary the prose reads, so a marked cell and a named movement can never disagree.
        const shutCells = new Set(sum.outside.map(e => `${e.label}|${Math.floor(e.t / 60)}`));

        const rows = DAY_CLASSES.map(({ day, label }) => {
            const cells = [];
            for (let h = minH; h < maxH; h++) {
                const { mv, cars } = demandAt(DEC_2026_DEMAND, day, h);
                // Shaded against the PROFILE's own peak, not the cover grid's — the two rows measure
                // different things in different units, so a shared scale would mean nothing. Each
                // row shows its own shape, and the shapes are what the reader is comparing.
                const bucket = demandBucket(cars, DEMAND_PEAK);
                // Marked because some of this hour's service falls outside the window — NOT as a
                // fault. It is the distinction the cover row makes with `heat-closed`, seen from the
                // other side: trains run whether or not we roster anyone. Note the marker is driven
                // by MOVEMENTS, not by `isHourStaffed`: Sunday closes at 23:25, so the 23:00 hour is
                // "staffed" while five of its movements are not covered, and an hour-level test
                // reported the whole thing as fine. That was the v19.56 bug.
                const shut = shutCells.has(`${label}|${h}`);
                const title = mv > 0 ? ` title="${mv} train${mv === 1 ? '' : 's'}, ${cars} cars"` : '';
                cells.push(
                    `<td class="cov-heat-cell dem-cell dem-b${bucket}${shut ? ' dem-shut' : ''}"${title}>` +
                    `${cars || ''}</td>`,
                );
            }
            return `<tr><th class="cov-heat-day dem-day">${label}</th>${cells.join('')}` +
                `<td class="cov-heat-spare dem-cell dem-pad"></td></tr>`;
        }).join('');
        return `<tbody class="cov-demand">` +
            `<tr class="dem-head-row"><th class="cov-heat-day dem-day" colspan="${maxH - minH + 2}">` +
            `Trains per hour — cars (arrivals + departures)</th></tr>${rows}</tbody>`;
    }

    /**
     * The prose under the table: what the demand rows mean, the two things that are not visible as
     * cells, and where the figures came from.
     *
     * The provenance line is not optional. These simplifiers are base files that will be revised and
     * the weekday one is not marked final, so a demand curve printed with no version on it is the
     * undated-printed-sheet defect (v19.45) all over again — right when it was made, unverifiable
     * afterwards.
     *
     * @param {ReturnType<typeof summariseDemand>} sum
     * @param {number} minH
     * @param {number} maxH
     */
    function demandNote(sum, minH, maxH) {
        // A FINDING: the station is open, trains are running, nobody is on.
        const nUnc = sum.uncovered.length;
        const uncovered = nUnc
            ? `<span class="dem-finding">Trains run in ${nUnc} staffed hour${nUnc === 1 ? '' : 's'} ` +
              `with nobody on duty</span> (${escapeHtml(describeHours(sum.uncovered))}). `
            : `Every staffed hour with trains in it has someone on duty. `;

        // A FACT, never a finding — see links-demand.js. The last trains and the 05:5x first
        // departure are like this on every design there has ever been, so an amber flag here would
        // fire forever and be learned-ignored, taking the sentence above it along too.
        //
        // Reported to the MINUTE and split before/after, because that is the resolution the question
        // is actually asked at: "five Sunday movements fall after the 23:25 finish" is the argument,
        // and an hourly answer cannot make it.
        // Split before/after: an early start and a late finish are different business decisions,
        // and the pre-opening set is three times bigger AND permanent, so one combined list ordered
        // by time puts every unmovable movement ahead of the five Sunday ones this exists to show.
        const clause = (/** @type {any[]} */ entries, /** @type {string} */ phrase, cap = 5) => (entries.length
            ? `${entries.length} ${phrase} (${escapeHtml(describeMovements(entries, cap))}). `
            : '');
        const outside = sum.outside.length
            ? clause(sum.outsideAfter, `train movement${sum.outsideAfter.length === 1 ? ' runs' : 's run'} after the day's finish`, 8)
              + clause(sum.outsideBefore, `run${sum.outsideBefore.length === 1 ? 's' : ''} before the day's start`)
              + `Both are stated, not scored: where the window sits is a business decision, not a design fault. `
            : '';

        // Movements the table cannot show. The span is the window plus whatever is worked, so
        // service outside both is real but off-table; saying nothing would make the row look
        // complete.
        const offTable = sum.outside.filter(e => Math.floor(e.t / 60) < minH || Math.floor(e.t / 60) >= maxH).length;
        const offNote = offTable
            ? `${offTable} of those fall outside the hours shown above. `
            : '';

        // The two measures disagree about the weekday peak, and that disagreement is the reason both
        // are kept rather than blended. Stated rather than left to a `title` tooltip, which does not
        // exist on a phone — and computed from the profile, so a timetable swapped in later tells
        // its own truth instead of repeating this one's.
        const pk = peakHours(DEC_2026_DEMAND, 'weekday');
        const peakNote = pk.differ
            ? `Mon–Fri is busiest at ${hhmm(pk.byMv)} by number of trains but ${hhmm(pk.byCars)} by ` +
              `train length — the evening carries more people over fewer movements. `
            : '';

        return `<p class="cov-heat-note dem-note">` +
            `<strong>Trains per hour</strong> shows the service this design has to cover — arrivals ` +
            `and departures together, weighted by train length. ${peakNote}${uncovered}${outside}${offNote}` +
            `<span class="dem-source">${escapeHtml(DEC_2026_SOURCE.label)}` +
            `${DEC_2026_SOURCE.provisional ? ' (provisional)' : ''} — ` +
            `${escapeHtml(DEC_2026_SOURCE.detail)}</span></p>`;
    }

    /**
     * The live summary in the grid card's sticky bar (v19.57) — three figures and a way down.
     *
     * WHY IT EXISTS. The grid card is ~1,400px tall and the Coverage and Design-checks cards start
     * ~1,600px and ~2,300px below the fold (measured at 1440x900). Editing therefore meant: paint a
     * cell, scroll two screens to read the effect, scroll two screens back. The analysis already
     * updated live — you just could not see it happen, which for an inherently iterative task is the
     * single biggest drag on the tool.
     *
     * WHICH THREE, and why not others. They are the three that change what you do next:
     *   1. lines still undesigned — nothing else means anything until this is zero;
     *   2. staffed hours with trains and nobody on duty — the cover-versus-service finding;
     *   3. fatigue factors PRESENT — `standing` is deliberately excluded, because an unavoidable
     *      characteristic of the operation is not something an edit can improve, and putting it in a
     *      number the designer is trying to drive down would be telling them to chase the
     *      unchaseable.
     * Deliberately NOT a score. Same rule as the panels it summarises: show, do not decide.
     *
     * IT RECOMPUTES rather than reading what the other two renderers worked out. That is duplicated
     * WORK, not duplicated LOGIC — every figure still comes from the one pure function that owns it —
     * and it buys order-independence: sharing state between the three would make the strip silently
     * wrong whenever a caller ran them in a different order, which is exactly the kind of bug that
     * renders fine and tells nobody. Over a couple of dozen lines the cost is microseconds.
     */
    function renderSummary() {
        const el = document.getElementById('linksSummary');
        if (!el) return;
        const design = getDesign();
        if (!design) { el.hidden = true; el.innerHTML = ''; return; }
        el.hidden = false;

        const checks = runDesignChecks(design.patterns, ROTATING_LINES);
        const hourly = calcHourlyCoverage(design.patterns, TOTAL_POS);
        const win = normaliseWindow(design.window);
        const sum = summariseDemand({
            profile: DEC_2026_DEMAND,
            movements: DEC_2026_MOVEMENTS,
            hourly,
            days: DAYS,
            windowFor: (day) => minutesOf(windowForDay(win, day)),
        });
        const fat = assessFatigue(design.patterns, ROTATING_LINES);

        const chip = (/** @type {string} */ state, /** @type {string} */ icon,
            /** @type {string|number} */ value, /** @type {string} */ label) =>
            `<span class="sum-chip sum-chip--${state}"><span aria-hidden="true">${icon}</span>` +
            `<strong>${escapeHtml(String(value))}</strong> ${escapeHtml(label)}</span>`;

        // WHOSE FIGURES THESE ARE — stated only when it is ambiguous (v20.00).
        //
        // Every figure in this strip comes from `getDesign()`, the ACTIVE design. In single-design
        // view that is the only thing on screen and saying so would be noise. In COMPARE mode there
        // are two grids up, and an unlabelled "24 lines designed · All service covered · 3 fatigue
        // factors" reads as a verdict on the comparison — which is the one thing it is not.
        //
        // Naming the design is the smaller change than hiding the strip: a designer comparing two
        // options still wants the live analysis of the one they are editing, and hiding it would
        // take that away to fix a labelling problem. The chip is dropped entirely when not
        // comparing, so the ordinary view is unchanged.
        const unfilled = checks.unfilledLines.length;
        el.innerHTML =
            (isComparing() && design.name
                ? `<span class="sum-chip sum-chip--who">${escapeHtml(design.name)}</span>`
                : '')
            + (unfilled
                ? chip('bad', '✗', unfilled, unfilled === 1 ? 'line undesigned' : 'lines undesigned')
                : chip('ok', '✓', ROTATING_LINES, 'lines designed'))
            + (sum.uncovered.length
                ? chip('bad', '⛔', sum.uncovered.length, 'hours uncovered')
                : chip('ok', '✓', 'All', 'service covered'))
            + (fat.present
                ? chip('warn', '⚠', fat.present, 'fatigue factors')
                : chip('ok', '✓', 'No', 'fatigue factors'))
            // HOURS BELONGS IN THE STRIP, not only in the panel (v20.04). This bar exists because
            // the analysis sits ~1,600px below the fold and an edit's effect was otherwise invisible
            // without scrolling two screens away and back. "Does this give people a contracted week"
            // is exactly that kind of figure: it moves the moment a cell changes, and until now it
            // did not exist anywhere at all. Sundays are out (not contracted) — the panel row below
            // carries the full explanation; the chip carries the number.
            //
            // IT COSTS 34px OF STICKY BAR, MEASURED — the row goes 56px to 90px, because a fourth
            // chip tips the summary onto its own line. That is not a shortfall to shorten labels
            // around: at the card's 1068px the line holds Save + Print + the save-meta (min 160px,
            // itself the fix for a worse v19.62 wrap) + 643px of chips, and a fourth chip needs
            // ~123px that is not there at any desktop width — the card is capped by
            // `--content-max-width`, so a wider screen does not help. The two-row bar right-aligns
            // the chips as a group and reads cleanly; the extra height covers about one more grid
            // row while scrolling, which resolves itself (see the note in links.css). Taken
            // deliberately: a figure nobody could see anywhere is worth more than 34px.
            + (() => {
                const wh = weeklyHours(design.patterns, TOTAL_POS);
                if (wh.exSunday === null) return '';
                const off = wh.exSunday - CONTRACTED_HOURS_PER_WEEK;
                // Same gate as the full row below (v20.08): the chip is the only version of this
                // figure most edits ever see, so a partial average must not wear the tick HERE
                // either — that is the copy that would go on being trusted.
                const ok = Math.abs(off) <= 0.5 && wh.complete;
                return chip(ok ? 'ok' : 'warn', ok ? '✓' : '⚠',
                    `${hmFromHours(wh.exSunday)}${wh.complete ? '' : '*'}`, 'a week');
            })()
            + `<a class="sum-jump btn-text-link" href="#coverageCard">Full analysis ↓</a>`;
    }

    /** Traffic-light design quality checks for the active design (or the empty-state message). */
    function renderDesignChecks() {
        const design = getDesign();
        const content = document.getElementById('checksContent');
        if (!content) return;

        if (!design) {
            // Must MIRROR the same panel markup links.html ships for this card (v19.66). This
            // branch replaces the whole card body, so a bare `<p>` here silently undid the empty
            // state on the first re-render after load — the card looked right until anything
            // called this, then reverted to a left-pinned grey line.
            content.innerHTML = '<div class="links-empty-panel">' +
                // Deliberately NOT a green tick — see the note beside the same markup in links.html.
                '<span class="links-empty-icon" aria-hidden="true">📋</span>' +
                '<p class="links-empty-msg">Quality checks and the ORR fatigue factors appear here once a design is loaded or created.</p>' +
                '</div>';
            return;
        }

        const checks = runDesignChecks(design.patterns, ROTATING_LINES);
        const { weekendsOff, weekendsOffPct, totalWeeks, unfilledLines, turnarounds, longestStretch, balance } = checks;
        const { early, late, spare, worked } = balance;
        const earlyPct = worked ? Math.round((early / worked) * 100) : 0;
        const latePct  = worked ? Math.round((late  / worked) * 100) : 0;

        const tick  = `<span class="check-icon check-tick" aria-hidden="true">✓</span>`;
        const warn  = `<span class="check-icon check-warn" aria-hidden="true">⚠</span>`;
        const cross = `<span class="check-icon check-cross" aria-hidden="true">✗</span>`;
        const info  = `<span class="check-icon check-info-icon" aria-hidden="true">ℹ</span>`;

        const rows = [];

        // THE FIRST GROUP HAD NO HEADING WHILE THE THREE BELOW IT ALL DID (v20.04).
        //
        // The card ran: five bare rows, then `COMPANY LIMITS`, then `FATIGUE FACTORS`, then
        // `FOR COMPARISON`. So its structure only became legible a third of the way down, and the
        // opening rows read as loose preamble rather than as a named group with a source of its own
        // — which matters most here, because these are the ONLY rows on the sheet that are this
        // app's own opinion. Everything below is attributed (company policy, ORR p3, today's link);
        // an assessing manager reading the top of the card could not tell where these came from.
        rows.push(
            // No modifier class: `.check-section-head:first-child` already drops the top margin and
            // rule, and `links-analysis.test.mjs` fails on any class this module emits that no
            // stylesheet defines — which is exactly how ~15 rows once shipped on a `check-info`
            // class nothing styled.
            `<div class="check-section-head"><span>This design ` +
            `<span class="check-note">shape of the week — this app's own checks</span></span>` +
            `<span class="check-section-meta">${escapeHtml(`${totalWeeks}-line rotation`)}</span></div>`
        );

        if (unfilledLines.length === 0) {
            rows.push(
                `<div class="check-row check-good">` +
                `${tick}<div class="check-body"><strong>All lines designed</strong> — every one of the ${totalWeeks} rotating lines has a pattern</div>` +
                `</div>`
            );
        } else {
            const cap  = unfilledLines.slice(0, 12);
            const more = unfilledLines.length - cap.length;
            rows.push(
                `<div class="check-row check-bad">` +
                `${cross}<div class="check-body">` +
                `<strong>Lines not yet designed</strong> — ${unfilledLines.length} of ${totalWeeks} line${unfilledLines.length !== 1 ? 's are' : ' is'} still all rest days ` +
                `<span class="check-note">(line${cap.length !== 1 ? 's' : ''} ${cap.join(', ')}${more > 0 ? `, +${more} more` : ''})</span>` +
                `<div class="check-sub">Every rotating line must be filled — manually or by the generator — before the link is complete. Empty lines aren't vacancies; people rotate through them too.</div>` +
                `</div></div>`
            );
        }

        const wkendGood = weekendsOffPct >= 40;
        rows.push(
            `<div class="check-row ${wkendGood ? 'check-good' : 'check-warn-row'}">` +
            `${wkendGood ? tick : warn}` +
            `<div class="check-body">` +
            `<strong>Weekends off</strong> — ${weekendsOff} out of ${totalWeeks} weeks ` +
            `<span class="check-note">(${weekendsOffPct}%)</span>` +
            `<div class="check-sub">A full weekend off = Saturday rest + next Sunday rest.</div>` +
            `</div></div>`
        );

        if (turnarounds.length === 0) {
            rows.push(
                `<div class="check-row check-good">` +
                `${tick}<div class="check-body"><strong>Rest between shifts</strong> — always 12 hours or more</div>` +
                `</div>`
            );
        } else {
            const cap = turnarounds.slice(0, 4);
            const more = turnarounds.length - cap.length;
            rows.push(
                `<div class="check-row check-bad">` +
                `${cross}<div class="check-body">` +
                `<strong>Short turnarounds</strong> — ${turnarounds.length} transition${turnarounds.length !== 1 ? 's' : ''} with less than 12 hours rest` +
                `<ul class="check-list">${cap.map((/** @type {any} */ t) =>
                    `<li>Line ${t.fromLine} ${t.fromDay} (ends ${t.fromShift.split('-')[1] || ''}) → ` +
                    `Line ${t.toLine} ${t.toDay} (starts ${t.toShift.split('-')[0] || ''}) — ` +
                    `${Math.floor(t.restMinutes / 60)}h ${t.restMinutes % 60}m rest</li>`
                ).join('')}${more > 0 ? `<li>…and ${more} more</li>` : ''}</ul>` +
                `</div></div>`
            );
        }

        // The target is the owner's DESIGN AIM, not a limit anybody imposes — the aim is a link that
        // does not go near Chiltern's 13. It is `DEFAULT_MAX_RUN` (6 since v20.02, 7 before it) and
        // it is IMPORTED, because the generator builds to the same number: two copies meant a design
        // could satisfy the generator's aim and still be told something different here. Two more
        // things about this row are load-bearing:
        //
        // **It must say WHICH figure it is measured against.** The hard-limit section below reports
        // the SAME number against 13, so on a design between 8 and 13 the panel shows the identical
        // figure amber here and green there. That is correct — they are different questions — but
        // only if each row states its own threshold. Unlabelled it reads as a contradiction, which
        // is the FF13 mistake of v19.48 (a green tick beneath the amber row it duplicated) in a new
        // place.
        //
        // **It must NOT quote the 13, and must never attribute it to Hidden.** It said "The Hidden
        // limit is 13" until v20.00 — the exact claim the v19.96 external review unwound one row
        // below, surviving here because both evidence guards are scoped elsewhere
        // (`links-limits.test.mjs` reads `assessHardLimits`'s output; `links-analysis.test.mjs`
        // polices headings that claim a limit must be met, and this row makes no such claim). The
        // limit is CHILTERN's, carried in company policy; Hidden is its origin and that standard was
        // WITHDRAWN IN 2007. One row owns that citation and states it properly. A second, looser
        // copy is how the wrong tense got back onto a manager's sheet once already.
        const stretchOk = longestStretch <= DEFAULT_MAX_RUN;
        const hasSpare = spare > 0;
        rows.push(
            `<div class="check-row ${stretchOk ? 'check-good' : 'check-warn-row'}">` +
            `${stretchOk ? tick : warn}<div class="check-body">` +
            `<strong>Longest run</strong> — ${longestStretch} consecutive working days` +
            `<span class="check-note"> (design target: no more than ${DEFAULT_MAX_RUN})</span>` +
            (longestStretch > 7
                ? `<div class="check-sub">Over the ${DEFAULT_MAX_RUN}-day design target — worth reviewing. `
                  + `This is an aim, not a limit; the company limit is checked separately below.</div>`
                : '') +
            // Say what the number is once a spare week can affect it. It is the WORST CASE over
            // every placement of that week's four duties, and a reader who assumes otherwise will
            // read it as a fact about the design rather than a ceiling on it.
            (hasSpare ? `<div class="check-sub">A spare week is 4 duties of 7 and they can fall anywhere in it, so this is the worst case.</div>` : '') +
            `</div></div>`
        );

        rows.push(
            `<div class="check-row check-neutral">` +
            `${info}<div class="check-body">` +
            `<strong>Shift balance</strong> — ${early} early / ${late} late / ${spare} spare` +
            ` across the ${TOTAL_POS}-line rotation` +
            `<span class="check-note"> (${earlyPct}% early, ${latePct}% late)</span>` +
            `</div></div>`
        );

        // ── HOURS A WEEK (v20.04) ────────────────────────────────────────────
        //
        // The most basic question anybody asks of a roster — "does it give people their contracted
        // hours?" — and this panel could not answer it. It reported weekends, rest, run length and
        // shift balance, all of which are about the SHAPE of the week, and never how much of it is
        // work. A design can be beautifully shaped and still under-fill everybody.
        //
        // SUNDAYS COME OUT. Sunday is not contracted for any grade here, so a Sunday duty sits on
        // top of the contract; counting it towards 35 would report a design as delivering the
        // contracted hours using time that is not contracted. It is shown separately instead — it
        // is real work and real pay, it is just not part of this comparison.
        //
        // The cover weeks come out of the DENOMINATOR for a different reason: they carry no times,
        // so dividing by all 24 lines charges the average with four weeks of zero and reports a
        // number nobody works. Both exclusions are stated in the row rather than assumed.
        const wh = weeklyHours(design.patterns, TOTAL_POS);
        if (wh.exSunday !== null) {
            // A THRESHOLD IS DEFENSIBLE HERE, unlike the ORR factors — 35 is the contract, not
            // guidance, so short IS short. Half an hour of slack absorbs the rounding that comes
            // from duties measured to the minute; the live main roster lands on 35.00 exactly.
            const off = wh.exSunday - CONTRACTED_HOURS_PER_WEEK;
            // `complete` gates the TICK, not the number. A design with a whole line nobody could
            // read still deserves its figure — what it must not get is the green tick, because the
            // figure was computed over a smaller rotation than the one on screen (v20.08).
            const onTarget = Math.abs(off) <= 0.5 && wh.complete;
            const hm = hmFromHours;
            rows.push(
                `<div class="check-row ${onTarget ? 'check-good' : 'check-warn-row'}">` +
                `${onTarget ? tick : warn}<div class="check-body">` +
                `<strong>Hours a week</strong> — ${hm(wh.exSunday)} on each of the ${wh.workingLines} working lines` +
                (wh.complete ? '' : ` <strong>(partial)</strong>`) +
                `<span class="check-note"> (contracted: ${CONTRACTED_HOURS_PER_WEEK}h, Sundays excluded)</span>` +
                (onTarget ? '' :
                    `<div class="check-sub">${off < 0
                        ? `<strong>${hm(Math.abs(off))} a week short of contract.</strong> The same work spread over more lines gives each person less of it — adding lines without adding duties does this.`
                        : `<strong>${hm(off)} a week over contract.</strong> The surplus has to be paid as overtime or absorbed by adding lines.`}</div>`) +
                `<div class="check-sub">Sundays are not contracted, so they are left out of that figure` +
                (wh.sundayDuties ? ` — ${wh.sundayDuties} Sunday duties, ${hm(wh.sundayHours)} across the rotation, on top` : '') +
                `. The ${wh.coverLines} cover week${wh.coverLines === 1 ? '' : 's'} carry no times, so they are not in the average either.</div>` +
                (wh.unreadable
                    ? `<div class="check-sub">${wh.unreadable} worked cell${wh.unreadable === 1 ? '' : 's'} could not be read as a time and added no hours — the real figure is higher.` +
                      (wh.unreadableLines
                          ? ` <strong>${wh.unreadableLines} whole line${wh.unreadableLines === 1 ? ' has' : 's have'} no readable time at all, so ${wh.unreadableLines === 1 ? 'it is' : 'they are'} not in the average and this figure is partial.</strong>`
                          : '') +
                      `</div>`
                    : '') +
                `</div></div>`
            );
        }

        // ── ORR fatigue factors (p3) ─────────────────────────────────────────
        // Reported as factors PRESENT, never as pass/fail: the ORR is explicit that these are not
        // prescriptive limits. The greatest risk in this panel is a design showing nothing and being
        // read as approved, so clear and not-applicable factors are listed too — silence must not be
        // the same shape as compliance.
        const fat = assessFatigue(design.patterns, ROTATING_LINES);
        const base = getBaseline();
        const fatRows = [];

        // The headline counts go in the section HEADING, so the reader has the summary before the
        // rows rather than having to tally 24 icons. `standing` is reported separately from
        // `present` on purpose — an unavoidable characteristic of the operation is not a finding
        // about this design, and adding the two together would say it was.
        // `clear` joins the headline counts (v19.57): the clear rows are now behind a disclosure, so
        // without it the heading would understate how much was actually checked — which is the exact
        // false-assurance failure running the other way.
        const quietCount = fat.results.filter(r => r.status === 'clear' || r.status === 'n/a').length;
        const meta = [
            `${fat.present} present`,
            fat.standing ? `${fat.standing} standing` : '',
            fat.confirmNeeded ? `${fat.confirmNeeded} to confirm` : '',
            quietCount ? `${quietCount} clear` : '',
        ].filter(Boolean).join(' · ');

        // ── THE HARD LIMIT, ABOVE THE ADVISORY FACTORS AND VISIBLY NOT ONE OF THEM (v19.80) ──────
        // 13 consecutive worked days is CHILTERN's roster limit, historically derived from the
        // post-Clapham Hidden standard (v19.96) — a company limit, not legislation and not a
        // current industry-wide rule: the group standard that carried it was withdrawn in 2007 and
        // the ORR now expects a risk-based fatigue management system instead. This heading said
        // "Industry limits · Hidden report — must be met" from v19.90 to v19.95, which an assessing
        // manager who checked the citation would have found to be nineteen years out of date — and
        // would then reasonably have discounted everything else on the sheet. Full history and the
        // 13-in-14 equivalence argument: links-limits.js.
        //
        // It is still a different KIND of statement from anything below it: a design either meets the
        // configured figure or it does not. Neither correction — v19.96's, about whose limit it is,
        // nor v20.08's, about how well sourced it is — touches that structure. It gets
        // its own section, its own heading, `.check-bad` RED on a breach (the class the fatigue half
        // is forbidden from using), and — unlike every advisory row — it renders whether it passes or
        // fails, because "the limit was checked and met" has to be visible on the sheet that
        // goes to the assessing manager rather than hidden behind a disclosure.
        // Its counts are deliberately NOT added to the fatigue heading's tally. See links-limits.js.
        const limits = assessHardLimits(design.patterns, ROTATING_LINES);
        const LIMIT_ICON = { ok: tick, breach: `<span class="check-icon check-cross" aria-hidden="true">✕</span>`, unknown: info };
        const LIMIT_CLS  = { ok: 'check-good', breach: 'check-bad', unknown: 'check-neutral' };
        // ── THE CLAIM'S STRENGTH IS DERIVED, NEVER TYPED (v20.08, external review P1) ────────────
        // This heading said "Chiltern roster policy — must be met" from v19.96 to v20.07 over a limit
        // whose evidence is class C (the owner's account of practice), while ROADMAP.md's own gate
        // requires class A or B for exactly that phrase. It now reads from `POLICY_SOURCE_CONFIRMED`
        // in links-limits.js, which is the single home of that judgement — so the heading, the row's
        // `basis` and its prose cannot end up disagreeing, which is how all four previous
        // attributions went wrong. `data-claim="limit"` is the tests' anchor: it survives a rename of
        // the section, which a hardcoded "Company limits" string does not.
        const limitClaim = POLICY_SOURCE_CONFIRMED
            ? 'Chiltern roster policy — must be met'
            : 'Configured Chiltern limit — policy source outstanding';
        fatRows.push(
            `<div class="check-section-head" data-claim="limit"><span>Company limits <span class="check-note">${escapeHtml(limitClaim)}</span></span>` +
            `<span class="check-section-meta${limits.breaches ? ' check-section-meta-breach' : ''}">` +
            `${escapeHtml(limits.breaches ? `${limits.breaches} breached` : limits.assessable ? 'within limits' : 'not yet assessable')}</span></div>`,
            ...limits.checks.map(c =>
                `<div class="check-row ${LIMIT_CLS[c.status]}">${LIMIT_ICON[c.status]}<div class="check-body">` +
                `${escapeHtml(c.title)}${c.value === null ? '' : ` — <strong>${escapeHtml(String(c.value))}</strong>`}` +
                ` <span class="check-note">${escapeHtml(c.basis)}</span>` +
                `<div class="check-sub">${escapeHtml(c.detail)}</div>` +
                `</div></div>`
            ),
        );

        fatRows.push(
            `<div class="check-section-head"><span>Fatigue factors <span class="check-note">ORR good practice, p3</span></span>` +
            `<span class="check-section-meta">${escapeHtml(meta)}</span></div>`,
            `<div class="check-row check-neutral"><span class="check-icon check-info-icon" aria-hidden="true">ℹ</span>` +
            `<div class="check-body">These are <strong>not pass/fail limits</strong>. The more factors a pattern features, ` +
            `the greater the need to justify, minimise, then assess and control the risk. This panel is an aid to that ` +
            `conversation, not a fatigue risk assessment.</div></div>`,
            // The hours caveat, stated where the hours are read (v19.59). `assessFatigue` has always
            // returned `hoursAreFloor` "so the UI can say so" and the UI never did. It matters more
            // since spare became a whole WEEK: a spare line carries no times at all, so it now
            // contributes seven worked days and ZERO hours, and every hours figure below understates
            // by a whole standby week per spare line. Under-reporting hours in a fatigue panel is the
            // flattering direction, which is the one thing this panel must not do quietly.
            ...(fat.hoursAreFloor ? [
                `<div class="check-row check-neutral"><span class="check-icon check-info-icon" aria-hidden="true">ℹ</span>` +
                `<div class="check-body">Every hours figure here is a <strong>floor, not an estimate</strong>. A spare week ` +
                `carries no times, so it counts as worked days but adds no hours — the real totals are higher.</div></div>`,
            ] : [])
        );

        const ICON = { present: warn, clear: tick, standing: info, 'n/a': info };
        const CLS  = { present: 'check-warn-row', clear: 'check-good', standing: 'check-neutral', 'n/a': 'check-neutral' };
        // The family label is what makes the ORDER legible. p3 groups the factors into families, and
        // this panel follows that grouping — but with the families invisible, the code column read as
        // shuffled (FF11 then FF10 then MRSF then FF17). Naming them costs a quiet line per group and
        // matches the document the reader will have open beside this.
        // Rows that report NOTHING TO REPORT — `clear` and `n/a` — are pulled out into a disclosure
        // rather than printed inline (v19.57). Measured, the card ran 1,799px: 24 rows of which 16
        // said nothing had happened, so the 8 real findings were diluted five to one and you scrolled
        // a card taller than the grid it describes to reach them.
        //
        // THIS DOES NOT WEAKEN THE "SILENCE IS NOT COMPLIANCE" RULE, and it must not be allowed to.
        // Three things keep it honest: the counts stay in the always-visible section heading (with
        // `clear` now among them, which it was not before); the disclosure is labelled with what is
        // inside and is one click away; and CLEAR and NOT-APPLICABLE keep their separate icons and
        // wording inside it, because "we checked and it is fine" and "this cannot apply here" are
        // still two different answers. What is hidden is the PROSE, never the fact of the check.
        //
        // `present` and `standing` always render inline. Standing is not a finding, but it IS a real
        // characteristic of the operation, and the assessing manager will ask about it.
        const quietRows = /** @type {string[]} */ ([]);
        let family = '', quietFamily = '';
        for (const r of fat.results) {
            if (r.status === 'n/a' && r.family === NIGHT_FAMILY) continue;   // rolled up below
            const quiet = r.status === 'clear' || r.status === 'n/a';
            const into = quiet ? quietRows : fatRows;
            const seen = quiet ? quietFamily : family;
            if (r.family !== seen) {
                if (quiet) quietFamily = r.family; else family = r.family;
                into.push(`<div class="check-family">${escapeHtml(r.family)}</div>`);
            }
            // A count of 0 on a NOT-APPLICABLE row is noise dressed as data — "FF1 Night shift
            // covering 00:00–05:00 — 0" invites the reader to weigh a number that only means the
            // rule never ran. The detail line already says why it does not apply.
            const showVal = r.status !== 'n/a' && r.value !== undefined && r.value !== '';
            const val = showVal ? ` — <strong>${escapeHtml(String(r.value))}</strong>` : '';
            const conf = r.confirm ? ` <span class="check-note">(definition to confirm)</span>` : '';
            into.push(
                `<div class="check-row ${CLS[r.status]}">${ICON[r.status]}<div class="check-body">` +
                `<span class="check-code">${escapeHtml(r.code)}</span>${escapeHtml(r.title)}${val}${conf}` +
                (r.detail ? `<div class="check-sub">${escapeHtml(r.detail)}</div>` : '') +
                `</div></div>`
            );
        }
        // The night-family rollup belongs INSIDE the disclosure, not beside it (v19.57). With it
        // outside, the heading counted 17 clear while the disclosure label said 10 — both true (the
        // other 7 were in the rollup) and impossible to reconcile by looking. Everything that reports
        // "nothing to report" now lives in one place, so the two numbers agree.
        const nightRolled = fat.results.filter(r => r.family === NIGHT_FAMILY);
        if (nightRolled.length && nightRolled.every(r => r.status === 'n/a')) {
            quietRows.push(
                `<div class="check-family">${escapeHtml(NIGHT_FAMILY)}</div>`,
                `<div class="check-row check-neutral">${info}<div class="check-body">` +
                `<span class="check-code">×${nightRolled.length}</span>Night-shift factors do not apply` +
                `<div class="check-sub">${escapeHtml(nightRolled.map(r => r.code).join(' · '))}` +
                ` — no duty reaches into 00:00–05:00. These become live the moment one does.</div>` +
                `</div></div>`
            );
        }

        if (quietRows.length) {
            const n = fat.results.filter(r => r.status === 'clear' || r.status === 'n/a').length;
            fatRows.push(
                `<details class="check-quiet"><summary class="check-quiet-summary">` +
                `<span class="check-quiet-label">${n} factor${n === 1 ? '' : 's'} with nothing to report</span>` +
                `<span class="check-note">checked, and either clear or not applicable</span>` +
                `</summary><div class="check-quiet-body">${quietRows.join('')}</div></details>`
            );
        }

        if (base) {
            fatRows.push(
                `<div class="check-section-head"><span>For comparison — today's link</span>` +
                `<span class="check-section-meta">not part of this design</span></div>`,
                `<div class="check-row check-neutral">${info}<div class="check-body">` +
                escapeHtml(base.summary) +
                `<div class="check-sub">${escapeHtml(base.detail)}</div>` +
                `</div></div>`
            );
        }

        content.innerHTML = `<div class="check-rows">${rows.join('')}${fatRows.join('')}</div>`;
    }

    return { renderCoverageChart, renderDesignChecks, renderSummary };
}
