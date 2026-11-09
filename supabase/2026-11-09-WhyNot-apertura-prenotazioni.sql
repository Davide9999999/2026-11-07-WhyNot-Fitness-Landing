-- =====================================================================
-- WHY NOT - apertura prenotazioni: una lezione si può prenotare dalla DOMENICA alle 00:00 che precede la sua settimana
-- (cioè un giorno prima dell'inizio della settimana) fino all'inizio della lezione. Si può rieseguire.
-- Per cambiare l'anticipo basta modificare l'intervallo in _apertura_prenotazioni().
-- =====================================================================

create or replace function public._apertura_prenotazioni(p_inizio timestamptz)
returns timestamptz language sql stable set search_path = public as $$
  select (date_trunc('week', p_inizio at time zone 'Europe/Rome') - interval '1 day') at time zone 'Europe/Rome';
$$;

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

  select * into v_l from public.lezioni where id = p_lezione_id;
  if not found or not v_l.pubblicata then raise exception 'Lezione non disponibile'; end if;
  if v_l.stato = 'annullata' then raise exception 'La lezione è annullata'; end if;
  if v_l.inizio <= now() then raise exception 'La lezione è già iniziata'; end if;
  v_ap := public._apertura_prenotazioni(v_l.inizio);
  if now() < v_ap then
    raise exception 'Le prenotazioni per questa lezione si aprono domenica % alle 00:00', to_char(v_ap at time zone 'Europe/Rome', 'DD/MM');
  end if;
  if exists (select 1 from public.prenotazioni where lezione_id = p_lezione_id and member_id = v_uid and stato <> 'annullata') then
    raise exception 'Sei già prenotato a questa lezione';
  end if;

  perform set_config('whynot.prenota_pubblica', 'on', true);
  insert into public.prenotazioni (lezione_id, nome, telefono, email, note, origine, consenso_privacy, member_id)
  values (p_lezione_id, coalesce(v_p.nome, v_i.nome), coalesce(v_p.telefono, v_i.telefono), v_mail,
          nullif(left(trim(coalesce(p_note, '')), 500), ''), 'app', true, v_uid)
  returning id, stato into v_id, v_stato;
  perform set_config('whynot.prenota_pubblica', '', true);

  if v_stato = 'attesa' then
    select count(*) into v_pos from public.prenotazioni
     where lezione_id = p_lezione_id and stato = 'attesa'
       and created_at <= (select created_at from public.prenotazioni where id = v_id);
  end if;
  return json_build_object('id', v_id, 'stato', v_stato, 'posizione_attesa', v_pos);
end $$;

create or replace function public.lezioni_periodo(p_da date, p_a date)
returns table (id bigint, corso text, slug text, categoria text, sala text, inizio timestamptz, fine timestamptz,
               capienza int, posti_liberi int, in_attesa int, stato text, prenotazione_obbligatoria boolean, prenotabile boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_s record; v_min date; v_max date;
begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  select * into v_s from public.settimana_corrente();
  v_min := (v_s.da at time zone 'Europe/Rome')::date;
  v_max := v_min + 41;
  p_da := greatest(p_da, v_min); p_a := least(p_a, v_max);
  return query
  select l.id, c.nome, c.slug, c.categoria, l.sala, l.inizio, l.fine, l.capienza,
         greatest(l.capienza - count(p.*) filter (where p.stato = 'confermata'), 0)::int,
         (count(p.*) filter (where p.stato = 'attesa'))::int,
         l.stato, c.prenotazione_obbligatoria,
         (now() >= public._apertura_prenotazioni(l.inizio) and l.inizio > now() and l.stato <> 'annullata')
  from public.lezioni l
  join public.corsi c on c.id = l.corso_id
  left join public.prenotazioni p on p.lezione_id = l.id
  where l.pubblicata
    and l.inizio >= (p_da::timestamp at time zone 'Europe/Rome')
    and l.inizio <  ((p_a + 1)::timestamp at time zone 'Europe/Rome')
  group by l.id, c.id
  order by l.inizio, c.nome;
end $$;

revoke all on function public._apertura_prenotazioni(timestamptz) from public, anon;
grant execute on function public._apertura_prenotazioni(timestamptz) to authenticated;
revoke all on function public.prenota_iscritto(bigint,text) from public, anon;
grant execute on function public.prenota_iscritto(bigint,text) to authenticated;

-- 2026-11-09: l'app non mostra più l'orario previsto delle settimane non pubblicate
revoke execute on function public.palinsesto_pubblico() from authenticated;
