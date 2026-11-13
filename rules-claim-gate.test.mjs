/**
 * rules-claim-gate.test.mjs — ANONYMOUS GRANTS NOTHING, checked over every rule (AUTH_AND_SESSIONS 9).
 * Run: node scripts/run-tests.mjs rules-claim-gate.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * `request.auth != null` is true of ANY signed-in session, and the project's anonymous provider is
 * still enabled, so anybody holding the public web API key can mint one. The Calendar used to sign
 * every visitor in anonymously; a rule that asks only for a session re-admits exactly the people the
 * PIN and the passwords close out. AUTH_AND_SESSIONS 9 says so for every rule — and until this file
 * nothing checked it (sign-in audit F4, Nov 2026). A new collection written
 * `allow read: if request.auth != null;` passed every lane, because the emulator suite exercises only
 * the collections it was written for.
 *
 * ── WHAT IT CHECKS ──────────────────────────────────────────────────────────────────────────────
 *
 * Every `allow` condition in firestore.rules and storage.rules, and every rules `function` body, that
 * tests for a bare session must ALSO REQUIRE a claim or an identity: on EVERY path through its `||`s,
 * in at least one of its `&&`s. The words that count:
 *   · the identity helpers — `isMember()`, `isKnownIdentity()`, `isCalendarViewer()` — and any helper
 *     the rules define, each judged BY ITS OWN BODY, so a helper that is only `request.auth != null`
 *     cannot launder the rule that calls it, and weakening `isMember()` fails here too;
 *   · `memberName()` compared with something, or with `!= null` — a value, not a test, so it is the one
 *     word taken on trust, and its body is pinned below (null unless `isMember()`);
 *   · a claim compared EQUAL to true — `token.admin`, `token.manager`, `token.linksDesigner`,
 *     `token.calendarViewer`, directly or through `token.get(…)` — or the server-set `member` claim;
 *   · an explicit `false`.
 * A NEGATION counts for nothing: `!isMember()` and `token.admin != true` are true of a stranger.
 * And no rule may be unconditional or `if true`, the same hole without the session.
 *
 * Text-level, no emulator: both files are read with their comments blanked out, and each condition
 * is split into its `||`/`&&` structure with strings and brackets respected. An exemption is a
 * DECISION — `EXEMPT` names the rule and says why, and an entry that stops being needed fails.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Rules that may test for a bare session with no claim beside it, each with its reason — keyed
 * `<file> <match path> <methods>`, as the failure message prints them. None today.
 * @type {Map<string, string>}
 */
const EXEMPT = new Map([]);

/** A session test, in either order or spelt through the uid. */
const SESSION = /request\.auth\s*!=\s*null|null\s*!=\s*request\.auth|request\.auth\.uid\s*!=\s*null/;

/**
 * The text with every comment blanked to spaces — newlines kept, so every index and line number is
 * the original's — and every string left whole: a `//` inside a string is code.
 * @param {string} src
 */
function blankComments(src) {
    const out = src.split('');
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (c === "'" || c === '"') {
            for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
        } else if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
            const end = src[i + 1] === '/' ? src.indexOf('\n', i) : src.indexOf('*/', i + 2) + 2;
            const stop = end <= i ? src.length : end;
            for (let j = i; j < stop; j++) if (out[j] !== '\n') out[j] = ' ';
            i = stop - 1;
        }
    }
    return out.join('');
}

/**
 * Walk `text` from `from`, outside strings, with the bracket depth: `visit(char, index, depth)`
 * returns true to stop. Brackets of every kind count, so a map literal or a path's `{id}` balances.
 * @param {string} text @param {number} from @param {(c: string, i: number, depth: number) => boolean|void} visit
 * @returns {number} where it stopped, or the text's length
 */
function walk(text, from, visit) {
    let depth = 0;
    for (let i = from; i < text.length; i++) {
        const c = text[i];
        if (c === "'" || c === '"') {
            for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
            continue;
        }
        if (visit(c, i, depth)) return i;
        if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) depth--;
    }
    return text.length;
}

/** The index of the bracket closing the one at `open`. @param {string} text @param {number} open */
const closing = (text, open) => walk(text, open, (c, i, depth) => depth === 1 && ')]}'.includes(c) && i > open);

/** `expr` split at `op` where it stands outside every bracket and string. @param {string} expr @param {string} op */
function splitTop(expr, op) {
    const parts = [];
    let last = 0;
    walk(expr, 0, (c, i, depth) => {
        if (depth === 0 && expr.startsWith(op, i)) { parts.push(expr.slice(last, i)); last = i + op.length; }
    });
    parts.push(expr.slice(last));
    return parts.map(p => p.trim());
}

/** Strip parentheses that wrap the WHOLE expression. @param {string} expr */
function unwrap(expr) {
    let e = expr.trim();
    while (e.startsWith('(') && closing(e, 0) === e.length - 1) e = e.slice(1, -1).trim();
    return e;
}

/** What a rules file declares: its functions (by name — a name may be defined in more than one
 *  block), its match blocks, and its `allow` statements with the match path they sit under.
 *  @param {string} src the file as written */
function parseRules(src) {
    const text = blankComments(src);
    const lineOf = (/** @type {number} */ i) => text.slice(0, i).split('\n').length;
    /** @type {Map<string, Array<{ body: string, line: number }>>} */
    const functions = new Map();
    for (const m of text.matchAll(/\bfunction\s+(\w+)\s*\([^)]*\)\s*\{/g)) {
        const open = m.index + m[0].length - 1;
        const body = text.slice(open + 1, closing(text, open));
        if (!functions.has(m[1])) functions.set(m[1], []);
        functions.get(m[1])?.push({ body, line: lineOf(m.index) });
    }
    const blocks = [...text.matchAll(/\bmatch\s+(\/\S*)\s*\{/g)].map(m => {
        const open = m.index + m[0].length - 1;
        return { path: m[1], start: open, end: closing(text, open) };
    });
    const allows = [];
    for (const m of text.matchAll(/\ballow\s+([a-z][a-z,\s]*?)\s*(:\s*if\b|;)/g)) {
        const after = m.index + m[0].length;
        const condition = m[2] === ';' ? null
            : text.slice(after, walk(text, after, (c, _i, depth) => depth === 0 && c === ';')).trim();
        const path = blocks.filter(b => b.start < m.index && m.index < b.end).map(b => b.path).join('');
        allows.push({ methods: m[1].replace(/\s+/g, ''), condition, path, line: lineOf(m.index) });
    }
    return { functions, allows, blocks };
}

/** A function body's returned expression. @param {string} body */
function returned(body) {
    const at = body.lastIndexOf('return');
    if (at < 0) return body.trim();
    const from = at + 'return'.length;
    return body.slice(from, walk(body, from, (c, _i, depth) => depth === 0 && c === ';')).trim();
}

const CLAIMS = '(?:admin|manager|linksDesigner|calendarViewer)';
/** The words that require a claim or an identity in one comparison, positively. */
const VOCABULARY = [
    new RegExp(`request\\.auth\\.token\\.${CLAIMS}\\s*==\\s*true\\b`),
    new RegExp(`request\\.auth\\.token\\.get\\(\\s*'${CLAIMS}'\\s*,[^)]*\\)\\s*==\\s*true\\b`),
    /request\.auth\.token\.(?:get\(\s*'member'\s*,[^)]*\)|member)\s*==/,      // the server-set member claim
    /\bmemberName\(\)\s*(?:==|!=\s*null\b)|==\s*memberName\(\)/,
];

/**
 * Does `expr` require a claim or an identity on every path? `||`: every branch must; `&&`: one part
 * must; a negation never does; a call to a rules function counts only if EVERY definition's body does.
 * @param {string} expr
 * @param {Map<string, Array<{ body: string }>>} functions
 * @param {Set<string>} [visiting]  the helpers being judged up the stack, so a cycle answers no
 * @returns {boolean}
 */
function requiresIdentity(expr, functions, visiting = new Set()) {
    const e = unwrap(expr);
    const ors = splitTop(e, '||');
    if (ors.length > 1) return ors.every(p => requiresIdentity(p, functions, visiting));
    const ands = splitTop(e, '&&');
    if (ands.length > 1) return ands.some(p => requiresIdentity(p, functions, visiting));
    if (e.startsWith('!') && !e.startsWith('!=')) return false;
    if (e === 'false') return true;
    if (VOCABULARY.some(re => re.test(e))) return true;
    const call = /^(\w+)\([^()]*\)$/.exec(e);
    const defs = call && call[1] !== 'memberName' ? functions.get(call[1]) : undefined;
    if (!call || !defs || visiting.has(call[1])) return false;
    const inner = new Set([...visiting, call[1]]);
    return defs.every(d => requiresIdentity(returned(d.body), functions, inner));
}

/**
 * Does `expr` test for a session — itself, or through any rules function it calls?
 * @param {string} expr
 * @param {Map<string, Array<{ body: string }>>} functions
 * @param {Set<string>} [visiting]
 * @returns {boolean}
 */
function testsSession(expr, functions, visiting = new Set()) {
    if (SESSION.test(expr)) return true;
    return [...expr.matchAll(/\b(\w+)\s*\(/g)].some(([, name]) => !visiting.has(name)
        && (functions.get(name) ?? []).some(d => testsSession(d.body, functions, new Set([...visiting, name]))));
}

/**
 * Every rule and function body in `src` that tests for a bare session without requiring a claim, and
 * every unconditional or `if true` rule — as `<file> <match path> <methods>` keys, or `function <name>`.
 * @param {string} file @param {string} src
 */
function problems(file, src) {
    const { functions, allows } = parseRules(src);
    const found = [];
    for (const a of allows) {
        const key = `${file} ${a.path} ${a.methods}`;
        if (a.condition === null || a.condition === 'true') { found.push({ key, line: a.line, why: 'admits everybody' }); continue; }
        if (testsSession(a.condition, functions) && !requiresIdentity(a.condition, functions)) {
            found.push({ key, line: a.line, why: 'a bare session, with no claim beside it' });
        }
    }
    for (const [name, defs] of functions) {
        for (const d of defs) {
            if (SESSION.test(d.body) && !requiresIdentity(returned(d.body), functions, new Set([name]))) {
                found.push({ key: `${file} function ${name}`, line: d.line, why: 'a bare session, with no claim beside it' });
            }
        }
    }
    return found;
}

const FILES = ['firestore.rules', 'storage.rules'];
const source = (/** @type {string} */ f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');

describe('every rule that asks for a session also asks for a claim', () => {
    for (const file of FILES) {
        test(`${file}: no rule is satisfied by a bare session, and none admits everybody`, () => {
            const bad = problems(file, source(file)).filter(p => !EXEMPT.has(p.key));
            assert.deepEqual(bad.map(p => `${p.key} (line ${p.line}): ${p.why}`), [],
                'these rules admit an ANONYMOUS session — anybody with the public API key can mint one ' +
                '(AUTH_AND_SESSIONS 9). Ask for a claim or an identity helper beside `request.auth != null`, ' +
                'or add the rule to EXEMPT with the reason it is safe.');
        });
    }

    test('every exemption still names a rule that needs it, and says why', () => {
        const flagged = new Set(FILES.flatMap(f => problems(f, source(f)).map(p => p.key)));
        for (const [key, why] of EXEMPT) {
            assert.ok(flagged.has(key), `EXEMPT names "${key}", which no longer needs it — remove the entry`);
            assert.ok(why.trim().length >= 25, `EXEMPT "${key}" needs a reason a reader can disagree with`);
        }
    });
});

describe('guard the guard', () => {
    /** One collection's rule inside a minimal file, beside the real helpers' shapes. */
    const fixture = (/** @type {string} */ condition, /** @type {string} */ extra = '') => `
        service cloud.firestore { match /databases/{database}/documents {
          function isMember() { return request.auth != null && request.auth.token.get('member', null) == request.auth.token.name; }
          function memberName() { return isMember() ? request.auth.token.name : null; }
          ${extra}
          match /things/{id} { allow read: if ${condition}; }
        } }`;
    const flagged = (/** @type {string} */ condition, extra = '') =>
        problems('fixture', fixture(condition, extra)).some(p => p.key === 'fixture /databases/{database}/documents/things/{id} read');

    test('it flags each way a stranger gets in', () => {
        const strangers = [
            'request.auth != null',
            'null != request.auth',
            'request.auth.uid != null',
            '(request.auth != null)',
            'request.auth != null || request.auth.token.admin == true',
            'request.auth != null && request.auth.token.admin != true',
            'request.auth != null && !isMember()',
            "request.auth != null && !('admin' in request.auth.token)",
            "request.auth != null && (resource.data.source == 'manual' || request.auth.token.admin == true)",
            "request.auth != null && 'admin' in request.auth.token",
            'request.auth != null && memberName() != resource.data.memberName',
            "request.auth != null && resource.data.note.matches('a||b') ",
        ];
        for (const c of strangers) assert.ok(flagged(c), `a stranger's session passes: ${c}`);
        assert.ok(flagged('signedIn()', 'function signedIn() { return request.auth != null; }'),
            'a helper that is only a session must not launder the rule that calls it');
        assert.ok(problems('fixture', fixture('false', 'function signedIn() { return request.auth != null; }'))
            .some(p => p.key === 'fixture function signedIn'), 'and the helper itself is named');
        assert.ok(problems('fixture', fixture('true')).length > 0, '`if true` admits everybody');
        assert.ok(problems('fixture', fixture('true').replace('allow read: if true;', 'allow read;')).length > 0,
            'and so does a rule with no condition at all');
    });

    test('and passes each way the real rules ask', () => {
        const members = [
            'request.auth != null && request.auth.token.admin == true',
            "request.auth != null && request.auth.token.get('calendarViewer', false) == true",
            'request.auth != null && (isMember() || request.auth.token.manager == true)',
            'request.auth != null && memberName() == resource.data.memberName',
            'request.auth != null && ((resource == null && memberName() != null) || request.auth.token.admin == true)',
            'request.auth != null && request.resource.data.createdBy == memberName()',
            'false',
        ];
        for (const c of members) assert.ok(!flagged(c), `a rule that asks for a claim was flagged: ${c}`);
        assert.ok(!flagged('isWriter()', 'function isWriter() { return request.auth != null && request.auth.token.linksDesigner == true; }'),
            'a helper is judged by its own body');
    });

    test('it reads the real files, rule by rule — not a vacuous pass', () => {
        const fs = parseRules(source('firestore.rules'));
        const st = parseRules(source('storage.rules'));
        assert.ok(fs.allows.length >= 40, `only ${fs.allows.length} allow statements read from firestore.rules`);
        assert.ok(st.allows.length >= 10, `only ${st.allows.length} allow statements read from storage.rules`);
        const asking = [...fs.allows, ...st.allows].filter(a => a.condition && SESSION.test(a.condition));
        assert.ok(asking.length >= 30, `only ${asking.length} rules test for a session — the reading is wrong`);
        assert.ok(fs.allows.some(a => a.path === '/databases/{database}/documents/overrides/{docId}' && a.methods === 'read'),
            'the overrides read rule was not found under its own path');
        for (const name of ['isMember', 'isCalendarViewer', 'isKnownIdentity', 'memberName']) {
            assert.ok(fs.functions.has(name), `the identity helper ${name} was not read`);
        }
    });

    test('memberName() is null unless isMember() — the one word this file takes on trust', () => {
        const defs = parseRules(source('firestore.rules')).functions.get('memberName') ?? [];
        assert.equal(defs.length, 1);
        assert.equal(returned(defs[0].body).replace(/\s+/g, ' '), 'isMember() ? request.auth.token.name : null',
            'memberName() changed shape — re-read what this file lets it vouch for');
    });

    test('a comment is not a rule, and a string is not a comment', () => {
        const text = blankComments("allow read: if x == 'a//b'; // allow write: if request.auth != null;\n/* allow x; */");
        assert.ok(text.includes("'a//b'"), 'a // inside a string was taken for a comment');
        assert.ok(!text.includes('allow write') && !text.includes('allow x'), 'a commented-out rule was read');
        assert.equal(text.length, "allow read: if x == 'a//b'; // allow write: if request.auth != null;\n/* allow x; */".length);
    });
});
