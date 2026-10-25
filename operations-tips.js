// @ts-check
/**
 * operations-tips.js — CARD_TIPS for operations.html's `?` panels.
 *
 * Data, no DOM, in the shape `tips-lightbox.js` renders and `tips-content.test.mjs` pins — the split
 * Links, Overtime and Trains had already made. It left `operations-app.js` in Oct 2026: the App Speed
 * review gave that card's panel the section it was missing ("A closer look"), the coordinator was at
 * its ratchet cap to the line, and content is not coordination.
 */

/** @type {Record<string, { title: string, sections: Array<{ heading?: string, items: Array<{ icon: string, html: string }> }> }>} */
export const CARD_TIPS = {
    'daily-huddle': {
        title: 'Daily Huddle',
        sections: [{ items: [
            { icon: '📋', html: 'Upload the day\'s Huddle briefing — staff open it via ☰ → <strong>Daily Huddle</strong> on the main app' },
            { icon: '📄', html: '<strong>PDF</strong> — opens in the browser. <strong>Word (.docx)</strong> — displayed inside the app' },
            { icon: '🔄', html: 'Uploading a new file for the same date overwrites the previous one' },
            { icon: '🤖', html: 'The Huddle email uploads automatically each day — use this card if you need to upload it manually' },
        ]}],
    },
    'weekly-circular': {
        title: 'Weekly Retail Circular',
        sections: [{ items: [
            { icon: '📰', html: 'Upload the Weekly Retail Circular (PDF or Word) — staff open it from <strong>☰ → Weekly Retail Circular</strong>' },
            { icon: '🔄', html: 'Uploading a new file for the same date overwrites the previous one' },
            { icon: '📅', html: 'Set the date to <strong>the day it was issued</strong> — usually a Friday. The picker will not accept a future date, so a circular covering next week is still filed under the day it arrived' },
        ]}],
    },
    'newsletter': {
        title: 'Marylebone Newsletter',
        sections: [{ items: [
            { icon: '🗞️', html: 'Upload the latest Marylebone Newsletter (PDF or Word) — staff open it from <strong>☰ → Marylebone Newsletter</strong>' },
            { icon: '🔄', html: 'Uploading a new file for the same date overwrites the previous one' },
            { icon: '📅', html: 'Set the date to the issue date of the newsletter' },
        ]}],
    },
    'weekly-roster': {
        title: 'Weekly Roster upload',
        sections: [
            { heading: 'How it works', items: [
                { icon: '1️⃣', html: 'Choose the <strong>roster type</strong> (CEA/Bilingual, CES, or Dispatcher) and the <strong>week ending date</strong> — always a Saturday, and a date that is not one is moved forward to the next Saturday for you' },
                { icon: '2️⃣', html: 'Choose the PDF roster file and tap <strong>Read roster</strong> — the app reads the shifts. It usually takes under a minute, sometimes a good deal longer — the spinner means it is still working' },
                { icon: '3️⃣', html: 'Review each person\'s changes — <strong>Save</strong> or <strong>Skip</strong> each day individually' },
                { icon: '4️⃣', html: 'Tap <strong>Save changes</strong> to write approved shifts to the roster' },
            ]},
            { heading: 'Conflicts', items: [
                { icon: '⚠️', html: 'If a day already has a <strong>recorded change</strong> that differs from the PDF, it shows as a conflict — choose which to keep' },
                { icon: '🔄', html: 'Old roster uploads are replaced automatically — only your manual changes show a warning if the new PDF disagrees' },
            ]},
        ],
    },
    'staff-login': {
        title: 'Staff Login Accounts',
        sections: [{ items: [
            { icon: '🔐', html: 'Creates an app login for every active staff member so the app knows who is saving changes' },
            { icon: '✅', html: 'Safe to run any time — new joiners get an account, and an account registered outside the app is taken back and reset to the surname default (the result names them, so you can tell them)' },
            { icon: '👤', html: 'Run this whenever someone <strong>joins</strong> the roster to give them access' },
            { icon: '🚪', html: 'Tick <strong>“Disable accounts for anyone no longer on the roster”</strong> and run it when someone <strong>leaves</strong> — their account is disabled so they can no longer sign in' },
        ]}],
    },
    'reset-requests': {
        title: '🙋 Password Reset Requests',
        sections: [{ items: [
            { icon: '🔑', html: 'Staff who tap <strong>“ask the admin to reset your password”</strong> on the sign-in screen appear here. Nothing is reset automatically — <strong>you</strong> do it, from Account status below.' },
            { icon: '⚠️', html: '<strong>Requests are not verified.</strong> The sign-in screen has no way to prove who is tapping, so anyone could file a request in someone else\'s name. <strong>Confirm with the member before resetting</strong> — a reset puts them back on their surname default and signs them out of their other devices.' },
            { icon: '🆕', html: 'A row saying <strong>“No account yet”</strong> means there is no Firebase account to reset. Run <strong>Set up accounts</strong> instead.' },
            { icon: '🧹', html: '<strong>Clear</strong> removes the row once you have dealt with it. If they ask again it comes back, with the count showing how many times.' },
        ]}],
    },
    'account-status': {
        title: 'Account status',
        sections: [
            { heading: 'What it shows', items: [
                { icon: '📧', html: 'Each person\'s <strong>work email</strong> — the address if they\'ve added one, or "No work email" if not. It is for <strong>account recovery</strong>. Self-service recovery isn\'t available yet, so nothing uses it today.' },
                { icon: '🔑', html: 'Their <strong>password</strong> — either <strong>✓ Own</strong> (they\'ve set their own in ☰ → Settings → Password) or <strong>Default</strong> (still on the guessable surname default).' },
                { icon: '🔒', html: 'Each person can only see their <strong>own</strong> email; as admin you see everyone\'s. Use the <strong>All grades / CEA / CES / Dispatcher / Management</strong> filter to track each grade.' },
            ]},
            { heading: 'Work email', items: [
                // Settings is open to ANY named user — `auth-policy.js` gates it on `requireNamed`
                // with no role. This said CEA/CES/Dispatcher, and that Management had no
                // Settings page, which would have had an admin doing by hand what the
                // member can do themselves.
                { icon: '⚙️', html: 'Anyone who can sign in can add their own email in ☰ → <strong>Settings → Work Email</strong> — Management included. That is the easiest way to get them registered.' },
                { icon: '📝', html: 'You can do it on anyone\'s behalf here — <strong>Set email</strong> or <strong>Edit</strong> to enter one, and a separate <strong>Remove</strong> button to clear it. Useful if somebody is having trouble doing it themselves.' },
            ]},
            { heading: 'Resetting a password', items: [
                // Both lines rewritten at v21.94: Reset is offered to EVERYONE (see
                // `buildRow` — v18.84), and the new password is compelled, not optional.
                { icon: '↩️', html: '<strong>Reset</strong> is offered next to <strong>everyone</strong>. Tap it if someone has forgotten their password — it goes back to their <strong>surname default</strong> and they\'re signed out of their other devices. Resetting an account that is already on the default is harmless, and still signs their other devices out.' },
                { icon: '🔒', html: 'They sign in with their surname again, and the app then <strong>asks them to choose a new password</strong> before they can carry on.' },
            ]},
        ],
    },
    'usage': {
        title: 'Usage',
        sections: [
            { heading: 'What it shows', items: [
                { icon: '👥', html: '<strong>Roster in use</strong> — how many <strong>member-and-device pairs</strong> opened the app this calendar month and over the last 30 days. Simply opening the app counts, <strong>including just looking at the roster without signing in</strong>. Two things are never counted: <strong>your own visits as admin</strong>, and a brand-new device before anybody has picked a member on it' },
                { icon: '🧮', html: 'It is not a headcount of people, which is why it is no longer labelled "accounts". One person on a phone <em>and</em> a laptop counts <strong>twice</strong>; on a shared device it follows <strong>whichever member is selected</strong>, who need not be the person holding it. For the exact count of distinct accounts, see the block below' },
                { icon: '📈', html: 'That last part changed in <strong>August 2026</strong>. Before then this counted only people who opened a page you must sign in for, so it missed anyone who just reads their shifts — most of the staff. Expect a <strong>step up</strong> from that point; figures either side of it aren\'t comparable' },
                { icon: '📊', html: '<strong>Page popularity</strong> — how many times each page has been opened, and how many times each document and guide has been opened. <strong>This month / Last month</strong> switches the window' },
            ]},
            { heading: 'Which address staff are on', items: [
                { icon: '\u{1F6A6}', html: 'While the app is served from <strong>two addresses</strong>, this shows how far the move has got — <strong>account-device signals</strong> on each over the last 30 days, directional rather than a headcount, and how many opened the <strong>installed</strong> app rather than a browser tab' },
                { icon: '\u{1F4CD}', html: 'Someone using <strong>both</strong> addresses counts on each — that is what half-migrated looks like. An install nobody has <em>opened</em> in 30 days is invisible here, so treat it as a floor' },
            ]},
            { heading: 'Sign-ins vs opens', items: [
                { icon: '\u{1F511}', html: '<strong>Accounts that have signed in</strong> is the exact unique count, from Firebase Auth itself. It counts <strong>sign-ins, not opens</strong> — a session lasts up to 60 days, so someone can sign in once and use the app daily for two months without ever appearing here again' },
                { icon: '\u{1F423}', html: '<strong>Never signed in</strong> is the actionable one: accounts set up that have never been used' },
                { icon: '\u{1F50D}', html: 'The <strong>gap</strong> between the two blocks is now readable: roughly the staff who use the roster but have <strong>never held an account session</strong>. They can\'t be reached by anything that happens at sign-in — a password prompt, for one' },
            ]},
            { heading: 'Privacy', items: [
                { icon: '🔒', html: 'Completely <strong>anonymous</strong> — it counts <em>how many</em> accounts and visits, never <em>which</em> account did what. No names, no per-person history is stored' },
                { icon: '📱', html: 'Counts are per account-device, so someone using both a phone and a laptop may count twice — treat the numbers as a usage trend, not an exact headcount' },
            ]},
        ],
    },
    'page-speed': {
        title: 'App Speed',
        sections: [
            { heading: 'What it shows', items: [
                { icon: '⚡', html: 'How long pages took to <strong>open</strong> for staff, with a <strong>This month / Last month</strong> switch, grouped into <strong>Quick</strong> (under 1s), <strong>A moment</strong> (1–3s) and <strong>Slow</strong> (over 3s). The big number on each panel is the share that was <strong>quick</strong>' },
                { icon: '📄', html: 'Each page has up to <strong>three</strong> bars — when it <strong>first appears</strong>, when its <strong>code has loaded</strong>, and when it is <strong>usable</strong>. <strong>Usable</strong> is the one to read as how fast the app is' },
                { icon: '🔑', html: '<strong>Signing in</strong> is timed from pressing Sign in until the page is usable, and counts only <strong>fresh sign-ins</strong> — normally fewer than the accounts on the Usage card, because most staff open the app on a saved session' },
            ]},
            { heading: 'A closer look', items: [
                { icon: '🔍', html: 'The <strong>busiest page</strong> — usually the Calendar — in more detail' },
                { icon: '📱', html: '<strong>Before the sign-in check</strong>: how soon a signed-in member saw their own roster, from the copy kept on their phone' },
                { icon: '🔄', html: '<strong>After a release</strong>: how long somebody waited for a page an update had just reloaded' },
                { icon: '🏷️', html: '<strong>By app version</strong> and <strong>by how it was opened</strong>: the Usable figure split by release, and installed app against browser tab' },
            ]},
            { heading: 'How to read it', items: [
                { icon: '🟢', html: 'Mostly green is healthy. A page is usually slower on a <strong>weak phone signal</strong> or right after an <strong>app update</strong>, when the first open downloads the new version' },
                { icon: '🔴', html: 'If a page is <strong>consistently</strong> red across many opens, that\'s worth raising — it\'s not just one person on a bad connection. Slow bars are <strong>striped</strong> as well as red' },
                { icon: '⏱️', html: 'Only time somebody spent <strong>waiting</strong> is counted. A page loading while nobody looked at it, and time spent typing a password or the staff PIN, are left out' },
            ]},
            { heading: 'Privacy', items: [
                { icon: '🔒', html: 'Completely <strong>anonymous</strong> — it records <em>how fast</em> pages opened, never <em>who</em> opened them. No names are stored' },
            ]},
        ],
    },
    'error-log': {
        title: 'Error Log',
        sections: [
            { heading: 'What it captures', items: [
                { icon: '🐛', html: 'Errors the app ran into on <strong>any page across the app</strong> (calendar, pay calculator, admin, operations, settings, links, overtime) — across all staff, not just you' },
                { icon: '⎘', html: 'Tap <strong>⎘ Copy details</strong> on any error to copy it formatted for diagnosis — the message, the page, the app version, the device, the time, and <strong>the name of the member it happened to</strong>. Unlike the Usage and App Speed cards, this one is not anonymous' },
            ]},
            { heading: 'Resolving errors', items: [
                { icon: '✓', html: 'Tapping <strong>Resolve</strong> marks an error as reviewed. It <strong>stays in the list</strong>, dimmed and below the unresolved ones, so you can see what you have already been through — up to 30 of them. It is not deleted immediately either: resolved errors are kept for 90 days, then pruned automatically' },
                { icon: '🔄', html: 'You don\'t need to manually clean up the log — resolved errors expire on their own' },
            ]},
            { heading: 'What to act on', items: [
                { icon: '⚠️', html: '<strong>Worth investigating:</strong> the same error from multiple people, or new errors appearing after a deployment' },
                { icon: '🔕', html: '<strong>Usually safe to resolve:</strong> isolated one-off errors, cross-origin/extension errors (no page or version shown), brief network failures' },
            ]},
        ],
    },
};
