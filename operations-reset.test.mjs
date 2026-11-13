/**
 * operations-reset.test.mjs — every sentence Operations → Account status → Reset says, held to what the
 * server's answer reports (operations-reset.js). The page drives these through the real button in
 * e2e/operations.spec.js; this holds the RULES on their own, every combination of stages, fast, in the
 * no-install lane — so a sentence that claims more than the answer said fails here first.
 *
 * The rules (the module header has the reasoning):
 *  - a timeout is not a failure: no Retry, and nothing may say the reset failed;
 *  - a refusal (4xx) names its reason and offers no Retry; markup is never shown as a reason;
 *  - a 503 or 500 the endpoint answered in a sentence is shown as written, beside Retry;
 *  - an answered reset is reported from its stages, and a ticked lost-phone box an older server ignored
 *    is said, never assumed to have run.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetQuestion, resetFailure, resetOutcome, LOST_PHONE } from './operations-reset.js';
import { FETCH_TIMEOUT_CODE } from './fetch-timeout.js';

const NAME = 'A. Member';
const LANDED = Object.freeze({ success: true, revoked: true, stamped: true, notified: true });
/** What firebase-client.js's resetMemberPassword throws for a non-2xx answer. */
const answered = (/** @type {number} */ status, /** @type {string} */ body) => new Error(`Server responded ${status}: ${body}`);

test('the question asks about a lost phone with a box that names what ticking it changes', () => {
    const q = resetQuestion(NAME);
    assert.equal(q.title, 'Reset password?');
    assert.equal(q.confirmLabel, 'Reset');
    assert.equal(q.danger, true);
    assert.ok(q.message.includes(`Reset ${NAME}'s password back to their surname default`));
    assert.equal(q.option, LOST_PHONE, 'the dialog carries the one lost-phone option');
    assert.equal(LOST_PHONE.label, 'Their phone is lost or stolen');
    assert.match(LOST_PHONE.hint, /No reset notice is sent/);
    assert.match(LOST_PHONE.hint, /you tell them yourself/);
});

test('a timeout offers no Retry and never says the reset failed', () => {
    const err = new Error('The reset was sent, but the server did not answer in time');
    /** @type {any} */ (err).cause = Object.assign(new Error('timeout'), { code: FETCH_TIMEOUT_CODE });
    const { retry, note } = resetFailure(NAME, err);
    assert.equal(retry, false, 'a Retry would describe an outcome nobody knows');
    assert.equal(note?.title, 'Couldn’t confirm the reset');
    assert.match(note?.message ?? '', /may still have gone through/);
    assert.doesNotMatch(note?.message ?? '', /failed/i);
});

test('a refusal names its reason and offers no Retry; markup is never shown as a reason', () => {
    const refused = resetFailure(NAME, answered(409, JSON.stringify({ error: 'Firebase refused the new password. Nothing was changed.' })));
    assert.equal(refused.retry, false);
    assert.deepEqual(refused.note, { title: 'The reset was refused', message: 'Firebase refused the new password. Nothing was changed.' });

    const page = resetFailure(NAME, answered(404, '<!doctype html><title>Not Found</title>'));
    assert.equal(page.retry, false);
    assert.equal(page.note?.message, 'The server answered 404 without a reason this page can show. Nothing was reset.');
});

test('a 503 and a 500 answered in a sentence are shown as written, beside Retry', () => {
    const unrecorded = resetFailure(NAME, answered(503, JSON.stringify({ error: 'Could not record the reset, so nothing was changed — try again' })));
    assert.equal(unrecorded.retry, true);
    assert.deepEqual(unrecorded.note, { title: 'The reset didn’t go through', message: 'Could not record the reset, so nothing was changed — try again' });

    // The server's "unknown outcome" (sign-in audit E1): the stamp was kept, and resetting again is safe.
    const unknown = `It isn't known whether ${NAME}'s password changed: Firebase did not confirm it. Resetting again is safe.`;
    const fivehundred = resetFailure(NAME, answered(500, JSON.stringify({ error: unknown })));
    assert.equal(fivehundred.retry, true);
    assert.equal(fivehundred.note?.title, 'The reset ran into a problem', 'a title that claims neither outcome');
    assert.equal(fivehundred.note?.message, unknown);
});

test('a 5xx with no sentence, or a network failure, is a bare Retry with nothing to say', () => {
    for (const err of [
        answered(500, '<html><body>Internal error</body></html>'),
        answered(500, JSON.stringify({ error: '<b>broken</b>' })),
        answered(502, JSON.stringify({ error: 'Bad gateway' })),   // not one the endpoint writes
        answered(500, 'not json'),
        new TypeError('Failed to fetch'),
    ]) {
        assert.deepEqual(resetFailure(NAME, err), { retry: true, note: null }, String(err.message));
    }
});

test('a reset that did everything says nothing more than the row', () => {
    assert.equal(resetOutcome(NAME, LANDED), null);
    assert.equal(resetOutcome(NAME, undefined), null, 'an empty answer claims nothing');
});

test('a member nobody told is the admin\'s errand, whether or not the sign-out worked (E2)', () => {
    const untold = resetOutcome(NAME, { ...LANDED, notified: false });
    assert.equal(untold?.title, 'Password reset — tell them yourself');
    assert.match(untold?.message ?? '', /has no notifications on this app, so they have NOT been told/);
    assert.match(untold?.message ?? '', /their password is now their surname and they are signed out\./);
    assert.match(untold?.message ?? '', /Their other sessions were signed out\./);
    assert.doesNotMatch(untold?.message ?? '', /lost phone/, 'an ordinary reset never speaks of a lost phone');

    const both = resetOutcome(NAME, { ...LANDED, revoked: false, revokeFailed: true, notified: false });
    assert.equal(both?.title, 'Password reset — other devices not signed out yet', 'the live sign-in leads');
    assert.match(both?.message ?? '', /when they next renew, within the hour/);
    assert.match(both?.message ?? '', /they have NOT been told/, 'and the untold member is no longer hidden');
    assert.doesNotMatch(both?.message ?? '', /and they are signed out/, 'never claims a sign-out that failed');
});

test('a lost-phone reset says what it did, that nobody was told, and that the surname works until a new password', () => {
    const lost = resetOutcome(NAME, { ...LANDED, notified: false, lostDevice: true, pushReleased: 2 }, { lostDevice: true });
    assert.equal(lost?.title, 'Password reset — tell them yourself');
    const m = lost?.message ?? '';
    assert.match(m, /signed out on every device, the lost phone included/);
    assert.match(m, /notifications are now off on every device/);
    assert.match(m, new RegExp(`No reset notice was sent\\. Tell ${NAME.replace('.', '\\.')} yourself`));
    assert.match(m, /their surname signs in to their account — on the lost phone too/);
    assert.doesNotMatch(m, /has no notifications on this app/, 'the lost-phone reset says it in its own words');
});

test('a lost-phone reset whose notifications could not be switched off says so', () => {
    const failed = resetOutcome(NAME, { ...LANDED, notified: false, lostDevice: true, pushReleaseFailed: true }, { lostDevice: true });
    assert.equal(failed?.title, 'Password reset — notifications still on');
    assert.match(failed?.message ?? '', /COULDN’T be switched off/);
    assert.match(failed?.message ?? '', /Reset again with the box ticked/);
    assert.doesNotMatch(failed?.message ?? '', /notifications are now off/);
});

test('a ticked box an older server ignored is said, never assumed to have run', () => {
    const toldAnyway = resetOutcome(NAME, LANDED, { lostDevice: true });
    assert.equal(toldAnyway?.title, 'Password reset — the lost-phone step didn’t run');
    assert.match(toldAnyway?.message ?? '', /the usual reset notice went to their devices/);
    assert.doesNotMatch(toldAnyway?.message ?? '', /No reset notice was sent/);

    const untold = resetOutcome(NAME, { ...LANDED, notified: false }, { lostDevice: true });
    assert.match(untold?.message ?? '', /The lost-phone step DIDN’T run\. Reset again with the box ticked\./);
    assert.match(untold?.message ?? '', /they have NOT been told/);

    assert.equal(resetOutcome(NAME, LANDED, { lostDevice: false }), null, 'an unticked box expects nothing more');
});

test('an account taken back waits on Set up accounts, and is never also called untold', () => {
    const back = resetOutcome(NAME, { ...LANDED, notified: false, takenBack: true });
    assert.equal(back?.title, 'Account taken back — run Set up accounts');
    assert.match(back?.message ?? '', /Run Set up accounts next/);
    assert.doesNotMatch(back?.message ?? '', /has no notifications/, 'the outsider\'s devices were never the member\'s');

    const lostToo = resetOutcome(NAME, { ...LANDED, notified: false, takenBack: true, lostDevice: true, pushReleased: 0 }, { lostDevice: true });
    assert.equal(lostToo?.title, 'Account taken back — run Set up accounts');
    assert.match(lostToo?.message ?? '', /No reset notice was sent/);
});

test('a lost-phone reset whose sign-out failed never says they are signed out', () => {
    const r = resetOutcome(NAME, { ...LANDED, revoked: false, revokeFailed: true, notified: false, lostDevice: true, pushReleased: 1 }, { lostDevice: true });
    assert.equal(r?.title, 'Password reset — other devices not signed out yet');
    assert.doesNotMatch(r?.message ?? '', /the lost phone included/);
    assert.doesNotMatch(r?.message ?? '', /, they are signed out,/);
    assert.match(r?.message ?? '', /their password is now their surname and the app asks for a new one/);
});
