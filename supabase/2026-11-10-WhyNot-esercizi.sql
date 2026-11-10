-- =====================================================================
-- WHY NOT - catalogo esercizi e schede strutturate (eseguire DOPO 2026-11-10-WhyNot-funzioni-v2.sql). Si può rieseguire.
--   * esercizi: catalogo (gruppo muscolare, attrezzo, tipo, livello, indicazioni di esecuzione). Lo staff può aggiungerne e modificarli.
--     Le indicazioni del catalogo base sono generiche: da far rivedere a un istruttore.
--   * schede.struttura (jsonb): { settimane, frequenza, note, giorni: [ { nome, note, esercizi: [ { id, nome, gruppo, serie, rip, carico, rec, note, ss } ] } ] }
--     (ss = superserie con l'esercizio successivo; rec = recupero in secondi). Il campo testo "contenuto" resta come riepilogo.
-- =====================================================================

create table if not exists public.esercizi (
  id          bigint generated always as identity primary key,
  nome        text not null unique check (char_length(nome) between 2 and 80),
  gruppo      text not null check (gruppo in ('Petto','Dorso','Spalle','Bicipiti','Tricipiti','Quadricipiti','Femorali','Glutei','Polpacci','Addome','Cardio','Total body','Mobilità')),
  attrezzo    text not null,
  tipo        text not null default 'forza' check (tipo in ('forza','isometrico','cardio','mobilita')),
  livello     text not null default 'intermedio' check (livello in ('principiante','intermedio','avanzato')),
  descrizione text check (descrizione is null or char_length(descrizione) <= 600),
  video_url   text check (video_url is null or video_url ~ '^https://'),
  attivo      boolean not null default true,
  base        boolean not null default false,          -- true = catalogo iniziale
  created_at  timestamptz not null default now()
);
alter table public.esercizi enable row level security;
revoke all on table public.esercizi from anon;
revoke truncate, references, trigger on table public.esercizi from authenticated;
drop policy if exists esercizi_read on public.esercizi;
create policy esercizi_read on public.esercizi for select to authenticated using (attivo or public.is_staff());
drop policy if exists esercizi_staff on public.esercizi;
create policy esercizi_staff on public.esercizi for all to authenticated using (public.is_staff()) with check (public.is_staff());

alter table public.schede add column if not exists struttura jsonb;

-- l'iscritto riceve anche la struttura
drop function if exists public.mie_schede();
create function public.mie_schede()
returns table (id uuid, titolo text, obiettivo text, livello text, descrizione text, contenuto text, struttura jsonb, personale boolean, pubblicata_il timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.titolo, s.obiettivo, s.livello, s.descrizione, s.contenuto, s.struttura, s.member_id is not null, coalesce(s.pubblicata_il, s.updated_at)
  from public.schede s
  where auth.uid() is not null and s.stato = 'pubblicata' and (s.member_id is null or s.member_id = auth.uid())
  order by (s.member_id is not null) desc, coalesce(s.pubblicata_il, s.updated_at) desc;
$$;
revoke all on function public.mie_schede() from public, anon;
grant execute on function public.mie_schede() to authenticated;

-- ---------- catalogo base ----------
insert into public.esercizi (nome, gruppo, attrezzo, tipo, livello, descrizione, base) values
-- Petto
('Panca piana con bilanciere','Petto','Bilanciere','forza','intermedio','Scapole addotte e piedi a terra. Scendi controllato fino a sfiorare il petto e spingi verso l''alto senza staccare i glutei dalla panca.',true),
('Panca inclinata con bilanciere','Petto','Bilanciere','forza','intermedio','Panca a 30-45°. Bilanciere verso la parte alta del petto, gomiti a circa 45° dal busto, spinta controllata.',true),
('Panca piana con manubri','Petto','Manubri','forza','principiante','Manubri ai lati del petto, polsi dritti. Spingi verso l''alto avvicinando i manubri senza farli sbattere.',true),
('Panca inclinata con manubri','Petto','Manubri','forza','principiante','Panca a 30-45°. Scendi lento fino a sentire l''allungamento del petto e spingi sopra le spalle.',true),
('Croci con manubri su panca piana','Petto','Manubri','forza','intermedio','Gomiti leggermente piegati e fissi. Apri le braccia ad arco fino all''altezza del petto e richiudi stringendo i pettorali.',true),
('Chest press alla macchina','Petto','Macchina','forza','principiante','Regola il sedile con le maniglie all''altezza del petto. Spingi senza bloccare i gomiti e torna lento.',true),
('Croci ai cavi','Petto','Cavi','forza','intermedio','Passo avanti, busto leggermente inclinato. Porta le maniglie davanti al petto con un movimento ad arco, gomiti morbidi.',true),
('Pec deck','Petto','Macchina','forza','principiante','Schiena appoggiata, braccia all''altezza delle spalle. Chiudi davanti al petto e riapri lentamente.',true),
('Piegamenti sulle braccia','Petto','Corpo libero','forza','principiante','Mani poco più larghe delle spalle, corpo in linea dalla testa ai talloni. Scendi col petto verso terra e spingi.',true),
('Piegamenti con mani rialzate','Petto','Corpo libero','forza','principiante','Mani su panca o step: versione più facile dei piegamenti. Corpo dritto, addome contratto.',true),
('Dip alle parallele','Petto','Corpo libero','forza','avanzato','Busto leggermente inclinato in avanti. Scendi finché le spalle sono all''altezza dei gomiti e risali senza slanci.',true),
('Pullover con manubrio','Petto','Manubri','forza','intermedio','Sdraiato sulla panca, manubrio sopra il petto. Portalo dietro la testa a braccia quasi tese e torna su.',true),
-- Dorso
('Trazioni alla sbarra','Dorso','Corpo libero','forza','avanzato','Presa prona poco più larga delle spalle. Tira il petto verso la sbarra portando i gomiti in basso, scendi controllato.',true),
('Trazioni assistite','Dorso','Macchina','forza','principiante','Con macchina o elastico. Stesso movimento delle trazioni: petto verso la sbarra, scapole giù.',true),
('Lat machine avanti','Dorso','Macchina','forza','principiante','Presa larga, busto leggermente indietro. Tira la barra verso la parte alta del petto portando i gomiti verso i fianchi.',true),
('Lat machine presa stretta','Dorso','Macchina','forza','principiante','Maniglia a presa neutra. Tira verso lo sterno tenendo il petto alto, risali senza far salire le spalle.',true),
('Pulley basso','Dorso','Cavi','forza','principiante','Schiena dritta, ginocchia morbide. Tira la maniglia verso l''ombelico stringendo le scapole, torna senza curvare la schiena.',true),
('Rematore con bilanciere','Dorso','Bilanciere','forza','intermedio','Busto a circa 45°, schiena neutra. Tira il bilanciere verso l''ombelico e scendi controllato.',true),
('Rematore con manubrio a un braccio','Dorso','Manubri','forza','principiante','Mano e ginocchio sulla panca, schiena piatta. Tira il manubrio verso il fianco col gomito vicino al corpo.',true),
('Rematore alla macchina','Dorso','Macchina','forza','principiante','Petto appoggiato al cuscino. Tira le maniglie stringendo le scapole e torna lento.',true),
('Rematore inverso','Dorso','TRX','forza','principiante','Corpo dritto sotto le maniglie (TRX o bilanciere basso). Tira il petto verso le mani; più sei inclinato, più è difficile.',true),
('Iperestensioni','Dorso','Panca','forza','principiante','Bacino appoggiato al cuscino. Scendi con la schiena dritta e risali fino all''allineamento con le gambe, senza iperestendere.',true),
('Pullover ai cavi','Dorso','Cavi','forza','intermedio','In piedi davanti al cavo alto, braccia quasi tese. Porta la barra verso le cosce ad arco sentendo il gran dorsale.',true),
('Face pull ai cavi','Spalle','Cavi','forza','principiante','Corda al cavo alto. Tira verso il viso aprendo i gomiti in alto e ruotando le mani indietro.',true),
-- Spalle
('Lento avanti con bilanciere','Spalle','Bilanciere','forza','intermedio','In piedi, addome e glutei contratti. Spingi il bilanciere sopra la testa senza inarcare la schiena.',true),
('Lento con manubri da seduto','Spalle','Manubri','forza','principiante','Schienale verticale. Manubri all''altezza delle orecchie, spingi sopra la testa e scendi controllato.',true),
('Shoulder press alla macchina','Spalle','Macchina','forza','principiante','Maniglie all''altezza delle spalle. Spingi verso l''alto senza bloccare i gomiti.',true),
('Alzate laterali con manubri','Spalle','Manubri','forza','principiante','Gomiti leggermente piegati. Solleva lateralmente fino all''altezza delle spalle, senza slanci, e scendi lento.',true),
('Alzate laterali ai cavi','Spalle','Cavi','forza','intermedio','Cavo basso dal lato opposto. Solleva il braccio lateralmente fino all''altezza della spalla.',true),
('Alzate frontali con manubri','Spalle','Manubri','forza','principiante','Solleva il manubrio davanti a te fino all''altezza delle spalle, busto fermo.',true),
('Alzate posteriori a busto flesso','Spalle','Manubri','forza','intermedio','Busto quasi parallelo a terra, schiena dritta. Apri le braccia lateralmente stringendo le scapole.',true),
('Reverse pec deck','Spalle','Macchina','forza','principiante','Petto verso lo schienale. Apri le braccia all''indietro per lavorare il deltoide posteriore.',true),
('Arnold press','Spalle','Manubri','forza','intermedio','Parti con i palmi verso di te davanti al viso, ruota mentre spingi sopra la testa.',true),
('Tirate al mento con manubri','Spalle','Manubri','forza','intermedio','Manubri vicini al corpo, tira i gomiti in alto fino all''altezza delle spalle. Evita se senti fastidio alla spalla.',true),
('Scrollate con manubri','Spalle','Manubri','forza','principiante','Braccia tese, solleva le spalle verso le orecchie, pausa e scendi. Lavora il trapezio.',true),
-- Bicipiti
('Curl con bilanciere','Bicipiti','Bilanciere','forza','principiante','Gomiti fermi vicino ai fianchi. Fletti senza dondolare il busto e scendi controllato.',true),
('Curl con manubri alternato','Bicipiti','Manubri','forza','principiante','Un braccio alla volta, ruota il palmo verso l''alto durante la salita. Gomito fermo.',true),
('Curl a martello','Bicipiti','Manubri','forza','principiante','Palmi rivolti verso il corpo per tutto il movimento. Lavora anche l''avambraccio.',true),
('Curl ai cavi','Bicipiti','Cavi','forza','principiante','Cavo basso, gomiti fermi. Tensione costante anche in basso.',true),
('Curl su panca Scott','Bicipiti','Bilanciere','forza','intermedio','Braccia appoggiate al cuscino. Scendi fino quasi a distendere e risali senza staccare i gomiti.',true),
('Curl concentrato','Bicipiti','Manubri','forza','principiante','Seduto, gomito appoggiato all''interno della coscia. Movimento lento e completo.',true),
-- Tricipiti
('Push-down ai cavi','Tricipiti','Cavi','forza','principiante','Gomiti attaccati ai fianchi. Spingi la barra o la corda verso il basso fino a distendere le braccia.',true),
('French press con bilanciere EZ','Tricipiti','Bilanciere','forza','intermedio','Sdraiato, gomiti fermi puntati verso l''alto. Scendi verso la fronte e distendi.',true),
('Estensioni sopra la testa con manubrio','Tricipiti','Manubri','forza','principiante','Manubrio a due mani dietro la testa, gomiti vicini. Distendi verso l''alto.',true),
('Kickback con manubrio','Tricipiti','Manubri','forza','principiante','Busto inclinato, gomito alto e fermo. Distendi il braccio all''indietro.',true),
('Dip su panca','Tricipiti','Panca','forza','principiante','Mani sulla panca dietro di te. Scendi piegando i gomiti all''indietro e risali; piedi più vicini = più facile.',true),
('Panca piana presa stretta','Tricipiti','Bilanciere','forza','intermedio','Mani alla larghezza delle spalle, gomiti vicini al busto. Lavora tricipiti e petto.',true),
-- Quadricipiti
('Squat con bilanciere','Quadricipiti','Bilanciere','forza','intermedio','Bilanciere sui trapezi, piedi alla larghezza delle spalle. Scendi con il petto alto e le ginocchia in linea con le punte, risali spingendo coi talloni.',true),
('Front squat','Quadricipiti','Bilanciere','forza','avanzato','Bilanciere appoggiato davanti alle spalle, gomiti alti. Busto più verticale rispetto allo squat classico.',true),
('Goblet squat','Quadricipiti','Kettlebell','forza','principiante','Kettlebell o manubrio al petto. Scendi tra le ginocchia con la schiena dritta e risali.',true),
('Squat a corpo libero','Quadricipiti','Corpo libero','forza','principiante','Braccia avanti per equilibrio. Scendi come per sederti, ginocchia in linea con i piedi.',true),
('Leg press','Quadricipiti','Macchina','forza','principiante','Piedi a metà pedana. Scendi finché le ginocchia sono a circa 90° senza staccare la zona lombare.',true),
('Leg extension','Quadricipiti','Macchina','forza','principiante','Ginocchio allineato al perno della macchina. Distendi e scendi lento.',true),
('Affondi in camminata','Quadricipiti','Manubri','forza','intermedio','Passo lungo, ginocchio posteriore verso terra, busto dritto. Alterna le gambe camminando.',true),
('Affondi indietro','Quadricipiti','Corpo libero','forza','principiante','Fai un passo indietro e scendi con entrambe le ginocchia a 90°. Più facile per le ginocchia rispetto all''affondo avanti.',true),
('Split squat bulgaro','Quadricipiti','Manubri','forza','intermedio','Piede posteriore sulla panca. Scendi in verticale sulla gamba anteriore.',true),
('Step-up su box','Quadricipiti','Step','forza','principiante','Sali sul box spingendo con la gamba sopra, senza aiutarti con quella a terra.',true),
('Hack squat','Quadricipiti','Macchina','forza','intermedio','Schiena appoggiata. Scendi controllato e spingi senza bloccare le ginocchia.',true),
('Sedia al muro','Quadricipiti','Corpo libero','isometrico','principiante','Schiena al muro, cosce parallele a terra. Mantieni la posizione per il tempo indicato.',true),
-- Femorali
('Stacco rumeno con bilanciere','Femorali','Bilanciere','forza','intermedio','Ginocchia leggermente piegate e ferme. Scendi portando il bacino indietro con la schiena dritta, risali stringendo i glutei.',true),
('Stacco rumeno con manubri','Femorali','Manubri','forza','principiante','Come con il bilanciere: manubri vicini alle gambe, schiena neutra, movimento d''anca.',true),
('Leg curl sdraiato','Femorali','Macchina','forza','principiante','Bacino premuto sulla panca. Porta i talloni verso i glutei e scendi lento.',true),
('Leg curl da seduto','Femorali','Macchina','forza','principiante','Cosce bloccate dal cuscino. Fletti le ginocchia e torna controllato.',true),
('Good morning','Femorali','Bilanciere','forza','avanzato','Bilanciere sui trapezi, ginocchia morbide. Inclina il busto in avanti portando il bacino indietro, schiena dritta.',true),
('Nordic curl','Femorali','Corpo libero','forza','avanzato','In ginocchio con i talloni bloccati. Scendi in avanti il più lentamente possibile; aiutati con le mani all''inizio.',true),
('Leg curl su fitball','Femorali','Fitball','forza','intermedio','Sdraiato, talloni sulla palla e bacino sollevato. Porta la palla verso i glutei e torna.',true),
-- Glutei
('Hip thrust con bilanciere','Glutei','Bilanciere','forza','intermedio','Spalle sulla panca, bilanciere sul bacino (con imbottitura). Spingi il bacino in alto e stringi i glutei in cima.',true),
('Ponte glutei','Glutei','Corpo libero','forza','principiante','Sdraiato, piedi a terra vicino ai glutei. Solleva il bacino fino ad allineare cosce e busto.',true),
('Slanci posteriori ai cavi','Glutei','Cavi','forza','principiante','Cavigliera al cavo basso. Porta la gamba indietro senza inarcare la schiena.',true),
('Abductor machine','Glutei','Macchina','forza','principiante','Apri le gambe contro resistenza e richiudi lentamente.',true),
('Camminata laterale con elastico','Glutei','Elastici','forza','principiante','Elastico sopra le ginocchia, mezzo squat. Passi laterali mantenendo la tensione.',true),
('Stacco sumo con kettlebell','Glutei','Kettlebell','forza','principiante','Gambe larghe, punte in fuori. Scendi con la schiena dritta e risali spingendo coi talloni.',true),
('Clamshell con elastico','Glutei','Elastici','forza','principiante','Sul fianco, ginocchia piegate. Apri il ginocchio superiore tenendo i piedi uniti.',true),
-- Polpacci
('Calf raise in piedi','Polpacci','Macchina','forza','principiante','Punte su un rialzo. Sali sulle punte, pausa in alto e scendi sotto il livello del rialzo.',true),
('Calf raise da seduto','Polpacci','Macchina','forza','principiante','Ginocchia sotto il cuscino. Sali sulle punte e scendi lento.',true),
('Calf alla leg press','Polpacci','Macchina','forza','principiante','Punte sul bordo della pedana, gambe distese. Spingi con le punte.',true),
-- Addome
('Plank frontale','Addome','Corpo libero','isometrico','principiante','Avambracci a terra, corpo dritto dalla testa ai talloni. Contrai addome e glutei, respira.',true),
('Plank laterale','Addome','Corpo libero','isometrico','principiante','Su un avambraccio, bacino alto e in linea. Ripeti dall''altro lato.',true),
('Crunch a terra','Addome','Corpo libero','forza','principiante','Ginocchia piegate. Solleva le spalle da terra contraendo l''addome, senza tirare il collo.',true),
('Crunch inverso','Addome','Corpo libero','forza','principiante','Gambe piegate in alto. Porta le ginocchia verso il petto sollevando il bacino.',true),
('Bicycle crunch','Addome','Corpo libero','forza','principiante','Gomito verso il ginocchio opposto alternando, gamba distesa che non tocca terra.',true),
('Dead bug','Addome','Corpo libero','forza','principiante','Supino, braccia e gambe in alto. Distendi braccio e gamba opposti tenendo la zona lombare a terra.',true),
('Bird dog','Addome','Corpo libero','forza','principiante','In quadrupedia, distendi braccio e gamba opposti senza ruotare il bacino.',true),
('Russian twist','Addome','Palla medica','forza','intermedio','Seduto con busto inclinato, piedi sollevati o a terra. Ruota il busto da un lato all''altro.',true),
('Sollevamento gambe alla sbarra','Addome','Sbarra','forza','avanzato','Appeso alla sbarra, porta le ginocchia (o le gambe tese) verso il petto senza dondolare.',true),
('Ruota addominale','Addome','Ruota','forza','avanzato','In ginocchio, rotola in avanti tenendo l''addome contratto e la schiena dritta, torna indietro.',true),
('Pallof press ai cavi','Addome','Cavi','isometrico','principiante','Di lato al cavo, spingi la maniglia davanti al petto e resisti alla rotazione.',true),
('Mountain climber','Addome','Corpo libero','cardio','principiante','In posizione di piegamento, porta le ginocchia al petto alternando velocemente.',true),
('Hollow hold','Addome','Corpo libero','isometrico','intermedio','Supino, spalle e gambe sollevate, zona lombare schiacciata a terra. Mantieni.',true),
-- Cardio
('Tapis roulant','Cardio','Tapis roulant','cardio','principiante','Camminata veloce o corsa a ritmo costante; puoi aumentare la pendenza per intensificare.',true),
('Cyclette','Cardio','Cyclette','cardio','principiante','Sella all''altezza dell''anca. Pedala a ritmo costante o a intervalli.',true),
('Ellittica','Cardio','Ellittica','cardio','principiante','Movimento fluido braccia e gambe, busto dritto.',true),
('Vogatore','Cardio','Vogatore','cardio','intermedio','Spinta di gambe, poi busto, poi braccia; ritorno in ordine inverso.',true),
('Salto con la corda','Cardio','Corda','cardio','principiante','Salti piccoli sulle punte, polsi che girano la corda.',true),
('Jumping jack','Cardio','Corpo libero','cardio','principiante','Salta aprendo gambe e braccia, poi richiudi.',true),
('Burpee','Cardio','Corpo libero','cardio','intermedio','Squat, mani a terra, gambe indietro, piegamento (facoltativo), torna e salta.',true),
('Step salita e discesa','Cardio','Step','cardio','principiante','Sali e scendi dallo step a ritmo costante alternando la gamba che parte.',true),
('Skip alto','Cardio','Corpo libero','cardio','principiante','Corsa sul posto portando le ginocchia all''altezza dell''anca.',true),
('Box jump','Cardio','Step','cardio','avanzato','Salta sul box atterrando morbido con le ginocchia piegate; scendi camminando.',true),
-- Total body
('Stacco da terra','Total body','Bilanciere','forza','avanzato','Bilanciere sopra il centro del piede. Schiena neutra, spingi il pavimento con le gambe e distendi le anche alla fine.',true),
('Kettlebell swing','Total body','Kettlebell','forza','intermedio','Movimento d''anca, non di squat: spingi il bacino in avanti e lascia salire la kettlebell fino al petto.',true),
('Thruster con manubri','Total body','Manubri','forza','intermedio','Squat con manubri alle spalle e, risalendo, spingi sopra la testa in un unico movimento.',true),
('Clean and press con manubri','Total body','Manubri','forza','intermedio','Porta i manubri dalle ginocchia alle spalle con una spinta d''anca, poi spingi sopra la testa.',true),
('Camminata del contadino','Total body','Manubri','forza','principiante','Manubri pesanti ai lati, cammina con busto dritto e spalle basse.',true),
('Wall ball','Total body','Palla medica','forza','intermedio','Squat con palla al petto, risalendo lancia la palla al bersaglio sul muro e riprendila.',true),
('Battle rope','Total body','Corde','cardio','intermedio','Mezzo squat, onde alternate o simultanee con le corde a ritmo sostenuto.',true),
('Turkish get-up','Total body','Kettlebell','forza','avanzato','Da sdraiato a in piedi tenendo la kettlebell sopra la testa a braccio teso; movimento lento a tappe.',true),
-- Mobilità
('Gatto-mucca','Mobilità','Corpo libero','mobilita','principiante','In quadrupedia, alterna schiena arrotondata e schiena incavata seguendo il respiro.',true),
('Mobilità anche 90/90','Mobilità','Corpo libero','mobilita','principiante','Seduto con entrambe le gambe a 90°, ruota da un lato all''altro mantenendo il busto alto.',true),
('Il miglior stretching del mondo','Mobilità','Corpo libero','mobilita','principiante','Affondo, mano interna a terra, ruota il busto aprendo il braccio verso l''alto. Alterna i lati.',true),
('Stretching flessori dell''anca','Mobilità','Corpo libero','mobilita','principiante','Affondo con ginocchio posteriore a terra, spingi il bacino in avanti tenendo il busto dritto.',true),
('Stretching femorali','Mobilità','Corpo libero','mobilita','principiante','Gamba tesa su un rialzo, inclinati in avanti con la schiena dritta fino a sentire l''allungamento.',true),
('Stretching quadricipite in piedi','Mobilità','Corpo libero','mobilita','principiante','Prendi il collo del piede e porta il tallone verso il gluteo, ginocchia vicine.',true),
('Stretching pettorali al muro','Mobilità','Corpo libero','mobilita','principiante','Avambraccio al muro a 90°, ruota il busto dalla parte opposta.',true),
('Posizione del bambino','Mobilità','Corpo libero','mobilita','principiante','In ginocchio, glutei sui talloni, braccia avanti a terra. Respira e rilassa la schiena.',true),
('Foam roller dorsale','Mobilità','Foam roller','mobilita','principiante','Rullo sotto la parte alta della schiena, scorri lentamente con le mani dietro la testa.',true),
('Rotazioni toraciche','Mobilità','Corpo libero','mobilita','principiante','Sul fianco, ginocchia piegate, apri il braccio superiore ruotando il busto come un libro.',true),
('Mobilità della caviglia al muro','Mobilità','Corpo libero','mobilita','principiante','Piede vicino al muro, porta il ginocchio a toccarlo senza staccare il tallone.',true)
on conflict (nome) do nothing;
