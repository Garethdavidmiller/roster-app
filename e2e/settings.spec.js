/**
 * settings.spec.js — Settings (settings.html): the status page, cards, password and work email.
 *
 * Split out of pages.spec.js on 3 Nov 2026, test for test and unchanged: the tests that span
 * pages, and the shared drawer, dialogs and sheets, stay there.
 */
import { test, expect, forcePasswordSet, withOtherStaff } from './fixtures.js';
import { collectFatalErrors, seedSession, seedMemberSession, signInThroughOverlay, isTouchProject } from './helpers.js';
import { teamMembers } from '../roster-data.js';

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
    await expect(page.locator('#settingsSummaryItems li')).toHaveText(['Add the roster to your Home Screen']);

    // The card that says how must be VISIBLE and showing the taps, not the button WebKit can't fire —
    // OPEN, with the to-do's amber chip, so the summary and the card it leads to say one thing.
    await expect(page.locator('#deviceCard')).toBeVisible();
    await expect(page.locator('#deviceStatusChip')).toHaveText('Not installed');
    await expect(page.locator('#deviceStatusChip')).toHaveAttribute('data-tone', 'action');
    expect(await cardOpen(page, 'deviceBody'), 'a to-do opens its card').toBe(true);
    await expect(page.locator('#installNoteIos')).toBeVisible();
    await expect(page.locator('#installSteps')).toBeVisible();
    await expect(page.locator('#installSteps')).toContainText('Add to Home Screen');
    await expect(page.locator('#installBtn')).toBeHidden();

    // Notifications are not available HERE, and will be once installed (22 Nov 2026: "After install",
    // not "Not available", which is kept for a device that truly cannot). The list it shows is the
    // installed app's, so the card promises nothing this browser tab can receive.
    await expect(page.locator('#notifStatusChip')).toHaveText('After install');
    await expect(page.locator('#notifKindsLead')).toHaveText('In the Home Screen app, you’ll get:');

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

// ── WHAT AN iPHONE INSTALL DOES NOT CARRY (iPhone audit, 7 Nov 2026) ─────────────────────────────
// A Home Screen app on an iPhone keeps storage of its own: the member is signed out there, and Pay
// Calculator figures saved in the browser stay in the browser. The card promised the opposite —
// installing "keeps this device's saved pay data safe from being cleared" — and its last step sent
// the member to an app that held none of it. The first step now carries the figures across, shown
// from the Pay Calculator Data card's own count, so the two cards cannot disagree about what is here.
for (const [label, payKeys, payStep] of [['with pay figures, the first step carries them across', 2, true],
                                         ['with none, there is nothing to carry and no such step', 0, false]]) {
    test(`settings: an iPhone install — ${label}`, async ({ page }) => {
        await openSettings(page, { configured: true, iphone: true, payKeys });
        const steps = page.locator('#installSteps');
        await expect(steps).toBeVisible();
        await expect(page.locator('#payDataStatusChip'), 'premise: the Pay Calculator Data card\'s count').toHaveText(payKeys ? `${payKeys} payslips` : 'None saved');
        const shown = steps.locator('li:visible');
        if (payStep) {
            await expect(page.locator('#installStepPay')).toBeVisible();
            await expect(shown.first(), 'copying the figures is the FIRST thing to do').toHaveAttribute('id', 'installStepPay');
            await expect(shown.first()).toContainText('Move Your Pay Data');
        } else {
            await expect(page.locator('#installStepPay')).toBeHidden();
        }
        await expect(steps).toContainText('Open it in Safari first');                  // an email or chat app cannot add it
        await expect(steps).toContainText('on iOS 26 or later it is under •••');        // where Share is now
        await expect(shown.last()).toContainText('sign in there once');                 // the Home Screen app is signed out
        // The promise covers what is saved once installed — never what is already saved here.
        await expect(page.locator('#installNote')).toContainText('Pay figures you save once it is installed');
        await expect(page.locator('#deviceCard')).not.toContainText('saved pay data safe');
    });
}

// ── THE PAGES MIRROR (Nov 2026 review) ──────────────────────────────────────────────────────────
// The app is never installed FROM the mirror, so an iPhone there reported nothing to finish — and with
// notifications "not available" the summary said "✓ You're all set" to a phone that can never receive
// one. It is a to-do there too, and the steps start at the main address. The mirror is the host the
// page tests for (`github.io`); this serves the page as if it were there, LOUD if that test moves.
// notif.js's `onPagesMirror` is the app's one copy of the test and MUST be found. settings-app.js still
// carries copies of its own; they are rewritten too while they last, and may go (to `onPagesMirror`).
async function asMirror(page) {
    for (const [file, required] of /** @type {const} */ ([['notif.js', true], ['settings-app.js', false]])) {
        await page.route(`**/${file}`, async route => {
            const res = await route.fetch();
            const src = await res.text();
            const host = '/github\\.io$/i.test(window.location.hostname)';
            if (required && !src.includes(host)) throw new Error(`${file}: the mirror test moved — update asMirror`);
            await route.fulfill({ response: res, contentType: 'text/javascript', body: src.replaceAll(host, 'true') });
        });
    }
}

test('settings: an iPhone on the Pages mirror is sent to the main address to install, not told it is all set', async ({ page }) => {
    await asMirror(page);
    await openSettings(page, { configured: true, iphone: true });
    await expect(page.locator('#settingsSummary')).toHaveAttribute('data-tone', 'todo');
    await expect(page.locator('#settingsSummaryItems li')).toHaveText(['Add the roster to your Home Screen']);
    await expect(page.locator('#deviceCard')).toBeVisible();
    await expect(page.locator('#installBtn')).toBeHidden();
    const main = page.locator('#installStepMain');
    await expect(main).toBeVisible();
    await expect(main.locator('a')).toHaveAttribute('href', 'https://myb-roster.web.app/');
    await expect(page.locator('#installStepSafari'), 'the step for opening THIS address gives way to it').toBeHidden();
    await expect(page.locator('#installSteps li:visible').last()).toContainText('sign in there once');
    // ONE set of instructions (22 Nov 2026): the Notifications card on the mirror gave its own steps to
    // the main address while the Install card gave them too. It points at that card, as off the mirror.
    const heading = await page.locator('#deviceCard h2').evaluate(h =>
        [...h.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim());
    const notif = page.locator('#notifStatusMsg');
    await expect(notif).toContainText(heading);
    await expect(notif).not.toContainText(/web\.app|Add to Home Screen|Share/);
    await expect(page.locator('#notifStatusChip')).toHaveText('After install');
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

// "✓ Saved" answers the address it was said about (settings review, Nov 2026): typing a different one left the
// tick beside it, as though the new address were saved before Save was pressed.
test('settings: typing a different address takes the "✓ Saved" away; the saved one, retyped, does not', async ({ page }) => {
    await openSettings(page, { configured: true, noPush: true });
    await page.locator('#contactChevron').click();
    const feedback = page.locator('#contactFeedback');
    await expect(feedback).toHaveText('✓ Saved');
    // The tick is decoration in a live region, hidden from a screen reader (status-text.js; whole-app review, 24 Nov 2026).
    await expect(feedback.locator('span[aria-hidden="true"]')).toHaveText('✓');
    await page.locator('#workEmailInput').fill('g.miller@chilternrailways.co.uk');   // the same address, typed whole
    await expect(feedback).toHaveText('✓ Saved');
    await page.locator('#workEmailInput').fill('g.millerx');
    await expect(feedback).toHaveText('');
    await expect(page.locator('#contactStatusChip'), 'the address on record is still saved').toHaveText('✓ Saved');
});

// TYPED BEFORE THE SAVED ADDRESS LOADED (18 Nov 2026). On a slow first read the card keeps what the member has typed,
// and it told the summary "✓ Saved" — but left Remove hidden and the subtitle asking for an email, so a member with
// an address saved could neither see which one it was nor remove it.
test('settings: an email typed before the saved one loads is kept — and the card still names the saved one and offers Remove', async ({ page }) => {
    await page.addInitScript(() => { (globalThis.__E2E || (globalThis.__E2E = {})).getDocHold = true; });
    await openSettings(page, { configured: true, noPush: true });
    await expect.poll(() => page.evaluate(() => typeof /** @type {any} */ (window).__E2E?.releaseGetDoc),
        { message: 'premise: the saved email is still being read' }).toBe('function');
    if (!(await cardOpen(page, 'contactBody'))) await page.locator('#contactChevron').click();
    await page.locator('#workEmailInput').fill('q.example');
    await page.evaluate(() => /** @type {any} */ (window).__E2E.releaseGetDoc());
    await expect(page.locator('#contactStatusChip')).toHaveText('✓ Saved');
    await expect(page.locator('#workEmailInput'), 'what the member typed is kept').toHaveValue('q.example');
    await expect(page.locator('#contactFeedback'), 'no "✓ Saved" for a Save they have not pressed').toHaveText('');
    await expect(page.locator('#contactHint'), 'the collapsed card names the address that IS saved').toHaveText('g.miller@chilternrailways.co.uk');
    await expect(page.locator('#workEmailRemoveBtn'), 'and the saved address can be removed').toBeVisible();
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
        await expect(page.locator('#settingsSummaryLine')).toHaveText('Some settings couldn’t be checked — check your connection, then reopen Settings.');
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
        'Set your own password', 'Save your work email',
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
    // the word disagree. notif-card-core.js says so at the source ('plain'); this pins that it arrives.
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

// ── A CHANGED PASSWORD IS FILED UNDER THE MEMBER (iPhone audit, 7 Nov 2026) ─────────────────────
// A password manager files a password under the username field in the SAME <form>. The sign-in card
// has had one since Oct 2026; the two places a member CHANGES their password had no form at all, so
// iCloud Keychain saved a new one on nobody's name. Both now follow the sign-in card: a real form, a
// hidden username holding the roster name, and a submit that is always cancelled. Whether Keychain
// then offers to save is a device check; what a browser can prove is the shape, that the keyboard
// reaches the save, and that the form is submitted ONLY once the write is confirmed — never for a
// password the checks refuse, and never for one the server refuses (a wrong current password used to
// leave Keychain offering to save a new password that was never set).
/** Count every submit that reaches the document, and whether it had been cancelled by then. */
const recordSubmits = (page) => page.evaluate(() => {
    /** @type {any} */ (window).__submits = [];
    document.addEventListener('submit', e => /** @type {any} */ (window).__submits.push(e.defaultPrevented));
});
const submits = (page) => page.evaluate(() => /** @type {any} */ (window).__submits);

test('settings: the password card is a real form under the member\'s name — Next moves on, Done saves, and only then is it submitted', async ({ page }) => {
    // A signed-in Firebase user with the member's own address, so re-authentication and the write can
    // SUCCEED under the stub (window.__E2E.authUser / authUserEmail).
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { .../** @type {any} */ (window).__E2E,
        authUser: true, authUserEmail: 'g.miller@myb-roster.local' }; });
    await openSettings(page, { configured: false, noPush: true });     // un-migrated: the form is open
    await expect(page.locator('#pwCurrent')).toBeVisible();
    const shape = await page.evaluate(() => {
        const user = /** @type {HTMLInputElement} */ (document.getElementById('pwUsername'));
        const same = ['pwCurrent', 'pwNew', 'pwConfirm'].every(id => /** @type {HTMLInputElement} */ (document.getElementById(id)).form === user.form);
        return { tag: user.form?.id, value: user.value, same, autocomplete: user.autocomplete };
    });
    expect(shape, 'one form, holding the member\'s roster name as its username').toEqual(
        { tag: 'pwForm', value: 'G. Miller', same: true, autocomplete: 'username' });

    await recordSubmits(page);
    // A password the checks refuse is never submitted — a password manager is never offered it.
    await page.locator('#pwCurrent').fill('miller');
    await page.locator('#pwNew').fill('a-real-password-9');
    await page.locator('#pwConfirm').fill('a-different-one-9');
    await page.locator('#pwConfirm').press('Enter');
    await expect(page.locator('#pwFeedback')).toContainText(/match/i);
    expect(await submits(page)).toEqual([]);

    // The return key does what the keyboard labels it: Next, Next, then Done saves.
    await page.locator('#pwCurrent').press('Enter');
    await expect(page.locator('#pwNew')).toBeFocused();
    await page.locator('#pwNew').press('Enter');
    await expect(page.locator('#pwConfirm')).toBeFocused();
    expect(await submits(page), 'Next only moves on').toEqual([]);
    await page.locator('#pwConfirm').fill('a-real-password-9');
    await page.locator('#pwConfirm').press('Enter');
    await expect(page.locator('#pwFeedback')).toContainText('Password updated');
    expect(await submits(page), 'exactly one submit, once the write was confirmed, and it was cancelled').toEqual([true]);
    expect(new URL(page.url()).pathname, 'the form never goes anywhere').toBe('/settings.html');
});

// ── THE FIRST SAVE KEEPS THE KEYBOARD'S PLACE (Nov 2026 review) ─────────────────────────────────
// A member on the surname default saves their first password and the form folds away behind "Change
// password" — with focus inside it, on Confirm after Done, or on Save. Focus fell to the page, so a
// keyboard or screen-reader user was put back at the top of it. It lands on Change password.
for (const [how, save] of /** @type {const} */ ([['Done on the keyboard', 'enter'], ['the Save button', 'click']])) {
    test(`settings: a first password saved with ${how} leaves focus on Change password`, async ({ page }) => {
        await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { .../** @type {any} */ (window).__E2E,
            authUser: true, authUserEmail: 'g.miller@myb-roster.local' }; });
        await openSettings(page, { configured: false, noPush: true });
        await page.locator('#pwCurrent').fill('miller');
        await page.locator('#pwNew').fill('a-real-password-9');
        await page.locator('#pwConfirm').fill('a-real-password-9');
        if (save === 'enter') await page.locator('#pwConfirm').press('Enter');
        else await page.locator('#pwSaveBtn').click();
        await expect(page.locator('#pwFeedback')).toContainText('Password updated');
        await expect(page.locator('#pwForm'), 'premise: the first save folds the form away').toBeHidden();
        await expect(page.locator('#pwChangeBtn')).toBeFocused();
    });
}

test('settings: a password change the SERVER refuses is never submitted to the password manager', async ({ page }) => {
    // No Firebase user: the stub refuses the re-authentication, as a wrong current password would.
    await openSettings(page, { configured: false, noPush: true });
    await expect(page.locator('#pwCurrent')).toBeVisible();
    await recordSubmits(page);
    await page.locator('#pwCurrent').fill('not-my-password');
    await page.locator('#pwNew').fill('a-real-password-9');
    await page.locator('#pwConfirm').fill('a-real-password-9');
    await page.locator('#pwSaveBtn').click();
    await expect(page.locator('#pwFeedback')).not.toBeEmpty();
    await expect(page.locator('#pwFeedback')).not.toContainText('Password updated');
    await expect(page.locator('#pwSaveBtn')).toBeEnabled();                   // the attempt is over
    expect(await submits(page), 'a refused password reached the password manager').toEqual([]);
});

test('settings: a refusal puts the caret where its message points, and the next save starts with a clean line (sign-in check, 11 Nov 2026)', async ({ page }) => {
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { .../** @type {any} */ (window).__E2E,
        authUser: true, authUserEmail: 'g.miller@myb-roster.local', reauthFailCode: 'auth/invalid-credential' }; });
    await openSettings(page, { configured: false, noPush: true });
    // A short new password with Confirm left empty: the message is about the NEW password, so the caret
    // goes there — not to Confirm, as "the two boxes differ" sent it.
    await page.locator('#pwCurrent').fill('miller');
    await page.locator('#pwNew').fill('short');
    await page.locator('#pwSaveBtn').click();
    await expect(page.locator('#pwFeedback')).toContainText('at least 8');
    await expect(page.locator('#pwNew')).toBeFocused();
    // A wrong current password: said, and the caret goes back to that box rather than to the page.
    await page.locator('#pwCurrent').fill('not-my-password');
    await page.locator('#pwNew').fill('a-real-password-9');
    await page.locator('#pwConfirm').fill('a-real-password-9');
    await page.locator('#pwSaveBtn').click();
    await expect(page.locator('#pwFeedback')).toContainText('Current password incorrect');
    await expect(page.locator('#pwCurrent')).toBeFocused();
    // The retry: the refusal goes the moment the next save starts — it is not left beside "Saving…".
    await page.evaluate(() => { const e = /** @type {any} */ (window).__E2E; e.reauthFailCode = ''; e.hangPasswordWrite = true; });
    await page.locator('#pwCurrent').fill('miller');
    await page.locator('#pwSaveBtn').click();
    await expect(page.locator('#pwSaveBtn')).toHaveText('Saving…');
    await expect(page.locator('#pwFeedback')).toHaveText('');
    await page.evaluate(() => /** @type {any} */ (window).__E2E_releasePasswordWrite(true));
    await expect(page.locator('#pwFeedback')).toContainText('Password updated');
});

// A REFUSAL DOES NOT PULL THE CARET BACK FROM WHERE THE MEMBER HAS GONE (review, 11 Nov 2026). A save can
// wait out the re-authentication deadline; a member who moved on meanwhile — another card, the drawer —
// had focus yanked back to the password card when the refusal landed.
test('settings: a refusal that lands after the member has moved on leaves their caret where they put it', async ({ page }) => {
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { .../** @type {any} */ (window).__E2E,
        authUser: true, authUserEmail: 'g.miller@myb-roster.local', reauthFailCode: 'auth/invalid-credential', reauthDelayMs: 1500 }; });
    await openSettings(page, { configured: false, noPush: true });
    await page.locator('#pwCurrent').fill('not-my-password');
    await page.locator('#pwNew').fill('a-real-password-9');
    await page.locator('#pwConfirm').fill('a-real-password-9');
    await page.locator('#pwSaveBtn').click();
    await expect(page.locator('#pwSaveBtn')).toHaveText('Saving…');
    await page.locator('#navMenuBtn').focus();                          // the member reaches for the menu while it is out
    await expect(page.locator('#navMenuBtn')).toBeFocused();            // premise: the caret did move
    await expect(page.locator('#pwFeedback')).toContainText('Current password incorrect');
    await expect(page.locator('#navMenuBtn')).toBeFocused();
});

// THE STAGE A FAILURE CAME FROM (sign-in check, 11 Nov 2026). Both surfaces read one ladder, and it asks
// whether the current password had already been accepted: a write refused after that is never "Current
// password incorrect", which sent members to an admin reset over a server blip.
test('settings: a change refused AFTER the current password was accepted is not blamed on it', async ({ page }) => {
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { .../** @type {any} */ (window).__E2E,
        authUser: true, authUserEmail: 'g.miller@myb-roster.local', updateFailCode: 'auth/internal-error' }; });
    await openSettings(page, { configured: false, noPush: true });
    await page.locator('#pwCurrent').fill('miller');
    await page.locator('#pwNew').fill('a-real-password-9');
    await page.locator('#pwConfirm').fill('a-real-password-9');
    await page.locator('#pwSaveBtn').click();
    await expect(page.locator('#pwFeedback')).toHaveText('Your password wasn’t updated — try again shortly.');
});

// ── A PASSWORD SAVE ON ITS WAY HOLDS THE PAGE (settings review, Nov 2026) ───────────────────────────────
// The save has two stages: the re-authentication, which writes nothing (`_passwordSaving` holds it), then
// the change, which `writesInFlight` must count. Settings never counted the change, and signing out
// mid-save asked nothing at all. Replaces a regex over `const _busy = …`, which passed throughout.
/** What the page answers the worker's "busy?" when a notification is tapped (sw-register.js →
 *  answerNotificationTaps) — the page's own busy check, as the update reload also reads it.
 *  @param {import('@playwright/test').Page} page */
const tapIsHeld = (page) => page.evaluate(() => new Promise(resolve => {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => resolve(e.data?.busy);
    navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'myb-busy?' }, ports: [ch.port2] }));
}));
/** Fill the open password form with a valid change and press Set password. @param {import('@playwright/test').Page} page */
async function startPasswordSave(page) {
    await page.locator('#pwCurrent').fill('miller');
    await page.locator('#pwNew').fill('a-real-password-9');
    await page.locator('#pwConfirm').fill('a-real-password-9');
    await page.locator('#pwSaveBtn').click();
    await expect(page.locator('#pwSaveBtn')).toHaveText('Saving…');
}

test('settings: while a password CHANGE is on its way, a tap waits and signing out asks — the change is counted', async ({ page }) => {
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { .../** @type {any} */ (window).__E2E,
        authUser: true, authUserEmail: 'g.miller@myb-roster.local', hangPasswordWrite: true }; });
    await openSettings(page, { configured: false, noPush: true });
    expect(await tapIsHeld(page), 'premise: nothing on its way, nothing held').toBe(false);
    await startPasswordSave(page);
    await expect.poll(() => page.evaluate(() => typeof /** @type {any} */ (window).__E2E_releasePasswordWrite),
        { message: 'premise: the change was sent' }).toBe('function');
    expect(await tapIsHeld(page), 'a notification tap would take the page away mid-change').toBe(true);

    await page.locator('#navMenuBtn').click();
    await page.locator('#navSignOutBtn').click();
    // "A change is still saving" is the `writesInFlight` question: without the change counted, it was
    // "unsaved changes" at best, and nothing at all before this page passed a `beforeSignOut`.
    const dialog = page.getByRole('alertdialog', { name: 'Sign out now?' });
    await expect(dialog).toContainText('A change is still saving');
    await expect(dialog, 'a password on its way is not "unsaved changes"').not.toContainText('unsaved');
    await dialog.getByRole('button', { name: 'Stay signed in' }).click();
    expect(await page.evaluate(() => localStorage.getItem('myb_admin_session')), 'a declined sign-out keeps the session').not.toBeNull();

    await page.evaluate(() => /** @type {any} */ (window).__E2E_releasePasswordWrite(true));
    await expect(page.locator('#pwFeedback')).toContainText('Password updated');
    await expect.poll(() => tapIsHeld(page), { message: 'still held once the change had landed' }).toBe(false);
});

test('settings: while the current password is being checked, before anything is written, the page is held too', async ({ page }) => {
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { .../** @type {any} */ (window).__E2E,
        authUser: true, authUserEmail: 'g.miller@myb-roster.local', reauthDelayMs: 4000 }; });
    await openSettings(page, { configured: false, noPush: true });
    await startPasswordSave(page);
    expect(await tapIsHeld(page), 'between Set password and the change, a tap or an update could take the page away').toBe(true);
    await page.locator('#navMenuBtn').click();
    await page.locator('#navSignOutBtn').click();
    await expect(page.getByRole('alertdialog', { name: 'Sign out without saving?' })).toBeVisible();
});

test('forced password overlay: a change refused after sign-in says it was not updated, not that a password was wrong', async ({ page }) => {
    await forcePasswordSet(page);
    // The member's OWN account (authUserEmail): since v25.98 a password call on any other account is refused before
    // it is sent (own-password.js), so without it this would test that refusal instead of the update failing.
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { .../** @type {any} */ (window).__E2E,
        authUser: true, authUserEmail: 'g.miller@myb-roster.local', updateFailCode: 'auth/internal-error' }; });
    await page.goto('/settings.html');
    await signInThroughOverlay(page, 'G. Miller');
    await expect(page.locator('#pwForceOverlay')).toBeVisible();
    await page.locator('#pwfNew').fill('a-real-password-9');
    await page.locator('#pwfConfirm').fill('a-real-password-9');
    await page.locator('#pwfSave').click();
    await expect(page.locator('#pwfError')).toHaveText('Your password wasn’t updated — try again shortly.');
});

test('forced password overlay: the new password\'s Next key moves to Confirm — it does not save (sign-in check, 11 Nov 2026)', async ({ page }) => {
    // The keyboard labels it "next", and it saved — then called two passwords that had not both been
    // typed a mismatch. It now does what Settings' card does.
    await forcePasswordSet(page);
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { .../** @type {any} */ (window).__E2E, authUser: true }; });
    await page.goto('/settings.html');
    await signInThroughOverlay(page, 'G. Miller');
    await expect(page.locator('#pwForceOverlay')).toBeVisible();
    await page.locator('#pwfNew').fill('a-real-password-9');
    await page.locator('#pwfNew').press('Enter');
    await expect(page.locator('#pwfConfirm')).toBeFocused();
    await expect(page.locator('#pwfError')).toBeHidden();
});

test('forced password overlay: a real form under the member\'s name — a submit never closes it, and Tab stays inside', async ({ page }) => {
    await forcePasswordSet(page);
    await page.goto('/settings.html');
    await signInThroughOverlay(page, 'G. Miller');
    const overlay = page.locator('#pwForceOverlay');
    await expect(overlay).toBeVisible();
    const shape = await page.evaluate(() => {
        const user = /** @type {HTMLInputElement} */ (document.getElementById('pwfUsername'));
        const same = ['pwfNew', 'pwfConfirm', 'pwfCurrent'].every(id => /** @type {HTMLInputElement} */ (document.getElementById(id)).form === user.form);
        const escape = /** @type {HTMLButtonElement} */ (document.getElementById('pwfEscape'));
        return { form: user.form?.id, value: user.value, same, escapeOutside: escape.form === null };
    });
    expect(shape).toEqual({ form: 'pwfForm', value: 'G. Miller', same: true, escapeOutside: true });

    // A submit from ANY source is cancelled, and the mandatory overlay stays up.
    await recordSubmits(page);
    await page.evaluate(() => /** @type {HTMLFormElement} */ (document.getElementById('pwfForm')).requestSubmit());
    expect(await submits(page)).toEqual([true]);
    await expect(overlay).toBeVisible();

    // The keyboard's Go runs the save; a write the server refuses is never handed to the password manager.
    await page.locator('#pwfNew').fill('a-real-password-9');
    await page.locator('#pwfConfirm').fill('a-real-password-9');
    await page.locator('#pwfConfirm').press('Enter');
    await expect(page.locator('#pwfError')).toBeVisible();          // the stub refuses the write — the save ran
    expect(await submits(page), 'a refused write was submitted to the password manager').toEqual([true]);
    await expect(overlay).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/settings.html');

    // The hidden username field is not a Tab stop: Shift+Tab from the first field wraps inside the
    // overlay instead of leaving it for the page behind a mandatory dialog.
    await page.locator('#pwfNew').focus();
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('#pwForceOverlay')), 'focus left the overlay').toBe(true);
    await expect(page.locator('#pwfUsername')).not.toBeFocused();
});

test('forced password overlay: a CONFIRMED save is submitted once, and only then does the overlay close', async ({ page }) => {
    await forcePasswordSet(page);
    // A signed-in Firebase user on the member's own account, so the write can SUCCEED under the stub
    // (window.__E2E.authUser / authUserEmail — own-password.js refuses any other account).
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { .../** @type {any} */ (window).__E2E,
        authUser: true, authUserEmail: 'g.miller@myb-roster.local' }; });
    await page.goto('/settings.html');
    await signInThroughOverlay(page, 'G. Miller');
    const overlay = page.locator('#pwForceOverlay');
    await expect(overlay).toBeVisible();
    await recordSubmits(page);
    await page.locator('#pwfNew').fill('a-real-password-9');
    await page.locator('#pwfConfirm').fill('a-real-password-9');
    await page.locator('#pwfConfirm').press('Enter');
    await expect(overlay).toBeHidden();
    expect(await submits(page), 'one submit, once the write was confirmed, and it was cancelled').toEqual([true]);
    expect(new URL(page.url()).pathname, 'the form never goes anywhere').toBe('/settings.html');
});

// ── THE ENTER THAT ACCEPTS AN INPUT METHOD'S SUGGESTION IS LEFT TO IT (sign-in audit E4, 13 Nov 2026) ───────────
// Somebody typing through an input method — a predictive keyboard, a Japanese or Chinese one — presses Enter to accept
// what it offers, and the browser marks that keydown `isComposing`. The password form moved on, or SAVED, on it, and
// the work email saved half-typed text. The forced overlay has left it alone since 11 Nov 2026 (password-force.js).
// Sent as the browser sends it, since no keyboard Playwright drives composes: whether the page TOOK the key is
// whether it cancelled it, and a plain Enter afterwards proves the guard is the only difference.
test('settings: the Enter that accepts an input method\'s suggestion neither moves on nor saves', async ({ page }) => {
    await openSettings(page, { configured: false, noPush: true });     // un-migrated: the password form is open
    const composingEnter = (/** @type {string} */ sel) => page.locator(sel).evaluate(el =>
        !el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
    await page.locator('#pwCurrent').fill('miller');
    await page.locator('#pwCurrent').focus();
    expect(await composingEnter('#pwCurrent'), 'Current took a composition\'s Enter').toBe(false);
    await expect(page.locator('#pwCurrent')).toBeFocused();
    await page.locator('#pwNew').fill('a-real-password-9');
    await page.locator('#pwConfirm').fill('a-real-password-9');
    expect(await composingEnter('#pwConfirm'), 'Confirm saved on a composition\'s Enter').toBe(false);
    await expect(page.locator('#pwFeedback')).toBeEmpty();
    await page.locator('#pwCurrent').press('Enter');                    // a plain Enter still moves on
    await expect(page.locator('#pwNew')).toBeFocused();

    await expect(page.locator('#contactFeedback'), 'premise: the saved-email check has answered').not.toContainText('Checking');
    await expect(page.locator('#workEmailInput'), 'premise: with no email saved, the card opens itself').toBeVisible();
    await page.locator('#workEmailInput').fill('g.mil');
    expect(await composingEnter('#workEmailInput'), 'the email took a composition\'s Enter').toBe(false);
    await expect(page.locator('#workEmailSaveBtn')).toHaveText('Save email');
    await expect(page.locator('#contactFeedback')).toBeEmpty();
    await page.locator('#workEmailInput').press('Enter');               // a plain Enter still saves
    await expect(page.locator('#contactFeedback')).toContainText('Saved');
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
    // "Saved in this browser only" is a warning about nothing until it says how much.
    await openSettings(page, { configured: true, payKeys: 3, noPush: true });
    await expect(page.locator('#payDataStatusChip')).toHaveText('3 payslips');
    await expect(page.locator('#payDataInventory')).toContainText('3 payslips');
    await expect(page.locator('#payDataInventory')).toHaveText('3 payslips — saved in this browser on this device');
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
    await expect(page.locator('#payDataInventory')).toHaveText('No pay calculator history saved in this browser yet');
    await expect(page.locator('#payDataStatusChip')).toHaveText('None saved');
});

// FIGURES WITH NO PAYSLIP ARE STILL FIGURES (settings review, Nov 2026). The card counted payslips and
// tax years only: pension history on its own read "None saved", and on an iPhone the Install card hid
// the step that carries the figures across — from the member who had figures to lose.
test('settings: pension history alone is saved figures — the card says so, and an iPhone is told to copy it first', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('myb_pc_gmiller_pension_timeline', '[]'));
    await openSettings(page, { configured: true, iphone: true });
    await expect(page.locator('#payDataStatusChip')).toHaveText('Saved');
    await expect(page.locator('#payDataInventory')).toHaveText('Pension — saved in this browser on this device');
    await expect(page.locator('#installStepPay')).toBeVisible();
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
    // An OFFER, so a neutral chip on a shut card — the same header as its siblings (settings review, Nov 2026).
    await expect(page.locator('#deviceStatusChip')).toHaveText('Not installed');
    await expect(page.locator('#deviceStatusChip')).toHaveAttribute('data-tone', 'n/a');
    expect(await cardOpen(page, 'deviceBody'), 'an offer does not open itself').toBe(false);
    await page.locator('#deviceChevron').click();
    await expect(page.locator('#installNoteIos'), 'the iPhone line is for an iPhone').toBeHidden();
    await page.locator('#installBtn').click();
    expect(await page.evaluate(() => window.__promptFired)).toBe(true);
    await expect(page.locator('#deviceCard')).toBeHidden();
});

// ── THE LOOK PASS (settings review, Nov 2026) ─────────────────────────────────────────────────────

// Change password opened a door with no way back but a reload.
test('settings: Cancel puts the settled password state back, and takes what was typed with it', async ({ page }) => {
    await openSettings(page, { configured: true, noPush: true });
    await page.locator('#passwordChevron').click();
    await expect(page.locator('#pwCancelBtn'), 'nothing to cancel until Change password is pressed').toBeHidden();
    await page.locator('#pwChangeBtn').click();
    await expect(page.locator('#pwCancelBtn')).toBeVisible();
    await page.locator('#pwCurrent').fill('miller');
    await page.locator('#pwShowAll').check();
    await page.locator('#pwCancelBtn').click();
    await expect(page.locator('#pwForm')).toBeHidden();
    await expect(page.locator('#pwSettled')).toBeVisible();
    await expect(page.locator('#pwChangeBtn')).toBeFocused();
    await page.locator('#pwChangeBtn').click();
    await expect(page.locator('#pwCurrent'), 'what was typed went with the Cancel').toHaveValue('');
    await expect(page.locator('#pwCurrent'), 'and it is masked again').toHaveAttribute('type', 'password');
});

test('settings: a member on the surname default has nothing to cancel back to', async ({ page }) => {
    await openSettings(page, { configured: false, noPush: true });
    await expect(page.locator('#pwForm')).toBeVisible();
    await expect(page.locator('#pwCancelBtn')).toBeHidden();
});

// The joined email field is focused as ONE control beside the domain, and the domain is plain text when stacked.
test('settings: the work email and its domain are focused as one field, and stacked the domain is text', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a keyboard focus ring');
    await openSettings(page, { configured: true, noPush: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('#contactChevron').click();
    await page.locator('#workEmailSaveBtn').focus();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#workEmailInput')).toBeFocused();
    const joined = await page.evaluate(() => {
        const cs = (/** @type {string} */ id) => getComputedStyle(/** @type {HTMLElement} */ (document.getElementById(id)));
        const row = getComputedStyle(/** @type {HTMLElement} */ (document.querySelector('.contact-email-row')));
        return { rowOutline: row.outlineStyle, inputOutline: cs('workEmailInput').outlineStyle,
            inputEdge: cs('workEmailInput').borderTopColor, domainEdge: cs('workEmailDomain').borderTopColor,
            domainRing: cs('workEmailDomain').boxShadow !== 'none', domainFill: cs('workEmailDomain').backgroundColor };
    });
    expect(joined.rowOutline, 'the outline goes round the row').toBe('solid');
    expect(joined.inputOutline, 'not round the input alone').toBe('none');
    expect(joined.domainEdge, 'the domain\'s edge takes the focus colour with the input\'s').toBe(joined.inputEdge);
    expect(joined.domainRing, 'the ring carries on round the domain').toBe(true);
    await page.setViewportSize({ width: 360, height: 800 });
    const stacked = await page.locator('#workEmailDomain').evaluate(el => {
        const cs = getComputedStyle(el);
        return { border: cs.borderTopStyle, fill: cs.backgroundColor };
    });
    expect(stacked, 'stacked under the field, the domain is the rest of the address, not a second box').toEqual({ border: 'none', fill: 'rgba(0, 0, 0, 0)' });
});

test('settings: a settled card ends where its siblings do — no empty line reserved at its foot', async ({ page }) => {
    await openSettings(page, { configured: true, noPush: true });
    await page.locator('#passwordChevron').click();
    await expect(page.locator('#pwSettled')).toBeVisible();
    expect(await page.locator('#pwFeedback').evaluate(el => el.getBoundingClientRect().height)).toBe(0);
});

test('settings: under a thumb each to-do in the summary is a 44px target', async ({ page }, info) => {
    test.skip(!isTouchProject(info), 'a coarse pointer');
    await openSettings(page, { configured: false, noPush: true });
    const heights = await page.locator('#settingsSummaryItems a').evaluateAll(as => as.map(a => Math.round(a.getBoundingClientRect().height)));
    expect(heights.length).toBe(2);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
});

test('settings: on a desktop the cards are 16px apart, as on Admin and Operations', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a desktop layout');
    await openSettings(page, { configured: true, noPush: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    const gap = await page.evaluate(() => {
        const a = /** @type {HTMLElement} */ (document.getElementById('contactCard')).getBoundingClientRect();
        const b = /** @type {HTMLElement} */ (document.getElementById('passwordCard')).getBoundingClientRect();
        return Math.round(b.top - a.bottom);
    });
    expect(gap).toBe(16);
});

// THE WORK EMAIL, START TO FINISH (settings review, Nov 2026): no test saved an address and then removed it,
// so the one write and the one delete this card makes were each reached only by their failure paths.
test('settings: a work email saved and then removed — what is written, what the card says, and what the summary counts', async ({ page }) => {
    await openSettings(page, { configured: false, noPush: true });
    await expect(page.locator('#contactStatusChip')).toHaveText('Not saved');
    await page.locator('#workEmailInput').fill('g.miller');
    await page.locator('#workEmailSaveBtn').click();
    const today = await page.evaluate(() => import('/date-format.js').then(m => m.formatDayMonthYear(new Date())));
    await expect(page.locator('#contactFeedback')).toHaveText(`✓ Saved — last updated ${today}`);
    await expect(page.locator('#contactStatusChip')).toHaveText('✓ Saved');
    await expect(page.locator('#contactHint'), 'the collapsed card names the address').toHaveText('g.miller@chilternrailways.co.uk');
    await expect(page.locator('#settingsSummaryItems')).not.toContainText('work email');
    const written = await page.evaluate(() => (/** @type {any} */ (window).__E2E.setWrites || []).filter((/** @type {any} */ w) => /staffContact/.test(w.path)));
    expect(written.map((/** @type {any} */ w) => [w.path, w.data.memberName, w.data.workEmail]),
        'the whole address, on this member\'s own record').toEqual([['staffContact/G. Miller', 'G. Miller', 'g.miller@chilternrailways.co.uk']]);

    await page.locator('#workEmailRemoveBtn').click();
    const dialog = page.getByRole('alertdialog', { name: 'Remove your work email?' });
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.locator('#contactStatusChip')).toHaveText('Not saved');
    await expect(page.locator('#workEmailRemoveBtn')).toBeHidden();
    await expect(page.locator('#contactFeedback')).toHaveText('');
    await expect(page.locator('#workEmailInput')).toHaveValue('');
    await expect(page.locator('#settingsSummaryItems')).toContainText('Save your work email');
    expect(await page.evaluate(() => /** @type {any} */ (window).__E2E.deletedPaths), 'the record itself was deleted').toContain('staffContact/G. Miller');
});

// A token minted before the member's `name` claim is refused until it refreshes. Operations' reads of
// these collections refresh it once and retry (withClaimRetry); Settings' did not, and both cards read
// "Couldn't check" for a member whose email and password were both in order (settings review, Nov 2026).
test('settings: a stale token refused on each account read is refreshed once, and both cards still answer', async ({ page }) => {
    await page.addInitScript(() => {
        const e = /** @type {any} */ (window).__E2E = { .../** @type {any} */ (window).__E2E, authUser: true, authUserEmail: 'g.miller@myb-roster.local' };
        const data = { workEmail: 'g.miller@chilternrailways.co.uk', passwordSetAt: { toMillis: () => Date.parse('2026-08-01') } };
        let reads = 0;   // the first read of EACH document is refused, as a stale token's is
        Object.defineProperty(e, 'getDocData', { configurable: true, get() {
            if (++reads <= 2) throw Object.assign(new Error('e2e: stale token'), { code: 'permission-denied' });
            return data;
        } });
    });
    await openSettings(page, { noPush: true });
    await expect(page.locator('#contactStatusChip')).toHaveText('✓ Saved');
    await expect(page.locator('#passwordStatusChip')).toHaveText('✓ Password set');
    await expect(page.locator('#settingsSummaryLine')).toHaveText('✓ You’re all set');
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
    // …and the summary strip above it has its final size, so the ? is not moved under the press (the
    // race behind the contrast test's one failure, below).
    await expect(page.locator('#settingsSummary')).toHaveAttribute('data-tone', /^(todo|all-set|error)$/);

    await page.locator('.btn-card-tips[data-card="work-email"]').click();

    // The Tips lightbox must open with the right content …
    await expect(page.locator('#tipsLightbox')).toBeVisible();
    await expect(page.locator('#tipsLbTitle')).toHaveText('Work Email');
    // … and the "?" click MUST NOT have toggled the card (the reported bug symptom:
    // clicking "?" fell through to the header and collapsed the card). It stays open.
    await expect(page.locator('#contactBody')).toHaveClass(/\bopen\b/);

    expect(errors, 'Uncaught JS exceptions on signed-in settings.html').toHaveLength(0);
});

// ── WIRED BEFORE THE SIGN-IN DECISION (Nov 2026 review) ─────────────────────────────────────────
// The service worker, the error reporter, the forced password overlay and the ? panels were wired
// AFTER initAuthorised(), which has no try/catch on the signed-in path — so one card whose wiring threw
// took all four with it, including the reporter that would have told the admin. A card's wiring is
// made to throw here (a source patch, LOUD if its anchor moves), and each of the four must still run.
test('settings (signed in): a card whose wiring throws takes nothing else down with it', async ({ page }) => {
    await forcePasswordSet(page);
    await page.route('**/settings-app.js', async route => {
        const res = await route.fetch();
        const anchor = '    function initApp() {\n';
        const src = await res.text();
        if (!src.includes(anchor)) throw new Error('settings-app.js: the initApp() anchor moved — update this test');
        await route.fulfill({ response: res, contentType: 'text/javascript',
            body: src.replace(anchor, `${anchor}        throw new Error('e2e: a card’s wiring threw');\n`) });
    });
    await page.addInitScript(() => {
        // A fresh sign-in (its one-shot marker) by a member still on the surname default, with a named
        // Firebase identity — the three things the forced overlay asks for (password-force.js).
        localStorage.setItem('myb_pw_force_pending_G. Miller', '1');
        /** @type {any} */ (window).__E2E = { .../** @type {any} */ (window).__E2E, authUser: true, authUserEmail: 'g.miller@myb-roster.local' };
        const sw = navigator.serviceWorker;
        if (!sw) return;
        const ask = sw.getRegistration.bind(sw);
        sw.getRegistration = (...a) => { /** @type {any} */ (window).__swAsked = true; return ask(...a); };
    });
    const thrown = [];
    page.on('pageerror', e => thrown.push(e.message));
    await seedSession(page, 'G. Miller');
    await page.goto('/settings.html');
    await expect.poll(() => thrown.some(m => m.includes('a card’s wiring threw')), { message: 'premise: the wiring threw' }).toBe(true);

    await expect(page.locator('#pwForceOverlay'), 'the forced password overlay still compels').toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (window).__swAsked === true), 'the service worker is still registered').toBe(true);
    // The reporter is listening: a later failure reaches the Error Log.
    await page.evaluate(() => { Promise.reject(new Error('e2e: a later failure')); });
    await expect.poll(() => page.evaluate(() => (/** @type {any} */ (window).__E2E.setWrites || [])
        .some((/** @type {any} */ w) => /clientErrors/.test(w.path) && w.data?.message === 'e2e: a later failure')),
    { message: 'the error reporter is still running' }).toBe(true);
    // And the ? panels open (behind the mandatory overlay, so through the button's own handler).
    await page.locator('.btn-card-tips[data-card="work-email"]').dispatchEvent('click');
    await expect(page.locator('#tipsLbTitle')).toHaveText('Work Email');
});

// ONE CARD'S THROW COSTS THAT CARD ALONE (settings review, Nov 2026). The cards were wired in one run, so the
// Work Email card throwing stopped Password, Notifications, Pay data and Install from being wired at all, and
// the summary — waiting for all of them — said "Checking…" for the life of the page.
test('settings (signed in): a card that throws while it is set up says so, and every card after it still works', async ({ page }) => {
    await page.route('**/settings-app.js', async route => {
        const res = await route.fetch();
        const anchor = '    function initContactCard() {\n';
        const src = await res.text();
        if (!src.includes(anchor)) throw new Error('settings-app.js: the initContactCard() anchor moved — update this test');
        await route.fulfill({ response: res, contentType: 'text/javascript',
            body: src.replace(anchor, `${anchor}        throw new Error('e2e: the Work Email card threw');\n`) });
    });
    await openSettings(page, { configured: true, payKeys: 2, noPush: true });
    await expect(page.locator('#contactStatusChip')).toHaveText('Couldn’t check');
    await expect(page.locator('#passwordStatusChip'), 'the card after it was never wired').toHaveText('✓ Password set');
    await expect(page.locator('#payDataStatusChip')).toHaveText('2 payslips');
    await expect(page.locator('#settingsSummary')).toHaveAttribute('data-tone', 'error');
});

// THE TIPS ✕ IS READ AS TEXT (whole-app review, Nov 2026). It is the panel's only visible way out, and it was
// black at 35% on white — 2.43:1, under the 3:1 a control's own glyph needs as well as the text floor — with
// only a mouse's hover ever lifting it. Shared by the six pages with a Tips panel; measured as painted: the
// ✕'s colour laid over the panel's own, on a canvas, so a translucent colour is judged by what it shows.
test('settings: the Tips panel\'s ✕ clears the text contrast floor on its panel', async ({ page }) => {
    await seedSession(page);
    await page.goto('/settings.html');
    // Wait for the summary strip ABOVE the Work Email card to settle (failed once in 472 runs, Nov 2026:
    // the click landed and the panel never opened). The strip reads "Checking your settings…" with no
    // list until the LAST card has reported, then grows by one line per to-do in one go — which moves
    // this ? button down at about the moment a click straight after load is aimed at it, so the press
    // could land on the card header instead. `data-tone` leaving 'checking' is that last answer.
    await expect(page.locator('#settingsSummary')).toHaveAttribute('data-tone', /^(todo|all-set|error)$/);
    await page.locator('.btn-card-tips[data-card="work-email"]').click();
    await expect(page.locator('#tipsLightbox')).toBeVisible();
    const ratio = await page.evaluate(() => {
        const ctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d', { willReadFrequently: true }));
        /** @param {string[]} layers */
        const paint = (...layers) => {
            ctx.clearRect(0, 0, 1, 1);
            for (const c of layers) { ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); }
            return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        /** @param {number[]} rgb */
        const lum = (rgb) => {
            const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const panel = getComputedStyle(/** @type {HTMLElement} */ (document.getElementById('tipsLightboxContent'))).backgroundColor;
        const glyph = getComputedStyle(/** @type {HTMLElement} */ (document.getElementById('tipsLightboxClose'))).color;
        const [hi, lo] = [lum(paint(panel, glyph)), lum(paint(panel))].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
    });
    expect(ratio, `the ✕ is ${ratio.toFixed(2)}:1 on its panel`).toBeGreaterThanOrEqual(4.5);
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

// A LATE FIRST READ CANNOT UNDO A CHANGE (settings review, Nov 2026). The page's first passwordStatus
// read can be the slow one, and the read after a successful change is answered at once. Painted as they
// landed, the first — arriving last, and still saying "surname" — took "✓ Password set" away again.
for (const [label, late] of /** @type {const} */ ([['a stale answer', 'surname'], ['a failed read', 'fail']])) {
    test(`settings: ${label} from the page's first status read, landing after a password change, does not undo it`, async ({ page }) => {
        await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { .../** @type {any} */ (window).__E2E,
            authUser: true, authUserEmail: 'g.miller@myb-roster.local', getDocHold: true }; });
        await page.setViewportSize({ width: 390, height: 844 });
        await seedMemberSession(page, 'G. Miller');
        await page.goto('/settings.html');
        // The first reads are out and held; every read after this one is answered at once.
        await expect.poll(() => page.evaluate(() => typeof /** @type {any} */ (window).__E2E.releaseGetDoc)).toBe('function');
        await page.evaluate(() => { /** @type {any} */ (window).__E2E.getDocHold = false; });
        await page.locator('#passwordChevron').click();   // nothing has reported yet, so the card is still shut
        await page.locator('#pwCurrent').fill('miller');
        await page.locator('#pwNew').fill('a-real-password-9');
        await page.locator('#pwConfirm').fill('a-real-password-9');
        await page.locator('#pwSaveBtn').click();
        await expect(page.locator('#pwFeedback')).toContainText('Password updated');
        await expect(page.locator('#passwordStatusChip')).toHaveText('✓ Password set');

        // …and now the first read lands, saying what was true before the change, or failing.
        await page.evaluate((late) => {
            const e = /** @type {any} */ (window).__E2E;
            // The held answer is built on release, so a getter that throws there fails exactly that read.
            if (late === 'fail') Object.defineProperty(e, 'getDocData', { get() { throw new Error('e2e: the first read failed'); } });
            e.releaseGetDoc();
        }, late);
        await expect(page.locator('#settingsSummary')).not.toHaveAttribute('data-tone', 'checking');
        await expect(page.locator('#passwordStatusChip')).toHaveText('✓ Password set');
        await expect(page.locator('#passwordNudge')).toBeHidden();
        await expect(page.locator('#settingsSummaryItems')).not.toContainText('password');
    });
}

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

// The card is for the members the Pay page admits (review, 24 Nov 2026): an Other Staff login was shown it, and its
// "Move your pay data" link, beside a drawer with no Pay pill and a page that refuses them. It asks the page's own
// rule (pay-audience.js over `payslipsShownTo`), so a Dispatcher, whom the page also refuses, loses it too. The
// people are INVENTED or chosen by shape, never named.
const DISPATCHER = teamMembers.find(m => m.role === 'Dispatcher' && !m.roleHistory && !m.hidden)?.name;
for (const { who, arrange } of [
    { who: 'an Other Staff login', arrange: (/** @type {any} */ page) => withOtherStaff(page, 'Q. Example').then(() => seedSession(page, 'Q. Example')) },
    { who: 'an Other Staff login moved there from CEA', arrange: (/** @type {any} */ page) =>
        withOtherStaff(page, 'Q. Example', "roleHistory: [{ role: 'CEA', until: new Date(2026, 9, 1) }]").then(() => seedSession(page, 'Q. Example')) },
    { who: 'a Dispatcher', arrange: (/** @type {any} */ page) => seedSession(page, DISPATCHER) },
]) {
    test(`settings: ${who} is not shown the Pay Calculator Data card`, async ({ page }) => {
        expect(DISPATCHER, 'premise: a Dispatcher with no earlier grade is on the roster').toBeTruthy();
        const errors = collectFatalErrors(page);
        await arrange(page);
        await page.goto('/settings.html');
        await expect(page.locator('#navMenuBtn')).toBeVisible();
        await expect(page.locator('#settingsSummary'), 'the page reported every card').not.toHaveAttribute('data-tone', 'checking');
        await expect(page.locator('#payDataCard')).toBeHidden();
        await expect(page.locator('#payDataLabel'), 'nor its section label, over nothing').toBeHidden();
        await expect(page.locator('#installStepPay')).toBeHidden();
        expect(errors).toEqual([]);
    });
}

// ── THE DESKTOP AUDIT (7 Nov 2026) ──────────────────────────────────────────────────────────────

// SET3 — the to-do strip ran the page's width with three short lines stacked at its left, and the
// items named a thing to finish without leading to it. On a desktop they run along the strip now, and
// each is a link to the card that fixes it, opening that card on the way even after it was shut.
test('settings: on a desktop the to-dos run along the strip, and each one opens its card', async ({ page }) => {
    await openSettings(page, { configured: false, noPush: true });   // two to-dos: password, work email
    await page.setViewportSize({ width: 1366, height: 768 });
    const items = page.locator('#settingsSummaryItems a');
    await expect(items).toHaveText(['Set your own password', 'Save your work email']);
    // The WORDS' tops, not the boxes': under a thumb each link is a 44px target round its line of text.
    const tops = await page.locator('#settingsSummaryLine, #settingsSummaryItems a').evaluateAll(els => els.map(el => {
        const r = document.createRange(); r.selectNodeContents(el); return Math.round(r.getBoundingClientRect().top);
    }));
    expect(tops.length, 'premise: the line and its two to-dos').toBe(3);
    expect(Math.max(...tops) - Math.min(...tops), 'the count and its to-dos share one row').toBeLessThanOrEqual(6);

    await page.locator('#contactChevron').click();   // the card opened itself; the member shuts it
    expect(await cardOpen(page, 'contactBody')).toBe(false);
    await items.nth(1).click();
    await expect.poll(() => cardOpen(page, 'contactBody'), { message: 'the link opens the card it names' }).toBe(true);
    await expect(page).toHaveURL(/#contactCard$/);
    await expect(page.locator('#contactCard')).toBeInViewport();
});

// SET1 — the Work Email explainer ran ~103 characters a line across the main column: the card's own
// hint was capped at 68ch and its opening paragraph was not.
test('settings: on a desktop the Work Email explainer keeps a reading measure', async ({ page }) => {
    await openSettings(page, { configured: false, noPush: true });   // the email card opens itself
    await page.setViewportSize({ width: 1366, height: 768 });
    const m = await page.locator('#contactBody .card-explainer').evaluate(el => {
        const probe = document.createElement('span');
        probe.style.whiteSpace = 'nowrap';
        probe.textContent = '0'.repeat(68);
        el.appendChild(probe);
        const cap = probe.getBoundingClientRect().width;
        probe.remove();
        return { width: el.getBoundingClientRect().width, cap, room: /** @type {HTMLElement} */ (el.parentElement).clientWidth };
    });
    expect(m.room - m.cap, 'the column is wider than the measure, so the cap is what holds the line').toBeGreaterThan(40);
    expect(m.width).toBeLessThanOrEqual(m.cap + 1);
});

// The header shares the cards' column at EVERY width (whole-app review, Nov 2026). It was capped only from
// 768px, so between 581 and 767 — a phone on its side, a foldable, a narrow window — it spanned the window
// while the cards sat in a 560px column: at 700px the burger 60px left of them, the badge 60px right.
test('settings: the header spans the cards\' column at every width, a phone on its side included', async ({ page }) => {
    await seedSession(page);
    for (const width of [375, 600, 700, 767, 768, 1024, 1366]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto('/settings.html');
        await page.locator('.app .card').first().waitFor();
        const m = await page.evaluate(() => {
            const edges = (/** @type {string} */ sel) => {
                const r = /** @type {HTMLElement} */ (document.querySelector(sel)).getBoundingClientRect();
                return [Math.round(r.left), Math.round(r.right)];
            };
            return { header: edges('.app-header'), column: edges('.app') };
        });
        expect(m.header, `at ${width}px the header spans ${m.header}, the cards ${m.column}`).toEqual(m.column);
    }
});

// The page gutter has ONE home now, shared.css (whole-app review, Nov 2026): every card page restated it, and Settings
// no longer does. The card pages' values — 20px above, 10px below, 10px a side on a phone, 3vw from 769px — read off
// Settings, the page that relies on the shared rule, so losing that rule cannot pass unseen.
test('settings: the page keeps its gutter, from the shared rule', async ({ page }) => {
    await seedSession(page);
    for (const [width, side] of [[375, 10], [768, 10], [1280, 38.4]]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto('/settings.html');
        const gutter = await page.evaluate(() => {
            const s = getComputedStyle(document.body);
            return [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(parseFloat);
        });
        // As numbers, to the hundredth: WebKit writes 3vw at 1280px as "38.400002px", Chromium as "38.4px".
        ['top', 'right', 'bottom', 'left'].forEach((edge, i) =>
            expect(gutter[i], `the ${edge} gutter at ${width}px`).toBeCloseTo([20, side, 10, side][i], 2));
    }
});

// SET2 — "You'll get: …" was one run joined with " · ", so a line could end "· Pay" and the next start
// "reminder". Each kind and its separator is unbreakable now; a line breaks only after a "·".
test('settings: the notification kinds break between themselves, never inside one', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(window, 'Notification', { value: { permission: 'default' }, configurable: true });
    });
    await openSettings(page, { configured: true, forcePush: true });
    if (!(await cardOpen(page, 'notifBody'))) await page.locator('#notifChevron').click();
    for (const width of [1366, 390, 360]) {
        await page.setViewportSize({ width, height: 844 });
        const split = await page.locator('#notifBody .notif-kind').evaluateAll(
            els => els.filter(e => e.getClientRects().length > 1).map(e => e.textContent));
        expect(split, `kinds split across lines at ${width}px`).toEqual([]);
    }
});

// ── THE PAY REMINDER IS PROMISED ONLY WHERE IT IS SENT (whole-app check, 17 Nov 2026) ───────────────
// It goes to CEA and CES (functions/pay-reminder.js) and the card promised it to everybody: its subtitle,
// its list, and the line that says what turning on brings. Members are chosen by grade from the roster
// at run time — never named here.
/** A current member of a grade, by name. @param {string} role */
const aMemberOf = (role) => teamMembers.find(m => m.role === role && !m.hidden && !m.managerOnly)?.name;
/** Settings for `name`, on an Android phone where push exists and has not been asked about yet.
 *  @param {import('@playwright/test').Page} page @param {string} name @param {{ permission?: string, installed?: boolean }} [o] */
async function settingsWithPush(page, name, { permission = 'default', installed = false } = {}) {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedMemberSession(page, name);
    await page.addInitScript(({ permission, installed }) => {
        Object.defineProperty(navigator, 'userAgent', { configurable: true,
            value: 'Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' });
        if (!('PushManager' in window)) Object.defineProperty(window, 'PushManager', { value: function () {}, configurable: true });
        Object.defineProperty(window, 'Notification', { value: { permission, requestPermission: async () => permission }, configurable: true });
        if (installed) {
            // The home screen app: `display-mode: standalone`, which a browser tab never matches.
            const real = window.matchMedia.bind(window);
            window.matchMedia = (q) => (q.includes('display-mode: standalone')
                ? /** @type {any} */ ({ matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })
                : real(q));
        }
    }, { permission, installed });
    await page.goto('/settings.html');
    await expect(page.locator('#settingsSummary')).toBeVisible();
    if (!(await cardOpen(page, 'notifBody'))) await page.locator('#notifChevron').click();
}

for (const [grade, gets] of /** @type {const} */ ([['CEA', true], ['CES', true], ['Dispatcher', false]])) {
    test(`settings: a ${grade} member is ${gets ? 'promised' : 'not promised'} the pay reminder — subtitle, list and status line`, async ({ page }) => {
        const name = aMemberOf(grade);
        expect(name, `premise: the roster has a current ${grade} member`).toBeTruthy();
        await settingsWithPush(page, /** @type {string} */ (name));
        await expect(page.locator('#notifToggleHeader .hint')).toHaveText(
            gets ? 'Get alerts for staff updates and pay reminders' : 'Get alerts for staff updates', { useInnerText: true });
        await expect(page.locator('#notifKindPay')).toBeVisible({ visible: gets });
        // The status line points at the list, which is the member's own — so it never names the pay reminder.
        await expect(page.locator('#notifStatusMsg')).toHaveText('Select “Turn on notifications” to get the alerts listed above.');
    });
}

// THE INSTALLED APP HAS NO ADDRESS BAR (whole-app check, 17 Nov 2026). On Android the blocked route said "tap the padlock
// in Chrome" — and the home screen app has no address bar to tap. There the permission is the app's own, in the phone's
// settings, as an iPhone's is; a browser tab keeps the address bar's site icon — described, not named a padlock, since
// Chrome drew it as two sliders from 2023 (18 Nov 2026).
for (const [where, installed, says] of /** @type {const} */ ([
    ['the home screen app', true, 'On Android: open your phone’s Settings → Apps, find this app by its home screen name, and turn on Notifications.'],
    ['a browser tab', false, 'On Android: tap the icon at the left of the address bar (a padlock or two sliders) → Site settings → Notifications → Allow.'],
])) {
    test(`settings: blocked on Android, ${where} is told the route that exists there`, async ({ page }) => {
        await settingsWithPush(page, /** @type {string} */ (aMemberOf('CEA')), { permission: 'denied', installed });
        await expect(page.locator('#notifDeniedMsg')).toHaveText(says);
        await expect(page.locator('#notifStatusMsg')).toHaveText('Notifications are blocked on this device, so the button can’t turn them on. To allow them:');
    });
}

// ALLOWED IN THE PHONE'S SETTINGS, THEN BACK TO THE PAGE (22 Nov 2026). The card read once, at open, so a
// member who followed its own steps came back to "Blocked" until they reloaded. It re-reads when the page
// is visible again (and on a back/forward-cache restore, and a permission change — notif-card.test.mjs).
test('settings: notifications allowed outside the page are seen on coming back, without a reload', async ({ page }) => {
    await settingsWithPush(page, /** @type {string} */ (aMemberOf('CEA')), { permission: 'denied' });
    await expect(page.locator('#notifStatusChip')).toHaveText('Blocked');
    await expect(page.locator('#notifEnableBtn')).toBeHidden();
    await page.evaluate(() => {
        /** @type {any} */ (window.Notification).permission = 'default';     // allowed again in the phone's settings
        document.dispatchEvent(new Event('visibilitychange'));                // …and the member comes back
    });
    await expect(page.locator('#notifStatusChip')).toHaveText('Off');
    await expect(page.locator('#notifEnableBtn')).toBeVisible();
    await expect(page.locator('#notifDeniedMsg')).toBeHidden();
});

// A BLOCKED BELL SAYS SO WHEN TAPPED (whole-app check, 17 Nov 2026). It wore 🔕 — the same as "off" — and a tap did
// nothing: the browser will not ask again, and only a screen reader heard "blocked". It now says where it is fixed:
// on Settings, the card on the page under the drawer (18 Nov 2026 — it gave the menu route to the page the reader
// was already on); anywhere else, the menu route there.
test('settings: the drawer\'s bell, blocked, says where notifications are allowed again', async ({ page }) => {
    await settingsWithPush(page, /** @type {string} */ (aMemberOf('CEA')), { permission: 'denied' });
    await page.locator('#navMenuBtn').click();
    const bell = page.locator('#navNotifBell');
    await expect(bell).toHaveAttribute('data-notif-state', 'denied');
    await bell.click();
    const panel = page.locator('#navComingSoonLightbox');
    await expect(panel).toHaveClass(/\bopen\b/);
    await expect(page.locator('#navComingSoonTitle')).toHaveText('Notifications blocked');
    await expect(page.locator('#navComingSoonBody')).toContainText('the bell can’t switch them on. The Notifications card on this page says how to allow them.');
    await expect(page.locator('#navComingSoonBody')).not.toContainText('☰ → Settings');

    await page.goto('/');                                       // the same device, on the Calendar
    await page.locator('#navMenuBtn').click();
    await expect(bell).toHaveAttribute('data-notif-state', 'denied');
    await bell.click();
    await expect(page.locator('#navComingSoonBody')).toContainText('the bell can’t switch them on. ☰ → Settings → Notifications says how to allow them.');
});

// The blocked-notification route on a laptop (laptop polish, 13 Nov 2026): "Site settings → Notifications
// → Allow" broke after "Site settings", so the next line began "→ Notifications", which reads as a stray
// arrow. The route is one unit now (`.nav-path`, notif-card.js), so no line of the message starts with one.
// Lines are read the way a reader meets them: each character's own box, grouped by the line it sits on.
test('settings: a blocked notification\'s route never starts a line with an arrow on a laptop', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'the desktop browser\'s route; a phone gets its own');
    await page.setViewportSize({ width: 1280, height: 593 });
    await page.addInitScript(() => {
        try { Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'denied' }); } catch { /* no Notification */ }
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/settings.html');
    const msg = page.locator('#notifDeniedMsg');
    await expect(msg).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const lines = await msg.evaluate(el => {
        /** @type {{ top: number, text: string }[]} */
        const out = [];
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            const text = n.textContent || '';
            for (let i = 0; i < text.length; i++) {
                const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
                const box = r.getClientRects()[0]; if (!box) continue;
                let line = out.find(l => Math.abs(l.top - box.top) < 6);
                if (!line) { line = { top: box.top, text: '' }; out.push(line); }
                line.text += text[i];
            }
        }
        return out.sort((a, b) => a.top - b.top).map(l => l.text.trim());
    });
    expect(lines.length, 'premise: the message wraps at 1280px').toBeGreaterThan(1);
    expect(lines.filter(l => l.startsWith('→')), `a line starts with an arrow: ${JSON.stringify(lines)}`).toEqual([]);
});

// ── THE ABOUT PANEL'S PAGE LINKS LEAVE NO DEAD STEP IN BACK (18 Nov 2026) ───────────────────────────────────────
// "Calendar" (then "View staff roster") was a plain link inside the open panel, which holds a history entry with this page's address:
// the Calendar stacked on top of it, and Back from there came back to that entry — Settings again, with the next Back
// doing nothing. The panel's page links now REPLACE its entry, on every page that has one (about-lightbox.js, through
// overlay.js `followLinkOutOf`). Playwright runs with the back/forward cache off, so Back reloads here, as a phone
// does whenever the page holds a database connection.
test('settings: the About panel\'s "Calendar" link — one Back returns to Settings, and the next leaves it', async ({ page }) => {
    await page.goto('/railcard-guide.html');                   // where the member came from
    await openSettings(page, { configured: true, noPush: true });
    await page.locator('#navMenuBtn').click();
    await page.locator('#navPanelBrand').click();               // the drawer's head opens About
    const about = page.locator('#iconLightbox');
    await expect(about).toHaveClass(/\bopen\b/);
    await expect.poll(() => page.evaluate(() => history.state?.mybOverlay ?? null),
        { message: 'premise: the panel holds its own Back entry' }).toBe(true);
    await about.getByRole('link', { name: 'Calendar', exact: true }).click();
    await expect(page.locator('.calendar-day').first(), 'the link opened the Calendar').toBeVisible({ timeout: 15_000 });
    await page.goBack();
    await expect(page).toHaveURL(/\/settings\.html$/);
    expect(await page.evaluate(() => history.state?.mybOverlay ?? null),
        'Back landed on the panel\'s own entry, whose next Back nothing answers').toBeNull();
    await page.goBack();
    await expect(page, 'one more Back leaves Settings').toHaveURL(/\/railcard-guide\.html$/);
});
