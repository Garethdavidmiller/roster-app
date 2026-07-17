// @ts-check
/**
 * doc-upload.js — shared admin upload-card wiring for the Operations document uploads
 * (Weekly Retail Circular, Marylebone Newsletter, Daily Huddle).
 *
 * Owns: the file-picker → validate (type + 20 MB cap) → optional pre-upload transform → upload →
 *   feedback skeleton, plus the today/tomorrow date cap. This was copy-pasted three times (the
 *   Circular/Newsletter pair in operations-app.js and the Huddle in huddle.js) before v16.07.
 * Does NOT own: the Firestore/Storage upload itself (firebase-client.js uploadCircular/
 *   uploadNewsletter/uploadHuddle), nor any card-specific transform (e.g. the Huddle's Mammoth
 *   DOCX→HTML conversion — that stays in huddle.js, where its CDN SRI hash is patched).
 *
 * Per-card differences are passed as config: accepted file types, an optional async `transform`
 * that yields extra args for the upload fn (the Huddle passes its htmlContent), the date offset
 * (Huddle caps at tomorrow — sent the evening before), the upload fn, and the copy.
 */

import { formatISO } from './roster-data.js';
import { sessionReady } from './session.js';

/** 20 MB — matches functions/index.js MAX_FILE_BYTES and storage.rules request.resource.size. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Default accept predicate — PDF. @param {File} f */
export function isPdfFile(f) {
  return f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
}

/** Word (.docx) accept predicate. Matches by extension because Android often reports a .docx as
 *  application/zip or application/octet-stream (DOCX is a ZIP archive). @param {File} f */
export function isDocxFile(f) {
  return f.name.toLowerCase().endsWith('.docx')
    || f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

/**
 * Wire one Operations upload card.
 * @param {{
 *   dateId: string, fileId: string, fileLabelId: string, uploadBtnId: string, feedbackId: string,
 *   uploadFn: (date: string, file: File, user: string, ...extra: any[]) => Promise<any>,
 *   currentUser: string|null,
 *   successMsg: (date: string) => string,
 *   btnLabel: string,
 *   logPrefix: string,
 *   maxDateOffsetDays?: number,               // date input cap = today + this (default 0). Huddle: 1.
 *   isAccepted?: (f: File) => boolean,        // default isPdfFile
 *   rejectTypeMsg?: string,                   // default 'Please choose a PDF file'
 *   sigMismatchMsg?: string,                  // shown on a SIGNATURE_MISMATCH upload error
 *   transform?: (file: File, ctx: { setBtnText: (t: string) => void })
 *               => Promise<{ extraArgs?: any[], abortMsg?: string }>,  // e.g. DOCX→HTML → [htmlContent]
 * }} cfg
 */
export function initDocUploadCard(cfg) {
  const dateInput = /** @type {HTMLInputElement} */ (document.getElementById(cfg.dateId));
  const fileInput = /** @type {HTMLInputElement} */ (document.getElementById(cfg.fileId));
  const fileLabel = document.getElementById(cfg.fileLabelId);
  const uploadBtn = /** @type {HTMLButtonElement} */ (document.getElementById(cfg.uploadBtnId));
  const feedback  = document.getElementById(cfg.feedbackId);
  if (!dateInput || !fileInput || !uploadBtn || !feedback || !fileLabel) return;

  const isAccepted   = cfg.isAccepted    || isPdfFile;
  const rejectTypeMsg = cfg.rejectTypeMsg || 'Please choose a PDF file';
  const sigMismatchMsg = cfg.sigMismatchMsg
    || "That file isn't a valid PDF — please choose the original file";

  // Date default + max are recomputed on every submit, NOT frozen at page-init (v16.23). This is
  // a long-lived PWA: an Operations tab left open overnight would otherwise (a) upload an
  // untouched date under YESTERDAY — and these documents are date-keyed setDoc replaces, so it
  // OVERWRITES yesterday's real document and deletes its Storage file; (b) reject a correctly
  // TYPED today/tomorrow date against the stale max ("That date is in the future").
  // "Touched" is tracked with a listener (not a value comparison, which would misclassify an
  // admin who deliberately re-picked the same date).
  let _dateTouched = false;
  ['input', 'change'].forEach(ev => dateInput.addEventListener(ev, () => { _dateTouched = true; }));
  function _refreshDateBounds() {
    const _maxDate = new Date();
    _maxDate.setDate(_maxDate.getDate() + (cfg.maxDateOffsetDays || 0));
    dateInput.max = formatISO(_maxDate);
    if (!_dateTouched) {
      const today = formatISO(new Date());
      if (dateInput.value !== today) {
        dateInput.value = today;
        // Tell a progressive enhancement (date-picker.js) we changed the value programmatically.
        // A plain 'change' would wrongly flip _dateTouched (this is NOT a user edit), so use a
        // bespoke event that only refreshes the trigger label — keeps the label from lying when an
        // untouched Operations tab rolls over midnight and Upload re-defaults the date. (v17.41)
        dateInput.dispatchEvent(new CustomEvent('date-refreshed'));
      }
    }
  }
  _refreshDateBounds();

  function _reject(/** @type {string} */ msg) {
    /** @type {HTMLElement} */ (fileLabel).classList.remove('visible');
    uploadBtn.disabled = true;
    /** @type {HTMLElement} */ (feedback).textContent = msg;
    /** @type {HTMLElement} */ (feedback).className = 'huddle-feedback huddle-feedback--err';
    fileInput.value = '';
  }

  fileInput.addEventListener('change', () => {
    const file = (fileInput.files || [])[0];
    /** @type {HTMLElement} */ (feedback).textContent = '';
    /** @type {HTMLElement} */ (feedback).className = 'huddle-feedback';
    if (!file) {
      /** @type {HTMLElement} */ (fileLabel).classList.remove('visible');
      uploadBtn.disabled = true;
      return;
    }
    if (!isAccepted(file))            { _reject(rejectTypeMsg); return; }
    if (file.size > MAX_UPLOAD_BYTES) { _reject('File too large — maximum 20 MB'); return; }
    /** @type {HTMLElement} */ (fileLabel).textContent = file.name;
    /** @type {HTMLElement} */ (fileLabel).classList.add('visible');
    uploadBtn.disabled = false;
  });

  uploadBtn.addEventListener('click', async () => {
    _refreshDateBounds();   // stale-tab guard — see the init comment (v16.23)
    const date = dateInput.value;
    const file = (fileInput.files || [])[0];
    if (!date || !file) return;
    // Backstop: the date-picker (date-picker.js) is now the primary guard — it hides the native
    // input and won't let an out-of-range day be selected. This submit-time check still enforces
    // `max` in case anything ever sets the value another way: a far-future date would otherwise
    // upload and, because the latest-document queries order by date desc, SHADOW the real current
    // document for every staff member until it's deleted (v16.19).
    if (dateInput.max && date > dateInput.max) {
      /** @type {HTMLElement} */ (feedback).textContent = 'That date is in the future — please choose a valid date.';
      /** @type {HTMLElement} */ (feedback).className = 'huddle-feedback huddle-feedback--err';
      return;
    }
    uploadBtn.disabled = true;
    /** @type {HTMLElement} */ (feedback).textContent = '';
    /** @type {HTMLElement} */ (feedback).className = 'huddle-feedback';

    // Optional pre-upload transform (e.g. the Huddle's DOCX→HTML). It may set its own button
    // text (e.g. "Converting…") and either yield extra upload args or abort with a message.
    let extraArgs = [];
    if (cfg.transform) {
      let r;
      try {
        r = await cfg.transform(file, { setBtnText: t => { uploadBtn.textContent = t; } });
      } catch (err) {
        // A transform that REJECTS (rather than returning {abortMsg}) must not strand the button
        // disabled on "Converting…" with no recovery. Today's only transform (_convertHuddleDocx)
        // swallows its own throws, but the skeleton is generic — restore the button on any escape (v16.19).
        console.error(`[${cfg.logPrefix}] Transform failed:`, err);
        /** @type {HTMLElement} */ (feedback).textContent = 'Upload failed — please try again';
        /** @type {HTMLElement} */ (feedback).className = 'huddle-feedback huddle-feedback--err';
        uploadBtn.disabled = false;
        uploadBtn.textContent = cfg.btnLabel;
        return;
      }
      if (r.abortMsg) {
        /** @type {HTMLElement} */ (feedback).textContent = r.abortMsg;
        /** @type {HTMLElement} */ (feedback).className = 'huddle-feedback huddle-feedback--err';
        uploadBtn.disabled = false;
        uploadBtn.textContent = cfg.btnLabel;
        return;
      }
      extraArgs = r.extraArgs || [];
    }

    uploadBtn.textContent = 'Uploading…';
    try {
      // sessionReady: a returning admin skips the login handler, so auth.currentUser may still be
      // null when the page opens — awaiting prevents a fast click hitting a permission failure.
      await sessionReady;
      await cfg.uploadFn(date, file, cfg.currentUser || '', ...extraArgs);
      /** @type {HTMLElement} */ (feedback).textContent = cfg.successMsg(date);
      /** @type {HTMLElement} */ (feedback).className = 'huddle-feedback huddle-feedback--ok';
      fileInput.value = '';
      /** @type {HTMLElement} */ (fileLabel).textContent = '';
      /** @type {HTMLElement} */ (fileLabel).classList.remove('visible');
    } catch (err) {
      console.error(`[${cfg.logPrefix}] Upload failed:`, err);
      /** @type {HTMLElement} */ (feedback).textContent =
        (/** @type {any} */ (err))?.message === 'SIGNATURE_MISMATCH' ? sigMismatchMsg : 'Upload failed — please try again';
      /** @type {HTMLElement} */ (feedback).className = 'huddle-feedback huddle-feedback--err';
      uploadBtn.disabled = false;
    } finally {
      uploadBtn.textContent = cfg.btnLabel;
    }
  });
}
