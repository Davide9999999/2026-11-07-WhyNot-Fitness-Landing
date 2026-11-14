-- =====================================================================
-- WHY NOT - 2026-11-14: post della bacheca modificabili dopo la pubblicazione. Si può rieseguire.
-- Regole (per non falsare risposte già date):
--  - sempre modificabili: titolo, testo, in evidenza, destinatari, chiusura (anche spostata in avanti = risposte riaperte);
--  - il tipo non cambia;
--  - sondaggio con voti: le risposte esistenti si possono riscrivere e se ne aggiungono in fondo, ma non si tolgono;
--    non si passa a scelta singola se qualcuno ha già scelto più risposte;
--  - evento: data, luogo, prezzo, posti, ospiti modificabili, ma non sotto le persone già confermate; un evento iniziato non si sposta;
--  - facoltativo: notifica della modifica (sondaggi ed eventi: a chi ha risposto; avvisi: a tutti i destinatari).
-- Nell'app il post mostra «modificato» (colonna modificato_at).
-- =====================================================================
alter table public.avvisi add column if not exists modificato_at timestamptz;

-- ---------- bacheca per l'app (aggiunta modificato_at) ----------
drop function if exists public.bacheca();
create or replace function public.bacheca()
returns table (id bigint, titolo text, testo text, created_at timestamptz, tipo text, dati jsonb, fissato boolean,
               chiude_at timestamptz, evento_at timestamptz, evento_fine timestamptz, destinatari text, chiuso boolean, mia jsonb, esiti jsonb,
               modificato_at timestamptz)
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
           else null end,
         a.modificato_at
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

-- ---------- elenco per lo staff (aggiunta modificato_at) ----------
drop function if exists public.admin_bacheca();
create or replace function public.admin_bacheca()
returns table (id bigint, titolo text, testo text, created_at timestamptz, tipo text, dati jsonb, fissato boolean,
               chiude_at timestamptz, evento_at timestamptz, evento_fine timestamptz, destinatari text, chiuso boolean, risposte int, esiti jsonb, pagamenti jsonb,
               modificato_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  return query
  select a.id, a.titolo, a.testo, a.created_at, a.tipo, a.dati, a.fissato, a.chiude_at, a.evento_at, a.evento_fine, a.destinatari,
         public._bacheca_chiuso(a), (select count(*)::int from public.avvisi_risposte r where r.avviso_id = a.id),
         case when a.tipo in ('sondaggio','evento') then public._bacheca_esiti(a.id) end,
         case when a.tipo = 'evento' and (a.dati->>'prezzo_euro') is not null then (
           select jsonb_build_object(
             'persone',  coalesce(sum(1 + r.ospiti) filter (where r.stato = 'si'), 0),
             'pagate',   coalesce(sum(1 + r.ospiti) filter (where r.stato = 'si' and r.pagato), 0),
             'dovuto',   coalesce(sum(1 + r.ospiti) filter (where r.stato = 'si'), 0) * (a.dati->>'prezzo_euro')::numeric,
             'incassato', coalesce(sum(1 + r.ospiti) filter (where r.stato = 'si' and r.pagato), 0) * (a.dati->>'prezzo_euro')::numeric,
             'da_rimborsare', count(*) filter (where r.pagato and coalesce(r.stato, '') <> 'si'))
           from public.avvisi_risposte r where r.avviso_id = a.id) end,
         a.modificato_at
  from public.avvisi a order by a.fissato desc, a.created_at desc limit 200;
end $$;
revoke all on function public.admin_bacheca() from public, anon;
grant execute on function public.admin_bacheca() to authenticated;

-- ---------- modifica ----------
create or replace function public.admin_modifica_bacheca(p_id bigint, p_titolo text, p_testo text, p_dati jsonb default '{}'::jsonb,
  p_fissato boolean default false, p_chiude text default null, p_inizio text default null, p_fine text default null,
  p_destinatari text default 'tutti', p_notifica boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare a public.avvisi%rowtype; v_dati jsonb := '{}'::jsonb; v_opz jsonb; v_n_old int; v_voti int; v_occ int; v_maxosp int;
        v_chiude timestamptz := public._ora_roma(p_chiude); v_inizio timestamptz := public._ora_roma(p_inizio); v_fine timestamptz := public._ora_roma(p_fine);
        v_tit text := trim(coalesce(p_titolo, '')); v_txt text := trim(coalesce(p_testo, '')); r record; n int := 0; v_ntxt text;
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  select * into a from public.avvisi where id = p_id for update;
  if not found then raise exception 'Post non trovato'; end if;
  -- il modulo lavora al minuto: una data lasciata uguale (anche con i secondi, es. «Chiudi ora») resta quella originale
  if v_chiude is not null and date_trunc('minute', v_chiude) = date_trunc('minute', a.chiude_at) then v_chiude := a.chiude_at; end if;
  if v_inizio is not null and date_trunc('minute', v_inizio) = date_trunc('minute', a.evento_at) then v_inizio := a.evento_at; end if;
  if v_fine is not null and date_trunc('minute', v_fine) = date_trunc('minute', a.evento_fine) then v_fine := a.evento_fine; end if;
  if coalesce(p_destinatari, 'tutti') not in ('tutti','staff') then raise exception 'Destinatari non validi'; end if;
  if char_length(v_tit) < 3 or char_length(v_tit) > 120 then raise exception 'Il titolo deve avere da 3 a 120 caratteri'; end if;
  if char_length(v_txt) > 2000 then raise exception 'Testo troppo lungo (massimo 2000 caratteri)'; end if;
  if a.tipo = 'avviso' and char_length(v_txt) < 3 then raise exception 'Scrivi il testo dell''avviso'; end if;
  -- una nuova chiusura nel passato non ha senso; quella già passata e lasciata uguale va bene
  if v_chiude is not null and v_chiude <= now() and v_chiude is distinct from a.chiude_at then raise exception 'La chiusura deve essere nel futuro'; end if;
  select count(*) into v_voti from public.avvisi_risposte where avviso_id = a.id;

  if a.tipo = 'sondaggio' then
    select coalesce(jsonb_agg(left(trim(x), 80)), '[]'::jsonb) into v_opz
      from jsonb_array_elements_text(coalesce(p_dati->'opzioni', '[]'::jsonb)) x where trim(x) <> '';
    v_n_old := coalesce(jsonb_array_length(a.dati->'opzioni'), 0);
    if jsonb_array_length(v_opz) < 2 or jsonb_array_length(v_opz) > 10 then raise exception 'Servono da 2 a 10 risposte'; end if;
    if (select count(distinct lower(x)) from jsonb_array_elements_text(v_opz) x) <> jsonb_array_length(v_opz) then raise exception 'Ci sono risposte uguali'; end if;
    if v_voti > 0 and jsonb_array_length(v_opz) < v_n_old then
      raise exception 'Ci sono già % voti: le risposte esistenti si possono riscrivere o se ne possono aggiungere, ma non togliere', v_voti;
    end if;
    if not coalesce((p_dati->>'multipla')::boolean, false)
       and exists (select 1 from public.avvisi_risposte where avviso_id = a.id and coalesce(array_length(scelte, 1), 0) > 1) then
      raise exception 'Qualcuno ha già scelto più risposte: il sondaggio deve restare a scelta multipla';
    end if;
    v_dati := jsonb_build_object('opzioni', v_opz,
      'multipla', coalesce((p_dati->>'multipla')::boolean, false),
      'anonimo',  coalesce((p_dati->>'anonimo')::boolean, false),
      'risultati', case when p_dati->>'risultati' in ('dopo_voto','sempre','fine','staff') then p_dati->>'risultati' else 'dopo_voto' end);
    -- un sondaggio nato anonimo resta anonimo (chi ha votato contava sull'anonimato)
    if coalesce((a.dati->>'anonimo')::boolean, false) and v_voti > 0 then v_dati := v_dati || '{"anonimo": true}'::jsonb; end if;
    v_inizio := null; v_fine := null;
  elsif a.tipo = 'evento' then
    if v_inizio is null then raise exception 'Indica data e ora dell''evento'; end if;
    if v_inizio is distinct from a.evento_at then
      if a.evento_at <= now() then raise exception 'L''evento è già iniziato: la data non si può più cambiare'; end if;
      if v_inizio <= now() then raise exception 'L''evento deve essere nel futuro'; end if;
    end if;
    if v_fine is not null and v_fine <= v_inizio then raise exception 'La fine deve essere dopo l''inizio'; end if;
    if v_chiude is not null and v_chiude > v_inizio then raise exception 'Le adesioni devono chiudere prima dell''inizio'; end if;
    if nullif(p_dati->>'posti', '') is not null and ((p_dati->>'posti')::int < 1 or (p_dati->>'posti')::int > 5000) then raise exception 'Posti non validi'; end if;
    if nullif(p_dati->>'prezzo_euro', '') is not null and ((p_dati->>'prezzo_euro')::numeric <= 0 or (p_dati->>'prezzo_euro')::numeric > 10000) then raise exception 'Prezzo non valido'; end if;
    select coalesce(sum(1 + ospiti) filter (where stato = 'si'), 0), coalesce(max(ospiti) filter (where stato = 'si'), 0)
      into v_occ, v_maxosp from public.avvisi_risposte where avviso_id = a.id;
    if nullif(p_dati->>'posti', '') is not null and (p_dati->>'posti')::int < v_occ then
      raise exception 'Ci sono già % persone confermate (ospiti compresi): i posti non possono essere meno', v_occ;
    end if;
    if greatest(0, least(coalesce((p_dati->>'ospiti_max')::int, 0), 10)) < v_maxosp then
      raise exception 'Qualcuno ha già indicato % ospiti: il massimo non può essere più basso', v_maxosp;
    end if;
    v_dati := jsonb_strip_nulls(jsonb_build_object(
      'luogo', nullif(left(trim(coalesce(p_dati->>'luogo', '')), 120), ''),
      'prezzo', nullif(left(trim(coalesce(p_dati->>'prezzo', '')), 80), ''),
      'prezzo_euro', round(nullif(p_dati->>'prezzo_euro', '')::numeric, 2),
      'posti', nullif(p_dati->>'posti', '')::int,
      'ospiti_max', greatest(0, least(coalesce((p_dati->>'ospiti_max')::int, 0), 10))));
  else
    v_chiude := null; v_inizio := null; v_fine := null;
  end if;

  update public.avvisi set titolo = v_tit, testo = v_txt, dati = v_dati, fissato = coalesce(p_fissato, false),
         chiude_at = v_chiude, evento_at = v_inizio, evento_fine = v_fine, destinatari = coalesce(p_destinatari, 'tutti'), modificato_at = now()
   where id = a.id;

  if coalesce(p_notifica, false) then
    v_ntxt := case a.tipo
      when 'evento' then 'Aggiornato: ' || to_char(v_inizio at time zone 'Europe/Rome', 'DD/MM "alle" HH24:MI') || coalesce(' · ' || (v_dati->>'luogo'), '')
      when 'sondaggio' then 'Il sondaggio è stato aggiornato: dai un''occhiata nella bacheca'
      else left(v_txt, 400) end;
    for r in
      select distinct x.u from (
        -- sondaggi ed eventi: chi ha già risposto (e può ancora vedere il post)
        select q.user_id u from public.avvisi_risposte q where q.avviso_id = a.id and a.tipo <> 'avviso'
        union
        -- avvisi: gli stessi destinatari della pubblicazione
        select i.user_id from public.iscritti i where a.tipo = 'avviso' and i.attivo and i.user_id is not null and coalesce(p_destinatari, 'tutti') = 'tutti'
        union
        select s.user_id from public.staff s where a.tipo = 'avviso') x
      where exists (select 1 from public.push_iscrizioni p where p.user_id = x.u)
        and (coalesce(p_destinatari, 'tutti') = 'tutti' or exists (select 1 from public.staff s where s.user_id = x.u)) loop
      perform public._accoda_url(r.u, 'avviso', 'Modificato: ' || v_tit, v_ntxt, './?p=bacheca');
      n := n + 1;
    end loop;
  end if;
  return json_build_object('avviso', a.id, 'notifiche', n);
end $$;
revoke all on function public.admin_modifica_bacheca(bigint, text, text, jsonb, boolean, text, text, text, text, boolean) from public, anon;
grant execute on function public.admin_modifica_bacheca(bigint, text, text, jsonb, boolean, text, text, text, text, boolean) to authenticated;
