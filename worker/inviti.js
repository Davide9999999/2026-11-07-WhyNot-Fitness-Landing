// Inviti via email all'app iscritti (Resend). La chiave RESEND_API_KEY è un secret del Worker: non arriva mai al browser.
// Flusso: lo staff (token Supabase) chiede di invitare N iscritti -> admin_prepara_inviti genera i codici (controlla staff e limite
// giornaliero nel database) -> invio in blocco con Resend -> admin_registra_inviti salva l'esito di ciascuno.
const APP = "https://whynotfitnessclub.com/app/";
const LOGO = "https://whynotfitnessclub.com/app/icons/icon-192.png";
const MITTENTE = "WHY NOT Fitness Club <noreply@whynotfitnessclub.com>";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const data = (iso) => new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));

function email(x) {
  const nome = String(x.nome || "").trim().split(/\s+/)[0] || "";
  const link = `${APP}?attiva&e=${encodeURIComponent(x.email)}&c=${encodeURIComponent(x.codice)}`;
  const scade = data(x.scade);
  const html = `<div style="background:#121212;padding:32px 16px;font-family:Arial,Helvetica,sans-serif"><div style="max-width:480px;margin:0 auto;background:#1c1c1c;border-radius:16px;padding:28px;color:#f2f2f2">
<img src="${LOGO}" width="72" height="72" alt="WHY NOT Fitness Club" style="display:block;border-radius:14px;margin:0 0 18px">
<h1 style="font-size:22px;margin:0 0 12px">${nome ? `Ciao ${esc(nome)}, ` : ""}la palestra ora è anche nel tuo telefono</h1>
<p style="font-size:15px;line-height:1.6;color:#d4d4d4">Con l'app di WHY NOT Fitness Club vedi gli orari dei corsi, prenoti H.E.A.T. e Step Coreo, segni la partecipazione agli altri corsi e ricevi gli avvisi della palestra.</p>
<p style="font-size:13px;color:#9d9d9d;margin:20px 0 6px">Il tuo codice di attivazione</p>
<p style="font-size:30px;letter-spacing:6px;font-weight:bold;font-family:'Courier New',monospace;margin:0 0 6px;color:#fff">${esc(x.codice)}</p>
<p style="font-size:13px;color:#9d9d9d;margin:0">Valido fino al ${esc(scade)}, da usare con questa email: <b style="color:#d4d4d4">${esc(x.email)}</b></p>
<p style="margin:24px 0"><a href="${esc(link)}" style="background:#b61927;color:#fff;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:999px;display:inline-block">Attiva l'app</a></p>
<p style="font-size:15px;line-height:1.6;color:#d4d4d4;margin:0 0 6px"><b>Come fare</b></p>
<ol style="font-size:14px;line-height:1.6;color:#d4d4d4;padding-left:20px;margin:0 0 16px">
<li>Tocca «Attiva l'app»: email e codice sono già inseriti.</li>
<li>Scegli una password (almeno 8 caratteri) e conferma.</li>
<li>Mettila nella schermata Home: su <b>iPhone</b> apri il link con Safari, tocca Condividi e poi «Aggiungi alla schermata Home»; su <b>Android</b> con Chrome tocca «Installa app» (o il menu ⋮ e «Installa app»).</li>
</ol>
<p style="font-size:13px;color:#9d9d9d;line-height:1.5">Se il pulsante non funziona apri ${esc(APP)} e scegli «Primo accesso». Per qualsiasi problema chiedi in reception.<br><br>
WHY NOT Fitness Club · Via Emma e Cerino Zegna 7, Biella · <a href="https://whynotfitnessclub.com/privacy/" style="color:#9d9d9d">Privacy</a><br>
Ricevi questa email perché sei iscritto alla palestra. Se non ti interessa, ignorala: senza attivazione non viene creato nessun account.</p>
</div></div>`;
  const text = `${nome ? `Ciao ${nome}, ` : ""}la palestra ora è anche nel tuo telefono.

Il tuo codice di attivazione: ${x.codice}
Valido fino al ${scade}, con questa email: ${x.email}

Attiva l'app: ${link}

1) Apri il link: email e codice sono già inseriti.
2) Scegli una password (almeno 8 caratteri).
3) iPhone: Safari > Condividi > Aggiungi alla schermata Home. Android: Chrome > Installa app.

Per qualsiasi problema chiedi in reception.
WHY NOT Fitness Club - Via Emma e Cerino Zegna 7, Biella - https://whynotfitnessclub.com/privacy/`;
  return { from: MITTENTE, to: [x.email], subject: "Il tuo invito all'app di WHY NOT Fitness Club", html, text, tags: [{ name: "tipo", value: "invito" }] };
}

export async function inviti(request, env, json, autentica) {
  const a = await autentica(request, env);
  if (a.errore) return a.errore;
  if (!env.RESEND_API_KEY) return json({ error: "Invio email non configurato: manca il secret RESEND_API_KEY nel Worker Cloudflare." }, 500);
  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.filter((x) => /^[0-9a-f-]{36}$/i.test(String(x))))] : [];
  if (!ids.length) return json({ error: "Nessun iscritto selezionato" }, 400);
  if (ids.length > 100) return json({ error: "Massimo 100 inviti per volta" }, 400);

  // 1) codici nuovi (il database controlla ruolo staff, iscritti invitabili e limite di oggi)
  let prep;
  try { prep = await a.db.rpc("admin_prepara_inviti", { p_ids: ids }); }
  catch (e) { return json({ error: String(e.message || e) }, 400); }
  const lista = prep?.inviti || [];
  const esclusi = prep?.esclusi || [];
  if (!lista.length) return json({ inviati: 0, errori: [], esclusi, stato: await a.db.rpc("admin_inviti_stato", {}).catch(() => null) });

  // 2) invio in blocco (Resend: fino a 100 email per richiesta)
  let esiti;
  try {
    const r = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": `inviti-${crypto.randomUUID()}` },
      body: JSON.stringify(lista.map(email)),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) {
      const m = out?.message || `Resend ha risposto ${r.status}`;
      esiti = lista.map((x) => ({ id: x.id, email: x.email, ok: false, errore: m }));
    } else {
      const d = Array.isArray(out?.data) ? out.data : [];
      esiti = lista.map((x, k) => (d[k]?.id ? { id: x.id, email: x.email, ok: true, resend_id: d[k].id } : { id: x.id, email: x.email, ok: false, errore: "nessuna conferma da Resend" }));
    }
  } catch (e) {
    esiti = lista.map((x) => ({ id: x.id, email: x.email, ok: false, errore: "Resend non raggiungibile: " + String(e.message || e) }));
  }

  // 3) storico degli invii
  try { await a.db.rpc("admin_registra_inviti", { p_esiti: esiti }); } catch (e) { console.error("registra_inviti", String(e.message || e)); }
  const stato = await a.db.rpc("admin_inviti_stato", {}).catch(() => null);
  return json({
    inviati: esiti.filter((x) => x.ok).length,
    errori: esiti.filter((x) => !x.ok).map((x) => ({ id: x.id, email: x.email, errore: x.errore })),
    esclusi, stato,
  });
}
