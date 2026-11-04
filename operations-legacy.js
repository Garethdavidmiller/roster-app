// @ts-check
/**
 * operations-legacy.js — the Old-format records card on operations.html (v25.28).
 *
 * Three override types can still be READ and can no longer be CREATED: `allocated`, `overtime` and
 * `swap` (`LEGACY_OVERRIDE_TYPES`, override-utils.js). The code that reads them — their labels, how
 * each is classed, the "old format" pill in Admin's Saved Changes — can only be deleted once no
 * record uses them, and until this card nothing in the app could say whether any did. It answers
 * that one question and changes nothing: no write, no edit, nothing beyond the admin's own read.
 *
 * ── TWO READS, PRICED DIFFERENTLY ───────────────────────────────────────────────────────────────
 *
 *  - THE COUNTS, on page load: one server-side count per type (`getCountFromServer`). Nothing is
 *    downloaded — Firestore charges one read per thousand records counted — and `type ==` runs on
 *    the single-field index Firestore keeps for every field unless told otherwise, so no index is
 *    added. That is what puts the total in the header chip while the card is still closed.
 *  - THE YEARS, on the first open. "How many of type X in year Y" is an equality and a range on two
 *    different fields, which needs a COMPOSITE index this project does not have
 *    (firestore.indexes.json holds one: memberName + date). Adding one for a one-off question is a
 *    backend-first, two-push change; reading the records themselves costs ONE READ EACH and needs
 *    nothing. So they are read only when the admin opens the card, never more than `YEARS_CAP` of
 *    them, and above that the card says so instead of downloading them.
 *
 * ── IT NEVER SAYS "NONE" WITHOUT A COUNT THAT SAID SO ───────────────────────────────────────────
 *
 * "None left" is the answer that gets code deleted, so it comes only from three counts the server
 * actually returned. A count that did not arrive, or arrived as anything but a whole number, is a
 * failure with a Try again — never a zero. `summariseLegacy` is the one place that decision is made,
 * which is why the reader passes the server's figure through untouched rather than checking it too:
 * two guards on one fact means deleting either leaves every test green. The Needs-attention strip
 * makes the same refusal for its own items ("a failed card load reports nothing rather than a
 * reassuring zero").
 *
 * ── IT IS TEMPORARY ─────────────────────────────────────────────────────────────────────────────
 *
 * When it reads "None left", this module, its card, its tips entry and its e2e go together with the
 * legacy types themselves (`admin-shift-types.js`'s sunset note lists that code). If some are left,
 * what each should become is the owner's decision, not a default: `overtime` is voluntary work like
 * `rdw`, while `allocated` and `swap` are contracted like `shift` (override-utils.js).
 *
 * The reader takes its Firestore handles as arguments — the `analytics-client.js` pattern — so it
 * and the summary load in Node: `operations-legacy.test.mjs` runs both against a fake. The wiring,
 * a real page reading through the e2e stub, is `e2e/operations.spec.js`.
 */
import { LEGACY_OVERRIDE_TYPES } from './override-utils.js';
import { TYPES } from './admin-shift-types.js';
import { _cardLoadError } from './operations-reports.js';

/** The most records the card downloads to group by year — one read each, on the admin's open. */
export const YEARS_CAP = 1000;

/** A stored override day: 'YYYY-MM-DD' (firestore.rules holds every write to that shape). */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What a record whose `date` is not a day is grouped under — shown, never dropped. */
export const NO_DATE = 'no date';

/**
 * The Firestore half: the counts, and the records' days. Handles are injected, so the shape of
 * every query is asserted against a fake rather than taken on trust.
 *
 * @param {{
 *   db: any,
 *   collectionName: string,
 *   fs: { collection: Function, query: Function, where: Function, limit: Function, getDocs: Function, getCountFromServer: Function },
 * }} deps
 */
export function buildLegacyReader({ db, collectionName, fs }) {
    const col = () => fs.collection(db, collectionName);
    return {
        /**
         * One server-side count per type, in parallel. The figure is passed through as the server
         * sent it — `summariseLegacy` decides whether it can be believed (the header says why).
         * @param {readonly string[]} [types]
         * @returns {Promise<Record<string, unknown>>}
         */
        async countByType(types = LEGACY_OVERRIDE_TYPES) {
            const snaps = await Promise.all(types.map(t =>
                fs.getCountFromServer(fs.query(col(), fs.where('type', '==', t)))));
            return Object.fromEntries(types.map((t, i) => [t, snaps[i]?.data?.()?.count]));
        },
        /**
         * The records themselves, for their days — ONE READ EACH, so capped.
         * @param {readonly string[]} [types]
         * @param {number} [cap]
         * @returns {Promise<Array<{ type: string, date: string }>>}
         */
        async fetchDays(types = LEGACY_OVERRIDE_TYPES, cap = YEARS_CAP) {
            const snap = await fs.getDocs(fs.query(col(), fs.where('type', 'in', [...types]), fs.limit(cap)));
            return snap.docs.map((/** @type {any} */ d) => {
                const o = d.data() || {};
                return { type: String(o.type), date: typeof o.date === 'string' ? o.date : '' };
            });
        },
    };
}

/**
 * Group one type's records by the YEAR of the day each change is for, oldest first, with any
 * record that has no readable day last rather than left out.
 * @param {string} type
 * @param {Array<{ type: string, date: string }>} days
 * @returns {Array<{ year: string, count: number }>}
 */
function yearsFor(type, days) {
    /** @type {Map<string, number>} */
    const byYear = new Map();
    for (const d of days) {
        if (d.type !== type) continue;
        const year = DAY.test(d.date) ? d.date.slice(0, 4) : NO_DATE;
        byYear.set(year, (byYear.get(year) || 0) + 1);
    }
    return [...byYear]
        .sort(([a], [b]) => (a === NO_DATE ? 1 : b === NO_DATE ? -1 : a.localeCompare(b)))
        .map(([year, count]) => ({ year, count }));
}

/**
 * Everything the card says, decided in one place. THROWS when any count is not a whole number —
 * that is the "never a zero we were not given" rule, and the card turns the throw into a failure
 * with a Try again.
 *
 * @param {Record<string, unknown>} counts    from `countByType`
 * @param {Array<{ type: string, date: string }>|null} [days]   the records' days, or null when not read
 * @param {readonly string[]} [types]
 * @returns {{ total: number, rows: Array<{ type: string, label: string, count: number, years: Array<{ year: string, count: number }>|null }> }}
 */
export function summariseLegacy(counts, days = null, types = LEGACY_OVERRIDE_TYPES) {
    const rows = types.map(type => {
        const count = counts?.[type];
        if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
            throw new Error(`No usable count for "${type}"`);
        }
        const label = /** @type {Record<string, { label: string }>} */ (TYPES)[type]?.label ?? type;
        return { type, label, count, years: days && count ? yearsFor(type, days) : null };
    });
    return { total: rows.reduce((sum, r) => sum + r.count, 0), rows };
}

/**
 * One type's line: "Allocated shift: 9 — 2025: 7 · 2026: 2", or "Swap: none".
 * @param {{ label: string, count: number, years: Array<{ year: string, count: number }>|null }} row
 * @returns {string}
 */
export function legacyRowText(row) {
    if (!row.count) return `${row.label}: none`;
    const years = row.years?.length ? ` — ${row.years.map(y => `${y.year}: ${y.count}`).join(' · ')}` : '';
    return `${row.label}: ${row.count}${years}`;
}

/**
 * Wire the card. Reads the counts at once (the header chip shows the total while the card is
 * closed) and the years on the first open — the coordinator forwards the card's toggle here.
 *
 * @param {{
 *   reader: ReturnType<typeof buildLegacyReader>,
 *   withClaimRetry: (fn: () => Promise<any>) => Promise<any>,
 *   sessionReady: Promise<unknown>,
 * }} deps
 * @returns {{ onToggle: (open: boolean) => void }}
 */
export function initLegacyCard({ reader, withClaimRetry, sessionReady }) {
    const found = document.getElementById('legacyRecordsContent');
    if (!found) return { onToggle() {} };
    const content = found;   // narrowed once, for the functions below (a declaration is hoisted past a guard)
    const chip = document.getElementById('legacyRecordsCountChip');

    /** @type {Record<string, unknown>|null} */
    let counts = null;
    /** @type {Array<{ type: string, date: string }>|null} */
    let days = null;
    /** 'idle' until the first open; 'skipped' when there are none, or too many, to read. */
    let years = /** @type {'idle'|'loading'|'loaded'|'failed'|'skipped'} */ ('idle');
    let opened = false;

    /** @param {string} text @param {string} [cls] */
    const para = (text, cls = 'auth-desc') => {
        const p = document.createElement('p');
        p.className = cls;
        p.textContent = text;
        return p;
    };

    function render() {
        if (!counts) return;
        const summary = summariseLegacy(counts, years === 'loaded' ? days : null);
        if (chip) chip.textContent = summary.total ? String(summary.total) : '';
        content.innerHTML = '';
        if (!summary.total) {
            content.appendChild(para('None left. No shift change in the database uses an old format, so the code that still reads them can be removed.'));
            return;
        }
        content.appendChild(para(`${summary.total} left, saved in a format the app no longer creates. They still show — in the Calendar, and marked “old format” in Admin’s Saved Changes. This card only counts them; it changes nothing.`));
        const list = document.createElement('ul');
        list.className = 'legacy-records-list';
        for (const row of summary.rows) {
            const li = document.createElement('li');
            li.textContent = legacyRowText(row);
            list.appendChild(li);
        }
        content.appendChild(list);
        if (years === 'loaded') {
            content.appendChild(para('Years are those of the day each change is for.', 'auth-desc legacy-records-note'));
        } else if (years === 'loading') {
            content.appendChild(para('Reading their years…', 'auth-desc legacy-records-note'));
        } else if (years === 'skipped') {
            content.appendChild(para(`Too many to read for their years here — ${summary.total}, and the card reads at most ${YEARS_CAP}.`, 'auth-desc legacy-records-note'));
        } else if (years === 'failed') {
            const p = para('Couldn’t read their years — check your connection.', 'auth-desc legacy-records-note');
            p.style.color = 'var(--error-red)';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn-action btn-secondary card-retry-btn';
            btn.textContent = '↻ Try again';
            btn.addEventListener('click', () => { btn.disabled = true; loadYears(); });
            content.append(p, btn);
        }
    }

    async function loadYears() {
        if (!counts) return;
        const { total } = summariseLegacy(counts);
        if (!total || total > YEARS_CAP) { years = 'skipped'; render(); return; }
        years = 'loading';
        render();
        try {
            days = await withClaimRetry(() => reader.fetchDays());
            years = 'loaded';
        } catch (e) {
            console.error('[OldFormat] years', e);
            years = 'failed';
        }
        render();
    }

    async function loadCounts() {
        try {
            await sessionReady;
            const got = await withClaimRetry(() => reader.countByType());
            summariseLegacy(got);   // throws on a count it cannot believe — BEFORE it is kept
            counts = got;
            render();
            if (opened && years === 'idle') loadYears();
        } catch (e) {
            console.error('[OldFormat]', e);
            counts = null;
            if (chip) chip.textContent = '';
            _cardLoadError(content, 'Couldn’t count the old-format records — check your connection.', () => loadCounts());
        } finally {
            content.removeAttribute('aria-busy');
        }
    }

    loadCounts();
    return {
        onToggle(open) {
            if (!open) return;
            opened = true;
            if (counts && years === 'idle') loadYears();
        },
    };
}
