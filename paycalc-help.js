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
      'If your name is in the roster, a gold hint card appears at the top of this section showing your special shifts for the period — Saturday, Sunday, bank holiday, bank holiday overtime, overtime, rest day working (RDW), and Boxing Day. Tap a category row to fill just that one from the roster. Tap <strong>Fill from calendar</strong> to fill every category in one go — once you\'ve typed values, the same button reads <strong>Replace with calendar values</strong> as a reminder it will overwrite them (tap "Clear all entries" to undo). Filled fields turn gold; the highlight clears as soon as you edit them. When online, the counts include shift changes recorded by admin, not just the base roster. One thing it will not guess: an ordinary weekday you worked on what should have been a rest day — a swap pays in ways the app cannot predict, so it is left for you to enter. It is deliberately cautious, and never invents a figure.',
      'Training, induction and assessment days pay as the day they replace, so a normal weekday training needs nothing here. A <strong>training rest-day</strong> pre-fills <strong>8 hours</strong> as a default — change it to the hours you actually did. It goes into the box the day itself calls for: normally RDW, but <strong>Bank Holiday Overtime</strong> if the day is a bank holiday, and the <strong>Boxing Day</strong> box on 26 December. If training ran past your rostered shift, put the extra time in the Overtime box.',
      'Only enter hours at a <strong>different rate</strong>: rostered Saturdays (time-and-a-quarter, 1.25×), overtime (time-and-a-quarter, 1.25×), rest days and unrostered Saturdays (1.25×), Sundays (time-and-a-half, 1.5×), Boxing Day (triple time, 3×).',
      'A Sunday you worked goes in <strong>Sunday Working</strong>, never in Rest Day Working — Sunday is uncontracted, so every Sunday hour is 1.5× whether or not it was in your roster. Your payslip calls it "RDW Sun 1.5", which is the one place the two look alike.',
      '<strong>Bank holiday rows</strong> appear automatically in periods that contain one. "Bank Holiday Rostered" is for contracted shifts on a bank holiday; "Bank Holiday Overtime" is for hours beyond your rostered shift on a bank holiday, or for working a rest day that happened to fall on one.',
      'Boxing Day rows only appear in the January payslip period — they\'re hidden the rest of the time. In January 2027 (P44), Boxing Day 3× applies to shifts worked on 26 Dec; the substitute bank holiday (Mon 28 Dec 2026) goes in Bank Holiday Rostered, not Boxing Day.',
      'The <strong>cut-off date</strong> is the last shift date counted in this pay period — shifts <em>on</em> it count. Only shifts <strong>after</strong> it go into the next period.',
      'Each entry updates the estimate instantly — no need to tap a calculate button.',
    ],
  },
  settings: {
    title: 'Your Settings — what everything means',
    tips: [
      `<strong>Hourly rate:</strong> set automatically by your grade — CEA £${GRADES.cea.rate.toFixed(2)}, CES £${GRADES.ces.rate.toFixed(2)}. When a pay award is confirmed the new rate applies on its own, and older payslips keep the rate you were actually paid at the time.`,
      '<strong>Tax code:</strong> shown at the top of your payslip (e.g. 1257L). It tells HMRC how much tax-free income you get. Most Marylebone staff are on 1257L. If you\'re unsure, check your payslip or contact payroll.',
      '<strong>Pension contribution:</strong> your payslip calls this "Smart RPS CR Scheme" — it\'s the same thing. <strong>Pension is saved separately for each period</strong> — so if yours changes mid-year, update it here and past periods will keep their own recorded amount. The label next to the field shows which period you\'re editing.',
      '<strong>Not in the pension scheme:</strong> tick this if you have opted out of or left the RPS, then pick the <strong>first payslip with no pension deduction</strong>. That date is the whole point of the control — earlier payslips keep the pension they were actually paid with, so they still match. If you rejoin later, untick it while viewing the first payslip that has a deduction again.',
      '<strong>Student loan:</strong> only set a plan if you see a student loan deduction line on your payslip. If you repay by direct debit (not through your wages), leave this as None. The plan number is printed on your payslip next to the deduction — choose the matching one. <strong>Most staff who started university after 2012 are on Plan 2.</strong> (Plan 5 repayments only started on 6 April 2026, so it has no effect on 2025/26 periods.)',
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
      'Find <strong>"Taxable Pay"</strong> and <strong>"Tax Paid"</strong> in the <strong>Year to Date</strong> box on your payslip (usually bottom-right). Update them each time you get a new payslip.',
      'The card records <strong>which payslip</strong> the figures came from (it assumes your latest — correct it if you copied from an older one). They sharpen the estimate for the payslip <strong>right after</strong> that one; other payslips use the standard method, and the note on the card tells you which is in play. Update the figures each time a new payslip arrives.',
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
      'For a <strong>confirmed</strong> award the old and new rates are filled in and fixed, and the lump lands on the right payslip automatically. Once the payslip it landed on has been <strong>paid</strong>, you can instead enter the exact amount printed on it — including for the current year\'s award. Only a future award that\'s agreed but not yet on payslips shows an editable estimate.',
      'The back pay isn\'t added to any payslip until you choose. On the payslip it\'s due to land, a <strong>green note</strong> appears — tick <strong>"Add this lump sum to this payslip\'s take-home estimate"</strong> to include it. Until then the calculator keeps using your current rate.',
      'The lump sum is taxed in the period it lands — if it pushes your income over a higher tax band that month, you may receive less than the gross figure shown.',
      'Your Settings hourly rate updates by itself once an award is confirmed — there\'s nothing to apply by hand.',
    ],
  },
};
