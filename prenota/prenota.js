// Pagina /prenota/ : lezioni della settimana corrente da Supabase (funzione lezioni_settimana) e prenotazione (prenota_lezione).
// Usa solo la chiave pubblica: nessun dato personale viene letto, le regole sono nel database.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const cfg = window.WHYNOT_SUPABASE || {};
const $ = (id) => document.getElementById(id);
const TZ = "Europe/Rome";
const fmtDay = new Intl.DateTimeFormat("it-IT", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const fmtShort = new Intl.DateTimeFormat("it-IT", { timeZone: TZ, weekday: "short" });
const fmtNum = new Intl.DateTimeFormat("it-IT", { timeZone: TZ, day: "numeric", month: "short" });
const fmtTime = new Intl.DateTimeFormat("it-IT", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dayKey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

$("yr").textContent = new Date().getFullYear();

let lezioni = [], giornoSel = null, lezioneSel = null;

if (!cfg.url || !cfg.anonKey) {
  $("slots").innerHTML = '<p class="err">Prenotazioni non ancora attive: configurazione Supabase mancante.</p>';
} else {
  const supabase = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } });

  async function carica() {
    const { data, error } = await supabase.rpc("lezioni_settimana");
    if (error) { $("slots").innerHTML = `<p class="err">Impossibile caricare le lezioni: ${esc(error.message)}</p>`; return; }
    lezioni = (data || []).map((l) => ({ ...l, d: new Date(l.inizio), f: new Date(l.fine) }));
    disegnaGiorni();
  }

  function disegnaGiorni() {
    // lunedì..domenica della settimana corrente (dal primo giorno con lezioni o da oggi)
    const oggi = dayKey(new Date());
    const now = new Date();
    const romeNow = new Date(now.toLocaleString("en-US", { timeZone: TZ }));
    const iso = (romeNow.getDay() + 6) % 7; // 0 = lunedì
    const lunedi = new Date(now.getTime() - iso * 86400000);
    const giorni = [...Array(7)].map((_, k) => new Date(lunedi.getTime() + k * 86400000));
    $("weekLabel").textContent = `Settimana dal ${fmtNum.format(giorni[0])} al ${fmtNum.format(giorni[6])}`;
    if (!giornoSel) giornoSel = oggi;
    $("days").innerHTML = giorni.map((g) => {
      const k = dayKey(g), n = lezioni.filter((l) => dayKey(l.d) === k).length;
      return `<button class="day${k < oggi ? " past" : ""}" data-k="${k}" aria-pressed="${k === giornoSel}">${esc(fmtShort.format(g))} ${esc(fmtNum.format(g))}<small>${n} ${n === 1 ? "lezione" : "lezioni"}</small></button>`;
    }).join("");
    disegnaLezioni();
  }

  function disegnaLezioni() {
    const lista = lezioni.filter((l) => dayKey(l.d) === giornoSel);
    if (!lista.length) { $("slots").innerHTML = '<p class="empty">Nessuna lezione in programma per questo giorno.</p>'; return; }
    const now = Date.now();
    $("slots").innerHTML = lista.map((l) => {
      const passata = l.d.getTime() <= now, annullata = l.stato === "annullata";
      const occupati = l.capienza - l.posti_liberi, perc = Math.min(100, Math.round((occupati / l.capienza) * 100));
      let badge = `<span class="badge">${l.posti_liberi} ${l.posti_liberi === 1 ? "posto libero" : "posti liberi"}</span>`;
      if (l.posti_liberi === 0) badge = `<span class="badge full">Completa${l.in_attesa ? ` · ${l.in_attesa} in attesa` : ""}</span>`;
      if (annullata) badge = '<span class="badge x">Annullata</span>';
      const btn = annullata || passata
        ? `<span class="badge x">${annullata ? "Non disponibile" : "Conclusa"}</span>`
        : `<button class="btn${l.posti_liberi === 0 ? " ghost" : ""}" data-id="${l.id}">${l.posti_liberi === 0 ? "Lista d'attesa" : "Prenota"}</button>`;
      return `<article class="slot${annullata || passata ? " off" : ""}">
        <div class="time">${fmtTime.format(l.d)}<small>fino alle ${fmtTime.format(l.f)}</small></div>
        <div><h3><a href="../corsi/${esc(l.slug)}/">${esc(l.corso)}</a></h3>
          <div class="meta">${esc(l.categoria)} · ${esc(l.sala)} ${badge}</div>
          <div class="bar" aria-hidden="true"><i style="width:${perc}%"></i></div></div>
        <div>${btn}</div></article>`;
    }).join("");
  }

  $("days").addEventListener("click", (e) => {
    const b = e.target.closest(".day"); if (!b) return;
    giornoSel = b.dataset.k;
    $("days").querySelectorAll(".day").forEach((x) => x.setAttribute("aria-pressed", x === b));
    disegnaLezioni();
  });

  $("slots").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]"); if (!b) return;
    lezioneSel = lezioni.find((l) => String(l.id) === b.dataset.id);
    $("dlgCorso").textContent = lezioneSel.corso;
    $("dlgWhen").textContent = `${fmtDay.format(lezioneSel.d)}, ${fmtTime.format(lezioneSel.d)}–${fmtTime.format(lezioneSel.f)} · ${lezioneSel.sala}` +
      (lezioneSel.posti_liberi === 0 ? " · lezione completa: entrerai in lista d'attesa" : "");
    $("bookMsg").innerHTML = ""; $("bookForm").reset(); $("bookBtn").disabled = false;
    $("dlg").showModal();
  });
  $("dlgClose").addEventListener("click", () => $("dlg").close());

  $("bookForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const tel = f.telefono.value.trim(), mail = f.email.value.trim();
    if (!tel && !mail) { $("bookMsg").innerHTML = '<p class="msg ko">Inserisci almeno telefono o email.</p>'; return; }
    $("bookBtn").disabled = true;
    const { data, error } = await supabase.rpc("prenota_lezione", {
      p_lezione_id: lezioneSel.id, p_nome: f.nome.value.trim(), p_telefono: tel || null, p_email: mail || null,
      p_note: f.note.value.trim() || null, p_consenso: f.consenso.checked,
    });
    if (error) {
      $("bookMsg").innerHTML = `<p class="msg ko">${esc(error.message)}</p>`; $("bookBtn").disabled = false; return;
    }
    $("bookMsg").innerHTML = data.stato === "attesa"
      ? `<p class="msg ok">Sei in lista d'attesa (posizione ${data.posizione_attesa}). Ti contatteremo se si libera un posto.</p>`
      : '<p class="msg ok">Prenotazione confermata! Ti aspettiamo in palestra.</p>';
    carica();
  });

  carica();
}
