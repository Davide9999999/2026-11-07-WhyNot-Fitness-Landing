-- =====================================================================
-- WHY NOT - statistiche v2 (eseguire DOPO 2026-11-10-WhyNot-funzioni-v2.sql). Si può rieseguire.
-- admin_statistiche(da, a) ora accetta qualsiasi intervallo (anche un solo giorno o date future, max 400 giorni) e restituisce anche:
--   * giornaliero: per ogni giorno lezioni, posti, prenotati, presenze, riempimento
--   * valutazioni: per corso media, numero di voti e distribuzione 1-5; ultimi commenti
-- =====================================================================

create or replace function public.admin_statistiche(p_da date, p_a date)
returns json language plpgsql stable security definer set search_path = public as $$
declare v_da timestamptz; v_a timestamptz;
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  if p_da is null or p_a is null or p_a < p_da then raise exception 'Intervallo di date non valido'; end if;
  if p_a - p_da > 400 then raise exception 'Intervallo troppo lungo: massimo 400 giorni'; end if;
  v_da := p_da::timestamp at time zone 'Europe/Rome';
  v_a  := (p_a + 1)::timestamp at time zone 'Europe/Rome';
  return json_build_object(
    'da', p_da, 'a', p_a,
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
               round((sum(k.media * k.nv) / nullif(sum(k.nv), 0))::numeric, 1) voto, sum(k.nv) voti
        from public.lezioni l join public.corsi c on c.id = l.corso_id
        cross join lateral (
          select count(*) filter (where p.stato = 'confermata') conf,
                 count(*) filter (where p.stato = 'confermata' and p.presenza is false) ass,
                 avg(v.voto) media, count(v.*) nv
          from public.prenotazioni p left join public.valutazioni v on v.prenotazione_id = p.id where p.lezione_id = l.id) k
        where l.stato = 'programmata' and l.inizio >= v_da and l.inizio < v_a
        group by c.id) x),
    'per_fascia', (select coalesce(json_agg(x), '[]') from (
        select extract(isodow from l.inizio at time zone 'Europe/Rome')::int giorno, extract(hour from l.inizio at time zone 'Europe/Rome')::int ora,
               count(*) lezioni, round(100.0 * sum(k.conf) / nullif(sum(l.capienza), 0)) riempimento
        from public.lezioni l
        cross join lateral (select count(*) filter (where p.stato = 'confermata') conf from public.prenotazioni p where p.lezione_id = l.id) k
        where l.stato = 'programmata' and l.inizio >= v_da and l.inizio < v_a
        group by 1, 2) x),
    'giornaliero', (select coalesce(json_agg(x order by x.giorno), '[]') from (
        select g::date giorno,
               count(l.id) lezioni, coalesce(sum(l.capienza), 0) posti, coalesce(sum(k.conf), 0) prenotati, coalesce(sum(k.pres), 0) presenze,
               round(100.0 * sum(k.conf) / nullif(sum(l.capienza), 0)) riempimento
        from generate_series(p_da, p_a, interval '1 day') g
        left join public.lezioni l on l.stato = 'programmata'
             and l.inizio >= (g::date::timestamp at time zone 'Europe/Rome') and l.inizio < ((g::date + 1)::timestamp at time zone 'Europe/Rome')
        left join lateral (select count(*) filter (where p.stato = 'confermata') conf,
                                  count(*) filter (where p.stato = 'confermata' and p.presenza is distinct from false and l.fine <= now()) pres
                           from public.prenotazioni p where p.lezione_id = l.id) k on true
        group by g) x),
    'valutazioni', json_build_object(
      'per_corso', (select coalesce(json_agg(x order by x.media desc, x.voti desc), '[]') from (
          select c.nome corso, c.categoria, round(avg(v.voto)::numeric, 2) media, count(*) voti,
                 count(*) filter (where v.voto = 1) d1, count(*) filter (where v.voto = 2) d2, count(*) filter (where v.voto = 3) d3,
                 count(*) filter (where v.voto = 4) d4, count(*) filter (where v.voto = 5) d5
          from public.valutazioni v join public.prenotazioni p on p.id = v.prenotazione_id
          join public.lezioni l on l.id = p.lezione_id join public.corsi c on c.id = l.corso_id
          where l.inizio >= v_da and l.inizio < v_a
          group by c.id) x),
      'commenti', (select coalesce(json_agg(x order by x.quando desc), '[]') from (
          select c.nome corso, v.voto, v.commento, l.inizio quando, p.nome autore
          from public.valutazioni v join public.prenotazioni p on p.id = v.prenotazione_id
          join public.lezioni l on l.id = p.lezione_id join public.corsi c on c.id = l.corso_id
          where l.inizio >= v_da and l.inizio < v_a and v.commento is not null
          order by l.inizio desc limit 30) x)),
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

revoke all on function public.admin_statistiche(date,date) from public, anon;
grant execute on function public.admin_statistiche(date,date) to authenticated;

-- l'iscritto può lasciare un commento facoltativo insieme alle stelle (valuta_lezione lo accetta già)
