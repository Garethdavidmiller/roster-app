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

/**
 * The classes a reader must be TOLD about, and the per-card marker each one requires.
 *
 * Keyed as a map rather than a list because the markers are not interchangeable: a Conflict card
 * wearing the draft marker would tell a staff member "not checked yet" about a claim that HAS been
 * checked and cannot be settled — which is the misreading that would send them back to the same
 * page for the same answer.
 */
const PROVISIONAL = { Draft: 'rr-card--draft', Conflict: 'rr-card--conflict' };
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
test('the FIP country-finder note states a review date backed by the register', () => {
    const html = readFileSync(new URL('./fip.html', import.meta.url), 'utf8');
    const m = html.match(/country cards were last reviewed ([A-Z][a-z]{2}) (\d{4})/);
    assert.ok(m, 'the cf-note guide-level review date is missing from fip.html');
    const shown = `${m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}`;

    /** Ids cited ONLY by ferry blocks — they say nothing about the country cards. */
    const ferryOnly = new Set();
    const nonFerry  = new Set();
    for (const mm of html.matchAll(/<details id="([^"]+)"[^>]*data-guide-source="([^"]+)"/g)) {
        for (const id of mm[2].trim().split(/\s+/)) {
            (mm[1].startsWith('ferry-') ? ferryOnly : nonFerry).add(id);
        }
    }
    // A cross-cutting row cited by a non-details block (a card, a list item) counts too.
    for (const mm of html.matchAll(/data-guide-source="([^"]+)"/g)) {
        for (const id of mm[1].trim().split(/\s+/)) if (!ferryOnly.has(id)) nonFerry.add(id);
    }

    const backing = rows.filter(r => r.Guide === 'fip' && !(ferryOnly.has(r.ID) && !nonFerry.has(r.ID)));
    assert.ok(backing.length >= 9, `expected the country-card rows, found ${backing.length}`);
    const newest = backing.map(r => r.Reviewed).sort().pop();
    assert.equal(shown, newest,
        `fip.html says the country cards were reviewed ${shown}, but the newest country-card register ` +
        `row is ${newest} — the guide-level date must never outrun the reviews behind it`);
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
    /** @type {Record<string, Set<string>>} */
    const idsByClass = {};
    for (const cls of Object.keys(PROVISIONAL)) {
        idsByClass[cls] = new Set(rows.filter(r => r.Class === cls).map(r => r.ID));
    }
    const allProvisional = new Set(Object.values(idsByClass).flatMap(s => [...s]));
    if (allProvisional.size === 0) return;   // nothing to police — every row is settled

    const guides = new Set(rows.filter(r => allProvisional.has(r.ID)).map(r => r.Guide));
    for (const guide of guides) {
        const file = GUIDE_FILES[guide];
        if (!file) continue;           // paycalc renders elsewhere — same exemption as the linkage checks
        const html = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');

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
            for (const [cls, marker] of Object.entries(PROVISIONAL)) {
                if (!ids.some(id => idsByClass[cls].has(id))) continue;
                assert.ok(m[0].includes(marker),
                    `${file}: the block citing ${ids.join(' ')} is certified by a ${cls} row but ` +
                    `carries no \`${marker}\` marker:\n  ${m[0].slice(0, 140)}…`);
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
