/**
 * coordinator-ratchet.test.mjs — an already-large module may not get larger.
 * Run: node scripts/run-tests.mjs coordinator-ratchet.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── THE RULE THIS ENFORCES ──────────────────────────────────────────────────────────────────────
 *
 * **Coordinators coordinate; domain modules decide.** A coordinator reads the UI, calls a domain
 * function, renders the result and arranges persistence. The RULE — the thing that would be wrong
 * if it were wrong — belongs in a module of its own, where it can be tested without a DOM.
 *
 * The app is already good at this: `links-design.js`, `overtime-core.js`, `paycalc-calc.js`,
 * `calendar-data-state.js` and a dozen others exist because reasoning was pulled out of a
 * coordinator. But extraction has been an ACT OF WILL each time, and nothing stopped the next
 * feature going straight back into the big file. `links-app.js` stood at 3,200 lines when this was
 * written; its cap below says what it is held to now.
 *
 * ── WHY A RATCHET AND NOT A LIMIT ───────────────────────────────────────────────────────────────
 *
 * A limit ("no file over 800 lines") would fail on the day it landed and would be waived by
 * lunchtime. A ratchet asks only that things do not get WORSE: each already-large module carries the
 * size it had when it was measured, and may not exceed it. Shrinking one is free — lower its cap in
 * the same commit and the new figure becomes the ceiling.
 *
 * ── THE HEADROOM IS DELIBERATE, AND SO IS ITS SIZE ──────────────────────────────────────────────
 *
 * A cap is SET at the measured size PLUS 50, rounded up to the next 50 — so a file carries 50–99
 * lines of room on the day its cap is set. Enough to fix a bug, add a comment or re-wire a call;
 * nowhere near enough for a business rule. Line count is a PROXY for the rule at the top of this
 * file, and the proxy is only honest if it leaves room for the work that does NOT violate the rule.
 *
 * That room is then SPENT, and nothing gives it back: a file can sit at its cap, and two do as of
 * Oct 2026 (the whole-app review counted them — this paragraph used to say "every file carries
 * 50–99 lines of room", which stopped being true the first time one grew). At the cap, even a
 * comment fails here. That is the moment the section below is for — not a reason to restore the
 * margin by raising the cap in passing.
 *
 * The first cut rounded to the next 50 with no addition, which gave `admin-roster-upload.js` — 1,200
 * lines exactly — a cap of 1,200 and zero headroom. A guard that fails on a one-line fix is a guard
 * that gets waived, and a waived guard is worse than none.
 *
 * ── WHAT A GOOD RESPONSE LOOKS LIKE WHEN THIS FAILS ────────────────────────────────────────────
 *
 * Written down because the caps are now nearly all tight — eleven of thirteen modules sit within a
 * hundred lines — so this guard has stopped being an occasional event and become a routine one. The
 * risk that creates is not over-extraction. It is that raising a cap becomes the quickest way past a
 * red test, and the ratchet quietly turns into a log of the sizes files happened to reach.
 *
 * Three responses, and the failure names which one it is:
 *
 *   EXTRACT  — the growth is a RULE: something that would be WRONG if it were wrong, that a test
 *              could pin without a DOM. This is the default and it is what the guard is for. The
 *              tell is that you can state the thing in a sentence beginning "it must…".
 *   SPLIT    — the growth is COORDINATION, and the file is doing several unrelated jobs. No rule
 *              comes out; the file becomes two or three that each have one subject.
 *   RAISE    — neither. The file has one subject, the growth is wiring or the argument for it, and
 *              there is nothing a Node test could hold. Legitimate, and it must be DELIBERATE:
 *              lower the cap again the moment the file shrinks, and say why in the commit.
 *
 * A cap that goes up must not go up quietly, and one that could come down should. When code leaves
 * a file, bring its ceiling with it — a cap left where it was banks the saving as future headroom,
 * which is this mechanism loosening while appearing to hold.
 *
 * ── AND A NEW LARGE FILE IS A DELIBERATE ACT ────────────────────────────────────────────────────
 *
 * Anything crossing LARGE_THRESHOLD that is not in the table fails this test. That is the point: a
 * module becoming large should be a decision somebody makes and records, not something noticed two
 * years later. Adding a line to `CAPS` is cheap — it just cannot happen by accident.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const here = new URL('.', import.meta.url);
/** Newline COUNT — the same thing `wc -l` reports, which is where the caps below came from.
 *  `split('\n').length` is one higher on any file ending in a newline, i.e. all of them. */
const lines = (/** @type {string} */ f) =>
    (readFileSync(new URL(f, here), 'utf8').match(/\n/g) || []).length;

/** Below this, a module is free to grow — it has not become a coordination problem yet. */
const LARGE_THRESHOLD = 900;

/**
 * WHERE THIS GUARD LOOKS — and until v23.54 the answer was "the repo root, and nowhere else".
 *
 * `readdirSync` was handed this file's own directory, so the whole of `functions/` sat outside the
 * ratchet with nothing saying so: not a documented exclusion, not a decision anybody recorded, just
 * the shape of the first implementation. Four Cloud Functions modules were over the threshold and
 * uncapped, the largest of them `roster-parse-helpers.js` — 1,351 lines, thirty-five exports, and
 * named "helpers", which is the exact condition the rule at the top of this file describes.
 *
 * That gap mattered more than a root one would: `functions/` is where the roster parser's day-drift
 * defence lives, and a rule that can be wrong about which day somebody worked is the kind this
 * guard exists to push out of a big file. The four are capped at their measured sizes now, so they
 * may shrink and may not grow. **This is a ratchet, not a verdict** — being in the table says a
 * module is large and watched, not that it is wrong.
 */
const SCANNED_DIRS = ['./', 'functions/'];

/**
 * Measured size + 50, rounded up to the next 50 (August 2026, at v21.28).
 *
 * ⚠️ THESE MAY ONLY GO DOWN. If a number here needs raising, the change underneath it is the thing
 * to reconsider — that is the whole mechanism.
 */
const CAPS = {
    // 3200 → 3150 at v21.87. The design collection's PERSISTENCE LIFECYCLE left for
    // links-design-store.js — 3,197 measured lines down to 3,076 — and the ceiling comes down with
    // it. Leaving it at 3,200 would bank the whole saving as future headroom, which is the ratchet
    // quietly loosening rather than tightening; the same reasoning as the v21.31 cut above.
    //
    // The rest of the reduction is deliberately NOT claimed. This file is still a workspace holding
    // a grid, a paint tool, a generator, a compare mode, an importer and a bin, and the next
    // genuine seam (target-set persistence) is a smaller version of the one just taken.
    // 3150 → 3175 at v22.18, deliberately and after extracting first. The revision identity's RULES
    // all went to links-concurrency.js — `conflictOf` path 0, `baselineAfterCommit`, `nextRevision`
    // and `baselineFromEntry`, which exists precisely because arming a baseline from a loaded entry
    // was about to be restated at two call sites here. What stayed is one more piece of state
    // threaded through the save, rename and select paths that already carried the old one, which is
    // coordination. Raised by 25 rather than the usual 50: banking the round number as headroom is
    // the loosening the v21.87 note above refuses.
    // 3175 → 3185 at v22.36, and stated because a raised cap should never pass unnoticed. The
    // external review's already-restored finding put a THIRD store outcome on the restore path, and
    // the reaction to it is UI: drop the stale bin row, repaint, say what happened. The RULE — write
    // nothing when the design is already live — went into links-design-store.js, which is where the
    // ratchet wants rules to go, so this is the coordinator doing its actual job. Extraction was
    // tried first and mostly worked; the last 3 lines are reasoning, and deleting reasoning to
    // satisfy a number is the trade this file exists to prevent, not the one it asks for.
    //
    // 3185 → 3150 in the same release, from the other direction: the `?`-panel content left for
    // links-tips.js, which took the file below where it stood before the raise. Help text is not
    // coordination, and it went because the generator card's prose was moving into the same panel.
    // The ceiling comes down with it rather than being banked as headroom — the v21.87 reasoning
    // above — so the raise of ten lines survives on its merits and the saving of seventy-six is
    // not quietly spent.
    // 2370 → 2372 at v25.09, a RAISE, said so. The file stood at exactly its cap, so "Keep only the
    // shortlist" could not add a single line here — and it did what the note below asks: the RULES
    // went into links-shortlist.js and the press, with its ··· More row, into links-design-library.js
    // beside import and the bin. What is left is the one hook the press needs from the coordinator,
    // because only the coordinator owns the live list and the open design. The cap is the measured
    // size, so the next addition is a raise too.
    // 2371 → 2399 on 7 Nov 2026 (iPhone audit), a RAISE: the unsaved-work draft's wiring — keep the open design and its baseline on a hide, offer and restore them; the rules went to unsaved-draft.js.
    // 2399 → 2380 the same day (desktop audit), brought DOWN with the code that left: the grid's input — its clicks, the keyboard's one Tab stop and a mouse's paint stroke — went to links-grid-input.js.
    // 2380 → 2750 in the whole-app fix (Nov 2026), a RAISE, said so: measured at 2654, plus 50, to the next 50. What it
    // bought is COORDINATION the page alone can do, because only it holds the working copy: a create, copy or delete that
    // lands late re-checks whether the page has moved on before it opens anything; nothing makes a design until the list
    // is in; the Build press says it is building; and the wiring the
    // store, the header and the library asked for (the cache's own read, `activeId`, the queued pill, the gone design's
    // bin row). About half is the argument beside each. The rules went out: the wording of a delete or rename that found
    // the design gone to links-deletion.js, a create's bound to links-design-store.js, the pill's words to
    // links-design-header.js. The next Links rule still goes in a domain module.
    'links-app.js':            2750,   // ← whole-app fix, Nov 2026 (2380 at v25.27; 2372 at v24.51, was 2650)
    // 2600 → 2650 at v23.33, and the reason is the ZERO-HEADROOM state this suite's own header
    // calls out: the file stood at exactly 2,600 of 2,600, so ANY one-line fix to the Links
    // coordinator failed here — a guard that fires on a bug fix teaches people to raise the cap
    // without reading it. What it is spent on is two of those: the ··· sheet's Rename row is now
    // handed to the masthead for its disabled state, and a declined design switch now re-renders
    // the picker. Five lines, both wiring, neither a rule — the rules and their reasoning went
    // into links-design-header.js, which is where the three-homes discipline puts them. The room
    // is the header's own 50-line allowance so the next small fix is not blocked in turn.
    // 2000 → 1900 at v21.89. The sticky take-home bar left for paycalc-sticky-total.js — 1,988
    // measured lines down to 1,888. Of everything in this coordinator it was the piece whose
    // removal cannot affect a figure a member reads: a scroll-position widget that touches no
    // money, no period and no storage.
    // 1900 → 1880 at v22.56, and the saving is smaller than it looks for a reason worth recording.
    // The file was at 1,900 of 1,900 — the zero-headroom state this suite's own header calls the
    // case that gets a guard waived — and the external review of v22.55 said the next change here
    // must be an extraction. Two went: the RESULT HEADLINE (paycalc-result-headline.js) and the two
    // OPT-IN MONEY BANNERS (paycalc-money-banner.js), 1,900 measured lines down to 1,828. Neither
    // was chosen for its size. Both were two parallel branches writing the same targets — an actual
    // against an estimate, a sum included against a sum merely available — which is the one shape
    // whose failure is silent, and both now carry the invariant plus the tests that hold it.
    // 1880 → 1884 at v25.47, a RAISE, said so. The file stood at exactly its cap, so the Year to
    // Date line under the take-home £ (owner, 7 Nov 2026) could not add a line here. Its RULE went
    // into `ytdUpdateFrom` (paycalc-periods.js) and its DOM writes and button into
    // paycalc-result-headline.js, beside the other words under the figure. What is left is the hook:
    // one call that hands calculate()'s own facts (the period, whether the cumulative method ran,
    // the tax code it read) to the rule, a comment, and the button's wiring at init. The cap is the
    // measured size, so the next addition is a raise too.
    // 1884 → 1600 on 8 Nov 2026, brought DOWN with what left (1,882 measured lines to 1,539): the loan
    // rows and the share-of-pay bar (paycalc-breakdown.js), the Year to Date card's note, chip and
    // load-time stamp and the one payslip-list builder (paycalc-periods.js), one rate for the field
    // and the Settings summary (paycalc-settings.js), the stored prior-year HPP (paycalc-hpp.js) — and
    // the comments that had become a changelog, each cut to the reason it left behind.
    'paycalc-app.js':          1600,
    // 1727 → 486 (v21.38): the store, the week editor, the Saved Changes list and the shift-type
    // table all moved out. Re-set to its new size plus the usual room — a cap left at 1800 over a
    // 486-line file is the "quietly generous" case this suite's own last check refuses.
    // NEW TO THE TABLE at v23.81, which is the deliberate act this suite asks for rather than a
    // silent crossing. The member's availability form reached 922 lines when it gained the
    // Sunday-release control; the RULE that control needs went into `overtime-sunday-release.js`
    // (which is where its reasoning lives too), so what grew here is wiring — a render branch, a
    // change handler and a focus helper — and there is no second rule left to pull out. Bring this
    // down the moment anything else leaves the file.
    'overtime-form.js':        1000,
    'admin-overrides.js':      560,
    // **950 IS ABSOLUTE, AND THE FILE IS AT IT** (external review of v23.92, 16 Sep 2026). Zero
    // headroom is not a coincidence to be relieved with a bigger number — it is the signal this
    // ratchet exists to produce. The reviewer's instruction, adopted: *the next meaningful
    // week-editor responsibility triggers an extraction; do not raise this ceiling because the next
    // feature needs twenty lines.* v23.91 is the worked example — the AL save decision left for
    // `admin-al-week-save.js` and `admin-app.js` went DOWN rather than up. Raising this costs the
    // repo the one mechanism that has actually been shrinking Admin.
    // 950 -> 830 at v23.98. The ratchet only ever comes DOWN, and it came down here because the
    // file was AT its cap with zero headroom — which makes the next change to the Admin week grid
    // pay for an extraction before it can start, under a hard stop, where the cheapest cut wins.
    // `admin-week-row-state.js` took the cluster that needed no injected dependencies at all.
    // HELD at 830 at v24.64, not lowered: the file stood at 829 (external review, Oct 2026: "no
    // headroom"), the time boxes left for admin-time-inputs.js, and the ~40 lines that freed are
    // the headroom the review asked for — lowering the cap to the new size would hand the next
    // week-grid change the same zero it had. The ceiling still only falls.
    'admin-week-editor.js':    830,
    'admin-saved-changes.js':  460,
    // 1800 → 1700 at v21.89. The week-grid swipe left for admin-week-swipe.js — 1,783 down to
    // 1,638 — taking a pointer state machine with no business rule in it. What a week change MEANS
    // to Admin stayed here, as two callbacks. The e2e covering it was written BEFORE the move and
    // mutation-verified, because the gesture had no behavioural coverage at all.
    // 1710 → 1720 at v23.09, and this one IS the extraction the v23.08 entry said was due. That
    // entry raised the cap by ten for a two-line bug fix, left two lines of headroom, and named
    // `_renderBookedPeriods` as the candidate — so the very next change to this file had to take
    // it out, and did. The recorded-dates list is now admin-booked-periods.js, 1,708 measured lines
    // down to 1,667, and it went because it grew a RULE: which year of somebody's leave you are
    // looking at is precedence, and precedence has to be testable with no DOM. What stayed here is
    // the wiring — the handles the renderer is given, and clearing a pinned year when the member
    // changes. Re-set to the new size plus the usual room rather than left at 1710, which would
    // have been a cap tuned to the fix before it rather than the file after it.
    // 1720 → 1700 at v23.54. The four pure answers behind the booked-date lists — `addDays`,
    // `isRestGap` and the two formatters — left for admin-period-dates.js. They were nested in a
    // 1,600-line `init()` and were ALREADY being handed out of it as named collaborators to
    // admin-booked-periods.js, so the closure was the only thing keeping them un-testable.
    // The next-50 formula would give 1750 here, which is a RAISE, and a cap may only fall — so it
    // is clamped to the round number below the old one. 26 lines of room rather than the usual
    // 50–99, which is the honest cost of shrinking a file by less than the band is wide.
    // 1700 → 1731 on 7 Nov 2026 (iPhone audit), a RAISE: the week draft's wiring and the re-read on return; the rules went to unsaved-draft.js, admin-week-row-state.js and page-session.js.
    // 1731 → 1744 on 11 Nov 2026 (v25.78), a RAISE: the sign-in card's explanation, `ADMIN_SIGN_IN_ABOUT` — words
    // handed to login-overlay.js, with no rule in them to extract, and no module of Admin's about its sign-in to hold
    // them (Pay's sit beside its role card). Set at the measured size: the room was 2 lines, and stays spent.
    'admin-app.js':            1744,
    'links-design.js':         1500,   // a DOMAIN module: large is less alarming here, but still capped
    // NEW at v25.48, a decision rather than a discovery: `chunkByWrites` (the range booking's batches,
    // counted in writes so none crosses Firestore's 500) took it from 900 to 928. It joined the other
    // override WRITE helpers (`buildOverrideWrite`, `buildOverrideCacheRecord`) because it is the same
    // kind of rule, pure and shared by every save path that wants it; admin-overrides.js, the caller,
    // is at its own cap. A pure DOMAIN module like links-design.js, so capped where it stands.
    'override-utils.js':        928,
    // 1350 → 1100 at v21.90. The three date-keyed document collections left for
    // documents-client.js — 1,308 measured lines down to 1,033 — taking the upload SEQUENCE with
    // them: signature check, versioned path, and what a failed or ambiguous commit does to the
    // file. That sequence had been sitting between the auth bootstrap, the push writers, the
    // password timestamps, the analytics counters and the error log, in the one module that cannot
    // load in Node, so none of it could be tested. Injecting the Firebase handles fixed both.
    // 1100 → 900 at v24.64 (external review, Oct 2026: "no headroom"). The error log and the usage/
    // speed counters left for analytics-client.js — 1,099 measured lines down to ~855 — the one block
    // here with no tie to authentication, and the same injected-handles shape documents-client.js
    // took at v21.90, so it now runs in Node against a fake Firestore.
    'firebase-client.js':       900,
    // NEW at v24.84, a decision rather than a discovery: the station PIN reads the Trains page, and
    // the two viewer transitions that took (`holdsStaffPin`, `signOutStaffPin`) carried session.js
    // from 874 lines to 925. They sit beside `reconcileExpiredIdentity` and `shedCalendarViewer` on
    // purpose — when the PIN is kept and when it is shed must be answered in ONE module, because a
    // second home is a second place a bypass could be introduced. Measured 925, plus the headroom.
    // 1000 → 1002 on 11 Nov 2026 (v25.78), a RAISE of wiring only: the sign-in fixes (v25.77) had
    // filled the file to its cap, and the staff-PIN notice's RULE was EXTRACTED to staff-pin-ended.js
    // rather than added here. What stays is its import and the one call made once the sign-out of
    // the viewer has landed — which can only be made where that sign-out is.
    'session.js':              1002,
    // 1300 → 1350 at v21.29, deliberately and after extracting first. The page-ready fix added the
    // surface-selection logic, the cache-first-paint race and their reasoning; the RULE it carried
    // ("is a roster on screen?") went to calendar-data-state.js as `showsRoster`, beside the four
    // states it reads. What is left is coordination and the argument for it, which is what this
    // file is for. The guard did its job: it made the extraction happen before the raise.
    // 1350 → 1320 at v23.16. The file stood at 1,346 — four lines of room — and an external review
    // said the next Calendar concern should extract rather than raise. It did, BEFORE the concern:
    // the notification prompt strip and silent renewal (an IIFE that closed over nothing the
    // coordinator owns) left for calendar-notif-prompt.js, 1,346 down to 1,267. The ceiling comes
    // down with it rather than banking eighty lines as headroom, per the header's rule.
    'calendar-app.js':         1310,
                                       //   ← 1320 until v23.69, when the month LEGEND left for calendar-legend.js (1264 now)
    'roster-data.js':          1250,   // mostly data, not logic
    // 1360 → 1250 at v23.31, and this is the entry below FINISHING rather than another raise. That
    // note said the file's length "tracks HEADCOUNT, so it will cross again on a future starter,
    // and that is not drift" — a correct diagnosis that leaves the guard unable to do its job: a
    // cap that has to be raised on hiring cannot also be watching for complexity, and each raise
    // makes the next one obviously fine. So the rows left, to `roster-member-data.js`, exactly as
    // the week patterns did to `roster-cycle-data.js`; `teamMembers` is re-exported from here so
    // no consumer moved. The ceiling comes down with the 123 lines rather than banking them as
    // headroom, per the header's rule, and what it now measures is the BEHAVIOUR around the table.
    // A new starter no longer touches this file at all.
    // 1350 → 1360 at v23.26, and this raise is a DIFFERENT KIND from the two below it. Those were
    // rules that had grown into a data file, and each was answered by asking whether the rule could
    // leave first. This one is a PERSON: a new starter (I. Melikian) is one `teamMembers` entry plus
    // the traps specific to it, and there is nowhere else a roster row can live. The file's length
    // tracks HEADCOUNT, so it will cross again on a future starter, and that is not drift.
    // Ten lines, not fifty — enough for the entry that caused it and no bank of headroom. The
    // comment was cut to what is unique to that entry first (nine lines of it restated the shared
    // fixedRoster warning and the AL history, both of which already live elsewhere), which is the
    // three-homes rule doing the work the ratchet usually gets credit for.
    // This argument licenses DATA only. A business rule arriving here still has to leave.
    // 1300 → 1350 at v22.50, and the extraction was CHECKED FOR FIRST rather than waved away. The
    // change underneath is a leave-entitlement correction — a Dispatcher's earned lieu days were
    // being discarded by their joining year's pro-rata — which is a business rule, exactly the kind
    // of thing this ratchet exists to push out of a large file.
    //
    // So: could `getALEntitlement` leave? It is a RULE living in a DATA module, `al-entitlement.js`
    // already owns "where a member's entitlement leaves them", and it already imports this function,
    // so the dependency would invert cleanly and roster-data would drop ~25 lines below the old cap.
    // Everything about that says do it.
    //
    // It cannot. `countDispatcherBankHolidaysWorked` is module-private here and reads the base
    // roster; taking the rule out means either exporting that helper or dragging it along, and a
    // roster-reading helper belongs with the roster data. The move would trade a rule in the wrong
    // module for a data-reader in the wrong module, which is not a payment, it is a swap.
    //
    // Recorded because the header warns that raising a cap becomes the quickest way past a red test.
    // The seam is real and stays available the day the bank-holiday count is worth extracting on its
    // own terms; it is not worth inventing to fit twelve lines through a gate.
    // 1250 → 1300 at v22.16, deliberately and AFTER extracting first — which is the whole point of
    // the ratchet and it worked exactly as designed here. Failing closed on a shifted roster read
    // took the file to 1385, and the 135 lines were not all coordination: the drift detector, the
    // block threshold and the batch-signature verdict are a RULE about whether a read can be
    // trusted, so they left for roster-alignment.js. A second payoff the ratchet did not promise —
    // that module imports no Firebase, so the detector now loads in Node and a test can build a
    // shifted-week fixture from the real roster instead of hard-coding names that go stale.
    // What remains above the old cap is review UI: the refusal banner, the inert ticks, the
    // outcome branch, and the control that reaches the original PDF. That is what this file is for.
    // 1150 → 1200 at v24.61 — a RAISE, said so. The keypad shaping (one line and its comment) landed
    // on a file two lines under its cap, which is the zero-headroom state the header warns about and
    // the one this file has now reached twice. The seam named above is still the way down.
    // Stays at 1200 at v25.46. The import's abort timer became a named constant (+10, which took
    // the file OVER its cap), and the Save collector then left for roster-review-states.js
    // (`collectRosterWrites`, -47): pure, Firebase-free, and the only form of it a test can run.
    // 37 lines of room again. The setting rule would put a fresh cap at 1250, so it does not move.
    // Stays at 1200 at v25.92: the Save left for roster-import-save.js (1176 → 1120, its refusal
    // handling staying here). The setting rule puts a fresh cap for 1120 at 1200, so it does not move.
    'admin-roster-upload.js':  1200,
    // 1300 → 1150 at v23.52 — a cap coming DOWN, which is the direction this mechanism is for and
    // the one it had not yet demonstrated. `computeCellStates` left for roster-review-states.js:
    // ~206 lines that touch no DOM, hold no state, and decide what a Save writes. It was the second
    // time this file stood at EXACTLY its cap with zero headroom, and the fix the first time was to
    // raise it; the seam was there on both occasions. The ceiling travels with the code — a cap
    // left at 1300 would have banked 216 lines as future headroom, which is this guard loosening
    // while appearing to hold.
    // 1250 → 1300 at v23.41, and this is the SECOND cap raised on one branch — which is worth
    // saying rather than burying, because a ratchet raised twice quietly is a ratchet nobody
    // believes. Both are the same shape: a file sitting EXACTLY on its cap, and a change that is a
    // fix rather than a feature. Here it is ~17 lines, almost all of it the reasoning for two
    // defects the nav review found — an access refusal reported as a bad signal, and a re-expanded
    // Reference section un-hiding the list a search had filtered.
    // **The seam is named, and it is a good one:** the App Notices ARCHIVE — `archiveNotice`,
    // `isNoticeExpired`, `_parseNoticeDate`, `NOTICES_KEY`, `ARCHIVE_EXPIRY_DAYS` and the rendering
    // in `_openNotices` — is ~120 lines of RULE (what the archive holds, how long, how a legacy
    // record migrates) living in a drawer coordinator. Both of those functions are already exported
    // and imported by page modules that never touch the drawer's DOM, and both are already tested;
    // they would move to a pure module and load in Node. Deliberately NOT done in a bug-fix pass on
    // the nav panel, where a rename touching seven pages is the regression the pass exists to avoid.
    // 1300 → 1350 at v24.61 — a RAISE, said so. The iOS audit's B5 added fourteen lines of wiring to
    // `_openLatestDoc` (no tab came back → the in-app viewer, not the storage origin) to a file that
    // stood at EXACTLY its cap. Nothing in those lines is a rule a Node test could hold, and the
    // extraction named above is the way DOWN — it is still the right one, and still not for a pass
    // whose subject is somewhere else. Lower this again when the notices archive leaves.
    // 1350 → 1352 at v25.33 — a RAISE of two lines: the New link pill's own gate (S. Silva may preview the page), one
    // filter in the chain and its parameter's type. page-contract-parity derives the gates FROM that chain, so the
    // filter cannot fold into another line without hiding the gate from the check that keeps it honest.
    // 1352 → 1300 (Nov 2026, at 1,248) — the extraction named above, done: the App Notices archive's rules left for
    // notice-archive.js (re-exported, so no page's import moved), and the drawer's thrice-told history became one telling.
    'nav-panel.js':            1300,
    // 965 → 1020 at v23.40, and the word is RAISE rather than extract, which the note above says
    // should be justified. What consumed the headroom was v23.38's select-sheet sweep, filling the
    // file to EXACTLY 965; what needs the five lines now is not a feature but an accessibility fix
    // — `focusGradeFilter`, which puts focus on the enhanced select's trigger instead of on the 1px
    // `aria-hidden` value holder the enhancement left behind. That is the class of change the
    // ratchet's standard headroom exists for, and refusing it would make the guard argue for
    // shipping a keyboard trap. **The extraction the note above asks for is now OVERDUE and has a
    // name:** the Account-status card is ~330 lines of this file, owns its own reads, its own
    // filter, its own row rendering and the reset break-glass, and is the obvious next seam.
    // 1020 → 920 in Oct 2026, a LOWER: the App Speed review needed four lines of help text in a file
    // at its cap to the line, and the answer was EXTRACT — the help panels are content, and moved to
    // operations-tips.js as Links, Overtime and Trains had done (−152). The ceiling comes down with
    // them, to the usual headroom over 875, rather than banking the saving. The Account-status seam
    // above is still the next one.
    // 920 → 837 on 13 Nov 2026, a LOWER, to the measured size: the sign-in audit's lost-phone Reset (D1)
    // and its two outcome fixes (E2, the 500's sentence) were RULES — what a reset may claim — so EXTRACT: every word the
    // Reset asks and says left for operations-reset.js, and the doReset that stayed only asks and wires.
    'operations-app.js':        837,
    // Crossed the 900 uncapped-file threshold at v22.03 (914 measured): the Needs-attention strip
    // added ~14 lines of pure WIRING — the strip module owns every rule, the coordinator only
    // creates it and feeds it from the loads the cards already run. Capped as the ratchet asks
    // (a decision, not a discovery), with the standard fix-sized headroom. The next real feature
    // on this page should extract a card, not raise this number.
    // 1250 → 750 at v21.88. The REVIEWER's workspace left for overtime-review-controller.js —
    // 1,246 measured lines down to 698 — and it took all eight pieces of reviewer state with it.
    // A cap left at 1250 would bank 550 lines as headroom on the file the note below calls the one
    // that matters most, which is the ratchet loosening in the place it was tightest.
    //
    // The page still holds BOTH surfaces deliberately (overtime.html). What is left here is the
    // member's side plus the page's own chrome, and if it grows again the next seam is the member
    // controller — but only once the member path warrants one, not to make a number smaller.
    // 750 → 762 on 7 Nov 2026 (desktop audit), a deliberate RAISE: the tab strip is this file's own declared subject, and the
    // growth is its WIRING — the panels are tabpanels and Tab stops only while the strip shows — which no Node test could hold
    // (e2e/overtime.spec.js does), plus the paused card's own title.
    'overtime-app.js':          762,   // the young one — this is the cap that matters most
    // NEW at v24.71 with the page, at its measured size plus the standard fix-sized headroom. Every
    // judgement about the timetables is trains-change.js; growth here should be rendering only.
    // 330 → 400 at v24.84, a deliberate RAISE: the station PIN reads the page now, and what that
    // added here is wiring — a second way into `start`, and the member-only steps it skips. The RULE
    // (keep the PIN, shed any other stale identity, a member outranks it) went to session.js as
    // `holdsStaffPin`, where session.test.mjs holds it; measured 350, plus the standard headroom.
    // 400 → 450 at v24.92, the measured UX pass, after a SPLIT: the fixed copy of the grid's column
    // heads — DOM measuring, no coordinator state — left for trains-grid-mirror.js, and what stayed
    // is wiring (the picker folding away, a grid column pressed, the overview folding from the
    // second visit) whose every judgement is in trains-render.js or trains-stations.js. Measured
    // 410 with the mirror gone — ten lines over, which is the headroom the v24.84 raise left
    // having been spent by two releases of wiring. Measured + 50, rounded to the next 50.
    'trains-app.js':            450,
    // NEW at v24.92: crossed LARGE_THRESHOLD (929) when the headlines gained their lead, detail and
    // chip and the grid its two line bands (`stationBands`). Pure and tested throughout, so the size
    // is the domain's, not a coordinator's — but the seam is plain if it grows again: the headline
    // builder (`headlineChanges` and `foldSameTrains`, ~230 lines) is a module of its own waiting to
    // be cut, the same shape as trains-change.js. Measured + 50, rounded to the next 50.
    'trains-stations.js':      1000,
    // NEW at v21.93, and the ratchet asking for a decision is exactly why it is here rather than
    // discovered later. The member form's three rules — completeness, the timed-out-submit verdict,
    // and whose write a 409 refuses — moved out of `overtime-form.js`, where they sat inside a
    // closure that no Node test can reach (the form needs a real DOM, and adding a DOM library to
    // this repo is a dependency decision, not a testing one).
    //
    // They landed HERE rather than in a fourth Overtime module because ownership, not line count,
    // is the split rule: `submitDisposition` and `clockOffset` already live in this file and are
    // the same kind of statement — a pure decision the client makes about a submission. A new
    // 100-line module that every consumer imports alongside this one would be a split for the sake
    // of a number, which the note at the top of this file says the ratchet must not become.
    //
    // The cap is 1050 against 955 measured. If this file needs raising again, the seam to take
    // first is the WORDS — `phaseCopy`, `rowStateCopy`, `countsCopy`, `submitFailureCopy` and the
    // rest are a coherent subject and the largest single one in here.
    // +20 at v23.31 for `printedLabel`. The note below said the WORDS are the seam if this ever
    // needs raising, and this raise is the words: a printed availability sheet needed its own
    // timestamp shape (with a year, which a deadline must not carry), and a module whose whole job
    // is putting Overtime into words is where that belongs. Twelve lines of room, no bank.
    // 1030 → 950 at the v24.28 review: measured 888, so the old ceiling had banked 142 lines of
    // headroom the file never needed — the loosening the v21.87 note above refuses.
    'overtime-format.js':       950,   // ← 1070 until v23.69, when the CLOCK left for overtime-clock.js.
                                       //   The words are the seam if this needs raising again
    // 1200 → 1250 at v21.54, and this one is a RAISE rather than an extraction, which the note
    // above says must be argued rather than assumed. The growth is the same-week read guard from
    // the external review — a generation ticket around one `await`, so that a slow earlier read
    // cannot paint beneath a faster later one's "as at" time — plus the paragraph explaining it.
    // There is no "it must…" to lift out: the property is an ORDERING between two async calls in a
    // coordinator, and what pins it is an e2e mutation test, not a Node one. The only genuine
    // extraction candidate, the create/confirm bar, closes over six coordinator locals, so moving
    // it would thread dependencies rather than separate subjects. Headroom is deliberately 44
    // lines and not the usual 50–99: this file is under active development and the next raise
    // should be visibly a THIRD one.
    // 1150 → 200 at v21.32. It was one edit from refusing, and the response was SPLIT: no rule was
    // in there to extract (the maths is in perf-stats/usage-stats/client-errors), just three
    // unrelated cards sharing a file. What is left is the shared helpers and nothing else — there
    // is deliberately NO re-export barrel; the first cut had one and import-graph.test.mjs refused
    // it as a cycle, so operations-app.js imports each card from its own file.
    'operations-reports.js':    200,
    // 1000 → 1050 at v22.94, and the response word is RAISE. The growth is a message handler that
    // answers `perf-reporter.js` with the number of background revalidations this worker has
    // started — wiring, plus the two rules an edit must not break (a COUNT never a URL, and
    // read-only). There was no third response available: the RULE half, the count bands, is already
    // extracted into `perf-stats.js` and tested there, and `_revalidationCount()` was pulled out
    // and named precisely so `sw-internals.test.mjs` could run the worker's own code — which it now
    // does, after a mutation to a constant survived everything else.
    // Headroom is deliberately 45 and not the usual 50–99: this is the highest-outage-risk file in
    // the repo, and its previous cap left five lines, which was a tighter statement than the
    // convention on purpose. Bring it back down the moment anything leaves this file.
    // 1050 → 1100 at v24.61 — a RAISE, said so. The iOS audit's B3 (a document cache-miss races the
    // cache only when a cached fallback EXISTS; the offline page gains a "Try again" link) and B4
    // (`pushsubscriptionchange`) are fetch-handler logic and an event handler in a CLASSIC worker,
    // which can import nothing, so there is nowhere for them to go; the prose that could leave was
    // moved to AI_MAP and notifications.md before this number moved. Headroom stays below the
    // convention, as the paragraph above asks.
    // 1100 → 1095 in Oct 2026, a LOWER, as asked: the App Speed review retired the revalidation
    // count and its message reply (the count was the worker process's, not one page's), and 13 lines
    // left. The cap follows them down rather than keeping their room for the next addition.
    // 1095 → 1096 at v25.50, a RAISE of exactly one line: the precache entry for
    // `paycalc-role-card.js`. Every module the app serves must be in CORE_ASSETS or it is missing
    // offline, the list is one entry per line, and nothing else in the worker grew — so there is no
    // logic to extract and no room kept for the next addition.
    // 1096 → 1097 at v25.67, a RAISE of exactly one line: the comment on the docs/ pass-through. The rule itself rides on
    // the same-origin line; the New link pack's PDFs, which the in-app viewer reads, must reach the network rather than
    // sit in the release's cache, and nothing else in the worker grew.
    // 1097 → 1094 in Nov 2026, the cap coming down with the file. Release C's merge with v25.67 dropped C's own docs/
    // block, four lines that main's same-origin line now carries, and release D added one: the precache entry for
    // `legacy-redirect.js`, the one script the two legacy guide stubs carry (owner, 10 Nov 2026), whose reasoning
    // lives in its own header. Left at 1097 the cap would bank three lines as headroom.
    // 1094 → 1095 at v25.92, a RAISE of exactly one line, as at v25.50: the precache entry for
    // `roster-import-save.js`, the weekly import's Save, which left admin-roster-upload.js for a module
    // of its own. Every module the app serves must be in CORE_ASSETS, one entry per line, and nothing
    // else in the worker grew.
    'service-worker.js':       1095,
    // Crossed 900 at v21.62 (measured 910), when the silent re-establishment moved from behind the
    // member card to behind the boot skeleton — the growth is the boot ORDERING and the argument
    // for it, which is this module's one subject: what to show while access is being decided. The
    // RULES the file consults already live in calendar-access-core.js (pure, tested); what remains
    // is the gate's stagecraft, and a Node test cannot hold an ordering between paints. If this
    // grows again, the candidate to extract is the panel-building trio (lock card / member card /
    // skeleton) as a presentation module — they share only `_panel` and the host lookup.
    // RAISED at v22.97 (measured 1006) for the provisional paint — the owner-approved cached-roster
    // fast path. A raise and not an extraction, deliberately: the extraction named above is a real
    // refactor of the highest-outage-risk boot path in the app, and doing it in the same commit as
    // a change to what the Calendar may SHOW would put two independent risks behind one review. The
    // candidate stands and is now overdue. What landed here is wiring only — the decision, the
    // preconditions and the whole safety argument are in calendar-access-core.js, tested in Node.
    // 1055 → 850 at v23.54. The three CARDS this gate can put where the Calendar goes —
    // the member sign-in front door, the staff PIN behind it, and the member's come-back card —
    // left for calendar-lock-cards.js with `hideLockPanel` and the unlock form's backoff, 1,053
    // measured lines down to 756. A SPLIT, not an extraction: no rule came out, because the rules
    // were never in the cards. This file's own header already said "Does NOT own: ... any
    // rendering" while about a third of it was card markup, so the seam was one the module had
    // already described and nobody had cut. The security properties did NOT move — the persistence
    // order and the claim verification are still here — and the ceiling comes down with the code.
    // 850 → 750 on 26 Sep 2026: the provisional paint the v22.97 raise was for was RETIRED (owner
    // decision), taking ~100 lines of wiring with it (measured 667 after).
    'calendar-access.js':      750,
    // Crossed 900 at v21.85 on a ONE-LINE import — `setStatus`, so the four back-pay notices stop
    // announcing their leading glyph. It had been sitting at exactly 900 since v21.82, when the
    // response to the same pressure was to trim a comment of my own rather than raise the ceiling;
    // there is nothing left to trim that a reader would not miss. Headroom is 49 lines and not the
    // usual 50–99 deliberately: nothing in this file has grown for a reason of its own in three
    // releases, so the next raise should have to argue for itself. The extraction candidate is
    // `bpStoryHtml` — a pure HTML builder with no coordinator state, and the same shape as the
    // split that produced paycalc-breakdown.js.
    'paycalc-backpay.js':       949,

    // ── functions/ — capped for the FIRST TIME at v23.54, at their measured sizes ───────────────
    //
    // See SCANNED_DIRS above for why they were never here. Each is the size it was on the day the
    // scan first reached it, plus the usual room; none is an accusation, and the two domain files
    // are large because the domains are.
    'functions/roster-parse-helpers.js': 1400,   // ← 1,351 and named "helpers": 35 exports, and the
                                                 //   day-drift defence is among them. The clearest
                                                 //   candidate in this block for a rule to leave.
    'functions/overtime.js':             1400,   // the Overtime endpoints + Firestore orchestration
    // SPLIT at v24.14, at 1,150 of 1,150 — the ZERO-HEADROOM state this file's own header names as
    // the point where a guard stops being read and starts being raised. The London clock and the
    // ISO-date algebra left for functions/london-clock.js: 1,150 measured lines down to 1,076.
    //
    // The classification is SPLIT, not EXTRACT. No new rule came out — the file was doing two
    // unrelated jobs, and only one of them is Overtime's. "What is the UTC offset in London at this
    // instant" is the same answer for anybody who asks and would still be true if this feature were
    // deleted. What stayed is every hour this depot CHOSE: noon for a deadline, midnight for
    // retention, 05:00 for the scheduler, and the Sunday→Saturday roster week.
    //
    // THE CAP DOES NOT MOVE, and that is the formula rather than an oversight: measured + 50 rounded
    // up to the next 50 is 1,150 for a 1,076-line file. The point of the split was never the number.
    // It was the headroom, which goes from 0 to 74 — back inside the 50–99 band this file's header
    // says every capped module is owed, so the next one-line Overtime fix no longer fails here.
    'functions/overtime-core.js':        1150,   // every Overtime RULE, already pure and tested
    'functions/index.js':                1100,   // the composition root; its exports ARE the deploy surface
    // NEW at the v24.28 review, three lines under LARGE_THRESHOLD (897): the auth endpoints — the
    // PIN exchange, the password reset, account set-up — are the security-sensitive half of the
    // Functions, and a module that close to the line would otherwise cross it with nobody deciding
    // anything. Capped now so crossing is a decision. Measured + 50, rounded to the next 50.
    // 950 → 750 in Nov 2026, at 949 of 950 with the sign-in audit's account fixes still to land: the
    // public reset-request doorbell — its constants, its throttle, its admin push — left whole for
    // functions/reset-request.js (659 measured after). A SPLIT: the file did two jobs, and the
    // doorbell shared nothing with the account handlers but the roster and the transport. The
    // ceiling comes down with the code, measured + 50 rounded to the next 50.
    'functions/auth-endpoints.js':        750,
    // NEW at v25.88, when the document-link rotation's door joined (885 → 937). Its RULES left for
    // functions/doc-link-rotation.js before they arrived — pure, and tested in the no-install lane —
    // so what crossed the line is an endpoint: method, admin check, body, the 503, one log line. The
    // documents domain hosts its doors, as auth-endpoints.js hosts the account ones. Measured + 50,
    // rounded to the next 50.
    // 1000 → 950 at v25.89: the Huddle retention — the 3-month prune and what it may delete — left for
    // functions/huddle-retention.js (861 measured, so back under LARGE_THRESHOLD). Brought down with the
    // code, as the rule above asks; kept rather than dropped, so crossing 900 again is still a decision.
    'functions/documents.js':             950,

};

describe('an already-large module may not get larger', () => {
    for (const [file, cap] of Object.entries(CAPS)) {
        test(`${file} stays within ${cap} lines`, () => {
            const n = lines(file);
            assert.ok(n <= cap,
                `${file} is ${n} lines, over its ${cap}-line cap.\n\n`
                + 'Coordinators coordinate; domain modules decide. If this growth is a business RULE,\n'
                + 'it belongs in a module of its own where it can be tested without a DOM. If it is\n'
                + 'genuinely coordination, and the file has earned the room, raise the cap deliberately\n'
                + 'and say why in the commit.');
        });
    }

    test('every large module is IN the table — a new one is a decision, not an accident', () => {
        const untracked = SCANNED_DIRS
            .flatMap(dir => readdirSync(new URL(dir, here))
                // Root entries keep their bare name, because that is how the table spells them
                // and a key that does not match is a file this guard silently stops watching.
                .map(f => (dir === './' ? f : dir + f)))
            .filter(f => /\.js$/.test(f) && !f.includes('.test.'))
            .filter(f => !(f in CAPS))
            .filter(f => lines(f) > LARGE_THRESHOLD);
        assert.deepEqual(untracked, [],
            `these modules have crossed ${LARGE_THRESHOLD} lines and are not capped:\n  `
            + untracked.map(f => `${f} (${lines(f)})`).join('\n  ')
            + '\n\nAdd them to CAPS if that is intended — but a module becoming large should be a\n'
            + 'decision somebody makes, not something discovered later.');
    });

    test('and the caps are not quietly generous', () => {
        // GUARD THE GUARD. A cap far above the file it governs enforces nothing, and would let this
        // whole suite pass while the thing it exists to prevent happened. 200 lines of slack is well
        // beyond the next-50 rounding, so it can only mean a cap was raised and the file then shrank
        // — in which case the cap should have come down with it.
        const slack = Object.entries(CAPS)
            .map(([f, cap]) => [f, cap - lines(f)])
            .filter(([, gap]) => Number(gap) > 200)
            .map(([f, gap]) => `${f} has ${gap} lines of slack`);
        assert.deepEqual(slack, [], 'a cap has drifted above its file:\n  ' + slack.join('\n  '));
    });
});
