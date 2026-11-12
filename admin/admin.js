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
  document.body.classList.toggle("is-istr", st.ruolo === "istruttore");
  if (st.ruolo === "istruttore") { vai("mie"); return; }
  caricaIstruttori();
  const { data: c } = await sb.from("corsi").select("id,nome,categoria,sala,capienza_default,prenotazione_obbligatoria,attivo").order("nome");
  corsi = c || [];
  opzioniCorsi();
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
  mie: ["Le mie lezioni", () => "Appello e partecipanti delle tue lezioni"],
  palinsesto: ["Corsi e orari", () => "Corsi, capienze, palinsesto settimanale e regole"],
  bacheca: ["Bacheca", () => "Avvisi visibili nell'app"],
  stat: ["Statistiche", () => "Riempimento, andamento e iscritti da richiamare"],
};
function vai(t) {
  if (!TITOLI[t] || (t === "ai" && !cfg.aiEnabled)) t = "home";
  if (mioRuolo === "istruttore") t = "mie"; else if (t === "mie") t = "home";
  tab = t; history.replaceState(null, "", "#" + t);
  document.querySelectorAll("[data-tab]").forEach((b) => (b.dataset.tab === t ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  Object.keys(TITOLI).forEach((k) => ($(`tab-${k}`).hidden = k !== t));
  document.querySelectorAll("[data-for]").forEach((el) => (el.hidden = !el.dataset.for.split(" ").includes(t)));
  $("pgTitle").textContent = TITOLI[t][0]; $("pgSub").textContent = TITOLI[t][1]();
  window.scrollTo(0, 0);
  if (t === "home") caricaHome(); else if (t === "cal") caricaSettimana(); else if (t === "iscritti") caricaIscritti(); else if (t === "schede") caricaSchede(); else if (t === "mie") caricaMie(); else if (t === "palinsesto") caricaPalinsesto(); else if (t === "bacheca") caricaBacheca(); else if (t === "stat") caricaStat();
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
  else if (!(nw.data || []).length) alert = avviso(`La settimana dal ${fDay.format(noon(next))} non ha ancora lezioni: generale entro venerdì, le prenotazioni si aprono sabato alle 9:00.`, next);
  const { data: schPub } = await sb.from("schede").select("id,titolo,pubblicata_il,struttura,stato").eq("stato", "pubblicata");
  const inScad = (schPub || []).map(scadenzaScheda).filter((x) => x && x.giorni >= 0 && x.giorni <= 7).length;
  const scadute = (schPub || []).map(scadenzaScheda).filter((x) => x && x.giorni < 0).length;
  if (inScad || scadute) alert += `<div class="alert"><svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 10h6M9 14h6"/></svg><div>${inScad ? `${inScad} ${inScad === 1 ? "scheda scade" : "schede scadono"} entro 7 giorni` : ""}${inScad && scadute ? " · " : ""}${scadute ? `${scadute} ${scadute === 1 ? "scheda è scaduta ma ancora pubblicata" : "schede sono scadute ma ancora pubblicate"}` : ""}: preparane una nuova o archiviale.</div><button class="btn sm" data-scad="${inScad ? "scadenza" : "scadute"}">Vedi</button></div>`;
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
// modalità del corso: su prenotazione (posti e lista d'attesa) o a partecipazione (conta chi viene, nessun limite)
const corsoDi = (l) => corsi.find((x) => (l.corso_id != null ? x.id === l.corso_id : x.nome === l.corso));
const suPrenL = (l) => corsoDi(l)?.prenotazione_obbligatoria !== false;
const fillHtml = (l, p) => suPrenL(l)
  ? `<span class="fill">${l.confermate}/${l.capienza}${l.attesa ? ` <span class="mut">+${l.attesa}</span>` : ""}<div class="pb"><i class="${fillCls(p)}" style="width:${p}%"></i></div></span>`
  : `<span class="fill" title="Corso a partecipazione">${l.confermate} <span class="mut">part.</span></span>`;
function rigaTl(l, now) {
  const s = new Date(l.inizio).getTime(), e = new Date(l.fine).getTime();
  const p = Math.min(100, Math.round((l.confermate / l.capienza) * 100));
  const cls = l.stato === "annullata" ? " x done" : now >= s && now < e ? " now" : now >= e ? " done" : "";
  return `<button class="tli${cls}" data-lez="${l.id}" style="--c:${catColor(l.categoria)}"><span class="t">${fTime.format(new Date(s))}<small>${fTime.format(new Date(e))}</small></span><span class="s"></span>
    <span><b>${esc(l.corso)}</b><span class="sub">${esc(l.sala)}${l.istruttore ? ` · ${esc(l.istruttore)}` : ""}${l.stato === "annullata" ? " · annullata" : ""}${l.pubblicata ? "" : " · nascosta online"}</span></span>
    ${fillHtml(l, p)}</button>`;
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
          <div class="row3"><span>${suPrenL(l) ? `${l.confermate}/${l.capienza}` : `${l.confermate} part.`}</span><span>${l.attesa ? `<span class="tg w">+${l.attesa} attesa</span>` : ""}${l.stato === "annullata" ? '<span class="tg">annullata</span>' : !l.pubblicata ? '<span class="tg">nascosta</span>' : ""}</span></div>
          ${suPrenL(l) ? `<div class="pb"><i class="${fillCls(p)}" style="width:${p}%"></i></div>` : ""}</button>`;
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
    sb.from("lezioni").select("id,inizio,fine,sala,capienza,istruttore,istruttore_id,note,stato,pubblicata,corsi(nome,categoria,slug,prenotazione_obbligatoria)").eq("id", id).single(),
    sb.from("prenotazioni").select("id,nome,telefono,email,stato,origine,note,created_at,member_id,presenza").eq("lezione_id", id).order("created_at"),
  ]);
  if (error || !l) return toast(error?.message || "Lezione non trovata", false);
  const P = pren || [], conf = P.filter((p) => p.stato === "confermata"), att = P.filter((p) => p.stato === "attesa"), ann = P.filter((p) => p.stato === "annullata");
  const perc = Math.min(100, Math.round((conf.length / l.capienza) * 100)), col = catColor(l.corsi.categoria);
  const suPr = l.corsi.prenotazione_obbligatoria !== false;   // a partecipazione: nessun limite di posti né lista d'attesa
  const appelloAperto = new Date(l.inizio).getTime() - 30 * 60000 <= Date.now() && l.stato !== "annullata";
  const persona = (p, k) => `<div class="pp">${p.stato === "attesa" ? `<span class="pos">${k + 1}°</span>` : ""}<span class="av sm2${p.member_id ? " member" : ""}">${esc(initials(p.nome))}</span>
    <div><b>${esc(p.nome)}</b>${p.member_id ? '<span class="tag">iscritto</span>' : ""}
      <small>${[p.telefono ? `<a href="tel:${esc(p.telefono)}">${esc(p.telefono)}</a>` : "", p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ""].filter(Boolean).join(" · ")}</small>
      <small>${esc(p.origine)} · ${fDT.format(new Date(p.created_at))}${p.note ? ` · «${esc(p.note)}»` : ""}</small></div>
    <div class="acts">${p.stato === "confermata" && appelloAperto ? `<button class="ghost sm${p.presenza === true ? " on" : ""}" data-pres="1" data-pid="${p.id}">Presente</button><button class="ghost sm${p.presenza === false ? " off" : ""}" data-pres="0" data-pid="${p.id}">Assente</button>` : ""}${p.stato === "annullata" ? `<button class="ghost sm" data-pst="ripristina" data-pid="${p.id}">Ripristina</button>` : `<button class="ghost sm danger" data-pst="annullata" data-pid="${p.id}">Annulla</button>`}</div></div>`;
  $("lezBody").innerHTML = `
    <div class="dw-head" style="--c:${col}"><button class="close" data-x aria-label="Chiudi">&times;</button>
      <span class="k">${esc(l.corsi.categoria)}</span><h2>${esc(l.corsi.nome)}</h2>
      <div class="kv"><span>${esc(cap1(fFull.format(new Date(l.inizio))))}</span><span>${fTime.format(new Date(l.inizio))}–${fTime.format(new Date(l.fine))}</span><span>${esc(l.sala)}</span>${l.istruttore ? `<span>${esc(l.istruttore)}</span>` : ""}
        ${l.stato === "annullata" ? '<span class="x">Annullata</span>' : ""}${l.pubblicata ? "" : '<span class="w">Nascosta online</span>'}</div></div>
    <div class="dw-body">
      ${suPr ? `<div class="big"><div><b>${conf.length}<small> / ${l.capienza} posti</small></b><div class="pb"><i class="${fillCls(perc)}" style="width:${perc}%"></i></div></div>
        <span class="mut">${Math.max(l.capienza - conf.length, 0)} liberi${att.length ? `<br>${att.length} in attesa` : ""}</span></div>`
        : `<div class="big"><div><b>${conf.length}<small> ${conf.length === 1 ? "partecipante" : "partecipanti"}</small></b></div><span class="mut">corso a partecipazione<br>nessun limite di posti</span></div>`}
      <div class="sec"><h3>Partecipanti (${conf.length}) ${conf.length ? '<button class="link" id="copyList">Copia elenco</button>' : ""}</h3>${conf.length ? `<div class="ppl">${conf.map(persona).join("")}</div>` : '<p class="empty">Nessun partecipante.</p>'}</div>
      ${att.length ? `<div class="sec"><h3>Lista d'attesa (${att.length})</h3><div class="ppl">${att.map(persona).join("")}</div></div>` : ""}
      ${ann.length ? `<details class="sec"><summary>Annullate (${ann.length})</summary><div class="ppl">${ann.map(persona).join("")}</div></details>` : ""}
      <div class="sec"><h3>Aggiungi partecipante</h3>
        <form id="addG" class="form2"><input class="full" name="nome" list="iscList" placeholder="Nome e cognome (scrivi per cercare tra gli iscritti)" required minlength="2" autocomplete="off">
          <input name="telefono" placeholder="Telefono"><input name="email" type="email" placeholder="Email"><input type="hidden" name="member_id">
          <button class="btn full" type="submit">Aggiungi${suPr && conf.length >= l.capienza ? " in lista d'attesa" : ""}</button></form>
        <datalist id="iscList">${(iscritti || []).map((i) => `<option value="${esc(i.nome)}">${esc(i.email || i.telefono || "")}</option>`).join("")}</datalist></div>
      <div class="sec box"><h3>Impostazioni lezione</h3>
        <div class="form2"><label>Capienza<input id="lzCap" type="number" min="1" value="${l.capienza}"></label><label>Istruttore<select id="lzIstr">${opzioniIstr(l.istruttore_id, l.istruttore)}</select></label><label class="full">Note<input id="lzNote" value="${esc(l.note || "")}"></label></div>
        <div class="acts-row" style="margin-top:12px"><button class="btn sm" id="lzSave">Salva modifiche</button>
          <button class="ghost sm" id="lzPub">${l.pubblicata ? "Nascondi online" : "Pubblica online"}</button>
          <button class="ghost sm${l.stato === "annullata" ? "" : " danger"}" id="lzAnn">${l.stato === "annullata" ? "Ripristina lezione" : "Annulla lezione"}</button></div></div>
    </div>`;
  const dopo = async (t) => { if (t) toast(t); await apriLezione(id); ricarica(); };
  $("lezBody").querySelector("[data-x]").onclick = () => $("dLez").close();
  const upd = async (patch, t) => { const { error: e } = await sb.from("lezioni").update(patch).eq("id", id); if (e) return toast(e.message, false); dopo(t); };
  $("lzSave").onclick = () => upd({ capienza: Math.max(1, Number($("lzCap").value) || l.capienza), ...istrDa($("lzIstr").value, l), note: $("lzNote").value.trim() || null }, "Lezione aggiornata.");
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
  $("lezBody").querySelectorAll("[data-pres]").forEach((b) => (b.onclick = async (ev) => {
    ev.stopPropagation();
    const p = P.find((x) => x.id === b.dataset.pid), v = b.dataset.pres === "1";
    const { error: e } = await sb.rpc("segna_presenza", { p_prenotazione_id: p.id, p_presente: p.presenza === v ? null : v });
    if (e) return toast(e.message, false);
    dopo(p.presenza === v ? "Presenza tolta." : v ? "Segnato presente." : "Segnato assente.");
  }));
  $("lezBody").querySelectorAll("[data-pid]:not([data-pres])").forEach((b) => (b.onclick = async () => {
    const p = P.find((x) => x.id === b.dataset.pid);
    let stato = b.dataset.pst;
    if (stato === "annullata" && !(await ask("Annullare la prenotazione?", `${p.nome}${p.stato === "confermata" && att.length ? ". Il primo in lista d'attesa passerà automaticamente tra i confermati." : ""}`, "Annulla prenotazione"))) return;
    if (stato === "ripristina") stato = !suPr || conf.length < l.capienza ? "confermata" : "attesa";
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
      capienza: Number(f.capienza.value) || corso.capienza_default, ...istrDa(f.istruttore_id.value), note: f.note.value.trim() || null };
  });
  const { error } = await sb.from("lezioni").insert(rows);
  if (error) return msg($("newMsg"), /lezioni_unica|duplicate/i.test(error.message) ? "Esiste già una lezione di questo corso alla stessa ora e nella stessa sala." : error.message);
  $("dNew").close(); toast(rows.length === 1 ? "Lezione creata." : `Create ${rows.length} lezioni.`); ricarica();
});

// ------------------------------------------------------------------ iscritti
// L'anagrafica la crea lo staff; l'iscritto attiva l'app con email + codice (il codice si vede solo quando viene generato).
const APP_URL = "https://whynotfitnessclub.com/app/"; // indirizzo ufficiale, anche se l'admin è aperto da un altro indirizzo
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
  // carichi registrati dall'iscritto in modalità allenamento (ultimi 90 giorni)
  let carichiHtml = "";
  if (i.user_id) {
    const { data: C } = await sb.rpc("admin_carichi", { p_user: i.user_id, p_giorni: 90 });
    const gruppi = [];
    (C || []).forEach((r) => { const k = r.data + "|" + r.esercizio; let g = gruppi.find((x) => x.k === k); if (!g) gruppi.push((g = { k, data: r.data, esercizio: r.esercizio, serie: [] })); g.serie.push(r); });
    const fK = (v) => (v == null ? "—" : String(Number(v)).replace(".", ","));
    carichiHtml = `<div class="sec"><h3>Carichi registrati (90 giorni)</h3>${gruppi.length ? `<div class="wrap-tbl"><table class="tbl"><thead><tr><th>Data</th><th>Esercizio</th><th>Serie (kg × rip)</th></tr></thead><tbody>${
      gruppi.slice(0, 60).map((g) => `<tr><td>${esc(fDate.format(noon(g.data)))}</td><td>${esc(g.esercizio)}</td><td>${g.serie.sort((a, b) => a.serie - b.serie).map((r) => `${fK(r.kg)}${r.rip != null ? ` × ${r.rip}` : ""}`).join(" · ")}</td></tr>`).join("")}</tbody></table></div>`
      : "<p class=\"empty\">Nessun carico registrato: l'iscritto li segna dall'app in modalità allenamento.</p>"}</div>`;
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
      ${i.user_id ? `<div class="kpis" style="grid-template-columns:repeat(4,1fr);margin:0"><div class="kpi"><span>Frequentate</span><b>${i.frequentate}</b></div><div class="kpi"><span>Assenze</span><b>${i.assenze ?? 0}</b></div><div class="kpi"><span>Prossime</span><b>${i.prossime}</b></div><div class="kpi"><span>Totale</span><b>${i.prenotazioni}</b></div></div>
      <div class="sec"><h3>Prossime lezioni</h3>${fut.length ? `<div class="tl">${fut.map(riga).join("")}</div>` : '<p class="empty">Nessuna lezione in programma.</p>'}</div>
      <div class="sec"><h3>Storico</h3>${pas.length ? `<div class="tl">${pas.map(riga).join("")}</div>` : '<p class="empty">Nessuna lezione nello storico.</p>'}</div>` : ""}
      ${i.user_id ? `<div class="box"><h3 class="mut" style="font-size:12px;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:6px">Password dimenticata?</h3>
        <p class="mut" style="margin-bottom:10px">Reimposta l'accesso: l'account dell'app viene rimosso e generi un nuovo codice. Con il codice sceglie una nuova password; lo storico delle prenotazioni resta.</p>
        <button class="ghost sm" type="button" id="iscReset">Reimposta accesso</button></div>` : ""}
      ${mioRuolo === "admin" ? `<div class="box"><h3 class="mut" style="font-size:12px;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:6px">Collaboratore</h3>
        <p class="mut" style="margin-bottom:10px">${i.user_id ? "Dà accesso all'area staff (questa dashboard) con il suo account." : "Il ruolo diventa attivo quando attiva l'app."}</p>
        <div class="acts-row"><select id="iscRuolo" style="width:auto"><option value="">Nessuno (solo iscritto)</option><option value="staff" ${i.ruolo_staff === "staff" ? "selected" : ""}>Staff</option><option value="admin" ${i.ruolo_staff === "admin" ? "selected" : ""}>Admin</option><option value="istruttore" ${i.ruolo_staff === "istruttore" ? "selected" : ""}>Istruttore</option></select><button class="ghost sm" type="button" id="iscRuoloOk">Applica</button></div></div>` : ""}
      ${carichiHtml}
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

// ------------------------------------------------------------------ schede: elenco
async function caricaSchede() {
  let q = sb.from("schede").select("id,titolo,obiettivo,livello,stato,updated_at,pubblicata_il,member_id,destinatari,struttura,contenuto").order("updated_at", { ascending: false });
  const filtroScad = schFiltro === "scadenza" || schFiltro === "scadute";
  if (filtroScad) q = q.eq("stato", "pubblicata"); else if (schFiltro) q = q.eq("stato", schFiltro);
  const [{ data, error }] = await Promise.all([q, iscritti ? null : caricaIscritti(true)]);
  if (error) { $("schede").innerHTML = `<p class="msg ko">${esc(error.message)}</p>`; return; }
  const nomeDi = (uid) => (iscritti || []).find((i) => i.user_id === uid)?.email || "un iscritto";
  let lista = data || [];
  if (filtroScad) lista = lista.map((s) => ({ s, sc: scadenzaScheda(s) })).filter((x) => x.sc && (schFiltro === "scadute" ? x.sc.giorni < 0 : x.sc.giorni >= 0 && x.sc.giorni <= 7)).sort((a, b) => a.sc.giorni - b.sc.giorni).map((x) => x.s);
  $("schede").innerHTML = lista.map((s) => {
    const g = s.struttura?.giorni || [], nEs = g.reduce((t, d) => t + (d.esercizi || []).length, 0);
    return `<button class="sc" data-id="${s.id}"><span class="st ${s.stato}">${s.stato}</span><h3>${esc(s.titolo)}</h3>
      <span class="mut">${esc([s.obiettivo, s.livello].filter(Boolean).join(" · ") || "—")}</span>
      <span class="mut">${g.length ? `${g.length} ${g.length === 1 ? "giorno" : "giorni"} · ${nEs} esercizi` : s.contenuto ? "scheda di solo testo" : "vuota"} · ${destTesto(s)}</span>
      ${etichettaScad(s)}
      <span class="mut">Aggiornata ${fa(s.updated_at)}</span></button>`;
  }).join("") || `<p class="empty" style="grid-column:1/-1">${schFiltro === "scadenza" ? "Nessuna scheda scade nei prossimi 7 giorni" : schFiltro === "scadute" ? "Nessuna scheda scaduta" : `Nessuna scheda${schFiltro ? " in questo stato" : ""}`}. Creane una con «Nuova scheda»: puoi partire da un modello.</p>`;
}
$("schFilter").addEventListener("click", (e) => {
  const b = e.target.closest(".chip"); if (!b) return;
  schFiltro = b.dataset.f; $("schFilter").querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", x === b)); caricaSchede();
});
$("newScheda").onclick = () => apriScheda(null);
$("schede").addEventListener("click", (e) => { const b = e.target.closest(".sc"); if (b) apriScheda(b.dataset.id); });

// ------------------------------------------------------------------ schede: editor con libreria esercizi
const GRUPPI = ["Petto", "Dorso", "Spalle", "Bicipiti", "Tricipiti", "Quadricipiti", "Femorali", "Glutei", "Polpacci", "Addome", "Cardio", "Total body", "Mobilità"];
const RECUPERI = [0, 15, 30, 45, 60, 75, 90, 120, 150, 180, 240];
let catalogo = [], ed = null, gSel = 0, libGruppo = "";
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
async function caricaCatalogo(forza) {
  if (catalogo.length && !forza) return;
  const { data, error } = await sb.from("esercizi").select("id,nome,gruppo,attrezzo,tipo,livello,descrizione,attivo").order("nome");
  if (error) return toast("Catalogo esercizi non disponibile: " + error.message, false);
  catalogo = (data || []).filter((x) => x.attivo);
  const attr = [...new Set(catalogo.map((x) => x.attrezzo))].sort();
  $("libAttr").innerHTML = '<option value="">Tutti gli attrezzi</option>' + attr.map((a) => `<option>${esc(a)}</option>`).join("");
  $("attrList").innerHTML = attr.map((a) => `<option>${esc(a)}</option>`).join("");
  $("nuGruppo").innerHTML = GRUPPI.map((g) => `<option>${g}</option>`).join("");
}
// parametri di partenza: dipendono dal tipo di esercizio e dall'obiettivo della scheda
function parametri(tipo) {
  const ob = norm($("schForm").obiettivo.value);
  if (tipo === "cardio") return { serie: 1, rip: "10 min", rec: 0 };
  if (tipo === "mobilita") return { serie: 2, rip: "30 s", rec: 15 };
  if (tipo === "isometrico") return { serie: 3, rip: "30 s", rec: 45 };
  if (ob.includes("forza")) return { serie: 4, rip: "5-6", rec: 150 };
  if (ob.includes("ipertrofia")) return { serie: 4, rip: "8-10", rec: 90 };
  if (ob.includes("resistenza")) return { serie: 3, rip: "15-20", rec: 45 };
  if (ob.includes("dimagr") || ob.includes("tonific")) return { serie: 3, rip: "12-15", rec: 60 };
  return { serie: 3, rip: "10-12", rec: 75 };
}
const daCatalogo = (e) => ({ id: e.id, nome: e.nome, gruppo: e.gruppo, tipo: e.tipo, ...parametri(e.tipo), carico: "", note: "", ss: false });

// ---- modelli pronti
const MODELLI = [
  { nome: "Full body principiante", ob: "Tonificazione", liv: "principiante", sett: 6, freq: 3, giorni: [
    ["Giorno A", ["Leg press", "Chest press alla macchina", "Lat machine avanti", "Shoulder press alla macchina", "Leg curl sdraiato", "Plank frontale", "Cyclette"]],
    ["Giorno B", ["Goblet squat", "Panca piana con manubri", "Pulley basso", "Ponte glutei", "Alzate laterali con manubri", "Dead bug", "Tapis roulant"]]] },
  { nome: "Upper / Lower", ob: "Ipertrofia", liv: "intermedio", sett: 8, freq: 4, giorni: [
    ["Upper", ["Panca piana con bilanciere", "Rematore con bilanciere", "Lento con manubri da seduto", "Lat machine avanti", "Curl con manubri alternato", "Push-down ai cavi"]],
    ["Lower", ["Squat con bilanciere", "Stacco rumeno con bilanciere", "Leg press", "Leg curl sdraiato", "Calf raise in piedi", "Plank frontale"]]] },
  { nome: "Push / Pull / Legs", ob: "Ipertrofia", liv: "intermedio", sett: 8, freq: 3, giorni: [
    ["Push", ["Panca piana con bilanciere", "Panca inclinata con manubri", "Lento con manubri da seduto", "Alzate laterali con manubri", "Push-down ai cavi", "French press con bilanciere EZ"]],
    ["Pull", ["Trazioni assistite", "Rematore con manubrio a un braccio", "Pulley basso", "Face pull ai cavi", "Curl con bilanciere", "Curl a martello"]],
    ["Legs", ["Squat con bilanciere", "Stacco rumeno con bilanciere", "Affondi in camminata", "Leg extension", "Leg curl da seduto", "Calf raise da seduto"]]] },
  { nome: "Circuito funzionale", ob: "Dimagrimento", liv: "intermedio", sett: 6, freq: 3, circuito: true, giorni: [
    ["Circuito (3 giri)", ["Kettlebell swing", "Goblet squat", "Piegamenti sulle braccia", "Rematore inverso", "Affondi indietro", "Mountain climber", "Plank frontale", "Burpee"]]] },
  { nome: "Mobilità e postura", ob: "Mobilità e postura", liv: "principiante", sett: 4, freq: 3, giorni: [
    ["Sessione", ["Gatto-mucca", "Rotazioni toraciche", "Mobilità anche 90/90", "Il miglior stretching del mondo", "Bird dog", "Dead bug", "Ponte glutei", "Stretching flessori dell'anca", "Posizione del bambino"]]] },
];
$("edModelli").insertAdjacentHTML("beforeend", MODELLI.map((m, k) => `<button type="button" class="chip" data-mod="${k}">${esc(m.nome)}</button>`).join(""));
$("edModelli").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-mod]"); if (!b) return;
  const m = MODELLI[Number(b.dataset.mod)], pieno = ed.giorni.some((g) => g.esercizi.length);
  if (pieno && !(await ask("Sostituire il contenuto?", `Il modello «${m.nome}» sostituisce i giorni e gli esercizi attuali.`, "Sostituisci"))) return;
  const f = $("schForm");
  if (!f.obiettivo.value) f.obiettivo.value = m.ob;
  if (!f.livello.value) f.livello.value = m.liv;
  f.settimane.value = m.sett; f.frequenza.value = m.freq;
  if (!f.titolo.value.trim()) f.titolo.value = m.nome;
  const mancanti = [];
  ed.giorni = m.giorni.map(([nome, lista]) => ({ nome, note: "", esercizi: lista.map((n) => {
    const e2 = catalogo.find((x) => x.nome === n); if (!e2) { mancanti.push(n); return null; }
    const r = daCatalogo(e2);
    if (m.circuito) { r.serie = 3; r.rec = 15; r.ss = true; if (e2.tipo === "forza") r.rip = "12"; if (e2.tipo === "cardio") r.rip = "30 s"; }
    return r;
  }).filter(Boolean) }));
  if (m.circuito) { const l = ed.giorni[0].esercizi; if (l.length) { l[l.length - 1].ss = false; l[l.length - 1].rec = 90; } ed.giorni[0].note = "Esegui gli esercizi uno dopo l'altro; recupera solo a fine giro."; }
  gSel = 0; disegnaEditor();
  toast(mancanti.length ? `Modello applicato; non trovati nel catalogo: ${mancanti.join(", ")}` : "Modello applicato: adatta serie e carichi alla persona.", !mancanti.length);
});

// ---- apertura e salvataggio
async function apriScheda(id) {
  await Promise.all([caricaCatalogo(), iscritti ? null : caricaIscritti(true)]);
  const f = $("schForm"); f.reset(); msg($("schMsg"), "");
  $("schDestList").innerHTML = (iscritti || []).filter((i) => i.user_id && i.attivo).map((i) => `<option value="${esc(i.email)}">${esc(i.nome)}</option>`).join("");
  ed = { giorni: [{ nome: "Giorno A", note: "", esercizi: [] }] };
  destSel = []; $("schDest").value = "";
  f.elements.id.value = ""; $("schStato").textContent = "nuova"; $("schStato").className = "st";
  if (id) {
    const { data, error } = await sb.from("schede").select("*").eq("id", id).single();
    if (error) return toast(error.message, false);
    ["titolo", "obiettivo", "livello", "descrizione"].forEach((k) => (f.elements[k].value = data[k] ?? ""));
    destSel = data.destinatari?.length ? [...data.destinatari] : data.member_id ? [data.member_id] : [];
    f.elements.id.value = data.id; $("schStato").textContent = data.stato; $("schStato").className = "st " + data.stato;
    const s = data.struttura;
    if (s?.giorni?.length) ed = { giorni: s.giorni.map((g) => ({ nome: g.nome || "Giorno", note: g.note || "", esercizi: (g.esercizi || []).map((x) => ({ ...x })) })) };
    else if (data.contenuto) ed.giorni[0].note = data.contenuto;   // vecchia scheda di solo testo: il testo finisce nelle note
    f.settimane.value = s?.settimane || ""; f.frequenza.value = s?.frequenza || ""; f.note.value = s?.note || "";
    f.inizio.value = s?.inizio || (data.pubblicata_il ? ymdRome(new Date(data.pubblicata_il)) : ""); ed.pubblicata_il = data.pubblicata_il;
  }
  gSel = 0; libGruppo = ""; $("libQ").value = ""; $("libAttr").value = "";
  aggiornaScad();
  disegnaDest();
  disegnaEditor(); disegnaLibreria();
  $("dSch").showModal();
  if (!id) f.titolo.focus();
}
const lettere = "ABCDEFGHIJ";
function testoScheda() {
  return ed.giorni.map((g) => [g.nome + (g.note ? ` — ${g.note}` : ""), ...g.esercizi.map((x, k) =>
    `- ${x.nome}: ${x.serie} x ${x.rip}${x.carico ? ` · ${x.carico}` : ""}${x.rec ? ` · rec ${x.rec}s` : ""}${x.ss ? " · superserie con il successivo" : ""}${x.note ? ` (${x.note})` : ""}`)].join("\n")).join("\n\n");
}
$("schForm").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = e.target; const stato = e.submitter?.dataset.stato || "bozza";
  if (f.titolo.value.trim().length < 2) { f.titolo.focus(); return msg($("schMsg"), "Scrivi il titolo della scheda."); }
  if ($("schDest").value.trim() && !aggiungiDest()) return;   // email scritta ma non ancora aggiunta
  const vuoti = ed.giorni.filter((g) => !g.esercizi.length).length;
  if (stato === "pubblicata" && vuoti === ed.giorni.length && !ed.giorni.some((g) => g.note)) return msg($("schMsg"), "Aggiungi almeno un esercizio prima di pubblicare.");
  if (stato === "pubblicata" && !f.inizio.value) f.inizio.value = ymdRome(new Date());
  const struttura = { settimane: Number(f.settimane.value) || null, inizio: f.inizio.value || null, frequenza: Number(f.frequenza.value) || null, note: f.note.value.trim() || null,
    giorni: ed.giorni.map((g) => ({ nome: g.nome.trim() || "Giorno", note: g.note.trim() || null, esercizi: g.esercizi.map(({ id, nome, gruppo, tipo, serie, rip, carico, rec, note, ss }) =>
      ({ id, nome, gruppo, tipo, serie: Number(serie) || 1, rip: String(rip || "").trim(), carico: String(carico || "").trim() || null, rec: Number(rec) || 0, note: String(note || "").trim() || null, ss: !!ss })) })) };
  const row = { titolo: f.titolo.value.trim(), obiettivo: f.obiettivo.value.trim() || null, livello: f.livello.value || null, descrizione: f.descrizione.value.trim() || null,
    member_id: null, destinatari: destSel.length ? destSel : null, stato, struttura, contenuto: testoScheda() };
  if (stato === "pubblicata" && !ed.pubblicata_il) row.pubblicata_il = ed.pubblicata_il = new Date().toISOString();   // la prima pubblicazione resta
  const res = f.elements.id.value ? await sb.from("schede").update(row).eq("id", f.elements.id.value).select("id").single() : await sb.from("schede").insert(row).select("id").single();
  if (res.error) return msg($("schMsg"), res.error.message);
  f.elements.id.value = res.data.id; $("schStato").textContent = stato; $("schStato").className = "st " + stato; msg($("schMsg"), "");
  toast(stato === "pubblicata" ? `Scheda pubblicata: la vedono ${destSel.length ? `${destSel.length} ${destSel.length === 1 ? "iscritto" : "iscritti"}` : "tutti gli iscritti"} nell'app.` : stato === "archiviata" ? "Scheda archiviata." : "Bozza salvata.");
  caricaSchede();
});

// ---- disegno dell'editor
function disegnaEditor() {
  if (gSel >= ed.giorni.length) gSel = ed.giorni.length - 1;
  $("edDays").innerHTML = ed.giorni.map((g, k) => `<button type="button" role="tab" data-g="${k}" aria-selected="${k === gSel}">${esc(g.nome || "Giorno")} <small>${g.esercizi.length}</small></button>`).join("")
    + '<button type="button" class="add" data-g="+" title="Aggiungi giorno">+ Giorno</button>';
  const g = ed.giorni[gSel];
  $("edDayNome").value = g.nome; $("edDayNote").value = g.note || "";
  $("edDayDel").disabled = ed.giorni.length < 2;
  disegnaEsercizi(); riepilogo();
}
function disegnaEsercizi() {
  const L = ed.giorni[gSel].esercizi;
  // lettere delle superserie: esercizi collegati condividono la lettera (A1, A2...)
  let gruppo = 0, pos = 0; const etichette = L.map((x, k) => { const inizio = k === 0 || !L[k - 1].ss; if (inizio) { gruppo++; pos = 1; } else pos++;
    const conSuper = x.ss || (k > 0 && L[k - 1].ss); return conSuper ? `${lettere[(gruppo - 1) % 10]}${pos}` : String(k + 1); });
  $("edList").innerHTML = L.length ? L.map((x, k) => `<div class="er${x.ss ? " ss" : ""}" data-i="${k}">
      <span class="en">${etichette[k]}</span>
      <div class="eb"><div class="et"><b>${esc(x.nome)}</b><span class="eg">${esc(x.gruppo || "")}</span></div>
        <div class="ef">
          <label>Serie<input type="number" min="1" max="20" data-k="serie" value="${x.serie}"></label>
          <label>${x.tipo === "cardio" || x.tipo === "mobilita" || x.tipo === "isometrico" ? "Durata/rip." : "Ripetizioni"}<input data-k="rip" maxlength="20" value="${esc(x.rip)}" placeholder="10 / 8-12 / 30 s"></label>
          <label>Carico<input data-k="carico" maxlength="30" value="${esc(x.carico || "")}" placeholder="kg, %, RPE"></label>
          <label>Recupero<select data-k="rec">${RECUPERI.map((r) => `<option value="${r}"${Number(x.rec) === r ? " selected" : ""}>${r ? (r >= 60 ? `${Math.floor(r / 60)}'${r % 60 ? String(r % 60).padStart(2, "0") + '"' : ""}` : `${r}"`) : "—"}</option>`).join("")}</select></label>
          <label class="wide">Note<input data-k="note" maxlength="120" value="${esc(x.note || "")}" placeholder="es. fermo 1 s in basso"></label>
        </div></div>
      <div class="ea">
        <button type="button" class="icon" data-a="su" title="Sposta su" ${k === 0 ? "disabled" : ""}>↑</button>
        <button type="button" class="icon" data-a="giu" title="Sposta giù" ${k === L.length - 1 ? "disabled" : ""}>↓</button>
        <button type="button" class="icon${x.ss ? " on" : ""}" data-a="ss" title="${x.ss ? "Togli la superserie" : "Superserie con il successivo"}" ${k === L.length - 1 ? "disabled" : ""}>⛓</button>
        <button type="button" class="icon danger" data-a="del" title="Rimuovi">✕</button>
      </div></div>`).join("")
    : '<p class="empty">Nessun esercizio in questo giorno. Aggiungili dalla libreria a destra (su telefono: «+ Aggiungi esercizio») oppure parti da un modello.</p>';
}
// stima durata: serie x (40 s di lavoro o durata indicata) + recuperi; superserie: recupero solo a fine gruppo
function secondiDi(rip) {
  const m = String(rip).match(/(\d+(?:[.,]\d+)?)\s*(min|'|m\b)/i); if (m) return parseFloat(m[1].replace(",", ".")) * 60;
  const s = String(rip).match(/(\d+)\s*(s|sec|")/i); if (s) return Number(s[1]);
  return 40;
}
function riepilogo() {
  const L = ed.giorni[gSel].esercizi;
  let sec = 0, serie = 0; const perGruppo = {};
  L.forEach((x) => { const n = Number(x.serie) || 1; serie += n; sec += n * secondiDi(x.rip) + (x.ss ? 0 : Math.max(0, n - (x.tipo === "cardio" ? 1 : 0)) * (Number(x.rec) || 0)); perGruppo[x.gruppo || "Altro"] = (perGruppo[x.gruppo || "Altro"] || 0) + n; });
  const min = Math.round(sec / 60);
  // bilanciamento sull'intera scheda
  const tot = {}; ed.giorni.forEach((g) => g.esercizi.forEach((x) => (tot[x.gruppo] = (tot[x.gruppo] || 0) + (Number(x.serie) || 1))));
  const spinta = (tot.Petto || 0) + (tot.Spalle || 0) + (tot.Tricipiti || 0), tirata = (tot.Dorso || 0) + (tot.Bicipiti || 0);
  const gambe = (tot.Quadricipiti || 0) + (tot.Femorali || 0) + (tot.Glutei || 0) + (tot.Polpacci || 0), busto = spinta + tirata;
  const consigli = [];
  if (spinta && tirata && spinta > tirata * 1.5) consigli.push("più serie di spinta che di tirata: valuta qualche esercizio per il dorso");
  if (tirata && spinta && tirata > spinta * 1.5) consigli.push("più serie di tirata che di spinta");
  if (busto >= 12 && gambe < busto * 0.4) consigli.push("le gambe sono poco allenate rispetto alla parte alta");
  if ((tot.Quadricipiti || 0) >= 6 && !(tot.Femorali || 0) && !(tot.Glutei || 0)) consigli.push("mancano femorali e glutei");
  if (min > 90) consigli.push("seduta lunga: oltre 90 minuti stimati");
  $("edSum").innerHTML = L.length ? `<span><b>${L.length}</b> esercizi</span><span><b>${serie}</b> serie</span><span>durata stimata <b>≈ ${min} min</b></span>
      <span class="eg-list">${Object.entries(perGruppo).sort((a, b) => b[1] - a[1]).map(([g, n]) => `<i title="${n} serie">${esc(g)} ${n}</i>`).join("")}</span>
      ${consigli.length ? `<span class="hint">Suggerimento: ${esc(consigli.join("; "))}.</span>` : ""}` : "";
}

// ---- interazioni editor
$("edDays").addEventListener("click", (e) => {
  const b = e.target.closest("[data-g]"); if (!b) return;
  if (b.dataset.g === "+") { if (ed.giorni.length >= 7) return toast("Massimo 7 giorni per scheda.", false); ed.giorni.push({ nome: `Giorno ${lettere[ed.giorni.length]}`, note: "", esercizi: [] }); gSel = ed.giorni.length - 1; }
  else gSel = Number(b.dataset.g);
  disegnaEditor();
});
$("edDayNome").addEventListener("input", (e) => { ed.giorni[gSel].nome = e.target.value; const t = $("edDays").querySelector(`[data-g="${gSel}"]`); if (t) t.firstChild.textContent = (e.target.value || "Giorno") + " "; });
$("edDayNote").addEventListener("input", (e) => (ed.giorni[gSel].note = e.target.value));
$("edDayDup").onclick = () => { if (ed.giorni.length >= 7) return toast("Massimo 7 giorni per scheda.", false); const g = ed.giorni[gSel]; ed.giorni.splice(gSel + 1, 0, { nome: g.nome + " (copia)", note: g.note, esercizi: g.esercizi.map((x) => ({ ...x })) }); gSel++; disegnaEditor(); };
$("edDayDel").onclick = async () => {
  if (ed.giorni.length < 2) return;
  if (ed.giorni[gSel].esercizi.length && !(await ask("Eliminare il giorno?", `«${ed.giorni[gSel].nome}» e i suoi ${ed.giorni[gSel].esercizi.length} esercizi.`, "Elimina"))) return;
  ed.giorni.splice(gSel, 1); gSel = Math.max(0, gSel - 1); disegnaEditor();
};
$("edList").addEventListener("input", (e) => {
  const el = e.target.closest("[data-k]"), r = e.target.closest("[data-i]"); if (!el || !r) return;
  ed.giorni[gSel].esercizi[Number(r.dataset.i)][el.dataset.k] = el.dataset.k === "rec" || el.dataset.k === "serie" ? Number(el.value) : el.value;
  riepilogo();
});
$("edList").addEventListener("change", (e) => { if (e.target.matches("select[data-k]")) riepilogo(); });
$("edList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-a]"), r = e.target.closest("[data-i]"); if (!b || !r) return;
  const L = ed.giorni[gSel].esercizi, i = Number(r.dataset.i);
  if (b.dataset.a === "su" && i > 0) [L[i - 1], L[i]] = [L[i], L[i - 1]];
  if (b.dataset.a === "giu" && i < L.length - 1) [L[i + 1], L[i]] = [L[i], L[i + 1]];
  if (b.dataset.a === "ss") L[i].ss = !L[i].ss;
  if (b.dataset.a === "del") L.splice(i, 1);
  if (L.length) L[L.length - 1].ss = false;
  disegnaEditor();
});

// ---- libreria
function disegnaLibreria() {
  $("libGruppi").innerHTML = `<button type="button" class="chip" data-lg="" aria-pressed="${!libGruppo}">Tutti</button>` + GRUPPI.map((g) => `<button type="button" class="chip" data-lg="${g}" aria-pressed="${libGruppo === g}">${g}</button>`).join("");
  filtraLibreria();
}
function filtraLibreria() {
  const q = norm($("libQ").value).split(/\s+/).filter(Boolean), a = $("libAttr").value;
  const presenti = new Set((ed?.giorni[gSel]?.esercizi || []).map((x) => x.id));
  const L = catalogo.filter((x) => (!libGruppo || x.gruppo === libGruppo) && (!a || x.attrezzo === a) && q.every((t) => norm(`${x.nome} ${x.gruppo} ${x.attrezzo}`).includes(t)));
  $("libN").textContent = `${L.length} di ${catalogo.length}`;
  $("libItems").innerHTML = L.map((x) => `<div class="li${presenti.has(x.id) ? " gia" : ""}"><div><b>${esc(x.nome)}</b><small>${esc(x.gruppo)} · ${esc(x.attrezzo)} · ${esc(x.livello)}</small>
      ${x.descrizione ? `<details><summary>Come si esegue</summary><p>${esc(x.descrizione)}</p></details>` : ""}</div>
      <button type="button" class="btn sm" data-add="${x.id}" title="Aggiungi a ${esc(ed?.giorni[gSel]?.nome || "")}">${presenti.has(x.id) ? "+ ancora" : "+"}</button></div>`).join("")
    || '<p class="empty">Nessun esercizio trovato. Puoi aggiungerlo al catalogo qui sotto.</p>';
}
$("libQ").addEventListener("input", filtraLibreria);
$("libAttr").addEventListener("change", filtraLibreria);
$("libGruppi").addEventListener("click", (e) => { const b = e.target.closest("[data-lg]"); if (!b) return; libGruppo = b.dataset.lg; disegnaLibreria(); });
$("libItems").addEventListener("click", (e) => {
  const b = e.target.closest("[data-add]"); if (!b) return;
  const x = catalogo.find((c) => c.id === Number(b.dataset.add)); if (!x) return;
  ed.giorni[gSel].esercizi.push(daCatalogo(x));
  disegnaEditor(); filtraLibreria();
  toast(`${x.nome} aggiunto a ${ed.giorni[gSel].nome}.`);
  const ultimo = $("edList").lastElementChild; if (ultimo && window.innerWidth > 900) ultimo.scrollIntoView({ block: "nearest" });
});
$("edApriLib").onclick = () => { $("edLib").classList.add("aperta"); $("libQ").focus(); };
$("edChiudiLib").onclick = () => $("edLib").classList.remove("aperta");
$("nuSalva").onclick = async () => {
  const nome = $("nuNome").value.trim();
  if (nome.length < 2) return toast("Scrivi il nome dell'esercizio.", false);
  const row = { nome, gruppo: $("nuGruppo").value, attrezzo: $("nuAttr").value.trim() || "Corpo libero", tipo: $("nuTipo").value, livello: $("nuLiv").value, descrizione: $("nuDesc").value.trim() || null };
  const { data, error } = await sb.from("esercizi").insert(row).select("*").single();
  if (error) return toast(/duplicate|unique/i.test(error.message) ? "Esiste già un esercizio con questo nome." : error.message, false);
  await caricaCatalogo(true);
  ed.giorni[gSel].esercizi.push(daCatalogo(data));
  ["nuNome", "nuAttr", "nuDesc"].forEach((k) => ($(k).value = ""));
  disegnaEditor(); disegnaLibreria(); toast(`«${nome}» aggiunto al catalogo e alla scheda.`);
};

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
  if (!(await ask("Pubblicare l'avviso?", `«${f.titolo.value.trim()}» comparirà nella bacheca dell'app${f.notifica.checked ? " e arriverà come notifica a chi le ha attive" : ""}.`, "Pubblica"))) return;
  const { data, error } = await sb.rpc("admin_invia_avviso", { p_titolo: f.titolo.value.trim(), p_testo: f.testo.value.trim(), p_notifica: f.notifica.checked });
  if (error) return msg($("avvMsg"), error.message);
  $("dAvv").close(); toast(`Avviso pubblicato in bacheca${data.notifiche ? ` e inviato come notifica a ${data.notifiche} ${data.notifiche === 1 ? "iscritto" : "iscritti"}` : ""}.`); if (tab === "bacheca") caricaBacheca();
});

// ================================================================== funzioni v2
// ------------------------------------------------------------------ istruttori e selettori
let istruttori = [];
async function caricaIstruttori() {
  const { data } = await sb.rpc("admin_istruttori");
  istruttori = data || [];
  document.querySelectorAll(".selIstr").forEach((s) => (s.innerHTML = opzioniIstr(null)));
}
function opzioniIstr(id, nomeLibero) {
  const noto = istruttori.some((i) => i.user_id === id);
  return '<option value="">—</option>' + istruttori.map((i) => `<option value="${i.user_id}"${i.user_id === id ? " selected" : ""}>${esc(i.nome)}${i.ruolo !== "istruttore" ? ` (${esc(i.ruolo)})` : ""}</option>`).join("")
    + (!noto && nomeLibero ? `<option value="libero:${esc(nomeLibero)}" selected>${esc(nomeLibero)}</option>` : "");
}
// valore del selettore -> campi della lezione (istruttore_id + nome mostrato)
function istrDa(v, attuale) {
  if (!v) return { istruttore_id: null, istruttore: null };
  if (v.startsWith("libero:")) return { istruttore_id: null, istruttore: v.slice(7) };
  const i = istruttori.find((x) => x.user_id === v);
  return { istruttore_id: v, istruttore: i ? i.nome : attuale?.istruttore || null };
}
function opzioniCorsi() {
  $("newCorso").innerHTML = corsi.filter((x) => x.attivo).map((x) => `<option value="${x.id}">${esc(x.nome)}</option>`).join("");
  $("slotCorso").innerHTML = corsi.map((x) => `<option value="${x.id}">${esc(x.nome)}${x.attivo ? "" : " (non attivo)"}</option>`).join("");
}

// ------------------------------------------------------------------ CSV (Excel italiano: separatore ; e BOM UTF-8)
function scaricaCsv(nome, intestazioni, righe) {
  const cella = (v) => { const s = v == null ? "" : String(v); return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = "﻿" + [intestazioni, ...righe].map((r) => r.map(cella).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const oggiYmd = () => ymdRome(new Date());
$("expIsc").onclick = async () => {
  if (!iscritti?.length) await caricaIscritti(true);
  scaricaCsv(`${oggiYmd()}-WhyNot-Iscritti.csv`, ["Nome", "Email", "Telefono", "Stato", "Ruolo", "Iscritto dal", "Prenotazioni", "Frequentate", "Assenze", "Prossime", "Ultima lezione", "Note"],
    (iscritti || []).map((i) => [i.nome, i.email, i.telefono, i.stato, i.ruolo_staff || "", fDate.format(new Date(i.iscritto_dal)), i.prenotazioni, i.frequentate, i.assenze ?? 0, i.prossime, i.ultima ? fDate.format(new Date(i.ultima)) : "", i.note || ""]));
};
$("expPren").onclick = async () => {
  const da = statDa, a = statA;
  const { data, error } = await sb.rpc("admin_export_prenotazioni", { p_da: da, p_a: a });
  if (error) return toast(error.message, false);
  scaricaCsv(`${oggiYmd()}-WhyNot-Prenotazioni.csv`, ["Data", "Ora", "Corso", "Sala", "Istruttore", "Nome", "Telefono", "Email", "Stato", "Presenza", "Origine", "Prenotata il", "Voto"],
    (data || []).map((r) => [r.data, r.ora, r.corso, r.sala, r.istruttore, r.nome, r.telefono, r.email, r.stato, r.presenza, r.origine, r.prenotata_il, r.voto]));
  toast(`Esportate ${data.length} prenotazioni (${periodoTesto()}).`);
};

// ------------------------------------------------------------------ istruttore: le mie lezioni e appello
let mLun = lunediDi(ymdRome(new Date()));
async function caricaMie() {
  $("mLbl").textContent = `${fDay.format(noon(mLun))} – ${fDay.format(noon(addDays(mLun, 6)))}`;
  const { data, error } = await sb.rpc("istruttore_lezioni", { p_da: mLun, p_a: addDays(mLun, 6) });
  if (error) { $("mieLez").innerHTML = `<p class="empty">${esc(error.message)}</p>`; return; }
  const now = Date.now();
  $("mieLez").innerHTML = (data || []).map((l) => {
    const s = new Date(l.inizio), p = Math.min(100, Math.round((l.confermate / l.capienza) * 100));
    return `<button class="tli${l.stato === "annullata" ? " x done" : new Date(l.fine).getTime() < now ? " done" : ""}" data-app="${l.id}" style="--c:${catColor(l.categoria)}">
      <span class="t">${esc(fWd.format(s))}<small>${fTime.format(s)}</small></span><span class="s"></span>
      <span><b>${esc(l.corso)}</b><span class="sub">${esc(fDate.format(s))} · ${esc(l.sala)}${l.stato === "annullata" ? " · annullata" : ""}</span></span>
      ${fillHtml(l, p)}</button>`;
  }).join("") || '<p class="empty">Nessuna lezione assegnata a te in questa settimana.</p>';
}
$("mPrev").onclick = () => { mLun = addDays(mLun, -7); caricaMie(); };
$("mNext").onclick = () => { mLun = addDays(mLun, 7); caricaMie(); };
$("mOggi").onclick = () => { mLun = lunediDi(ymdRome(new Date())); caricaMie(); };
$("mieLez").addEventListener("click", (e) => { const b = e.target.closest("[data-app]"); if (b) apriAppello(Number(b.dataset.app)); });
async function apriAppello(id) {
  const [{ data: L }, { data: P, error }] = await Promise.all([sb.rpc("istruttore_lezioni", { p_da: mLun, p_a: addDays(mLun, 6) }), sb.rpc("appello", { p_lezione_id: id })]);
  if (error) return toast(error.message, false);
  const l = (L || []).find((x) => x.id === id); if (!l) return;
  const aperto = new Date(l.inizio).getTime() - 30 * 60000 <= Date.now();
  const conf = (P || []).filter((p) => p.stato === "confermata"), att = (P || []).filter((p) => p.stato === "attesa");
  const riga = (p) => `<div class="pp"><span class="av sm2">${esc(initials(p.nome))}</span><div><b>${esc(p.nome)}</b>${p.note ? `<small>«${esc(p.note)}»</small>` : ""}</div>
    ${p.stato === "confermata" && aperto ? `<div class="acts"><button class="ghost sm${p.presenza === true ? " on" : ""}" data-pr="1" data-id="${p.id}">Presente</button><button class="ghost sm${p.presenza === false ? " off" : ""}" data-pr="0" data-id="${p.id}">Assente</button></div>` : ""}</div>`;
  $("lezBody").innerHTML = `<div class="dw-head" style="--c:${catColor(l.categoria)}"><button class="close" data-x aria-label="Chiudi">&times;</button><span class="k">${esc(l.categoria)}</span><h2>${esc(l.corso)}</h2>
      <div class="kv"><span>${esc(cap1(fFull.format(new Date(l.inizio))))}</span><span>${fTime.format(new Date(l.inizio))}–${fTime.format(new Date(l.fine))}</span><span>${esc(l.sala)}</span></div></div>
    <div class="dw-body">${aperto ? "" : '<p class="mut">L\'appello si apre 30 minuti prima della lezione.</p>'}
      <div class="sec"><h3>Partecipanti (${conf.length}${suPrenL(l) ? `/${l.capienza}` : ""})</h3>${conf.length ? `<div class="ppl">${conf.map(riga).join("")}</div>` : '<p class="empty">Nessun partecipante.</p>'}</div>
      ${att.length ? `<div class="sec"><h3>Lista d'attesa (${att.length})</h3><div class="ppl">${att.map(riga).join("")}</div></div>` : ""}</div>`;
  $("lezBody").querySelector("[data-x]").onclick = () => $("dLez").close();
  $("lezBody").querySelectorAll("[data-pr]").forEach((b) => (b.onclick = async () => {
    const p = conf.find((x) => x.id === b.dataset.id), v = b.dataset.pr === "1";
    const { error: e } = await sb.rpc("segna_presenza", { p_prenotazione_id: p.id, p_presente: p.presenza === v ? null : v });
    if (e) return toast(e.message, false);
    apriAppello(id);
  }));
  if (!$("dLez").open) $("dLez").showModal();
}

// ------------------------------------------------------------------ corsi e orari
const GIORNI = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];
let palinsesto = [];
async function caricaPalinsesto() {
  const [c, p, imp] = await Promise.all([
    sb.from("corsi").select("id,slug,nome,categoria,sala,capienza_default,prenotazione_obbligatoria,attivo").order("nome"),
    sb.from("palinsesto").select("id,corso_id,giorno,ora_inizio,ora_fine,sala,capienza,istruttore_id,attivo,note").order("giorno").order("ora_inizio"),
    sb.from("impostazioni").select("chiave,valore"),
  ]);
  if (c.error || p.error) { $("corsiTbl").innerHTML = `<p class="empty">${esc((c.error || p.error).message)}</p>`; return; }
  corsi = c.data || []; palinsesto = p.data || []; opzioniCorsi(); disegnaLegenda();
  const ore = (imp.data || []).find((x) => x.chiave === "ore_annullo");
  $("fRegole").ore.value = ore ? Number(ore.valore) : 2;
  $("corsiTbl").innerHTML = `<div class="wrap-tbl"><table class="tbl"><thead><tr><th>Corso</th><th class="hm">Categoria</th><th>Sala</th><th class="num">Posti</th><th class="num hm">Fasce</th><th>Stato</th></tr></thead><tbody>${
    corsi.map((x) => `<tr data-corso="${x.id}"><td><div class="p"><span class="dotc" style="background:${catColor(x.categoria)}"></span><b>${esc(x.nome)}</b></div></td><td class="hm">${esc(x.categoria)}</td><td>${esc(x.sala)}</td>
      <td class="num"><b>${x.capienza_default}</b></td><td class="num hm">${palinsesto.filter((s) => s.corso_id === x.id && s.attivo).length}</td>
      <td>${x.attivo ? '<span class="pill ok">Attivo</span>' : '<span class="pill">Non attivo</span>'}${x.prenotazione_obbligatoria ? ' <span class="pill w">Su prenotazione</span>' : ' <span class="pill">A partecipazione</span>'}</td></tr>`).join("")}</tbody></table></div>`;
  const nomeC = (id) => corsi.find((x) => x.id === id) || { nome: "?", categoria: "", sala: "", capienza_default: 0 };
  const nomeI = (id) => istruttori.find((i) => i.user_id === id)?.nome || "";
  $("palGrid").innerHTML = GIORNI.map((g, k) => {
    const lista = palinsesto.filter((s) => s.giorno === k + 1);
    return `<div class="col"><h3><span>${g}</span><span>${lista.filter((s) => s.attivo).length}</span></h3>${lista.map((s) => { const cc = nomeC(s.corso_id);
      return `<button class="lz${s.attivo ? "" : " annullata"}" data-slot="${s.id}" style="--c:${catColor(cc.categoria)}"><small>${s.ora_inizio.slice(0, 5)}–${s.ora_fine.slice(0, 5)}${(s.sala || cc.sala) !== "Sala 1" ? ` · ${esc(s.sala || cc.sala)}` : ""}</small>
        <b>${esc(cc.nome)}</b><div class="row3"><span>${s.capienza || cc.capienza_default} posti</span><span>${s.attivo ? "" : '<span class="tg">spenta</span>'}</span></div>${nomeI(s.istruttore_id) ? `<small>${esc(nomeI(s.istruttore_id))}</small>` : ""}</button>`; }).join("") || '<p class="none">—</p>'}
      <button class="link" data-addslot="${k + 1}" style="padding:4px 6px">+ aggiungi</button></div>`;
  }).join("");
}
$("fRegole").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await sb.rpc("admin_salva_impostazioni", { p_ore_annullo: Number(e.target.ore.value) });
  toast(error ? error.message : `Annullo consentito fino a ${e.target.ore.value} ore prima.`, !error);
});
function apriCorso(c) {
  const f = $("corsoForm"); f.reset(); msg($("corsoMsg"), "");
  f.elements.id.value = c?.id || ""; f.nome.value = c?.nome || ""; f.categoria.value = c?.categoria || ""; f.sala.value = c?.sala || "Sala 1";
  f.capienza_default.value = c?.capienza_default || 20; f.prenotazione_obbligatoria.value = c?.prenotazione_obbligatoria ? "1" : "0"; f.attivo.checked = c ? c.attivo : true;
  $("applicaBox").hidden = !c; $("corsoT").textContent = c ? c.nome : "Nuovo corso";
  f.dataset.capPrima = c?.capienza_default || "";
  $("dCorso").showModal();
}
$("addCorso").onclick = () => apriCorso(null);
$("corsiTbl").addEventListener("click", (e) => { const r = e.target.closest("[data-corso]"); if (r) apriCorso(corsi.find((x) => x.id === Number(r.dataset.corso))); });
$("corsoForm").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = e.target;
  const row = { nome: f.nome.value.trim(), categoria: f.categoria.value.trim(), sala: f.sala.value.trim(), capienza_default: Number(f.capienza_default.value),
    prenotazione_obbligatoria: f.prenotazione_obbligatoria.value === "1", attivo: f.attivo.checked };
  if (row.nome.length < 2 || !row.categoria || !row.sala || !(row.capienza_default > 0)) return msg($("corsoMsg"), "Compila nome, categoria, sala e capienza.");
  let res;
  if (f.elements.id.value) res = await sb.from("corsi").update(row).eq("id", f.elements.id.value);
  else {
    row.slug = row.nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Date.now().toString(36);
    res = await sb.from("corsi").insert(row);
  }
  if (res.error) return msg($("corsoMsg"), res.error.message);
  let extra = "";
  if (f.elements.id.value && f.applica.checked && String(row.capienza_default) !== f.dataset.capPrima) {
    const { data: n, error } = await sb.rpc("admin_applica_capienza", { p_corso_id: Number(f.elements.id.value) });
    extra = error ? ` (lezioni future non aggiornate: ${error.message})` : ` e su ${n} lezioni future`;
  }
  $("dCorso").close(); toast(`Corso salvato${extra}.`); caricaPalinsesto();
});
function apriSlot(s, giorno) {
  const f = $("slotForm"); f.reset(); msg($("slotMsg"), "");
  f.querySelectorAll(".selIstr").forEach((x) => (x.innerHTML = opzioniIstr(s?.istruttore_id || null)));
  f.elements.id.value = s?.id || ""; f.corso_id.value = s?.corso_id || corsi.find((c) => c.attivo)?.id || "";
  f.giorno.value = s?.giorno || giorno || 1; f.ora_inizio.value = s?.ora_inizio?.slice(0, 5) || ""; f.ora_fine.value = s?.ora_fine?.slice(0, 5) || "";
  f.sala.value = s?.sala || ""; f.capienza.value = s?.capienza || ""; f.attivo.checked = s ? s.attivo : true;
  $("slotDel").hidden = !s; $("slotT").textContent = s ? "Modifica fascia" : "Nuova fascia oraria";
  $("dSlot").showModal();
}
$("newSlot").onclick = () => apriSlot(null);
$("palGrid").addEventListener("click", (e) => {
  const b = e.target.closest("[data-slot]"); if (b) return apriSlot(palinsesto.find((s) => s.id === Number(b.dataset.slot)));
  const a = e.target.closest("[data-addslot]"); if (a) apriSlot(null, Number(a.dataset.addslot));
});
$("slotForm").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = e.target;
  if (!f.ora_inizio.value || !f.ora_fine.value || f.ora_fine.value <= f.ora_inizio.value) return msg($("slotMsg"), "Controlla gli orari: la fine deve essere dopo l'inizio.");
  const iv = f.istruttore_id.value;
  const row = { corso_id: Number(f.corso_id.value), giorno: Number(f.giorno.value), ora_inizio: f.ora_inizio.value, ora_fine: f.ora_fine.value,
    sala: f.sala.value.trim() || null, capienza: Number(f.capienza.value) || null, istruttore_id: iv && !iv.startsWith("libero:") ? iv : null, attivo: f.attivo.checked };
  const res = f.elements.id.value ? await sb.from("palinsesto").update(row).eq("id", f.elements.id.value) : await sb.from("palinsesto").insert(row);
  if (res.error) return msg($("slotMsg"), res.error.message);
  $("dSlot").close(); toast("Palinsesto aggiornato: vale per le prossime settimane generate."); caricaPalinsesto();
});
$("slotDel").onclick = async () => {
  const id = $("slotForm").elements.id.value; if (!id) return;
  if (!(await ask("Eliminare la fascia?", "Non verrà più usata quando generi le settimane. Le lezioni già generate restano.", "Elimina"))) return;
  const { error } = await sb.from("palinsesto").delete().eq("id", id);
  if (error) return msg($("slotMsg"), error.message);
  $("dSlot").close(); toast("Fascia eliminata."); caricaPalinsesto();
};

// ------------------------------------------------------------------ bacheca
async function caricaBacheca() {
  const { data, error } = await sb.from("avvisi").select("id,titolo,testo,created_at").order("created_at", { ascending: false }).limit(100);
  if (error) { $("avvisiList").innerHTML = `<p class="empty">${esc(error.message)}</p>`; return; }
  const limite = Date.now() - 60 * 86400000;
  $("avvisiList").innerHTML = (data || []).map((a) => `<div class="fi panel" style="align-items:flex-start${new Date(a.created_at).getTime() < limite ? ";opacity:.5" : ""}"><div><b>${esc(a.titolo)}</b>
    <small style="white-space:normal">${esc(a.testo)}</small><small>${esc(fDT.format(new Date(a.created_at)))}${new Date(a.created_at).getTime() < limite ? " · non più visibile nell'app" : ""}</small></div>
    <button class="ghost sm danger" data-delav="${a.id}">Elimina</button></div>`).join("") || '<p class="empty">Nessun avviso. Pubblicane uno con «+ Nuovo avviso».</p>';
}
$("avvisiList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-delav]"); if (!b) return;
  if (!(await ask("Eliminare l'avviso?", "Sparirà dalla bacheca dell'app. Le notifiche già inviate non si possono ritirare.", "Elimina"))) return;
  const { error } = await sb.from("avvisi").delete().eq("id", b.dataset.delav);
  if (error) return toast(error.message, false);
  toast("Avviso eliminato."); caricaBacheca();
});

// ------------------------------------------------------------------ statistiche
// Una sola serie per grafico (niente doppi assi), un solo colore per la grandezza, valori al passaggio e in tabella.
// periodo delle statistiche: date di inizio e fine incluse (ora italiana). Periodi a calendario:
// giorno, settimana (lunedì-domenica), mese, anno; oppure date libere (statUnita = null).
const giorniTra = (x, y) => Math.round((noon(y) - noon(x)) / 86400000) + 1;
const fineMese = (ymd) => { const [y, m] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
// stesso giorno k mesi dopo (o prima); se il giorno non esiste (31 → 30 novembre) si ferma all'ultimo del mese
const addMesi = (ymd, k) => { const [y, m, d] = ymd.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 + k, 1)), ult = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, ult)).padStart(2, "0")}`; };
function periodoDi(unita, ymd) {
  if (unita === "settimana") { const l = lunediDi(ymd); return [l, addDays(l, 6)]; }
  if (unita === "mese") return [ymd.slice(0, 8) + "01", fineMese(ymd)];
  if (unita === "anno") return [ymd.slice(0, 4) + "-01-01", ymd.slice(0, 4) + "-12-31"];
  return [ymd, ymd];
}
let statUnita = "mese", [statDa, statA] = periodoDi("mese", ymdRome(new Date()));
const nGiorni = () => giorniTra(statDa, statA);
const fMeseA = F({ month: "long", year: "numeric" });
function testoPeriodo(da, a, unita) {
  if (unita === "giorno" || da === a) return cap1(fFull.format(noon(da))) + " " + da.slice(0, 4);
  if (unita === "mese") return cap1(fMeseA.format(noon(da)));
  if (unita === "anno") return "Anno " + da.slice(0, 4);
  return `${unita === "settimana" ? "Settimana " : ""}dal ${fDate.format(noon(da))} al ${fDate.format(noon(a))} · ${giorniTra(da, a)} giorni`;
}
const periodoTesto = () => testoPeriodo(statDa, statA, statUnita);
function impostaPeriodo(da, a, unita) {
  if (a < da) [da, a] = [a, da];
  if (giorniTra(da, a) > 400) da = addDays(a, -399);
  statDa = da; statA = a; statUnita = unita || null;
  $("statRange").da.value = da; $("statRange").a.value = a;
  const oggi = ymdRome(new Date());
  const chip = unita === "giorno" ? (da === oggi ? "oggi" : da === addDays(oggi, -1) ? "ieri" : null) : unita;
  $("statPer").querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", x.dataset.p === chip));
  caricaStat();
}
const pct = (v) => (v == null ? "—" : `${v}%`);

// --- confronto tra periodi (benchmark): tutto calcolato qui dai dati di admin_statistiche, nessuna funzione nuova nel database
// Riferimenti (si possono attivare insieme):
//   settimana = stesse date 7 giorni prima · mese = stesse date un mese prima (mese intero se il periodo è un mese)
//   anno = stesso periodo un anno prima (per giorno e settimana 364 giorni prima, così coincidono i giorni della settimana)
//   scelta = periodo libero indicato a mano
const CONFR = {
  settimana: { nome: "Settimana prima", breve: "settimana prima" },
  mese: { nome: "Mese prima", breve: "mese prima" },
  anno: { nome: "Anno prima", breve: "anno prima" },
  scelta: { nome: "Periodo a scelta", breve: "periodo a scelta" },
};
let confSel = ["mese", "anno"], confDa = null, confA = null;
try { const v = JSON.parse(localStorage.getItem("wn-stat-confronto2") || "null"); if (Array.isArray(v)) confSel = v.filter((k) => CONFR[k]); } catch (e) { /* preferenza non disponibile */ }
// un confronto che si sovrappone al periodo scelto non ha senso: "settimana prima" solo fino a 7 giorni, "mese prima" fino a 31
const confUsabile = (k) => (k === "settimana" ? nGiorni() <= 7 : k === "mese" ? nGiorni() <= 31 : true);
function segnaConf() {
  $("statConfSel").querySelectorAll("[data-c]").forEach((b) => {
    const k = b.dataset.c, ok = confUsabile(k);
    b.setAttribute("aria-pressed", ok && confSel.includes(k)); b.disabled = !ok;
    b.title = ok ? b.dataset.t : k === "settimana" ? "Il periodo scelto è più lungo di una settimana" : "Il periodo scelto è più lungo di un mese";
  });
  const f = $("confRange"); f.hidden = !confSel.includes("scelta");
  if (!confDa) { const n = nGiorni(); confDa = addDays(statDa, -n); confA = addDays(statA, -n); }
  f.cda.value = confDa; f.ca.value = confA;
}
$("statConfSel").addEventListener("click", (e) => {
  const b = e.target.closest("[data-c]"); if (!b || b.disabled) return;
  const k = b.dataset.c;
  // all'attivazione propone il periodo di uguale durata subito prima di quello scelto (poi si cambiano le date a piacere)
  if (k === "scelta" && !confSel.includes(k)) { const n = nGiorni(); confDa = addDays(statDa, -n); confA = addDays(statA, -n); }
  confSel = confSel.includes(k) ? confSel.filter((x) => x !== k) : Object.keys(CONFR).filter((x) => x === k || confSel.includes(x));
  try { localStorage.setItem("wn-stat-confronto2", JSON.stringify(confSel)); } catch (e2) { /* ignora */ }
  caricaStat();
});
$("confRange").addEventListener("submit", (e) => {
  e.preventDefault(); const f = e.target; if (!f.cda.value || !f.ca.value) return;
  [confDa, confA] = f.cda.value <= f.ca.value ? [f.cda.value, f.ca.value] : [f.ca.value, f.cda.value];
  if (giorniTra(confDa, confA) > 400) confDa = addDays(confA, -399);
  caricaStat();
});
// date dei riferimenti; se il periodo scelto è in corso, ogni riferimento si taglia agli stessi giorni trascorsi ("a pari giorni")
function periodiRif(da, a, giorniTrascorsi) {
  const u = statUnita;
  return confSel.filter(confUsabile).map((k) => {
    let p;
    if (k === "settimana") p = [addDays(da, -7), addDays(a, -7)];
    else if (k === "mese") p = u === "mese" ? periodoDi("mese", addMesi(da, -1)) : [addMesi(da, -1), addMesi(a, -1)];
    else if (k === "anno") p = u === "giorno" || u === "settimana" ? [addDays(da, -364), addDays(a, -364)] : u === "anno" ? periodoDi("anno", addMesi(da, -12)) : u === "mese" ? periodoDi("mese", addMesi(da, -12)) : [addMesi(da, -12), addMesi(a, -12)];
    else p = [confDa, confA];
    const tagliato = giorniTrascorsi && k !== "scelta" && giorniTra(p[0], p[1]) > giorniTrascorsi;
    if (tagliato) p = [p[0], addDays(p[0], giorniTrascorsi - 1)];
    return { k, ...CONFR[k], da: p[0], a: p[1], tagliato };
  });
}
const testoParte = (x, y) => (x === y ? fDate.format(noon(x)) : `${fDate.format(noon(x))} – ${fDate.format(noon(y))}`);
// riduce una risposta di admin_statistiche agli indicatori confrontabili
function sintesi(d, giorni) {
  const T = d.totali || {};
  if (!(T.lezioni > 0)) return { vuoto: true, corsi: {} };
  const posti = T.posti || 0, pren = T.prenotati || 0, lez = T.lezioni || 0;
  const corsi = {};
  (d.per_corso || []).forEach((r) => { corsi[r.corso] = { riemp: r.posti ? Math.round((100 * (r.prenotati || 0)) / r.posti) : null }; });
  return { vuoto: false, giorni, lezioni: lez, posti, prenotati: pren, riemp: posti ? (100 * pren) / posti : null, perLez: lez ? pren / lez : null, perGiorno: pren / giorni,
    presenze: (d.giornaliero || []).reduce((s, g) => s + (g.presenze || 0), 0), assPct: pren ? (100 * (T.assenti || 0)) / pren : null,
    annullate: T.annullate || 0, voto: T.voti ? Number(T.voto_medio) : null, voti: T.voti || 0, corsi };
}
// indicatori: come si scrive il valore, come si misura la differenza (punti % o variazione %), e se salire è un bene
const num = (v, dec = 0) => (v == null ? "—" : Number(v).toLocaleString("it-IT", { minimumFractionDigits: dec, maximumFractionDigits: dec }));
const IND = [
  { sez: "Attività" },
  { id: "lezioni", nome: "Lezioni", f: (v) => num(v), d: "rel", meglio: 0 },
  { id: "posti", nome: "Posti offerti", f: (v) => num(v), d: "rel", meglio: 0 },
  { id: "prenotati", nome: "Prenotati confermati", f: (v) => num(v), d: "rel", meglio: 1 },
  { id: "presenze", nome: "Presenze", f: (v) => num(v), d: "rel", meglio: 1 },
  { sez: "Qualità" },
  { id: "riemp", nome: "Riempimento", f: (v) => (v == null ? "—" : `${num(v)}%`), d: "pt", meglio: 1 },
  { id: "perGiorno", nome: "Prenotati al giorno", f: (v) => num(v, 1), d: "abs1", meglio: 1 },
  { id: "perLez", nome: "Prenotati per lezione", f: (v) => num(v, 1), d: "abs1", meglio: 1 },
  { id: "assPct", nome: "Assenze segnate", f: (v) => (v == null ? "—" : `${num(v)}%`), d: "pt", meglio: -1 },
  { id: "annullate", nome: "Prenotazioni annullate", f: (v) => num(v), d: "rel", meglio: -1 },
  { id: "voto", nome: "Voto medio", f: (v) => num(v, 1), d: "abs1", meglio: 1 },
  { id: "voti", nome: "Valutazioni ricevute", f: (v) => num(v), d: "rel", meglio: 1 },
];
// differenza tra attuale e riferimento: testo, verso (su/giu/neu) e spiegazione per il passaggio del mouse
function delta(ind, cur, rif) {
  if (cur == null || rif == null) return null;
  let v, t;
  if (ind.d === "rel") { if (!rif) return null; v = (100 * (cur - rif)) / rif; t = `${v > 0 ? "+" : ""}${num(v)}%`; }
  else if (ind.d === "pt") { v = cur - rif; t = `${v > 0 ? "+" : ""}${num(v)} pt`; }
  else { v = cur - rif; t = `${v > 0 ? "+" : ""}${num(v, 1)}`; }
  const zero = Math.abs(v) < (ind.d === "abs1" ? 0.05 : 0.5);
  const verso = zero || !ind.meglio ? "neu" : (v > 0) === (ind.meglio > 0) ? "su" : "giu";
  return { t: zero ? "=" : `${v > 0 ? "▲" : "▼"} ${t}`, verso };
}
let statGen = 0;

async function caricaStat() {
  const da = statDa, a = statA, gen = ++statGen;
  $("statLbl").textContent = periodoTesto(); $("statRange").da.value = da; $("statRange").a.value = a;
  $("statKpi").innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div>';
  segnaConf();
  // periodo in corso (es. il mese corrente): il confronto si fa "a pari giorni", da inizio periodo fino a oggi, contro gli stessi giorni dei riferimenti
  const oggi = ymdRome(new Date()), inCorso = da <= oggi && oggi < a;
  const cDa = da, cA = inCorso ? oggi : a, trascorsi = inCorso ? giorniTra(da, oggi) : 0;
  const rif = periodiRif(da, a, trascorsi), chiesti = {};
  const chiedi = (x, y) => (chiesti[x + "|" + y] ||= sb.rpc("admin_statistiche", { p_da: x, p_a: y }));   // ogni intervallo una volta sola
  const [s, ina, sc, ...R] = await Promise.all([chiedi(da, a), sb.rpc("admin_inattivi", { p_giorni: 21 }), rif.length ? chiedi(cDa, cA) : null, ...rif.map((r) => chiedi(r.da, r.a))]);
  if (gen !== statGen) return;   // nel frattempo è stato scelto un altro periodo
  if (s.error) { $("statKpi").innerHTML = `<p class="empty">${esc(s.error.message)}</p>`; $("statConfP").hidden = true; return; }
  const d = s.data, t = d.totali || {};
  const cur = sc && !sc.error ? sintesi(sc.data, giorniTra(cDa, cA)) : sintesi(d, nGiorni());
  cur.da = cDa; cur.a = cA; cur.inCorso = inCorso;
  rif.forEach((r, i) => { r.errore = R[i].error?.message; r.s = r.errore ? null : sintesi(R[i].data, giorniTra(r.da, r.a)); });
  const rifOk = rif.filter((r) => r.s && !r.s.vuoto), r0 = rifOk[0];
  // nei riquadri: variazione contro il primo riferimento con dati (a pari giorni se il periodo è in corso)
  const kd = (id) => { if (!r0) return ""; const ind = IND.find((x) => x.id === id), x = delta(ind, cur[id], r0.s[id]);
    return x ? `<em class="dlt ${x.verso}">${x.t} <span>vs ${esc(r0.breve)}${inCorso ? " (a pari giorni)" : ""}</span></em>` : ""; };
  const riemp = t.posti ? Math.round((100 * t.prenotati) / t.posti) : 0;
  $("statKpi").innerHTML = `
    <div class="kpi"><span>Riempimento medio</span><b>${riemp}%</b><small>${t.prenotati} prenotati su ${t.posti} posti</small><div class="meter"><i style="width:${riemp}%"></i></div>${kd("riemp")}</div>
    <div class="kpi"><span>Lezioni</span><b>${t.lezioni}</b><small>${statDa === statA ? "nel giorno" : `in ${nGiorni()} giorni`}</small>${kd("lezioni")}</div>
    <div class="kpi"><span>Assenze segnate</span><b>${t.prenotati ? Math.round((100 * t.assenti) / t.prenotati) : 0}%</b><small>${t.assenti} su ${t.prenotati} prenotati · ${t.annullate} annullate</small>${kd("assPct")}</div>
    <div class="kpi"><span>Voto medio lezioni</span><b>${t.voto_medio != null ? Number(t.voto_medio).toFixed(1).replace(".", ",") : "—"}</b><small>${t.voti} valutazioni</small>${kd("voto")}</div>`;
  disegnaConfronto(cur, rif);
  const pc = d.per_corso || [];
  const rB = inCorso ? null : r0;   // tacca di riferimento solo a periodo concluso (con periodo in corso vale la tabella a pari giorni)
  const bm = (r) => { const c = rB?.s.corsi[r.corso]; return c && c.riemp != null ? `<b class="bm" style="left:${Math.min(100, c.riemp)}%"></b>` : ""; };
  const bmT = (r) => { const c = rB?.s.corsi[r.corso]; return c && c.riemp != null ? ` · ${rB.breve}: ${c.riemp}%` : ""; };
  $("statCorsi").innerHTML = pc.length ? `<div class="hbars">${pc.map((r) => `<div class="hb" title="${esc(r.corso)}: ${r.prenotati} prenotati su ${r.posti} posti in ${r.lezioni} lezioni${r.voto ? ` · voto ${r.voto}` : ""}${esc(bmT(r))}">
      <span class="hl">${esc(r.corso)}</span><span class="ht"><i style="width:${Math.min(100, r.riempimento || 0)}%"></i>${bm(r)}</span><span class="hv">${pct(r.riempimento)}</span></div>`).join("")}</div>
    ${rB ? `<div class="legend" style="margin-top:10px"><span><i style="background:var(--red-hi)"></i>periodo scelto</span><span><i class="bmk"></i>${esc(rB.breve)}</span></div>` : ""}
    <details style="margin-top:10px"><summary class="mut">Tabella</summary><div class="wrap-tbl" style="margin-top:8px"><table class="tbl"><thead><tr><th>Corso</th><th class="num">Lezioni</th><th class="num">Prenotati</th><th class="num">Posti</th><th class="num">Riemp.</th><th class="num">Assenti</th><th class="num">Voto</th></tr></thead><tbody>${
      pc.map((r) => `<tr><td>${esc(r.corso)}</td><td class="num">${r.lezioni}</td><td class="num">${r.prenotati}</td><td class="num">${r.posti}</td><td class="num">${pct(r.riempimento)}</td><td class="num">${r.assenti}</td><td class="num">${r.voto ?? "—"}${r.voti ? ` (${r.voti})` : ""}</td></tr>`).join("")}</tbody></table></div></details>`
    : '<p class="empty">Nessuna lezione nel periodo.</p>';
  const pf = d.per_fascia || [], ore = [...new Set(pf.map((r) => r.ora))].sort((x, y) => x - y);
  const cella = (g, o) => pf.find((r) => r.giorno === g && r.ora === o);
  $("statHeat").innerHTML = pf.length ? `<div class="heat" style="grid-template-columns:44px repeat(7,minmax(0,1fr))"><span></span>${GIORNI.map((g) => `<span class="hh">${g.slice(0, 3)}</span>`).join("")}
    ${ore.map((o) => `<span class="hh hr">${String(o).padStart(2, "0")}:00</span>${[1, 2, 3, 4, 5, 6, 7].map((g) => { const c = cella(g, o); const v = c ? c.riempimento || 0 : null;
      return c ? `<span class="hc" style="--a:${(0.12 + (0.88 * Math.min(100, v)) / 100).toFixed(2)}" title="${GIORNI[g - 1]} ${String(o).padStart(2, "0")}:00 · riempimento ${v}% su ${c.lezioni} ${c.lezioni === 1 ? "lezione" : "lezioni"}">${v}</span>` : '<span class="hc vuota"></span>'; }).join("")}`).join("")}</div>
    <div class="legend" style="margin-top:10px"><span><i style="background:rgba(224,34,51,.15)"></i>poco pieno</span><span><i style="background:rgba(224,34,51,1)"></i>pieno</span><span>valori in % · celle vuote = nessuna lezione</span></div>`
    : '<p class="empty">Nessuna lezione nel periodo.</p>';
  disegnaGiorni(d.giornaliero || []); disegnaValutazioni(d.valutazioni || {});
  const ms = d.mensile || [], fM = F({ month: "short" });
  const mini = (titolo, campo) => { const max = Math.max(1, ...ms.map((m) => m[campo] || 0));
    return `<div class="mini"><span class="mt">${titolo}</span><div class="mb">${ms.map((m) => `<span class="mc" title="${esc(fM.format(noon(m.mese + "-15")))} ${m.mese.slice(0, 4)}: ${m[campo]}"><i style="height:${Math.max(2, Math.round((100 * (m[campo] || 0)) / max))}%"></i></span>`).join("")}</div>
      <div class="mx"><span>da ${esc(fM.format(noon(ms[0].mese + "-15")))}</span><span>ultimo mese: <b>${ms[ms.length - 1][campo]}</b></span></div></div>`; };
  $("statMesi").innerHTML = ms.length ? mini("Prenotazioni confermate", "prenotati") + mini("Presenze", "frequenze") + mini("Iscritti che hanno prenotato", "iscritti_attivi") + mini("Nuovi iscritti", "nuovi_iscritti") : "";
  const L = ina.data || [];
  $("statInatt").innerHTML = L.length ? `<p class="mut" style="margin-bottom:8px">${L.length} iscritti attivi senza prenotazioni negli ultimi 21 giorni; ${L.filter((x) => x.notifiche).length} hanno le notifiche attive (gli altri contattali su WhatsApp).</p>
    <div class="wrap-tbl"><table class="tbl"><thead><tr><th><input type="checkbox" id="inaAll" aria-label="Seleziona tutti"></th><th>Iscritto</th><th class="hm">Telefono</th><th>Ultima presenza</th><th>Notifiche</th></tr></thead><tbody>${
      L.map((x) => `<tr><td><input type="checkbox" class="inaSel" value="${x.user_id}" ${x.notifiche ? "" : "disabled"}></td><td><b>${esc(x.nome)}</b><small style="display:block;color:var(--mut)">${esc(x.email)}</small></td>
        <td class="hm">${x.telefono ? `<a href="https://wa.me/${String(x.telefono).replace(/[^0-9]/g, "").replace(/^(?=\d{9,10}$)/, "39")}" target="_blank" rel="noopener">${esc(x.telefono)}</a>` : "—"}</td>
        <td>${x.ultima ? fDate.format(new Date(x.ultima)) : "mai"}</td><td>${x.notifiche ? '<span class="pill ok">sì</span>' : '<span class="pill">no</span>'}</td></tr>`).join("")}</tbody></table></div>`
    : '<p class="empty">Nessun iscritto inattivo da 3 settimane.</p>';
  const agg = () => { $("richiamoBtn").disabled = !document.querySelectorAll(".inaSel:checked").length; };
  $("inaAll")?.addEventListener("change", (e) => { document.querySelectorAll(".inaSel:not(:disabled)").forEach((c) => (c.checked = e.target.checked)); agg(); });
  document.querySelectorAll(".inaSel").forEach((c) => c.addEventListener("change", agg)); agg();
}
$("statPer").addEventListener("click", (e) => {
  const b = e.target.closest("[data-p]"); if (!b) return;
  const oggi = ymdRome(new Date()), p = b.dataset.p;
  if (p === "oggi") impostaPeriodo(oggi, oggi, "giorno");
  else if (p === "ieri") impostaPeriodo(addDays(oggi, -1), addDays(oggi, -1), "giorno");
  else impostaPeriodo(...periodoDi(p, oggi), p);
});
$("statRange").addEventListener("submit", (e) => { e.preventDefault(); const f = e.target; if (f.da.value && f.a.value) impostaPeriodo(f.da.value, f.a.value, f.da.value === f.a.value ? "giorno" : null); });
// frecce: giorno, settimana, mese o anno precedente/successivo a calendario; con date libere, della stessa lunghezza
function spostaPeriodo(v) {
  const u = statUnita;
  if (u === "mese" || u === "anno") impostaPeriodo(...periodoDi(u, addMesi(statDa, u === "mese" ? v : 12 * v)), u);
  else { const n = u === "settimana" ? 7 : u === "giorno" ? 1 : nGiorni(); impostaPeriodo(addDays(statDa, v * n), addDays(statA, v * n), u); }
}
$("stPrev").onclick = () => spostaPeriodo(-1);
$("stNext").onclick = () => spostaPeriodo(1);
$("richiamoBtn").onclick = async () => {
  const ids = [...document.querySelectorAll(".inaSel:checked")].map((c) => c.value);
  if (!ids.length) return;
  if (!(await ask("Inviare il richiamo?", `Notifica a ${ids.length} ${ids.length === 1 ? "iscritto" : "iscritti"}: «Ci manchi! Dai un'occhiata ai corsi di questa settimana e prenota il prossimo allenamento.»`, "Invia"))) return;
  const { data, error } = await sb.rpc("admin_richiamo", { p_utenti: ids, p_titolo: "Ci manchi!", p_testo: "Dai un'occhiata ai corsi di questa settimana e prenota il prossimo allenamento. Ti aspettiamo!" });
  toast(error ? error.message : `Richiamo inviato a ${data} ${data === 1 ? "iscritto" : "iscritti"}.`, !error);
};

// ------------------------------------------------------------------ statistiche: tabella di confronto tra periodi
function disegnaConfronto(cur, rif) {
  const P = $("statConfP"), box = $("statConf");
  P.hidden = !rif.length; if (!rif.length) { box.innerHTML = ""; return; }
  const oggi = ymdRome(new Date());
  const gg = (n) => `${n} ${n === 1 ? "giorno" : "giorni"}`;
  const testa = (r) => {
    const nota = r.errore ? "errore" : r.s.vuoto ? "nessuna lezione" : "";
    return `<th class="num" colspan="2">${esc(r.nome)}<small>${esc(testoParte(r.da, r.a))}</small><small>${gg(giorniTra(r.da, r.a))}${nota ? ` · ${esc(nota)}` : ""}</small></th>`;
  };
  const cella = (ind, r, v) => {
    if (r.errore || r.s.vuoto) return '<td class="num mut">—</td><td></td>';
    const x = delta(ind, cur[ind.id], v);
    return `<td class="num">${ind.f(v)}</td><td class="num dlt ${x ? x.verso : ""}">${x ? x.t : ""}</td>`;
  };
  const righe = IND.map((ind) => ind.sez
    ? `<tr class="sez"><td colspan="${2 + 2 * rif.length}">${ind.sez}</td></tr>`
    : `<tr><td>${ind.nome}</td><td class="num"><b>${ind.f(cur[ind.id])}</b></td>${rif.map((r) => cella(ind, r, r.s?.[ind.id])).join("")}</tr>`).join("");
  // per corso: riempimento del periodo scelto contro ciascun riferimento (in punti percentuali)
  const nomi = [...new Set([...Object.keys(cur.corsi), ...rif.flatMap((r) => (r.s ? Object.keys(r.s.corsi) : []))])]
    .sort((x, y) => (cur.corsi[y]?.riemp ?? -1) - (cur.corsi[x]?.riemp ?? -1) || x.localeCompare(y, "it"));
  const indR = IND.find((x) => x.id === "riemp");
  const rc = (n) => `<tr><td>${esc(n)}</td><td class="num"><b>${pct(cur.corsi[n]?.riemp ?? null)}</b></td>${rif.map((r) => {
    if (r.errore || r.s.vuoto) return '<td class="num mut">—</td><td></td>';
    const v = r.s.corsi[n]?.riemp ?? null, x = delta(indR, cur.corsi[n]?.riemp ?? null, v);
    return `<td class="num">${pct(v)}</td><td class="num dlt ${x ? x.verso : ""}">${x ? x.t : ""}</td>`; }).join("")}</tr>`;
  const nCur = giorniTra(cur.da, cur.a);
  const diversi = rif.filter((r) => r.s && !r.s.vuoto && giorniTra(r.da, r.a) !== nCur).map((r) => `${r.breve} ${gg(giorniTra(r.da, r.a))}`);
  const errori = rif.filter((r) => r.errore).map((r) => `${r.nome}: ${r.errore}`);
  const vuoti = rif.filter((r) => r.s?.vuoto).map((r) => r.breve);
  const testaCur = `<th class="num">${cur.inCorso ? "Periodo scelto, fino a oggi" : "Periodo scelto"}<small>${esc(testoParte(cur.da, cur.a))}</small><small>${gg(nCur)}</small></th>`;
  box.innerHTML = `${cur.inCorso ? `<p class="mut" style="margin-bottom:10px"><b>Periodo in corso: confronto a pari giorni.</b> Si confrontano i primi ${gg(nCur)} del periodo scelto (fino a oggi) con i primi ${gg(nCur)} di ogni riferimento, così una parte di mese non viene confrontata con un mese intero. Il «periodo a scelta» resta con le date indicate.</p>` : ""}
    <div class="wrap-tbl"><table class="tbl"><thead><tr><th>Indicatore</th>${testaCur}${rif.map(testa).join("")}</tr></thead><tbody>${righe}</tbody></table></div>
    ${nomi.length ? `<details style="margin-top:12px"><summary class="mut">Riempimento corso per corso</summary><div class="wrap-tbl" style="margin-top:8px"><table class="tbl"><thead><tr><th>Corso</th>${testaCur}${rif.map(testa).join("")}</tr></thead><tbody>${nomi.map(rc).join("")}</tbody></table></div></details>` : ""}
    <p class="mut" style="margin-top:10px">▲▼ variazione del periodo scelto rispetto al riferimento: in verde se migliora, in rosso se peggiora (per assenze e annullate scendere è un miglioramento). Le percentuali si confrontano in punti (pt), i conteggi in variazione %.
    ${diversi.length ? ` <b>Durata diversa</b> (periodo scelto ${gg(nCur)}; ${esc(diversi.join("; "))}): i totali non sono direttamente confrontabili, guarda riempimento, prenotati al giorno e per lezione.` : ""}
    ${cur.a > oggi ? " <b>Il periodo comprende giorni futuri</b>: prenotazioni ancora aperte e presenze non ancora registrate." : ""}
    ${vuoti.length ? ` Nessuna lezione registrata per: ${esc(vuoti.join(", "))} (i dati partono dall'avvio dell'app).` : ""}${errori.length ? ` Errore: ${esc(errori.join("; "))}` : ""}</p>`;
}

// ------------------------------------------------------------------ statistiche: giorno per giorno e valutazioni
// Una serie per grafico; colore unico per la grandezza; valori al passaggio, nell'asse e in tabella.
const fGg = F({ weekday: "short", day: "numeric", month: "short" });
function disegnaGiorni(G) {
  const box = $("statGiorni");
  if (!G.length) { box.innerHTML = '<p class="empty">Nessun dato nel periodo.</p>'; return; }
  const max = Math.max(1, ...G.map((g) => g.prenotati || 0)), tot = G.reduce((s, g) => s + (g.prenotati || 0), 0);
  const conLez = G.filter((g) => g.lezioni), media = conLez.length ? Math.round(tot / conLez.length) : 0;
  const top = [...G].sort((a, b) => (b.prenotati || 0) - (a.prenotati || 0))[0];
  const oggi = ymdRome(new Date());
  const passo = G.length > 60 ? 7 : G.length > 21 ? 3 : 1;   // etichette dell'asse leggibili
  box.innerHTML = `<p class="mut" style="margin-bottom:8px">${tot} prenotati in ${conLez.length} ${conLez.length === 1 ? "giorno" : "giorni"} con lezioni · media ${media} al giorno${top && top.prenotati ? ` · giorno più pieno: ${esc(fGg.format(noon(top.giorno)))} (${top.prenotati})` : ""}</p>
    <div class="days-ch" style="--n:${G.length}">${G.map((g) => {
      const h = g.prenotati ? Math.max(3, Math.round((100 * g.prenotati) / max)) : 0, futuro = g.giorno > oggi;
      return `<button type="button" class="dc${futuro ? " fut" : ""}${g.lezioni ? "" : " vuoto"}" data-giorno="${g.giorno}" title="${esc(cap1(fGg.format(noon(g.giorno))))}: ${g.lezioni ? `${g.prenotati} prenotati su ${g.posti} posti (${g.riempimento ?? 0}%) · ${g.lezioni} lezioni${futuro ? "" : ` · ${g.presenze} presenze`}` : "nessuna lezione"}${G.length > 1 ? " · clic per vedere solo questo giorno" : ""}"><i style="height:${h}%"></i></button>`;
    }).join("")}</div>
    <div class="dx" style="--n:${G.length}">${G.map((g, k) => `<span>${k % passo === 0 ? esc(fGg.format(noon(g.giorno)).replace(/\.$/, "")) : ""}</span>`).join("")}</div>
    <div class="legend"><span><i style="background:var(--red-hi)"></i>prenotati (giorni passati e oggi)</span><span><i style="background:rgba(224,34,51,.45)"></i>prenotati per giorni futuri</span></div>
    <details style="margin-top:10px"><summary class="mut">Tabella giorno per giorno</summary><div class="wrap-tbl" style="margin-top:8px;max-height:360px"><table class="tbl"><thead><tr><th>Giorno</th><th class="num">Lezioni</th><th class="num">Posti</th><th class="num">Prenotati</th><th class="num">Riemp.</th><th class="num">Presenze</th></tr></thead><tbody>${
      G.map((g) => `<tr><td>${esc(cap1(fGg.format(noon(g.giorno))))}</td><td class="num">${g.lezioni}</td><td class="num">${g.posti}</td><td class="num">${g.prenotati}</td><td class="num">${g.lezioni ? `${g.riempimento ?? 0}%` : "—"}</td><td class="num">${g.giorno > oggi ? "—" : g.presenze}</td></tr>`).join("")}</tbody></table></div></details>`;
  box.querySelectorAll("[data-giorno]").forEach((b) => (b.onclick = () => { if (G.length > 1) impostaPeriodo(b.dataset.giorno, b.dataset.giorno, "giorno"); }));
}

const stelle = (m) => { const r = Math.round(Number(m)); return "★".repeat(r) + "☆".repeat(5 - r); };
function disegnaValutazioni(V) {
  const box = $("statVal"), P = V.per_corso || [], C = V.commenti || [];
  if (!P.length) { box.innerHTML = '<p class="empty">Nessuna valutazione nel periodo. Gli iscritti possono dare da 1 a 5 stelle alle lezioni frequentate, nella sezione «Le mie» dell\'app.</p>'; return; }
  const totVoti = P.reduce((s, r) => s + r.voti, 0);
  const ord = [...P].sort((a, b) => b.media - a.media || b.voti - a.voti);
  const migliori = ord.slice(0, 5), peggiori = [...P].sort((a, b) => a.media - b.media || b.voti - a.voti).slice(0, 5);
  const riga = (r) => `<div class="vr" title="${esc(r.corso)}: media ${String(r.media).replace(".", ",")} su ${r.voti} ${r.voti === 1 ? "voto" : "voti"}">
    <span class="vn"><span class="dotc" style="background:${catColor(r.categoria)}"></span>${esc(r.corso)}</span><span class="vs">${stelle(r.media)}</span>
    <span class="vm">${Number(r.media).toFixed(1).replace(".", ",")}</span><span class="vc">${r.voti} ${r.voti === 1 ? "voto" : "voti"}</span></div>`;
  const distr = (r) => { const t = r.voti || 1; return `<span class="dist" title="5★ ${r.d5} · 4★ ${r.d4} · 3★ ${r.d3} · 2★ ${r.d2} · 1★ ${r.d1}">${[5, 4, 3, 2, 1].map((s) => `<i style="width:${(100 * r["d" + s]) / t}%;--s:${s}"></i>`).join("")}</span>`; };
  box.innerHTML = `<p class="mut" style="margin-bottom:10px">${totVoti} ${totVoti === 1 ? "valutazione" : "valutazioni"} su ${P.length} ${P.length === 1 ? "corso" : "corsi"}. Con pochi voti la media è poco affidabile: guarda anche la colonna dei voti.</p>
    <div class="grid2v">
      <div><h3 class="vh">Più apprezzati</h3>${migliori.map(riga).join("")}</div>
      <div><h3 class="vh">Meno apprezzati</h3>${peggiori.map(riga).join("")}</div>
    </div>
    <details style="margin-top:12px"><summary class="mut">Tutti i corsi con distribuzione delle stelle</summary><div class="wrap-tbl" style="margin-top:8px"><table class="tbl"><thead><tr><th>Corso</th><th class="num">Media</th><th class="num">Voti</th><th>Distribuzione (5★ → 1★)</th></tr></thead><tbody>${
      ord.map((r) => `<tr><td>${esc(r.corso)}</td><td class="num">${Number(r.media).toFixed(2).replace(".", ",")}</td><td class="num">${r.voti}</td><td>${distr(r)}</td></tr>`).join("")}</tbody></table></div>
      <div class="legend" style="margin-top:8px">${[5, 4, 3, 2, 1].map((s) => `<span><i class="ds" style="--s:${s}"></i>${s}★</span>`).join("")}</div></details>
    ${C.length ? `<h3 class="vh" style="margin-top:16px">Ultimi commenti</h3><div class="feed">${C.map((c) => `<div class="fi"><div><b>${esc(c.corso)}</b> <span class="stars-a">${"★".repeat(c.voto)}</span><small style="white-space:normal">«${esc(c.commento)}»</small><small>${esc(c.autore)} · ${esc(fDate.format(new Date(c.quando)))}</small></div></div>`).join("")}</div>` : ""}`;
}

// ------------------------------------------------------------------ schede: destinatari multipli (per email, univoca)
let destSel = [];
const iscrittoDi = (uid) => (iscritti || []).find((i) => i.user_id === uid);
function destTesto(s) {
  const L = s.destinatari?.length ? s.destinatari : s.member_id ? [s.member_id] : [];
  if (!L.length) return "per tutti";
  const prime = L.slice(0, 2).map((u) => esc(iscrittoDi(u)?.email || "iscritto rimosso")).join(", ");
  return `per ${prime}${L.length > 2 ? ` e altri ${L.length - 2}` : ""}`;
}
function disegnaDest() {
  $("destChips").innerHTML = destSel.map((u) => { const i = iscrittoDi(u);
    return `<span class="dchip" title="${esc(i?.nome || "")}">${esc(i?.email || "iscritto rimosso")}<button type="button" data-rmd="${u}" aria-label="Togli ${esc(i?.email || "")}">&times;</button></span>`; }).join("");
  $("destInfo").textContent = destSel.length ? `${destSel.length} ${destSel.length === 1 ? "iscritto" : "iscritti"}` : "nessuno = tutti gli iscritti";
  // nei suggerimenti solo chi ha l'app attiva e non è già scelto
  $("schDestList").innerHTML = (iscritti || []).filter((i) => i.user_id && i.attivo && !destSel.includes(i.user_id)).map((i) => `<option value="${esc(i.email)}">${esc(i.nome)}</option>`).join("");
}
function aggiungiDest() {
  const campo = $("schDest"), voci = campo.value.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!voci.length) return true;
  const errori = [];
  voci.forEach((mail) => {
    const i = (iscritti || []).find((x) => x.email === mail);
    if (!i) errori.push(`nessun iscritto con l'email ${mail}`);
    else if (!i.user_id) errori.push(`${i.nome} non ha ancora attivato l'app`);
    else if (!destSel.includes(i.user_id)) destSel.push(i.user_id);
  });
  campo.value = ""; disegnaDest();
  if (errori.length) { msg($("schMsg"), errori.join("; ") + "."); campo.focus(); return false; }
  msg($("schMsg"), ""); return true;
}
$("destAdd").onclick = () => aggiungiDest();
$("schDest").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); aggiungiDest(); } });
// scelta dai suggerimenti: aggiunge subito
$("schDest").addEventListener("input", (e) => { const v = e.target.value.trim().toLowerCase(); if ((iscritti || []).some((i) => i.email === v && i.user_id) && e.inputType !== "insertText") aggiungiDest(); });
$("destChips").addEventListener("click", (e) => { const b = e.target.closest("[data-rmd]"); if (b) { destSel = destSel.filter((u) => u !== b.dataset.rmd); disegnaDest(); } });

// ------------------------------------------------------------------ schede: scadenza (inizio + settimane)
function scadenzaScheda(s) {
  const sett = Number(s?.struttura?.settimane), inizio = s?.struttura?.inizio || (s?.pubblicata_il ? ymdRome(new Date(s.pubblicata_il)) : null);
  if (!sett || !inizio || s.stato !== "pubblicata") return null;
  const fine = addDays(inizio, sett * 7 - 1);   // ultimo giorno di validità
  return { inizio, fine, giorni: Math.round((noon(fine) - noon(ymdRome(new Date()))) / 86400000) };
}
function etichettaScad(s) {
  const sc = scadenzaScheda(s);
  if (!sc) return s.stato === "pubblicata" && !Number(s.struttura?.settimane) ? '<span class="mut">senza scadenza (settimane non indicate)</span>' : "";
  if (sc.giorni < 0) return `<span class="pill x">Scaduta il ${esc(fDate.format(noon(sc.fine)))}</span>`;
  if (sc.giorni <= 7) return `<span class="pill w">${sc.giorni === 0 ? "Scade oggi" : sc.giorni === 1 ? "Scade domani" : `Scade tra ${sc.giorni} giorni`}</span>`;
  return `<span class="mut">Valida fino al ${esc(fDate.format(noon(sc.fine)))}</span>`;
}
function aggiornaScad() {
  const f = $("schForm"), sett = Number(f.settimane.value), ini = f.inizio.value;
  $("schScad").textContent = sett && ini ? `scade il ${fDate.format(noon(addDays(ini, sett * 7 - 1)))}` : sett ? "parte alla pubblicazione" : "";
}
$("schForm").settimane.addEventListener("input", aggiornaScad);
$("schForm").inizio.addEventListener("input", aggiornaScad);
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-scad]"); if (!b) return;
  schFiltro = b.dataset.scad; vai("schede");
  $("schFilter").querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", x.dataset.f === schFiltro));
});
