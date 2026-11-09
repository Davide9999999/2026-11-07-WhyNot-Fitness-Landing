// /admin : panoramica, calendario, prenotazioni, iscritti, schede + assistente AI.
// Tutte le letture/scritture passano da Supabase con la sessione dello staff: decide la RLS.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const cfg = window.WHYNOT_SUPABASE || {};
const $ = (id) => document.getElementById(id);
const TZ = "Europe/Rome";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const F = (o) => new Intl.DateTimeFormat("it-IT", { timeZone: TZ, ...o });
const fTime = F({ hour: "2-digit", minute: "2-digit" });
const fDay = F({ weekday: "short", day: "numeric", month: "short" });
const fWd = F({ weekday: "short" });
const fDn = F({ day: "numeric" });
const fFull = F({ weekday: "long", day: "numeric", month: "long" });
const fDate = F({ day: "numeric", month: "short", year: "numeric" });
const fDT = F({ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ymdRome = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const addDays = (ymd, n) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const lunediDi = (ymd) => { const d = new Date(ymd + "T12:00:00Z"); return addDays(ymd, -((d.getUTCDay() + 6) % 7)); };
const noon = (ymd) => new Date(ymd + "T12:00:00Z");
const cap1 = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
function romaToISO(data, ora) {
  const [y, m, d] = data.split("-").map(Number); const [hh, mm] = ora.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  return new Date(guess - (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - guess)).toISOString();
}
const CAT = [["posturale", "#a78bfa"], ["tonificazione", "#5b9bf0"], ["aerobico", "#86e06a"], ["funzionale", "#ffd95a"], ["h.e.a.t", "#ff944d"], ["heat", "#ff944d"], ["sala", "#e02233"]];
const catColor = (c) => (CAT.find(([n]) => String(c || "").toLowerCase().startsWith(n)) || [0, "#e02233"])[1];
const initials = (n) => String(n || "?").trim().split(/[\s@.]+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";
const fillCls = (p) => (p >= 100 ? "full" : p >= 75 ? "mid" : "");
function fa(d) {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "ora"; if (s < 3600) return `${Math.floor(s / 60)} min fa`;
  if (s < 86400) return `${Math.floor(s / 3600)} h fa`; if (s < 172800) return "ieri";
  return fDate.format(new Date(d));
}
function msg(el, text, ok) { el.textContent = text || ""; el.className = "msg" + (text ? (ok ? " ok" : " ko") : ""); }
let tt;
function toast(t, ok = true) { const el = $("toast"); el.textContent = t; el.className = "toast show " + (ok ? "ok" : "ko"); clearTimeout(tt); tt = setTimeout(() => (el.className = "toast"), 3200); }
function ask(titolo, testo, ok = "Conferma") {
  $("askT").textContent = titolo; $("askP").textContent = testo; $("askOk").textContent = ok;
  return new Promise((res) => { const d = $("dAsk"); d.returnValue = ""; d.showModal(); d.addEventListener("close", () => res(d.returnValue === "ok"), { once: true }); });
}

if (!cfg.url || !cfg.anonKey) {
  document.body.innerHTML = '<p style="padding:40px;font-family:Inter,sans-serif;color:#fff">Configurazione Supabase mancante: compila <code>assets/supabase-config.js</code>.</p>';
  throw new Error("config mancante");
}
// lock semplice: vedi assets/whynot-app.js (evita blocchi di getSession con navigator.locks)
const sb = createClient(cfg.url, cfg.anonKey, { auth: { lock: (_nome, _attesa, fn) => fn() } });
// Assistente AI in stand-by finché aiEnabled non è true in assets/supabase-config.js
if (!cfg.aiEnabled) document.body.classList.add("ai-off");

let session = null, corsi = [], lunedi = lunediDi(ymdRome(new Date())), lezioni = [], schFiltro = "", tab = "home", giornoMob = null;
let iscritti = null, lezAperta = null, mioRuolo = "staff";

// ------------------------------------------------------------------ auth
async function avvia() {
  const { data } = await sb.auth.getSession();
  session = data.session;
  if (!session) { $("vLogin").hidden = false; $("vApp").hidden = true; return; }
  const { data: st } = await sb.from("staff").select("ruolo,nome").eq("user_id", session.user.id).maybeSingle();
  if (!st) {
    // account non staff (es. un iscritto): non lo disconnettiamo dall'app, mostriamo solo l'avviso
    $("vLogin").hidden = false; $("vApp").hidden = true;
    msg($("loginMsg"), `L'account ${session.user.email} non è abilitato come staff. Accedi con un account staff.`);
    return;
  }
  $("vLogin").hidden = true; $("vApp").hidden = false;
  $("whoEmail").textContent = st.nome || session.user.email; $("whoRole").textContent = st.ruolo; mioRuolo = st.ruolo; document.body.classList.toggle("is-admin", st.ruolo === "admin"); $("whoEmail").title = session.user.email;
  $("meAv").textContent = initials(st.nome || session.user.email);
  const { data: c } = await sb.from("corsi").select("id,nome,categoria,sala,capienza_default,attivo").order("nome");
  corsi = c || [];
  $("newCorso").innerHTML = corsi.filter((x) => x.attivo).map((x) => `<option value="${x.id}">${esc(x.nome)}</option>`).join("");
  disegnaLegenda();
  vai((location.hash || "#home").slice(1));
  caricaIscritti(true);
}
sb.auth.onAuthStateChange((_e, s) => { session = s; });

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target; msg($("loginMsg"), "Accesso in corso...", true);
  const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
  if (error) return msg($("loginMsg"), "Credenziali non valide.");
  msg($("loginMsg"), ""); avvia();
});
const esci = async () => { await sb.auth.signOut(); location.hash = ""; location.reload(); };
$("logout").onclick = esci; $("logoutM").onclick = esci;

// ------------------------------------------------------------------ navigazione
const TITOLI = {
  home: ["Panoramica", () => cap1(fFull.format(new Date()))],
  cal: ["Calendario", () => "Lezioni, posti e prenotazioni della settimana"],
  iscritti: ["Iscritti", () => "Anagrafica, attivazione app e storico"],
  schede: ["Schede", () => "Schede di allenamento"],
  ai: ["Assistente", () => "Le modifiche vengono eseguite solo dopo la tua conferma"],
};
function vai(t) {
  if (!TITOLI[t] || (t === "ai" && !cfg.aiEnabled)) t = "home";
  tab = t; history.replaceState(null, "", "#" + t);
  document.querySelectorAll("[data-tab]").forEach((b) => (b.dataset.tab === t ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  Object.keys(TITOLI).forEach((k) => ($(`tab-${k}`).hidden = k !== t));
  document.querySelectorAll("[data-for]").forEach((el) => (el.hidden = !el.dataset.for.split(" ").includes(t)));
  $("pgTitle").textContent = TITOLI[t][0]; $("pgSub").textContent = TITOLI[t][1]();
  window.scrollTo(0, 0);
  if (t === "home") caricaHome(); else if (t === "cal") caricaSettimana(); else if (t === "iscritti") caricaIscritti(); else if (t === "schede") caricaSchede();
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab],[data-goto]"); if (b) vai(b.dataset.tab || b.dataset.goto);
  const a = e.target.closest("[data-act]");
  if (a?.dataset.act === "genera") genera(tab === "cal" ? lunedi : null);
  if (a?.dataset.act === "nuova") nuovaLezione();
  if (a?.dataset.act === "genera-w") genera(a.dataset.w);
  if (a?.dataset.act === "avviso") apriAvviso();
});
document.querySelectorAll("dialog [data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
document.addEventListener("click", (e) => { if (e.target.matches("dialog.drawer, dialog.sheet")) e.target.close(); });
const ricarica = () => (tab === "home" ? caricaHome() : tab === "cal" ? caricaSettimana() : tab === "iscritti" ? caricaIscritti() : null);

async function genera(lun) {
  const oggi = ymdRome(new Date());
  const w = lun || lunediDi(oggi);
  if (!(await ask("Genera dal palinsesto", `Creo le lezioni della settimana ${fDay.format(noon(w))} – ${fDay.format(noon(addDays(w, 6)))} usando il palinsesto. Quelle già presenti non vengono duplicate.`, "Genera"))) return;
  const { data, error } = await sb.rpc("genera_settimana", { p_lunedi: w });
  if (error) return toast("Errore: " + error.message, false);
  toast(data ? `Create ${data} lezioni.` : "Nessuna lezione nuova: la settimana era già completa.");
  ricarica();
}

// ------------------------------------------------------------------ panoramica
async function caricaHome() {
  const oggi = ymdRome(new Date()), lun = lunediDi(oggi), next = addDays(lun, 7);
  const [w, nw, feed] = await Promise.all([
    sb.rpc("admin_lezioni", { p_da: lun, p_a: addDays(lun, 6) }),
    sb.rpc("admin_lezioni", { p_da: next, p_a: addDays(next, 6) }),
    sb.from("prenotazioni").select("id,nome,stato,origine,created_at,member_id,lezione_id,lezioni(inizio,corsi(nome,categoria))").order("created_at", { ascending: false }).limit(8),
  ]);
  if (w.error) { $("kpis").innerHTML = `<p class="msg ko">${esc(w.error.message)}</p>`; return; }
  const sett = w.data || [], attive = sett.filter((l) => l.stato !== "annullata");
  const diOggi = sett.filter((l) => ymdRome(new Date(l.inizio)) === oggi);
  const oggiAttive = diOggi.filter((l) => l.stato !== "annullata");
  const now = Date.now();

  let alert = "";
  if (!sett.length) alert = avviso(`Questa settimana non ha ancora lezioni.`, lun);
  else if (!(nw.data || []).length) alert = avviso(`La settimana dal ${fDay.format(noon(next))} non ha ancora lezioni: generale entro sabato: le prenotazioni si aprono domenica alle 00:00.`, next);
  $("homeAlert").innerHTML = alert;

  const prossima = oggiAttive.find((l) => new Date(l.inizio).getTime() > now);
  const pren = oggiAttive.reduce((s, l) => s + l.confermate, 0), posti = oggiAttive.reduce((s, l) => s + l.capienza, 0);
  const att = attive.reduce((s, l) => s + l.attesa, 0);
  const conf = attive.reduce((s, l) => s + l.confermate, 0), capW = attive.reduce((s, l) => s + l.capienza, 0);
  const perc = capW ? Math.round((conf / capW) * 100) : 0;
  $("kpis").innerHTML = `
    <div class="kpi"><span>Lezioni oggi</span><b>${oggiAttive.length}</b><small>${prossima ? `prossima alle ${fTime.format(new Date(prossima.inizio))}` : oggiAttive.length ? "concluse per oggi" : "nessuna in programma"}${diOggi.length > oggiAttive.length ? ` · ${diOggi.length - oggiAttive.length} annullate` : ""}</small></div>
    <div class="kpi"><span>Prenotati oggi</span><b>${pren}</b><small>su ${posti} posti</small></div>
    <div class="kpi"><span>In lista d'attesa</span><b>${att}</b><small>questa settimana</small></div>
    <div class="kpi"><span>Riempimento settimana</span><b>${perc}%</b><small>${conf} prenotati su ${capW} posti</small><div class="meter"><i style="width:${perc}%"></i></div></div>`;

  $("today").innerHTML = diOggi.length ? diOggi.map((l) => rigaTl(l, now)).join("") : '<p class="empty">Nessuna lezione oggi.</p>';

  $("feed").innerHTML = (feed.data || []).map((p) => {
    const l = p.lezioni, d = l ? new Date(l.inizio) : null;
    return `<div class="fi"><span class="av sm2${p.member_id ? " member" : ""}">${esc(initials(p.nome))}</span><div><b>${esc(p.nome)}</b> <span class="mut">${p.stato === "attesa" ? "in attesa" : p.stato === "annullata" ? "ha annullato" : "prenotato"}</span>
      <small>${esc(l?.corsi?.nome || "")}${d ? ` · ${esc(fWd.format(d))} ${fTime.format(d)}` : ""} · ${esc(p.origine)}</small></div><span class="mut">${fa(p.created_at)}</span></div>`;
  }).join("") || '<p class="empty">Ancora nessuna prenotazione.</p>';

  const per = {};
  attive.forEach((l) => { const k = l.corso; per[k] ??= { n: 0, c: 0, cat: l.categoria }; per[k].n += l.confermate; per[k].c += l.capienza; });
  const top = Object.entries(per).filter(([, v]) => v.n > 0).sort((a, b) => b[1].n - a[1].n).slice(0, 5);
  $("rank").innerHTML = top.map(([k, v]) => `<div><span><b>${esc(k)}</b><em>${v.n} prenotati · ${Math.round((v.n / v.c) * 100)}%</em></span><div class="pb"><i style="width:${Math.round((v.n / v.c) * 100)}%;background:${catColor(v.cat)}"></i></div></div>`).join("")
    || '<p class="empty">Ancora nessuna prenotazione questa settimana.</p>';
  lezioniCache(sett);
}
function avviso(testo, w) {
  return `<div class="alert"><svg viewBox="0 0 24 24"><path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18v.5"/></svg><div>${esc(testo)}</div><button class="btn sm" data-act="genera-w" data-w="${w}">Genera ora</button></div>`;
}
function rigaTl(l, now) {
  const s = new Date(l.inizio).getTime(), e = new Date(l.fine).getTime();
  const p = Math.min(100, Math.round((l.confermate / l.capienza) * 100));
  const cls = l.stato === "annullata" ? " x done" : now >= s && now < e ? " now" : now >= e ? " done" : "";
  return `<button class="tli${cls}" data-lez="${l.id}" style="--c:${catColor(l.categoria)}"><span class="t">${fTime.format(new Date(s))}<small>${fTime.format(new Date(e))}</small></span><span class="s"></span>
    <span><b>${esc(l.corso)}</b><span class="sub">${esc(l.sala)}${l.istruttore ? ` · ${esc(l.istruttore)}` : ""}${l.stato === "annullata" ? " · annullata" : ""}${l.pubblicata ? "" : " · nascosta online"}</span></span>
    <span class="fill">${l.confermate}/${l.capienza}${l.attesa ? ` <span class="mut">+${l.attesa}</span>` : ""}<div class="pb"><i class="${fillCls(p)}" style="width:${p}%"></i></div></span></button>`;
}
const cache = new Map();
function lezioniCache(arr) { arr.forEach((l) => cache.set(l.id, l)); }
document.addEventListener("click", (e) => { const b = e.target.closest("[data-lez]"); if (b) apriLezione(Number(b.dataset.lez)); });

// ------------------------------------------------------------------ calendario
async function caricaSettimana() {
  const dom = addDays(lunedi, 6), oggi = ymdRome(new Date());
  $("weekLbl").textContent = `${fDay.format(noon(lunedi))} – ${fDay.format(noon(dom))}`;
  const { data, error } = await sb.rpc("admin_lezioni", { p_da: lunedi, p_a: dom });
  if (error) { $("cal").innerHTML = `<p class="msg ko">${esc(error.message)}</p>`; return; }
  lezioni = data || []; lezioniCache(lezioni);
  const giorni = [...Array(7)].map((_, k) => addDays(lunedi, k));
  if (!giornoMob || !giorni.includes(giornoMob)) giornoMob = giorni.includes(oggi) ? oggi : lunedi;
  $("mdays").innerHTML = giorni.map((g) => `<button data-g="${g}" aria-pressed="${g === giornoMob}">${esc(fWd.format(noon(g)).replace(".", ""))}<b>${fDn.format(noon(g))}</b></button>`).join("");
  $("cal").innerHTML = giorni.map((g) => {
    const lista = lezioni.filter((l) => ymdRome(new Date(l.inizio)) === g);
    const tot = lista.filter((l) => l.stato !== "annullata").reduce((s, l) => s + l.confermate, 0);
    return `<div class="col${g === oggi ? " today" : ""}${g === giornoMob ? " sel" : ""}"><h3><span>${esc(fWd.format(noon(g)).replace(".", ""))} <b>${fDn.format(noon(g))}</b></span><span title="Prenotati">${lista.length ? `${tot} pren.` : ""}</span></h3>${
      lista.map((l) => {
        const p = Math.min(100, Math.round((l.confermate / l.capienza) * 100));
        return `<button class="lz${l.stato === "annullata" ? " annullata" : ""}${l.pubblicata ? "" : " nascosta"}" data-lez="${l.id}" data-q="${esc((l.corso + " " + (l.istruttore || "")).toLowerCase())}" style="--c:${catColor(l.categoria)}">
          <small>${fTime.format(new Date(l.inizio))}–${fTime.format(new Date(l.fine))}${l.sala !== "Sala 1" ? ` · ${esc(l.sala)}` : ""}</small><b>${esc(l.corso)}</b>
          <div class="row3"><span>${l.confermate}/${l.capienza}</span><span>${l.attesa ? `<span class="tg w">+${l.attesa} attesa</span>` : ""}${l.stato === "annullata" ? '<span class="tg">annullata</span>' : !l.pubblicata ? '<span class="tg">nascosta</span>' : ""}</span></div>
          <div class="pb"><i class="${fillCls(p)}" style="width:${p}%"></i></div></button>`;
      }).join("") || '<p class="none">Nessuna lezione</p>'}</div>`;
  }).join("");
  filtraCal();
}
function filtraCal() {
  const q = $("calSearch").value.trim().toLowerCase();
  $("cal").querySelectorAll(".lz").forEach((b) => b.classList.toggle("dim", !!q && !b.dataset.q.includes(q)));
}
$("calSearch").addEventListener("input", filtraCal);
$("mdays").addEventListener("click", (e) => {
  const b = e.target.closest("[data-g]"); if (!b) return;
  giornoMob = b.dataset.g;
  $("mdays").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  [...$("cal").children].forEach((c, k) => c.classList.toggle("sel", addDays(lunedi, k) === giornoMob));
});
$("prevW").onclick = () => { lunedi = addDays(lunedi, -7); caricaSettimana(); };
$("nextW").onclick = () => { lunedi = addDays(lunedi, 7); caricaSettimana(); };
$("todayW").onclick = () => { lunedi = lunediDi(ymdRome(new Date())); giornoMob = null; caricaSettimana(); };
function disegnaLegenda() {
  const cats = [...new Set(corsi.map((c) => c.categoria))];
  $("legend").innerHTML = cats.map((c) => `<span><i style="background:${catColor(c)}"></i>${esc(c)}</span>`).join("") +
    '<span><i style="border:1px dashed #888"></i>bordo tratteggiato = nascosta online</span><span><i style="background:var(--warn)"></i>barra gialla/rossa = quasi piena / piena</span>';
}

// ------------------------------------------------------------------ dettaglio lezione (pannello laterale)
async function apriLezione(id) {
  lezAperta = id;
  const [{ data: l, error }, { data: pren }] = await Promise.all([
    sb.from("lezioni").select("id,inizio,fine,sala,capienza,istruttore,note,stato,pubblicata,corsi(nome,categoria,slug)").eq("id", id).single(),
    sb.from("prenotazioni").select("id,nome,telefono,email,stato,origine,note,created_at,member_id").eq("lezione_id", id).order("created_at"),
  ]);
  if (error || !l) return toast(error?.message || "Lezione non trovata", false);
  const P = pren || [], conf = P.filter((p) => p.stato === "confermata"), att = P.filter((p) => p.stato === "attesa"), ann = P.filter((p) => p.stato === "annullata");
  const perc = Math.min(100, Math.round((conf.length / l.capienza) * 100)), col = catColor(l.corsi.categoria);
  const persona = (p, k) => `<div class="pp">${p.stato === "attesa" ? `<span class="pos">${k + 1}°</span>` : ""}<span class="av sm2${p.member_id ? " member" : ""}">${esc(initials(p.nome))}</span>
    <div><b>${esc(p.nome)}</b>${p.member_id ? '<span class="tag">iscritto</span>' : ""}
      <small>${[p.telefono ? `<a href="tel:${esc(p.telefono)}">${esc(p.telefono)}</a>` : "", p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ""].filter(Boolean).join(" · ")}</small>
      <small>${esc(p.origine)} · ${fDT.format(new Date(p.created_at))}${p.note ? ` · «${esc(p.note)}»` : ""}</small></div>
    <div class="acts">${p.stato === "annullata" ? `<button class="ghost sm" data-pst="ripristina" data-pid="${p.id}">Ripristina</button>` : `<button class="ghost sm danger" data-pst="annullata" data-pid="${p.id}">Annulla</button>`}</div></div>`;
  $("lezBody").innerHTML = `
    <div class="dw-head" style="--c:${col}"><button class="close" data-x aria-label="Chiudi">&times;</button>
      <span class="k">${esc(l.corsi.categoria)}</span><h2>${esc(l.corsi.nome)}</h2>
      <div class="kv"><span>${esc(cap1(fFull.format(new Date(l.inizio))))}</span><span>${fTime.format(new Date(l.inizio))}–${fTime.format(new Date(l.fine))}</span><span>${esc(l.sala)}</span>${l.istruttore ? `<span>${esc(l.istruttore)}</span>` : ""}
        ${l.stato === "annullata" ? '<span class="x">Annullata</span>' : ""}${l.pubblicata ? "" : '<span class="w">Nascosta online</span>'}</div></div>
    <div class="dw-body">
      <div class="big"><div><b>${conf.length}<small> / ${l.capienza} posti</small></b><div class="pb"><i class="${fillCls(perc)}" style="width:${perc}%"></i></div></div>
        <span class="mut">${Math.max(l.capienza - conf.length, 0)} liberi${att.length ? `<br>${att.length} in attesa` : ""}</span></div>
      <div class="sec"><h3>Partecipanti (${conf.length}) ${conf.length ? '<button class="link" id="copyList">Copia elenco</button>' : ""}</h3>${conf.length ? `<div class="ppl">${conf.map(persona).join("")}</div>` : '<p class="empty">Nessun partecipante.</p>'}</div>
      ${att.length ? `<div class="sec"><h3>Lista d'attesa (${att.length})</h3><div class="ppl">${att.map(persona).join("")}</div></div>` : ""}
      ${ann.length ? `<details class="sec"><summary>Annullate (${ann.length})</summary><div class="ppl">${ann.map(persona).join("")}</div></details>` : ""}
      <div class="sec"><h3>Aggiungi partecipante</h3>
        <form id="addG" class="form2"><input class="full" name="nome" list="iscList" placeholder="Nome e cognome (scrivi per cercare tra gli iscritti)" required minlength="2" autocomplete="off">
          <input name="telefono" placeholder="Telefono"><input name="email" type="email" placeholder="Email"><input type="hidden" name="member_id">
          <button class="btn full" type="submit">Aggiungi${conf.length >= l.capienza ? " in lista d'attesa" : ""}</button></form>
        <datalist id="iscList">${(iscritti || []).map((i) => `<option value="${esc(i.nome)}">${esc(i.email || i.telefono || "")}</option>`).join("")}</datalist></div>
      <div class="sec box"><h3>Impostazioni lezione</h3>
        <div class="form2"><label>Capienza<input id="lzCap" type="number" min="1" value="${l.capienza}"></label><label>Istruttore<input id="lzIstr" value="${esc(l.istruttore || "")}"></label><label class="full">Note<input id="lzNote" value="${esc(l.note || "")}"></label></div>
        <div class="acts-row" style="margin-top:12px"><button class="btn sm" id="lzSave">Salva modifiche</button>
          <button class="ghost sm" id="lzPub">${l.pubblicata ? "Nascondi online" : "Pubblica online"}</button>
          <button class="ghost sm${l.stato === "annullata" ? "" : " danger"}" id="lzAnn">${l.stato === "annullata" ? "Ripristina lezione" : "Annulla lezione"}</button></div></div>
    </div>`;
  const dopo = async (t) => { if (t) toast(t); await apriLezione(id); ricarica(); };
  $("lezBody").querySelector("[data-x]").onclick = () => $("dLez").close();
  const upd = async (patch, t) => { const { error: e } = await sb.from("lezioni").update(patch).eq("id", id); if (e) return toast(e.message, false); dopo(t); };
  $("lzSave").onclick = () => upd({ capienza: Math.max(1, Number($("lzCap").value) || l.capienza), istruttore: $("lzIstr").value.trim() || null, note: $("lzNote").value.trim() || null }, "Lezione aggiornata.");
  $("lzPub").onclick = () => upd({ pubblicata: !l.pubblicata }, l.pubblicata ? "Lezione nascosta dalla pagina prenotazioni." : "Lezione visibile online.");
  $("lzAnn").onclick = async () => {
    if (l.stato === "annullata") return upd({ stato: "programmata" }, "Lezione ripristinata.");
    if (await ask("Annullare la lezione?", `${l.corsi.nome}, ${fFull.format(new Date(l.inizio))} alle ${fTime.format(new Date(l.inizio))}. ${conf.length + att.length ? `Ci sono ${conf.length + att.length} prenotati: chi ha attivato le notifiche dell'app riceverà un avviso, gli altri contattali tu.` : ""}`, "Annulla lezione"))
      upd({ stato: "annullata" }, "Lezione annullata.");
  };
  $("copyList")?.addEventListener("click", () => {
    const t = `${l.corsi.nome} – ${fFull.format(new Date(l.inizio))} ${fTime.format(new Date(l.inizio))}\n` + conf.map((p, k) => `${k + 1}. ${p.nome}${p.telefono ? " – " + p.telefono : ""}`).join("\n");
    navigator.clipboard.writeText(t).then(() => toast("Elenco copiato."), () => toast("Copia non riuscita.", false));
  });
  $("lezBody").querySelectorAll("[data-pid]").forEach((b) => (b.onclick = async () => {
    const p = P.find((x) => x.id === b.dataset.pid);
    let stato = b.dataset.pst;
    if (stato === "annullata" && !(await ask("Annullare la prenotazione?", `${p.nome}${p.stato === "confermata" && att.length ? ". Il primo in lista d'attesa passerà automaticamente tra i confermati." : ""}`, "Annulla prenotazione"))) return;
    if (stato === "ripristina") stato = conf.length < l.capienza ? "confermata" : "attesa";
    const { error: e } = await sb.from("prenotazioni").update({ stato }).eq("id", p.id);
    if (e) return toast(e.message, false);
    dopo(stato === "annullata" ? "Prenotazione annullata." : stato === "attesa" ? "Ripristinata in lista d'attesa (lezione piena)." : "Prenotazione ripristinata.");
  }));
  const fg = $("addG");
  fg.nome.addEventListener("input", () => {
    const m = (iscritti || []).filter((i) => i.nome === fg.nome.value);
    if (m.length === 1) { fg.telefono.value = m[0].telefono || ""; fg.email.value = m[0].email || ""; fg.member_id.value = m[0].user_id; }
    else fg.member_id.value = "";
  });
  fg.onsubmit = async (e) => {
    e.preventDefault();
    if (!fg.telefono.value.trim() && !fg.email.value.trim()) return toast("Serve telefono o email.", false);
    const { data, error: er } = await sb.from("prenotazioni").insert({ lezione_id: id, nome: fg.nome.value.trim(), telefono: fg.telefono.value.trim() || null,
      email: fg.email.value.trim() || null, origine: "admin", consenso_privacy: true, member_id: fg.member_id.value || null }).select("stato").single();
    if (er) return toast(er.message, false);
    dopo(data.stato === "attesa" ? "Aggiunto in lista d'attesa (lezione piena)." : "Partecipante aggiunto.");
  };
  if (!$("dLez").open) $("dLez").showModal();
}

// ------------------------------------------------------------------ nuova lezione
function nuovaLezione() {
  const f = $("newForm"); f.reset(); f.elements.data.value = tab === "cal" ? (giornoMob || lunedi) : ymdRome(new Date());
  msg($("newMsg"), ""); anteprima(); $("dNew").showModal();
}
function anteprima() {
  const f = $("newForm"), d = f.elements.data.value, n = Number(f.ripeti.value) || 1;
  if (!d) return ($("newPrev").textContent = "Orari in ora italiana.");
  const date = [...Array(n)].map((_, k) => fDay.format(noon(addDays(d, 7 * k))));
  $("newPrev").textContent = n === 1 ? `Verrà creata 1 lezione: ${date[0]}.` : `Verranno create ${n} lezioni, ogni settimana: ${date.slice(0, 4).join(", ")}${n > 4 ? ` … fino a ${date[n - 1]}` : ""}.`;
}
$("newForm").addEventListener("input", anteprima);
$("newForm").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = e.target;
  const corso = corsi.find((c) => c.id === Number(f.corso_id.value));
  if (f.ora_fine.value <= f.ora_inizio.value) return msg($("newMsg"), "L'orario di fine deve essere dopo l'inizio.");
  const n = Math.min(Math.max(Number(f.ripeti.value) || 1, 1), 26);
  const rows = [...Array(n)].map((_, k) => {
    const d = addDays(f.elements.data.value, 7 * k);
    return { corso_id: corso.id, inizio: romaToISO(d, f.ora_inizio.value), fine: romaToISO(d, f.ora_fine.value), sala: f.sala.value.trim() || corso.sala,
      capienza: Number(f.capienza.value) || corso.capienza_default, istruttore: f.istruttore.value.trim() || null, note: f.note.value.trim() || null };
  });
  const { error } = await sb.from("lezioni").insert(rows);
  if (error) return msg($("newMsg"), /lezioni_unica|duplicate/i.test(error.message) ? "Esiste già una lezione di questo corso alla stessa ora e nella stessa sala." : error.message);
  $("dNew").close(); toast(rows.length === 1 ? "Lezione creata." : `Create ${rows.length} lezioni.`); ricarica();
});

// ------------------------------------------------------------------ iscritti
// L'anagrafica la crea lo staff; l'iscritto attiva l'app con email + codice (il codice si vede solo quando viene generato).
const APP_URL = new URL("../app/", location.href).href;
const STATI = { attivo: ["App attiva", "ok"], "da attivare": ["Da attivare", "w"], "codice scaduto": ["Codice scaduto", "w"], sospeso: ["Sospeso", "x"] };
let iscFiltro = "";
async function caricaIscritti(silenzioso) {
  const { data, error } = await sb.rpc("admin_iscritti");
  if (error) {
    iscritti = [];
    if (!silenzioso) $("iscritti").innerHTML = `<p class="empty">Elenco iscritti non disponibile: esegui <code>supabase/2026-11-09-WhyNot-app-iscritti.sql</code> nel SQL Editor.<br><span class="mut">${esc(error.message)}</span></p>`;
    return;
  }
  iscritti = data || [];
  $("nIscritti").textContent = iscritti.length || "";
  if (!silenzioso) disegnaIscritti();
}
function disegnaIscritti() {
  const q = $("iscSearch").value.trim().toLowerCase();
  const conta = (s) => iscritti.filter((i) => i.stato === s).length;
  $("iscChips").innerHTML = [["", "Tutti", iscritti.length], ["attivo", "App attiva", conta("attivo")], ["da attivare", "Da attivare", conta("da attivare") + conta("codice scaduto")], ["sospeso", "Sospesi", conta("sospeso")]]
    .map(([k, t, n]) => `<button class="chip" data-f="${k}" aria-pressed="${iscFiltro === k}">${t} ${n}</button>`).join("");
  const lista = iscritti.filter((i) => (!iscFiltro || i.stato === iscFiltro || (iscFiltro === "da attivare" && i.stato === "codice scaduto"))
    && (!q || [i.nome, i.email, i.telefono].some((v) => String(v || "").toLowerCase().includes(q))));
  $("iscCount").textContent = `${lista.length} ${lista.length === 1 ? "iscritto" : "iscritti"}`;
  $("iscritti").innerHTML = lista.length ? `<div class="wrap-tbl"><table class="tbl"><thead><tr><th>Iscritto</th><th>Stato</th><th class="hm">Telefono</th><th class="hm">Dal</th><th class="num">Frequent.</th><th class="num hm">Prossime</th></tr></thead><tbody>${
    lista.map((i) => { const s = STATI[i.stato] || [i.stato, ""]; return `<tr data-iid="${i.id}"><td><div class="p"><span class="av sm2${i.user_id ? " member" : ""}">${esc(initials(i.nome))}</span><div><b>${esc(i.nome)}</b>${i.ruolo_staff ? ` <span class="pill">${i.ruolo_staff}</span>` : ""}<small>${esc(i.email)}</small></div></div></td>
      <td><span class="pill ${s[1]}">${s[0]}</span></td><td class="hm">${esc(i.telefono || "—")}</td><td class="hm">${fDate.format(new Date(i.iscritto_dal))}</td><td class="num">${i.frequentate}</td><td class="num hm">${i.prossime}</td></tr>`; }).join("")}</tbody></table></div>`
    : `<p class="empty">${q || iscFiltro ? "Nessun iscritto corrisponde alla ricerca." : "Ancora nessun iscritto. Crea il primo con «Nuovo iscritto»: riceverai il codice da dargli per attivare l'app."}</p>`;
}
$("iscSearch").addEventListener("input", disegnaIscritti);
$("iscChips").addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (!b) return; iscFiltro = b.dataset.f; disegnaIscritti(); });
$("iscritti").addEventListener("click", (e) => { const r = e.target.closest("[data-iid]"); if (r) apriIscritto(r.dataset.iid); });

function boxCodice(nome, email, tel, codice, scade) {
  const testo = `Ciao ${String(nome).split(" ")[0]}! Ecco il tuo codice per attivare l'app di WHY NOT Fitness Club: ${codice}\n\n1) Apri ${APP_URL}?attiva\n2) Inserisci la tua email (${email}) e il codice\n3) Scegli una password\n\nIl codice scade il ${fDate.format(new Date(scade))}.`;
  const t = String(tel || "").replace(/[^0-9]/g, "");
  return `<div class="codebox"><span class="mut">Codice di attivazione · scade il ${fDate.format(new Date(scade))}</span><b>${esc(codice)}</b>
    <p class="mut">Il codice si vede solo adesso: copialo o invialo subito. Se si perde, generane uno nuovo.</p>
    <div class="acts-row"><button class="btn sm" type="button" data-copy="${esc(testo)}">Copia messaggio</button>${t ? `<a class="ghost sm" target="_blank" rel="noopener" href="https://wa.me/${t.length <= 10 ? "39" + t : t}?text=${encodeURIComponent(testo)}">Invia su WhatsApp</a>` : ""}
      <a class="ghost sm" href="mailto:${esc(email)}?subject=${encodeURIComponent("Attiva l'app WHY NOT")}&body=${encodeURIComponent(testo)}">Invia per email</a></div></div>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-copy]"); if (!b) return;
  navigator.clipboard.writeText(b.dataset.copy).then(() => toast("Messaggio copiato."), () => toast("Copia non riuscita.", false));
});

async function apriIscritto(id, codice) {
  const i = iscritti.find((x) => x.id === id); if (!i) return;
  const now = Date.now();
  let P = [];
  if (i.user_id) {
    const { data } = await sb.from("prenotazioni").select("id,stato,origine,created_at,lezione_id,lezioni(inizio,fine,sala,stato,corsi(nome,categoria))").eq("member_id", i.user_id);
    P = (data || []).filter((p) => p.lezioni).sort((a, b) => new Date(b.lezioni.inizio) - new Date(a.lezioni.inizio));
  }
  const riga = (p) => { const d = new Date(p.lezioni.inizio);
    return `<button class="tli${p.stato === "annullata" ? " x done" : d.getTime() < now ? " done" : ""}" data-lez="${p.lezione_id}" style="--c:${catColor(p.lezioni.corsi.categoria)}"><span class="t">${esc(fDn.format(d))}<small>${esc(F({ month: "short" }).format(d))}</small></span><span class="s"></span>
      <span><b>${esc(p.lezioni.corsi.nome)}</b><span class="sub">${esc(fWd.format(d))} ${fTime.format(d)} · ${esc(p.lezioni.sala)}</span></span><span class="fill">${p.stato === "confermata" ? (d.getTime() < now ? "frequentata" : "confermata") : esc(p.stato)}</span></button>`; };
  const fut = P.filter((p) => new Date(p.lezioni.inizio).getTime() >= now && p.stato !== "annullata").reverse(), pas = P.filter((p) => !fut.includes(p));
  const tel = String(i.telefono || "").replace(/[^0-9]/g, ""), s = STATI[i.stato] || [i.stato, ""];
  $("lezBody").innerHTML = `
    <div class="dw-head"><button class="close" data-x aria-label="Chiudi">&times;</button><span class="k">Iscritto dal ${fDate.format(new Date(i.iscritto_dal))}</span><h2>${esc(i.nome)}</h2>
      <div class="kv"><span class="pill ${s[1]}">${s[0]}</span>${i.telefono ? `<span><a href="tel:${esc(i.telefono)}">${esc(i.telefono)}</a></span>` : ""}${tel ? `<span><a href="https://wa.me/${tel.length <= 10 ? "39" + tel : tel}" target="_blank" rel="noopener">WhatsApp</a></span>` : ""}<span><a href="mailto:${esc(i.email)}">${esc(i.email)}</a></span></div></div>
    <div class="dw-body">
      ${codice ? boxCodice(i.nome, i.email, i.telefono, codice.codice, codice.scade) : ""}
      ${!i.user_id && !codice ? `<div class="box"><h3 class="mut" style="font-size:12px;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:6px">Attivazione app</h3>
        <p class="mut" style="margin-bottom:10px">${i.stato === "codice scaduto" ? "Il codice è scaduto." : `Non ha ancora attivato l'app. Il codice scade il ${i.codice_scade ? fDate.format(new Date(i.codice_scade)) : "—"}.`} Se l'ha perso, generane uno nuovo (quello vecchio smette di funzionare).</p>
        <button class="btn sm" type="button" id="iscCod">Genera nuovo codice</button></div>` : ""}
      ${i.user_id ? `<div class="kpis" style="grid-template-columns:repeat(3,1fr);margin:0"><div class="kpi"><span>Frequentate</span><b>${i.frequentate}</b></div><div class="kpi"><span>Prossime</span><b>${i.prossime}</b></div><div class="kpi"><span>Totale</span><b>${i.prenotazioni}</b></div></div>
      <div class="sec"><h3>Prossime lezioni</h3>${fut.length ? `<div class="tl">${fut.map(riga).join("")}</div>` : '<p class="empty">Nessuna lezione in programma.</p>'}</div>
      <div class="sec"><h3>Storico</h3>${pas.length ? `<div class="tl">${pas.map(riga).join("")}</div>` : '<p class="empty">Nessuna lezione nello storico.</p>'}</div>` : ""}
      ${i.user_id ? `<div class="box"><h3 class="mut" style="font-size:12px;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:6px">Password dimenticata?</h3>
        <p class="mut" style="margin-bottom:10px">Reimposta l'accesso: l'account dell'app viene rimosso e generi un nuovo codice. Con il codice sceglie una nuova password; lo storico delle prenotazioni resta.</p>
        <button class="ghost sm" type="button" id="iscReset">Reimposta accesso</button></div>` : ""}
      ${mioRuolo === "admin" ? `<div class="box"><h3 class="mut" style="font-size:12px;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:6px">Collaboratore</h3>
        <p class="mut" style="margin-bottom:10px">${i.user_id ? "Dà accesso all'area staff (questa dashboard) con il suo account." : "Il ruolo diventa attivo quando attiva l'app."}</p>
        <div class="acts-row"><select id="iscRuolo" style="width:auto"><option value="">Nessuno (solo iscritto)</option><option value="staff" ${i.ruolo_staff === "staff" ? "selected" : ""}>Staff</option><option value="admin" ${i.ruolo_staff === "admin" ? "selected" : ""}>Admin</option></select><button class="ghost sm" type="button" id="iscRuoloOk">Applica</button></div></div>` : ""}
      <form class="sec box" id="iscEdit"><h3>Dati iscritto</h3>
        <div class="form2"><label class="full">Nome e cognome<input name="nome" value="${esc(i.nome)}" required minlength="2"></label><label>Telefono<input name="telefono" value="${esc(i.telefono || "")}"></label><label>Email<input value="${esc(i.email)}" readonly title="L'email è quella di accesso all'app"></label>
        <label class="full">Note interne<input name="note" value="${esc(i.note || "")}" placeholder="es. abbonamento annuale"></label>
        <label class="full chk"><input type="checkbox" name="attivo" ${i.attivo ? "checked" : ""}> Iscrizione attiva (può usare l'app e prenotare)</label></div>
        <div class="acts-row" style="margin-top:10px"><button class="btn sm" type="submit">Salva</button></div></form>
    </div>`;
  $("lezBody").querySelector("[data-x]").onclick = () => $("dLez").close();
  $("iscReset")?.addEventListener("click", async () => {
    if (!(await ask("Reimpostare l'accesso?", `L'account dell'app di ${i.nome} viene rimosso e generi un nuovo codice da consegnargli. Lo storico delle prenotazioni resta.`, "Reimposta"))) return;
    const { data, error } = await sb.rpc("admin_reimposta_accesso", { p_id: i.id });
    if (error) return toast(error.message, false);
    await caricaIscritti(); apriIscritto(i.id, data);
  });
  $("iscRuoloOk")?.addEventListener("click", async () => {
    const r = $("iscRuolo").value || null;
    const { error } = await sb.rpc("admin_imposta_staff", { p_id: i.id, p_ruolo: r });
    if (error) return toast(error.message, false);
    toast(r ? `Ruolo ${r} impostato.` : "Ruolo collaboratore rimosso."); await caricaIscritti(); apriIscritto(i.id);
  });
  $("iscCod")?.addEventListener("click", async () => {
    if (!(await ask("Nuovo codice di attivazione", `Il codice precedente di ${i.nome} smetterà di funzionare.`, "Genera"))) return;
    const { data, error } = await sb.rpc("admin_nuovo_codice", { p_id: i.id });
    if (error) return toast(error.message, false);
    await caricaIscritti(); apriIscritto(i.id, data);
  });
  $("iscEdit").onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    if (i.attivo && !f.attivo.checked && !(await ask("Sospendere l'iscritto?", `${i.nome} potrà ancora accedere all'app ma non potrà prenotare. Le prenotazioni già fatte restano: annullale dal calendario se serve.`, "Sospendi"))) return;
    const { error } = await sb.rpc("admin_modifica_iscritto", { p_id: i.id, p_nome: f.nome.value.trim(), p_telefono: f.telefono.value.trim() || null, p_attivo: f.attivo.checked, p_note: f.note.value.trim() || null });
    if (error) return toast(error.message, false);
    toast("Iscritto aggiornato."); await caricaIscritti(); apriIscritto(i.id);
  };
  if (!$("dLez").open) $("dLez").showModal();
}

$("newIsc").onclick = () => { const f = $("iscForm"); f.reset(); msg($("iscMsg"), ""); f.hidden = false; $("iscDone").innerHTML = ""; $("dIsc").showModal(); };
$("iscForm").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = e.target;
  if (f.nome.value.trim().length < 2) return msg($("iscMsg"), "Inserisci nome e cognome.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.value.trim())) return msg($("iscMsg"), "Serve un'email valida: sarà quella di accesso all'app.");
  const { data, error } = await sb.rpc("admin_crea_iscritto", { p_nome: f.nome.value.trim(), p_telefono: f.telefono.value.trim() || null, p_email: f.email.value.trim(), p_ruolo_staff: (f.ruolo && f.ruolo.value) || null });
  if (error) return msg($("iscMsg"), error.message);
  f.hidden = true;
  $("iscDone").innerHTML = `<p>Iscritto creato: <b>${esc(f.nome.value.trim())}</b>. Consegnagli il codice per attivare l'app.</p>` + boxCodice(f.nome.value.trim(), f.email.value.trim().toLowerCase(), f.telefono.value.trim(), data.codice, data.scade) +
    '<div class="acts end"><button class="btn" type="button" id="iscFine">Fatto</button></div>';
  $("iscFine").onclick = () => $("dIsc").close();
  caricaIscritti(tab !== "iscritti");
});

// ------------------------------------------------------------------ schede
async function caricaSchede() {
  let q = sb.from("schede").select("id,titolo,obiettivo,livello,stato,updated_at").order("updated_at", { ascending: false });
  if (schFiltro) q = q.eq("stato", schFiltro);
  const { data, error } = await q;
  if (error) { $("schede").innerHTML = `<p class="msg ko">${esc(error.message)}</p>`; return; }
  $("schede").innerHTML = (data || []).map((s) => `<button class="sc" data-id="${s.id}"><span class="st ${s.stato}">${s.stato}</span><h3>${esc(s.titolo)}</h3>
    <span class="mut">${esc([s.obiettivo, s.livello].filter(Boolean).join(" · ") || "—")}</span><span class="mut">Aggiornata ${fa(s.updated_at)}</span></button>`).join("")
    || `<p class="empty" style="grid-column:1/-1">Nessuna scheda${schFiltro ? " in questo stato" : ""}. Creane una con «Nuova scheda».</p>`;
}
$("schFilter").addEventListener("click", (e) => {
  const b = e.target.closest(".chip"); if (!b) return;
  schFiltro = b.dataset.f; $("schFilter").querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", x === b)); caricaSchede();
});
$("newScheda").onclick = () => apriScheda(null);
$("schede").addEventListener("click", (e) => { const b = e.target.closest(".sc"); if (b) apriScheda(b.dataset.id); });
async function apriScheda(id) {
  const f = $("schForm"); f.reset(); msg($("schMsg"), "");
  if (id) {
    const { data } = await sb.from("schede").select("*").eq("id", id).single();
    Object.entries(data || {}).forEach(([k, v]) => { if (f.elements[k]) f.elements[k].value = v ?? ""; });
    $("schTitle").textContent = "Modifica scheda"; $("schStato").textContent = `Stato attuale: ${data.stato}`;
  } else { f.elements.id.value = ""; $("schTitle").textContent = "Nuova scheda"; $("schStato").textContent = ""; }
  $("dSch").showModal();
}
$("schForm").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = e.target; const stato = e.submitter?.dataset.stato || "bozza";
  const row = { titolo: f.titolo.value.trim(), obiettivo: f.obiettivo.value.trim() || null, livello: f.livello.value || null,
    descrizione: f.descrizione.value.trim() || null, contenuto: f.contenuto.value, stato };
  if (stato === "pubblicata") row.pubblicata_il = new Date().toISOString();
  const res = f.elements.id.value ? await sb.from("schede").update(row).eq("id", f.elements.id.value).select("id").single() : await sb.from("schede").insert(row).select("id").single();
  if (res.error) return msg($("schMsg"), res.error.message);
  f.elements.id.value = res.data.id; $("schStato").textContent = `Stato attuale: ${stato}`;
  toast(stato === "pubblicata" ? "Scheda pubblicata." : stato === "archiviata" ? "Scheda archiviata." : "Bozza salvata."); caricaSchede();
});

// ------------------------------------------------------------------ assistente AI
let chat = [];
const log = $("aiLog");
const scroll = () => { log.scrollTop = log.scrollHeight; };
function bolla(cls, html) { const d = document.createElement("div"); d.className = "m " + cls; d.innerHTML = html; log.appendChild(d); scroll(); return d; }

async function api(path, body) {
  const { data } = await sb.auth.getSession();
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token || ""}` }, body: JSON.stringify(body) });
  const out = await r.json().catch(() => ({ error: `Errore ${r.status}` }));
  if (!r.ok) throw new Error(out.error || `Errore ${r.status}`);
  return out;
}

$("aiForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const testo = $("aiInput").value.trim(); if (!testo) return;
  $("aiInput").value = ""; bolla("user", esc(testo));
  chat.push({ role: "user", content: testo });
  const wait = bolla("sys typing", "L'assistente sta lavorando...");
  try {
    const out = await api("/api/chat", { messages: chat });
    wait.remove();
    bolla("bot", esc(out.reply));
    chat.push({ role: "assistant", content: out.reply });
    (out.proposte || []).forEach(proposta);
  } catch (err) { wait.remove(); bolla("sys", "Errore: " + esc(err.message)); chat.pop(); }
});
$("aiInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("aiForm").requestSubmit(); } });
$("aiReset").onclick = () => { chat = []; log.querySelectorAll(".m:not(:first-child), .prop").forEach((x) => x.remove()); };

function proposta(p) {
  const d = document.createElement("div"); d.className = "prop";
  d.innerHTML = `<b>Proposta da confermare</b><div>${esc(p.riepilogo)}</div>
    <details><summary class="mut">Dettagli</summary><pre style="white-space:pre-wrap;font-size:12px">${esc(JSON.stringify(p.input, null, 2))}</pre></details>
    <div class="acts"><button class="btn sm" data-ok>Conferma</button><button class="ghost sm" data-no>Annulla</button></div><div class="msg"></div>`;
  log.appendChild(d); scroll();
  const fine = (testo, ok) => { d.classList.add("done"); d.querySelector(".acts").remove(); msg(d.querySelector(".msg"), testo, ok); };
  d.querySelector("[data-no]").onclick = () => {
    fine("Annullata.", true);
    chat.push({ role: "user", content: `(Nota di sistema: l'admin ha ANNULLATO la proposta "${p.riepilogo}". Non è stata eseguita.)` });
  };
  d.querySelector("[data-ok]").onclick = async (ev) => {
    ev.target.disabled = true;
    try {
      const out = await api("/api/execute", { tool: p.tool, input: p.input });
      fine("Eseguita: " + JSON.stringify(out.esito), true);
      chat.push({ role: "user", content: `(Nota di sistema: l'admin ha CONFERMATO "${p.riepilogo}". Esito: ${JSON.stringify(out.esito)})` });
    } catch (err) {
      fine("Errore: " + err.message, false);
      chat.push({ role: "user", content: `(Nota di sistema: l'esecuzione di "${p.riepilogo}" è FALLITA: ${err.message})` });
    }
  };
}

avvia();

// ------------------------------------------------------------------ avvisi push agli iscritti
async function apriAvviso() {
  const f = $("avvForm"); f.reset(); msg($("avvMsg"), "");
  const { data } = await sb.rpc("admin_stato_notifiche");
  $("avvInfo").textContent = data
    ? `Notifica sul telefono agli iscritti attivi con le notifiche attive nell'app: oggi sono ${data.iscritti_con_notifiche}.`
    : "Notifica sul telefono agli iscritti attivi che hanno attivato le notifiche nell'app.";
  $("dAvv").showModal();
}
$("avvForm").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = e.target;
  if (f.titolo.value.trim().length < 3 || f.testo.value.trim().length < 3) return msg($("avvMsg"), "Scrivi titolo e testo.");
  if (!(await ask("Inviare l'avviso?", `«${f.titolo.value.trim()}» arriverà a tutti gli iscritti con le notifiche attive.`, "Invia"))) return;
  const { data, error } = await sb.rpc("admin_invia_avviso", { p_titolo: f.titolo.value.trim(), p_testo: f.testo.value.trim() });
  if (error) return msg($("avvMsg"), error.message);
  $("dAvv").close(); toast(data ? `Avviso in invio a ${data} ${data === 1 ? "iscritto" : "iscritti"}.` : "Nessun iscritto ha ancora attivato le notifiche.");
});
