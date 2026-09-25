// @ts-check
/**
 * document-url.js — asking the server for a SHORT-LIVED document url, and deciding what a refusal
 * means. Imports `fetch-timeout.js` and nothing else; no Firebase, no DOM.
 *
 * ── WHY THIS IS ITS OWN MODULE (v24.19) ─────────────────────────────────────────────────────────
 *
 * It started inside `firebase-client.js`, which the coordinator ratchet correctly refused: what is
 * here is a RULE — which server answers mean "carry on the old way" — and `firebase-client.js`
 * cannot be imported by a Node test at all, because it statically imports the Firebase SDK from the
 * gstatic CDN. So the rule would have been the one part of this change with no test that could
 * reach it. Same reasoning, and the same remedy, as `storage-utils.js` (v16.32).
 *
 * The caller supplies the token rather than this module finding one: that is the only part that
 * needs Firebase, and it is three lines in `firebase-client.js`.
 *
 * ── THE RULE: IT NEVER THROWS, AND `null` IS NOT A FAILURE ──────────────────────────────────────
 *
 * Every caller has a working fallback — the permanent `storageUrl` already in the Firestore
 * document — so there is nothing useful any of them could do with an exception. `null` means
 * "carry on the old way", and the old way is what a member saw yesterday.
 *
 * The cases that reach `null` are all NORMAL:
 *   · 503 — the IAM grant (`serviceAccountTokenCreator`) is missing. RECOVERY_RUNBOOK.md records it
 *           as granted on the shared runtime account, so this is the exception — but it is still the
 *           reason the fallback exists.
 *   · 403 — a session with no `name`/`admin`/`calendarViewer` claim: a lapsed token, not an
 *           intruder — the document surfaces are already gated on the client.
 *   · 404 — nothing published yet. The caller's own "no document" branch handles it.
 *   · a timeout, or offline — an offline-first app must never turn a document into a dead button.
 *
 * Because they are all normal, none of them is surfaced to a member; they are logged and dropped.
 */

import { fetchWithTimeout } from './fetch-timeout.js';

/** The endpoint (v24.16 server half). AUTH_PLAN.md §5. */
export const DOCUMENT_URL_ENDPOINT = 'https://europe-west2-myb-roster.cloudfunctions.net/getDocumentUrl';

/**
 * Short on purpose: this sits between a tap and a document opening, and the stored url is right
 * there. Waiting a long time to maybe improve on it is the wrong trade.
 */
export const DOCUMENT_URL_TIMEOUT_MS = 8_000;

/**
 * @typedef {{ url: string, expiresAt: number, fileType: string|null }} SignedDocumentUrl
 */

/**
 * Ask for a short-lived url for the latest document of `kind`.
 *
 * @param {string} kind  'huddle' | 'circular' | 'newsletter'
 * @param {() => Promise<string>} getToken  supplies a Firebase ID token
 * @param {typeof fetchWithTimeout} [doFetch]  seam for tests; defaults to the real one
 * @returns {Promise<SignedDocumentUrl|null>} the signed url with its expiry and the file type of the
 *   document the SERVER signed, or null to use the stored one
 */
export async function requestSignedDocumentUrl(kind, getToken, doFetch = fetchWithTimeout) {
    try {
        const token = await getToken();
        const r = await doFetch(DOCUMENT_URL_ENDPOINT, {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ kind }),
        }, DOCUMENT_URL_TIMEOUT_MS);
        if (!r.ok) {
            // Logged, never surfaced: the member is about to get their document either way.
            console.warn(`[documentUrl] ${kind}: server said ${r.status} — using the stored url`);
            return null;
        }
        const { url, expiresAt, fileType } = await r.json();
        // A 200 carrying no url is a server we do not recognise. Treat it as no url rather than
        // handing `undefined` onward to be opened.
        if (typeof url !== 'string' || !url) return null;
        // ── THE EXPIRY AND THE FILE TYPE TRAVEL WITH THE URL (v24.23) ───────────────────────────
        // v24.19 kept the url alone. Two things were lost with the rest. The EXPIRY: the url is
        // minted when a viewer opens, and a member who locks the phone and taps twenty minutes
        // later was handed a dead link, because nothing could tell it had lapsed. And the FILE TYPE
        // of the document the server actually signed: the server signs the LATEST, which is not
        // always the copy the client is holding, so wrapping by the client's own fileType could open
        // a .docx directly (it downloads) or send a PDF to the Office viewer. A url with no
        // readable expiry is not used — the stored one is right there.
        if (!Number.isFinite(expiresAt)) return null;
        return { url, expiresAt, fileType: typeof fileType === 'string' ? fileType : null };
    } catch (err) {
        console.warn(`[documentUrl] ${kind}: could not mint a short-lived url —`, err);
        return null;
    }
}
