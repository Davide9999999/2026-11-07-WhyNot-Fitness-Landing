# WHY NOT – Admin, prenotazioni e assistente AI (ambiente dev)

Ambiente: `https://2026-11-07-whynot-fitness-landing.davide-tettamanti.workers.dev`

| Cosa | Dove |
|---|---|
| Area staff (login, calendario, prenotazioni, schede, assistente AI) | `/admin/` |
| Pagina pubblica **nascosta** "Prenota i corsi della settimana" (noindex, non linkata, non in sitemap) | `/prenota/` |
| Database, regole di sicurezza, capienza e lista d'attesa | `supabase/2026-11-09-WhyNot-schema.sql` |
| Corsi e palinsesto iniziali (brochure 2026/2027) | `supabase/2026-11-09-WhyNot-seed.sql` |
| Worker Cloudflare (sito + API assistente) | `worker/index.js`, `wrangler.jsonc` |

## 1. Supabase (una volta sola)
1. Crea il progetto (consigliata regione **EU – Frankfurt**) e salva la password del database.
2. **SQL Editor** → incolla ed esegui `2026-11-09-WhyNot-schema.sql`, poi `2026-11-09-WhyNot-seed.sql`.
3. **Authentication → Sign In / Providers → Email**: disattiva "Allow new users to sign up" (gli account staff li crei tu).
4. **Authentication → Users → Add user**: email e password dell'admin, spunta "Auto Confirm User".
5. **SQL Editor**: abilita l'utente come admin
   ```sql
   insert into public.staff (user_id, ruolo, nome)
   select id, 'admin', 'Davide' from auth.users where email = 'TUA-EMAIL';
   ```
6. **Project Settings → API**: copia **Project URL** e **anon / publishable key** (sono pubbliche) e mandale a Claude, oppure inseriscile in:
   - `assets/supabase-config.js` (`url`, `anonKey`)
   - `wrangler.jsonc` → `vars.SUPABASE_URL`, `vars.SUPABASE_ANON_KEY`
   **Mai** usare/condividere la `service_role` key.

## 2. Anthropic (assistente AI)
1. console.anthropic.com → **API Keys** → crea una chiave; in **Billing** imposta un limite di spesa mensile.
2. Cloudflare → Workers & Pages → `2026-11-07-whynot-fitness-landing` → **Settings → Variables and Secrets** → **Add** → tipo *Secret*, nome `ANTHROPIC_API_KEY`, valore = la chiave.
   Non incollare la chiave in chat, nel repo o nei file: il repo è pubblico.
3. Modello: `claude-opus-5-5` (variabile `AI_MODEL` in `wrangler.jsonc`), effort `low`, fallback lato server attivo in caso di rifiuto. Per ridurre i costi si può impostare `AI_MODEL` a `claude-haiku-5-5` (scelta vostra: meno capace).

## 3. Pubblicazione
Ogni push su `main` viene pubblicato da Cloudflare (Workers Builds). Il Worker serve i file del sito come prima e risponde su `/api/*`.

## 4. Primo collaudo (3 casi)
1. **Prenotazioni** – in `/admin/` premi "Genera dal palinsesto" per la settimana corrente; apri `/prenota/`, prenota una lezione → "confermata". Porta la capienza di una lezione a 1 e prenota di nuovo → "lista d'attesa". Annulla dal dettaglio lezione la prima prenotazione → la seconda passa a "confermata".
2. **Admin** – login, cambio settimana, nuova lezione ripetuta, nascondi/pubblica, annulla/ripristina, aggiungi ospite, crea e pubblica una scheda.
3. **Assistente** – chiedi «Quante persone sono prenotate oggi?» (sola lettura, risponde senza proposte); poi «Genera le lezioni della prossima settimana» → compare una card: **Conferma** → le lezioni compaiono nel calendario e in `ai_audit` c'è la riga dell'azione.

## Sicurezza (come funziona)
- La RLS dà accesso a lezioni, prenotazioni, schede e registro **solo** a chi è nella tabella `staff`.
- La pagina pubblica usa due funzioni dedicate: `lezioni_settimana()` (solo posti liberi, nessun dato personale) e `prenota_lezione()` (solo lezioni pubblicate della settimana in corso, non iniziate; controlli su recapiti e doppioni).
- La capienza è gestita nel database con blocco della riga: niente overbooking anche con prenotazioni simultanee; chi supera la capienza va in lista d'attesa e viene promosso automaticamente quando si libera un posto.
- Il Worker interroga Supabase con il token dell'admin loggato (non con la service-role key): anche se l'AI sbagliasse, non può superare i permessi dell'admin. Le azioni di scrittura dell'AI vengono eseguite solo dopo conferma e registrate in `ai_audit`.

## Da decidere / da fare prima della produzione
- **Capienza reale** di ogni corso e della Sala 2 (ora 20 posti provvisori).
- **Fasce condivise** del palinsesto (es. Hatha Yoga / Pilates): ora è attivo il primo corso, il secondo è disattivato.
- **Privacy**: informativa per le prenotazioni online e accordo trattamento dati (DPA) con Supabase – da verificare con il consulente.
- **Notifiche** (email/WhatsApp di conferma e promozione dalla lista d'attesa): non ancora presenti.
- Pubblicazione di `/prenota/` (togliere `noindex`, aggiungere link e sitemap) quando inizierete a usarla.
