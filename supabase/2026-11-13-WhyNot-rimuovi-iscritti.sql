-- =====================================================================
-- WHY NOT - 2026-11-13: rimozione definitiva degli iscritti (solo admin). Si può rieseguire.
-- Per ogni iscritto:
--  - prenotazioni FUTURE annullate (il posto si libera e chi è in lista d'attesa viene promosso, con la sua notifica);
--  - prenotazioni passate conservate ma ANONIME (nome "Iscritto rimosso", niente email/telefono/note): statistiche e presenze restano giuste;
--  - commenti delle sue valutazioni cancellati (il voto resta nelle medie);
--  - account dell'app eliminato: profilo, ruolo staff, notifiche, preferiti, carichi registrati si cancellano a cascata;
--  - anagrafica e storico inviti eliminati.
-- Non si può rimuovere se stessi. Operazione non reversibile (resta il backup notturno).
-- =====================================================================

create or replace function public.admin_rimuovi_iscritti(p_ids uuid[])
returns json language plpgsql security definer set search_path = public as $$
declare x record; n_rim int := 0; n_ann int := 0; n_anon int := 0; v_no jsonb := '[]'::jsonb; v int;
begin
  if not public.is_admin() then raise exception 'Solo un admin può rimuovere gli iscritti'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'Nessun iscritto selezionato'; end if;
  if array_length(p_ids, 1) > 500 then raise exception 'Massimo 500 iscritti per volta'; end if;
  for x in select * from public.iscritti where id = any(p_ids) for update loop
    if x.user_id is not null and x.user_id = auth.uid() then
      v_no := v_no || jsonb_build_object('id', x.id, 'nome', x.nome, 'motivo', 'non puoi rimuovere te stesso');
      continue;
    end if;
    -- 1) prenotazioni future annullate (scatta la promozione dalla lista d'attesa)
    update public.prenotazioni p set stato = 'annullata'
      from public.lezioni l
     where l.id = p.lezione_id and l.inizio > now() and p.stato <> 'annullata'
       and ((x.user_id is not null and p.member_id = x.user_id) or lower(p.email) = x.email);
    get diagnostics v = row_count; n_ann := n_ann + v;
    -- 2) commenti tolti, voti conservati
    update public.valutazioni va set commento = null
      from public.prenotazioni p
     where p.id = va.prenotazione_id and va.commento is not null
       and ((x.user_id is not null and p.member_id = x.user_id) or lower(p.email) = x.email);
    -- 3) storico anonimo
    update public.prenotazioni p set nome = 'Iscritto rimosso', email = 'rimosso@anonimo.invalid', telefono = null, note = null, member_id = null
     where (x.user_id is not null and p.member_id = x.user_id) or lower(p.email) = x.email;
    get diagnostics v = row_count; n_anon := n_anon + v;
    -- 4) account dell'app (profilo, staff, notifiche, preferiti, carichi a cascata) e anagrafica (inviti a cascata)
    if x.user_id is not null then delete from auth.users where id = x.user_id; end if;
    delete from public.iscritti where id = x.id;
    n_rim := n_rim + 1;
  end loop;
  return json_build_object('rimossi', n_rim, 'prenotazioni_annullate', n_ann, 'prenotazioni_anonimizzate', n_anon, 'esclusi', v_no);
end $$;
revoke all on function public.admin_rimuovi_iscritti(uuid[]) from public, anon;
grant execute on function public.admin_rimuovi_iscritti(uuid[]) to authenticated;
