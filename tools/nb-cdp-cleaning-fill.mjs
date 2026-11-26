// 把当前预览报出的硬错误字段补上默认值，再预览 + 生成（验证 happy path）
import { writeFileSync } from 'node:fs'
const shotPath = process.argv[2]
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && /5173/.test(t.url))
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
const call = (method, params) =>
  new Promise((res) => {
    const i = ++id
    pend.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const ev = async (expr) => {
  const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.text }
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const status = () => ev(`document.querySelector('.status')?.textContent?.trim() || ''`)

await call('Page.enable', {})

// 1. 收集错误字段并逐行填默认值
const filled = await ev(`(() => {
  const codes = [...new Set([...document.querySelectorAll('.issue.error .loc')]
    .map(x => x.textContent.split('·')[0].trim()).filter(Boolean))];
  const done = [];
  for (const code of codes) {
    const tr = document.getElementById('clean-row-' + code);
    if (!tr) { done.push({ code, skip: 'no-row' }); continue; }
    // 第 4 列才是「默认值 / 固定值」单元格，前 3 列是来源列/清洗方式，别填错
    const cell = tr.querySelectorAll('td')[3];
    const sel = cell ? cell.querySelector('select:not(:disabled)') : null;
    const inp = cell ? cell.querySelector('input[type=text]:not(:disabled)') : null;
    if (sel) {
      const opt = [...sel.options].find(o => o.value !== '');
      if (!opt) { done.push({ code, skip: 'no-option' }); continue; }
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      done.push({ code, kind: 'select', value: opt.value });
    } else if (inp) {
      inp.value = '2026-01-01';
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      done.push({ code, kind: 'text', value: '2026-01-01' });
    } else {
      done.push({ code, skip: 'fixed' });
    }
  }
  return done;
})()`)

await sleep(800)
// 2. 预览
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='预览'); b && b.click(); return !!b; })()`)
let previewStatus = ''
for (let i = 0; i < 25; i++) {
  await sleep(2500)
  previewStatus = await status()
  if (/预览文件已生成|预览失败|硬错误/.test(previewStatus)) break
}
const stats = await ev(`(() => { const s=document.querySelector('.stats'); return s ? s.textContent.replace(/\\s+/g,' ').trim() : ''; })()`)
const issues = await ev(`(() => [...document.querySelectorAll('.issue')].slice(0,8).map(x=>x.textContent.replace(/\\s+/g,' ').trim().slice(0,80)))()`)

// 3. 生成（前提：预览 0 错误）
let genStatus = ''
if (!/硬错误/.test(previewStatus)) {
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='生成'); b && b.click(); return !!b; })()`)
  for (let i = 0; i < 25; i++) {
    await sleep(2500)
    genStatus = await status()
    if (/生成完成|生成失败|硬错误/.test(genStatus)) break
  }
}
const outPath = await ev(`(() => { const p=document.querySelector('.path'); return p ? p.textContent.trim() : ''; })()`)
const shot = await call('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data && shotPath) writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'))
console.log(JSON.stringify({ filled, previewStatus, stats, issues, genStatus, outPath, screenshot: shotPath }, null, 2))
ws.close()
