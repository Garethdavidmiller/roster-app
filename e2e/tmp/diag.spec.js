import { test, expect } from '../fixtures.js';
import { seedSession } from '../helpers.js';
test('diag', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page);
    // In-page rAF sampler: no round trips, so it perturbs the timing far less than
    // page.evaluate() polling did (which masked the failure entirely).
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_shown', '1');
        window.__samples = [];
        const tick = () => {
            const c = document.getElementById('payTransferCard');
            if (c) window.__samples.push([Math.round(performance.now()),
                Math.round(c.getBoundingClientRect().top), Math.round(window.scrollY),
                Math.round(document.documentElement.scrollHeight)]);
            if (performance.now() < 3000) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);
    await expect(page.locator('#ptSummary')).not.toBeEmpty();
    await page.waitForTimeout(900);
    const at900 = await page.evaluate(() =>
        Math.round(document.getElementById('payTransferCard').getBoundingClientRect().top));
    await page.waitForTimeout(1600);
    const s = await page.evaluate(() => window.__samples);
    // Print only frames where the card position CHANGED — the shape of the drift.
    const moves = s.filter((r, i) => i === 0 || r[1] !== s[i - 1][1]);
    console.log(`VERDICT y@900=${at900} ${at900 < 281 ? 'PASS' : 'FAIL'}`);
    console.log('MOVES', JSON.stringify(moves.slice(0, 30)));
    console.log('LAST', JSON.stringify(s[s.length - 1]));
});
