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

const AUTH = readFileSync('AUTH_PLAN.md', 'utf8');
const SEC  = readFileSync('SECURITY_RELEASE_PLAN.md', 'utf8');

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
    for (const [label, phases] of [['AUTH_PLAN.md', AUTH_PHASES], ['SECURITY_RELEASE_PLAN.md', SEC_PHASES]]) {
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
