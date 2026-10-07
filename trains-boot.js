// @ts-check
/**
 * trains-boot.js — 2-line bootstrap for trains.html.
 *
 * CSP `script-src 'self'` blocks inline module scripts, so the page cannot call
 * `init()` inline — it loads this tiny module instead. Keeping the call OUT of
 * trains-app.js means a test can `import { init }` without the coordinator
 * auto-running. Do not add logic here.
 */
import { init } from './trains-app.js';

init();
