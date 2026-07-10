---
paths:
  - "guide.html"
  - "paycalc-guide.html"
  - "railcard-guide.html"
  - "fip.html"
  - "guide-shell.css"
  - "guide.css"
  - "guide-doc.css"
  - "paycalc-guide.css"
  - "railcard-guide.css"
  - "fip.css"
  - "guide-print.js"
  - "railcard-guide.js"
  - "fip.js"
---

# Guide pages — full reference

## Shared rules (all four guide pages)

- Guide pages do **not** import the app's `shared.css` (nav panel / lightbox / login chrome they don't use). All four share `guide-shell.css`; the two **document-style** guides (`guide.html`, `paycalc-guide.html`) additionally load `guide-doc.css` (the shared two-column print layout + 760px content wrapper) between the shell and their own CSS. Each page then has its own external CSS file (`guide.css`, `paycalc-guide.css`, `railcard-guide.css`, `fip.css`) — extracted from inline `<style>` blocks at v12.04. Do not add a `shared.css` import to any guide.
- Guide pages use **no inline `<script>` or `onclick` handlers** — Firebase Hosting CSP (`script-src 'self'`) blocks them. All guide JS is in external files: `railcard-guide.js` (v10.84), `guide-print.js` (v10.84, shared by `guide.html` and `paycalc-guide.html`), and `fip.js` (v16.59, opens the target country `<details>` on jump/deep-link). Do not add inline scripts or `onclick` attributes.
- Back buttons on `railcard-guide.html` and `fip.html` link to `./index.html` (not `./admin.html`) — guides are accessed from the nav panel.

## Unified guide shell (v11.47)

All four guide pages share one chrome for consistent behaviour on iOS, Android, desktop, and print. The common chrome lives in **`guide-shell.css`** (linked by all four, before each page's CSS). Edit the shell there once — do not re-inline it. As of v11.85, `guide-shell.css` defines the shared brand palette tokens (`--navy`, `--navy-dark`, `--navy-mid`, `--gold`) in its own `:root` — guide pages no longer redefine these themselves.

**In `guide-shell.css` (shared — change once):**
- **Header:** full-bleed sticky navy `.page-header`, `align-items: center`, `top: 0`, with `←` `.btn-back` (left) · title `<h1>` + `.sub` · `⤓ PDF` `.btn-pdf` (right, `margin-left:auto`). Top padding `max(14px, env(safe-area-inset-top))` for the iOS notch.
- **Print:** `.page-header { position: static; print-color-adjust: exact }` and `.btn-back, .btn-pdf { display: none }`. railcard/fip print the sticky header as their title banner; on guide/paycalc the header is `.no-print` so these rules are inert there (they print their own in-document `.guide-header` banner instead — `print-color-adjust: exact` on that banner stays inline).

**Still per-page in each page's own CSS file (keep aligned by eye):**
- **Background:** flat `#f4f5f8` edge-to-edge. No white "page" card.
- **Content width:** `max-width: 760px`, centred. For `guide.html`/`paycalc-guide.html` the 760px wrapper **and** the two-column `.cols` print grid live in the shared **`guide-doc.css`** (not the page's own file); `railcard-guide.html`/`fip.html` set their own 760px single-column width in their page CSS.
- **Safe-area:** side insets `max(16px, env(safe-area-inset-*))` on the content wrapper; bottom `max(40px, env(safe-area-inset-bottom))`.
- **PDF button markup:** `<button id="savePdfBtn" class="btn-print btn-pdf">⤓ PDF</button>`. Wired by `guide-print.js` (`.btn-print`) on guide/paycalc/fip; `railcard-guide.js` wires `#savePdfBtn` itself because it also owns the chip-bar.

## Railcard guide

`railcard-guide.html` is an at-work quick reference for staff at the **gateline** and **ticket office**. Not a customer-facing page — judge every decision against "can a staff member glance at this mid-transaction and get the right answer fast?"

**Design principles — do not change without discussion:**
- **"For dummies" clarity over completeness.** Plain language; no jargon. If adding a fact makes the page harder to scan, leave it out.
- **Glanceable card layout.** One card per railcard. Rows: Save / When / Who (only where genuinely needed).
- **Colour stripe = Mon–Fri time rule only.** Green = any time. Amber = morning restriction. Red = Network (strictest). Do not repurpose these colours.
- **£ / ⊘ tokens in the When row.** £ = travel allowed, minimum fare applies. ⊘ = no discount before the cutoff. Both symbols defined in the key strip — keep both.
- **Weekend banner is deliberately simple.** Morning/min-fare limits usually don't apply at weekends — does NOT say all restrictions lift. Do not broaden it back.
- **Chiltern-specific callouts** (`rc-chiltern`) are amber banners inside the card — keep them.
- **Photo-check is a table, not prose.** The `.photo-table` inside check step 3 gives colour-coded rows by card type. Distinguish physical vs digital explicitly.
- **Selling essentials live in gotchas.** Minimum-fare mechanic, First Class eligibility per card, season-ticket exceptions. Do not move these to card rows.

**What to care about:**
- Factual accuracy per card — verify against nationalrail.co.uk before changing any rule.
- Min-fare amounts (£12/£13) and the July/August waiver list (16-25, HM Forces, Veterans waived; 26-30 not waived) — reviewed annually; re-check each spring.
- Senior Railcard Chiltern note — must say "journeys within the Network area" not "all Marylebone services"; through journeys to Birmingham are different.
- Family & Friends — morning-peak restriction is on Network-area journeys only, not the whole card.
- Two Together photocard — wording is deliberately softened ("check names/photos on the card or its photocard") — physical card format not verified from an authoritative source; do not strengthen without confirmation.

**What not to flag as defects:**
- No JS modules — static page, intentional.
- Sticky header + sticky chip bar eating vertical space on small phones — acceptable trade-off.
- A–Z order with numeric cards first — intentional.

## FIP guide

`fip.html` is a low-frequency educational reference — not a core workflow. Judge it as an article-like reference page. Do not flag reference-page format as a design defect. Care about: factual accuracy, "last checked" date, source links, mobile layout, navy/gold palette.
