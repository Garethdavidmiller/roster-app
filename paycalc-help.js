// @ts-check
/**
 * paycalc-help.js — the Pay Calculator's `?` panels: what each card's help says.
 *
 * Pure data — no DOM, no Firebase, no localStorage.
 * Keys match the data-help attribute on each .help-btn in paycalc.html.
 *
 * THE SHAPE IS THE SHARED TIPS PANEL'S (owner-approved, Nov 2026): `{ title, sections: [{ heading?,
 * items: [{ icon, html }] }] }`, rendered by `initTipsLightbox` (tips-lightbox.js) into the same white
 * sheet every other page's `?` opens. These panels were a see-through glass sheet of bullet lists, the
 * one `?` in the app that let the page show through behind its own help text. `html` is set with
 * innerHTML, so it may carry <strong>; it is this module's own text, never a member's.
 *
 * Figures and dates are READ from the pay tables, never typed: the contracted hours, the rates, the
 * London Allowance and which January carries which year's premium all follow `paycalc-calc.js`.
 */

import { TAX_YEARS, GRADES } from './paycalc-calc.js';

// The contracted hours are read from the grade table, so this tip follows them if they ever change,
// and says so per grade if the two grades stop matching.
const _ceaContr = GRADES.cea.contr, _cesContr = GRADES.ces.contr;
const CONTRACT_TIP = _ceaContr === _cesContr
    ? `Your contract includes <strong>${_ceaContr} hours per period</strong> at your base rate. You don’t enter those — they’re included automatically as basic pay. (CES and CEA are both ${_ceaContr} hours.)`
    : `Your contract includes your grade’s hours per period at your base rate — <strong>CEA ${_ceaContr}, CES ${_cesContr}</strong>. You don’t enter those — they’re included automatically as basic pay.`;

// WHICH JANUARY CARRIES WHICH YEAR'S PREMIUM is computed, never written (review R3-1, Nov 2026). The
// panel said "a January payslip every year", and a member entering 2026/27 hours read that as January
// 2027 — whose payslip carries 2025/26's premium (invariant 4: the first January AFTER the year ends).
const _curTy  = TAX_YEARS[TAX_YEARS.length - 1];
const _prevTy = TAX_YEARS.length > 1 ? TAX_YEARS[TAX_YEARS.length - 2] : null;
const HPP_WHEN_TIP = 'It is paid as a <strong>single lump sum on the first January payslip after the tax year ends</strong> — '
    + 'it doesn’t appear on any other payslip. '
    + (_prevTy ? `So your January ${_prevTy.hppPaidJan} payslip carries the premium for ${_prevTy.label}, and the premium for ${_curTy.label} comes on your January ${_curTy.hppPaidJan} payslip. `
               : `So the premium for ${_curTy.label} comes on your January ${_curTy.hppPaidJan} payslip. `)
    + 'The estimate builds up across the payslips you’ve entered for that tax year.';

/** @typedef {{ icon: string, html: string }} HelpItem */
/** @typedef {{ heading?: string, items: HelpItem[] }} HelpSection */
/** @type {Record<string, { title: string, sections: HelpSection[] }>} */
export const HELP_CONTENT = {
  hours: {
    title: 'Your Hours — how it works',
    // The rule a member needs first leads (review R3-7): what to enter, then the special days, then the
    // calendar's help. The calendar tip was one 170-word block doing six jobs, ahead of the rule itself.
    sections: [
      { heading: 'What to enter', items: [
        { icon: '📖', html: '<strong>Glossary:</strong> AL = Annual Leave · RDW = Rest Day Working (you worked on your scheduled day off) · BH = Bank Holiday · CEA / CES = your pay grade · HPP = Holiday Pay Premium (annual lump sum in January).' },
        { icon: '📄', html: CONTRACT_TIP },
        { icon: '💷', html: 'Only enter hours at a <strong>different rate</strong>: rostered Saturdays (time-and-a-quarter, 1.25×), bank holidays (1.25×), overtime (time-and-a-quarter, 1.25×), rest days worked as extra, a Saturday off included (1.25×), Sundays (time-and-a-half, 1.5×), Boxing Day (triple time, 3×).' },
        { icon: '☑️', html: '<strong>None of those on a payslip?</strong> A week of ordinary weekday shifts has nothing to type, because your basic pay is worked out already. Tick <strong>No special-rate hours on this payslip</strong> under the rows, so the payslip counts as entered in <strong>This tax year so far</strong> and your Holiday Pay Premium. <strong>Fill these from your calendar</strong> ticks it for you on any payslip whose calendar has none. Type hours in later and the tick goes.' },
      ]},
      { heading: 'Sundays, bank holidays and Boxing Day', items: [
        { icon: '☀️', html: 'A Sunday you worked goes in <strong>Sunday Working</strong>, never in Rest Day Working — Sunday is uncontracted, so every Sunday hour is 1.5× whether or not it was in your roster. Your payslip calls it “RDW&nbsp;Sun&nbsp;1.5”, which is the one place the two look alike.' },
        { icon: '🏛️', html: '<strong>Bank holiday rows</strong> appear automatically on a payslip whose dates include one. “Bank Holiday Rostered” is for contracted shifts on a bank holiday; “Bank Holiday Overtime” is for hours beyond your rostered shift on a bank holiday, or for a rest day on one worked as extra. A bank holiday swapped for a weekday is “Bank Holiday Rostered”.' },
        { icon: '🎁', html: 'Boxing Day rows only appear on the January payslip — they’re hidden the rest of the time. Boxing Day 3× is for shifts worked on 26 December itself, whatever day of the week it falls on. A substitute bank holiday — the weekday given in place of a Christmas Day or Boxing Day that falls at a weekend — goes in Bank Holiday Rostered, not Boxing Day.' },
      ]},
      { heading: 'Filling from your calendar', items: [
        { icon: '🗓️', html: 'If your name is in the roster, a gold hint card at the top of this section shows your special shifts for the payslip — Saturday, Sunday, bank holiday, bank holiday overtime, overtime, rest day working (RDW) and Boxing Day. Select a category row to fill just that one from your calendar, or <strong>Fill from calendar</strong> to fill every category in one go. Once you’ve typed values, the same button reads <strong>Replace with calendar values</strong> as a reminder it will overwrite them, which can’t be undone. Filled fields turn gold; the highlight clears as soon as you edit them.' },
        // R3-7: the old "won't guess" line called an ordinary weekday on a rest day a swap that "pays in
        // ways the app cannot predict", right before saying a Saturday swap IS predicted — and blurred
        // weekday RDW records, which are counted (invariant 11).
        { icon: '🔍', html: 'When you’re online, the counts include the shift changes on your calendar — from the weekly roster, or recorded on the Admin page — not just the base roster. A Saturday or bank holiday recorded as an ordinary shift on a day off — a weekday swapped for it — counts as rostered (Rostered Saturday, Bank Holiday Rostered); one recorded as rest day working counts as RDW or Bank Holiday Overtime. One thing it will not guess: a weekday rest day recorded as an ordinary shift. That is usually a swap, which needs nothing here — but if you came in as extra work, enter the hours in Rest Day Working yourself. It is deliberately cautious, and never invents a figure.' },
      ]},
      { heading: 'Training and other days', items: [
        // R3-9: Christmas Day and Boxing Day can never be Training or Other days (owner, Jul and 21 Nov
        // 2026), so the panel no longer routes one to the Boxing Day box; and a bank holiday over-run is
        // Bank Holiday Overtime, as `resolveOtherPay` (override-utils.js) fills it.
        { icon: '🎓', html: 'Training, induction, assessment, team days, union courses and meetings — the <strong>Other</strong> days on your calendar — pay as the day they replace, so one on a normal weekday needs nothing here. The <strong>Peer Training</strong> row is only for days you spent training a colleague. A <strong>training rest-day</strong> pre-fills <strong>8 hours</strong> as a default — change it to the hours you actually did. It goes into the box the day itself calls for: normally RDW, or <strong>Bank Holiday Overtime</strong> if the day is a bank holiday. If training ran past your rostered shift, the extra time is overtime — <strong>Bank Holiday Overtime</strong> on a bank holiday, <strong>Overtime</strong> otherwise; Fill from calendar puts it there when the actual times are on your calendar.' },
      ]},
      { heading: 'Good to know', items: [
        { icon: '✂️', html: 'The <strong>cut-off date</strong> is the last shift date counted on this payslip — shifts <em>on</em> it count. Only shifts <strong>after</strong> it go on the next payslip.' },
        { icon: '⚡', html: 'Each entry updates the estimate instantly — no need to press a calculate button.' },
      ]},
    ],
  },
  settings: {
    title: 'Your Settings — what everything means',
    sections: [
      { heading: 'Your pay', items: [
        // The card's own hint names the two grades and stops (review, 15 Nov 2026): how a promotion is
        // priced is read here, on demand. A payslip that spans a promotion is priced by days (invariant 17).
        { icon: '🏷️', html: '<strong>Grade:</strong> CEA = Customer Experience Ambassador, CES = Customer Experience Supervisor. <strong>From the roster</strong> (the usual choice) uses the grade you held on each payslip’s days, so a promotion changes your rate from the day it starts — a payslip that spans it is priced by the days at each grade — and you don’t need to change anything. Pick CEA or CES yourself only if the roster has your grade wrong or you are acting up, then choose the first payslip it applies to.' },
        { icon: '💷', html: `<strong>Hourly rate:</strong> set automatically by your grade — CEA £${GRADES.cea.rate.toFixed(2)}, CES £${GRADES.ces.rate.toFixed(2)}. When a pay award is confirmed the new rate applies on its own, and older payslips keep the rate you were actually paid at the time.` },
        { icon: '🏙️', html: `<strong>London Allowance (£${_curTy.londonAllow.toFixed(2)} a payslip):</strong> a supplement paid alongside your hourly pay, included automatically — you don’t need to enter it. The figure shown is the current one; like your hourly rate it <strong>steps when a pay award lands</strong>, and a past payslip keeps the allowance you were actually paid then.` },
      ]},
      { heading: 'Deductions', items: [
        // R3-13: the field's own hint explains W1, M1 and X; the panel did not.
        { icon: '🧾', html: '<strong>Tax code:</strong> shown at the top of your payslip (e.g. 1257L). HMRC sets it, and it tells payroll how much of your pay is tax-free. Most Marylebone staff are on 1257L. If you’re unsure, check your payslip or contact payroll. If W1, M1 or X comes after the code, type that too — it means each payslip is taxed on its own, and Year to Date figures are then not used.' },
        // R3-4: "update it here and past periods will keep their own" suggested a typed figure carries
        // forward. It changes the payslip on screen only; every other payslip takes its own default from
        // PENSION_STEPS, which moves at each award by itself.
        { icon: '🏦', html: '<strong>Pension contribution:</strong> your payslip calls this “Smart RPS CR Scheme” — it’s the same thing. <strong>Pension is saved separately for each payslip</strong>: the app fills in the usual amount for each payslip and moves it by itself when a pay award changes it. If a payslip shows a different figure, type it in while viewing that payslip — it changes that payslip only, so repeat it on each one that differs. The label next to the field shows which payslip you’re editing.' },
        { icon: '🚫', html: '<strong>Not in the pension scheme:</strong> tick this if you have opted out of or left the Railways Pension Scheme (RPS), then pick the <strong>first payslip with no pension deduction</strong>. That date is the whole point of the control — earlier payslips keep the pension they were actually paid with, so they still match. If you rejoin later, untick it while viewing the first payslip that has a deduction again.' },
        { icon: '🎓', html: '<strong>Student loan:</strong> only set a plan if you see a student loan deduction line on your payslip. If you repay by direct debit (not through your wages), leave this as None. The plan number is printed on your payslip next to the deduction — choose the matching one. If you can’t find it, the plan follows where your student finance came from and when your course started: from <strong>England</strong>, Plan 2 for a course started September 2012 to July 2023, and Plan 5 from August 2023; from <strong>Wales</strong>, Plan 2 from September 2012; from England or Wales before September 2012, Plan 1; from <strong>Scotland</strong>, Plan 4; from <strong>Northern Ireland</strong>, Plan 1. (Plan 5 repayments only started on 6 April 2026, so it has no effect on 2025/26 payslips.) A plan applies to every payslip — if one payslip didn’t deduct it, tick <strong>Student loan was not deducted this period</strong> under Hours → Unusual deductions or corrections.' },
        { icon: '📚', html: '<strong>Postgraduate loan:</strong> a separate tick, below the plan. If you have a postgraduate (master’s/doctoral) loan it is repaid on top of any undergraduate plan, so you can have both a plan number selected and this ticked at once.' },
      ]},
    ],
  },
  accuracy: {
    title: 'Year to Date Figures — why they help',
    sections: [
      { heading: 'Why they help', items: [
        { icon: '⚖️', html: 'By default, the app divides your tax-free allowance equally across all 13 payslips of the year. This is usually accurate, but can drift if you had an unusually high or low payslip earlier in the year.' },
        { icon: '🎯', html: 'Entering <strong>Year to Date figures</strong> gives a more accurate estimate based on everything you’ve earned so far this tax year — usually much closer to your payslip, especially later in the year.' },
      ]},
      { heading: 'Where to find them', items: [
        { icon: '🧾', html: 'Find <strong>“Taxable Pay”</strong> and <strong>“Tax Paid”</strong> in the <strong>Year to Date</strong> box at the bottom left of your payslip. Update them each time you get a new payslip.' },
        // R3-5: the panel never said when the figures are NOT used — a code ending W1/M1/X (`readTaxCode`)
        // or figures that do not fit the tax code (invariant 18) — though the chip then reads "not in use".
        { icon: '📌', html: 'The card records <strong>which payslip</strong> the figures came from (it assumes the last payslip already paid — if you copied from a different one, even one about to be paid, choose it). They sharpen the estimate for the payslip <strong>right after</strong> that one only; every other payslip is worked out on its own, as above.' },
        { icon: '⚠️', html: 'They are <strong>not used</strong> when your tax code ends in W1, M1 or X (each payslip is then taxed on its own), or when they don’t fit the tax code in Your Settings — usually because that code differs from the one on the same payslip, or the figures came from a different payslip. The card then reads “not in use” and says why.' },
        { icon: '🏖️', html: 'January payslip with your <strong>Holiday Pay Premium</strong> on it? Enter the confirmed figure in the Holiday Pay Premium card.' },
      ]},
    ],
  },
  hpp: {
    title: 'Holiday Pay Premium (HPP) — what it is',
    sections: [
      { heading: 'What it is', items: [
        { icon: '🏖️', html: 'When you take annual leave, Chiltern only pays your <strong>basic contracted rate</strong> — you miss out on overtime, rest day pay and Sunday pay for those days.' },
        // R3-11: ALL overtime, RDW, Sunday, Bank Holiday Overtime and Boxing Day pay counts; only the
        // extra quarter on rostered Saturdays and bank holidays (`_varPayForPeriod`, paycalc-hpp.js).
        { icon: '➗', html: 'To compensate, Chiltern calculate a <strong>Holiday Pay Premium of 7.69%</strong> (4 weeks’ leave out of 52) of your pay above basic across the whole tax year: all of your overtime, rest day working, Sunday, Bank Holiday Overtime and Boxing Day pay, and the extra quarter on rostered Saturdays and bank holidays. London Allowance is not included — it’s paid every payslip anyway, including while you’re on leave, so it needs no premium.' },
        { icon: '📅', html: HPP_WHEN_TIP },
      ]},
      { heading: 'Using the card', items: [
        // R3-6: the Holiday Pay Premium notice sends members to the "Rough estimate" option, and the
        // panel never explained it. The three labels are the card's own (paycalc.html, #hppModeRow).
        { icon: '🧮', html: '<strong>Where should this year’s estimate come from?</strong> <strong>From your payslips in the calculator</strong> is the most accurate — it adds up the hours you’ve entered. <strong>Rough estimate from your Year to Date pay</strong> takes the Taxable Pay on your Year to Date Figures card, removes the basic pay and London Allowance the app expects, and takes 7.69% of the rest — useful for a year with no hours entered here. <strong>Enter the figure yourself</strong> if you already know it.' },
        { icon: '🟢', html: 'On the January payslip that carries it, a <strong>green note</strong> shows the estimated premium. It isn’t added to your take-home until you tick <strong>“Add this to this payslip’s take-home estimate”</strong> on the note — so it never changes your figure uninvited.' },
        { icon: '✅', html: 'When you move into the next tax year, the prior year’s estimate carries forward into this card. Once your real January figure lands, enter the confirmed <strong>Holiday Pay Premium</strong> amount here to replace the estimate.' },
      ]},
    ],
  },
  backpay: {
    title: 'Pay Rise Back Pay — how it works',
    sections: [
      { heading: 'How it works', items: [
        { icon: '📈', html: 'Use this when a pay award is <strong>backdated to 1 April</strong>. Chiltern calculate the rate difference across every payslip since April, then pay the total on one payslip.' },
        // R3-10: the CES rate before the 2025/26 award is not on record (`AWARD_RATES`, pre: null), so
        // that box stays blank and editable for a confirmed award (invariant 1).
        { icon: '🔒', html: 'For a <strong>confirmed</strong> award the old and new rates come from the record and are locked, and the lump lands on the right payslip automatically. A rate the app has no record of — the CES rate before the 2025/26 award — is left blank for you to type from an old payslip. Once the payslip it lands on <strong>arrives</strong> — from its cut-off date, before payday — you can instead enter the exact amount printed on it, including for the current year’s award. A future award that’s agreed but not yet on payslips shows an estimate you can adjust.' },
        { icon: '⚙️', html: 'Your Settings hourly rate updates by itself once an award is confirmed — there’s nothing to apply by hand.' },
      ]},
      { heading: 'On your payslip', items: [
        { icon: '🟢', html: 'The back pay isn’t added to any payslip until you choose. On the payslip it’s due to land, a <strong>green note</strong> appears — tick <strong>“Add this lump sum to this payslip’s take-home estimate”</strong> to include it. Until then that payslip’s take-home estimate leaves the lump out.' },
        // R3-3: payroll taxes cumulatively, so a lump reaches a higher rate only if the year's pay does;
        // without Year to Date figures this calculator prices the payslip on its own (`computeTax`).
        { icon: '🧾', html: 'Tax and National Insurance come off the lump like any pay, so you receive less than the figure shown here. Payroll works your tax out over the whole year so far, so the lump only reaches a higher tax rate if your pay for the year does. With Year to Date figures entered from the payslip before it, this calculator does the same; without them it works that payslip out on its own and may show more tax on the lump than payroll takes.' },
        // Moved here from the card's notice (18 Nov 2026), whose markup default it was — every path that
        // shows the notice writes its own words, so the one sentence on matching the payslip never showed.
        { icon: '🧩', html: 'On the payslip itself the back pay may not be one line: it can be spread across several — Basic Pay, Overtime, RDW, the London Allowance and so on — rather than printed as one figure. Added together, those parts should come close to the lump sum worked out here.' },
      ]},
    ],
  },
};
