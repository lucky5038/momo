// Electron 主进程 —— N-B助手 独立应用版
// 启动内置 HTTP 后端 (app.js) + 创建无边框应用窗口指向它
'use strict';

const { app, BrowserWindow, shell } = require('electron');
const fs = require('fs');
const path = require('path');

// 最终效果预览：使用独立临时 userData，不读取/覆盖真实配置。
// 启动参数：N-B助手.exe --preview
const isPreview = process.argv.includes('--preview');
if (isPreview) {
  try {
    const previewDir = path.join(app.getPath('temp'), 'NBPreviewRun');
    fs.mkdirSync(previewDir, { recursive: true });
    app.setPath('userData', previewDir);
    console.log('[preview] 使用临时配置目录: ' + previewDir);
  } catch (e) {
    console.error('[preview] 初始化临时目录失败: ' + e.message);
  }
}

// 与 app.js 的 BASE_DIR 保持一致：便携版用 PORTABLE_EXECUTABLE_DIR，
// 安装版用用户数据目录。port.txt 由后端写在这里。
function baseDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  try { return app.getPath('userData'); } catch (_) {}
  return path.dirname(process.execPath);
}

// 读取 app.js 写入的实际端口（端口冲突时可能 > 8787）
// 从旧品牌数据目录迁移配置与标志，避免改名后要求重新配置数据库。
// 按品牌演进顺序尝试：奶蕉助手 -> N-B助手，再兜底更早的 Momo传值助手。
function migrateLegacyUserData() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return;
  try {
    const appData = app.getPath('appData');
    const newDir = app.getPath('userData');
    // 全新安装由安装器写入 fresh_install.flag；此时不能把旧品牌配置复制进来，
    // 否则会绕过首次引导，让用户误以为“新装没有引导”。
    if (fs.existsSync(path.join(newDir, 'fresh_install.flag'))) {
      console.log('[migrate] 全新安装，跳过旧数据迁移: ' + newDir);
      return;
    }
    const legacyDirs = ['奶蕉助手', 'Momo传值助手'];
    const files = [
      'config.js', 'creds.json', 'chain_registry.json', 'invoice_source_map.json',
      'first_open.flag', 'onboarding_done.flag', 'fresh_install.flag',
      'nb_backup_picked.flag', 'momo_backup_picked.flag'
    ];
    for (const oldName of legacyDirs) {
      const oldDir = path.join(appData, oldName);
      if (oldDir === newDir || !fs.existsSync(oldDir)) continue;
      fs.mkdirSync(newDir, { recursive: true });
      for (const name of files) {
        const from = path.join(oldDir, name);
        const to = path.join(newDir, name);
        if (fs.existsSync(from) && !fs.existsSync(to)) fs.copyFileSync(from, to);
      }
      console.log('[migrate] 已从旧数据目录迁移: ' + oldDir + ' -> ' + newDir);
    }
  } catch (e) {
    console.error('[migrate] 旧数据迁移失败: ' + e.message);
  }
}

function getActualPort() {
  try {
    const portFile = path.join(baseDir(), 'port.txt');
    if (fs.existsSync(portFile)) {
      const p = parseInt(fs.readFileSync(portFile, 'utf8').trim(), 10);
      if (p > 0) return p;
    }
  } catch (_) {}
  return 8787;
}

let mainWindow = null;

// 单实例锁：避免两个进程各自监听端口、互相覆盖 port.txt，导致窗口连错后端/账套
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0b1220',
    title: 'N-B助手 · 让ERP在中国普遍成功',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // 移除默认菜单，彻底"桌面软件化"
  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();

  // 加载本地 http 后端提供的界面（端口以 port.txt 为准，冲突时自动递增）
  // 等待 app.js 写入 port.txt 后再加载（首次加载失败自动重试一次）
  const loadWithRetry = (attempts) => {
    const port = getActualPort();
    mainWindow.loadURL('http://127.0.0.1:' + port + '/', (err) => {
      if (err && attempts > 0) {
        console.log('[Electron] 加载失败，2秒后重试：', err.message);
        setTimeout(() => loadWithRetry(attempts - 1), 2000);
      }
    });
  };
  setTimeout(() => loadWithRetry(3), 300); // 给 app.js 一点时间写 port.txt

  // 仅允许 127.0.0.1:8787，其他外链交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const _p = getActualPort();
    if (url.startsWith('http://127.0.0.1:' + _p) || url.startsWith('http://localhost:' + _p)) {
      return { action: 'deny' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// 在 require('./src/app.js') 之前安装 Module._load shim：
// 拦截 @azure-rest/core-client 和 @typespec/ts-http-runtime 的任意子路径，
// 返回一个"函数型" Proxy 桩：
//   - 属性访问返回自身（支持 .createLoggerContext 等命名导出）
//   - 可被调用（支持 createLoggerContext() 等函数调用）
//   - 可被 new（支持 class 构造场景）
// 该桩只用于防御性兜底，主程序路径（数据库连接/档案扫描/备份/触发器）不会触及此链。
if (!global.__chz_esModuleShimInstalled) {
  global.__chz_esModuleShimInstalled = true;
  const Module = require('module');
  const origLoad = Module._load;

  // 用一个函数作为 Proxy target，使 apply/construct 陷阱生效
  const fnTarget = function esmStubFn() { return esmStub; };
  const esmStub = new Proxy(fnTarget, {
    get(target, prop) {
      if (prop === Symbol.for('nodejs.util.inspect.custom')) {
        return () => '[ESM shim stub]';
      }
      if (prop === '__esModuleShim') return true;
      if (prop === 'then') return undefined;   // 防止被当作 thenable
      if (prop === 'default') return esmStub;
      // 其余属性都返回自身（函数），保持链式不断裂
      return esmStub;
    },
    set() { return true; },
    apply() {
      return esmStub;
    },
    construct() {
      return esmStub;
    },
    has() { return true; }
  });

  Module._load = function(request, parent, isMain) {
    if (
      request === '@azure-rest/core-client' ||
      (typeof request === 'string' &&
       (request.indexOf('@azure-rest/core-client') === 0 ||
        request.indexOf('@typespec/ts-http-runtime') === 0))
    ) {
      console.log('[ESM shim] 拦截:', request);
      return esmStub;
    }
    return origLoad.call(this, request, parent, isMain);
  };
  console.log('[Electron] ESM shim 已安装（@azure-rest/core-client 等）');
}

app.whenReady().then(async () => {
  // 第二个实例只负责唤起已有窗口，绝不能再启动后端/覆盖 port.txt
  if (!gotSingleInstanceLock) return;
  // 设置后端运行模式，避免 app.js 再去开 Edge/Chrome 窗口
  process.env.CHZ_ELECTRON = '1';
  migrateLegacyUserData();

  // 备份路径不再启动时弹窗，改为主界面「备份路径」按钮选择（/api/backup-dir）
  createWindow();

  // 在进程内直接启动后端（app.js 顶层即 listen + 建库连接）
  try {
    require('./app.js');
    console.log('[Electron] 后端已在本进程内启动');
  } catch (e) {
    console.error('[Electron] 后端启动失败:', e && e.message);
    if (mainWindow) mainWindow.loadURL('data:text/html;charset=utf-8,<h2>后端启动失败</h2><pre>' + (e && e.stack || e) + '</pre>');
  }
});

// 所有窗口关闭 -> 退出（后端随之终止，端口释放）
app.on('window-all-closed', () => {
  app.quit();
});

app.on('quit', () => {
  try { process.exit(0); } catch (_) {}
});
