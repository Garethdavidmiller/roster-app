// Weekday Lates 4 — weeks 14, 15, 16, 17 kept CONSECUTIVE AND IN ORDER; week 13 free to move.
//
// WHY THE BLOCK IS ENUMERATED RATHER THAN SEARCHED. Cover weeks are pinned at 1, 7, 12 and 17, and
// week 17 IS one of them — a cover week is blank, so "14,15,16,17 in order" means the three working
// weeks sitting immediately before SOME cover week. On a 24-line wheel that is four placements and
// no more, so they are tried exhaustively instead of left to the annealer to stumble on.
//
// WHY 13 IS NOT IN THE BLOCK. Week 13 works Tue–Sat and week 14 Sun–Mon; back to back they are
// seven consecutive working days totalling 58.9h against MRSF's 55h limit. That window lies wholly
// inside the two weeks, so nothing outside them can break it — 13 next to 14 means MRSF is present
// wherever the pair sits. It keeps its duties exactly as written; only its position is free.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const RAW = JSON.parse(readFileSync('wl3-raw.json', 'utf8'));
const START = RAW.patterns ?? RAW;
const KEYS = Object.keys(START).sort((a, b) => +a - +b);
const SPARE = KEYS.filter(k => START[k].mon === 'SPARE').map(Number);
const STEPS = Number(process.env.STEPS ?? 40000), RESTARTS = Number(process.env.RESTARTS ?? 3);
const SEEDS = (process.env.SEEDS ?? '7,21,34').split(',').map(Number);

// The three working slots immediately before each cover week, wrapping round the wheel.
const before = c => [3, 2, 1].map(d => ((c - d - 1 + 24) % 24) + 1);
const PLACEMENTS = SPARE.map(before).filter(p => p.every(n => !SPARE.includes(n)));
console.log('cover weeks at', SPARE.join(', '));
console.log('block placements (weeks 14,15,16 then a cover week):');
for (const p of PLACEMENTS) console.log('   ', p.join(', '), '→ cover at', ((p[2]) % 24) + 1);

/** Put weeks 14,15,16's patterns at `slots`, swapping out whatever sits there. */
function place(slots) {
    const g = {}; for (const k of KEYS) g[k] = { ...START[k] };
    [['14', slots[0]], ['15', slots[1]], ['16', slots[2]]].forEach(([from, to]) => {
        const at = KEYS.find(k => JSON.stringify(g[k]) === JSON.stringify(START[from]));
        const t = g[at]; g[at] = g[String(to)]; g[String(to)] = t;
    });
    return g;
}

const results = [];
for (const slots of PLACEMENTS) {
    const g = place(slots);
    const at13 = KEYS.find(k => JSON.stringify(g[k]) === JSON.stringify(START['13']));
    for (const seed of SEEDS) {
        const f = `wl4-${slots[0]}-s${seed}.json`;
        writeFileSync(f, JSON.stringify(g, null, 0));
        const out = execFileSync('node', ['optimise.mjs', f, String(STEPS), String(RESTARTS), String(seed)], {
            env: { ...process.env, FREEZE: slots.join(','), FLOAT: at13, RULES: '1' }, encoding: 'utf8',
        });
        const best = out.trim().split('\n').find(l => l.startsWith('best   cost'));
        console.log(`block at ${slots.join(',')} · seed ${seed}: ${best.replace('best   cost ', '')}`);
        results.push({ slots: slots.join(','), seed, file: f.replace('.json', '-optimised.json'),
                       facts: JSON.parse(best.slice(best.indexOf('{'))), cost: Number(best.match(/best\s+cost\s+(\d+)/)[1]) });
    }
}
results.sort((a, b) => a.cost - b.cost);
console.log('\n=== best first ===');
for (const r of results.slice(0, 5)) console.log(`  ${r.slots} s${r.seed}  cost ${r.cost}  ${JSON.stringify(r.facts)}`);
writeFileSync('wl4-results.json', JSON.stringify(results, null, 1));
