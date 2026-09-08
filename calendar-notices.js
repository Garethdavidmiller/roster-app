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
 * ── ONE NOTICE LIVE, AND WHAT THAT COSTS THE GUARD (v23.23; the notice changed at v23.31) ────────
 *
 * `sign-in-2026` was retired here by owner decision, not by its expiry. v23.19 made the Calendar's
 * front door a sign-in card, so its whole audience — somebody reading the roster on the staff PIN —
 * has now SEEN that card and chosen the PIN instead, and the notice spent its life re-offering a
 * choice the reader had just declined a moment earlier. `backpay-2026` followed at v23.31, deleted
 * once its hard cutoff had passed rather than left inert until the 180-day sweep.
 *
 * That leaves `al-booking-2026` alone, and it is `'members'` — so **no live notice addresses the
 * signed-out audience**, and the positive direction of the audience gate has nothing to exercise
 * it. `calendar-notices.test.mjs` can still prove a notice is REFUSED to the wrong audience and
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
    // ── Reminder: book the rest of your 2026 annual leave (v23.31, owner request) ──────────────────
    //
    // The leave year is the calendar year, and leave still unbooked late in it can have dates
    // allocated for the member. The reminder therefore has to REACH people, so it follows the
    // skill's actionable pattern rather than the back-pay notice's one-shot: any dismissal snoozes
    // it 7 days, taking the CTA snoozes it 1 day, and it retires 90 days after posting (~7 Dec
    // 2026), by which point the year's leave is settled one way or the other. There is no permanent
    // "done": one booking does not mean the remaining days are booked, and the Admin page would have
    // to reach across into a Calendar notice's key to say so — the coupling `storage-keys.js`
    // records ending at v21.84. Archived on OPEN because there is a CTA (the member may leave before
    // onClose fires).
    (function () {
        const NOTICE_ID   = 'al-booking-2026';
        const NOTICE_DATE = '8 Sep 2026';
        const DONE_KEY    = 'myb_notice_al_booking_2026_done';
        const SNOOZE_KEY  = 'myb_notice_al_booking_2026_snooze';

        const overlay = document.getElementById('alNoticeLb');
        if (!overlay) return;
        if (lsGet(DONE_KEY)) return;
        const snooze = lsGet(SNOOZE_KEY);
        if (snooze && Date.now() < new Date(snooze).getTime()) return;
        // Long expiry — a seasonal reminder that stays relevant for months, not a launch nudge.
        if (isNoticeExpired(NOTICE_DATE, 90)) { lsSet(DONE_KEY, '1'); return; }

        /** @param {number} days */
        const _snooze = days => lsSet(SNOOZE_KEY, new Date(Date.now() + days * 86_400_000).toISOString());

        const lb = createLightbox({
            overlay,
            content:  /** @type {HTMLElement} */ (document.getElementById('alNoticeContent')),
            closeBtn: /** @type {HTMLElement} */ (document.getElementById('alNoticeClose')),
            onOpen() {
                archiveNotice({
                    id: NOTICE_ID, title: 'Book your remaining 2026 leave', section: 'Calendar',
                    date: NOTICE_DATE,
                    body: 'Only a few months of the 2026 leave year are left. Book any annual leave you still '
                        + 'have soon — leave left unbooked later in the year may have dates allocated for you.',
                });
            },
            onClose() { _snooze(7); },
        });

        document.getElementById('alNoticeGo')?.addEventListener('click', () => _snooze(1));
        document.getElementById('alNoticeLater')?.addEventListener('click', () => lb.close());

        // 'members' — it is about YOUR remaining leave and it opens the Admin page's booking card
        // for you; on the PIN-unlocked station PC it addresses nobody. A PIN unlock is not flagged
        // seen, so the notice still arrives when that device is next signed in.
        _openWhenAudienceAllows(lb, 'members');
    }());
}
