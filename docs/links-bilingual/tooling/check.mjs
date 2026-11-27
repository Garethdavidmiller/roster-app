// Checks options.json against every rule in RULES.md and prints each option's measures beside today's.
// Exits 1 if any option breaks a rule, or if the wildcard is no longer Option B made into a wildcard.
//   node docs/links-bilingual/tooling/check.mjs

import { readFileSync } from 'node:fs';
import { TODAY, measure, breaches, wildcardOf, fmtHours } from './rules.mjs';

const options = JSON.parse(readFileSync(new URL('./options.json', import.meta.url), 'utf8'));
let failed = false;

const row = (name, m) => {
    const y = (x) => Math.round(x * m.perYear);
    console.log(`${name.padEnd(9)} weekends off ${y(m.weekends.off)}/yr · both days ${y(m.weekends.both)} · one day ${y(m.weekends.one)}`
        + ` · Sat ${y(m.saturdays)} · Sun ${y(m.sundays)} × ${m.sundayHours.join('/')}h · extra pay ${y(m.extraPay)}h`
        + ` · earliest ${y(m.earliestCount)} at ${String(Math.floor(m.earliest / 60)).padStart(2, '0')}:${String(m.earliest % 60).padStart(2, '0')}`
        + ` · fatigue ${m.fatigue.present} · FF11 ${m.fatigue.ff11} · rest ≥ ${fmtHours(m.shortestRest / 60)}h · run ≤ ${m.worstRun}`
        + ` · Fri–Sun ${y(m.longBreaks)}/yr · lone rest days ${m.loneRestDays} · new times ${m.newTimes.length}`);
};

row('Today', measure(TODAY));
for (const [kind, lines] of Object.entries(options)) {
    row(`Option ${kind}`, measure(lines));
    for (const b of breaches(lines, kind)) { failed = true; console.log(`   BREAKS: ${b}`); }
}
if (JSON.stringify(wildcardOf(options.B)) !== JSON.stringify(options.W)) {
    failed = true;
    console.log('   BREAKS: the wildcard is not Option B with its 07:00 starts at 06:20 and its Sundays an hour longer');
}
console.log(failed ? '\nFAILED' : '\nEvery option meets every rule.');
process.exit(failed ? 1 : 0);
