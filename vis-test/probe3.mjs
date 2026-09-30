// Visits the static repro page with different query modes, dumps in-page snapshots.
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9335;

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + process.env.TEMP + '\\chrome-probe-profile3',
  '--no-first-run', '--window-size=1400,900', 'about:blank',
], { stdio: 'ignore' });

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
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++idc; pending.set(id, (m) => res(m.result ?? m));
  ws.send(JSON.stringify({ id, method, params }));
});
const evalJS = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  return r.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');

const modes = process.argv.slice(2).length ? process.argv.slice(2) : [
  'mode=defer&hideleft=1',
  'mode=sync&hideleft=1',
  'mode=defer&hideleft=0',
];

for (const m of modes) {
  await send('Page.navigate', { url: `http://127.0.0.1:8282/vis-test/?${m}` });
  await sleep(5000);
  const log = await evalJS('JSON.stringify(window.__log)');
  const samples = await evalJS('JSON.stringify(window.__samples.filter((s,i,a)=> i===0 || !a[i-1] || JSON.stringify(s.rows)!==JSON.stringify(a[i-1].rows)))');
  console.log('=== ' + m);
  for (const e of JSON.parse(log)) console.log(`  ${String(e.ms).padStart(6)}ms ${e.tag.padEnd(12)} root=${String(e.root).padStart(5)} rows=${JSON.stringify(e.rows)} win=${JSON.stringify(e.win && [e.win[0].slice(0,10), e.win[1].slice(0,10)])}`);
  console.log('  transitions:');
  for (const s of JSON.parse(samples)) console.log(`  ${String(s.ms).padStart(6)}ms rows=${JSON.stringify(s.rows)} win=${JSON.stringify(s.win)}`);
}

ws.close();
chrome.kill();
process.exit(0);
