// @ts-check
/**
 * calendar-notices.js — the Calendar page's one-time notices, in one place.
 *
 * Split out of calendar-app.js at v21.61, when the second live notice took the coordinator over
 * its ratchet cap. The split is the honest response rather than a raise: a notice is a
 * self-contained unit with one lifecycle (show once, archive, retire on a date), notices ARRIVE
 * AND EXPIRE routinely (this file's two will both be deleted within months, per the 180-day rule),
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
 * ── ONE NOTICE LIVE, AND WHAT THAT COSTS THE GUARD (v23.23) ─────────────────────────────────────
 *
 * `sign-in-2026` was retired here by owner decision, not by its expiry. v23.19 made the Calendar's
 * front door a sign-in card, so its whole audience — somebody reading the roster on the staff PIN —
 * has now SEEN that card and chosen the PIN instead, and the notice spent its life re-offering a
 * choice the reader had just declined a moment earlier. The PIN card itself also states the code
 * lasts only "as long as this browser stays open", which was half of what the notice existed to
 * say, and its CTA pointed at Settings for a sign-in that is now on the page underneath it.
 *
 * That leaves `backpay-2026` alone, and it is `'members'` — so **no live notice addresses the
 * signed-out audience**, and the positive direction of the audience gate has nothing to exercise
 * it. `calendar-notices.test.mjs` can still prove a notice is REFUSED to the wrong audience and
 * that every notice is gated at all; what it can no longer prove behaviourally is that a
 * `'signed-out'` notice REACHES a PIN unlock. The next such notice restores it automatically —
 * both suites derive their matrix from this source rather than from a hand-kept list. Until then
 * a static contract carries the weight: `_openWhenAudienceAllows` must FORWARD its declared
 * audience to the rule rather than hardcode one, which is the shape the gap would otherwise hide.
 */

// NOTE for the next notice: `CONFIG` (for a `*_NOTICE_DAYS` expiry) and `isNoticeExpired` were
// imported here until v23.23 and went with `sign-in-2026` — the day-count expiry was its, and the
// one notice left uses a hard clock cutoff instead. A notice using the ordinary expiry brings both
// back; `.claude/skills/new-notice/` has the template.
import { lsGet, lsSet } from './ls.js';
import { archiveNotice } from './nav-panel.js';
import { createLightbox, openNoticeIfClear } from './overlay.js';
import { calendarAccessReady, getAccessType } from './calendar-access.js';
import { noticeAudienceAllows } from './calendar-access-core.js';

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
 * @param {{ open: () => void }} lb
 * @param {'members'|'signed-out'|'everyone'} audience
 */
function _openWhenAudienceAllows(lb, audience) {
    // Access first, then whatever the coordinator asked us to queue behind (v23.21: the forced
    // set-password overlay a front-door sign-in may put up — see calendar-app.js). `_after` never
    // rejects and never hangs (the coordinator bounds it), so this cannot silence a notice.
    calendarAccessReady.then(() => _after).then(() => {
        if (!noticeAudienceAllows(audience, getAccessType())) return;
        setTimeout(() => openNoticeIfClear(lb), 1500);
    });
}

/** What every notice waits for after access — set once by `initCalendarNotices`. @type {Promise<any>} */
let _after = Promise.resolve();

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
    // ── One-shot notice: back pay arrives on the 28 Aug 2026 payslip (v21.61) ───────────────────────
    //
    // The 3.6% award steps on that payslip together with the arrears to April, so the week before it
    // is the one window where preparing the Pay Calculator pays off: either every period since April
    // entered correctly, or the Year to Date Figures + Pay Rise Back Pay cards estimating from less —
    // and this month's hours entered either way, or the current-month figure is a guess.
    //
    // A HARD cutoff rather than the day-count expiry the other notices use: at 23:00 on the eve of the
    // payslip the notice stops being a reminder and becomes noise about a document that arrives in the
    // morning, so it dies at a clock time, not after N days. Past the cutoff a device that never saw
    // it marks it done silently — same silent-retire shape as isNoticeExpired, sharper deadline.
    (function () {
        const NOTICE_ID   = 'backpay-2026';
        const NOTICE_DATE = '21 Aug 2026';
        const DONE_KEY    = 'myb_notice_backpay_2026_done';
        // Thu 27 Aug 2026 23:00 LOCAL — the eve of the payslip (owner-specified).
        const CUTOFF_MS   = new Date(2026, 7, 27, 23, 0).getTime();

        const overlay = document.getElementById('bpNoticeLb');
        if (!overlay) return;
        if (lsGet(DONE_KEY)) return;
        if (Date.now() > CUTOFF_MS) { lsSet(DONE_KEY, '1'); return; }

        const lb = createLightbox({
            overlay,
            content:  /** @type {HTMLElement} */ (document.getElementById('bpNoticeContent')),
            closeBtn: /** @type {HTMLElement} */ (document.getElementById('bpNoticeClose')),
            // Archive on OPEN — there is a CTA, so the member may leave for the calculator and never
            // fire onClose. archiveNotice is idempotent.
            onOpen() {
                archiveNotice({
                    id: NOTICE_ID, title: 'Back pay arrives 28 August', section: 'Pay',
                    date: NOTICE_DATE,
                    body: 'The 28 August payslip brings the new pay rates plus back pay to April. Check your '
                        + 'payslips since April are entered correctly, or use the Year to Date Figures and '
                        + 'Pay Rise Back Pay cards for an estimate — and enter this month\'s hours for a '
                        + 'reliable picture of this month\'s pay.',
                });
            },
            // ONE-SHOT (owner-specified): any dismissal is final. No snooze — the notice's whole life
            // is six days, so a 7-day snooze would be a wordier way of writing "never".
            onClose() { lsSet(DONE_KEY, '1'); },
        });

        document.getElementById('bpNoticeGo')?.addEventListener('click', () => lsSet(DONE_KEY, '1'));
        document.getElementById('bpNoticeLater')?.addEventListener('click', () => lb.close());

        // 'members' — the default, and this notice is why it is the default (v21.81). It asks the
        // reader to check their own payslips are entered and to open the Pay Calculator, which is
        // per-device, per-member data: on the shared station PC it addresses nobody and offers a
        // calculator holding somebody else's figures. A signed-in member gets it; a PIN unlock does
        // not, and is not flagged seen, so it still arrives when that device signs in.
        _openWhenAudienceAllows(lb, 'members');
    }());
}
