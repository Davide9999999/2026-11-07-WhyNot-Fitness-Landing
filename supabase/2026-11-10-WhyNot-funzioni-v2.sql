-- =====================================================================
-- WHY NOT - funzioni v2 (eseguire DOPO tutti i file del 2026-11-09). Si può rieseguire.
--   1. ruolo ISTRUTTORE: vede solo le proprie lezioni e fa l'appello (nome e note, niente recapiti)
--   2. presenze: prenotazioni.presenza (null = non segnata, false = assente); "frequentata" = confermata e non assente
--   3. regola di annullo: fino a N ore prima (impostazioni, default 2); chi è in lista d'attesa può uscire fino all'inizio
--   4. corsi preferiti + notifica "nuova settimana pubblicata" quando l'admin genera una settimana
--   5. schede visibili all'iscritto (a tutti o a un iscritto)
--   6. bacheca avvisi (anche per chi non ha le notifiche)
--   7. valutazione della lezione (1-5 stelle)
--   8. statistiche, iscritti inattivi con richiamo, esportazione prenotazioni
-- =====================================================================

-- ---------- 1. ruoli ----------
alter table public.staff drop constraint if exists staff_ruolo_check;
alter table public.staff add constraint staff_ruolo_check check (ruolo in ('admin','staff','istruttore'));
alter table public.iscritti drop constraint if exists iscritti_ruolo_staff_check;
alter table public.iscritti add constraint iscritti_ruolo_staff_check check (ruolo_staff is null or ruolo_staff in ('staff','admin','istruttore'));

-- lo staff "pieno" (admin e reception) ha accesso a tutto; l'istruttore no
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and ruolo in ('admin','staff'));
$$;
create or replace function public.is_istruttore()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and ruolo = 'istruttore');
$$;

alter table public.lezioni    add column if not exists istruttore_id uuid references auth.users(id) on delete set null;
alter table public.palinsesto add column if not exists istruttore_id uuid references auth.users(id) on delete set null;
create index if not exists lezioni_istruttore_idx on public.lezioni (istruttore_id, inizio) where istruttore_id is not null;

create or replace function public.admin_crea_iscritto(p_nome text, p_telefono text, p_email text, p_ruolo_staff text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_cod text := public._nuovo_codice(); v_id uuid;
  v_mail text := lower(trim(coalesce(p_email, '')));
  v_tel text := nullif(regexp_replace(coalesce(p_telefono, ''), '[^0-9+]', '', 'g'), '');
  v_ruolo text := nullif(p_ruolo_staff, '');
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  if v_ruolo is not null and not public.is_admin() then raise exception 'Solo un admin può creare collaboratori'; end if;
  if v_ruolo is not null and v_ruolo not in ('staff','admin','istruttore') then raise exception 'Ruolo non valido'; end if;
  if char_length(trim(coalesce(p_nome, ''))) < 2 then raise exception 'Inserisci nome e cognome'; end if;
  if v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email non valida'; end if;
  if exists (select 1 from public.iscritti where email = v_mail) then raise exception 'Esiste già un iscritto con questa email'; end if;
  insert into public.iscritti (nome, telefono, email, codice_hash, codice_scade, ruolo_staff)
  values (trim(p_nome), v_tel, v_mail, public._hash_codice(v_cod), now() + interval '30 days', v_ruolo)
  returning id into v_id;
  return json_build_object('id', v_id, 'codice', v_cod, 'scade', now() + interval '30 days');
end $$;

create or replace function public.admin_imposta_staff(p_id uuid, p_ruolo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_i public.iscritti%rowtype; v_ruolo text := nullif(p_ruolo, '');
begin
  if not public.is_admin() then raise exception 'Solo un admin può gestire i collaboratori'; end if;
  if v_ruolo is not null and v_ruolo not in ('staff','admin','istruttore') then raise exception 'Ruolo non valido'; end if;
  select * into v_i from public.iscritti where id = p_id;
  if not found then raise exception 'Iscritto inesistente'; end if;
  if v_i.user_id = auth.uid() and coalesce(v_ruolo, '') <> 'admin' then raise exception 'Non puoi togliere a te stesso il ruolo di admin'; end if;
  update public.iscritti set ruolo_staff = v_ruolo, updated_at = now() where id = p_id;
  if v_i.user_id is not null then
    if v_ruolo is null then delete from public.staff where user_id = v_i.user_id;
    else insert into public.staff (user_id, ruolo, nome) values (v_i.user_id, v_ruolo, v_i.nome)
         on conflict (user_id) do update set ruolo = excluded.ruolo;
    end if;
  end if;
end $$;

-- elenco istruttori (per assegnarli a palinsesto e lezioni)
create or replace function public.admin_istruttori()
returns table (user_id uuid, nome text, ruolo text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  return query select s.user_id, coalesce(p.nome, s.nome, u.email::text), s.ruolo
    from public.staff s join auth.users u on u.id = s.user_id left join public.profili p on p.user_id = s.user_id
    order by 2;
end $$;

-- ---------- 2. presenze ----------
alter table public.prenotazioni add column if not exists presenza boolean;

-- lezioni dell'istruttore collegato
create or replace function public.istruttore_lezioni(p_da date, p_a date)
returns table (id bigint, corso text, categoria text, sala text, inizio timestamptz, fine timestamptz,
               capienza int, confermate int, attesa int, stato text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not (public.is_istruttore() or public.is_staff()) then raise exception 'Accesso riservato'; end if;
  return query
  select l.id, c.nome, c.categoria, l.sala, l.inizio, l.fine, l.capienza,
         (count(p.*) filter (where p.stato = 'confermata'))::int, (count(p.*) filter (where p.stato = 'attesa'))::int, l.stato
  from public.lezioni l join public.corsi c on c.id = l.corso_id
  left join public.prenotazioni p on p.lezione_id = l.id
  where l.istruttore_id = auth.uid()
    and l.inizio >= (p_da::timestamp at time zone 'Europe/Rome') and l.inizio < ((p_a + 1)::timestamp at time zone 'Europe/Rome')
  group by l.id, c.id order by l.inizio;
end $$;

-- partecipanti per l'appello: solo nome, note e presenza (niente recapiti)
create or replace function public.appello(p_lezione_id bigint)
returns table (id uuid, nome text, note text, stato text, presenza boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not (public.is_staff() or exists (select 1 from public.lezioni where id = p_lezione_id and istruttore_id = auth.uid())) then
    raise exception 'Non è una tua lezione';
  end if;
  return query select p.id, p.nome, p.note, p.stato, p.presenza from public.prenotazioni p
    where p.lezione_id = p_lezione_id and p.stato in ('confermata','attesa') order by p.stato, p.created_at;
end $$;

create or replace function public.segna_presenza(p_prenotazione_id uuid, p_presente boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_l public.lezioni%rowtype;
begin
  select l.* into v_l from public.lezioni l join public.prenotazioni p on p.lezione_id = l.id where p.id = p_prenotazione_id;
  if not found then raise exception 'Prenotazione inesistente'; end if;
  if not (public.is_staff() or v_l.istruttore_id = auth.uid()) then raise exception 'Non è una tua lezione'; end if;
  if v_l.inizio > now() + interval '30 minutes' then raise exception 'L''appello si fa a partire da 30 minuti prima della lezione'; end if;
  update public.prenotazioni set presenza = p_presente where id = p_prenotazione_id and stato = 'confermata';
  if not found then raise exception 'Si segna la presenza solo sulle prenotazioni confermate'; end if;
end $$;

-- ---------- 3. impostazioni e regola di annullo ----------
create table if not exists public.impostazioni (chiave text primary key, valore jsonb not null, updated_at timestamptz not null default now());
alter table public.impostazioni enable row level security;
revoke all on table public.impostazioni from anon, authenticated;
grant select on table public.impostazioni to authenticated;
drop policy if exists impostazioni_read on public.impostazioni;
create policy impostazioni_read on public.impostazioni for select to authenticated using (true);
insert into public.impostazioni (chiave, valore) values ('ore_annullo', '2') on conflict (chiave) do nothing;

create or replace function public._ore_annullo()
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select (valore #>> '{}')::int from public.impostazioni where chiave = 'ore_annullo'), 2);
$$;

create or replace function public.admin_salva_impostazioni(p_ore_annullo int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo un admin può cambiare le regole'; end if;
  if p_ore_annullo is null or p_ore_annullo < 0 or p_ore_annullo > 72 then raise exception 'Ore di preavviso tra 0 e 72'; end if;
  insert into public.impostazioni (chiave, valore, updated_at) values ('ore_annullo', to_jsonb(p_ore_annullo), now())
  on conflict (chiave) do update set valore = excluded.valore, updated_at = now();
end $$;

create or replace function public.annulla_mia_prenotazione(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_p public.prenotazioni%rowtype; v_l public.lezioni%rowtype; v_ore int := public._ore_annullo();
begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  select * into v_p from public.prenotazioni where id = p_id and member_id = auth.uid() and stato <> 'annullata';
  if not found then raise exception 'Prenotazione non trovata o già annullata'; end if;
  select * into v_l from public.lezioni where id = v_p.lezione_id;
  if v_l.inizio <= now() then raise exception 'La lezione è già iniziata'; end if;
  -- chi è confermato deve rispettare il preavviso (il posto va a chi è in lista d'attesa); chi è in attesa può uscire sempre
  if v_p.stato = 'confermata' and v_l.inizio - make_interval(hours => v_ore) <= now() then
    raise exception 'Puoi annullare fino a % % prima della lezione: per disdire ora contatta la reception', v_ore, case when v_ore = 1 then 'ora' else 'ore' end;
  end if;
  update public.prenotazioni set stato = 'annullata' where id = p_id;
  return json_build_object('id', p_id, 'stato', 'annullata');
end $$;

-- ---------- 4. preferiti e "nuova settimana" ----------
create table if not exists public.corsi_preferiti (
  user_id uuid not null references auth.users(id) on delete cascade,
  corso_id bigint not null references public.corsi(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, corso_id)
);
alter table public.corsi_preferiti enable row level security;
revoke all on table public.corsi_preferiti from anon, authenticated;

create table if not exists public.settimane_avvisate (lunedi date primary key, avvisata_at timestamptz not null default now());
alter table public.settimane_avvisate enable row level security;
revoke all on table public.settimane_avvisate from anon, authenticated;

alter table public.notifiche_pref add column if not exists settimana boolean not null default true;
alter table public.notifiche_coda drop constraint if exists notifiche_coda_tipo_check;
alter table public.notifiche_coda add constraint notifiche_coda_tipo_check check (tipo in ('promemoria','lista','annullata','avviso','prova','settimana','richiamo'));

create or replace function public._accoda(p_user uuid, p_tipo text, p_titolo text, p_testo text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.notifiche_pref%rowtype;
begin
  if p_user is null then return; end if;
  if not exists (select 1 from public.push_iscrizioni where user_id = p_user) then return; end if;
  select * into v from public.notifiche_pref where user_id = p_user;
  if found and ((p_tipo = 'lista' and not v.lista) or (p_tipo = 'annullata' and not v.annullate)
             or (p_tipo in ('avviso','richiamo') and not v.avvisi) or (p_tipo = 'settimana' and not v.settimana)) then return; end if;
  insert into public.notifiche_coda (user_id, tipo, titolo, testo, url) values (p_user, p_tipo, left(p_titolo, 120), left(p_testo, 400), './');
end $$;

create or replace function public.miei_preferiti()
returns setof bigint language sql stable security definer set search_path = public as $$
  select corso_id from public.corsi_preferiti where user_id = auth.uid();
$$;

create or replace function public.imposta_preferito(p_corso_id bigint, p_preferito boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  if p_preferito then
    insert into public.corsi_preferiti (user_id, corso_id) values (auth.uid(), p_corso_id) on conflict do nothing;
  else
    delete from public.corsi_preferiti where user_id = auth.uid() and corso_id = p_corso_id;
  end if;
end $$;

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
            || case when now() >= v_ap then 'Prenotazioni aperte!' else 'Prenotazioni da domenica ' || to_char(v_ap at time zone 'Europe/Rome', 'DD/MM') || ' alle 00:00.' end;
    perform public._accoda(r.user_id, 'settimana', 'Nuova settimana pubblicata', v_testo);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- genera_settimana: copia anche l'istruttore e avvisa gli iscritti la prima volta che la settimana viene generata
create or replace function public.genera_settimana(p_lunedi date)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  if extract(isodow from p_lunedi) <> 1 then raise exception 'La data deve essere un lunedì'; end if;
  insert into public.lezioni (corso_id, inizio, fine, sala, capienza, note, palinsesto_id, istruttore_id, istruttore)
  select p.corso_id,
         ((p_lunedi + (p.giorno - 1)) + p.ora_inizio) at time zone 'Europe/Rome',
         ((p_lunedi + (p.giorno - 1)) + p.ora_fine)   at time zone 'Europe/Rome',
         coalesce(p.sala, c.sala), coalesce(p.capienza, c.capienza_default), p.note, p.id,
         p.istruttore_id, (select coalesce(pr.nome, s.nome) from public.staff s left join public.profili pr on pr.user_id = s.user_id where s.user_id = p.istruttore_id)
  from public.palinsesto p join public.corsi c on c.id = p.corso_id
  where p.attivo and c.attivo
  on conflict (corso_id, inizio, sala) do nothing;
  get diagnostics v_n = row_count;
  if v_n > 0 and p_lunedi >= ((now() at time zone 'Europe/Rome')::date - 6) then perform public._avvisa_nuova_settimana(p_lunedi); end if;
  return v_n;
end $$;

-- preferenze notifiche con "nuova settimana"
drop function if exists public.salva_notifiche(int, boolean, boolean, boolean);
create or replace function public.salva_notifiche(p_promemoria_min int, p_lista boolean, p_annullate boolean, p_avvisi boolean, p_settimana boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  insert into public.notifiche_pref (user_id, promemoria_min, lista, annullate, avvisi, settimana, updated_at)
  values (auth.uid(), p_promemoria_min, p_lista, p_annullate, p_avvisi, coalesce(p_settimana, true), now())
  on conflict (user_id) do update set promemoria_min = excluded.promemoria_min, lista = excluded.lista,
    annullate = excluded.annullate, avvisi = excluded.avvisi, settimana = excluded.settimana, updated_at = now();
end $$;

create or replace function public.mie_notifiche()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'promemoria_min', coalesce(f.promemoria_min, 120), 'lista', coalesce(f.lista, true), 'annullate', coalesce(f.annullate, true),
    'avvisi', coalesce(f.avvisi, true), 'settimana', coalesce(f.settimana, true),
    'dispositivi', (select count(*) from public.push_iscrizioni s where s.user_id = auth.uid()))
  from (select 1) x left join public.notifiche_pref f on f.user_id = auth.uid()
  where auth.uid() is not null;
$$;

-- ---------- 5. schede per l'iscritto ----------
create or replace function public.mie_schede()
returns table (id uuid, titolo text, obiettivo text, livello text, descrizione text, contenuto text, personale boolean, pubblicata_il timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.titolo, s.obiettivo, s.livello, s.descrizione, s.contenuto, s.member_id is not null, coalesce(s.pubblicata_il, s.updated_at)
  from public.schede s
  where auth.uid() is not null and s.stato = 'pubblicata' and (s.member_id is null or s.member_id = auth.uid())
  order by (s.member_id is not null) desc, coalesce(s.pubblicata_il, s.updated_at) desc;
$$;

-- ---------- 6. bacheca avvisi ----------
create table if not exists public.avvisi (
  id         bigint generated always as identity primary key,
  titolo     text not null check (char_length(titolo) between 3 and 120),
  testo      text not null check (char_length(testo) between 3 and 1000),
  autore     uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.avvisi enable row level security;
revoke all on table public.avvisi from anon, authenticated;
grant select, delete on table public.avvisi to authenticated;
drop policy if exists avvisi_read on public.avvisi;
create policy avvisi_read on public.avvisi for select to authenticated using (true);
drop policy if exists avvisi_del on public.avvisi;
create policy avvisi_del on public.avvisi for delete to authenticated using (public.is_staff());

drop function if exists public.admin_invia_avviso(text, text);
create or replace function public.admin_invia_avviso(p_titolo text, p_testo text, p_notifica boolean default true)
returns json language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; v_id bigint;
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  if char_length(trim(coalesce(p_titolo, ''))) < 3 or char_length(trim(coalesce(p_testo, ''))) < 3 then raise exception 'Scrivi titolo e testo'; end if;
  insert into public.avvisi (titolo, testo) values (trim(p_titolo), trim(p_testo)) returning id into v_id;
  if coalesce(p_notifica, true) then
    for r in select distinct i.user_id from public.iscritti i join public.push_iscrizioni s on s.user_id = i.user_id where i.attivo loop
      perform public._accoda(r.user_id, 'avviso', trim(p_titolo), left(trim(p_testo), 400));
      n := n + 1;
    end loop;
  end if;
  return json_build_object('avviso', v_id, 'notifiche', n);
end $$;

create or replace function public.bacheca()
returns table (id bigint, titolo text, testo text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.titolo, a.testo, a.created_at from public.avvisi a
  where auth.uid() is not null and a.created_at > now() - interval '60 days'
  order by a.created_at desc limit 50;
$$;

-- ---------- 7. valutazioni ----------
create table if not exists public.valutazioni (
  prenotazione_id uuid primary key references public.prenotazioni(id) on delete cascade,
  voto       smallint not null check (voto between 1 and 5),
  commento   text check (commento is null or char_length(commento) <= 300),
  created_at timestamptz not null default now()
);
alter table public.valutazioni enable row level security;
revoke all on table public.valutazioni from anon, authenticated;

create or replace function public.valuta_lezione(p_prenotazione_id uuid, p_voto int, p_commento text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_p public.prenotazioni%rowtype; v_l public.lezioni%rowtype;
begin
  select * into v_p from public.prenotazioni where id = p_prenotazione_id and member_id = auth.uid();
  if not found then raise exception 'Prenotazione non trovata'; end if;
  select * into v_l from public.lezioni where id = v_p.lezione_id;
  if v_p.stato <> 'confermata' or v_p.presenza is false or v_l.stato = 'annullata' then raise exception 'Puoi valutare solo le lezioni a cui hai partecipato'; end if;
  if v_l.fine > now() then raise exception 'Potrai valutare la lezione quando sarà finita'; end if;
  if v_l.fine < now() - interval '14 days' then raise exception 'Le lezioni si valutano entro 14 giorni'; end if;
  if p_voto not between 1 and 5 then raise exception 'Voto da 1 a 5'; end if;
  insert into public.valutazioni (prenotazione_id, voto, commento) values (p_prenotazione_id, p_voto, nullif(left(trim(coalesce(p_commento, '')), 300), ''))
  on conflict (prenotazione_id) do update set voto = excluded.voto, commento = excluded.commento, created_at = now();
end $$;

-- mie_prenotazioni: aggiunge presenza, voto e scadenza dell'annullo
drop function if exists public.mie_prenotazioni();
create function public.mie_prenotazioni()
returns table (id uuid, lezione_id bigint, corso_id bigint, corso text, slug text, categoria text, sala text,
               inizio timestamptz, fine timestamptz, stato text, lezione_stato text, posizione_attesa int, note text,
               created_at timestamptz, presenza boolean, voto smallint, annullabile_fino timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, l.id, c.id, c.nome, c.slug, c.categoria, l.sala, l.inizio, l.fine, p.stato, l.stato,
         case when p.stato = 'attesa' then
           (select count(*) from public.prenotazioni q where q.lezione_id = p.lezione_id and q.stato = 'attesa' and q.created_at <= p.created_at)::int end,
         p.note, p.created_at, p.presenza, v.voto,
         case when p.stato = 'attesa' then l.inizio else l.inizio - make_interval(hours => public._ore_annullo()) end
  from public.prenotazioni p
  join public.lezioni l on l.id = p.lezione_id
  join public.corsi c on c.id = l.corso_id
  left join public.valutazioni v on v.prenotazione_id = p.id
  where auth.uid() is not null and p.member_id = auth.uid()
  order by l.inizio desc
  limit 500;
$$;

-- frequentate = confermata, lezione finita, non segnata assente
drop function if exists public.admin_iscritti();
create function public.admin_iscritti()
returns table (id uuid, user_id uuid, nome text, telefono text, email text, stato text, attivo boolean, note text,
               iscritto_dal timestamptz, codice_scade timestamptz, ruolo_staff text,
               prenotazioni int, frequentate int, assenze int, prossime int, ultima timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  return query
  select i.id, i.user_id, coalesce(p.nome, i.nome), coalesce(p.telefono, i.telefono), i.email,
         case when not i.attivo then 'sospeso' when i.user_id is not null then 'attivo'
              when i.codice_scade is null or i.codice_scade <= now() then 'codice scaduto' else 'da attivare' end,
         i.attivo, i.note, i.created_at, i.codice_scade, coalesce(s.ruolo, i.ruolo_staff),
         (count(b.*) filter (where b.stato <> 'annullata'))::int,
         (count(b.*) filter (where b.stato = 'confermata' and l.fine <= now() and l.stato <> 'annullata' and b.presenza is distinct from false))::int,
         (count(b.*) filter (where b.stato = 'confermata' and b.presenza is false))::int,
         (count(b.*) filter (where b.stato <> 'annullata' and l.inizio > now()))::int,
         max(l.inizio) filter (where b.stato <> 'annullata')
  from public.iscritti i
  left join public.profili p on p.user_id = i.user_id
  left join public.staff s on s.user_id = i.user_id
  left join public.prenotazioni b on b.member_id = i.user_id and i.user_id is not null
  left join public.lezioni l on l.id = b.lezione_id
  group by i.id, p.user_id, s.user_id
  order by coalesce(p.nome, i.nome);
end $$;

-- ---------- 8. statistiche, inattivi, esportazione ----------
create or replace function public.admin_statistiche(p_da date, p_a date)
returns json language plpgsql stable security definer set search_path = public as $$
declare v_da timestamptz := p_da::timestamp at time zone 'Europe/Rome'; v_a timestamptz := (p_a + 1)::timestamp at time zone 'Europe/Rome';
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  return json_build_object(
    'totali', (select json_build_object(
        'lezioni', count(distinct l.id),
        'posti', (select coalesce(sum(l2.capienza), 0) from public.lezioni l2 where l2.stato = 'programmata' and l2.inizio >= v_da and l2.inizio < v_a),
        'prenotati', count(p.*) filter (where p.stato = 'confermata'),
        'assenti', count(p.*) filter (where p.stato = 'confermata' and p.presenza is false),
        'annullate', count(p.*) filter (where p.stato = 'annullata'),
        'voto_medio', round(avg(v.voto)::numeric, 2), 'voti', count(v.*))
      from public.lezioni l left join public.prenotazioni p on p.lezione_id = l.id left join public.valutazioni v on v.prenotazione_id = p.id
      where l.stato = 'programmata' and l.inizio >= v_da and l.inizio < v_a),
    'per_corso', (select coalesce(json_agg(x order by x.riempimento desc nulls last), '[]') from (
        select c.nome corso, c.categoria, count(*) lezioni, sum(l.capienza) posti, sum(k.conf) prenotati, sum(k.ass) assenti,
               round(100.0 * sum(k.conf) / nullif(sum(l.capienza), 0)) riempimento,
               (select round(avg(v.voto)::numeric, 1) from public.valutazioni v join public.prenotazioni p2 on p2.id = v.prenotazione_id
                 join public.lezioni l2 on l2.id = p2.lezione_id where l2.corso_id = c.id and l2.inizio >= v_da and l2.inizio < v_a) voto,
               (select count(*) from public.valutazioni v join public.prenotazioni p2 on p2.id = v.prenotazione_id
                 join public.lezioni l2 on l2.id = p2.lezione_id where l2.corso_id = c.id and l2.inizio >= v_da and l2.inizio < v_a) voti
        from public.lezioni l join public.corsi c on c.id = l.corso_id
        cross join lateral (select count(*) filter (where p.stato = 'confermata') conf, count(*) filter (where p.stato = 'confermata' and p.presenza is false) ass
                            from public.prenotazioni p where p.lezione_id = l.id) k
        where l.stato = 'programmata' and l.inizio >= v_da and l.inizio < v_a
        group by c.id) x),
    'per_fascia', (select coalesce(json_agg(x), '[]') from (
        select extract(isodow from l.inizio at time zone 'Europe/Rome')::int giorno, extract(hour from l.inizio at time zone 'Europe/Rome')::int ora,
               count(*) lezioni, round(100.0 * sum(k.conf) / nullif(sum(l.capienza), 0)) riempimento
        from public.lezioni l
        cross join lateral (select count(*) filter (where p.stato = 'confermata') conf from public.prenotazioni p where p.lezione_id = l.id) k
        where l.stato = 'programmata' and l.inizio >= v_da and l.inizio < v_a
        group by 1, 2) x),
    'mensile', (select coalesce(json_agg(x order by x.mese), '[]') from (
        select to_char(m, 'YYYY-MM') mese,
          (select count(*) from public.prenotazioni p join public.lezioni l on l.id = p.lezione_id
            where p.stato = 'confermata' and l.stato = 'programmata' and l.inizio >= (m::timestamp at time zone 'Europe/Rome') and l.inizio < ((m + interval '1 month')::timestamp at time zone 'Europe/Rome')) prenotati,
          (select count(*) from public.prenotazioni p join public.lezioni l on l.id = p.lezione_id
            where p.stato = 'confermata' and p.presenza is distinct from false and l.stato = 'programmata' and l.fine <= now()
              and l.inizio >= (m::timestamp at time zone 'Europe/Rome') and l.inizio < ((m + interval '1 month')::timestamp at time zone 'Europe/Rome')) frequenze,
          (select count(distinct p.member_id) from public.prenotazioni p join public.lezioni l on l.id = p.lezione_id
            where p.stato = 'confermata' and p.member_id is not null and l.inizio >= (m::timestamp at time zone 'Europe/Rome') and l.inizio < ((m + interval '1 month')::timestamp at time zone 'Europe/Rome')) iscritti_attivi,
          (select count(*) from public.iscritti i where i.created_at >= (m::timestamp at time zone 'Europe/Rome') and i.created_at < ((m + interval '1 month')::timestamp at time zone 'Europe/Rome')) nuovi_iscritti
        from generate_series(date_trunc('month', (now() at time zone 'Europe/Rome') - interval '11 months'), date_trunc('month', now() at time zone 'Europe/Rome'), interval '1 month') m) x)
  );
end $$;

-- iscritti attivi che non vengono da almeno p_giorni (default 21)
create or replace function public.admin_inattivi(p_giorni int default 21)
returns table (user_id uuid, nome text, email text, telefono text, ultima timestamptz, notifiche boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  return query
  select i.user_id, coalesce(p.nome, i.nome), i.email, coalesce(p.telefono, i.telefono),
         (select max(l.inizio) from public.prenotazioni b join public.lezioni l on l.id = b.lezione_id
           where b.member_id = i.user_id and b.stato = 'confermata' and b.presenza is distinct from false and l.inizio <= now()),
         exists (select 1 from public.push_iscrizioni s where s.user_id = i.user_id)
  from public.iscritti i left join public.profili p on p.user_id = i.user_id
  where i.attivo and i.user_id is not null and i.ruolo_staff is null
    and i.created_at < now() - make_interval(days => p_giorni)
    and not exists (select 1 from public.prenotazioni b join public.lezioni l on l.id = b.lezione_id
                     where b.member_id = i.user_id and b.stato <> 'annullata' and l.inizio > now() - make_interval(days => p_giorni))
  order by 5 nulls first;
end $$;

create or replace function public.admin_richiamo(p_utenti uuid[], p_titolo text, p_testo text)
returns int language plpgsql security definer set search_path = public as $$
declare u uuid; n int := 0;
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  if char_length(trim(coalesce(p_titolo, ''))) < 3 or char_length(trim(coalesce(p_testo, ''))) < 3 then raise exception 'Scrivi titolo e testo'; end if;
  foreach u in array coalesce(p_utenti, '{}') loop
    if exists (select 1 from public.iscritti where user_id = u and attivo) then
      perform public._accoda(u, 'richiamo', trim(p_titolo), trim(p_testo)); n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.admin_export_prenotazioni(p_da date, p_a date)
returns table (data text, ora text, corso text, sala text, istruttore text, nome text, telefono text, email text,
               stato text, presenza text, origine text, prenotata_il text, voto smallint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  return query
  select to_char(l.inizio at time zone 'Europe/Rome', 'DD/MM/YYYY'), to_char(l.inizio at time zone 'Europe/Rome', 'HH24:MI'),
         c.nome, l.sala, l.istruttore, p.nome, p.telefono, p.email, p.stato,
         case when p.presenza is true then 'presente' when p.presenza is false then 'assente' else '' end,
         p.origine, to_char(p.created_at at time zone 'Europe/Rome', 'DD/MM/YYYY HH24:MI'), v.voto
  from public.prenotazioni p join public.lezioni l on l.id = p.lezione_id join public.corsi c on c.id = l.corso_id
  left join public.valutazioni v on v.prenotazione_id = p.id
  where l.inizio >= (p_da::timestamp at time zone 'Europe/Rome') and l.inizio < ((p_a + 1)::timestamp at time zone 'Europe/Rome')
  order by l.inizio, c.nome, p.created_at;
end $$;

-- applica la capienza del corso alle sue lezioni future già generate
create or replace function public.admin_applica_capienza(p_corso_id bigint)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  update public.lezioni l set capienza = c.capienza_default from public.corsi c
   where c.id = p_corso_id and l.corso_id = c.id and l.inizio > now() and l.stato = 'programmata' and l.capienza <> c.capienza_default;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- permessi ----------
revoke all on function public.is_istruttore() from public, anon;
grant execute on function public.is_istruttore() to authenticated;
revoke all on function public._ore_annullo() from public, anon;
grant execute on function public._ore_annullo() to authenticated;
revoke all on function public._avvisa_nuova_settimana(date) from public, anon, authenticated;
do $$ declare f text; begin
  foreach f in array array[
    'admin_crea_iscritto(text,text,text,text)', 'admin_imposta_staff(uuid,text)', 'admin_istruttori()',
    'istruttore_lezioni(date,date)', 'appello(bigint)', 'segna_presenza(uuid,boolean)', 'admin_salva_impostazioni(int)',
    'annulla_mia_prenotazione(uuid)', 'miei_preferiti()', 'imposta_preferito(bigint,boolean)', 'genera_settimana(date)',
    'salva_notifiche(int,boolean,boolean,boolean,boolean)', 'mie_notifiche()', 'mie_schede()', 'admin_invia_avviso(text,text,boolean)',
    'bacheca()', 'valuta_lezione(uuid,int,text)', 'mie_prenotazioni()', 'admin_iscritti()', 'admin_statistiche(date,date)',
    'admin_inattivi(int)', 'admin_richiamo(uuid[],text,text)', 'admin_export_prenotazioni(date,date)', 'admin_applica_capienza(bigint)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
