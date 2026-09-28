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

/** code → [one-line description, how it was made]. `search`: built by computer search against the rules and the
 *  timetable. `hand`: drawn by hand and checked by the app. `hand+search`: drawn by hand, weeks put in order by
 *  computer search for fewer fatigue factors. */
export const STRAPS = {
  'FR-24-F34':  ['The ticket office rostered in fixed pairs, every other duty timed so the floor follows the trains', 'search'],
  'PT-24-P34':  ['Today’s roster reworked: 15:45 closers, the rest of each day timed to the December trains', 'search'],
  'P2-24-N13':  ['Every shift starts and finishes on the quarter hour, on fourteen shift times', 'search'],
  'QT-24-Q34':  ['Today’s shift times kept, with the weekday closer starting at 15:45', 'search'],
  'Q2-24-W21':  ['Today’s shift times, 15:45 closers and no duty over 8h40, on eleven shift times', 'search'],
  'ST-24-B7':   ['Today’s link widened to 24 lines, in today’s own shift times', 'search'],
  'BB-24-D7':   ['Every shift time new, built from the December staffing levels, with longer earlies and shorter lates', 'search'],
  'EF-24-E21':  ['Built from the December staffing levels with no duty over 8h40', 'search'],
  'B2-24-G21':  ['No duty over 8h40, with two ticket-office lates written into every day', 'search'],
  'FT-24-EXT':  ['Fifteen shift times with the cover weeks evenly spread', 'hand'],
  'FT-24-R21':  ['Fifteen shift times, with the weeks put in an order that passes every hard limit', 'hand+search'],
  'WL-24-EXT':  ['Weekday lates starting 16:25, Saturdays kept as today', 'hand'],
  'WL2-24-R21': ['Weekday lates from 16:25, with extra cover under the 17:00 peak', 'hand+search'],
  'WL3-24-F7':  ['Weekday lates from 16:25, with weeks 13–17 fixed exactly as drawn', 'hand+search'],
  'WL4-24-F7':  ['Weekday lates from 16:25, with weeks 14–17 fixed in order on their own line numbers', 'hand+search'],
  'WS-24-EXT':  ['A cover week at line 18 and a midday turn at 12:00–20:30', 'hand'],
  'TF-24-EXT':  ['A cover week at line 18, the weeks ordered by hand to reduce fatigue', 'hand'],
  'TM-24-EXT':  ['Three Monday duties rotated to break up an eight-day run', 'hand'],
  'C17-24-EXT': ['The cover week at line 17, which clears the 48-hour-break fatigue factor', 'hand'],
  'S4-24-EXT':  ['Saturday on four shift times and three start times, weighted to the evening', 'hand'],
  'CF-24-EXT':  ['Weekday lates from 16:25 and no Saturday closer over 8h40', 'hand'],
  'CFT-24-M3':  ['Three shifts retimed to even out Saturday morning and Sunday afternoon', 'hand'],
  'TN-24-R7':   ['A tenth Sunday duty, with whole weeks reordered for fewer fatigue factors', 'hand+search'],
};
const MADE = {
  search: 'Built by computer search: the duty table was chosen for how closely it follows the December 2026 timetable, and the 24 weeks put in the order that raises the fewest fatigue factors.',
  hand: 'Drawn by hand and checked by the Links designer, which measured every figure in this sheet from the grid.',
  'hand+search': 'Drawn by hand, then the weeks put in order by computer search for the fewest fatigue factors; the duty times are as drawn.',
};
const MADE_SHORT = { search: 'computer search', hand: 'drawn by hand', 'hand+search': 'drawn by hand, ordered by search' };

/** The standalone words for one sheet. `folder` is folderStats() — every shipped design, with its rules. */
export function freshMeta({ T, P, meta, folder, rendered }) {
  const code = meta.identity.code, name = meta.identity.name;
  const [strap, made] = STRAPS[code] ?? [meta.identity.strap, 'hand'];
  const TA = { patterns: T.patterns, ...T };
  const R = currentRules(P, TA), RT = currentRules(TA, TA);
  const n = x => x.toLocaleString('en-GB');
  const newTimes = P.tableRows.filter(r => !T.tableRows.some(t => t.time === r.time)).map(r => r.time);
  const shared = P.feel.distinctTimes - newTimes.length;
  const failed = R.rows.filter(r => !r.ok);
  const FO = P.office, TO = T.office;
  const cmp = (p, t) => p < t ? 'more closely than' : p > t ? 'less closely than' : 'as closely as';
  const gaps = P.adj.spareGaps ?? [];
  const wkMin = P.tableRows.reduce((a, r) => a + r.weekday * r.minutes, 0), satMin = P.tableRows.reduce((a, r) => a + r.sat * r.minutes, 0), sunMin = P.tableRows.reduce((a, r) => a + r.sun * r.minutes, 0);
  const others = folder.filter(d => d.code !== code);
  const rank = [...folder].sort((a, b) => b.rules.met - a.rules.met || a.present - b.present || a.floor.wk - b.floor.wk);

  const intro = `<p><b>${name}</b> is a proposal for the CEA link on the December 2026 timetable: a 24-line rotation for 24 people, where today’s link has 20. ${strap}. ${MADE[made]}</p>
  <p><b>Against today’s link.</b> It meets <b>${R.met} of the ${R.of}</b> December 2026 rules, where today’s link meets ${RT.met}; it has ${P.daily.sat} on a Saturday and ${P.daily.sun} on a Sunday (today ${T.daily.sat} and ${T.daily.sun}). With the ticket office taken out, the people on the floor follow the weekday trains ${cmp(FO.wkFit, TO.wkFit)} today’s (a fit of ${FO.wkFit} against ${TO.wkFit}; lower is closer). ${P.fatigue.present === 0 ? 'No ORR fatigue factor is present' : `${P.fatigue.present} ORR fatigue factor${P.fatigue.present === 1 ? ' is' : 's are'} present`}, against ${T.fatigue.present} today. It works ${P.feel.distinctTimes} shift times, ${shared === 0 ? 'none of them' : `${shared} of them`} worked today.</p>`;

  const oq = [
    failed.length ? `<b>${failed.length === 1 ? 'One December 2026 rule is' : `${failed.length} of the ${R.of} December 2026 rules are`} not met:</b> ${failed.map(r => r.rule.charAt(0).toLowerCase() + r.rule.slice(1)).join('; ')}. The table above gives the figures.` : `<b>Every December 2026 rule is met.</b>`,
    newTimes.length ? `<b>New shift times.</b> ${newTimes.length} of the ${P.feel.distinctTimes} are times nobody works today; page 5 lists them.` : '',
    `<b>Sunday’s finish.</b> Five December 2026 timetable movements fall after the 23:25 close; whether Sunday’s window moves is not decided here.`,
  ].filter(Boolean).join(' ');

  const tr = (d, here) => `<tr${here ? ' class="here"' : ''}><td>${here ? `<b>${d.name}</b>` : d.name}</td><td class="num">${d.rules.met}/${d.rules.of}</td><td class="num">${d.present}</td><td class="num">${d.run}</td><td class="num">${d.weekends}</td><td class="num">${d.floor.wk}</td><td class="num">${d.floor.sat}</td><td class="num">${d.floor.sun}</td><td class="num">${d.distinct}</td><td class="num">${d.distinct - d.newTimes}</td></tr>`;
  const todayRow = `<tr class="today"><td><i>Today’s 20-line link</i></td><td class="num">${RT.met}/${RT.of}</td><td class="num">${T.fatigue.present}</td><td class="num">${T.checks.longestStretch}</td><td class="num">${T.checks.weekendsOff}</td><td class="num">${TO.wkFit}</td><td class="num">${TO.fits.sat}</td><td class="num">${TO.fits.sun}</td><td class="num">${T.feel.distinctTimes}</td><td class="num">${T.feel.distinctTimes}</td></tr>`;
  const page9 = `<section class="page">
  <div class="mast"><div><div class="eyebrow">Beside the others</div><h1>Where it stands among the ${folder.length}</h1><div class="sub">Every proposal on the same figures, with today’s link at the foot. This sheet’s row is in bold.</div></div></div>
  <div class="callout plain"><b>How it was made.</b> ${MADE[made]} Every figure below was measured the same way for every proposal, from its grid, by the Links designer’s own rule modules.</div>
  <table class="t standings"><thead><tr><th>Proposal</th><th class="num">Rules met</th><th class="num">Fatigue factors</th><th class="num">Longest run</th><th class="num">Full weekends off</th><th class="num" colspan="3">Floor fit — wk · Sat · Sun</th><th class="num">Shift times</th><th class="num">Worked today</th></tr></thead><tbody>
  ${rank.map(d => tr(d, d.code === code)).join('')}${todayRow}
  </tbody></table>
  <p class="muted">Ordered by rules met, then fewest fatigue factors, then the weekday floor fit — an order, not a verdict. <b>Rules met</b> counts the ${R.of} December 2026 rules on page 7. <b>Floor fit</b> is how closely the people on the floor, the ticket office taken out, follow the trains (lower is closer; page 6). <b>Longest run</b> is days worked in a row at worst, against Chiltern’s limit of 13; <b>full weekends off</b> are out of 24 (20 for today’s link).</p>
  <div class="foot"><span>Page 9 of 10 — Beside the others</span><span class="foot-id"><b>${name}</b> · ${code} · ${meta.identity.fingerprint} · Marylebone Roster — Links designer</span></div>
</section>`;

  return {
    identity: { ...meta.identity, strap },
    // the duty table lists today's times and this design's together; past ~26 rows it needs the tight layout to fit page 5
    ...(() => { const n = new Set([...T.tableRows, ...P.tableRows].map(r => r.time)).size; return n > 36 ? { denseDuty: true, tightDuty: true, xxTightDuty: true } : n > 26 ? { denseDuty: true, tightDuty: true } : {}; })(),
    fresh: true, changed: null, officeNamed: R.rows.find(r => r.key === 'office').ok,
    metaLine: `Prepared ${rendered} for the December 2026 timetable · assessed by the Links designer’s own rule modules · every figure is computed from the grid, not typed`,
    builtFrom: `24 lines · 4 cover weeks · ${MADE_SHORT[made]}`,
    sub1: 'A proposal for the CEA link on the December 2026 timetable, judged against today’s link and the December 2026 rules',
    intro, intro2: '',
    decMet: R.met, decOf: R.of, decToday: RT.met, decLabel: 'December 2026 rules met',
    decTile: `the staffing levels, the ticket office, the floor and the handovers — page 7 · today’s link meets ${RT.met} of ${R.of}`,
    headsEvid: 'At least four at the open, three at the close, five at 22:00, 14 and 10 at the weekend',
    satNote: 'the December 2026 figure', designHeading: 'The December 2026 rules',
    designSub: '— the same rules every proposal is measured against',
    designRules: R.rows.map(r => ({ rule: r.rule, value: r.value, ok: r.ok, note: r.note })),
    openQuestionsHeading: 'Still to settle', openQuestions: oq,
    wembleyLine: 'Whether the December 2026 timetable demand curve holds on Wembley event days — the curve is a measured timetable, not a footfall count.',
    coverNote: gaps.length ? `${new Set(gaps).size === 1 ? 'evenly spaced' : 'not evenly spaced'} — gaps of ${gaps.join(', ')} lines · today’s sit at ${T.feel.spareLines.join(', ')}` : undefined,
    eyebrow3: 'Against today’s link', h3: 'A week, and the duty table',
    sub3: 'How a working week compares with today’s, and every shift time beside the ones worked today.',
    keptHeading: 'The shape of a week, against today', dutyHeading: 'The duty table, beside today’s',
    dutyNote: `A weekday pays ${n(wkMin)} minutes and a Saturday ${n(satMin)}, so five weekdays and a Saturday make exactly 20 × 35 hours = 42,000; Sunday pays ${n(sunMin)}, outside the contracted week. ${newTimes.length ? `${newTimes.length} of the ${P.feel.distinctTimes} times are ones nobody works today.` : 'Every time is one people work today.'}`,
    coverCallout: `The <b>floor</b> rows are the ones to read: the ticket office is staffed to its opening hours, not to the trains, so every everyone-on-duty row fits more loosely than its floor row. The fit measures <b>shape, not numbers</b> — each hour’s share of the day’s cover against its share of the day’s trains — so an extra person in a quiet hour makes it worse even though nobody is worse off. Read it beside the heads, never alone.`,
    frame: {
      family: 'keep',
      question: `Should the CEA link for the December 2026 timetable be <b>${name}</b>? It is judged against today’s 20-line link and the December 2026 rules, and page 9 sets it beside the other ${others.length} proposals on the same figures.`,
      stands: `<b>${name}</b> — ${strap.charAt(0).toLowerCase() + strap.slice(1)}. ${MADE[made]}`,
      read: '',
    },
    page9,
  };
}

/** The last pass over the finished page, for words the shared template carries that a first-time reader should not
 *  meet: "the folder" (this directory, meaningless to a manager), "owner" (the app's owner, who is presenting), and
 *  the search's own vocabulary. Each is a whole phrase, so nothing else is caught; the scan in the README's
 *  checklist is what proves none survived. */
export function freshWords(html, total) {
  const R = [
    [/the rest of the folder marked on a scale/g, 'the other proposals marked on a scale'],
    [/the other (\d+) sheets in the folder/g, 'the other $1 proposals'],
    [/best in the folder/g, `best of the ${total}`], [/fewest in the folder/g, `fewest of the ${total}`], [/most in the folder/g, `most of the ${total}`],
    [/folder worst/g, `worst of ${total}`], [/folder best/g, `best of ${total}`], [/the folder’s proxy/g, 'the proxy used here'],
    [/<b>9<\/b> Where it came from/g, '<b>9</b> Beside the other proposals'], [/Owner-relayed/g, 'Relayed'], [/owner-relayed/g, 'relayed'], [/owner’s figure for December 2026/g, 'the December 2026 figure'],
    [/ The generator refuses a design it cannot repair to this;[^.<]*\./g, ''],
    [/ It is the measure the searched tables were chosen on, and the fit of the average weekday is the <i>Wk fit<\/i> on page 9\./g, ' The fit of the average weekday is the one on page 1.'],
    [/the workspace’s own/g, 'the Links designer’s own'], [/the workspace's/g, 'the Links designer’s'], [/the workspace/g, 'the Links designer'], [/The workspace/g, 'The Links designer'],
  ];
  return R.reduce((h, [re, to]) => h.replace(re, to), html);
}
