// THE MANAGERS' EDITION (owner, 28 Sep 2026): "the managers have not seen any links proposals at all yet … they
// are fresh eyes and really looking for the best roster to improve on today's links and meet the new level of
// demand." Every sheet was written for a reader who had followed the work — each one named its parent, the brief
// it answered, the rule set of its day and the sheets beside it. A manager meeting all 23 at once needs none of
// that. So in this edition every sheet answers ONE question — is this better than today's link, and does it meet
// the December 2026 rules? — against ONE rule set (currentRules in report-data.mjs), in words built from its own
// figures. Nothing here changes a figure; it replaces the words around them. `LEGACY=1` renders the old edition.
//
// The one-line descriptions are the only typed words about a design, and each says what the design IS, never
// what it was derived from.
import { currentRules } from './report-data.mjs';
import { dutyMinutes, startMinutes, endMinutesAbs } from '../../../links-design.js';

/** code → [one-line description, how it was made]. `search`: built by computer search against the rules and the
 *  timetable. `hand`: drawn by hand and checked by the app. `hand+search`: drawn by hand, weeks put in order by
 *  computer search for fewer fatigue factors. */
export const STRAPS = {
  'FR-24-F34':  ['The ticket office rostered in fixed pairs, every other duty timed so the floor follows the trains', 'search'],
  'PT-24-P34':  ['Today’s roster reworked: weekday closers at 15:45, the rest of each day timed to the December trains', 'search'],
  'P2-24-N13':  ['Apart from the 06:20 opening and the closing shifts, every shift starts and finishes on the quarter hour', 'search'],
  'QT-24-Q34':  ['Only today’s shift times, plus a new weekday closer at 15:45', 'search'],
  'Q2-24-W21':  ['Mostly today’s shift times, weekday closers at 15:45, and no duty longer than 8h 40m on any day', 'search'],
  'ST-24-B7':   ['Today’s link widened to 24 lines, in today’s own shift times', 'search'],
  'BB-24-D7':   ['Every shift time new, built from the December staffing levels, with longer earlies and shorter lates', 'search'],
  'EF-24-E21':  ['Built from the December staffing levels, with no duty longer than 8h 40m', 'search'],
  'B2-24-G21':  ['No duty longer than 8h 40m, with two matching late shifts every day', 'search'],
  'FT-24-EXT':  ['Fifteen shift times with the cover weeks evenly spread', 'hand'],
  'FT-24-R21':  ['Fifteen shift times, arranged to pass every hard limit', 'hand+search'],
  'WL-24-EXT':  ['Weekday closers from 16:25, with Saturday largely in today’s shift times', 'hand'],
  'WL2-24-R21': ['Weekday closers from 16:25, with extra cover under the 17:00 peak', 'hand+search'],
  'WL3-24-F7':  ['Weekday closers from 16:25, with five of its weeks fixed in place and the others ordered around them', 'hand+search'],
  'WL4-24-F7':  ['Weekday closers from 16:25, with lines 14–17 kept together in order', 'hand+search'],
  'WS-24-EXT':  ['A cover week at line 18 and a midday turn at 12:00–20:30', 'hand'],
  'TF-24-EXT':  ['A cover week at line 18, with Sunday and Monday duties placed to reduce fatigue', 'hand'],
  'TM-24-EXT':  ['A cover week at line 18, with two Monday duties moved to other lines', 'hand'],
  'C17-24-EXT': ['The fourth cover week at line 17, so nobody works more than 13 shifts without a two-day break', 'hand'],
  'S4-24-EXT':  ['Saturdays on just four shift times, with more people on in the evening', 'hand'],
  'CF-24-EXT':  ['Weekday closers from 16:25, and no Saturday closing shift longer than 8h 40m', 'hand'],
  'CFT-24-M3':  ['Weekday closers from 16:25, with four at Sunday’s open and four through to its close', 'hand'],
  'TN-24-R7':   ['Ten on a Sunday, and nobody works more than six days in a row', 'hand+search'],
};
/** The family a design belongs to (the designs that share a starting point) and the date its sheet was first
 *  made — header metadata for whoever presents the set, set in small type so it never competes with the design. */
export const FAMILY = { ST: 'Same Turns', QT: 'Same Turns', Q2: 'Same Turns', BB: 'By the Book', EF: 'By the Book', B2: 'By the Book',
  PT: 'Pinned Turns', P2: 'Pinned Turns', FR: 'Right Away', FT: 'Fifteen Turns',
  WL: 'Weekday Lates', WL2: 'Weekday Lates', WL3: 'Weekday Lates', WL4: 'Weekday Lates', WS: 'Weekday Lates', TF: 'Weekday Lates', TM: 'Weekday Lates',
  C17: 'Weekday Lates', S4: 'Weekday Lates', CF: 'Weekday Lates', CFT: 'Weekday Lates', TN: 'Weekday Lates' };
export const FIRST = { 'ST-24-B7': '8 Sep 2026', 'BB-24-D7': '8 Sep 2026', 'QT-24-Q34': '12 Sep 2026', 'EF-24-E21': '12 Sep 2026',
  'WL-24-EXT': '18 Sep 2026', 'WL2-24-R21': '18 Sep 2026', 'WL3-24-F7': '18 Sep 2026', 'FT-24-EXT': '18 Sep 2026', 'FT-24-R21': '18 Sep 2026', 'WS-24-EXT': '18 Sep 2026',
  'WL4-24-F7': '22 Sep 2026', 'TF-24-EXT': '22 Sep 2026', 'TM-24-EXT': '22 Sep 2026', 'C17-24-EXT': '22 Sep 2026', 'S4-24-EXT': '22 Sep 2026',
  'CF-24-EXT': '22 Sep 2026', 'CFT-24-M3': '22 Sep 2026', 'TN-24-R7': '22 Sep 2026', 'B2-24-G21': '22 Sep 2026',
  'Q2-24-W21': '24 Sep 2026', 'PT-24-P34': '25 Sep 2026', 'P2-24-N13': '25 Sep 2026', 'FR-24-F34': '28 Sep 2026' };
const MADE = {
  search: 'Built by computer search: the duty table was chosen for how closely it follows the December 2026 timetable, and the 24 weeks put in the order that raises the fewest fatigue factors.',
  hand: 'Drawn by hand and checked by the Links designer, which measured every figure in this sheet from the grid.',
  'hand+search': 'Drawn by hand, then the weeks put in order by computer search for the fewest fatigue factors; the duty times are as drawn.',
};
const MADE_SHORT = { search: 'computer search', hand: 'drawn by hand', 'hand+search': 'drawn by hand, ordered by search' };

/** The standalone words for one sheet. `folder` is folderStats() — every shipped design, with its rules. */
export function freshMeta({ T, P, meta, folder, rendered }) {
  const lc = t => /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)s?\b/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1);
  const code = meta.identity.code, name = meta.identity.name;
  const [strap] = STRAPS[code] ?? [meta.identity.strap];
  const TA = { patterns: T.patterns, ...T };
  const R = currentRules(P, TA), RT = currentRules(TA, TA);
  const n = x => x.toLocaleString('en-GB');
  const f1 = v => typeof v === 'number' ? v.toFixed(1) : v ?? '—';
  const hmR = m => m == null ? '—' : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  const andList = a => a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
  const plural = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const newTimes = P.tableRows.filter(r => !T.tableRows.some(t => t.time === r.time)).map(r => r.time);
  const shared = P.feel.distinctTimes - newTimes.length;
  const failed = R.rows.filter(r => !r.ok);
  const FO = P.office, TO = T.office;
  const gaps = P.adj.spareGaps ?? [];
  const keys = Object.keys(P.patterns);
  const WDD = ['mon', 'tue', 'wed', 'thu', 'fri'];
  // Minutes from the CELLS, day by day — the duty table's WK column is each time's busiest weekday, not one day, so
  // summing it gave a "weekday" that no day works (a review found 5 × 10,590 + 5,895 printed as 42,000).
  const dayMin = d => keys.reduce((a, k) => { const c = P.patterns[k][d]; return a + (c && c !== 'RD' && c !== 'SPARE' ? dutyMinutes(c) : 0); }, 0);
  const wkTot = WDD.reduce((a, d) => a + dayMin(d), 0), satMin = dayMin('sat'), sunMin = dayMin('sun'), monSat = wkTot + satMin;
  const contractWords = monSat === 42000 ? 'together exactly 20 people × 35 hours = 42,000 minutes, the contract' : `together ${n(monSat)} — ${n(Math.abs(monSat - 42000))} minutes ${monSat > 42000 ? 'over' : 'under'} the 42,000 of the contract`;
  const others = folder.filter(d => d.code !== code);
  const rank = [...folder].sort((a, b) => b.rules.met - a.rules.met || a.present - b.present || a.floor.wk - b.floor.wk);
  // lines holding a time nobody works today, and lines holding the longest duty — ALL of them (a review found a list
  // cut at five presented as complete)
  const linesWith = pred => keys.filter(k => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].some(d => pred(P.patterns[k][d]))).map(Number);
  const newLines = linesWith(c => newTimes.includes(c));
  const longest = Math.max(...P.tableRows.map(r => r.minutes));
  const longLines = linesWith(c => c && c !== 'RD' && c !== 'SPARE' && dutyMinutes(c) === longest);
  const ff11 = P.fatigue.results.find(r => r.code === 'FF11'), ff11Split = ff11?.value, ff11Block = P.asRostered?.ff11?.worst;
  const ff11Same = ff11Split == null || ff11Block == null || String(ff11Split) === String(ff11Block);
  // where the roster clerk puts a cover week's four duties can also move the MOST DAYS IN A ROW: the worst case is
  // reachable, but on some designs only from one placement (accuracy check, 28 Sep 2026 — four sheets said it "does
  // not depend on how a cover week is placed" when a better placement took 9 down to 6 or 7)
  const cd = P.asRostered?.consecDays, runSame = !cd || (cd.best === cd.worst && cd.worst === P.checks.longestStretch);
  const coverSame = ff11Same && runSame;
  const coverParts = [
    runSame ? '' : `the most days worked in a row: ${P.checks.longestStretch} at worst, ${cd.best} if the four are placed well`,
    ff11Same ? '' : `the longest stretch without a two-day break (FF11, page 8): ${ff11Block} if the four are worked together, ${ff11Split} if they are spread out`,
  ].filter(Boolean);
  // better / worse than today, marked in the At a glance table — every proposed figure used to be bold alike
  const mark = (p, t, lowerBetter = true) => p === t || p == null || t == null ? '' : ((lowerBetter ? p < t : p > t) ? ' better' : ' worse');
  const wdR = o => { const v = WDD.map(d => o[d]); const lo = Math.min(...v), hi = Math.max(...v); return lo === hi ? `${lo}` : `${lo}–${hi}`; };
  const row = (label, t, p, cls = '') => `<tr><td>${label}</td><td class="num">${t}</td><td class="num prop${cls}">${p}</td></tr>`;
  const glance = `<table class="t glance"><thead><tr><th>At a glance <span class="muted">— green is better than today, amber is worse</span></th><th class="num">Today’s link</th><th class="num">${name}</th></tr></thead><tbody>
    ${row('December 2026 rules met', `${RT.met} of ${R.of}`, `${R.met} of ${R.of}`, mark(R.met, RT.met, false))}
    ${row('People working each day — weekday · Saturday · Sunday', `${wdR(T.daily)} · ${T.daily.sat} · ${T.daily.sun}`, `${wdR(P.daily)} · ${P.daily.sat} · ${P.daily.sun}`)}
    ${row('How closely the floor follows the trains — weekday · Sat · Sun <span class="muted">(lower is closer)</span>', `${f1(TO.wkFit)} · ${f1(TO.fits.sat)} · ${f1(TO.fits.sun)}`, `${f1(FO.wkFit)} · ${f1(FO.fits.sat)} · ${f1(FO.fits.sun)}`, mark(FO.wkFit, TO.wkFit))}
    ${row('Fatigue factors present <span class="muted">(of 25 — page 8)</span>', T.fatigue.present, P.fatigue.present, mark(P.fatigue.present, T.fatigue.present))}
    ${row('Most days worked in a row <span class="muted">(limit 13)</span>', T.checks.longestStretch, P.checks.longestStretch, mark(P.checks.longestStretch, T.checks.longestStretch))}
    ${row('Shortest rest between two duties <span class="muted">(at least 12 hours)</span>', hmR(T.rest?.minutes), hmR(P.rest?.minutes), mark(P.rest?.minutes, T.rest?.minutes, false))}
    ${row('Full weekends off', `${T.checks.weekendsOff} in ${T.feel.workingLines + T.feel.spareLines.length}`, `${P.checks.weekendsOff} in 24`, mark(P.checks.weekendsOffPct, T.checks.weekendsOffPct, false))}
    ${row('Different shift times', `${T.feel.distinctTimes}`, `${P.feel.distinctTimes} — ${shared === P.feel.distinctTimes ? 'all' : shared === 0 ? 'none' : shared} already worked today`)}
  </tbody></table>`;
  const intro = `<p><b>${name}</b> is a proposal for the CEA link on the December 2026 timetable: a 24-line rotation for 24 people, where today’s link has 20. In short: ${lc(strap)}.</p>
  <p><b>Against today’s link</b> — the table below; page 2 explains each figure.</p>${glance}`;

  // hard limits first: a design that breaks one cannot be run, whatever else it does
  const restsN = P.checks.turnarounds.length, runN = P.checks.longestStretch;
  const hardBroken = [
    restsN ? `${plural(restsN, 'rest', 'rests')} under 12 hours${P.rest?.minutes < 720 ? ` (the shortest ${hmR(P.rest.minutes)}, line ${P.rest.from.line} into ${P.rest.to.line === P.rest.from.line ? 'the next day' : `line ${P.rest.to.line}`})` : ''}` : '',
    runN > 13 ? `a run of ${runN} days worked in a row` : '',
    monSat !== 42000 ? `${n(Math.abs(monSat - 42000))} minutes a week ${monSat > 42000 ? 'over' : 'under'} the contract, across the whole link` : '',
  ].filter(Boolean);
  const oqItems = [
    hardBroken.length ? `<b>${hardBroken.length === 1 ? 'A hard limit is' : 'Hard limits are'} broken</b> — ${andList(hardBroken)}. As it stands this rota cannot be run.` : '',
    failed.length ? `<b>${failed.length === 1 ? 'One December 2026 rule is' : `${failed.length} of the ${R.of} December 2026 rules are`} not met</b> — ${failed.map(r => r.rule).join('; ')}. The shaded rows above give the figures.` : `<b>Nothing to settle on the rules</b> — all ${R.of} are met.`,
    newTimes.length ? `<b>New shift times.</b> ${newTimes.length === 1 ? `1 of the ${P.feel.distinctTimes} is a time nobody works today` : `${newTimes.length} of the ${P.feel.distinctTimes} are times nobody works today`}; page 5 lists ${newTimes.length === 1 ? 'it' : 'them'}.` : '',
    // THE THIN MOMENT (accuracy check, 28 Sep 2026): the hour-by-hour page counts a head in every hour a duty
    // TOUCHES, so a half-hour when nearly nobody is on shows as a full hour. Saturday Four had one person on duty in
    // the whole station from 14:45 to 15:15 on a Saturday and no page said so. Checked every five minutes, whole
    // station, ticket office included; anything under three (the close's own minimum) is named.
    ...(() => { const out = []; const NM = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
      for (const d of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) { const [o, c] = d === 'sun' ? [435, 1405] : [380, 1435];
        const on = m => keys.filter(k => { const x = P.patterns[k][d]; const a = startMinutes(x), b = endMinutesAbs(x); return a !== null && b !== null && a <= m && m < b; }).length;
        let lo = Infinity, from = null, to = null;
        for (let m = o; m < c; m += 5) { const v = on(m); if (v < lo) { lo = v; from = m; to = m + 5; } else if (v === lo && to === m) to = m + 5; }
        const t = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        if (lo < 3) out.push(`<b>A thin moment.</b> ${NM[d]} ${t(from)}–${t(to)}: only ${lo === 1 ? 'one person' : `${lo} people`} on duty in the whole station, ticket office included. Page 6 counts by the hour, so it does not show this.`); }
      return out; })(),
    `<b>Sunday’s finish.</b> Five trains in the December 2026 timetable arrive or leave after the 23:25 Sunday finish; whether Sunday cover should run later is still to be decided.`,
  ].filter(Boolean);

  const tr = (d, here) => `<tr${here ? ' class="here"' : ''}><td class="nm">${d.name}</td><td class="num">${d.rules.met} of ${d.rules.of}</td><td class="num">${d.present}</td><td class="num">${d.run}</td><td class="num">${hmR(d.rest)}</td><td class="num">${d.weekends}</td><td class="num">${f1(d.floor.wk)}</td><td class="num">${f1(d.floor.sat)}</td><td class="num">${f1(d.floor.sun)}</td><td class="num">${d.distinct}</td><td class="num">${d.distinct - d.newTimes}</td></tr>`;
  const todayRow = `<tr class="today"><td class="nm"><i>Today’s 20-line link</i></td><td class="num">${RT.met} of ${RT.of}</td><td class="num">${T.fatigue.present}</td><td class="num">${T.checks.longestStretch}</td><td class="num">${hmR(T.rest?.minutes)}</td><td class="num">${T.checks.weekendsOff}</td><td class="num">${f1(TO.wkFit)}</td><td class="num">${f1(TO.fits.sat)}</td><td class="num">${f1(TO.fits.sun)}</td><td class="num">${T.feel.distinctTimes}</td><td class="num">${T.feel.distinctTimes}</td></tr>`;
  const page9 = `<section class="page">
  <div class="mast"><div><div class="eyebrow">Beside the others</div><h1>Where it stands among the ${folder.length}</h1><div class="sub">Every proposal on the same figures, with today’s link at the foot. This sheet’s row is highlighted.</div></div></div>
  <div class="callout plain"><b>Like with like.</b> Every figure below was worked out the same way for every proposal, from its rota, by the Marylebone Roster app — so any two rows can be compared directly.</div>
  <table class="t standings"><thead><tr><th rowspan="2">Proposal</th><th class="num" rowspan="2">Rules met</th><th class="num" rowspan="2">Fatigue factors</th><th class="num" rowspan="2">Most days in a row</th><th class="num" rowspan="2">Shortest rest</th><th class="num" rowspan="2">Full weekends off</th><th class="num grp" colspan="3">Floor fit</th><th class="num" rowspan="2">Shift times</th><th class="num" rowspan="2">Already worked today</th></tr><tr><th class="num">Mon–Fri</th><th class="num">Sat</th><th class="num">Sun</th></tr></thead><tbody>
  ${rank.map(d => tr(d, d.code === code)).join('')}${todayRow}
  </tbody></table>
  <p class="muted">Ordered by rules met, then fewest fatigue factors, then the weekday floor fit — an order, not a verdict. <b>Rules met</b> counts the ${R.of} December 2026 rules on page 7. <b>Fatigue factors</b> are the patterns present, of 25 — the ORR’s list and four rail-industry checks (page 8). <b>Most days in a row</b> is at worst, against Chiltern’s limit of 13; <b>shortest rest</b> must be at least 12 hours, or the rota cannot be run. <b>Full weekends off</b> are out of 24 (20 for today’s link). <b>Floor fit</b> is how closely the people on the floor, ticket office staff not counted, follow the trains — lower is closer (page 6). <b>Shift times</b> is how many different times the rota uses, and <b>already worked today</b> how many of them people work now.</p>
  <div class="foot"><span>Page 9 of 10 — Beside the other proposals</span><span class="foot-id"><b>${name}</b> · ${code} · ${meta.identity.fingerprint} · Marylebone Roster — Links designer</span></div>
</section>`;

  const satMet = P.daily.sat >= 14, sunMet = P.daily.sun >= 10;
  const readLines = (() => {
    const w = P.feel.workingLines;
    if (newLines.length) return `${newLines.length === w ? `Every working line` : `${newLines.length} of the ${w} working lines`} (${newLines.length === w ? 'all of them' : `lines ${andList(newLines.map(String))}`}) ${newLines.length === 1 || newLines.length === w ? 'holds' : 'hold'} at least one shift time nobody works today. On a rotating link everyone works every line in turn, so staff read those weeks first and say in one line each what they would change.`;
    return `The longest duty (${hmR(longest)}) is on ${longLines.length === 1 ? 'line' : 'lines'} ${andList(longLines.map(String))}; staff read those weeks first and say in one line each what they would change.`;
  })();
  const p8Note = `Present: ${P.fatigue.present} (today ${T.fatigue.present}). <b>How to read the table.</b> The figure beside each mark is the worst case found — a count of duties, a run of shifts, or hours in seven days. The MRSF rows are extra checks from the rail industry’s guidance on managing staff fatigue, listed beside the ORR’s own. FF2 applies to every 06:20 start, so it comes with the station’s opening time, not with the design. FF11 counts shifts between two-day breaks, so a single rest day does not reset it — that is why it can be longer than the most days worked in a row. <b>Cover weeks.</b> ${ff11Same ? `On this design it makes no difference to this page how the roster clerk places a cover week’s four duties: the figures are the same either way.` : `A cover week’s four duties can fall in different ways. The main FF11 figure assumes they are spread out, so the week gives no two-day break; the “as rostered” figure beneath it assumes they are worked together, which is usual. Which applies is for the roster office.`} This page is an aid to discussion, not a fatigue risk assessment.`;

  return {
    identity: { ...meta.identity, strap },
    // the duty table lists today's times and this design's together; past ~26 rows it needs the tight layout to fit page 5
    ...(() => { const k = new Set([...T.tableRows, ...P.tableRows].map(r => r.time)).size; return k > 36 ? { denseDuty: true, tightDuty: true, xxTightDuty: true } : k > 26 ? { denseDuty: true, tightDuty: true } : {}; })(),
    fresh: true, changed: null, officeNamed: R.rows.find(r => r.key === 'office').ok,
    coverSame, coverParts, ff11Split, ff11Block, readLines, p8Note, monSat, f1,
    rulesChip: failed.length ? `<span class="sum-chip sum-chip--warn">⚠ <strong>${failed.length}</strong> of ${R.of} December 2026 rules not met</span>` : `<span class="sum-chip sum-chip--ok">✓ all <strong>${R.of}</strong> December 2026 rules met</span>`,
    metaLine: `Prepared ${rendered} · every figure is calculated from the rota, not entered by hand`,
    identExtra: `<div class="ident-row ident-minor"><span class="ident-k">Family</span><span class="ident-v">${FAMILY[code.split('-')[0]] ?? '—'}</span></div><div class="ident-row ident-minor"><span class="ident-k">Created</span><span class="ident-v">${(FIRST[code] ?? '—').replace('Sep', 'September')}</span></div>`,
    sub1: 'How this rota would work from December 2026, and how it compares with today’s link',
    intro, intro2: '',
    decMet: R.met, decOf: R.of, decToday: RT.met, decLabel: 'December 2026 rules met',
    decTile: `the staffing levels, the ticket office, the floor and the handovers — page 7 · today’s link meets ${RT.met} of ${R.of}`,
    headsEvid: `At least four at the open, three at the close, five at 22:00; 14 on Saturday, 10 on Sunday`,
    satNote: satMet ? 'meets the December 2026 figure of 14' : 'short of the December 2026 figure of 14',
    sunNote: sunMet ? 'meets the December 2026 figure of 10' : 'short of the December 2026 figure of 10',
    designHeading: 'The December 2026 rules', designSub: '— the same rules every proposal is measured against, with today’s link beside them',
    designRules: R.rows.map((r, i) => ({ rule: r.rule, value: r.value, ok: r.ok, note: r.note, today: RT.rows[i].value, todayOk: RT.rows[i].ok })),
    openQuestionsHeading: 'Still to settle', openQuestions: oqItems.join(' '), openQuestionsHtml: `<ul class="oq-list">${oqItems.map(x => `<li>${x}</li>`).join('')}</ul>`,
    wembleyLine: 'Whether this pattern holds on Wembley event days — it is based on the train timetable, not on passenger numbers.',
    sundayNote: 'On Sundays five trains in the December 2026 timetable arrive or leave after the 23:25 finish (the last at 23:54); the bar under the Sunday 23:00 hour marks the time after the finish. Whether Sunday cover should run later is still to be decided.',
    coverNote: gaps.length ? (new Set(gaps).size === 1 ? `evenly spaced, every ${gaps[0]} lines · today’s are at lines ${T.feel.spareLines.join(', ')}` : `not evenly spaced (gaps of ${andList(gaps.map(String))} lines; even would be every 6) · today’s are at lines ${T.feel.spareLines.join(', ')}`) : undefined,
    eyebrow3: 'Against today’s link', h3: 'A week, and the duty table',
    sub3: 'How a working week compares with today’s, and every shift time beside the ones worked today.',
    keptHeading: 'The shape of a week, against today', dutyHeading: 'The duty table, beside today’s',
    dutyNote: `Monday to Friday add up to ${n(wkTot)} minutes of duty and Saturday ${n(satMin)} — ${contractWords}. Sunday adds ${n(sunMin)}, paid on top of the contracted week. ${newTimes.length === 0 ? 'Every shift time here is one people already work today.' : newTimes.length === 1 ? `1 of the ${P.feel.distinctTimes} shift times is new — nobody works it today.` : `${newTimes.length} of the ${P.feel.distinctTimes} shift times are new — nobody works them today.`}`,
    coverCallout: `The <b>floor</b> rows are the fair comparison. The ticket office is staffed to its opening hours, not to the trains, so counting it in can make a day look better or worse than the floor really is. The fit measures <b>shape, not numbers</b> — each hour’s share of the day’s staff against its share of the day’s trains — so an extra person in a quiet hour makes it worse even though nobody is worse off. Read it beside the numbers of people, never alone.`,
    frame: {
      family: 'keep',
      question: `Should the CEA link for the December 2026 timetable be <b>${name}</b>? It is judged against today’s 20-line link and the December 2026 rules, and page 9 sets it beside the other ${others.length} proposals on the same figures.`,
      stands: `<b>${name}</b> — ${lc(strap)}.`,
      read: '',
    },
    page9,
  };
}

/** The last pass over the finished page, for words the shared template carries that a first-time reader should not
 *  meet: "the folder" (this directory, meaningless to a manager), "owner" (the app's owner, who is presenting), and
 *  the search's own vocabulary. Each is a whole phrase, so nothing else is caught; the scan in the README's
 *  checklist is what proves none survived. */
export function freshWords(html, { total, todayMet, of, monSat, coverSame }) {
  const n = x => Number(x).toLocaleString('en-GB');
  // PLAIN ENGLISH (owner, 28 Sep 2026: "a clarity for dummies check"). Every term a first-time reader would have to
  // ask about is either explained where it stands or replaced with the everyday word. The second half of this list
  // is the page-by-page review of all 23 sheets (five reviewers, every page read as an image).
  const PLAIN = [
    [/<div class="callout"><b>What it is not\.<\/b>[\s\S]*?<\/div>/, '<div class="callout"><b>What it is not.</b> Not a recommendation and not a finished roster: nothing here has been through the roster office or a union rep yet. The December 2026 staffing levels were given verbally and are not yet in writing.</div>'],
    // page 4 — the glossary, with every word the other pages lean on
    [/<div><b>Turn<\/b> — a shift time, such as 06:20-13:45\. An <b>early<\/b> starts before 09:00; a <b>late<\/b> starts after\.<\/div>/, '<div><b>Turn</b> — a shift time, such as 06:20-13:45. An <b>early</b> starts before 11:00; a <b>late</b> starts at 11:00 or later.</div>'],
    [/<div><b>One-turn week<\/b> — [^<]*<\/div>/, '<div><b>One-turn week</b> — one clock time Monday to Friday, with every day of the week starting on the same side of 09:00 (shown bold in the Turns column); the easiest kind of week to live around.</div><div><b>The floor</b> — staff out on the station (gates, concourse, platforms), not in the ticket office.</div><div><b>Opener / closer</b> — the first people on duty in the morning and the last at night.</div><div><b>Handover</b> — the overlap when one shift takes over from another.</div><div><b>Fit</b> — how closely the number of people on duty follows the number of trains through the day; 0 is a perfect match, lower is better.</div>'],
    [/>Cover<\/td>/g, '>On duty</td>'], [/ one turn<\/span><\/td><\/tr>/g, ' one-turn weeks</span></td></tr>'],
    // page 5
    [/Days worked in a week <span class="muted">\(lines × days\)<\/span>/g, 'Days worked in a week <span class="muted">(Sunday included; weeks × days)</span>'],
    [/Sunday duties <span class="muted">\(not contracted; half the working lines\)<\/span>/g, 'Sunday duties <span class="muted">(not contracted)</span>'],
    [/Rest-day breaks that are two days or more/g, 'Rest-day breaks of two days or more <span class="muted">(of all rest-day breaks)</span>'],
    [/Changed — the December 2026 headcount/g, 'How many people are working'], [/<th>People on duty<\/th>/g, '<th>People working</th>'],
    [/the contract: 20 working lines × 35h has to be worked somewhere/g, '24 people instead of 20, so more on each weekday'],
    [/not floor cover; Sunday one late today/g, 'ticket office only; today Sunday has one late, not two'],
    [/wk · Sat · Sun/g, 'Mon–Fri · Sat · Sun'], [/<th class="num">Wk<\/th>/g, '<th class="num">Mon–Fri</th>'],
    [/Busiest weekday · Saturday · Sunday\. The first three columns are what the 20-line link does now; the last three are the proposal\. Green cells grew, amber shrank, a struck-through row is a time the proposal does not use\./g, 'People on each shift time on a Saturday, a Sunday and — under Mon–Fri — the weekday with most of that time, so Mon–Fri can add up to more than work on one day. Green: more than today; amber: fewer; struck through: not used.'],
    // page 3
    [/Firm figure/g, 'Firm'], [/(\d+)\/(\d+) at the weekend/g, '$1 on Saturday, $2 on Sunday'],
    [/Relayed December 2026 headcounts with no document behind them/g, 'December 2026 staffing levels given verbally; not yet in writing'],
    [/Demand fit ([\d. ·]+); on the floor/g, 'Fit, everyone on duty $1; floor only'],
    [/; floor takes the ticket office out of both sides/g, '; the floor figure leaves the ticket office out'],
    [/Computed against the live 20-line link/g, 'Compared with today’s 20-line link'],
    [/Early against late: earlies/g, 'How long the shifts are: earlies'],
    [/The longest duty, ([^,<]+), and who holds it/g, 'The longest duty, $1 — the grid on page 4 shows which lines carry it'],
    [/ The roster office answers the cover-week question\./g, () => coverSame ? '' : ' The roster office answers the cover-week question.'],
    // page 1
    [/how far the working day shifts each week/g, 'how much the start time typically changes from one week to the next'],
    [/shift times people work today/g, 'shift times already worked today'],
    [/>1<\/b><span class="l">fatigue factors present/g, '>1</b><span class="l">fatigue factor present'], [/\b1 rests under 12h/g, '1 rest under 12h'], [/\b1 fatigue factors\b/g, '1 fatigue factor'],
    // page 2
    [/Lower is better on the fit and the fatigue count;/g, 'Lower is better on the fit, the fatigue count and the days in a row;'],
    // page 6
    [/The indented rows take it out of each side, so the floor rows compare like with like\./g, 'The indented rows take the office out of each side — today’s actual office staff from today’s link, the plan’s four posts from the proposal — so the floor rows compare like with like.'],
    // page 7
    [/<h1>The checks sheet<\/h1>/g, '<h1>Hard limits and the December 2026 rules</h1>'],
    [/More than 13 consecutive days worked/g, 'No more than 13 days worked in a row'], [/\(today: /g, '(today '],
    // page 8
    [/Good practice guidelines — Fatigue Factors, p3 \(December 2021\)\. ⚠ present — the pattern is in this design and worth a look, not a breach · ✓ clear — it is not · ● standing — true of the station itself, not of any design · – does not apply here\. This is the list the link is assessed against\./g, 'From the ORR’s good-practice guidance, Fatigue Factors, page 3 (December 2021). ⚠ present — the pattern is in this design and worth a look, not a breach · ✓ clear — it is not · ● standing — comes with the station’s hours or with any rotating link, not with this design’s choices · a blank means it does not apply here.'],
    // page 10
    [/Links → Import, then paste the whole block below\. Line number, then Sunday to Saturday; SP is a cover week\. The (?:Links designer|workspace) re-runs every check on these pages from the pasted cells, so nothing here has to be taken on trust(?: — and the two designers can edit it there like any other design)?\./g, 'Paste the whole block into the app’s Links designer (Links → Import). It re-runs every check on these pages, so nothing here has to be taken on trust.'],
    [/The same rotation is also supplied beside this PDF as <span class="tt">[^<]*<\/span> \(tab-separated, pastes directly\) and <span class="tt">[^<]*<\/span> \(the app's own format\)\./g, 'The same rota is also supplied as two files, one to paste and one the app can open.'],
    [/Every figure in this document was computed by the Marylebone Roster app's Links modules \(v([\d.]+)\) from exactly these cells; import them and the [^.]*\./g, 'Every figure in this document was calculated by the Marylebone Roster app (version $1) from exactly these cells; paste them into the app and it shows the same figures.'],
    // contents and footers: one name per page
    [/<b>5<\/b> A week compared with today/g, '<b>5</b> A week, and the duty table'], [/<b>7<\/b> Hard limits and the December 2026 figures/g, '<b>7</b> Hard limits and the December 2026 rules'],
    [/<b>10<\/b> The grid, ready to paste into the app/g, '<b>10</b> The rota, ready to paste into the app'],
    [/Page 3 of 10 — The decision frame/g, 'Page 3 of 10 — The decision it supports'], [/Page 6 of 10 — Cover against the timetable/g, 'Page 6 of 10 — People on duty, hour by hour'],
    [/Page 7 of 10 — The checks sheet: hard limits and design figures/g, 'Page 7 of 10 — Hard limits and the December 2026 rules'], [/Page 8 of 10 — The checks sheet: fatigue factors/g, 'Page 8 of 10 — The ORR fatigue factors'],
    [/Page 10 of 10 — Import/g, 'Page 10 of 10 — The rota, ready to paste into the app'],
    // one way to write a length of time: 8h 40m, never 8h40, 4h 0m or 84.50h
    [/(\d+)\.(\d\d)h\b/g, (m, h, f) => `${h}h ${String(Math.round(Number('0.' + f) * 60)).padStart(2, '0')}m`],
    [/\b(\d{1,2})h(\d\d)\b/g, '$1h $2m'], [/\b(\d+)h (\d)m\b/g, '$1h 0$2m'],
    [/<span class="ident-k">Built from<\/span>/g, '<span class="ident-k">Made by</span>'],
    [/<\/strong> lines designed/g, '</strong> lines, one per person'],
    [/Every figure is computed from the cells;/g, 'Every figure is worked out from the rota;'],
    [/Does it meet the December shape\?/g, 'Does it meet the December rules?'], [/<span class="l">headcount rules met<\/span>/g, '<span class="l">rules met</span>'],
    [/(\d+) of (\d+) weeks are one turn/g, '$1 of $2 working weeks keep one shift time'],
    [/are relayed figures with no document behind them \(evidence class C\), and the 13-day limit's policy citation is still outstanding/g, 'were passed on for this exercise and have no document behind them yet, and the written source of the 13-day limit is still to be confirmed'],
    [/which is the floor for being worth discussing/g, 'the minimum for a design to be worth discussing'],
    [/Every figure on this sheet is computed from the cells\./g, 'Every figure on this sheet is worked out from the rota.'],
    [/Three things to hold\./g, 'Three things to keep in mind.'], [/one-turn weeks and familiarity/g, 'weeks on one shift time and familiarity'],
    [/it meets none of the December 2026 headcounts\./g, `it meets ${todayMet} of the ${of} December 2026 rules.`],
    [/the as-rostered figure can be lower/g, 'the figure as actually rostered can be lower'],
    [/It is the proxy used here for how much there is to learn and to accept\./g, 'It is a rough guide to how much there is to learn and get used to.'],
    [/which criteria are hard and which are the room's/g, 'which criteria are fixed and which are yours to weigh'], [/Read this before the tiles\./g, 'Read this before the figures.'],
    [/Soft — the room weighs these against each other/g, 'Soft — weigh these against each other'], [/Preference — staff's to state, not the tool's/g, 'Preference — for staff to say, not the app'],
    [/ \(class C\)/g, ''], [/, unconfirmed threshold/g, ''],
    [/the 13-day limit's policy citation is still outstanding/g, 'the written source of the 13-day limit is still to be confirmed'],
    [/Computed from the cells; re-computed by the Links designer on import/g, 'Worked out from the rota; checked again by the app when it is loaded'],
    [/Working weeks on one turn/g, 'Working weeks on one shift time'], [/One turn all week can still be a bad week if the turn is long/g, 'One shift time all week can still be a hard week if the shift is long'], [/more of the day's traffic/g, 'more of the day’s trains'],
    [/\bBLOCK\b/g, 'block'], [/the Links designer’s own target is 6/g, 'the app’s own target is 6'],
    [/still "definition to confirm"/g, 'whose exact definition is still to be confirmed'],
    [/Measured timetable, one share-based measure on one December 2026 timetable curve/g, 'The measured December 2026 timetable; one way of measuring, not the only one'],
    [/<b>Indicative<\/b>/g, '<b>A guide</b>'], [/<b>Firm<\/b>, but a proxy for acceptability/g, '<b>Firm</b>, but only a rough guide to what staff will accept'],
    [/familiarity is measured as "times worked today", which is a proxy for acceptability, not acceptability\./g, 'this sheet counts times already worked today, which is only a rough guide to what staff will accept.'],
    [/Whether the roster clerk splits a cover week day-on-day-off\. It is the one thing that moves the 48-hour-break figure \((\d+) as a block, (\d+) split\), and the link does not decide it\./g, 'How the roster clerk places the four duties of a cover week. It can move the 48-hour-break figure ($1 if the four are worked together, $2 if they are split up), and the rota itself does not decide it.'],
    [/Before it is frozen/g, 'Before it is agreed'],
    [/Only then does the factor count on page 8 mean anything, and only then is this sheet more than an aid to a conversation\./g, 'Until then, this sheet is an aid to discussion, not a decision.'],
    [/Turns: distinct clock times Monday to Friday, <b>bold<\/b> where the week is one turn \(one clock time Mon–Fri and one early-or-late family across every worked day — the page 1 figure\) · Minutes: duty minutes per day, and Mon–Sat is the contract \(20 × 35h = 42,000\)/g, () => `Turns: how many different shift times the week works Monday to Friday; <b>bold</b> marks a one-turn week (see below) · Minutes: total duty minutes each day — ${monSat === 42000 ? 'Monday to Saturday adds up to the contract (20 people × 35 hours = 42,000 minutes)' : `Monday to Saturday adds up to ${n(monSat)}, ${n(Math.abs(monSat - 42000))} minutes ${monSat > 42000 ? 'over' : 'under'} the 42,000 of the contract`}`],
    [/Working weeks that are one turn <span class="muted">\(one clock time Mon–Fri\)<\/span>/g, 'Weeks on one shift time'],
    [/Weeks mixing early and late turns/g, 'Weeks mixing early and late shifts'],
    [/Distinct shift times <span class="muted">\(all but (\d+) on today’s roster\)/g, 'Different shift times <span class="muted">($1 not worked today)'],
    [/Distinct shift times <span class="muted">\(all already on today’s roster\)/g, 'Different shift times <span class="muted">(all worked today)'],
    [/Days worked in a week <span class="muted">\(lines × days\)<\/span>/g, 'Days worked in a week <span class="muted">(weeks × days)</span>'],
    [/Changed — the December 2026 headcount/g, 'Changed — how many people are on duty'],
    [/the contract: 20 working lines × 35h has to be worked somewhere/g, '20 working weeks of 35 hours have to be worked somewhere'],
    [/one row per distinct weekday/g, 'a row for each different weekday'],
    [/of whom ticket office/g, 'in the ticket office'], [/of whom on the floor/g, 'on the floor'], [/Dec 2026 traffic/g, 'Trains, Dec 2026'],
    [/Spare cover is not in these figures — a cover week carries no times, so the rows are a floor\./g, 'Cover weeks are not in these figures — a cover week has no fixed times — so real cover is a little higher.'],
    [/, and today's link scores what it scores/g, ''], [/ \(For the record:[^)]*\)/g, ''],
    [/within the 13 configured here from Chiltern practice \(origin: the legacy Hidden standard\)/g, 'within Chiltern’s limit of 13'],
    [/Basis: Chiltern roster policy, citation outstanding — legacy Hidden 13-in-14 standard\. Configured from Chiltern practice; the policy citation is outstanding, so this is stated as the app states it\./g, 'The written source of the 13-day limit is still to be confirmed.'],
    [/A spare week is 4 duties of 7/g, 'A cover week is 4 duties in 7 days'], [/as a BLOCK of four/g, 'as a block of four'],
    [/Sundays \(([^)]+)\) sit on top as RDW, as they do today\./g, 'Sunday duties ($1 in all) are paid on top as rest-day working, as they are today.'],
    [/ — and the two designers can edit it there like any other design\./g, '.'],
  ];
  const R = [
    [/the rest of the folder marked on a scale/g, 'the other proposals marked on a scale'],
    [/the other (\d+) sheets in the folder/g, 'the other $1 proposals'],
    [/best in the folder/g, 'best of the others'], [/fewest in the folder/g, 'fewest of the others'], [/most in the folder/g, 'most of the others'],
    [/folder worst/g, 'worst of the others'], [/folder best/g, 'best of the others'], [/the folder’s proxy/g, 'the proxy used here'],
    [/<b>9<\/b> Where it came from/g, '<b>9</b> Beside the other proposals'], [/Owner-relayed/g, 'Relayed'], [/owner-relayed/g, 'relayed'], [/owner’s figure for December 2026/g, 'the December 2026 figure'],
    [/ The generator refuses a design it cannot repair to this;[^.<]*\./g, ''],
    [/ It is the measure the searched tables were chosen on, and the fit of the average weekday is the <i>Wk fit<\/i> on page 9\./g, ' Page 1’s weekday figure is worked out from the five weekdays combined, so it is not an average of the scores shown.'],
    [/the workspace’s own/g, 'the Links designer’s own'], [/the workspace's/g, 'the Links designer’s'], [/the workspace/g, 'the Links designer'], [/The workspace/g, 'The Links designer'],
  ];
  return [...R, ...PLAIN].reduce((h, [re, to]) => h.replace(re, to), html);
}
