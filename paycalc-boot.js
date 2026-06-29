// @ts-check
/**
 * paycalc-boot.js — 2-line bootstrap for paycalc.html (ARCHITECTURE_PLAN.md Phase 4a.2).
 *
 * CSP `script-src 'self'` blocks inline module scripts, so the page loads this
 * tiny module instead of calling init() inline. Keeping the call OUT of
 * paycalc-app.js means a test can `import { init }` without the coordinator
 * auto-running. Do not add logic here.
 */
import { init } from './paycalc-app.js';

init();
