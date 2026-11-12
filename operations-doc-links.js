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
 * 503s of its own) both mean nothing ran, and say that.
 *
 * Exported pieces are pure apart from `initDocLinksCard`, so the wording and the request are tested
 * in Node (operations-doc-links.test.mjs) and the wiring in the browser (e2e/operations.spec.js).
 */
import { fetchWithTimeout, serverRefusal } from './fetch-timeout.js';

/** Admin-only Cloud Function — a preview unless the body says `rotate: true`. */
export const ROTATE_LINKS_URL = 'https://europe-west2-myb-roster.cloudfunctions.net/rotateDocumentLinks';
/** Past the endpoint's own 300 s limit, so the platform's answer arrives before this gives up. */
const ROTATE_TIMEOUT_MS = 310_000;

/** "1 file" / "3 files". @param {number} n @param {string} one @param {string} many */
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Files a link this cannot read may open: left exactly as they are, old links and all. @param {number} n */
const heldLine = (n) => (n === 1
    ? '1 file is left as it is, old link and all: a document’s link this can’t read may open it.'
    : `${n} files are left as they are, old links and all: documents’ links this can’t read may open them.`);

/**
 * Ask the server for a preview, or for a run.
 * @param {{ rotate: boolean, getToken: () => Promise<string>, fetchFn?: typeof fetchWithTimeout }} opts
 * @returns {Promise<any>} the server's report
 */
export async function requestLinkRotation({ rotate, getToken, fetchFn = fetchWithTimeout }) {
    const token = await getToken();
    const r = await fetchFn(ROTATE_LINKS_URL, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rotate: rotate === true }),
    }, ROTATE_TIMEOUT_MS);
    if (!r.ok) { const e = await r.text(); throw new Error(`Server responded ${r.status}: ${e}`); }
    return r.json();
}

/** A report this card can read — every count a number, and the failures a list. @param {any} r */
function isReport(r) {
    return !!r && typeof r === 'object' && Array.isArray(r.failed)
        && ['files', 'linked', 'unlinkedWithKey', 'held', 'recordsMissingFile', 'recordsUnreadable',
            'rotated', 'cleared', 'changedDuringRun'].every(k => Number.isInteger(r[k]) && r[k] >= 0);
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
    const lines = [];
    if (linked) {
        lines.push(linked === 1
            ? '1 file is in use. It gets a new link, and old copies of its link stop working.'
            : `${linked} files are in use. Each gets a new link, and old copies of their links stop working.`);
    }
    if (unlinkedWithKey) {
        lines.push(unlinkedWithKey === 1
            ? '1 older file is no longer used by the app. Its link will simply stop working.'
            : `${unlinkedWithKey} older files are no longer used by the app. Their links will simply stop working.`);
    }
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
    if (report.failed.length) lines.push(`${count(report.failed.length, 'file', 'files')} couldn’t be checked.`);
    const canReplace = linked + unlinkedWithKey > 0;
    if (canReplace) {
        lines.push('Nothing has changed yet. Staff won’t notice the change: the app opens documents with fresh links of its own.');
    } else {
        lines.unshift(files === 0
            ? 'No Huddle, Circular or Newsletter files were found, so there is nothing to replace.'
            : report.held
                ? 'There is nothing this can safely replace.'
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
 * the endpoint itself said so: the platform answers a 503 of its own when an instance dies, which may
 * be halfway through the writes, and a 408 is a timeout, which may come mid-run too.
 * @param {any} err
 */
export function runFailure(err) {
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
            const report = await requestLinkRotation({ rotate: false, getToken, fetchFn });
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
            const done = describeResult(await requestLinkRotation({ rotate: true, getToken, fetchFn }));
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
