// THE HALF-HOUR SHIFT TIMES, for final-table.mjs's POOL_ONLY= (4 Nov 2026, owner, on today's link taken to 26 weeks: "Try
// where possible to start/finish on a half hour apart from the open and close" — README.md → "Common Ground"). Prints, as one
// comma-separated list, every duty a day may work under that brief:
//   · Monday to Saturday: the open's 06:20 with a 13:45 or 14:20 finish ("Keep the 13.45 and 14.20 shifts as the opening shift
//     finish times"), the closer 15:45–23:55 ("Change the closing shift to 1545"), the ticket office's own times (FIXED= needs
//     them in the pool: 14:00–22:30 on a weekday, 06:20–14:50 and 14:30–22:00 on a Saturday), and every other duty starting
//     and finishing on the hour or the half hour, from 07:00 (the forty minutes after the open are no start) to 23:30;
//   · Sunday: the open's 07:15 with a half-hour finish, the closer to 23:25 from a half-hour start or 15:15 (a 15:45 start
//     would be 7h 40m, under rule S8's 8 hours), and every other duty on the hour or the half hour.
// Lengths, start bands and caps are final-table.mjs's own switches (LO/HI, EARLY_HI, OPENER_HI, EARLY_START_MAX, …), so this
// only says which clock times are on offer.
//   POOL_ONLY=$(node half-hour-pool.mjs weekday|sat|sun) … node final-table.mjs
const cls = process.argv[2];
if (!['weekday', 'sat', 'sun'].includes(cls)) { console.error('usage: node half-hour-pool.mjs weekday|sat|sun'); process.exit(2); }
const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const out = new Set();
if (cls === 'sun') {
  for (let e = 15 * 60; e <= 17 * 60; e += 30) out.add(`07:15-${hm(e)}`);
  for (let s = 13 * 60; s <= 16 * 60; s += 30) out.add(`${hm(s)}-23:25`);
  out.add('15:15-23:25');
  for (let s = 8 * 60; s <= 16 * 60; s += 30) for (let e = s + 420; e <= 23 * 60; e += 30) out.add(`${hm(s)}-${hm(e)}`);
} else {
  out.add('06:20-13:45'); out.add('06:20-14:20'); out.add('15:45-23:55');
  if (cls === 'sat') { out.add('06:20-14:50'); out.add('14:30-22:00'); } else out.add('14:00-22:30');
  for (let s = 7 * 60; s <= 16 * 60; s += 30) for (let e = s + 420; e <= 23 * 60 + 30; e += 30) out.add(`${hm(s)}-${hm(e)}`);
}
console.log([...out].join(','));
