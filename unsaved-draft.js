// @ts-check
/**
 * unsaved-draft.js — a copy of unsaved work, kept on this device for the moments a page goes away
 * without asking (iPhone audit, Nov 2026).
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────────────────────────
 *
 * iOS never shows the browser's "Leave page?" (`beforeunload`), so `warnOnUnload` protects nothing
 * on an iPhone; iOS also discards a page it has put in the background whenever it wants the memory;
 * and a swipe back, or away to another app, asks nothing on any phone. The in-page questions — the
 * drawer, the About panel, the logo, sign-out — cover the exits the app draws itself. These are the
 * ones it does not, and the Links grid and Admin's staged week lived only in memory through all of
 * them: the member came back to a page that had quietly started again.
 *
 * So when the page becomes hidden WITH unsaved work, a copy goes into localStorage
 * (`keepDraftWhenHidden`, page-session.js), and the next load by the SAME signed-in member asks
 * "Restore your unsaved changes from 14:20?" before anything is put back.
 *
 * ── THE RULES ───────────────────────────────────────────────────────────────────────────────────
 *
 *   1. NEVER APPLIED SILENTLY. A draft is offered, and only Restore puts it back; Discard deletes it.
 *      Putting the question away unanswered — a tap outside it, Escape, Android Back — is neither:
 *      the question arrives a moment after the page, so a tap meant for the page lands on its
 *      backdrop, and that must not delete the work. The draft waits and is asked about next load.
 *   2. NEVER ACROSS MEMBERS. One slot per page per signed-in member: the key carries the name, and a
 *      read refuses a draft whose stored name is not the reader's, so a colleague signing in on the
 *      same phone is offered nothing. An ANSWERED sign-out or leave keeps nothing either: the member
 *      chose to discard (`keepDraftWhenHidden`, page-session.js).
 *   3. IT MIRRORS THE UNSAVED STATE AT THE LAST HIDE. Hidden while dirty writes it; hidden while
 *      clean deletes it, which is what clears it after a save, a discard, or a design switched away
 *      from; a save clears it at once as well, and Restore and Discard both delete the copy they
 *      answered — that copy only, as another tab may have kept a newer one while the question waited
 *      (`dropIfStill`, external review, 14 Nov 2026). The one thing
 *      a clean hide may NOT delete is a draft an EARLIER page life left that has not been answered
 *      yet — the page can be hidden while it is still loading the data its offer waits for — or one
 *      ANOTHER TAB kept (v26.03): each page life marks what it keeps (`life`), and `forget` deletes
 *      only its own. A clean tab once deleted the copy a second tab had just kept of work that
 *      existed nowhere else. A draft from before the mark carries none, and is forgotten as before.
 *   4. A DAY, THEN GONE. A draft older than `DRAFT_MAX_AGE_MS` — or dated in the future, whose age
 *      cannot be judged — is not offered, and is deleted when it is read. Every page that keeps
 *      drafts also sweeps such drafts away for EVERY member when it opens, because one is otherwise
 *      read only by its own member on its own page: a colleague's staged week, left on a shared PC by
 *      somebody who never opened that page there again, stayed in storage for good.
 *   5. A DRAFT IS WORK, NOT A DECISION. What it puts back is unsaved again, and saving it asks the
 *      page's own questions. Links restores the concurrency baseline the edits were made against
 *      (`draftBaseline`), so a colleague's save since still meets "Someone else saved"; Admin puts
 *      back only the rows whose saved record is still the one the row was DRAWN from, compared whole
 *      by the rule a save uses (`keptRecord` / `sameKeptRecord`, override-compare.js — v26.08: an
 *      `id|type|value` signature missed a moved leave year, a note and a fresh save), and names the
 *      days it left alone.
 *   6. WORK A SAVE HAS SINCE LANDED IS NOT UNSAVED (v25.97). A page hidden while a save was still
 *      waiting for its answer keeps that save's rows, and rightly: a save held only in memory (the
 *      app open in a second tab, where the IndexedDB lease is single-tab) or a transaction still
 *      waiting is lost with the page. But a save held in this device's queue usually lands, and the
 *      next load then asked "Restore your unsaved changes?" about changes that WERE saved — and
 *      Restore named each day as changed since, about the member's own save (found on the real SDK,
 *      13 Nov 2026). So `offer` takes `unsaved`: the draft's data with what has since landed taken
 *      out, or null when that is all of it. Null deletes the draft without a question; anything else
 *      is what is asked about and put back. Admin judges it from what the save was SENDING when the
 *      page went (`sendingDays`, admin-week-editor.js) against what each day holds now
 *      (`unsavedWeekDraft`, admin-week-row-state.js) — the outcome, never a guess about which queue
 *      the save was in. Links keeps the copy a QUEUED save wrote until the server confirms it
 *      (links-design-store.js rule 6) — a second tab's queue is memory only — and takes out a draft
 *      the design now holds exactly (`_draftStillUnsaved`, links-app.js).
 *
 * ── WHAT IT IS NOT ──────────────────────────────────────────────────────────────────────────────
 *
 * Not for Overtime: its availability form deliberately keeps no copy (`confirmDiscard`,
 * overtime-app.js) — a declaration about somebody's own availability, kept where the server cannot
 * see it, is a different trade from a staged roster edit or a shared link design.
 *
 * Storage goes through ls.js, so a browser whose storage throws (Safari's Block All Cookies) loses
 * only this safety net and never the page. Pure apart from that one dependency (and date-format.js, which
 * imports nothing); unit-tested in page-session.test.mjs, beside the trigger that writes it.
 */

import { lsGet, lsSet, lsDel, lsKeys } from './ls.js';
import { formatClock } from './date-format.js';

/** Every draft key starts here; the rest is `<page>_<encoded member name>` (`draftKey`). Only `myb_pc_`
 *  keys are the Pay Calculator's member data, so these never meet its ownership prompt. */
export const DRAFT_PREFIX = 'myb_draft_';

/** A draft is offered for a day after it was kept, and never after. */
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** How far in the future a stored time may be before the draft's age is unknowable: a device clock
 *  nudged back by a sync, not a draft from another day. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** The stored shape's version. A draft in any other shape is not offered. */
const DRAFT_VERSION = 1;

/**
 * The storage key of one page's draft for one signed-in member. The name is URI-encoded, so two
 * names can never share a key.
 * @param {string} page @param {string} by
 * @returns {string}
 */
export function draftKey(page, by) {
    return `${DRAFT_PREFIX}${page}_${encodeURIComponent(by)}`;
}

/**
 * @typedef {{ page: string, by: string, scope: Record<string, any>, data: Record<string, any>,
 *             savedAt: number }} Draft
 */

/**
 * A draft as it is stored. `life` names the page life that kept it (rule 3), so another tab's clean
 * hide leaves it alone; it is never read back as part of the draft.
 * @param {Draft & { life?: string }} draft
 * @returns {string}
 */
export function encodeDraft({ page, by, scope, data, savedAt, life }) {
    return JSON.stringify({ v: DRAFT_VERSION, page, by, scope, data, savedAt, ...(life ? { life } : {}) });
}

/**
 * A stored draft as it may be OFFERED, or null — malformed, another version, another page, another
 * member (rule 2), or too old or too new to judge (rule 4).
 * @param {string|null} raw
 * @param {{ page: string, by: string, now: number }} reader
 * @returns {Draft|null}
 */
export function decodeDraft(raw, { page, by, now }) {
    /** @type {any} */ let d;
    try { d = JSON.parse(raw ?? ''); } catch { return null; }
    if (!d || typeof d !== 'object' || d.v !== DRAFT_VERSION) return null;
    if (!by || d.page !== page || d.by !== by) return null;
    if (typeof d.savedAt !== 'number' || !Number.isFinite(d.savedAt)) return null;
    const age = now - d.savedAt;
    if (age > DRAFT_MAX_AGE_MS || age < -CLOCK_SKEW_MS) return null;
    if (!d.scope || typeof d.scope !== 'object' || !d.data || typeof d.data !== 'object') return null;
    return { page: d.page, by: d.by, scope: d.scope, data: d.data, savedAt: d.savedAt };
}

/**
 * The question a kept draft is offered with — a 24-hour clock, and "yesterday" when it is from
 * yesterday, because "from 23:50" read at 07:00 is otherwise this morning's.
 * @param {number} savedAt @param {number} now
 * @returns {string}
 */
export function restoreQuestion(savedAt, now) {
    const at = new Date(savedAt);
    const yesterday = at.toDateString() !== new Date(now).toDateString();
    return `Restore your unsaved changes from ${formatClock(at)}${yesterday ? ' yesterday' : ''}?`;
}

/**
 * The concurrency baseline a Links draft was edited against, as read back from storage (rule 5).
 * Anything unusable reads as UNKNOWN, never as "no baseline": `conflictOf` treats a null baseline
 * that is not flagged unknown as safe to overwrite, which is the silent overwrite links-design.md
 * invariant 5 exists to stop.
 * @param {any} raw
 * @returns {{ loadedRevision: number|null, loadedUpdatedAt: number|null, baselineUnknown: boolean }}
 */
export function draftBaseline(raw) {
    const num = (/** @type {any} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const loadedRevision = num(raw?.loadedRevision), loadedUpdatedAt = num(raw?.loadedUpdatedAt);
    const known = raw?.baselineUnknown === false && (loadedRevision !== null || loadedUpdatedAt !== null);
    return { loadedRevision, loadedUpdatedAt, baselineUnknown: !known };
}

/**
 * What Admin says once a week's draft is back: how to finish, and which days it left as saved
 * because their record has changed since (rule 5).
 * @param {number} put   rows put back
 * @param {string[]} left  the days not put back, already worded
 * @returns {string}
 */
export function weekRestoredLine(put, left) {
    const one = left.length === 1, days = left.join(', ');
    if (!put) return left.length ? `Your unsaved changes were not put back: ${days} ${one ? 'has' : 'have'} changed since.`
        : 'There were no unsaved changes to put back.';
    return 'Your unsaved changes are back — check them, then select Save changes.' + (left.length
        ? ` ${days} ${one ? 'was' : 'were'} left as saved, because ${one ? 'it has' : 'they have'} changed since.` : '');
}

/**
 * Delete every draft on this device that no reader will ever be offered — past its day, dated beyond
 * the clock skew, or unreadable — whosever it is (rule 4). One still inside its day is left alone: it
 * is its own member's to be offered (rule 2). The age is all that is read, so a draft in a shape a
 * newer page writes is judged by the same day as every other.
 * @param {number} now
 */
function sweepStaleDrafts(now) {
    for (const key of lsKeys()) {
        if (!key.startsWith(DRAFT_PREFIX)) continue;
        /** @type {any} */ let d = null;
        try { d = JSON.parse(lsGet(key) ?? ''); } catch { /* unreadable: no page can offer it */ }
        const age = typeof d?.savedAt === 'number' && Number.isFinite(d.savedAt) ? now - d.savedAt : NaN;
        if (!(age <= DRAFT_MAX_AGE_MS && age >= -CLOCK_SKEW_MS)) lsDel(key);
    }
}

/**
 * One page's draft slot for the signed-in member.
 *
 * `peek` reads what may be offered. `keep` writes this page's unsaved work; `forget` deletes it,
 * except a draft an earlier page life left that has not been answered yet, or one another tab kept
 * (rule 3). `offer` asks
 * once, through the page's own `confirmDialog`: Discard deletes the draft; Restore runs `apply`
 * and deletes it afterwards — each only the copy it asked about, never a newer one another tab kept
 * meanwhile — unless `apply` could not put it back (it returned false, or threw),
 * in which case it stays for the next load; and a question dismissed unanswered leaves it waiting,
 * still unanswered (rule 1), for the next load to ask. Before asking, an `unsaved` hook takes out
 * what has since saved (rule 6); when nothing is left the draft is deleted and nothing is asked.
 *
 * `usable(data)` is the page's own test of a draft it could put back WHOLE: one that fails it is
 * neither offered nor kept. A Links draft whose patterns were unreadable would otherwise come back
 * as an empty grid, and a Save would write that over the shared design — restored whole or not at
 * all, as an import is (links-design.md, invariant 6).
 * @param {{ page: string, by: string, now?: () => number, usable?: (data: Record<string, any>) => boolean }} opts
 */
export function createDraftSlot({ page, by, now = Date.now, usable = () => true }) {
    sweepStaleDrafts(now());
    const key = draftKey(page, by);
    /**
     * Delete the stored copy only while it is still `raw`, the exact copy this page read (external
     * review, 14 Nov 2026). Two tabs share the slot and a question waits for a person: going to one tab
     * to answer it is what hides the other, which keeps a NEWER copy then — and answering the old
     * question deleted whatever the slot held by then, the only copy of that work. Each keep is its
     * own copy (its time and its page life are in it), so the text itself is the revision.
     * @param {string|null} raw
     */
    const dropIfStill = (raw) => { if (raw !== null && lsGet(key) === raw) lsDel(key); };
    /** The slot read once: the stored copy exactly, and what of it may be offered. */
    const read = () => {
        const raw = lsGet(key);
        if (raw === null) return { raw, draft: null };
        const draft = decodeDraft(raw, { page, by, now: now() });
        let offerable = false;
        try { offerable = !!draft && usable(draft.data); } catch { /* a test that cannot read it has its answer */ }
        if (!offerable) dropIfStill(raw);   // too old, unreadable, unusable or not this member's: never offered, so not kept
        return { raw, draft: offerable ? draft : null };
    };
    /** @returns {Draft|null} */
    const peek = () => read().draft;
    // An earlier page life's draft, still waiting for its question (rule 3).
    let waiting = !!peek();
    // What THIS page life marks its own copy with (rule 3): a clean hide here must not delete a copy
    // another tab kept. Unique enough for two tabs opened in the same millisecond.
    const life = `${now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    /** Was the stored draft kept by another page life? One with no mark is from before marks, and is not. */
    const anotherLifes = () => {
        /** @type {any} */ let stored = null;
        try { stored = JSON.parse(lsGet(key) ?? ''); } catch { /* unreadable: nobody's, so it may go */ }
        return typeof stored?.life === 'string' && stored.life !== life;
    };
    return {
        peek,
        /** @param {Record<string, any>} scope @param {Record<string, any>} data */
        keep(scope, data) {
            if (!by) return;
            lsSet(key, encodeDraft({ page, by, scope, data, savedAt: now(), life }));
            waiting = false;   // what is stored now is this page's own work
        },
        forget() { if (!waiting && !anotherLifes()) lsDel(key); },
        /**
         * `ask` is the page's `confirmDialog`, which resolves `dismissResult` — null — when the question
         * is put away without an answer.
         * `unsaved(draft)` is the page's answer to "is any of this still unsaved?" (rule 6): the data
         * with what has since landed taken out, or null when nothing is left. A hook that throws is no
         * answer, so the whole draft is asked about, as it was before the hook existed.
         * @param {{ ask: (o: { title: string, message: string, confirmLabel: string, cancelLabel: string, dismissResult: null }) => Promise<boolean|null>,
         *           apply: (draft: Draft) => any,
         *           unsaved?: (draft: Draft) => Record<string, any>|null }} o
         * @returns {Promise<'none'|'saved'|'discarded'|'restored'|'kept'|'unanswered'>}
         */
        async offer({ ask, apply, unsaved }) {
            // Every delete below is of THIS copy, the one asked about, never of whatever the slot holds by then.
            const { raw, draft: read0 } = read();
            let draft = read0;
            if (!draft) { waiting = false; return 'none'; }
            if (unsaved) {
                /** @type {Record<string, any>|null} */ let left = draft.data;
                try { left = unsaved(draft); } catch (err) { console.error('[unsaved-draft] could not tell what has since saved:', err); }
                if (!left) { waiting = false; dropIfStill(raw); return 'saved'; }   // all of it landed: nothing to ask about
                draft = { ...draft, data: left };
            }
            const restore = await ask({ title: 'Unsaved changes', message: restoreQuestion(draft.savedAt, now()),
                confirmLabel: 'Restore', cancelLabel: 'Discard', dismissResult: null });
            // Only an explicit Discard deletes (rule 1); `waiting` stays as it was, so a clean hide keeps it (rule 3).
            if (restore === null || restore === undefined) return 'unanswered';
            if (!restore) { waiting = false; dropIfStill(raw); return 'discarded'; }
            try {
                if (await apply(draft) === false) return 'kept';
            } catch (err) {
                console.error('[unsaved-draft] a kept draft could not be put back:', err);
                return 'kept';
            }
            waiting = false;
            dropIfStill(raw);
            return 'restored';
        },
    };
}
