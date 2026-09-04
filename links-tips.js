// @ts-check
/**
 * links-tips.js — CARD_TIPS for links.html's `?` panels.
 *
 * Pure data, no DOM. The shape is the one `tips-lightbox.js` renders and `tips-content.test.mjs`
 * pins. Extracted from `links-app.js` at v22.32, for two reasons that arrived together:
 *
 * ── THE CARD LEADS WITH ITS TABLE, AND THE EXPLANATION LIVES HERE ─────────────────────────────
 *
 * The Auto-generate card carried three paragraphs and a five-item list ABOVE the control it
 * introduces — measured at 360px, most of a screen of prose before the first input. The facts in
 * it are true and worth having, but they are the kind a designer reads once and the table is the
 * kind they use every time, so the order was upside down. The card now opens with one sentence;
 * everything that used to sit above the table — what the default was built against, what is in
 * it, and that it is a starting point to argue with — is the "The default table" section of the
 * `links-generator` panel below. A `?` is where a first-time question goes, and the page already
 * has one on every card.
 *
 * ── TWO OF THE OLD TIPS WERE UNTRUE, AND NOTHING COULD SEE IT ─────────────────────────────────
 *
 * The panel these replaced said the generator guarantees "start times only move later — never a
 * late finish then an early start". That was FALSE from v19.59, removed from the CARD's copy at
 * v20.04 (`.claude/rules/links-design.md` → "The generator intro must not restate a guarantee"),
 * and survived in the panel for two further years of releases, because help text is prose and
 * prose about a feature is only checked by somebody who knows the feature. The same panel said the
 * table "starts pre-filled from the current roster" — true until v21.00, when the December 2026
 * default replaced the roster seed, and untrue for the thirty releases since.
 *
 * So the standing rule for THIS panel is the card's own rule: describe what the generator DOES and
 * point at the Design checks for what it achieved. Never a promise about the result. And when the
 * default table in `links-default-targets.js` changes, the "The default table" section here is a
 * restatement of that module's header and has to change with it — it cannot fail a test.
 *
 * The rotation length is `ROTATING_LINES`, imported — never a literal, which
 * `links-rotation-parity.test.mjs` enforces across every `links-*.js` file including this one.
 */

import { ROTATING_LINES } from './links-design.js';

export const CARD_TIPS = {
    'links-grid': {
        title: 'Link design grid',
        sections: [
            { heading: 'How it works', items: [
                { icon: '📋', html: `Each <strong>row</strong> is one of the ${ROTATING_LINES} lines. Each <strong>column</strong> is a day of the week (Sun–Sat).` },
                { icon: '🔄', html: `All ${ROTATING_LINES} lines rotate — everyone passes through every line over the cycle, so <strong>all ${ROTATING_LINES} must be filled</strong> with a real pattern before the link can be authorised.` },
                { icon: '🖌️', html: '<strong>Paint mode</strong> — arm a shift in the Paint bar above the grid, then click cells to fill them. Click the same chip again (or press Escape) to stop painting.' },
                { icon: '✏️', html: '<strong>Single-cell edit</strong> — with no brush armed, tap any cell to pick a shift from the dropdown, or choose <strong>Custom time…</strong> to type a new one.' },
                { icon: '🧮', html: 'The three columns on the right are the <strong>totals for that line</strong> — hours Mon–Sat, hours across all seven days, and how many days are worked Mon–Sat. They update as you edit.' },
                { icon: '📐', html: 'The bottom row averages them. Hours are averaged over every line, with a <strong>spare week counted as a full contracted week</strong>. Days are averaged over the <strong>working lines only</strong>, because a spare week does not say which days it works — each figure names its own divisor.' },
                { icon: '💾', html: 'Tap <strong>Save changes</strong> when done.' },
            ]},
            { heading: 'Multiple designs', items: [
                { icon: '➕', html: '<strong>+ New</strong> starts a fresh blank design. <strong>⎘ Duplicate</strong> copies the current one so you can try a variation.' },
                // Added with the feature (v20.97). Without it the button is discoverable
                // only by pressing it, and the two-step it opens then reads as a hurdle
                // rather than as the check it is.
                { icon: '⤓', html: '<strong>Import</strong> takes a design somebody has written down elsewhere — paste it from a spreadsheet, or type times, <strong>RD</strong> and <strong>SP</strong> a row per line. Press <strong>Check it</strong> first: it tells you what would be saved, and anything it had to assume, before there is a Save button at all.' },
                // Added with the gate (v20.98). Without it the refusal reads as the tool
                // being broken rather than as the arithmetic saying no.
                { icon: '⏱️', html: '<strong>Generate refuses a design that would underpay.</strong> The rotation has to average the contracted week with Sundays left out, and a <strong>spare week counts as a full week</strong>. Individual weeks vary — the average is what counts.' },
                { icon: '➕', html: 'If it refuses, it says how many hours of duty are missing. Only three things close that gap: more duties, longer ones, or more spare weeks. Spreading the same work over more lines never can — that is what makes a link shorter per person, not longer.' },
                { icon: '🛡️', html: 'An import saves as a <strong>new</strong> design and never changes the one you have open. A cell it cannot read stops the whole import rather than quietly becoming a rest day — a design that arrives four duties light looks like a lighter week, not like a mistake.' },
                { icon: '⇔', html: '<strong>Compare</strong> shows two designs side-by-side — cells that differ are highlighted in gold. Only available when you have at least two designs.' },
                { icon: '🗑', html: 'Deleting a design does not destroy it — it moves to <strong>Recently deleted</strong>, where it stays until someone restores it or removes it for good. Nothing is removed automatically. The button only appears when something is in there.' },
            ]},
            { heading: 'Filling the lines', items: [
                { icon: '⬜', html: 'A line shown as <strong>all rest days</strong> is <em>not yet designed</em> — its line number turns amber. Fill it manually or with the generator. The Design checks card lists any that are still empty.' },
                { icon: '🙋', html: `Empty lines are <strong>not vacancies</strong> — a vacancy is a missing person, not a missing pattern. The link must be a complete ${ROTATING_LINES} so it still works whoever is in post.` },
            ]},
        ],
    },
    'links-coverage': {
        title: 'Check staffing coverage',
        sections: [{ items: [
            { icon: '📊', html: 'Each cell shows how many people are <strong>on duty during that hour</strong> — rows are days, columns are hours of the day' },
            { icon: '🔵', html: 'Darker blue = more people on at once; blank = nobody on duty' },
            { icon: '🔴', html: 'A red <strong>0</strong> means a gap — nobody on duty in the middle of that day\'s working hours' },
            { icon: '🟡', html: '<strong>SP</strong> column = spares on standby that day (no fixed time, so they aren\'t in the hourly cells)' },
            { icon: '💡', html: 'This shows the real <em>shape</em> of the day — opens, the morning build, the afternoon peak, and the taper to close. Updates live as you edit cells.' },
            { icon: '🚆', html: 'The orange <strong>Trains per hour</strong> rows underneath are the December 2026 <em>service</em> — arrivals and departures together, weighted by train length, so a 9-car evening train counts for more than a 3-car midday one.' },
            { icon: '📐', html: 'The two halves are shaded on <em>separate</em> scales — people and cars are different units, so compare the <strong>shapes</strong>, not the depth of colour.' },
            { icon: '➖', html: 'An underlined demand cell means some of that hour\'s trains fall <strong>outside the staffed window</strong> — the note names them to the minute. That is stated, never scored: where the window sits is a business decision.' },
        ]}],
    },
    'links-checks': {
        title: 'Design checks',
        sections: [{ items: [
            { icon: '🔄', html: `<strong>All lines designed</strong> — every one of the ${ROTATING_LINES} rotating lines must carry a real pattern. A line that is all rest days is unfinished (not a vacancy), and the link can't be authorised until they are all filled.` },
            { icon: '✅', html: '<strong>Weekends off</strong> — a full weekend = Saturday rest + the following Sunday rest. Aim for at least 40% of weeks.' },
            { icon: '⏱️', html: '<strong>Rest between shifts</strong> — checks every transition between two <em>timed</em> shifts across the rotation for less than 12 hours rest. Late-to-early next morning is the classic short turnaround. A spare day has no times, so a transition either side of one can\'t be measured and isn\'t counted.' },
            { icon: '📅', html: `<strong>Longest run</strong> — how many consecutive working days appear anywhere in the ${ROTATING_LINES}-line cycle. Over 7 days is flagged.` },
            { icon: '⚖️', html: '<strong>Shift balance</strong> — how the worked days split between early, late, and spare across the full rotation.' },
            { icon: '🔄', html: 'Checks cover the <em>rotation</em>, not a single week — turnarounds and run lengths wrap across line boundaries.' },
        ]}],
    },
    'links-generator': {
        title: 'Auto-generator',
        sections: [
            { heading: 'What it does', items: [
                { icon: '⚡', html: `Builds a ${ROTATING_LINES}-line rotating pattern from a <strong>list of shifts</strong> — one row per start time, each with its own headcount for Mon–Fri, Saturday, and Sunday. The three are separate because the roster genuinely differs on those days.` },
                { icon: '🌊', html: 'The station is staffed in <strong>waves</strong> — opens, mid-morning, middles, afternoons, closes — so add a row for every distinct start time, not just one early and one late. Each line is kept inside one wave, so a person\'s week stays on much the same sort of shift.' },
                // The rule from links-design.md → "The generator intro must not restate a
                // guarantee": this item points at the checks and promises nothing about the result.
                { icon: '🔍', html: 'It makes <strong>no promise about the result</strong>. The Design checks and the Coverage heat map below say what the pattern actually came to — the rest between shifts, the runs, the weekends, the shape of each day. Read them before saving.' },
            ]},
            // The prose that led the card until v22.32 — see the module header. A restatement of
            // links-default-targets.js's header; when that table changes, change this.
            { heading: 'The default table', items: [
                { icon: '🚆', html: 'A new design starts from a table built against the <strong>December 2026 train service</strong>, not from today\'s roster. <strong>↺ Copy staffing from today\'s roster</strong> swaps in what the current roster actually provides; <strong>↺ Use the recommended Dec 2026 staffing</strong> returns to it.' },
                { icon: '🌅', html: 'Four turns on at the open every day, three through to the close — four on a Saturday.' },
                { icon: '🌙', html: 'Five still on at 22:00; fourteen working a Saturday, leaning late for events; ten on a Sunday.' },
                { icon: '⚖️', html: 'Mon–Sat averaging <strong>exactly</strong> the contracted week.' },
                { icon: '⏳', html: '<strong>Late turns are deliberately shorter than early ones</strong>, bar the one short early.' },
                { icon: '🕒', html: 'Every start and finish is a round time, on the quarter hour wherever the station\'s own opening and closing hours allow. Monday to Saturday run mostly the same turns — Saturday\'s morning body starts later, and one of its lates is spent on a fourth closer.' },
                { icon: '💬', html: 'It is a <strong>starting point to argue with</strong>, not a proposal: change anything you like, and read the checks below before anyone takes a printout into a room.' },
            ]},
            { heading: 'How to use it', items: [
                { icon: '➕', html: '<strong>+ Add another shift</strong> for a new start time; ✕ removes a row. Pick times from the dropdown or choose Custom time….' },
                { icon: '⚠️', html: `Each day's total (all shifts + spare) can't exceed ${ROTATING_LINES} — watch the Total row.` },
                { icon: '💾', html: '<strong>Saved staffing setups</strong> keep a table to come back to, shared with the other designers. Anyone can save one; only the person who created it, or the admin, can overwrite or delete it.' },
                { icon: '3️⃣', html: 'Tap <strong>Build the link</strong>, then review the coverage and the design checks before saving.' },
            ]},
        ],
    },
};
