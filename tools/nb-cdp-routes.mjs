// 逐个点击侧栏 6 个模块，校验 URL / 顶栏标题 / 占位卡标题是否一致
const port = 9222

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
  throw new Error('CDP 未就绪')
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
const send = (method, params = {}) => {
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

for (let i = 0; i < 40; i++) {
  if (await evaluate('!!document.querySelector("#app .nav-item")')) break
  await new Promise((r) => setTimeout(r, 250))
}

const out = []
const count = await evaluate('document.querySelectorAll("#app .nav-item").length')
for (let i = 0; i < count; i++) {
  await evaluate(`document.querySelectorAll('#app .nav-item')[${i}].click()`)
  await new Promise((r) => setTimeout(r, 350))
  out.push({
    nav: await evaluate('document.querySelectorAll("#app .nav-item .nav-title")[' + i + ']?.textContent || ""'),
    hash: await evaluate('location.hash'),
    topbar: await evaluate('document.querySelector("#app .topbar h1")?.textContent || ""'),
    card: await evaluate('document.querySelector("#app .head h2")?.textContent || ""'),
    stage: await evaluate('document.querySelector("#app .head .stage")?.textContent || ""'),
    active: await evaluate('document.querySelector("#app .nav-item.active .nav-title")?.textContent || ""'),
  })
}
console.log(JSON.stringify(out, null, 2))
ws.close()
