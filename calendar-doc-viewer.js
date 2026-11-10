// @ts-check
/**
 * calendar-doc-viewer.js — in-app viewer for the Weekly Retail Circular and the
 * Marylebone Newsletter on index.html.
 *
 * Owns: the #docViewer lightbox, opened from a #circular / #newsletter deep link — a notification tap
 *   (see .claude/rules/notifications.md and the onCircularCreated / onNewsletterCreated Cloud Function
 *   triggers), or the drawer handing over to it when no new tab came back (nav-panel.js, v24.61).
 * Does NOT own: the Huddle viewer (calendar-huddle-viewer.js — the Huddle has its
 *   own full-bleed panel and DOCX inline-render path), uploads (operations-app.js),
 *   or the nav-drawer links (nav-panel.js still opens these in a new tab).
 *
 * The viewer shows an explicit "Open" button rather than rendering inline or
 * calling window.open() at open time: a notification tap carries no user
 * activation, so opening the file directly would be pop-up-blocked / would knock
 * the PWA out of standalone. Tapping the button IS a real gesture, so it opens the
 * file as a Custom Tab over the intact app. A PDF opens by its own URL; a Word
 * (.docx) document would download if opened directly, so it is routed through
 * Microsoft's Office Online viewer (officeViewerUrl) which renders it with images.
 */
import { createLightbox, registerPopInterceptor, suppressNextPop, whenHistorySettled } from './overlay.js';
import { getLatestCircular, getLatestNewsletter, isSafeStorageUrl, resolveDocumentOpenUrl, fetchSignedDocumentUrl } from './firebase-client.js';
import { recordOpen } from './usage-reporter.js';
import { getSession } from './session.js';

/**
 * Per-document config. The emoji matches each feature's in-app icon (nav drawer /
 * Operations card) and its push-notification emoji — the same identity everywhere.
 * @type {Record<string, { emoji: string, label: string, fetch: () => Promise<any>, empty: string }>}
 */
const DOCS = {
    circular:   { emoji: '📰',  label: 'Weekly Retail Circular', fetch: getLatestCircular,
                  empty: "No Weekly Retail Circular has been uploaded yet — it's usually available on Friday." },
    newsletter: { emoji: '🗞️', label: 'Marylebone Newsletter',  fetch: getLatestNewsletter,
                  empty: 'No Marylebone Newsletter has been uploaded yet.' },
};

/** Wait a moment for a session before reading, then read regardless — the user just tapped a
 *  notification and is watching a "Loading…" panel. */
const DOC_AUTH_WAIT_MS = 2000;
/** Total deadline for the whole open, mirroring the nav-drawer document path's 8s race. */
const DOC_FETCH_TIMEOUT_MS = 8000;

/** A tap the LOCK was holding when the page unloaded, and how old it may be when the next load reads
 *  it — calendar-huddle-viewer.js has the same pair, and the argument (`HELD_TAP_KEY`). */
const HELD_DOC_KEY = 'myb_held_doc_tap';
const HELD_DOC_CARRY_MS = 60_000;

/**
 * Take the held document tap this tab's last unload left, if it is recent enough. Read ONCE and
 * removed whatever it says; sessionStorage can throw (iOS private mode), and then nothing is carried.
 * @returns {string|null} 'circular' | 'newsletter'
 */
function _takeHeldDoc() {
    try {
        const raw = sessionStorage.getItem(HELD_DOC_KEY);
        sessionStorage.removeItem(HELD_DOC_KEY);
        if (!raw) return null;
        const [at, key] = raw.split('|');
        const age = Date.now() - Number(at);
        return age >= 0 && age < HELD_DOC_CARRY_MS && Object.hasOwn(DOCS, key) ? key : null;
    } catch { return null; }
}

/**
 * `p`, or `ms` from now, whichever comes first. The losing timer is CLEARED once `p` settles (test
 * audit, 7 Nov 2026): left armed, every open kept a 2s timer, and every page load an 8s one, alive for
 * nothing — and held the test runner open as long. The clear is a side branch attached AFTER the race,
 * so the race's own reaction to `p` still runs first and settles on exactly the tick it always did.
 * @param {Promise<any>} p
 * @param {number} ms
 */
function _orAfter(p, ms) {
    /** @type {ReturnType<typeof setTimeout>|undefined} */ let timer;
    const raced = Promise.race([p, new Promise(r => { timer = setTimeout(r, ms); })]);
    Promise.resolve(p).then(() => clearTimeout(timer), () => clearTimeout(timer));
    return raced;
}

/**
 * Wire up the document viewer and open it if the page loaded on a #circular/#newsletter deep link.
 * @param {{ authReady?: Promise<any>, accessDecided?: Promise<any>, docAccess?: { has: () => boolean, onChange: (fn: (open: boolean) => void) => (() => void) } }} [deps]
 *   docAccess — THE DOCUMENT GATE (v23.17, calendar-doc-access.js). A tap while it is shut shows
 *   what to do and issues NO read, cached or live; the tap is remembered and finished when access
 *   arrives, so a notification deep link that landed on the PIN card still opens the document once
 *   the PIN is in — or once the member signs in, which reloads the page and is carried across it.
 *   Defaults to always-open. authReady — resolves once a Firebase session exists.
 *   Awaited before the document read (AUTH_PLAN.md → E1). Defaults to already-resolved.
 *   accessDecided — settles once the Calendar has decided access, granted or locked. This viewer
 *   is wired BEFORE that decision, so a cold deep link finds the gate shut only because nothing is
 *   decided yet; until this settles a shut gate reads "Loading…", not "enter the PIN", which told
 *   a signed-in member to use the PIN for the second their identity took to restore.
 */
export function initDocViewer({ authReady = /** @type {Promise<any>} */ (Promise.resolve()), accessDecided = /** @type {Promise<any>} */ (Promise.resolve()), docAccess = { has: () => true, onChange: () => () => {} } } = {}) {
    const overlay  = /** @type {HTMLElement|null} */ (document.getElementById('docViewer'));
    const content  = /** @type {HTMLElement|null} */ (document.getElementById('docViewerContent'));
    if (!overlay || !content) return;
    // Cast the inner elements (they exist in index.html markup) so type-narrowing
    // holds inside the nested closures below — matches calendar-huddle-viewer.js.
    const titleEl  = /** @type {HTMLElement} */ (document.getElementById('docViewerTitle'));
    const bodyEl   = /** @type {HTMLElement} */ (document.getElementById('docViewerBody'));
    const closeBtn = /** @type {HTMLElement} */ (document.getElementById('docViewerClose'));
    // ── THE OUTCOME IS SPOKEN (whole-app review, 10 Nov 2026) ─────────────────────────────────────────
    // "Loading…" became "No … uploaded yet" or "Enter the staff PIN…" with no focus move and no live
    // region, so a screen-reader user heard the dialog open and then nothing. Every message now goes
    // into ONE status line that stays in the body (index.html), so the change itself is announced;
    // a button follows it in the body, where focus already takes the reader.
    const statusEl = /** @type {HTMLElement} */ (document.getElementById('docViewerStatus'));

    // Discards a superseded fetch: two rapid notification taps (#circular then #newsletter) each set
    // the title synchronously then await their fetch — if the first resolves LAST it would write its
    // "Open" button under the second's title (persistent doc/title mismatch). Only the latest tap wins.
    //
    // CLOSING THE VIEWER BUMPS IT TOO (v19.13). Dismissal is just as much a "this open is no longer
    // wanted" signal as a newer tap, and it was not treated as one: a member who tapped a
    // notification, saw "Loading…", and closed it still had the late resolve/reject append a button
    // into the hidden dialog and call .focus() on it. For a mouse user that is invisible; for a
    // keyboard or screen-reader user it drags focus out of whatever the lightbox restored it to and
    // into content that is not on screen, then announces an action belonging to a dialog they
    // already dismissed. Declared ABOVE createLightbox so onClose can reach it.
    let _openSeq = 0;
    /** The document a locked tap asked for — finished by the grant. It SURVIVES a close on purpose:
     *  the locked message sits over the PIN card, so closing it is the only way to reach the form,
     *  and the reader who then enters the PIN is asking for exactly the document they tapped.
     *  @type {string|null} */
    let _pendingKey = null;
    /** Whether access has been decided — see `accessDecided`. Bounded, so a decision that never
     *  settles cannot leave a tap on "Loading…" for good. */
    let _decided = false;
    let _waitingSeq = -1;
    /** @param {{ label: string }} d */
    const lockedText = (d) => `Enter the staff PIN, or sign in, to read the ${d.label}.`;

    const lb = createLightbox({
        overlay, content, closeBtn,
        // ── OPENED OVER THE HUDDLE VIEWER, IT IS DRAWN OVER IT (whole-app review, 10 Nov 2026) ──────
        // The Huddle viewer is a full-bleed panel in the notice band (index.css, `--z-notice`); this is
        // an ordinary lightbox in the band below it. A document tap no longer closes the Huddle (the
        // tap is not a Back press — the interceptor below), so opened while it is up this one would sit
        // UNDERNEATH it while being the top of the overlay stack: the tap seeming to do nothing, and
        // Escape and Tab going to a dialog nobody could see. Raised for that open only; opened the other
        // way round, the Huddle viewer is already drawn over this.
        onOpen: () => {
            const huddleUp = !!document.getElementById('huddleViewer')?.classList.contains('visible');
            overlay.style.zIndex = huddleUp ? 'calc(var(--z-notice) + 1)' : '';
        },
        // Invalidate whatever is in flight. The existing `seq !== _openSeq` guards on BOTH the
        // success and failure paths then suppress every late DOM write and focus move. A held
        // locked tap is NOT dropped here — see `_pendingKey`.
        onClose: () => { _openSeq++; _viewing = null; },
        afterClose: () => { overlay.style.zIndex = ''; },
    });
    /** The document on screen, read under access — so a lock can take it down. @type {string|null} */
    let _viewing = null;

    // THE GRANT FINISHES A TAP THE LOCK HELD BACK (v23.17) — whoever entered the PIN is entitled to
    // the document, and it is the one they came for. A later tap on another document replaces it.
    docAccess.onChange((open) => {
        // A LOCK WHILE A DOCUMENT IS OPEN OR LOADING (v24.56, auth review) — as the Huddle viewer
        // does: invalidate the read in flight, so it cannot render an "Open" button for a reader no
        // longer entitled to it, and say what unlocks it instead of leaving the document up.
        if (!open && _viewing) {
            _openSeq++;
            showMessage(lockedText(DOCS[_viewing]), 'doc-viewer-empty');
            _pendingKey = _viewing;   // …and the PIN it asks for finishes the open, as for a locked tap
            _viewing = null;
            return;
        }
        if (!open || !_pendingKey) return;
        const key = _pendingKey; _pendingKey = null;
        openDoc(key);
    });

    // A TAP THE LOCK HELD SURVIVES A RELOAD (whole-app review, 10 Nov 2026). Both sign-ins on a locked
    // Calendar reload the page, and the hash was consumed at the tap — so "or sign in" brought the
    // member back to a Calendar with no document. The held tap is written down as the page unloads and
    // taken back at the foot of this function; calendar-huddle-viewer.js has the same pair.
    window.addEventListener('pagehide', () => {
        try {
            // Only a tap the LOCK holds has a key: a grant, or an open made with access, clears it.
            if (_pendingKey) sessionStorage.setItem(HELD_DOC_KEY, `${Date.now()}|${_pendingKey}`);
            else sessionStorage.removeItem(HELD_DOC_KEY);
        } catch { /* no sessionStorage: the tap is not carried, as before */ }
    });
    window.addEventListener('pageshow', (e) => {
        if (/** @type {PageTransitionEvent} */ (e).persisted) { try { sessionStorage.removeItem(HELD_DOC_KEY); } catch { /* noop */ } }
    });

    /** Say a message (no markup) in the status line, and take down any button the body held.
     *  @param {string} text @param {string} cls */
    function showMessage(text, cls) {
        for (const el of [...bodyEl.children]) if (el !== statusEl) el.remove();
        statusEl.className = cls;
        statusEl.textContent = text;
    }

    /** @param {string} key 'circular' | 'newsletter' */
    async function openDoc(key) {
        const d = DOCS[key];
        if (!d) return;
        const seq = ++_openSeq;
        // The emoji is decoration: the dialog is NAMED by this title (aria-labelledby), and its name
        // is the document's, not "Document" as it was whichever one was open.
        const glyph = document.createElement('span');
        glyph.setAttribute('aria-hidden', 'true');
        glyph.textContent = `${d.emoji} `;
        titleEl.textContent = '';
        titleEl.append(glyph, d.label);
        // LOCKED: no read is attempted — not from the server, not from the cache the rules cannot
        // see — and the message says what unlocks it. The key is kept so the unlock can finish this.
        if (!docAccess.has()) {
            _pendingKey = key;
            if (_decided) showMessage(lockedText(d), 'doc-viewer-empty');
            else { _waitingSeq = seq; showMessage('Loading…', 'doc-viewer-loading'); }
            lb.open();
            return;
        }
        _pendingKey = null;   // an unlocked open supersedes anything a lock held back
        _viewing = key;
        showMessage('Loading…', 'doc-viewer-loading');
        lb.open();
        try {
            // BOUNDED, not plain (v19.08). This awaited `authReady` with no deadline, and the comment
            // that used to sit here argued the visible "Loading…" made that acceptable. It does not:
            // a loading state tells you something is happening, it does not make an unbounded wait
            // RECOVERABLE. On a stalled connection where persistence setup or signInAnonymously never
            // settles, the fetch was never attempted and the viewer sat on "Loading…" forever — from
            // an explicit user action (a notification tap), with no failure ever announced to a
            // screen reader. Same shape as the nav-drawer path and the calendar retry: wait a moment
            // for a session, then read anyway. Reads DO require access (firestore.rules, since v23.18
            // — a member's claim, `admin`, or the PIN's `calendarViewer`), so a read without a
            // session fails into the catch below, which offers a retry, rather than stalling first.
            const authOrSoon = _orAfter(authReady, DOC_AUTH_WAIT_MS);
            // The short-lived url is requested ALONGSIDE the document read (v24.23), not after it:
            // the server picks the latest document itself, so the request needs nothing the read
            // returns, and in series every open paid for two round trips one after the other.
            // Its own promise never rejects (document-url.js), so it cannot fail the read.
            const signedP = authOrSoon.then(() => (seq === _openSeq ? fetchSignedDocumentUrl(/** @type {any} */ (key)) : null));
            // The deadline timer is CLEARED once the race settles: left armed, every successful open
            // kept an 8 s timer alive for nothing (and held the test runner open for as long).
            /** @type {any} */ let fetchTimer;
            /** @type {any} */ let doc;
            try {
                doc = await Promise.race([
                    authOrSoon.then(() => (seq === _openSeq ? d.fetch() : null)),
                    new Promise((_, reject) => {
                        fetchTimer = setTimeout(() => reject(new Error('doc-fetch-timeout')), DOC_FETCH_TIMEOUT_MS);
                    }),
                ]);
            } finally {
                clearTimeout(fetchTimer);
            }
            if (seq !== _openSeq) return;   // a newer tap superseded this one — don't clobber its content
            if (doc && isSafeStorageUrl(doc.storageUrl)) {
                // ── MINTED HERE, NOT IN THE CLICK HANDLER (v24.19) ──────────────────────────────
                // The short-lived url (getDocumentUrl, v24.16) replaces the permanent bearer url
                // this viewer used to hand out. It is fetched now, while the button is still being
                // built, because the click below must stay SYNCHRONOUS: awaiting inside it spends
                // the user gesture, and `window.open` without a gesture is pop-up-blocked and
                // knocks the PWA out of standalone — the failure this file's own comments warn
                // about. The cost is one request per viewer open rather than per tap, and the
                // signing window (15 min) is sized for exactly this chain.
                // A null here is ORDINARY — no IAM grant yet, a lapsed claim, a timeout — and
                // resolveDocumentOpenUrl then uses the stored url, which is what shipped before.
                const signed = await signedP;
                if (seq !== _openSeq) return;   // a newer tap superseded this one while we waited
                if (!resolveDocumentOpenUrl({ signed, stored: doc.storageUrl, fileType: doc.fileType, storagePath: doc.storagePath })) {
                    showMessage(d.empty, 'doc-viewer-empty'); return;
                }
                showMessage('', 'doc-viewer-loading');   // the button speaks for itself, and takes focus
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'doc-open-btn';
                btn.textContent = `📄 Open ${d.label}`;
                // Real user gesture → window.open opens a Custom Tab over the standalone app.
                // Counted here (not on viewer open) so the count means the document was actually
                // opened — mirroring the nav-drawer path (v18.20; admin-excluded, anonymous).
                btn.addEventListener('click', () => {
                    // Identity: the SIGNED-IN member, never the selected one (v25.00). On the station
                    // PC the selection is whichever row was picked last — the default is the admin —
                    // so excluding on it dropped staff opens there and counted the admin's own.
                    recordOpen(key, getSession()?.name ?? null);
                    // Resolved AT THE TAP (v24.23), synchronously so the gesture survives: the
                    // signed url was minted when the viewer opened, and a member who locked the
                    // phone and came back twenty minutes later was handed a lapsed link. A url near
                    // its expiry is passed over for the stored one, which never lapses.
                    const open = resolveDocumentOpenUrl({ signed, stored: doc.storageUrl, fileType: doc.fileType, storagePath: doc.storagePath });
                    if (open) window.open(open.url, '_blank', 'noopener');
                });
                bodyEl.appendChild(btn);
                btn.focus();
            } else {
                showMessage(d.empty, 'doc-viewer-empty');
            }
        } catch (err) {
            if (seq !== _openSeq) return;   // superseded — leave the newer tap's content alone
            console.warn(`[DocViewer] ${key} fetch failed:`, err);
            // A RETRY CONTROL, not just text (v19.08). "please try again" with nothing to press is a
            // dead end — and for a screen-reader user it is the only thing that ever replaces
            // "Loading…", so it has to be actionable.
            showMessage("Couldn't load this document.", 'doc-viewer-empty');
            const againBtn = document.createElement('button');
            againBtn.type = 'button';
            againBtn.className = 'doc-open-btn';
            againBtn.textContent = '↻ Try again';
            againBtn.addEventListener('click', () => openDoc(key));
            bodyEl.appendChild(againBtn);
            againBtn.focus();
        }
    }

    // ── A TAP IS NOT A BACK PRESS, AND LEAVES NO DEAD ENTRY (whole-app review, 10 Nov 2026) ─────────
    // A hash navigation fires `popstate` before `hashchange`, and overlay.js reads every popstate as
    // Android Back — so a document tap closed whatever was open (the Huddle viewer included) and left
    // that overlay's history entry behind it. Claimed here, the tap closes nothing. And the entry it
    // pushed is taken back off the history once this has the key, rather than rewritten into a second
    // copy of the page that a Back press would spend doing nothing. calendar-huddle-viewer.js does the
    // same for `#huddle`, and its `_consumeHashEntry` has the argument; this is the same three steps.
    registerPopInterceptor(() => /^#(circular|newsletter)$/.test(window.location.hash));
    /** @param {() => void} then */
    function consumeHashEntry(then) {
        try {
            history.back();
            suppressNextPop();   // the echo is ours, not a Back press
        } catch {
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        whenHistorySettled(then);
    }

    // A notification tap deep-links to #circular / #newsletter. Handle both a cold open (page loads
    // on the hash: its entry is the page's own, so the hash is rewritten in place) and a hash-only
    // navigation of an already-open page (the SW navigates the existing window — fires hashchange, no
    // reload — and the tap's own entry is taken off again).
    /** @returns {boolean} whether the page loaded on a document hash */
    function handleColdHash() {
        const key = window.location.hash.slice(1);
        if (key !== 'circular' && key !== 'newsletter') return false;
        // Clear the hash so a manual reload / Back doesn't re-open the viewer.
        history.replaceState(null, '', window.location.pathname + window.location.search);
        openDoc(key);
        return true;
    }
    function handleHash() {
        const key = window.location.hash.slice(1);
        if (key !== 'circular' && key !== 'newsletter') return;
        consumeHashEntry(() => openDoc(key));
    }
    // The decision settles: a tap still held on "Loading…" (same open, not closed or superseded)
    // now says what unlocks it. A grant got there first through `onChange` and cleared the key.
    _orAfter(accessDecided, DOC_FETCH_TIMEOUT_MS).catch(() => {}).then(() => {
        _decided = true;
        const d = _pendingKey ? DOCS[_pendingKey] : null;
        if (d && !docAccess.has() && _waitingSeq === _openSeq) showMessage(lockedText(d), 'doc-viewer-empty');
    });
    const held = _takeHeldDoc();
    if (!handleColdHash() && held) openDoc(held);   // a tap the sign-in's reload carried — a cold deep link again
    window.addEventListener('hashchange', handleHash);
}
