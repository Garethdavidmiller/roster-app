// @ts-check
/**
 * operations-al-save.js — the Annual leave sheet's Save on Operations: the rest-day answers, a
 * confirmation per person, the "after" figures, the Save button, the receipt and the Undo. Phase 2b of
 * the uploader (docs/DECISIONS.md → The annual leave uploader). The card (operations-al-sheet.js) draws the check
 * and hands each person here; WHAT a Save writes is al-leave-plan.js's, and sending it al-leave-save.js's.
 *
 * ── NOTHING IS SAVED FOR A PERSON NOBODY CONFIRMED ──────────────────────────────────────────────
 *
 * Each person's additions are confirmed on their own row, never by one "accept all" (the
 * uploader's third defence against cancelled leave coming back; al-leave-plan.js header), with what the Save would leave them on beside the box: the figures AFTER it, from the
 * same comparison run over the records the Save would leave (`recordsAfter`), and whatever would
 * still differ in the chips' own words. A rest day is asked about in Admin's own words and never
 * defaulted; unanswered, it is not saved. A file the plan refuses (a year before last, too old, of
 * unknown age, older than one saved already — or a record of earlier Saves that could not be read) is
 * drawn as a check only.
 *
 * ── THE ANSWERS ARE THE ADMIN'S, AND OUTLIVE ANY NEW CHECK (review, 15 Nov 2026) ────────────────
 *
 * They are kept for the visit (`_memory`), beyond any one check. Every check draws a new review — the
 * fresh one after a Save or an Undo, "Check again" (which every receipt that stops asks for), a new
 * copy of the file, the paste box — and each takes the answers for the days IT still asks about. A
 * check that cannot read draws nothing and changes nothing, so the answers wait for the next one: the
 * first cut held them in the review alone, and a check that failed offline took every one away. A
 * TICK goes across only to a review whose box would say exactly the same — the same writes, the same
 * figures after, the same differences left — because a tick is a decision about what the box said
 * (`boxSays`). So after a Save the people it saved have nothing left to tick, a person a colleague's
 * change stopped is ticked again by somebody looking at it, and a person the Save never reached keeps
 * their tick, so saving again finishes it. Clear asks, and forgets them; so does leaving the page.
 *
 * ONLY WHAT A SAVE WOULD WRITE IS UNSAVED: a tick, or a day answered "Swapped — counts". "Rest day —
 * free" writes nothing, so it holds nothing back: after a Save had saved everything, every way off the
 * page asked about "unsaved changes" it could never make. The Save names those days instead.
 *
 * ── A SAVE THAT SENT NOTHING CHANGES NOTHING ────────────────────────────────────────────────────
 *
 * Offline from the start, a store that could not load, a write refused before it began: nothing was
 * sent, so nothing is checked again and the review stays as it was. Offline, the check would only have
 * been refused, and taken the review off the screen with it. An Undo is the same: one whose records
 * could not be read, or whose store could not load, took nothing back, so its review and its Undo stay
 * — "stopped part way" was untrue of it, and pointed at a button the failed check had just removed.
 *
 * ── A SAVE THAT COULD NOT BE RECORDED IS FINISHED BY THE NEXT CHECK ─────────────────────────────
 *
 * The upload log is written from a read AFTER the Save (al-leave-save.js). When that read cannot be
 * made, or the log cannot be written, the Save's plans are held in memory (`_pending`, every such Save,
 * oldest first), and the next check of the same file in this visit writes the log from its own fresh
 * read (`finishPendingLog`) — so the Undo, and the protection against leave cancelled since, are not
 * lost to a moment's lost signal. The Save's records carry its id, so the later log calls added only
 * what is still the Save's own, whatever was changed in between (al-leave-plan.js). A closed page loses it: the next Save's log still names every day in
 * line. And a Save of which nothing landed is recorded by nobody: a log with nothing added became the
 * newest and took the earlier Save's Undo off the screen. A Save where only swaps landed IS recorded —
 * its days in line and its copy of the workbook protect what comes later — and the Undo on offer
 * passes over it to the latest Save that added leave (`judgeUploads`'s `undoable`, review of v26.22).
 *
 * ── NOTHING IS KEPT ─────────────────────────────────────────────────────────────────────────────
 *
 * The answers name colleagues against their leave, so they live in this module's memory alone, and the
 * page asks before it is left while any are unsaved (operations-al-sheet.js wires the question).
 */
import { planPerson, saveTotals, recordsAfter, judgeUploads, saveRefusal, logLists, logFields, parseDayKey, landedWrites,
    oldestSaveableYear } from './al-leave-plan.js';
import { saveLeavePlans, readMemberRecords, newUploadLogId, writeUploadLog, pruneUploadLogs, undoUpload, preloadSaveStore,
    STORE_UNLOADED, CACHED_READ } from './al-leave-save.js';
import { comparePerson } from './al-leave-compare.js';
import { chipsFor, CARD_WORDS, SAVE_WORDS, questionWords, confirmWords, afterWords, stillDiffersWords, unansweredWords,
    saveButtonWords, savingWords, refusalWords, receiptWords, lastSaveWords, undoConfirmWords, undoneWords, leftFreeWords } from './al-leave-words.js';
import { teamMembers, APP_VERSION } from './roster-data.js';
import { LEAVE_FILE_MAX_AGE_DAYS } from './al-leave-file.js';
import { tsToMillis } from './override-utils.js';
import { confirmDialog } from './overlay.js';
import { unconfirmedWriteLine } from './claim-retry.js';

/**
 * What the card lends the review: its status line, a lock on every control while a Save or an Undo
 * runs, and a fresh check of the file on screen — given the records already read again, when there are.
 * @typedef {{ say: (lines: string[], tone: 'ok'|'err'|'working', action?: HTMLElement|null) => void,
 *             lock: (on: boolean) => void,
 *             recheck: (o: { receipt: string[], tone: 'ok'|'err', records?: Map<string, any[]>|null }) => Promise<void> }} CardHooks
 * @typedef {{ digest: string, id: string, plans: any[], me: string, exclude: Map<string, string[]> }} PendingLog
 */

/** A Save or an Undo is running. */
let _working = false;
/** Saves not yet recorded, oldest first (header). @type {PendingLog[]} */
let _pending = [];
/** @returns {{ answers: Map<string, Map<string, string>>, ticks: Map<string, string> }} */
const emptyMemory = () => ({ answers: new Map(), ticks: new Map() });
/** The admin's answers, and each tick with what its box said, for the visit (header). */
let _memory = emptyMemory();
let _seq = 0;

/** True while a Save or an Undo runs. */
export const alSaveWorking = () => _working;
/** True while a Save or an Undo runs, or a tick or a "Swapped — counts" answer is unsaved (header). */
export const alSaveUnsaved = () => _working || _memory.ticks.size > 0
    || [..._memory.answers.values()].some(m => [...m.values()].includes('swapped'));
/** Clear, answered: everything the admin gave the review goes. Taking an answer off the screen alone
 *  forgets nothing — the next check takes what it still asks about (header). */
export function forgetReview() { _memory = emptyMemory(); }

/** @param {string} tag @param {string} [cls] @param {string} [text] */
function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
}

/**
 * Write the log of every Save of this file that could not be recorded, from this check's fresh read
 * (header). Null when nothing was recorded; otherwise the line to add to the status.
 * @param {{ file: any, comparison: any, records: Map<string, any[]> }} a
 * @returns {Promise<string|null>}
 */
export async function finishPendingLog({ file, comparison, records }) {
    let recorded = false;
    for (const p of _pending.filter(x => x.digest === file.digest)) {
        const drop = () => { _pending = _pending.filter(x => x !== p); };
        const mine = { plans: p.plans, recordsByName: records, savedBy: p.me, uploadId: p.id, exclude: p.exclude };
        if (!landedWrites(mine).size) { drop(); continue; }
        const lists = logLists({ after: comparison.people, ...mine });
        const fields = logFields({ file, ...lists, savedBy: p.me, appVersion: APP_VERSION });
        if (!fields) { drop(); continue; }
        try {
            await writeUploadLog(p.id, fields);
            drop();
            if (lists.added.length) recorded = true;
        } catch (err) {
            console.error('[AL sheet] an earlier Save is still not recorded:', /** @type {any} */ (err)?.code ?? 'unknown');
        }
    }
    return recorded ? SAVE_WORDS.nowRecorded : null;
}

/**
 * The review of one check: what may be saved, and the controls that say so.
 * @param {{ file: any, comparison: any, records: Map<string, any[]>, logs: any[]|null, todayStr: string,
 *           me: string|null, hooks: CardHooks }} a  `logs` null: they could not be read
 */
export function createReview({ file, comparison, records, logs, todayStr, me, hooks }) {
    const judged = logs ? judgeUploads({ logs, file }) : null;
    /** @type {null|'no-name'|'logs'|'old-year'|'age-unknown'|'too-old'|'older-copy'} */
    const refusal = !me ? 'no-name' : !judged ? 'logs' : saveRefusal({ file, todayStr, judged });
    const protectedKeys = judged?.protectedKeys ?? new Set();
    const people = new Map(comparison.people.map((/** @type {any} */ p) => [p.name, p]));
    const filePeople = new Map(file.people.map((/** @type {any} */ p) => [p.name, p]));
    /** @param {string} name */
    const daysOf = name => file.days.filter((/** @type {any} */ d) => d.name === name);
    /** @type {Map<string, Map<string, string>>} */ const answers = new Map();
    /** @type {Set<string>} */ const confirmed = new Set();
    /** Each person's panel, redrawn in place so focus and the open folds stay where they are. @type {Map<string, () => void>} */
    const redraw = new Map();
    /** @type {(() => void)|null} */ let redrawBar = null;
    const seq = ++_seq;

    /** One person's part, as it stands or as if confirmed. @param {string} name @param {boolean} asConfirmed */
    const planOf = (name, asConfirmed) => planPerson({ person: people.get(name), records: records.get(name) ?? [],
        answers: answers.get(name) ?? new Map(), confirmed: asConfirmed, protectedKeys,
        // The sheet charges every day it lists to its own year; the planner keeps that only for a
        // next-January day, the one place it differs from the date's (leave-year.js).
        leaveYears: new Map(daysOf(name).map((/** @type {any} */ d) => [d.date, d.leaveYear ?? file.year])), changedBy: me ?? '' });
    /**
     * What a person's box says, as it stands: its words, the figures after, what would still differ —
     * and the writes themselves. Null when nothing is for the Save. A tick is a decision about this.
     * @param {string} name
     */
    const boxOf = name => {
        const would = planOf(name, true);
        if (!would.writes.length) return null;
        const swap = would.writes.filter(w => w.kind === 'swap').length;
        const a = comparePerson({ person: filePeople.get(name), days: daysOf(name), member: teamMembers.find(m => m.name === name),
            records: recordsAfter(records.get(name) ?? [], would), year: file.year, todayStr,
            firstDate: file.source.firstDate, lastDate: file.source.lastDate });
        const left = a.needsALook ? chipsFor(a.counts, a.allowanceDiffers) : [];
        return { would, words: confirmWords({ name, add: would.writes.length - swap, swap }), after: afterWords(a),
            still: left.length ? stillDiffersWords(left) : '' };
    };
    /** @param {ReturnType<typeof boxOf>} box */
    const boxSays = box => (box ? JSON.stringify([box.words, box.after, box.still,
        box.would.writes.map(w => [w.kind, w.date, w.fixedId, w.replaces.map(r => r.id)])]) : null);

    // What this check takes from the memory (header): the answers to the days it still asks about, and
    // each tick whose box says exactly what it said. What it does not ask about, it does not keep.
    for (const [name, was] of _memory.answers) {
        if (!people.has(name)) continue;
        const asked = new Set(planOf(name, false).questions);
        const kept = new Map([...was].filter(([d]) => asked.has(d)));
        if (kept.size) answers.set(name, kept);
    }
    // A check that cannot be saved shows no box, so it keeps the ticks as they were for the next one:
    // a record of earlier Saves that could not be read is a moment's lost signal, not a decision.
    /** @type {Map<string, string>} */ const ticks = refusal ? new Map(_memory.ticks) : new Map();
    if (!refusal) {
        for (const [name, said] of _memory.ticks) {
            const now = people.has(name) ? boxSays(boxOf(name)) : null;
            if (now !== null && now === said) { confirmed.add(name); ticks.set(name, said); }
        }
    }
    _memory = { answers, ticks };
    const plans = () => [...confirmed].map(n => planOf(n, true)).filter(p => p.writes.length);

    const review = {
        refusal,

        /** The summary's Save lines: why this file cannot be saved, and the last Save with its Undo. @param {HTMLElement} root */
        summary(root) {
            if (refusal) {
                const line = refusal === 'no-name' ? SAVE_WORDS.noName : refusal === 'logs' ? SAVE_WORDS.logsUnreadable
                    : refusalWords(refusal, { maxAge: LEAVE_FILE_MAX_AGE_DAYS, year: file.year, newest: judged?.newest
                        ? { clerksLastSaved: judged.newest.clerksLastSaved, savedAt: stampDate(judged.newest.savedAt) } : null });
                root.append(el('p', 'al-sheet-warn', line));
            }
            // The latest Save that ADDED leave — a later one where only swaps landed has no Undo of its own (al-leave-plan.js).
            // One made before the app marked its days is named with no Undo, and the line says why (al-leave-plan.js header).
            const unmarked = judged?.unmarked;
            if (unmarked && me && Array.isArray(unmarked.added) && unmarked.added.length) {
                const row = el('div', 'al-sheet-last');
                row.append(el('p', '', lastSaveWords({ savedAt: stampDate(unmarked.savedAt), savedBy: unmarked.savedBy,
                    added: unmarked.added.length, latest: unmarked === judged?.newest })), el('p', 'al-sheet-unmarked', SAVE_WORDS.undoUnmarked));
                root.append(row);
                return;
            }
            const last = judged?.undoable;
            if (!last || !me || !Array.isArray(last.added) || !last.added.length || 'undoneAt' in last) return;
            const row = el('div', 'al-sheet-last');
            const undo = /** @type {HTMLButtonElement} */ (el('button', 'roster-cancel-btn al-sheet-undo', SAVE_WORDS.undo));
            undo.type = 'button';
            // Caught here: the confirm before its own try, or the fresh check after it, could still reject,
            // and a click has nobody else to hand that to. A code only, as everywhere in this card.
            undo.addEventListener('click', () => {
                runUndo(/** @type {any} */ (last)).catch((err) =>
                    console.error('[AL sheet] the Undo could not run:', /** @type {any} */ (err)?.code ?? /** @type {any} */ (err)?.name ?? 'unknown'));
            });
            row.append(el('p', '', lastSaveWords({ savedAt: stampDate(last.savedAt), savedBy: last.savedBy, added: last.added.length,
                latest: last === judged?.newest })), undo);
            root.append(row);
        },

        /** A day's row: the rest-day question, or why a day is not put back. @param {any} p @param {any} d @param {HTMLElement} li */
        day(p, d, li) {
            if (refusal) return;
            const plan = planOf(p.name, false);
            if (plan.removedSince.includes(d.date)) li.append(el('p', 'al-sheet-removed', SAVE_WORDS.removedSince));
            if (!plan.questions.includes(d.date)) return;
            const group = el('div', 'al-sheet-answer');
            group.setAttribute('role', 'radiogroup');
            group.setAttribute('aria-label', questionWords(d.date));
            const name = `alSheetQ${seq}-${[...people.keys()].indexOf(p.name)}-${d.date}`;
            for (const [value, words] of [['swapped', SAVE_WORDS.swapped], ['free', SAVE_WORDS.free]]) {
                const label = el('label');
                const radio = /** @type {HTMLInputElement} */ (el('input'));
                radio.type = 'radio'; radio.name = name; radio.value = value;
                radio.checked = answers.get(p.name)?.get(d.date) === value;
                radio.addEventListener('change', () => {
                    if (!radio.checked) return;
                    answers.set(p.name, new Map([...(answers.get(p.name) ?? []), [d.date, value]]));
                    redraw.get(p.name)?.(); redrawBar?.();
                });
                label.append(radio, document.createTextNode(words));
                group.append(label);
            }
            li.append(group);
        },

        /** A person's confirmation and their figures after the Save, at the foot of their fold. @param {any} p @param {HTMLElement} body */
        person(p, body) {
            if (refusal) return;
            const panel = el('div', 'al-sheet-save-person');
            const unanswered = el('p', 'al-sheet-explain');
            const nothing = el('p', 'al-sheet-note', SAVE_WORDS.nothingForSave);
            const label = el('label', 'al-sheet-confirm');
            const box = /** @type {HTMLInputElement} */ (el('input'));
            box.type = 'checkbox';
            const words = el('span');
            label.append(box, words);
            const after = el('p', 'al-sheet-figures al-sheet-after');
            const still = el('p', 'al-sheet-explain');
            panel.append(unanswered, nothing, label, after, still);
            box.addEventListener('change', () => {
                if (box.checked) confirmed.add(p.name); else confirmed.delete(p.name);
                draw(); redrawBar?.();
            });
            const draw = () => {
                const said = boxOf(p.name);
                const would = said?.would ?? planOf(p.name, true);
                unanswered.textContent = unansweredWords(would.unanswered.length);
                unanswered.hidden = !would.unanswered.length;
                nothing.hidden = !!said || would.questions.length > 0;
                for (const n of [label, after, still]) n.hidden = !said;
                if (!said) { confirmed.delete(p.name); ticks.delete(p.name); box.checked = false; return; }
                words.textContent = said.words;
                box.checked = confirmed.has(p.name);
                // The tick is remembered with what its box says now (header).
                if (confirmed.has(p.name)) ticks.set(p.name, /** @type {string} */ (boxSays(said))); else ticks.delete(p.name);
                after.textContent = said.after;
                still.textContent = said.still;
                still.hidden = !said.still;
            };
            redraw.set(p.name, draw);
            draw();
            body.append(panel);
        },

        /** The Save itself, under the people who need a look — or null when nothing here can be saved. */
        bar() {
            if (refusal || ![...people.keys()].some(n => planOf(n, true).writes.length || planOf(n, false).questions.length)) return null;
            // The checked commit is loaded now, from the release this page came from (al-leave-save.js).
            void preloadSaveStore();
            const bar = el('div', 'al-sheet-save');
            const button = /** @type {HTMLButtonElement} */ (el('button', 'huddle-upload-btn'));
            button.type = 'button';
            button.id = 'alSheetSaveBtn';
            bar.append(el('p', 'al-sheet-save-intro', SAVE_WORDS.intro), button);
            redrawBar = () => {
                const t = saveTotals(plans());
                button.textContent = saveButtonWords(t);
                button.disabled = t.days === 0;   // while a Save runs the whole result is inert (operations-al-sheet.js)
            };
            redrawBar();
            // runSave catches every failure it expects. A fault past those must not escape as an unhandled
            // rejection, whose message the Error Log would keep: it could quote the file, so its type only.
            button.addEventListener('click', () => {
                runSave().catch(err => console.error('[AL sheet] the Save failed past its own checks:', /** @type {any} */ (err)?.name ?? 'unknown'));
            });
            return bar;
        },

        /** The card's closing line: what pressing Save does, or that this is a check only. */
        note: () => (refusal ? CARD_WORDS.checkOnly : SAVE_WORDS.saveable),
    };

    async function runSave() {
        const chosen = plans();
        if (_working || refusal || !chosen.length || !me) return;
        _working = true;
        hooks.lock(true);
        /** @type {Map<string, any[]>|null} */ let reread = null;
        /** @type {string[]} */ let receipt;
        let tone = /** @type {'ok'|'err'} */ ('err');
        let sentNothing = false;
        try {
            // The log's id, before anything is sent: every record of this Save carries it (al-leave-plan.js).
            const id = newUploadLogId();
            const total = saveTotals(chosen).days;
            hooks.say([savingWords(0, total)], 'working');
            /** @type {Awaited<ReturnType<typeof saveLeavePlans>>} */ let out;
            try {
                out = await saveLeavePlans(chosen, { uploadId: id,
                    onProgress: (done, n) => hooks.say([savingWords(done, n)], 'working') });
            } catch (err) {
                console.error('[AL sheet] the Save failed:', /** @type {any} */ (err)?.code ?? /** @type {any} */ (err)?.name ?? 'unknown');
                out = { saved: new Map(), refused: new Map(), stopped: 'failed', code: null, partial: true };
            }
            // Nothing reached the server: nothing to read back or record, and nothing to check again (header).
            sentNothing = !!out.stopped && !out.saved.size && !out.refused.size && !out.partial;
            /** @type {string[]} */ const logLines = [];
            if (!sentNothing) {
                try {
                    reread = await readMemberRecords([...people.keys()]);
                } catch (err) {
                    console.error('[AL sheet] the records were not read after the Save:', /** @type {any} */ (err)?.code ?? 'unknown');
                    _pending.push({ digest: file.digest, id, plans: chosen, me, exclude: out.refused });
                    logLines.push(SAVE_WORDS.unreadAfter);
                }
                if (reread) logLines.push(...await record(id, chosen, reread, out.refused));
            }
            // What was saved is what the server holds, once it has been read: a Save whose answer was lost
            // on the way back may have landed whole. Unread, it is what the Save saw confirmed — and where
            // more may have landed, the receipt does not say "nothing". A day it was refused on is never its own.
            const saved = reread ? landedWrites({ plans: chosen, recordsByName: reread, savedBy: me, uploadId: id, exclude: out.refused })
                : out.saved;
            const finished = !!reread && chosen.every(p => out.refused.has(p.name) || (saved.get(p.name)?.length ?? 0) === p.writes.length);
            const days = [...saved.values()].reduce((n, d) => n + d.length, 0);
            receipt = receiptWords({ days, people: saved.size, refused: out.refused, unsure: !reread && out.partial,
                landedFor: new Set(saved.keys()) });
            const stopped = finished ? null : out.stopped;   // read back whole, it did not stop part way
            if (stopped === 'offline') receipt.push(saved.size || out.partial ? SAVE_WORDS.lost : SAVE_WORDS.offlineNow);
            else if (stopped === 'unconfirmed') receipt.push(unconfirmedWriteLine({ code: out.code }, 'this Save', 'the Calendar') ?? SAVE_WORDS.failed);
            else if (stopped === 'not-started') receipt.push(SAVE_WORDS.notStarted);
            else if (stopped === 'failed') receipt.push(SAVE_WORDS.failed);
            // The rest days left as rest days, as answered, for each person the Save reached (header).
            for (const p of chosen) {
                if (!p.leftFree.length || !saved.get(p.name)?.length) continue;
                const states = new Map((people.get(p.name)?.days ?? []).map((/** @type {any} */ d) => [d.date, d.state]));
                receipt.push(leftFreeWords(p.name, p.leftFree.map(date => ({ date, held: states.get(date) === 'free-in-app' }))));
            }
            receipt.push(...logLines);
            if (!out.refused.size && !stopped) tone = 'ok';
        } catch (err) {
            // A fault, not a refusal: every failure the Save expects is caught where it happens. It must
            // not leave "Saving…" on screen and the card locked for good, and what landed is unknown, so
            // the line says neither "saved" nor "nothing": the fresh check below shows what landed.
            console.error('[AL sheet] the Save’s answer failed:', /** @type {any} */ (err)?.name ?? 'unknown');
            receipt = [SAVE_WORDS.failed];
        }
        if (sentNothing) {
            hooks.say(receipt, tone);
            _working = false;
            hooks.lock(false);
            return;
        }
        // Locked until the fresh check has drawn the new answer: the old controls were planned from a
        // check this Save has just made wrong.
        try { await hooks.recheck({ receipt, tone, records: reread }); }
        finally { _working = false; hooks.lock(false); }
    }

    /**
     * The upload log, from the records read after the Save — when anything of it landed (header) — and
     * then the old logs pruned, without waiting (al-leave-save.js). The lines to add.
     * @param {string} id @param {any[]} chosen @param {Map<string, any[]>} reread @param {Map<string, string[]>} exclude
     * @returns {Promise<string[]>}
     */
    async function record(id, chosen, reread, exclude) {
        const savedBy = /** @type {string} */ (me);
        const mine = { plans: chosen, recordsByName: reread, savedBy, uploadId: id, exclude };
        if (!landedWrites(mine).size) return [];
        const after = [...people.values()].map(p => comparePerson({ person: filePeople.get(p.name), days: daysOf(p.name),
            member: teamMembers.find(m => m.name === p.name), records: reread.get(p.name) ?? [], year: file.year, todayStr,
            firstDate: file.source.firstDate, lastDate: file.source.lastDate }));
        const lists = logLists({ after, ...mine });
        const fields = logFields({ file, ...lists, savedBy, appVersion: APP_VERSION });
        if (!fields) return lists.added.length ? [SAVE_WORDS.notRecorded] : [];
        try {
            await writeUploadLog(id, fields);
        } catch (err) {
            console.error('[AL sheet] the Save was not recorded:', /** @type {any} */ (err)?.code ?? 'unknown');
            _pending.push({ digest: file.digest, id, plans: chosen, me: savedBy, exclude });
            return lists.added.length ? [SAVE_WORDS.notRecordedYet] : [];
        }
        void pruneUploadLogs(oldestSaveableYear(todayStr));
        return lists.added.length ? [SAVE_WORDS.recorded] : [];
    }

    /** @param {any} log */
    async function runUndo(log) {
        if (_working || !me) return;
        const ok = await confirmDialog({ title: 'Undo this Save?', message: undoConfirmWords(log.added.length),
            confirmLabel: 'Undo the Save', danger: true });
        if (!ok || _working) return;
        _working = true;
        hooks.lock(true);
        hooks.say([SAVE_WORDS.undoing], 'working');
        /** @type {string[]} */ let receipt = [];
        let tone = /** @type {'ok'|'err'} */ ('ok');
        let sentNothing = false;
        try {
            const names = [...new Set(log.added.map((/** @type {string} */ k) => parseDayKey(k)?.name).filter(Boolean))];
            /** @type {Map<string, any[]>|null} */ let records = null;
            try {
                records = await readMemberRecords(/** @type {string[]} */ (names));
            } catch (err) {
                const code = /** @type {any} */ (err)?.code;
                console.error('[AL sheet] the records were not read for the Undo:', code ?? 'unknown');
                receipt = [code === CACHED_READ ? SAVE_WORDS.undoOffline : SAVE_WORDS.undoUnread];
                tone = 'err';
                sentNothing = true;
            }
            if (records) {
                const res = await undoUpload(log, { recordsByName: records, undoneBy: me });
                receipt = undoneWords(res);
                if (res.kept.length) tone = 'err';
            }
        } catch (err) {
            const code = /** @type {any} */ (err)?.code;
            console.error('[AL sheet] the Undo stopped:', code ?? 'unknown');
            sentNothing = code === STORE_UNLOADED;
            receipt = [sentNothing ? SAVE_WORDS.undoNotStarted : SAVE_WORDS.undoStopped];
            tone = 'err';
        }
        // Nothing was sent, as for a Save that sent nothing (header): the review stays as it is, and its
        // Undo with it. Offline, the check after it would only have been refused, and taken both away.
        if (sentNothing) {
            hooks.say(receipt, tone);
            _working = false;
            hooks.lock(false);
            return;
        }
        try { await hooks.recheck({ receipt, tone }); }
        finally { _working = false; hooks.lock(false); }
    }

    return review;
}

/** A server stamp as a Date, or null. @param {any} t @returns {Date|null} */
function stampDate(t) {
    const ms = tsToMillis(t);
    return ms > 0 ? new Date(ms) : null;
}
