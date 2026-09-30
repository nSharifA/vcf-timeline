// minimal static file server rooted at the repo root, port 8282
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let p = resolve(join(ROOT, decodeURIComponent(url.pathname)));
    if (!p.startsWith(ROOT + sep) && p !== ROOT) { res.writeHead(403).end(); return; }
    let st = await stat(p);
    if (st.isDirectory()) { p = join(p, 'index.html'); st = await stat(p); }
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(await readFile(p));
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(8282, () => console.log('serving', ROOT, 'on 8282'));
