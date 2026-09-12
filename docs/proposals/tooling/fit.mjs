// Demand fit of candidate day tables vs the measured Dec 2026 curve (cars-weighted, inside the window).
import { startMinutes, endMinutes } from '../../../links-design.js';
import { DEC_2026_DEMAND } from '../../../links-demand.js';
const WIN = { weekday:[6*60+20, 23*60+55], sat:[6*60+20, 23*60+55], sun:[7*60+15, 23*60+25] };
function cover(duties){ const h=new Array(24).fill(0); for(const [t,n] of duties){ const s=startMinutes(t), e=endMinutes(t); for(let m=s;m<e;m+=5) h[Math.floor(m/60)]+=n/12; } return h; }
function fit(cls, duties){
  const [ws,we]=WIN[cls]; const cars=DEC_2026_DEMAND[cls].cars; const cov=cover(duties);
  const hrs=[]; for(let h=Math.floor(ws/60); h<=Math.floor((we-1)/60); h++) hrs.push(h);
  const frac=h=>{ const a=Math.max(ws,h*60), b=Math.min(we,(h+1)*60); return Math.max(0,b-a)/60; };
  const D=hrs.reduce((s,h)=>s+cars[h]*frac(h),0), C=hrs.reduce((s,h)=>s+cov[h],0);
  let sq=0, worst=99, worstH=0; for(const h of hrs){ const ds=cars[h]*frac(h)/D, cs=cov[h]/C; sq+=(ds-cs)**2*1e4; const ppl=cov[h]/Math.max(frac(h),1e-9); if(frac(h)>=0.99 && ppl<worst){worst=ppl;worstH=h;} }
  return { sq:+sq.toFixed(1), worst:+worst.toFixed(2), worstH, cov: hrs.map(h=>cov[h].toFixed(1)).join(' ') };
}
const WKA=[['06:20-13:45',2],['06:20-14:20',2],['08:00-16:30',2],['11:00-19:30',3],['14:00-22:30',2],['15:15-23:55',3]];
const WKB=[['06:20-13:45',2],['06:20-14:20',2],['08:00-16:30',3],['13:30-22:00',2],['14:00-22:30',2],['15:15-23:55',3]];
const WKC=[['06:20-13:45',2],['06:20-14:20',2],['08:00-16:30',3],['11:00-19:30',2],['14:00-22:30',2],['15:15-23:55',3]];
const WKD=[['06:20-13:45',2],['06:20-14:20',2],['11:00-19:30',3],['13:30-22:00',2],['14:00-22:30',2],['15:15-23:55',3]];
// Q and R (12 Sep 2026): table B with the closer at 15:45 and ONE turn stretched to keep the contract — see table-late.mjs
const WKQ=[['06:20-13:45',2],['06:20-14:20',2],['08:00-17:00',3],['13:30-22:00',2],['14:00-22:30',2],['15:45-23:55',3]];
const WKR=[['06:20-13:45',2],['06:20-14:20',2],['08:00-16:30',3],['13:30-22:00',2],['14:00-23:15',2],['15:45-23:55',3]];
const TODAYWK=[['06:20-13:35',1],['06:20-13:45',1],['06:20-14:20',2],['08:00-16:30',2],['11:00-19:30',1],['13:30-22:00',1],['14:00-22:30',2],['15:15-23:55',2]];
const SAT1=[['06:20-14:00',1],['06:20-14:50',3],['08:00-16:30',2],['12:00-20:00',1],['14:30-22:00',2],['14:00-22:30',1],['14:45-23:55',4]];
const SAT2=[['06:20-14:00',1],['06:20-14:50',3],['12:00-20:00',1],['13:30-22:00',2],['14:30-22:00',2],['14:00-22:30',1],['14:45-23:55',4]];
const SAT3=[['06:20-14:00',1],['06:20-14:50',3],['08:00-16:30',2],['12:00-20:00',1],['13:30-21:00',2],['14:00-22:30',1],['14:45-23:55',4]];
const TODAYSAT=[['06:20-14:00',1],['06:20-14:50',3],['12:00-20:00',1],['13:30-21:00',1],['14:30-22:00',2],['14:45-23:55',2]];
const SUN1=[['07:15-15:45',4],['11:00-19:30',1],['13:00-21:00',2],['14:30-23:25',3]];
const SUN2=[['07:15-15:45',4],['11:00-19:30',2],['13:00-21:00',1],['14:30-23:25',3]];
const SUN3=[['07:15-15:45',4],['08:30-16:30',1],['11:00-19:30',1],['13:00-21:00',1],['14:30-23:25',3]];
const TODAYSUN=[['07:15-15:45',3],['08:30-16:30',1],['13:00-21:00',1],['14:30-23:25',3]];
for (const [n,d] of [['today wk',TODAYWK],['A',WKA],['B',WKB],['C',WKC],['D',WKD],['Q',WKQ],['R',WKR]]) console.log('weekday', n.padEnd(9), JSON.stringify(fit('weekday',d)));
for (const [n,d] of [['today sat',TODAYSAT],['S1',SAT1],['S2',SAT2],['S3',SAT3]]) console.log('sat    ', n.padEnd(9), JSON.stringify(fit('sat',d)));
for (const [n,d] of [['today sun',TODAYSUN],['U1',SUN1],['U2',SUN2],['U3',SUN3]]) console.log('sun    ', n.padEnd(9), JSON.stringify(fit('sun',d)));
