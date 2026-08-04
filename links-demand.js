// @ts-check
/**
 * links-demand.js — the SERVICE a link design has to cover: trains per hour at Marylebone.
 *
 * `LINKS_DEC2026_PLAN.md` package 3. Pure — no DOM, no Firebase.
 *
 * WHY THIS EXISTS. The coverage heat map shows people on duty per hour against *nothing*. It can
 * tell you the shape of a design; it cannot tell you whether that shape is right, because the thing
 * it would have to be right ABOUT was never in the tool. "Does this meet business requirements" is
 * precisely cover versus service, so the service has to be in here too.
 *
 * WHAT COUNTS AS DEMAND (owner, Aug 2026 — this settled open question 1 of the plan):
 * **arrivals as well as departures, weighted by the length of those trains.** An arrival is a full
 * detrain and a departure is a dispatch; a 9-car train is not the same job as a 3-car one either
 * way. So every hour carries TWO figures — `mv` (movements) and `cars` — and both are kept.
 *
 * **Keeping both is not indecision.** They disagree about the weekday peak: by movement count the
 * morning and evening tie at 23, but by cars the evening is ~10% heavier (140 v 127) and the peak
 * hour moves from 08:00 to 17:00. That disagreement is the single most useful thing this data says,
 * and it is exactly what a blended score would destroy. `cars` drives the shading; `mv` is carried
 * so the panel can state it.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO — it does not score a design. There is no "covers 87%
 * of demand" figure and there should not be: cover-versus-service is a judgement with real
 * trade-offs (a quiet hour with an awkward turnaround may be the right call), and a percentage
 * invites it to be settled by a number. Same principle as `links-fatigue.js`: show, do not decide.
 *
 * THE ONE THING THAT MUST NOT CRY WOLF. Trains run at 00:0x and 05:5x on days the CEA link does not
 * staff, by design and not by oversight. If those render as uncovered demand, they do so on EVERY
 * design forever, the reader learns to skip the row, and the genuine finding underneath it goes with
 * it. So `summariseDemand` splits the two cases and names them differently: service in an hour the
 * station is SHUT is reported as a neutral fact (`outside`), and only service in a STAFFED hour with
 * nobody on duty is a finding (`uncovered`). The window that separates them is the per-design one
 * from `links-window.js` — which is why package 1 had to land before this.
 *
 * That split is also what keeps the live Sunday question visible rather than buried: five December
 * 2026 movements fall after the current 23:25 finish, so Sunday's `outside` figure is large and the
 * hours are named. It is stated, not scored, because moving a boundary is a business decision.
 */
import { DAYS, dayClass } from './links-design.js';

/**
 * Provenance. A demand curve with no version on it is the same defect as the undated printed sheet
 * fixed at v19.45 — right when it was made, and unverifiable afterwards. These are "base" files that
 * WILL be revised, and the weekday one is not even marked final, so the label says so.
 */
export const DEC_2026_SOURCE = Object.freeze({
    label: 'December 2026 timetable',
    detail: 'Marylebone simplifiers — SX “10 of 13” (not marked final), SO and Su “Final”. '
        + 'Passenger movements only; ECS excluded. Measured Aug 2026.',
    provisional: true,
});

/** The three shapes the timetable has. Named once — the profile is keyed by them throughout. */
export const DAY_CLASS_KEYS = /** @type {const} */ (['weekday', 'sat', 'sun']);

/**
 * Every passenger movement, as `[minutesSinceMidnight, cars, isArrival]` — sorted, per day class.
 *
 * STORED AS TIMES, NOT AS AN HOURLY TABLE, and that is the whole reason the boundary question can be
 * answered. The first version held hourly buckets, and the CEA window closes at 23:25 on a Sunday —
 * so "is hour 23 staffed" is true (the window covers part of it) and the five December 2026
 * movements AFTER 23:25 simply vanished. The one live finding this feature exists to surface was
 * invisible in it, and a unit test using a synthetic whole-hour window passed anyway. A minute-level
 * question needs minute-level data.
 *
 * HOW THE LENGTHS WERE DERIVED, because one part of it is an assumption worth being able to find:
 * `Max CAO` is present on every departure. An arrival and a departure on the same simplifier row
 * share a platform and a unit — the arrival turns round into that departure — so the arrival
 * inherits that length, which covers 85–89% of arrivals; `Unit Diag.` recovers a few more by
 * matching the diagram to a length recorded elsewhere. The remaining 21 weekday / 11 Sat / 10 Sun
 * arrivals have no length recorded anywhere and carry the day's mean (6 cars).
 *
 * **Those unresolved arrivals are NOT counted at zero.** They are mostly trains that terminate and
 * go empty to stabling — a full detrain with nobody boarding, which is arguably a heavier job than a
 * turnround, not a lighter one. Defaulting them down would quietly delete the workload this whole
 * feature exists to show.
 *
 * **And they are CAPPED at 9, the route maximum.** Where a cell listed two unit diagrams the
 * recovery summed them, which is right in principle — the arrival splits into two departures — but
 * produced three impossible values (11, 13, 13 cars) against a `Max CAO` that never exceeds 9 in the
 * authoritative data. The first plausibility test did not catch them because it checked each hour's
 * MEAN, and one outlier smooths away in a bucket of a dozen movements. Every movement is now checked
 * individually.
 *
 * Totals: weekday 311 movements / 1,756 cars · Sat 215 / 1,266 · Sun 188 / 1,059.
 */
export const DEC_2026_MOVEMENTS = Object.freeze({
    weekday: Object.freeze([
        [1,6,0],[1,6,0],[5,5,0],[10,4,0],[15,6,1],[355,5,0],[364,5,0],[371,6,0],[376,5,1],[380,3,0],[383,5,1],
        [387,6,1],[391,5,0],[394,6,1],[395,5,0],[408,3,1],[409,6,0],[412,5,0],[417,3,0],[417,6,1],[422,5,1],
        [426,6,1],[427,6,0],[430,5,1],[431,6,0],[435,6,0],[439,5,1],[447,5,0],[454,6,1],[455,5,0],[458,5,1],
        [459,6,0],[462,5,1],[465,8,1],[467,5,0],[471,6,1],[475,6,1],[477,5,0],[479,6,1],[482,3,1],[483,8,0],
        [486,6,1],[491,6,0],[494,5,1],[495,6,0],[498,6,1],[502,6,1],[503,3,0],[506,6,1],[507,5,0],[511,5,1],
        [514,6,1],[515,6,0],[518,6,1],[519,6,0],[521,6,1],[522,6,0],[525,5,1],[529,5,1],[530,5,0],[533,6,1],
        [537,5,0],[540,3,1],[542,5,0],[545,5,1],[546,6,0],[549,6,1],[550,3,0],[552,6,1],[556,8,1],[559,5,1],
        [563,6,1],[567,5,0],[570,5,1],[571,6,0],[574,6,1],[575,9,0],[578,6,0],[580,6,1],[581,6,0],[585,6,1],
        [589,3,1],[596,5,0],[599,6,1],[602,8,0],[606,6,0],[606,6,0],[610,3,0],[614,9,1],[618,6,1],[622,6,1],
        [626,6,1],[627,5,0],[634,3,1],[636,6,0],[639,6,1],[640,6,0],[640,6,0],[645,5,1],[649,3,1],[657,5,0],
        [662,5,0],[666,6,0],[670,3,0],[670,5,1],[677,6,1],[680,6,1],[683,5,1],[686,6,1],[687,5,0],[696,8,0],
        [700,6,0],[703,6,1],[706,8,1],[709,5,1],[717,5,0],[722,8,0],[726,6,0],[730,3,0],[733,3,1],[736,6,1],
        [739,6,1],[743,5,1],[747,5,0],[756,6,0],[759,6,1],[760,6,0],[763,5,1],[769,5,1],[777,5,0],[782,5,0],
        [786,6,0],[790,3,0],[790,5,1],[795,6,1],[799,5,1],[803,8,1],[807,5,0],[807,5,0],[816,8,0],[819,6,1],
        [820,6,0],[823,8,1],[829,3,1],[837,5,0],[842,8,0],[846,6,0],[850,3,0],[853,3,1],[856,6,1],[859,5,1],
        [862,5,1],[867,5,0],[876,8,0],[879,6,1],[880,6,0],[883,8,1],[889,5,1],[897,5,0],[902,5,0],[906,6,0],
        [910,3,0],[913,5,1],[917,6,1],[920,6,1],[923,6,1],[927,5,0],[936,8,0],[939,8,1],[940,6,0],[943,8,1],
        [944,5,0],[950,5,1],[957,5,0],[967,8,0],[970,6,1],[971,5,0],[974,6,1],[975,6,0],[979,6,0],[979,6,1],
        [982,5,1],[983,3,0],[987,6,0],[997,5,0],[1000,6,1],[1001,5,0],[1005,6,0],[1008,6,1],[1009,6,0],
        [1012,9,1],[1015,5,1],[1023,6,0],[1027,9,0],[1030,5,1],[1031,6,0],[1034,6,1],[1035,6,0],[1038,6,1],
        [1039,5,0],[1042,6,1],[1043,3,0],[1046,5,1],[1050,6,0],[1053,8,0],[1057,6,0],[1059,5,1],[1061,5,0],
        [1064,9,1],[1065,6,0],[1068,9,1],[1069,6,0],[1071,6,1],[1073,5,0],[1079,6,0],[1083,6,0],[1087,9,0],
        [1090,6,1],[1091,5,0],[1093,5,1],[1094,9,0],[1096,5,1],[1097,6,0],[1100,6,0],[1103,3,0],[1106,6,1],
        [1109,5,1],[1110,6,0],[1114,5,0],[1117,6,1],[1118,9,0],[1121,6,0],[1121,6,1],[1124,6,1],[1125,6,0],
        [1129,6,0],[1132,6,1],[1138,5,0],[1145,5,0],[1148,3,1],[1150,6,0],[1153,6,1],[1154,6,0],[1160,3,0],
        [1160,6,1],[1164,8,1],[1168,6,1],[1172,5,0],[1176,6,1],[1177,8,0],[1183,6,0],[1183,5,1],[1186,6,0],
        [1186,6,0],[1189,5,1],[1193,6,1],[1196,5,0],[1202,8,0],[1206,6,0],[1209,5,1],[1210,3,0],[1214,8,1],
        [1219,6,1],[1222,4,1],[1223,5,0],[1226,8,1],[1236,8,0],[1239,5,1],[1240,6,0],[1243,3,1],[1244,4,0],
        [1251,6,1],[1257,5,0],[1262,5,0],[1266,6,0],[1270,3,0],[1273,6,1],[1279,6,1],[1286,6,1],[1287,5,0],
        [1290,8,1],[1296,6,0],[1301,6,0],[1304,4,0],[1307,7,1],[1317,5,0],[1322,8,0],[1326,6,0],[1330,5,1],
        [1331,7,0],[1339,5,1],[1343,5,1],[1347,5,0],[1347,5,1],[1350,7,0],[1354,5,0],[1365,6,1],[1369,6,1],
        [1377,5,0],[1385,8,0],[1390,5,1],[1391,6,0],[1391,6,0],[1395,6,1],[1396,4,0],[1406,6,1],[1407,5,0],
        [1419,4,1],[1429,5,1],[1437,5,0],[1437,6,1]
    ]),
    sat: Object.freeze([
        [10,4,0],[352,6,0],[390,6,1],[397,6,0],[410,8,1],[412,4,0],[420,5,1],[422,8,0],[427,6,0],[441,6,1],
        [447,5,0],[456,4,1],[457,6,0],[467,8,1],[471,6,1],[472,4,0],[480,6,1],[482,8,0],[487,6,0],[490,4,1],
        [495,5,1],[501,6,1],[507,5,0],[512,5,0],[517,6,0],[520,6,1],[525,8,1],[531,6,1],[532,4,0],[540,5,1],
        [542,8,0],[547,6,0],[547,6,0],[550,5,1],[557,8,1],[561,4,1],[567,5,0],[572,5,0],[577,6,0],[580,6,1],
        [586,8,1],[591,5,1],[592,4,0],[600,6,1],[602,8,0],[607,6,0],[607,6,0],[610,6,1],[615,8,1],[621,6,1],
        [627,5,0],[632,8,0],[637,6,0],[640,6,1],[645,8,1],[651,5,1],[652,4,0],[656,4,1],[660,8,1],[662,8,0],
        [667,6,0],[670,6,1],[673,9,1],[681,4,1],[687,5,0],[692,8,0],[692,5,1],[695,5,1],[697,6,0],[705,8,1],
        [711,6,1],[712,4,0],[720,6,1],[722,8,0],[725,6,1],[727,6,0],[733,6,1],[738,8,1],[747,5,0],[752,5,0],
        [757,6,0],[760,6,1],[765,6,1],[771,5,1],[772,4,0],[780,4,1],[782,8,0],[787,6,0],[790,4,1],[796,6,1],
        [807,5,0],[817,6,0],[820,6,1],[825,9,1],[831,6,1],[832,4,0],[840,6,1],[842,8,0],[847,6,0],[850,5,1],
        [855,5,1],[867,5,0],[877,6,0],[880,6,1],[885,8,1],[891,4,1],[892,4,0],[897,5,0],[900,5,1],[902,8,0],
        [907,6,0],[910,6,1],[915,8,1],[927,5,0],[932,5,0],[937,6,0],[940,6,1],[945,8,1],[951,5,1],[952,4,0],
        [960,4,1],[962,8,0],[967,6,0],[970,6,1],[983,8,1],[987,5,0],[987,5,0],[992,8,0],[997,6,0],[1000,5,1],
        [1005,8,1],[1011,6,1],[1012,4,0],[1017,5,0],[1020,4,1],[1022,8,0],[1027,6,0],[1030,6,1],[1035,6,1],
        [1047,5,0],[1052,8,0],[1057,9,0],[1060,5,1],[1065,6,1],[1066,6,0],[1071,4,1],[1072,4,0],[1077,5,0],
        [1080,5,1],[1082,6,0],[1087,6,0],[1090,6,1],[1107,5,0],[1112,5,0],[1117,6,0],[1120,5,1],[1125,8,1],
        [1131,6,1],[1132,4,0],[1137,5,0],[1140,5,1],[1142,8,0],[1147,6,0],[1150,6,1],[1161,4,1],[1172,6,0],
        [1177,6,0],[1180,6,1],[1185,8,1],[1192,4,0],[1197,5,0],[1200,4,1],[1202,8,0],[1207,6,0],[1210,6,1],
        [1215,8,1],[1221,5,1],[1232,8,0],[1237,6,0],[1237,6,0],[1240,6,1],[1245,7,1],[1252,4,0],[1257,5,0],
        [1260,8,1],[1262,5,0],[1267,6,0],[1270,6,1],[1275,6,1],[1281,5,1],[1292,8,0],[1292,8,0],[1297,6,0],
        [1300,7,1],[1305,8,1],[1317,5,0],[1322,8,0],[1325,6,1],[1327,6,0],[1330,4,1],[1335,5,1],[1337,4,0],
        [1341,6,1],[1360,5,1],[1362,7,0],[1375,6,1],[1377,5,0],[1387,6,0],[1392,7,0],[1397,4,0],[1401,4,1],
        [1420,5,1],[1422,5,0],[1435,5,1],[1437,5,0]
    ]),
    sun: Object.freeze([
        [5,5,0],[462,6,0],[473,4,0],[477,5,0],[480,5,0],[492,6,0],[501,6,1],[504,8,1],[522,6,0],[529,5,1],
        [533,4,0],[537,5,0],[540,8,0],[543,5,1],[549,6,1],[552,6,0],[561,6,1],[577,4,1],[582,6,0],[591,9,1],
        [593,4,0],[594,6,1],[597,5,0],[600,5,0],[603,4,1],[607,6,1],[612,6,0],[615,5,1],[621,5,1],[640,6,1],
        [642,6,0],[647,8,1],[651,5,1],[653,4,0],[654,6,1],[657,5,0],[660,8,0],[664,6,1],[667,6,1],[670,6,1],
        [672,6,0],[675,4,1],[681,5,1],[697,6,1],[702,6,0],[702,6,0],[708,6,1],[713,4,0],[717,5,0],[720,5,0],
        [723,4,1],[727,6,1],[730,8,1],[732,6,0],[741,5,1],[757,6,1],[758,8,0],[762,6,0],[768,8,1],[773,4,0],
        [777,5,0],[780,8,0],[783,4,1],[787,6,1],[790,5,1],[792,6,0],[801,5,1],[817,6,1],[822,6,0],[828,6,1],
        [833,4,0],[837,5,0],[840,5,0],[843,4,1],[847,6,1],[852,6,0],[861,5,1],[877,6,1],[882,6,0],[887,8,1],
        [893,4,0],[897,5,0],[900,8,0],[903,4,1],[907,6,1],[912,6,0],[921,5,1],[937,6,1],[938,8,0],[942,6,0],
        [947,6,1],[953,4,0],[957,5,0],[960,5,0],[963,4,1],[967,5,1],[972,6,0],[981,5,1],[987,5,0],[997,6,1],
        [998,8,0],[1002,6,0],[1007,6,1],[1011,4,1],[1013,4,0],[1017,5,0],[1020,8,0],[1023,5,1],[1027,5,1],
        [1032,6,0],[1035,8,1],[1041,5,1],[1047,5,0],[1057,6,1],[1058,6,0],[1062,6,0],[1068,5,1],[1071,4,1],
        [1073,4,0],[1077,5,0],[1080,5,0],[1083,8,1],[1087,6,1],[1092,6,0],[1101,5,1],[1107,5,0],[1117,5,1],
        [1118,6,0],[1122,6,0],[1128,6,1],[1131,6,1],[1133,4,0],[1137,5,0],[1140,8,0],[1140,8,0],[1143,6,1],
        [1147,4,1],[1152,6,0],[1161,5,1],[1167,5,0],[1177,6,1],[1182,6,0],[1187,6,1],[1191,6,1],[1193,4,0],
        [1197,5,0],[1200,5,0],[1203,4,1],[1207,6,1],[1212,6,0],[1237,5,1],[1242,6,0],[1247,5,1],[1251,6,1],
        [1253,4,0],[1257,5,0],[1260,8,0],[1263,6,1],[1267,6,1],[1272,6,0],[1275,9,1],[1297,6,1],[1298,9,0],
        [1302,6,0],[1302,6,0],[1311,4,1],[1317,5,0],[1320,4,1],[1327,5,1],[1328,8,0],[1331,7,1],[1332,6,0],
        [1337,4,0],[1347,5,0],[1357,5,1],[1360,7,0],[1365,4,0],[1371,5,1],[1377,5,0],[1380,7,1],[1387,6,1],
        [1390,6,0],[1395,7,0],[1407,5,0],[1415,4,1],[1425,4,0],[1431,6,1],[1434,5,1]
    ]),
});

/**
 * The hourly curve the heat map draws, DERIVED from the movements above rather than written out
 * beside them.
 *
 * The first draft carried both — a literal hourly table AND the times — and that is a duplication
 * with no mechanism keeping the two in step. Re-measure the timetable, update one, and the panel
 * shades one shape while the boundary check answers about another; nothing would throw.
 *
 * `{ mv, cars }` per clock hour 0–23, per day class.
 */
export const DEC_2026_DEMAND = Object.freeze(Object.fromEntries(
    DAY_CLASS_KEYS.map(cls => {
        const mv = new Array(24).fill(0), cars = new Array(24).fill(0);
        for (const [t, c] of DEC_2026_MOVEMENTS[cls]) { mv[Math.floor(t / 60)]++; cars[Math.floor(t / 60)] += c; }
        return [cls, Object.freeze({ mv: Object.freeze(mv), cars: Object.freeze(cars) })];
    }),
));

/**
 * The demand in one clock hour of one day.
 *
 * Returns zeroes rather than throwing for an unknown day or an out-of-range hour: this feeds a
 * renderer that walks a span, and a missing figure must read as "no trains", never as a crash that
 * takes the whole Coverage card down with it.
 *
 * **The day key is checked against `DAYS` before `dayClass` sees it.** `dayClass` answers "which of
 * the three curves does this day follow" and maps everything that is not `sun`/`sat` to `weekday` —
 * correct for its own job, and wrong as a lookup guard, because `'sunday'` would then quietly draw
 * the weekday curve. Right by accident for a mistyped weekday, silently wrong for a mistyped
 * Sunday, and nothing anywhere would say so.
 * @param {any} profile - a DEC_2026_DEMAND-shaped object
 * @param {string} day - a DAYS key ('sun'…'sat')
 * @param {number} hour - 0–23
 * @returns {{mv: number, cars: number}}
 */
export function demandAt(profile, day, hour) {
    if (!DAYS.includes(day)) return { mv: 0, cars: 0 };
    const row = profile?.[dayClass(day)];
    if (!row || !Number.isInteger(hour) || hour < 0 || hour > 23) return { mv: 0, cars: 0 };
    return { mv: row.mv?.[hour] ?? 0, cars: row.cars?.[hour] ?? 0 };
}

/**
 * The busiest single hour in the profile, in cars — the scale the shading is drawn against.
 *
 * Scaled to the PROFILE's own peak, not to the cover grid's. The two rows measure different things
 * in different units, so a shared scale would be meaningless; what each row shows is its own shape,
 * and the shapes are what a reader compares.
 * @param {any} profile
 */
export function peakCars(profile) {
    let peak = 0;
    for (const cls of DAY_CLASS_KEYS) {
        for (const n of profile?.[cls]?.cars ?? []) if (n > peak) peak = n;
    }
    return peak;
}

/**
 * Intensity bucket 0–5, matching the heat map's existing `b0`–`b5` ramp.
 *
 * Any non-zero demand is at least bucket 1: an hour with one 3-car train is a quiet hour, not an
 * empty one, and rounding it to the same blank cell as 04:00 would say the station is closed.
 * @param {number} cars
 * @param {number} peak
 */
export function demandBucket(cars, peak) {
    if (!cars || cars <= 0 || peak <= 0) return 0;
    return Math.max(1, Math.ceil((cars / peak) * 5));
}

/**
 * The busiest hour of one day class on EACH measure.
 *
 * Exists so the panel can state the disagreement rather than hardcode it: on the December 2026
 * weekday the morning and evening tie at 23 movements, but by cars the evening is ~10% heavier and
 * the peak moves 08:00 → 17:00. That is the single most useful thing this data says, and it is the
 * reason both figures are kept instead of one blended score. Computed, not written down, so that a
 * profile swapped in later (package 4) restates its own truth rather than repeating this one's.
 *
 * Returns nulls for an empty or absent class rather than `-1` from a bare `indexOf`, so a caller
 * cannot render "peak at hour -1".
 * @param {any} profile
 * @param {string} cls - 'weekday' | 'sat' | 'sun'
 * @returns {{byMv: number|null, byCars: number|null, differ: boolean}}
 */
export function peakHours(profile, cls) {
    const row = profile?.[cls];
    const best = (/** @type {number[]|undefined} */ arr) => {
        if (!arr?.length) return null;
        const max = Math.max(...arr);
        return max > 0 ? arr.indexOf(max) : null;
    };
    const byMv = best(row?.mv), byCars = best(row?.cars);
    return { byMv, byCars, differ: byMv !== null && byCars !== null && byMv !== byCars };
}

/** Short display name for a single day key. */
export const DAY_LABEL = /** @type {Record<string, string>} */ (Object.freeze({
    sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat',
}));

/**
 * The three day classes, each with the day key that stands for it and the label a reader sees.
 * Ordered as the heat map's own rows run.
 */
export const DAY_CLASSES = Object.freeze([
    Object.freeze({ cls: 'weekday', day: 'mon', label: 'Mon–Fri' }),
    Object.freeze({ cls: 'sat', day: 'sat', label: 'Sat' }),
    Object.freeze({ cls: 'sun', day: 'sun', label: 'Sun' }),
]);

/**
 * The movements that fall OUTSIDE a staffed window, to the minute.
 *
 * This is the function the hourly first draft could not express. The CEA window closes at 23:25 on a
 * Sunday, so the 23:00 hour is partly staffed — an hourly test calls it covered and the five
 * December 2026 movements after 23:25 disappear, which is the single finding this whole feature was
 * built to surface. `before`/`after` are kept apart because they are different arguments: a late
 * finish and an early start are separate business decisions.
 *
 * @param {Array<[number, number, number]>} movements
 * @param {number} start - staffed from, minutes since midnight
 * @param {number} end - staffed to, minutes since midnight
 */
export function movementsOutside(movements, start, end) {
    const before = [], after = [];
    for (const [t, cars, isArr] of movements ?? []) {
        if (t < start) before.push({ t, cars, isArr: !!isArr });
        else if (t > end) after.push({ t, cars, isArr: !!isArr });
    }
    return { before, after };
}

/**
 * Read a design's cover against the service, and split the result into a FINDING and a FACT.
 *
 * - `uncovered` — the station is open, trains are running, and nobody is on duty. A finding, and
 *                 counted PER DAY at HOUR resolution, because it is a property of the design and the
 *                 heat map's own unit is the hour: a hole at 12:00 on all five weekdays is five
 *                 times the problem of a hole on Tuesday alone, and the two must not report alike.
 * - `outside`   — trains running when the station is shut, to the MINUTE. A fact, deliberately not a
 *                 finding: the last trains and the 05:5x first departure are like this on every
 *                 design there has ever been, so scoring them would flag every design forever and
 *                 teach the reader to skip the row — taking the finding above with it.
 *
 * **`outside` is counted per day CLASS, not per day**, and that asymmetry with `uncovered` is
 * deliberate. It depends only on the service and the window — never on the design — so a weekday
 * 00:01 departure is ONE fact about the operation, not five. Listing it five times would bury the
 * entries that are about a movable boundary in repetition of the ones that are not.
 *
 * The window is injected as MINUTES rather than as an is-this-hour-staffed predicate, so a caller
 * cannot accidentally ask an hourly question of a minute-level boundary — which is exactly the bug
 * the first version shipped.
 *
 * @param {object} args
 * @param {any} args.profile - hourly, for the `uncovered` pass
 * @param {any} args.movements - DEC_2026_MOVEMENTS-shaped, for the `outside` pass
 * @param {Record<string, {hours: number[]}>} args.hourly - calcHourlyCoverage output
 * @param {string[]} args.days
 * @param {(day: string) => {start: number, end: number}} args.windowFor - staffed minutes for a day
 */
export function summariseDemand({ profile, movements, hourly, days, windowFor }) {
    const uncovered = [];
    let uncoveredCars = 0, uncoveredMv = 0;

    for (const day of days) {
        const { start, end } = windowFor(day);
        for (let hour = 0; hour < 24; hour++) {
            const { mv, cars } = demandAt(profile, day, hour);
            if (mv <= 0) continue;                          // no trains — nothing to say either way
            // ANY overlap counts as staffed here, matching the heat map's own cell: the day opens at
            // 06:20, so 06:00 is an hour cover is required in. The minute-level question is the
            // `outside` pass's job, not this one's.
            if (!(start < (hour + 1) * 60 && end > hour * 60)) continue;
            if ((hourly?.[day]?.hours?.[hour] ?? 0) > 0) continue;
            uncovered.push({ day, hour, mv, cars });
            uncoveredCars += cars; uncoveredMv += mv;
        }
    }

    // Split BEFORE the day starts from AFTER it ends, and keep them split all the way to the prose.
    // They are different arguments — an early start and a late finish are separate decisions — and
    // flattening them buries the live one: the pre-opening movements are the permanent, unmovable
    // case and there are three times as many, so a single list ordered by time puts every one of
    // them ahead of the five Sunday movements the whole feature was built to show.
    const before = [], after = [];
    let outsideCars = 0;
    for (const { cls, day, label } of DAY_CLASSES) {
        const { start, end } = windowFor(day);
        const split = movementsOutside(movements?.[cls], start, end);
        for (const m of split.before) { before.push({ label, day, cls, side: 'before', ...m }); outsideCars += m.cars; }
        for (const m of split.after)  { after.push({ label, day, cls, side: 'after', ...m }); outsideCars += m.cars; }
    }
    const outside = [...before, ...after];

    return {
        uncovered, uncoveredCars, uncoveredMv,
        outside, outsideBefore: before, outsideAfter: after,
        outsideCars, outsideMv: outside.length,
        peak: peakCars(profile),
    };
}

/**
 * "Sun 23:00, Mon 00:00" — the hours behind a figure, in the order they were found, capped.
 *
 * Named hours matter more than the total: "182 cars uncovered" is unactionable, whereas "Sun 23:00"
 * points straight at the hour that needs someone in it.
 * @param {Array<{day: string, hour: number, label?: string}>} entries
 * @param {number} [cap]
 */
export function describeHours(entries, cap = 4) {
    const shown = entries.slice(0, cap)
        .map(e => `${e.label ?? DAY_LABEL[e.day] ?? e.day} ${String(e.hour).padStart(2, '0')}:00`);
    const more = entries.length - shown.length;
    return more > 0 ? `${shown.join(', ')}, +${more} more` : shown.join(', ');
}

/**
 * "Sun 23:27 dep, Sun 23:35 arr" — individual movements, to the minute.
 *
 * Arrival or departure is stated because it is the distinction the boundary argument turns on: the
 * plan's earlier draft assumed only departures needed a CEA, which would have cut the Sunday case
 * from five movements to two. They do not, so all five stand — and a reader needs to see which is
 * which to follow that.
 * @param {Array<{day: string, t: number, cars: number, isArr: boolean, label?: string}>} entries
 * @param {number} [cap]
 */
export function describeMovements(entries, cap = 5) {
    const shown = entries.slice(0, cap).map(e =>
        `${e.label ?? DAY_LABEL[e.day] ?? e.day} `
        + `${String(Math.floor(e.t / 60)).padStart(2, '0')}:${String(e.t % 60).padStart(2, '0')} `
        + `${e.isArr ? 'arr' : 'dep'}`);
    const more = entries.length - shown.length;
    return more > 0 ? `${shown.join(', ')}, +${more} more` : shown.join(', ');
}
