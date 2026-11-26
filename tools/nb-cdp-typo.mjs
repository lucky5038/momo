const base = 'http://127.0.0.1:9222'
const list = await (await fetch(base + '/json/list')).json()
const page = list.find((t) => t.type === 'page') || list[0]
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const r = pending.get(m.id); pending.delete(m.id); r(m.result) } })
await new Promise((r) => ws.addEventListener('open', r))
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }))?.result?.value
const fs = await import('node:fs')
const targets = [['数据清洗', 'nb-typo-cleaning.png'], ['触发器管理', 'nb-typo-triggers.png'], ['一句话带值', 'nb-typo-chat.png']]
for (const [label, file] of targets) {
  await ev(`(() => { const el = [...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes(${JSON.stringify(label)})); el && el.click(); return location.hash })()`)
  await new Promise((r) => setTimeout(r, 900))
  const info = await ev(`(() => {
    const pick = (sel) => { const el = document.querySelector(sel); if (!el) return null; const s = getComputedStyle(el); return { sel, size: s.fontSize, weight: s.fontWeight, ls: s.letterSpacing, color: s.color, family: s.fontFamily.split(',')[0] } }
    return ['.kicker', 'h2', '.desc', '.sub', '.step', '.block-head strong', '.point b'].map(pick).filter(Boolean)
  })()`)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync('C:\\Users\\DX03\\AppData\\Local\\Temp\\' + file, Buffer.from(shot.data, 'base64'))
  console.log(label, JSON.stringify(info, null, 1))
}
ws.close()