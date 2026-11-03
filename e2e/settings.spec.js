/**
 * settings.spec.js — Settings (settings.html): the status page, cards, password and work email.
 *
 * Split out of pages.spec.js on 3 Nov 2026, test for test and unchanged: the tests that span
 * pages, and the shared drawer, dialogs and sheets, stay there.
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession, seedMemberSession } from './helpers.js';

// ── SETTINGS (settings.html) ──────────────────────────────────────────────

// ── SETTINGS AS A STATUS PAGE (v22.37, owner review) ────────────────────────────────────────────
//
// The RULES are unit-tested in settings-status.test.mjs and they are the easy half: `summarise` is
// trivially right about every state it is handed. What only a browser can answer is whether the
// four cards actually REPORT — a card that reads its data and forgets to say so leaves a summary
// that is permanently "Checking…", or worse, leaves a tick on a card nobody looked at.
//
// So these drive the real page in the states staff are actually in, and assert what is on screen.

/** Put Settings in a chosen state. The single-doc read serves both the work email and the password
 *  status, so one seed decides both — which is why `configured` is one flag, not two. */
async function openSettings(page, { configured = false, payKeys = 0, noPush = false, iphone = false, forcePush = false } = {}) {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(({ configured, payKeys, noPush, iphone, forcePush }) => {
        for (let i = 0; i < payKeys; i++) localStorage.setItem(`myb_pc_gmiller_p${40 + i}`, '{}');
        const e = globalThis.__E2E || (globalThis.__E2E = {});
        if (configured) e.getDocData = {
            workEmail: 'g.miller@chilternrailways.co.uk',
            passwordSetAt: { toMillis: () => Date.parse('2026-08-01') },
        };
        if (noPush) {
            delete window.PushManager;
            Object.defineProperty(window, 'Notification', { value: undefined, configurable: true });
        }
        // THE PLATFORM IS PINNED, ALWAYS — never inherited from whichever project is running.
        // `isIOS()` reads the UA string, and Settings now behaves differently on an iPhone (where
        // installing is the prerequisite for notifications, so it becomes a thing to finish). Left
        // to the runner, the same test asserted "nothing to finish" under chromium and met a real
        // to-do under mobile-safari — which is the app being RIGHT and the test being unspecified.
        // Found by the WebKit lane, which is exactly what that lane is for.
        Object.defineProperty(navigator, 'userAgent', {
            value: iphone
                ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15'
                : 'Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            configurable: true,
        });
        if (iphone) {
            // Push is removed too, because that is the real consequence being modelled: WebKit
            // gives a page outside the Home Screen app none at all.
            delete window.PushManager;
            Object.defineProperty(window, 'Notification', { value: undefined, configurable: true });
        }
        if (forcePush) {
            // PUSH IS INSTALLED, NOT ASSUMED. `notifSupported()` wants Notification, PushManager
            // and serviceWorker all present; WebKit has no PushManager, so a test that needs the
            // card to get PAST the support check and reach the code under test cannot rely on the
            // engine providing one. Same lesson as the iPhone UA above — pin the environment
            // rather than inherit it, or the test quietly stops testing anything on one engine.
            if (!('PushManager' in window)) {
                Object.defineProperty(window, 'PushManager', { value: function () {}, configurable: true });
            }
            if (!('Notification' in window) || !window.Notification) {
                Object.defineProperty(window, 'Notification', { value: { permission: 'default' }, configurable: true });
            }
            if (!('serviceWorker' in navigator)) {
                Object.defineProperty(navigator, 'serviceWorker', { value: { ready: new Promise(() => {}) }, configurable: true });
            }
        }
    }, { configured, payKeys, noPush, iphone, forcePush });
    await page.goto('/settings.html');
    await expect(page.locator('#settingsSummary')).toBeVisible();
}

const cardOpen = (page, id) => page.evaluate(
    id => document.getElementById(id)?.classList.contains('open'), id);

test('settings: a configured account collapses its cards and says so', async ({ page }) => {
    // The whole point of the change. A returning member used to meet four expanded forms including
    // a large password form they had already dealt with.
    await openSettings(page, { configured: true, payKeys: 3, noPush: true });
    await expect(page.locator('#settingsSummaryLine')).toHaveText('✓ You’re all set');
    await expect(page.locator('#settingsSummary')).toHaveAttribute('data-tone', 'all-set');
    for (const id of ['contactBody', 'passwordBody', 'notifBody', 'payDataBody']) {
        expect(await cardOpen(page, id), `${id} must stay collapsed when there is nothing to do`).toBe(false);
    }
    await expect(page.locator('#contactStatusChip')).toHaveText('✓ Saved');
    await expect(page.locator('#passwordStatusChip')).toHaveText('✓ Password set');
    // The collapsed card answers WHICH address without being opened.
    await expect(page.locator('#contactHint')).toHaveText('g.miller@chilternrailways.co.uk');
});

test('settings: an iPhone in a browser is told to install, not that it is all set', async ({ page }) => {
    // WebKit gives a browser page no push until the app is on the Home Screen, so Notifications
    // correctly reports "not available" — and the summary used to close over that with
    // "✓ You're all set", hiding the one instruction that would change the answer (v22.39 review).
    await openSettings(page, { configured: true, iphone: true });
    await expect(page.locator('#settingsSummary')).toHaveAttribute('data-tone', 'todo');
    await expect(page.locator('#settingsSummaryItems li')).toHaveText(['Add the app to your Home Screen']);

    // The card that says how must be VISIBLE and showing the taps, not the button WebKit can't fire.
    await expect(page.locator('#deviceCard')).toBeVisible();
    await expect(page.locator('#installSteps')).toBeVisible();
    await expect(page.locator('#installSteps')).toContainText('Add to Home Screen');
    await expect(page.locator('#installBtn')).toBeHidden();

    // Notifications is still honestly unavailable — the fix names the prerequisite, it does not
    // pretend the card can be turned on.
    await expect(page.locator('#notifStatusChip')).toHaveText(/not available/i);

    // …and POINTS at the Install card rather than restating its steps (polish round 2). The pointer
    // is checked against the card's REAL heading, so renaming that card cannot leave this line
    // naming a card that no longer exists; and the taps must live in one place only.
    const installHeading = await page.locator('#deviceCard h2').evaluate(h =>   // minus the emoji span
        [...h.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim());
    expect(installHeading).not.toBe('');
    await expect(page.locator('#notifStatusMsg')).toContainText(installHeading);
    await expect(page.locator('#notifStatusMsg')).not.toContainText(/Share|Add to Home Screen/);

    // The Install card's opening line is the same size as every sibling card's (polish round 2) —
    // it was a step smaller, which read as a footnote rather than as the card's own explanation.
    const size = (sel) => page.locator(sel).first().evaluate(el => getComputedStyle(el).fontSize);
    expect(await size('#installNote')).toBe(await size('#payDataCard .card-explainer'));
});

test('settings: a saved work email says so before it offers to remove it', async ({ page }) => {
    // Polish round 2 (owner-approved): "Remove saved email" sat ABOVE "✓ Saved — last updated", so
    // the card offered to undo the save before confirming it. The confirmation answers the Save
    // button; Remove is the next thing you might do.
    await openSettings(page, { configured: true, noPush: true });
    await page.locator('#contactChevron').click();
    const feedback = page.locator('#contactFeedback');
    const remove   = page.locator('#workEmailRemoveBtn');
    await expect(feedback).toContainText('✓ Saved');
    await expect(remove).toBeVisible();
    const [f, r] = [await feedback.boundingBox(), await remove.boundingBox()];
    expect(f.y + f.height, 'the confirmation must sit above the Remove action').toBeLessThanOrEqual(r.y);
});

for (const [label, missingId, chipId, noPush, forcePush] of [
    // `noPush` false for notifications ON PURPOSE: with push unsupported the card answers 'n/a' at
    // the SUPPORT check and never reaches the markup guard, so the test would pass without
    // exercising anything. Push has to be available for the guard to be the thing that fires.
    ['notifications', 'notifStatusMsg',  'notifStatusChip',    false, true],
    ['work email',    'workEmailInput',  'contactStatusChip',  true,  false],
    ['password',      'pwCurrent',       'passwordStatusChip', true,  false],
]) {
    test(`settings: a broken ${label} card must not freeze the whole summary`, async ({ page }) => {
        // Each card bails when its markup is missing. Bailing SILENTLY leaves that card `unknown`,
        // and `unknown` outranks every other state — so one missing element does not cost one chip,
        // it holds the summary on "Checking your settings…" for the life of the page and hides a
        // genuine to-do on a card that is perfectly fine. The rule was always right in
        // settings-status.js; the wiring could produce a permanent unknown, which is this repo's
        // named blind spot ("the rule tested, the wiring not").
        await page.addInitScript((id) => {
            const real = document.getElementById.bind(document);
            document.getElementById = (x) => (x === id ? null : real(x));
        }, missingId);
        await openSettings(page, { configured: true, noPush, forcePush });

        await expect(page.locator('#settingsSummaryLine')).not.toHaveText(/Checking/i);
        await expect(page.locator('#settingsSummary')).toHaveAttribute('data-tone', 'error');
        await expect(page.locator('#settingsSummaryLine')).toContainText(/could not be checked/i);
        await expect(page.locator(`#${chipId}`)).toHaveText(/couldn/i);
    });
}

test('settings: an install OFFER on Android is not a thing to finish', async ({ page }) => {
    // The other direction. An Android member loses nothing by never installing, so the summary
    // must not put a to-do in front of them — a false alarm costs exactly the attention this page
    // was redesigned to stop spending.
    await openSettings(page, { configured: true, noPush: true });
    await expect(page.locator('#settingsSummaryLine')).toHaveText('✓ You’re all set');
    await expect(page.locator('#deviceCard')).toBeHidden();
});

test('settings: the work email field holds the local part, not the whole address', async ({ page }) => {
    // The v22.37 redesign put `@chilternrailways.co.uk` beside the field but kept loading the
    // COMPLETE address into it, so a member with a saved email opened the card and read
    // `g.miller@chilternrailways.co.uk @chilternrailways.co.uk`. The existing test above passed
    // throughout, because it only ever read the COLLAPSED hint — the defect is one tap further in.
    await openSettings(page, { configured: true, noPush: true });
    await page.locator('#contactToggleHeader').click();
    expect(await cardOpen(page, 'contactBody')).toBe(true);
    await expect(page.locator('#workEmailInput')).toHaveValue('g.miller');
    await expect(page.locator('#workEmailDomain')).toHaveText('@chilternrailways.co.uk');

    // And a complete address arriving by paste or autofill is stripped back, rather than
    // rendering the domain twice again.
    await page.locator('#workEmailInput').fill('s.silva@chilternrailways.co.uk');
    await page.locator('#workEmailInput').blur();
    await expect(page.locator('#workEmailInput')).toHaveValue('s.silva');

    // A FOREIGN domain is left visible so the save can refuse it — stripping it would save a
    // Chiltern address the member never gave.
    await page.locator('#workEmailInput').fill('g.miller@gmail.com');
    await page.locator('#workEmailInput').blur();
    await expect(page.locator('#workEmailInput')).toHaveValue('g.miller@gmail.com');
    await page.locator('#workEmailSaveBtn').click();
    await expect(page.locator('#contactFeedback')).toContainText('Chiltern work email');
});

test('settings: a card that needs attention opens ITSELF, and is named at the top', async ({ page }) => {
    // The other direction — a summary that only ever reassures is worth nothing.
    await openSettings(page, { configured: false, noPush: true });
    await expect(page.locator('#settingsSummary')).toHaveAttribute('data-tone', 'todo');
    await expect(page.locator('#settingsSummaryItems li')).toHaveText([
        'Set your own password', 'Add your work email',
    ]);
    expect(await cardOpen(page, 'passwordBody'), 'the password card must open itself').toBe(true);
    expect(await cardOpen(page, 'contactBody'), 'and so must the work email card').toBe(true);
    // …but a card with nothing wrong is left alone even on a page that has to-dos.
    expect(await cardOpen(page, 'payDataBody')).toBe(false);
});

/** A surface's three colours, as the browser resolved them. */
const paintOf = (page, sel) => page.locator(sel).evaluate(el => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, border: s.borderTopColor, text: s.color };
});

for (const [label, configured, stripTone, chipTone, chips] of [
    ['nothing to do',     true,  'all-set', 'ok',     [['contactStatusChip', '✓ Saved'],   ['passwordStatusChip', '✓ Password set']]],
    ['a thing to finish', false, 'todo',    'action', [['contactStatusChip', 'Not saved'], ['passwordStatusChip', 'Using surname']]],
]) {
    test(`settings: a chip with ${label} wears the summary strip's own colour`, async ({ page }) => {
        // v25.14. A chip is coloured by the state that wrote its words, through the SAME
        // declarations as the summary strip — so the strip and a chip can never say one thing in
        // two colours. Compared with the strip's COMPUTED colours rather than restated values: what
        // is pinned is that the two match, which is the property, not what the colours are today.
        await openSettings(page, { configured, payKeys: 3, noPush: true });
        await expect(page.locator('#settingsSummary')).toHaveAttribute('data-tone', stripTone);
        const strip = { ...(await paintOf(page, '#settingsSummary')), text: (await paintOf(page, '#settingsSummaryLine')).text };
        // A count is a fact, not news, so "3 payslips" keeps the neutral chip — and the strip must
        // differ from it here, or "the chip matches the strip" would prove nothing.
        await expect(page.locator('#payDataStatusChip')).toHaveText('3 payslips');
        expect(strip.bg, 'the strip must be coloured in this state').not.toBe((await paintOf(page, '#payDataStatusChip')).bg);
        for (const [id, words] of chips) {
            await expect(page.locator(`#${id}`)).toHaveText(words);
            await expect(page.locator(`#${id}`)).toHaveAttribute('data-tone', chipTone);
            expect(await paintOf(page, `#${id}`), `${id} must wear the strip's colours`).toEqual(strip);
        }
    });
}

test('settings: notifications switched off on purpose are not coloured as good news', async ({ page }) => {
    // The one `ok` chip whose words are not good news (v25.14). Switched off HERE is `ok` to the
    // summary — nothing to do, the member decided — but a green "Off" would have the colour and
    // the word disagree. huddle.js says so at the source ('plain'); this pins that it arrives.
    // Permission is pinned to 'default' for the same reason openSettings pins the platform: a
    // headless engine's own answer is not the state under test.
    await page.addInitScript(() => {
        localStorage.setItem('myb_notif_user_off', '1');
        Object.defineProperty(window, 'Notification', { value: { permission: 'default' }, configurable: true });
    });
    await openSettings(page, { configured: true, forcePush: true });
    await expect(page.locator('#notifStatusChip')).toHaveText('Off');
    await expect(page.locator('#settingsSummary')).toHaveAttribute('data-tone', 'all-set');
    await expect(page.locator('#notifStatusChip')).toHaveAttribute('data-tone', 'plain');
    const off = await paintOf(page, '#notifStatusChip');
    expect(off.bg, 'a chosen "Off" must not wear the strip\'s green').not.toBe((await paintOf(page, '#settingsSummary')).bg);
    expect(off, 'it is the neutral chip, like any fact').toEqual(await paintOf(page, '#payDataStatusChip'));
});

test('settings: a read that FAILED never reads as all set', async ({ page }) => {
    // The dangerous direction, and the one nothing on screen would otherwise contradict: a member
    // told "all set" over a password status nobody managed to read closes the page.
    await page.setViewportSize({ width: 390, height: 844 });
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(() => { (globalThis.__E2E || (globalThis.__E2E = {})).failGetDoc = true; });
    await page.goto('/settings.html');
    await expect(page.locator('#settingsSummary')).toBeVisible();
    await expect(page.locator('#settingsSummaryLine')).not.toHaveText('✓ You’re all set');
    await expect(page.locator('#contactStatusChip')).toHaveText('Couldn’t check');
    expect(await cardOpen(page, 'contactBody'), 'an unreadable setting must be shown, not hidden').toBe(true);
});

test('settings: the password form is behind a door once there is nothing to fix', async ({ page }) => {
    await openSettings(page, { configured: true, noPush: true });
    await page.locator('#passwordChevron').click();          // open the card by hand
    await expect(page.locator('#pwSettled')).toBeVisible();
    await expect(page.locator('#pwCurrent')).toBeHidden();
    await page.locator('#pwChangeBtn').click();
    await expect(page.locator('#pwCurrent')).toBeVisible();
    await expect(page.locator('#pwSettled')).toBeHidden();
    // Where forgetting it actually stops you — it used to be in the `?` panel only.
    await expect(page.locator('.pw-forgot')).toContainText('Ask the admin');
});

test('settings: Show passwords reveals all THREE fields, not two', async ({ page }) => {
    // The old control sat beside New and silently also governed Confirm. Current — where a
    // mistyped password most often comes from — was never covered.
    await openSettings(page, { configured: false, noPush: true });
    const types = () => page.evaluate(() =>
        ['pwCurrent', 'pwNew', 'pwConfirm'].map(id => document.getElementById(id).type));
    expect(await types()).toEqual(['password', 'password', 'password']);
    await page.locator('#pwShowAll').check();
    expect(await types()).toEqual(['text', 'text', 'text']);
    await page.locator('#pwShowAll').uncheck();
    expect(await types()).toEqual(['password', 'password', 'password']);
});

test('settings: a saved email does not push the card\'s own chevron off it (v23.35)', async ({ page }) => {
    // A flex item's automatic minimum is its MIN-CONTENT, so the hint's 31-character address —
    // one unbreakable token — pinned the header's left block at that width and pushed
    // `.card-header-actions` (which is `flex-shrink: 0`) past the card's right edge, where
    // `.card { overflow: hidden }` deleted it. Measured at 320px: the chevron sat at x=317
    // against a card ending at 310, `elementFromPoint` returned `<body>`, and the Work Email card
    // rendered with NO chevron while its three neighbours kept theirs.
    //
    // Nothing else could see it. The card still opens — the whole header is the click target — so
    // every behavioural assertion passed; the visual baselines run at one desktop width; and the
    // tap-target sweep skips a control it cannot probe outward from. Only geometry at a narrow
    // width, in the state where an address IS saved, shows it.
    //
    // 320px is a device state rather than a museum piece: Android's Display-size setting narrows
    // the CSS viewport, which is why the v23.32 containment fix was measured at 1.6x.
    await page.setViewportSize({ width: 320, height: 844 });
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(() => {
        (globalThis.__E2E || (globalThis.__E2E = {})).getDocData = {
            workEmail: 'g.miller@chilternrailways.co.uk',
            passwordSetAt: { toMillis: () => Date.parse('2026-08-01') },
        };
    });
    await page.goto('/settings.html');
    await expect(page.locator('#settingsSummary')).toBeVisible();
    await expect(page.locator('#contactHint')).toHaveText('g.miller@chilternrailways.co.uk');

    const m = await page.evaluate(() => {
        const card = document.getElementById('contactCard');
        const chev = document.getElementById('contactChevron');
        const cr = card.getBoundingClientRect(), r = chev.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
            over: Math.round(r.right - cr.right),
            hittable: !!(hit && (hit === chev || chev.contains(hit))),
        };
    });
    expect(m.over, 'the chevron must stay inside its own card').toBeLessThanOrEqual(0);
    expect(m.hittable, 'and it must be the thing under its own centre').toBe(true);
    // Teeth: removing `overflow-wrap: anywhere` from `.card-header .hint` fails both of the above.
    // Removing `min-width: 0` does NOT — the wrap shrinks min-content by itself, so it is the half
    // that fixes this. That is recorded in shared.css beside the rule rather than papered over.

    // The other half of the fix, and it is not cosmetic: the collapsed card's job is to answer
    // "which address is saved?" without being opened, so freeing the chevron by letting the hint
    // be clipped mid-token would trade one defect for another. It WRAPS.
    // Measured against the hint's OWN one-line height rather than a `line-height` computation:
    // `.card-header .hint` sets none, so that resolves to `normal` and parses to NaN — which is
    // how the first cut of this assertion failed against a fix that was working.
    const wrapped = await page.evaluate(() => {
        const h = /** @type {HTMLElement} */ (document.getElementById('contactHint'));
        const tall = h.getBoundingClientRect().height;
        const was = h.textContent;
        h.textContent = 'x';
        const one = h.getBoundingClientRect().height;
        h.textContent = was;
        return { tall: Math.round(tall), one: Math.round(one) };
    });
    expect(wrapped.tall, `the address wraps rather than being cut off (${JSON.stringify(wrapped)})`)
        .toBeGreaterThan(wrapped.one);
});

test('settings: the pay data card counts what is actually on the device', async ({ page }) => {
    // "Saved on this device only" is a warning about nothing until it says how much.
    await openSettings(page, { configured: true, payKeys: 3, noPush: true });
    await expect(page.locator('#payDataStatusChip')).toHaveText('3 payslips');
    await expect(page.locator('#payDataInventory')).toContainText('3 payslips');
    await expect(page.locator('#payDataInventory')).toContainText('saved on this device');
});

test('settings: a shared device does not count a colleague’s payslips as yours', async ({ page }) => {
    // NOT hypothetical — staff share the station PC, and the pay data of everyone who has used it
    // is sitting in the same localStorage. The count is per-member because it is built from
    // `selectBackupKeys`, which filters to this member's prefix; handing `inventoryOf` the raw key
    // list instead slices every key by the prefix LENGTH, so a colleague whose slug happens to be
    // the same length has their payslips classified as this member's. Measured: 5 against 2.
    await page.setViewportSize({ width: 390, height: 844 });
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(() => {
        for (const k of ['p43', 'p44']) localStorage.setItem('myb_pc_gmiller_' + k, '{}');
        // Same slug LENGTH as gmiller, which is what makes the unfiltered slice line up.
        for (const k of ['p60', 'p61', 'p62']) localStorage.setItem('myb_pc_smiller_' + k, '{}');
        const e = globalThis.__E2E || (globalThis.__E2E = {});
        e.getDocData = { workEmail: 'g.miller@chilternrailways.co.uk',
                         passwordSetAt: { toMillis: () => Date.parse('2026-08-01') } };
    });
    await page.goto('/settings.html');
    await expect(page.locator('#payDataStatusChip')).toHaveText('2 payslips');
});

test('settings: a device with no pay data says so, rather than saying nothing', async ({ page }) => {
    await openSettings(page, { configured: true, payKeys: 0, noPush: true });
    await expect(page.locator('#payDataInventory')).toHaveText('No pay calculator history saved yet');
    await expect(page.locator('#payDataStatusChip')).toHaveText('None saved');
});

test('settings: the install card exists only while there is an install to offer', async ({ page }) => {
    // It moved OUT of Notifications, where nobody would have looked for it. The whole card is
    // conditional — a permanent "✓ Installed" row would be one that never does anything again.
    await openSettings(page, { configured: true, noPush: true });
    await expect(page.locator('#deviceCard')).toBeHidden();
    await page.evaluate(() => {
        const e = new Event('beforeinstallprompt');
        e.prompt = () => { window.__promptFired = true; return Promise.resolve(); };
        window.dispatchEvent(e);
    });
    await expect(page.locator('#deviceCard')).toBeVisible();
    await page.locator('#installBtn').click();
    expect(await page.evaluate(() => window.__promptFired)).toBe(true);
    await expect(page.locator('#deviceCard')).toBeHidden();
});

test('settings: login overlay renders with JS-populated grade options', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/settings.html');

    await expect(page.locator('#loginOverlay')).toBeVisible();

    const gradeCount = await page.locator('#loginGrade option').count();
    expect(gradeCount, '#loginGrade should have JS-added grade options').toBeGreaterThan(1);

    expect(errors, 'Uncaught JS exceptions on settings.html').toHaveLength(0);
});

// Regression: the settings login fields must be STYLED (full-width, like admin), not raw browser
// controls. They fell back to defaults because the field CSS lived in admin.css's generic
// `select, input {}` rule, which settings.css doesn't have — fixed by styling `.login-field`
// fields in shared.css (v14.43). A raw control renders at its tiny intrinsic width (~120px);
// the styled one fills the card (~280px).
//
// IT MEASURES WHICHEVER ELEMENT IS ACTUALLY THE CONTROL, and that is the point (v23.50). This
// test read `#loginGrade` directly until v23.49 put the sign-in pair through `enhanceSelect`,
// which leaves the native `<select>` in place as a 1px `aria-hidden` VALUE HOLDER and moves every
// visible pixel to a `#loginGradeTrigger` button. The measurement then read 1 and the test failed
// — on a page whose sign-in card was rendering perfectly, the trigger filling its field exactly.
//
// That is the failure mode `select-sheet-parity.test.mjs` exists to name: an enhancement changes
// what an untouched call site is looking at. Retargeting this at `#loginGradeTrigger` would fix
// today and re-create the same trap in reverse the day the enhancement is removed, so it resolves
// the control instead. The assertion also got STRICTER on the way past: the defect was a field
// falling back to its intrinsic width, so "fills its own field" states it, where `> 200` was a
// threshold that happened to sit between the two.
test('settings login fields are styled full-width, not raw browser defaults', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/settings.html');
    await expect(page.locator('#loginOverlay')).toBeVisible();
    await page.locator('#loginGrade').waitFor({ state: 'attached' });

    const m = await page.evaluate(() => {
        const sel = document.getElementById('loginGrade');
        // The enhanced trigger if there is one, else the select itself.
        const control = document.getElementById('loginGradeTrigger') || sel;
        const field = sel.closest('.login-field') || sel.parentElement;
        return {
            id: control.id,
            control: control.getBoundingClientRect().width,
            field: field.getBoundingClientRect().width,
        };
    });

    expect(m.field, 'the .login-field container should itself be card-width').toBeGreaterThan(200);
    expect(
        m.control,
        `the settings login GRADE control (#${m.id}) should FILL its field, not render at a raw `
        + `intrinsic width — measured ${m.control}px inside a ${m.field}px field`,
    ).toBeGreaterThan(m.field - 2);
});

test('settings (signed in): card "?" button opens the Tips lightbox, not the card', async ({ page }) => {
    // Regression guard for the per-card Tips wiring. The logged-out tests above
    // never run initApp(), so a break in the signed-in path (e.g. a throw before
    // initCardCollapse wires the Work Email header) would ship unnoticed —
    // clicking "?" would then fall through to the header and toggle the card
    // collapse instead of opening the tips. This test exercises that path.
    const errors = collectFatalErrors(page);

    // Seed a valid session so the page runs initApp() instead of the login overlay.
    await seedSession(page);
    await page.goto('/settings.html');

    // Proof that initApp() → initContactCard() → initCardCollapse() ran: the collapse helper sets
    // aria-expanded on the toggle CONTROL — the chevron, not the header (v17.50: the header is no
    // longer role="button", so it can't nest the Tips "?" button; the chevron is the focusable
    // toggle). "true" since the card DEFAULTS OPEN on this 2-card page (v16.57 UX). The static HTML
    // has no aria-expanded, so its presence proves the signed-in init wired the collapse — meaning
    // the "?" handler is in place and the click below cannot race the wiring.
    await expect(page.locator('#contactChevron')).toHaveAttribute('aria-expanded', 'true');

    // The Work Email card starts OPEN and the tips overlay starts hidden.
    await expect(page.locator('#tipsLightbox')).toBeHidden();
    await expect(page.locator('#contactBody')).toHaveClass(/\bopen\b/);

    await page.locator('.btn-card-tips[data-card="work-email"]').click();

    // The Tips lightbox must open with the right content …
    await expect(page.locator('#tipsLightbox')).toBeVisible();
    await expect(page.locator('#tipsLbTitle')).toHaveText('Work Email');
    // … and the "?" click MUST NOT have toggled the card (the reported bug symptom:
    // clicking "?" fell through to the header and collapsed the card). It stays open.
    await expect(page.locator('#contactBody')).toHaveClass(/\bopen\b/);

    expect(errors, 'Uncaught JS exceptions on signed-in settings.html').toHaveLength(0);
});

// ── SETTINGS: Password card reveal toggle (v18.95) ─────────────────────────────────────────────
// The login overlay and the forced overlay both offer a reveal; this card asked for an 8+ character
// password TWICE with no way to see either, which is where a mistyped password comes from.
// REMOVED at v22.37: 'Show reveals BOTH new and confirm'. It pinned the OLD control — a `Show`
// button beside New that silently also governed Confirm — and its successor covers strictly more:
// 'Show passwords reveals all THREE fields, not two' asserts Current as well, which is where a
// mistyped password most often comes from and which the old control never reached.

test('settings: a member migrated on ANOTHER device is told so here', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    // The server says migrated; this device has never been told. `toMillis` because that is the
    // shape isPasswordMigrated reads — a plain Date would silently score 0 and pass for the wrong
    // reason, reporting un-migrated on a doc that says otherwise.
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = /** @type {any} */ (window).__E2E || {};
        /** @type {any} */ (window).__E2E.getDocData = { passwordSetAt: { toMillis: () => 1_760_000_000_000 } };
    });
    await page.goto('/settings.html');
    await expect(page.locator('#passwordStatusChip')).toHaveText(/password set/i);
});

test('settings: an UN-migrated member is told that instead', async ({ page }) => {
    // The mirror image. Default fixture `getDoc` resolves "does not exist", i.e. still on the
    // surname default — and saying "your own password" to somebody who has not set one would tell
    // them a security job is done when it is not.
    await seedSession(page, 'G. Miller');
    await page.goto('/settings.html');
    await expect(page.locator('#passwordStatusChip')).toHaveText(/using surname/i);
});

test('settings: the forced overlay\'s success updates the chip without a reload', async ({ page }) => {
    // password-force.js dispatches `myb:password-set` when it succeeds, which the card listens for
    // (v18.94). That path paints migrated OPTIMISTICALLY — the serverTimestamp has not resolved —
    // so the chip must move on the event alone.
    await seedSession(page, 'G. Miller');
    await page.goto('/settings.html');
    await expect(page.locator('#passwordStatusChip')).toHaveText(/using surname/i);

    await page.evaluate(() => document.dispatchEvent(new CustomEvent('myb:password-set')));
    await expect(page.locator('#passwordStatusChip')).toHaveText(/password set/i);
});

test('settings (signed in): the Pay Calculator Data pointer card renders and links to the backup card', async ({ page }) => {
    // A POINTER, not a second copy of the controls — see paycalc-transfer-card.js.
    await seedSession(page);
    await page.goto('/settings.html');
    const card = page.locator('#payDataCard');
    await expect(card).toBeVisible();
    // The card starts COLLAPSED now (v22.37) — it has no wrong state to warn about, so it shows a
    // count and waits to be asked. Its link is behind that, which is the journey a member takes.
    await expect(card.locator('a[href*="paycalc.html#payTransferCard"]')).toBeHidden();
    await page.locator('#payDataChevron').click();
    await expect(card.locator('a[href*="paycalc.html#payTransferCard"]')).toBeVisible();
});
