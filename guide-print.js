// Shared print / save-as-PDF handler for guide.html and paycalc-guide.html.
// Not a module: guide pages load this with a plain <script defer> tag so there
// is no need for import/export, and keeping it non-module avoids adding
// type="module" to every guide page. Do not convert to a module without also
// updating all four guide HTML files.
var btn = document.querySelector('.btn-print');
if (btn) btn.addEventListener('click', function () { window.print(); });
