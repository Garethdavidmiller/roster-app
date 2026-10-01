// Kept for reference (links-24). Polished Clean variants, assessed with the sheets' own functions.
import fs from 'fs';
const TL = new URL('../../tooling/', import.meta.url).pathname;
const { assess, dutyMinutes, sheetRules, today, h55Worst } = await import(TL+'report-data.mjs');
const { personal } = await import(TL+'plain.mjs');
const { flexibleRules } = await import(TL+'report-data.mjs');
const base=JSON.parse(fs.readFileSync(TL+'../Polished-Clean-PC-24-EXT.json','utf8')); const P0=base.patterns??base;
const D=['mon','tue','wed','thu','fri','sat','sun']; const t=s=>/^\d\d:\d\d-\d\d:\d\d$/.test(s);
const T=today(), TA=assess(T.patterns,20);
export function report(name,p){
  let dx=0,mins=0; for(const r of Object.values(p)) for(const d of D){const s=r[d]; if(t(s)&&d!=='sun'){dx++;mins+=dutyMinutes(s);}}
  const A=assess(p,24), pp=personal(p), R=sheetRules({patterns:p,...A},TA,'plan'), F=flexibleRules({patterns:p,...A},TA,'plan');
  const h=h55Worst(p,24);
  console.log(`== ${name}: Mon–Sat duties ${dx}, minutes ${mins} (${mins-42000>=0?'+':''}${mins-42000}), avg ${Math.floor(mins/dx/60)}h${String(Math.round(mins/dx%60)).padStart(2,'0')}, days/yr ${pp.daysYear.toFixed(1)}`);
  console.log(`   rules ${R.met}/9: ${R.rows.filter(r=>!r.ok).map(r=>r.key+' '+r.value).join(' | ')}`);
  console.log(`   flexible: ${F.rows.map(r=>(r.ok?'✓':'✕')+r.key+' '+r.value).join(' | ')}`);
  console.log(`   rest ${A.rest?.minutes} turnarounds ${A.checks.turnarounds.length} run fixed ${A.fixed.run}/worst ${A.checks.longestStretch} · FF fixed ${A.fixed.present}/worst ${A.fatigue.present+(h?.adds?1:0)} · weekends ${A.checks.weekendsOff} · six-day ${A.feel.daysHist['6']??0} · single rest ${A.feel.isolatedRest} · times ${A.feel.distinctTimes} · late23 ${pp.late23.toFixed(1)} · fit ${A.wkFit.toFixed(1)}/${A.fits.sat.toFixed(1)}/${A.fits.sun.toFixed(1)} · avg ${Math.round(pp.avgShift)}m`);
  return A;
}
export { P0, D, t, dutyMinutes };
