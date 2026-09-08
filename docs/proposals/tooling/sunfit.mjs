import { startMinutes, endMinutes } from '../../../links-design.js';
import { DEC_2026_DEMAND } from '../../../links-demand.js';
const ws=7*60+15, we=23*60+25; const cars=DEC_2026_DEMAND.sun.cars;
function fit(duties){ const h=new Array(24).fill(0); for(const [t,n] of duties){ for(let m=startMinutes(t);m<endMinutes(t);m+=5) h[Math.floor(m/60)]+=n/12; }
  const hrs=[]; for(let x=7;x<=22;x++) hrs.push(x); const frac=x=>{const a=Math.max(ws,x*60),b=Math.min(we,(x+1)*60);return Math.max(0,b-a)/60;};
  const D=hrs.reduce((s,x)=>s+cars[x]*frac(x),0), C=hrs.reduce((s,x)=>s+h[x],0); let sq=0; for(const x of hrs){ sq+=((cars[x]*frac(x)/D)-(h[x]/C))**2*1e4; } return { sq:+sq.toFixed(1), cov: hrs.map(x=>h[x].toFixed(1)).join(' ') }; }
const mids=['08:30-16:30','11:00-19:30','13:00-21:00'];
const combos=[]; for(let a=0;a<=3;a++) for(let b=0;b<=3-a;b++){ const c=3-a-b; combos.push([[mids[0],a],[mids[1],b],[mids[2],c]]); }
for (const mid of combos){ const d=[['07:15-15:45',4],...mid.filter(x=>x[1]>0),['14:30-23:25',3]]; console.log(mid.map(x=>x[1]).join('/'), JSON.stringify(fit(d))); }
console.log('today', JSON.stringify(fit([['07:15-15:45',3],['08:30-16:30',1],['13:00-21:00',1],['14:30-23:25',3]])));
