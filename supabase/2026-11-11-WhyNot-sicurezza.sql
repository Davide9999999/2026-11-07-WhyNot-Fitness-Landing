-- =====================================================================
-- WHY NOT - correzioni di sicurezza dal collaudo del 2026-11-11
-- 1) segna_presenza: su una lezione SENZA istruttore assegnato il confronto
--    "istruttore_id = auth.uid()" valeva NULL e il controllo non bloccava:
--    qualsiasi iscritto poteva segnare presenti/assenti gli altri.
-- 2) salva_carico: accettava carichi anche su schede non assegnate all'iscritto
--    (nessun dato altrui esposto, ma dati sporchi). Ora vale la stessa regola di mie_schede.
-- =====================================================================

create or replace function public.segna_presenza(p_prenotazione_id uuid, p_presente boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_l public.lezioni%rowtype;
begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  select l.* into v_l from public.lezioni l join public.prenotazioni p on p.lezione_id = l.id where p.id = p_prenotazione_id;
  if not found then raise exception 'Prenotazione inesistente'; end if;
  -- coalesce: senza istruttore assegnato il confronto è NULL e deve contare come "no"
  if not (public.is_staff() or coalesce(v_l.istruttore_id = auth.uid(), false)) then raise exception 'Non è una tua lezione'; end if;
  if v_l.inizio > now() + interval '30 minutes' then raise exception 'L''appello si fa a partire da 30 minuti prima della lezione'; end if;
  update public.prenotazioni set presenza = p_presente where id = p_prenotazione_id and stato = 'confermata';
  if not found then raise exception 'Si segna la presenza solo sulle prenotazioni confermate'; end if;
end $$;

create or replace function public.salva_carico(p_scheda_id uuid, p_giorno integer, p_idx integer, p_esercizio_id bigint, p_esercizio text, p_serie integer, p_kg numeric, p_rip integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  -- la scheda deve essere una di quelle che l'iscritto vede nell'app (stessa regola di mie_schede)
  if p_scheda_id is not null and not exists (
    select 1 from public.schede s
     where s.id = p_scheda_id and s.stato = 'pubblicata'
       and (case when coalesce(cardinality(s.destinatari), 0) > 0 then auth.uid() = any(s.destinatari)
                 when s.member_id is not null then s.member_id = auth.uid()
                 else true end)) then
    raise exception 'Scheda non disponibile';
  end if;
  if p_kg is not null and (p_kg < 0 or p_kg > 1000) then raise exception 'Carico non valido'; end if;
  if p_rip is not null and (p_rip < 0 or p_rip > 500) then raise exception 'Ripetizioni non valide'; end if;
  insert into public.registro_carichi (user_id, scheda_id, giorno, esercizio_idx, esercizio_id, esercizio, serie, kg, rip)
  values (auth.uid(), p_scheda_id, coalesce(p_giorno, 0), coalesce(p_idx, 0), p_esercizio_id, left(coalesce(p_esercizio, 'Esercizio'), 80), p_serie, p_kg, p_rip)
  on conflict (user_id, scheda_id, giorno, esercizio_idx, data, serie)
  do update set kg = excluded.kg, rip = excluded.rip, esercizio_id = excluded.esercizio_id, esercizio = excluded.esercizio, created_at = now();
end $$;
