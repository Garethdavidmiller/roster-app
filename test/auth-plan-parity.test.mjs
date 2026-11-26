// @lane hygiene
/**
 * Security plan parity — SECURITY_RELEASE_PLAN.md holds the open work and its status, ONCE.
 * Run: node scripts/run-tests.mjs test/auth-plan-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * WHY THIS FILE EXISTS. The security plan used to be written in several places — Track E's design in
 * AUTH_PLAN.md, its sequencing in SECURITY_RELEASE_PLAN.md, the credential work in a third and fourth
 * document — and the copies drifted in the way split ownership always drifts, silently and only in
 * the file nobody was editing that day:
 *
 *   - one copy numbered a Track E phase E2 TWICE and lost the offline-grace phase entirely, so a
 *     reader counting phases got a different plan depending on which file they opened (v19.08);
 *   - a plan's own status prose contradicted its phase headings about what had shipped (v19.08).
 *
 * Neither is a typo: a security plan whose phase numbering disagrees with itself is one someone
 * follows halfway and stops, believing they are further along than they are. Track E's whole point is
 * that E1 is client preparation and the read rule is the first real boundary — an off-by-one there is
 * the exact misreading that ships a client gate and calls the data protected.
 *
 * On 26 Nov 2026 the sign-in documents were folded into three: AUTH_AND_SESSIONS.md (the contract and
 * the shipped design), SECURITY_RELEASE_PLAN.md (status, and the design of the work NOT yet built) and
 * RECOVERY_RUNBOOK.md (the operational steps). So the checks are now: the Track E phase list is whole
 * in its one home and agrees with the status table; the shipped design in AUTH_AND_SESSIONS.md does
 * not grow a second phase list; the rollout line is the canonical one; C5's unadopted route is marked
 * in BOTH places a reader meets it; the invariants for unbuilt work route to the plan; and the folded
 * documents stay folded — a fifth copy of the subject is how the drift starts again.
 *
 * These are STRUCTURAL contracts, not a review of the plan's content. They say nothing about whether
 * the plan is any good.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const SEC = readFileSync('docs/SECURITY_RELEASE_PLAN.md', 'utf8');
const CONTRACT = readFileSync('docs/AUTH_AND_SESSIONS.md', 'utf8');

const EXPECTED_PHASES = ['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6'];

/**
 * The text of one `## ` section of SECURITY_RELEASE_PLAN.md, from its heading to the next `## `.
 * @param {string} heading the heading's text after `## `, matched as a prefix
 * @returns {string} '' when the heading is missing
 */
function section(heading) {
    const lines = SEC.split('\n');
    const at = lines.findIndex(l => l.startsWith('## ' + heading));
    if (at < 0) return '';
    let end = lines.length;
    for (let j = at + 1; j < lines.length; j++) if (/^## /.test(lines[j])) { end = j; break; }
    return lines.slice(at + 1, end).join('\n');
}

const TRACK_E = section('Track E');
const TRACK_C = section('Track C');

/**
 * Phase blocks are `### E<n> — <title>` headings.
 * The em-dash is load-bearing: it separates a phase DEFINITION from prose that merely opens with a
 * phase id (e.g. "### E6 is a sketch, not yet a plan — …", which is commentary, not a second E6).
 * @param {string} md
 * @returns {{id: string, block: string}[]}
 */
function phases(md) {
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
 * The shipped version a phase heading claims, if any: "✓ SHIPPED v<major>.<minor>".
 * @param {string} block
 * @returns {string|null}
 */
function shippedVersion(block) {
    const m = /✓\s*SHIPPED\s+v(\d+\.\d+)/i.exec(block.split('\n')[0]);
    return m ? m[1] : null;
}

const PHASES = phases(SEC);
const headingShipped = new Map(
    PHASES.filter(p => shippedVersion(p.block)).map(p => [p.id, shippedVersion(p.block)]),
);

/**
 * The canonical table's Track E row — the one place Track E's STATUS is written. Its "Current stage"
 * cell marks shipped phases as "E<n> ✓ v<x.yy>".
 */
const E_ROW = SEC.split('\n').find(l => l.startsWith('| **E — full-app auth**')) || '';
const tableShipped = new Map(
    [...(E_ROW.split('|')[2] ?? '').matchAll(/\bE(\d) ✓ v(\d+\.\d+)/g)].map(m => [`E${m[1]}`, m[2]]),
);

describe('Track E — one phase list, in SECURITY_RELEASE_PLAN.md', () => {
    test('the plan has the sections this test reads', () => {
        assert.ok(TRACK_E.length > 0 && TRACK_C.length > 0,
            'SECURITY_RELEASE_PLAN.md has lost its "## Track E" or "## Track C" section — every check ' +
            'below would read an empty string and pass. Restore the heading or repoint this test.');
    });

    test('the plan declares E0–E6, each exactly once, all inside Track E', () => {
        const ids = PHASES.map(p => p.id);
        const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
        assert.deepEqual(dupes, [],
            `SECURITY_RELEASE_PLAN.md declares a phase id more than once: ${[...new Set(dupes)].join(', ')}. ` +
            'Two phases sharing a number is how the offline-grace phase went missing — renumber, ' +
            'do not add a suffix.');
        const missing = EXPECTED_PHASES.filter(id => !ids.includes(id));
        const extra   = ids.filter(id => !EXPECTED_PHASES.includes(id));
        assert.deepEqual({ missing, extra }, { missing: [], extra: [] },
            `the phase list is ${ids.join(', ')} — expected exactly ${EXPECTED_PHASES.join(', ')}. ` +
            'If Track E genuinely gained or lost a phase, update EXPECTED_PHASES here in the same commit.');
        const outside = PHASES.filter(p => !TRACK_E.includes(p.block.split('\n')[0])).map(p => p.id);
        assert.deepEqual(outside, [], `phases declared outside the Track E section: ${outside.join(', ')}`);
    });

    test('AUTH_AND_SESSIONS.md carries the shipped design, never a second phase list', () => {
        // The contract names phases in parentheses — "The two-phase load (E1)" — which routes a
        // citation; a `### E<n> — ` heading there is a second DEFINITION, the v19.08 failure shape.
        const defs = CONTRACT.split('\n').filter(l => /^#{2,4} E\d — /.test(l) || /^- \*\*E\d\b/.test(l));
        assert.deepEqual(defs, [],
            'AUTH_AND_SESSIONS.md defines Track E phases:\n  ' + defs.join('\n  ') +
            '\nThe phases live in SECURITY_RELEASE_PLAN.md; the contract holds what a SHIPPED phase left behind, ' +
            'under a heading that names the phase in parentheses.');
        const status = CONTRACT.split('\n').filter(l => /✓\s*SHIPPED|Current stage/.test(l));
        assert.deepEqual(status, [], 'AUTH_AND_SESSIONS.md states a stage. Status lives in the canonical table, once.');
    });
});

describe('Track E — the shipped versions agree with the status table', () => {
    test('the canonical table has a Track E row that marks shipped phases', () => {
        assert.ok(E_ROW, 'SECURITY_RELEASE_PLAN.md has no "| **E — full-app auth**" row in its canonical table.');
        assert.ok(tableShipped.size > 0,
            'The Track E row marks no phase "E<n> ✓ v<x.yy>" — either the marker format changed (repoint ' +
            'this parser) or the row lost its shipped phases. Every check below would compare against nothing.');
    });

    test('the phase headings agree with the canonical table about what has shipped', () => {
        const ids = [...new Set([...headingShipped.keys(), ...tableShipped.keys()])].sort();
        const disagree = ids
            .filter(id => headingShipped.get(id) !== tableShipped.get(id))
            .map(id => `${id}: heading says ${headingShipped.get(id) ? `v${headingShipped.get(id)}` : 'not shipped'}, ` +
                       `the canonical table says ${tableShipped.get(id) ? `v${tableShipped.get(id)}` : 'not shipped'}`);
        assert.deepEqual(disagree, [],
            'The phase headings and the canonical status table disagree about shipped status:\n  ' + disagree.join('\n  ') +
            '\nWhen a phase ships, mark the table row "E<n> ✓ v<x.yy>" and the heading "✓ SHIPPED v<x.yy>" ' +
            'in the same commit — a plan that still calls a shipped phase future work is one someone re-does.');
    });

    test("Track E's status prose agrees with its phase headings about what has shipped", () => {
        // The status paragraph states shipped phases as prose: "**E0 shipped v19.00**".
        const prose = new Map(
            [...TRACK_E.matchAll(/\bE(\d)\*{0,2}\s+shipped\s+\*{0,2}\s*v(\d+\.\d+)/gi)].map(m => [`E${m[1]}`, m[2]]),
        );
        const ids = [...new Set([...headingShipped.keys(), ...prose.keys()])].sort();
        const disagree = ids
            .filter(id => headingShipped.get(id) !== prose.get(id))
            .map(id => `${id}: heading says ${headingShipped.get(id) ? `v${headingShipped.get(id)}` : 'not shipped'}, ` +
                       `status prose says ${prose.get(id) ? `v${prose.get(id)}` : 'nothing'}`);
        assert.deepEqual(disagree, [],
            'Track E contradicts itself about what has shipped:\n  ' + disagree.join('\n  ') +
            '\nThe summary and the phase headings are read by different people; both must say the same thing.');
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
    test('the "Rollout discipline" line states the canonical sequence verbatim', () => {
        const line = SEC.split('\n').find(l => l.startsWith('**Rollout discipline:**')) || '';
        assert.ok(line.includes(CANONICAL_SEQUENCE),
            `SECURITY_RELEASE_PLAN.md's "**Rollout discipline:**" line does not contain "${CANONICAL_SEQUENCE}" ` +
            `(it reads: ${JSON.stringify(line)}). A summary line is what gets followed under time ` +
            'pressure, and a stale one sends someone past the offline-grace phase or straight to ' +
            'named-only rules.');
    });

    for (const [label, src] of [['docs/SECURITY_RELEASE_PLAN.md', SEC], ['docs/AUTH_AND_SESSIONS.md', CONTRACT]]) {
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

// ── C5: A DECISION THAT HAS NOT BEEN TAKEN ─────────────────────────────────────────────────────
//
// "C5 — the open decision" sets out a second route to retiring the surname: once one-time recovery
// codes exist, the remaining surname credentials could be replaced server-side, which answers the
// CREDENTIAL question without touching the READ question that Track E owns. That is a materially
// different plan from the one in the canonical status table, and the owner asked explicitly that it
// not be adopted quietly.
//
// The failure mode is specific and it is not carelessness: a later session reads the section, finds
// it persuasive, and starts *building* to it — updating the C row to match, or simply proceeding as
// though the decision were made. Nothing would look wrong, and the only evidence that a decision had
// been skipped would be the absence of a conversation nobody can grep for.
//
// So the not-adopted marking is pinned in BOTH places a reader meets it — the design section and the
// status row. Adopting Route 2 then requires editing this test, which is the point: it turns a silent
// drift into a deliberate act with a diff.

describe('Track C — the open C5 decision and the unbuilt work', () => {
    test('the C5 design section states that neither route is adopted', () => {
        assert.ok(/### C5 — the open decision/.test(TRACK_C),
            'Track C has lost its "### C5 — the open decision" section, which code and ROADMAP.md cite.');
        assert.ok(/Neither is adopted\. The choice is the owner's/.test(TRACK_C),
            'The C5 design no longer says its routes are unadopted. If the owner HAS chosen a route, say ' +
            'so in the C row and update this test in the same commit. If they have not, restore the ' +
            'marking — a section describing an alternative plan without saying it is unchosen is one somebody builds.');
    });

    test('and the canonical table says the same thing, where status actually lives', () => {
        const cRow = SEC.split('\n').find(l => l.includes('**C — passwords**')) || '';
        assert.ok(/SECOND ROUTE is on the table and NOT adopted/.test(cRow),
            'The C — passwords row no longer records that a second route to C5 exists and is ' +
            'unadopted. A reader who only opens the table must not be the only one who misses the choice.');
    });

    test("Track C's design states no stage of its own", () => {
        // One table owns stage. A design section that starts marking things shipped is a second
        // answer that can disagree with the first.
        const claims = TRACK_C.split('\n').filter(l => /✓ SHIPPED|Current stage/.test(l));
        assert.deepEqual(claims, [],
            "Track C's design has begun stating shipped status:\n  " + claims.join('\n  ') +
            '\nStatus belongs in the canonical table and nowhere else.');
    });

    test('every track Track C designs has a row in the canonical table', () => {
        // A design for a track the status table has never heard of is work with no home — it is how
        // C2 nearly became two different deferred plans.
        const designed = [...TRACK_C.matchAll(/^### (C\d+|F) — /gm)].map(m => m[1]).sort();
        assert.deepEqual(designed, ['C2', 'C5', 'C6', 'F'], 'Track C designs tracks this test does not know about');
        for (const id of designed.filter(id => id !== 'C5')) {
            assert.ok(SEC.includes(`**${id} —`),
                `SECURITY_RELEASE_PLAN.md has no canonical row for ${id}, which Track C designs. Add the row, or drop the design.`);
        }
    });

    test('the two invariants for unbuilt work point at the plan, not at code', () => {
        // AUTH_AND_SESSIONS.md rows normally name the module that holds the reasoning. 15 and 16
        // describe things that do not exist yet, so they must route to the design instead — a row
        // pointing at a file that does not implement it is worse than one that says so.
        for (const [n, id] of [[15, 'C2'], [16, 'F']]) {
            const row = CONTRACT.split('\n').find(l => l.startsWith(`| ${n} |`)) || '';
            assert.ok(row, `AUTH_AND_SESSIONS.md has no invariant ${n}`);
            // A CONTENT matcher, not a path: docs sit together in docs/ and refer to each other by bare filename.
            assert.ok(row.includes(`SECURITY_RELEASE_PLAN.md\` → ${id}`) && /not yet built/.test(row),
                `invariant ${n} must route to SECURITY_RELEASE_PLAN.md → ${id} and say it is not yet built — ` +
                'when it IS built, repoint it at the module and drop the marker here.');
            assert.ok(new RegExp(`^### ${id} — `, 'm').test(TRACK_C), `the plan has no "### ${id} — " design for invariant ${n} to route to`);
        }
    });
});

describe('the folded sign-in documents stay folded', () => {
    // AUTH_PLAN.md, PASSWORD_DESIGN.md, AUTH_ARCHITECTURE.md and CREDENTIAL_LIFECYCLE.md were folded
    // into the three documents above on 26 Nov 2026. A recreated one is a second copy of the subject,
    // which is the drift this file exists to stop. Code and docs cite the new homes instead; the old
    // words are in git.
    for (const doc of ['AUTH_PLAN.md', 'PASSWORD_DESIGN.md', 'AUTH_ARCHITECTURE.md', 'CREDENTIAL_LIFECYCLE.md']) {
        test(`docs/${doc} does not come back`, () => {
            assert.ok(!existsSync(`docs/${doc}`),
                `docs/${doc} exists again. Its content lives in AUTH_AND_SESSIONS.md (shipped design), ` +
                'SECURITY_RELEASE_PLAN.md (open work) or RECOVERY_RUNBOOK.md (operations): add to those instead.');
        });
    }
});
