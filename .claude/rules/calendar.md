---
paths:
  - "index.html"
  - "index.css"
  - "calendar-*.js"
  - "calendar-*.test.mjs"
  - "e2e/calendar*.spec.js"
---

# Calendar page — area decisions

The Calendar is `index.html` and the `calendar-*.js` modules. **What it may SHOW, and when, is the
contract `docs/CALENDAR_DATA.md`** — numbered invariants that other documents link rather than
restate. This file holds the page's own "never change without discussion" decisions. They moved here
from `CLAUDE.md`'s architecture table, which every session loads; the rows that bind more than this
page (access, `getBaseShift`, Christmas, Sundays, the hash-opened documents) stayed there.

| Decision | Rule |
|----------|------|
| `aria-live` for month announcements | Programmatic `.focus()` on the month heading caused mobile layout reflow. Do not switch. The announcer is `#ariaAnnouncer` in `index.html`. |
| `Math.ceil()` on carousel panel width | Eliminates sub-pixel seam on high-DPI screens. Do not remove (`calendar-swipe.js`, beside `gestureW`). |
| `_staleMemberName` in `calendar-member.js` (the BANNER is in `calendar-app.js`) | When `getSelectedMemberIndex()` can't find a saved name, sets flag, falls back to default member. On the next page open the banner fires via `_showStaleMemberBanner()` — called from the pre-branch init block for team-view users, or from inside `renderCalendar()` for calendar-view users. `takeStaleMemberName()` is one-shot so only one path fires. |
| Sync chip state machine in `calendar-initial-fetch.js` | hidden → (800ms) → "↻ Updating your shifts…" → silent remove on success, or "⚠ Couldn't update" (stays until a retry works; the deadline is `SYNC_TIMEOUT_MS`). A retry says "↻ Retrying…" for at most `RETRY_TIMEOUT_MS`, then hands the control back as a failed read does (owner, 10 Nov 2026) — the read is not cancelled, and a late answer still clears the chip. There is no "✓ Up to date" state — it was noise. Never show raw errors to staff. Hidden while the grid shows its OWN loading/failed panel (one message, not two); kept beside a failed panel that has no Try again, where it is the only retry. The panel's Try again withdraws a recorded failure (`dismissSyncError`), and so does a read confirming the month on screen (cal-data-5). |
| One-off notification prompt (`#notifPrompt`) | Appears once per device between `</nav>` and the swipe hint / calendar. Both Enable and × set `myb_notif_prompt_done` (`NOTIF_PROMPT_DONE` in `storage-keys.js`). Do not move below the calendar. It shares its slot with the install strip, which outranks it (`install-prompt.js`). If the system grants permission and the subscription still fails, the strip returns with its second line (`index.html`) instead of vanishing. |
| Team Week View | Available to everyone the Calendar admits (a signed-in member or the staff PIN); grade state (`currentTeamGrade`) persists across re-renders — it opens on the shown member's grade until the reader picks a tab, and a picked tab persists across re-opens — week nav clamped to `CONFIG.MIN_YEAR`/`MAX_YEAR`. **Overrides come from the SHARED month fetch** (`ensureOverridesCached`, injected), never a fetcher of its own: a second authoritative reconciler racing the first evicted overrides the 3-month fetch had just loaded, blanking the grid back to base roster. That is `CALENDAR_DATA.md` invariant 6, and the narrative behind it is in `calendar-overrides.js`. A month read Team View started lands with the coordinator's shared repaint (`onMonthRead`), so it repaints the Calendar if Team View has been left. **No override-load status indicator** — proposed by review and accepted as won't-do: a failed month releases from `fetchedMonths` (retryable) and leaves the last-good cache untouched, so a failed refresh keeps the last-good grid silently, which is the minimal-noise behaviour this app wants. (That is TEAM VIEW's answer and it stands: the MONTH grid labels a failed re-check "Saved copy — couldn't check for changes" — `CALENDAR_DATA.md` 18 — and Team View draws a saved-copy week exactly as a current one.) **The table's swipe hint shows only on touch AND only while the week is wider than its box** (`watchHintFit`, through `overflow-hint.js` — a ResizeObserver, shared with the Trains grid): on a tablet or a phone on its side the week fits, so there is nothing to swipe, and a change of size — a rotation clamping the box's scroll — is never taken for the member's swipe that retires it. |
| **A calendar day opens the day panel — on EVERY pointer type** | Owner request: *"I want the day detail lightboxes like mobile on desktop."* The click handler in `calendar-renderer.js` has **no pointer branch** and must not regain one — its own comment says what it replaced and why. **The pay jump is not lost, it is one click deeper**, on the panel's `#dayDetailPayBtn`, which `personalActionsAllowed` already gates. **Three things that go with it and are easy to undo** — the hover tooltip stays as the preview and `body.lb-open #calTooltip` takes it down, a fine pointer gets `cursor: pointer` on a real day cell, and the KEYBOARD is deliberately unchanged (Enter still jumps from a pay cell and falls through to the panel when refused). Each is argued beside its rule in `index.css`, including which parts were MEASURED rather than assumed; `e2e/calendar.spec.js` pins the behaviour rather than the mechanism. |
| `navigateToPaycalc(paydayStr)` in `calendar-app.js` | The one route from a payday or cut-off cell to the calculator, carrying `?payday=`, and its one gate: `personalActionsAllowed`. Always call this helper — never duplicate the navigation logic. **It never diverts to a sign-in**: paycalc signs in in place and keeps the query, so a bounce through admin would only lose the date. The day panel's other action, `#dayDetailLeaveBtn` to Admin, is the same shape for the same reason. |

The day panel itself (`calendar-al-lightbox.js` and its `index.css` block) is in `CLAUDE.md` →
*Change impact*: it is the only place a member reads what a day is on touch, and its two shipped
defects were invisible to behaviour tests.
