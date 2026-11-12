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
 * ── EVERY WRITE IS A COMPARE-AND-SET ─────────────────────────────────────────
 * A key is written only if the file is still the object it was when its keys were read
 * (`ifGenerationMatch` + `ifMetagenerationMatch`): a new upload at the same path, or a second run in
 * another tab, makes the write fail with 412 instead of overwriting a key somebody else just issued.
 * A record moves only if its stored link is still EXACTLY the one read, token included. Either kind
 * of collision is counted in `changedDuringRun` and left for the next check — never a failure, and
 * never a guess.
 *
 * ── A PREVIEW UNLESS ASKED ───────────────────────────────────────────────────
 * Without `rotate: true` this reads and counts and writes nothing, so the admin sees what a run
 * would touch before anything changes. The READ phase is the only place this throws, and it comes
 * before the first write: "could not read" always means "nothing changed". Every write is caught
 * per file and reported in `failed`.
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
 * @property {number}  unlinkedWithKey      files no record points at that still carry a key
 * @property {number}  unlinkedWithoutKey   files no record points at, already without a key
 * @property {number}  held                 files a link this cannot read may open: never touched
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
 * @returns {Promise<RotationReport>}
 */
async function rotateDocumentLinks({ bucket, db, rotate = false, newKey, limit = DEFAULT_LIMIT }) {
    const collections = Object.values(DOC_KINDS).map(k => k.collection);

    // ── READ: which file each record's stored link opens ──────────────────────
    /** @type {Map<string, { ref: any, url: string }[]>} file path → the records whose stored link opens it, and that link as read */
    const linkedBy = new Map();
    /** Keys named by stored links this cannot read: a file carrying one is never touched. */
    const heldKeys = new Set();
    let recordsWithoutLink = 0;
    let recordsUnreadable = 0;
    for (const name of collections) {
        const snap = await db.collection(name).get();
        for (const doc of snap.docs) {
            const url = (doc.data() || {}).storageUrl;
            if (typeof url !== 'string' || !url) { recordsWithoutLink++; continue; }
            const path = pathOfDownloadUrl(url, bucket.name);
            // Into its OWN kind's folder or not at all: a circulars record opening a huddles file is
            // a defect to report, never a link to rewrite (the same binding as isSignablePathForKind).
            if (!path || !path.startsWith(`${name}/`)) {
                recordsUnreadable++;
                const held = tokenOfAnyLink(url);
                if (held) heldKeys.add(held);
                continue;
            }
            const refs = linkedBy.get(path) || [];
            refs.push({ ref: doc.ref, url });
            linkedBy.set(path, refs);
        }
    }
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
        files: files.length, linked: 0, unlinkedWithKey: 0, unlinkedWithoutKey: 0, held: 0,
        recordsMissingFile, recordsUnreadable, recordsWithoutLink,
        rotated: 0, cleared: 0, changedDuringRun: 0, failed: [],
    };

    /** @type {{ file: any, refs: { ref: any, url: string }[]|null, meta?: any }[]} */
    const plan = [];
    await eachLimited(files, limit, async (file) => {
        const refs = linkedBy.get(file.name);
        // A file's keys are read FRESH, not trusted from the listing, wherever they decide anything:
        // an unlinked file's decide whether a run touches it at all, and any file's decide whether a
        // link this cannot read may open it.
        let meta = null;
        if (!refs || heldKeys.size) {
            try { [meta] = await file.getMetadata(); }
            catch (_) { report.failed.push({ path: file.name, step: 'read' }); return; }
            if (keysOf(meta).some(k => heldKeys.has(k))) { report.held++; return; }
        }
        if (refs) { report.linked++; plan.push({ file, refs }); return; }
        if (keysOf(meta).length) { report.unlinkedWithKey++; plan.push({ file, refs: null, meta }); }
        else report.unlinkedWithoutKey++;
    });
    if (!report.rotate) return report;

    // ── WRITE: one file at a time per worker; nothing below may throw ─────────
    await eachLimited(plan, limit, async ({ file, refs, meta }) => {
        if (!refs) {
            try {
                // null REMOVES the key — and only from the object whose keys were counted.
                await file.setMetadata({ metadata: { [TOKEN_KEY]: null } }, sameObject(meta));
                report.cleared++;
            } catch (err) {
                if (changedUnderUs(err)) report.changedDuringRun++;
                else report.failed.push({ path: file.name, step: 'clear' });
            }
            return;
        }
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
            [expanded] = await file.setMetadata({ metadata: { [TOKEN_KEY]: [...kept, key].join(',') } }, sameObject(now));
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
            await file.setMetadata({ metadata: { [TOKEN_KEY]: key } }, sameObject(expanded));
            report.rotated++;
        } catch (err) {
            if (changedUnderUs(err)) report.changedDuringRun++;
            else report.failed.push({ path: file.name, step: 'contract' });
        }
    });
    return report;
}

module.exports = { rotateDocumentLinks, downloadUrl, pathOfDownloadUrl, keysOf, TOKEN_KEY };
