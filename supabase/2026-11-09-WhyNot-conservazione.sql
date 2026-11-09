-- =====================================================================
-- WHY NOT - cancellazione automatica dei dati scaduti (coerente con /privacy/, sezione 7). Si può rieseguire.
--   * prenotazioni: cancellate 24 mesi dopo la fine della lezione
--   * account iscritti (non staff): cancellati dopo 24 mesi senza accessi (il profilo si cancella a cascata)
--   * registro azioni AI: 24 mesi
-- Esecuzione: ogni notte alle 03:30 (UTC) con pg_cron.
-- =====================================================================

create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.pulizia_dati()
returns json language plpgsql security definer set search_path = public as $$
declare v_pren int; v_acc int; v_ai int;
begin
  delete from public.prenotazioni p using public.lezioni l
   where l.id = p.lezione_id and l.fine < now() - interval '24 months';
  get diagnostics v_pren = row_count;

  delete from auth.users u
   where coalesce(u.last_sign_in_at, u.created_at) < now() - interval '24 months'
     and not exists (select 1 from public.staff s where s.user_id = u.id);
  get diagnostics v_acc = row_count;

  delete from public.ai_audit where created_at < now() - interval '24 months';
  get diagnostics v_ai = row_count;

  return json_build_object('prenotazioni', v_pren, 'account', v_acc, 'ai_audit', v_ai);
end $$;

revoke all on function public.pulizia_dati() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'whynot-pulizia-dati';
select cron.schedule('whynot-pulizia-dati', '30 3 * * *', $$select public.pulizia_dati()$$);
