// Cattura subito il segnale "app installabile" del browser (Android/Chrome/Edge): arriva spesso prima che app.js sia pronto.
window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); window.__promptInst = e; document.dispatchEvent(new Event('wn-installabile')); });
window.addEventListener('appinstalled', function () { window.__promptInst = null; document.dispatchEvent(new Event('wn-installabile')); });
