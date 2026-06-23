---
name: new-notice
description: Full guide for adding a one-time notice lightbox to any app page. Invoke this skill when the user asks to add a notice, alert, or announcement lightbox.
---

# One-time notice pattern (v13.36)

Notices are `.lb-overlay` lightboxes shown periodically or once to staff on a specific page. They are built with `createLightbox()` and call `archiveNotice()` so the notice appears in the nav panel "📣 App Notices" record. **Every notice must follow this pattern exactly** — do not invent new CSS classes or deviate from the element order.

## HTML template

Add the notice lightbox in the page's HTML, grouped with the other `.lb-overlay` divs:

```html
<div id="[Name]NoticeLb" class="lb-overlay" role="dialog" aria-label="[Title]" aria-modal="true">
    <div id="[Name]NoticeContent" class="lb-content notice-lb-content">
        <button id="[Name]NoticeClose" class="lb-close" type="button" aria-label="Close">✕</button>
        <div class="notice-badge notice-badge--[page]">[Emoji] [Section]</div>
        <div class="lightbox-app-name">[Title]</div>
        <div class="notice-date">Posted [D Mon YYYY]</div>
        <p class="notice-body">[Body text. Use <strong> for emphasis.]</p>
        <!-- OPTIONAL — only when the notice drives a page visit: -->
        <a href="[url]" id="[Name]NoticeGo" class="notice-cta">[CTA label] →</a>
        <button id="[Name]NoticeLater" class="notice-later" type="button">Not now</button>
    </div>
</div>
```

**Element order is mandatory:**
1. `.lb-close` ✕ button — always first, absolutely positioned, does not affect flex flow
2. `.notice-badge notice-badge--[page]` — section pill coloured to match the page's nav pill (see table below). Do not use `.lightbox-badge` on notices.
3. `.lightbox-app-name` — notice title (white, 17px bold — scoped smaller than the About lightbox title by `.notice-lb-content .lightbox-app-name` in `shared.css`)
4. `.notice-date` — `Posted D Mon YYYY` — **hardcoded** to the date the notice was published
5. `.notice-body` — body copy paragraph (soft white, 13px, centred)
6. `.notice-cta` — gold action `<a>` — only if the notice links to another page
7. `.notice-later` — muted dismiss `<button>` — only when `.notice-cta` is present

**No per-notice CSS.** All visual needs are met by the shared classes above (defined in `shared.css`).

## Section badge values

| Section | Badge text | CSS modifier |
|---------|-----------|-------------|
| Pay calculator | `💷 Pay` | `notice-badge--pay` (green) |
| Links workspace | `🔗 Links` | `notice-badge--links` (purple) |
| Settings page | `⚙️ Settings` | `notice-badge--settings` (indigo) |
| Operations page | `🔧 Ops` | `notice-badge--ops` (orange) |
| Calendar page | `📅 Calendar` | `notice-badge--calendar` (gold) |
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

    lb.open();   // or conditionally, e.g.: if (lsGet(PREV_KEY) && !lsGet(NOTICE_KEY)) lb.open();
}());
```

## JS pattern — actionable notice (has CTA + "Not now")

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

    goLink?.addEventListener('click', () => _snooze(1));  // acted — shorter snooze
    laterBtn?.addEventListener('click', () => lb.close());

    // Guard: skip if another overlay (e.g. Huddle viewer) opened in the 1500ms window.
    setTimeout(() => { if (!document.body.classList.contains('lb-open')) lb.open(); }, 1500);
}());
```

**Target-page permanent dismiss:** On the page the CTA links to, call `lsSet('myb_notice_[id]_done', '1')` when the user completes the action (e.g. after saving their email, after submitting the form). Without this, the notice re-shows after the 1-day snooze indefinitely — `DONE_KEY` is never set by the notice IIFE itself.

## Rules

| Rule | Value |
|------|-------|
| `archiveNotice()` timing | `onClose` for close-only notices · `onOpen` for notices with a navigation CTA |
| Snooze on close (×, backdrop, Escape, "Not now") | 7 days |
| Snooze on CTA navigation | 1 day |
| Permanent dismiss key | `myb_notice_[id]_done` — set when the user completes the action (e.g. in the target page) |
| Snooze key | `myb_notice_[id]_snooze` — ISO date string |
| Notice ID naming | `[section]-[year]` or `[topic]_[tax-year]` — e.g. `links-beta-2026`, `ytd_2627` |
| Posting date format | `D Mon YYYY` — e.g. `22 Jun 2026` — hardcoded in both the HTML `.notice-date` and the `archiveNotice()` call; never use `new Date()` |
| Expiry on new device — short (28 days) | Default. Use for time-bound prompts that lose urgency quickly: feature launches, one-off nudges (e.g. beta notice). `if (isNoticeExpired(NOTICE_DATE)) { lsSet(DONE_KEY, '1'); return; }` — placed after the done/snooze checks. Import `isNoticeExpired` from `nav-panel.js`. |
| Expiry on new device — long (90 days) | Use for tax-year or seasonal notices that stay relevant for months: YTD entry reminders, pay rate change notices. `if (isNoticeExpired(NOTICE_DATE, 90)) { lsSet(DONE_KEY, '1'); return; }` — same placement as short. |
| Archive expiry | `archiveNotice()` prunes entries whose `archivedAt` timestamp is older than **180 days** on every write — the archive stays fresh over time on each device without the user having to clear storage. (It lives in `localStorage`, so it is per-device and does **not** sync across devices; legacy pre-v13.41 entries without `archivedAt` are migrated — stamped with the current time — not dropped, on the first write.) |
| Show delay | 1500ms when notice competes with page render; 0 when it is the first thing shown |

## After adding the notice

Add a row to the "Current notices" table in `CLAUDE.md`:

| ID | Page | Title | Badge | Posted | Expiry | Dismiss mechanism |
|----|------|-------|-------|--------|--------|-------------------|
| `[id]` | `[page].html` | [Title] | [Badge] | [D Mon YYYY] | [28/90] days | One-time; `[DONE_KEY]` set on close |

## Monthly cleanup — run on the 1st of each month

**At the start of any session on the 1st of each month**, check the "Current notices" table in `CLAUDE.md` for notices whose posted date is more than 180 days ago. Those notices are completely inert — remove them.

**Remove a notice when `(today − Posted) > 180 days`:**

1. Delete the `<div id="[Name]NoticeLb">` HTML block from the page file
2. Delete the JS IIFE (the `NOTICE_DATE`/keys block, `createLightbox()` call, and event listeners)
3. Remove the row from the "Current notices" table in `CLAUDE.md`
4. Bump the version (HTML and JS files are being modified)

**Do not remove** a notice that is still within its archive window — users who haven't visited yet may still see it on their first visit.
