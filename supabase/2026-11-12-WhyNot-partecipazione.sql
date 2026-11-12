-- =====================================================================
-- WHY NOT - 2026-11-12: apertura prenotazioni al sabato alle 9:00 e corsi "a partecipazione". Si può rieseguire.
--
-- 1) Le lezioni di una settimana si prenotano dal SABATO alle 09:00 che precede la settimana (prima: domenica 00:00).
-- 2) Ogni corso ha una modalità (colonna esistente corsi.prenotazione_obbligatoria):
--      true  = SU PRENOTAZIONE: posti limitati alla capienza, poi lista d'attesa (come finora). Solo H.E.A.T. e Step Coreo.
--      false = A PARTECIPAZIONE: l'iscritto segnala "Partecipo", nessun limite di posti e nessuna lista d'attesa;
--              serve a sapere quante persone vengono. Si può togliere la partecipazione fino all'inizio della lezione.
-- 3) Se un corso passa da "su prenotazione" a "a partecipazione", chi era in lista d'attesa passa tra i confermati.
-- Eseguire in Supabase → SQL Editor (tutto il file in una volta).
-- =====================================================================

-- ---------------------------------------------------------------- 1. apertura: sabato 09:00 prima della settimana
create or replace function public._apertura_prenotazioni(p_inizio timestamptz)
returns timestamptz language sql stable set search_path = public as $$
  select (date_trunc('week', p_inizio at time zone 'Europe/Rome') - interval '2 days' + interval '9 hours') at time zone 'Europe/Rome';
$$;

-- ---------------------------------------------------------------- 2. capienza solo per i corsi su prenotazione
create or replace function public.prenotazioni_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_lezione public.lezioni%rowtype;
  v_confermate int;
  v_obbl boolean;
begin
  if not public.is_staff() and coalesce(current_setting('whynot.prenota_pubblica', true), '') <> 'on' then
    raise exception 'Operazione non consentita' using errcode = '42501';
  end if;
  select * into v_lezione from public.lezioni where id = new.lezione_id for update;
  if not found then raise exception 'Lezione inesistente'; end if;
  if v_lezione.stato = 'annullata' then raise exception 'La lezione è annullata'; end if;
  select prenotazione_obbligatoria into v_obbl from public.corsi where id = v_lezione.corso_id;
  if new.stato = 'attesa' and not coalesce(v_obbl, false) then new.stato := 'confermata'; end if;   -- a partecipazione: niente attesa
  if new.stato = 'confermata' and coalesce(v_obbl, false) then
    select count(*) into v_confermate from public.prenotazioni
      where lezione_id = new.lezione_id and stato = 'confermata';
    if v_confermate >= v_lezione.capienza then new.stato := 'attesa'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- promozione dalla lista d'attesa: per i corsi a partecipazione passano tutti
create or replace function public.promuovi_lista_attesa(p_lezione_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_capienza int; v_confermate int; v_id uuid; v_obbl boolean;
begin
  select l.capienza, c.prenotazione_obbligatoria into v_capienza, v_obbl
    from public.lezioni l join public.corsi c on c.id = l.corso_id where l.id = p_lezione_id for update of l;
  loop
    if coalesce(v_obbl, false) then
      select count(*) into v_confermate from public.prenotazioni where lezione_id = p_lezione_id and stato = 'confermata';
      exit when v_confermate >= v_capienza;
    end if;
    select id into v_id from public.prenotazioni
      where lezione_id = p_lezione_id and stato = 'attesa' order by created_at limit 1;
    exit when v_id is null;
    update public.prenotazioni set stato = 'confermata', updated_at = now() where id = v_id;
  end loop;
end $$;
revoke all on function public.promuovi_lista_attesa(bigint) from public, anon, authenticated;

-- corso passato a "partecipazione": chi era in attesa nelle lezioni future diventa confermato
create or replace function public.corsi_after_update_modalita()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if old.prenotazione_obbligatoria and not new.prenotazione_obbligatoria then
    for r in select distinct l.id from public.lezioni l join public.prenotazioni p on p.lezione_id = l.id
             where l.corso_id = new.id and l.inizio > now() and p.stato = 'attesa' loop
      perform public.promuovi_lista_attesa(r.id);
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.corsi_after_update_modalita() from public, anon, authenticated;
drop trigger if exists trg_corsi_modalita on public.corsi;
create trigger trg_corsi_modalita after update of prenotazione_obbligatoria on public.corsi
  for each row execute function public.corsi_after_update_modalita();

-- ---------------------------------------------------------------- 3. prenotazione dall'app (testo dell'apertura aggiornato)
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
    raise exception 'Le prenotazioni per questa lezione si aprono sabato % alle 9:00', to_char(v_ap at time zone 'Europe/Rome', 'DD/MM');
  end if;
  if exists (select 1 from public.prenotazioni where lezione_id = p_lezione_id and member_id = v_uid and stato <> 'annullata') then
    raise exception 'Sei già segnato a questa lezione';
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
revoke all on function public.prenota_iscritto(bigint,text) from public, anon;
grant execute on function public.prenota_iscritto(bigint,text) to authenticated;

-- annullo: per i corsi a partecipazione fino all'inizio della lezione (nessun posto da liberare per altri)
create or replace function public.annulla_mia_prenotazione(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_p public.prenotazioni%rowtype; v_l public.lezioni%rowtype; v_ore int := public._ore_annullo(); v_obbl boolean;
begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  select * into v_p from public.prenotazioni where id = p_id and member_id = auth.uid() and stato <> 'annullata';
  if not found then raise exception 'Prenotazione non trovata o già annullata'; end if;
  select * into v_l from public.lezioni where id = v_p.lezione_id;
  select prenotazione_obbligatoria into v_obbl from public.corsi where id = v_l.corso_id;
  if v_l.inizio <= now() then raise exception 'La lezione è già iniziata'; end if;
  if coalesce(v_obbl, false) and v_p.stato = 'confermata' and v_l.inizio - make_interval(hours => v_ore) <= now() then
    raise exception 'Puoi annullare fino a % % prima della lezione: per disdire ora contatta la reception', v_ore, case when v_ore = 1 then 'ora' else 'ore' end;
  end if;
  update public.prenotazioni set stato = 'annullata' where id = p_id;
  return json_build_object('id', p_id, 'stato', 'annullata');
end $$;
revoke all on function public.annulla_mia_prenotazione(uuid) from public, anon;
grant execute on function public.annulla_mia_prenotazione(uuid) to authenticated;

-- ---------------------------------------------------------------- 4. dati per l'app: modalità e numero di partecipanti
drop function if exists public.lezioni_periodo(date, date);
create function public.lezioni_periodo(p_da date, p_a date)
returns table (id bigint, corso text, slug text, categoria text, sala text, inizio timestamptz, fine timestamptz,
               capienza int, posti_liberi int, in_attesa int, stato text, prenotazione_obbligatoria boolean, prenotabile boolean, partecipanti int)
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
         (now() >= public._apertura_prenotazioni(l.inizio) and l.inizio > now() and l.stato <> 'annullata'),
         (count(p.*) filter (where p.stato = 'confermata'))::int
  from public.lezioni l
  join public.corsi c on c.id = l.corso_id
  left join public.prenotazioni p on p.lezione_id = l.id
  where l.pubblicata
    and l.inizio >= (p_da::timestamp at time zone 'Europe/Rome')
    and l.inizio <  ((p_a + 1)::timestamp at time zone 'Europe/Rome')
  group by l.id, c.id
  order by l.inizio, c.nome;
end $$;
revoke all on function public.lezioni_periodo(date,date) from public, anon;
grant execute on function public.lezioni_periodo(date,date) to authenticated;

drop function if exists public.mie_prenotazioni();
create function public.mie_prenotazioni()
returns table (id uuid, lezione_id bigint, corso_id bigint, corso text, slug text, categoria text, sala text,
               inizio timestamptz, fine timestamptz, stato text, lezione_stato text, posizione_attesa int, note text,
               created_at timestamptz, presenza boolean, voto smallint, commento text, annullabile_fino timestamptz, prenotazione_obbligatoria boolean)
language sql stable security definer set search_path = public as $$
  select p.id, l.id, c.id, c.nome, c.slug, c.categoria, l.sala, l.inizio, l.fine, p.stato, l.stato,
         case when p.stato = 'attesa' then
           (select count(*) from public.prenotazioni q where q.lezione_id = p.lezione_id and q.stato = 'attesa' and q.created_at <= p.created_at)::int end,
         p.note, p.created_at, p.presenza, v.voto, v.commento,
         case when p.stato = 'attesa' or not c.prenotazione_obbligatoria then l.inizio else l.inizio - make_interval(hours => public._ore_annullo()) end,
         c.prenotazione_obbligatoria
  from public.prenotazioni p
  join public.lezioni l on l.id = p.lezione_id
  join public.corsi c on c.id = l.corso_id
  left join public.valutazioni v on v.prenotazione_id = p.id
  where auth.uid() is not null and p.member_id = auth.uid()
  order by l.inizio desc
  limit 500;
$$;
revoke all on function public.mie_prenotazioni() from public, anon;
grant execute on function public.mie_prenotazioni() to authenticated;

-- ---------------------------------------------------------------- 5. notifica "nuova settimana": testo dell'apertura
create or replace function public._avvisa_nuova_settimana(p_lunedi date)
returns int language plpgsql security definer set search_path = public as $$
declare r record; v_pref text; v_n int := 0; v_ap timestamptz; v_testo text;
begin
  insert into public.settimane_avvisate (lunedi) values (p_lunedi) on conflict do nothing;
  if not found then return 0; end if;                                  -- già avvisata
  v_ap := public._apertura_prenotazioni((p_lunedi::timestamp + interval '12 hours') at time zone 'Europe/Rome');
  for r in select distinct i.user_id from public.iscritti i join public.push_iscrizioni s on s.user_id = i.user_id where i.attivo loop
    select string_agg(x.t, ', ' order by x.inizio) into v_pref from (
      select c.nome || ' ' || (array['lun','mar','mer','gio','ven','sab','dom'])[extract(isodow from l.inizio at time zone 'Europe/Rome')::int]
             || ' ' || to_char(l.inizio at time zone 'Europe/Rome', 'HH24:MI') t, l.inizio
      from public.lezioni l join public.corsi c on c.id = l.corso_id
      join public.corsi_preferiti f on f.corso_id = l.corso_id and f.user_id = r.user_id
      where l.pubblicata and l.stato = 'programmata'
        and l.inizio >= (p_lunedi::timestamp at time zone 'Europe/Rome') and l.inizio < ((p_lunedi + 7)::timestamp at time zone 'Europe/Rome')
      order by l.inizio limit 4) x;
    v_testo := case when v_pref is not null then 'I tuoi preferiti: ' || v_pref || '. ' else 'Le lezioni della settimana dal ' || to_char(p_lunedi, 'DD/MM') || ' sono nell''app. ' end
            || case when now() >= v_ap then 'Prenotazioni aperte!' else 'Prenotazioni da sabato ' || to_char(v_ap at time zone 'Europe/Rome', 'DD/MM') || ' alle 9:00.' end;
    perform public._accoda(r.user_id, 'settimana', 'Nuova settimana pubblicata', v_testo);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public._avvisa_nuova_settimana(date) from public, anon, authenticated;

-- ---------------------------------------------------------------- 6. modalità dei corsi: su prenotazione solo H.E.A.T. e Step Coreo
-- (il trigger sopra porta tra i confermati chi era in attesa nelle lezioni future dei corsi che diventano "a partecipazione")
update public.corsi set prenotazione_obbligatoria = (
  slug in ('heat-program-trekking-indoor-biella', 'step-coreo-biella') or nome ilike 'h.e.a.t%' or nome ilike 'step coreo')
where prenotazione_obbligatoria is distinct from (
  slug in ('heat-program-trekking-indoor-biella', 'step-coreo-biella') or nome ilike 'h.e.a.t%' or nome ilike 'step coreo');

-- controllo finale: elenco dei corsi su prenotazione (devono essere solo H.E.A.T. e Step Coreo)
select nome, prenotazione_obbligatoria as su_prenotazione from public.corsi order by prenotazione_obbligatoria desc, nome;
