'use strict';

/**
 * functions/pin-lockout.js — the staff-PIN throttle store's upkeep, and telling the admin when the
 * station-wide block trips (owner, Nov 2026).
 *
 * `unlockCalendarViewer` stays in index.js (calendar-viewer-parity.test.mjs pins its handler there);
 * what it does with the `viewerAttempts` collection AFTER a wrong PIN lives here, so the handler reads
 * as the five rules its header lists and the composition root keeps its room. The RULES are all in
 * ./calendar-viewer-auth.js, pure and tested there: which rows are stale (`isThrottleStateStale`),
 * what a new block does to the record and whether the admin is told (`noteGlobalBlock`), what
 * Operations is shown (`lockoutSummary`) and the notice's words (`lockoutNoticeWords`). This file
 * reads, writes and sends.
 *
 * ── EVERYTHING HERE IS BEST-EFFORT, AND NOTHING HERE MAY CHANGE THE ANSWER ───────────────────────
 *
 * Each function runs after the wrong PIN has been charged and before the 401 goes back. None throws,
 * and the sweep and the notice are both time-boxed: an outage of the push service, a record that cannot
 * be written, or a collection read that stalls must never turn "PIN not recognised" into a 500 or the
 * platform's timeout — that would tell a script something the 401 does not, and leave a member at a
 * station PC with the wrong message. What it can cost is the sweep or the notice, never the door.
 *
 * ── THE RECORD: viewerAttempts/_lockout-record ───────────────────────────────────────────────────
 *
 *   blocks        the start of every station-wide block in the last day (epoch ms)
 *   blockedUntil  the end of the latest block (epoch ms)
 *   alertedAt     when the admin was last sent a notice (epoch ms): at most one a day
 *
 * In `viewerAttempts`, beside the throttle rows, so the rule that already closes that collection to
 * every client in both directions closes this too — no rules change came with it. A source key is never
 * stored here: the record says WHEN and HOW OFTEN, never from where.
 */

const { buildPushPayload } = require('./push-notices');
const { setupWebPush, sendTargetedPush } = require('./push');
const { enabledAdminUids } = require('./admin-recipients');
const {
    GLOBAL_SOURCE_KEY,
    LOCKOUT_RECORD_KEY,
    throttleDecision,
    isThrottleStateStale,
    noteGlobalBlock,
    lockoutSummary,
    lockoutNoticeWords,
} = require('./calendar-viewer-auth');

/** How long the record and the admin's notice together may hold up the 401. */
const LOCKOUT_NOTICE_BUDGET_MS = 6_000;
/** Each push's own bound, inside that budget (the reset request's reasoning, ./reset-request.js). */
const LOCKOUT_SEND_TIMEOUT_MS = 4_000;
/** How long the sweep may hold up the 401. With the notice's budget it stays well inside the
 *  endpoint's 20-second limit, which a stalled read used to run into, answering a wrong PIN with a 5xx. */
const SWEEP_BUDGET_MS = 3_000;

/** `firebase-admin/firestore` at CALL time, so a test's fake in `require.cache` is the one asked. */
const db = () => require('firebase-admin/firestore').getFirestore();
const attempts = () => db().collection('viewerAttempts');

/**
 * Delete throttle rows that have aged out (v20.15 — the opportunistic sweep, moved here whole from
 * index.js). On the FAILURE path only, so the correct-PIN path pays for no collection read. The lockout
 * record is not a throttle row and is never swept. Never throws; bounded by `budgetMs` — a sweep given
 * up on finishes on its own, or not, and the next wrong PIN sweeps again.
 * @param {number} now  epoch ms
 * @param {{ budgetMs?: number }} [o]
 * @returns {Promise<void>}
 */
async function sweepExpiredThrottleRows(now, { budgetMs = SWEEP_BUDGET_MS } = {}) {
    /** @type {ReturnType<typeof setTimeout>|undefined} */ let timer;
    const work = (async () => {
        const old = await attempts().limit(50).get();
        const dead = old.docs.filter(d => d.id !== LOCKOUT_RECORD_KEY && isThrottleStateStale(d.data(), now));
        if (dead.length) {
            const batch = db().batch();
            dead.forEach(d => batch.delete(d.ref));
            await batch.commit();
            console.log('[unlockCalendarViewer] swept', dead.length, 'expired throttle rows');
        }
    })();
    try {
        await Promise.race([work, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timed out')), budgetMs); })]);
    } catch (e) {
        console.warn('[unlockCalendarViewer] throttle sweep failed:', e && (e.code || e.message));
    } finally {
        clearTimeout(timer);
    }
    work.catch(() => {});   // a loser of the race must not surface as an unhandled rejection
}

/**
 * The function that tells the admin, built once with the push keys and the server-owned admin names.
 * @param {{ VAPID_PRIVATE_KEY: any, VAPID_PUBLIC_KEY: string, STAFF_SITE_URL: string, adminNames: string[]|undefined }} deps
 * @returns {(blockedUntil: number) => Promise<number>}  how many devices accepted the notice
 */
function buildPinLockoutNotifier({ VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, STAFF_SITE_URL, adminNames }) {
    return async function notifyAdminOfPinLockout(blockedUntil) {
        const uids = await enabledAdminUids(adminNames, '[pinLockout]');
        if (uids.length === 0) return 0;   // sendTargetedPush would refuse anyway; skip the VAPID setup
        setupWebPush(VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY);
        const { headline, body } = lockoutNoticeWords({ blockedUntil });
        return sendTargetedPush(buildPushPayload({
            feature: 'pinLockout',
            headline,
            body,
            url: `${STAFF_SITE_URL}/operations.html#login-accounts`,
        }), uids, '[pinLockout]', { timeoutMs: LOCKOUT_SEND_TIMEOUT_MS });
    };
}

/**
 * Record a station-wide block that THIS wrong PIN imposed, and tell the admin if no notice has gone
 * in the last day. The record and the decision are one transaction, so two instances that trip the
 * block a moment apart cannot both ring the phone. Never throws; bounded by LOCKOUT_NOTICE_BUDGET_MS.
 *
 * **The block may already have gone, and then nothing is recorded or sent.** A right PIN is charged
 * before its compare and refunded after it, and its refund takes a block back with the charge when
 * the failures left would not have tripped it (`refundAttempt`). So a right PIN charged a moment
 * before the wrong one that reached the limit can open the door again behind it: 199 wrong entries,
 * not 200, and a notice and an Operations strip about a block nobody meets. The all-sources row IS
 * the door, so the transaction reads it beside the record, and records nothing unless the door is
 * still shut (`throttleDecision`). A refund that lands after this transaction cannot take the notice
 * back; the strip then shows a block until the end it named — the safe direction, and the rarer order,
 * since the sweep runs first.
 * @param {{ now: number, blockedUntil: number, notify: (blockedUntil: number) => Promise<number>, budgetMs?: number }} o
 * @returns {Promise<{ recorded: boolean, alert: boolean, accepted: number }>}
 */
async function noteStationBlock({ now, blockedUntil, notify, budgetMs = LOCKOUT_NOTICE_BUDGET_MS }) {
    const outcome = { recorded: false, alert: false, accepted: 0 };
    /** @type {ReturnType<typeof setTimeout>|undefined} */ let timer;
    const work = (async () => {
        const ref = attempts().doc(LOCKOUT_RECORD_KEY);
        const doorRef = attempts().doc(GLOBAL_SOURCE_KEY);
        const told = await db().runTransaction(async tx => {
            // Every read before any write, as Firestore requires.
            const [snap, door] = await Promise.all([tx.get(ref), tx.get(doorRef)]);
            if (throttleDecision(door.exists ? door.data() : null, now).allowed) return null;
            const { next, alert } = noteGlobalBlock(snap.exists ? snap.data() : null, now, blockedUntil);
            tx.set(ref, next);
            return alert;
        });
        if (told === null) {
            console.warn('[unlockCalendarViewer] the station-wide block was lifted before it was recorded (a right PIN\'s refund took its charge back) — nothing recorded, nobody told');
            return;
        }
        outcome.alert = told;
        outcome.recorded = true;
        console.warn('[unlockCalendarViewer] the station-wide block was tripped; the admin',
            outcome.alert ? 'is told' : 'was already told today');
        if (outcome.alert) outcome.accepted = await notify(blockedUntil);
    })();
    try {
        await Promise.race([work, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timed out')), budgetMs); })]);
    } catch (e) {
        console.warn('[unlockCalendarViewer] the lockout record or notice failed:', e && (e.code || e.message));
    } finally {
        clearTimeout(timer);
    }
    work.catch(() => {});   // a loser of the race must not surface as an unhandled rejection
    return outcome;
}

/**
 * What Operations is shown about the PIN door: `lockoutSummary` of the stored record — `null` when
 * there is nothing to say. Throws on a failed read; the caller decides what a failure means.
 * @param {number} now  epoch ms
 * @returns {Promise<ReturnType<typeof lockoutSummary>>}
 */
async function readPinLockout(now) {
    const snap = await attempts().doc(LOCKOUT_RECORD_KEY).get();
    return lockoutSummary(snap.exists ? snap.data() : null, now);
}

module.exports = {
    LOCKOUT_NOTICE_BUDGET_MS,
    SWEEP_BUDGET_MS,
    sweepExpiredThrottleRows,
    buildPinLockoutNotifier,
    noteStationBlock,
    readPinLockout,
};
