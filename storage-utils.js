// @ts-check
/**
 * storage-utils.js — pure helpers for the Firebase Storage upload/open paths.
 *
 * Extracted from firebase-client.js so they can be unit-tested directly: firebase-client.js
 * statically imports the Firebase SDK from the gstatic CDN, which is unloadable in a Node test,
 * so anything that lives there is only testable behind a mock. These functions have NO imports
 * (no Firebase, no DOM state) — import them here and re-export from firebase-client.js.
 *
 * Owns: `isSafeStorageUrl` (the download-URL allowlist — a security control), `isDocxUpload`
 * (upload file-type detection), and `officeViewerUrl` (the Word-open wrapper). Does NOT own the
 * actual upload/download (firebase-client.js).
 */

/** This project's Storage buckets. A download URL must live under one of these. */
const STORAGE_BUCKETS = ['myb-roster.appspot.com', 'myb-roster.firebasestorage.app'];

/**
 * Microsoft's Office Online viewer, full-page variant. A browser has no native renderer for a
 * .docx, so opening a raw .docx download URL just downloads the file to the device; handing the
 * URL to this viewer instead renders the document (with its images) in the browser. Full-page
 * `view.aspx` — NOT the iframe-only `embed.aspx` — because we open it as a top-level tab / in-app
 * Custom Tab (the same way PDFs already open), which keeps CSP untouched (no framed third party).
 */
const OFFICE_VIEWER_BASE = 'https://view.officeapps.live.com/op/view.aspx?src=';

/**
 * True only for HTTPS URLs on a Firebase Storage hostname this app uses, under one of THIS
 * project's buckets. Single source of truth for "is this download URL safe to open in a new tab" —
 * guards against malformed Firestore data, a compromised admin account, or a future rule mistake
 * pointing a Huddle/Circular/Newsletter button at an arbitrary URL. Used by the nav-panel openers,
 * the doc viewer, and the Huddle viewer's "Open" button.
 *
 * The bucket segment MUST be anchored with a trailing '/' — a bare prefix ('/myb-roster') would also
 * match an attacker-registered global bucket named 'myb-rosterX' (GCS bucket names are globally
 * unique and unclaimed variants can be registered), defeating the whole check.
 * @param {any} url
 * @returns {boolean}
 */
export function isSafeStorageUrl(url) {
    if (typeof url !== 'string' || !url) return false;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') return false;
        // Firebase download URLs are …/v0/b/<bucket>/o/<path>; GCS URLs are storage.googleapis.com/<bucket>/<path>.
        if (parsed.hostname === 'firebasestorage.googleapis.com') return STORAGE_BUCKETS.some(b => parsed.pathname.startsWith(`/v0/b/${b}/`));
        if (parsed.hostname === 'storage.googleapis.com')         return STORAGE_BUCKETS.some(b => parsed.pathname.startsWith(`/${b}/`));
        return false;
    } catch (_) { return false; }
}

/**
 * True if this upload should be treated as a Word (.docx) file. Matches the accept predicates
 * (`isDocxFile` in doc-upload.js / `_isDocx` in huddle.js) — extension OR the exact docx MIME — so
 * upload-side type detection agrees with what the picker accepted. Detecting by extension alone
 * would mis-classify a .docx picked with a correct MIME but a name lacking the extension (cloud /
 * Android content-URI pickers) as a PDF, then reject it at the signature check.
 * @param {File} file
 * @returns {boolean}
 */
export function isDocxUpload(file) {
    return file.name.toLowerCase().endsWith('.docx')
        || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

/**
 * Wrap a document download URL in Microsoft's Office Online viewer so a Word (.docx) circular /
 * newsletter OPENS and renders in the browser (with images) instead of downloading. PDFs never
 * need this — they render inline — so only call it for a `fileType === 'docx'` document. The URL
 * should already have passed `isSafeStorageUrl` (the viewer fetches whatever `src` you give it).
 * @param {string} storageUrl - a Firebase Storage download URL
 * @returns {string} an Office Online viewer URL that renders the document
 */
export function officeViewerUrl(storageUrl) {
    return OFFICE_VIEWER_BASE + encodeURIComponent(storageUrl);
}
