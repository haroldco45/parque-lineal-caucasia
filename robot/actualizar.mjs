// Robot de Ojo al Parque Lineal (Vibras Positivas HM)
// Corre en GitHub Actions cada 30 minutos. Busca noticias reales y el estado
// del contrato en los datos abiertos del SECOP II, y guarda data/noticias.json
// y data/secop.json. No necesita librerías: solo Node 20.
import { readFile, writeFile } from "node:fs/promises";

const BUSQUEDAS = [
  '"parque lineal" Caucasia',
  'Caucasia "El Triángulo" parque',
  'Caucasia EDUAN',
  '"Empresa de Desarrollo Urbano de Andes"',
  '"M&L Concretos"',
  'Caucasia obra parque regalías',
  'Caucasia alcaldía obras'
];
// Una noticia entra si menciona al menos una de estas palabras
const CLAVES = ["caucasia", "eduan", "desarrollo urbano de andes", "m&l concretos", "el triángulo", "el triangulo"];
const UA = { "user-agent": "Mozilla/5.0 (compatible; OjoAlParqueBot/1.0; +https://github.com/haroldco45)" };

const limpiar = s => String(s || "")
  .replace(/<!\[CDATA\[|\]\]>/g, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ").trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i")); return m ? m[1] : ""; };

async function traer(url, ms = 15000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { headers: UA, signal: c.signal, redirect: "follow" }); if (!r.ok) throw new Error(r.status); return await r.text(); }
  finally { clearTimeout(t); }
}

async function google(q) {
  const xml = await traer(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=es-419&gl=CO&ceid=CO:es-419`);
  return xml.split("<item>").slice(1).map(it => {
    let titulo = limpiar(tag(it, "title"));
    const fuente = limpiar(tag(it, "source"));
    if (fuente && titulo.endsWith(" - " + fuente)) titulo = titulo.slice(0, -(fuente.length + 3));
    return { titulo, url: limpiar(tag(it, "link")), fecha: new Date(limpiar(tag(it, "pubDate"))).toISOString(), fuente, resumen: limpiar(tag(it, "description")).slice(0, 300), imagen: null };
  });
}

async function bing(q) {
  const xml = await traer(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=es-co&cc=co`);
  return xml.split("<item>").slice(1).map(it => {
    let url = limpiar(tag(it, "link"));
    try { const u = new URL(url); if (u.searchParams.get("url")) url = u.searchParams.get("url"); } catch {}
    const img = (it.match(/<News:Image>([\s\S]*?)<\/News:Image>/i) || [])[1];
    return { titulo: limpiar(tag(it, "title")), url, fecha: new Date(limpiar(tag(it, "pubDate"))).toISOString(), fuente: limpiar(tag(it, "News:Source")), resumen: limpiar(tag(it, "description")).slice(0, 300), imagen: img ? limpiar(img) : null };
  });
}

async function imagenDe(url) {
  if (!url || url.includes("news.google.com")) return null;
  try {
    const html = (await traer(url, 8000)).slice(0, 200000);
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i);
    return m ? new URL(m[1], url).href : null;
  } catch { return null; }
}

const clave = n => n.titulo.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "").slice(0, 70);
const relevante = n => { const s = (n.titulo + " " + n.resumen).toLowerCase(); return CLAVES.some(k => s.includes(k)); };

async function noticias() {
  let previas = [];
  try { previas = JSON.parse(await readFile("data/noticias.json", "utf8")).noticias || []; } catch {}
  const todas = [...previas];
  for (const q of BUSQUEDAS) {
    for (const f of [google, bing]) {
      try { todas.push(...(await f(q))); } catch (e) { console.log("Falló", f.name, q, e.message); }
    }
  }
  const vistos = new Map();
  for (const n of todas) {
    if (!n.titulo || !n.url || isNaN(new Date(n.fecha))) continue;
    if (!relevante(n)) continue;
    const k = clave(n);
    const ya = vistos.get(k);
    if (!ya) vistos.set(k, n);
    else { if (!ya.imagen && n.imagen) ya.imagen = n.imagen; if (ya.url.includes("news.google.com") && !n.url.includes("news.google.com")) ya.url = n.url; }
  }
  const lista = [...vistos.values()].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 80);
  let buscadas = 0;
  for (const n of lista) { if (!n.imagen && buscadas < 20) { n.imagen = await imagenDe(n.url); buscadas++; } }
  return lista;
}

async function socrata(ds, q) {
  const t = await traer(`https://www.datos.gov.co/resource/${ds}.json?$q=${encodeURIComponent(q)}&$limit=50`, 25000);
  return JSON.parse(t);
}
const coincide = o => { const s = JSON.stringify(o).toUpperCase(); return s.includes("CAUCASIA") && (s.includes("TRIANGULO") || s.includes("TRIÁNGULO")) && s.includes("PARQUE"); };

async function secop() {
  const out = { hora: new Date().toISOString(), contrato: null, proceso: null };
  try { out.contrato = (await socrata("jbjy-vk9h", "PARQUE LINEAL TRIANGULO")).filter(coincide)[0] || null; } catch (e) { console.log("SECOP contratos:", e.message); }
  try { out.proceso = (await socrata("p6dx-8zbt", "PARQUE LINEAL TRIANGULO")).filter(coincide)[0] || null; } catch (e) { console.log("SECOP procesos:", e.message); }
  return out;
}

const lista = await noticias();
await writeFile("data/noticias.json", JSON.stringify({ actualizado: new Date().toISOString(), noticias: lista }, null, 1));
console.log("Noticias guardadas:", lista.length);

const s = await secop();
let previo = null; try { previo = JSON.parse(await readFile("data/secop.json", "utf8")); } catch {}
if (s.contrato || s.proceso || !previo) await writeFile("data/secop.json", JSON.stringify(s, null, 1));
console.log("SECOP:", s.contrato ? "contrato encontrado" : "sin contrato", s.proceso ? "/ proceso encontrado" : "/ sin proceso");
