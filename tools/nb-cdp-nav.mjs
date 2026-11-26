// 开发态自动化验证：通过 CDP 读取页面 DOM、切换路由、截图
// 用法: node nb-cdp-nav.mjs <hash路径,如 /settings> [截图输出路径]
const port = 9222
const target = process.argv[2] || '/run'
const shot = process.argv[3] || ''

async function getPage() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('CDP 未就绪：找不到 page target')
}

const page = await getPage()
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
})

function send(method, params = {}) {
  const mid = ++id
  return new Promise((resolve) => {
    pending.set(mid, resolve)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
}

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve)
  ws.addEventListener('error', reject)
})

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value
}

// 等前端挂载
for (let i = 0; i < 40; i++) {
  const ready = await evaluate('!!document.querySelector("#app .nav-item")')
  if (ready) break
  await new Promise((r) => setTimeout(r, 250))
}

const result = { route: target, before: await evaluate('location.hash') }
// 通过点击侧栏导航切换路由，验证交互而非只验证地址栏
result.clicked = await evaluate(`(() => {
  const items = [...document.querySelectorAll('#app .nav-item')]
  const el = items.find((a) => a.getAttribute('href') === '#${target}') || items[0]
  if (!el) return 'no-nav-items'
  el.click()
  return el.textContent.trim()
})()`)
await new Promise((r) => setTimeout(r, 400))
result.afterHash = await evaluate('location.hash')
result.title = await evaluate('document.querySelector("#app .topbar h1")?.textContent || ""')
result.activeNav = await evaluate('document.querySelector("#app .nav-item.active")?.textContent.trim() || ""')
result.statusText = await evaluate('document.querySelector("#app .conn")?.textContent.trim() || ""')
result.db = await evaluate('document.querySelector("#app .db strong")?.textContent || ""')
result.cards = await evaluate('document.querySelectorAll("#app .paper-card").length')
result.connColor = await evaluate(`(() => {
  const dot = document.querySelector('#app .conn .dot')
  return dot ? getComputedStyle(dot).backgroundColor : ''
})()`)
result.bodyBg = await evaluate('getComputedStyle(document.body).backgroundColor')

if (shot) {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  const fs = await import('node:fs')
  fs.writeFileSync(shot, Buffer.from(s.result.data, 'base64'))
  result.screenshot = shot
}

console.log(JSON.stringify(result, null, 2))
ws.close()
