-- =====================================================================
-- WHY NOT Fitness Club - dati iniziali (dev)
-- Corsi: data/corsi.json (brochure Stagione 2026/2027). Palinsesto: brochure pag. 3 (Sala 1) e pag. 4 (Sala 2).
-- ATTENZIONE: la capienza (20 posti) è un valore provvisorio da sostituire con quella reale di ogni corso/sala.
-- Fasce condivise (es. "Hatha Yoga / Pilates"): è attivo il primo corso indicato, il secondo è inserito disattivato
-- (attivo = false) con una nota: attivalo dal palinsesto se la fascia va gestita diversamente.
-- Lo script si può rieseguire: non duplica i dati.
-- =====================================================================

insert into public.corsi (slug, nome, categoria, sala, capienza_default, prenotazione_obbligatoria) values
  ('sala-attrezzi-biella','Sala attrezzi','Sala attrezzi','Sala attrezzi',20,false),
  ('hatha-yoga-biella','Hatha Yoga','Posturale','Sala 1',20,false),
  ('pilates-biella','Pilates','Posturale','Sala 1',20,false),
  ('stretching-biella','Stretching','Posturale','Sala 1',20,false),
  ('harmony-flow-biella','Harmony Flow','Posturale','Sala 1',20,false),
  ('primitive-biella','Primitive','Posturale','Sala 1',20,false),
  ('circl-mobility-biella','Circl Mobility','Posturale','Sala 1',20,false),
  ('body-pump-biella','Body Pump','Tonificazione','Sala 1',20,false),
  ('step-tone-biella','Step Tone','Tonificazione','Sala 1',20,false),
  ('total-body-biella','Total Body','Tonificazione','Sala 1',20,false),
  ('gag-biella','G.A.G.','Tonificazione','Sala 1',20,false),
  ('zumba-biella','Zumba','Aerobico','Sala 1',20,false),
  ('step-coreo-biella','Step Coreo','Aerobico','Sala 1',20,false),
  ('balla-e-suda-biella','Balla e Suda','Aerobico','Sala 1',20,false),
  ('functional-step-biella','Functional Step','Funzionale','Sala 1',20,false),
  ('cross-training-biella','Cross Training','Funzionale','Sala 1',20,false),
  ('ginnastica-funzionale-biella','Funzionale','Funzionale','Sala 1',20,false),
  ('tabata-biella','Tabata','Funzionale','Sala 1',20,false),
  ('cross-cardio-biella','Cross Cardio','Funzionale','Sala 1',20,false),
  ('strong-biella','Strong','Funzionale','Sala 1',20,false),
  ('allenamento-sala-pesi-biella','Allenamento in Sala Pesi','Funzionale','Sala 1',20,false),
  ('heat-program-trekking-indoor-biella','H.E.A.T. Program','H.E.A.T. Program','Sala 2',20,true)
on conflict (slug) do nothing;

-- palinsesto settimanale (giorno: 1 = lunedì ... 7 = domenica)
with p(slug, giorno, ora_inizio, ora_fine, attivo, note) as (values
  -- Sala 1 - lunedì
  ('stretching-biella',1,'08:00','08:45',true,null),
  ('balla-e-suda-biella',1,'09:20','10:05',true,'Fascia condivisa con Step Tone'),
  ('step-tone-biella',1,'09:20','10:05',false,'Fascia condivisa con Balla e Suda'),
  ('body-pump-biella',1,'12:30','13:35',true,null),
  ('hatha-yoga-biella',1,'17:15','18:15',true,'Fascia condivisa con Pilates'),
  ('pilates-biella',1,'17:15','18:15',false,'Fascia condivisa con Hatha Yoga'),
  ('zumba-biella',1,'18:15','19:00',true,null),
  ('cross-training-biella',1,'19:00','20:00',true,null),
  ('pilates-biella',1,'20:00','20:45',true,null),
  -- martedì
  ('cross-training-biella',2,'07:00','08:00',true,null),
  ('ginnastica-funzionale-biella',2,'09:20','10:05',true,null),
  ('cross-training-biella',2,'12:30','13:30',true,null),
  ('total-body-biella',2,'17:15','18:15',true,'Fascia condivisa con G.A.G.'),
  ('gag-biella',2,'17:15','18:15',false,'Fascia condivisa con Total Body'),
  ('harmony-flow-biella',2,'18:15','19:00',true,null),
  ('body-pump-biella',2,'19:00','20:00',true,null),
  -- mercoledì
  ('hatha-yoga-biella',3,'08:00','08:45',true,null),
  ('total-body-biella',3,'09:20','10:05',true,'Fascia condivisa con G.A.G.'),
  ('gag-biella',3,'09:20','10:05',false,'Fascia condivisa con Total Body'),
  ('stretching-biella',3,'17:15','18:15',true,'Fascia condivisa con Primitive'),
  ('primitive-biella',3,'17:15','18:15',false,'Fascia condivisa con Stretching'),
  ('step-coreo-biella',3,'18:15','19:00',true,null),
  ('cross-cardio-biella',3,'19:00','20:00',true,null),
  ('circl-mobility-biella',3,'20:00','20:45',true,null),
  -- giovedì
  ('ginnastica-funzionale-biella',4,'07:00','08:00',true,null),
  ('stretching-biella',4,'09:20','10:05',true,'Fascia condivisa con Pilates'),
  ('pilates-biella',4,'09:20','10:05',false,'Fascia condivisa con Stretching'),
  ('functional-step-biella',4,'12:50','13:35',true,null),
  ('body-pump-biella',4,'17:15','18:15',true,null),
  ('zumba-biella',4,'18:15','19:00',true,null),
  ('cross-training-biella',4,'19:00','20:00',true,null),
  ('pilates-biella',4,'20:00','20:45',true,null),
  -- venerdì
  ('body-pump-biella',5,'07:00','08:00',true,null),
  ('hatha-yoga-biella',5,'08:00','08:45',true,null),
  ('cross-training-biella',5,'09:20','10:05',true,null),
  ('allenamento-sala-pesi-biella',5,'12:30','13:30',true,null),
  ('circl-mobility-biella',5,'17:15','18:15',true,null),
  ('strong-biella',5,'18:15','19:15',true,null),
  -- sabato
  ('primitive-biella',6,'10:00','10:45',true,'Fascia condivisa con Hatha Yoga'),
  ('hatha-yoga-biella',6,'10:00','10:45',false,'Fascia condivisa con Primitive'),
  ('body-pump-biella',6,'15:50','16:35',true,null),
  -- Sala 2 - H.E.A.T. Program (su prenotazione)
  ('heat-program-trekking-indoor-biella',1,'12:50','13:35',true,null),
  ('heat-program-trekking-indoor-biella',1,'18:15','19:00',true,null),
  ('heat-program-trekking-indoor-biella',1,'19:15','20:00',true,null),
  ('heat-program-trekking-indoor-biella',2,'08:00','08:45',true,null),
  ('heat-program-trekking-indoor-biella',2,'19:15','20:00',true,null),
  ('heat-program-trekking-indoor-biella',3,'12:50','13:35',true,null),
  ('heat-program-trekking-indoor-biella',3,'18:15','19:00',true,null),
  ('heat-program-trekking-indoor-biella',3,'19:15','20:00',true,null),
  ('heat-program-trekking-indoor-biella',4,'08:00','08:45',true,null),
  ('heat-program-trekking-indoor-biella',4,'18:15','19:00',true,null),
  ('heat-program-trekking-indoor-biella',4,'19:15','20:00',true,null),
  ('heat-program-trekking-indoor-biella',5,'12:50','13:35',true,null),
  ('heat-program-trekking-indoor-biella',5,'19:15','20:00',true,null),
  ('heat-program-trekking-indoor-biella',6,'11:00','11:45',true,null),
  ('heat-program-trekking-indoor-biella',6,'15:00','15:45',true,null),
  ('heat-program-trekking-indoor-biella',7,'10:00','10:45',true,null)
)
insert into public.palinsesto (corso_id, giorno, ora_inizio, ora_fine, sala, attivo, note)
select c.id, p.giorno, p.ora_inizio::time, p.ora_fine::time, c.sala, p.attivo, p.note
from p join public.corsi c on c.slug = p.slug
where not exists (
  select 1 from public.palinsesto x
  where x.corso_id = c.id and x.giorno = p.giorno and x.ora_inizio = p.ora_inizio::time
);
-- Nota: "Tabata" non ha fasce nel palinsesto della brochure; "Sunday Training" (domenica 11:00-12:00) non è
-- nell'elenco corsi della brochure e non è stato inserito.
