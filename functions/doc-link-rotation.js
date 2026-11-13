'use strict';
/**
 * functions/doc-link-rotation.js — give every stored Huddle, Circular and Newsletter file a NEW
 * link key, so that every copy of an old link stops opening it (ARCHITECTURE.md EXC-007;
 * AUTH_PLAN.md §5). Run from Operations → Document links, through `rotateDocumentLinks` in
 * ./documents.js, which owns the admin check.
 *
 * ── WHAT IS BEING REPLACED ───────────────────────────────────────────────────
 * Each document file sits in Storage with a permanent download link,
 *     https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<path>?alt=media&token=<key>
 * and the key is checked against the file's own `firebaseStorageDownloadTokens` metadata, NOT
 * against storage.rules: whoever holds the link opens the file. That is a BEARER link. The app
 * keeps one in each record's `storageUrl`, as the fallback for when a 15-minute signed link cannot
 * be fetched (owner, 7 Oct 2026 — DECISIONS.md). Copies of it also live wherever one was ever
 * handed out: a browser's history, a forwarded message, Microsoft's Office viewer. Replacing the
 * key kills all of them at once. The 15-minute links are signed from the file's PATH, never its
 * key (getDocumentUrl), so nothing a member normally opens is touched.
 *
 * ── THREE STEPS PER FILE: EXPAND, MIGRATE, CONTRACT ─────────────────────────
 *   1. EXPAND   — add the new key BESIDE the old one. Both open the file.
 *   2. MIGRATE  — point the record's stored link at the new key, in a transaction that changes it
 *                 only while the record still points at THIS file: an upload landing mid-run has
 *                 moved it to a new file with a fresh key of its own, and is left alone.
 *   3. CONTRACT — keep only the new key. Every old link dies here, and only here.
 * Between any two steps the stored link still opens the file, so a member whose short-lived link
 * fails mid-run is never handed a dead fallback. The obvious two-step version (swap the key, then
 * the record) is not: between them the stored link is dead, and if the record write fails it stays
 * dead until somebody notices. A failure here stops that ONE file at the step it reached, its old
 * link still working, and is reported; running again is safe, because a run only ever issues
 * another key.
 *
 * ── A FILE NO RECORD POINTS AT ───────────────────────────────────────────────
 * An older version, or a file a half-failed prune left behind (AUTH_PLAN §5 names that case as the
 * one retention can never reach). Nothing in the app opens it by link, so it LOSES its key and is
 * given none. It is not deleted: deleting is retention's decision, and a run that only ever takes
 * keys away cannot lose a document.
 *
 * ── OR A NEW UPLOAD THAT NO RECORD NAMES YET (review, 13 Nov 2026) ───────────
 * Both uploaders write the file, with its key, to a path no record has named, and write the record
 * after — ingestHuddle converts a Word Huddle in between; the Operations cards save the record once
 * the file is up (documents-client.js). For those seconds a new file looks exactly like an abandoned
 * one. This used to read the records, then list the files, and take such a file for unused: its only
 * key was switched off, its record arrived holding a dead link, the run reported success, and the
 * next check saw nothing wrong. So, as `sweepHuddleOrphans` (./huddle-retention.js) does before it
 * deletes one, two checks stand between an unused file and losing its key:
 *   · AGE. A file younger than UNLINKED_MIN_AGE_MS (a day; why that long: the constant) keeps its
 *     key, and so does one whose age cannot be read; it is counted in `unlinkedTooNew`, for a run the
 *     next day.
 *   · A SECOND LOOK. Once the plan is made, and before the first write, the records are read again,
 *     and an unused file one of them names by then is left alone (`changedDuringRun`). That is for
 *     the record the age cannot see: one that arrives after its file has grown old — a phone that
 *     lost its signal between saving the file and saving the record sends the record when it next
 *     connects, which may be days later.
 * The unused files are written first, straight after that look, so the window it leaves is as short as
 * it can be. A record later still — after the key has gone — is the one case neither check reaches: it
 * arrives holding a link that no longer opens its file. The next check counts it, and Replace mends it
 * (below).
 *
 * ── A STORED LINK THAT NO LONGER OPENS ITS FILE (13 Nov 2026) ────────────────
 * A record can hold a link whose key its file no longer carries. Three ways: the late record above;
 * a browser's record write re-sent after its acknowledgement was lost, which puts the upload's first
 * link back over the one a run had given it (documents-client.js says why that write is not guarded);
 * and, until it was guarded, ingestHuddle's record transaction run again after a lost commit answer
 * (./documents.js). Members still open the document, because the 15-minute link is signed from the
 * PATH — only the fallback is broken, the link a member is handed when that cannot be had. Such a
 * record is counted in `recordsDeadLink`, and only on a file a run will rotate, because a run is what
 * mends it: MIGRATE moves a dead link onto the new key exactly as it moves a working one, so the record
 * ends the run opening its file. A dead link on a HELD file is not counted: a run leaves that file
 * alone, so Replace could not mend it.
 *
 * ── EVERY FILE'S KEYS ARE READ FRESH, NEVER FROM THE LISTING ────────────────
 * The keys are read from the file itself wherever they decide anything: whether a run touches an
 * unused file at all, whether a link this cannot read may open a file, and whether each record of a
 * file in use still opens it (`recordsDeadLink`). The last decides no write — a run moves a dead link
 * exactly as it moves a working one — and the listing already carries the keys, for nothing. It is
 * read fresh all the same, for two reasons. It is the only way the admin learns that a stored link is
 * broken, and Replace is pressed on its word. And the listing carries the keys only incidentally: one
 * that arrived without them — a narrower field list, a library change — would report every stored
 * link in the app as broken, where a fresh read that fails is counted as a file it could not check.
 * The cost is one read per file per check, a few hundred at most; a run's first step still reads the
 * keys again immediately before it writes.
 *
 * ── EVERY WRITE IS A COMPARE-AND-SET ─────────────────────────────────────────
 * A key is written only if the file is still the object it was when its keys were read
 * (`ifGenerationMatch` + `ifMetagenerationMatch`): a new upload at the same path, or a second run in
 * another tab, makes the write fail with 412 instead of overwriting a key somebody else just issued.
 * A record moves only if its stored link is still EXACTLY the one read, token included. Either kind
 * of collision is counted in `changedDuringRun` and left for the next check — never a failure, and
 * never a guess.
 *
 * **But a refusal is not always somebody else's write.** The storage library retries a guarded write
 * whose answer was lost, and the retry — still naming the metageneration the first attempt moved past
 * — is refused with 412; Firestore re-runs a transaction whose commit answer was lost in the same way.
 * Read as a collision, a key that DID change was reported as left alone, and a record that DID move
 * kept its file's old key alive. So a refused key write reads the file back (`writeKeys`), and counts
 * it as this run's own when it is the same object carrying exactly the keys this run wrote: nobody
 * else knows a key this run made up, and a file with no key is cleared, whoever cleared it. A record
 * already holding the link this run is writing moved in this run's own earlier attempt, for the same
 * reason. Anything else is still a change.
 *
 * ── A PREVIEW UNLESS ASKED ───────────────────────────────────────────────────
 * Without `rotate: true` this reads and counts and writes nothing, so the admin sees what a run
 * would touch before anything changes. The READS — the records, the listing, and the second look at
 * the records before a run switches an unused file's key off — are the only place this throws, and all
 * of them come before the first write: "could not read" always means "nothing changed". Every write is
 * caught per file and reported in `failed`.
 *
 * ── WHAT IT LEAVES ALONE ─────────────────────────────────────────────────────
 * A record whose stored link this cannot read as a download link into its own folder of this
 * bucket (`recordsUnreadable`), and one with no stored link at all. Both are counted, never
 * written: a link this code does not understand is not one it may rewrite. **Nor one it may
 * break**: such a link may still open a file — another bucket name, another host, a record in the
 * wrong folder — and that file would otherwise look unused and lose its key. So any `token` such a
 * link carries is HELD, and a file carrying a held key is not touched at all (`held`).
 *
 * Requires nothing at load time beyond ./doc-url-core.js — the bucket, Firestore and the key maker
 * are passed in — so it runs in the no-install lane against plain fakes.
 */

const { DOC_KINDS } = require('./doc-url-core');

/** The custom metadata key Firebase Storage checks a download link's `token` against. */
const TOKEN_KEY = 'firebaseStorageDownloadTokens';
const DOWNLOAD_HOST = 'firebasestorage.googleapis.com';
/** Files handled at once. Enough to finish a few hundred files well inside the endpoint's limit. */
const DEFAULT_LIMIT = 4;

/**
 * How old an unused file must be before it loses its key (the header: a new upload is named by
 * nothing until its record lands). It must outlast the slowest upload between its file and its
 * record. The slowest designed path is the ingest converting a Word Huddle, which the function's
 * 60-second limit bounds; the Operations card saves its record seconds after the file — unless the
 * connection drops in between, when Firestore keeps the write and sends it on reconnecting, and the
 * persistent cache keeps it even across a closed app. A DAY covers all of that by a wide margin: the
 * same day, for the same reason, as HUDDLE_ORPHAN_MIN_AGE_MS (./huddle-retention.js). It costs little:
 * an unused file younger than a day keeps its key until a run the next day, and the report says so.
 */
const UNLINKED_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The permanent link for `path` under `key` — the shape ingestHuddle writes and the browser's
 * getDownloadURL returns.
 * @param {string} bucketName
 * @param {string} path
 * @param {string} key
 */
function downloadUrl(bucketName, path, key) {
    return `https://${DOWNLOAD_HOST}/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${key}`;
}

/**
 * The file a stored link opens, or null when it is not a download link into this bucket.
 * @param {any} url
 * @param {string} bucketName
 * @returns {string|null}
 */
function pathOfDownloadUrl(url, bucketName) {
    if (typeof url !== 'string' || !url) return null;
    let u;
    try { u = new URL(url); } catch (_) { return null; }
    if (u.protocol !== 'https:' || u.hostname !== DOWNLOAD_HOST) return null;
    // The object name is ONE encoded segment (its slashes are %2F), which the URL parser leaves encoded.
    const m = /^\/v0\/b\/([^/]+)\/o\/([^/]+)$/.exec(u.pathname);
    if (!m || m[1] !== bucketName) return null;
    try { return decodeURIComponent(m[2]); } catch (_) { return null; }
}

/**
 * The keys a file carries now, in order.
 * @param {any} metadata  the object resource `file.getMetadata()` resolves with
 * @returns {string[]}
 */
function keysOf(metadata) {
    const raw = metadata && metadata.metadata && metadata.metadata[TOKEN_KEY];
    return typeof raw === 'string' ? raw.split(',').map(k => k.trim()).filter(Boolean) : [];
}

/**
 * The `token` any link carries, readable or not — what a held link could still open a file with.
 * @param {string} url
 * @returns {string|null}
 */
function tokenOfAnyLink(url) {
    try { return new URL(url).searchParams.get('token') || null; }
    catch (_) {
        const m = /[?&]token=([^&#\s]+)/.exec(url);
        if (!m) return null;
        try { return decodeURIComponent(m[1]); } catch (__) { return m[1]; }
    }
}

/**
 * The precondition that makes a metadata write a compare-and-set: only the object, and only the
 * metadata, that `metadata` was read from.
 * @param {any} metadata  an object resource, from getMetadata or the last setMetadata
 */
function sameObject(metadata) {
    return { ifGenerationMatch: metadata.generation, ifMetagenerationMatch: metadata.metageneration };
}

/**
 * A write refused because the file changed since it was read (412), or went (404): a re-upload
 * deletes the file it replaced once its record has moved, and retention deletes old ones.
 * @param {any} err
 */
function changedUnderUs(err) {
    const code = err && (err.code ?? err.status);
    return code === 412 || code === 404;
}

/**
 * Make `keys` a file's only keys — none at all for an empty list — on the object `before` was read
 * from and nothing else. When that is refused as stale, read the file back: the same object carrying
 * exactly these keys means the write landed — the storage library RETRIED it after its answer was
 * lost, and nobody else knows a key this run made up — or, for no keys, that somebody else's clear
 * left the file just as this one would have (the header). The one place a key is written.
 * @param {any} file
 * @param {any} before  the object resource the write is guarded on
 * @param {string[]} keys
 * @returns {Promise<any>} the object resource after the write
 * @throws the refusal itself when the write did not land, or any other failure
 */
async function writeKeys(file, before, keys) {
    try {
        // null REMOVES the key.
        const [after] = await file.setMetadata({ metadata: { [TOKEN_KEY]: keys.length ? keys.join(',') : null } },
            sameObject(before));
        return after;
    } catch (err) {
        if (!changedUnderUs(err)) throw err;
        /** @type {any} */
        let now = null;
        try { [now] = await file.getMetadata(); } catch (_) { /* gone, or unreadable: the refusal stands */ }
        if (now && String(now.generation) === String(before.generation) && keysOf(now).join(',') === keys.join(',')) {
            return now;
        }
        throw err;
    }
}

/**
 * Read every record's stored link: which file each one opens, and the keys of the links this cannot
 * read. Read once before the files are listed, and again before a run clears anything (the header).
 * @param {any} db
 * @param {string[]} collections
 * @param {string} bucketName
 */
async function readRecords(db, collections, bucketName) {
    /** @type {Map<string, { ref: any, url: string }[]>} file path → the records whose stored link opens it, and that link as read */
    const linkedBy = new Map();
    /** Keys named by stored links this cannot read: a file carrying one is never touched. */
    const heldKeys = new Set();
    let withoutLink = 0;
    let unreadable = 0;
    for (const name of collections) {
        const snap = await db.collection(name).get();
        for (const doc of snap.docs) {
            const url = (doc.data() || {}).storageUrl;
            if (typeof url !== 'string' || !url) { withoutLink++; continue; }
            const path = pathOfDownloadUrl(url, bucketName);
            // Into its OWN kind's folder or not at all: a circulars record opening a huddles file is
            // a defect to report, never a link to rewrite (the same binding as isSignablePathForKind).
            if (!path || !path.startsWith(`${name}/`)) {
                unreadable++;
                const held = tokenOfAnyLink(url);
                if (held) heldKeys.add(held);
                continue;
            }
            const refs = linkedBy.get(path) || [];
            refs.push({ ref: doc.ref, url });
            linkedBy.set(path, refs);
        }
    }
    return { linkedBy, heldKeys, withoutLink, unreadable };
}

/**
 * Run `fn` over `items`, at most `limit` at a time.
 * @template T
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<void>} fn
 */
async function eachLimited(items, limit, fn) {
    let next = 0;
    const worker = async () => {
        while (next < items.length) await fn(items[next++]);
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

/**
 * @typedef {object} RotationReport
 * @property {boolean} rotate               false: a preview, and nothing was changed
 * @property {number}  files                files found in the three document folders
 * @property {number}  linked               of those, files a record's stored link opens
 * @property {number}  unlinkedWithKey      files no record points at that still carry a key — old enough to lose it
 * @property {number}  unlinkedTooNew       files no record points at that still carry a key, but younger than
 *                                          UNLINKED_MIN_AGE_MS or of unknown age: an upload may still be writing
 *                                          their record, so they keep it, for a run the next day
 * @property {number}  unlinkedWithoutKey   files no record points at, already without a key
 * @property {number}  held                 files a link this cannot read may open: never touched
 * @property {number}  recordsDeadLink      records of files in use whose stored link names a key the file no
 *                                          longer carries: dead until a run moves them onto the new key
 * @property {number}  recordsMissingFile   records whose stored link opens a file that is not there
 * @property {number}  recordsUnreadable    records whose stored link this cannot read (left alone)
 * @property {number}  recordsWithoutLink   records with no stored link at all
 * @property {number}  rotated              files given a new key, their records moved onto it
 * @property {number}  cleared              unlinked files whose key was taken away
 * @property {number}  changedDuringRun     files an upload or another run changed mid-run: left alone
 * @property {{ path: string, step: 'read'|'expand'|'migrate'|'contract'|'clear' }[]} failed
 */

/**
 * Preview, or carry out, the rotation. See the header for every rule.
 * @param {object} deps
 * @param {any} deps.bucket           the Storage bucket (`getStorage().bucket()`)
 * @param {any} deps.db               Firestore (`getFirestore()`)
 * @param {boolean} [deps.rotate]     true to change anything; anything else is a preview
 * @param {() => string} deps.newKey  a fresh, unguessable key (`crypto.randomUUID`)
 * @param {number} [deps.limit]       files handled at once
 * @param {number} [deps.nowMs]      the moment an unused file's age is measured from (default: now)
 * @returns {Promise<RotationReport>}
 */
async function rotateDocumentLinks({ bucket, db, rotate = false, newKey, limit = DEFAULT_LIMIT, nowMs = Date.now() }) {
    const collections = Object.values(DOC_KINDS).map(k => k.collection);

    // ── READ: which file each record's stored link opens ──────────────────────
    const { linkedBy, heldKeys, withoutLink: recordsWithoutLink, unreadable: recordsUnreadable } =
        await readRecords(db, collections, bucket.name);
    /** @type {any[]} */
    const files = [];
    for (const name of collections) {
        const [found] = await bucket.getFiles({ prefix: `${name}/` });
        files.push(...found);
    }
    const present = new Set(files.map(f => f.name));
    let recordsMissingFile = 0;
    for (const [path, refs] of linkedBy) if (!present.has(path)) recordsMissingFile += refs.length;

    /** @type {RotationReport} */
    const report = {
        rotate: rotate === true,
        files: files.length, linked: 0, unlinkedWithKey: 0, unlinkedTooNew: 0, unlinkedWithoutKey: 0, held: 0,
        recordsDeadLink: 0, recordsMissingFile, recordsUnreadable, recordsWithoutLink,
        rotated: 0, cleared: 0, changedDuringRun: 0, failed: [],
    };

    /** @type {{ file: any, refs: { ref: any, url: string }[]|null, meta?: any, namedSince?: boolean }[]} */
    const plan = [];
    await eachLimited(files, limit, async (file) => {
        const refs = linkedBy.get(file.name);
        // EVERY file's keys are read FRESH, never trusted from the listing (the header says why). An
        // unused file's age is read from the same answer, so it is the age of the very object a clear
        // is guarded on.
        let meta;
        try { [meta] = await file.getMetadata(); }
        catch (_) { report.failed.push({ path: file.name, step: 'read' }); return; }
        const keys = keysOf(meta);
        if (keys.some(k => heldKeys.has(k))) { report.held++; return; }
        if (refs) {
            report.linked++;
            // A stored link naming a key this file no longer carries: dead, and mended by a run (the header).
            report.recordsDeadLink += refs.filter(({ url }) => !keys.includes(tokenOfAnyLink(url) ?? '')).length;
            plan.push({ file, refs });
            return;
        }
        if (!keys.length) { report.unlinkedWithoutKey++; return; }
        // Too new to be sure nothing will name it: an upload may still be writing its record (the
        // header). An age that cannot be read is not old enough — a stray key costs one more run, a
        // switched-off one is a record holding a dead link.
        const created = Date.parse((meta && meta.timeCreated) || '');
        if (!Number.isFinite(created) || nowMs - created < UNLINKED_MIN_AGE_MS) { report.unlinkedTooNew++; return; }
        report.unlinkedWithKey++;
        plan.push({ file, refs: null, meta });
    });
    if (!report.rotate) return report;

    // ── A SECOND LOOK at the records — before the first write, so it may still throw ──
    // A record written since the first read can name a file that read found unused (the header).
    const clears = plan.filter(p => !p.refs);
    if (clears.length) {
        const again = await readRecords(db, collections, bucket.name);
        for (const p of clears) {
            p.namedSince = again.linkedBy.has(p.file.name) || keysOf(p.meta).some(k => again.heldKeys.has(k));
        }
    }

    // ── WRITE: the unused files first, straight after that look; nothing below may throw ──
    await eachLimited(clears, limit, async ({ file, meta, namedSince }) => {
        if (namedSince) { report.changedDuringRun++; return; }
        try {
            // Only from the object whose keys were counted.
            await writeKeys(file, meta, []);
            report.cleared++;
        } catch (err) {
            if (changedUnderUs(err)) report.changedDuringRun++;
            else report.failed.push({ path: file.name, step: 'clear' });
        }
    });
    await eachLimited(plan.filter(p => p.refs), limit, async ({ file, refs }) => {
        // 1 · EXPAND — the old keys stay, so the stored link keeps opening the file.
        let key;
        /** @type {any} */
        let expanded;
        try {
            key = newKey();
            if (typeof key !== 'string' || !key) throw new Error('no key');
            const [now] = await file.getMetadata();
            const kept = keysOf(now).filter(k => k !== key);
            if (kept.some(k => heldKeys.has(k))) { report.held++; return; }
            expanded = await writeKeys(file, now, [...kept, key]);
        } catch (err) {
            if (changedUnderUs(err)) report.changedDuringRun++;
            else report.failed.push({ path: file.name, step: 'expand' });
            return;
        }
        // 2 · MIGRATE — only a record that still points at this file.
        const url = downloadUrl(bucket.name, file.name, key);
        let moved = 0;
        try {
            for (const { ref, url: was } of refs) {
                const changed = await db.runTransaction(async (/** @type {any} */ tx) => {
                    const snap = await tx.get(ref);
                    const now = snap.exists ? (snap.data() || {}) : null;
                    // Already this run's new link: an earlier attempt of THIS transaction committed and
                    // its answer was lost, so Firestore ran it again (the header). Nobody else knows `key`.
                    if (now && now.storageUrl === url) return true;
                    // Only a record nobody has written since it was read: an upload that moved it, or
                    // replaced the file at the same path, has given it a link of its own.
                    if (!now || now.storageUrl !== was) return false;
                    tx.update(ref, { storageUrl: url });
                    return true;
                });
                if (!changed) moved++;
            }
        } catch (_) { report.failed.push({ path: file.name, step: 'migrate' }); return; }
        // Every record was rewritten by somebody else: the file is left as it is — with the spare
        // key, which nobody holds — for the next check to find, rather than contracted under records
        // that have left it.
        if (moved === refs.length) { report.changedDuringRun++; return; }
        // 3 · CONTRACT — only now does any old link stop working, and only on the object expanded.
        try {
            await writeKeys(file, expanded, [key]);
            report.rotated++;
        } catch (err) {
            if (changedUnderUs(err)) report.changedDuringRun++;
            else report.failed.push({ path: file.name, step: 'contract' });
        }
    });
    return report;
}

module.exports = { rotateDocumentLinks, downloadUrl, pathOfDownloadUrl, keysOf, TOKEN_KEY, UNLINKED_MIN_AGE_MS };
