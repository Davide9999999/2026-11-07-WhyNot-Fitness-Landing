// Banner cookie e gestione del consenso - WHY NOT Fitness Club
// Il sito usa solo strumenti tecnici. L'unico contenuto di terze parti che può impostare cookie è la mappa di Google Maps:
// viene caricata solo dopo il consenso (banner o pulsante "Mostra la mappa").
// La scelta resta salvata nel browser per 6 mesi (linee guida Garante Privacy 10/06/2021), poi il banner ricompare.
(function () {
  var KEY = "whynot-consenso-v1", DURATA = 180 * 86400000;
  var script = document.currentScript;
  var base = script ? script.src.replace(/assets\/consenso\.js.*$/, "") : "/";
  var linkCookie = base + "cookie/", linkPrivacy = base + "privacy/";

  function leggi() {
    try { var v = JSON.parse(localStorage.getItem(KEY)); if (v && Date.now() - v.ts < DURATA) return v; } catch (e) {}
    return null;
  }
  function salva(mappe) {
    var prima = leggi();
    try { localStorage.setItem(KEY, JSON.stringify({ mappe: !!mappe, ts: Date.now() })); } catch (e) {}
    chiudi();
    if (prima && prima.mappe && !mappe) { location.reload(); return; } // consenso revocato: rimuove la mappa già caricata
    applica();
  }

  var css = ".ck{position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;max-width:560px;margin-left:auto;background:#1c1c1c;color:#eee;border:1px solid rgba(255,255,255,.14);border-radius:18px;box-shadow:0 24px 60px -12px rgba(0,0,0,.85);padding:20px 20px 18px;font:14px/1.55 Inter,system-ui,sans-serif}" +
    ".ck h2{font:800 16px Inter,system-ui,sans-serif;margin:0 30px 6px 0;color:#fff}.ck p{margin:0 0 12px;color:#cfcfcf}.ck a{color:#fff;text-decoration:underline}" +
    ".ck .x{position:absolute;top:10px;right:12px;width:32px;height:32px;border:0;background:none;color:#aaa;font-size:22px;cursor:pointer;line-height:1}.ck .x:hover{color:#fff}" +
    ".ck .b{display:flex;gap:8px;flex-wrap:wrap}.ck button.k{flex:1 1 120px;padding:11px 14px;border-radius:999px;font:700 14px Inter,system-ui,sans-serif;cursor:pointer;border:1.5px solid rgba(255,255,255,.3);background:transparent;color:#fff}" +
    ".ck button.k.p{background:#b61927;border-color:#b61927}.ck button.k:hover{border-color:#fff}" +
    ".ck .opt{display:none;margin:4px 0 14px;padding:12px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1)}.ck.more .opt{display:block}" +
    ".ck label{display:flex;gap:10px;align-items:flex-start;padding:6px 0;cursor:pointer}.ck label input{margin-top:3px;width:17px;height:17px;accent-color:#e02233}.ck label small{display:block;color:#9d9d9d}" +
    ".mapc{height:100%;min-height:260px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:24px;background:#161616;color:#cfcfcf;font:14px/1.5 Inter,system-ui,sans-serif}" +
    ".mapc b{color:#fff;font-size:16px}.mapc p{max-width:44ch;margin:0}.mapc .r{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}" +
    ".mapc button,.mapc a.l{padding:11px 18px;border-radius:999px;font:700 14px Inter,system-ui,sans-serif;cursor:pointer;border:0;background:#b61927;color:#fff;text-decoration:none}.mapc a.l{background:transparent;border:1.5px solid rgba(255,255,255,.3)}" +
    "@media(max-width:600px){.ck{left:10px;right:10px;bottom:10px;padding:18px 16px 16px}}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  var box = null;
  function chiudi() { if (box) { box.remove(); box = null; } }
  function apri() {
    chiudi();
    var c = leggi();
    box = document.createElement("div");
    box.className = "ck"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Preferenze cookie");
    box.innerHTML =
      '<button class="x" type="button" aria-label="Chiudi e rifiuta">&times;</button>' +
      "<h2>Cookie e contenuti esterni</h2>" +
      "<p>Usiamo solo cookie tecnici, necessari al funzionamento del sito. Con il tuo consenso carichiamo anche la mappa di Google Maps, che può impostare cookie di Google. " +
      'Dettagli nella <a href="' + linkCookie + '">cookie policy</a> e nell\'<a href="' + linkPrivacy + '">informativa privacy</a>.</p>' +
      '<div class="opt"><label><input type="checkbox" checked disabled><span><b>Tecnici</b> (sempre attivi)<small>Sessione dell\'area personale e memorizzazione di questa scelta.</small></span></label>' +
      '<label><input type="checkbox" id="ckMappe"' + (c && c.mappe ? " checked" : "") + '><span><b>Google Maps</b><small>Mappa interattiva per raggiungere la palestra.</small></span></label></div>' +
      '<div class="b"><button class="k" type="button" data-a="no">Rifiuta</button><button class="k" type="button" data-a="more">Personalizza</button><button class="k p" type="button" data-a="si">Accetta</button></div>';
    document.body.appendChild(box);
    box.addEventListener("click", function (e) {
      var a = e.target.closest("[data-a], .x"); if (!a) return;
      if (a.classList.contains("x") || a.dataset.a === "no") return salva(false);
      if (a.dataset.a === "si") return salva(box.classList.contains("more") ? document.getElementById("ckMappe").checked : true);
      if (a.dataset.a === "more") { box.classList.add("more"); a.textContent = "Salva scelte"; a.dataset.a = "save"; return; }
      if (a.dataset.a === "save") return salva(document.getElementById("ckMappe").checked);
    });
  }

  function applica() {
    var c = leggi();
    document.querySelectorAll('[data-consenso="mappe"]').forEach(function (el) {
      if (c && c.mappe) {
        if (el.querySelector("iframe")) return;
        el.innerHTML = '<iframe title="' + (el.dataset.title || "Mappa") + '" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="' + el.dataset.src + '" style="width:100%;height:100%;border:0"></iframe>';
      } else {
        el.innerHTML = '<div class="mapc"><b>Mappa di Google Maps</b><p>Per mostrarla serve il tuo consenso: Google potrebbe impostare dei cookie. In alternativa apri l\'indirizzo direttamente su Google Maps.</p>' +
          '<div class="r"><button type="button">Mostra la mappa</button>' + (el.dataset.link ? '<a class="l" href="' + el.dataset.link + '" target="_blank" rel="noopener">Apri in Google Maps</a>' : "") + "</div></div>";
        el.querySelector("button").addEventListener("click", function () { salva(true); });
      }
    });
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-cookie-prefs]")) { e.preventDefault(); apri(); }
  });
  window.WhyNotConsenso = { apri: apri, stato: leggi };

  function avvia() { applica(); if (!leggi()) apri(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", avvia); else avvia();
})();
