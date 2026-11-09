/**
 * public-data-classification.test.mjs — what may be shipped in a WORLD-READABLE file.
 * Run: node --test public-data-classification.test.mjs   (part of `npm run test:hygiene`)
 *
 * @nodeps-safe — runs on a bare checkout with nothing installed.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * `roster-data.js` is served to anyone who asks. Measured 4 Sep 2026 against the live site with no
 * session, no PIN and no token: 53 named staff with their roster type and cycle position, five start
 * dates and nine leave entitlements, plus `roster-cycle-data.js` carrying the patterns those numbers
 * index into. Together they let a stranger compute any named member's shift for any date.
 *
 * **That is a deliberate classification, not a leak** (owner, 4 Sep 2026): shift patterns are on the
 * station's own printed rosters and staff share them freely, so the base roster is not confidential.
 * The reasoning and the measurement live in `AUTH_PLAN.md` §2, which is the authority; this file is
 * the part a document cannot do.
 *
 * ── WHAT IT ACTUALLY GUARDS ─────────────────────────────────────────────────────────────────────
 *
 * Not the decision — the BLAST RADIUS of the decision. A classification is made once, about the
 * fields that existed on the day it was made, and then the file goes on accepting new ones. The
 * failure is not somebody publishing a phone number on purpose; it is somebody adding `mobile` or
 * `homeStation` or `payGrade` to a member record for a good reason, never learning that the file is
 * world-readable, and shipping it in the same commit. Nothing would fail. Nothing would say a word.
 * An external reviewer found the gap in the DOCUMENT this time — the next field would not be in a
 * document at all.
 *
 * So the allowlist below is the thing with teeth: a field nobody has classified fails here, and the
 * only way past is to decide, in the open, that the new field may be public too.
 *
 * **It cannot check VALUES**, only field names — `name` is allowed, and nothing here stops somebody
 * putting a home address in it. That is not a hole this test can close, and pretending otherwise
 * would be worse than saying so.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as rosterData from './roster-data.js';
import * as rosterMemberData from './roster-member-data.js';
import * as rosterCycleData from './roster-cycle-data.js';

const { teamMembers, CONFIG } = rosterData;

/**
 * Every field a `teamMembers` entry may carry, each classified as safe to publish.
 *
 * ADDING A FIELD IS A DECISION, NOT A FORMALITY. Ask what a stranger learns from it, then add it
 * here with the answer. If the answer is "something they should not know", it does not belong in
 * this file at all — it belongs in Firestore behind a claim, like `staffContact` (the work email,
 * which is readable only by its owner and the admin, and is deliberately NOT here).
 */
const PUBLIC_MEMBER_FIELDS = /** @type {const} */ ({
    name:          'The display name, in the form staff already use on a printed roster.',
    role:          'CEA / CES / Dispatcher / Management — the grade, which the roster prints.',
    rosterType:    'Which shift pattern they follow. The patterns themselves are public too.',
    currentWeek:   'Where in that pattern they sit. Meaningless without the pattern, and both are public.',
    hidden:        'A display flag — leavers and management rows the picker does not offer.',
    managerOnly:   'A display flag — a login-capable account with no roster of its own.',
    startDate:     'When their roster begins. On the printed roster as the week they first appear.',
    noProRate:     'A pay flag for a secondment return. Carries no figure.',
    proRatedAL:    'A joining year’s leave entitlement in days. A number of days off, not pay.',
    rosterChanges: 'Scheduled moves between patterns — dates and pattern names, nothing personal.',
    permanentShift:'Forces an early/late badge. A display hint.',
    bilingualContract: 'Whether this CEA holds a bilingual contract, which carries 34 days\u2019 '
        + 'leave rather than 32. A contractual grade, not a language skill and not a health or '
        + 'personal fact \u2014 the same class of thing as `role`, which is already public. It '
        + 'cannot be derived from `rosterType`: a CEA on a plain contract is routinely placed on '
        + 'a bilingual line until a CEA one frees up.',
});

/**
 * What may sit INSIDE a field whose value is an object (whole-app review, I10). The checks below
 * read `Object.keys(member)`, which stops at the top level — so a `reason` added to a roster move,
 * or anything tucked into `proRatedAL`, would publish unclassified while this file stayed green.
 * Every object-valued field must have its inside described here, or the nested check fails.
 *
 * `entries` — an array of records, each limited to the listed fields.
 * `by-year` — `{ [year]: number }` and nothing else, so no other kind of value can ride in it.
 */
const PUBLIC_NESTED_SHAPES = /** @type {const} */ ({
    rosterChanges: {
        kind: 'entries',
        fields: {
            from:        'The date the move takes effect — the week they appear on the new pattern.',
            rosterType:  'The pattern moved to. Public, as the top-level field is.',
            currentWeek: 'Where in the new pattern. Public, as the top-level field is.',
        },
    },
    proRatedAL: { kind: 'by-year' },
});

describe('roster-data.js is world-readable, so what it carries is a decision', () => {
    test('every field shipped in teamMembers has been classified as public', () => {
        const seen = new Set();
        for (const m of teamMembers) Object.keys(m).forEach(k => seen.add(k));
        const unclassified = [...seen].filter(k => !(k in PUBLIC_MEMBER_FIELDS)).sort();
        assert.deepEqual(unclassified, [],
            `roster-data.js ships to anyone who asks — no session, no PIN (AUTH_PLAN.md §2). These `
            + `fields are not in the public classification list:\n    ${unclassified.join(', ')}\n`
            + 'Decide whether a stranger may read them. If yes, add each to PUBLIC_MEMBER_FIELDS '
            + 'with a one-line reason. If no, it belongs in Firestore behind a claim, not in this file.');
    });

    test('and the list has not drifted into naming fields nobody ships', () => {
        // A stale allowlist is how the guard loosens without anybody deciding to loosen it: an entry
        // left behind after a field is removed silently re-permits it years later. `permanentShift`
        // is the one deliberate exception — it is documented in the field reference in
        // .claude/rules/roster-data.md and no current member uses it, so it may sit here unused.
        const seen = new Set();
        for (const m of teamMembers) Object.keys(m).forEach(k => seen.add(k));
        const unused = Object.keys(PUBLIC_MEMBER_FIELDS)
            .filter(k => !seen.has(k) && k !== 'permanentShift');
        assert.deepEqual(unused, [],
            `PUBLIC_MEMBER_FIELDS permits fields no member carries: ${unused.join(', ')}. `
            + 'Remove them, so the list keeps describing what is actually published.');
    });

    test('and every field NESTED inside one has been classified too', () => {
        /** @type {string[]} */ const offenders = [];
        for (const m of teamMembers) {
            for (const [k, v] of Object.entries(m)) {
                if (v === null || typeof v !== 'object' || v instanceof Date) continue;
                const shape = /** @type {any} */ (PUBLIC_NESTED_SHAPES)[k];
                if (!shape) { offenders.push(`${k}: holds an object whose inside nobody has classified`); continue; }
                if (shape.kind === 'entries') {
                    if (!Array.isArray(v)) { offenders.push(`${k}: expected a list of records`); continue; }
                    for (const entry of v) {
                        for (const f of Object.keys(entry)) if (!(f in shape.fields)) offenders.push(`${k}[].${f}`);
                    }
                } else {
                    for (const [year, days] of Object.entries(v)) {
                        if (!/^\d{4}$/.test(year) || typeof days !== 'number') offenders.push(`${k}.${year}`);
                    }
                }
            }
        }
        assert.deepEqual([...new Set(offenders)].sort(), [],
            'roster-data.js ships to anyone who asks, and these NESTED fields are not classified. '
            + 'Decide whether a stranger may read each; if yes, describe it in PUBLIC_NESTED_SHAPES '
            + 'with a reason, and if no, it belongs in Firestore behind a claim.');
    });

    test('the fields deliberately kept OUT stay out', () => {
        // Named rather than implied. Each of these has a real home behind a claim, and each is the
        // shape of thing somebody would reasonably reach for when adding to a member record.
        const NEVER = ['workEmail', 'email', 'phone', 'mobile', 'address', 'homeStation',
                       'password', 'uid', 'payRate', 'salary', 'nino', 'dob', 'dateOfBirth'];
        const seen = new Set();
        for (const m of teamMembers) Object.keys(m).forEach(k => seen.add(k));
        for (const k of NEVER) {
            assert.ok(!seen.has(k),
                `teamMembers carries "${k}", which is served to anyone who asks. The work email `
                + 'lives in the `staffContact` collection, readable only by its owner and the admin '
                + '— that is the pattern to follow.');
        }
    });
});

// ── CONFIG, AND EVERY OTHER DATA EXPORT (test audit, 7 Nov 2026) ─────────────────────────────────
//
// The checks above stop at `teamMembers`, and the same world-readable file ships everything else
// it exports. Seven `CONFIG` keys carry people — who holds the admin and manager claims, who may
// open the Links and New link workspaces, who is in the Overtime beta, the Calendar's default
// member, and the bug-report mailbox — and none of it was classified anywhere. Measured: a NAMED
// list added to CONFIG passed all 4,231 hygiene tests. These close that the same way the member
// fields are closed: a key or an export nobody has classified fails, and the way past is to decide.

/**
 * Every key of `CONFIG`, classified as safe to publish. Every one of these reaches anyone who asks.
 * A key that NAMES people (or carries an address) must also be in `CONFIG_KEYS_NAMING_PEOPLE`.
 */
const PUBLIC_CONFIG_KEYS = /** @type {const} */ ({
    MAIN_ROSTER_WEEKS:                'The length of a rota cycle. On the printed roster.',
    BILINGUAL_ROSTER_WEEKS:           'The length of a rota cycle. On the printed roster.',
    CES_ROSTER_WEEKS:                 'The length of a rota cycle. On the printed roster.',
    DISPATCHER_ROSTER_WEEKS:          'The length of a rota cycle. On the printed roster.',
    PAYDAY_INTERVAL_DAYS:             'Paydays fall every four weeks: the company calendar, nobody’s pay.',
    FIRST_PAYDAY:                     'A company payday date. Carries no figure.',
    MAIN_ROSTER_REFERENCE_DATE:       'The date a rota cycle is counted from.',
    BILINGUAL_ROSTER_REFERENCE_DATE:  'The date a rota cycle is counted from.',
    CES_ROSTER_REFERENCE_DATE:        'The date a rota cycle is counted from.',
    DISPATCHER_ROSTER_REFERENCE_DATE: 'The date a rota cycle is counted from.',
    MIN_YEAR:                         'The earliest year the Calendar navigates to.',
    MAX_YEAR:                         'The latest year the Calendar navigates to.',
    EARLY_START_THRESHOLD:            'Where an Early begins. A display rule.',
    EARLY_SHIFT_THRESHOLD:            'Where a Late begins. A display rule.',
    NIGHT_START_THRESHOLD:            'Where a Night begins. A display rule.',
    DEFAULT_MEMBER_NAME:              'The member the Calendar opens on when nobody is chosen: a name '
        + 'teamMembers publishes already.',
    ADMIN_NAMES:                      'Who holds the admin claim. Published because the client draws its '
        + 'buttons from it; the claim itself is set server-side and is what the rules check, so '
        + 'reading the name grants nothing.',
    LINKS_DESIGNERS:                  'Who may open the Links workspace. Same standing: the '
        + '`linksDesigner` claim is set server-side and is the control.',
    OVERTIME_ENABLED:                 'Whether the Overtime page is open. A switch.',
    NEWLINK_PREVIEW:                  'Who may open the New link besides its audience (its preview until '
        + 'v25.60). Page access only, over files that are public anyway.',
    OVERTIME_BETA:                    'Who answers the Overtime beta. The server keeps its own copy and '
        + 'decides from that.',
    MANAGER_NAMES:                    'Who holds the manager claim. Same standing as ADMIN_NAMES.',
    GRADE_ORDER:                      'The order grades are grouped in a picker.',
    WORK_EMAIL_DOMAIN:                'The company’s email domain, on every email it sends.',
    FORCE_PASSWORD_SET:               'A feature switch.',
    PASSWORD_RESET_REQUESTS:          'A feature switch.',
    CLAIM_EPOCH:                      'A counter that asks each device to refresh its sign-in token.',
    SUPPORT_EMAIL:                    'Where bug reports go: a work mailbox the app hands to every user '
        + 'by design.',
});

/** The CONFIG keys whose values name people or carry an address. Publishing a name is the decision
 *  most worth seeing, so it is recorded here rather than left implicit in a reason. */
const CONFIG_KEYS_NAMING_PEOPLE = new Set([
    'DEFAULT_MEMBER_NAME', 'ADMIN_NAMES', 'LINKS_DESIGNERS', 'NEWLINK_PREVIEW',
    'OVERTIME_BETA', 'MANAGER_NAMES', 'SUPPORT_EMAIL',
]);

/**
 * Every DATA export (anything that is not a function) of the three world-readable roster modules.
 * Functions are code, and the code is public by nature; data is what this file is about. The two
 * sub-modules are read too, so an export added there and not re-exported is not missed.
 */
const PUBLIC_DATA_EXPORTS = /** @type {const} */ ({
    APP_VERSION:      'The release number, shown in About.',
    CONFIG:           'Classified key by key in PUBLIC_CONFIG_KEYS.',
    teamMembers:      'Classified field by field in PUBLIC_MEMBER_FIELDS.',
    weeklyRoster:     'A shift pattern. Public by the owner’s decision (AUTH_PLAN.md §2).',
    bilingualRoster:  'A shift pattern. Public by the owner’s decision (AUTH_PLAN.md §2).',
    cesRoster:        'A shift pattern. Public by the owner’s decision (AUTH_PLAN.md §2).',
    dispatcherRoster: 'A shift pattern. Public by the owner’s decision (AUTH_PLAN.md §2).',
    fixedRoster:      'The fixed patterns. Public by the owner’s decision (AUTH_PLAN.md §2).',
    TEAM_GRADES:      'The grade groups Team Week offers.',
    DAY_NAMES:        'Calendar words.',
    MONTH_ABB:        'Calendar words.',
    MONTH_NAMES:      'Calendar words.',
    SHIFT_TIME_REGEX: 'A pattern for reading a shift time.',
    TIME_RE:          'A pattern for reading a clock time.',
    SWIPE_THRESHOLD:  'Gesture tuning.',
    SWIPE_VELOCITY:   'Gesture tuning.',
});

/** Every non-function export of the three modules, by name. */
function dataExports() {
    const names = new Set();
    for (const mod of [rosterData, rosterMemberData, rosterCycleData]) {
        for (const [k, v] of Object.entries(mod)) if (typeof v !== 'function') names.add(k);
    }
    return names;
}

describe('…and so is everything else roster-data.js exports', () => {
    test('every CONFIG key has been classified as public', () => {
        const unclassified = Object.keys(CONFIG).filter(k => !(k in PUBLIC_CONFIG_KEYS)).sort();
        assert.deepEqual(unclassified, [],
            `CONFIG ships to anyone who asks, and these keys are not classified:\n    ${unclassified.join(', ')}\n`
            + 'Decide whether a stranger may read each. If yes, add it to PUBLIC_CONFIG_KEYS with a '
            + 'one-line reason (and to CONFIG_KEYS_NAMING_PEOPLE if it names anybody). If no, it '
            + 'belongs in Firestore behind a claim.');
    });

    test('and the CONFIG list has not drifted into naming keys nobody ships', () => {
        const stale = Object.keys(PUBLIC_CONFIG_KEYS).filter(k => !(k in CONFIG));
        assert.deepEqual(stale, [], `PUBLIC_CONFIG_KEYS permits keys CONFIG no longer has: ${stale.join(', ')}. Remove them.`);
        const staleNaming = [...CONFIG_KEYS_NAMING_PEOPLE].filter(k => !(k in CONFIG));
        assert.deepEqual(staleNaming, [], `CONFIG_KEYS_NAMING_PEOPLE lists keys CONFIG no longer has: ${staleNaming.join(', ')}.`);
    });

    test('a CONFIG key that names a member, or carries an address, says so', () => {
        // Read from the VALUES, so a key that starts carrying names — a new one, or an old one put to
        // a new use — is caught even when its reason was written for something else.
        const names = new Set(teamMembers.map(m => m.name));
        const naming = (/** @type {unknown} */ v) => {
            const strings = typeof v === 'string' ? [v]
                : Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
            return strings.some(s => names.has(s) || /@/.test(s));
        };
        const undeclared = Object.entries(CONFIG)
            .filter(([k, v]) => naming(v) && !CONFIG_KEYS_NAMING_PEOPLE.has(k))
            .map(([k]) => k).sort();
        assert.deepEqual(undeclared, [],
            `These CONFIG keys name a member or carry an address, and are not declared as doing so: `
            + `${undeclared.join(', ')}. Publishing a name is a decision; record it in `
            + 'CONFIG_KEYS_NAMING_PEOPLE, or move the names behind a claim.');
        assert.ok(naming(CONFIG.ADMIN_NAMES) && naming(CONFIG.SUPPORT_EMAIL),
            'the detector must recognise the two kinds it exists for, or the check above proves nothing');
    });

    test('every data export of the roster modules has been classified, and no entry is stale', () => {
        const shipped = dataExports();
        const unclassified = [...shipped].filter(k => !(k in PUBLIC_DATA_EXPORTS)).sort();
        assert.deepEqual(unclassified, [],
            `These exports ship to anyone who asks and are not classified:\n    ${unclassified.join(', ')}\n`
            + 'Add each to PUBLIC_DATA_EXPORTS with a reason, or keep the data out of a public file.');
        const stale = Object.keys(PUBLIC_DATA_EXPORTS).filter(k => !shipped.has(k));
        assert.deepEqual(stale, [], `PUBLIC_DATA_EXPORTS permits exports nothing ships: ${stale.join(', ')}. Remove them.`);
    });
});
