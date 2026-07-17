// @ts-check
/**
 * paycalc-help.js — Help tip content for the Pay Calculator lightboxes.
 *
 * Pure data — no DOM, no Firebase, no localStorage.
 * Keys match the data-help attribute on each .help-btn in paycalc.html.
 * Tips support <strong> for emphasis — rendered via innerHTML in the lightbox.
 */

import { TAX_YEARS, GRADES } from './paycalc-calc.js';

export const HELP_CONTENT = {
  hours: {
    title: 'Your Hours — how it works',
    tips: [
      '<strong>Glossary:</strong> AL = Annual Leave · RDW = Rest Day Worked (you worked on your scheduled day off) · BH = Bank Holiday · CEA / CES = your pay grade · HPP = Holiday Pay Premium (annual lump sum in January).',
      'Your contract includes <strong>140 hours per period</strong> at your base rate. You don\'t enter those — they\'re included automatically as basic pay. (CES and CEA are both 140 hours.)',
      'If your name is in the roster, a gold hint card appears at the top of this section showing your special shifts for the period — Saturday, Sunday, bank holiday, rest day working (RDW), and Boxing Day. Tap a category row to fill just that one from the roster. Tap <strong>Fill from calendar</strong> to fill every category in one go — once you\'ve typed values, the same button reads <strong>Replace with calendar values</strong> as a reminder it will overwrite them (tap "Clear all entries" to undo). Filled fields turn gold; the highlight clears as soon as you edit them. When online, all counts include any shift changes recorded by admin — the count reflects your actual roster, not just the base.',
      'Training, induction and assessment days pay as the day they replace, so a normal weekday training needs nothing here. A <strong>training rest-day</strong> pre-fills <strong>8 hours</strong> in the RDW box as a default — change it to the hours you actually did. If training ran past your rostered shift, put the extra time in the Overtime box.',
      'Only enter hours at a <strong>different rate</strong>: rostered Saturdays (time-and-a-quarter, 1.25×), overtime (time-and-a-quarter, 1.25×), rest days and unrostered Saturdays (1.25×), Sundays (time-and-a-half, 1.5×), Boxing Day (triple time, 3×).',
      '<strong>Bank holiday rows</strong> appear automatically in periods that contain one. "Bank Holiday Rostered" is for contracted shifts on a bank holiday; "Bank Holiday Overtime" is for working a rest day that happened to fall on a bank holiday.',
      'Boxing Day rows only appear in the January payslip period — they\'re hidden the rest of the time. In January 2027 (P60), Boxing Day 3× applies to shifts worked on 26 Dec; the substitute bank holiday (Mon 28 Dec 2026) goes in Bank Holiday Rostered, not Boxing Day.',
      'The <strong>cut-off date</strong> is the last shift date counted in this pay period. Shifts on or after that date go into the next period.',
      'Each entry updates the estimate instantly — no need to tap a calculate button.',
    ],
  },
  settings: {
    title: 'Settings — where to find things',
    tips: [
      `<strong>Hourly rate:</strong> shown on your payslip next to your name, or on your contract. CEA rate is currently £${GRADES.cea.rate.toFixed(2)}; CES rate is currently £${GRADES.ces.rate.toFixed(2)}. Both change each April with the pay award.`,
      '<strong>Tax code:</strong> shown at the top of your payslip (e.g. 1257L). It tells HMRC how much tax-free income you get. Most Marylebone staff are on 1257L. If you\'re unsure, check your payslip or contact payroll.',
      '<strong>Pension contribution:</strong> your payslip calls this "Smart RPS CR Scheme" — it\'s the same thing. <strong>Pension is saved separately for each period</strong> — so if yours changes mid-year, update it here and past periods will keep their own recorded amount. The label next to the field shows which period you\'re editing.',
      '<strong>Student loan:</strong> only set a plan if you see a student loan deduction line on your payslip. If you repay by direct debit (not through your wages), leave this as None. The plan number is printed on your payslip next to the deduction — choose the matching one. <strong>Most staff who started university after 2012 are on Plan 2.</strong> (Plan 5 repayments only started on 6 April 2026, so it has no effect on 2025/26 periods.)',
      '<strong>Postgraduate loan:</strong> a separate tick, below the plan. If you have a postgraduate (master\'s/doctoral) loan it is repaid on top of any undergraduate plan, so you can have both a plan number selected and this ticked at once.',
      `<strong>London Allowance (£${TAX_YEARS[TAX_YEARS.length - 1].londonAllow.toFixed(2)}/period):</strong> a fixed supplement paid to all Marylebone staff (CEA and CES). It's included automatically — you don't need to enter it.`,
      'Your hourly rate is saved per tax year — updating it for 2026/27 won\'t affect your 2025/26 figures. Pension and hours are saved per individual period.',
    ],
  },
  accuracy: {
    title: 'Improve accuracy — why it helps',
    tips: [
      'By default, the app divides your tax-free allowance equally across all 13 pay periods. This is usually accurate, but can drift if you had an unusually high or low pay period earlier in the year.',
      'Entering <strong>Year to Date figures</strong> gives a more accurate estimate based on everything you\'ve earned so far this tax year — usually much closer to your payslip, especially later in the year.',
      'Find <strong>"Taxable Pay"</strong> and <strong>"Tax Paid"</strong> in the <strong>Year to Date</strong> box on your payslip (usually bottom-right). Update them each time you get a new payslip.',
      'Once your January payslip arrives with the confirmed Holiday Pay Premium amount, enter it in the <strong>Holiday Pay Premium</strong> card below to replace the running estimate.',
    ],
  },
  hpp: {
    title: 'Holiday Pay Premium (HPP)',
    tips: [
      'When you take annual leave, Chiltern only pay your <strong>basic contracted rate</strong> — you miss out on overtime, rest day pay, and Sunday pay for those days.',
      'To compensate, Chiltern calculate a <strong>Holiday Pay Premium of 7.69%</strong> of your extra pay above basic hours (overtime, rest day working, Sundays, and London Allowance) across the whole tax year.',
      'This is paid as a <strong>single lump sum in your January payslip</strong> every year — it doesn\'t appear on any other payslip.',
      'The estimate builds across all periods you\'ve entered in the current tax year. When you move into the next tax year, the prior year\'s estimate carries forward into this card — enter the confirmed January payslip figure there to replace it.',
    ],
  },
  backpay: {
    title: 'Pay Rise Back Pay — when to use it',
    tips: [
      'Use this when a pay award is <strong>backdated to 1 April</strong>. Chiltern calculate the rate difference across every period since April, then pay the total on one payslip.',
      'Enter your <strong>old and new hourly rates</strong> and London Allowance figures. The calculator uses the hours you\'ve already entered for each period.',
      'The lump sum is taxed in the period it lands — if it pushes your income over a higher tax band that month, you may receive less than the gross figure shown.',
      'Tap <strong>"Apply new rate"</strong> to update Settings with the new rate so all future estimates use the correct figure.',
    ],
  },
};
