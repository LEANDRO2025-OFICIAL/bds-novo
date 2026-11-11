// Servidor estático mínimo para observar o original e a réplica em 127.0.0.1.
// Uso: node replica/tools/serve.mjs <diretório-raiz> <porta> [diretório-overlay]
// O overlay (opcional) tem PRIORIDADE sobre a raiz: serve para injetar o
// simulador de Flutter (dev/) sem misturá-lo ao código de produção.
// Em .html, `$FLUTTER_BASE_HREF` vira "/" — o mesmo que `flutter build web` faz.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const [root = '.', port = '5500', overlay] = process.argv.slice(2);
const roots = [overlay && resolve(overlay), resolve(root)].filter(Boolean);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

async function resolveFile(urlPath) {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  for (const base of roots) {
    const full = join(base, rel || 'index.html');
    if (!full.startsWith(base + sep) && full !== base) continue; // bloqueia path traversal
    try {
      const s = await stat(full);
      if (s.isDirectory()) {
        const idx = join(full, 'index.html');
        await stat(idx);
        return idx;
      }
      return full;
    } catch {
      /* tenta o próximo root */
    }
  }
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const file = await resolveFile(url.pathname);
  const log = (code) => console.log(`${code} ${req.method} ${url.pathname}`);
  if (!file) {
    log(404);
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('404 não encontrado');
  }
  let body = await readFile(file);
  if (extname(file).toLowerCase() === '.html') {
    body = Buffer.from(body.toString('utf8').replaceAll('$FLUTTER_BASE_HREF', '/'), 'utf8');
  }
  log(200);
  const headers = {
    'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  };
  // Opcional: CSP="script-src 'self'" node serve.mjs … — para provar compatibilidade com CSP estrita.
  if (process.env.CSP) headers['content-security-policy'] = process.env.CSP;
  res.writeHead(200, headers);
  res.end(body);
}).listen(Number(port), '127.0.0.1', () => {
  console.log(`servindo ${roots.join(' + ')} em http://127.0.0.1:${port}`);
});
