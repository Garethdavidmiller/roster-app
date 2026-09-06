/**
 * coordinator-ratchet.test.mjs — an already-large module may not get larger.
 * Run: node --test coordinator-ratchet.test.mjs   (part of `npm run test:hygiene`)
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
 * feature going straight back into the big file. `links-app.js` is 3,200 lines.
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
 * Caps are the measured size PLUS 50, rounded up to the next 50 — so every file carries 50–99 lines
 * of room. Enough to fix a bug, add a comment or re-wire a call; nowhere near enough for a business
 * rule. Line count is a PROXY for the rule at the top of this file, and the proxy is only honest if
 * it leaves room for the work that does NOT violate the rule.
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
    'links-app.js':            2600,   // ← the next Links rule goes in a domain module
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
    'paycalc-app.js':          1880,
    // 1727 → 486 (v21.38): the store, the week editor, the Saved Changes list and the shift-type
    // table all moved out. Re-set to its new size plus the usual room — a cap left at 1800 over a
    // 486-line file is the "quietly generous" case this suite's own last check refuses.
    'admin-overrides.js':      560,
    'admin-week-editor.js':    950,
    'admin-saved-changes.js':  460,
    // 1800 → 1700 at v21.89. The week-grid swipe left for admin-week-swipe.js — 1,783 down to
    // 1,638 — taking a pointer state machine with no business rule in it. What a week change MEANS
    // to Admin stayed here, as two callbacks. The e2e covering it was written BEFORE the move and
    // mutation-verified, because the gesture had no behavioural coverage at all.
    'admin-app.js':            1700,
    'links-design.js':         1500,   // a DOMAIN module: large is less alarming here, but still capped
    // 1350 → 1100 at v21.90. The three date-keyed document collections left for
    // documents-client.js — 1,308 measured lines down to 1,033 — taking the upload SEQUENCE with
    // them: signature check, versioned path, and what a failed or ambiguous commit does to the
    // file. That sequence had been sitting between the auth bootstrap, the push writers, the
    // password timestamps, the analytics counters and the error log, in the one module that cannot
    // load in Node, so none of it could be tested. Injecting the Firebase handles fixed both.
    'firebase-client.js':      1100,
    // 1300 → 1350 at v21.29, deliberately and after extracting first. The page-ready fix added the
    // surface-selection logic, the cache-first-paint race and their reasoning; the RULE it carried
    // ("is a roster on screen?") went to calendar-data-state.js as `showsRoster`, beside the four
    // states it reads. What is left is coordination and the argument for it, which is what this
    // file is for. The guard did its job: it made the extraction happen before the raise.
    'calendar-app.js':         1350,
    'roster-data.js':          1350,   // mostly data, not logic
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
    'admin-roster-upload.js':  1300,
    'nav-panel.js':            1250,
    'operations-app.js':        965,
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
    'overtime-app.js':          750,   // the young one — this is the cap that matters most
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
    'overtime-format.js':      1050,   // ← the words are the seam if this ever needs raising
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
    'service-worker.js':       1050,
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
    'calendar-access.js':      1055,
    // Crossed 900 at v21.85 on a ONE-LINE import — `setStatus`, so the four back-pay notices stop
    // announcing their leading glyph. It had been sitting at exactly 900 since v21.82, when the
    // response to the same pressure was to trim a comment of my own rather than raise the ceiling;
    // there is nothing left to trim that a reader would not miss. Headroom is 49 lines and not the
    // usual 50–99 deliberately: nothing in this file has grown for a reason of its own in three
    // releases, so the next raise should have to argue for itself. The extraction candidate is
    // `bpStoryHtml` — a pure HTML builder with no coordinator state, and the same shape as the
    // split that produced paycalc-breakdown.js.
    'paycalc-backpay.js':       949,
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
        const untracked = readdirSync(here)
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
