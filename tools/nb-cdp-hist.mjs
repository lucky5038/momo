const base = 'http://127.0.0.1:9222'
const list = await (await fetch(base + '/json/list')).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const r = pending.get(m.id); pending.delete(m.id); r(m.result) } })
await new Promise((r) => ws.addEventListener('open', r))
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }))?.result?.value
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
await send('Page.enable')
await send('Page.reload', { ignoreCache: true })
await wait(2500)
await ev(`(() => { const el = [...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('系统设置')); el && el.click(); return true })()`)
await wait(2500)
const info = await ev(`(() => ({
  hist: [...document.querySelectorAll('#cf-srv-hist option')].map(o => o.value),
  ls: (() => { try { return JSON.parse(localStorage.getItem('momo_svr_hist') || '[]') } catch { return 'ERR' } })(),
  db: document.querySelector('.db-row select')?.value || '',
  opts: [...document.querySelectorAll('.db-row select option')].map(o => o.value).filter(Boolean),
  pwd: (document.querySelector('.pass input')?.value || '').length,
}))()`)
console.log(JSON.stringify(info, null, 2))
ws.close()