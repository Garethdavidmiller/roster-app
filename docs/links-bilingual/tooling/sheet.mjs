// Builds links-bilingual-6-line-options.pdf (one folder up) from options.json: today's link and the three
// options drawn as rosters, then the numbers and each option's gains and costs. Every figure is worked
// out from the rosters by rules.mjs; only the wording is written here. Run check.mjs first.
//   node docs/links-bilingual/tooling/sheet.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { DAYS, TODAY, TODAY_TIMES, isDuty, isCover, startOf, week, weekends, measure, fmtHours } from './rules.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const OUT = here('../links-bilingual-6-line-options.pdf');
const HTML = join(tmpdir(), 'links-bilingual-6-line-options.html');   // a working file, never committed
const options = JSON.parse(readFileSync(here('./options.json'), 'utf8'));
const css = readFileSync(here('./sheet.css'), 'utf8').replace('{{FONT}}', new URL('../../../fonts/inter-latin.woff2', import.meta.url).href);
const DATE = '27 November 2026';
const TITLE = 'Bilingual roster — today and three 6-line options';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const dash = (v) => v.replace('-', '–');
const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// ---- the rosters ---------------------------------------------------------------------------------
const WEEKEND_LABEL = { off: ['Off', 'off'], both: ['Both days', 'both'], depends: ['Depends', 'dep'] };
function table(lines, markNew) {
    const kinds = weekends(lines).each;
    let out = '<table class="roster"><colgroup><col class="ln"><col><col><col><col><col><col><col><col class="sp"><col class="sum"><col class="wk"></colgroup>'
        + '<thead><tr><th style="text-align:left">Line</th><th class="we">Sun</th><th>Mon</th><th>Tue</th><th>Wed</th><th>Thu</th><th>Fri</th><th class="we">Sat</th><th></th><th style="text-align:right">Mon–Sat</th><th>Weekend*</th></tr></thead><tbody>';
    lines.forEach((l, i) => {
        let [label, cls] = WEEKEND_LABEL[kinds[i]] ?? [];
        if (kinds[i] === 'one') [label, cls] = [isDuty(l.sat) ? 'Sat only' : 'Sun only', 'one'];
        out += `<tr><td class="ln">${i + 1}</td>`;
        if (isCover(l)) out += '<td class="c" colspan="7">Cover week</td>';
        else for (const d of DAYS) {
            const v = l[d];
            if (!isDuty(v)) { out += '<td class="r">Rest</td>'; continue; }
            const c = (startOf(v) < 11 * 60 ? 'e' : 'l') + (markNew && !TODAY_TIMES.has(v) ? ' new' : '');
            out += `<td class="${c}">${dash(v)}</td>`;
        }
        const w = isCover(l) ? { days: 4, hours: 35 } : week(l);
        out += `<td></td><td class="sum">${w.days} days · ${fmtHours(w.hours)}h</td><td class="wk ${cls}">${label}</td></tr>`;
    });
    return out + '</tbody></table>';
}
const block = (badge, title, tag, lines, markNew = true) =>
    `<div class="block"><div class="bhead"><span class="badge">${badge}</span><h2>${title}</h2><span class="tag">${esc(tag)}</span></div>${table(lines, markNew)}</div>`;
const KEY = `<div class="key">
    <span><i class="sw" style="background:var(--early)"></i>Early, starts before 11:00</span>
    <span><i class="sw" style="background:var(--late)"></i>Late, starts 11:00 or after</span>
    <span><i class="sw new"></i>Duty time not on today's roster</span>
    <span><i class="sw" style="background:var(--off)"></i>Weekend off</span>
    <span><i class="sw" style="background:var(--one)"></i>One day of the weekend worked</span>
    <span><i class="sw" style="background:var(--both)"></i>Both days worked</span>
  </div>`;
const foot = (n) => `<div class="foot"><span>${TITLE}</span><span>Page ${n} of 3</span></div>`;

// ---- the numbers ---------------------------------------------------------------------------------
const M = { T: measure(TODAY), A: measure(options.A), B: measure(options.B), W: measure(options.W) };
const yr = (m, x) => Math.round(x * m.perYear);
const range = ([a, b], unit = '') => (a === b ? `${fmtHours(a)}${unit}` : `${fmtHours(a)}–${fmtHours(b)}${unit}`);
/** One row: the four values, and which way is better, so each option is marked against today. */
function row(label, note, values, better) {
    const [t, ...rest] = values;
    const mark = (v) => (better === null || v.cmp === t.cmp ? '' : (better === 'up') === (v.cmp > t.cmp) ? ' better' : ' worse');
    return `<tr><td>${label}${note ? ` <span class="small">— ${note}</span>` : ''}</td><td class="n${t.cmp > (t.limit ?? Infinity) ? ' worse' : ''}">${t.text}</td>`
        + rest.map(v => `<td class="n${mark(v)}">${v.text}</td>`).join('') + '</tr>';
}
const each = (f) => ['T', 'A', 'B', 'W'].map(k => f(M[k], k));
const n = (x) => ({ text: String(x), cmp: x });
const ROWS = [
    '<tr class="group"><td colspan="5">Weekends</td></tr>',
    row('Whole weekends off', '', each(m => n(yr(m, m.weekends.off))), 'up'),
    row('Weekends with one day worked', '', each(m => n(yr(m, m.weekends.one))), 'down'),
    row('Weekends with both days worked', '', each(m => n(yr(m, m.weekends.both))), 'down'),
    row('Saturdays worked', '', each(m => n(yr(m, m.saturdays))), null),
    row('Sundays worked', '', each(m => ({ text: `${yr(m, m.sundays)} × ${m.sundayHours.join('/')}h`, cmp: 0 })), null),
    '<tr class="group"><td colspan="5">Pay and early starts</td></tr>',
    row('Weekend extra pay, in hours of basic pay', 'Saturdays 0.25 on top, Sundays 1.5', each(m => n(yr(m, m.extraPay))), 'up'),
    row('Earliest starts', '', each(m => ({ text: `${yr(m, m.earliestCount)} at ${clock(m.earliest)}`, cmp: yr(m, m.earliestCount) * 10000 - m.earliest })), 'down'),
    '<tr class="group"><td colspan="5">Workload, fatigue and cover</td></tr>',
    row('Days and hours a week, Monday to Saturday', '', each(m => ({ text: `${range(m.days)} days, ${range(m.hours, 'h')}`, cmp: m.days[0] === m.days[1] && m.hours[0] === m.hours[1] ? 1 : 0 })), 'up'),
    row('Fatigue risk factors present', '', each(m => ({ ...n(m.fatigue.present), limit: 0 })), 'down'),
    row('Most shifts in a row without a two-day break', 'the limit is 13', each(m => ({ ...n(m.fatigue.ff11), limit: 13 })), 'down'),
    row('Shortest rest between duties', 'the limit is 12 hours', each(m => ({ text: `${fmtHours(Math.round(m.shortestRest / 6) / 10)}h`, cmp: m.shortestRest })), null),
    row('Friday-to-Sunday breaks', '', each(m => n(yr(m, m.longBreaks))), 'up'),
    row('Bilingual colleagues on each weekday and Saturday', 'not counting cover', each(m => ({ text: range(m.cover), cmp: 0 })), null),
    row('Duty times not on today\'s roster', '', each((m, k) => (k === 'T' ? { text: '—', cmp: 0 } : n(m.newTimes.length))), null),
];

// ---- the words -----------------------------------------------------------------------------------
const { A, B, W, T } = M;
const extraW = yr(W, W.extraPay) - yr(B, B.extraPay);
const perStart = Math.round(extraW / yr(W, W.earliestCount) * 60);
const minutesEarlier = B.earliest - W.earliest;
const li = (sign, strong, rest) => `<li><span class="mark">${sign}</span><span><strong>${strong}</strong>${rest}</span></li>`;
const card = (badge, title, gains, costs) => `<div class="opt"><div class="bhead"><span class="badge">${badge}</span><h2>${title}</h2></div>
      <div class="plus"><h3>Gains</h3><ul>${gains.map(g => li('+', ...g)).join('')}</ul></div>
      <div class="minus"><h3>Costs</h3><ul>${costs.map(c => li('−', ...c)).join('')}</ul></div></div>`;
const list = (xs) => xs.map(dash).join(xs.length > 2 ? ', ' : ' and ').replace(/, ([^,]*)$/, ' and $1');

const p1 = `<section class="page">
  <div><div class="eyebrow">Marylebone · bilingual roster · discussion draft · ${DATE}</div>
  <h1>Today's 8 lines, and three ways to do it in 6</h1></div>
  <p class="lede">Every 6-line option has 5 lines with fixed duties and 1 cover week. Every line works <strong>exactly 4 days and 35 hours, Monday to Saturday</strong>, and every option meets every fatigue rule. As today, there is an early start and a bilingual colleague until at least 23:30 every day from Monday to Saturday, and an early and a late on Sunday. Each person works 1 Saturday in 2, as today, and 1 Sunday in 3 (today it is 1 in 4). <strong>Option A</strong> stays as close to today as it can. <strong>Option B</strong> brings the weekend work together so more weekends come off whole. <strong>The wildcard</strong> is Option B with longer Sundays, in return for the 07:00 starts opening the station at 06:20.</p>
  ${block('TODAY', '8 lines', '8-week rotation', TODAY, false)}
  ${block('OPTION A', '6 lines, as close to today as possible', '6-week rotation · lines 2 and 4 are today\'s lines 2 and 4 unchanged', options.A)}
  ${KEY}
  <p class="note">* A weekend is a line's Saturday and the <em>next</em> line's Sunday, because the roster week starts on a Sunday. A cover week's Sunday is not rostered, so it counts as off. "Depends" means the weekend turns on what the cover week is given.</p>
  ${foot(1)}
</section>`;

const p2 = `<section class="page">
  ${block('OPTION B', '6 lines, whole weekends off', '6-week rotation · the same Saturdays and Sundays as Option A · a 07:00 start every day', options.B)}
  ${block('WILDCARD', 'Option B with 9-hour Sundays and 06:20 openings', '6-week rotation · every 07:00 start opens the station at 06:20 instead', options.W)}
  ${KEY}
  <p class="note"><strong>The quarter-hour rule.</strong> Every duty starts and finishes on :00, :15, :30 or :45, except a duty that opens the station (06:20, or 07:15 on a Sunday) or closes it (23:55, or 23:25 on a Sunday). Those keep the station's own times, as the CEAs' 06:20–14:20 does. That is why today's 14:25–23:55 Saturday and 15:25–23:25 Sunday stay, and why the wildcard's openers finish at 14:20 and 15:20. Today's 07:55–15:55 Sunday neither opens nor closes, so it becomes 08:00–16:00.</p>
  <p class="note"><strong>How these were found.</strong> A computer search tried several million rosters inside these rules and kept the best: the fewest duty times not on today's roster, the most rest between runs of shifts, no lone rest days where it could, and Friday-to-Sunday breaks where it could. Option B was only accepted when its wildcard passed every fatigue rule as well, so the two are a matched pair.</p>
  <p class="note"><strong>Why every option pays more than today.</strong> With 6 people and two of them on every Sunday, each works 1 Sunday in 3 instead of 1 in 4. Sundays are paid at time and a half on top of the contract, so ${yr(B, B.sundays) - yr(T, T.sundays)} more a year outweigh any change to Saturdays. The wildcard's extra ${extraW} hours a year, from an hour more each Sunday, is about ${perStart} minutes' pay for each of the ${yr(W, W.earliestCount)} starts moved ${minutesEarlier} minutes earlier.</p>
  ${foot(2)}
</section>`;

const p3 = `<section class="page p3">
  <div class="bhead"><h2>The numbers, for one person over a year</h2><span class="tag">rounded to whole numbers</span></div>
  <table class="nums"><thead><tr><th>Measure</th><th class="n">Today</th><th class="n">Option A</th><th class="n">Option B</th><th class="n">Wildcard</th></tr></thead>
    <tbody>${ROWS.join('\n')}</tbody></table>
  <div class="opts three">
    ${card('OPTION A', 'Closest to today', [
        ['Familiar.', ' Lines 2 and 4 are today\'s, and the rest are built from today\'s duties.'],
        [`${A.newTimes.length === 1 ? 'One new duty time' : `${A.newTimes.length} new duty times`}`, `, ${list(A.newTimes)}, which replaces today's 07:55 Sunday.`],
        ['A Friday-to-Sunday break', ' every six weeks, and no fatigue risk factors.'],
    ], [
        ['Few whole weekends off', `: ${yr(A, A.weekends.off)} a year, against ${yr(T, T.weekends.off)} today.`],
        [`${yr(A, A.earliestCount)} starts at ${clock(A.earliest)} a year`, `, against ${yr(T, T.earliestCount)} today.`],
        ['A lone rest day', ' in the middle of line 5\'s week.'],
    ])}
    ${card('OPTION B', 'Whole weekends off', [
        [`${yr(B, B.weekends.off)} whole weekends off a year`, `, against ${yr(T, T.weekends.off)} today and ${yr(A, A.weekends.off)} in Option A.`],
        ['Nothing lost for it.', ' The same Saturdays, Sundays and pay as Option A.'],
        ['Steady weeks.', ' Every line is all earlies or all lates, with no lone rest days.'],
    ], [
        [`${yr(B, B.weekends.both)} weekends a year with both days worked.`, ' Half are the late pair: Saturday 15:00–23:30, then Sunday 15:25–23:25.'],
        [`${yr(B, B.earliestCount)} starts at ${clock(B.earliest)} a year`, ', and no Friday-to-Sunday breaks.'],
        [`${B.newTimes.length === 2 ? 'Two' : B.newTimes.length} new duty times`, `: ${list(B.newTimes)}.`],
    ])}
    ${card('WILDCARD', 'More Sunday, earlier opening', [
        ['The most pay', `: ${yr(W, W.extraPay)} hours a year, ${extraW} more than Option B.`],
        ['Bilingual cover from the opening', ' every day, Monday to Saturday.'],
        [`Option B's ${yr(W, W.weekends.off)} whole weekends off`, ', and no fatigue risk factors.'],
    ], [
        [`${yr(W, W.earliestCount)} starts a year at ${clock(W.earliest)}.`, ' The fatigue rules count these as early starts; line 3 has four in a row, the most they allow.'],
        ['9-hour Sundays', ', one of them 14:25–23:25.'],
        [`${['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'][W.newTimes.length] ?? W.newTimes.length} new duty times.`, ''],
    ])}
  </div>
  ${foot(3)}
</section>`;

const extraCss = '.p3 .nums th, .p3 .nums td { padding-block: .35mm; } .p3 { gap: 2.2mm; } .opts.three { grid-template-columns: 1fr 1fr 1fr; gap: 4mm; } .opts.three .opt { gap: 1.6mm; } .opts.three .minus { margin-top: 1mm; } .opt { break-inside: avoid; }';
const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${TITLE}</title><style>${css}\n${extraCss}</style></head><body>\n${p1}\n${p2}\n${p3}\n</body></html>\n`;
writeFileSync(HTML, html);

// A Chromium other than the one this Playwright version installs (a cloud session's, say) is named in
// PLAYWRIGHT_CHROMIUM; otherwise Playwright's own is used.
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const page = await browser.newPage();
await page.goto('file://' + HTML);
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: OUT, format: 'A4', landscape: true, preferCSSPageSize: true, printBackground: true });
const pages = await page.evaluate(() => document.querySelectorAll('section.page').length);
await browser.close();
console.log(`wrote ${OUT} (${pages} sections) — check it is still three pages`);
