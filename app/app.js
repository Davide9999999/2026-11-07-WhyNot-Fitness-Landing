// App iscritti WHY NOT: accesso, attivazione con codice, prenotazione corsi, prenotazioni e profilo.
// Le regole (chi può prenotare, capienza, lista d'attesa) sono nel database: qui c'è solo l'interfaccia.
import { cfg, sb, $, esc, fmt, dayKey, hourRome, cap, catColor, initials, relTime, scaricaIcs, erroreAuth, linkEmail } from "../assets/whynot-app.js";

const ICO_OK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICO_WAIT = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const ICO_PAUSA = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
const ICO_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
const TITOLI = { pPrenota: "Prenota", pMie: "Le mie lezioni", pSchede: "Schede", pBacheca: "Bacheca", pProfilo: "Profilo" };
let session = null, prof = null, lezioni = [], mie = [], giornoSel = null, catSel = "", vistaMie = "prossime", pagina = "pPrenota", recovery = false;

const show = (id) => ["vLoad", "vAuth", "vApp"].forEach((v) => ($(v).hidden = v !== id));
function msg(el, t, ok) { el.className = "msg" + (t ? (ok ? " ok" : " ko") : ""); el.textContent = t || ""; }
let tt;
function toast(t, ok = true) {
  // con una scheda aperta il messaggio va dentro la scheda, altrimenti resterebbe coperto
  const el = $("toast"), sh = $("sheet"), host = sh?.open ? sh : document.body;
  if (el.parentNode !== host) host.appendChild(el);
  el.textContent = t; el.className = "toast show " + (ok ? "ok" : "ko"); clearTimeout(tt); tt = setTimeout(() => (el.className = "toast"), 3000); }
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
  // link "reimposta password": pagina per scegliere la nuova password, poi di nuovo l'accesso
  if (linkEmail.tipo === "recovery") recovery = true;
  const { data } = await sb.auth.getSession();
  session = data.session;
  if (recovery) {
    if (!session) { form("fReset"); show("vAuth"); return msg($("mReset"), "Il link non è più valido: richiedine uno nuovo qui sotto.", false); }
    $("fNewPw").username.value = session.user?.email || "";
    form("fNewPw"); show("vAuth"); return;
  }
  // link scaduto o già usato (Supabase lo segnala nell'indirizzo)
  if (linkEmail.errore && !session) {
    history.replaceState(null, "", location.pathname + location.search);
    form("fReset"); show("vAuth");
    return msg($("mReset"), "Il link è scaduto o è già stato usato: inserisci la tua email per riceverne uno nuovo.", false);
  }
  if (!session) {
    const q = new URLSearchParams(location.search);
    form(q.has("attiva") ? "fAtt" : "fLogin");
    // link dell'email di invito: email e codice già inseriti, poi tolti dall'indirizzo
    if (q.has("attiva") && (q.get("e") || q.get("c"))) {
      const f = $("fAtt");
      if (q.get("e")) f.email.value = q.get("e").trim().toLowerCase();
      if (q.get("c")) f.codice.value = q.get("c").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12);
      history.replaceState(null, "", location.pathname + "?attiva");
      setTimeout(() => f.password.focus(), 50);
    }
    show("vAuth"); return;
  }
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
  if (f.password.value !== f.password2.value) return msg($("mNewPw"), "Le due password non coincidono.");
  busy(b, true, "Salvataggio...");
  const { error } = await sb.auth.updateUser({ password: f.password.value });
  busy(b, false);
  if (error) return msg($("mNewPw"), erroreAuth(error));
  // esco e torno all'accesso: l'iscritto entra con la nuova password (e il browser propone di salvarla)
  const email = session?.user?.email || "";
  recovery = false; history.replaceState(null, "", location.pathname);
  await sb.auth.signOut(); session = null; f.reset();
  form("fLogin"); show("vAuth");
  const fl = $("fLogin"); if (email) fl.email.value = email;
  msg($("mLogin"), "Password aggiornata. Ora accedi con la nuova password.", true);
  fl.password.focus();
});

$("logout").onclick = async () => { await scollegaPush(); await sb.auth.signOut(); session = null; prof = null; form("fLogin"); show("vAuth"); window.scrollTo(0, 0); };

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

// settimana mostrata: 0 = questa, fino a MAX_SETT settimane avanti (prenotabili dal sabato alle 9:00 prima della loro settimana)
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
  const [err, m] = await Promise.all([caricaLezioni(), sb.rpc("mie_prenotazioni"), caricaPreferiti()]);
  badgeBacheca();
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
  Object.keys(TITOLI).forEach((k) => ($(k).hidden = k !== p));
  document.querySelectorAll(".tabbar button").forEach((b) => (b.dataset.p === p ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  $("hTitle").textContent = TITOLI[p];
  if (p === "pSchede") caricaSchede(); if (p === "pBacheca") caricaBacheca();
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
  // le prenotazioni di una settimana si aprono il sabato precedente alle 9:00 (regola nel database)
  const apertura = fmt.dayMonth.format(new Date(settimana(settOff)[0].getTime() - 2 * 86400000));
  const aperta = lezioni.some((l) => l.prenotabile);
  if (!lezioni.length) {
    $("slots").innerHTML = `<div class="empty"><b>Corsi non ancora pubblicati</b>${settOff > 0 ? "Le lezioni di questa settimana compariranno qui appena la palestra le inserisce." : "Le lezioni di questa settimana non sono ancora disponibili."}</div>`;
    return;
  }
  const nota = settOff > 0 && !aperta ? `<p class="notice info">Le prenotazioni per questa settimana si aprono sabato ${esc(apertura)} alle 9:00.</p>` : "";
  if (!lista.length) {
    $("slots").innerHTML = nota + `<div class="empty"><b>Nessuna lezione${catSel ? ` di ${esc(catSel)}` : ""}</b>Prova un altro giorno${catSel ? " o togli il filtro" : ""}.</div>`;
    return;
  }
  const parti = [["Mattina", (h) => h < 13], ["Pomeriggio", (h) => h >= 13 && h < 18], ["Sera", (h) => h >= 18]];
  $("slots").innerHTML = nota + parti.map(([n, fn]) => { const gr = lista.filter((l) => fn(hourRome(l.d))); return gr.length ? `<p class="part">${n}</p>` + gr.map(riga).join("") : ""; }).join("");
}
// corsi su prenotazione (posti limitati + lista d'attesa) o a partecipazione (segnali che vieni, nessun limite)
// finché il database non ha la versione 2026-11-12 (campo "partecipanti" assente) tutto resta "su prenotazione", come prima
const suPren = (l) => (l.partecipanti === undefined && l.annullabile_fino === undefined) || l.prenotazione_obbligatoria !== false;
const nPart = (l) => l.partecipanti ?? Math.max(0, l.capienza - l.posti_liberi);
const testoPart = (n) => (n ? `${n} ${n === 1 ? "partecipante" : "partecipanti"}` : "nessun partecipante finora");
function riga(l) {
  const passata = l.d <= new Date(), ann = l.stato === "annullata", mia = miaPer(l.id), pren = suPren(l);
  const perc = l.capienza ? Math.min(100, Math.round(((l.capienza - l.posti_liberi) / l.capienza) * 100)) : 0;
  const chiusa = !ann && !passata && !mia && l.prenotabile === false;
  let tag;
  if (ann) tag = '<span class="tag x">Annullata</span>';
  else if (mia) tag = mia.stato === "attesa" ? `<span class="tag wait">In attesa${mia.posizione_attesa ? ` ${mia.posizione_attesa}°` : ""}</span>` : `<span class="tag ok">✓ ${pren ? "Prenotato" : "Partecipi"}</span>`;
  else if (passata) tag = '<span class="tag x">Conclusa</span>';
  else if (chiusa) tag = '<span class="tag soon">Presto</span>';
  else if (!pren) tag = '<span class="tag go">Partecipo</span>';
  else tag = l.posti_liberi === 0 ? '<span class="tag go w">Lista d\'attesa</span>' : '<span class="tag go">Prenota</span>';
  const posti = ann ? "" : !pren ? testoPart(nPart(l)) : l.posti_liberi === 0 ? `Completa${l.in_attesa ? ` · ${l.in_attesa} in attesa` : ""}` : `${l.posti_liberi} ${l.posti_liberi === 1 ? "posto" : "posti"} su ${l.capienza}`;
  const off = ann || (passata && !mia) || chiusa;
  return `<button class="les${ann || (passata && !mia) ? " off" : ""}" data-id="${l.id}" style="--c:${l.col}" ${off ? "disabled" : ""}>
    <span class="t">${fmt.time.format(l.d)}<small>${Math.round((l.f - l.d) / 60000)} min</small></span>
    <span><b>${esc(l.corso)}${preferiti.has(corsoId(l)) ? ' <i class="hrt" title="Preferito">♥</i>' : ""}</b><span class="s"><span class="ct">${esc(l.categoria)}</span> · ${esc(l.sala)}${posti ? ` · ${posti}` : ""}${pren ? ' · <span class="supren">su prenotazione</span>' : ""}</span>
      ${ann || !pren ? "" : `<span class="pb"><i class="${perc >= 100 ? "full" : perc >= 75 ? "mid" : ""}" style="width:${perc}%"></i></span>`}</span>
    ${tag}</button>`;
}
$("days").addEventListener("click", (e) => { const b = e.target.closest(".day"); if (!b) return; giornoSel = b.dataset.k; $("days").querySelectorAll(".day").forEach((x) => x.setAttribute("aria-pressed", x === b)); disegnaLezioni(); });
$("cats").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (!b) return; catSel = b.dataset.c; disegnaCat(); disegnaLezioni(); });
$("slots").addEventListener("click", (e) => { const b = e.target.closest(".les[data-id]"); if (!b || b.disabled) return; const l = lezioni.find((x) => String(x.id) === b.dataset.id); if (l) apri(l); });

// ------------------------------------------------------------------ scheda prenotazione
const sheet = $("sheet");
sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });
function testa(l) {
  const cid = corsoId(l);
  return `${cid ? `<button class="favbtn${preferiti.has(cid) ? " on" : ""}" data-fav="${cid}" type="button">${preferiti.has(cid) ? "♥ Preferito" : "♡ Preferito"}</button>` : ""}<span class="k" style="color:${l.col}">${esc(l.categoria)}</span><h2 id="shTitle">${esc(l.corso)}</h2>
    <div class="kv"><span>${esc(cap(fmt.day.format(l.d)))}</span><span>${fmt.time.format(l.d)}–${fmt.time.format(l.f)}</span><span>${esc(l.sala)}</span></div>`;
}
function apri(l) {
  const mia = miaPer(l.id);
  if (mia) return gestisci(mia, l);
  const puo = prof?.iscritto && prof?.attivo, pren = suPren(l);
  const spiega = !pren
    ? `Corso a partecipazione libera, senza limite di posti: segnalando che vieni la palestra sa quante persone aspettarsi. Finora: ${testoPart(nPart(l))}.`
    : l.posti_liberi === 0 ? `La lezione è completa: entri in lista d'attesa${l.in_attesa ? ` dopo ${l.in_attesa} ${l.in_attesa === 1 ? "persona" : "persone"}` : ""} e passi tra i confermati appena si libera un posto.` : `Corso su prenotazione: ${l.posti_liberi} ${l.posti_liberi === 1 ? "posto libero" : "posti liberi"} su ${l.capienza}.`;
  $("shBody").innerHTML = testa(l) + (puo ? `
    <div class="who"><span class="av">${esc(initials(prof.nome || session.user.email))}</span><div><b>${esc(prof.nome || session.user.email)}</b><small>${esc([prof.telefono, session.user.email].filter(Boolean).join(" · "))}</small></div></div>
    <p style="font-size:13.5px;color:#cfcfcf;margin-bottom:12px">${spiega}</p>
    <label>Nota per l'istruttore <small>(facoltativa, niente dati sulla salute)</small><textarea id="shNote" maxlength="500" placeholder="es. è la mia prima lezione"></textarea></label>
    <div class="btns"><button class="btn" id="shOk">${!pren ? "Partecipo" : l.posti_liberi === 0 ? "Mettimi in lista d'attesa" : "Conferma prenotazione"}</button><button class="btn ghost" id="shNo">Annulla</button></div>
    <p class="msg" id="shMsg"></p>`
    : `<p class="notice" style="margin:0 0 14px">${!prof?.iscritto ? "Il tuo account non è collegato a un iscritto." : "Il tuo account è sospeso."} Per prenotare chiedi in reception.</p><div class="btns"><button class="btn ghost" id="shNo">Chiudi</button></div>`);
  $("shNo").onclick = () => sheet.close();
  if (puo) $("shOk").onclick = async (ev) => {
    const b = ev.currentTarget; busy(b, true, pren ? "Prenotazione..." : "Invio...");
    const { data, error } = await sb.rpc("prenota_iscritto", { p_lezione_id: l.id, p_note: $("shNote").value.trim() || null });
    if (error) { busy(b, false); return msg($("shMsg"), error.message); }
    const att = data.stato === "attesa";
    $("shBody").innerHTML = testa(l) + `<div class="done${att ? " wait" : ""}"><div class="ic">${att ? ICO_WAIT : ICO_OK}</div>
      <h3>${att ? "Sei in lista d'attesa" : pren ? "Prenotato!" : "Ci sei!"}</h3>
      <p>${att ? `Posizione <b>${data.posizione_attesa}</b>: se si libera un posto passi in automatico tra i confermati. Controlla lo stato in "Le mie".` : pren ? "Ti aspettiamo: arriva qualche minuto prima." : "Partecipazione segnata. Se cambi idea puoi toglierla fino all'inizio della lezione."}</p></div>
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
  const limite = p.annullabile_fino ? new Date(p.annullabile_fino) : p.d, puoAnnullare = futura && new Date() < limite;
  const pren = suPren(p);
  $("shBody").innerHTML = testa(l) + `
    <p style="margin-bottom:14px">${p.stato === "attesa" ? `<span class="tag wait">In lista d'attesa${p.posizione_attesa ? ` · ${p.posizione_attesa}°` : ""}</span>` : `<span class="tag ok">✓ ${pren ? "Prenotazione confermata" : "Partecipazione segnata"}</span>`}</p>
    ${p.note ? `<p style="font-size:13.5px;color:#cfcfcf;margin-bottom:12px">Nota: «${esc(p.note)}»</p>` : ""}
    ${futura ? `<p style="font-size:13px;color:#cfcfcf;margin-bottom:12px">${puoAnnullare ? `Puoi ${pren ? "annullare" : "toglierla"} fino a ${esc(fmt.dayShort.format(limite))} alle ${fmt.time.format(limite)}.` : "Il termine per annullare è passato: per disdire contatta la reception."}</p>` : ""}
    <div class="btns">${futura ? `<button class="btn ghost" id="shIcs">Aggiungi al calendario</button>${puoAnnullare ? `<button class="btn ghost danger" id="shDel">${pren ? "Annulla prenotazione" : "Non vengo più"}</button>` : '<a class="btn ghost" href="tel:+393337933400">Chiama la reception</a>'}` : ""}<button class="btn ghost" id="shNo">Chiudi</button></div>
    <p class="msg" id="shMsg"></p>`;
  $("shNo").onclick = () => sheet.close();
  if (futura) {
    $("shIcs").onclick = () => scaricaIcs({ id: p.id, corso: p.corso, sala: p.sala, inizio: p.d, fine: p.f });
    if ($("shDel")) $("shDel").onclick = async (ev) => {
      const b = ev.currentTarget;
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tocca di nuovo per confermare"; return; }
      busy(b, true, "Annullamento...");
      const { error } = await sb.rpc("annulla_mia_prenotazione", { p_id: p.id });
      if (error) { busy(b, false); return msg($("shMsg"), error.message); }
      sheet.close(); toast(pren ? "Prenotazione annullata." : "Partecipazione tolta."); ricarica();
    };
  }
  if (!sheet.open) sheet.showModal();
}

// ------------------------------------------------------------------ le mie
function disegnaMie() {
  const now = new Date(), mese = dayKey(now).slice(0, 7);
  const fatte = mie.filter((x) => x.stato === "confermata" && x.lezione_stato !== "annullata" && x.f <= now && x.presenza !== false);
  const prossime = mie.filter((x) => x.stato !== "annullata" && x.lezione_stato !== "annullata" && x.d > now).sort((a, b) => a.d - b.d);
  const conta = {}; fatte.forEach((x) => (conta[x.corso] = (conta[x.corso] || 0) + 1));
  const pref = Object.entries(conta).sort((a, b) => b[1] - a[1])[0];
  $("stats").innerHTML = [[fatte.length, "Frequentate"], [fatte.filter((x) => dayKey(x.d).slice(0, 7) === mese).length, "Questo mese"], [prossime.length, "In programma"]]
    .map(([n, t]) => `<div class="stat"><b>${n}</b><span>${t}</span></div>`).join("") +
    (pref ? `<div class="stat fav"><span>Corso preferito</span><b>${esc(pref[0])}</b></div>` : "");
  const lista = vistaMie === "prossime" ? prossime : mie.filter((x) => !prossime.includes(x)).sort((a, b) => b.d - a.d);
  if (!lista.length) {
    $("mieList").innerHTML = vistaMie === "prossime" ? (mie.some((x) => x.stato === "confermata" && x.presenza !== false && x.lezione_stato !== "annullata" && !x.voto && x.f <= now && now - x.f < 14 * 86400000) ? '<button class="valinvito" data-storico>★ Hai lezioni da valutare</button>' : '') + '<div class="empty"><b>Nessuna lezione in programma</b>Scegli il prossimo allenamento.<br><br><button class="btn sm" data-goto="pPrenota">Prenota una lezione</button></div>'
      : '<div class="empty"><b>Storico vuoto</b>Qui troverai le lezioni a cui hai partecipato.</div>';
    return;
  }
  const daValutare = mie.filter((x) => x.stato === "confermata" && x.presenza !== false && x.lezione_stato !== "annullata" && !x.voto && x.f <= now && now - x.f < 14 * 86400000).length;
  let html = vistaMie === "prossime" && daValutare ? `<button class="valinvito" data-storico>★ Hai ${daValutare} ${daValutare === 1 ? "lezione" : "lezioni"} da valutare</button>` : "", m = "";
  lista.forEach((x) => {
    if (vistaMie === "storico") { const mm = fmt.monthYear.format(x.d); if (mm !== m) { html += `<p class="month">${esc(mm)}</p>`; m = mm; } }
    const ann = x.stato === "annullata" || x.lezione_stato === "annullata", fut = vistaMie === "prossime";
    const inCorso = !fut && !ann && x.stato === "confermata" && x.d <= now && x.f > now;
    const tag = x.lezione_stato === "annullata" ? '<span class="tag x">Lezione annullata</span>' : x.stato === "annullata" ? '<span class="tag x">Annullata</span>'
      : inCorso ? '<span class="tag wait">In corso</span>'
      : x.stato === "attesa" ? `<span class="tag wait">${fut ? `In attesa${x.posizione_attesa ? ` ${x.posizione_attesa}°` : ""}` : "Non confermata"}</span>` : x.presenza === false && !fut ? '<span class="tag x">Assente</span>' : `<span class="tag ok">${fut ? (suPren(x) ? "Confermata" : "Partecipi") : "Frequentata"}</span>`;
    const valutabile = !fut && x.stato === "confermata" && x.presenza !== false && x.lezione_stato !== "annullata" && x.f <= now && now - x.f < 14 * 86400000;
    // un solo pulsante grande che apre il popup (niente stelle piccole cliccabili nell'elenco)
    const stelle = valutabile
      ? `<button class="valbtn${x.voto ? " fatto" : ""}" data-val="${x.id}">${x.voto ? `<span class="stars">${"★".repeat(x.voto)}${"☆".repeat(5 - x.voto)}</span> Modifica` : "★ Valuta la lezione"}</button>`
      : inCorso ? `<span class="valhint">Valutabile dalle ${fmt.time.format(x.f)}</span>`
      : x.voto ? `<span class="stars" title="Il tuo voto">${"★".repeat(x.voto)}${"☆".repeat(5 - x.voto)}</span>` : "";
    html += `<div class="bk${fut ? "" : " past"}${ann ? " x" : ""}" style="--c:${x.col}"><div class="d"><small>${esc(fmt.monthShort.format(x.d).replace(".", ""))}</small><b>${esc(fmt.dayNum.format(x.d))}</b></div>
      <div><h3>${esc(x.corso)}</h3><p>${esc(cap(fmt.dayShort.format(x.d)))} · ${fmt.time.format(x.d)} · ${esc(x.sala)}${fut ? ` · ${esc(relTime(x.d))}` : ""}</p>
      <div class="row">${tag}${stelle}${fut ? `<button data-ics="${x.id}">Calendario</button><button data-ges="${x.id}">Gestisci</button>` : ""}</div></div></div>`;
  });
  $("mieList").innerHTML = html;
}
$("mieSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (!b) return; vistaMie = b.dataset.v; $("mieSeg").querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", x === b)); disegnaMie(); });
$("pMie").addEventListener("click", (e) => {
  const g = e.target.closest("[data-goto]"); if (g) return vai(g.dataset.goto);
  const i = e.target.closest("[data-ics]"); if (i) { const x = mie.find((p) => p.id === i.dataset.ics); if (x) scaricaIcs({ id: x.id, corso: x.corso, sala: x.sala, inizio: x.d, fine: x.f }); return; }
  const s = e.target.closest("[data-ges]"); if (s) { const x = mie.find((p) => p.id === s.dataset.ges); if (x) gestisci(x); }
  const v = e.target.closest("[data-val]"); if (v) valuta(v.dataset.val);
  if (e.target.closest("[data-storico]")) { vistaMie = "storico"; $("mieSeg").querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", x.dataset.v === "storico")); disegnaMie(); }
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
let promptInst = window.__promptInst || null;
// il segnale del browser viene catturato da installa.js (caricato prima di tutto)
document.addEventListener("wn-installabile", () => { promptInst = window.__promptInst || null; installa(); });
function installa() {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const ua = navigator.userAgent, ios = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1), android = /android/i.test(ua);
  // su iPhone Apple non permette a nessun sito un pulsante "Installa": si aggiunge dal menu Condividi di Safari
  const inApp = /instagram|fban|fbav|fb_iab|whatsapp|line\/|micromessenger/i.test(ua);
  const ICO_SH = '<svg class="ish" viewBox="0 0 24 24" aria-label="Condividi"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M6 11H5v10h14V11h-1"/></svg>';
  const testo = promptInst ? "Aggiungi WHY NOT alla schermata Home: si apre come un'app, a schermo intero."
    : ios && inApp ? "Stai usando il browser interno di un'altra app: tocca <b>⋯</b> e scegli <b>Apri in Safari</b> (oppure copia il link qui sotto e incollalo in Safari), poi segui i passaggi per aggiungerla alla Home."
    : ios ? `<ol class="isteps"><li>Tocca ${ICO_SH} <b>Condividi</b> nella barra di Safari (su iOS 26 è dentro il menu <b>⋯</b> in basso).</li><li>Scorri e scegli <b>Aggiungi alla schermata Home</b>.</li><li>Tocca <b>Aggiungi</b>: l'icona WHY NOT comparirà tra le tue app.</li></ol>`
    : android ? "Apri il menu <b>⋮</b> del browser (in alto a destra) e scegli <b>Installa app</b> o <b>Aggiungi a schermata Home</b>."
    : "";
  // due riquadri: nella schermata di accesso e nel Profilo
  [["installAuth", "installAuthTxt", "installAuthBtn"], ["installBox", "installTxt", "installBtn"]].forEach(([box, txt, btn]) => {
    if (!$(box)) return;
    if (standalone || !testo) { $(box).hidden = true; return; }
    $(box).hidden = false; $(txt).innerHTML = testo + (ios ? `<button class="btn ghost sm" type="button" data-copialink>Copia il link dell'app</button>` : ""); $(btn).hidden = !promptInst;
    $(txt).querySelector("[data-copialink]")?.addEventListener("click", () => navigator.clipboard.writeText("https://whynotfitnessclub.com/app/").then(() => toast("Link copiato: incollalo in Safari."), () => toast("whynotfitnessclub.com/app", true)));
    $(btn).onclick = async () => { if (!promptInst) return; promptInst.prompt(); await promptInst.userChoice; window.__promptInst = promptInst = null; installa(); };
  });
}
installa();

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
  let sub = await iscrizione();
  // dispositivo già abilitato (es. dopo un'uscita e un nuovo accesso): ricollega in silenzio all'utente attuale, senza chiedere di nuovo
  if (sub && Notification.permission === "granted" && !pushSpento()) {
    const j = sub.toJSON();
    const { error } = await sb.rpc("salva_push", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_dispositivo: navigator.userAgent.slice(0, 200) });
    if (error) sub = null;
  } else if (sub && pushSpento()) sub = null;
  if (!sub) {
    $("notifStato").textContent = "Ricevi un promemoria prima delle lezioni, l'avviso quando passi dalla lista d'attesa ai confermati, le lezioni annullate e gli avvisi della palestra.";
    $("notifBtn").hidden = false; return;
  }
  $("notifStato").textContent = "Notifiche attive su questo dispositivo.";
  const { data } = await sb.rpc("mie_notifiche");
  const f = $("fNotif"), p = data || {};
  f.promemoria_min.value = String(p.promemoria_min ?? 120); f.lista.checked = p.lista !== false; f.annullate.checked = p.annullate !== false; f.avvisi.checked = p.avvisi !== false; f.settimana.checked = p.settimana !== false;
  f.hidden = false;
}

$("notifBtn").onclick = async (ev) => {
  const b = ev.currentTarget; busy(b, true, "Attivazione...");
  try {
    segnaPushSpento(false);
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
  const { error } = await sb.rpc("salva_notifiche", { p_promemoria_min: Number(f.promemoria_min.value), p_lista: f.lista.checked, p_annullate: f.annullate.checked, p_avvisi: f.avvisi.checked, p_settimana: f.settimana.checked });
  busy(b, false);
  toast(error ? error.message : "Preferenze salvate.", !error);
});
$("notifProva").onclick = async () => {
  const { error } = await sb.rpc("push_prova");
  toast(error ? error.message : "Notifica di prova in arrivo entro un minuto.", !error);
};
// "Disattiva" sul dispositivo: ricordato sul telefono, così un nuovo accesso non le riattiva da solo
const pushSpento = () => { try { return localStorage.getItem("wn-push-off") === "1"; } catch { return false; } };
const segnaPushSpento = (v) => { try { v ? localStorage.setItem("wn-push-off", "1") : localStorage.removeItem("wn-push-off"); } catch {} };
// uscita: il telefono smette di ricevere le notifiche di questo utente, ma resta abilitato (al prossimo accesso si ricollega senza chiedere)
async function scollegaPush() {
  const sub = pushOk ? await iscrizione() : null;
  if (sub) { try { await sb.rpc("rimuovi_push", { p_endpoint: sub.endpoint }); } catch {} }
}
async function spegniPush() {
  const sub = pushOk ? await iscrizione() : null;
  if (!sub) return;
  try { await sb.rpc("rimuovi_push", { p_endpoint: sub.endpoint }); } catch {}
  try { await sub.unsubscribe(); } catch {}
}
$("notifOff").onclick = async () => { segnaPushSpento(true); await spegniPush(); toast("Notifiche disattivate su questo dispositivo."); statoNotifiche(); };

// ------------------------------------------------------------------ corsi preferiti
let preferiti = new Set(), corsiAttivi = [];
const corsoId = (l) => l.corso_id || corsiAttivi.find((c) => c.slug === l.slug)?.id || null;
async function caricaPreferiti() {
  const [p, c] = await Promise.all([sb.rpc("miei_preferiti"), corsiAttivi.length ? null : sb.from("corsi").select("id,slug,nome,categoria").eq("attivo", true).order("nome")]);
  if (!p.error) preferiti = new Set((p.data || []).map((x) => (typeof x === "object" ? Object.values(x)[0] : x)));
  if (c && !c.error) corsiAttivi = c.data || [];
  disegnaPreferiti();
}
function disegnaPreferiti() {
  const box = $("prefList"); if (!box) return;
  box.innerHTML = corsiAttivi.map((c) => `<button type="button" class="chip${preferiti.has(c.id) ? " on" : ""}" data-fav="${c.id}" aria-pressed="${preferiti.has(c.id)}"><i style="background:${catColor(c.categoria)}"></i>${esc(c.nome)}</button>`).join("");
}
async function cambiaPreferito(id) {
  const on = !preferiti.has(id);
  const { error } = await sb.rpc("imposta_preferito", { p_corso_id: id, p_preferito: on });
  if (error) return toast(error.message, false);
  on ? preferiti.add(id) : preferiti.delete(id);
  toast(on ? "Aggiunto ai preferiti: ti avvisiamo quando esce la nuova settimana." : "Tolto dai preferiti.");
  disegnaPreferiti(); disegnaLezioni();
  document.querySelectorAll(`.favbtn[data-fav="${id}"]`).forEach((b) => { b.classList.toggle("on", on); b.textContent = on ? "♥ Preferito" : "♡ Preferito"; });
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-fav]"); if (b) cambiaPreferito(Number(b.dataset.fav)); });

// ------------------------------------------------------------------ valutazione lezione
// popup di valutazione: stelle grandi, voto scelto con calma e confermato con "Invia"; si può modificare entro 14 giorni
const GIUDIZI = ["", "Pessima", "Scarsa", "Nella media", "Buona", "Ottima"];
function valuta(pid) {
  const x = mie.find((p) => p.id === pid); if (!x) return;
  let v = x.voto || 0;
  const disegna = () => {
    $("vStelle").innerHTML = [1, 2, 3, 4, 5].map((s) => `<button type="button" data-s="${s}" aria-label="${s} ${s === 1 ? "stella" : "stelle"}: ${GIUDIZI[s]}" aria-pressed="${s === v}" class="${s <= v ? "on" : ""}">★</button>`).join("");
    $("vGiudizio").textContent = v ? `${v} ${v === 1 ? "stella" : "stelle"} · ${GIUDIZI[v]}` : "Tocca una stella per scegliere il voto";
    $("vOk").disabled = !v;
  };
  $("shBody").innerHTML = `<span class="k" style="color:${x.col}">${x.voto ? "Modifica la valutazione" : "Valuta la lezione"}</span><h2>${esc(x.corso)}</h2>
    <div class="kv"><span>${esc(cap(fmt.day.format(x.d)))}</span><span>${fmt.time.format(x.d)}</span></div>
    <div class="rate big" id="vStelle" role="radiogroup" aria-label="Voto da 1 a 5"></div>
    <p class="giudizio" id="vGiudizio" aria-live="polite"></p>
    <label>Commento <small>(facoltativo, lo legge la palestra)</small><textarea id="vComm" maxlength="300" placeholder="Cosa ti è piaciuto? Cosa miglioreresti?"></textarea></label>
    <div class="btns"><button class="btn" id="vOk">${x.voto ? "Salva la modifica" : "Invia valutazione"}</button><button class="btn ghost" id="shNo">Annulla</button></div><p class="msg" id="shMsg"></p>`;
  $("vComm").value = x.commento || "";
  disegna();
  $("vStelle").onclick = (e) => { const b = e.target.closest("[data-s]"); if (b) { v = Number(b.dataset.s); disegna(); } };
  $("shNo").onclick = () => sheet.close();
  $("vOk").onclick = async (ev) => {
    if (!v) return;
    const b = ev.currentTarget; busy(b, true, "Invio...");
    const comm = $("vComm").value.trim() || null;
    const { error } = await sb.rpc("valuta_lezione", { p_prenotazione_id: pid, p_voto: v, p_commento: comm });
    if (error) { busy(b, false); return msg($("shMsg"), error.message); }
    const nuovo = !x.voto; x.voto = v; x.commento = comm;
    sheet.close(); toast(nuovo ? "Grazie per la valutazione!" : "Valutazione aggiornata."); disegnaMie();
  };
  sheet.showModal();
}

// ------------------------------------------------------------------ schede: elenco
// I carichi registrati si leggono una volta con l'elenco: aprire una scheda è immediato.
let schede = [], cues = new Map(), regCache = [];
const WO_KEY = "whynot-allenamento";   // allenamento in corso (si riprende se si chiude la scheda)
const leggiWo = () => { try { const v = JSON.parse(localStorage.getItem(WO_KEY) || "null"); return v && v.data === oggiK() ? v : null; } catch { return null; } };
const salvaWo = (v) => { try { v ? localStorage.setItem(WO_KEY, JSON.stringify(v)) : localStorage.removeItem(WO_KEY); } catch {} };

async function caricaSchede() {
  if (!schede.length) $("schedeList").innerHTML = '<div class="sch sk"></div><div class="sch sk"></div>';
  const [a, b] = await Promise.all([sb.rpc("mie_schede"), sb.rpc("miei_carichi")]);
  if (a.error) { $("schedeList").innerHTML = `<p class="empty"><b>Impossibile caricare le schede</b>${esc(a.error.message)}</p>`; return; }
  schede = a.data || []; regCache = b.data || [];
  disegnaElenco();
}
function giornoSuggerito(s) {
  const G = s.struttura?.giorni || [];
  if (G.length < 2) return 0;
  const mie = regCache.filter((r) => r.scheda_id === s.id);
  if (!mie.length) return 0;
  const oggi = mie.find((r) => r.data === oggiK());
  return oggi ? Math.min(oggi.giorno, G.length - 1) : (mie[0].giorno + 1) % G.length;
}
function disegnaElenco() {
  const inCorso = leggiWo();
  $("schedeList").innerHTML = schede.map((s, k) => {
    const st = s.struttura, g = st?.giorni || [], nEs = g.reduce((t, d) => t + (d.esercizi || []).length, 0);
    const meta = [g.length > 1 ? `${g.length} allenamenti` : "", nEs ? `${nEs} ${nEs === 1 ? "esercizio" : "esercizi"}` : "", st?.frequenza ? `${st.frequenza}× a settimana` : "", st?.settimane ? `${st.settimane} settimane` : ""].filter(Boolean);
    const mie = regCache.filter((r) => r.scheda_id === s.id), ult = mie[0];
    const live = inCorso && inCorso.id === s.id;
    const prossimo = g.length ? (live ? `Riprendi: ${g[inCorso.g]?.nome || "allenamento"}` : g.length > 1 ? `Prossimo: ${g[giornoSuggerito(s)].nome}` : "Inizia l'allenamento") : "Leggi la scheda";
    return `<button class="sch${live ? " live" : ""}" data-sch="${k}">
      <span class="schtop"><span class="tag${s.personale ? " ok" : ""}">${s.personale ? "Per te" : "Per tutti"}</span>${live ? '<span class="tag live">In corso</span>' : ""}</span>
      <b>${esc(s.titolo)}</b>
      ${[s.obiettivo, s.livello].filter(Boolean).length ? `<small>${esc([s.obiettivo, s.livello].filter(Boolean).join(" · "))}</small>` : ""}
      ${meta.length ? `<span class="schmeta">${meta.map((t) => `<span>${esc(t)}</span>`).join("")}</span>` : ""}
      ${s.descrizione ? `<p>${esc(s.descrizione)}</p>` : ""}
      ${ult ? `<small class="schlast">Ultimo allenamento: ${esc(fDataBreve.format(new Date(ult.data + "T12:00:00Z")))}${g.length > 1 && g[ult.giorno] ? ` · ${esc(g[ult.giorno].nome)}` : ""}</small>` : ""}
      <span class="schgo">${esc(prossimo)}<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span></button>`;
  }).join("") || '<div class="empty"><b>Ancora nessuna scheda</b>Quando la palestra pubblica una scheda di allenamento per te o per tutti la trovi qui.</div>';
}
$("schedeList").addEventListener("click", (e) => { const b = e.target.closest("[data-sch]"); if (b) apriSchedaApp(schede[Number(b.dataset.sch)]); });

// ------------------------------------------------------------------ schede: lettura e modalità allenamento (con carichi)
let wo = null, timer = null, recFine = 0, recTot = 0, wakeLock = null;
const fmtRec = (s) => (!s ? "" : s >= 60 ? `${Math.floor(s / 60)}'${s % 60 ? String(s % 60).padStart(2, "0") + '"' : ""}` : `${s}"`);
const fmtKg = (v) => (v == null || v === "" ? "" : String(Number(v)).replace(".", ","));
const numero = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
const conCarico = (x) => !x.tipo || x.tipo === "forza";
const oggiK = () => dayKey(new Date());
const fDataBreve = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "short" });
const giorni = () => wo.s.struttura?.giorni || [];
const esercizi = () => giorni()[wo.g]?.esercizi || [];

function apriSchedaApp(s) {
  fermaTimer();
  const ripresa = leggiWo();
  const riprendi = ripresa && ripresa.id === s.id;
  wo = { s, g: riprendi ? Math.min(ripresa.g, Math.max(0, (s.struttura?.giorni || []).length - 1)) : giornoSuggerito(s), attivo: !!riprendi, inizio: riprendi ? ripresa.inizio : 0, reg: regCache, bozza: {}, mano: new Set(), aperto: null };
  if (wo.attivo) { wo.aperto = primoDaFare(); schermoAcceso(true); }
  sheet.classList.add("tall");
  disegnaScheda();
  if (!sheet.open) sheet.showModal();
  sheet.querySelector(".sh").scrollTop = 0;
  // spiegazioni degli esercizi: arrivano dopo, senza bloccare l'apertura
  const ids = [...new Set((s.struttura?.giorni || []).flatMap((g) => (g.esercizi || []).map((x) => x.id)).filter((id) => id && !cues.has(id)))];
  if (ids.length) sb.from("esercizi").select("id,descrizione,attrezzo").in("id", ids).then(({ data }) => { (data || []).forEach((x) => cues.set(x.id, x)); if (wo?.s === s) riempiCues(); });
}
// Pulizia alla chiusura del pannello. Il browser segnala la chiusura ("close") con un attimo di ritardo:
// se nel frattempo il pannello è stato riaperto, la segnalazione tardiva non deve azzerare quello nuovo.
function pulisciPannello() {
  if (sheet.open) return;
  const t = $("toast"); if (t.parentNode !== document.body) document.body.appendChild(t);   // il messaggio torna sulla pagina
  if (!wo) return;
  sheet.classList.remove("tall"); fermaTimer(); schermoAcceso(false); wo = null;
  if (pagina === "pSchede" && schede.length) disegnaElenco();
}
sheet.addEventListener("close", pulisciPannello);   // chiusura con il tasto Indietro / Esc
sheet.addEventListener("cancel", () => setTimeout(pulisciPannello, 0));   // Indietro / Esc: segnale immediato, pulizia appena chiuso
const chiudiPannello = sheet.close.bind(sheet);
sheet.close = (...a) => { chiudiPannello(...a); pulisciPannello(); };   // chiusura dai pulsanti: pulizia subito

// serie già fatte oggi per l'esercizio i del giorno corrente
const fatteOggi = (i) => wo.reg.filter((r) => r.scheda_id === wo.s.id && r.giorno === wo.g && r.esercizio_idx === i && r.data === oggiK());
const completo = (i) => fatteOggi(i).length >= (Number(esercizi()[i]?.serie) || 1);
// ultima sessione precedente dello stesso esercizio (anche da altre schede)
function ultimaVolta(x) {
  const prima = wo.reg.filter((r) => r.data < oggiK() && (x.id ? r.esercizio_id === x.id : r.esercizio === x.nome));
  if (!prima.length) return null;
  const d = prima[0].data;   // già ordinate per data decrescente
  return { data: d, serie: prima.filter((r) => r.data === d).sort((a, b) => a.serie - b.serie) };
}
function suggerimento(x, uv) {
  if (!uv || !conCarico(x)) return "";
  const obiettivo = Math.max(...String(x.rip || "").split(/[^0-9]+/).map(Number).filter(Boolean), 0);
  const kg = Math.max(...uv.serie.map((r) => Number(r.kg) || 0));
  if (!obiettivo || !kg || uv.serie.length < (Number(x.serie) || 1)) return "";
  return uv.serie.every((r) => (r.rip || 0) >= obiettivo) ? `L'ultima volta hai completato tutte le ripetizioni: prova ${fmtKg(kg + (kg >= 40 ? 2.5 : 1))} kg.` : "";
}
function etichette(L) {
  // 1, 2, 3A, 3B, 4: gli esercizi in superserie hanno lo stesso numero e una lettera
  let gr = 0, pos = 0;
  return L.map((x, k) => { if (k === 0 || !L[k - 1].ss) { gr++; pos = 1; } else pos++; return x.ss || (k > 0 && L[k - 1].ss) ? `${gr}${"ABCDEFGHIJ"[(pos - 1) % 10]}` : String(gr); });
}
// esercizi in superserie: si mostrano aperti insieme
function gruppo(i) {
  const L = esercizi(); if (i == null || !L[i]) return [];
  let a = i, b = i;
  while (a > 0 && L[a - 1].ss) a--;
  while (b < L.length - 1 && L[b].ss) b++;
  return Array.from({ length: b - a + 1 }, (_, k) => a + k);
}
function primoDaFare() { const L = esercizi(); const i = L.findIndex((x, k) => !completo(k)); return i < 0 ? null : i; }

function disegnaScheda() {
  const s = wo.s, st = s.struttura, G = giorni();
  const testa = `<div class="whead"><span class="k" style="color:var(--red-hi)">${s.personale ? "Scheda per te" : "Scheda"}</span><h2>${esc(s.titolo)}</h2>
    ${wo.attivo ? "" : `<div class="kv">${[s.obiettivo, s.livello, st?.frequenza ? `${st.frequenza}× a settimana` : "", st?.settimane ? `${st.settimane} settimane` : ""].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join("")}</div>`}</div>`;
  if (!G.length) {   // vecchia scheda di solo testo
    $("shBody").innerHTML = testa + `${s.descrizione ? `<p class="sdesc">${esc(s.descrizione)}</p>` : ""}<div class="schtxt">${esc(s.contenuto || "")}</div><div class="wfoot"><div class="btns"><button class="btn ghost" id="shNo">Chiudi</button></div></div>`;
    $("shNo").onclick = () => sheet.close(); return;
  }
  const g = G[wo.g], L = g.esercizi || [], et = etichette(L);
  const ultimoGiorno = (i) => { const r = wo.reg.find((r) => r.scheda_id === s.id && r.giorno === i); return r ? (r.data === oggiK() ? "oggi" : fDataBreve.format(new Date(r.data + "T12:00:00Z"))) : ""; };
  $("shBody").innerHTML = testa
    + (s.descrizione && !wo.attivo ? `<p class="sdesc">${esc(s.descrizione)}</p>` : "")
    + (G.length > 1 ? `<div class="wdays" role="tablist">${G.map((d, i) => { const u = ultimoGiorno(i); return `<button type="button" role="tab" data-wg="${i}" aria-selected="${i === wo.g}"><b>${esc(d.nome)}</b><small>${u ? (u === "oggi" ? "fatto oggi" : `ultimo ${esc(u)}`) : `${(d.esercizi || []).length} ${(d.esercizi || []).length === 1 ? "esercizio" : "esercizi"}`}</small></button>`; }).join("")}</div>` : "")
    + '<div id="wProg"></div>'
    + (g.note ? `<p class="wnote">${esc(g.note)}</p>` : "")
    + `<div class="wl" id="wList">${L.map((x, i) => cardEsercizio(x, i, et[i])).join("")}</div>`
    + (st.note && !wo.attivo ? `<p class="wnote">${esc(st.note)}</p>` : "")
    + `<div class="wfoot">
        <div class="wtimer" id="wTimer"${recInCorso() ? "" : " hidden"}><i id="wBar"></i><button type="button" data-rec="-15" aria-label="Togli 15 secondi">−15</button><span class="wtt"><small id="recLbl"></small><b id="wTxt"></b></span><button type="button" id="wPausa" class="wpa" aria-label="Metti in pausa il recupero" data-ico="pausa">${ICO_PAUSA}</button><button type="button" data-rec="15" aria-label="Aggiungi 15 secondi">+15</button><button type="button" id="wSkip">Salta</button></div>
        <div class="btns two">${wo.attivo ? `<button class="btn ghost" id="shNo">Chiudi</button><button class="btn" id="woFine">Termina</button>` : `<button class="btn ghost" id="shNo">Chiudi</button><button class="btn" id="woVia">▶ ${L.some((x, i) => fatteOggi(i).length) ? "Continua" : "Inizia"}</button>`}</div>
      </div>`;
  aggiornaProgresso(); riempiCues();
  $("shNo").onclick = () => sheet.close();
  if (recInCorso()) tickRec();   // il recupero (anche in pausa) sopravvive al ridisegno
  $("woVia")?.addEventListener("click", iniziaAllenamento);
  $("woFine")?.addEventListener("click", terminaAllenamento);
  $("wSkip").onclick = fermaTimer;
}
function aggiornaProgresso() {
  const L = esercizi(), box = $("wProg"); if (!box) return;
  const tot = L.reduce((t, x) => t + (Number(x.serie) || 1), 0), fatte = L.reduce((t, x, i) => t + Math.min(fatteOggi(i).length, Number(x.serie) || 1), 0);
  const nEs = L.filter((x, i) => completo(i)).length;
  box.innerHTML = wo.attivo || fatte ? `<div class="wprog"><span>${nEs}/${L.length} esercizi · ${fatte}/${tot} serie</span><i><b style="width:${Math.round((100 * fatte) / Math.max(1, tot))}%"></b></i></div>` : "";
}
function riempiCues() {
  document.querySelectorAll("#wList [data-cue]").forEach((d) => {
    const c = cues.get(Number(d.dataset.cue)) || cues.get(d.dataset.cue);
    if (c?.descrizione && d.hidden) { d.querySelector("p").textContent = c.descrizione; d.hidden = false; }
    const a = d.closest(".wx")?.querySelector(".watt");
    if (a && c?.attrezzo && !a.textContent) a.textContent = ` · ${c.attrezzo}`;
  });
}

function cardEsercizio(x, i, etichetta) {
  const n = Number(x.serie) || 1, oggi = fatteOggi(i), fatto = oggi.length >= n;
  const aperto = !wo.attivo || gruppo(wo.aperto).includes(i);
  const param = [`${n} × ${esc(x.rip || "")}`, x.carico ? esc(x.carico) : "", x.rec ? `rec ${fmtRec(x.rec)}` : ""].filter(Boolean).join(" · ");
  const stato = wo.attivo ? `<span class="wst${fatto ? " ok" : oggi.length ? " part" : ""}">${fatto ? "✓" : `${oggi.length}/${n}`}</span>` : "";
  const testa = `<span class="wn">${etichetta}</span><span class="wt"><b>${esc(x.nome)}</b><small>${esc(x.gruppo || "")}<span class="watt"></span></small><span class="wp">${param}</span></span>${stato}`;
  if (wo.attivo && !aperto) {
    return `<article class="wx chiuso${fatto ? " ok" : ""}${x.ss ? " ss" : ""}" data-i="${i}"><button type="button" class="wh" data-apri="${i}" aria-expanded="false">${testa}</button></article>`;
  }
  const uv = ultimaVolta(x), sug = suggerimento(x, uv);
  const ultima = uv && conCarico(x) ? `<p class="wlast">Ultima volta (${esc(fDataBreve.format(new Date(uv.data + "T12:00:00Z")))}): ${uv.serie.map((r) => `${r.kg != null ? fmtKg(r.kg) + " kg" : "—"}${r.rip != null ? ` × ${r.rip}` : ""}`).join(" · ")}</p>` : "";
  let serie = "";
  if (wo.attivo && conCarico(x)) {
    const pianificati = numero(x.carico), obiettivo = (String(x.rip || "").match(/\d+/g) || []).map(Number).pop() ?? "";
    const prossima = Array.from({ length: n }, (_, j) => j).find((j) => !oggi.some((r) => r.serie === j + 1));
    serie = `<div class="srows"><div class="shd"><span></span><span>kg</span><span>rip</span><span></span></div>${Array.from({ length: n }, (_, j) => {
      const fatta = oggi.find((r) => r.serie === j + 1), b = wo.bozza[`${i}:${j}`] || {}, prec = uv?.serie[Math.min(j, uv.serie.length - 1)];
      const kg = fatta ? fmtKg(fatta.kg) : b.kg ?? fmtKg(prec?.kg ?? pianificati ?? ""), rip = fatta ? fatta.rip ?? "" : b.rip ?? (prec?.rip ?? obiettivo);
      return `<div class="srow${fatta ? " fatta" : ""}${j === prossima ? " ora" : ""}"><span class="sn">${j + 1}</span>
        <span class="stp"><button type="button" data-st="kg:${i}:${j}:-1" aria-label="Meno chili" ${fatta ? "disabled" : ""}>−</button><input inputmode="decimal" data-kg="${i}:${j}" value="${esc(kg)}" placeholder="–" aria-label="Chili serie ${j + 1}" ${fatta ? "disabled" : ""}><button type="button" data-st="kg:${i}:${j}:1" aria-label="Più chili" ${fatta ? "disabled" : ""}>+</button></span>
        <input class="rip" inputmode="numeric" data-rp="${i}:${j}" value="${esc(rip)}" placeholder="–" aria-label="Ripetizioni serie ${j + 1}" ${fatta ? "disabled" : ""}>
        <button type="button" class="sok" data-ok="${i}:${j}" aria-pressed="${!!fatta}" aria-label="${fatta ? "Annulla serie" : "Serie fatta"} ${j + 1}">✓</button></div>`;
    }).join("")}</div>`;
  } else if (wo.attivo) {
    serie = `<div class="sets">${Array.from({ length: n }, (_, j) => { const f = oggi.some((r) => r.serie === j + 1); return `<button type="button" data-set="${i}:${j}" aria-pressed="${f}" aria-label="Serie ${j + 1}">${f ? "✓" : j + 1}</button>`; }).join("")}</div>`;
  }
  const c = cues.get(x.id);
  return `<article class="wx${wo.attivo ? " aperto" : ""}${x.ss ? " ss" : ""}${fatto ? " ok" : ""}" data-i="${i}">
    ${wo.attivo ? `<button type="button" class="wh" data-apri="${i}" aria-expanded="true">${testa}</button>` : `<div class="wh">${testa}</div>`}
    <div class="wb">${x.ss ? '<p class="wss">In superserie con il successivo: niente recupero in mezzo</p>' : ""}
      ${x.note ? `<p class="wnn">${esc(x.note)}</p>` : ""}${ultima}${sug && wo.attivo ? `<p class="wsug">${esc(sug)}</p>` : ""}
      ${x.id ? `<details data-cue="${x.id}"${c?.descrizione ? "" : " hidden"}><summary>Come si esegue</summary><p>${esc(c?.descrizione || "")}</p></details>` : ""}${serie}
    </div></article>`;
}
// ridisegna solo le schede degli esercizi toccati (niente salti della pagina)
function aggiornaCards(idx) {
  const L = esercizi(), et = etichette(L);
  [...new Set(idx)].forEach((i) => { const el = document.querySelector(`#wList [data-i="${i}"]`); if (el && L[i]) el.outerHTML = cardEsercizio(L[i], i, et[i]); });
  aggiornaProgresso(); riempiCues();
}
function apriEs(i, scorri) {
  const prima = gruppo(wo.aperto);
  wo.aperto = i;
  aggiornaCards([...prima, ...gruppo(i)]);
  if (scorri && i != null) requestAnimationFrame(() => document.querySelector(`#wList [data-i="${gruppo(i)[0]}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

function iniziaAllenamento() {
  wo.attivo = true; wo.inizio = wo.inizio || Date.now(); wo.aperto = primoDaFare() ?? 0;
  salvaWo({ id: wo.s.id, g: wo.g, inizio: wo.inizio, data: oggiK() });
  schermoAcceso(true);
  disegnaScheda();
  requestAnimationFrame(() => document.querySelector(`#wList [data-i="${gruppo(wo.aperto)[0]}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
}
function terminaAllenamento() {
  const L = esercizi(), g = giorni()[wo.g];
  const n = L.reduce((t, x, i) => t + fatteOggi(i).length, 0);
  const vol = L.reduce((t, x, i) => t + fatteOggi(i).reduce((a, r) => a + (Number(r.kg) || 0) * (r.rip || 0), 0), 0);
  const min = wo.inizio ? Math.max(1, Math.round((Date.now() - wo.inizio) / 60000)) : 0;
  salvaWo(null); fermaTimer(); schermoAcceso(false);
  wo.attivo = false; wo.inizio = 0;
  if (!n) { disegnaScheda(); return toast("Allenamento chiuso."); }
  $("shBody").innerHTML = `<div class="done wdone"><div class="ic">${ICO_OK}</div><h3>Ottimo lavoro!</h3><p>${esc(g?.nome || "Allenamento")} completato</p>
    <div class="wsum"><div><b>${n}</b><small>serie</small></div>${vol ? `<div><b>${Math.round(vol).toLocaleString("it-IT")}</b><small>kg sollevati</small></div>` : ""}${min && min < 300 ? `<div><b>${min}'</b><small>durata</small></div>` : ""}</div></div>
    <div class="btns"><button class="btn" id="shNo">Chiudi</button><button class="btn ghost" id="woRivedi">Rivedi la scheda</button></div>`;
  $("shNo").onclick = () => sheet.close();
  $("woRivedi").onclick = () => disegnaScheda();
}

// valori scritti ma non ancora confermati: non si perdono quando la scheda si ridisegna
document.addEventListener("input", (e) => {
  if (!wo) return;
  const k = e.target.dataset.kg || e.target.dataset.rp; if (!k) return;
  const campo = e.target.dataset.kg ? "kg" : "rip", attr = campo === "kg" ? "data-kg" : "data-rp";
  wo.bozza[k] = wo.bozza[k] || {}; wo.bozza[k][campo] = e.target.value; wo.mano.add(campo + k);
  // il valore cambiato passa anche alle serie successive non ancora fatte (se non toccate a mano)
  const [i, j] = k.split(":").map(Number), n = Number(esercizi()[i]?.serie) || 1;
  for (let j2 = j + 1; j2 < n; j2++) {
    const kk = `${i}:${j2}`, el = document.querySelector(`[${attr}="${kk}"]`);
    if (wo.mano.has(campo + kk) || !el || el.disabled) continue;
    el.value = e.target.value; (wo.bozza[kk] ??= {})[campo] = e.target.value;
  }
});
// tocco su un campo: seleziona il numero per riscriverlo subito
document.addEventListener("focusin", (e) => { if (wo && (e.target.dataset?.kg || e.target.dataset?.rp)) setTimeout(() => e.target.select?.(), 0); });

// registro locale delle serie di oggi (lo stesso usato dall'elenco): toglie o rimette una serie
function aggiornaReg(sid, g, i, j, riga) {
  const resto = regCache.filter((r) => !(r.scheda_id === sid && r.giorno === g && r.esercizio_idx === i && r.serie === j + 1 && r.data === oggiK()));
  regCache = riga ? [riga, ...resto] : resto;
  if (wo && wo.s.id === sid) wo.reg = regCache;
}
// salvataggi in fila, uno alla volta: con un doppio tocco "salva" e "togli" arrivano al database nell'ordine giusto
let codaSalva = Promise.resolve();
function inCoda(fn) { const p = codaSalva.then(fn, fn); codaSalva = p.catch(() => {}); return p; }

function segnaSerie(i, j, el) {
  const L = esercizi(), x = L[i], g0 = wo.g, s0 = wo.s;
  const vecchia = fatteOggi(i).find((r) => r.serie === j + 1) || null, gia = !!vecchia;
  let kg = null, rip = null;
  if (el.dataset.ok && !gia) {
    kg = numero(document.querySelector(`[data-kg="${i}:${j}"]`)?.value);
    rip = numero(document.querySelector(`[data-rp="${i}:${j}"]`)?.value);
    if (kg != null && (kg < 0 || kg > 1000)) return toast("Controlla i chili: valore non valido.", false);
    if (rip != null) { rip = Math.round(rip); if (rip < 0 || rip > 500) return toast("Controlla le ripetizioni.", false); }
  }
  const nuova = gia ? null : { scheda_id: s0.id, giorno: g0, esercizio_idx: i, esercizio_id: x.id || null, esercizio: x.nome, data: oggiK(), serie: j + 1, kg, rip };
  const bozza = wo.bozza[`${i}:${j}`];
  // subito a video, poi il salvataggio: se fallisce si rimette com'era solo questa serie
  aggiornaReg(s0.id, g0, i, j, nuova); delete wo.bozza[`${i}:${j}`];
  try { navigator.vibrate?.(15); } catch {}
  let dopo = [i];
  if (!gia) {
    const gr = gruppo(i), finito = gr.every((k) => completo(k));
    if (finito) { const nx = primoDaFare(); dopo = [...dopo, ...gr]; if (nx != null) apriEs(nx, true); else wo.aperto = null; }
    // recupero: dopo un esercizio singolo o dopo l'ultimo della superserie, se resta qualcosa da fare
    const ultimo = gr[gr.length - 1], rec = Number(L[ultimo].rec) || 0;
    if (rec && i === ultimo && primoDaFare() != null) avviaTimer(rec);
    if (primoDaFare() == null) { fermaTimer(); toast("Tutti gli esercizi fatti: tocca «Termina» per il riepilogo."); }
  }
  aggiornaCards(dopo);
  const args = { p_scheda_id: s0.id, p_giorno: g0, p_idx: i, p_serie: j + 1 };
  inCoda(() => (nuova
    ? sb.rpc("salva_carico", { ...args, p_esercizio_id: nuova.esercizio_id, p_esercizio: nuova.esercizio, p_kg: kg, p_rip: rip })
    : sb.rpc("togli_carico", args))
  ).then(({ error }) => {
    if (!error) return;
    toast("Serie non salvata: " + error.message, false);
    aggiornaReg(s0.id, g0, i, j, vecchia);
    if (!wo || wo.s !== s0) return;
    if (bozza) wo.bozza[`${i}:${j}`] = bozza;
    if (wo.g !== g0) return;
    if (!gia) fermaTimer();
    if (wo.attivo && !gruppo(wo.aperto).includes(i)) apriEs(i, true); else aggiornaCards([i]);
  }, () => { toast("Serie non salvata: connessione assente.", false); aggiornaReg(s0.id, g0, i, j, vecchia); if (wo && wo.s === s0 && wo.g === g0) aggiornaCards([i]); });
}
document.addEventListener("click", (e) => {
  if (!wo) return;
  const t = e.target.closest("[data-wg]");
  if (t) {
    wo.g = Number(t.dataset.wg); wo.bozza = {}; wo.mano = new Set(); fermaTimer();
    if (wo.attivo) { wo.aperto = primoDaFare(); salvaWo({ id: wo.s.id, g: wo.g, inizio: wo.inizio, data: oggiK() }); }
    disegnaScheda(); return;
  }
  const ap = e.target.closest("[data-apri]");
  if (ap) { const i = Number(ap.dataset.apri); apriEs(gruppo(wo.aperto).includes(i) ? null : i, false); return; }
  const st = e.target.closest("[data-st]");
  if (st) {
    const [, i, j, d] = st.dataset.st.split(":"), inp = document.querySelector(`[data-kg="${i}:${j}"]`);
    const v = numero(inp.value) ?? 0, passo = v >= 20 ? 2.5 : 1;
    const nv = Math.max(0, Math.round((v + Number(d) * passo) * 10) / 10);
    inp.value = fmtKg(nv); inp.dispatchEvent(new Event("input", { bubbles: true })); return;
  }
  const rc = e.target.closest("[data-rec]");
  if (rc) { cambiaRec(Number(rc.dataset.rec)); return; }
  if (e.target.closest("#wPausa")) { pausaRec(); return; }
  const ok = e.target.closest("[data-ok],[data-set]");
  if (ok) { const [i, j] = (ok.dataset.ok || ok.dataset.set).split(":").map(Number); segnaSerie(i, j, ok); }
});

// recupero: barra fissa in basso con −15 / pausa / +15 / Salta.
// In corso: timer attivo e recFine = momento della fine. In pausa: timer fermo e recPausa = millisecondi rimasti.
let recPausa = 0, recNascondi = null;
const recInCorso = () => !!timer || recPausa > 0;
function avviaTimer(sec) {
  fermaTimer();
  recFine = Date.now() + sec * 1000; recTot = sec;
  timer = setInterval(tickRec, 250); tickRec();
}
function tickRec() {
  const box = $("wTimer");
  if (!box) { if (timer) clearInterval(timer); timer = null; recPausa = 0; return; }
  if (!recInCorso()) return;
  const ms = recPausa || recFine - Date.now(), r = Math.max(0, Math.ceil(ms / 1000));
  clearTimeout(recNascondi);
  box.hidden = false;
  box.classList.toggle("pausa", recPausa > 0); box.classList.toggle("fine", !r);
  $("recLbl").textContent = recPausa ? "In pausa" : r ? "Recupero" : "";
  $("wTxt").textContent = r ? `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}` : "Vai!";
  $("wBar").style.width = `${Math.max(0, Math.min(100, (100 * r) / Math.max(1, recTot)))}%`;
  const p = $("wPausa"); const ico = recPausa ? "play" : "pausa"; if (p.dataset.ico !== ico) { p.dataset.ico = ico; p.innerHTML = recPausa ? ICO_PLAY : ICO_PAUSA; } p.setAttribute("aria-label", recPausa ? "Riprendi il recupero" : "Metti in pausa il recupero");
  if (!r) {
    clearInterval(timer); timer = null;
    try { navigator.vibrate?.([200, 100, 200]); } catch {}
    recNascondi = setTimeout(() => { if (!recInCorso() && $("wTimer")) { $("wTimer").hidden = true; $("wTimer").classList.remove("fine"); } }, 2500);
  }
}
function pausaRec() {
  if (timer) { recPausa = Math.max(1000, recFine - Date.now()); clearInterval(timer); timer = null; }
  else if (recPausa) { recFine = Date.now() + recPausa; recPausa = 0; timer = setInterval(tickRec, 250); }
  tickRec();
}
function cambiaRec(sec) {
  if (!recInCorso()) return;
  recTot = Math.max(1, recTot + sec);
  if (recPausa) recPausa = Math.max(1000, recPausa + sec * 1000);
  else recFine += sec * 1000;
  tickRec();
}
function fermaTimer() {
  if (timer) clearInterval(timer); timer = null; recPausa = 0; clearTimeout(recNascondi);
  if ($("wTimer")) { $("wTimer").hidden = true; $("wTimer").classList.remove("fine", "pausa"); }
}

// schermo sempre acceso durante l'allenamento (dove il telefono lo consente)
async function schermoAcceso(on) {
  try {
    if (!on) { await wakeLock?.release(); wakeLock = null; return; }
    if (!wakeLock && navigator.wakeLock && document.visibilityState === "visible") { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); }
  } catch { wakeLock = null; }
}
document.addEventListener("visibilitychange", () => { if (wo?.attivo && document.visibilityState === "visible") schermoAcceso(true); });


// ------------------------------------------------------------------ bacheca
const LETTO = "whynot-bacheca-letto";
const ultimoLetto = () => { try { return Number(localStorage.getItem(LETTO)) || 0; } catch { return 0; } };
let avvisiApp = [];
async function badgeBacheca() {
  const { data } = await sb.rpc("bacheca");
  avvisiApp = data || [];
  const n = avvisiApp.filter((a) => a.id > ultimoLetto()).length;
  $("nBac").textContent = n || "";
  if (pagina === "pBacheca") disegnaBacheca();
}
async function caricaBacheca() { await badgeBacheca(); disegnaBacheca(); }
function disegnaBacheca() {
  const letto = ultimoLetto();
  $("bachecaList").innerHTML = avvisiApp.map((a) => `<article class="avv${a.id > letto ? " nuovo" : ""}"><small>${esc(fmt.date.format(new Date(a.created_at)))}${a.id > letto ? " · nuovo" : ""}</small><h3>${esc(a.titolo)}</h3><p>${esc(a.testo)}</p></article>`).join("")
    || '<div class="empty"><b>Nessun avviso</b>Qui trovi le comunicazioni della palestra degli ultimi 60 giorni.</div>';
  const max = Math.max(0, ...avvisiApp.map((a) => a.id));
  try { if (max) localStorage.setItem(LETTO, String(max)); } catch {}
  $("nBac").textContent = "";
}
