// @ts-check
/**
 * settings-boot.js — 2-line bootstrap for settings.html (AUTH_ARCHITECTURE.md Phase 4a.2).
 *
 * CSP `script-src 'self'` blocks inline module scripts, so the page cannot call
 * `init()` inline — it loads this tiny module instead. Keeping the call OUT of
 * settings-app.js would let a test `import { init }` without the coordinator
 * auto-running, though none does today (settings-app.js says where it is tested).
 * Do not add logic here.
 */
import { init } from './settings-app.js';

init();
