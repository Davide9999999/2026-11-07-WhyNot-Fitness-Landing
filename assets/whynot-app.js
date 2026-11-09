// Modulo condiviso da /prenota/ e /area-personale/: client Supabase (sessione condivisa), formati, colori, utilità.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

export const cfg = window.WHYNOT_SUPABASE || {};
export const sb = cfg.url && cfg.anonKey ? createClient(cfg.url, cfg.anonKey) : null;

export const $ = (id) => document.getElementById(id);
export const TZ = "Europe/Rome";
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const F = (o) => new Intl.DateTimeFormat("it-IT", { timeZone: TZ, ...o });
export const fmt = {
  day: F({ weekday: "long", day: "numeric", month: "long" }),
  dayShort: F({ weekday: "short" }),
  dayNum: F({ day: "numeric" }),
  monthShort: F({ month: "short" }),
  dayMonth: F({ day: "numeric", month: "short" }),
  monthYear: F({ month: "long", year: "numeric" }),
  date: F({ day: "numeric", month: "long", year: "numeric" }),
  time: F({ hour: "2-digit", minute: "2-digit" }),
};
export const dayKey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
export const hourRome = (d) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(d));
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

// colori delle categorie (stessi di data/corsi.json)
const CAT = [
  ["posturale", "#a78bfa"], ["tonificazione", "#5b9bf0"], ["aerobico", "#86e06a"],
  ["funzionale", "#ffd95a"], ["h.e.a.t", "#ff944d"], ["heat", "#ff944d"], ["sala", "#e02233"],
];
export function catColor(categoria) {
  const k = String(categoria || "").toLowerCase();
  return (CAT.find(([n]) => k.startsWith(n)) || [null, "#e02233"])[1];
}

export function initials(nome) {
  return String(nome || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";
}

export function relTime(d) {
  const diff = d.getTime() - Date.now(), min = Math.round(diff / 60000);
  if (min < 0) return "";
  if (min < 60) return `tra ${min} min`;
  const h = Math.round(min / 60);
  if (dayKey(d) === dayKey(new Date())) return `oggi, tra ${h} ${h === 1 ? "ora" : "ore"}`;
  const domani = new Date(Date.now() + 86400000);
  if (dayKey(d) === dayKey(domani)) return "domani";
  const g = Math.round((new Date(dayKey(d)) - new Date(dayKey(new Date()))) / 86400000);
  return `tra ${g} giorni`;
}

// file .ics per aggiungere la lezione al calendario del telefono
export function scaricaIcs({ id, corso, sala, inizio, fine }) {
  const z = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const txt = (s) => String(s).replace(/[\\,;]/g, (c) => "\\" + c);
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//WHY NOT Fitness Club//Prenotazioni//IT", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    `UID:whynot-${id}@whynotfitnessclub`, `DTSTAMP:${z(new Date())}`, `DTSTART:${z(inizio)}`, `DTEND:${z(fine)}`,
    `SUMMARY:${txt(corso)} - WHY NOT Fitness Club`, `LOCATION:${txt(`WHY NOT Fitness Club (${sala}), Via Emma e Cerino Zegna 7, 13900 Biella`)}`,
    "BEGIN:VALARM", "TRIGGER:-PT60M", "ACTION:DISPLAY", `DESCRIPTION:${txt(corso)} tra un'ora`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  a.download = `whynot-${String(corso).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// utente loggato + profilo (null se anonimo o se le funzioni non sono ancora installate)
export async function utenteCorrente() {
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  const s = data.session;
  if (!s) return null;
  const { data: prof, error } = await sb.rpc("mio_profilo");
  return { session: s, user: s.user, profilo: error ? null : prof };
}

// messaggi di errore di Supabase Auth tradotti
export function erroreAuth(err) {
  const m = String(err?.message || err || "");
  if (/invalid login credentials/i.test(m)) return "Email o password non corretti.";
  if (/email not confirmed/i.test(m)) return "Devi prima confermare l'email: controlla la casella di posta.";
  if (/already registered|already exists/i.test(m)) return "Esiste già un account con questa email: accedi.";
  if (/signups? not allowed|signup is disabled/i.test(m)) return "Le registrazioni online non sono ancora attive.";
  if (/password should be at least|weak password/i.test(m)) return "Password troppo debole: usa almeno 8 caratteri.";
  if (/rate limit|too many/i.test(m)) return "Troppi tentativi: riprova tra qualche minuto.";
  if (/same.*password/i.test(m)) return "La nuova password deve essere diversa da quella attuale.";
  return m || "Errore imprevisto.";
}

// pulsante account nell'header (Accedi / iniziali)
export function headerAccount(el, u) {
  if (!el) return;
  if (u) {
    const nome = u.profilo?.nome || u.user.email.split("@")[0];
    el.innerHTML = `<span class="av">${esc(initials(nome))}</span><span class="lbl">${esc(String(nome).split(" ")[0])}</span>`;
    el.title = "La mia area";
  } else {
    el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><span class="lbl">Accedi</span>';
    el.title = "Accedi o registrati";
  }
}
