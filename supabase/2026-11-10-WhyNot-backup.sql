-- =====================================================================
-- WHY NOT - backup giornaliero (piano Free: Supabase non fa backup)
-- backup_dati(segreto) restituisce tutte le tabelle applicative in JSON.
-- La chiama ogni notte il workflow GitHub .github/workflows/backup.yml,
-- che cifra il file (AES-256) e lo conserva 90 giorni.
-- Il segreto NON è qui: in config_privata c'è solo il suo hash sha256
-- (inserito a parte, fuori dal repository).
-- Account (2026-11-11): _auth_users con impronta bcrypt della password e token azzerati, _auth_identities.
-- Esclusi: config_privata (segreti), push_iscrizioni (chiavi dei dispositivi:
-- dopo un ripristino basta riattivare le notifiche), notifiche_coda (transitoria).
-- =====================================================================

create or replace function public.backup_dati(p_segreto text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_t record; v_out jsonb := '{}'::jsonb; v_righe jsonb;
begin
  if not exists (select 1 from public.config_privata
                  where chiave = 'backup_segreto_sha256'
                    and valore = encode(sha256(convert_to(coalesce(p_segreto, ''), 'UTF8')), 'hex')) then
    raise exception 'Non autorizzato' using errcode = '42501';
  end if;
  for v_t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname not in ('config_privata', 'push_iscrizioni', 'notifiche_coda')
     order by c.relname
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t', v_t.relname) into v_righe;
    v_out := v_out || jsonb_build_object(v_t.relname, v_righe);
  end loop;
  -- corrispondenza id utente -> email, per ricollegare i dati dopo un ripristino parziale
  v_out := v_out || jsonb_build_object('_utenti', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email, 'creato', u.created_at)), '[]'::jsonb) from auth.users u));
  -- account completi per il ripristino totale: impronta della password (bcrypt, non reversibile), stessi id.
  -- I token (sessioni, link di conferma/recupero) NON si salvano: vuoti, come li vuole Supabase Auth.
  v_out := v_out || jsonb_build_object('_auth_users', (select coalesce(jsonb_agg(to_jsonb(u) - 'confirmed_at' || jsonb_build_object('confirmation_token', '', 'recovery_token', '', 'email_change_token_new', '', 'email_change_token_current', '', 'phone_change_token', '', 'reauthentication_token', '')), '[]'::jsonb) from auth.users u));
  v_out := v_out || jsonb_build_object('_auth_identities', (select coalesce(jsonb_agg(to_jsonb(i) - 'email'), '[]'::jsonb) from auth.identities i));
  return jsonb_build_object('progetto', 'whynot', 'creato', now(), 'tabelle', v_out);
end $$;

revoke all on function public.backup_dati(text) from public;
grant execute on function public.backup_dati(text) to anon, authenticated;
