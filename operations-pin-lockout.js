// @ts-check
/**
 * operations-pin-lockout.js — the staff PIN's station-wide block, on Operations (owner, Nov 2026).
 *
 * Anybody can send 200 wrong PINs and shut the PIN door on every station PC for fifteen minutes, and do
 * it again; the limit is kept on purpose (functions/calendar-viewer-auth.js header says why), so what
 * changed is that the admin is TOLD — a push at most once a day, and here: a line on Staff Login
 * Accounts and an item on the "Needs attention" strip while a block runs or one began in the last day.
 *
 * It runs no read of its own. The fact arrives on the provisioning audit's answer (`pinLockout` on
 * getAccountSetupGaps, account-calls.js), which the Staff Login Accounts card already makes, and the
 * card hands it here — the strip's first refusal, "it runs no reads" (operations-attention.js).
 *
 * THREE STATES, and the one that is easy to get wrong is the third:
 *   · an object — a block running, or one begun in the last day: the line and the strip item show;
 *   · `null` — none: nothing shows;
 *   · ABSENT — the server could not read its record, or is an older server that does not send it (the
 *     Functions and the page deploy in parallel). That is UNKNOWN, and it must never read as "none":
 *     the line is left off and the strip item is WITHDRAWN, never reported as zero.
 *
 * What it may say is times and counts. The PIN, an address, who tripped it — none of it reaches this
 * page, and nothing here could say it.
 */

/** How long a block that has ended is still worth a line. The server applies the same day — `LOCKOUT_RECENT_MS`
 *  (functions/calendar-viewer-auth.js); operations-pin-lockout.test.mjs fails when the two disagree. */
const RECENT_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {{ active: boolean, blockedUntil: number, lastBlockedAt: number, blocks: number }} PinLockout
 */

/**
 * The lockout as the server sent it, checked — or `undefined` for unknown, `null` for none. PURE.
 * @param {unknown} raw  `gaps.pinLockout`, as it arrived
 * @param {number} now   epoch ms
 * @returns {PinLockout|null|undefined}
 */
export function readLockout(raw, now) {
    if (raw === null) return null;
    if (!raw || typeof raw !== 'object') return undefined;
    const r = /** @type {Record<string, unknown>} */ (raw);
    const num = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const blockedUntil = num(r.blockedUntil), lastBlockedAt = num(r.lastBlockedAt);
    const active = r.active === true && blockedUntil > now;
    const recent = lastBlockedAt > 0 && now - lastBlockedAt < RECENT_MS;
    if (!active && !recent) return null;     // the server's day has passed while the page sat open
    return { active, blockedUntil, lastBlockedAt, blocks: Math.max(1, Math.floor(num(r.blocks))) };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar day an instant falls on in London, as a whole number of days — so two compare by subtraction.
 *  @param {number} ms @returns {number} */
function londonDay(ms) {
    /** @type {Record<string, string>} */ const p = {};
    for (const { type, value } of new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: 'numeric', day: 'numeric' })
        .formatToParts(new Date(ms))) p[type] = value;
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / DAY_MS;
}

/**
 * "14:05" in London — "yesterday at 14:05" or "tomorrow at 00:05" on a day either side, and the date
 * beyond that. The future has words too: a block that starts at 23:50 runs until 00:05, and until
 * 17 Nov 2026 that end read "yesterday at 00:05", because only the past had been thought of.
 * @param {number} ms @param {number} now @returns {string}
 */
function when(ms, now) {
    const time = new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const days = londonDay(ms) - londonDay(now);
    if (days === 0) return time;
    if (days === -1) return `yesterday at ${time}`;
    if (days === 1) return `tomorrow at ${time}`;
    return `${new Date(ms).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long' })} at ${time}`;
}

/**
 * The card's words for a lockout: what happened, and what the admin can do. PURE.
 * One block that has ended is given its start and its end; "most recently" belongs to several.
 * @param {PinLockout} l
 * @param {number} now
 * @returns {{ text: string, fix: string }}
 */
export function lockoutWords(l, now) {
    const times = l.blocks === 1 ? '' : ` ${l.blocks} times in the last day`;
    const once = l.blockedUntil > l.lastBlockedAt
        ? `from ${when(l.lastBlockedAt, now)} to ${when(l.blockedUntil, now)}`
        : `at ${when(l.lastBlockedAt, now)}`;
    const text = l.active
        ? `The staff PIN is blocked for everyone until ${when(l.blockedUntil, now)} — too many wrong entries${times ? `,${times}` : ''}.`
        : times
            ? `The staff PIN was blocked for everyone${times}, most recently from ${when(l.lastBlockedAt, now)} — too many wrong entries.`
            : `The staff PIN was blocked for everyone ${once} — too many wrong entries.`;
    return {
        text,
        fix: 'It reopens by itself, and members can still sign in with their password. If it keeps happening, somebody may be guessing — consider changing the PIN.',
    };
}

/** The first moment after `now` that is a new day in London — when "14:05" becomes "yesterday at 14:05".
 *  A London midnight is a UTC one, or the hour before it in summer time; the clocks change at 01:00 UTC,
 *  so midnight itself is never inside a change. @param {number} now @returns {number} */
function nextLondonMidnight(now) {
    const midnightUtc = (londonDay(now) + 1) * DAY_MS;
    const summer = midnightUtc - 60 * 60 * 1000;
    return londonDay(summer) === londonDay(now) + 1 ? summer : midnightUtc;
}

/**
 * When what the card says about this lockout next changes by the clock alone, in epoch ms, or `null`
 * when nothing will: a running block ends, the day after the last one runs out, or London's day turns
 * (its times then need "yesterday"). The card draws the line again then — drawn once and left, it went
 * on saying "blocked until 14:20" at 15:00 (whole-app check, 17 Nov 2026). Always after `now`. PURE.
 * @param {PinLockout|null|undefined} lockout  from `readLockout`, read at `now`
 * @param {number} now
 * @returns {number|null}
 */
export function lockoutChangesAt(lockout, now) {
    if (!lockout) return null;
    return Math.min(lockout.active ? lockout.blockedUntil : lockout.lastBlockedAt + RECENT_MS, nextLondonMidnight(now));
}

/**
 * Draw (or take away) the lockout's line at the foot of the card's audit block.
 * @param {HTMLElement|null} host  `#authSetupGaps`
 * @param {PinLockout|null|undefined} lockout  from `readLockout`
 * @param {number} now
 */
export function renderLockoutLine(host, lockout, now) {
    host?.querySelector?.('.auth-gap-line--pin')?.remove();
    if (!host || !lockout) return;
    const { text, fix } = lockoutWords(lockout, now);
    const p = document.createElement('p');
    p.className = 'auth-gap-line auth-gap-line--pin';
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '🔢';
    const fixEl = document.createElement('span');
    fixEl.className = 'auth-gap-fix';
    fixEl.textContent = fix;
    p.append(icon, ` ${text}`, fixEl);
    host.append(p);
}

/**
 * The strip's count for the lockout: the blocks in the last day, 0 for none, `null` for unknown.
 * @param {PinLockout|null|undefined} lockout
 * @returns {number|null}
 */
export function lockoutCount(lockout) {
    if (lockout === undefined) return null;
    return lockout ? lockout.blocks : 0;
}
