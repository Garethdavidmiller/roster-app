// @ts-check
// text-scale.js — how much LARGER than the stylesheet's sizes the phone is drawing its text, and
// what the calendar's action row does about it.
//
// Android's accessibility text size ("Large", "Largest", and Samsung's steps above them) scales
// every font size the page asks for. It does NOT change the CSS viewport, so no width query can see
// it — which is why the calendar's five-button action row, sized to fit a 360px phone at the
// default size, wrapped to 3 + 2 on a 412px phone the moment its buttons reached 15px (measured:
// 390px needed, 386px available). The owner did not want two rows. Two rows was the LAST resort,
// chosen at v22.62 over a fifth button cut off the edge, and it stays the last resort; this module
// adds the step before it — a compact row: tighter padding and gaps, and the four decorative icons
// dropped (the word is the content; 📍 stays, it IS the content) — applied ONLY when the text is
// scaled enough to need it, so a phone at the default or "Large" size renders exactly as before.
// Measured: one line at 412px up to ~2× and at 360px up to ~1.5×.
//
// THE PROBE MEASURES, IT DOES NOT ASK. A hidden span at a known 16px with `line-height: 1` is
// exactly as tall as the size the browser actually used, so its height over 16 is the scale —
// whatever the OS calls it, whatever `getComputedStyle` reports (Chromium reports the scaled value,
// but the rendered box is the fact, and it is what the row has to fit). It runs once at boot: the
// setting cannot change under a running page without a reload.
//
// TWO TIERS, because two rows have different budgets. The month heading row ("September 2026 ▾"
// beside "CEA Weeks 12–16") is the tighter one — on a 360px phone it fits the default size by 3px
// and no more — so it tightens from 1.1× ('large'). The five-button action row fits "Large" text at
// 412px with room, so it compacts only from 1.2× ('compact'). The stylesheet reads
// `html[data-text-scale]` for the first and `html[data-text-scale="compact"]` for the second.
//
// Three things not to "tidy":
//   · The action row's threshold is 1.2, not 1.1: "Large" (1.15×) still fits at 412px with room,
//     and compacting it would change the row on phones that were never short of space.
//   · The result is a data attribute on <html>, not inline styles, so the CSS stays the one place
//     that says what compact MEANS and the static guard can still read it.
//   · `window.__E2E?.textScale` is a TEST SEAM: a headless browser cannot be given an OS text size,
//     so the e2e suites assert the compact row by stating a scale. It is read only when present.
//
// Two limits, named so nobody over-reads the tests (external review of v22.87):
//   · The e2e suites prove the RESPONSE, not the DETECTION. Every run states the scale through the
//     seam and scales the fonts itself; none of them can turn up a real Android setting and read
//     what the probe makes of it. That bridge is validated on a real phone, and if a colleague on a
//     large setting reports two rows, the probe is the first suspect. KNOWN_LIMITATIONS.md carries it.
//   · The month heading's 21px base under `html[data-text-scale]` HOLDS that one heading near its
//     original size against the member's preference. Accepted for a two-word title on a row that
//     costs a whole calendar line; not to be extended to anything else. A surface that will not fit
//     gets a second line — never a third compensating rule.

/** From here the month heading row tightens ("Large", 1.15×, is in — it is where 360px stops fitting). */
export const LARGE_FROM = 1.1;
/** From here the action row goes compact as well. "Large" (1.15×) is below it on purpose. */
export const COMPACT_FROM = 1.2;
/** The attribute values the stylesheet keys on: `html[data-text-scale]` matches either tier,
 *  `html[data-text-scale="compact"]` only the upper one. */
export const LARGE_VALUE = 'large';
export const COMPACT_VALUE = 'compact';
/** The probe's reference size; its rendered height over this is the scale. */
const PROBE_PX = 16;

/**
 * Whether a measured scale calls for the compact action row.
 * @param {number} scale
 */
export function isCompact(scale) {
    return Number.isFinite(scale) && scale >= COMPACT_FROM;
}

/**
 * Which tier a measured scale falls in — null (untouched), 'large' or 'compact'.
 * @param {number} scale
 */
export function tierFor(scale) {
    if (!Number.isFinite(scale)) return null;
    if (scale >= COMPACT_FROM) return COMPACT_VALUE;
    if (scale >= LARGE_FROM) return LARGE_VALUE;
    return null;
}

/**
 * Measure the browser's text scale by rendering a known size and reading back the box.
 * Returns 1 when it cannot measure (no document, a zero box) — the default look, never compact.
 * @param {Document} doc
 */
export function measureTextScale(doc) {
    const seam = /** @type {any} */ (globalThis).__E2E?.textScale;
    if (typeof seam === 'number' && Number.isFinite(seam) && seam > 0) return seam;
    if (!doc?.body) return 1;
    try {
        return _probe(doc);
    } catch {
        // A MEASUREMENT MUST NEVER BREAK THE PAGE IT MEASURES (v22.99). This runs at MODULE SCOPE in
        // `calendar-app.js`, before anything else, so an exception here does not degrade the text
        // scaling — it aborts the coordinator's evaluation and the Calendar renders NOTHING.
        // Verified rather than assumed: with a throw injected here the grid draws zero cells.
        // Every sibling instrument in this app already carries this guard for the same reason
        // (`markMilestone`: "it must never be able to break the page it times"); this one was the
        // exception, and it is the one that runs earliest on the app's opening page.
        // 1 is the honest fallback: unmeasured means unscaled, and no tier is stamped.
        return 1;
    }
}

/** The probe itself. Separated so the guard above reads as one statement. */
function _probe(/** @type {Document} */ doc) {
    const probe = doc.createElement('span');
    probe.textContent = 'X';
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;font-size:${PROBE_PX}px;line-height:1;padding:0;margin:0;border:0;white-space:nowrap`;
    doc.body.appendChild(probe);
    const h = probe.getBoundingClientRect().height;
    probe.remove();
    return h > 0 ? h / PROBE_PX : 1;
}

/**
 * Stamp the root element so the stylesheet can react. Idempotent.
 * @param {Document} doc
 * @returns {number} the scale that was measured
 */
export function applyTextScale(doc) {
    const scale = measureTextScale(doc);
    // Guarded for the same reason as the probe: this is the half that touches `<html>`, and the
    // caller runs it at module scope with nothing above it to catch a throw.
    try {
        const root = doc?.documentElement;
        if (root) {
            const tier = tierFor(scale);
            if (tier) root.setAttribute('data-text-scale', tier);
            else root.removeAttribute('data-text-scale');
        }
    } catch { /* no documentElement, or a hostile setAttribute — the page renders unscaled */ }
    return scale;
}
