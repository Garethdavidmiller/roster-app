# AUTH_PLAN.md — full-app authentication (Track E)

*Not version-stamped; not a runtime asset.* **This file is the one home of Track E** — its design,
its phases, the order they may ship in, their risks, what to measure and the owner's questions. The
only other place Track E is written is its STATUS: the Track E and E6 rows of
`SECURITY_RELEASE_PLAN.md`'s canonical track table, which own the stage of every phase. That file's
Track E section is a pointer here. Until 25 Nov 2026 it was a second copy of the phase list, and the
two copies drifted (v19.08: one numbered E2 twice and lost the offline-grace phase), so
`auth-plan-parity.test.mjs` now holds this file's phase list, rollout sequence and shipped versions to
that table, and keeps the pointer a pointer.

**How much to trust each part.** Written down because the phases are not equally worked out, and a plan
that reads uniformly confident invites someone to start at the wrong end:

| | Confidence |
|---|---|
| §1 framing, §2 current exposure, E0, E2 | **Verified against code** (§2 re-checked 7 Nov 2026). Safe to act on. |
| E1 | **✓ SHIPPED v19.01.** |
| E3, the decision gate, §6 measurement | **Sound, unverified.** Design is right; numbers are missing. |
| §4 offline (E4) | Designed; its one load-bearing assumption is **demonstrated** — `experiments/firestore-offline-proof/`, see §4. |
| E5 | **Under-analysed.** The claim-tier work the B-track proved necessary has not been done for reads. |
| §5 documents (E6) | **DECIDED 19 Sep 2026 and BUILT**: the Office viewer stays and is handed a 15-minute signed link. The tokens already in circulation are not yet rotated: the tool is built (Operations → Document links, 12 Nov 2026) and its first run is the owner's (ARCHITECTURE.md EXC-007). |

**Status — a summary of the canonical table, which wins if they differ: the read closure is IN FORCE
since 26 Aug 2026; INDIVIDUAL authentication as designed is not built.** **E0 shipped v19.00** (search
engines excluded) and **E1 shipped v19.01** (the cache-first, auth-aware client preparation) — the two
phases that needed no decision. **E2 was never built**: the staff PIN (v20.12) did its job more
strictly, and was itself **retired on 23 Nov 2026** (owner — DECISIONS.md → "The staff PIN retired";
its server release took the `calendarViewer` claim out of the rules). So `overrides` reads require a
verified member (`isMember()`: password sign-in, derived email, server-set `member` claim) or `admin`,
and every reader of the Calendar signs in by name — an Other Staff login for somebody with no roster of
their own. Rules are evaluated server-side and a local cache hit never reaches one, so a device that
read the data before the closure still holds what it cached (§4). E3, E4 and E5 as designed (the soft
posture, offline grace, named-only rules everywhere) are dormant; the E3 note below says how the
retirement differs. The likeliest trigger for them is external: an IT requirement that each person
authenticates, if the app becomes official Chiltern infrastructure.

---

## 1. What "behind authentication" can and cannot mean here

The single most important framing in this plan, because the phrase bundles three different problems and
only one of them is enforcement.

| Layer | Can it go behind auth? | Where the work is |
|---|---|---|
| **Data** — Firestore reads | **Yes, server-enforced.** The only real control. | the staff PIN (in E2's place; retired 23 Nov 2026 — a named sign-in since) / E5 (rules) + E1 (client prep) |
| **Files** — Storage documents | **Not by any rules change.** Direct Storage reads are admin-only; everyone else opens a document by its stored bearer URL or a short-lived signed URL (`getDocumentUrl`), neither of which the rules see. | E6 (delivery-model change) |
| **Shell** — HTML/CSS/JS | **No.** Static files on public hosting. A client gate is UX, never security. | E3 (UX only) |

Two consequences follow, and both are easy to get wrong:

- **A login overlay on the calendar buys nothing by itself.** `auth-policy.js` says so in its own header
  ("This is CLIENT-side UX, NEVER the security boundary"). Shipping E3 without E5 would look like the
  app is behind a login while every byte remains fetchable over REST.
- **"The entire app behind authentication" is not literally achievable** on Firebase Hosting static
  serving — the app shell is public by construction. What is achievable is *all data behind a named
  session*, plus a client gate so the UI matches. Say it that way to anyone asking for the guarantee.

**The two bars a read rule can set** — the phases below are named for them:

| | Rule shape | Who it lets in | What it blocks | UX cost |
|---|---|---|---|---|
| **Level 1** (E2, never built) | `allow read: if request.auth != null;` | any session, **an anonymous one included** | a raw REST/`curl` scrape with no Firebase session; casual URL sharing | Small, not zero — it needed E1 first. No front-door change |
| **Level 2** (E5) | `allow read: if isMember();` — already the live `overrides` read rule's member door; a bare `token.name != null` is weaker, as any session can set its own display name | only a **named** staff session | anyone not signed in as staff | **Real** — the Calendar shows a sign-in before it renders |

---

## 2. What is actually exposed today

Open reads (`allow read;` in `firestore.rules`): **none.** Every read rule asks for a claim — a bound
member, `admin`, or something narrower — never for a bare session (the retired staff-PIN
`calendarViewer` capability was one too, until its server release). The bearer-URL exposure in §5 is unchanged by that.

- **`overrides`** carries `memberName` + `date` + `type` + `value` — AL, absence and shift changes for
  every member — and was readable by anyone with the URL until 26 Aug 2026. (The app never stores a
  *reason* for an absence — a deliberate GDPR decision recorded in CLAUDE.md — but "who was absent,
  and when" was readable for as long as the open rule stood, and **a device that cached it before the
  tightening still holds what it saw**: see E2 below.)
- **The three document collections** — `huddles`, `circulars`, `newsletters` — carry the download URLs
  for internal Chiltern operational documents. They were the last open reads, closed by owner decision
  (7 Sep 2026): the client refuses the read at source without access (`calendar-doc-access.js` — §5
  below), and the rules mirror `overrides`.
- **`storageUrl` is a permanent tokenised bearer URL**, so the document *files* are not protected by
  rules at all — see §5.

- **The SHIPPED JAVASCRIPT carries the base roster, and that is a deliberate classification**
  (owner, 4 Sep 2026 — external review). The shell is public *by construction* (§1), and
  `roster-data.js` is part of the shell.

  With no session and no token, anyone can read **every named member with their roster type
  and cycle position, plus join dates, pro-rated leave entitlements, scheduled roster moves and which
  members hold a bilingual contract, where a member carries them**, and `roster-cycle-data.js`, the
  patterns those numbers index into. Together they let a stranger compute any named member's shift for
  any date, past or future.

  **The owner's decision is that this is not confidential**: shift patterns are printed on the
  station's own rosters and staff share them freely. So it is recorded here rather than as an
  `EXC-*` row — an EXC is where deployed differs from intended, and here they agree.

  Two things follow, and the second is the one that matters:

  - **The read closure protects the CHANGES to the roster, not the roster.** `overrides` was closed so an
    outsider could not read who was off and when; the base shift underneath every unchanged day is
    public. Anyone describing the Calendar as "behind a code" should know which half that sentence
    covers.
  - **A field added to `teamMembers` is published the moment it ships.** That is the live hazard —
    not somebody publishing a phone number deliberately, but somebody adding one for a good reason
    without ever learning this file is world-readable. `public-data-classification.test.mjs` holds
    an allowlist with a reason per field; an unclassified field fails there, so the decision has to
    be made in the open. Anything that should not be public belongs in Firestore behind a claim, as
    `staffContact` (the work email) already is.

**The exposure being closed is outsider-with-URL, not colleague-to-colleague.** The member selector
already lets any staff member view any colleague's roster and leave, by design. Track E does not change
that and is not intended to.

**Be honest about the bar.** The Firebase project config ships in the client JS, so anyone can create
an anonymous session against the project — which is why no rule may accept one, and why a rule that
asked only for *a* session (Level 1, E2 as designed) would have been no barrier. The PIN raised the bar
to "must hold the station code"; since it was retired (23 Nov 2026) the Calendar asks for a named
sign-in, and since its server release removed the viewer claim the read rule means "must be staff".

---

## 3. The phases

**Rollout discipline:** migrate, don't cut over — **E0 → E1 → PIN (v20.12, in place of E2) → decision gate → E3 + E4 → E5**.
Never make the calendar's front door and named-only read rules a single flip. E6 is independent and
can start at any point. The two soaked phases were E1 (client preparation, no rule change) and the
PIN that took E2's place (the first real boundary); everything after the gate is undecided. Reuse the
staged posture the B-track proved, and verify only from a fresh private window (§8, §9).
`auth-plan-parity.test.mjs` pins this exact sequence and rejects superseded `-soft`/`-hard` phase
shorthand.

**Why it is not much code but is a big decision.** Mechanically E3–E5 are a pattern-copy, a rules
change and a policy flag — about a day. But the Calendar is the app's **front door** and the PWA's
`start_url`, opened many times a day, and four consequences hang off an individual sign-in there:
offline lockout (E4 is the answer), notification deep links, first-run onboarding, and the document
viewers' coupling to sign-in — all four in §4.

### E0 — exclude search engines ✓ SHIPPED v19.00
`X-Robots-Tag: noindex, nofollow` on Firebase Hosting + a mirrored `<meta name="robots">` in every
served page, because GitHub Pages serves no headers and a `robots.txt` cannot reach the mirror (only
honoured at an origin root; the mirror lives under `/roster-app/`). `robots.txt` deliberately **permits**
crawling — a crawler blocked from fetching can never read the noindex, so `Disallow: /` would hide the
signal rather than the page. Guarded by `sw-asset-check.test.mjs`. Needed no decision and depends on
nothing below.

### E1 — make the calendar's reads auth-aware ✓ SHIPPED v19.01
**Client preparation, NOT a security boundary** — it changed no rule and stops no direct REST read, so
it must never be cited as protection. It shipped as its own release, before any rules change, so that
the later rules change was only a rules change. Four paths had read with whatever auth happened to
exist: `calendar-initial-fetch.js` (the 3-month `overrides` fetch), `calendar-huddle-viewer.js` (the
`#huddle` snapshot), `calendar-doc-viewer.js` (`#circular` / `#newsletter`, notification taps) and
`nav-panel.js` (the drawer's Circular/Newsletter open). Once reads need a session, a path that reads
too early gets an empty calendar, or a notification tap that opens nothing.

#### The design

**The four paths split two ways, and only one is delicate.** The three TAP paths are user-initiated
and show a pending state, so a short wait is expected. The render path — the `overrides` fetch — is
the only one on the critical path to seeing your roster, and the only one that must work offline.

**The rule to carry into every later phase: no user-facing path may await auth without a deadline,
and every failure state needs a control, not just text.** A loading state says something is
happening; it does not make an unbounded wait recoverable. The first cut awaited auth plainly on the
tap paths and the retry, and each became a dead end: a notification tap on "Loading…" for ever; a
signed-out drawer tap on Operations or Links, whose `sessionReady` waits for sign-in, stalling 8s and
failing where it used to open at once; and the retry chip stuck, disabled, on "Retrying…". All of
them now wait a bounded moment, then read regardless and fail into a retryable path.

**The render path must not wait at all**, for the opposite reason: the data is already cached. A bare
`await` puts a live sign-in round trip in front of data the device holds (the offline-first
regression); bounding the wait and reading anyway trades that for a spurious "⚠ Couldn't update" on a
slow first visit, and needs a timeout constant with no basis. **Instead, the two-phase load: paint from
cache immediately, refresh authoritatively once auth lands.**

1. **`reconcileRangeIntoCache` takes an `authoritative` flag** (`override-utils.js`). Its eviction
   sweep (drop in-range keys the snapshot omits) is a separable loop. A **cache** snapshot is by
   definition a possibly stale subset, so it must merge additively and evict nothing. **This is the
   load-bearing detail:** two authoritative reconcilers racing on one range is exactly the Team View
   bug where the staler snapshot wiped the grid back to base roster.
2. **A cache-only sibling to `fetchOverridesForRange`**, `fetchOverridesForRangeFromCache`
   (`calendar-overrides.js`), reads with `getDocsFromCache`. It never sets the error chip — a cache
   miss is normal, not a failure.
3. **`initInitialFetch` is two-phase:** fire the cache read immediately and paint; then await the
   access grant and run the authoritative server read.
4. **Generation guard** — the `_fetchGen` supersession pattern, so a slow cache read can never clobber a
   server read that already landed. (Since v25.72 it is the first load's attempt tickets: `standing` in
   `calendar-initial-fetch.js`, over the read ticket in `calendar-overrides.js`.)
5. **The sync chip tracks the server phase only.** "↻ Updating shifts…" means "fetching fresh",
   which is still true.

It needs **no timeout constant anywhere**, and a cache-first paint is half of what E4's grace mode needs.

**The three user-initiated paths, concretely:**

- **Huddle** — the subscription awaits auth before it attaches, and the 8s safety timeout covers the
  auth wait (started on invocation, not on attach) so time-to-error is unchanged. Gating the attach
  also matters for denied reads: an `onSnapshot` that hits `permission-denied` is **terminated**, not
  retried, and only recovers on the next `visibilitychange` — useless to someone staring at a
  notification tap. (Since the documents moved behind the access gate, the viewers also wait on
  `calendar-doc-access.js` — `CALENDAR_DATA.md` 15.)
- **Doc viewer** — awaits auth inside `openDoc()` before the fetch; the existing loading state covers it.
- **nav-panel** — `authReady` is in the `initNavPanel({…})` options bag (default `Promise.resolve()`),
  each page passing its own: `calendarAuthReady` on the calendar, `sessionReady` on the authenticated
  pages. It follows the per-page injection precedent (`isAdmin`, `onLogoClick`).

**The guards (written first, both teeth-verified):**

- `calendar-initial-fetch.test.mjs` — inject an auth promise that **never resolves**; assert the cache
  read still goes out and paints. Teeth-verify by implementing the naive `await` and watching it fail.
- `override-utils.test.mjs` — additive mode evicts nothing; authoritative mode still does.

Both land in `npm test`, so CI gates them — unlike `e2e/offline.spec.js`, which is opt-in and stubs
Firebase at the network layer, so it could neither gate this nor observe real cache behaviour.

### E2 — Level 1 rules: `request.auth != null` — SUPERSEDED, and by something STRICTER (v20.12)

**Not built, and it must not be.** E2 would have required *any* Firebase session for `overrides`
reads, with the Anonymous provider left enabled — a barrier of one scripted `signInAnonymously()`
call. The staff PIN (v20.12) answered the decision gate a way the phase list did not contain: a
server-validated SHARED credential (the `calendarViewer` capability, minted by `unlockCalendarViewer`
for a four-digit code), with anonymous DENIED outright. That cleared the **E5** bar for the read
without paying E3's front-door cost, and touched neither the shell nor individual identity, so it
closed nothing in E3/E4/E5.

**The PIN was retired on 23 Nov 2026** (owner): its server release deleted the capability from the
rules and its endpoint from the server (DECISIONS.md → "The staff PIN retired"), so the read needs a
named sign-in. The external review's "public absence/AL data" finding is closed. What still binds:

- **No read rule may admit an anonymous session.** The project config ships in the client, so anybody
  can make one (§2).
- **Firestore ORs every matching `allow`.** The bare `allow read;` that sat ABOVE the tightened rule
  kept override data public until it was deleted, in its own push, after the client had soaked —
  RECOVERY_RUNBOOK.md → "The staff PIN (retired)" keeps the order it followed. A tightening is not
  done while any broader rule still matches.
- The three document collections, the one piece left over from E2, were closed under E6 (§5).

### ⟨ DECISION GATE ⟩ — is Level 1 enough? — **ANSWERED v20.12, for the READ only**

Casual exposure (indexing, a shared link, idle curiosity) is answered by E0 and the read rule; a
motivated outsider scripting an anonymous sign-in is refused by the read rule. What the shared PIN
left open — nothing about it attributed an action to a person, revoked access for one person, or
survived the code becoming widely known — was closed by retiring it (23 Nov 2026). **What is not
answered is whether to go further**: E3/E4/E5 as designed, the likeliest shape of a Chiltern IT
mandate, are the owner's question (§7). Everything past this gate touches the app's front door.

### E3 — named calendar, soft posture

> **Not E3, and worth saying so:** the Calendar's front door leads with the member SIGN-IN card and
> offered the staff PIN one tap behind it (owner decision, 7 Sep 2026). Since the PIN was retired
> (23 Nov 2026) only a named sign-in opens the Calendar — the gate decides it (`decideAccess`), and
> `PAGE_POLICIES.calendar` still does not set `requireNamed`. That is E3's front door reached by
> removing the shared code, without E3's soft posture or the measurement in §6; E3 as designed
> remains dormant.

Flip `PAGE_POLICIES.calendar` to `{ requireNamed: true }` in `auth-policy.js` (genuinely one line — the
policy layer is clean) and wire the shared `login-overlay.js`. Start in a **soft** posture and
*measure* (§6) before hardening — which would need a Calendar policy flag of its own, since the write
pages' named-session requirement is unconditional. Client UX only: do not tighten rules in the same
window.

`login-overlay.js` is proven on every protected page, which makes this less of a leap than it sounds.
It also *removes* an inconsistency — the app has two onboarding stories, one where a new starter picks
a name from a dropdown and one where they sign in.

### E4 — offline grace mode (ships **with** E3, not after)
See §4. Without it, E3 is a genuine regression for a member whose session lapsed while offline; with
it, it is not. Do not schedule E3 without it.

### E5 — Level 2 rules: `isMember()` + hard gate
Tighten reads to Level 2 app-wide and make the Calendar sign-in mandatory — only after E3/E4 soak, the
numbers say the wall is survivable, and the claim-tier analysis below exists. Nothing in the app calls
`signInAnonymously` any more, so **disabling the Anonymous provider project-wide** — real hardening —
does not wait on E5: it is a Console step that can be taken now (`firestore.rules` still records the
provider as enabled).

> **⚠️ NOT YET ANALYSED — do not treat `isMember()` as a one-line rule.** (It is already the live `overrides`
> read rule's member door — AUTH_AND_SESSIONS invariant 19; a bare `token.name != null` is weaker, since any
> session can set its own display name.) The B-track needed a
> whole permissive→strict migration and a `CLAIM_EPOCH` token sweep because claim tiers are subtle, and
> that was for **writes**, where `writeWithClaimRetry` self-heals a stale token. The equivalent analysis
> for **reads** has not been done. Two things already found by inspection, both of which E5 must answer:
>
> 1. **Reads have no claim-retry anywhere on the calendar or paycalc.** `withClaimRetry` wraps reads on
>    the Operations cards, but no calendar or paycalc read uses it. So a stale-claim read just fails,
>    where the equivalent write would recover. Either reads gain the retry before E5, or E5 must prove no
>    legitimate reader can hold a stale claim — the B-track's answer was a token sweep, not an assumption.
> 2. **paycalc's soft posture silently loses its calendar assist.** `paycalc-app.js` reads overrides via
>    `fetchOverridesForPeriod(p, session2.name)`, and that name is a **local** session value, not proof of
>    a Firebase named token. The page's policy is deliberately `soft` so the calculator keeps working when
>    auth does not. Under E5 that read is denied; `paycalc-roster-suggestions.js` catches it and falls back
>    to "base roster only", so it degrades rather than breaks — but it degrades **invisibly**, and it does
>    so for exactly the users the soft posture exists to protect. Decide deliberately whether that is
>    acceptable, and if it is, say so in the UI rather than letting the pre-fill quietly stop.
>
> Enumerate every override reader and the identity it actually holds at read time **before** writing the
> rule. That list does not exist yet.

### E6 — put the document FILES behind auth (independent; can start any time)
See §5. Does **not** depend on the calendar decision, and **no rules change in this track touches the
files** — they ride bearer URLs that bypass `storage.rules`. The track's headline change protected the
personal data; only E6 protects the company-confidential documents.

---

## 4. The offline answer (E4)

Track E originally called offline lockout "the sharpest consequence… a genuine regression to weigh". It
is softer than that, because **both halves are ours**:

- The 60-day expiry is *our* localStorage construct (`SESSION_MS` in `session.js`), not Firebase's.
  Firebase refresh tokens do not expire on that schedule.
- **Firestore rules are evaluated server-side.** The persistent local cache serves offline reads without
  consulting them. The roster is still on the device.

> **✅ The second bullet is DEMONSTRATED, not assumed.** It is how Firestore is documented to work, and
> this section rests on it entirely, so it was tested: `experiments/firestore-offline-proof/`, against
> the Firestore emulator and the production SDK build, in a real headless Chromium with a real
> IndexedDB cache.
>
> Cached `overrides` survive a page reload, **a full browser restart**, a rules tightening and the loss
> of the network, **in any combination** — while the server read on the same query returns
> `permission-denied`. A live listener under denied rules emits the cached snapshot *first* and only
> then errors, and **a denied listen does not evict the cache**. The full matrix, the method and the
> caveats are in that directory's README.
>
> **Two things it does not license.** It runs against the emulator, so it is strong evidence rather than
> proof of production behaviour — say so wherever it is relied on. And the cache is leased to one
> primary client: after a browser restart there is a **2–3 second window** (measured in a container, so
> not a number to inherit) in which a cache read returns zero documents *with no error*. Any design that
> needs the roster on screen instantly at launch has to handle that, and E4's grace mode is where it
> belongs.

So an offline member with a lapsed session would not be locked out by Firebase — they would be locked out
by *our own overlay*. That makes it a design problem, not a constraint.

**And the same measurement settles the security half.** The mechanism cuts both ways: because the cache
is served without consulting the rules, closing the `overrides` read rule protected the roster on
devices that had **not** already seen it, and did nothing whatever about devices that had. That is
exactly what `calendar-overrides.js`'s own gate exists for, and it is a measured statement rather than
an inherited one.

**The design:**

1. Keep a **durable device marker** ("this device has previously held a valid named session"), separate
   from the expiring session blob. `reconcileExpiredIdentity()` signs the Firebase user out on expiry,
   so the marker cannot be inferred from auth state afterwards — it must be written deliberately.
2. On launch: session expired **and** `navigator.onLine === false` **and** marker present → render the
   cached roster **read-only** with a calm banner ("Showing your saved roster — sign in when you're back
   online"), instead of the login overlay.
3. **Read via `getDocsFromCache` explicitly in grace mode.** A live listener would try to re-attach on
   reconnect and surface `permission-denied` under Level 2 rules, blanking a roster the member was
   reading a second earlier.
4. The moment connectivity returns, require the real login.

**Why this costs nothing against the threat being defended.** Grace mode only helps someone holding a
device that was already signed in — the device-theft threat model, not outsider-with-URL.

> **The front door is closed today, so read the next paragraph as the reasoning for E3, not as
> today.** The Calendar does not start without a member session (the staff PIN that also opened it was
> retired on 23 Nov 2026); a member's own stored
> roster is shown before the grant but deleted when their session expires (CALENDAR_DATA.md invariant
> 17); and the document reads are behind the same gate.

**The other three front-door consequences**, for completeness: notification deep-links must survive the
login flow (a `#huddle` tap on a lapsed session lands on a login screen); first-run onboarding becomes
"sign in" rather than "pick your name", for everyone including the shared station PC — which is where
the app has stood since the PIN was retired (23 Nov 2026); and the document viewers couple to login
working on every path.

---

## 5. The documents are the gap nobody asks about (E6)

`storage.rules` gates direct Storage SDK reads, and those are admin-only — staff never read documents that
way. They open the permanent tokenised `storageUrl` saved in the Firestore doc, or a short-lived signed
URL from `getDocumentUrl`; both carry their own access and **bypass the rules entirely**.

**Therefore: no phase in E1–E5 puts these documents behind authentication.** Those phases change who can
*discover* a URL. Anyone who has ever held a permanent one — a forwarded link, browser history, a synced
bookmark — keeps access until the object is deleted, and revocation means rewriting the object, not
editing a rule.

**But not forever.** Both retention sweeps DELETE the Storage object, which is what actually kills a
bearer URL: **Huddles at 3 months** (`pruneOldHuddles`, server-side in `functions/huddle-retention.js`),
**Circulars and Newsletters at 6 months** (`pruneOldDocs`, browser-side in `doc-retention.js`). So a
leaked URL is bounded by the retention window, not unbounded — which materially lowers this finding's
priority.

**Three things stop that being a guarantee, and they are the residual risk:**

- **The circular/newsletter sweep is UPLOAD-TRIGGERED, not scheduled.** It runs fire-and-forget
  after a successful upload. If uploads stop, nothing prunes, and "6 months" becomes "6 months after
  somebody next uploads".
- **No server time, no sweep.** `doc-retention.js` refuses to run on a client clock, deliberately —
  correct, and it means the sweep can silently not happen.
- **A partial failure ORPHANS the Storage object.** `pruneOldHuddles` deletes Firestore first, then
  Storage, because the reverse leaves a user-facing broken link. The accepted cost is an orphaned
  object — invisible to staff, unreferenced by any document, and **still serving its bearer URL,
  permanently**. That is the one genuinely unbounded case, and nothing currently lists it.

Worth stating plainly when prioritising: **the change everyone reaches for first (a login on the
calendar) protects the personal data and leaves the company-confidential documents exactly as they are.**

### The Office viewer, and why it shaped E6

**A third party fetches these documents by URL.** Word circulars and newsletters open through
`officeViewerUrl` (`storage-utils.js`), which hands the storage URL to **Microsoft's Office Online
viewer**, and Microsoft fetches the document **server-side**. Two consequences:

- **Authenticated `getBlob` — the cheapest option — would break `.docx` viewing outright.** Microsoft
  cannot fetch an auth-gated URL, so any design that removes public fetchability must replace the Word
  rendering path at the same time.
- **"The documents are behind authentication" cannot be claimed while this path exists**, whatever the
  rules say. That is independent of Track E, and it belongs in any conversation with IT about where the
  data goes.

The options that were weighed:

| Option | Verdict |
|---|---|
| Authenticated `getBlob` | **Breaks Word viewing.** Only viable bundled with a replacement renderer (or accepting download-instead-of-render for `.docx`). |
| Short-lived signed URLs from an authenticated Function | **Chosen.** The window must be long enough for Microsoft to fetch, and the document still reaches Microsoft. Narrows exposure from *forever* to *the signing window*; does not remove the third party. |
| Convert `.docx` → HTML at upload (as the Huddle already does via Mammoth) | **Refused** (below). The cheapest to BUILD — `doc-upload.js` already takes a `transform`, and the Huddle's converter (`_convertHuddleDocx` in `huddle.js`) is in production — but its real cost is FIDELITY: images inline as base64 against the 200 KB cap, and an image-heavy Circular would fall back to download-only. |
| Require PDF | **Refused** (below). |
| Accept it | Fine, but only as a recorded decision rather than an accident. |

### DECIDED 19 Sep 2026 — short-lived signed URLs, and the two options that were REFUSED

**Owner decision, on two facts only the owner had.** Converting `.docx` to HTML was refused
outright: a Circular is a DESIGNED document and flattening it through Mammoth degrades what staff
read. Requiring PDF was refused too, because **the documents arrive as `.docx`** — so that option is
not a one-off change but a manual export on every weekly issue, for ever. Both of the routes that
would have removed Microsoft entirely therefore cost either fidelity or recurring work, and neither
cost is worth paying for a leak that retention already bounds.

**So the Office viewer stays and its URL is short-lived.** `getDocumentUrl` (`functions/documents.js`,
rules in `functions/doc-url-core.js`) mints a 15-minute read URL for the latest document of a named
KIND. Exposure goes from "until retention deletes the object" to "the signing window", and **nothing a
member sees or an admin does changes** — which is what made this the option worth taking. The nav
drawer, `calendar-doc-viewer.js` and `calendar-huddle-viewer.js` all fetch it through
`document-url.js`, and the stored permanent link stays as the fallback (owner, 7 Oct 2026 —
DECISIONS.md).

**Stated plainly, because it will be claimed otherwise later: this does NOT remove Microsoft.** A
`.docx` still opens through the Office Online viewer, which still fetches it server-side, and if
Microsoft caches what it fetched then the window bounds THIS app's leak and not their copy. That was
understood when the option was chosen. It also does nothing for URLs already in circulation, which is
why `ARCHITECTURE.md` EXC-007 stays open until the old URLs are rotated.

**Deploy prerequisite, and it is not optional:** signing needs
`roles/iam.serviceAccountTokenCreator` on the runtime service account, granted to ITSELF. Without it
every call answers 503 — which the client is required to treat as "use the stored URL", so a missing
grant degrades to the old behaviour rather than to a dead button. RECOVERY_RUNBOOK.md holds the grant.

**And one action needs no decision at all.** Rotation can be taken alone: re-writing the objects turns
"whoever ever held a URL" into "whoever held one since the rotation", without choosing a delivery model.
Doing it periodically would bound the exposure on purpose rather than relying on retention to do it as
a side effect — and would also clear the orphaned-object case, which retention by construction cannot
reach. **Built 12 Nov 2026** as Operations → Document links (`rotateDocumentLinks`; the rules are
`functions/doc-link-rotation.js`), when the owner asked for it to be run once now: a second run is one
press.

### E6 vs the notifications — DECIDED 7 Sep 2026, and BUILT

*Owner decision, 7 Sep 2026: the Huddle, the Weekly Retail Circular and the Marylebone Newsletter must
not be visible without the PIN or a password.* (The PIN was retired on 23 Nov 2026: a sign-in now.) What was built is exactly the two things a gate needed:
the viewers moved behind the access gate (`calendar-doc-access.js`, opened on the full grant only,
refusing the read at source so the local cache cannot answer it), and the deep link survives the
unlock (a tap made while locked is HELD and finished when access arrives — the viewers keep their intent
in memory, because `initHuddleViewer` and `initDocViewer` strip their own hash synchronously). The
judgement call was taken as "accept the friction and state it": a notification still arrives, and a
locked device's tap lands on the sign-in card with the Huddle one sign-in away. The client shipped before the
rules (client v23.17, rules v23.18: a tightening ships client-first, the reverse of a schema expansion).

**The notification itself cannot break.** `fanOutPush` builds the payload server-side with the Admin
SDK, which bypasses rules entirely; the push service delivers it; the service worker renders title and
body straight from the payload. There is no Firestore read and no auth anywhere in that path, and no
document content in the message — only "📋 Latest Daily Huddle" and a tap target. **No rule change can stop
a notification arriving.**

**What this does NOT do is the rest of E6** — bearer URLs already in circulation stay live until the
objects are rotated, and Microsoft still fetches Word documents server-side. That remains open, and is
`ARCHITECTURE.md` EXC-007.

**The ordering lesson, for anything like it.** Gating those reads alone did not put the documents
behind authentication — the bearer URL is the control — so a rules-only change would have cost a
daily-use notification its tap-through and protected nothing. The roster was the more sensitive surface
(annual leave, absence and individual shifts), and closing it first was the right order, not an
accident of what was easy.

---

## 6. What to measure

### Before the gate — using data that already exists

Do this *first*: the decision does not have to wait for E3 telemetry. **`getSignInStats.neverSignedIn`
already counts provisioned accounts that have never signed in** — a decent proxy for the
pure-roster-viewer population, which is precisely who E3 would wall and who Track C5 cannot reach. If
that number is small, the front-door cost is small and the gate is easier. If it is large, E3 is a much
bigger behaviour change than "add a login" and the E4 grace mode carries more weight.

Caveats, so the number is read honestly: it measures **sign-ins, not activity**, there is no history
(only the last sign-in is stored), and it cannot see someone who uses the calendar without an account at
all. It bounds the question rather than answering it — but it bounds it today, for free.

### During E3 (soft)

Shipping the soft posture blind means guessing at the hard cutover. `perf-reporter.js` already records
`loginTotal`; add anonymous counters (no identity, same model as the existing analytics) for:

- launches that hit the wall
- launches resolved by an existing session
- grace-mode activations
- login failures at the wall

Two weeks turns "is a login wall on the home screen acceptable?" from an opinion into a number.

### ⚠️ PRE-REGISTER THE DECISION RULE — before the telemetry starts, not after

Collecting four numbers is only half a decision procedure. The plan must also say **what result means
GO to E5 versus STOP and revise E3–E4** — otherwise the choice is made after seeing the figures, and a
threshold chosen after the fact is not a threshold, it is a rationalisation. The whole reason for
measuring is to be bound by the answer.

**The rule: the owner writes the thresholds down BEFORE the E3 telemetry is switched on, and they
may not be revised once data exists.** Revising them afterwards is allowed exactly once and must be
recorded here as a change of mind, with the reason, so it is visible rather than silent.

They do not have to be invented today — only before E3 ships. The shape they should take:

| Metric | Pre-registered threshold | Meaning if breached |
|---|---|---|
| Login-failure rate at the wall | _to be set_ | The wall is rejecting legitimate staff — revise E3, do not proceed |
| Grace-mode reliance | _to be set_ | Offline is doing more work than designed; E4 is load-bearing, not a safety net |
| Launches resolved by an existing session | _to be set_ | If low, the wall is a daily event rather than an occasional one |
| `neverSignedIn` count at cutover | _to be set_ | The population E5 would lock out with no route back in |
| Migration percentage (Track C) | ≥90% (already agreed for C5) | — |

**Fill these in before E3, in this table, dated.** An empty cell at E3 ship time is itself a
stop condition: it means the experiment has no failure criterion, so it can only ever conclude
"proceed".

---

## 7. Owner decisions

| Decision | Blocks | Notes |
|---|---|---|
| **Which bar — casual, motivated outsider, or individual identity?** | the gate after E2 | The one answer that decides day-vs-weeks, and whether the rest of Track E is needed at all. Casual and motivated-outsider are answered (the gate, §3); individual identity everywhere is E3/E4/E5 and their front-door cost. May be dictated by IT. **Never answer it with E1** — client preparation, not a boundary. |
| **The E3 decision thresholds (§6)** | E3 | Must be written down BEFORE telemetry starts. An empty table at E3 ship time is a stop condition. |
| Is a login wall on the home screen acceptable? | E3 | The calendar is opened many times a day. |
| Is grace mode (§4) an acceptable answer to offline? | E4 | If not, the alternative is longer sessions, not "accept the lockout". |
| Member selector vs identity | E3 | Default to your own roster, or keep a free selector with login as a pure gate? UX, not security. |
| Analytics identity guarantee | E3 | Keep the calendar identity-free, or make it an active-account surface? |
| Anonymous provider fate | — | **Overtaken:** nothing signs in anonymously, so disabling the provider is a Console step that no longer waits on E5. |
| Retire the GitHub Pages mirror? | asserting "behind auth" — **and passkeys outright** | See §8. Passkeys make this binding rather than presentational: a WebAuthn credential is bound to one RP ID, and the two origins share no parent domain, so a passkey registered on one can never work on the other. `PASSWORD_DESIGN.md` → "Passkeys — POSSIBLE, not planned". |
| Do E6 at all, and which delivery model? | E6 | **Decided 19 Sep 2026 (§5):** short-lived signed links, the Office viewer kept. |
| ~~**The identity round trip**~~ — may the Calendar paint before `accounts:lookup` confirms the stored account? | nothing here | **Answered yes (5 Sep 2026), then RETIRED by the owner (26 Sep 2026)** — `DECISIONS.md` → "The provisional paint"; `AUTH_AND_SESSIONS.md` 17. **It was never the E3 gate, though both read as "the calendar auth decision"**: E3 adds friction for security, this would have removed a wait at security's expense, and conflating them decides one by answering the other. The measured offline behaviour is `experiments/auth-firestore-split-proof/`. |

---

## 8. Dependencies and anti-goals

**Track E is the missing precondition for Track C5 — on the route the plan currently takes.** The forced
password-set only reaches people who sign in somewhere; `PASSWORD_DESIGN.md` records that a pure
roster-viewer is never compelled. So the ≥90% migration metric gating retirement of the surname default
**cannot converge** without E3/E5. `PASSWORD_DESIGN.md` → credential lifecycle L7 records a second route (C6) that would
answer the credential question without E3 — **not adopted**; the owner decides.

**The GitHub Pages mirror is a second public front door.** Level 2 rules protect the data on both origins
(same Firebase project), so it is not a hole. But if the driver is "roster data must not sit on a public
URL", a second public origin that cannot serve headers undercuts the claim. Retiring it is likely a
prerequisite for *asserting* the app is behind auth, separate from *being* behind auth.

**A second, harder driver: passkeys.** "Behind auth" is a claim someone can argue about; a WebAuthn RP
ID is not. A passkey is bound to one origin's registrable domain, and `web.app` and `github.io` are both
public suffixes with no shared parent — so the mirror does not weaken passkeys, it **excludes** them for
everyone still on it. That turns this row from a presentational decision into a technical precondition.
Design, options and costs: `PASSWORD_DESIGN.md` → "Passkeys — POSSIBLE, not planned" (credential METHOD
is that file's subject; this file's subject is what sits behind the boundary, which passkeys do not
change).

**Anti-goals — do not:**

- **Do not** ship E3 (client gate) as if it were security. Without E5 the data is unchanged.
- **Do not** bundle client preparation into the rules change it prepares for. The read-await must soak
  on its own; that is the whole point of splitting them.
- **Do not** flip in one step. E0 → E1 → PIN (v20.12, in place of E2) → decision gate → E3 + E4 → E5, reusing the staged posture the B-track
  proved.
- **Do not** treat E6 as part of the rules work. Different failure domain, different fix, independent
  schedule.
- **Do not** verify any of this from an installed phone. Always a **fresh private window with a cold
  cache** — the installed PWA launches from the service-worker cache and will happily hide a broken live
  site (CLAUDE.md → "Deployment health check").
- **Starting E3 consciously REVERSES a recorded decision** — `PASSWORD_DESIGN.md` → credential lifecycle L4, keep both
  kinds of Calendar access (the staff PIN for the shared station PC). Record the reversal when it
  happens — do not make it silently. **Retiring the PIN (23 Nov 2026) was that reversal**, and it is
  recorded there and in DECISIONS.md.

---

## 9. Verification checklist (per phase)

- [ ] Fresh **private window**, cold cache — not an installed PWA.
- [ ] Notification tap on a cold start opens the Huddle (E1/E5 and the sign-in card all touch this path).
- [ ] Drawer → Circular and Newsletter still open in one tap.
- [ ] Aeroplane mode with a valid session: cached roster renders (E4).
- [ ] Aeroplane mode with an expired session: grace mode, not a login wall (E4).
- [ ] `npm run test:rules` — the rules behave as written.
- [ ] `npm test` — `firestore-contract-parity.test.mjs` still passes (the client↔rules lists).
- [ ] Rollback rehearsed: every phase is a release revert or a rules revert, no data migration.
