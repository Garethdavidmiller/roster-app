---
name: leaver
description: Full ordered checklist for offboarding a staff member who is leaving. Invoke this skill when the user says somebody is leaving, has left, is a leaver, or asks to remove/disable a staff member.
---

# Leaver checklist

**Every individual step here is obvious; the sequence is not**, and two of them do damage in the
wrong order. Work down the list in order.

This is the executable list. **The reasoning lives in `docs/OPERATIONS_REFERENCE.md` →
"Removing a staff member"** — read it before deviating, and edit it rather than this file when
something changes. A second copy of an argument is how one of the two goes quietly wrong.

Ask for the **leaving date** first, and do not run steps 2–5 before it: a member disabled early
cannot open their own roster on their last week.

---

- [ ] **1 · Upload their final roster PDF** — Operations → Weekly Roster Upload, covering their last
      working days. **Before step 2**, because `hidden` also drops them from the parser's name lists
      and a later import then reports their row as `missingMembers` — the same advisory a genuine
      absence produces, so the week imports looking complete with nobody on their line.

- [ ] **2 · `hidden: true`** on their `teamMembers` entry in `roster-data.js`. Never delete the
      entry — there is no end-date field, `hidden` is what retirement looks like, and the record
      still has to resolve for their past shifts, overrides and any frozen Overtime week.

- [ ] **2b · If they held a ROLE, remove them from it too** — `CONFIG.ADMIN_NAMES`,
      `CONFIG.MANAGER_NAMES` or `CONFIG.LINKS_DESIGNERS` in `roster-data.js`. Those three lists are
      **not filtered by `hidden`**, and `setupRosterAuth` unions every role-holder into the set it
      processes precisely so a leaver sweep can never disable an admin by accident. A manager or
      designer left in one is therefore **immune to step 5**: they keep a working login, and the
      step-6 audit reports nothing, because as far as the server is concerned they are still active.
      This is the one failure in the sequence that no check catches — check the lists by hand.

- [ ] **3 · `npm run generate:roster-members`, in the SAME commit.** Bump the version, push, and
      **wait for the functions deploy to finish** — step 5 reads the *deployed*
      `roster-members.json`, and run before that it sweeps against the old list while reporting
      success.

- [ ] **4 · Overtime: every already-open week.** A window's participants are frozen when it opens,
      so this does not happen by itself. **Stop asking** beside their name, once per open week. A
      closed week refuses by design — that is a rule, not a fault.

- [ ] **5 · Disable the login.** Operations → Staff Login Accounts → tick *"Disable accounts for
      leavers"* → **Set up accounts** → read the dry-run preview → **Confirm**. Until this runs
      their account still works and their surname default is still a valid password for it.

- [ ] **6 · Verify — do not skip this.** The block above that button should read **"Everyone on the
      roster has a login, and no leaver still has one."** If the leaver is still enabled it names
      them in red, and the **Needs attention** strip at the top of the page carries a *"1 leaver can
      still sign in"* item until it is fixed. Every failure above this point is otherwise silent.
      If it says it **couldn't check**, that is neither answer — retry it, and do not read it as done.

---

## What this deliberately does NOT do

Their overrides, absences and AL **stay** (history has to keep resolving), their pay data was only
ever in `localStorage` on their own device, their `staffContact` work email stays unless they ask,
and the account is **disabled, never deleted**. Full reasoning: OPERATIONS_REFERENCE, same section.

## Returning staff

Reverse it — unset `hidden`, regenerate, deploy, then Set up accounts, which **re-enables** the
disabled account rather than creating a second one and re-applies their claim tier. A returning
secondment usually also wants `startDate` and `noProRate: true`; see `/new-starter`.
