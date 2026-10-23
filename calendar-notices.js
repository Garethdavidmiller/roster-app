// @ts-check
/**
 * calendar-notices.js — the Calendar page's one-time notices, in one place.
 *
 * Split out of calendar-app.js at v21.61, when the second live notice took the coordinator over
 * its ratchet cap. The split is the honest response rather than a raise: a notice is a
 * self-contained unit with one lifecycle (show once, archive, retire on a date), notices ARRIVE
 * AND EXPIRE routinely (the two it was split out with were both deleted within months),
 * and each one was growing the page coordinator by ~50 lines of wiring that has nothing to do with
 * coordinating the Calendar. `/new-notice` additions for index.html land HERE from now on.
 *
 * Everything here follows `.claude/skills/new-notice/` — the HTML template lives in index.html,
 * the rules table in CLAUDE.md ("Current notices"). Two rules worth restating because both were
 * shipped bugs once: a notice OPENS through `openNoticeIfClear`, never `open()` (two notices up,
 * one Escape flagged the buried one seen for good — v19.53); and it waits for
 * `calendarAccessReady` (on a locked Calendar it would cover the staff-PIN card, the one control
 * on the page — v20.12).
 *
 * AND EVERY NOTICE DECLARES AN AUDIENCE (v21.81). `calendarAccessReady` resolves the moment access
 * is granted and says nothing about WHOSE it is, so both notices were opening on a PIN-unlocked
 * station PC — one asking the reader to check their own payslips. The rule is
 * `noticeAudienceAllows` in calendar-access-core.js, where it is pure and tested; the default is
 * `'members'`, and `'signed-out'` is for a notice whose audience is specifically people who have
 * not signed in. Open through `_openWhenAudienceAllows` rather than wiring the check per notice, so
 * a notice added later cannot quietly skip it.
 *
 * ── NO SIGNED-OUT NOTICE LIVE, AND WHAT THAT COSTS THE GUARD (v23.23; updated to v24.91) ──────────
 *
 * `sign-in-2026` was retired here by owner decision, not by its expiry. v23.19 made the Calendar's
 * front door a sign-in card, so its whole audience — somebody reading the roster on the staff PIN —
 * has now SEEN that card and chosen the PIN instead, and the notice spent its life re-offering a
 * choice the reader had just declined a moment earlier. `backpay-2026` followed at v23.31, deleted
 * once its hard cutoff had passed rather than left inert until the 180-day sweep.
 *
 * That left `al-booking-2026` alone until v24.82 added `timetable-2026`, v24.86 the Year to Date
 * notice that follows it and v24.91 the install notice — the same release that retired the leave
 * reminder early, by owner decision (22 Oct 2026). Every one of them is `'members'` —
 * so **no live notice addresses the signed-out audience**, and the positive direction of the
 * audience gate has nothing to exercise it. `calendar-notices.test.mjs` can still prove a notice is REFUSED to the wrong audience and
 * that every notice is gated at all; what it can no longer prove behaviourally is that a
 * `'signed-out'` notice REACHES a PIN unlock. The next such notice restores it automatically —
 * both suites derive their matrix from this source rather than from a hand-kept list. Until then
 * a static contract carries the weight: `_openWhenAudienceAllows` must FORWARD its declared
 * audience to the rule rather than hardcode one, which is the shape the gap would otherwise hide.
 */

import { lsGet, lsSet } from './ls.js';
import { archiveNotice, isNoticeExpired } from './nav-panel.js';
import { createLightbox, openNoticeIfClear } from './overlay.js';
import { calendarAccessReady, getAccessType } from './calendar-access.js';
import { noticeAudienceAllows } from './calendar-access-core.js';
import { getSession } from './session.js';
import { teamMembers, gradeForRole } from './roster-data.js';
import { installRoute, promptInstall, yieldToInstallNotice, retireInstallStrip } from './install-prompt.js';

/**
 * Open a notice once access is decided AND this device is one of its audience.
 *
 * The audience check has to be HERE, after `calendarAccessReady`, because that is the first moment
 * the access type exists — at wiring time every device looks the same. A device outside the
 * audience is left completely untouched: not opened, and NOT flagged seen, so the notice arrives
 * intact the next time that device is signed in.
 *
 * The 1500ms defer is the skill's, and load-bearing for a different reason: it keeps a notice off
 * the Huddle viewer's auto-open. `openNoticeIfClear` is the v19.53 rule — with two overlays up, one
 * Escape ran both onClose callbacks and flagged the buried one seen for good.
 *
 * A notice may add ONE further condition, `alsoWhen`, for a reader who can only be known at that
 * same moment: the Year to Date notice asks whose Pay Calculator this is, and at wiring time a
 * member signing in at the front door has no session yet. It is held to the audience rule's
 * standard — read once, after access, and a refusal leaves the notice untouched and unflagged.
 *
 * And ONE thing to do the moment a notice is decided, `whenDecided`, for a notice that makes the same
 * ask as something already on the page: the install notice takes the install strip down then
 * (v24.91), rather than 1500ms later, on top of it.
 *
 * @param {{ open: () => void }} lb
 * @param {'members'|'signed-out'|'everyone'} audience
 * @param {() => boolean} [alsoWhen]
 * @param {() => void} [whenDecided]
 */
function _openWhenAudienceAllows(lb, audience, alsoWhen = () => true, whenDecided = () => {}) {
    // Access first, then whatever the coordinator asked us to queue behind (v23.21: the forced
    // set-password overlay a front-door sign-in may put up — see calendar-app.js). `_after` never
    // rejects and never hangs (the coordinator bounds it), so this cannot silence a notice.
    calendarAccessReady.then(() => _after).then(() => {
        if (!noticeAudienceAllows(audience, getAccessType())) return;
        if (!alsoWhen()) return;
        whenDecided();
        setTimeout(() => openNoticeIfClear(lb), 1500);
    });
}

/**
 * The last day the two October notices are offered — Saturday 31 October 2026, all of it; from
 * 1 November a device that never saw them is flagged and shown nothing (owner, 22 Oct 2026, for
 * the Year to Date notice and the timetable one alike).
 *
 * A DATE, NOT A DAY COUNT FROM POSTING. The clocks go back on 25 October, so "N days after posting"
 * is N days and an hour of wall clock: counted from the timetable notice's 21 Oct it would have
 * ended at 23:00 on the 31st. `isNoticeExpired(day, 1)` counts one day from that day's own local
 * midnight, and 31 Oct to 1 Nov holds no clock change, so it ends at midnight exactly.
 */
const OCTOBER_LAST_DAY = '31 Oct 2026';

/** What every notice waits for after access — set once by `initCalendarNotices`. @type {Promise<any>} */
let _after = Promise.resolve();

/**
 * Would the Pay Calculator price THIS member, or show them its refusal card? `gradeForRole` is the
 * Pay page's own test, imported from roster-data.js so the two cannot disagree. Read at OPEN time by
 * the notices that ask it: a member signing in at the front door on this very load has no session
 * at wiring time.
 * @returns {boolean}
 */
function payCalcIsTheirs() {
    const name = getSession()?.name;
    return !!gradeForRole(teamMembers.find(m => m.name === name)?.role);
}

/**
 * Wire every one-time notice this page carries. Called once from calendar-app.js.
 * @param {{ after?: Promise<any> }} [opts]  `after` — settle before any notice opens. The coordinator
 *   passes the forced set-password step's promise, so a notice can never race a mandatory overlay
 *   the way the paycalc YTD notice once did (paycalc-notice-order.test.mjs).
 */
export function initCalendarNotices({ after } = {}) {
    if (after) _after = Promise.resolve(after).catch(() => {});
    // Each notice keeps its own IIFE ON PURPOSE: their bodies bail with early `return`s (done,
    // snoozed, expired), and as plain blocks those returns leave THIS function — so the first
    // notice already dismissed silenced every notice after it. Caught by a render check the same
    // hour it was written; the wrapper is the scope those returns need.
    // ── The new timetable, and where to learn it (v24.82; owner request, 21 Oct 2026) ────────────
    //
    // Chiltern's timetable changes on Sunday 13 December, and staff will be asked about it; this
    // points members at the Trains page, which shows the change station by station. A ONE-OFF from
    // the start, on the rule the owner set for the leave reminder (10 Sep 2026; that notice was
    // retired early at v24.91): every dismissal — the ×, the backdrop, Escape, "Not now" and the
    // link — marks it DONE, so it declares no snooze key at all. Its body says where the page sits
    // in the menu, so "Not now" loses nothing.
    // It is offered until the end of 31 October (owner, 22 Oct 2026 — `OCTOBER_LAST_DAY`). It
    // shipped running to 13 December, the day the timetable starts; the owner brought it forward to
    // end with the Year to Date notice below, which waits for this one to be dismissed. Archived on
    // OPEN, because the link may take the member away before onClose fires.
    (function () {
        const NOTICE_ID   = 'timetable-2026';
        const NOTICE_DATE = '21 Oct 2026';
        const DONE_KEY    = 'myb_notice_timetable_2026_done';

        const overlay = document.getElementById('timetableNoticeLb');
        if (!overlay) return;
        if (lsGet(DONE_KEY)) return;
        if (isNoticeExpired(OCTOBER_LAST_DAY, 1)) { lsSet(DONE_KEY, '1'); return; }

        const markDone = () => lsSet(DONE_KEY, '1');

        const lb = createLightbox({
            overlay,
            content:  /** @type {HTMLElement} */ (document.getElementById('timetableNoticeContent')),
            closeBtn: /** @type {HTMLElement} */ (document.getElementById('timetableNoticeClose')),
            onOpen() {
                archiveNotice({
                    id: NOTICE_ID, title: 'A new timetable starts on 13 December', section: 'Trains',
                    date: NOTICE_DATE,
                    body: 'Chiltern’s new timetable starts on Sunday 13 December. The Trains page shows what '
                        + 'changes at Marylebone, station by station — open it from the menu: ☰ then 🚆 Trains.',
                });
            },
            onClose() { markDone(); },
        });

        document.getElementById('timetableNoticeGo')?.addEventListener('click', markDone);
        document.getElementById('timetableNoticeLater')?.addEventListener('click', () => lb.close());

        // 'members' — chosen while the Trains page signed people in, when its link would have led the
        // station PC only to a sign-in. The PIN has read Trains since v24.84; whether the station
        // should be told too is the owner's open question (CLAUDE.md's notice table). A PIN unlock
        // is not flagged seen, so the notice still arrives when that device is next signed in.
        _openWhenAudienceAllows(lb, 'members');
    }());

    // ── Year to Date figures: a closer tax estimate on the Pay Calculator (v24.86; owner, 22 Oct) ──
    //
    // Teaches the Pay Calculator's Year to Date card — what the two figures are, where they are on a
    // payslip, and what they do — and links to the card itself, opened (paycalc.html#payslipCard).
    // It asks for the TAX CODE to be checked first (v24.88, owner): with a wrong code, Year to Date
    // figures make the estimate worse, not better — the cumulative method applies the wrong allowance
    // to every payslip of the year at once. Measured on a real payslip with the default code where the
    // payslip said 1182L: the next estimate £23.20 out without the figures, £207.60 out with them.
    // A ONE-OFF on the same rule as the timetable notice above: every dismissal marks it done.
    //
    // IT COMES THE TIME AFTER THE TIMETABLE NOTICE, never on the same load (owner). So it reads that
    // notice's done flag NOW, at wiring time, and is not wired at all until the flag was set on an
    // earlier load — dismissing the timetable notice cannot bring this one up behind it, and two
    // notices are never offered back to back. `FOLLOWS` restates that notice's key, which the test
    // pins equal to the one its IIFE declares, so a renamed key cannot quietly strand this notice.
    // Today the order would ALSO hold without it — this block sits after the timetable one, so its
    // timer fires second and `openNoticeIfClear` finds the page already covered (measured: deleting
    // the rule leaves the browser journey green). It stays because the owner named the ORDER, and an
    // order that holds only because of where a block sits in this file is one reordering away from
    // not holding. calendar-notices.test.mjs block 7 is what fails without it.
    //
    // ONLY TO A MEMBER THE PAY CALCULATOR CAN PRICE. It refuses every role without confirmed rates
    // (Dispatchers, the manager accounts) and any name the roster no longer holds, so a notice sent
    // to them would advertise a page that turns them away. `gradeForRole` is the Pay page's own
    // test, imported from roster-data.js so the two cannot disagree. Read at OPEN time, through the
    // gate: a member who signs in at the front door on this very load has no session at wiring time.
    // Refused, it is left unflagged, like an out-of-audience notice.
    //
    // Offered to the end of 31 October with the timetable notice (`OCTOBER_LAST_DAY`), so a member
    // who first meets that one on the 31st gets this one only by opening the Calendar again that
    // day — the cost of the owner's single end date, and the right way round: the timetable notice
    // is never cut short to make room. Archived on OPEN, because the link leaves the page.
    (function () {
        const NOTICE_ID   = 'ytd-figures-2026';
        const NOTICE_DATE = '22 Oct 2026';
        const DONE_KEY    = 'myb_notice_ytd_figures_2026_done';
        const FOLLOWS     = 'myb_notice_timetable_2026_done';

        const overlay = document.getElementById('ytdNoticeLb');
        if (!overlay) return;
        if (lsGet(DONE_KEY)) return;
        if (isNoticeExpired(OCTOBER_LAST_DAY, 1)) { lsSet(DONE_KEY, '1'); return; }
        if (!lsGet(FOLLOWS)) return;

        const markDone = () => lsSet(DONE_KEY, '1');

        const lb = createLightbox({
            overlay,
            content:  /** @type {HTMLElement} */ (document.getElementById('ytdNoticeContent')),
            closeBtn: /** @type {HTMLElement} */ (document.getElementById('ytdNoticeClose')),
            onOpen() {
                archiveNotice({
                    id: NOTICE_ID, title: 'Make your pay estimates more accurate', section: 'Pay',
                    date: NOTICE_DATE,
                    body: 'Check the tax code in Your Settings matches your payslip, then copy Taxable Pay and Tax Paid from the Year to '
                        + 'Date box at the bottom left of your latest payslip into the Pay Calculator’s 📊 Year to Date Figures '
                        + 'card — its tax figure usually gets much closer to your payslip.',
                });
            },
            onClose() { markDone(); },
        });

        document.getElementById('ytdNoticeGo')?.addEventListener('click', markDone);
        document.getElementById('ytdNoticeLater')?.addEventListener('click', () => lb.close());

        // 'members' — it is about YOUR pay, and on the PIN-unlocked station PC it addresses nobody.
        _openWhenAudienceAllows(lb, 'members', payCalcIsTheirs);
    }());

    // ── Put the roster on your home screen (v24.91; owner, 22 Oct 2026) ────────────────────────────
    //
    // "Reminding everyone to install the web app on mobile rather than use the web address." The
    // install strip (install-prompt.js) has asked since Sep 2026, in one line at the top of the page
    // that a thumb dismisses at a glance; this is the whole case, made once. A ONE-OFF on the same
    // rule as the notices above: every dismissal marks it done.
    //
    // ONLY WHERE THERE IS SOMETHING TO INSTALL — a phone or tablet in a browser, never a desktop and
    // never the installed app itself (`installRoute()` is null for both). Read at open time through
    // the gate, and a refusal leaves it unflagged, so a member who meets the Calendar on a PC first
    // still gets it on their phone. Offered for 90 days; after that a device that never saw it is
    // flagged and shown nothing.
    //
    // THIRD IN LINE, and never on the load another notice is dismissed — the order the owner
    // confirmed for the first two. It FOLLOWS the timetable notice, and it also waits for the Year to
    // Date notice, but only where that one is the member's to get: a Dispatcher never gets it, and
    // waiting for it would hold this notice back until the Year to Date notice expires on
    // 1 November. Both flags are read at WIRING time, as FOLLOWS always is, so the order holds by
    // construction: on the load the Year to Date notice is shown, this one is refused at the gate,
    // whichever timer fires first.
    //
    // WHAT IT SAYS DEPENDS ON THE BROWSER, chosen as it opens, because Chromium's offer can arrive
    // after the gate: one tap where Chromium has handed its install offer over; Share, then Add to
    // Home Screen, on an iPhone or iPad; the browser's own menu anywhere else. On the GitHub Pages
    // mirror — where most staff still open the roster — it never says install HERE: the app does not
    // make installs on the address it is moving people off (install-prompt.js's header), so it sends
    // them to myb-roster.web.app, and warns that Pay Calculator figures do not follow by themselves
    // (they live in this address's own storage; the Pay page's Move Your Pay Data card moves them).
    // It gives the mirror NO steps and no "already installed" line: with them the card ran past a
    // phone's screen and put its one button out of sight (measured at 393×851), and the main address
    // shows the steps itself — its install strip at once, then this notice, for a device that is
    // new there.
    //
    // ONE ASK AT A TIME with the strip: once this notice is decided, the strip and the notification
    // ask leave the screen for the visit, and once it is answered the strip does not ask again on this
    // device. Archived on OPEN, because two of its answers leave the page or the browser.
    (function () {
        const NOTICE_ID   = 'install-app-2026';
        const NOTICE_DATE = '22 Oct 2026';
        const DONE_KEY    = 'myb_notice_install_app_2026_done';
        const FOLLOWS     = 'myb_notice_timetable_2026_done';
        const FOLLOWS_PAY = 'myb_notice_ytd_figures_2026_done';   // …where that notice is the member's

        const overlay = document.getElementById('installNoticeLb');
        if (!overlay) return;
        if (lsGet(DONE_KEY)) return;
        if (isNoticeExpired(NOTICE_DATE, 90)) { lsSet(DONE_KEY, '1'); return; }
        if (!lsGet(FOLLOWS)) return;
        const payNoticeDone = !!lsGet(FOLLOWS_PAY);

        /** Answered, whichever way: done, and the strip is not to ask again either. */
        const answered = () => { lsSet(DONE_KEY, '1'); retireInstallStrip(); };
        /** The route the gate saw, for the open 1500ms later should the browser stop answering
         *  then — a tablet whose keyboard was attached meanwhile. The mirror must stay the mirror. */
        let decided = /** @type {NonNullable<ReturnType<typeof installRoute>>} */ ({ how: 'menu', mirror: false });

        const lb = createLightbox({
            overlay,
            content:  /** @type {HTMLElement} */ (document.getElementById('installNoticeContent')),
            closeBtn: /** @type {HTMLElement} */ (document.getElementById('installNoticeClose')),
            onOpen() {
                const route = installRoute() ?? decided;
                _showInstallRoute(route);
                archiveNotice({
                    id: NOTICE_ID, title: 'Put the roster on your home screen', section: 'General',
                    date: NOTICE_DATE,
                    body: 'The roster works better from your phone’s home screen than from its web address: it opens '
                        + 'in one tap, fills the screen, and your saved pay figures are far less likely to be cleared. '
                        + INSTALL_HOW[route.mirror ? 'mirror' : route.how],
                });
            },
            onClose() { answered(); },
        });

        document.getElementById('installNoticeInstall')?.addEventListener('click', () => {
            promptInstall();               // first, while the tap still counts as the member's
            answered();
            lb.close();
        });
        document.getElementById('installNoticeGo')?.addEventListener('click', answered);
        document.getElementById('installNoticeLater')?.addEventListener('click', () => lb.close());

        // 'members' — the station PC is not a person, and nobody should install the staff roster on
        // it (install-prompt.js says why). A PIN unlock is not flagged seen.
        _openWhenAudienceAllows(lb, 'members',
            () => !!installRoute() && (payNoticeDone || !payCalcIsTheirs()),
            () => { decided = installRoute() ?? decided; yieldToInstallNotice(); });
    }());
}

/** The install notice's archived how-to, per route — what the drawer's App Notices keeps of the lines
 *  this device was shown. A one-tap offer is spent once used, so its record gives the menu route. */
const INSTALL_HOW = {
    prompt: 'To add it later, open your browser’s menu and look for Install app or Add to Home screen.',
    menu:   'Open your browser’s menu and look for Install app or Add to Home screen.',
    ios:    'Tap your browser’s Share button, then Add to Home Screen.',
    mirror: 'Add it from the app’s main address, myb-roster.web.app — and if you have saved Pay Calculator '
          + 'figures, move them first with Move Your Pay Data on the Pay page.',
};

/**
 * Show the install notice's lines for one route and hide the rest. Every line it owns is set, shown
 * or hidden, so nothing depends on the markup's starting state.
 * @param {{ how: 'prompt'|'ios'|'menu', mirror: boolean }} route
 */
function _showInstallRoute({ how, mirror }) {
    /** @type {Record<string, boolean>} */
    const shown = {
        installNoticeMirror:  mirror,
        installNoticeIos:     !mirror && how === 'ios',
        installNoticeMenu:    !mirror && how === 'menu',
        installNoticePay:     mirror,
        installNoticeHave:    !mirror && how !== 'prompt',   // Chromium offers only where it is not installed
        installNoticeActions: mirror || how === 'prompt',
        installNoticeInstall: how === 'prompt',
        installNoticeGo:      mirror,
    };
    for (const [id, on] of Object.entries(shown)) {
        const el = document.getElementById(id);
        if (el) /** @type {HTMLElement} */ (el).hidden = !on;
    }
}
