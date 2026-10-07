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
| 3 | **No access, no override data — at source.** Firestore rules are evaluated server-side, so a `getDocsFromCache` hit never consults them. The client refuses the read itself. | `calendar-overrides.js` (`setOverrideAccess`) |
| 4 | **A grant is not always the FIRST grant.** Re-unlocking clears the fetched-month claims, or months claimed under the old session block every read under the new one. | `calendar-access.js` (`onEveryGrant`) |
| 5 | **A late superseded read may not evict what a newer one loaded.** Ordering the render without ordering the write is half a fix. | `calendar-overrides.js` (`_monthOwner`/`_monthSlices`) |
| 6 | **Only ONE authoritative reconciler per range.** A second one racing it is the Team View eviction bug. | `override-utils.js` (`reconcileRangeIntoCache`) |
| 7 | **`getBaseShift()` is the only way to read a base shift.** Direct `roster.data` access bypasses start-date suppression, Christmas rules and scheduled roster changes. | `roster-data.js` |
| 8 | **`isChristmasRD()` applies BEFORE Firestore overrides.** Dec 25/26 force to RD first so Dec 26 can then be overridden to RDW. Never reorder. | `roster-data.js` |
| 9 | **Sundays are non-contracted.** The forbidden write types are declared once as `SUNDAY_FORBIDDEN_TYPES` — consult it rather than restating it here, which is how this row came to name two of the four. Six enforcement layers, none removable alone. | `override-utils.js` · CLAUDE.md → architecture decisions |
| 10 | **Phase 1 paints with no network and no SESSION — but not before Firebase Auth has initialised.** Requiring a session for reads must never put a sign-in round trip in front of data the device already holds, and phase 1 never awaits one. It cannot beat the stored user's `accounts:lookup`, though: Firestore holds every operation, `getDocsFromCache` included, until Auth reports its first user (measured Sep 2026 — a cache read behind a 2s lookup settled at ~2s, and at ~7ms with Auth absent). Do not build on phase 1 finishing before that round trip; this row claimed "no auth" until then. | `calendar-initial-fetch.js` |
| 11 | **A member is never sent to the staff PIN.** A held session with no restored identity gets a sign-in card, and the late-identity watcher keeps listening — and a member whose access is LOST mid-session gets that same card, not the PIN one (v23.19; the re-lock path sent everyone to the PIN until then). | `calendar-access.js` · `calendar-access-core.js` |
| 12 | **The viewer's persistence is session-only, and boot must not migrate it.** `setPersistence` moves the current user between stores. | `firebase-client.js` (`authReady`) |
| 13 | ~~**A provisional paint is scoped to ONE member, and is not access.**~~ **RETIRED 26 Sep 2026** (owner decision — `DECISIONS.md` → "The provisional paint"). There is no longer any paint before the grant: nothing roster-shaped is drawn until `decideAccess` answers, every grant is unscoped, and `setOverrideAccess` takes no member scope. The number is kept, not reused, so older references to it still resolve here. | `calendar-access.js` · `calendar-overrides.js` (`setOverrideAccess`) |
| 15 | **A document is read only behind the PIN or a password, and the client refuses the read at source.** The Daily Huddle, the Weekly Retail Circular and the Marylebone Newsletter are opened only while `calendar-doc-access.js` is open, which the coordinator does on the grant; while shut, no query is issued — cached or live, because the local cache answers without consulting a rule — and a tap is answered with what to do. A tap made while locked (a notification deep link that landed on the PIN card) is held and finished when access arrives. | `calendar-doc-access.js` · `calendar-huddle-viewer.js` · `calendar-doc-viewer.js` · `nav-panel.js` (`canReadDocuments`) · `calendar-app.js` (`onEveryGrant`) |
| 14 | **A personal action is offered only to the person it belongs to, by EVERY route.** The day panel's "Leave dates" and "Pay estimate" buttons open the reader's OWN records, so they appear only where the calendar on screen is the signed-in member's own — never on a colleague's day, and never in viewer mode, which is a separate refusal because a stale session can outlive the identity that earned it. The calculator has TWO routes since v23.59 — the panel's button and keyboard Enter — and BOTH are gated at `navigateToPaycalc`, so a route added later inherits the rule. The third went when a click started opening the panel on every pointer type instead of jumping. A refused Enter hands over to the day panel rather than becoming a dead key. | `calendar-access-core.js` (`personalActionsAllowed`) · `calendar-app.js` (`navigateToPaycalc`) · `calendar-al-lightbox.js` |
| 17 | **The member's OWN stored roster may be shown before the grant — labelled, and nowhere else** (v24.59, owner decision Oct 2026; DECISIONS.md → "The own-roster copy"). An app-owned copy in plain storage, not Firestore, so it is not queued behind the sign-in round trip. Shown only for the signed-in member's own calendar, never Team View, never the PIN; drawn as `stale` with "Checking for changes…"; never written into `rosterOverridesCache` and never `noteKnowledge`, so it cannot mark a month known, grant access or count leave. Deleted on every sign-out and session expiry, on a PIN or failed grant, on access loss, for any other member, and after 14 days. | `calendar-snapshot.js` · `calendar-app.js` (`_paintSnapshotBeforeGrant`, `setSnapshotSource`) · `calendar-access.js` (`paintBeforeDecision`) |
| 18 | **A month known current is re-read once it is old, when the page comes back into view** (Oct 2026 review). A settled month older than ten minutes is released on `visibilitychange` → visible and on a back/forward-cache restore, and the re-render reads it again behind the grid already drawn. A failed re-read cannot blank a good grid, because knowledge never downgrades; a month still in flight, or owned by the initial fetch, is never released under its own read. The leave panel follows invariant 16 too: a cache-served year is refused, never counted. | `calendar-overrides.js` (`releaseStaleMonths`) · `calendar-initial-fetch.js` · `calendar-al-lightbox.js` |
| 16 | **A "server" read the CACHE answered is not authoritative.** With `persistentLocalCache`, `getDocs` on a dead signal resolves from this device's cache — a subset, possibly empty. It is merged additively (it may not evict), the month is recorded `cached` — or `error` if it held nothing — and released for a retry; only a read the server answered may mark a month current (v24.48, external audit F1). | `calendar-overrides.js` (`SERVED_FROM_CACHE`) |

**The decision that hung over invariant 3 was answered on 5 Sep 2026 and UNDONE on 26 Sep.** The
Calendar's access decision waits on the network round trip Firebase makes to validate a stored user,
the measured cause of the start-latency wall (`LATENCY.md`). The owner first ruled that a returning
member might see their own cached roster while it completed (v22.97, invariant 13). It could not
deliver that: the cache read the paint needed waits behind the same round trip (invariant 10's
measurement), so it fired on about one open in eight hundred — and it shipped two defects in the gap
between a scoped and an unscoped grant. The owner retired it on 26 Sep 2026; invariant 3 stands as
written, and the reasoning and what would reopen it are in `DECISIONS.md` → "The provisional paint".
**It was reopened on 5 Oct 2026 in exactly the shape that entry named** — an app-owned copy read from
plain storage, which does not wait on the round trip — and that is invariant 17. Invariant 3 still
stands: the copy is not override DATA from Firestore, the override gate stays shut until the grant,
and the copy never enters the cache the gate protects.

---

## Dependencies

```
Calendar
 ├─ roster-data.js            base shifts, cycles, member records
 ├─ override-utils.js         the override → display ladder (resolveEffectiveShift)
 ├─ calendar-overrides.js     the Firestore cache, its gate and its write ordering
 ├─ calendar-data-state.js    what is KNOWN, and what may therefore be shown
 ├─ calendar-access.js        the access decision (member session or staff PIN)
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
  session? (It did not, until v21.21. Invariant 12.)
