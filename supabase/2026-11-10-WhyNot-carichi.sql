-- =====================================================================
-- WHY NOT - registro dei carichi dell'iscritto (eseguire DOPO 2026-11-10-WhyNot-esercizi.sql). Si può rieseguire.
-- Ogni serie spuntata in modalità allenamento: kg e ripetizioni fatte, per data. L'iscritto vede e scrive solo i suoi; lo staff legge.
-- =====================================================================
create table if not exists public.registro_carichi (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  scheda_id     uuid references public.schede(id) on delete set null,
  giorno        smallint not null default 0,
  esercizio_idx smallint not null default 0,
  esercizio_id  bigint references public.esercizi(id) on delete set null,
  esercizio     text not null check (char_length(esercizio) <= 80),
  data          date not null default ((now() at time zone 'Europe/Rome')::date),
  serie         smallint not null check (serie between 1 and 30),
  kg            numeric(6,2) check (kg is null or (kg >= 0 and kg <= 1000)),
  rip           smallint check (rip is null or (rip >= 0 and rip <= 500)),
  created_at    timestamptz not null default now(),
  constraint registro_carichi_unica unique nulls not distinct (user_id, scheda_id, giorno, esercizio_idx, data, serie)
);
create index if not exists registro_carichi_user_idx on public.registro_carichi (user_id, data desc);
alter table public.registro_carichi enable row level security;
revoke all on table public.registro_carichi from anon, authenticated;
grant select on table public.registro_carichi to authenticated;
drop policy if exists carichi_read on public.registro_carichi;
create policy carichi_read on public.registro_carichi for select to authenticated using (user_id = auth.uid() or public.is_staff());

-- salva (o aggiorna) una serie di oggi
create or replace function public.salva_carico(p_scheda_id uuid, p_giorno int, p_idx int, p_esercizio_id bigint, p_esercizio text,
                                               p_serie int, p_kg numeric, p_rip int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  if p_kg is not null and (p_kg < 0 or p_kg > 1000) then raise exception 'Carico non valido'; end if;
  if p_rip is not null and (p_rip < 0 or p_rip > 500) then raise exception 'Ripetizioni non valide'; end if;
  insert into public.registro_carichi (user_id, scheda_id, giorno, esercizio_idx, esercizio_id, esercizio, serie, kg, rip)
  values (auth.uid(), p_scheda_id, coalesce(p_giorno, 0), coalesce(p_idx, 0), p_esercizio_id, left(coalesce(p_esercizio, 'Esercizio'), 80), p_serie, p_kg, p_rip)
  on conflict (user_id, scheda_id, giorno, esercizio_idx, data, serie)
  do update set kg = excluded.kg, rip = excluded.rip, esercizio_id = excluded.esercizio_id, esercizio = excluded.esercizio, created_at = now();
end $$;

-- toglie una serie di oggi (quando l'iscritto toglie la spunta)
create or replace function public.togli_carico(p_scheda_id uuid, p_giorno int, p_idx int, p_serie int)
returns void language sql security definer set search_path = public as $$
  delete from public.registro_carichi
   where user_id = auth.uid() and scheda_id is not distinct from p_scheda_id and giorno = p_giorno and esercizio_idx = p_idx
     and serie = p_serie and data = (now() at time zone 'Europe/Rome')::date;
$$;

-- storico dell'iscritto (ultimi 12 mesi)
create or replace function public.miei_carichi()
returns table (scheda_id uuid, giorno smallint, esercizio_idx smallint, esercizio_id bigint, esercizio text, data date, serie smallint, kg numeric, rip smallint)
language sql stable security definer set search_path = public as $$
  select r.scheda_id, r.giorno, r.esercizio_idx, r.esercizio_id, r.esercizio, r.data, r.serie, r.kg, r.rip
  from public.registro_carichi r
  where r.user_id = auth.uid() and r.data > (now() at time zone 'Europe/Rome')::date - 366
  order by r.data desc, r.esercizio, r.serie
  limit 3000;
$$;

-- per lo staff: carichi di un iscritto
create or replace function public.admin_carichi(p_user uuid, p_giorni int default 90)
returns table (data date, esercizio text, serie smallint, kg numeric, rip smallint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  return query select r.data, r.esercizio, r.serie, r.kg, r.rip from public.registro_carichi r
    where r.user_id = p_user and r.data > (now() at time zone 'Europe/Rome')::date - p_giorni
    order by r.data desc, r.esercizio, r.serie limit 1000;
end $$;

revoke all on function public.salva_carico(uuid,int,int,bigint,text,int,numeric,int) from public, anon;
revoke all on function public.togli_carico(uuid,int,int,int) from public, anon;
revoke all on function public.miei_carichi() from public, anon;
revoke all on function public.admin_carichi(uuid,int) from public, anon;
grant execute on function public.salva_carico(uuid,int,int,bigint,text,int,numeric,int) to authenticated;
grant execute on function public.togli_carico(uuid,int,int,int) to authenticated;
grant execute on function public.miei_carichi() to authenticated;
grant execute on function public.admin_carichi(uuid,int) to authenticated;
