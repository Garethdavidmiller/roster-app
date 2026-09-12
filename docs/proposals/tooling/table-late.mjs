// The duty table for a link whose CLOSING turn starts 15:45 rather than 15:15 (the owner's ask, 12 Sep 2026).
// Thirty minutes off three duties a day is 450 a week, and the contract is exact — so with today's turns
// alone no table pays 42,000 (table.mjs with the substitution finds 0 of 200 × 122). This lets ONE other
// weekday turn keep its start and finish 15/30/45 min later, and lists every exact table by drift from B.
import { dutyMinutes, endMinutes, startMinutes } from '../../../links-design.js';
const fmt = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const stretch = (t, d) => `${t.slice(0,5)}-${fmt(endMinutes(t)+d)}`;
const BASE = ['06:20-13:45','06:20-14:20','08:00-16:30','11:00-19:30','13:30-22:00','14:00-22:30'];
const LATE = '15:45-23:55';
const SATB = [['06:20-14:00',1],['06:20-14:50',3],['08:00-16:30',2],['12:00-20:00',1],['14:30-22:00',2],['14:00-22:30',1],['14:45-23:55',4]];
const satMin = SATB.reduce((s,[t,n])=>s+n*dutyMinutes(t),0);
const need = (42000 - satMin) / 5;   // exact weekday minutes required
console.log('Saturday pays', satMin, '→ each weekday must pay exactly', need);
const opens = (t,o)=>t.startsWith(o), closes=(t,c)=>t.endsWith(c), on22=t=>endMinutes(t)>22*60;
function* combos(vocab, maxPer, total) { const n=vocab.length; const v=new Array(n).fill(0);
  function* rec(i,left){ if(i===n-1){ if(left<=maxPer[i]){v[i]=left; yield v.slice();} return;} for(let c=0;c<=Math.min(maxPer[i],left);c++){v[i]=c; yield* rec(i+1,left-c);} }
  yield* rec(0,total); }
const found = [];
// variant: which base turn is stretched (or none), by how much
for (const bi of [-1,0,1,2,3,4,5]) for (const d of (bi<0?[0]:[15,30,45])) {
  const vocab = BASE.map((t,i)=> i===bi ? stretch(t,d) : t).concat([LATE]);
  for (const n of [13,14,15]) for (const v of combos(vocab,[3,4,4,3,3,3,3],n)) {
    const cnt = p => v.reduce((s,c,i)=>s+(p(vocab[i])?c:0),0);
    if (cnt(t=>opens(t,'06:20'))!==4 || cnt(t=>closes(t,'23:55'))!==3 || cnt(t=>on22(t))!==5) continue;
    const m = v.reduce((s,c,i)=>s+c*dutyMinutes(vocab[i]),0);
    if (m!==need) continue;
    found.push({ bi, d, n, v, vocab, distinct: v.filter(c=>c>0).length });
  }
}
console.log('exact tables:', found.length);
// Same Turns B counts for drift: 06:20-13:45x2 06:20-14:20x2 08:00-16:30x3 13:30-22:00x2 14:00-22:30x2 late x3
const STB = {'06:20-13:45':2,'06:20-14:20':2,'08:00-16:30':3,'11:00-19:30':0,'13:30-22:00':2,'14:00-22:30':2};
const driftOf = f => f.vocab.reduce((s,t,i)=>{ const base = i<6 ? BASE[i] : null; const ref = base ? STB[base] : 3; return s+Math.abs(f.v[i]-ref); },0);
found.sort((a,b)=> (a.bi<0?0:1)-(b.bi<0?0:1) || driftOf(a)-driftOf(b) || a.distinct-b.distinct || a.d-b.d);
for (const f of found.slice(0,20)) console.log(`stretch=${f.bi<0?'none':BASE[f.bi]+'→'+f.vocab[f.bi]} n=${f.n} drift=${driftOf(f)} d=${f.distinct}  ${f.vocab.map((t,i)=>f.v[i]?`${t}x${f.v[i]}`:null).filter(Boolean).join('  ')}`);
