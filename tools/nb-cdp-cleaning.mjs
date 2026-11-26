// 数据清洗（P3）界面验证：导入模板 → 读取 → 预览 → 生成（真实 Excel 解析）
// 用法：node nb-cdp-cleaning.mjs <template.xls> <source.xlsx> <screenshot.png>
import { writeFileSync } from 'node:fs'

const [tplFile, srcFile, shotPath] = process.argv.slice(2)
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && /5173/.test(t.url))
if (!page) throw new Error('no dev page on 9222')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))

let id = 0
const pend = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) {
    pend.get(m.id)(m)
    pend.delete(m.id)
  }
}
function call(method, params) {
  return new Promise((res) => {
    const i = ++id
    pend.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
}
const ev = async (expr) => {
  const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.text }
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const status = () => ev(`document.querySelector('.status')?.textContent?.trim() || ''`)
const mappingInfo = () =>
  ev(`(() => { const rows=[...document.querySelectorAll('.map-wrap tbody tr')];
    const first = rows[0];
    return { rows: rows.length, firstCells: first ? [...first.querySelectorAll('td')].map(td => td.textContent.trim().slice(0,24)) : [] }; })()`)

await call('Page.enable', {})
await call('DOM.enable', {})
await ev(`location.hash = '#/cleaning'`)
await sleep(1200)

// 1. 取消「预览时自动打开」，避免测试时弹 Excel
await ev(`(() => { const cb=document.querySelector('.auto-row input[type=checkbox]'); if(cb && cb.checked) cb.click(); return cb ? cb.checked : 'none'; })()`)

// 2. 模板文件 + 来源文件（DOM.setFileInputFiles 是同源页面拿绝对路径的唯一方式）
const doc = await call('DOM.getDocument', { depth: -1 })
const inputs = await call('DOM.querySelectorAll', { nodeId: doc.result.root.nodeId, selector: 'input[type=file]' })
const [tplNode, srcNode] = inputs.result.nodeIds
if (!tplNode || !srcNode) throw new Error('file inputs not found: ' + JSON.stringify(inputs.result.nodeIds))
await call('DOM.setFileInputFiles', { nodeId: tplNode, files: [tplFile] })
await sleep(400)
await call('DOM.setFileInputFiles', { nodeId: srcNode, files: [srcFile] })
await sleep(400)

// 3. 导入模板到模板库
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('导入模板文件')); b && b.click(); return !!b; })()`)
await sleep(6000)
const afterImport = await status()

// 4. 读取
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='读取'); b && b.click(); return !!b; })()`)
let readStatus = ''
for (let i = 0; i < 40; i++) {
  await sleep(3000)
  readStatus = await status()
  if (/读取完成|读取失败/.test(readStatus)) break
}
const map = await mappingInfo()

// 5. 预览
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='预览'); b && b.click(); return !!b; })()`)
let previewStatus = ''
for (let i = 0; i < 30; i++) {
  await sleep(3000)
  previewStatus = await status()
  if (/预览文件已生成|预览失败|硬错误/.test(previewStatus)) break
}
const stats = await ev(`(() => { const s=document.querySelector('.stats'); return s ? s.textContent.replace(/\\s+/g,' ').trim() : ''; })()`)
const issues = await ev(`(() => { const items=[...document.querySelectorAll('.issue')].slice(0,6).map(x=>x.textContent.replace(/\\s+/g,' ').trim().slice(0,90)); return items; })()`)

// 6. 生成
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='生成'); b && b.click(); return !!b; })()`)
let genStatus = ''
for (let i = 0; i < 30; i++) {
  await sleep(3000)
  genStatus = await status()
  if (/生成完成|生成失败|硬错误/.test(genStatus)) break
}
const outPath = await ev(`(() => { const p=document.querySelector('.path'); return p ? p.textContent.trim() : ''; })()`)

const shot = await call('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data && shotPath) writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'))

console.log(
  JSON.stringify({ afterImport, readStatus, mapping: map, previewStatus, stats, issues, genStatus, outPath, screenshot: shotPath }, null, 2),
)
ws.close()
