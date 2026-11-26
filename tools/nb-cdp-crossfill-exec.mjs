// 真实库「执行」链路验证：JSKJDB.JDB960 ← DCSHDB.HDB001（强制覆盖）
// 先预览确认行数，再点执行（window.confirm 由 CDP 自动接受），最后读回结果。
import { writeFileSync } from 'node:fs'

const shotPath = process.argv[2] || 'C:\\Users\\DX03\\AppData\\Local\\Temp\\nb-p2-exec.png'
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && /5173/.test(t.url))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))

let id = 0
const pend = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) {
    pend.get(m.id)(m)
    pend.delete(m.id)
    return
  }
  if (m.method === 'Page.javascriptDialogOpening') {
    call('Page.handleJavaScriptDialog', { accept: true })
  }
}
function call(method, params) {
  return new Promise((res) => {
    const i = ++id
    pend.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
}
const ev = async (expr) => {
  const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value ?? JSON.stringify(r.result?.exceptionDetails ?? null)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await call('Page.enable', {})
await ev(`location.hash = '#/run'`)
await sleep(800)

const ids = JSON.parse(
  await ev(`fetch('/api/meta', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
    .then(r => r.json()).then(m => {
      const doc = m.docs.find(d => String(d.id || d.sub).includes('JSKJDB')) || {};
      const src = m.srcs.find(s => String(s.id).includes('DCSHDB')) || {};
      return JSON.stringify({ docId: doc.id, docName: doc.name, srcId: src.id, srcName: src.name });
    })`),
)

// 1. 单据 + 目标列
await ev(`(() => { const s = document.querySelectorAll('.flow select')[0];
  s.value = ${JSON.stringify(ids.docId)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`)
await sleep(900)
await ev(`(() => { const inp = document.querySelectorAll('.flow .combo input')[0];
  inp.value = 'JDB960'; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.blur(); })()`)
await sleep(400)

// 2. 来源档 + 值列
await ev(`(() => { const s = document.querySelectorAll('.flow select')[1];
  s.value = ${JSON.stringify(ids.srcId)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`)
await sleep(900)
await ev(`(() => { const inp = document.querySelectorAll('.flow .combo input')[1];
  inp.value = 'HDB001'; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.blur(); })()`)
await sleep(400)

// 3. 强制覆盖
await ev(`(() => { const cb = [...document.querySelectorAll('.adv input[type=checkbox]')][0];
  if (cb && !cb.checked) cb.click(); })()`)
await sleep(300)

const form = JSON.parse(
  await ev(`(() => { const sels = [...document.querySelectorAll('.flow select')].map(s => s.value);
    const combos = [...document.querySelectorAll('.flow .combo input')].map(i => i.value);
    const adv = [...document.querySelectorAll('.adv input[type=checkbox]')].map(c => c.checked);
    return JSON.stringify({ sels, combos, adv }); })()`),
)

// 4. 预览
await ev(`(() => { const b = [...document.querySelectorAll('.actionbar button')].find(x => x.textContent.trim() === '预览'); b && b.click(); })()`)
await sleep(5000)
const before = JSON.parse(
  await ev(`(() => { const st = document.querySelector('.status');
    const rows = document.querySelectorAll('.block table tbody tr').length;
    return JSON.stringify({ status: st ? st.textContent.trim() : '', rows }); })()`),
)

// 5. 执行（confirm 自动接受）
await ev(`(() => { const b = [...document.querySelectorAll('.actionbar button')].find(x => x.textContent.trim() === '执行'); b && b.click(); })()`)
await sleep(12000)

const after = await ev(`(() => { const st = document.querySelector('.status');
  const res = document.querySelectorAll('.block');
  const last = res.length ? res[res.length - 1].textContent.replace(/\\s+/g, ' ').trim().slice(0, 400) : '';
  return JSON.stringify({ status: st ? st.textContent.trim() : '', lastBlock: last }); })()`)

const shot = await call('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'))

console.log(JSON.stringify({ ids, form, before, after: JSON.parse(after), screenshot: shotPath }, null, 2))
ws.close()
