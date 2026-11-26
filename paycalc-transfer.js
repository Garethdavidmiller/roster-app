// @ts-check
/**
 * paycalc-transfer.js — back up and restore the pay calculator's device-local data.
 *
 * Owns: the backup FORMAT, key selection, the import validation ladder, and re-keying.
 * Does NOT own: reading/writing localStorage, files, or the clipboard (paycalc-transfer-card.js),
 *   or the key builders themselves (paycalc-migrations.js).
 * Edit here for: the blob schema, what is eligible for backup, or an import rule.
 *
 * WHY THIS EXISTS. Pay calculator data lives in localStorage, which is per-ORIGIN — so it does not
 * follow the member between `garethdavidmiller.github.io` and `myb-roster.web.app`, and it does not
 * survive a new phone or cleared browser data. Everything else the app holds is in Firestore and
 * moves with the account; this is the one thing that does not, deliberately (pay data is kept off
 * the server — see .claude/rules/paycalc.md → Example payslips).
 *
 * Every function here is PURE. That is the point: the import path decides whether to overwrite a
 * member's entire pay history, so its rules have to be testable without a browser, a file picker,
 * or a live localStorage.
 */

import { DEVICE_KEYS, memberSlug, PAY_DATA_GENERATION, keyOwnerSlug } from './paycalc-migrations.js';
import { inventoryOf, damagedEntries, classifyPayKey, describePayKey } from './paycalc-inventory.js';
import { formatISO, teamMembers } from './roster-data.js';
import { periodByNum, payslipPeriodNum } from './paycalc-periods.js';
import { fdLong } from './paycalc-format.js';

/** Identifies our own blobs. A file that does not carry this is not ours, whatever its extension. */
export const BACKUP_FORMAT = 'myb-paycalc-backup';

/** The refusal for figures saved under a name this roster does not hold: there is nobody to sign in
 *  as, and the one owner who can fix it — a member renamed since — needs the admin. */
const NOT_ON_ROSTER = "That backup was saved under a name this device doesn't recognise, so it can't be restored "
    + 'as yours. Nothing was changed. If it is yours from before a change of name, contact the admin.';

/** The ROSTER's name for a member slug `keyOwnerSlug` has matched — never the file's words for it. A
 *  slug two names share (memberSlug's doc says it can happen) gives the first; the refusal stands
 *  either way, so the name only says who to sign in as. @param {string|null} slug @returns {string} */
function _rosterName(slug) {
    return teamMembers.find(m => memberSlug(m.name) === slug)?.name ?? 'someone else';
}

/** Schema version. Bump when the blob's SHAPE changes; a newer blob is refused by an older app. */
export const BACKUP_VERSION = 1;

/**
 * Every paycalc key is built from `pcPrefix()` + an alphanumeric/underscore tail (`p16`,
 * `hpp_est_2026_27`, `bp_state_2026_27`, `snap_16`, `actuals`, …). Nothing else is legitimate, so
 * anything else in an imported blob is refused rather than written.
 */
const KEY_RE = /^myb_pc_[A-Za-z0-9_]+$/;

/**
 * A key from the FILE, as a refusal quotes it so the member can find it. The text is the file's, so it
 * is rendered by textContent and cannot inject — but it is unbounded, and a pathological key would
 * stretch the card, so it is capped as the owner's name is (17 Nov 2026). Long enough for any key the
 * app writes, whole.
 * @param {string} key @returns {string}
 */
const shownKey = (key) => (key.length > 60 ? `${key.slice(0, 60)}…` : key);

/**
 * The keys eligible for backup: everything under the member's namespace EXCEPT the device-level
 * flags, which describe the browser rather than the member.
 *
 * Selection is a PREFIX SCAN, not an enumerated list, deliberately: a hand-maintained list of key
 * types would silently drop any type added later — the same failure mode as the service-worker
 * precache list, which this repo has been bitten by. New key builders are picked up for free;
 * `validateBackup` is where the strictness lives instead.
 *
 * @param {string[]} allKeys every localStorage key (from `lsKeys()`)
 * @param {string} prefix the active namespace, i.e. `pcPrefix()`
 * @returns {string[]} sorted, so a backup of unchanged data is byte-identical between runs
 */
export function selectBackupKeys(allKeys, prefix) {
    return allKeys
        .filter(k => k.startsWith(prefix) && !DEVICE_KEYS.has(k) && KEY_RE.test(k))
        .sort();
}

/**
 * Read everything a backup will carry — or say exactly what could not be read, and carry nothing.
 *
 * A BACKUP IS WHOLE OR IT IS NOT MADE (Nov 2026). The card read each value with `lsGet`, which answers
 * null both for "nothing there" and for "storage would not answer", and skipped the nulls — so a
 * device holding two payslips whose second read was refused downloaded the first alone, counted one
 * payslip, and showed the ordinary download line. A member keeps that file as THE copy of their pay
 * history. So the list of keys and every value are CHECKED reads (`lsKeysChecked` / `lsGetChecked`,
 * ls.js): one that fails means no file at all, and the card names what it could not read.
 *
 * A key the list named that then reads back ABSENT (removed in another tab between the two) is simply
 * not there any more, and is left out: that read worked.
 *
 * The reads are injected, like `applyRestore`'s, so the refusal is testable against a storage that
 * fails on demand.
 *
 * @param {object} io
 * @param {() => { ok: boolean, keys: string[] }} io.listKeys  `lsKeysChecked`
 * @param {(k: string) => { ok: boolean, value: string|null }} io.read  `lsGetChecked`
 * @param {string} io.prefix  `pcPrefix()`
 * @returns {{ ok: true, entries: Record<string,string> }
 *          | { ok: false, reason: 'list-failed' }
 *          | { ok: false, reason: 'read-failed', unreadable: string[] }}
 */
export function collectBackupEntries({ listKeys, read, prefix }) {
    const listed = listKeys();
    if (!listed.ok) return { ok: false, reason: 'list-failed' };
    /** @type {Record<string,string>} */
    const entries = {};
    /** @type {string[]} */
    const unreadable = [];
    for (const k of selectBackupKeys(listed.keys, prefix)) {
        const r = read(k);
        if (!r.ok) unreadable.push(k);
        else if (r.value !== null) entries[k] = r.value;
    }
    return unreadable.length ? { ok: false, reason: 'read-failed', unreadable } : { ok: true, entries };
}

/**
 * One saved entry named as a member would recognise it in a sentence: a payslip by its PAYDAY first,
 * with the printed P-number as the cross-check, as every payslip list on the page names one
 * (`appendPayslipOptions`) — "the payslip paid 3 July 2026 (P16)". Anything else is named as the
 * damage notice names it (`describePayKey`): "back pay 2026/27", "your settings". A payslip number
 * the period grid does not hold falls back to that too.
 * @param {string} key a full key under `prefix` @param {string} prefix @returns {string}
 */
function nameOfEntry(key, prefix) {
    const tail = key.slice(prefix.length);
    const c = classifyPayKey(tail);
    const p = c.period !== null ? periodByNum(c.period) : undefined;
    if (!p) return describePayKey(tail);
    const payslip = `the payslip paid ${fdLong(p.payday)} (P${payslipPeriodNum(p)})`;
    return c.kind === 'snapshot' ? `the figures filled from your calendar for ${payslip}` : payslip;
}

/**
 * The line a backup that could not be made ends on: what could not be read, and the button to try
 * again with. Nothing is claimed — no file was offered, so nothing is half-saved.
 * @param {{ reason: 'list-failed' } | { reason: 'read-failed', unreadable: string[] }} failure
 *   `collectBackupEntries`'s refusal
 * @param {string} prefix `pcPrefix()`
 * @param {string} button the label of the button that was tapped, to tap again
 * @param {string} nothing what did not happen: "Nothing was saved." / "Nothing was copied."
 * @returns {string}
 */
export function unreadableBackupLine(failure, prefix, button, nothing) {
    const retry = `${nothing} Tap ${button} to try again.`;
    if (failure.reason === 'list-failed') {
        return "This device wouldn't list the pay data saved on it, so a backup made now could be missing "
            + `some of it. ${retry}`;
    }
    const names = failure.unreadable.map(k => nameOfEntry(k, prefix));
    const shown = names.slice(0, 4);
    const more = names.length - shown.length;
    const list = more > 0 ? `${shown.join(', ')} and ${more} more`
        : shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
        : shown[0];
    return `${list.charAt(0).toUpperCase()}${list.slice(1)} couldn't be read on this device, so a backup made now `
        + `would be missing ${names.length === 1 ? 'it' : 'them'}. ${retry}`;
}

/**
 * Summarise a set of keys in terms a member recognises — payslips and tax years, not key counts.
 *
 * Delegates to `inventoryOf`, which classifies against the ONE key table. Until v22.14 this
 * counted tax years from a hand-written regex naming five of the nine per-year key types, so a
 * year whose only data was a confirmed setup, a recorded HPP or a Year-to-Date source simply did
 * not appear — an undercount on the card that exists to say what you are carrying to a new phone.
 *
 * The RETURN SHAPE is deliberately the flat one it has always been (`taxYears` a count, not a
 * list): it is written into every backup blob as `counts`, and a blob field is read by app
 * versions that do not exist yet. The card asks `inventoryOf` directly for the rich form.
 *
 * @param {string[]} keys
 * @param {string} prefix
 */
export function summarise(keys, prefix) {
    const inv = inventoryOf(keys, prefix);
    return { periods: inv.periods, taxYears: inv.taxYears.length, keys: inv.keys };
}

/**
 * Build the backup blob. Values are carried as RAW STRINGS, never re-parsed: a backup must survive
 * a paycalc schema change it predates, so interpretation stays in the app that reads it.
 *
 * @param {{ entries: Record<string,string>, member: string, slug: string,
 *           appVersion: string, exportedAt: string, prefix: string }} o
 */
export function buildBackup({ entries, member, slug, appVersion, exportedAt, prefix }) {
    return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        // The FILE's shape (`version`) and the DATA's shape (`dataGeneration`) are separate
        // questions and have always moved independently — see PAY_DATA_GENERATION.
        dataGeneration: PAY_DATA_GENERATION,
        appVersion,
        member,
        slug,               // the SOURCE namespace segment — makes re-keying unambiguous (see rekeyEntries)
        exportedAt,
        counts: summarise(Object.keys(entries), prefix),
        data: entries,
    };
}

/**
 * The import validation ladder. Nothing is written until this returns ok — a half-applied restore
 * over someone's pay history is the worst outcome available here.
 *
 * Returns a RESULT rather than throwing, so the card can render each refusal in the member's own
 * terms instead of surfacing an exception.
 *
 * @param {string} text the pasted or uploaded file contents
 * @param {{ currentSlug: string }} ctx the namespace of the member doing the importing
 * @returns {{ ok: false, error: string }
 *          | { ok: true, blob: any, unnamespaced: boolean, srcSlug: string,
 *              counts: {periods:number,taxYears:number,keys:number},
 *              inventory: ReturnType<typeof inventoryOf>,
 *              damaged: {key:string,tail:string,label:string}[] }}
 */
export function validateBackup(text, { currentSlug }) {
    // FAIL CLOSED ON IDENTITY, before anything else is considered. Every rule below is about whose
    // data this is; with no importing identity none of them can be satisfied, and the caller's
    // namespace would be the bare `myb_pc_` — which spans EVERY member on a shared device. Letting
    // that through would make a restore delete two people's pay history and write the payload
    // unnamespaced. (Reachable on paycalc when the session name is no longer on the roster — a
    // leaver or a rename — because `getLoggedMember()` then returns null and the namespace never
    // activates. Verified in a browser, v19.17.)
    if (!currentSlug) {
        return { ok: false, error: "This device can't tell whose pay data this is, so nothing was changed. Sign in again, or contact the admin." };
    }
    /** @type {any} */ let blob;
    try {
        blob = JSON.parse(String(text));
    } catch {
        return { ok: false, error: "That doesn't look like a backup file — it couldn't be read." };
    }
    if (!blob || typeof blob !== 'object' || Array.isArray(blob)) {
        return { ok: false, error: "That doesn't look like a backup file." };
    }
    if (blob.format !== BACKUP_FORMAT) {
        return { ok: false, error: 'That file is not a pay calculator backup.' };
    }
    // Every version this app has written is a whole number from 1. Anything else — missing, text, 0 —
    // is a damaged file, and telling its owner to update their phone would send them the wrong way
    // (paycalc-2-15). Only a well-formed version ABOVE ours is "newer".
    if (!Number.isInteger(blob.version) || blob.version < 1) {
        return { ok: false, error: 'That backup is damaged (its version record). Nothing was changed.' };
    }
    if (blob.version > BACKUP_VERSION) {
        return { ok: false, error: 'That backup was made by a newer version of the app. Update this device first.' };
    }
    // A blob whose FILE shape we understand can still hold values written by a later paycalc —
    // a pension timeline in a shape this version cannot read, say. Refuse rather than write it:
    // the values would be restored faithfully and then silently misread. Absent on every backup
    // written before v22.14, and absence means "no later than us", which is what those are — but a
    // PRESENT one that is not a whole number cannot be compared at all, and "9" slipped past `>`.
    if (blob.dataGeneration != null && !Number.isInteger(blob.dataGeneration)) {
        return { ok: false, error: 'That backup is damaged (its data record). Nothing was changed.' };
    }
    if (blob.dataGeneration > PAY_DATA_GENERATION) {
        return { ok: false, error: 'That backup holds pay figures from a newer version of the app. Update this device first.' };
    }
    if (!blob.data || typeof blob.data !== 'object' || Array.isArray(blob.data)) {
        return { ok: false, error: 'That backup has no pay data in it.' };
    }

    const keys = Object.keys(blob.data);
    if (!keys.length) return { ok: false, error: 'That backup is empty — there is nothing to restore.' };

    // THE TRUST BOUNDARY. A backup is a file the member obtained from somewhere; restoring it must
    // never be a way to write arbitrary localStorage. Only our own namespace, only our own key
    // shape, never a device flag, and only string values.
    const badKey = keys.find(k => !KEY_RE.test(k) || DEVICE_KEYS.has(k));
    if (badKey) {
        return { ok: false, error: `That backup contains something that isn't pay data (${shownKey(badKey)}). Nothing was changed.` };
    }
    const badValue = keys.find(k => typeof blob.data[k] !== 'string');
    if (badValue) {
        return { ok: false, error: `That backup is damaged (${shownKey(badValue)}). Nothing was changed.` };
    }

    // A slug that is PRESENT but not a string cannot be re-keyed from — `'myb_pc_' + 7 + '_'` names
    // nothing the keys sit under, and treating it as absent (legacy) would re-key every key wrongly.
    if (blob.slug != null && typeof blob.slug !== 'string') {
        return { ok: false, error: 'That backup is damaged (its owner record). Nothing was changed.' };
    }
    const srcSlug = typeof blob.slug === 'string' ? blob.slug : '';

    // Option A — refuse a different member outright. Staff share devices (which is precisely why
    // the per-member namespacing exists), and pay history is the most sensitive thing this app
    // holds. The legitimate cross-member case is rare enough to handle by signing in as that person.
    if (srcSlug && srcSlug !== currentSlug) {
        // An owner this roster does not hold at all — this member under a FORMER name, or somebody
        // since removed from it — has nobody to sign in as, so "Sign in as them" was an instruction
        // nobody could follow (paycalc-2-19). Still refused: whose figures these are is exactly what
        // cannot be told.
        if (keyOwnerSlug(`myb_pc_${srcSlug}_`) === null) return { ok: false, error: NOT_ON_ROSTER };
        // NAMED FROM THE ROSTER, NEVER FROM THE FILE (18 Nov 2026). The slug matched a roster member,
        // so the roster says whose this is. `member` is free text the file carries, and quoting it let a
        // made-up backup put any words it liked into "That backup belongs to …" — rendered as text, so
        // no injection, but words in the app's own voice that the app never chose.
        return { ok: false, error: `That backup belongs to ${_rosterName(srcSlug)}. Sign in as them to restore it.` };
    }

    // Legacy data saved before per-member namespacing has no owner recorded. Allowed, but the caller
    // must confirm — it is the one case where we cannot tell whose figures these are.
    const unnamespaced = !srcSlug;

    // …UNLESS ITS KEYS NAME AN OWNER (72-hour review). Stripping `slug` from another member's backup
    // made it read as legacy: accepted, re-keyed to `myb_pc_<me>_<them>_…`, and the REPLACE then
    // deleted the importer's own history for keys nothing reads. A genuine legacy key never begins
    // with a member's slug — the same test the ownership prompt uses (`keyOwnerSlug`).
    if (unnamespaced) {
        const owned = keys.find(k => keyOwnerSlug(k) !== null);
        if (owned) {
            const ownerSlug = keyOwnerSlug(owned);
            if (ownerSlug === currentSlug) {
                return { ok: false, error: `That backup is inconsistent (${shownKey(owned)}). Nothing was changed.` };
            }
            // keyOwnerSlug also names a FORMER member's slug (a key whose tail is one of our kinds), and
            // nobody can sign in as a name the roster no longer holds — so say what is true of it.
            if (keyOwnerSlug(`myb_pc_${ownerSlug}_`) === null) return { ok: false, error: NOT_ON_ROSTER };
            return { ok: false, error: `That backup belongs to ${_rosterName(ownerSlug)}. Sign in as them to restore it.` };
        }
        // …NOR AN OWNER THIS ROSTER DOES NOT HOLD (paycalc-2-19). `keyOwnerSlug` knows only the names
        // on the roster, so a file saved under any other, its slug stripped (`myb_pc_formername_p50`),
        // read as legacy — and the replace traded the importer's history for keys nothing reads. A
        // key whose tail is not a kind of ours but becomes one past its first segment is shaped
        // `<slug>_<key>`: it has an owner.
        const slugShaped = keys.find(k => {
            const tail = k.slice('myb_pc_'.length);
            const cut = tail.indexOf('_');
            return classifyPayKey(tail).kind === 'unknown' && cut > 0
                && classifyPayKey(tail.slice(cut + 1)).kind !== 'unknown';
        });
        if (slugShaped) return { ok: false, error: NOT_ON_ROSTER };
    }

    // Every key must actually sit under the slug the blob claims, or re-keying would mangle it.
    const srcPrefix = `myb_pc_${srcSlug ? srcSlug + '_' : ''}`;
    const stray = keys.find(k => !k.startsWith(srcPrefix));
    if (stray) {
        return { ok: false, error: `That backup is inconsistent (${shownKey(stray)}). Nothing was changed.` };
    }

    // SEMANTIC PREFLIGHT. Everything above is about the file's SHAPE; this is the first question
    // about its CONTENTS — do the entries that are supposed to be JSON actually parse? It NAMES
    // rather than refuses, for the reason argued in damagedEntries: a backup is often the only
    // copy left, and a corrupt period restored is visible and recoverable where a refused restore
    // leaves the member with nothing.
    return {
        // `srcSlug` is the slug every rule above CHECKED — the caller re-keys from this, never from
        // `blob.slug` again, so what was validated is what is written.
        ok: true, blob, unnamespaced, srcSlug,
        counts: summarise(keys, srcPrefix),
        inventory: inventoryOf(keys, srcPrefix),
        damaged: damagedEntries(blob.data, srcPrefix),
    };
}

/**
 * Re-key a validated blob's entries into the importing member's namespace.
 *
 * The blob records its SOURCE slug for exactly this reason: `myb_pc_ytd_pay_2026_27` cannot be split
 * into slug and tail by inspection (is the slug `ytd`?), so the source prefix has to be known rather
 * than guessed.
 *
 * @param {Record<string,string>} entries
 * @param {string} fromSlug '' for legacy unnamespaced data
 * @param {string} toSlug
 * @returns {Record<string,string>}
 */
export function rekeyEntries(entries, fromSlug, toSlug) {
    const from = `myb_pc_${fromSlug ? fromSlug + '_' : ''}`;
    const to   = `myb_pc_${toSlug ? toSlug + '_' : ''}`;
    /** @type {Record<string,string>} */
    const out = {};
    for (const [k, v] of Object.entries(entries)) {
        out[to + k.slice(from.length)] = v;
    }
    return out;
}

/**
 * The line a restore ends on: the payslips it brought back, the count a member reads back to us. A
 * backup can hold none — settings and Year to Date figures only — and "Restored 0 payslips" read as a
 * restore that did nothing (17 Nov 2026), so that one says what it was.
 * @param {{ periods: number }} counts  `validateBackup`'s `counts` @returns {string}
 */
export function restoredLine(counts) {
    const n = counts?.periods ?? 0;
    return n > 0 ? `Restored ${n} payslip${n === 1 ? '' : 's'}. Reloading…` : 'Restored your backup — it held no payslips. Reloading…';
}

/**
 * A filename a member can recognise in their Downloads folder months later — dated by the device's
 * own CALENDAR. Given the ISO instant, a copy saved between midnight and 01:00 in summer was named
 * for the day before (paycalc-2-21); the instant stays in the blob as `exportedAt`. A string is
 * still read as its first ten characters, for a caller that already holds a calendar date.
 * @param {string} member @param {Date|string} when
 */
export function backupFilename(member, when) {
    const day = when instanceof Date ? formatISO(when) : String(when).slice(0, 10);
    return `myb-pay-backup-${memberSlug(member) || 'device'}-${day}.json`;
}

/**
 * Apply a restore as an all-or-nothing REPLACE over a storage that cannot do transactions.
 *
 * ── WHY THIS IS A MODULE AND NOT A LOOP IN THE CARD (v19.84, external review P1) ───────────────
 *
 * The previous ladder lived inline in `paycalc-transfer-card.js` and had a hole that its own
 * comments show it was trying to avoid. It snapshotted only the keys that ALREADY EXISTED, so:
 *
 *   device holds        : old-period
 *   backup contains     : old-period, new-period-1, new-period-2
 *   storage fills up on : new-period-2
 *
 * Rollback restored `old-period` — and left `new-period-1` behind, because a key that did not
 * exist before was in neither the snapshot nor the rollback. The integrity check then looked at
 * the same original-keys-only snapshot, found it intact, and told the member **"nothing was
 * changed"** over a pay history that had just silently gained a period. That is precisely the
 * half-merged state the card's comments call the worst outcome, produced by the code meant to
 * prevent it.
 *
 * The fix is that the unit of work is the UNION of what is there and what is arriving — never
 * just one side. Rolling back a creation means DELETING it, not restoring a value it never had.
 *
 * ── THE SECOND HALF: A DELETE THAT FAILS IS ALSO A FAILED REPLACE ──────────────────────────────
 *
 * Surplus keys — present on the device, absent from the backup — must genuinely disappear, or the
 * "replace" is a merge wearing a replace's label. `lsDel` swallows storage errors exactly like
 * `lsSet` does, so the removals have to be READ BACK too. They were not, so a restore could report
 * success with the member's old periods still sitting underneath the new ones.
 *
 * ── DEPENDENCIES ARE INJECTED, DELIBERATELY ────────────────────────────────────────────────────
 *
 * `get`/`set`/`del` are passed in rather than imported from ls.js. This is the module that decides
 * whether somebody's entire pay history is overwritten, so its rules have to be testable against a
 * storage that FAILS ON DEMAND — which a real browser will not do to order, and which is the only
 * interesting case here. Every failure path below is exercised in paycalc-transfer.test.mjs.
 *
 * Ordering is load-bearing and unchanged from v19.17: WRITE first, verify, then delete the surplus.
 * The obvious wipe-then-write order makes the common failure catastrophic, because a swallowed
 * write error on a device that has stopped accepting writes leaves the member wiped and told
 * "Restored".
 *
 * ── THE THIRD HALF: A READ THAT FAILS IS NOT AN ABSENT KEY (Nov 2026) ──────────────────────────
 *
 * The snapshot of what was here used to be taken with `lsGet`, which answers null for a refused read
 * exactly as for a key that is not there. One refused read of an existing payslip, then one refused
 * write, and the rollback "put back" that payslip by DELETING it — and with the snapshot saying null
 * and the key now gone, the check agreed and the card said "nothing was changed". So every read here
 * is CHECKED (`lsGetChecked`):
 *
 *   · Before the first write, every original the restore will touch is read. Absent is recorded as
 *     CONFIRMED absence; a read that fails stops the restore with nothing written ('unreadable').
 *   · A write is verified only by a read that worked and matches.
 *   · A rollback puts each original back exactly — rewrites what had a value, deletes what was
 *     confirmed absent — and is then VERIFIED, key by key, with checked reads. `restored: true` only
 *     when every key reads back as it was; otherwise 'part-restored', which the card words as what it
 *     is: some of this device's pay data may now be the backup's.
 *   · A surplus key is gone only when a read that worked finds nothing.
 *
 * @param {object} io
 * @param {(k: string) => { ok: boolean, value: string|null }} io.read - a CHECKED read (`lsGetChecked`)
 * @param {(k: string, v: string) => void} io.set
 * @param {(k: string) => void} io.del
 * @param {string[]} io.existing - every pay key currently on the device
 * @param {Record<string,string>} io.entries - the keys/values to end up with
 * @returns {{ ok: true, restored: false }
 *          | { ok: false, reason: 'unreadable', restored: true, unreadable: string[] }
 *          | { ok: false, reason: 'write-failed', restored: true }
 *          | { ok: false, reason: 'part-restored', restored: false, unverified: string[] }
 *          | { ok: false, reason: 'surplus-remains', restored: false }}
 *   `restored` is meaningful only when `ok` is false: true means the device holds exactly what it held
 *   before, checked by reading it back — the only case the card may call "nothing was changed".
 */
export function applyRestore({ read, set, del, existing, entries }) {
    // THE UNION. Everything this operation could touch, from either side.
    const touched = [...new Set([...existing, ...Object.keys(entries)])];

    // WHAT WAS HERE, READ BEFORE ANYTHING IS WRITTEN. A value we could not read is a value we could not
    // put back, so the restore does not start.
    /** @type {Map<string, string|null>} */
    const before = new Map();
    /** @type {string[]} */
    const unreadable = [];
    for (const k of touched) {
        const r = read(k);
        if (r.ok) before.set(k, r.value);
        else unreadable.push(k);
    }
    if (unreadable.length) return { ok: false, reason: 'unreadable', restored: true, unreadable };

    /** Does `k` read back, by a read that WORKED, as `want` (null = confirmed absent)?
     *  @param {string} k @param {string|null} want */
    const holds = (k, want) => { const r = read(k); return r.ok && r.value === want; };

    for (const [k, v] of Object.entries(entries)) set(k, v);

    if (Object.entries(entries).some(([k, v]) => !holds(k, v))) {
        // Roll the WHOLE union back: rewrite what had a value, remove what was confirmed absent…
        for (const [k, v] of before) {
            if (v === null) del(k);
            else set(k, v);
        }
        // …and believe it only when every key reads back as it was.
        const unverified = [...before].filter(([k, v]) => !holds(k, v)).map(([k]) => k);
        return unverified.length
            ? { ok: false, reason: 'part-restored', restored: false, unverified }
            : { ok: false, reason: 'write-failed', restored: true };
    }

    // Only now remove what the backup does not contain. An own-property check, not `k in entries`:
    // `in` walks the prototype chain, so a key named `constructor` would report as present and
    // survive. `hasOwnProperty.call`, NOT `Object.hasOwn` (Safari 15.4+) — same call auth-policy.js
    // makes for the same reason: this module is the pay-data trust boundary, and it is the last
    // place that should hard-throw on an iPhone stuck below iOS 15.4 (v22.12).
    const surplus = [...existing].filter(k => !Object.prototype.hasOwnProperty.call(entries, k));
    for (const k of surplus) del(k);

    // …and verify it. A swallowed delete would otherwise be reported as a successful replace, and so
    // would a read that could not say.
    if (surplus.some(k => !holds(k, null))) {
        return { ok: false, reason: 'surplus-remains', restored: false };
    }

    return { ok: true, restored: false };
}
