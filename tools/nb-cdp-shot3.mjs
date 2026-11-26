const base = 'http://127.0.0.1:9222'
const list = await (await fetch(base + '/json/list')).json()
const page = list.find((t) => t.type === 'page') || list[0]
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const res = pending.get(m.id); pending.delete(m.id); res(m.result) } })
await new Promise((r) => ws.addEventListener('open', r))
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }))?.result?.value
await ev(`(() => { const el = [...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes('数据清洗')); el && el.click(); return location.hash })()`)
await new Promise((r) => setTimeout(r, 1800))
const info = await ev(`(() => { const sel = document.querySelector('.file select'); return { opts: [...sel.options].map((o) => o.textContent.trim()), count: sel.options.length } })()`)
console.log(JSON.stringify(info, null, 2))
const fs = await import('node:fs')
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('C:\\Users\\DX03\\AppData\\Local\\Temp\\nb-tpl-list.png', Buffer.from(shot.data, 'base64'))
ws.close()