// Ungrouped-mode regression: the _ensureFrozenHeight healer (and that heal=off
// still reproduces the collapse), plus the pre-create addItems queue
// (early=1: batched flush during the deferred constructor; ids must dedupe,
// stale content must not overwrite, and NO page exceptions may fire).
// Requires serve.mjs running on :8282.
// Usage: node probe6.mjs ["n=4&ng=1&early=1" ...]   (default: the matrix below)
import { spawn } from 'node:child_process';
import os from 'node:os';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9338;
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${os.tmpdir()}\\chrome-probe-profile6`,
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
let excCount = 0;
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    excCount++;
    console.log('  PAGE EXC:', JSON.stringify(m.params.exceptionDetails?.exception?.description
      ?? m.params.exceptionDetails?.text ?? '').slice(0, 200));
  }
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
  { q: 'n=4&ng=1&early=1', expectHealed: true, expectEarly: true },
  { q: 'n=25&ng=1', expectHealed: true },
  // ngbrk forces a too-early freeze (stand-in for the lost push race): with
  // the healer on it must heal, with heal=off it must stay collapsed.
  { q: 'n=4&ng=1&fix=ngbrk', expectHealed: true },
  { q: 'n=4&ng=1&fix=ngbrk&heal=off', expectHealed: false }, // control: must stay collapsed
  { q: 'n=4&early=1', expectHealed: true, expectEarly: true }, // grouped, same queue
];
let failed = 0;
for (const { q, expectHealed, expectEarly } of cases) {
  excCount = 0;
  await send('Page.navigate', { url: `http://127.0.0.1:8282/vis-test/index2.html?${q}` });
  await sleep(5000);
  const out = JSON.parse(await evalJS(`JSON.stringify([...document.querySelectorAll('.timeline')].map(t => {
    const r = t.querySelector('.vis-timeline');
    const d = t.timeline && t.timeline._timeline;
    return [r ? Math.round(r.getBoundingClientRect().height) : 0,
      r ? (r.querySelector('.vis-itemset').style.height || '') : '',
      d ? d.itemsData.getIds().length : -1,
      d ? d.itemsData.get().some(i => i.content === 'SHOULD-NOT-APPEAR') : false];
  }))`));
  const uniq = [...new Set(out.map((v) => JSON.stringify(v.slice(0, 2))))];
  const collapsed = out.filter(([root, it]) => parseInt(it) > root - 10).length;
  const counts = new Set(out.map((v) => v[2]));
  const staleOverwrite = out.some((v) => v[3]);
  let bad = '';
  if (expectHealed && collapsed > 0) bad += ` collapsed=${collapsed}`;
  if (!expectHealed && collapsed === 0) bad += ' control: bug did NOT reproduce (coverage lost!)';
  if (expectEarly && (counts.size !== 1 || !counts.has(61))) bad += ` itemCounts=${[...counts]}`;
  if (expectEarly && staleOverwrite) bad += ' staleContentOverwrote';
  if (excCount > 0) bad += ` exceptions=${excCount}`;
  if (bad) failed++;
  console.log((bad ? 'BAD ' : 'ok  ') + q.padEnd(30) + out.length + ' tl: ' +
    uniq.map((u) => u + ' x' + out.filter((v) => JSON.stringify(v.slice(0, 2)) === u).length).join('   ') + (bad ? '  <<' + bad : ''));
}
ws.close();
chrome.kill();
console.log(failed ? `${failed} case(s) FAILED` : 'all cases ok');
process.exit(failed ? 1 : 0);
