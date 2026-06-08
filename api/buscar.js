// api/buscar.js
// Vercel serverless function — proxies nombrerutyfirma.com
// Deploy this at: vercel.com (free, no credit card needed)

export default async function handler(req, res) {
  // Allow requests from any origin (your WordPress site)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { q, tipo } = req.query;

  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: 'Parámetro q requerido (mínimo 2 caracteres).' });
  }

  const query = q.trim();
  const searchType = tipo === 'rut' ? 'rut' : 'nombre';

  // Build the target URL
  // - Por nombre: https://nombrerutyfirma.com/nombre?term=juan+perez
  // - Por RUT:    https://nombrerutyfirma.com/rut?term=12345678
  let targetUrl;
  if (searchType === 'rut') {
    // Strip all non-digits and K, keep only the number part
    const cleanRut = query.replace(/\./g, '').replace(/-.*/, '').replace(/[^0-9]/g, '');
    targetUrl = `https://nombrerutyfirma.com/rut?term=${encodeURIComponent(cleanRut)}`;
  } else {
    targetUrl = `https://nombrerutyfirma.com/nombre?term=${encodeURIComponent(query)}`;
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://nombrerutyfirma.com/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-CL,es;q=0.9',
      },
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'No se pudo conectar con la fuente de datos.' });
    }

    const html = await response.text();

    // Check if we got blocked
    if (html.includes('Access denied') || html.includes('Attention Required') || html.includes('Cloudflare')) {
      return res.status(503).json({ error: 'Servicio temporalmente no disponible. Intenta en unos minutos.' });
    }

    // Parse the HTML table rows
    const results = parseResults(html);

    // Cache response for 1 hour to reduce load
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    return res.status(200).json({ ok: true, total: results.length, results });

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}

/**
 * Parses the HTML table from nombrerutyfirma.com
 * Table columns: Nombre | RUT | Sexo | Dirección | Comuna
 */
function parseResults(html) {
  const results = [];

  // Match all <tr> rows inside tbody
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return results;

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(tbodyMatch[1])) !== null) {
    const row = rowMatch[1];
    const cells = [];

    // Extract each <td> cell content
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(row)) !== null) {
      // Strip inner HTML tags, decode entities
      const text = cellMatch[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&aacute;/g, 'á')
        .replace(/&eacute;/g, 'é')
        .replace(/&iacute;/g, 'í')
        .replace(/&oacute;/g, 'ó')
        .replace(/&uacute;/g, 'ú')
        .replace(/&ntilde;/g, 'ñ')
        .replace(/&Aacute;/g, 'Á')
        .replace(/&Eacute;/g, 'É')
        .replace(/&Iacute;/g, 'Í')
        .replace(/&Oacute;/g, 'Ó')
        .replace(/&Uacute;/g, 'Ú')
        .replace(/&Ntilde;/g, 'Ñ')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
        .trim();
      cells.push(text);
    }

    // Only include rows with enough columns
    if (cells.length >= 2) {
      results.push({
        nombre:    cells[0] || '',
        rut:       formatRut(cells[1] || ''),
        sexo:      cells[2] || '',
        direccion: cells[3] || '',
        comuna:    cells[4] || '',
      });
    }
  }

  return results;
}

/**
 * Formats a raw RUT string like "12345678-9" into "12.345.678-9"
 */
function formatRut(raw) {
  if (!raw) return '';
  const parts = raw.replace(/\./g, '').split('-');
  if (parts.length < 2) return raw;
  const num = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${num}-${parts[1]}`;
}
