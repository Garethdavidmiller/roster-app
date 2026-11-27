// @ts-check
/**
 * link-designer-boot.js — 2-line bootstrap for link-designer.html (AUTH_AND_SESSIONS.md → "The page shell").
 *
 * CSP `script-src 'self'` blocks inline module scripts, so the page loads this
 * tiny module instead of calling init() inline. The call stays OUT of
 * link-designer-app.js so the access gate can return early from init() rather than
 * throw, and an in-place sign-in can call init() again. Do not add logic here.
 */
import { init } from './link-designer-app.js';

init();
