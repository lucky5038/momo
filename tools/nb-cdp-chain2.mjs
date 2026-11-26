const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page') || list[0]
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const r = pending.get(m.id); pending.delete(m.id); r(m.result) } })
await new Promise((r) => ws.addEventListener('open', r))
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }))?.result?.value
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await send('Page.enable')
const pick = async (v) => {
  await ev(`(() => { const s = document.querySelector('#cf-chain'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value })()`)
  await sleep(300)
  await ev(`(() => { const b = [...document.querySelectorAll('.btns button')].find((x) => x.textContent.includes('预览')); b && b.click(); return true })()`)
  await sleep(7000)
  return ev(`(() => ({ chain: [...document.querySelectorAll('.block .sub')].map((x) => x.textContent.trim()).find((t) => t.startsWith('本次链路')) || '(无链路提示)', status: document.querySelector('.status')?.textContent?.trim() }))()`)
}
console.log('auto:', JSON.stringify(await pick('-1'), null, 2))
console.log('path0:', JSON.stringify(await pick('0'), null, 2))
const shot = await send('Page.captureScreenshot', { format: 'png' })
const fs = await import('node:fs')
fs.writeFileSync('C:\\Users\\DX03\\AppData\\Local\\Temp\\nb-chain.png', Buffer.from(shot.data, 'base64'))
ws.close()