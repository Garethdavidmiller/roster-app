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
import { teamMembers } from '../roster-data.js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const roster = {
    cea:        teamMembers.filter(m => m.role === 'CEA'        && !m.hidden && !m.managerOnly).map(m => m.name),
    ces:        teamMembers.filter(m => m.role === 'CES'        && !m.hidden && !m.managerOnly).map(m => m.name),
    dispatcher: teamMembers.filter(m => m.role === 'Dispatcher' && !m.hidden && !m.managerOnly).map(m => m.name),
};

const dest = join(ROOT, 'functions', 'roster-members.json');
writeFileSync(dest, JSON.stringify(roster, null, 4) + '\n');

console.log(`Written: functions/roster-members.json`);
console.log(`  CEA: ${roster.cea.length} members`);
console.log(`  CES: ${roster.ces.length} members`);
console.log(`  Dispatcher: ${roster.dispatcher.length} members`);
