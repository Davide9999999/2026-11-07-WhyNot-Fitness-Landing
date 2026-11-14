-- =====================================================================
-- WHY NOT - 2026-11-14: l'iscritto vede nell'app il nome del personal che ha preparato la scheda e quando è stata aggiornata.
-- mie_schede() restituisce in più: istruttore (nome) e aggiornata_il (ultima modifica). Si può rieseguire.
-- Le versioni precedenti dell'app ignorano le colonne in più.
-- =====================================================================
drop function if exists public.mie_schede();
create function public.mie_schede()
returns table (id uuid, titolo text, obiettivo text, livello text, descrizione text, contenuto text, struttura jsonb, personale boolean,
               pubblicata_il timestamptz, istruttore text, aggiornata_il timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.titolo, s.obiettivo, s.livello, s.descrizione, s.contenuto, s.struttura,
         coalesce(cardinality(s.destinatari), 0) > 0 or s.member_id is not null,
         coalesce(s.pubblicata_il, s.updated_at),
         (select coalesce(p.nome, st.nome) from public.staff st left join public.profili p on p.user_id = st.user_id where st.user_id = s.istruttore_id),
         s.updated_at
  from public.schede s
  where auth.uid() is not null and s.stato = 'pubblicata'
    and (case when coalesce(cardinality(s.destinatari), 0) > 0 then auth.uid() = any(s.destinatari)
              when s.member_id is not null then s.member_id = auth.uid()
              else true end)
  order by 8 desc, 9 desc;
$$;
revoke all on function public.mie_schede() from public, anon;
grant execute on function public.mie_schede() to authenticated;
