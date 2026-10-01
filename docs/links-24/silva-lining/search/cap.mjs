// Weekday cap of 8h40 (owner, 1 Oct 2026): shorten what is over it, then find the lost minutes in every exact way the
// menu allows, and keep the combination that follows the trains best. Kept for reference (links-24).
import fs from 'fs';
const TL = new URL('../../tooling/', import.meta.url).pathname;
const { assess, sheetRules, today, dutyMinutes } = await import(TL+'report-data.mjs');
const [SRC, OUT] = process.argv.slice(2);
const P=JSON.parse(fs.readFileSync(SRC,'utf8')); const L=Object.keys(P).sort((a,b)=>a-b);
const WK=['mon','tue','wed','thu','fri'], MS=[...WK,'sat'], CAP=520;
const T=today(), TA=assess(T.patterns,20);
const mins=p=>{let s=0; for(const l of L) for(const d of MS) if(/^\d/.test(p[l][d])) s+=dutyMinutes(p[l][d]); return s;};
const occ=(p,days,t)=>L.flatMap(l=>days.filter(d=>p[l][d]===t).map(d=>[l,d]));
// how the over-cap weekday shifts are brought under it: each choice is tried
const SHORTEN={ '12:00-21:00':['12:00-20:30','12:20-21:00','12:00-20:40'], '14:45-23:55':['15:15-23:55'] };
// lengthenings: weekdays only up to 8h40; Saturday has no cap. [from,to,days,newTime]
const MENU=[['06:20-14:20','06:20-14:50',WK,0],['07:00-15:30','07:00-15:40',WK,1],['06:20-14:30','06:20-14:50',['sat'],0],['06:20-14:25','06:20-14:50',['sat'],0],
  ['08:30-17:00','08:00-17:00',['sat'],1],['13:30-22:00','13:00-22:00',['sat'],1],['14:00-22:30','13:30-22:30',['sat'],1],['12:00-20:30','12:00-20:40',WK,1],['08:30-16:30','08:30-17:00',WK,0]];
const over=Object.keys(SHORTEN).filter(t=>occ(P,WK,t).length);
const choices=over.reduce((acc,t)=>acc.flatMap(a=>SHORTEN[t].map(c=>({...a,[t]:c}))),[{}]);
const results=[];
for(const ch of choices){
  const base=JSON.parse(JSON.stringify(P)); for(const [t,c] of Object.entries(ch)) occ(base,WK,t).forEach(([l,d])=>base[l][d]=c);
  const need=42000-mins(base); if(need<0) continue;
  const opts=MENU.map(([f,t,days,nt])=>({f,t,nt,g:dutyMinutes(t)-dutyMinutes(f),o:occ(base,days,f)})).filter(x=>x.o.length&&x.g>0);
  const combos=[]; const rec=(i,sum,ks)=>{ if(sum===need){combos.push([...ks]);return;} if(i===opts.length||sum>need||combos.length>400) return;
    for(let k=0;k<=opts[i].o.length;k++){ks.push(k); rec(i+1,sum+k*opts[i].g,ks); ks.pop();} };
  rec(0,0,[]);
  for(const ks of combos){ const p=JSON.parse(JSON.stringify(base)); const edits=[];
    ks.forEach((k,i)=>{ if(!k) return; edits.push(`${opts[i].f}→${opts[i].t}${opts[i].nt?' (new)':''} ×${k}`); opts[i].o.slice(0,k).forEach(([l,d])=>p[l][d]=opts[i].t); });
    const overCap=L.some(l=>WK.some(d=>/^\d/.test(p[l][d])&&dutyMinutes(p[l][d])>CAP)); if(overCap) continue;
    const A=assess(p,24), R=sheetRules({patterns:p,...A},TA,'plan');
    results.push({p,shorten:ch,edits,fit:[A.wkFit,A.fits.sat,A.fits.sun],met:R.met,times:A.feel.distinctTimes,newT:ks.reduce((s,k,i)=>s+(k&&opts[i].nt?1:0),0)});
  }
}
const A0=assess(P,24); console.log(SRC,'start fit',[A0.wkFit,A0.fits.sat,A0.fits.sun].map(x=>x.toFixed(1)).join(' · '),'· exact capped versions:',results.length);
const ok=results.filter(r=>r.met>=8 && r.fit[0]<=A0.wkFit+1e-9 && r.fit[1]<=A0.fits.sat+(+(process.env.SAT_TOL??0))+1e-9 && r.fit[2]<=A0.fits.sun+1e-9);
console.log('meeting 8 of 8 and no day worse:', ok.length); results.length=0; results.push(...ok);
results.sort((a,b)=>a.newT-b.newT || (a.fit[0]+a.fit[1])-(b.fit[0]+b.fit[1]));
for(const r of results.slice(0,6)) console.log(r.fit.map(x=>x.toFixed(1)).join(' · '),'rules',r.met,'times',r.times,'new',r.newT,'|',JSON.stringify(r.shorten),'|',r.edits.join(', '));
if(results.length) fs.writeFileSync(OUT,JSON.stringify(results[0].p));
