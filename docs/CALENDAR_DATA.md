# Calendar data — the contract

*Not version-stamped; not a runtime asset. What the Calendar may SHOW, and when.*

**This is the authoritative contract for Calendar data.** Other documents link here rather than
restating knowledge-state, access-gate or cache-ordering rules.

Read the invariants. If you are about to change how a shift reaches the screen, one of them is
probably the thing you are about to break.

**This file states WHAT must hold. It does not explain WHY** — that lives in the module header
beside the code, where it cannot drift from the thing it describes. Every row points at its home.

---

## Invariants

| # | Invariant | Where it lives |
|---|---|---|
| 1 | **Unknown is not "no override".** A month whose overrides have not loaded must not be drawn from the base roster — an absent override and an unfetched one are different facts, and only one of them means "working". | `calendar-data-state.js` |
| 2 | **Four knowledge states, and none collapses into another.** `unknown` · `cached` · `authoritative` · `error`. `cached` exists so a device holding good data is not reduced to a spinner. | `calendar-data-state.js` |
| 3 | **No access, no override data — at source.** Firestore rules are evaluated server-side, so a `getDocsFromCache` hit never consults them. The client refuses the read itself. | `calendar-overrides.js` (THE ACCESS GATE) · `calendar-access-state.js` |
| 4 | **A grant is not always the FIRST grant.** Re-unlocking clears the fetched-month claims, or months claimed under the old session block every read under the new one. | `calendar-overrides.js` (A GRANT IS A FRESH START) · `calendar-access.js` (`grant`) |
| 5 | **A late superseded read may not evict what a newer one loaded.** Ordering the render without ordering the write is half a fix. | `calendar-overrides.js` (`_monthOwner`/`_monthSlices`) |
| 6 | **Only ONE authoritative reconciler per range.** A second one racing it is the Team View eviction bug. | `override-utils.js` (`reconcileRangeIntoCache`) |
| 7 | **`getBaseShift()` is the only way to read a base shift.** Direct `roster.data` access bypasses start-date suppression, Christmas rules and scheduled roster changes. | `roster-data.js` |
| 8 | **`isChristmasRD()` applies BEFORE Firestore overrides.** Dec 25/26 force to RD first so Dec 26 can then be overridden to RDW. Never reorder. | `roster-data.js` |
| 9 | **Sundays are non-contracted.** The forbidden write types are declared once as `SUNDAY_FORBIDDEN_TYPES` — consult it rather than restating it here. Six enforcement layers, none removable alone. | `override-utils.js` · CLAUDE.md → architecture decisions |
| 10 | **Phase 1 paints with no network and no SESSION — but not before Firebase Auth has initialised.** Requiring a session for reads must never put a sign-in round trip in front of data the device already holds, and phase 1 never awaits one. It cannot beat the stored user's `accounts:lookup`, though: Firestore holds every operation, `getDocsFromCache` included, until Auth reports its first user (measured Sep 2026 — a cache read behind a 2s lookup settled at ~2s, and at ~7ms with Auth absent). Do not build on phase 1 finishing before that round trip. | `calendar-initial-fetch.js` |
| 11 | **A member is never sent to the staff PIN.** A held session with no restored identity gets a sign-in card, and the late-identity watcher keeps listening — and a member whose access is LOST mid-session gets that same card, not the PIN one. | `calendar-access.js` · `calendar-access-core.js` |
| 12 | **The viewer's persistence is session-only, and boot must not migrate it.** `setPersistence` moves the current user between stores. | `firebase-client.js` (`authReady`) |
| 13 | ~~**A provisional paint is scoped to ONE member, and is not access.**~~ **RETIRED 26 Sep 2026** (owner decision — `DECISIONS.md` → "The provisional paint"). No override data is drawn before `decideAccess` answers, every grant is unscoped, and `setOverrideAccess` takes no member scope; the one thing drawn before the grant is invariant 17's labelled own-roster copy, which is not override data. The number is kept, not reused, so older references to it still resolve here. | `calendar-access.js` · `calendar-overrides.js` (`setOverrideAccess`) |
| 14 | **A personal action is offered only to the person it belongs to, by EVERY route.** The day panel's "Leave dates" and "Pay estimate" buttons open the reader's OWN records, so they appear only where the calendar on screen is the signed-in member's own — never on a colleague's day, and never in viewer mode, which is a separate refusal because a stale session can outlive the identity that earned it. Both routes to the calculator — the panel's button and keyboard Enter — are gated at `navigateToPaycalc`, so a route added later inherits the rule. A refused Enter hands over to the day panel rather than becoming a dead key. | `calendar-access-core.js` (`personalActionsAllowed`) · `calendar-app.js` (`navigateToPaycalc`) · `calendar-al-lightbox.js` |
| 15 | **A document is read only behind the PIN or a password, and the client refuses the read at source.** The Daily Huddle, the Weekly Retail Circular and the Marylebone Newsletter are opened only while `calendar-doc-access.js` is open, which it is exactly while access is held (invariant 21); while shut, no query is issued — cached or live, because the local cache answers without consulting a rule — and a tap is answered with what to do. A tap made while locked (a notification deep link that landed on the PIN card) is held and finished when access arrives. | `calendar-doc-access.js` · `calendar-huddle-viewer.js` · `calendar-doc-viewer.js` · `nav-panel.js` (`canReadDocuments`) · `calendar-access-state.js` |
| 16 | **A "server" read the CACHE answered is not authoritative.** With `persistentLocalCache`, `getDocs` on a dead signal resolves from this device's cache — a subset, possibly empty. It is merged additively (it may not evict), the month is recorded `cached` — or `error` if it held nothing, or if this device never read that month whole (the cache answers from rows other pages fetched one member at a time) — and released for a retry; only a read the server answered may mark a month current. | `calendar-overrides.js` (`SERVED_FROM_CACHE`, `_heldWhole`) |
| 17 | **The member's OWN stored roster may be shown before the grant — labelled, and nowhere else** (owner decision, 5 Oct 2026 — DECISIONS.md → "The own-roster copy"). An app-owned copy in plain storage, not Firestore, so it is not queued behind the sign-in round trip. Shown only for the signed-in member's own calendar, never Team View, never the PIN; drawn as `stale` with "Checking for changes…" (on paper too); never written into `rosterOverridesCache` and never `noteKnowledge`, so it cannot mark a month known, grant access or count leave. Deleted on every sign-out and session expiry, on a PIN or failed grant, on access loss and for any other member; a month older than `MAX_AGE_MS` is dropped on read. | `calendar-snapshot.js` · `calendar-app.js` (`_paintSnapshotBeforeGrant`, `setSnapshotSource`) · `calendar-access.js` (`paintBeforeDecision`) |
| 18 | **A month known current is re-read once it is old, when the page comes back into view or while it stays in view — and a re-read that fails takes "current" away, never the grid.** A settled month older than `STALE_MONTH_MS` (`calendar-initial-fetch.js`) is released on `visibilitychange` → visible, on a back/forward-cache restore and every `STALE_MONTH_MS` while the page is visible, and the re-render reads it again behind the grid already drawn. A failed re-read cannot blank a good grid: a month this device holds the server's earlier answer for is kept and drawn as the labelled saved copy (`cached`, "As rostered" withheld) until a read succeeds — only where that failure is the newest news, so a slow read that fails after another has landed un-confirms nothing. A retried month keeps its grid the same way, and a saved-copy month is asked for again on the next return to the page, whatever its age. The label is part of the month on paper too: a printed saved copy keeps its words and leaves off only Try again (`index.css` print block; `e2e/print.spec.js`). A month still in flight, or owned by the initial fetch, is never released under its own read. The leave panel follows invariant 16 too: a cache-served year is refused, never counted — and a balance this device saved earlier is shown labelled "Saved copy — checking for changes…" while it is re-read, and "Saved copy — couldn't check for changes" if that fails, never as current. | `calendar-overrides.js` (`releaseStaleMonths`, `oweRecheck`, the catch in `ensureOverridesCached`) · `calendar-data-state.js` (`noteCheckFailed`) · `calendar-initial-fetch.js` · `calendar-al-lightbox.js` |
| 19 | **Christmas leave is DERIVED, drawn by one resolver, and never counted** (owner, 5 Nov 2026). From 2026 a member whose PATTERN had them due at work on 25 or 26 December (a shift or a spare day, never a Sunday) is shown on annual leave there — only where no override applies, so anything recorded on the day wins. Nothing is stored for it. Every surface that draws a day asks `resolveDayShift` (Calendar, Team Week, the legend, Overtime's roster, Admin's week grid); the leave records list exactly those days; no allowance counts them; and the day panel's "changed from" names what was ROSTERED, not the rest day invariant 8 makes both days — except where a record made the day WORK, which changed it from the leave. Working a Boxing Day one was due to work adds a day to that year's allowance, read through `entitlementFor` and nowhere else. | `christmas-leave.js` · `al-entitlement.js` (`entitlementFor`, `consumesEntitlement`) · `calendar-renderer.js` |
| 20 | **An answer belongs to the grant that asked for it.** The access gate (invariant 3) is checked when a read is issued, and again whenever its outcome is handled: every read takes a ticket as it is issued, and an answer, a failure or a time limit that arrives after access has been lost — or lost and granted again (invariant 4) — commits and reports nothing. No rows, no knowledge, no claim, no chip and no repaint, for the server read and the local-cache read alike. ONE rule decides it (`answerStillWanted`), so no path can ask half of it. A late answer is thrown as `READ_SUPERSEDED`: it is not a failure to report, and above all not a success to record. The first load's stand-down hands its months over: its flag comes down and, where access is held, it re-renders, so the grant now holding the Calendar reads its months itself. | `calendar-overrides.js` (`issueReadTicket`, `answerStillWanted`, `READ_SUPERSEDED`) · `calendar-initial-fetch.js` (`standing`, `standDown`) |
| 21 | **Whether access is held is kept ONCE.** The roster reads (invariant 3) and the documents (invariant 15) ask one module for the answer, so they open on the same grant and shut on the same loss by construction: no route that loses access can shut one and leave this device's saved copy readable through the other. The answer is written before anyone is told, so nothing that reacts reads through a gate in its old position. A grant writes it after the card has gone and before the first render; a loss shuts it before a card goes up, whichever of the two routes noticed. Only the access layer and the two gates may write it; anything else that must follow access reads or listens. | `calendar-access-state.js` · `calendar-access.js` (`grant`, `handleAccessLost`) |

**Invariant 3 and invariant 17 do not conflict.** The own-roster copy is not override data from
Firestore: the override gate stays shut until the grant, and the copy never enters the cache the gate
protects. The provisional paint that came before it (invariant 13) was retired because its cache read
waited behind the same round trip invariant 10 describes; the reasoning, and what would reopen
either, is `DECISIONS.md` → "The provisional paint" and "The own-roster copy". The latency evidence
is `LATENCY.md`.

---

## Dependencies

```
Calendar
 ├─ roster-data.js            base shifts, cycles, member records
 ├─ override-utils.js         the override → display ladder (resolveEffectiveShift)
 ├─ calendar-overrides.js     the Firestore cache, its gate and its write ordering
 ├─ calendar-data-state.js    what is KNOWN, and what may therefore be shown
 ├─ calendar-access.js        the access decision (member session or staff PIN)
 ├─ calendar-snapshot.js      the member's own stored roster, shown before the grant (17)
 ├─ christmas-leave.js        25/26 December leave, derived from the pattern (19)
 └─ firebase-client.js        Firestore + the auth persistence chain
```

`resolveEffectiveShift` is shared with **Team View** and **Overtime**. Changing it changes all three
— see CLAUDE.md → *Change impact*.

---

## Proofs that are not CI gates

Two properties here can only be measured in a real browser, and both have a committed harness rather
than an assertion:

- `experiments/firestore-offline-proof/` — does the local Firestore cache serve reads the rules would
  deny? (Yes. Which is why invariant 3 exists.)
- `experiments/viewer-persistence-proof/` — does the shared viewer really die with the browser
  session? (It did not, until the fix behind invariant 12.)
