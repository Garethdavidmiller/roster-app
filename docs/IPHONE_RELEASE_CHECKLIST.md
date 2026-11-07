# The real-iPhone release checklist

*Not version-stamped; not a runtime asset. The decision behind it: ROADMAP_HISTORY → "The v23.01 external review", its row "A real-iPhone release
checklist".*

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
- [ ] **The last week of the Calendar month is reachable** at this viewport height — a general
      reachability check on a phone.
- [ ] **A day panel opens and closes** from a tap, and the ✕ is reachable without stretching.
- [ ] **Landscape, the tall panels:** the day panel on a busy day and the annual-leave panel for a
      member with Christmas leave keep their ✕ and their bottom row on screen, and scroll.

## B · Current iPhone — the engine staff meet next

- [ ] **Every page loads past the splash**: Calendar, Admin, Pay Calculator, Settings, Operations,
      Links, Trains, New link (the admin, or a name in `CONFIG.NEWLINK_PREVIEW`) — and Overtime,
      which is paused and should show its paused note rather than a form
      (`OVERTIME_AVAILABILITY.md` → Paused). A stuck splash is the exact failure the hourly currency
      check answers "yes" to, so it has to be looked at.
- [ ] **A deep link works from a cold tab** — `/admin.html`, `/paycalc.html` — not just the root.
- [ ] **The Calendar PIN card** accepts the code and the roster appears. Then close the browser
      entirely, reopen, and confirm it asks again — the PIN lasts only while the browser is open,
      and the card says so.
- [ ] **Sign in as a member**, then confirm the roster shows *that member's* shifts. After picking the
      name, the keyboard comes up on the password field without a second tap.
- [ ] **Follow the install wording literally** in Safari's default layout (on iOS 26 and later,
      Share is behind •••), then again from a link opened in Outlook, Teams or WhatsApp — both
      routes say what to do.
- [ ] **The keyboard and search:** in the drawer, type "fip coupon " (with the space) in *Search the
      guides*; on the sign-in card, type four letters of a surname in the name picker's search; on
      Trains, type "haddenham " in the station box. Results stay visible above the keyboard and
      nothing is autocorrected. In the drawer and the picker the keyboard's Search key puts the
      keyboard away; on Trains its Go key opens the first match.
- [ ] **The keyboard's ‹ › arrows** inside an open dialog (a Links name prompt, the picker's search
      over the sign-in card) keep focus inside the dialog. The DRAWER is not guarded yet — its own
      trap catches Tab only — so note what the arrows do from its search box rather than failing it.
- [ ] **Pay Calculator, no zoom:** Unusual deductions → *Any other payslip adjustment* — tapping the
      box does not zoom the page.
- [ ] **Pay Calculator, keypad up:** focus the Rest Day Working hours (portrait and landscape). The
      take-home £ stays visible, the box is clear of the blue bar, and the bar and peer ± act on the
      FIRST tap.
- [ ] **Pay Calculator, Download backup:** the share sheet opens; *Save to Files* saves it and the
      status says so; cancelling says nothing was saved.
- [ ] **Unsaved Admin edits:** stage a change, then About → *View staff roster* — it asks first. Stage
      one again, swipe back from the left edge and return — the page offers to restore it.
- [ ] **Press and hold the header logo:** no image menu appears.

## C · Installed to the Home Screen — the things a tab cannot have

Install via Share → Add to Home Screen. **Reinstall if the manifest changed this release**:
`name`, `short_name`, `start_url` and the shortcuts only reach an existing install on reinstall.

- [ ] **Not an iPhone check: the launch splash that draws `name` in the device's own font.** That is
      Chrome's splash on Android before 12 (`.claude/rules/pwa.md` → `manifest.json` `name` — keep it short and
      ASCII) — check it on an Android phone.
- [ ] **There is no system Back.** So every overlay must close on its own ✕ or backdrop: the day
      panel, the About panel, the nav drawer, a one-time notice, the Huddle viewer. Open two at
      once and confirm closing the top one leaves the one beneath.
- [ ] **Notifications.** Enable from Settings → Notifications (Web Push exists **only** in an
      installed PWA on iOS). Then send one — the Huddle is the easiest — and check on the LOCK
      SCREEN: the emoji leads the title, and the tap lands on the right surface rather than the app
      root. (The monochrome badge is drawn by Android's status bar, not iOS — check it there.)
- [ ] **Tap a notification while the app is already open**, and while it is backgrounded. Both
      should reach the same place.
- [ ] **A guide's ⤓ PDF button explains, and offers "Open in Safari"** — an installed iOS app cannot
      print (`print-guard.js`), so the button must say so rather than do nothing.
- [ ] **In a Safari tab (A or B), AirPrint a guide from the guide's own ⤓ PDF button** (not Share →
      Print — Safari fires **no `beforeprint`** for AirPrint, so only the button's click prepares the
      page). The sheet must carry the country/section bodies, not a list of headings. Then print one
      country with its `⤓ Print <country>` button and confirm you get one sheet naming that country.
- [ ] **Turn the network off and launch it.** It must open to the cached roster, not an error.
      Then back on, and confirm it updates within an open or two.
- [ ] **What the Home Screen app does NOT bring from Safari** (KNOWN_LIMITATIONS → "iPhones keep two
      separate copies…"): enter a pay figure in a Safari tab, install, open the icon. It should open
      signed out with an empty Pay Calculator, as the install wording warned. Then move the figures —
      Safari: 💾 Move Your Pay Data → Copy as text; app: paste → Replace — and confirm they are back.
- [ ] **Add to Home Screen from `staff-guide.html`:** the icon is named like the app and opens the
      roster, not the guide.
- [ ] **A changed password and iCloud Keychain:** change it in Settings with *Use Strong Password*,
      sign out, sign in from the Keychain suggestion — it offers the NEW password under the member's
      name.
- [ ] **An update while the app is away:** let a release land with the app in the background, return
      after 30 seconds — no unexpected reload and no "couldn't finish loading".
- [ ] **Unsaved Links edits:** paint a few cells, swipe the app away and reopen it — the page offers
      to restore them. (Back from another app with the page still alive, the edits are simply still
      there: the offer is for a page that was reloaded or discarded.)
- [ ] **Admin left open for a day:** return to it — the week shows what was booked elsewhere in the
      meantime.
- [ ] **Durable storage (Web Inspector):** after a Pay Calculator save, `await
      navigator.storage.persisted()` — record the answer for a tab and for the installed app.

## D · Larger Text — the axis a viewport cannot express

- [ ] **No field zooms on focus.** Any focusable input below 16px makes iOS zoom the page and it
      does not zoom back. Pay Calculator hours/minutes, the Overtime time fields (once Overtime is back), the Links design-name and import fields,
      the sign-in fields.
- [ ] **The software keyboard does not cover the field being typed into** — the same list.
- [ ] **Nothing is clipped or overlapping** on the Overtime form head (once Overtime is back), the Admin week grid's day
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
