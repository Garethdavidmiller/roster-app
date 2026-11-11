# DATA_MODEL.md — the Firestore collections

*Not version-stamped; not a runtime asset.*

**What it is, and what it is NOT.** It records what each collection HOLDS and what its fields MEAN —
the part no other artefact can express. It also summarises who may read and write each one, and that
half is a **convenience copy**: `firestore.rules` is the authority, `npm run test:rules` proves the
rules behave as written, and `firestore-contract-parity.test.mjs` proves they were written to match
the client. When this document and the rules disagree, **the rules are right and this is a bug**.

### Firestore collections

**overrides**
```
(doc id)     MANUAL records: `m_<date>_<encodeURIComponent(memberName)>` — ONE document per member
             and date (`manualOverrideId` in override-id.js). Two editors saving the same day land
             on the same document (last save wins) instead of leaving two records; a save also
             deletes any older manual record for that day, so earlier duplicates clear as days are
             re-saved. ROSTER IMPORTS keep random ids on purpose — an import and a manual record
             for one day coexist by design, the manual one winning (shouldReplaceOverride). Records
             written before the fixed ids keep their random ids until next saved.
             THE RULES HOLD AN `m_` ID TO ITS BODY: the id must equal `m_` + `date` + `_` + the
             memberName with spaces as `%20` — otherwise one member could create a colleague's id
             under their own name and lock the colleague out of saving that day. Rules have no
             encoder, so a roster name with any other encoded character would be refused on every
             manual save; override-utils.test.mjs fails first.
date         "YYYY-MM-DD"
memberName   Must match teamMembers[n].name exactly — one char mismatch = silent failure
type         "spare_shift" | "shift" | "rdw" | "annual_leave" | "correction" | "sick" | "other"
             Retired: "allocated" | "overtime" | "swap". No document is of these types: every one was
             converted on 4 Nov 2026 (Allocated shift and Swap → shift; Overtime → rdw on a base rest
             day, shift on a working day; any on a Sunday → rdw), and Operations' count afterwards read
             none left (owner, 7 Nov 2026). The names survive in `replacedType`
value        "HH:MM-HH:MM" for shift/rdw; "SPARE" for spare_shift; "AL" for annual_leave; "RD" for correction; "SICK" for sick;
             an Other day uses the grammar FLAVOUR[" RDW"][" HH:MM-HH:MM"] — the flavours are the keys
             of `OTHER_FLAVOURS` (override-utils.js, the grammar's single source), then an optional
             rest-day marker and optional actual times (see OTHER_DAYS.md)
note         WRITE-ONLY, and always `""`. The rules require the field present and a string, so every
             write still sends it — but nothing in the app can produce a value for it and nothing
             displays one. The three read paths (the calendar hover tooltip, the day-detail panel and
             the Admin Saved Changes list) were removed on the owner's decision: no override in
             production carries a note, nobody ever used the feature, and free text about a named
             colleague is a GDPR exposure with no purpose. Dropping the field itself is a THREE-PUSH
             backend-first sequence, because `hasOnly` and the `is string` check fail in opposite
             directions: (1) rules drop the `is string`/`size()` requirement while keeping `note` in
             `hasOnly`; (2) the client stops writing it; (3) rules drop it from `hasOnly`. Doing (2)
             or (3) first permission-denies every override write.
source       "manual" | "roster_import" — required by Firestore rules; written by all override save paths.
             The rules let ONLY the admin write "roster_import" (the import runs on the admin-only
             Operations page); a member or manager may write "manual" only
changedBy    Optional — display name of who last changed the override. The rules require it to EQUAL
             the writer's own bound name (`memberName()`), so "Last saved by" cannot be forged (a
             manager writing on behalf stamps their own name, which is what the field means)
replacedType Optional — the `type` of the override this document REPLACED, or absent when it
             replaced nothing. A write is delete-then-set, so recording annual leave DESTROYS the
             override that said what the day was; on a SWAPPED-IN day (a `shift` sitting on a base
             rest day) that deleted doc was the only evidence the member was contracted to work it,
             and without it `consumesEntitlement` falls back to the base roster, sees a rest day and
             charges nothing — the leave is free. Stamped by `nextReplacedType` (override-utils.js),
             which INHERITS when the type is unchanged so a re-save cannot erase the context, and
             CHAINS THROUGH an absence on a type change — swap → sick → AL keeps `shift`, because an
             absence carries no contract information of its own. Absent on documents written before
             the field existed; readers treat absence as "ask the base roster", so no migration is
             needed.
             Its values are the `type` vocabulary plus the three retired names, which leave or an
             absence written over one of those days before the 4 Nov 2026 conversion still carries:
             `swap`/`allocated` read as contracted, `overtime` as voluntary (`LEGACY_OVERRIDE_TYPES`,
             override-utils.js). They decide whether that leave cost a day, so they stay readable,
             and the rules still accept them because a re-save carries the name forward.
leaveYear    Optional — on ANNUAL LEAVE DATED IN JANUARY only: the year whose allowance the day
             comes out of, when that is the PREVIOUS year (owner, 3 Nov 2026 — some staff take a
             few of their 2026 days in early January 2027). Absent means the day counts against its
             own year, which is the default and what every earlier document says, so no migration.
             The rules hold the shape: `annual_leave`, a January date, and exactly the date's year
             minus one, as an integer. Who may set it is the ordinary isolation — a member on their
             own leave, a manager or the admin on anyone's. "No more than last year has left" is a
             count across documents, which rules cannot take, so the app refuses it
             (`leaveYearChoices`, al-entitlement.js). Read by `leaveYearOf` (leave-year.js);
             `countedAlDates` (al-entitlement.js) counts a day towards that year, which is why it
             reads the next January as well as its own year. Carried forward by `nextLeaveYear` on
             every rewrite of the day that keeps it annual leave — a write is delete-then-set, so
             without that an edit to the day would quietly move it back. Dropped when the day stops
             being annual leave. The depot workbook records carried days as one number added to the
             next year (AL_WORKBOOK.md §9), so the two agree on next year's remaining and differ on
             last year's by exactly the carried days.
createdAt    Firestore server timestamp — the rules require it to BE the server's clock at the write
             (`== request.time`), on create and on the fixed-id update alike, so the newest-wins
             ordering cannot be gamed. firestore.rules.test.mjs writes the real
             `buildOverrideWrite` output against all three pins
```
Override cache key: `"memberName|YYYY-MM-DD"`

**huddles**
```
date         "YYYY-MM-DD" — also the document ID
storageUrl   Permanent tokenised download URL (both manual upload and Cloud Function ingest — the ingest path uses a download token, NOT a signed URL: GCS caps v4 signed-URL expiry at 7 days, too short for the 3-month retention window). The app opens a short-lived URL from `getDocumentUrl` first and falls back to this one (ARCHITECTURE.md EXC-007)
storagePath  Firebase Storage object path, e.g. "huddles/2026-06-25-lv9kab12.pdf" — versioned suffix
             prevents overwriting the old file before Firestore commits; absent on the oldest docs —
             uploadHuddle's cleanup falls back to "huddles/{date}.{fileType}";
             pruneOldHuddles sweeps by the "huddles/<date>" prefix (covers legacy paths too).
             The rules bind it to its own collection (`huddles/<name>.pdf|docx`), because
             `getDocumentUrl` hands this path to the Admin Storage API, which would sign any object
fileType     "pdf" | "docx" — the short form on both paths: browser writes are rule-constrained to
             ['pdf','docx'], and the Cloud Function ingest writes the same (`functions/documents.js`)
uploadedAt   Firestore server timestamp — the rules require `== request.time` of a client write
uploadedBy   Member name string (manual upload) or "power-automate" (Cloud Function ingest)
htmlContent  Converted HTML string — present when a DOCX was uploaded/ingested; absent for PDFs. At most 250 KB (the rules cap it)
```
Reads: a bound member identity (`isMember()` — AUTH_AND_SESSIONS.md invariant 19), `admin`, or the shared `calendarViewer` capability. The client also refuses the read at source while the Calendar is locked (CALENDAR_DATA.md 15; Huddle notification tap behaviour in OPERATIONS_REFERENCE.md).
Writes: require auth + admin claim. Cloud Function writes via Admin SDK (bypasses rules).
Auto-prunes: docs older than **3 months** (Firestore doc + Storage file) are deleted by `pruneOldHuddles()` in `functions/documents.js`, awaited at the end of every `ingestHuddle` run (the daily path). Huddles are higher-volume than circulars/newsletters (which keep 6 months) and rarely referenced after the day, so retention is shorter. Storage delete on `/huddles` requires the admin-delete rule.

**staffContact**
```
memberName  Must match teamMembers[n].name exactly — used as the document ID
workEmail   Work email address (5–200 chars; must be the `@chilternrailways.co.uk` domain — case-insensitive, anchored so look-alikes/subdomains are rejected, and no whitespace in the local part). Enforced by firestore.rules AND the client `isChilternWorkEmail()` (roster-data.js, single source `CONFIG.WORK_EMAIL_DOMAIN`); keep the two in sync
updatedAt   Firestore server timestamp
```
Read/write restricted: owner can read/write/delete their own doc; admin can read, write and delete any.
The owner test is a bound member identity (`memberName()` — AUTH_AND_SESSIONS.md invariant 19) — anonymous and PIN sessions cannot write.
Purpose: account recovery. Self-service recovery by email is not built — `SECURITY_RELEASE_PLAN.md` track C2.
Read/written/deleted by: `getStaffContact` / `saveStaffContact` / `deleteStaffContact` in `firebase-client.js`, called from `settings-app.js` (own email) and from `operations-app.js`'s merged **Account status** card (`saveStaffContact`/`deleteStaffContact` for admin set/edit/remove on a member's behalf). `getAllStaffContacts` (reads all docs) is also called from `operations-app.js` (Account status card).

**passwordStatus** (PASSWORD_DESIGN.md Track C)
```
memberName   Must match teamMembers[n].name exactly — used as the document ID
passwordSetAt  Firestore server timestamp — the LAST time the member set their own password (Settings → Password). Written by the client (owner only).
resetAt        Firestore server timestamp — the last time this member's account was put back on their surname default: an admin reset (resetMemberPassword), or Set up accounts taking back an account registered outside the app or re-enabling a disabled one (setupRosterAuth). Written only by those Cloud Functions (Admin SDK, bypasses rules), and always BEFORE the password changes.
```
"Migrated" (has set their own password) = `passwordSetAt` present AND `passwordSetAt >= resetAt` (a later admin reset re-flags the account as surname-default). No password material is ever stored — only these two timestamps, which drive the Operations **Account status** table and the Settings status chip/nudge.
Read: owner or admin. Create/update (client): only the owner, only the `passwordSetAt` key, and it must equal `request.time` (so a client can only stamp "I just set my password now" on its own doc). `resetAt` is un-writable by any client (only the Admin SDK sets it). Delete: denied for everyone.
Written/read by: `savePasswordSetAt` / `getPasswordStatus` (owner) in `firebase-client.js` (called from `settings-app.js` after a successful password change), `getAllPasswordStatus` (admin, reads all) called from `operations-app.js` (Account status card), and the `resetMemberPassword` and `setupRosterAuth` Cloud Functions (write `resetAt`).

**resetRequests** (PASSWORD_DESIGN.md, the request queue)
```
memberName   Must match teamMembers[n].name exactly — used as the document ID
requestedAt  Firestore server timestamp — when they last asked
count        int — asks since the admin last cleared the row (so "asked 3 times" is visible)
provisioned  boolean — whether a Firebase account exists at all. false ⇒ the remedy is Set up
             accounts, NOT Reset. The login overlay must never distinguish these two (it would leak
             which names are provisioned); the admin's own card has no such constraint.
disabled     boolean — the account exists but is disabled (a leaver's, or one brought back since the
             last Set up accounts). A reset is refused for it; the remedy is Set up accounts, which
             re-enables it. Written beside `provisioned`, and absent with it when the lookup failed.
notifiedAt   Firestore server timestamp — when a push about this row was last ACCEPTED by at least
             one of the admin's subscriptions. Written only after `sendTargetedPush` reports a
             non-zero count, and read only by the global coalescing decision, which asks "was the
             admin actually reached inside the window?" — never "did another request arrive?",
             which would let a first push that failed silence a second member's real request for
             the rest of the window. Absence fails OPEN (notify).
notifyClaimedAt Firestore server timestamp — this row's request is SENDING the admin push now. Set in
             the same transaction that reads every row's `notifiedAt`, so one request in a burst
             claims and the rest coalesce; deleted when the send ends, and ignored once older than
             `ADMIN_NOTIFY_CLAIM_MS`, so a sender that died cannot hold the queue.
```
**Doc ID = the member name, deliberately:** the collection can therefore never exceed the roster size,
so flooding a public endpoint is impossible BY CONSTRUCTION rather than by rate limiting.
Read: admin only. **Create/update: DENIED to every client, including the admin** — the only writer is
the `requestPasswordReset` Cloud Function via the Admin SDK. That is not over-tightening: the member who
needs this has forgotten their password, so they have no Firebase identity at all (and nothing in the app
signs in anonymously), which is exactly why the request goes through a server endpoint instead of a
client write. Delete: admin only (clearing an actioned row).
No free text is ever stored — an unauthenticated endpoint writing caller-controlled strings into an admin
UI is an injection surface for no benefit; and the name comes from the server-owned `activeMembers` list,
never the request body, which is what makes it safe for the card to render.
Written by: the `requestPasswordReset` function. Read/cleared by: `getResetRequests` / `clearResetRequest`
in `firebase-client.js`, called from `operations-app.js`'s **Password Reset Requests** card. The member's
end is the login overlay's "Can't get in?" link (`requestPasswordReset` in `firebase-client.js` — the one
caller there that sends NO auth token).
**Admin notification:** a genuinely-RECORDED request (never a throttled repeat — the throttle is the
notification's rate limit too) pushes `🙋 Reset requests — N waiting` to the admin, deep-linking to
`operations.html#reset-requests`. It goes through `sendTargetedPush`, **not** `fanOutPush`:
"N. Surname is locked out" broadcast to all ~50 staff would be a leak, so the send is filtered by the
`owner` uid and fails closed at every step (no target uids → nothing; a subscription doc with no `owner`
→ skipped, never assumed; no matches → log and stop). There is deliberately **no fall-back-to-everyone
branch**. Accepted cost: an admin subscription record with no `owner` gets no push until it is re-saved
(toggling the bell off and on does it). The push can never fail the request — the row in Firestore is
the doorbell, the push is a courtesy on top. `.claude/rules/notifications.md` owns the payload rules.

**pushSubscriptions**
```
endpoint     Browser push endpoint URL — also used (hashed) as the document ID
keys.p256dh  base64url-encoded p256dh public key
keys.auth    base64url-encoded auth secret
subscribedAt Firestore server timestamp — required by the rules
owner        Optional — the writer's Firebase Auth uid, stamped by `savePushSubscription`
```
Written by `savePushSubscription`, deleted by `deletePushSubscription` in `firebase-client.js`.
Each document ID is a SHA-256 hash of the endpoint URL (first 20 hex chars). One doc per subscribed browser/device.
Read by the push senders in `functions/push.js` (Admin SDK) — `fanOutPush` for the broadcasts, `sendTargetedPush` for a notice addressed to named members (one person, the Overtime participants, or the pay reminder's CEA and CES members); a send that meets a 410/404 deletes that record server-side.
Client read: denied (`allow read: if false`) — no client may enumerate endpoints/keys. Create/update:
a signed-in member or the admin (never an anonymous token or the staff-PIN viewer), shape-validated
(`endpoint`, `keys.p256dh`, `keys.auth`, `subscribedAt`, and the optional `owner`). When `owner` is
present the rules require it to equal `request.auth.uid`, and an update to a doc that already carries
an `owner` must come from that same uid — or from the SAME BROWSER, proved by an unchanged `endpoint`
AND `keys`, because a session that ends without a sign-out leaves the record owned by the last member
and the next one on that phone must be able to re-save it. A session can only ever claim a
subscription its own browser holds. A legacy doc with NO `owner` may be claimed only with its
`endpoint` unchanged, or anybody could repoint a colleague's record at another URL and silently end
their notifications. **Delete (per-owner, A5 / F-SEC-5):** a signed-in member or the admin
(`isKnownIdentity` — never an anonymous token, and never the PIN viewer) may delete a doc **only if
`resource.data.owner == request.auth.uid`**, OR the doc carries **no `owner`** (legacy docs — kept
deletable so VAPID-rotation cleanup can't be locked out; orphans left by a uid change are swept
server-side by `fanOutPush`'s 410/404 cleanup), OR the doc is **already gone** — a no-op, so a second
sign-out is not read as a refusal that drops the browser subscription. An identity that merely knows a
doc id cannot delete somebody else's subscription.
Also deleted: on the drawer's Sign out and the Calendar's hand-over to the PIN (`releaseDevicePush`,
`notif.js`), and for a confirmed leaver by `setupRosterAuth`'s sweep (`releasePushForOwner`,
`functions/push.js`). Why each exists: `.claude/rules/notifications.md`.

**viewerAttempts** (the staff Calendar PIN throttle)
```
<doc id>     the SOURCE KEY, not a person — a privacy-conscious derivation of the request origin,
             or the fixed GLOBAL_SOURCE_KEY for the all-sources bucket. It is never a member name
             and never a raw address.
failures     int — failed unlock attempts inside the current window
windowStart  when that window opened
blockedUntil set once the limit is REACHED; the block expires on its own, deliberately, because a
             control any passer-by can drive into a permanent state is a denial-of-service handle
             pointed at the staff it protects
```
**Server-only: `allow read, write: if false`.** No client touches it — the only writer is
`unlockCalendarViewer` via the Admin SDK. **Only FAILURES stay recorded**: every attempt is charged
before its PIN is compared and a correct PIN is refunded (a refund to zero deletes the row), so the
collection can say who is guessing and never who is using the app. The rules and the thresholds are
argued in `functions/calendar-viewer-auth.js`; the operational view is OPERATIONS_REFERENCE.md → the
Calendar PIN.

**clientErrors**
```
memberName   Display name of the member whose session caught the error (≤ 100 chars)
page         Filename where the error occurred (e.g. "admin.html") (≤ 100 chars)
message      Error message string — capped at 300 chars
stack        Stack trace string — capped at 800 chars
appVersion   APP_VERSION string at time of capture
userAgent    navigator.userAgent — capped at 150 chars
timestamp    Firestore server timestamp (when the error occurred) — the rules require `== request.time`
resolved     boolean — false on create (the rules require it); set to true by admin to dismiss
resolvedAt   Firestore server timestamp — set when an admin resolves; retention is measured from this, not from `timestamp`
```
Write: a signed-in member, the admin, or the Calendar PIN viewer (`isKnownIdentity`); shape-validated by Firestore rules.
Read/update/delete: admin only (`request.auth.token.admin == true`).
Written by: `logClientError` (built in `analytics-client.js`, re-exported by `firebase-client.js`), called fire-and-forget from `error-reporter.js`.
Read/resolved by: `getClientErrors` / `resolveClientError` (same home), called from the Error Log card (`operations-errors.js`). `getClientErrors` queries unresolved and resolved separately (single-field equality, no composite index) so unresolved records are always prioritised — within expected operational volume (< 100 unresolved at once) a backlog of resolved records cannot hide them. It returns `{ errors, truncated }`: the unresolved query shows at most 100 with **no `orderBy`** (an `orderBy` would need the composite index this design deliberately avoids), so above that volume the shown 100 are arbitrary — not the newest. It fetches `100 + 1` and sets `truncated` only when the extra row returns (i.e. > 100 genuinely exist, not exactly 100), so the card shows a "showing the first 100" banner rather than silently hiding the rest (no silent caps). The resolved query is capped the same way (200 + 1, returned as `resolvedTruncated`). The prune does not ride on it: a third read asks for records whose `resolvedAt` is past `CLIENT_ERROR_RETENTION_MS` (`client-errors.js`) — a single-field range, auto-indexed — at most 200 per Error Log open, and deletes those.

**analytics** — anonymous usage counters; **no member identity is ever stored**
```
Document  analytics/pv_<YYYY-MM>   { month: "YYYY-MM", counts: { <pageId>: <int> } }  — page popularity per month
Document  analytics/activeAccounts { months: { "YYYY-MM": <int> }, daily: { "YYYY-MM-DD": <int> } } — member-device counts: per month, and each member-device's ONE count on its latest active day
Document  analytics/origins       { daily: { "<YYYY-MM-DD>|<origin>[|pwa]": <int> } } — WHICH ADDRESS each account is on (migration tracking)
Document  analytics/perf_<YYYY-MM> { month: "YYYY-MM", samples: { "<ver>|<page>|<metric>|<bucket>|<mode>|<conn>": <int> } } — page-load latency. Metrics (`perf-reporter.js` is the list): fcp ("first appears") · domReady ("code loaded") · **ready** ("usable" — the page's own content on screen, from `markPageReady`) · readyUpdate (the wait after a release reload) · rosterSnapshot (the member's own stored roster painted before the sign-in check) · loginTotal (sign-in, page id `login`). **Only time somebody spent waiting**: a load nobody watched records nothing, and `ready` is dropped once the page asked somebody to type. Retired in Oct 2026 and present only in older months: ttfb, the boot phases swBoot/sdkLoad/appBoot, the ladder rungs authBoot/access/rosterCached/rosterLive, readyCached/readyFetched, readyProvisional, swrCount/readyHeavySwr. The `samples` map is exempt from indexing (`firestore.indexes.json`) — every release adds keys, and a full record refuses every later write silently, so the card states how full it is. Admin loads excluded
```
**Page ids and open ids.** `counts` takes one page id per app page and the **document/guide OPEN
counters** — `huddle`, `circular`, `newsletter` and one `guide-*` id per `NAV_GUIDES` entry. The
authoritative list is `pvCountIds()` in `firestore.rules`, judged against the ids a write adds or
changes — so an id can come off it as soon as no client writes it (the month's document keeps the old
key, untouched, and it stops nothing); extend it when adding a page or a guide, because `firestore-contract-parity.test.mjs` checks it against the app both ways, so a missing
id is a test failure rather than a silently dropped counter. A page id also needs an entry in
`PAGE_META` (`operations-reports.js`), or BOTH reporting cards print the bare id and a generic 📄;
`page-contract-parity.test.mjs` fails on either omission. Opens are incremented by
`recordOpen(itemId, signedIn)` in `usage-reporter.js` at the real "opened" moments (Huddle viewer
auto-open in `calendar-huddle-viewer.js`; the nav-drawer Circular/Newsletter open and the guide-link
taps in `nav-panel.js` — the static guides have no Firebase, so their only in-app route is where the
open is counted; the notification-tap doc viewer's Open button in `calendar-doc-viewer.js`). Same
write-time admin exclusion as page views — a SIGNED-IN admin's opens are never recorded; no dedup —
every open counts. **The guide id lives on its `NAV_GUIDES` entry and is stamped onto the link as
`data-open-id`** — never matched from the href, because `'./paycalc-guide.html'.includes('guide.html')`
is TRUE and a substring test would count every Pay Calculator Guide open as a Staff Guide open, with
both bars still looking plausible; `firestore-contract-parity.test.mjs` fails if a `NAV_GUIDES` entry
has no `openId`. The Operations Usage card renders them as a separate "Documents & guides — opens" bar
group under Page popularity.

Uniqueness of "active accounts" is deduped **client-side** (localStorage flags keyed by member name, which never leave the device) so the server only ever receives increments — it stores *how many* accounts were active, never *which*. "Last 30 days" = sum of the `daily` buckets over the rolling window, and **each member-device holds ONE count there, on its latest active day** (`rollingMove`, usage-stats.js, whose header has the reasoning): an open on a new day writes `+1` on today and `-1` on the day the count sat on, in one merged write, so the sum counts everyone active in the window. The window sum and each address row are clamped at zero, because a lost `+1` leaves its `-1` behind until that day leaves the window. Counts are per member-device (multi-device users count more than once) — a usage trend, not an exact headcount. **The EXACT unique count sits beside it** and comes from a different source entirely: the `getSignInStats` Cloud Function reads Firebase Auth's own `lastSignInTime`, so uniqueness is a property of the data rather than something the app has to enforce — and nothing new is stored (no per-account record, no identity returned). It measures **sign-ins, not activity**: sessions last 60 days, so most page opens are session RESTORES. The 30-day sign-in window is therefore SHORTER than a session and no longer bounds active people in either direction — it misses anyone signed in 31–60 days ago who uses the app daily, as well as including anyone who signed in once and stopped. Do not describe it as bounding active people unless its window is derived from `SESSION_MS`. There is no month-over-month history either (only the LAST sign-in is stored). Both figures are shown, each labelled with what it measures — the exact one does not replace the trend. `neverSignedIn` is the actionable number: accounts provisioned by Set up accounts that have never been used.
Write: a signed-in member, the admin, or the Calendar PIN viewer (`isKnownIdentity`) — an ANONYMOUS token is refused, because the anonymous provider is still enabled on the project and anyone holding the public API key could mint one. A `pv_`/`perf_` document is accepted only for the present month or one either side, by the server's UTC clock (the client names the month by its own clock), so no session can create documents for months nobody is in. Nothing in the app signs in anonymously. The same identity is required to write `clientErrors` and `pushSubscriptions` (where the viewer stays excluded). Values aren't individually validatable (Firestore can't restrict to increment-only) — App Check is the eventual integrity control; the data is non-sensitive aggregate counts. On UPDATE a non-admin write may not remove an existing key (the anti-wipe guard); the moved count's `-1` relies on exactly that: it is an ordinary write the guard allows, because it removes no key (`firestore.rules.test.mjs` writes the real payload as a member and as the PIN viewer). No client delete.
Read: admin only (`request.auth.token.admin == true`).
Written by: `recordPageView` / `recordActiveAccount` in `analytics-client.js`, called from `usage-reporter.js` (`recordUsage`) on every page. Read by: `getUsageStats` in `analytics-client.js`, which also prunes daily buckets older than `DAILY_RETENTION_DAYS` (usage-stats.js), called from the Usage card in `operations-usage.js`. Decision/aggregation maths is the pure `usage-stats.js` module.
The `perf_<YYYY-MM>` doc holds anonymous page-load latency: `recordPageLatency(page, identity?)` in `perf-reporter.js` records the metrics above and calls `recordPerfSample` (analytics-client.js), batched into one merged write per open; key dimensions (version/page/metric/bucket/PWA mode/connection class) are non-identifying — no member, no raw ms. **Admin (developer) sessions are excluded** so figures reflect real staff. The Operations "App speed" card (`getPerfStats` → `initPageSpeedCard`, `operations-speed.js`) reads THIS month + LAST month and shows 🔑 Signing in, 📄 Opening pages (✨ First appears / 📦 Code loaded / ✅ Usable, then each page's three bars) and 🔍 A closer look at the busiest page — the stored copy before the sign-in check, the wait after a release, and Usable by app version and by how the page was opened. The maths is the pure `perf-stats.js`: `THIN_SAMPLE` governs the whole card, a value that is not a whole-number count is refused when read (any signed-in session writes the values), and the three percentages always add to 100. Versions roll up into ranges (`v20.10–v20.19`) for the reason in AI_MAP, and no range crosses v24.98, where the way of timing changed.

**Per-address migration counters (`analytics/origins`).** While the app is served from BOTH `myb-roster.web.app` and the GitHub Pages mirror, this is the only record of how far the move has got. Keys are `YYYY-MM-DD|<origin>` and `YYYY-MM-DD|<origin>|pwa`; `<origin>` is a closed label set (`web`/`pages`/`fb`/`other`, from `originLabel` — never a raw hostname, whose dots would nest the map key). Deduped client-side per member, and — like the account count — each count MOVES to its member-device's latest day on that address: `+1` on today, `-1` on the day it left, never anything that names who.

**Two INDEPENDENT dedup flags** (`myb_origin_seen_<member>` and `myb_origin_pwa_<member>`), not one: a single flag would freeze whichever mode an account happened to use first, so anyone who opened a browser tab before opening the installed app would never be counted as installed — and that is the entire question. `recordOriginUse({ countVisit, installed, fromDay, fromPwaDay })` therefore takes the two gates separately, each with the day its count is leaving; `countVisit:false, installed:true` is the real case where an account whose visit is already on today has just opened the installed app.

**Deduped on the acting identity** — the signed-in member, or on a device nobody is signed in to, the Calendar's selected member — so calendar-only staff (the majority, and exactly the people a migration strands) appear. Never an admin: a signed-in admin records nothing, and an admin SELECTION (the station PC left on the admin's row) records the page view but no member-device and no address. The identity never leaves the device.

**A SEPARATE doc from `activeAccounts`, deliberately.** That doc's rule pins it to `hasOnly(['months','daily'])` and Firestore evaluates the RESULTING document — so the moment a client wrote an extra key there, the doc would permanently contain it and every later write, including the counters that already work, would be denied until the rules deploy caught up. Hosting and rules ship from the same push via separate workflows with no ordering guarantee. Here a rules lag costs only the new metric.

**What it cannot see:** it counts OPENS, so an install nobody has opened in 30 days is invisible; someone using both addresses counts on each (which is what half-migrated looks like); and admin loads are excluded like every other metric. The Operations Usage card states all of this under the bars. Written by `recordOriginUse` (built in `analytics-client.js`, re-exported by `firebase-client.js`) ← `_recordOrigin` in `usage-reporter.js`; read by `getUsageStats` → `summariseOrigins`; rendered by `_appendOriginSection` in `operations-usage.js`.

**Admin-exclusion (usage + speed):** both `recordUsage` and `recordPageLatency` drop a session whose SIGNED-IN member is in `CONFIG.ADMIN_NAMES` — the figures must reflect real staff, not the developer's own testing. **Only the signed-in member excludes**: the Calendar's selected member is whose roster is on screen, not who is looking, and on the station PC a selection left on the admin's row would otherwise drop every staff open there. **A release reload records nothing** in the usage counts — the reload the app does itself after an update is not somebody opening a page, and it was about one Calendar open in seven in September 2026. App Speed and the usage counter read the same once-per-load answer (`perf-reporter.loadFollowedRelease`). It is a WRITE-time filter (no identity is stored, so it can't be filtered on read); data from before the filter existed stays polluted. The Operations cards also offer a **This month / Last month** window (month-over-month trend; last month is a stable full window early in a month) — active accounts keep their "Last 30 days" rolling figure.

**circulars**
```
date         "YYYY-MM-DD" — also used as the document ID; re-uploading the same date overwrites
storageUrl   Permanent tokenised download URL
storagePath  Firebase Storage object path, e.g. "circulars/2026-06-25-lv9kab12.pdf"
             (versioned suffix prevents overwriting the old file before Firestore commits);
             absent on the oldest docs — pruneOldDocs falls back to "{collection}/{date}.{fileType}".
             Bound by the rules to its own collection, as for huddles
fileType     "pdf" | "docx" (no inline HTML conversion — a PDF opens directly, a Word doc opens via Microsoft's Office Online viewer (`officeViewerUrl`, storage-utils.js) so it renders with images instead of downloading; rule-constrained to [pdf,docx])
uploadedAt   Firestore server timestamp — the rules require `== request.time`; the retention sweep (`pruneOldDocs`) trusts it as its clock
uploadedBy   Member name string
```
Read: a bound member identity (`isMember()` — AUTH_AND_SESSIONS.md invariant 19), `admin`, or the shared `calendarViewer` (matches the Huddle model). Write: admin only (Storage rules also enforce PDF-or-DOCX, ≤20 MB).
Written by: `uploadCircular(date, file, uploadedBy)` in `firebase-client.js`, called from `operations-app.js`.
Read by: `getLatestCircular()` in `firebase-client.js`, called from **`nav-panel.js`** (☰ → Weekly Retail Circular — opens **directly** in a new tab, one tap: a PDF by its URL, a Word doc via the Office Online viewer; the URL is a short-lived one from `getDocumentUrl` when the server grants it, else the stored `storageUrl`) and from **`calendar-doc-viewer.js`** (the `#circular` in-app viewer used by **notification taps only**, which have no user gesture to open the file directly).
Auto-prunes: documents older than 6 months are deleted (Firestore doc + Storage file) fire-and-forget on every upload via `pruneOldDocs()` in `doc-retention.js`.

**newsletters**
```
date         "YYYY-MM-DD" — also used as the document ID; re-uploading the same date overwrites
storageUrl   Permanent tokenised download URL
storagePath  Firebase Storage object path, e.g. "newsletters/2026-06-25-lv9kab12.pdf";
             absent on the oldest docs — pruneOldDocs falls back to "{collection}/{date}.{fileType}".
             Bound by the rules to its own collection, as for huddles
fileType     "pdf" | "docx" (no inline HTML conversion — a PDF opens directly, a Word doc opens via Microsoft's Office Online viewer (`officeViewerUrl`, storage-utils.js) so it renders with images instead of downloading; rule-constrained to [pdf,docx])
uploadedAt   Firestore server timestamp — the rules require `== request.time`; the retention sweep (`pruneOldDocs`) trusts it as its clock
uploadedBy   Member name string
```
Read: a bound member identity (`isMember()` — AUTH_AND_SESSIONS.md invariant 19), `admin`, or the shared `calendarViewer` (matches the Huddle model). Write: admin only (Storage rules also enforce PDF-or-DOCX, ≤20 MB).
Written by: `uploadNewsletter(date, file, uploadedBy)` in `firebase-client.js`, called from `operations-app.js`.
Read by: `getLatestNewsletter()` in `firebase-client.js`, called from **`nav-panel.js`** (☰ → Marylebone Newsletter — opens **directly** in a new tab, one tap: a PDF by its URL, a Word doc via the Office Online viewer; short-lived `getDocumentUrl` URL first, stored `storageUrl` as fallback) and from **`calendar-doc-viewer.js`** (the `#newsletter` in-app viewer used by **notification taps only**).
Auto-prunes: documents older than 6 months are deleted (Firestore doc + Storage file) fire-and-forget on every upload via `pruneOldDocs()` in `doc-retention.js`.

**linkDesigns**
```
name        Design name
patterns    Full-rotation pattern data, one entry per line (`ROTATING_LINES`)
window      The design's own OPERATING WINDOW (when the station is staffed) — `normaliseWindow`,
            links-window.js. Stored PER DESIGN so a proposal can test a moved boundary. Every path
            that rebuilds a design must carry it (`links-design-doc.js`): a design restored without
            it comes back wearing the app default, and the next save writes that default over the
            boundary the design existed to test.
updatedAt   Firestore server timestamp
updatedBy   Member name string — the last to SAVE. A rename on a baseline it could not verify does
            not write it (links-design-store.js), because the content is still that person's.
revision    Optional int >= 1 (absent on designs last written before it existed) — the co-editing
            CONCURRENCY IDENTITY a save compares against, for equality only. A
            transaction writes the value it read + 1; a QUEUED (offline) write stamps the clock in
            ms instead, so it can never equal a colleague's online revision (links-design-store.js).
deletedAt   Optional — Firestore server timestamp. PRESENT = in the "Recently deleted" bin (hidden
            from the picker, restorable until somebody removes it by hand — the bin is permanent and
            nothing expires a design, links-deletion.js); ABSENT = live. Restore clears it with
            deleteField(), so absence is unambiguous.
deletedBy   Optional — display name of whoever deleted it
```
Read: a **named** session — a bound member identity (`isMember()`) or `admin`. Deliberately NOT narrowed to `linksDesigner`: a designer whose token predates that claim must still be able to LOAD the workspace so their first write can permission-deny and self-heal through `writeWithClaimRetry`. Write: requires the `linksDesigner` claim OR `admin` (H2), and create/update is **shape-validated** — the authoritative key list is the `hasOnly([…])` in `firestore.rules` and the payload builder `docPayload` in `links-design-doc.js`; **do not restate it here**, because a copy here once omitted `window` while the rules and the payload carried it. `name` is a 1–100 char string, `patterns` a map, `updatedAt` a timestamp, `updatedBy` a ≤100 char string; `window`, `revision`, `deletedAt` and `deletedBy` are optional and type-checked when present (a live design carries neither delete field). **A hard delete is allowed only on a design already in the bin** (`deletedAt` present), so a client that deletes from a stale list can only fail, never destroy a live design. `linksDesigner` is set by `setupRosterAuth` from `CONFIG.LINKS_DESIGNERS`; every write goes through the design store with `writeWithClaimRetry`, so a stale token self-heals, and saves atomically via `runTransaction`. Designs are **not** member-owned (no per-member isolation — any designer edits, deletes or restores any design).
Written by: `links-design-store.js` — every design write, through `createDesignStore`. Read by: `links-app.js`
(`loadDesigns` reads directly, because it needs `metadata.fromCache`) and the store's `loadAll` (the refresh).

**linkTargetSets**
```
name         Set name, 1–60 chars (e.g. "Set A")
slots        The generator target table: [{time: "HH:MM-HH:MM", weekday, sat, sun}], 1–60 rows
spareLines   int, 0–29 — whole cover-week lines
createdBy    The CREATOR's member name — the ownership key. Pinned by the rules to the writer's own
             bound member identity (`memberName()`) on create, and IMMUTABLE on update (ownership is not transferable by editing)
updatedBy    Whoever last wrote (the admin can overwrite anyone's set; createdBy still never moves)
updatedAt    Firestore server timestamp
```
Named snapshots of the generator's target table, shared between the designers, so "others can mess
about but not lose my set" (owner, Aug 2026) holds across devices. Read: named session or admin
(matches linkDesigns, same self-heal reasoning). Create: `linksDesigner` or admin, shape-validated,
`createdBy == memberName()`. Update/delete: only the creator or the admin. The client's
Save button asks the same question (`canOverwriteTargetSet`) but that copy only decides what is
OFFERED — the rules are the protection. Read, overwritten and deleted through `links-target-sets-store.js`
(`list`, `writeIfUnchanged`); a NEW set is created directly by `links-generator-targets.js` (`addDoc`),
which also wires the generator card's Saved sets row; rules covered case-for-case by
`firestore.rules.test.mjs`. There is no bin behind a set the way there is behind a design: deleting
one is final, which is why the confirm names it and is marked destructive.

**overtimeWindows** — a TREE, not a flat collection, and the only one no client may write
*Overtime is paused (`OVERTIME_AVAILABILITY.md` → Paused): no new window is made, and the purge below goes on removing the ones that exist.*
```
overtimeWindows/{weekEnding}                       the window. Doc id = the week-ending Saturday,
                                                   so a duplicate is impossible BY CONSTRUCTION
  weekEnding / weekStart      "YYYY-MM-DD"
  initialDeadlineAt           Timestamp — 18 days before the Saturday, 12:00 London
  finalDeadlineAt             Timestamp — 11 days before, 12:00 London
  draftRosterDate / finalRosterDate   "YYYY-MM-DD" — calendar dates; "Thursday" has no clock time
  retentionUntil              Timestamp — 91 days after the Saturday, 00:00 London
  policyVersion               int — which milestone rules produced the dates above
  audience                    "restricted" | "all" — resolved SERVER-side at creation, never sent
  createdAt / createdByName / createdByUid
  reminderSentAt              Timestamp — CLAIMED by the scheduler, in a transaction, BEFORE the
                              deadline-morning reminder is sent (claimed first because, stamped
                              after the send, two overlapping runs could both send). Idempotency
                              stamp: it protects the ONE morning against a re-run, and once noon
                              passes the phase moves and the question is closed. Server-written
  reminderOutstanding         int — written AFTER that reminder's send: the participants it was for
                              (not withdrawn, nothing submitted, and not sent the asked notice in
                              the same run); 0 = nobody needed reminding. Absent = outcome not recorded
  reminderAccepted            int — push subscriptions that accepted that reminder (`sendTargetedPush`'s
                              count; 0 = it reached nobody: no account, no subscribed device, or the
                              push failed). Absent = outcome not recorded

  /participants/{memberName}  the FROZEN population. Written once, at creation, never rewritten
    memberName · grade · rosterOrder · createdAt
    uid                       null until that member's first submission, then stamped. Nothing
                              reads it — it is the recovery route if a member is ever renamed
    withdrawn / withdrawnAt / withdrawnBy   present ONLY on a withdrawal. The freeze's one
                              exception: a LEAVER otherwise stays a permanent non-responder in every
                              open week. They come out of `expected`, out of every panel and out of
                              the chip — nothing is deleted, and the page names who withdrew them.
                              The flag also reaches the MEMBER: `getMyOvertimeState` drops the
                              window and `submitOvertimeAvailability` refuses
                              (OVERTIME_AVAILABILITY.md invariant 12).
                              Written by `withdrawOvertimeParticipant`, refused on a CLOSED week
                              (that week is the record). Restoring REMOVES the three fields rather
                              than writing `withdrawn: false`, because `where('withdrawn','==',true)`
                              never matches a missing field — which is why the counts subtract the
                              withdrawn instead of filtering for the rest, or every participant
                              written before this feature would vanish from the count

  /submissions/{memberName}   the HEAD — current answer only
    memberName · uid · currentRevision · days · firstAcceptedAt · updatedAt · lastMutationId
    lastMutationSeenAt · schemaVersion

    /revisions/{rev}          APPEND-ONLY history: weekEnding · memberName · uid · revision · days
                              acceptedAt · mutationId · schemaVersion
                              `acceptedAt` (and the head's updatedAt / firstAcceptedAt) is the instant
                              the server DECIDED the phase, not the later commit, so an answer
                              judged in time is never stamped late
```
**Deadlines are stored, never recomputed** — a window keeps the timetable it ran under even if the
offsets change later, which is what `policyVersion` records. `initialRevision` and `lateInitial` are
**derived** from the revisions (`deriveHistory`), never stored: a stored summary is a second answer
that can disagree with the history it summarises.
Read: reviewer only — `admin` or `manager`. Ordinary members get **nothing** from Firestore; their
whole world arrives through `getMyOvertimeState`, which resolves participation server-side.
Write: **`if false` for every client**, including admin. The only writer is the Admin SDK, through
the one transactional endpoint — so a head can never point at a revision that does not exist.
Retention: enforced in BOTH read endpoints rather than in the rules. Rules are not filters — a
`resource.data` condition fails the whole query rather than dropping a row, so one expired document
would blank a reviewer's workspace. `purgeExpiredOvertimeWindows` (daily, 04:00 London) then removes
expired windows bottom-up — revisions → heads → participants → parent, **parent last**, because
Firestore does not cascade and a parent deleted alone orphans the tree permanently. It **arms itself
on a date** (`PURGE_ARMS_AT` / `purgeArmedAt` in `functions/overtime-core.js` — 1 Dec 2026): until
then it walks and logs what it would remove and deletes nothing. Arming changes nothing anyone
sees — expired windows are already invisible and inert. Both read endpoints (`getMyOvertimeState` and
`getOvertimeManagerOverview`) query with a `retentionUntil` inequality, so neither grows with the
expired rows the purge has not yet reached.
Written by: `functions/overtime.js`. Read by: `getMyOvertimeState` (members) and `loadWeekDetail` in
`overtime-data.js` (the reviewer's one direct read). Full design: `OVERTIME_AVAILABILITY.md`.

### Authentication — what the rules above depend on

Not a collection, so only the facts the collections lean on are here, each pointing at its home.

- **Sign-in** is a name (dropdown) and a password. The **default** password is the member's surname
  (lowercase, no spaces or special characters); a member can set their own in Settings → Password,
  and sign-in tries the typed password and then, for anyone still on the default, the surname
  (`credentialCandidatesFor` in `auth-identity.js` builds the ordered list, `ensureFirebaseSession`
  tries each). An admin reset returns an account to the default (Operations → Account status →
  Reset, the `resetMemberPassword` Cloud Function). The default is not a secret: protection rests on
  Firebase Auth's rate-limiting and on rules that believe a member only on their own password account
  — `ARCHITECTURE.md` EXC-005, and `PASSWORD_DESIGN.md` for the design and phasing.
- **Sessions expire 60 days after sign-in, full stop** (`SESSION_MS` in `session.js` —
  `AUTH_AND_SESSIONS.md` invariant 2). Everything that genuinely REVOKES access is immediate: an
  explicit sign-out (which signs Firebase out too), a disabled or deleted account, revoked Firebase
  credentials, and the claim-epoch sweep.
- **Every member rule above keys on a bound identity** — `isMember()` / `memberName()` in
  `firestore.rules`, `AUTH_AND_SESSIONS.md` invariant 19. The `admin`, `manager` and `linksDesigner`
  claims come from `CONFIG.ADMIN_NAMES`, `CONFIG.MANAGER_NAMES` and `CONFIG.LINKS_DESIGNERS` in
  `roster-data.js`, stamped by `setupRosterAuth` from the generated `functions/roster-members.json`.
- **The login dropdown** groups members by grade in the order of `CONFIG.GRADE_ORDER` in
  `roster-data.js` (shared by `login-overlay.js` and `admin-app.js`). `managerOnly: true` members
  appear **only** in the Management group and are hidden from the calendar's member selector — they
  have login access but no roster of their own.
- **Forced migration.** `CONFIG.FORCE_PASSWORD_SET` (a kill switch, currently `true`) makes
  `password-force.js` compel a member still on the surname default to choose their own password **at
  their next sign-in**. Nobody is signed out to accelerate it: the 60-day cap completes coverage on
  its own, staggered by each member's own expiry. It shows only for a `named` identity — never a
  staff-PIN session nor a soft-failed Pay Calculator one, where `updatePassword` cannot succeed and
  the block would be unsatisfiable — and fails open on any failure it cannot recover from. A member
  who only ever views the roster never signs in and is never compelled: accepted (reaching them means
  Track E). **It is the ONLY post-login overlay.** If a second one is ever added, read the note above
  `_show` in `password-force.js` first — anything that must happen when an overlay OPENS has to fire
  before the await, never after it.
- **The staff Calendar PIN.** The Calendar opens for a named member session OR the shared staff PIN,
  and for nothing else. A shared office PC enters four digits and gets the full Calendar, overrides
  included, in a session that lives exactly as long as the browser session. The viewer's
  custom-token session is never a bound member identity: it holds no `admin`, `manager` or
  `linksDesigner` claim and cannot write any roster, leave or account data — only the telemetry
  every session may write (`clientErrors`, `analytics` counters). The PIN value lives only in the
  `CALENDAR_VIEWER_PIN` secret. Design: `calendar-access.js` / `calendar-access-core.js`; the
  contracts: `CALENDAR_DATA.md` and `AUTH_AND_SESSIONS.md`; operations and rotation:
  OPERATIONS_REFERENCE.md. **A support question to expect:** a member who has never signed in has to
  unlock each browser session; signing in once (a 60-day session) removes the PIN entirely, which is
  what the Calendar's own front door offers first.
- **The Firebase SDK version** is the one `firebase-client.js` imports — check it before any new
  Firebase work. **An SDK bump must also update `FIREBASE_SDK_VERSION` in `service-worker.js`** (the
  SDK offline cache is keyed on it) — `sw-asset-check.test.mjs` fails the build if they diverge.

---
