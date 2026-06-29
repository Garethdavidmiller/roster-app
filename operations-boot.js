// @ts-check
/**
 * operations-boot.js — 2-line bootstrap for operations.html (ARCHITECTURE_PLAN.md Phase 4a.2).
 *
 * CSP `script-src 'self'` blocks inline module scripts, so the page cannot call
 * `init()` inline — it loads this tiny module instead. Keeping the call OUT of
 * operations-app.js means a test can `import { init }` without the coordinator
 * auto-running (the point of the init() wrap). Do not add logic here.
 */
import { init } from './operations-app.js';

init();
