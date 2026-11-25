// @lane hygiene
/**
 * Track E doc parity — AUTH_PLAN.md is Track E's one home; SECURITY_RELEASE_PLAN.md holds its status.
 * Run: node scripts/run-tests.mjs test/auth-plan-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * WHY THIS FILE EXISTS. Track E used to be written in two places — AUTH_PLAN.md for design,
 * SECURITY_RELEASE_PLAN.md for sequencing — and the two drifted in the way split ownership always
 * drifts, silently and only in the file nobody was editing that day:
 *
 *   - SECURITY_RELEASE_PLAN.md numbered a phase E2 TWICE and lost the offline-grace phase entirely,
 *     so a reader counting phases got a different plan depending on which file they opened (v19.08).
 *   - AUTH_PLAN.md's own status prose contradicted its phase headings about what had shipped (v19.08).
 *
 * Neither is a typo: a security plan whose phase numbering disagrees with itself is one someone
 * follows halfway and stops, believing they are further along than they are. Track E's whole point is
 * that E1 is client preparation and the read rule is the first real boundary — an off-by-one there is
 * the exact misreading that ships a client gate and calls the data protected.
 *
 * On 25 Nov 2026 the second copy was removed: SECURITY_RELEASE_PLAN.md's Track E section is a pointer
 * to AUTH_PLAN.md, and the only Track E fact left in that file is its STATUS (the canonical table's
 * E row). So the checks are now: the phase list is whole in the one home; the pointer stays a pointer
 * (the commonest way a duplicate comes back is somebody "helpfully" summarising the phases again); and
 * the shipped versions in AUTH_PLAN's headings and prose agree with the status table.
 *
 * These are STRUCTURAL contracts, not a review of the plan's content. They say nothing about whether
 * the plan is any good.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const AUTH = readFileSync('docs/AUTH_PLAN.md', 'utf8');
const SEC  = readFileSync('docs/SECURITY_RELEASE_PLAN.md', 'utf8');
// The credential lifecycle programme is a SECTION of PASSWORD_DESIGN.md since 24 Nov 2026 (it was
// CREDENTIAL_LIFECYCLE.md, now a pointer). Only that section is read: the rest of the file is the
// passwords AS BUILT, which may say "shipped" freely.
const PASSWORD_DESIGN = readFileSync('docs/PASSWORD_DESIGN.md', 'utf8');
const LIFECYCLE_HEADING = '## The credential lifecycle — the C5/C6 programme';
const CRED = (() => {
    const start = PASSWORD_DESIGN.indexOf(LIFECYCLE_HEADING);
    if (start < 0) return '';
    const rest = PASSWORD_DESIGN.slice(start + LIFECYCLE_HEADING.length);
    const end = rest.search(/^#{1,2} /m);
    return end < 0 ? rest : rest.slice(0, end);
})();

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
 * The shipped version a phase block claims, if any: "✓ SHIPPED v<major>.<minor>".
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

/**
 * The canonical table's Track E row — the one place Track E's STATUS is written. Its "Current stage"
 * cell marks shipped phases as "E<n> ✓ v<x.yy>".
 */
const E_ROW = SEC.split('\n').find(l => l.startsWith('| **E — full-app auth**')) || '';
const tableShipped = new Map(
    [...(E_ROW.split('|')[2] ?? '').matchAll(/\bE(\d) ✓ v(\d+\.\d+)/g)].map(m => [`E${m[1]}`, m[2]]),
);

/**
 * SECURITY_RELEASE_PLAN.md's Track E section: from its `### Track E` heading to the next heading.
 * @returns {{heading: string, body: string}|null}
 */
const SEC_TRACK_E = (() => {
    const lines = SEC.split('\n');
    const at = lines.findIndex(l => /^### Track E\b/.test(l));
    if (at < 0) return null;
    let end = lines.length;
    for (let j = at + 1; j < lines.length; j++) if (/^#{1,3} |^---$/.test(lines[j])) { end = j; break; }
    return { heading: lines[at], body: lines.slice(at + 1, end).join('\n') };
})();

/** The pointer's size cap. It is ~560 characters today; a paragraph of pointer fits well inside this,
 *  and a re-grown phase list (the old section was ~13,000) does not. */
const POINTER_MAX_CHARS = 1000;

describe('Track E — AUTH_PLAN.md is the one home', () => {
    test('AUTH_PLAN.md declares E0–E6, each exactly once', () => {
        const ids = AUTH_PHASES.map(p => p.id);
        const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
        assert.deepEqual(dupes, [],
            `AUTH_PLAN.md declares a phase id more than once: ${[...new Set(dupes)].join(', ')}. ` +
            'Two phases sharing a number is how the offline-grace phase went missing — renumber, ' +
            'do not add a suffix.');

        const missing = EXPECTED_PHASES.filter(id => !ids.includes(id));
        const extra   = ids.filter(id => !EXPECTED_PHASES.includes(id));
        assert.deepEqual({ missing, extra }, { missing: [], extra: [] },
            `AUTH_PLAN.md's phase list is ${ids.join(', ')} — expected exactly ${EXPECTED_PHASES.join(', ')}. ` +
            'If Track E genuinely gained or lost a phase, update EXPECTED_PHASES here in the same commit.');
    });

    test("SECURITY_RELEASE_PLAN.md's Track E section is a pointer to AUTH_PLAN.md, not a second copy", () => {
        assert.ok(SEC_TRACK_E, 'SECURITY_RELEASE_PLAN.md has no "### Track E" section — the pointer is gone, ' +
            'so a reader of the security plan no longer learns where Track E lives.');
        const { heading, body } = SEC_TRACK_E;
        assert.ok(body.includes('`AUTH_PLAN.md`'),
            'The Track E section of SECURITY_RELEASE_PLAN.md no longer names `AUTH_PLAN.md`. It is a pointer; ' +
            'a pointer that does not say where is a dead end.');
        assert.ok(body.length <= POINTER_MAX_CHARS,
            `The Track E section of SECURITY_RELEASE_PLAN.md is ${body.length} characters (cap ${POINTER_MAX_CHARS}). ` +
            'It is growing back into a second copy of AUTH_PLAN.md — the two copies drifted before. Put ' +
            'the content in AUTH_PLAN.md and leave the pointer a pointer.');
        const status = [heading, ...body.split('\n')].filter(l => /✓|SHIPPED/i.test(l));
        assert.deepEqual(status, [],
            'The Track E pointer states a status. Status lives in the canonical table\'s E row, once.');
    });

    test('SECURITY_RELEASE_PLAN.md defines no Track E phase anywhere', () => {
        const defs = SEC.split('\n').filter(l => /^- \*\*E\d\b/.test(l) || /^#{2,4} E\d — /.test(l));
        assert.deepEqual(defs, [],
            'SECURITY_RELEASE_PLAN.md defines Track E phases again:\n  ' + defs.join('\n  ') +
            '\nThe phases live in AUTH_PLAN.md only; this file carries their status in its table.');
    });
});

describe('Track E — the shipped versions agree with the status table', () => {
    test('the canonical table has a Track E row that marks shipped phases', () => {
        assert.ok(E_ROW, 'SECURITY_RELEASE_PLAN.md has no "| **E — full-app auth**" row in its canonical table.');
        assert.ok(tableShipped.size > 0,
            'The Track E row marks no phase "E<n> ✓ v<x.yy>" — either the marker format changed (repoint ' +
            'this parser) or the row lost its shipped phases. Every check below would compare against nothing.');
    });

    test("AUTH_PLAN's phase headings agree with the canonical table about what has shipped", () => {
        const a = shippedMap(AUTH_PHASES);
        const ids = [...new Set([...a.keys(), ...tableShipped.keys()])].sort();
        const disagree = ids
            .filter(id => a.get(id) !== tableShipped.get(id))
            .map(id => `${id}: AUTH_PLAN heading says ${a.get(id) ? `v${a.get(id)}` : 'not shipped'}, ` +
                       `the canonical table says ${tableShipped.get(id) ? `v${tableShipped.get(id)}` : 'not shipped'}`);
        assert.deepEqual(disagree, [],
            'AUTH_PLAN.md and the canonical status table disagree about shipped status:\n  ' + disagree.join('\n  ') +
            '\nWhen a phase ships, mark the table row "E<n> ✓ v<x.yy>" and the heading "✓ SHIPPED v<x.yy>" ' +
            'in the same commit — a plan that still calls a shipped phase future work is one someone re-does.');
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

// The phase HEADINGS were guarded from v19.09; the prose that tells a maintainer what order to work
// in was not. So a stale "E1 → E2-soft → E3-hard" rollout line survived the v19.08 renumbering in
// the sequencing doc — naming the wrong stage "hard", implying E1 begins the rollout, and dropping
// the offline-grace phase — while every structural check stayed green. A one-line summary is what
// people actually follow when they are in a hurry, so it needs pinning at least as much as the
// headings do.
const CANONICAL_SEQUENCE = 'E0 → E1 → PIN (v20.12, in place of E2) → decision gate → E3 + E4 → E5';

describe('Track E — the canonical rollout sequence', () => {
    test("AUTH_PLAN.md's Rollout discipline line states the canonical sequence verbatim", () => {
        const line = AUTH.split('\n').find(l => l.startsWith('**Rollout discipline:**')) || '';
        assert.ok(line.includes(CANONICAL_SEQUENCE),
            `AUTH_PLAN.md's "**Rollout discipline:**" line does not contain "${CANONICAL_SEQUENCE}" ` +
            `(it reads: ${JSON.stringify(line)}). A summary line is what gets followed under time ` +
            'pressure, and a stale one sends someone past the offline-grace phase or straight to ' +
            'named-only rules.');
    });

    for (const [label, src] of [['docs/AUTH_PLAN.md', AUTH], ['docs/SECURITY_RELEASE_PLAN.md', SEC]]) {
        test(`${label}: every rollout-sequence line is the canonical one`, () => {
            // The v19.08 failure was a SECOND, stale sequence line, not a missing one.
            const stale = src.split('\n').filter(l => /\bE0 → E1\b/.test(l) && !l.includes(CANONICAL_SEQUENCE));
            assert.deepEqual(stale, [],
                `${label} states a rollout sequence that is not the canonical one:\n  ${stale.join('\n  ')}`);
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


// ── THE CREDENTIAL LIFECYCLE PROGRAMME (v22.38) ────────────────────────────────────────────────
//
// The credential lifecycle was a third document on the same subject, added for the reason the other
// two exist separately: it owns ORDER, which neither of them did. Since 24 Nov 2026 it is
// `PASSWORD_DESIGN.md` → "The credential lifecycle — the C5/C6 programme" (the old file's §N is that
// section's LN, and the old file is a pointer). The same structural
// discipline applies — and one of its sections needs more than discipline.
//
// **L7 records a decision that has NOT been taken.** It sets out a second route to retiring the
// surname: once one-time recovery codes exist, the remaining surname credentials could be replaced
// server-side, which answers the CREDENTIAL question without touching the READ question that Track
// E owns. That is a materially different plan from the one in the canonical status table, and the
// owner asked explicitly that it not be adopted quietly.
//
// The failure mode is specific and it is not carelessness: a later session reads L7, finds it
// persuasive, and starts *building* to it — updating the C5 row to match, or simply proceeding as
// though the decision were made. Nothing would look wrong. Both documents would be internally
// consistent, and the only evidence that a decision had been skipped would be the absence of a
// conversation nobody can grep for.
//
// So the not-adopted marking is pinned in BOTH files. Adopting Route 2 then requires editing this
// test, which is the point: it turns a silent drift into a deliberate act with a diff.

describe('the credential lifecycle programme', () => {
    test('the lifecycle section exists where this test reads it', () => {
        assert.ok(CRED.length > 0, `PASSWORD_DESIGN.md has no heading "${LIFECYCLE_HEADING}" — ` +
            'every check below would read an empty string and pass. Restore the heading or repoint ' +
            'LIFECYCLE_HEADING.');
    });

    test('L7 states, in the design, that neither route is adopted', () => {
        assert.ok(/Neither is adopted\. The choice is the owner's/.test(CRED),
            'PASSWORD_DESIGN.md L7 no longer says the C5 routes are unadopted. If the owner HAS ' +
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
            'PASSWORD_DESIGN.md\'s credential lifecycle section has begun stating shipped status:\n  ' + claims.join('\n  ') +
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
                'PASSWORD_DESIGN.md\'s credential lifecycle designs. Add the row, or drop the design.');
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
            assert.ok(row.includes('PASSWORD_DESIGN.md') && /credential lifecycle/.test(row) && /not yet built/.test(row),
                `invariant ${n} must route to PASSWORD_DESIGN.md's credential lifecycle section and say it is not yet built — ` +
                'when it IS built, repoint it at the module and drop the marker here.');
        }
    });
});
