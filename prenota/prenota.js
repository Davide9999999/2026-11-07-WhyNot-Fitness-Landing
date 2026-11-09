// Pagina /prenota/ : lezioni della settimana corrente (funzione lezioni_settimana) e prenotazione (prenota_lezione).
// Se l'utente ha fatto l'accesso, i suoi dati vengono compilati in automatico e la prenotazione è collegata al suo account.
import { sb, $, esc, fmt, dayKey, hourRome, cap, catColor, initials, relTime, scaricaIcs, utenteCorrente, headerAccount } from "../assets/whynot-app.js";

$("yr").textContent = new Date().getFullYear();

let lezioni = [], giornoSel = null, catSel = "", lezioneSel = null, utente = null, mie = new Map();
const ICO_OK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICO_WAIT = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

function settimana() {
  const now = new Date();
  const romeNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Rome" }));
  const iso = (romeNow.getDay() + 6) % 7; // 0 = lunedì
  const lunedi = new Date(now.getTime() - iso * 86400000);
  return [...Array(7)].map((_, k) => new Date(lunedi.getTime() + k * 86400000));
}

if (!sb) {
  $("slots").innerHTML = '<p class="err">Prenotazioni non ancora attive: configurazione mancante.</p>';
} else {
  avvia();
}

async function avvia() {
  utente = await utenteCorrente();
  headerAccount($("acct"), utente);
  await Promise.all([caricaMie(), caricaLezioni()]);
  disegnaMe();
}

async function caricaMie() {
  mie = new Map();
  if (!utente) return;
  const { data, error } = await sb.rpc("mie_prenotazioni");
  if (!error) (data || []).filter((p) => p.stato !== "annullata").forEach((p) => mie.set(p.lezione_id, p));
}

async function caricaLezioni() {
  const { data, error } = await sb.rpc("lezioni_settimana");
  if (error) { $("slots").innerHTML = `<p class="err">Impossibile caricare le lezioni: ${esc(error.message)}</p>`; return; }
  lezioni = (data || []).map((l) => ({ ...l, d: new Date(l.inizio), f: new Date(l.fine), col: catColor(l.categoria) }));
  disegnaGiorni(); disegnaCategorie(); disegnaLezioni(); disegnaLegenda();
}

function disegnaMe() {
  if (!utente) return;
  const nome = utente.profilo?.nome || utente.user.email;
  const prossima = [...mie.values()].filter((p) => new Date(p.inizio) > new Date()).sort((a, b) => new Date(a.inizio) - new Date(b.inizio))[0];
  $("meCard").innerHTML = `
    <div class="me-top"><span class="av">${esc(initials(nome))}</span><div><b>Ciao ${esc(String(nome).split(" ")[0])}!</b><small>${esc(utente.user.email)}</small></div></div>
    ${prossima ? `<div class="next"><i style="background:${catColor(prossima.categoria)}"></i><div><small class="mut">La tua prossima lezione</small><br><strong>${esc(prossima.corso)}</strong> · ${esc(cap(fmt.dayShort.format(new Date(prossima.inizio))))} ${fmt.time.format(new Date(prossima.inizio))}${prossima.stato === "attesa" ? " · in attesa" : ""}</div></div>`
      : "<p>I tuoi dati sono già pronti: scegli una lezione e conferma con un tocco.</p>"}
    <div class="row2"><a class="btn ghost" href="../area-personale/">La mia area</a></div>`;
}

function disegnaGiorni() {
  const oggi = dayKey(new Date()), now = Date.now();
  const giorni = settimana();
  $("weekLabel").textContent = `Settimana dal ${fmt.dayMonth.format(giorni[0])} al ${fmt.dayMonth.format(giorni[6])}`;
  if (!giornoSel) {
    // primo giorno da oggi in poi con lezioni ancora da fare
    const futuro = giorni.map(dayKey).find((k) => k >= oggi && lezioni.some((l) => dayKey(l.d) === k && l.d.getTime() > now && l.stato !== "annullata"));
    giornoSel = futuro || oggi;
  }
  $("days").innerHTML = giorni.map((g) => {
    const k = dayKey(g), n = lezioni.filter((l) => dayKey(l.d) === k).length;
    const mio = [...mie.values()].some((p) => dayKey(new Date(p.inizio)) === k);
    return `<button class="day${k < oggi ? " past" : ""}${k === oggi ? " today" : ""}" data-k="${k}" aria-pressed="${k === giornoSel}">
      ${mio ? '<i class="dot" title="Hai una prenotazione"></i>' : ""}<span class="wd">${k === oggi ? "Oggi" : esc(fmt.dayShort.format(g).replace(".", ""))}</span>
      <span class="dn">${esc(fmt.dayNum.format(g))}</span><span class="cnt" data-n="${n || "—"}">${n ? `${n} ${n === 1 ? "lezione" : "lezioni"}` : "—"}</span></button>`;
  }).join("");
}

function disegnaCategorie() {
  const cats = [...new Map(lezioni.map((l) => [l.categoria, l.col])).entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (cats.length < 2) { $("cats").innerHTML = ""; return; }
  $("cats").innerHTML = `<button class="chip" data-c="" aria-pressed="${!catSel}">Tutti</button>` +
    cats.map(([c, col]) => `<button class="chip" data-c="${esc(c)}" aria-pressed="${catSel === c}"><i style="background:${col}"></i>${esc(c)}</button>`).join("");
}

function disegnaLegenda() {
  $("legend").innerHTML = `<span><i class="badge ok">Prenotato</i> la tua prenotazione è confermata</span>
    <span><i class="badge wait">In attesa</i> sei in lista d'attesa: se si libera un posto passi in automatico tra i confermati</span>`;
}

function disegnaLezioni() {
  const g = settimana().find((x) => dayKey(x) === giornoSel);
  $("dayTitle").textContent = g ? cap(fmt.day.format(g)) : "Lezioni";
  const lista = lezioni.filter((l) => dayKey(l.d) === giornoSel && (!catSel || l.categoria === catSel));
  if (!lista.length) {
    $("slots").innerHTML = `<div class="empty"><b>Nessuna lezione${catSel ? ` di ${esc(catSel)}` : ""} in programma</b>Prova un altro giorno${catSel ? " o togli il filtro" : ""}.</div>`;
    return;
  }
  const parti = [["Mattina", (h) => h < 13], ["Pomeriggio", (h) => h >= 13 && h < 18], ["Sera", (h) => h >= 18]];
  $("slots").innerHTML = parti.map(([nome, fn]) => {
    const gruppo = lista.filter((l) => fn(hourRome(l.d)));
    return gruppo.length ? `<p class="part">${nome}</p>` + gruppo.map(card).join("") : "";
  }).join("");
}

function card(l) {
  const now = Date.now(), passata = l.d.getTime() <= now, annullata = l.stato === "annullata";
  const occupati = l.capienza - l.posti_liberi, perc = Math.min(100, Math.round((occupati / l.capienza) * 100));
  const durata = Math.round((l.f - l.d) / 60000);
  const mia = mie.get(l.id);
  let posti = l.posti_liberi === 0
    ? `Completa${l.in_attesa ? ` · ${l.in_attesa} in attesa` : ""}`
    : `<b>${l.posti_liberi}</b> ${l.posti_liberi === 1 ? "posto libero" : "posti liberi"} su ${l.capienza}`;
  let act;
  if (annullata) act = '<span class="badge x">Annullata</span>';
  else if (mia) act = mia.stato === "attesa"
    ? `<span class="badge wait">In attesa${mia.posizione_attesa ? ` · ${mia.posizione_attesa}°` : ""}</span><a class="mut" style="font-size:12.5px;text-decoration:underline" href="../area-personale/">Gestisci</a>`
    : `<span class="badge ok">✓ Prenotato</span><a class="mut" style="font-size:12.5px;text-decoration:underline" href="../area-personale/">Gestisci</a>`;
  else if (passata) act = '<span class="badge x">Conclusa</span>';
  else act = `<button class="btn${l.posti_liberi === 0 ? " ghost" : ""}" data-id="${l.id}">${l.posti_liberi === 0 ? "Lista d'attesa" : "Prenota"}</button>`;
  return `<article class="slot${annullata || (passata && !mia) ? " off" : ""}" style="--c:${l.col}">
    <div class="time">${fmt.time.format(l.d)}<small>${durata} min · fino alle ${fmt.time.format(l.f)}</small></div>
    <div><h3><a href="../corsi/${esc(l.slug)}/">${esc(l.corso)}</a></h3>
      <div class="meta"><span class="ct">${esc(l.categoria)}</span><span>${esc(l.sala)}</span>${l.prenotazione_obbligatoria ? "<span>Prenotazione obbligatoria</span>" : ""}${!passata && !annullata ? `<span>${esc(relTime(l.d))}</span>` : ""}</div>
      ${annullata ? "" : `<div class="seats"><div class="bar" aria-hidden="true"><i class="${perc >= 100 ? "full" : perc >= 75 ? "mid" : ""}" style="width:${perc}%"></i></div><span>${posti}</span></div>`}</div>
    <div class="act">${act}</div></article>`;
}

$("days").addEventListener("click", (e) => {
  const b = e.target.closest(".day"); if (!b) return;
  giornoSel = b.dataset.k;
  $("days").querySelectorAll(".day").forEach((x) => x.setAttribute("aria-pressed", x === b));
  disegnaLezioni();
});
$("cats").addEventListener("click", (e) => {
  const b = e.target.closest(".chip"); if (!b) return;
  catSel = b.dataset.c; disegnaCategorie(); disegnaLezioni();
});

// ------------------------------------------------------------------ prenotazione
function apri(l) {
  lezioneSel = l;
  const f = $("bookForm");
  f.reset(); f.hidden = false; $("doneBox").hidden = true; $("doneBox").innerHTML = "";
  $("bookMsg").className = "msg"; $("bookMsg").textContent = ""; $("bookBtn").disabled = false;
  $("dlgHead").style.setProperty("--c", l.col);
  $("dlgCat").textContent = l.categoria;
  $("dlgCorso").textContent = l.corso;
  $("dlgKv").innerHTML = [cap(fmt.day.format(l.d)), `${fmt.time.format(l.d)}–${fmt.time.format(l.f)}`, l.sala,
    l.posti_liberi === 0 ? "Completa: entri in lista d'attesa" : `${l.posti_liberi} ${l.posti_liberi === 1 ? "posto libero" : "posti liberi"}`]
    .map((x) => `<span>${esc(x)}</span>`).join("");
  $("bookBtn").textContent = l.posti_liberi === 0 ? "Mettimi in lista d'attesa" : "Conferma prenotazione";

  const p = utente?.profilo, email = p?.email || utente?.user.email || "";
  f.nome.value = p?.nome || ""; f.telefono.value = p?.telefono || ""; f.email.value = email;
  const completo = !!(p?.profilo && p.nome && (p.telefono || email));
  if (completo) {
    $("whoBox").innerHTML = `<div class="who-card"><span class="av">${esc(initials(p.nome))}</span><div><b>${esc(p.nome)}</b><small>${esc([p.telefono, email].filter(Boolean).join(" · "))}</small></div><button type="button" id="editWho">Modifica</button></div>`;
    $("fields").hidden = true;
    $("editWho").onclick = () => { $("fields").hidden = false; $("editWho").remove(); f.nome.focus(); };
  } else if (utente) {
    $("whoBox").innerHTML = '<p class="privacy" style="margin:0 0 12px">Completa i dati: li salverai una volta sola nella tua <a href="../area-personale/" style="text-decoration:underline">area personale</a>.</p>';
    $("fields").hidden = false;
  } else {
    $("whoBox").innerHTML = '<div class="login-hint"><span>Hai un account? I tuoi dati si compilano da soli.</span><a href="../area-personale/?da=prenota">Accedi</a></div>';
    $("fields").hidden = false;
  }
  const consensoOk = !!p?.consenso_privacy;
  $("consensoBox").hidden = consensoOk; f.consenso.checked = consensoOk;
  $("reqNote").hidden = completo;
  $("dlg").showModal();
}

$("slots").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-id]"); if (!b) return;
  const l = lezioni.find((x) => String(x.id) === b.dataset.id);
  if (l) apri(l);
});
$("dlgClose").addEventListener("click", () => $("dlg").close());
$("dlg").addEventListener("click", (e) => { if (e.target === $("dlg")) $("dlg").close(); });

$("bookForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, ko = (t) => { $("bookMsg").className = "msg ko"; $("bookMsg").textContent = t; };
  const nome = f.nome.value.trim(), tel = f.telefono.value.trim(), mail = f.email.value.trim();
  if (nome.length < 2) { $("fields").hidden = false; return ko("Inserisci nome e cognome."); }
  if (!tel && !mail) { $("fields").hidden = false; return ko("Inserisci almeno telefono o email."); }
  if (!f.consenso.checked) return ko("Serve il consenso al trattamento dei dati.");
  $("bookBtn").disabled = true; $("bookBtn").textContent = "Invio in corso...";
  const { data, error } = await sb.rpc("prenota_lezione", {
    p_lezione_id: lezioneSel.id, p_nome: nome, p_telefono: tel || null, p_email: mail || null,
    p_note: f.note.value.trim() || null, p_consenso: true,
  });
  if (error) { $("bookBtn").disabled = false; $("bookBtn").textContent = "Riprova"; return ko(error.message); }
  successo(data);
  await caricaMie(); await caricaLezioni(); disegnaMe();
});

function successo(r) {
  const l = lezioneSel, attesa = r.stato === "attesa";
  $("bookForm").hidden = true;
  const box = $("doneBox");
  box.hidden = false;
  box.innerHTML = `<div class="done${attesa ? " wait" : ""}">
    <div class="ic">${attesa ? ICO_WAIT : ICO_OK}</div>
    <h3>${attesa ? "Sei in lista d'attesa" : "Prenotazione confermata"}</h3>
    <p>${attesa
      ? `Sei in posizione <b>${r.posizione_attesa}</b>. Se si libera un posto passi in automatico tra i confermati${utente ? ": controlla lo stato nella tua area personale." : "."}`
      : `Ti aspettiamo ${esc(fmt.day.format(l.d))} alle ${fmt.time.format(l.d)} in ${esc(l.sala)}. Arriva qualche minuto prima!`}</p>
    <div class="row2">
      <button class="btn" type="button" id="icsBtn">Aggiungi al calendario</button>
      ${utente ? '<a class="btn ghost" href="../area-personale/">Le mie prenotazioni</a>'
        : '<a class="btn ghost" href="../area-personale/?registrati">Crea un account per ritrovarla</a>'}
      <button class="linkbtn" type="button" id="againBtn">Prenota un'altra lezione</button>
    </div></div>`;
  $("icsBtn").onclick = () => scaricaIcs({ id: r.id, corso: l.corso, sala: l.sala, inizio: l.d, fine: l.f });
  $("againBtn").onclick = () => $("dlg").close();
}
