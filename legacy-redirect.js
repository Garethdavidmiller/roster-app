/**
 * Marylebone Roster — the one script the two legacy guide addresses carry (owner, 10 Nov 2026).
 *
 * `guide.html` and `fip.html` are redirect stubs (`REDIRECT_PAGES` in scripts/app-pages.mjs). On
 * Firebase Hosting a 301 in firebase.json answers them before they load, and keeps the #fragment and
 * the ?query. The GitHub Pages mirror — where most staff still open the app — serves no redirects, so
 * there the stub IS the redirect, and a meta refresh can only go to a fixed address: an old bookmark
 * to `fip.html#country-de` opened the FIP guide at the top with Germany shut, and `guide.html?from=…`
 * lost the back arrow's page. This carries both across, and replaces the history entry, so Back does
 * not land on the stub again.
 *
 * WHERE IT GOES: the stub's own `<link rel="canonical">`, which page-contract-parity already holds to
 * the meta refresh's target — so neither stub states its destination a third time, and a stub with no
 * canonical link is left to its refresh.
 *
 * THE META REFRESH STAYS, for a browser running no script and for a script that failed to load. It
 * does not overtake this navigation — measured on Chromium and WebKit, with this file held back 300ms
 * and with the guide answering 1.5s late: every load kept its fragment — because this script blocks
 * the parser, and a refresh waits for the page to finish loading.
 *
 * A classic script, not a module, so it runs before the rest of the stub has parsed. Its own block
 * keeps `to` out of the global scope.
 */
{
    const to = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
    if (to) location.replace(to + location.search + location.hash);
}
