# GUIDE_SOURCES.md — source register for the operational guides

The app's **code** has strong automated governance (tests, CI stamps, the pre-commit hook).
Its **operational content** — the Railcard and FIP guides especially — did not, and that is how
several materially-wrong statements shipped (the v17.45 audit). "Verified June 2026" at the foot of
a long page is not enough: individual sections age at different rates, and a *local Marylebone
shortcut* stated as a *national rule* is the exact failure mode that produced the worst errors.

This file is the register that closes that gap. Every **high-risk** guide claim — one that could
lead to a wrongly-sold or wrongly-refused ticket, an invalid journey, or a pay miscalculation — has
a row below recording its **authoritative source**, the **date last reviewed**, a **next-review**
date, and — critically — whether it is a **National** rule, a **Local** interpretation, or a
**Tip/Fact**. `guide-sources.test.mjs` enforces that every row stays structurally complete (part of
`npm run test:hygiene`), so the register cannot silently rot to blanks.

## How to use it

- **Before changing a high-risk guide claim:** find its row, open the Source, confirm the wording,
  update the guide, then bump `Reviewed` (and push `Next` out).
- **Every railcard/fip row is wired to the block it certifies** via a `data-guide-source="<id>"`
  attribute on that block in `railcard-guide.html` / `fip.html` (v17.59). `guide-sources.test.mjs`
  enforces the two-way contract: no attribute may point at a missing row, and no railcard/fip row
  may lack a block. So when you **add a high-risk row you must anchor it** with a
  `data-guide-source` attribute (and vice-versa) — the build fails otherwise. A block may cite
  several rows (space-separated). `paycalc` rows are exempt (they render on a different surface).
- **Review cadence (manual, like the monthly notice cleanup):** each row carries its own `Next`
  date. Sections age at different rates — railcard time rules and pay/tax figures are the most
  time-sensitive; per-country FIP carrier details are the most volatile. When a row's `Next` month
  arrives, re-check that one section against its Source and re-stamp it. Do a full pass at least
  once a year (railcards each spring, before the May fares change; tax before 6 April).
- **Classification is the anti-drift control.** `National` = the legal/product rule (say it exactly,
  and prefer a verbatim clause). `Local` = the Marylebone shortcut staff use day-to-day (must be
  labelled as such — see the three-layer format in the railcard guide). `Tip`/`Fact` = practical
  guidance or a fixed figure.

## ⚠ Verbatim-clause caveat (railcards + FIP)

The July 2026 source review reached the official railcard subdomains and the RDG/RST FIP pages via
**indexed/summarised T&C content**, not a live full-page fetch (those hosts blocked automated
fetch). The *substance* below is corroborated across multiple official sources and is safe for
deciding what a section should say — but before any **National** row is treated as counter-final,
open its Source and lift the exact clause. The `National` rows are precisely where a verbatim quote
belongs.

## Classification legend

| Class | Meaning |
|-------|---------|
| `National` | A legal/product rule set nationally (National Rail T&Cs, RDG/RST). State it exactly. |
| `Local` | A Marylebone/Chiltern interpretation or shortcut. Must be labelled as local, not universal. |
| `Tip` | Practical guidance — how staff apply the rule day-to-day. |
| `Fact` | A fixed figure or datum (fare, rate, threshold, phone number). |
| `Contact` | A booking/enquiry contact point (agency phone, booking site) whose accuracy matters but which is neither a rule nor a fixed figure. |

## Register

<!-- guide-sources.test.mjs parses the rows below. Columns, in order:
     ID | Guide | Section | Class | Reviewed | Next | Source
     Reviewed/Next are YYYY-MM. Source is an http(s) URL, a `code:<file>` ref, or `internal`.
     Keep every cell filled — the hygiene test fails on a blank, a bad class, or Next <= Reviewed. -->

| ID | Guide | Section | Class | Reviewed | Next | Source |
|----|-------|---------|-------|----------|------|--------|
| rc-forces | railcard | HM Forces — no 2nd-adult discount; up to 4 children 5–15 at 81% off (£1 min); holder ⅓ off; spouse/partner own card | National | 2026-07 | 2027-05 | https://www.hmforces-railcard.co.uk/terms-and-conditions |
| rc-ff-peak | railcard | Family & Friends — no discount in the weekday morning peak for journeys wholly within the Network area; off-peak start varies by route | National | 2026-07 | 2027-05 | https://www.familyandfriends-railcard.co.uk/help/railcard-terms-conditions/ |
| rc-ff-under5 | railcard | Family & Friends — where every child is under 5, buy one child ticket to unlock the adult discount | National | 2026-07 | 2027-05 | https://www.familyandfriends-railcard.co.uk/help/faqs/my-child-is-under-five-can-i-still-use-a-family-friends-railcard/ |
| rc-senior-peak | railcard | Senior — no general minimum fare; no discount in the weekday morning peak within the Network area; off-peak start varies by route | National | 2026-07 | 2027-05 | https://www.senior-railcard.co.uk/help/railcard-terms-conditions/ |
| rc-twotogether | railcard | Two Together — a physical station-bought card has a separate Two Together Photocard that must be carried and shown; both named holders must travel together | National | 2026-07 | 2027-05 | https://www.twotogether-railcard.co.uk/help/railcard-terms-conditions/ |
| rc-gold | railcard | Gold Card — paper season = Gold Card + Photocard; Smartcard/Oyster season = Gold Record Card (physical or digital); discount not valid 04:30–09:29 Mon–Fri | National | 2026-07 | 2027-05 | https://www.nationalrail.co.uk/railcards/annual-gold-card/ |
| rc-groupsave | railcard | GroupSave — discount rides the relevant Off-Peak ticket, whose restriction controls; 09:30 fallback only where no Off-Peak fare exists; 3–9 people | National | 2026-07 | 2027-05 | https://www.nationalrail.co.uk/tickets-railcards-and-offers/saving-money/group-travel/groupsave-terms-and-conditions/ |
| rc-network-area | railcard | Network — valid to Banbury/Kings Sutton; not Leamington/Warwick/Birmingham; ⊘ before 10:00 Mon–Fri; £13 adult min after | National | 2026-07 | 2027-05 | https://www.network-railcard.co.uk/ |
| rc-chiltern-area | railcard | Chiltern route boundaries (Marylebone–Banbury/Kings Sutton within Network; whole route incl. Birmingham within Gold Card area) | Local | 2026-07 | 2027-05 | https://www.network-railcard.co.uk/clientfiles/files/Map.pdf |
| rc-minfare | railcard | Minimum fares £12 (most) / £13 (Network); Jul–Aug waiver for 16–25, HM Forces, Veterans; not 26–30; never on Advance | Fact | 2026-07 | 2027-05 | https://www.nationalrail.co.uk/railcards/ |
| fip-card-validity | fip | FIP Card validity — two calendar years plus 1 Dec before to 31 Jan after the printed period | National | 2026-07 | 2027-01 | https://www.raildeliverygroup.com/rst/europe-and-fip.html |
| fip-allocation | fip | FIP coupon allocation — quota-controlled per operator, varies by year, staff ≠ family; ~1 per country (some 2) is a rough guide only | National | 2026-07 | 2027-01 | https://www.raildeliverygroup.com/rst/europe-and-fip.html |
| fip-coupon-expiry | fip | FIP coupon validity — anchored to the declared outward/start date, max 3 months; apply ≥3 weeks ahead; posted ~2 weeks before | National | 2026-07 | 2027-01 | https://www.raildeliverygroup.com/rst/europe-and-fip.html |
| fip-request | fip | FIP coupons ordered on request from the annual allowance (not automatic); the FIP card itself renews automatically | National | 2026-07 | 2027-01 | https://www.raildeliverygroup.com/rst/forms.html |
| fip-eligibility | fip | FIP eligibility — generally after 12 months' service with a National Rail operator; discretionary, not contractual | National | 2026-07 | 2027-01 | https://www.raildeliverygroup.com/rst/europe-and-fip.html |
| fip-journey-coupon | fip | FIP cross-border — a coupon per country travelled through (journey-validity rule, distinct from the annual allocation) | National | 2026-07 | 2027-01 | https://www.raildeliverygroup.com/rst/europe-and-fip.html |
| fip-carrier-accept | fip | FIP per-country carrier acceptance (e.g. Eurostar not accepted; OUIGO/Frecciarossa exclusions) — HIGH-CHURN, sampled not certified per-carrier | National | 2026-07 | 2026-10 | https://www.raildeliverygroup.com/rst/europe-and-fip.html |
| fip-contact | fip | Booking-from-UK contacts (Trainseurope 01354 660222; bookmyrst.co.uk) | Contact | 2026-07 | 2027-01 | https://www.raildeliverygroup.com/rst/europe-and-fip.html |
| fip-fr | fip | France (SNCF, incl. TGV) — 75% FIP + coupons; compulsory reservation on TGV/most Intercité (included on the 75% ticket, paid separately on a coupon: ~€2 off-peak either class, ~€11 2nd / ~€16 1st at peak — verified Jul 2026, RDG states these current as of Jan 2026); OUIGO + Milan–Paris Frecciarossa excluded; domestic booked at station/phone | National | 2026-07 | 2027-01 | https://www.raildeliverygroup.com/rst/europe-and-fip/countries/469782262-france.html |
| fip-be | fip | Belgium (SNCB/NMBS) — 75% FIP + coupons, no reservation; Diabolo airport surcharge; from 1 Jul 2026 buy before boarding (no on-board sales) | National | 2026-07 | 2027-01 | https://www.raildeliverygroup.com/rst/europe-and-fip.html |
| fip-nl | fip | Netherlands (NS) — FIP acceptance; the high-speed Intercity Direct link carries a supplement with a discounted ticket, none on a free coupon | National | 2026-07 | 2027-01 | https://www.raildeliverygroup.com/rst/europe-and-fip.html |
| fip-ie | fip | Ireland (Irish Rail + Translink/NIR) — the Belfast–Dublin Enterprise needs one coupon per operator, handover at Dundalk | National | 2026-07 | 2027-01 | https://www.raildeliverygroup.com/rst/europe-and-fip.html |
| fip-de | fip | Germany (DB) — domestic ICE needs no supplement with a FIP-discounted ticket or a free coupon | National | 2026-07 | 2027-01 | https://www.raildeliverygroup.com/rst/europe-and-fip.html |
| fip-at | fip | Austria (ÖBB, incl. Railjet) — coupons follow the country/territory travelled through, not the train's branding | National | 2026-07 | 2027-01 | https://www.raildeliverygroup.com/rst/europe-and-fip.html |
| fip-it | fip | Italy (Trenitalia) — Freccia/EC/EN/IC/ICN need a compulsory reservation + supplement (included on a 75% FIP ticket, bought separately on a coupon); Italo/Trenord/FSE excluded | National | 2026-07 | 2027-01 | https://www.raildeliverygroup.com/rst/europe-and-fip.html |
| fip-es | fip | Spain (Renfe) — AVE has a mandatory fixed staff supplement + reservation (check the current amount); UK-booking availability qualified | National | 2026-07 | 2027-01 | https://www.raildeliverygroup.com/rst/europe-and-fip.html |
| fip-ch | fip | Switzerland (SBB) — FIP accepted on SBB; cross-border TGV Lyria uses a fixed FIP price and takes no coupons | National | 2026-07 | 2027-01 | https://www.raildeliverygroup.com/rst/europe-and-fip.html |
| pay-rates | paycalc | CEA/CES hourly rates, contracted hours, pension, London Allowance | Fact | 2026-07 | 2027-04 | internal |
| pay-income-tax | paycalc | rUK income-tax bands + Personal Allowance (2026/27) — confirmed Jul 2026; the rUK income-tax/PA freeze now runs to Apr 2031 | Fact | 2026-07 | 2027-03 | https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027 |
| pay-ni | paycalc | National Insurance primary threshold + employee rates (2026/27) — confirmed Jul 2026 | Fact | 2026-07 | 2027-03 | https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027 |
| pay-student-loan | paycalc | Student-loan plan thresholds (2026/27) — confirmed Jul 2026 vs GOV.UK SL3 2026-27 | Fact | 2026-07 | 2027-03 | https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027 |
| pay-scottish | paycalc | Scottish income-tax bands (2026/27) — confirmed Jul 2026 vs the Scottish Budget 2026/27 | Fact | 2026-07 | 2027-03 | https://www.gov.scot/publications/scottish-budget-2026-to-2027/ |

## Not certified

- **Per-country FIP carrier details** (operators, phone numbers, reservation rules, acceptance) are
  time-sensitive. The **nine high-use destinations** — France, Belgium, Netherlands, Ireland,
  Germany, Austria, Italy, Spain, Switzerland — now each carry their **own** dated row (`fip-fr` …
  `fip-ch`), anchored to their country card, so each has an individual review record. The remaining
  (lower-use) country cards stay under the sampled, high-churn `fip-carrier-accept` row. Either way,
  treat the country cards in `fip.html` as "check before travel", not gospel — each sourced card now
  shows its own "Checked" date to make that freshness visible.
- **Pay award rates** (`pay-rates`) are the internal Chiltern figures from the payslip / pay award,
  not public T&Cs; their evidence is the payslip, kept device-local (see ARCHITECTURE_PLAN.md).
