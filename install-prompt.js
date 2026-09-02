// @ts-check
/**
 * install-prompt.js — the one-off "add the roster to your home screen" strip on the calendar.
 *
 * ── WHY IT IS ON THE CALENDAR AT ALL, HAVING BEEN KEPT OFF IT ──────────────────────────────────
 *
 * v22.13 put an install affordance in Settings and said, in its commit, "not on the calendar,
 * which is meant to stay one thing". That was an implementation judgement, not a recorded product
 * decision, and it has been reversed by the owner (Sep 2026): the people this helps most are the
 * ones who have never been to Settings. The calendar already carries exactly one one-off
 * dismissable strip — the notification prompt — so this is a second instance of an existing idiom
 * rather than a new kind of furniture, and it shares that strip's markup, styling and slot so the
 * two can never drift apart or, more importantly, appear together.
 *
 * The Settings row STAYS. It is the permanent, findable place; this is the prompt that catches
 * somebody who would never look.
 *
 * ── THE COLLISION WITH NOTIFICATIONS, WHICH IS THE REAL DESIGN PROBLEM ─────────────────────────
 *
 * **One ask at a time, and install outranks notifications.** Three reasons, and the first is not a
 * preference but arithmetic:
 *
 *   1. On iOS, `notifSupported()` is FALSE until the app is installed — Web Push simply does not
 *      exist in a Safari tab. So on an iPhone the notification prompt cannot come first; install is
 *      a prerequisite for the thing the other strip is offering.
 *   2. On Chromium both can fire, and two dismissable bars stacked above the roster is the harm.
 *      This repo has already learned that lesson once, in the one-time notices: two open at once
 *      meant one Escape archived a notice nobody had read (hence `openNoticeIfClear`).
 *   3. Installing makes push more reliable everywhere, so it is the higher-value ask of the two.
 *
 * The mechanism is deliberately blunt: when this strip is shown it hides `#notifPrompt` WITHOUT
 * setting its done flag, so the notification ask simply returns on a later visit. Suppressing it
 * permanently would trade one prompt for the other, which is not what "one at a time" means.
 *
 * ── WHO IS NEVER ASKED ────────────────────────────────────────────────────────────────────────
 *
 * · **The shared PIN viewer.** Same rule as the notification prompt and the same reasoning, which
 *   is worth restating because it is not obvious: a PIN unlock is a STATION, not a person. Nobody
 *   should be invited to install the staff roster onto the mess-room PC, and there would be no one
 *   able to remove it afterwards.
 * · **Anyone already inside the installed app** — `beforeinstallprompt` never fires there, and the
 *   iOS branch checks `display-mode: standalone` for the same reason.
 * · **Anyone on the GitHub Pages mirror.** This one is easy to miss and would quietly work against
 *   the migration: `myb-roster.web.app` is the primary install target, and the mirror is kept alive
 *   only for staff who already installed from it (CLAUDE.md). An install offer there would create
 *   NEW installs on the origin the app is trying to leave.
 *
 * ── THE TWO PLATFORMS ARE DIFFERENT THINGS ────────────────────────────────────────────────────
 *
 * Chromium fires `beforeinstallprompt`, which must be `preventDefault()`ed to stay usable and is
 * SINGLE-USE — after `prompt()` the reference is spent. So that branch offers a real button and
 * disappears whichever way the member answers.
 *
 * WebKit fires nothing: iOS has no programmatic install, and the only route is Share → Add to Home
 * Screen. So that branch offers INSTRUCTIONS and no button. It is shown on the app's own judgement
 * rather than the browser's, which is why it carries the extra guards above.
 *
 * ── AND IT IS MOBILE-ONLY, WHICH IS A BEHAVIOUR AND NOT JUST A LAYOUT ─────────────────────────
 *
 * `.top-prompt` is hidden at desktop widths (index.css), because the desktop calendar locks body
 * height and hides overflow — a band here squeezes the grid rather than sitting above it. That was
 * already true of the notification strip and is inherited rather than chosen.
 *
 * But it cannot be left to CSS alone, because `preventDefault()` on `beforeinstallprompt` SUPPRESSES
 * CHROME'S OWN install promotion. Doing that at a width where the strip is then invisible leaves a
 * desktop member with no offer from us and none from the browser either — strictly worse than not
 * shipping the feature. So the width test happens BEFORE the event is captured, and it reads the
 * decision off the stylesheet (`--prompt-available`) rather than keeping a second copy of the
 * breakpoint here.
 *
 * **The same reasoning does NOT rescue the shared-station case, and that is a deliberate limit.**
 * `preventDefault()` has to be called synchronously in the handler, and the access type is not known
 * until `accessReady` resolves — so a PIN-unlocked phone (a member using the station code on their
 * own device) has Chromium's mini-infobar suppressed and is then correctly offered nothing. The cost
 * is one page load's worth of the browser's own prompt; the event fires again on later visits, and
 * signing in — which is what that member should be doing — puts them straight into the branch that
 * does offer. Not fixable without either letting two offers appear at once or deciding access
 * synchronously, and it is written down because it looks exactly like the desktop bug above and is
 * not the same thing.
 *
 * **The width is read ONCE, at init.** A tablet rotated from landscape to portrait mid-session gets
 * no strip, which is right rather than merely tolerable: we have already let that session's event
 * through to the browser, and re-arming on resize would put up a button with nothing behind it.
 */
import { lsGet, lsSet } from './ls.js';
import { isIOS } from './notif.js';

/** One-off per device, like the notification prompt beside it. */
const DISMISSED_KEY = 'myb_install_prompt_done';

/** True when running as an installed Home Screen PWA. Mirrors notif.js's private copy. */
function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches
        || /** @type {any} */ (window.navigator).standalone === true;
}

/**
 * The GitHub Pages mirror, which must never offer an install — see the header. Matched on the host
 * alone: the mirror is served from `garethdavidmiller.github.io`, and nothing else the app is served
 * from ends in `github.io`.
 */
function isDeprecatedMirror() {
    return /github\.io$/i.test(window.location.hostname);
}

/**
 * Can this strip be seen at this width at all? Read from the stylesheet's own `--prompt-available`,
 * so the breakpoint is declared once, in CSS. Fails OPEN on a browser that cannot read the property
 * — an offer nobody can see is a smaller harm than silently swallowing the browser's own.
 * @param {HTMLElement} strip
 */
function canBeSeen(strip) {
    const flag = getComputedStyle(strip).getPropertyValue('--prompt-available').trim();
    return flag !== '0';
}

/**
 * Show the install strip when it is both possible and appropriate.
 *
 * @param {object} deps
 * @param {Promise<any>} deps.accessReady   resolves once the calendar's access decision is made
 * @param {() => string} deps.getAccessType 'named' | 'viewer' | 'open' | …
 * @returns {void}
 */
export function initInstallPrompt({ accessReady, getAccessType }) {
    const strip = document.getElementById('installPrompt');
    if (!strip) return;
    if (lsGet(DISMISSED_KEY)) return;
    if (isStandalone() || isDeprecatedMirror()) return;
    if (!canBeSeen(/** @type {HTMLElement} */ (strip))) return;   // desktop — leave Chrome's own offer alone

    const actionBtn  = document.getElementById('installPromptAction');
    const dismissBtn = document.getElementById('installPromptDismiss');
    const stepsEl    = document.getElementById('installPromptSteps');
    if (!actionBtn || !dismissBtn || !stepsEl) return;

    /** @type {any} */
    let deferred = null;

    /** Hide the notification ask for THIS visit only — it returns next time. See the header. */
    function show() {
        const notif = document.getElementById('notifPrompt');
        if (notif) /** @type {HTMLElement} */ (notif).style.display = 'none';
        /** @type {HTMLElement} */ (strip).style.display = 'flex';
    }
    function hide() { /** @type {HTMLElement} */ (strip).style.display = 'none'; }
    function dismiss() { hide(); lsSet(DISMISSED_KEY, '1'); }

    // Chromium. The event can arrive before OR after the access decision, so both are awaited
    // together rather than assuming an order.
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();          // without this Chrome shows its own mini-infobar instead
        deferred = e;
        accessReady.then(() => {
            const t = getAccessType();
            if (t !== 'named' && t !== 'open') return;    // never the shared station
            actionBtn.hidden = false;      // there is a real prompt to fire
            stepsEl.hidden   = true;       // …so the manual instructions are not the answer
            show();
        }).catch(() => { /* access never settled — offer nothing */ });
    });

    // Installed from the browser's own menu while this page is open.
    window.addEventListener('appinstalled', () => { deferred = null; dismiss(); });

    // WebKit. No event exists, so the app decides — hence the guards above.
    if (isIOS()) {
        accessReady.then(() => {
            const t = getAccessType();
            if (t !== 'named' && t !== 'open') return;
            if (deferred) return;                          // Chromium branch already handled it
            actionBtn.hidden = true;                       // there is nothing to press
            stepsEl.hidden   = false;                      // so say what to tap instead
            show();
        }).catch(() => { /* access never settled — offer nothing */ });
    }

    actionBtn.addEventListener('click', () => {
        const p = deferred;
        deferred = null;             // single-use: a spent prompt cannot be shown again
        dismiss();
        try { p?.prompt(); } catch { /* the browser withdrew it — nothing to recover */ }
    });
    dismissBtn.addEventListener('click', dismiss);
}
