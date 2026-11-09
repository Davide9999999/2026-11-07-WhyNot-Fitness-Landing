// /area-personale/ : accesso, registrazione, recupero password e dashboard dell'iscritto.
// L'iscritto vede solo i propri dati: le regole sono nelle funzioni del database (mio_profilo, mie_prenotazioni, ...).
import { sb, $, esc, fmt, dayKey, cap, catColor, initials, relTime, scaricaIcs, utenteCorrente, headerAccount, erroreAuth } from "../assets/whynot-app.js";

$("yr").textContent = new Date().getFullYear();
const qs = new URLSearchParams(location.search);
const baseUrl = location.origin + location.pathname;
let utente = null, pren = [], stFiltro = "", recovery = false;

const show = (id) => ["vLoad", "vAuth", "vDash"].forEach((v) => ($(v).hidden = v !== id));
function msg(el, testo, ok) { el.className = "msg" + (testo ? (ok ? " ok" : " ko") : ""); el.textContent = testo || ""; }
let tt;
function toast(testo, ok = true) { const t = $("toast"); t.textContent = testo; t.className = "toast show " + (ok ? "ok" : "ko"); clearTimeout(tt); tt = setTimeout(() => (t.className = "toast"), 3200); }
function busy(btn, on, testo) { if (on) { btn.dataset.t = btn.textContent; btn.textContent = testo || "Attendere..."; } else btn.textContent = btn.dataset.t || btn.textContent; btn.disabled = on; }

// mostra/nascondi password
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-show]"); if (!b) return;
  const i = b.parentElement.querySelector("input"); i.type = i.type === "password" ? "text" : "password"; b.textContent = i.type === "password" ? "Mostra" : "Nascondi";
});

if (!sb) { $("vLoad").textContent = "Area personale non disponibile: configurazione mancante."; }
else {
  sb.auth.onAuthStateChange((ev) => { if (ev === "PASSWORD_RECOVERY") { recovery = true; formAuth("fNewPw"); show("vAuth"); } });
  avvia();
}

async function avvia() {
  utente = await utenteCorrente();
  headerAccount($("acct"), utente);
  if (recovery) return;
  if (!utente) { formAuth(qs.has("registrati") ? "fReg" : "fLogin"); show("vAuth"); return; }
  if (qs.get("da") === "prenota") { location.href = "../prenota/"; return; }
  await dashboard();
}

// ------------------------------------------------------------------ accesso / registrazione
function formAuth(id) {
  ["fLogin", "fReg", "fReset", "fNewPw"].forEach((f) => ($(f).hidden = f !== id));
  $("tLogin").setAttribute("aria-selected", id === "fLogin" || id === "fReset");
  $("tReg").setAttribute("aria-selected", id === "fReg");
  document.querySelector(".seg").hidden = id === "fNewPw";
}
$("tLogin").onclick = () => formAuth("fLogin");
$("tReg").onclick = () => formAuth("fReg");
$("goReset").onclick = () => { $("fReset").email.value = $("fLogin").email.value; formAuth("fReset"); };
$("backLogin").onclick = () => formAuth("fLogin");

$("fLogin").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = e.target, b = f.querySelector("[type=submit]");
  if (!f.email.value.trim() || !f.password.value) return msg($("mLogin"), "Inserisci email e password.");
  busy(b, true, "Accesso...");
  const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
  busy(b, false);
  if (error) return msg($("mLogin"), erroreAuth(error));
  msg($("mLogin"), ""); avvia();
});

$("fReg").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = e.target, b = f.querySelector("[type=submit]");
  const nome = f.nome.value.trim(), email = f.email.value.trim(), tel = f.telefono.value.trim();
  if (nome.length < 2) return msg($("mReg"), "Inserisci nome e cognome.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return msg($("mReg"), "Inserisci un'email valida.");
  if (f.password.value.length < 8) return msg($("mReg"), "La password deve avere almeno 8 caratteri.");
  if (!f.consenso.checked) return msg($("mReg"), "Serve il consenso al trattamento dei dati.");
  busy(b, true, "Creazione account...");
  const { data, error } = await sb.auth.signUp({
    email, password: f.password.value,
    options: { data: { nome, telefono: tel, consenso: "true" }, emailRedirectTo: baseUrl },
  });
  busy(b, false);
  if (error) return msg($("mReg"), erroreAuth(error));
  if (!data.session) {
    // conferma email attiva: l'account si attiva dal link ricevuto
    return msg($("mReg"), `Ci siamo quasi! Ti abbiamo inviato un'email a ${email}: apri il link per attivare l'account.`, true);
  }
  toast("Account creato. Benvenuto!"); avvia();
});

$("fReset").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = e.target, b = f.querySelector("[type=submit]");
  if (!f.email.value.trim()) return msg($("mReset"), "Inserisci la tua email.");
  busy(b, true, "Invio...");
  const { error } = await sb.auth.resetPasswordForEmail(f.email.value.trim(), { redirectTo: baseUrl });
  busy(b, false);
  if (error) return msg($("mReset"), erroreAuth(error));
  msg($("mReset"), "Se l'email è registrata riceverai a breve il link per scegliere una nuova password.", true);
});

$("fNewPw").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = e.target, b = f.querySelector("[type=submit]");
  if (f.password.value.length < 8) return msg($("mNewPw"), "Almeno 8 caratteri.");
  busy(b, true, "Salvataggio...");
  const { error } = await sb.auth.updateUser({ password: f.password.value });
  busy(b, false);
  if (error) return msg($("mNewPw"), erroreAuth(error));
  recovery = false; history.replaceState(null, "", baseUrl); toast("Password aggiornata."); avvia();
});

$("logout").onclick = async () => { await sb.auth.signOut(); utente = null; headerAccount($("acct"), null); formAuth("fLogin"); show("vAuth"); window.scrollTo(0, 0); };

// ------------------------------------------------------------------ dashboard
async function dashboard() {
  const p = utente.profilo, nome = p?.nome || utente.user.email;
  $("dAv").textContent = initials(nome);
  $("dHello").textContent = p?.nome ? `Ciao ${p.nome.split(" ")[0]}` : "Ciao!";
  const dal = p?.iscritto_dal || utente.user.created_at;
  $("dSince").textContent = `${utente.user.email}${dal ? ` · con noi dal ${fmt.date.format(new Date(dal))}` : ""}`;

  // giorno corrente negli orari
  const iso = (new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Rome" })).getDay() + 6) % 7;
  $("hrs").querySelectorAll("tr").forEach((r, k) => r.classList.toggle("today", k === iso));

  // dati profilo
  const f = $("fProf");
  f.nome.value = p?.nome || ""; f.telefono.value = p?.telefono || ""; $("pf-mail").value = utente.user.email;
  $("pfConsBox").hidden = !!p?.consenso_privacy;
  $("profHint").textContent = p?.profilo ? "Questi dati vengono usati per compilare in automatico le tue prenotazioni."
    : "Completa i tuoi dati: li useremo per compilare in automatico le prenotazioni.";

  const { data, error } = await sb.rpc("mie_prenotazioni");
  pren = error ? [] : (data || []).map((x) => ({ ...x, d: new Date(x.inizio), f: new Date(x.fine), col: catColor(x.categoria) }));
  show("vDash");
  if (error) $("prossime").innerHTML = `<p class="err">Impossibile caricare le prenotazioni: ${esc(error.message)}</p>`;
  else disegna();
  if (!p?.profilo) apriTab("profilo");
}

function disegna() {
  const now = Date.now(), mese = dayKey(new Date()).slice(0, 7);
  const fatte = pren.filter((x) => x.stato === "confermata" && x.f.getTime() <= now);
  const prossime = pren.filter((x) => x.stato !== "annullata" && x.lezione_stato !== "annullata" && x.d.getTime() > now).sort((a, b) => a.d - b.d);
  const conteggio = {};
  fatte.forEach((x) => (conteggio[x.corso] = (conteggio[x.corso] || 0) + 1));
  const pref = Object.entries(conteggio).sort((a, b) => b[1] - a[1])[0];
  $("stats").innerHTML = [
    [fatte.length, "Lezioni frequentate"],
    [fatte.filter((x) => dayKey(x.d).slice(0, 7) === mese).length, "Questo mese"],
    [prossime.length, "In programma"],
  ].map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join("") +
    `<div class="stat fav"><b>${pref ? esc(pref[0]) : "—"}</b><span>Corso preferito</span></div>`;

  $("prossime").innerHTML = prossime.length ? prossime.map((x) => riga(x, true)).join("")
    : '<div class="empty"><b>Nessuna lezione in programma</b>Scegli il prossimo allenamento tra i corsi della settimana.<br><br><a class="btn" href="../prenota/">Prenota una lezione</a></div>';

  // storico: passate + annullate
  const storico = pren.filter((x) => x.d.getTime() <= now || x.stato === "annullata" || x.lezione_stato === "annullata")
    .filter((x) => !stFiltro || (stFiltro === "fatte" ? x.stato === "confermata" && x.f.getTime() <= now && x.lezione_stato !== "annullata" : x.stato === "annullata" || x.lezione_stato === "annullata"))
    .sort((a, b) => b.d - a.d);
  let html = "", meseCorr = "";
  storico.forEach((x) => {
    const m = fmt.monthYear.format(x.d);
    if (m !== meseCorr) { html += `<p class="month">${esc(m)}</p><div class="bkl" style="margin-bottom:6px">`; meseCorr = m; }
    html += riga(x, false);
    const next = storico[storico.indexOf(x) + 1];
    if (!next || fmt.monthYear.format(next.d) !== m) html += "</div>";
  });
  $("storico").innerHTML = html || '<div class="empty"><b>Ancora nessuna lezione nello storico</b>Qui troverai tutte le lezioni a cui hai partecipato.</div>';

  // per tipo di allenamento
  const perCat = {};
  fatte.forEach((x) => (perCat[x.categoria] = (perCat[x.categoria] || 0) + 1));
  const tot = fatte.length, cats = Object.entries(perCat).sort((a, b) => b[1] - a[1]);
  $("catBox").hidden = !cats.length;
  $("catBars").innerHTML = cats.map(([c, n]) => `<div><span><b>${esc(c)}</b>${n}</span><i style="width:${Math.max(6, Math.round((n / tot) * 100))}%;background:${catColor(c)}"></i></div>`).join("");
}

function riga(x, futura) {
  const ann = x.stato === "annullata" || x.lezione_stato === "annullata";
  const badge = x.lezione_stato === "annullata" ? '<span class="badge x">Lezione annullata</span>'
    : x.stato === "annullata" ? '<span class="badge x">Annullata</span>'
    : x.stato === "attesa" ? `<span class="badge wait">${futura ? `In attesa${x.posizione_attesa ? ` · ${x.posizione_attesa}°` : ""}` : "Non confermata"}</span>`
    : futura ? '<span class="badge ok">Confermata</span>' : '<span class="badge ok">Frequentata</span>';
  return `<article class="bki${futura ? "" : " past"}${ann ? " cancel" : ""}" style="--c:${x.col}">
    <div class="date"><small>${esc(fmt.monthShort.format(x.d).replace(".", ""))}</small><b>${esc(fmt.dayNum.format(x.d))}</b></div>
    <div><h4><a href="../corsi/${esc(x.slug)}/">${esc(x.corso)}</a></h4>
      <p>${esc(cap(fmt.dayShort.format(x.d)))} · ${fmt.time.format(x.d)}–${fmt.time.format(x.f)} · ${esc(x.sala)}${futura ? ` · <b style="color:#ddd">${esc(relTime(x.d))}</b>` : ""}</p></div>
    <div class="r">${badge}${futura && !ann ? `<div class="lk"><button type="button" data-ics="${x.id}">Calendario</button><button type="button" class="danger" data-ann="${x.id}">Annulla</button></div>` : ""}</div></article>`;
}

document.querySelector(".tabs2").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) apriTab(b.dataset.t); });
function apriTab(t) {
  document.querySelectorAll(".tabs2 [data-t]").forEach((b) => b.setAttribute("aria-selected", b.dataset.t === t));
  ["pren", "storico", "profilo"].forEach((k) => ($(`tab-${k}`).hidden = k !== t));
}
$("stFilter").addEventListener("click", (e) => {
  const b = e.target.closest(".chip"); if (!b) return;
  stFiltro = b.dataset.f; $("stFilter").querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", x === b)); disegna();
});

$("vDash").addEventListener("click", async (e) => {
  const ics = e.target.closest("[data-ics]");
  if (ics) { const x = pren.find((p) => p.id === ics.dataset.ics); if (x) scaricaIcs({ id: x.id, corso: x.corso, sala: x.sala, inizio: x.d, fine: x.f }); return; }
  const ann = e.target.closest("[data-ann]"); if (!ann) return;
  const x = pren.find((p) => p.id === ann.dataset.ann);
  if (!x || !confirm(`Annullare la prenotazione di ${x.corso} (${fmt.day.format(x.d)}, ${fmt.time.format(x.d)})?`)) return;
  ann.disabled = true;
  const { error } = await sb.rpc("annulla_mia_prenotazione", { p_id: x.id });
  if (error) { ann.disabled = false; return toast(error.message, false); }
  toast("Prenotazione annullata."); dashboard();
});

$("fProf").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = e.target, b = f.querySelector("[type=submit]");
  if (f.nome.value.trim().length < 2) return msg($("mProf"), "Inserisci nome e cognome.");
  if (!$("pfConsBox").hidden && !f.consenso.checked) return msg($("mProf"), "Serve il consenso al trattamento dei dati.");
  busy(b, true, "Salvataggio...");
  const { data, error } = await sb.rpc("salva_profilo", { p_nome: f.nome.value.trim(), p_telefono: f.telefono.value.trim() || null, p_consenso: $("pfConsBox").hidden ? true : f.consenso.checked });
  busy(b, false);
  if (error) return msg($("mProf"), error.message);
  msg($("mProf"), ""); toast("Dati salvati.");
  utente.profilo = data; headerAccount($("acct"), utente); dashboard();
});

$("fPw").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = e.target, b = f.querySelector("[type=submit]");
  if (f.password.value.length < 8) return msg($("mPw"), "Almeno 8 caratteri.");
  busy(b, true, "Aggiornamento...");
  const { error } = await sb.auth.updateUser({ password: f.password.value });
  busy(b, false);
  if (error) return msg($("mPw"), erroreAuth(error));
  f.reset(); msg($("mPw"), ""); toast("Password aggiornata.");
});
