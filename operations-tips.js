// @ts-check
/**
 * operations-tips.js — CARD_TIPS for operations.html's `?` panels.
 *
 * Data, no DOM, in the shape `tips-lightbox.js` renders and `tips-content.test.mjs` pins — the split
 * Links, Overtime and Trains had already made. It left `operations-app.js` in Oct 2026: the App Speed
 * review gave that card's panel the section it was missing ("A closer look"), the coordinator was at
 * its ratchet cap to the line, and content is not coordination.
 */
import { isRecentIssue } from './newsletter-recency.js';
import { LEAVE_FILE_MAX_AGE_DAYS } from './al-leave-file.js';

/**
 * The Newsletter card's receipt words. The ☰ button offers an issue for six weeks from its date
 * (newsletter-recency.js, owner, 14 Nov 2026), so the receipt and the sign-out line ask THAT rule of
 * the date just uploaded: an older issue is filed, but no ☰ button will offer it, and the admin is
 * told so. Both are given the ISO date (doc-upload.js). The header hint (operations.html) and the `?`
 * panel (below) state the same rule. An old issue's sign-out line sent the admin to "the Calendar with
 * #newsletter on the end of its address" — words for a developer, and a link that opens the NEWEST
 * issue, not the one just filed (whole-app check, 17 Nov 2026); an upload for the same date replaces
 * the first, so uploading again is the check that always works.
 */
export const NEWSLETTER_CARD = {
    /** @param {string} iso */
    told: iso => (isRecentIssue(iso)
        ? 'staff can open it from ☰ → Marylebone Newsletter'
        : 'it is six weeks old or more by its date, so the ☰ menu won’t offer it'),
    /** @param {string} iso */
    whereToCheck: iso => (isRecentIssue(iso) ? '☰ → Marylebone Newsletter'
        : 'whether it saved — the ☰ menu won’t offer an issue that old, so upload it again if you are not sure'),
};

/** @type {Record<string, { title: string, sections: Array<{ heading?: string, items: Array<{ icon: string, html: string }> }> }>} */
export const CARD_TIPS = {
    'daily-huddle': {
        title: 'Daily Huddle',
        sections: [{ items: [
            // The three documents need a sign-in or the staff PIN (owner, 7 Sep 2026; calendar-doc-access.js).
            { icon: '📋', html: 'Upload the day’s Huddle briefing. Staff open it from ☰ → <strong>Daily Huddle</strong> on the Calendar, once they have signed in or entered the staff PIN.' },
            { icon: '📄', html: '<strong>PDF</strong> — opens in the browser. <strong>Word (.docx)</strong> — shown inside the app; one too large to convert, or uploaded while the converter could not be reached, opens in Microsoft’s Word viewer instead.' },
            // functions/documents.js: a hand upload notifies on CREATE only, and only when its date is the latest.
            { icon: '🔄', html: 'Uploading a new file for the same date replaces the previous one, and does not notify staff again. The first upload for a date notifies staff only if it is the newest; an older date is filed quietly.' },
            { icon: '🤖', html: 'The Huddle email uploads automatically each day — use this card if you need to upload it manually.' },
        ]}],
    },
    'weekly-circular': {
        title: 'Weekly Retail Circular',
        sections: [{ items: [
            { icon: '📰', html: 'Upload the Weekly Retail Circular (PDF or Word) — staff open it from <strong>☰ → Weekly Retail Circular</strong>, once they have signed in or entered the staff PIN.' },
            { icon: '🔄', html: 'Uploading a new file for the same date replaces the previous one, and does not notify staff again. The first upload for a date notifies staff only if it is the newest; an older date is filed quietly.' },
            { icon: '📅', html: 'Set the date to <strong>the day it was issued</strong> — usually a Friday. The picker will not accept a future date, so a circular covering next week is still filed under the day it arrived.' },
        ]}],
    },
    'newsletter': {
        title: 'Marylebone Newsletter',
        sections: [{ items: [
            { icon: '🗞️', html: 'Upload the latest Marylebone Newsletter (PDF or Word) — staff open it from <strong>☰ → Marylebone Newsletter</strong>, once they have signed in or entered the staff PIN.' },
            { icon: '⏳', html: 'The ☰ button offers each issue for <strong>six weeks</strong> from its date, then hides until the next upload, so an old issue is never offered as the latest.' },
            { icon: '🔄', html: 'Uploading a new file for the same date replaces the previous one, and does not notify staff again. The first upload for a date notifies staff only if it is the newest; an older date is filed quietly.' },
            { icon: '📅', html: 'Set the date to the issue date of the newsletter — the six weeks are counted from it.' },
        ]}],
    },
    'weekly-roster': {
        title: 'Weekly Roster',
        sections: [
            { heading: 'How it works', items: [
                // The type menu's words (operations.html): "CEA / Bilingual", "Dispatchers".
                { icon: '1️⃣', html: 'Choose the <strong>roster type</strong> (CEA / Bilingual, CES, or Dispatchers) and the <strong>week ending date</strong> — always a Saturday, and a date that is not one is moved forward to the next Saturday for you.' },
                { icon: '2️⃣', html: 'Choose the PDF roster file and select <strong>Read roster</strong> — the app reads the shifts. It usually takes about 15 seconds, sometimes longer: keep this screen open until it finishes. The spinner means it is still working.' },
                // The review's own controls (admin-roster-upload.js): a per-day ✓ tick, on by default, and Skip all /
                // Restore per person. There is no per-day Save or Skip button on a changed day.
                { icon: '3️⃣', html: 'Review each person’s days. A day the new roster changes has a <strong>✓</strong> tick and will be saved; select the tick to leave that day as it is. <strong>Skip all</strong> leaves a whole person as they are, and <strong>Restore</strong> brings them back.' },
                { icon: '4️⃣', html: 'Select <strong>Save changes</strong> to write the ticked days to the roster.' },
            ]},
            { heading: 'Conflicts', items: [
                { icon: '⚠️', html: 'If a day already has a <strong>recorded change</strong> that differs from the PDF, both are shown. It starts on <strong>Keep saved</strong>; choose <strong>Use new roster</strong> to take the PDF’s instead.' },
                // Two readings to pick from offer Skip and "Neither — enter it"; no reading at all offers "Enter the shift".
                { icon: '❓', html: 'A day the app <strong>couldn’t read</strong> saves nothing until you answer it: pick one of the readings it offers, or <strong>Neither — enter it</strong> to type it in. Where it has no reading to offer, <strong>Enter the shift</strong> does the same.' },
                { icon: '🔄', html: 'Old roster uploads are replaced automatically — only your manual changes show a warning if the new PDF disagrees.' },
            ]},
        ],
    },
    'staff-login': {
        title: 'Staff Login Accounts',
        sections: [{ items: [
            { icon: '🔐', html: 'Creates an app login for every active staff member so the app knows who is saving changes.' },
            // The check list above the button (admin-auth.js) and the staff PIN's block line (operations-pin-lockout.js).
            { icon: '🔎', html: 'The card checks first. <strong>“members are not set up”</strong> names anyone with no login or the wrong permissions; <strong>“leavers can still sign in”</strong> names anyone who has left and still has a working account. <strong>✓ Everyone on the roster has a login</strong> means there is nothing to do.' },
            { icon: '✅', html: 'Safe to run any time for everyone already set up — a working account keeps its password, and a new joiner gets an account with their surname as the password.' },
            { icon: '🔁', html: 'It <strong>resets</strong> two kinds of account to the surname default and signs them out: one with <strong>no permissions</strong> (registered outside the app) and one that is <strong>disabled</strong>. The card names them before you press, and the result names them again — tell them their password is their surname.' },
            // The server reads the DEPLOYED roster-members.json, so a press before the starter's release is live creates nothing.
            { icon: '👤', html: 'Run this when someone <strong>joins</strong> — once the app update that adds them to the roster has gone live. Before that there is no account for it to create.' },
            { icon: '🚪', html: 'Tick <strong>“Disable accounts for anyone no longer on the roster”</strong> and run it when someone <strong>leaves</strong> — their account is disabled so they can no longer sign in.' },
            { icon: '🔢', html: 'If the <strong>staff PIN</strong> has been blocked for everyone after too many wrong entries, a line here says when. It reopens by itself, and members can still sign in with their password. If it keeps happening, somebody may be guessing — consider changing the PIN.' },
        ]}],
    },
    'document-links': {
        title: 'Document links',
        sections: [{ items: [
            { icon: '🔗', html: 'Each Huddle, Circular and Newsletter file has a <strong>permanent link</strong>. Whoever has a copy can open the file without signing in — from their browser history, a forwarded message, or Microsoft’s Word viewer.' },
            { icon: '👀', html: '<strong>Check the links</strong> only counts. Nothing changes until you press <strong>Replace the links</strong> and confirm.' },
            { icon: '🔄', html: '<strong>Replace the links</strong> gives every file a new link, and old copies stop working straight away. Staff notice nothing: the app opens documents with short-lived links of its own.' },
            { icon: '🚨', html: 'Use it if a document link has been shared somewhere it shouldn’t be. Running it again is always safe.' },
        ]}],
    },
    'annual-leave-sheet': {
        title: 'Annual leave sheet',
        sections: [
            { heading: 'What it does', items: [
                { icon: '📒', html: 'The clerks keep everybody’s annual leave in a workbook of their own. This card sets that sheet beside what the app holds, <strong>person by person and day by day</strong>, and shows each place they differ, and why.' },
                { icon: '🔒', html: 'Nothing is kept on this device, and <strong>Clear the check</strong> takes it off the screen. Nothing is saved until you <strong>confirm a person</strong> and press <strong>Save</strong>.' },
            ]},
            { heading: 'Getting a leave file', items: [
                { icon: '🧾', html: 'The app can’t read the workbook itself. Upload it in a Claude session and ask for a <strong>leave file</strong>. Where the sheet is unclear — a misspelt name, a date with no year — the session asks you rather than guessing.' },
                { icon: '🔏', html: 'The file is <strong>sealed</strong>: change a single character by hand and this card refuses it. Ask for a new file instead.' },
                { icon: '🗓️', html: `The card says when the clerks last saved their sheet. A copy more than ${LEAVE_FILE_MAX_AGE_DAYS} days old carries a warning, because anything booked since then shows as <strong>only in the app</strong>.` },
            ]},
            { heading: 'Reading the answer', items: [
                { icon: '➖', html: '<strong>Not in the app</strong> — leave on the sheet that the app does not hold, on a day the person was due to work.' },
                { icon: '❓', html: '<strong>Rest day to ask about</strong> or <strong>costs nothing in the app</strong> — leave on a day their pattern has them resting. It only costs a day if they swapped a working day onto it, which only the person who booked it knows.' },
                // The chips' own words (al-leave-words.js → CHIP_WORDS, TOTAL_WORDS).
                { icon: '🔀', html: '<strong>From another year’s allowance</strong> — the app charges that day to a different year’s allowance (a January day counted in the year before).' },
                { icon: '↔️', html: '<strong>Differs</strong> — the app has a shift, an absence or a rest day recorded there instead.' },
                { icon: '💼', html: '<strong>With work recorded</strong> — the app has RDW, an Other day or a Spare turn there. That is pay evidence: never overwrite it just to make the two agree.' },
                { icon: '➕', html: '<strong>Only in the app</strong> — leave the app holds that the sheet does not. Often it was booked after the clerks last saved.' },
                { icon: '📋', html: '<strong>Past a Spare week’s 4</strong> — leave on a Spare day after that week’s first four. It costs nothing in the app, but the sheet may still charge it, so tell the clerks.' },
                { icon: '🧮', html: '<strong>Allowance differs</strong> or <strong>figures differ</strong> — the two disagree on the person’s totals, not on one day. <strong>Before their start date</strong>, <strong>after the sheet ends</strong> and <strong>undated over quota</strong> are days only one side can place: leave on the sheet before the person’s start date in the app, leave in the app after the sheet’s last date, and over-quota days the sheet lists with no date.' },
                { icon: '📅', html: 'The clerks mark some <strong>Sundays</strong> with a tag. A Sunday is never contracted, so it is never leave on either side; each one is listed with what the app has that day.' },
            ]},
            { heading: 'Saving', items: [
                { icon: '✅', html: 'The Save only <strong>adds</strong> leave the app is missing, and only for the people you tick. It never removes leave, and never writes over a shift, an absence or work recorded there: those are changed in Admin, with <strong>Change a Shift</strong>.' },
                { icon: '❓', html: 'Leave on a <strong>rest day</strong> is asked about, as the Admin leave card asks: <strong>Swapped — counts</strong> books it as a day of leave, <strong>Rest day — free</strong> leaves it. Unanswered, it is not saved.' },
                { icon: '🛡️', html: 'Each day is checked again as it is written. If somebody changed it after your check, nothing is saved for that person, your answers are kept, and the card shows what changed.' },
                { icon: '↩️', html: `<strong>Undo this Save</strong> takes back the leave a Save added, except any day changed since. A copy older than one already saved, or more than ${LEAVE_FILE_MAX_AGE_DAYS} days old, can be checked but not saved.` },
            ]},
            { heading: 'Who is left out', items: [
                { icon: '👋', html: 'Leavers, managers and anybody with no leave allowance in the app are listed under <strong>On the sheet, not compared</strong>. Anybody in the app that the sheet does not list comes last.' },
            ]},
        ],
    },
    'reset-requests': {
        title: 'Password Reset Requests',   // no emoji: no other Operations panel's title wears one (the card's header does)
        sections: [{ items: [
            { icon: '🔑', html: 'Staff who select <strong>“Can’t get in? Ask the admin to reset your password”</strong> on the sign-in card appear here. Nothing is reset automatically — <strong>you</strong> do it, from Account status below.' },
            { icon: '⚠️', html: '<strong>Requests are not verified.</strong> The sign-in card has no way to prove who is asking, so anyone could file a request in someone else’s name. <strong>Confirm with the member before resetting</strong> — a reset puts them back on their surname default and signs them out on every device.' },
            { icon: '🆕', html: 'A row saying <strong>“No account yet”</strong> means they have no login account yet, so there is nothing to reset. Run <strong>Set up accounts</strong> instead.' },
            { icon: '🚫', html: 'A row saying <strong>“Account disabled”</strong> means the account is switched off, so a reset would not let them in. Run <strong>Set up accounts</strong> instead: it switches the account back on with their surname as the password, and signs them out.' },
            { icon: '🧹', html: '<strong>Clear</strong> removes the row once you have dealt with it. If they ask again it comes back, with the count showing how many times.' },
        ]}],
    },
    'account-status': {
        title: 'Account status',
        sections: [
            { heading: 'What it shows', items: [
                { icon: '📧', html: 'Each person’s <strong>work email</strong> — the address if they’ve added one, or “No work email” if not. It is for <strong>account recovery</strong>. Self-service recovery isn’t available yet, so nothing uses it today.' },
                { icon: '🔑', html: 'Their <strong>password</strong> — either <strong>✓ Own</strong> (they’ve set their own in ☰ → Settings → Password) or <strong>Default</strong> (still on the guessable surname default).' },
                { icon: '🔒', html: 'Each person can only see their <strong>own</strong> email; as admin you see everyone’s. Use the <strong>All grades / CEA / CES / Dispatcher / Management</strong> filter to track each grade.' },
            ]},
            { heading: 'Work email', items: [
                // Settings is open to ANY named user — `auth-policy.js` gates it on `requireNamed`
                // with no role. This said CEA/CES/Dispatcher, and that Management had no
                // Settings page, which would have had an admin doing by hand what the
                // member can do themselves.
                { icon: '⚙️', html: 'Anyone who can sign in can add their own email in ☰ → <strong>Settings → Work Email</strong> — Management included. That is the easiest way to get them registered.' },
                { icon: '📝', html: 'You can do it on anyone’s behalf here — <strong>Set email</strong> or <strong>Edit</strong> to enter one, and a separate <strong>Remove</strong> button to clear it. Useful if somebody is having trouble doing it themselves.' },
            ]},
            { heading: 'Resetting a password', items: [
                // Both lines rewritten at v21.94: Reset is offered to EVERYONE (see
                // `buildRow` — v18.84), and the new password is compelled, not optional.
                { icon: '↩️', html: '<strong>Reset</strong> is offered next to <strong>everyone</strong>. Use it if someone has forgotten their password — it goes back to their <strong>surname default</strong> and they’re signed out on every device. Resetting an account that is already on the default is harmless, and still signs them out on every device.' },
                { icon: '🔒', html: 'They sign in with their surname again, and the app then <strong>asks them to choose a new password</strong> before they can carry on.' },
                { icon: '📵', html: 'If their phone is <strong>lost or stolen</strong>, tick the box in the Reset dialog. No reset notice is sent — it would show on that phone — and their notifications stop on every device, so <strong>tell them yourself</strong>.' },
            ]},
        ],
    },
    'usage': {
        title: 'Usage',
        sections: [
            { heading: 'What it shows', items: [
                { icon: '👥', html: '<strong>Roster in use</strong> — how many <strong>member-and-device pairs</strong> opened the app this calendar month (with last month’s full figure beside it) and on any of the last 30 days. Simply opening the app counts, <strong>including looking at the roster on the staff PIN without signing in</strong>.' },
                { icon: '🧮', html: 'It is not a headcount of people, which is why it is not labelled “accounts”. One person on a phone <em>and</em> a laptop counts <strong>twice</strong>; on a shared device it follows <strong>whichever member is selected</strong>, who need not be the person holding it. For the exact count of distinct accounts, see the block below.' },
                { icon: '🚫', html: 'Never counted: <strong>your own visits while signed in as admin</strong>, a brand-new device before anybody has picked a member on it, and the <strong>reload the app does by itself</strong> after an update. On a device nobody is signed in to — the station PC, on the staff PIN — a visit always counts as a page view, but as a member-device only when the Calendar has a member other than the admin chosen.' },
                { icon: '📊', html: '<strong>Page popularity</strong> — how many times each page has been opened, and how many times each document and guide has been opened. <strong>This month / Last month</strong> switches the window.' },
            ]},
            { heading: 'Which address staff are on', items: [
                { icon: '\u{1F6A6}', html: 'While the app is served from <strong>two addresses</strong>, this shows how far the move has got — <strong>member-devices</strong> on each over the last 30 days, a direction rather than a headcount, and how many of them opened the <strong>installed</strong> app rather than a browser tab.' },
                { icon: '\u{1F4CD}', html: 'Someone using <strong>both</strong> addresses counts on each — that is what half-migrated looks like. An install nobody has <em>opened</em> in 30 days is invisible here, so treat it as a floor.' },
            ]},
            { heading: 'Sign-ins vs opens', items: [
                { icon: '\u{1F511}', html: '<strong>Accounts that have signed in</strong> is the exact unique count, from the app’s sign-in records. It counts <strong>sign-ins, not opens</strong> — a session lasts up to 60 days, so someone can sign in once and use the app daily for two months without ever appearing here again.' },
                { icon: '\u{1F423}', html: '<strong>Never signed in</strong> is the actionable one: accounts set up that have never been used.' },
                { icon: '\u{1F50D}', html: 'The <strong>gap</strong> between the two blocks is readable: roughly the staff who use the roster but have <strong>never held an account session</strong>. They can’t be reached by anything that happens at sign-in — a password prompt, for one.' },
            ]},
            { heading: 'Privacy', items: [
                { icon: '🔒', html: 'Completely <strong>anonymous</strong> — it counts <em>how many</em> accounts and visits, never <em>which</em> account did what. No names, no per-person history is stored.' },
            ]},
        ],
    },
    'page-speed': {
        title: 'App Speed',
        sections: [
            { heading: 'What it shows', items: [
                { icon: '⚡', html: 'How long pages took to <strong>open</strong> for staff, with a <strong>This month / Last month</strong> switch, grouped into <strong>Quick</strong> (under 1s), <strong>A moment</strong> (1–3s) and <strong>Slow</strong> (over 3s). The big number on each panel is the share that was <strong>quick</strong>.' },
                { icon: '📄', html: 'Each page has up to <strong>three</strong> bars — when it <strong>first appears</strong>, when its <strong>code has loaded</strong>, and when it is <strong>usable</strong>. <strong>Usable</strong> is the one to read as how fast the app is.' },
                { icon: '🔑', html: '<strong>Signing in</strong> is timed from pressing Sign in until the page is usable, and counts only <strong>fresh sign-ins</strong> — normally fewer than the accounts on the Usage card, because most staff open the app on a saved session.' },
            ]},
            { heading: 'A closer look', items: [
                { icon: '🔍', html: 'The <strong>busiest page</strong> — usually the Calendar — in more detail.' },
                { icon: '📱', html: '<strong>Before the sign-in check</strong>: how soon a signed-in member saw their own roster, from the copy kept on their phone.' },
                { icon: '🔄', html: '<strong>After a release</strong>: how long somebody waited for a page an update had just reloaded.' },
                { icon: '🏷️', html: '<strong>By app version</strong> and <strong>by how it was opened</strong>: the Usable figure split by release, and installed app against browser tab.' },
            ]},
            { heading: 'How to read it', items: [
                { icon: '🟢', html: 'Mostly green is healthy. A page is usually slower on a <strong>weak phone signal</strong> or right after an <strong>app update</strong>, when the first open downloads the new version.' },
                { icon: '🔴', html: 'If a page is <strong>consistently</strong> red across many opens, that’s worth raising — it’s not just one person on a bad connection. Slow bars are <strong>striped</strong> as well as red.' },
                { icon: '⏱️', html: 'Only time somebody spent <strong>waiting</strong> is counted. A page loading while nobody looked at it, and time spent typing a password or the staff PIN, are left out.' },
            ]},
            { heading: 'Privacy', items: [
                { icon: '🔒', html: 'Completely <strong>anonymous</strong> — it records <em>how fast</em> pages opened, never <em>who</em> opened them. No names are stored.' },
            ]},
        ],
    },
    'error-log': {
        title: 'Error Log',
        sections: [
            { heading: 'What it captures', items: [
                { icon: '🐛', html: 'Errors the app ran into on <strong>any of its pages</strong> — every page but the guides — across all staff, not just you.' },
                { icon: '🐢', html: '<strong>Slow save (diagnostic)</strong> entries are not errors: each records a save that waited a long time for the server. They are listed for you to read, and left out of the count on the card.' },
                { icon: '⎘', html: 'Use <strong>⎘ Copy details</strong> on any error to copy it formatted for diagnosis — the message, the page, the app version, the device and the time. It leaves out <strong>the name of the member it happened to</strong>: this card shows it, because unlike the Usage and App Speed cards it is not anonymous, but what you paste somewhere else does not need it.' },
            ]},
            { heading: 'Resolving errors', items: [
                { icon: '✓', html: '<strong>Resolve</strong> marks an error as reviewed. It <strong>stays in the list</strong>, dimmed and below the unresolved ones, so you can see what you have already been through — up to 30 of them. It is not deleted immediately either: resolved errors are kept for 90 days, then pruned automatically.' },
                // operations-errors.js: the toolbar button re-reads and pulls the next batch; a single row's Resolve does not.
                { icon: '☑️', html: '<strong>✓ Resolve all shown</strong> resolves every entry in the list at once, then loads the next batch — useful after a bad release.' },
                { icon: '🔄', html: 'You don’t need to manually clean up the log — resolved errors expire on their own.' },
                { icon: '➕', html: 'A count ending in <strong>+</strong> means more than 100 entries are unresolved, so not all of them have loaded. <strong>✓ Resolve all shown</strong> loads the rest; resolving one at a time does not.' },
            ]},
            { heading: 'What to act on', items: [
                { icon: '⚠️', html: '<strong>Worth investigating:</strong> the same error from multiple people, or new errors appearing after a deployment.' },
                { icon: '🔕', html: '<strong>Usually safe to resolve:</strong> isolated one-off errors, errors from a browser extension (its stack trace names the extension), brief network failures.' },
            ]},
        ],
    },
};
