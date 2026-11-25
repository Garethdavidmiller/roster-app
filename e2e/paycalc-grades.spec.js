/**
 * paycalc-grades.spec.js — the Pay Calculator (paycalc.html): grades and roles — the unsupported-role
 * card, a manager, a promotion, and a grade chosen by hand.
 *
 * Split by feature out of paycalc.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one paycalc-*.spec.js file needs is in paycalc-helpers.js, including the roster rows these tests sign
 * in as, which are chosen by shape and never written down (payroll-anonymity.test.mjs).
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession, clickInView, isTouchProject } from './helpers.js';
// The REAL pay tables, imported rather than restated: the unsupported-role block below asserts that
// a CES is priced as a CES, and a literal rate there would go stale on the next award — or, worse,
// be "corrected" to whatever the page happened to show.
import { GRADES, AWARD_RATES } from '../paycalc-calc.js';
import { memberSlug } from '../paycalc-migrations.js';
import { PROMOTED, LONG_SERVING, LONG_SERVING_PC } from './paycalc-helpers.js';

const PROMOTED_PC = `myb_pc_${memberSlug(PROMOTED)}_`;

// ── A ROLE WITH NO CONFIRMED RATES GETS NO FIGURE (v21.78) ───────────────────────────────────────
//
// The grade lookup treated "no grade stored" as CEA at every consumer, so the ten Dispatchers and
// the seven manager accounts could open this page and be handed a complete, polished take-home
// estimate computed at somebody else's rate. Nothing on screen said so, and nothing failed.
//
// Both directions are asserted, and the second matters as much as the first: a guard that refuses
// the people it should serve is a worse bug than the one it replaces.
test('paycalc: a Dispatcher is told the calculator does not cover their pay, and shown no figure', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page, 'D. Minto');
    await page.goto('/paycalc.html');

    const card = page.locator('#unsupportedGradeBanner');
    await expect(card).toBeVisible();
    // Written FOR a Dispatcher (v25.50, paycalc-role-card.js): their pay is not covered YET, and the
    // condition for adding it is the rates — "we haven't got them" is the truth, and it tells a
    // Dispatcher this is a gap rather than a decision. No date: the condition is information.
    await expect(page.locator('#unsupportedGradeTitle')).toHaveText("The Pay Calculator doesn’t cover Dispatcher pay yet");
    await expect(card).toContainText('once Dispatcher rates are confirmed');
    // ...it says what the calculator DOES, naming the grades it serves in full...
    await expect(page.locator('#unsupportedGradeWhat')).toContainText("Customer Experience Ambassador’s or Supervisor’s (CEA or CES)");
    // ...and links the guide, which is the only "what is this for" left on a refusal: the page's own
    // guide link is hidden with the calculator.
    await expect(card.locator('a[href="./paycalc-guide.html"]')).toBeVisible();
    await expect(page.locator('main > .guide-footer-link')).toBeHidden();
    // ONE DOOR: the refusal wears the sign-in card's panel, so on a wide screen it is centred over the
    // page as that card is — not parked in the work columns the calculator would have used (v25.50).
    const [cardBox, mainBox] = await Promise.all([card.boundingBox(), page.locator('main').boundingBox()]);
    expect(cardBox && mainBox && Math.abs((cardBox.x + cardBox.width / 2) - (mainBox.x + mainBox.width / 2)),
        'the refusal card is centred on the page').toBeLessThan(2);
    // ...at the sign-in card's width (a box dropped from the shared panel recipe is full-width, and
    // a full-width box is centred too — so the centre alone cannot tell the two apart).
    const standard = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--modal-standard')));
    expect(cardBox?.width, 'the refusal card is the sign-in card\'s width').toBeCloseTo(standard, 0);
    // WITHHELD, not captioned — the form's whole output is one confident £ figure, and a member
    // told "this may not apply" and then handed one will use it.
    await expect(page.locator('.pc-work')).toBeHidden();
    await expect(page.locator('.pc-side')).toBeHidden();
    // ...and it is a refusal with a way out, not a dead end — the sign-in card's own.
    await expect(page.locator('#navMenuBtn')).toBeVisible();
    await expect(card.locator('a.role-card-back')).toHaveAttribute('href', './');
    expect(errors, 'Uncaught JS exceptions on the unsupported-role gate').toHaveLength(0);
});

// THE REFUSAL KEEPS THE PAGE CHROME (Nov 2026). `_showUnsupportedRole` wired the drawer with no
// `onLogoClick` and never built About or the header logo, so on this card alone the drawer head ("about
// this app") and the header logo ("Back to calendar") did nothing. Behaviour, not wiring: the tap must
// open the panel, and the logo must leave.
test('paycalc: on the unsupported-role card the drawer head opens About and the header logo goes back to the calendar', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page, 'D. Minto');
    await page.goto('/paycalc.html');
    await expect(page.locator('#unsupportedGradeBanner')).toBeVisible();

    await page.locator('#navMenuBtn').click();
    await expect(page.locator('#navPanel')).toHaveClass(/open/);
    await page.locator('#navPanelBrand').click();
    await expect(page.locator('#iconLightbox'), 'the drawer head opens About on the refusal card too').toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#iconLightbox')).not.toHaveClass(/open/);

    await page.locator('#appIcon').click();
    await expect(page, 'the header logo goes back to the calendar').not.toHaveURL(/paycalc\.html/);
    expect(errors, 'Uncaught JS exceptions on the unsupported-role chrome').toHaveLength(0);
});

// A MANAGER is refused the same way and told something different (owner, 7 Nov 2026): who the
// calculator is FOR, and why they might point their team at it. Not "yet", not "will be added" —
// managers are not in line for it, so either would be untrue to this reader. D. Watts is a
// Management row: hidden from every picker, but a manager signs in all the same.
test('paycalc: a manager is told who the calculator is for — with nothing promised — and shown no figure', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page, 'D. Watts');
    await page.goto('/paycalc.html');

    const card = page.locator('#unsupportedGradeBanner');
    await expect(card).toBeVisible();
    await expect(page.locator('#unsupportedGradeTitle')).toHaveText('The Pay Calculator is for CEAs and CESs');
    await expect(card).toContainText('someone in your team');
    await expect(card).not.toContainText('will be added');
    await expect(card).not.toContainText('Dispatcher');
    await expect(card.locator('a[href="./paycalc-guide.html"]')).toBeVisible();
    await expect(page.locator('.pc-work')).toBeHidden();
    await expect(page.locator('.pc-side')).toBeHidden();
    expect(errors, 'Uncaught JS exceptions on the manager card').toHaveLength(0);
});

// ── THE ROLE AT THE TIME (owner, 16 Nov 2026) ──────────────────────────────────────────────────
// A CES promoted into management keeps the CES payslips: the page admits them by the grade held on the
// days it shows (pay-audience.js), prices the CES payslip at the CES rate, and gives each payslip with
// a day under the new role NO figure — the rendered £ is the assertion, not the helper's answer, and
// "£–" with the reason in its place is the whole of what such a payslip may show. The member is
// INVENTED, served into the roster file for this test only.
const PROMOTED_MANAGER = 'Test Promoted Manager';
async function openAsPromotedManager(/** @type {import('@playwright/test').Page} */ page, /** @type {string} */ path) {
    await page.clock.setFixedTime(new Date('2026-11-25T09:00:00Z'));
    await page.route('**/roster-member-data.js', async (route) => {
        const res = await route.fetch();
        const entry = `{ name: '${PROMOTED_MANAGER}', currentWeek: 9, rosterType: 'ces', role: 'Management', hidden: true, `
            + `managerOnly: true, roleHistory: [{ role: 'CES', until: new Date(2026, 10, 21) }] }`;
        const body = (await res.text()).replace(/\n\];\s*$/, `\n    ${entry},\n];\n`);
        expect(body, 'premise: the invented member reached the served roster').toContain(PROMOTED_MANAGER);
        await route.fulfill({ response: res, body });
    });
    await seedSession(page, PROMOTED_MANAGER);
    // The page's two one-time notices are answered, so neither covers the controls this test presses.
    await page.addInitScript(() => {
        for (const k of ['myb_pc_ns_migrated', 'myb_pc_ytd_notice_2_shown', 'myb_pc_hpp_notice_2526_shown']) localStorage.setItem(k, '1');
    });
    await page.goto(path);
}

test('paycalc: a CES promoted into management keeps the CES payslips — and a payslip under the new role has no figure', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await openAsPromotedManager(page, '/paycalc.html?payday=2026-11-20');
    await expect(page.locator('#unsupportedGradeBanner'), 'admitted by the role at the time').toBeHidden();
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await expect(page.locator('#hourlyRate'), 'the CES payslip at the CES rate').toHaveValue(AWARD_RATES.ces['2026/27'].rate.toFixed(2));
    await expect(page.locator('#unpricedPayslipNote')).toBeHidden();
    // Premise for the badges below: on a payslip it can price, every hours row shows its rate in £.
    await expect(page.locator('#badge-ot')).toContainText('£');
    // …and for the Year to Date card: figures typed here are said to be from this payslip, so not in use
    // on it. A payslip with no estimate has nothing for them to sharpen (18 Nov 2026).
    await page.locator('#payslipCardToggle .card-toggle-arrow').click();
    await page.fill('#ytdPay', '12000');
    await page.dispatchEvent('#ytdPay', 'input');
    await page.fill('#ytdTax', '1500');
    await page.dispatchEvent('#ytdTax', 'input');
    await expect(page.locator('#ytdStatusChip'), 'premise: the chip reports the figures').toHaveText('not in use');
    await expect(page.locator('#ytdUptoNote'), 'premise: the note names their payslip').toContainText('Your Year to Date figures are from');

    // The payslip across the promotion: seven CES days, 21 under a role with no rates. Reached IN THE
    // PAGE, so the badges still hold what the 20 Nov payslip wrote: a fresh load would pass on the
    // markup alone, which ships no £ (18 Nov 2026).
    await clickInView(page.locator('#nextBtn'));
    await expect(page.locator('#unsupportedGradeBanner')).toBeHidden();
    await expect(page.locator('#netDisplay'), 'no figure — never one at the CEA rate').toHaveText('£–');
    await expect(page.locator('#unpricedPayslipNote')).toHaveText('No estimate for this payslip. From Sun 22 November 2026 the roster '
        + 'lists you as Management, and this calculator only has rates for CEA and CES. The nearest payslip it can estimate is the one paid Fri 20 November 2026.');
    await expect(page.locator('#hourlyRate')).toHaveValue('–');
    // Every hours row keeps its multiplier and no £ figure — not the last payslip's, not CEA's
    // (invariant 13: never another rate in its place, on any surface).
    for (const [id, mult] of [['badge-sat', '1.25×'], ['badge-sun', '1.5×'], ['badge-bh', '1.25×'], ['badge-bhot', '1.25×'],
                              ['badge-ot', '1.25×'], ['badge-rdw', '1.25×'], ['badge-box', '3×']]) {
        await expect(page.locator(`#${id}`), `#${id} kept a £ rate on a payslip with none`).toHaveText(mult);
    }
    await expect(page.locator('#netLabel'), 'the figure slot keeps its plain name').toHaveText('💷 Estimated Take-Home Pay');
    await expect(page.locator('#ytdStatusChip'), 'the last payslip\'s Year to Date verdict beside £–').toHaveText('');
    await expect(page.locator('#ytdUptoNote'), 'a note about sharpening an estimate that is not there').toHaveText('');
    for (const sel of ['#summary', '#bdBtn', '#stickyTotal', '#ytdYearSoFar']) {
        await expect(page.locator(sel), `${sel} is fed by a figure, so it goes`).toBeHidden();
    }
    // Hours typed here move nothing: there is no figure to move.
    await page.locator('#otH').fill('10');
    await expect(page.locator('#netDisplay')).toHaveText('£–');

    // Back on the CES payslip the refusal does not outlive its payslip.
    await page.locator('#prevBtn').click();
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await expect(page.locator('#unpricedPayslipNote')).toBeHidden();
    await expect(page.locator('#summary')).toBeVisible();
    expect(errors, 'Uncaught JS exceptions on a payslip the calculator cannot price').toHaveLength(0);
});

// …and on a short laptop window the refusal is read whole (laptop polish, 13 Nov 2026): at 1280×593 its
// way back sat 23px under the fold. The role emoji over its title steps aside there (a taller window
// keeps it), and the card takes the sign-in card's short-window padding, because it wears that card's
// panel: signed out, this same page shows the sign-in card, so the two are compared directly.
test('paycalc: on a short laptop window the refusal card ends on screen, its way back included', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a laptop window');
    await page.setViewportSize({ width: 1280, height: 593 });
    const padding = (/** @type {string} */ sel) => page.locator(sel).evaluate(el => {
        const cs = getComputedStyle(el); return [cs.paddingTop, cs.paddingBottom]; });
    await page.goto('/paycalc.html');
    await expect(page.locator('#loginCard')).toBeVisible();
    const door = await padding('#loginCard');
    await seedSession(page, 'D. Minto');
    await page.goto('/paycalc.html');
    const back = page.locator('#unsupportedGradeBanner a.role-card-back');
    await expect(back).toBeVisible();
    expect(await padding('#unsupportedGradeBanner'), 'the refusal and the sign-in card are one door: one padding').toEqual(door);
    const bottom = await back.evaluate(el => Math.round(el.getBoundingClientRect().bottom));
    expect(bottom, `the way back ends ${bottom - 593}px under the fold of a 1280×593 window`).toBeLessThanOrEqual(593);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator('#unsupportedGradeBanner .role-card-icon'), 'a tall window keeps the emoji').toBeVisible();
});

// ...and at the RIGHT RATE. "a figure appeared" is not the assertion that matters here: the gate
// under test is `gradeForRole`, and its expensive failure mode produces a page that passes every
// line above — a CES computed at the CEA rate, complete, formatted, and £155 a period light on
// contracted basic alone. The grade is what the page never states in words, so it is read off the
// two places that carry it: the Settings grade picker, and the rate the period resolved to.
//
// The rate is checked against the SETS the real tables produce rather than against a literal,
// because which rate is correct depends on which payslip the page happened to open on (pre- or
// post-award) and on whatever the next award does to the figures. The two sets are disjoint, which
// is the whole property: a member priced off the wrong grade lands in the other one.
const rateSetFor = (/** @type {string} */ g) => new Set(
    [GRADES[g].rate, ...Object.values(AWARD_RATES[g]).flatMap(a => [a.rate, a.pre])]
        .filter(r => r != null).map(r => r.toFixed(2)));

for (const [name, role, grade, otherGrade] of [
    ['G. Miller', 'CEA', 'cea', 'ces'],
    ['F. Mohamed', 'CES', 'ces', 'cea'],
]) {
    test(`paycalc: a ${role} is unaffected by the unsupported-role gate, and is priced as a ${role}`, async ({ page }) => {
        const errors = collectFatalErrors(page);
        await seedSession(page, name);
        await page.goto('/paycalc.html');
        await expect(page.locator('#unsupportedGradeBanner')).toBeHidden();
        await expect(page.locator('.pc-work')).toBeVisible();
        // A real figure, not the "£–" placeholder — the calculator ran.
        await expect(page.locator('#netDisplay')).toContainText('£');
        await expect(page.locator('#netDisplay')).not.toHaveText('£–');

        // A first visit follows the roster (v26.00): the Grade box says so, and the rate below — the
        // grade's own award row — is what proves which grade the roster gave.
        await expect(page.locator('#gradeSelect')).toHaveValue('roster');
        await expect(page.locator('#gradeRosterLine')).toHaveText(`The roster lists you as ${role}.`);
        // …and with the roster deciding, there is nothing to ask (owner, 10 Nov 2026).
        await expect(page.locator('#gradePrompt')).toBeHidden();

        // And the money that follows from it. `#hourlyRate` is written by `updateRateForPeriod`
        // from the grade's own award row, so this is the first point in the chain where a wrong
        // grade becomes a wrong £.
        const rate = await page.locator('#hourlyRate').inputValue();
        const mine = rateSetFor(grade);
        const theirs = rateSetFor(otherGrade);
        expect([...mine].some(r => [...theirs].includes(r)),
            'the two grades share a rate, so this test cannot tell them apart').toBe(false);
        expect(mine.has(rate), `a ${role} was priced at £${rate} — not a ${role} rate (${[...mine].join(', ')})`).toBe(true);
        expect(theirs.has(rate), `a ${role} was priced at the ${otherGrade.toUpperCase()} rate £${rate}`).toBe(false);

        expect(errors, `Uncaught JS exceptions for ${role}`).toHaveLength(0);
    });
}

// ── THE ROSTER NAMES A DIFFERENT GRADE (owner, 10 Nov 2026) ──────────────────────────────────────
// A saved grade outranks the roster role, so a member the roster moved from CEA to CES kept CEA rates
// with nothing on the page saying so. Now the page ASKS — one line at the top — and both answers stick.
/** A CES on the roster whose device still has CEA saved — the member the roster moved. */
async function rosterMovedToCes(/** @type {import('@playwright/test').Page} */ page) {
    await seedSession(page, 'F. Mohamed');   // the CES row of the grade test above
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem('myb_pc_fmohamed_setup', '1');
        if (!sessionStorage.getItem('seeded')) {
            localStorage.setItem('myb_pc_fmohamed_grade', 'cea');
            sessionStorage.setItem('seeded', '1');
        }
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
}

test('paycalc: a member the roster moved to CES is asked, and "Use CES rates" re-prices the page', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await rosterMovedToCes(page);
    const prompt = page.locator('#gradePrompt');
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText('The roster lists you as CES (Customer Experience Supervisor), but this calculator is using CEA rates.');
    await expect(page.locator('#gradeSelect'), 'premise: the saved grade outranked the roster').toHaveValue('cea');
    expect(rateSetFor('cea').has(await page.locator('#hourlyRate').inputValue()), 'premise: priced as a CEA').toBe(true);

    await prompt.getByRole('button', { name: 'Use CES rates' }).click();
    await expect(page.locator('#gradeSelect'), '"Use" hands pricing back to the roster').toHaveValue('roster');
    // The page's own grade-change path ran: the rate the take-home is built from is a CES rate now.
    await expect.poll(async () => rateSetFor('ces').has(await page.locator('#hourlyRate').inputValue()),
        'the grade box changed but the page was not re-priced').toBe(true);
    const done = page.locator('#gradePromptDone');
    await expect(done).toHaveText('✓ Now using CES rates.');
    await expect(done, 'the button pressed is gone, so focus goes to what happened').toBeFocused();
    await expect(page.locator('#gradePromptActions')).toBeHidden();

    await page.reload();
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await expect(page.locator('#gradeSelect')).toHaveValue('roster');
    await expect(prompt, 'answered — the roster and the page agree now').toBeHidden();
    expect(errors).toHaveLength(0);
});

test('paycalc: "Keep CEA" keeps the member\'s own grade, and is not asked again', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await rosterMovedToCes(page);
    const prompt = page.locator('#gradePrompt');
    await prompt.getByRole('button', { name: 'Keep CEA' }).click();
    await expect(page.locator('#gradePromptDone')).toHaveText('✓ Keeping CEA rates. You can change your grade in Your Settings.');
    await expect(page.locator('#gradeSelect')).toHaveValue('cea');
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_fmohamed_grade_kept'))).toBe('ces');

    await page.reload();
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await expect(prompt, 'a member who chose to keep their grade is asked once, not on every visit').toBeHidden();
    await expect(page.locator('#gradeSelect')).toHaveValue('cea');
    expect(errors).toHaveLength(0);
});

// ── A PROMOTION PRICES EACH PAYSLIP AT THE GRADE HELD ON ITS DAYS (owner, 13 Nov 2026) ──────────
// The roster dates a grade (`roleHistory`, roster-roles.js): this row is a CEA up to Sat 21 Nov 2026
// and a CES from the Sunday. Each payslip is priced at the grade held on its days (paycalc-grade.js):
// paid 20 Nov, all CEA; paid 18 Dec, 7 days as a CEA and 21 as a CES — £22.3225 an hour, explained in
// a line under the rate; paid 15 Jan 2027, all CES. Nothing is asked, because the roster decides.
// The row is `PROMOTED`, chosen by shape at the top of this file.
/**
 * Open the calculator on `today` as the promoted row, with `stored` (SK names → values) already on
 * this device — `grade` is what a device saved before grades had dates. `path` names a payslip.
 */
async function openAsPromoted(/** @type {import('@playwright/test').Page} */ page, /** @type {string} */ today,
    /** @type {Record<string, string>} */ stored = {}, /** @type {string} */ path = '/paycalc.html') {
    await page.clock.setFixedTime(new Date(today));
    await seedSession(page, PROMOTED);
    await page.addInitScript(({ kv, pc }) => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem(`${pc}setup`, '1');
        if (!sessionStorage.getItem('seeded')) {
            for (const [k, v] of Object.entries(kv)) localStorage.setItem(`${pc}${k}`, v);
            sessionStorage.setItem('seeded', '1');
        }
    }, { kv: stored, pc: PROMOTED_PC });
    await page.goto(path);
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
}
const SPLIT_LINE = 'Your grade changed on Sun 22 November 2026, part-way through this payslip: 7 days at the CEA rate '
    + '(£21.49/hr) and 21 at the CES rate (£22.60/hr), so its hours are priced at £22.32/hr — the two rates weighted by their days.';

test('paycalc: a promotion dated 22 Nov 2026 — each payslip at the grade held on its days, nothing asked', async ({ page }) => {
    const errors = collectFatalErrors(page);
    // A device that saved CEA before grades had dates: CEA is one of the roster's grades, so the roster
    // takes over, dates and all — the conversion runs once, on this load.
    await openAsPromoted(page, '2026-11-25T09:00:00Z', { grade: 'cea' });
    await expect(page.locator('#gradeSelect')).toHaveValue('roster');
    await expect(page.locator('#gradePrompt'), 'with the roster deciding there is nothing to ask').toBeHidden();
    expect(await page.evaluate(k => localStorage.getItem(k), `${PROMOTED_PC}grade`)).toBe('roster');

    for (const [payday, rate, line] of /** @type {const} */ ([
        ['2026-11-20', '21.49', null],
        ['2026-12-18', '22.32', SPLIT_LINE],
        ['2027-01-15', '22.60', null],
    ])) {
        await page.goto(`/paycalc.html?payday=${payday}`);
        await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
        await expect(page.locator('#hourlyRate'), `paid ${payday}`).toHaveValue(rate);
        if (line) await expect(page.locator('#rateStepNote')).toHaveText(line);
        else await expect(page.locator('#rateStepNote'), `paid ${payday} is on one grade`).toBeHidden();
    }
    // The money, not just the label: the payslip across the change prices its hours at the UNROUNDED
    // blend, and the basic row's own multiplication makes the figure beside it. The hours are read off
    // the row — the roster fills the weekend ones, so the weekday share follows the roster's data.
    await page.goto('/paycalc.html?payday=2026-12-18');
    const row = page.locator('#bdRows .bd-row', { hasText: 'Basic pay — Mon–Fri' });
    await expect(row).toContainText('× £22.3225)');
    // textContent, never innerText: the breakdown is folded (max-height 0, overflow hidden) until it is
    // opened, and WebKit's innerText leaves out text whose box is clipped to nothing — it read "" on the
    // iPhone engine (CI, 13 Nov 2026) while Chromium's read the row.
    const m = String(await row.locator('.b-lbl').textContent()).match(/\((\d+)h(?: (\d+)m)? × £22\.3225\)/);
    expect(m, 'the basic row reads "(hours × £22.3225)"').not.toBeNull();
    const amount = String(await row.locator('.b-val').textContent()).match(/^£([\d,]+\.\d\d)$/);
    expect(amount, 'the figure beside it reads "£amount"').not.toBeNull();
    const hours = Number(m?.[1]) + Number(m?.[2] ?? 0) / 60;
    const at = (/** @type {number} */ r) => (Math.round(hours * r * 100) / 100).toFixed(2);
    expect(at(22.32), 'premise: the rounded rate gives a different figure, so this can tell them apart').not.toBe(at(22.3225));
    expect(String(amount?.[1]).replace(/,/g, ''), `${hours}h at the blend`).toBe(at((7 * 21.49 + 21 * 22.60) / 28));
    expect(errors).toHaveLength(0);
});

for (const [today, rate] of /** @type {const} */ ([['2026-11-13T09:00:00Z', '21.49'], ['2026-11-25T09:00:00Z', '22.32']])) {
    test(`paycalc: a promotion dated 22 Nov 2026 — a first visit on ${today.slice(0, 10)} follows the roster`, async ({ page }) => {
        const errors = collectFatalErrors(page);
        await openAsPromoted(page, today);
        await expect(page.locator('#gradeSelect')).toHaveValue('roster');
        await expect(page.locator('#hourlyRate'), 'the payslip being earned, at the grade held on its days').toHaveValue(rate);
        await expect(page.locator('#gradePrompt'), 'a grade the roster gave cannot contradict the roster').toBeHidden();
        expect(errors).toHaveLength(0);
    });
}

test('paycalc: the change of grade is said once — before the day, then never again on this device', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await openAsPromoted(page, '2026-11-13T09:00:00Z', { grade: 'roster' });
    const note = page.locator('#gradeNote');
    await expect(note).toBeVisible();
    await expect(page.locator('#gradeNoteText')).toHaveText('Your grade on the roster changes from CEA to CES on '
        + 'Sun 22 November 2026. Each payslip is priced at the grade you held while you worked it, so there is nothing for you to change.');
    await note.getByRole('button', { name: 'OK' }).click();
    const done = page.locator('#gradeNoteDone');
    await expect(done).toHaveText("✓ Your grade's dates are in Your Settings, under Grade.");
    await expect(done, 'the button pressed is gone, so focus goes to what happened').toBeFocused();
    expect(await page.evaluate(k => localStorage.getItem(k), `${PROMOTED_PC}grade_note`)).toBe('2026-11-22');

    await page.reload();
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await expect(note, 'said once: this device has been told').toBeHidden();
    // The dates stay where the note said they would be.
    await page.locator('#settingsToggle .card-toggle-arrow').click();
    await expect(page.locator('#gradeRosterLine')).toHaveText('The roster lists you as CEA until 21 November 2026, then CES from 22 November 2026.');
    expect(errors).toHaveLength(0);
});

// THE NOTES THAT HEAD THE PAGE ARE THE WORK COLUMN'S, ON A LAPTOP TOO (laptop polish, 13 Nov 2026).
// The grade note had no place in the desktop grid, so it was auto-placed into ONE 330px column — with
// navy beside it and the period band flush beneath — or, with the welcome banner up, into the top of
// the take-home column. Both notes are measured against the period band they head, at the owner's
// laptop size: the same left edge and width, one 16px gap each, and the take-home level with the
// first of them.
for (const [name, confirmed] of /** @type {const} */ ([['settings confirmed', true], ['welcome banner up', false]])) {
    test(`paycalc laptop: the grade note spans the work columns — ${name}`, async ({ page }, info) => {
        test.skip(isTouchProject(info), 'the desktop grid, at a laptop window');
        const errors = collectFatalErrors(page);
        await page.setViewportSize({ width: 1280, height: 593 });
        await page.clock.setFixedTime(new Date('2026-11-13T09:00:00Z'));
        await seedSession(page, PROMOTED);
        await page.addInitScript(({ ok, pc }) => {
            localStorage.setItem('myb_pc_ns_migrated', '1');
            localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
            localStorage.setItem(`${pc}grade`, 'roster');
            localStorage.setItem(`${pc}p59`, JSON.stringify({ satH: 8 }));
            if (ok) { localStorage.setItem(`${pc}setup`, '1'); localStorage.setItem(`${pc}setup_2026_27`, '1'); }
        }, { ok: confirmed, pc: PROMOTED_PC });
        await page.goto('/paycalc.html');
        await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
        await expect(page.locator('#gradeNote')).toBeVisible();
        expect(await page.locator('#setupBanner').isVisible(), 'premise: the welcome banner shows exactly when settings are unconfirmed').toBe(!confirmed);
        const m = await page.evaluate(() => {
            const r = (/** @type {string} */ s) => /** @type {Element} */ (document.querySelector(s)).getBoundingClientRect();
            const band = r('.period-controls');
            const notes = ['#setupBanner', '#gradeNote'].map(s => /** @type {HTMLElement} */ (document.querySelector(s)))
                .filter(el => el.getClientRects().length).map(el => el.getBoundingClientRect());
            const stack = [...notes, band];
            return {
                edges: notes.map(n => ({ left: Math.round(n.left - band.left), width: Math.round(n.width - band.width) })),
                steps: stack.slice(1).map((b, i) => Math.round(b.top - stack[i].bottom)),
                resultOffset: Math.round(r('.result-card').top - stack[0].top),
            };
        });
        expect(m.edges.every(e => e.left === 0 && e.width === 0), `each note shares the period band's left edge and width: ${JSON.stringify(m.edges)}`).toBe(true);
        expect(m.steps.every(s => s === 16), `one 16px gap from note to note to the band: ${JSON.stringify(m.steps)}`).toBe(true);
        expect(m.resultOffset, 'the take-home heads column 3, level with the first note').toBe(0);
        expect(errors).toHaveLength(0);
    });
}

test('paycalc: a grade chosen by hand covers whole payslips from the one named; earlier ones follow the roster', async ({ page }) => {
    const errors = collectFatalErrors(page);
    // Kept at CEA from the 15 Jan 2027 payslip (period 60) — acting down, say, or a roster row the
    // member knows is wrong. The 18 Dec payslip is before it, so the roster's dates still split it.
    await openAsPromoted(page, '2026-12-20T09:00:00Z', { grade: 'cea', grade_from: '60' }, '/paycalc.html?payday=2026-12-18');
    await expect(page.locator('#hourlyRate')).toHaveValue('22.32');
    await expect(page.locator('#rateStepNote')).toHaveText(SPLIT_LINE);
    await page.goto('/paycalc.html?payday=2027-01-15');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await expect(page.locator('#hourlyRate'), 'the chosen grade, whole').toHaveValue('21.49');
    await expect(page.locator('#rateStepNote')).toBeHidden();
    // The roster gives CES for that payslip and the member chose CEA, so the page asks — once.
    await expect(page.locator('#gradePrompt')).toBeVisible();
    await expect(page.locator('#gradeNote'), 'a chosen grade is the question\'s business, not the note\'s').toBeHidden();

    // And choosing it is done in Settings: CES from the payslip on screen.
    await page.locator('#settingsToggle .card-toggle-arrow').click();
    await expect(page.locator('#gradeFromField')).toBeVisible();
    await expect(page.locator('#gradeFrom')).toHaveValue('60');
    await page.locator('#gradeSelect').selectOption('roster');
    await expect(page.locator('#gradeFromField'), 'the roster needs no date of its own').toBeHidden();
    await expect(page.locator('#hourlyRate')).toHaveValue('22.60');
    expect(await page.evaluate(k => localStorage.getItem(k), `${PROMOTED_PC}grade_from`)).toBeNull();
    expect(errors).toHaveLength(0);
});

// THE PAYSLIP ON SCREEN, NOT TODAY'S (17 Nov 2026). Settings load before the payslip selector exists,
// so the hidden "from which payslip?" was built with the payslip being earned today — and a grade
// chosen while an older payslip was on screen was dated from today's: that payslip kept CEA rates,
// under a box naming 15 Jan 2027. The pension tick dates itself from the payslip on screen; so does this.
test('paycalc: a grade chosen by hand starts from the payslip on screen', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-12-20T09:00:00Z'));   // today's payslip: 15 Jan 2027
    await seedSession(page, LONG_SERVING);
    await page.addInitScript(({ pc }) => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem(`${pc}setup`, '1');
    }, { pc: LONG_SERVING_PC });
    await page.goto('/paycalc.html?payday=2026-10-23');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    const onScreen = await page.locator('#periodSelect').inputValue();
    await expect(page.locator('#hourlyRate'), 'premise: priced as the roster\'s CEA').toHaveValue(GRADES.cea.rate.toFixed(2));
    await page.locator('#settingsToggle .card-toggle-arrow').click();
    await page.locator('#gradeSelect').selectOption('ces');
    await expect(page.locator('#gradeFromField')).toBeVisible();
    await expect(page.locator('#gradeFrom'), 'the box names the payslip on screen').toHaveValue(onScreen);
    expect(await page.evaluate(k => localStorage.getItem(k), `${LONG_SERVING_PC}grade_from`)).toBe(onScreen);
    await expect(page.locator('#hourlyRate'), 'and the payslip on screen is priced at it').toHaveValue(GRADES.ces.rate.toFixed(2));
    expect(errors).toHaveLength(0);
});

// Before the 24 Oct 2025 award a CES was paid at a rate that is not on record (AWARD_RATES
// `pre: null`), so the estimate prices those periods at the later one — and must SAY so, never call
// it the "current rate" (whole-app review, Oct 2026; paycalc.md invariant 1).
test('paycalc: a CES period before the 2025 award says the rate before it is not on record', async ({ page }) => {
    const member = 'F. Mohamed';   // the CES row of the grade test above
    await page.clock.setFixedTime(new Date('2026-10-22T09:00:00Z'));
    await seedSession(page, member);
    await page.addInitScript(() => { localStorage.setItem('myb_pc_ns_migrated', '1'); });
    await page.goto('/paycalc.html?payday=2025-07-04');
    await expect(page.locator('#rateYearLabel')).toContainText('post-rise rate');
    await expect(page.locator('#rateStepNote')).toContainText("isn't on record");
    await page.goto('/paycalc.html?payday=2025-11-21');
    await expect(page.locator('#rateYearLabel')).toContainText('current rate');
    await expect(page.locator('#rateStepNote')).toBeHidden();
});
