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
 * the "Current notices" table in that skill (it moved there from CLAUDE.md on 7 Nov 2026). Two
 * rules worth restating because both were shipped bugs once: a notice OPENS through
 * `openNoticeIfClear`, never `open()` (two notices up, one Escape flagged the buried one seen for
 * good — v19.53); and it waits for `calendarAccessReady` (on a locked Calendar it would cover the
 * sign-in card, the one control on the page — v20.12).
 *
 * AND EVERY NOTICE DECLARES AN AUDIENCE (v21.81). `calendarAccessReady` resolves the moment access
 * is granted and said nothing about WHOSE it was, so both notices of the day opened on a PIN-unlocked
 * station PC — one asking the reader to check their own payslips. The rule is `noticeAudienceAllows`
 * in calendar-access-core.js, where it is pure and tested. Since the staff PIN was retired (owner,
 * 23 Nov 2026) its one audience is `'members'`: the two that existed for the PIN, `'signed-out'` and
 * `'everyone'`, went with it — no live notice used either — and the rule refuses them. Open through
 * `_openWhenAudienceAllows` rather than wiring the check per notice, so a notice added later cannot
 * quietly skip it, and it still FORWARDS the declared audience to the rule rather than hardcoding
 * one: a notice that declares anything else is refused, visibly, in testing.
 *
 * Which notices have come and gone, and why each went: the new-notice skill's table and git log — this
 * header kept that history until 24 Nov 2026, and it belongs with the record, not the code.
 *
 * WHERE STORAGE WILL NOT KEEP A FLAG, NO NOTICE OPENS (App Notices review, 24 Nov 2026). Safari with
 * every cookie blocked, a full quota or a locked-down in-app browser fail every write silently
 * (`lsSet`), so a notice's done flag never stuck and a "one-time" notice opened on every load. Asked
 * once, by writing and reading back (`lsAvailable`, ls.js), before anything is wired.
 */

import { lsGet, lsSet, lsAvailable } from './ls.js';
import { archiveNotice, reviseArchivedNotice, isNoticeExpired } from './notice-archive.js';
import { createLightbox, openNoticeIfClear, followLinkOutOf } from './overlay.js';
import { calendarAccessReady, getAccessType } from './calendar-access.js';
import { noticeAudienceAllows } from './calendar-access-core.js';
import { getSession } from './session.js';
import { teamMembers } from './roster-data.js';
import { payCalculatorPrices } from './pay-audience.js';   // the Pay page's own audience question
import { installRoute, promptInstall, yieldToInstallNotice, releaseInstallNoticeYield, retireInstallStrip } from './install-prompt.js';
import { canOpenNewlink } from './auth-policy.js';   // the New link notice's audience — the drawer pill's own question

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
 * (v24.91), rather than 1500ms later, on top of it. Its undo, `whenRefused`, runs if the notice then
 * does not open — another notice or overlay has the screen, or access went in the wait — and gives
 * back what the decision took (17 Nov 2026): the visit was otherwise left with no ask at all.
 *
 * @param {{ open: () => void }} lb
 * @param {'members'} audience  the only one there is (calendar-access-core.js → `noticeAudienceAllows`)
 * @param {() => boolean} [alsoWhen]
 * @param {() => void} [whenDecided]
 * @param {() => void} [whenRefused]
 */
function _openWhenAudienceAllows(lb, audience, alsoWhen = () => true, whenDecided = () => {}, whenRefused = () => {}) {
    // Access first, then whatever the coordinator asked us to queue behind (v23.21: the forced
    // set-password overlay a front-door sign-in may put up — see calendar-app.js). `_after` never
    // rejects and never hangs (the coordinator bounds it), so this cannot silence a notice.
    // The one audience question, asked at the decision AND again at the open (below).
    const addressed = () => noticeAudienceAllows(audience, getAccessType());
    calendarAccessReady.then(() => _after).then(() => {
        if (!addressed()) return;
        if (!alsoWhen()) return;
        whenDecided();
        // ASKED AGAIN AT THE OPEN (whole-app review, 10 Nov 2026). Access can be taken back inside
        // the defer — a member granted on a cached answer and re-locked half a second later ("Calendar
        // access has expired. Sign in again to carry on.") — and the lock cards set no scroll lock,
        // so `openNoticeIfClear` would open the notice over the very card this module waits for
        // access to keep it off. Refused here, it is refused like any other: not opened, not flagged.
        setTimeout(() => {
            if (!addressed() || !openNoticeIfClear(lb)) whenRefused();
        }, 1500);
    });
}

/**
 * The last day the two October notices were offered — Saturday 31 October 2026, all of it (owner,
 * 22 Oct 2026, for the Year to Date notice and the timetable one alike). Both are retired (22 Nov
 * 2026); the date stays because the install notice still follows them, through `FOLLOWED_ENDS`.
 *
 * A DATE, NOT A DAY COUNT FROM POSTING. The clocks go back on 25 October, so "N days after posting"
 * is N days and an hour of wall clock: counted from the timetable notice's 21 Oct it would have
 * ended at 23:00 on the 31st. `isNoticeExpired(day, 1)` counts one day from that day's own local
 * midnight, and 31 Oct to 1 Nov holds no clock change, so it ends at midnight exactly.
 */
const OCTOBER_LAST_DAY = '31 Oct 2026';

/**
 * What App Notices keeps of the timetable notice. WORDS THAT STAY TRUE for the 180 days the record is
 * listed (App Notices review, 24 Nov 2026): it said the timetable "starts on Sunday 13 December", which
 * is false from that Sunday while the record has months to run. The route never breaks (`\u00a0`).
 */
const TIMETABLE_SOON_RECORD = {
    id: 'timetable-soon-2026', section: 'Trains', date: '16 Nov 2026',
    title: 'The new timetable from Sunday 13 December',
    body: 'Chiltern’s new timetable runs from Sunday 13 December 2026. The Trains page shows what changes at every '
        + 'station, and the last trains — open it from the menu: ☰\u00a0then 🚆\u00a0Trains.',
};

/**
 * What App Notices keeps of the New link notice. It used to add "Nothing is decided yet", which the
 * record would go on saying after the choice is made; the page itself says where things stand.
 */
const NEWLINK_RECORD = {
    id: 'newlink-2026', section: 'New link', date: '9 Nov 2026',
    title: 'See the three proposals for the new link',
    body: 'The three proposals for the new link, which starts in January 2027, are on the New link page — open it '
        + 'from the menu: ☰\u00a0then 🔁\u00a0New\u00a0link.',
};

/** What every notice waits for after access — set once by `initCalendarNotices`. @type {Promise<any>} */
let _after = Promise.resolve();

/**
 * WHEN EACH NOTICE THAT ANOTHER FOLLOWS STOPS BEING OFFERED, by its done key — the arguments its own
 * IIFE passes `isNoticeExpired` (16 Nov 2026). A follower used to wait for the followed notice's done
 * flag ALONE, and only that notice's own code sets the flag, as it reaches its expiry branch. The
 * monthly cleanup deletes a notice's markup and code 180 days after posting, so from then a device
 * that had never answered it would never get the flag — and every notice behind it would wait for
 * ever. Here the end outlives the code: an entry stays as long as anything follows its notice, and
 * calendar-notices.test.mjs holds each one to the expiry the live notice declares.
 * @type {Record<string, [day: string, days: number]>}
 */
const FOLLOWED_ENDS = {
    myb_notice_timetable_2026_done:   [OCTOBER_LAST_DAY, 1],
    myb_notice_ytd_figures_2026_done: [OCTOBER_LAST_DAY, 1],
    myb_notice_install_app_2026_done: ['22 Oct 2026', 90],
    myb_notice_newlink_2026_done:     ['5 Dec 2026', 1],
};

/**
 * Has the notice behind this done key been dealt with on this device — answered here, or past its
 * own last day, when nothing will offer it again whether or not its code is still here? Read at
 * WIRING time, as a follower's flags always are, so a follower never comes on the load another one
 * is answered. A key with no end recorded waits for its flag alone.
 * @param {string} doneKey
 * @returns {boolean}
 */
function followedDone(doneKey) {
    if (lsGet(doneKey)) return true;
    const end = FOLLOWED_ENDS[doneKey];
    return !!end && isNoticeExpired(end[0], end[1]);
}

/**
 * Wire a notice's link: pressing it answers the notice, and a plain click is followed by REPLACING the
 * notice's history entry with the page it opens (`followLinkOutOf`, overlay.js), as the drawer's links
 * replace the drawer's (18 Nov 2026). Left a plain link, that page stacked on top of the notice's entry,
 * and one Back from it landed on a step of the Calendar that nothing answered. A new tab is left to the
 * browser, with the notice still up for its own close; it is answered either way.
 * @param {string} id  the link's id
 * @param {{ close: () => unknown }} lb  the notice it sits in
 * @param {() => void} answered  what pressing it records
 */
function _wireNoticeLink(id, lb, answered) {
    document.getElementById(id)?.addEventListener('click', (/** @type {MouseEvent} */ e) => {
        answered();
        followLinkOutOf(lb, e);
    });
}

/**
 * Would the Pay Calculator price THIS member, or show them its refusal card? `payCalculatorPrices`
 * (pay-audience.js) is the Pay page's own test, by the role AT THE TIME: asked here with no payslips,
 * so only TODAY's grade counts — a notice invites work on the payslip being earned — and the page,
 * which also asks today, can never refuse a member this sends there. Read at OPEN time by the notices
 * that ask it: a member signing in at the front door on this very load has no session at wiring time.
 * @returns {boolean}
 */
function payCalcIsTheirs() {
    const name = getSession()?.name;
    return payCalculatorPrices(teamMembers.find(m => m.name === name) ?? null);
}

/**
 * Wire every one-time notice this page carries. Called once from calendar-app.js.
 * @param {{ after?: Promise<any> }} [opts]  `after` — settle before any notice opens. The coordinator
 *   passes the forced set-password step's promise, so a notice can never race a mandatory overlay
 *   the way the paycalc YTD notice once did (paycalc-notice-order.test.mjs).
 */
export function initCalendarNotices({ after } = {}) {
    // Words corrected since a device archived them, put on its record whether or not the notice is still
    // offered — the record outlives the notice by months (`reviseArchivedNotice`).
    for (const record of [TIMETABLE_SOON_RECORD, NEWLINK_RECORD]) reviseArchivedNotice(record);
    if (!lsAvailable()) return;
    if (after) _after = Promise.resolve(after).catch(() => {});
    // Each notice keeps its own IIFE ON PURPOSE: their bodies bail with early `return`s (done,
    // snoozed, expired), and as plain blocks those returns leave THIS function — so the first
    // notice already dismissed silenced every notice after it. Caught by a render check the same
    // hour it was written; the wrapper is the scope those returns need.
    // WIRED BEFORE THE INSTALL NOTICE (v24.96, the 72-hour review). In the final week, 6–12 December,
    // this one waits for nobody, so two notices can be due on one load — this one and, on a phone that
    // never answered it, the install notice — and the first to ask for the screen takes it
    // (openNoticeIfClear refuses a second, leaving it unflagged for the next load). The time-critical
    // reminder goes first; the install notice, which keeps for 90 days, comes back the load after.
    // ── The new timetable starts on Sunday 13 December (v24.94; owner, 23 Oct 2026; brought forward, v26.21) ──
    //
    // The first timetable notice ended with October (OCTOBER_LAST_DAY), six weeks before the change,
    // and from then nothing in the app said the day was coming. This was to be offered in the final
    // week only, from Sunday 6 December; the owner brought it forward to its posting day, Monday
    // 16 November (owner, 16 Nov 2026), so it now runs to the end of Saturday the 12th. Members only,
    // a ONE-OFF on the same rule as the first — every dismissal marks it done. Its words NAME THE DATE,
    // on every line (whole-app review, 10 Nov 2026): they named the weekend ("starts on Sunday",
    // "This weekend"), which on a Sunday in its run reads as today and names the wrong weekend.
    // A push goes out on the Saturday evening too (functions/documents.js, sendTimetableReminder) —
    // to the phones that have notifications on; this reaches the Calendar, which everyone opens.
    //
    // AFTER THE OTHERS UNTIL ITS FINAL WEEK, then FIRST (owner, 16 Nov 2026). Until 6 December it
    // waits for the install notice where that one is this device's to get (`installRoute()`: a phone
    // or tablet in a browser), and for the New link notice where that one is the member's
    // (`canOpenNewlink`, asked as that notice asks it): a desk, the installed app, or somebody the New
    // link page turns away waits for neither, which would otherwise hold this back until they had both
    // ended. Their flags are read at WIRING time, as every follower's are, so it never comes on the
    // load another is answered; who the member is, and the route, are asked at OPEN time, because a
    // front-door sign-in has no session at wiring time. From Sunday 6 December (`FINAL_WEEK`) it waits
    // for nobody: the change is a week away, the New link notice has ended, and the install notice
    // keeps until January — which is why this is wired before it.
    //
    // A NOTICE THAT STARTS ON A DATE (v24.94). The start is read from the clock at wiring time, and
    // a device that arrives early is left UNFLAGGED, exactly as an out-of-audience device is: it gets
    // the notice when its day comes. calendar-notices.test.mjs reads `STARTS` and keeps a notice out
    // of the matrix until it is due.
    (function () {
        const DONE_KEY        = 'myb_notice_timetable_soon_2026_done';
        const STARTS          = new Date(2026, 10, 16);    // local midnight, Monday 16 November — its posting day
        const FINAL_WEEK      = new Date(2026, 11, 6);     // local midnight, Sunday 6 December — from then it waits for nobody
        const CHANGE_EVE      = '12 Dec 2026';             // offered through the whole of the Saturday; gone on the day itself
        const FOLLOWS_INSTALL = 'myb_notice_install_app_2026_done';   // …where that notice is this device's
        const FOLLOWS_NEWLINK = 'myb_notice_newlink_2026_done';       // …where that notice is the member's

        const overlay = document.getElementById('timetableSoonNoticeLb');
        if (!overlay) return;
        if (lsGet(DONE_KEY)) return;
        if (isNoticeExpired(CHANGE_EVE, 1)) { lsSet(DONE_KEY, '1'); return; }
        if (Date.now() < STARTS.getTime()) return;
        const finalWeek         = Date.now() >= FINAL_WEEK.getTime();
        const installNoticeDone = followedDone(FOLLOWS_INSTALL);
        const newlinkNoticeDone = followedDone(FOLLOWS_NEWLINK);

        const markDone = () => lsSet(DONE_KEY, '1');

        const lb = createLightbox({
            overlay,
            content:  /** @type {HTMLElement} */ (document.getElementById('timetableSoonNoticeContent')),
            closeBtn: /** @type {HTMLElement} */ (document.getElementById('timetableSoonNoticeClose')),
            onOpen() { archiveNotice(TIMETABLE_SOON_RECORD); },
            onClose() { markDone(); },
        });

        _wireNoticeLink('timetableSoonNoticeGo', lb, markDone);
        document.getElementById('timetableSoonNoticeLater')?.addEventListener('click', () => lb.close());

        // 'members', as the October notice was — the only audience since the staff PIN was retired
        // (23 Nov 2026). A device still waiting for the install or New link notice is left unflagged, so
        // a later load still gets it.
        _openWhenAudienceAllows(lb, 'members',
            () => finalWeek || ((installNoticeDone || !installRoute())
                && (newlinkNoticeDone || !canOpenNewlink(getSession()?.name))));
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
    // confirmed for the first two. It FOLLOWS the October timetable notice, and it also waits for the
    // Year to Date notice, but only where that one was the member's to get: a Dispatcher never got it.
    // Both flags are read at WIRING time, as FOLLOWS always is, so the order held by construction.
    // BOTH ARE RETIRED (lightbox review, 22 Nov 2026): their markup and code went once they had been
    // inert for three weeks, and their ends stay in `FOLLOWED_ENDS`, so `followedDone` passes on them
    // for every device — the ones that never answered them included — and this one waits for neither.
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
    // ON AN iPHONE IT SAYS WHAT THE INSTALL COSTS (iPhone audit, 7 Nov 2026). A Home Screen app keeps
    // storage of its own, separate from the browser it was added from — the sign-in, the Pay
    // Calculator's figures and these notices' own flags all stay behind — and the notice used to
    // promise the opposite ("your saved pay figures are far less likely to be cleared"). So the iOS
    // route adds three things: where Share is on iOS 26 (under •••), that an email or chat app has no
    // Add to Home Screen (open the roster in Safari first), and the storage fact, with the card that
    // carries the figures across. Android shares one storage between the browser and the app, so none
    // of that is said there. The iOS route has no button to push out of sight; its card scrolls.
    //
    // ONE ASK AT A TIME with the strip: once this notice is decided, the strip and the notification
    // ask leave the screen for the visit — and come back if the notice then cannot open, so a visit
    // is never left with no ask at all (17 Nov 2026) — and once it is answered the strip does not ask
    // again on this device. Archived on OPEN, because two of its answers leave the page or the browser.
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
        // Past the end of 31 October both notices it follows are over, so it waits for neither — their
        // own code may since have been removed, and with it the only thing that would set their flags.
        if (!followedDone(FOLLOWS)) return;
        const payNoticeDone = followedDone(FOLLOWS_PAY);

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
                // PAY WORDS ONLY FOR A MEMBER THE PAY PAGE PRICES (App Notices review, 24 Nov 2026): an Other
                // Staff login has no Pay page since v26.59, and a Dispatcher's is the refusal card, so "the pay
                // figures you save" and "Move Your Pay Data" were about a page they cannot use.
                const pay = payCalcIsTheirs();
                _showInstallRoute({ ...route, pay });
                const how = route.mirror ? 'mirror' : route.how;
                archiveNotice({
                    id: NOTICE_ID, title: 'Put the roster on your home screen', section: 'General',
                    date: NOTICE_DATE,
                    body: 'The roster works better from your phone’s home screen than from its web address: it opens '
                        + 'in one tap and fills the screen'
                        + (pay ? ', and the pay figures you save in the home screen app are far less likely to be cleared. ' : '. ')
                        + INSTALL_HOW[how] + (pay && INSTALL_PAY[how] ? ' ' + INSTALL_PAY[how] : ''),
                });
            },
            onClose() { answered(); },
        });

        document.getElementById('installNoticeInstall')?.addEventListener('click', () => {
            promptInstall();               // first, while the tap still counts as the member's
            answered();
            lb.close();
        });
        _wireNoticeLink('installNoticeGo', lb, answered);   // the mirror's link to the main address
        document.getElementById('installNoticeLater')?.addEventListener('click', () => lb.close());

        // 'members' — the only audience since the staff PIN was retired (23 Nov 2026). A desktop, the
        // station PC included, is never asked: `installRoute()` is null there (install-prompt.js says why).
        _openWhenAudienceAllows(lb, 'members',
            () => !!installRoute() && (payNoticeDone || !payCalcIsTheirs()),   // payNoticeDone: always, since 1 Nov
            () => { decided = installRoute() ?? decided; yieldToInstallNotice(); },
            releaseInstallNoticeYield);   // refused at the open: the strip and the ask come back for this visit
    }());

    // ── The New link page: three proposals, for the colleagues it is for (v25.61; owner, 9 Nov 2026) ──
    //
    // "A third in sequence on calendar advertising the new links page with a description and link to
    // that page, but only for those who can view that page." The page opened at v25.60 to everyone on a
    // normal CEA contract and the managers; this tells them it is there. A ONE-OFF on the rule every
    // notice here follows — any dismissal marks it done — and its body names the menu route, so
    // "Not now" loses nothing.
    //
    // ONLY WHERE THE PAGE WOULD LET THEM IN. The question is the drawer pill's own, `canOpenNewlink`
    // (auth-policy.js), and newlink-config.test.mjs holds that to the page's door for every name on
    // the roster — so the notice, the pill and the page cannot disagree about who it is for. Asked at
    // OPEN time through the gate, as the Year to Date notice asks its question: a member signing in at
    // the front door on this very load has no session at wiring time. Refused, it is left unflagged.
    // Not newlink-config.js: newlink-boundary.test.mjs keeps the proposals' modules out of the
    // Calendar's reach, and this needs nothing from them.
    //
    // IN SEQUENCE, never sharing a visit. It waits for the install notice — but only where that one is
    // this device's to get (`installRoute()`: a phone or tablet in a browser). A desktop or the
    // installed app never gets the install notice, so waiting for its flag there would hold this one
    // back until both had run out; the managers this is partly for are mostly on a desktop. The flag
    // is read at WIRING time, as every follower's is, so this never comes on the load the install
    // notice is answered. And it is wired LAST: on a load where anything else is due, that takes the
    // screen and this one comes back next time (openNoticeIfClear).
    //
    // From its posting day (`STARTS` — before it, a device is left unflagged, not dismissed) to the end
    // of Saturday 5 December (`LAST_DAY`), so it is gone before the timetable notice's final week, when
    // that one stops waiting for it (v26.21). Its words say what the page says and no more: the month
    // the page gives, no person (the page names who leads the change), and nothing about how the
    // choice is made. Archived on OPEN, because the link leaves the page.
    (function () {
        const DONE_KEY        = 'myb_notice_newlink_2026_done';
        const STARTS          = new Date(2026, 10, 9);     // local midnight, Monday 9 November — its posting day
        const LAST_DAY        = '5 Dec 2026';              // offered through the whole of the Saturday
        const FOLLOWS_INSTALL = 'myb_notice_install_app_2026_done';   // …where that notice is this device's

        const overlay = document.getElementById('newlinkNoticeLb');
        if (!overlay) return;
        if (lsGet(DONE_KEY)) return;
        if (isNoticeExpired(LAST_DAY, 1)) { lsSet(DONE_KEY, '1'); return; }
        if (Date.now() < STARTS.getTime()) return;
        const installNoticeDone = followedDone(FOLLOWS_INSTALL);

        const markDone = () => lsSet(DONE_KEY, '1');

        const lb = createLightbox({
            overlay,
            content:  /** @type {HTMLElement} */ (document.getElementById('newlinkNoticeContent')),
            closeBtn: /** @type {HTMLElement} */ (document.getElementById('newlinkNoticeClose')),
            onOpen() { archiveNotice(NEWLINK_RECORD); },
            onClose() { markDone(); },
        });

        _wireNoticeLink('newlinkNoticeGo', lb, markDone);
        document.getElementById('newlinkNoticeLater')?.addEventListener('click', () => lb.close());

        // 'members' — the page is signed-in only (owner, 2 Nov 2026), as every notice now is.
        _openWhenAudienceAllows(lb, 'members',
            () => canOpenNewlink(getSession()?.name) && (installNoticeDone || !installRoute()));
    }());
}

/** The install notice's archived how-to, per route — what the drawer's App Notices keeps of the lines
 *  this device was shown. A one-tap offer is spent once used, so its record gives the menu route. */
const INSTALL_HOW = {
    prompt: 'To add it later, open your browser’s menu and look for Install app or Add to Home screen.',
    menu:   'Open your browser’s menu and look for Install app or Add to Home screen.',
    ios:    'Tap your browser’s Share button, then Add to Home Screen — on iOS 26 or later, Share is under •••. '
          + 'Opened the roster from an email or a chat? Open it in Safari first. The home screen app keeps its own '
          + 'storage, so you sign in there once.',
    mirror: 'Add it from the app’s main address, myb-roster.web.app.',
};

/** The Pay Calculator half of the archived how-to, for a member the Pay page prices — and nobody else. */
const INSTALL_PAY = /** @type {Record<string, string>} */ ({
    ios:    'Pay Calculator figures saved in the browser do not move across by themselves — copy any first with '
          + 'Move Your Pay Data on the Pay page.',
    mirror: 'If you have saved Pay Calculator figures, move them first with Move Your Pay Data on the Pay page.',
});

/**
 * Show the install notice's lines for one route and hide the rest. Every line it owns is set, shown
 * or hidden, so nothing depends on the markup's starting state. `pay` — the Pay page prices this
 * member — gates every line about Pay Calculator figures; left out, they show, as before it existed.
 * @param {{ how: 'prompt'|'ios'|'menu', mirror: boolean, pay?: boolean }} route
 */
function _showInstallRoute({ how, mirror, pay = true }) {
    /** @type {Record<string, boolean>} */
    const shown = {
        installNoticePayLead: pay,
        installNoticeMirror:  mirror,
        installNoticeIos:     !mirror && how === 'ios',
        installNoticeSafari:  !mirror && how === 'ios',     // an email or chat app has no Add to Home Screen
        installNoticeMenu:    !mirror && how === 'menu',
        installNoticePay:     pay && mirror,
        // The Home Screen app's storage is its own — Android's is not. The sign-in half is everybody's; only the
        // pay figures' half is gated (review of v26.67: gating the whole line took "you sign in there once" too).
        installNoticeIosStore: !mirror && how === 'ios',
        installNoticePayIos:  pay && !mirror && how === 'ios',
        installNoticeHave:    !mirror && how === 'menu',     // Chromium offers only where it is not installed; the iPhone's line says it itself
        installNoticeActions: mirror || how === 'prompt',
        installNoticeInstall: !mirror && how === 'prompt',   // never an Install button on the mirror, whatever `how` says (v24.96)
        installNoticeGo:      mirror,
    };
    for (const [id, on] of Object.entries(shown)) {
        const el = document.getElementById(id);
        if (el) /** @type {HTMLElement} */ (el).hidden = !on;
    }
}
