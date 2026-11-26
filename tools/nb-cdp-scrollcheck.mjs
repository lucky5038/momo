const base = 'http://127.0.0.1:9222'
const list = await (await fetch(base + '/json/list')).json()
const page = list.find((t) => t.type === 'page') || list[0]
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
  if (m.id && pending.has(m.id)) {
    const { res } = pending.get(m.id)
    pending.delete(m.id)
    res(m.result)
  }
})
await new Promise((r) => ws.addEventListener('open', r))
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  return r?.result?.value
}
const res = await ev(`(() => {
  const probe = document.createElement('div')
  probe.id = '__probe'
  probe.style.height = '2400px'
  const content = document.querySelector('.content')
  content.appendChild(probe)
  return new Promise((r) => setTimeout(() => {
    const sidebar = document.querySelector('aside, .sidebar')
    const before = { bodyTop: document.scrollingElement.scrollTop, sidebarTop: sidebar ? sidebar.scrollTop : null, contentTop: content.scrollTop }
    content.scrollTop = 600
    setTimeout(() => {
      const after = { bodyTop: document.scrollingElement.scrollTop, sidebarTop: sidebar ? sidebar.scrollTop : null, contentTop: content.scrollTop, docScrollable: document.scrollingElement.scrollHeight > window.innerHeight + 1 }
      probe.remove()
      r({ before, after })
    }, 300)
  }, 200))
})()`)
console.log(JSON.stringify(res, null, 2))
ws.close()