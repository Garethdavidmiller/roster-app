// @ts-check
/**
 * operations-doc-uploads.js — the Weekly Retail Circular and Marylebone Newsletter upload cards on
 * operations.html: what each card is configured with. The mechanics — the picker, the checks, the
 * upload, the one-at-a-time lock and every outcome's words — are doc-upload.js's.
 *
 * ── WHY THIS IS ITS OWN FILE ────────────────────────────────────────────────────────────────────
 *
 * operations-app.js stood at its size cap to the line, and coordinator-ratchet.test.mjs's note for
 * it says the next real feature on the page should extract a card rather than raise the number.
 * The Annual leave sheet card (operations-al-sheet.js) was that feature, so these two configurations
 * left the coordinator unchanged (14 Nov 2026). They were already pure configuration over a shared
 * engine, which is why they were the cheapest card to move.
 */
import { uploadCircular, uploadNewsletter } from './firebase-client.js';
import { initDocUploadCard, isPdfFile, isDocxFile } from './doc-upload.js';
import { NEWSLETTER_CARD } from './operations-tips.js';
import { noteNewsletterUploaded } from './newsletter-recency.js';

/**
 * Wire both cards.
 * @param {{ currentUser: string|null }} opts the signed-in admin, recorded with each upload
 */
export function initDocumentUploadCards({ currentUser }) {
    initDocUploadCard({
        dateId: 'circularDate', fileId: 'circularFileInput',
        fileLabelId: 'circularFileName', uploadBtnId: 'circularUploadBtn',
        feedbackId: 'circularFeedback', uploadFn: uploadCircular, currentUser,
        isAccepted: f => isPdfFile(f) || isDocxFile(f),
        rejectTypeMsg: 'Please choose a PDF or Word (.docx) file',
        sigMismatchMsg: "That file isn't a valid PDF or Word document — please choose the original file",
        successMsg: date => `Circular uploaded for ${date} — staff can open it from ☰ → Weekly Retail Circular`,
        btnLabel: 'Upload Circular', logPrefix: 'Circular',
        whereToCheck: '☰ → Weekly Retail Circular',
    });
    initDocUploadCard({
        dateId: 'newsletterDate', fileId: 'newsletterFileInput',
        fileLabelId: 'newsletterFileName', uploadBtnId: 'newsletterUploadBtn',
        feedbackId: 'newsletterFeedback', uploadFn: uploadNewsletter, currentUser,
        isAccepted: f => isPdfFile(f) || isDocxFile(f),
        rejectTypeMsg: 'Please choose a PDF or Word (.docx) file',
        sigMismatchMsg: "That file isn't a valid PDF or Word document — please choose the original file",
        // The date arrives in words ("6 Nov 2026"): formatted again here, it read "uploaded for —" (10 Nov 2026).
        successMsg: (date, iso) => `Newsletter uploaded for ${date} — ${NEWSLETTER_CARD.told(iso)}`,
        btnLabel: 'Upload Newsletter', logPrefix: 'Newsletter', onUploaded: noteNewsletterUploaded,   // this device's ☰ button at once
        whereToCheck: NEWSLETTER_CARD.whereToCheck,   // where a sign-out mid-upload is told to look
    });
}
