// Shared print button handler for guide.html and paycalc-guide.html
var btn = document.querySelector('.btn-print');
if (btn) btn.addEventListener('click', function () { window.print(); });
