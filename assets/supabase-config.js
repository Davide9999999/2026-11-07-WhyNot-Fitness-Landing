// Configurazione PUBBLICA di Supabase per le pagine /prenota/ e /admin/.
// Inserire "Project URL" e "anon/publishable key" da Supabase > Project Settings > API.
// Queste chiavi sono pensate per stare nel browser: la sicurezza è garantita dalle regole RLS del database.
// NON inserire mai qui la service_role key o la chiave Anthropic.
window.WHYNOT_SUPABASE = {
  url: "https://fnyvsawkdiloyujoiumx.supabase.co",
  anonKey: "sb_publishable_AoAkme4i4S0AAG1q4jW-SQ_roh-_ke_",
  // Assistente AI in stand-by: mettere true quando il Worker avrà una chiave del modello configurata
  aiEnabled: false,
  // chiave PUBBLICA per le notifiche push (deve coincidere con VAPID_PUBLIC_KEY in wrangler.jsonc)
  vapidPublicKey: "BMzRtukuI9ep3kJIEaUhRzPDPwtC4BT2r2sVGmxWVJ8mg8VdLSxwJsBNoo5Gk9mKYq6wNOauJNPvTPIdk7qRkF8"
};
