// @ts-check
/**
 * paycalc-inventory.js — what a stored pay key IS, and what a set of them adds up to.
 *
 * Owns: the classification of every `pcPrefix()` key into a KIND, and the member-facing inventory
 *   built from that (payslips, tax years, which features have figures saved).
 * Does NOT own: the key BUILDERS (paycalc-migrations.js / paycalc-settings.js / paycalc-roster-hint.js),
 *   the backup format (paycalc-transfer.js), or any DOM (paycalc-transfer-card.js).
 * Edit here for: a new key kind, or how an inventory is worded.
 *
 * ── WHY THIS EXISTS: THE COUNT WAS WRONG AND NOTHING COULD SEE IT (v22.14, external review) ─────
 *
 * `summarise()` in paycalc-transfer.js derived "N payslips across M tax years" from a hand-written
 * regex listing five key types — `hpp_est|hpp_mode|bp_state|ytd_pay|ytd_tax`. Nine key types are
 * per-tax-year. It could not see `hpp_actual`, `hpp_inc`, `ytd_src` or `setup_<year>`, so a member
 * whose only 2025/26 data was a confirmed setup and a recorded HPP was told the backup held
 * "1 tax year" when it held two — on the one card whose entire job is to state what you are about
 * to carry to a new phone. Nothing failed; the number was simply smaller than the truth.
 *
 * That is the same defect this repo keeps meeting: **a hand-maintained list restating a fact that
 * lives somewhere else.** The fix is not a longer regex — it is a single classifier plus a parity
 * test that drives the REAL key builders (`periodKey`, `hppActualKey`, `settingsKey`, `snapKey`, …)
 * and asserts every key they produce lands on a known kind. A key type added later fails that test
 * instead of quietly falling out of a count.
 *
 * ── THE THREE RULES ────────────────────────────────────────────────────────────────────────────
 *
 * 1. **An unrecognised key is `unknown`, never dropped and never guessed.** A backup made by a
 *    later app version will contain kinds this one has never heard of, and they must survive the
 *    round trip untouched — which is exactly what the prefix-scan selection already guarantees.
 *    Classification is for DESCRIBING, never for filtering: nothing here decides what is carried.
 *
 * 2. **Only a kind declared `structured` is ever JSON-parsed.** `code` holds a tax code (`1257L`)
 *    and `rate` holds `21.49`; neither is JSON, and parsing them to test for damage would report
 *    every healthy device as corrupt. The damage preflight asks only the kinds that genuinely hold
 *    a JSON blob.
 *
 * 3. **A tax year is anchored `\d{4}_\d{2}` at the END of the tail.** `setup_years_migrated` is a
 *    `setup_*` key that is not a year, and `ytd_pay` (member-level, pre-per-year) is a prefix of
 *    `ytd_pay_2026_27`. Longest-match-first ordering plus the anchor keeps those three apart.
 */

/**
 * The kinds, in the order a member would want them read back. Each entry declares:
 *   `test`       — a predicate on the key TAIL (the part after `pcPrefix()`)
 *   `label`      — how the group is named on screen, already plural-neutral
 *   `structured` — true when the stored value is a JSON blob, so the damage preflight may parse it.
 *                  It may also be a PREDICATE on the tail, for a kind that is mixed: `pension`
 *                  covers an amount (`21.49`), a retired boolean, and `pension_timeline`, which is
 *                  a JSON array; `hpp` covers three plain figures and `hpp_mode_<year>`, the JSON
 *                  blob holding the amount source and the member's own typed premium. A predicate
 *                  keeps that in the one table rather than starting a second list of exceptions
 *                  beside it — which is the shape of the defect this module exists to end.
 *
 * Order matters: the first match wins, so the per-year forms sit above their member-level
 * namesakes (`ytd_pay_2026_27` before `ytd_pay`). Several kinds carry BOTH forms, because the
 * pre-per-year keys are still readable on any device that has not run their migration — and a
 * backup taken there carries them.
 *
 * There is no `perYear` flag: `taxYearOf` answers that from the tail itself, and a second
 * declaration of the same fact is the shape of the bug this module exists to end.
 *
 * @type {{ id: string, label: string, test: (tail: string) => boolean,
 *          structured?: boolean | ((tail: string) => boolean) }[]}
 */
export const KEY_KINDS = [
    { id: 'payslip',  label: 'payslip figures',          structured: true, test: t => /^p\d+$/.test(t) },
    { id: 'snapshot', label: 'roster-suggested figures', structured: true, test: t => /^snap_\d+$/.test(t) },
    { id: 'hpp',      label: 'Holiday Pay Premium', structured: t => t.startsWith('hpp_mode_'),
                                                                           test: t => /^hpp_(est|actual|inc|mode)_\d{4}_\d{2}$/.test(t) },
    { id: 'backpay',  label: 'back pay',                 structured: true, test: t => /^bp_state(_\d{4}_\d{2})?$/.test(t) },
    { id: 'ytd',      label: 'Year to Date figures',                       test: t => /^ytd_(pay|tax|src)_\d{4}_\d{2}$/.test(t) || /^ytd_(pay|tax)$/.test(t) },
    { id: 'yearSetup',label: 'tax year setup',                             test: t => /^setup_\d{4}_\d{2}$/.test(t) },
    { id: 'pension',  label: 'pension', structured: t => t === 'pension_timeline',
                                                                           test: t => /^pension(_optout|_timeline)?$/.test(t) },
    { id: 'actuals',  label: 'payslip comparison',       structured: true, test: t => t === 'actuals' },
    { id: 'settings', label: 'your settings',                              test: t => /^(rate|rates|grade|grade_from|grade_kept|grade_note|code|sl|pg_loan|sl_paid_off|setup|setup_years_migrated)$/.test(t) },
];

/** Resolve a kind's `structured` flag, which may be a predicate on the tail. */
function isStructured(/** @type {any} */ hit, /** @type {string} */ tail) {
    if (!hit || !hit.structured) return false;
    return typeof hit.structured === 'function' ? hit.structured(tail) : true;
}

/** `bp_state_2026_27` → `2026/27`. Returns '' when the tail carries no year. */
function taxYearOf(/** @type {string} */ tail) {
    const m = /_(\d{4})_(\d{2})$/.exec(tail);
    return m ? `${m[1]}/${m[2]}` : '';
}

/**
 * Classify one key tail. The single authority — `summarise`, the inventory and the damage
 * preflight all ask this, so they can never disagree about what a key is.
 *
 * @param {string} tail the key with `pcPrefix()` already removed
 * @returns {{ kind: string, label: string, taxYear: string, period: number|null, structured: boolean }}
 */
export function classifyPayKey(tail) {
    const hit = KEY_KINDS.find(k => k.test(tail));
    const period = /^(?:p|snap_)(\d+)$/.exec(tail);
    return {
        kind: hit ? hit.id : 'unknown',
        label: hit ? hit.label : 'something this version does not recognise',
        taxYear: taxYearOf(tail),
        period: period ? Number(period[1]) : null,
        structured: isStructured(hit, tail),
    };
}

/**
 * Name ONE entry the way a message about it should read — "payslip 16", "back pay 2026/27" —
 * rather than by its storage key. A damage notice exists to say WHICH figures did not survive, and
 * `myb_pc_gmiller_bp_state_2026_27` does not answer that for the person reading it.
 *
 * The payslip number is the app's own internal period number, not the P-number printed on a real
 * payslip. It is used because it DISTINGUISHES one saved payslip from another, which is all a
 * damage notice needs; translating it to a date would need the period grid this module has no
 * business holding.
 *
 * @param {string} tail
 * @returns {string}
 */
export function describePayKey(tail) {
    const c = classifyPayKey(tail);
    if (c.kind === 'payslip')  return `payslip ${c.period}`;
    if (c.kind === 'snapshot') return `roster-suggested figures for payslip ${c.period}`;
    if (tail === 'pension_timeline') return 'your pension history';
    return c.taxYear ? `${c.label} ${c.taxYear}` : c.label;
}

/**
 * What a set of keys adds up to, in the terms the card speaks.
 *
 * `taxYears` is a sorted LIST, not a count: naming 2025/26 and 2026/27 answers "is my old year in
 * here?", which a bare "2" does not — and that question is the whole reason somebody opens this
 * card before switching phones.
 *
 * @param {string[]} keys full keys, all under `prefix`
 * @param {string} prefix `pcPrefix()`
 * @returns {{ periods: number, taxYears: string[], groups: {id:string,label:string,count:number}[],
 *             unknown: number, keys: number }}
 */
export function inventoryOf(keys, prefix) {
    /** @type {Map<string,{id:string,label:string,count:number}>} */
    const groups = new Map();
    const years = new Set();
    let periods = 0, unknown = 0;

    for (const k of keys) {
        const c = classifyPayKey(k.slice(prefix.length));
        if (c.kind === 'payslip') periods++;
        if (c.kind === 'unknown') unknown++;
        if (c.taxYear) years.add(c.taxYear);
        const g = groups.get(c.kind) || { id: c.kind, label: c.label, count: 0 };
        g.count++;
        groups.set(c.kind, g);
    }

    // Group order follows KEY_KINDS, so the reading order is stable between devices and runs.
    const order = KEY_KINDS.map(k => k.id).concat('unknown');
    return {
        periods,
        taxYears: [...years].sort(),
        groups: [...groups.values()].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
        unknown,
        keys: keys.length,
    };
}

/**
 * Which of the STRUCTURED entries will not parse into the object (or list) their reader expects —
 * i.e. which figures are damaged. Parsing alone was not enough: `null` and a bare number are valid
 * JSON, and an object-reader cannot use either (`JSON.parse('null').mode` throws), while no
 * structured key this app writes ever holds anything but an object or a list.
 *
 * ── WHY THIS REPORTS RATHER THAN REFUSES ───────────────────────────────────────────────────────
 *
 * The review that prompted this asked for a preflight that refuses a restore, naming what is
 * damaged. It names it; it does not refuse, and the difference matters in the direction that hurts.
 * A backup is frequently the member's ONLY remaining copy — a new phone, a cleared browser, a
 * changed web address — so refusing the whole file over one unparseable payslip hands them nothing
 * at all, while the damage itself is already recoverable and VISIBLE once restored: `parseSavedPeriod`
 * surfaces a corrupt period rather than dropping it, which is this app's standing no-silent-caps
 * posture. So the member is told which figures did not survive, and decides.
 *
 * A structurally wrong FILE is a different thing and is still refused outright, by `validateBackup`:
 * unreadable JSON, a foreign format, a non-string value, a key that is not ours.
 *
 * @param {Record<string,string>} entries
 * @param {string} prefix the entries' OWN prefix (the source namespace, pre-rekeying)
 * @returns {{ key: string, tail: string, label: string }[]}
 */
export function damagedEntries(entries, prefix) {
    /** @type {{ key: string, tail: string, label: string }[]} */
    const bad = [];
    for (const [k, v] of Object.entries(entries)) {
        const tail = k.slice(prefix.length);
        const c = classifyPayKey(tail);
        if (!c.structured) continue;
        let usable = false;
        try { const parsed = JSON.parse(v); usable = parsed !== null && typeof parsed === 'object'; } catch { /* unreadable */ }
        if (!usable) bad.push({ key: k, tail, label: describePayKey(tail) });
    }
    return bad;
}

/**
 * The inventory as lines a member reads. Pure so the wording is testable without a DOM.
 *
 * @param {ReturnType<typeof inventoryOf>} inv
 * @returns {string[]}
 */
export function inventoryLines(inv) {
    /** @type {string[]} */
    const lines = [];
    if (inv.periods) lines.push(`${plural(inv.periods, 'payslip')} of entered figures`);
    if (inv.taxYears.length) lines.push(capitalise(taxYearsPhrase(inv.taxYears)));
    for (const g of otherGroups(inv)) {
        lines.push(g.id === 'unknown'
            ? `${unknownPhrase(g.count)} (they will be carried across unchanged)`
            : capitalise(g.label));
    }
    return lines;
}

/**
 * The same inventory in ONE line and a chip — Settings' Pay Calculator Data card (settings review,
 * Nov 2026). The card counted payslips and tax years only, so a member holding pension history, their
 * settings or back pay with no payslip was told "None saved", and the Install card's "copy your
 * figures first" step was hidden from the one person it was for. It reads every kind now, in the
 * words of `inventoryLines` above (the phrases are shared), so the two cards cannot describe one
 * device differently.
 *
 * @param {ReturnType<typeof inventoryOf>} inv
 * @returns {{ any: boolean, line: string, chip: string }} `any` — is anything stored at all (an
 *   unrecognised key counts: a backup carries it); `line` — what is stored, "" when nothing is;
 *   `chip` — the one datum for the collapsed header.
 */
export function inventorySummary(inv) {
    const parts = [];
    if (inv.periods) parts.push(plural(inv.periods, 'payslip'));
    if (inv.taxYears.length) parts.push(taxYearsPhrase(inv.taxYears));
    for (const g of otherGroups(inv)) parts.push(g.id === 'unknown' ? unknownPhrase(g.count) : g.label);
    const any = inv.keys > 0;
    const chip = inv.periods ? plural(inv.periods, 'payslip')
        : inv.taxYears.length ? plural(inv.taxYears.length, 'tax year')
        : any ? 'Saved' : 'None saved';
    return { any, line: capitalise(parts.join(' · ')), chip };
}

// ── The phrases both readings share ────────────────────────────────────────────────────────────
/** "1 payslip", "2 payslips". @param {number} n @param {string} w */
function plural(n, w) { return `${n} ${w}${n === 1 ? '' : 's'}`; }
/** @param {string} s */
function capitalise(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
/** "a", "a and b", "a, b and c" — a bare join reads as "2025/26 and 2026/27 and 2027/28" the moment a
 *  third tax year exists, which it will every April. @param {string[]} xs */
function list(xs) { return xs.length < 2 ? (xs[0] || '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`; }
/** "tax year 2026/27", "tax years 2025/26 and 2026/27". @param {string[]} years */
function taxYearsPhrase(years) { return `tax ${years.length === 1 ? 'year' : 'years'} ${list(years)}`; }
/** @param {number} n */
function unknownPhrase(n) { return `${plural(n, 'item')} this version does not recognise`; }
/**
 * The kinds named by their own label. Payslips and tax years are stated in their own terms first;
 * naming their key counts again would be the card talking about storage instead of about pay.
 * @param {ReturnType<typeof inventoryOf>} inv
 */
function otherGroups(inv) { return inv.groups.filter(g => g.id !== 'payslip' && g.id !== 'yearSetup'); }
