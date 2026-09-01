/**
 * Firestore security rules integration tests.
 *
 * Run:  npm run test:rules
 *       (firebase emulators:exec starts the Firestore emulator, runs these tests, stops it)
 *
 * Covers all 9 collections in firestore.rules:
 *   overrides, huddles, linkDesigns, staffContact, passwordStatus,
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
/** The shared staff Calendar viewer (v20.12) — the identity the four-digit PIN mints. Exactly one
 *  claim, no `name`: it is a CAPABILITY ("may read the Calendar"), not a person. Modelled with the
 *  real uid so a rule that ever keyed on the uid rather than the claim would be caught here too. */
function viewerDb() { return testEnv.authenticatedContext('calendar-viewer', { calendarViewer: true }).firestore(); }

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
    // ── READ (v20.12): a real member OR the shared staff-PIN viewer. Nobody else. ─────────────
    //
    // This collection was `allow read;` — no auth at all — until v20.12. These four tests are the
    // proof that the door is shut, and the anonymous one is the substance of it: the Calendar used
    // to sign every visitor in anonymously, so a rule written as `request.auth != null` would look
    // closed and admit exactly the people it was meant to exclude (the trap linkDesigns fell into
    // until v19.39).
    // ── THE HOLD (v20.16) ────────────────────────────────────────────────────────────────────
    //
    // `firestore.rules` currently carries a `allow read;` line ABOVE the tightened rule, holding
    // this collection public until the client that can satisfy the tightened rule has soaked in
    // production (RECOVERY_RUNBOOK.md → "The Calendar PIN"; the three deploy workflows fire in
    // parallel, so the ordering has to be made by hand).
    //
    // This constant states which of the two is deployed, and the three tests below assert the
    // matching outcome rather than being skipped. That is deliberate: `assertSucceeds` here fails
    // the moment the hold line is removed while this still says `true`, and `assertFails` fails if
    // it is set to `false` while the hold line is still there — so the two cannot silently
    // disagree in EITHER direction, which a skip or a deletion would allow.
    //
    // ENFORCED 26 Aug 2026, in the same commit that removed the `allow read;` line. These cases
    // now assert what the rule has always SAID: unauthenticated reads are denied. Until today they
    // asserted the opposite, on purpose — a test that passed BECAUSE the collection was public,
    // which is the only honest way to pin a hold line while it is deliberately in place.
    const OVERRIDES_READ_HELD_OPEN = false;
    const readWhileHeld = OVERRIDES_READ_HELD_OPEN ? assertSucceeds : assertFails;

    test('UNAUTHENTICATED cannot read the collection', async () => {
        await readWhileHeld(getDocs(collection(anonDb(), 'overrides')));
    });

    test('UNAUTHENTICATED cannot read a specific document', async () => {
        await readWhileHeld(getDoc(doc(anonDb(), 'overrides', uid())));
    });

    test('ANONYMOUS auth cannot read — a session with no claims grants nothing', async () => {
        await readWhileHeld(getDocs(collection(staffDb(), 'overrides')));
        await readWhileHeld(getDoc(doc(staffDb(), 'overrides', uid())));
    });

    test('a NAMED member can read', async () => {
        await assertSucceeds(getDocs(collection(namedDb('G. Miller'), 'overrides')));
    });

    test('the CALENDAR VIEWER can read', async () => {
        await assertSucceeds(getDocs(collection(viewerDb(), 'overrides')));
        await assertSucceeds(getDoc(doc(viewerDb(), 'overrides', uid())));
    });

    test('an ADMIN can read', async () => {
        await assertSucceeds(getDocs(collection(adminDb(), 'overrides')));
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
        for (const value of ['TRG', 'IND', 'ASSESS', 'TEAM', 'UNION', 'MEET', 'TRG RDW', 'ASSESS RDW', 'TEAM RDW',
                             'UNION RDW', 'MEET RDW', 'IND 08:00-16:00', 'MEET 09:00-10:00', 'TRG RDW 08:00-16:00']) {
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
describe('overrides — replacedType (v21.55)', () => {
    // The field exists because a write is delete-then-set: recording annual leave DESTROYS the
    // override that said what the day was, and on a swapped-in day that doc was the only evidence
    // the member was contracted to work it. These pin the SERVER side of the client rule in
    // override-utils.js — the client decides what to send, the rules decide what may land.
    const WITH = (replacedType) => ({ ...VALID_OVERRIDE(), replacedType });

    test('a valid replacedType is accepted', async () => {
        await assertSucceeds(setDoc(doc(adminDb(), 'overrides', uid()), WITH('shift')));
    });
    test('a legacy type is accepted — those docs are still in the data', async () => {
        await assertSucceeds(setDoc(doc(adminDb(), 'overrides', uid()), WITH('swap')));
    });
    test('the field stays OPTIONAL — most writes replace nothing', async () => {
        await assertSucceeds(setDoc(doc(adminDb(), 'overrides', uid()), VALID_OVERRIDE()));
    });
    test('an unknown value is REFUSED — it names an override that could never have existed', async () => {
        await assertFails(setDoc(doc(adminDb(), 'overrides', uid()), WITH('not_a_type')));
    });
    test('a non-string is REFUSED', async () => {
        await assertFails(setDoc(doc(adminDb(), 'overrides', uid()), WITH(7)));
    });
    test('null is REFUSED, which is why the builders omit the key instead', async () => {
        await assertFails(setDoc(doc(adminDb(), 'overrides', uid()), WITH(null)));
    });
    test('a member may still only stamp it on their OWN override', async () => {
        await assertFails(setDoc(doc(namedDb('S. Boyle'), 'overrides', uid()),
            { ...WITH('shift'), memberName: 'G. Miller' }));
    });
});

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

    // UPDATE must check the EXISTING doc's owner too, not just the new value (v16.80).
    // Without it, a member could overwrite another member's override doc by writing their
    // own name into it — the update twin of the delete-isolation check below.
    test('named staff CANNOT overwrite another member\'s override (update-path isolation)', async () => {
        const id = uid();
        await setDoc(doc(adminDb(), 'overrides', id), OWN('G. Miller'));
        // S. Boyle tries to seize G. Miller's doc by relabelling it to themselves.
        await assertFails(setDoc(doc(namedDb('S. Boyle'), 'overrides', id), OWN('S. Boyle')));
    });
    test('named staff CAN update their OWN existing override', async () => {
        const id = uid();
        await setDoc(doc(namedDb('S. Boyle'), 'overrides', id), OWN('S. Boyle'));
        await assertSucceeds(setDoc(doc(namedDb('S. Boyle'), 'overrides', id),
            { ...OWN('S. Boyle'), note: 'edited' }));
    });
    test('manager CAN update another member\'s existing override (on-behalf)', async () => {
        const id = uid();
        await setDoc(doc(namedDb('G. Miller'), 'overrides', id), OWN('G. Miller'));
        await assertSucceeds(setDoc(doc(managerDb('S. Stewart'), 'overrides', id),
            { ...OWN('G. Miller'), note: 'mgr edit' }));
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
    // READ tightened at v19.39. The old rule was `request.auth != null`, documented as "any
    // authenticated session" — but calendar-app.js signs EVERY visitor in anonymously, so that
    // included anyone who could open the app URL. These cases pin the new line: a signed-in member
    // is in, a claim-less (anonymous-equivalent) session is out, admin is in without a name claim,
    // and a designer whose token predates the linksDesigner claim can still LOAD — which is the
    // whole reason the read is not simply narrowed to isLinksWriter().
    test('a NAMED member can READ', async () => {
        await assertSucceeds(getDocs(collection(namedDb('J. Davies'), 'linkDesigns')));
    });
    test('a name-less authenticated session CANNOT READ (the calendar\'s anonymous session)', async () => {
        await assertFails(getDocs(collection(staffDb(), 'linkDesigns')));
    });
    test('a designer on a token with `name` but NOT yet linksDesigner can still READ (self-heal path)', async () => {
        await assertSucceeds(getDocs(collection(namedDb('S. Silva', 'uid_stale'), 'linkDesigns')));
    });
    test('an admin can READ', async () => {
        await assertSucceeds(getDocs(collection(adminDb(), 'linkDesigns')));
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

    // Shape validation (v17.02 — Finding #12): create/update are schema-checked.
    test('a designer CANNOT write an extra field (hasOnly)', async () => {
        await assertFails(setDoc(doc(designerDb(), 'linkDesigns', uid()), { ...DESIGN(), evil: true }));
    });
    test('a designer CANNOT write a missing name', async () => {
        const { name, ...noName } = DESIGN();
        await assertFails(setDoc(doc(designerDb(), 'linkDesigns', uid()), noName));
    });
    test('a designer CANNOT write a non-string name', async () => {
        await assertFails(setDoc(doc(designerDb(), 'linkDesigns', uid()), { ...DESIGN(), name: 42 }));
    });
    test('a designer CANNOT write an over-long name (>100)', async () => {
        await assertFails(setDoc(doc(designerDb(), 'linkDesigns', uid()), { ...DESIGN(), name: 'x'.repeat(101) }));
    });
    test('a designer CANNOT write a non-map patterns', async () => {
        await assertFails(setDoc(doc(designerDb(), 'linkDesigns', uid()), { ...DESIGN(), patterns: 'nope' }));
    });
    test('a designer CANNOT write a missing updatedAt timestamp', async () => {
        const { updatedAt, ...noTs } = DESIGN();
        await assertFails(setDoc(doc(designerDb(), 'linkDesigns', uid()), noTs));
    });
    // `revision` — the v22.15 concurrency identity, shipped rules-first (no client writes it yet).
    // Both directions matter and they are not symmetric: rejecting a legitimate revision would
    // permission-deny every Links save the moment the client half lands, while accepting a bad one
    // lets a value through that the co-editing guard then compares against. A design with NO
    // revision must keep working, because every design that exists today is one.
    test('a designer CAN write a revision', async () => {
        await assertSucceeds(setDoc(doc(designerDb(), 'linkDesigns', uid()), { ...DESIGN(), revision: 1 }));
    });
    test('a design with NO revision still writes — every existing design is one', async () => {
        await assertSucceeds(setDoc(doc(designerDb(), 'linkDesigns', uid()), DESIGN()));
    });
    test('a designer CANNOT write a revision of 0 — it would read as "no revision"', async () => {
        await assertFails(setDoc(doc(designerDb(), 'linkDesigns', uid()), { ...DESIGN(), revision: 0 }));
    });
    test('a designer CANNOT write a negative revision', async () => {
        await assertFails(setDoc(doc(designerDb(), 'linkDesigns', uid()), { ...DESIGN(), revision: -3 }));
    });
    test('a designer CANNOT write a non-integer revision', async () => {
        // A float would break monotonic comparison; a string would compare as text.
        await assertFails(setDoc(doc(designerDb(), 'linkDesigns', uid()), { ...DESIGN(), revision: 1.5 }));
        await assertFails(setDoc(doc(designerDb(), 'linkDesigns', uid()), { ...DESIGN(), revision: '2' }));
    });
    test('a revision survives alongside the soft-delete pair and the window', async () => {
        // The four optional fields must be able to coexist — hasOnly is a ceiling, and a design in
        // the bin that also carries a window and a revision is an ordinary state, not a corner.
        await assertSucceeds(setDoc(doc(designerDb(), 'linkDesigns', uid()), {
            ...DESIGN(), revision: 7, window: { monSat: {} },
            deletedAt: serverTimestamp(), deletedBy: 'S. Silva',
        }));
    });

    // A HARD DELETE IS ONLY LEGITIMATE AGAINST A DESIGN ALREADY IN THE BIN (v19.84, external
    // review P1). This test used to assert the opposite — that a designer could hard-delete a LIVE
    // design — which is exactly the hole that let a stale "Remove for good" destroy a design a
    // colleague had just restored. The client now purges through a transaction; this is the
    // defence in depth beneath it, so a future client with the same bug can only fail.
    test('a designer CANNOT hard-delete a LIVE design', async () => {
        const id = uid();
        await assertSucceeds(setDoc(doc(designerDb(), 'linkDesigns', id), DESIGN()));
        await assertFails(deleteDoc(doc(designerDb(), 'linkDesigns', id)));
    });
    test('a designer CAN hard-delete a design that is in the bin', async () => {
        const id = uid();
        await assertSucceeds(setDoc(doc(designerDb(), 'linkDesigns', id), DESIGN()));
        await assertSucceeds(setDoc(doc(designerDb(), 'linkDesigns', id),
            { ...DESIGN(), deletedAt: serverTimestamp(), deletedBy: 'G. Miller' }));
        await assertSucceeds(deleteDoc(doc(designerDb(), 'linkDesigns', id)));
    });
    // Soft delete (v19.41). `deletedAt`/`deletedBy` are OPTIONAL — the live documents that
    // predate the field must keep working, which is the case the hasOnly change could break.
    test('a designer CAN soft-delete (write deletedAt + deletedBy)', async () => {
        const id = uid();
        await assertSucceeds(setDoc(doc(designerDb(), 'linkDesigns', id), DESIGN()));
        await assertSucceeds(setDoc(doc(designerDb(), 'linkDesigns', id),
            { deletedAt: serverTimestamp(), deletedBy: 'S. Silva' }, { merge: true }));
    });
    test('a LIVE design still writes with neither field (they are optional, not required)', async () => {
        await assertSucceeds(setDoc(doc(designerDb(), 'linkDesigns', uid()), DESIGN()));
    });
    test('a designer CAN restore (a write carrying neither field is the restored shape)', async () => {
        const id = uid();
        await assertSucceeds(setDoc(doc(designerDb(), 'linkDesigns', id),
            { ...DESIGN(), deletedAt: serverTimestamp(), deletedBy: 'S. Silva' }));
        await assertSucceeds(setDoc(doc(designerDb(), 'linkDesigns', id), DESIGN()));
    });
    test('a designer CANNOT write a non-timestamp deletedAt', async () => {
        await assertFails(setDoc(doc(designerDb(), 'linkDesigns', uid()),
            { ...DESIGN(), deletedAt: 'yesterday' }));
    });
    test('a designer CANNOT write a non-string deletedBy', async () => {
        await assertFails(setDoc(doc(designerDb(), 'linkDesigns', uid()),
            { ...DESIGN(), deletedAt: serverTimestamp(), deletedBy: 42 }));
    });
    test('a designer CANNOT write an over-long deletedBy (>100)', async () => {
        await assertFails(setDoc(doc(designerDb(), 'linkDesigns', uid()),
            { ...DESIGN(), deletedAt: serverTimestamp(), deletedBy: 'x'.repeat(101) }));
    });
    test('the widened hasOnly still rejects an unknown field', async () => {
        // The soft-delete pair widened the allowlist; this pins that it widened by exactly two.
        await assertFails(setDoc(doc(designerDb(), 'linkDesigns', uid()),
            { ...DESIGN(), deletedAt: serverTimestamp(), archived: true }));
    });
    test('a NON-designer cannot soft-delete either (same gate as a hard delete)', async () => {
        const id = uid();
        await assertSucceeds(setDoc(doc(designerDb(), 'linkDesigns', id), DESIGN()));
        await assertFails(setDoc(doc(namedDb('J. Davies'), 'linkDesigns', id),
            { deletedAt: serverTimestamp(), deletedBy: 'J. Davies' }, { merge: true }));
    });

    test('a designer CAN rename via merge:true (merge keeps patterns, so hasOnly still holds)', async () => {
        // renameDesign writes only {name, updatedAt, updatedBy} with merge:true — request.resource.data
        // is the full post-merge doc (existing patterns preserved), so the 4-field hasOnly passes.
        const id = uid();
        await assertSucceeds(setDoc(doc(designerDb(), 'linkDesigns', id), DESIGN()));
        await assertSucceeds(setDoc(doc(designerDb(), 'linkDesigns', id),
            { name: 'Renamed', updatedAt: serverTimestamp(), updatedBy: 'S. Silva' }, { merge: true }));
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

    test('cannot create with whitespace in the local part (mirrors client no-whitespace rule)', async () => {
        for (const bad of [
            'john smith@chilternrailways.co.uk',
            ' john@chilternrailways.co.uk',
            'john\t@chilternrailways.co.uk',
            'john\n@chilternrailways.co.uk',
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

// ── resetRequests — the reset-request queue (PASSWORD_PLAN.md, the request work) ─────────────────
// This collection is written ONLY by the requestPasswordReset Cloud Function via the Admin SDK, which
// bypasses rules — so the interesting assertions are that EVERY client write fails, including the
// admin's. The reason is worth restating here because it looks over-tight: the member who needs this
// has forgotten their password, so they have no Firebase identity at all and cannot be the writer.
// Rather than open the collection to unauthenticated writes, the endpoint owns writing entirely.
describe('resetRequests (the reset-request queue)', () => {
    const NAME = 'G. Miller';

    test('anon and ordinary members cannot read the queue', async () => {
        await assertFails(getDoc(doc(anonDb(), 'resetRequests', NAME)));
        await assertFails(getDoc(doc(namedDb(NAME), 'resetRequests', NAME)));
    });

    test('admin can read', async () => {
        await assertSucceeds(getDoc(doc(adminDb(), 'resetRequests', NAME)));
    });

    test('NO client may create — not anon, not the member, not even the admin', async () => {
        const payload = { memberName: NAME, requestedAt: new Date(), count: 1, provisioned: true };
        await assertFails(setDoc(doc(anonDb(), 'resetRequests', NAME), payload));
        await assertFails(setDoc(doc(namedDb(NAME), 'resetRequests', NAME), payload));
        await assertFails(setDoc(doc(adminDb(), 'resetRequests', NAME), payload));
    });

    test('NO client may update an existing row', async () => {
        await testEnv.withSecurityRulesDisabled(async ctx => {
            await setDoc(doc(ctx.firestore(), 'resetRequests', NAME), { memberName: NAME, count: 1 });
        });
        await assertFails(updateDoc(doc(anonDb(), 'resetRequests', NAME), { count: 99 }));
        await assertFails(updateDoc(doc(namedDb(NAME), 'resetRequests', NAME), { count: 99 }));
        await assertFails(updateDoc(doc(adminDb(), 'resetRequests', NAME), { count: 99 }));
    });

    test('the admin CAN delete — clearing a row they have actioned is the one client write', async () => {
        await testEnv.withSecurityRulesDisabled(async ctx => {
            await setDoc(doc(ctx.firestore(), 'resetRequests', NAME), { memberName: NAME, count: 1 });
        });
        await assertFails(deleteDoc(doc(namedDb(NAME), 'resetRequests', NAME)));
        await assertSucceeds(deleteDoc(doc(adminDb(), 'resetRequests', NAME)));
    });
});

describe('passwordStatus (PASSWORD_PLAN §6)', () => {
    const NAME = 'G. Miller';
    test('anon cannot read', async () => {
        await assertFails(getDoc(doc(anonDb(), 'passwordStatus', NAME)));
    });
    test('the owner (name claim) reads their own record; admin reads any', async () => {
        await assertSucceeds(getDoc(doc(namedDb(NAME), 'passwordStatus', NAME)));
        await assertSucceeds(getDoc(doc(adminDb(), 'passwordStatus', NAME)));
    });
    test("a DIFFERENT named member cannot read someone else's record", async () => {
        await assertFails(getDoc(doc(namedDb('S. Silva'), 'passwordStatus', NAME)));
    });
    test('the owner CREATEs with only passwordSetAt == server time', async () => {
        await assertSucceeds(setDoc(doc(namedDb(NAME), 'passwordStatus', NAME), { passwordSetAt: serverTimestamp() }));
    });
    test('the owner CANNOT create with resetAt (a client can never set the reset flag)', async () => {
        await assertFails(setDoc(doc(namedDb(NAME), 'passwordStatus', NAME), { passwordSetAt: serverTimestamp(), resetAt: serverTimestamp() }));
    });
    test('a fixed (non-server) passwordSetAt is rejected — must be pinned to request.time', async () => {
        await assertFails(setDoc(doc(namedDb(NAME), 'passwordStatus', NAME), { passwordSetAt: new Date('2020-01-01') }));
    });
    test("a non-owner cannot write another member's record", async () => {
        await assertFails(setDoc(doc(namedDb('S. Silva'), 'passwordStatus', NAME), { passwordSetAt: serverTimestamp() }));
    });
    test('the owner may UPDATE passwordSetAt without touching a server-written resetAt', async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'passwordStatus', NAME), { resetAt: new Date('2026-01-01') });
        });
        await assertSucceeds(setDoc(doc(namedDb(NAME), 'passwordStatus', NAME), { passwordSetAt: serverTimestamp() }, { merge: true }));
    });
    test('the owner CANNOT change the server-written resetAt (immutable to clients)', async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'passwordStatus', NAME), { resetAt: new Date('2026-01-01') });
        });
        await assertFails(setDoc(doc(namedDb(NAME), 'passwordStatus', NAME), { passwordSetAt: serverTimestamp(), resetAt: serverTimestamp() }, { merge: true }));
    });
    test('admin cannot write ANOTHER member\'s record from the client (resets go via the function)', async () => {
        await assertFails(setDoc(doc(adminDb(), 'passwordStatus', NAME), { passwordSetAt: serverTimestamp() }));
    });
    test('the REAL admin token shape {admin,name} still cannot write another member\'s record', async () => {
        // Production admins carry BOTH claims ({ admin: true, name: 'G. Miller' }) — setupRosterAuth's
        // admin tier. The create/update rule keys off `token.name == memberName`, so an admin can only
        // self-write; another member's doc still fails even WITH the admin claim (the `adminDb()` case
        // above passes partly because it has no name claim — this proves the constraint on the real token).
        const adminNamed = testEnv.authenticatedContext('uid_admin', { admin: true, name: 'G. Miller' }).firestore();
        await assertFails(setDoc(doc(adminNamed, 'passwordStatus', 'S. Silva'), { passwordSetAt: serverTimestamp() }));
        // …and CAN still stamp their OWN record (an admin is also a member setting their own password).
        // merge:true so it's an update touching ONLY passwordSetAt — this suite has no clearFirestore,
        // so G. Miller's doc already carries a resetAt from earlier tests; a non-merge replace would
        // (correctly) fail the affectedKeys().hasOnly(['passwordSetAt']) rule. Mirrors savePasswordSetAt.
        await assertSucceeds(setDoc(doc(adminNamed, 'passwordStatus', 'G. Miller'), { passwordSetAt: serverTimestamp() }, { merge: true }));
    });
    test('no client delete', async () => {
        await assertFails(deleteDoc(doc(namedDb(NAME), 'passwordStatus', NAME)));
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

describe('linkTargetSets — saved generator target sets, per-creator write (v21.04)', () => {
    // The one promise: anyone may save a NEW set; only the creator (or admin) may overwrite or
    // delete one. Every case here has a client-side twin in links-target-sets.test.mjs — that copy
    // drives the Save button, THIS is the protection, and the two must answer alike.
    const SET = (createdBy = 'G. Miller', updatedBy = createdBy) => ({
        name: 'Set A',
        slots: [{ time: '06:20-14:20', weekday: 1, sat: 1, sun: 0 }],
        spareLines: 4,
        createdBy, updatedBy,
        updatedAt: serverTimestamp(),
    });
    /** A set already on the server, owned by G. Miller, written past the rules. */
    async function seedSet(id, createdBy = 'G. Miller') {
        await testEnv.withSecurityRulesDisabled(async ctx => {
            await setDoc(doc(ctx.firestore(), 'linkTargetSets', id),
                { ...SET(createdBy), updatedAt: new Date() });
        });
    }
    const designerAs = (name, uidSuffix) =>
        testEnv.authenticatedContext('uid_' + uidSuffix, { name, linksDesigner: true }).firestore();

    test('read matches linkDesigns: named yes, admin yes, anonymous and claim-less no', async () => {
        await assertSucceeds(getDocs(collection(namedDb('S. Silva'), 'linkTargetSets')));
        await assertSucceeds(getDocs(collection(adminDb(), 'linkTargetSets')));
        await assertFails(getDocs(collection(anonDb(), 'linkTargetSets')));
        await assertFails(getDocs(collection(staffDb(), 'linkTargetSets')));
    });

    test('a designer can CREATE a set owned as THEMSELVES', async () => {
        await assertSucceeds(setDoc(doc(designerAs('S. Silva', 'silva'), 'linkTargetSets', uid()),
            SET('S. Silva')));
    });

    test('a designer CANNOT create a set owned as somebody else — ownership is not forgeable', async () => {
        await assertFails(setDoc(doc(designerAs('S. Silva', 'silva'), 'linkTargetSets', uid()),
            SET('G. Miller', 'S. Silva')));
    });

    test('THE PROMISE: a colleague cannot overwrite the creator\'s set', async () => {
        const id = uid();
        await seedSet(id, 'G. Miller');
        await assertFails(setDoc(doc(designerAs('S. Silva', 'silva'), 'linkTargetSets', id),
            { ...SET('G. Miller', 'S. Silva') }));
    });

    test('…and cannot delete it either — losing the set is the whole thing being prevented', async () => {
        const id = uid();
        await seedSet(id, 'G. Miller');
        await assertFails(deleteDoc(doc(designerAs('S. Silva', 'silva'), 'linkTargetSets', id)));
    });

    test('the creator CAN overwrite and delete their own set', async () => {
        const id = uid();
        await seedSet(id, 'G. Miller');
        const mine = designerAs('G. Miller', 'miller');
        await assertSucceeds(setDoc(doc(mine, 'linkTargetSets', id), SET('G. Miller')));
        await assertSucceeds(deleteDoc(doc(mine, 'linkTargetSets', id)));
    });

    test('the ADMIN can overwrite and delete anyone\'s set (break-glass, as the design bin has)', async () => {
        const id = uid();
        await seedSet(id, 'S. Silva');
        const adminNamed = testEnv.authenticatedContext('uid_admin', { admin: true, name: 'G. Miller' }).firestore();
        await assertSucceeds(setDoc(doc(adminNamed, 'linkTargetSets', id), SET('S. Silva', 'G. Miller')));
        await assertSucceeds(deleteDoc(doc(adminNamed, 'linkTargetSets', id)));
    });

    test('an overwrite may not MOVE createdBy — ownership is not transferable by editing', async () => {
        const id = uid();
        await seedSet(id, 'G. Miller');
        // Even the creator cannot hand the set to somebody else (nor, more to the point, can a
        // future client bug silently re-own every set it touches).
        await assertFails(setDoc(doc(designerAs('G. Miller', 'miller'), 'linkTargetSets', id),
            SET('S. Silva', 'G. Miller')));
    });

    test('a plain named member (no designer claim) cannot create', async () => {
        await assertFails(setDoc(doc(namedDb('J. Davies'), 'linkTargetSets', uid()), SET('J. Davies')));
    });

    test('shape is validated: extra keys, bad types and empty tables are refused', async () => {
        const db = designerAs('S. Silva', 'silva');
        await assertFails(setDoc(doc(db, 'linkTargetSets', uid()), { ...SET('S. Silva'), extra: 1 }));
        await assertFails(setDoc(doc(db, 'linkTargetSets', uid()), { ...SET('S. Silva'), slots: [] }));
        await assertFails(setDoc(doc(db, 'linkTargetSets', uid()), { ...SET('S. Silva'), slots: 'x' }));
        await assertFails(setDoc(doc(db, 'linkTargetSets', uid()), { ...SET('S. Silva'), spareLines: 2.5 }));
        await assertFails(setDoc(doc(db, 'linkTargetSets', uid()), { ...SET('S. Silva'), name: '' }));
        await assertFails(setDoc(doc(db, 'linkTargetSets', uid()), { ...SET('S. Silva'), updatedAt: 'now' }));
    });
});

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

    // ── Per-owner ownership (A5, F-SEC-5) ───────────────────────────────────────────
    test('can create with owner === own uid', async () => {
        await assertSucceeds(
            setDoc(doc(staffDb('uid_owner'), 'pushSubscriptions', uid()), { ...VALID_SUB(), owner: 'uid_owner' })
        );
    });

    test('cannot create claiming a FOREIGN owner uid', async () => {
        await assertFails(
            setDoc(doc(staffDb('uid_owner'), 'pushSubscriptions', uid()), { ...VALID_SUB(), owner: 'someone_else' })
        );
    });

    test('owner can delete their OWN (owner-stamped) subscription', async () => {
        const id = uid();
        await setDoc(doc(staffDb('uid_owner'), 'pushSubscriptions', id), { ...VALID_SUB(), owner: 'uid_owner' });
        await assertSucceeds(deleteDoc(doc(staffDb('uid_owner'), 'pushSubscriptions', id)));
    });

    test('a DIFFERENT authed identity cannot delete an owner-stamped subscription', async () => {
        const id = uid();
        await setDoc(doc(staffDb('uid_owner'), 'pushSubscriptions', id), { ...VALID_SUB(), owner: 'uid_owner' });
        await assertFails(deleteDoc(doc(staffDb('uid_intruder'), 'pushSubscriptions', id)));
    });

    test('legacy (no-owner) subscription stays deletable by any authed user (backward-compat escape)', async () => {
        const id = uid();
        await setDoc(doc(staffDb('uid_owner'), 'pushSubscriptions', id), VALID_SUB()); // no owner field
        await assertSucceeds(deleteDoc(doc(staffDb('uid_other'), 'pushSubscriptions', id)));
    });

    test('owner can UPDATE their own owner-stamped subscription', async () => {
        const id = uid();
        await setDoc(doc(staffDb('uid_owner'), 'pushSubscriptions', id), { ...VALID_SUB(), owner: 'uid_owner' });
        await assertSucceeds(
            setDoc(doc(staffDb('uid_owner'), 'pushSubscriptions', id), { ...VALID_SUB(), owner: 'uid_owner' })
        );
    });

    test('a DIFFERENT identity cannot OVERWRITE an owner-stamped subscription by re-labelling it (update owner re-check)', async () => {
        // Mirrors the per-owner DELETE rule: update must re-check the EXISTING doc's owner, not just
        // the incoming value — otherwise a session that knew the doc id could hijack another user's
        // subscription by stamping its own uid as owner.
        const id = uid();
        await setDoc(doc(staffDb('uid_owner'), 'pushSubscriptions', id), { ...VALID_SUB(), owner: 'uid_owner' });
        await assertFails(
            setDoc(doc(staffDb('uid_intruder'), 'pushSubscriptions', id), { ...VALID_SUB(), owner: 'uid_intruder' })
        );
    });

    test('a legacy (no-owner) subscription can still be UPDATED by any authed user (re-subscribe hardening path)', async () => {
        const id = uid();
        await setDoc(doc(staffDb('uid_owner'), 'pushSubscriptions', id), VALID_SUB()); // no owner field
        await assertSucceeds(
            setDoc(doc(staffDb('uid_other'), 'pushSubscriptions', id), { ...VALID_SUB(), owner: 'uid_other' })
        );
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

    test('auth can write the seven document/guide OPEN counters (v18.20; all four guides v19.95)', async () => {
        // Huddle/Circular/Newsletter opens + all four guide opens share the pv_ counts map.
        await assertSucceeds(setDoc(doc(staffDb(), 'analytics', 'pv_2026-07'), {
            month: '2026-07',
            counts: { huddle: 1, circular: 2, newsletter: 3,
                      'guide-staff': 4, 'guide-paycalc': 5, 'guide-railcard': 6, 'guide-fip': 7 },
        }));
    });

    test('an UNKNOWN counts key is still rejected (open-id allowlist has teeth)', async () => {
        // This used 'guide-staff' until v19.95, when that became a real id — a teeth test whose
        // example is promoted to legal quietly stops having teeth, and would have gone green here
        // for the wrong reason. The key below is deliberately not on any roadmap.
        await assertFails(setDoc(doc(staffDb(), 'analytics', 'pv_2026-08'), {
            month: '2026-08', counts: { 'guide-nonexistent': 1 },
        }));
    });

    test('an open counter must be an int', async () => {
        await assertFails(setDoc(doc(staffDb(), 'analytics', 'pv_2026-09'), {
            month: '2026-09', counts: { huddle: 'lots' },
        }));
    });

    test('auth can write an active-accounts doc', async () => {
        await assertSucceeds(setDoc(doc(staffDb(), 'analytics', 'activeAccounts'), VALID_ACTIVE()));
    });

    test('auth can write an active-accounts doc with only one bucket present', async () => {
        // Seed a months-only state via admin first (this suite has no clearFirestore, so a prior test
        // may have left a `daily` bucket — and since B4 the anti-wipe guard blocks a non-admin write
        // that DROPS `daily`; admin may). The point of this test is the shape (one optional bucket is
        // valid), so seed clean, then the non-admin months-only write preserves keys → allowed.
        await assertSucceeds(setDoc(doc(adminDb(), 'analytics', 'activeAccounts'), { months: { '2026-06': 1 } }));
        await assertSucceeds(setDoc(doc(staffDb(), 'analytics', 'activeAccounts'), { months: { '2026-06': 1 } }));
    });

    test('auth can write a perf-latency doc (Project 0)', async () => {
        await assertSucceeds(setDoc(doc(staffDb(), 'analytics', 'perf_2026-06'), VALID_PERF()));
    });

    // ── B4: anti-wipe guard — a non-admin overwrite may not REMOVE existing keys (destructive wipe),
    //    but incrementing (adding/preserving keys) stays open, and admin may prune. (unique doc ids
    //    below because this suite has no clearFirestore between tests.)
    test('B4: a non-admin increment that preserves keys is allowed (update)', async () => {
        await assertSucceeds(setDoc(doc(staffDb(), 'analytics', 'pv_2026-01'), { month: '2026-01', counts: { calendar: 1 } }));
        await assertSucceeds(setDoc(doc(staffDb(), 'analytics', 'pv_2026-01'), { month: '2026-01', counts: { calendar: 2, admin: 1 } }));
    });
    test('B4: a non-admin CANNOT wipe pv counts (removes existing keys)', async () => {
        await assertSucceeds(setDoc(doc(staffDb(), 'analytics', 'pv_2026-02'), { month: '2026-02', counts: { calendar: 5, admin: 2 } }));
        await assertFails(setDoc(doc(staffDb(), 'analytics', 'pv_2026-02'), { month: '2026-02', counts: {} }));
    });
    test('B4: a non-admin CANNOT wipe perf samples (removes existing keys)', async () => {
        await assertSucceeds(setDoc(doc(staffDb(), 'analytics', 'perf_2026-02'), { month: '2026-02', samples: { 'k1': 1 } }));
        await assertFails(setDoc(doc(staffDb(), 'analytics', 'perf_2026-02'), { month: '2026-02', samples: {} }));
    });
    test('B4: a non-admin CANNOT wipe activeAccounts, but admin CAN prune a daily key', async () => {
        // Seed a known state via admin (admin may set/remove any valid shape).
        await assertSucceeds(setDoc(doc(adminDb(), 'analytics', 'activeAccounts'), { months: { '2026-06': 3 }, daily: { '2026-06-25': 2, '2026-05-01': 1 } }));
        // A non-admin overwrite dropping keys is a WIPE → blocked.
        await assertFails(setDoc(doc(staffDb(), 'analytics', 'activeAccounts'), { months: {}, daily: {} }));
        // The admin prune removes the stale daily bucket → allowed.
        await assertSucceeds(setDoc(doc(adminDb(), 'analytics', 'activeAccounts'), { months: { '2026-06': 3 }, daily: { '2026-06-25': 2 } }));
    });

    // ── Per-address migration counters (v19.23, analytics/origins) ─────────────────────────────
    test('auth can write the origins doc', async () => {
        await assertSucceeds(setDoc(doc(staffDb(), 'analytics', 'origins'),
            { daily: { '2026-06-25|web': 3, '2026-06-25|web|pwa': 2 } }));
    });

    test('auth cannot add a field beyond daily to the origins doc', async () => {
        await assertFails(setDoc(doc(staffDb(), 'analytics', 'origins'),
            { daily: { '2026-06-25|web': 1 }, memberName: 'G. Miller' }));
        await assertFails(setDoc(doc(staffDb(), 'analytics', 'origins'),
            { daily: { '2026-06-25|web': 1 }, months: { '2026-06': 1 } }));
    });

    test('auth cannot write a non-map daily on the origins doc', async () => {
        await assertFails(setDoc(doc(staffDb(), 'analytics', 'origins'), { daily: 'all of them' }));
    });

    test('the origins doc is admin-read only', async () => {
        await assertSucceeds(setDoc(doc(adminDb(), 'analytics', 'origins'), { daily: { '2026-06-25|web': 1 } }));
        await assertFails(getDoc(doc(staffDb(), 'analytics', 'origins')));
        await assertSucceeds(getDoc(doc(adminDb(), 'analytics', 'origins')));
    });

    test('B4: a non-admin CANNOT wipe origins, but admin CAN prune a stale key', async () => {
        // Same anti-wipe posture as the other analytics docs — the counters are the only record of
        // the migration, and a wipe would be indistinguishable from "nobody has moved".
        await assertSucceeds(setDoc(doc(adminDb(), 'analytics', 'origins'),
            { daily: { '2026-06-25|web': 4, '2026-05-01|pages': 1 } }));
        await assertFails(setDoc(doc(staffDb(), 'analytics', 'origins'), { daily: {} }));
        await assertFails(setDoc(doc(staffDb(), 'analytics', 'origins'), { daily: { '2026-06-25|web': 4 } }));
        await assertSucceeds(setDoc(doc(adminDb(), 'analytics', 'origins'), { daily: { '2026-06-25|web': 4 } }));
    });

    test('an unknown analytics doc id is still refused', async () => {
        // The clause is pinned to the exact id — `origins` must not have opened a general escape.
        await assertFails(setDoc(doc(staffDb(), 'analytics', 'origin'), { daily: {} }));
        await assertFails(setDoc(doc(staffDb(), 'analytics', 'origins_2026-06'), { daily: {} }));
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

// ─────────────────────────────────────────────────────────────────────────────
// Calendar viewer — privilege isolation (v20.12)
// ─────────────────────────────────────────────────────────────────────────────
//
// A new authenticated identity widens every `request.auth != null` in the rules file at once, so
// this block walks the whole surface rather than only the collection the feature is about. The
// question at each one is the same: does the viewer get something that was meant for members?
//
// The viewer is a CAPABILITY — one claim, no `name` — and everything below is an assertion about
// what a capability is not. If any of these ever flips to `assertSucceeds`, a shared code known to
// the whole station has become a member credential.
describe('calendar viewer — read-only, and only the Calendar', () => {

    test('it CANNOT create an override', async () => {
        await assertFails(setDoc(doc(viewerDb(), 'overrides', uid()), VALID_OVERRIDE()));
    });

    test('it CANNOT update an existing override', async () => {
        const id = uid();
        await testEnv.withSecurityRulesDisabled(async ctx => {
            await setDoc(doc(ctx.firestore(), 'overrides', id), VALID_OVERRIDE());
        });
        await assertFails(setDoc(doc(viewerDb(), 'overrides', id), { ...VALID_OVERRIDE(), value: 'SICK', type: 'sick' }));
    });

    test('it CANNOT delete an override', async () => {
        const id = uid();
        await testEnv.withSecurityRulesDisabled(async ctx => {
            await setDoc(doc(ctx.firestore(), 'overrides', id), VALID_OVERRIDE());
        });
        await assertFails(deleteDoc(doc(viewerDb(), 'overrides', id)));
    });

    test('it CANNOT write on behalf of a named member', async () => {
        // The on-behalf path is the manager/admin bypass. A viewer reaching it would mean anyone
        // with the staff code could book somebody else's leave.
        await assertFails(setDoc(doc(viewerDb(), 'overrides', uid()),
            { ...VALID_OVERRIDE(), memberName: 'S. Silva' }));
    });

    test('it CANNOT read a work email — its own, or anybody\'s', async () => {
        const name = 'G. Miller';
        await testEnv.withSecurityRulesDisabled(async ctx => {
            await setDoc(doc(ctx.firestore(), 'staffContact', name), VALID_CONTACT(name));
        });
        await assertFails(getDoc(doc(viewerDb(), 'staffContact', name)));
        await assertFails(getDocs(collection(viewerDb(), 'staffContact')));
    });

    test('it CANNOT write a work email', async () => {
        await assertFails(setDoc(doc(viewerDb(), 'staffContact', 'G. Miller'), VALID_CONTACT('G. Miller')));
    });

    test('it CANNOT read or write password status', async () => {
        await assertFails(getDoc(doc(viewerDb(), 'passwordStatus', 'G. Miller')));
        await assertFails(setDoc(doc(viewerDb(), 'passwordStatus', 'G. Miller'),
            { memberName: 'G. Miller', passwordSetAt: serverTimestamp() }));
    });

    test('it CANNOT read link designs — the v19.39 `name`-claim rule holds against it', async () => {
        // linkDesigns read was tightened from `request.auth != null` to a `name` claim precisely
        // because the anonymous calendar session satisfied the old rule. The viewer is the new
        // identity in that shape, so this is the same test re-run against it.
        await assertFails(getDocs(collection(viewerDb(), 'linkDesigns')));
    });

    test('it CANNOT write a link design', async () => {
        await assertFails(setDoc(doc(viewerDb(), 'linkDesigns', uid()),
            { name: 'Proposal', patterns: {}, updatedAt: serverTimestamp(), updatedBy: 'x' }));
    });

    test('it CANNOT read reset requests', async () => {
        await assertFails(getDocs(collection(viewerDb(), 'resetRequests')));
    });

    test('it CANNOT read the error log, only add to it', async () => {
        // Deliberate asymmetry: an office PC that hits a bug should still be able to report it, and
        // the log is admin-read. So write succeeds and read fails, and both halves are the design.
        await assertSucceeds(setDoc(doc(viewerDb(), 'clientErrors', uid()), VALID_ERROR()));
        await assertFails(getDocs(collection(viewerDb(), 'clientErrors')));
    });

    test('it CANNOT read usage analytics, only increment them', async () => {
        // Same asymmetry, same reason: usage from a shared PC is real usage, the counters carry no
        // identity, and reading them is an admin surface.
        await assertSucceeds(setDoc(doc(viewerDb(), 'analytics', 'pv_2026-08'),
            { month: '2026-08', counts: { calendar: increment(1) } }, { merge: true }));
        await assertFails(getDoc(doc(viewerDb(), 'analytics', 'pv_2026-08')));
    });

    test('it CANNOT write a push subscription — every office PC shares this uid', async () => {
        // The one rule TIGHTENED for this feature rather than merely audited. A subscription written
        // here would be `owner`ed by an identity fifty people share: any of them could delete any
        // other's, and it would sit on a shared machine pushing one person's Huddle for ever.
        await assertFails(setDoc(doc(viewerDb(), 'pushSubscriptions', uid()), VALID_SUB()));
        await assertFails(setDoc(doc(viewerDb(), 'pushSubscriptions', uid()),
            { ...VALID_SUB(), owner: 'calendar-viewer' }));
    });

    test('it CANNOT delete a push subscription', async () => {
        const id = uid();
        await testEnv.withSecurityRulesDisabled(async ctx => {
            await setDoc(doc(ctx.firestore(), 'pushSubscriptions', id), VALID_SUB());
        });
        await assertFails(deleteDoc(doc(viewerDb(), 'pushSubscriptions', id)));
    });

    test('an ordinary authenticated session can still write a push subscription', async () => {
        // The tightening is `calendarViewer != true`, NOT a `name` requirement — so a stale cached
        // client still running the old anonymous bootstrap keeps renewing through the mixed-version
        // window. If this ever fails, that window has been closed by accident.
        await assertSucceeds(setDoc(doc(staffDb(), 'pushSubscriptions', uid()), VALID_SUB()));
    });

    test('it CANNOT upload or alter a Huddle, Circular or Newsletter', async () => {
        await assertFails(setDoc(doc(viewerDb(), 'huddles', '2026-08-12'), VALID_HUDDLE()));
        await assertFails(setDoc(doc(viewerDb(), 'circulars', '2026-08-12'), VALID_CIRCULAR('2026-08-12')));
        await assertFails(setDoc(doc(viewerDb(), 'newsletters', '2026-08-12'), VALID_CIRCULAR('2026-08-12')));
    });

    test('it CANNOT read or write the PIN throttle store', async () => {
        // A client that can READ this learns how close a source is to being blocked, which is how an
        // automated traversal paces itself under the limit; one that can WRITE it clears its own
        // failure count between guesses, which removes the limit altogether.
        await assertFails(getDoc(doc(viewerDb(), 'viewerAttempts', 'abc')));
        await assertFails(setDoc(doc(viewerDb(), 'viewerAttempts', 'abc'), { failures: 0 }));
        await assertFails(getDoc(doc(adminDb(), 'viewerAttempts', 'abc')));
        await assertFails(setDoc(doc(namedDb('G. Miller'), 'viewerAttempts', 'abc'), { failures: 0 }));
    });

    test('a member is unaffected — the isolation rules still work exactly as before', async () => {
        // Guard the guard. Every assertion above is a `assertFails`, and a rules file that denied
        // everything to everybody would satisfy all of them.
        await assertSucceeds(setDoc(doc(namedDb('G. Miller'), 'overrides', uid()), VALID_OVERRIDE()));
        await assertSucceeds(getDocs(collection(namedDb('G. Miller'), 'overrides')));
        await assertSucceeds(setDoc(doc(managerDb('S. Silva'), 'overrides', uid()), VALID_OVERRIDE()));
    });
});

// ── overtimeWindows — Overtime Availability ───────────────────────────────────
//
// The smallest ruleset in the file, so the smallest suite: reviewers read, nobody writes. Its
// value is entirely in the NEGATIVES — every path a client might reach for, tried by name — plus
// one positive, because a rules file that denied everything to everybody would satisfy the rest.
//
// The nested paths are tested individually rather than trusted to the recursive wildcard. A
// wildcard is exactly the kind of rule that looks like it covers a subtree and does not, and
// `revisions` is two levels down: a member's whole history of declarations sits there.
describe('overtimeWindows', () => {
    const WEEK = '2026-09-05';
    const PATHS = [
        ['the window itself',   ['overtimeWindows', WEEK]],
        ['a participant',       ['overtimeWindows', WEEK, 'participants', 'G. Miller']],
        ['a submission head',   ['overtimeWindows', WEEK, 'submissions', 'G. Miller']],
        ['an immutable revision', ['overtimeWindows', WEEK, 'submissions', 'G. Miller', 'revisions', '000001']],
    ];

    /** Seed the tree behind the rules, the way the Admin SDK does in production. */
    async function seed() {
        await testEnv.withSecurityRulesDisabled(async ctx => {
            const db = ctx.firestore();
            await setDoc(doc(db, 'overtimeWindows', WEEK), {
                weekEnding: WEEK, weekStart: '2026-08-30', audience: 'restricted', policyVersion: 1,
            });
            await setDoc(doc(db, 'overtimeWindows', WEEK, 'participants', 'G. Miller'),
                { memberName: 'G. Miller', grade: 'CEA', rosterOrder: 2 });
            await setDoc(doc(db, 'overtimeWindows', WEEK, 'submissions', 'G. Miller'),
                { memberName: 'G. Miller', currentRevision: 1, days: {} });
            await setDoc(doc(db, 'overtimeWindows', WEEK, 'submissions', 'G. Miller', 'revisions', '000001'),
                { revision: 1, days: {} });
        });
    }

    test('an admin can read every level of the tree', async () => {
        await seed();
        for (const [what, path] of PATHS) {
            await assertSucceeds(getDoc(doc(adminDb(), ...path)), what);
        }
    });

    test('a manager can read every level of the tree', async () => {
        // Managers are the operational readers — the Manager workspace listens to participants and
        // submission heads directly. If this ever fails the whole feature is blind to its reviewer.
        await seed();
        for (const [what, path] of PATHS) {
            await assertSucceeds(getDoc(doc(managerDb('H. Croft'), ...path)), what);
        }
    });

    test('an ordinary named member reads NOTHING, not even their own submission', async () => {
        // Deliberate: members read through getMyOvertimeState, never Firestore. A participant-based
        // read rule that no production client exercises would rot, so it is not written.
        await seed();
        for (const [, path] of PATHS) {
            await assertFails(getDoc(doc(namedDb('G. Miller'), ...path)));
        }
        await assertFails(getDocs(collection(namedDb('G. Miller'), 'overtimeWindows')));
    });

    test('a member cannot read a COLLEAGUE\'s submission either', async () => {
        await seed();
        await assertFails(getDoc(doc(namedDb('S. Silva', 'uid_silva'), 'overtimeWindows', WEEK, 'submissions', 'G. Miller')));
    });

    test('the Calendar viewer and an anonymous session read nothing', async () => {
        // The viewer holds `calendarViewer` and no name/admin/manager, so it fails the same way an
        // anonymous session does — but assert it by name, because "it obviously has no access" is
        // what the v20.12 audit found to be wrong about several collections.
        await seed();
        for (const [, path] of PATHS) {
            await assertFails(getDoc(doc(viewerDb(), ...path)));
            await assertFails(getDoc(doc(anonDb(), ...path)));
        }
    });

    test('NOBODY writes — not a member, not a manager, not an admin', async () => {
        // Every mutation is server-owned through the Admin SDK, because deadline, revision and
        // identity decisions cannot be expressed as a client write rule. An admin write path here
        // would also be an impersonation path: the submission identity must always be the caller's.
        for (const db of [namedDb('G. Miller'), managerDb('H. Croft'), adminDb(), viewerDb(), anonDb()]) {
            await assertFails(setDoc(doc(db, 'overtimeWindows', WEEK), { weekEnding: WEEK }));
            await assertFails(setDoc(doc(db, 'overtimeWindows', WEEK, 'participants', 'G. Miller'), { memberName: 'G. Miller' }));
            await assertFails(setDoc(doc(db, 'overtimeWindows', WEEK, 'submissions', 'G. Miller'), { currentRevision: 9 }));
            await assertFails(setDoc(doc(db, 'overtimeWindows', WEEK, 'submissions', 'G. Miller', 'revisions', '000002'), { revision: 2 }));
        }
    });

    test('an admin cannot rewrite history by deleting a revision', async () => {
        // The immutability of the audit trail is a rules property, not a convention: `allow write`
        // covers delete, and a deletable revision would make "changed since initial" forgeable.
        await seed();
        await assertFails(deleteDoc(doc(adminDb(), 'overtimeWindows', WEEK, 'submissions', 'G. Miller', 'revisions', '000001')));
        await assertFails(deleteDoc(doc(managerDb('H. Croft'), 'overtimeWindows', WEEK)));
    });

    test('a manager can LIST participants and submissions, which the workspace depends on', async () => {
        // Guard the guard, and the specific capability the Manager view needs: not a get of a known
        // path, but a query over the collection. A rule that only satisfied single-document reads
        // would pass every assertion above and leave the workspace empty.
        await seed();
        await assertSucceeds(getDocs(collection(managerDb('H. Croft'), 'overtimeWindows', WEEK, 'participants')));
        await assertSucceeds(getDocs(collection(managerDb('H. Croft'), 'overtimeWindows', WEEK, 'submissions')));
    });
});
