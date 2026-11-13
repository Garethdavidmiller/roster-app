// @ts-check
/**
 * operations-reset.js — what Operations → Account status → Reset ASKS, and every sentence it says about the answer.
 *
 * Not the Password Reset Requests card (the queue members file from the sign-in screen): this is the break-glass Reset
 * on each member's row, which puts their password back to the surname default through the `resetMemberPassword`
 * endpoint (functions/auth-endpoints.js). The coordinator (operations-app.js) owns the row's button, the request and
 * the re-read after a reset; this owns the words, and is pure — it imports only fetch-timeout.js — so a reader can
 * check every outcome without a page. The outcomes are driven on the real page by e2e/operations.spec.js.
 *
 * ── THE LOST PHONE (sign-in audit D1/A1, Nov 2026) ─────────────────────────────────────────────────────────────────
 *
 * A reset tells the member on their own devices — "🔑 Password reset — set a new one" (notifications.md). For a phone
 * that has been lost or stolen that notice lands on the lock screen of the very phone, while the sign-in card's hint
 * says the default password is the surname; and the phone goes on receiving the member's notices. So the dialog asks,
 * with a box that starts UNTICKED (`LOST_PHONE`), and a ticked box asks the server for `lostDevice: true`: no notice,
 * and every push record the member owns deleted. The answer says `lostDevice: true` when that ran, with `pushReleased`
 * or `pushReleaseFailed`. An answer WITHOUT it after the box was ticked came from a server that does not know the step
 * yet — minutes, while a deploy lands: the reset happened, the lost-phone step did not, and the admin is told to reset
 * again with the box ticked. No notice was sent means the member was not told, so the admin always is.
 *
 * ── A REPORT BUILT FROM WHAT HAPPENED (v21.86) ─────────────────────────────────────────────────────────────────────
 *
 * The endpoint reports each stage on its own, because the password change is the irreversible one: once it lands the
 * account IS on the surname default, whatever else failed, and telling the admin otherwise invites them to reset again
 * or to tell the member their old password still works. So every message is assembled from the stages the answer
 * reports, never asserted: a sign-out that failed, an account taken back from outside the app (v24.57), a member no
 * notice reached (v23.62 — `notified` is what HAPPENED, so a member with no notifications lands there, which is the
 * point). A sign-out that failed is not left standing either (sign-in audit E2): the password change still ends the
 * other devices' sign-ins when they next renew, within the hour, so the line says that and offers the reset that ends
 * them now — and it no longer hides that the member was not told.
 *
 * ── WHAT A FAILURE MAY CLAIM ───────────────────────────────────────────────────────────────────────────────────────
 *
 *  - A TIMEOUT IS NOT A FAILURE, and fetch-timeout.js's header names this endpoint: the abort stopped the waiting, not
 *    the server. The reset may have landed a second later, so nothing may say it failed, and the button may not offer
 *    Retry — it would describe an outcome nobody knows.
 *  - A REFUSAL (4xx) comes before anything changes, names its reason, and offers no Retry: retrying cannot change it.
 *  - A 503 is the server saying, before it changed anything, that it could not record the reset (no stamp, no reset —
 *    functions-core-2), and its sentence says nothing changed. A 500 carries a sentence too (sign-in audit, Nov 2026):
 *    that it is not known whether the password changed, or that nothing did. Each is shown as written, under a title
 *    that claims neither, beside Retry.
 *  - A body that is MARKUP — an HTML error page from in front of the function — is never shown as a reason.
 */
import { isFetchTimeout, serverRefusal } from './fetch-timeout.js';

/** @typedef {{ title: string, message: string }} ResetNote  a dialog's title and message; the coordinator adds "OK" */

/**
 * The option on the Reset dialog (overlay.js `confirmWithOption`). One line on what ticking it changes, in the order
 * it happens: nothing is sent, notifications stop everywhere, and so the member is told by the admin.
 */
export const LOST_PHONE = Object.freeze({
    label: 'Their phone is lost or stolen',
    hint: 'No reset notice is sent, their notifications stop on every device, and you tell them yourself.',
});

/**
 * The Reset dialog for one member — `confirmWithOption`'s options, the lost-phone box included. The message tracks the
 * FORCED overlay (v21.94): `CONFIG.FORCE_PASSWORD_SET` is on, so a reset member is made to choose a new password at
 * their next sign-in.
 * @param {string} name
 */
export function resetQuestion(name) {
    return {
        title: 'Reset password?',
        message: `Reset ${name}'s password back to their surname default and sign them out of their other devices? Tell them to sign in with their surname — the app will then ask them to choose a new one.`,
        confirmLabel: 'Reset',
        danger: true,
        option: LOST_PHONE,
    };
}

/** Markup, not a sentence: an error page from in front of the function. @param {string} text */
const isMarkup = (text) => /<[a-z!/]/i.test(text);

/**
 * The endpoint's own sentence from a 5xx it answered, or '' when the body is not one (no JSON, no `error`, markup).
 * @param {string} body
 */
function endpointSentence(body) {
    let line;
    try { const parsed = JSON.parse(body.trim()); line = typeof parsed?.error === 'string' ? parsed.error.trim() : ''; } catch { line = ''; }
    return line && !isMarkup(line) ? line : '';
}

/**
 * What the admin is told when the request THREW, and whether the row's button may offer Retry.
 * @param {string} name
 * @param {any} err  what `resetMemberPassword` (firebase-client.js) threw
 * @returns {{ retry: boolean, note: ResetNote|null }}
 */
export function resetFailure(name, err) {
    if (isFetchTimeout(err?.cause)) {
        return { retry: false, note: {
            title: 'Couldn’t confirm the reset',
            message: `The reset for ${name} was sent, but the server didn’t answer in time. It may still have gone through — their password may already be their surname, and their other devices already signed out.\n\nReload this page and check ${name}'s row before resetting again. Resetting again is safe.`,
        } };
    }
    const refused = serverRefusal(err);
    if (refused) {
        return { retry: false, note: { title: 'The reset was refused', message: isMarkup(refused.reason)
            ? `The server answered ${refused.status} without a reason this page can show. Nothing was reset.` : refused.reason } };
    }
    const answered = /^Server responded (50[03]): ([\s\S]*)$/.exec(String(err?.message ?? ''));
    const line = answered ? endpointSentence(answered[2]) : '';
    if (!answered || !line) return { retry: true, note: null };
    return { retry: true, note: { title: answered[1] === '503' ? 'The reset didn’t go through' : 'The reset ran into a problem', message: line } };
}

/**
 * What the admin is told after a reset the server ANSWERED, or null when the row's "Reset ✓" says it all: the password
 * is the surname, the other devices were signed out, and the member was told on their own.
 *
 * The title takes the most pressing stage first: a sign-in that may still be live somewhere; then a lost phone that is
 * still being sent notices; then an account that waits on Set up accounts; then a member to tell.
 * @param {string} name
 * @param {any} result  the endpoint's JSON
 * @param {{ lostDevice?: boolean }} [asked]  what the dialog asked for — `lostDevice` when its box was ticked
 * @returns {ResetNote|null}
 */
export function resetOutcome(name, result, { lostDevice: askedLost = false } = {}) {
    const r = result ?? {};
    const revokeFailed = r.revokeFailed === true;
    const takenBack = r.takenBack === true;
    const lost = r.lostDevice === true;
    const lostSkipped = askedLost && !lost;
    const releaseFailed = lost && r.pushReleaseFailed === true;
    // Nobody told them: no notice reached a device. A lost-phone reset sends none by design and says so in its own words.
    const untold = !takenBack && !lost && r.notified === false;
    if (!revokeFailed && !takenBack && !lost && !lostSkipped && !untold) return null;

    const signedOut = !revokeFailed;
    const parts = [`${name}'s password WAS reset to their surname.`];
    if (revokeFailed) {
        parts.push('Their other devices couldn’t be signed out straight away. The password change still ends those sign-ins when they next renew, within the hour — reset again to sign them out now.');
    } else {
        parts.push(lost ? 'They are signed out on every device, the lost phone included.' : 'Their other sessions were signed out.');
    }
    if (takenBack) {
        parts.push(`This account had been registered outside the app, so it was taken back: anyone signed in on it was signed out. Run Set up accounts next — until then ${name} cannot use the app on it. Then let them know their password is their surname.`);
    }
    if (lost) {
        parts.push(releaseFailed
            ? 'Their notifications COULDN’T be switched off, so the lost phone may still show them. Reset again with the box ticked to switch them off.'
            : 'Their notifications are now off on every device, so the lost phone shows nothing more from this app.');
        parts.push(`No reset notice was sent. Tell ${name} yourself: their password is now their surname${signedOut ? ', they are signed out,' : ''} and the app asks for a new one when they sign in.`);
        // A reset puts the account on the surname, which the sign-in card's hint names, so until the member chooses a new
        // password whoever holds the phone can type it there too. Said, so the admin asks them to sign in promptly.
        parts.push(`Until ${name} chooses a new password, their surname signs in to their account — on the lost phone too — so ask them to sign in on another device and choose one as soon as they can.`);
    }
    if (lostSkipped) {
        parts.push(r.notified === true
            ? 'The lost-phone step DIDN’T run, so their notifications are still on, and the usual reset notice went to their devices — the lost phone may show it. Reset again with the box ticked.'
            : 'The lost-phone step DIDN’T run. Reset again with the box ticked.');
    }
    if (untold) {
        parts.push(`${name} has no notifications on this app, so they have NOT been told. Let them know their password is now their surname${signedOut ? ' and they are signed out' : ''}.`);
    }
    parts.push('Resetting again is safe.');
    return {
        title: revokeFailed ? 'Password reset — other devices not signed out yet'
             : lostSkipped  ? 'Password reset — the lost-phone step didn’t run'
             : releaseFailed ? 'Password reset — notifications still on'
             : takenBack    ? 'Account taken back — run Set up accounts'
             :                'Password reset — tell them yourself',
        message: parts.join('\n\n'),
    };
}
