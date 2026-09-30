// Probe index2.html (connector mimic). Usage: node probe4.mjs "n=4&fix=current" ...
import { spawn } from 'node:child_process';
import os from 'node:os';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9336;
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${os.tmpdir()}\\chrome-probe-profile4`,
  '--no-first-run', '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function targets() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const page = (await r.json()).find((t) => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(200);
  }
  throw new Error('devtools not reachable');
}
const page = await targets();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let idc = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') console.log('PAGE EXC:', JSON.stringify(m.params.exceptionDetails).slice(0, 300));
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++idc;
  pending.set(id, (m) => res(m.result ?? m));
  ws.send(JSON.stringify({ id, method, params }));
});
const evalJS = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.value;
await send('Runtime.enable');
await send('Page.enable');
for (const m of (process.argv.slice(2).length ? process.argv.slice(2) : ['n=4&fix=current'])) {
  await send('Page.navigate', { url: `http://127.0.0.1:8282/vis-test/index2.html?${m}` });
  await sleep(5000);
  const log = JSON.parse(await evalJS('JSON.stringify(window.__log)'));
  const trans = JSON.parse(await evalJS('JSON.stringify(window.__trans)'));
  console.log('=== ' + m);
  const seen = new Set();
  for (const e of log) {
    const k = e.tag + '|' + e.root + '|' + e.itemset + '|' + e.fg;
    if (seen.has(e.id + k)) continue;
    seen.add(e.id + k);
    console.log(`  ${String(e.ms).padStart(6)}ms ${e.id} ${e.tag.padEnd(9)} root=${String(e.root).padStart(6)} centerC=${String(e.centerC).padEnd(8)} itemset=${String(e.itemset).padEnd(7)} fg=${e.fg}`);
  }
  console.log('  transitions:');
  for (const s of trans) console.log(`  ${String(s.ms).padStart(6)}ms ${s.id} root=${String(s.root).padStart(6)} itemset=${String(s.itemset).padEnd(7)} fg=${s.fg}`);
}
ws.close();
chrome.kill();
process.exit(0);
