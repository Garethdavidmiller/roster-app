# The real-Android release checklist

*Not version-stamped; not a runtime asset. The decision behind it: DECISIONS.md → "The 11 November
2026 external review: what was taken up, and what was not". Its twin for the other platform is
IPHONE_RELEASE_CHECKLIST.md.*

**Every line here is something no test in this repo can run.** That is the entry condition: if
Playwright, axe or a baseline could answer it, it belongs in CI and not on this page. The browser
lanes run Chrome's *engine* at a Pixel's size, with a coarse pointer, and `npm run test:signed-in`
runs it signed in against the real rules. That is worth having and is not a phone: it has no
install prompt, no standalone window, no system Back, no software keyboard, no notification shade,
no Samsung Internet and no system font size. Everything below lives in that gap.

**Android and iPhone are served equally** (CLAUDE.md → "Mobile is primary"), and the work phone is
Android with the install not yet permitted on it — so set-up A is the whole app for somebody on a
work phone today, and set-up B is where the work phone is heading. **Android is not the iPhone with
a Back button.** A tab has system Back and notifications here (`notif.js` asks for the install on
iOS only), and an installed app can print — so the two lists do not line up section for section.

**It is not a matrix.** Four set-ups, each carrying the checks only it can do:

| # | Set-up | Why this one |
|---|---|---|
| **A** | An Android phone, **Chrome tab** | the work phone's only route today — and on Android a tab has system Back and notifications |
| **B** | The same phone, **installed from Chrome** | its own window, the icon's shortcuts, the launch splash, and a notification that must land in the app rather than a tab |
| **C** | A Samsung phone in **Samsung Internet** | the same engine in a different browser: its own dark mode and its own install route |
| **D** | Any of them, with the phone's **font size and display size at their largest** | the axis the responsive suite approximates and cannot feel |

Work down the set-up's own section. A line with no tick is a line not done — this file is only worth
keeping if an unrun check looks different from a passed one.

---

## Before you start

- [ ] Do it on the **live site**, in a **fresh Incognito tab**, at both origins —
      `https://myb-roster.web.app` and `https://garethdavidmiller.github.io/roster-app/`.
      CLAUDE.md's "Deployment health check" says why: an installed app launches from its own cache
      **even when the live site is completely broken**, so "my phone works" is never evidence.
- [ ] Confirm the deployed version matches `main` (About panel → Version).

---

## A · Chrome tab — what a work phone gets today

- [ ] **Every page loads past the splash**: Calendar, Admin, Pay Calculator, Settings, Operations,
      Links, Trains, New link (a normal CEA contract, a manager, the admin, or a name in
      `CONFIG.NEWLINK_PREVIEW`) — and Overtime, which is paused and should show its paused note
      rather than a form.
- [ ] **A deep link works from a cold tab** — `/admin.html`, `/paycalc.html` — not just the root.
- [ ] **The Calendar PIN card** accepts the code and the roster appears. Then close Chrome entirely
      (swipe it away from Recents), reopen, and confirm it asks again.
- [ ] **Sign in as a member** and confirm the roster shows *that member's* shifts. After picking the
      name, the password field sits above the keyboard, not behind it.
- [ ] **Thumbs, not a mouse:** swipe the Calendar month and the Admin week from the middle of the
      screen. Each turns the page once, and neither is taken for Android's own Back gesture. A swipe
      in from the screen EDGE is Back, and does what Back does.
- [ ] **System Back closes what is open, one thing at a time.** The drawer, the day panel, the About
      panel, the Huddle viewer and a one-time notice (if one appears) each close on Back, and the
      page stays. Then open one and close it with its ✕ instead: the next Back leaves the page at
      once, rather than needing a second press.
- [ ] **Notifications.** Enable them in Settings → Notifications, then send one (the Huddle is the
      easiest). In the status bar the small icon is a plain white shape, not a coloured square
      (`.claude/rules/notifications.md` → "Icon, badge, tag"); the emoji leads the title; the tap
      opens the Huddle itself, not the app's front page.
- [ ] **Tap a notification with the page open, in the background, and with Chrome closed.** All
      three reach the Huddle: open or in the background, the tap reuses the window; closed, it has to
      open a new one, which is a separate path in the service worker. If nothing arrives while Chrome
      is closed, look at the phone's battery setting for Chrome before calling it a defect — some
      makes stop a closed app receiving anything.
- [ ] **The install strip** on the Calendar appears for a member signed in by name (never under the
      staff PIN — a PIN unlock is a station, not a person) and its button opens Chrome's own install
      dialog.
- [ ] **Unsaved Admin edits:** stage a change, then About → *View staff roster* — it asks first.
      Stage one again, press Back and return — the page offers to restore it.
- [ ] **Sign out, then Back.** Signed in, open Admin, go to the Calendar from the drawer and sign
      out there. Press Back: Admin asks who you are, with nobody's week behind the card. A real
      browser may bring a page back exactly as it was left, and no browser the tests drive will
      (README → `npm run test:signed-in`), so this is the only place that restore is seen.

## B · Installed from Chrome — the things a tab cannot have

Install from the strip, or from Chrome's ⋮ menu → *Install app* (some versions: *Add to Home
screen* → *Install*) — never *Create shortcut*, which opens an ordinary tab and makes every check
below a tab check. **Reinstall if the manifest changed this release**: a change to `name`,
`short_name`, `start_url` or the shortcuts may not reach an existing install until it is reinstalled
(`.claude/rules/pwa.md`), and an old copy would fail checks the release passes.

- [ ] **The launch splash** (Android 11 and earlier only — newer phones show the icon alone): the
      name reads "Marylebone Roster" in the phone's own font, with no odd characters.
- [ ] **It opens in its own window**, with no address bar.
- [ ] **Press and hold the icon:** Calendar, Pay and Admin are offered (`manifest.json` →
      `shortcuts`), and each opens its own page in the app's window.
- [ ] **Back, with nothing open on the Calendar, leaves the app on the first press** — after a
      notification tap and the Huddle closed too. On the Calendar nothing adds a step to the history
      but an open panel, so needing a second press means a step was left behind.
- [ ] **A notification tap opens the app, not a Chrome tab** — with the app open, in the background
      and closed. If you can, install from both addresses and check each: the notification's link is
      re-based onto the address the app was installed from (CLAUDE.md → Project identity), and a
      phone is the only place that shows it landing in the right window.
- [ ] **A guide's ⤓ PDF button opens Android's print dialog**, and *Save as PDF* carries the
      sections' text, not a list of headings. (`print-guard.js` stops only an installed iPhone,
      which cannot print; this is the check that an installed Android app can.)
- [ ] **Turn the network off and launch it.** It opens to the cached roster, not an error. Then back
      on, and confirm it updates within an open or two.
- [ ] **A release while the app is installed:** after a deploy, open it twice — About → Version shows
      the new number, with no "couldn't finish loading" and no reload in the middle of a task.

## C · Samsung Internet — the same engine, a different browser

- [ ] **Every page loads past the splash**, and sign-in and the PIN card work as in A.
- [ ] **Dark mode ON** in Samsung Internet's own settings (where it lives varies by version). Every
      page tells the browser it is light-only — `<meta name="color-scheme" content="only light">`,
      and the same in its CSS — which Chrome's own darkening honours. Confirm Samsung does: the
      shift badges, the day panel and the sign-in card keep their own colours. If Samsung repaints
      them anyway, write down which surfaces become hard to read — that is a finding, not a pass.
- [ ] **Install from Samsung Internet** (its menu → *Add page to* → *Home screen*, or the install
      icon in the address bar; the wording varies by version). It opens in its own window, and Back
      behaves as in A and B.

## D · Largest text — the axis a viewport cannot express

Settings → Display: font size and display size both at their largest (the names vary by make).

- [ ] **The keyboard does not cover the field being typed into**: the sign-in password, the Pay
      Calculator hours, the Links design name.
- [ ] **Nothing is clipped or overlapping** on the Admin week grid's day rows, the Calendar day panel
      and the Calendar month grid. These are the densest rows in the app.
- [ ] **The nav drawer's pills are still one per row**, and the footer (name, bell, Sign out) still
      fits.

---

## When something fails

Write down **the phone's make and model, the Android version, the browser and its version, and
whether it was a tab or the installed app** — those four are the whole reproduction, and a report
missing any of them usually cannot be acted on. Then check whether the repo can be made to see it
next time: a width, a text size or a signed-in journey usually can (`e2e/responsive.spec.js`, the
accessibility gate, `npm run test:signed-in`), a standalone-window or notification failure usually
cannot, and saying which is what stops the same check being re-proposed as automatable.

Where it is a known platform constraint rather than a defect, it is probably already written down —
**KNOWN_LIMITATIONS.md** for the constraints, **CLAUDE.md → "Mobile is primary"** for the standing
rule that *who runs what is an owner fact*, not something to infer from one device.
