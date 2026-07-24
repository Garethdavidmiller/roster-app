// Shared helpers for the Playwright specs. Extracted from smoke.spec.js when it was split
// into per-area files (v17.46) so every spec draws from one source. Imported by
// calendar.spec.js, auth.spec.js, paycalc.spec.js, pages.spec.js, responsive.spec.js.

import { enforceNamedSession } from './fixtures.js';

// Collect uncaught JS exceptions on a page. Firebase network/auth errors are
// filtered out — they're expected when running against localhost with no valid
// referrer, and the app handles them gracefully with no visible effect.
export function collectFatalErrors(page) {
    const errors = [];
    page.on('pageerror', err => {
        const msg = err.message || '';
        if (
            msg.includes('FirebaseError') ||
            msg.includes('auth/') ||
            msg.toLowerCase().includes('network request failed') ||
            msg.toLowerCase().includes('failed to fetch')
        ) return;
        errors.push(msg);
    });
    return errors;
}

// Seed a valid signed-in session before any page script runs. Shape must match
// session.js getSession(): { name, ver: SESSION_VER (2), expiry, lastActivity }.
// Also marks the time-limited password-2026 campaign notice as seen — a seeded device is
// "a device that has already dismissed it", so the calendar surface (shown to signed-in
// members ~1.5s after load, v18.78) can never pop mid-test and steal focus/clicks.
export function seedSession(page, name = 'G. Miller') {
    return page.addInitScript((n) => {
        localStorage.setItem('myb_admin_session', JSON.stringify({
            name: n,
            ver: 2,
            expiry: Date.now() + 30 * 24 * 60 * 60 * 1000,
            lastActivity: Date.now(),
        }));
        localStorage.setItem('myb_notice_password-2026_done', '1');
    }, name);
}

// Seed a chosen calendar member so index.html renders the grid instead of the first-run
// "choose your name" prompt (shown only when NO member is saved AND not signed in).
export function seedMember(page, name = 'G. Miller') {
    return page.addInitScript((n) => localStorage.setItem('myb_roster_selected_member', n), name);
}

// Select the first real grade, then its first member, and return that member's expected
// surname password (mirrors normaliseSurname: drop the initial, keep the surname,
// lowercase, strip non-alpha).
export async function pickFirstMemberAndPassword(page) {
    await page.locator('#loginGrade option').nth(1).waitFor({ state: 'attached' });
    await page.locator('#loginGrade').selectOption({ index: 1 });
    await page.locator('#loginName option').nth(1).waitFor({ state: 'attached' });
    const name = await page.locator('#loginName option').nth(1).getAttribute('value');
    await page.locator('#loginName').selectOption(name);
    const pw = name.split(' ').slice(1).join('').toLowerCase().replace(/[^a-z]/g, '');
    return { name, pw };
}

// Desktop widths exercised by the geometry checks (1024 = the desktop breakpoint edge).
export const DESKTOP_WIDTHS = [1024, 1280, 1440];

// Flip the B1 kill-switch on and force every sign-in to fail, then seed a valid local session.
export async function armEnforcementWithFailingSignIn(page, name = 'G. Miller') {
    await enforceNamedSession(page);
    await page.addInitScript(() => { window.__E2E = { failSignIn: true }; });
    await seedSession(page, name);
}

// Drive the real login overlay: find the grade that lists `fullName`, select it, type the
// surname password (mirrors normaliseSurname), submit. The fixture's default sign-in resolves.
export async function signInThroughOverlay(page, fullName) {
    await page.locator('#loginOverlay').waitFor({ state: 'visible' });
    const grades = await page.locator('#loginGrade option').evaluateAll(
        opts => opts.map(o => o.value).filter(Boolean));
    for (const g of grades) {
        await page.locator('#loginGrade').selectOption(g);
        const names = await page.locator('#loginName option').evaluateAll(opts => opts.map(o => o.value));
        if (names.includes(fullName)) break;
    }
    await page.locator('#loginName').selectOption(fullName);
    const pw = fullName.split(' ').slice(1).join('').toLowerCase().replace(/[^a-z]/g, '');
    await page.locator('#loginPassword').fill(pw);
    await page.locator('#loginSubmit').click();
}
