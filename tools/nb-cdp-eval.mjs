// CDP 通用求值：node nb-cdp-eval.mjs "<JS 表达式>"
// 连 127.0.0.1:9222 的第一个页面，执行表达式并打印 JSON 结果。
const port = 9222
const expr = process.argv[2] || '1+1'

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find((t) => t.type === 'page')
if (!page) {
  console.error('没有可用的页面 target')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()

function send(method, params) {
  const mid = ++id
  return new Promise((resolve, reject) => {
    pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
}

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(msg.error.message))
    else resolve(msg.result)
  }
})

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve)
  ws.addEventListener('error', reject)
})

try {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.exceptionDetails) {
    console.log(JSON.stringify({ error: r.exceptionDetails.text, detail: r.exceptionDetails }, null, 2))
    process.exit(2)
  }
  console.log(JSON.stringify(r.result.value, null, 2))
} finally {
  ws.close()
}
