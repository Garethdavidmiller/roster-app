// @ts-check
/**
 * operations-al-sheet.js — the Annual leave sheet card on operations.html: a leave file in, the app's
 * own records beside it, every difference on screen. Phases 1 and 2b of the annual leave uploader
 * (docs/AL_UPLOADER_PLAN.md): it reads, compares and shows, and hands each person to the Save
 * (operations-al-save.js), which adds the leave the app is missing for the people the admin confirms.
 *
 * The file is made in a SESSION from the clerks' workbook (scripts/make-leave-file.mjs) and checked
 * here by the same module that made it (al-leave-file.js), so a file edited by hand is refused by its
 * seal. Each day is decided by the app's own leave rules (al-leave-compare.js) and said in words by
 * al-leave-words.js; this module only reads, wires and draws.
 *
 * ── ONE READ PER MEMBER, AND A CACHED READ IS NOT A READ ────────────────────────────────────────
 *
 * Each person's records are read whole (`where('memberName', '==', …)`) — the scope Admin settled on
 * (admin-override-coverage.js): a date window would miss next January's carried days and the bank
 * holidays a Dispatcher's allowance depends on. And offline, Firestore does not fail: it answers from
 * this device's cache, which can be partial or empty. A comparison drawn on that would report leave
 * "not in the app" that is, so a read served from the cache stops the whole check (`refuseCachedRead`,
 * admin-override-store.js, is the same rule). A record this device saved but has not sent is read as
 * its own copy (`overrideFromSnapshot`).
 *
 * ── THE ANSWER ON SCREEN IS ALWAYS FOR THE INPUT ON SCREEN ──────────────────────────────────────
 *
 * Every new input — a file chosen, text typed or pasted, Clear — takes the old answer and status line
 * off the screen and starts a new `generation`; a file read or a check that began under an older one
 * is dropped when it settles. The first cut kept an answer under a newer file's name, and let a slow
 * read land after a paste and be checked in its place (review, 14 Nov 2026). The file input is let go
 * the moment its file is taken (the name and text are kept here), because an input still holding a
 * file fires no `change` when the SAME file is chosen again — so a corrected copy saved over the old
 * one, or the retry "could not be read" asks for, did nothing at all.
 *
 * ── NOTHING IS KEPT ─────────────────────────────────────────────────────────────────────────────
 *
 * The file names colleagues against their leave. It is held in memory while the card shows it, and
 * Clear takes it off the screen; nothing is written to storage, and no error that could reach the
 * Error Log carries any of it — a refusal is returned and drawn, a failed read or check logs its code
 * or error name alone, never a message, which could quote the file.
 *
 * ── AN UPDATE WAITS WHILE IT IS ON SCREEN; UNSAVED ANSWERS ASK BEFORE THE PAGE IS LEFT ─────────
 *
 * `alSheetBusy()` is true while a check, a Save or an Undo runs and while an answer is on screen, and
 * Operations holds an update's reload on it (operations-app.js): forty people's differences are a long
 * read, and a reload half way through takes them away with no word. `alSheetUnsaved()` is narrower —
 * answers or confirmations not yet saved, or a Save or an Undo running — and it is what a notification
 * tap, a drawer link, sign-out and closing the tab ask about: until Phase 2b nothing here was unsaved,
 * and that question was untrue for a check (review, 14 Nov 2026). While a Save or an Undo runs every
 * control is locked, so no new input can start a check under it.
 */
import { sessionReady, getSession } from './session.js';
import { teamMembers, formatISO } from './roster-data.js';
import { readMemberRecords, readUploadLogs, CACHED_READ } from './al-leave-save.js';
import { createReview, finishPendingLog, alSaveWorking, alSaveUnsaved, dropReview } from './operations-al-save.js';
import { warnOnUnload, askBeforeLeavingByDrawer } from './page-session.js';
import { confirmDialog } from './overlay.js';
import { readLeaveFile, describeRefusal, leaveFileAgeDays, LEAVE_FILE_MAX_AGE_DAYS, LEAVE_FILE_MAX_BYTES } from './al-leave-file.js';
import { compareLeaveFile, leaveRecordability, NEEDS_A_LOOK } from './al-leave-compare.js';
import { dayLabel, sheetWords, appWords, figuresLine, personNotes, chipsFor, totalsEntries, ageWords, CARD_WORDS,
    checkedWords, overallWords, oldWords, unplacedWords, appOnlyWords, moreDaysWords, notComparedWords,
    beyondHeadWords, SAVE_WORDS } from './al-leave-words.js';

let _checking = false;
let _shown = false;

/**
 * True while a check, a Save or an Undo runs, or an answer is on screen — Operations holds an update's
 * reload on it. Today a Save runs only with its answer on screen, so `_shown` already holds the reload
 * through it; `alSaveWorking()` is what still holds it if that ever stops being so (mutation-checked:
 * removing it alone changes nothing a test can see, by design).
 */
export function alSheetBusy() {
    return _checking || _shown || alSaveWorking();
}

/** True while answers or confirmations are unsaved, or a Save or an Undo runs — what leaving the page asks about. */
export const alSheetUnsaved = alSaveUnsaved;

/** @param {string} tag @param {string} [cls] @param {string} [text] */
function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
}

/**
 * Wire the card. Every element is looked up by id; a page without the card is left alone.
 * @param {{ fileReader?: (f: File) => Promise<string>, today?: () => string }} [opts]
 *        seams for the browser tests: how a picked file is read, and what today is
 */
export function initAlSheetCard(opts = {}) {
    const fileInput = /** @type {HTMLInputElement|null} */ (document.getElementById('alSheetFileInput'));
    const fileName = document.getElementById('alSheetFileName');
    const paste = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('alSheetPaste'));
    const checkBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('alSheetCheckBtn'));
    const feedback = document.getElementById('alSheetFeedback');
    const result = document.getElementById('alSheetResult');
    const clearBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('alSheetClearBtn'));
    if (!fileInput || !fileName || !paste || !checkBtn || !feedback || !result || !clearBtn) return;
    const readFile = opts.fileReader ?? (f => f.text());
    const today = opts.today ?? (() => formatISO(new Date()));
    /** @type {string|null} */ let fileText = null;
    /** Bumped by every new input; a read or check from an older one is dropped (header). */
    let generation = 0;
    /** Every control is locked while a Save or an Undo runs (header). */
    let locked = false;
    // The receipt after a Save is focused, so a reader at the foot of a long list is taken to it.
    feedback.tabIndex = -1;

    const sync = () => { checkBtn.disabled = _checking || locked || !(fileText ?? paste.value.trim()); };
    /** @param {string[]} lines @param {'ok'|'err'|'working'} tone */
    const say = (lines, tone) => {
        feedback.replaceChildren(...lines.map(l => el('p', '', l)));
        feedback.className = `huddle-feedback huddle-feedback--${tone}`;
    };
    const clearResult = () => {
        result.replaceChildren();
        result.hidden = true;
        clearBtn.hidden = true;
        _shown = false;
        dropReview();
    };
    /** A new input: the old answer and status go, and anything still in flight is stale. */
    const fresh = () => { generation++; clearResult(); say([], 'ok'); };
    const dropFile = () => {
        fileText = null;
        fileInput.value = '';
        fileName.textContent = '';
        fileName.classList.remove('visible');
    };
    // Unsaved answers ask before the page is left — a phone never shows the browser's own question.
    warnOnUnload(alSaveUnsaved);
    askBeforeLeavingByDrawer(alSaveUnsaved);

    // The most recent of the two ways in wins: picking a file empties the paste box, and typing
    // in the paste box lets go of the file, so the Check button never reads one while showing the other.
    fileInput.addEventListener('change', async () => {
        const f = fileInput.files?.[0];
        fresh();
        const mine = generation;
        dropFile();
        if (!f) { sync(); return; }
        paste.value = '';
        fileName.textContent = f.name;
        fileName.classList.add('visible');
        // Refused before it is read: a large file chosen by mistake is never loaded into memory.
        if (f.size > LEAVE_FILE_MAX_BYTES) { say([describeRefusal({ code: 'too-large' })], 'err'); sync(); return; }
        sync();
        /** @type {string|null} */ let text = null;
        try { text = await readFile(f); } catch { if (mine === generation) say([CARD_WORDS.unreadable], 'err'); }
        if (mine !== generation) return;   // a newer input arrived while this file was read
        fileText = text;
        sync();
    });
    paste.addEventListener('input', () => {
        fresh();
        // Typing lets go of a chosen file — one still being read included, whose read is now stale.
        if (paste.value.trim()) dropFile();
        sync();
    });

    clearBtn.addEventListener('click', async () => {
        if (alSaveUnsaved() && !(await confirmDialog({ message: SAVE_WORDS.clearAsk, confirmLabel: 'Clear' }))) return;
        fresh();
        dropFile();
        paste.value = '';
        sync();
        // Clear hides itself, so focus would fall to the page: hand it to the file control, where the
        // next check starts (review, 14 Nov 2026).
        fileInput.focus();
    });

    /**
     * Check a file against the app and draw the answer. After a Save or an Undo it runs again with the
     * receipt to show and the answers to carry across (operations-al-save.js), and with the records the
     * Save has just read, when it has.
     */
    const check = async (/** @type {string} */ text, /** @type {{ carry?: any, receipt?: string[]|null, tone?: 'ok'|'err', records?: Map<string, any[]>|null }} */ { carry = null, receipt = null, tone = 'ok', records: given = null } = {}) => {
        const mine = generation;
        const stale = () => mine !== generation;
        const fail = (/** @type {string} */ line) => { if (!stale()) { clearResult(); say([...(receipt ?? []), line], 'err'); } };
        _checking = true;
        sync();
        if (!receipt) { clearResult(); say([CARD_WORDS.checking], 'working'); }
        try {
            const read = await readLeaveFile(text);
            if (stale()) return;
            if (!read.ok) { clearResult(); say(read.refusals.map(describeRefusal), 'err'); return; }
            const file = read.file;
            await sessionReady;
            const names = file.people.map((/** @type {any} */ p) => p.name)
                .filter((/** @type {string} */ n) => leaveRecordability(teamMembers.find(m => m.name === n), file.year) === null);
            /** @type {Map<string, any[]>} */ let records;
            try {
                records = given ?? await readMemberRecords(names);
            } catch (err) {
                const code = /** @type {any} */ (err)?.code;
                console.error('[AL sheet] reading the app’s records failed:', code ?? 'unknown');
                fail(code === CACHED_READ ? CARD_WORDS.offline : CARD_WORDS.readFailed);
                return;
            }
            if (stale()) return;
            // The upload logs say whether this copy may be saved at all; unread, the card is a check only.
            /** @type {any[]|null} */ let logs = null;
            const readLogs = async () => {
                try { return await readUploadLogs(file.year); } catch (err) {
                    console.error('[AL sheet] the record of earlier Saves was not read:', /** @type {any} */ (err)?.code ?? 'unknown');
                    return null;
                }
            };
            logs = await readLogs();
            if (stale()) return;
            const todayStr = today();
            const comparison = compareLeaveFile({ file, members: teamMembers, recordsByName: records, todayStr });
            const finished = logs ? await finishPendingLog({ file, comparison, records }) : null;
            if (finished) logs = await readLogs();
            if (stale()) return;
            clearResult();
            const review = createReview({ file, comparison, records, logs, todayStr, me: getSession()?.name ?? null, carry, hooks });
            render(result, file, comparison, todayStr, review);
            result.hidden = false;
            clearBtn.hidden = false;
            _shown = true;
            const extra = finished ? [finished] : [];
            say(receipt ? [...receipt, ...extra] : [checkedWords(comparison.totals.people), ...extra], receipt ? tone : 'ok');
        } catch (err) {
            // A fault, not a refusal — nothing above is meant to throw. It must not leave "Checking…" on
            // screen for good, and its message is not logged: it could quote the file (header).
            console.error('[AL sheet] the check failed:', /** @type {any} */ (err)?.name ?? 'unknown');
            // After a Save the receipt above says what was saved, so "Nothing was saved" would contradict it.
            fail(receipt ? SAVE_WORDS.recheckFailed : CARD_WORDS.failed);
        } finally {
            _checking = false;
            sync();
        }
    };

    /** @type {import('./operations-al-save.js').CardHooks} */
    const hooks = {
        say,
        lock(on) {
            locked = on;
            fileInput.disabled = on; paste.disabled = on; clearBtn.disabled = on;
            result.inert = on;
            sync();
        },
        async recheck({ carry, receipt, tone, records = null }) {
            const text = fileText ?? paste.value;
            if (!text.trim()) { say(receipt, tone); return; }
            await check(text, { carry, receipt, tone, records });
            feedback.focus();
        },
    };

    checkBtn.addEventListener('click', () => {
        if (_checking || locked) return;
        const text = fileText ?? paste.value;
        if (!text.trim()) return;
        void check(text);
    });
    sync();
}

/**
 * Draw the comparison, and the Save's controls where the review puts them (operations-al-save.js).
 * Text only — every name, date and word goes in through `textContent`.
 * @param {HTMLElement} root @param {any} file
 * @param {ReturnType<typeof compareLeaveFile>} c @param {string} todayStr
 * @param {ReturnType<typeof createReview>} review
 */
function render(root, file, c, todayStr, review) {
    const age = ageWords({ saved: file.source.clerksLastSaved, ageDays: leaveFileAgeDays(file, todayStr), maxAge: LEAVE_FILE_MAX_AGE_DAYS });
    const summary = el('div', 'al-sheet-summary');
    summary.append(el('p', 'al-sheet-age', age.line));
    // A copy the Save refuses for its age says so once, in the refusal's own words, which name the age.
    const ageRefused = review.refusal === 'too-old' || review.refusal === 'age-unknown';
    if (age.unknown && !ageRefused) summary.append(el('p', 'al-sheet-warn', CARD_WORDS.ageUnknown));
    else if (age.old && !ageRefused) summary.append(el('p', 'al-sheet-warn', oldWords(LEAVE_FILE_MAX_AGE_DAYS)));
    if (file.source.lastSavedByClerk === false) {
        summary.append(el('p', 'al-sheet-warn', CARD_WORDS.notByClerk));
    }
    review.summary(summary);
    summary.append(el('p', 'al-sheet-overall', overallWords(c.totals.needsALook, c.totals.people)));
    const lines = totalsEntries(c.totals, c.people.filter(p => p.allowanceDiffers).length);
    if (lines.length) {
        const ul = el('ul', 'al-sheet-totals');
        for (const l of lines) ul.append(el('li', `al-sheet-total--${l.key}`, l.text));
        summary.append(ul);
    }
    root.append(summary);

    const needing = c.people.filter(p => p.needsALook);
    const agreeing = c.people.filter(p => !p.needsALook);
    if (needing.length) {
        root.append(el('h3', 'al-sheet-heading', CARD_WORDS.needsALook));
        const list = el('div', 'al-sheet-people');
        for (const p of needing) list.append(personBlock(p, file, review));
        root.append(list);
        const bar = review.bar();
        if (bar) root.append(bar);
    }
    // The people who agree sit in ONE closed fold that says how many. They are the reassurance, not
    // the work: open, forty folds of agreement pushed who was not compared and who is missing a
    // screen-height below the people who need a look (polish, 14 Nov 2026).
    if (agreeing.length) {
        const group = el('details', 'al-sheet-group');
        const head = el('summary', 'al-sheet-group-head');
        head.append(el('h3', 'al-sheet-heading', CARD_WORDS.agree), el('span', 'al-sheet-count', String(agreeing.length)));
        const list = el('div', 'al-sheet-people');
        for (const p of agreeing) list.append(personBlock(p, file, null));
        group.append(head, list);
        root.append(group);
    }
    const notChecked = [...c.notChecked, ...c.notInFile];
    if (notChecked.length) {
        root.append(el('h3', 'al-sheet-heading', CARD_WORDS.notCompared));
        const ul = el('ul', 'al-sheet-list');
        for (const n of notChecked) ul.append(el('li', '', notComparedWords(n)));
        root.append(ul);
    }
    if (c.absent.length) {
        root.append(el('h3', 'al-sheet-heading', CARD_WORDS.absent));
        root.append(el('p', 'al-sheet-names', c.absent.join(', ')));
    }
    if (file.unplacedSundayTags > 0) {
        root.append(el('p', 'al-sheet-note', unplacedWords(file.unplacedSundayTags)));
    }
    root.append(el('p', 'al-sheet-note', review.note()));
}

/**
 * One person: their figures and chips on the summary row, their days inside — and, for a person who
 * needs a look, the review's question on each day it asks about and their confirmation at the foot.
 * @param {import('./al-leave-compare.js').PersonComparison} p @param {any} file
 * @param {ReturnType<typeof createReview>|null} review
 */
function personBlock(p, file, review) {
    const year = file.year;
    const block = el('details', 'al-sheet-person');
    const summary = el('summary', 'al-sheet-person-head');
    const top = el('span', 'al-sheet-person-top');
    top.append(el('span', 'al-sheet-name', p.name), el('span', 'al-sheet-grade', p.grade));
    summary.append(top, el('span', 'al-sheet-figures', figuresLine(p)));
    const chips = chipsFor(p.counts, p.allowanceDiffers);
    if (chips.length) {
        const row = el('span', 'al-sheet-chips');
        for (const ch of chips) row.append(el('span', `al-sheet-chip al-sheet-chip--${ch.key}`, ch.text));
        summary.append(row);
    }
    block.append(summary);

    const body = el('div', 'al-sheet-person-body');
    for (const note of personNotes(p, year)) body.append(el('p', 'al-sheet-explain', note));
    const differing = p.days.filter(d => NEEDS_A_LOOK.includes(d.state));
    const rest = p.days.filter(d => !NEEDS_A_LOOK.includes(d.state));
    if (differing.length) body.append(dayList(differing, year, review ? (d, li) => review.day(p, d, li) : null));
    if (p.appOnly.length) {
        body.append(el('p', 'al-sheet-subhead', CARD_WORDS.appOnlyHead));
        body.append(extraList(p.appOnly.map(a => [a.date, appOnlyWords(a.chargedTo)]), 'app-only'));
    }
    if (p.beyond.length) {
        body.append(el('p', 'al-sheet-subhead', beyondHeadWords(year)));
        body.append(extraList(p.beyond.map(d => [d, CARD_WORDS.beyondDay]), 'beyond'));
    }
    if (rest.length) {
        const more = el('details', 'al-sheet-more');
        more.append(el('summary', '', moreDaysWords(rest.length)));
        more.append(dayList(rest, year));
        body.append(more);
    }
    if (!p.days.length && !p.appOnly.length && !p.beyond.length) body.append(el('p', 'al-sheet-explain', CARD_WORDS.noDays));
    review?.person(p, body);
    block.append(body);
    return block;
}

/**
 * @param {import('./al-leave-compare.js').DayComparison[]} days @param {number} year
 * @param {((d: any, li: HTMLElement) => void)|null} [onDay] what the review adds to a day's row
 */
function dayList(days, year, onDay = null) {
    const ul = el('ul', 'al-sheet-days');
    for (const d of days) {
        const li = el('li', `al-sheet-day al-sheet-day--${d.state}`);
        li.append(el('span', 'al-sheet-date', dayLabel(d.date)),
            el('span', 'al-sheet-sheet', sheetWords(d.foundIn, d.kind)),
            el('span', 'al-sheet-app', appWords(d, year)));
        onDay?.(d, li);
        ul.append(li);
    }
    return ul;
}

/** Days the sheet does not have, each with what the app says of it. @param {Array<[string, string]>} rows @param {string} kind */
function extraList(rows, kind) {
    const ul = el('ul', 'al-sheet-days');
    for (const [date, words] of rows) {
        const li = el('li', `al-sheet-day al-sheet-day--${kind}`);
        li.append(el('span', 'al-sheet-date', dayLabel(date)), el('span', 'al-sheet-app', words));
        ul.append(li);
    }
    return ul;
}
