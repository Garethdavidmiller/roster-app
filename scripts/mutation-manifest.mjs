// mutation-manifest.mjs — the WIRING lines scripts/mutation-sweep.mjs breaks on purpose, weekly.
//
// ── WHAT BELONGS HERE ──────────────────────────────────────────────────────────────────────────
//
// A line on a path that MOVES MONEY, DECIDES ACCESS or NAMES A PERSON, where the helper it calls is
// already tested and the danger is the CALL: the wrong argument, the result discarded, the check
// skipped, the wider audience. CLAUDE.md → "The rule tested, the wiring not". Not every line of
// those paths — a helper's own arithmetic has its own suite — and not a CSS or copy change.
//
// Nor an EQUIVALENT mutant: one another layer makes harmless, so no test could kill it. Handing the
// managers' names to the admin-only notices is the worked example — `enabledAdminUids` then drops
// every account without the admin claim, so nothing changes (first sweep, 25 Nov 2026). Break the
// layer that decides instead (here, the claim check itself: admin-recipients-claim).
//
// Each entry is one mutate.mjs edit:
//   id      a short stable name (the table's row; `--only` takes it)
//   file    the file to break, from the repository root
//   in      (optional) mutate.mjs's --in: narrows a find that repeats to one block
//   find    the EXACT text, which must occur exactly once (in `in`'s block, when given)
//   replace what it becomes ('' deletes)
//   test    the NARROWEST command that should fail — run from the root, unchanged and then mutated
//   breaks  one line: what a person would get if the mutant shipped
//
// ── WHAT A TEST COMMAND MAY NEED ───────────────────────────────────────────────────────────────
//
// Only `npm ci` and `npm ci --prefix functions`: the unit lanes and the Functions suites. No
// browser, no emulator — the sweep is cheap enough to run weekly in full (mutation.yml). A wiring
// line only a browser can see (the page coordinators — `navigateToPaycalc`'s gate in calendar-app.js
// is e2e/calendar-day-detail.spec.js's "offers no jump from a colleague's month") is the browser lanes' work,
// and is not listed here as if it were covered. paycalc-app.js's `calculate()` shows the way out: the
// rules that decided its pricing left it for a pure function (`takeHomeInputs`, paycalc-calc.js,
// 25 Nov 2026), so they are listed below against the tests that call it.
//
// ── WHEN AN ENTRY GOES STALE ───────────────────────────────────────────────────────────────────
//
// Editing a listed line makes its entry stale, and `mutation-sweep-script.test.mjs` fails `npm test`
// on that commit (it runs `--check-only`). Re-aim the entry at the line as it now reads, in the same
// commit — or, if the line is gone because the wiring moved, aim it at where it went. Never delete
// an entry to make a run pass: a deleted entry is a guard nobody checks any more.

const node = process.execPath;
/** A suite that mocks modules (test:unit). @param {string} f */
const unit = (f) => [node, '--experimental-test-module-mocks', 'scripts/run-tests.mjs', `test/${f}`];
/** A suite that needs no mocking flag (test:hygiene, test:functions). @param {string} f */
const plain = (f) => [node, 'scripts/run-tests.mjs', `test/${f}`];

/** @type {import('./mutation-sweep.mjs').Entry[]} */
export const MUTATIONS = [
    // ── WHO A PUSH REACHES (functions/) ────────────────────────────────────────────────────────
    {
        id: 'pay-reminder-own-account',
        file: 'functions/pay-reminder.js',
        find: 'return isMembersOwnAccount(user, name) ? user.uid : null;',
        replace: 'return user.uid;',
        test: plain('documents-endpoints.test.mjs'),
        breaks: 'the pay reminder reaches any account at a member\'s address — the retired shared PIN account, a disabled one',
    },
    {
        id: 'pay-reminder-grades',
        file: 'functions/pay-reminder.js',
        find: "const PAY_REMINDER_GRADES = Object.freeze(['cea', 'ces']);",
        replace: "const PAY_REMINDER_GRADES = Object.freeze(['cea', 'ces', 'dispatcher']);",
        test: plain('documents-endpoints.test.mjs'),
        breaks: 'Dispatchers are sent to a Pay Calculator that cannot price their grade',
    },
    {
        id: 'pay-reminder-targeted',
        file: 'functions/pay-reminder.js',
        find: "}), uids, '[payReminder]');",
        replace: "}), [], '[payReminder]');",
        test: plain('documents-endpoints.test.mjs'),
        breaks: 'the resolved members are dropped on the way to the send, so nobody gets the pay reminder',
    },
    {
        id: 'members-own-account-claim',
        file: 'functions/admin-recipients.js',
        find: '&& user.customClaims && user.customClaims.member === name);',
        replace: ');',
        test: plain('documents-endpoints.test.mjs'),
        breaks: 'a member notice goes to whatever account sits at the derived address, claimed for somebody else or never set up',
    },
    {
        id: 'admin-recipients-claim',
        file: 'functions/admin-recipients.js',
        find: '&& user.customClaims && user.customClaims.admin === true) uids.push(user.uid);',
        replace: ') uids.push(user.uid);',
        test: plain('error-log-notify.test.mjs'),
        breaks: 'an account at the admin\'s address without the admin claim is told who is locked out',
    },
    {
        id: 'admin-recipients-enabled',
        file: 'functions/admin-recipients.js',
        find: 'if (user && user.uid && !user.disabled && user.customClaims',
        replace: 'if (user && user.uid && user.customClaims',
        test: plain('error-log-notify.test.mjs'),
        breaks: 'a disabled admin account\'s devices keep receiving admin-only notices',
    },
    {
        id: 'targeted-push-owner-filter',
        file: 'functions/push.js',
        find: "getFirestore().collection('pushSubscriptions').where('owner', '==', uid).get()));",
        replace: "getFirestore().collection('pushSubscriptions').get()));",
        test: plain('push-transport.test.mjs'),
        breaks: 'a notice addressed to one person — a password reset, a locked-out colleague\'s name — goes to every device',
    },
    {
        id: 'targeted-push-endpoint-guard',
        file: 'functions/push.js',
        in: 'async function sendTargetedPush(payload, ownerUids, logTag, opts = {}) {',
        find: 'if (!isAllowedPushEndpoint(endpoint)) {',
        replace: 'if (false) {',
        test: plain('push-transport.test.mjs'),
        breaks: 'a targeted send POSTs to any URL a signed-in account stored as its endpoint',
    },
    {
        id: 'fanout-push-endpoint-guard',
        file: 'functions/push.js',
        in: 'async function fanOutPush(payload, logTag) {',
        find: 'if (!isAllowedPushEndpoint(endpoint)) {',
        replace: 'if (false) {',
        test: plain('push-transport.test.mjs'),
        breaks: 'every broadcast POSTs to any URL a signed-in account stored as its endpoint',
    },
    {
        id: 'reset-request-names-asker',
        file: 'functions/reset-request.js',
        find: 'const { headline, body } = buildResetRequestNotice(member, pending);',
        replace: "const { headline, body } = buildResetRequestNotice('A. Nother', pending);",
        test: plain('auth-endpoints.test.mjs'),
        breaks: 'the admin is told the wrong colleague is locked out, and resets the wrong account',
    },
    {
        id: 'reset-request-uids',
        file: 'functions/reset-request.js',
        find: "                uids,\n                '[reset-request]',",
        replace: "                [],\n                '[reset-request]',",
        test: plain('auth-endpoints.test.mjs'),
        breaks: 'the admin is never told a member is locked out and waiting for a reset',
    },
    {
        id: 'error-log-to-admin',
        file: 'functions/error-log-notify.js',
        find: "}), uids, '[errorLog]');",
        replace: "}), [], '[errorLog]');",
        test: plain('error-log-notify.test.mjs'),
        breaks: 'the admin is never told the Error Log has new entries',
    },

    // ── ACCOUNTS AND CLAIMS (functions/auth-endpoints.js, request-helpers.js) ──────────────────
    {
        id: 'setup-requires-admin',
        file: 'functions/auth-endpoints.js',
        find: 'if (!(await requireAdmin(req, res))) return;\n\n        // B4: only ACTION flags',
        replace: '\n\n        // B4: only ACTION flags',
        test: plain('auth-endpoints.test.mjs'),
        breaks: 'anybody can run Set up accounts: re-stamp every claim, disable leavers, reset re-enabled accounts',
    },
    {
        id: 'reset-requires-admin',
        file: 'functions/auth-endpoints.js',
        find: 'if (!(await requireAdmin(req, res))) return;   // a revoked admin',
        replace: '// a revoked admin',
        test: plain('auth-endpoints.test.mjs'),
        breaks: 'anybody can reset any member\'s password to their surname default',
    },
    {
        id: 'require-admin-claim',
        file: 'functions/request-helpers.js',
        find: 'if (!decoded || decoded.admin !== true) {',
        replace: 'if (!decoded) {',
        test: plain('auth-endpoints.test.mjs'),
        breaks: 'any signed-in member passes every admin-only endpoint',
    },
    {
        id: 'require-admin-check-revoked',
        file: 'functions/request-helpers.js',
        find: 'decoded = await getAuth().verifyIdToken(token, true);',
        replace: 'decoded = await getAuth().verifyIdToken(token, false);',
        test: plain('auth-endpoints.test.mjs'),
        breaks: 'a demoted or signed-out admin\'s cached token still resets accounts for up to an hour',
    },
    {
        id: 'setup-claims-sets',
        file: 'functions/auth-endpoints.js',
        find: 'claimsForTier(name, { adminSet: adminMembers, managerSet: managerMembers, designerSet: designerMembers })',
        replace: 'claimsForTier(name, { adminSet: managerMembers, managerSet: managerMembers, designerSet: designerMembers })',
        test: plain('auth-endpoints.test.mjs'),
        breaks: 'every manager is stamped with the admin claim, and the admin loses theirs',
    },
    {
        id: 'setup-admin-set',
        file: 'functions/auth-endpoints.js',
        find: 'const adminMembers    = new Set(cfg.admin);',
        replace: 'const adminMembers    = new Set([...cfg.admin, ...cfg.manager]);',
        test: plain('auth-endpoints.test.mjs'),
        breaks: 'managers are granted admin: true — the master-admin collections open to them',
    },
    {
        id: 'setup-demotion-signs-out',
        file: 'functions/auth-endpoints.js',
        find: 'lost = elevatedClaimsLost(previousClaims, claims);',
        replace: 'lost = [];',
        test: plain('auth-endpoints.test.mjs'),
        breaks: 'a member who loses admin or manager keeps using it until their token renews',
    },
    {
        id: 'reset-on-roster-only',
        file: 'functions/auth-endpoints.js',
        find: 'if (!cfg.processMembers.includes(member)) {',
        replace: 'if (false) {',
        test: plain('auth-endpoints.test.mjs'),
        breaks: 'the admin reset reaches an account the deployed roster no longer holds — a leaver signed back in',
    },
    {
        id: 'reset-lost-phone-not-told',
        file: 'functions/auth-endpoints.js',
        find: 'if (!takeBack && !lostDevice) try {',
        replace: 'if (!takeBack) try {',
        test: plain('auth-endpoints.test.mjs'),
        breaks: 'a lost or stolen phone\'s lock screen is told the member\'s password was just reset',
    },
    {
        id: 'reset-tells-the-member',
        file: 'functions/auth-endpoints.js',
        find: "                    [user.uid],\n                    '[resetMemberPassword]',",
        replace: "                    [],\n                    '[resetMemberPassword]',",
        test: plain('auth-endpoints.test.mjs'),
        breaks: 'the member whose password was reset is the one person not told',
    },
    {
        id: 'reset-lost-phone-releases-push',
        file: 'functions/auth-endpoints.js',
        find: 'if (lostDevice) try { pushReleased = await releasePushForOwner(user.uid); }',
        replace: 'if (false) try { pushReleased = await releasePushForOwner(user.uid); }',
        test: plain('auth-endpoints.test.mjs'),
        breaks: 'a lost phone goes on receiving the member\'s targeted notices after the reset',
    },
    {
        id: 'reset-refuses-disabled',
        file: 'functions/auth-endpoints.js',
        find: 'if (user.disabled && !takeBack) {',
        replace: 'if (false) {',
        test: plain('auth-endpoints.test.mjs'),
        breaks: 'a reset on a disabled account reports success to the admin, and the member still cannot sign in',
    },

    {
        id: 'sign-in-stats-admin',
        file: 'functions/account-reads.js',
        find: 'if (!(await requireAdmin(req, res))) return;\n\n        // An ALLOWLIST',
        replace: '\n\n        // An ALLOWLIST',
        test: plain('auth-endpoints.test.mjs'),
        breaks: 'anybody can read the sign-in counts, which are meant for the admin',
    },
    {
        id: 'setup-gaps-admin',
        file: 'functions/account-reads.js',
        find: 'if (!(await requireAdmin(req, res))) return;\n\n        const cfg = resolveRosterAuthConfig(rosterMembers);',
        replace: '\n\n        const cfg = resolveRosterAuthConfig(rosterMembers);',
        test: plain('auth-endpoints.test.mjs'),
        breaks: 'anybody can list who has no login, whose tier is wrong and which leaver can still sign in — by name',
    },
    {
        id: 'setup-dry-run-disables-nothing',
        file: 'functions/auth-endpoints.js',
        find: 'if (!confirmOrphanRemoval) {\n                        orphansToDisable.push(label);',
        replace: 'if (false) {\n                        orphansToDisable.push(label);',
        test: plain('auth-endpoints.test.mjs'),
        breaks: 'the leaver PREVIEW disables the accounts it lists, before the admin has confirmed one',
    },
    {
        id: 'setup-old-leavers-push-released',
        file: 'functions/auth-endpoints.js',
        find: 'if (confirmOrphanRemoval) for (const uid of disabledLeaverUids(users, activeEmails)) {',
        replace: 'if (false) for (const uid of disabledLeaverUids(users, activeEmails)) {',
        test: plain('auth-endpoints.test.mjs'),
        breaks: 'a leaver disabled on an earlier run keeps receiving every broadcast on their phone',
    },
    {
        id: 'rotate-links-admin',
        file: 'functions/documents.js',
        find: "if (!(await requireAdmin(req, res, 'rotateDocumentLinks'))) return;",
        replace: '',
        test: plain('documents-endpoints.test.mjs'),
        breaks: 'anybody can rotate the document links, breaking every copy staff have saved',
    },
    {
        id: 'huddle-ingest-secret',
        file: 'functions/huddle-ingest.js',
        find: '        if (!match) {\n            res.status(401)',
        replace: '        if (false) {\n            res.status(401)',
        test: plain('documents-endpoints.test.mjs'),
        breaks: 'anybody can publish a Daily Huddle and push it to every phone',
    },

    // ── THE DOCUMENT DOOR (functions/documents.js, doc-url-core.js) ────────────────────────────
    {
        id: 'doc-door',
        file: 'functions/documents.js',
        find: 'if (!mayReceiveDocumentUrl(claims)) {',
        replace: 'if (false) {',
        test: plain('documents-endpoints.test.mjs'),
        breaks: 'any signed-in account — an anonymous one included — gets a signed link to the Huddle',
    },
    {
        id: 'doc-door-check-revoked',
        file: 'functions/documents.js',
        find: 'claims = await getAuth().verifyIdToken(bearer, true);',
        replace: 'claims = await getAuth().verifyIdToken(bearer, false);',
        test: plain('documents-endpoints.test.mjs'),
        breaks: 'a disabled leaver\'s cached token still opens the documents for up to an hour',
    },
    {
        id: 'doc-path-for-kind',
        file: 'functions/documents.js',
        find: 'if (!isSignablePathForKind(kind.kind, data.storagePath)) {',
        replace: "if (!isSignablePathForKind('huddle', data.storagePath)) {",
        test: plain('documents-endpoints.test.mjs'),
        breaks: 'a circular whose record points into huddles/ is signed — the signer bypasses storage.rules',
    },
    {
        id: 'doc-door-bound-name',
        file: 'functions/doc-url-core.js',
        find: 'if (memberNameFromClaims(claims)) return true;',
        replace: 'if (claims.name) return true;',
        test: plain('doc-url-core.test.mjs'),
        breaks: 'a self-set display name opens the documents, where the rules ask for a bound member',
    },

    // ── PAGE ACCESS (auth-policy.js, pay-audience.js) ──────────────────────────────────────────
    {
        id: 'nav-overtime-gate',
        file: 'auth-policy.js',
        find: 'canOpenOvertime: canOpenOvertime(member),',
        replace: 'canOpenOvertime: !!member,',
        test: plain('nav-gates.test.mjs'),
        breaks: 'every member\'s drawer offers the paused Overtime page',
    },
    {
        id: 'nav-admin-gate',
        file: 'auth-policy.js',
        find: 'isAdmin:         r.admin,',
        replace: 'isAdmin:         r.admin || r.manager,',
        test: plain('nav-gates.test.mjs'),
        breaks: 'managers are offered Operations, the admin\'s page',
    },
    {
        id: 'page-roles-from-member',
        file: 'auth-policy.js',
        find: 'const roles  = rolesFor(snapshot && snapshot.member);',
        replace: "const roles  = rolesFor(CONFIG.ADMIN_NAMES[0]);",
        test: plain('auth-policy.test.mjs'),
        breaks: 'every signed-in member is judged with the admin\'s roles, and opens Operations',
    },
    {
        id: 'page-unknown-fails-closed',
        file: 'auth-policy.js',
        find: "return requirePageAuth(snapshot, { requireNamed: true, role: ['admin'] }, roles);",
        replace: 'return requirePageAuth(snapshot, { requireNamed: false }, roles);',
        test: plain('auth-policy.test.mjs'),
        breaks: 'a mistyped page name is opened to everybody, signed in or not',
    },
    {
        id: 'page-other-staff-refused',
        file: 'auth-policy.js',
        find: 'if (status === \'named\' && /** @type {any} */ (roles).otherStaff && !p.otherStaff) {',
        replace: 'if (false) {',
        test: plain('auth-policy.test.mjs'),
        breaks: 'an Other Staff login opens Admin and the Pay Calculator, which price a grade they do not hold',
    },
    {
        id: 'overtime-reviewer-narrow',
        file: 'auth-policy.js',
        find: '    return r.admin || r.manager;\n}',
        replace: '    return r.admin || r.manager || r.overtimeBeta;\n}',
        test: plain('auth-policy.test.mjs'),
        breaks: 'a beta tester is treated as a reviewer and shown everybody\'s availability',
    },
    {
        id: 'overtime-paused',
        file: 'auth-policy.js',
        find: 'return overtimeEnabled() && (isOvertimeReviewer(member) || rolesFor(member).overtimeBeta);',
        replace: 'return (isOvertimeReviewer(member) || rolesFor(member).overtimeBeta);',
        test: plain('auth-policy.test.mjs'),
        breaks: 'the paused Overtime page is offered, and every call it makes answers 404',
    },
    {
        id: 'pay-audience-page-policy',
        file: 'pay-audience.js',
        find: "{ otherStaff: isOtherStaff(member) }).decision === 'forbidden') return false;",
        replace: "{ otherStaff: false }).decision === 'forbidden') return false;",
        test: plain('pay-audience.test.mjs'),
        breaks: 'an Other Staff login with an earlier priced grade is sent to, and priced by, the Pay Calculator',
    },

    // ── CALENDAR ACCESS (calendar-access.js, calendar-app.js) ──────────────────────────────────
    {
        id: 'calendar-access-decides',
        file: 'calendar-access.js',
        find: 'return decideAccess({ session: getSession(), firebaseUser: user });',
        replace: "return 'named';",
        test: unit('calendar-access.test.mjs'),
        breaks: 'the Calendar opens everybody\'s leave and absence to a visitor with no named sign-in',
    },
    {
        id: 'notice-pay-audience',
        file: 'calendar-notices.js',
        find: 'return payCalculatorPrices(teamMembers.find(m => m.name === name) ?? null);',
        replace: 'return true;',
        test: unit('calendar-notices.test.mjs'),
        breaks: 'a Dispatcher or a manager is sent to a Pay Calculator that refuses them',
    },
    {
        id: 'day-panel-own-panel',
        file: 'calendar-al-lightbox.js',
        find: 'accessType: getAccessType(), sessionName: getSession()?.name, shownMember: member?.name,',
        replace: 'accessType: getAccessType(), sessionName: getSession()?.name, shownMember: getSession()?.name,',
        test: unit('calendar-al-lightbox.test.mjs'),
        breaks: 'the leave panel offers "view your leave" on a colleague\'s calendar — a link to somebody else\'s booking',
    },
    {
        id: 'day-panel-personal-actions',
        file: 'calendar-al-lightbox.js',
        find: '        shownMember: getCurrentMember()?.name,\n    });',
        replace: '        shownMember: getSession()?.name,\n    });',
        test: unit('calendar-al-lightbox.test.mjs'),
        breaks: 'a colleague\'s day panel offers the pay and leave jumps as if the day were the reader\'s own',
    },

    // ── ANNUAL LEAVE: NEVER A GUESSED ALLOWANCE (al-entitlement.js) ────────────────────────────
    {
        id: 'entitlement-null-stays-null',
        file: 'al-entitlement.js',
        find: '    if (contract === null) return null;\n    const { carried, late } = boxingDayLieuSplit',
        replace: '    const { carried, late } = boxingDayLieuSplit',
        test: plain('al-entitlement.test.mjs'),
        breaks: 'a year with no allowance on record shows a confident figure — the lieu days, or 0',
    },
    // THE BOXING DAY IN LIEU IS SPENT WHERE IT IS NEEDED (owner, 25 Nov 2026): leave from 27 December that the year
    // cannot cover uses it that year, otherwise it is in the next.
    {
        id: 'boxing-lieu-taken-late',
        file: 'al-entitlement.js',
        find: '    return afterIt && counted.size > contract + carried ? b : b + 1;',
        replace: '    return b + 1;',
        test: plain('christmas-leave.test.mjs'),
        breaks: 'leave on New Year\'s Eve after a worked Boxing Day reads as over allowance, the day in lieu stuck in the next year',
    },
    {
        id: 'boxing-lieu-own-leave-first',
        file: 'al-entitlement.js',
        find: '    return afterIt && counted.size > contract + carried ? b : b + 1;',
        replace: '    return afterIt ? b : b + 1;',
        test: plain('christmas-leave.test.mjs'),
        breaks: 'a late-December day with the year\'s own leave still left spends the day in lieu, which keeps, instead',
    },
    {
        id: 'al-position-null-balance',
        file: 'al-entitlement.js',
        find: 'if (entitlement === null) return { entitlement: null, taken, booked, remaining: null };',
        replace: '',
        test: plain('al-entitlement.test.mjs'),
        breaks: 'a member with no allowance on record is shown a negative "days remaining"',
    },
    {
        id: 'leave-year-choices-null',
        file: 'al-entitlement.js',
        find: 'if (prevPos.remaining === null || ownPos.remaining === null) continue;',
        replace: '',
        test: plain('al-entitlement.test.mjs'),
        breaks: 'a January day is offered to a year whose allowance is not on record, against an invented balance',
    },
    {
        id: 'al-position-entitlement-for',
        file: 'al-entitlement.js',
        find: '    const entitlement = entitlementFor(member, year, overrides);\n    const dates = countedAlDates',
        replace: '    const entitlement = getALEntitlement(member, year, overrides);\n    const dates = countedAlDates',
        test: plain('christmas-leave.test.mjs'),
        breaks: 'the balance forgets the day in lieu owed for working Boxing Day',
    },
    {
        id: 'projection-skips-null-year',
        file: 'admin-al-projection.js',
        find: '        const entitlement = entitlementFor(member, yearStr, allowance);\n        if (entitlement === null) continue;',
        replace: '        const entitlement = entitlementFor(member, yearStr, allowance);',
        test: plain('admin-al-projection.test.mjs'),
        breaks: 'booking leave in a year with no allowance on record warns "over allowance" against nothing',
    },

    // ── WHO A WRITE IS RECORDED AS (override-utils.js, admin-overrides.js) ─────────────────────
    {
        id: 'override-write-changed-by',
        file: 'override-utils.js',
        find: '        changedBy:  f.changedBy,\n        ...(uploadId',
        replace: '        changedBy:  f.memberName,\n        ...(uploadId',
        test: unit('admin-overrides.test.mjs'),
        breaks: 'a manager\'s change on a member\'s behalf is recorded as the member\'s own',
    },
    {
        id: 'range-write-changed-by',
        file: 'admin-overrides.js',
        find: "note: '', source: 'manual', changedBy, replacedType",
        replace: "note: '', source: 'manual', changedBy: memberName, replacedType",
        test: unit('admin-overrides.test.mjs'),
        breaks: 'a leave or absence range booked on behalf is recorded as booked by the member',
    },
    {
        id: 'week-write-changed-by',
        file: 'admin-overrides.js',
        find: "source: 'manual', changedBy: _currentUser, replacedType,",
        replace: "source: 'manual', changedBy: data.memberName, replacedType,",
        test: unit('admin-overrides.test.mjs'),
        breaks: 'a week-grid change made on behalf is recorded as the member\'s own',
    },
    {
        id: 'week-write-authority',
        file: 'admin-overrides.js',
        find: 'if (writeMembers.some(m => !hasOverrideAuthorityFor(m))) {',
        replace: 'if (false) {',
        test: unit('admin-overrides.test.mjs'),
        breaks: 'a save goes ahead over saved changes this page never loaded, writing a duplicate of a colleague\'s day',
    },

    {
        id: 'import-write-source',
        file: 'roster-import-save.js',
        find: "note: '', source: 'roster_import', changedBy: currentUser,",
        replace: "note: '', source: 'manual', changedBy: currentUser,",
        test: unit('admin-roster-upload.test.mjs'),
        breaks: 'an imported week is filed as a manager\'s hand edit, so the next import can never correct it',
    },

    // ── A DEVICE A MEMBER HAS LEFT STOPS RECEIVING THEIR NOTICES (nav-panel.js, session.js) ─────
    {
        id: 'sign-out-releases-push',
        file: 'nav-panel.js',
        find: '            await releaseDevicePush();\n            onSignOut?.();',
        replace: '            onSignOut?.();',
        test: unit('nav-panel.test.mjs'),
        breaks: 'after signing out of a shared device, the member\'s own targeted notices keep arriving on it',
    },
    {
        id: 'expired-identity-releases-push',
        file: 'session.js',
        find: 'if (!isViewerUser(u)) await releasePushForEndingHold();',
        replace: 'if (false) await releasePushForEndingHold();',
        test: unit('session.test.mjs'),
        breaks: 'an expired session leaves the member\'s notices going to a device nobody is signed in on',
    },
    {
        id: 'relogin-releases-push',
        file: 'page-session.js',
        find: 'const relogin = () => { releasePushForEndingHold(); clearSession();',
        replace: 'const relogin = () => { clearSession();',
        test: unit('page-session.test.mjs'),
        breaks: 'a page whose identity was lost mid-visit keeps sending the member\'s notices to that device',
    },

    // ── WHAT A DAY IS SHOWN AS (calendar-renderer.js, christmas-leave.js) ──────────────────────
    {
        id: 'calendar-sunday-suppression',
        file: 'calendar-renderer.js',
        find: 'resolveDayShift(override, shift, isSunday(dateStr), christmasDue, isChristmasOrBoxingDay(dateStr));',
        replace: 'resolveDayShift(override, shift, false, christmasDue, isChristmasOrBoxingDay(dateStr));',
        test: unit('calendar-renderer.test.mjs'),
        breaks: 'a legacy Sunday leave or absence record is drawn on the Calendar — a day nobody can be on leave',
    },
    {
        id: 'day-shift-suppression',
        file: 'christmas-leave.js',
        find: 'return { ...resolveEffectiveShift(override, baseShift, sunday, christmasDay), christmasLeave: false };',
        replace: 'return { ...resolveEffectiveShift(override, baseShift, false, christmasDay), christmasLeave: false };',
        test: plain('christmas-leave.test.mjs'),
        breaks: 'every surface that draws a day shows a Sunday leave or absence record',
    },
    {
        id: 'legend-sunday-suppression',
        file: 'calendar-overrides.js',
        find: 'const { shift } = resolveDayShift(ov, baseShift, isSunday(dateStr), isChristmasLeaveDay(member, date), isChristmasOrBoxingDay(dateStr));',
        replace: 'const { shift } = resolveDayShift(ov, baseShift, false, isChristmasLeaveDay(member, date), isChristmasOrBoxingDay(dateStr));',
        test: unit('calendar-overrides.test.mjs'),
        breaks: 'the month legend lights "Annual leave" for a legacy Sunday record the grid does not draw',
    },
    {
        id: 'legend-before-start',
        file: 'calendar-overrides.js',
        find: 'const ov = isBeforeMemberStart(member, date) ? null',
        replace: 'const ov = false ? null',
        test: unit('calendar-overrides.test.mjs'),
        breaks: 'a new starter\'s legend counts a record dated before they joined',
    },
    {
        id: 'overtime-roster-before-start',
        file: 'overtime-roster.js',
        find: 'const override = isBeforeMemberStart(member, day) ? null : (overrides[date] || null);',
        replace: 'const override = (overrides[date] || null);',
        test: unit('overtime-roster.test.mjs'),
        breaks: 'the Overtime reviewer sees a shift for a member on a day before they started',
    },
    {
        id: 'overtime-roster-christmas-leave',
        file: 'overtime-roster.js',
        find: 'isSunday(date), isChristmasLeaveDay(member, day), isChristmasOrBoxingDay(date));',
        replace: 'isSunday(date), false, isChristmasOrBoxingDay(date));',
        test: unit('overtime-roster.test.mjs'),
        breaks: 'the Overtime reviewer sees a member on Christmas leave as free to work',
    },
    {
        id: 'base-shift-christmas',
        file: 'roster-data.js',
        find: "if (isChristmasRD(date)) return 'RD'; // Rule",
        replace: '// Rule',
        test: unit('roster-data.test.mjs'),
        breaks: 'a member is shown rostered to work Christmas Day, when the station is closed',
    },

    // ── MONEY (paycalc-calc.js, paycalc-year-summary.js) ───────────────────────────────────────
    {
        id: 'price-tax-after-deductions',
        file: 'paycalc-calc.js',
        find: '{ ...taxOptions, otherDeductions: ni + sl }',
        replace: '{ ...taxOptions, otherDeductions: 0 }',
        test: unit('paycalc.test.mjs'),
        breaks: 'cumulative tax can take more than the payslip leaves after NI and the loans',
    },
    {
        id: 'price-pension-before-tax',
        file: 'paycalc-calc.js',
        find: 'const sacGross = Math.max(0, gross - pension);',
        replace: 'const sacGross = Math.max(0, gross);',
        test: unit('paycalc.test.mjs'),
        breaks: 'tax and NI are worked out before the salary-sacrifice pension, so the take-home is too low',
    },
    {
        id: 'price-postgrad-stops',
        file: 'paycalc-calc.js',
        find: 'const slPost   = (pgLoan && !slPaidOff) ?',
        replace: 'const slPost   = (pgLoan) ?',
        test: unit('paycalc.test.mjs'),
        breaks: 'a Postgraduate Loan keeps being deducted after the payslip the member said deductions stopped',
    },
    // What the payslip on screen is priced ON (takeHomeInputs — out of calculate(), 25 Nov 2026).
    {
        id: 'take-home-back-pay-own-payslip',
        file: 'paycalc-calc.js',
        find: 'backPay.pNum > 0 && backPay.pNum === p.num && backPay.included',
        replace: 'backPay.pNum > 0 && backPay.included',
        test: plain('paycalc-money-banner.test.mjs'),
        breaks: 'a ticked back-pay lump is added to every payslip of the year, not the one it is paid in',
    },
    {
        id: 'take-home-back-pay-ticked',
        file: 'paycalc-calc.js',
        find: 'backPay.pNum === p.num && backPay.included) ?',
        replace: 'backPay.pNum === p.num) ?',
        test: plain('paycalc-money-banner.test.mjs'),
        breaks: 'the back-pay lump joins the take-home before the member has ticked it in',
    },
    {
        id: 'take-home-premium-ticked',
        file: 'paycalc-calc.js',
        find: 'const hppForPeriod = premium.included ? premium.amount : 0;',
        replace: 'const hppForPeriod = premium.amount;',
        test: plain('paycalc-money-banner.test.mjs'),
        breaks: 'the Holiday Pay Premium joins the January take-home before the member has ticked it in',
    },
    {
        id: 'take-home-pension-blank-default',
        file: 'paycalc-calc.js',
        find: 'pensionBox != null ? Math.max(0, pensionBox) : pensionDefault;',
        replace: 'pensionBox != null ? Math.max(0, pensionBox) : 0;',
        test: unit('paycalc.test.mjs'),
        breaks: 'a blank pension box mid-edit prices the payslip with no pension, a take-home inflated by the whole deduction',
    },
    {
        id: 'take-home-loan-stop-stored',
        file: 'paycalc-calc.js',
        find: "parseInt(slStopShown || slStopStored || '', 10)",
        replace: "parseInt(slStopShown || '', 10)",
        test: unit('paycalc.test.mjs'),
        breaks: 'a student-loan stop the payslip list no longer offers is dropped, and the loan is priced back onto every payslip',
    },
    {
        id: 'take-home-ytd-source-anchor',
        file: 'paycalc-calc.js',
        find: 'const anchored     = !!ytdSrc && p.num === ytdSrc + 1;',
        replace: 'const anchored     = !!ytdSrc;',
        test: unit('paycalc.test.mjs'),
        breaks: 'Year to Date figures are read as last payslip\'s totals on every payslip of the year, and skew its tax',
    },
    {
        id: 'year-london-pro-rated',
        file: 'paycalc-year-summary.js',
        find: 'london:   getLondonAllowanceForPeriod(p, ty) * proRate,',
        replace: 'london:   getLondonAllowanceForPeriod(p, ty),',
        test: unit('paycalc-year-summary.test.mjs'),
        breaks: 'a joiner\'s year so far counts a full London Allowance for a part period',
    },
    {
        id: 'year-pension-pro-rated',
        file: 'paycalc-year-summary.js',
        find: 'const pension  = savedPeriodPension(p, d, proRate);',
        replace: 'const pension  = savedPeriodPension(p, d, 1);',
        test: unit('paycalc-year-summary.test.mjs'),
        breaks: 'a joiner\'s year so far deducts a whole period\'s pension for a part period',
    },
    {
        id: 'year-loan-skip',
        file: 'paycalc-year-summary.js',
        find: 'slSkip: !!d.slSkip, slPaidOff: paidOff',
        replace: 'slSkip: false, slPaidOff: paidOff',
        test: unit('paycalc-year-summary.test.mjs'),
        breaks: 'the year so far deducts a loan on a payslip the member marked "not deducted this period"',
    },
    {
        id: 'year-loan-stopped',
        file: 'paycalc-year-summary.js',
        find: 'slSkip: !!d.slSkip, slPaidOff: paidOff',
        replace: 'slSkip: !!d.slSkip, slPaidOff: false',
        test: unit('paycalc-year-summary.test.mjs'),
        breaks: 'the year so far keeps deducting a loan after the payslip it stopped',
    },
    {
        id: 'year-back-pay-own-payslip',
        file: 'paycalc-year-summary.js',
        find: '((opts.bpLump && opts.bpLump.pNum === p.num) ? opts.bpLump.amount : 0)',
        replace: '((opts.bpLump) ? opts.bpLump.amount : 0)',
        test: unit('paycalc-year-summary.test.mjs'),
        breaks: 'the back-pay lump is counted on every payslip of the year, not the one it is paid on',
    },
    {
        id: 'contracted-hours-pro-rated',
        file: 'paycalc-settings.js',
        find: '  const factor = calcProRateFactor(getLoggedMember()?.startDate, p.start, p.cutoff);\n  return factor === 1',
        replace: '  const factor = 1;\n  return factor === 1',
        test: unit('paycalc-backpay.test.mjs'),
        breaks: 'a joiner is paid 140 contracted hours for the period they started part way through',
    },
    {
        id: 'pro-rate-secondment',
        file: 'paycalc-settings.js',
        find: '  if (getLoggedMember()?.noProRate) return 1;\n  return calcProRateFactor',
        replace: '  return calcProRateFactor',
        test: unit('paycalc-periods.test.mjs'),
        breaks: 'a member back from secondment has their first payslip\'s London Allowance and pension pro-rated',
    },
    {
        id: 'reset-untold-member',
        file: 'operations-reset.js',
        find: 'const untold = !takenBack && !lost && r.notified === false;',
        replace: 'const untold = false;',
        test: plain('operations-reset.test.mjs'),
        breaks: 'the admin is not told that the member whose password was reset got no notice of it',
    },
];
