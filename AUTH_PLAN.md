# AUTH_PLAN.md — full-app authentication (Track E)

*Not version-stamped; not a runtime asset. Companion to `SECURITY_RELEASE_PLAN.md` → Track E.*

**Which doc owns what.** `SECURITY_RELEASE_PLAN.md` is the *sequencing and risk* master across Tracks
A–E and keeps the phase list (E0…E6) in the order they may ship. **This file is authoritative for the
design**: what "behind authentication" can actually mean here, what is exposed today, how each phase is
built, the offline answer, and what to measure. Neither file restates the other's half — if they ever
disagree, that is a defect, and the v19.00 sweep found exactly that kind of drift once already
(Track E claimed the Level‑1 gate was "≈ zero cost" while `KNOWN_LIMITATIONS.md` correctly called it a
real breakage risk; the code sided with KNOWN_LIMITATIONS).

**Status: UNDECIDED.** Only **E0 has shipped** (v19.00 — search engines excluded). Everything past the
decision gate below is an option, not a commitment. The most likely trigger is external: if the app
becomes, or is assessed as, official Chiltern infrastructure, IT may require the roster data to sit
behind authentication rather than a public URL. Until then the deliberate public-calendar design stands.

---

## 1. What "behind authentication" can and cannot mean here

The single most important framing in this plan, because the phrase bundles three different problems and
only one of them is enforcement.

| Layer | Can it go behind auth? | Where the work is |
|---|---|---|
| **Data** — Firestore reads | **Yes, server-enforced.** The only real control. | E2 / E5 (rules) + E1 (client prep) |
| **Files** — Storage documents | **Not by any rules change.** They ride permanent bearer URLs. | E6 (delivery-model change) |
| **Shell** — HTML/CSS/JS | **No.** Static files on public hosting. A client gate is UX, never security. | E3 (UX only) |

Two consequences follow, and both are easy to get wrong:

- **A login overlay on the calendar buys nothing by itself.** `auth-policy.js` says so in its own header
  ("This is CLIENT-side UX, NEVER the security boundary"). Shipping E3 without E5 would look like the
  app is behind a login while every byte remains fetchable over REST.
- **"The entire app behind authentication" is not literally achievable** on Firebase Hosting static
  serving — the app shell is public by construction. What is achievable is *all data behind a named
  session*, plus a client gate so the UI matches. Say it that way to anyone asking for the guarantee.

---

## 2. What is actually exposed today (verified, v19.00)

Open reads (`allow read;` in `firestore.rules`): **`overrides`, `huddles`, `circulars`, `newsletters`**.
Everything else already requires auth, and most requires a claim.

- **`overrides`** carries `memberName` + `date` + `type` + `value` — so AL, absence, and shift changes
  for every member. This is personal data; absence especially. (The app never stores a *reason* — that
  is a deliberate GDPR decision recorded in CLAUDE.md — but "who was absent, and when" is readable.)
- **The three document collections** carry the download URLs for internal Chiltern operational
  documents.
- **`storageUrl` is a permanent tokenised bearer URL**, so the document *files* are not protected by
  rules at all — see §5.

**The exposure being closed is outsider-with-URL, not colleague-to-colleague.** The member selector
already lets any staff member view any colleague's roster and leave, by design. Track E does not change
that and is not intended to.

**Be honest about the bar.** The Firebase project config ships in the client JS, so a determined reader
can replicate the anonymous sign-in. Level 1 raises the cost from "trivially public" to "must script an
anonymous session against our project". Only Level 2 (named) means "must be staff".

---

## 3. The phases

### E0 — exclude search engines ✓ SHIPPED v19.00
`X-Robots-Tag: noindex, nofollow` on Firebase Hosting + a mirrored `<meta name="robots">` in all ten
served pages, because GitHub Pages serves no headers and a `robots.txt` cannot reach the mirror (only
honoured at an origin root; the mirror lives under `/roster-app/`). `robots.txt` deliberately **permits**
crawling — a crawler blocked from fetching can never read the noindex, so `Disallow: /` would hide the
signal rather than the page. Guarded by `sw-asset-check.test.mjs`. Needed no decision and depends on
nothing below.

### E1 — make the calendar's reads await auth (prep, behaviour-preserving)
**Ship as its own release, before any rules change.** `calendarAuthReady` (`calendar-app.js`) gates only
*writes* — error reporter, usage counter, push renewal. Four paths read with whatever auth state happens
to exist:

| Path | Reads |
|---|---|
| `calendar-initial-fetch.js` | the 3-month `overrides` fetch |
| `calendar-huddle-viewer.js` | the `#huddle` snapshot |
| `calendar-doc-viewer.js` | `#circular` / `#newsletter` (notification taps) |
| `nav-panel.js` | the drawer's Circular/Newsletter open |

Harmless under `allow read;`. The moment reads need a session, all four race `signInAnonymously` on a
cold start — an empty calendar, or a notification tap that opens nothing. This ships green under today's
rules, so it soaks alone and turns E2 from "a rules edit that might break notification taps" into "a
rules edit".

### E2 — Level 1 rules: `request.auth != null`
On `overrides` + the three document collections, only after E1 has soaked. Blocks unauthenticated REST
scraping and casual URL sharing. ~6 of the 199 tests in `firestore.rules.test.mjs` flip (`anon can read`
→ `assertFails`, plus new authenticated-anon cases). Keep the Anonymous auth provider **enabled**.

### ⟨ DECISION GATE ⟩ — is Level 1 enough?
Binary, and it decides whether this is a day or several weeks.

- **Casual exposure** (indexing, a shared link, idle curiosity) → E0+E2 are sufficient. **Stop here.**
- **A motivated outsider** willing to script an anonymous sign-in → you need named-only (E5), and you
  buy the front-door cost that E3/E4 exist to manage.

Everything past this gate touches the app's front door, opened many times a day.

### E3 — named calendar, soft posture
Flip `PAGE_POLICIES.calendar` to `{ requireNamed: true }` in `auth-policy.js` (genuinely one line — the
policy layer is clean) and wire the shared `login-overlay.js`. Gate on `ENFORCE_NAMED_SESSION` in **soft**
posture and *measure* (§6) before hardening. Do not tighten rules in the same window.

Two things make this less of a leap than it sounds: the calendar already has session-gated affordances
(the pay-period strip, `calendar-app.js`), and `login-overlay.js` is proven on five pages. It also
*removes* an inconsistency — today the app has two contradictory onboarding stories, one where a new
starter picks a name from a dropdown and one where they sign in.

### E4 — offline grace mode (ships **with** E3, not after)
See §4. Without it, E3 is a genuine regression; with it, it is not.

### E5 — Level 2 rules: `token.name != null` + hard gate
Only after E3 soaks and the numbers say the wall is survivable. At this point `signInAnonymously` is dead
code and the **Anonymous provider can be disabled project-wide** — real hardening, and it settles the
"retire the anonymous fallback" residual in SECURITY_RELEASE_PLAN. Decide those two together.

### E6 — put the document FILES behind auth (independent; can start any time)
See §5. Does **not** depend on the calendar decision.

---

## 4. The offline answer (E4)

Track E originally called offline lockout "the sharpest consequence… a genuine regression to weigh". It
is softer than that, because **both halves are ours**:

- The 30-day/7-day expiry is *our* localStorage construct (`SESSION_MS` / `IDLE_MS` in `session.js`), not
  Firebase's. Firebase refresh tokens do not expire on that schedule.
- **Firestore rules are evaluated server-side.** The persistent local cache serves offline reads without
  consulting them. The roster is still on the device.

So an offline member with a lapsed session would not be locked out by Firebase — they would be locked out
by *our own overlay*. That makes it a design problem, not a constraint.

**The design:**

1. Keep a **durable device marker** ("this device has previously held a valid named session"), separate
   from the expiring session blob. `reconcileExpiredIdentity()` currently signs the Firebase user out on
   expiry, so the marker cannot be inferred from auth state afterwards — it must be written deliberately.
2. On launch: session expired **and** `navigator.onLine === false` **and** marker present → render the
   cached roster **read-only** with a calm banner ("Showing your saved roster — sign in when you're back
   online"), instead of the login overlay.
3. **Read via `getDocsFromCache` explicitly in grace mode.** A live listener would try to re-attach on
   reconnect and surface `permission-denied` under Level 2 rules, blanking a roster the member was
   reading a second earlier.
4. The moment connectivity returns, require the real login.

**Why this costs nothing against the threat being defended.** Grace mode only helps someone holding a
device that was already signed in — the device-theft threat model, not outsider-with-URL. It is no weaker
than today's behaviour, where a cached roster always renders.

**The other three front-door consequences**, for completeness: notification deep-links must survive the
login flow (a `#huddle` tap on a lapsed session lands on a login screen); first-run onboarding becomes
"sign in" rather than "pick your name"; and the document viewers currently rely on open reads *because*
the calendar had no session, so E5 couples them to login working on every path.

---

## 5. The documents are the gap nobody asks about (E6)

`storage.rules` gates direct Storage SDK reads, but staff never read documents that way — they open the
permanent tokenised `storageUrl` saved in the Firestore doc, which carries its own access token and
**bypasses the rules entirely**. `storage.rules` says so itself: *"Don't store confidential files here
unless that delivery model changes."*

**Therefore: no phase in E1–E5 puts these documents behind authentication.** Those phases change who can
*discover* a URL. Anyone who has ever held one — a forwarded link, browser history, a synced bookmark —
keeps access indefinitely, and revocation means rewriting the object, not editing a rule.

Worth stating plainly when prioritising: **the change everyone reaches for first (a login on the
calendar) protects the personal data and leaves the company-confidential documents exactly as they are.**

Options, roughly in cost order:

1. **Authenticated SDK download (`getBlob`).** The in-app viewers already render inline, so the path that
   changes is the drawer's one-tap "open in a new tab". Storage rules then actually bite.
2. **Short-lived signed URLs** minted by an authenticated Cloud Function. Note GCS caps v4 signed URLs at
   7 days — which is *why* the tokenised URL was chosen (retention is 3–6 months) — so this means minting
   on demand, not at upload.
3. **Accept it**, but as a recorded decision rather than an accident.

Whichever is chosen, **existing tokens must be rotated** — old URLs stay live until the objects are
rewritten.

---

## 6. What to measure at E3 (soft)

Shipping the soft posture blind means guessing at the hard cutover. `perf-reporter.js` already records
`loginTotal`; add anonymous counters (no identity, same model as the existing analytics) for:

- launches that hit the wall
- launches resolved by an existing session
- grace-mode activations
- login failures at the wall

Two weeks turns "is a login wall on the home screen acceptable?" from an opinion into a number.

---

## 7. Owner decisions

| Decision | Blocks | Notes |
|---|---|---|
| **Which bar — casual, or motivated outsider?** | the gate after E2 | The one answer that decides day-vs-weeks. May be dictated by IT. |
| Is a login wall on the home screen acceptable? | E3 | The calendar is opened many times a day. |
| Is grace mode (§4) an acceptable answer to offline? | E4 | If not, the alternative is longer sessions, not "accept the lockout". |
| Member selector vs identity | E3 | Default to your own roster, or keep a free selector with login as a pure gate? UX, not security. |
| Analytics identity guarantee | E3 | Keep the calendar identity-free, or make it an active-account surface? |
| Anonymous provider fate | E5 | Disable project-wide, or keep as a Level-1 tier? |
| Retire the GitHub Pages mirror? | asserting "behind auth" | See §8. |
| Do E6 at all, and which delivery model? | E6 | Independent of everything above. |

---

## 8. Dependencies and anti-goals

**Track E is the missing precondition for Track C5.** The forced password-set (v18.92) only reaches people
who sign in somewhere; `PASSWORD_PLAN.md` records that a pure roster-viewer is never compelled. So the
≥90% migration metric gating retirement of the surname default **cannot converge** without E3/E5. If
finishing the password work matters, that is an argument for Track E with nothing to do with IT.

**The GitHub Pages mirror is a second public front door.** Level 2 rules protect the data on both origins
(same Firebase project), so it is not a hole. But if the driver is "roster data must not sit on a public
URL", a second public origin that cannot serve headers undercuts the claim. Retiring it is likely a
prerequisite for *asserting* the app is behind auth, separate from *being* behind auth.

**Anti-goals — do not:**

- **Do not** ship E3 (client gate) as if it were security. Without E5 the data is unchanged.
- **Do not** bundle E1 into E2. The read-await must soak on its own; that is the whole point of splitting
  them.
- **Do not** flip in one step. E0 → E1 → E2 → ⟨gate⟩ → E3+E4 → E5, reusing the staged posture the B-track
  proved.
- **Do not** treat E6 as part of the rules work. Different failure domain, different fix, independent
  schedule.
- **Do not** verify any of this from an installed phone. Always a **fresh private window with a cold
  cache** — the installed PWA launches from the service-worker cache and will happily hide a broken live
  site (CLAUDE.md → "Deployment health check").
- **Starting E2 consciously REVERSES a documented anti-goal** (the calendar's deliberate anonymous read
  surface, SECURITY_RELEASE_PLAN → "What NOT to do"). Re-stamp that entry when it happens — do not
  violate it silently.

---

## 9. Verification checklist (per phase)

- [ ] Fresh **private window**, cold cache — not an installed PWA.
- [ ] Notification tap on a cold start opens the Huddle (E1/E2/E5 all touch this path).
- [ ] Drawer → Circular and Newsletter still open in one tap.
- [ ] Aeroplane mode with a valid session: cached roster renders (E4).
- [ ] Aeroplane mode with an expired session: grace mode, not a login wall (E4).
- [ ] `npm run test:rules` — the rules behave as written.
- [ ] `npm test` — `firestore-contract-parity.test.mjs` still passes (the client↔rules lists).
- [ ] Rollback rehearsed: every phase is a flag flip or a rules revert, no data migration.
