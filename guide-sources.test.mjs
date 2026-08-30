// guide-sources.test.mjs — structural guard for the GUIDE_SOURCES.md source register.
//
// The app enforces its CODE governance in CI; this test extends the same discipline to the
// OPERATIONAL-CONTENT register that backs the Railcard and FIP guides (the v17.45 audit's
// "content assurance" gap). It parses the register table and fails the build if a high-risk
// row loses its source, its review dates, or its National/Local classification — so the
// register cannot silently rot back to "Verified <month>" with no per-section provenance.
//
// It is a STRUCTURAL guard, deliberately not a date-driven "review overdue" tripwire: a test
// that fails purely because today's date passed a Next-review month would break unrelated
// commits (a time bomb). The review cadence is a documented manual process (like the monthly
// notice cleanup) driven by the Next column — this test only guarantees that column exists and
// is coherent (Next strictly after Reviewed). Part of `npm run test:hygiene`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./GUIDE_SOURCES.md', import.meta.url), 'utf8');

// `Draft` (v20.05) means RECORDED BUT NOT VERIFIED — the source is identified and the claim is
// written down, but nobody has read it at that source. It exists because the Rangers & Rovers guide
// had to be built from public summaries (the official pages are unreachable from this environment),
// and the alternative was worse in both directions: classify those rows `National` and the register
// certifies something nobody checked, or leave them out and the guide's riskiest claims have no rows
// at all. A named class makes the gap countable, and the test below makes it visible on the page.
// `Conflict` (v20.10) is the OTHER kind of not-settled, and collapsing the two would lose the whole
// point of naming either. `Draft` = we have not looked. `Conflict` = we looked, and the source is
// the problem — it contradicts itself, or another currently-published authoritative source. A
// Conflict row is BETTER evidence than a Draft one (somebody read the page) and is NOT closer to
// being resolved, because no amount of re-reading fixes a publisher's contradiction. Both must stay
// visibly provisional on the page; only the wording differs.
const CLASSES = new Set(['National', 'Local', 'Tip', 'Fact', 'Contact', 'Draft', 'Conflict']);

/* The classes a reader must be TOLD about, and the markers that satisfy each. The markers are NOT
 * interchangeable between classes: a Conflict wearing the draft marker would tell a staff member
 * "not checked yet" about a claim that HAS been checked and cannot be settled — the misreading that
 * sends them back to the same page for the same answer.
 *
 * ── CLAIM-LEVEL EVIDENCE (v20.37) ──────────────────────────────────────────────────────────────
 * Each class lists the markers that satisfy it. It was one marker per class, which silently assumed
 * THE WHOLE CARD is the unit of uncertainty — and that assumption had a cost the Shakespeare
 * Explorer card was paying: one unresolved break-of-journey footnote forced `.rr-card--conflict`
 * onto the entire product, so its basic validity read as doubtful because of a secondary condition.
 *
 * A Conflict may therefore now be carried by a claim-level callout (`.rr-unresolved`) as well as by
 * a whole card. This is a GENERALISATION, not a relaxation: the citing element must still carry a
 * visible conflict marker of its own, and `.rr-unresolved` is a red, explicitly-worded block — it
 * is not a quieter way of saying the same thing. What it buys is that the confirmed claims beside
 * it stop inheriting its uncertainty.
 *
 * Draft keeps a single marker deliberately. Draft means nobody has read the source, which is a
 * statement about the whole product, not about one claim within it. */
// Markers that make a provisional claim VISIBLE, per class. The list is per-class rather than
// per-guide because the two guides express the same idea in their own idiom — the Rangers page
// tints a whole card (`rr-card--draft`) or a single callout (`rr-unresolved`); the Railcard page
// has only ever needed the claim-level form (`rc-unsourced`). What must not drift is the RULE:
// a Draft and a Conflict may never share a marker, in either dialect.
const PROVISIONAL = {
    Draft:    ['rr-card--draft', 'rc-unsourced'],
    Conflict: ['rr-card--conflict', 'rr-unresolved'],
};
const COLS = ['ID', 'Guide', 'Section', 'Class', 'Reviewed', 'Next', 'Source'];

/**
 * Parse the register table under the "## Register" heading into row objects.
 * Only rows with the full 7-column shape are returned; the header and the
 * `|---|` separator are skipped, as is every other markdown table in the file.
 * @returns {Array<Record<string,string>>}
 */
function parseRegister() {
    const lines = SRC.split('\n');
    const start = lines.findIndex(l => l.trim() === '## Register');
    assert.ok(start !== -1, 'GUIDE_SOURCES.md must contain a "## Register" section');
    const rows = [];
    let sawHeader = false;
    for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('## ')) break;               // next section ends the register
        if (!line.startsWith('|')) continue;
        const cells = line.split('|').slice(1, -1).map(c => c.trim());
        if (cells[0] === 'ID') { sawHeader = true; continue; }   // header row
        if (/^-+$/.test(cells[0].replace(/[:\s]/g, '') || '-')) continue; // separator row
        if (cells.length !== COLS.length) continue;      // not a register data row
        const row = {};
        COLS.forEach((c, idx) => { row[c] = cells[idx]; });
        rows.push(row);
    }
    assert.ok(sawHeader, 'the Register table header row was not found');
    return rows;
}

const rows = parseRegister();

test('register has a meaningful number of high-risk entries', () => {
    // Guards against the table being gutted to a stub. The audit named at least: railcards,
    // GroupSave, FIP allocation, FIP carrier acceptance, contacts, pay/tax.
    assert.ok(rows.length >= 15, `expected >= 15 register entries, found ${rows.length}`);
});

test('every row has all seven columns filled', () => {
    for (const row of rows) {
        for (const col of COLS) {
            assert.ok(row[col] && row[col].length > 0, `row ${row.ID || '(no id)'} has an empty "${col}"`);
        }
    }
});

test('IDs are unique and slug-shaped', () => {
    const seen = new Set();
    for (const row of rows) {
        assert.match(row.ID, /^[a-z0-9-]+$/, `ID "${row.ID}" is not a lowercase slug`);
        assert.ok(!seen.has(row.ID), `duplicate ID "${row.ID}"`);
        seen.add(row.ID);
    }
});

test('every Class is one of the allowed values', () => {
    for (const row of rows) {
        assert.ok(CLASSES.has(row.Class), `row ${row.ID}: class "${row.Class}" is not one of ${[...CLASSES].join('/')}`);
    }
});

// The Guide column must be a known guide. Without this, a MISTYPED Guide value (e.g. "railcrd")
// would silently exempt a high-risk row from BOTH the block-anchoring requirement and orphan
// detection below (those checks only iterate the known guides) — reopening the exact
// "wrong claim, un-cross-referenced source" gap the linkage checks exist to close.
const GUIDES = new Set(['railcard', 'fip', 'paycalc', 'rangers']);
test('every Guide is one of the allowed guides', () => {
    for (const row of rows) {
        assert.ok(GUIDES.has(row.Guide), `row ${row.ID}: guide "${row.Guide}" is not one of ${[...GUIDES].join('/')}`);
    }
});

test('Reviewed and Next are YYYY-MM and Next is strictly after Reviewed', () => {
    for (const row of rows) {
        assert.match(row.Reviewed, /^\d{4}-\d{2}$/, `row ${row.ID}: Reviewed "${row.Reviewed}" is not YYYY-MM`);
        assert.match(row.Next, /^\d{4}-\d{2}$/, `row ${row.ID}: Next "${row.Next}" is not YYYY-MM`);
        const [ry, rm] = row.Reviewed.split('-').map(Number);
        const [ny, nm] = row.Next.split('-').map(Number);
        assert.ok(ny * 12 + nm > ry * 12 + rm, `row ${row.ID}: Next (${row.Next}) must be after Reviewed (${row.Reviewed})`);
        assert.ok(rm >= 1 && rm <= 12 && nm >= 1 && nm <= 12, `row ${row.ID}: month out of range`);
    }
});

test('every Source is a URL, a code: ref, or internal', () => {
    for (const row of rows) {
        const ok = /^https?:\/\/\S+$/.test(row.Source) || /^code:\S+$/.test(row.Source) || row.Source === 'internal';
        assert.ok(ok, `row ${row.ID}: Source "${row.Source}" is not an http(s) URL, code: ref, or "internal"`);
    }
});

// A per-country FIP row must cite THAT COUNTRY'S page, not the Europe landing page.
//
// This is the difference between a source register and a bibliography. Every one of these rows makes
// a specific, money-and-travel-relevant claim — a supplement in euros, which operators refuse FIP,
// whether a coupon covers a neighbouring territory. Cited to the landing page, a claim cannot be
// re-checked without re-deriving it from scratch, which is precisely the work the register exists to
// save. `fip-at` sat that way for a while: the facts were right and corroborated, but nobody could
// confirm them from the citation, and it was invisible because the generic "Source is a URL" check
// above passes a landing-page URL happily.
//
// Only ids of the form `fip-<cc>` are policed. The cross-cutting rows (`fip-eligibility`,
// `fip-journey-coupon`, `fip-carrier-accept`, `fip-contact`) describe the scheme rather than a
// country, and the landing page is genuinely their best source.
test('every per-country FIP row cites that country\'s own RDG page, not the landing page', () => {
    const countryRows = rows.filter(r => /^fip-[a-z]{2}$/.test(r.ID));
    assert.ok(countryRows.length >= 9,
        `expected the FIP guide's per-country rows to still be present, found ${countryRows.length}`);

    const offenders = countryRows
        .filter(r => !r.Source.includes('/europe-and-fip/countries/'))
        .map(r => `${r.ID} → ${r.Source}`);

    assert.deepEqual(offenders, [],
        'these per-country rows cite something other than their own country page:\n  ' +
        offenders.join('\n  ') +
        '\nFind the country page from https://www.raildeliverygroup.com/rst/europe-and-fip.html and ' +
        'cite it. Do NOT guess the numeric id — an unopened id reads as verified and can point at the ' +
        'wrong country. (The ids ascend alphabetically, so a browser check is two or three links.)');
});

test('the railcard time-rule cards flagged in the audit are present and classified National', () => {
    // These are the exact rows whose wrong/over-absolute wording drove the v17.45 guide score down;
    // keep them in the register so a future edit can't drop their provenance.
    const required = ['rc-forces', 'rc-ff-peak', 'rc-senior-peak', 'rc-groupsave', 'rc-twotogether', 'rc-gold'];
    const byId = new Map(rows.map(r => [r.ID, r]));
    for (const id of required) {
        const row = byId.get(id);
        assert.ok(row, `required register entry "${id}" is missing`);
        assert.equal(row.Class, 'National', `entry "${id}" should be classified National`);
    }
});

// ── Block ↔ source linkage (v17.59, Tier 3) ────────────────────────────────
// The structural checks above prove the register is COHERENT; they can't prove it is
// CONNECTED to the guides it vouches for. That gap is exactly how the Germany/Hungary/Italy
// FIP errors shipped — a wrong claim sat in the HTML with a "correct" register row nobody
// cross-referenced. Each high-risk guide block now carries a `data-guide-source="<id>"`
// attribute naming its register row; these tests enforce the two-way contract:
//   • every attribute in the HTML points at a real register row (no orphan refs), and
//   • every railcard/fip register row is referenced by at least one block (no dead rows).
// So a claim can no longer drift from the source that certifies it, in either direction.

// Which guide file each Guide value lives in. Rows in other guides (paycalc) are exempt from
// the HTML-block requirement — they render on a different surface with no data-guide-source blocks.
const GUIDE_FILES = { railcard: 'railcard-guide.html', fip: 'fip.html', rangers: 'rangers-guide.html' };

/**
 * Pull every `data-guide-source="a b c"` value out of an HTML file, space-splitting so one
 * block can cite multiple rows (e.g. the FIP coupon step cites allocation + expiry).
 * @param {string} file
 * @returns {string[]} referenced register IDs, in document order (dupes preserved)
 */
function refsInFile(file) {
    const html = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    const ids = [];
    for (const m of html.matchAll(/data-guide-source="([^"]+)"/g)) {
        for (const id of m[1].trim().split(/\s+/)) if (id) ids.push(id);
    }
    return ids;
}

const registerIds = new Set(rows.map(r => r.ID));
const refsByFile = new Map(Object.values(GUIDE_FILES).map(f => [f, refsInFile(f)]));

test('every data-guide-source in the guides points at a real register row (no orphan refs)', () => {
    for (const [file, ids] of refsByFile) {
        for (const id of ids) {
            assert.ok(registerIds.has(id),
                `${file}: data-guide-source="${id}" has no matching row in the GUIDE_SOURCES register`);
        }
    }
});

test('a block cites a row from its OWN guide (railcard blocks cite railcard rows, fip cite fip)', () => {
    const guideOf = new Map(rows.map(r => [r.ID, r.Guide]));
    for (const [guide, file] of Object.entries(GUIDE_FILES)) {
        for (const id of refsByFile.get(file)) {
            assert.equal(guideOf.get(id), guide,
                `${file}: cites "${id}", whose register Guide is "${guideOf.get(id)}" not "${guide}"`);
        }
    }
});

test('every railcard/fip register row is referenced by at least one guide block (no dead rows)', () => {
    for (const [guide, file] of Object.entries(GUIDE_FILES)) {
        const referenced = new Set(refsByFile.get(file));
        for (const row of rows.filter(r => r.Guide === guide)) {
            assert.ok(referenced.has(row.ID),
                `register row "${row.ID}" (${guide}) is not anchored by any data-guide-source in ${file} — ` +
                `add data-guide-source="${row.ID}" to the block it certifies, or remove the dead row`);
        }
    }
});

// ── The rendered "Checked" date must match the register (v19.05) ─────────────
//
// The two-way ref contract above proves each claim is ANCHORED to a row. It does not check the one
// thing staff actually read: the date. Nine FIP country cards render "✓ Checked Jul 2026 — carrier
// rules change; reconfirm with RDG before you travel", hand-copied from the row's `Reviewed` column
// with nothing tying the two together.
//
// That is the highest-stakes drift in the guide system, and it fails in both directions. Re-review a
// country and bump only the register → the page understates its freshness. Edit the page text without
// the register → the page OVER-claims, and a staff member trusts travel information on the strength
// of a date that no review stands behind. Everywhere else in this codebase a hand-copied cross-file
// value gets a parity guard; this one is user-facing accuracy, so it earns one more than most.
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

test('every rendered "Checked <Mon> <Year>" matches its register row Reviewed date', () => {
    const reviewedOf = new Map(rows.map(r => [r.ID, r.Reviewed]));
    let checked = 0;
    for (const file of Object.values(GUIDE_FILES)) {
        const html = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
        // Each <details> block that names a register row AND renders a Checked date.
        for (const m of html.matchAll(/data-guide-source="([^"]+)"([\s\S]*?)<\/details>/g)) {
            const dm = m[2].match(/Checked\s+([A-Z][a-z]{2})\s+(\d{4})/);
            if (!dm) continue;
            const id = m[1].trim().split(/\s+/)[0];
            const mi = MONTHS.indexOf(dm[1]);
            assert.ok(mi >= 0, `${file}: "${dm[1]}" is not a recognised month abbreviation`);
            const shown = `${dm[2]}-${String(mi + 1).padStart(2, '0')}`;
            assert.equal(shown, reviewedOf.get(id),
                `${file}: the card for "${id}" shows "Checked ${dm[1]} ${dm[2]}" (${shown}) but its ` +
                `register row says Reviewed ${reviewedOf.get(id)} — a freshness date staff rely on must ` +
                `never be older or newer than the review that backs it`);
            checked++;
        }
    }
    assert.ok(checked >= 9, `expected the nine sourced FIP country cards to show a date, found ${checked}`);
});

// ── EVERY COUNTRY AND FERRY CARD SHOWS ITS EVIDENCE STATE (v20.31) ──────────────────────────────
//
// The test above proves a date that IS shown is honest. It says nothing about a card that shows
// none — and that is the gap the page fell into. Between v20.25 and v20.30 the country audit ran a
// card at a time, each pass adding a "✓ Checked …" line to the cards it had just verified. By the
// end all 33 country and ferry cards had been read against their live Rail Staff Travel page and
// eleven of them still carried no line, purely because of which pass had touched them.
//
// That is worse than it sounds. The page's own country-finder note tells the reader, correctly,
// that "a card with no date has not yet been re-verified — treat it as a starting point, not a
// ruling". So eleven fully-sourced cards were actively telling staff to trust them less. An
// evidence marker that is present or absent by accident does not merely fail to inform; it
// misinforms, and it does so in the direction of the reader dismissing good information.
//
// The failure mode is silent both ways, which is why it needs a test rather than a convention:
// nothing renders wrong, nothing throws, and the missing line looks exactly like a deliberate
// "not checked". So the invariant is now structural — a country or ferry card carries an evidence
// line, or this fails. Adding a new card means deciding its evidence state, which is the decision
// that was being skipped.
test('every FIP country and ferry card states its evidence state', () => {
    const html = readFileSync(new URL('./fip.html', import.meta.url), 'utf8');
    const cards = [...html.matchAll(/<details id="((?:country-|ferry-)[^"]+)"[^>]*>([\s\S]*?)<\/details>/g)];
    assert.ok(cards.length >= 30,
        `expected the country/ferry cards to be found, got ${cards.length} — has the markup changed?`);
    const bare = cards.filter(m => !/class="country-reviewed"/.test(m[2])).map(m => m[1]);
    assert.deepEqual(bare, [],
        `these FIP cards render no evidence line: ${bare.join(', ')}. The country-finder note tells ` +
        `readers an undated card is unverified, so a sourced card without one understates itself. ` +
        `Add the "✓ Checked <Mon> <Year> against Rail Staff Travel" line — or, if it genuinely is ` +
        `unverified, say so in the card rather than leaving the reader to infer it from silence`);
    // And every card must also cite the register row that backs it — an evidence line with no
    // anchor is a claim about a review nothing records.
    const unanchored = cards.filter(m => !/data-guide-source=/.test(m[0].slice(0, m[0].indexOf('>'))))
        .map(m => m[1]);
    assert.deepEqual(unanchored, [],
        `these FIP cards show an evidence line but cite no register row: ${unanchored.join(', ')}`);
});

// The FIP country finder also states a GUIDE-LEVEL review date, because the 16 lower-use country
// cards carry no date of their own (they sit under the sampled `fip-carrier-accept` row). Same
// hazard, same guard: it must equal the newest Reviewed date across the rows that back the COUNTRY
// cards, so it can never claim the guide is fresher than any review behind it.
//
// ── WHY "COUNTRY CARDS" AND NOT "EVERY fip ROW" (v19.96) ────────────────────────────────────────
// It was every fip row, and that made the guard demand a false statement. Reviewing the FERRY cards
// (fip-stena, corrected Aug 2026) pushed the newest fip row forward, so the test then required
// fip.html to say the COUNTRY cards had been reviewed in August — which nobody had done. A guard
// against over-claiming a freshness date must not itself force one.
//
// Which rows back the country cards is derived from the HTML rather than listed here: a row counts
// if any block citing it is not a `ferry-*` details. A list would need editing every time a section
// is added, and would go stale in the direction of over-claiming again.
test('the FIP country-finder note makes NO page-wide checked claim', () => {
    // ── THE BLANKET DATE IS RETIRED (v20.25) ───────────────────────────────────────────────────
    //
    // The note used to say "These country cards were last reviewed Jul 2026". That is a single
    // claim standing in for 32 separate ones, and it can only ever be wrong in one of two
    // directions: stale, or — the moment ONE card is re-verified — an over-claim covering 31 cards
    // nobody looked at. The v20.25 country pass made that concrete: eight cards were checked
    // against live Rail Staff Travel pages and the rest were not, and no single date describes
    // that honestly.
    //
    // So the page now says each card carries its own date and that an undated card is not yet
    // verified, and this test guards the absence rather than the value. Per-card parity between
    // the visible date and the register is enforced by its own test above — that is where a date
    // claim belongs, because there it is bounded by the card making it.
    const html = readFileSync(new URL('./fip.html', import.meta.url), 'utf8');
    assert.doesNotMatch(html, /country cards were last reviewed/,
        'the page-wide "last reviewed" claim is back — one date cannot speak for every card');
    const note = html.match(/<p class="cf-note">([\s\S]*?)<\/p>/);
    assert.ok(note, 'the country-finder note is missing');
    assert.match(note[1], /own checked date/,
        'the note must tell the reader where the real dates are');
    assert.match(note[1], /not yet been re-verified|has not yet/,
        'the note must say what an UNDATED card means — silence reads as "fine" otherwise');
});

// ── THE QUALIFYING PERIOD IS PUBLISHED, AND THE GUIDE MUST STATE IT (v20.34) ─────────────────────
//
// The guide carried "you generally qualify after 12 months' service" for its whole life. v20.32
// removed it and asserted — in the guide AND, more damagingly, in the register — that NO qualifying
// period was published in any Rail Staff Travel source. An external review caught it: RST's FAQ page
// answers it directly, under "When am I eligible for FIP cards and International Coupons?".
//
// **The mistake was not the claim, it was the confidence.** Three RST pages had been read in full,
// the term grepped across them, and an absence concluded from their silence — without ever fetching
// `/rst/faqs.html`. A citation framework proves a claim HAS a source; it can never prove the search
// space was complete. That is a permanent property of this register, so the one conclusion it cannot
// safely reach on its own is "nobody publishes this".
//
// Hence a test rather than a comment: this is the first fact in the guide a new starter reads, both
// directions are actively harmful (turning away someone who qualifies; promising someone who does
// not), and it has now been wrong TWICE in opposite directions. It guards the CONCEPT — a year of
// continuous service — and the source, not a form of words.
test('FIP eligibility states the published one-year qualifying period, cited to the RST FAQ', () => {
    const html = readFileSync(new URL('./fip.html', import.meta.url), 'utf8');
    const rows = readFileSync(new URL('./GUIDE_SOURCES.md', import.meta.url), 'utf8')
        .split('\n').filter(l => l.startsWith('| fip-eligibility '));
    assert.equal(rows.length, 1, 'exactly one fip-eligibility row');

    // The register must cite the page that actually answers it. The FAQ is where RST publish the
    // period; the Europe-and-FIP landing page (cited until v20.34) does not mention it, which is
    // precisely how the absence was mis-concluded.
    assert.match(rows[0], /raildeliverygroup\.com\/rst\/faqs\.html/,
        'fip-eligibility must cite the RST FAQ — the page that states the qualifying period');
    assert.match(rows[0], /continuous service/i, 'the register row must record the RULE, not just the source');

    // The rendered block a member reads. Match the CONCEPT (a year, continuous service) rather than
    // a sentence, so the copy stays free to change.
    const block = html.match(/data-guide-source="fip-eligibility"[\s\S]*?<\/div>/);
    assert.ok(block, 'the eligibility block is missing or no longer cites fip-eligibility');
    assert.match(block[0], /one year|1 year|1-year|12 months/i,
        'the guide must state the qualifying period — it is the first eligibility fact a new starter reads');
    assert.match(block[0], /continuous service/i,
        '"continuous" is the load-bearing word: broken service does not accrue');

    // And the specific false claim must never return, in the guide or the register.
    for (const [what, text] of [['fip.html', html], ['GUIDE_SOURCES.md', rows[0]]]) {
        assert.doesNotMatch(text, /no published qualifying period/i,
            `${what}: the v20.32 claim that no qualifying period is published is FALSE — RST's FAQ states one`);
    }
});

// Non-failing diagnostic: surface rows whose manual review is overdue. Deliberately NOT an
// assertion — a today-driven failure would break unrelated commits (the same reason the whole
// file is a structural guard, not a date tripwire). It just prints a reminder so the manual
// cadence in GUIDE_SOURCES.md has a nudge in CI logs.
test('review-cadence reminder (never fails; logs overdue high-risk rows)', () => {
    const now = new Date();
    const cur = now.getFullYear() * 12 + (now.getMonth() + 1); // 1-indexed month
    const overdue = rows.filter(r => {
        const [y, m] = r.Next.split('-').map(Number);
        return y * 12 + m < cur;
    });
    if (overdue.length) {
        console.warn(`\n⏰ GUIDE_SOURCES review overdue for ${overdue.length} row(s) — re-check against source and re-stamp:`);
        for (const r of overdue) console.warn(`   • ${r.ID} (${r.Guide}) — Next was ${r.Next}`);
    }
    assert.ok(true); // always passes — this is a reminder, not a gate
});

// ── A DRAFT ROW MUST BE VISIBLE ON THE PAGE IT CERTIFIES (v20.05) ───────────────────────────────
//
// The register knowing a claim is unverified is worth nothing if the staff member reading the guide
// cannot tell. This is the `links-deletion.js` lesson in a different file: the bin promised a 30-day
// countdown for ten versions after the purge was switched off, and what that cost was not the
// countdown — it was the reason to believe the next thing the panel said.
//
// So: every block anchored to a provisional row must carry that CLASS's own per-card marker, and any
// guide holding provisional rows must carry a banner that names which states are present. The banner
// alone is not enough — it scrolls away, and a printed or screenshotted card outlives it.
//
// ── AND THE STATE IS NOW PER-PRODUCT, NOT PER-PAGE (v20.10) ────────────────────────────────────
// The Rangers & Rovers guide shipped entirely Draft behind one page-wide banner. Once the owner had
// checked the products at source, that banner was actively misleading in the OTHER direction: eight
// well-sourced products and two contradictory ones presented as equally uncertain, so a reader could
// no longer tell which was which — the same "reason to believe the next thing" cost the
// links-deletion bin note incurred, running the other way. Hence a marker per class, and a banner
// that has to mention every state actually present on the page.

/**
 * The banner element's own text.
 *
 * Sliced to the chip bar that follows it rather than matched with a lazy `</div>` pair — the first
 * version did the latter and the banner has no two adjacent closing divs, so the match ran on into
 * the rest of the document and picked up the words it was meant to be checking for. It passed a
 * mutation that deleted "conflict" from the banner (measured), which is the exact failure a
 * guard-the-guard pass exists to find. Fails loud if the anchor moves.
 * @param {string} html @param {string} file
 */
function bannerOf(html, file) {
    const i = html.indexOf('class="source-banner"');
    if (i === -1) return '';
    const j = html.indexOf('<nav', i);
    assert.ok(j > i, `${file}: could not bound the source banner — it is no longer followed by the ` +
        'chip bar, so this extraction is reading the wrong region. Fix the slice, do not widen it.');
    return html.slice(i, j);
}

test('a provisional register row is declared on the page it certifies', () => {
    // SCOPED PER GUIDE, and that is a fix rather than a detail (v20.38). These sets used to be built
    // across the WHOLE register, so the loop below asked every provisional guide to account for
    // every other guide's states. It passed only because exactly one page had provisional rows; the
    // moment the Railcard guide gained its first Draft row it was required to describe the Rangers
    // guide's Conflicts in its own banner. A cross-guide assertion is always wrong here — a banner
    // can only honestly summarise the page it sits on.
    const allProvisional = new Set(
        rows.filter(r => Object.keys(PROVISIONAL).includes(r.Class)).map(r => r.ID));
    if (allProvisional.size === 0) return;   // nothing to police — every row is settled

    const guides = new Set(rows.filter(r => allProvisional.has(r.ID)).map(r => r.Guide));
    for (const guide of guides) {
        const file = GUIDE_FILES[guide];
        if (!file) continue;           // paycalc renders elsewhere — same exemption as the linkage checks
        const html = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');

        /** @type {Record<string, Set<string>>} — THIS guide's provisional ids, by class. */
        const idsByClass = {};
        for (const cls of Object.keys(PROVISIONAL)) {
            idsByClass[cls] = new Set(
                rows.filter(r => r.Guide === guide && r.Class === cls).map(r => r.ID));
        }

        assert.match(html, /class="source-banner"/,
            `${file} certifies provisional claims but shows no source banner — a reader has no way ` +
            'to know. Add the banner, or settle the rows and reclassify them.');

        // The banner must name every provisional state actually on the page. One that says "draft"
        // over a page whose only unsettled rows are Conflicts sends the reader back to re-read a
        // source that has already been read — and one that omits a state entirely is worse than no
        // summary, because it reads as a complete one.
        const banner = bannerOf(html, file);
        for (const [cls, ids] of Object.entries(idsByClass)) {
            if (!ids.size) continue;
            assert.match(banner, cls === 'Conflict' ? /conflict/i : /draft/i,
                `${file}: the banner does not mention ${cls}, but ${ids.size} ${cls} row(s) are on ` +
                `this page:\n  ${banner.replace(/\s+/g, ' ').slice(0, 200)}…`);
        }

        // Every element carrying a provisional ref must carry THAT CLASS's marker. Matched on the
        // element's own attribute string, so an anchor that lost its marker is named individually
        // rather than the file passing on the strength of some OTHER card having one.
        for (const m of html.matchAll(/<[^>]*data-guide-source="([^"]+)"[^>]*>/g)) {
            const ids = m[1].trim().split(/\s+/);
            for (const [cls, markers] of Object.entries(PROVISIONAL)) {
                if (!ids.some(id => idsByClass[cls].has(id))) continue;
                assert.ok(markers.some(mk => m[0].includes(mk)),
                    `${file}: the block citing ${ids.join(' ')} is certified by a ${cls} row but ` +
                    `carries none of \`${markers.join('`, `')}\`:\n  ${m[0].slice(0, 140)}…`);
            }
        }
    }
});

// A CONFLICT ROW MUST SAY WHAT THE CONFLICT IS (v20.10). The class is the cheap part; the value is
// the reader being able to see BOTH readings and decide what to do meanwhile. A row classified
// Conflict whose claim text does not describe the disagreement has recorded a mood, not evidence —
// and the next person to look at it has to redo the work that produced the classification.
test('every Conflict row describes the disagreement it found', () => {
    const conflicts = rows.filter(r => r.Class === 'Conflict');
    assert.ok(conflicts.length, 'no Conflict rows — if the class has fallen out of use, remove it');
    for (const r of conflicts) {
        assert.match(r.Section, /conflict/i,
            `${r.ID}: a Conflict row must name its state in the claim text, so the register reads ` +
            'correctly without cross-referencing the Class column');
        // Two sides, not one — the row has to hold both readings.
        assert.match(r.Section, /\bbut\b|\bwhile\b|\bwhereas\b/i,
            `${r.ID}: a Conflict row must state BOTH readings. If only one is recorded, the next ` +
            'reader cannot tell what was checked, and the classification is unactionable.');
    }
});

// ── MARYLEBONE-FIRST SEMANTICS (v20.37) ─────────────────────────────────────────────────────────
//
// The guide used to answer "does Chiltern participate somewhere?" and the answer was printed as the
// card's primary status. That is the wrong question at this gateline, and the page proved it: the
// West Midlands Day Ranger read "On us? ✓ Yes" while being unusable at Marylebone — its area stops
// at Leamington Spa. A staff member had to open the card and read four rows down to find that out.
//
// So every card now carries TWO machine-readable states, and the whole point is that ONE CANNOT BE
// INFERRED FROM THE OTHER. These tests exist to stop that inference creeping back: the failure is
// silent (a wrong badge renders perfectly), it is the exact defect this pass was commissioned to
// fix, and the consequence at a barrier is refusing a valid ticket or accepting an invalid one.
const RR_HTML = readFileSync(new URL('./rangers-guide.html', import.meta.url), 'utf8');

/** Every element declaring the validity pair, as `{ id, myb, chiltern, attrs, block }`. */
function validityCards() {
    const out = [];
    for (const m of RR_HTML.matchAll(/<div\b([^>]*data-myb-validity="[^"]*"[^>]*)>/g)) {
        const attrs = m[1];
        const grab = (k) => (attrs.match(new RegExp(`${k}="([^"]*)"`)) || [])[1];
        // The card's own text runs to the next card or section heading — enough to assert what the
        // reader actually sees, without parsing HTML properly.
        const from = m.index + m[0].length;
        const nextCard = RR_HTML.indexOf('data-myb-validity', from);
        const nextSec = RR_HTML.indexOf('<h2 class="section"', from);
        const ends = [nextCard, nextSec].filter(i => i > -1);
        const end = ends.length ? Math.min(...ends) : RR_HTML.length;
        out.push({ id: grab('id'), myb: grab('data-myb-validity'), ch: grab('data-chiltern-validity'),
                   attrs, block: RR_HTML.slice(from, end) });
    }
    return out;
}

test('rangers: every product declares BOTH validity states, from a constrained set', () => {
    const cards = validityCards();
    assert.ok(cards.length >= 8, `expected the product cards to be found, got ${cards.length}`);
    // FOUR states, and `unconfirmed` is not a synonym for `conflict` — see the dedicated test below.
    const ALLOWED = new Set(['yes', 'no', 'conflict', 'unconfirmed']);
    for (const c of cards) {
        assert.ok(c.id, `a validity card has no id: ${c.attrs.slice(0, 90)}`);
        assert.ok(ALLOWED.has(c.myb), `${c.id}: data-myb-validity="${c.myb}" is not one of ${[...ALLOWED].join('/')}`);
        assert.ok(ALLOWED.has(c.ch), `${c.id}: data-chiltern-validity="${c.ch}" is not one of ${[...ALLOWED].join('/')}`);
    }
});

test('rangers: the Marylebone answer is never inherited from the Chiltern one', () => {
    // The defect this whole pass fixes, asserted as a property rather than a list of products:
    // there must be cards where Chiltern is yes and Marylebone is NOT. If that set ever empties,
    // either the guide has lost its point or somebody has "tidied" the two states into one.
    const cards = validityCards();
    const elsewhere = cards.filter(c => c.ch === 'yes' && c.myb === 'no');
    assert.ok(elsewhere.length >= 3,
        'no cards left where Chiltern participates but Marylebone is not valid — that combination ' +
        'is the reason this guide was restructured; losing it means the inference is back');
    // And each of them must SAY so where the reader is looking, not merely in a data attribute.
    for (const c of elsewhere) {
        assert.match(c.block, /not valid|Not valid/,
            `${c.id}: Chiltern-yes/Marylebone-no, but the card never says it is not valid here`);
    }
});

test('rangers: a Marylebone-valid card explains WHAT KIND of validity it is', () => {
    // "MYB ✓" alone is not enough — an All Line Rover and a one-return-journey product would wear
    // the same badge while meaning very different things at a barrier.
    for (const c of validityCards().filter(c => c.myb === 'yes')) {
        assert.match(c.block, /class="rr-status-note"/,
            `${c.id}: claims Marylebone validity with no one-line explanation of its scope`);
        assert.match(c.block, /myb-status--yes/, `${c.id}: no visible Marylebone-valid badge`);
    }
});

test('rangers: status is carried by WORDS, not colour alone', () => {
    // A gateline copy may be printed in monochrome, and a screen reader gets no colour at all.
    for (const c of validityCards()) {
        const want = { yes: 'Valid', no: 'Not valid', conflict: 'Conflict', unconfirmed: 'Check' }[c.myb];
        assert.ok(c.block.includes(want) || c.block.includes(want.toLowerCase()),
            `${c.id}: the Marylebone status must read as the word "${want}", not a colour`);
    }
});

test('rangers: the known operational conclusions are pinned', () => {
    // Researched against the products' own National Rail applicable-station lists (Aug 2026).
    // Concepts, not sentences: the ids and the two states, so wording stays free to change.
    const by = Object.fromEntries(validityCards().map(c => [c.id, c]));
    const EXPECT = {
        'rr-chiltern-ff': ['yes', 'yes'],   // London Marylebone is in its own station list
        'rr-allline':     ['yes', 'yes'],   // the before-10:00 bar names neither Chiltern nor MYB
        'rr-wmdr':        ['no',  'yes'],   // Chiltern stations stop at Leamington Spa
        'rr-wmfdr':       ['no',  'yes'],   // the Day Ranger's boundary — Leamington Spa in, Banbury out
        'rr-oxon':        ['no',  'yes'],   // Banbury, Kings Sutton, Bicester Village, Islip, Oxford
        'rr-heart':       ['no',  'yes'],   // Banbury + the Leamington–Birmingham corridor + Oxford
        'rr-thames':      ['no',  'conflict'],    // geography settled; operator disputed
        'rr-shakespeare': ['yes', 'yes'],   // v20.43: re-sourced at its real URL. "Valid from London
        //                                     Marylebone at any time" outward, and Chiltern Railways is one
        //                                     of its three named applicable operators. v20.37 had it as
        //                                     unconfirmed on a sitemap audit that found no entry — which was
        //                                     a fact about the catalogue, not about the page.
    };
    for (const [id, [myb, ch]] of Object.entries(EXPECT)) {
        assert.ok(by[id], `card ${id} is missing`);
        assert.equal(by[id].myb, myb, `${id}: Marylebone validity changed — re-check the source before editing this`);
        assert.equal(by[id].ch, ch, `${id}: Chiltern validity changed — re-check the source before editing this`);
    }
});

// AN ABSENCE IS NOT A DISAGREEMENT — THE SAME RULE, ONE LEVEL DOWN (v20.37).
// The page has said since v20.10 that a Conflict is not a stronger Draft: re-reading fixes "nobody
// has looked" and can never fix "the publisher contradicts itself", so sending somebody back to a
// page that has already been read wastes time at a barrier. That rule was enforced on the CARD PILL
// and nowhere else — and when the Marylebone/Chiltern badges were added, the Shakespeare card
// promptly shipped `⚠ Conflict` over a product with no readable page at all, in the same release
// that wrote the rule down. The badge is the thing actually read now, so it is guarded too.
test('rangers: a product nobody can source is never badged as a self-contradicting one', () => {
    const cards = validityCards();
    const unconfirmed = cards.filter(c => c.myb === 'unconfirmed' || c.ch === 'unconfirmed');
    // NO PRODUCT CURRENTLY HOLDS `unconfirmed` (v20.43) — Shakespeare Explorer was the only one and
    // it has been re-sourced. This test used to REQUIRE an instance, and told a future reader to
    // delete the state along with the test once none was left. Keeping the state and dropping that
    // requirement is the better answer: an absence and a disagreement are genuinely different
    // answers, it took a shipped defect to learn that, and the next unsourceable product should
    // inherit the distinction rather than reinvent it.
    //
    // But a test that can only pass vacuously is worth nothing, so the load-bearing half now runs
    // ALWAYS: the two states must stay visually distinguishable in the CSS, whether or not a card
    // is using one today. The per-card half below simply has nothing to iterate over for now.
    for (const c of unconfirmed) {
        assert.doesNotMatch(c.block, /status--conflict/,
            `${c.id}: an unsourceable product wears a CONFLICT badge. Nobody has read a source for ` +
            'it, which is the opposite of two readings disagreeing, and the two must never share a marker');
        assert.match(c.block, /status--unconfirmed/, `${c.id}: no visible unconfirmed badge`);
    }
    // And the two states must be visually distinguishable, not merely differently named — the
    // whole failure mode is a reader treating one as the other at a glance.
    const css = readFileSync(new URL('./rangers-guide.css', import.meta.url), 'utf8');
    const decl = (cls) => (css.match(new RegExp(`\\.myb-status--${cls}\\s*\\{([^}]*)\\}`)) || [])[1];
    const [conflict, unconf] = [decl('conflict'), decl('unconfirmed')];
    assert.ok(conflict && unconf, 'both badge states must be styled in rangers-guide.css');
    assert.notEqual(conflict.replace(/\s+/g, ' ').trim(), unconf.replace(/\s+/g, ' ').trim(),
        'the conflict and unconfirmed badges are styled identically — they are different answers ' +
        'and a reader must be able to tell them apart without reading the word');
});

test('rangers: the Thames 7-Day conflict never leaks onto the 3-Day product', () => {
    // Two different tickets. The 3-Day page names GWR only; merging the finding would invent
    // validity for a product that does not have it.
    assert.match(RR_HTML, /3 Day version is a different ticket/i,
        'the 3-Day warning has gone — the duration is load-bearing in this card');
});

test('rangers: a break-of-journey conflict does not make the whole product look doubtful', () => {
    // The claim-level evidence model, asserted end to end: the Shakespeare card must NOT carry the
    // whole-card conflict marker, while its break-of-journey callout must.
    const card = RR_HTML.slice(RR_HTML.indexOf('id="rr-shakespeare"'));
    const open = card.slice(0, card.indexOf('>'));
    assert.ok(!open.includes('rr-card--conflict'),
        'the Shakespeare card carries a whole-card conflict marker again — one unresolved secondary ' +
        'condition must not make its basic validity read as doubtful');
    assert.match(card.slice(0, card.indexOf('<h2')), /rr-unresolved[^>]*data-guide-source="rr-shakespeare-boj"|data-guide-source="rr-shakespeare-boj"[^>]*rr-unresolved/,
        'the break-of-journey conflict must be carried by its own claim-level callout');
});

test('rangers: absence from the page is never presented as invalidity', () => {
    assert.match(RR_HTML, /do not assume it is invalid|out of scope, not invalid/i,
        'the non-exhaustive rule has gone — a ticket missing from this page is out of scope, not invalid');
    assert.doesNotMatch(RR_HTML, /only these tickets are valid/i);
});

// ── RAILCARD: THE MARYLEBONE OPERATIONAL CONTRACT (v20.38) ──────────────────────────────────────
//
// Every test below pins a claim that, if it regressed, would make a Marylebone staff member refuse
// a valid discounted ticket or accept an invalid one. Two of them pin errors that ACTUALLY SHIPPED
// and stood for months — the Network boundary and "16-17 is digital only" — which is why they are
// asserted as concepts rather than left to review.
//
// They are deliberately semantic, not prose-shaped: wording must stay free to improve. What is
// pinned is the meaning a reader takes away.
const RC_HTML = readFileSync(new URL('./railcard-guide.html', import.meta.url), 'utf8');

/** The page's visible text, comments stripped — a rule buried in a comment is not guidance. */
const RC_TEXT = RC_HTML.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

/* THE CORRECTION CALLOUTS ARE THE ONE PLACE THE OLD WRONG WORDING MAY APPEAR, and that is the point
 * of them: a staff member who learned "not valid past Banbury" from this page needs to be told, in
 * those words, that it was wrong. So the "must not say X" scans below run against the page with
 * `.rc-correction` blocks removed.
 *
 * That exemption is EARNED, not granted by the class name — `correctionsAreNegations` below fails
 * if any correction block lacks an explicit negation, so the class cannot become a place to park a
 * live claim the guards would otherwise catch. */
const CORRECTIONS = [...RC_HTML.matchAll(/<div class="rc-chiltern rc-correction">([\s\S]*?)<\/div>/g)]
    .map(m => m[1]);
const RC_TEXT_LIVE = RC_HTML
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<div class="rc-chiltern rc-correction">[\s\S]*?<\/div>/g, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('railcard: a correction callout must actually negate what it quotes', () => {
    assert.ok(CORRECTIONS.length >= 2,
        `expected the shipped-error corrections to be present, found ${CORRECTIONS.length}`);
    for (const c of CORRECTIONS) {
        assert.match(c, /was wrong|that was wrong|used to say|removed|corrected/i,
            'a .rc-correction block does not negate the wording it quotes. This class is exempt from ' +
            'the "must not say" guards precisely because it contradicts the old claim — a block that ' +
            'only restates it would slip a live error past every check below:\n  ' + c.slice(0, 160));
    }
});

test('railcard: the Network area ends at Banbury, and Birmingham is outside it', () => {
    // THIS TEST HAS NOW BEEN WRITTEN THREE TIMES, AND THE HISTORY IS THE USEFUL PART.
    //   1. It pinned "the area reaches Birmingham" — a v20.38 "correction" inferred from the
    //      railcard map's station INDEX, which lists Birmingham Moor Street and Snow Hill.
    //   2. The inference was invalid: the same index lists Bristol, Taunton and Exeter, so it
    //      indexes the rail-services map, not the boundary. The claim was withdrawn to Draft.
    //   3. It was then settled properly. The boundary is a 41-vertex filled polygon in the map PDF;
    //      point-in-polygon against a rendered copy puts Banbury INSIDE and on the edge (it is the
    //      boundary station), and Leamington Spa, Warwick, Solihull, Coventry and Birmingham
    //      OUTSIDE. Bristol tests outside too, which is the method checking itself.
    //
    // So the ORIGINAL guide was right and the "correction" was the error. What this test protects is
    // the answer, not either author: asserting Birmingham is inside would make a gateline accept
    // invalid tickets, which is the more expensive direction of the two.
    const card = RC_HTML.slice(RC_HTML.indexOf('id="rc-network"'));
    const body = card.slice(0, card.indexOf('<h2')).replace(/<!--[\s\S]*?-->/g, ' ');

    assert.match(body, /reaches <strong>Banbury and\s+Kings Sutton<\/strong> and stops/i,
        'the Network card must state where the area ends on our line');
    assert.match(body, /Birmingham Moor Street \/ Snow Hill are outside/i,
        'the card must name Birmingham as OUTSIDE. Verified by point-in-polygon against the map\'s ' +
        'own boundary — do not "correct" this from the map\'s station index, which also lists Bristol.');
    assert.match(body, /Banbury is the boundary station/i,
        'naming Banbury as THE boundary station is what makes the buy-before-you-cross rule usable');
});

test('railcard: no card claims Birmingham is inside the Network area', () => {
    // The bad inference had already spread to Family & Friends, Senior and the Gold comparison
    // before it was caught. Asserted page-wide so it cannot return through any one of them.
    // (The Network card names Birmingham as OUTSIDE, which these patterns deliberately do not match.)
    assert.doesNotMatch(RC_TEXT_LIVE, /Birmingham is inside the (?:Network )?area/i);
    assert.doesNotMatch(RC_TEXT_LIVE, /wholly within it and the peak rule applies/i);
    assert.doesNotMatch(RC_TEXT_LIVE, /both the Gold Card area and the Network Railcard area include/i);
});

test('railcard: a physical 16-17 Saver is never described as not genuine', () => {
    // THE ERROR THIS PREVENTS: "Digital only — no physical card" on a product whose official
    // conditions describe a physical Saver in six separate clauses. This one is asserted hardest,
    // because acting on it means refusing a valid card belonging to a 16-year-old.
    const card = RC_HTML.slice(RC_HTML.indexOf('id="rc-1617"'));
    const body = card.slice(0, card.indexOf('<div class="rc amber"'))
        .replace(/<div class="rc-chiltern rc-correction">[\s\S]*?<\/div>/g, ' ');
    assert.doesNotMatch(body, /digital only/i,
        'the 16-17 Saver is described as digital only again — the official conditions describe a ' +
        'PHYSICAL Saver throughout (2.1, 2.2.1, 2.8.1, 3.1-3.3). Both formats are genuine.');
    assert.match(body, /physical or digital/i, 'the 16-17 Saver must state that both formats are genuine');
    // The real constraint, which the old text displaced: you cannot buy one at a station.
    assert.match(body, /not sold at stations|not available to purchase at stations/i);
});

test('railcard: an 18-year-old holding a Saver is legitimate, and the check is the expiry date', () => {
    // This asserted the literal string "17 August 2026" until v21.97, which was right while the
    // change was still ahead: a gateline needed the date to know the rule was about to move. It has
    // moved — the source now reads "can NOW buy" and names no date — so pinning the date would keep
    // a historical footnote on the page for ever, which is what its own source-register row asked
    // this test not to do.
    //
    // What is asserted instead is the thing a gateline acts on, which was true before the change
    // and after it: an in-date Saver in the hands of an 18-year-old is valid, and appearance is not
    // a check. Cards issued under the old rule are still in circulation until Aug 2027 and simply
    // expire earlier — the instruction does not change for them either.
    const card = RC_HTML.slice(RC_HTML.indexOf('id="rc-1617"'));
    const body = card.slice(0, card.indexOf('<div class="rc amber"'));
    assert.match(body, /18-year-old can hold a valid Saver/i,
        'the Saver card no longer states that an 18-year-old can hold a valid one');
    assert.match(body, /expiry date|check the expiry/i);
});

test('railcard: nobody is asked to judge age, disability or eligibility by appearance', () => {
    // Removed rather than softened (v20.38). It is wrong on FOUR products — 16-25 and 26-30 both
    // outlive their upper age, the Saver does too since Aug 2026, and F&F keeps discounting a child
    // who turns 16 mid-card — and on the Disabled Persons Railcard it asks for a judgement no
    // gateline should be making at all.
    for (const bad of [
        /age looks right/i,
        /eligibility looks right/i,
        /looks right for the card/i,
        /check (?:the )?age\/eligibility/i,
    ]) {
        assert.doesNotMatch(RC_TEXT_LIVE, bad, `appearance-based checking has returned (${bad})`);
    }
    assert.match(RC_TEXT, /never (?:assess|judge)|don't judge validity by how old/i,
        'the page must positively say NOT to infer invalidity from appearance — dropping the old ' +
        'instruction silently leaves the habit in place');
});

test('railcard: the forgotten-Railcard rule carries no unsupported deadline', () => {
    assert.doesNotMatch(RC_TEXT, /within 28 days/i,
        'the 28-day forgotten-Railcard claim is back. No source supports it; Chiltern\'s Passenger ' +
        'Charter allows one claim per customer in a 12-month period, with no deadline stated.');
    assert.match(RC_TEXT, /12[- ]month period/i);
});

test('railcard: the three kinds of morning rule stay distinguishable', () => {
    // The defect this prevents is subtle and was the page's second-worst: rendering a fare-controlled
    // card (Family & Friends, Senior, GroupSave) with a clock time makes it look like a fixed cutoff,
    // which is how "~10:00" and "~09:30" got invented for products that have no Railcard time at all.
    const FIXED = { 'rc-twotogether': '09:30', 'rc-gold': '09:30', 'rc-network': '10:00' };
    for (const [id, time] of Object.entries(FIXED)) {
        const at = RC_HTML.indexOf(`id="${id}"`);
        const body = RC_HTML.slice(at, at + 4000);
        assert.ok(body.includes(time), `${id} must state its fixed ${time} cutoff`);
    }
    for (const id of ['rc-ff', 'rc-senior', 'rc-groupsave']) {
        const card = RC_HTML.slice(RC_HTML.indexOf(`id="${id}"`), RC_HTML.indexOf(`id="${id}"`) + 4000);
        assert.match(card, /Follows the <strong>Off-Peak<\/strong>/,
            `${id} is fare-controlled and must say it follows the Off-Peak fare`);
        assert.doesNotMatch(card, /around <strong>\d\d:\d\d/,
            `${id} has re-acquired an invented "around HH:MM" Railcard cutoff. It has no Railcard ` +
            'time of its own — the ticket decides, and the direction decides the ticket.');
    }
});

test('railcard: the Marylebone morning panel is directional and disclaims itself', () => {
    const panel = RC_HTML.slice(RC_HTML.indexOf('class="myb-panel"'), RC_HTML.indexOf('class="key"'));
    assert.match(panel, /arrive after 10:00/i, 'inbound rule missing');
    assert.match(panel, /04:29&ndash;08:30|04:29–08:30/, 'outbound south-of-Banbury rule missing');
    assert.match(panel, /Banbury &amp; north[\s\S]{0,300}No morning restriction/i,
        'the "Banbury and north has no morning restriction" row is the one most likely to be ' +
        'dropped as an edge case, and it is the one that most often applies on our route');
    assert.match(panel, /11:30/, 'the Super Off-Peak inbound threshold is missing');
    // It is a Chiltern ticket rule, and must never read as a national Railcard rule.
    assert.match(panel, /ticket's rule, not the Railcard's/i);
    assert.match(panel, /retail system/i);
});

test('railcard: the legend separates the DISCOUNT from the ticket', () => {
    // The old legend said "£ = travel OK, but a minimum fare applies", which reads as though the
    // Railcard settles whether somebody may travel. It does not — it settles the price.
    assert.doesNotMatch(RC_TEXT, /£\s*=\s*travel OK/i);
    assert.match(RC_TEXT, /Neither symbol says the passenger cannot travel/i,
        'the legend must state that a missing discount is not a bar on travel');
});

test('railcard: photocard rules stay scoped to the formats that need them', () => {
    // Over-generalising these refuses valid holders: the separate Photocard applies to 16-25 and
    // Two Together only where the PHYSICAL card was bought AT A STATION, and always for HM Forces.
    for (const id of ['rc-1625', 'rc-twotogether']) {
        const card = RC_HTML.slice(RC_HTML.indexOf(`id="${id}"`), RC_HTML.indexOf(`id="${id}"`) + 3000);
        assert.match(card, /bought at a station<\/strong>|<strong>bought at a station/i,
            `${id}: the separate Photocard requirement must stay scoped to a station-bought physical card`);
    }
    const forces = RC_HTML.slice(RC_HTML.indexOf('id="rc-forces"'), RC_HTML.indexOf('id="rc-forces"') + 3000);
    assert.match(forces, /Photocard is mandatory|Photocard <strong>always<\/strong>/i);
});

test('railcard: First Class is answered per card, never in one blanket sentence', () => {
    assert.doesNotMatch(RC_TEXT, /Most cards give the same 1\/3 off/i,
        'the blanket First Class claim is back — it hid too many exceptions to be useful');
    // Every substantive product card carries its own Class row.
    for (const id of ['rc-1617', 'rc-1625', 'rc-2630', 'rc-disabled', 'rc-ff', 'rc-gold',
                      'rc-forces', 'rc-network', 'rc-senior', 'rc-twotogether', 'rc-veterans', 'rc-groupsave']) {
        const card = RC_HTML.slice(RC_HTML.indexOf(`id="${id}"`), RC_HTML.indexOf(`id="${id}"`) + 4000);
        assert.match(card, /<span class="rc-lbl">Class<\/span>/,
            `${id} has no Class row — First Class is exactly the kind of rule that must be per-product`);
    }
    // The two that are genuinely Standard-only must say so.
    const net = RC_HTML.slice(RC_HTML.indexOf('id="rc-network"'), RC_HTML.indexOf('id="rc-network"') + 4000);
    assert.match(net, /Standard Class only/i);
});

test('railcard: every substantive card carries evidence (FIP/Rangers coverage standard)', () => {
    // The gap this closes: 6 of 13 cards had no source relationship at all, which put the Railcard
    // guide behind both its siblings on the page with the highest refusal risk.
    const ids = [...RC_HTML.matchAll(/<div class="rc[^"]*" id="(rc-[a-z0-9-]+)"/g)].map(m => m[1]);
    assert.ok(ids.length >= 12, `expected >= 12 product cards, found ${ids.length}`);
    for (const id of ids) {
        const open = RC_HTML.slice(RC_HTML.indexOf(`id="${id}"`));
        assert.match(open.slice(0, open.indexOf('>') + 1), /data-guide-source="/,
            `${id} has no data-guide-source — every substantive card must be evidenced`);
    }
});

test('railcard: the checking sequence starts with the ticket, not the Railcard', () => {
    const steps = RC_HTML.slice(RC_HTML.indexOf('class="check"'), RC_HTML.indexOf('class="photo-note"'));
    const first = steps.slice(0, steps.indexOf('check-num">2'));
    assert.match(first, /Check the ticket first/i,
        'step 1 must be the ticket. Opening on the Railcard trains the eye on the discount and ' +
        'quietly assumes the ticket is fine — most of what is wrong at this gateline is the ticket.');
    assert.doesNotMatch(RC_TEXT, /Same checks whether/i,
        'selling and gateline are different jobs — before travel it can still be fixed, after it cannot');
});
