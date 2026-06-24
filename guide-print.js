// @ts-check
// Shared print / save-as-PDF handler for guide.html and paycalc-guide.html.
// Not a module: guide pages load this with a plain <script defer> tag so there
// is no need for import/export, and keeping it non-module avoids adding
// type="module" to the guide pages. Do not convert to a module without also
// updating guide.html and paycalc-guide.html (the two files that load this script).
var btn = document.querySelector('.btn-print');
if (btn) btn.addEventListener('click', function () { window.print(); });
