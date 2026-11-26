# Owner's guide — running Marylebone Roster

*Written for the owner, in plain English. Not version-stamped; not a runtime asset. Every other document
in `docs/` is detail behind one of the sections here.*

This is the short version of what running the app involves: what to check, what to do when somebody says
something is wrong, and what has to happen on a date. Each section ends with where the full answer lives.

---

## After every release

A release is live once **Deploy Firebase Hosting** and the **mirror's deploy** have both finished in GitHub
Actions — not at the merge.

1. **Run the live check:** `npm run test:live`. It opens both addresses in a fresh browser and fails on a
   blank page, a console error or a missing sign-in card.
2. **Or check by hand, in a private window** (no saved copy of the app):
   - `https://myb-roster.web.app` loads past the splash to the calendar;
   - `https://garethdavidmiller.github.io/roster-app/` loads (note the `/roster-app/` part);
   - one other page opens directly, such as `/paycalc.html`.
3. **"My phone works" proves nothing.** An installed app opens from its own saved copy even when the live
   site is broken. Only a fresh browser shows the truth.

*Full detail:* `CLAUDE.md` → "Deployment health check"; `README.md` → "The test lanes".

---

## When a colleague says something is wrong

| They say | Look first at | Then |
|---|---|---|
| "I can't sign in" | Operations → **Reset requests** and **Account status** | Reset their password there. A lost or stolen phone: tick the lost-device box. `OPERATIONS_REFERENCE.md` → "Locked-out member → reset request queue" |
| "My shift / leave is wrong" | Their Calendar, then Admin → **Change a Shift** for that week | If a roster upload put it wrong: `RECOVERY_RUNBOOK.md` → playbook B. If a record was deleted: playbook A |
| "The Huddle isn't there" | Operations → the Daily Huddle card | The Power Automate flow: `OPERATIONS_REFERENCE.md` → "Huddle ingest — full detail", and its "Critical Power Automate gotchas" |
| "I get no notifications" | Their **Settings → Notifications** card | On an iPhone the app must be installed on the Home Screen. On the old GitHub Pages address they are not offered — send them to myb-roster.web.app |
| "My pay figure is wrong" | The Hours card on that payslip: is the badge **"⚠ Scheduled only"**? Are rest-day hours in the **Rest Day Working** box? Is it the right payslip? | Re-fill from the calendar on a good connection. Then compare against their real payslip's lines |
| "The app is blank / won't load" | The live check above | `RECOVERY_RUNBOOK.md` → playbooks G (Hosting) and H (switching staff to the mirror) |
| Something odd that nobody can explain | Operations → **Error Log** | Each entry names the page and what failed |

*Full detail:* `RECOVERY_RUNBOOK.md` → "Incident playbooks" (A to J).

---

## Every week

- **Upload the roster PDF** — Operations → Roster upload. Read the review before saving: rows that start
  unticked are the app asking you to look. `OPERATIONS_REFERENCE.md` → "Weekly Roster Upload — full detail".
- **The Daily Huddle arrives by itself** through Power Automate. Nothing to do unless it stops.
- **The Weekly Retail Circular and Marylebone Newsletter** are uploaded on Operations when they come out.

---

## Every month

- **On the 1st:** remove any app notice posted more than 180 days ago. Ask Claude to run `/new-notice`,
  which holds the list of live notices.
- **Glance at the Error Log** and the **App Speed** card on Operations.

---

## On a date — the diary

`docs/MAINTENANCE_CALENDAR.md` is the diary: every job with a deadline, each with an earlier
**warning date**. Put the warning dates in your own calendar. The ones that come round every year:

| When | Job |
|---|---|
| **February** (live by early March, when the new tax year's first payslip period starts) | The Pay Calculator's new tax year |
| **When an RMT pay award lands** | New rates and pension figures, from the real payslip |
| **Before 6 April** | Tax, National Insurance and student loan thresholds |
| **Each November** | Check gov.uk for any extra bank holiday |
| **Each spring and autumn** | Chiltern's new May and December timetable books for the Trains page |
| **Every 0.10 version** | Re-stamp the versioned documents (a test refuses the release until it is done) |

---

## When people change

Ask Claude to run the matching command; each is an ordered checklist.

| Change | Command | The step people get wrong |
|---|---|---|
| A new starter | `/new-starter` | Set up their account only after the roster change has deployed |
| Somebody leaves | `/leaver` | Upload their **final roster PDF first** — once they are hidden, the import no longer knows their name |
| A change of grade | — | `OPERATIONS_REFERENCE.md` → "A member changes grade" |
| A change of name on the roster | — | `OPERATIONS_REFERENCE.md` → "Changing a member's roster name" |
| A login for somebody not on the roster | — | `OPERATIONS_REFERENCE.md` → "Adding an Other Staff login" |
| A question about somebody's leave against the clerks' sheet | `/al-workbook` | Read the sheet's own rules first; some real leave never shows in the calendar grid |

---

## Things only you can do

These need your Google, Firebase or GitHub account, so Claude cannot do them for you.

- **Adding a web address the app is served from:** add it to the Firebase API key's allowed websites
  (Google Cloud → APIs & Services → Credentials) **and** to the app's own list in the same change.
  Missing it breaks every sign-in with no clear error. `CLAUDE.md` → "Project identity".
- **Secrets** (the Huddle password, the Anthropic key, the notification key) live in Firebase Secret
  Manager. Never paste one into a chat or a file.
- **Closing the GitHub Pages address** once enough staff have moved — the move notice runs to
  31 December 2026. `OPERATIONS_REFERENCE.md` → "The Pages mirror — behind the Hosting gate".
- **Backups and the restore drill:** `RECOVERY_RUNBOOK.md` → "Before you need it — set these up now".
- **Deleting the retired staff PIN secret:** `OPERATIONS_REFERENCE.md` → "The staff PIN (retired)".

---

## Where everything else lives

| You want | Open |
|---|---|
| What a file is | `docs/FILE_INDEX.md` |
| Why something is the way it is | `docs/DECISIONS.md`, or the file's own opening comment |
| What is still limited or deferred | `docs/KNOWN_LIMITATIONS.md` |
| What might come next | `docs/ROADMAP.md` |
| How operations work in detail | `docs/OPERATIONS_REFERENCE.md` |
| When things go badly wrong | `docs/RECOVERY_RUNBOOK.md` |
| The rules Claude follows | `CLAUDE.md`, and `.claude/rules/` for each part of the app |
