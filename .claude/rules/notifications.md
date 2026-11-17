---
paths:
  - "functions/push.js"
  - "functions/roster-parse-helpers.js"
  - "functions/push-notices.js"
  - "functions/error-log-*.js"
  - "functions/documents.js"
  - "functions/pay-reminder.js"
  - "functions/overtime*.js"
  - "functions/auth-endpoints.js"
  - "functions/reset-request.js"
  - "functions/pin-lockout.js"
  - "functions/admin-recipients.js"
  - "functions/index.js"
  - "service-worker.js"
  - "notif.js"
  - "firebase-client.js"
  - "push-transport.test.mjs"
  - "notif.test.mjs"
  - "sw-notification-tap.test.mjs"
  - "sw-asset-check.test.mjs"
  - "roster-parse-helpers.test.mjs"
  - "error-log-*.test.mjs"
---


# Push notification design language

The one app surface rendered by the **OS**, not by our CSS — so it cannot inherit the design system
and needs its own explicit rules, which every Web Push notification staff receive must follow. They
are enforced by a single builder, `buildPushPayload` in `functions/push-notices.js` (re-exported by
`functions/roster-parse-helpers.js`), which the senders import (`functions/documents.js`,
`functions/pay-reminder.js`, `functions/overtime.js`, `functions/auth-endpoints.js`,
`functions/reset-request.js`, `functions/error-log-notify.js`, `functions/pin-lockout.js`); the
service worker renders the result.

## The core principle (what ties a notification to the app)

**A notification's leading emoji is the SAME emoji the app already uses for that feature** in the
nav drawer and on its card — so it visibly belongs to its part of the app, at no asset cost, no CSP
change, and reliably on Android and iOS (emoji render inline). The icon is always the app icon
(brand identity); the **emoji carries feature identity**.

| Feature | Emoji | Matches in-app | `tag` | Sub-type |
|---------|-------|----------------|-------|----------|
| Daily Huddle | 📋 | Operations "Daily Huddle" card + nav | `huddle` | document |
| Weekly Retail Circular | 📰 | Operations card + nav "Weekly Retail Circular" | `circular` | document |
| Marylebone Newsletter | 🗞️ | Operations card + nav "Marylebone Newsletter" | `newsletter` | document |
| Pay reminder | 💷 | Pay nav pill / paycalc | `pay-reminder` | event |
| Overtime availability (paused, so nothing sends — OVERTIME_AVAILABILITY.md → Paused) | ⏱️ | Overtime nav pill / page badge | `overtime` | event |
| Password reset request | 🙋 | Operations "Password Reset Requests" card | `reset-request` | event |
| Password was reset | 🔑 | Settings "Password" card | `password-reset` | event |
| Timetable change (one-off) | 🚆 | Trains nav pill / page badge | `timetable` | event |
| New Error Log entries (admin only) | 🐛 | Operations "Needs attention" strip → Error Log | `error-log` | event |
| Staff PIN blocked station-wide (admin only) | 🔢 | Operations "Needs attention" strip → Staff Login Accounts | `pin-lockout` | event |

A new notifying feature: the checklist at the end.

## Two sub-types, two grammars

**1. Document arrival** (huddle / circular / newsletter). A document is republished regularly and
the Huddle is sent the **evening before** for the next day's plan, so **never** use day-relative words
("Today's", "Tomorrow's") — they are wrong by the time it is read. Use **"Latest"**:

- Title: **`<emoji> Latest <Document Name>`**
- Body: a calm "tap to read" line.

| | Title | Body |
|---|-------|------|
| Huddle | `📋 Latest Huddle` | `Tap to read the latest day plan.` |
| Circular | `📰 Latest Retail Circular` | `Tap to read this week's retail update.` |
| Newsletter | `🗞️ Latest Marylebone Newsletter` | `Tap to read the latest newsletter.` |

**2. Event reminder** (pay, overtime, the reset queue, a password reset, the timetable) — a
time-sensitive event. "Latest" does not apply; lead with the event and its urgency:

- Title: **`<emoji> <Event> — <urgency>`**
- Body: the concrete action.

| | Title | Body |
|---|-------|------|
| Pay | `💷 Payday Friday — hours cutoff today` | `Open the Pay Calculator to estimate your 28 March pay.` |
| Overtime asked | `⏱️ Overtime — availability form open` | `Tell the roster team when you can work. Answer by Tue 18 Aug · 12:00.` |
| Overtime reminder | `⏱️ Overtime — answers due today` | `Initial answers for week ending Sat 5 Sep are due by 12:00 today.` |
| Reset request | `🙋 Reset requests — 2 waiting` | `N. Surname asked for a reset. 1 other waiting.` |
| Password was reset | `🔑 Password reset — set a new one` | `The admin reset your password. Open Settings to choose your own.` |
| Timetable change | `🚆 New timetable from Sunday` | `Chiltern’s times change on 13 December. Tap to see what changes at Marylebone.` |
| Error Log | `🐛 Error Log — 3 new` | `1 error and 2 slow saves. Tap to open the Error Log.` |
| Staff PIN blocked | `🔢 Staff PIN — blocked station-wide` | `200 wrong entries in 15 minutes. It reopens by itself at 14:20.` |

## Who receives it — broadcast or targeted

**Broadcasts** (`fanOutPush`, every subscribed device): the three documents and the one-off timetable
reminder. **Everything else is targeted** (`sendTargetedPush`, to named uids only) — the pay reminder
to CEA and CES members only, the grades the Pay Calculator prices (owner, 10 Nov 2026;
`functions/pay-reminder.js`), and the rest because of what it SAYS:

- **The reset request goes to the admin's devices only** — "N. Surname is locked out" sent to 50
  people is a leak, not a notification.
- **The Error Log notice goes to the admin's devices only** (owner, 13 Nov 2026: "only for my login
  the master admin") — `roles.admin`, and only an account that is enabled and carries the `admin`
  claim; never a manager, who cannot open the Error Log. COUNTS and nothing else — no name, page or
  message, because a push renders on a lock screen. Checked every fifteen minutes, sent at most once
  an hour (`sendErrorLogNotification`, documents.js); the rules are `functions/error-log-notice.js`,
  the sender and its record `functions/error-log-notify.js`.
- **The staff-PIN lockout notice goes to the admin's devices only** (owner, Nov 2026), by the Error
  Log's rule — `enabledAdminUids` (`functions/admin-recipients.js`, shared with the reset request and
  the Error Log notice). Sent when a wrong PIN trips the station-wide block, at most once a day. A
  count and a time only — never the PIN, never an address. The rules are
  `functions/calendar-viewer-auth.js`'s, the sender `functions/pin-lockout.js`.
- **`password-reset` goes to the member whose password was reset, on their own devices** — otherwise
  the one person it concerns is the only one not told, and finds out by failing to sign in (their
  credential became the surname default and their other devices were signed out). **Except for a
  lost or stolen phone**: the admin ticks a box on Reset (`lostDevice: true`), because the notice
  would land on THAT phone's lock screen and its record would go on receiving the member's targeted
  notices. So none is sent, every record the account owns is deleted (`releasePushForOwner`), and
  Operations tells the admin to tell the member themselves. In the hour its token outlives the reset
  the phone cannot save its record again: the rules refuse a push record from a sign-in older than
  the member's last `resetAt` (`signedInSinceLastReset`, `firestore.rules`); the member's own devices
  save theirs at their next sign-in.
- **Both Overtime notices** go to member uids resolved from the account email — the asked notice to
  whoever a window newly asked (one per member per scheduler run, naming their soonest deadline), the
  reminder only to participants who have submitted NOTHING on the deadline's morning. A broadcast
  would ping every member about a restricted beta; targeted, the reach scales to full launch with no
  code change. Deadlines are worded in LONDON time by the pure builders in `functions/overtime-core.js`
  (`askedNotice`/`reminderNotice`), never composed inline.

**`sendTargetedPush` fails closed at every step**: no target uids → send nothing; a subscription
doc with no `owner` (written before owners were stamped) → skipped, never assumed; no matches → log
and stop. There is deliberately **no "no targets → fall back to everyone" branch**. Any new
addressed-to-one-person notification uses `sendTargetedPush` and keeps that shape.

**The `owner` must never outlive the member's hold on the device:**

- **Sign-out.** The drawer's Sign out — once the page has committed to it (a `beforeSignOut` cancel
  keeps the record) — and the Calendar's "Use the staff PIN instead" hand-over call
  `releaseDevicePush` (`notif.js`), which deletes this device's record, so a targeted notice never
  follows a member onto a shared device they have left. Only a signed-in CALENDAR load re-saves it
  (`getNotifState`'s only caller), so until then another page shows notifications as on with no
  record behind it. **Where the delete cannot run as the owner**, the browser subscription is dropped
  instead and the next send's 410 deletes the record. All three, and the time box's cost, are
  `releaseDevicePush`'s JSDoc.
- **A hold that ends without a sign-out** — an expired session's lingering identity
  (`reconcileExpiredIdentity`), a session the last password reset refuses, a write page whose identity
  is lost mid-visit (`relogin`, `page-session.js`), a failed typed sign-in that clears ANOTHER member's
  held session (`login-overlay.js`) — releases the record before the session is cleared, through
  `releasePushForEndingHold` (`session.js`, which says why: on a station PC left on the staff PIN, no
  next member ever comes to take it over). **Never for the staff PIN**: the viewer owns no record, and
  releasing as it dropped the browser's own subscription, so a member who had used the PIN on their
  own phone found notifications off.
- **A leaver.** `fanOutPush` consults no owner, so the confirmed leaver sweep in `setupRosterAuth`
  deletes the records the disabled account owns (`releasePushForOwner`, `functions/push.js`) — **and
  every confirmed sweep does it again for the leavers disabled on EARLIER runs** (`disabledLeaverUids`;
  why: `functions/account-lifecycle.js` header, audit D2). The `resetAt` rule does not reach a leaver —
  the sweep stamps none — so this re-release is what covers the hour a token outlives the sweep.
- **A session that simply ENDED.** The rules let the SAME browser take its record over — same
  endpoint AND same keys, which exist only in that browser and in a record no client can read — and
  `notif.js` re-saves at once, without waiting for its 24-hour re-save throttle, when the signed-in
  uid differs from the one it last saved under (`myb_push_saved_owner`).

**Two properties of `password-reset` are load-bearing and easy to undo:**

- **The new password is NEVER in the payload.** A push renders on a LOCK SCREEN, so naming it would
  show it to whoever picks the phone up — and the default is derived from a surname that is on the
  roster. The body says that it changed and where to fix it, and nothing else.
- **The uid is the one the endpoint already resolved** to write the password, not a fresh
  name→address→uid lookup (the reset-request notice needs one; this is addressed to the account the
  handler is already holding), so there is no resolution step to widen or miss.

`resetMemberPassword` reports the send as `notified`, a third independently-reported stage beside
`revoked` and `stamped`: the credential has already changed by then, so a push failure must never
report the reset as failed. No subscription is a legitimate `false`, and Operations turns every reset
nobody was told about into the admin's cue to tell them another way, whether or not the sign-out
worked (`resetOutcome`, `operations-reset.js`). A lost-phone reset reports `lostDevice` and a fourth
stage, `pushReleased` or `pushReleaseFailed`, and is never `notified`; an answer without `lostDevice`
after the box was ticked came from a server that does not know the step yet, and Operations says to
reset again with the box ticked.

**Why the queue depth is in the reset-request title.** One stable tag per feature means a second
request *replaces* the first on the lock screen, so the headline states the current total
(`2 waiting`) and the body names whoever just asked: the newest notification summarises the whole
queue. Built by the pure `buildResetRequestNotice` (`functions/roster-parse-helpers.js`), never inline.

## Only to a push service

A subscription's `endpoint` is written by a browser and the rules can check only its type and
length, so a signed-in account could make every later fan-out POST to a URL of its choosing. Both
senders therefore pass every endpoint through `isAllowedPushEndpoint`
(`functions/roster-parse-helpers.js`) first: HTTPS, default port, no credentials, and a host in
`PUSH_SERVICE_HOSTS` (Google, Mozilla, Apple, Microsoft). A refused endpoint is **skipped and logged,
never deleted** — an unknown host may be a real provider — and **a new browser's push service must be
added to that list**, or its users silently stop receiving notifications. The guard is at the SEND,
so it also covers records stored before it existed.

## When the push service rotates a subscription

iOS retires a push endpoint on its own schedule and tells the SERVICE WORKER alone, through
`pushsubscriptionchange`. Unanswered, the next send gets a 410 and deletes the record, and the bell
reads "off" with nobody having turned anything off. So the worker re-subscribes with the key the old
subscription carried (it holds no copy of the VAPID key — `notif.js` and `functions/index.js` stay
the two that must agree), and `notif.js` remembers the endpoint it last saved
(`myb_push_saved_endpoint`) and re-saves at once when the live one differs, without waiting for its
24-hour throttle. A browser that hands over neither a renewal nor the old key is left alone: the next
check reads the lapse.

## Voice & tone

- **Calm and factual.** A roster tool earns trust by being quiet and reliable, not by shouting.
  **No exclamation marks** by default; no ALL-CAPS; no marketing voice.
- **Exactly one emoji**, leading the title (the feature signature). Never emoji in the body, never
  emoji mid-sentence.
- **Title Case** for the headline; second person where natural ("your pay", "tap to read").

## Length budgets (truncation-safe)

- **Title** ≤ ~40 characters *including the emoji* (collapsed notifications truncate hard).
- **Body** ≤ ~80 characters (≈ two lines collapsed).

`buildPushPayload` clips anything longer at a word boundary, so these are a guarantee rather than a
hope — but write to fit; a clipped deadline is worse than none.

## How long a notice may wait (TTL)

A push service holds a notice for a phone that is off, and web-push's default is FOUR WEEKS — long
enough for "hours cutoff today" to arrive days late. Every send passes a TTL from `PUSH_TTL_BY_TAG`
(`functions/push.js`, via `pushSendOptions`): documents 36–72 h, pay and overtime 12 h, the reset
queue 6 h, password-reset 7 days, the timetable reminder 30 h (not 24 h), the Error Log and PIN
lockout notices 24 h, anything unlisted one day — each value's reason is its comment there. **A new
notification feature adds its tag there**, or it gets a day; `push-transport.test.mjs` fails on a
feature with no TTL.

## Icon, badge, tag

- **`icon`** — always the app icon (`icon-192.png`), resolved against `registration.scope` (not the
  bare origin — the GitHub Pages sub-path install would 404).
- **`badge`** — MUST be a **monochrome silhouette** (`icon-badge.png`, white-on-transparent,
  ~96×96). Android masks the badge to a single colour in the status bar; feeding it the full-colour
  app icon produces a muddy blob. **Never use `icon-192.png` as the badge.**
- **`tag`** — one stable string per feature (table above). Same tag ⇒ a repeat replaces the previous
  one in the Notification Centre instead of stacking. `renotify: true` so a replacement still alerts.

**The first two are ENFORCED** by `sw-asset-check.test.mjs`, beside the deep-link allowlist check —
the OS draws the notification, so neither failure is visible anywhere else; that test's comments say
why, and why it also requires both assets precached and the badge a different FILE from the app
icon. **Do not write a second guard for these** — extend that one.

## Deep link

Every notification deep-links to **its feature's surface within scope**. The Cloud Function hardcodes
one absolute URL; the service worker takes only the page + query + hash and **re-bases it onto the
local install's scope** (`SAFE_NOTIFICATION_PAGES` in `service-worker.js`) — never trusting the
payload's origin (multi-origin: `web.app` vs the `/roster-app/` Pages mirror). Full rationale:
OPERATIONS_REFERENCE.md → "Huddle notification tap behaviour".

**This list and `SAFE_NOTIFICATION_PAGES` must match, entry for entry.** A security allowlist is
audited against its documentation, so an allowlisted page this list does not explain is the wrong way
round.

- Huddle → `#huddle` (opens the in-app Huddle viewer overlay).
- Pay → `paycalc.html?payday=YYYY-MM-DD` (the calculator opens on the right period).
- Circular / Newsletter → `#circular` / `#newsletter` (opens the in-app document viewer,
  `calendar-doc-viewer.js`).
- Password was reset → `settings.html` (no hash: a reset stamps the state in which the Password card
  opens ITSELF — `shouldOpen`, `settings-status.js` — so the member lands on it open, nudge showing).
- Reset request → `operations.html#reset-requests` (opens the queue card and scrolls to it, on a page
  of collapsed cards). A tap while Operations is ALREADY open re-reads the queue, and the hash is
  stripped once followed, so the next tap is a hash change rather than a repeat that fires nothing —
  `DEEP_LINK_CARDS` in `operations-app.js`.
- Timetable change → `trains.html`. A BROADCAST by design, sent ONCE by `sendTimetableReminder`
  (`functions/documents.js`, whose comment says why it is a date-guarded daily run and passes the
  "all 50 staff" test); the next change moves the one constant, `TIMETABLE_CHANGE`.
- Overtime → `overtime.html` (both the asked notice and the deadline reminder).
- Staff PIN blocked → `operations.html#login-accounts` (opens Staff Login Accounts, where the lockout's
  line is, through `DEEP_LINK_CARDS` — the card the strip's item opens too).
- Error Log → `operations.html#error-log` (opens and scrolls to the Error Log card, through the same
  `DEEP_LINK_CARDS`). A tap while Operations is ALREADY open re-reads the log — `operations-errors.js`,
  from the hash the event carried, because the page strips the hash in the same event.

## The builder (single source of truth)

All payloads go through `buildPushPayload({ feature, body, baseUrl, headline?, url? })` (top of this
file), backed by the `NOTIFICATION_FEATURES` map (emoji + tag + default headline + default path).
Hand-writing a `{ title, body, tag, url }` literal is **not allowed** — that is how the design
drifted (one notification used the app name as its title, another a marketing headline). The builder
guarantees the leading emoji, the tag, and the scope-relative URL.

## Adding a new notification type — checklist

1. Add a row to the feature table above and an entry to `NOTIFICATION_FEATURES` (emoji = the in-app
   icon for that feature; a stable `tag`; default headline; default path).
2. Choose the sub-type (document vs event) and write the title/body to that grammar.
3. If it deep-links to a new page/hash, add it to `SAFE_NOTIFICATION_PAGES` in the SW, and to the
   deep-link list above.
4. Build the payload with `buildPushPayload` — never a raw literal — and pick the right sender:
   **`fanOutPush`** if every member should see it, **`sendTargetedPush`** if it names or concerns one
   person, or applies only to some members (the pay reminder: CEA and CES). Ask "would I be happy for
   all 50 staff to read this?" — if not, it is targeted.
5. Add its tag to `PUSH_TTL_BY_TAG` (above).
6. Confirm against the length budgets and the no-exclamation tone rule. `sw-asset-check.test.mjs`
   checks the deep link's page is allowlisted, for both `hashPath` features and `url:`-at-call-time
   ones — but only when the url is written as a `${STAFF_SITE_URL}/…` template literal.

## VAPID fingerprint migration

`notif.js` stores the first 12 characters of the VAPID public key in `localStorage('myb_vapid_ver')`
(`VAPID_VER_KEY`). On a genuine key change — a NON-NULL stored fingerprint that differs — it silently
unsubscribes and re-subscribes; an absent or unreadable fingerprint is simply re-recorded.
`fanOutPush` deletes a subscription ONLY on 410/404 (genuinely dead); a 401 is a VAPID-auth failure
(server misconfiguration) and is logged, NOT deleted — deleting on 401 would wipe the whole
collection on any VAPID key error (`functions/push.js` header).
