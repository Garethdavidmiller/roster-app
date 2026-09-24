// Search a SATURDAY table on Saturday's own minute budget.
//
// The brief (owner, 22 Sep 2026): fewer start and finish times on Saturday, and cover that follows the
// December Saturday curve instead of running flat. Saturday only, and weeks may move within that column.
//
// WHAT IS FIXED AND WHY. Saturday's 12 duties pay 5,895 minutes, and Monday to Saturday must come to
// 42,000 against 20 working lines x 35h. Touching Saturday alone therefore means keeping BOTH the count
// and the total, so the search is over tables that pay exactly what Saturday already pays. That is not a
// self-imposed limit: relax it and the contract moves, which is a refusal in the workspace.
//
// THE POOL. Quarter-hour starts (07:00-17:00) plus the 06:20 open; quarter-hour finishes (13:30-22:45)
// plus the 23:55 close; every duty 7h00-8h40. That encodes the December rules this folder works to -- no
// :05 or :10 except the open and the close, and nothing over 8h40.
//
// THE SCORE. fit.mjs's own demand measure against DEC_2026_DEMAND.sat, then fewer distinct turns, then
// the thinnest fully-covered hour. The floor matters: without it the search buys a better share-fit by
// hollowing out the evening, which reads as an improvement and is not one.
//
// OPEN_N / KS / FLOOR are env knobs, and they are how the report's "four at the open is unreachable"
// claim was established: no table in this pool puts four at the open AND four at the close, at any floor.
import { startMinutes, endMinutes } from '../../../links-design.js';
import { DEC_2026_DEMAND } from '../../../links-demand.js';
const WIN=[6*60+20,23*60+55];
// WEMBLEY (owner, 22 Sep 2026). Chiltern serves Wembley Stadium station out of Marylebone, so a
// Saturday event loads the afternoon and evening in a way the measured timetable curve does not show --
// the curve counts trains, and an event fills the ones already there. LATE_W lifts the TARGET for
// 15:00-23:00 so the fit measure asks for more people then; it does not pretend the traffic figures
// are different, and the traffic row printed on page 4 is still the measured one.
// 1.15 is the shipped setting, and it is 'slightly' on purpose. 1.10, 1.15 and 1.20 all return the
// SAME table, so the answer is not balanced on the knob; 1.25 buys another person at 16:00 and pays a
// whole one back at 09:00, where the curve reads 81 cars. The gentle weight moves half a person.
const LATE_W=Number(process.env.LATE_W??1.15), LATE_FROM=15, LATE_TO=23;
const cars=DEC_2026_DEMAND.sat.cars.map((c,h)=>h>=LATE_FROM&&h<=LATE_TO?c*LATE_W:c);
const HM=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const T=(s,e)=>`${HM(s)}-${HM(e)}`;
function fit(duties){
  const h=new Array(24).fill(0);
  for(const [t,n] of duties){const s=startMinutes(t),e=endMinutes(t);for(let m=s;m<e;m+=5)h[Math.floor(m/60)]+=n/12;}
  const [ws,we]=WIN; const hrs=[];for(let x=6;x<=23;x++)hrs.push(x);
  const frac=x=>{const a=Math.max(ws,x*60),b=Math.min(we,(x+1)*60);return Math.max(0,b-a)/60;};
  const D=hrs.reduce((s,x)=>s+cars[x]*frac(x),0),C=hrs.reduce((s,x)=>s+h[x],0);
  let sq=0,worst=99,worstH=0;
  for(const x of hrs){const ds=cars[x]*frac(x)/D,cs=h[x]/C;sq+=(ds-cs)**2*1e4;
    const p=h[x]/Math.max(frac(x),1e-9);if(frac(x)>=0.99&&p<worst){worst=p;worstH=x;}}
  return {sq:+sq.toFixed(1),worst:+worst.toFixed(2),worstH,cov:hrs.map(x=>h[x])};
}
const KS=(process.env.KS??'4,4,5,5,5,6').split(',').map(Number);
// Default: at least four at the open and exactly four through to the close -- the December rules, as
// far as they can be met. Set OPEN_N to pin the open exactly (OPEN_N=4 finds nothing; that is the
// report's claim, and running it is how to check it).
const OPEN_N=process.env.OPEN_N?Number(process.env.OPEN_N):null;
const OPEN=6*60+20, CLOSE=23*60+55, TOTAL=5895, N=12;
// Legal clock times: quarter hours, plus the open and the close. "No :05 or :10 except open and close."
const QS=[];for(let m=7*60;m<=17*60;m+=15)QS.push(m);
const STARTS=[OPEN,...QS];
// THE TICKET OFFICE CLOSES AT 22:30 (owner, 22 Sep 2026). A turn that finishes in the evening but
// before the station closes finishes when the office does -- so in the 21:00-23:00 band, 22:30 is the
// only legal finish. The first version of this table put two turns at 22:15, fifteen minutes short of
// a real handover point, which is exactly the kind of time a search invents and a station cannot use.
const OFFICE_CLOSE=22*60+30;
const ENDS=[];for(let m=13*60+30;m<=22*60+45;m+=15){ if(m>21*60&&m<23*60&&m!==OFFICE_CLOSE) continue; ENDS.push(m); }
ENDS.push(CLOSE);
const LO=420, HI=520;                                    // 7h00 .. 8h40
const POOL=[];
for(const s of STARTS)for(const e of ENDS){const d=e-s;if(d>=LO&&d<=HI)POOL.push([s,e,d]);}
// compositions of N into K parts, each 1..6
function comps(n,k,max=6){ if(k===1) return n>=1&&n<=max?[[n]]:[];
  const out=[];for(let i=1;i<=Math.min(max,n-(k-1));i++)for(const r of comps(n-i,k-1,max))out.push([i,...r]);return out; }
const COMPS={4:comps(N,4),5:comps(N,5),6:comps(N,6)};
let best=null, tried=0; const byK={};
// SEEDED, so the table is reproducible. A randomised search whose answer changes between runs cannot
// be cited by a document -- the same defect the fingerprint check exists to catch one level up.
let _s=(Number(process.env.SEED??7)>>>0)||7;
const rand=()=>{_s^=_s<<13;_s>>>=0;_s^=_s>>17;_s^=_s<<5;_s>>>=0;return _s/4294967296;};
const rnd=a=>a[(rand()*a.length)|0];
const t0=Date.now();
const BUDGET=Number(process.env.MS??90_000);
while(Date.now()-t0 < BUDGET){
  const K=KS[(rand()*KS.length)|0];
  const turns=[];const seen=new Set();
  while(turns.length<K){const p=rnd(POOL);const k=p[0]+'-'+p[1];if(seen.has(k))continue;seen.add(k);turns.push(p);}
  turns.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  for(const c of COMPS[K]){
    tried++;
    const sum=turns.reduce((a,t,i)=>a+t[2]*c[i],0);
    const diff=TOTAL-sum; if(diff===0){ score(turns,c); continue; }
    // repair: shift ONE turn's finish so the total lands exactly
    for(let i=0;i<K;i++){
      if(diff%c[i]!==0) continue;
      const ne=turns[i][1]+diff/c[i], nd=ne-turns[i][0];
      if(nd<LO||nd>HI) continue;
      if(!ENDS.includes(ne)) continue;
      const t2=turns.map((t,j)=>j===i?[t[0],ne,nd]:t);
      if(new Set(t2.map(t=>t[0]+'-'+t[1])).size!==K) continue;
      score(t2.sort((a,b)=>a[0]-b[0]||a[1]-b[1]),c);
    }
  }
}
function score(turns,c){
  const duties=turns.map((t,i)=>[T(t[0],t[1]),c[i]]);
  const total=turns.reduce((a,t,i)=>a+t[2]*c[i],0); if(total!==TOTAL) return;
  const open=duties.filter(([t])=>t.startsWith(HM(OPEN))).reduce((a,[,n])=>a+n,0);
  const close=duties.filter(([t])=>t.endsWith(HM(CLOSE))).reduce((a,[,n])=>a+n,0);
  if(OPEN_N===null?open<4:open!==OPEN_N) return;
  if(close!==4) return;                       // the two December Saturday rules
  const f=fit(duties);
  if(f.worst<Number(process.env.FLOOR??2.8)) return;                           // never thinner at any hour than today
  const key=f.sq + turns.length*0.9 - f.worst*0.4;  // fit first, then fewer turns, then the floor
  const rec={key,duties,f,K:turns.length,open,close,
    starts:new Set(duties.map(([t])=>t.split('-')[0])).size, ends:new Set(duties.map(([t])=>t.split('-')[1])).size};
  if(!best||key<best.key) best=rec;
  if(!byK[turns.length]||f.sq<byK[turns.length].f.sq) byK[turns.length]=rec;
}
console.log(`tried ${tried.toLocaleString()} tables`);
if(!best){console.log('none found');process.exit(1);}
console.log(`\nBEST: ${best.K} turns · ${best.starts} starts · ${best.ends} finishes · ${best.open} at open · ${best.close} at close`);
for(const [t,n] of best.duties) console.log(`   ${t}  x${n}`);
console.log(`   fit sq ${best.f.sq}  worst ${best.f.worst} at ${best.f.worstH}:00`);
console.log('   cover 06..23:', best.f.cov.map(x=>x.toFixed(1)).join(' '));
console.log('   demand      :', Array.from({length:18},(_,i)=>cars[i+6]).join(' '));
console.log('\nbest at each turn count (fit first):');
for(const k of Object.keys(byK).sort()){const b=byK[k];
  console.log(`   ${k} turns · ${b.starts} starts · ${b.ends} finishes · sq ${b.f.sq} · worst ${b.f.worst} · ${b.duties.map(([t,n])=>t+' x'+n).join('  ')}`);}
