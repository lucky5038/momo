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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await send('Page.enable')

// 回到跨表带值页
await ev(`(() => { const n = [...document.querySelectorAll('.nav-item')].find((x) => x.textContent.includes('跨表带值')); n && n.click(); return location.hash })()`)
await sleep(1200)

const setSelect = async (sel, val) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'no-el'; el.value = ${JSON.stringify(val)}; el.dispatchEvent(new Event('change', { bubbles: true })); return el.value })()`)
const setCombo = async (idx, val) => ev(`(() => { const cb = document.querySelectorAll('.combo')[${idx}]; if (!cb) return 'no-combo'; const inp = cb.querySelector('input'); inp.value = ${JSON.stringify(val)}; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); return inp.value })()`)

console.log('doc:', await setSelect('#cf-doc', 'JSKJDB'))
await sleep(600)
console.log('tgt:', await setCombo(0, 'JDB960'))
await sleep(400)
console.log('src:', await setSelect('#cf-src', 'DCSHDB'))
await sleep(1500)
console.log('val:', await setCombo(1, 'HDB001'))
await sleep(800)

const chainInfo = await ev(`(() => { const s = document.querySelector('#cf-chain'); if (!s) return { missing: true }; return { value: s.value, options: [...s.options].map((o) => o.textContent.trim()), disabled: s.disabled, hint: s.parentElement.querySelector('.sub')?.textContent?.trim() || '' } })()`)
console.log('chain:', JSON.stringify(chainInfo, null, 2))

// 指定第 1 条链路（index 1）再预览
await ev(`(() => { const s = document.querySelector('#cf-chain'); s.value = '1'; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value })()`)
await sleep(400)
await ev(`(() => { const b = [...document.querySelectorAll('.btns button')].find((x) => x.textContent.includes('预览')); b && b.click(); return !!b })()`)
await sleep(6000)
const out = await ev(`(() => ({ status: document.querySelector('.status')?.textContent?.trim() || '', banners: [...document.querySelectorAll('.block .sub')].map((x) => x.textContent.trim()) }))()`)
console.log('after preview:', JSON.stringify(out, null, 2))
const shot = await send('Page.captureScreenshot', { format: 'png' })
const fs = await import('node:fs')
fs.writeFileSync('C:\\Users\\DX03\\AppData\\Local\\Temp\\nb-chain.png', Buffer.from(shot.data, 'base64'))
ws.close()