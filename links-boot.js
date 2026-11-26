// @ts-check
/**
 * links-boot.js — 2-line bootstrap for links.html (AUTH_AND_SESSIONS.md → "The page shell").
 *
 * CSP `script-src 'self'` blocks inline module scripts, so the page loads this
 * tiny module instead of calling init() inline. The call stays OUT of
 * links-app.js so the access gate can return early from init() rather than
 * throw, and an in-place sign-in can call init() again. Do not add logic here.
 */
import { init } from './links-app.js';

init();
