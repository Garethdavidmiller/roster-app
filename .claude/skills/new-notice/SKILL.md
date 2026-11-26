---
name: new-notice
description: Full guide for adding a one-time notice lightbox to any app page. Invoke this skill when the user asks to add a notice, alert, or announcement lightbox.
---

# One-time notice pattern

Notices are `.lb-overlay` lightboxes shown periodically or once to staff on a specific page. They are built with `createLightbox()` and call `archiveNotice()` so the notice appears in the nav panel "📣 App Notices" record. **Every notice must follow this pattern exactly** — do not invent new CSS classes or deviate from the element order.

## HTML template

Add the notice lightbox in the page's HTML, grouped with the other `.lb-overlay` divs:

```html
<div id="[Name]NoticeLb" class="lb-overlay" role="dialog" aria-label="[Title]" aria-modal="true">
    <div id="[Name]NoticeContent" class="lb-content notice-lb-content">
        <button id="[Name]NoticeClose" class="lb-close" type="button" aria-label="Close">✕</button>
        <div class="notice-head">
            <div class="notice-badge notice-badge--[page]">[Emoji] [Section]</div>
            <div class="lightbox-app-name">[Title]</div>
            <div class="notice-date">Posted [D Month YYYY]</div>
        </div>
        <div class="notice-main">
            <p class="notice-body">[Body text. Use <strong> for emphasis.]</p>
        </div>
        <!-- OPTIONAL — only when the notice drives a page visit: -->
        <div class="notice-actions">
            <a href="[url]" id="[Name]NoticeGo" class="notice-cta">[CTA label] →</a>
            <button id="[Name]NoticeLater" class="notice-later" type="button">Not now</button>
        </div>
    </div>
</div>
```

**THE THREE ZONES ARE THE STRUCTURE.** The card carries no padding and no gap of its own; each zone
owns its spacing, which is what separates the header from the prose and the prose from the buttons (as
flat siblings, the card read as unstyled text on a dimmed page). **Do not put a child directly in
`.notice-lb-content`**: it will sit hard against the card's edge with no padding at all, because
there is none to inherit. `.notice-actions` is omitted entirely on a notice with no buttons; so is
`.notice-date` on one that is not dated.

**Element order is mandatory:**
1. `.lb-close` ✕ button — always first, absolutely positioned, does not affect flex flow
2. `.notice-head` — the masthead block. Its 28px top padding clears the ✕'s 44px touch target; do not reduce it, or the title lands under the button.
   - `.notice-badge notice-badge--[page]` — section pill coloured to match the page's nav pill (see table below). Do not use `.lightbox-badge` on notices.
   - `.lightbox-app-name` — notice title (white, scoped smaller than the About lightbox title by `.notice-lb-content .lightbox-app-name` in `shared.css`; `text-wrap: balance` handles a wrap)
   - `.notice-date` — `Posted D Month YYYY`, the month IN FULL — **hardcoded** to the date the notice was published. OPTIONAL. The JS `NOTICE_DATE` stays `D Mon YYYY` (below): it is the expiry key.
3. `.notice-main` — one or more `.notice-body` paragraphs (soft white, left-aligned: centred text works against the reader over the 3–5 lines a notice body runs to). The whole card, header included, is left-aligned.
4. `.notice-actions` — OPTIONAL, and only when there is something to press:
   - `.notice-cta` — gold action `<a>` — only if the notice links to another page
   - `.notice-later` — muted dismiss `<button>` — only when `.notice-cta` is present
   - two `.btn-action` buttons instead, where the notice asks a question rather than pointing somewhere (the pay-data ownership prompt)

**No per-notice CSS.** All visual needs are met by the shared classes above (defined in `shared.css`).

## Section badge values

| Section | Badge text | CSS modifier |
|---------|-----------|-------------|
| Pay calculator | `💷 Pay` | `notice-badge--pay` (green) |
| Links workspace | `🔗 Links` | `notice-badge--links` (purple) |
| Settings page | `⚙️ Settings` | `notice-badge--settings` (indigo) |
| Operations page | `🔧 Ops` | `notice-badge--ops` (orange) — short, like the page badge: a notice lightbox is a narrow box on a phone, so the section pill wants the abbreviation. The nav-drawer pill spells it in full, because a drawer row has the width. |
| Calendar page | `📅 Calendar` | `notice-badge--calendar` (gold) |
| Trains page | `🚆 Trains` | `notice-badge--trains` (raspberry, white type — the Trains pill's colour) |
| New link page | `🔁 New link` | `notice-badge--newlink` (teal `--al`, white type — the New link pill's colour) |
| General / no specific page | `📣 General` | (no modifier — neutral white tint) |

## JS pattern — close-only notice (no CTA)

The user reads the notice and closes it. `archiveNotice()` fires in `onClose` because there is only one dismissal path.

```javascript
(function () {
    const NOTICE_ID   = '[id]';          // e.g. 'ytd_2627'
    const NOTICE_DATE = '[D Mon YYYY]';  // matches the HTML .notice-date — hardcoded
    const NOTICE_KEY  = 'myb_notice_[id]_done';

    const overlay = document.getElementById('[Name]NoticeLb');
    if (!overlay || lsGet(NOTICE_KEY)) return;
    // Silently dismiss on a new device if the notice is past its expiry window.
    // Use isNoticeExpired(NOTICE_DATE) for 28-day (short) or isNoticeExpired(NOTICE_DATE, 90) for 90-day (long).
    if (isNoticeExpired(NOTICE_DATE)) { lsSet(NOTICE_KEY, '1'); return; }

    const lb = createLightbox({
        overlay,
        content:  document.getElementById('[Name]NoticeContent'),
        closeBtn: document.getElementById('[Name]NoticeClose'),
        onClose() {
            archiveNotice({
                id: NOTICE_ID, title: '[Title]', section: '[Section]',
                date: NOTICE_DATE,
                body: '[One-sentence summary for the App Notices archive.]',
            });
            lsSet(NOTICE_KEY, '1');
        },
    });

    // openNoticeIfClear, NEVER lb.open() — a notice must not appear stacked with another overlay:
    // two open notices share one Escape, which would flag the buried one seen by someone who never
    // saw it. Deferring leaves it unopened AND unflagged, so it gets its turn on the next load.
    // Import from './overlay.js'.
    openNoticeIfClear(lb);   // or conditionally, e.g.: if (lsGet(PREV_KEY) && !lsGet(NOTICE_KEY)) openNoticeIfClear(lb);
}());
```

## JS pattern — actionable notice (has CTA + "Not now")

> **What the live notices actually do: every `index.html` notice is a ONE-OFF** (owner, 10 Sep 2026):
> every dismissal — the ×, the backdrop, Escape,
> "Not now" and the link — sets the DONE key, and no notice declares a snooze key
> (`calendar-notices.js`). Use the snooze below only for a notice the owner has asked to come back.
> **And on `index.html`, drop the `getSession()` line:** a member who signs in at the Calendar's front
> door has no session yet when notices are wired, so it would skip them on that load —
> `_openWhenAudienceAllows` is the gate there (see Audience, below).

The user may navigate away before closing. `archiveNotice()` fires in `onOpen` to guarantee the record is written regardless of which path the user takes. A snooze mechanism prevents re-showing before the user has had time to act.

```javascript
(function () {
    const NOTICE_ID   = '[id]';
    const NOTICE_DATE = '[D Mon YYYY]';
    const DONE_KEY    = 'myb_notice_[id]_done';
    const SNOOZE_KEY  = 'myb_notice_[id]_snooze';

    if (!getSession()) return;          // show only to signed-in users — import getSession from './session.js' at the top of the module if not already imported
    if (lsGet(DONE_KEY)) return;        // permanently dismissed (action completed elsewhere)
    const snooze = lsGet(SNOOZE_KEY);
    if (snooze && Date.now() < new Date(snooze).getTime()) return;
    // Silently dismiss on a new device if the notice is past its expiry window.
    // Use isNoticeExpired(NOTICE_DATE) for 28-day (short) or isNoticeExpired(NOTICE_DATE, 90) for 90-day (long).
    if (isNoticeExpired(NOTICE_DATE)) { lsSet(DONE_KEY, '1'); return; }

    const overlay  = document.getElementById('[Name]NoticeLb');
    const goLink   = document.getElementById('[Name]NoticeGo');
    const laterBtn = document.getElementById('[Name]NoticeLater');
    if (!overlay) return;

    function _snooze(days) {
        lsSet(SNOOZE_KEY, new Date(Date.now() + days * 86_400_000).toISOString());
    }

    const lb = createLightbox({
        overlay,
        content:  document.getElementById('[Name]NoticeContent'),
        closeBtn: document.getElementById('[Name]NoticeClose'),
        onOpen() {
            // Archive on open — user may navigate away before close fires.
            // archiveNotice is idempotent; safe to call on every show.
            archiveNotice({
                id: NOTICE_ID, title: '[Title]', section: '[Section]',
                date: NOTICE_DATE,
                body: '[One-sentence summary for the App Notices archive.]',
            });
        },
        onClose() { _snooze(7); },
    });

    // Acted — shorter snooze. The link REPLACES the notice's history entry with its page (`followLinkOutOf`,
    // overlay.js — import it): a plain link stacks the page on the notice's entry, and one Back from it lands
    // on a step nothing answers. On index.html use calendar-notices.js's
    // `_wireNoticeLink('[Name]NoticeGo', lb, markDone)` instead — calendar-notices.test.mjs block 13 requires it.
    goLink?.addEventListener('click', (e) => { _snooze(1); followLinkOutOf(lb, e); });
    laterBtn?.addEventListener('click', () => lb.close());

    // Guard: skip if another overlay (e.g. Huddle viewer) opened in the 1500ms window.
    // openNoticeIfClear IS that guard, shared with the close-only pattern above.
    setTimeout(() => openNoticeIfClear(lb), 1500);
}());
```

**Target-page permanent dismiss:** On the page the CTA links to, call `lsSet('myb_notice_[id]_done', '1')` when the user completes the action (e.g. after saving their email, after submitting the form). Without this, the notice re-shows after the 1-day snooze indefinitely — `DONE_KEY` is never set by the notice IIFE itself.

## Audience — every notice is for members

Notices on **`index.html`** live in `calendar-notices.js` and open only for a **signed-in member**:
Calendar access being granted says nothing about **whose** it is, and a notice may ask the reader
about their own data.

**The staff PIN is retired** (23 Nov 2026), so nobody reads the Calendar signed out, and the
`'signed-out'` and `'everyone'` audiences went with it. Every notice is `'members'`; do not bring the
others back. A refused notice is left
**unflagged** — not marked seen — so it arrives when that device is next signed in (a leftover PIN
session is signed out on its next load, so it never sees one).

Notices on other pages need no audience either: those pages already require a session.

## Waiting for another notice, or for a reader known only at open time

Each of these exists in `calendar-notices.js`, and the next notice reuses it as it is:

- **After another notice:** declare `const FOLLOWS = '<that notice's DONE_KEY>'` in the IIFE and
  `if (!followedDone(FOLLOWS)) return;` after the expiry check — never a bare `lsGet(FOLLOWS)`. It is
  read at WIRING time, so the notice never comes on the load where the other one is dismissed.
  `calendar-notices.test.mjs` pins `FOLLOWS` equal to the other IIFE's `DONE_KEY` and gives
  followers matrix rows of their own.
- **And record the followed notice's END in `FOLLOWED_ENDS`**: its done key → the
  `[day, days]` its own `isNoticeExpired` call takes. `followedDone` passes once the flag is set OR
  that end has passed, because only the followed notice's own IIFE sets the flag, and the monthly
  cleanup deletes that IIFE: a bare flag check would leave every device that never answered it
  waiting for ever. **When you retire a notice, keep its `FOLLOWED_ENDS` entry while anything
  follows it**; block 12 of the test fails on a followed key with no end, or an end that differs from
  the live notice's own.
- **For a reader known only once access is decided** (e.g. "would the Pay Calculator price this
  member?"): pass a third argument, `_openWhenAudienceAllows(lb, 'members', () => …)`. It is read
  after the audience check, at open time, because a front-door sign-in has no session at wiring
  time. A refusal leaves the notice unflagged, exactly like an out-of-audience device.
- **Ending on a date rather than after N days:** `isNoticeExpired('<last day>', 1)` offers the whole
  of that day and stops at the next midnight. A count from posting drifts by an hour across a clock
  change.

- **After a notice only some members get:** `const FOLLOWS_PAY = '<its DONE_KEY>'`, read at wiring
  time beside `FOLLOWS` (through `followedDone`, with its end in `FOLLOWED_ENDS`), and `alsoWhen` accepts it OR the member not being that notice's reader
  (`payCalcIsTheirs`, now module-level). Waiting on a flag a member can never set would hold the
  notice back until that one expires. The test matrix reads `FOLLOWS_PAY` like `FOLLOWS`.
- **Copy that depends on the device:** put every variant in the markup, `hidden`, and choose in
  `onOpen` — not at the gate, if what decides it can change in the 1500ms between them. A test
  pins every variant line in the markup to the module that toggles it.
- **When it makes the same ask as something already on the page:** a fourth argument,
  `whenDecided`, runs the moment the notice is decided — the install notice stands the install strip
  down then, rather than covering it 1500ms later.

- **After the install notice, only where that one is this DEVICE's:** `const FOLLOWS_INSTALL =
  '<its DONE_KEY>'`, read at wiring time through `followedDone`, and `alsoWhen` accepts it OR `!installRoute()` — a desktop
  or the installed app never gets the install notice, so waiting on its flag there reaches nobody at
  a desk. The test matrix reads `FOLLOWS_INSTALL` like `FOLLOWS_PAY`.
- **A notice about a page goes only where the page would let them in — ask the page's OWN question**
  (`canOpenNewlink`, the drawer pill's), at open time through `alsoWhen`. Never a list of the
  notice's own: two lists of who a page is for drift. Block 11 drives it for every name on the roster.
- **A section with two words** (`'New link'`) is a QUOTED key in `SECTION_MODS` (nav-destinations.js),
  with an `--on-navy-*` colour beside the others; block 10 imports the map and finds every file that
  archives a notice by searching the tree, so a new page's first notice is checked by existing.
- **Wire it last if it should give way.** On a load where two are due, the first to ask for the
  screen takes it; a notice placed last in `calendar-notices.js` comes back next load instead.

## Rules

| Rule | Value |
|------|-------|
| Audience (index.html) | `'members'` — the only audience since the staff PIN was retired (see above) |
| `archiveNotice()` timing | `onClose` for close-only notices · `onOpen` for notices with a navigation CTA |
| Snooze on close (×, backdrop, Escape, "Not now") | 7 days — snooze pattern only; the live notices are one-offs |
| Snooze on CTA navigation | 1 day — snooze pattern only |
| Permanent dismiss key | `myb_notice_[id]_done` — set when the user completes the action (e.g. in the target page) |
| Snooze key | `myb_notice_[id]_snooze` — ISO date string |
| Notice ID naming | `[section]-[year]` or `[topic]_[tax-year]` — e.g. `links-beta-2026`, `ytd_2627` |
| Posting date format | In JS — `NOTICE_DATE` and the `archiveNotice()` call — `D Mon YYYY`, e.g. `22 Jun 2026`: it is the EXPIRY KEY, and `isNoticeExpired` reads only that form (a month in full never expires). On screen the month is in full: the HTML `.notice-date` is hand-written `Posted 22 June 2026`, and App Notices converts the stored date as it draws (`noticeDateInFull`, notice-archive.js). Never use `new Date()` |
| A day count crosses the clocks | `isNoticeExpired` counts days from the posting day's LOCAL midnight in milliseconds, so a run across the October clock change ends at **23:00 the day before** (90 days from 22 Oct ends at 23:00 on 19 Jan). Write the Expiry column that way, and use a last DAY with `isNoticeExpired(day, 1)` where the hour matters |
| Words in App Notices | The record is listed for 180 days — longer than most runs — so its words must stay TRUE after the run ends: "runs from Sunday 13 December", never "starts on Sunday"; never "nothing is decided yet". A record already archived is corrected with `reviseArchivedNotice` (calendar-notices.js does it on every load) |
| Storage that keeps nothing | No notice is wired where `lsAvailable()` (ls.js) is false: the flag would never stick, and a one-time notice would open on every load |
| Expiry on new device — short (28 days) | Default. Use for time-bound prompts that lose urgency quickly: feature launches, one-off nudges (e.g. beta notice). `if (isNoticeExpired(NOTICE_DATE)) { lsSet(DONE_KEY, '1'); return; }` — placed after the done/snooze checks. Import `isNoticeExpired` (and `archiveNotice`) from `notice-archive.js`. |
| Expiry on new device — long (90 days) | Use for tax-year or seasonal notices that stay relevant for months: YTD entry reminders, pay rate change notices. `if (isNoticeExpired(NOTICE_DATE, 90)) { lsSet(DONE_KEY, '1'); return; }` — same placement as short. |
| Archive expiry | `archiveNotice()` prunes entries whose `archivedAt` timestamp is older than **180 days** on every write. It lives in `localStorage`, so it is per-device and does **not** sync; an entry without `archivedAt` is stamped with the current time, not dropped. |
| Show delay | 1500ms when notice competes with page render; 0 when it is the first thing shown |
| Opening it | **Always `openNoticeIfClear(lb)`, never `lb.open()`** — a notice must never open stacked with another overlay. Not opening leaves it unflagged, so it returns next load. |

## After adding the notice

Add a row to the "Current notices" table below:

| ID | Page | Title | Badge | Posted | Expiry | Status | Dismiss mechanism |
|----|------|-------|-------|--------|--------|--------|-------------------|
| `[id]` | `[page].html` | [Title] | [Badge] | [D Mon YYYY] | [28/90] days | ✅ live until [date] | One-time; `[DONE_KEY]` set on close |

For an `index.html` notice there is nothing to declare: every notice is for members (Audience, above).

## Current notices

Keep this table current. `CLAUDE.md` keeps the rules that apply to every notice (the audience,
`openNoticeIfClear`, the monthly cleanup) and points here for the rest.

> **The Status column is load-bearing — keep it accurate.** A notice goes INERT the moment
> `isNoticeExpired` fires: it is marked seen *without being shown*, while the removal rule only fires
> at 180 days — so a row can read as live while nobody has seen it for weeks. Say so in the column.

| ID | Page | Title | Badge | Posted | Expiry | Status | Dismiss mechanism |
|----|------|-------|-------|--------|--------|--------|-------------------|
| `ytd_2627` | `paycalc.html` | Enter your Year to Date figures | 💷 Pay | **RE-POSTED 28 Aug 2026** (first run 6 Apr) | 90 days | ✅ live until 23:00 on 25 Nov 2026 (90 days across the clock change) — run 2, on a NEW key (`myb_pc_ytd_notice_2_shown`); it opens LAST on the page. **Then it simply expires (owner, 13 Nov 2026)** — no re-post, no replacement (Lessons, below) | One-time; `NOTICE_YTD_KEY` set on close |
| `hpp_2526` | `paycalc.html` | Estimate your January Holiday Pay Premium | 💷 Pay | 16 Nov 2026 | ends 8 Jan 2027 (`LAST_DAY` — the eve of the January payslip's cut-off) | ✅ live 16 Nov 2026 – 8 Jan 2027 — SECOND on the page: the load after `ytd_2627` (`NOTICE_YTD_KEY`, read as it is wired) — or that notice's END, so it never waits on code that has been deleted — through the one opener `showPayNotice`. Only for a member with a 2025/26 payslip and no figure of their own for that year's premium (`premiumStillToEstimate`, paycalc-hpp.js); a 'none' or 'done' keeps it shut UNFLAGGED — the flag is the device's, so the next member signed in on that phone still gets it. Never over a card a link opened (any `#…`). A START date (`STARTS`). Its link opens the 13 Mar 2026 payslip at `#payslipCard` | One-time; `NOTICE_HPP_KEY` (`myb_pc_hpp_notice_2526_shown`) set on any answer, its link included; archived as it opens |
| `links-workspace-2026` | `links.html` | Links Workspace | 🔗 Links | 2 Aug 2026 | **none** | ✅ permanent ORIENTATION, reopened from the About panel (`#linksHowBtn`). **Not a candidate for the 180-day removal** — it is no longer a notice (Lessons, below) | One-time on first visit; `myb_links_welcome_seen` set on close. The button ignores the flag |
| `install-app-2026` | `index.html` | Put the roster on your home screen | 📣 General | 22 Oct 2026 | 90 days (to 23:00 on 19 Jan 2027) | ✅ live — `'members'`, on a phone or tablet in a browser only (`installRoute`, install-prompt.js). It followed the two October notices (below), retired since; their ends stay in `FOLLOWED_ENDS`, so it waits for neither. On the Pages mirror it sends staff to myb-roster.web.app, never installing there. Answering it retires the install strip | One-time; `myb_notice_install_app_2026_done` set on any dismissal, its button and link included |
| `timetable-soon-2026` | `index.html` | The new timetable starts on Sunday 13 December (App Notices keeps "The new timetable from Sunday 13 December") | 🚆 Trains | 16 Nov 2026 (brought forward from 6 Dec, owner, 16 Nov 2026) | ends 12 Dec 2026 | ✅ live 16 Nov – 12 Dec — `'members'`. Until 6 Dec it comes after the install notice where that one is the device's (`FOLLOWS_INSTALL`) and the New link notice where that one is the member's (`FOLLOWS_NEWLINK` — the vote notice's key since 26 Nov, `canOpenNewlink`); from Sunday 6 Dec (`FINAL_WEEK`) it waits for nobody and goes FIRST, wired before the install notice. A START date (`STARTS`): an early device is left unflagged. A push goes out on the Saturday evening too | One-time; `myb_notice_timetable_soon_2026_done` set on any dismissal, its link included |
| `newlink-vote-2026` | `index.html` | Voting on the new link starts soon (App Notices keeps "Before the vote on the new link") | 🔁 New link | 26 Nov 2026 | ends 5 Dec 2026 (`LAST_DAY`) | ✅ live 26 Nov – 5 Dec — `'members'`, only where the New link page would let them in (`canOpenNewlink`, asked at open time); after the install notice where that one is the device's (`FOLLOWS_INSTALL`); wired LAST. It REPLACED `newlink-2026` (9 Nov) on the owner's word, on a NEW key, so a member who closed that one still gets this. Says a vote decides, and nothing about how it is run (not settled, owner 26 Nov 2026). The timetable notice waits for it until 6 Dec | One-time; `myb_notice_newlink_vote_2026_done` set on any dismissal, its link included |
| `move-to-main-2026` | `index.html` | Move to the app’s main address | 📣 General | 26 Nov 2026 | ends 31 Dec 2026 (`LAST_DAY`) | ✅ live 26 Nov – 31 Dec — `'members'`, ONLY on the GitHub Pages mirror (`onPagesMirror`, re-exported by install-prompt.js), on every device there: desk, phone browser and installed app. After the timetable notice (`FOLLOWS`, its end in `FOLLOWED_ENDS`) and the install notice where that one is the device's (`FOLLOWS_INSTALL`). Says to reinstall from myb-roster.web.app, turn notifications on there and OFF on the mirror (or each one arrives twice — owner, 26 Nov 2026; re-measured: 507px at 360x740 and 375x667, Chromium), and move Pay figures with 💾 Move Your Pay Data. **The stragglers get a re-post on a NEW key** (owner, 26 Nov 2026: "encourage a few more, then mop up the stragglers so I can close the GitHub Pages version") | One-time; `myb_notice_move_to_main_2026_done` set on any dismissal, its link included |

Retired or replaced, and what still refers to them: `newlink-2026` (replaced by `newlink-vote-2026`,
owner, 26 Nov 2026) — its archived record is still corrected on every load, and nothing follows its
key. `timetable-2026` and `ytd-figures-2026` (the October pair, ended 31 Oct 2026, `OCTOBER_LAST_DAY`)
— their code is gone, but both `FOLLOWED_ENDS` entries stay while `install-app-2026` follows them.
With them went the axe scan of the green `notice-badge--pay` badge on the Calendar's glass (no live
Calendar notice carries it); the Trains badge's scan and the audience proof in the Calendar's access
spec run on `timetable-soon-2026`'s final week. The rest is git history.

## Lessons from past notices

Each lesson cost something once; the stories are in git.

### A notice brought back needs a NEW storage key

Re-dating alone reaches nobody: the expiry branch flags a device silently, so everyone who arrived
after the first run's window is already marked "shown" for a notice they never saw — and reusing a
replaced notice's key hides the replacement from everyone who closed the original. Retire the old
key; do not delete it. (`ytd_2627` run 2, `myb_pc_ytd_notice_2_shown`; `links-beta-2026` →
`myb_links_welcome_seen`.) A notice brought back also decides where it opens in the page's queue —
`ytd_2627` run 2 opens LAST, behind the data-ownership prompt and the forced set-password overlay.

### Expiring is right for an announcement, and may be wrong for a seasonal prompt

A notice goes INERT the moment `isNoticeExpired` fires, while the removal rule waits 180 days — which
is why the Status column must say so. An inert seasonal prompt means a **new starter or a new device
later in the season gets no prompt at all**. Decide that rather than inherit it: a seasonal prompt
wants to key off the member's own data, which is not the one-time notice pattern. (`ytd_2627`
expires, owner, 13 Nov 2026: the Year to Date line under the take-home figure is that seasonal
prompt now.)

### Orientation is not an announcement

What a FIRST-TIME user needs must not expire, or from the expiry date every newcomer is flagged seen
and shown nothing. `links-workspace-2026` is permanent orientation: its announcement half is archived
once, and `#linksHowBtn` reopens the rest — a ROW IN THE ABOUT PANEL, beside 🔧 Operations and 🐛
Report a bug, because that is where this app keeps a page's own links. A standalone help control on
the page read as foreign wherever it was put. It is not a candidate for the 180-day removal.

### When a notice's ask becomes a control on the same screen, the notice is arguing with the app

A notice that re-offers a choice the reader declined a moment earlier, or points elsewhere for
something now on the page underneath it, is WRONG rather than old — retire it early, whatever its
expiry (`sign-in-2026`, owner decision). Check what its tests carried first: it was the only notice
the accessibility suite scanned, and that scan had to move.

### A queue of notices: one per load, each with a way back

Notices on one page open one per load, never two at once: each later one waits for the one before it
(`FOLLOWS`). Two habits worth copying: a notice whose body names its menu route (☰ then 🚆 Trains)
loses nothing when the reader taps "Not now"; and a notice whose link opens another notice's target
counts that other notice as seen, so the reader is not asked twice.

### A notice must fit the smallest phone without scrolling — measure it before it ships

A notice card stops at 80% of the screen (`.notice-lb-content`, `max-height: 80dvh`) and scrolls
inside itself past that. A three-paragraph draft (`hpp_2526`) did so at 360x740 and 375x667 — "Not
now" under the card's fade, the button broken onto two lines — with every test passing and the card
fine at 390. **Two paragraphs (the news, then the route) and a button of about 25 characters** is the
rhythm of the notices beside it. Three habits:
- **Measure the card at 360x740 and 375x667, both engines, before shipping** — `scrollHeight` against
  `clientHeight`, never a screenshot alone: a card caught mid-animation is scaled, and a picture of it
  lies about the fit. `e2e/paycalc-notices.spec.js` → "fits a … phone without scrolling" is the pattern.
- **Keep a button label to about 25 characters**, so it stays on one line at 360; the full date can
  live in the sentence above it.
- **`&nbsp;` holds a date together, and an emoji with its card's name** (`13&nbsp;Mar&nbsp;2026`,
  `🏖️&nbsp;Holiday Pay Premium`; `\u00a0` in the App Notices entry), or a phone breaks "13" from
  "Mar 2026" and strands the emoji at a line's end.

## Monthly cleanup — run on the 1st of each month

**At the start of any session on the 1st of each month**, check the "Current notices" table above for notices whose posted date is more than 180 days ago. Those notices are completely inert — remove them.

**Remove a notice when `(today − Posted) > 180 days`:**

1. Delete the `<div id="[Name]NoticeLb">` HTML block from the page file
2. Delete the JS IIFE (the `NOTICE_DATE`/keys block, `createLightbox()` call, and event listeners) —
   but KEEP its `FOLLOWED_ENDS` entry in `calendar-notices.js` while any live notice still follows it:
   that entry is what lets a device that never answered it stop waiting (block 12 of the test)
3. Remove the row from the "Current notices" table above
4. Bump the version (HTML and JS files are being modified)

**Do not remove a notice before its own expiry** unless you are retiring it early (below): until
`isNoticeExpired` fires — its window, or its `LAST_DAY` — it still opens for a member who has not
seen it on that device. **After its expiry it shows to nobody, a first visit included**: the page
marks it seen without showing it (the Status note under Current notices), so until the 180 days all
its code does is set that flag. The App Notices archive keeps its own copy, aged from when it was
archived (Archive expiry, above), so removing the code takes nothing out of the drawer.

**Retiring one EARLY** (before 180 days, because it has stopped being true rather than stopped being
new) is the same four steps, plus two: drop any `CONFIG.*_NOTICE_DAYS` constant it owned, and check
what its tests carried (Lessons, above). Say in the release what coverage moved or lapsed; a notice
deleted quietly takes its guards with it.
