// @ts-check
/**
 * newlink-render.js — every word of HTML on the new link page (newlink.html), as pure functions.
 *
 * The coordinator (newlink-app.js) decides WHICH view is on screen; this module builds it, from the generated figures
 * (newlink-data.js), the built-in proposals (link-designer-proposals.js) and the page's settings (newlink-config.js). Nothing here
 * reads the DOM, the clock or the network, so every surface the page can show is testable in Node
 * (newlink-render.test.mjs).
 *
 * ── THREE RULES THE PAGE KEEPS ─────────────────────────────────────────────────────────────────
 *
 *  1. EVENLY. The three proposals appear A to Z everywhere, in the same colour, and nothing here names a recommendation
 *     (owner, 2 Nov 2026: "No, three evenly"). The one mark that singles a design out is the sheet's own — bold green on
 *     the best of the three FOR ONE KIND OF COLLEAGUE, row by row — and it lands on each of the three somewhere.
 *  2. NOT YOUR ROSTER. A proposal's weeks are labelled as a proposal wherever they are drawn, numbered by week rather than
 *     dated, and framed unlike any roster surface — so a screenshot of one cannot be mistaken for a roster.
 *  3. TEACH IN PLACE (CLAUDE.md → "Plain English that TEACHES"). Each figure is a row a colleague can read without the
 *     pack: the sheet's own label, today beside it for scale, and the sentence that sums it up first.
 *
 * No `title` attribute anywhere: an OS tooltip is invisible on a phone (native-surface-parity). A short form that needs
 * its long form says it to a screen reader in a visually hidden span instead.
 */
import { escapeHtml as esc } from './roster-data.js';
import { proposalDisplayName } from './link-designer-proposals.js';
// The shift rules are the Link Designer's, read rather than restated (25 Nov 2026): this page counted a cover week only when
// all SEVEN days were SPARE while `isCoverWeek` deliberately ignores Sunday, so a cover week written with a rest-day Sunday
// was drawn as a week of loose cells and left out of the count. link-designer-design.js already loads here, via link-designer-proposals.js.
import { DAYS, isCoverWeek, startMinutes, classifyShift } from './link-designer-design.js';
import { formatDayMonthYear } from './date-format.js';

/** @typedef {import('./newlink-data.js').Persona} Persona */
/** @typedef {import('./newlink-data.js').Row} Row */
/** @typedef {import('./newlink-data.js').PackFile} PackFile */
/** @typedef {import('./link-designer-proposals.js').Proposal} Proposal */

/** @type {Record<string, string>} */
const DAY_SHORT = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };
/** @type {Record<string, string>} */
const DAY_LONG = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };

/** Short on screen, whole to a screen reader. @param {string} shown @param {string} said */
const short = (shown, said) => `<span aria-hidden="true">${esc(shown)}</span><span class="visually-hidden">${esc(said)}</span>`;

/** A proposal's name as every page shows it — without the built-in list's " — Dec 2026" (link-designer-proposals.js). */
export const designName = proposalDisplayName;

/**
 * The proposals in the order this page shows them — A TO Z by name, whatever order they arrive in (rule 1). The built-in
 * list is A to Z as well since 5 Nov 2026 (link-designer-proposals.js), and for two days before that it put the recommendation
 * first: the page has never taken its order on trust, and still does not — every list of the three here passes through this.
 * @template {{ name: string }} P @param {ReadonlyArray<P>} proposals @returns {P[]}
 */
export const aToZ = (proposals) => [...proposals].sort((a, b) => designName(a).localeCompare(designName(b), 'en-GB'));

/**
 * A 'YYYY-MM-DD' day as a local-noon Date, or null. A malformed date is null, never "Invalid Date" — nor the day it rolls
 * over to: `new Date` turns 31 February into 3 March without complaint, so the parts must come back as they went in.
 * @param {string|null|undefined} iso
 */
function parseIsoDay(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], 12);
    return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null;
}

/**
 * The closing date in words, with its year ("Monday 30 November 2026", as a date with its year is written everywhere in
 * the app) — or "a date to be agreed" while there is none (owner: "Not set yet"), or one that cannot be read.
 * @param {string|null} closes 'YYYY-MM-DD'
 */
export function closesWords(closes) {
    const d = parseIsoDay(closes);
    return d ? `${d.toLocaleDateString('en-GB', { weekday: 'long' })} ${formatDayMonthYear(d)}` : 'a date to be agreed';
}

/**
 * When the new link starts, with its preposition: "in January 2027" for a month, 'YYYY-MM' — the day is not known yet
 * (owner, 8 Nov 2026) — or "on 18 January 2027" for a day, 'YYYY-MM-DD', once one is set. Null for anything else, so the
 * page says nothing rather than something untrue.
 * @param {string|null|undefined} starts
 */
export function startsWords(starts) {
    const month = /^(\d{4})-(\d{2})$/.exec(starts ?? '');
    if (month) {
        if (+month[2] < 1 || +month[2] > 12) return null;
        return `in ${new Date(+month[1], +month[2] - 1, 1, 12).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`;
    }
    const d = parseIsoDay(starts);
    return d ? `on ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : null;
}

/**
 * Where the page's story is, from its settings and today (owner, 10 Nov 2026: "Add a 'decided' state"):
 *   - 'decided' — `chosen` names one of the shortlist: the page says so and invites no more views;
 *   - 'open'    — nothing chosen, and the link's start not yet come: "Nothing is decided", and "Have your say";
 *   - 'waiting' — nothing chosen, and the start HAS come: the safety net the owner asked for. The page stops inviting views
 *                 and stops saying nothing is decided, and says only who will confirm the outcome — never a decision of
 *                 its own. A month ('YYYY-MM') is reached on its first day, as the status line reads it.
 * A name that is not one of the shortlist is REFUSED — treated as nothing chosen — so a typo can never announce a design
 * nobody chose (newlink-config.test.mjs fails on one before it ships). `today` is 'YYYY-MM-DD'; without it, nothing has come.
 * @param {{ proposals: ReadonlyArray<Proposal>, chosen?: string|null, starts?: string|null, today?: string|null }} o
 * @returns {{ phase: 'open'|'decided'|'waiting', chosen: Proposal|null }}
 */
export function statusPhase({ proposals, chosen = null, starts = null, today = null }) {
    const picked = chosen ? proposals.find(p => designName(p) === chosen) ?? null : null;
    if (picked) return { phase: 'decided', chosen: picked };
    const begun = !!startsWords(starts) && !!today && today >= /** @type {string} */ (starts);
    return { phase: begun ? 'waiting' : 'open', chosen: null };
}

/**
 * The status card's hint, under its title, for a phase (`statusPhase`): "For discussion, not a decision" only while views
 * are asked for. Once a design is chosen it is untrue, and once the start has come with none it claims what the page no
 * longer may (owner, 10 Nov 2026) — so the hint is empty, and the card's own first line says where things stand.
 * @param {'open'|'decided'|'waiting'} phase
 */
export const statusHint = (phase) => phase === 'open' ? 'For discussion, not a decision' : '';

/**
 * Whether the link's start is certainly behind us: a day from that day; a month, whose day is not known, only from the next
 * month — during it the link "starts in January", which stays true however far into January it is read.
 * @param {string} starts 'YYYY-MM' or 'YYYY-MM-DD' @param {string} today 'YYYY-MM-DD'
 */
function startIsPast(starts, today) {
    const m = /^(\d{4})-(\d{2})$/.exec(starts);
    if (!m) return today >= starts;
    return today >= (+m[2] === 12 ? `${+m[1] + 1}-01` : `${m[1]}-${String(+m[2] + 1).padStart(2, '0')}`);
}

/**
 * The status card's body: what the page is, the three names (one equal tile each, A to Z), and — while views are wanted — by
 * when. `timetable` and `today` are 'YYYY-MM-DD'; with no `today` the line reads as it does before the timetable changes.
 * `chosen` and `contact` are the settings `statusPhase` and the safety net read (newlink-config.js, CHOSEN and CONTACT).
 * @param {{ proposals: ReadonlyArray<Proposal>, closes: string|null, starts?: string|null, timetable?: string|null, today?: string|null,
 *   chosen?: string|null, contact?: string }} o
 */
export function renderStatus({ proposals, closes, starts = null, timetable = null, today = null, chosen = null, contact = '' }) {
    // Each tile LOOKS pressable — white, raised, the page's button recipe — so it is one: it opens that proposal's weeks
    // (the review, 2 Nov 2026: three raised tiles that did nothing broke the page's own rule that raised means pressable).
    // The name and nothing else: the sheet code told a colleague nothing and took a second line on a phone, so it lives on
    // the weeks' caption, beside the grid it identifies, and nowhere a choice is made.
    const tiles = aToZ(proposals).map(p => `<li><button type="button" class="nl-name" data-open-weeks="${esc(p.id)}"><span class="nl-name-title">${esc(designName(p))}</span><span class="nl-name-go">See its weeks</span></button></li>`).join('');
    // "Have your say" is a way there, as the name tiles are: it opens and shows that card.
    // The link and the timetable change on DIFFERENT dates (owner, 2 Nov 2026), and the gap is the question a colleague
    // asks next: which link do I work in between? Today's, until the new one starts.
    const from = startsWords(starts);
    // THE TENSE FOLLOWS THE DATE (test audit, 7 Nov 2026). With no date logic the line would still say, in January, that the
    // link "starts on 1 January 2027" and that "the new timetable comes first, in December". ISO dates compare as strings.
    // Once the link's own start has come the sentence goes, rather than guessing what happened next — this page's rule,
    // as in weeksShape: say nothing rather than something untrue. A MONTH ('YYYY-MM') is reached on its first day, which
    // a 'YYYY-MM-DD' today compares as at or after: with the day not known, from 1 January the line could already be untrue.
    const reached = (/** @type {string|null} */ iso) => !!(iso && today && today >= iso);
    const timetableLine = reached(timetable) ? 'The new timetable started in December' : 'The new timetable comes first, in December';
    // The two words after the preposition stay together (a no-break space): "18 January", "January 2027". At 390px the
    // line broke after the "1" of "1 January" and left it stranded.
    // "UNTIL THEN" SITS BESIDE THE START IT MEANS (the bug check, 9 Nov 2026). It closed the timetable's sentence — "The new
    // timetable comes first, in December, and today's link carries on until then" — where the nearest "then" is December, so
    // it could be read as today's link ending with the timetable. It belongs to the link's start, in the link's sentence.
    const held = (/** @type {string} */ words) => esc(words).replace(/^(in|on) (\S+) /, '$1 $2\u00a0');
    const when = from && !reached(starts) ? ` The new link starts ${held(from)}, and today’s link carries on until then. ${timetableLine}.` : '';
    // THE THREE STATES (`statusPhase`). Once a design is CHOSEN the start is still said, because it is no longer a guess about
    // a decision still to come: "starts" through a month whose day is not known, "started" once that month — or the day,
    // when one is set — is past. With nothing chosen by the start, the page WAITS: it neither invents an outcome nor goes
    // on saying nothing is decided, and only says who will confirm it (owner, 10 Nov 2026).
    const { phase, chosen: picked } = statusPhase({ proposals, chosen, starts, today });
    const began = phase === 'decided' && from && reached(starts) ? ` The new link ${startIsPast(/** @type {string} */ (starts), /** @type {string} */ (today)) ? 'started' : 'starts'} ${held(from)}.` : '';
    const lead = phase === 'decided' ? `<strong>${esc(designName(/** @type {Proposal} */ (picked)))} has been chosen.</strong>${when}${began}
        These were the three on the shortlist, in alphabetical order.`
        : phase === 'waiting' ? `<strong>${contact ? `The outcome will be confirmed by ${esc(contact)}.` : 'The outcome is still to be confirmed.'}</strong>
        These are the three proposals on the shortlist, in alphabetical order.`
        : `<strong>Nothing is decided.</strong>${when}
        These are the three proposals on the shortlist, in alphabetical order.`;
    // "BY" A DAY THAT HAS GONE IS UNTRUE (owner, 9 Nov 2026: "Yes" to hiding it once the date has passed). The closing date
    // is the last day for views, so the line shows on it and goes from the day after; with no date set — or one that cannot
    // be read, which closesWords words the same way — it reads "a date to be agreed" and never goes while the page is open.
    // Outside 'open' views are not asked for at all, and the coordinator takes the Have your say card away with the line.
    // THE CARD OUTLIVES THE DATE (owner, 22 Nov 2026: "Keep until decided"): once the closing date has passed, this line drops
    // its "by", but the Have your say card stays until a design is chosen, or the start comes with none — views are still
    // heard until the decision. Pinned by newlink-render.test.mjs and e2e/newlink.spec.js.
    const passed = closesWords(closes) !== closesWords(null) && !!today && today > /** @type {string} */ (closes);
    const say = passed || phase !== 'open' ? '' : ` <button type="button" class="nl-inline" data-open-card="nlSay">Have your say</button> by <strong>${esc(closesWords(closes))}</strong>.`;
    return `<p class="nl-callout">${lead}</p>
    <ul class="nl-names" aria-label="The three proposals">${tiles}</ul>
    ${weeksShape(proposals)}
    <p class="nl-lead">Nothing on this page changes your roster.${say}</p>`;
}

/**
 * What a proposal IS, counted from the rotas: its length, its set weeks and its cover weeks — said once, at the top, because
 * "cover week" is used by every card below and was explained only in a grey note halfway down (the review, 2 Nov 2026).
 * Said only while the three agree; a proposal of another shape makes this say nothing rather than something untrue.
 * @param {ReadonlyArray<Proposal>} proposals
 */
function weeksShape(proposals) {
    const shapes = proposals.map(p => {
        const weeks = Object.values(p.patterns);
        return { weeks: weeks.length, cover: weeks.filter(isCoverWeek).length };
    });
    const [{ weeks, cover }] = shapes;
    if (!cover || !shapes.every(s => s.weeks === weeks && s.cover === cover)) return '';
    // "IF A COVER WEEK FALLS BADLY" IS SAID HERE, ONCE (owner, 12 Nov 2026: "It should be for dummies"): every card below uses
    // the phrase, and a reader meeting it cold could not know it means the four shifts landing in the worst place — with the
    // cover week's Sunday worked as overtime too, as RULES.md §3 counts every worst case (the 22 Nov review: Balanced V6's 10
    // days in a row needs that Sunday). AND WHAT A LINK IS (the same review): the page's own title uses the word, and a
    // newcomer may not know it — said as the Link Designer says it, "the rota everyone works through in turn"
    return `<p class="nl-lead">A <strong>link</strong> is the set of weeks everyone works through in turn: one week each, then on to
        the next, and from the last back to the first. Each proposal is ${weeks} weeks long: ${weeks - cover} weeks of set shifts, and
        ${cover} <strong>cover weeks</strong> kept free to cover leave and absence. A cover week has four shifts between Monday and
        Saturday, set nearer the time; “if a cover week falls badly” means those four shifts land in the worst place, and its
        Sunday is worked as overtime too.</p>`;
}

/** A plain bulleted list of sentences. @param {ReadonlyArray<string>} items @param {string} [cls] */
export function renderList(items, cls = 'nl-list') {
    return `<ul class="${cls}">${items.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;
}

/**
 * What all three give everyone and what they cost — two panels side by side on a wide screen, stacked on a phone, and
 * never one without the other. The headings are NOUNS the lines complete — "What it costs everyone: 42 finishes a year at
 * 23:00 or later" — because "Everyone gives up" turned half its own lines upside down (giving up late finishes would be a
 * gain; the review, 2 Nov 2026).
 * @param {{ gains: ReadonlyArray<string>, costs: ReadonlyArray<string> }} o
 */
export function renderCommon({ gains, costs }) {
    return `<div class="nl-common">
        <section class="nl-side nl-side--gain" aria-labelledby="nlGainsH"><h3 class="nl-side-h" id="nlGainsH"><span aria-hidden="true">✅</span> What everyone gains</h3>${renderList(gains)}</section>
        <section class="nl-side nl-side--cost" aria-labelledby="nlCostsH"><h3 class="nl-side-h" id="nlCostsH"><span aria-hidden="true">➖</span> What it costs everyone</h3>${renderList(costs)}</section>
    </div>
    <p class="nl-note"><strong>Fatigue warnings</strong> come from the Office of Rail and Road’s good-practice list of tiring
        patterns, and are never a pass or a fail. The counts here are the avoidable ones. They leave out the two that every
        link has: starts before 07:00, and shifts that change from one week to the next.</p>`;
}

/**
 * Where the three differ: for each proposal, A to Z, what it does better than BOTH of the other two and what it does worse —
 * the at-a-glance sheet's points, by its rule (newlink-data.js → DIFFERS, from edge-cost.mjs). The card the owner asked for
 * (12 Nov 2026): the page showed what the three share, and how each suits one kind of colleague, but what sets each apart was
 * only on the PDF.
 *
 * EVENLY (rule 1): every proposal gets the same two panels, in the same order, drawn exactly as "Whichever is chosen" draws a
 * gain and a cost (`.nl-side`), so the shape favours none. The LENGTHS are the rule's — a point is listed only where a figure
 * is clearly better, or worse, than both of the others — and the rule beneath says so, with what a count of points does NOT
 * mean, because "which has the most ticks?" is the first thing a hurried reader does with three lists. Every figure side by
 * side is the one-page comparison, offered as the pack card offers it (`fileRow`), so it opens in the PDF viewer the same way.
 * @param {{ differs: ReadonlyArray<import('./newlink-data.js').Differ>, rule: string, glance: PackFile|null, base: string }} o
 *   `glance` the one-page comparison from the pack — none, and the card offers no file
 */
export function renderDiffers({ differs, rule, glance, base }) {
    const slug = (/** @type {string} */ s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const side = (/** @type {'gain'|'cost'} */ kind, /** @type {ReadonlyArray<string>} */ items) => `<div class="nl-side nl-side--${kind}">
            <h4 class="nl-side-h"><span aria-hidden="true">${kind === 'gain' ? '✅' : '➖'}</span> ${kind === 'gain' ? 'Better' : 'Worse'} than the other two</h4>${renderList(items)}</div>`;
    const one = (/** @type {import('./newlink-data.js').Differ} */ d) => `<section class="nl-differ-one" aria-labelledby="nlDiffer-${slug(d.design)}">
        <h3 class="nl-sub" id="nlDiffer-${slug(d.design)}">${esc(d.design)}</h3>${side('gain', d.better)}${side('cost', d.worse)}
    </section>`;
    const ordered = aToZ(differs.map(d => ({ ...d, name: d.design })));
    return `<div class="nl-differ">${ordered.map(one).join('')}</div>
    <p class="nl-note">${esc(rule)}</p>${glance ? `<ul class="nl-files">${fileRow(glance, base)}</ul>` : ''}`;
}

/** "…prefer earlies" → "If you prefer earlies". @param {string} who */
export const ifYou = (who) => `If you ${who.replace(/^…/, '')}`;

/**
 * Where a column heading's long words may break, with a hyphen (the large-text check, 9 Nov 2026). With a phone's text at
 * 1.3 times, "BALANCED" was wider than its column at 360px and 375px and ran into the next heading. A soft hyphen is drawn
 * only where the line breaks, so wherever a word fits nothing changes. A long word not listed here still cannot spill —
 * newlink.css lets a heading break anywhere as a last resort — but it breaks with no hyphen, so a new design's long word
 * belongs here. e2e/newlink.spec.js measures every heading at 1.3 times the text.
 * @type {Readonly<Record<string, string>>}
 */
const HEADING_BREAKS = Object.freeze({ Balanced: 'Bal\u00adanced', Crossing: 'Cross\u00ading', Middle: 'Mid\u00addle' });

/** A column heading, escaped, with its listed words given their soft hyphens. @param {string} text */
function headingText(text) {
    return esc(text).replace(/[A-Za-z]+/g, w => HEADING_BREAKS[w] ?? w);
}

/**
 * A figure's words, escaped, with each run its no-break spaces hold together ("£140 more", "8h 06m") kept as ONE unit that
 * can still fit a narrow cell (bug check, 9 Nov 2026). The no-break spaces keep "£140" and "more" on one line wherever they
 * fit, but a no-break space is never a place to break: at 320px, or with a phone's text made larger, "£140 more" ran into
 * the next column. As an inline-block (newlink.css → .nl-nb) the run moves to a line of its own, whole, when it can, and
 * wraps inside itself only when even that line is too narrow. Wherever it fits, nothing changes.
 * @param {string} text
 */
function figureText(text) {
    return String(text).split(' ').map(w => w.includes('\u00a0') ? `<span class="nl-nb">${esc(w.replace(/\u00a0/g, ' '))}</span>` : esc(w)).join(' ');
}

/**
 * One kind of colleague's figures: today and the three proposals, a row per measure. Each row's label sits on its own
 * line above its four figures, so a phone never has to squeeze a label and four figures onto one line — and every figure
 * is tied to its label and its column by `headers`, so a screen reader reads "Average early, Middle Ground, 8h 09m".
 * @param {Persona} p @param {ReadonlyArray<string>} columns
 */
export function renderFigures(p, columns) {
    const col = (/** @type {number} */ i) => `nl-${p.id}-c${i}`;
    const head = `<thead><tr>${columns.map((c, i) => `<th scope="col" id="${col(i)}"${i === 0 ? ' class="nl-today"' : ''}>${headingText(c)}</th>`).join('')}</tr></thead>`;
    const body = p.rows.map((r, ri) => {
        const rid = `nl-${p.id}-r${ri}`;
        const cells = r.cells.map((c, i) => {
            const cls = [i === 0 ? 'nl-today' : '', c.best ? 'nl-best' : ''].filter(Boolean).join(' ');
            const text = c.best ? `<b>${figureText(c.text)}</b><span class="visually-hidden">, the best of the three</span>` : figureText(c.text);
            return `<td headers="${rid} ${col(i)}"${cls ? ` class="${cls}"` : ''}>${text}</td>`;
        }).join('');
        return `<tbody><tr class="nl-fig-label"><th colspan="${columns.length}" scope="rowgroup" id="${rid}">${esc(r.label)}</th></tr><tr class="nl-fig-row">${cells}</tr></tbody>`;
    }).join('');
    return `<table class="nl-fig"><caption class="visually-hidden">${esc(ifYou(p.who))}: today and the three proposals</caption>${head}${body}</table>${figuresKey(p)}`;
}

/**
 * The key beneath one table, saying only what that table uses (TEACH IN PLACE — the review, 2 Nov 2026: the green and
 * "up to" were explained only in the last card, which opens collapsed). Nothing when the table needs no key.
 * @param {Persona} p
 */
export function figuresKey(p) {
    const cells = p.rows.flatMap(r => r.cells);
    const lines = [
        cells.some(c => c.best) ? '<span class="nl-best-key">Green</span> is the best of the three for you.' : '',
        cells.some(c => /up to/.test(c.text)) ? '“Up to” is when a cover week falls in the worst place.' : '',
    ].filter(Boolean);
    return lines.length ? `<p class="nl-fig-key">${lines.join(' ')}</p>` : '';
}

/**
 * The "What it means if you…" panel for a choice: nothing chosen → the six one-line answers; one → its sentence and
 * figures; 'all' → every one. The sentence always comes before the table (Discover → Understand → Act).
 * @param {ReadonlyArray<Persona>} personas @param {ReadonlyArray<string>} columns @param {string|null} chosen  a persona id, 'all', or null
 */
export function renderPersonas(personas, columns, chosen) {
    if (!chosen) {
        return `<ul class="nl-gists">${personas.map(p => `<li><span class="nl-gist-icon" aria-hidden="true">${esc(p.icon)}</span><span><strong>${esc(ifYou(p.who))}.</strong> ${esc(p.gist)}</span></li>`).join('')}</ul>`;
    }
    const shown = chosen === 'all' ? personas : personas.filter(p => p.id === chosen);
    // A way back that says where it goes: the six short answers vanish once a tile is chosen, and pressing the chosen tile
    // again — the only route back until the review of 2 Nov 2026 — is nowhere written down.
    return shown.map(p => `<section class="nl-persona" aria-labelledby="nl-${p.id}-h">
        <h3 class="nl-persona-h" id="nl-${p.id}-h"><span aria-hidden="true">${esc(p.icon)}</span> ${esc(ifYou(p.who))}</h3>
        <p class="nl-gist">${esc(p.gist)}</p>
        ${renderFigures(p, columns)}
    </section>`).join('') + `<p class="nl-back-row"><button type="button" class="nl-back" data-persona-reset><span aria-hidden="true">←</span> Back to the six short answers</button></p>`;
}

/**
 * The tiles that choose a kind of colleague, plus "Everything": each the app's emoji over a short label, white and raised
 * on the card, the page's teal once chosen — a picker that looks pressable before it is pressed.
 * @param {ReadonlyArray<Persona>} personas @param {string|null} chosen
 */
export function renderPersonaChips(personas, chosen) {
    const tile = (/** @type {string} */ id, /** @type {string} */ icon, /** @type {string} */ label) =>
        `<button type="button" class="nl-tile${id === 'all' ? ' nl-tile--all' : ''}" data-persona="${esc(id)}" aria-pressed="${chosen === id}"><span class="nl-tile-icon" aria-hidden="true">${esc(icon)}</span><span class="nl-tile-label">${esc(label)}</span></button>`;
    return personas.map(p => tile(p.id, p.icon, p.chip)).join('') + tile('all', '📊', 'Everything');
}

/**
 * What kind of duty a roster cell is, by its start: the app's own classes (CLAUDE.md → Shift types) — Early 04:00–10:59,
 * Late 11:00–20:59, Night 21:00–03:59 — so a proposal's cell is coloured as the Calendar and Link Designer colour the same shift.
 * The pack's line between an early and a late is the same 11:00, so the colours agree with every figure on the page. None
 * of the three has a night today (the latest start is 15:45); a design that had one would draw it as a night, not a late
 * (the 22 Nov review), and the key would say so (`renderWeeksKey`).
 * @param {string} s  'HH:MM-HH:MM', 'RD' or 'SPARE'
 * @returns {'early'|'late'|'night'|'rest'|'cover'|'unknown'}
 */
export function dutyKind(s) {
    if (s === 'RD') return 'rest';
    if (s === 'SPARE') return 'cover';
    // The boundaries are `classifyShift`'s (link-designer-design.js), never restated here; what it cannot read it calls a night,
    // which is right for the Link Designer grid's `N:` flag and wrong for a cell drawn on this page — so an unreadable value is
    // asked first, through the same strict reading of a time, and stays 'unknown'.
    if (startMinutes(s) === null) return 'unknown';
    return /** @type {'early'|'late'|'night'} */ (classifyShift(s));
}

/**
 * One roster cell of a proposal, coloured by its kind.
 * @param {string} s
 */
function dayCell(s) {
    const kind = dutyKind(s);
    if (kind === 'early' || kind === 'late' || kind === 'night') {
        const [from, to] = s.split('-');
        return `<td class="nl-d nl-d--${kind}"><span>${from}</span><span class="visually-hidden"> to </span><span>${to}</span></td>`;
    }
    if (kind === 'rest') return `<td class="nl-d nl-d--rest">${short('RD', 'Rest day')}</td>`;
    if (kind === 'cover') return `<td class="nl-d nl-d--cover">Cover</td>`;
    return `<td class="nl-d">${esc(s)}</td>`;
}

/**
 * One proposal's weeks, Sunday to Saturday as the paper rosters run. A cover week (`isCoverWeek`: SPARE Monday to Saturday)
 * is one cell across the week, because its four shifts are not set until nearer the time. Its Sunday is not contracted and
 * not asked about, so one written as anything but SPARE — a rest day, an overtime duty — keeps its own cell beside it.
 * @param {Proposal} p
 */
export function renderWeeks(p) {
    const weeks = Object.keys(p.patterns).sort((a, b) => +a - +b);
    const head = `<thead><tr><th scope="col">${short('Wk', 'Week')}</th>${DAYS.map(d => `<th scope="col">${short(DAY_SHORT[d], DAY_LONG[d])}</th>`).join('')}</tr></thead>`;
    const rows = weeks.map(w => {
        const row = p.patterns[w];
        const lead = `<th scope="row">${esc(w)}</th>`;
        if (isCoverWeek(row)) {
            const sunday = row.sun === 'SPARE' ? '' : dayCell(row.sun);
            return `<tr class="nl-wk-cover">${lead}${sunday}<td colspan="${sunday ? 6 : 7}" class="nl-d nl-d--cover">Cover week</td></tr>`;
        }
        return `<tr>${lead}${DAYS.map(d => dayCell(row[d])).join('')}</tr>`;
    }).join('');
    return `<p class="nl-flag"><span aria-hidden="true">⚠️</span> A proposal — not your roster</p>
    <div class="nl-weeks-wrap" tabindex="0" role="group" aria-label="${esc(designName(p))}’s ${weeks.length} weeks"><table class="nl-weeks">
        <caption>${esc(designName(p))} <span class="nl-ref">${esc(p.ref)}</span></caption>
        ${head}<tbody>${rows}</tbody>
    </table></div>`;
}

/**
 * Every proposal's weeks, A to Z, the chosen one marked. A phone shows the chosen one and its tabs; a wide screen shows the
 * three side by side and no tabs (newlink.css), which compares them at a glance and gives none of them the first look — the
 * one a default tab gave to the first name in the alphabet (the review, 2 Nov 2026). Each keeps its own flag, so any one of
 * them, cropped, still says what it is.
 * @param {ReadonlyArray<Proposal>} proposals @param {string} chosen  a proposal id
 */
export function renderAllWeeks(proposals, chosen) {
    return `<div class="nl-weeks-all">${aToZ(proposals).map(p => `<div class="nl-weeks-one${p.id === chosen ? ' is-chosen' : ''}" data-weeks="${esc(p.id)}" tabindex="-1">${renderWeeks(p)}</div>`).join('')}</div>`;
}

/**
 * The key ABOVE the weeks: what each colour and word means, before 26 rows of it (it sat beneath them, a thousand pixels
 * from the tabs on a phone — the review, 2 Nov 2026). Sunday is said here too: the grids show Sunday shifts, and that
 * they are overtime was written only in the notes, which open folded. A Night swatch only where a proposal has a night,
 * so the key never explains a colour the grids do not use. And the printed sheets' own words (the 22 Nov review): the sheet
 * this page sends a reader to heads its weeks "LINE" and marks a cover week "SP".
 * @param {ReadonlyArray<Proposal>} [proposals]
 */
export function renderWeeksKey(proposals = []) {
    const night = proposals.some(p => Object.values(p.patterns).some(r => DAYS.some(d => dutyKind(r[d]) === 'night')));
    const late = night ? 'Late — starts from 11:00 to 20:59' : 'Late — starts at 11:00 or after';
    return `<ul class="nl-key">
        <li><span class="nl-swatch nl-d--early" aria-hidden="true"></span>Early — starts before 11:00</li>
        <li><span class="nl-swatch nl-d--late" aria-hidden="true"></span>${late}</li>
        ${night ? '<li><span class="nl-swatch nl-d--night" aria-hidden="true"></span>Night — starts at 21:00 or after, or before 04:00</li>' : ''}
        <li><span class="nl-swatch nl-d--rest" aria-hidden="true"></span>RD — rest day</li>
        <li><span class="nl-swatch nl-d--cover" aria-hidden="true"></span>Cover week — four shifts between Monday and Saturday, to cover leave and absence</li>
    </ul>
    <p class="nl-note">Sunday shifts are overtime. The weeks are numbered, not dated: who starts on which week is decided later.
        The code beside each name matches its printed proposal sheet. On the printed sheets a week is called a <strong>line</strong>,
        and a cover week is marked <strong>SP</strong>.</p>`;
}

/**
 * The three equal tabs that choose which proposal's weeks are drawn, A to Z — and beneath them the days of the week, for
 * when the tabs have stuck and the grid's own headings have scrolled away (the 22 Nov 2026 review: halfway down 26 rows a
 * time could not be tied to a day). The row is decorative (`aria-hidden`: every cell is already tied to its day by the
 * table) and hidden until newlink-app.js marks the tabs stuck, which also lays each day over its own column.
 * @param {ReadonlyArray<Proposal>} proposals @param {string} chosen  a proposal id
 */
export function renderWeeksTabs(proposals, chosen) {
    return aToZ(proposals).map(p => `<button type="button" class="nl-tab" data-design="${esc(p.id)}" aria-pressed="${p.id === chosen}">${esc(designName(p))}</button>`).join('')
        + `<div class="nl-tabs-days" aria-hidden="true">${DAYS.map(d => `<span data-day="${d}">${DAY_SHORT[d]}</span>`).join('')}</div>`;
}

/**
 * One pack file as a row to press: what it is, and how long. The ONE builder, so a file offered anywhere on the page — the
 * pack card's list, or the comparison under "Where they differ" — looks, reads and opens the same: in the PDF viewer, by its
 * `data-file` (newlink-app.js), and as a real link to the file for a modified click. Its design is said to a screen reader
 * first, because a row read on its own ("The proposal sheet") does not say whose.
 * @param {PackFile} f @param {string} base
 */
export function fileRow(f, base) {
    return `<li><a class="nl-file" href="${esc(base + f.path)}" data-file="${esc(f.path)}" aria-haspopup="dialog" target="_blank" rel="noopener noreferrer">
        <span class="nl-file-icon" aria-hidden="true">📄</span><span class="nl-file-name"><span class="visually-hidden">${esc(f.design ?? 'For all three')}: </span>${esc(f.label)}</span><span class="nl-file-meta">PDF · ${f.pages} ${f.pages === 1 ? 'page' : 'pages'}</span></a></li>`;
}

/**
 * The pack's colleague files, a group per proposal A to Z, then what applies to all three. Each OPENS ON THIS PAGE, in the
 * app's PDF viewer with a ✕ (pdf-viewer.js, wired by newlink-app.js through `data-file`): opened as a link, an app
 * installed from the github.io address showed the PDF in its own window, where an iPhone has no way back (owner, 10 Nov
 * 2026). The link stays a real link to the file, so a Ctrl-, Cmd- or middle-click still gives a desktop reader a tab.
 * @param {ReadonlyArray<PackFile>} pack @param {string} base  where docs/links-26/ is served
 */
export function renderPack(pack, base) {
    const link = (/** @type {PackFile} */ f) => fileRow(f, base);
    // A TO Z HERE TOO (rule 1; the 22 Nov review): the generator writes the pack A to Z and asserts it, but `aToZ` promises every
    // list of the three on the page — this one took the data's order on trust
    const designs = aToZ([...new Set(pack.filter(f => f.design).map(f => /** @type {string} */ (f.design)))].map(name => ({ name }))).map(d => d.name);
    const groups = designs.map(d => `<h3 class="nl-sub">${esc(d)}</h3><ul class="nl-files">${pack.filter(f => f.design === d).map(link).join('')}</ul>`);
    const common = pack.filter(f => !f.design);
    if (common.length) groups.push(`<h3 class="nl-sub">For all three</h3><ul class="nl-files">${common.map(link).join('')}</ul>`);
    return groups.join('') + '<p class="nl-note">The files open on this page, and need a connection.</p>';
}

/**
 * The one-page comparison in the pack, found by its file rather than its place in the list — "Where they differ" offers it
 * only while the pack has it. Null when it has gone.
 * @param {ReadonlyArray<PackFile>} pack
 */
export const glanceFile = (pack) => pack.find(f => f.path.endsWith('at-a-glance.pdf')) ?? null;

/**
 * The one line a screen reader hears when the choice of colleague changes (a polite live region: newlink-app.js). "The six
 * short answers" is the way back's own name (`renderPersonas`), so the button and the line agree.
 * @param {ReadonlyArray<Persona>} personas @param {string|null} chosen  a persona id, 'all', or null
 */
export function personaStatus(personas, chosen) {
    if (!chosen) return 'Showing the six short answers, below.';
    if (chosen === 'all') return 'Showing all six, with their figures, below.';
    const p = personas.find(x => x.id === chosen);
    return p ? `Showing ${ifYou(p.who).replace(/^If/, 'what it means if')}, with its figures, below.` : '';
}

/** The one line a screen reader hears when a proposal's weeks are shown. @param {Proposal} p */
export const weeksStatus = (p) => `Showing ${designName(p)}’s ${Object.keys(p.patterns).length} weeks, below.`;

/**
 * The weeks card's title, counted from the proposals ("The 26 weeks"), as every other count on the page is — or plain
 * "The weeks" while the three are not the same length.
 * @param {ReadonlyArray<Proposal>} proposals
 */
export function weeksTitle(proposals) {
    const n = new Set(proposals.map(p => Object.keys(p.patterns).length));
    return n.size === 1 ? `The ${[...n][0]} weeks` : 'The weeks';
}
