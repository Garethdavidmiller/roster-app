# MYB Roster — Product Roadmap

*Last updated: March 2026 — v4.55*

---

## Completed phases

### Phase 1 — Firestore read layer ✓
Owner manually enters shift overrides. App reads and overlays them on the base roster. No user logins required.

### Phase 2 — Staff self-service portal ✓ Nearly complete
Individual staff log in and enter their own overrides. Admin (G. Miller) has elevated access.

**What was built:**
- admin.html — self-service portal for all staff plus admin tools
- Individual login per staff member (name + surname password)
- AL booking with entitlement tracking (32 days CEA, 34 days CES/Dispatcher/Fixed)
- Bulk override operations and override history
- Islamic calendar marker preference per member
- Dispatcher and fixed roster types

**Auth note:** The original plan specified Firebase Auth (Microsoft SSO or email/password). The implementation uses a simpler surname-based password with localStorage sessions. This was a deliberate divergence — no Chiltern IT dependency, no registration flow, works immediately for all staff. If stronger authentication is ever needed, this is the point to revisit.

---

## Future capabilities — optional, no fixed sequence

Nothing below is committed. Each area is independent unless a dependency is noted.

---

### Operational visibility
**What:** Daily deployment view — who is working, spare, or on AL across the whole team for any given day. Useful for supervisors planning cover.

**Depends on:** Nothing new. All data already in Firestore.

**Worth doing if:** Supervisors currently do this manually from the calendar view.

---

### Approval workflows
**What:** Staff submit requests (shift swaps, overtime availability). Supervisor sees pending requests and approves or declines. Outcomes recorded in Firestore.

**Depends on:** Current auth model is sufficient for submitting requests. Supervisor UI needed.

**Decision point:** How much request volume is there? If the owner currently handles a small number of changes by direct conversation, formal workflows may add process without adding value.

---

### Notifications
**What:** Staff notified when a spare is assigned or a request is approved. Supervisor notified when requests arrive.

**Depends on:** Firebase Cloud Functions — requires upgrading to Blaze (pay-as-you-go) plan. Small cost but billing must be enabled. Approval workflows should exist first.

**iOS note:** PWA push notification reliability on iOS should be assessed in real use. Poor iOS delivery is a trigger to consider native app conversion (see below).

**Alternative:** In-app status checking may be sufficient. Many teams operate without push notifications.

---

### Formal AL management
**What:** Official AL request and approval workflow with entitlement tracking across the year.

**Depends on:** Approval workflows (above).

**Important caveat:** Chiltern Railways has an official HR system for leave management. Building a parallel approval process risks conflict between the two systems. This capability should remain clearly informational unless there is explicit agreement with management that the app's approval carries official weight.

---

### Calendar export
**What:** Staff shifts available in their phone calendar.

**Two routes — do the simpler one first:**

- **.ics file export** (simple): One-click download, staff import into any calendar app manually.
  Re-import needed when roster changes, but the base roster is stable. Build this first and
  assess whether demand for automatic sync is real.

- **Automatic calendar sync** (complex): Shifts pushed directly to Google Calendar, Apple
  Calendar, or Outlook whenever the roster changes. Requires Firebase Cloud Functions and
  three separate calendar APIs. Microsoft Graph requires Chiltern IT involvement.

---

### Native app (conditional)
**Only pursue if one of these is true:**
- iOS push notification delivery is unacceptably unreliable in real use
- Chiltern IT require app store distribution via MDM
- PWA limitations are genuinely felt by users

**If pursued:** React Native. Same JavaScript language, Firebase carries over, only the UI layer needs rewriting. Requires Apple Developer account ($99/year) and Google Play ($25).

Do not build speculatively. The PWA works well for the current use case.

---

## Open decisions

**Auth hardening:** The surname password is practical for a roster app. If approval workflows or formal AL management are added, consider whether a colleague logging in as another person is an acceptable risk. Assess at the time.

**Multi-admin:** `ADMIN_NAME` is currently a single hardcoded value. If the app is relied upon operationally, who covers admin when G. Miller is absent?

**Official status:** Is this app sanctioned by Chiltern Railways? The more operationally critical it becomes, the more important this question is.

**GDPR:** Staff shift data is personal data. If the app becomes official infrastructure, data controller status and retention policies will need documenting.
