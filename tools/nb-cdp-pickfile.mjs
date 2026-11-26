const base = 'http://127.0.0.1:9222'
const list = await (await fetch(base + '/json/list')).json()
const page = list.find((t) => t.type === 'page' && t.url.includes('5173')) || list[0]
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const res = pending.get(m.id); pending.delete(m.id); res(m.result) } })
await new Promise((r) => ws.addEventListener('open', r))
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }))?.result?.value
await send('DOM.enable')
const doc = await send('DOM.getDocument', { depth: -1 })
const ids = (await send('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: 'input[type=file]' })).nodeIds
console.log('inputs found:', ids.length)
const file = 'C:\\Users\\DX03\\AppData\\Roaming\\N-B助手\\cleaning\\jobs\\8d2789b8-048e-4ecc-ad74-8cda0103d1ec\\source.xlsx'
await send('DOM.setFileInputFiles', { nodeId: ids[1], files: [file] })
await new Promise((r) => setTimeout(r, 900))
const info = await ev(`(() => ({
  labels: [...document.querySelectorAll('.file-grid .btn')].map((b) => b.textContent.trim()),
  sub: [...document.querySelectorAll('.file-grid .sub')].map((s) => s.textContent.trim()),
  fonts: { body: getComputedStyle(document.body).fontFamily, h2: getComputedStyle(document.querySelector('h2')).fontFamily, kicker: getComputedStyle(document.querySelector('.kicker')).fontFamily },
}))()`)
console.log(JSON.stringify(info, null, 2))
const fs = await import('node:fs')
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('C:\\Users\\DX03\\AppData\\Local\\Temp\\nb-pickfile.png', Buffer.from(shot.data, 'base64'))
ws.close()