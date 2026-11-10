-- =====================================================================
-- WHY NOT - mie_prenotazioni restituisce anche il commento della valutazione (per modificarla dall'app). Si può rieseguire.
-- =====================================================================
drop function if exists public.mie_prenotazioni();
create function public.mie_prenotazioni()
returns table (id uuid, lezione_id bigint, corso_id bigint, corso text, slug text, categoria text, sala text,
               inizio timestamptz, fine timestamptz, stato text, lezione_stato text, posizione_attesa int, note text,
               created_at timestamptz, presenza boolean, voto smallint, commento text, annullabile_fino timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, l.id, c.id, c.nome, c.slug, c.categoria, l.sala, l.inizio, l.fine, p.stato, l.stato,
         case when p.stato = 'attesa' then
           (select count(*) from public.prenotazioni q where q.lezione_id = p.lezione_id and q.stato = 'attesa' and q.created_at <= p.created_at)::int end,
         p.note, p.created_at, p.presenza, v.voto, v.commento,
         case when p.stato = 'attesa' then l.inizio else l.inizio - make_interval(hours => public._ore_annullo()) end
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
