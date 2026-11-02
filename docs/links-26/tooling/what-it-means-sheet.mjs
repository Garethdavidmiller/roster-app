// WHAT IT MEANS IF YOU… (1 Nov 2026, owner: "make all three changes" — the third being a one-page sheet that answers the
// question colleagues actually ask: not "which link is best" but "what does it mean for ME?"). Six ways people work the
// roster today, each answered with the figures, today against the three shortlisted links, and then what every one of them
// gains whichever they are.
//
// THE FIGURES ARE what-it-means-data.mjs (since 2 Nov 2026), which the December link page's generator reads too; this file
// only lays them out and prints them. What every figure is, where it comes from and what the pay assumes: that file's header.
// Run it AFTER deck-polish.py, which writes the decks the data module reads back, and BEFORE pack.py.
//
//   node docs/links-26/tooling/what-it-means-sheet.mjs   → docs/links-26/links-26-what-it-means.pdf
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { GROUPS, TC, C, RATE, sundayLoss, noOt, lo, hi, isBest, tidyText } from './what-it-means-data.mjs';

const ROOT = new URL('../../../', import.meta.url).href.replace(/\/$/, '');
const OUT = fileURLToPath(new URL('../links-26-what-it-means.pdf', import.meta.url));
const PREPARED = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const cell = (r, i) => isBest(r, i) ? `<b class="best">${r.cells[i].text}</b>` : r.cells[i].text;
const body = GROUPS.map(g => `<tbody><tr class="band"><td colspan="5"><span class="who">${g.who}</span><span class="gist">${esc(g.gist)}</span></td></tr>
${g.rows.map(r => `<tr class="r"><td>${esc(r.label)}${r.note ? `<span class="nt">${esc(r.note)}</span>` : ''}</td>${r.cells.map((_, i) => `<td class="num${i === 0 ? ' today' : ''}">${cell(r, i)}</td>`).join('')}</tr>`).join('\n')}</tbody>`).join('\n');

const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>What it means if you… — December 2026 link shortlist</title>
<link rel="stylesheet" href="${ROOT}/shared.css">
<style>
@page { size: A4; margin: 11mm 11mm 13mm; }
html, body { background: white !important; color: var(--text-dark); padding: 0 !important; margin: 0; font-family: var(--font-sans); font-size: 11.1px; line-height: 1.38; }
.page { position: relative; height: 273mm; box-sizing: border-box; padding-bottom: 14px; }
.mast { background: var(--primary-blue); color: white; padding: 12px 20px 11px; border-bottom: 4px solid var(--accent-gold); border-radius: var(--radius); display: flex; gap: 16px; align-items: center; }
.mast img { width: 44px; height: 44px; border-radius: 10px; }
.mast .eyebrow { color: var(--accent-gold); font-size: 10px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; }
.mast h1 { margin: 2px 0; font-size: 22px; font-weight: 800; color: white; letter-spacing: -.2px; }
.mast .sub { color: rgba(255,255,255,.78); font-size: 11.5px; text-wrap: balance; }
.mast .meta { color: rgba(255,255,255,.55); font-size: 9.5px; margin-top: 4px; }
p { margin: 3px 0 6px; } .lead { font-size: 11.2px; margin: 7px 0 5px; }
table.t { border-collapse: collapse; width: 100%; font-size: 10.2px; line-height: 1.32; }
table.t th, table.t td { padding: 1px 7px 1.5px; border-bottom: 1px solid var(--border-light); text-align: left; vertical-align: top; }
table.t th { background: var(--surface-sunken); color: var(--text-mid); font-size: 9.2px; text-transform: uppercase; letter-spacing: .3px; }
table.t th.num, table.t td.num { text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; width: 14%; } table.t th:first-child { width: 44%; }
table.t td.today { color: var(--text-light); }
table.t .best { font-weight: 800; color: color-mix(in srgb, var(--success-green) 80%, black); }
table.t tr.r:nth-child(odd) td { background: color-mix(in srgb, var(--surface-sunken) 55%, white); }
table.t .nt { display: block; color: var(--text-mid); font-size: 8.6px; line-height: 1.25; }
/* each kind of colleague: the sentence the page title starts, finished, and what it comes to — in short */
table.t tr.band td { border-bottom: 1.5px solid var(--primary-blue); padding: 6px 7px 2.5px; background: white; }
table.t tbody:first-of-type tr.band td { padding-top: 5px; }
table.t tr.band .who { display: block; font-size: 14px; font-weight: 800; color: var(--primary-blue); }   /* the family's section-heading size */
table.t tr.band .gist { display: block; font-size: 10.4px; color: var(--text-dark); line-height: 1.36; }
.notes { margin-top: 8px; color: var(--text-mid); font-size: 8.8px; line-height: 1.4; column-count: 2; column-gap: 22px; }
.notes b { color: var(--text-dark); }
.foot { position: absolute; bottom: 0; left: 0; right: 0; display: flex; justify-content: space-between; font-size: 8.5px; color: var(--text-light); border-top: 1px solid var(--border-light); padding-top: 4px; }
.foot b { color: var(--primary-blue); } .nw { white-space: nowrap; }
* { text-wrap: pretty; } h1 { text-wrap: balance; }
</style></head><body>
<section class="page">
  <div class="mast"><img src="${ROOT}/icon-192.png" alt=""><div><div class="eyebrow">Marylebone Roster · Links designer · What it means for you</div><h1>What it means if you…</h1>
  <div class="sub">Six ways people work the roster today, and what Even Step (recommended), In Step and Short Run would mean for each — against today’s link</div>
  <div class="meta">Prepared ${PREPARED} · every figure is computed from the rotas</div></div></div>
  <p class="lead">One person, a year, cover weeks aside. Earlies and lates are counted Monday to Saturday, as Sunday is overtime. Pounds are gross, at the CEA rate of £${RATE.toFixed(2)}; the Pay Calculator in the app estimates a payslip. <b class="best" style="color:color-mix(in srgb, var(--success-green) 80%, black)">Bold green</b> marks the clear best of the three for that person.</p>
  <table class="t"><thead><tr><th>If you…</th><th class="num">Today</th>${C.map(c => `<th class="num">${c.name}</th>`).join('')}</tr></thead>
${body}
  </table>
  <div class="notes"><b>How these are worked out.</b> Over 52 weeks, two turns of a 26-week link, so a design’s figures are everyone’s; today’s, on 20 weeks, are averages. An early starts before 11:00, a late at 11:00 or after. A swap is counted on the same day: each early against that day’s average late, and each 13:35 or 13:45 early — the only earlies that finish before 14:00 — swapped for that day’s longest late. That is the most these particular short-early swaps could make, not a forecast: it assumes a partner for every swap, and the extra time paid at time and a quarter (“Overtime 1.25” on a payslip). The average late includes the closers; the shortlist sheet’s weekday lates leave them out. The swap rows are not ranked: which link suits a swapper depends on which swaps they make. The Sunday figure is the presentations’ own, to £50; the others are to £10. Leave: a working day Monday to Saturday costs a day’s leave, a rest day or a Sunday none. “Up to” is the worst place a cover week’s duties could fall. Fatigue warnings are reported against the ORR’s good-practice list, never as pass or fail.</div>
  <div class="foot"><span>Page 1 of 1 — Six ways of working, and what every link gives everyone</span><span><b>What it means for you</b> · <span class="nw">Even Step</span>, <span class="nw">In Step</span> and <span class="nw">Short Run</span> · Marylebone Roster — Links designer</span></div>
</section>
</body></html>`;
// a figure keeps what it belongs to, as on the other sheets (tidyText, in the data module)
const tidy = h => h.replace(/(<style[\s\S]*?<\/style>|<title>[\s\S]*?<\/title>)|(?<=>)([^<]+)(?=<)/g, (mm, keep, txt) => keep ?? tidyText(txt));
const htmlOut = fileURLToPath(new URL('links-26-what-it-means.html', import.meta.url)); writeFileSync(htmlOut, tidy(html));   // beside the tooling, gitignored
const b = await chromium.launch(); const pg = await b.newPage();
await pg.goto('file://' + htmlOut); await pg.evaluate(() => document.fonts.ready);
// THE PAGE IS A FIXED HEIGHT, so content that does not fit would be HIDDEN under the footer: refuse to print it. Measured at
// the PRINT width under print media, as the shortlist sheet measures (its first guard measured the screen and passed a
// broken page)
{ await pg.emulateMedia({ media: 'print' }); await pg.setViewportSize({ width: 711, height: 1100 });
  const over = await pg.evaluate(() => { const p = document.querySelector('.page'), foot = p.querySelector('.foot'), lim = foot.getBoundingClientRect().top;
    const low = Math.max(...[...p.children].filter(c => c !== foot).map(c => c.getBoundingClientRect().bottom));
    return Math.round(Math.max(low - lim, p.scrollHeight - p.clientHeight, p.scrollWidth - p.clientWidth)); });
  if (over > 1) throw new Error(`content runs into the footer or off the page by ${over}px`);
  const room = await pg.evaluate(() => { const p = document.querySelector('.page'), foot = p.querySelector('.foot');
    return Math.round(foot.getBoundingClientRect().top - Math.max(...[...p.children].filter(c => c !== foot).map(c => c.getBoundingClientRect().bottom))); });
  console.log(`room above the footer: ${room}px`); }
await pg.pdf({ path: OUT, format: 'A4', printBackground: true, preferCSSPageSize: true });
await b.close();
console.log(`wrote links-26-what-it-means.pdf — ${GROUPS.length} groups, ${GROUPS.reduce((n, g) => n + g.rows.length, 0)} rows; Sundays £${sundayLoss} less, no overtime £${lo(noOt)}–£${hi(noOt)} more, swaps £${TC.swapPounds} today against ${C.map(c => `£${c.swapPounds}`).join(' / ')}`);
