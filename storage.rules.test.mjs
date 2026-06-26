/**
 * Firebase Storage security rules integration tests.
 *
 * Run:  npm run test:rules
 *       (firebase emulators:exec starts both the Firestore and Storage emulators,
 *        runs this file alongside firestore.rules.test.mjs, then stops both)
 *
 * Covers all three named match blocks in storage.rules:
 *   huddles   — read: auth required; write: admin + ≤20 MB + PDF or DOCX
 *   circulars — read: auth required; create/update: admin + ≤20 MB + PDF only;
 *               delete: admin only (no request.resource check)
 *   newsletters — identical rules to circulars
 *   catch-all — everything else: allow read, write: if false
 *
 * Note on the 20 MB size limit: the emulator enforces the `request.resource.size`
 * rule correctly, but allocating a 20 MB+ buffer in a unit-test suite is
 * impractical. Coverage of the size cap is therefore verified by code inspection
 * of storage.rules; the tests below focus on auth and contentType boundaries.
 */
import { test, describe, before, after } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';

const __dir = dirname(fileURLToPath(import.meta.url));

// Minimal valid file payloads for upload tests.
const PDF_BYTES  = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]); // %PDF-1.4
const DOCX_BYTES = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]); // PK (ZIP) header
const TEXT_BYTES = new Uint8Array([0x68, 0x65, 0x6C, 0x6C, 0x6F]);                    // "hello"

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

let testEnv;

before(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: 'demo-myb-roster',
        storage: {
            rules: readFileSync(join(__dir, 'storage.rules'), 'utf8'),
            host:  '127.0.0.1',
            port:  9199,
        },
    });

    // Seed one readable file per secured collection so that permission-denied read
    // tests fail on access (not on "not found"), and likewise for the catch-all test.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const s = ctx.storage();
        await uploadBytes(ref(s, 'huddles/seed.pdf'),     PDF_BYTES, { contentType: 'application/pdf' });
        await uploadBytes(ref(s, 'circulars/seed.pdf'),   PDF_BYTES, { contentType: 'application/pdf' });
        await uploadBytes(ref(s, 'newsletters/seed.pdf'), PDF_BYTES, { contentType: 'application/pdf' });
        await uploadBytes(ref(s, 'other/seed.pdf'),       PDF_BYTES, { contentType: 'application/pdf' });
    });
});

after(async () => {
    await testEnv?.cleanup();
});

// ── Context helpers ───────────────────────────────────────────────────────────

/** Unauthenticated Storage instance. */
function anonStorage() {
    return testEnv.unauthenticatedContext().storage();
}
/** Authenticated staff — no custom claims. */
function staffStorage(uid = 'uid_staff') {
    return testEnv.authenticatedContext(uid).storage();
}
/** Authenticated admin (admin custom claim). */
function adminStorage() {
    return testEnv.authenticatedContext('uid_admin', { admin: true }).storage();
}

// ── Unique upload paths (avoid cross-test write interference) ─────────────────

let _seq = 0;
function upath(col) { return `${col}/file_${++_seq}.pdf`; }

// ── Seed helper — used inside delete tests to ensure the target file exists. ──

async function seedFile(path) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await uploadBytes(ref(ctx.storage(), path), PDF_BYTES, { contentType: 'application/pdf' });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// huddles
// ─────────────────────────────────────────────────────────────────────────────

describe('huddles', () => {
    test('authenticated staff can read', async () => {
        await assertSucceeds(getBytes(ref(staffStorage(), 'huddles/seed.pdf')));
    });

    test('unauthenticated cannot read', async () => {
        await assertFails(getBytes(ref(anonStorage(), 'huddles/seed.pdf')));
    });

    test('admin can upload a PDF', async () => {
        await assertSucceeds(
            uploadBytes(ref(adminStorage(), upath('huddles')), PDF_BYTES, { contentType: 'application/pdf' })
        );
    });

    test('admin can upload a DOCX', async () => {
        await assertSucceeds(
            uploadBytes(ref(adminStorage(), upath('huddles')), DOCX_BYTES, { contentType: DOCX_CONTENT_TYPE })
        );
    });

    test('non-admin staff cannot upload', async () => {
        await assertFails(
            uploadBytes(ref(staffStorage(), upath('huddles')), PDF_BYTES, { contentType: 'application/pdf' })
        );
    });

    test('unauthenticated cannot upload', async () => {
        await assertFails(
            uploadBytes(ref(anonStorage(), upath('huddles')), PDF_BYTES, { contentType: 'application/pdf' })
        );
    });

    test('admin cannot upload an unsupported MIME type', async () => {
        await assertFails(
            uploadBytes(ref(adminStorage(), upath('huddles')), TEXT_BYTES, { contentType: 'text/plain' })
        );
    });

    // Admin delete of huddles is intentionally NOT allowed by the rules: the
    // `allow write` rule checks request.resource.size/contentType, which are
    // undefined for delete operations, causing the rule to evaluate to false.
    // Huddle files are only removed via the Admin SDK (Cloud Functions).
    test('admin cannot delete a huddle file', async () => {
        await assertFails(deleteObject(ref(adminStorage(), 'huddles/seed.pdf')));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// circulars
// ─────────────────────────────────────────────────────────────────────────────

describe('circulars', () => {
    test('authenticated staff can read', async () => {
        await assertSucceeds(getBytes(ref(staffStorage(), 'circulars/seed.pdf')));
    });

    test('unauthenticated cannot read', async () => {
        await assertFails(getBytes(ref(anonStorage(), 'circulars/seed.pdf')));
    });

    test('admin can create a PDF', async () => {
        await assertSucceeds(
            uploadBytes(ref(adminStorage(), upath('circulars')), PDF_BYTES, { contentType: 'application/pdf' })
        );
    });

    test('admin can update (overwrite) an existing PDF', async () => {
        const p = upath('circulars');
        await seedFile(p);
        await assertSucceeds(
            uploadBytes(ref(adminStorage(), p), PDF_BYTES, { contentType: 'application/pdf' })
        );
    });

    test('admin can delete a circular', async () => {
        const p = upath('circulars');
        await seedFile(p);
        await assertSucceeds(deleteObject(ref(adminStorage(), p)));
    });

    test('non-admin staff cannot create', async () => {
        await assertFails(
            uploadBytes(ref(staffStorage(), upath('circulars')), PDF_BYTES, { contentType: 'application/pdf' })
        );
    });

    test('unauthenticated cannot create', async () => {
        await assertFails(
            uploadBytes(ref(anonStorage(), upath('circulars')), PDF_BYTES, { contentType: 'application/pdf' })
        );
    });

    test('admin cannot upload a non-PDF MIME type', async () => {
        await assertFails(
            uploadBytes(ref(adminStorage(), upath('circulars')), TEXT_BYTES, { contentType: 'text/plain' })
        );
    });

    test('admin cannot upload a DOCX (PDF-only collection)', async () => {
        await assertFails(
            uploadBytes(ref(adminStorage(), upath('circulars')), DOCX_BYTES, { contentType: DOCX_CONTENT_TYPE })
        );
    });

    test('non-admin cannot delete', async () => {
        const p = upath('circulars');
        await seedFile(p);
        await assertFails(deleteObject(ref(staffStorage(), p)));
    });

    test('unauthenticated cannot delete', async () => {
        const p = upath('circulars');
        await seedFile(p);
        await assertFails(deleteObject(ref(anonStorage(), p)));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// newsletters  (identical rules to circulars — duplicate coverage is intentional)
// ─────────────────────────────────────────────────────────────────────────────

describe('newsletters', () => {
    test('authenticated staff can read', async () => {
        await assertSucceeds(getBytes(ref(staffStorage(), 'newsletters/seed.pdf')));
    });

    test('unauthenticated cannot read', async () => {
        await assertFails(getBytes(ref(anonStorage(), 'newsletters/seed.pdf')));
    });

    test('admin can create a PDF', async () => {
        await assertSucceeds(
            uploadBytes(ref(adminStorage(), upath('newsletters')), PDF_BYTES, { contentType: 'application/pdf' })
        );
    });

    test('admin can update (overwrite) an existing PDF', async () => {
        const p = upath('newsletters');
        await seedFile(p);
        await assertSucceeds(
            uploadBytes(ref(adminStorage(), p), PDF_BYTES, { contentType: 'application/pdf' })
        );
    });

    test('admin can delete a newsletter', async () => {
        const p = upath('newsletters');
        await seedFile(p);
        await assertSucceeds(deleteObject(ref(adminStorage(), p)));
    });

    test('non-admin staff cannot create', async () => {
        await assertFails(
            uploadBytes(ref(staffStorage(), upath('newsletters')), PDF_BYTES, { contentType: 'application/pdf' })
        );
    });

    test('unauthenticated cannot create', async () => {
        await assertFails(
            uploadBytes(ref(anonStorage(), upath('newsletters')), PDF_BYTES, { contentType: 'application/pdf' })
        );
    });

    test('admin cannot upload a non-PDF MIME type', async () => {
        await assertFails(
            uploadBytes(ref(adminStorage(), upath('newsletters')), TEXT_BYTES, { contentType: 'text/plain' })
        );
    });

    test('admin cannot upload a DOCX (PDF-only collection)', async () => {
        await assertFails(
            uploadBytes(ref(adminStorage(), upath('newsletters')), DOCX_BYTES, { contentType: DOCX_CONTENT_TYPE })
        );
    });

    test('non-admin cannot delete', async () => {
        const p = upath('newsletters');
        await seedFile(p);
        await assertFails(deleteObject(ref(staffStorage(), p)));
    });

    test('unauthenticated cannot delete', async () => {
        const p = upath('newsletters');
        await seedFile(p);
        await assertFails(deleteObject(ref(anonStorage(), p)));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// catch-all — paths outside the three named collections are denied entirely
// ─────────────────────────────────────────────────────────────────────────────

describe('catch-all', () => {
    test('authenticated staff cannot read an arbitrary path', async () => {
        // 'other/seed.pdf' was seeded via withSecurityRulesDisabled in before().
        await assertFails(getBytes(ref(staffStorage(), 'other/seed.pdf')));
    });

    test('admin cannot read an arbitrary path', async () => {
        await assertFails(getBytes(ref(adminStorage(), 'other/seed.pdf')));
    });

    test('admin cannot write to an arbitrary path', async () => {
        await assertFails(
            uploadBytes(ref(adminStorage(), 'other/new.pdf'), PDF_BYTES, { contentType: 'application/pdf' })
        );
    });

    test('unauthenticated cannot write to an arbitrary path', async () => {
        await assertFails(
            uploadBytes(ref(anonStorage(), 'other/new.pdf'), PDF_BYTES, { contentType: 'application/pdf' })
        );
    });
});
