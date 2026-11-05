// @ts-check
/**
 * newlink-render.js — every word of HTML on the new link page (newlink.html), as pure functions.
 *
 * The coordinator (newlink-app.js) decides WHICH view is on screen; this module builds it, from the generated figures
 * (newlink-data.js), the built-in proposals (links-proposals.js) and the page's settings (newlink-config.js). Nothing here
 * reads the DOM, the clock or the network, so every surface the page can show is testable in Node
 * (newlink-render.test.mjs).
 *
 * ── THREE RULES THE PAGE KEEPS ─────────────────────────────────────────────────────────────────
 *
 *  1. EVENLY. The three proposals appear A to Z everywhere, in the same colour, and nothing here names a recommendation
 *     (owner, 2 Nov 2026: "No, three evenly"). The one mark that singles a design out is the sheet's own — bold green on
 *     the clear best of the three FOR ONE KIND OF COLLEAGUE, row by row — and it lands on each of the three somewhere.
 *  2. NOT YOUR ROSTER. A proposal's weeks are labelled as a proposal wherever they are drawn, numbered by week rather than
 *     dated, and framed unlike any roster surface — so a screenshot of one cannot be mistaken for a roster.
 *  3. TEACH IN PLACE (CLAUDE.md → "Plain English that TEACHES"). Each figure is a row a colleague can read without the
 *     pack: the sheet's own label, today beside it for scale, and the sentence that sums it up first.
 *
 * No `title` attribute anywhere: an OS tooltip is invisible on a phone (native-surface-parity). A short form that needs
 * its long form says it to a screen reader in a visually hidden span instead.
 */
import { escapeHtml as esc } from './roster-data.js';

/** @typedef {import('./newlink-data.js').Persona} Persona */
/** @typedef {import('./newlink-data.js').Row} Row */
/** @typedef {import('./newlink-data.js').PackFile} PackFile */
/** @typedef {import('./links-proposals.js').Proposal} Proposal */

const DAYS = /** @type {const} */ (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
const DAY_SHORT = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };
const DAY_LONG = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };

/** Short on screen, whole to a screen reader. @param {string} shown @param {string} said */
const short = (shown, said) => `<span aria-hidden="true">${esc(shown)}</span><span class="visually-hidden">${esc(said)}</span>`;

/** A proposal's name without the built-in list's " — Dec 2026" suffix. @param {{ name: string }} p */
export const designName = (p) => p.name.replace(/ — Dec 2026$/, '');

/**
 * The proposals in the order this page shows them — A TO Z by name, whatever order they arrive in (rule 1). The built-in
 * list is A to Z as well since 5 Nov 2026 (links-proposals.js), and for two days before that it put the recommendation
 * first: the page has never taken its order on trust, and still does not — every list of the three here passes through this.
 * @template {{ name: string }} P @param {ReadonlyArray<P>} proposals @returns {P[]}
 */
export const aToZ = (proposals) => [...proposals].sort((a, b) => designName(a).localeCompare(designName(b), 'en-GB'));

/**
 * The closing date in words — or "a date to be agreed" while there is none (owner: "Not set yet").
 * A malformed date reads as not set, never as "Invalid Date" — nor as the day it rolls over to: `new Date` turns
 * 31 February into 3 March without complaint, so the parts must come back as they went in.
 * @param {string|null} closes 'YYYY-MM-DD'
 */
export function closesWords(closes) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(closes ?? '');
    if (!m) return 'a date to be agreed';
    const d = new Date(+m[1], +m[2] - 1, +m[3], 12);
    if (d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) return 'a date to be agreed';
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * When the new link starts, as "1 January 2027" — or null for anything that is not a real 'YYYY-MM-DD', so the page says
 * nothing rather than something untrue.
 * @param {string|null|undefined} starts
 */
export function startsWords(starts) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(starts ?? '');
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], 12);
    if (d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) return null;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * The status card's body: what the page is, the three names (one equal tile each, A to Z), and by when views are wanted.
 * @param {{ proposals: ReadonlyArray<Proposal>, closes: string|null, starts?: string|null }} o
 */
export function renderStatus({ proposals, closes, starts = null }) {
    // Each tile LOOKS pressable — white, raised, the page's button recipe — so it is one: it opens that proposal's weeks
    // (the review, 2 Nov 2026: three raised tiles that did nothing broke the page's own rule that raised means pressable).
    // The name and nothing else: the sheet code told a colleague nothing and took a second line on a phone, so it lives on
    // the weeks' caption, beside the grid it identifies, and nowhere a choice is made.
    const tiles = aToZ(proposals).map(p => `<li><button type="button" class="nl-name" data-open-weeks="${esc(p.id)}"><span class="nl-name-title">${esc(designName(p))}</span><span class="nl-name-go">See its weeks</span></button></li>`).join('');
    // "Have your say" is a way there, as the name tiles are: it opens and shows that card.
    // The link and the timetable change on DIFFERENT dates (owner, 2 Nov 2026), and the gap is the question a colleague
    // asks next: which link do I work in between? Today's, until the new one starts.
    const from = startsWords(starts);
    // The day and the month stay together (a no-break space): at 390px the line broke after the "1" and left it stranded.
    const when = from ? ` The new link starts on ${esc(from).replace(' ', '\u00a0')}. The new timetable comes first, in December, and today’s link carries on until then.` : '';
    return `<p class="nl-callout"><strong>Nothing is decided.</strong>${when}
        These are the three proposals on the shortlist, in alphabetical order.</p>
    <ul class="nl-names" aria-label="The three proposals">${tiles}</ul>
    ${weeksShape(proposals)}
    <p class="nl-lead">Nothing on this page changes your roster. <button type="button" class="nl-inline" data-open-card="nlSay">Have your say</button> by <strong>${esc(closesWords(closes))}</strong>.</p>`;
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
        return { weeks: weeks.length, cover: weeks.filter(r => DAYS.every(d => r[d] === 'SPARE')).length };
    });
    const [{ weeks, cover }] = shapes;
    if (!cover || !shapes.every(s => s.weeks === weeks && s.cover === cover)) return '';
    return `<p class="nl-lead">Each is ${weeks} weeks long: ${weeks - cover} set weeks, and ${cover} <strong>cover weeks</strong>
        kept free to cover leave and absence. A cover week has four shifts between Monday and Saturday, set nearer the time.</p>`;
}

/**
 * The preview banner — for the admin and the named previewers alone, above everything colleagues will see. It says who
 * the page will reach, because the audience is a setting nobody else can check (newlink-config.js → AUDIENCE), and who
 * else can see it now, because "only you" stopped being true the day a second person could (v25.33: S. Silva).
 * @param {{ audience: string[], decided: boolean, others?: string[] }} o  decided: AUDIENCE is a list, not the every-CEA
 *   stand-in. others: everyone else who can see the preview, as they should be named to this reader ("the admin", a name)
 */
export function renderPreviewBanner({ audience, decided, others = [] }) {
    const who = decided ? `the ${audience.length} people on the new link` : `every CEA on the roster (${audience.length}) until the 26 on the new link are decided`;
    const alsoSees = others.length === 0 ? ''
        : ` and ${others.length === 1 ? others[0] : `${others.slice(0, -1).join(', ')} and ${others[others.length - 1]}`}`;
    return `<p class="nl-preview-head"><span aria-hidden="true">👁️</span> <strong>Preview — only you${esc(alsoSees)} can see this page.</strong></p>
    <p>When it opens it will be for ${esc(who)}. Below is exactly what they will see.</p>
    <details class="nl-preview-who"><summary>Who it would reach</summary><p>${audience.map(esc).join(', ')}</p></details>`;
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
        patterns — reported as found, never as a pass or a fail.</p>`;
}

/** "…prefer earlies" → "If you prefer earlies". @param {string} who */
export const ifYou = (who) => `If you ${who.replace(/^…/, '')}`;

/**
 * One kind of colleague's figures: today and the three proposals, a row per measure. Each row's label sits on its own
 * line above its four figures, so a phone never has to squeeze a label and four figures onto one line — and every figure
 * is tied to its label and its column by `headers`, so a screen reader reads "Average early, Common Ground, 8h 09m".
 * @param {Persona} p @param {ReadonlyArray<string>} columns
 */
export function renderFigures(p, columns) {
    const col = (/** @type {number} */ i) => `nl-${p.id}-c${i}`;
    const head = `<thead><tr>${columns.map((c, i) => `<th scope="col" id="${col(i)}"${i === 0 ? ' class="nl-today"' : ''}>${esc(c)}</th>`).join('')}</tr></thead>`;
    const body = p.rows.map((r, ri) => {
        const rid = `nl-${p.id}-r${ri}`;
        const cells = r.cells.map((c, i) => {
            const cls = [i === 0 ? 'nl-today' : '', c.best ? 'nl-best' : ''].filter(Boolean).join(' ');
            const text = c.best ? `<b>${esc(c.text)}</b><span class="visually-hidden">, the best of the three</span>` : esc(c.text);
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
 * What kind of duty a roster cell is. An early starts before 11:00 and a late at 11:00 or after — the pack's own line,
 * so the colours here agree with every figure on the page.
 * @param {string} s  'HH:MM-HH:MM', 'RD' or 'SPARE'
 * @returns {'early'|'late'|'rest'|'cover'|'unknown'}
 */
export function dutyKind(s) {
    if (s === 'RD') return 'rest';
    if (s === 'SPARE') return 'cover';
    const m = /^(\d\d):(\d\d)-\d\d:\d\d$/.exec(s);
    if (!m) return 'unknown';
    return +m[1] * 60 + +m[2] < 11 * 60 ? 'early' : 'late';
}

/**
 * One proposal's 26 weeks, Sunday to Saturday as the paper rosters run. A cover week (every day SPARE) is one cell
 * across the week, because its four shifts are not set until nearer the time.
 * @param {Proposal} p
 */
export function renderWeeks(p) {
    const weeks = Object.keys(p.patterns).sort((a, b) => +a - +b);
    const head = `<thead><tr><th scope="col">${short('Wk', 'Week')}</th>${DAYS.map(d => `<th scope="col">${short(DAY_SHORT[d], DAY_LONG[d])}</th>`).join('')}</tr></thead>`;
    const rows = weeks.map(w => {
        const row = p.patterns[w];
        const lead = `<th scope="row">${esc(w)}</th>`;
        if (DAYS.every(d => row[d] === 'SPARE')) return `<tr class="nl-wk-cover">${lead}<td colspan="7" class="nl-d nl-d--cover">Cover week</td></tr>`;
        return `<tr>${lead}${DAYS.map(d => {
            const s = row[d], kind = dutyKind(s);
            if (kind === 'early' || kind === 'late') {
                const [from, to] = s.split('-');
                return `<td class="nl-d nl-d--${kind}"><span>${from}</span><span class="visually-hidden"> to </span><span>${to}</span></td>`;
            }
            if (kind === 'rest') return `<td class="nl-d nl-d--rest">${short('RD', 'Rest day')}</td>`;
            if (kind === 'cover') return `<td class="nl-d nl-d--cover">Cover</td>`;
            return `<td class="nl-d">${esc(s)}</td>`;
        }).join('')}</tr>`;
    }).join('');
    return `<p class="nl-flag"><span aria-hidden="true">⚠️</span> A proposal — not your roster</p>
    <div class="nl-weeks-wrap"><table class="nl-weeks">
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
 * they are overtime was written only in the notes, which open folded.
 */
export function renderWeeksKey() {
    return `<ul class="nl-key">
        <li><span class="nl-swatch nl-d--early" aria-hidden="true"></span>Early — starts before 11:00</li>
        <li><span class="nl-swatch nl-d--late" aria-hidden="true"></span>Late — starts at 11:00 or after</li>
        <li><span class="nl-swatch nl-d--rest" aria-hidden="true"></span>RD — rest day</li>
        <li><span class="nl-swatch nl-d--cover" aria-hidden="true"></span>Cover week — four shifts between Monday and Saturday, to cover leave and absence</li>
    </ul>
    <p class="nl-note">Sunday shifts are overtime. The weeks are numbered, not dated: who starts on which week is decided later.
        The code beside each name matches its printed proposal sheet.</p>`;
}

/** The three equal tabs that choose which proposal's weeks are drawn, A to Z. @param {ReadonlyArray<Proposal>} proposals @param {string} chosen  a proposal id */
export function renderWeeksTabs(proposals, chosen) {
    return aToZ(proposals).map(p => `<button type="button" class="nl-tab" data-design="${esc(p.id)}" aria-pressed="${p.id === chosen}">${esc(designName(p))}</button>`).join('');
}

/**
 * The pack's colleague files, a group per proposal A to Z, then what applies to all three. Each opens in a new tab: a PDF
 * is a document to read or print, not a page of the app.
 * @param {ReadonlyArray<PackFile>} pack @param {string} base  where docs/links-26/ is served
 */
export function renderPack(pack, base) {
    const link = (/** @type {PackFile} */ f) => `<li><a class="nl-file" href="${esc(base + f.path)}" target="_blank" rel="noopener noreferrer">
        <span class="nl-file-icon" aria-hidden="true">📄</span><span class="nl-file-name"><span class="visually-hidden">${esc(f.design ?? 'For all three')}: </span>${esc(f.label)}</span><span class="nl-file-meta">PDF · ${f.pages} ${f.pages === 1 ? 'page' : 'pages'}<span class="visually-hidden">, opens in a new tab</span></span></a></li>`;
    const designs = [...new Set(pack.filter(f => f.design).map(f => /** @type {string} */ (f.design)))];
    const groups = designs.map(d => `<h3 class="nl-sub">${esc(d)}</h3><ul class="nl-files">${pack.filter(f => f.design === d).map(link).join('')}</ul>`);
    const common = pack.filter(f => !f.design);
    if (common.length) groups.push(`<h3 class="nl-sub">For all three</h3><ul class="nl-files">${common.map(link).join('')}</ul>`);
    return groups.join('') + '<p class="nl-note">The files open in a new tab, and need a connection.</p>';
}
