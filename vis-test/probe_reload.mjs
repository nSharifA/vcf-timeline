// Reload the user's live app tab, capture console during load, dump timeline freeze state after.
const PORT = 9222;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:9114'));
if (!page) { console.log('no app tab:', list.map((t) => t.url)); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let idc = 0;
const pending = new Map();
const warns = new Map(); // message -> count
const excs = new Map();  // message -> count
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') {
    const t = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
    warns.set(t, (warns.get(t) || 0) + 1);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const e = m.params.exceptionDetails;
    const t = (e.exception?.description || e.text || '').split('\n')[0].slice(0, 120);
    excs.set(t, (excs.get(t) || 0) + 1);
  }
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++idc;
  pending.set(id, (m) => res(m.result ?? m));
  ws.send(JSON.stringify({ id, method, params }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Runtime.enable');
await send('Page.enable');
await send('Page.reload', { ignoreCache: false });
await sleep(9000);
const evalJS = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
  if (r.exceptionDetails) return { ERROR: JSON.stringify(r.exceptionDetails.exception?.value ?? r.exceptionDetails).slice(0, 200) };
  return r.result?.value;
};

const state = await evalJS(`(() => {
  let cs = [...document.querySelectorAll('.timeline')].filter((c) => c.timeline && c.timeline._timeline);
  if (!cs.length) cs = [...document.querySelectorAll('div')].filter((c) => c.timeline && c.timeline._timeline);
  const h = cs.map((c) => Math.round(c.timeline._timeline.dom.root.getBoundingClientRect().height));
  return {
    containers: cs.length,
    hasEnsure: typeof window.vcftimeline !== 'undefined' && typeof window.vcftimeline._ensureInitialMainHeight,
    rootHist: [...new Set(h)].sort((a, b) => a - b).map((v) => v + ' x' + h.filter((x) => x === v).length),
    rows: cs.slice(0, 3).map((c) => {
      const t = c.timeline._timeline;
      return { optHeight: t.options.height, timelineHeight: c.timelineHeight,
        itemsetH: t.itemSet.dom.frame.offsetHeight, centerContentH: t.dom.center.offsetHeight,
        rootH: Math.round(t.dom.root.getBoundingClientRect().height) };
    }),
  };
})()`);
console.log(JSON.stringify(state, null, 1));
console.log('console.warn/log:', [...warns].slice(0, 6));
console.log('exceptions:', [...excs].slice(0, 6));
ws.close();
process.exit(0);
