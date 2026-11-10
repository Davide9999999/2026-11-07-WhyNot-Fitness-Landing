-- =====================================================================
-- WHY NOT - schede con più destinatari. Si può rieseguire.
--   schede.destinatari uuid[]: elenco degli account a cui è rivolta (vuoto/null = tutti gli iscritti).
--   member_id resta per compatibilità: viene copiato in destinatari e non si usa più dall'editor.
-- =====================================================================
alter table public.schede add column if not exists destinatari uuid[];
update public.schede set destinatari = array[member_id] where member_id is not null and (destinatari is null or cardinality(destinatari) = 0);
create index if not exists schede_destinatari_idx on public.schede using gin (destinatari);

drop function if exists public.mie_schede();
create function public.mie_schede()
returns table (id uuid, titolo text, obiettivo text, livello text, descrizione text, contenuto text, struttura jsonb, personale boolean, pubblicata_il timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.titolo, s.obiettivo, s.livello, s.descrizione, s.contenuto, s.struttura,
         coalesce(cardinality(s.destinatari), 0) > 0 or s.member_id is not null,
         coalesce(s.pubblicata_il, s.updated_at)
  from public.schede s
  where auth.uid() is not null and s.stato = 'pubblicata'
    and (case when coalesce(cardinality(s.destinatari), 0) > 0 then auth.uid() = any(s.destinatari)
              when s.member_id is not null then s.member_id = auth.uid()
              else true end)
  order by 8 desc, 9 desc;
$$;
revoke all on function public.mie_schede() from public, anon;
grant execute on function public.mie_schede() to authenticated;
