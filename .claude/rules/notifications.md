# Push notification design language

The one app surface rendered by the **OS**, not by our CSS — so it can't inherit the
design system and needs its own explicit rules. Every Web Push notification staff receive
must adhere to this. Enforced by a single builder (`buildPushPayload`) in
`functions/index.js`; the service worker renders the result.

## The core principle (what ties a notification to the app)

**A notification's leading emoji is the SAME emoji the app already uses for that feature**
in the nav drawer and on its card. That reuse is what makes a notification visibly "belong"
to its part of the app — at zero asset cost, no CSP change, and reliably cross-platform
(emoji render inline on both Android and iOS). The icon is always the app icon (brand
identity); the **emoji carries feature identity**.

| Feature | Emoji | Matches in-app | `tag` | Sub-type |
|---------|-------|----------------|-------|----------|
| Daily Huddle | 📋 | Operations "Daily Huddle" card + nav | `huddle` | document |
| Weekly Retail Circular | 📰 | Operations card + nav "Weekly Retail Circular" | `circular` | document |
| Marylebone Newsletter | 🗞️ | Operations card + nav "Marylebone Newsletter" | `newsletter` | document |
| Pay reminder | 💷 | Pay nav pill / paycalc | `pay-reminder` | event |

When the app gains a new notifying feature, add ONE row here and ONE entry to the
`NOTIFICATION_FEATURES` map — never hand-write a payload.

## Two sub-types, two grammars

**1. Document arrival** (huddle / circular / newsletter) — a new document is available.
Because a document is republished regularly and the Huddle in particular is sent the
**evening before** for the next day's plan, **never** use day-relative words ("Today's",
"Tomorrow's") — they're inaccurate by the time it's read. Use **"Latest"**:

- Title: **`<emoji> Latest <Document Name>`**
- Body: a calm "tap to read" line.

| | Title | Body |
|---|-------|------|
| Huddle | `📋 Latest Huddle` | `Tap to read the latest day plan.` |
| Circular | `📰 Latest Retail Circular` | `Tap to read this week's retail update.` |
| Newsletter | `🗞️ Latest Marylebone Newsletter` | `Tap to read the latest newsletter.` |

**2. Event reminder** (pay; future: approvals/assignments) — a time-sensitive event.
"Latest" doesn't apply; lead with the event and its urgency:

- Title: **`<emoji> <Event> — <urgency>`**
- Body: the concrete action.

| | Title | Body |
|---|-------|------|
| Pay | `💷 Payday Friday — hours cutoff today` | `Open the Pay Calculator to estimate your 28 March pay.` |

## Voice & tone

- **Calm and factual.** A roster tool earns trust by being quiet and reliable, not by
  shouting. **No exclamation marks** by default; no ALL-CAPS; no marketing voice.
- **Exactly one emoji**, leading the title (the feature signature). Never emoji in the
  body, never emoji mid-sentence.
- **Title Case** for the headline; second person where natural ("your pay", "tap to read").

## Length budgets (truncation-safe)

- **Title** ≤ ~40 characters *including the emoji* (collapsed notifications truncate hard).
- **Body** ≤ ~80 characters (≈ two lines collapsed).

## Icon, badge, tag

- **`icon`** — always the app icon (`icon-192.png`), resolved against `registration.scope`
  (not the bare origin — the GitHub Pages sub-path install would 404). Shared across all
  notifications for brand identity.
- **`badge`** — MUST be a **monochrome silhouette** (`icon-badge.png`, white-on-transparent,
  ~96×96). Android masks the badge to a single colour in the status bar; feeding it the
  full-colour app icon produces a muddy blob. **Never use `icon-192.png` as the badge.**
- **`tag`** — one stable string per feature (table above). Same tag ⇒ a repeat replaces the
  previous one in the Notification Centre instead of stacking. `renotify: true` so a
  replacement still alerts.

## Deep link

Every notification deep-links to **its feature's surface within scope**. The Cloud Function
hardcodes one absolute URL; the service worker takes only the page + query + hash and
**re-bases it onto the local install's scope** (`SAFE_NOTIFICATION_PAGES` in
`service-worker.js`) — never trusting the payload's origin (multi-origin: `web.app` vs the
`/roster-app/` Pages mirror). Add a feature's landing page to `SAFE_NOTIFICATION_PAGES` when
adding the feature. Full rationale: OPERATIONS_REFERENCE.md → "Huddle notification tap behaviour".

- Huddle → `#huddle` (opens the in-app Huddle viewer overlay).
- Pay → `paycalc.html?payday=YYYY-MM-DD` (calculator opens on the right period).
- Circular / Newsletter → `#circular` / `#newsletter` (opens the in-app document viewer,
  `calendar-doc-viewer.js`, used on notification taps).

## The builder (single source of truth)

All payloads go through `buildPushPayload({ feature, headline?, body, url? })` in
`functions/index.js`, backed by the `NOTIFICATION_FEATURES` map (emoji + tag + default
headline + default path). Hand-writing a `{ title, body, tag, url }` literal is **not
allowed** — it's how the design drifted (one notification used the app name as its title,
another a marketing headline). The builder guarantees the leading emoji, the tag, and the
scope-relative URL.

## Adding a new notification type — checklist

1. Add a row to the feature table above and an entry to `NOTIFICATION_FEATURES`
   (emoji = the in-app icon for that feature; a stable `tag`; default headline; default path).
2. Choose the sub-type (document vs event) and write the title/body to that grammar.
3. If it deep-links to a new page/hash, add it to `SAFE_NOTIFICATION_PAGES` in the SW.
4. Fan out via `buildPushPayload` + `fanOutPush` — never a raw literal.
5. Confirm against the length budgets and the no-exclamation tone rule.
