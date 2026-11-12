'use strict';

/**
 * functions/huddle-retention.js — how long a Daily Huddle is kept, and what its clean-up may delete.
 * Called by `ingestHuddle` (documents.js) at the end of every upload; it owns no endpoint.
 *
 * ── IT MUST DELETE ONLY WHAT IT SELECTED (v25.89, external review) ──────────────────────────────
 *
 * The prune used to delete a stale Huddle's document and then every Storage object under that
 * date's prefix. The query is a snapshot, so an upload for the same date landing between the two
 * kept its new document and lost its file: a Huddle pointing at nothing. Now each document is
 * re-read inside a transaction and left alone if a replacement has moved its `storagePath`, and
 * only THAT version's object is deleted, by name — the shape `pruneOldDocs` (doc-retention.js)
 * already had for Circulars and Newsletters. Anything else under the date goes only through
 * `sweepHuddleOrphans`, which an upload in flight cannot reach.
 *
 * Moved out of documents.js at v25.89 because it is a rule with its own race tests, and because
 * documents.js would otherwise have crossed the coordinator ratchet's 900 lines. It REQUIRES no
 * Firebase SDK: Firestore, the bucket and the London clock are passed in, so the test's fakes (which
 * documents-endpoints.test.mjs swaps between builds) always reach it.
 */

const { parseStrictIsoDate } = require('./roster-parse-helpers');

// Number of months of Huddle history to retain. Huddles are daily and short-lived in
// usefulness; older ones are pruned so the collection and Storage stay bounded. Circulars
// and newsletters keep 6 months (browser-side pruneOldDocs, doc-retention.js); huddles are higher-volume and
// less referenced after the day, so 3 months is enough.
const HUDDLE_RETENTION_MONTHS = 3;

/**
 * An object younger than this is never swept as an orphan: it may belong to an upload that is still
 * writing its document — the ingest saves the FILE first and the metadata after, seconds apart, and in
 * between the file is named by nothing. A day is far longer than any request can run.
 */
const HUDDLE_ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Delete Huddle Firestore docs (and their Storage objects) older than HUDDLE_RETENTION_MONTHS. Each
 * huddle doc's ID is its "YYYY-MM-DD" date and the same value is stored in the `date` field, so a
 * string range query on `date` finds the stale ones (ISO date strings sort lexicographically the same
 * as chronologically). Firestore is deleted first, then Storage — a partial failure leaves an orphaned
 * Storage object (invisible to staff) rather than a Firestore doc pointing at a deleted file (a
 * user-facing broken link). What it may delete, and why only that: this file's header.
 *
 * @param {string} excludeDate  The date just written — never pruned even if the clock is odd.
 * @param {{ db: any, bucket: any, nowInLondon: () => {year: number, month: number, day: number} }} deps
 *        Firestore, the default bucket, and the TZ-independent London calendar date (index.js).
 * @returns {Promise<void>}
 */
async function pruneOldHuddles(excludeDate, { db, bucket, nowInLondon }) {
    // Clamp the day to the last valid day of the target month — a bare
    // setMonth(getMonth() - N) overflows on a month-end run (e.g. 31 May → 31 Feb →
    // 3 Mar), which would over-prune by a few days. Mirrors pruneOldDocs in
    // doc-retention.js (the browser circular/newsletter prune).
    // nowInLondon (v16.23): huddle dates are London dates; a bare new Date() on UTC Cloud Run
    // skews the 3-month cutoff by a day during BST (midnight–1am London) — the pay reminder
    // already derives London dates this way. nowInLondon returns
    // {year, month, day} parts; rebuild a Date carrying the LONDON calendar date so the
    // month-arithmetic below is TZ-independent.
    // NOTE: the month-underflow clamp below (daysInTargetMonth + Math.min) is the SAME algorithm as
    // storage-utils.js `sixMonthCutoffISO` — the browser circular/newsletter 6-month prune. Kept as a
    // deliberate duplicate because Cloud Functions are CommonJS and can't import the browser ES module
    // (same boundary as normaliseSurname); if the clamp logic changes, update BOTH. (cross-file review E5)
    const ldn = nowInLondon();
    const now = new Date(ldn.year, ldn.month, ldn.day);
    const tm  = now.getMonth() - HUDDLE_RETENTION_MONTHS;
    const daysInTargetMonth = new Date(now.getFullYear(), tm + 1, 0).getDate();
    const cutoff = new Date(now.getFullYear(), tm, Math.min(now.getDate(), daysInTargetMonth));
    const cutoffISO = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;   // "YYYY-MM-DD"

    const stale  = await db.collection('huddles').where('date', '<', cutoffISO).get();
    if (stale.empty) return;

    await Promise.allSettled(stale.docs.map(async docSnap => {
        if (docSnap.id === excludeDate) return;
        // Defensive re-validation before anything DESTRUCTIVE: every object path below is checked to sit
        // under `huddles/<id>`, so a malformed/truncated id (e.g. "2026-07") would widen that to a whole
        // month. No current write path can produce one (huddle ids are the strict YYYY-MM-DD date,
        // doc-id === the `date` field), but a hand-created or corrupted doc must never widen it.
        // parseStrictIsoDate enforces the exact format + a real calendar date.
        if (!parseStrictIsoDate(docSnap.id)) {
            console.warn(`[pruneOldHuddles] Skipping doc with a non-date id (not swept): ${docSnap.id}`);
            return;
        }
        const prefix   = `huddles/${docSnap.id}`;
        const selected = (docSnap.data() || {}).storagePath ?? null;   // the version this sweep chose
        // Firestore FIRST — a partial failure must leave a harmless orphan, never a doc pointing at a
        // deleted file. If the doc delete fails or stands down, nothing in Storage is touched.
        let removed;
        try {
            removed = await db.runTransaction(async tx => {
                const cur = await tx.get(docSnap.ref);
                if (!cur.exists) return false;                                          // already gone
                if (((cur.data() || {}).storagePath ?? null) !== selected) return false; // replaced under us
                tx.delete(docSnap.ref);
                return true;
            });
        } catch (e) {
            console.error(`[pruneOldHuddles] Firestore delete ${docSnap.id} failed (Storage NOT swept):`, e.message);
            return;
        }
        if (!removed) {
            console.log(`[pruneOldHuddles] ${docSnap.id} changed since the query — left alone`);
            return;
        }
        // THE VERSION SELECTED, BY NAME — and only one under this date's own prefix, so a corrupted
        // `storagePath` can never reach another date's file.
        if (typeof selected === 'string' && selected.startsWith(prefix)) {
            await bucket.file(selected).delete().catch(e =>
                console.warn(`[pruneOldHuddles] Storage delete ${selected} failed (orphaned):`, e.message));
        }
        try {
            await sweepHuddleOrphans(bucket, db, docSnap.id, Date.now());
        } catch (e) {
            console.warn(`[pruneOldHuddles] Orphan sweep for ${docSnap.id} failed (left for the next run):`, e.message);
        }
    }));
    console.log(`[pruneOldHuddles] Pruned huddles older than ${cutoffISO}`);
}

/**
 * Reclaim the objects of one pruned date that no document names: an EARLIER version a failed read left
 * behind (the ingest's targeted clean-up needs the previous path, and that read is not fatal), and the
 * legacy pre-v13.99 `<date>.<ext>` names. A plain prefix sweep is what deleted a replacement upload's
 * file (v25.89, external review), because an upload saves its file before its document and in between
 * nothing names it. So an object goes only when BOTH hold: it is older than HUDDLE_ORPHAN_MIN_AGE_MS,
 * which no upload in flight can be; and the date's document, read AFTER listing, does not name it. An
 * object whose age is unknown is kept — a stray file costs storage, a deleted live one is a broken link.
 * @param {any} bucket @param {any} db @param {string} date a validated YYYY-MM-DD @param {number} nowMs
 * @returns {Promise<void>}
 */
async function sweepHuddleOrphans(bucket, db, date, nowMs) {
    const [files] = await bucket.getFiles({ prefix: `huddles/${date}` });
    if (!files.length) return;
    const live = await db.collection('huddles').doc(date).get();
    const livePath = live.exists ? (live.data() || {}).storagePath : null;
    await Promise.all(files.map(async f => {
        if (f.name === livePath) return;
        const created = Date.parse((f.metadata && f.metadata.timeCreated) || '');
        if (!Number.isFinite(created) || nowMs - created < HUDDLE_ORPHAN_MIN_AGE_MS) return;
        await f.delete().catch(e => console.warn(`[pruneOldHuddles] Storage delete ${f.name} failed (orphaned):`, e.message));
    }));
}

module.exports = { pruneOldHuddles, sweepHuddleOrphans, HUDDLE_RETENTION_MONTHS, HUDDLE_ORPHAN_MIN_AGE_MS };
