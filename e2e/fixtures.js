/**
 * Playwright fixtures — hermetic Firebase for the smoke suite.
 *
 * WHY THIS EXISTS (the root cause of the "takes ages then all fails" CI flake):
 * Every app page statically imports `./firebase-client.js`, which in turn
 * statically imports the Firebase SDK from `https://www.gstatic.com/firebasejs/...`.
 * In ES modules a static import that fails to resolve aborts the WHOLE module
 * graph — so if that CDN is slow, throttled, or blocked on the CI runner, none
 * of the app's JavaScript ever runs. The calendar never renders, dropdowns stay
 * empty, the operations/links redirects never fire, and every assertion times
 * out. No timeout increase or retry count can fix a hard dependency failure —
 * which is why the earlier timeout/retry/reporter tweaks never stuck.
 *
 * The smoke suite explicitly does NOT test Firestore (see smoke.spec.js header).
 * So we intercept the gstatic Firebase modules and serve tiny local stubs that
 * export every symbol `firebase-client.js` imports. firebase-client.js then
 * loads instantly with no network, the real app JS runs, and the tests verify
 * what they are meant to: that our own code renders and behaves correctly.
 *
 * Production is unchanged — this stubbing lives only in the test fixture, so the
 * CDN-only architecture (no bundler) is preserved.
 */

import { test as base, expect } from '@playwright/test';
// The key the app keeps the latest Newsletter's date under — the app's own constant, so there is one spelling.
import { NEWSLETTER_LATEST_KEY } from '../newsletter-recency.js';

// A valid ES module exporting every name firebase-client.js pulls from the
// three gstatic SDK entrypoints (app, firestore, auth) plus the lazily-imported
// storage entrypoint. All three import URLs are served this same body — extra
// exports an importer doesn't name are simply ignored. Reads resolve to empty
// snapshots and writes resolve to no-ops, so offline-first app code that awaits
// Firestore never throws an unfiltered error.
const FIREBASE_STUB = `
const noop = () => {};
const marker = (tag) => ({ __stub: tag });

// ---- firebase-app ----
export const initializeApp = () => marker('app');

// ---- firestore ----
export const initializeFirestore = () => marker('db');
export const getFirestore = () => marker('db');
export const persistentLocalCache = () => marker('cache');
// collection() carries its PATH (v21.04) so getDocs can serve different collections different
// rows. Every other stub keeps the plain marker shape; nothing reads collection refs beyond
// getDocs, which falls back to the shared docs array when no per-path seed exists.
export const collection = (/** @type {any} */ _db, /** @type {any} */ path) => ({ __stub: 'collection', path });
// query() keeps the collection it asks (queryOf, Nov 2026), so getDocs can answer one collection's query
// from window.__E2E.docsByQuery and every other read exactly as before. (No backticks: inside FIREBASE_STUB.)
export const query = (/** @type {any} */ ref, /** @type {any[]} */ ...cs) => ({ __stub: 'query', queryOf: ref && ref.path,
  wheres: cs.filter(c => c && c.__stub === 'where' && c.field) });
// window.__E2E.writesLand = true makes a committed write LAND where the next read sees it (14 Nov 2026): a
// set or an update goes into docsByQuery under its collection (the list made if it is not there), a
// delete takes the row out, and a server timestamp becomes the commit's time in epoch ms. A transaction
// reads that list too, and a query of it is filtered by its == and < constraints. OFF by default, so
// every spec written before it reads only what it seeded. The leave sheet's Save reads its own writes
// back to write its upload log, and finds its log again on the next check, which is what it is for.
// (No backticks: inside FIREBASE_STUB.)
const _landWrite = (/** @type {any} */ path, /** @type {any} */ data, /** @type {string} */ mode) => {
  const e2e = globalThis.__E2E || {};
  if (!e2e.writesLand || !path) return;
  const parts = String(path).split('/'); const id = parts.pop(); const col = parts.pop();
  if (!col || !id) return;
  const byQ = e2e.docsByQuery = e2e.docsByQuery || {};
  const rows = Array.isArray(byQ[col]) ? byQ[col] : (byQ[col] = []);
  const at = rows.findIndex(r => r.id === id);
  if (mode === 'delete') { if (at >= 0) rows.splice(at, 1); return; }
  const now = Date.now();
  const fields = Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, v && v.__stub === 'ts' ? now : v]));
  const row = mode === 'update' && at >= 0 ? { ...rows[at], ...fields, id } : { ...fields, id };
  if (at >= 0) rows[at] = row; else rows.push(row);
};
const _matches = (/** @type {any} */ row, /** @type {any[]} */ wheres) => wheres.every(w => (w.op === '==' ? row[w.field] === w.value
  : w.op === '<' ? row[w.field] < w.value
  : w.op === 'in' ? Array.isArray(w.value) && w.value.includes(row[w.field]) : true));
// where() RECORDS its constraint (v21.38), like writeBatch records its writes and doc captures its
// path. The staged Admin load's whole claim is about WHICH query runs — one member versus the
// collection — and that is invisible from the rendered DOM: both produce a correct-looking table.
// Counting reads is not enough either; a spec has to be able to say what was asked for.
export const where = (/** @type {any} */ field, /** @type {any} */ op, /** @type {any} */ value) => {
  const e2e = globalThis.__E2E || {};
  (e2e.whereCalls = e2e.whereCalls || []).push([field, op, value]);
  globalThis.__E2E = e2e;
  // The constraint travels too (14 Nov 2026), for the one mode that filters on it: writesLand, below.
  return { __stub: 'where', field, op, value };
};
export const orderBy = () => marker('orderBy');
export const limit = () => marker('limit');
// doc(db, collection, id) captures its PATH (v18.97) so deleteDoc below can tell which row was
// removed. Still an opaque object to every consumer; only the delete stub reads .path.
// doc(collectionRef), with ONE argument, is an AUTO-ID reference, as the real one is (whole-app fix,
// Nov 2026): it carries a fresh id from the same sequence addDoc uses, so a document named before it is
// written has an identity, and a setDoc on it is recorded as a CREATE (see setDoc). The Link Designer store
// creates a design that way. It minted no id here, and a design made so had none.
export const doc = (...a) => {
  if (a.length === 1 && a[0] && a[0].__stub === 'collection') {
    const e2e = globalThis.__E2E || (globalThis.__E2E = {});
    e2e.addDocSeq = (e2e.addDocSeq || 0) + 1;
    const id = 'e2e-added-' + e2e.addDocSeq;
    return { __stub: 'doc', path: a[0].path + '/' + id, id, autoId: true };
  }
  // …and every reference carries its ID, as a real one does (v25.90): Admin's checked save learns which
  // documents a save touches from the references it is handed, and an id-less reference answered "none".
  return { __stub: 'doc', path: a.slice(1).map(String).join('/'), id: String(a[a.length - 1]) };
};
export const serverTimestamp = () => marker('ts');
// writeBatch RECORDS its set() payloads (v19.35) rather than swallowing them. A test that can only
// see the "Save N changes" counter is checking the outcome SUMMARY, not the write — and those are
// two separate passes over the same state that can disagree (a button promising 4 while 3 are
// written is exactly the bug worth catching). Recording is additive: every existing caller still
// sees a working batch.
export const writeBatch = () => {
    const e2e = globalThis.__E2E || (globalThis.__E2E = {});
    e2e.batchWrites = e2e.batchWrites || [];
    /** @type {any[]} */ const landing = [];   // writesLand: applied at commit, as the server would
    return {
        set: (/** @type {any} */ _ref, /** @type {any} */ data) => { e2e.batchWrites.push(data); landing.push([_ref && _ref.path, data, 'set']); },
        update: noop,
        // RECORDED (Oct 2026), not discarded: the roster re-import defect was a DELETE, and a
        // harness that drops deletes cannot see one happen.
        delete: (/** @type {any} */ ref) => { (e2e.batchDeletes = e2e.batchDeletes || []).push(String(ref?.path || '')); landing.push([ref && ref.path, null, 'delete']); },
        // HOLD SEAM (v24.21): with window.__E2E.holdCommits set, a commit stays pending until the
        // test calls window.__E2E.releaseCommits() — the way a real commit waits on a weak signal
        // for the server's answer. That wait is what slow-save.js explains, and without a way to
        // make it happen here the notice could only be tested as a unit, never as wired.
        // window.__E2E.holdBatchCommits holds a BATCH's commit alone, transactions going through (15 Nov
        // 2026): the leave sheet's housekeeping deletes in a batch after its Save's transactions, and only
        // a hold on that batch can show the Save is not waiting for it. No backticks: inside FIREBASE_STUB.
        commit: () => {
            const land = () => { for (const [p, d, m] of landing.splice(0)) _landWrite(p, d, m); };
            if (!e2e.holdCommits && !e2e.holdBatchCommits) { land(); return Promise.resolve(); }
            return new Promise(resolve => {
                (e2e._held = e2e._held || []).push(resolve);
                e2e.releaseCommits = () => { const h = e2e._held || []; e2e._held = []; h.forEach(r => r()); };
            }).then(land);
        },
    };
};
// runTransaction(db, fn): runs the update fn against the SEEDED rows (v19.41 — it used to hand back
// a permanently non-existent doc). With nothing seeded it still resolves "no such doc", so every
// existing caller behaves as before; when a test seeds window.__E2E.docs the transaction sees them,
// which is what makes the Link Designer purge testable at all — that purge re-reads inside the transaction
// precisely so a stale cached snapshot cannot destroy a restored design, and a tx.get that always
// says "gone" would let a no-op purge pass as a working one.
export const runTransaction = (_db, fn) => {
  const e2e = globalThis.__E2E || (globalThis.__E2E = {});
  // window.__E2E.txDocs, when set, is what TRANSACTIONS see — i.e. the SERVER's view, which is
  // allowed to differ from the window.__E2E.docs the page loaded. That divergence is the whole
  // point of reading inside a transaction: Firestore runs here with persistentLocalCache, so a
  // load can be served from IndexedDB and be arbitrarily stale. Without a way to express "the
  // server disagrees with your snapshot", a re-check that reads the same stale data would look
  // like it was working.
  const find = (ref) => {
    const parts = ref && ref.path ? String(ref.path).split('/') : [];
    const id = parts.length ? parts[parts.length - 1] : null;
    const col = parts.length > 1 ? parts[parts.length - 2] : null;
    // Per-collection seeding is consulted FIRST (v21.96). It was not, and a transaction against a
    // docsByPath collection therefore read "no such document" — which for a compare-and-set reads
    // as somebody having removed it, so the write was skipped and the assertion saw no delete. The
    // harness was answering a different question from the one the page asked.
    // txDocs still WINS where a test sets it — that is the seam for "the server disagrees with the
    // snapshot you loaded", which is the only way to express a competing writer.
    const scoped = col && e2e.docsByPath && Array.isArray(e2e.docsByPath[col]) ? e2e.docsByPath[col] : null;
    const landed = col && e2e.writesLand && e2e.docsByQuery && Array.isArray(e2e.docsByQuery[col]) ? e2e.docsByQuery[col] : null;
    const rows = Array.isArray(e2e.txDocs) ? e2e.txDocs
      : (scoped || landed || (Array.isArray(e2e.docs) ? e2e.docs : []));
    return rows.find(r => r.id === id) || null;
  };
  const ts = (v) => (typeof v === 'number' && v >= 1e12 ? { toDate: () => new Date(v), toMillis: () => v } : v);
  // window.__E2E.txFailOn = { col, code, times } makes the next 'times' transactions that touch a
  // document of collection 'col' REJECT with 'code', at that first touch and so before any of their
  // writes land (15 Nov 2026): the leave sheet's upload log lost on its own while the leave it records
  // went through. Every other transaction runs as before. No backticks: inside FIREBASE_STUB.
  const failOn = (ref) => {
    const f = e2e.txFailOn;
    const parts = ref && ref.path ? String(ref.path).split('/') : [];
    if (!f || !(f.times > 0) || parts[parts.length - 2] !== f.col) return;
    f.times -= 1;
    throw Object.assign(new Error('e2e: transaction refused'), { code: f.code || 'unavailable' });
  };
  const tx = {
    get: (ref) => {
      failOn(ref);
      const row = find(ref);
      return Promise.resolve({
        exists: () => !!row,
        data: () => (row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k, ts(v)])) : {}),
      });
    },
    // merge is RECORDED, not assumed (v24.47): a transactional merge reported as a replace makes a
    // test of "the bin move never overwrites patterns" unable to tell the two apart.
    // A transaction's writes are ALSO recorded where a batch's are (v25.90): an Admin save is a
    // transaction online and a batch offline, and what a spec asks is what was saved, not which
    // commit carried it — so batchWrites and batchDeletes hold both.
    set: (/** @type {any} */ ref, /** @type {any} */ data, /** @type {any} */ opts) => {
      e2e.setWrites = e2e.setWrites || [];
      e2e.setWrites.push({ path: (ref && ref.path) || '', data, merge: !!(opts && opts.merge) });
      (e2e.batchWrites = e2e.batchWrites || []).push(data);
      _landWrite(ref && ref.path, data, opts && opts.merge ? 'update' : 'set');
    },
    // An update, RECORDED like a set (14 Nov 2026): the leave sheet's Undo marks its upload log with one.
    update: (/** @type {any} */ ref, /** @type {any} */ data) => {
      (e2e.updateWrites = e2e.updateWrites || []).push({ path: (ref && ref.path) || '', data });
      _landWrite(ref && ref.path, data, 'update');
    },
    delete: (/** @type {any} */ ref) => {
      e2e.deletedPaths = e2e.deletedPaths || [];
      if (ref && ref.path) e2e.deletedPaths.push(String(ref.path));
      (e2e.batchDeletes = e2e.batchDeletes || []).push(String(ref?.path || ''));
      _landWrite(ref && ref.path, null, 'delete');
      const parts = ref && ref.path ? String(ref.path).split('/') : [];
      const id = parts.length ? parts[parts.length - 1] : null;
      const col = parts.length > 1 ? parts[parts.length - 2] : null;
      if (id && Array.isArray(e2e.docs)) e2e.docs = e2e.docs.filter(r => r.id !== id);
      // …and out of the per-collection seed too, or the picker reloads the row it just deleted.
      if (id && col && e2e.docsByPath && Array.isArray(e2e.docsByPath[col])) {
        e2e.docsByPath[col] = e2e.docsByPath[col].filter(r => r.id !== id);
      }
    },
  };
  // window.__E2E.txHold holds every transaction open until the test calls window.__E2E.releaseTx(),
  // so a test can act while a save is still in flight (switch designs, press another Save) and then
  // decide when it lands. A GATE, not a timer: a fixed delay raced the test on a slow runner, and the
  // result arrived before the switch it was meant to follow. No backticks: inside FIREBASE_STUB.
  if (e2e.txHold) {
    if (!e2e._txGate) e2e._txGate = new Promise(r => { e2e.releaseTx = r; });
    return e2e._txGate.then(() => fn(tx));
  }
  // window.__E2E.txErrorCode makes every transaction REJECT with that Firestore code — with the
  // browser set offline, 'unavailable' is how a real offline transaction fails.
  if (e2e.txErrorCode) return Promise.reject(Object.assign(new Error('client is offline'), { code: e2e.txErrorCode }));
  // window.__E2E.holdCommits holds a transaction too, on the batch's queue, until releaseCommits()
  // (v25.90): a slow server keeps either kind of commit waiting, and an Admin save is now either.
  if (e2e.holdCommits) {
    return new Promise(resolve => {
      (e2e._held = e2e._held || []).push(resolve);
      e2e.releaseCommits = () => { const h = e2e._held || []; e2e._held = []; h.forEach(r => r()); };
    }).then(() => fn(tx));
  }
  // window.__E2E.txLoseAnswer makes the NEXT transaction commit, its writes landing, and then REJECT
  // with 'unavailable': the connection lost between the server's commit and its answer, so the page
  // cannot know the write landed (14 Nov 2026, the leave sheet's Save). One-shot.
  if (e2e.txLoseAnswer) {
    e2e.txLoseAnswer = false;
    return Promise.resolve(fn(tx)).then(() => { throw Object.assign(new Error('connection lost'), { code: 'unavailable' }); });
  }
  return Promise.resolve(fn(tx));
};
// Collection reads resolve EMPTY unless a test seeds rows via window.__E2E.docs (an array of
// { id, ...fields }). Any millisecond-number field is exposed as a Firestore-Timestamp-alike so card
// code calling .toDate()/.toMillis() works unchanged. Added v18.94 because there was no way to render
// an Operations card WITH DATA — which is how the reset-requests row shipped broken at 375px (its
// name column collapsed to 18px and text painted over the label).
// NOTE: this comment lives INSIDE the FIREBASE_STUB template literal — no backticks, ever.
// window.__E2E.docsDelayMs holds every collection read open for N ms — the lever that makes a
// read/delete INTERLEAVING reproducible rather than a matter of luck.
// window.__E2E.failGetDocs makes every collection read REJECT (v20.40). The pair with docsDelayMs is
// the point: delay proves the calendar withholds its grid while a read is still running, reject proves
// it withholds it when the read has lost. Those are two different panels and only one carries a retry.
export const getDocs = (/** @type {any} */ ref) => {
  const e2e = globalThis.__E2E || {};
  // COUNTED, like writeBatch records its writes (v20.69). A spec can assert how many collection
  // reads an interaction actually caused, which is the only observable for a duplicated handler:
  // when one tap ran the open-a-week routine twice, both runs produced the same DOM, so nothing on
  // screen could tell you it had happened. Incremented before the failGetDocs branch, so a read
  // that was ATTEMPTED and rejected still counts.
  e2e.docReads = (e2e.docReads || 0) + 1;
  globalThis.__E2E = e2e;
  // And SETTLED reads are counted as well (test audit, 7 Nov 2026). docReads moves when a read
  // STARTS, so a spec that had to let a slow read land before asserting what it did had only a sleep
  // to wait with. docReadsSettled moves when a read has ANSWERED (or failed), in a reaction
  // registered before the page's own await — so once it equals docReads, every read started so far
  // has been delivered, and whatever the page did with each answer synchronously or in microtasks
  // has already happened. Counted on whichever __E2E is current when the read lands; a spec that
  // REPLACES the object mid-read splits the two counts, so wait on them only where it mutates it.
  // Attaching that reaction also marks a REJECTED read as handled. It hides nothing: every read the
  // app makes is awaited or handed to Promise.all or Promise.race, which attach handlers of their
  // own, so a failure the page leaves unhandled still surfaces on the promise its own code made.
  // (No backticks in this comment — it lives INSIDE the FIREBASE_STUB template literal.)
  const settle = (p) => {
    const done = () => { const g = globalThis.__E2E || {}; g.docReadsSettled = (g.docReadsSettled || 0) + 1; };
    p.then(done, done);
    return p;
  };
  // failGetDocs true rejects with a generic error (a network-class failure). A STRING rejects with
  // that string as the message — pass 'permission-denied' to look like an ACCESS failure (v20.45),
  // a different branch everywhere that matters: the generic error earns a retry chip, the access
  // one re-locks the Calendar. Both must be reachable or the re-lock path is untestable end to end.
  // (No backticks in this comment — it lives INSIDE the FIREBASE_STUB template literal.)
  if (e2e.failGetDocs) {
    return settle(Promise.reject(new Error(typeof e2e.failGetDocs === 'string' ? e2e.failGetDocs : 'e2e: collection read failed')));
  }
  // PER-COLLECTION failure (v22.57), the sibling of docsByPath below. failGetDocs fails every read,
  // which is the wrong tool for a page that reads two collections: failing the designs load as well
  // puts the whole workspace in its empty state, so the surface under test never renders. Set
  // window.__E2E.failGetDocsByPath = { linkTargetSets: true } to fail one and serve the rest.
  // (No backticks in this comment — it lives INSIDE the FIREBASE_STUB template literal.)
  const failByPath = e2e.failGetDocsByPath;
  if (failByPath && ref && ref.path && failByPath[ref.path]) {
    const why = failByPath[ref.path];
    return settle(Promise.reject(new Error(typeof why === 'string' ? why : 'e2e: collection read failed')));
  }
  // …and a QUERY of one collection (15 Nov 2026): failGetDocsByQuery = { alUploads: true } fails the
  // queries of that collection and serves every other read, so a page that reads two can lose one.
  const failByQuery = e2e.failGetDocsByQuery;
  if (failByQuery && ref && ref.queryOf && failByQuery[ref.queryOf]) {
    return settle(Promise.reject(Object.assign(new Error('e2e: query failed'), { code: 'unavailable' })));
  }
  // Per-collection seeding (v21.04): window.__E2E.docsByPath = { linkTargetSets: [rows] } serves
  // those rows ONLY to reads of that collection, so a page reading two collections (designs AND
  // target sets) does not hand both the same array. A path present with an empty array is an
  // EMPTY collection, not a fall-through; paths not named fall back to the shared e2e.docs, which
  // keeps every existing spec exactly as it was. Query-wrapped reads have no path and fall back
  // too. (No backticks in this comment — it lives INSIDE the FIREBASE_STUB template literal.)
  const byPath = e2e.docsByPath;
  // window.__E2E.docsByQuery = { newsletters: [rows] } serves those rows to a QUERY of that collection
  // (Nov 2026: the latest Newsletter, which the Calendar asks for as its documents open), ahead of
  // everything else; a query of a collection it does not name falls back as before. Read at CALL time,
  // so a spec can change the answer after the page has loaded. (No backticks: inside FIREBASE_STUB.)
  const byQuery = e2e.docsByQuery;
  const rows = (byQuery && ref && ref.queryOf && Object.prototype.hasOwnProperty.call(byQuery, ref.queryOf))
    ? (e2e.writesLand && Array.isArray(ref.wheres) && ref.wheres.length && Array.isArray(byQuery[ref.queryOf])
      ? byQuery[ref.queryOf].filter(r => _matches(r, ref.wheres)) : byQuery[ref.queryOf])
    : (byPath && ref && ref.path && Object.prototype.hasOwnProperty.call(byPath, ref.path))
      ? byPath[ref.path]
      : e2e.docs;
  // window.__E2E.docsHeld = true holds every collection read until the SPEC sets it back to false
  // (Nov 2026). docsDelayMs is a timer, and a spec that has to act BEFORE the read lands is then
  // racing it: a 3-second delay that four taps on a loaded WebKit runner did not fit failed the Admin
  // leave-preview test twice in one job. A held read lands when the spec says so, however slow the
  // steps before it were. (No backticks in this comment — it lives INSIDE the FIREBASE_STUB template literal.)
  // window.__E2E.heldFailWith (10 Nov 2026) makes a held read FAIL when it is released, with that
  // string as the message — read at the moment of release, not when the read began. It is how a read
  // that was already out fails AFTER something else has happened: failGetDocs is decided when a read
  // starts, so it cannot express a read that started before a re-lock and failed after it.
  const held = (v) => new Promise((r, j) => {
    const t = setInterval(() => {
      const now = globalThis.__E2E || {};
      if (now.docsHeld) return;
      clearInterval(t);
      if (now.heldFailWith) j(new Error(String(now.heldFailWith))); else r(v);
    }, 25);
  });
  const wrap = (v) => settle(e2e.docsHeld ? held(v)
    : e2e.docsDelayMs ? new Promise(r => setTimeout(() => r(v), e2e.docsDelayMs)) : Promise.resolve(v));
  // window.__E2E.docsFromCache marks every snapshot as served from the offline cache (Oct 2026) —
  // the shape a surface must REFUSE to present as current. Set it after load to aim it at one read.
  // EVERY snapshot includes the empty one below (Nov 2026): it used to carry no metadata at all, so
  // the seam could not reach the case the offline cache is worst at, a week it never read.
  const metadata = { fromCache: !!e2e.docsFromCache };
  if (!rows) return wrap({ empty: true, size: 0, docs: [], metadata, forEach: noop });
  // Only EPOCH-SCALE numbers become Timestamps (>= 1e12 ms, i.e. after Sep 2001) — the same heuristic
  // the retired work-email check used for legacy stamps. Converting every number turned a seeded count: 4 into a
  // Timestamp object, so "asked 4 times" silently vanished from the card.
  const ts = (v) => (typeof v === 'number' && v >= 1e12 ? { toDate: () => new Date(v), toMillis: () => v } : v);
  // A row carrying __pendingWrite: true is THIS device's own save not yet sent (14 Nov 2026): its
  // snapshot says hasPendingWrites, and its server timestamp reads null unless the reader asks for
  // the estimate — the SDK's own shape, which overrideFromSnapshot exists to read.
  const docs = rows.map(r => {
    const pending = r.__pendingWrite === true;
    const fields = Object.fromEntries(Object.entries(r).filter(([k]) => k !== '__pendingWrite').map(([k, v]) => [k, ts(v)]));
    return {
      id: r.id,
      metadata: { hasPendingWrites: pending, fromCache: !!e2e.docsFromCache },
      data: (o) => (pending && !(o && o.serverTimestamps === 'estimate') ? { ...fields, createdAt: null } : fields),
    };
  });
  return wrap({ empty: false, size: docs.length, docs, metadata, forEach: cb => docs.forEach(cb) });
};
//   window.__E2E = { failGetDoc: true }  → every single-doc read rejects. Used to prove the forced
//      set-password overlay FAILS OPEN when it can't read passwordStatus (password-force.js) — the
//      property that keeps a mandatory overlay from becoming a lockout.
// Phase 1 of the calendar's two-phase load (AUTH_AND_SESSIONS.md -> "The two-phase load (E1)") reads the LOCAL cache. For a QUERY the
// real SDK resolves with an EMPTY snapshot when nothing is cached (it is getDocFromCache, the
// single-doc form, that rejects) — so an empty resolve is the accurate default here. Either shape is
// safe: calendar-overrides.js treats empty and thrown identically. Seed via window.__E2E.cacheDocs.
export const getDocsFromCache = () => {
  const rows = (globalThis.__E2E || {}).cacheDocs;
  if (!rows) return Promise.resolve({ empty: true, size: 0, docs: [], forEach: noop });
  const docs = rows.map(r => ({ id: r.id, data: () => r }));
  return Promise.resolve({ empty: false, size: docs.length, docs, forEach: cb => docs.forEach(cb) });
};
// The SINGLE-document cache read (whole-app fix, Nov 2026), which the Link Designer store consults offline.
// Seed window.__E2E.docCache = { id: row } for a document this device holds, or { id: null } for one
// whose deletion the cache recorded — that resolves as NOT EXISTING, exactly as the real SDK answers
// it. A document not named was never held, and the read REJECTS, as the real one does; so nothing
// seeded is the default, and every spec written before this existed still consults nothing.
// (No backticks in this comment — it lives INSIDE the FIREBASE_STUB template literal.)
// Every id asked is RECORDED in window.__E2E.cacheAsked (25 Nov 2026), and window.__E2E.pendingIds names
// documents this device holds with its own save still queued (metadata.hasPendingWrites): together they
// let a spec see WHICH records a checked write asked about before it skipped the queue wait.
export const getDocFromCache = (ref) => {
  const e2e = globalThis.__E2E || {};
  const held = e2e.docCache || {};
  const id = ref && ref.path ? String(ref.path).split('/').pop() : null;
  if (id) (e2e.cacheAsked = e2e.cacheAsked || []).push(id);
  // A set still HELD offline (below) is this device's own unsent write to that record, and the real
  // SDK marks it so (27 Nov 2026): online, a checked write asks the record FIRST, and must see it.
  const heldSet = id ? (e2e._heldSets || []).find(h => h.id === id) : null;
  if (id && ((e2e.pendingIds || []).includes(id) || heldSet)) {
    return Promise.resolve({ exists: () => true, data: () => held[id] || (heldSet && heldSet.data) || {}, metadata: { hasPendingWrites: true } });
  }
  if (!id || !Object.prototype.hasOwnProperty.call(held, id)) {
    return Promise.reject(Object.assign(new Error('e2e: Failed to get document from cache'), { code: 'unavailable' }));
  }
  const row = held[id];
  return Promise.resolve(row ? { exists: () => true, data: () => row } : { exists: () => false, data: () => undefined });
};
// window.__E2E.getDocData seeds what a SINGLE-doc read RESOLVES WITH (v19.91). The default stays
// "does not exist", which is what every existing spec is written against — notably the Settings
// password chip, whose whole suite assumes an un-migrated member. Seeding it is how a spec reaches
// the opposite state: a member who set their password on ANOTHER device, which the server knows
// about and this device does not. There is no other route to that state, because it is defined
// entirely by what the server says.
// window.__E2E.docsFromCache marks THIS snapshot too (settings-ops-1, Nov 2026), so a single-document
// reader that refuses a cache-served answer can be tested; seed getDocData for the realistic case, a
// document the cache holds. (Offline, the real SDK REJECTS one it does not hold; this stub still
// resolves that as not existing, as every spec written before this expects.)
export const getDoc = () => {
  const e2e = globalThis.__E2E || {};
  if (e2e.failGetDoc) return Promise.reject(Object.assign(new Error('e2e'), { code: 'unavailable' }));
  const answer = () => {
    const seeded = e2e.getDocData;
    const metadata = { fromCache: !!e2e.docsFromCache };
    return seeded
      ? { exists: () => true, data: () => seeded, metadata }
      : { exists: () => false, data: () => ({}), metadata };
  };
  // window.__E2E.getDocHold holds every single-doc read open until the test calls window.__E2E.releaseGetDoc()
  // (18 Nov 2026) — the lever that lets a member type into Settings' Work Email before its first read lands,
  // which an instantly-resolving read could never show. A GATE, like addDocHold; unset, nothing changes.
  // (No backticks in this comment — it lives INSIDE the FIREBASE_STUB template literal.)
  if (e2e.getDocHold) {
    if (!e2e._getDocGate) e2e._getDocGate = new Promise(r => { e2e.releaseGetDoc = r; });
    return e2e._getDocGate.then(answer);
  }
  return Promise.resolve(answer());
};
// The SERVER-only single read (13 Nov 2026), which documents-client.js asks after an upload write is
// refused. Answered as getDoc is, so every seeded state reaches it, and declared after getDoc, which it
// calls. (No backticks in this comment — it lives INSIDE the FIREBASE_STUB template literal.)
export const getDocFromServer = (ref) => getDoc(ref);
// addDoc RECORDS its payload too (v20.97), and for the same reason setDoc does — but it had been
// NOTE: this comment lives INSIDE the FIREBASE_STUB template literal — no backticks, ever.
// the blind spot: addDoc is how EVERY design is created (new, duplicate, generated, imported), so
// the one write path nothing could inspect was the one that brings a design into existence. A spec
// could see a chip appear and nothing about what the chip stands for, which is exactly the gap the
// import's two-step confirm is there to close for the user.
export const addDoc = (/** @type {any} */ ref, /** @type {any} */ data) => {
  const e2e = globalThis.__E2E || (globalThis.__E2E = {});
  e2e.setWrites = e2e.setWrites || [];
  e2e.setWrites.push({ path: (ref && ref.path) || '', data, merge: false, added: true });
  // The ref CARRIES AN ID, because the real one does (v23.32). Every create path reads it back and
  // uses it as the new design's identity, so a ref without one left a design in the list that could
  // not be selected. Nothing failed: the old picker was a <select> and wrote dataset.id = undefined,
  // which stringifies to "undefined" and still matches an [data-id] locator, so the spec counted a
  // design that was not choosable. Whatever a create returns here must look like Firestore's.
  e2e.addDocSeq = (e2e.addDocSeq || 0) + 1;
  const created = { ...marker('docRef'), id: 'e2e-added-' + e2e.addDocSeq };
  // window.__E2E.addDocHold holds every create open until the test calls window.__E2E.releaseAddDoc()
  // (whole-app review, Oct 2026) — the lever that keeps a first save in flight long enough to edit the
  // design under it, which an instantly-resolving create could never show. A GATE, like txHold.
  // (No backticks in this comment — it lives INSIDE the FIREBASE_STUB template literal.)
  if (e2e.addDocHold) {
    if (!e2e._addDocGate) e2e._addDocGate = new Promise(r => { e2e.releaseAddDoc = r; });
    return e2e._addDocGate.then(() => created);
  }
  return Promise.resolve(created);
};
// OFFLINE, A SET WAITS FOR THE SIGNAL (v26.03), as the real SDK's does: a write made while the browser
// is offline resolves only once the server has it. Resolved at once, the stub told the Link Designer store that
// every queued save had already landed (store rule 6) — the one thing a queued save cannot know. It is
// recorded as it is made, and answered on the page's next 'online' event, oldest first: refused then
// with the code in window.__E2E.queuedSetRefusal when a test sets one (the server turning it down),
// delivered otherwise. window.__E2E.holdSetsWhenOnline keeps them held past the signal, and
// window.__E2E.deliverQueuedSet() then answers the OLDEST alone — a real queue sends one write after
// another, so a test can land the first before the second. A page reloaded first never answers them,
// as a second tab's memory-only queue dies with the page. No backticks: inside FIREBASE_STUB.
const _offlineNow = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const _answerHeld = (/** @type {any} */ e2e, /** @type {any} */ held) => {
  if (e2e.queuedSetRefusal) held.reject(Object.assign(new Error('e2e queued set refused'), { code: e2e.queuedSetRefusal }));
  else held.resolve(undefined);
};
const _answerWhenOnline = (/** @type {any} */ e2e, /** @type {any} */ ref, /** @type {any} */ data) => new Promise((resolve, reject) => {
  e2e._heldSets = e2e._heldSets || [];
  // Its record's id and data go with it, so getDocFromCache can answer for it as the SDK's cache does.
  e2e._heldSets.push({ resolve, reject, id: ref && ref.path ? String(ref.path).split('/').pop() : null, data });
  e2e.deliverQueuedSet = () => { const held = e2e._heldSets.shift(); if (held) _answerHeld(e2e, held); };
  if (e2e._heldSetsWired) return;
  e2e._heldSetsWired = true;
  globalThis.addEventListener('online', () => {
    if (!e2e.holdSetsWhenOnline) while (e2e._heldSets.length) _answerHeld(e2e, e2e._heldSets.shift());
  });
});
// setDoc RECORDS its payload (v19.41), for the same reason writeBatch does: a test that can only
// see the UI is checking the SUMMARY of a write, not the write. The Link Designer soft delete is exactly
// that trap — a hard delete and a soft delete BOTH make the design vanish from the picker, so
// asserting the chip is gone would pass against the very implementation being replaced. The
// payload is where the two differ.
export const setDoc = (/** @type {any} */ ref, /** @type {any} */ data, /** @type {any} */ opts) => {
  const e2e = globalThis.__E2E || (globalThis.__E2E = {});
  e2e.setWrites = e2e.setWrites || [];
  // __E2E.failSetCode makes every setDoc REJECT with that code, unrecorded (v25.06) — the deleteDoc
  // seam's twin, for a set whose outcome is unknown (auth/signed-out-during-request).
  if (e2e.failSetCode) return Promise.reject(Object.assign(new Error('e2e set refused'), { code: e2e.failSetCode }));
  // A set on an AUTO-ID reference (see doc) is a CREATE, recorded and held exactly as addDoc's is:
  // added: true, and window.__E2E.addDocHold keeps it open until window.__E2E.releaseAddDoc().
  if (ref && ref.autoId) {
    e2e.setWrites.push({ path: ref.path, data, merge: !!(opts && opts.merge), added: true });
    if (e2e.addDocHold) {
      if (!e2e._addDocGate) e2e._addDocGate = new Promise(r => { e2e.releaseAddDoc = r; });
      return e2e._addDocGate.then(() => undefined);
    }
    return _offlineNow() ? _answerWhenOnline(e2e, ref, data) : Promise.resolve();
  }
  e2e.setWrites.push({ path: (ref && ref.path) || '', data, merge: !!(opts && opts.merge) });
  return _offlineNow() ? _answerWhenOnline(e2e, ref, data) : Promise.resolve();
};
export const updateDoc = () => Promise.resolve();
// deleteDoc REMOVES the row from the seeded set (v18.97) instead of no-opping, so a card that
// deletes and then re-reads sees the delete. Without this there was no way to test the
// reset-requests refresh race: every reload returned the original rows, so a ghost row and a
// correctly-cleared one looked identical.
export const deleteDoc = (ref) => {
  const e2e = globalThis.__E2E || (globalThis.__E2E = {});
  // Record the path too (v19.41) so a test can assert a hard delete did NOT happen — the negative
  // is the whole claim of a soft delete.
  e2e.deletedPaths = e2e.deletedPaths || [];
  if (ref && ref.path) e2e.deletedPaths.push(String(ref.path));
  // __E2E.failDeleteCode makes every delete REJECT with that code and leave the row (Oct 2026), so
  // a caller's failure wording — a plain failure, and an outcome that is unknown — can be asserted.
  if (e2e.failDeleteCode) {
    const err = Object.assign(new Error('e2e delete refused'), { code: e2e.failDeleteCode });
    // __E2E.deleteDelayMs holds the refusal back, so a redraw can land while the delete is out.
    return e2e.deleteDelayMs ? new Promise((_r, j) => setTimeout(() => j(err), e2e.deleteDelayMs)) : Promise.reject(err);
  }
  const id = ref && ref.path ? String(ref.path).split('/').pop() : null;
  if (id && Array.isArray(e2e.docs)) e2e.docs = e2e.docs.filter(r => r.id !== id);
  // Path-keyed collections too (v21.08), so a deleted SET actually leaves the picker on the
  // re-read. Without this a delete that wrote nothing and one that worked look the same.
  const col = ref && ref.path ? String(ref.path).split('/').slice(0, -1).join('/') : null;
  if (id && col && e2e.docsByPath && Array.isArray(e2e.docsByPath[col])) {
    e2e.docsByPath[col] = e2e.docsByPath[col].filter(r => r.id !== id);
  }
  return Promise.resolve();
};
// waitForPendingWrites(db) answers when THIS DEVICE'S queued writes have reached the server (v25.95) —
// at once by default, as the real SDK does with nothing queued. window.__E2E.queuedWrites models a
// save made offline that is still in the queue: every wait is COUNTED (queueWaits) and stays open
// until the test calls window.__E2E.sendQueuedWrites() — the signal returning. A held batch
// (holdCommits) is deliberately NOT counted as queued here, so no spec that holds a commit changes.
// A GATE, like txHold. No backticks: inside FIREBASE_STUB.
export const waitForPendingWrites = () => {
  const e2e = globalThis.__E2E || (globalThis.__E2E = {});
  if (!e2e.queuedWrites) return Promise.resolve();
  e2e.queueWaits = (e2e.queueWaits || 0) + 1;
  if (!e2e._queueGate) {
    e2e._queueGate = new Promise(r => { e2e.sendQueuedWrites = () => { e2e.queuedWrites = false; r(); }; });
  }
  return e2e._queueGate;
};
export const increment = () => marker('increment');   // FieldValue sentinel (usage counters)
export const deleteField = () => marker('deleteField'); // FieldValue sentinel (usage prune)
export class FieldPath {}                               // literal field path (usage daily-bucket prune)
// COUNTED (v23.17), like getDocs: the Huddle viewer reads by onSnapshot, and a locked Calendar must
// attach no listener at all — the local cache would answer one. Never fires in tests.
// DELIVERS one snapshot when a test seeds window.__E2E.huddleDoc (v24.23) — the Huddle viewer's
// open-file button could not be reached at all otherwise, and its v24.19 defect (a button that did
// nothing until a network call returned) lived exactly there.
// huddleEmpty delivers an EMPTY snapshot (no Huddle uploaded); huddleError fails the listener.
// The SDK's optional second argument (its listen options, e.g. includeMetadataChanges) is skipped as
// the real one skips it: the Huddle listener passes one since 22 Nov 2026, and read as the callback it
// silently stopped every snapshot this stub delivers.
export const onSnapshot = (_q, ...args) => {
  if (args[0] && typeof args[0] === 'object') args.shift();
  const [onNext, onError] = args;
  const e2e = globalThis.__E2E || (globalThis.__E2E = {});
  e2e.snapshotSubs = (e2e.snapshotSubs || 0) + 1;
  if (e2e.huddleError && typeof onError === 'function') {
    setTimeout(() => onError(new Error('e2e huddle listener failure')), 0);
  } else if (e2e.huddleEmpty && typeof onNext === 'function') {
    // huddleEmpty: 'cache' answers from the LOCAL CACHE only — what the SDK raises offline.
    setTimeout(() => onNext({ empty: true, docs: [], metadata: { fromCache: e2e.huddleEmpty === 'cache' } }), 0);
  } else if (e2e.huddleDoc && typeof onNext === 'function') {
    const d = e2e.huddleDoc;
    setTimeout(() => onNext({ empty: false, docs: [{ id: d.date || 'x', data: () => d }] }), 0);
  }
  return noop;
};

// ---- auth ----
// Sign-in normally resolves. Two test hooks (set via addInitScript before page scripts, read at
// CALL time so they're honoured after init):
//   window.__E2E = { failSignIn: true }  → every sign-in path rejects with a persistent (non-
//      transient) code so ensureNamedSession does not retry — the B1 named-session enforcement tests.
//   window.__E2E = { hangSignIn: true }  → every sign-in path returns a promise that NEVER resolves
//      — exercises the login overlay's in-flight state (the "Signing in…" button + the disabled Back
//      link that the v14.79 guard added). hangSignIn takes precedence over failSignIn.
//   window.__E2E = { signInEstablishes: true } → a successful EMAIL/PASSWORD sign-in leaves a
//      current user behind, the way the real SDK does. Opt-in, because currentUser staying null
//      after sign-in is what a great many specs are written against, and scoped to the one call so
//      an anonymous fallback can never be mistaken for a named identity.
//   window.__E2E = { failSignIn: true, failSignInCode: 'auth/network-request-failed' } → fail with
//      THAT code instead — a connection failure, which must never count towards the lockout.
// Every call is RECORDED in window.__E2E.signIns as { email, password } (test audit, 7 Nov 2026).
// The stub used to ignore its arguments, so the overlay could stop passing the typed password and
// every lane stayed green: nothing could see which credential was signed in with.
const _e2eAuth = (code, establishes) => (_auth, email, password) => {
    const e2e = globalThis.__E2E || (globalThis.__E2E = {});
    (e2e.signIns || (e2e.signIns = [])).push({ email, password });
    if (e2e.hangSignIn) return new Promise(() => {});
    if (e2e.failSignIn) return Promise.reject(Object.assign(new Error('e2e'), { code: e2e.failSignInCode || code }));
    if (establishes && e2e.signInEstablishes) e2e.authUser = true;
    return Promise.resolve({ user: { uid: 'test' } });
};
// currentUser is null by default — the stub never really signs anyone in, and a great many tests
// depend on that. A test that needs a signed-in Firebase user (e.g. to reach an admin Cloud Function
// caller, which bails with "Not signed in" before it ever fetches) opts in with
// window.__E2E = { authUser: true }; everything else is unchanged.
// window.__E2E.authUserEmail gives that user an email (opt-in, iPhone audit, 7 Nov 2026). Re-authentication
// needs one, so without it a password change under the stub could never succeed; and session.js treats a
// user whose email is the member's own as that member's account, which is why it is not on by default.
// NOTE: this comment lives INSIDE the FIREBASE_STUB template literal — no backticks, ever.
// ---- the auth RESTORE clock ----
// window.__E2E.authRestoreDelayMs holds the persisted-user restore open for N ms: currentUser reads
// null and onAuthStateChanged does not emit the user until then.
//
// Why this exists at all: the stub hands every caller a user SYNCHRONOUSLY, so none of the app's
// restore budgets had ever been exercised by a test — not calendar-access.js's 6s bound, not
// session.js's 8s AUTH_RESTORE_TIMEOUT_MS. A member whose restore lands after those bounds was
// reported as locked out, and no test could see it because the stub could
// not be slow. It is what made the v20.79 late-restore grant provable.
//
// The instant is ABSOLUTE and PAGE-LOAD-RELATIVE, computed once here. Restarting the delay per
// subscription would model something the platform never does (every listener would see its own
// restore) and reports a threshold far lower than the real one.
// NOTE: inside the FIREBASE_STUB template literal — no backticks, ever.
const _restoreDue = Date.now() + Number((globalThis.__E2E || {}).authRestoreDelayMs || 0);
const _restored = () => Date.now() >= _restoreDue;
const _currentUser = () => {
    const e2e = globalThis.__E2E || {};
    if (!_restored()) return null;
    // getIdToken as well as getIdTokenResult (v20.12). The admin Cloud-Function callers are split
    // between the two — operations' roster upload uses getIdToken(), the sign-in stats card uses
    // getIdTokenResult() — and a stub with only one of them fails whichever path it does not cover
    // with an unhelpful TypeError halfway through an upload.
    if (e2e.authUser) return {
        uid: 'test', isAnonymous: false, email: e2e.authUserEmail,
        getIdToken: () => Promise.resolve('e2e-token'),
        getIdTokenResult: () => Promise.resolve({ token: 'e2e-token', claims: { admin: true } }),
    };
    return null;
};
// WEDGED-START SEAM (v26.60): window.__E2E.authStartHangs makes authStateReady never answer, as it can on
// an iPhone whose IndexedDB is stuck. With a long authRestoreDelayMs, the boot's own 8s wait gives up and
// then waits on this, so authReady never settles: a page must still show the person a way in.
export const getAuth = () => ({
    get currentUser() { return _currentUser(); },
    authStateReady: () => ((globalThis.__E2E || {}).authStartHangs ? new Promise(() => {}) : Promise.resolve()),
});
// firebase-client.js initialises Auth WITHOUT the popup/redirect resolver (Oct 2026); same instance shape.
export const initializeAuth = getAuth;
// Emits the CURRENT user, not a hardcoded null (v20.12). calendar-access.js resolves the first
// emission to decide access, so a stub that always said null would report every seeded member and
// every restored session as signed out — and the teardown specs would pass for the wrong reason.
// REVOKE SEAM (v24.37): window.__E2E.revokeAuth() signs the member out the way a refused token
// refresh does in production, and tells every listener still subscribed. The initial emission below
// is unchanged; a listener only hears the revocation while it is live.
const _authSubs = new Set();
(globalThis.__E2E || (globalThis.__E2E = {})).revokeAuth = () => {
    globalThis.__E2E.authUser = false;
    for (const cb of Array.from(_authSubs)) cb(null);
};
// RESTORE SEAM (v24.39): the same member signs back in (another tab, say) — the account returns
// to this page, which is the window in which a retry could write a second copy.
(globalThis.__E2E || (globalThis.__E2E = {})).restoreAuth = () => {
    globalThis.__E2E.authUser = true;
    for (const cb of Array.from(_authSubs)) cb({ uid: 'test', isAnonymous: false });
};
// SHARED-PC SEAM (v24.38): window.__E2E.otherTabSignIn() models a colleague signing in from another
// tab — Firebase signs the old account out, then the new one in, and every tab hears both.
(globalThis.__E2E || (globalThis.__E2E = {})).otherTabSignIn = () => {
    for (const cb of Array.from(_authSubs)) cb(null);
    for (const cb of Array.from(_authSubs)) cb({ uid: 'colleague', isAnonymous: false });
};
export const onAuthStateChanged = (_auth, cb) => {
    if (cb) _authSubs.add(cb);
    if (_restored()) { Promise.resolve().then(() => cb && cb(_currentUser())); return () => _authSubs.delete(cb); }
    // Microtask when there is no delay, so the overwhelming majority of specs keep the timing they
    // were written against; a timer only when a delay was asked for.
    const t = setTimeout(() => cb && cb(_currentUser()), Math.max(0, _restoreDue - Date.now()));
    return () => clearTimeout(t);
};
export const signInWithEmailAndPassword = _e2eAuth('auth/invalid-credential', true);
// Clears the VIEWER only, never the opt-in authUser flag. authUser is a test's declaration
// that a member is signed in on this page, and session.js legitimately signs a restored identity
// out and back in during ensureFirebaseSession — so clearing it here made the member vanish
// mid-init and took the Operations Usage card down with it.
// NOTE: inside the FIREBASE_STUB template literal — no backticks, ever.
export const signOut = () => {
    const e2e = globalThis.__E2E || (globalThis.__E2E = {});
    e2e.signOutCount = (e2e.signOutCount || 0) + 1;
    return Promise.resolve();
};
export const setPersistence = () => Promise.resolve();
export const indexedDBLocalPersistence = marker('idb');
export const browserLocalPersistence = marker('local');
export const browserSessionPersistence = marker('session');
// Chosen-password change flow (settings.html Password card, v18.63). These are imported at module
// scope by firebase-client.js, so they MUST be exported here or the whole module graph fails to link
// (a link error would blank every page under the stub). Only exercised when a password change runs.
// window.__E2E.hangPasswordWrite makes the password WRITE hang until the test releases it with
// window.__E2E_releasePasswordWrite(ok) (v18.97). This is the only way to reach the INDETERMINATE
// state in a browser: the deadline passes, the UI must say it could not confirm, and then the
// original call settles late — the case that used to be reported as a flat failure.
// NOTE: inside the FIREBASE_STUB template literal — no backticks, ever.
// window.__E2E.updateFailCode makes the password WRITE refuse with that code at once (sign-in check,
// 11 Nov 2026): a failure AFTER re-authentication, which must never read as a wrong current password.
export const updatePassword = () => {
  const failCode = (globalThis.__E2E || {}).updateFailCode;
  if (failCode) return Promise.reject(Object.assign(new Error('e2e update refused'), { code: failCode }));
  if (!(globalThis.__E2E || {}).hangPasswordWrite) return Promise.resolve();
  return new Promise((resolve, reject) => {
    globalThis.__E2E_releasePasswordWrite = (ok) => (ok === false
      ? reject(Object.assign(new Error('e2e late failure'), { code: 'auth/network-request-failed' }))
      : resolve());
  });
};
// window.__E2E.reauthFailCode makes re-authentication REFUSE with that code (sign-in check, 11 Nov 2026):
// the only way to reach "Current password incorrect" on a page under the stub. (No backticks here.)
// window.__E2E.reauthDelayMs holds its answer back N ms (review, 11 Nov 2026), so a spec can act while it is out.
export const reauthenticateWithCredential = () => {
  const e2e = globalThis.__E2E || {};
  const answer = () => (e2e.reauthFailCode
    ? Promise.reject(Object.assign(new Error('e2e reauth refused'), { code: e2e.reauthFailCode }))
    : Promise.resolve({ user: { uid: 'test' } }));
  return e2e.reauthDelayMs ? new Promise(r => setTimeout(r, e2e.reauthDelayMs)).then(answer) : answer();
};
export const EmailAuthProvider = { credential: (email, password) => marker('cred:' + email + ':' + password) };

// ---- storage (only operations upload uses these; included for completeness) ----
export const getStorage = () => marker('storage');
export const ref = () => marker('ref');
export const uploadBytes = () => Promise.resolve();
export const getDownloadURL = () => Promise.resolve('about:blank');
export const deleteObject = () => Promise.resolve();
`;

/**
 * Per-page CONFIG overrides applied to roster-data.js as it is served.
 *
 * ONE route handler applies ALL of them (registered in the `page` fixture below), because Playwright
 * runs only the most-recently-registered matching handler and `route.fetch()` inside it bypasses the
 * rest — so the previous shape (a `page.route('**\/roster-data.js')` per helper) meant a test calling
 * two flag helpers silently got only one of them. Nothing did yet, but adding a third flag made that
 * a matter of when. Helpers now just RECORD an override.
 *
 * @type {WeakMap<import('@playwright/test').Page, Record<string, [RegExp, string]>>}
 */
const _configOverrides = new WeakMap();

/**
 * Record a CONFIG rewrite for this page. `key` de-duplicates (a helper called twice wins once).
 * @param {any} page
 * @param {string} key
 * @param {RegExp} pattern   what to find in the served roster-data.js
 * @param {string} value     what to replace it with
 */
function _setConfigOverride(page, key, pattern, value) {
    // "Call BEFORE page.goto()" was a contract a test could break SILENTLY, and on WebKit only: WebKit
    // reuses the roster-data.js it already holds, so the route below never sees the next load and the
    // setting stays as it was (integration-e2e, 10 Nov 2026 — two tests read a false setting for a true
    // one). Refused here, so a late call fails at the call rather than as a missing overlay later on.
    if (page.url() !== 'about:blank') {
        throw new Error(`${key}: set after the page loaded ${page.url()}. Call it BEFORE page.goto() — `
            + 'WebKit keeps the roster-data.js it already holds, so a later load would not see it.');
    }
    const current = _configOverrides.get(page) || {};
    current[key] = [pattern, value];
    _configOverrides.set(page, current);
}

/**
 * Every route the suite's pages run under: the Firebase SDK stub, the hermetic network defaults and
 * the roster-data overrides. The `page` fixture applies it; a test that opens a SECOND tab
 * (`context.newPage()`) applies it to that page too, or the tab loads the real SDK and draws nothing.
 * @param {import('@playwright/test').Page} page
 */
export async function routeAppPage(page) {
    await page.route('https://www.gstatic.com/firebasejs/**', route =>
        route.fulfill({ contentType: 'text/javascript', body: FIREBASE_STUB }));

    // The silent re-sign-in asks about the last admin reset BEFORE it signs in, over the two REST
    // APIs (Oct 2026 — `probeResetAtMs` in firebase-client.js). Hermetic default: the sign-in is
    // accepted and the account has never been reset, which is what every spec before this assumed.
    // A spec that needs a reset routes `**/documents/passwordStatus/**` itself (newest route wins).
    await page.route('https://identitytoolkit.googleapis.com/**', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ idToken: 'e2e-probe' }) }));
    await page.route('https://firestore.googleapis.com/**/documents/passwordStatus/**', route =>
        route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));

    await page.route('**/roster-data.js', async route => {
        const res = await route.fetch();
        let body  = await res.text();
        // DEFAULT OFF for the whole suite: the forced set-password overlay (AUTH_AND_SESSIONS.md → "The forced password overlay")
        // fires after any confirmed sign-in for a member the stubbed Firestore reports as
        // un-migrated — which, since `getDoc` resolves `exists: () => false`, is EVERY member. It
        // would therefore cover the page in every test that signs in through the overlay and break
        // assertions that have nothing to do with passwords. Compel tests opt back in with
        // `forcePasswordSet(page)`.
        body = body.replace(/FORCE_PASSWORD_SET:\s*(?:true|false)/, 'FORCE_PASSWORD_SET: false');
        // DEFAULT ON for the whole suite: the Link Designer is PAUSED for staff (CONFIG.LINK_DESIGNER_ENABLED, owner,
        // 27 Nov 2026), Overtime's way, and its tests go on driving the real page so it is ready to come back. The paused
        // page's own tests opt out with `pauseLinkDesigner(page)`.
        body = body.replace(/LINK_DESIGNER_ENABLED:\s*(?:true|false)/, 'LINK_DESIGNER_ENABLED: true');
        for (const [pattern, value] of Object.values(_configOverrides.get(page) || {})) {
            body = body.replace(pattern, value);
        }
        await route.fulfill({ response: res, body, contentType: 'text/javascript' });
    });
}

export const test = base.extend({
    // Auto-apply the routes before any test navigates. Registering them inside the
    // `page` fixture guarantees they are in place before the first page.goto().
    page: async ({ page }, use) => {
        await routeAppPage(page);
        await use(page);
        // A test that ends mid-navigation leaves this route's `route.fetch()` in flight when the context
        // closes, and Playwright fails the TEST for it ("Target page, context or browser has been closed")
        // although every assertion passed — once in a full run (3 Nov 2026), on a spec whose last step was a
        // link to the Calendar. Dropping the routes first, ignoring what is still in flight, is the
        // remedy Playwright's own message names. It runs after the test body, so it hides nothing a test
        // could have asserted.
        await page.unrouteAll({ behavior: 'ignoreErrors' });
    },
});

/**
 * Turn the forced set-password overlay ON for one test (AUTH_AND_SESSIONS.md → "The forced password overlay"). The suite-wide
 * default is OFF — see the `page` fixture — because the stubbed Firestore reports every member as
 * un-migrated, so leaving it on would put the overlay over every sign-in test. Call BEFORE page.goto().
 * @param {import('@playwright/test').Page} page
 */
export async function forcePasswordSet(page) {
    _setConfigOverride(page, 'FORCE_PASSWORD_SET',
        /FORCE_PASSWORD_SET:\s*(?:true|false)/, 'FORCE_PASSWORD_SET: true');
}

/**
 * Give one test its own link designers (CONFIG.LINKS_DESIGNERS). The real list has been the admin alone since 9 Nov
 * 2026 (owner: "hide the link designer page from everyone apart from me"), and the admin can overwrite anybody's work —
 * so the rules that bind an ORDINARY designer (whose saved set they may not overwrite, whose draft a second designer on
 * the same phone must never be offered) have no real seat to be tested from. Call BEFORE page.goto(). A pattern that
 * stops matching changes nothing, and the test then fails at the page's own door rather than passing quietly.
 * @param {import('@playwright/test').Page} page
 * @param {string[]} names
 */
export async function withLinksDesigners(page, names) {
    _setConfigOverride(page, 'LINKS_DESIGNERS',
        /LINKS_DESIGNERS:\s*\[[^\]]*\]/, `LINKS_DESIGNERS: ${JSON.stringify(names)}`);
}

/**
 * Show one test the Link Designer as staff see it: PAUSED (CONFIG.LINK_DESIGNER_ENABLED, owner, 27 Nov 2026). The suite
 * switches it ON by default (the roster-data.js route, above), so the real page stays tested; this puts it back as it
 * ships. Call BEFORE page.goto().
 * @param {import('@playwright/test').Page} page
 */
export async function pauseLinkDesigner(page) {
    _setConfigOverride(page, 'LINK_DESIGNER_ENABLED',
        /LINK_DESIGNER_ENABLED:\s*(?:true|false)/, 'LINK_DESIGNER_ENABLED: false');
}

/**
 * Give one test its own Overtime beta participants (CONFIG.OVERTIME_BETA). Through the shared roster-data.js
 * route, so the suite's defaults — the forced set-password step OFF among them — still apply: a spec that
 * routed the file itself replaced that route, and once the step asked on an ordinary open (26 Nov 2026) its
 * seeded member met the overlay. Call BEFORE page.goto().
 * @param {import('@playwright/test').Page} page
 * @param {string[]} names
 */
export async function withOvertimeBeta(page, names) {
    _setConfigOverride(page, 'OVERTIME_BETA',
        /OVERTIME_BETA:\s*(\/\*\*[^*]*\*\/\s*)?\(?\[[^\]]*\]\)?/, `OVERTIME_BETA: ${JSON.stringify(names)}`);
}

/**
 * Add one INVENTED "Other Staff" login to the served roster for this page (owner, 23 Nov 2026). Call BEFORE page.goto().
 * `fields` is JavaScript source for any further properties of the row — `roleHistory: [...]` for a colleague moved
 * to Other Staff from a priced grade.
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 * @param {string} [fields]
 */
export async function withOtherStaff(page, name, fields = '') {
    // An INVENTED "Other Staff" login (owner, 23 Nov 2026), served in the real roster module: the row goes in just
    // before the array's end, after the comment that documents its shape, so the app reads it exactly as it would a
    // real one. BEFORE page.goto(), for the same reason as the CONFIG overrides above.
    if (page.url() !== 'about:blank') throw new Error('withOtherStaff: call it BEFORE page.goto()');
    const row = `    { name: ${JSON.stringify(name)}, currentWeek: 1, rosterType: 'main', role: 'Other Staff', hidden: true, otherStaff: true${fields ? `, ${fields}` : ''} },`;
    await page.route('**/roster-member-data.js', async route => {
        const body = await (await route.fetch()).text();
        const anchor = 'Operations → Set up accounts.\n];';
        if (!body.includes(anchor)) throw new Error('withOtherStaff: the Other Staff anchor in roster-member-data.js has moved — re-anchor it');
        await route.fulfill({ contentType: 'text/javascript', body: body.replace(anchor, `Operations → Set up accounts.\n${row}\n];`) });
    });
}

/**
 * A date `days` before `from` (default today) as the app files an issue: 'YYYY-MM-DD', by the calendar.
 * @param {number} days
 * @param {Date} [from]
 */
export function isoDaysAgo(days, from = new Date()) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() - days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * This device already knows the latest Marylebone Newsletter: dated `isoDate`, or '' for none uploaded
 * (newsletter-recency.js — what the Calendar's check leaves behind). Every load of this page starts from
 * it, so use it on a page that does not ask; on the Calendar, `withServerNewsletter` is the answer it
 * gets. Call BEFORE page.goto().
 * @param {import('@playwright/test').Page} page
 * @param {string} isoDate
 */
export async function withKnownNewsletter(page, isoDate) {
    await page.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch { /* none */ } },
        [NEWSLETTER_LATEST_KEY, isoDate]);
}

/**
 * The server's latest Marylebone Newsletter, for the Calendar's check and the drawer's open: dated
 * `isoDate`, or none at all for ''. Served only to a query of `newsletters` (the stub's docsByQuery).
 * None is seeded as null, not []: the stub answers [] with `empty: false` and no documents, and only
 * a missing row list gets its real empty snapshot. Call BEFORE page.goto().
 * @param {import('@playwright/test').Page} page
 * @param {string} isoDate
 */
export async function withServerNewsletter(page, isoDate) {
    await page.addInitScript((d) => {
        const w = /** @type {any} */ (window);
        const issue = d ? [{ id: d, date: d, fileType: 'pdf',
            storageUrl: `https://firebasestorage.googleapis.com/v0/b/myb-roster.appspot.com/o/newsletters%2F${d}.pdf?alt=media&token=e2e` }] : null;
        w.__E2E = { ...(w.__E2E || {}), docsByQuery: { ...((w.__E2E || {}).docsByQuery || {}), newsletters: issue } };
    }, isoDate);
}

export { expect };
