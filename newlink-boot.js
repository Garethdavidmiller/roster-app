// @ts-check
/**
 * newlink-boot.js — 2-line bootstrap for newlink.html.
 *
 * CSP `script-src 'self'` blocks inline module scripts, so the page cannot call
 * `init()` inline — it loads this tiny module instead. Keeping the call OUT of
 * newlink-app.js means a test can `import { init }` without the coordinator
 * auto-running. Do not add logic here.
 */
import { init } from './newlink-app.js';

init();
