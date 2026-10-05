// @ts-check
/**
 * firestore-transport.js — how Firestore talks to its server, per device (v24.55).
 *
 * ── WHY ────────────────────────────────────────────────────────────────────────────────────────
 *
 * From early October 2026, every Admin save on EVERY iPhone took longer than the 8-second slow-save
 * notice to be confirmed by the server, with full signal, and then arrived. Android and desktop were
 * unaffected. Nothing in the app's own save path differs by platform: the time was spent inside
 * Firestore, waiting for the server's acknowledgement (see KNOWN_LIMITATIONS.md → "Admin saves are
 * slow on an installed iPhone app").
 *
 * Firestore normally holds a STREAMING connection to its server and only falls back to plain
 * long-polling when it detects that streaming does not work. Every iOS browser is Safari's engine,
 * and where that engine's streaming misbehaves, writes queue on the stream until the SDK gives up on
 * it. Firebase's documented remedy is `experimentalForceLongPolling`: skip the stream, poll.
 *
 * ── WHY ONLY APPLE MOBILE DEVICES ──────────────────────────────────────────────────────────────
 *
 * Long-polling is fully supported, but it costs a little more data and latency than a working
 * stream, so it is applied where the stream is the problem and nowhere else. Android and desktop keep
 * exactly what they had. iPadOS reports itself as a Mac with a touch screen, so it is matched on that.
 * Desktop Safari is NOT included — no report concerns it, and widening an untested change to a
 * population that is working is the wrong direction.
 *
 * ── HOW TO TELL WHETHER IT WORKED ──────────────────────────────────────────────────────────────
 *
 * Since v24.54 a save slower than the threshold while the phone says it is online is recorded in
 * Operations → Error Log as "Slow save (diagnostic)". If this is the cause, those entries stop for
 * iPhones on v24.55. If they continue, it was not, and this should be reverted rather than kept.
 *
 * Pure — no imports — so it is unit-testable without the Firebase SDK (firestore-transport.test.mjs).
 */

/**
 * Is this an iPhone, iPod or iPad (including iPadOS reporting as a Mac with touch)?
 * @param {{ userAgent?: string, platform?: string, maxTouchPoints?: number }|undefined} nav
 * @returns {boolean}
 */
export function isAppleMobile(nav) {
    if (!nav) return false;
    return /iPad|iPhone|iPod/.test(nav.userAgent ?? '') ||
           (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
}

/**
 * The transport settings to merge into `initializeFirestore`: long-polling on Apple mobile devices,
 * nothing (the SDK default) everywhere else.
 * @param {{ userAgent?: string, platform?: string, maxTouchPoints?: number }|undefined} [nav]
 * @returns {{ experimentalForceLongPolling?: true }}
 */
export function firestoreTransportSettings(nav = /** @type {any} */ (globalThis).navigator) {
    return isAppleMobile(nav) ? { experimentalForceLongPolling: true } : {};
}
