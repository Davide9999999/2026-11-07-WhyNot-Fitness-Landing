-- =====================================================================
-- WHY NOT - account iscritti (area personale) - eseguire DOPO schema, seed e hardening. Si può rieseguire.
-- Cosa aggiunge:
--   * tabella profili (nome e telefono dell'iscritto, legata all'account Supabase Auth)
--   * creazione automatica del profilo alla registrazione (dati passati in user_metadata)
--   * prenota_lezione(): se l'utente è loggato collega la prenotazione al suo account (member_id)
--   * funzioni per l'iscritto: mio_profilo, salva_profilo, mie_prenotazioni, annulla_mia_prenotazione
--   * funzione per lo staff: admin_iscritti
-- Sicurezza: l'iscritto vede e modifica SOLO i propri dati e le prenotazioni fatte col proprio account.
-- Le prenotazioni anonime fatte con la stessa email NON vengono collegate automaticamente
-- (finché la conferma email è disattivata, chiunque potrebbe registrarsi con l'email di un altro).
-- =====================================================================

create table if not exists public.profili (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  nome             text not null check (char_length(nome) between 2 and 80),
  telefono         text check (telefono is null or char_length(telefono) <= 30),
  consenso_privacy boolean not null default false,
  consenso_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.profili enable row level security;
revoke all on table public.profili from anon;
revoke insert, update, delete, truncate, references, trigger on table public.profili from authenticated;
grant select on table public.profili to authenticated;

drop policy if exists profili_select on public.profili;
create policy profili_select on public.profili for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

create index if not exists prenotazioni_member_idx on public.prenotazioni (member_id) where member_id is not null;

-- ---------- profilo creato alla registrazione (signUp con options.data = {nome, telefono, consenso}) ----------
create or replace function public.crea_profilo_da_registrazione()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_nome text := left(trim(coalesce(new.raw_user_meta_data->>'nome', '')), 80);
  v_tel  text := left(nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'telefono', ''), '[^0-9+]', '', 'g'), ''), 30);
  v_ok   boolean := coalesce(new.raw_user_meta_data->>'consenso', '') = 'true';
begin
  -- gli account staff creati dalla dashboard non hanno questi dati: nessun profilo, nessun errore
  if char_length(v_nome) >= 2 and v_ok then
    insert into public.profili (user_id, nome, telefono, consenso_privacy, consenso_at)
    values (new.id, v_nome, v_tel, true, now())
    on conflict (user_id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists trg_crea_profilo on auth.users;
create trigger trg_crea_profilo after insert on auth.users
  for each row execute function public.crea_profilo_da_registrazione();

-- ---------- funzioni dell'iscritto ----------
create or replace function public.mio_profilo()
returns json language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then null else (
    select json_build_object(
      'nome', p.nome, 'telefono', p.telefono, 'email', u.email,
      'consenso_privacy', coalesce(p.consenso_privacy, false),
      'iscritto_dal', u.created_at, 'profilo', p.user_id is not null)
    from auth.users u left join public.profili p on p.user_id = u.id
    where u.id = auth.uid()) end;
$$;

create or replace function public.salva_profilo(p_nome text, p_telefono text, p_consenso boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_nome text := trim(coalesce(p_nome, ''));
  v_tel  text := nullif(regexp_replace(coalesce(p_telefono, ''), '[^0-9+]', '', 'g'), '');
begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  if char_length(v_nome) < 2 or char_length(v_nome) > 80 then raise exception 'Inserisci nome e cognome'; end if;
  if v_tel is not null and char_length(v_tel) > 30 then raise exception 'Telefono non valido'; end if;
  if not coalesce(p_consenso, false)
     and not exists (select 1 from public.profili where user_id = auth.uid() and consenso_privacy) then
    raise exception 'Serve il consenso al trattamento dei dati';
  end if;
  insert into public.profili (user_id, nome, telefono, consenso_privacy, consenso_at)
  values (auth.uid(), v_nome, v_tel, true, now())
  on conflict (user_id) do update set nome = excluded.nome, telefono = excluded.telefono, updated_at = now();
  return public.mio_profilo();
end $$;

create or replace function public.mie_prenotazioni()
returns table (id uuid, lezione_id bigint, corso text, slug text, categoria text, sala text,
               inizio timestamptz, fine timestamptz, stato text, lezione_stato text,
               posizione_attesa int, note text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, l.id, c.nome, c.slug, c.categoria, l.sala, l.inizio, l.fine, p.stato, l.stato,
         case when p.stato = 'attesa' then
           (select count(*) from public.prenotazioni q
             where q.lezione_id = p.lezione_id and q.stato = 'attesa' and q.created_at <= p.created_at)::int end,
         p.note, p.created_at
  from public.prenotazioni p
  join public.lezioni l on l.id = p.lezione_id
  join public.corsi c on c.id = l.corso_id
  where auth.uid() is not null and p.member_id = auth.uid()
  order by l.inizio desc
  limit 500;
$$;

create or replace function public.annulla_mia_prenotazione(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  update public.prenotazioni p set stato = 'annullata'
   where p.id = p_id and p.member_id = auth.uid() and p.stato <> 'annullata'
     and exists (select 1 from public.lezioni l where l.id = p.lezione_id and l.inizio > now());
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Prenotazione non annullabile (già annullata o lezione già iniziata)'; end if;
  return json_build_object('id', p_id, 'stato', 'annullata');
end $$;

-- ---------- prenota_lezione: collega l'account se l'utente è loggato ----------
create or replace function public.prenota_lezione(p_lezione_id bigint, p_nome text, p_telefono text, p_email text,
                                                  p_note text default null, p_consenso boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_l public.lezioni%rowtype; v_s record; v_id uuid; v_stato text; v_pos int;
  v_uid uuid := auth.uid();
  v_tel text := nullif(regexp_replace(coalesce(p_telefono,''), '[^0-9+]', '', 'g'), '');
  v_mail text := nullif(lower(trim(coalesce(p_email,''))), '');
begin
  if not coalesce(p_consenso,false) then raise exception 'Serve il consenso al trattamento dei dati'; end if;
  if char_length(trim(coalesce(p_nome,''))) < 2 then raise exception 'Inserisci nome e cognome'; end if;
  if v_tel is null and v_mail is null then raise exception 'Inserisci telefono o email'; end if;
  if v_mail is not null and v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email non valida'; end if;

  select * into v_s from public.settimana_corrente();
  select * into v_l from public.lezioni where id = p_lezione_id;
  if not found or not v_l.pubblicata then raise exception 'Lezione non disponibile'; end if;
  if v_l.stato = 'annullata' then raise exception 'La lezione è annullata'; end if;
  if v_l.inizio < v_s.da or v_l.inizio >= v_s.a then raise exception 'Si possono prenotare solo le lezioni della settimana in corso'; end if;
  if v_l.inizio <= now() then raise exception 'La lezione è già iniziata'; end if;

  if exists (select 1 from public.prenotazioni where lezione_id = p_lezione_id and stato <> 'annullata'
             and ((v_uid is not null and member_id = v_uid)
               or (v_tel is not null and telefono = v_tel) or (v_mail is not null and email = v_mail))) then
    raise exception 'Risulti già prenotato a questa lezione';
  end if;

  perform set_config('whynot.prenota_pubblica', 'on', true);   -- valido solo in questa transazione
  insert into public.prenotazioni (lezione_id, nome, telefono, email, note, origine, consenso_privacy, member_id)
  values (p_lezione_id, trim(p_nome), v_tel, v_mail, nullif(trim(coalesce(p_note,'')),''), 'sito', true, v_uid)
  returning id, stato into v_id, v_stato;
  perform set_config('whynot.prenota_pubblica', '', true);

  if v_stato = 'attesa' then
    select count(*) into v_pos from public.prenotazioni
      where lezione_id = p_lezione_id and stato = 'attesa'
        and created_at <= (select created_at from public.prenotazioni where id = v_id);
  end if;
  return json_build_object('id', v_id, 'stato', v_stato, 'posizione_attesa', v_pos);
end $$;

-- ---------- per lo staff: elenco iscritti con statistiche ----------
create or replace function public.admin_iscritti()
returns table (user_id uuid, nome text, telefono text, email text, iscritto_dal timestamptz,
               prenotazioni int, frequentate int, prossime int, ultima timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  return query
  select p.user_id, p.nome, p.telefono, u.email::text, u.created_at,
         (count(b.*) filter (where b.stato <> 'annullata'))::int,
         (count(b.*) filter (where b.stato = 'confermata' and l.fine <= now()))::int,
         (count(b.*) filter (where b.stato <> 'annullata' and l.inizio > now()))::int,
         max(l.inizio) filter (where b.stato <> 'annullata')
  from public.profili p
  join auth.users u on u.id = p.user_id
  left join public.prenotazioni b on b.member_id = p.user_id
  left join public.lezioni l on l.id = b.lezione_id
  group by p.user_id, u.id
  order by p.nome;
end $$;

-- ---------- permessi ----------
revoke all on function public.crea_profilo_da_registrazione() from public, anon, authenticated;
revoke all on function public.mio_profilo() from public, anon;
revoke all on function public.salva_profilo(text,text,boolean) from public, anon;
revoke all on function public.mie_prenotazioni() from public, anon;
revoke all on function public.annulla_mia_prenotazione(uuid) from public, anon;
revoke all on function public.admin_iscritti() from public, anon;
grant execute on function public.mio_profilo() to authenticated;
grant execute on function public.salva_profilo(text,text,boolean) to authenticated;
grant execute on function public.mie_prenotazioni() to authenticated;
grant execute on function public.annulla_mia_prenotazione(uuid) to authenticated;
grant execute on function public.admin_iscritti() to authenticated;
grant execute on function public.prenota_lezione(bigint,text,text,text,text,boolean) to anon, authenticated;
