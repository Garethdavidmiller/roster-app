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
 * `'members'`, and `'everyone'` is for a notice whose audience is specifically people who have not
 * signed in. Open through `_openWhenAudienceAllows` rather than wiring the check per notice, so a
 * notice added later cannot quietly skip it.
 */

import { CONFIG } from './roster-data.js';
import { lsGet, lsSet } from './ls.js';
import { NOTICE_PW_OWN_DONE } from './storage-keys.js';
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
 * @param {'members'|'everyone'} audience
 */
function _openWhenAudienceAllows(lb, audience) {
    calendarAccessReady.then(() => {
        if (!noticeAudienceAllows(audience, getAccessType())) return;
        setTimeout(() => openNoticeIfClear(lb), 1500);
    });
}

/** Wire every one-time notice this page carries. Called once from calendar-app.js. */
export function initCalendarNotices() {
    // Each notice keeps its own IIFE ON PURPOSE: their bodies bail with early `return`s (done,
    // snoozed, expired), and as plain blocks those returns leave THIS function — so the first
    // notice already dismissed silenced every notice after it. Caught by a render check the same
    // hour it was written; the wrapper is the scope those returns need.
    // ── One-time notice: set your own password (v19.89, PASSWORD_PLAN.md Track C) ────────────────────
    //
    // WHO THIS IS FOR, because it is not who you would assume. `password-force.js` already COMPELS any
    // member still on the surname default to choose their own at their next sign-in, and sessions cap at
    // 60 days, so everyone who signs in is handled without a notice. The people it cannot reach are the
    // ones who only ever read the roster and so never sign in anywhere — CLAUDE.md records exactly that
    // as an accepted gap. This notice exists for them, on the one page they do open.
    //
    // So its real ask is "sign in"; setting a password is the reason to. That is also why it does NOT
    // carry the skill template's `if (!getSession()) return` guard — copying that in would hide the
    // notice from its entire target audience, which is everyone WITHOUT a session.
    //
    // It must also stay true for someone who has ALREADY set their own password: the calendar holds no
    // named session, so it cannot read `passwordStatus` and genuinely does not know. Hence "everyone
    // started with…" rather than "your password is…".
    (function () {
        const NOTICE_ID   = 'pw-own-2026';
        const NOTICE_DATE = '6 Aug 2026';
        // The DONE key is shared with settings-app.js, which is the only page that can read
        // `passwordStatus` and therefore the only one that can know the notice has been satisfied — so
        // it is declared once in storage-keys.js rather than spelled out in both files (v19.91).
        const DONE_KEY    = NOTICE_PW_OWN_DONE;
        const SNOOZE_KEY  = 'myb_notice_pw_own_2026_snooze';

        const overlay = document.getElementById('pwNoticeLb');
        if (!overlay) return;
        if (lsGet(DONE_KEY)) return;
        const snooze = lsGet(SNOOZE_KEY);
        if (snooze && Date.now() < new Date(snooze).getTime()) return;
        // Longer than the 28-day default: this is a migration that runs until C5 retires the surname
        // default (gated on ~90% migrated), not an announcement whose news value decays. The window is a
        // configurable BACKSTOP with a review date — see CONFIG.PASSWORD_NOTICE_DAYS for why it must not
        // be hardwired here, and what to do when it comes round.
        if (isNoticeExpired(NOTICE_DATE, CONFIG.PASSWORD_NOTICE_DAYS)) { lsSet(DONE_KEY, '1'); return; }

        const _snoozeFor = (/** @type {number} */ days) =>
            lsSet(SNOOZE_KEY, new Date(Date.now() + days * 86_400_000).toISOString());

        const lb = createLightbox({
            overlay,
            content:  /** @type {HTMLElement} */ (document.getElementById('pwNoticeContent')),
            closeBtn: /** @type {HTMLElement} */ (document.getElementById('pwNoticeClose')),
            // Archive on OPEN, not on close: this notice has a CTA, so the member may navigate away to
            // Settings and never fire `onClose`. `archiveNotice` is idempotent.
            onOpen() {
                archiveNotice({
                    id: NOTICE_ID, title: 'Set your own password', section: 'Settings',
                    date: NOTICE_DATE,
                    body: 'Everyone started with their surname as their password, which anyone who knows your name can guess. '
                        + 'Set your own in Settings → Password. You will be asked to sign in first if it has been a while.',
                });
            },
            onClose() { _snoozeFor(7); },
        });

        document.getElementById('pwNoticeGo')?.addEventListener('click', () => _snoozeFor(1));
        document.getElementById('pwNoticeLater')?.addEventListener('click', () => lb.close());

        // 'everyone' — the ONE notice that must survive the audience default (v21.81). Its readers
        // are the members who never sign in, and since v20.12 those members reach the Calendar
        // through the staff PIN, so `'members'` would hide it from precisely the people it was
        // written for. That is the same trap as the skill template's `if (!getSession()) return`,
        // which this notice also does not carry, for the same reason.
        _openWhenAudienceAllows(lb, 'everyone');
    }());

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
