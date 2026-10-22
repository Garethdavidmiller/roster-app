// paycalc-breakdown.test.mjs — tests for the two pure HTML builders extracted from calculate()
// (review item 20). These lock the result-card markup so a future edit to the summary/breakdown
// can't silently change what staff see. No mocks, no DOM; part of test:hygiene.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fmtHrsMins, buildSummaryRows, buildBreakdownRows, buildActualCheck, buildProvChips, buildActualComparison,
} from './paycalc-breakdown.js';

test('fmtHrsMins formats decimal hours as "Nh"/"Nh Mm"', () => {
    assert.equal(fmtHrsMins(8), '8h');
    assert.equal(fmtHrsMins(7.5), '7h 30m');
    assert.equal(fmtHrsMins(0), '0h');
    assert.equal(fmtHrsMins(1.25), '1h 15m');
});

// ── buildSummaryRows ────────────────────────────────────────────────────────────
const SUM_BASE = {
    _bpThisPeriod: 0, _hppForPeriod: 0, gross: 2000, grossWithBp: 2000,
    _bpIsEstimate: false, _hppIsEstimate: false, pension: 0, sacGross: 2000,
    usingCumulative: false, tax: 300, ni: 150, slLines: '', net: 1550,
};

test('buildSummaryRows: plain period → Total pay, tax, NI, take-home; no Regular/pension rows', () => {
    const html = buildSummaryRows(SUM_BASE);
    assert.ok(html.includes('<span class="lbl">Total pay</span><span class="val">£2,000.00</span>'));
    assert.ok(html.includes('Income Tax'));
    assert.ok(html.includes('National Insurance'));
    assert.ok(html.includes('Estimated take-home pay</span><span class="val">£1,550.00</span>'));
    assert.ok(!html.includes('Regular pay'), 'no Regular pay row without bp/hpp');
    assert.ok(!html.includes('Pension contribution'), 'no pension row when pension = 0');
});

test('buildSummaryRows: an over-collected year says a refund may be due — never a bare £0 tax', () => {
    // computeTax keeps the deduction at £0 and reports the over-collection; this is where it is SAID.
    const html = buildSummaryRows({ ...SUM_BASE, usingCumulative: true, tax: 0, taxRefund: 180.25 });
    assert.ok(html.includes('Income Tax'));
    assert.ok(html.includes('−£0.00'), 'the deduction line is still the £0 in the estimate');
    assert.match(html, /tax refund of about £180\.25 may be due on this payslip/);
    assert.match(html, /not included in this estimate/, 'and it says the figure above does not contain it');
    for (const quiet of [{}, { taxRefund: 0 }, { taxRefund: 0.004 }]) {
        assert.ok(!/refund/.test(buildSummaryRows({ ...SUM_BASE, ...quiet })), 'no refund → no line');
    }
});

test('buildSummaryRows: pension present adds the deduction + pay-after-pension rows', () => {
    const html = buildSummaryRows({ ...SUM_BASE, pension: 147.36, sacGross: 1852.64 });
    assert.ok(html.includes('Pension contribution</span><span class="val">−£147.36</span>'));
    assert.ok(html.includes('Pay after pension deduction</span><span class="val">£1,852.64</span>'));
});

test('buildSummaryRows: back pay + HPP → Regular pay + both extra rows + grossWithBp Total + take-home suffix', () => {
    const html = buildSummaryRows({
        ...SUM_BASE, _bpThisPeriod: 500, _hppForPeriod: 120, grossWithBp: 2620,
    });
    assert.ok(html.includes('Regular pay</span><span class="val">£2,000.00</span>'));
    assert.ok(html.includes('Back pay lump sum (pay award)</span><span class="val">+£500.00</span>'));
    assert.ok(html.includes('Holiday Pay Premium'));
    assert.ok(html.includes('<span class="val">+£120.00</span>'));
    assert.ok(html.includes('Total pay</span><span class="val">£2,620.00</span>'), 'Total uses grossWithBp');
    assert.ok(html.includes('<span class="sum-net-sub">includes back pay & HPP</span>'));
});

// ── The take-home qualifier is a SUB-LINE, not a suffix (v20.53) ─────────────────────────────────
// It used to be appended to the label: "Estimated take-home pay (inc. estimated back pay & HPP)".
// On a phone that wrapped to two lines and then ran straight into the £ figure, because `.sum-row`
// is space-between with (at the time) no gap. Reported from a real screen. The CSS gap fixes any
// long label touching its figure; keeping the qualifier off the headline is the other half, and it
// is the half a stylesheet cannot enforce — so it is pinned here.
test('buildSummaryRows: the take-home qualifier is a sub-line, never appended to the headline', () => {
    const html = buildSummaryRows({ ...SUM_BASE, _bpThisPeriod: 500, grossWithBp: 2500 });
    assert.ok(html.includes('<span class="sum-net-sub">includes back pay</span>'),
        'the qualifier must be its own element the stylesheet can size and colour');
    assert.ok(!/Estimated take-home pay \(/.test(html),
        'nothing may follow "Estimated take-home pay" on the headline itself');
});

test('buildSummaryRows: a plain period gets NO qualifier element at all', () => {
    // An empty sub-line would still occupy a row and push the figure off the headline.
    const html = buildSummaryRows({ ...SUM_BASE });
    assert.ok(!html.includes('sum-net-sub'), 'no qualifier element when there is nothing to qualify');
});

test('buildSummaryRows: each extra carries its OWN estimate flag', () => {
    // The old nested ternary read `_bpIsEstimate` for the combined case, so a CONFIRMED back pay
    // beside an ESTIMATED HPP was described as though both were confirmed — a money figure claiming
    // more certainty than it has, which is the one thing this card must not do.
    const html = buildSummaryRows({
        ...SUM_BASE, _bpThisPeriod: 500, _hppForPeriod: 120, grossWithBp: 2620,
        _bpIsEstimate: false, _hppIsEstimate: true,
    });
    assert.ok(html.includes('<span class="sum-net-sub">includes back pay & estimated HPP</span>'),
        'the estimated half must be named as estimated, and the confirmed half must not be');
});

test('buildSummaryRows: estimate flags add " — estimate"/"(estimated)" labels', () => {
    const html = buildSummaryRows({
        ...SUM_BASE, _bpThisPeriod: 500, _bpIsEstimate: true, _hppForPeriod: 120, _hppIsEstimate: true, grossWithBp: 2620,
    });
    assert.ok(html.includes('Back pay lump sum (pay award — estimate)'));
    assert.ok(html.includes('<span class="sum-est">(estimated)</span>'));
});

test('buildSummaryRows: cumulative tax adds the "adjusted from payslip" note; slLines injected verbatim', () => {
    const sl = '<div class="sum-row sum-ded"><span class="lbl">Student Loan</span><span class="val">−£30.00</span></div>';
    const html = buildSummaryRows({ ...SUM_BASE, usingCumulative: true, slLines: sl });
    assert.ok(html.includes('adjusted from payslip'));
    assert.ok(html.includes(sl), 'pre-rendered slLines passed through unchanged');
});

// ── buildBreakdownRows ──────────────────────────────────────────────────────────
const BD_BASE = {
    nonBhNorm: 140, rate: 21.49, gBasicNorm: 3008.6,
    satCapped: 0, r125: 26.86, gBasicSat: 0, bhCapped: 0, gBankHol: 0,
    bhOtHrs: 0, gBhOt: 0, oHrs: 0, gOvertime: 0, rHrs: 0, gRdw: 0,
    sHrs: 0, r150: 32.24, gSunday: 0, bHrs: 0, r300: 64.47, gBoxing: 0,
    peer: 0, gPeer: 0, LONDON: 286.1, otherAdj: 0, slSkip: false, plan: 'none',
    pgLoan: false, usingCumulative: false,
    _bpThisPeriod: 0, _bpIsEstimate: false, _hppForPeriod: 0, _hppIsEstimate: false,
};

test('buildBreakdownRows: bare period → only Mon–Fri basic + London Allowance', () => {
    const html = buildBreakdownRows(BD_BASE);
    assert.ok(html.includes('Basic pay — Mon–Fri (140h × £21.49)'));
    assert.ok(html.includes('London Allowance'));
    assert.ok(!html.includes('Saturday'));
    assert.ok(!html.includes('Overtime'));
    assert.ok(!html.includes('Sunday Working'));
});

test('buildBreakdownRows: each premium row appears only when its hours > 0', () => {
    const html = buildBreakdownRows({
        ...BD_BASE, satCapped: 8, gBasicSat: 214.88, oHrs: 4, gOvertime: 107.44,
        sHrs: 8, gSunday: 257.92, bHrs: 8, gBoxing: 515.76,
    });
    assert.ok(html.includes('Basic pay — Saturday (8h × £26.86)'));
    assert.ok(html.includes('Overtime (4h × £26.86)'));
    assert.ok(html.includes('Sunday Working (8h × £32.24)'));
    assert.ok(html.includes('Boxing Day Working (8h × £64.47)'));
    assert.ok(!html.includes('Bank Holiday Rostered'), 'bhCapped = 0 → no BH row');
});

test('buildBreakdownRows: training pluralises days; otherAdj shows sign', () => {
    const one = buildBreakdownRows({ ...BD_BASE, peer: 1, gPeer: 42.98 });
    assert.ok(one.includes('Training Days (1 day × 2h × £21.49)'));
    const many = buildBreakdownRows({ ...BD_BASE, peer: 3, gPeer: 128.94 });
    assert.ok(many.includes('Training Days (3 days × 2h × £21.49)'));
    // A negative adjustment gets no '+' prefix; fmt() renders the sign after the £ (£-12.50) —
    // this mirrors the original inline template exactly (byte-identical extraction).
    const neg = buildBreakdownRows({ ...BD_BASE, otherAdj: -12.5 });
    assert.ok(neg.includes('Other payroll adjustment</span><span class="b-val">£-12.50</span>'));
    const pos = buildBreakdownRows({ ...BD_BASE, otherAdj: 12.5 });
    assert.ok(pos.includes('Other payroll adjustment</span><span class="b-val">+£12.50</span>'));
});

test('buildBreakdownRows: SL-skip note only with an active plan; cumulative + bp/hpp extra rows', () => {
    assert.ok(!buildBreakdownRows({ ...BD_BASE, slSkip: true, plan: 'none' }).includes('Student Loan not deducted'),
        'slSkip with no plan → no note');
    assert.ok(buildBreakdownRows({ ...BD_BASE, slSkip: true, plan: 'plan2' }).includes('Student Loan not deducted this period'));
    assert.ok(buildBreakdownRows({ ...BD_BASE, usingCumulative: true }).includes('Tax adjusted using Year to Date figures'));
    const extras = buildBreakdownRows({ ...BD_BASE, _bpThisPeriod: 500, _bpIsEstimate: true, _hppForPeriod: 120, _hppIsEstimate: true });
    assert.ok(extras.includes('bd-extra'));
    assert.ok(extras.includes('Back pay lump sum (pay award — estimate)</span><span class="b-val">+£500.00</span>'));
    assert.ok(extras.includes('Holiday Pay Premium (estimated)</span><span class="b-val">+£120.00</span>'));
});

test('buildBreakdownRows: SL stopped-deducting note (v18.41) — active plan only, outranks the skip', () => {
    // The OBSERVABLE fact, never "repaid in full" (v19.27): the Student Loans Company routinely
    // moves the last chunk to direct debit, so a loan can stop being deducted while still owed. The
    // summary row and the Settings label said so already; this row still claimed the opposite.
    const LINE = 'Student Loan — not deducted from this payslip onwards';
    const paidOff = buildBreakdownRows({ ...BD_BASE, slPaidOff: true, plan: 'plan1' });
    assert.ok(paidOff.includes(LINE));
    assert.ok(!/repaid/i.test(paidOff), 'the breakdown never claims the loan was repaid');
    assert.ok(!buildBreakdownRows({ ...BD_BASE, slPaidOff: true, plan: 'none' }).includes(LINE),
        'paid-off with no active loan → no note');
    const both = buildBreakdownRows({ ...BD_BASE, slPaidOff: true, slSkip: true, plan: 'plan1' });
    assert.ok(both.includes(LINE) && !both.includes('not deducted this period'),
        'the cutover outranks the one-off skip — one note, not two');
    assert.ok(!buildBreakdownRows({ ...BD_BASE, plan: 'plan1' }).includes(LINE),
        'omitted param defaults to still-repaying');
});

// "Check against your payslip" verdict (v18.42 — review item 3). Bands are the documented
// tolerances: ≤£2 = the cumulative-PAYE drift the payslip regression allows; larger gaps point at
// the known less-accurate cases rather than alarming.
test('buildActualCheck: quiet when empty; band boundaries; direction named', () => {
    assert.equal(buildActualCheck(0, 2900), '', 'no figure → nothing rendered');
    assert.match(buildActualCheck(2900, 2900), /Matches your payslip exactly/);
    assert.match(buildActualCheck(2901.50, 2900), /within £1\.50/, 'inside the £2 rounding band');
    assert.match(buildActualCheck(2901.50, 2900), /check-ok/);
    const near = buildActualCheck(2910, 2900);
    assert.match(near, /£10\.00 more/, 'direction: payslip pays more');
    assert.match(near, /Year to Date/, 'points at the sharpening lever');
    const far = buildActualCheck(2800, 2900);
    assert.match(far, /£100\.00 less/, 'direction: payslip pays less');
    assert.match(far, /absence, back pay, a payroll correction, or a student loan deduction that isn't on the payslip/);
    assert.ok(!/check-ok/.test(far), 'a large gap is not a green line');
});

// THE ESTIMATE'S OWN SETTINGS COME FIRST (v24.87). A colleague's estimate ran £111.51 over her
// payslip with every hour right — no pension and the default tax code where her payslip showed
// £151.86 and 1182L — and this line sent her to hours, absence and back pay. Organised by what a
// wrong line COSTS: naming the wrong figure sends the member to correct something already right;
// naming none (the old line) leaves the actual cause unmentioned.
test('buildActualCheck: a big gap names THIS estimate\'s tax code and pension, before anything else', () => {
    const text = (/** @type {string} */ h) => h.replace(/<[^>]+>/g, '');
    // Her case: £3,114.48 paid, £3,225.99 estimated, with no pension and the default code.
    const hers = text(buildActualCheck(3114.48, 3225.99, { taxCode: '1257L', pension: 0 }));
    assert.match(hers, /£111\.51 less/);
    assert.match(hers, /this estimate uses tax code 1257L and no pension\./, 'the two settings, as facts about the estimate');
    assert.match(hers, /Tax Code and the "Smart RPS CR Scheme" line on your payslip/, 'where each is printed — the payslip\'s own words');
    assert.match(hers, /Your Settings/, 'and where to change them');
    assert.ok(hers.indexOf('tax code 1257L') < hers.indexOf('hours are complete'), 'the settings come FIRST');
    assert.match(hers, /If they match, check this payslip's hours are complete/, 'the old checks follow, conditionally');
    assert.match(hers, /absence, back pay, a payroll correction, or a student loan deduction that isn't on the payslip/);

    // A pension that IS being taken is stated as its amount — never as "no pension".
    const taken = text(buildActualCheck(2800, 2900, { taxCode: '1182L', pension: 151.86 }));
    assert.match(taken, /this estimate uses tax code 1182L and a pension of £151\.86\./);
    assert.doesNotMatch(taken, /no pension/);
});

test('buildActualCheck: a close gap names the tax code first — before the Year to Date advice', () => {
    // A wrong code is exactly this size (£23.20 on hers), and Year to Date figures make a wrong code
    // WORSE — so the order of the two sentences is the point, not the wording.
    const text = (/** @type {string} */ h) => h.replace(/<[^>]+>/g, '');
    const close = text(buildActualCheck(3114.48, 3137.68, { taxCode: '1257L', pension: 151.86 }));
    assert.match(close, /^Close — your payslip pays £23\.20 less than this estimate\./);
    assert.match(close, /this estimate's tax code, 1257L, matches the Tax Code on your payslip/);
    assert.ok(close.indexOf('1257L') < close.indexOf('Year to Date'), 'the code before the Year to Date figures');
    assert.match(close, /If it does, small gaps usually come from tax adjustments; entering your Year to Date figures/);
    assert.doesNotMatch(close, /pension/, 'a pension is never a gap this small — naming it would be noise');
});

test('buildActualCheck: nothing typed into the Tax Code box reaches the page as markup', () => {
    // A real PAYE code is letters and digits; anything else is described, never quoted.
    for (const [actual, estimated] of [[2800, 2900], [2890, 2900]]) {
        const html = buildActualCheck(actual, estimated, { taxCode: '12<img src=x>57L', pension: 0 });
        assert.doesNotMatch(html, /<img/, `£${estimated - actual} gap: the typed markup is not echoed`);
        assert.match(html, /the tax code in Your Settings/, `£${estimated - actual} gap: it is described instead`);
    }
});

test('buildActualCheck: told nothing about the settings, it says what it said before v24.87', () => {
    // The two lines above are only as good as the call site passing the REAL figures — that is
    // pinned in a browser (e2e/paycalc.spec.js). Here: no settings, no claims about them.
    assert.doesNotMatch(buildActualCheck(2800, 2900), /tax code|pension/i);
    assert.doesNotMatch(buildActualCheck(2910, 2900), /tax code|pension/i);
    assert.equal(buildActualCheck(2900, 2900, { taxCode: '1257L', pension: 0 }),
        buildActualCheck(2900, 2900), 'an exact match has nothing to explain');
});

// Provenance chips (v18.44 — review item 1): the take-home £ names its sources; a normal payslip
// renders NOTHING.
test('buildProvChips: empty on a normal payslip; one chip per active source', () => {
    assert.equal(buildProvChips({ usingCumulative: false }), '', 'normal payslip → no chips at all');
    const cum = buildProvChips({ usingCumulative: true, srcLabel: '6 Jun' });
    assert.match(cum, /✓ Cumulative tax · from your 6 Jun payslip/);
    assert.ok(!/prov-chip--add/.test(cum), 'method chips are neutral, not gold');
    assert.match(buildProvChips({ usingCumulative: true }), /✓ Cumulative tax</, 'no source label → no dangling "from your"');
    const all = buildProvChips({ usingCumulative: true, srcLabel: '18 Dec', bpAmount: 824, hppAmount: 312.5, hoursFromCalendar: true });
    assert.match(all, /\+ £824\.00 back pay/);
    assert.match(all, /\+ £312\.50 Holiday Pay Premium/);
    assert.match(all, /Hours from calendar/);
    assert.equal((all.match(/prov-chip--add/g) || []).length, 2, 'the two money adds are the gold chips');
    assert.equal((all.match(/class="prov-chip/g) || []).length, 4, 'four chips when everything is active');
    assert.equal(buildProvChips({ usingCumulative: false, bpAmount: 0, hppAmount: 0 }), '', 'zero amounts render nothing');
});

// ── The CSS half of the same fix (v20.53) ───────────────────────────────────────────────────────
// The markup half is pinned above. This is the other half, and it is the one with the wider blast
// radius: `.sum-row` is `justify-content: space-between`, so WITHOUT a gap any label that grows to
// fill the row ends up touching its £ figure — "(pay award — estimate)+£977.69", with no space at
// all, was the worst of them. The visual baselines DO render the result card — but only ever with
// short labels, and `space-between` puts a label and its figure at opposite ends until the label
// grows enough to reach across, so every baseline passed unchanged through both the bug and the fix.
// `paycalc result card — with back pay` in e2e/visual.spec.js now captures the long-label state
// specifically; this test is the cheap always-on half, since no behavioural test can tell "beside"
// from "touching".
test('paycalc.css keeps a gap between a summary label and its figure', () => {
    const css = readFileSync(new URL('./paycalc.css', import.meta.url), 'utf8');
    const rule = css.match(/\.sum-row\s*\{[^}]*\}/);
    assert.ok(rule, '.sum-row rule not found — this test is checking nothing');
    assert.match(rule[0], /gap:\s*\d/,
        '.sum-row must declare a gap: space-between alone lets a long label run into the money figure');
    assert.match(rule[0], /space-between/,
        'if the row stops being space-between, re-derive whether the gap is still the right guard');
});

test('paycalc.css never lets a summary figure wrap or shrink', () => {
    // The figure is the point of the row. Allowing it to give up width to a long label is how
    // "£4,076.81" would end up broken across two lines.
    const css = readFileSync(new URL('./paycalc.css', import.meta.url), 'utf8');
    const rule = css.match(/\.sum-row\s+\.val\s*\{[^}]*\}/);
    assert.ok(rule, '.sum-row .val rule not found');
    assert.match(rule[0], /white-space:\s*nowrap/);
    assert.match(rule[0], /flex-shrink:\s*0/);
});

// ── buildActualComparison (v22.07) — the estimate-vs-payslip table ─────────────────────────────
describe('buildActualComparison', () => {
    const EST = { gross: 3808.87, pension: 151.86, tax: 538.80, ni: 215.48, net: 2907.23 };

    test('net alone renders NOTHING — the verdict line owns that case, and a one-row echo of it is noise', () => {
        assert.equal(buildActualComparison({ actual: { gross: null, pension: null, tax: null, ni: null, net: 2907.23 }, estimate: EST }), '');
    });

    test('only the lines the member typed render — an absent figure is not a £0 claim', () => {
        const html = buildActualComparison({ actual: { gross: 3808.87, pension: null, tax: 540.20, ni: null, net: null }, estimate: EST });
        assert.match(html, /Total pay/);
        assert.match(html, /Income Tax/);
        assert.ok(!/Pension contribution/.test(html));
        assert.ok(!/National Insurance/.test(html));
        assert.ok(!/Take-home/.test(html));
    });

    test('the difference is signed actual-minus-estimate, and an exact match reads as a dash', () => {
        const html = buildActualComparison({ actual: { gross: 3808.87, pension: null, tax: 540.20, ni: 210.48, net: null }, estimate: EST });
        assert.match(html, /cmp-same">—</);                       // gross matches → dash, muted
        assert.match(html, /cmp-diff">\+£1\.40</);               // payslip tax is MORE
        assert.match(html, /cmp-diff">−£5\.00</);                 // payslip NI is LESS
    });

    test('the table explains NOTHING — no cause words ever appear', () => {
        const html = buildActualComparison({ actual: { gross: 3500, pension: 100, tax: 600, ni: 200, net: 2600 }, estimate: EST });
        for (const banned of ['usually', 'check', 'because', 'adjust', 'correction']) {
            assert.ok(!html.toLowerCase().includes(banned), `cause-guessing word "${banned}" leaked into the table`);
        }
    });
});
