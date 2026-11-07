// What the app's own shipped default produces at ROTATING_LINES (26 since v24.47) — the comparator for any proposal.
// Moved from docs/links-24/tooling on 7 Nov 2026 (it was written at 24 lines, which this line used to say), unchanged
// but for this note: .claude/rules/links-design.md and docs/LINKS_DEC2026_PLAN.md quote what it prints. From this
// folder: node default-baseline.mjs — the `adj` line's gentleMean, gentleWorst and gentleOver are the quoted figures.
import { generateLink, runDesignChecks, weeklyHours, lineTotals, ROTATING_LINES } from '../../../links-design.js';
import { buildDefaultTargets } from '../../../links-default-targets.js';
import { assessFatigue } from '../../../links-fatigue.js';
import { assessHardLimits } from '../../../links-limits.js';
import * as adj from '../../../links-adjacency.js';
const t = buildDefaultTargets();
const g = generateLink({ slots: t.slots, spareLines: t.spareLines, lines: ROTATING_LINES });
console.log('mode', g.mode, 'reason', g.reason, 'waves', g.waves, 'keys', Object.keys(g));
let p = g.patterns;
const ALL = Object.fromEntries(adj.OBJECTIVES.map(o=>[o.key,true]));
const fnNames = Object.keys(adj).filter(k=>typeof adj[k]==='function'); console.log('adj fns', fnNames.join(','));
if (adj.reorderLines) { const r = adj.reorderLines(p, { on: ALL }); console.log('reorder keys', Object.keys(r)); p = r.patterns ?? (r.order ? adj.applyOrder(p, r.order) : p); }
console.log('hours', JSON.stringify(weeklyHours(p, ROTATING_LINES)));
console.log('checks', JSON.stringify(runDesignChecks(p, ROTATING_LINES)));
console.log('hard', JSON.stringify(assessHardLimits(p, ROTATING_LINES).checks.map(c=>[c.id,c.status,c.value])));
const f = assessFatigue(p, ROTATING_LINES); console.log('fatigue present', f.present, 'standing', f.standing);
for (const r of f.results) if (r.status!=='clear' && r.status!=='n/a') console.log(`  ${r.code} ${r.status} ${r.value} ${r.title}`);
console.log('adj', JSON.stringify(adj.scoreOrder(p, Object.keys(p).sort((a,b)=>a-b), {})));
const DAYS=['sun','mon','tue','wed','thu','fri','sat'];
for (let i=1;i<=ROTATING_LINES;i++) console.log(String(i).padStart(2), DAYS.map(d=>String(p[i][d]).padEnd(12)).join(' '));
