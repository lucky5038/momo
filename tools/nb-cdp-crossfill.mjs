// 数据驱动跑一遍「跨表带值」：分步 + 等 Vue 渲染，避免同一帧内查不到下拉项
import { writeFileSync } from 'node:fs'

const shotPath = process.argv[2] || 'C:\\Users\\DX03\\AppData\\Local\\Temp\\nb-p2-run.png'
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && /5173/.test(t.url))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pend = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (pend.has(m.id)) {
    pend.get(m.id)(m)
    pend.delete(m.id)
  }
}
const call = (method, params) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => {
  const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value ?? JSON.stringify(r.result?.exceptionDetails ?? null)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await ev(`location.hash = '#/run'`)
await sleep(600)

const plan = JSON.parse(await ev(`fetch('/api/meta', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
  .then(r => r.json()).then(m => {
    const d = m.docs.find(x => (m.tgtAllCols[x.id] || []).some(c => c.custom === true));
    const excl = (m.srcExcluded[d.id] || []);
    const src = m.srcs.find(s => s.id !== d.id && !excl.includes(s.id) && (m.srcAllCols[s.id] || []).length > 20);
    return JSON.stringify({ docId: d.id, docName: d.name, srcId: src.id, srcName: src.name });
  })`))

// 选单据
await ev(`(() => { const s = document.querySelectorAll('.flow select')[0];
  s.value = ${JSON.stringify(plan.docId)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`)
await sleep(700)

// 打开目标列下拉（第一帧只负责打开）
await ev(`(() => { const inp = document.querySelectorAll('.flow .card .combo input')[0];
  inp.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); inp.focus(); })()`)
await sleep(400)
const tgtList = JSON.parse(await ev(`(() => { const lis = [...document.querySelectorAll('.flow .card .combo .cb li')];
  return JSON.stringify({ count: lis.length, first: lis[0] ? lis[0].textContent.trim() : '' }); })()`))
await ev(`(() => { const li = document.querySelector('.flow .card .combo .cb li'); if (li) li.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); })()`)
await sleep(400)
const tgtPicked = await ev(`document.querySelectorAll('.flow .card .combo input')[0].value`)

// 选来源档
await ev(`(() => { const s = document.querySelectorAll('.flow select')[1];
  s.value = ${JSON.stringify(plan.srcId)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`)
await sleep(800)

// 打开值列下拉
await ev(`(() => { const inp = document.querySelectorAll('.flow .card .combo input')[1];
  inp.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); inp.focus(); })()`)
await sleep(400)
const valList = JSON.parse(await ev(`(() => { const combos = [...document.querySelectorAll('.flow .card .combo')];
  const lis = [...combos[1].querySelectorAll('.cb li')];
  return JSON.stringify({ count: lis.length, first: lis[0] ? lis[0].textContent.trim() : '' }); })()`))
await ev(`(() => { const combos = [...document.querySelectorAll('.flow .card .combo')];
  const li = combos[1].querySelector('.cb li'); if (li) li.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); })()`)
await sleep(400)
const valPicked = await ev(`document.querySelectorAll('.flow .card .combo input')[1].value`)

// 预览
await ev(`(() => { const b = [...document.querySelectorAll('.actionbar button')].find(x => x.textContent.trim() === '预览'); if (b) b.click(); })()`)
await sleep(4000)

const after = JSON.parse(await ev(`(() => { const st = document.querySelector('.status'); const rows = document.querySelectorAll('.block table tbody tr').length;
  const head = document.querySelector('.block-head'); const warns = [...document.querySelectorAll('.block .warn')].map(x => x.textContent.trim());
  return JSON.stringify({ status: st ? st.textContent.trim() : '', rows, head: head ? head.textContent.trim() : '', warns }); })()`))

const shot = await call('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'))

console.log(JSON.stringify({ plan, tgtList, tgtPicked, valList, valPicked, after, screenshot: shotPath }, null, 2))
ws.close()
