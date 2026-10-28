// 界面级回归：通过 Electron 远程调试读取输入框真实值
// 用法: node tools/test-ui-fill.js
const path = require('path');
const { spawn, execSync } = require('child_process');

const dev = path.resolve(__dirname, '..');
const exe = path.join(dev, 'dist-electron', 'Momo传值助手 1.0.0.exe');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getPage() {
  for (let i = 0; i < 20; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
      const page = list.find(x => x.type === 'page' && String(x.url).includes('8787'));
      if (page && page.webSocketDebuggerUrl) return page;
    } catch (_) {}
    await sleep(1000);
  }
  return null;
}

async function evaluate(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('ws error'));
    setTimeout(() => rej(new Error('ws timeout')), 15000);
  });
  const result = new Promise((res) => {
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1) res(msg);
    };
  });
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true }
  }));
  const out = await result;
  ws.close();
  return out;
}

(async () => {
  spawn(exe, ['--remote-debugging-port=9222'], { detached: true, stdio: 'ignore' }).unref();

  const page = await getPage();
  if (!page) { console.log('未找到调试页面'); process.exit(1); }

  await sleep(6000);
  const expr = `JSON.stringify({
    server: document.getElementById('connServer').value,
    user: document.getElementById('connUser').value,
    password: document.getElementById('connPass').value,
    db: document.getElementById('connDbSel').value,
    banner: (document.getElementById('connBannerText')||{}).textContent
  })`;
  const res = await evaluate(page.webSocketDebuggerUrl, expr);
  const value = res.result && res.result.result && res.result.result.value;
  console.log('界面输入框实际值:', value);
  await sleep(500);
  try { execSync('taskkill /IM "Momo传值助手.exe" /F', { stdio: 'ignore' }); } catch (_) {}
  await sleep(300);
  process.exitCode = 0;
})();
