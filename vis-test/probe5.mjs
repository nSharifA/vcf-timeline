// Final-state check: after load settles, every timeline's root must cover its itemset.
// Usage: node probe5.mjs "n=4&fix=brk" ...   (default: the regression matrix)
import { spawn } from 'node:child_process';
import os from 'node:os';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9337;
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${os.tmpdir()}\\chrome-probe-profile5`,
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
const cases = process.argv.slice(2).length ? process.argv.slice(2) : [
  'n=4&fix=current', 'n=4&fix=brk', 'n=4&fix=brknone',
  'n=25&fix=brk', 'n=25&fix=current',
  'n=4&fix=current&zoom=1.25', 'n=4&fix=brk&zoom=1.25', 'n=25&fix=brk&w=15360px',
];
for (const c of cases) {
  await send('Page.navigate', { url: `http://127.0.0.1:8282/vis-test/index2.html?${c}` });
  await sleep(5000);
  const out = JSON.parse(await evalJS(`JSON.stringify([...document.querySelectorAll('.timeline')].map(t => {
    const r = t.querySelector('.vis-timeline');
    return [r ? Math.round(r.getBoundingClientRect().height) : 0,
      r ? (r.querySelector('.vis-panel.vis-center').style.height || '') : '',
      r ? (r.querySelector('.vis-itemset').style.height || '') : ''];
  }))`));
  const uniq = [...new Set(out.map((v) => JSON.stringify(v)))];
  const bad = out.filter(([root, , it]) => parseInt(it) > root - 10).length; // rows taller than box = collapsed
  console.log((bad ? 'BAD ' : 'ok  ') + c.padEnd(30) + out.length + ' tl: ' +
    uniq.map((u) => u + ' x' + out.filter((v) => JSON.stringify(v) === u).length).join('   '));
}
ws.close();
chrome.kill();
process.exit(0);
