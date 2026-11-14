-- =====================================================================
-- WHY NOT - 2026-11-14: schede (istruttore, ricerca, notifiche) e accesso reimpostato senza perdere dati. Si può rieseguire.
--
-- 1) «Reimposta accesso» cancella l'account dell'app (serve per riattivarlo con codice e nuova password). Prima, a cascata,
--    si perdevano pesi registrati, risposte in bacheca (anche «pagato»), corsi preferiti e preferenze di notifica, e le
--    schede restavano legate all'account cancellato. Ora i dati vengono messi da parte in «dati_sospesi» e alla
--    riattivazione (stessa anagrafica) tornano sul nuovo account: schede riassociate, pesi, risposte, preferiti,
--    preferenze, e per i collaboratori anche le lezioni, le fasce del palinsesto e le schede di cui sono istruttori.
-- 2) Istruttore della scheda (schede.istruttore_id) e ricerca per lo staff: titolo, nome o email dell'iscritto,
--    periodo (data di pubblicazione, o di creazione per le bozze), istruttore, stato.
-- 3) Notifica all'iscritto quando una scheda viene pubblicata o aggiornata (a scelta dello staff), che apre le Schede.
-- =====================================================================

-- ---------- 1. dati messi da parte durante un accesso reimpostato ----------
create table if not exists public.dati_sospesi (
  iscritto_id       uuid primary key references public.iscritti(id) on delete cascade,
  vecchio_user      uuid not null,
  carichi           jsonb,
  risposte          jsonb,
  preferiti         jsonb,
  notifiche         jsonb,
  lezioni           jsonb,
  palinsesto        jsonb,
  schede_istruttore jsonb,
  creato            timestamptz not null default now()
);
alter table public.dati_sospesi enable row level security;
revoke all on table public.dati_sospesi from anon, authenticated;

alter table public.schede add column if not exists istruttore_id uuid references auth.users(id) on delete set null;

create or replace function public.admin_reimposta_accesso(p_id uuid)
returns json language plpgsql security definer set search_path = public, auth as $$
declare v_i public.iscritti%rowtype; v_cod text := public._nuovo_codice(); v_staff text; u uuid;
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  select * into v_i from public.iscritti where id = p_id for update;
  if not found then raise exception 'Iscritto inesistente'; end if;
  if v_i.user_id is null then raise exception 'L''app non è ancora attiva: genera un nuovo codice'; end if;
  if v_i.user_id = auth.uid() then raise exception 'Non puoi reimpostare il tuo stesso accesso da qui'; end if;
  select ruolo into v_staff from public.staff where user_id = v_i.user_id;
  if v_staff is not null and not public.is_admin() then raise exception 'Solo un admin può reimpostare l''accesso di un collaboratore'; end if;
  u := v_i.user_id;
  -- mette da parte tutto ciò che la cancellazione dell'account eliminerebbe o scollegherebbe
  insert into public.dati_sospesi (iscritto_id, vecchio_user, carichi, risposte, preferiti, notifiche, lezioni, palinsesto, schede_istruttore, creato)
  values (p_id, u,
    (select jsonb_agg(to_jsonb(r)) from public.registro_carichi r where r.user_id = u),
    (select jsonb_agg(to_jsonb(r)) from public.avvisi_risposte r where r.user_id = u),
    (select jsonb_agg(c.corso_id) from public.corsi_preferiti c where c.user_id = u),
    (select to_jsonb(n) from public.notifiche_pref n where n.user_id = u),
    (select jsonb_agg(l.id) from public.lezioni l where l.istruttore_id = u),
    (select jsonb_agg(p.id) from public.palinsesto p where p.istruttore_id = u),
    (select jsonb_agg(s.id) from public.schede s where s.istruttore_id = u),
    now())
  on conflict (iscritto_id) do update set vecchio_user = excluded.vecchio_user, carichi = excluded.carichi, risposte = excluded.risposte,
    preferiti = excluded.preferiti, notifiche = excluded.notifiche, lezioni = excluded.lezioni, palinsesto = excluded.palinsesto,
    schede_istruttore = excluded.schede_istruttore, creato = now();
  -- conserva il ruolo staff per la riattivazione
  update public.iscritti set ruolo_staff = coalesce(v_staff, ruolo_staff), user_id = null,
         codice_hash = public._hash_codice(v_cod), codice_scade = now() + interval '30 days', updated_at = now()
   where id = p_id;
  delete from auth.users where id = u;   -- profilo, ruolo staff e dati collegati si cancellano a cascata (copia in dati_sospesi)
  return json_build_object('id', p_id, 'codice', v_cod, 'scade', now() + interval '30 days');
end $$;
revoke all on function public.admin_reimposta_accesso(uuid) from public, anon;
grant execute on function public.admin_reimposta_accesso(uuid) to authenticated;

-- riattivazione: collega l'anagrafica e rimette i dati messi da parte sul nuovo account
create or replace function public.attivazione_collega()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_i public.iscritti%rowtype; v_s public.dati_sospesi%rowtype;
begin
  update public.iscritti set user_id = new.id, codice_hash = null, codice_scade = null, updated_at = now()
   where email = lower(new.email) and user_id is null
   returning * into v_i;
  if found then
    insert into public.profili (user_id, nome, telefono, consenso_privacy, consenso_at)
    values (new.id, v_i.nome, v_i.telefono, coalesce(new.raw_user_meta_data->>'consenso', '') = 'true', now())
    on conflict (user_id) do nothing;
    if v_i.ruolo_staff is not null then
      insert into public.staff (user_id, ruolo, nome) values (new.id, v_i.ruolo_staff, v_i.nome)
      on conflict (user_id) do update set ruolo = excluded.ruolo;
    end if;
    update public.prenotazioni set member_id = new.id
     where member_id is null and origine in ('app','admin') and lower(email) = lower(new.email);

    select * into v_s from public.dati_sospesi where iscritto_id = v_i.id;
    if found then
     -- il ripristino non deve mai impedire la riattivazione: se fallisce, i dati restano in dati_sospesi per un nuovo tentativo
     begin
      -- schede: dal vecchio account al nuovo
      update public.schede set destinatari = array_replace(destinatari, v_s.vecchio_user, new.id) where v_s.vecchio_user = any(destinatari);
      update public.schede set member_id = new.id where member_id is null and destinatari = array[new.id];
      -- pesi registrati
      insert into public.registro_carichi (user_id, scheda_id, giorno, esercizio_idx, esercizio_id, esercizio, data, serie, kg, rip, created_at)
      select new.id, case when exists (select 1 from public.schede s where s.id = x.scheda_id) then x.scheda_id end,
             x.giorno, x.esercizio_idx, case when exists (select 1 from public.esercizi z where z.id = x.esercizio_id) then x.esercizio_id end, x.esercizio, x.data, x.serie, x.kg, x.rip, coalesce(x.created_at, now())
        from jsonb_populate_recordset(null::public.registro_carichi, coalesce(v_s.carichi, '[]'::jsonb)) x
      on conflict do nothing;
      -- risposte in bacheca (con lo stato del pagamento)
      insert into public.avvisi_risposte (avviso_id, user_id, scelte, stato, ospiti, note, pagato, pagato_at, pagato_da, updated_at)
      select x.avviso_id, new.id, x.scelte, x.stato, coalesce(x.ospiti, 0), x.note, coalesce(x.pagato, false), x.pagato_at,
             case when exists (select 1 from auth.users w where w.id = x.pagato_da) then x.pagato_da end, coalesce(x.updated_at, now())
        from jsonb_populate_recordset(null::public.avvisi_risposte, coalesce(v_s.risposte, '[]'::jsonb)) x
       where exists (select 1 from public.avvisi a where a.id = x.avviso_id)
      on conflict do nothing;
      -- corsi preferiti e preferenze di notifica
      insert into public.corsi_preferiti (user_id, corso_id)
      select new.id, e::bigint from jsonb_array_elements_text(coalesce(v_s.preferiti, '[]'::jsonb)) e
       where exists (select 1 from public.corsi c where c.id = e::bigint)
      on conflict do nothing;
      if v_s.notifiche is not null then
        insert into public.notifiche_pref (user_id, promemoria_min, lista, annullate, avvisi, settimana, updated_at)
        select new.id, coalesce(n.promemoria_min, 120), coalesce(n.lista, true), coalesce(n.annullate, true), coalesce(n.avvisi, true), coalesce(n.settimana, true), now()
          from jsonb_populate_record(null::public.notifiche_pref, v_s.notifiche) n
        on conflict (user_id) do update set promemoria_min = excluded.promemoria_min, lista = excluded.lista, annullate = excluded.annullate,
          avvisi = excluded.avvisi, settimana = excluded.settimana;
      end if;
      -- collaboratori: lezioni, fasce del palinsesto e schede di cui erano istruttori
      update public.lezioni set istruttore_id = new.id where istruttore_id is null and id in (select e::bigint from jsonb_array_elements_text(coalesce(v_s.lezioni, '[]'::jsonb)) e);
      update public.palinsesto set istruttore_id = new.id where istruttore_id is null and id in (select e::bigint from jsonb_array_elements_text(coalesce(v_s.palinsesto, '[]'::jsonb)) e);
      update public.schede set istruttore_id = new.id where istruttore_id is null and id in (select e::uuid from jsonb_array_elements_text(coalesce(v_s.schede_istruttore, '[]'::jsonb)) e);
      delete from public.dati_sospesi where iscritto_id = v_i.id;
     exception when others then
      raise warning 'ripristino dati sospesi non riuscito per %: %', v_i.email, sqlerrm;
     end;
    end if;
  end if;
  return new;
end $$;

-- ---------- 2. ricerca delle schede per lo staff ----------
create or replace function public.admin_schede(p_cerca text default null, p_da date default null, p_a date default null,
                                               p_istruttore uuid default null, p_stato text default null)
returns table (id uuid, titolo text, obiettivo text, livello text, stato text, updated_at timestamptz, pubblicata_il timestamptz, created_at timestamptz,
               destinatari uuid[], member_id uuid, struttura jsonb, contenuto text, istruttore_id uuid, istruttore text, persone jsonb)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_pat text := case when nullif(trim(coalesce(p_cerca, '')), '') is null then null
                           else '%' || replace(replace(replace(lower(trim(p_cerca)), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  return query
  select s.id, s.titolo, s.obiettivo, s.livello, s.stato, s.updated_at, s.pubblicata_il, s.created_at, s.destinatari, s.member_id, s.struttura, s.contenuto,
         s.istruttore_id, ist.nome, pe.j
  from public.schede s
  -- persone a cui è assegnata (anche se il loro accesso è stato reimpostato e non ancora riattivato)
  left join lateral (
    select coalesce(jsonb_agg(jsonb_build_object('user_id', d, 'nome', coalesce(i.nome, i2.nome), 'email', coalesce(i.email, i2.email),
                                                  'in_attesa', i.id is null and i2.id is not null)), '[]'::jsonb) j
    from unnest(coalesce(nullif(s.destinatari, '{}'), case when s.member_id is not null then array[s.member_id] end, '{}'::uuid[])) d
    left join public.iscritti i on i.user_id = d
    left join public.dati_sospesi ds on ds.vecchio_user = d
    left join public.iscritti i2 on i2.id = ds.iscritto_id) pe on true
  left join lateral (select coalesce(p.nome, st.nome, u.email::text) nome from auth.users u left join public.staff st on st.user_id = u.id
                     left join public.profili p on p.user_id = u.id where u.id = s.istruttore_id) ist on true
  where (p_stato is null or s.stato = p_stato)
    and (p_istruttore is null or s.istruttore_id = p_istruttore)
    and (p_da is null or coalesce(s.pubblicata_il, s.created_at) >= (p_da::timestamp at time zone 'Europe/Rome'))
    and (p_a is null or coalesce(s.pubblicata_il, s.created_at) < ((p_a + 1)::timestamp at time zone 'Europe/Rome'))
    and (v_pat is null or lower(s.titolo) like v_pat
         or exists (select 1 from jsonb_array_elements(pe.j) e where lower(e->>'nome') like v_pat or lower(e->>'email') like v_pat))
  order by s.updated_at desc
  limit 500;
end $$;
revoke all on function public.admin_schede(text, date, date, uuid, text) from public, anon;
grant execute on function public.admin_schede(text, date, date, uuid, text) to authenticated;

-- ---------- 3. notifica di una scheda pubblicata o aggiornata ----------
create or replace function public.admin_notifica_scheda(p_id uuid, p_tipo text default 'nuova')
returns int language plpgsql security definer set search_path = public as $$
declare s public.schede%rowtype; r record; n int := 0; v_pers boolean; v_tit text; v_txt text;
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  select * into s from public.schede where id = p_id;
  if not found then raise exception 'Scheda non trovata'; end if;
  if s.stato <> 'pubblicata' then raise exception 'La scheda non è pubblicata'; end if;
  v_pers := coalesce(cardinality(s.destinatari), 0) > 0 or s.member_id is not null;
  v_tit := case when p_tipo = 'aggiornata' then 'Scheda aggiornata: ' when v_pers then 'Nuova scheda per te: ' else 'Nuova scheda disponibile: ' end || s.titolo;
  v_txt := case when p_tipo = 'aggiornata' then 'Ci sono modifiche alla tua scheda: dai un''occhiata prima del prossimo allenamento.'
                else 'Aprila nell''app: trovi esercizi, serie e recuperi, e puoi segnare i pesi di ogni serie.' end;
  for r in
    select distinct i.user_id u from public.iscritti i
     where i.attivo and i.user_id is not null
       and (case when coalesce(cardinality(s.destinatari), 0) > 0 then i.user_id = any(s.destinatari)
                 when s.member_id is not null then i.user_id = s.member_id else true end)
       and exists (select 1 from public.push_iscrizioni p where p.user_id = i.user_id) loop
    perform public._accoda_url(r.u, 'avviso', v_tit, v_txt, './?p=schede');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.admin_notifica_scheda(uuid, text) from public, anon;
grant execute on function public.admin_notifica_scheda(uuid, text) to authenticated;
