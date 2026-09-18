# The real-iPhone release checklist

*Written v24.07, 18 September 2026 — ROADMAP "A real-iPhone release checklist".*

**Every line here is something no test in this repo can run.** That is the entry condition: if
Playwright, axe or a baseline could answer it, it belongs in CI and not on this page. `npm run
test:webkit` runs the smoke suite under Safari's *engine*, which is worth having and is not a phone
— it has no home screen, no standalone window, no software keyboard, no notch, no Intelligent
Tracking Prevention and no AirPrint. Everything below lives in that gap.

**It is not a matrix.** Four devices (ROADMAP's decision), each carrying the checks only it can do:

| # | Device | Why this one |
|---|---|---|
| **A** | An older **notch** iPhone (X–14), Safari tab | safe areas and the smallest viewport still in service |
| **B** | A **current** iPhone, Safari tab | the engine staff will actually meet next year |
| **C** | Either, **installed to the Home Screen** | standalone chrome, Web Push, no system Back — none of which exist in a tab |
| **D** | Either, **Settings → Display → Larger Text** at a high setting | the axis the responsive suite approximates and cannot feel |

Work down the device's own column. A line with no tick is a line not done — this file is only worth
keeping if an unrun check looks different from a passed one.

---

## Before you start

- [ ] Do it on the **live site**, in a **fresh private tab**, at both origins —
      `https://myb-roster.web.app` and `https://garethdavidmiller.github.io/roster-app/`.
      CLAUDE.md's "Deployment health check" says why: an installed PWA launches from its own cache
      **even when the live site is completely broken**, so "my phone works" is never evidence.
- [ ] Confirm the deployed version matches `main` (About panel → Version). Checking last week's
      release against this week's expectations is the commonest way this page wastes an hour.

---

## A · Older notch iPhone — safe areas and the small viewport

- [ ] **Nothing sits under the notch or the home indicator.** Calendar header, nav drawer footer,
      the paycalc sticky total bar (`#stickyTotal`, the one fixed element at the bottom edge), and
      any open lightbox's close button.
- [ ] **Rotate to landscape and back.** The Team View grid is the one that changes layout on
      orientation; the Calendar month grid is the one whose columns are fractional at these widths.
- [ ] **The last week of the Calendar month is reachable** at this viewport height. That was a real
      defect (v23.95) and the flex chain that caused it is height-sensitive.
- [ ] **A day panel opens and closes** from a tap, and the ✕ is reachable without stretching.

## B · Current iPhone — the engine staff meet next

- [ ] **Every page loads past the splash**: Calendar, Admin, Pay Calculator, Settings, Operations,
      Links, Overtime. A stuck splash is the exact failure the hourly currency check answers "yes"
      to, so it has to be looked at.
- [ ] **A deep link works from a cold tab** — `/admin.html`, `/paycalc.html` — not just the root.
- [ ] **The Calendar PIN card** accepts the code and the roster appears. Then close the browser
      entirely, reopen, and confirm it asks again — the PIN lasts only while the browser is open,
      and the card says so.
- [ ] **Sign in as a member**, then confirm the roster shows *that member's* shifts.

## C · Installed to the Home Screen — the things a tab cannot have

Install via Share → Add to Home Screen. **Reinstall if the manifest changed this release**:
`name`, `short_name`, `start_url` and the shortcuts only reach an existing install on reinstall.

- [ ] **The splash screen.** It draws `background_color`, the icon and `name` **in the device's own
      font** — Inter cannot reach it. Check it is short, ASCII and not falling back mid-string
      (v23.55 shipped an em dash here and it was reported as "a strange font").
- [ ] **There is no system Back.** So every overlay must close on its own ✕ or backdrop: the day
      panel, the About panel, the nav drawer, a one-time notice, the Huddle viewer. Open two at
      once and confirm closing the top one leaves the one beneath.
- [ ] **Notifications.** Enable from Settings → Notifications (Web Push exists **only** in an
      installed PWA on iOS). Then send one — the Huddle is the easiest — and check on the LOCK
      SCREEN: the badge is a monochrome silhouette and not a muddy blob, the emoji leads the title,
      and the tap lands on the right surface rather than the app root.
- [ ] **Tap a notification while the app is already open**, and while it is backgrounded. Both
      should reach the same place.
- [ ] **AirPrint a guide** (Share → Print). Safari fires **no `beforeprint`** for AirPrint, which is
      why the print preparation runs on the button's click instead — so the sheet must carry the
      country/section bodies, not a list of headings. Print one country from the FIP guide and
      confirm you get one sheet naming that country.
- [ ] **Turn the network off and launch it.** It must open to the cached roster, not an error.
      Then back on, and confirm it updates within an open or two.

## D · Larger Text — the axis a viewport cannot express

- [ ] **No field zooms on focus.** Any focusable input below 16px makes iOS zoom the page and it
      does not zoom back. Pay Calculator hours/minutes, the Overtime time fields, the Links search,
      the sign-in fields.
- [ ] **The software keyboard does not cover the field being typed into** — the same list.
- [ ] **Nothing is clipped or overlapping** on the Overtime form head, the Admin week grid's day
      rows, and the Calendar day panel. These are the three densest rows in the app.
- [ ] **The nav drawer's pills are still one per row** and the footer (name, bell, Sign out) still
      fits.

---

## When something fails

Write down **which device, which iOS version, and whether it was a tab or the installed app** —
those three are the whole reproduction, and a report missing any of them usually cannot be acted on.
Then check whether the repo can be made to see it next time: a width or a text scale usually can
(`e2e/responsive.spec.js`, the a11y gate), a standalone-chrome or ITP failure usually cannot, and
saying which is what stops the same check being re-proposed as automatable.

Where it is a known platform constraint rather than a defect, it is probably already written down —
**KNOWN_LIMITATIONS.md** for the constraints, **CLAUDE.md → "Mobile is primary"** for the iOS
hazards list and the standing rule that *who runs what is an owner fact*, not something to infer
from one device.
