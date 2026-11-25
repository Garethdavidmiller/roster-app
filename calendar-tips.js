// @ts-check
/**
 * calendar-tips.js — CARD_TIPS for the Calendar's `?` panel: Team Week View's help and colour key.
 *
 * Data, no DOM, in the shape `tips-lightbox.js` renders and `tips-content.test.mjs` pins.
 *
 * ── WHY THE SHARED PANEL (owner, 25 Nov 2026) ───────────────────────────────────────────────────
 *
 * Every other `?` in the app opens the one white Tips panel; Team Week View's was a see-through glass
 * sheet of its own, the last one after the Pay Calculator's moved across (Nov 2026). "Aren't the rest of
 * the ? Help boxes with a white background now" — so this panel is that panel, and its `?` the shared
 * 24px button. The colour key's swatches keep their index.css classes; on white they take a visible edge.
 *
 * ── WHAT IS TIED TO WHAT ────────────────────────────────────────────────────────────────────────
 *
 * "within 20 minutes" is twice STALE_MONTH_MS (calendar-initial-fetch.js), the worst case of the
 * stale-month re-read; calendar-initial-fetch.test.mjs reads both and fails if they part. The swipe line
 * says "swipe or scroll" because it shows on every pointer: a trackpad swipes, a mouse scrolls.
 */

export const CARD_TIPS = {
    'team-week': {
        title: 'Team Week View',
        sections: [
            {
                heading: 'Moving around',
                items: [
                    { icon: '↔️', html: 'If the week is wider than your screen, swipe or scroll the table sideways to see all 7 days' },
                    { icon: '📅', html: 'Select <strong>← Prev</strong> or <strong>Next →</strong> to move between weeks' },
                    { icon: '👥', html: 'Select <strong>CEA</strong>, <strong>CES</strong> or <strong>Dispatcher</strong> to switch grade' },
                    { icon: '📍', html: 'Select <strong>📍</strong>, or <strong>↩ Back to this week</strong> under the dates, to return to the current week' },
                ],
            },
            {
                heading: 'Colour key',
                items: [
                    {
                        icon: '🎨',
                        html: '<span class="team-info-key">'
                            + '<span class="team-info-key-item"><span class="tv-key-dot tv-key-dot--early"></span><span aria-hidden="true">☀️</span> Early</span>'
                            + '<span class="team-info-key-item"><span class="tv-key-dot tv-key-dot--late"></span><span aria-hidden="true">🌙</span> Late</span>'
                            + '<span class="team-info-key-item"><span class="tv-key-dot tv-key-dot--night"></span><span aria-hidden="true">🦉</span> Night</span>'
                            + '<span class="team-info-key-item"><span class="tv-key-dot tv-key-dot--al"></span><span aria-hidden="true">🏖️</span> Annual Leave</span>'
                            + '<span class="team-info-key-item"><span class="tv-key-dot tv-key-dot--rdw"></span><span aria-hidden="true">💼</span> Rest Day Working</span>'
                            + '<span class="team-info-key-item"><span class="tv-key-dot tv-key-dot--spare"></span><span aria-hidden="true">📋</span> Spare</span>'
                            + '<span class="team-info-key-item"><span class="tv-key-dot tv-key-dot--absent"></span><span aria-hidden="true">🪑</span> Absent</span>'
                            + '<span class="team-info-key-item"><span class="tv-key-dot tv-key-dot--other"></span><span aria-hidden="true">🏷️</span> Other</span>'
                            + '<span class="team-info-key-item"><span class="tv-key-dot tv-key-dot--rest"></span><span aria-hidden="true">🏠</span> Rest</span>'
                            + '</span>',
                    },
                ],
            },
            {
                heading: 'When changes show',
                items: [
                    { icon: '🔄', html: 'Shifts shown are each person’s base roster plus any recorded changes. A change saved on the Admin page shows here when the Calendar next opens, or within 20 minutes while it stays open.' },
                ],
            },
        ],
    },
};
