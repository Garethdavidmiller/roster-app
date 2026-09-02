# DATA_MODEL.md — the Firestore collections

*Split out of `CLAUDE.md` on 2 Sep 2026, from an external review of the Markdown estate. Not
version-stamped; not a runtime asset.*

**Why this is its own document.** It was 42,303 characters — 14% of a file loaded into every session
regardless of what that session is doing. A member working on the Huddle paid for the Overtime window
tree, and vice versa. Nothing enforced its presence in `CLAUDE.md`: `doc-parity.test.mjs` requires
modules, tests, e2e specs and runner configs to be routed from there, and says nothing about
collection schemas.

**What it is, and what it is NOT.** It records what each collection HOLDS and what its fields MEAN —
the part no other artefact can express. It also summarises who may read and write each one, and that
half is a **convenience copy**: `firestore.rules` is the authority, `npm run test:rules` proves the
rules behave as written, and `firestore-contract-parity.test.mjs` proves they were written to match
the client. When this document and the rules disagree, **the rules are right and this is a bug**.

**Moved VERBATIM.** Nothing below was rewritten, condensed or re-ordered in the split.

### Firestore collections

**overrides**
```
date         "YYYY-MM-DD"
memberName   Must match teamMembers[n].name exactly — one char mismatch = silent failure
type         "spare_shift" | "shift" | "rdw" | "annual_leave" | "correction" | "sick" | "other"
             Legacy (still in data, not creatable): "allocated" | "overtime" | "swap"
value        "HH:MM-HH:MM" for shift/rdw; "SPARE" for spare_shift; "AL" for annual_leave; "RD" for correction; "SICK" for sick;
             training uses the grammar FLAVOUR[" RDW"][" HH:MM-HH:MM"] — flavour "TRG"|"IND"|"ASSESS"|"TEAM", optional rest-day
             marker, optional actual times (see OTHER_PLAN.md; grammar single-source: override-utils.js)
note         Free text — "" if none. Field must always be present.
source       "manual" | "roster_import" — required by Firestore rules; written by all override save paths
changedBy    Optional — display name of who last changed the override; type-checked by the rules when present
replacedType Optional (v21.55) — the `type` of the override this document REPLACED, or absent when it
             replaced nothing. A write is delete-then-set, so recording annual leave DESTROYS the
             override that said what the day was; on a SWAPPED-IN day (a `shift` sitting on a base
             rest day) that deleted doc was the only evidence the member was contracted to work it,
             and without it `consumesEntitlement` falls back to the base roster, sees a rest day and
             charges nothing — the leave is free. Stamped by `nextReplacedType` (override-utils.js),
             which INHERITS when the type is unchanged so a re-save cannot erase the context, and
             CHAINS THROUGH an absence on a type change (v21.56) — swap → sick → AL keeps `shift`,
             because an absence carries no contract information of its own. Absent
             on every document written before v21.55; readers treat absence as "ask the base
             roster", which is exactly what they did before, so no migration is needed.
createdAt    Firestore server timestamp
```

**huddles**
```
date         "YYYY-MM-DD" — also the document ID
storageUrl   Permanent tokenised download URL (both manual upload and Cloud Function ingest — the ingest path uses a download token, NOT a signed URL: GCS caps v4 signed-URL expiry at 7 days, too short for the 3-month retention window)
storagePath  Firebase Storage object path, e.g. "huddles/2026-06-25-lv9kab12.pdf" — versioned suffix
             prevents overwriting the old file before Firestore commits; absent on docs written before
             versioned paths — uploadHuddle's cleanup falls back to "huddles/{date}.{fileType}";
             pruneOldHuddles sweeps by the "huddles/<date>" prefix (covers legacy paths too)
fileType     "pdf" | "docx" — short form on browser writes (rule-constrained to ['pdf','docx'] since v14.29);
             the Cloud Function ingest path uses the Admin SDK and may store a MIME string
uploadedAt   Firestore server timestamp
uploadedBy   Member name string (manual upload) or "power-automate" (Cloud Function ingest)
htmlContent  Converted HTML string — present when a DOCX was uploaded/ingested; absent for PDFs
```
Reads: open (no auth required — calendar-app.js has no session; see Huddle notification tap behaviour in OPERATIONS_REFERENCE.md).
Writes: require auth + admin claim. Cloud Function writes via Admin SDK (bypasses rules).
Auto-prunes: docs older than **3 months** (Firestore doc + Storage file) are deleted by `pruneOldHuddles()` in `functions/index.js`, awaited at the end of every `ingestHuddle` run (the daily path). Huddles are higher-volume than circulars/newsletters (which keep 6 months) and rarely referenced after the day, so retention is shorter (v14.29). Storage delete on `/huddles` requires the admin-delete rule (v14.29).

**staffContact** (v12.68)
```
memberName  Must match teamMembers[n].name exactly — used as the document ID
workEmail   Work email address (5–200 chars; must be the `@chilternrailways.co.uk` domain — case-insensitive, anchored so look-alikes/subdomains are rejected, and no whitespace in the local part). Enforced by firestore.rules AND the client `isChilternWorkEmail()` (roster-data.js, single source `CONFIG.WORK_EMAIL_DOMAIN`); keep the two in sync (v14.97; rule local-part whitespace tightened v16.34)
updatedAt   Firestore server timestamp
```
Read/write restricted: owner can read/write their own doc; admin can read all.
Write requires the `name` JWT claim (set by setupRosterAuth) — anonymous fallback sessions cannot write.
Purpose: Stage 1 of password security improvements. Email will enable future account recovery (Stage 4).
Read/written/deleted by: `getStaffContact` / `saveStaffContact` / `deleteStaffContact` in `firebase-client.js`, called from `settings-app.js` (own email) and from `operations-app.js`'s merged **Account status** card (`saveStaffContact`/`deleteStaffContact` for admin set/edit/remove on a member's behalf). `getAllStaffContacts` (reads all docs) is also called from `operations-app.js` (Account status card).

**passwordStatus** (v18.63 — PASSWORD_PLAN.md Track C)
```
memberName   Must match teamMembers[n].name exactly — used as the document ID
passwordSetAt  Firestore server timestamp — the LAST time the member set their own password (Settings → Password). Written by the client (owner only).
resetAt        Firestore server timestamp — the last time an admin RESET this member back to their surname default. Written ONLY by the resetMemberPassword Cloud Function (Admin SDK, bypasses rules).
```
"Migrated" (has set their own password) = `passwordSetAt` present AND `passwordSetAt >= resetAt` (a later admin reset re-flags the account as surname-default). No password material is ever stored — only these two timestamps, which drive the Operations **Account status** table and the Settings status chip/nudge.
Read: owner or admin. Create/update (client): only the owner, only the `passwordSetAt` key, and it must equal `request.time` (so a client can only stamp "I just set my password now" on its own doc). `resetAt` is un-writable by any client (only the Admin SDK sets it). Delete: denied for everyone.
Written/read by: `savePasswordSetAt` / `getPasswordStatus` (owner) in `firebase-client.js` (called from `settings-app.js` after a successful password change), `getAllPasswordStatus` (admin, reads all) called from `operations-app.js` (Account status card), and the `resetMemberPassword` Cloud Function (writes `resetAt`).

**resetRequests** (v18.93 — PASSWORD_PLAN.md, the request queue)
```
memberName   Must match teamMembers[n].name exactly — used as the document ID
requestedAt  Firestore server timestamp — when they last asked
count        int — asks since the admin last cleared the row (so "asked 3 times" is visible)
provisioned  boolean — whether a Firebase account exists at all. false ⇒ the remedy is Set up
             accounts, NOT Reset. The login overlay must never distinguish these two (it would leak
             which names are provisioned); the admin's own card has no such constraint.
notifiedAt   Firestore server timestamp — when a push about this row was last ACCEPTED by at least
             one of the admin's subscriptions (v21.85). Written only after `sendTargetedPush`
             reports a non-zero count, and read only by the global coalescing decision, which asks
             "was the admin actually reached inside the window?". It used to ask about the other
             rows' `requestedAt` instead — i.e. it treated *another request arrived* as *the admin
             was told*, so a first push that failed silenced the second member's real request for
             the rest of the window. Absent on every row written before v21.85, and absence fails
             OPEN (notify), which is what makes the transition safe.
```
**Doc ID = the member name, deliberately:** the collection can therefore never exceed the roster size,
so flooding a public endpoint is impossible BY CONSTRUCTION rather than by rate limiting.
Read: admin only. **Create/update: DENIED to every client, including the admin** — the only writer is
the `requestPasswordReset` Cloud Function via the Admin SDK. That is not over-tightening: the member who
needs this has forgotten their password, so they have no Firebase identity at all (and `signInAnonymously`
runs only on the calendar), which is exactly why the request goes through a server endpoint instead of a
client write. Delete: admin only (clearing an actioned row).
No free text is ever stored — an unauthenticated endpoint writing caller-controlled strings into an admin
UI is an injection surface for no benefit; and the name comes from the server-owned `activeMembers` list,
never the request body, which is what makes it safe for the card to render.
Written by: the `requestPasswordReset` function. Read/cleared by: `getResetRequests` / `clearResetRequest`
in `firebase-client.js`, called from `operations-app.js`'s **Password Reset Requests** card. The member's
end is the login overlay's "Can't get in?" link (`requestPasswordReset` in `firebase-client.js` — the one
caller there that sends NO auth token).
**Admin notification (Phase 2, v18.95):** a genuinely-RECORDED request (never a throttled repeat — the
throttle is the notification's rate limit too) pushes `🙋 Reset requests — N waiting` to the admin, deep
-linking to `operations.html#reset-requests`. It goes through `sendTargetedPush`, **not** `fanOutPush`:
"N. Surname is locked out" broadcast to all ~50 staff would be a leak, so the send is filtered by the
`owner` uid and fails closed at every step (no target uids → nothing; a subscription doc with no `owner`
→ skipped, never assumed; no matches → log and stop). There is deliberately **no fall-back-to-everyone
branch**. Accepted cost: an admin device that subscribed before v17.76 (when `owner` was first stamped)
gets no push until the bell is toggled off and on. The push can never fail the request — the row in
Firestore is the doorbell, the push is a courtesy on top.

**pushSubscriptions**
```
endpoint     Browser push endpoint URL — also used (hashed) as the document ID
keys.p256dh  base64url-encoded p256dh public key
keys.auth    base64url-encoded auth secret
subscribedAt Firestore server timestamp — required by the rules
```
Written by `savePushSubscription`, deleted by `deletePushSubscription` in `firebase-client.js`.
Each document ID is a SHA-256 hash of the endpoint URL (first 20 hex chars). One doc per subscribed browser/device.
Read by the `ingestHuddle` Cloud Function (Admin SDK) when fanning out push notifications.
Client read: denied (`allow read: if false`) — no client may enumerate endpoints/keys. Create/update:
any authenticated session, shape-validated (`endpoint`, `keys.p256dh`, `keys.auth`, `subscribedAt`, and
the optional `owner`). `owner` = the writer's Firebase Auth uid, stamped by `savePushSubscription`; when
present the rules require it to equal `request.auth.uid`, so a session can only ever claim its own
subscription. **Delete (per-owner, A5 / F-SEC-5, v17.76 — was `request.auth != null` for any id):** an
authenticated session may delete a doc **only if `resource.data.owner == request.auth.uid`**, OR the doc
carries **no `owner`** (legacy docs written by older clients — kept deletable so VAPID-rotation cleanup
can't be locked out; orphans left by a uid change are swept server-side by `fanOutPush`'s 410/404
cleanup). New subscriptions are protected immediately; legacy ones harden as devices re-subscribe. This
closes the F-SEC-5 hardening gap (an identity that merely knew a doc id could previously delete any
subscription).

**clientErrors** (v13.31)
```
memberName   Display name of the member whose session caught the error
page         Filename where the error occurred (e.g. "admin.html")
message      Error message string — capped at 300 chars
stack        Stack trace string — capped at 800 chars
appVersion   APP_VERSION string at time of capture
userAgent    navigator.userAgent — capped at 150 chars
timestamp    Firestore server timestamp (when the error occurred)
resolved     boolean — false on create; set to true by admin to dismiss
resolvedAt   Firestore server timestamp — set when an admin resolves; retention is measured from this (90 days), not from `timestamp`
```
Write: any authenticated session (`request.auth != null`); shape-validated by Firestore rules.
Read/update/delete: admin only (`request.auth.token.admin == true`).
Written by: `logClientError` in `firebase-client.js`, called fire-and-forget from `error-reporter.js`.
Read/resolved by: `getClientErrors` / `resolveClientError` in `firebase-client.js`, called from `operations-app.js` Error Log card. `getClientErrors` queries unresolved and resolved separately (single-field equality, no composite index) so unresolved records are always prioritised — within expected operational volume (< 100 unresolved at once) a backlog of resolved records cannot hide them. It returns `{ errors, truncated }`: the unresolved query shows at most 100 with **no `orderBy`** (an `orderBy` would need the composite index this design deliberately avoids), so above that volume the shown 100 are arbitrary — not the newest. It fetches `100 + 1` and sets `truncated` only when the extra row returns (i.e. > 100 genuinely exist, not exactly 100), so the card shows a "showing the first 100" banner rather than silently hiding the rest (no-silent-caps, v15.69). Prunes resolved records 90 days past `resolvedAt`.

**analytics** (v14.14) — anonymous usage counters; **no member identity is ever stored**
```
Document  analytics/pv_<YYYY-MM>   { month: "YYYY-MM", counts: { <pageId>: <int> } }  — page popularity per month
Document  analytics/activeAccounts { months: { "YYYY-MM": <int> }, daily: { "YYYY-MM-DD": <int> } } — unique active-account counts
Document  analytics/origins       { daily: { "<YYYY-MM-DD>|<origin>[|pwa]": <int> } } — WHICH ADDRESS each account is on (v19.23; migration tracking)
Document  analytics/perf_<YYYY-MM> { month: "YYYY-MM", samples: { "<ver>|<page>|<metric>|<bucket>|<mode>|<conn>": <int> } } — page-load latency (Project 0, v14.89). Metrics: ttfb · fcp (first-contentful-paint, "appears") · domReady ("fully ready") · **ready** ("usable" — the page's own content on screen, from `markPageReady`; recorded whenever that mark arrives rather than only if it happened to precede the reading, v21.16) · loginTotal (sign-in) · the three BOOT PHASES swBoot/sdkLoad/appBoot (v20.33 — contiguous spans of a load: SW wake → serve, serve → the `myb-sdk-ready` mark firebase-client.js sets as its body runs, mark → DCL; they let the card's "By stage of start-up" block state WHERE a slow start went instead of inferring it). admin loads excluded (v14.95)
```
Page ids: `calendar` | `admin` | `paycalc` | `operations` | `settings` | `links` | `overtime` (added v20.59; this list said six until v20.85, the same release the Operations card learned to spell it — the id was allowlisted and counting the whole time, so nothing failed, it just rendered as the raw word). A page id needs an entry in `PAGE_META` (`operations-reports.js`) as well as the rules allowlist, or BOTH reporting cards print the bare id and a generic 📄; `page-contract-parity.test.mjs` now fails on either omission. The same `counts` map also carries the **document/guide OPEN counters** (v18.20; every guide counted since v19.95, and the Rangers guide joined them at v20.05): `huddle` | `circular` | `newsletter` | `guide-staff` | `guide-paycalc` | `guide-railcard` | `guide-fip` | `guide-rangers` — incremented by `recordOpen(itemId, identity)` in `usage-reporter.js` at the real "opened" moments (Huddle viewer auto-open in `calendar-huddle-viewer.js`; the nav-drawer Circular/Newsletter open and the guide-link taps in `nav-panel.js` — the static guides have no Firebase, so their only in-app route is where the open is counted; the notification-tap doc viewer's Open button in `calendar-doc-viewer.js`). Same write-time admin exclusion as page views (the developer's opens are never recorded); no dedup — every open counts. All of them are allowlisted in `firestore.rules` (extend the allowlist when adding one — `firestore-contract-parity.test.mjs` checks the two lists both ways, so a missing id is a test failure rather than a silently-dropped counter). **The guide id lives on its `NAV_GUIDES` entry and is stamped onto the link as `data-open-id`** — never matched from the href, because `'./paycalc-guide.html'.includes('guide.html')` is TRUE and a substring test would count every Pay Calculator Guide open as a Staff Guide open, with both bars still looking plausible. Until v19.95 only two guides had a branch at all, so the group answered a narrower question than its heading claimed; `firestore-contract-parity.test.mjs` now fails if a `NAV_GUIDES` entry has no `openId` or the two lists drift. The Operations Usage card renders them as a separate "Documents & guides — opens" bar group under Page popularity.
Uniqueness of "active accounts" is deduped **client-side** (localStorage flags keyed by member name, which never leave the device) so the server only ever receives `increment(1)` — it stores *how many* accounts were active, never *which*. "Last 30 days" = sum of the `daily` buckets over the rolling window (each account self-suppresses for the window, so the sum is a true unique count). Counts are per account-device (multi-device users count more than once) — a usage trend, not an exact headcount. **The EXACT unique count sits beside it (v18.96)** and comes from a different source entirely: the `getSignInStats` Cloud Function reads Firebase Auth's own `lastSignInTime`, so uniqueness is a property of the data rather than something the app has to enforce — and nothing new is stored (no per-account record, no identity returned). It measures **sign-ins, not activity**: sessions last 60 days, so most page opens are session RESTORES. The 30-day sign-in window is therefore SHORTER than a session and no longer bounds active people in either direction — it misses anyone signed in 31–60 days ago who uses the app daily, as well as including anyone who signed in once and stopped (until v20.47 the session was 30 days, which made it a slight OVER-count; do not restore that claim unless the window is derived from `SESSION_MS`). There is no month-over-month history either (only the LAST sign-in is stored). Both figures are shown, each labelled with what it measures — the exact one does not replace the trend. `neverSignedIn` is the actionable number: accounts provisioned by Set up accounts that have never been used.
Write: any authenticated session (`request.auth != null`), including the calendar's anonymous Firebase session. Values aren't individually validatable (Firestore can't restrict to increment-only) — App Check is the eventual integrity control; the data is non-sensitive aggregate counts. No client delete.
Read: admin only (`request.auth.token.admin == true`).
Written by: `recordPageView` / `recordActiveAccount` in `firebase-client.js`, called from `usage-reporter.js` (`recordUsage`) on every page. Read by: `getUsageStats` in `firebase-client.js`, called from `operations-app.js` Usage card (which also prunes daily buckets past ~35 days). Decision/aggregation maths is the pure `usage-stats.js` module.
The `perf_<YYYY-MM>` doc (Project 0, v14.89) holds anonymous page-load latency: `recordPageLatency(page, identity?)` in `perf-reporter.js` buckets Navigation Timing (`ttfb`/`domReady`) **and Paint Timing (`fcp` — first-contentful-paint, "appears on screen")** and calls `recordPerfSample` in `firebase-client.js`; key dimensions (version/page/metric/bucket/PWA mode/connection class) are non-identifying — no member, no raw ms. **Admin (developer) sessions are excluded** so figures reflect real staff. The Operations "App speed" card (`getPerfStats` → `initPageSpeedCard`) reads THIS month + LAST month and shows two journeys — 🔑 Signing in, and 📄 Opening pages as two milestones (✨ First appears / ✅ Fully ready) with both bars per page. Bucketing/verdict maths is the pure `perf-stats.js` module. **"Why some are slower" (v20.19)** breaks the BUSIEST page down by connection, install mode and app version — dimensions every sample has always carried and the card used to discard, so it could say which page was slow and nothing about why. Read-side only; the busiest page is chosen at render rather than hardcoded. **The thin-sample rule is `THIN_SAMPLE` in `perf-stats.js` and now governs the whole card (v21.16)** — the breakdown rows, the per-page table AND the headline verdicts, which had no such test at all: a real month produced a confident amber claim about signing in from a sample one below the card's own bar for meaninglessness, and a full-width red bar against a page with three opens. Below it a verdict states the percentage and withholds the CLAIM (`tone: 'thin'`), because a handful of loads can read 100% and mean nothing. Each row states **"% over 1s"** — the complement of the card's own headline — not "% slow": the first real data showed every row reading 0–3% slow beside a bar with a wide amber middle, i.e. the tail is *over one second*, not over three, and a number naming the wrong band is trusted over the bar beside it. Versions roll up into ranges (`v20.10–v20.19`) for the reason in AI_MAP.

**Per-address migration counters (`analytics/origins`, v19.23).** While the app is served from BOTH `myb-roster.web.app` and the GitHub Pages mirror, this is the only record of how far the move has got. Keys are `YYYY-MM-DD|<origin>` and `YYYY-MM-DD|<origin>|pwa`; `<origin>` is a closed label set (`web`/`pages`/`fb`/`other`, from `originLabel` — never a raw hostname, whose dots would nest the map key). Deduped client-side per member per rolling 30 days, so the server only ever sees `+1`.

**Two INDEPENDENT dedup flags** (`myb_origin_seen_<member>` and `myb_origin_pwa_<member>`), not one: a single flag would freeze whichever mode an account happened to use first, so anyone who opened a browser tab before opening the installed app would never be counted as installed — and that is the entire question. `recordOriginUse({ countVisit, installed })` therefore takes the two gates separately; `countVisit:false, installed:true` is the real case where an account already counted this window has just opened the installed app.

**Deduped on `identity`, NOT `member`** — active accounts only count signed-in pages, so calendar-only staff (the majority, and exactly the people a migration strands) would never appear. `identity` is the calendar's selected member and never leaves the device.

**A SEPARATE doc from `activeAccounts`, deliberately.** That doc's rule pins it to `hasOnly(['months','daily'])` and Firestore evaluates the RESULTING document — so the moment a client wrote an extra key there, the doc would permanently contain it and every later write, including the counters that already work, would be denied until the rules deploy caught up. Hosting and rules ship from the same push via separate workflows with no ordering guarantee. Here a rules lag costs only the new metric.

**What it cannot see:** it counts OPENS, so an install nobody has opened in 30 days is invisible; someone using both addresses counts on each (which is what half-migrated looks like); and admin loads are excluded like every other metric. The Operations Usage card states all of this under the bars. Written by `recordOriginUse` in `firebase-client.js` ← `_recordOrigin` in `usage-reporter.js`; read by `getUsageStats` → `summariseOrigins`; rendered by `_appendOriginSection` in `operations-usage.js`.

**Admin-exclusion (usage + speed, v14.95):** both `recordUsage` and `recordPageLatency` drop a session whose active member is in `CONFIG.ADMIN_NAMES` — the figures must reflect real staff, not the developer's own testing. It is a WRITE-time filter (no identity is stored, so it can't be filtered on read); historical pre-v14.95 data stays polluted, but is clean going forward. The Operations cards now also offer a **This month / Last month** window (month-over-month trend; last month is a stable full window early in a month) — active accounts keep their existing "Last 30 days" rolling figure.

**circulars** (v13.58)
```
date         "YYYY-MM-DD" — also used as the document ID; re-uploading the same date overwrites
storageUrl   Permanent tokenised download URL
storagePath  Firebase Storage object path, e.g. "circulars/2026-06-25-lv9kab12.pdf" — added v13.99
             (versioned suffix prevents overwriting the old file before Firestore commits);
             absent on docs uploaded before v13.99 — pruneOldDocs falls back to "{collection}/{date}.{fileType}"
fileType     "pdf" | "docx" (Word uploads allowed since v16.31; no inline HTML conversion — a PDF opens directly, a Word doc opens via Microsoft's Office Online viewer (`officeViewerUrl`, v16.45) so it renders with images instead of downloading; rule-constrained to [pdf,docx])
uploadedAt   Firestore server timestamp
uploadedBy   Member name string
```
Read: open (no auth required — `calendar-app.js` has no session; matches Huddle model). Write: admin only (Storage rules also enforce PDF-or-DOCX, ≤20 MB).
Written by: `uploadCircular(date, file, uploadedBy)` in `firebase-client.js`, called from `operations-app.js`.
Read by: `getLatestCircular()` in `firebase-client.js`, called from **`nav-panel.js`** (☰ → Weekly Retail Circular — opens **directly** in a new tab, one tap: a PDF by its own URL, a Word doc via the Office Online viewer) and from **`calendar-doc-viewer.js`** (the `#circular` in-app viewer used by **notification taps only**, which have no user gesture to open the file directly).
Auto-prunes: documents older than 6 months are deleted (Firestore doc + Storage file) fire-and-forget on every upload via `pruneOldDocs()` in `doc-retention.js`.

**newsletters** (v13.59)
```
date         "YYYY-MM-DD" — also used as the document ID; re-uploading the same date overwrites
storageUrl   Permanent tokenised download URL
storagePath  Firebase Storage object path, e.g. "newsletters/2026-06-25-lv9kab12.pdf" — added v13.99;
             absent on docs uploaded before v13.99 — pruneOldDocs falls back to "{collection}/{date}.{fileType}"
fileType     "pdf" | "docx" (Word uploads allowed since v16.31; no inline HTML conversion — a PDF opens directly, a Word doc opens via Microsoft's Office Online viewer (`officeViewerUrl`, v16.45) so it renders with images instead of downloading; rule-constrained to [pdf,docx])
uploadedAt   Firestore server timestamp
uploadedBy   Member name string
```
Read: open (no auth required — `calendar-app.js` has no session; matches Huddle model). Write: admin only (Storage rules also enforce PDF-or-DOCX, ≤20 MB).
Written by: `uploadNewsletter(date, file, uploadedBy)` in `firebase-client.js`, called from `operations-app.js`.
Read by: `getLatestNewsletter()` in `firebase-client.js`, called from **`nav-panel.js`** (☰ → Marylebone Newsletter — opens **directly** in a new tab, one tap: a PDF by its own URL, a Word doc via the Office Online viewer) and from **`calendar-doc-viewer.js`** (the `#newsletter` in-app viewer used by **notification taps only**).
Auto-prunes: documents older than 6 months are deleted (Firestore doc + Storage file) fire-and-forget on every upload via `pruneOldDocs()` in `doc-retention.js`.

**linkDesigns** (v12.09)
```
name        Design name
patterns    Full-rotation pattern data, one entry per line (`ROTATING_LINES`)
window      The design's own OPERATING WINDOW (when the station is staffed) — `normaliseWindow`,
            links-window.js. Stored PER DESIGN so a proposal can test a moved boundary. Omitted
            from this block until v21.63: a design restored without it comes back wearing the app
            default, and the next save writes that default over the boundary the design existed
            to test (the v19.55 bug). RECOVERY_RUNBOOK playbook C carried the same omission.
updatedAt   Firestore server timestamp
updatedBy   Member name string
deletedAt   Optional (v19.41) — Firestore server timestamp. PRESENT = in the "Recently deleted"
            bin (hidden from the picker, restorable until removed by hand — automatic expiry SUSPENDED v19.86, see KNOWN_LIMITATIONS); ABSENT = live. Restore clears
            it with deleteField(), so absence is unambiguous.
deletedBy   Optional (v19.41) — display name of whoever deleted it
```
Read: a **named** session — `'name' in request.auth.token`, or `admin` (v19.39; was `request.auth != null`, which sounded like "any signed-in member" but included the calendar's unconditional `signInAnonymously` session, i.e. any visitor who could open the app URL). Deliberately NOT narrowed to `linksDesigner`: a designer whose token predates that claim must still be able to LOAD the workspace so their first write can permission-deny and self-heal through `writeWithClaimRetry`. Write: requires the `linksDesigner` claim OR `admin` (H2, shipped v16.29 — was any-authenticated write until then), AND (create/update, v17.02 — Finding #12) is **shape-validated** — the authoritative list is the `hasOnly([…])` in `firestore.rules` and the payload builder `docPayload` in `links-design-doc.js`; **do not restate it here, because this sentence did and was wrong**: it enumerated four keys and omitted `window` until v21.63, while the tree entry for `links-window.js` two hundred lines above correctly said the window is stored per design. `name` is a 1–100 char string, `patterns` a map, `updatedAt` a timestamp, `updatedBy` a ≤100 char string (delete carries no body). The create/update allowlist gained the optional `deletedAt`/`deletedBy` pair at **v19.41** (type-checked when present; a live design carries neither, which is why they are optional rather than required). `linksDesigner` is set by `setupRosterAuth` from `CONFIG.LINKS_DESIGNERS`; `links-app.js` wraps every write in `writeWithClaimRetry` so a stale token self-heals, and saves atomically via `runTransaction` (v17.02 — Finding #13). Designs are **not** member-owned (no per-member isolation — any designer edits, deletes or restores any design).
Written/read by: `links-app.js` (the multi-design workspace collection).

**linkTargetSets** (v21.04)
```
name         Set name, 1–60 chars (e.g. "Set A")
slots        The generator target table: [{time: "HH:MM-HH:MM", weekday, sat, sun}], 1–60 rows
spareLines   int ≥ 0 — whole cover-week lines
createdBy    The CREATOR's member name — the ownership key. Pinned by the rules to the writer's own
             `name` claim on create, and IMMUTABLE on update (ownership is not transferable by editing)
updatedBy    Whoever last wrote (the admin can overwrite anyone's set; createdBy still never moves)
updatedAt    Firestore server timestamp
```
Named snapshots of the generator's target table, shared between the designers, so "others can mess
about but not lose my set" (owner, Aug 2026) holds across devices. Read: named session or admin
(matches linkDesigns, same self-heal reasoning). Create: `linksDesigner` or admin, shape-validated,
`createdBy == request.auth.token.name`. Update/delete: only the creator or the admin. The client's
Save button asks the same question (`canOverwriteTargetSet`) but that copy only decides what is
OFFERED — the rules are the protection. Written/read by `links-app.js` (the generator card's Saved
sets row); rules covered case-for-case by `firestore.rules.test.mjs`. **Delete only reached the UI at
v21.08** — the rule had allowed it since v21.04 but nothing on the page could ask, so sets could only
accumulate. There is no bin behind a set the way there is behind a design: deleting one is final,
which is why the confirm names it and is marked destructive.

**overtimeWindows** (v20.56) — a TREE, not a flat collection, and the only one no client may write
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
  reminderSentAt              Timestamp — set by the scheduler when the deadline-morning reminder
                              was attempted (v21.47). Idempotency stamp only: it protects the ONE
                              morning against a re-run, and once noon passes the phase moves and
                              the question is closed. Server-written; no client reads it

  /participants/{memberName}  the FROZEN population. Written once, at creation, never rewritten
    memberName · grade · rosterOrder · createdAt
    uid                       null until that member's first submission, then stamped. Nothing
                              reads it — it is the recovery route if a member is ever renamed
    withdrawn / withdrawnAt / withdrawnBy   present ONLY on a withdrawal (v20.95). The freeze's one
                              exception: a LEAVER otherwise stays a permanent non-responder in every
                              open week. They come out of `expected`, out of every panel and out of
                              the chip — nothing is deleted, and the page names who withdrew them.
                              Since v21.20 the flag also reaches the MEMBER: `getMyOvertimeState`
                              drops the window and `submitOvertimeAvailability` refuses. Until then
                              withdrawal lived only in the reviewer's arithmetic, so a leaver kept
                              seeing the week and kept being able to file into it.
                              Written by `withdrawOvertimeParticipant`, refused on a CLOSED week
                              (that week is the record). Restoring REMOVES the three fields rather
                              than writing `withdrawn: false`, because `where('withdrawn','==',true)`
                              never matches a missing field — which is why the counts subtract the
                              withdrawn instead of filtering for the rest, or every participant
                              written before this feature would vanish from the count

  /submissions/{memberName}   the HEAD — current answer only
    currentRevision · days · firstAcceptedAt · updatedAt · lastMutationId · lastMutationSeenAt
    schemaVersion

    /revisions/{rev}          APPEND-ONLY history: revision · days · acceptedAt · mutationId · uid
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
Firestore does not cascade and a parent deleted alone orphans the tree permanently. It **ships
DISARMED** (`purgeArmed` in `functions/index.js`): it walks and logs what it would remove and deletes
nothing until somebody has read a run. Arming changes nothing anyone sees — expired windows are
already invisible and inert — which is why it can wait and why waiting is not free. **What waiting
now costs is STORAGE, not latency** (v21.94): `getMyOvertimeState` used to read the whole collection
on every page open and drop the expired rows in memory, so the member's hot path grew with it; it is
bounded by a `retentionUntil` inequality now, and the same bound is still WORTH applying to
`getOvertimeManagerOverview`, which derives `overdue` from all the keys and wants checking against
`weeksNeedingWindows` first.
Written by: `functions/overtime.js`. Read by: `getMyOvertimeState` (members) and `loadWeekDetail` in
`overtime-data.js` (the reviewer's one direct read). Full design: `OVERTIME_AVAILABILITY.md`.

Override cache key: `"memberName|YYYY-MM-DD"`

### Authentication

Staff log in with name (dropdown) + password. The **default** password is their surname (lowercase, no spaces/special chars); since v18.63 (PASSWORD_PLAN.md Track C) a member can **set their own password** in Settings → Password, and sign-in accepts either the typed password or — for anyone still on the default — the surname (`credentialCandidatesFor` in `auth-identity.js` builds the ordered candidate list, `ensureFirebaseSession` tries each). If a member forgets a self-set password, the **admin resets it** back to the surname default (Operations → Account status → Reset, backed by the `resetMemberPassword` Cloud Function). Sessions expire **60 days after sign-in**, full stop (60 days since v20.47, owner decision — 30 until then; the 7-day inactivity cutoff went at v20.41 with its timestamp machinery). Inactivity alone never ends a session; nothing extends one either, so `expiry` is set once at sign-in and `getSession()` is a pure read. Everything that genuinely REVOKES access is unchanged and still immediate: an explicit sign-out (which signs Firebase out too), a disabled or deleted account, revoked Firebase credentials, and the claim-epoch sweep. The Calendar **viewer** is a different thing entirely and is untouched — it holds no `name` claim and its persistence is session-only, so it ends when the browser session does. `CONFIG.ADMIN_NAMES = ['G. Miller']` — elevated access. `CONFIG.LINKS_DESIGNERS = ['G. Miller', 'S. Silva', 'M. Robson']` — access to the Links design workspace.

The login dropdown groups members by grade (CEA · CES · Dispatcher · Management, in that order). `managerOnly: true` members (managers/clerks) appear **only** in the Management group and are hidden from the calendar's member selector — they have login access but no roster of their own. Their grade dropdown filtering lives in `admin-app.js` (`GRADE_ORDER`).

**Forced migration (v18.92 — PASSWORD_PLAN.md Phase 2).** `CONFIG.FORCE_PASSWORD_SET` (a kill switch,
currently `true`) makes `password-force.js` compel any member still on the surname default to choose
their own password **at their next sign-in** — nobody is signed out to accelerate it. No forced sign-out
is needed: sessions cap at 60 days absolute and an expired session forces a real typed
login, so coverage completes itself inside 60 days and staggers by each member's own expiry rather than
landing on everyone at once. It shows only for a `named` identity — never the calendar's anonymous
session nor a soft-failed paycalc one, where `updatePassword` cannot succeed and the block would be
unsatisfiable — and fails open on any failure it cannot recover from. A member who only ever views the
roster never signs in anywhere and is therefore never compelled: accepted (reaching them means Track E).
**It is now the ONLY post-login overlay.** The work-email check that used to queue behind it was
retired at v19.30 (every member's email is registered; a wrong one is corrected in Settings), taking
the precedence rule and its marker-deletion with it. If a second post-login overlay is ever added,
read the note above `_show` in `password-force.js` first — anything that must happen when an overlay
OPENS has to fire before the await, never after it (the v18.94 bug).

**Password security note:** The *default* password is surname-derived and not a secret — protection relies on Firebase Auth rate-limiting (v9.53) and Firestore rules (`request.auth != null`). A member who sets their own password (v18.63) does get a real secret; the surname default remains valid **only until** they do (the sign-in candidate ladder tries the typed value first, then falls back to the surname). An admin reset returns the account to the surname default. Full design + phasing: `PASSWORD_PLAN.md`.

**Calendar access — the staff PIN (v20.12).** The Calendar opens for a named member session OR the shared staff PIN, and for nothing else. A signed-in member is never interrupted. A shared office PC enters four digits and gets the full Calendar including overrides, in a session that lives exactly as long as the browser session. Everything privileged still requires a real member sign-in — the viewer has no `name`, `admin`, `manager` or `linksDesigner` claim and cannot write anywhere. The PIN value lives only in the `CALENDAR_VIEWER_PIN` secret. Design: `calendar-access.js` / `calendar-access-core.js`; operations + rotation: OPERATIONS_REFERENCE.md; the closed limitation: KNOWN_LIMITATIONS.md.

**A consequence worth expecting in support questions:** a member who has never signed in anywhere now has to unlock each browser session, where before the Calendar simply opened. Signing in once (a 60-day session) removes the PIN entirely, which is what the `sign-in-2026` notice asks of exactly that group.

Firebase SDK: currently v12.16.0. Check version before any new Firebase work. **An SDK bump must also update `FIREBASE_SDK_VERSION` in `service-worker.js`** (the SDK offline cache is keyed on it) — `sw-asset-check.test.mjs` fails the build if they diverge.

---
