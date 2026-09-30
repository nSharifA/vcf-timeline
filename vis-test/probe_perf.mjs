// Measure the app's render phase: reload the live tab with pre-load instrumentation,
// then pull long tasks, event timings, vis create/redraw durations and Chrome metrics.
const PORT = 9222;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:9114'));
if (!page) { console.log('no app tab'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let idc = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++idc;
  pending.set(id, (m) => res(m.result ?? m));
  ws.send(JSON.stringify({ id, method, params }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Runtime.enable');
await send('Page.enable');
await send('Performance.enable');

const injected = await send('Page.addScriptToEvaluateOnNewDocument', { source: `
window.__perf = { longtasks: [], paints: {}, events: [], creates: [], redraws: [] };
try {
  new PerformanceObserver(l => { for (const e of l.getEntries())
    window.__perf.longtasks.push({ d: Math.round(e.duration), at: Math.round(e.startTime) });
  }).observe({ entryTypes: ['longtask'] });
  new PerformanceObserver(l => { for (const e of l.getEntries())
    window.__perf.paints[e.name] = Math.round(e.startTime);
  }).observe({ entryTypes: ['paint'] });
  new PerformanceObserver(l => { for (const e of l.getEntries())
    window.__perf.events.push({ t: e.name, d: Math.round(e.duration), at: Math.round(e.startTime) });
  }).observe({ type: 'event', durationThreshold: 40 });
} catch (e) { window.__perf.poErr = String(e); }
(function wait() {
  const v = window.vcftimeline;
  if (v && !v.__perfWrapped && v._createTimeline) {
    v.__perfWrapped = true;
    const oc = v._createTimeline.bind(v);
    v._createTimeline = function (c, i, g, o) {
      const t0 = performance.now();
      try { oc(c, i, g, o); } finally {
        window.__perf.creates.push({ d: Math.round(performance.now() - t0), at: Math.round(t0) });
      }
    };
    const iv = setInterval(() => {
      for (const c of document.querySelectorAll('.timeline, div')) {
        const t = c.timeline && c.timeline._timeline;
        if (!t || t.__perfRw || typeof t._origRedraw !== 'function') continue;
        t.__perfRw = true;
        const oo = t._origRedraw.bind(t);
        t._origRedraw = function () {
          const s = performance.now();
          oo();
          window.__perf.redraws.push({ d: Math.round(performance.now() - s), at: Math.round(s), rc: t.redrawCount });
        };
      }
    }, 100);
    setTimeout(() => clearInterval(iv), 25000);
  } else setTimeout(wait, 100);
})();
` });

await send('Page.reload');
await sleep(12000);

const data = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
  const p = window.__perf || {};
  const sum = a => a.reduce((x, y) => x + y, 0);
  const lt = (p.longtasks || []);
  const rw = p.redraws || [];
  const cr = p.creates || [];
  const cs = [...document.querySelectorAll('.timeline')].filter(c => c.timeline && c.timeline._timeline);
  const grid = document.querySelector('.row-grid');
  return {
    ts: Math.round(performance.now()),
    paints: p.paints,
    longTaskTotalMs: sum(lt.map(e => e.d)), longTaskCount: lt.length,
    longest: lt.sort((a, b) => b.d - a.d).slice(0, 8),
    eventsOver40ms: (p.events || []).sort((a, b) => b.d - a.d).slice(0, 8),
    creates: { count: cr.length, totalMs: sum(cr.map(e => e.d)), slowest: cr.sort((a, b) => b.d - a.d).slice(0, 5) },
    redraws: { count: rw.length, totalMs: sum(rw.map(e => e.d)),
      firstVsLater: [Math.round(sum(rw.filter(e => e.at < 8000).map(e => e.d))), Math.round(sum(rw.filter(e => e.at >= 8000).map(e => e.d)))],
      slowest: rw.sort((a, b) => b.d - a.d).slice(0, 6) },
    page: { timelines: cs.length,
      dpr: devicePixelRatio, zoom: document.documentElement.style.zoom || 'none',
      gridWidth: grid ? grid.getBoundingClientRect().width : (cs[0] ? cs[0].querySelector('.vis-itemset').offsetWidth : 0),
      domNodes: document.getElementsByTagName('*').length },
  };
})()` });
console.log(JSON.stringify(data.result?.value ?? data, null, 1));
const m = await send('Performance.getMetrics');
const pick = {};
for (const { name, value } of m.metrics)
  if (['LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration', 'V8CompileDuration', 'LayoutCount', 'RecalcStyleCount', 'DOMTotalUnionCount'].includes(name))
    pick[name] = Math.round(value * (name.endsWith('Count') ? 1 : 1000));
console.log('CDP metrics (ms / count):', JSON.stringify(pick));
await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier });
ws.close();
process.exit(0);
