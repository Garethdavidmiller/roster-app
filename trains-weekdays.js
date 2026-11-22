// @ts-check
/**
 * trains-weekdays.js — PURE: which weekdays a Trains figure is true of.
 *
 * ── ONE REAL DAY ────────────────────────────────────────────────────────────────────────────────
 *
 * Today's weekdays are not all alike: a few trains run only on Mondays and Fridays and their
 * partners only Tuesday to Thursday. Counted row by row, one train was two, and "146 a weekday" was
 * a day that never happens. So every COUNT is of one real day (`aRealDay`) — a weekday's is a
 * Tuesday-to-Thursday's, three days of five — while a station's train list still shows both
 * versions, each with its days.
 *
 * AND WHERE THE DAYS DISAGREE, THE PAGE NAMES THEM (external review, 18 Nov 2026). "Weekdays 145 →
 * 158, +13" was true of a Tuesday to Thursday and read as true of every weekday: on a Monday or Friday
 * 144 leave Marylebone, and they gain 14. At Princes Risborough the card said "1 fewer train a day"
 * of a Monday that has the same number. So the weekdays are grouped by what a figure says on each
 * (`weekdayGroups`): one group — the usual case — and nothing changes; more than one, and the
 * overview gives each its own row, and a station's card names the days its sentence is about and
 * says what the other days have. A count is still of one real day; it now says which.
 */

/** @typedef {import('./trains-change.js').TrainRow} TrainRow */

/** The five weekdays, Monday first: the days a weekday exception (trains-data.js, `days`) names. */
export const WEEKDAYS = /** @type {readonly ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']} */ (Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']));
/** @typedef {typeof WEEKDAYS[number]} Weekday */

/** The weekday whose trains are "one real day" (see the header): a Tuesday, as Wednesday and Thursday are. */
export const REAL_DAY = /** @type {Weekday} */ ('Tue');

/**
 * Whether a train with this weekday exception runs on one weekday — the three exceptions trains-data.js
 * documents, read from a row's `days` or a listed train's — or, for a row a station card adds itself
 * (`daysCode`), the weekdays it names, "Mon Tue Thu Fri". A code this does not know is counted every
 * day, as it always was; trains-stations.test.mjs fails on one in the data, so a new code from the
 * generator is taught here rather than miscounted.
 * @param {string|undefined} days  'MFO', 'MFX', 'WO', a list of weekdays, or '' for every day of its kind
 * @param {Weekday} day
 * @returns {boolean}
 */
export function runsOn(days, day) {
    switch (days) {
        case 'MFO': return day === 'Mon' || day === 'Fri';
        case 'MFX': return day !== 'Mon' && day !== 'Fri';
        case 'WO': return day === 'Wed';
        default: {
            const list = listedDays(days);
            return list ? list.includes(day) : true;
        }
    }
}

/** The weekdays a `daysCode` list names, or null when `days` is not one. @param {string|undefined} days */
function listedDays(days) {
    if (!days) return null;
    const list = days.split(' ');
    return list.every(d => WEEKDAYS.includes(/** @type {Weekday} */ (d))) ? /** @type {Weekday[]} */ (list) : null;
}

/**
 * Some weekdays as a train's `days`: the data's own code where one names exactly them ('' for all five),
 * else the days themselves, "Mon Tue Thu Fri", which `runsOn` reads. For a December train a station card
 * lists on the days nothing else carries it (trains-stations.js, `stationTrains`).
 * @param {readonly Weekday[]} days  in weekday order
 * @returns {string}
 */
export function daysCode(days) {
    const code = ['', 'MFO', 'MFX', 'WO'].find(c => WEEKDAYS.every(w => runsOn(c, w) === days.includes(w)));
    return code ?? days.join(' ');
}

/**
 * The trains of one real day of this kind (see the header): a weekday's figures are a Tuesday to
 * Thursday's, so a Mondays-and-Fridays-only train ('MFO') and a Wednesdays-only one ('WO') are left
 * out of every count. A day with no exceptions is returned whole.
 * @param {TrainRow[]} rows
 * @returns {TrainRow[]}
 */
export const aRealDay = (rows) => rows.filter(r => runsOn(r[3], REAL_DAY));

/**
 * One weekday's trains, its exceptions settled: the rows that run that day, each with its code cleared,
 * so `summarise` — whose `aRealDay` leaves a Mondays-and-Fridays row out — counts every one of them.
 * @param {TrainRow[]} rows
 * @param {Weekday} day
 * @returns {TrainRow[]}
 */
export const onWeekday = (rows, day) => rows.filter(r => runsOn(r[3], day))
    .map(r => r[3] ? /** @type {TrainRow} */ ([r[0], r[1], r[2], '', r[4]]) : r);

/**
 * The weekdays grouped by what a figure says on each (see the header): days on which `measure` gives
 * the same answer, today and from the change, share a group, in weekday order. One group means the
 * figure is true of every weekday; rows with no exception — a Saturday's, a Sunday's — are always one.
 * @template T
 * @param {TrainRow[]} nowRows
 * @param {TrainRow[]} decRows
 * @param {(rows: TrainRow[]) => T} measure  given ONE weekday's trains (`onWeekday`)
 * @returns {{ days: Weekday[], now: T, dec: T }[]}
 */
export function weekdayGroups(nowRows, decRows, measure) {
    if (![...nowRows, ...decRows].some(r => r[3])) return [{ days: [...WEEKDAYS], now: measure(nowRows), dec: measure(decRows) }];
    /** @type {{ key: string, days: Weekday[], now: T, dec: T }[]} */
    const groups = [];
    for (const day of WEEKDAYS) {
        const now = measure(onWeekday(nowRows, day)), dec = measure(onWeekday(decRows, day));
        const key = JSON.stringify([now, dec]);
        const same = groups.find(g => g.key === key);
        if (same) same.days.push(day); else groups.push({ key, days: [day], now, dec });
    }
    return groups.map(({ days, now, dec }) => ({ days, now, dec }));
}

/**
 * Weekdays in words: "Mondays and Fridays", "Tuesday to Thursday", "Wednesdays", "Weekdays" — or,
 * `short`, as a train's days are marked beneath its time (`daysLabel`): "Mon and Fri", "Tue to Thu".
 * Three days or more in a row are a range; anything else is a list.
 * @param {readonly Weekday[]} days  in weekday order
 * @param {{ short?: boolean }} [opts]
 * @returns {string}
 */
export function weekdayWords(days, { short = false } = {}) {
    const FULL = /** @type {Record<Weekday, string>} */ ({ Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday' });
    if (days.length === WEEKDAYS.length) return short ? 'Mon to Fri' : 'Weekdays';
    const at = days.map(d => WEEKDAYS.indexOf(d));
    if (days.length >= 3 && at.every((n, i) => i === 0 || n === at[i - 1] + 1)) {
        const one = (/** @type {Weekday} */ d) => short ? d : FULL[d];
        return `${one(days[0])} to ${one(days[days.length - 1])}`;
    }
    const names = days.map(d => short ? d : `${FULL[d]}s`);
    return names.length < 2 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
