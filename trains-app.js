// @ts-check
/**
 * trains-app.js — coordinator for trains.html: what changes at Marylebone on 13 December 2026.
 *
 * Owns: the access gate, the session wiring, the day/direction choice and the four renders. Every
 * judgement about the two timetables — which December train is "the same train", the basic hour,
 * the wording of a change — is `trains-change.js`; the timetables themselves are the generated
 * `trains-data.js`. Nothing here reads the network: the page works offline from its first open.
 *
 * ── WHO IT IS FOR, AND WHY IT IS GATED ─────────────────────────────────────────────────────────
 *
 * A PREVIEW for the admin while the page is shaped (owner, 7 Oct 2026), to become every member's
 * "Trains" page later. The gate is CLIENT UX, not a boundary: the timetable is public information
 * and `trains-data.js` is served to anyone, like every module. Opening it to staff is one line in
 * `auth-policy.js` and one flag in `nav-panel.js`, which page-contract-parity requires to move
 * together.
 *
 * ── TEACH THE CHANGE, NOT THE TIMETABLE ────────────────────────────────────────────────────────
 *
 * The page is read in the weeks BEFORE the change by staff who will be asked about it. So every
 * train is shown beside the one it replaces, in words a member can repeat to a passenger, and the
 * basic hour sits beside the full lists because it is the one thing worth memorising.
 *
 * What comes after the preview — the teaching extras, and the at-a-glance page it becomes on
 * 13 December: docs/ROADMAP.md → "Trains page — what comes after the preview".
 */

import { CONFIG, escapeHtml as esc } from './roster-data.js';   // esc: every innerHTML value goes through it
import { initNavPanel } from './nav-panel.js';
import { initLoginOverlay, dismissLoginOverlay } from './login-overlay.js';
import { getSession, ensureNamedSession, sessionReady, resolveSession, reconcileExpiredIdentity } from './session.js';
import { guardNamedSession, signOutAndLeave, reloadIfRestoredForSomeoneElse } from './page-session.js';
import { requirePage, canOpenOvertime } from './auth-policy.js';
import { initCardCollapse } from './overlay.js';
import { initAboutLightbox } from './about-lightbox.js';
import { registerServiceWorker } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';
import { initPasswordForce } from './password-force.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency, markPageReady } from './perf-reporter.js';
import { TIMETABLES, STATIONS, SOURCES, CHANGE_DATE } from './trains-data.js';
import {
    compareRoutes, compareBasicHour, trainsNear, parseTypedTime, daysUntil, changeLabel, daysLabel,
    routeName, PATTERN_HOURS,
} from './trains-change.js';

/** @typedef {'SX'|'SO'|'SU'} Day */
/** @typedef {'dep'|'arr'} Dir */

const DAY_NAMES = /** @type {Record<Day, string>} */ ({ SX: 'Weekdays', SO: 'Saturdays', SU: 'Sundays' });

/** Coordinator body, invoked by trains-boot.js. Exported so a test can import without running. */
export function init() {
    reloadIfRestoredForSomeoneElse();
    // Tear down a lingering privileged Firebase identity whose local session has expired.
    reconcileExpiredIdentity().catch(() => {});

    const currentUser = getSession()?.name ?? null;

    // Decided from the LOCAL session, as Operations and Overtime do — the auth store is often still
    // initialising here, and a role-gated page must not treat "pending" as "allowed".
    const access = requirePage({ status: currentUser ? 'named' : 'signedOut', member: currentUser }, 'trains');
    if (access.decision === 'login') {
        initLoginOverlay({
            pageLabel: 'Trains',
            // No session saved (iOS private mode can refuse the write): reload into a fresh sign-in.
            onSuccess: () => { try { if (!getSession()) { window.location.reload(); return; } init(); } catch { window.location.reload(); } },
        });
        return;
    }
    if (access.decision === 'forbidden') {
        // A preview: a member who reached the URL goes back to the roster, quietly.
        window.location.replace('./');
        return;
    }
    const member = /** @type {string} */ (currentUser);
    dismissLoginOverlay();
    registerServiceWorker();

    const established = ensureNamedSession(member);
    resolveSession(established);
    guardNamedSession({ page: 'trains', pageLabel: 'Trains', member, established });

    /** @type {any} */
    let openAboutLightbox = null;
    initNavPanel({
        authReady: sessionReady,
        currentPage: 'trains',
        memberName: member,
        isAdmin: CONFIG.ADMIN_NAMES.includes(member),
        isLinksDesigner: CONFIG.LINKS_DESIGNERS.includes(member),
        canOpenOvertime: canOpenOvertime(member),
        onLogoClick: () => openAboutLightbox?.(),
        onSignOut: () => signOutAndLeave({ to: './' }),
    });
    openAboutLightbox = initAboutLightbox();

    initCardCollapse('trRoutesToggleHeader',  'trRoutesBody',  'trRoutesChevron');
    initCardCollapse('trPatternToggleHeader', 'trPatternBody', 'trPatternChevron');
    initCardCollapse('trLookupToggleHeader',  'trLookupBody',  'trLookupChevron');
    initCardCollapse('trAboutToggleHeader',   'trAboutBody',   'trAboutChevron');

    // Open on today's kind of day — what a member is most likely to be asked about.
    const dow = new Date().getDay();
    /** @type {{ day: Day, dir: Dir }} */
    const state = { day: dow === 6 ? 'SO' : dow === 0 ? 'SU' : 'SX', dir: 'dep' };

    renderHero();
    renderSources();
    wireControls(state, () => renderChoice(state));
    wireLookup(() => renderLookup(state));
    renderChoice(state);
    markPageReady();

    sessionReady.then(() => {
        initErrorReporter();
        recordUsage('trains', member);
        recordPageLatency('trains', member);
    });
    sessionReady.then(() => initPasswordForce(member)).catch(() => {});
}

// ── Renders ─────────────────────────────────────────────────────────────────────────────────────

/** The countdown and the three totals. */
function renderHero() {
    const days = daysUntil(new Date(), CHANGE_DATE);
    const eyebrow = el('trCountdown'), title = el('trHeroTitle');
    if (eyebrow) {
        eyebrow.textContent = days > 1 ? `New timetable · ${days} days to go`
            : days === 1 ? 'New timetable · starts tomorrow'
            : days === 0 ? 'New timetable · starts today'
            : 'New timetable · now running';
    }
    if (title && days < 0) title.textContent = 'Since Sunday 13 December';

    const body = el('trTotals')?.querySelector('tbody');
    if (!body) return;
    body.innerHTML = /** @type {Day[]} */ (['SX', 'SO', 'SU']).map((d) => {
        const now = TIMETABLES.now[d].dep.length, dec = TIMETABLES.dec[d].dep.length;
        return `<tr><th scope="row">${esc(DAY_NAMES[d])}</th><td>${now}</td>`
            + `<td>${dec}${delta(dec - now)}</td></tr>`;
    }).join('');
}

/** @param {{ day: Day, dir: Dir }} state */
function renderChoice(state) {
    renderRoutes(state);
    renderPattern(state);
    renderLookup(state);
}

/**
 * Every route, busiest first, each a disclosure holding the train-by-train list.
 * @param {{ day: Day, dir: Dir }} state
 */
function renderRoutes(state) {
    const host = el('trRoutes');
    if (!host) return;
    const leaving = state.dir === 'dep';
    setText('trRoutesTitle', leaving ? 'Where trains go' : 'Where trains come from');
    setText('trRoutesHint', `${DAY_NAMES[state.day]}, ${leaving ? 'leaving' : 'arriving at'} Marylebone. Tap one to see every train`);

    const routes = compareRoutes(TIMETABLES.now[state.day][state.dir], TIMETABLES.dec[state.day][state.dir]);
    host.innerHTML = routes.map((r) => {
        const name = routeName(STATIONS, r.station, r.via);
        const moved = r.tally.earlier + r.tally.later;
        const away = r.trains.filter(t => t.kind === 'rerouted' && t.side === 'old').length;
        const here = r.tally.rerouted - away;
        const parts = [
            moved && `${moved} retimed`,
            r.tally.new && `${r.tally.new} new`,
            r.tally.gone && `${r.tally.gone} removed`,
            away && `${away} ${leaving ? `now ${away === 1 ? 'runs' : 'run'} elsewhere` : `now ${away === 1 ? 'comes' : 'come'} from elsewhere`}`,
            here && `${here} from another route`,
        ].filter(Boolean);
        const summary = parts.length ? parts.join(' · ') : 'No change';
        const none = '<span class="tr-none"><span aria-hidden="true">—</span><span class="sr-only">none</span></span>';
        const rows = r.trains.map((t) => {
            const chip = t.kind === 'earlier' || t.kind === 'later' ? 'moved' : t.kind;
            // A rerouted train belongs to THIS route on one side only: the chip names the other.
            const now = t.kind === 'rerouted' && t.side === 'new' ? null : t.now;
            const dec = t.kind === 'rerouted' && t.side === 'old' ? null : t.dec;
            const days = now ? daysLabel(t.days) : '';
            return `<tr class="tr-row tr-row--${chip}">`
                + `<td>${now ? esc(now) : none}`
                + `${days ? `<span class="tr-days">${esc(days)}</span>` : ''}</td>`
                + `<td>${dec ? esc(dec) : none}</td>`
                + `<td><span class="tr-chip tr-chip--${chip}">${esc(changeLabel(t, STATIONS, state.dir))}</span></td></tr>`;
        }).join('');
        return `<details class="tr-route${parts.length ? ' tr-route--changed' : ''}">`
            + `<summary class="tr-route-sum"><span class="tr-route-name">${esc(name)}</span>`
            + `<span class="tr-route-count">${r.nowCount} → ${r.decCount}${delta(r.decCount - r.nowCount)}</span>`
            + `<span class="tr-route-what">${esc(summary)}</span></summary>`
            + `<table class="tr-trains"><thead><tr><th scope="col">Now</th><th scope="col">From 13 Dec</th>`
            + `<th scope="col">What changes</th></tr></thead><tbody>${rows}</tbody></table></details>`;
    }).join('');
}

/**
 * The basic hour, before and after.
 * @param {{ day: Day, dir: Dir }} state
 */
function renderPattern(state) {
    const host = el('trPattern');
    if (!host) return;
    const rows = compareBasicHour(TIMETABLES.now[state.day][state.dir], TIMETABLES.dec[state.day][state.dir]);
    const mins = (/** @type {number[]} */ ms) => ms.length ? ms.map(m => `:${String(m).padStart(2, '0')}`).join(' ') : '—';
    const changed = rows.filter(r => r.changed).length;
    const lead = changed
        ? `${changed === 1 ? 'One line changes' : `${changed} lines change`} in the basic hour.`
        : 'The basic hour stays the same.';
    const window = `${String(PATTERN_HOURS.from).padStart(2, '0')}:00–${String(PATTERN_HOURS.to).padStart(2, '0')}:00`;
    host.innerHTML = `<p class="tr-lead">${esc(DAY_NAMES[state.day])}, ${esc(window)}. ${esc(lead)} Each time is minutes past every hour.</p>`
        + `<table class="tr-pattern"><thead><tr><th scope="col">${state.dir === 'dep' ? 'To' : 'From'}</th>`
        + `<th scope="col">Now</th><th scope="col">From 13 Dec</th></tr></thead><tbody>`
        + rows.map(r => `<tr class="${r.changed ? 'tr-pattern--changed' : ''}"><th scope="row">${esc(routeName(STATIONS, r.station, r.via))}</th>`
            + `<td>${esc(mins(r.now))}</td><td>${esc(mins(r.dec))}${r.changed ? ' <span class="tr-chip tr-chip--moved">Changed</span>' : ''}</td></tr>`).join('')
        + '</tbody></table>';
}

/**
 * "What happens to the 17:15?" — the trains near a typed time, before and after.
 * @param {{ day: Day, dir: Dir }} state
 */
function renderLookup(state) {
    const host = el('trLookupResult');
    const input = /** @type {HTMLInputElement|null} */ (el('trLookupInput'));
    if (!host || !input) return;
    const typed = input.value.trim();
    if (!typed) { host.innerHTML = ''; return; }
    const at = parseTypedTime(typed);
    if (!at) { host.innerHTML = '<p class="tr-lead">Type a time like 17:15 or 1715.</p>'; return; }

    const nowRows = TIMETABLES.now[state.day][state.dir], decRows = TIMETABLES.dec[state.day][state.dir];
    const near = trainsNear(nowRows, decRows, at);
    const leaving = state.dir === 'dep';

    // The exact train asked about, when there is one, answered in a sentence first.
    const exact = compareRoutes(nowRows, decRows).flatMap(r => r.trains.map(t => ({ r, t })))
        .filter(({ t }) => t.now === at && (t.kind !== 'rerouted' || t.side === 'old'));
    const answer = exact.map(({ r, t }) => {
        const name = routeName(STATIONS, r.station, r.via);
        const label = changeLabel(t, STATIONS, state.dir);
        // A retimed or new train gets its December time; a rerouted one's label already carries it.
        const when = t.kind === 'earlier' || t.kind === 'later' ? ` (${t.dec})` : '';
        return `<p class="tr-answer"><strong>The ${esc(at)} ${leaving ? 'to' : 'from'} ${esc(name)}:</strong> ${esc(label)}${esc(when)}.</p>`;
    }).join('');

    const list = (/** @type {import('./trains-change.js').TrainRow[]} */ rows) => rows.length
        ? `<ul class="tr-near">${rows.map(([t, st, via]) => `<li><span class="tr-near-time">${esc(t)}</span> ${esc(routeName(STATIONS, st, via))}</li>`).join('')}</ul>`
        : '<p class="tr-lead">No trains.</p>';
    host.innerHTML = answer
        + `<p class="tr-lead">${esc(DAY_NAMES[state.day])}, ${leaving ? 'leaving' : 'arriving'} within 15 minutes of ${esc(at)}:</p>`
        + `<div class="tr-near-cols"><div><h3 class="tr-near-head">Now</h3>${list(near.now)}</div>`
        + `<div><h3 class="tr-near-head">From 13 Dec</h3>${list(near.dec)}</div></div>`;
}

function renderSources() {
    setText('trSources', `Now: ${SOURCES.now}. From 13 December: ${SOURCES.dec}.`);
}

// ── Wiring ──────────────────────────────────────────────────────────────────────────────────────

/**
 * @param {{ day: Day, dir: Dir }} state
 * @param {() => void} onChange
 */
function wireControls(state, onChange) {
    const buttons = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('#trControls .tr-seg-btn')]);
    const sync = () => {
        for (const b of buttons) {
            const on = b.dataset.day ? b.dataset.day === state.day : b.dataset.dir === state.dir;
            b.setAttribute('aria-pressed', String(on));
        }
    };
    for (const b of buttons) {
        b.addEventListener('click', () => {
            if (b.dataset.day) state.day = /** @type {Day} */ (b.dataset.day);
            if (b.dataset.dir) state.dir = /** @type {Dir} */ (b.dataset.dir);
            sync();
            onChange();
        });
    }
    sync();
}

/** @param {() => void} onChange */
function wireLookup(onChange) {
    el('trLookupInput')?.addEventListener('input', onChange);
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────

/** A signed difference as a chip, or nothing when there is none. @param {number} n */
function delta(n) {
    if (!n) return '';
    return ` <span class="tr-delta tr-delta--${n > 0 ? 'up' : 'down'}">${n > 0 ? '+' : '−'}${Math.abs(n)}</span>`;
}

/** @param {string} id @param {string} text */
function setText(id, text) {
    const node = el(id);
    if (node) node.textContent = text;
}

/** @param {string} id */
function el(id) { return document.getElementById(id); }
