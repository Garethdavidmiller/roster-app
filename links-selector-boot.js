// @ts-check
/**
 * links-selector-boot.js — 2-line bootstrap for links-selector.html.
 *
 * CSP `script-src 'self'` blocks inline module scripts, so the page cannot call
 * `init()` inline — it loads this tiny module instead. Keeping the call OUT of
 * links-selector-app.js means a test can `import { init }` without the coordinator
 * auto-running. Do not add logic here.
 */
import { init } from './links-selector-app.js';

init();
