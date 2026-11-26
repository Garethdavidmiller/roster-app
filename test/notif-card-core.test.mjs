// @lane hygiene
/**
 * notif-card-core.test.mjs — what the Settings Notifications card says, for every device it can meet.
 * Run: node scripts/run-tests.mjs test/notif-card-core.test.mjs   (part of `npm run test:hygiene`)
 *
 * Organised by the ways the card has been WRONG, each once: a device that cannot get notifications
 * promised a list of them; an iPhone given the install steps twice (once here, once on the Install
 * card); a blocked phone sent to a padlock in "Chrome’s" address bar; the timetable change listed after
 * its one reminder had been sent. The words are a pure function, so every platform is checked here
 * without a browser; the wiring that feeds them is notif-card.test.mjs's.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { notifCardWords, timetableListed, homeScreenLabel, punctuateKinds,
    TIMETABLE_CHANGE, TIMETABLE_SEND_HOUR } from '../notif-card-core.js';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

/** A device, Android in a browser tab on the main address, with push — override what a case needs.
 *  @param {Partial<import('./notif-card-core.js').NotifDevice>} [o] @returns {import('./notif-card-core.js').NotifDevice} */
const device = (o = {}) => ({ supported: true, state: 'off-default', offByChoice: false, ios: false, android: true,
    installed: false, onMirror: false, appLabel: 'Home Label', ...o });
const IPHONE_TAB = { supported: false, state: /** @type {const} */ ('unsupported'), ios: true, android: false };

describe('a device that cannot get notifications is promised none', () => {
    test('an iPhone in a browser: "After install", the installed app\'s list, and a POINTER to the Install card', () => {
        for (const onMirror of [false, true]) {
            const w = notifCardWords(device({ ...IPHONE_TAB, onMirror }));
            assert.equal(w.chip, 'After install', `mirror ${onMirror}`);
            assert.equal(w.report, 'n/a', 'the to-do is the Install card\'s, not a second one here');
            assert.equal(w.kinds, 'after-install');
            assert.equal(w.button, null);
            // The steps live on the Install card — on the mirror too, where it starts them at the main
            // address. Two sets of instructions on one page is the regression this pins.
            assert.match(w.status, /see “Install on this device” below/, `mirror ${onMirror}`);
            assert.doesNotMatch(w.status, /Share|Add to Home Screen|web\.app/, `mirror ${onMirror}: the steps are repeated`);
            assert.match(w.status, /open it and turn notifications on there\.$/);
        }
    });
    test('the iPhone line names the app by the label under its icon, and manages without one', () => {
        assert.match(notifCardWords(device({ ...IPHONE_TAB })).status, /find Home Label \(the name under its icon\) on your Home Screen/);
        const bare = notifCardWords(device({ ...IPHONE_TAB, appLabel: null })).status;
        assert.match(bare, /open the roster from your Home Screen \(find it by the name under its icon\)/);
        assert.doesNotMatch(bare, /null|undefined/);
    });
    test('an iPhone already on the Home Screen with no push needs a newer iOS — and is listed nothing', () => {
        const w = notifCardWords(device({ ...IPHONE_TAB, installed: true }));
        assert.equal(w.status, 'Notifications need iOS 16.4 or later. Update in Settings → General → Software Update.');
        assert.equal(w.chip, 'Not available');
        assert.equal(w.kinds, 'hidden');
    });
    test('any other browser without push says so, names browsers that can — and lists nothing', () => {
        for (const o of [{ android: true }, { android: false }]) {
            const w = notifCardWords(device({ supported: false, state: 'unsupported', ...o }));
            assert.equal(w.status, 'This browser can’t show notifications from the roster — try a recent Chrome, Edge or Firefox.');
            assert.equal(w.chip, 'Not available');
            assert.equal(w.kinds, 'hidden');
            assert.equal(w.report, 'n/a');
        }
    });
    test('a device that CAN get them lists them, in every state', () => {
        for (const state of /** @type {const} */ (['on', 'off-default', 'off-lapsed', 'denied'])) {
            assert.equal(notifCardWords(device({ state })).kinds, 'shown', state);
        }
    });
});

describe('each state says what it is, and the status lines point at the member\'s own list', () => {
    test('on / off / chosen off / lapsed', () => {
        const on = notifCardWords(device({ state: 'on' }));
        assert.deepEqual([on.report, on.chip, on.button], ['ok', '✓ On', 'disable']);
        assert.equal(on.status, 'Notifications are on for this device — you’ll get each one listed above.');
        const off = notifCardWords(device());
        assert.deepEqual([off.report, off.chip, off.button], ['action', 'Off', 'enable']);
        assert.equal(off.status, 'Select “Turn on notifications” to get the ones listed above.');
        const chosen = notifCardWords(device({ offByChoice: true }));
        assert.deepEqual([chosen.report, chosen.chip, chosen.tone, chosen.button], ['ok', 'Off', 'plain', 'enable'],
            'switched off here is nothing to do, and not coloured as good news');
        const lapsed = notifCardWords(device({ state: 'off-lapsed', offByChoice: true }));
        assert.equal(lapsed.report, 'action', 'a lapse outranks an old choice: the browser lost a subscription');
        assert.match(lapsed.status, /have stopped/);
    });
    test('blocked: no button, the summary told it is blocked, and the line leads into the steps', () => {
        const w = notifCardWords(device({ state: 'denied' }));
        assert.deepEqual([w.report, w.chip, w.button], ['blocked', 'Blocked', null]);
        assert.equal(w.status, 'Notifications are blocked on this device, so this page can’t turn them on. To allow them:');
        assert.ok(w.steps);
    });
});

// ── THE PAGES MIRROR TURNS NOTHING ON (owner, 26 Nov 2026) ─────────────────────────────────────────
// A subscription made there belongs to an address that will close, and once the member turns them on at
// the main address as well they get each one twice. So off, the card sends them to the main address and
// offers no button; on, it still lets them turn notifications OFF; blocked, it still says where.
describe('on the Pages mirror, an off card sends the member to the main address', () => {
    for (const [state, offByChoice] of /** @type {const} */ ([['off-default', false], ['off-default', true], ['off-lapsed', false]])) {
        test(`${state}${offByChoice ? ', chosen' : ''}: no Turn on, and the main address as a link`, () => {
            const w = notifCardWords(device({ state, offByChoice, onMirror: true }));
            assert.equal(w.button, null, 'Turn on is offered at the address that is closing');
            assert.equal(w.report, 'n/a', 'nothing for the summary to ask of the member here');
            assert.equal(w.status + w.link?.text + w.link?.tail,
                'This is the app’s older address, which will close. Turn notifications on at myb-roster.web.app instead.');
            assert.equal(w.link?.href, 'https://myb-roster.web.app/');
            assert.equal(w.kinds, 'shown');
        });
    }
    test('on: unchanged — a member there can still turn them off', () => {
        assert.deepEqual(notifCardWords(device({ state: 'on', onMirror: true })), notifCardWords(device({ state: 'on' })));
    });
    test('blocked: unchanged — where the permission lives is true on either address', () => {
        assert.deepEqual(notifCardWords(device({ state: 'denied', onMirror: true })), notifCardWords(device({ state: 'denied' })));
    });
    test('off the mirror, no off state carries a link', () => {
        for (const state of /** @type {const} */ (['off-default', 'off-lapsed'])) assert.equal(notifCardWords(device({ state })).link, undefined, state);
    });
});

describe('a blocked device is told the route that exists on it — never assuming Chrome', () => {
    const steps = (/** @type {Partial<import('./notif-card-core.js').NotifDevice>} */ o) => notifCardWords(device({ state: 'denied', ...o })).steps;
    test('an iPhone: iOS Settings, under the name under its icon', () => {
        assert.deepEqual(steps({ ios: true, android: false, installed: true }),
            { text: 'On iPhone or iPad: open Settings → Notifications, find Home Label (the name under its icon), and turn on Allow Notifications.' });
        assert.deepEqual(steps({ ios: true, android: false, installed: true, appLabel: null }),
            { text: 'On iPhone or iPad: open Settings → Notifications, find this app by the name under its icon, and turn on Allow Notifications.' });
    });
    test('an Android tab: the address bar\'s icon, whichever browser draws it', () => {
        assert.deepEqual(steps({}),
            { text: 'On Android: tap the icon at the left of the address bar (a padlock or two sliders) → Site settings → Notifications → Allow.' });
    });
    test('the installed Android app, which has no address bar: the phone\'s own settings', () => {
        assert.deepEqual(steps({ installed: true }),
            { text: 'On Android: open your phone’s Settings → Apps, find this app by its home screen name, and turn on Notifications.' });
    });
    test('a computer: Chrome\'s route kept on one line, and a pointer for every other browser', () => {
        const s = /** @type {any} */ (steps({ android: false }));
        assert.equal(s.route, 'Site settings → Notifications → Allow');
        assert.match(s.lead, /^In Chrome: .*\u00a0→ $/, 'the arrow keeps to the word before it (a no-break space)');
        assert.equal(s.tail, '. In another browser, look in its settings for this site’s notifications.');
    });
});

describe('the timetable change is listed until its one reminder is sent, and never after', () => {
    // December is GMT, so London's clock is UTC's: the eve of Sunday 13 December 2026 is the 12th.
    const at = (/** @type {string} */ iso) => timetableListed(new Date(iso));
    test('before the evening, and AT the send', () => {
        assert.equal(at('2026-11-22T10:00:00Z'), true);
        assert.equal(at('2026-12-12T17:59:00Z'), true);
        assert.equal(at('2026-12-12T18:00:00Z'), true, 'up to and including the send');
    });
    test('after the send, on the day of the change, and in a later year', () => {
        assert.equal(at('2026-12-12T18:01:00Z'), false);
        assert.equal(at('2026-12-13T09:00:00Z'), false);
        assert.equal(at('2027-12-11T09:00:00Z'), false, 'the same calendar day a year on is AFTER it');
    });
    test('London\'s date, not the phone\'s zone: 23:30 UTC on the 12th is still the 12th in London', () => {
        assert.equal(at('2026-12-12T23:30:00Z'), false, 'past 18:00 London');
        assert.equal(at('2026-12-11T23:30:00Z'), true);
    });
    test('the client copy is the date and hour the server sends on (functions/documents.js)', () => {
        const fn = readFileSync(new URL('./functions/documents.js', REPO_ROOT_URL), 'utf8');
        const m = /const TIMETABLE_CHANGE = Object\.freeze\(\{ year: (\d{4}), month: (\d{1,2}), day: (\d{1,2}) \}\)/.exec(fn);
        assert.ok(m, 'premise: TIMETABLE_CHANGE is where this test expects it');
        assert.deepEqual({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }, { ...TIMETABLE_CHANGE },
            'the card would list a change the server is not sending, or stop listing one it is');
        const run = /const sendTimetableReminder = onSchedule\(\s*\{\s*schedule:\s*'(\d+) (\d+) \* \* \*',\s*timeZone:\s*'Europe\/London'/.exec(fn);
        assert.ok(run, 'premise: the reminder\'s daily London schedule was found');
        assert.equal(Number(run[2]), TIMETABLE_SEND_HOUR, 'the card stops listing it at a different hour from the send');
        assert.equal(Number(run[1]), 0, 'the send is on the hour');
    });
});

describe('the app is named by the label under its icon, read from the page', () => {
    test('read from the meta, trimmed; null when it is missing or empty', () => {
        const doc = (/** @type {string|null} */ content) => ({ querySelector: (/** @type {string} */ sel) =>
            (sel === 'meta[name="apple-mobile-web-app-title"]' && content !== null ? { getAttribute: () => content } : null) });
        assert.equal(homeScreenLabel(doc('  Label  ')), 'Label');
        assert.equal(homeScreenLabel(doc('')), null);
        assert.equal(homeScreenLabel(doc(null)), null);
        assert.equal(homeScreenLabel(null), null);
    });
    test('Settings carries the meta it is read from, so the iPhone advice has a name to give', () => {
        const meta = /<meta name="apple-mobile-web-app-title" content="([^"]+)">/.exec(readFileSync(new URL('./settings.html', REPO_ROOT_URL), 'utf8'));
        assert.ok(meta?.[1], 'settings.html has no apple-mobile-web-app-title — the advice falls back to "the name under its icon"');
    });
    test('no app name is written into the card\'s own words (app-name-parity covers the rest)', () => {
        const src = readFileSync(new URL('./notif-card-core.js', REPO_ROOT_URL), 'utf8');
        assert.doesNotMatch(src, /\bMYB\b/);
    });
});

describe('the listed kinds end on a kind, never on a separator', () => {
    test('every kind but the last carries " ·"', () => {
        assert.deepEqual(punctuateKinds(['Daily Huddle ·', 'Weekly Retail Circular ·', 'Marylebone Newsletter ·']),
            ['Daily Huddle ·', 'Weekly Retail Circular ·', 'Marylebone Newsletter']);
        assert.deepEqual(punctuateKinds(['A', 'B']), ['A ·', 'B']);
        assert.deepEqual(punctuateKinds([]), []);
    });
});
