// Polished Clean → 14 a day Monday to Saturday. Scratch exploration only.
const TL = new URL('../../tooling/', import.meta.url).pathname;
const { assess, dutyMinutes, sheetRules, today, h55Worst } = await import(TL+'report-data.mjs');
const { personal } = await import(TL+'plain.mjs');
import fs from 'fs';
const base=JSON.parse(fs.readFileSync(TL+'../Polished-Clean-PC-24-EXT.json','utf8')); const P0=base.patterns??base;
const clone=p=>JSON.parse(JSON.stringify(p)); const L=Object.keys(P0).sort((a,b)=>a-b); const WK=['mon','tue','wed','thu','fri'], MS=[...WK,'sat'], D=['sun',...MS];
const timed=s=>/^\d\d:\d\d-\d\d:\d\d$/.test(s); const T=today(), TA=assess(T.patterns,20);
let seed=+(process.argv[2]??1); const rnd=()=>{ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; }; const pick=a=>a[Math.floor(rnd()*a.length)];
function start(){ const p=clone(P0);
  for(const d of WK){ let k=0; for(const l of L) if(p[l][d]==='16:25-23:55' && k++>=1) p[l][d]='15:45-23:55'; }
  for(const l of L) for(const d of WK) if(p[l][d]==='06:20-13:35') p[l][d]='06:20-13:45';
  for(const [f,t] of [['10:30-19:00','07:15-15:45'],['13:30-21:30','14:00-22:30'],['14:20-23:25','14:25-23:25']]) for(const l of L) if(p[l].sun===f){p[l].sun=t;break;}
  return p; }
const count=(p,d)=>L.filter(l=>timed(p[l][d])).length;
// duties a day can spare without touching the opening four, the closers, the 22:00 pair or the office's own four
const SPARE={ mon:['08:30-17:00','12:00-20:30'], sat:['13:30-21:30','14:30-22:30'], tue:['07:00-15:30','08:30-16:30','08:30-17:00','12:00-20:30'], wed:['08:30-16:30','08:30-17:00','13:30-21:30','12:00-20:30'],
  thu:['13:30-22:00','13:30-21:30','12:00-20:30','08:30-17:00'], fri:['07:00-15:30','13:30-21:30','16:25-23:55','15:45-23:55','08:30-17:00','12:00-20:30'] };
const ADD={ tue:['08:30-17:00','12:00-21:00'], wed:['08:30-17:00','12:00-21:00'], thu:['08:30-17:00','12:00-21:00'], fri:['08:30-17:00','12:00-21:00'], mon:['08:30-17:00','12:00-21:00','13:30-22:00','06:20-14:50'], sat:['08:30-17:00','12:00-21:00','14:45-23:55','06:20-14:50','14:00-22:30','13:30-22:00'] };
// lengthenings: [from, to, days, newTime]. "newTime" = a time neither today's link nor Polished Clean works
const MENU=[['13:30-21:30','13:30-22:00',MS,0],['12:00-20:30','12:00-21:00',MS,0],['08:30-16:30','08:30-17:00',WK,0],['15:15-23:55','14:45-23:55',['sat'],0],
  ['06:20-14:30','06:20-14:50',['sat'],0],['06:20-14:25','06:20-14:50',['sat'],0],['14:30-22:30','14:00-22:30',['sat'],0],['16:25-23:55','15:45-23:55',['fri'],0],
  ['06:20-14:20','06:20-14:50',WK,0],['07:00-15:30','07:00-16:00',WK,1],['08:30-17:00','08:00-17:00',MS,1],['13:30-22:00','13:00-22:00',MS,1],['14:00-22:30','13:30-22:30',MS,1]];
const mins=p=>{let s=0; for(const l of L) for(const d of MS) if(timed(p[l][d])) s+=dutyMinutes(p[l][d]); return s;};
function balance(p){ // exactly 42,000: fewest lengthenings, and a new shift time costs as much as three edits
  const need=42000-mins(p); if(need<0) return null; if(need===0) return {p,edits:[]};
  const items=[]; MENU.forEach(([f,t,days,nt],k)=>L.forEach(l=>days.forEach(d=>{ if(p[l][d]===f) items.push({k,l,d,g:dutyMinutes(t)-dutyMinutes(f),nt}); })));
  const INF=1e9, best=new Array(need+1).fill(null); best[0]={c:0,used:[],types:new Set()};
  for(const it of items) for(let s2=need;s2>=it.g;s2--){ const prev=best[s2-it.g]; if(!prev) continue;
    const c=prev.c+1+(it.nt&&!prev.types.has(it.k)?3:0); if(!best[s2]||c<best[s2].c){ const types=new Set(prev.types); types.add(it.k); best[s2]={c,used:[...prev.used,it],types}; } }
  const b=best[need]; if(!b) return null; const q=clone(p); const cnt={};
  for(const it of b.used){ q[it.l][it.d]=MENU[it.k][1]; const key=`${MENU[it.k][0]}→${MENU[it.k][1]}${MENU[it.k][3]?' (new time)':''}`; cnt[key]=(cnt[key]||0)+1; }
  return {p:q,edits:Object.entries(cnt).map(([k,n])=>`${k} ×${n}`)}; }
function trial(){ const p=start(); const log=[];
  const TARGET=Object.fromEntries(MS.map(d=>[d,d===(process.argv[4]??'')?15:14])); const now0=Object.fromEntries(MS.map(d=>[d,count(p,d)]));
  const remove={}, add={}; for(const d of MS){ const x=now0[d]-TARGET[d]; if(x>0) remove[d]=x; if(x<0) add[d]=-x; }
  // removals; a removal moved onto the same line's Monday or Saturday keeps that week's days unchanged
  const targets=[]; for(const [d,n] of Object.entries(add)) for(let i=0;i<n;i++) targets.push(d);
  for(const [d,n] of Object.entries(remove)) for(let i=0;i<n;i++){
    const ls=L.filter(l=>SPARE[d].includes(p[l][d])); if(!ls.length) return null;
    const movable=ls.filter(l=>targets.some(t=>!timed(p[l][t])&&p[l][t]!=='SPARE'));
    const l=(movable.length&&rnd()<0.85)?pick(movable):pick(ls); const was=p[l][d]; p[l][d]='RD';
    const tIdx=targets.findIndex(t=>!timed(p[l][t])&&p[l][t]!=='SPARE');
    if(tIdx>=0&&rnd()<0.85){ const t=targets.splice(tIdx,1)[0]; p[l][t]=pick(ADD[t]); log.push(`L${l} ${d} ${was} → ${t} ${p[l][t]}`); } else log.push(`L${l} ${d} ${was} → rest`);
  }
  for(const t of targets){ const ls=L.filter(l=>p[l][t]==='RD'); const l=pick(ls); p[l][t]=pick(ADD[t]); log.push(`L${l} ${t} rest → ${p[l][t]}`); }
  if(MS.some(d=>count(p,d)!==TARGET[d])) return null;
  const b=balance(p); if(!b) return null; return {p:b.p,log,edits:b.edits}; }
function score(p){ const A=assess(p,24), R=sheetRules({patterns:p,...A},TA,'plan'), pp=personal(p), h=h55Worst(p,24);
  const hard=A.checks.turnarounds.length===0 && A.checks.longestStretch<=13;
  const met=R.rows.filter(r=>r.ok && r.key!=='office').length;
  return {A,R,pp,hard,met,wk:A.checks.weekendsOff,six:A.feel.daysHist['6']??0,iso:A.feel.isolatedRest,ffW:A.fatigue.present+(h?.adds?1:0),ffF:A.fixed.present,fit:A.wkFit,
    newT:0, key:[hard?1:0,met,A.checks.weekendsOff,-(A.feel.daysHist['6']??0),-A.feel.isolatedRest,-A.fixed.present,-(A.fatigue.present+(h?.adds?1:0)),-A.wkFit]}; }
const cmp=(a,b)=>{ for(let i=0;i<a.length;i++) if(a[i]!==b[i]) return b[i]-a[i]; return 0; };
const N=+(process.argv[3]??400); let best=null, tried=0, valid=0;
for(let i=0;i<N;i++){ const t=trial(); tried++; if(!t) continue; valid++; const s=score(t.p); s.key=[s.key[0],s.key[1],-t.edits.filter(e=>e.includes('new time')).length,...s.key.slice(2)]; if(!best||cmp(s.key,best.s.key)<0) best={...t,s}; }
const s=best.s; console.log(`seed ${process.argv[2]} tried ${tried} valid ${valid}`);
console.log(JSON.stringify({key:s.key,days:s.pp.daysYear.toFixed(1),heads:MS.map(d=>s.A.daily[d]).join(' ')+' · '+s.A.daily.sun,met:s.met,fails:s.R.rows.filter(r=>!r.ok).map(r=>r.key+' '+r.value),rest:s.A.rest.minutes,run:[s.A.fixed.run,s.A.checks.longestStretch],ff:[s.ffF,s.ffW],wk:s.wk,six:s.six,iso:s.iso,times:s.A.feel.distinctTimes,fit:[s.A.wkFit,s.A.fits.sat,s.A.fits.sun].map(x=>x.toFixed(1)),late23:s.pp.late23.toFixed(1),avg:Math.round(s.pp.avgShift),open:s.A.heads.open,at22:s.A.heads.at22,close:s.A.heads.close,moves:best.log,edits:best.edits}));
fs.writeFileSync(`best-${process.argv[2]}-${process.argv[4]??'x'}.json`, JSON.stringify(best.p));
