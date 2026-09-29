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
import { waivedPhrase } from './fresh.mjs';

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
  const closers = { wk: [], sat: [], sun: [] }, early = [], late = [];
  for (const r of rows) for (const d of DAYS) {
    const s = r[d]; if (!timed(s)) continue;
    const len = dutyMinutes(s), end = endAbs(s); longest = Math.max(longest, len);
    if (d !== 'sun') { monSat++; monSatMins += len; }
    if (end >= 23 * 60) late23++;
    if (d === 'sat') sat++; if (d === 'sun') sun++;
    if (startMinutes(s) === 380) open++;
    if (d === 'sun' ? end === 1405 : end === 1435) closers[d === 'sun' ? 'sun' : d === 'sat' ? 'sat' : 'wk'].push(len);
    (startMinutes(s) < 660 ? early : late).push(len);
  }
  const perYear = x => x * 52 / L, avg = a => a.length ? a.reduce((p, q) => p + q, 0) / a.length : null;
  const span = a => !a.length ? '—' : Math.min(...a) === Math.max(...a) ? hm(a[0]) : `${hm(Math.min(...a))}–${hm(Math.max(...a))}`;
  const daysWeek = (monSat + 4 * cover) / L;
  return { L, cover, daysWeek, daysYear: daysWeek * 365 / 7, avgShift: monSatMins / monSat, longest,
    late23: perYear(late23), sat: perYear(sat), sun: perYear(sun), open0620: perYear(open),
    closer: { wk: avg(closers.wk), sat: avg(closers.sat), sun: avg(closers.sun) },
    // the range, for printing: an average of two different closing shifts is a shift nobody works
    closerSpan: { wk: span(closers.wk), sat: span(closers.sat), sun: span(closers.sun) }, closerAll: closers,
    earlySpan: span(early), lateSpan: span(late) };
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
function front({ T, P, meta, pages, coverHead }) {
  const name = esc(meta.identity.name), strap = esc(meta.identity.strap);
  const tp = personal(T.patterns), pp = personal(P.patterns);
  const rules = meta.designRules ?? [], missed = rules.filter(r => !r.ok);
  // A rule the owner waived for one design (WAIVERS in fresh.mjs — Clean Sweep keeps its 16:25 weekday closers) is
  // reported as waived, never as a failure — the sheet would otherwise say "No" about the one thing that was agreed.
  const waived = missed.filter(r => r.waived);
  const failed = missed.filter(r => !r.waived);
  const monSat = meta.monSat ?? 42000;
  const rests = P.checks.turnarounds.length, run = P.checks.longestStretch, restMin = P.rest?.minutes;
  const breaks = [rests ? `${rests} ${rests === 1 ? 'gap' : 'gaps'} of under 12 hours between shifts` : '',
    run > 13 ? `a run of ${run} days in a row (the limit is 13)` : '',
    monSat !== 42000 ? `${Math.abs(monSat - 42000).toLocaleString('en-GB')} minutes a week ${monSat > 42000 ? 'over' : 'under'} the 35-hour contract, across the whole link` : ''].filter(Boolean);
  const present = P.fatigue.results.filter(r => r.status === 'present');
  const presentPlain = [...new Set(present.map(r => plainFatigue(r.title)))];
  const [tw, ts, tsu] = [T.office.wkFit, T.office.fits.sat, T.office.fits.sun], [pw, ps, psu] = [P.office.wkFit, P.office.fits.sat, P.office.fits.sun];
  const closerDays = [['weekday', pw, tw], ['Saturday', ps, ts], ['Sunday', psu, tsu]].filter(([, p, t]) => p != null && t != null && p < t).map(([d]) => d);
  const fitDay = ([d, p, t]) => p == null || t == null ? null : p < t ? [d, 'closer'] : p > t ? [d, 'further'] : [d, 'the same'];
  const fitBits = [['weekdays', pw, tw], ['Saturday', ps, ts], ['Sunday', psu, tsu]].map(fitDay).filter(Boolean);
  const fitWords = fitBits.every(([, w]) => w === 'closer') ? 'On weekdays, Saturdays and Sundays, the number of staff on the floor rises and falls with the December trains more closely than today’s link'
    : fitBits.every(([, w]) => w === 'further') ? 'On every day the number of staff on the floor follows the December trains less closely than today’s link'
    : 'Against today’s link, the floor follows the December trains ' + andList(fitBits.map(([d, w]) => `${w === 'the same' ? 'about the same' : `${w}`} on ${d}`)).replace(/closer on/g, 'more closely on').replace(/further on/g, 'less closely on');
  const fitVerdict = closerDays.length === 3 ? ['Closer than today', 'good'] : closerDays.length === 0 ? ['Not as close as today', 'warn'] : [`Closer on ${closerDays.length} of 3 days`, 'mid'];
  const tWeekShare = T.checks.weekendsOff / tp.L, pWeekShare = P.checks.weekendsOff / pp.L;
  const shared = P.tableRows.filter(r => T.tableRows.some(t => t.time === r.time)).length, distinct = P.feel.distinctTimes, newTimes = distinct - shared;

  // What staff will notice — only what moved, better or worse, in the order staff weigh it (independent check,
  // 29 Sep 2026: a six-item cap silently dropped late finishes and days at work from one sheet's worry list; now the
  // list is ordered by importance and a longer one says how many more are on page 2, rather than losing them).
  const good = [], bad = [];
  const add = (cond, list, pri, text) => { if (cond) list.push([pri, text]); };
  const weekMoved = everyN(pWeekShare) !== everyN(tWeekShare);   // 5 in 24 against 4 in 20 is one in 5 both ways: no change to offer
  add(weekMoved && pWeekShare > tWeekShare, good, 10, `A full weekend off ${everyN(pWeekShare)} weeks (today ${everyN(tWeekShare)})`);
  add(weekMoved && pWeekShare < tWeekShare, bad, 10, `Fewer full weekends off: ${everyN(pWeekShare)} weeks (today ${everyN(tWeekShare)})`);
  for (const t of meta.thinMoments ?? []) { const m = /(\w+day) (\d\d:\d\d–\d\d:\d\d): only (one person|\d+ people)/.exec(t.replace(/<[^>]+>/g, '')); if (m) add(true, bad, 5, `Only ${m[3]} on duty in the whole station, ${m[1]} ${m[2]}`); }
  add(run < T.checks.longestStretch, good, 20, `Never more than ${run} days in a row (today ${T.checks.longestStretch})`);
  add(run > T.checks.longestStretch, bad, 20, `Up to ${run} days in a row (today ${T.checks.longestStretch})`);
  const dayDiff = Math.round(pp.daysYear) - Math.round(tp.daysYear);
  add(dayDiff <= -1, good, 25, `About ${-dayDiff} fewer ${dayDiff === -1 ? 'day' : 'days'} at work a year`);
  add(dayDiff >= 1, bad, 25, `About ${dayDiff} more ${dayDiff === 1 ? 'day' : 'days'} at work a year`);
  // figures from the ROUNDED values each side, so a phrase always agrees with the two numbers printed beside it
  const lateDiff = Math.round(pp.late23) - Math.round(tp.late23), openDiff = Math.round(pp.open0620) - Math.round(tp.open0620);
  add(lateDiff >= 2, bad, 30, `More late finishes — about one extra every ${weeksWords(52 / lateDiff)} weeks each`);
  add(lateDiff <= -2, good, 30, `Fewer late finishes — about one fewer every ${weeksWords(52 / -lateDiff)} weeks each`);
  // Closing shifts are judged SHIFT BY SHIFT (independent check, 29 Sep 2026): an average across a day's closers said
  // "every closing shift shorter" of a Saturday still carrying today's 9h10 closer beside two shorter ones.
  const cl = ['wk', 'sat', 'sun'].map(k => [k, pp.closerAll[k], tp.closerAll[k]]).filter(([, p, t]) => p.length && t.length);
  const mn = a => Math.min(...a), mx = a => Math.max(...a), r5 = x => Math.max(5, Math.round(x / 5) * 5);
  const shorter = cl.filter(([, p, t]) => mx(p) < mn(t) - 2), someShorter = cl.filter(([, p, t]) => !(mx(p) < mn(t) - 2) && mn(p) < mn(t) - 2);
  const longer = cl.filter(([, p, t]) => mn(p) > mx(t) + 2), someLonger = cl.filter(([, p, t]) => !(mn(p) > mx(t) + 2) && mx(p) > mx(t) + 2);
  const cname = { wk: 'weekday', sat: 'Saturday', sun: 'Sunday' };
  if (shorter.length === cl.length && cl.length) {
    const lo = r5(mn(cl.map(([, p, t]) => mn(t) - mx(p)))), hi = r5(mx(cl.map(([, p, t]) => mx(t) - mn(p))));
    add(true, good, 35, `Every closing shift shorter — by about ${lo === hi ? lo : `${lo} to ${hi}`} minutes`);
  } else {
    add(shorter.length > 0, good, 35, `Shorter ${andList(shorter.map(([k]) => cname[k]))} closing ${shorter.length === 1 ? 'shift' : 'shifts'}`);
    add(someShorter.length > 0, good, 36, `Some ${andList(someShorter.map(([k]) => cname[k]))} closing shifts shorter`);
  }
  add(longer.length > 0, bad, 35, `Longer ${andList(longer.map(([k]) => cname[k]))} closing ${longer.length === 1 ? 'shift' : 'shifts'}`);
  add(someLonger.length > 0, bad, 36, `Some ${andList(someLonger.map(([k]) => cname[k]))} closing shifts longer`);
  const avgDiff = pp.avgShift - tp.avgShift;
  add(avgDiff >= 3, bad, 40, `The average shift ${Math.round(avgDiff)} minutes longer`);
  add(avgDiff <= -3, good, 40, `The average shift ${Math.round(-avgDiff)} minutes shorter`);
  add(pp.longest < tp.longest, good, 41, `No shift longer than ${hm(pp.longest)} (today ${hm(tp.longest)})`);
  add(pp.longest > tp.longest, bad, 41, `Its longest shift is ${hm(pp.longest)} (today ${hm(tp.longest)})`);
  add(restMin != null && T.rest?.minutes != null && restMin > T.rest.minutes, good, 45, `Shortest rest between shifts ${hm(restMin)} (today ${hm(T.rest.minutes)})`);
  // the shape of the week (page 4): single rest days, six-day weeks, weeks on one shift time
  const iso = X => X.feel?.isolatedRest, six = X => X.feel?.daysHist?.['6'] ?? 0, one = X => X.feel?.oneTurn / X.feel?.workingLines;
  add(iso(P) != null && iso(P) > iso(T) + 2, bad, 22, `More single rest days, which are not a two-day break — ${iso(P)} (today ${iso(T)})`);
  add(iso(P) != null && iso(P) < iso(T) - 2, good, 22, `Fewer single rest days — ${iso(P)} (today ${iso(T)})`);
  add(six(P) > six(T), bad, 21, `More six-day weeks — ${six(P)} (today ${six(T)})`);
  add(one(P) < one(T) - 0.1, bad, 62, `Fewer weeks on one shift time — ${P.feel.oneTurn} of ${P.feel.workingLines} (today ${T.feel.oneTurn} of ${T.feel.workingLines})`);
  add(one(P) > one(T) + 0.1, good, 62, `More weeks on one shift time — ${P.feel.oneTurn} of ${P.feel.workingLines} (today ${T.feel.oneTurn} of ${T.feel.workingLines})`);
  // on duty at the open, 22:00 and the close: a day with fewer than today is named, even when other days gain
  const DN = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
  for (const [key, what] of [['open', 'at the open'], ['at22', 'at 22:00'], ['close', 'through to the close']]) {
    const fewer = Object.keys(DN).filter(d => P.heads[key]?.[d] < T.heads[key]?.[d]);
    add(fewer.length > 0, bad, 15, `Fewer on duty ${what} on ${andList(fewer.map(d => `${DN[d]} (${P.heads[key][d]}, today ${T.heads[key][d]})`))}`);
  }
  const ffP = P.fatigue.present, ffT = T.fatigue.present;
  add(ffP < ffT, good, 50, ffP ? `Fewer tiring patterns — ${ffP} (today ${ffT})` : `No avoidable tiring patterns (today ${ffT})`);
  add(ffP > ffT, bad, 50, `More tiring patterns — ${ffP} (today ${ffT})`);
  const tFF = r => T.fatigue.results.find(x => x.code === r.code && x.title === r.title);
  const newFFPlain = [...new Set(present.filter(r => tFF(r)?.status !== 'present').map(r => plainFatigue(r.title)))];
  add(newFFPlain.length > 0, bad, 51, `${newFFPlain.length === 1 ? 'A tiring pattern' : `${newFFPlain.length === 2 ? 'Two' : newFFPlain.length} tiring patterns`} today’s link does not have: ${andList(newFFPlain)}`);
  // a pattern in both links that is BIGGER here — "fewer tiring patterns" must not hide it
  const numOf = v => { const n = parseFloat(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) ? n : null; };
  const grown = present.filter(r => tFF(r)?.status === 'present' && numOf(r.value) != null && numOf(tFF(r).value) != null && numOf(r.value) > numOf(tFF(r).value));
  add(grown.length > 0, bad, 52, `Worse than today on ${andList(grown.slice(0, 2).map(r => `${plainFatigue(r.title)} (${r.value}, today ${tFF(r).value})`))}`);
  // the week-to-week move in start times (FF18), which a reader otherwise meets only on page 7
  const stepMin = X => { const v = X.fatigue.results.find(r => r.code === 'FF18')?.value; const t = /typically\s*(\d+)h\s*(\d+)m/.exec(String(v ?? '')); return t ? +t[1] * 60 + +t[2] : null; };
  const smT = stepMin(T), smP = stepMin(P);
  add(smT != null && smP != null && smP >= smT + 5, bad, 55, `Start times move further from week to week — ${hm(smP)} (today ${hm(smT)})`);
  add(smT != null && smP != null && smP <= smT - 5, good, 55, `Start times move less from week to week — ${hm(smP)} (today ${hm(smT)})`);
  // following the trains, day by day — a weekday can be worse even when the weekday average is better
  const WD = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' };
  const worseWeekdays = Object.keys(WD).filter(d => P.office.days?.[d]?.fit != null && T.office.days?.[d]?.fit != null && P.office.days[d].fit > T.office.days[d].fit + 0.5).map(d => WD[d]);
  const worseDays = [...(pw > tw ? ['weekdays'] : worseWeekdays), ...(ps > ts ? ['Saturday'] : []), ...(psu > tsu ? ['Sunday'] : [])];
  add(worseDays.length > 0, bad, 60, `Staff follow the trains less closely than today on ${andList(worseDays)}`);
  add(shared * 2 >= distinct, good, 65, shared === distinct ? `All ${distinct} of its shift times are already worked today` : `${shared} of its ${distinct} shift times are already worked today`);
  add(newTimes > 0, bad, 65, `${newTimes} new shift ${newTimes === 1 ? 'time' : 'times'} to learn`);
  const CAP = 7, listOf = l => { const x = l.sort((a, b) => a[0] - b[0]).map(([, t]) => t); return x.length > CAP ? [...x.slice(0, CAP - 1), `…and ${x.length - CAP + 1} more — see page 2`] : x; };

  const verdict = (text, cls) => `<span class="pv pv-${cls}">${text}</span>`;
  const q = (question, v, proof) => `<div class="pq"><div class="pq-q">${question}</div><div class="pq-v">${v}</div><div class="pq-p">${proof}</div></div>`;
  const decide = [
    ...breaks.map(b => `<b>It cannot be run as it stands</b> — ${b}.`),
    ...failed.map(r => `<b>Rule not met:</b> ${esc(r.rule)} — here ${esc(String(r.value))}.`),
    ...waived.map(w => `<b>Waived for this design:</b> ${esc(w.rule)} — here ${esc(String(w.value))}.`),
    `<b>Which link is used.</b> This is a proposal; colleagues' views come first.`,
    `<b>Then who starts on which line.</b> The rota does not say who works which week.`,
  ];
  const foot = (k, title) => `<div class="foot"><span>Page ${k} of ${pages} — ${title}</span><span class="foot-id"><b>${name}</b> · ${esc(meta.identity.code)} · ${esc(meta.identity.fingerprint)} · Marylebone Roster — Links designer</span></div>`;

  // Page 1 keeps the technical sheet's document head — the masthead, the gold proposal band and the chip strip —
  // because that is what makes it read as a formal paper (owner, 29 Sep 2026: the bare question list "seems less
  // professional"). Beneath it the five answers are tiles in the same style, and every comparison is with today.
  const n1f = x => x == null ? '—' : Number(x).toFixed(1);
  const tile = (cls, qn, big, label, small) => `<div class="tile ptile ptile-${cls}"><span class="q">${qn}</span><b>${big}</b><span class="l">${label}</span><span class="s">${small}</span></div>`;
  const tiles = [
    tile(failed.length ? 'warn' : 'good', 'Does it meet the December staffing levels?', `${meta.decMet} of ${meta.decOf}`,
      waived.length ? `rules met — ${waived.length === 1 ? 'one' : waived.length === 2 ? 'two' : waived.length} waived for this design` : failed.length ? `rules met — ${failed.length} not met` : 'rules met',
      `today’s link meets ${meta.decToday} · each rule on page 6`),
    tile(breaks.length ? 'bad' : 'good', 'Can it be run within the limits?', breaks.length ? 'No' : 'Yes',
      breaks.length ? 'not as it stands' : 'inside every hard limit',
      `shortest gap ${hm(restMin)} (limit 12h) · most days in a row ${run} (limit 13) · ${monSat === 42000 ? '35-hour contract exact' : `${Math.abs(monSat - 42000).toLocaleString('en-GB')} min a week ${monSat > 42000 ? 'over' : 'under'} the contract, across the whole link`}`),
    tile(present.length ? 'warn' : 'good', 'Is it tiring?', `${present.length}`,
      `avoidable tiring ${present.length === 1 ? 'pattern' : 'patterns'}`,
      `${present.length && presentPlain.length <= 2 ? `${esc(andList(presentPlain))} · ` : ''}today’s link has ${T.fatigue.present} · cover weeks at their worst · page 7`),
    tile('info', 'What does it take?', `${pp.L} people`,
      pp.L - tp.L > 0 ? `${pp.L - tp.L} more than today’s ${tp.L}` : `as today’s ${tp.L}`,
      `${pp.cover} cover weeks for leave and sickness · ${P.daily.sun} on a Sunday as overtime (today ${T.daily.sun})`),
    tile(fitVerdict[1] === 'good' ? 'good' : 'warn', 'Are staff where the trains are?', fitVerdict[1] === 'good' ? 'Closer' : fitVerdict[1] === 'warn' ? 'Less close' : `${closerDays.length} of 3`,
      fitVerdict[1] === 'good' ? (worseWeekdays.length ? `than today overall — less close on ${andList(worseWeekdays)}` : 'than today on weekdays, Saturday and Sunday') : fitVerdict[1] === 'warn' ? 'than today on weekdays, Saturday and Sunday' : 'days closer than today',
      `weekdays ${n1f(pw)} (today ${n1f(tw)}) · Sat ${n1f(ps)} (${n1f(ts)}) · Sun ${n1f(psu)} (${n1f(tsu)}) · 0 is a perfect match · page 5`),
  ].join('');
  // the rules chip is re-derived here so a waived rule reads as waived, as it does in the tile beneath it
  const rulesChip = failed.length ? `<span class="sum-chip sum-chip--warn">⚠ <strong>${failed.length}</strong> of ${meta.decOf} December staffing rules not met</span>`
    : `<span class="sum-chip sum-chip--ok">✓ ${waived.length ? `<strong>${meta.decMet}</strong> of ${meta.decOf} December staffing rules met — ${waivedPhrase(waived.map(w => w.key))} for this design` : `all <strong>${meta.decOf}</strong> December staffing rules met`}</span>`;
  const head1 = coverHead.replace(/<span class="sum-chip sum-chip--(?:warn|ok)">(?:(?!<\/span>)[\s\S])*?December staffing rules(?:(?!<\/span>)[\s\S])*?<\/span>/, rulesChip);
  // what it is like to work — the three things colleagues ask first, each against today
  const feelTile = (big, label, small) => `<div class="tile"><b>${big}</b><span class="l">${label}</span><span class="s">${small}</span></div>`;
  const feel = [
    feelTile(`${P.checks.weekendsOff} in ${pp.L}`, 'full weekends off', `${everyN(pWeekShare)} weeks — today ${everyN(tWeekShare)} (${T.checks.weekendsOff} in ${tp.L})`),
    feelTile(`${Math.round(pp.late23)} a year`, 'finishes at 23:00 or later, each', `today ${Math.round(tp.late23)} · ${Math.abs(lateDiff) < 1 ? 'about the same' : `about one ${lateDiff > 0 ? 'extra' : 'fewer'} every ${weeksWords(52 / Math.abs(lateDiff))} weeks`}`),
    feelTile(`${Math.round(pp.open0620)} a year`, 'starts at 06:20, the open, each', `today ${Math.round(tp.open0620)} · ${Math.abs(openDiff) < 1 ? 'about the same' : `about one ${openDiff > 0 ? 'extra' : 'fewer'} every ${weeksWords(52 / Math.abs(openDiff))} weeks`}`),
  ].join('');
  const page1 = `<section class="page cover plain">
  ${head1}
  <p class="plead"><b>What this is.</b> ${name} is a proposal for the CEA link on the December 2026 timetable: a ${pp.L}-week rotation for ${pp.L} people, where today’s link has ${tp.L}. It is for discussion, not a decision — it has not yet been through the roster office or a union rep.</p>
  <div class="tiles head5">${tiles}</div>
  <div class="tiles pfeel">${feel}</div>
  <div class="pcols">
    <div class="pbox pbox-good"><h3>Likely positives for staff</h3>${good.length ? `<ul>${listOf(good).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">Nothing notably better than today.</p>'}</div>
    <div class="pbox pbox-warn"><h3>What colleagues may be concerned about</h3>${bad.length ? `<ul>${listOf(bad).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">Nothing notably worse than today.</p>'}</div>
  </div>
  <div class="pbox pbox-decide"><h3>Still to settle</h3><ul>${decide.map(x => `<li>${x}</li>`).join('')}</ul></div>
  ${foot(1, 'On one page')}
</section>`;

  // page 2 — against today's link, one row per question a manager asks, with a plain translation
  const cmp = (better, same) => same ? '' : better ? 'up' : 'down';
  const trio = (o, f = x => x) => ['wk', 'sat', 'sun'].map(k => o[k] == null ? '—' : f(o[k])).join(' · ');
  const wkRange = o => { const v = ['mon', 'tue', 'wed', 'thu', 'fri'].map(d => o[d]); const lo = Math.min(...v), hi = Math.max(...v); return lo === hi ? `${lo}` : `${lo}–${hi}`; };
  const headTrio = o => `${wkRange(o)} · ${o.sat} · ${o.sun}`;
  const row = (label, t, p, cls, words) => `<tr><td>${label}</td><td class="num">${t}</td><td class="num ${cls}"><b>${p}</b></td><td class="muted">${words}</td></tr>`;
  const sumD = o => Object.values(o).reduce((a, b) => a + b, 0);
  const ruleOf = key => rules.find(r => ({ open: /at the open/i, at22: /22:00/, close: /to the close/i })[key].test(r.rule));
  const ruleMet = key => { const r = ruleOf(key); return !r ? '' : r.ok ? 'met' : 'not met'; };
  // shading follows the legend — better or worse than TODAY; whether the rule is met is said in words beside it
  const headCls = key => { const ds = Object.keys(T.heads[key]); const up = ds.some(d => P.heads[key][d] > T.heads[key][d]), dn = ds.some(d => P.heads[key][d] < T.heads[key][d]); return up && dn ? '' : cmp(up, !up && !dn); };
  const gaps = P.feel.spareLines.map((l, i, a) => ((a[(i + 1) % a.length] - l + pp.L - 1) % pp.L) + 1);
  const coverWords = gaps.length && gaps.every(g => g === gaps[0]) ? `evenly spaced — one week in ${gaps[0]}` : `not evenly spaced (gaps of ${andList(gaps.map(String))} weeks)`;
  const stepOf = X => { const v = X.fatigue.results.find(r => r.code === 'FF18')?.value; const m = /typically ([^·]+?) a week/.exec(String(v ?? '')); const t = m && /(\d+)h\s*(\d+)m/.exec(m[1]); return t ? `${t[1]}h${t[2].padStart(2, '0')}` : null; };
  const stepT = stepOf(T), stepP = stepOf(P);
  const newSet = new Set(P.tableRows.filter(r => !T.tableRows.some(t => t.time === r.time)).map(r => r.time));
  const newLines = Object.values(P.patterns).filter(r => DAYS.some(d => newSet.has(r[d])));
  const rows2 = [
    row('People on the link', tp.L, pp.L, '', `${pp.L - tp.L} more people, one per line`),
    row('On duty each day — weekday · Saturday · Sunday', headTrio(T.daily), headTrio(P.daily), cmp(sumD(P.daily) > sumD(T.daily), sumD(P.daily) === sumD(T.daily)), 'the December levels ask for 14 on a Saturday and 10 on a Sunday'),
    row('On at the open — weekday · Sat · Sun', headTrio(T.heads.open), headTrio(P.heads.open), headCls('open'), `at least 4 every day — ${ruleMet('open')}`),
    row('Still on duty at 22:00 — weekday · Sat · Sun', headTrio(T.heads.at22), headTrio(P.heads.at22), headCls('at22'), `at least 5 every day — ${ruleMet('at22')}`),
    row('Through to the close — weekday · Sat · Sun', headTrio(T.heads.close), headTrio(P.heads.close), headCls('close'), `at least 3 every day — ${ruleMet('close')}`),
    row('How closely staff follow the trains — weekday · Sat · Sun', `${n1(tw)} · ${n1(ts)} · ${n1(tsu)}`, `${n1(pw)} · ${n1(ps)} · ${n1(psu)}`, closerDays.length === 3 ? 'up' : closerDays.length === 0 ? 'down' : '', 'lower is closer; 0 would be a perfect match — see page 5'),
    row('Cover weeks — for leave and sickness', `lines ${T.feel.spareLines.join(', ')}`, `lines ${P.feel.spareLines.join(', ')}`, '', coverWords),
    row('Most days worked in a row', T.checks.longestStretch, run, cmp(run < T.checks.longestStretch, run === T.checks.longestStretch), 'Chiltern’s limit is 13 (written source to confirm)'),
    row('Shortest gap between two shifts', hm(T.rest?.minutes), hm(restMin), cmp(restMin > T.rest?.minutes, restMin === T.rest?.minutes), 'the limit is 12 hours'),
    row('Full weekends off', `${T.checks.weekendsOff} in ${tp.L}`, `${P.checks.weekendsOff} in ${pp.L}`, cmp(pWeekShare > tWeekShare, everyN(pWeekShare) === everyN(tWeekShare)), `${everyN(pWeekShare)} weeks, against ${everyN(tWeekShare)} today`),
    row('Days at work a year, not counting Sundays', Math.round(tp.daysYear), Math.round(pp.daysYear), cmp(pp.daysYear < tp.daysYear, Math.round(pp.daysYear) === Math.round(tp.daysYear)), 'Sundays are overtime; a cover week counts as 4 days'),
    row('Average shift · longest shift', `${hm(tp.avgShift)} · ${hm(tp.longest)}`, `${hm(pp.avgShift)} · ${hm(pp.longest)}`, avgDiff <= -3 && pp.longest <= tp.longest ? 'up' : avgDiff >= 3 && pp.longest >= tp.longest ? 'down' : '', 'the average is Monday to Saturday; the longest is on any day'),
    row('Early shifts, shortest to longest', tp.earlySpan, pp.earlySpan, '', 'an early starts before 11:00 · any day of the week'),
    row('Late shifts, shortest to longest', tp.lateSpan, pp.lateSpan, '', 'a late starts at 11:00 or after · any day of the week'),
    row('Closing shift — weekday · Sat · Sun', ['wk', 'sat', 'sun'].map(k => tp.closerSpan[k]).join(' · '), ['wk', 'sat', 'sun'].map(k => pp.closerSpan[k]).join(' · '), (shorter.length + someShorter.length) && (longer.length + someLonger.length) ? '' : cmp(shorter.length + someShorter.length > 0, longer.length + someLonger.length === 0 && shorter.length + someShorter.length === 0), 'the shift that locks up'),
    ...(stepT && stepP ? [row('How far the start time moves from one week to the next — on average', stepT, stepP, smT != null && smP != null ? cmp(smP < smT, Math.abs(smP - smT) < 5) : '', 'smaller is easier on the body clock')] : []),
    row('Finishing at 23:00 or later — each, a year', Math.round(tp.late23), Math.round(pp.late23), cmp(pp.late23 < tp.late23, Math.abs(lateDiff) < 1), Math.abs(lateDiff) < 1 ? 'about the same as today' : `about one ${lateDiff > 0 ? 'extra' : 'fewer'} every ${weeksWords(52 / Math.abs(lateDiff))} weeks`),
    row('Starting at 06:20, the open — each, a year', Math.round(tp.open0620), Math.round(pp.open0620), '', Math.abs(openDiff) < 1 ? 'about the same as today' : `about one ${openDiff > 0 ? 'extra' : 'fewer'} every ${weeksWords(52 / Math.abs(openDiff))} weeks`),
    row('Saturdays worked — each, a year', Math.round(tp.sat), Math.round(pp.sat), '', 'a rostered Saturday is paid at time and a quarter; cover weeks not counted'),
    row('Sunday overtime to share — each, a year', Math.round(tp.sun), Math.round(pp.sun), '', 'Sundays are overtime, as today'),
    row('Ticket office on a Sunday evening', 1, 2, '', `the December rules ask for two, as on every other day; today one 14:30–23:25 closer keeps it until 22:30${(meta.pairDays ?? []).includes('sun') ? '' : ' — this rota does not mark them, so two are assumed from its duties'}`),
    row('Different shift times', T.feel.distinctTimes, `${distinct} (${shared} worked today)`, cmp(distinct < T.feel.distinctTimes, distinct === T.feel.distinctTimes), newTimes ? `${newTimes} new to learn, on ${newLines.length} of the ${P.feel.workingLines} working weeks — on page 4, the times with no figure under today’s link` : 'nothing new to learn'),
    row('Avoidable tiring patterns (ORR and rail-industry lists)', T.fatigue.present, P.fatigue.present, cmp(P.fatigue.present < T.fatigue.present, P.fatigue.present === T.fatigue.present), 'early starts and a weekly rotation come with every link'),
    row('December staffing rules met', `${meta.decToday} of ${meta.decOf}`, `${meta.decMet} of ${meta.decOf}`, cmp(meta.decMet > meta.decToday, meta.decMet === meta.decToday), `staffing levels confirmed verbally, 29 Sep 2026${waived.length ? `; ${waivedPhrase(waived.map(w => w.key))} for this design` : ''}`),
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
    ['Cover weeks', 'A cover week is marked on all seven days but works four of them, placed by the roster clerk. It counts as a full contracted week of hours and as four days at work. Where a figure depends on where those four fall, the worst case is shown. Cover-week shift times are not known in advance, so the yearly counts of early and late starts, Saturdays and Sundays, and the rest gaps between shifts, cover the fixed duties only; whatever is later given in a cover week must still be rostered within the normal limits.'],
    ['Sundays', 'Sunday is not in the contract: Sunday duties are overtime, as today. So “days at work” and the 35-hour week are Monday to Saturday. A Sunday off costs no annual leave.'],
    ['Each person, a year', 'Figures given “each, a year” are averages across the whole link: every week’s duties, times 52, divided by the number of people; these counts include Sunday overtime duties. “Days at work a year” is Monday to Saturday only: the days a week times 365 ÷ 7. Somebody’s own year depends on which week they start on.'],
    ['Following the trains', 'For each hour, the share of the day’s floor staff on duty is set against the share of the day’s train movements in the December 2026 timetable. Hour by hour, the difference between the two shares is squared — so a big mismatch counts far more than several small ones — and the squares are added up and multiplied by 10,000. 0 would be a perfect match; lower is closer. The staff share is worked out from the minutes each person spends on the floor, with the ticket office’s fixed posts taken out — finer than the whole-person counts on page 5, where a person counts in every hour they are on duty for any part of, so a handover inside an hour counts both people. It measures the shape of the day, not a staffing requirement or passenger numbers, and it compares shares, not headcounts: an extra person in a quiet hour makes the figure worse although nobody is worse off. The ticket office is left out, except for the help described under “The ticket office”.'],
    ['The ticket office', 'The December plan has two people on every ticket-office shift. They are not floor cover, except that one of each pair helps on the floor at the quiet ends: until 08:00 (09:00 on a Sunday) and from 19:30. On a Sunday evening that person splits the whole shift between the office and the floor, so the match counts them as half a person and the two-on-the-floor rule not at all. Today one person, not two, keeps the office on a Sunday evening.'],
    ['Rest, runs and weekends', 'The shortest gap is one gap — the tightest anywhere, Saturday into Sunday and the last week into the first included; a rota with many gaps just over 12 hours reads the same as one with none. The most days in a row counts every day with a duty, Sunday overtime included, and is the worst case, with a cover week’s four duties placed as badly as they can be. A full weekend off is a Saturday off followed by a Sunday off.'],
    ['Familiar shift times', 'How many of the shift times somebody already works today. A rough guide to how much there is to learn, not to what staff will accept.'],
    ['Fatigue', 'The Office of Rail and Road’s good-practice list of roster patterns that tend to tire people, with four rail-industry checks. It is guidance, not a pass or fail, and this is not a fatigue risk assessment. Two patterns — early starts at a 06:20 station, and a weekly rotation — come with every link, today’s included, so they are recorded on page 7 and not counted. In the ORR’s checks an early start is one from 05:00 up to 06:59; a “block” of earlies is two or more in a row; the start-time rows count how many times a start moves by more than two hours (a count, not hours); and the week-to-week move is the average change in a week’s mean start time, Sundays included and cover weeks left out.'],
    ['What is confirmed', 'The December 2026 staffing levels, a 24-person link and the Sunday cover were confirmed verbally on 29 September 2026. The written source of Chiltern’s 13-day limit is still to be confirmed.'],
    ['How firm each figure is', 'Firm: the rest gaps, the contract, the days in a row and the staffing counts — worked out from the rota and checked again by the app. Confirmed verbally: the December staffing levels. Advisory: the fatigue patterns — guidance, never a pass or fail. A guide: how closely staff follow the trains, and how familiar the shift times are.'],
    ['What no page can tell you', 'Whether staff accept the new shift times; where the roster clerk places a cover week’s four duties; how leave and sickness cover land; whether the pattern holds on Wembley event days, since it follows the train timetable rather than passenger numbers; and who starts on which week. Those are for the people who work it and the managers who roster it.'],
  ];
  return `<section class="page plain">
  <div class="mast"><div><div class="eyebrow">For anyone checking</div><h1>How the figures are worked out</h1><div class="sub">In plain words — what each figure means and what it does not.</div></div></div>
  <dl class="pmethod">${items.map(([h, t]) => `<div class="pmi"><dt>${h}</dt><dd>${t}</dd></div>`).join('')}</dl>
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
.cover.plain .plead { font-size: 10.5px; margin: 10px 0 4px; line-height: 1.45; }
.ptile { border-top: 4px solid var(--border-mid); } .ptile-good { border-top-color: var(--success-green); } .ptile-warn { border-top-color: var(--warning-amber); } .ptile-bad { border-top-color: var(--danger-red, #b3261e); } .ptile-info { border-top-color: var(--primary-blue); }
.ptile-good b { color: var(--success-green); } .ptile-warn b { color: color-mix(in srgb, var(--warning-amber) 70%, black); } .ptile-bad b { color: var(--danger-red, #b3261e); }
.cover.plain .head5 .tile .q { min-height: 30px; } .cover.plain .head5 .tile b { font-size: 21px; }
.tiles.pfeel { margin: 0 0 4px; } .pfeel .tile b { font-size: 18px; } .pfeel .tile .l { font-size: 9.5px; } .pfeel .tile .s { font-size: 8.8px; }
.cover.plain .pbox ul { font-size: 10.2px; line-height: 1.45; } .cover.plain .pbox h3 { font-size: 11.5px; }
.pcols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
.pbox { border-radius: var(--radius); padding: 9px 14px; background: var(--surface-sunken); border-left: 4px solid var(--primary-blue); }
.pbox h3 { margin: 0 0 4px; font-size: 12.5px; }
.pbox ul { margin: 0 0 0 16px; padding: 0; font-size: 11px; line-height: 1.5; }
.pbox-good { border-left-color: var(--success-green); } .pbox-good h3 { color: var(--success-green); }
.pbox-warn { border-left-color: var(--warning-amber); } .pbox-warn h3 { color: var(--warning-amber); }
.pbox-decide { margin-top: 12px; border-left-color: var(--accent-gold); } .pbox-decide h3 { color: var(--primary-blue); }
/* polish (owner, 29 Sep 2026: "aesthetic polish with screenshots throughout") */
table.pcmp tbody tr:nth-child(even) td { background-color: color-mix(in srgb, var(--surface-sunken) 60%, white); }
table.pcmp tbody tr:nth-child(even) td.up { background-color: color-mix(in srgb, var(--success-green) 14%, white); }
table.pcmp tbody tr:nth-child(even) td.down { background-color: color-mix(in srgb, var(--warning-amber) 18%, white); }
.gloss { display: block; column-count: 2; column-gap: 20px; } .gloss > div { break-inside: avoid; margin: 0 0 5px; }
tr.gone td { text-decoration: none; color: var(--text-light); font-style: italic; }
dl.pmethod { column-count: 2; column-gap: 22px; } dl.pmethod .pmi { break-inside: avoid; margin-bottom: 6px; } dl.pmethod dt { margin-top: 0; }
ul.p5key { margin: 6px 0 4px 16px; padding: 0; font-size: 9.6px; line-height: 1.4; } ul.p5key li { margin: 1px 0; } h2.p5gtk { font-size: 12px; margin: 10px 0 2px; } ul.p5notes { margin: 2px 0 6px 16px; padding: 0; font-size: 9.2px; line-height: 1.4; color: var(--text-mid); } ul.p5notes li { margin: 2px 0; } ul.p5notes b { color: var(--text-dark, #1a1a2e); }
/* PAGE 5, THE HOUR-BY-HOUR TABLES (owner, 29 Sep 2026: "needs a lot of aesthetic polish"). One grid for all three
   tables — a fixed label column and equal hour columns, so an hour sits in the same place down the whole page — with
   heatmap cells rather than ruled boxes, labels in sentence case, today's block on a grey bar and the proposal's on
   gold, and a gap before the trains. Every number is unchanged; only the drawing is. */
.p5 h2 { margin: 11px 0 3px; }
.p5legend { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 18px; margin: 8px 0 4px; font-size: 9px; line-height: 1.35; color: var(--text-mid); }
.p5legend b { color: var(--text-dark, #1a1a2e); }
.p5legend .sw { display: inline-block; width: 34px; height: 9px; border-radius: 2px; vertical-align: -1px; margin-right: 5px; }
.p5legend .sw-blue { background: linear-gradient(90deg, color-mix(in srgb, var(--cov-early) 14%, white), color-mix(in srgb, var(--cov-early) 92%, black)); }
.p5legend .sw-orange { background: linear-gradient(90deg, color-mix(in srgb, var(--cov-late) 12%, white), color-mix(in srgb, var(--cov-late) 78%, black)); }
table.p5t { table-layout: fixed; width: calc(100% + 4px); border-collapse: separate; border-spacing: 2px; margin: 0 -2px; }
table.p5t th, table.p5t td { border: 0 !important; }
table.p5t th.cov-heat-hour { background: none; font-size: 8px; font-weight: 700; color: var(--text-mid); padding: 0 0 1px; }
table.p5t th.cov-heat-hour:first-child { width: 28%; }
table.p5t th.cov-fit-h { width: 40px; text-transform: none; letter-spacing: 0; font-size: 8px; color: var(--primary-blue); }
table.p5t .cov-heat-day { background: none; text-transform: none; letter-spacing: 0; font-size: 9px !important; font-weight: 700; color: var(--text-dark, #1a1a2e); padding: 0 6px 0 7px; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-left: 3px solid var(--border-mid) !important; }
table.p5t .office-day, table.p5t .floor-day { font-weight: 500; color: var(--text-mid); padding-left: 15px; font-size: 8.4px !important; }
table.p5t th.prop-row, table.p5t tr:has(> th.prop-row) ~ tr > th.cov-heat-day:not(.dem-day) { border-left-color: var(--accent-gold) !important; }
table.p5t th.prop-row { color: var(--primary-blue); }
table.p5t th.dem-day { border-left-color: var(--cov-late) !important; }
table.p5t .cov-heat-cell { height: 15px !important; min-width: 0; font-size: 8.5px !important; border-radius: 2px; font-variant-numeric: tabular-nums; }
table.p5t tr:has(> .office-day) .cov-heat-cell, table.p5t tr:has(> .floor-day) .cov-heat-cell { height: 12px !important; font-size: 7.8px !important; font-weight: 600; }
table.p5t .cov-heat-cell.heat-b0 { background: color-mix(in srgb, var(--surface-sunken) 55%, white); }
table.p5t tr.p5gap td { height: 3px; padding: 0; background: none; }
table.p5t td.cov-fit { background: color-mix(in srgb, var(--primary-blue) 8%, white); border-radius: 2px; font-size: 9px; color: var(--primary-blue); }
table.p5t td.cov-fit:empty { background: none; }
/* a weekday table with a row per day (Cover at Seventeen has five) keeps the grid but tightens it to fit the page */
table.p5t.cov-heat--dense { border-spacing: 2px 1.5px; }
table.p5t.cov-heat--dense .cov-heat-cell { height: 13px !important; font-size: 8px !important; }
table.p5t.cov-heat--dense tr:has(> .office-day) .cov-heat-cell, table.p5t.cov-heat--dense tr:has(> .floor-day) .cov-heat-cell { height: 10.5px !important; font-size: 7.4px !important; }
table.p5t.cov-heat--dense .cov-heat-day { font-size: 8.4px !important; } table.p5t.cov-heat--dense .office-day, table.p5t.cov-heat--dense .floor-day { font-size: 7.8px !important; }
.p5 ul.p5notes { column-count: 2; column-gap: 20px; margin-left: 14px; font-size: 8.7px; line-height: 1.34; } .p5 ul.p5notes li { break-inside: avoid; margin: 0 0 3px; }
.p5 h2.p5gtk { margin: 6px 0 2px; font-size: 11px; } .p5 .p5legend { font-size: 8.6px; margin: 5px 0 1px; gap: 2px 18px; } .p5 h2 { margin: 7px 0 2px; }
.p5 .callout { margin-top: 6px; padding-top: 6px; padding-bottom: 6px; font-size: 9.2px; }
/* THE WHOLE SHEET IN PAGE 5'S LANGUAGE (owner, 29 Sep 2026: "the other pages … still lots of rough edges"). One card:
   a quiet sunken panel with ONE accent — a straight bar, square on its own side and rounded elsewhere, never the
   curved bracket a radius puts on a side border — and the accent's colour always means the same thing: green good,
   amber a concern, red a hard limit broken, navy plain information. Tables stripe like page 2's, ticks and crosses
   carry their meaning in colour, and loose notes sit in a card of their own. No figure or word changes. */
.cover.plain .head5 .tile, .cover.plain .pfeel .tile { border: 0 !important; border-radius: 8px; background: var(--surface-sunken); box-shadow: inset 0 3px 0 var(--bar, var(--border-mid)); padding: 8px 10px 6px; }
.cover.plain .ptile-good { --bar: var(--success-green); } .cover.plain .ptile-warn { --bar: var(--warning-amber); }
.cover.plain .ptile-bad { --bar: var(--danger-red, #b3261e); } .cover.plain .ptile-info { --bar: var(--primary-blue); }
.cover.plain .pfeel .tile { --bar: color-mix(in srgb, var(--primary-blue) 35%, white); }
.cover.plain .tiles.head5 { gap: 8px; } .cover.plain .tiles.pfeel { gap: 8px; margin-top: 6px; }
.pbox, .check-row, .callout { border-radius: 0 8px 8px 0 !important; }
.cover.plain .pcols { gap: 12px; align-items: stretch; }
.cover.plain .pbox { padding: 8px 14px; }
/* tables: page 2's stripe, one header style */
table.t.kept tbody tr:nth-child(even) td, table.t.changed tbody tr:nth-child(even) td, table.t.dutyt tbody tr:nth-child(even) td:not(.up):not(.down), table.t.rules tbody tr:nth-child(even):not(.rule-miss) td, table.ff tbody tr:nth-child(even):not(.ff-na-note) td { background-color: color-mix(in srgb, var(--surface-sunken) 60%, white); }
table.t th { border-bottom: 0 !important; } table.t thead tr:last-child th { box-shadow: inset 0 -1px 0 var(--border-mid); }
.stack table.t td { padding: 2.5px 6px; }
.stack table.t.kept { table-layout: fixed; } .stack table.t.kept th:nth-child(1) { width: 40%; } .stack table.t.kept th:nth-child(2) { width: 27%; } .stack table.t.kept th:nth-child(3) { width: 33%; }
.stack table.t td { white-space: normal !important; overflow-wrap: anywhere; } .stack table.t td.num { white-space: nowrap !important; overflow-wrap: normal; }
.stack table.t.changed { table-layout: fixed; } .stack table.t.changed th:nth-child(1) { width: 27%; } .stack table.t.changed th:nth-child(2) { width: 15%; } .stack table.t.changed th:nth-child(3) { width: 19%; } .stack table.t.changed th:nth-child(4) { width: 39%; }
/* the duty table's notes: a card beside the table, not text floating in the margin */
.cols.duty > div:last-child { background: var(--surface-sunken); border-radius: 8px; padding: 9px 11px; align-self: start; }
.cols.duty > div:last-child p { margin: 0 0 6px; } .cols.duty > div:last-child p:last-child { margin: 0; }
/* ticks and crosses */
.mk { display: inline-block; width: 1.05em; font-weight: 800; } .mk-ok { color: var(--success-green); } .mk-no { color: var(--danger-red, #b3261e); } .mk-wv { color: var(--text-mid); }
.check-row .check-icon { align-self: flex-start; margin-top: 1px; }
/* the fatigue table: a factor's name is read in one colour; the verdict columns carry the colour */
td.ff-title { color: var(--text-dark, #1a1a2e) !important; }
ul.p8list { margin: 8px 0 0 16px; padding: 0; font-size: 9.2px; line-height: 1.45; color: var(--text-dark, #1a1a2e); } ul.p8list li { margin: 3px 0; } tr.ff-na-note td { font-size: 9px; color: var(--text-mid); padding-top: 5px; border-bottom: 0; }
table.pcmp { font-size: 9.8px; margin-top: 8px; } table.pcmp td { padding: 2.6px 6px; line-height: 1.3; } table.pcmp td.num, table.pcmp th.num { text-align: center; } table.pcmp { table-layout: fixed; width: 100%; } table.pcmp th:nth-child(1) { width: 29%; } table.pcmp th:nth-child(2) { width: 16%; } table.pcmp th:nth-child(3) { width: 19%; } table.pcmp th:nth-child(4) { width: 36%; }
table.pcontents td { font-size: 10px; padding: 1.8px 6px; } table.pcontents td.num { width: 24px; font-weight: 800; color: var(--primary-blue); }
dl.pmethod { margin: 10px 0; } dl.pmethod dt { font-weight: 800; color: var(--primary-blue); font-size: 11.5px; margin-top: 7px; } dl.pmethod dd { margin: 2px 0 0; font-size: 10.2px; line-height: 1.42; max-width: 175mm; }
`;

/** Page 5, people on duty hour by hour (owner, 29 Sep 2026: "the table wording is a little confusing"). The tables and
 *  every number stay exactly as rendered; what changes is what the rows and the right-hand column SAY. Each group now
 *  reads "all on duty", then "of whom in the ticket office" and "of whom on the floor", so the split is stated rather
 *  than left to an indent. Only the floor rows carry a match figure — the one the page itself calls the fair comparison
 *  — instead of two figures a group with nothing saying which one counts. The notes become a short key above and a
 *  "good to know" list below. Throws if an anchor moves, so a change to render.mjs cannot leave half the old wording. */
function hourPage(s) {
  const must = (re, to, what) => { if (!re.test(s)) throw new Error(`hourPage: ${what} not found`); re.lastIndex = 0; s = s.replace(re, to); };
  must(/<div class="sub">Cover today and proposed against the measured December 2026 timetable \(arrivals and departures, weighted by train length\)\. /,
    '<div class="sub">Today’s link and the proposal, hour by hour, against the December 2026 timetable. ', 'the subtitle');
  must(/<p class="muted" style="margin:6px 0 2px">How to read it:[\s\S]*?<\/p>/, `<div class="p5legend">
    <span><i class="sw sw-blue"></i><b>People on duty</b> in that hour — darker blue is more. Anyone on for any part of the hour counts, so a handover counts both people.</span>
    <span><i class="sw sw-orange"></i><b>Trains</b> — carriages arriving and leaving in that hour; darker is busier. A guide from the timetable, not passenger numbers.</span>
    <span><b>Read down each column:</b> the most people should be under the darkest orange.</span>
    <span><b>Match</b>, on the right — how closely the floor follows the trains over the whole day. 0 is a perfect match; lower is better.</span></div>`, 'the how-to-read paragraph');
  must(/<section class="page">/, '<section class="page p5">', 'the page section');
  must(/<table class="cov-heat/g, '<table class="p5t cov-heat', 'the hour tables');
  // row labels: the group, then what it splits into
  must(/<th class="cov-heat-day ">(Today|Proposed)(?: ([^<]+))?<\/th>/g, (m, who, days) => `<th class="cov-heat-day ${who === 'Proposed' ? 'prop-row' : ''}">${who}${days ? `, ${days}` : ''} — all on duty</th>`, 'the Today/Proposed rows');
  must(/(<th class="cov-heat-day office-day">(?:&nbsp;)+)in the ticket office/g, '$1of whom in the ticket office', 'the ticket-office rows');
  must(/(<th class="cov-heat-day floor-day">(?:&nbsp;)+)on the floor/g, '$1of whom on the floor', 'the floor rows');
  must(/(<th class="cov-heat-day dem-day">)Train carriages, Dec 2026/g, '$1Trains — carriages in and out', 'the trains row');
  // one match figure per group: the floor row's; the all-on-duty rows' figures go
  must(/(<th class="cov-heat-day (?:prop-row)?">[^<]*<\/th>(?:<td[^>]*>[^<]*<\/td>)*?)<td class="cov-fit">[^<]*<\/td><\/tr>/g, '$1<td class="cov-fit"></td></tr>', 'the all-on-duty fit cells');
  must(/<th class="cov-heat-hour cov-fit-h">fit<\/th>/g, '<th class="cov-heat-hour cov-fit-h">Match</th>', 'the fit header');
  // a small gap before the proposal's block and before the trains, instead of a rule
  // (once per table: a weekday table with a row per day has several "Proposed" rows, and only the first opens a group)
  if (!/<th class="cov-heat-day prop-row">/.test(s)) throw new Error('hourPage: the group gaps not found');
  s = s.split('<table class="p5t').map((t, i) => i === 0 ? t : t.replace(/<tr>(?=<th class="cov-heat-day prop-row">)/, '<tr class="p5gap"><td colspan="21"></td></tr><tr>').replace(/<tr>(?=<th class="cov-heat-day dem-day">)/, '<tr class="p5gap"><td colspan="21"></td></tr><tr>')).join('<table class="p5t');
  // the notes beneath: one short list
  const office = /<p class="muted" style="margin-top:8px"><b>Ticket office\.<\/b> ([\s\S]*?)<\/p>/.exec(s);
  const rest = /<p class="muted" style="margin-top:6px">([\s\S]*?)<\/p>/.exec(s);
  if (!office || !rest) throw new Error('hourPage: the notes beneath the tables not found');
  const officeText = office[1].replace(/ The indented rows take the office out of each side, less its quiet-end help, so the floor rows compare like with like\./, ' The “of whom” rows split it out of each side, so the floor rows compare like with like.');
  const m = /^(Cover weeks[^.]*\.)\s*<b>Fit<\/b> is one number for how closely the people on duty follow the trains through the day: 0 would be a perfect match, lower is better\.\s*([^.]*not an average of the scores shown\.)\s*([\s\S]*)$/.exec(rest[1].trim());
  if (!m) throw new Error('hourPage: the cover-weeks / fit note has changed');
  const varies = /cov-heat--dense/.test(s);
  // THE TICKET OFFICE, IN PLAIN WORDS (owner, 29 Sep 2026: the helper rule and the Sunday late were "not explained").
  // The table moves a whole helper from the office row to the floor row (report-data officeHelpers), which reads as an
  // understaffed office unless it is said; the Sunday evening half-person stays in the office row. The design's own
  // sentence — whether it rosters the pairs or they are assumed — is kept from the technical note.
  const tail = (/where the plan has two and two\.([\s\S]*)$/.exec(officeText)?.[1] ?? '').replace(/ The “of whom” rows split it out of each side, so the floor rows compare like with like\./, '').trim();
  if (!/where the plan has two and two\./.test(officeText)) throw new Error('hourPage: the ticket-office note has changed');
  const items = [
    `<b>The ticket office.</b> The December plan puts two people on every ticket-office shift, and they are not floor cover — except at the quiet ends of the day, when one of each pair helps on the floor: in the morning from the open until 08:00 (09:00 on a Sunday), and in the evening from 19:30 until their office shift ends. That is why the “of whom in the ticket office” row drops to 1 in those hours and the floor row gains one. Where it shows 4 (3 on today’s Sunday), the early and late pairs are both there at the changeover.${tail ? ' ' + tail : ''} The “of whom” rows split the office out of each side, so the floor rows compare like with like.`,
    `<b>Sunday evening is the one change from today.</b> Today one person keeps the ticket office on a Sunday evening — one of the three 14:30–23:25 closers, in the office until it shuts at 22:30 and then on the floor. The December rules ask for two, as on every other day, so the proposal’s office row reads 2 on a Sunday evening where today’s reads 1. The second of them splits the whole shift between the office and the floor: the table keeps them in the office row, the match counts them as half a person on the floor, and “at least two on the floor at every moment” does not count them.`,
    `<b>Only the floor is matched to the trains.</b> The ticket office is staffed to its opening hours, not to the trains, so its rows carry no match figure. ${m[2]}`,
    `<b>Cover weeks.</b> ${m[1].replace(/^Cover weeks /, 'They ')}`,
    ...(m[3].trim() ? [`<b>Sunday’s last trains.</b> ${m[3].trim()}`] : []),
  ];
  s = s.replace(office[0], `<h2 class="p5gtk">Good to know</h2><ul class="p5notes">${items.map(x => `<li>${x}</li>`).join('')}</ul>`).replace(rest[0], '');
  // the callout's first point is now the "only the floor is matched" note; it keeps the one thing that note does not say
  s = s.replace(/<b>Reading it\.<\/b> The <b>floor<\/b> rows are the fair comparison\. The ticket office is staffed to its opening hours, not to the trains, so counting it in can make a day look better or worse than the floor really is\. The fit measures <b>shape, not numbers<\/b>/,
    '<b>Reading the match.</b> It measures <b>shape, not numbers</b>');
  // …and it joins the list, beside the note it belongs with, rather than sitting in a box of its own: on the sheets with a
  // weekday row per day (Tenth Sunday has seven) the box ran into the page footer (29 Sep 2026)
  const call = /<div class="callout"><b>Reading the match\.<\/b>([\s\S]*?)<\/div>/.exec(s);
  if (!call) throw new Error('hourPage: the reading-the-match callout not found');
  s = s.replace(call[0], '').replace(/(<li><b>Only the floor is matched to the trains\.<\/b>[\s\S]*?<\/li>)/, `$1<li><b>Reading the match.</b>${call[1]}</li>`);
  return s;
}

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
    s = s.replace(/<p class="muted p8note">([\s\S]*?)<\/p>/, (m, body) => `<ul class="p8list">${body.replace(/^Design-specific findings:/, 'Avoidable tiring patterns found:').split(/(?=<b>)/).map(x => x.trim()).filter(Boolean).map(x => `<li>${x}</li>`).join('')}</ul>`);
    s = s.replace(/>Weeks on one shift time</g, '>Weeks on one shift time — all earlies or all lates<');
    s = s.replace(/every design’s staffed day/g, 'any link’s staffed day').replace(/so every design has FF2/g, 'so any link has FF2');
    if (k === 6) s = hourPage(s);
    if (k === 5) s = s.replace(/struck through: not used/g, 'grey italics: a time the proposal drops');
    if (k === 4) s = s   // the rota page: the glossary term matches page 5, and the contract note counts weeks, not people
      .replace('<div><b>Fit</b> — how closely the number of people on duty follows the number of trains through the day; 0 is a perfect match, lower is better.</div>',
        '<div><b>Match</b> — how closely the number of people on the floor follows the number of trains through the day (page 5); 0 is a perfect match, lower is better.</div>')
      .replace('(20 people × 35 hours = 42,000 minutes)', '(35 hours for each of the 20 working weeks = 42,000 minutes)');
    return s;
  });
  const p1 = sections.find(x => pageOf(x) === 1) ?? '';
  const coverHead = (p1.match(/<div class="mast">[\s\S]*?(?=<p class="readhint">)/)?.[0] ?? '')
    .replace(/<div class="ident-row ident-minor"><span class="ident-k">Family<\/span><span class="ident-v">[^<]*<\/span><\/div>/, '')   // names another proposal
    .replace(/(<div class="ident-row ident-minor"><span class="ident-k">Created)/, `<div class="ident-row ident-minor"><span class="ident-k">Set against</span><span class="ident-v">today’s 20-week link</span></div>$1`)
    .replace(/design-specific fatigue findings?/g, m => m.endsWith('s') ? 'avoidable tiring patterns' : 'avoidable tiring pattern')
    .replace(/ with FF11 as rostered/g, ' as rostered')
    .replace(/current working rules/g, 'December staffing rules')
    .replace(/<span class="muted">\(page 7\)<\/span>/g, '<span class="muted">(page 6)</span>');   // the rules page is page 6 here
  if (!coverHead) throw new Error('plainEdition: no cover head on page 1 of the technical sheet');
  let out = head.replace('</style>', CSS + '</style>') + front({ ...ctx, pages, coverHead }) + appendix.join('') + methodPage({ ...ctx, pages }) + tail;
  // the rules table's ticks and crosses, in the colour they mean
  out = out.replace(/<table class="t rules">[\s\S]*?<\/table>/, t => t.replace(/<td( class="today-v")?>(✓|✕|○)/g, (m, c, k) => `<td${c ?? ''}><span class="mk mk-${k === '✓' ? 'ok' : k === '✕' ? 'no' : 'wv'}">${k}</span>`));
  return out;
}
