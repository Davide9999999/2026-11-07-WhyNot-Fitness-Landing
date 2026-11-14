-- =====================================================================
-- WHY NOT - 2026-11-14: il lotto di invio notifiche conta i DISPOSITIVI, non le notifiche. Si può rieseguire.
-- Problema trovato nel test di carico (100 iscritti con 2 dispositivi ciascuno): push_da_inviare prendeva 45 notifiche
-- e restituiva una riga per OGNI dispositivo dell'iscritto (fino a 10). Con 2 dispositivi = 90 invii in un giro, ma il
-- Worker Cloudflare gratuito ne può fare circa 50: gli invii oltre il limite fallivano e la notifica risultava comunque
-- "inviata" (persa in silenzio). Ora il lotto si ferma quando la somma dei dispositivi raggiunge p_max; le notifiche
-- rimaste partono al giro successivo (un minuto dopo). Una notifica si manda sempre intera a tutti i dispositivi.
-- =====================================================================
create or replace function public.push_da_inviare(p_segreto text, p_max int default 200)
returns table (coda_id bigint, endpoint text, p256dh text, auth text, titolo text, testo text, url text, tipo text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_ids bigint[]; v_max int := greatest(1, least(p_max, 500));
begin
  if not public._push_ok(p_segreto) then raise exception 'Non autorizzato' using errcode = '42501'; end if;
  perform public._accoda_promemoria();
  delete from public.notifiche_coda where creato < now() - interval '30 days';
  -- le notifiche più vecchie di 6 ore non si mandano più (es. Worker fermo)
  update public.notifiche_coda set inviato = now() where inviato is null and creato < now() - interval '6 hours';
  with c as (
    select n.id, n.creato, (select count(*) from public.push_iscrizioni s where s.user_id = n.user_id) k
    from public.notifiche_coda n where n.inviato is null order by n.creato, n.id limit 500 for update skip locked
  ), cum as (
    select id, sum(k) over (order by creato, id) tot, row_number() over (order by creato, id) rn from c
  )
  select array_agg(id) into v_ids from cum where tot <= v_max or rn = 1;   -- almeno la prima, anche se da sola supera il limite
  if v_ids is null then return; end if;
  update public.notifiche_coda set inviato = now() where id = any(v_ids);
  return query
  select c.id, s.endpoint, s.p256dh, s.auth, c.titolo, c.testo, c.url, c.tipo
  from public.notifiche_coda c join public.push_iscrizioni s on s.user_id = c.user_id
  where c.id = any(v_ids)
  limit v_max;   -- tetto di sicurezza: mai più invii di quanti il Worker ne può fare in un giro
end $$;
revoke all on function public.push_da_inviare(text,int) from public;
grant execute on function public.push_da_inviare(text,int) to anon, authenticated;   -- protetta dal segreto
