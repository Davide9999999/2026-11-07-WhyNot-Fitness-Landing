// Footer delle pagine interne (stesso della home): anno, "Torna su" e indicatore "Aperto ora / Chiuso"
// calcolato sull'ora italiana. Orari uguali a FOOT_HOURS in index.html e a data/corsi.json: se cambiano, aggiornarli insieme.
(function () {
  var y = document.getElementById('yr'); if (y) y.textContent = new Date().getFullYear();
  document.querySelectorAll('[data-totop]').forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  });
  var el = document.getElementById('fOpen'); if (!el) return;
  var ORE = [[480, 780], [360, 1290], [360, 1290], [360, 1290], [360, 1290], [360, 1290], [480, 1020]]; // dom..sab, minuti
  var GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  var hh = function (m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  function aggiorna() {
    var d, m;
    try {
      var p = {}; new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
      d = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday); m = (+p.hour) * 60 + (+p.minute);
    } catch (_) { var n = new Date(); d = n.getDay(); m = n.getHours() * 60 + n.getMinutes(); }
    var o = ORE[d][0], c = ORE[d][1], txt = el.querySelector('span');
    if (m >= o && m < c) { txt.textContent = 'Aperto ora · fino alle ' + hh(c); el.classList.remove('closed'); }
    else {
      var nd = d, k = 0; if (m >= c) { nd = (d + 1) % 7; k = 1; }
      txt.textContent = 'Chiuso · apre ' + (k === 0 ? 'oggi' : 'domani') + ' alle ' + hh(ORE[nd][0]);
      el.classList.add('closed');
    }
    el.hidden = false;
  }
  aggiorna(); setInterval(aggiorna, 60000);
})();
