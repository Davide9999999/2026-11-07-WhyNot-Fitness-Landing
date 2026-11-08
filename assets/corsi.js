/* Pagine corso: modulo "Richiedi informazioni" (WhatsApp / email) ed evidenza del giorno corrente.
   Il sito non salva nessun dato: il messaggio viene composto e aperto in WhatsApp o nel client email del visitatore. */
(function(){
  var form = document.getElementById('infoForm');
  if (form) {
    var corso = form.getAttribute('data-corso');
    var wa = form.getAttribute('data-wa');
    var email = form.getAttribute('data-email');
    var val = function(n){ var el = form.elements[n]; return el ? String(el.value || '').trim() : ''; };
    var buildText = function(){
      var righe = ['Ciao! Vorrei informazioni sul corso ' + corso + '.'];
      if (val('nome')) righe.push('Nome: ' + val('nome'));
      if (val('quando')) righe.push('Quando preferisco allenarmi: ' + val('quando'));
      if (val('livello')) righe.push('Livello: ' + val('livello'));
      if (val('messaggio')) righe.push(val('messaggio'));
      return righe.join('\n');
    };
    form.addEventListener('submit', function(e){
      e.preventDefault();
      window.open('https://wa.me/' + wa + '?text=' + encodeURIComponent(buildText()), '_blank', 'noopener');
    });
    var mail = document.getElementById('infoMail');
    if (mail) mail.addEventListener('click', function(e){
      e.preventDefault();
      window.location.href = 'mailto:' + email + '?subject=' + encodeURIComponent('Informazioni corso ' + corso) + '&body=' + encodeURIComponent(buildText());
    });
  }
  // giorno corrente nella tabella orari (ora italiana)
  try {
    var wd = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Rome', weekday: 'short'}).format(new Date());
    var map = {Mon:'Lun', Tue:'Mar', Wed:'Mer', Thu:'Gio', Fri:'Ven', Sat:'Sab', Sun:'Dom'};
    document.querySelectorAll('.sched tr[data-g="' + map[wd] + '"]').forEach(function(r){ r.classList.add('today'); });
  } catch (_) {}
  var y = document.getElementById('yr'); if (y) y.textContent = new Date().getFullYear();
})();
