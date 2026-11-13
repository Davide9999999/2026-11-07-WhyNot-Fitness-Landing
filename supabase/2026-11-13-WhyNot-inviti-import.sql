-- =====================================================================
-- WHY NOT - 2026-11-13: import iscritti da CSV e inviti via email (Resend). Si può rieseguire.
-- - admin_importa_iscritti: crea in blocco gli iscritti (senza codice: lo genera l'invito); già presenti = saltati o aggiornati.
-- - admin_prepara_inviti: genera un codice nuovo (30 giorni) per chi non ha ancora attivato l'app, entro il limite giornaliero.
--   Lo chiama il Worker Cloudflare con il token dello staff, poi spedisce le email con Resend (la chiave resta nel Worker).
-- - admin_registra_inviti: registra l'esito di ogni invio (storico in inviti_email).
-- - admin_iscritti: nuovo stato "da invitare" e data dell'ultimo invito.
-- =====================================================================

alter table public.iscritti add column if not exists invito_at timestamptz;
alter table public.iscritti add column if not exists inviti_n int not null default 0;

create table if not exists public.inviti_email (
  id bigserial primary key,
  iscritto_id uuid references public.iscritti(id) on delete cascade,
  email text not null,
  esito text not null check (esito in ('inviato','errore')),
  errore text,
  resend_id text,
  inviato_da uuid,
  created_at timestamptz not null default now()
);
create index if not exists inviti_email_data on public.inviti_email (created_at);
alter table public.inviti_email enable row level security;   -- nessuna policy: si legge e scrive solo con le funzioni qui sotto
revoke all on public.inviti_email from anon, authenticated;

-- limite giornaliero degli inviti (Resend gratuito: 100 email al giorno, comprese quelle di reset password)
insert into public.impostazioni (chiave, valore) values ('inviti_limite_giorno', to_jsonb(90)) on conflict (chiave) do nothing;

create or replace function public._inviti_oggi() returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.inviti_email
   where esito = 'inviato' and created_at >= (date_trunc('day', now() at time zone 'Europe/Rome') at time zone 'Europe/Rome');
$$;
revoke all on function public._inviti_oggi() from public, anon, authenticated;

create or replace function public.admin_inviti_stato() returns json language plpgsql stable security definer set search_path = public as $$
declare v_lim int;
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  select (valore #>> '{}')::int into v_lim from public.impostazioni where chiave = 'inviti_limite_giorno';
  v_lim := coalesce(v_lim, 90);
  return json_build_object('limite', v_lim, 'oggi', public._inviti_oggi(), 'restanti', greatest(v_lim - public._inviti_oggi(), 0));
end $$;
revoke all on function public.admin_inviti_stato() from public, anon;
grant execute on function public.admin_inviti_stato() to authenticated;

-- ---------------------------------------------------------------- import
-- p_righe: [{"nome":"Mario Rossi","email":"mario@x.it","telefono":"333...","note":"..."}] (max 1000 per chiamata)
-- p_aggiorna: per chi esiste già, completa telefono e note se mancano (nome ed email non si toccano)
create or replace function public.admin_importa_iscritti(p_righe jsonb, p_aggiorna boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare r jsonb; v_nome text; v_mail text; v_tel text; v_note text; v_id uuid; v_es text; v_out jsonb := '[]'::jsonb;
  n_c int := 0; n_e int := 0; n_a int := 0; n_x int := 0;
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  if jsonb_typeof(p_righe) <> 'array' then raise exception 'Formato non valido'; end if;
  if jsonb_array_length(p_righe) > 1000 then raise exception 'Massimo 1000 righe per volta'; end if;
  for r in select * from jsonb_array_elements(p_righe) loop
    v_nome := left(regexp_replace(trim(coalesce(r->>'nome', '')), '\s+', ' ', 'g'), 80);
    v_mail := lower(trim(coalesce(r->>'email', '')));
    v_tel := nullif(left(regexp_replace(coalesce(r->>'telefono', ''), '[^0-9+]', '', 'g'), 30), '');
    v_note := nullif(left(trim(coalesce(r->>'note', '')), 500), '');
    v_id := null;
    if v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_es := 'errore: email non valida'; n_x := n_x + 1;
    elsif char_length(v_nome) < 2 then v_es := 'errore: nome mancante'; n_x := n_x + 1;
    else
      select id into v_id from public.iscritti where email = v_mail;
      if v_id is not null then
        if p_aggiorna then
          update public.iscritti set telefono = coalesce(telefono, v_tel), note = coalesce(note, v_note), updated_at = now()
           where id = v_id and ((telefono is null and v_tel is not null) or (note is null and v_note is not null));
          if found then v_es := 'aggiornato'; n_a := n_a + 1; else v_es := 'esistente'; n_e := n_e + 1; end if;
        else v_es := 'esistente'; n_e := n_e + 1; end if;
      else
        begin
          insert into public.iscritti (nome, telefono, email, note) values (v_nome, v_tel, v_mail, v_note) returning id into v_id;
          v_es := 'creato'; n_c := n_c + 1;
        exception when unique_violation then
          select id into v_id from public.iscritti where email = v_mail; v_es := 'esistente'; n_e := n_e + 1;
        end;
      end if;
    end if;
    v_out := v_out || jsonb_build_object('email', v_mail, 'id', v_id, 'esito', v_es);
  end loop;
  return json_build_object('creati', n_c, 'esistenti', n_e, 'aggiornati', n_a, 'errori', n_x, 'righe', v_out);
end $$;
revoke all on function public.admin_importa_iscritti(jsonb, boolean) from public, anon;
grant execute on function public.admin_importa_iscritti(jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------- inviti
-- Genera un codice nuovo (il precedente smette di funzionare) per gli iscritti indicati che: non hanno attivato l'app, sono attivi.
-- Ne prepara al massimo quanti ne restano nel limite di oggi (max 100 per chiamata). Restituisce anche gli esclusi con il motivo.
create or replace function public.admin_prepara_inviti(p_ids uuid[])
returns json language plpgsql security definer set search_path = public as $$
declare v_rest int; v_cod text; x record; v_ok jsonb := '[]'::jsonb; v_no jsonb := '[]'::jsonb; v_scade timestamptz := now() + interval '30 days';
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'Nessun iscritto selezionato'; end if;
  if array_length(p_ids, 1) > 100 then raise exception 'Massimo 100 inviti per volta'; end if;
  v_rest := (public.admin_inviti_stato()->>'restanti')::int;
  for x in select i.* from public.iscritti i where i.id = any(p_ids) order by i.nome for update loop
    if x.user_id is not null then v_no := v_no || jsonb_build_object('id', x.id, 'nome', x.nome, 'motivo', 'ha già attivato l''app');
    elsif not x.attivo then v_no := v_no || jsonb_build_object('id', x.id, 'nome', x.nome, 'motivo', 'iscrizione sospesa');
    elsif v_rest <= 0 then v_no := v_no || jsonb_build_object('id', x.id, 'nome', x.nome, 'motivo', 'limite giornaliero raggiunto');
    else
      v_cod := public._nuovo_codice();
      update public.iscritti set codice_hash = public._hash_codice(v_cod), codice_scade = v_scade, updated_at = now() where id = x.id;
      v_ok := v_ok || jsonb_build_object('id', x.id, 'nome', x.nome, 'email', x.email, 'codice', v_cod, 'scade', v_scade);
      v_rest := v_rest - 1;
    end if;
  end loop;
  return json_build_object('inviti', v_ok, 'esclusi', v_no);
end $$;
revoke all on function public.admin_prepara_inviti(uuid[]) from public, anon;
grant execute on function public.admin_prepara_inviti(uuid[]) to authenticated;

-- p_esiti: [{"id":"…","email":"…","ok":true,"resend_id":"…"} | {"id":"…","email":"…","ok":false,"errore":"…"}]
create or replace function public.admin_registra_inviti(p_esiti jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare e jsonb; n int := 0;
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  for e in select * from jsonb_array_elements(p_esiti) loop
    insert into public.inviti_email (iscritto_id, email, esito, errore, resend_id, inviato_da)
    values ((e->>'id')::uuid, coalesce(e->>'email', ''), case when (e->>'ok')::boolean then 'inviato' else 'errore' end,
            left(e->>'errore', 300), e->>'resend_id', auth.uid());
    if (e->>'ok')::boolean then
      update public.iscritti set invito_at = now(), inviti_n = inviti_n + 1 where id = (e->>'id')::uuid;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.admin_registra_inviti(jsonb) from public, anon;
grant execute on function public.admin_registra_inviti(jsonb) to authenticated;

-- ---------------------------------------------------------------- elenco iscritti con stato invito
drop function if exists public.admin_iscritti();
create function public.admin_iscritti()
returns table(id uuid, user_id uuid, nome text, telefono text, email text, stato text, attivo boolean, note text, iscritto_dal timestamptz,
              codice_scade timestamptz, ruolo_staff text, prenotazioni int, frequentate int, assenze int, prossime int, ultima timestamptz,
              invito_at timestamptz, inviti_n int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  return query
  select i.id, i.user_id, coalesce(p.nome, i.nome), coalesce(p.telefono, i.telefono), i.email,
         case when not i.attivo then 'sospeso' when i.user_id is not null then 'attivo'
              when i.codice_hash is null then 'da invitare'
              when i.codice_scade is null or i.codice_scade <= now() then 'codice scaduto' else 'da attivare' end,
         i.attivo, i.note, i.created_at, i.codice_scade, coalesce(s.ruolo, i.ruolo_staff),
         (count(b.*) filter (where b.stato <> 'annullata'))::int,
         (count(b.*) filter (where b.stato = 'confermata' and l.fine <= now() and l.stato <> 'annullata' and b.presenza is distinct from false))::int,
         (count(b.*) filter (where b.stato = 'confermata' and b.presenza is false))::int,
         (count(b.*) filter (where b.stato <> 'annullata' and l.inizio > now()))::int,
         max(l.inizio) filter (where b.stato <> 'annullata'),
         i.invito_at, i.inviti_n
  from public.iscritti i
  left join public.profili p on p.user_id = i.user_id
  left join public.staff s on s.user_id = i.user_id
  left join public.prenotazioni b on b.member_id = i.user_id and i.user_id is not null
  left join public.lezioni l on l.id = b.lezione_id
  group by i.id, p.user_id, s.user_id
  order by coalesce(p.nome, i.nome);
end $$;
revoke all on function public.admin_iscritti() from public, anon;
grant execute on function public.admin_iscritti() to authenticated;
