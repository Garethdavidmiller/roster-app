/**
 * Firestore security rules integration tests.
 *
 * Run:  npm run test:rules
 *       (firebase emulators:exec starts the Firestore emulator, runs these tests, stops it)
 *
 * Covers all 9 collections in firestore.rules:
 *   overrides, huddles, linkDesigns, staffContact,
 *   clientErrors, circulars, newsletters, pushSubscriptions, analytics
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
    collection, doc, serverTimestamp, increment,
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
/** Authenticated user with a name claim (for staffContact + override isolation). */
function namedDb(name, uid = 'uid_n')  { return testEnv.authenticatedContext(uid, { name }).firestore(); }
/** Authenticated manager (manager + name claims) — writes overrides on behalf of any member (B2). */
function managerDb(name, uid = 'uid_mgr') { return testEnv.authenticatedContext(uid, { manager: true, name }).firestore(); }
/** Authenticated links designer (linksDesigner + name claims) — writes linkDesigns (H2). */
function designerDb(name = 'S. Silva', uid = 'uid_designer') { return testEnv.authenticatedContext(uid, { name, linksDesigner: true }).firestore(); }

// ── Data builders ─────────────────────────────────────────────────────────────

const VALID_OVERRIDE = () => ({
    date: '2026-06-25', memberName: 'G. Miller',
    type: 'annual_leave', value: 'AL', note: '', source: 'manual',
    createdAt: serverTimestamp(),
});

const VALID_HUDDLE = () => ({
    date: '2026-06-25',
    storageUrl: 'https://storage.example.com/huddle.pdf',
    storagePath: 'huddles/2026-06-25-abc123.pdf',
    // Short form — matches what uploadHuddle() actually writes (not a MIME type).
    fileType: 'pdf',
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
        await assertSucceeds(setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), VALID_OVERRIDE()));
    });

    test('auth can create with all valid type+value combinations', async () => {
        // These mirror the real client write contract — TYPES[*].fixedValue in
        // admin-overrides.js (spare_shift→SPARE, annual_leave→AL, correction→RD,
        // sick→SICK) and the plain HH:MM-HH:MM range that admin-roster-upload.js
        // writes for the timed types. Do NOT model spare_shift as a time range:
        // the app never writes that, and doing so masked a rule/app mismatch.
        const TYPE_VALUE_MAP = {
            spare_shift:  'SPARE',
            shift:        '14:30-22:30',
            rdw:          '22:00-06:00',
            annual_leave: 'AL',
            correction:   'RD',
            sick:         'SICK',
            other:        'TRG',
        };
        for (const [type, value] of Object.entries(TYPE_VALUE_MAP)) {
            await assertSucceeds(
                setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), type, value })
            );
        }
    });

    test('auth cannot create a spare_shift with a time-range value (must be SPARE)', async () => {
        await assertFails(
            setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), type: 'spare_shift', value: '06:30-14:30' })
        );
    });

    test('auth cannot create a correction with a non-RD value (e.g. OFF)', async () => {
        await assertFails(
            setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), type: 'correction', value: 'OFF' })
        );
    });

    test('auth cannot create with mismatched type and value (shift type needs HH:MM-HH:MM)', async () => {
        await assertFails(
            setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), type: 'shift', value: 'AL' })
        );
    });

    test('auth cannot create with mismatched type and value (annual_leave needs AL)', async () => {
        await assertFails(
            setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), type: 'annual_leave', value: '09:00-17:00' })
        );
    });

    test('auth cannot create with malformed time value for shift type', async () => {
        await assertFails(
            setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), type: 'shift', value: 'garbage' })
        );
    });

    test('auth cannot create with invalid type', async () => {
        await assertFails(
            setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), type: 'overtime' })
        );
    });

    // ── training value grammar (OTHER_PLAN.md): FLAVOUR [" RDW"] [" HH:MM-HH:MM"] ──

    test('training accepts every grammar form (flavours, RDW marker, actual times)', async () => {
        for (const value of ['TRG', 'IND', 'ASSESS', 'TEAM', 'TRG RDW', 'ASSESS RDW', 'TEAM RDW',
                             'IND 08:00-16:00', 'TRG RDW 08:00-16:00']) {
            await assertSucceeds(
                setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), type: 'other', value })
            );
        }
    });

    test('training rejects a bare time value (flavour is mandatory)', async () => {
        await assertFails(
            setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), type: 'other', value: '06:00-12:00' })
        );
    });

    test('training rejects malformed grammar and impossible times', async () => {
        for (const value of ['TRAINING', 'TRG BAD', 'ASS', 'TRG 25:00-30:00', 'RDW TRG', 'TRG RDW extra']) {
            await assertFails(
                setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), type: 'other', value })
            );
        }
    });

    test('a training value on a NON-training type is rejected (shift needs a time)', async () => {
        await assertFails(
            setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), type: 'shift', value: 'TRG' })
        );
    });

    test('auth cannot create with invalid source', async () => {
        await assertFails(
            setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), source: 'unknown' })
        );
    });

    test('auth cannot create with date wrong length (not 10 chars)', async () => {
        await assertFails(
            setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), date: '2026-6-5' })
        );
    });

    test('auth cannot create with missing required field', async () => {
        const { note: _n, ...missing } = VALID_OVERRIDE();
        await assertFails(setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), missing));
    });

    test('auth can create with changedBy (manual / AL / sick path)', async () => {
        await assertSucceeds(
            setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), changedBy: 'G. Miller' })
        );
    });

    test('auth cannot create with an unknown extra field (hasOnly)', async () => {
        await assertFails(
            setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), injected: 'x' })
        );
    });

    test('auth cannot create with changedBy of the wrong type', async () => {
        await assertFails(
            setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), changedBy: 123 })
        );
    });

    test('auth cannot create with a 10-char but malformed date', async () => {
        await assertFails(
            setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), date: '2026/06/25' })
        );
    });

    test('auth cannot create a shift with an impossible time (99:99)', async () => {
        await assertFails(
            setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), type: 'shift', value: '99:99-10:00' })
        );
    });

    test('auth can create a shift with a valid bounded time (overnight)', async () => {
        await assertSucceeds(
            setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), type: 'shift', value: '23:00-05:30' })
        );
    });

    test('auth cannot create with note over 499 chars', async () => {
        await assertFails(
            setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), note: 'x'.repeat(500) })
        );
    });

    test('auth cannot create with empty memberName', async () => {
        await assertFails(
            setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), memberName: '' })
        );
    });

    test('auth cannot create with empty value string', async () => {
        await assertFails(
            setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), value: '' })
        );
    });

    test('auth can delete', async () => {
        const id = uid();
        await setDoc(doc(namedDb('G. Miller'), 'overrides', id), VALID_OVERRIDE());
        await assertSucceeds(deleteDoc(doc(namedDb('G. Miller'), 'overrides', id)));
    });

    test('anon cannot delete', async () => {
        const id = uid();
        await setDoc(doc(namedDb('G. Miller'), 'overrides', id), VALID_OVERRIDE());
        await assertFails(deleteDoc(doc(anonDb(), 'overrides', id)));
    });

    // ── B2 date hardening: shape was validated but not real month/day ranges ──
    test('auth cannot create with impossible month (2026-13-01)', async () => {
        await assertFails(setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), date: '2026-13-01' }));
    });
    test('auth cannot create with impossible date (2026-99-99)', async () => {
        await assertFails(setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), date: '2026-99-99' }));
    });
    test('auth cannot create with month 00 / day 00 (2026-00-00)', async () => {
        await assertFails(setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), date: '2026-00-00' }));
    });
    test('auth CAN create with a real edge date (2026-12-31)', async () => {
        await assertSucceeds(setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), { ...VALID_OVERRIDE(), date: '2026-12-31' }));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// overrides — per-member write isolation (STRICT, B3)
// namedDb(name) carries a `name` claim (models a real provisioned member, whose token's
// `name` mirrors the memberName); managerDb carries manager:true; adminDb carries admin:true;
// staffDb carries NO claim (models the legacy/anonymous session — DENIED under B3 strict).
// ─────────────────────────────────────────────────────────────────────────────
describe('overrides — per-member isolation (STRICT, B3)', () => {
    const OWN = (name) => ({ ...VALID_OVERRIDE(), memberName: name });

    test('named staff CAN write their OWN override', async () => {
        await assertSucceeds(setDoc(doc(namedDb('S. Boyle'), 'overrides', uid()), OWN('S. Boyle')));
    });
    test('named staff CANNOT write another member\'s override', async () => {
        await assertFails(setDoc(doc(namedDb('S. Boyle'), 'overrides', uid()), OWN('G. Miller')));
    });
    test('admin CAN write another member\'s override (on-behalf bypass)', async () => {
        await assertSucceeds(setDoc(doc(adminDb(), 'overrides', uid()), OWN('G. Miller')));
    });
    test('manager CAN write another member\'s override (on-behalf bypass)', async () => {
        await assertSucceeds(setDoc(doc(managerDb('S. Stewart'), 'overrides', uid()), OWN('G. Miller')));
    });
    test('admin roster_import write for another member still saves', async () => {
        await assertSucceeds(setDoc(doc(adminDb(), 'overrides', uid()),
            { ...OWN('G. Miller'), source: 'roster_import', type: 'shift', value: '06:30-14:30' }));
    });
    test('a name-less (legacy) session is DENIED create (permissive escape removed)', async () => {
        await assertFails(setDoc(doc(staffDb(), 'overrides', uid()), OWN('G. Miller')));
    });
    test('a name-less (legacy) session is DENIED delete (permissive escape removed)', async () => {
        const id = uid();
        await setDoc(doc(adminDb(), 'overrides', id), OWN('G. Miller'));
        await assertFails(deleteDoc(doc(staffDb(), 'overrides', id)));
    });

    // deletes mirror the same three-tier check against the EXISTING doc's memberName
    test('named staff CANNOT delete another member\'s override', async () => {
        const id = uid();
        await setDoc(doc(adminDb(), 'overrides', id), OWN('G. Miller'));
        await assertFails(deleteDoc(doc(namedDb('S. Boyle'), 'overrides', id)));
    });
    test('named staff CAN delete their OWN override', async () => {
        const id = uid();
        await setDoc(doc(namedDb('S. Boyle'), 'overrides', id), OWN('S. Boyle'));
        await assertSucceeds(deleteDoc(doc(namedDb('S. Boyle'), 'overrides', id)));
    });
    test('manager CAN delete another member\'s override', async () => {
        const id = uid();
        await setDoc(doc(adminDb(), 'overrides', id), OWN('G. Miller'));
        await assertSucceeds(deleteDoc(doc(managerDb('S. Stewart'), 'overrides', id)));
    });
    test('admin CAN delete another member\'s override', async () => {
        const id = uid();
        await setDoc(doc(adminDb(), 'overrides', id), OWN('G. Miller'));
        await assertSucceeds(deleteDoc(doc(adminDb(), 'overrides', id)));
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

    test('admin can create huddle with optional htmlContent', async () => {
        await assertSucceeds(
            setDoc(doc(adminDb(), 'huddles', uid()), { ...VALID_HUDDLE(), htmlContent: '<p>Hello</p>' })
        );
    });

    test('admin cannot create with uploadedAt as string', async () => {
        await assertFails(
            setDoc(doc(adminDb(), 'huddles', uid()), { ...VALID_HUDDLE(), uploadedAt: '2026-06-25' })
        );
    });

    test('admin cannot create with extra field (hasOnly violation)', async () => {
        await assertFails(
            setDoc(doc(adminDb(), 'huddles', uid()), { ...VALID_HUDDLE(), extra: 'field' })
        );
    });

    test('admin cannot create with a malformed date (must be YYYY-MM-DD)', async () => {
        // Parity with circulars/newsletters — a malformed date would break the string-range prune.
        await assertFails(setDoc(doc(adminDb(), 'huddles', uid()), { ...VALID_HUDDLE(), date: '2026-6-5' }));
        await assertFails(setDoc(doc(adminDb(), 'huddles', uid()), { ...VALID_HUDDLE(), date: '2026/06/25' }));
        await assertFails(setDoc(doc(adminDb(), 'huddles', uid()), { ...VALID_HUDDLE(), date: '2026-13-01' }));
    });

    test('admin cannot create with an invalid fileType', async () => {
        // A MIME type (the old fixture value) or anything outside ['pdf','docx'] is rejected.
        await assertFails(
            setDoc(doc(adminDb(), 'huddles', uid()), { ...VALID_HUDDLE(), fileType: 'application/pdf' })
        );
    });

    test('admin cannot create with non-string uploadedBy', async () => {
        await assertFails(
            setDoc(doc(adminDb(), 'huddles', uid()), { ...VALID_HUDDLE(), uploadedBy: 12345 })
        );
    });

    test('admin cannot create with non-string htmlContent', async () => {
        await assertFails(
            setDoc(doc(adminDb(), 'huddles', uid()), { ...VALID_HUDDLE(), htmlContent: 12345 })
        );
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

describe('linkDesigns — designer-write enforcement (H2)', () => {
    const DESIGN = () => ({ name: 'Line 1', patterns: {}, updatedAt: serverTimestamp(), updatedBy: 'S. Silva' });

    test('anon cannot read', async () => {
        await assertFails(getDocs(collection(anonDb(), 'linkDesigns')));
    });
    test('any authenticated user can READ (reads stay open)', async () => {
        await assertSucceeds(getDocs(collection(staffDb(), 'linkDesigns')));
    });
    test('a designer can WRITE', async () => {
        await assertSucceeds(setDoc(doc(designerDb(), 'linkDesigns', uid()), DESIGN()));
    });
    test('an admin can WRITE (admin outranks)', async () => {
        await assertSucceeds(setDoc(doc(adminDb(), 'linkDesigns', uid()), DESIGN()));
    });
    test('a plain authenticated user (name only, no designer/admin) CANNOT WRITE', async () => {
        await assertFails(setDoc(doc(namedDb('J. Davies'), 'linkDesigns', uid()), DESIGN()));
    });
    test('a name-less authenticated session CANNOT WRITE', async () => {
        await assertFails(setDoc(doc(staffDb(), 'linkDesigns', uid()), DESIGN()));
    });
    test('an anonymous session CANNOT WRITE', async () => {
        await assertFails(setDoc(doc(anonDb(), 'linkDesigns', uid()), DESIGN()));
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

    test('cannot create with a non-Chiltern domain', async () => {
        for (const bad of [
            'john@gmail.com',
            'john@arriva.co.uk',
            'x@evil-chilternrailways.co.uk',
            'x@sub.chilternrailways.co.uk',
            'x@chilternrailways.co.uk.evil.com',
        ]) {
            await assertFails(
                setDoc(doc(namedDb(MEMBER), 'staffContact', MEMBER), {
                    ...VALID_CONTACT(MEMBER), workEmail: bad,
                })
            );
        }
    });

    test('accepts the Chiltern domain in any case', async () => {
        await assertSucceeds(
            setDoc(doc(namedDb(MEMBER), 'staffContact', MEMBER), {
                ...VALID_CONTACT(MEMBER), workEmail: 'John.Smith@ChilternRailways.CO.UK',
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
        await assertSucceeds(deleteDoc(doc(namedDb(member, 'uid_tester'), 'staffContact', member)));
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

    test('admin can create a DOCX circular (Word uploads allowed)', async () => {
        await assertSucceeds(
            setDoc(doc(adminDb(), 'circulars', uid()), { ...VALID_CIRCULAR(), fileType: 'docx' })
        );
    });

    test('admin cannot create with an invalid fileType (not pdf/docx)', async () => {
        await assertFails(
            setDoc(doc(adminDb(), 'circulars', uid()), { ...VALID_CIRCULAR(), fileType: 'txt' })
        );
    });

    test('admin cannot create with date not 10 chars', async () => {
        await assertFails(
            setDoc(doc(adminDb(), 'circulars', uid()), { ...VALID_CIRCULAR(), date: '2026-6-25' })
        );
    });

    test('admin cannot create with impossible date (2026-13-01) — B2 date bounding', async () => {
        await assertFails(
            setDoc(doc(adminDb(), 'circulars', uid()), { ...VALID_CIRCULAR(), date: '2026-13-01' })
        );
    });

    test('admin can create with storagePath field (v13.99+)', async () => {
        await assertSucceeds(
            setDoc(doc(adminDb(), 'circulars', uid()), { ...VALID_CIRCULAR(), storagePath: 'circulars/2026-06-25-abc123.pdf' })
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

    test('admin can create a DOCX newsletter (Word uploads allowed)', async () => {
        await assertSucceeds(setDoc(doc(adminDb(), 'newsletters', uid()), { ...VALID_CIRCULAR(), fileType: 'docx' }));
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

    test('admin can create with storagePath field (v13.99+)', async () => {
        await assertSucceeds(
            setDoc(doc(adminDb(), 'newsletters', uid()), { ...VALID_CIRCULAR(), storagePath: 'newsletters/2026-06-25-abc123.pdf' })
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
    test('authenticated user (incl. anonymous session) can create a valid subscription', async () => {
        // An anonymous Firebase Auth session (signInAnonymously) is represented here by
        // staffDb() — a user with a UID but no custom claims, matching the anonymous-auth
        // context that index.html establishes before subscribing.
        await assertSucceeds(setDoc(doc(staffDb(), 'pushSubscriptions', uid()), VALID_SUB()));
    });

    test('unauthenticated cannot create subscription', async () => {
        await assertFails(setDoc(doc(anonDb(), 'pushSubscriptions', uid()), VALID_SUB()));
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

    test('anon cannot create with an extra field in the keys map (hasOnly)', async () => {
        await assertFails(
            setDoc(doc(anonDb(), 'pushSubscriptions', uid()), {
                ...VALID_SUB(), keys: { p256dh: 'abc123', auth: 'xyz789', injected: 'x' },
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

    test('auth cannot read (client read disabled — Cloud Function uses Admin SDK)', async () => {
        await assertFails(getDocs(collection(staffDb(), 'pushSubscriptions')));
    });

    test('unauthenticated cannot delete', async () => {
        const id = uid();
        await setDoc(doc(staffDb(), 'pushSubscriptions', id), VALID_SUB());
        await assertFails(deleteDoc(doc(anonDb(), 'pushSubscriptions', id)));
    });

    test('auth can delete', async () => {
        const id = uid();
        await setDoc(doc(staffDb(), 'pushSubscriptions', id), VALID_SUB());
        await assertSucceeds(deleteDoc(doc(staffDb(), 'pushSubscriptions', id)));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// analytics (anonymous usage counters)
// ─────────────────────────────────────────────────────────────────────────────

describe('analytics', () => {
    const VALID_PV = () => ({ month: '2026-06', counts: { calendar: 1, paycalc: 1 } });
    const VALID_ACTIVE = () => ({ months: { '2026-06': 3 }, daily: { '2026-06-25': 2 } });
    const VALID_PERF = () => ({ month: '2026-06', samples: { '14_88|calendar|ttfb|lt500ms|browser|4g': 3 } });

    test('admin can read', async () => {
        await assertSucceeds(getDoc(doc(adminDb(), 'analytics', 'pv_2026-06')));
    });

    test('staff (non-admin) cannot read', async () => {
        await assertFails(getDoc(doc(staffDb(), 'analytics', 'pv_2026-06')));
    });

    test('anon cannot read', async () => {
        await assertFails(getDoc(doc(anonDb(), 'analytics', 'pv_2026-06')));
    });

    test('auth can write a page-view counter doc', async () => {
        await assertSucceeds(setDoc(doc(staffDb(), 'analytics', 'pv_2026-06'), VALID_PV()));
    });

    test('auth can write an active-accounts doc', async () => {
        await assertSucceeds(setDoc(doc(staffDb(), 'analytics', 'activeAccounts'), VALID_ACTIVE()));
    });

    test('auth can write an active-accounts doc with only one bucket present', async () => {
        await assertSucceeds(setDoc(doc(staffDb(), 'analytics', 'activeAccounts'), { months: { '2026-06': 1 } }));
    });

    test('auth can write a perf-latency doc (Project 0)', async () => {
        await assertSucceeds(setDoc(doc(staffDb(), 'analytics', 'perf_2026-06'), VALID_PERF()));
    });

    test('auth cannot write a perf doc with an extra field', async () => {
        await assertFails(setDoc(doc(staffDb(), 'analytics', 'perf_2026-06'), { ...VALID_PERF(), memberName: 'G. Miller' }));
    });

    test('auth cannot write a perf doc whose month != the doc id', async () => {
        await assertFails(setDoc(doc(staffDb(), 'analytics', 'perf_2026-06'), { month: '2026-07', samples: {} }));
    });

    test('auth cannot write a perf doc whose id is not perf_YYYY-MM', async () => {
        await assertFails(setDoc(doc(staffDb(), 'analytics', 'perf_2026-6'), { month: '2026-6', samples: {} }));
    });

    test('anon (no Firebase session) cannot write a perf doc', async () => {
        await assertFails(setDoc(doc(anonDb(), 'analytics', 'perf_2026-06'), VALID_PERF()));
    });

    test('anon (no Firebase session) cannot write', async () => {
        // Real calendar visitors have an anonymous Firebase session (request.auth != null);
        // a context with no auth at all must be rejected.
        await assertFails(setDoc(doc(anonDb(), 'analytics', 'pv_2026-06'), VALID_PV()));
    });

    test('auth cannot write a page-view doc with an extra field', async () => {
        await assertFails(setDoc(doc(staffDb(), 'analytics', 'pv_2026-06'), { ...VALID_PV(), memberName: 'G. Miller' }));
    });

    test('auth cannot write a page-view doc with non-string month', async () => {
        await assertFails(setDoc(doc(staffDb(), 'analytics', 'pv_2026-06'), { month: 6, counts: { calendar: 1 } }));
    });

    test('auth cannot write a doc with unrecognised shape', async () => {
        await assertFails(setDoc(doc(staffDb(), 'analytics', 'whatever'), { foo: 'bar' }));
    });

    test('auth cannot write a page-view doc whose id is not pv_YYYY-MM', async () => {
        await assertFails(setDoc(doc(staffDb(), 'analytics', 'pv_2026-6'), { month: '2026-6', counts: { calendar: 1 } }));
    });

    test('auth cannot write a page-view doc whose month != the doc id', async () => {
        await assertFails(setDoc(doc(staffDb(), 'analytics', 'pv_2026-06'), { month: '2026-07', counts: { calendar: 1 } }));
    });

    test('auth cannot write a page-view doc with an unknown counts key', async () => {
        await assertFails(setDoc(doc(staffDb(), 'analytics', 'pv_2026-06'), { month: '2026-06', counts: { hacker: 1 } }));
    });

    test('auth cannot write a page-view doc with a non-int count value', async () => {
        await assertFails(setDoc(doc(staffDb(), 'analytics', 'pv_2026-06'), { month: '2026-06', counts: { calendar: 'evil' } }));
    });

    test('auth cannot write an active-accounts shape under any other doc id', async () => {
        await assertFails(setDoc(doc(staffDb(), 'analytics', 'aa_2026'), VALID_ACTIVE()));
    });

    test('client cannot delete an analytics doc', async () => {
        const ref = doc(adminDb(), 'analytics', 'pv_2026-06');
        await setDoc(ref, VALID_PV());
        await assertFails(deleteDoc(doc(staffDb(), 'analytics', 'pv_2026-06')));
        await assertFails(deleteDoc(doc(adminDb(), 'analytics', 'pv_2026-06')));
    });

    // These exercise the EXACT FieldValue.increment() payloads the app writes
    // (recordPageView / recordActiveAccount), not plain numbers — so the rule is
    // validated against the real client contract, not an invented stand-in.
    test('real increment() page-view write (merge create) is allowed', async () => {
        await assertSucceeds(setDoc(
            doc(staffDb(), 'analytics', 'pv_2026-06'),
            { month: '2026-06', counts: { calendar: increment(1) } },
            { merge: true },
        ));
    });

    test('real increment() page-view write (merge update onto existing) is allowed', async () => {
        const ref = doc(staffDb(), 'analytics', 'pv_2026-06');
        await setDoc(ref, { month: '2026-06', counts: { calendar: increment(1) } }, { merge: true });
        await assertSucceeds(setDoc(ref, { month: '2026-06', counts: { paycalc: increment(1) } }, { merge: true }));
    });

    test('real increment() active-account write (both buckets) is allowed', async () => {
        await assertSucceeds(setDoc(
            doc(staffDb(), 'analytics', 'activeAccounts'),
            { months: { '2026-06': increment(1) }, daily: { '2026-06-25': increment(1) } },
            { merge: true },
        ));
    });

    test('real increment() active-account write (month bucket only) is allowed', async () => {
        await assertSucceeds(setDoc(
            doc(staffDb(), 'analytics', 'activeAccounts'),
            { months: { '2026-06': increment(1) } },
            { merge: true },
        ));
    });
});
