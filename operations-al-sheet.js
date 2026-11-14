// @ts-check
/**
 * operations-al-sheet.js — the Annual leave sheet card on operations.html: a leave file in, the app's
 * own records beside it, every difference on screen. Phase 1 of the annual leave uploader
 * (docs/AL_UPLOADER_PLAN.md): there is NO Save. It reads, compares and shows.
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
 * ── AN UPDATE WAITS WHILE IT IS ON SCREEN; A NOTIFICATION TAP DOES NOT ─────────────────────────
 *
 * `alSheetBusy()` is true while a check runs and while its answer is on screen, and Operations holds
 * an update's reload on it (operations-app.js): forty people's differences are a long read, and a
 * reload half way through takes them away with no word. A notification tap is not held: it is the
 * reader's own choice, nothing here is unsaved, and the question it would raise ("unsaved changes or
 * a save still on its way") was untrue for a check that saves nothing (review, 14 Nov 2026).
 */
import { db, collection, query, where, getDocs, COLLECTIONS } from './firebase-client.js';
import { sessionReady } from './session.js';
import { teamMembers, formatISO } from './roster-data.js';
import { overrideFromSnapshot } from './override-compare.js';
import { readLeaveFile, describeRefusal, leaveFileAgeDays, LEAVE_FILE_MAX_AGE_DAYS, LEAVE_FILE_MAX_BYTES } from './al-leave-file.js';
import { compareLeaveFile, leaveRecordability, NEEDS_A_LOOK } from './al-leave-compare.js';
import { dayLabel, sheetWords, appWords, figuresLine, personNotes, chipsFor, totalsEntries, ageWords, CARD_WORDS,
    checkedWords, overallWords, oldWords, unplacedWords, appOnlyWords, moreDaysWords, notComparedWords,
    beyondHeadWords } from './al-leave-words.js';

/** How many members' records are read at once: enough to be quick, few enough to be gentle. */
const READ_CONCURRENCY = 6;

let _checking = false;
let _shown = false;

/** True while a check runs or its answer is on screen — Operations holds an update's reload on it. */
export function alSheetBusy() {
    return _checking || _shown;
}

/** @param {string} tag @param {string} [cls] @param {string} [text] */
function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
}

/**
 * Read every listed member's records, a few at a time. Throws `{ code }` on the first failure —
 * 'offline' for a read served from the cache — and never with a name in it.
 * @param {string[]} names
 * @returns {Promise<Map<string, any[]>>}
 */
async function readRecords(names) {
    /** @type {Map<string, any[]>} */ const out = new Map();
    let next = 0;
    async function worker() {
        while (next < names.length) {
            const name = names[next++];
            const snap = await getDocs(query(collection(db, COLLECTIONS.overrides), where('memberName', '==', name)));
            if (snap?.metadata?.fromCache) throw Object.assign(new Error('read served from the offline cache'), { code: 'offline' });
            /** @type {any[]} */ const rows = [];
            snap.forEach(/** @param {any} d */ d => rows.push(overrideFromSnapshot(d)));
            out.set(name, rows);
        }
    }
    await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, names.length) }, worker));
    return out;
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

    const sync = () => { checkBtn.disabled = _checking || !(fileText ?? paste.value.trim()); };
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
    };
    /** A new input: the old answer and status go, and anything still in flight is stale. */
    const fresh = () => { generation++; clearResult(); say([], 'ok'); };
    const dropFile = () => {
        fileText = null;
        fileInput.value = '';
        fileName.textContent = '';
        fileName.classList.remove('visible');
    };

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

    clearBtn.addEventListener('click', () => {
        fresh();
        dropFile();
        paste.value = '';
        sync();
        // Clear hides itself, so focus would fall to the page: hand it to the file control, where the
        // next check starts (review, 14 Nov 2026).
        fileInput.focus();
    });

    checkBtn.addEventListener('click', async () => {
        if (_checking) return;
        const text = fileText ?? paste.value;
        if (!text.trim()) return;
        const mine = generation;
        const stale = () => mine !== generation;
        _checking = true;
        sync();
        clearResult();
        say([CARD_WORDS.checking], 'working');
        try {
            const read = await readLeaveFile(text);
            if (stale()) return;
            if (!read.ok) { say(read.refusals.map(describeRefusal), 'err'); return; }
            const file = read.file;
            await sessionReady;
            const names = file.people.map((/** @type {any} */ p) => p.name)
                .filter((/** @type {string} */ n) => leaveRecordability(teamMembers.find(m => m.name === n), file.year) === null);
            /** @type {Map<string, any[]>} */ let records;
            try {
                records = await readRecords(names);
            } catch (err) {
                const code = /** @type {any} */ (err)?.code;
                console.error('[AL sheet] reading the app’s records failed:', code ?? 'unknown');
                if (!stale()) say([code === 'offline' ? CARD_WORDS.offline : CARD_WORDS.readFailed], 'err');
                return;
            }
            if (stale()) return;
            const todayStr = today();
            const comparison = compareLeaveFile({ file, members: teamMembers, recordsByName: records, todayStr });
            render(result, file, comparison, todayStr);
            result.hidden = false;
            clearBtn.hidden = false;
            _shown = true;
            say([checkedWords(comparison.totals.people)], 'ok');
        } catch (err) {
            // A fault, not a refusal — nothing above is meant to throw. It must not leave "Checking…" on
            // screen for good, and its message is not logged: it could quote the file (header).
            console.error('[AL sheet] the check failed:', /** @type {any} */ (err)?.name ?? 'unknown');
            if (!stale()) { clearResult(); say([CARD_WORDS.failed], 'err'); }
        } finally {
            _checking = false;
            sync();
        }
    });
    sync();
}

/**
 * Draw the comparison. Text only — every name, date and word goes in through `textContent`.
 * @param {HTMLElement} root @param {any} file
 * @param {ReturnType<typeof compareLeaveFile>} c @param {string} todayStr
 */
function render(root, file, c, todayStr) {
    const age = ageWords({ saved: file.source.clerksLastSaved, ageDays: leaveFileAgeDays(file, todayStr), maxAge: LEAVE_FILE_MAX_AGE_DAYS });
    const summary = el('div', 'al-sheet-summary');
    summary.append(el('p', 'al-sheet-age', age.line));
    if (age.unknown) summary.append(el('p', 'al-sheet-warn', CARD_WORDS.ageUnknown));
    else if (age.old) summary.append(el('p', 'al-sheet-warn', oldWords(LEAVE_FILE_MAX_AGE_DAYS)));
    if (file.source.lastSavedByClerk === false) {
        summary.append(el('p', 'al-sheet-warn', CARD_WORDS.notByClerk));
    }
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
        for (const p of needing) list.append(personBlock(p, file));
        root.append(list);
    }
    // The people who agree sit in ONE closed fold that says how many. They are the reassurance, not
    // the work: open, forty folds of agreement pushed who was not compared and who is missing a
    // screen-height below the people who need a look (polish, 14 Nov 2026).
    if (agreeing.length) {
        const group = el('details', 'al-sheet-group');
        const head = el('summary', 'al-sheet-group-head');
        head.append(el('h3', 'al-sheet-heading', CARD_WORDS.agree), el('span', 'al-sheet-count', String(agreeing.length)));
        const list = el('div', 'al-sheet-people');
        for (const p of agreeing) list.append(personBlock(p, file));
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
    root.append(el('p', 'al-sheet-note', CARD_WORDS.checkOnly));
}

/**
 * One person: their figures and chips on the summary row, their days inside.
 * @param {import('./al-leave-compare.js').PersonComparison} p @param {any} file
 */
function personBlock(p, file) {
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
    if (differing.length) body.append(dayList(differing, year));
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
    block.append(body);
    return block;
}

/** @param {import('./al-leave-compare.js').DayComparison[]} days @param {number} year */
function dayList(days, year) {
    const ul = el('ul', 'al-sheet-days');
    for (const d of days) {
        const li = el('li', `al-sheet-day al-sheet-day--${d.state}`);
        li.append(el('span', 'al-sheet-date', dayLabel(d.date)),
            el('span', 'al-sheet-sheet', sheetWords(d.foundIn, d.kind)),
            el('span', 'al-sheet-app', appWords(d, year)));
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
