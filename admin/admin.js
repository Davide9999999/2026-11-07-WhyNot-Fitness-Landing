// /admin : gestione calendario, prenotazioni, schede + assistente AI.
// Tutte le letture/scritture passano da Supabase con la sessione dello staff: decide la RLS.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const cfg = window.WHYNOT_SUPABASE || {};
const $ = (id) => document.getElementById(id);
const TZ = "Europe/Rome";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fTime = new Intl.DateTimeFormat("it-IT", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const fDay = new Intl.DateTimeFormat("it-IT", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const fFull = new Intl.DateTimeFormat("it-IT", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const fDT = new Intl.DateTimeFormat("it-IT", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
const ymdRome = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const addDays = (ymd, n) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const lunediDi = (ymd) => { const d = new Date(ymd + "T12:00:00Z"); return addDays(ymd, -((d.getUTCDay() + 6) % 7)); };
function romaToISO(data, ora) {
  const [y, m, d] = data.split("-").map(Number); const [hh, mm] = ora.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  return new Date(guess - (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - guess)).toISOString();
}
function msg(el, text, ok) { el.textContent = text || ""; el.className = "msg" + (text ? (ok ? " ok" : " ko") : ""); }

if (!cfg.url || !cfg.anonKey) {
  document.body.innerHTML = '<p style="padding:40px;font-family:Inter,sans-serif;color:#fff">Configurazione Supabase mancante: compila <code>assets/supabase-config.js</code>.</p>';
  throw new Error("config mancante");
}
const sb = createClient(cfg.url, cfg.anonKey);
// Assistente AI in stand-by finché aiEnabled non è true in assets/supabase-config.js
if (!cfg.aiEnabled) {
  $("tab-ai").hidden = true;
  document.querySelector(".tabs [data-tab=\"ai\"]").hidden = true;
  document.querySelector(".layout").classList.add("no-ai");
}
let session = null, corsi = [], lunedi = lunediDi(ymdRome(new Date())), lezioni = [], schFiltro = "";

// ------------------------------------------------------------------ auth
async function avvia() {
  const { data } = await sb.auth.getSession();
  session = data.session;
  if (!session) { $("vLogin").hidden = false; $("vApp").hidden = true; return; }
  const { data: st } = await sb.from("staff").select("ruolo").eq("user_id", session.user.id).maybeSingle();
  if (!st) {
    $("vLogin").hidden = false; $("vApp").hidden = true;
    msg($("loginMsg"), "Questo account non è abilitato come staff. Chiedi all'amministratore di aggiungerlo alla tabella staff.");
    await sb.auth.signOut(); return;
  }
  $("vLogin").hidden = true; $("vApp").hidden = false;
  $("whoEmail").textContent = `${session.user.email} · ${st.ruolo}`;
  const { data: c } = await sb.from("corsi").select("id,nome,sala,capienza_default,attivo").order("nome");
  corsi = c || [];
  $("newCorso").innerHTML = corsi.filter((x) => x.attivo).map((x) => `<option value="${x.id}">${esc(x.nome)}</option>`).join("");
  caricaSettimana(); caricaSchede();
}
sb.auth.onAuthStateChange((_e, s) => { session = s; });

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target; msg($("loginMsg"), "Accesso in corso...", true);
  const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
  if (error) return msg($("loginMsg"), "Credenziali non valide.");
  msg($("loginMsg"), ""); avvia();
});
$("logout").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });

// ------------------------------------------------------------------ tab
document.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]"); if (!b) return;
  document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", x === b));
  const t = b.dataset.tab;
  $("tab-cal").hidden = t !== "cal"; $("tab-schede").hidden = t !== "schede";
  document.querySelector("main").hidden = t === "ai" && matchMedia("(max-width:1000px)").matches;
  $("tab-ai").classList.toggle("show", t === "ai");
});
document.querySelectorAll("dialog [data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

// ------------------------------------------------------------------ calendario
async function caricaSettimana() {
  const dom = addDays(lunedi, 6);
  $("weekLbl").textContent = `${fDay.format(new Date(lunedi + "T12:00:00Z"))} – ${fDay.format(new Date(dom + "T12:00:00Z"))}`;
  const { data, error } = await sb.rpc("admin_lezioni", { p_da: lunedi, p_a: dom });
  if (error) { $("cal").innerHTML = `<p class="msg ko">${esc(error.message)}</p>`; return; }
  lezioni = data || [];
  const oggi = ymdRome(new Date());
  $("cal").innerHTML = [...Array(7)].map((_, k) => {
    const g = addDays(lunedi, k);
    const lista = lezioni.filter((l) => ymdRome(new Date(l.inizio)) === g);
    return `<div class="col${g === oggi ? " today" : ""}"><h3><span>${esc(fDay.format(new Date(g + "T12:00:00Z")))}</span><span>${lista.length}</span></h3>${
      lista.map((l) => {
        const p = Math.min(100, Math.round((l.confermate / l.capienza) * 100));
        const cls = p >= 100 ? "full" : p >= 75 ? "mid" : "";
        return `<button class="lz${l.stato === "annullata" ? " annullata" : ""}${l.pubblicata ? "" : " nascosta"}" data-id="${l.id}">
          <small>${fTime.format(new Date(l.inizio))}–${fTime.format(new Date(l.fine))} · ${esc(l.sala)}</small>
          <b>${esc(l.corso)}</b><small>${l.confermate}/${l.capienza}${l.attesa ? ` · ${l.attesa} in attesa` : ""}${l.pubblicata ? "" : " · nascosta"}</small>
          <div class="pb"><i class="${cls}" style="width:${p}%"></i></div></button>`;
      }).join("") || '<p class="mut" style="padding:4px">—</p>'}</div>`;
  }).join("");
}
$("prevW").onclick = () => { lunedi = addDays(lunedi, -7); caricaSettimana(); };
$("nextW").onclick = () => { lunedi = addDays(lunedi, 7); caricaSettimana(); };
$("todayW").onclick = () => { lunedi = lunediDi(ymdRome(new Date())); caricaSettimana(); };
$("genW").onclick = async () => {
  if (!confirm(`Generare le lezioni della settimana dal ${lunedi} usando il palinsesto? Quelle già presenti non vengono duplicate.`)) return;
  const { data, error } = await sb.rpc("genera_settimana", { p_lunedi: lunedi });
  alert(error ? "Errore: " + error.message : `Lezioni create: ${data}`);
  caricaSettimana();
};
$("cal").addEventListener("click", (e) => { const b = e.target.closest(".lz"); if (b) apriLezione(Number(b.dataset.id)); });

async function apriLezione(id) {
  const l = lezioni.find((x) => x.id === id) || (await sb.rpc("admin_lezioni", { p_da: lunedi, p_a: addDays(lunedi, 6) })).data?.find((x) => x.id === id);
  if (!l) return;
  const { data: pren } = await sb.from("prenotazioni").select("id,nome,telefono,email,stato,origine,note,created_at").eq("lezione_id", id).order("created_at");
  const righe = (pren || []).map((p) => `<tr><td><b>${esc(p.nome)}</b><br><span class="mut">${esc([p.telefono, p.email].filter(Boolean).join(" · "))}</span>${p.note ? `<br><span class="mut">${esc(p.note)}</span>` : ""}</td>
    <td><span class="pill ${p.stato}">${p.stato}</span><br><span class="mut">${esc(p.origine)} · ${fDT.format(new Date(p.created_at))}</span></td>
    <td>${p.stato === "annullata" ? `<button class="link" data-pst="confermata" data-pid="${p.id}">Ripristina</button>` : `<button class="link" data-pst="annullata" data-pid="${p.id}">Annulla</button>`}</td></tr>`).join("");
  $("lezBody").innerHTML = `
    <h2>${esc(l.corso)}</h2>
    <div class="kv"><span>${esc(fFull.format(new Date(l.inizio)))}</span><span>${fTime.format(new Date(l.inizio))}–${fTime.format(new Date(l.fine))}</span><span>${esc(l.sala)}</span>
      <span>${l.confermate}/${l.capienza} confermati</span>${l.attesa ? `<span>${l.attesa} in attesa</span>` : ""}<span>${l.stato}</span><span>${l.pubblicata ? "visibile online" : "nascosta"}</span></div>
    <div class="row"><label>Capienza<input id="lzCap" type="number" min="1" value="${l.capienza}"></label><label>Istruttore<input id="lzIstr" value="${esc(l.istruttore || "")}"></label></div>
    <label>Note<input id="lzNote" value="${esc(l.note || "")}"></label>
    <div class="acts end">
      <button class="ghost sm" id="lzPub">${l.pubblicata ? "Nascondi online" : "Pubblica online"}</button>
      <button class="ghost sm" id="lzAnn">${l.stato === "annullata" ? "Ripristina lezione" : "Annulla lezione"}</button>
      <button class="btn sm" id="lzSave">Salva</button></div>
    <p class="msg" id="lzMsg"></p>
    <h3>Prenotazioni</h3>
    ${righe ? `<table class="bk"><thead><tr><th>Persona</th><th>Stato</th><th></th></tr></thead><tbody>${righe}</tbody></table>` : '<p class="mut">Nessuna prenotazione.</p>'}
    <h3>Aggiungi ospite</h3>
    <form id="addG" class="row"><input name="nome" placeholder="Nome e cognome" required minlength="2"><input name="telefono" placeholder="Telefono"><input name="email" type="email" placeholder="Email"><button class="btn sm" type="submit">Aggiungi</button></form>
    <p class="msg" id="gMsg"></p>`;
  const upd = async (patch) => {
    const { error } = await sb.from("lezioni").update(patch).eq("id", id);
    if (error) return msg($("lzMsg"), error.message);
    await caricaSettimana(); apriLezione(id);
  };
  $("lzSave").onclick = () => upd({ capienza: Number($("lzCap").value) || l.capienza, istruttore: $("lzIstr").value.trim() || null, note: $("lzNote").value.trim() || null });
  $("lzPub").onclick = () => upd({ pubblicata: !l.pubblicata });
  $("lzAnn").onclick = () => { if (l.stato === "annullata" || confirm("Annullare la lezione?")) upd({ stato: l.stato === "annullata" ? "programmata" : "annullata" }); };
  $("lezBody").querySelectorAll("[data-pid]").forEach((b) => b.onclick = async () => {
    const { error } = await sb.from("prenotazioni").update({ stato: b.dataset.pst }).eq("id", b.dataset.pid);
    if (error) return msg($("lzMsg"), error.message);
    await caricaSettimana(); apriLezione(id);
  });
  $("addG").onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    if (!f.telefono.value.trim() && !f.email.value.trim()) return msg($("gMsg"), "Serve telefono o email.");
    const { data, error } = await sb.from("prenotazioni").insert({ lezione_id: id, nome: f.nome.value.trim(), telefono: f.telefono.value.trim() || null,
      email: f.email.value.trim() || null, origine: "admin", consenso_privacy: true }).select("stato").single();
    if (error) return msg($("gMsg"), error.message);
    await caricaSettimana(); await apriLezione(id);
    msg($("gMsg"), data.stato === "attesa" ? "Aggiunto in lista d'attesa (lezione piena)." : "Aggiunto.", true);
  };
  if (!$("dLez").open) $("dLez").showModal();
}

$("newLez").onclick = () => { $("newForm").reset(); $("newForm").elements.data.value = lunedi; msg($("newMsg"), ""); $("dNew").showModal(); };
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
  if (error) return msg($("newMsg"), error.message);
  msg($("newMsg"), `Create ${rows.length} lezioni.`, true); caricaSettimana();
});

// ------------------------------------------------------------------ schede
async function caricaSchede() {
  let q = sb.from("schede").select("id,titolo,obiettivo,livello,stato,updated_at").order("updated_at", { ascending: false });
  if (schFiltro) q = q.eq("stato", schFiltro);
  const { data, error } = await q;
  if (error) { $("schede").innerHTML = `<p class="msg ko">${esc(error.message)}</p>`; return; }
  $("schede").innerHTML = (data || []).map((s) => `<button class="sc" data-id="${s.id}"><span class="st ${s.stato}">${s.stato}</span><h3>${esc(s.titolo)}</h3>
    <span class="mut">${esc([s.obiettivo, s.livello].filter(Boolean).join(" · ") || "—")}</span><span class="mut">Agg. ${fDT.format(new Date(s.updated_at))}</span></button>`).join("")
    || '<p class="mut">Nessuna scheda. Creane una o chiedila all\'assistente.</p>';
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
  msg($("schMsg"), "Salvato.", true); caricaSchede();
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
      caricaSettimana(); caricaSchede();
    } catch (err) {
      fine("Errore: " + err.message, false);
      chat.push({ role: "user", content: `(Nota di sistema: l'esecuzione di "${p.riepilogo}" è FALLITA: ${err.message})` });
    }
  };
}

avvia();
