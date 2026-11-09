-- =====================================================================
-- WHY NOT - App riservata agli iscritti (eseguire DOPO 2026-11-09-WhyNot-iscritti.sql). Si può rieseguire.
-- Regole:
--   * l'anagrafica iscritti la crea lo staff dall'admin; il sistema genera un CODICE DI ATTIVAZIONE (8 caratteri, 30 giorni)
--   * un account Supabase si può creare SOLO con email + codice validi di un iscritto attivo: altrimenti il database lo rifiuta
--     (vale anche per gli account staff: prima si crea l'iscritto, poi lo si promuove a staff)
--   * prenotano solo gli iscritti attivi con account collegato; i dati della prenotazione vengono dal profilo
--   * l'utente anonimo non vede più le lezioni e non può prenotare
-- =====================================================================

-- ---------- anagrafica iscritti ----------
create table if not exists public.iscritti (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null check (char_length(nome) between 2 and 80),
  telefono     text check (telefono is null or char_length(telefono) <= 30),
  email        text not null unique check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  codice_hash  text,
  codice_scade timestamptz,
  user_id      uuid unique references auth.users(id) on delete set null,
  attivo       boolean not null default true,
  note         text check (note is null or char_length(note) <= 500),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.iscritti enable row level security;
revoke all on table public.iscritti from anon;
revoke insert, update, delete, truncate, references, trigger on table public.iscritti from authenticated;
grant select on table public.iscritti to authenticated;
drop policy if exists iscritti_select on public.iscritti;
create policy iscritti_select on public.iscritti for select to authenticated using (user_id = auth.uid() or public.is_staff());

-- gli account già registrati diventano iscritti attivi (nessuno resta chiuso fuori)
insert into public.iscritti (nome, telefono, email, user_id, attivo)
select p.nome, p.telefono, lower(u.email), p.user_id, true
from public.profili p join auth.users u on u.id = p.user_id
on conflict (email) do nothing;

-- ---------- codici di attivazione (nessuna estensione: sha256 e gen_random_uuid sono nativi) ----------
create or replace function public._nuovo_codice()
returns text language plpgsql volatile set search_path = public as $$
declare
  a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';           -- senza 0/O, 1/I per evitare errori di lettura
  b bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  idx int[] := array[0,1,2,3,4,5,10,11];                  -- byte casuali (esclusi quelli di versione/variante)
  r text := ''; i int;
begin
  foreach i in array idx loop r := r || substr(a, (get_byte(b, i) % 32) + 1, 1); end loop;
  return r;
end $$;

create or replace function public._hash_codice(p text)
returns text language sql immutable set search_path = public as $$
  select encode(sha256(convert_to(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), 'UTF8')), 'hex');
$$;

-- ---------- attivazione dell'account (trigger su auth.users) ----------
create or replace function public.attivazione_controlla()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.iscritti
                  where email = lower(new.email) and user_id is null and attivo
                    and codice_hash = public._hash_codice(new.raw_user_meta_data->>'codice')
                    and codice_scade > now()) then
    raise exception 'Codice di attivazione non valido o scaduto' using errcode = 'P0001';
  end if;
  return new;
end $$;

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
  end if;
  return new;
end $$;

drop trigger if exists trg_crea_profilo on auth.users;              -- registrazione libera: non più usata
drop trigger if exists trg_attivazione_controlla on auth.users;
create trigger trg_attivazione_controlla before insert on auth.users
  for each row execute function public.attivazione_controlla();
drop trigger if exists trg_attivazione_collega on auth.users;
create trigger trg_attivazione_collega after insert on auth.users
  for each row execute function public.attivazione_collega();

-- ---------- funzioni per lo staff ----------
create or replace function public.admin_crea_iscritto(p_nome text, p_telefono text, p_email text)
returns json language plpgsql security definer set search_path = public as $$
declare v_cod text := public._nuovo_codice(); v_id uuid;
  v_mail text := lower(trim(coalesce(p_email, '')));
  v_tel text := nullif(regexp_replace(coalesce(p_telefono, ''), '[^0-9+]', '', 'g'), '');
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  if char_length(trim(coalesce(p_nome, ''))) < 2 then raise exception 'Inserisci nome e cognome'; end if;
  if v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email non valida'; end if;
  if exists (select 1 from public.iscritti where email = v_mail) then raise exception 'Esiste già un iscritto con questa email'; end if;
  insert into public.iscritti (nome, telefono, email, codice_hash, codice_scade)
  values (trim(p_nome), v_tel, v_mail, public._hash_codice(v_cod), now() + interval '30 days')
  returning id into v_id;
  return json_build_object('id', v_id, 'codice', v_cod, 'scade', now() + interval '30 days');
end $$;

create or replace function public.admin_nuovo_codice(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_cod text := public._nuovo_codice();
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  update public.iscritti set codice_hash = public._hash_codice(v_cod), codice_scade = now() + interval '30 days', updated_at = now()
   where id = p_id and user_id is null;
  if not found then raise exception 'Iscritto inesistente o account già attivato'; end if;
  return json_build_object('id', p_id, 'codice', v_cod, 'scade', now() + interval '30 days');
end $$;

create or replace function public.admin_modifica_iscritto(p_id uuid, p_nome text, p_telefono text, p_attivo boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  if char_length(trim(coalesce(p_nome, ''))) < 2 then raise exception 'Inserisci nome e cognome'; end if;
  update public.iscritti set nome = trim(p_nome),
         telefono = nullif(regexp_replace(coalesce(p_telefono, ''), '[^0-9+]', '', 'g'), ''),
         attivo = coalesce(p_attivo, attivo), note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
   where id = p_id;
  if not found then raise exception 'Iscritto inesistente'; end if;
end $$;

drop function if exists public.admin_iscritti();
create function public.admin_iscritti()
returns table (id uuid, user_id uuid, nome text, telefono text, email text, stato text, attivo boolean, note text,
               iscritto_dal timestamptz, codice_scade timestamptz, prenotazioni int, frequentate int, prossime int, ultima timestamptz)
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
         i.attivo, i.note, i.created_at, i.codice_scade,
         (count(b.*) filter (where b.stato <> 'annullata'))::int,
         (count(b.*) filter (where b.stato = 'confermata' and l.fine <= now()))::int,
         (count(b.*) filter (where b.stato <> 'annullata' and l.inizio > now()))::int,
         max(l.inizio) filter (where b.stato <> 'annullata')
  from public.iscritti i
  left join public.profili p on p.user_id = i.user_id
  left join public.prenotazioni b on b.member_id = i.user_id and i.user_id is not null
  left join public.lezioni l on l.id = b.lezione_id
  group by i.id, p.user_id
  order by coalesce(p.nome, i.nome);
end $$;

-- ---------- profilo dell'iscritto (aggiunge lo stato dell'iscrizione) ----------
create or replace function public.mio_profilo()
returns json language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then null else (
    select json_build_object(
      'nome', coalesce(p.nome, i.nome), 'telefono', coalesce(p.telefono, i.telefono), 'email', u.email,
      'consenso_privacy', coalesce(p.consenso_privacy, false), 'iscritto_dal', coalesce(i.created_at, u.created_at),
      'profilo', p.user_id is not null, 'iscritto', i.id is not null, 'attivo', coalesce(i.attivo, false),
      'staff', exists (select 1 from public.staff s where s.user_id = u.id))
    from auth.users u
    left join public.profili p on p.user_id = u.id
    left join public.iscritti i on i.user_id = u.id
    where u.id = auth.uid()) end;
$$;

-- ---------- prenotazione dall'app: solo iscritti attivi, dati presi dal profilo ----------
alter table public.prenotazioni drop constraint if exists prenotazioni_origine_check;
alter table public.prenotazioni add constraint prenotazioni_origine_check check (origine in ('sito','admin','ai','app'));

create or replace function public.prenota_iscritto(p_lezione_id bigint, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_i public.iscritti%rowtype; v_p public.profili%rowtype; v_mail text;
  v_l public.lezioni%rowtype; v_s record; v_id uuid; v_stato text; v_pos int;
begin
  if v_uid is null then raise exception 'Accedi per prenotare'; end if;
  select * into v_i from public.iscritti where user_id = v_uid;
  if not found then raise exception 'Il tuo account non è collegato a un iscritto: chiedi in reception'; end if;
  if not v_i.attivo then raise exception 'Il tuo account è sospeso: chiedi in reception'; end if;
  select * into v_p from public.profili where user_id = v_uid;
  select lower(email) into v_mail from auth.users where id = v_uid;

  select * into v_s from public.settimana_corrente();
  select * into v_l from public.lezioni where id = p_lezione_id;
  if not found or not v_l.pubblicata then raise exception 'Lezione non disponibile'; end if;
  if v_l.stato = 'annullata' then raise exception 'La lezione è annullata'; end if;
  if v_l.inizio < v_s.da or v_l.inizio >= v_s.a then raise exception 'Si possono prenotare solo le lezioni della settimana in corso'; end if;
  if v_l.inizio <= now() then raise exception 'La lezione è già iniziata'; end if;
  if exists (select 1 from public.prenotazioni where lezione_id = p_lezione_id and member_id = v_uid and stato <> 'annullata') then
    raise exception 'Sei già prenotato a questa lezione';
  end if;

  perform set_config('whynot.prenota_pubblica', 'on', true);
  insert into public.prenotazioni (lezione_id, nome, telefono, email, note, origine, consenso_privacy, member_id)
  values (p_lezione_id, coalesce(v_p.nome, v_i.nome), coalesce(v_p.telefono, v_i.telefono), v_mail,
          nullif(left(trim(coalesce(p_note, '')), 500), ''), 'app', true, v_uid)
  returning id, stato into v_id, v_stato;
  perform set_config('whynot.prenota_pubblica', '', true);

  if v_stato = 'attesa' then
    select count(*) into v_pos from public.prenotazioni
     where lezione_id = p_lezione_id and stato = 'attesa'
       and created_at <= (select created_at from public.prenotazioni where id = v_id);
  end if;
  return json_build_object('id', v_id, 'stato', v_stato, 'posizione_attesa', v_pos);
end $$;

-- la vecchia prenotazione anonima dal sito non esiste più
drop function if exists public.prenota_lezione(bigint, text, text, text, text, boolean);

-- ---------- permessi ----------
revoke all on function public._nuovo_codice() from public, anon, authenticated;
revoke all on function public._hash_codice(text) from public, anon, authenticated;
revoke all on function public.attivazione_controlla() from public, anon, authenticated;
revoke all on function public.attivazione_collega() from public, anon, authenticated;
revoke all on function public.admin_crea_iscritto(text,text,text) from public, anon;
revoke all on function public.admin_nuovo_codice(uuid) from public, anon;
revoke all on function public.admin_modifica_iscritto(uuid,text,text,boolean,text) from public, anon;
revoke all on function public.admin_iscritti() from public, anon;
revoke all on function public.prenota_iscritto(bigint,text) from public, anon;
revoke all on function public.lezioni_settimana() from public, anon;
grant execute on function public.admin_crea_iscritto(text,text,text) to authenticated;
grant execute on function public.admin_nuovo_codice(uuid) to authenticated;
grant execute on function public.admin_modifica_iscritto(uuid,text,text,boolean,text) to authenticated;
grant execute on function public.admin_iscritti() to authenticated;
grant execute on function public.prenota_iscritto(bigint,text) to authenticated;
grant execute on function public.lezioni_settimana() to authenticated;
grant execute on function public.mio_profilo() to authenticated;
