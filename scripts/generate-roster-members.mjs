#!/usr/bin/env node
/**
 * generate-roster-members.mjs — derive functions/roster-members.json from roster-data.js.
 *
 * The Cloud Function (functions/index.js) reads functions/roster-members.json to tell
 * the AI which names to look for in a PDF roster. This script generates that file from
 * the authoritative teamMembers array in roster-data.js so they stay in sync.
 *
 * Run after adding or removing a staff member:
 *   node scripts/generate-roster-members.mjs
 *
 * Verified in CI by sw-asset-check.test.mjs — a mismatch fails the test suite.
 */
import { teamMembers, CONFIG, getMembersForGrade } from '../roster-data.js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// activeMembers mirrors admin-auth.js's ACTIVE_MEMBERS EXACTLY — the same four getMembersForGrade
// calls in the same order. Do NOT re-derive it with a plain `!m.hidden` filter: managers carry
// `hidden: true` by convention and are selected by managerOnly, so a naive filter would drop all six
// (and orphan-removal would then disable them). Using getMembersForGrade guarantees parity (B4).
const activeMembers = [
    ...getMembersForGrade('CEA'),
    ...getMembersForGrade('CES'),
    ...getMembersForGrade('Dispatcher'),
    ...getMembersForGrade('Management'),
].map(m => m.name);

// ── Overtime (OVERTIME_AVAILABILITY.md) ──────────────────────────────────────────────────────────
// A SEPARATE list from activeMembers, and the separation is the point: activeMembers is built from
// getMembersForGrade, which deliberately does NOT filter Management on `hidden`, so it CONTAINS all
// six manager-only accounts. It means "has an account", not "is rostered". Overtime eligibility is
// the roster's own participation semantics — `!hidden && !managerOnly` — which excludes every
// manager and every leaver without a second policy having to say so.
//
// `rosterOrder` is the teamMembers index, generated so a Manager's by-day list keeps a stable
// familiar order months later; hand-maintaining it would drift the first time somebody is inserted.
// `startDate` is emitted as a plain ISO date because the server compares it to a week-start string.
const overtimeEligibleMembers = teamMembers
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => !m.hidden && !m.managerOnly)
    .map(({ m, i }) => ({
        name:        m.name,
        grade:       m.role,
        startDate:   m.startDate ? isoDate(m.startDate) : null,
        rosterOrder: i,
    }));

/** @param {Date} d */
function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const roster = {
    cea:        teamMembers.filter(m => m.role === 'CEA'        && !m.hidden && !m.managerOnly).map(m => m.name),
    ces:        teamMembers.filter(m => m.role === 'CES'        && !m.hidden && !m.managerOnly).map(m => m.name),
    dispatcher: teamMembers.filter(m => m.role === 'Dispatcher' && !m.hidden && !m.managerOnly).map(m => m.name),
    // B4: server-owned role/roster lists. setupRosterAuth reads THESE (not the client payload) so a
    // tampered client can't self-promote a claim tier or create/keep a rogue account. Single source:
    // roster-data.js CONFIG + teamMembers. Regenerate + commit whenever those change (CI-enforced by
    // sw-asset-check.test.mjs).
    activeMembers,
    roles: {
        admin:    CONFIG.ADMIN_NAMES,
        manager:  CONFIG.MANAGER_NAMES,
        designer: CONFIG.LINKS_DESIGNERS,
    },
    overtimeEligibleMembers,
    // The app's canonical navigable-roster ceiling, mirrored so window creation validates against
    // the SAME horizon the client does. Without it the Functions side would need its own literal,
    // and the two would part company at the next MAX_YEAR bump (already booked in
    // MAINTENANCE_CALENDAR.md) — the classic drift this generated file exists to prevent.
    maxRosterYear: CONFIG.MAX_YEAR,
};

const dest = join(ROOT, 'functions', 'roster-members.json');
writeFileSync(dest, JSON.stringify(roster, null, 4) + '\n');

console.log(`Written: functions/roster-members.json`);
console.log(`  CEA: ${roster.cea.length} members`);
console.log(`  CES: ${roster.ces.length} members`);
console.log(`  Dispatcher: ${roster.dispatcher.length} members`);
console.log(`  activeMembers: ${activeMembers.length} · admin: ${roster.roles.admin.length} · manager: ${roster.roles.manager.length} · designer: ${roster.roles.designer.length}`);
