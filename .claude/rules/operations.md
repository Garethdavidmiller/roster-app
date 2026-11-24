---
paths:
  - "operations.html"
  - "operations.css"
  - "operations-*.js"
  - "test/operations-*.test.mjs"
  - "al-leave-*.js"
  - "test/al-leave-*.test.mjs"
  - "test/leave-file-*.test.mjs"
  - "e2e/operations.spec.js"
---
# Operations page — area decisions

The Operations page is `operations.html`, `operations.css` and the `operations-*.js` modules, plus the
Annual leave sheet's pure modules (`al-leave-*.js`). It is the ADMIN's page: everything on it is an app
or account matter, so its copy says "the admin" (CLAUDE.md → Staff-facing wording conventions). Written
24 Nov 2026 from what the modules' own headers already decided — they keep the reasoning, this file
routes to it. The working procedures (how to run a reset, a leave sheet, a rotation) are
`docs/OPERATIONS_REFERENCE.md`; the leave sheet's design is `docs/AL_UPLOADER_PLAN.md`; reading the
clerks' workbook is `docs/AL_WORKBOOK.md` (`/al-workbook`). Rules that bind more than this page stayed
in CLAUDE.md: the Cloud Function rows (`resetMemberPassword`, `rotateDocumentLinks`, `getSignInStats`,
`getAccountSetupGaps`), the "the admin" wording rule, and adding a member (`/new-starter`, `/leaver`).

| Decision | Rule |
|----------|------|
| Who opens it | The admin claim only. Signed out, the page shows the shared in-place sign-in; signed in as anybody else it sends them to `admin.html` (`operations-app.js` header). Hiding the drawer pill (`adminOnly`) is not the boundary — the page guards itself and the server refuses the rest (`.claude/rules/nav-drawer.md`). |
| The "Needs attention" strip | An INDEX OF EXCEPTIONAL STATES with three refusals: it runs no reads (each card reports its own count through `report()`), it disappears when clean (no "all clear"), and it owns no navigation (plain hash anchors into `DEEP_LINK_CARDS`). One exception: an unreadable reset queue says "couldn't check" (`unchecked()`). A card that failed reports NOTHING, never a reassuring zero. `operations-attention.js` header. |
| An answer the server did not give is UNKNOWN, never "none" | The PIN lockout's three states (the retired staff PIN's endpoint, still deployed: the card goes in the server release) — a block, `null`, ABSENT (an older or failed server) — and absent withdraws the strip item rather than reporting zero (`operations-pin-lockout.js` header). The same rule as the strip's: the Functions and the page deploy in parallel, so a missing field is normal for minutes. |
| Account status → Reset | The break-glass reset to the surname default. What it ASKS and every sentence it says about the answer live in `operations-reset.js`; the member is told on their own devices only (`sendTargetedPush`, never `fanOutPush`, never with the password), except for a lost or stolen phone (CLAUDE.md → Cloud Function URLs; `.claude/rules/notifications.md`). |
| Document links | Rotation is the SERVER's work (`rotateDocumentLinks`); the card asks and reports its three outcomes (`operations-doc-links.js`; ARCHITECTURE.md EXC-007). |
| Upload cards | The Huddle, Circular and Newsletter cards share one mechanism (`doc-upload.js`); `operations-doc-uploads.js` holds only what each is configured with. The Huddle button says "Choose file", not "Choose PDF" (CLAUDE.md → Do-not-change UI labels). The date field writes the month in full; where it does not fit beside the button the button takes its own line (`operations.css` → `.huddle-row`). |
| The Annual leave sheet | Reads a sealed LEAVE FILE made in a Claude session from the clerks' workbook (`al-leave-file.js` — refused by name, never defaulted), compares it with the app (`al-leave-compare.js`, which decides nothing and writes nothing), and saves ONLY leave the app is missing, per person confirmed (`al-leave-plan.js` decides, `al-leave-save.js` sends; every sentence is `al-leave-words.js`). **A leave file names colleagues: it never enters the tree** (`leave-file-privacy.test.mjs`). |
| Reporting cards | Error Log, Usage and App Speed share one failure/retry helper and the privacy footer (`operations-reports.js`); each card reads its own data. |
| Look | The hand-entry type pills wear ADMIN's type colours, type by type (`page-identity-parity.test.mjs` test 5). The two-column layout's void is accepted (`.claude/rules/css-tokens.md` → Desktop layout). |
