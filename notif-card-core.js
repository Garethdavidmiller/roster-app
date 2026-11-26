// @ts-check
/**
 * notif-card-core.js — what the Settings Notifications card SAYS, for each state this device can be in.
 *
 * Owns: the card's words and the state it reports to the Settings summary (`notifCardWords`), which
 *   kinds of notification it lists (the timetable change only while one is due — `timetableListed`),
 *   the installed app's name as the member sees it under its icon (`homeScreenLabel`), and the
 *   separators between the listed kinds (`punctuateKinds`).
 * Does NOT own: any read. The browser's permission, the subscription and the platform are read by
 *   notif-card.js through notif.js and handed in; nothing here touches the DOM's live state, the
 *   Notification API or storage. What a card state MEANS to the summary is settings-status.js's.
 * Edit here for: a wording change, a new state, or the next timetable change's date.
 *
 * ── WHY THE WORDS ARE A PURE FUNCTION ────────────────────────────────────────────────────────────
 *
 * The card's words are its whole product: every state ends in a sentence and a chip, and each one has
 * been wrong at least once (a Disable read back as "stopped", a blocked phone told to tap a padlock it
 * did not have, an iPhone given the install steps twice). As one function of plain inputs they are
 * tested in Node for every platform without a browser (notif-card-core.test.mjs); the wiring that
 * feeds them is notif-card.test.mjs's.
 *
 * ── TWO PLATFORMS, SERVED EQUALLY ────────────────────────────────────────────────────────────────
 *
 * Every blocked-notification route is the platform's own, and none assumes Chrome is the browser:
 * an iPhone's permission lives in iOS Settings under the app's Home Screen name; an installed Android
 * app's in the phone's Settings → Apps (it has no address bar); an Android tab's behind the address
 * bar's site icon; a computer's is Chrome's route with a pointer for every other browser, since this
 * module names no step it cannot verify.
 */
import { installNeed } from './settings-status.js';

/**
 * The next timetable change — a CLIENT COPY of `TIMETABLE_CHANGE` in functions/documents.js, which
 * sends the one-off reminder the evening before (month 0-based, as there). The two are held equal by
 * notif-card-core.test.mjs, which reads the function file as text, so the next change cannot move one.
 */
export const TIMETABLE_CHANGE = Object.freeze({ year: 2026, month: 11, day: 13 });   // Sunday 13 December 2026
/** The hour, London time, of `sendTimetableReminder`'s daily run (its schedule, '0 18 * * *'). Pinned
 *  to that schedule by the same test. */
export const TIMETABLE_SEND_HOUR = 18;

/** London's calendar date and minute-of-day at `now`, whatever zone the phone is set to.
 *  @param {Date} now @returns {{ ymd: number, minute: number }} */
function londonNow(now) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
    }).formatToParts(now).map(p => [p.type, p.value]));
    return {
        ymd: Number(parts.year) * 10000 + Number(parts.month) * 100 + Number(parts.day),
        minute: Number(parts.hour) * 60 + Number(parts.minute),
    };
}

/**
 * Is the timetable reminder still to come? It is sent ONCE, at 18:00 London on the evening before the
 * change, so the card lists "Timetable changes" up to and including that send and never after it — a
 * member turning notifications on later agrees to a list that contains only what they will be sent
 * (owner, 22 Nov 2026). The next change moves `TIMETABLE_CHANGE` and the item returns by itself.
 * @param {Date} [now]
 * @returns {boolean}
 */
export function timetableListed(now = new Date()) {
    const eve = new Date(Date.UTC(TIMETABLE_CHANGE.year, TIMETABLE_CHANGE.month, TIMETABLE_CHANGE.day - 1));
    const eveYmd = eve.getUTCFullYear() * 10000 + (eve.getUTCMonth() + 1) * 100 + eve.getUTCDate();
    const { ymd, minute } = londonNow(now);
    return ymd < eveYmd || (ymd === eveYmd && minute <= TIMETABLE_SEND_HOUR * 60);
}

/**
 * The installed app's name as it appears under its icon, READ from the page's own
 * `<meta name="apple-mobile-web-app-title">` rather than written here (owner, 22 Nov 2026). The advice
 * then follows the label if it is ever renamed, and the source holds no app name in copy — the label is
 * the one place the station code may name the app (CLAUDE.md, app-name-parity.test.mjs), because a
 * dozen characters is all an iPhone shows under an icon. `null` when the meta is missing or empty.
 * @param {{ querySelector(sel: string): { getAttribute(name: string): string|null } | null } | null | undefined} doc
 * @returns {string|null}
 */
export function homeScreenLabel(doc) {
    const label = doc?.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content')?.trim();
    return label || null;
}

/**
 * Each listed kind with its separator: " ·" after every one but the last. A kind is one unbreakable
 * run with its separator inside it (settings.html), so hiding the LAST kind — the timetable change,
 * once it has been sent — would otherwise leave the list ending on a stray "·".
 * @param {string[]} kinds the kinds being shown, in order, with or without separators
 * @returns {string[]}
 */
export function punctuateKinds(kinds) {
    const bare = kinds.map(k => k.replace(/\s*·\s*$/, '').trim());
    return bare.map((k, i) => (i < bare.length - 1 ? `${k} ·` : k));
}

/** The line the card shows once Enable has waited `askLimitMs` with the browser's question still
 *  unanswered — Chrome's quiet prompt is easy to miss, and its promise may never settle. */
export const STILL_ASKING_LINE = 'Your browser is still asking whether to allow notifications. Answer its prompt and this card will update.';
/** The line after a subscribe that failed — a dismissed prompt and a refusal each say so in the state's own words. */
export const ENABLE_FAILED_LINE = 'Couldn’t turn notifications on. Check your connection and try again — if it keeps failing, contact the admin.';

/**
 * @typedef {object} NotifDevice
 * @property {boolean} supported  notif.js's `notifSupported()`
 * @property {'on'|'off-default'|'off-lapsed'|'denied'|'unsupported'} state  notif.js's read
 * @property {boolean} offByChoice  the member pressed Disable on this device (`notifOffByChoice`)
 * @property {boolean} ios        an iPhone or iPad
 * @property {boolean} android    an Android phone or tablet
 * @property {boolean} installed  running as the installed app
 * @property {boolean} onMirror   on the GitHub Pages mirror
 * @property {string|null} appLabel  the name under the app's icon (`homeScreenLabel`), or null
 */

/**
 * @typedef {object} NotifWords
 * @property {'ok'|'action'|'blocked'|'n/a'} report  the card's state, for the Settings summary
 * @property {string} chip
 * @property {'plain'} [tone]   set only to stop the chip being coloured by its state (an `ok` "Off")
 * @property {string} status
 * @property {'enable'|'disable'|null} button  the one button shown, if any
 * @property {null | { text: string } | { lead: string, route: string, tail: string }} steps
 *   where a BLOCKED device allows notifications again: plain text, or a lead, a route kept on one line
 *   (`.nav-path`) and a tail
 * @property {'shown'|'after-install'|'hidden'} kinds  whether the card lists what it sends — never on a
 *   device that cannot get them, and as the installed app's on an iPhone that must install first
 */

/**
 * What the card says for this device in this state.
 *
 * ── A DEVICE THAT CANNOT GET THEM IS NOT PROMISED ANY ────────────────────────────────────────────
 *
 * An iPhone in a browser cannot receive a push until the app is on its Home Screen (WebKit gives a
 * tab none), so its chip says "After install" and the list is the installed app's. Whether installing
 * is the answer is `installNeed`'s (settings-status.js), the same function the Install card reads, so
 * the two cards cannot disagree — and the line here is A POINTER, NOT A SECOND COPY of the steps
 * (polish round 2, owner-approved): the Install card lists the taps, on the main address and on the
 * Pages mirror alike (it starts the mirror's steps at the main address), so this one never does.
 * Every other device without push truly cannot, says why, and lists nothing.
 *
 * @param {NotifDevice} d
 * @returns {NotifWords}
 */
export function notifCardWords(d) {
    if (!d.supported || d.state === 'unsupported') {
        if (installNeed({ ios: d.ios, installed: d.installed, onMirror: d.onMirror }).from) {
            const then = d.appLabel
                ? `Then find ${d.appLabel} (the name under its icon) on your Home Screen, open it and turn notifications on there.`
                : 'Then open the roster from your Home Screen (find it by the name under its icon) and turn notifications on there.';
            return { report: 'n/a', chip: 'After install', button: null, steps: null, kinds: 'after-install',
                status: `On iPhone or iPad, notifications work only in the app on your Home Screen — see “Install on this device” below. ${then}` };
        }
        // An iPhone ALREADY on the Home Screen with no push is an iOS from before Web Push (16.4).
        return { report: 'n/a', chip: 'Not available', button: null, steps: null, kinds: 'hidden',
            status: d.ios && d.installed
                ? 'Notifications need iOS 16.4 or later. Update in Settings → General → Software Update.'
                : 'This browser can’t show notifications from the roster — try a recent Chrome, Edge or Firefox.' };
    }

    if (d.state === 'on') {
        return { report: 'ok', chip: '✓ On', button: 'disable', steps: null, kinds: 'shown',
            status: 'Notifications are on for this device — you’ll get each alert listed above.' };
    }
    if (d.state === 'off-lapsed') {
        return { report: 'action', chip: 'Off', button: 'enable', steps: null, kinds: 'shown',
            status: 'Notifications were on but have stopped. Select “Turn on notifications” to start them again.' };
    }
    if (d.state === 'denied') {
        // BLOCKED, not off. The browser will not ask again, so the summary names it rather than
        // telling the member to tap Enable — and the card says where it IS fixed.
        return { report: 'blocked', chip: 'Blocked', button: null, kinds: 'shown',
            status: 'Notifications are blocked on this device, so the button can’t turn them on. To allow them:',
            steps: blockedSteps(d) };
    }
    if (d.offByChoice) {
        // Switched off HERE, on purpose (Sep 2026 review): `ok` to the summary, nothing to do — but
        // not good news, so the chip is not green (v25.14).
        return { report: 'ok', chip: 'Off', tone: 'plain', button: 'enable', steps: null, kinds: 'shown',
            status: 'Notifications are off on this device. Select “Turn on notifications” to start them again.' };
    }
    return { report: 'action', chip: 'Off', button: 'enable', steps: null, kinds: 'shown',
        status: 'Select “Turn on notifications” to get the alerts listed above.' };
}

/**
 * Where a blocked device allows notifications again. See the header: the platform's own route, and
 * no step this module cannot verify.
 * @param {NotifDevice} d
 * @returns {{ text: string } | { lead: string, route: string, tail: string }}
 */
function blockedSteps(d) {
    if (d.ios) {
        // An installed web app's permission lives in iOS Settings under the name under its icon, not
        // under a browser (whole-app review, Oct 2026) — named, when the page can read it.
        const app = d.appLabel ? `${d.appLabel} (the name under its icon)` : 'this app by the name under its icon';
        return { text: `On iPhone or iPad: open Settings → Notifications, find ${app}, and turn on Allow Notifications.` };
    }
    if (d.android) {
        // The INSTALLED app has no address bar, so no icon there to tap (17 Nov 2026). In a tab the icon
        // is DESCRIBED, not named a padlock: Chrome draws "two sliders" since 2023, an older one the
        // padlock — and the address bar is the browser's, whichever browser it is.
        return { text: d.installed
            ? 'On Android: open your phone’s Settings → Apps, find this app by its home screen name, and turn on Notifications.'
            : 'On Android: tap the icon at the left of the address bar (a padlock or two sliders) → Site settings → Notifications → Allow.' };
    }
    // A computer. The route is one unit (`.nav-path`), and the arrow into it keeps to the word before
    // it (a no-break space): a line that starts "→" reads as broken punctuation (13 Nov 2026).
    return { lead: 'In Chrome: click the icon at the left of the address bar (a padlock or two sliders) → ',
        route: 'Site settings → Notifications → Allow',
        tail: '. In another browser, look in its settings for this site’s notifications.' };
}
