-- =====================================================================
-- WHY NOT - collaboratori e reimpostazione accesso dall'admin (eseguire DOPO 2026-11-09-WhyNot-app-iscritti.sql). Si può rieseguire.
--   * un iscritto può essere segnato come collaboratore (staff/admin): se l'app non è ancora attiva diventa staff
--     appena la attiva, altrimenti subito. Solo un admin può farlo. Non serve più "Add user" dalla dashboard Supabase.
--   * "Reimposta accesso": per chi ha perso la password (senza email). Cancella l'account di accesso, genera un nuovo
--     codice; alla riattivazione le prenotazioni fatte dall'app vengono ricollegate (stessa email).
-- =====================================================================

alter table public.iscritti add column if not exists ruolo_staff text check (ruolo_staff is null or ruolo_staff in ('staff','admin'));

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and ruolo = 'admin');
$$;

-- all'attivazione: collega iscritto, crea profilo, eventuale ruolo staff, ricollega le prenotazioni dell'app
create or replace function public.attivazione_collega()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_i public.iscritti%rowtype;
begin
  update public.iscritti set user_id = new.id, codice_hash = null, codice_scade = null, updated_at = now()
   where email = lower(new.email) and user_id is null
   returning * into v_i;
  if found then
    insert into public.profili (user_id, nome, telefono, consenso_privacy, consenso_at)
    values (new.id, v_i.nome, v_i.telefono, coalesce(new.raw_user_meta_data->>'consenso', '') = 'true', now())
    on conflict (user_id) do nothing;
    if v_i.ruolo_staff is not null then
      insert into public.staff (user_id, ruolo, nome) values (new.id, v_i.ruolo_staff, v_i.nome)
      on conflict (user_id) do update set ruolo = excluded.ruolo;
    end if;
    update public.prenotazioni set member_id = new.id
     where member_id is null and origine in ('app','admin') and lower(email) = lower(new.email);
  end if;
  return new;
end $$;

drop function if exists public.admin_crea_iscritto(text, text, text);
create or replace function public.admin_crea_iscritto(p_nome text, p_telefono text, p_email text, p_ruolo_staff text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_cod text := public._nuovo_codice(); v_id uuid;
  v_mail text := lower(trim(coalesce(p_email, '')));
  v_tel text := nullif(regexp_replace(coalesce(p_telefono, ''), '[^0-9+]', '', 'g'), '');
  v_ruolo text := nullif(p_ruolo_staff, '');
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  if v_ruolo is not null and not public.is_admin() then raise exception 'Solo un admin può creare collaboratori'; end if;
  if v_ruolo is not null and v_ruolo not in ('staff','admin') then raise exception 'Ruolo non valido'; end if;
  if char_length(trim(coalesce(p_nome, ''))) < 2 then raise exception 'Inserisci nome e cognome'; end if;
  if v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email non valida'; end if;
  if exists (select 1 from public.iscritti where email = v_mail) then raise exception 'Esiste già un iscritto con questa email'; end if;
  insert into public.iscritti (nome, telefono, email, codice_hash, codice_scade, ruolo_staff)
  values (trim(p_nome), v_tel, v_mail, public._hash_codice(v_cod), now() + interval '30 days', v_ruolo)
  returning id into v_id;
  return json_build_object('id', v_id, 'codice', v_cod, 'scade', now() + interval '30 days');
end $$;

-- imposta o toglie il ruolo di collaboratore (p_ruolo null = nessuno)
create or replace function public.admin_imposta_staff(p_id uuid, p_ruolo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_i public.iscritti%rowtype; v_ruolo text := nullif(p_ruolo, '');
begin
  if not public.is_admin() then raise exception 'Solo un admin può gestire i collaboratori'; end if;
  if v_ruolo is not null and v_ruolo not in ('staff','admin') then raise exception 'Ruolo non valido'; end if;
  select * into v_i from public.iscritti where id = p_id;
  if not found then raise exception 'Iscritto inesistente'; end if;
  if v_i.user_id = auth.uid() and coalesce(v_ruolo, '') <> 'admin' then raise exception 'Non puoi togliere a te stesso il ruolo di admin'; end if;
  update public.iscritti set ruolo_staff = v_ruolo, updated_at = now() where id = p_id;
  if v_i.user_id is not null then
    if v_ruolo is null then delete from public.staff where user_id = v_i.user_id;
    else insert into public.staff (user_id, ruolo, nome) values (v_i.user_id, v_ruolo, v_i.nome)
         on conflict (user_id) do update set ruolo = excluded.ruolo;
    end if;
  end if;
end $$;

-- password persa: elimina l'account di accesso e genera un nuovo codice (lo storico resta e viene ricollegato)
create or replace function public.admin_reimposta_accesso(p_id uuid)
returns json language plpgsql security definer set search_path = public, auth as $$
declare v_i public.iscritti%rowtype; v_cod text := public._nuovo_codice(); v_staff text;
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  select * into v_i from public.iscritti where id = p_id for update;
  if not found then raise exception 'Iscritto inesistente'; end if;
  if v_i.user_id is null then raise exception 'L''app non è ancora attiva: genera un nuovo codice'; end if;
  if v_i.user_id = auth.uid() then raise exception 'Non puoi reimpostare il tuo stesso accesso da qui'; end if;
  select ruolo into v_staff from public.staff where user_id = v_i.user_id;
  if v_staff is not null and not public.is_admin() then raise exception 'Solo un admin può reimpostare l''accesso di un collaboratore'; end if;
  -- conserva il ruolo staff per la riattivazione
  update public.iscritti set ruolo_staff = coalesce(v_staff, ruolo_staff), user_id = null,
         codice_hash = public._hash_codice(v_cod), codice_scade = now() + interval '30 days', updated_at = now()
   where id = p_id;
  delete from auth.users where id = v_i.user_id;   -- profilo e ruolo staff si cancellano a cascata
  return json_build_object('id', p_id, 'codice', v_cod, 'scade', now() + interval '30 days');
end $$;

drop function if exists public.admin_iscritti();
create function public.admin_iscritti()
returns table (id uuid, user_id uuid, nome text, telefono text, email text, stato text, attivo boolean, note text,
               iscritto_dal timestamptz, codice_scade timestamptz, ruolo_staff text,
               prenotazioni int, frequentate int, prossime int, ultima timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  return query
  select i.id, i.user_id, coalesce(p.nome, i.nome), coalesce(p.telefono, i.telefono), i.email,
         case when not i.attivo then 'sospeso'
              when i.user_id is not null then 'attivo'
              when i.codice_scade is null or i.codice_scade <= now() then 'codice scaduto'
              else 'da attivare' end,
         i.attivo, i.note, i.created_at, i.codice_scade, coalesce(s.ruolo, i.ruolo_staff),
         (count(b.*) filter (where b.stato <> 'annullata'))::int,
         (count(b.*) filter (where b.stato = 'confermata' and l.fine <= now()))::int,
         (count(b.*) filter (where b.stato <> 'annullata' and l.inizio > now()))::int,
         max(l.inizio) filter (where b.stato <> 'annullata')
  from public.iscritti i
  left join public.profili p on p.user_id = i.user_id
  left join public.staff s on s.user_id = i.user_id
  left join public.prenotazioni b on b.member_id = i.user_id and i.user_id is not null
  left join public.lezioni l on l.id = b.lezione_id
  group by i.id, p.user_id, s.user_id
  order by coalesce(p.nome, i.nome);
end $$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.admin_crea_iscritto(text,text,text,text) from public, anon;
revoke all on function public.admin_imposta_staff(uuid,text) from public, anon;
revoke all on function public.admin_reimposta_accesso(uuid) from public, anon;
revoke all on function public.admin_iscritti() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_crea_iscritto(text,text,text,text) to authenticated;
grant execute on function public.admin_imposta_staff(uuid,text) to authenticated;
grant execute on function public.admin_reimposta_accesso(uuid) to authenticated;
grant execute on function public.admin_iscritti() to authenticated;

-- l'admin esistente è un collaboratore anche nell'anagrafica
update public.iscritti i set ruolo_staff = s.ruolo from public.staff s where s.user_id = i.user_id and i.ruolo_staff is null;
