// Configurazione PUBBLICA di Supabase per le pagine /prenota/ e /admin/.
// Inserire "Project URL" e "anon/publishable key" da Supabase > Project Settings > API.
// Queste chiavi sono pensate per stare nel browser: la sicurezza è garantita dalle regole RLS del database.
// NON inserire mai qui la service_role key o la chiave Anthropic.
window.WHYNOT_SUPABASE = {
  url: "",
  anonKey: ""
};
