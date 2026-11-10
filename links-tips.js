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

import { ROTATING_LINES, DEFAULT_MAX_RUN } from './links-design.js';

export const CARD_TIPS = {
    'links-grid': {
        title: 'Link design grid',
        sections: [
            { heading: 'How it works', items: [
                { icon: '📋', html: `Each <strong>row</strong> is one of the ${ROTATING_LINES} lines. Each <strong>column</strong> is a day of the week (Sun–Sat).` },
                { icon: '🔄', html: `All ${ROTATING_LINES} lines rotate — everyone passes through every line over the cycle, so <strong>all ${ROTATING_LINES} must be filled</strong> with a real pattern before the link can be authorised.` },
                { icon: '🖌️', html: '<strong>Paint mode</strong> — arm a shift in the Paint bar above the grid, then choose cells to fill them; with a mouse, press and drag across a run of cells to fill them all at once. Choose the same chip again (or press Escape) to stop painting.' },
                { icon: '✏️', html: '<strong>Single-cell edit</strong> — with no brush armed, choose any cell to pick a shift from the list, or choose <strong>Custom…</strong> to type a new one.' },
                { icon: '⌨️', html: '<strong>From the keyboard</strong> — Tab reaches the grid once, at the cell you last used. The arrow keys move between cells, Home and End go to either end of a line, and Enter changes the cell — or paints it, while a chip is armed.' },
                { icon: '🧮', html: 'The three columns on the right are the <strong>totals for that line</strong> — hours Mon–Sat, hours across all seven days, and how many days are worked Mon–Sat. They update as you edit.' },
                { icon: '📐', html: 'The bottom row averages them. Hours are averaged over every line, with a <strong>spare week counted as a full contracted week</strong>. Days are averaged over the <strong>working lines only</strong>, because a spare week does not say which days it works — each figure names its own divisor.' },
                { icon: '💾', html: 'Press <strong>Save</strong> when done — beside the design\'s name, or at the foot of the grid. A new design asks for a name the first time.' },
            ]},
            { heading: 'Multiple designs', items: [
                { icon: '➕', html: 'Under <strong>···</strong> beside the design\'s name: <strong>New blank design</strong> starts afresh, and <strong>Save a copy as…</strong> copies the current one so you can try a variation.' },
                // Added with the feature (v20.97). Without it the button is discoverable
                // only by pressing it, and the two-step it opens then reads as a hurdle
                // rather than as the check it is.
                { icon: '⤓', html: '<strong>Import</strong> takes a design somebody has written down elsewhere — paste it from a spreadsheet, or type times, <strong>RD</strong> and <strong>SP</strong> a row per line. Press <strong>Preview import</strong> first: it tells you what would be saved, and anything it had to assume, before there is a Save button at all.' },
                // Added with the gate (v20.98). Without it the refusal reads as the tool
                // being broken rather than as the arithmetic saying no. It refuses a SURPLUS too, with the
                // opposite remedies (links-app-13): the panel used to describe the shortfall alone.
                { icon: '⏱️', html: '<strong>Generate refuses a design that does not pay the contracted week exactly</strong> — under it or over it. The rotation has to average the contracted week with Sundays left out, and a <strong>spare week counts as a full week</strong>. Individual weeks vary — the average is what counts.' },
                { icon: '➕', html: 'If it is <strong>short</strong>, it says how many hours of duty are missing. Only three things close that gap: more duties, longer ones, or more spare weeks. Spreading the same work over more lines never can — that makes each line shorter, not longer.' },
                { icon: '➖', html: 'If it is <strong>over</strong>, it says how many hours of duty too many — a surplus would be permanent overtime nobody has agreed to. The remedies are the opposite ones: fewer duties, shorter ones, or fewer spare weeks.' },
                { icon: '🛡️', html: 'An import saves as a <strong>new</strong> design and never changes the one you have open. A cell it cannot read stops the whole import rather than quietly becoming a rest day — a design that arrives four duties light looks like a lighter week, not like a mistake.' },
                { icon: '⇔', html: '<strong>Compare with…</strong>, under the same <strong>···</strong>, shows two designs side by side — cells that differ are highlighted in gold. It needs at least two designs.' },
                { icon: '🗑', html: 'Deleting a design does not destroy it — it moves to <strong>Recently deleted</strong>, where it stays until someone restores it or removes it for good. Nothing is removed automatically. It is under <strong>···</strong>, and only appears when something is in there.' },
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
            { icon: '🔵', html: 'Darker blue = more people on at once' },
            // Since the staffed window (v19.54) a gap is any hour the station is OPEN with nobody on —
            // the opening and closing hours included — and a shut hour is grey. The card's own note
            // (links-analysis.js) says the same; this used to call a blank cell "nobody on duty" and a
            // gap a mid-day hole (links-app-13).
            { icon: '🔴', html: 'A red <strong>0</strong> means a gap — the station is open and nobody is on duty, at the open and the close as much as mid-day' },
            { icon: '⬜', html: 'A <strong>grey</strong> hour is outside the <strong>staffed window</strong>, set at the top of this card — the station is shut, so nobody on is not a gap. A number on grey means someone is rostered while it is shut.' },
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
            { icon: '📅', html: `<strong>Longest run</strong> — how many consecutive working days appear anywhere in the ${ROTATING_LINES}-line cycle. More than ${DEFAULT_MAX_RUN} days is flagged — a design aim, not a limit.` },
            { icon: '⚖️', html: '<strong>Shift balance</strong> — how the worked days split between early, late, and spare across the full rotation.' },
            // The rest of the card (links-app-13): the panel explained the first section's rows and none
            // of the sections that make up most of it.
            { icon: '🕐', html: '<strong>Hours a week</strong> — the rotation\'s average with Sundays left out, against the contracted week. A cover week counts as a full week, and Sunday duty sits on top, because Sunday is not contracted.' },
            { icon: '🏢', html: '<strong>Company limits</strong> — the longest run of working days, and the contracted days a year. Each row says whether this design meets the limit — met as well as breached — and names its source.' },
            { icon: '🩺', html: '<strong>Fatigue factors</strong> — the ORR\'s good-practice list, grouped in its own families. They report which factors a pattern <strong>features</strong>: they are not pass/fail limits, and nothing here approves a design. A <strong>standing</strong> factor comes with the operation itself — every 06:20 start, say — so it is counted apart from the rest.' },
            { icon: '📏', html: '<strong>For comparison — today\'s link</strong> — the same factors measured on the roster in use now, so a figure can be read against the link it would replace.' },
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
                { icon: '🚆', html: 'A new design starts from a table built against the <strong>December 2026 train service</strong>, not from today\'s roster. <strong>↺ Copy staffing from today\'s roster</strong> swaps in what the current roster actually provides; <strong>↺ Use the Dec 2026 staffing</strong> returns to it.' },
                { icon: '📋', html: `Since the link became <strong>${ROTATING_LINES} lines</strong>, it is the duty table of <strong>Short Run</strong>, one of the proposals in the pack: 15 on each weekday, 14 on a Saturday, 10 on a Sunday, with <strong>five cover weeks</strong>.` },
                { icon: '🌅', html: 'At least four on at the open and three through to the close, every day; at least five still on at 22:00.' },
                { icon: '⚖️', html: 'Mon–Sat pays <strong>exactly</strong> the contracted week, at 218.6 contracted days a year — under the 219 ceiling.' },
                { icon: '💬', html: 'It is a <strong>starting point to argue with</strong>, not a proposal: change anything you like, and read the checks below before anyone takes a printout into a room.' },
            ]},
            { heading: 'How to use it', items: [
                { icon: '➕', html: '<strong>+ Add another shift</strong> for a new start time; ✕ removes a row. Pick times from the dropdown or choose <strong>Custom…</strong> to type one.' },
                { icon: '⚠️', html: `Each day's total (all shifts + spare) can't exceed ${ROTATING_LINES} — watch the Total row.` },
                { icon: '💾', html: '<strong>Saved staffing setups</strong> keep a table to come back to, shared with the other designers. Anyone can save one; only the person who created it, or the admin, can overwrite or delete it.' },
                { icon: '3️⃣', html: 'Tap <strong>Build the link</strong>, then review the coverage and the design checks before saving.' },
            ]},
        ],
    },
};
