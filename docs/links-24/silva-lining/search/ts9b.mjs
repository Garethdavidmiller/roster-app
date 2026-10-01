// Silva Lining with a 9-hour cap, no 14:45 closer, closers 15:45 and 16:25 (Saturday may also use today's 15:15),
// and as few shift times as possible. One weekday set, three closers. Kept for reference (links-24).
import fs from 'fs';
const TL = new URL('../../tooling/', import.meta.url).pathname;
const { assess, sheetRules, today, dutyMinutes, startMinutes } = await import(TL+'report-data.mjs');
const BASE=JSON.parse(fs.readFileSync(new URL('../silva-lining-F.json', import.meta.url),'utf8')); const L=Object.keys(BASE).sort((a,b)=>a-b);
const WK=['mon','tue','wed','thu','fri'];
const m=t=>dutyMinutes(t);
// fixed by the author's spec, the office and the rules: 4 at the open (3 short + the office early), the office's 07:00,
// 13:30-22:00 and two 14:00-22:30 (with the closers, 5 after 22:00), closers 15:45 ×2 and 16:25
const FIXED=['06:20-13:45','06:20-13:45','06:20-14:20','07:00-15:30','13:30-22:00','14:00-22:30','14:00-22:30','15:45-23:55','15:45-23:55','16:25-23:55'];
// free weekday slots: Silva Lining's own times and today's, none over 9h, no closer
const POOL=['06:20-13:45','06:20-14:20','06:20-14:50','06:20-14:00','07:00-15:30','07:15-15:45','08:00-16:30','08:30-16:30','08:30-17:00','11:00-19:30','12:00-20:00','12:00-20:30','12:00-21:00','13:00-21:00','13:30-21:00','13:30-22:00','14:00-22:30','14:30-22:00'];
// Saturday: 6 openers at 06:20 (one is 06:20-14:50 today in F), 08:30-17:00 or alternatives, office 13:30-22:00 ×2 and 14:00-22:30 ×2, 3 closers
const SAT_EARLY=['06:20-14:20','06:20-14:30','06:20-14:50'], SAT_MID=['08:30-17:00','08:00-16:30','08:30-16:30','08:00-17:00'], SAT_CLOSE=['15:45-23:55','15:15-23:55'];
const SUN=['07:15-15:45','08:30-16:30','14:00-22:30','14:30-23:25'];   // 14:25-23:25 merged into 14:30-23:25 (Sunday is overtime: no contract minutes move)
const fixedSum=FIXED.reduce((s,t)=>s+m(t),0), satFixed=2*m('13:30-22:00')+2*m('14:00-22:30');
const cands=[];
const combos3=[]; for(let a=0;a<POOL.length;a++) for(let b=a;b<POOL.length;b++) for(let c=b;c<POOL.length;c++) for(let e=c;e<POOL.length;e++){ const f=[POOL[a],POOL[b],POOL[c],POOL[e]]; if(f.some(t=>t.startsWith('06:20'))) combos3.push(f); }
// Saturday multisets: 6 earlies from SAT_EARLY (counts), 1 mid, 3 closers from SAT_CLOSE (counts)
const satOpts=[]; for(let x=0;x<=6;x++) for(let y=0;y<=6-x;y++){ const z=6-x-y; for(const mid of SAT_MID) for(let k=0;k<=3;k++){
  const early=[...Array(x).fill(SAT_EARLY[0]),...Array(y).fill(SAT_EARLY[1]),...Array(z).fill(SAT_EARLY[2])], close=[...Array(k).fill(SAT_CLOSE[1]),...Array(3-k).fill(SAT_CLOSE[0])];
  const list=[...early,mid,'13:30-22:00','13:30-22:00','14:00-22:30','14:00-22:30',...close]; satOpts.push({list,sum:list.reduce((s,t)=>s+m(t),0)}); } }
for(const free of combos3){ const wkSum=fixedSum+free.reduce((s,t)=>s+m(t),0);
  for(const tue of POOL){ const need=42000-5*wkSum-m(tue);
    for(const so of satOpts){ if(so.sum!==need) continue;
      const times=new Set([...FIXED,...free,tue,...so.list,...SUN]);
      cands.push({free,tue,sat:so.list,n:times.size}); } } }
cands.sort((a,b)=>a.n-b.n);
console.log('exact-35h tables:',cands.length,'· fewest shift times:',cands[0]?.n);
// relabel F onto each table (each line keeps its worked days), then judge
function apply(c){ const p=JSON.parse(JSON.stringify(BASE));
  const place=(d,want)=>{ const have=L.filter(l=>/^\d/.test(p[l][d])); if(have.length!==want.length) throw new Error(d+' '+have.length+'≠'+want.length);
    const left=[...want], todo=[]; for(const l of have){ const i=left.indexOf(p[l][d]); if(i>=0) left.splice(i,1); else todo.push(l); }
    for(const l of todo.sort((a,b)=>startMinutes(p[a][d])-startMinutes(p[b][d]))){ let bi=0; left.forEach((t,i)=>{ if(Math.abs(startMinutes(t)-startMinutes(p[l][d]))<Math.abs(startMinutes(left[bi])-startMinutes(p[l][d]))) bi=i; }); p[l][d]=left.splice(bi,1)[0]; } };
  for(const d of WK) place(d,[...FIXED,...c.free,...(d==='tue'?[c.tue]:[])]);
  place('sat',c.sat); for(const l of L) if(p[l].sun==='14:25-23:25') p[l].sun='14:30-23:25';
  return p; }
const T=today(), TA=assess(T.patterns,20); const out=[];
const minN=cands[0]?.n; for(const c of cands.filter(c=>c.n<=minN+(+(process.env.SLACK??2))).slice(0,+(process.env.N??600))){
  const p=apply(c), A=assess(p,24), R=sheetRules({patterns:p,...A},TA,'plan');
  out.push({...c,fit:[A.wkFit,A.fits.sat,A.fits.sun],met:R.met,fails:R.rows.filter(r=>!r.ok).map(r=>r.key).join(','),p}); }
const F0=assess(BASE,24); const ok=out.filter(r=>r.met>=8 && r.fit[0]<=F0.wkFit+1e-9 && r.fit[1]<=F0.fits.sat+1e-9 && r.fit[2]<=F0.fits.sun+1e-9);
console.log('judged',out.length,'· 8 of 8 and no day worse than F:',ok.length,'· F fit',[F0.wkFit,F0.fits.sat,F0.fits.sun].map(x=>x.toFixed(1)).join(' · '));
ok.sort((a,b)=>a.n-b.n || (a.fit[0]+a.fit[1]+a.fit[2])-(b.fit[0]+b.fit[1]+b.fit[2]));
for(const r of ok.slice(0,8)) console.log(r.n,'times ·',r.fit.map(x=>x.toFixed(1)).join(' · '),'| free',r.free.join(' + '),'| Tue',r.tue,'| Sat',[...new Set(r.sat)].map(t=>t+'×'+r.sat.filter(x=>x===t).length).join(' '));
fs.writeFileSync('ts9-best.json',JSON.stringify(ok.slice(0,8).map(({p,...r})=>r))); ok.slice(0,8).forEach((r,i)=>fs.writeFileSync(`ts9-${i}.json`,JSON.stringify(r.p)));
