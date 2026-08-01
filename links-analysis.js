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
import { escapeHtml } from './roster-data.js';

// Presentation constant. The rotation LENGTH is imported (v19.38) — it used to be a local copy of
// 28 alongside links-app.js's own pair, with a comment claiming they "stay in step without a shared
// import". Three literals kept in step by hope is how a grid renders 28 rows while the checks
// examine a different number, silently.
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TOTAL_POS = ROTATING_LINES;

/**
 * @param {object} deps
 * @param {() => ({ patterns: Record<string, any> } | null)} deps.getDesign - the live active design, or null
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

        let minH = 24, maxH = 0, maxCount = 0;
        for (const d of DAYS) {
            hourly[d].hours.forEach((/** @type {number} */ n, /** @type {number} */ h) => {
                if (n > 0) {
                    if (h < minH) minH = h;
                    if (h + 1 > maxH) maxH = h + 1;
                    if (n > maxCount) maxCount = n;
                }
            });
        }
        if (minH >= maxH) { minH = 6; maxH = 24; }

        const hourTh = [];
        for (let h = minH; h < maxH; h++) {
            hourTh.push(`<th class="cov-heat-hour">${String(h).padStart(2, '0')}</th>`);
        }

        const rows = DAYS.map((/** @type {string} */ d, /** @type {number} */ di) => {
            const { hours, spare } = hourly[d];
            const dayHasWork = hours.some((/** @type {number} */ n) => n > 0);
            const first = hours.findIndex((/** @type {number} */ n) => n > 0);
            const last  = hours.length - 1 - [...hours].reverse().findIndex((/** @type {number} */ n) => n > 0);
            const cells = [];
            for (let h = minH; h < maxH; h++) {
                const n = hours[h];
                const bucket = n === 0 ? 0 : Math.max(1, Math.ceil((n / maxCount) * 5));
                const isGap = dayHasWork && n === 0 && h > first && h < last;
                cells.push(`<td class="cov-heat-cell heat-b${bucket}${isGap ? ' heat-gap' : ''}">${n || (isGap ? '0' : '')}</td>`);
            }
            return `<tr>` +
                `<th class="cov-heat-day">${DAY_LABELS[di]}</th>` +
                cells.join('') +
                `<td class="cov-heat-spare">${spare || ''}</td>` +
                `</tr>`;
        }).join('');

        wrap.innerHTML =
            `<div class="cov-heat-wrap"><table class="cov-heat">` +
            `<thead><tr><th class="cov-heat-day"></th>${hourTh.join('')}<th class="cov-heat-spare-h">SP</th></tr></thead>` +
            `<tbody>${rows}</tbody>` +
            `</table></div>` +
            `<p class="cov-heat-note">Each cell shows how many people are on duty during that hour — darker means more. ` +
            `Red 0 = a gap inside the working day. SP = spares on standby (no fixed time). Peak this week: ${maxCount}.</p>`;
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

        fatRows.push(
            `<div class="check-section-head">Fatigue factors <span class="check-note">ORR good practice, p3</span></div>`,
            `<div class="check-row check-info"><span class="check-icon check-info-icon" aria-hidden="true">ℹ</span>` +
            `<div class="check-body">These are <strong>not pass/fail limits</strong>. The more factors a pattern features, ` +
            `the greater the need to justify, minimise, then assess and control the risk. This panel is an aid to that ` +
            `conversation, not a fatigue risk assessment.</div></div>`
        );

        const ICON = { present: warn, clear: tick, standing: info, 'n/a': info };
        const CLS  = { present: 'check-warn-row', clear: 'check-good', standing: 'check-info', 'n/a': 'check-info' };
        for (const r of fat.results) {
            if (r.status === 'n/a' && r.family === 'Night (not applicable)') continue;   // rolled up below
            const val = (r.value !== undefined && r.value !== '') ? ` — <strong>${escapeHtml(String(r.value))}</strong>` : '';
            const conf = r.confirm ? ` <span class="check-note">(definition to confirm)</span>` : '';
            fatRows.push(
                `<div class="check-row ${CLS[r.status]}">${ICON[r.status]}<div class="check-body">` +
                `<span class="check-note">${escapeHtml(r.code)}</span> ${escapeHtml(r.title)}${val}${conf}` +
                (r.detail ? `<div class="check-sub">${escapeHtml(r.detail)}</div>` : '') +
                `</div></div>`
            );
        }
        const nightRolled = fat.results.filter(r => r.family === 'Night (not applicable)');
        if (nightRolled.length && nightRolled.every(r => r.status === 'n/a')) {
            fatRows.push(
                `<div class="check-row check-info">${info}<div class="check-body">` +
                `<span class="check-note">${nightRolled.map(r => r.code).join(' · ')}</span> Night-shift factors do not apply` +
                `<div class="check-sub">No duty reaches into 00:00–05:00. These become live the moment one does.</div>` +
                `</div></div>`
            );
        }

        if (base) {
            fatRows.push(
                `<div class="check-section-head">For comparison — today's link</div>`,
                `<div class="check-row check-info">${info}<div class="check-body">` +
                escapeHtml(base.summary) +
                `<div class="check-sub">${escapeHtml(base.detail)}</div>` +
                `</div></div>`
            );
        }

        content.innerHTML = `<div class="check-rows">${rows.join('')}${fatRows.join('')}</div>`;
    }

    return { renderCoverageChart, renderDesignChecks };
}
