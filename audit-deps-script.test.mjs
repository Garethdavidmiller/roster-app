// audit-deps-script.test.mjs — scripts/audit-functions-deps.sh, RUN against canned npm reports.
//
// The script exists to tell "npm audit found a high-severity advisory" from "npm audit could not run",
// and workflow-hygiene.test.mjs pins its wiring statically, because the real thing needs npm and the
// network. A fake `npm` that prints a canned report needs neither, so the verdicts themselves are
// checked here — including the one that read `.metadata.vulnerabilities.critical // 0`: a report with
// `metadata` but no `metadata.vulnerabilities` printed "critical=0 high=0" and exited 0 with a
// critical advisory in its own list (whole-app check, 10 November 2026). Part of test:hygiene; skips
// where bash or jq is missing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./scripts/audit-functions-deps.sh', import.meta.url));
const runs = (/** @type {string} */ cmd) => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0;
const skip = runs('bash') && runs('jq') ? false : 'bash or jq is not installed here — the audit script was not run';

const COUNTS = (/** @type {number} */ critical, /** @type {number} */ high) =>
    ({ info: 0, low: 0, moderate: 0, high, critical, total: critical + high });

/**
 * Run the script with `npm` replaced by one that prints `report`; `policy` is AUDIT_UNKNOWN_IS_FAILURE.
 * @param {any} t @param {unknown} report @param {string | null} policy
 */
function audit(t, report, policy) {
    const dir = mkdtempSync(join(tmpdir(), 'audit-deps-script-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, 'report.json'), typeof report === 'string' ? report : JSON.stringify(report));
    writeFileSync(join(dir, 'npm'), `#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo 10.9.0; exit 0; fi\ncat '${join(dir, 'report.json')}'\n`);
    chmodSync(join(dir, 'npm'), 0o755);
    const env = { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` };
    if (policy === null) delete env.AUDIT_UNKNOWN_IS_FAILURE; else env.AUDIT_UNKNOWN_IS_FAILURE = policy;
    const r = spawnSync('bash', [SCRIPT], { encoding: 'utf8', env });
    return { status: r.status, out: r.stdout + r.stderr };
}

test('a clean report passes under both policies', { skip }, (t) => {
    const clean = { vulnerabilities: {}, metadata: { vulnerabilities: COUNTS(0, 0), dependencies: { prod: 10 } } };
    for (const policy of ['0', '1']) assert.equal(audit(t, clean, policy).status, 0);
});

test('a real high or critical advisory fails under both policies', { skip }, (t) => {
    for (const [critical, high] of [[1, 0], [0, 2]]) {
        const found = { vulnerabilities: { x: { severity: critical ? 'critical' : 'high' } },
            metadata: { vulnerabilities: COUNTS(critical, high), dependencies: { prod: 10 } } };
        for (const policy of ['0', '1']) assert.equal(audit(t, found, policy).status, 1, `${critical}/${high} under ${policy}`);
    }
});

test('an audit that could not run warns for the deploy and fails the weekly run, saying it did NOT run', { skip }, (t) => {
    const outage = { message: 'request to https://registry.npmjs.org failed', error: { summary: 'audit endpoint returned 503' } };
    const deploy = audit(t, outage, '0');
    assert.equal(deploy.status, 0);
    assert.match(deploy.out, /::warning title=Dependency audit did NOT run/);
    const weekly = audit(t, outage, '1');
    assert.equal(weekly.status, 1);
    assert.match(weekly.out, /::error title=Dependency audit did NOT run/);
});

test('a report whose counts cannot be read is a FAILURE — never zero', { skip }, (t) => {
    const shapes = {
        'counts that are not integers': { metadata: { vulnerabilities: { critical: { count: 3 }, high: 0 } } },
        'metadata with no vulnerabilities block, a critical in the list': {
            vulnerabilities: { x: { severity: 'critical' } }, metadata: { dependencies: { prod: 10 } } },
    };
    for (const [what, report] of Object.entries(shapes)) {
        for (const policy of ['0', '1']) {
            const r = audit(t, report, policy);
            assert.equal(r.status, 1, `${what} (policy ${policy}) exited ${r.status}: ${r.out}`);
            assert.match(r.out, /report not understood/, what);
        }
    }
});

test('a caller that sets no policy is refused rather than given one', { skip }, (t) => {
    assert.equal(audit(t, { metadata: { vulnerabilities: COUNTS(0, 0) } }, null).status, 2);
});
