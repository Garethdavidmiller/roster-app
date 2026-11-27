// @lane hygiene
/**
 * doc-size-ratchet.test.mjs — a document may not quietly get larger.
 * Run: node scripts/run-tests.mjs test/doc-size-ratchet.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── WHAT IT HOLDS ───────────────────────────────────────────────────────────────────────────────
 *
 * Every hand-read document — every `.md` under `docs/`, its sub-folders included, the area rules (`.claude/rules/*.md`, loaded into a session
 * whenever their files are opened), the skills and `README.md` — carries a ceiling in CHARACTERS, set
 * a little above its size on the day it was measured (26 Nov 2026, after the documentation rounds
 * that took `docs/` and the rules from 1.88 MB to 1.63 MB). `CLAUDE.md` is not here: it has its own,
 * tighter total in `doc-parity.test.mjs` (contract 3bb), because it is loaded into EVERY session.
 *
 * It is the same RATCHET as `coordinator-ratchet.test.mjs`, one level up: the rule is not "no document
 * over N", which would fail on the day it landed and be waived; it is "no document gets worse
 * without somebody deciding it should".
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────────────────────────
 *
 * The documents grew the way the code comments did — one incident story, one version stamp, one
 * finished plan left in place at a time, each reasonable alone. Nothing measured the total, so the
 * first anybody saw of it was a 137 KB file. Release history belongs in git log; a document holds
 * what is TRUE NOW and the rule that stops it being undone (CLAUDE.md → "Current file structure",
 * the three homes).
 *
 * ── WHEN IT FAILS ───────────────────────────────────────────────────────────────────────────────
 *
 * - **Over its cap:** first take OUT what has stopped being true or has become history — a finished
 *   plan, a "until v24 this did X" story, a fact also stated in a module header or another document.
 *   Only then, if the growth is real content, RAISE the cap in the same commit, with a one-line reason
 *   beside it. Raising is allowed; raising silently is what this prevents.
 * - **Too far under its cap:** a cap more than 1,000 characters (`SLACK`, one rounding step) above what
 *   the rule below gives must come down to that figure, or the saving is banked as room for the next story.
 * - **No cap at all:** a new document — give it one by the same rule.
 * - **A cap for a file that is gone:** delete the entry.
 *
 * ── THE RULE FOR A CAP ──────────────────────────────────────────────────────────────────────────
 *
 * The size in characters × 1.05, rounded UP to the next 1,000. About 5% of room: enough for a
 * correction or a new paragraph of rule, not for a new section. The generated parts of `AI_MAP.md`
 * and `FILE_INDEX.md` grow by a line per new module, so those two will need a raise now and then
 * for a reason that is real; the reason is then "N new modules".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

// Tests live in test/ but address files from the repository root.
const REPO_ROOT_URL = new URL('../', import.meta.url);

/** Characters, not bytes: a £ or an em dash is one character a reader reads. */
const size = (/** @type {string} */ f) => [...readFileSync(new URL(f, REPO_ROOT_URL), 'utf8')].length;

/** @type {Record<string, number>} */
const CAPS = {
    '.claude/rules/admin.md':                11_000,
    '.claude/rules/calendar.md':             17_000,
    '.claude/rules/css-tokens.md':           60_000,
    '.claude/rules/guide-pages.md':          52_000,
    '.claude/rules/links-design.md':         21_000,
    '.claude/rules/nav-drawer.md':           12_000,
    '.claude/rules/notifications.md':        24_000,
    '.claude/rules/operations.md':            6_000,
    '.claude/rules/paycalc.md':              26_000,
    '.claude/rules/pwa.md':                   9_000,
    '.claude/rules/roster-data.md':          11_000,
    '.claude/rules/roster-import.md':        28_000,
    '.claude/rules/sessions.md':              6_000,
    '.claude/rules/staff-copy.md':           10_000,
    '.claude/skills/al-workbook/SKILL.md':    4_000,
    '.claude/skills/leaver/SKILL.md':         7_000,
    '.claude/skills/new-notice/SKILL.md':    32_000,
    '.claude/skills/new-starter/SKILL.md':   15_000,
    'README.md':                             18_000,
    'docs/A11Y_BASELINE.md':                 16_000,
    'docs/AI_MAP.md':                        83_000,
    'docs/AL_WORKBOOK.md':                   83_000,
    'docs/ANDROID_RELEASE_CHECKLIST.md':     11_000,
    'docs/ARCHITECTURE.md':                  21_000,
    'docs/AUTH_AND_SESSIONS.md':             62_000,
    'docs/BRASS_PLAN.md':                    14_000,
    'docs/CALENDAR_DATA.md':                 16_000,
    'docs/DATA_MODEL.md':                    59_000,
    'docs/DECISIONS.md':                    144_000,
    'docs/FILE_INDEX.md':                   120_000,
    'docs/GUIDE_SOURCES.md':                127_000,
    'docs/IPHONE_RELEASE_CHECKLIST.md':      12_000,
    'docs/KNOWN_LIMITATIONS.md':             92_000,
    'docs/LATENCY.md':                       21_000,
    'docs/links-26/30-days-off/README.md':     23_000,
    'docs/links-26/HISTORY.md':               685_000,
    'docs/links-26/README.md':                 30_000,
    'docs/links-26/RULES.md':                  12_000,
    'docs/links-bilingual/README.md':          4_000,
    'docs/links-bilingual/RULES.md':           6_000,
    'docs/LINKS_REFERENCE.md':              106_000,
    'docs/MAINTENANCE_CALENDAR.md':          24_000,
    'docs/OPERATIONS_REFERENCE.md':         106_000,
    'docs/OTHER_DAYS.md':                    11_000,
    'docs/OVERTIME_AVAILABILITY.md':         55_000,
    'docs/OWNER_GUIDE.md':                    8_000,
    'docs/PAYCALC_REFERENCE.md':             69_000,
    'docs/RECOVERY_RUNBOOK.md':              45_000,
    'docs/ROADMAP.md':                       57_000,
    'docs/SECURITY_RELEASE_PLAN.md':         34_000,
    'docs/timetable-dec26/tooling/README.md': 10_000,
    'docs/VALIDATION_REGISTER.md':           16_000,
};

/** The cap the rule above would give a document of this size. */
const capFor = (/** @type {number} */ n) => Math.ceil(n * 1.05 / 1000) * 1000;

/**
 * How far above `capFor(size)` a cap may sit before it counts as banked headroom: one rounding step.
 * A document may shrink by a sentence or two without touching its cap; past 1,000 characters below
 * the rule's figure, the cap must come down.
 */
const SLACK = 1000;

/** True when a cap has more room than the rule gives a document of `n` characters. */
const tooGenerous = (/** @type {number} */ n, /** @type {number} */ cap) => cap > capFor(n) + SLACK;

/** Every document the ratchet covers, found on disk — so a new one cannot slip in uncapped. */
function documents() {
    const inDir = (/** @type {string} */ dir, /** @type {(n: string) => boolean} */ keep) =>
        readdirSync(new URL(dir, REPO_ROOT_URL)).filter(keep).map(n => dir + n);
    const skills = readdirSync(new URL('.claude/skills/', REPO_ROOT_URL))
        .map(d => `.claude/skills/${d}/SKILL.md`)
        .filter(f => existsSync(new URL(f, REPO_ROOT_URL)));
    return [
        ...readdirSync(new URL('docs/', REPO_ROOT_URL), { recursive: true })
            .map(String).filter(n => n.endsWith('.md')).map(n => 'docs/' + n.split('\\').join('/')),
        ...inDir('.claude/rules/', n => n.endsWith('.md')),
        ...skills,
        'README.md',
    ].sort();
}

test('every document is at or under its cap', () => {
    const over = Object.entries(CAPS)
        .filter(([f]) => existsSync(new URL(f, REPO_ROOT_URL)))
        .map(([f, cap]) => [f, size(f), cap])
        .filter(([, n, cap]) => Number(n) > Number(cap))
        .map(([f, n, cap]) => `${f}: ${n} characters against a cap of ${cap}`);
    assert.deepEqual(over, [],
        `these documents have grown past their caps:\n  ${over.join('\n  ')}\n` +
        'Take out what has become history first (git log holds it). If the growth is real content, ' +
        'raise the cap in this commit with a one-line reason — see this file\'s header.');
});

test('and no cap is quietly generous — a shrunk document brings its cap down', () => {
    const slack = Object.entries(CAPS)
        .filter(([f]) => existsSync(new URL(f, REPO_ROOT_URL)))
        .map(([f, cap]) => [f, size(f), cap])
        .filter(([, n, cap]) => tooGenerous(Number(n), Number(cap)))
        .map(([f, n, cap]) => `${f}: ${n} characters under a cap of ${cap} — lower it to ${capFor(Number(n))}`);
    assert.deepEqual(slack, [],
        `these caps have more room than the rule gives:\n  ${slack.join('\n  ')}\n` +
        'Lower each to the figure named, so the saving is kept rather than banked as headroom.');
});

test('every document has a cap, and every cap has a document', () => {
    const docs = documents();
    const uncapped = docs.filter(f => !(f in CAPS));
    const orphaned = Object.keys(CAPS).filter(f => !docs.includes(f));
    assert.deepEqual(uncapped, [],
        `these documents have no cap — add each at ${'`'}its size × 1.05, rounded up to the next 1,000${'`'}:\n  ` +
        uncapped.map(f => `${f} → ${capFor(size(f))}`).join('\n  '));
    assert.deepEqual(orphaned, [], `these caps name a document that is gone — delete them:\n  ${orphaned.join('\n  ')}`);
});

test('the scan finds the documents it is meant to — guard the guard', () => {
    const docs = documents();
    assert.ok(docs.filter(f => f.startsWith('docs/')).length > 20, 'the docs/ scan found almost nothing');
    assert.ok(docs.filter(f => f.startsWith('.claude/rules/')).length > 10, 'the rules scan found almost nothing');
    assert.ok(docs.includes('docs/DECISIONS.md'), 'the scan missed DECISIONS.md');
    assert.ok(docs.includes('docs/links-26/RULES.md'), 'the scan stopped reading docs/ sub-folders');
    assert.equal(capFor(10_000), 11_000, 'the cap rule moved without this file\'s header');
    assert.equal(tooGenerous(2_860, 6_000), true, 'a small document that halved must bring its cap down');
    assert.equal(tooGenerous(5_244, 6_000), false, 'a document at the rule\'s own figure is not too generous');
});
