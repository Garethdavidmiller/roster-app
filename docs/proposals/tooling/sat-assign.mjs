// Assign a searched SATURDAY table to lines, then score the whole design.
//
// The table says WHAT Saturday works; this says WHO. It walks every assignment of the table's duties to
// the lines that already work Saturday, pruning on the 12-hour rest rule in both directions -- this
// line's Friday into its Saturday, and its Saturday into the NEXT line's Sunday, because a link wraps.
//
// It then scores the WHOLE grid with the app's own modules rather than the Saturday column alone: a
// Saturday duty changes FF19, the weekly hours and the run figures, and a Saturday-local score would not
// see any of it. Assignments with a turnaround or a hard-limit breach are discarded outright.
import { readFileSync, writeFileSync } from 'node:fs';
import { startMinutes, endMinutes, dutyMinutes, DAYS } from '../../../links-design.js';
import { assess } from './report-data.mjs';
import { asRosteredRuns } from './cover-placement.mjs';

const SRC = './cover-at-seventeen.json';
const P0 = JSON.parse(readFileSync(SRC, 'utf8'));
const K = Object.keys(P0).sort((a,b)=>a-b);
// The table sat-table.mjs returns at SEED=7 for the 4-turn frontier point: fewest distinct turns,
// fewest starts and fewest finishes, at a demand fit of 12.1 against today's Saturday at 20.7.
const TABLE = [['06:20-14:30',5],['08:30-15:45',1],['14:30-22:15',2],['15:15-23:55',4]];
const DUTIES = TABLE.flatMap(([t,n]) => Array(n).fill(t));
const SLOTS = K.filter(k => /^\d\d:\d\d-/.test(P0[k].sat));       // lines that work Saturday
if (DUTIES.length !== SLOTS.length) throw new Error(`${DUTIES.length} duties vs ${SLOTS.length} slots`);

// 12h rest: this line's Friday -> its Saturday, and its Saturday -> the NEXT line's Sunday.
const MIN = 12 * 60;
const endAbs = t => { const s = startMinutes(t), e = endMinutes(t); return e < s ? e + 1440 : e; };
function restsOk(k, duty, P) {
    const fri = P[k].fri;
    if (/^\d\d:\d\d-/.test(fri) && startMinutes(duty) + 1440 - endAbs(fri) < MIN) return false;
    const next = K[(K.indexOf(k) + 1) % K.length];
    const sun = P[next].sun;
    if (/^\d\d:\d\d-/.test(sun) && startMinutes(sun) + 1440 - endAbs(duty) < MIN) return false;
    return true;
}
// Exact search over assignments, pruning on rest, then score the whole design.
const uniq = [...new Set(DUTIES)];
let best = null, found = 0;
const counts = Object.fromEntries(uniq.map(u => [u, DUTIES.filter(d => d === u).length]));
function walk(i, cnt, acc) {
    if (found > 40000) return;
    if (i === SLOTS.length) { found++; evaluate(acc); return; }
    for (const u of uniq) {
        if (!cnt[u]) continue;
        if (!restsOk(SLOTS[i], u, P0)) continue;
        cnt[u]--; acc.push(u); walk(i + 1, cnt, acc); acc.pop(); cnt[u]++;
    }
}
function evaluate(acc) {
    const P = {}; for (const k of K) P[k] = { ...P0[k] };
    SLOTS.forEach((k, i) => { P[k].sat = acc[i]; });
    const a = assess(P, 24), ar = asRosteredRuns(P, 24);
    if (a.checks.turnarounds.length) return;
    if (a.hard.breaches) return;
    const v = c => a.fatigue.results.find(x => x.code === c)?.value ?? 0;
    const key = a.fatigue.present * 1000 + v('FF11') * 20 + v('FF19') * 6 + a.checks.longestStretch * 8
              - a.checks.weekendsOff * 15 - a.feel.oneTurn * 3;
    if (!best || key < best.key) best = { key, P, a, ar,
        facts: { present: a.fatigue.present, run: a.checks.longestStretch, wk: a.checks.weekendsOff,
                 ff11: v('FF11'), ff11ros: ar.ff11.worst, ff19: v('FF19'), ff15: v('FF15'), ff8b: v('FF8b'),
                 oneTurn: `${a.feel.oneTurn}/${a.feel.workingLines}`, exSun: a.hours.exSunday,
                 h55: a.fatigue.results.filter(x=>x.code==='MRSF').find(x=>String(x.title).includes('55 hours'))?.value } };
}
walk(0, { ...counts }, []);
console.log(`assignments evaluated: ${found}`);
if (!best) { console.log('no assignment clears the 12h rest rule'); process.exit(1); }
console.log('best:', JSON.stringify(best.facts));
console.log('Saturday column:');
SLOTS.forEach(k => console.log(`   line ${String(k).padStart(2)}  ${P0[k].sat.padEnd(12)} -> ${best.P[k].sat}`));
writeFileSync('./saturday-four.json', JSON.stringify(best.P, null, 1));
console.log('\nwritten saturday-four.json');
