// @ts-check
/**
 * operations-doc-links.js — Operations → Document links: give every stored Huddle, Circular and
 * Newsletter file a NEW link, so that every old copy of its link stops working (owner, 12 Nov 2026 —
 * ARCHITECTURE.md EXC-007). The work is the server's: `rotateDocumentLinks` in functions/documents.js,
 * whose rules (the three steps, what it leaves alone) are functions/doc-link-rotation.js.
 *
 * ── CHECK FIRST, THEN REPLACE, BEHIND A CONFIRM ──────────────────────────────
 * "Check the links" asks for a PREVIEW (`rotate: false`), which counts and changes nothing, and says
 * in plain words what a run would touch. Only then is "Replace the links" offered, and it asks again
 * before it runs. The server is the safety, not this card: a body that does not say `rotate: true`
 * exactly is a preview there too.
 *
 * ── THREE OUTCOMES, THREE SENTENCES ──────────────────────────────────────────
 * It worked · it did not run · nobody knows. A run whose answer never came back may well have
 * finished, so it is never reported as failed — and never as done. It says so, and that running it
 * again is safe, which it is: a run only ever issues fresh keys. A refusal (4xx, but not a 408
 * timeout) and the endpoint's own "could not read" (503 with `changed: false` — the platform has
 * 503s of its own) both mean nothing ran, and say that. So does a request that never LEFT — the
 * sign-in token could not be had, so nothing was sent (`requestLinkRotation` marks it). A failed fetch
 * is still nobody-knows: the browser says "Failed to fetch" both when it never connected and when the
 * connection dropped after the request had gone.
 *
 * ── A PREVIEW THAT COULD NOT CHECK SAYS SO ───────────────────────────────────
 * Files whose keys could not be read are counted in no box, so a preview that read none of them
 * looks exactly like one that found nothing worth replacing. When nothing can be offered and some
 * files went unchecked, the card leads with that and asks for another check — never "No file has a
 * link that still works", which may be untrue of every one of them.
 *
 * ── NEWER FIELDS MAY BE ABSENT ───────────────────────────────────────────────
 * `unlinkedTooNew` (unused files too new to lose their key), `recordsDeadLink` (documents whose
 * stored link no longer opens their file) and `recordsMended` (those a run gave a working link — all
 * three in the server's header) arrived after the card did, and Functions and Hosting deploy in
 * parallel, so an older server's report lacks them: each is read as none. Present and malformed, any
 * of them makes the answer unreadable like any other count. An older card ignores all three, and still
 * offers Replace for a dead link, whose file it counts as in use.
 *
 * ── A DOCUMENT WHOSE LINK NO LONGER OPENS ITS FILE ───────────────────────────
 * Said in what it means for staff — nothing, until the app's fresh link cannot be had, because that
 * is what they open documents with — and that Replace mends it. Such a document's file is always one
 * counted as in use (the server counts dead links nowhere else), so Replace is already offered for it;
 * it is not added to the offer separately, which would offer Replace with no file to confirm. A run
 * then says how many such documents it gave a working link (`recordsMended`): the check promised it.
 *
 * ── AN UPDATE WAITS FOR THE ANSWER (v25.92) ──────────────────────────────────
 * A run can take minutes, and its report is the only record of what it did: a check made after a
 * run reads exactly like one made before it, because a file with a new link is still a file in use.
 * So while a check or a run waits for its answer, `docLinksRequestInFlight()` is true and Operations
 * holds an update's reload (operations-app.js `_opsBusy`) — before this, a release landing mid-run
 * reloaded the page under it, and the run went on, or did not, with nobody left to read what it did.
 * The count covers the request, from the token to the answer; once the report is on screen the page
 * is no longer busy, as with every other card.
 *
 * Exported pieces are pure apart from `initDocLinksCard` and the count it keeps, so the wording and
 * the request are tested in Node (operations-doc-links.test.mjs) and the wiring in the browser
 * (e2e/operations.spec.js).
 */
import { fetchWithTimeout, serverRefusal } from './fetch-timeout.js';

/** Admin-only Cloud Function — a preview unless the body says `rotate: true`. */
export const ROTATE_LINKS_URL = 'https://europe-west2-myb-roster.cloudfunctions.net/rotateDocumentLinks';
/** Past the endpoint's own 300 s limit, so the platform's answer arrives before this gives up. */
const ROTATE_TIMEOUT_MS = 310_000;

/** This card's requests still waiting for an answer — a check or a run (the header, v25.92). */
let _inFlight = 0;

/**
 * Whether a check or a run is still waiting for the server's answer — Operations' sign that an
 * update's reload must wait (operations-app.js `_opsBusy`).
 * @returns {boolean}
 */
export function docLinksRequestInFlight() {
    return _inFlight > 0;
}

/** "1 file" / "3 files". @param {number} n @param {string} one @param {string} many */
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Files a link this cannot read may open: left exactly as they are, old links and all. @param {number} n */
const heldLine = (n) => (n === 1
    ? '1 file is left as it is, old link and all: a document’s link this can’t read may open it.'
    : `${n} files are left as they are, old links and all: documents’ links this can’t read may open them.`);

/**
 * Unused files from the last day, whose links a run leaves working: an upload may still be saving
 * the document that names one (the server's header).
 * @param {number} n @param {boolean} ran  a run's report rather than a preview's
 */
const tooNewLine = (n, ran) => (n === 1
    ? `1 file from the last day isn’t used by the app, so its link ${ran ? 'was' : 'is'} left working, in case an upload is still saving the document that uses it. Check again tomorrow to finish it.`
    : `${n} files from the last day aren’t used by the app, so their links ${ran ? 'were' : 'are'} left working, in case uploads are still saving the documents that use them. Check again tomorrow to finish them.`);

/**
 * Documents whose stored link names a key their file no longer carries. Staff still open them; only
 * the fallback is broken, and a run mends it (the server's header).
 * @param {number} n
 */
const deadLinkLine = (n) => (n === 1
    ? '1 document’s link no longer opens its file. Staff still open the document — the app opens it with a fresh link of its own, and uses this one only if that fails. Replacing the links fixes it.'
    : `${n} documents’ links no longer open their files. Staff still open the documents — the app opens them with fresh links of its own, and uses these only if that fails. Replacing the links fixes them.`);

/**
 * Documents whose dead stored link a run moved onto its file's new key, so it opens the file again —
 * what the preview's dead-link line said Replace would do (the server's header).
 * @param {number} n
 */
const mendedLine = (n) => (n === 1
    ? '1 document whose link no longer opened its file now has a working link.'
    : `${n} documents whose links no longer opened their files now have working links.`);

/** What `requestLinkRotation` throws when the request never left, so nothing reached the server. */
const NOT_SENT = 'doc-links/not-sent';

/**
 * Ask the server for a preview, or for a run. A token that cannot be had is thrown as NOT_SENT: no
 * request left, so a run cannot have started (`runFailure`).
 * @param {{ rotate: boolean, getToken: () => Promise<string>, fetchFn?: typeof fetchWithTimeout }} opts
 * @returns {Promise<any>} the server's report
 */
export async function requestLinkRotation({ rotate, getToken, fetchFn = fetchWithTimeout }) {
    let token;
    try {
        token = await getToken();
    } catch (err) {
        throw Object.assign(new Error('The request was not sent: no sign-in token.'), { code: NOT_SENT, cause: err });
    }
    const r = await fetchFn(ROTATE_LINKS_URL, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rotate: rotate === true }),
    }, ROTATE_TIMEOUT_MS);
    if (!r.ok) { const e = await r.text(); throw new Error(`Server responded ${r.status}: ${e}`); }
    return r.json();
}

/** A count this card can read. @param {any} n */
const isCount = (n) => Number.isInteger(n) && n >= 0;

/**
 * A report this card can read — every count a number, and the failures a list. The newer counts may
 * be absent (an older server — the header), but not malformed.
 * @param {any} r
 */
function isReport(r) {
    return !!r && typeof r === 'object' && Array.isArray(r.failed)
        && ['files', 'linked', 'unlinkedWithKey', 'held', 'recordsMissingFile', 'recordsUnreadable',
            'rotated', 'cleared', 'changedDuringRun'].every(k => isCount(r[k]))
        && ['unlinkedTooNew', 'recordsDeadLink', 'recordsMended'].every(k => r[k] === undefined || isCount(r[k]));
}

/**
 * What a preview found, as the lines the card shows. `null`: an answer that cannot be read — which is
 * NOT "nothing to replace", and must never be shown as one.
 * @param {any} report
 * @returns {{ lines: string[], canReplace: boolean } | null}
 */
export function describePreview(report) {
    if (!isReport(report) || report.rotate !== false) return null;
    const { files, linked, unlinkedWithKey, recordsMissingFile, recordsUnreadable } = report;
    const tooNew = report.unlinkedTooNew ?? 0;
    const deadLinks = report.recordsDeadLink ?? 0;
    const unchecked = report.failed.length;
    const lines = [];
    if (linked) {
        lines.push(linked === 1
            ? '1 file is in use. It gets a new link, and old copies of its link stop working.'
            : `${linked} files are in use. Each gets a new link, and old copies of their links stop working.`);
    }
    if (deadLinks) lines.push(deadLinkLine(deadLinks));
    if (unlinkedWithKey) {
        lines.push(unlinkedWithKey === 1
            ? '1 older file is no longer used by the app. Its link will simply stop working.'
            : `${unlinkedWithKey} older files are no longer used by the app. Their links will simply stop working.`);
    }
    if (tooNew) lines.push(tooNewLine(tooNew, false));
    if (recordsMissingFile) {
        lines.push(recordsMissingFile === 1
            ? '1 document points at a file that is no longer there, so its link already doesn’t work.'
            : `${recordsMissingFile} documents point at files that are no longer there, so their links already don’t work.`);
    }
    if (recordsUnreadable) {
        lines.push(recordsUnreadable === 1
            ? '1 document has a link this can’t read. It will be left as it is.'
            : `${recordsUnreadable} documents have links this can’t read. They will be left as they are.`);
    }
    if (report.held) lines.push(heldLine(report.held));
    // A dead link's file is among those in use, so `linked` already offers Replace for it (the header).
    const canReplace = linked + unlinkedWithKey > 0;
    if (canReplace) {
        if (unchecked) lines.push(`${count(unchecked, 'file', 'files')} couldn’t be checked.`);
        lines.push('Nothing has changed yet. Staff won’t notice the change: the app opens documents with fresh links of its own.');
    } else if (unchecked) {
        // Unchecked files are in no box above, so "nothing to replace" may be untrue of every one.
        lines.unshift(`${count(unchecked, 'file', 'files')} couldn’t be checked, so it isn’t known yet whether there is anything to replace. Check the links again in a minute.`);
    } else {
        lines.unshift(files === 0
            ? 'No Huddle, Circular or Newsletter files were found, so there is nothing to replace.'
            : report.held
                ? 'There is nothing this can safely replace.'
                : tooNew
                    ? 'There is nothing to replace yet.'
                    : 'No file has a link that still works, so there is nothing to replace.');
    }
    return { lines, canReplace };
}

/**
 * What a run did. `null` for an answer that cannot be read.
 * @param {any} report
 * @returns {{ lines: string[], ok: boolean } | null}  ok: nothing failed
 */
export function describeResult(report) {
    if (!isReport(report) || report.rotate !== true) return null;
    const { rotated, cleared, changedDuringRun, failed } = report;
    const tooNew = report.unlinkedTooNew ?? 0;
    const mended = report.recordsMended ?? 0;
    const lines = [];
    if (rotated) {
        lines.push(rotated === 1
            ? 'Done. 1 file has a new link, so old copies of its link no longer work.'
            : `Done. ${rotated} files have new links, so old copies of their links no longer work.`);
    }
    if (cleared) {
        lines.push(`${rotated ? '' : 'Done. '}${cleared === 1
            ? '1 unused file had its link switched off.'
            : `${cleared} unused files had their links switched off.`}`);
    }
    if (mended) lines.push(mendedLine(mended));
    if (tooNew) lines.push(tooNewLine(tooNew, true));
    if (changedDuringRun) {
        lines.push(changedDuringRun === 1
            ? '1 file changed while this ran — a new upload, perhaps — so it was left alone. Check the links again to finish it.'
            : `${changedDuringRun} files changed while this ran — new uploads, perhaps — so they were left alone. Check the links again to finish them.`);
    }
    if (report.held) lines.push(heldLine(report.held));
    if (failed.length) {
        lines.push(failed.length === 1
            ? '1 file couldn’t be changed, and its old link still works. Press Replace the links again — it’s safe to run again.'
            : `${failed.length} files couldn’t be changed, and their old links still work. Press Replace the links again — it’s safe to run again.`);
    }
    if (!lines.length) lines.push('Nothing needed changing.');
    return { lines, ok: failed.length === 0 };
}

/** The HTTP status and parsed JSON body of an error the request threw. @param {any} err */
function answerOf(err) {
    const m = /^Server responded (\d{3}): ([\s\S]*)$/.exec(String((err && err.message) || ''));
    if (!m) return { status: null, body: null };
    let body = null;
    try { body = JSON.parse(m[2]); } catch { /* the platform's page, not the endpoint's answer */ }
    return { status: Number(m[1]), body };
}

/**
 * A refusal's reason, fit to show. The endpoint's own refusals are sentences; the platform's (a 404
 * before the function is deployed, say) are web pages, and a page is not a reason.
 * @param {{ status: number, reason: string }} refused
 */
const reasonOf = (refused) => (/^\s*</.test(refused.reason) ? `the server answered ${refused.status}` : refused.reason);

/** Why a CHECK failed. Nothing changes on a check, so there is no unknown to report. @param {any} err */
export function checkFailure(err) {
    const refused = serverRefusal(err);
    return refused ? `Couldn’t check the links: ${reasonOf(refused)}`
        : 'Couldn’t check the links — check your connection and try again.';
}

/** Not known to have finished, and not known not to have. */
const UNKNOWN = 'It isn’t known whether it finished. Press Replace the links again to make sure — running it twice is safe.';

/**
 * Why a RUN failed — or that nobody knows whether it did. "Nothing was changed" is said only where
 * it is known: the endpoint itself said so, or the request never left. The platform answers a 503 of
 * its own when an instance dies, which may be halfway through the writes, and a 408 is a timeout,
 * which may come mid-run too.
 * @param {any} err
 */
export function runFailure(err) {
    if (err && err.code === NOT_SENT) {
        return 'Couldn’t replace the links: the request was never sent, so nothing was changed. Check your connection and try again.';
    }
    const { status, body } = answerOf(err);
    if (status === 503 && body && body.changed === false) {
        return 'Couldn’t read the documents, so nothing was changed. Try again in a minute.';
    }
    const refused = status === 408 ? null : serverRefusal(err);
    if (refused) return `Couldn’t replace the links: ${reasonOf(refused)}. Nothing was changed.`;
    return UNKNOWN;
}

/**
 * Wire the card. Called once by operations-app.js; its collapse is wired there, with the others.
 * `askToConfirm` is overlay.js's `confirmDialog`, passed in rather than imported because overlay.js
 * touches `window` as it loads, and this module's wording is tested in Node.
 * @param {{ auth: any, askToConfirm: (opts: any) => Promise<boolean>, fetchFn?: typeof fetchWithTimeout }} deps
 */
export function initDocLinksCard({ auth, askToConfirm, fetchFn }) {
    const checkBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('docLinksCheckBtn'));
    const replaceBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('docLinksReplaceBtn'));
    const out = document.getElementById('docLinksResult');
    if (!checkBtn || !replaceBtn || !out) return;

    const getToken = async () => {
        const user = auth.currentUser;
        if (!user) throw new Error('Not signed in');
        return (await user.getIdTokenResult(/* forceRefresh */ true)).token;
    };
    /** One request, counted from the token to the answer (`docLinksRequestInFlight`). @param {boolean} rotate */
    const ask = async (rotate) => {
        _inFlight++;
        try {
            return await requestLinkRotation({ rotate, getToken, fetchFn });
        } finally {
            _inFlight--;
        }
    };
    /** @param {string[]} lines @param {'' | 'ok' | 'err' | 'working'} [tone] */
    const show = (lines, tone = '') => {
        out.textContent = '';
        out.className = tone ? `huddle-feedback huddle-feedback--${tone}` : 'huddle-feedback';
        for (const text of lines) {
            const p = document.createElement('p');
            p.textContent = text;
            out.append(p);
        }
    };
    /** How many files the last preview said a run would touch. */
    let toReplace = 0;

    checkBtn.addEventListener('click', async () => {
        checkBtn.disabled = true;
        replaceBtn.hidden = true;
        show(['Checking the links'], 'working');
        toReplace = 0;
        try {
            const report = await ask(false);
            const read = describePreview(report);
            if (!read) { show(['Couldn’t read the answer. Try again.'], 'err'); return; }
            show(read.lines);
            toReplace = read.canReplace ? report.linked + report.unlinkedWithKey : 0;
            replaceBtn.hidden = !read.canReplace;
        } catch (err) {
            console.warn('[docLinks] check failed', err);
            show([checkFailure(err)], 'err');
        } finally {
            checkBtn.disabled = false;
        }
    });

    replaceBtn.addEventListener('click', async () => {
        if (!toReplace) return;
        const yes = await askToConfirm({
            title: 'Replace the links?',
            message: `Old copies of the links to ${count(toReplace, 'file', 'files')} stop working straight away. `
                + 'Staff won’t notice anything in the app.',
            confirmLabel: 'Replace the links',
            danger: true,
        });
        if (!yes) return;
        checkBtn.disabled = true;
        replaceBtn.disabled = true;
        show(['Replacing the links — this can take a minute'], 'working');
        try {
            const done = describeResult(await ask(true));
            if (!done) { show(['Couldn’t read the answer.', UNKNOWN], 'err'); return; }
            show(done.lines, done.ok ? 'ok' : 'err');
            // A run that left a file unchanged keeps the button, so a retry is one press away.
            replaceBtn.hidden = done.ok;
        } catch (err) {
            console.warn('[docLinks] run failed', err);
            show([runFailure(err)], 'err');
        } finally {
            checkBtn.disabled = false;
            replaceBtn.disabled = false;
        }
    });
}
