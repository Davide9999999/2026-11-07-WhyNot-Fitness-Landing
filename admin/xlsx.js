// Lettura e scrittura minima di file Excel .xlsx, senza librerie esterne.
// Un .xlsx è uno zip di file XML: si legge il primo foglio (testi, numeri, formule già calcolate) e si scrive un modello con intestazioni.

const td = new TextDecoder();

// ---------------------------------------------------------------- lettura
async function apriZip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let e = u8.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("Il file non è un Excel .xlsx valido.");
  const n = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const voci = {};
  for (let k = 0; k < n && dv.getUint32(p, true) === 0x02014b50; k++) {
    const metodo = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    voci[td.decode(u8.subarray(p + 46, p + 46 + nl))] = { metodo, size, off };
    p += 46 + nl + xl + cl;
  }
  return async (nome) => {
    const v = voci[nome] || voci[Object.keys(voci).find((x) => x.toLowerCase() === nome.toLowerCase())];
    if (!v) return null;
    const inizio = v.off + 30 + dv.getUint16(v.off + 26, true) + dv.getUint16(v.off + 28, true);
    const dati = u8.subarray(inizio, inizio + v.size);
    if (v.metodo === 0) return td.decode(dati);
    if (v.metodo !== 8) throw new Error("Compressione del file Excel non supportata: salvalo di nuovo da Excel.");
    if (typeof DecompressionStream === "undefined") throw new Error("Questo browser non legge i file Excel: aggiornalo o salva il file come CSV.");
    const flusso = new Blob([dati]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return td.decode(await new Response(flusso).arrayBuffer());
  };
}
const xml = (t) => new DOMParser().parseFromString(t, "application/xml");
const tutti = (nodo, tag) => [...nodo.getElementsByTagName(tag)];
const colonna = (rif) => { let n = 0; for (const ch of rif.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
const dataExcel = (n) => { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`; };

// restituisce { foglio, fogli, righe: [[...celle come testo]] } del primo foglio con dati
export async function leggiXlsx(buf) {
  const leggi = await apriZip(buf);
  const wb = await leggi("xl/workbook.xml");
  if (!wb) throw new Error("Il file non è un Excel .xlsx valido.");
  const W = xml(wb), rels = xml((await leggi("xl/_rels/workbook.xml.rels")) || "<Relationships/>");
  const target = {}; tutti(rels, "Relationship").forEach((r) => (target[r.getAttribute("Id")] = r.getAttribute("Target")));
  const fogli = tutti(W, "sheet").map((s) => ({ nome: s.getAttribute("name"), file: "xl/" + String(target[s.getAttribute("r:id")] || "").replace(/^\/?xl\//, "").replace(/^\//, "") }));
  const ss = await leggi("xl/sharedStrings.xml");
  const stringhe = ss ? tutti(xml(ss), "si").map((si) => tutti(si, "t").map((t) => t.textContent).join("")) : [];
  // stili con formato data (per convertire i numeri di serie in gg/mm/aaaa)
  const st = await leggi("xl/styles.xml"), dateStile = new Set();
  if (st) {
    const S = xml(st), custom = {};
    tutti(S, "numFmt").forEach((f) => (custom[f.getAttribute("numFmtId")] = f.getAttribute("formatCode") || ""));
    const xfs = S.getElementsByTagName("cellXfs")[0];
    if (xfs) tutti(xfs, "xf").forEach((x, k) => { const id = Number(x.getAttribute("numFmtId")); if ((id >= 14 && id <= 22) || (custom[id] && /[dmy]/i.test(custom[id].replace(/"[^"]*"|\[[^\]]*\]/g, "")))) dateStile.add(k); });
  }
  for (const f of fogli) {
    const testo = await leggi(f.file);
    if (!testo) continue;
    const righe = [];
    tutti(xml(testo), "row").forEach((r) => {
      const riga = [];
      tutti(r, "c").forEach((c, k) => {
        const rif = c.getAttribute("r"), j = rif ? colonna(rif) : k, t = c.getAttribute("t") || "n";
        const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
        let val;
        if (t === "s") val = stringhe[Number(v)] ?? "";
        else if (t === "inlineStr") val = tutti(c, "t").map((x) => x.textContent).join("");
        else if (t === "b") val = v === "1" ? "VERO" : "FALSO";
        else if (t === "n" && v !== "") {
          const num = Number(v);
          if (dateStile.has(Number(c.getAttribute("s") || 0)) && num > 0 && num < 2958466) val = dataExcel(num);
          else val = Number.isInteger(num) && Math.abs(num) >= 1e11 ? BigInt(Math.round(num)).toString() : Number.isInteger(num) ? String(num) : String(num).replace(".", ",");
        } else val = v;
        riga[j] = String(val).trim();
      });
      for (let j = 0; j < riga.length; j++) if (riga[j] === undefined) riga[j] = "";
      righe.push(riga);
    });
    const piene = righe.filter((x) => x.some((v) => v));
    if (piene.length) return { foglio: f.nome, fogli: fogli.length, righe: piene };
  }
  return { foglio: fogli[0]?.nome || "", fogli: fogli.length, righe: [] };
}

// ---------------------------------------------------------------- scrittura (zip senza compressione)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xffffffff; for (const b of u8) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const te = new TextEncoder(), parti = [], centrale = [];
  let off = 0;
  for (const [nome, testo] of files) {
    const n = te.encode(nome), d = te.encode(testo), c = crc32(d);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, c, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, n.length, true);
    parti.push(new Uint8Array(h.buffer), n, d);
    const z = new DataView(new ArrayBuffer(46));
    z.setUint32(0, 0x02014b50, true); z.setUint16(4, 20, true); z.setUint16(6, 20, true); z.setUint16(8, 0x0800, true); z.setUint32(16, c, true); z.setUint32(20, d.length, true); z.setUint32(24, d.length, true); z.setUint16(28, n.length, true); z.setUint32(42, off, true);
    centrale.push(new Uint8Array(z.buffer), n);
    off += 30 + n.length + d.length;
  }
  const lung = centrale.reduce((s, x) => s + x.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, lung, true); e.setUint32(16, off, true);
  return new Blob([...parti, ...centrale, new Uint8Array(e.buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
const escX = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const lettera = (j) => { let s = ""; j++; while (j) { const r = (j - 1) % 26; s = String.fromCharCode(65 + r) + s; j = Math.floor((j - 1) / 26); } return s; };
function foglioXml(righe, larghezze, conIntestazione) {
  const cols = larghezze.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${w}" style="2" customWidth="1"/>`).join("");
  const rows = righe.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => `<c r="${lettera(j)}${i + 1}" t="inlineStr" s="${conIntestazione && i === 0 ? 1 : 2}"><is><t xml:space="preserve">${escX(v)}</t></is></c>`).join("")}</row>`).join("");
  const blocco = conIntestazione ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${blocco}<cols>${cols}</cols><sheetData>${rows}</sheetData></worksheet>`;
}
// fogli: [{ nome, righe, larghezze, intestazione }]
export function scriviXlsx(fogli) {
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const files = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${fogli.map((_, k) => `<Override PartName="/xl/worksheets/sheet${k + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
    ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${fogli.map((f, k) => `<sheet name="${escX(f.nome)}" sheetId="${k + 1}" r:id="rId${k + 1}"/>`).join("")}</sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${fogli.map((_, k) => `<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${k + 1}.xml"/>`).join("")}<Relationship Id="rId${fogli.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet ${NS}><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFB61927"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ...fogli.map((f, k) => [`xl/worksheets/sheet${k + 1}.xml`, foglioXml(f.righe, f.larghezze, f.intestazione)]),
  ];
  return zip(files);
}
