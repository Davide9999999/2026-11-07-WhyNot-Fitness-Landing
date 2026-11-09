// App iscritti WHY NOT: accesso, attivazione con codice, prenotazione corsi, prenotazioni e profilo.
// Le regole (chi può prenotare, capienza, lista d'attesa) sono nel database: qui c'è solo l'interfaccia.
import { cfg, sb, $, esc, fmt, dayKey, hourRome, cap, catColor, initials, relTime, scaricaIcs, erroreAuth } from "../assets/whynot-app.js";

const ICO_OK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICO_WAIT = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const TITOLI = { pPrenota: "Prenota", pMie: "Le mie lezioni", pProfilo: "Profilo" };
let session = null, prof = null, lezioni = [], mie = [], giornoSel = null, catSel = "", vistaMie = "prossime", pagina = "pPrenota", recovery = false;

const show = (id) => ["vLoad", "vAuth", "vApp"].forEach((v) => ($(v).hidden = v !== id));
function msg(el, t, ok) { el.className = "msg" + (t ? (ok ? " ok" : " ko") : ""); el.textContent = t || ""; }
let tt;
function toast(t, ok = true) { const el = $("toast"); el.textContent = t; el.className = "toast show " + (ok ? "ok" : "ko"); clearTimeout(tt); tt = setTimeout(() => (el.className = "toast"), 3000); }
function busy(b, on, t) { if (on) { b.dataset.t = b.textContent; b.textContent = t || "Attendere..."; } else b.textContent = b.dataset.t || b.textContent; b.disabled = on; }
const mappa = (d) => ({ ...d, d: new Date(d.inizio), f: new Date(d.fine), col: catColor(d.categoria) });

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-show]"); if (!b) return;
  const i = b.parentElement.querySelector("input"); i.type = i.type === "password" ? "text" : "password"; b.textContent = i.type === "password" ? "Mostra" : "Nascondi";
});

// ------------------------------------------------------------------ avvio
if (!sb) { $("vLoad").innerHTML = '<p style="padding:30px;text-align:center">App non disponibile: configurazione mancante.</p>'; }
else {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  sb.auth.onAuthStateChange((ev, s) => {
    session = s;
    if (ev === "PASSWORD_RECOVERY") { recovery = true; form("fNewPw"); show("vAuth"); }
  });
  avvia();
}

async function avvia() {
  const { data } = await sb.auth.getSession();
  session = data.session;
  if (recovery) return;
  if (!session) { form(new URLSearchParams(location.search).has("attiva") ? "fAtt" : "fLogin"); show("vAuth"); return; }
  await entra();
}

// ------------------------------------------------------------------ accesso
function form(id) {
  ["fLogin", "fAtt", "fReset", "fNewPw"].forEach((f) => ($(f).hidden = f !== id));
  $("tLogin").setAttribute("aria-selected", id !== "fAtt");
  $("tAtt").setAttribute("aria-selected", id === "fAtt");
  document.querySelector(".auth .seg").hidden = id === "fNewPw";
}
$("tLogin").onclick = () => form("fLogin");
$("tAtt").onclick = () => form("fAtt");
$("goReset").onclick = () => { $("fReset").email.value = $("fLogin").email.value; form("fReset"); };
$("backLogin").onclick = () => form("fLogin");

$("fLogin").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = e.target, b = f.querySelector("[type=submit]");
  if (!f.email.value.trim() || !f.password.value) return msg($("mLogin"), "Inserisci email e password.");
  busy(b, true, "Accesso...");
  const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
  busy(b, false);
  if (error) return msg($("mLogin"), erroreAuth(error));
  msg($("mLogin"), ""); f.reset(); entra();
});

$("fAtt").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = e.target, b = f.querySelector("[type=submit]");
  const email = f.email.value.trim(), codice = f.codice.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return msg($("mAtt"), "Inserisci un'email valida.");
  if (codice.length < 6) return msg($("mAtt"), "Inserisci il codice di attivazione che ti ha dato la reception.");
  if (f.password.value.length < 8) return msg($("mAtt"), "La password deve avere almeno 8 caratteri.");
  if (!f.consenso.checked) return msg($("mAtt"), "Spunta la casella dell'informativa privacy.");
  busy(b, true, "Attivazione...");
  const { data, error } = await sb.auth.signUp({ email, password: f.password.value, options: { data: { codice, consenso: "true" }, emailRedirectTo: location.origin + location.pathname } });
  busy(b, false);
  if (error) {
    const m = String(error.message || "");
    if (/database error|codice/i.test(m)) return msg($("mAtt"), "Email o codice non validi, oppure codice scaduto. Controlla e riprova o chiedi un nuovo codice in reception.");
    if (/already registered|already exists/i.test(m)) return msg($("mAtt"), "Questo account è già attivo: accedi con la tua password.");
    if (/signups? not allowed|signup is disabled/i.test(m)) return msg($("mAtt"), "Attivazione non disponibile al momento: chiedi in reception.");
    return msg($("mAtt"), erroreAuth(error));
  }
  if (!data.session) return msg($("mAtt"), `Ci siamo quasi: apri il link che ti abbiamo inviato a ${email} per completare l'attivazione.`, true);
  f.reset(); toast("Account attivato. Benvenuto!"); entra();
});

$("fReset").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = e.target, b = f.querySelector("[type=submit]");
  if (!f.email.value.trim()) return msg($("mReset"), "Inserisci la tua email.");
  busy(b, true, "Invio...");
  const { error } = await sb.auth.resetPasswordForEmail(f.email.value.trim(), { redirectTo: location.origin + location.pathname });
  busy(b, false);
  if (error) return msg($("mReset"), erroreAuth(error));
  msg($("mReset"), "Se l'email è registrata riceverai il link a breve (controlla anche lo spam). Non arriva? Chiedi in reception di reimpostare l'accesso.", true);
});

$("fNewPw").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = e.target, b = f.querySelector("[type=submit]");
  if (f.password.value.length < 8) return msg($("mNewPw"), "Almeno 8 caratteri.");
  busy(b, true, "Salvataggio...");
  const { error } = await sb.auth.updateUser({ password: f.password.value });
  busy(b, false);
  if (error) return msg($("mNewPw"), erroreAuth(error));
  recovery = false; history.replaceState(null, "", location.pathname); toast("Password aggiornata."); entra();
});

$("logout").onclick = async () => { await spegniPush(); await sb.auth.signOut(); session = null; prof = null; form("fLogin"); show("vAuth"); window.scrollTo(0, 0); };

// ------------------------------------------------------------------ app
async function entra() {
  const { data } = await sb.rpc("mio_profilo");
  prof = data || {};
  const nome = prof.nome || session.user.email.split("@")[0];
  $("hAv").textContent = initials(nome); $("pAv").textContent = initials(nome);
  $("pNome").textContent = nome; $("pMail").textContent = session.user.email;
  $("pDal").textContent = prof.iscritto_dal ? `Iscritto dal ${fmt.date.format(new Date(prof.iscritto_dal))}` : "";
  $("fProf").nome.value = prof.nome || ""; $("fProf").telefono.value = prof.telefono || "";
  $("staffLink").hidden = !prof.staff;
  $("banner").innerHTML = !prof.iscritto
    ? '<p class="notice">Il tuo account non è collegato a un iscritto: puoi vedere i corsi ma non prenotare. Chiedi in reception.</p>'
    : !prof.attivo ? '<p class="notice">Il tuo account è sospeso: per prenotare chiedi in reception.</p>' : "";
  const iso = (new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Rome" })).getDay() + 6) % 7;
  $("hrs").querySelectorAll("tr").forEach((r, k) => r.classList.toggle("today", k === iso));
  $("hDate").textContent = cap(fmt.day.format(new Date()));
  show("vApp"); vai(pagina);
  installa(); statoNotifiche();
  await ricarica();
}

// settimana mostrata: 0 = questa, fino a MAX_SETT settimane avanti (prenotabili dalla domenica prima della loro settimana)
const MAX_SETT = 5;
let settOff = 0;

// solo le lezioni inserite dall'admin: una settimana non ancora pubblicata resta vuota
async function caricaLezioni() {
  const g = settimana(settOff);
  const { data, error } = await sb.rpc("lezioni_periodo", { p_da: dayKey(g[0]), p_a: dayKey(g[6]) });
  if (error) return error;
  lezioni = (data || []).map(mappa);
  return null;
}

function disegnaSettimana() {
  const g = settimana(settOff);
  $("wLbl").textContent = settOff === 0 ? "Questa settimana" : settOff === 1 ? "Prossima settimana" : `Tra ${settOff} settimane`;
  $("wSub").textContent = `${fmt.dayMonth.format(g[0])} – ${fmt.dayMonth.format(g[6])}`;
  $("wPrev").disabled = settOff === 0; $("wNext").disabled = settOff >= MAX_SETT;
}

async function ricarica() {
  const [err, m] = await Promise.all([caricaLezioni(), sb.rpc("mie_prenotazioni")]);
  if (err) { $("slots").innerHTML = `<p class="empty"><b>Impossibile caricare le lezioni</b>${esc(err.message)}</p>`; }
  mie = m.error ? [] : (m.data || []).map(mappa);
  const prossime = mie.filter((x) => x.stato !== "annullata" && x.lezione_stato !== "annullata" && x.d > new Date());
  $("nMie").textContent = prossime.length || "";
  disegnaSettimana();
  if (!err) { disegnaGiorni(); disegnaCat(); disegnaLezioni(); }
  disegnaMie();
}
async function cambiaSettimana(delta) {
  settOff = Math.min(MAX_SETT, Math.max(0, settOff + delta)); giornoSel = null; catSel = "";
  disegnaSettimana();
  $("slots").innerHTML = '<div class="skel"></div><div class="skel"></div>';
  const err = await caricaLezioni();
  if (err) { $("slots").innerHTML = `<p class="empty"><b>Impossibile caricare le lezioni</b>${esc(err.message)}</p>`; return; }
  disegnaGiorni(); disegnaCat(); disegnaLezioni();
}
$("wPrev").onclick = () => cambiaSettimana(-1);
$("wNext").onclick = () => cambiaSettimana(1);
document.addEventListener("visibilitychange", () => { if (!document.hidden && session && !$("vApp").hidden) ricarica(); });

function vai(p) {
  pagina = p;
  ["pPrenota", "pMie", "pProfilo"].forEach((k) => ($(k).hidden = k !== p));
  document.querySelectorAll(".tabbar button").forEach((b) => (b.dataset.p === p ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  $("hTitle").textContent = TITOLI[p];
  window.scrollTo(0, 0);
}
document.querySelector(".tabbar").addEventListener("click", (e) => { const b = e.target.closest("[data-p]"); if (b) vai(b.dataset.p); });
$("hAv").onclick = () => vai("pProfilo");

// ------------------------------------------------------------------ prenota
function settimana(off = 0) {
  const now = new Date(), iso = (new Date(now.toLocaleString("en-US", { timeZone: "Europe/Rome" })).getDay() + 6) % 7;
  return [...Array(7)].map((_, k) => new Date(now.getTime() + (k - iso + off * 7) * 86400000));
}
const miaPer = (id) => mie.find((p) => p.lezione_id === id && p.stato !== "annullata");

function disegnaGiorni() {
  const oggi = dayKey(new Date()), g = settimana(settOff);
  if (!giornoSel) giornoSel = g.map(dayKey).find((k) => k >= oggi && lezioni.some((l) => dayKey(l.d) === k && l.d > new Date() && l.stato !== "annullata")) || (settOff ? dayKey(g[0]) : oggi);
  $("days").innerHTML = g.map((d) => {
    const k = dayKey(d), n = lezioni.filter((l) => dayKey(l.d) === k).length;
    const mio = mie.some((p) => p.stato !== "annullata" && dayKey(p.d) === k);
    return `<button class="day${k < oggi ? " past" : ""}${k === oggi ? " today" : ""}" data-k="${k}" aria-pressed="${k === giornoSel}">${mio ? '<i class="dot"></i>' : ""}
      <span class="wd">${k === oggi ? "Oggi" : esc(fmt.dayShort.format(d).replace(".", ""))}</span><span class="dn">${esc(fmt.dayNum.format(d))}</span><span class="n">${n || "–"}</span></button>`;
  }).join("");
}
function disegnaCat() {
  const cats = [...new Map(lezioni.map((l) => [l.categoria, l.col])).entries()].sort((a, b) => a[0].localeCompare(b[0]));
  $("cats").innerHTML = cats.length < 2 ? "" : `<button class="chip" data-c="" aria-pressed="${!catSel}">Tutti</button>` +
    cats.map(([c, col]) => `<button class="chip" data-c="${esc(c)}" aria-pressed="${catSel === c}"><i style="background:${col}"></i>${esc(c)}</button>`).join("");
}
function disegnaLezioni() {
  const lista = lezioni.filter((l) => dayKey(l.d) === giornoSel && (!catSel || l.categoria === catSel));
  // le prenotazioni di una settimana si aprono la domenica precedente alle 00:00 (regola nel database)
  const apertura = fmt.dayMonth.format(new Date(settimana(settOff)[0].getTime() - 86400000));
  const aperta = lezioni.some((l) => l.prenotabile);
  if (!lezioni.length) {
    $("slots").innerHTML = `<div class="empty"><b>Corsi non ancora pubblicati</b>${settOff > 0 ? "Le lezioni di questa settimana compariranno qui appena la palestra le inserisce." : "Le lezioni di questa settimana non sono ancora disponibili."}</div>`;
    return;
  }
  const nota = settOff > 0 && !aperta ? `<p class="notice info">Le prenotazioni per questa settimana si aprono domenica ${esc(apertura)} alle 00:00.</p>` : "";
  if (!lista.length) {
    $("slots").innerHTML = nota + `<div class="empty"><b>Nessuna lezione${catSel ? ` di ${esc(catSel)}` : ""}</b>Prova un altro giorno${catSel ? " o togli il filtro" : ""}.</div>`;
    return;
  }
  const parti = [["Mattina", (h) => h < 13], ["Pomeriggio", (h) => h >= 13 && h < 18], ["Sera", (h) => h >= 18]];
  $("slots").innerHTML = nota + parti.map(([n, fn]) => { const gr = lista.filter((l) => fn(hourRome(l.d))); return gr.length ? `<p class="part">${n}</p>` + gr.map(riga).join("") : ""; }).join("");
}
function riga(l) {
  const passata = l.d <= new Date(), ann = l.stato === "annullata", mia = miaPer(l.id);
  const perc = l.capienza ? Math.min(100, Math.round(((l.capienza - l.posti_liberi) / l.capienza) * 100)) : 0;
  const chiusa = !ann && !passata && !mia && l.prenotabile === false;
  let tag;
  if (ann) tag = '<span class="tag x">Annullata</span>';
  else if (mia) tag = mia.stato === "attesa" ? `<span class="tag wait">In attesa${mia.posizione_attesa ? ` ${mia.posizione_attesa}°` : ""}</span>` : '<span class="tag ok">✓ Prenotato</span>';
  else if (passata) tag = '<span class="tag x">Conclusa</span>';
  else if (chiusa) tag = '<span class="tag soon">Presto</span>';
  else tag = l.posti_liberi === 0 ? '<span class="tag go w">Lista d\'attesa</span>' : '<span class="tag go">Prenota</span>';
  const posti = ann ? "" : l.posti_liberi === 0 ? `Completa${l.in_attesa ? ` · ${l.in_attesa} in attesa` : ""}` : `${l.posti_liberi} ${l.posti_liberi === 1 ? "posto" : "posti"} su ${l.capienza}`;
  const off = ann || (passata && !mia) || chiusa;
  return `<button class="les${ann || (passata && !mia) ? " off" : ""}" data-id="${l.id}" style="--c:${l.col}" ${off ? "disabled" : ""}>
    <span class="t">${fmt.time.format(l.d)}<small>${Math.round((l.f - l.d) / 60000)} min</small></span>
    <span><b>${esc(l.corso)}</b><span class="s"><span class="ct">${esc(l.categoria)}</span> · ${esc(l.sala)}${posti ? ` · ${posti}` : ""}</span>
      ${ann ? "" : `<span class="pb"><i class="${perc >= 100 ? "full" : perc >= 75 ? "mid" : ""}" style="width:${perc}%"></i></span>`}</span>
    ${tag}</button>`;
}
$("days").addEventListener("click", (e) => { const b = e.target.closest(".day"); if (!b) return; giornoSel = b.dataset.k; $("days").querySelectorAll(".day").forEach((x) => x.setAttribute("aria-pressed", x === b)); disegnaLezioni(); });
$("cats").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (!b) return; catSel = b.dataset.c; disegnaCat(); disegnaLezioni(); });
$("slots").addEventListener("click", (e) => { const b = e.target.closest(".les[data-id]"); if (!b || b.disabled) return; const l = lezioni.find((x) => String(x.id) === b.dataset.id); if (l) apri(l); });

// ------------------------------------------------------------------ scheda prenotazione
const sheet = $("sheet");
sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });
function testa(l) {
  return `<span class="k" style="color:${l.col}">${esc(l.categoria)}</span><h2 id="shTitle">${esc(l.corso)}</h2>
    <div class="kv"><span>${esc(cap(fmt.day.format(l.d)))}</span><span>${fmt.time.format(l.d)}–${fmt.time.format(l.f)}</span><span>${esc(l.sala)}</span></div>`;
}
function apri(l) {
  const mia = miaPer(l.id);
  if (mia) return gestisci(mia, l);
  const puo = prof?.iscritto && prof?.attivo;
  $("shBody").innerHTML = testa(l) + (puo ? `
    <div class="who"><span class="av">${esc(initials(prof.nome || session.user.email))}</span><div><b>${esc(prof.nome || session.user.email)}</b><small>${esc([prof.telefono, session.user.email].filter(Boolean).join(" · "))}</small></div></div>
    <p style="font-size:13.5px;color:#cfcfcf;margin-bottom:12px">${l.posti_liberi === 0 ? `La lezione è completa: entri in lista d'attesa${l.in_attesa ? ` dopo ${l.in_attesa} ${l.in_attesa === 1 ? "persona" : "persone"}` : ""} e passi tra i confermati appena si libera un posto.` : `${l.posti_liberi} ${l.posti_liberi === 1 ? "posto libero" : "posti liberi"} su ${l.capienza}.`}</p>
    <label>Nota per l'istruttore <small>(facoltativa, niente dati sulla salute)</small><textarea id="shNote" maxlength="500" placeholder="es. è la mia prima lezione"></textarea></label>
    <div class="btns"><button class="btn" id="shOk">${l.posti_liberi === 0 ? "Mettimi in lista d'attesa" : "Conferma prenotazione"}</button><button class="btn ghost" id="shNo">Annulla</button></div>
    <p class="msg" id="shMsg"></p>`
    : `<p class="notice" style="margin:0 0 14px">${!prof?.iscritto ? "Il tuo account non è collegato a un iscritto." : "Il tuo account è sospeso."} Per prenotare chiedi in reception.</p><div class="btns"><button class="btn ghost" id="shNo">Chiudi</button></div>`);
  $("shNo").onclick = () => sheet.close();
  if (puo) $("shOk").onclick = async (ev) => {
    const b = ev.currentTarget; busy(b, true, "Prenotazione...");
    const { data, error } = await sb.rpc("prenota_iscritto", { p_lezione_id: l.id, p_note: $("shNote").value.trim() || null });
    if (error) { busy(b, false); return msg($("shMsg"), error.message); }
    const att = data.stato === "attesa";
    $("shBody").innerHTML = testa(l) + `<div class="done${att ? " wait" : ""}"><div class="ic">${att ? ICO_WAIT : ICO_OK}</div>
      <h3>${att ? "Sei in lista d'attesa" : "Prenotato!"}</h3>
      <p>${att ? `Posizione <b>${data.posizione_attesa}</b>: se si libera un posto passi in automatico tra i confermati. Controlla lo stato in "Le mie".` : "Ti aspettiamo: arriva qualche minuto prima."}</p></div>
      <div class="btns"><button class="btn" id="shIcs">Aggiungi al calendario</button><button class="btn ghost" id="shNo">Fatto</button></div>`;
    $("shIcs").onclick = () => scaricaIcs({ id: data.id, corso: l.corso, sala: l.sala, inizio: l.d, fine: l.f });
    $("shNo").onclick = () => sheet.close();
    ricarica();
  };
  sheet.showModal();
}
function gestisci(p, l) {
  l = l || p;
  const futura = p.d > new Date() && p.stato !== "annullata" && p.lezione_stato !== "annullata";
  $("shBody").innerHTML = testa(l) + `
    <p style="margin-bottom:14px">${p.stato === "attesa" ? `<span class="tag wait">In lista d'attesa${p.posizione_attesa ? ` · ${p.posizione_attesa}°` : ""}</span>` : '<span class="tag ok">✓ Prenotazione confermata</span>'}</p>
    ${p.note ? `<p style="font-size:13.5px;color:#cfcfcf;margin-bottom:12px">Nota: «${esc(p.note)}»</p>` : ""}
    <div class="btns">${futura ? '<button class="btn ghost" id="shIcs">Aggiungi al calendario</button><button class="btn ghost danger" id="shDel">Annulla prenotazione</button>' : ""}<button class="btn ghost" id="shNo">Chiudi</button></div>
    <p class="msg" id="shMsg"></p>`;
  $("shNo").onclick = () => sheet.close();
  if (futura) {
    $("shIcs").onclick = () => scaricaIcs({ id: p.id, corso: p.corso, sala: p.sala, inizio: p.d, fine: p.f });
    $("shDel").onclick = async (ev) => {
      const b = ev.currentTarget;
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tocca di nuovo per confermare"; return; }
      busy(b, true, "Annullamento...");
      const { error } = await sb.rpc("annulla_mia_prenotazione", { p_id: p.id });
      if (error) { busy(b, false); return msg($("shMsg"), error.message); }
      sheet.close(); toast("Prenotazione annullata."); ricarica();
    };
  }
  if (!sheet.open) sheet.showModal();
}

// ------------------------------------------------------------------ le mie
function disegnaMie() {
  const now = new Date(), mese = dayKey(now).slice(0, 7);
  const fatte = mie.filter((x) => x.stato === "confermata" && x.lezione_stato !== "annullata" && x.f <= now);
  const prossime = mie.filter((x) => x.stato !== "annullata" && x.lezione_stato !== "annullata" && x.d > now).sort((a, b) => a.d - b.d);
  const conta = {}; fatte.forEach((x) => (conta[x.corso] = (conta[x.corso] || 0) + 1));
  const pref = Object.entries(conta).sort((a, b) => b[1] - a[1])[0];
  $("stats").innerHTML = [[fatte.length, "Frequentate"], [fatte.filter((x) => dayKey(x.d).slice(0, 7) === mese).length, "Questo mese"], [prossime.length, "In programma"]]
    .map(([n, t]) => `<div class="stat"><b>${n}</b><span>${t}</span></div>`).join("") +
    (pref ? `<div class="stat fav"><span>Corso preferito</span><b>${esc(pref[0])}</b></div>` : "");
  const lista = vistaMie === "prossime" ? prossime : mie.filter((x) => !prossime.includes(x)).sort((a, b) => b.d - a.d);
  if (!lista.length) {
    $("mieList").innerHTML = vistaMie === "prossime" ? '<div class="empty"><b>Nessuna lezione in programma</b>Scegli il prossimo allenamento.<br><br><button class="btn sm" data-goto="pPrenota">Prenota una lezione</button></div>'
      : '<div class="empty"><b>Storico vuoto</b>Qui troverai le lezioni a cui hai partecipato.</div>';
    return;
  }
  let html = "", m = "";
  lista.forEach((x) => {
    if (vistaMie === "storico") { const mm = fmt.monthYear.format(x.d); if (mm !== m) { html += `<p class="month">${esc(mm)}</p>`; m = mm; } }
    const ann = x.stato === "annullata" || x.lezione_stato === "annullata", fut = vistaMie === "prossime";
    const tag = x.lezione_stato === "annullata" ? '<span class="tag x">Lezione annullata</span>' : x.stato === "annullata" ? '<span class="tag x">Annullata</span>'
      : x.stato === "attesa" ? `<span class="tag wait">${fut ? `In attesa${x.posizione_attesa ? ` ${x.posizione_attesa}°` : ""}` : "Non confermata"}</span>` : `<span class="tag ok">${fut ? "Confermata" : "Frequentata"}</span>`;
    html += `<div class="bk${fut ? "" : " past"}${ann ? " x" : ""}" style="--c:${x.col}"><div class="d"><small>${esc(fmt.monthShort.format(x.d).replace(".", ""))}</small><b>${esc(fmt.dayNum.format(x.d))}</b></div>
      <div><h3>${esc(x.corso)}</h3><p>${esc(cap(fmt.dayShort.format(x.d)))} · ${fmt.time.format(x.d)} · ${esc(x.sala)}${fut ? ` · ${esc(relTime(x.d))}` : ""}</p>
      <div class="row">${tag}${fut ? `<button data-ics="${x.id}">Calendario</button><button data-ges="${x.id}">Gestisci</button>` : ""}</div></div></div>`;
  });
  $("mieList").innerHTML = html;
}
$("mieSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (!b) return; vistaMie = b.dataset.v; $("mieSeg").querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", x === b)); disegnaMie(); });
$("pMie").addEventListener("click", (e) => {
  const g = e.target.closest("[data-goto]"); if (g) return vai(g.dataset.goto);
  const i = e.target.closest("[data-ics]"); if (i) { const x = mie.find((p) => p.id === i.dataset.ics); if (x) scaricaIcs({ id: x.id, corso: x.corso, sala: x.sala, inizio: x.d, fine: x.f }); return; }
  const s = e.target.closest("[data-ges]"); if (s) { const x = mie.find((p) => p.id === s.dataset.ges); if (x) gestisci(x); }
});

// ------------------------------------------------------------------ profilo
$("fProf").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = e.target, b = f.querySelector("[type=submit]");
  if (f.nome.value.trim().length < 2) return toast("Inserisci nome e cognome.", false);
  busy(b, true, "Salvataggio...");
  const { error } = await sb.rpc("salva_profilo", { p_nome: f.nome.value.trim(), p_telefono: f.telefono.value.trim() || null, p_consenso: false });
  busy(b, false);
  if (error) return toast(error.message, false);
  toast("Dati salvati."); entra();
});
$("fPw").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = e.target, b = f.querySelector("[type=submit]");
  if (f.password.value.length < 8) return toast("La password deve avere almeno 8 caratteri.", false);
  busy(b, true, "Aggiornamento...");
  const { error } = await sb.auth.updateUser({ password: f.password.value });
  busy(b, false);
  if (error) return toast(erroreAuth(error), false);
  f.reset(); toast("Password aggiornata.");
});

// ------------------------------------------------------------------ installazione
let promptInst = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); promptInst = e; installa(); });
function installa() {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (standalone || (!promptInst && !ios)) { $("installBox").hidden = true; return; }
  $("installBox").hidden = false;
  if (promptInst) {
    $("installBtn").hidden = false;
    $("installBtn").onclick = async () => { promptInst.prompt(); await promptInst.userChoice; promptInst = null; $("installBox").hidden = true; };
  } else $("installTxt").innerHTML = "Su iPhone: apri questa pagina con <b>Safari</b>, tocca <b>Condividi</b> e poi <b>Aggiungi alla schermata Home</b>.";
}

// ------------------------------------------------------------------ notifiche push
const pushOk = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && !!cfg.vapidPublicKey;
const b64uBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const iscrizione = async () => { try { return await (await navigator.serviceWorker.ready).pushManager.getSubscription(); } catch { return null; } };

async function statoNotifiche() {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  $("notifBtn").hidden = true; $("fNotif").hidden = true;
  if (!pushOk) {
    $("notifStato").innerHTML = ios && !standalone
      ? "Su iPhone le notifiche funzionano solo con l'app installata: apri questa pagina con <b>Safari</b>, tocca <b>Condividi</b> → <b>Aggiungi alla schermata Home</b>, poi aprila dall'icona."
      : "Questo browser non supporta le notifiche. Prova con Chrome, Edge o Safari aggiornati.";
    return;
  }
  if (Notification.permission === "denied") {
    $("notifStato").textContent = "Le notifiche sono bloccate per questo sito: riattivale dalle impostazioni del browser o del telefono, poi riapri l'app.";
    return;
  }
  const sub = await iscrizione();
  if (!sub) {
    $("notifStato").textContent = "Ricevi un promemoria prima delle lezioni, l'avviso quando passi dalla lista d'attesa ai confermati, le lezioni annullate e gli avvisi della palestra.";
    $("notifBtn").hidden = false; return;
  }
  $("notifStato").textContent = "Notifiche attive su questo dispositivo.";
  const { data } = await sb.rpc("mie_notifiche");
  const f = $("fNotif"), p = data || {};
  f.promemoria_min.value = String(p.promemoria_min ?? 120); f.lista.checked = p.lista !== false; f.annullate.checked = p.annullate !== false; f.avvisi.checked = p.avvisi !== false;
  f.hidden = false;
}

$("notifBtn").onclick = async (ev) => {
  const b = ev.currentTarget; busy(b, true, "Attivazione...");
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Permesso non concesso: puoi riattivarlo dalle impostazioni del browser.", false); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(cfg.vapidPublicKey) });
    const j = sub.toJSON();
    const { error } = await sb.rpc("salva_push", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_dispositivo: navigator.userAgent.slice(0, 200) });
    if (error) { await sub.unsubscribe(); throw error; }
    toast("Notifiche attivate.");
  } catch (e) { toast("Impossibile attivare le notifiche: " + (e.message || e), false); }
  finally { busy(b, false); statoNotifiche(); }
};

$("fNotif").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = e.target, b = f.querySelector("[type=submit]");
  busy(b, true, "Salvataggio...");
  const { error } = await sb.rpc("salva_notifiche", { p_promemoria_min: Number(f.promemoria_min.value), p_lista: f.lista.checked, p_annullate: f.annullate.checked, p_avvisi: f.avvisi.checked });
  busy(b, false);
  toast(error ? error.message : "Preferenze salvate.", !error);
});
$("notifProva").onclick = async () => {
  const { error } = await sb.rpc("push_prova");
  toast(error ? error.message : "Notifica di prova in arrivo entro un minuto.", !error);
};
async function spegniPush() {
  const sub = pushOk ? await iscrizione() : null;
  if (!sub) return;
  try { await sb.rpc("rimuovi_push", { p_endpoint: sub.endpoint }); } catch {}
  try { await sub.unsubscribe(); } catch {}
}
$("notifOff").onclick = async () => { await spegniPush(); toast("Notifiche disattivate su questo dispositivo."); statoNotifiche(); };
