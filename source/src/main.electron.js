// Electron 主进程 —— N-B助手 独立应用版
// 启动内置 HTTP 后端 (app.js) + 创建无边框应用窗口指向它
'use strict';

const { app, BrowserWindow, shell, ipcMain, dialog, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');

// 最终效果预览：使用独立临时 userData，不读取/覆盖真实配置。
// 启动参数：N-B助手.exe --preview
const isPreview = process.argv.includes('--preview');
const isDev = !isPreview && (process.env.NB_DEV === '1' || process.argv.includes('--dev'));
// 前端工程化（Vue/Vite）开发地址：设置 NB_RENDERER_URL 后，开发版窗口直接加载 Vite 开发服务器；
// 未设置时保持原有行为（加载内置后端页面），不影响正式版与旧界面。
const rendererUrl = (isDev && String(process.env.NB_RENDERER_URL || '').trim()) || '';
if (isPreview) {
  try {
    const previewDir = path.join(app.getPath('temp'), 'NBPreviewRun');
    fs.mkdirSync(previewDir, { recursive: true });
    app.setPath('userData', previewDir);
    console.log('[preview] 使用临时配置目录: ' + previewDir);
  } catch (e) {
    console.error('[preview] 初始化临时目录失败: ' + e.message);
  }
} else if (isDev) {
  try {
    const devDir = path.join(app.getPath('appData'), 'N-B助手-开发版');
    fs.mkdirSync(devDir, { recursive: true });
    app.setPath('userData', devDir);
    console.log('[dev] 使用开发数据目录: ' + devDir);
  } catch (e) {
    console.error('[dev] 初始化开发目录失败: ' + e.message);
  }
}

// 与 app.js 的 BASE_DIR 保持一致：便携版用 PORTABLE_EXECUTABLE_DIR，
// 安装版用用户数据目录。port.txt 由后端写在这里。
function baseDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  try { return app.getPath('userData'); } catch (_) {}
  return path.dirname(process.execPath);
}

function insideDir(target, dir) {
  const rel = path.relative(path.resolve(dir), path.resolve(target));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function cleaningRoots() {
  const roots = [];
  try { roots.push(path.join(baseDir(), 'cleaning')); } catch (_) {}
  try { roots.push(path.join(app.getPath('userData'), 'cleaning')); } catch (_) {}
  return [...new Set(roots.map(p => path.resolve(p)))];
}

function isCleaningOutput(target) {
  return cleaningRoots().some(root => insideDir(target, root));
}

// 另存为：只允许把 cleaning 任务输出复制到用户选择的位置，不能读取任意文件。
ipcMain.handle('cleaning:save-as', async (_event, payload) => {
  const sourcePath = String(payload && payload.sourcePath || '');
  if (!sourcePath || !isCleaningOutput(sourcePath) || !fs.existsSync(sourcePath)) {
    throw new Error('无效的清洗文件路径');
  }
  const suggested = String(payload && payload.suggestedName || path.basename(sourcePath));
  const safe = suggested.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || '导入包.xls';
  const result = await dialog.showSaveDialog({
    title: '保存清洗后的导入包',
    defaultPath: path.join(app.getPath('documents'), safe),
    filters: [{ name: 'Excel 文件', extensions: ['xls'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation']
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  let dest = result.filePath;
  if (!/\.xls$/i.test(dest)) dest += '.xls';
  fs.copyFileSync(sourcePath, dest);
  return { ok: true, path: dest };
});

ipcMain.handle('cleaning:open', async (_event, target) => {
  const file = String(target || '');
  if (!file || !isCleaningOutput(file) || !fs.existsSync(file)) {
    throw new Error('无效的清洗文件路径');
  }
  const error = await shell.openPath(file);
  if (error) throw new Error(error);
  return { ok: true };
});

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
    if (fs.existsSync(path.join(newDir, 'fresh_install.flag')) ||
        fs.existsSync(path.join(newDir, 'config.js')) ||
        fs.existsSync(path.join(newDir, 'onboarding_done.flag'))) {
      console.log('[migrate] 本品牌已有配置/已完成引导，跳过旧数据迁移: ' + newDir);
      return;
    }
    const legacyDirs = ['奶蕉助手', 'Momo传值助手'];
    const files = [
      'config.js', 'creds.json', 'chain_registry.json', 'invoice_source_map.json',
      'first_open.flag', 'onboarding_done.flag',
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

// 开发版：源码一改就热更新；界面文件刷新页面，后端代码自动重启进程。
// 正式版不会进入这里（isDev 仅在 NB_DEV=1 或 --dev 时成立）。
function installDevWatcher() {
  if (!isDev) return;
  let timer = null;
  const onChange = (_event, filename) => {
    const name = String(filename || '');
    if (/port\.txt$|server_debug|\.log$|cleaning[\\/]jobs/i.test(name)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const uiChange = /\.(html|css|js)$/i.test(name) && /public|public_inline/i.test(name);
      if (uiChange && mainWindow && !mainWindow.isDestroyed()) {
        console.log('[dev] 界面变更，刷新: ' + name);
        mainWindow.webContents.reloadIgnoringCache();
        return;
      }
      console.log('[dev] 源码变更，重启: ' + name);
      app.relaunch();
      app.exit(0);
    }, 600);
  };
  try {
    fs.watch(__dirname, { recursive: true }, onChange);
    const inlineFile = path.join(__dirname, '..', 'public_inline.js');
    if (fs.existsSync(inlineFile)) fs.watch(inlineFile, onChange);
    console.log('[dev] 已监听源码变更');
  } catch (e) {
    console.error('[dev] 监听源码失败: ' + e.message);
  }
}

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
  // 开发版加载的是浅色「纸墨」前端：窗口标题栏跟随浅色，避免深色系统主题下黑框配米白页的割裂
  if (rendererUrl) {
    try { nativeTheme.themeSource = 'light'; } catch (e) { /* 忽略：旧 Electron 无此能力 */ }
  }

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: rendererUrl ? '#f7f3ea' : '#0b1220',
    // 开发版加载纸墨浅色前端：标题栏交给页面自绘（保留系统的最小化/最大化/关闭按钮），
    // 不然 Windows 深色主题会给一条黑标题栏，和米白页面永远是两种颜色
    ...(rendererUrl ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#f7f3ea', symbolColor: '#1c1b19', height: 40 } } : {}),
    title: 'N-B助手 · 让ERP在中国普遍成功',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // 移除默认菜单，彻底"桌面软件化"
  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();

  if (isDev) {
    mainWindow.setTitle('N-B助手 · 开发版');
    mainWindow.on('page-title-updated', (e) => {
      e.preventDefault();
      mainWindow.setTitle('N-B助手 · 开发版');
    });
  }

  if (rendererUrl) {
    // 开发版：直接加载前端工程（Vite dev server）。不设置该变量即回退到旧的内置后端页面。
    console.log('[Electron] 开发版加载前端工程地址: ' + rendererUrl);
    mainWindow.loadURL(rendererUrl);
  } else {
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
  }

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
  // 模板库/模板记忆放在用户数据目录，升级或移动便携版 exe 不会丢。
  process.env.NB_CLEANING_TEMPLATES_DIR = path.join(app.getPath('userData'), 'cleaning', 'templates');
  migrateLegacyUserData();

  // 备份路径不再启动时弹窗，改为主界面「备份路径」按钮选择（/api/backup-dir）
  createWindow();
  installDevWatcher();

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
