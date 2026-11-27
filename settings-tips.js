// @ts-check
/**
 * settings-tips.js — CARD_TIPS for settings.html's `?` panels.
 *
 * Data, no DOM, in the shape `tips-lightbox.js` renders and `tips-content.test.mjs` pins — the split
 * Admin, Calendar, Link Designer, Operations, Overtime and Trains had already made. Content is not
 * coordination, so it left `settings-app.js` (25 Nov 2026), which only hands it to `initTipsLightbox`.
 *
 * Static content at module scope, so it exists before anything in the coordinator's init() runs (Nov
 * 2026 review): it was a `const` declared half-way down init(), still in its temporal dead zone while
 * the cards wired. A module import keeps that true.
 *
 * The Password panel states the new password's minimum in words, and `settings-status.test.mjs` →
 * "the password minimum the page states" reads THIS file for it: the strings are evaluated with no
 * scope by `tips-content.test.mjs`, so the figure cannot be interpolated from MIN_PASSWORD_LENGTH.
 */

import { timetableListed } from './notif-card-core.js';

/** Tips content keyed by the `data-card` attribute on each `.btn-card-tips` button. */
export const CARD_TIPS = {
    'password': {
        title: 'Password',
        sections: [
            { items: [
                { icon: '🔑', html: 'Replace your <strong>surname default</strong> with a password only you know — anyone who knows your name can guess the default.' },
                { icon: '✏️', html: 'Enter your <strong>current</strong> password (your surname, unless you’ve set your own since your last reset), then a new one of <strong>at least 8 characters</strong> that isn’t your surname — even with numbers added.' },
                { icon: '↩️', html: 'Forgotten it? Ask the admin — or, when you’re signed out, select <strong>“Can’t get in?”</strong> on the sign-in card, which asks them for you. They reset it to your surname, and you choose a new one as you sign in.' },
                { icon: '🔒', html: 'Your password is never shown to anyone, not even the admin.' },
            ]},
        ],
    },
    'work-email': {
        title: 'Work Email',
        sections: [
            { items: [
                // The field takes the part before the @ (placeholder firstname.surname) and shows the domain beside it (settings.html).
                { icon: '✉️', html: 'Use your <strong>Chiltern work email</strong>. Type only the part before the @ — firstname.surname — and the rest is already shown beside the box.' },
                { icon: '🔑', html: 'It is for <strong>account recovery</strong>. Self-service recovery isn’t available yet. For now, ask the admin if you forget your password — or, when you’re signed out, select <strong>“Can’t get in?”</strong> on the sign-in card, which asks them for you. They reset it to your surname, and you choose a new one as you sign in.' },
                { icon: '🔒', html: 'Only you and the admin can see this email. It is not shown to your manager or to anyone else. It doesn’t change how you sign in.' },
            ]},
        ],
    },
    'notifications': {
        title: 'Notifications',
        sections: [
            // Every kind the card lists (settings.html), and nothing else: a member turning notifications
            // on agrees to this list. It named two kinds while four were sent, then four while the card
            // said five — so tips-content.test.mjs now holds the two lists to each other.
            { heading: 'What you’ll get', items: [
                { icon: '📋', html: '<strong>Daily Huddle</strong> — when a new Huddle is uploaded, usually the evening before the day it covers.' },
                { icon: '📰', html: '<strong>Weekly Retail Circular</strong> — when a new one is posted.' },
                { icon: '🗞️', html: '<strong>Marylebone Newsletter</strong> — when a new one is posted.' },
                { icon: '💷', html: '<strong>Pay reminder</strong> — for CEA and CES colleagues: on the cut-off Saturday, six days before payday, to enter your hours.' },
                { icon: '🔑', html: '<strong>Password reset</strong> — only if the admin resets your password, so you know to sign in again.' },
                { icon: '🚆', html: '<strong>Timetable changes</strong> — the evening before Chiltern’s timetable changes, with what changes at Marylebone.' },
                // The admin's alone, as the card lists them (notif-card.js, `adminNotices`): tips-lightbox.js drops an
                // `adminOnly` item for everyone else.
                { icon: '🙋', adminOnly: true, html: '<strong>Reset requests</strong> — when a colleague asks for a password reset from the sign-in card.' },
                { icon: '🐛', adminOnly: true, html: '<strong>Error Log</strong> — when new entries are recorded, at most once an hour.' },
            ]},
            { heading: 'How it works', items: [
                { icon: '🔔', html: 'A notification is a short message on your phone’s lock screen, even when the roster is closed. Tap it to open the right page.' },
                { icon: '📲', html: 'Select <strong>Turn on notifications</strong> and allow it when your phone asks. That is all.' },
                { icon: '🔕', html: 'Select <strong>Turn off notifications</strong> to stop them at any time. You can turn them back on later.' },
                { icon: '🚫', html: 'If you chose <strong>Don’t allow</strong> when your phone asked, the button cannot ask again — your phone will not let it. Turn them back on in your phone’s or browser’s settings — the card shows you where.' },
            ]},
            { heading: 'iPhone users', items: [
                // Browser-neutral: every iOS browser is WebKit, so this reaches Chrome/Edge/Firefox too (v22.45).
                // A POINTER, NOT A SECOND COPY of the install steps (26 Nov 2026): the Install card lists the taps,
                // as the Notifications card's own iPhone line already points at it (notif-card-core.js).
                { icon: '🍎', html: 'Notifications only work on iPhone if the roster has been <strong>added to your Home Screen</strong> first — the <strong>Install on this device</strong> card shows how — then open it from there and turn notifications on.' },
            ]},
        ],
    },
    // The Install card gained its siblings' header, `?` included (settings review, Nov 2026).
    'install': {
        title: 'Install on this device',
        sections: [
            { items: [
                { icon: '📱', html: 'Installing gives the roster its <strong>own icon</strong>, so it opens like an app — from your home screen, or from a computer’s desktop.' },
                { icon: '🔔', html: 'On an <strong>iPhone</strong> it is the only way to get notifications: an iPhone sends them only to a roster opened from the Home Screen.' },
                { icon: '💾', html: 'Pay Calculator figures saved in the installed roster are far less likely to be cleared to free up space. On an iPhone the Home Screen app starts <strong>without</strong> the figures saved in Safari — copy them across first with <strong>Move Your Pay Data</strong> on the Pay page.' },
                { icon: '🙂', html: 'On an Android phone or a computer, installing is up to you. This card shows only while your browser can offer it.' },
            ]},
        ],
    },
    // ADDED v20.09. This card was the only one of the four with no `?`, which reads as a
    // control that failed to render rather than as a card too simple to need one — and it is
    // not too simple: it is the one place in the app where something does NOT follow your
    // account, which is the opposite of every expectation the rest of the app sets.
    'pay-data': {
        title: 'Pay Calculator Data',
        sections: [
            { heading: 'Why this card exists', items: [
                { icon: '💾', html: 'Your pay calculator figures are saved <strong>in this browser on this device</strong>, not to your account — so they do not follow you to a new phone, to another browser or to a different link. On an iPhone, Safari and the Home Screen app each keep their own copy.' },
                { icon: '🔒', html: 'That is deliberate: <strong>pay data is never sent to the server</strong>. The trade is that moving it is something you have to do yourself.' },
            ]},
            { heading: 'Moving it', items: [
                { icon: '📄', html: 'The button opens the <strong>pay calculator</strong>, where you can download a backup or copy it as text — the controls live there because that is where the data is.' },
                { icon: '⚠️', html: 'Restoring <strong>replaces</strong> what is on the device — it does not merge. Take a backup of the new device first if it already has figures on it.' },
                { icon: '🙋', html: 'A backup belongs to the member who made it. Restoring somebody else’s is refused, because staff share devices.' },
            ]},
        ],
    },
};
// Timetable changes are listed only while one is scheduled, as the card lists them (notif-card-core.js).
if (!timetableListed()) for (const s of CARD_TIPS.notifications?.sections ?? []) s.items = s.items.filter(it => it.icon !== '🚆');
