# Claude Code Instructions — MYB Roster App

## Version bumping (MANDATORY on every change)

**Always bump the version number before committing.** There are three places that must stay in sync:

| File | Location | Example |
|------|----------|---------|
| `index.html` | Line 2 HTML comment | `<!-- MYB Roster Calendar - Version 4.29 -->` |
| `index.html` | `CONFIG.APP_VERSION = '...'` (~line 2138) | `CONFIG.APP_VERSION = '4.29';` |
| `index.html` | `import ... from './roster-data.js?v=...'` (~line 2126) | `roster-data.js?v=4.29` |
| `admin.html` | `const ADMIN_VERSION = '...'` (~line 1767) | `const ADMIN_VERSION = '4.29';` |
| `admin.html` | `import ... from './roster-data.js?v=...'` (~line 1751) | `roster-data.js?v=4.29` |

**Rules:**
- Increment the patch number (e.g. 4.29 → 4.30) for every commit that touches app behaviour
- All five locations must show the same version number
- Tell the user the new version number in your reply after committing
