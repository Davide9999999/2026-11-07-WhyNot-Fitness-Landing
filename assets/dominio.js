// Indirizzo ufficiale: whynotfitnessclub.com. Chi arriva dai vecchi indirizzi (workers.dev, GitHub Pages, www)
// viene portato alla stessa pagina sul dominio ufficiale. Caricato per primo, nell'<head> di ogni pagina.
(function () {
  var h = location.hostname, UFF = 'whynotfitnessclub.com';
  var vecchio = /\.workers\.dev$/.test(h) || /\.github\.io$/.test(h) || h === 'www.' + UFF;
  if (!vecchio) return;
  var p = location.pathname.replace(/^\/2026-11-07-WhyNot-Fitness-Landing(?=\/|$)/, '') || '/';
  location.replace('https://' + UFF + p + location.search + location.hash);
})();
