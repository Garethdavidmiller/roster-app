'use strict';

/**
 * functions/region.js — the ONE region every Cloud Function is deployed to: `europe-west2` (London),
 * beside the Firebase project's own (CLAUDE.md → Project identity).
 *
 * WHY A MODULE OF ITS OWN (25 Nov 2026): the region was a literal in every endpoint's and trigger's
 * options — twenty-two copies across seven files — and one left behind in a region move would deploy
 * that function somewhere else, at an address no client calls. Required directly rather than injected
 * through each domain builder's deps, because it is a fact about the deployment, not a dependency
 * anything would ever swap. The browser's half of the address is `FUNCTIONS_BASE` in function-url.js;
 * the two must name the same region.
 *
 * Requires nothing.
 */

/** The deploy region of every function in functions/index.js's export list. */
const REGION = 'europe-west2';

module.exports = { REGION };
