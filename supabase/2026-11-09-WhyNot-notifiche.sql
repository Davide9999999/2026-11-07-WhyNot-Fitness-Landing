-- =====================================================================
-- WHY NOT - notifiche push dell'app e settimane future (eseguire DOPO 2026-11-09-WhyNot-app-staff.sql). Si può rieseguire.
-- Notifiche (solo a chi le ha attivate nell'app, ognuna disattivabile):
--   * promemoria prima della lezione (30 min / 1 h / 2 h / 4 h / 1 giorno)
--   * posto confermato dalla lista d'attesa
--   * lezione annullata dalla palestra
--   * avvisi della palestra inviati dall'admin
-- Invio: il Worker Cloudflare (cron ogni minuto) legge la coda con push_da_inviare(segreto) e spedisce le notifiche Web Push.
-- Il segreto del Worker è salvato qui solo come hash SHA-256.
-- =====================================================================

-- ---------- tabelle ----------
create table if not exists public.push_iscrizioni (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh     text not null check (char_length(p256dh) <= 200),
  auth       text not null check (char_length(auth) <= 100),
  dispositivo text check (dispositivo is null or char_length(dispositivo) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists push_iscrizioni_user_idx on public.push_iscrizioni (user_id);

create table if not exists public.notifiche_pref (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  promemoria_min int not null default 120 check (promemoria_min in (0, 30, 60, 120, 240, 1440)),
  lista          boolean not null default true,
  annullate      boolean not null default true,
  avvisi         boolean not null default true,
  updated_at     timestamptz not null default now()
);

create table if not exists public.notifiche_coda (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references auth.users(id) on delete cascade,
  tipo     text not null check (tipo in ('promemoria','lista','annullata','avviso','prova')),
  titolo   text not null check (char_length(titolo) <= 120),
  testo    text not null check (char_length(testo) <= 400),
  url      text not null default './',
  creato   timestamptz not null default now(),
  inviato  timestamptz
);
create index if not exists notifiche_coda_attesa_idx on public.notifiche_coda (creato) where inviato is null;

create table if not exists public.config_privata (chiave text primary key, valore text not null);

alter table public.prenotazioni add column if not exists promemoria_inviato boolean not null default false;

alter table public.push_iscrizioni enable row level security;
alter table public.notifiche_pref  enable row level security;
alter table public.notifiche_coda  enable row level security;
alter table public.config_privata  enable row level security;   -- nessuna policy: nessuno la legge via API
revoke all on table public.push_iscrizioni, public.notifiche_pref, public.notifiche_coda, public.config_privata from anon, authenticated;

-- hash del segreto condiviso con il Worker (il segreto vero è solo nel Worker come PUSH_SECRET)
insert into public.config_privata (chiave, valore)
values ('push_segreto_sha256', '7c768c2b96960341c0c589348255404fb11cea18d9448579db54262e6cbe8be8')
on conflict (chiave) do update set valore = excluded.valore;

create or replace function public._push_ok(p_segreto text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.config_privata
                  where chiave = 'push_segreto_sha256'
                    and valore = encode(sha256(convert_to(coalesce(p_segreto, ''), 'UTF8')), 'hex'));
$$;

-- ---------- accodamento ----------
create or replace function public._accoda(p_user uuid, p_tipo text, p_titolo text, p_testo text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.notifiche_pref%rowtype;
begin
  if p_user is null then return; end if;
  if not exists (select 1 from public.push_iscrizioni where user_id = p_user) then return; end if;   -- notifiche non attive
  select * into v from public.notifiche_pref where user_id = p_user;
  if found and ((p_tipo = 'lista' and not v.lista) or (p_tipo = 'annullata' and not v.annullate) or (p_tipo = 'avviso' and not v.avvisi)) then return; end if;
  insert into public.notifiche_coda (user_id, tipo, titolo, testo, url) values (p_user, p_tipo, left(p_titolo, 120), left(p_testo, 400), './');
end $$;

create or replace function public._quando(p timestamptz)
returns text language sql stable set search_path = public as $$
  select (array['lunedì','martedì','mercoledì','giovedì','venerdì','sabato','domenica'])[extract(isodow from p at time zone 'Europe/Rome')::int]
         || ' ' || to_char(p at time zone 'Europe/Rome', 'DD/MM "alle" HH24:MI');
$$;

-- posto confermato dalla lista d'attesa
create or replace function public.notifica_prenotazione()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_c text; v_i timestamptz;
begin
  if old.stato = 'attesa' and new.stato = 'confermata' and new.member_id is not null then
    select c.nome, l.inizio into v_c, v_i from public.lezioni l join public.corsi c on c.id = l.corso_id where l.id = new.lezione_id;
    if v_i > now() then
      perform public._accoda(new.member_id, 'lista', 'Posto confermato!', format('%s, %s: si è liberato un posto e ora sei tra i confermati.', v_c, public._quando(v_i)));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_notifica_prenotazione on public.prenotazioni;
create trigger trg_notifica_prenotazione after update of stato on public.prenotazioni
  for each row execute function public.notifica_prenotazione();

-- lezione annullata dalla palestra
create or replace function public.notifica_lezione_annullata()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_c text; r record;
begin
  if new.stato = 'annullata' and old.stato <> 'annullata' and new.inizio > now() then
    select nome into v_c from public.corsi where id = new.corso_id;
    for r in select distinct member_id from public.prenotazioni where lezione_id = new.id and stato <> 'annullata' and member_id is not null loop
      perform public._accoda(r.member_id, 'annullata', 'Lezione annullata', format('%s di %s è stata annullata. Ci scusiamo per il disagio.', v_c, public._quando(new.inizio)));
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_notifica_lezione on public.lezioni;
create trigger trg_notifica_lezione after update of stato on public.lezioni
  for each row execute function public.notifica_lezione_annullata();

-- promemoria (chiamato dal Worker a ogni giro)
create or replace function public._accoda_promemoria()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in
    select p.id, p.member_id, c.nome corso, l.inizio, l.sala
    from public.prenotazioni p
    join public.lezioni l on l.id = p.lezione_id
    join public.corsi c on c.id = l.corso_id
    left join public.notifiche_pref f on f.user_id = p.member_id
    where p.stato = 'confermata' and not p.promemoria_inviato and p.member_id is not null
      and l.stato = 'programmata' and l.inizio > now()
      and coalesce(f.promemoria_min, 120) > 0
      and l.inizio <= now() + make_interval(mins => coalesce(f.promemoria_min, 120))
      and p.created_at <= l.inizio - make_interval(mins => coalesce(f.promemoria_min, 120))   -- chi prenota a ridosso non riceve un promemoria inutile
      and exists (select 1 from public.push_iscrizioni s where s.user_id = p.member_id)
  loop
    perform public._accoda(r.member_id, 'promemoria', 'Promemoria lezione',
      format('%s %s in %s. Ti aspettiamo!', r.corso, public._quando(r.inizio), r.sala));
    update public.prenotazioni set promemoria_inviato = true where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- per il Worker ----------
create or replace function public.push_da_inviare(p_segreto text, p_max int default 200)
returns table (coda_id bigint, endpoint text, p256dh text, auth text, titolo text, testo text, url text, tipo text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_ids bigint[];
begin
  if not public._push_ok(p_segreto) then raise exception 'Non autorizzato' using errcode = '42501'; end if;
  perform public._accoda_promemoria();
  delete from public.notifiche_coda where creato < now() - interval '30 days';
  -- le notifiche più vecchie di 6 ore non si mandano più (es. Worker fermo)
  update public.notifiche_coda set inviato = now() where inviato is null and creato < now() - interval '6 hours';
  select array_agg(id) into v_ids from (select id from public.notifiche_coda where inviato is null order by creato limit greatest(1, least(p_max, 500)) for update skip locked) x;
  if v_ids is null then return; end if;
  update public.notifiche_coda set inviato = now() where id = any(v_ids);
  return query
  select c.id, s.endpoint, s.p256dh, s.auth, c.titolo, c.testo, c.url, c.tipo
  from public.notifiche_coda c join public.push_iscrizioni s on s.user_id = c.user_id
  where c.id = any(v_ids);
end $$;

-- iscrizioni non più valide (il servizio push ha risposto 404/410)
create or replace function public.push_scadute(p_segreto text, p_endpoint text[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public._push_ok(p_segreto) then raise exception 'Non autorizzato' using errcode = '42501'; end if;
  delete from public.push_iscrizioni where endpoint = any(coalesce(p_endpoint, '{}'));
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- per l'iscritto ----------
create or replace function public.salva_push(p_endpoint text, p_p256dh text, p_auth text, p_dispositivo text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  if (select count(*) from public.push_iscrizioni where user_id = auth.uid()) >= 10 then
    delete from public.push_iscrizioni where id = (select id from public.push_iscrizioni where user_id = auth.uid() order by created_at limit 1);
  end if;
  insert into public.push_iscrizioni (user_id, endpoint, p256dh, auth, dispositivo)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_dispositivo, 200))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, dispositivo = excluded.dispositivo;
  insert into public.notifiche_pref (user_id) values (auth.uid()) on conflict (user_id) do nothing;
end $$;

create or replace function public.rimuovi_push(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_iscrizioni where endpoint = p_endpoint and user_id = auth.uid();
$$;

create or replace function public.mie_notifiche()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'promemoria_min', coalesce(f.promemoria_min, 120), 'lista', coalesce(f.lista, true),
    'annullate', coalesce(f.annullate, true), 'avvisi', coalesce(f.avvisi, true),
    'dispositivi', (select count(*) from public.push_iscrizioni s where s.user_id = auth.uid()))
  from (select 1) x left join public.notifiche_pref f on f.user_id = auth.uid()
  where auth.uid() is not null;
$$;

create or replace function public.salva_notifiche(p_promemoria_min int, p_lista boolean, p_annullate boolean, p_avvisi boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  insert into public.notifiche_pref (user_id, promemoria_min, lista, annullate, avvisi, updated_at)
  values (auth.uid(), p_promemoria_min, p_lista, p_annullate, p_avvisi, now())
  on conflict (user_id) do update set promemoria_min = excluded.promemoria_min, lista = excluded.lista,
    annullate = excluded.annullate, avvisi = excluded.avvisi, updated_at = now();
end $$;

create or replace function public.push_prova()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  if not exists (select 1 from public.push_iscrizioni where user_id = auth.uid()) then raise exception 'Attiva prima le notifiche su questo dispositivo'; end if;
  if exists (select 1 from public.notifiche_coda where user_id = auth.uid() and tipo = 'prova' and creato > now() - interval '1 minute') then
    raise exception 'Hai già chiesto una prova: attendi un minuto';
  end if;
  insert into public.notifiche_coda (user_id, tipo, titolo, testo) values (auth.uid(), 'prova', 'Notifiche attive', 'Riceverai qui promemoria e avvisi di WHY NOT Fitness Club.');
end $$;

-- ---------- per lo staff: avviso a tutti ----------
create or replace function public.admin_invia_avviso(p_titolo text, p_testo text)
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  if char_length(trim(coalesce(p_titolo, ''))) < 3 or char_length(trim(coalesce(p_testo, ''))) < 3 then raise exception 'Scrivi titolo e testo'; end if;
  if char_length(p_titolo) > 120 or char_length(p_testo) > 400 then raise exception 'Titolo max 120 caratteri, testo max 400'; end if;
  for r in select distinct i.user_id from public.iscritti i join public.push_iscrizioni s on s.user_id = i.user_id where i.attivo loop
    perform public._accoda(r.user_id, 'avviso', trim(p_titolo), trim(p_testo));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.admin_stato_notifiche()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  return json_build_object(
    'iscritti_con_notifiche', (select count(distinct s.user_id) from public.push_iscrizioni s join public.iscritti i on i.user_id = s.user_id where i.attivo),
    'in_coda', (select count(*) from public.notifiche_coda where inviato is null),
    'ultimo_invio', (select max(inviato) from public.notifiche_coda));
end $$;

-- =====================================================================
-- Settimane future: lezioni pubblicate da lunedì di questa settimana fino a 5 settimane avanti
-- e orario previsto dal palinsesto per le settimane non ancora generate.
-- =====================================================================
create or replace function public.lezioni_periodo(p_da date, p_a date)
returns table (id bigint, corso text, slug text, categoria text, sala text, inizio timestamptz, fine timestamptz,
               capienza int, posti_liberi int, in_attesa int, stato text, prenotazione_obbligatoria boolean, prenotabile boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_s record; v_min date; v_max date;
begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  select * into v_s from public.settimana_corrente();
  v_min := (v_s.da at time zone 'Europe/Rome')::date;
  v_max := v_min + 41;                                     -- 6 settimane in tutto
  p_da := greatest(p_da, v_min); p_a := least(p_a, v_max);
  return query
  select l.id, c.nome, c.slug, c.categoria, l.sala, l.inizio, l.fine, l.capienza,
         greatest(l.capienza - count(p.*) filter (where p.stato = 'confermata'), 0)::int,
         (count(p.*) filter (where p.stato = 'attesa'))::int,
         l.stato, c.prenotazione_obbligatoria,
         (l.inizio >= v_s.da and l.inizio < v_s.a and l.inizio > now() and l.stato <> 'annullata')
  from public.lezioni l
  join public.corsi c on c.id = l.corso_id
  left join public.prenotazioni p on p.lezione_id = l.id
  where l.pubblicata
    and l.inizio >= (p_da::timestamp at time zone 'Europe/Rome')
    and l.inizio <  ((p_a + 1)::timestamp at time zone 'Europe/Rome')
  group by l.id, c.id
  order by l.inizio, c.nome;
end $$;

create or replace function public.palinsesto_pubblico()
returns table (giorno smallint, ora_inizio time, ora_fine time, corso text, slug text, categoria text, sala text)
language sql stable security definer set search_path = public as $$
  select p.giorno, p.ora_inizio, p.ora_fine, c.nome, c.slug, c.categoria, coalesce(p.sala, c.sala)
  from public.palinsesto p join public.corsi c on c.id = p.corso_id
  where p.attivo and c.attivo and auth.uid() is not null
  order by p.giorno, p.ora_inizio;
$$;

-- ---------- permessi ----------
revoke all on function public._push_ok(text) from public, anon, authenticated;
revoke all on function public._accoda(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public._quando(timestamptz) from public, anon, authenticated;
revoke all on function public._accoda_promemoria() from public, anon, authenticated;
revoke all on function public.notifica_prenotazione() from public, anon, authenticated;
revoke all on function public.notifica_lezione_annullata() from public, anon, authenticated;
revoke all on function public.push_da_inviare(text,int) from public;
revoke all on function public.push_scadute(text,text[]) from public;
grant execute on function public.push_da_inviare(text,int) to anon, authenticated;   -- protette dal segreto
grant execute on function public.push_scadute(text,text[]) to anon, authenticated;
revoke all on function public.salva_push(text,text,text,text) from public, anon;
revoke all on function public.rimuovi_push(text) from public, anon;
revoke all on function public.mie_notifiche() from public, anon;
revoke all on function public.salva_notifiche(int,boolean,boolean,boolean) from public, anon;
revoke all on function public.push_prova() from public, anon;
revoke all on function public.admin_invia_avviso(text,text) from public, anon;
revoke all on function public.admin_stato_notifiche() from public, anon;
revoke all on function public.lezioni_periodo(date,date) from public, anon;
revoke all on function public.palinsesto_pubblico() from public, anon;
grant execute on function public.salva_push(text,text,text,text) to authenticated;
grant execute on function public.rimuovi_push(text) to authenticated;
grant execute on function public.mie_notifiche() to authenticated;
grant execute on function public.salva_notifiche(int,boolean,boolean,boolean) to authenticated;
grant execute on function public.push_prova() to authenticated;
grant execute on function public.admin_invia_avviso(text,text) to authenticated;
grant execute on function public.admin_stato_notifiche() to authenticated;
grant execute on function public.lezioni_periodo(date,date) to authenticated;
grant execute on function public.palinsesto_pubblico() to authenticated;
