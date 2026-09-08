import { chromium } from '../../../node_modules/playwright/index.mjs';
const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 794, height: 1123 } }); // A4 @96dpi
await pg.goto(new URL(process.argv[2] ?? 'Marylebone-CEA-Link-Dec2026-24-line-proposal.html', 'file://' + process.cwd() + '/').href); await pg.emulateMedia({ media: 'print' }); await pg.evaluate(() => document.fonts.ready);
// printable width at 11mm margins = 210-22 = 188mm = 710px; height 297-24 = 273mm = 1032px
await pg.addStyleTag({ content: 'body{width:710px;margin:0 auto} .page{page-break-after:auto;margin-bottom:24px;outline:1px dashed #c00}' });
const hs = await pg.$$eval('.page', els => els.map(e => Math.round(e.getBoundingClientRect().height)));
console.log('section heights px (limit 1032):', hs.join(', '));
const secs = await pg.$$('.page');
for (let i = 0; i < secs.length; i++) await secs[i].screenshot({ path: `page-${i+1}.png` });
await b.close();
