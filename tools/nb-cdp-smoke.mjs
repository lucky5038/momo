// 冒烟检查：依次切 6 个路由，收集控制台异常/未捕获错误与页面关键元素，最后截图。
// 用法：node tools/nb-cdp-smoke.mjs [截图路径]
const base = 'http://127.0.0.1:9222'
const shotPath = process.argv[2] || 'C:\\Users\\DX03\\AppData\\Local\\Temp\\nb-smoke.png'

const list = await (await fetch(base + '/json/list')).json()
const page = list.find((t) => t.type === 'page')
if (!page) {
  console.error('没有找到页面目标，Electron 是否带 --remote-debugging-port=9222 启动？')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const errors = []
const send = (method, params = {}) =>
  new Promise((res) => {
    const mid = ++id
    pending.set(mid, res)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })

ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const res = pending.get(m.id)
    pending.delete(m.id)
    res(m.result)
    return
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails
    errors.push(`exception: ${d.exception?.description || d.text}`)
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    errors.push(`console: ${m.params.entry.text}`)
  }
})

await new Promise((r) => ws.addEventListener('open', r))
await send('Runtime.enable')
await send('Log.enable')
await send('Page.enable')

const evaluate = async (expr) =>
  (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }))?.result?.value

const routes = [
  ['跨表带值', '/run'],
  ['触发器管理', '/triggers'],
  ['一句话带值', '/chat'],
  ['数据清洗', '/cleaning'],
  ['数据体检', '/diagnose'],
  ['系统设置', '/settings'],
]

const report = []
for (const [label, path] of routes) {
  const before = errors.length
  await evaluate(`(() => { const el = [...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes(${JSON.stringify(label)})); el && el.click(); })()`)
  await new Promise((r) => setTimeout(r, 1200))
  const info = await evaluate(`(() => ({
    hash: location.hash,
    title: document.querySelector('.topbar h1')?.textContent?.trim() || '',
    status: document.querySelector('[role=status]')?.textContent?.trim() || '',
    cards: document.querySelectorAll('.paper-card, .card').length,
    scrollable: document.querySelector('.content')?.scrollHeight > document.querySelector('.content')?.clientHeight,
    bodyOverflow: document.body.scrollHeight > window.innerHeight,
  }))()`)
  report.push({ label, path, ...info, newErrors: errors.slice(before) })
}

const shot = await send('Page.captureScreenshot', { format: 'png' })
const fs = await import('node:fs')
fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))

console.log(JSON.stringify({ report, errors, screenshot: shotPath }, null, 2))
ws.close()
