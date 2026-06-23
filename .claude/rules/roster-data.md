---
paths:
  - "roster-data.js"
  - "roster-cycle-data.js"
---

# roster-data.js — key invariants

## Adding a new team member

Always invoke `/new-starter` — it has the full 3-step checklist including:
- The pro-rata AL formula (`⌈(daysRemainingInYear / 365) × entitlement⌉`) with grade-specific entitlements
- The mandatory `npm run generate:roster-members` step (CEA/CES/Dispatcher only) — without it, the new member's shifts are silently excluded from every roster PDF import

`startDate` must be `new Date(year, month-1, day)` — **midnight local, no time component**. A time component breaks `calcProRateFactor`.

## rosterChanges

`rosterChanges` entries must be **sorted ascending by `from`**. `resolveMemberRoster(member, date)` picks the latest entry whose `from` ≤ date — unsorted arrays return wrong results silently.

## APP_VERSION

`APP_VERSION` here is the **primary source** — `npm run bump <version>` updates all 9 locations from it. Do not edit other locations by hand.
