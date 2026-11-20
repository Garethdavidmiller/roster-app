// @ts-check
/**
 * paycalc-help.js — Help tip content for the Pay Calculator lightboxes.
 *
 * Pure data — no DOM, no Firebase, no localStorage.
 * Keys match the data-help attribute on each .help-btn in paycalc.html.
 * Tips support <strong> for emphasis — rendered via innerHTML in the lightbox.
 */

import { TAX_YEARS, GRADES } from './paycalc-calc.js';

// The contracted hours are read from the grade table, so this tip follows them if they ever change,
// and says so per grade if the two grades stop matching.
const _ceaContr = GRADES.cea.contr, _cesContr = GRADES.ces.contr;
const CONTRACT_TIP = _ceaContr === _cesContr
    ? `Your contract includes <strong>${_ceaContr} hours per period</strong> at your base rate. You don't enter those — they're included automatically as basic pay. (CES and CEA are both ${_ceaContr} hours.)`
    : `Your contract includes your grade's hours per period at your base rate — <strong>CEA ${_ceaContr}, CES ${_cesContr}</strong>. You don't enter those — they're included automatically as basic pay.`;

export const HELP_CONTENT = {
  hours: {
    title: 'Your Hours — how it works',
    tips: [
      '<strong>Glossary:</strong> AL = Annual Leave · RDW = Rest Day Working (you worked on your scheduled day off) · BH = Bank Holiday · CEA / CES = your pay grade · HPP = Holiday Pay Premium (annual lump sum in January).',
      CONTRACT_TIP,
      'If your name is in the roster, a gold hint card appears at the top of this section showing your special shifts for the period — Saturday, Sunday, bank holiday, bank holiday overtime, overtime, rest day working (RDW), and Boxing Day. Select a category row to fill just that one from your calendar. Select <strong>Fill from calendar</strong> to fill every category in one go — once you\'ve typed values, the same button reads <strong>Replace with calendar values</strong> as a reminder it will overwrite them, which can\'t be undone. Filled fields turn gold; the highlight clears as soon as you edit them. When you\'re online, the counts include the shift changes on your calendar — from the weekly roster, or recorded on the Admin page — not just the base roster. One thing it will not guess: an ordinary weekday you worked on what should have been a rest day — a swap pays in ways the app cannot predict, so it is left for you to enter. A Saturday or bank holiday recorded as an ordinary shift on a day off — a weekday swapped for it — counts as rostered (Rostered Saturday, Bank Holiday Rostered); one recorded as rest day working counts as RDW or Bank Holiday Overtime. It is deliberately cautious, and never invents a figure.',
      'Training, induction, assessment, team days, union courses and meetings — the <strong>Other</strong> days on your calendar — pay as the day they replace, so one on a normal weekday needs nothing here. The <strong>Peer Training</strong> row is only for days you spent training a colleague. A <strong>training rest-day</strong> pre-fills <strong>8 hours</strong> as a default — change it to the hours you actually did. It goes into the box the day itself calls for: normally RDW, but <strong>Bank Holiday Overtime</strong> if the day is a bank holiday, and the <strong>Boxing Day</strong> box on 26 December. If training ran past your rostered shift, put the extra time in the Overtime box.',
      'Only enter hours at a <strong>different rate</strong>: rostered Saturdays (time-and-a-quarter, 1.25×), bank holidays (1.25×), overtime (time-and-a-quarter, 1.25×), rest days worked as extra, a Saturday off included (1.25×), Sundays (time-and-a-half, 1.5×), Boxing Day (triple time, 3×).',
      '<strong>None of those on a payslip?</strong> A week of ordinary weekday shifts has nothing to type, because your basic pay is worked out already. Tick <strong>No special-rate hours on this payslip</strong> under the rows, so the payslip counts as entered in <strong>This tax year so far</strong> and your Holiday Pay Premium. <strong>Fill these from your calendar</strong> ticks it for you on any payslip whose calendar has none. Type hours in later and the tick goes.',
      'A Sunday you worked goes in <strong>Sunday Working</strong>, never in Rest Day Working — Sunday is uncontracted, so every Sunday hour is 1.5× whether or not it was in your roster. Your payslip calls it "RDW&nbsp;Sun&nbsp;1.5", which is the one place the two look alike.',
      '<strong>Bank holiday rows</strong> appear automatically in periods that contain one. "Bank Holiday Rostered" is for contracted shifts on a bank holiday; "Bank Holiday Overtime" is for hours beyond your rostered shift on a bank holiday, or for a rest day on one worked as extra. A bank holiday swapped for a weekday is "Bank Holiday Rostered".',
      'Boxing Day rows only appear in the January payslip period — they\'re hidden the rest of the time. Boxing Day 3× is for shifts worked on 26 December itself, whatever day of the week it falls on. A substitute bank holiday — the weekday given in place of a Christmas Day or Boxing Day that falls at a weekend — goes in Bank Holiday Rostered, not Boxing Day.',
      'The <strong>cut-off date</strong> is the last shift date counted in this pay period — shifts <em>on</em> it count. Only shifts <strong>after</strong> it go into the next period.',
      'Each entry updates the estimate instantly — no need to press a calculate button.',
    ],
  },
  settings: {
    title: 'Your Settings — what everything means',
    tips: [
      // The card's own hint now names the two grades and stops (review, 15 Nov 2026): how a promotion
      // is priced is read here, on demand, and told to the member it concerns when it happens.
      '<strong>Grade:</strong> CEA = Customer Experience Ambassador, CES = Customer Experience Supervisor. <strong>From the roster</strong> (the usual choice) uses the grade you held on each payslip\'s days, so a promotion changes your rate from the right payslip — you don\'t need to change anything. Pick CEA or CES yourself only if the roster has your grade wrong or you are acting up, then choose the first payslip it applies to.',
      `<strong>Hourly rate:</strong> set automatically by your grade — CEA £${GRADES.cea.rate.toFixed(2)}, CES £${GRADES.ces.rate.toFixed(2)}. When a pay award is confirmed the new rate applies on its own, and older payslips keep the rate you were actually paid at the time.`,
      '<strong>Tax code:</strong> shown at the top of your payslip (e.g. 1257L). HMRC sets it, and it tells payroll how much of your pay is tax-free. Most Marylebone staff are on 1257L. If you\'re unsure, check your payslip or contact payroll.',
      '<strong>Pension contribution:</strong> your payslip calls this "Smart RPS CR Scheme" — it\'s the same thing. <strong>Pension is saved separately for each period</strong> — so if yours changes mid-year, update it here and past periods will keep their own recorded amount. The label next to the field shows which period you\'re editing.',
      '<strong>Not in the pension scheme:</strong> tick this if you have opted out of or left the RPS, then pick the <strong>first payslip with no pension deduction</strong>. That date is the whole point of the control — earlier payslips keep the pension they were actually paid with, so they still match. If you rejoin later, untick it while viewing the first payslip that has a deduction again.',
      '<strong>Student loan:</strong> only set a plan if you see a student loan deduction line on your payslip. If you repay by direct debit (not through your wages), leave this as None. The plan number is printed on your payslip next to the deduction — choose the matching one. If you can\'t find it, the plan follows where your student finance came from and when your course started: from <strong>England</strong>, Plan 2 for a course started September 2012 to July 2023, and Plan 5 from August 2023; from <strong>Wales</strong>, Plan 2 from September 2012; from England or Wales before September 2012, Plan 1; from <strong>Scotland</strong>, Plan 4; from <strong>Northern Ireland</strong>, Plan 1. (Plan 5 repayments only started on 6 April 2026, so it has no effect on 2025/26 periods.) A plan applies to every payslip — if one payslip didn\'t deduct it, tick <strong>Student loan was not deducted this period</strong> under Hours → Unusual deductions or corrections.',
      '<strong>Postgraduate loan:</strong> a separate tick, below the plan. If you have a postgraduate (master\'s/doctoral) loan it is repaid on top of any undergraduate plan, so you can have both a plan number selected and this ticked at once.',
      `<strong>London Allowance (£${TAX_YEARS[TAX_YEARS.length - 1].londonAllow.toFixed(2)}/period):</strong> a supplement paid alongside your hourly pay, included automatically — you don't need to enter it. The figure shown is the current one; like your hourly rate it <strong>steps when a pay award lands</strong>, and a past payslip keeps the allowance you were actually paid then.`,
      'Your hourly rate is set by your grade for each tax year — a past payslip always shows the rate you were actually paid then. Pension and hours are saved per individual period.',
    ],
  },
  accuracy: {
    title: 'Year to Date figures — why they help',
    tips: [
      'By default, the app divides your tax-free allowance equally across all 13 pay periods. This is usually accurate, but can drift if you had an unusually high or low pay period earlier in the year.',
      'Entering <strong>Year to Date figures</strong> gives a more accurate estimate based on everything you\'ve earned so far this tax year — usually much closer to your payslip, especially later in the year.',
      'Find <strong>"Taxable Pay"</strong> and <strong>"Tax Paid"</strong> in the <strong>Year to Date</strong> box at the bottom left of your payslip. Update them each time you get a new payslip.',
      'The card records <strong>which payslip</strong> the figures came from (it assumes your latest — correct it if you copied from an older one). They sharpen the estimate for the payslip <strong>right after</strong> that one; every other payslip is worked out on its own, with your tax-free allowance shared equally across the year as above, and the note on the card tells you which is in play. Update the figures each time a new payslip arrives.',
      'January payslip with your <strong>Holiday Pay Premium</strong> on it? Enter the confirmed figure in the Holiday Pay Premium card.',
    ],
  },
  hpp: {
    title: 'Holiday Pay Premium (HPP)',
    tips: [
      'When you take annual leave, Chiltern only pay your <strong>basic contracted rate</strong> — you miss out on overtime, rest day pay, and Sunday pay for those days.',
      'To compensate, Chiltern calculate a <strong>Holiday Pay Premium of 7.69%</strong> of your extra pay above basic hours (Saturday, overtime, rest day working, Sunday, bank-holiday and Boxing Day premiums) across the whole tax year. London Allowance is not included — it\'s paid every period anyway, including while you\'re on leave, so it needs no premium.',
      'This is paid as a <strong>single lump sum on a January payslip</strong> every year — it doesn\'t appear on any other payslip. The estimate builds up across all the periods you\'ve entered for the current tax year.',
      'On that January payslip a <strong>green note</strong> shows the estimated premium. It isn\'t added to your take-home until you tick <strong>"Add this to this payslip\'s take-home estimate"</strong> on the note — so it never changes your figure uninvited.',
      'When you move into the next tax year, the prior year\'s estimate carries forward into this card. Once your real January figure lands, enter the confirmed <strong>Holiday Pay Premium</strong> amount here to replace the estimate.',
    ],
  },
  backpay: {
    title: 'Pay Rise Back Pay — when to use it',
    tips: [
      'Use this when a pay award is <strong>backdated to 1 April</strong>. Chiltern calculate the rate difference across every period since April, then pay the total on one payslip.',
      'For a <strong>confirmed</strong> award the old and new rates are filled in and fixed, and the lump lands on the right payslip automatically. Once the payslip it lands on <strong>arrives</strong> — from its cut-off date, before payday — you can instead enter the exact amount printed on it, including for the current year\'s award. Only a future award that\'s agreed but not yet on payslips shows an editable estimate.',
      'The back pay isn\'t added to any payslip until you choose. On the payslip it\'s due to land, a <strong>green note</strong> appears — tick <strong>"Add this lump sum to this payslip\'s take-home estimate"</strong> to include it. Until then that payslip\'s take-home estimate leaves the lump out.',
      'The lump sum is taxed in the period it lands — if it pushes your income over a higher tax band that month, you may receive less than the gross figure shown.',
      // Moved here from the card's notice (18 Nov 2026), whose markup default it was — every path that
      // shows the notice writes its own words, so the one sentence on matching the payslip never showed.
      'On the payslip itself the back pay may not be one line: it can be spread across several — Basic Pay, Overtime, RDW, the London Allowance and so on — rather than printed as one figure. Added together, those parts should come close to the lump sum worked out here.',
      'Your Settings hourly rate updates by itself once an award is confirmed — there\'s nothing to apply by hand.',
    ],
  },
};
