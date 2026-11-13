-- =====================================================================
-- WHY NOT - 2026-11-13: esito di consegna delle notifiche push. Si può rieseguire.
-- Prima "inviato" voleva dire solo "preso dalla coda": ora il Worker registra anche la risposta del servizio push
-- (Google/Apple/Mozilla) per ogni notifica, es. "201" = accettata, "403 ..." = rifiutata, "410" = dispositivo non più valido.
-- =====================================================================
alter table public.notifiche_coda add column if not exists esito text;

create or replace function public.push_esiti(p_segreto text, p_esiti jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public._push_ok(p_segreto) then raise exception 'Non autorizzato' using errcode = '42501'; end if;
  update public.notifiche_coda c set esito = left(e->>'esito', 300)
    from jsonb_array_elements(coalesce(p_esiti, '[]'::jsonb)) e
   where c.id = (e->>'id')::bigint;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.push_esiti(text, jsonb) from public;
grant execute on function public.push_esiti(text, jsonb) to anon, authenticated;
