---
paths:
  - "functions/push.js"
  - "functions/roster-parse-helpers.js"
  - "functions/documents.js"
  - "functions/pay-reminder.js"
  - "functions/overtime*.js"
  - "functions/auth-endpoints.js"
  - "functions/index.js"
  - "service-worker.js"
  - "notif.js"
  - "firebase-client.js"
  - "push-transport.test.mjs"
  - "notif.test.mjs"
  - "sw-notification-tap.test.mjs"
  - "sw-asset-check.test.mjs"
  - "roster-parse-helpers.test.mjs"
---

# Push notification design language

The one app surface rendered by the **OS**, not by our CSS — so it cannot inherit the design system
and needs its own explicit rules. Every Web Push notification staff receive must follow them. They
are enforced by a single builder, `buildPushPayload` in `functions/roster-parse-helpers.js`, which
the senders import (`functions/documents.js`, `functions/pay-reminder.js`, `functions/overtime.js`,
`functions/auth-endpoints.js`); the service worker renders the result.

## The core principle (what ties a notification to the app)

**A notification's leading emoji is the SAME emoji the app already uses for that feature** in the
nav drawer and on its card. That reuse is what makes a notification visibly belong to its part of
the app — at no asset cost, no CSP change, and reliably on both Android and iOS (emoji render
inline). The icon is always the app icon (brand identity); the **emoji carries feature identity**.

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

When the app gains a new notifying feature, add ONE row here and ONE entry to the
`NOTIFICATION_FEATURES` map — never hand-write a payload.

## Two sub-types, two grammars

**1. Document arrival** (huddle / circular / newsletter) — a new document is available. A document
is republished regularly and the Huddle in particular is sent the **evening before** for the next
day's plan, so **never** use day-relative words ("Today's", "Tomorrow's") — they are wrong by the
time the notification is read. Use **"Latest"**:

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

## Who receives it — broadcast or targeted

**Broadcasts** (`fanOutPush`, every subscribed device): the three documents and the one-off timetable
reminder. **Everything else is targeted** (`sendTargetedPush`, to named uids only) — the pay reminder
to CEA and CES members only, the grades the Pay Calculator prices (owner, 10 Nov 2026;
`functions/pay-reminder.js`), and the rest because of what it SAYS:

- **The reset request goes to the admin's devices only** — "N. Surname is locked out" sent to 50
  people is a leak, not a notification.
- **`password-reset` goes to the member whose password was reset, on their own devices.** Otherwise
  the one person the reset concerns is the only one not told: their credential became the surname
  default and their other devices were signed out, and they would find out by failing to sign in.
- **Both Overtime notices** go to member uids resolved from the account email — the asked notice to
  whoever a window newly asked (one per member per scheduler run, naming their soonest deadline), the
  reminder only to participants who have submitted NOTHING on the deadline's morning. A broadcast
  would ping every member about a restricted beta, and at full launch "targeted to participants"
  already reaches everyone eligible, so the reach scales itself with no code change. Deadlines are
  worded in LONDON time by the pure builders in `functions/overtime-core.js`
  (`askedNotice`/`reminderNotice`), never composed inline.

**`sendTargetedPush` fails closed at every step**: no target uids → send nothing; a subscription
doc with no `owner` (written before owners were stamped) → skipped, never assumed; no matches → log
and stop. There is deliberately **no "no targets → fall back to everyone" branch**. Any new
addressed-to-one-person notification uses `sendTargetedPush` and keeps that shape.

**The `owner` must never outlive the member's hold on the device:**

- **Sign-out.** The drawer's Sign out — once the page has committed to it (a `beforeSignOut` cancel
  keeps the record) — and the Calendar's "Use the staff PIN instead" hand-over call
  `releaseDevicePush` (`notif.js`), which deletes this device's record, so a targeted notice never
  follows a member onto a shared device they have left. The next signed-in CALENDAR load re-saves the
  record as whoever is signed in then (`getNotifState`'s only caller). Until then, a member who signs
  in on another page sees notifications as on, because the bell and Settings read the browser's own
  subscription (`peekNotifState`), with no record behind it. **Where the delete cannot run as the owner** (the Calendar's member card is shown
  precisely when the member's Firebase identity has gone), the browser subscription is dropped
  instead, and the next send's 410 makes the server delete the record.
- **A hold that ends without a sign-out.** `reconcileExpiredIdentity` releases the record before
  signing out an expired session's lingering identity, and a session the last password reset refuses
  releases it too — on a station PC left on the staff PIN, no next member ever comes to take it over.
- **A leaver.** `fanOutPush` consults no owner, so a leaver who never signed out would go on
  receiving every broadcast. The confirmed leaver sweep in `setupRosterAuth` deletes the records the
  disabled account owns (`releasePushForOwner`, `functions/push.js`).
- **A session that simply ENDED.** The rules let the SAME browser take its record over — same
  endpoint AND same keys, which exist only in that browser and in a record no client can read — and
  `notif.js` re-saves at once, without waiting for its 24-hour re-save throttle, when the signed-in
  uid differs from the one it last saved under (`myb_push_saved_owner`).

**Two properties of `password-reset` are load-bearing and easy to undo:**

- **The new password is NEVER in the payload.** A push renders on a LOCK SCREEN, so naming it would
  show it to whoever picks the phone up — and the default is derived from a surname that is on the
  roster. The body says that it changed and where to fix it, and nothing else.
- **The uid is the one the endpoint already resolved** to write the password, not a fresh
  name→address→uid lookup. The reset-request notice needs that lookup because it is addressed to
  whoever holds the admin role; this one is addressed to the account being changed, which the
  handler is already holding. There is no resolution step to widen or miss.

`resetMemberPassword` reports the send as `notified`, a third independently-reported stage beside
`revoked` and `stamped`: the credential has already changed by that line, so a push failure must
never report the reset as failed. A member with no subscription is a legitimate `false`, and
Operations turns exactly that case — signed out AND not told — into the admin's cue to tell them
another way.

**Why the queue depth is in the reset-request title.** One stable tag per feature means a second
request *replaces* the first on the lock screen. So the headline states the current total
(`2 waiting`) and the body names whoever just asked — the newest notification is always an accurate
summary of the whole queue. Wording is built by the pure `buildResetRequestNotice`
(`functions/roster-parse-helpers.js`, tested in `roster-parse-helpers.test.mjs`), never inline.

## Only to a push service

A subscription's `endpoint` is written by a browser, and the rules can check only its type and
length, so a signed-in account could store a URL of its choosing and every later fan-out would make
the Cloud Function POST to it. Both senders therefore pass every endpoint through
`isAllowedPushEndpoint` (`functions/roster-parse-helpers.js`) first: HTTPS, default port, no
credentials, and a host in `PUSH_SERVICE_HOSTS` (Google, Mozilla, Apple, Microsoft). A refused
endpoint is **skipped and logged, never deleted** — an unknown host may be a real provider the list
has not met, and **a new browser's push service must be added to that list**, or its users silently
stop receiving notifications. The guard is at the SEND, so it also covers records stored before it
existed.

## When the push service rotates a subscription

iOS retires a push endpoint on its own schedule and tells the SERVICE WORKER alone, through
`pushsubscriptionchange`; the pages are not running. Unanswered, the server keeps the dead endpoint,
the next send gets a 410 and deletes it, and the device's bell reads "off" with nobody having turned
anything off. So the worker re-subscribes with the key the old subscription carried (it holds no copy
of the VAPID key — `notif.js` and `functions/index.js` stay the two that must agree), and `notif.js`
remembers the endpoint it last saved (`myb_push_saved_endpoint`) and re-saves the record at once
when the live one differs, without waiting for its 24-hour throttle. A browser that hands over
neither a renewal nor the old key is left alone: the next check reads the lapse.

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
queue 6 h, password-reset 7 days, the timetable reminder 30 h (sent at 18:00 on the Saturday; 24 h
would expire at 18:00 on the Sunday, before a phone that was off all day came back), anything
unlisted one day. **A new notification feature adds its tag there**, or it gets a day;
`push-transport.test.mjs` fails on a feature with no TTL.

## Icon, badge, tag

- **`icon`** — always the app icon (`icon-192.png`), resolved against `registration.scope` (not the
  bare origin — the GitHub Pages sub-path install would 404). Shared across all notifications for
  brand identity.
- **`badge`** — MUST be a **monochrome silhouette** (`icon-badge.png`, white-on-transparent,
  ~96×96). Android masks the badge to a single colour in the status bar; feeding it the full-colour
  app icon produces a muddy blob. **Never use `icon-192.png` as the badge.**
- **`tag`** — one stable string per feature (table above). Same tag ⇒ a repeat replaces the previous
  one in the Notification Centre instead of stacking. `renotify: true` so a replacement still alerts.

**The first two are ENFORCED** by `sw-asset-check.test.mjs`, beside the deep-link allowlist check.
Neither failure is visible from anywhere a test or a reviewer looks — the push is delivered, the tap
works, and the notification is simply wrong on the phone, because the OS draws it. The guard also
requires both assets to be precached (derived from the warm-up calls, not a typed list of array
names) and the badge to be a different FILE from the app icon, since a copy under the right name
passes every check by spelling while producing the exact blob the rule forbids. **Do not write a
second guard for these** — extend that one.

## Deep link

Every notification deep-links to **its feature's surface within scope**. The Cloud Function hardcodes
one absolute URL; the service worker takes only the page + query + hash and **re-bases it onto the
local install's scope** (`SAFE_NOTIFICATION_PAGES` in `service-worker.js`) — never trusting the
payload's origin (multi-origin: `web.app` vs the `/roster-app/` Pages mirror). Add a feature's landing
page to `SAFE_NOTIFICATION_PAGES` when adding the feature. Full rationale: OPERATIONS_REFERENCE.md →
"Huddle notification tap behaviour".

**This list and `SAFE_NOTIFICATION_PAGES` must match, entry for entry.** A security allowlist is
audited against its documentation, so an allowlisted page this list does not explain is the wrong way
round.

- Huddle → `#huddle` (opens the in-app Huddle viewer overlay).
- Pay → `paycalc.html?payday=YYYY-MM-DD` (the calculator opens on the right period).
- Circular / Newsletter → `#circular` / `#newsletter` (opens the in-app document viewer,
  `calendar-doc-viewer.js`).
- Password was reset → `settings.html` (no hash: the Password card opens ITSELF when its state says
  to — `shouldOpen` in `settings-status.js` — and a reset stamps exactly that state, so the member
  lands on the card already open with the nudge showing).
- Reset request → `operations.html#reset-requests` (opens the queue card and scrolls to it —
  `DEEP_LINK_CARDS` in `operations-app.js`; Operations is a page of collapsed cards, so landing on it
  alone would leave the admin hunting for the one the notification was about). A tap while Operations
  is ALREADY open re-reads the queue, and the hash is stripped once followed, so the next tap is a hash
  change rather than a repeat that fires nothing.
- Timetable change → `trains.html`. A BROADCAST by design, sent ONCE by `sendTimetableReminder`
  (`functions/documents.js` — daily at 18:00 London, guarded to the evening before `TIMETABLE_CHANGE`):
  a timetable every member will be asked about passes the "all 50 staff" test by itself. The next
  change moves the one constant; the function is harmless on every other evening.
- Overtime → `overtime.html` (both the asked notice and the deadline reminder).

## The builder (single source of truth)

All payloads go through `buildPushPayload({ feature, body, baseUrl, headline?, url? })` in
`functions/roster-parse-helpers.js` (imported by each sender), backed by the `NOTIFICATION_FEATURES`
map (emoji + tag + default headline + default path). Hand-writing a `{ title, body, tag, url }`
literal is **not allowed** — that is how the design drifted (one notification used the app name as
its title, another a marketing headline). The builder guarantees the leading emoji, the tag, and the
scope-relative URL.

## Adding a new notification type — checklist

1. Add a row to the feature table above and an entry to `NOTIFICATION_FEATURES` (emoji = the in-app
   icon for that feature; a stable `tag`; default headline; default path).
2. Choose the sub-type (document vs event) and write the title/body to that grammar.
3. If it deep-links to a new page/hash, add it to `SAFE_NOTIFICATION_PAGES` in the SW, and to the
   deep-link list above.
4. Build the payload with `buildPushPayload` — never a raw literal — and pick the right sender:
   **`fanOutPush`** if every member should see it, **`sendTargetedPush`** if it names or concerns one
   person, or applies only to some members (the pay reminder: CEA and CES). Ask "would I be happy for all 50 staff to read this?" — if not, it is targeted.
5. Add its tag to `PUSH_TTL_BY_TAG` (above).
6. Confirm against the length budgets and the no-exclamation tone rule. `sw-asset-check.test.mjs`
   checks the deep link's page is allowlisted, for both `hashPath` features and `url:`-at-call-time
   ones — but only when the url is written as a `${STAFF_SITE_URL}/…` template literal.

## VAPID fingerprint migration

`notif.js` stores the first 12 characters of the VAPID public key in `localStorage('myb_vapid_ver')`
(`VAPID_VER_KEY`). On a genuine key change — a NON-NULL stored fingerprint that differs — it silently
unsubscribes and re-subscribes; an absent or unreadable fingerprint is simply re-recorded.
`fanOutPush` deletes a subscription ONLY on 410/404 (genuinely dead); a 401 is a VAPID-auth failure
(server misconfiguration, not a dead endpoint) and is logged, NOT deleted — deleting on 401 would wipe
the whole collection on any VAPID key error (the `functions/push.js` header has the reasoning).
