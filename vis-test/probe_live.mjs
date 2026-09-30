// Attach to the user's live Chrome tab and read the freeze state (read-only).
import { spawn } from 'node:child_process';

const PORT = 9222;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:9114'));
if (!page) { console.log('no app tab:', list.map((t) => t.url)); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let idc = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') console.log('PAGE EXC:', JSON.stringify(m.params.exceptionDetails).slice(0, 200));
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++idc;
  pending.set(id, (m) => res(m.result ?? m));
  ws.send(JSON.stringify({ id, method, params }));
});
await send('Runtime.enable');
const evalJS = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
  if (r.exceptionDetails) return { ERROR: JSON.stringify(r.exceptionDetails.exception?.value ?? r.exceptionDetails).slice(0, 200) };
  return r.result?.value;
};

console.log(JSON.stringify(await evalJS(`(() => {
  let cs = [...document.querySelectorAll('.timeline')].filter((c) => c.timeline && c.timeline._timeline);
  if (!cs.length) cs = [...document.querySelectorAll('div')].filter((c) => c.timeline && c.timeline._timeline);
  return {
    containers: cs.length,
    hasEnsure: typeof window.vcftimeline !== 'undefined' && typeof window.vcftimeline._ensureInitialMainHeight,
    restackArmed: cs.slice(0, 3).map((c) => c.initialGroupRowsRestacked),
    rows: cs.slice(0, 4).map((c) => {
      const t = c.timeline._timeline;
      return {
        optHeight: t.options.height,
        timelineHeight: c.timelineHeight,
        itemsetH: t.itemSet && t.itemSet.dom.frame.offsetHeight,
        centerContentH: t.dom.center.offsetHeight,
        rootH: Math.round(t.dom.root.getBoundingClientRect().height),
        groups: !!(t.itemSet && t.itemSet.groupsData && t.itemSet.groupsData.getIds().length),
        items: t.itemSet && t.itemSet.itemsData ? t.itemSet.itemsData.length : (t.itemsData ? t.itemsData.length : null),
        visInWindow: (() => { const w = t.getWindow(); const n = Date.now(); return w.start < n && w.end > n; })(),
      };
    }),
  };
})()`, null), null, 1));

ws.close();
process.exit(0);
