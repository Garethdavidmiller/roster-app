// @ts-check
/**
 * nav-destinations.js — WHERE the drawer can take you, as data: the page pills, the Latest documents,
 * the Reference guides, the App Notices section colours, and the one rule for which pills a person sees.
 *
 * Moved out of nav-panel.js (Nov 2026) so the lists are IMPORTED rather than read as text. About
 * fourteen regexes in the test suite used to parse these arrays out of nav-panel.js's source, so a
 * reformatted line, a reordered key or a quote style changed what a parity test saw without changing
 * the app — and a test that cannot read the list fails as "re-anchor me", or worse, passes on half of
 * it. Imports nothing, so it loads in Node and in every page alike (`notice-archive.js` is the
 * precedent). nav-panel.js renders these; it decides nothing here.
 *
 * ── THE PILL GATES ──────────────────────────────────────────────────────────────────────────────
 *
 * A pill a member may not open is FILTERED, not refused (`.claude/rules/nav-drawer.md`), and hiding
 * one is never the boundary — each page guards itself and the server refuses the rest. `PILL_GATES`
 * names each flag a `NAV_PAGES` entry can carry and the gate it reads; `visiblePills` is the one place
 * the filter runs. The gate values come from `navGatesFor` (`auth-policy.js`), which every page spreads
 * into `initNavPanel`, so the pill and the page policy are answered from one place — and
 * `nav-gates.test.mjs` holds the two to the same answer for every member, in both directions.
 */

/**
 * Page navigation destinations. The current page is NOT omitted — it renders as an inert
 * `aria-current` pill (see `visiblePills` and nav-panel.js's `_inject`), so the row is the same shape
 * on every page and the drawer doubles as a map rather than a list of exits.
 * colorClass is the page's own colour, Admin's navy with gold text (css-tokens.md → "A page is one
 * colour and one emoji"); `label` is its emoji and name, which its header and About badges repeat.
 * `name` — the page's full name where the pill's is short ("Pay"): the Operations reports and a guide's
 * back arrow read the name from here (`pageName`), so a new page is named once.
 * `otherStaffHidden` — not drawn for an "Other Staff" login (owner, 23 Nov 2026), who is shown the Calendar, Trains
 * and Settings; drawn for everyone else, signed out included. auth-policy.js refuses the same pages. Its
 * gate, `isNotOtherStaff`, is the one `initNavPanel` defaults to TRUE: a page that passes no gates (signed out) keeps
 * Admin and Pay as it always has, and every page that knows its member spreads `navGatesFor`.
 * @type {ReadonlyArray<{ id: string, label: string, name?: string, url: string, colorClass: string, adminOnly?: boolean, linksDesignerOnly?: boolean, overtimeAudienceOnly?: boolean, newlinkAudienceOnly?: boolean, otherStaffHidden?: boolean }>}
 */
export const NAV_PAGES = Object.freeze([
    { id: 'calendar',   label: '📅 Calendar',   url: './',      colorClass: 'nav-panel-pill--calendar'   },
    { id: 'admin',      label: '📝 Admin',       url: './admin.html',      colorClass: 'nav-panel-pill--admin',      otherStaffHidden: true },
    { id: 'paycalc',    label: '💷 Pay',         name: 'Pay Calculator', url: './paycalc.html',    colorClass: 'nav-panel-pill--pay',        otherStaffHidden: true },
    { id: 'operations', label: '🔧 Operations',   url: './operations.html', colorClass: 'nav-panel-pill--operations', adminOnly: true },
    { id: 'links',      label: '🔗 Links',         url: './links.html',      colorClass: 'nav-panel-pill--links',      linksDesignerOnly: true },
    // Overtime's audience only (filtered, not the boundary — the page and server gate themselves).
    // PAUSED (owner, Nov 2026): `canOpenOvertime` is false for everyone while CONFIG.OVERTIME_ENABLED is off.
    { id: 'overtime',   label: '⏱️ Overtime',      url: './overtime.html',   colorClass: 'nav-panel-pill--overtime',   overtimeAudienceOnly: true },
    // Trains is every member's (owner, 20 Oct 2026). A gate here and the auth-policy role always move
    // together — nav-gates.test.mjs checks it.
    { id: 'trains',     label: '🚆 Trains',        url: './trains.html',     colorClass: 'nav-panel-pill--trains'     },
    // The new link's shortlisted proposals: every colleague on a normal CEA contract and the managers since it opened, with
    // the admin and the named previewers (`canOpenNewlink`) — the gate and auth-policy.js's role move together (nav-gates.test.mjs).
    { id: 'newlink',    label: '🔁 New link', url: './newlink.html',    colorClass: 'nav-panel-pill--newlink',    newlinkAudienceOnly: true },
    // SETTINGS IS A PAGE, SO IT IS A PILL (nav-panel.js's header has why); its badges' indigo (shared.css
    // has why). It comes last, so "work pages first" holds by position.
    { id: 'settings',   label: '⚙️ Settings',      url: './settings.html',   colorClass: 'nav-panel-pill--settings'   },
].map(p => Object.freeze(p)));

/**
 * A page's name — its `name`, or its pill's words without the emoji.
 * @param {{ label: string, name?: string }} page
 * @returns {string}
 */
export function pageName(page) {
    return page.name ?? page.label.slice(page.label.indexOf(' ') + 1);
}

/**
 * The Latest section — flat, always open: the live workplace documents, in menu order. A document
 * row is a button (`circular` / `newsletter`) that opens the latest issue; a plain row is a link.
 * The Newsletter's row is drawn `hidden` unless its latest issue is under six weeks old, and asked again
 * on every open (newsletter-recency.js, owner, 14 Nov 2026), so an old issue is never offered as the latest.
 * `body` is what the drawer's info panel says when no document can be opened.
 * @type {ReadonlyArray<{ icon: string, label: string, url?: string, circular?: boolean, newsletter?: boolean, body?: string }>}
 */
export const NAV_INFORMATION = Object.freeze([
    { icon: '📋', label: 'Daily Huddle',           url: './#huddle' },
    // Each document by its whole name, as the in-app viewer says it (calendar-doc-viewer.js `DOCS`).
    { icon: '📰', label: 'Weekly Retail Circular', circular: true, body: 'No Weekly Retail Circular has been uploaded yet — a new one usually arrives on a Friday.' },
    { icon: '🗞️', label: 'Marylebone Newsletter',  newsletter: true, body: 'No Marylebone Newsletter has been uploaded yet.' },
].map(l => Object.freeze(l)));

/**
 * Reference — collapsible submenu (tap "Reference" to fold or unfold it). Static reference
 * pages, grouped together so the Latest section stays focused on live docs.
 * Adding a guide = one entry here, with an `openId` — and that id in the `firestore.rules` analytics
 * allowlist and in `OPEN_META` (operations-reports.js); firestore-contract-parity.test.mjs checks all three.
 *
 * `openId` is the anonymous open-counter id. It lives on the ENTRY and is stamped onto the rendered
 * link as `data-open-id`, so the click handler reads it off the element rather than inferring it from
 * the href: a filename is not a stable key (`'./paycalc-guide.html'.includes('guide.html')` once
 * filed every Pay Calculator Guide open under the Staff Guide). A guide added here without an
 * `openId` is not counted, which firestore-contract-parity.test.mjs fails on.
 *
 * EVERY GUIDE CARRIES ONE LINE SAYING WHAT IT ANSWERS. A bare title names a subject you must ALREADY
 * KNOW to pick ("FIP Travel Guide" for "can I get cheap travel in Europe?"), and search cannot rescue
 * it — CLAUDE.md → "Plain English that TEACHES". `sub` is the question, in the reader's words, never
 * a description of the document.
 * @type {ReadonlyArray<{ icon: string, label: string, sub: string, url: string, openId: string }>}
 */
export const NAV_GUIDES = Object.freeze([
    // "Recording", never "Booking": the app records leave already agreed, and absence — it books nothing (admin.html's
    // "Record Annual Leave"; the guide's own "record annual leave that's already been agreed").
    { icon: '📘', label: 'Staff & Admin Guide',  sub: 'Using the app, and recording leave and absence', url: './staff-guide.html',    openId: 'guide-staff'    },
    { icon: '💷', label: 'Pay Calculator Guide', sub: 'Estimating your take-home, and your payslip lines', url: './paycalc-guide.html',  openId: 'guide-paycalc'  },
    { icon: '🎫', label: 'Railcard Guide',       sub: 'Which railcard gives what discount',    url: './railcard-guide.html', openId: 'guide-railcard' },
    { icon: '🗺️', label: 'Rangers & Rovers Guide', sub: 'Checking area tickets at Marylebone', url: './rangers-guide.html',  openId: 'guide-rangers'  },
    { icon: '🇪🇺', label: 'FIP Travel Guide',     sub: 'Free and discounted travel in Europe',  url: './fip-guide.html',      openId: 'guide-fip'      },
].map(g => Object.freeze(g)));

/**
 * One entry per section a notice can archive under, or its App Notices chip falls back to the
 * neutral grey; `calendar-notices.test.mjs` fails on an archived section with no entry here, and on
 * an entry with no `--on-navy-*` colour in shared.css.
 * @type {Readonly<Record<string, string>>}
 */
export const SECTION_MODS = Object.freeze({ Pay: 'pay', Links: 'links', Settings: 'settings', Operations: 'ops', Calendar: 'calendar', Trains: 'trains', 'New link': 'newlink' });

/**
 * Each flag a `NAV_PAGES` entry may carry, and the gate (an `initNavPanel` option, from `navGatesFor`)
 * that must be true for the pill to be drawn. A sixth gate is one entry here and one in `navGatesFor`.
 * @type {Readonly<Record<'adminOnly'|'linksDesignerOnly'|'overtimeAudienceOnly'|'newlinkAudienceOnly'|'otherStaffHidden', 'isAdmin'|'isLinksDesigner'|'canOpenOvertime'|'canOpenNewlink'|'isNotOtherStaff'>>}
 */
export const PILL_GATES = Object.freeze({
    adminOnly:            'isAdmin',
    linksDesignerOnly:    'isLinksDesigner',
    overtimeAudienceOnly: 'canOpenOvertime',
    newlinkAudienceOnly:  'canOpenNewlink',
    otherStaffHidden:     'isNotOtherStaff',
});

/** @typedef {{ isAdmin?: boolean, isLinksDesigner?: boolean, canOpenOvertime?: boolean, canOpenNewlink?: boolean, isNotOtherStaff?: boolean }} NavGates */

/**
 * The pills a person sees, in menu order, each marked `current` when it is the page they are on. A
 * pill carrying a gate flag is kept only when that gate is true; an absent gate is false. PURE.
 * @template {{ id: string }} P
 * @param {ReadonlyArray<P>} pages
 * @param {NavGates} gates
 * @param {string} [currentPage]
 * @returns {Array<P & { current: boolean }>}
 */
export function visiblePills(pages, gates, currentPage) {
    const g = /** @type {Record<string, boolean|undefined>} */ (gates || {});
    return pages
        .filter(p => Object.entries(PILL_GATES).every(([flag, gate]) => !(/** @type {any} */ (p))[flag] || !!g[gate]))
        .map(p => ({ ...p, current: p.id === currentPage }));
}
