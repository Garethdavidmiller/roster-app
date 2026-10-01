// The duty TABLE for the widened link — today's shift times, December's headcounts, exact contract.
// Rules honoured (owner's Dec-26 figures, as pinned in links-default-targets.js):
//   4 on at the open · 3 through to the close (4 on Sat) · 5 still on at 22:00 · Sat 14 · Sun 10
//   4 cover weeks → 20 working lines → Mon–Sat duty must total EXACTLY 20 x 35h = 42,000 min.
import { dutyMinutes, startMinutes, endMinutes } from '../../../links-design.js';
const WK  = ['06:20-13:45','06:20-14:20','08:00-16:30','11:00-19:30','13:30-22:00','14:00-22:30','15:15-23:55'];
const SAT = ['06:20-14:00','06:20-14:50','08:00-16:30','12:00-20:00','13:30-21:00','13:30-22:00','14:30-22:00','14:00-22:30','14:45-23:55'];
const SUN = ['07:15-15:45','08:30-16:30','11:00-19:30','13:00-21:00','14:30-23:25'];
const TODAY = { // busiest-day counts on the live roster (links-seed)
  '06:20-13:35':1,'06:20-13:45':1,'06:20-14:20':2,'08:00-16:30':2,'11:00-19:30':1,'13:30-22:00':1,'14:00-22:30':2,'15:15-23:55':2,
  '06:20-14:00':1,'06:20-14:50':3,'12:00-20:00':1,'13:30-21:00':1,'14:30-22:00':2,'14:45-23:55':2,
  '07:15-15:45':3,'08:30-16:30':1,'13:00-21:00':1,'14:30-23:25':3 };
const opens = (t, o) => t.startsWith(o); const closes = (t, c) => t.endsWith(c);
const on22 = t => endMinutes(t) > 22*60;
function* combos(vocab, maxPer, total) { // all count vectors summing to total
  const n = vocab.length; const v = new Array(n).fill(0);
  function* rec(i, left) { if (i === n-1) { if (left <= maxPer[i]) { v[i]=left; yield v.slice(); } return; }
    for (let c = 0; c <= Math.min(maxPer[i], left); c++) { v[i]=c; yield* rec(i+1, left-c); } }
  yield* rec(0, total);
}
const mins = (vocab, v) => v.reduce((s,c,i)=>s+c*dutyMinutes(vocab[i]),0);
const cnt = (vocab, v, pred) => v.reduce((s,c,i)=>s+(pred(vocab[i])?c:0),0);
const distinct = v => v.filter(c=>c>0).length;
const drift = (vocab, v) => v.reduce((s,c,i)=>s+Math.abs(c-(TODAY[vocab[i]]??0)),0);

const wkOk = v => cnt(WK,v,t=>opens(t,'06:20'))===4 && cnt(WK,v,t=>closes(t,'23:55'))===3 && cnt(WK,v,on22)===5;
const satOk= v => cnt(SAT,v,t=>opens(t,'06:20'))===4 && cnt(SAT,v,t=>closes(t,'23:55'))===4 && cnt(SAT,v,on22)===5;
const sunOk= v => cnt(SUN,v,t=>opens(t,'07:15'))===4 && cnt(SUN,v,t=>closes(t,'23:25'))===3;

const wk = [], sat = [];
for (const n of [13,14,15]) for (const v of combos(WK, [2,4,3,3,2,3,3], n)) if (wkOk(v)) wk.push({ n, v, m: mins(WK,v) });
for (const v of combos(SAT, [1,4,2,2,2,2,3,2,4], 14)) if (satOk(v)) sat.push({ v, m: mins(SAT,v) });
const sun = []; for (const v of combos(SUN, [4,2,2,2,3], 10)) if (sunOk(v)) sun.push({ v });
console.log('weekday candidates', wk.length, 'sat', sat.length, 'sun', sun.length);
const exact = [];
for (const w of wk) for (const s of sat) if (5*w.m + s.m === 42000) exact.push({ w, s });
console.log('EXACT 42,000 pairs:', exact.length);
exact.sort((a,b)=> (distinct(a.w.v)+distinct(a.s.v)) - (distinct(b.w.v)+distinct(b.s.v)) || (drift(WK,a.w.v)+drift(SAT,a.s.v)) - (drift(WK,b.w.v)+drift(SAT,b.s.v)));
const show = (vocab, v) => vocab.map((t,i)=>v[i]?`${t}x${v[i]}`:null).filter(Boolean).join('  ');
for (const e of exact.slice(0, 12)) console.log(`wk n=${e.w.n} d=${distinct(e.w.v)} drift=${drift(WK,e.w.v)} | sat d=${distinct(e.s.v)} drift=${drift(SAT,e.s.v)}\n   WK  ${show(WK,e.w.v)}\n   SAT ${show(SAT,e.s.v)}`);
sun.sort((a,b)=>distinct(a.v)-distinct(b.v) || drift(SUN,a.v)-drift(SUN,b.v));
console.log('SUN best:', show(SUN, sun[0].v), '| alt:', show(SUN, sun[1]?.v??[]));
