// Demo-app probe: loads routes of a running vcf-timeline demo, counts page
// exceptions (the pre-create addItem race used to throw "reading '_timeline'"
// once per addItem sent before create), verifies item placement and the
// batched post-attach add. Works on any demo URL: node probe7.mjs [base]
import { spawn } from 'node:child_process';
import os from 'node:os';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9339;
const BASE = process.argv[2] || 'http://localhost:8181';
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${os.tmpdir()}\\chrome-probe-profile7`,
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
let exc = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    exc.push(String(m.params.exceptionDetails?.exception?.description
      ?? m.params.exceptionDetails?.text ?? 'unknown').split('\n')[0].slice(0, 160));
  }
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++idc;
  pending.set(id, (m) => res(m.result ?? m));
  ws.send(JSON.stringify({ id, method, params }));
});
const evalJS = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
await send('Runtime.enable');
await send('Page.enable');

const state = () => evalJS(`JSON.stringify([...document.querySelectorAll('.timeline')].map(c => {
  const t = c.timeline;
  if (!t) return null;
  const frame = t.itemSet && t.itemSet.dom.frame;
  return { root: Math.round(c.querySelector('.vis-timeline').getBoundingClientRect().height),
    itemset: frame ? frame.offsetHeight : -1, n: t.itemsData.getIds().length,
    frozen: String(t.options.height) };
}).filter(Boolean))`);

async function load(path, settleMs) {
  exc = [];
  await send('Page.navigate', { url: BASE + path });
  for (let i = 0; i < 90; i++) { // dev-mode first load compiles the bundle
    if (await evalJS(`document.querySelectorAll('.timeline').length > 0 && [...document.querySelectorAll('.timeline')].every(c => c.timeline)`)) break;
    await sleep(500);
  }
  await sleep(settleMs);
}

let failed = 0;
// --- the race route: 8 rows x 7 items added BEFORE attach, no exceptions allowed
await load('/add-items-race', 3000);
let rows = JSON.parse(await state());
const tlEx = exc.filter((e) => e.includes('_timeline'));
console.log('load  /add-items-race: ' + rows.length + ' tl, items=' +
  [...new Set(rows.map((r) => r.n))] + ', exceptions=' + exc.length +
  (tlEx.length ? ' (of which _timeline: ' + tlEx.length + ')' : '') +
  ', heights=' + [...new Set(rows.map((r) => r.root + '/' + r.itemset + '/' + r.frozen))]);
if (rows.length !== 8 || rows.some((r) => r.n !== 7) || exc.length) { failed++; console.log('  BAD'); }

// batched post-attach add: click the button; instrument so every addItems call
// (one per timeline, one round trip) is counted
await evalJS(`window.__addCalls = 0;
  const o = vcftimeline.addItems.bind(vcftimeline);
  vcftimeline.addItems = function (c, j) { window.__addCalls += 1; return o(c, j); };
  [...document.querySelectorAll('vaadin-button')].find(b => b.textContent.includes('every row')).click(); 'clicked'`);
await sleep(2500);
rows = JSON.parse(await state());
const calls = await evalJS('window.__addCalls');
console.log('button click: addItems calls=' + calls + ', items=' + [...new Set(rows.map((r) => r.n))] +
  ', exceptions=' + exc.length);
if (calls !== 8 || rows.some((r) => r.n !== 8) || exc.length) { failed++; console.log('  BAD'); }

// --- reload: the refresh path that used to throw 175x + collapse rows
await load('/add-items-race', 3000);
rows = JSON.parse(await state());
console.log('reload /add-items-race: items=' + [...new Set(rows.map((r) => r.n))] +
  ', heights=' + [...new Set(rows.map((r) => r.root + '/' + r.itemset + '/' + r.frozen))] +
  ', exceptions=' + exc.length);
if (rows.some((r) => r.n < 7) || exc.length) { failed++; console.log('  BAD'); }

// --- the pre-existing grouped page: sanity, no regressions
for (const path of ['/grouped']) {
  await load(path, 3000);
  rows = JSON.parse(await state());
  const collapsed = rows.filter((r) => r.itemset > r.root + 10).length;
  console.log('load ' + path + ': ' + rows.length + ' tl, collapsed=' + collapsed +
    ', heights=' + [...new Set(rows.map((r) => r.root + '/' + r.itemset))] + ', exceptions=' + exc.length);
  if (collapsed || exc.length) { failed++; console.log('  BAD'); }
}

ws.close();
chrome.kill();
console.log(failed ? `${failed} check(s) FAILED` : 'all demo checks ok');
process.exit(failed ? 1 : 0);
