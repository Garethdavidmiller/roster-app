# Calendar data — the contract

*Not version-stamped; not a runtime asset. What the Calendar may SHOW, and when.*

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
| 9 | **Sundays are non-contracted.** No `annual_leave` or `sick` override may be written or displayed on a Sunday — five enforcement layers, none removable alone. | CLAUDE.md → architecture decisions |
| 10 | **Phase 1 paints with no network and no auth.** Requiring a session for reads must never put a sign-in round trip in front of data the device already holds. | `calendar-initial-fetch.js` |
| 11 | **A member is never sent to the staff PIN.** A held session with no restored identity gets a sign-in card, and the late-identity watcher keeps listening. | `calendar-access.js` · `calendar-access-core.js` |
| 12 | **The viewer's persistence is session-only, and boot must not migrate it.** `setPersistence` moves the current user between stores. | `firebase-client.js` (`authReady`) |

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
