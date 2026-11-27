/** 新主界面冒烟：十步首页 → 点编码/检查/齿轮/灰格提示，读回 hash 与可见文本 */
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page') || list[0]
const ws = new WebSocket(page.webSocketDebuggerUrl)

let id = 0
const pending = new Map()
const events = []
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
  } else if (m.method === 'Runtime.exceptionThrown' || m.method === 'Log.entryAdded') {
    events.push(m)
  }
})
await new Promise((r) => ws.addEventListener('open', r))

const ev = async (expr) =>
  (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }))?.result?.value
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')

const snap = () =>
  ev(`(() => {
    const steps = [...document.querySelectorAll('.step')].map((el) => ({
      no: el.querySelector('.no')?.textContent?.trim(),
      nm: el.querySelector('.nm')?.textContent?.trim(),
      st: el.querySelector('.st')?.textContent?.trim(),
      dev: el.classList.contains('dev'),
    }))
    return {
      hash: location.hash,
      title: document.querySelector('h1')?.textContent?.trim() || '',
      steps,
      toasts: [...document.querySelectorAll('.toast, .toast-item')].map((t) => t.textContent.trim()),
      conn: document.querySelector('.conn')?.textContent?.trim() || '',
      hasTopbar: !!document.querySelector('.topbar'),
    }
  })()`)

// 回首页
await ev(`location.hash = '#/'`)
await sleep(900)
const home = await snap()

// 点 03 编码
await ev(`(() => { const el = [...document.querySelectorAll('.step')].find((s) => s.querySelector('.no')?.textContent?.trim() === '03'); el && el.click(); return true })()`)
await sleep(2500)
const run = await snap()
const tabs = await ev(`[...document.querySelectorAll('.vt')].map((t) => t.textContent.trim())`)

// 切到触发器标签
await ev(`(() => { const t = [...document.querySelectorAll('.vt')].find((x) => x.textContent.includes('触发器')); t && t.click(); return true })()`)
await sleep(2500)
const trg = await ev(`(() => ({
  rows: document.querySelectorAll('tbody tr').length,
  note: document.querySelector('.sub')?.textContent?.trim() || document.querySelector('.status')?.textContent?.trim() || '',
}))()`)

// 返回十步 → 点检查 09 → 设置齿轮
await ev(`location.hash = '#/'`)
await sleep(800)
await ev(`(() => { const el = [...document.querySelectorAll('.step')].find((s) => s.querySelector('.no')?.textContent?.trim() === '09'); el && el.click(); return true })()`)
await sleep(1500)
const diag = await snap()

await ev(`location.hash = '#/'`)
await sleep(800)
await ev(`(() => { const g = document.querySelector('.gear'); g && g.click(); return true })()`)
await sleep(1500)
const settings = await snap()

// 灰格点击 → 应出 toast
await ev(`location.hash = '#/'`)
await sleep(800)
await ev(`(() => { const el = [...document.querySelectorAll('.step')].find((s) => s.querySelector('.no')?.textContent?.trim() === '01'); el && el.click(); return true })()`)
await sleep(900)
const planned = await snap()

await ev(`location.hash = '#/'`)
await sleep(900)
const shot = await send('Page.captureScreenshot', { format: 'png' })
const fs = await import('node:fs')
fs.writeFileSync('C:\\Users\\DX03\\AppData\\Local\\Temp\\nb-home-211.png', Buffer.from(shot.data, 'base64'))

console.log(JSON.stringify({ home, run, tabs, trg, diagHash: diag.hash, settings: { hash: settings.hash, title: settings.title }, planned: planned.toasts, errors: events.length }, null, 2))
ws.close()
