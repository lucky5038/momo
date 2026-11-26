const base = 'http://127.0.0.1:9222'
const list = await (await fetch(base + '/json/list')).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id
  pending.set(mid, { res, rej })
  ws.send(JSON.stringify({ id: mid, method, params }))
})
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p.res(m.result) }
})
ws.addEventListener('close', () => { for (const [, p] of pending) p.rej(new Error('ws closed')) })
await new Promise((r) => ws.addEventListener('open', r))
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }))?.result?.value
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const fs = await import('node:fs')
const shotTo = async (file) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(file, Buffer.from(s.data, 'base64'))
}
await wait(1500)
const first = await ev(`(() => ({
  hash: location.hash,
  hasWizard: !!document.querySelector('.wizard'),
  title: document.title,
  bodyText: document.body.innerText.slice(0, 120)
}))()`)
await shotTo('C:\\Users\\DX03\\AppData\\Local\\Temp\\nb-wizard-1.png')
await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('开始')); b && b.click(); return !!b })()`)
await wait(700)
const second = await ev(`(() => ({
  hasWizard: !!document.querySelector('.wizard'),
  inputs: [...document.querySelectorAll('.wizard input')].map(i => ({ v: i.value, ph: i.placeholder, type: i.type })),
  btns: [...document.querySelectorAll('.wizard button')].map(b => b.textContent.trim()).slice(0, 8)
}))()`)
await shotTo('C:\\Users\\DX03\\AppData\\Local\\Temp\\nb-wizard-2.png')
console.log(JSON.stringify({ first, second }, null, 2))
ws.close()