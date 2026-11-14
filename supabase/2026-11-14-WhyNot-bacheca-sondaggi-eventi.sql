-- =====================================================================
-- WHY NOT - 2026-11-14: bacheca con SONDAGGI ed EVENTI. Si può rieseguire.
-- Oltre agli avvisi di testo lo staff pubblica:
--  - sondaggi: 2-10 risposte, scelta singola o multipla, scadenza facoltativa, risultati visibili
--    dopo il voto / sempre / alla chiusura / solo allo staff, eventualmente anonimi (lo staff vede solo i totali);
--  - eventi (cene, open day, gare, uscite): data, luogo, costo/info, posti massimi, ospiti per persona,
--    termine adesioni; risposte Partecipo / Forse / Non posso con nota.
-- Ogni post può essere "in evidenza" (in cima) e rivolto a tutti o solo ai collaboratori (es. cena aziendale).
-- Le risposte stanno in avvisi_risposte, leggibili solo tramite le funzioni qui sotto.
-- L'app continua a funzionare anche prima di questo file (legge solo gli avvisi di testo).
-- =====================================================================

-- ---------- 1. colonne nuove sui post della bacheca ----------
alter table public.avvisi add column if not exists tipo        text not null default 'avviso';
alter table public.avvisi add column if not exists dati        jsonb not null default '{}'::jsonb;
alter table public.avvisi add column if not exists fissato     boolean not null default false;
alter table public.avvisi add column if not exists chiude_at   timestamptz;   -- fine voti / adesioni
alter table public.avvisi add column if not exists evento_at   timestamptz;   -- inizio evento
alter table public.avvisi add column if not exists evento_fine timestamptz;
alter table public.avvisi add column if not exists destinatari text not null default 'tutti';
do $$ begin
  alter table public.avvisi add constraint avvisi_tipo_chk check (tipo in ('avviso','sondaggio','evento'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.avvisi add constraint avvisi_dest_chk check (destinatari in ('tutti','staff'));
exception when duplicate_object then null; end $$;
-- il testo diventa facoltativo per sondaggi ed eventi (gli avvisi lo richiedono ancora, controllo nella funzione)
alter table public.avvisi drop constraint if exists avvisi_testo_check;
alter table public.avvisi add constraint avvisi_testo_check check (char_length(testo) <= 2000);

-- collaboratore = qualsiasi ruolo staff (admin, staff, istruttore): vede i post "solo staff"
create or replace function public._collaboratore()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;

-- i post "solo staff" non si leggono dalla tabella da parte degli iscritti
drop policy if exists avvisi_read on public.avvisi;
create policy avvisi_read on public.avvisi for select to authenticated using (destinatari = 'tutti' or public._collaboratore());

-- ---------- 2. risposte ----------
create table if not exists public.avvisi_risposte (
  avviso_id  bigint not null references public.avvisi(id) on delete cascade,
  user_id    uuid   not null references auth.users(id) on delete cascade,
  scelte     smallint[],                                        -- sondaggio: indici delle risposte scelte
  stato      text check (stato is null or stato in ('si','forse','no')),   -- evento
  ospiti     smallint not null default 0 check (ospiti between 0 and 10),
  note       text check (note is null or char_length(note) <= 300),
  updated_at timestamptz not null default now(),
  primary key (avviso_id, user_id)
);
alter table public.avvisi_risposte enable row level security;
revoke all on table public.avvisi_risposte from anon, authenticated;
-- pagamento della quota (eventi con prezzo): lo segna lo staff; vale per la persona e i suoi ospiti
alter table public.avvisi_risposte add column if not exists pagato    boolean not null default false;
alter table public.avvisi_risposte add column if not exists pagato_at timestamptz;
alter table public.avvisi_risposte add column if not exists pagato_da uuid references auth.users(id) on delete set null;

-- ---------- 3. funzioni di supporto ----------
-- coda notifica con indirizzo (la notifica apre direttamente la bacheca); stesse preferenze di _accoda
create or replace function public._accoda_url(p_user uuid, p_tipo text, p_titolo text, p_testo text, p_url text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.notifiche_pref%rowtype;
begin
  if p_user is null then return; end if;
  if not exists (select 1 from public.push_iscrizioni where user_id = p_user) then return; end if;
  select * into v from public.notifiche_pref where user_id = p_user;
  if found and p_tipo = 'avviso' and not v.avvisi then return; end if;
  insert into public.notifiche_coda (user_id, tipo, titolo, testo, url) values (p_user, p_tipo, left(p_titolo, 120), left(p_testo, 400), coalesce(p_url, './'));
end $$;
revoke all on function public._accoda_url(uuid, text, text, text, text) from public, anon, authenticated;

-- post chiuso: scadenza passata, oppure evento già iniziato
create or replace function public._bacheca_chiuso(a public.avvisi)
returns boolean language sql stable as $$
  select (a.chiude_at is not null and a.chiude_at <= now()) or (a.tipo = 'evento' and a.evento_at is not null and a.evento_at <= now());
$$;

-- totali di un post
create or replace function public._bacheca_esiti(p_id bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select case a.tipo
    when 'sondaggio' then (
      select jsonb_build_object(
        'votanti', (select count(*) from public.avvisi_risposte r where r.avviso_id = a.id),
        'conteggi', coalesce((select jsonb_agg((select count(*) from public.avvisi_risposte r where r.avviso_id = a.id and (k.i - 1)::smallint = any (r.scelte)) order by k.i)
                              from jsonb_array_elements(a.dati->'opzioni') with ordinality k(v, i)), '[]'::jsonb)))
    when 'evento' then (
      select jsonb_build_object(
        'si',     count(*) filter (where r.stato = 'si'),
        'forse',  count(*) filter (where r.stato = 'forse'),
        'no',     count(*) filter (where r.stato = 'no'),
        'ospiti', coalesce(sum(r.ospiti) filter (where r.stato = 'si'), 0),
        'occupati', coalesce(sum(1 + r.ospiti) filter (where r.stato = 'si'), 0))
      from public.avvisi_risposte r where r.avviso_id = a.id)
    else null end
  from public.avvisi a where a.id = p_id;
$$;
revoke all on function public._bacheca_esiti(bigint) from public, anon, authenticated;

-- da' momento ("2026-12-12 20:00", ora italiana) a timestamptz; vuoto = null
create or replace function public._ora_roma(p text)
returns timestamptz language sql stable as $$
  select case when nullif(trim(coalesce(p, '')), '') is null then null else (replace(trim(p), 'T', ' ')::timestamp at time zone 'Europe/Rome') end;
$$;

-- ---------- 4. bacheca per l'app ----------
drop function if exists public.bacheca();
create or replace function public.bacheca()
returns table (id bigint, titolo text, testo text, created_at timestamptz, tipo text, dati jsonb, fissato boolean,
               chiude_at timestamptz, evento_at timestamptz, evento_fine timestamptz, destinatari text, chiuso boolean, mia jsonb, esiti jsonb)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_coll boolean := public._collaboratore(); v_staff boolean := public.is_staff();
begin
  if auth.uid() is null then return; end if;
  return query
  select a.id, a.titolo, a.testo, a.created_at, a.tipo, a.dati, a.fissato, a.chiude_at, a.evento_at, a.evento_fine, a.destinatari,
         public._bacheca_chiuso(a),
         m.j,
         case
           when a.tipo = 'evento' then public._bacheca_esiti(a.id)
           when a.tipo = 'sondaggio' and (v_staff
                 or coalesce(a.dati->>'risultati', 'dopo_voto') = 'sempre'
                 or (coalesce(a.dati->>'risultati', 'dopo_voto') = 'dopo_voto' and (m.j is not null or public._bacheca_chiuso(a)))
                 or (a.dati->>'risultati' = 'fine' and public._bacheca_chiuso(a))) then public._bacheca_esiti(a.id)
           else null end
  from public.avvisi a
  left join lateral (select jsonb_build_object('scelte', r.scelte, 'stato', r.stato, 'ospiti', r.ospiti, 'note', r.note, 'pagato', r.pagato) j
                     from public.avvisi_risposte r where r.avviso_id = a.id and r.user_id = auth.uid()) m on true
  where (a.destinatari = 'tutti' or v_coll)
    and (a.created_at > now() - interval '60 days' or a.fissato
         or (a.tipo = 'evento' and coalesce(a.evento_fine, a.evento_at) > now() - interval '1 day')
         or (a.chiude_at is not null and a.chiude_at > now()))
  order by a.fissato desc, a.created_at desc
  limit 50;
end $$;
revoke all on function public.bacheca() from public, anon;
grant execute on function public.bacheca() to authenticated;

-- ---------- 5. risposta dell'iscritto ----------
create or replace function public.rispondi_bacheca(p_id bigint, p_scelte smallint[] default null, p_stato text default null,
                                                   p_ospiti int default 0, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.avvisi%rowtype; n int; v_max int; v_posti int; v_occ int; v_osp int := 0; v_note text;
begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  if not (exists (select 1 from public.iscritti where user_id = auth.uid() and attivo) or public._collaboratore()) then
    raise exception 'La tua iscrizione non è attiva: chiedi in reception';
  end if;
  select * into a from public.avvisi where id = p_id for update;
  if not found or (a.destinatari = 'staff' and not public._collaboratore()) then raise exception 'Post non disponibile'; end if;
  if public._bacheca_chiuso(a) then raise exception 'Le risposte sono chiuse'; end if;
  v_note := nullif(left(trim(coalesce(p_note, '')), 300), '');

  if a.tipo = 'sondaggio' then
    n := coalesce(jsonb_array_length(a.dati->'opzioni'), 0);
    if p_scelte is null or coalesce(array_length(p_scelte, 1), 0) = 0 then raise exception 'Scegli almeno una risposta'; end if;
    if exists (select 1 from unnest(p_scelte) s where s < 0 or s >= n) then raise exception 'Risposta non valida'; end if;
    if (select count(distinct s) from unnest(p_scelte) s) <> array_length(p_scelte, 1) then raise exception 'Risposta ripetuta'; end if;
    if not coalesce((a.dati->>'multipla')::boolean, false) and array_length(p_scelte, 1) > 1 then raise exception 'Puoi scegliere una sola risposta'; end if;
    insert into public.avvisi_risposte (avviso_id, user_id, scelte, stato, ospiti, note, updated_at)
    values (a.id, auth.uid(), (select array_agg(s order by s) from unnest(p_scelte) s), null, 0, null, now())
    on conflict (avviso_id, user_id) do update set scelte = excluded.scelte, updated_at = now();

  elsif a.tipo = 'evento' then
    if p_stato is null or p_stato not in ('si','forse','no') then raise exception 'Risposta non valida'; end if;
    if p_stato = 'si' then
      v_max := least(coalesce((a.dati->>'ospiti_max')::int, 0), 10);
      v_osp := greatest(0, least(coalesce(p_ospiti, 0), v_max));
      v_posti := (a.dati->>'posti')::int;
      if v_posti is not null then
        select coalesce(sum(1 + r.ospiti), 0) into v_occ from public.avvisi_risposte r
         where r.avviso_id = a.id and r.stato = 'si' and r.user_id <> auth.uid();
        if v_occ + 1 + v_osp > v_posti then
          if v_occ >= v_posti then raise exception 'Posti esauriti';
          else raise exception 'Restano solo % posti: riduci gli ospiti', v_posti - v_occ; end if;
        end if;
      end if;
    end if;
    insert into public.avvisi_risposte (avviso_id, user_id, scelte, stato, ospiti, note, updated_at)
    values (a.id, auth.uid(), null, p_stato, v_osp, v_note, now())
    on conflict (avviso_id, user_id) do update set stato = excluded.stato, ospiti = excluded.ospiti, note = excluded.note, updated_at = now();
  else
    raise exception 'A questo post non si risponde';
  end if;
end $$;
revoke all on function public.rispondi_bacheca(bigint, smallint[], text, int, text) from public, anon;
grant execute on function public.rispondi_bacheca(bigint, smallint[], text, int, text) to authenticated;

create or replace function public.ritira_risposta_bacheca(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare a public.avvisi%rowtype;
begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  select * into a from public.avvisi where id = p_id;
  if not found then raise exception 'Post non disponibile'; end if;
  if public._bacheca_chiuso(a) then raise exception 'Le risposte sono chiuse'; end if;
  delete from public.avvisi_risposte where avviso_id = p_id and user_id = auth.uid();
end $$;
revoke all on function public.ritira_risposta_bacheca(bigint) from public, anon;
grant execute on function public.ritira_risposta_bacheca(bigint) to authenticated;

-- ---------- 6. staff: pubblicare ----------
create or replace function public.admin_pubblica_bacheca(p_tipo text, p_titolo text, p_testo text, p_dati jsonb default '{}'::jsonb,
  p_fissato boolean default false, p_chiude text default null, p_inizio text default null, p_fine text default null,
  p_destinatari text default 'tutti', p_notifica boolean default true)
returns json language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_dati jsonb := '{}'::jsonb; v_opz jsonb; v_chiude timestamptz := public._ora_roma(p_chiude);
        v_inizio timestamptz := public._ora_roma(p_inizio); v_fine timestamptz := public._ora_roma(p_fine);
        v_tit text := trim(coalesce(p_titolo, '')); v_txt text := trim(coalesce(p_testo, '')); r record; n int := 0; v_ntit text; v_ntxt text;
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  if p_tipo not in ('avviso','sondaggio','evento') then raise exception 'Tipo non valido'; end if;
  if coalesce(p_destinatari, 'tutti') not in ('tutti','staff') then raise exception 'Destinatari non validi'; end if;
  if char_length(v_tit) < 3 or char_length(v_tit) > 120 then raise exception 'Il titolo deve avere da 3 a 120 caratteri'; end if;
  if char_length(v_txt) > 2000 then raise exception 'Testo troppo lungo (massimo 2000 caratteri)'; end if;
  if p_tipo = 'avviso' and char_length(v_txt) < 3 then raise exception 'Scrivi il testo dell''avviso'; end if;
  if v_chiude is not null and v_chiude <= now() then raise exception 'La scadenza deve essere nel futuro'; end if;

  if p_tipo = 'sondaggio' then
    select coalesce(jsonb_agg(left(trim(x), 80)), '[]'::jsonb) into v_opz
      from jsonb_array_elements_text(coalesce(p_dati->'opzioni', '[]'::jsonb)) x where trim(x) <> '';
    if jsonb_array_length(v_opz) < 2 or jsonb_array_length(v_opz) > 10 then raise exception 'Servono da 2 a 10 risposte'; end if;
    if (select count(distinct lower(x)) from jsonb_array_elements_text(v_opz) x) <> jsonb_array_length(v_opz) then raise exception 'Ci sono risposte uguali'; end if;
    v_dati := jsonb_build_object('opzioni', v_opz,
      'multipla', coalesce((p_dati->>'multipla')::boolean, false),
      'anonimo',  coalesce((p_dati->>'anonimo')::boolean, false),
      'risultati', case when p_dati->>'risultati' in ('dopo_voto','sempre','fine','staff') then p_dati->>'risultati' else 'dopo_voto' end);
    v_inizio := null; v_fine := null;
  elsif p_tipo = 'evento' then
    if v_inizio is null then raise exception 'Indica data e ora dell''evento'; end if;
    if v_inizio <= now() then raise exception 'L''evento deve essere nel futuro'; end if;
    if v_fine is not null and v_fine <= v_inizio then raise exception 'La fine deve essere dopo l''inizio'; end if;
    if v_chiude is not null and v_chiude > v_inizio then raise exception 'Le adesioni devono chiudere prima dell''inizio'; end if;
    if (p_dati->>'posti') is not null and ((p_dati->>'posti')::int < 1 or (p_dati->>'posti')::int > 5000) then raise exception 'Posti non validi'; end if;
    if nullif(p_dati->>'prezzo_euro', '') is not null and ((p_dati->>'prezzo_euro')::numeric <= 0 or (p_dati->>'prezzo_euro')::numeric > 10000) then raise exception 'Prezzo non valido'; end if;
    v_dati := jsonb_strip_nulls(jsonb_build_object(
      'luogo', nullif(left(trim(coalesce(p_dati->>'luogo', '')), 120), ''),
      'prezzo', nullif(left(trim(coalesce(p_dati->>'prezzo', '')), 80), ''),
      'prezzo_euro', round(nullif(p_dati->>'prezzo_euro', '')::numeric, 2),
      'posti', (p_dati->>'posti')::int,
      'ospiti_max', greatest(0, least(coalesce((p_dati->>'ospiti_max')::int, 0), 10))));
  else
    v_chiude := null; v_inizio := null; v_fine := null;
  end if;

  insert into public.avvisi (titolo, testo, tipo, dati, fissato, chiude_at, evento_at, evento_fine, destinatari)
  values (v_tit, v_txt, p_tipo, v_dati, coalesce(p_fissato, false), v_chiude, v_inizio, v_fine, coalesce(p_destinatari, 'tutti'))
  returning id into v_id;

  if coalesce(p_notifica, true) then
    v_ntit := case p_tipo when 'sondaggio' then 'Sondaggio: ' || v_tit when 'evento' then 'Evento: ' || v_tit else v_tit end;
    v_ntxt := case p_tipo
      when 'sondaggio' then coalesce(nullif(left(v_txt, 300), ''), 'Rispondi nella bacheca dell''app')
      when 'evento' then to_char(v_inizio at time zone 'Europe/Rome', 'DD/MM "alle" HH24:MI') || coalesce(' · ' || (v_dati->>'luogo'), '') || ' · rispondi nella bacheca'
      else left(v_txt, 400) end;
    for r in select distinct u from (
        select i.user_id u from public.iscritti i where i.attivo and i.user_id is not null and coalesce(p_destinatari, 'tutti') = 'tutti'
        union select s.user_id from public.staff s) x
      where exists (select 1 from public.push_iscrizioni p where p.user_id = x.u)
        and (coalesce(p_destinatari, 'tutti') = 'tutti' or exists (select 1 from public.staff s where s.user_id = x.u)) loop
      perform public._accoda_url(r.u, 'avviso', v_ntit, v_ntxt, './?p=bacheca');
      n := n + 1;
    end loop;
  end if;
  return json_build_object('avviso', v_id, 'notifiche', n);
end $$;
revoke all on function public.admin_pubblica_bacheca(text, text, text, jsonb, boolean, text, text, text, text, boolean) from public, anon;
grant execute on function public.admin_pubblica_bacheca(text, text, text, jsonb, boolean, text, text, text, text, boolean) to authenticated;

-- ---------- 7. staff: elenco, risposte, azioni ----------
drop function if exists public.admin_bacheca();
create or replace function public.admin_bacheca()
returns table (id bigint, titolo text, testo text, created_at timestamptz, tipo text, dati jsonb, fissato boolean,
               chiude_at timestamptz, evento_at timestamptz, evento_fine timestamptz, destinatari text, chiuso boolean, risposte int, esiti jsonb, pagamenti jsonb)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  return query
  select a.id, a.titolo, a.testo, a.created_at, a.tipo, a.dati, a.fissato, a.chiude_at, a.evento_at, a.evento_fine, a.destinatari,
         public._bacheca_chiuso(a), (select count(*)::int from public.avvisi_risposte r where r.avviso_id = a.id),
         case when a.tipo in ('sondaggio','evento') then public._bacheca_esiti(a.id) end,
         -- quote: dovuto e incassato (persone confermate x prezzo); "da_rimborsare" = ha pagato ma ora non partecipa
         case when a.tipo = 'evento' and (a.dati->>'prezzo_euro') is not null then (
           select jsonb_build_object(
             'persone',  coalesce(sum(1 + r.ospiti) filter (where r.stato = 'si'), 0),
             'pagate',   coalesce(sum(1 + r.ospiti) filter (where r.stato = 'si' and r.pagato), 0),
             'dovuto',   coalesce(sum(1 + r.ospiti) filter (where r.stato = 'si'), 0) * (a.dati->>'prezzo_euro')::numeric,
             'incassato', coalesce(sum(1 + r.ospiti) filter (where r.stato = 'si' and r.pagato), 0) * (a.dati->>'prezzo_euro')::numeric,
             'da_rimborsare', count(*) filter (where r.pagato and coalesce(r.stato, '') <> 'si'))
           from public.avvisi_risposte r where r.avviso_id = a.id) end
  from public.avvisi a order by a.fissato desc, a.created_at desc limit 200;
end $$;
revoke all on function public.admin_bacheca() from public, anon;
grant execute on function public.admin_bacheca() to authenticated;

drop function if exists public.admin_bacheca_risposte(bigint);
create or replace function public.admin_bacheca_risposte(p_id bigint)
returns table (user_id uuid, nome text, email text, scelte smallint[], stato text, ospiti smallint, note text, pagato boolean, pagato_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare a public.avvisi%rowtype;
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  select * into a from public.avvisi where avvisi.id = p_id;
  if not found then raise exception 'Post non trovato'; end if;
  if a.tipo = 'sondaggio' and coalesce((a.dati->>'anonimo')::boolean, false) then
    raise exception 'Sondaggio anonimo: sono visibili solo i totali';
  end if;
  return query
  select r.user_id, coalesce(i.nome, p.nome, 'Iscritto'), coalesce(i.email, u.email::text), r.scelte, r.stato, r.ospiti, r.note, r.pagato, r.pagato_at, r.updated_at
  from public.avvisi_risposte r
  left join public.iscritti i on i.user_id = r.user_id
  left join public.profili p on p.user_id = r.user_id
  left join auth.users u on u.id = r.user_id
  where r.avviso_id = p_id
  order by case r.stato when 'si' then 0 when 'forse' then 1 when 'no' then 2 else 3 end, 2;
end $$;
revoke all on function public.admin_bacheca_risposte(bigint) from public, anon;
grant execute on function public.admin_bacheca_risposte(bigint) to authenticated;

-- azioni: fissa / sgancia / chiudi (adesso) / riapri
create or replace function public.admin_bacheca_azione(p_id bigint, p_azione text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  if p_azione = 'fissa' then update public.avvisi set fissato = true where id = p_id;
  elsif p_azione = 'sgancia' then update public.avvisi set fissato = false where id = p_id;
  elsif p_azione = 'chiudi' then update public.avvisi set chiude_at = now() where id = p_id and tipo <> 'avviso';
  elsif p_azione = 'riapri' then update public.avvisi set chiude_at = null where id = p_id and tipo <> 'avviso';
  else raise exception 'Azione non valida'; end if;
  if not found then raise exception 'Post non trovato'; end if;
end $$;
revoke all on function public.admin_bacheca_azione(bigint, text) from public, anon;
grant execute on function public.admin_bacheca_azione(bigint, text) to authenticated;

-- sollecito: notifica a chi deve ancora rispondere (solo a chi ha le notifiche attive)
create or replace function public.admin_bacheca_sollecita(p_id bigint)
returns int language plpgsql security definer set search_path = public as $$
declare a public.avvisi%rowtype; r record; n int := 0;
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  select * into a from public.avvisi where id = p_id;
  if not found or a.tipo = 'avviso' then raise exception 'Post non trovato'; end if;
  if public._bacheca_chiuso(a) then raise exception 'Le risposte sono già chiuse'; end if;
  for r in select distinct x.u from (
      select i.user_id u from public.iscritti i where i.attivo and i.user_id is not null and a.destinatari = 'tutti'
      union select s.user_id from public.staff s) x
    where exists (select 1 from public.push_iscrizioni p where p.user_id = x.u)
      and (a.destinatari = 'tutti' or exists (select 1 from public.staff s where s.user_id = x.u))
      and not exists (select 1 from public.avvisi_risposte q where q.avviso_id = a.id and q.user_id = x.u) loop
    perform public._accoda_url(r.u, 'avviso',
      case a.tipo when 'sondaggio' then 'Manca il tuo voto: ' else 'Ci sarai? ' end || a.titolo,
      case a.tipo when 'sondaggio' then 'Rispondi al sondaggio nella bacheca dell''app'
           else to_char(a.evento_at at time zone 'Europe/Rome', 'DD/MM "alle" HH24:MI') || ' · rispondi nella bacheca' end,
      './?p=bacheca');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.admin_bacheca_sollecita(bigint) from public, anon;
grant execute on function public.admin_bacheca_sollecita(bigint) to authenticated;

-- ---------- 8. staff: quota pagata o no (eventi con prezzo) ----------
create or replace function public.admin_bacheca_pagato(p_id bigint, p_user uuid, p_pagato boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  update public.avvisi_risposte
     set pagato = coalesce(p_pagato, false),
         pagato_at = case when coalesce(p_pagato, false) then now() end,
         pagato_da = case when coalesce(p_pagato, false) then auth.uid() end
   where avviso_id = p_id and user_id = p_user;
  if not found then raise exception 'Risposta non trovata'; end if;
end $$;
revoke all on function public.admin_bacheca_pagato(bigint, uuid, boolean) from public, anon;
grant execute on function public.admin_bacheca_pagato(bigint, uuid, boolean) to authenticated;
