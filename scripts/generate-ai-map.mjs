// @ts-check
/**
 * generate-ai-map.mjs — `npm run generate:ai-map`
 *
 * Rewrites the export lines in docs/AI_MAP.md from the modules themselves (scripts/ai-map-lib.mjs
 * owns the format). Run it in the SAME COMMIT as any change to a module's exports, and after adding
 * a module's entry — doc-parity.test.mjs fails a stale line, as guide-index-parity does a stale index.
 * Only the export lines are written; every hand-written word of the map is left as it is.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderAiMap } from './ai-map-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mapPath = join(root, 'docs', 'AI_MAP.md');
const before = readFileSync(mapPath, 'utf8');
const after = renderAiMap(before, p => readFileSync(join(root, p), 'utf8'));
if (after === before) {
    console.log('docs/AI_MAP.md: export lines already current');
} else {
    writeFileSync(mapPath, after);
    console.log('docs/AI_MAP.md: export lines regenerated');
}
