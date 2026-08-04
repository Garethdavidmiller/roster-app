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
 * `initLinksAnalysis({ getDesign, getBaseline })` returns `{ renderCoverageChart, renderDesignChecks }`.
 * The coordinator passes a getter for the live active design (or null) and calls the two renderers on
 * every pattern change. `getBaseline` (v19.46) supplies the CURRENT link's fatigue profile so a
 * design's findings can be read against what today's roster already scores — without it, a proposal
 * reporting "15 consecutive shifts" reads as something the proposal introduced.
 */
import { DAYS, ROTATING_LINES, calcHourlyCoverage, runDesignChecks } from './links-design.js';
import { assessFatigue } from './links-fatigue.js';
import { normaliseWindow, heatSpan, isHourStaffed, formatWindow, isDefaultWindow } from './links-window.js';
import { escapeHtml } from './roster-data.js';

// Presentation constant. The rotation LENGTH is imported (v19.38) — it used to be a local copy of
// 28 alongside links-app.js's own pair, with a comment claiming they "stay in step without a shared
// import". Three literals kept in step by hope is how a grid renders 28 rows while the checks
// examine a different number, silently.
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
 * @param {object} deps
 * @param {() => ({ patterns: Record<string, any>, window?: any } | null)} deps.getDesign - the live active design, or null
 * @param {() => ({ summary: string, detail: string } | null)} [deps.getBaseline] - the current link's profile
 * @returns {{ renderCoverageChart: () => void, renderDesignChecks: () => void }}
 */
export function initLinksAnalysis({ getDesign, getBaseline = () => null }) {
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

        const winNote = `Staffed window: <strong>${escapeHtml(formatWindow(win))}</strong>` +
            (isDefaultWindow(win) ? '' : ' <em>(moved from the standard hours)</em>');
        const gapNote = gapCount
            ? ` <strong>${gapCount} staffed hour${gapCount === 1 ? '' : 's'} with nobody on duty.</strong>`
            : '';
        const outNote = outsideCount
            ? ` ${outsideCount} hour${outsideCount === 1 ? ' is' : 's are'} rostered outside the staffed window.`
            : '';

        wrap.innerHTML =
            `<p class="cov-window-line">${winNote}</p>` +
            `<div class="cov-heat-wrap"><table class="cov-heat">` +
            `<thead><tr><th class="cov-heat-day"></th>${hourTh.join('')}<th class="cov-heat-spare-h">SP</th></tr></thead>` +
            `<tbody>${rows}</tbody>` +
            `</table></div>` +
            `<p class="cov-heat-note">Each cell shows how many people are on duty during that hour — darker means more. ` +
            `Red 0 = the station is open and nobody is on. Grey = outside the staffed window. ` +
            `SP = spares on standby (no fixed time). Peak this week: ${maxCount}.${gapNote}${outNote}</p>`;
    }

    /** Traffic-light design quality checks for the active design (or the empty-state message). */
    function renderDesignChecks() {
        const design = getDesign();
        const content = document.getElementById('checksContent');
        if (!content) return;

        if (!design) {
            content.innerHTML = '<p class="links-empty-msg">Load or create a link design to see quality checks.</p>';
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

        const stretchOk = longestStretch <= 7;
        rows.push(
            `<div class="check-row ${stretchOk ? 'check-good' : 'check-warn-row'}">` +
            `${stretchOk ? tick : warn}<div class="check-body">` +
            `<strong>Longest run</strong> — ${longestStretch} consecutive working days` +
            (longestStretch > 7 ? `<div class="check-sub">Over 7 days without a rest — worth reviewing.</div>` : '') +
            `</div></div>`
        );

        rows.push(
            `<div class="check-row check-neutral">` +
            `${info}<div class="check-body">` +
            `<strong>Shift balance</strong> — ${early} early / ${late} late / ${spare} spare` +
            ` across the 28-line rotation` +
            `<span class="check-note"> (${earlyPct}% early, ${latePct}% late)</span>` +
            `</div></div>`
        );

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
        const meta = [
            `${fat.present} present`,
            fat.standing ? `${fat.standing} standing` : '',
            fat.confirmNeeded ? `${fat.confirmNeeded} to confirm` : '',
        ].filter(Boolean).join(' · ');

        fatRows.push(
            `<div class="check-section-head"><span>Fatigue factors <span class="check-note">ORR good practice, p3</span></span>` +
            `<span class="check-section-meta">${escapeHtml(meta)}</span></div>`,
            `<div class="check-row check-neutral"><span class="check-icon check-info-icon" aria-hidden="true">ℹ</span>` +
            `<div class="check-body">These are <strong>not pass/fail limits</strong>. The more factors a pattern features, ` +
            `the greater the need to justify, minimise, then assess and control the risk. This panel is an aid to that ` +
            `conversation, not a fatigue risk assessment.</div></div>`
        );

        const ICON = { present: warn, clear: tick, standing: info, 'n/a': info };
        const CLS  = { present: 'check-warn-row', clear: 'check-good', standing: 'check-neutral', 'n/a': 'check-neutral' };
        // The family label is what makes the ORDER legible. p3 groups the factors into families, and
        // this panel follows that grouping — but with the families invisible, the code column read as
        // shuffled (FF11 then FF10 then MRSF then FF17). Naming them costs a quiet line per group and
        // matches the document the reader will have open beside this.
        let family = '';
        for (const r of fat.results) {
            if (r.status === 'n/a' && r.family === NIGHT_FAMILY) continue;   // rolled up below
            if (r.family !== family) {
                family = r.family;
                fatRows.push(`<div class="check-family">${escapeHtml(family)}</div>`);
            }
            // A count of 0 on a NOT-APPLICABLE row is noise dressed as data — "FF1 Night shift
            // covering 00:00–05:00 — 0" invites the reader to weigh a number that only means the
            // rule never ran. The detail line already says why it does not apply.
            const showVal = r.status !== 'n/a' && r.value !== undefined && r.value !== '';
            const val = showVal ? ` — <strong>${escapeHtml(String(r.value))}</strong>` : '';
            const conf = r.confirm ? ` <span class="check-note">(definition to confirm)</span>` : '';
            fatRows.push(
                `<div class="check-row ${CLS[r.status]}">${ICON[r.status]}<div class="check-body">` +
                `<span class="check-code">${escapeHtml(r.code)}</span>${escapeHtml(r.title)}${val}${conf}` +
                (r.detail ? `<div class="check-sub">${escapeHtml(r.detail)}</div>` : '') +
                `</div></div>`
            );
        }
        const nightRolled = fat.results.filter(r => r.family === NIGHT_FAMILY);
        if (nightRolled.length && nightRolled.every(r => r.status === 'n/a')) {
            // Its OWN family label. The rollup is emitted after the loop, so without this it lands
            // under whichever family happened to come last and reads as belonging to it.
            fatRows.push(
                `<div class="check-family">${escapeHtml(NIGHT_FAMILY)}</div>`,
                `<div class="check-row check-neutral">${info}<div class="check-body">` +
                `<span class="check-code">×${nightRolled.length}</span>Night-shift factors do not apply` +
                `<div class="check-sub">${escapeHtml(nightRolled.map(r => r.code).join(' · '))}` +
                ` — no duty reaches into 00:00–05:00. These become live the moment one does.</div>` +
                `</div></div>`
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

    return { renderCoverageChart, renderDesignChecks };
}
