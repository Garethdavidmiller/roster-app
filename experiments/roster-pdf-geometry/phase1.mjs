import { readFileSync } from 'node:fs';
const DAYS = ['sun','mon','tue','wed','thu','fri','sat'];
const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'))
    .filter(r => !/^Print Date/.test(r.name));

/** The witness: does the physical cell hold any text at all? */
const occupancy = r => r.cells.map(c => !!c.trim());

/** Refuse an AI day the physical cell cannot support. NOT a weighing — a refusal. */
function contradictions(aiShifts, occ) {
    const out = [];
    for (let i = 0; i < 7; i++) {
        const claimed = !!(aiShifts[i] || '').trim();
        if (claimed && !occ[i]) out.push(`${DAYS[i]}: AI says ${JSON.stringify(aiShifts[i])}, physical cell is EMPTY`);
    }
    return out;
}

let caught = 0, clean = 0;
for (const r of rows) {
    const occ = occupancy(r);
    const truth = r.cells.map(c => c.split('|')[0].trim());
    // 1. The honest read contradicts nothing.
    if (contradictions(truth, occ).length) console.log(`UNEXPECTED on the honest read: ${r.name}`);
    else clean++;
    // 2. The failure mode: the blank Sunday collapses, everything slides one day LEFT.
    const shifted = [...truth.slice(1), ''];
    const c = contradictions(shifted, occ);
    if (c.length) caught++;
    else console.log(`  NOT CAUGHT: ${r.name.padEnd(26)} [${occ.map(o => o ? 'X' : '.').join('')}]`);
}
console.log(`\nhonest reads passing the witness : ${clean}/${rows.length}`);
console.log(`one-day-left misreads REFUSED    : ${caught}/${rows.length}`);
