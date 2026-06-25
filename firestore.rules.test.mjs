/**
 * Firestore security rules integration tests.
 *
 * Run:  npm run test:rules
 *       (firebase emulators:exec starts the Firestore emulator, runs these tests, stops it)
 *
 * Covers all 8 collections in firestore.rules:
 *   overrides, huddles, linkDesigns, staffContact,
 *   clientErrors, circulars, newsletters, pushSubscriptions
 *
 * Each collection tests: auth boundaries, field validation, enum/format guards.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    setDoc, getDoc, addDoc, deleteDoc, updateDoc, getDocs,
    collection, doc, serverTimestamp,
} from 'firebase/firestore';

const __dir = dirname(fileURLToPath(import.meta.url));

let testEnv;

before(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: 'demo-myb-roster',
        firestore: {
            rules: readFileSync(join(__dir, 'firestore.rules'), 'utf8'),
        },
    });
});

after(async () => {
    await testEnv?.cleanup();
});

// ── Context helpers ───────────────────────────────────────────────────────────

/** Unauthenticated Firestore instance. */
function anonDb()                      { return testEnv.unauthenticatedContext().firestore(); }
/** Authenticated staff — no custom claims. */
function staffDb(uid = 'uid_staff')    { return testEnv.authenticatedContext(uid).firestore(); }
/** Authenticated admin (admin custom claim). */
function adminDb()                     { return testEnv.authenticatedContext('uid_admin', { admin: true }).firestore(); }
/** Authenticated user with a name claim (for staffContact). */
function namedDb(name, uid = 'uid_n')  { return testEnv.authenticatedContext(uid, { name }).firestore(); }

// ── Data builders ─────────────────────────────────────────────────────────────

const VALID_OVERRIDE = () => ({
    date: '2026-06-25', memberName: 'G. Miller',
    type: 'annual_leave', value: 'AL', note: '', source: 'manual',
});

const VALID_HUDDLE = () => ({
    date: '2026-06-25',
    storageUrl: 'https://storage.example.com/huddle.pdf',
    uploadedAt: serverTimestamp(), uploadedBy: 'G. Miller',
});

const VALID_CONTACT = (memberName) => ({
    memberName,
    workEmail: 'test@chilternrailways.co.uk',
    updatedAt: serverTimestamp(),
});

const VALID_ERROR = () => ({
    memberName: 'G. Miller', page: 'admin.html',
    message: 'TypeError', stack: 'at foo (bar.js:1)',
    appVersion: '13.93', userAgent: 'Mozilla/5.0',
    timestamp: serverTimestamp(), resolved: false,
});

const VALID_CIRCULAR = (date = '2026-06-25') => ({
    date, storageUrl: 'https://storage.example.com/doc.pdf',
    fileType: 'pdf', uploadedAt: serverTimestamp(), uploadedBy: 'G. Miller',
});

const VALID_SUB = () => ({
    endpoint: 'https://fcm.googleapis.com/push/APA91b',
    keys: { p256dh: 'abc123', auth: 'xyz789' },
    subscribedAt: serverTimestamp(),
});

// ── Unique IDs (avoid cross-test interference) ────────────────────────────────
let _seq = 0;
function uid() { return `doc_${++_seq}`; }

// ─────────────────────────────────────────────────────────────────────────────
// overrides
// ─────────────────────────────────────────────────────────────────────────────

describe('overrides', () => {
    test('anon can read the collection', async () => {
        await assertSucceeds(getDocs(collection(anonDb(), 'overrides')));
    });

    test('anon can read a specific document', async () => {
        await assertSucceeds(getDoc(doc(anonDb(), 'overrides', uid())));
    });

    test('anon cannot create', async () => {
        await assertFails(setDoc(doc(anonDb(), 'overrides', uid()), VALID_OVERRIDE()));
    });

    test('auth can create a valid override', async () => {
        await assertSucceeds(setDoc(doc(staffDb(), 'overrides', uid()), VALID_OVERRIDE()));
    });

    test('auth can create with all valid type values', async () => {
        for (const type of ['spare_shift', 'shift', 'rdw', 'annual_leave', 'correction', 'sick']) {
            await assertSucceeds(
                setDoc(doc(staffDb(), 'overrides', uid()), { ...VALID_OVERRIDE(), type })
            );
        }
    });

    test('auth cannot create with invalid type', async () => {
        await assertFails(
            setDoc(doc(staffDb(), 'overrides', uid()), { ...VALID_OVERRIDE(), type: 'overtime' })
        );
    });

    test('auth cannot create with invalid source', async () => {
        await assertFails(
            setDoc(doc(staffDb(), 'overrides', uid()), { ...VALID_OVERRIDE(), source: 'unknown' })
        );
    });

    test('auth cannot create with date wrong length (not 10 chars)', async () => {
        await assertFails(
            setDoc(doc(staffDb(), 'overrides', uid()), { ...VALID_OVERRIDE(), date: '2026-6-5' })
        );
    });

    test('auth cannot create with missing required field', async () => {
        const { note: _n, ...missing } = VALID_OVERRIDE();
        await assertFails(setDoc(doc(staffDb(), 'overrides', uid()), missing));
    });

    test('auth cannot create with note over 499 chars', async () => {
        await assertFails(
            setDoc(doc(staffDb(), 'overrides', uid()), { ...VALID_OVERRIDE(), note: 'x'.repeat(500) })
        );
    });

    test('auth cannot create with empty memberName', async () => {
        await assertFails(
            setDoc(doc(staffDb(), 'overrides', uid()), { ...VALID_OVERRIDE(), memberName: '' })
        );
    });

    test('auth cannot create with empty value string', async () => {
        await assertFails(
            setDoc(doc(staffDb(), 'overrides', uid()), { ...VALID_OVERRIDE(), value: '' })
        );
    });

    test('auth can delete', async () => {
        const id = uid();
        await setDoc(doc(staffDb(), 'overrides', id), VALID_OVERRIDE());
        await assertSucceeds(deleteDoc(doc(staffDb(), 'overrides', id)));
    });

    test('anon cannot delete', async () => {
        const id = uid();
        await setDoc(doc(staffDb(), 'overrides', id), VALID_OVERRIDE());
        await assertFails(deleteDoc(doc(anonDb(), 'overrides', id)));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// huddles
// ─────────────────────────────────────────────────────────────────────────────

describe('huddles', () => {
    test('anon can read', async () => {
        await assertSucceeds(getDocs(collection(anonDb(), 'huddles')));
    });

    test('anon cannot create', async () => {
        await assertFails(setDoc(doc(anonDb(), 'huddles', '2026-06-25'), VALID_HUDDLE()));
    });

    test('auth (non-admin) cannot create', async () => {
        await assertFails(setDoc(doc(staffDb(), 'huddles', '2026-06-25'), VALID_HUDDLE()));
    });

    test('admin can create a valid huddle', async () => {
        await assertSucceeds(setDoc(doc(adminDb(), 'huddles', uid()), VALID_HUDDLE()));
    });

    test('admin cannot create with missing storageUrl', async () => {
        const { storageUrl: _s, ...missing } = VALID_HUDDLE();
        await assertFails(setDoc(doc(adminDb(), 'huddles', uid()), missing));
    });

    test('admin can delete', async () => {
        const id = uid();
        await setDoc(doc(adminDb(), 'huddles', id), VALID_HUDDLE());
        await assertSucceeds(deleteDoc(doc(adminDb(), 'huddles', id)));
    });

    test('auth (non-admin) cannot delete', async () => {
        const id = uid();
        await setDoc(doc(adminDb(), 'huddles', id), VALID_HUDDLE());
        await assertFails(deleteDoc(doc(staffDb(), 'huddles', id)));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// linkDesigns
// ─────────────────────────────────────────────────────────────────────────────

describe('linkDesigns', () => {
    test('anon cannot read', async () => {
        await assertFails(getDocs(collection(anonDb(), 'linkDesigns')));
    });

    test('auth can read', async () => {
        await assertSucceeds(getDocs(collection(staffDb(), 'linkDesigns')));
    });

    test('anon cannot write', async () => {
        await assertFails(setDoc(doc(anonDb(), 'linkDesigns', uid()), { name: 'test', patterns: [] }));
    });

    test('auth can write', async () => {
        await assertSucceeds(setDoc(doc(staffDb(), 'linkDesigns', uid()), { name: 'test', patterns: [] }));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// staffContact
// ─────────────────────────────────────────────────────────────────────────────

describe('staffContact', () => {
    const MEMBER = 'G. Miller';

    test('anon cannot read', async () => {
        await assertFails(getDoc(doc(anonDb(), 'staffContact', MEMBER)));
    });

    test('auth without name claim cannot read own doc', async () => {
        await assertFails(getDoc(doc(staffDb(), 'staffContact', MEMBER)));
    });

    test('auth with matching name claim can read own doc', async () => {
        await assertSucceeds(getDoc(doc(namedDb(MEMBER), 'staffContact', MEMBER)));
    });

    test('auth with mismatched name claim cannot read another member doc', async () => {
        await assertFails(getDoc(doc(namedDb('S. Silva'), 'staffContact', MEMBER)));
    });

    test('admin can read any doc', async () => {
        await assertSucceeds(getDoc(doc(adminDb(), 'staffContact', MEMBER)));
    });

    test('auth with name claim can create valid contact', async () => {
        await assertSucceeds(
            setDoc(doc(namedDb(MEMBER), 'staffContact', MEMBER), VALID_CONTACT(MEMBER))
        );
    });

    test('auth without name claim cannot create', async () => {
        await assertFails(
            setDoc(doc(staffDb(), 'staffContact', MEMBER), VALID_CONTACT(MEMBER))
        );
    });

    test('cannot create with extra field (hasOnly violation)', async () => {
        await assertFails(
            setDoc(doc(namedDb(MEMBER), 'staffContact', MEMBER), {
                ...VALID_CONTACT(MEMBER), verified: true,
            })
        );
    });

    test('cannot create when memberName field does not match doc ID', async () => {
        await assertFails(
            setDoc(doc(namedDb(MEMBER), 'staffContact', MEMBER), {
                ...VALID_CONTACT(MEMBER), memberName: 'S. Silva',
            })
        );
    });

    test('cannot create with email lacking @', async () => {
        await assertFails(
            setDoc(doc(namedDb(MEMBER), 'staffContact', MEMBER), {
                ...VALID_CONTACT(MEMBER), workEmail: 'notanemail',
            })
        );
    });

    test('cannot create with email shorter than 5 chars', async () => {
        await assertFails(
            setDoc(doc(namedDb(MEMBER), 'staffContact', MEMBER), {
                ...VALID_CONTACT(MEMBER), workEmail: 'a@b',
            })
        );
    });

    test('cannot create with updatedAt as string instead of timestamp', async () => {
        await assertFails(
            setDoc(doc(namedDb(MEMBER), 'staffContact', MEMBER), {
                ...VALID_CONTACT(MEMBER), updatedAt: '2026-06-25',
            })
        );
    });

    test('auth with name claim can delete own doc', async () => {
        const member = 'T. Tester';
        await setDoc(doc(namedDb(member, 'uid_tester'), 'staffContact', member), VALID_CONTACT(member));
        await assertSucceeds(deleteDoc(doc(namedDb(member, 'uid_t'), 'staffContact', member)));
    });

    test('admin can delete any doc', async () => {
        const member = 'T. Admin';
        await setDoc(doc(namedDb(member, 'uid_tadmin'), 'staffContact', member), VALID_CONTACT(member));
        await assertSucceeds(deleteDoc(doc(adminDb(), 'staffContact', member)));
    });

    test('auth without claim cannot delete', async () => {
        const member = 'T. Staff';
        await setDoc(doc(namedDb(member, 'uid_tstaff'), 'staffContact', member), VALID_CONTACT(member));
        await assertFails(deleteDoc(doc(staffDb(), 'staffContact', member)));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// clientErrors
// ─────────────────────────────────────────────────────────────────────────────

describe('clientErrors', () => {
    test('anon cannot create', async () => {
        await assertFails(addDoc(collection(anonDb(), 'clientErrors'), VALID_ERROR()));
    });

    test('auth can create a valid error report', async () => {
        await assertSucceeds(addDoc(collection(staffDb(), 'clientErrors'), VALID_ERROR()));
    });

    test('auth cannot create with resolved=true', async () => {
        await assertFails(
            addDoc(collection(staffDb(), 'clientErrors'), { ...VALID_ERROR(), resolved: true })
        );
    });

    test('auth cannot create with message over 300 chars', async () => {
        await assertFails(
            addDoc(collection(staffDb(), 'clientErrors'), {
                ...VALID_ERROR(), message: 'x'.repeat(301),
            })
        );
    });

    test('auth cannot create with stack over 800 chars', async () => {
        await assertFails(
            addDoc(collection(staffDb(), 'clientErrors'), {
                ...VALID_ERROR(), stack: 's'.repeat(801),
            })
        );
    });

    test('auth cannot create with userAgent over 150 chars', async () => {
        await assertFails(
            addDoc(collection(staffDb(), 'clientErrors'), {
                ...VALID_ERROR(), userAgent: 'u'.repeat(151),
            })
        );
    });

    test('auth cannot create with extra field (hasOnly violation)', async () => {
        await assertFails(
            addDoc(collection(staffDb(), 'clientErrors'), {
                ...VALID_ERROR(), extra: 'field',
            })
        );
    });

    test('auth cannot create with timestamp as string', async () => {
        await assertFails(
            addDoc(collection(staffDb(), 'clientErrors'), {
                ...VALID_ERROR(), timestamp: '2026-06-25',
            })
        );
    });

    test('auth (non-admin) cannot read clientErrors', async () => {
        await assertFails(getDocs(collection(staffDb(), 'clientErrors')));
    });

    test('admin can read clientErrors', async () => {
        await assertSucceeds(getDocs(collection(adminDb(), 'clientErrors')));
    });

    test('admin can update (resolve) an error', async () => {
        const ref = await addDoc(collection(staffDb(), 'clientErrors'), VALID_ERROR());
        await assertSucceeds(
            updateDoc(doc(adminDb(), 'clientErrors', ref.id), { resolved: true, resolvedAt: serverTimestamp() })
        );
    });

    test('auth (non-admin) cannot update', async () => {
        const ref = await addDoc(collection(staffDb(), 'clientErrors'), VALID_ERROR());
        await assertFails(
            updateDoc(doc(staffDb(), 'clientErrors', ref.id), { resolved: true })
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// circulars
// ─────────────────────────────────────────────────────────────────────────────

describe('circulars', () => {
    test('anon can read', async () => {
        await assertSucceeds(getDocs(collection(anonDb(), 'circulars')));
    });

    test('anon cannot create', async () => {
        await assertFails(setDoc(doc(anonDb(), 'circulars', '2026-06-25'), VALID_CIRCULAR()));
    });

    test('auth (non-admin) cannot create', async () => {
        await assertFails(setDoc(doc(staffDb(), 'circulars', uid()), VALID_CIRCULAR()));
    });

    test('admin can create a valid circular', async () => {
        await assertSucceeds(setDoc(doc(adminDb(), 'circulars', uid()), VALID_CIRCULAR()));
    });

    test('admin cannot create with wrong fileType', async () => {
        await assertFails(
            setDoc(doc(adminDb(), 'circulars', uid()), { ...VALID_CIRCULAR(), fileType: 'docx' })
        );
    });

    test('admin cannot create with date not 10 chars', async () => {
        await assertFails(
            setDoc(doc(adminDb(), 'circulars', uid()), { ...VALID_CIRCULAR(), date: '2026-6-25' })
        );
    });

    test('admin cannot create with extra field (hasOnly violation)', async () => {
        await assertFails(
            setDoc(doc(adminDb(), 'circulars', uid()), { ...VALID_CIRCULAR(), extra: 'field' })
        );
    });

    test('admin cannot create with uploadedAt as string', async () => {
        await assertFails(
            setDoc(doc(adminDb(), 'circulars', uid()), { ...VALID_CIRCULAR(), uploadedAt: '2026-06-25' })
        );
    });

    test('admin can delete', async () => {
        const id = uid();
        await setDoc(doc(adminDb(), 'circulars', id), VALID_CIRCULAR());
        await assertSucceeds(deleteDoc(doc(adminDb(), 'circulars', id)));
    });

    test('auth (non-admin) cannot delete', async () => {
        const id = uid();
        await setDoc(doc(adminDb(), 'circulars', id), VALID_CIRCULAR());
        await assertFails(deleteDoc(doc(staffDb(), 'circulars', id)));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// newsletters  (mirror of circulars rules — tests kept separate for regression safety)
// ─────────────────────────────────────────────────────────────────────────────

describe('newsletters', () => {
    test('anon can read', async () => {
        await assertSucceeds(getDocs(collection(anonDb(), 'newsletters')));
    });

    test('anon cannot create', async () => {
        await assertFails(setDoc(doc(anonDb(), 'newsletters', uid()), VALID_CIRCULAR()));
    });

    test('auth (non-admin) cannot create', async () => {
        await assertFails(setDoc(doc(staffDb(), 'newsletters', uid()), VALID_CIRCULAR()));
    });

    test('admin can create a valid newsletter', async () => {
        await assertSucceeds(setDoc(doc(adminDb(), 'newsletters', uid()), VALID_CIRCULAR()));
    });

    test('admin cannot create with wrong fileType', async () => {
        await assertFails(
            setDoc(doc(adminDb(), 'newsletters', uid()), { ...VALID_CIRCULAR(), fileType: 'pdf2' })
        );
    });

    test('admin cannot create with date not 10 chars', async () => {
        await assertFails(
            setDoc(doc(adminDb(), 'newsletters', uid()), { ...VALID_CIRCULAR(), date: '2026-6-25' })
        );
    });

    test('admin cannot create with extra field', async () => {
        await assertFails(
            setDoc(doc(adminDb(), 'newsletters', uid()), { ...VALID_CIRCULAR(), htmlContent: '<p>' })
        );
    });

    test('admin cannot create with uploadedAt as string', async () => {
        await assertFails(
            setDoc(doc(adminDb(), 'newsletters', uid()), { ...VALID_CIRCULAR(), uploadedAt: '2026-06-25' })
        );
    });

    test('admin can delete', async () => {
        const id = uid();
        await setDoc(doc(adminDb(), 'newsletters', id), VALID_CIRCULAR());
        await assertSucceeds(deleteDoc(doc(adminDb(), 'newsletters', id)));
    });

    test('auth (non-admin) cannot delete', async () => {
        const id = uid();
        await setDoc(doc(adminDb(), 'newsletters', id), VALID_CIRCULAR());
        await assertFails(deleteDoc(doc(staffDb(), 'newsletters', id)));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// pushSubscriptions
// ─────────────────────────────────────────────────────────────────────────────

describe('pushSubscriptions', () => {
    test('anon can create a valid subscription (no auth required)', async () => {
        await assertSucceeds(setDoc(doc(anonDb(), 'pushSubscriptions', uid()), VALID_SUB()));
    });

    test('anon cannot create with missing endpoint', async () => {
        const { endpoint: _e, ...missing } = VALID_SUB();
        await assertFails(setDoc(doc(anonDb(), 'pushSubscriptions', uid()), missing));
    });

    test('anon cannot create with missing keys.p256dh', async () => {
        await assertFails(
            setDoc(doc(anonDb(), 'pushSubscriptions', uid()), {
                ...VALID_SUB(), keys: { auth: 'xyz789' },
            })
        );
    });

    test('anon cannot create without subscribedAt', async () => {
        const { subscribedAt: _s, ...missing } = VALID_SUB();
        await assertFails(setDoc(doc(anonDb(), 'pushSubscriptions', uid()), missing));
    });

    test('anon cannot create with empty endpoint string', async () => {
        await assertFails(
            setDoc(doc(anonDb(), 'pushSubscriptions', uid()), { ...VALID_SUB(), endpoint: '' })
        );
    });

    test('anon cannot read', async () => {
        await assertFails(getDocs(collection(anonDb(), 'pushSubscriptions')));
    });

    test('auth can read', async () => {
        await assertSucceeds(getDocs(collection(staffDb(), 'pushSubscriptions')));
    });

    test('anon cannot delete', async () => {
        const id = uid();
        await setDoc(doc(anonDb(), 'pushSubscriptions', id), VALID_SUB());
        await assertFails(deleteDoc(doc(anonDb(), 'pushSubscriptions', id)));
    });

    test('auth can delete', async () => {
        const id = uid();
        await setDoc(doc(anonDb(), 'pushSubscriptions', id), VALID_SUB());
        await assertSucceeds(deleteDoc(doc(staffDb(), 'pushSubscriptions', id)));
    });
});
