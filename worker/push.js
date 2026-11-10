// Invio notifiche Web Push dal Worker (cron ogni minuto).
// Standard: VAPID (RFC 8292) per l'autorizzazione, cifratura aes128gcm (RFC 8291 / RFC 8188). Solo WebCrypto, nessuna libreria.
// Variabili: VAPID_PUBLIC_KEY (pubblica, in wrangler.jsonc), VAPID_PRIVATE_KEY e PUSH_SECRET (secret su Cloudflare),
// VAPID_SUBJECT (mailto: del titolare), SUPABASE_URL, SUPABASE_ANON_KEY.

const enc = new TextEncoder();

export function b64uDecode(s) {
  const b = atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
export function b64uEncode(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ""; for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const concat = (...parti) => { const n = parti.reduce((a, p) => a + p.length, 0), out = new Uint8Array(n); let o = 0; for (const p of parti) { out.set(p, o); o += p.length; } return out; };

async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8));
}

// Cifra il contenuto per un abbonamento (RFC 8291). asKeys e salt si possono passare per i test con i vettori dell'RFC.
export async function cifra(payload, p256dhB64u, authB64u, opz = {}) {
  const uaPub = b64uDecode(p256dhB64u), authSecret = b64uDecode(authB64u);
  const as = opz.asKeys || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
  const salt = opz.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const testo = concat(typeof payload === "string" ? enc.encode(payload) : payload, new Uint8Array([2]));   // 0x02 = ultimo record
  const k = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cif = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, k, testo));
  const rs = new Uint8Array([0, 0, 0x10, 0]);   // record size 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, cif);
}

let chiaveVapid = null;
// pulisce il valore incollato su Cloudflare (spazi, virgolette, eventuale "NOME=" davanti)
export const pulisci = (v) => String(v || "").trim().replace(/^[A-Z_]+\s*=\s*/, "").replace(/^["']|["']$/g, "").trim();
async function firmaVapid(env, aud) {
  if (!chiaveVapid) {
    const pub = b64uDecode(env.VAPID_PUBLIC_KEY);
    chiaveVapid = await crypto.subtle.importKey("jwk", {
      kty: "EC", crv: "P-256", d: pulisci(env.VAPID_PRIVATE_KEY, "VAPID_PRIVATE_KEY"), x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)), ext: true,
    }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  }
  const h = b64uEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const c = b64uEncode(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || "mailto:whynotfitnessclubbiella@gmail.com" })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, chiaveVapid, enc.encode(`${h}.${c}`));
  return `${h}.${c}.${b64uEncode(sig)}`;
}

async function inviaUna(env, n) {
  const corpo = await cifra(JSON.stringify({ title: n.titolo, body: n.testo, url: n.url || "./", tag: `${n.tipo}-${n.coda_id}` }), n.p256dh, n.auth);
  const jwt = await firmaVapid(env, new URL(n.endpoint).origin);
  const r = await fetch(n.endpoint, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", "content-encoding": "aes128gcm", ttl: "21600", urgency: n.tipo === "promemoria" || n.tipo === "lista" ? "high" : "normal",
      authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}` },
    body: corpo,
  });
  return r.status;
}

async function rpc(env, nome, args) {
  const r = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/${nome}`, {
    method: "POST", headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, "content-type": "application/json" }, body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`${nome}: ${r.status} ${await r.text()}`);
  return r.json();
}

// Un giro: legge la coda, invia, toglie gli abbonamenti scaduti. Restituisce un riepilogo per i log.
export async function giroNotifiche(env) {
  if (!env.PUSH_SECRET || !env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return { saltato: "PUSH_SECRET / VAPID_PRIVATE_KEY non configurati" };
  // max 45 per giro: il piano Workers Free consente 50 richieste esterne per esecuzione (1 lettura + 45 invii + 1 pulizia);
  // il resto resta in coda e parte al giro successivo (cron ogni minuto)
  const lista = await rpc(env, "push_da_inviare", { p_segreto: env.PUSH_SECRET, p_max: 45 });
  const scadute = [], esiti = {};
  await Promise.all(lista.map(async (n) => {
    try {
      const st = await inviaUna(env, n);
      esiti[st] = (esiti[st] || 0) + 1;
      if (st === 404 || st === 410) scadute.push(n.endpoint);
    } catch (e) { esiti.errore = (esiti.errore || 0) + 1; esiti.ultimoErrore = String(e && e.message || e).slice(0, 200); }
  }));
  if (scadute.length) await rpc(env, "push_scadute", { p_segreto: env.PUSH_SECRET, p_endpoint: scadute });
  return { inviate: lista.length, esiti, scadute: scadute.length };
}
