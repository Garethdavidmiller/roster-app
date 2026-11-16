// @ts-check
/**
 * paycalc-disclosures.js — the Pay page's button-and-panel disclosures: ONE open/close core.
 *
 * Owns: `setDisclosure` (a disclosure to a GIVEN state), `toggleDisclosure` (the click), and the
 *   page's named disclosures built on them — Hours "more options", the HPP card's calculation
 *   details, the result card's full breakdown — plus the disclaimer's More/Less, which has no panel
 *   and no arrow, so it keeps its own three lines rather than bending the core to fit.
 * Does NOT own: the collapsible CARDS (overlay.js → initCardCollapse), or when a disclosure opens
 *   itself (paycalc-app.js → loadPeriodData opens Hours "more options" over saved extras).
 *
 * Split out of paycalc-app.js (16 Nov 2026) with the coordinator at its ratchet cap: none of this
 * closes over the coordinator's state, and every disclosure on the page shares one rule — the button's
 * `aria-expanded` and its arrow glyph follow the panel, on the click AND on a programmatic open. A
 * class alone once told a screen reader "collapsed" about an open panel. Tested by
 * paycalc-disclosures.test.mjs.
 */

/**
 * @typedef {{ arrowSel?: string, onToggle?: (open: boolean, body: HTMLElement) => void }} DisclosureOpts
 *   arrowSel — the arrow inside the button whose glyph flips ▲/▼; onToggle — anything else that follows
 */

/**
 * Set a disclosure button + body to a SPECIFIC open state, keeping `aria-expanded` and the arrow
 * glyph in step — for the click AND for a programmatic open. Idempotent.
 * @param {string} btnId @param {string} bodyId @param {boolean} open @param {DisclosureOpts} [opts]
 */
export function setDisclosure(btnId, bodyId, open, opts = {}) {
  const btn  = /** @type {HTMLElement|null} */ (document.getElementById(btnId));
  const body = /** @type {HTMLElement|null} */ (document.getElementById(bodyId));
  if (!btn || !body) return;
  body.classList.toggle('open', open);
  btn.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', String(open));
  if (opts.arrowSel) {
    const a = btn.querySelector(opts.arrowSel);
    if (a) a.textContent = open ? '▲' : '▼';
  }
  opts.onToggle?.(open, body);
}

/**
 * Toggle a disclosure to the OPPOSITE of its current open state (the click path).
 * @param {string} btnId @param {string} bodyId @param {DisclosureOpts} [opts]
 */
export function toggleDisclosure(btnId, bodyId, opts = {}) {
  const body = /** @type {HTMLElement|null} */ (document.getElementById(bodyId));
  if (!body) return;
  setDisclosure(btnId, bodyId, !body.classList.contains('open'), opts);
}

/** Hours "more options": the label is CONSTANT — only the arrow flips. */
export function toggleHoursExtra() { toggleDisclosure('hoursShowMore', 'hoursExtra', { arrowSel: '.show-more-arrow' }); }

/** The HPP card's calculation details: the arrow flips and the label says what a press will do. */
export function toggleHppNote() {
  toggleDisclosure('hppToggleBtn', 'hppNoteBody', {
    arrowSel: '.hpp-toggle-arrow',
    onToggle: open => {
      const l = document.getElementById('hppToggleBtnLabel');
      if (l) l.textContent = open ? 'Hide calculation details ' : 'How is this calculated? ';
    },
  });
}

/** The result card's full breakdown — its arrow's rotation is CSS. */
export function toggleBD() { toggleDisclosure('bdBtn', 'bdBody'); }

/** The disclaimer's More/Less: no panel and no arrow, so not the core above. */
export function toggleDisclaimer() {
  const extra  = /** @type {HTMLElement} */ (document.getElementById('disclaimerExtra'));
  const toggle = /** @type {HTMLElement} */ (document.getElementById('disclaimerToggle'));
  const open   = extra.classList.toggle('open');
  toggle.textContent = open ? 'Less ▲' : 'More ▼';
  toggle.setAttribute('aria-expanded', String(open));
}
