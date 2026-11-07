// import-graph.test.mjs — detects circular imports across root ES modules.
// Uses regex-based import extraction (no dynamic execution), so it works without
// a build step and runs in the plain node:test runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));

// Modules excluded from the graph (vendor bundles or non-module files).
const EXCLUDE = new Set([
    'service-worker.js', // SW global scope — no import statements
    'purify.es.mjs',     // vendor bundle
]);

/** Strip // line comments and /* block comments before regex matching.
 *  Prevents false import matches inside JSDoc examples like `// from './foo.js'`. */
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')   // /* */ block comments (first, to avoid // inside them)
        .replace(/\/\/[^\n]*/g, '');         // // line comments
}

/** Extract local ./relative imports from an ES module source string. */
function extractImports(src) {
    const stripped = stripComments(src);
    const imports = new Set();
    // Static: import ... from './foo.js'
    const reFrom = /from\s+['"](\.[^'"]+)['"]/g;
    // Side-effect: import './foo.js'
    const reBare = /^\s*import\s+['"](\.[^'"]+)['"]/gm;
    // Dynamic: import('./foo.js')
    const reDyn  = /import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
    for (const re of [reFrom, reBare, reDyn]) {
        let m;
        while ((m = re.exec(stripped)) !== null) {
            imports.add(m[1].replace(/^\.\//, ''));
        }
    }
    return imports;
}

/** DFS cycle detection. Returns the first cycle as a path array, or null. */
function findCycle(graph) {
    const visiting = new Set();
    const visited  = new Set();
    const path = [];

    function dfs(node) {
        if (visited.has(node))  return null;
        if (visiting.has(node)) return [...path, node]; // cycle closed
        visiting.add(node);
        path.push(node);
        for (const dep of (graph.get(node) ?? [])) {
            const cycle = dfs(dep);
            if (cycle) return cycle;
        }
        path.pop();
        visiting.delete(node);
        visited.add(node);
        return null;
    }

    for (const node of graph.keys()) {
        const cycle = dfs(node);
        if (cycle) return cycle;
    }
    return null;
}

/** module → the local modules it imports, for every root module the check covers. */
function buildGraph() {
    const rootFiles = readdirSync(ROOT).filter(
        f => (f.endsWith('.js') || f.endsWith('.mjs'))
          && !f.includes('.test.')
          && !EXCLUDE.has(f)
          && !f.startsWith('generate-') // dev-only utilities
    );

    const graph = new Map();
    for (const file of rootFiles) {
        const src = readFileSync(join(ROOT, file), 'utf8');
        graph.set(file, extractImports(src));
    }
    return graph;
}

// A SCAN THAT MATCHES NOTHING FINDS NO CYCLE IN NOTHING (test audit, 7 Nov 2026). The check below
// passes on an empty graph, so an extraction regex that stopped matching — or a file filter that
// stopped finding modules — turned it green and blind at once: narrowing `reFrom` to `../` paths
// alone left the test passing over a graph of 216 modules and 9 edges (818 is the real figure).
test('the scan sees the graph it checks', () => {
    // Each import form the extractor claims, on a fixed input: the codebase has no side-effect
    // import today, so only this can show that pattern still works.
    const forms = extractImports([
        "import './side.js';",
        "import { a } from './a.js';",
        'export { b } from "./b.js";',
        "const c = await import('./c.js');",
        "// import { gone } from './commented.js';",
    ].join('\n'));
    assert.deepEqual([...forms].sort(), ['a.js', 'b.js', 'c.js', 'side.js'],
        'the extractor must see a side-effect, a static, a re-export and a dynamic import, and no commented one');

    const graph = buildGraph();
    assert.ok(graph.has('calendar-app.js') && graph.has('session.js'), 'the module scan must include the coordinators');
    const edges = [...graph.values()].reduce((n, deps) => n + deps.size, 0);
    assert.ok(edges >= graph.size,
        `only ${edges} import edges across ${graph.size} modules — fewer than one each, so the scan has stopped matching`);
    assert.ok(graph.get('session.js')?.has('notif.js'),
        'session.js loads notif.js on demand: a dynamic import the real scan must see');
});

test('no circular imports in root JS modules', () => {
    const graph = buildGraph();

    const cycle = findCycle(graph);
    assert.equal(
        cycle, null,
        `Circular import detected: ${cycle ? cycle.join(' → ') : ''}`
    );
});
