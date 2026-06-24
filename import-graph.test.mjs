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

test('no circular imports in root JS modules', () => {
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

    const cycle = findCycle(graph);
    assert.equal(
        cycle, null,
        `Circular import detected: ${cycle ? cycle.join(' → ') : ''}`
    );
});
