-- =====================================================================
-- WHY NOT Fitness Club - schema Supabase (dev)
-- Eseguire UNA volta nel SQL Editor di Supabase, poi 2026-11-09-WhyNot-seed.sql
-- Fuso orario di riferimento: Europe/Rome
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- staff (chi può usare /admin) ----------
create table if not exists public.staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  ruolo      text not null default 'staff' check (ruolo in ('admin','staff')),
  nome       text,
  created_at timestamptz not null default now()
);

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;

-- ---------- corsi ----------
create table if not exists public.corsi (
  id                        bigint generated always as identity primary key,
  slug                      text not null unique,
  nome                      text not null,
  categoria                 text not null,
  sala                      text not null default 'Sala 1',
  capienza_default          int  not null default 20 check (capienza_default > 0),
  prenotazione_obbligatoria boolean not null default false,
  attivo                    boolean not null default true,
  created_at                timestamptz not null default now()
);

-- ---------- palinsesto (modello settimanale da cui generare le lezioni) ----------
create table if not exists public.palinsesto (
  id         bigint generated always as identity primary key,
  corso_id   bigint not null references public.corsi(id) on delete cascade,
  giorno     smallint not null check (giorno between 1 and 7),   -- 1 = lunedì ... 7 = domenica
  ora_inizio time not null,
  ora_fine   time not null check (ora_fine > ora_inizio),
  sala       text,
  capienza   int check (capienza > 0),
  note       text,
  attivo     boolean not null default true
);

-- ---------- lezioni (istanze reali, con data) ----------
create table if not exists public.lezioni (
  id            bigint generated always as identity primary key,
  corso_id      bigint not null references public.corsi(id) on delete restrict,
  inizio        timestamptz not null,
  fine          timestamptz not null,
  sala          text not null default 'Sala 1',
  capienza      int not null check (capienza > 0),
  istruttore    text,
  note          text,
  stato         text not null default 'programmata' check (stato in ('programmata','annullata')),
  pubblicata    boolean not null default true,
  palinsesto_id bigint references public.palinsesto(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint lezioni_fine_dopo_inizio check (fine > inizio),
  constraint lezioni_unica unique (corso_id, inizio, sala)
);
create index if not exists lezioni_inizio_idx on public.lezioni (inizio);

-- ---------- prenotazioni ----------
create table if not exists public.prenotazioni (
  id               uuid primary key default gen_random_uuid(),
  lezione_id       bigint not null references public.lezioni(id) on delete cascade,
  nome             text not null check (char_length(nome) between 2 and 80),
  telefono         text check (telefono is null or char_length(telefono) <= 30),
  email            text check (email is null or char_length(email) <= 120),
  note             text check (note is null or char_length(note) <= 500),
  stato            text not null default 'confermata' check (stato in ('confermata','attesa','annullata')),
  origine          text not null default 'sito' check (origine in ('sito','admin','ai')),
  member_id        uuid references auth.users(id) on delete set null,   -- per il futuro login iscritti
  consenso_privacy boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint prenotazioni_contatto check (telefono is not null or email is not null)
);
create index if not exists prenotazioni_lezione_idx on public.prenotazioni (lezione_id, stato, created_at);

-- ---------- schede di allenamento ----------
create table if not exists public.schede (
  id             uuid primary key default gen_random_uuid(),
  titolo         text not null check (char_length(titolo) between 2 and 120),
  obiettivo      text,
  livello        text check (livello is null or livello in ('principiante','intermedio','avanzato')),
  descrizione    text,
  contenuto      text,                                  -- testo/markdown della scheda
  stato          text not null default 'bozza' check (stato in ('bozza','pubblicata','archiviata')),
  price_cents    int not null default 0 check (price_cents >= 0),   -- per il futuro acquisto
  member_id      uuid references auth.users(id) on delete set null, -- scheda personale (futuro)
  pubblicata_il  timestamptz,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------- registro azioni confermate dall'assistente AI ----------
create table if not exists public.ai_audit (
  id         bigint generated always as identity primary key,
  user_id    uuid default auth.uid(),
  azione     text not null,
  input      jsonb not null default '{}'::jsonb,
  esito      jsonb,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- Trigger: capienza e lista d'attesa
-- =====================================================================
create or replace function public.prenotazioni_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_lezione public.lezioni%rowtype;
  v_confermate int;
begin
  -- blocca la riga della lezione per evitare overbooking con prenotazioni simultanee
  select * into v_lezione from public.lezioni where id = new.lezione_id for update;
  if not found then raise exception 'Lezione inesistente'; end if;
  if v_lezione.stato = 'annullata' then raise exception 'La lezione è annullata'; end if;

  if new.stato = 'confermata' then
    select count(*) into v_confermate from public.prenotazioni
      where lezione_id = new.lezione_id and stato = 'confermata';
    if v_confermate >= v_lezione.capienza then
      new.stato := 'attesa';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_prenotazioni_before_insert on public.prenotazioni;
create trigger trg_prenotazioni_before_insert before insert on public.prenotazioni
  for each row execute function public.prenotazioni_before_insert();

-- quando si libera un posto, il primo in lista d'attesa passa a confermato
create or replace function public.promuovi_lista_attesa(p_lezione_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_capienza int; v_confermate int; v_id uuid;
begin
  select capienza into v_capienza from public.lezioni where id = p_lezione_id for update;
  loop
    select count(*) into v_confermate from public.prenotazioni where lezione_id = p_lezione_id and stato = 'confermata';
    exit when v_confermate >= v_capienza;
    select id into v_id from public.prenotazioni
      where lezione_id = p_lezione_id and stato = 'attesa' order by created_at limit 1;
    exit when v_id is null;
    update public.prenotazioni set stato = 'confermata', updated_at = now() where id = v_id;
  end loop;
end $$;

create or replace function public.prenotazioni_after_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.stato = 'confermata' and new.stato <> 'confermata' then
    perform public.promuovi_lista_attesa(new.lezione_id);
  end if;
  return new;
end $$;

drop trigger if exists trg_prenotazioni_after_update on public.prenotazioni;
create trigger trg_prenotazioni_after_update after update of stato on public.prenotazioni
  for each row execute function public.prenotazioni_after_update();

-- se aumenta la capienza di una lezione, promuove chi è in attesa
create or replace function public.lezioni_after_update_capienza()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.capienza > old.capienza then perform public.promuovi_lista_attesa(new.id); end if;
  return new;
end $$;

drop trigger if exists trg_lezioni_capienza on public.lezioni;
create trigger trg_lezioni_capienza after update of capienza on public.lezioni
  for each row execute function public.lezioni_after_update_capienza();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_schede_touch on public.schede;
create trigger trg_schede_touch before update on public.schede for each row execute function public.touch_updated_at();
drop trigger if exists trg_prenotazioni_touch on public.prenotazioni;
create trigger trg_prenotazioni_touch before update on public.prenotazioni for each row execute function public.touch_updated_at();

-- =====================================================================
-- Funzioni pubbliche (pagina /prenota/, utente anonimo)
-- =====================================================================

-- lunedì e domenica della settimana corrente (ora italiana)
create or replace function public.settimana_corrente(out da timestamptz, out a timestamptz)
language sql stable as $$
  select (date_trunc('week', (now() at time zone 'Europe/Rome')) at time zone 'Europe/Rome'),
         ((date_trunc('week', (now() at time zone 'Europe/Rome')) + interval '7 days') at time zone 'Europe/Rome');
$$;

-- lezioni pubblicate della settimana corrente, con posti liberi (nessun dato personale)
create or replace function public.lezioni_settimana()
returns table (id bigint, corso text, slug text, categoria text, sala text, inizio timestamptz, fine timestamptz,
               capienza int, posti_liberi int, in_attesa int, stato text, prenotazione_obbligatoria boolean)
language sql stable security definer set search_path = public as $$
  select l.id, c.nome, c.slug, c.categoria, l.sala, l.inizio, l.fine, l.capienza,
         greatest(l.capienza - count(p.*) filter (where p.stato = 'confermata'), 0)::int,
         (count(p.*) filter (where p.stato = 'attesa'))::int,
         l.stato, c.prenotazione_obbligatoria
  from public.lezioni l
  join public.corsi c on c.id = l.corso_id
  left join public.prenotazioni p on p.lezione_id = l.id
  cross join public.settimana_corrente() s
  where l.pubblicata and l.inizio >= s.da and l.inizio < s.a
  group by l.id, c.id
  order by l.inizio, c.nome;
$$;

-- prenotazione dal sito: solo lezioni pubblicate, della settimana corrente, non iniziate, non annullate
create or replace function public.prenota_lezione(p_lezione_id bigint, p_nome text, p_telefono text, p_email text,
                                                  p_note text default null, p_consenso boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_l public.lezioni%rowtype; v_s record; v_id uuid; v_stato text; v_pos int;
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
             and ((v_tel is not null and telefono = v_tel) or (v_mail is not null and email = v_mail))) then
    raise exception 'Risulti già prenotato a questa lezione';
  end if;

  insert into public.prenotazioni (lezione_id, nome, telefono, email, note, origine, consenso_privacy)
  values (p_lezione_id, trim(p_nome), v_tel, v_mail, nullif(trim(coalesce(p_note,'')),''), 'sito', true)
  returning id, stato into v_id, v_stato;

  if v_stato = 'attesa' then
    select count(*) into v_pos from public.prenotazioni
      where lezione_id = p_lezione_id and stato = 'attesa'
        and created_at <= (select created_at from public.prenotazioni where id = v_id);
  end if;
  return json_build_object('id', v_id, 'stato', v_stato, 'posizione_attesa', v_pos);
end $$;

-- =====================================================================
-- Funzioni per lo staff (/admin e assistente AI)
-- =====================================================================
create or replace function public.admin_lezioni(p_da date, p_a date)
returns table (id bigint, corso_id bigint, corso text, categoria text, sala text, inizio timestamptz, fine timestamptz,
               capienza int, confermate int, attesa int, stato text, pubblicata boolean, istruttore text, note text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  return query
  select l.id, c.id, c.nome, c.categoria, l.sala, l.inizio, l.fine, l.capienza,
         (count(p.*) filter (where p.stato = 'confermata'))::int,
         (count(p.*) filter (where p.stato = 'attesa'))::int,
         l.stato, l.pubblicata, l.istruttore, l.note
  from public.lezioni l
  join public.corsi c on c.id = l.corso_id
  left join public.prenotazioni p on p.lezione_id = l.id
  where l.inizio >= (p_da::timestamp at time zone 'Europe/Rome')
    and l.inizio <  ((p_a + 1)::timestamp at time zone 'Europe/Rome')
  group by l.id, c.id
  order by l.inizio;
end $$;

-- genera le lezioni di una settimana dal palinsesto (ignora quelle già presenti)
create or replace function public.genera_settimana(p_lunedi date)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  if extract(isodow from p_lunedi) <> 1 then raise exception 'La data deve essere un lunedì'; end if;
  insert into public.lezioni (corso_id, inizio, fine, sala, capienza, note, palinsesto_id)
  select p.corso_id,
         ((p_lunedi + (p.giorno - 1)) + p.ora_inizio) at time zone 'Europe/Rome',
         ((p_lunedi + (p.giorno - 1)) + p.ora_fine)   at time zone 'Europe/Rome',
         coalesce(p.sala, c.sala), coalesce(p.capienza, c.capienza_default), p.note, p.id
  from public.palinsesto p join public.corsi c on c.id = p.corso_id
  where p.attivo and c.attivo
  on conflict (corso_id, inizio, sala) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.staff        enable row level security;
alter table public.corsi        enable row level security;
alter table public.palinsesto   enable row level security;
alter table public.lezioni      enable row level security;
alter table public.prenotazioni enable row level security;
alter table public.schede       enable row level security;
alter table public.ai_audit     enable row level security;

-- staff: ognuno vede la propria riga, gli admin gestiscono tutto
drop policy if exists staff_self on public.staff;
create policy staff_self on public.staff for select to authenticated using (user_id = auth.uid() or public.is_staff());

-- corsi: lettura pubblica dei corsi attivi, scrittura solo staff
drop policy if exists corsi_read on public.corsi;
create policy corsi_read on public.corsi for select to anon, authenticated using (attivo or public.is_staff());
drop policy if exists corsi_staff on public.corsi;
create policy corsi_staff on public.corsi for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- palinsesto, lezioni, prenotazioni, schede, audit: solo staff (il pubblico passa dalle funzioni sopra)
drop policy if exists palinsesto_staff on public.palinsesto;
create policy palinsesto_staff on public.palinsesto for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists lezioni_staff on public.lezioni;
create policy lezioni_staff on public.lezioni for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists prenotazioni_staff on public.prenotazioni;
create policy prenotazioni_staff on public.prenotazioni for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists schede_staff on public.schede;
create policy schede_staff on public.schede for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists ai_audit_staff on public.ai_audit;
create policy ai_audit_staff on public.ai_audit for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- permessi sulle funzioni
revoke all on function public.prenota_lezione(bigint,text,text,text,text,boolean) from public;
grant execute on function public.lezioni_settimana() to anon, authenticated;
grant execute on function public.prenota_lezione(bigint,text,text,text,text,boolean) to anon, authenticated;
revoke all on function public.admin_lezioni(date,date) from public, anon;
grant execute on function public.admin_lezioni(date,date) to authenticated;
revoke all on function public.genera_settimana(date) from public, anon;
grant execute on function public.genera_settimana(date) to authenticated;
revoke all on function public.promuovi_lista_attesa(bigint) from public, anon, authenticated;
