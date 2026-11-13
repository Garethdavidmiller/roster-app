'use strict';

/**
 * functions/push-notices.js — the push notification DESIGN LANGUAGE: the table of notifying features and
 * the one builder every Web Push payload goes through (`.claude/rules/notifications.md`).
 *
 * MOVED HERE WHOLE from roster-parse-helpers.js at v26.04, when that file reached its 1,400-line cap with
 * the Error Log notification's row still to add. A SPLIT, not an extraction: a notification's emoji and
 * words have nothing to do with reading a roster, and the file was doing both jobs. Nothing in it changed
 * in the move but the new row. roster-parse-helpers.js RE-EXPORTS both names, so every sender that
 * imports them from there is untouched; a new sender imports them from here.
 *
 * Pure: no Firebase, no secrets. Tested in roster-parse-helpers.test.mjs (through the re-export) and by
 * every handler test that sends a push.
 */

// ── Push notification design language ─────────────────────────────────────────
// Single source of truth for Web Push payloads. See .claude/rules/notifications.md.
// The leading emoji MUST match the feature's in-app icon (nav drawer / card) so a
// notification visibly belongs to its part of the app. Adding a notifying feature =
// one entry here + build via buildPushPayload (never a hand-written literal).

const NOTIFICATION_FEATURES = {
    // Document arrivals — title "<emoji> Latest <Doc>". "Latest" (not "Today's") because
    // a document is republished regularly and the Huddle is the next-day plan sent the
    // evening before, so day-relative words are inaccurate by the time it is read.
    huddle:     { emoji: '📋',  tag: 'huddle',       defaultHeadline: 'Latest Huddle',                 hashPath: '/#huddle' },
    circular:   { emoji: '📰',  tag: 'circular',     defaultHeadline: 'Latest Retail Circular',        hashPath: '/#circular' },
    newsletter: { emoji: '🗞️', tag: 'newsletter',   defaultHeadline: 'Latest Marylebone Newsletter',  hashPath: '/#newsletter' },
    // Event reminder — title "<emoji> <Event> — <urgency>"; caller passes headline + url.
    pay:        { emoji: '💷',  tag: 'pay-reminder' },
    // Targeted-only (v21.47) — every send goes through sendTargetedPush to the members a window
    // actually ASKED (the asked notice) or the participants still silent on the deadline's morning
    // (the reminder). Never fanOutPush: during the restricted beta a broadcast would ping ~50 staff
    // about a restricted beta, and at full launch "targeted to participants" IS everyone eligible,
    // so the reach scales itself with no code change. ⏱️ is the Overtime nav pill / page badge.
    // Event grammar — headline + url come from the caller (overtime-core's pure notice builders).
    overtime:   { emoji: '⏱️', tag: 'overtime' },
    // Admin-only (v18.95). 🙋 is the Operations "Password Reset Requests" card's own emoji.
    // The ONE stable tag is load-bearing here rather than merely conventional: a second request
    // REPLACES the first in the Notification Centre, so the headline carries the queue DEPTH
    // ("2 waiting") and each new request refreshes it. Stacking would leave the admin counting
    // notifications to learn what one glance now tells them.
    resetRequest: { emoji: '🙋', tag: 'reset-request' },
    // Targeted-only (v23.62) — to the ONE member whose password was just reset, on their OWN
    // devices. The audience rule here is the CONTENT's, exactly as it is for resetRequest above:
    // this names a person and says their credential changed, so `.claude/rules/notifications.md`'s
    // test ("would I be happy for all 50 staff to read this?") answers itself. 🔑 is the Settings
    // "Password" card's own emoji, and that card is where the tap lands.
    //
    // It carries a DEFAULT HEADLINE, unlike the other event features, because it only ever says one
    // thing — there is no count and no deadline to compose. Keeping the wording here rather than at
    // the call site puts it in the file the notification rules already point at, where the emoji,
    // the tag and the budgets are enforced together.
    passwordReset: { emoji: '🔑', tag: 'password-reset', defaultHeadline: 'Password reset — set a new one', hashPath: '/settings.html' },
    // A broadcast, ONCE (v24.94): the evening before Chiltern's timetable change, every subscribed
    // device is told and the tap lands on the Trains page. 🚆 is the Trains nav pill. Event grammar
    // with a fixed headline, like passwordReset above: it only ever says one thing. Sent by
    // sendTimetableReminder (documents.js), which is guarded to the one date.
    timetable:  { emoji: '🚆', tag: 'timetable', defaultHeadline: 'New timetable from Sunday', hashPath: '/trains.html' },
    // Admin-only (v26.04) — to the admin's devices, as resetRequest above is, because the Error Log is
    // the admin's to read. 🐛 is the Error Log's own emoji, on the Operations "Needs attention" strip.
    // One stable tag, so the newest notice REPLACES the last: its headline counts what has reached the
    // log since the last notice. The words are functions/error-log-notice.js's, never composed at the
    // call; the sender is functions/error-log-notify.js.
    errorLog:   { emoji: '🐛', tag: 'error-log' },
};

/**
 * Build a Web Push payload to the notification design language.
 * Guarantees the leading feature emoji, the per-feature tag, and a deep-link URL.
 *
 * @param {object} opts
 * @param {keyof NOTIFICATION_FEATURES} opts.feature - notification feature key
 * @param {string} opts.body                         - the supporting line (no emoji)
 * @param {string} [opts.baseUrl]                    - origin for the default deep link (document features)
 * @param {string} [opts.headline]                   - override the default headline (required for event features)
 * @param {string} [opts.url]                        - override the default deep link (required for event features)
 * @returns {{title: string, body: string, tag: string, url: string}}
 */
function buildPushPayload({ feature, body, baseUrl, headline, url }) {
    const f = NOTIFICATION_FEATURES[feature];
    if (!f) throw new Error(`Unknown notification feature: ${feature}`);
    const finalHeadline = headline || f.defaultHeadline;
    if (!finalHeadline) throw new Error(`No headline for notification feature: ${feature}`);
    // A hash path needs the origin it hangs from: without one this built "undefined/#huddle" (import-server-8).
    const base = typeof baseUrl === 'string' && baseUrl ? baseUrl : null;
    const finalUrl = url || (f.hashPath && base ? `${base}${f.hashPath}` : undefined);
    if (!finalUrl) throw new Error(`No url for notification feature: ${feature} (an event needs a url, a document a baseUrl)`);
    // Enforce the notification design language's truncation-safe budgets (.claude/rules/notifications.md:
    // title ≤ ~40 chars INCLUDING the emoji, body ≤ ~80) so the builder GUARANTEES a clean fit rather
    // than letting the OS hard-truncate a long caller-supplied headline/body mid-word. All current
    // callers already fit — this is a guard for future ones. A clean … ellipsis on a word boundary
    // where one is near the cut.
    return {
        title: _clipNotifText(`${f.emoji} ${finalHeadline}`, 40),
        body:  _clipNotifText(body, 80),
        tag:   f.tag,
        url:   finalUrl,
    };
}

/**
 * Clip notification text to a maximum length with a trailing ellipsis, preferring a word boundary
 * within the last ~12 chars so the cut doesn't land mid-word. Returns the input unchanged when it
 * already fits.
 * @param {string} s @param {number} max @returns {string}
 */
function _clipNotifText(s, max) {
    if (typeof s !== 'string' || s.length <= max) return s;
    const hard = s.slice(0, max - 1);
    const sp = hard.lastIndexOf(' ');
    return (sp >= max - 12 ? hard.slice(0, sp) : hard).trimEnd() + '…';
}

module.exports = { NOTIFICATION_FEATURES, buildPushPayload };
