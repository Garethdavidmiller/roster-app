/**
 * Track E doc parity — AUTH_PLAN.md ↔ SECURITY_RELEASE_PLAN.md.
 * Run: node --test auth-plan-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * WHY THIS FILE EXISTS. Track E is described in two places on purpose: AUTH_PLAN.md is authoritative
 * for DESIGN, SECURITY_RELEASE_PLAN.md for SEQUENCING. Nothing kept the two phase lists in step, and
 * they drifted in the way split ownership always drifts — silently, and only in the file nobody was
 * editing that day:
 *
 *   - SECURITY_RELEASE_PLAN.md numbered a phase E2 TWICE and lost the offline-grace phase entirely,
 *     so a reader counting phases got a different plan depending on which file they opened (v19.08).
 *   - AUTH_PLAN.md's own status prose contradicted its phase headings about what had shipped (v19.08).
 *
 * Neither is a typo: a security plan whose phase numbering disagrees with itself is one someone
 * follows halfway and stops, believing they are further along than they are. Track E's whole point is
 * that E1 is client preparation and E2 is the first real boundary — an off-by-one there is the exact
 * misreading that ships a client gate and calls the data protected.
 *
 * These are STRUCTURAL contracts, not a review of the plan's content. They say the two documents
 * describe the same phases and agree on which have shipped. They say nothing about whether the plan
 * is any good.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const AUTH = readFileSync('docs/AUTH_PLAN.md', 'utf8');
const SEC  = readFileSync('docs/SECURITY_RELEASE_PLAN.md', 'utf8');
const CRED = readFileSync('docs/CREDENTIAL_LIFECYCLE.md', 'utf8');

const EXPECTED_PHASES = ['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6'];

/**
 * Phase blocks in AUTH_PLAN.md are `### E<n> — <title>` headings.
 * The em-dash is load-bearing: it separates a phase DEFINITION from prose that merely opens with a
 * phase id (e.g. "### E6 is a sketch, not yet a plan — …", which is commentary, not a second E6).
 * @param {string} md
 * @returns {{id: string, block: string}[]}
 */
function authPhases(md) {
    const lines = md.split('\n');
    const starts = [];
    lines.forEach((line, i) => {
        const m = /^### (E\d) — /.exec(line);
        if (m) starts.push({ id: m[1], line: i });
    });
    return starts.map((s, i) => ({
        id: s.id,
        block: lines.slice(s.line, starts[i + 1]?.line ?? lines.length).join('\n'),
    }));
}

/**
 * Phase blocks in SECURITY_RELEASE_PLAN.md are `- **E<n>…` bullets inside the Track E section.
 * Each block runs to the next phase bullet, or to the end of the section.
 * @param {string} md
 * @returns {{id: string, block: string}[]}
 */
function secPhases(md) {
    const lines = md.split('\n');
    const starts = [];
    lines.forEach((line, i) => {
        const m = /^- \*\*(E\d)\b/.exec(line);
        if (m) starts.push({ id: m[1], line: i });
    });
    return starts.map((s, i) => {
        let end = starts[i + 1]?.line ?? lines.length;
        // The LAST bullet has no following bullet to bound it — stop at the next heading so the
        // block can't swallow the rest of the document and pick up an unrelated SHIPPED marker.
        if (!starts[i + 1]) {
            for (let j = s.line + 1; j < lines.length; j++) {
                if (/^#{2,4} /.test(lines[j])) { end = j; break; }
            }
        }
        return { id: s.id, block: lines.slice(s.line, end).join('\n') };
    });
}

/**
 * The shipped version a phase block claims, if any. Both documents use the same marker:
 * "✓ SHIPPED v<major>.<minor>".
 * @param {string} block
 * @returns {string|null}
 */
function shippedVersion(block) {
    const m = /✓\s*SHIPPED\s+v(\d+\.\d+)/i.exec(block);
    return m ? m[1] : null;
}

/** @param {{id: string, block: string}[]} phases */
const shippedMap = (phases) => new Map(
    phases.filter(p => shippedVersion(p.block)).map(p => [p.id, shippedVersion(p.block)]),
);

const AUTH_PHASES = authPhases(AUTH);
const SEC_PHASES  = secPhases(SEC);

describe('Track E parity — both plans describe the same phases', () => {
    for (const [label, phases] of [['docs/AUTH_PLAN.md', AUTH_PHASES], ['docs/SECURITY_RELEASE_PLAN.md', SEC_PHASES]]) {
        test(`${label} declares E0–E6, each exactly once`, () => {
            const ids = phases.map(p => p.id);
            const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
            assert.deepEqual(dupes, [],
                `${label} declares a phase id more than once: ${[...new Set(dupes)].join(', ')}. ` +
                'Two phases sharing a number is how the offline-grace phase went missing — renumber, ' +
                'do not add a suffix.');

            const missing = EXPECTED_PHASES.filter(id => !ids.includes(id));
            const extra   = ids.filter(id => !EXPECTED_PHASES.includes(id));
            assert.deepEqual({ missing, extra }, { missing: [], extra: [] },
                `${label} phase list is ${ids.join(', ')} — expected exactly ${EXPECTED_PHASES.join(', ')}. ` +
                'If Track E genuinely gained or lost a phase, update EXPECTED_PHASES here AND both ' +
                'documents in the same commit.');
        });
    }

    test('the two plans agree on which phases have shipped, and at which version', () => {
        const a = shippedMap(AUTH_PHASES);
        const s = shippedMap(SEC_PHASES);
        const ids = [...new Set([...a.keys(), ...s.keys()])].sort();

        const disagree = ids
            .filter(id => a.get(id) !== s.get(id))
            .map(id => `${id}: AUTH_PLAN says ${a.get(id) ? `v${a.get(id)}` : 'not shipped'}, ` +
                       `SECURITY_RELEASE_PLAN says ${s.get(id) ? `v${s.get(id)}` : 'not shipped'}`);

        assert.deepEqual(disagree, [],
            'The two Track E documents disagree about shipped status:\n  ' + disagree.join('\n  ') +
            '\nWhen a phase ships, mark it "✓ SHIPPED v<x.yy>" in BOTH files in the same commit — a ' +
            'sequencing doc that still calls a shipped phase future work is one someone re-does.');
    });
});

// The phase HEADINGS were guarded from v19.09; the prose that tells a maintainer what order to work
// in was not. So a stale "E1 → E2-soft → E3-hard" rollout line survived the v19.08 renumbering in
// the sequencing doc — naming the wrong stage "hard", implying E1 begins the rollout, and dropping
// the offline-grace phase — while every structural check stayed green. A one-line summary is what
// people actually follow when they are in a hurry, so it needs pinning at least as much as the
// headings do.
const CANONICAL_SEQUENCE = 'E0 → E1 → PIN (v20.12, in place of E2) → decision gate → E3 + E4 → E5';

describe('Track E parity — the canonical rollout sequence', () => {
    for (const [label, src] of [['docs/AUTH_PLAN.md', AUTH], ['docs/SECURITY_RELEASE_PLAN.md', SEC]]) {
        test(`${label} states the canonical sequence verbatim`, () => {
            assert.ok(src.includes(CANONICAL_SEQUENCE),
                `${label} does not contain "${CANONICAL_SEQUENCE}". Both Track E documents must state ` +
                'the order of work identically — a summary line is what gets followed under time ' +
                'pressure, and a stale one sends someone past the offline-grace phase or straight to ' +
                'named-only rules.');
        });

        test(`${label} carries no superseded phase shorthand`, () => {
            // The specific shapes that predate the E0–E6 numbering. "soft"/"hard" as phase SUFFIXES
            // are the tell: the real model has a soft posture INSIDE E3 and enforcement at E5, so
            // "E2-soft"/"E3-hard" is always the old model leaking through.
            const stale = [...src.matchAll(/E\d\s*-\s*(soft|hard)\b/gi)].map(m => m[0]);
            assert.deepEqual(stale, [],
                `${label} still uses superseded phase shorthand: ${stale.join(', ')}. The soft posture ` +
                'belongs to E3 and hard enforcement to E5 — naming a phase "-soft"/"-hard" is the old ' +
                'pre-renumbering model.');
        });
    }
});

describe('Track E parity — each plan agrees with itself', () => {
    test("SECURITY_RELEASE_PLAN's Track E heading names exactly the phases its bullets mark shipped", () => {
        const heading = SEC.split('\n').find(l => /^### Track E\b/.test(l));
        assert.ok(heading, 'Track E section heading not found in SECURITY_RELEASE_PLAN.md');

        // The heading summarises progress, e.g. "… — E0+E1 SHIPPED, REST UNDECIDED".
        const claim = /((?:E\d[+,\s–-]*)+)SHIPPED/i.exec(heading);
        const claimed = new Set(claim ? (claim[1].match(/E\d/g) ?? []) : []);
        const actual  = new Set(shippedMap(SEC_PHASES).keys());

        assert.deepEqual([...claimed].sort(), [...actual].sort(),
            `The Track E heading claims ${[...claimed].sort().join('+') || 'nothing'} shipped, but its ` +
            `phase bullets mark ${[...actual].sort().join('+') || 'nothing'}. The heading is the first ` +
            'thing read and the last thing updated — keep it in step.');
    });

    test("AUTH_PLAN's status prose agrees with its phase headings about what has shipped", () => {
        const actual = shippedMap(AUTH_PHASES);
        // The status paragraph states shipped phases as prose: "**E0 shipped v19.00**".
        const prose = new Map(
            [...AUTH.matchAll(/\bE(\d)\*{0,2}\s+shipped\s+\*{0,2}\s*v(\d+\.\d+)/gi)]
                .map(m => [`E${m[1]}`, m[2]]),
        );

        const ids = [...new Set([...actual.keys(), ...prose.keys()])].sort();
        const disagree = ids
            .filter(id => actual.get(id) !== prose.get(id))
            .map(id => `${id}: heading says ${actual.get(id) ? `v${actual.get(id)}` : 'not shipped'}, ` +
                       `status prose says ${prose.get(id) ? `v${prose.get(id)}` : 'nothing'}`);

        assert.deepEqual(disagree, [],
            'AUTH_PLAN.md contradicts itself about what has shipped:\n  ' + disagree.join('\n  ') +
            '\nThe summary at the top and the phase headings are read by different people; both must ' +
            'say the same thing.');
    });
});


// ── THE CREDENTIAL LIFECYCLE PROGRAMME (v22.38) ────────────────────────────────────────────────
//
// `CREDENTIAL_LIFECYCLE.md` is a third document on the same subject, added for the reason the other
// two exist separately: it owns ORDER, which neither of them did. That makes three files that can
// disagree, so the same structural discipline applies — and one of its sections needs more than
// discipline.
//
// **§7 records a decision that has NOT been taken.** It sets out a second route to retiring the
// surname: once one-time recovery codes exist, the remaining surname credentials could be replaced
// server-side, which answers the CREDENTIAL question without touching the READ question that Track
// E owns. That is a materially different plan from the one in the canonical status table, and the
// owner asked explicitly that it not be adopted quietly.
//
// The failure mode is specific and it is not carelessness: a later session reads §7, finds it
// persuasive, and starts *building* to it — updating the C5 row to match, or simply proceeding as
// though the decision were made. Nothing would look wrong. Both documents would be internally
// consistent, and the only evidence that a decision had been skipped would be the absence of a
// conversation nobody can grep for.
//
// So the not-adopted marking is pinned in BOTH files. Adopting Route 2 then requires editing this
// test, which is the point: it turns a silent drift into a deliberate act with a diff.

describe('the credential lifecycle programme', () => {
    test('§7 states, in the design doc, that neither route is adopted', () => {
        assert.ok(/Neither is adopted\. The choice is the owner's/.test(CRED),
            'CREDENTIAL_LIFECYCLE.md §7 no longer says the C5 routes are unadopted. If the owner HAS ' +
            'chosen a route, say so in SECURITY_RELEASE_PLAN.md\'s C5 row and update this test in the ' +
            'same commit. If they have not, restore the marking — a section describing an alternative ' +
            'plan without saying it is unchosen is one somebody builds.');
    });

    test('and the canonical table says the same thing, where status actually lives', () => {
        const c5Row = SEC.split('\n').find(l => l.includes('**C — passwords**')) || '';
        assert.ok(/SECOND ROUTE is on the table and NOT adopted/.test(c5Row),
            'The C — passwords row no longer records that a second route to C5 exists and is ' +
            'unadopted. STATUS lives in this table, so a reader who only opens the design doc must ' +
            'not be the only one who learns there is a choice outstanding.');
    });

    test('the design doc states no status of its own', () => {
        // Same split-ownership rule the other two follow: one table owns stage. A design doc that
        // starts marking things shipped is a second answer that can disagree with the first.
        const claims = CRED.split('\n').filter(l => /✓ SHIPPED|Current stage/.test(l));
        assert.deepEqual(claims, [],
            'CREDENTIAL_LIFECYCLE.md has begun stating shipped status:\n  ' + claims.join('\n  ') +
            '\nStatus belongs in SECURITY_RELEASE_PLAN.md\'s canonical table and nowhere else.');
    });

    test('every track the design doc names has a row in the canonical table', () => {
        // A design for a track the status table has never heard of is work with no home — it is how
        // C2 nearly became two different deferred plans.
        const named = [...new Set([...CRED.matchAll(/\b(C6|F)\b(?= —)/g)].map(m => m[1]))].sort();
        assert.deepEqual(named, ['C6', 'F'], 'the design doc names tracks this test does not know about');
        for (const id of named) {
            assert.ok(SEC.includes(`**${id} —`),
                `SECURITY_RELEASE_PLAN.md has no canonical row for ${id}, which ` +
                'CREDENTIAL_LIFECYCLE.md designs. Add the row, or drop the design.');
        }
    });

    test('the two invariants for unbuilt work point at the design, not at code', () => {
        // AUTH_AND_SESSIONS.md rows normally name the module that holds the reasoning. 15 and 16
        // describe things that do not exist yet, so they must route to the design instead — a row
        // pointing at a file that does not implement it is worse than one that says so.
        const contract = readFileSync('docs/AUTH_AND_SESSIONS.md', 'utf8');
        for (const n of [15, 16]) {
            const row = contract.split('\n').find(l => l.startsWith(`| ${n} |`)) || '';
            assert.ok(row, `AUTH_AND_SESSIONS.md has no invariant ${n}`);
            // A CONTENT matcher, not a path: docs sit together in docs/ and refer to each other by
            // bare filename, so this must stay bare even though the file moved.
            assert.ok(row.includes('CREDENTIAL_LIFECYCLE.md') && /not yet built/.test(row),
                `invariant ${n} must route to CREDENTIAL_LIFECYCLE.md and say it is not yet built — ` +
                'when it IS built, repoint it at the module and drop the marker here.');
        }
    });
});
