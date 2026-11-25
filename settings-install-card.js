// @ts-check
/**
 * settings-install-card.js — the Settings page's "Install on this device" card, and the hold on the
 * browser's install offer that feeds it.
 *
 * Moved out of `settings-app.js` on 25 Nov 2026, unchanged, when that coordinator reached its size
 * cap. Two exports, called at two different moments, and the split is the point:
 * `captureInstallOffer` runs at page START, before the sign-in wait, because Chromium fires
 * `beforeinstallprompt` once and early; `initDeviceCard` runs once the cards are wired, after sign-in,
 * and adopts whatever was caught. WHEN installing is a to-do rather than an offer, and where the app is
 * added from, is `installNeed` (settings-status.js), which a Node test holds; this module wires it.
 * Behaviour-tested in e2e/settings.spec.js.
 */

import { getSession } from './session.js';
import { isIOS, isStandalonePWA, onPagesMirror } from './notif.js';
import { installNeed } from './settings-status.js';

/**
 * Hold the browser's install offer from page start until the Device card can use it.
 * @returns {{ event: any, onChange: null | (() => void) }}
 */
export function captureInstallOffer() {
    /** @type {{ event: any, onChange: null | (() => void) }} */
    const offer = { event: null, onChange: null };
    // The Pages mirror is refused below; leave Chrome's own infobar alone there.
    if (onPagesMirror()) return offer;
    window.addEventListener('beforeinstallprompt', (e) => {
        // Chrome's own mini-infobar is suppressed only for a member ALREADY signed in, for whom the
        // Device card is about to offer the install instead (v25.06, whole-app review). The card is
        // wired only after sign-in, so suppressing it for a signed-out visitor took Chrome's offer
        // away and put nothing in its place — "strictly worse than nothing" (install-prompt.js).
        // The event is KEPT either way: an in-place sign-in still gets its install row (Sep 2026),
        // and `prompt()` works on an event whose default was not prevented.
        if (getSession()) e.preventDefault();
        offer.event = e;
        offer.onChange?.();
    });
    return offer;
}

/**
 * The conditional "Install on this device" card (v22.13; its own card since v22.37, owner review).
 *
 * It earns its place because installing makes push possible on iOS and makes pay data saved IN
 * the installed app durable — the two subjects this page is about, and neither something a member
 * knows. The whole CARD is conditional: it appears only while there is an install to offer, since
 * a permanent "✓ Installed" row would be a card that never does anything again. Chromium's
 * `beforeinstallprompt` (never on WebKit, never inside an installed PWA) is the offer on Android;
 * it is single-use, so the card goes the moment it is spent, or on `appinstalled`. On an iPhone the
 * card states the taps instead — and, since the Home Screen app keeps storage of its own, what does
 * NOT come with the install: the sign-in, and the pay figures (iPhone audit, 7 Nov 2026).
 */
export function initDeviceCard(/** @type {(state: import('./settings-status.js').CardState, chip?: string) => void} */ report,
                               /** @type {{ event: any, onChange: null | (() => void) }} */ offer,
                               /** @type {boolean} */ holdsPayFigures) {
    const row   = document.getElementById('deviceCard');
    const btn   = /** @type {HTMLElement|null} */ (document.getElementById('installBtn'));
    const steps = /** @type {HTMLElement|null} */ (document.getElementById('installSteps'));
    // A card whose markup is not there cannot be a thing to finish — and must not hold the
    // summary on "Checking…" for ever by never reporting at all.
    if (!row || !btn || !steps) { report('n/a'); return; }

    // Already installed, or the Pages mirror — the calendar's install strip refuses both, for the same
    // reasons: there is nothing to install, and installing FROM the mirror would pin a member to the
    // address we are migrating off. (An iPhone there is sent to the main address instead, below.)
    const installed = isStandalonePWA();
    const onMirror  = onPagesMirror();

    // **The report is synchronous and definite, and that is load-bearing.** The summary waits on
    // every card it speaks for, so a state that only arrived with `beforeinstallprompt` would leave a
    // browser that never fires it on "Checking your settings…" for ever. WHEN installing is a thing
    // to finish rather than an offer, and where the app is added from, is `installNeed`.
    const need = installNeed({ ios: isIOS(), installed, onMirror });
    report(need.state, need.chip);

    if (need.from) {
        btn.hidden   = true;         // WebKit fires no event, so there is nothing to press
        const iosLine = document.getElementById('installNoteIos');   // …and here installing is what notifications need
        if (iosLine) iosLine.hidden = false;
        steps.hidden = false;        // say what to tap instead
        // …starting with the figures, where there are any: the Home Screen app keeps its own storage.
        const payStep = document.getElementById('installStepPay');
        if (payStep) payStep.hidden = !holdsPayFigures;
        const fromHere = document.getElementById('installStepSafari'), fromMain = document.getElementById('installStepMain');
        if (fromHere) fromHere.hidden = need.from !== 'here';           // …and, on the mirror, at the
        if (fromMain) fromMain.hidden = need.from !== 'main-address';   // address it is added from
        row.hidden   = false;
    }

    /** @type {any} */
    let deferred = null;
    // The offer is captured at page start (`captureInstallOffer`), since it may already have fired.
    const adopt = () => {
        if (installed || onMirror || !offer.event) return;
        deferred = offer.event;
        offer.event = null;          // single-use, like the prompt it holds
        row.hidden = false;          // …but still 'n/a': an offer, not a to-do
    };
    offer.onChange = adopt;
    adopt();
    window.addEventListener('appinstalled', () => { deferred = null; row.hidden = true; });
    btn.addEventListener('click', () => {
        if (!deferred) { row.hidden = true; return; }
        const p = deferred;
        deferred = null;             // single-use: a spent prompt cannot be shown again
        row.hidden = true;
        try { p.prompt(); } catch { /* the browser withdrew it — nothing to recover */ }
    });
}
