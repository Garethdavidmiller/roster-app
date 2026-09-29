// THE PLAIN EDITION (owner, 29 Sep 2026: "I can't overload Nathan, it needs to be easy to understand").
//
// Every proposal sheet is read by a manager deciding, not by someone checking the analysis. The managers' edition
// (fresh.mjs) put the answer first but still met the reader with the method before the rota: eight metric tiles,
// a whole page on how to read each number, a table of how far to trust each figure, a ranking against the other 27
// drafts (which a manager is not shown — owner, same day) and a paste block for the app.
//
// This module replaces those five pages with two written for that reader, and keeps the five that carry the
// analysis — the grid, the week and duty table, the hour-by-hour cover, the rules, the ORR table — unchanged as an
// appendix, renumbered. A final page says in plain words how every figure is worked out. Three rules hold it:
//
//   1. NOTHING IS TYPED. Every sentence is built from the same assessed figures the appendix prints, so the front
//      can never say one thing while page 6 says another, on any of the 28 designs — including the ones that fail.
//   2. TODAY'S LINK IS THE ONLY COMPARISON. No other proposal is named, counted or ranked anywhere in the sheet;
//      the one-page summary (summary-sheet.mjs) is where the drafts are set side by side, for the owner.
//   3. ANSWER, THEN PROOF. Each question is answered in a word or two, with one line of evidence beside it. The
//      codes, the fit arithmetic and the ORR wording stay in the appendix for whoever asks to see the workings.
//
// `TECH=1` renders the ten-page technical sheet instead (render.mjs), unchanged.
import { dutyMinutes, startMinutes, endMinutes } from './report-data.mjs';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hm = m => m == null ? '—' : `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, '0')}`;
const n1 = v => v == null ? '—' : Number(v).toFixed(1);
const timed = s => !!s && s !== 'RD' && s !== 'SPARE' && startMinutes(s) !== null;
const endAbs = s => { const a = startMinutes(s), b = endMinutes(s); return b > a ? b : b + 1440; };
// "every 2 or 3 weeks" rather than a spurious "every 3" when the true interval is 2.7
const weeksWords = x => { const f = Math.floor(x), frac = x - f; return frac >= 0.25 && frac <= 0.75 ? `${f} or ${f + 1}` : `${Math.max(1, Math.round(x))}`; };
const everyN = share => share <= 0 ? 'never' : `one in ${Math.round(1 / share)}`;

/** The per-person figures a colleague asks about, from the rota itself — the same arithmetic as the one-page summary
 *  and the Familiar Nine presentations. Averages over EVERY line, cover weeks included (they add no fixed duty);
 *  "days at work" counts Monday to Saturday with a cover week as four days, because Sunday is overtime. */
export function personal(patterns) {
  const rows = Object.keys(patterns).sort((a, b) => a - b).map(k => patterns[k]);
  const L = rows.length, cover = rows.filter(r => DAYS.every(d => r[d] === 'SPARE')).length;
  let monSat = 0, monSatMins = 0, late23 = 0, sat = 0, sun = 0, open = 0, longest = 0;
  const closers = { wk: [], sat: [], sun: [] };
  for (const r of rows) for (const d of DAYS) {
    const s = r[d]; if (!timed(s)) continue;
    const len = dutyMinutes(s), end = endAbs(s); longest = Math.max(longest, len);
    if (d !== 'sun') { monSat++; monSatMins += len; }
    if (end >= 23 * 60) late23++;
    if (d === 'sat') sat++; if (d === 'sun') sun++;
    if (startMinutes(s) === 380) open++;
    if (d === 'sun' ? end === 1405 : end === 1435) closers[d === 'sun' ? 'sun' : d === 'sat' ? 'sat' : 'wk'].push(len);
  }
  const perYear = x => x * 52 / L, avg = a => a.length ? a.reduce((p, q) => p + q, 0) / a.length : null;
  const daysWeek = (monSat + 4 * cover) / L;
  return { L, cover, daysWeek, daysYear: daysWeek * 365 / 7, avgShift: monSatMins / monSat, longest,
    late23: perYear(late23), sat: perYear(sat), sun: perYear(sun), open0620: perYear(open),
    closer: { wk: avg(closers.wk), sat: avg(closers.sat), sun: avg(closers.sun) } };
}

/** The ORR and industry factors in the words a manager uses. The appendix keeps the ORR's own wording. */
const PLAIN_FATIGUE = [
  [/rest after a block of early/i, 'too little rest after a run of early starts'],
  [/13 consecutive shifts without a 48h/i, 'too many shifts without a two-day break'],
  [/consecutive early shifts/i, 'long runs of early shifts'],
  [/successive start times varying/i, 'start times that jump by more than two hours'],
  [/less than 12h rest/i, 'less than 12 hours between two shifts'],
  [/55 hours/i, 'more than 55 hours in a week'],
  [/consecutive 8h shifts/i, 'long runs of 8-hour shifts'],
  [/consecutive day shifts/i, 'long runs of day shifts'],
  [/backward rotating/i, 'start times moving earlier through the week'],
  [/over 12h|over 10h|over 8h/i, 'very long shifts'],
];
const plainFatigue = t => (PLAIN_FATIGUE.find(([re]) => re.test(t))?.[1]) ?? t.charAt(0).toLowerCase() + t.slice(1);
const andList = a => a.length <= 1 ? (a[0] ?? '') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;

/** The two front pages. */
function front({ T, P, meta, pages }) {
  const name = esc(meta.identity.name), strap = esc(meta.identity.strap);
  const tp = personal(T.patterns), pp = personal(P.patterns);
  const rules = meta.designRules ?? [], failed = rules.filter(r => !r.ok);
  const monSat = meta.monSat ?? 42000;
  const rests = P.checks.turnarounds.length, run = P.checks.longestStretch, restMin = P.rest?.minutes;
  const breaks = [rests ? `${rests} ${rests === 1 ? 'gap' : 'gaps'} of under 12 hours between shifts` : '',
    run > 13 ? `a run of ${run} days in a row (the limit is 13)` : '',
    monSat !== 42000 ? `${Math.abs(monSat - 42000).toLocaleString('en-GB')} minutes a week ${monSat > 42000 ? 'over' : 'under'} the 35-hour contract, across the whole link` : ''].filter(Boolean);
  const present = P.fatigue.results.filter(r => r.status === 'present');
  const presentPlain = [...new Set(present.map(r => plainFatigue(r.title)))];
  const [tw, ts, tsu] = [T.office.wkFit, T.office.fits.sat, T.office.fits.sun], [pw, ps, psu] = [P.office.wkFit, P.office.fits.sat, P.office.fits.sun];
  const closerDays = [['weekday', pw, tw], ['Saturday', ps, ts], ['Sunday', psu, tsu]].filter(([, p, t]) => p != null && t != null && p < t).map(([d]) => d);
  const fitVerdict = closerDays.length === 3 ? ['Closer than today', 'good'] : closerDays.length === 0 ? ['Not as close as today', 'warn'] : [`Closer on ${closerDays.length} of 3 days`, 'mid'];
  const tWeekShare = T.checks.weekendsOff / tp.L, pWeekShare = P.checks.weekendsOff / pp.L;
  const shared = P.tableRows.filter(r => T.tableRows.some(t => t.time === r.time)).length, distinct = P.feel.distinctTimes, newTimes = distinct - shared;

  // what staff will notice — only what moved, better or worse, largest first
  const good = [], bad = [];
  const push = (cond, list, text) => { if (cond) list.push(text); };
  push(pWeekShare > tWeekShare, good, `A full weekend off ${everyN(pWeekShare)} weeks (today ${everyN(tWeekShare)})`);
  push(pWeekShare < tWeekShare, bad, `Fewer full weekends off: ${everyN(pWeekShare)} weeks (today ${everyN(tWeekShare)})`);
  push(run < T.checks.longestStretch, good, `Never more than ${run} days in a row (today ${T.checks.longestStretch})`);
  push(run > T.checks.longestStretch, bad, `Up to ${run} days in a row (today ${T.checks.longestStretch})`);
  const cl = ['wk', 'sat', 'sun'].map(k => [k, pp.closer[k], tp.closer[k]]).filter(([, p, t]) => p != null && t != null);
  const shorter = cl.filter(([, p, t]) => p < t - 2), longer = cl.filter(([, p, t]) => p > t + 2);
  const cname = { wk: 'weekday', sat: 'Saturday', sun: 'Sunday' };
  if (shorter.length === cl.length && cl.length) good.push(`Every closing shift shorter — by ${andList([...new Set(shorter.map(([, p, t]) => Math.round(t - p)))].sort((a, b) => a - b).map(m => `${m}`))} minutes`);
  else if (shorter.length) good.push(`Shorter ${andList(shorter.map(([k]) => cname[k]))} closing ${shorter.length === 1 ? 'shift' : 'shifts'}`);
  if (longer.length) bad.push(`Longer ${andList(longer.map(([k]) => cname[k]))} closing ${longer.length === 1 ? 'shift' : 'shifts'}`);
  push(shared * 2 >= distinct, good, `${shared} of its ${distinct} shift times are already worked today`);
  push(newTimes > 0, bad, `${newTimes} new shift ${newTimes === 1 ? 'time' : 'times'} to learn`);
  push(restMin != null && T.rest?.minutes != null && restMin > T.rest.minutes, good, `More rest between shifts — at least ${hm(restMin)} (today ${hm(T.rest.minutes)})`);
  const lateDiff = pp.late23 - tp.late23;
  push(lateDiff >= 2, bad, `More late finishes — about one extra every ${weeksWords(52 / lateDiff)} weeks each`);
  push(lateDiff <= -2, good, `Fewer late finishes — about one fewer every ${weeksWords(52 / -lateDiff)} weeks each`);
  const dayDiff = pp.daysYear - tp.daysYear;
  push(dayDiff <= -1, good, `About ${Math.round(-dayDiff)} fewer ${Math.round(-dayDiff) === 1 ? 'day' : 'days'} at work a year`);
  push(dayDiff >= 1, bad, `About ${Math.round(dayDiff)} more ${Math.round(dayDiff) === 1 ? 'day' : 'days'} at work a year`);
  const avgDiff = pp.avgShift - tp.avgShift;
  push(avgDiff >= 3, bad, `The average shift ${Math.round(avgDiff)} minutes longer`);
  push(avgDiff <= -3, good, `The average shift ${Math.round(-avgDiff)} minutes shorter`);
  push(pp.longest < tp.longest, good, `No shift longer than ${hm(pp.longest)} (today ${hm(tp.longest)})`);
  push(pp.longest > tp.longest, bad, `Its longest shift is ${hm(pp.longest)} (today ${hm(tp.longest)})`);

  const verdict = (text, cls) => `<span class="pv pv-${cls}">${text}</span>`;
  const q = (question, v, proof) => `<div class="pq"><div class="pq-q">${question}</div><div class="pq-v">${v}</div><div class="pq-p">${proof}</div></div>`;
  const decide = [
    ...breaks.map(b => `<b>It cannot be run as it stands</b> — ${b}.`),
    ...failed.map(r => `<b>Rule not met:</b> ${esc(r.rule)} — here ${esc(String(r.value))}.`),
    `<b>Which link is used.</b> This is a proposal; colleagues' views come first.`,
    `<b>Then who starts on which line.</b> The rota does not say who works which week.`,
  ];
  const foot = (k, title) => `<div class="foot"><span>Page ${k} of ${pages} — ${title}</span><span class="foot-id"><b>${name}</b> · ${esc(meta.identity.code)} · ${esc(meta.identity.fingerprint)} · Marylebone Roster — Links designer</span></div>`;

  const page1 = `<section class="page plain">
  <div class="mast"><div><div class="eyebrow">Proposed CEA link · December 2026</div><h1>${name}</h1><div class="sub">${strap}</div></div></div>
  <p class="plead">A proposal for discussion, not a decision. Every figure is worked out from the rota by the Marylebone Roster app and set against <b>today’s 20-week link</b>.</p>
  ${q('Does it meet the December staffing levels?', failed.length ? verdict(`No — ${meta.decMet} of ${meta.decOf}`, 'warn') : verdict(`Yes — all ${meta.decOf}`, 'good'),
      `${failed.length ? `${failed.length} not met, listed below. ` : ''}Today’s link meets ${meta.decToday}. The eleven rules are on page 6.`)}
  ${q('Can it be run within the limits?', breaks.length ? verdict('No', 'bad') : verdict('Yes', 'good'),
      breaks.length ? esc(andList(breaks)).replace(/^./, c => c.toUpperCase()) + '.' : `At least ${hm(restMin)} between any two shifts (the limit is 12h) · never more than ${run} days in a row (the limit is 13) · exactly the 35-hour contract.`)}
  ${q('Is it tiring?', present.length ? verdict(`${present.length} ${present.length === 1 ? 'pattern' : 'patterns'} to look at`, 'warn') : verdict('No avoidable tiring patterns', 'good'),
      `${present.length ? `${esc(andList(presentPlain)).replace(/^./, c => c.toUpperCase())}. ` : ''}Today’s link has ${T.fatigue.present}. Early starts and a weekly rotation come with every link, so are not counted. Detail on page 7.`)}
  ${q('What does it take?', verdict(`${pp.L} people`, 'info'),
      `${pp.L - tp.L > 0 ? `${pp.L - tp.L} more than today` : 'as today'} · a 35-hour week · ${pp.cover} cover weeks · ${P.daily.sun} on a Sunday as overtime (today ${T.daily.sun}).`)}
  ${q('Are staff where the trains are?', verdict(fitVerdict[0], fitVerdict[1]),
      `How closely floor staffing follows the December timetable, weekday · Saturday · Sunday: ${n1(pw)} · ${n1(ps)} · ${n1(psu)} (today ${n1(tw)} · ${n1(ts)} · ${n1(tsu)}). Lower is closer; 0 would be a perfect match. Hour by hour on page 5.`)}
  <div class="pcols">
    <div class="pbox pbox-good"><h3>Staff are likely to welcome</h3>${good.length ? `<ul>${good.slice(0, 6).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">Nothing notably better than today.</p>'}</div>
    <div class="pbox pbox-warn"><h3>Staff are likely to worry about</h3>${bad.length ? `<ul>${bad.slice(0, 6).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">Nothing notably worse than today.</p>'}</div>
  </div>
  <div class="pbox pbox-decide"><h3>${breaks.length || failed.length ? 'Still to settle' : 'Still to decide'}</h3><ul>${decide.map(x => `<li>${x}</li>`).join('')}</ul></div>
  ${foot(1, 'On one page')}
</section>`;

  // page 2 — against today's link, one row per question a manager asks, with a plain translation
  const cmp = (better, same) => same ? '' : better ? 'up' : 'down';
  const trio = (o, f = x => x) => ['wk', 'sat', 'sun'].map(k => o[k] == null ? '—' : f(o[k])).join(' · ');
  const wkRange = o => { const v = ['mon', 'tue', 'wed', 'thu', 'fri'].map(d => o[d]); const lo = Math.min(...v), hi = Math.max(...v); return lo === hi ? `${lo}` : `${lo}–${hi}`; };
  const headTrio = o => `${wkRange(o)} · ${o.sat} · ${o.sun}`;
  const row = (label, t, p, cls, words) => `<tr><td>${label}</td><td class="num">${t}</td><td class="num ${cls}"><b>${p}</b></td><td class="muted">${words}</td></tr>`;
  const sumD = o => Object.values(o).reduce((a, b) => a + b, 0);
  const rows2 = [
    row('People on the link', tp.L, pp.L, '', `${pp.L - tp.L} more people, one per line`),
    row('On duty each day — weekday · Saturday · Sunday', headTrio(T.daily), headTrio(P.daily), cmp(sumD(P.daily) > sumD(T.daily), sumD(P.daily) === sumD(T.daily)), 'the December levels ask for 14 on a Saturday and 10 on a Sunday'),
    row('On at the open — weekday · Sat · Sun', headTrio(T.heads.open), headTrio(P.heads.open), '', 'at least 4 every day'),
    row('Still on after 22:00 — weekday · Sat · Sun', headTrio(T.heads.at22), headTrio(P.heads.at22), '', 'at least 5 every day'),
    row('Through to the close — weekday · Sat · Sun', headTrio(T.heads.close), headTrio(P.heads.close), '', 'at least 3 every day'),
    row('Most days worked in a row', T.checks.longestStretch, run, cmp(run < T.checks.longestStretch, run === T.checks.longestStretch), 'Chiltern’s limit is 13 (written source to confirm)'),
    row('Shortest gap between two shifts', hm(T.rest?.minutes), hm(restMin), cmp(restMin > T.rest?.minutes, restMin === T.rest?.minutes), 'the limit is 12 hours'),
    row('Full weekends off', `${T.checks.weekendsOff} in ${tp.L}`, `${P.checks.weekendsOff} in ${pp.L}`, cmp(pWeekShare > tWeekShare, Math.abs(pWeekShare - tWeekShare) < 1e-9), `${everyN(pWeekShare)} weeks, against ${everyN(tWeekShare)} today`),
    row('Days at work a year, not counting Sundays', Math.round(tp.daysYear), Math.round(pp.daysYear), cmp(pp.daysYear < tp.daysYear, Math.round(pp.daysYear) === Math.round(tp.daysYear)), 'Sundays are overtime; a cover week counts as 4 days'),
    row('Average shift · longest shift', `${hm(tp.avgShift)} · ${hm(tp.longest)}`, `${hm(pp.avgShift)} · ${hm(pp.longest)}`, '', 'Monday to Saturday'),
    row('Closing shift — weekday · Sat · Sun', trio(tp.closer, hm), trio(pp.closer, hm), cmp(shorter.length > longer.length, shorter.length === longer.length), 'the shift that locks up'),
    row('Finishing at 23:00 or later — each, a year', Math.round(tp.late23), Math.round(pp.late23), cmp(pp.late23 < tp.late23, Math.abs(lateDiff) < 1), Math.abs(lateDiff) < 1 ? 'about the same as today' : `about one ${lateDiff > 0 ? 'extra' : 'fewer'} every ${weeksWords(52 / Math.abs(lateDiff))} weeks`),
    row('Saturdays worked — each, a year', Math.round(tp.sat), Math.round(pp.sat), '', 'a rostered Saturday is paid at time and a quarter'),
    row('Sunday overtime to share — each, a year', Math.round(tp.sun), Math.round(pp.sun), '', 'Sundays are overtime, as today'),
    row('Different shift times', T.feel.distinctTimes, `${distinct} (${shared} worked today)`, cmp(distinct < T.feel.distinctTimes, distinct === T.feel.distinctTimes), newTimes ? `${newTimes} new to learn — listed on page 4` : 'nothing new to learn'),
    row('Avoidable tiring patterns (ORR list)', T.fatigue.present, P.fatigue.present, cmp(P.fatigue.present < T.fatigue.present, P.fatigue.present === T.fatigue.present), 'early starts and a weekly rotation come with every link'),
    row('December staffing rules met', `${meta.decToday} of ${meta.decOf}`, `${meta.decMet} of ${meta.decOf}`, cmp(meta.decMet > meta.decToday, meta.decMet === meta.decToday), 'staffing levels confirmed verbally, 29 Sep 2026'),
  ].join('');
  const page2 = `<section class="page plain">
  <div class="mast"><div><div class="eyebrow">Against today’s link</div><h1>What changes, in numbers</h1><div class="sub">Today’s 20-week link beside ${name}. Green is better than today, amber is worse, unshaded is neither.</div></div></div>
  <table class="t pcmp"><thead><tr><th>Question</th><th class="num">Today</th><th class="num">${name}</th><th>In plain words</th></tr></thead><tbody>${rows2}</tbody></table>
  <h2>The rest of this sheet — the workings</h2>
  <table class="t pcontents"><tbody>
    <tr><td class="num">3</td><td><b>The rota</b> — all 24 weeks, day by day, with hours and days worked</td></tr>
    <tr><td class="num">4</td><td><b>A week, and every shift time</b> — beside the ones worked today</td></tr>
    <tr><td class="num">5</td><td><b>People on duty, hour by hour</b> — against the December trains</td></tr>
    <tr><td class="num">6</td><td><b>The limits and the eleven December rules</b> — each one, with today’s link beside it</td></tr>
    <tr><td class="num">7</td><td><b>The fatigue checks</b> — the Office of Rail and Road’s list, in full</td></tr>
    <tr><td class="num">8</td><td><b>How the figures are worked out</b></td></tr>
  </tbody></table>
  ${foot(2, 'Against today’s link')}
</section>`;
  return page1 + page2;
}

function methodPage({ meta, pages }) {
  const name = esc(meta.identity.name);
  const items = [
    ['Where the figures come from', 'Every figure is worked out from the rota itself — the 24 weeks on page 3 — by the Marylebone Roster app. None is typed in by hand, and the same calculation is run on today’s link.'],
    ['Cover weeks', 'A cover week is marked on all seven days but works four of them, placed by the roster clerk. It counts as a full contracted week of hours and as four days at work. Where a figure depends on where those four fall, the worst case is shown.'],
    ['Sundays', 'Sunday is not in the contract: Sunday duties are overtime, as today. So “days at work” and the 35-hour week are Monday to Saturday. A Sunday off costs no annual leave.'],
    ['Each person, a year', 'Figures given “each, a year” are averages across the whole link: every week’s duties, times 52, divided by the number of people. Somebody’s own year depends on which week they start on.'],
    ['Following the trains', 'For each hour, the share of the day’s floor staff on duty is set against the share of the day’s train movements in the December 2026 timetable. 0 would be a perfect match; lower is closer. It measures the shape of the day, not a staffing requirement or passenger numbers. The ticket office is left out, except its second person helping at the quiet ends.'],
    ['Fatigue', 'The Office of Rail and Road’s good-practice list of roster patterns that tend to tire people, with four rail-industry checks. It is guidance, not a pass or fail, and this is not a fatigue risk assessment. Two patterns — early starts at a 06:20 station, and a weekly rotation — come with every link, today’s included, so they are recorded on page 7 and not counted.'],
    ['What is confirmed', 'The December 2026 staffing levels, a 24-person link and the Sunday cover were confirmed verbally on 29 September 2026. The written source of Chiltern’s 13-day limit is still to be confirmed.'],
    ['What no page can tell you', 'Whether staff accept the new shift times, how leave and sickness cover land, and who starts on which week. Those are for the people who work it and the managers who roster it.'],
  ];
  return `<section class="page plain">
  <div class="mast"><div><div class="eyebrow">For anyone checking</div><h1>How the figures are worked out</h1><div class="sub">In plain words — what each figure means and what it does not.</div></div></div>
  <dl class="pmethod">${items.map(([h, t]) => `<dt>${h}</dt><dd>${t}</dd>`).join('')}</dl>
  <p class="muted">The rota is supplied beside this PDF as <span class="tt">${esc(meta.identity.name.replace(/ /g, '-'))}-${esc(meta.identity.code)}-import.txt</span>, ready to paste into the Links page (Import), which re-runs every check here from the pasted weeks. The code <b>${esc(meta.identity.fingerprint)}</b> in every footer is worked out from the 168 days of the rota and nothing else, so a printout always matches the design it came from.</p>
  <div class="foot"><span>Page ${pages} of ${pages} — How the figures are worked out</span><span class="foot-id"><b>${name}</b> · ${esc(meta.identity.code)} · ${esc(meta.identity.fingerprint)} · Marylebone Roster — Links designer</span></div>
</section>`;
}

const CSS = `
.plain .plead { font-size: 11.5px; margin: 10px 0 8px; }
.pq { display: grid; grid-template-columns: 31% 30% 1fr; gap: 10px; align-items: center; border-bottom: 1px solid var(--border-light); padding: 7px 2px; }
.pq-q { font-weight: 700; font-size: 12px; color: var(--primary-blue); }
.pq-p { font-size: 10.5px; color: var(--text-mid); }
.pv { display: inline-block; font-weight: 800; font-size: 12px; padding: 3px 10px; border-radius: 12px; }
.pv-good { background: color-mix(in srgb, var(--success-green) 14%, white); color: var(--success-green); }
.pv-warn, .pv-mid { background: color-mix(in srgb, var(--warning-amber) 16%, white); color: var(--warning-amber); }
.pv-bad { background: color-mix(in srgb, var(--danger-red, #b3261e) 14%, white); color: var(--danger-red, #b3261e); }
.pv-info { background: var(--surface-sunken); color: var(--primary-blue); }
.pcols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
.pbox { border-radius: var(--radius); padding: 9px 14px; background: var(--surface-sunken); border-left: 4px solid var(--primary-blue); }
.pbox h3 { margin: 0 0 4px; font-size: 12.5px; }
.pbox ul { margin: 0 0 0 16px; padding: 0; font-size: 11px; line-height: 1.5; }
.pbox-good { border-left-color: var(--success-green); } .pbox-good h3 { color: var(--success-green); }
.pbox-warn { border-left-color: var(--warning-amber); } .pbox-warn h3 { color: var(--warning-amber); }
.pbox-decide { margin-top: 12px; border-left-color: var(--accent-gold); } .pbox-decide h3 { color: var(--primary-blue); }
table.pcmp { font-size: 10.5px; margin-top: 12px; } table.pcmp td { padding: 4.5px 6px; } table.pcmp td.num, table.pcmp th.num { text-align: center; white-space: nowrap; }
table.pcontents td { font-size: 11px; padding: 4px 6px; } table.pcontents td.num { width: 24px; font-weight: 800; color: var(--primary-blue); }
dl.pmethod { margin: 12px 0; } dl.pmethod dt { font-weight: 800; color: var(--primary-blue); font-size: 12px; margin-top: 10px; } dl.pmethod dd { margin: 2px 0 0; font-size: 11px; line-height: 1.5; max-width: 170mm; }
`;

/** Turns the ten-page technical sheet into the plain edition: two new front pages, the five analysis pages kept
 *  as the appendix (renumbered, their cross-references and one comparison sentence rewritten), a method page. */
export function plainEdition(html, ctx) {
  const parts = html.split(/(?=<section class="page)/);
  const head = parts[0], sections = parts.slice(1);
  const lastClose = sections[sections.length - 1].lastIndexOf('</section>');
  const tail = sections[sections.length - 1].slice(lastClose + '</section>'.length);
  sections[sections.length - 1] = sections[sections.length - 1].slice(0, lastClose + '</section>'.length);
  const pageOf = s => +(s.match(/Page (\d+) of 10/)?.[1] ?? 0);
  const keep = [4, 5, 6, 7, 8], NEW = { 1: 1, 2: 8, 3: 8, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7 };
  const titles = { 4: 'The rota', 5: 'A week, and every shift time', 6: 'People on duty, hour by hour', 7: 'The limits and the December rules', 8: 'The fatigue checks' };
  const pages = 8;
  const appendix = keep.map(k => {
    let s = sections.find(x => pageOf(x) === k); if (!s) throw new Error(`plainEdition: no page ${k} in the technical sheet`);
    s = s.replace(/Page (\d+) of 10 — [^<]*/, `Page ${NEW[k]} of ${pages} — Workings · ${titles[k]}`);
    s = s.replace(/Fatigue Factors, page 3/g, 'Fatigue Factors, p@@3');                       // the ORR's own page, not ours
    s = s.replace(/\b([Pp])age (\d+)\b(?! of)/g, (m, P1, d) => NEW[+d] ? `${P1}age ${NEW[+d]}` : m);
    s = s.replace(/p@@3/g, 'page 3');
    s = s.replace(/ — the same rules every proposal is measured against, with today’s link beside them/g, ' — with today’s link beside them');
    s = s.replace(/>Weeks on one shift time</g, '>Weeks on one shift time Mon–Fri<');
    s = s.replace(/every design’s staffed day/g, 'any link’s staffed day').replace(/so every design has FF2/g, 'so any link has FF2');
    return s;
  });
  const out = head.replace('</style>', CSS + '</style>') + front({ ...ctx, pages }) + appendix.join('') + methodPage({ ...ctx, pages }) + tail;
  return out;
}
