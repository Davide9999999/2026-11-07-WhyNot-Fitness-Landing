-- =====================================================================
-- WHY NOT - 2026-11-12: posizione in lista d'attesa corretta anche con tante prenotazioni insieme. Si può rieseguire.
-- Problema (stress test 350): l'ordine della lista usava l'ora di inizio della richiesta (now()), ma le richieste vengono messe in fila
-- dal blocco sulla lezione in un ordine leggermente diverso: la posizione comunicata subito ("sei 5°") poteva essere sfalsata.
-- Correzione: l'ora della prenotazione è quella in cui viene davvero inserita (clock_timestamp(), dopo il blocco).
-- Contiene anche la correzione doppio tocco (indice univoco + blocco della lezione), già applicata.
-- =====================================================================

create unique index if not exists prenotazioni_un_iscritto_per_lezione
  on public.prenotazioni (lezione_id, member_id) where stato <> 'annullata' and member_id is not null;

create or replace function public.prenota_iscritto(p_lezione_id bigint, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_i public.iscritti%rowtype; v_p public.profili%rowtype; v_mail text;
  v_l public.lezioni%rowtype; v_ap timestamptz; v_id uuid; v_stato text; v_pos int;
begin
  if v_uid is null then raise exception 'Accedi per prenotare'; end if;
  select * into v_i from public.iscritti where user_id = v_uid;
  if not found then raise exception 'Il tuo account non è collegato a un iscritto: chiedi in reception'; end if;
  if not v_i.attivo then raise exception 'Il tuo account è sospeso: chiedi in reception'; end if;
  select * into v_p from public.profili where user_id = v_uid;
  select lower(email) into v_mail from auth.users where id = v_uid;

  -- blocca la lezione: i tocchi contemporanei dello stesso iscritto (o di altri) passano uno alla volta
  select * into v_l from public.lezioni where id = p_lezione_id for update;
  if not found or not v_l.pubblicata then raise exception 'Lezione non disponibile'; end if;
  if v_l.stato = 'annullata' then raise exception 'La lezione è annullata'; end if;
  if v_l.inizio <= now() then raise exception 'La lezione è già iniziata'; end if;
  v_ap := public._apertura_prenotazioni(v_l.inizio);
  if now() < v_ap then
    raise exception 'Le prenotazioni per questa lezione si aprono sabato % alle 9:00', to_char(v_ap at time zone 'Europe/Rome', 'DD/MM');
  end if;
  if exists (select 1 from public.prenotazioni where lezione_id = p_lezione_id and member_id = v_uid and stato <> 'annullata') then
    raise exception 'Sei già segnato a questa lezione';
  end if;

  begin
  perform set_config('whynot.prenota_pubblica', 'on', true);
  insert into public.prenotazioni (lezione_id, nome, telefono, email, note, origine, consenso_privacy, member_id, created_at)
  values (p_lezione_id, coalesce(v_p.nome, v_i.nome), coalesce(v_p.telefono, v_i.telefono), v_mail,
          nullif(left(trim(coalesce(p_note, '')), 500), ''), 'app', true, v_uid, clock_timestamp())
  returning id, stato into v_id, v_stato;
  exception when unique_violation then
    raise exception 'Sei già segnato a questa lezione';
  end;
  perform set_config('whynot.prenota_pubblica', '', true);

  if v_stato = 'attesa' then
    select count(*) into v_pos from public.prenotazioni
     where lezione_id = p_lezione_id and stato = 'attesa'
       and created_at <= (select created_at from public.prenotazioni where id = v_id);
  end if;
  return json_build_object('id', v_id, 'stato', v_stato, 'posizione_attesa', v_pos);
end $$;
revoke all on function public.prenota_iscritto(bigint,text) from public, anon;
grant execute on function public.prenota_iscritto(bigint,text) to authenticated;
