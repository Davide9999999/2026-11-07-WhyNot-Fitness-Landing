// WHY NOT Fitness Club - Worker Cloudflare
// - Serve i file statici del sito (binding ASSETS).
// - POST /api/chat     : assistente AI per lo staff. Legge liberamente; le modifiche diventano PROPOSTE da confermare.
// - POST /api/execute  : esegue una proposta confermata dall'admin e la registra in ai_audit.
// Sicurezza: ogni chiamata a Supabase usa il JWT dell'utente loggato (mai la service-role key),
// quindi è la Row Level Security a decidere cosa si può fare. La chiave Anthropic è un secret del Worker.
//
// Variabili richieste (wrangler.jsonc "vars" + secret):
//   SUPABASE_URL, SUPABASE_ANON_KEY   (pubbliche)
//   ANTHROPIC_API_KEY                 (secret: wrangler secret put ANTHROPIC_API_KEY oppure dashboard Cloudflare)
//   AI_MODEL                          (facoltativa, default claude-opus-5-5)

import Anthropic from "@anthropic-ai/sdk";
import { giroNotifiche, pulisci } from "./push.js";
import { inviti } from "./inviti.js";

const DEFAULT_MODEL = "claude-opus-5-5";
const MAX_ITERAZIONI = 8;

// ---------------------------------------------------------------- strumenti
const LETTURA = new Set(["elenco_corsi", "elenco_lezioni", "elenco_prenotazioni", "cerca_prenotazioni", "elenco_schede", "leggi_palinsesto"]);
const SCRITTURA = new Set(["crea_lezioni", "aggiorna_lezione", "genera_settimana", "prenota", "aggiorna_prenotazione", "crea_scheda", "aggiorna_scheda"]);

const s = (description, extra = {}) => ({ type: "string", description, ...extra });
const ns = (description, extra = {}) => ({ type: ["string", "null"], description, ...extra });
const ni = (description) => ({ type: ["integer", "null"], description });
const tool = (name, description, properties) => ({
  name, description, strict: true,
  input_schema: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
});

const TOOLS = [
  // --- lettura (eseguite subito) ---
  tool("elenco_corsi", "Elenca i corsi (id, slug, nome, categoria, sala, capienza predefinita, attivo).", {}),
  tool("leggi_palinsesto", "Legge il palinsesto settimanale modello da cui si generano le lezioni.", {}),
  tool("elenco_lezioni", "Elenca le lezioni in un intervallo di date (ora italiana) con posti confermati, lista d'attesa, stato e pubblicazione.", {
    da: s("Data iniziale YYYY-MM-DD"), a: s("Data finale YYYY-MM-DD (inclusa)"),
  }),
  tool("elenco_prenotazioni", "Elenca le prenotazioni di una lezione.", { lezione_id: { type: "integer", description: "ID lezione" } }),
  tool("cerca_prenotazioni", "Cerca prenotazioni per nome, telefono o email (ultime 50).", { testo: s("Testo da cercare") }),
  tool("elenco_schede", "Elenca le schede di allenamento, facoltativamente filtrate per stato.", {
    stato: { type: ["string", "null"], enum: ["bozza", "pubblicata", "archiviata", null], description: "Filtro stato o null" },
  }),
  // --- scrittura (diventano proposte da confermare) ---
  tool("crea_lezioni", "PROPONE la creazione di una lezione, eventualmente ripetuta ogni settimana.", {
    corso_id: { type: "integer", description: "ID del corso" },
    data: s("Data della prima lezione YYYY-MM-DD"),
    ora_inizio: s("HH:MM ora italiana"), ora_fine: s("HH:MM ora italiana"),
    sala: ns("Sala, null per quella del corso"), capienza: ni("Posti, null per quella del corso"),
    istruttore: ns("Istruttore o null"), note: ns("Note o null"),
    ripeti_settimane: { type: "integer", description: "Numero totale di settimane (1 = solo questa)" },
  }),
  tool("aggiorna_lezione", "PROPONE di modificare una lezione: annullarla/ripristinarla, pubblicarla/nasconderla, cambiare capienza, istruttore o note.", {
    lezione_id: { type: "integer", description: "ID lezione" },
    stato: { type: ["string", "null"], enum: ["programmata", "annullata", null], description: "Nuovo stato o null" },
    pubblicata: { type: ["boolean", "null"], description: "Visibile nella pagina pubblica o null" },
    capienza: ni("Nuova capienza o null"), istruttore: ns("Istruttore o null"), note: ns("Note o null"),
  }),
  tool("genera_settimana", "PROPONE di generare tutte le lezioni di una settimana dal palinsesto (non duplica quelle esistenti).", {
    lunedi: s("Data del lunedì YYYY-MM-DD"),
  }),
  tool("prenota", "PROPONE una prenotazione per conto di un cliente (se la lezione è piena va in lista d'attesa).", {
    lezione_id: { type: "integer", description: "ID lezione" }, nome: s("Nome e cognome"),
    telefono: ns("Telefono o null"), email: ns("Email o null"), note: ns("Note o null"),
  }),
  tool("aggiorna_prenotazione", "PROPONE di cambiare lo stato di una prenotazione (es. annullarla).", {
    prenotazione_id: s("UUID prenotazione"),
    stato: { type: "string", enum: ["confermata", "attesa", "annullata"], description: "Nuovo stato" },
  }),
  tool("crea_scheda", "PROPONE la creazione di una scheda di allenamento in bozza.", {
    titolo: s("Titolo"), obiettivo: ns("Obiettivo o null"),
    livello: { type: ["string", "null"], enum: ["principiante", "intermedio", "avanzato", null], description: "Livello o null" },
    descrizione: ns("Descrizione breve o null"), contenuto: s("Contenuto completo della scheda (esercizi, serie, ripetizioni, recuperi)"),
  }),
  tool("aggiorna_scheda", "PROPONE di modificare una scheda o cambiarne lo stato (bozza, pubblicata, archiviata).", {
    scheda_id: s("UUID scheda"),
    stato: { type: ["string", "null"], enum: ["bozza", "pubblicata", "archiviata", null], description: "Nuovo stato o null" },
    titolo: ns("Nuovo titolo o null"), obiettivo: ns("Nuovo obiettivo o null"),
    descrizione: ns("Nuova descrizione o null"), contenuto: ns("Nuovo contenuto o null"),
  }),
];

const SYSTEM = `Sei l'assistente gestionale di WHY NOT Fitness Club (palestra a Biella) e lavori per lo staff nella pagina /admin.
Rispondi in italiano, in modo breve e concreto.
Puoi leggere corsi, palinsesto, lezioni, prenotazioni e schede con gli strumenti di lettura.
Gli strumenti di scrittura NON eseguono nulla: creano una proposta che l'admin deve confermare con un pulsante. Dopo averli usati, spiega in una riga cosa hai proposto e ricorda che serve la conferma. Non dire mai che un'azione è stata eseguita.
Prima di proporre una modifica recupera gli ID corretti con gli strumenti di lettura; se un dato essenziale manca o è ambiguo, chiedilo invece di indovinare.
Le date e gli orari sono sempre nel fuso Europe/Rome. Le schede devono contenere solo indicazioni di allenamento generiche, senza consigli medici.`;

// ---------------------------------------------------------------- utilità
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const ORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

function oraRoma() {
  return new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", dateStyle: "full", timeStyle: "short" }).format(new Date());
}

// "YYYY-MM-DD" + "HH:MM" ora italiana -> ISO UTC
function romaToISO(data, ora) {
  const [y, m, d] = data.split("-").map(Number);
  const [hh, mm] = ora.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const asRome = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess - (asRome - guess)).toISOString();
}
function addDays(data, n) {
  const d = new Date(data + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

// client Supabase REST con il JWT dell'utente
function supa(env, jwt) {
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const headers = { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${jwt}`, "content-type": "application/json" };
  async function call(path, init = {}) {
    const r = await fetch(base + path, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    const text = await r.text();
    const body = text ? JSON.parse(text) : null;
    if (!r.ok) throw new Error((body && (body.message || body.msg || body.error_description)) || `Errore Supabase ${r.status}`);
    return body;
  }
  return {
    get: (path) => call("/rest/v1/" + path),
    rpc: (fn, args) => call("/rest/v1/rpc/" + fn, { method: "POST", body: JSON.stringify(args) }),
    insert: (table, rows) => call("/rest/v1/" + table, { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify(rows) }),
    patch: (path, data) => call("/rest/v1/" + path, { method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify(data) }),
    user: () => call("/auth/v1/user"),
  };
}

async function autentica(request, env) {
  const auth = request.headers.get("authorization") || "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return { errore: json({ error: "Login richiesto" }, 401) };
  const db = supa(env, jwt);
  let user;
  try { user = await db.user(); } catch { return { errore: json({ error: "Sessione non valida" }, 401) }; }
  const staff = await db.get(`staff?select=ruolo&user_id=eq.${user.id}`);
  if (!Array.isArray(staff) || staff.length === 0) return { errore: json({ error: "Accesso riservato allo staff" }, 403) };
  return { db, user };
}

// rimuove i null dagli oggetti di aggiornamento
const senzaNull = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

// ---------------------------------------------------------------- lettura
async function eseguiLettura(db, name, input) {
  switch (name) {
    case "elenco_corsi":
      return db.get("corsi?select=id,slug,nome,categoria,sala,capienza_default,prenotazione_obbligatoria,attivo&order=nome");
    case "leggi_palinsesto":
      return db.get("palinsesto?select=id,giorno,ora_inizio,ora_fine,sala,capienza,attivo,note,corsi(nome)&order=giorno,ora_inizio");
    case "elenco_lezioni": {
      if (!DATA_RE.test(input.da) || !DATA_RE.test(input.a)) throw new Error("Date non valide (YYYY-MM-DD)");
      return db.rpc("admin_lezioni", { p_da: input.da, p_a: input.a });
    }
    case "elenco_prenotazioni":
      return db.get(`prenotazioni?select=id,nome,telefono,email,stato,origine,note,created_at&lezione_id=eq.${Number(input.lezione_id)}&order=created_at`);
    case "cerca_prenotazioni": {
      const t = String(input.testo || "").replace(/[^\p{L}\p{N}@.+\- ]/gu, "").trim();
      if (t.length < 2) throw new Error("Testo di ricerca troppo corto");
      const q = encodeURIComponent(`*${t}*`);
      return db.get(`prenotazioni?select=id,nome,telefono,email,stato,lezione_id,created_at,lezioni(inizio,corsi(nome))&or=(nome.ilike.${q},telefono.ilike.${q},email.ilike.${q})&order=created_at.desc&limit=50`);
    }
    case "elenco_schede": {
      const f = input.stato ? `&stato=eq.${input.stato}` : "";
      return db.get(`schede?select=id,titolo,obiettivo,livello,stato,price_cents,updated_at${f}&order=updated_at.desc&limit=100`);
    }
  }
  throw new Error("Strumento di lettura sconosciuto");
}

// ---------------------------------------------------------------- scrittura (solo dopo conferma)
function riepilogo(name, i) {
  switch (name) {
    case "crea_lezioni": return `Creare ${i.ripeti_settimane > 1 ? i.ripeti_settimane + " lezioni settimanali" : "una lezione"} (corso ${i.corso_id}) dal ${i.data}, ${i.ora_inizio}-${i.ora_fine}`;
    case "aggiorna_lezione": return `Modificare la lezione ${i.lezione_id}: ${JSON.stringify(senzaNull({ stato: i.stato, pubblicata: i.pubblicata, capienza: i.capienza, istruttore: i.istruttore, note: i.note }))}`;
    case "genera_settimana": return `Generare le lezioni della settimana dal palinsesto (lunedì ${i.lunedi})`;
    case "prenota": return `Prenotare ${i.nome} alla lezione ${i.lezione_id}`;
    case "aggiorna_prenotazione": return `Impostare la prenotazione ${i.prenotazione_id} come "${i.stato}"`;
    case "crea_scheda": return `Creare la scheda "${i.titolo}" in bozza`;
    case "aggiorna_scheda": return `Modificare la scheda ${i.scheda_id}${i.stato ? ` (stato: ${i.stato})` : ""}`;
  }
  return name;
}

async function eseguiScrittura(db, name, i) {
  switch (name) {
    case "crea_lezioni": {
      if (!DATA_RE.test(i.data) || !ORA_RE.test(i.ora_inizio) || !ORA_RE.test(i.ora_fine)) throw new Error("Data o orari non validi");
      const n = Math.min(Math.max(Number(i.ripeti_settimane) || 1, 1), 26);
      const [corso] = await db.get(`corsi?select=id,sala,capienza_default&id=eq.${Number(i.corso_id)}`);
      if (!corso) throw new Error("Corso inesistente");
      const rows = [];
      for (let k = 0; k < n; k++) {
        const d = addDays(i.data, 7 * k);
        rows.push({
          corso_id: corso.id, inizio: romaToISO(d, i.ora_inizio), fine: romaToISO(d, i.ora_fine),
          sala: i.sala || corso.sala, capienza: i.capienza || corso.capienza_default,
          istruttore: i.istruttore || null, note: i.note || null,
        });
      }
      const out = await db.insert("lezioni", rows);
      return { create: out.length };
    }
    case "aggiorna_lezione": {
      const data = senzaNull({ stato: i.stato, pubblicata: i.pubblicata, capienza: i.capienza, istruttore: i.istruttore, note: i.note });
      if (!Object.keys(data).length) throw new Error("Nessuna modifica indicata");
      const out = await db.patch(`lezioni?id=eq.${Number(i.lezione_id)}`, data);
      if (!out.length) throw new Error("Lezione non trovata");
      return out[0];
    }
    case "genera_settimana": {
      if (!DATA_RE.test(i.lunedi)) throw new Error("Data non valida");
      return { lezioni_create: await db.rpc("genera_settimana", { p_lunedi: i.lunedi }) };
    }
    case "prenota": {
      if (!i.telefono && !i.email) throw new Error("Serve telefono o email");
      const out = await db.insert("prenotazioni", [{
        lezione_id: Number(i.lezione_id), nome: i.nome, telefono: i.telefono || null, email: i.email || null,
        note: i.note || null, origine: "ai", consenso_privacy: true,
      }]);
      return { id: out[0].id, stato: out[0].stato };
    }
    case "aggiorna_prenotazione": {
      if (!UUID_RE.test(i.prenotazione_id)) throw new Error("ID prenotazione non valido");
      const out = await db.patch(`prenotazioni?id=eq.${i.prenotazione_id}`, { stato: i.stato });
      if (!out.length) throw new Error("Prenotazione non trovata");
      return { id: out[0].id, stato: out[0].stato };
    }
    case "crea_scheda": {
      const out = await db.insert("schede", [senzaNull({
        titolo: i.titolo, obiettivo: i.obiettivo, livello: i.livello, descrizione: i.descrizione, contenuto: i.contenuto, stato: "bozza",
      })]);
      return { id: out[0].id, stato: out[0].stato };
    }
    case "aggiorna_scheda": {
      if (!UUID_RE.test(i.scheda_id)) throw new Error("ID scheda non valido");
      const data = senzaNull({ stato: i.stato, titolo: i.titolo, obiettivo: i.obiettivo, descrizione: i.descrizione, contenuto: i.contenuto });
      if (i.stato === "pubblicata") data.pubblicata_il = new Date().toISOString();
      if (!Object.keys(data).length) throw new Error("Nessuna modifica indicata");
      const out = await db.patch(`schede?id=eq.${i.scheda_id}`, data);
      if (!out.length) throw new Error("Scheda non trovata");
      return { id: out[0].id, stato: out[0].stato };
    }
  }
  throw new Error("Azione non consentita");
}

// ---------------------------------------------------------------- /api/chat
async function chat(request, env) {
  const { errore, db } = await autentica(request, env);
  if (errore) return errore;
  if (!env.ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY non configurata nel Worker" }, 500);

  const body = await request.json().catch(() => null);
  const storia = Array.isArray(body?.messages) ? body.messages : [];
  // la cronologia arriva dal browser: accettiamo solo testo, ruoli validi, lunghezza limitata
  const messages = storia.slice(-30)
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
  if (!messages.length || messages[0].role !== "user") return json({ error: "Messaggio mancante" }, 400);

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const proposte = [];
  const system = [
    { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
    { type: "text", text: `Data e ora attuali (Europe/Rome): ${oraRoma()}.` },
  ];

  for (let iter = 0; iter < MAX_ITERAZIONI; iter++) {
    let response;
    try {
      response = await client.beta.messages.create({
        model: env.AI_MODEL || DEFAULT_MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system,
        tools: TOOLS,
        messages,
      });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) return json({ error: "Troppe richieste all'assistente, riprova tra poco" }, 429);
      if (err instanceof Anthropic.AuthenticationError) return json({ error: "Chiave Anthropic non valida" }, 500);
      if (err instanceof Anthropic.APIError) return json({ error: `Errore assistente (${err.status})` }, 502);
      throw err;
    }

    if (response.stop_reason === "refusal") {
      return json({ reply: "Non posso aiutarti con questa richiesta.", proposte });
    }
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    // risposta troncata: non eseguire strumenti con input potenzialmente incompleti
    if (response.stop_reason === "max_tokens") return json({ error: "Risposta troppo lunga, riformula la richiesta" }, 502);
    const toolUses = response.content.filter((b) => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const reply = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      return json({ reply: reply || "Fatto.", proposte });
    }

    messages.push({ role: "assistant", content: response.content });
    const results = [];
    for (const t of toolUses) {
      try {
        if (LETTURA.has(t.name)) {
          const data = await eseguiLettura(db, t.name, t.input || {});
          results.push({ type: "tool_result", tool_use_id: t.id, content: JSON.stringify(data).slice(0, 60000) });
        } else if (SCRITTURA.has(t.name)) {
          const id = crypto.randomUUID();
          proposte.push({ id, tool: t.name, input: t.input, riepilogo: riepilogo(t.name, t.input || {}) });
          results.push({ type: "tool_result", tool_use_id: t.id, content: `Proposta ${id} registrata: NON ancora eseguita, in attesa di conferma dell'admin.` });
        } else {
          results.push({ type: "tool_result", tool_use_id: t.id, is_error: true, content: "Strumento sconosciuto" });
        }
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: t.id, is_error: true, content: String(e.message || e) });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return json({ reply: "Ho raggiunto il limite di passaggi per questa richiesta: prova a dividerla in parti più semplici.", proposte });
}

// ---------------------------------------------------------------- /api/execute
async function execute(request, env) {
  const { errore, db } = await autentica(request, env);
  if (errore) return errore;
  const body = await request.json().catch(() => null);
  const name = body?.tool;
  const input = body?.input && typeof body.input === "object" ? body.input : null;
  if (!SCRITTURA.has(name) || !input) return json({ error: "Azione non consentita" }, 400);
  let esito, ok = true;
  try { esito = await eseguiScrittura(db, name, input); }
  catch (e) { ok = false; esito = { errore: String(e.message || e) }; }
  try { await db.insert("ai_audit", [{ azione: name, input, esito: { ok, ...esito } }]); } catch { /* il registro non deve bloccare la risposta */ }
  return ok ? json({ ok: true, esito }) : json({ ok: false, error: esito.errore }, 400);
}

// ---------------------------------------------------------------- router
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json({ error: "Supabase non configurato nel Worker" }, 500);
      if (request.method !== "POST") return json({ error: "Metodo non consentito" }, 405);
      // giro di invio notifiche a richiesta (diagnosi): serve lo stesso PUSH_SECRET del Worker
      if (url.pathname === "/api/push/giro") {
        const conf = { PUSH_SECRET: !!env.PUSH_SECRET, VAPID_PRIVATE_KEY: !!env.VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY: !!env.VAPID_PUBLIC_KEY, lunghezzaChiavePrivata: pulisci(env.VAPID_PRIVATE_KEY, "VAPID_PRIVATE_KEY").length, attesa: 43, versione: "2026-11-10-lotto45" };
        // senza il segreto giusto nessun dettaglio della configurazione (collaudo sicurezza 2026-11-14)
        if (!env.PUSH_SECRET || request.headers.get("x-push-secret") !== env.PUSH_SECRET) return json({ error: "Non autorizzato" }, 401);
        try { return json({ configurato: conf, esito: await giroNotifiche(env) }); } catch (e) { return json({ configurato: conf, error: String(e.message || e) }, 500); }
      }
      try {
        if (url.pathname === "/api/chat") return await chat(request, env);
        if (url.pathname === "/api/execute") return await execute(request, env);
        if (url.pathname === "/api/inviti") return await inviti(request, env, json, autentica);
      } catch (e) {
        return json({ error: "Errore interno: " + String(e.message || e) }, 500);
      }
      return json({ error: "Endpoint inesistente" }, 404);
    }
    return env.ASSETS.fetch(request);
  },
  // cron (wrangler.jsonc > triggers): invio delle notifiche push in coda
  async scheduled(_evento, env, ctx) {
    ctx.waitUntil(giroNotifiche(env).then((r) => console.log("push", JSON.stringify(r))).catch((e) => console.error("push", String(e.message || e))));
  },
};
