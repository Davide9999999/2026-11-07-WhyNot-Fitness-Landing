-- =====================================================================
-- WHY NOT - correzione di sicurezza (eseguire una volta nel SQL Editor; si può rieseguire)
-- Motivo: in Postgres i trigger BEFORE INSERT girano prima del controllo RLS. Con i permessi di default
-- di Supabase, un utente anonimo poteva tentare un INSERT diretto: la RLS lo bloccava, ma il trigger della
-- capienza rispondeva prima con messaggi tipo "Lezione inesistente" / "La lezione è annullata".
-- Soluzione: l'utente anonimo non ha alcun permesso diretto sulle tabelle (tranne leggere i corsi);
-- il pubblico usa solo le funzioni lezioni_settimana() e prenota_lezione().
-- =====================================================================

revoke all on table public.palinsesto, public.lezioni, public.prenotazioni, public.schede, public.staff, public.ai_audit from anon;
revoke insert, update, delete, truncate, references, trigger on table public.corsi from anon;
grant select on table public.corsi to anon;

-- anche le sequenze delle tabelle non servono all'anonimo
revoke all on all sequences in schema public from anon;

-- le tabelle create in futuro non danno permessi all'anonimo per default
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- difesa in profondità: il trigger della capienza non risponde a chi non è staff né passa da prenota_lezione()
create or replace function public.prenotazioni_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_lezione public.lezioni%rowtype;
  v_confermate int;
begin
  if not public.is_staff() and coalesce(current_setting('whynot.prenota_pubblica', true), '') <> 'on' then
    raise exception 'Operazione non consentita' using errcode = '42501';
  end if;
  select * into v_lezione from public.lezioni where id = new.lezione_id for update;
  if not found then raise exception 'Lezione inesistente'; end if;
  if v_lezione.stato = 'annullata' then raise exception 'La lezione è annullata'; end if;
  if new.stato = 'confermata' then
    select count(*) into v_confermate from public.prenotazioni
      where lezione_id = new.lezione_id and stato = 'confermata';
    if v_confermate >= v_lezione.capienza then new.stato := 'attesa'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- prenota_lezione() segnala al trigger che l'inserimento arriva dalla funzione pubblica controllata
create or replace function public.prenota_lezione(p_lezione_id bigint, p_nome text, p_telefono text, p_email text,
                                                  p_note text default null, p_consenso boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_l public.lezioni%rowtype; v_s record; v_id uuid; v_stato text; v_pos int;
  v_tel text := nullif(regexp_replace(coalesce(p_telefono,''), '[^0-9+]', '', 'g'), '');
  v_mail text := nullif(lower(trim(coalesce(p_email,''))), '');
begin
  if not coalesce(p_consenso,false) then raise exception 'Serve il consenso al trattamento dei dati'; end if;
  if char_length(trim(coalesce(p_nome,''))) < 2 then raise exception 'Inserisci nome e cognome'; end if;
  if v_tel is null and v_mail is null then raise exception 'Inserisci telefono o email'; end if;
  if v_mail is not null and v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email non valida'; end if;

  select * into v_s from public.settimana_corrente();
  select * into v_l from public.lezioni where id = p_lezione_id;
  if not found or not v_l.pubblicata then raise exception 'Lezione non disponibile'; end if;
  if v_l.stato = 'annullata' then raise exception 'La lezione è annullata'; end if;
  if v_l.inizio < v_s.da or v_l.inizio >= v_s.a then raise exception 'Si possono prenotare solo le lezioni della settimana in corso'; end if;
  if v_l.inizio <= now() then raise exception 'La lezione è già iniziata'; end if;

  if exists (select 1 from public.prenotazioni where lezione_id = p_lezione_id and stato <> 'annullata'
             and ((v_tel is not null and telefono = v_tel) or (v_mail is not null and email = v_mail))) then
    raise exception 'Risulti già prenotato a questa lezione';
  end if;

  perform set_config('whynot.prenota_pubblica', 'on', true);   -- valido solo in questa transazione
  insert into public.prenotazioni (lezione_id, nome, telefono, email, note, origine, consenso_privacy)
  values (p_lezione_id, trim(p_nome), v_tel, v_mail, nullif(trim(coalesce(p_note,'')),''), 'sito', true)
  returning id, stato into v_id, v_stato;
  perform set_config('whynot.prenota_pubblica', '', true);

  if v_stato = 'attesa' then
    select count(*) into v_pos from public.prenotazioni
      where lezione_id = p_lezione_id and stato = 'attesa'
        and created_at <= (select created_at from public.prenotazioni where id = v_id);
  end if;
  return json_build_object('id', v_id, 'stato', v_stato, 'posizione_attesa', v_pos);
end $$;

grant execute on function public.prenota_lezione(bigint,text,text,text,text,boolean) to anon, authenticated;
