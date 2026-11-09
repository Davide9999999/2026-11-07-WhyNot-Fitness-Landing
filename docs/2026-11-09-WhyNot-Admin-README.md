# WHY NOT – Admin, prenotazioni e assistente AI (ambiente dev)

Ambiente: `https://2026-11-07-whynot-fitness-landing.davide-tettamanti.workers.dev`

| Cosa | Dove |
|---|---|
| Area staff (login, calendario, prenotazioni, schede, assistente AI) | `/admin/` |
| Pagina pubblica "Prenota i corsi della settimana" (pubblicata il 2026-11-09) | `/prenota/` |
| Area personale iscritti (accesso, profilo, storico) | `/area-personale/` |
| Database, regole di sicurezza, capienza e lista d'attesa | `supabase/2026-11-09-WhyNot-schema.sql` |
| Corsi e palinsesto iniziali (brochure 2026/2027) | `supabase/2026-11-09-WhyNot-seed.sql` |
| Worker Cloudflare (sito + API assistente) | `worker/index.js`, `wrangler.jsonc` |

## 1. Supabase (una volta sola)
1. Crea il progetto (consigliata regione **EU – Frankfurt**) e salva la password del database.
2. **SQL Editor** → incolla ed esegui `2026-11-09-WhyNot-schema.sql`, poi `2026-11-09-WhyNot-seed.sql` (controlla che compaia "Success" senza errori). Se avevi già eseguito lo schema prima del 2026-11-09 sera, esegui anche `2026-11-09-WhyNot-hardening.sql`.
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

## 5. Area personale iscritti (aggiunta il 2026-11-09)
Pagine: `/prenota/` (ora pubblica, in sitemap e nel menu) e `/area-personale/` (accesso, registrazione, profilo, storico, annullo prenotazioni; noindex).

**Una volta sola su Supabase:**
1. **SQL Editor** → esegui `supabase/2026-11-09-WhyNot-iscritti.sql` (tabella `profili`, funzioni `mio_profilo`, `salva_profilo`, `mie_prenotazioni`, `annulla_mia_prenotazione`, `admin_iscritti`, nuova `prenota_lezione` che collega la prenotazione all'account).
2. **Authentication → Sign In / Providers**: attiva **Allow new users to sign up**.
3. **Email provider → Confirm email**: in dev **disattivato**. Motivo: il servizio email predefinito di Supabase consegna solo agli indirizzi del team del progetto e ha un limite di 2 email/ora (docs Supabase, "Send emails with custom SMTP"). Prima della produzione: configurare uno **SMTP personalizzato** (es. Brevo, Resend) e riattivare la conferma email; serve anche per "Password dimenticata".
4. **Authentication → URL Configuration**: Site URL = indirizzo del sito; in **Redirect URLs** aggiungi `https://2026-11-07-whynot-fitness-landing.davide-tettamanti.workers.dev/area-personale/` e `https://davide9999999.github.io/2026-11-07-WhyNot-Fitness-Landing/area-personale/` (link di recupero password).

**Sicurezza:** l'iscritto vede e modifica solo il proprio profilo e le prenotazioni fatte col proprio account. Le vecchie prenotazioni anonime con la stessa email non vengono collegate (senza conferma email chiunque potrebbe registrarsi con l'email di un altro). Tutte le tabelle staff restano protette da `is_staff()`.

**Da decidere prima della produzione:** informativa privacy per account e prenotazioni (testo del consenso da validare con il consulente), cancellazione account (ora su richiesta via email), protezione anti-bot della registrazione (CAPTCHA di Supabase), eventuale limite di annullo (ora: fino all'inizio della lezione).

## 6. Privacy e cookie (aggiunta il 2026-11-09)
- `/privacy/` informativa (artt. 13-14 GDPR), `/cookie/` cookie policy, banner `assets/consenso.js` su tutte le pagine pubbliche (link "Preferenze cookie" nel footer).
- Il sito usa solo strumenti tecnici; Google Maps si carica solo dopo il consenso. I caratteri sono ospitati in `assets/fonts/` (niente Google Fonts).
- I tempi di conservazione scritti nell'informativa (24 mesi) diventano automatici eseguendo `supabase/2026-11-09-WhyNot-conservazione.sql` (pg_cron, ogni notte): da eseguire **dopo** la conferma dei tempi.
- Da validare con il consulente: tempi di conservazione, età minima 14 anni, regione dei server Supabase, elenco fornitori e basi giuridiche.

## 7. App iscritti (dal 2026-11-09) — sostituisce /prenota/ e /area-personale/
- **Sito pubblico**: home, corsi, privacy, cookie. `/prenota/` e `/area-personale/` rimandano a `/app/`.
- **App** `/app/` (PWA installabile, noindex): accesso, attivazione con codice, prenotazione dei corsi della settimana, le mie lezioni, profilo.
- **Niente registrazione libera**: lo staff crea l'iscritto in Admin → Iscritti → «Nuovo iscritto» e consegna il **codice di attivazione** (8 caratteri, valido 30 giorni). Il database rifiuta qualsiasi account senza email + codice validi (trigger su `auth.users`).
- Anche un **nuovo account staff** si crea così: prima come iscritto (attivazione con codice), poi lo si aggiunge alla tabella `staff`. «Add user» dalla dashboard Supabase non funziona più (il trigger lo blocca).
- Iscritto **sospeso** (casella «Iscrizione attiva» tolta): può entrare nell'app ma non prenotare.

**Setup una volta sola:**
1. SQL Editor → esegui `supabase/2026-11-09-WhyNot-app-iscritti.sql`.
2. Authentication → Sign In / Providers → **Allow new users to sign up: ON** (serve all'attivazione; senza codice valido il database rifiuta comunque).
3. Email → **Confirm email: OFF** finché non c'è un SMTP personalizzato.
4. Authentication → URL Configuration → aggiungi `…/app/` dei due domini nei Redirect URLs.

## 8. Collaboratori, password perse ed email (2026-11-09)
- Eseguiti su Supabase: `2026-11-09-WhyNot-app-iscritti.sql` e `2026-11-09-WhyNot-app-staff.sql`; registrazione attiva solo con codice, conferma email disattivata, password minima 8, Redirect URLs su `/app/`.
- **Nuovo collaboratore**: Admin → Iscritti → «Nuovo iscritto» → campo «Collaboratore» (Staff/Admin, solo per gli admin). Diventa staff appena attiva l'app. Per un iscritto già attivo: scheda iscritto → «Collaboratore» → Applica. «Add user» dalla dashboard Supabase non serve più.
- **Password persa**: scheda iscritto → «Reimposta accesso» → nuovo codice; l'iscritto riattiva l'app con la stessa email e una nuova password, le prenotazioni vengono ricollegate.
- **Email (SMTP)**: da configurare in Supabase → Authentication → Emails → SMTP Settings. Dopo, applicare i modelli in italiano di `supabase/2026-11-09-WhyNot-email-templates.json` (PATCH `/v1/projects/{ref}/config/auth`): sul piano gratuito Supabase li accetta solo con SMTP personalizzato.
