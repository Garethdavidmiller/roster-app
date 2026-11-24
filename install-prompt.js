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
 * · **Anyone already inside the installed app** — `beforeinstallprompt` never fires there, and the
 *   iOS branch checks `display-mode: standalone` for the same reason.
 * · **Anyone on the GitHub Pages mirror.** This one is easy to miss and would quietly work against
 *   the migration: `myb-roster.web.app` is the primary install target. Most staff still open the app
 *   on the mirror (CLAUDE.md → Project identity — the changeover is deliberate and gradual), so it is
 *   no rump; but an install offer there would create NEW installs on the origin the app is moving
 *   off, which is why the mirror's answer is to install from the main address instead.
 *
 * ── THE TWO PLATFORMS ARE DIFFERENT THINGS ────────────────────────────────────────────────────
 *
 * Chromium fires `beforeinstallprompt`, which must be `preventDefault()`ed to stay usable and is
 * SINGLE-USE — after `prompt()` the reference is spent. So that branch offers a real button and
 * disappears whichever way the member answers.
 *
 * WebKit fires nothing: iOS has no programmatic install, and the only route is Share → Add to Home
 * Screen (Share sits under ••• in iOS 26's default Safari layout, and an email or chat app's browser
 * has no Add to Home Screen at all). So that branch offers INSTRUCTIONS and no button — the copy is
 * in index.html. It is shown on the app's own judgement rather than the browser's, which is why it
 * carries the extra guards above.
 *
 * ── AND IT IS MOBILE-ONLY, WHICH IS A BEHAVIOUR AND NOT JUST A LAYOUT ─────────────────────────
 *
 * `.top-prompt` is hidden at desktop widths (index.css, "Mobile-only UI: hide on desktop"), as the
 * notification strip already was: the strip is a phone's offer, inherited rather than chosen. (The
 * old reason, a desktop calendar that locked the body's height, went with that lock.)
 *
 * But it cannot be left to CSS alone, because `preventDefault()` on `beforeinstallprompt` SUPPRESSES
 * CHROME'S OWN install promotion. Doing that at a width where the strip is then invisible leaves a
 * desktop member with no offer from us and none from the browser either — strictly worse than not
 * shipping the feature. So the width test happens BEFORE the event is captured, and it reads the
 * decision off the stylesheet (`--prompt-available`) rather than keeping a second copy of the
 * breakpoint here.
 *
 * **The width is read ONCE, at init.** A tablet rotated from landscape to portrait mid-session gets
 * no strip, which is right rather than merely tolerable: we have already let that session's event
 * through to the browser, and re-arming on resize would put up a button with nothing behind it.
 *
 * ── AND THE NOTICE THAT MAKES THE SAME ASK IN FULL (v24.91) ───────────────────────────────────
 *
 * `install-app-2026` (calendar-notices.js) is a one-time notice asking the same thing with the
 * reasons, and this module is where it learns what to say: `installRoute()` is the detection above,
 * read for a notice rather than for the strip. Three rules keep the two from asking twice:
 *
 *   · **One held offer, module-wide.** Chromium's event is single-use, so the strip and the notice
 *     spend the SAME one (`promptInstall`) — two holders would be two buttons the browser honours
 *     once. It is still captured only where the strip would have captured it: a member who
 *     dismissed the strip long ago is not given one, and the notice tells them the browser menu
 *     route instead, which works without it.
 *   · **The notice takes the visit.** The moment it is decided (`yieldToInstallNotice`), the strip
 *     and the notification ask leave the screen for the rest of the visit, unflagged — the
 *     strip's own precedence rule, one level up.
 *   · **An answered notice retires the strip** (`retireInstallStrip`). A member who has read the
 *     whole case and said "Not now" is not asked again by a one-line version of it on the next
 *     visit; Settings keeps the install card as the place to find it.
 */
import { lsGet, lsSet } from './ls.js';
import { isIOS, isStandalonePWA, onPagesMirror } from './notif.js';

/** One-off per device, like the notification prompt beside it. */
const DISMISSED_KEY = 'myb_install_prompt_done';

/** Chromium's install offer, held from the moment it fires until something spends it — the strip
 *  or the install notice, never both (see the header). @type {any} */
let _offer = null;

/** Set once the install notice has taken this visit's ask: the strip then stays off screen. */
let _yielded = false;
/** What that yield took off the screen, each with the display it had — given back if the notice
 *  cannot open after all (`releaseInstallNoticeYield`). @type {Array<[HTMLElement, string]>} */
let _yieldTook = [];
/** The strip's own show, asked for while the notice held the visit — run if it gives the visit back.
 *  @type {(() => void)|null} */
let _showOnRelease = null;

// The installed app (`isStandalonePWA`) and the GitHub Pages mirror, which must never offer an
// install (`onPagesMirror` — see the header), are read through notif.js, the app's one copy of each
// (Nov 2026): this module kept a private pair that had to be kept in step with it.

/**
 * Can this strip be seen at this width at all? Read from the stylesheet's own `--prompt-available`,
 * so the breakpoint is declared once, in CSS.
 *
 * **Requires the flag to be exactly `'1'`, and fails CLOSED otherwise** (v22.32, external review).
 * It read `!== '0'` first, on the reasoning that an offer nobody sees is a smaller harm than
 * swallowing the browser's own — which had it backwards. An unreadable property returns `''`, and
 * `'' !== '0'` is true, so a browser that fired `beforeinstallprompt` but could not report a custom
 * property would have had its own install offer suppressed while our strip stayed CSS-hidden: no
 * offer from anyone, which is the one outcome this whole check exists to prevent. Failing closed
 * costs at most our strip on a browser that cannot read CSS variables, and the browser keeps its.
 * @param {HTMLElement} strip
 */
function canBeSeen(strip) {
    return getComputedStyle(strip).getPropertyValue('--prompt-available').trim() === '1';
}

/**
 * How this device would install the roster — for the install notice, which asks only where there is
 * something to install. `null` for a desktop, and for the installed app itself.
 *
 * A phone or tablet is read off `(pointer: coarse)`, the test the app already uses for touch-only UI;
 * the strip's width flag would count a narrowed desktop window as a phone. `how` is what to do in
 * THIS browser: 'prompt' (Chromium handed over its offer — one tap, through `promptInstall`), 'ios'
 * (Share, then Add to Home Screen) or 'menu' (any other browser's own menu). `mirror` is the Pages
 * mirror, where the answer is to install from the main address instead — never from here — and where
 * `how` is never 'prompt', because no offer is captured there.
 * @returns {{ how: 'prompt'|'ios'|'menu', mirror: boolean } | null}
 */
export function installRoute() {
    if (isStandalonePWA() || !window.matchMedia?.('(pointer: coarse)').matches) return null;
    const mirror = onPagesMirror();
    return { how: !mirror && _offer ? 'prompt' : isIOS() ? 'ios' : 'menu', mirror };
}

/**
 * Spend the held offer: the browser's own install dialog. Call it first thing in a click handler —
 * the browser wants the member's gesture behind it.
 * @returns {boolean} false when there was none to spend
 */
export function promptInstall() {
    const p = _offer;
    _offer = null;                   // single-use: a spent prompt cannot be shown again
    if (!p) return false;
    try { p.prompt(); } catch { /* the browser withdrew it — nothing to recover */ }
    return true;
}

/** The install notice is about to ask in full: the strip, and the notification ask it outranks,
 *  leave the screen for this visit — unflagged, so neither is lost. */
export function yieldToInstallNotice() {
    _yielded = true;
    _yieldTook = [];
    for (const id of ['installPrompt', 'notifPrompt']) {
        const el = /** @type {HTMLElement|null} */ (document.getElementById(id));
        if (!el) continue;
        _yieldTook.push([el, el.style.display]);
        el.style.display = 'none';
    }
}

/**
 * The install notice could not open after all — another notice or overlay had the screen at its
 * moment (`openNoticeIfClear` refused it), or access went in the wait — so the visit's ask is given
 * back: what the yield took down returns as it was, and a strip that asked to show meanwhile shows
 * now. Without it the visit had no ask at all: from 6 December the timetable notice is wired first
 * and waits for nobody, so on a phone browser still owed the install notice it took the screen, the
 * install notice was refused, and the strip and the notification ask had already gone for the visit
 * (whole-app check, 17 Nov 2026). A no-op unless the notice yielded.
 */
export function releaseInstallNoticeYield() {
    if (!_yielded) return;
    _yielded = false;
    for (const [el, display] of _yieldTook) el.style.display = display;
    _yieldTook = [];
    const show = _showOnRelease;
    _showOnRelease = null;
    show?.();
}

/** The member has answered the install notice, so the strip does not ask again on this device. */
export function retireInstallStrip() { lsSet(DISMISSED_KEY, '1'); }

/** Whether the install notice has taken this visit's one ask (yieldToInstallNotice). The strip's own
 *  show() checks it; the Calendar's notification ask does too since v24.96, so neither can land after
 *  the yield and sit beside the notice. @returns {boolean} */
export function installNoticeHasTheVisit() { return _yielded; }

/**
 * Show the install strip when it is both possible and appropriate.
 *
 * @param {object} deps
 * @param {Promise<any>} deps.accessReady   resolves once the calendar's access decision is made
 * @param {() => string} deps.getAccessType 'named' | 'none' ('viewer' went with the staff PIN, retired 23 Nov 2026;
 *   an anonymous 'open' mode existed until v24.34)
 * @returns {void}
 */
export function initInstallPrompt({ accessReady, getAccessType }) {
    const strip = document.getElementById('installPrompt');
    if (!strip) return;
    if (lsGet(DISMISSED_KEY)) return;
    if (isStandalonePWA() || onPagesMirror()) return;
    if (!canBeSeen(/** @type {HTMLElement} */ (strip))) return;   // desktop — leave Chrome's own offer alone

    const actionBtn  = document.getElementById('installPromptAction');
    const dismissBtn = document.getElementById('installPromptDismiss');
    const stepsEl    = document.getElementById('installPromptSteps');
    if (!actionBtn || !dismissBtn || !stepsEl) return;

    // ANSWERED IS ANSWERED, FOR THE REST OF THE VISIT (whole-app review, 10 Nov 2026). Chromium fires
    // `beforeinstallprompt` AGAIN when the member cancels the dialog Install opened — "typically
    // immediately after the userChoice property has resolved" (web.dev, "Customize install") — and
    // the handler below showed the strip whenever the event came, so somebody who had just said no
    // was asked again at once. Held in memory: the flag on disk answers for LATER visits (the early
    // return above), and `lsSet` forgives a storage that throws (iOS private mode), so the visit must
    // not depend on it. The re-fired offer is still HELD (the handler's `preventDefault` runs
    // first): the browser's own promotion stays quiet for the visit the member has just answered,
    // and the install notice may still spend it.
    let _answered = false;

    /** Hide the notification ask for THIS visit only — it returns next time. See the header. */
    function show() {
        if (_yielded) { _showOnRelease = show; return; }   // the install notice has this visit's ask — unless it gives it back
        if (_answered) return;       // the member has answered the strip — above
        const notif = document.getElementById('notifPrompt');
        if (notif) /** @type {HTMLElement} */ (notif).style.display = 'none';
        /** @type {HTMLElement} */ (strip).style.display = 'flex';
    }
    function hide() { /** @type {HTMLElement} */ (strip).style.display = 'none'; }
    function dismiss() { _answered = true; hide(); lsSet(DISMISSED_KEY, '1'); }

    // Chromium. The event can arrive before OR after the access decision, so both are awaited
    // together rather than assuming an order.
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();          // without this Chrome shows its own mini-infobar instead
        _offer = e;
        accessReady.then(() => {
            const t = getAccessType();
            if (t !== 'named') return;    // a member signed in by name only
            actionBtn.hidden = false;      // there is a real prompt to fire
            stepsEl.hidden   = true;       // …so the manual instructions are not the answer
            show();
        }).catch(() => { /* access never settled — offer nothing */ });
    });

    // Installed from the browser's own menu while this page is open.
    window.addEventListener('appinstalled', () => { _offer = null; dismiss(); });

    // WebKit. No event exists, so the app decides — hence the guards above.
    if (isIOS()) {
        accessReady.then(() => {
            const t = getAccessType();
            if (t !== 'named') return;
            if (_offer) return;                            // Chromium branch already handled it
            actionBtn.hidden = true;                       // there is nothing to press
            stepsEl.hidden   = false;                      // so say what to tap instead
            show();
        }).catch(() => { /* access never settled — offer nothing */ });
    }

    actionBtn.addEventListener('click', () => {
        promptInstall();             // first, inside the member's gesture
        dismiss();
    });
    dismissBtn.addEventListener('click', dismiss);
}
