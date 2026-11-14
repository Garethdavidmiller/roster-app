// @ts-check
/**
 * operations-al-save.js — the Annual leave sheet's Save on Operations: the rest-day answers, a
 * confirmation per person, the "after" figures, the Save button, the receipt and the Undo. Phase 2b of
 * the uploader (docs/AL_UPLOADER_PLAN.md §4.7–4.10). The card (operations-al-sheet.js) draws the check
 * and hands each person here; WHAT a Save writes is al-leave-plan.js's, and sending it al-leave-save.js's.
 *
 * ── NOTHING IS SAVED FOR A PERSON NOBODY CONFIRMED ──────────────────────────────────────────────
 *
 * Each person's additions are confirmed on their own row, never by one "accept all" (plan §4.6,
 * defence 3), with what the Save would leave them on beside the box: the figures AFTER it, from the
 * same comparison run over the records the Save would leave (`recordsAfter`), and whatever would
 * still differ in the chips' own words. A rest day is asked about in Admin's own words and never
 * defaulted; unanswered, it is not saved. A file the plan refuses (too old, of unknown age, older than
 * one saved already — or a record of earlier Saves that could not be read) is drawn as a check only.
 *
 * ── THE ANSWERS ARE THE ADMIN'S, AND OUTLIVE A REFUSAL ──────────────────────────────────────────
 *
 * After every Save and Undo the card checks the file again and redraws it. The answers go across, for
 * every day the new check still asks about, so a refusal keeps them and only a day that changed is
 * asked again (plan §4.9). The confirmations do not: what a person's box covers has changed, so it is
 * ticked again by somebody looking at it.
 *
 * ── A SAVE THAT COULD NOT BE RECORDED IS FINISHED BY THE NEXT CHECK ─────────────────────────────
 *
 * The upload log is written from a read AFTER the Save (al-leave-save.js). When that read cannot be
 * made, the Save's plans are held in memory, and the next check of the same file in this visit writes
 * the log from its own fresh read (`finishPendingLog`) — so the Undo, and the protection against
 * leave cancelled since, are not lost to a moment's lost signal. A closed page loses it: the next
 * Save's log still names every day in line.
 *
 * ── NOTHING IS KEPT ─────────────────────────────────────────────────────────────────────────────
 *
 * The answers name colleagues against their leave, so they live in this module's memory alone, and the
 * page asks before it is left while any are on screen (operations-al-sheet.js wires the question).
 */
import { planPerson, saveTotals, recordsAfter, judgeUploads, saveRefusal, logLists, logFields, parseDayKey, landedWrites } from './al-leave-plan.js';
import { saveLeavePlans, readMemberRecords, newUploadLogId, writeUploadLog, pruneUploadLogs, undoUpload } from './al-leave-save.js';
import { comparePerson } from './al-leave-compare.js';
import { chipsFor, CARD_WORDS, SAVE_WORDS, questionWords, confirmWords, afterWords, stillDiffersWords, unansweredWords,
    saveButtonWords, savingWords, refusalWords, receiptWords, lastSaveWords, undoConfirmWords, undoneWords } from './al-leave-words.js';
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
 *             recheck: (o: { carry: Carry, receipt: string[], tone: 'ok'|'err', records?: Map<string, any[]>|null }) => Promise<void> }} CardHooks
 * @typedef {{ answers: Map<string, Map<string, string>> }} Carry
 */

/** A Save or an Undo is running. */
let _working = false;
/** The review on screen, for the page's "unsaved work?" question. @type {{ unsaved: () => boolean }|null} */
let _current = null;
/** A Save whose log could not yet be written (header). @type {{ digest: string, id: string, plans: any[], me: string }|null} */
let _pending = null;
let _seq = 0;

/** True while a Save or an Undo runs. */
export const alSaveWorking = () => _working;
/** True while answers or confirmations are on screen unsaved, or a Save or an Undo runs. */
export const alSaveUnsaved = () => _working || !!_current?.unsaved();
/** The card took its answer off the screen: nothing of the review is unsaved any more. */
export function dropReview() { _current = null; }

/** @param {string} tag @param {string} [cls] @param {string} [text] */
function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
}

/** The year whose logs are still needed: last year's, and this one's (al-leave-save.js → `pruneUploadLogs`). @param {string} todayStr */
const keepLogsFrom = todayStr => Number(todayStr.slice(0, 4)) - 1;

/**
 * Write the log of a Save that could not be recorded, from this check's fresh read (header). Null
 * when nothing is pending for this file; otherwise the line to add to the status.
 * @param {{ file: any, comparison: any, records: Map<string, any[]> }} a
 * @returns {Promise<string|null>}
 */
export async function finishPendingLog({ file, comparison, records }) {
    const p = _pending;
    if (!p || p.digest !== file.digest) return null;
    const lists = logLists({ after: comparison.people, plans: p.plans, recordsByName: records, savedBy: p.me });
    const fields = logFields({ file, ...lists, savedBy: p.me, appVersion: APP_VERSION });
    if (!fields) { _pending = null; return null; }
    try {
        await writeUploadLog(p.id, fields);
        _pending = null;
        return lists.added.length ? SAVE_WORDS.nowRecorded : null;
    } catch (err) {
        console.error('[AL sheet] an earlier Save is still not recorded:', /** @type {any} */ (err)?.code ?? 'unknown');
        return null;
    }
}

/**
 * The review of one check: what may be saved, and the controls that say so.
 * @param {{ file: any, comparison: any, records: Map<string, any[]>, logs: any[]|null, todayStr: string,
 *           me: string|null, carry?: Carry|null, hooks: CardHooks }} a  `logs` null: they could not be read
 */
export function createReview({ file, comparison, records, logs, todayStr, me, carry = null, hooks }) {
    const judged = logs ? judgeUploads({ logs, file }) : null;
    /** @type {null|'no-name'|'logs'|'age-unknown'|'too-old'|'older-copy'} */
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
    // The answers carried across a fresh check: each day the new check still asks about (header).
    for (const [name, was] of carry?.answers ?? []) {
        if (!people.has(name)) continue;
        const asked = new Set(planOf(name, false).questions);
        const kept = new Map([...was].filter(([d]) => asked.has(d)));
        if (kept.size) answers.set(name, kept);
    }
    const plans = () => [...confirmed].map(n => planOf(n, true)).filter(p => p.writes.length);

    const review = {
        refusal,
        unsaved: () => confirmed.size > 0 || [...answers.values()].some(m => m.size > 0),

        /** The summary's Save lines: why this file cannot be saved, and the last Save with its Undo. @param {HTMLElement} root */
        summary(root) {
            if (refusal) {
                const line = refusal === 'no-name' ? SAVE_WORDS.noName : refusal === 'logs' ? SAVE_WORDS.logsUnreadable
                    : refusalWords(refusal, { maxAge: LEAVE_FILE_MAX_AGE_DAYS, newest: judged?.newest
                        ? { clerksLastSaved: judged.newest.clerksLastSaved, savedAt: stampDate(judged.newest.savedAt) } : null });
                root.append(el('p', 'al-sheet-warn', line));
            }
            const last = judged?.newest;
            if (!last || !me || !Array.isArray(last.added) || !last.added.length || 'undoneAt' in last) return;
            const row = el('div', 'al-sheet-last');
            const undo = /** @type {HTMLButtonElement} */ (el('button', 'roster-cancel-btn al-sheet-undo', SAVE_WORDS.undo));
            undo.type = 'button';
            undo.addEventListener('click', () => { void runUndo(/** @type {any} */ (last)); });
            row.append(el('p', '', lastSaveWords({ savedAt: stampDate(last.savedAt), savedBy: last.savedBy, added: last.added.length })), undo);
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
            const member = teamMembers.find(m => m.name === p.name);
            const draw = () => {
                const would = planOf(p.name, true);
                unanswered.textContent = unansweredWords(would.unanswered.length);
                unanswered.hidden = !would.unanswered.length;
                nothing.hidden = would.writes.length > 0 || would.questions.length > 0;
                for (const n of [label, after, still]) n.hidden = !would.writes.length;
                if (!would.writes.length) { confirmed.delete(p.name); box.checked = false; return; }
                const swap = would.writes.filter(w => w.kind === 'swap').length;
                words.textContent = confirmWords({ name: p.name, add: would.writes.length - swap, swap });
                box.checked = confirmed.has(p.name);
                const a = comparePerson({ person: filePeople.get(p.name), days: daysOf(p.name), member,
                    records: recordsAfter(records.get(p.name) ?? [], would), year: file.year, todayStr,
                    firstDate: file.source.firstDate, lastDate: file.source.lastDate });
                after.textContent = afterWords(a);
                const left = a.needsALook ? chipsFor(a.counts, a.allowanceDiffers) : [];
                still.textContent = left.length ? stillDiffersWords(left) : '';
                still.hidden = !left.length;
            };
            redraw.set(p.name, draw);
            draw();
            body.append(panel);
        },

        /** The Save itself, under the people who need a look — or null when nothing here can be saved. */
        bar() {
            if (refusal || ![...people.keys()].some(n => planOf(n, true).writes.length || planOf(n, false).questions.length)) return null;
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
            button.addEventListener('click', () => { void runSave(); });
            return bar;
        },

        /** The card's closing line: what pressing Save does, or that this is a check only. */
        note: () => (refusal ? CARD_WORDS.checkOnly : SAVE_WORDS.saveable),
    };

    /** The answers, for the fresh check after a Save or an Undo (header). @returns {Carry} */
    const carryOn = () => ({ answers: new Map([...answers].map(([n, m]) => [n, new Map(m)])) });

    async function runSave() {
        const chosen = plans();
        if (_working || refusal || !chosen.length || !me) return;
        _working = true;
        hooks.lock(true);
        /** @type {Map<string, any[]>|null} */ let reread = null;
        /** @type {string[]} */ let receipt;
        let tone = /** @type {'ok'|'err'} */ ('err');
        try {
            const total = saveTotals(chosen).days;
            hooks.say([savingWords(0, total)], 'working');
            /** @type {Awaited<ReturnType<typeof saveLeavePlans>>} */ let out;
            try {
                out = await saveLeavePlans(chosen, { onProgress: (done, n) => hooks.say([savingWords(done, n)], 'working') });
            } catch (err) {
                console.error('[AL sheet] the Save failed:', /** @type {any} */ (err)?.code ?? /** @type {any} */ (err)?.name ?? 'unknown');
                out = { saved: new Map(), refused: new Map(), stopped: 'failed', code: null, partial: true };
            }
            /** @type {string[]} */ const logLines = [];
            if (out.saved.size || out.partial) {
                const id = newUploadLogId();
                try {
                    reread = await readMemberRecords([...people.keys()]);
                } catch (err) {
                    console.error('[AL sheet] the records were not read after the Save:', /** @type {any} */ (err)?.code ?? 'unknown');
                    _pending = { digest: file.digest, id, plans: chosen, me };
                    logLines.push(SAVE_WORDS.unreadAfter);
                }
                if (reread) logLines.push(...await record(id, chosen, reread));
            }
            // What was saved is what the server holds, once it has been read: a Save whose answer was lost
            // on the way back may have landed whole. Unread, it is what the Save saw confirmed — and where
            // more may have landed, the receipt does not say "nothing".
            const saved = reread ? landedWrites({ plans: chosen, recordsByName: reread, savedBy: me }) : out.saved;
            const finished = !!reread && chosen.every(p => out.refused.has(p.name) || (saved.get(p.name)?.length ?? 0) === p.writes.length);
            const days = [...saved.values()].reduce((n, d) => n + d.length, 0);
            receipt = receiptWords({ days, people: saved.size, refused: out.refused, unsure: !reread && out.partial });
            const stopped = finished ? null : out.stopped;   // read back whole, it did not stop part way
            if (stopped === 'offline') receipt.push(saved.size || out.partial ? SAVE_WORDS.lost : SAVE_WORDS.offlineNow);
            else if (stopped === 'unconfirmed') receipt.push(unconfirmedWriteLine({ code: out.code }, 'this Save', 'the Calendar') ?? SAVE_WORDS.failed);
            else if (stopped === 'failed') receipt.push(SAVE_WORDS.failed);
            receipt.push(...logLines);
            if (!out.refused.size && !stopped) tone = 'ok';
        } catch (err) {
            // A fault, not a refusal: every failure the Save expects is caught where it happens. It must
            // not leave "Saving…" on screen and the card locked for good, and what landed is unknown, so
            // the line says neither "saved" nor "nothing": the fresh check below shows what landed.
            console.error('[AL sheet] the Save’s answer failed:', /** @type {any} */ (err)?.name ?? 'unknown');
            receipt = [SAVE_WORDS.failed];
        }
        // Locked until the fresh check has drawn the new answer: the old controls were planned from a
        // check this Save has just made wrong.
        try { await hooks.recheck({ carry: carryOn(), receipt, tone, records: reread }); }
        finally { _working = false; hooks.lock(false); }
    }

    /**
     * The upload log, from the records read after the Save, then the old logs pruned. The lines to add.
     * @param {string} id @param {any[]} chosen @param {Map<string, any[]>} reread @returns {Promise<string[]>}
     */
    async function record(id, chosen, reread) {
        const after = [...people.values()].map(p => comparePerson({ person: filePeople.get(p.name), days: daysOf(p.name),
            member: teamMembers.find(m => m.name === p.name), records: reread.get(p.name) ?? [], year: file.year, todayStr,
            firstDate: file.source.firstDate, lastDate: file.source.lastDate }));
        const lists = logLists({ after, plans: chosen, recordsByName: reread, savedBy: /** @type {string} */ (me) });
        const fields = logFields({ file, ...lists, savedBy: /** @type {string} */ (me), appVersion: APP_VERSION });
        if (!fields) return lists.added.length ? [SAVE_WORDS.notRecorded] : [];
        try {
            await writeUploadLog(id, fields);
        } catch (err) {
            console.error('[AL sheet] the Save was not recorded:', /** @type {any} */ (err)?.code ?? 'unknown');
            return lists.added.length ? [SAVE_WORDS.notRecorded] : [];
        }
        await pruneUploadLogs(keepLogsFrom(todayStr));
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
        /** @type {string[]} */ let receipt;
        let tone = /** @type {'ok'|'err'} */ ('ok');
        try {
            const names = [...new Set(log.added.map((/** @type {string} */ k) => parseDayKey(k)?.name).filter(Boolean))];
            const res = await undoUpload(log, { recordsByName: await readMemberRecords(/** @type {string[]} */ (names)), undoneBy: me });
            receipt = undoneWords(res);
            if (res.kept.length) tone = 'err';
        } catch (err) {
            console.error('[AL sheet] the Undo stopped:', /** @type {any} */ (err)?.code ?? 'unknown');
            receipt = [SAVE_WORDS.undoStopped];
            tone = 'err';
        }
        try { await hooks.recheck({ carry: carryOn(), receipt, tone }); }
        finally { _working = false; hooks.lock(false); }
    }

    _current = review;
    return review;
}

/** A server stamp as a Date, or null. @param {any} t @returns {Date|null} */
function stampDate(t) {
    const ms = tsToMillis(t);
    return ms > 0 ? new Date(ms) : null;
}
