// Same Turns with the closer at 15:45 AND no duty over 8h40 (520 min). Two readings of the cap:
//   WEEKDAY-ONLY: Sat/Sun keep Same Turns' tables (Sat 14:45-23:55 is 9h10, Sun 14:30-23:25 is 8h55 — today's own turns)
//   EVERYWHERE:   those two weekend turns are shortened to the cap as well (Sat → 15:15-23:55, Sun → 14:45-23:25)
import { dutyMinutes, endMinutes } from '../../../links-design.js';
const CAP = 520;
const fmt = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const stretch = (t, d) => `${t.slice(0,5)}-${fmt(endMinutes(t)+d)}`;
const BASE = ['06:20-13:45','06:20-14:20','08:00-16:30','11:00-19:30','13:30-22:00','14:00-22:30'];
const LATE = '15:45-23:55';
const SAT_B = [['06:20-14:00',1],['06:20-14:50',3],['08:00-16:30',2],['12:00-20:00',1],['14:30-22:00',2],['14:00-22:30',1],['14:45-23:55',4]];
const SAT_CAP = SAT_B.map(([t,n]) => [t === '14:45-23:55' ? '15:15-23:55' : t, n]);
const opens=(t,o)=>t.startsWith(o), closes=(t,c)=>t.endsWith(c), on22=t=>endMinutes(t)>22*60;
function* combos(vocab, maxPer, total){ const n=vocab.length; const v=new Array(n).fill(0);
  function* rec(i,left){ if(i===n-1){ if(left<=maxPer[i]){v[i]=left; yield v.slice();} return;} for(let c=0;c<=Math.min(maxPer[i],left);c++){v[i]=c; yield* rec(i+1,left-c);} }
  yield* rec(0,total); }
const STB = {'06:20-13:45':2,'06:20-14:20':2,'08:00-16:30':3,'11:00-19:30':0,'13:30-22:00':2,'14:00-22:30':2};
for (const [label, SAT] of [['WEEKDAY-ONLY cap (Sat/Sun as Same Turns)', SAT_B], ['cap EVERYWHERE (Sat closer 15:15-23:55)', SAT_CAP]]) {
  const satMin = SAT.reduce((s,[t,n])=>s+n*dutyMinutes(t),0); const need = (42000 - satMin)/5;
  console.log(`\n=== ${label}: Saturday pays ${satMin}, each weekday must pay ${need}${Number.isInteger(need)?'':' — NOT A WHOLE NUMBER, no weekday table can do it'} ===`);
  if (!Number.isInteger(need)) continue;
  const found = []; const idx=[0,1,2,3,4,5], ds=[0,15,30,45];
  for (const i of idx) for (const j of idx) { if (j < i) continue; for (const di of ds) for (const dj of ds) {
    if (i===j && dj!==di) continue; if (i!==j && (di===0||dj===0)) continue;
    const vocab = BASE.map((t,k)=> k===i ? stretch(t,di) : k===j ? stretch(t,dj) : t).concat([LATE]);
    if (vocab.some(t => dutyMinutes(t) > CAP)) continue;
    for (const n of [13,14,15]) for (const v of combos(vocab,[3,4,4,3,3,3,3],n)) {
      const cnt=p=>v.reduce((s,c,k)=>s+(p(vocab[k])?c:0),0);
      if (cnt(t=>opens(t,'06:20'))!==4 || cnt(t=>closes(t,'23:55'))!==3 || cnt(on22)!==5) continue;
      if (v.reduce((s,c,k)=>s+c*dutyMinutes(vocab[k]),0)!==need) continue;
      const drift = vocab.reduce((s,t,k)=>s+Math.abs(v[k]-(k<6?STB[BASE[k]]:3)),0);
      const stretched = vocab.slice(0,6).map((t,k)=> t!==BASE[k] && v[k]>0 ? `${BASE[k]}→${t.split('-')[1]}` : null).filter(Boolean);
      const longest = Math.max(...vocab.filter((t,k)=>v[k]>0).map(dutyMinutes));
      found.push({ v, vocab, drift, distinct: v.filter(c=>c>0).length, stretched, longest });
    } } }
  const seen = new Set(); const uniq = found.filter(f => { const k = f.vocab.map((t,i)=>`${t}x${f.v[i]}`).join(); if (seen.has(k)) return false; seen.add(k); return true; });
  console.log('exact tables under the cap:', uniq.length, '| zero-drift:', uniq.filter(f=>f.drift===0).length);
  uniq.sort((a,b)=>a.drift-b.drift || a.stretched.length-b.stretched.length || a.distinct-b.distinct || a.longest-b.longest);
  for (const f of uniq.slice(0,12)) console.log(`drift=${f.drift} stretched=${f.stretched.length} longest=${Math.floor(f.longest/60)}h${String(f.longest%60).padStart(2,'0')}  ${f.vocab.map((t,i)=>f.v[i]?`${t}x${f.v[i]}`:null).filter(Boolean).join('  ')}`);
}
