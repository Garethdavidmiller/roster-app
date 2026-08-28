// axe.spec.js — automated accessibility gate.
//
// Runs the axe-core engine against ONE representative, fully-rendered state of every page
// (the review's recommendation: scan a real state, not the pre-load blank page). It is a
// FLOOR — axe catches the machine-checkable ~third of WCAG issues (labels, names, contrast,
// ARIA, duplicate ids), not everything — so it complements, never replaces, a manual
// screen-reader pass. NOT part of `npm test`; run with `npm run test:a11y`.
//
// When a violation is a conscious, documented trade-off rather than a bug, waive it by id in
// GLOBAL_WAIVERS (with a reason) rather than weakening the scan.

// test/expect come from fixtures.js (NOT @playwright/test) so the hermetic Firebase stub is
// installed — otherwise the SDK-dependent pages never render and the scan can't reach them.
import { test, expect, enableCalendarPin } from './fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { seedSession, seedMember, seedViewerAccess, stubPinExchange, enterPin } from './helpers.js';

// ── Calendar access (v20.12) ────────────────────────────────────────────────────────────────────
// Since v20.12 the Calendar opens only for a member session or the shared staff PIN, so a spec that
// simply loads index.html now gets the unlock card and none of the roster. Every test in this file
// is about what the Calendar DOES once it is open, not about the gate, so each page starts with a
// viewer session already in place — the state an unlocked shared office PC is in, and the closest
// match to what these tests were implicitly written against (roster on screen, `getSession()` null).
// The gate itself is covered end-to-end in calendar-pin.spec.js.
// A test that also seeds a member session still gets the member: the stub ranks them that way,
// exactly as `decideAccess` does.
// The staff PIN is switched OFF in the shipped config while the feature is deployed dark
// (v20.17). Turn it on here so these keep covering the configuration the app is heading for,
// and seed a viewer session to satisfy it — otherwise every calendar test silently starts
// running against the old open model and the gate goes untested.
test.beforeEach(async ({ page }) => { await enableCalendarPin(page); await seedViewerAccess(page); });

// ── The one-time notice is suppressed by default, and scanned deliberately instead ───────────────
// `sign-in-2026` opens on the Calendar 1,500ms after load, on a fade transition, for exactly the
// audience these scans seed (a member with no session). Every scan of `/` therefore raced it, and
// under full-suite load the race was sometimes lost: axe caught the overlay PART-WAY THROUGH its
// fade and reported four SERIOUS colour-contrast failures against a background that only exists for
// a few hundred milliseconds. The card is clean once settled — verified, and now asserted below.
//
// So the notice is turned off for the scans that are about something else, and gets one scan of its
// own that waits for it. That is strictly more coverage than before: an intermittent failure nobody
// could reproduce becomes a deterministic assertion of the state it was accidentally sampling.
// If a later notice appears on another page, suppress it here the same way.
test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        try { localStorage.setItem('myb_notice_sign_in_2026_done', '1'); } catch (_) { /* noop */ }
    });
});


// WCAG 2.0 + 2.1, levels A and AA — the standard staff-facing target.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Rules waived everywhere, each with a reason. Keep this list SHORT and justified — a waiver is
// a decision to accept a known gap, not a way to silence noise.
const GLOBAL_WAIVERS = [];

/**
 * Run axe against the current page state and return the violations, most-impactful first.
 * @param {import('@playwright/test').Page} page
 * @param {string[]} [pageWaivers]  extra rule ids to disable for this page only
 */
async function scan(page, { pageWaivers = [], exclude = [] } = {}) {
    // ── NEVER SCAN THROUGH THE SPLASH (v21.35) ──────────────────────────────────────────────────
    //
    // The Calendar's splash fades for 400ms and is then REMOVED from the DOM. While it fades it is
    // a full-screen navy panel with white text lying over whatever is underneath, so axe measures
    // `#splash-title` against the card behind it and reports a SERIOUS colour-contrast violation —
    // for a state that lasts under half a second and that `pointer-events: none` already makes
    // untouchable. There is no defect to fix in the app: nobody reads that frame.
    //
    // It surfaced on WebKit in CI, where the runner is slow enough that the scan lands inside the
    // fade. Locally it never reproduced, which is exactly why the wait belongs HERE rather than in
    // the one test that happened to catch it: seven scans load `/`, all seven have the same race,
    // and the other six pass today only because whatever they wait for outlasts the fade.
    //
    // Waiting for DETACHMENT, not for `.hidden` — the class goes on at the START of the fade, so
    // waiting on it would still leave the whole 400ms in front of us.
    await page.locator('#splash').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {
        // Pages other than the Calendar have no splash, and `detached` resolves immediately for an
        // element that never existed. A timeout here means one genuinely never came down — let the
        // scan run and report whatever it finds rather than failing with a harness error.
    });
    let builder = new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .disableRules([...GLOBAL_WAIVERS, ...pageWaivers]);
    for (const sel of exclude) builder = builder.exclude(sel);
    const results = await builder.analyze();
    return results.violations;
}

/** Render a violation list into a readable failure message. */
function report(violations) {
    if (!violations.length) return '';
    const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
    const sorted = [...violations].sort((a, b) => (order[a.impact] ?? 9) - (order[b.impact] ?? 9));
    return '\n' + sorted.map(v => {
        const nodes = v.nodes.slice(0, 3).map(n => `      - ${n.target.join(' ')}`).join('\n');
        const more = v.nodes.length > 3 ? `\n      …+${v.nodes.length - 3} more` : '';
        return `  [${(v.impact || '?').toUpperCase()}] ${v.id}: ${v.help}\n    ${v.helpUrl}\n${nodes}${more}`;
    }).join('\n\n') + '\n';
}

// Tagged @a11y. GREEN + BLOCKING since v17.52 — part of `npm run test:e2e` (a new WCAG A/AA
// violation fails the suite); `npm run test:a11y` runs it standalone on chromium. Baseline + the one
// documented exclusion (calendar `.other-month`) are in A11Y_FINDINGS.md.
test.describe('accessibility (axe-core)', { tag: '@a11y' }, () => {
    test('calendar (index.html)', async ({ page }) => {
        await seedMember(page);
        await page.goto('/');
        await expect(page.locator('.calendar-day').first()).toBeVisible();
        // Exclude the adjacent-month day numbers: they are deliberately very faint (the "not this
        // month" cue) AND `aria-hidden` (never announced), so darkening them to meet AA would defeat
        // the design for zero screen-reader benefit. Documented in A11Y_FINDINGS.md.
        const v = await scan(page, { exclude: ['.other-month'] });
        expect(v.length, report(v)).toBe(0);
    });

    // The LOCKED Calendar (v20.12). The one state a visitor with no session and no PIN ever sees,
    // and it would be invisible to every other scan in this file — they all establish access first.
    // It is also the app's front door for anyone who has never used it, which is exactly the
    // audience least able to work around an accessibility fault.
    test('calendar — staff PIN unlock card', async ({ page }) => {
        await page.addInitScript(() => {
            try { sessionStorage.removeItem('__e2e_viewer'); } catch (_) { /* noop */ }
        });
        await page.goto('/');
        await expect(page.locator('#calLockPin')).toBeVisible();
        const v = await scan(page);
        expect(v.length, report(v)).toBe(0);
    });

    test('calendar — unlock card showing an ERROR', async ({ page }) => {
        // The error message is the one piece of this card that is announced rather than read, and it
        // arrives after the page has settled — so a scan of the resting state cannot see it. Colour
        // contrast on the error text is checked here and nowhere else.
        await page.addInitScript(() => {
            try { sessionStorage.removeItem('__e2e_viewer'); } catch (_) { /* noop */ }
        });
        await stubPinExchange(page, { status: 401 });
        await page.goto('/');
        await enterPin(page, '0000');
        await expect(page.locator('#calLockMsg')).toContainText(/not recognised/i);
        const v = await scan(page);
        expect(v.length, report(v)).toBe(0);
    });

    test('calendar — the MEMBER sign-in card (v20.79)', async ({ page }) => {
        // The other card a locked Calendar can show: a member whose Firebase identity is gone gets
        // their own sign-in rather than a shared code. Different markup (no field, two buttons, a
        // live message region), so the PIN scans above say nothing about it.
        await seedSession(page, 'G. Miller');
        await page.addInitScript(() => {
            try { sessionStorage.removeItem('__e2e_viewer'); } catch (_) { /* noop */ }
            window.__E2E = Object.assign(window.__E2E || {}, { failSignIn: true });
        });
        await page.goto('/');
        await expect(page.locator('#calLockPinInstead')).toBeVisible();
        await expect(page.locator('#calLockSubmit')).toBeEnabled({ timeout: 20_000 });
        const v = await scan(page);
        expect(v.length, report(v)).toBe(0);
    });

    test('admin (signed in)', async ({ page }) => {
        await seedSession(page);
        await page.goto('/admin.html');
        await page.waitForSelector('.day-row', { timeout: 10000 });
        const v = await scan(page);
        expect(v.length, report(v)).toBe(0);
    });

    // ── Forced transient/interactive states the settled-page scans above can never reach.
    // Added v17.57 after a state-sweep review: the active Rest Day pill was a REAL shipped AA
    // failure (white on bright --orange, 2.15:1 — invisible to a one-settled-state gate). The
    // sync-chip "failures" the same sweep reported turned out to be FALSE positives (measured
    // against the navy page header; the chip actually sits inside the white calendar card) —
    // the chip test below now guards both states against the real composited background.

    test('calendar sync-chip states (forced)', async ({ page }) => {
        await seedMember(page);
        await page.goto('/');
        await expect(page.locator('.calendar-day').first()).toBeVisible();
        // Recreate both chips exactly as calendar-initial-fetch.js builds them, in their real
        // parent (.calendar-header) so the composited navy background is authentic.
        await page.evaluate(() => {
            const header = document.querySelector('.calendar-header');
            const loading = document.createElement('button');
            loading.type = 'button'; loading.className = 'sync-chip'; loading.disabled = true;
            loading.textContent = '↻ Updating your shifts…';
            const error = document.createElement('button');
            error.type = 'button'; error.className = 'sync-chip sync-chip-error';
            error.textContent = '⚠ Couldn’t update — tap to retry';
            header?.append(loading, error);
        });
        const v = await scan(page, { exclude: ['.other-month'] });
        expect(v.length, report(v)).toBe(0);
    });

    test('admin type-pills in the ACTIVE state (forced)', async ({ page }) => {
        await seedSession(page);
        await page.goto('/admin.html');
        await page.waitForSelector('.day-row', { timeout: 10000 });
        // Force one pill of EACH type active (the collector normally allows one per row; forcing
        // all in one row is fine for a colour scan — .active sets the fill + white text).
        await page.evaluate(() => {
            const row = document.querySelector('.day-row');
            row?.querySelectorAll('.type-pill-btn').forEach(p => p.classList.add('active'));
        });
        const v = await scan(page);
        expect(v.length, report(v)).toBe(0);
    });

    test('paycalc (signed in)', async ({ page }) => {
        await seedSession(page);
        await page.addInitScript(() => {
            localStorage.setItem('myb_pc_ns_migrated', '1');
        });
        await page.goto('/paycalc.html');
        await expect(page.locator('#settingsCard')).toBeVisible();
        await page.waitForTimeout(500);
        const v = await scan(page);
        expect(v.length, report(v)).toBe(0);
    });

    test('operations (admin, signed in)', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.goto('/operations.html');
        await expect(page.locator('#huddleUploadCard')).toBeVisible();
        const v = await scan(page);
        expect(v.length, report(v)).toBe(0);
    });

    test('settings (signed in)', async ({ page }) => {
        await seedSession(page);
        await page.goto('/settings.html');
        await expect(page.locator('#contactToggleHeader')).toBeVisible();
        const v = await scan(page);
        expect(v.length, report(v)).toBe(0);
    });

    test('overtime — member form (signed in)', async ({ page }) => {
        // Scanned with the FORM RENDERED, not the empty shell: seven day groups of mode buttons is
        // the only state on this page with any structure to get wrong.
        const NOW = Date.parse('2026-08-17T09:00:00Z');
        await seedSession(page, 'G. Miller');
        await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
        await page.route('**/getMyOvertimeState', r => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, serverNow: NOW, windows: [{
                weekEnding: '2026-09-05', weekStart: '2026-08-30',
                initialDeadlineAt: Date.parse('2026-08-18T11:00:00Z'), draftRosterDate: '2026-08-20',
                finalDeadlineAt: Date.parse('2026-08-25T11:00:00Z'), finalRosterDate: '2026-08-27',
                retentionUntil: Date.parse('2026-12-05T00:00:00Z'), policyVersion: 1,
                audience: 'restricted', phase: 'INITIAL_OPEN',
                participant: { grade: 'CEA', rosterOrder: 2 }, submission: null,
            }] }),
        }));
        await page.route('**/getOvertimeManagerOverview', r => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, serverNow: NOW, planningWeeks: [], retained: [] }),
        }));
        await page.goto('/overtime.html');
        await expect(page.locator('.ot-day')).toHaveCount(7);
        const v = await scan(page);
        expect(v.length, report(v)).toBe(0);
    });

    test('overtime — reviewer workspace (signed in)', async ({ page }) => {
        // THE OTHER HALF OF THIS PAGE, and until v21.51 it was never scanned at all.
        //
        // "One rendered state per page" is the right rule almost everywhere, but this page carries
        // two surfaces for two audiences, and the member's form is the one that shares its idioms
        // with the rest of the app. Everything unique to the reviewer — the navy day-panel headers,
        // the grade and glance strips, the answer chips, the counts — lived outside every gate.
        // The colour-contrast failure that motivated this scan (a light-surface grey used on a navy
        // header, 3.75:1) sat in a shipped release with a green a11y gate above it.
        const NOW = Date.parse('2026-08-17T09:00:00Z');
        const W = {
            weekEnding: '2026-09-05', weekStart: '2026-08-30',
            initialDeadlineAt: Date.parse('2026-08-18T11:00:00Z'), draftRosterDate: '2026-08-20',
            finalDeadlineAt: Date.parse('2026-08-25T11:00:00Z'), finalRosterDate: '2026-08-27',
            retentionUntil: Date.parse('2026-12-05T00:00:00Z'), policyVersion: 1,
            audience: 'restricted',
        };
        const dates = Array.from({ length: 7 }, (_, i) =>
            new Date(Date.UTC(2026, 7, 30 + i)).toISOString().slice(0, 10));
        const rest = Object.fromEntries(dates.map(d => [d, { mode: 'unavailable' }]));
        const at = Date.parse('2026-08-16T08:00:00Z');
        await seedSession(page, 'H. Croft');
        await page.addInitScript(({ rest, at, dates }) => {
            window.__E2E = { ...(window.__E2E || {}), authUser: true, docsByPath: {
                // TWO grades and a mixed answer set on purpose: it is what makes the grade strip,
                // all three day sections and both answer tones render at once. A single-grade week
                // draws no grade strip, and an all-answered week draws no "No response".
                participants: [
                    { id: 'T. Bibi', grade: 'CEA', rosterOrder: 2, createdAt: at },
                    { id: 'J. Sumaili', grade: 'CES', rosterOrder: 18, createdAt: at }],
                submissions: [{ id: 'T. Bibi', currentRevision: 1, firstAcceptedAt: at,
                    updatedAt: at, days: { ...rest, [dates[0]]: { mode: 'all_day' } } }],
            } };
        }, { rest, at, dates });
        await page.route('**/getMyOvertimeState', r => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, serverNow: NOW, windows: [] }),
        }));
        await page.route('**/getOvertimeManagerOverview', r => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, serverNow: NOW, retained: [], planningWeeks: [
                { ...W, exists: true, state: 'created', canCreate: false,
                  expected: 2, received: 1, noResponse: 1 },
                { ...W, weekEnding: '2026-09-12', exists: false, state: 'not-created', canCreate: true },
            ] }),
        }));
        await page.goto('/overtime.html');
        // Both the horizon and the week detail, so the scan covers the whole reviewer surface.
        await expect(page.locator('#otWeekContent')).toContainText('T. Bibi');
        await expect(page.locator('.ot-day-panel--muted')).not.toHaveCount(0);
        const v = await scan(page);
        expect(v.length, report(v)).toBe(0);
    });

    test('links (designer, signed in)', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.addInitScript(() => localStorage.setItem('myb_links_welcome_seen', '1'));
        await page.goto('/links.html');
        await expect(page.locator('#generatorToggleHeader')).toBeVisible();
        const v = await scan(page);
        expect(v.length, report(v)).toBe(0);
    });

    /**
     * The SAME page with a design LOADED (v19.57) — and it is a different page in every way that
     * matters to this gate.
     *
     * The scan above renders the EMPTY state. Measured, it contains **0 grid cells, 0 heat-map cells
     * and 0 check rows**: the workspace's entire content — a 196-cell grid, an hourly heat map, a
     * 24-row analysis panel — had never been through the accessibility gate at all, because none of
     * it exists until a design is in memory. The gate was green on a page with nothing on it.
     *
     * Loading one immediately surfaced 29 colour-contrast failures at 10px bold, two of which had
     * been shipped for months (`heat-b4` at 2.59:1, `heat-b5` at 4.33:1) and one of which was four
     * days old (`dem-b5` at 3.14:1). All four are fixed; this is what stops them coming back.
     *
     * The lesson generalises past this page: a gate that only ever sees a state with no data in it
     * is measuring the shell, not the app.
     */
    test('links WITH a design loaded — the grid, heat map and checks the empty state never renders', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.addInitScript(() => {
            localStorage.setItem('myb_links_welcome_seen', '1');
            // A shape with real variety: every heat bucket populated (so every contrast pair is
            // actually rendered), spares, a Sunday, and a rest day — a uniform design would leave
            // most of the ramp unscanned and pass for the wrong reason.
            const starts = ['06:20-14:20', '07:00-15:00', '08:00-16:00', '11:00-19:00',
                '14:00-22:00', '15:55-23:55'];
            const patterns = /** @type {any} */ ({});
            for (let i = 1; i <= 28; i++) {
                const s = starts[i % starts.length];
                patterns[String(i)] = {
                    sun: (i % 4 === 0) ? '07:15-15:15' : 'RD',
                    mon: s, tue: s, wed: s, thu: s,
                    fri: (i % 5 === 0) ? 'RD' : s,
                    sat: (i % 3 === 0) ? 'SPARE' : 'RD',
                };
            }
            const w = /** @type {any} */ (window);
            w.__E2E = w.__E2E || {};
            w.__E2E.docs = [{ id: 'd1', name: 'Design A', patterns,
                updatedAt: 1_750_000_000_000, updatedBy: 'S. Silva' }];
        });
        await page.goto('/links.html');
        // Wait for the content itself, not the shell — the whole point of this test.
        await expect(page.locator('.cov-heat')).toBeVisible();
        await expect(page.locator('.cov-demand')).toBeVisible();
        expect(await page.locator('.shift-cell-btn').count(),
            'the grid must actually be rendered, or this scan is the empty-state scan again')
            .toBeGreaterThan(100);
        expect(await page.locator('#checksContent .check-row').count()).toBeGreaterThan(10);

        const v = await scan(page);
        expect(v.length, report(v)).toBe(0);
    });

    // ── Open-overlay states (H2, v17.75) — the settled-page scans above never OPEN these
    // surfaces. A11Y_FINDINGS.md's promotion path calls for scanning more rendered states
    // ("an open lightbox, an error state") per page; each of these is a full interactive
    // surface (focus trap, buttons, headings) a one-settled-state gate can't reach.

    test('login overlay (forced, signed out)', async ({ page }) => {
        // settings.html shows the shared in-place sign-in overlay when no session exists — the
        // first thing an unauthenticated staff member meets, previously unscanned by the gate.
        await page.goto('/settings.html');
        await expect(page.locator('#loginOverlay')).toBeVisible();
        const v = await scan(page);
        expect(v.length, report(v)).toBe(0);
    });

    test('nav drawer open (calendar)', async ({ page }) => {
        await seedMember(page);
        await page.goto('/');
        await expect(page.locator('.calendar-day').first()).toBeVisible();
        await page.locator('#navMenuBtn').click();
        await expect(page.locator('#navPanel')).toBeVisible();
        // The calendar grid stays in the DOM behind the drawer → keep the .other-month exclusion.
        const v = await scan(page, { exclude: ['.other-month'] });
        expect(v.length, report(v)).toBe(0);
    });

    test('About lightbox open (calendar)', async ({ page }) => {
        await seedMember(page);
        await page.goto('/');
        await expect(page.locator('.calendar-day').first()).toBeVisible();
        await page.locator('.title-icon').first().click();   // calendar header logo → About
        await expect(page.locator('#iconLightbox')).toBeVisible();
        const v = await scan(page, { exclude: ['.other-month'] });
        expect(v.length, report(v)).toBe(0);
    });

    test('one-time notice open (calendar) — the state the other scans used to sample by accident', async ({ page }) => {
        // The re-enable must be registered AFTER every suppression — the file-level beforeEach AND
        // `seedMember`, which sets the same key itself (the calendar specs had this race too, so
        // the suppression moved into the helper). Init scripts run in registration order and last
        // write wins, which is the whole mechanism here; putting the remove before seedMember is
        // how this test silently reverted to scanning a notice that never opens.
        //
        // A notice is the app's only overlay that opens on a timer rather than on a tap, which is
        // what made it a race for everything else and why it needs its own scan: dark glass over a
        // translucent card, every text colour an rgba white, so contrast here is decided by what is
        // composited BEHIND it — the one arrangement in the app where a scan of some other page
        // proves nothing at all.
        await seedMember(page);
        await page.addInitScript(() => {
            try { localStorage.removeItem('myb_notice_sign_in_2026_done'); } catch (_) { /* noop */ }
        });
        await page.goto('/');
        await expect(page.locator('.calendar-day').first()).toBeVisible();
        await expect(page.locator('#signInNoticeLb')).toHaveClass(/\bopen\b/, { timeout: 15_000 });
        await page.waitForTimeout(600);      // let the fade finish — mid-transition is the bug
        const v = await scan(page, { exclude: ['.other-month'] });
        expect(v.length, report(v)).toBe(0);
    });

    // Static guide pages — no auth, no async state.
    for (const guide of ['guide.html', 'paycalc-guide.html', 'railcard-guide.html', 'fip.html', 'rangers-guide.html']) {
        test(`guide (${guide})`, async ({ page }) => {
            await page.goto(`/${guide}`);
            await expect(page.locator('h1').first()).toBeVisible();
            const v = await scan(page);
            expect(v.length, report(v)).toBe(0);
        });
    }
});
