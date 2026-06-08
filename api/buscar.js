// api/buscar.js
// Vercel serverless function — tries multiple sources with fallback

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q, tipo } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: 'Ingresa al menos 2 caracteres.' });
  }

  const query = q.trim();
  const searchType = tipo === 'rut' ? 'rut' : 'nombre';

  // Clean RUT — keep digits only for the number part
  const cleanRut = query.replace(/\./g, '').replace(/-.*/, '').replace(/[^0-9]/g, '');

  // Multiple sources to try in order
  const sources = [
    {
      name: 'rutynombre',
      urlNombre: `https://www.rutynombre.com/?nombre=${encodeURIComponent(query)}`,
      urlRut:    `https://www.rutynombre.com/?rut=${encodeURIComponent(cleanRut)}`,
      parse: parseRutYNombre,
    },
    {
      name: 'nombrerutyfirma',
      urlNombre: `https://nombrerutyfirma.com/nombre?term=${encodeURIComponent(query)}`,
      urlRut:    `https://nombrerutyfirma.com/rut?term=${encodeURIComponent(cleanRut)}`,
      parse: parseNombreRutYFirma,
    },
    {
      name: 'rutificador_co',
      urlNombre: `https://www.rutificador.co/?q=${encodeURIComponent(query)}`,
      urlRut:    `https://www.rutificador.co/?q=${encodeURIComponent(query)}`,
      parse: parseGenericTable,
    },
  ];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0',
  };

  let lastError = 'No se pudo obtener resultados.';

  for (const source of sources) {
    const targetUrl = searchType === 'rut' ? source.urlRut : source.urlNombre;
    try {
      const response = await fetch(targetUrl, {
        headers: { ...headers, Referer: new URL(targetUrl).origin + '/' },
        redirect: 'follow',
      });

      if (!response.ok) {
        lastError = `Fuente ${source.name} respondió ${response.status}.`;
        continue;
      }

      const html = await response.text();

      // Skip if blocked
      if (
        html.includes('Access denied') ||
        html.includes('Attention Required') ||
        html.toLowerCase().includes('captcha') ||
        html.includes('cf-browser-verification')
      ) {
        lastError = `Fuente ${source.name} bloqueada temporalmente.`;
        continue;
      }

      const results = source.parse(html);

      if (results.length === 0) {
        // Might just be no results — still return success
        res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');
        return res.status(200).json({ ok: true, total: 0, results: [], source: source.name });
      }

      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
      return res.status(200).json({ ok: true, total: results.length, results, source: source.name });

    } catch (err) {
      lastError = `Error en ${source.name}: ${err.message}`;
      continue;
    }
  }

  // All sources failed
  return res.status(503).json({
    error: 'Servicio temporalmente no disponible. Intenta en unos minutos.',
    detail: lastError,
  });
}

// ─── Parser: rutynombre.com ───────────────────────────────────────────────────
function parseRutYNombre(html) {
  return parseGenericTable(html);
}

// ─── Parser: nombrerutyfirma.com ──────────────────────────────────────────────
function parseNombreRutYFirma(html) {
  return parseGenericTable(html);
}

// ─── Generic table parser (works on most rutificador sites) ──────────────────
function parseGenericTable(html) {
  const results = [];

  // Try tbody first, then full table
  let searchHtml = html;
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (tbodyMatch) searchHtml = tbodyMatch[1];

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(searchHtml)) !== null) {
    const row = rowMatch[1];
    // Skip header rows
    if (/<th/i.test(row)) continue;

    const cells = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;

    while ((cellMatch = cellRegex.exec(row)) !== null) {
      cells.push(decodeHtml(cellMatch[1]));
    }

    if (cells.length >= 2) {
      // Detect column order: some sites put RUT first, others put name first
      const first = cells[0].replace(/\s/g, '');
      const isRutFirst = /^\d{6,8}-[\dkK]$/.test(first) || /^\d{7,8}$/.test(first);

      results.push({
        nombre:    isRutFirst ? (cells[1] || '') : (cells[0] || ''),
        rut:       formatRut(isRutFirst ? (cells[0] || '') : (cells[1] || '')),
        sexo:      cells[2] || '',
        direccion: cells[3] || '',
        comuna:    cells[4] || '',
      });
    }
  }

  return results;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function decodeHtml(str) {
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&aacute;/gi, 'á').replace(/&eacute;/gi, 'é')
    .replace(/&iacute;/gi, 'í').replace(/&oacute;/gi, 'ó')
    .replace(/&uacute;/gi, 'ú').replace(/&ntilde;/gi, 'ñ')
    .replace(/&Aacute;/g, 'Á').replace(/&Eacute;/g, 'É')
    .replace(/&Iacute;/g, 'Í').replace(/&Oacute;/g, 'Ó')
    .replace(/&Uacute;/g, 'Ú').replace(/&Ntilde;/g, 'Ñ')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c)))
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function formatRut(raw) {
  if (!raw) return '';
  const clean = raw.replace(/\./g, '');
  const parts = clean.split('-');
  if (parts.length < 2) return raw;
  const num = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${num}-${parts[1].toUpperCase()}`;
}
