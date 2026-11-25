// @ts-check
// @lane unit
/**
 * calendar-notif-prompt.test.mjs — the two ACCESS rules behind the Calendar's notification strip.
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs test/calendar-notif-prompt.test.mjs   (part of test:unit)
 *
 * WHY THIS FILE EXISTS (v24.28 review). module-coverage-parity counted calendar-notif-prompt.js as
 * named only because a COMMENT in coordinator-ratchet.test.mjs mentions it. Nothing loaded it — and
 * headless Chromium has no push service, so the e2e suite can never reach it either (calendar.spec.js
 * says so and forces the strip on by hand). Yet its header states two rules with real teeth:
 *
 *   1. RENEWAL never runs under the shared Calendar viewer — it re-stamps a subscription's owner with
 *      the current uid, which under the PIN is the same uid on every office PC.
 *   2. THE PROMPT is offered to named (and open-mode) sessions only — a subscription made under the
 *      viewer belongs to an identity fifty people share.
 *
 * Both are pinned here through the real `initNotifPrompt`, with notif.js and ls.js stubbed.
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

let renewals = 0;
/** What `enableNotifications` answers — notif.js's own states. @type {string} */
let enableResult = 'on';
let enables = 0;
/** @type {Record<string, string>} */
let store = {};
mock.module('../notif.js', { namedExports: {
    notifSupported: () => true,
    getNotifState: () => { renewals++; return Promise.resolve('on'); },
    enableNotifications: () => { enables++; return Promise.resolve(enableResult); },
} });
mock.module('../ls.js', { namedExports: {
    lsGet: (/** @type {string} */ k) => store[k] ?? null,
    lsSet: (/** @type {string} */ k, /** @type {string} */ v) => { store[k] = v; },
} });

/** @type {Record<string, any>} */
let els;
/** @param {{ hidden?: boolean, textContent?: string }} [init] */
function btn(init = {}) {
    /** @type {Record<string, Function>} */
    const on = {};
    return { on, style: { display: '' }, hidden: false, textContent: '', ...init,
             addEventListener: (/** @type {string} */ t, /** @type {Function} */ f) => { on[t] = f; } };
}
globalThis.document = /** @type {any} */ ({ getElementById: (/** @type {string} */ id) => els[id] ?? null });
/** What the system's permission prompt answers. */
let permissionAnswer = 'denied';
globalThis.Notification = /** @type {any} */ ({ permission: 'default', requestPermission: async () => permissionAnswer });
globalThis.requestAnimationFrame = /** @type {any} */ ((/** @type {Function} */ f) => setTimeout(f, 0));

mock.module('../install-prompt.js', { namedExports: { installNoticeHasTheVisit: () => false } });   // v24.96: the strip's yield, not under test here
/** Who is signed in — the offer's wording asks (17 Nov 2026). @type {{ name: string } | null} */
let session = null;
mock.module('../session.js', { namedExports: { getSession: () => session } });
const { initNotifPrompt } = await import('../calendar-notif-prompt.js');
const { NOTIF_PROMPT_DONE } = await import('../storage-keys.js');
// The REAL roster and the REAL audience rule (pay-audience.js), so the strip is asked exactly as the page
// asks it. Members are chosen by grade here, never written down by name.
const { teamMembers } = await import('../roster-data.js');
/** The first current member of a grade, by name. @param {string} role */
const aMemberOf = (role) => /** @type {string} */ (teamMembers.find(m => m.role === role && !m.hidden && !m.managerOnly)?.name);

/** Let the authReady `.then` chains run. */
const settle = () => new Promise(r => setTimeout(r, 0));

/** The strip's failure line as index.html has it — read from the markup, so a test cannot pass on a
 *  line the page does not carry. */
const HTML = readFileSync(new URL('./index.html', REPO_ROOT_URL), 'utf8');
const FAILED_LINE = (/<span id="notifPromptFailedLine">([\s\S]*?)<\/span><\/span>/.exec(HTML)?.[1] ?? '')
    .replace(/<[^>]+>/g, '').trim();

/** The strip's elements as index.html starts them. */
const freshEls = () => ({ notifPrompt: btn(), notifPromptEnable: btn(), notifPromptDismiss: btn(),
    notifPromptOffer: btn(), notifPromptFailed: btn({ hidden: true }),
    notifPromptFailedLine: btn({ textContent: FAILED_LINE }), ariaAnnouncer: btn(),
    notifPromptOfferDocs: btn(), notifPromptOfferPay: btn({ hidden: true }) });

beforeEach(() => {
    renewals = 0;
    enables = 0;
    enableResult = 'on';
    permissionAnswer = 'denied';
    store = {};
    els = freshEls();
    /** @type {any} */ (globalThis.Notification).permission = 'default';
    session = null;
});

/** Show the strip to `name`, signed in, and say whether it promised the pay reminder. @param {string} name */
async function promisesPay(name) {
    els = freshEls();
    session = { name };
    initNotifPrompt({ authReady: Promise.resolve(), getAccessType: () => 'named' });
    await settle();
    assert.equal(els.notifPrompt.style.display, 'flex', 'premise: the strip is shown');
    return !els.notifPromptOfferPay.hidden;
}

// ── THE PAY REMINDER IS OFFERED TO THE MEMBERS IT IS SENT TO (whole-app check, 17 Nov 2026) ────────
// Since 10 Nov 2026 the reminder goes to CEA and CES only (functions/pay-reminder.js), and the strip went
// on offering it to everybody: a Dispatcher or a manager turned notifications on for a reminder that
// never comes. It shows the pay ending only where the Pay Calculator prices the member, as the server does.
describe('the offer names the pay reminder only to a member it is sent to', () => {
    for (const [role, gets] of /** @type {const} */ ([['CEA', true], ['CES', true], ['Dispatcher', false]])) {
        test(`a ${role} member is offered ${gets ? 'the documents and the pay reminder' : 'the documents alone'}`, async () => {
            const name = aMemberOf(role);
            assert.ok(name, `premise: the roster has a current ${role} member`);
            session = { name };
            initNotifPrompt({ authReady: Promise.resolve(), getAccessType: () => 'named' });
            await settle();
            assert.equal(els.notifPrompt.style.display, 'flex', 'premise: the strip is shown');
            assert.equal(els.notifPromptOfferPay.hidden, !gets, `${role}: the pay reminder ${gets ? 'was left out' : 'was promised'}`);
            assert.equal(els.notifPromptOfferDocs.hidden, gets, 'and exactly one ending shows');
        });
    }

    // AS THE SERVER DECIDES IT (18 Nov 2026). The strip asked the grade held TODAY; the server sends to
    // the RECORDED role of a visible row (functions/pay-reminder.js). So a CES whose move into
    // management was released was promised the reminder until the move's first day, and a hidden leaver
    // for good. Invented members, added to the real roster for the one test, so the rule is pinned
    // whatever the roster holds this week.
    test('a released move out of a priced grade, a hidden leaver and a login-only row are not promised it — a visible CEA is', async () => {
        const later = new Date(); later.setHours(0, 0, 0, 0); later.setDate(later.getDate() + 3);
        const invented = [
            { name: 'A. Person', role: 'Management', hidden: true, rosterType: 'fixed', currentWeek: 1,
              roleHistory: [{ role: 'CES', until: later }] },   // still CES today, by the dates
            { name: 'Q. Example', role: 'CEA', hidden: true, rosterType: 'main', currentWeek: 1 },
            { name: 'C. Login', role: 'CES', managerOnly: true, rosterType: 'fixed', currentWeek: 1 },   // a login-only row
            { name: 'B. Sample', role: 'CEA', rosterType: 'main', currentWeek: 1 },
        ];
        teamMembers.push(...invented);
        try {
            assert.equal(await promisesPay('A. Person'), false, 'a member whose move into management is released was promised the pay reminder');
            assert.equal(await promisesPay('Q. Example'), false, 'a hidden leaver was promised the pay reminder');
            assert.equal(await promisesPay('C. Login'), false, 'a login-only row is on neither of the server\'s lists');
            assert.equal(await promisesPay('B. Sample'), true, 'premise: a visible CEA is promised it');
        } finally {
            teamMembers.splice(teamMembers.length - invented.length, invented.length);
        }
    });

    test('every row on the roster is promised the pay reminder exactly where the server\'s own list sends it', async () => {
        // The server's lists are generated from the same table (scripts/generate-roster-members.mjs) and
        // checked against it by sw-asset-check.test.mjs, so this is the server's answer, read as it reads
        // it. A disagreement is reported by row and shape, never by name.
        const server = JSON.parse(readFileSync(new URL('./functions/roster-members.json', REPO_ROOT_URL), 'utf8'));
        const sentTo = new Set([...server.cea, ...server.ces]);
        assert.ok(sentTo.size > 0, 'premise: the server sends the reminder to somebody');
        const wrong = [];
        for (const [i, m] of teamMembers.entries()) {
            if (await promisesPay(m.name) !== sentTo.has(m.name)) wrong.push(`row ${i} (${m.role}${m.hidden ? ', hidden' : ''}${m.managerOnly ? ', login only' : ''})`);
        }
        assert.deepEqual(wrong, [], 'the strip and the server disagree about who is sent the pay reminder');
    });

    test('in the markup: the ending without the pay reminder shows until the module says otherwise', () => {
        const offer = /<span class="top-prompt-text" id="notifPromptOffer">([\s\S]*?)<\/span>\s*\n/.exec(HTML)?.[1] ?? '';
        assert.match(offer, /<span id="notifPromptOfferDocs"> and other documents<\/span>/);
        assert.match(offer, /<span id="notifPromptOfferPay" hidden>, documents and pay reminders<\/span>/);
    });
});

describe('rule 1 — renewal never runs under the shared viewer', () => {
    for (const [access, expected] of /** @type {const} */ ([['named', 1], ['viewer', 0], ['none', 0]])) {
        test(`permission granted, ${access} session → ${expected ? 'renews' : 'writes nothing'}`, async () => {
            /** @type {any} */ (globalThis.Notification).permission = 'granted';
            initNotifPrompt({ authReady: Promise.resolve(), getAccessType: () => access });
            await settle();
            assert.equal(renewals, expected);
            assert.equal(els.notifPrompt.style.display, '', 'a granted device is never shown the prompt');
        });
    }
});

describe('rule 2 — the prompt is offered to named sessions, never to the viewer', () => {
    test('a named session sees the strip', async () => {
        initNotifPrompt({ authReady: Promise.resolve(), getAccessType: () => 'named' });
        await settle();
        assert.equal(els.notifPrompt.style.display, 'flex');
    });

    test('the shared viewer does not', async () => {
        initNotifPrompt({ authReady: Promise.resolve(), getAccessType: () => 'viewer' });
        await settle();
        assert.equal(els.notifPrompt.style.display, '');
    });

    test('an answered device is never asked again', async () => {
        store[NOTIF_PROMPT_DONE] = '1';
        initNotifPrompt({ authReady: Promise.resolve(), getAccessType: () => 'named' });
        await settle();
        assert.equal(els.notifPrompt.style.display, '');
    });

    test('× hides it and records the answer', async () => {
        initNotifPrompt({ authReady: Promise.resolve(), getAccessType: () => 'named' });
        await settle();
        els.notifPromptDismiss.on.click();
        assert.equal(els.notifPrompt.style.display, 'none');
        assert.equal(store[NOTIF_PROMPT_DONE], '1');
    });
});

describe('Enable is answered, not just acted on (cal-docs-5, whole-app review 10 Nov 2026)', () => {
    // The system grants, the subscription fails ('off-lapsed' — no signal, or a push service that
    // would not register). The strip used to have gone already, and with permission now 'granted' it
    // is never offered again: the member believed notifications were on.

    /** Show the strip to a member, tap Enable, and let every await run. @param {() => string} [access] */
    async function tapEnable(access = () => 'named') {
        initNotifPrompt({ authReady: Promise.resolve(), getAccessType: access });
        await settle();
        assert.equal(els.notifPrompt.style.display, 'flex', 'the strip was offered');
        permissionAnswer = 'granted';
        const done = els.notifPromptEnable.on.click();
        /** @type {any} */ (globalThis.Notification).permission = 'granted';
        await done;
        await settle();
    }

    test('granted but not switched on: the strip comes back saying so — and says it aloud', async () => {
        enableResult = 'off-lapsed';
        await tapEnable();
        assert.equal(enables, 1);
        assert.equal(els.notifPrompt.style.display, 'flex', 'the strip is back, not gone for good');
        assert.equal(els.notifPromptOffer.hidden, true, 'the offer line has stood down');
        assert.equal(els.notifPromptFailed.hidden, false, 'the failure line is shown');
        assert.ok(FAILED_LINE.length > 0, 'the markup carries the line');
        assert.equal(els.ariaAnnouncer.textContent, FAILED_LINE, 'and the Calendar\'s announcer speaks it');
    });

    // WHO RECORDS THE ANSWER (17 Nov 2026 — the rule file said "both Enable and × set it", and this
    // module sets it only on a no). Enable answers it for good in two places: here when the system
    // says no, and in notif.js once the subscription is SAVED (notif.test.mjs pins that half). Never
    // in between: a granted permission whose subscription failed must leave the strip free to return.
    test('asked and declined: the answer is recorded here, so the strip is never offered again', async () => {
        initNotifPrompt({ authReady: Promise.resolve(), getAccessType: () => 'named' });
        await settle();
        permissionAnswer = 'denied';
        await els.notifPromptEnable.on.click();
        assert.equal(store[NOTIF_PROMPT_DONE], '1', 'a member who said no would be asked again on every visit');
        assert.equal(enables, 0, 'a declined permission must not try to subscribe');
    });

    test('granted but the subscription failed: nothing here records the answer', async () => {
        enableResult = 'off-lapsed';
        await tapEnable();
        assert.equal(store[NOTIF_PROMPT_DONE], undefined,
            'the answer was recorded before the subscription was saved — a failed one could not come back');
    });

    test('granted and switched on: the strip stays gone, and nothing is announced', async () => {
        enableResult = 'on';
        await tapEnable();
        assert.equal(els.notifPrompt.style.display, 'none');
        assert.equal(els.notifPromptFailed.hidden, true);
        assert.equal(els.ariaAnnouncer.textContent, '');
    });

    test('a Calendar re-locked while the system asked is not shown the strip again', async () => {
        enableResult = 'off-lapsed';
        let access = 'named';
        initNotifPrompt({ authReady: Promise.resolve(), getAccessType: () => access });
        await settle();
        permissionAnswer = 'granted';
        const done = els.notifPromptEnable.on.click();
        access = 'none';                          // the lock card is up now
        await done;
        await settle();
        assert.equal(els.notifPrompt.style.display, 'none', 'the strip would sit above the lock card');
    });

    test('the failure line names where to try later, as one unbreakable route — and so does every route the Calendar tells', () => {
        // shared.css `.nav-path`: without it the wrap can land between ☰ and →, leaving a line that
        // starts "→ Settings". Every "☰ →" route in the page's markup is held to it (the Team View tip
        // was one until 22 Nov 2026; css-shared lead, whole-app review 10 Nov 2026).
        assert.match(HTML, /<span class="top-prompt-text" id="notifPromptFailed" hidden>/,
            'the failure line is in the markup, hidden until it is needed');
        assert.match(FAILED_LINE, /☰ → Settings/);
        const routes = [...HTML.matchAll(/☰ →/g)].map(m => m.index ?? 0);
        // The Team View tip's "☰ → Daily Huddle" went with the duplicated About tips (lightbox review, 22 Nov
        // 2026): the strip's own route is the one left, and any route added later is held to the same rule.
        assert.ok(routes.length >= 1, 'the strip\'s route, at least');
        for (const at of routes) {
            assert.match(HTML.slice(Math.max(0, at - 40), at), /class="nav-path">$/,
                `a route told without .nav-path: …${HTML.slice(at - 30, at + 25)}…`);
        }
    });
});
