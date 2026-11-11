# Genera le pagine corso, l'indice /corsi/, le card della home e la sitemap a partire da data/corsi.json.
# Uso (dalla cartella del progetto):  powershell -ExecutionPolicy Bypass -File tools/genera-corsi.ps1
# Nota: questo file e' volutamente solo ASCII (accenti come entita' HTML); i testi italiani stanno in data/corsi.json.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding($false)
$data = [IO.File]::ReadAllText((Join-Path $root 'data\corsi.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
$CFG = $data.config
$corsi = @($data.corsi)
$base = $CFG.base
$today = Get-Date -Format 'yyyy-MM-dd'

function E([string]$s) { if ($null -eq $s) { return '' }; return $s.Replace('&','&amp;').Replace('<','&lt;').Replace('>','&gt;').Replace('"','&quot;') }
function U([string]$s) { return [Uri]::EscapeDataString($s) }
function ToJson($o) { return ($o | ConvertTo-Json -Depth 15) }
function Mins([string]$t) { $p = $t.Split(':'); return [int]$p[0] * 60 + [int]$p[1] }
function Fascia([string]$f) { $p = $f.Split('-'); return "$($p[0]) &ndash; $($p[1])" }
function WriteFile([string]$rel, [string]$text) {
  $p = Join-Path $root $rel
  $dir = Split-Path -Parent $p
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  [IO.File]::WriteAllText($p, $text, $utf8)
}
function CatName([string]$k) { return $CFG.cats.$k.n }
function CatsLabel($c) { return ((@($c.cats) | ForEach-Object { E (CatName $_) }) -join ' &middot; ') }

$ICO_CHECK = '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>'
$ICO_CLOCK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
$ICO_CAL   = '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>'
$ICO_PIN   = '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>'
$ICO_EUR   = '<svg viewBox="0 0 24 24"><path d="M17 6.5A7 7 0 1 0 17 17.5M4 10h9M4 14h9"/></svg>'
$ICO_WA    = '<svg viewBox="0 0 24 24"><path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1a3.5 3.5 0 0 1-2-2l1-1-1-2z"/></svg>'
$ICO_ARROW = '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 5l7 7-7 7"/></svg>'

$provider = [ordered]@{
  '@type' = 'ExerciseGym'; '@id' = "$($base)#gym"; 'name' = $CFG.brand; 'telephone' = $CFG.tel; 'url' = $base
  'address' = [ordered]@{ '@type' = 'PostalAddress'; 'streetAddress' = $CFG.via; 'postalCode' = $CFG.cap; 'addressLocality' = $CFG.citta; 'addressRegion' = $CFG.prov; 'addressCountry' = 'IT' }
}

function Head([string]$title, [string]$desc, [string]$url, [string]$pre, [string]$ld) {
  $logoAbs = "$base$($CFG.logo)"
  return @"
<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>$(E $title)</title>
<meta name="description" content="$(E $desc)">
<link rel="canonical" href="$url">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#121212">
<meta property="og:type" content="website">
<meta property="og:locale" content="it_IT">
<meta property="og:site_name" content="$(E $CFG.brand)">
<meta property="og:title" content="$(E $title)">
<meta property="og:description" content="$(E $desc)">
<meta property="og:url" content="$url">
<meta property="og:image" content="$logoAbs">
<meta name="twitter:card" content="summary">
<link rel="icon" type="image/png" href="$pre$($CFG.logo)">
<link rel="apple-touch-icon" href="$pre$($CFG.logo)">
<link rel="stylesheet" href="$($pre)assets/fonts/fonts.css">
<link rel="stylesheet" href="$($pre)assets/corsi.css">
<script type="application/ld+json">
$ld
</script>
</head>
"@
}

function Header([string]$pre, [bool]$hub) {
  $cur = ''; if ($hub) { $cur = ' aria-current="page"' }
  return @"
<header class="top"><div class="wrap">
  <a class="logo" href="$pre"><img src="$pre$($CFG.logo)" alt="Logo WHY NOT Fitness Club" width="44" height="44"><b>WHY NOT<small>FITNESS CLUB</small></b></a>
  <nav class="toplinks" aria-label="Menu principale"><a href="$($pre)corsi/"$cur>Corsi</a><a href="$($pre)#prezzi">Prezzi</a><a href="$($pre)#orari">Orari</a><a href="$($pre)#faq">FAQ</a><a href="$($pre)#contatti">Contatti</a></nav>
  <a class="btn" href="tel:$($CFG.telHref)">Chiama</a>
</div></header>
"@
}

function Footer([string]$pre) {
  # stesso footer della home (index.html): logo, social, link rapidi, orari con "Aperto ora", contatti
  $ore = (@($CFG.orariApertura) | ForEach-Object { "<li><span>$(E $_[0])</span><b>$(E $_[1])</b></li>" }) -join ''
  return @"
<footer>
  <div class="f-grid">
    <div class="f-brand">
      <a href="$pre" class="f-logo"><img src="$pre$($CFG.logo)" alt="Logo WHY NOT Fitness Club" width="58" height="58" loading="lazy"><b>WHY NOT<small>FITNESS CLUB</small></b></a>
      <p>Palestra a Biella dal 2010: sala attrezzi e oltre 20 corsi fitness. Ogni allenamento inizia con una domanda: <em>perch&eacute; no?</em></p>
      <div class="f-social">
        <a href="$($CFG.instagram)" target="_blank" rel="noopener" aria-label="Instagram WHY NOT Fitness Club"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6" fill="#fff"/></svg></a>
        <a href="$($CFG.facebook)" target="_blank" rel="noopener" aria-label="Facebook WHY NOT Fitness Club"><svg viewBox="0 0 24 24"><path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z"/></svg></a>
        <a href="https://wa.me/$($CFG.wa)" target="_blank" rel="noopener" aria-label="Scrivici su WhatsApp"><svg viewBox="0 0 24 24"><path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1a3.5 3.5 0 0 1-2-2l1-1-1-2z"/></svg></a>
      </div>
    </div>
    <div role="navigation" aria-label="Link rapidi">
      <h4>Esplora</h4>
      <ul class="f-links">
        <li><a href="$($pre)#club">Il club</a></li><li><a href="$($pre)corsi/">Corsi</a></li><li><a href="$($pre)#prezzi">Prezzi</a></li>
        <li><a href="$($pre)#orari">Orari</a></li><li><a href="$($pre)#faq">FAQ</a></li><li><a href="$($pre)#contatti">Contatti</a></li>
      </ul>
    </div>
    <div>
      <h4>Orari</h4>
      <span class="f-open" id="fOpen" hidden><i></i><span></span></span>
      <ul class="f-hours">$ore</ul>
    </div>
    <div class="f-contact">
      <h4>Contatti</h4>
      <address>
        <a href="$($CFG.mapUrl)" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>$(E $CFG.via)<br>$($CFG.cap) $(E $CFG.citta) ($($CFG.prov))</a>
        <a href="tel:$($CFG.telHref)"><svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>$(E $CFG.tel)</a>
        <a href="mailto:$($CFG.email)"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>$(E $CFG.email)</a>
      </address>
      <a class="btn" href="https://wa.me/$($CFG.wa)" target="_blank" rel="noopener">Prenota una prova</a>
    </div>
  </div>
  <div class="f-bottom">
    <span>&copy; <span id="yr"></span> <b>$(E $CFG.legal)</b> &middot; P.IVA $($CFG.piva) &middot; <a href="$($pre)privacy/">Privacy</a> &middot; <a href="$($pre)cookie/">Cookie</a> &middot; <a href="#" data-cookie-prefs>Preferenze cookie</a></span>
    <a href="#" class="totop" data-totop>Torna su<span><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg></span></a>
  </div>
</footer>
<script src="$($pre)assets/corsi.js" defer></script>
<script src="$($pre)assets/footer.js" defer></script>
<script src="$($pre)assets/consenso.js" defer></script>
</body>
</html>
"@
}

function IgNote() {
  $a = $CFG.avvisoOrari
  return "<aside class=""ig-note"" role=""note""><svg viewBox=""0 0 24 24"" aria-hidden=""true""><rect x=""3"" y=""3"" width=""18"" height=""18"" rx=""5""/><circle cx=""12"" cy=""12"" r=""4""/><circle cx=""17.5"" cy=""6.5"" r="".6""/></svg><p><strong>$(E $a.titolo)</strong> $(E $a.testo) <a href=""$($CFG.instagram)"" target=""_blank"" rel=""noopener"">Vai su Instagram $(E $a.handle) &rarr;</a></p></aside>"
}

function Card($c, [string]$href) {
  $k = @($c.cats)[0]; $cat = $CFG.cats.$k
  $feat = ''; if ($c.feat) { $feat = ' feat' }
  return "<a class=""ccard$feat"" href=""$href"" style=""--accent:$($cat.color)""><span class=""tag""><svg viewBox=""0 0 24 24"">$($cat.icon)</svg>$(CatsLabel $c)</span><h3>$(E $c.nome)</h3><p>$(E $c.breve)</p><span class=""go"">Scopri il corso &rarr;</span></a>"
}

# ---------- pagine corso ----------
foreach ($c in $corsi) {
  $url = "$($base)corsi/$($c.slug)/"
  $pre = '../../'
  $k = @($c.cats)[0]; $cat = $CFG.cats.$k
  $orari = @($c.orari)
  $isHeat = @($c.cats) -contains 'heat'

  # durata e numero lezioni
  $durs = @($orari | ForEach-Object { $p = $_[1].Split('-'); (Mins $p[1]) - (Mins $p[0]) } | Sort-Object -Unique)
  $durTxt = ''
  if ($durs.Count -eq 1) { $durTxt = "$($durs[0]) minuti" } elseif ($durs.Count -gt 1) { $durTxt = "$($durs[0])&ndash;$($durs[-1]) minuti" }
  $n = $orari.Count

  # H1 con sottotitolo
  $h1main = $c.h1; $h1sub = ""; $h1sep = ""
  if ($c.h1 -match '^(.*?):\s*(.+)$') { $h1main = $Matches[1]; $h1sub = $Matches[2]; $h1sep = '<span class="sr-only">:</span>' }
  elseif ($c.h1 -match '^(.*)\s(a Biella)$') { $h1main = $Matches[1]; $h1sub = $Matches[2] }
  $h1html = (E $h1main) + $h1sep; if ($h1sub) { $h1html += " <em>$(E $h1sub)</em>" }

  # fatti rapidi
  $facts = @()
  if ($c.libero) {
    $facts += "<span class=""fact"">$ICO_CAL<span><b>7 giorni su 7</b></span></span>"
    $facts += "<span class=""fact"">$ICO_CLOCK<span>Dalle <b>6:00</b> nei feriali</span></span>"
  } elseif ($n -gt 0) {
    $lez = 'lezioni'; if ($n -eq 1) { $lez = 'lezione' }
    $facts += "<span class=""fact"">$ICO_CAL<span><b>$n $lez</b> a settimana</span></span>"
    $facts += "<span class=""fact"">$ICO_CLOCK<span>Durata <b>$durTxt</b></span></span>"
  }
  $sala = $c.sala; if (-not $sala -and -not $c.libero) { $sala = 'Sala 1' }
  if ($sala) { $facts += "<span class=""fact"">$ICO_PIN<span><b>$(E $sala)</b>$(if ($isHeat) { ' &middot; su prenotazione' })</span></span>" }
  $facts += "<span class=""fact"">$ICO_EUR<span>Compreso nell'<b>abbonamento</b></span></span>"

  $tags = (@($c.cats) | ForEach-Object { $cc = $CFG.cats.$_; "<span class=""tag"" style=""--accent:$($cc.color)""><svg viewBox=""0 0 24 24"">$($cc.icon)</svg>$(E $cc.n)</span>" }) -join ''

  $benef = (@($c.benefici) | ForEach-Object { "<li>$ICO_CHECK<span>$(E $_)</span></li>" }) -join "`n          "

  # orari
  if ($c.libero) {
    $rows = (@($CFG.orariApertura) | ForEach-Object { "<tr><td>$(E $_[0])</td><td>$(E $_[1])</td></tr>" }) -join ''
    $sched = "<table class=""sched""><caption class=""sr-only"">Orari di apertura della sala attrezzi</caption><thead><tr><th scope=""col"">Giorni</th><th scope=""col"">Orario</th></tr></thead><tbody>$rows</tbody></table>"
  } elseif ($n -gt 0) {
    $hasNote = @($orari | Where-Object { $_[2] }).Count -gt 0
    $rows = ($orari | ForEach-Object { $g = $_[0]; $nota = ''; if ($hasNote) { $nota = '<td></td>'; if ($_[2]) { $nota = "<td><small>$(E $_[2])</small></td>" } }; "<tr data-g=""$g""><td>$(E $CFG.giorni.$g)</td><td>$(Fascia $_[1])</td>$nota</tr>" }) -join "`n            "
    $thNote = ''; if ($hasNote) { $thNote = '<th scope="col">Note</th>' }
    $sched = "<table class=""sched""><caption class=""sr-only"">Giorni e orari di $(E $c.nome) a Biella</caption><thead><tr><th scope=""col"">Giorno</th><th scope=""col"">Orario</th>$thNote</tr></thead><tbody>`n            $rows`n          </tbody></table>"
  } else { $sched = '' }
  $notes = @()
  if (@($orari | Where-Object { $_[2] }).Count -gt 0) { $notes += "<p class=""note"">$(E $CFG.notaCondivise)</p>" }
  if ($c.noteOrari) { $notes += "<p class=""note"">$(E $c.noteOrari)</p>" }
  $notesHtml = $notes -join ''

  # FAQ (specifiche + comuni)
  $faqs = @(); foreach ($f in @($c.faq)) { $faqs += ,@($f[0], $f[1]) }
  if (-not $c.noAbbFaq -and -not $c.libero) { $faqs += ,@($CFG.faqAbbonamento[0], $CFG.faqAbbonamento[1]) }
  $faqs += ,@($CFG.faqPortare[0], $CFG.faqPortare[1])
  $faqHtml = ($faqs | ForEach-Object { "<details><summary><h3>$(E $_[0])</h3></summary><p>$(E $_[1])</p></details>" }) -join "`n          "

  # correlati
  $rel = @($corsi | Where-Object { $_.slug -ne $c.slug -and (@($_.cats) -contains $k) })
  if ($rel.Count -lt 3) { $rel += @($corsi | Where-Object { $_.slug -ne $c.slug -and -not (@($_.cats) -contains $k) -and -not (@($_.cats) -contains 'sala') } | Select-Object -First (3 - $rel.Count)) }
  $rel = @($rel | Select-Object -First 4)
  $relHtml = ($rel | ForEach-Object { Card $_ "../$($_.slug)/" }) -join "`n      "

  # box prezzo
  if ($isHeat) { $priceBox = "<div class=""price-box""><b>40 &euro;</b><span>al mese con l'abbonamento, oppure carnet da 10 lezioni a 50 &euro;. <a href=""$($pre)#prezzi"">Vedi i prezzi</a></span></div>" }
  else { $priceBox = "<div class=""price-box""><b>40 &euro;</b><span>al mese: abbonamento con sala attrezzi e tutti i corsi. <a href=""$($pre)#prezzi"">Vedi i prezzi</a></span></div>" }
  $formTitle = 'Richiedi <span>informazioni</span>'; if ($isHeat) { $formTitle = 'Prenota o chiedi <span>info</span>' }

  # JSON-LD
  $offers = @([ordered]@{ '@type' = 'Offer'; 'name' = 'Abbonamento mensile'; 'price' = "$($CFG.prezzoMensile).00"; 'priceCurrency' = 'EUR' })
  if ($isHeat) { $offers += [ordered]@{ '@type' = 'Offer'; 'name' = 'Carnet 10 lezioni H.E.A.T. Program'; 'price' = '50.00'; 'priceCurrency' = 'EUR' } }
  $graph = @(
    [ordered]@{ '@type' = 'WebPage'; '@id' = "$($url)#webpage"; 'url' = $url; 'name' = $c.title; 'description' = $c.meta; 'inLanguage' = 'it-IT'; 'breadcrumb' = @{ '@id' = "$($url)#breadcrumb" }; 'about' = @{ '@id' = "$($url)#service" } },
    [ordered]@{ '@type' = 'BreadcrumbList'; '@id' = "$($url)#breadcrumb"; 'itemListElement' = @(
      [ordered]@{ '@type' = 'ListItem'; 'position' = 1; 'name' = 'Home'; 'item' = $base },
      [ordered]@{ '@type' = 'ListItem'; 'position' = 2; 'name' = 'Corsi'; 'item' = "$($base)corsi/" },
      [ordered]@{ '@type' = 'ListItem'; 'position' = 3; 'name' = $c.nome; 'item' = $url }) },
    [ordered]@{ '@type' = 'Service'; '@id' = "$($url)#service"; 'name' = "$($c.nome) a Biella"; 'serviceType' = (CatName $k); 'description' = $c.intro; 'url' = $url
      'provider' = $provider; 'areaServed' = [ordered]@{ '@type' = 'City'; 'name' = 'Biella' }; 'offers' = $offers },
    [ordered]@{ '@type' = 'FAQPage'; '@id' = "$($url)#faq"; 'mainEntity' = @($faqs | ForEach-Object { [ordered]@{ '@type' = 'Question'; 'name' = $_[0]; 'acceptedAnswer' = [ordered]@{ '@type' = 'Answer'; 'text' = $_[1] } } }) }
  )
  $ld = ToJson ([ordered]@{ '@context' = 'https://schema.org'; '@graph' = $graph })

  $flag = ''; if ($c.daConfermare) { $flag = "`n<!-- (*) Descrizione da confermare con il club: vedi data/corsi.json -->" }
  $howTitle = 'Com&#39;&egrave; una <span>lezione</span>'; if ($c.libero) { $howTitle = 'Come <span>funziona</span>' }
  $schedTitle = "Orari $(E $c.nome) <span>a Biella</span>"; if ($c.libero) { $schedTitle = 'Orari di <span>apertura</span>' }

  $html = (Head $c.title $c.meta $url $pre $ld) + @"
<body style="--accent:$($cat.color)">$flag
$(Header $pre $false)
<main>
  <div class="wrap">
    <nav class="crumbs" aria-label="Percorso"><ol><li><a href="$pre">Home</a></li><li><a href="$($pre)corsi/">Corsi</a></li><li><span aria-current="page">$(E $c.nome)</span></li></ol></nav>
    <section class="c-hero">
      <div class="tags">$tags</div>
      <h1>$h1html</h1>
      <p class="lead">$(E $c.lead)</p>
      <div class="ctas"><a class="btn" href="#info">$(if ($isHeat) { 'Prenota una lezione' } else { 'Richiedi informazioni' }) $ICO_ARROW</a><a class="btn ghost" href="#orari-corso">Vedi gli orari</a></div>
      <div class="facts">$($facts -join '')</div>
    </section>
    <div class="c-layout">
      <article class="c-main">
        <section>
          <h2>$(E $c.nome): <span>il corso</span></h2>
          <p>$(E $c.intro)</p>
        </section>
        <section>
          <h2>I <span>benefici</span></h2>
          <ul class="benefits">
          $benef
          </ul>
        </section>
        <section>
          <h2>A chi &egrave; <span>adatto</span></h2>
          <p>$(E $c.perChi)</p>
        </section>
        <section>
          <h2>$howTitle</h2>
          <p>$(E $c.lezione)</p>
        </section>
        <section id="orari-corso">
          <h2>$schedTitle</h2>
          $(if (-not $c.libero) { IgNote })
          $sched
          $notesHtml
        </section>
        <section>
          <h2>Domande <span>frequenti</span></h2>
          <div class="faq">
          $faqHtml
          </div>
        </section>
      </article>
      <aside class="c-aside" id="info">
        <div class="info">
          <h2>$formTitle</h2>
          <p>Scrivici per il corso <b>$(E $c.nome)</b>: ti rispondiamo su WhatsApp o via email.</p>
          <form id="infoForm" data-corso="$(E $c.nome)" data-wa="$($CFG.wa)" data-email="$($CFG.email)" action="https://wa.me/$($CFG.wa)" method="get" target="_blank">
            <div class="field"><label for="f-nome">Nome</label><input id="f-nome" name="nome" type="text" autocomplete="given-name" placeholder="Il tuo nome"></div>
            <div class="field"><label for="f-quando">Quando preferisci allenarti?</label><select id="f-quando" name="quando"><option value="">Indifferente</option><option>Mattina</option><option>Pausa pranzo</option><option>Pomeriggio</option><option>Sera</option><option>Weekend</option></select></div>
            <div class="field"><label for="f-livello">Il tuo livello</label><select id="f-livello" name="livello"><option value="">Seleziona</option><option>Principiante</option><option>Intermedio</option><option>Esperto</option></select></div>
            <div class="field"><label for="f-msg">Messaggio (facoltativo)</label><textarea id="f-msg" name="messaggio" placeholder="Domande, obiettivi, esigenze..."></textarea></div>
            <button class="btn" type="submit">$ICO_WA Invia su WhatsApp</button>
          </form>
          <div class="alt"><a class="btn ghost" id="infoMail" href="mailto:$($CFG.email)?subject=$(U ('Informazioni corso ' + $c.nome))">Email</a><a class="btn ghost" href="tel:$($CFG.telHref)">Chiama</a></div>
          <p class="privacy">Il messaggio viene preparato sul tuo dispositivo e inviato con WhatsApp o con la tua app email: questo sito non salva i dati inseriti. <a href="$($pre)privacy/" style="text-decoration:underline">Informativa privacy</a>.</p>
        </div>
        $priceBox
      </aside>
    </div>
  </div>
  <section class="related">
    <div class="wrap">
      <h2>Potrebbe <span>interessarti</span></h2>
      <div class="cgrid">
      $relHtml
      </div>
      <p class="all"><a class="btn ghost" href="$($pre)corsi/">Tutti i corsi $ICO_ARROW</a></p>
    </div>
  </section>
</main>
"@ + (Footer $pre)
  WriteFile "corsi\$($c.slug)\index.html" $html
}

# ---------- indice /corsi/ ----------
$hubUrl = "$($base)corsi/"
$H = $CFG.hub
$catOrder = @('sala', 'posturale', 'tonificazione', 'aerobico', 'funzionale', 'heat')
$sections = foreach ($k in $catOrder) {
  $cc = $CFG.cats.$k
  $list = @($corsi | Where-Object { @($_.cats) -contains $k })
  if ($list.Count -eq 0) { continue }
  $cards = ($list | ForEach-Object { Card $_ "$($_.slug)/" }) -join "`n        "
  @"
    <section class="hub-cat" id="$k">
      <h2>$(E $cc.n) <span>($($list.Count))</span></h2>
      <p>$(E $cc.desc)</p>
      <div class="cgrid">
        $cards
      </div>
    </section>
"@
}
$hubLd = ToJson ([ordered]@{ '@context' = 'https://schema.org'; '@graph' = @(
  [ordered]@{ '@type' = 'CollectionPage'; '@id' = "$($hubUrl)#webpage"; 'url' = $hubUrl; 'name' = $H.title; 'description' = $H.meta; 'inLanguage' = 'it-IT'; 'breadcrumb' = @{ '@id' = "$($hubUrl)#breadcrumb" }; 'mainEntity' = @{ '@id' = "$($hubUrl)#lista" } },
  [ordered]@{ '@type' = 'BreadcrumbList'; '@id' = "$($hubUrl)#breadcrumb"; 'itemListElement' = @(
    [ordered]@{ '@type' = 'ListItem'; 'position' = 1; 'name' = 'Home'; 'item' = $base },
    [ordered]@{ '@type' = 'ListItem'; 'position' = 2; 'name' = 'Corsi'; 'item' = $hubUrl }) },
  [ordered]@{ '@type' = 'ItemList'; '@id' = "$($hubUrl)#lista"; 'numberOfItems' = $corsi.Count; 'itemListElement' = @(
    $i = 0; foreach ($c in $corsi) { $i++; [ordered]@{ '@type' = 'ListItem'; 'position' = $i; 'name' = $c.nome; 'url' = "$($base)corsi/$($c.slug)/" } }) }
) })
$hubHtml = (Head $H.title $H.meta $hubUrl '../' $hubLd) + @"
<body>
$(Header '../' $true)
<main>
  <div class="wrap">
    <nav class="crumbs" aria-label="Percorso"><ol><li><a href="../">Home</a></li><li><span aria-current="page">Corsi</span></li></ol></nav>
    <section class="c-hero">
      <h1>$(E $H.h1)</h1>
      <p class="lead">$(E $H.lead)</p>
      <div class="ctas"><a class="btn" href="https://wa.me/$($CFG.wa)" target="_blank" rel="noopener">$ICO_WA Chiedi su WhatsApp</a><a class="btn ghost" href="../#prezzi">Vedi i prezzi</a></div>
    </section>
    <div class="hub">
$($sections -join "`n")
    </div>
  </div>
</main>
"@ + (Footer '../')
WriteFile 'corsi\index.html' $hubHtml

# ---------- card della home (tra i marcatori CORSI:START / CORSI:END) ----------
$idxPath = Join-Path $root 'index.html'
$idx = [IO.File]::ReadAllText($idxPath, [Text.Encoding]::UTF8)
$num = 0
$homeCards = foreach ($c in $corsi) {
  $num++
  $k = @($c.cats)[0]; $cat = $CFG.cats.$k
  $feat = ''; if ($c.feat) { $feat = ' feat' }
  $note = ''; if ($c.daConfermare) { $note = ' <!-- (*) descrizione da confermare -->' }
  "    <article class=""card rv$feat"" data-cat=""$((@($c.cats)) -join ' ')""><div class=""glare""></div><div class=""top""><span class=""tag""><svg viewBox=""0 0 24 24"">$($cat.icon)</svg>$(CatsLabel $c)</span><span class=""num"">$('{0:D2}' -f $num)</span></div><h3><a class=""card-link"" href=""corsi/$($c.slug)/"">$(E $c.nome)</a></h3><p>$(E $c.breve)</p><span class=""more"">Scopri il corso &rarr;</span></article>$note"
}
$block = "<!-- CORSI:START (generato da tools/genera-corsi.ps1: non modificare a mano) -->`n" + ($homeCards -join "`n") + "`n    <!-- CORSI:END -->"
$rx = New-Object System.Text.RegularExpressions.Regex('<!-- CORSI:START.*?<!-- CORSI:END -->', [System.Text.RegularExpressions.RegexOptions]::Singleline)
if (-not $rx.IsMatch($idx)) { throw 'Marcatori CORSI:START / CORSI:END non trovati in index.html' }
$idx = $rx.Replace($idx, [System.Text.RegularExpressions.MatchEvaluator] { param($m) $block }, 1)
[IO.File]::WriteAllText($idxPath, $idx, $utf8)

# ---------- sitemap ----------
$urls = @($base, "$($base)corsi/") + @($corsi | ForEach-Object { "$($base)corsi/$($_.slug)/" })
$sm = "<?xml version=""1.0"" encoding=""UTF-8""?>`n<urlset xmlns=""http://www.sitemaps.org/schemas/sitemap/0.9"">`n" + (($urls | ForEach-Object { "  <url>`n    <loc>$_</loc>`n    <lastmod>$today</lastmod>`n  </url>" }) -join "`n") + "`n</urlset>`n"
WriteFile 'sitemap.xml' $sm

Write-Output "OK: $($corsi.Count) pagine corso, indice /corsi/, card home e sitemap ($($urls.Count) URL) generati."
