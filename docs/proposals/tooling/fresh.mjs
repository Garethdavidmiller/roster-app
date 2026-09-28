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

  const hmR = m => m == null ? '—' : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  const wdR = o => { const v = ['mon', 'tue', 'wed', 'thu', 'fri'].map(d => o[d]); const lo = Math.min(...v), hi = Math.max(...v); return lo === hi ? `${lo}` : `${lo}–${hi}`; };
  const glance = `<table class="t glance"><thead><tr><th>At a glance</th><th class="num">Today’s link</th><th class="num">${name}</th></tr></thead><tbody>
    <tr><td>December 2026 rules met</td><td class="num">${RT.met} of ${R.of}</td><td class="num">${R.met} of ${R.of}</td></tr>
    <tr><td>People on duty — weekday · Saturday · Sunday</td><td class="num">${wdR(T.daily)} · ${T.daily.sat} · ${T.daily.sun}</td><td class="num">${wdR(P.daily)} · ${P.daily.sat} · ${P.daily.sun}</td></tr>
    <tr><td>How closely the floor follows the trains — weekday · Sat · Sun <span class="muted">(lower is closer)</span></td><td class="num">${TO.wkFit} · ${TO.fits.sat} · ${TO.fits.sun}</td><td class="num">${FO.wkFit} · ${FO.fits.sat} · ${FO.fits.sun}</td></tr>
    <tr><td>ORR fatigue factors present <span class="muted">(of 25)</span></td><td class="num">${T.fatigue.present}</td><td class="num">${P.fatigue.present}</td></tr>
    <tr><td>Most days worked in a row <span class="muted">(limit 13)</span></td><td class="num">${T.checks.longestStretch}</td><td class="num">${P.checks.longestStretch}</td></tr>
    <tr><td>Shortest rest between two duties <span class="muted">(at least 12h)</span></td><td class="num">${hmR(T.rest?.minutes)}</td><td class="num">${hmR(P.rest?.minutes)}</td></tr>
    <tr><td>Full weekends off</td><td class="num">${T.checks.weekendsOff} in ${T.feel.workingLines + T.feel.spareLines.length}</td><td class="num">${P.checks.weekendsOff} in 24</td></tr>
    <tr><td>Different shift times <span class="muted">(how many already worked today)</span></td><td class="num">${T.feel.distinctTimes}</td><td class="num">${P.feel.distinctTimes} (${shared})</td></tr>
  </tbody></table>`;
  const intro = `<p><b>${name}</b> is a proposal for the CEA link on the December 2026 timetable: a 24-line rotation for 24 people, where today’s link has 20. In short: ${strap.charAt(0).toLowerCase() + strap.slice(1)}. ${MADE[made]}</p>
  <p><b>Against today’s link</b> — the table below; page 2 explains each figure.</p>${glance}`;

  const oqItems = [
    failed.length ? `<b>${failed.length === 1 ? 'One December 2026 rule is' : `${failed.length} of the ${R.of} December 2026 rules are`} not met</b> — ${failed.map(r => r.rule.charAt(0).toLowerCase() + r.rule.slice(1)).join('; ')}. The shaded rows above give the figures.` : `<b>Every December 2026 rule is met.</b>`,
    newTimes.length ? `<b>New shift times.</b> ${newTimes.length} of the ${P.feel.distinctTimes} are times nobody works today; page 5 lists them.` : '',
    `<b>Sunday’s finish.</b> Five December 2026 timetable movements fall after the 23:25 close; whether Sunday’s window moves is not decided here.`,
  ].filter(Boolean);
  const oq = oqItems.join(' ');

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
    metaLine: `Prepared ${rendered} · every figure is worked out from the rota itself by the Marylebone Roster app, not typed in`,
    builtFrom: `${MADE_SHORT[made]} · 24 lines, 4 of them cover weeks`,
    sub1: 'How this rota would work from December 2026, and how it compares with today’s',
    intro, intro2: '',
    decMet: R.met, decOf: R.of, decToday: RT.met, decLabel: 'December 2026 rules met',
    decTile: `the staffing levels, the ticket office, the floor and the handovers — page 7 · today’s link meets ${RT.met} of ${R.of}`,
    headsEvid: 'At least four at the open, three at the close, five at 22:00, 14 and 10 at the weekend',
    satNote: 'the December 2026 figure', designHeading: 'The December 2026 rules',
    designSub: '— the same rules every proposal is measured against',
    designRules: R.rows.map(r => ({ rule: r.rule, value: r.value, ok: r.ok, note: r.note })),
    openQuestionsHeading: 'Still to settle', openQuestions: oq, openQuestionsHtml: `<ul class="oq-list">${oqItems.map(x => `<li>${x}</li>`).join('')}</ul>`,
    wembleyLine: 'Whether the December 2026 timetable demand curve holds on Wembley event days — the curve is a measured timetable, not a footfall count.',
    coverNote: gaps.length ? `${new Set(gaps).size === 1 ? 'evenly spaced' : 'not evenly spaced'} — gaps of ${gaps.join(', ')} lines · today’s sit at ${T.feel.spareLines.join(', ')}` : undefined,
    eyebrow3: 'Against today’s link', h3: 'A week, and the duty table',
    sub3: 'How a working week compares with today’s, and every shift time beside the ones worked today.',
    keptHeading: 'The shape of a week, against today', dutyHeading: 'The duty table, beside today’s',
    dutyNote: `A weekday adds up to ${n(wkMin)} minutes of duty and a Saturday ${n(satMin)}, so five weekdays and a Saturday make exactly 20 × 35 hours = 42,000; Sunday adds up to ${n(sunMin)}, paid on top of the contracted week. ${newTimes.length ? `${newTimes.length} of the ${P.feel.distinctTimes} times are ones nobody works today.` : 'Every time is one people work today.'}`,
    coverCallout: `The <b>floor</b> rows are the ones to read: the ticket office is staffed to its opening hours, not to the trains, so every everyone-on-duty row fits more loosely than its floor row. The fit measures <b>shape, not numbers</b> — each hour’s share of the day’s cover against its share of the day’s trains — so an extra person in a quiet hour makes it worse even though nobody is worse off. Read it beside the numbers of people, never alone.`,
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
export function freshWords(html, { total, todayMet, of }) {
  // PLAIN ENGLISH (owner, 28 Sep 2026: "a clarity for dummies check"). Every term a first-time reader would have to
  // ask about is either explained where it stands or replaced with the everyday word.
  const PLAIN = [
    [/<div class="callout"><b>What it is not\.<\/b>[\s\S]*?<\/div>/, '<div class="callout"><b>What it is not.</b> Not a recommendation and not a finished roster: nothing here has been through the roster office or a rep yet. The December 2026 staffing levels were passed on for this exercise and have no document behind them yet.</div>'],
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
    [/Turns: distinct clock times Monday to Friday, <b>bold<\/b> where the week is one turn \(one clock time Mon–Fri and one early-or-late family across every worked day — the page 1 figure\) · Minutes: duty minutes per day, and Mon–Sat is the contract \(20 × 35h = 42,000\)/g, 'Turns: how many different shift times the week works Monday to Friday; <b>bold</b> means one shift time all week · Minutes: total duty minutes each day — Monday to Saturday adds up to the contract (20 × 35h = 42,000)'],
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
    [/Sundays \(([\d.]+)h\) sit on top as RDW, as they do today\./g, 'Sunday duties ($1h in all) are paid on top as rest-day working, as they are today.'],
    [/ — and the two designers can edit it there like any other design\./g, '.'],
  ];
  const R = [
    [/the rest of the folder marked on a scale/g, 'the other proposals marked on a scale'],
    [/the other (\d+) sheets in the folder/g, 'the other $1 proposals'],
    [/best in the folder/g, 'best of the others'], [/fewest in the folder/g, 'fewest of the others'], [/most in the folder/g, 'most of the others'],
    [/folder worst/g, 'worst of the others'], [/folder best/g, 'best of the others'], [/the folder’s proxy/g, 'the proxy used here'],
    [/<b>9<\/b> Where it came from/g, '<b>9</b> Beside the other proposals'], [/Owner-relayed/g, 'Relayed'], [/owner-relayed/g, 'relayed'], [/owner’s figure for December 2026/g, 'the December 2026 figure'],
    [/ The generator refuses a design it cannot repair to this;[^.<]*\./g, ''],
    [/ It is the measure the searched tables were chosen on, and the fit of the average weekday is the <i>Wk fit<\/i> on page 9\./g, ' The fit of the average weekday is the one on page 1.'],
    [/the workspace’s own/g, 'the Links designer’s own'], [/the workspace's/g, 'the Links designer’s'], [/the workspace/g, 'the Links designer'], [/The workspace/g, 'The Links designer'],
  ];
  return [...R, ...PLAIN].reduce((h, [re, to]) => h.replace(re, to), html);
}
