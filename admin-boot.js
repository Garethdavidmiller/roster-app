// @ts-check
/**
 * admin-boot.js — 2-line bootstrap for admin.html (AUTH_AND_SESSIONS.md → "The page shell").
 *
 * CSP `script-src 'self'` blocks inline module scripts, so the page cannot call
 * `init()` inline — it loads this tiny module instead. Keeping the call OUT of
 * admin-app.js means a test can `import { init }` without the coordinator
 * auto-running (the point of the init() wrap). Do not add logic here.
 */
import { init } from './admin-app.js';

init();
