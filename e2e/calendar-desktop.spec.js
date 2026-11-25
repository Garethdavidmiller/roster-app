/**
 * calendar-desktop.spec.js — the Calendar (index.html): the desktop audit (CAL1–CAL12) and the header
 * from 768px.
 *
 * Split by feature out of calendar.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one calendar-*.spec.js file needs is in calendar-helpers.js. Every file keeps the old file's
 * `beforeEach`, so each test still starts signed in as a member. The Calendar's access gate is
 * calendar-access.spec.js.
 */
import { test, expect } from './fixtures.js';
import { seedSession, seedCalendarMember, seedMemberSession, isTouchProject } from './helpers.js';

// ── Calendar access ─────────────────────────────────────────────────────────────────────────────
// The Calendar opens only for a signed-in member (since the staff PIN was retired, 23 Nov 2026; from
// v20.12 the PIN opened it too), so a spec that simply loads index.html gets the sign-in card and none
// of the roster. Every test in this file is about what the Calendar DOES once it is open, not about
// the gate, so each page starts signed in as a member with no calendar picked on this device
// (`seedCalendarMember`) — the member's own calendar. Until the PIN went it started on a PIN viewer,
// whose `getSession()` was null; the tests that existed only for that state (the first-run prompt,
// the station PC's Team View and bug report) went with it. The gate itself is calendar-access.spec.js.
test.beforeEach(async ({ page }) => { await seedCalendarMember(page); });

// ══ THE DESKTOP AUDIT (Nov 2026) ═══════════════════════════════════════════════════════════════════
// The Calendar had been reviewed through a phone; these are what a laptop and a large screen showed.
// One test per finding, each measuring what a member sees (a contrast, a position, a size) rather
// than that a rule exists, and each mutation-checked: reverting its fix fails it.

/** Puts `__rgb` (any CSS colour → the sRGB bytes a canvas paints) and `__contrast` (the WCAG ratio
 *  of two opaque colours) on the page, so oklch, color-mix and rgba all compare as painted.
 *  @param {import('@playwright/test').Page} page */
function installColourProbe(page) {
    return page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        w.__rgb = (/** @type {string} */ c) => {
            const ctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'));
            ctx.fillStyle = c;
            ctx.fillRect(0, 0, 1, 1);
            return [...ctx.getImageData(0, 0, 1, 1).data];
        };
        w.__contrast = (/** @type {string} */ a, /** @type {string} */ b) => {
            const lum = (/** @type {number[]} */ rgb) => rgb.slice(0, 3)
                .map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
                .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
            const [hi, lo] = [lum(w.__rgb(a)), lum(w.__rgb(b))].sort((x, y) => y - x);
            return (hi + 0.05) / (lo + 0.05);
        };
        w.__sameColour = (/** @type {string} */ a, /** @type {string} */ b) => JSON.stringify(w.__rgb(a)) === JSON.stringify(w.__rgb(b));
        /** What a CSS expression resolves to on this page, read back off a throwaway element. */
        w.__resolve = (/** @type {string} */ prop, /** @type {string} */ value, /** @type {string} */ read) => {
            const probe = document.createElement('i');
            probe.style.setProperty(prop, value);
            document.body.append(probe);
            const out = getComputedStyle(probe).getPropertyValue(read);
            probe.remove();
            return out;
        };
    });
}

/** The page's painted colours on `el` once its transitions have finished — a reading mid-fade is
 *  neither the old colour nor the new. @param {import('@playwright/test').Locator} loc */
const settledPaint = (loc) => loc.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)).then(() => {
    const cs = getComputedStyle(el);
    return { fg: cs.color, bg: cs.backgroundColor, transform: cs.transform };
}));

// CAL1 — the Pay button's hover fill was the pale print gold under white text: 1.03:1, the label gone
// the moment the pointer arrived. Pay's own darker green now, as the day panel's Pay button.
test('desktop: the Pay button keeps its label under the pointer', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'there is no hover on a touch screen');
    await page.setViewportSize({ width: 1366, height: 768 });
    await installColourProbe(page);
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const pay = page.locator('#payBtn');
    const rest = await settledPaint(pay);
    await pay.hover();
    const hover = await settledPaint(pay);
    expect(hover.bg, 'premise: the hover state is what was measured').not.toBe(rest.bg);
    const ratio = await page.evaluate(([fg, bg]) => /** @type {any} */ (window).__contrast(fg, bg), [hover.fg, hover.bg]);
    expect(ratio, `"Pay" is ${ratio.toFixed(2)}:1 on its hover fill`).toBeGreaterThanOrEqual(4.5);
});

// The Pay button opens the payslip PAID in the month on screen — the 💷 in its grid (owner, 10 Nov
// 2026: "it defaults to December's payslip when we haven't had November's yet"). The calculator
// read the month as the payslip whose SHIFTS covered the 15th, which from November 2026 is paid the
// month after. The rule is `periodPaidInMonth` (unit-tested); this drives the button, because the
// rule is only the answer if the page asks it.
test('the Pay button opens the payslip paid in the month on screen, not the month after', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-10T09:00:00Z'));
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('#payBtn').click();
    await page.waitForURL(/paycalc\.html\?month=2026-11$/);
    const picker = page.locator('#periodSelect');
    await expect(picker.locator('option').first()).toBeAttached();
    await expect.poll(() => picker.evaluate(s => /** @type {HTMLSelectElement} */ (s).selectedOptions[0]?.textContent),
        'November\'s payslip, still to be paid — the ● one — not 18 Dec').toBe('● Paid 20 November 2026 · P36');
});

// CAL2 — the desktop controls are ONE centred row, and Team view used to remove the month's half of
// it, so everything slid ~200px: the click after Team landed on 📝 Admin (a double-click on Team
// opened Admin at every desktop width), the click after Month on Next →. The slot is now kept.
for (const width of [1024, 1366, 1920]) {
    test(`desktop: the Team/Month toggle stays under the pointer at ${width}px, and a double-click is not a trip to Admin`, async ({ page }, info) => {
        test.skip(isTouchProject(info), 'a pointer that stays where it clicked');
        await page.setViewportSize({ width, height: 800 });
        await seedMemberSession(page, 'G. Miller');
        await page.goto('/');
        await expect(page.locator('.calendar-day').first()).toBeVisible();
        const box = /** @type {{x: number, y: number, width: number, height: number}} */ (await page.locator('#teamViewBtn').boundingBox());
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        const under = () => page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('button')?.id ?? null, [x, y]);

        await page.mouse.click(x, y);
        await expect(page.locator('.team-week-text')).toBeVisible();
        await expect(page.locator('#prevMonth'), 'the month row stays on show in Team view').toBeHidden();
        expect(await under(), 'after Team, the pointer is over another control').toBe('teamViewBtn');
        await page.mouse.click(x, y);
        await expect(page.locator('.calendar-day').first()).toBeVisible();
        expect(await under(), 'after Month, the pointer is over another control').toBe('teamViewBtn');

        await page.mouse.dblclick(x, y);
        await expect(page.locator('.calendar-day').first(), 'a double-click is two toggles: back on the month').toBeVisible();
        expect(new URL(page.url()).pathname, 'a double-click on Team left the Calendar').not.toMatch(/admin/);
    });
}

// CAL3 — the day cells' keyboard ring was gold, drawn inside the cell: 1.0:1 on today's gold and
// 1.3–1.5:1 on the pale days. Navy, outside the cell, is read against the card whatever the day.
test('desktop: a keyboard-focused day has a navy ring outside it, against the card', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a keyboard');
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await page.setViewportSize({ width: 1366, height: 768 });
    await installColourProbe(page);
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('.calendar-day.today')).toBeVisible();
    await page.locator('.month-year').focus();
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        const el = /** @type {Element} */ (document.activeElement);
        const cs = getComputedStyle(el);
        const card = getComputedStyle(/** @type {Element} */ (document.querySelector('.calendar-container'))).backgroundColor;
        return { today: el.classList.contains('today'), keyboard: el.matches(':focus-visible'), style: cs.outlineStyle,
            offset: parseFloat(cs.outlineOffset), navy: w.__sameColour(cs.outlineColor, w.__resolve('color', 'var(--primary-blue)', 'color')),
            onCard: w.__contrast(cs.outlineColor, card) };
    });
    expect(ring, 'Tab from the month heading lands on today, by keyboard').toMatchObject({ today: true, keyboard: true, style: 'solid' });
    expect(ring.navy, 'the ring is not the light-surface navy').toBe(true);
    expect(ring.offset, 'the ring is drawn inside the cell, on the day\'s own colour').toBeGreaterThanOrEqual(0);
    expect(ring.onCard, `the ring is ${ring.onCard.toFixed(2)}:1 on the card`).toBeGreaterThanOrEqual(3);
});

// CAL5 — a 1366×768 laptop's browser window is about 1366×650, and the last week of a five-row month
// sat wholly below its fold (the row floor meant to help could never apply: a row is as tall as its
// tallest cell's content, and every row as tall as the tallest). A short window keeps the desktop's
// cell and tightens only its spacing (v26.02). 1280×672 is a 1920×1200 laptop at Windows' 150%:
// until v26.02 the badge and the time shared a line there that an Early badge or today's cell could
// not fit, and the cell that stacked made every row 75px, so August's last week ended 72px below this
// window. Measured at v26.02, the same at both sizes: July ends at 574px with its legend at 634, August
// at 641. Today's cell is the reason for 20–24px of that: see `.calendar-day.today` in the block.
for (const [width, height] of /** @type {const} */ ([[1366, 650], [1280, 672]])) {
    for (const [month, when, rows] of /** @type {const} */ ([['July 2026', '2026-07-15T09:00:00Z', 5], ['August 2026', '2026-08-18T09:00:00Z', 6]])) {
        test(`desktop: the whole month fits a laptop window, ${width}×${height} — ${month}, ${rows} rows`, async ({ page }, info) => {
            test.skip(isTouchProject(info), 'a laptop window');
            await page.clock.setFixedTime(new Date(when));
            await page.setViewportSize({ width, height });
            await seedMemberSession(page, 'G. Miller');
            await page.goto('/');
            await expect(page.locator('.calendar-day.today')).toBeVisible();
            const g = await page.evaluate(() => {
                const cells = [...document.querySelectorAll('.calendar-day')];
                return { cells: cells.length, scrolled: window.scrollY, vh: innerHeight,
                    last: cells[cells.length - 1].getBoundingClientRect().bottom,
                    legend: /** @type {Element} */ (document.querySelector('.legend')).getBoundingClientRect().bottom };
            });
            expect(g.cells, `${month} draws ${rows} weeks`).toBe(rows * 7);
            expect(g.scrolled).toBe(0);
            expect(g.last, `the last week ends ${Math.round(g.last - g.vh)}px below the window`).toBeLessThanOrEqual(g.vh);
            if (rows === 5) expect(g.legend, 'with five rows the legend is on screen too').toBeLessThanOrEqual(g.vh);
        });
    }
}

// The owner, from a laptop (13 Nov 2026): "it looks fine on a desktop PC but on this laptop the
// calendar looks weird". A short window put the badge and the time side by side — and stacked them
// again wherever a cell was too narrow for that, so at 1280px one month drew two kinds of day. Every
// day now has the desktop's order at every short size: the date, the badge beneath it, the time
// beneath that. Today is an Early with a time on purpose: its 3px border made it the first to stack.
for (const [width, height] of /** @type {const} */ ([[1024, 600], [1280, 672], [1366, 650]])) {
    test(`desktop: a short window draws every day as the desktop does, date over badge over time, at ${width}×${height}`, async ({ page }, info) => {
        test.skip(isTouchProject(info), 'a laptop window');
        await page.clock.setFixedTime(new Date('2026-11-13T09:00:00Z'));
        await page.setViewportSize({ width, height });
        await seedMemberSession(page, 'G. Miller');
        await page.addInitScript(() => {
            const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
            w.__E2E.docs = [12, 13].map(d => ({ id: 'early' + d, memberName: 'G. Miller', date: `2026-11-${d}`,
                type: 'shift', value: '06:20-14:20', note: '' }));
        });
        await page.goto('/');
        await expect(page.locator('.calendar-day.today .shift-time')).toHaveText('06:20-14:20');
        const days = await page.evaluate(() => [...document.querySelectorAll('.calendar-day:not(.other-month)')]
            .filter(c => c.querySelector('.shift-time'))
            .map(c => {
                const box = (/** @type {string} */ s) => /** @type {Element} */ (c.querySelector(s)).getBoundingClientRect();
                const date = box('.day-number'), badge = box('.shift-badge'), time = box('.shift-time');
                return { day: c.querySelector('.day-number')?.textContent,
                    stacked: badge.top >= date.bottom - 1 && time.top >= badge.bottom - 1 };
            }));
        expect(days.length, 'premise: the month has days that show a time').toBeGreaterThan(10);
        expect(days.filter(d => !d.stacked).map(d => d.day), 'days whose badge and time share a line').toEqual([]);
    });
}

// A short cell's badge line starts ~22px down, under the corner marks: at the desktop's size and
// height a bank holiday's ⭐ ran onto the right end of a badge as wide as the desktop's (v26.02).
test('desktop: on a short window the corner marks clear the badge beneath them', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a laptop window');
    await page.clock.setFixedTime(new Date('2026-12-16T09:00:00Z'));
    await page.setViewportSize({ width: 1024, height: 600 });
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('.calendar-day.bank-holiday').first()).toBeVisible();
    const marks = await page.evaluate(() => [...document.querySelectorAll('.calendar-day.bank-holiday, .calendar-day.payday, .calendar-day.cutoff')]
        .filter(c => c.querySelector('.shift-badge'))
        .map(c => {
            const mark = getComputedStyle(c, '::before'), size = parseFloat(mark.fontSize);
            const line = mark.lineHeight === 'normal' ? size * 1.2 : parseFloat(mark.lineHeight);
            const bottom = c.getBoundingClientRect().top + parseFloat(getComputedStyle(c).borderTopWidth) + parseFloat(mark.top) + line;
            return { day: c.querySelector('.day-number')?.textContent,
                gap: /** @type {Element} */ (c.querySelector('.shift-badge')).getBoundingClientRect().top - bottom };
        }));
    expect(marks.length, 'premise: December has bank holidays, a payday and a cut-off with a badge').toBeGreaterThanOrEqual(4);
    expect(marks.filter(m => m.gap < 0), 'a corner mark reaches into the badge beneath it').toEqual([]);
});

// CAL6 + CAL10 — a desktop cell held a phone's 10px badge word and 11px time, and the Team view a
// phone's 11px everywhere, with the name column's 88px phone cap cutting two names short at 1024px.
test('desktop: the cells and the Team week read at desktop sizes, and nothing is cut short at 1024px', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a desktop window');
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await page.setViewportSize({ width: 1024, height: 768 });
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('.calendar-day.today')).toBeVisible();
    const token = (/** @type {string} */ name) => page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

    const month = await page.evaluate(() => {
        const cells = [...document.querySelectorAll('.calendar-day:not(.other-month)')];
        const fs = (/** @type {string} */ s) => getComputedStyle(/** @type {Element} */ (document.querySelector(`.calendar-day ${s}`))).fontSize;
        // A cell clips what overflows it, so "fits" is measured on the words themselves.
        const cut = cells.filter(c => [...c.querySelectorAll('.shift-badge, .shift-time')].some(e => {
            const r = document.createRange(); r.selectNodeContents(e);
            const t = r.getBoundingClientRect(), box = c.getBoundingClientRect();
            return t.left < box.left || t.right > box.right || t.bottom > box.bottom;
        })).length;
        return { time: fs('.shift-time'), badge: fs('.shift-badge'), cut };
    });
    expect(month.time, 'the time is body text on a desktop').toBe(await token('--type-body'));
    expect(month.badge, 'the badge word is badge-sized on a desktop').toBe(await token('--type-badge'));
    expect(month.cut, 'a badge or a time runs out of its cell').toBe(0);

    await page.locator('#teamViewBtn').click();
    await expect(page.locator('.team-table tbody tr').nth(15)).toBeAttached();
    const team = await page.evaluate(() => {
        const fs = (/** @type {string} */ s) => getComputedStyle(/** @type {Element} */ (document.querySelector(s))).fontSize;
        const cut = [...document.querySelectorAll('.team-table tbody th.tv-name-col')].filter(th => {
            const r = document.createRange(); r.selectNodeContents(th);
            const cs = getComputedStyle(th);
            return r.getBoundingClientRect().width > th.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) + 0.5;
        }).map(th => th.textContent);
        return { name: fs('.team-table tbody th.tv-name-col'), cell: fs('.tv-cell'), day: fs('.team-table thead th:nth-child(2)'), cut };
    });
    const small = await token('--type-small');
    expect(team, 'the Team week reads a step up from the phone\'s 11px').toMatchObject({ name: small, cell: small, day: small });
    expect(team.cut, 'a name in the Team week is cut short').toEqual([]);
});

// CAL7 — the header logo is a Tab stop, and so is the ✕ on each glass panel; none had a ring of its
// own, so each fell back to the shared navy one — on navy. They wear the light ring now.
test('desktop: the header logo wears the light focus ring, and the glass panels\' ✕ the gold one', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a keyboard');
    await page.setViewportSize({ width: 1366, height: 768 });
    await installColourProbe(page);
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const ring = () => page.evaluate(() => {
        const w = /** @type {any} */ (window);
        const el = /** @type {Element} */ (document.activeElement);
        const cs = getComputedStyle(el);
        return { at: el.id || el.className, keyboard: el.matches(':focus-visible'), style: cs.outlineStyle,
            light: w.__sameColour(cs.outlineColor, w.__resolve('outline', 'var(--focus-outline-light)', 'outline-color')),
            gold: w.__sameColour(cs.outlineColor, w.__resolve('outline', 'var(--focus-outline-gold)', 'outline-color')) };
    });

    await page.locator('#navMenuBtn').focus();
    await page.keyboard.press('Tab');
    // The header's controls take the light ring (the burger's); a control INSIDE a navy panel takes
    // gold, as the drawer, About and the day panel's own buttons do.
    expect(await ring(), 'the header logo').toEqual({ at: 'title-icon', keyboard: true, style: 'solid', light: true, gold: false });

    /** @type {Array<[string, () => Promise<void>, string]>} */
    const panels = [
        ['dayDetailClose', () => page.locator('.calendar-day:not(.other-month)').nth(10).click(), '#dayDetailLightbox'],
        ['alLightboxClose', () => page.locator('#alBtn').click(), '#alLightbox'],
        // Team Week View's ? is the white Tips panel since 25 Nov 2026, whose ✕ keeps a white dialog's navy ring.
    ];
    for (const [close, open, panel] of panels) {
        await open();
        await expect(page.locator(panel)).toHaveClass(/\bopen\b/);
        await page.keyboard.press('Tab');                       // the panel's first stop is its ✕
        expect(await ring(), `the ✕ on ${panel}`).toEqual({ at: close, keyboard: true, style: 'solid', light: false, gold: true });
        await page.keyboard.press('Escape');
        await expect(page.locator(panel)).not.toHaveClass(/\bopen\b/);
    }
});

// CAL8 — in Team view the toggle wore the chosen gold and announced "pressed" while its word named
// the OTHER view. It is an action in both views: navy, never pressed, named for where it goes.
test('the Team toggle is an action in both views: navy, never pressed, named for where it goes', async ({ page }) => {
    await installColourProbe(page);
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const btn = page.locator('#teamViewBtn');
    const state = async () => {
        await page.mouse.move(1, 1);                             // a hover is a different fill
        const { bg } = await settledPaint(btn);
        return btn.evaluate((el, fill) => ({ pressed: el.getAttribute('aria-pressed'), active: el.classList.contains('active'),
            navy: /** @type {any} */ (window).__sameColour(fill, /** @type {any} */ (window).__resolve('color', 'var(--primary-blue)', 'color')) }), bg);
    };
    expect(await state(), 'the month view').toEqual({ pressed: null, active: false, navy: true });
    await btn.click();
    await expect(btn).toContainText('Month');
    await expect(btn, 'it names the view it goes back to').toHaveAccessibleName(/month/i);
    expect(await state(), 'the Team view').toEqual({ pressed: null, active: false, navy: true });
});

// CAL9 — today's rule comes after the hover's at equal specificity, so its scale replaced the lift
// and today was the one day that did not move under the pointer.
test('desktop: today lifts under the pointer like every other day', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'there is no hover on a touch screen');
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    const today = page.locator('.calendar-day.today');
    await expect(today).toBeVisible();
    const lift = async () => {
        const { transform } = await settledPaint(today);
        return page.evaluate(t => new DOMMatrixReadOnly(t).f, transform);   // the page's own parser
    };
    await page.mouse.move(1, 1);
    expect(await lift(), 'at rest today sits in place').toBe(0);
    await today.hover();
    expect(await lift(), 'under the pointer today does not lift').toBeLessThan(0);
});

// CAL11 — the month cancelled the context menu for every pointer, so a desktop lost the browser's
// right-click menu over the whole grid. A long press on a touch screen is still refused its menu; a
// right press no longer starts a swipe either, since its menu can take the pointerup that ends one.
test('desktop: a right-click on the month gets the browser\'s menu; a long press on a touch screen does not', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a mouse');
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.evaluate(() => {
        document.addEventListener('contextmenu', e => { /** @type {any} */ (window).__menuRefused = e.defaultPrevented; });
    });
    const cell = page.locator('.calendar-day:not(.other-month)').nth(10);
    const box = /** @type {{x: number, y: number, width: number, height: number}} */ (await cell.boundingBox());
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'right' });
    expect(await page.evaluate(() => document.querySelectorAll('.carousel-panel').length), 'a right press began a swipe').toBe(0);
    await page.mouse.up({ button: 'right' });
    expect(await page.evaluate(() => /** @type {any} */ (window).__menuRefused), 'the right-click menu was refused').toBe(false);
    await expect(page.locator('#dayDetailLightbox'), 'a right-click is not a click').not.toHaveClass(/\bopen\b/);

    // A long press: its pointerdown, then the menu it asks for. Synthetic, because a desktop engine
    // has no touch to press with — it is the handler's decision being tested, not the platform.
    const refused = await cell.evaluate(el => {
        el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', isPrimary: true, bubbles: true }));
        const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        el.dispatchEvent(menu);
        el.dispatchEvent(new PointerEvent('pointercancel', { pointerType: 'touch', isPrimary: true, bubbles: true }));
        return menu.defaultPrevented;
    });
    expect(refused, 'a long press opened a menu in the middle of the swipe gesture').toBe(true);
});

// CAL12 — 📍 was the only control without a word; on a desktop it says "Today", and its name (which
// already said "today") still contains what is shown. A phone's row has no room for the word. The
// Team view's help names no gesture a mouse cannot make, bar the line that is touch-only.
test('desktop: 📍 says "Today" beside it, and the Team view help is not all taps', async ({ page }) => {
    await seedMemberSession(page, 'G. Miller');
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/');
    const btn = page.locator('#todayBtn');
    await expect(btn).toBeVisible();
    expect((await btn.innerText()).trim(), 'the word beside 📍').toMatch(/Today$/);
    await expect(btn, 'what is shown is in the name, for a voice user').toHaveAccessibleName(/today/i);
    await page.locator('#teamViewBtn').click();
    await page.locator('#teamHelpBtn').click();
    const help = await page.locator('#tipsLbBody .tips-lb-item').allTextContents();
    await page.locator('#tipsLightboxClose').click();
    await page.locator('#teamViewBtn').click();
    expect(help.length).toBeGreaterThan(2);
    expect(help.filter(t => /^\s*Tap\b/.test(t)), 'the help tells a mouse user to tap').toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    expect((await btn.innerText()).trim(), 'a phone has no room for the word').toBe('📍');
});

// X1 — the Calendar draws its own header, and a hop from it to any other page rearranged the
// header: 62px against 72, a 32px logo against 40, the title 24px/700 against 20px/800, a gradient
// canvas against flat navy. The width differs by decision (--page-max-width); nothing else may.
// FROM 768px, which is where shared.css's `.app-header` takes these numbers — so a tablet either way
// up, not only a desktop. 768 is the boundary the Calendar's own ≤768px block shares, the
// width where source order decides; 800 is a tablet in portrait. Below 768 the two headers still
// differ, and a phone on its side keeps the Calendar's compact header: neither is in this contract.
for (const [width, height] of [[768, 1024], [800, 1280], [1366, 768]]) {
    test(`from 768px the Calendar's header is every other page's header, metric for metric — ${width}px`, async ({ page }, info) => {
        test.skip(width > 1023 && isTouchProject(info), 'a desktop window');
        await page.setViewportSize({ width, height });
        await seedMemberSession(page, 'G. Miller');
        const measure = () => page.evaluate(() => {
            const header = /** @type {Element} */ (document.querySelector('.header, .app-header'));
            const logo = /** @type {Element} */ (header.querySelector('img'));
            const h1 = /** @type {Element} */ (header.querySelector('h1'));
            const burger = /** @type {Element} */ (header.querySelector('.btn-burger'));
            const range = document.createRange(); range.selectNodeContents(h1);
            const words = /** @type {DOMRect} */ ([...range.getClientRects()].pop());   // the title's line, past the logo
            const h = header.getBoundingClientRect(), l = logo.getBoundingClientRect(), b = burger.getBoundingClientRect();
            const cs = getComputedStyle(h1), body = getComputedStyle(document.body);
            return { top: Math.round(h.top), height: Math.round(h.height), logo: [Math.round(l.width), Math.round(l.height)],
                gap: Math.round(words.left - l.right), titleTop: Math.round(words.top), size: cs.fontSize, weight: cs.fontWeight,
                // Where the burger sits inside its header: the one control both headers share, in the same place.
                burger: [Math.round(b.left - h.left), Math.round(b.top - h.top)],
                canvas: `${body.backgroundImage} ${body.backgroundColor}` };
        });
        await page.goto('/');
        await expect(page.locator('.calendar-day').first()).toBeVisible();
        const calendar = await measure();
        await page.goto('/settings.html');
        await expect(page.locator('.app-header h1')).toBeVisible();
        expect(calendar, `the Calendar's header against Settings' at ${width}px`).toEqual(await measure());
    });
}

// …and a phone on its SIDE is not a tablet. 915×412 is wider than 768, but the landscape block keeps
// the compact header there so the month fits a 412px-tall screen — the tablet rule must not reach it.
test('a phone on its side keeps the Calendar\'s compact header, wider than 768px or not', async ({ page }) => {
    await page.setViewportSize({ width: 915, height: 412 });
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const header = await page.evaluate(() => {
        const h = /** @type {Element} */ (document.querySelector('.header')).getBoundingClientRect();
        const l = /** @type {Element} */ (document.querySelector('.title-icon')).getBoundingClientRect();
        return { height: Math.round(h.height), logo: Math.round(l.width),
            size: getComputedStyle(/** @type {Element} */ (document.querySelector('.header h1'))).fontSize };
    });
    expect(header, 'the landscape block\'s header: 8px of padding round the burger, a 26px logo, 16px type')
        .toEqual({ height: 46, logo: 26, size: '16px' });
});

test('the Calendar\'s header logo opens no image menu when held', async ({ page }) => {
    // The sub-pages' logo was cured of this in the iPhone audit (e2e/trains.spec.js, the same check)
    // and the Calendar's, a separate element with its own rule, was not: IPHONE_RELEASE_CHECKLIST asks
    // for no image menu on a held header logo. `user-select` is read off the element; the iOS-only
    // `-webkit-touch-callout` from the stylesheet the page loaded, which neither test engine parses.
    await seedSession(page, 'G. Miller');
    await page.goto('/index.html');
    const logo = page.locator('.title-icon').first();
    await expect(logo).toBeVisible();
    expect(await logo.evaluate(el => getComputedStyle(el).userSelect), 'holding the logo starts a text selection')
        .toBe('none');
    const rule = await page.evaluate(async () => {
        const css = await (await fetch('./index.css')).text();
        return css.replace(/\/\*[\s\S]*?\*\//g, '').match(/\.title-icon\s*\{([^}]*)\}/)?.[1] ?? '';
    });
    expect(rule, 'the header-logo rule was not found in index.css, so this checks nothing').toContain('height: 32px');
    expect(rule, 'holding the logo opens iOS\'s image menu').toMatch(/-webkit-touch-callout:\s*none/);
});
