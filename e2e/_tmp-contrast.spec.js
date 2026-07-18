import { test } from './fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { seedSession, seedMember } from './helpers.js';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
async function contrast(page) {
    const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    const cc = r.violations.filter(v => v.id === 'color-contrast');
    const rows = [];
    for (const v of cc) for (const n of v.nodes) {
        const d = (n.any[0] && n.any[0].data) || {};
        rows.push(`${n.target.join(' ')} | fg ${d.fgColor} on bg ${d.bgColor} | ${d.contrastRatio} (need ${d.expectedContrastRatio})`);
    }
    return rows;
}
async function go(page, url, waitSel) { await page.goto(url); if (waitSel) await page.locator(waitSel).first().waitFor(); }

test('calendar', async ({ page }) => { await seedMember(page); await go(page,'/','.calendar-day'); console.log('CALENDAR:\n'+(await contrast(page)).join('\n')); });
test('paycalc', async ({ page }) => { await seedSession(page); await page.addInitScript(()=>{localStorage.setItem('myb_pc_pay_welcome_shown','1');localStorage.setItem('myb_pc_ytd_notice_shown','1');localStorage.setItem('myb_pc_ns_migrated','1');}); await go(page,'/paycalc.html','#settingsCard'); console.log('PAYCALC:\n'+(await contrast(page)).join('\n')); });
test('guide', async ({ page }) => { await go(page,'/guide.html','h1'); console.log('GUIDE:\n'+(await contrast(page)).join('\n')); });
test('railcard', async ({ page }) => { await go(page,'/railcard-guide.html','h1'); console.log('RAILCARD:\n'+(await contrast(page)).join('\n')); });
test('fip', async ({ page }) => { await go(page,'/fip.html','h1'); console.log('FIP:\n'+(await contrast(page)).join('\n')); });
