-- WHY NOT - notifiche: lotto massimo 45 per giro (2026-11-10)
CREATE OR REPLACE FUNCTION public.push_da_inviare(p_segreto text, p_max integer DEFAULT 200)
 RETURNS TABLE(coda_id bigint, endpoint text, p256dh text, auth text, titolo text, testo text, url text, tipo text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare v_ids bigint[];
begin
  -- max 45 per giro: il Worker sul piano Free ha 50 richieste esterne per esecuzione; il resto parte al minuto dopo
  if not public._push_ok(p_segreto) then raise exception 'Non autorizzato' using errcode = '42501'; end if;
  perform public._accoda_promemoria();
  delete from public.notifiche_coda where creato < now() - interval '30 days';
  -- le notifiche più vecchie di 6 ore non si mandano più (es. Worker fermo)
  update public.notifiche_coda set inviato = now() where inviato is null and creato < now() - interval '6 hours';
  select array_agg(id) into v_ids from (select id from public.notifiche_coda where inviato is null order by creato limit greatest(1, least(p_max, 45)) for update skip locked) x;
  if v_ids is null then return; end if;
  update public.notifiche_coda set inviato = now() where id = any(v_ids);
  return query
  select c.id, s.endpoint, s.p256dh, s.auth, c.titolo, c.testo, c.url, c.tipo
  from public.notifiche_coda c join public.push_iscrizioni s on s.user_id = c.user_id
  where c.id = any(v_ids);
end $function$
;
