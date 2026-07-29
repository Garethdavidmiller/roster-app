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
 * the server — see the MILLER_ACTUALS decision in ARCHITECTURE_PLAN.md).
 *
 * Every function here is PURE. That is the point: the import path decides whether to overwrite a
 * member's entire pay history, so its rules have to be testable without a browser, a file picker,
 * or a live localStorage.
 */

import { DEVICE_KEYS, memberSlug } from './paycalc-migrations.js';

/** Identifies our own blobs. A file that does not carry this is not ours, whatever its extension. */
export const BACKUP_FORMAT = 'myb-paycalc-backup';

/** Schema version. Bump when the blob's SHAPE changes; a newer blob is refused by an older app. */
export const BACKUP_VERSION = 1;

/**
 * Every paycalc key is built from `pcPrefix()` + an alphanumeric/underscore tail (`p16`,
 * `hpp_est_2026_27`, `bp_state_2026_27`, `snap_16`, `actuals`, …). Nothing else is legitimate, so
 * anything else in an imported blob is refused rather than written.
 */
const KEY_RE = /^myb_pc_[A-Za-z0-9_]+$/;

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
 * Summarise a set of keys in terms a member recognises — payslips and tax years, not key counts.
 * @param {string[]} keys
 * @param {string} prefix
 */
export function summarise(keys, prefix) {
    const tail = (/** @type {string} */ k) => k.slice(prefix.length);
    const periods = keys.filter(k => /^p\d+$/.test(tail(k))).length;
    const years = new Set(
        keys.map(k => (/(?:hpp_est|hpp_mode|bp_state|ytd_pay|ytd_tax)_(\d{4}_\d{2})$/.exec(tail(k)) || [])[1])
            .filter(Boolean),
    );
    return { periods, taxYears: years.size, keys: keys.length };
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
 *          | { ok: true, blob: any, unnamespaced: boolean, counts: {periods:number,taxYears:number,keys:number} }}
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
    if (typeof blob.version !== 'number' || blob.version > BACKUP_VERSION) {
        return { ok: false, error: 'That backup was made by a newer version of the app. Update this device first.' };
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
        return { ok: false, error: `That backup contains something that isn't pay data (${badKey}). Nothing was changed.` };
    }
    const badValue = keys.find(k => typeof blob.data[k] !== 'string');
    if (badValue) {
        return { ok: false, error: `That backup is damaged (${badValue}). Nothing was changed.` };
    }

    const srcSlug = typeof blob.slug === 'string' ? blob.slug : '';

    // Option A — refuse a different member outright. Staff share devices (which is precisely why
    // the per-member namespacing exists), and pay history is the most sensitive thing this app
    // holds. The legitimate cross-member case is rare enough to handle by signing in as that person.
    if (srcSlug && srcSlug !== currentSlug) {
        // `member` is attacker-controlled text from the file. It is only ever rendered via
        // textContent, so it cannot inject — but it is unbounded, so cap it rather than let a
        // pathological string stretch the card.
        const named = typeof blob.member === 'string' && blob.member.trim();
        const who = named ? named.slice(0, 40) : 'someone else';
        return { ok: false, error: `That backup belongs to ${who}. Sign in as them to restore it.` };
    }

    // Legacy data saved before per-member namespacing has no owner recorded. Allowed, but the caller
    // must confirm — it is the one case where we cannot tell whose figures these are.
    const unnamespaced = !srcSlug;

    // Every key must actually sit under the slug the blob claims, or re-keying would mangle it.
    const srcPrefix = `myb_pc_${srcSlug ? srcSlug + '_' : ''}`;
    const stray = keys.find(k => !k.startsWith(srcPrefix));
    if (stray) {
        return { ok: false, error: `That backup is inconsistent (${stray}). Nothing was changed.` };
    }

    return { ok: true, blob, unnamespaced, counts: summarise(keys, srcPrefix) };
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
 * A filename a member can recognise in their Downloads folder months later.
 * @param {string} member @param {string} isoDate
 */
export function backupFilename(member, isoDate) {
    return `myb-pay-backup-${memberSlug(member) || 'device'}-${isoDate.slice(0, 10)}.json`;
}
