// 传值工具 独立应用版
// 功能：启动 HTTP 服务 + 自动打开 Edge 应用窗口（无浏览器标签栏，像独立软件）
// 窗口关闭后自动退出，不留后台进程
//
// 启动方式：双击"传值工具.vbs" 或 "传值工具.bat"
// 无需手动打开浏览器

const http = require('http');
const fs = require('fs');
const path = require('path');

// 便携版：配置写在 exe 旁边；安装版：配置写在用户数据目录（不受安装目录残留影响）。
function resolveBaseDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (process.env.CHZ_ELECTRON) {
    try {
      const electron = require('electron');
      // 安装版统一用用户数据目录，避免安装目录里的旧 config.js 被带出来
      return electron.app.getPath('userData');
    } catch (_) {}
  }
  try { if (process.pkg) return path.dirname(process.execPath); } catch (_) {}
  return __dirname;
}
const BASE_DIR = resolveBaseDir();

// 兼容旧入口：若从 exe 同级目录运行时，可自动补齐 config.js。
(function ensureConfig() {
  const cfgPath = path.join(BASE_DIR, 'config.js');
  if (fs.existsSync(cfgPath)) { fs.chmodSync(cfgPath, 0o666); return; }
  fs.writeFileSync(cfgPath, [
'// 首次运行自动生成。可编辑此文件后重启工具。',
'module.exports = {',
  '  db: { server: \'\', user: \'sa\', password: \'\', database: \'DSB\', options: { encrypt: false, trustServerCertificate: true, instanceName: null } },',
  '  backupDir: \'D:\\\\TPA\\\\SQL2008\',',
  '  httpPort: 8787',
'};',
  ].join('\n'), 'utf8');
  console.log('[传值工具] 已生成配置文件: ' + cfgPath);
})();
const { spawn, exec } = require('child_process');

// ====== 配置 ======
const CONFIG = require('./config');
const PORT = CONFIG.httpPort || 8787;
const APP_URL = 'http://localhost:' + PORT;

// mssql
// autochain_detect.js 已合并到本文件
const PUBLIC_HTML = require('../public_inline');
let sql;
try { sql = require('mssql'); }
catch (e) { sql = require('mssql'); }

const { docs: DOC_ITEMS, srcs: SRC_ITEMS } = require('./dicts');
const sqlgen = require('./sqlgen')(sql);
const chainBuilder = require('./chain');
const fieldDict = require('./field-dict');

// ====== 日志 ======

// 优先从 exe 所在目录读取外部 config.js（保存配置后写在这里），读不到再退回打包内嵌版
(function _reloadConfig(){
  try{
    const ext = path.join(BASE_DIR, 'config.js');
    if (fs.existsSync(ext)) {
      delete require.cache[require.resolve('./config')];
      const extCfg = require(ext);
      CONFIG.db = extCfg.db || CONFIG.db;
      if (extCfg.backupDir) CONFIG.backupDir = extCfg.backupDir;
      if (extCfg.httpPort) CONFIG.httpPort = extCfg.httpPort;
      console.log('[config] 已加载外部 config.js: ' + ext);
    }
  } catch(e){ console.log('[config] 外部 config.js 读取失败，用内嵌版: ' + e.message); }
})();
const DEBUG_LOG = path.join(BASE_DIR, "server_debug.log");
// 注: 打包模式下静态资源走 /$snapshot, 持久化文件(配置)写 BASE_DIR
// 简化：静态文件用 APP_BASE 解析
function dbg(msg) { try { fs.appendFileSync(DEBUG_LOG, '[' + new Date().toISOString() + '] ' + msg + '\n'); } catch (_) {} }

// ====== 数据库连接池 ======
let pool = null;
let CUR_CONFIG = null;

function makeConnConfig(over) { return Object.assign({}, CONFIG.db, over || {}); }
function poolKey(cfg) { return JSON.stringify({ server: cfg.server, user: cfg.user, password: cfg.password, database: cfg.database, instanceName: cfg.options?.instanceName || null }); }

// 连接池操作串行化，避免切换账套时并发请求用旧配置把池子切回去
let poolLock = Promise.resolve();
function withPoolLock(fn) {
  const run = poolLock.then(fn, fn);
  poolLock = run.then(() => {}, () => {});
  return run;
}

async function _getPoolUnlocked(cfgOverride) {
  const cfg = cfgOverride || CUR_CONFIG || CONFIG.db;
  const key = poolKey(cfg);
  if (pool && pool._chzKey === key && !pool._broken) return pool;
  if (pool) { try { await pool.close(); } catch (e) {} pool = null; }
  const o = {
    server: cfg.server, user: cfg.user, password: cfg.password, database: cfg.database,
    options: { encrypt: !!cfg.options?.encrypt, trustServerCertificate: cfg.options?.trustServerCertificate !== false },
    // 快连模式：缩短连接/请求超时，连不上时快速失败并抛错回前端，避免启动卡 60s
    connectionTimeout: 4000, requestTimeout: 30000
  };
  if (cfg.options?.instanceName) o.options.instanceName = cfg.options.instanceName;
  const newPool = new sql.ConnectionPool(o);
  pool = await newPool.connect();
  pool._chzKey = key; pool._broken = false;
  try { await pool.request().query('SELECT 1 AS ok'); }
  catch (e) { try { await pool.close(); } catch (_) {} pool = null; CUR_CONFIG = null; throw new Error('数据库连接验证失败: ' + e.message); }
  CUR_CONFIG = cfg;
  return pool;
}

function getPool(cfgOverride) { return withPoolLock(() => _getPoolUnlocked(cfgOverride)); }

async function switchPool(cfg) {
  return withPoolLock(async () => {
    CONFIG.db.database = cfg.database; // 后续断线重连也指向目标账套
    CUR_CONFIG = cfg;                  // 切换期间并发请求立即使用目标配置
    if (pool) { try { await pool.close(); } catch (_) {} pool = null; }
    return _getPoolUnlocked(cfg);
  });
}

function resetPool() {
  return withPoolLock(async () => {
    if (pool) { try { await pool.close(); } catch (_) {} pool = null; CUR_CONFIG = null; }
  });
}
function markBroken() { if (pool) { pool._broken = true; pool = null; CUR_CONFIG = null; } }

// 读取连接池实际所在的库名。切库只改配置、没真正重连时，这里能立刻暴露。
async function poolDbName(p) {
  try {
    const r = await p.request().query('SELECT DB_NAME() AS db');
    return (r.recordset[0] && r.recordset[0].db) || '';
  } catch (_) { return ''; }
}

// 写操作前确认连接池真在目标账套；不一致就按目标账套重建连接池。
async function ensurePoolDb(expected) {
  let p = await getPool();
  const actual = await poolDbName(p);
  if (expected && actual && actual.toLowerCase() !== String(expected).toLowerCase()) {
    dbg('[db] pool=' + actual + ' expected=' + expected + '，重建连接池');
    p = await switchPool(makeConnConfig({ database: expected }));
    if (typeof CUR_DOCS !== 'undefined') { CUR_DOCS = DOC_ITEMS; CUR_SRCS = SRC_ITEMS; }
    const after = await poolDbName(p);
    if (after && after.toLowerCase() !== String(expected).toLowerCase()) {
      throw new Error('账套不一致：当前连接=' + after + '，目标=' + expected);
    }
  }
  return p;
}

// ===== 全单据链路注册表（只读诊断，第一阶段）=====
const CHAIN_REGISTRIES = {};
const CHAIN_BUILDS = {};
async function getChainRegistry() {
  const cfg = CUR_CONFIG || CONFIG.db;
  const regKey = (cfg.server || '') + '|' + (cfg.database || '');
  if (CHAIN_REGISTRIES[regKey]) return CHAIN_REGISTRIES[regKey];
  if (CHAIN_BUILDS[regKey]) return CHAIN_BUILDS[regKey];
  CHAIN_BUILDS[regKey] = (async () => {
    const file = path.join(BASE_DIR, 'chain_registry.json');
    let store = {};
    try { if (fs.existsSync(file)) store = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (_) { store = {}; }
    const cached = store[regKey];
    if (cached && cached.version === chainBuilder.REGISTRY_VERSION && cached.generatedAt &&
        (Date.now() - Date.parse(cached.generatedAt) < 24 * 3600 * 1000)) {
      CHAIN_REGISTRIES[regKey] = cached;
      return cached;
    }
    const p = await getPool();
    const reg = await chainBuilder.buildRegistry(p);
    reg.server = cfg.server;
    reg.database = cfg.database;
    CHAIN_REGISTRIES[regKey] = reg;
    store[regKey] = reg;
    try { fs.writeFileSync(file, JSON.stringify(store, null, 2)); } catch (_) {}
    return reg;
  })();
  try {
    return await CHAIN_BUILDS[regKey];
  } finally {
    delete CHAIN_BUILDS[regKey];
  }
}
function resolvedChainPaths(registry, from, to) {
  return chainBuilder.findAllPaths(registry, from, to)
    .filter(path => path.length && path.every(e => e.internal || (e.link && e.link.status !== 'ambiguous')));
}
function pruneInvoicePaths(paths) {
  let kept = Array.isArray(paths) ? paths.slice() : [];
  for (let depth = 0; depth < 8 && kept.length; depth++) {
    const groups = new Map();
    kept.forEach(path => {
      if (path.length <= depth) return;
      const key = path.slice(0, depth).map(e => e.from + '>' + e.to + ':' + (e.code || '')).join('|');
      (groups.get(key) || groups.set(key, []).get(key)).push(path);
    });
    if (!groups.size) break;
    const next = kept.filter(path => path.length <= depth);
    for (const group of groups.values()) {
      // 只在“采购发票来源列”之间做剪枝（GSB003/GSB037），
      // 不能把 JDB013=14/A0 的免检/检验分支当成重复路径剪掉。
      const external = group.filter(path => !path[depth].internal && path[depth].fromCode && path[depth].fromCode.startsWith('GSB'));
      const nonExternal = group.filter(path => !external.includes(path));
      const fields = new Set(external.map(path => path[depth].fromCode));
      if (fields.size > 1) {
        const minRemaining = Math.min(...external.map(path => path.length - depth));
        external.forEach(path => { if (path.length - depth === minRemaining) next.push(path); });
        next.push(...nonExternal);
      } else {
        next.push(...group);
      }
    }
    kept = next;
  }
  return kept;
}
function builtUpdateSqls(built) {
  return Array.isArray(built && built.updateSqls) ? built.updateSqls : [built && built.updateSql];
}
async function handleChains(req, res) {
  try {
    const r = await getChainRegistry();
    sendJSON(res, 200, { ok: true, ...r });
  } catch (e) {
    sendJSON(res, 500, { error: '链路识别失败: ' + e.message });
  }
}
async function handleChainPath(req, res) {
  try {
    const u = new URL(req.url, 'http://localhost');
    const from = u.searchParams.get('from');
    const to = u.searchParams.get('to');
    if (!from || !to) return sendJSON(res, 400, { error: '缺少 from/to' });
    const registry = await getChainRegistry();
    const chain = chainBuilder.findPath(registry, from, to);
    sendJSON(res, 200, { ok: true, from, to, found: !!chain, path: chain || [] });
  } catch (e) {
    sendJSON(res, 500, { error: '链路查找失败: ' + e.message });
  }
}
async function handleChainPreview(req, res) {
  let built = null;
  try {
    const u = new URL(req.url, 'http://localhost');
    const from = u.searchParams.get('from');
    const to = u.searchParams.get('to');
    const tgt = u.searchParams.get('tgt');
    const val = u.searchParams.get('val');
    if (!from || !to || !tgt || !val) return sendJSON(res, 400, { error: '缺少 from/to/tgt/val' });
    const registry = await getChainRegistry();
    const paths = resolvedChainPaths(registry, from, to);
    if (!paths.length) return sendJSON(res, 200, { ok: true, found: false, from, to, path: [] });
    built = paths.length === 1
      ? sqlgen.buildChainSQL(from, tgt, val, 'fill', true, paths[0], registry.docs)
      : sqlgen.buildChainMultiSQL(from, tgt, val, 'fill', true, paths, registry.docs);
    const p = await getPool();
    const cnt = await p.request().query(built.cntSql);
    const total = cnt.recordset[0] ? cnt.recordset[0].n : 0;
    let sample = [];
    if (total > 0) sample = (await p.request().query(built.previewSql)).recordset.slice(0, 50);
    sendJSON(res, 200, {
      ok: true, found: true, from, to, tgt, val, path: paths[0], paths,
      totalRows: total, sample, previewSql: built.previewSql,
      updateSql: built.updateSql, updateSqls: built.updateSqls,
      channelNote: built.channelNote
    });
  } catch (e) {
    sendJSON(res, 500, { error: '链路预览失败: ' + e.message, previewSql: built && built.previewSql });
  }
}
async function handleChainPaths(req, res) {
  try {
    const u = new URL(req.url, 'http://localhost');
    const from = u.searchParams.get('from');
    const to = u.searchParams.get('to');
    if (!from || !to) return sendJSON(res, 400, { error: '缺少 from/to' });
    const registry = await getChainRegistry();
    const paths = chainBuilder.findAllPaths(registry, from, to);
    sendJSON(res, 200, { ok: true, from, to, count: paths.length, paths });
  } catch (e) {
    sendJSON(res, 500, { error: '链路列举失败: ' + e.message });
  }
}

function sendJSON(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function readBody(req) { return new Promise((res, rej) => { let d = ''; req.on('data', c => d += c); req.on('end', () => res(d)); req.on('error', rej); }); }

function backupPathNow(cfg) {
  const ts = new Date().toISOString().replace(/[:.]/g, '_');
  const c = cfg || CUR_CONFIG || CONFIG.db;
  // 备份目录：优先 config.backupDir（确保存在），否则用用户临时目录
  let dir = (c && c.backupDir) || CONFIG.backupDir;
  if (dir) { try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (_) { dir = null; } }
  if (!dir) { dir = path.join(os.tmpdir(), 'momo_backup'); try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (_) {} }
  return path.join(dir, (c.database || 'DSB') + '_backup_' + ts + '.bak');
}

// 清理备份目录里超过 3 天的 .bak 文件（备份策略：只保留最近 3 天）
function cleanOldBackups(daysOld, dirOverride) {
  const dir = dirOverride || (CUR_CONFIG && CUR_CONFIG.backupDir) || CONFIG.backupDir || 'D:\\TPA\\SQL2008';
  const keepMs = (daysOld || 3) * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - keepMs;
  const result = { dir, removed: 0, failed: 0 };
  try {
    if (!fs.existsSync(dir)) return result;
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (!f.toLowerCase().endsWith('.bak')) continue;
      // 只清理本工具生成的 <库名>_backup_<ISO时间>.bak，绝不碰 ERP/用户自己的 .bak
      if (!/^.+_backup_\d{4}-\d{2}-\d{2}T/.test(f)) continue;
      const fp = path.join(dir, f);
      const st = fs.statSync(fp);
      if (st.mtimeMs < cutoff) {
        try { fs.unlinkSync(fp); result.removed++; }
        catch (e) { result.failed++; dbg('[backup-clean] unlink failed ' + f + ': ' + e.message); }
      }
    }
    if (result.removed > 0) dbg('[backup-clean] removed ' + result.removed + ' old .bak (>3d) from ' + dir);
  } catch (e) {
    result.failed++;
    result.error = e.message;
    dbg('[backup-clean] error: ' + e.message);
  }
  return result;
}

let backupLock = Promise.resolve();
async function backupDatabaseWithCleanup(pool, cfg, source) {
  const run = backupLock.then(async () => {
    const dbPath = backupPathNow(cfg);
    const dbName = String((cfg && cfg.database) || 'DSB').replace(/]/g, ']]');
    const filePath = dbPath.replace(/'/g, "''");
    let ok = false;
    let error = '';
    try {
      const req = new sql.Request(pool);
      req.timeout = 600000;
      await req.query("BACKUP DATABASE [" + dbName + "] TO DISK=N'" + filePath + "' WITH INIT, COMPRESSION");
      ok = true;
      dbg('[' + source + '] backup ok ' + dbPath);
    } catch (e) {
      error = e.message;
      dbg('[' + source + '] backup failed (non-fatal): ' + error);
    }
    const cleanup = cleanOldBackups(3);
    return { ok, path: dbPath, error, cleanup };
  });
  backupLock = run.then(() => {}, () => {});
  return run;
}

let CUR_DOCS = DOC_ITEMS, CUR_SRCS = SRC_ITEMS;

// ====== API handlers ======

async function handleDatabases(req, res) {
  let tmp = null;
  try {
    // 允许 POST body 指定 server/user/password（界面改完直接刷新账套列表，无需先保存）
    let over = {};
    try {
      const cl = parseInt(req.headers['content-length'] || '0', 10);
      if (req.method === 'POST' && cl > 0) {
        const b = JSON.parse(await readBody(req));
        if (b.server || b.user || b.password) over = { server: b.server, user: b.user, password: b.password };
      }
    } catch (_) {}

    // 先尝试连 master（最完整）；失败则回退到当前已保存的连接池
    let pool;
    try {
      const cfg = makeConnConfig(over);
      const o = { server: cfg.server, user: cfg.user, password: cfg.password, database: 'master',
        options: { encrypt: !!cfg.options?.encrypt, trustServerCertificate: cfg.options?.trustServerCertificate !== false } };
      if (cfg.options?.instanceName) o.options.instanceName = cfg.options.instanceName;
      tmp = await new sql.ConnectionPool(o).connect();
      pool = tmp;
      dbg('[databases] master ok');
    } catch (masterErr) {
      dbg('[databases] master failed (' + masterErr.message + '), falling back to current pool');
      // 回退：用当前已保存配置的连接池（不需要 master 权限）
      if (tmp) { try { await tmp.close(); } catch (_) {} tmp = null; }
      pool = await getPool();
    }

    const r = await pool.request().query(
      "SELECT name, state_desc FROM sys.databases WHERE state_desc = N'ONLINE' AND name NOT IN (N'master',N'tempdb',N'model',N'msdb',N'ReportServer',N'ReportServerTempDB') ORDER BY name"
    );
    const usedMaster = !!tmp;
    let actualDb = '';
    if (!usedMaster) { try { const d = await pool.request().query('SELECT DB_NAME() AS db'); actualDb = (d.recordset[0] && d.recordset[0].db) || ''; } catch (_) {} }
    if (tmp) { try { await tmp.close(); } catch (_) {} }
    const cfg2 = over.server ? makeConnConfig(over) : (CUR_CONFIG || CONFIG.db);
    sendJSON(res, 200, {
      ok: true,
      databases: r.recordset.map(row => ({ name: row.name, state: row.state_desc })),
      server: cfg2.server,
      currentDb: actualDb || (CUR_CONFIG || CONFIG.db).database
    });
  } catch (e) {
    if (tmp) { try { await tmp.close(); } catch (_) {} }
    sendJSON(res, 500, { error: e.message });
  }
}

async function handleSwitchDb(req, res) {
  const b = JSON.parse(await readBody(req));
  if (!b.database) return sendJSON(res, 400, { error: '缺少 database' });
  try {
    const cfg = makeConnConfig({ database: b.database });
    await switchPool(cfg);
    // 以 DB_NAME() 为准校验，不能只看配置对象
    const pNow = await getPool();
    const actual = await poolDbName(pNow);
    if (!actual || String(actual).toLowerCase() !== String(b.database).toLowerCase()) {
      return sendJSON(res, 500, { error: '账套切换未生效：实际连接=' + (actual || '未知') + '，目标=' + b.database });
    }
    CUR_DOCS = DOC_ITEMS; CUR_SRCS = SRC_ITEMS;
    sendJSON(res, 200, { ok: true, database: actual, server: cfg.server });
  } catch (e) { sendJSON(res, 500, { error: '连接失败: ' + e.message }); }
}

async function handleTestConn(req, res) {
  const b = JSON.parse(await readBody(req));
  let tmp = null;
  try {
    const cfg = makeConnConfig(b.database ? { database: b.database } : undefined);
    // 允许前端传入 server/user/password 覆盖默认配置（支持远程数据库测试）
    if (b.server || b.user || b.password) {
      Object.assign(cfg, { server: b.server || cfg.server, user: b.user || cfg.user, password: b.password !== undefined ? b.password : cfg.password });
    }
    const dbName = b.database || cfg.database;
    const o = { server: cfg.server, user: cfg.user, password: cfg.password, database: dbName,
      options: { encrypt: !!cfg.options?.encrypt, trustServerCertificate: cfg.options?.trustServerCertificate !== false },
      connectionTimeout: 15000, requestTimeout: 30000 };
    if (cfg.options?.instanceName) o.options.instanceName = cfg.options.instanceName;
    tmp = await new sql.ConnectionPool(o).connect();
    await tmp.request().query('SELECT 1 AS ok'); await tmp.close();
    // 测试成功后，把新连接参数写进配置并重连主池（界面操作即时生效，无需重启）
    // 注意：响应头只允许发一次——先合并 autoApplied 再统一 sendJSON，避免「Cannot write headers」双写错误
    let autoApplied = false;
    let applyNote = '';
    try {
      const targetCfg = makeConnConfig({ server: cfg.server, user: cfg.user, password: cfg.password, database: dbName });
      // 先真正切换连接池，成功后再落配置，避免“配置已改、池子还是旧库”
      await switchPool(targetCfg);
      writeConfigFile(path.join(BASE_DIR, 'config.js'), targetCfg, (CUR_CONFIG && CUR_CONFIG.backupDir) || CONFIG.backupDir, CONFIG.httpPort);
      CONFIG.db = Object.assign({}, CONFIG.db, { server: cfg.server, user: cfg.user, password: cfg.password, database: dbName });
      autoApplied = true;
    } catch (applyErr) {
      applyNote = '连接参数已测试通过，主连接应用失败: ' + applyErr.message;
    }
    sendJSON(res, 200, { ok: true, server: cfg.server, database: dbName, autoApplied, note: applyNote || undefined });
  } catch (e) {
    if (tmp) { try { await tmp.close(); } catch (_) {} }
    let hint = '';
    const msg = (e.message || '').toLowerCase();
    if (msg.includes('login') || msg.includes('password') || msg.includes('reject') || msg.includes('credential')) {
      hint = '（账号或密码错误，请检查 sa 密码）';
    } else if (msg.includes('econnrefused') || msg.includes('etimedout') || msg.includes('timeout')) {
      hint = '（无法连接到服务器，请确认 SQL Server 正在运行且防火墙未拦截 1433 端口）';
    } else if (msg.includes('ename') || msg.includes('enotfound')) {
      hint = '（找不到主机，请检查服务器地址是否正确）';
    } else if (msg.includes('encrypt') || msg.includes('tls') || msg.includes('ssl')) {
      hint = '（TLS 加密协商失败，请确认 SQL Server 网络配置）';
    } else if (msg.includes('does not exist')) {
      hint = '（数据库不存在，请确认账套名称）';
    }
    sendJSON(res, 200, { ok: false, error: (e.message || '未知错误').slice(0, 200), hint, server: (CUR_CONFIG || CONFIG.db).server, database: b.database || (CUR_CONFIG || CONFIG.db).database });
  }
}

async function handleMeta(req, res) {
  let p, docs, srcs;
  // 切换账套/服务器瞬间连接池可能处于重建窗口：连接类错误时强制开新池，最多重试 6 次
  // 快连模式：连接类错误仅做 1 次快速重连（300ms），避免启动时 6×2s 傻等
  const connErr = m => /Connection|ECONNCLOSED|ECONNRESET|database|验证|login|lock/i.test(m||'');
  let lastErr = null;
  // 快连模式：首连成功就立即返回，不做任何重试等待。仅对瞬时半死池做 1 次快速重连（300ms）。
  // 这样启动时能瞬间连通，避免 6×2s 傻等。
  for (let attempt = 0; attempt < 2; attempt++) {
    let usedPool = null;
    try {
      usedPool = await getPool();
      p = usedPool;
      docs = await sqlgen.scanDocs(p); srcs = await sqlgen.scanSrcs(p); lastErr = null; break;
    } catch (e) {
      lastErr = e;
      if (!connErr(e.message)) throw e;
      // 只在“失败的池仍是当前池”时才重置，避免切换账套后把新池误关掉
      if (!usedPool || usedPool === pool) await resetPool();
      if (attempt < 1) await new Promise(r => setTimeout(r, 300));
    }
  }
  if (lastErr) return sendJSON(res, 500, { error: '数据库连接失败: ' + lastErr.message });
  const srcAllCols = {}, tgtAllCols = {};
  const srcIds = srcs.map(x => x.id), tgtIds = docs.map(x => x.sub);
  // 分批列扫描：SQL Server 单语句参数上限约 2100，但大批量 bind 容易触发
  // "@0 未声明" 一类绑定问题。按 500 个/批切分，既稳又快。
  const COL_SCAN_SQL = "SELECT t.name tbl, c.name col, c.max_length maxLen, CONVERT(varchar(200),s.value) [desc] FROM sys.columns c JOIN sys.tables t ON c.object_id=t.object_id LEFT JOIN sys.extended_properties s ON s.major_id=t.object_id AND s.minor_id=c.column_id AND s.name=N'MS_Description' WHERE";
  const CHUNK = 500;
  async function scanColsBatch(idList, extraWhere, collector) {
    for (let off = 0; off < idList.length; off += CHUNK) {
      const part = idList.slice(off, off + CHUNK);
      const r = p.request();
      part.forEach((id, i) => r.input('p' + i, sql.NVarChar, id));
      const where = ' t.name IN (' + part.map((_, i) => '@p' + i).join(',') + ')' + (extraWhere ? ' AND ' + extraWhere : '');
      const rr = await r.query(COL_SCAN_SQL + where + " ORDER BY t.name, c.column_id");
      for (const row of rr.recordset) collector(row);
    }
  }
  if (srcIds.length) await scanColsBatch(srcIds, null, (row) => { (srcAllCols[row.tbl] = srcAllCols[row.tbl] || []).push({ col: row.col, maxLen: row.maxLen, desc: row.desc }); });
  if (tgtIds.length) await scanColsBatch(tgtIds, 'c.column_id>=4', (row) => { const k = docs.find(d => d.sub === row.tbl)?.id; if (k) (tgtAllCols[k] = tgtAllCols[k] || []).push({ col: row.col, maxLen: row.maxLen, desc: row.desc }); });
  CUR_DOCS = docs; CUR_SRCS = srcs;
  // 业务流向过滤：上游单据不能取下游单据的值，后台自动计算，前端静默排除
  const allDocIds = docs.map(x => x.id);
  const srcExcluded = {};
  for (const d of docs) {
    const ex = excludedSrcIdsFor(d.id, allDocIds);
    const famEx = docs.filter(x => x.id !== d.id && sameFamily(x.id, d.id)).map(x => x.id);
    const merged = [...new Set([...ex, ...famEx])];
    if (merged.length) srcExcluded[d.id] = merged;
  }
  // 返回真实 DB_NAME()，避免“界面显示 DSB、实际连着 XBK”
  const actualDb = (await poolDbName(p)) || (CUR_CONFIG || CONFIG.db).database;
  sendJSON(res, 200, { docs, srcs, srcAllCols, tgtAllCols, srcExcluded, currentDb: actualDb, server: (CUR_CONFIG || CONFIG.db).server, user: (CUR_CONFIG || CONFIG.db).user || '', password: (CUR_CONFIG || CONFIG.db).password || '', hasPassword: !!(CUR_CONFIG || CONFIG.db).password });
}

// 检测同表已启用的 ERP 触发器是否写目标列。
// ERP 触发器分两类：保存触发（AFTER INSERT/UPDATE）与审核触发（审核动作时触发）。
// 工具触发器形如 UPDATE b SET b.<col>，用别名 b，按定义排除，不能按名称 trg_ 排除（ERP 也可能用 trg_）。
const FIELD_DICT_CACHE = new Map();
async function handleFieldDicts(req, res) {
  try {
    const p = await ensurePoolDb((CUR_CONFIG || CONFIG.db).database);
    const cfg = CUR_CONFIG || CONFIG.db;
    const key = (cfg.server || '') + '|' + (cfg.database || '') + '|' + chainBuilder.REGISTRY_VERSION;
    const hit = FIELD_DICT_CACHE.get(key);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return sendJSON(res, 200, hit.data);
    const reg = await getChainRegistry();
    const hints = [...new Set(Object.values(fieldDict.FIELD_HINTS).flat())];
    const byHint = {};
    if (hints.length) {
      const req = p.request();
      hints.forEach((h, i) => req.input('h' + i, sql.NVarChar, h));
      const r = await req.query(
        `SELECT t.name tbl,c.name col,CONVERT(varchar(200),ep.value) d,SUM(pr.rows) n
         FROM sys.columns c JOIN sys.tables t ON c.object_id=t.object_id
         JOIN sys.partitions pr ON pr.object_id=t.object_id AND pr.index_id IN (0,1)
         LEFT JOIN sys.extended_properties ep ON ep.major_id=t.object_id AND ep.minor_id=c.column_id AND ep.name=N'MS_Description'
         WHERE t.is_ms_shipped=0 AND ep.value IN (${hints.map((_, i) => '@h' + i).join(',')})
         GROUP BY t.name,c.name,CONVERT(varchar(200),ep.value)`
      );
      for (const row of r.recordset) (byHint[row.d] = byHint[row.d] || []).push(row);
    }
    const q = x => '[' + String(x).replace(/]/g, ']]') + ']';
    const sampleMemo = new Map();
    async function sample(tbl, col) {
      const mk = tbl + '.' + col;
      if (sampleMemo.has(mk)) return sampleMemo.get(mk);
      let out = [];
      try {
        out = (await p.request().query(
          `SELECT TOP 30 CAST(${q(col)} AS nvarchar(100)) v,COUNT(*) n
           FROM [dbo].${q(tbl)}
           WHERE ${q(col)} IS NOT NULL AND CAST(${q(col)} AS nvarchar(100))<>N''
           GROUP BY CAST(${q(col)} AS nvarchar(100)) ORDER BY n DESC`
        )).recordset;
      } catch (_) {}
      const vals = out.map(x => String(x.v));
      sampleMemo.set(mk, vals);
      return vals;
    }
    const sections = [];
    for (const [name, codeMap] of Object.entries(fieldDict.DICT)) {
      const codes = Object.entries(codeMap);
      if (name === 'Source') {
        sections.push({ name, codeCount: codes.length, status: 'special', codes: reg.sourceCodes, columns: [], binding: null });
        continue;
      }
      if (name === 'TableID') {
        const matched = codes.filter(([c]) => !!reg.docs[c]).length;
        sections.push({
          name, codeCount: codes.length,
          status: matched === codes.length ? 'bound' : (matched ? 'partial' : 'no-match'),
          coverage: codes.length ? matched / codes.length : null,
          columns: [], binding: null,
          codes: codes.map(([code, label]) => ({ code, label, exists: !!reg.docs[code] })),
          unmatched: codes.filter(([c]) => !reg.docs[c]).map(([c]) => c)
        });
        continue;
      }
      const cand = [];
      for (const h of (fieldDict.FIELD_HINTS[name] || [])) for (const row of (byHint[h] || [])) cand.push(row);
      const seen = new Set(), columns = [];
      for (const c of cand) {
        const k = c.tbl + '.' + c.col;
        if (seen.has(k)) continue;
        seen.add(k);
        const vals = await sample(c.tbl, c.col);
        const labelSet = new Set(Object.values(codeMap));
        const isMatch = v => Object.prototype.hasOwnProperty.call(codeMap, v) || labelSet.has(v);
        const good = vals.filter(isMatch);
        const bad = vals.filter(v => !isMatch(v));
        columns.push({
          table: c.tbl, column: c.col, desc: c.d, rows: Number(c.n || 0),
          distinct: vals.length, matched: good.length,
          coverage: vals.length ? good.length / vals.length : null,
          values: vals.slice(0, 10), unmatched: bad.slice(0, 20)
        });
      }
      columns.sort((a, b) => (b.coverage ?? -1) - (a.coverage ?? -1) || b.matched - a.matched || b.rows - a.rows);
      const best = columns.find(c => c.coverage === 1) || columns[0] || null;
      sections.push({
        name, codeCount: codes.length, columns, binding: best,
        status: !columns.length ? 'no-column' : (best && best.coverage === 1 ? 'bound' : (best && best.coverage > 0 ? 'partial' : 'no-match')),
        coverage: best ? best.coverage : null,
        codes: codes.map(([code, label]) => ({ code, label })),
        unmatched: best ? best.unmatched : []
      });
    }
    const data = {
      ok: true, database: cfg.database, version: chainBuilder.REGISTRY_VERSION,
      generatedAt: new Date().toISOString(),
      sections,
      accountingSourceCodes: (reg.unknownSourceCodes || []).map(x => ({
        code: x.code, label: fieldDict.ACCOUNTING_SOURCE_CODES.has(x.code) ? '会计专用（待补）' : '未收录'
      }))
    };
    FIELD_DICT_CACHE.set(key, { at: Date.now(), data });
    sendJSON(res, 200, data);
  } catch (e) { sendJSON(res, 500, { error: '字段字典核对失败: ' + e.message }); }
}

async function detectTrigConflict(pool, tbl, tgtCol) {
  try {
    const r = await pool.request().input('t', sql.NVarChar, tbl)
      .query("SELECT o.name, m.definition [sql] FROM sys.triggers o JOIN sys.sql_modules m ON m.object_id=o.object_id WHERE o.parent_id=OBJECT_ID(@t) AND o.is_disabled=0");
    const conflicts = [];
    const tgt = String(tgtCol || '').toUpperCase();
    for (const row of r.recordset) {
      const def = String(row.sql || '');
      if (/UPDATE\s+b\s+SET\s+b\./i.test(def)) continue; // 工具自建触发器
      const up = def.toUpperCase();
      const event = /FOR\s+INSERT/.test(up) ? 'INSERT' : (/FOR\s+UPDATE/.test(up) ? 'UPDATE' : 'OTHER');
      const kind = /审核|AUDIT/.test(up) ? 'audit' : (event === 'UPDATE' ? 'save' : 'other');
      const setCols = [...up.matchAll(/\bSET\s+(?:\[?[A-Z0-9_]+\]?\.)?\[?([A-Z0-9_]+)\]?\s*=/g)].map(m => m[1]);
      if (setCols.includes(tgt)) conflicts.push({ trigName: row.name, col: tgtCol, event, kind });
    }
    return conflicts;
  } catch (e) {
    dbg('[conflict] detect failed: ' + e.message);
    return [];
  }
}

function conflictLabel(c) {
  return (c.kind === 'audit' ? '审核触发' : (c.kind === 'save' ? '保存触发' : '系统触发')) + ' ' + c.trigName;
}


async function pkColumns(p, table) {
  try {
    const r = await p.request().input('t', sql.NVarChar, table)
      .query("SELECT c.name FROM sys.index_columns ic JOIN sys.indexes i ON ic.object_id=i.object_id AND ic.index_id=i.index_id JOIN sys.columns c ON ic.object_id=c.object_id AND ic.column_id=c.column_id WHERE i.is_primary_key=1 AND ic.object_id=OBJECT_ID(@t) ORDER BY ic.key_ordinal");
    return r.recordset.map(x => x.name);
  } catch (_) { return []; }
}

async function columnType(p, table, col) {
  try {
    const r = await p.request().input('t', sql.NVarChar, table).input('c', sql.NVarChar, col)
      .query("SELECT TYPE_NAME(c.system_type_id) typ FROM sys.columns c JOIN sys.tables t ON c.object_id=t.object_id WHERE t.name=@t AND c.name=@c");
    return (r.recordset[0] && r.recordset[0].typ) || '';
  } catch (_) { return ''; }
}
function typeFamily(typ) {
  const t = String(typ || '').toLowerCase();
  if (/char|text/.test(t)) return 'text';
  if (/int|decimal|numeric|money|float|real|bit/.test(t)) return 'number';
  if (/date|time/.test(t)) return 'date';
  if (/uniqueidentifier/.test(t)) return 'guid';
  return 'other';
}
function typeWarningFor(tgtTable, tgtCol, tgtType, srcId, srcCol, srcType) {
  const tf = typeFamily(tgtType), sf = typeFamily(srcType);
  if (tf === sf || !tf || !sf) return '';
  if ((tf === 'number' || tf === 'date') && sf === 'text') {
    return '类型提示：目标 ' + tgtTable + '.' + tgtCol + ' 是 ' + tgtType + '，来源 ' + srcId + '.' + srcCol + ' 是 ' + srcType + '，文本不是纯数字/日期时执行会失败。';
  }
  if (tf === 'number' && sf === 'date') {
    return '类型提示：目标 ' + tgtTable + '.' + tgtCol + ' 是数值，来源 ' + srcId + '.' + srcCol + ' 是日期，转换可能失败。';
  }
  return '';
}

async function verifyColsForTrig(p, doc, tgtCol, srcTable, srcValCol) {
  const c1 = await p.request().input('t', sql.NVarChar, doc.sub).input('c', sql.NVarChar, tgtCol)
    .query('SELECT 1 AS ok FROM sys.columns c JOIN sys.tables t ON c.object_id=t.object_id WHERE t.name=@t AND c.name=@c');
  if (!c1.recordset.length) throw new Error('目标列 [' + tgtCol + '] 在表 ' + doc.sub + ' 中不存在');
  if (srcValCol && srcTable) {
    const c2 = await p.request().input('t', sql.NVarChar, srcTable).input('c', sql.NVarChar, srcValCol)
      .query('SELECT 1 AS ok FROM sys.columns c JOIN sys.tables t ON c.object_id=t.object_id WHERE t.name=@t AND c.name=@c');
    if (!c2.recordset.length) throw new Error('来源列 [' + srcValCol + '] 在表 ' + srcTable + ' 中不存在');
  }
}

// ===== 业务流向白名单：上游 → 直接下游（数据只能 下游取上游，不能 上游取下游）=====
// 依据 ERP 单据业务链：采购链/销售链/生产链/委外链。
// 可达上游 = 白名单中所有"能一路流到该单据"的上游节点；这些节点（及其单身/选配/变更子档）都可以作为来源档。
// 不在白名单内的单据（基础档/报表/系统档）不参与方向判定，不做排除。
const DOC_FLOW = {
  // ---- 采购链（含询价/核价/变更/收货）----
  DCSHAA: ['DCSHBA'],              // 询价 → 请购
  DCSHBA: ['DCSHCA'],              // 请购 → 采购底稿
  DCSHCA: ['DCSHDA'],              // 采购底稿 → 采购单
  DCSHDA: ['JSKJCA', 'YSFGQA'],    // 采购单 → 收料单 / 付款单
  JSKJCA: ['JSKJDA'],              // 收料单 → 验收/进货单
  QMSMFA: ['JSKJDA'],               // 进货检验单 → 验收(退)/进货单
  JSKJDA: ['YSFGSA'],               // 验收(退)/进货单 → 采购发票
  QMSMCA: ['QMSMBA'],             // 委外进货检验 → 委外进货收料
  QMSMBA: ['QMSMDA'],             // 委外进货收料 → 委外进货验退退回
  // ---- 销售链 ----
  DCSIAA: ['DCSIBA', 'DCSIDA', 'DCSDAA'],  // 报价 → 订单 / 订单合同
  DCSIBA: ['DCSICA', 'JSKKEA', 'YSFGDA'], // 订单 → 订单变更 / 销货单 / 收款单
  DCSICA: ['JSKKEA'],                      // 订单变更 → 销货单
  DCSDAA: ['DCSIBA'],                      // 订单合同 → 订单
  DCSIDA: ['DCSIBA'],                      // 订单合同(另一档) → 订单
  JSKKEA: ['JSKKEC', 'YSFGGA', 'YSFGEA'],  // 销货单 → 销货批号 / 销售开票 / 应收开账
  JSKKFA: ['YSFGAA'],                       // 销退单 → 其他应收
  JSKKFC: ['YSFGHA'],                       // 客户到款核销 → 收款核销单
  YSFGGA: ['YSFGFA', 'YYSOBA'],            // 销售开票 → 发票档案 / 销项凭证
  YSFGEA: ['YSFGDA'],                        // 应收开账 → 收款单
  YSFGDA: ['YSFGHA'],                        // 收款单 → 收款核销单
  YSFGSA: ['YSFGQA'],                        // 采购发票 → 付款单
  YSFGQA: ['YSFGTA'],                        // 付款单 → 付款核销单
  SGMRIB: ['SGMRJA'],                        // 计划来源 → 计划建议
  // ---- 生产链 ----
  SGMRIA: ['SGMRJA', 'SGMSAA'],             // 物需计划 → 计划建议 / 生产计划
  SGMRAA: ['SGMRBA', 'SGMRDA', 'QMSMAA'],   // 工单 → 领/退料 / 移转 / 生产检验
  SGMRBA: ['SGMRCA', 'SGMRCB'],            // 领/退料 → 生产入/出库
  SGMRCA: ['SGMRCC'],                       // 生产入/出库单头
  SGMRCB: ['SGMRCC'],
  SGMREA: ['SGMRFA', 'SGMRGA'],            // 委外单 → 送/退料 / 委外进退货
  SGMRFA: ['SGMRGA'],
  SGMRGB: ['SGMRGC'],
  SGMRGA: ['QMSMCA'],                       // 委外进/退货 → 委外进货检验
  SGMRLA: ['JSKLHA'],                        // 副产品入库 → 入库单
  SGMQOB: ['SGMQAA'],                         // 产品结构变更 → 产品结构
};

// 计算每个单据的"可达上游"集合（沿 DOC_FLOW 反向传递闭包）
function computeReachableUpstream() {
  // 下游 → 上游直接列表
  const down2up = {};
  for (const [up, downs] of Object.entries(DOC_FLOW)) {
    for (const d of downs) (down2up[d] = down2up[d] || new Set()).add(up);
  }
  const reach = {}; // id -> Set(所有可达上游)
  const compute = (id) => {
    if (reach[id]) return reach[id];
    const set = new Set(down2up[id] || []);
    (down2up[id] || []).forEach((up) => {
      set.add(up);
      compute(up).forEach((x) => set.add(x));
    });
    reach[id] = set;
    return set;
  };
  for (const id of Object.keys(down2up)) compute(id);
  return reach;
}
const REACHABLE_UP = computeReachableUpstream();

// 单据 id 前缀匹配：判断某 id 是否属于某"单据家族"（头档+单身+选配+变更...）
// 例：'DCSIBA' 家族 = DCSIBA/DCSIBB/DCSIBC/DCSICB... 简化为前 4 字符匹配
// 子档家族映射：头档 id → 同家族的所有子档 id（手维护，避免前缀误判）
// 例：DCSIBA(订单单头) 家族 = [DCSIBA, DCSIBB(单身), DCSIBC(选配)]
const FAMILY = {
  DCSHAA: ['DCSHAA','DCSHAB'],           // 询价：头+单
  DCSHBA: ['DCSHBA','DCSHBB'],           // 请购：头+单
  DCSHCA: ['DCSHCA','DCSHCB','DCSHCC'],  // 采购底稿：头+单+子单
  DCSHDA: ['DCSHDA','DCSHDB'],          // 采购单：头+单
  DCSHEA: ['DCSHEA','DCSHEB','DCSHEC'], // 核价单
  DCSHFA: ['DCSHFA','DCSHFB'],          // 采购变更单
  DCSIAA: ['DCSIAA','DCSIAB','DCSIAC','DCSIAD'], // 报价单
  DCSIBA: ['DCSIBA','DCSIBB','DCSIBC'], // 订单
  DCSICA: ['DCSICA','DCSICB','DCSICC'], // 订单变更
  DCSDAA: ['DCSDAA','DCSDAB','DCSDAC'], // 订单合同
  DCSIDA: ['DCSIDA','DCSIDB','DCSIDC'], // 订单合同(另一档)
  JSKJCA: ['JSKJCA','JSKJCB'],          // 收料单
  JSKJDA: ['JSKJDA','JSKJDB'],          // 进货单
  JSKJEA: ['JSKJEA','JSKJEB'],          // 验退退出单
  JSKJFA: ['JSKJFA','JSKJFB'],          // 进货退出单
  JSKKAA: ['JSKKAA','JSKKAB'],          // 借出单
  JSKKBA: ['JSKKBA','JSKKBB'],          // 借出还入单
  JSKKEA: ['JSKKEA','JSKKEB','JSKKEC'], // 销货单
  JSKKFA: ['JSKKFA','JSKKFB'],          // 销退单
  JSKKFC: ['JSKKFC','JSKKFD','JSKKFE'], // 到款核销
  JSKLHA: ['JSKLHA','JSKLHB'],          // 入库单
  JSKLIA: ['JSKLIA','JSKLIB'],          // 出库单
  QMSMCA: ['QMSMCA','QMSMCB'],          // 委外进货检验
  QMSMBA: ['QMSMBA','QMSMBB'],          // 委外进货收料
  QMSMFA: ['QMSMFA','QMSMFB'],          // 进货检验
  QMSMDA: ['QMSMDA','QMSMDB'],          // 委外进货验退退回
  QMSMAA: ['QMSMAA','QMSMAB'],          // 生产检验
  SGMRCA: ['SGMRCA','SGMRCB','SGMRCC'], // 生产入/出库
  SGMRAA: ['SGMRAA','SGMRAB','SGMRAC','SGMRAD'], // 工单
  SGMRBA: ['SGMRBA','SGMRBB','SGMRBC','SGMRBD'], // 领/退料
  SGMREA: ['SGMREA','SGMREB','SGMREC'], // 委外单
  SGMRFA: ['SGMRFA','SGMRFB','SGMRFC','SGMRFD'], // 送/退料
  SGMRGB: ['SGMRGB','SGMRGC'],          // 委外进/退货
  SGMRLA: ['SGMRLA','SGMRLB'],          // 副产品入库
  YSFGGA: ['YSFGGA','YSFGGB'],          // 销售开票
  YSFGAA: ['YSFGAA','YSFGAB'],          // 其他应收
  YSFGEA: ['YSFGEA','YSFGEB'],          // 应收开账
  YSFGDA: ['YSFGDA','YSFGDB','YSFGDC'], // 收款单
  YSFGHA: ['YSFGHA','YSFGHB','YSFGHC'], // 收款核销单
  YSFGNA: ['YSFGNA','YSFGNB'],          // 其他应付
  YSFGQA: ['YSFGQA','YSFGQB','YSFGQC'], // 付款单
  YSFGRA: ['YSFGRA','YSFGRB'],          // 应付开账
  YSFGSA: ['YSFGSA','YSFGSB','YSFGSC','YSFGSD'], // 采购发票
  YSFGTA: ['YSFGTA','YSFGTB','YSFGTC'], // 付款核销单
  YYSOBA: ['YYSOBA','YYSOBB'],          // 销项凭证
};
// 反向索引：子档 → 家族 id
const _famRev = {};
for (const [head, members] of Object.entries(FAMILY)) {
  for (const m of members) _famRev[m] = head;
}
// 判断两个 id 是否属于同一业务单据家族（精确匹配，无前缀误判）
function sameFamily(a, b) {
  if (!a || !b) return false;
  const fa = _famRev[a] || a;
  const fb = _famRev[b] || b;
  return fa === fb;
}

// 给出主表单据 id，返回"不允许作为来源档"的单据 id 列表：
// 即该主表在业务流上的所有"下游"（直接+间接）家族。上游取下游 = 不合理。
// 注意：只走 DOC_FLOW 正向边（cur → DOC_FLOW[cur]），绝不反向，否则会把上游单据误判为下游。
function excludedSrcIdsFor(docId, allIds) {
  // 从 docId 出发，正向 DFS 找所有可达下游
  const visited = new Set();
  const stack = [docId];
  while (stack.length) {
    const cur = stack.pop();
    for (const d of (DOC_FLOW[cur] || [])) {
      if (!visited.has(d)) { visited.add(d); stack.push(d); }
    }
  }
  // 把下游家族展开到 allIds（4 字符前缀同家族：头档/单身/选配/变更子档）
  const excluded = new Set();
  for (const ds of visited) {
    for (const id of allIds) {
      if (id === ds || sameFamily(id, ds)) excluded.add(id);
    }
  }
  excluded.delete(docId); // 自己排除（前端本来就不列）
  return [...excluded];
}

// ===== 自动链式取值检测（合并自 autochain_detect.js）=====
const AUTO_CHAIN = {
  'JSKLOA': { mid: 'TPADEA', midKey: 'DEA001', midWh: 'DEA008', srcWh: 'LOA002' }
};
async function detectAutoChains(pool, db) {
  if (_autoChainCache && _autoChainCache.db === db) return _autoChainCache.chains;

  const chains = {};
  try {
    // 找所有含"仓库"维度列的中间表
    const whTables = await pool.request().query(
      "SELECT t.name AS tbl, c.name AS whCol, " +
      "CONVERT(varchar(60), ep.value) AS whDesc, " +
      "(SELECT c2.name FROM sys.columns c2 WHERE c2.object_id=t.object_id AND c2.column_id=1) AS keyCol " +
      "FROM sys.columns c " +
      "JOIN sys.tables t ON c.object_id=t.object_id " +
      "LEFT JOIN sys.extended_properties ep ON ep.major_id=t.object_id AND ep.minor_id=c.column_id AND ep.name=N'MS_Description' " +
      "WHERE t.is_ms_shipped=0 AND c.column_id >= 2 " +
      "AND (CONVERT(varchar(60),ep.value) LIKE N'%仓库%' OR CONVERT(varchar(60),ep.value) LIKE N'%主仓%') " +
      "ORDER BY t.name"
    );

    // 所有来源表（库存/领料/物料类）
    const srcTables = await pool.request().query(
      "SELECT t.name AS tbl, " +
      "(SELECT c.name FROM sys.columns c WHERE c.object_id=t.object_id AND c.column_id=1) AS c1, " +
      "(SELECT c.name FROM sys.columns c WHERE c.object_id=t.object_id AND c.column_id=2) AS c2, " +
      "CONVERT(varchar(60), ep2.value) AS tblDesc " +
      "FROM sys.tables t " +
      "LEFT JOIN sys.extended_properties ep2 ON ep2.major_id=t.object_id AND ep2.minor_id=0 AND ep2.name=N'MS_Description' " +
      "WHERE t.is_ms_shipped=0 ORDER BY t.name"
    );

    const candidates = whTables.recordset;

    for (const st of srcTables.recordset) {
      if (!st.tbl || !st.c1 || !st.c2) continue;
      const tblDesc = st.tblDesc || '';
      // 来源表描述含库存/领料/物料/仓库类才进入匹配
      if (!/库存|领料|物料|仓库|主仓|数量/.test(tblDesc)) continue;
      // c1 后缀 001（品号键）
      if (st.c1.slice(-3) !== '001') continue;

      for (const cand of candidates) {
        if (!cand.tbl || !cand.keyCol || !cand.whCol) continue;
        if (cand.keyCol.slice(-3) !== '001') continue;
        const whDescMatch = /仓库|主仓/.test(cand.whDesc || '');
        if (!whDescMatch) continue;

        chains[st.tbl] = {
          mid: cand.tbl,
          midKey: cand.keyCol,
          midWh: cand.whCol,
          srcWh: st.c2
        };
        break;
      }
    }

    _autoChainCache = { db, chains };
    if (Object.keys(chains).length > 0) {
      console.log('[autoChain] detected: ' + JSON.stringify(chains));
    }
  } catch (e) {
    console.log('[autoChain] detect error: ' + e.message);
  }
  return chains;
}

async function getEffectiveChainDyn(chain, srcId, srcValCol, pool, CUR_SRCS) {
  if (chain && chain.src2Id) return chain;

  // 尝试 DB 自动检测（pool.database 是 mssql pool 的属性）
  let detected = null;
  try {
    const db = (pool && pool.options && pool.options.database) || null;
    const chains = await detectAutoChains(pool, db);
    if (chains[srcId]) detected = chains[srcId];
  } catch (e) {
    console.log('[autoChain] getEffectiveChainDyn error: ' + e.message);
  }

  if (detected) {
    return { src2Id: detected.mid, src2Key: detected.midKey, src2ValCol: detected.midWh, srcJoinKey: detected.srcWh, _auto: true };
  }

  // 回退白名单
  const autoC = AUTO_CHAIN[srcId];
  if (autoC && (srcValCol === 'LOA003' || srcValCol === 'LOA004')) {
    return { src2Id: autoC.mid, src2Key: autoC.midKey, src2ValCol: autoC.midWh, srcJoinKey: autoC.srcWh, _white: true };
  }
  return null;
}
async function getEffectiveChain(chain, srcId, srcValCol, CUR_SRCS, pool) {
  if (chain && chain.src2Id) return chain;
  const detected = await getEffectiveChainDyn(chain, srcId, srcValCol, pool, CUR_SRCS);
  if (detected) return detected;
  const autoC = AUTO_CHAIN[srcId];
  if (autoC && (srcValCol === 'LOA003' || srcValCol === 'LOA004')) {
    return { src2Id: autoC.mid, src2Key: autoC.midKey, src2ValCol: autoC.midWh, srcJoinKey: autoC.srcWh };
  }
  return null;
}

async function handleClearTarget(req, res) {
  let b = {};
  try { b = JSON.parse(await readBody(req)); } catch (_) {}
  const docId = String(b.docId || '').trim();
  const tgtCol = String(b.tgtCol || '').trim();
  if (!docId || !tgtCol) return sendJSON(res, 400, { error: '请选择单据和目标列' });
  try { await ensurePoolDb((CUR_CONFIG || CONFIG.db).database); }
  catch (e) { return sendJSON(res, 500, { error: '账套校验失败: ' + e.message }); }
  const doc = CUR_DOCS.find(d => d.id === docId);
  if (!doc) return sendJSON(res, 400, { error: '单据 ' + docId + ' 不存在' });
  const p = await getPool();
  const chk = await p.request().input('t', sql.NVarChar, doc.sub).input('c', sql.NVarChar, tgtCol)
    .query("SELECT c.name FROM sys.columns c WHERE c.object_id=OBJECT_ID(@t) AND c.name=@c");
  if (!chk.recordset.length) return sendJSON(res, 400, { error: '列 ' + docId + '.' + tgtCol + ' 不存在' });
  const col = '[' + tgtCol.replace(/]/g, ']]') + ']';
  const tbl = '[dbo].[' + doc.sub.replace(/]/g, ']]') + ']';
  const where = col + " IS NOT NULL AND CAST(" + col + " AS nvarchar(max)) <> N''";
  const cnt = await p.request().query('SELECT COUNT(*) AS n FROM ' + tbl + ' WHERE ' + where);
  const totalRows = Number(cnt.recordset[0].n || 0);
  if (!b.confirm) {
    let sample = [];
    if (totalRows > 0) {
      const noCol = doc.docNo || doc.colNo;
      const no = noCol ? ('[' + String(noCol).replace(/]/g, ']]') + '] AS [单号]') : "N'' AS [单号]";
      const sr = await p.request().query('SELECT TOP 50 ' + no + ', ' + col + ' AS [现值] FROM ' + tbl + ' WHERE ' + where);
      sample = sr.recordset;
    }
    const cfg0 = CUR_CONFIG || CONFIG.db;
    return sendJSON(res, 200, { preview: true, docId, tgtCol, totalRows, sample, backupDir: backupPathNow(cfg0) });
  }
  const cfg = CUR_CONFIG || CONFIG.db;
  const backup = await backupDatabaseWithCleanup(p, cfg, 'clearTarget');
  if (!backup.ok) return sendJSON(res, 500, { error: '数据库备份失败，已中止清空（未写库）: ' + backup.error, backupPath: backup.path, backupOk: false });
  const upd = await p.request().query('UPDATE ' + tbl + ' SET ' + col + '=NULL WHERE ' + where);
  const affected = upd.rowsAffected && upd.rowsAffected[0] !== undefined ? upd.rowsAffected[0] : totalRows;
  dbg('[clearTarget] ' + docId + '.' + tgtCol + ' affected=' + affected + ' backup=' + backup.path);
  return sendJSON(res, 200, { ok: true, affected, backupPath: backup.path, backupOk: true, docId, tgtCol });
}

async function handleRun(req, res) {
  const b = JSON.parse(await readBody(req));
  const { docId, tgtCol, srcId, srcValCol, partyKey, mode, confirm, force, chain, createTrigger, triggerTimeMode, mergeDisplay } = b;
  // 写操作前先确认真实连接库，避免“界面选 DSB、SQL 落到 XBK”
  try { await ensurePoolDb((CUR_CONFIG || CONFIG.db).database); }
  catch (e) { return sendJSON(res, 500, { error: '账套校验失败: ' + e.message }); }
  const isInvoiceDate = docId === 'YSFGSB';
  if (isInvoiceDate && (!tgtCol || !srcId || !srcValCol)) return sendJSON(res, 400, { error: '请选择目标列、来源档和来源值列' });
  if (!isInvoiceDate && docId && srcId && docId === srcId) {
    return sendJSON(res, 400, { error: '来源档不能与单据主表相同，请选择其他来源档。' });
  }
  // 业务流向兜底：来源档若是主表的下游单据 → 直接拒绝（上游不能取下游的值）
  if (!isInvoiceDate) {
    const ex = excludedSrcIdsFor(docId, (CUR_DOCS || []).map(x => x.id));
    const sameDocFamily = docId && srcId &&
      docId.slice(0, 5) === srcId.slice(0, 5) &&
      /[AB]$/.test(docId) && /[AB]$/.test(srcId);
    if (ex.includes(srcId) && !sameDocFamily) {
      return sendJSON(res, 400, { error: '业务流向不合理：' + srcId + ' 是 ' + docId + ' 的下游单据，上游单据不能取下游单据的值（如报价单不能取进货单）。请改选上游来源档。', flowRejected: true });
    }
  }
  if (CUR_DOCS === DOC_ITEMS || CUR_SRCS === SRC_ITEMS) {
    const p0 = await getPool();
    CUR_DOCS = await sqlgen.scanDocs(p0);
    CUR_SRCS = await sqlgen.scanSrcs(p0);
  }
  async function buildMapping(mapping, runMode, runForce, opts = {}) {
    const mTgtCol = String(mapping.tgtCol || '').trim();
    const mSrcId = String(mapping.srcId || '').trim();
    const mSrcValCol = String(mapping.srcValCol || '').trim();
    if (!mTgtCol || !mSrcId || !mSrcValCol) throw new Error('多字段映射缺少目标列、来源档或来源值列');
    const targetDoc = CUR_DOCS.find(d => d.id === docId);
    if (!targetDoc) throw new Error('目标单据 ' + docId + ' 不存在');
    await verifyColsForTrig(await getPool(), targetDoc, mTgtCol, mSrcId, mSrcValCol);
    let out;
    if (isInvoiceDate) {
      const p0 = await getPool();
      const useMixedNumber = !mergeDisplay && mTgtCol === 'GSB960' && mSrcValCol === 'HDB001';
      const useMixedTime = !mergeDisplay && mTgtCol === 'GSB961' && mSrcValCol === 'HDB902';
      const useMergedTime = mergeDisplay && mTgtCol === 'GSB960' && mSrcValCol === 'HDB902';
      if (useMixedNumber || useMixedTime || useMergedTime) {
        out = (useMixedTime || useMergedTime)
          ? sqlgen.buildInvoiceMixedTimeSQL(mTgtCol, runMode, runForce)
          : sqlgen.buildInvoiceMixedNumberSQL(mTgtCol, runMode, runForce);
      } else {
        const reg = await getChainRegistry();
        const autoPaths = pruneInvoicePaths(resolvedChainPaths(reg, docId, mSrcId));
        if (!autoPaths.length) {
          const codes = await p0.request().query(
            "SELECT DISTINCT GSB003 AS code FROM dbo.YSFGSB WHERE ISNULL(GSB003,'') <> '' ORDER BY GSB003"
          );
          const shown = codes.recordset.map(x => x.code).join(', ') || '无来源数据';
          throw new Error('采购发票到 ' + mSrcId + ' 没有可用链路，当前发票来源代码: ' + shown);
        }
        out = autoPaths.length === 1
          ? sqlgen.buildChainSQL(docId, mTgtCol, mSrcValCol, runMode, runForce, autoPaths[0], reg.docs)
          : sqlgen.buildChainMultiSQL(docId, mTgtCol, mSrcValCol, runMode, runForce, autoPaths, reg.docs);
      }
    } else {
      const mappingChain = mapping.chain || (mSrcId === srcId ? chain : null);
      out = sqlgen.buildSQL(docId, mTgtCol, mSrcId, mSrcValCol, partyKey, runMode, runForce, mappingChain, { docs: CUR_DOCS, srcs: CUR_SRCS });
      const aggregatePurchase = (docId === 'YSFGQB' || docId === 'YSFGQA') && (mSrcId === 'DCSHDA' || mSrcId === 'DCSHDB');
      let autoPaths = [];
      let autoRegistry = null;
      try {
        autoRegistry = await getChainRegistry();
        autoPaths = resolvedChainPaths(autoRegistry, docId, mSrcId);
      } catch (autoErr) {
        dbg('[autoChain] lookup failed: ' + autoErr.message);
      }
      const internalPath = autoPaths.length > 0 && autoPaths.every(path => path.length && path.every(edge => edge.internal));
      if (!autoPaths.length && ['TPADEA'].includes(mSrcId)) {
        out.chainWarning = '来源是品号主档，但当前单据没有找到“主件品号→品号主档”的链路；直接按品号关联可能取到子件品名，请先补主档解析边。';
      }
      if (out.channelName === '默认键' || internalPath) {
        try {
          if (autoPaths.length === 1) {
            out = sqlgen.buildChainSQL(docId, mTgtCol, mSrcValCol, runMode, runForce, autoPaths[0], autoRegistry.docs);
          } else if (autoPaths.length > 1) {
            out = sqlgen.buildChainMultiSQL(docId, mTgtCol, mSrcValCol, runMode, runForce, autoPaths, autoRegistry.docs, {
              aggregateDistinct: aggregatePurchase
            });
          }
        } catch (autoErr) {
          dbg('[autoChain] fallback to base: ' + autoErr.message);
          out.chainWarning = '自动链路不可用，已退回基础通道: ' + autoErr.message;
        }
      }
      // 单头字段依赖单身：按单头主键聚合。触发时挂到第一条单身表，避免单头触发器看不到单身。
      const firstEdge = autoPaths.length === 1 ? autoPaths[0][0] : null;
      if (!targetDoc.seqCol && autoPaths.length === 1 && firstEdge && firstEdge.internal && autoRegistry && autoRegistry.docs) {
        try {
          const pk = await pkColumns(await getPool(), targetDoc.sub);
          const lineTable = firstEdge.to;
          const lineMeta = autoRegistry.docs[lineTable] || {};
          const targetChainMeta = autoRegistry.docs[docId] || {};
          let lineFilter = null;
          if (lineMeta.docNo && targetChainMeta.docNo) {
            lineFilter = 'i.[' + lineMeta.docNo + ']=b.[' + targetChainMeta.docNo + ']';
            if (lineMeta.typeCol && targetChainMeta.typeCol) {
              lineFilter = 'i.[' + lineMeta.typeCol + ']=b.[' + targetChainMeta.typeCol + '] AND ' + lineFilter;
            }
          }
          if (pk.length) {
            out = sqlgen.buildChainMergeSQL(docId, mTgtCol, mSrcValCol, runMode, runForce, autoPaths[0], autoRegistry.docs, pk, '   ', opts.triggerLineFilter ? lineFilter : null);
            out.triggerTable = lineTable;
            out.triggerFilter = lineFilter;
            out.isHeaderMerge = true;
          }
        } catch (mergeErr) {
          dbg('[headerMerge] fallback: ' + mergeErr.message);
          out.chainWarning = '表头合并聚合失败，已退回普通合并: ' + mergeErr.message;
        }
      }
    }
    if (!isInvoiceDate) {
      const pType = await getPool();
      const tType = await columnType(pType, targetDoc.sub, mTgtCol);
      const sType = await columnType(pType, mSrcId, mSrcValCol);
      if (tType && sType) out.typeWarning = typeWarningFor(targetDoc.sub, mTgtCol, tType, mSrcId, mSrcValCol, sType);
    }
    return out;
  }

  const extraMappings = Array.isArray(b.mappings)
    ? b.mappings.filter(m => m && (m.tgtCol || m.srcId || m.srcValCol))
    : [];
  const allMappings = [{ tgtCol, srcId, srcValCol, chain }, ...extraMappings];
  const targetNames = allMappings.map(m => String(m.tgtCol || '').trim()).filter(Boolean);
  if (new Set(targetNames).size !== targetNames.length) {
    return sendJSON(res, 400, { error: '多字段映射中存在重复目标列，请合并为一个映射' });
  }
  let builtResults;
  try {
    builtResults = [];
    for (const mapping of allMappings) builtResults.push(await buildMapping(mapping, mode, force));
  } catch (e) {
    return sendJSON(res, 400, { error: e.message });
  }
  let built = builtResults[0];
  const multiMappingNote = builtResults.length > 1
    ? allMappings.map(m => m.tgtCol + '←' + m.srcId + '.' + m.srcValCol).join('；')
    : '';

  if (built.channels && built.channels.length > 1) {
    // 通道优先级：单号键 > 单号+序号 > 默认键（品号）
    // 空表数据行数无意义，按通道名称优先级选择
    const chCount = built.channels.length;
    const priority = { '进货单关联采购源头': 9, '进货单头经单身关联采购单头': 8, '进货单头经单身关联采购底稿': 8, '检验分流': 7, '前置优先_计划兜底': 6, '计划来源单号键': 5, '计划编号键': 4, '单号键': 3, '单号+序号': 2, '默认键': 1 };
    const sorted = [...built.channels].sort((a, b) =>
      (priority[b.channelName] || 0) - (priority[a.channelName] || 0));
    built = sorted[0];
    // 传播 isFallback 标记（前置优先_计划兜底 通道用 LEFT JOIN + ISNULL 生成触发器）
    if (built.channelName === '前置优先_计划兜底' || built.channelName === '检验分流') built.isFallback = true;
    built.channelNote = '自动匹配通道: ' + built.channelName + '（优先级最高，共' + chCount + '个通道）';
    delete built.channels; // 避免前端误读
  }
  if (multiMappingNote) built.channelNote = (built.channelNote ? built.channelNote + ' | ' : '') + '多字段: ' + multiMappingNote;
  if (mergeDisplay) built.channelNote = (built.channelNote ? built.channelNote + ' | ' : '') + (built.isHeaderMerge ? '表头合并: 以来源聚合覆盖旧值' : '合并显示: 目标值 + 本次值（重复值自动跳过）');
  // 通道切换后保留类型提示
  built.typeWarning = builtResults.map(x => x.typeWarning).filter(Boolean).join('；') || undefined;
  built.isHeaderMerge = builtResults.some(x => x.isHeaderMerge);
  built.triggerTable = builtResults.map(x => x.triggerTable).find(Boolean) || undefined;
  built.triggerFilter = builtResults.map(x => x.triggerFilter).find(Boolean) || undefined;
  built.chainWarning = builtResults.map(x => x.chainWarning).filter(Boolean).join('；') || undefined;

  const p = await getPool();
  // 精确性守卫：同一目标行匹配多条来源行时，只有“值完全一致”才允许；不一致直接拒绝。
  if (!isInvoiceDate && !mergeDisplay) {
    const guardDoc = CUR_DOCS.find(d => d.id === docId);
    const guardPk = guardDoc ? await pkColumns(p, guardDoc.sub) : [];
    const checkBuilds = allMappings.length > 1 ? builtResults : [built];
    for (const cb of checkBuilds) {
      if (!cb.updateSql) continue;
      const dq = sqlgen.buildDuplicateCheckSql(cb.updateSql, guardPk);
      if (!dq) continue;
      try {
        const dr = await p.request().query(dq);
        const bad = dr.recordset.filter(r => Number(r.d) > 1);
        if (bad.length) {
          return sendJSON(res, 400, {
            error: '来源匹配多条且值不一致，无法保证精确取值。请改用带序号/仓库的唯一键，或使用聚合/合并显示。',
            duplicates: bad.slice(0, 10)
          });
        }
        if (dr.recordset.length) dbg('[run] 来源多行但值一致，可安全填入: ' + dr.recordset.length + ' 组');
      } catch (e) { dbg('[run] duplicate check skipped: ' + e.message); }
    }
  }
  if (!confirm) {
    const pr = await p.request().query(built.cntSql);
    const totalRows = pr.recordset[0].n; let sample = [];
    if (totalRows > 0) { const sr = await p.request().query(built.previewSql); sample = sr.recordset.slice(0, 50); }
    return sendJSON(res, 200, { preview: true, mappingCount: builtResults.length, totalRows, partyNote: built.partyNote, joins: built.joins, channelNote: built.channelNote || '', chainNote: built.chainNote || '', typeWarning: built.typeWarning || undefined, chainWarning: built.chainWarning || undefined, previewSql: built.previewSql, updateSql: built.updateSql, updateSqls: built.updateSqls, sample, note: force ? '强制覆盖(实时最新)' : (mode === 'fix' ? '纠正错值' : '只填空(幂等)') });
  }

  const cfg = CUR_CONFIG || CONFIG.db;
  const backup = await backupDatabaseWithCleanup(p, cfg, 'handleRun');
  const bp = backup.path;
  if (!backup.ok) {
    return sendJSON(res, 500, { error: '数据库备份失败，已中止执行（未写库）: ' + backup.error, backupPath: bp, backupOk: false });
  }
  const doc = CUR_DOCS.find(d => d.id === docId);
  const tblName = 'dbo.' + doc.sub;
  const targetCols = new Set(allMappings.map(m => String(m.tgtCol).toUpperCase()));
  const trigRows = await p.request().input('t', sql.NVarChar, tblName).query(
    "SELECT o.name, m.definition sql FROM sys.triggers o JOIN sys.sql_modules m ON m.object_id=o.object_id WHERE o.parent_id=OBJECT_ID(@t) AND o.is_disabled=0"
  );
  // 只禁用“确实写目标列”的触发器；ERP 的其它保存/审核触发器继续正常运行。
  const enTrigs = trigRows.recordset
    .filter(r => sqlgen.triggerTargetColumns(r.sql).some(c => targetCols.has(String(c).toUpperCase())))
    .map(r => r.name);
  let affectedRows = 0;
  let updateSqls = builtResults.flatMap(builtUpdateSqls).filter(Boolean);
  if (mergeDisplay && !built.isHeaderMerge) updateSqls = updateSqls.map(sql => sqlgen.appendUpdateSql(sql, '   '));
  let tx = null;
  let after = null;
  // 禁用/更新/恢复放在同一个事务里：进程崩溃或连接断开时 SQL Server 会整体回滚，
  // 不会留下“ERP 触发器被永久禁用”的状态。
  try {
    tx = new sql.Transaction(p);
    await tx.begin();
    for (const tn of enTrigs) { await new sql.Request(tx).query("DISABLE TRIGGER [dbo].[" + tn + "] ON [dbo].[" + doc.sub + "]"); }
    for (const updateSql of updateSqls) {
      const ur = await new sql.Request(tx).query(updateSql);
      affectedRows += (ur.rowsAffected || []).reduce((sum, n) => sum + Number(n || 0), 0);
    }
    for (const tn of enTrigs) { await new sql.Request(tx).query("ENABLE TRIGGER [dbo].[" + tn + "] ON [dbo].[" + doc.sub + "]"); }
    await tx.commit();
    dbg('[handleRun] UPDATE OK affected=' + affectedRows + ' statements=' + updateSqls.length + ' disabled=' + enTrigs.join(','));
  } catch (updErr) {
    if (tx) { try { await tx.rollback(); } catch (_) {} }
    dbg('[handleRun] UPDATE FAILED: ' + updErr.message);
    return sendJSON(res, 500, { error: '执行更新失败: ' + updErr.message, backupPath: bp, updateSql: built.updateSql, updateSqls: built.updateSqls });
  }
  try {
    after = await p.request().query("SELECT TOP 20 b.[" + (doc.refCol || doc.keyCol) + "] docNo, b.[" + tgtCol + "] filled FROM [dbo].[" + doc.sub + "] b WHERE b.[" + tgtCol + "] IS NOT NULL AND CAST(b.[" + tgtCol + "] AS nvarchar(max))<>N'' ORDER BY b.[" + doc.keyCol + "]");
  } catch (e) { dbg('[handleRun] after sample failed: ' + e.message); after = { recordset: [] }; }

  let triggerResult = null;

  if (createTrigger && docId === 'YSFGQB' && (srcId === 'DCSHDA' || srcId === 'DCSHDB')) {
    triggerResult = {
      ok: true,
      skipped: true,
      allowForce: false,
      note: '付款单身汇总依赖 YSFGQC 冲账行，已自动跳过触发器。请保存付款单后使用执行更新。'
    };
  }
  if (createTrigger && !triggerResult) {
    try {
      const mixedInvoiceNumber = isInvoiceDate && tgtCol === 'GSB960';
      const multiFieldTrigger = allMappings.length > 1;
      const effChain = await getEffectiveChain(chain, srcId, srcValCol, CUR_SRCS, p);
      const srcForVerify = effChain ? srcId : srcId;
      if (multiFieldTrigger) {
        for (const mapping of allMappings) await verifyColsForTrig(p, doc, mapping.tgtCol, null, null);
      } else {
        await verifyColsForTrig(p, doc, tgtCol, mixedInvoiceNumber ? null : srcForVerify, mixedInvoiceNumber ? null : srcValCol);
      }
      if (mixedInvoiceNumber && triggerTimeMode && triggerTimeMode !== 'none') {
        await verifyColsForTrig(p, doc, 'GSB961', null, null);
      }

      let onTable = doc.sub;
      let trgName = 'trg_' + doc.sub + '_momo';
      const headerLineTrigger = !!built.triggerTable;
      if (headerLineTrigger) {
        onTable = built.triggerTable;
        trgName = 'trg_' + onTable + '_header_momo';
      }

      // B 方案：检测同表已启用的系统触发器是否已在写目标列
      let conflicts = [];
      for (const target of [...new Set(allMappings.map(m => m.tgtCol))]) {
        conflicts.push(...await detectTrigConflict(p, doc.sub, target));
      }
      if (mixedInvoiceNumber && triggerTimeMode && triggerTimeMode !== 'none') {
        conflicts.push(...await detectTrigConflict(p, doc.sub, 'GSB961'));
      }
      conflicts = [...new Map(conflicts.map(c => [c.trigName + '|' + c.col, c])).values()];
      if (conflicts.length && !b.forceCreateTrigger) {
        // 默认跳过建触发器，但允许用户传 forceCreateTrigger=true 强制
        const conflictText = conflicts.map(c => conflictLabel(c) + ' 写 ' + c.col).join('；');
        triggerResult = { ok: true, skipped: true, allowForce: true, conflict: conflicts.map(c => c.trigName),
          conflictDetail: conflicts,
          note: 'ERP 触发器已写入目标列，为避免取值冲突已跳过建立工具触发器：' + conflictText + '。如确认需要可勾选强制创建。' };
        sendJSON(res, 200, { ok: true, mappingCount: builtResults.length, affected: affectedRows, backupPath: bp, backupOk: backup.ok, removedOldBackups: backup.cleanup.removed, sampleAfter: after.recordset, updateSql: built.updateSql, updateSqls: built.updateSqls, triggerResult });
        return;
      }
      if (conflicts.length && b.forceCreateTrigger) {
        dbg('[trig] force create despite conflict: ' + conflicts.map(c => c.trigName).join(','));
      }

      const pkCols = await p.request().input('t', sql.NVarChar, doc.sub).query("SELECT c.name FROM sys.index_columns ic JOIN sys.indexes i ON ic.object_id=i.object_id AND ic.index_id=i.index_id JOIN sys.columns c ON ic.object_id=c.object_id AND ic.column_id=c.column_id WHERE i.is_primary_key=1 AND ic.object_id=OBJECT_ID(@t) ORDER BY ic.key_ordinal");
      const pkNames = pkCols.recordset.map(r => r.name);
      if (pkNames.length === 0) throw new Error('表 ' + doc.sub + ' 没有主键，无法创建触发器');
      const pkJoin = pkNames.map(c => 'i.[' + c + ']=b.[' + c + ']').join(' AND ');
      // 注：pkJoin 用主键做 b/inserted 匹配（新增单据主键由 ERP 分配，正确）；
      // 单据主档关联列 refCol 用于 s2/s1 与 b 的 JOIN，已正确使用 doc.refCol

      // 触发器 JOIN 必须和实际 buildSQL 选中的通道保持一致
      let joinSql;
      const s1 = CUR_SRCS.find(x => x.id === srcId);
      const s1Key = s1 ? s1.key[0] : (srcId.slice(3, 6) + '001');
      if (effChain && effChain.src2Id) {
        const s2 = CUR_SRCS.find(x => x.id === effChain.src2Id);
        const s2Key = effChain.src2Key || (s2 ? s2.key[0] : (effChain.src2Id.slice(3, 6) + '001'));
        const srcWh = effChain.srcJoinKey || 'LOA002';
        const s2Wh = effChain.src2ValCol || 'DEA008';
        joinSql = 'JOIN [dbo].[' + srcId + '] s1 ON s1.' + s1Key + ' = b.' + (doc.refCol || doc.keyCol) +
          ' AND CAST(s1.' + srcWh + ' AS varchar(50)) = CAST(s2m.' + s2Wh + ' AS varchar(50))';
      } else {
        // 用 buildSQL 选中通道的 JOIN 条件（与预览/执行保持一致）
        const chJoins = built.joins || [];
        if (chJoins.length) {
          joinSql = 'JOIN [dbo].[' + srcId + '] s1 ON ' +
            chJoins.map(j => {
              // 来源表别名 s.→s1.；中间表别名 s2.→s2m.（与 chain2SqlForTrig 一致）
              return j.split('s2.').join('s2m.').replace(/\bs\./g, 's1.');
            }).join(' AND ');
        } else {
          joinSql = 'JOIN [dbo].[' + srcId + '] s1 ON s1.' + s1Key + ' = b.' + (doc.refCol || doc.keyCol);
        }
      }

      const finalValExpr = 's1.[' + srcValCol + ']';
      // 只在 INSERT 时触发（新增单据才带值）；UPDATE 不触发，避免 ERP 判定"异动"
      const trigWhere = "(b.[" + tgtCol + "] IS NULL OR CAST(b.[" + tgtCol + "] AS nvarchar(max))=N'')";
      // 触发器 SQL 里需要叠加主表 JOIN（built.mJoinSql），否则单号键通道的 s1 无法关联到主表维度
      const mJoinForTrig = built.mJoinSql || '';
      // 中间表 JOIN（chain2Sql）统一别名 s2m，且只在自动链式场景（chJoins 不含 s2m 引用）时出现一次
            
      const chJoinsHasS2m = (built.joins || []).some(j => j.includes('s2.')) || built.joins && built.joins.some(j => j.includes('s2m.'));
      const chain2ForTrig = !chJoinsHasS2m && (built.chain2Sql ? built.chain2Sql.replace(/\bs2\./g, 's2m.').replace(/\bs2 ON/g, 's2m ON') :
        (effChain && effChain.src2Id ? ' JOIN [dbo].[' + effChain.src2Id + '] s2m ON s2m.' + (effChain.src2Key || '') + ' = b.' + (doc.refCol || doc.keyCol) : ''));

      const chain2ForTrigStr = (typeof chain2ForTrig === 'string' ? chain2ForTrig : '');
      const MID_TBL_MAP = { '计划来源单号键': { tbl: 'SGMRIB', on: 's2m.RIB001 = b.RAA026' } };
      const chosenChName = built.channelName || '';
      const midSpec2 = MID_TBL_MAP[chosenChName];
      const midJoinForTrig = (chJoinsHasS2m && midSpec2) ? (' JOIN [dbo].[' + midSpec2.tbl + '] s2m ON ' + midSpec2.on) : '';

      // 前置优先_计划兜底：两条互斥路径用 LEFT JOIN + ISNULL，不能用 AND 连接
      //   前置路径：  s1.IBA001 = b.RAA011
      //   计划路径：  s2m.RIB001 = b.RAA026 → s2m.RIB004 → s1b.IBA001
      let trigSql;
      if (mergeDisplay) {
        const mergeBuilt = await buildMapping(allMappings[0], 'fill', true, { triggerLineFilter: headerLineTrigger });
        const mergeStatements = builtUpdateSqls(mergeBuilt).filter(Boolean);
        trigSql = headerLineTrigger
          ? sqlgen.buildTriggerFromStatements(onTable, trgName, mergeStatements, doc.sub + '.' + tgtCol)
          : sqlgen.buildMultiFieldTriggerSQL(doc.sub, trgName, pkJoin,
            mergeStatements.map(s => sqlgen.dedupeTriggerUpdate(s, doc.sub, pkNames)));
        dbg('[trig] 合并显示触发器 SQL: ' + trigSql);
      } else if (multiFieldTrigger) {
        const specialTimeMode = mixedInvoiceNumber && ['separate', 'combined'].includes(triggerTimeMode) ? triggerTimeMode : null;
        if (specialTimeMode) {
          const triggerStatements = [
            sqlgen.buildInvoiceMixedNumberTriggerUpdateSQL(doc.sub, tgtCol, pkJoin, specialTimeMode)
          ];
          for (const mapping of allMappings.slice(1)) {
            const triggerBuilt = await buildMapping(mapping, 'fill', false);
            triggerStatements.push(...builtUpdateSqls(triggerBuilt).map(sql => sqlgen.applyInsertedFilter(sqlgen.dedupeTriggerUpdate(sql, doc.sub, pkNames), pkJoin)));
          }
          trigSql = sqlgen.buildTriggerFromStatements(doc.sub, trgName, triggerStatements);
        } else if (headerLineTrigger) {
          const triggerBuilds = [];
          for (const mapping of allMappings) triggerBuilds.push(await buildMapping(mapping, 'fill', false, { triggerLineFilter: true }));
          trigSql = sqlgen.buildTriggerFromStatements(onTable, trgName, triggerBuilds.flatMap(builtUpdateSqls).filter(Boolean), doc.sub + '.' + tgtCol);
        } else {
          const triggerBuilds = [];
          for (const mapping of allMappings) triggerBuilds.push(await buildMapping(mapping, 'fill', false));
          trigSql = sqlgen.buildMultiFieldTriggerSQL(doc.sub, trgName, pkJoin,
            triggerBuilds.flatMap(builtUpdateSqls).filter(Boolean).map(s => sqlgen.dedupeTriggerUpdate(s, doc.sub, pkNames)));
        }
        dbg('[trig] 多字段触发器 SQL: ' + trigSql);
      } else if (mixedInvoiceNumber) {
        trigSql = sqlgen.buildInvoiceMixedNumberTriggerSQL(doc.sub, trgName, tgtCol, pkJoin, triggerTimeMode);
        dbg('[trig] 采购发票混合来源单号 SQL: ' + trigSql);
      } else {
        // 触发器统一复用预览/执行的 UPDATE SQL（普通通道、链路、兜底都一样），
        // 只额外加 inserted 过滤，避免触发器另拼 JOIN 与预览不一致。
        const trigBuilt = await buildMapping(allMappings[0], 'fill', false, { triggerLineFilter: headerLineTrigger });
        if (headerLineTrigger) {
          trigSql = sqlgen.buildTriggerFromStatements(onTable, trgName, builtUpdateSqls(trigBuilt).filter(Boolean), doc.sub + '.' + tgtCol);
        } else {
          const trigStatements = [];
          for (const u of builtUpdateSqls(trigBuilt).filter(Boolean)) {
            const guard = sqlgen.buildUniquenessGuard(u, pkJoin, pkNames, doc.sub + '.' + tgtCol);
            if (guard) trigStatements.push(guard);
            trigStatements.push(sqlgen.applyInsertedFilter(sqlgen.dedupeTriggerUpdate(u, doc.sub, pkNames), pkJoin));
          }
          trigSql = sqlgen.buildTriggerFromStatements(doc.sub, trgName, trigStatements, doc.sub + '.' + tgtCol);
        }
        dbg('[trig] 统一触发器 SQL: ' + trigSql);
      }
      dbg('[trig] SQL: ' + trigSql);

      // 统一校验触发器 SQL 里 FROM/JOIN 引用的表都在当前账套存在，
      // 取代原先手工维护的 joinTables 列表（手工列表容易和生成逻辑脱节）。
      const referencedTables = [...new Set([...trigSql.matchAll(/(?:FROM|JOIN)\s+\[dbo\]\.\[([A-Za-z0-9_]+)\]/gi)].map(m => m[1]))];
      for (const jt of referencedTables) {
        const tchk = await p.request().input('t', sql.NVarChar, jt).query('SELECT OBJECT_ID(@t) AS id');
        if (!tchk.recordset[0].id) throw new Error('表 ' + jt + ' 在数据库 ' + cfg.database + ' 中不存在（触发器 SQL 引用了它）');
      }

      const allTriggers = (await p.request().input('t', sql.NVarChar, onTable).query(
        "SELECT o.name, m.definition sql FROM sys.triggers o JOIN sys.sql_modules m ON m.object_id=o.object_id WHERE o.parent_id=OBJECT_ID(@t)"
      )).recordset;
      // 只合并工具形态的触发器（UPDATE b SET b.），绝不按名字误删 ERP 触发器
      const existingTools = allTriggers.filter(t => /UPDATE\s+b\s+SET\s+b\./i.test(String(t.sql || '')) && (!headerLineTrigger || t.name === trgName));
      const mergedSql = existingTools.length
        ? sqlgen.mergeTriggerDefinitions(onTable, trgName, existingTools, trigSql, {
          mergeTargets: mergeDisplay ? [tgtCol] : [],
          replaceTargets: mergeDisplay ? [] : [tgtCol],
          separator: '   '
        })
        : trigSql;
      const triggerTx = new sql.Transaction(p);
      try {
        await triggerTx.begin();
        for (const old of existingTools) await new sql.Request(triggerTx).query('DROP TRIGGER [dbo].[' + old.name + ']');
        await new sql.Request(triggerTx).query(mergedSql);
        const verified = await new sql.Request(triggerTx).input('n', sql.NVarChar, trgName).query("SELECT OBJECT_ID(@n,'TR') AS id");
        if (!verified.recordset[0] || !verified.recordset[0].id) throw new Error('触发器创建后未找到 ' + trgName);
        await triggerTx.commit();
        let orderLast = false;
        try {
          if (await canSetTriggerLast(p, onTable, trgName)) {
            await p.request().query("EXEC sp_settriggerorder @triggername = N'" + String(trgName).replace(/'/g, "''") + "', @order = 'Last', @stmttype = 'INSERT'");
            orderLast = true;
          } else { dbg('[trig] ERP 已有 Last INSERT 触发器，保留原顺序'); }
        } catch (e2) { dbg('[trig] set order failed: ' + e2.message); }
        dbg('[trig] created OK ' + trgName + ' merged=' + existingTools.length);
        triggerResult = { ok: true, name: trgName, mergedExisting: existingTools.length, orderLast, conflict: conflicts.length ? conflicts.map(c => c.trigName) : undefined, conflictDetail: conflicts.length ? conflicts : undefined, conflictNote: conflicts.length ? ('注意：' + conflicts.map(c => conflictLabel(c) + ' 写 ' + c.col).join('；')) : undefined };
      } catch (createErr) {
        try { await triggerTx.rollback(); } catch (_) {}
        dbg('[trig] CREATE FAILED: ' + createErr.message);
        triggerResult = { ok: false, error: '创建触发器失败: ' + createErr.message };
      }
    } catch (te) {
      dbg('[trig] outer error: ' + te.message + '\n' + te.stack);
      triggerResult = { ok: false, error: te.message };
    }
  }

  sendJSON(res, 200, { ok: true, mappingCount: builtResults.length, affected: affectedRows, backupPath: bp, backupOk: backup.ok, removedOldBackups: backup.cleanup.removed, sampleAfter: after.recordset, updateSql: built.updateSql, updateSqls: built.updateSqls, triggerResult });
}

// 触发器管理
async function trigList(req, res) { const p = await ensurePoolDb((CUR_CONFIG || CONFIG.db).database); const r = await p.request().query("SELECT o.name, OBJECT_NAME(o.parent_id) tbl, o.is_disabled [disabled], m.definition [sql] FROM sys.triggers o JOIN sys.sql_modules m ON m.object_id=o.object_id WHERE o.parent_class=1 ORDER BY o.name");
  // 为每个触发器自动生成中文说明
  const docNames = {};
  try {
    const dRes = await p.request().query("SELECT t.name, CONVERT(varchar(200), s.value) desc FROM sys.tables t LEFT JOIN sys.extended_properties s ON s.major_id=t.object_id AND s.minor_id=0 AND s.name=N'MS_Description' WHERE t.is_ms_shipped=0 AND t.name LIKE N'%B'");
    for (const row of dRes.recordset) if (row.desc) docNames[row.name] = row.desc;
  } catch (_) {}
  const tblDesc = {};
  try {
    const tRes = await p.request().query("SELECT t.name, CONVERT(varchar(200), s.value) desc FROM sys.tables t LEFT JOIN sys.extended_properties s ON s.major_id=t.object_id AND s.minor_id=0 AND s.name=N'MS_Description' WHERE t.is_ms_shipped=0");
    for (const row of tRes.recordset) if (row.desc) tblDesc[row.name] = row.desc;
  } catch (_) {}
  const triggers = r.recordset.map(row => {
    // 解析 UPDATE 目标列 + JOIN 来源表
    const sql = row.sql || '';
    const targetColumns = [...new Set(sqlgen.triggerTargetColumns(sql))];
    const tgtCol = targetColumns[0] || '';
    const joinTables = [...sql.matchAll(/JOIN\s+\[dbo\]\.\[?(\w+)/gi)].map(m => m[1]);
    const srcTbl = joinTables[0] || '';
    const tblDescStr = tblDesc[row.tbl] || '';
    const srcDesc = tblDesc[srcTbl] || '';
    let desc = '';
    if (targetColumns.length && srcTbl) {
      desc = (tblDescStr || row.tbl) + ' 自动填充 ' + targetColumns.join('、') + '（来源 ' + (srcDesc || srcTbl) + '）';
    } else if (targetColumns.length) {
      desc = (tblDescStr || row.tbl) + ' 自动填充 ' + targetColumns.join('、');
    } else {
      desc = (tblDescStr || row.tbl) + ' 触发器';
    }
    // 本工具触发器按 SQL 形态识别（UPDATE b SET b.），不再按名字误判 ERP 的 trg_ 触发器
    const isTool = /UPDATE\s+b\s+SET\s+b\./i.test(sql);
    return { name: row.name, tbl: row.tbl, disabled: row.disabled, sql: row.sql, desc, isTool, targetColumns, fieldCount: targetColumns.length };
  });
  let dbName = '';
  try { const d = await p.request().query('SELECT DB_NAME() AS db'); dbName = (d.recordset[0] && d.recordset[0].db) || ''; } catch (_) {}
  sendJSON(res, 200, { triggers, database: dbName, server: (CUR_CONFIG || CONFIG.db).server });
}

async function trigBuild(req, res) {
  const b = JSON.parse(await readBody(req));
  const { trgName, onTable, tgtTable, tgtCol, chain, mode } = b;
  if (!onTable || !tgtTable || !tgtCol || !Array.isArray(chain) || !chain.length) return sendJSON(res, 400, { error: '缺少 onTable/tgtTable/tgtCol/chain' });
  const p = await getPool();
  for (const c of chain) { const chk = await p.request().input('t', sql.NVarChar, c.tbl).query('SELECT OBJECT_ID(@t) id'); if (!chk.recordset[0].id) return sendJSON(res, 400, { error: '表不存在: ' + c.tbl }); }
  const joins = [];
  for (let i = 0; i < chain.length; i++) { const c = chain[i]; const a = 's' + i;
    if (i === 0) joins.push('JOIN [dbo].[' + c.tbl + '] s0 ON ' + c.joinCols.map(x => 's0.' + x.left + ' = b.' + x.right).join(' AND ') + ' ');
    else joins.push('JOIN [dbo].[' + c.tbl + '] ' + a + ' ON ' + c.joinCols.map(x => a + '.' + x.left + ' = s' + (i - 1) + '.' + x.right).join(' AND ') + ' ');
  }
  const lastA = 's' + (chain.length - 1); const lastVal = '[' + chain[chain.length - 1].valueCol + ']';
  const where = mode === 'force' ? '1=1' : ("(b.[" + tgtCol + "] IS NULL OR CAST(b.[" + tgtCol + "] AS nvarchar(max))=N'')");
  // 只在 INSERT 时触发（新增单据才带值），WHERE 固定用 fill 条件避免异动
  // 单据主档关联列：优先取字典里该单据的 refCol（工单/领退料等主档列不在 001/002 位置）；没有则退回 pfx+001
  const refColForTrig = (CUR_DOCS && CUR_DOCS.find) ? ((CUR_DOCS.find(d => d.sub === onTable) || {}).refCol) : null;
  const keyL = refColForTrig || (onTable.slice(3, 6) + '001');
  const keyR = onTable.slice(3, 6) + '002';
  const trigWhere = "(b.[" + tgtCol + "] IS NULL OR CAST(b.[" + tgtCol + "] AS nvarchar(max))=N'')";
  const trigSql = 'CREATE TRIGGER [dbo].[' + trgName + '] ON [dbo].[' + onTable + '] AFTER INSERT AS BEGIN SET NOCOUNT ON; UPDATE b SET b.[' + tgtCol + '] = ' + lastA + '.' + lastVal + ' FROM [dbo].[' + tgtTable + '] b JOIN inserted i ON i.[' + keyL + ']=b.[' + keyL + '] AND i.[' + keyR + ']=b.[' + keyR + '] ' + joins.join(' ') + ' WHERE ' + trigWhere + '; END;'
  const previewSql = "SELECT TOP 200 b.[" + keyL + "] doc, b.[" + keyR + "] seq, b.[" + tgtCol + "] now, " + lastA + '.' + lastVal + " willBe FROM [dbo].[" + tgtTable + "] b " + joins.join(' ') + ' WHERE ' + where + ';';
  sendJSON(res, 200, { previewSql, triggerSql: trigSql, mode: mode || 'fill' });
}

async function canSetTriggerLast(pool, onTable, trgName) {
  try {
    const r = await pool.request().input('t', sql.NVarChar, onTable).input('n', sql.NVarChar, trgName)
      .query("SELECT o.name FROM sys.triggers o WHERE o.parent_id=OBJECT_ID(@t) AND o.is_disabled=0 AND o.name<>@n AND OBJECTPROPERTY(o.object_id,'ExecIsLastInsertTrigger')=1");
    return r.recordset.length === 0;
  } catch (_) { return true; }
}

async function trigCreate(req, res) {
  const b = JSON.parse(await readBody(req)); const { trgName, onTable, trigSql, confirm, force } = b;
  if (!trgName || !onTable || !trigSql) return sendJSON(res, 400, { error: '缺少参数' });
  let p = await getPool();
  const dropSql = "IF OBJECT_ID(N'" + trgName + "','TR') IS NOT NULL DROP TRIGGER [dbo].[" + trgName + '];';
  if (!confirm) return sendJSON(res, 200, { preview: true, dropSql, createSql: trigSql });
  const cfg = CUR_CONFIG || CONFIG.db;
  // 执行前确认当前连接池真的连在目标账套上，避免把触发器建到旧库
  let dbNow = '';
  try { const q = await p.request().query('SELECT DB_NAME() AS db'); dbNow = q.recordset[0] && q.recordset[0].db || ''; } catch (_) {}
  if (dbNow && cfg.database && String(dbNow).toLowerCase() !== String(cfg.database).toLowerCase()) {
    dbg('[trigCreate] pool db=' + dbNow + ' target=' + cfg.database + '，正在重建连接池');
    p = await switchPool(cfg);
    try { const q = await p.request().query('SELECT DB_NAME() AS db'); dbNow = q.recordset[0] && q.recordset[0].db || ''; } catch (_) {}
  }
  // 与 ERP 触发器冲突检查：目标列已被保存/审核触发器写入时，默认阻止创建
  try {
    const tgtCols = [...new Set(sqlgen.triggerTargetColumns(trigSql))];
    const conflicts = [];
    for (const col of tgtCols) conflicts.push(...await detectTrigConflict(p, onTable, col));
    if (conflicts.length) {
      const text = conflicts.map(c => conflictLabel(c) + ' 写 ' + c.col).join('；');
      if (!force) return sendJSON(res, 409, { error: 'ERP 触发器已写入目标列，已阻止创建：' + text, conflicts });
      dbg('[trigCreate] force create despite conflict: ' + text);
    }
  } catch (e) { dbg('[trigCreate] conflict check failed: ' + e.message); }

  const backup = await backupDatabaseWithCleanup(p, cfg, 'trigCreate');
  const bp = backup.path;
  if (!backup.ok) return sendJSON(res, 500, { error: '数据库备份失败，已中止创建触发器: ' + backup.error, backupPath: bp, backupOk: false });
  const triggerTx = new sql.Transaction(p);
  try {
    await triggerTx.begin();
    await new sql.Request(triggerTx).query(dropSql);
    await new sql.Request(triggerTx).query(trigSql);
    const v = await new sql.Request(triggerTx).input('n', sql.NVarChar, trgName).query("SELECT OBJECT_ID(@n,'TR') AS id");
    if (!v.recordset[0] || !v.recordset[0].id) throw new Error('触发器创建后未找到 ' + trgName);
    await triggerTx.commit();
  } catch (e) {
    try { await triggerTx.rollback(); } catch (_) {}
    return sendJSON(res, 500, { error: '创建触发器失败（原触发器已保留）: ' + e.message, backupPath: bp, backupOk: backup.ok });
  }
  // 创建后复核：必须能在当前账套里找到该触发器
  let verified = false, verifyDb = dbNow;
  try {
    const v = await p.request().input('n', sql.NVarChar, trgName).query("SELECT OBJECT_ID(@n,'TR') AS id, DB_NAME() AS db");
    const row = v.recordset[0] || {};
    verified = !!row.id; verifyDb = row.db || dbNow;
  } catch (e) { dbg('[trigCreate] 复核失败: ' + e.message); }
  if (!verified) {
    return sendJSON(res, 500, { error: '触发器创建后未在数据库 ' + (verifyDb || cfg.database) + ' 中找到，请检查当前连接的账套', database: verifyDb });
  }
  // 让工具触发器在 INSERT 事件中排最后：ERP 保存触发先执行，工具只补仍然为空的列。
  let orderSet = false;
  try {
    if (await canSetTriggerLast(p, onTable, trgName)) {
      await p.request().query("EXEC sp_settriggerorder @triggername = N'" + String(trgName).replace(/'/g, "''") + "', @order = 'Last', @stmttype = 'INSERT'");
      orderSet = true;
    } else { dbg('[trigCreate] ERP 已有 Last INSERT 触发器，保留原顺序'); }
  } catch (e) { dbg('[trigCreate] set trigger order failed: ' + e.message); }
  sendJSON(res, 200, { ok: true, backupPath: bp, backupOk: backup.ok, removedOldBackups: backup.cleanup.removed, name: trgName, database: verifyDb, server: cfg.server, verified: true, orderLast: orderSet });
}

async function trigToggle(req, res) {
  const b = JSON.parse(await readBody(req));
  if (!b.trgName) return sendJSON(res, 400, { error: '缺少 trgName' });
  const p = await ensurePoolDb((CUR_CONFIG || CONFIG.db).database);
  const tblRow = await p.request().input('n', sql.NVarChar, b.trgName).query("SELECT OBJECT_NAME(parent_id) AS tbl FROM sys.triggers WHERE name=@n");
  const tbl = tblRow.recordset[0] ? tblRow.recordset[0].tbl : null;
  if (!tbl) return sendJSON(res, 404, { error: '触发器 ' + b.trgName + ' 不存在或无法找到所属表' });
  const op = b.enable ? 'ENABLE' : 'DISABLE';
  await p.request().query(op + ' TRIGGER [dbo].[' + b.trgName + '] ON [dbo].[' + tbl + ']');
  sendJSON(res, 200, { ok: true, enabled: !!b.enable });
}

async function trigDrop(req, res) {
  const b = JSON.parse(await readBody(req)); if (!b.trgName) return sendJSON(res, 400, { error: '缺少 trgName' });
  const p = await ensurePoolDb((CUR_CONFIG || CONFIG.db).database);
  if (!b.confirm) return sendJSON(res, 200, { preview: true, dropSql: 'DROP TRIGGER [dbo].[' + b.trgName + '];' });
  const defRow = (await p.request().input('n', sql.NVarChar, b.trgName).query(
    "SELECT m.definition sql FROM sys.triggers o JOIN sys.sql_modules m ON m.object_id=o.object_id WHERE o.name=@n"
  )).recordset[0];
  if (!defRow) return sendJSON(res, 404, { error: '触发器 ' + b.trgName + ' 不存在' });
  if (!/UPDATE\s+b\s+SET\s+b\./i.test(String(defRow.sql || '')) && !b.force) {
    return sendJSON(res, 403, { error: '这不是本工具建立的触发器，已拒绝删除；如确认要删除 ERP 触发器，请显式传 force=true。' });
  }
  const cfg = CUR_CONFIG || CONFIG.db;
  const backup = await backupDatabaseWithCleanup(p, cfg, 'trigDrop');
  const bp = backup.path;
  if (!backup.ok) return sendJSON(res, 500, { error: '数据库备份失败，已中止删除触发器: ' + backup.error, backupPath: bp, backupOk: false });
  await p.request().query("IF OBJECT_ID(N'" + b.trgName + "','TR') IS NOT NULL DROP TRIGGER [dbo].[" + b.trgName + "]");
  sendJSON(res, 200, { ok: true, backupPath: bp, backupOk: backup.ok, removedOldBackups: backup.cleanup.removed });
}

// 生成标准 config.js 内容（首次运行 / 保存配置都用它）
function writeConfigFile(cfgPath, db, backupDir, httpPort) {
  const text = ['// 数据库连接配置。可在工具界面的「数据库连接」区修改并保存，',
    '// 也可手动编辑本文件后重启工具。',
    'module.exports = {',
    '  db: {',
    '    server: ' + JSON.stringify(db.server || '') + ',',
    '    user: ' + JSON.stringify(db.user || 'sa') + ',',
    '    password: ' + JSON.stringify(db.password || '') + ',',
    '    database: ' + JSON.stringify(db.database || 'DSB') + ',',
    '    options: { encrypt: false, trustServerCertificate: true, instanceName: ' + JSON.stringify((db.options && db.options.instanceName) || null) + ' }',
    '  },',
    '  backupDir: ' + JSON.stringify(backupDir || 'D:\\TPA\\SQL2008') + ',',
    '  httpPort: ' + (httpPort || 8787),
    '};'].join('\n') + '\n';
  try { fs.writeFileSync(cfgPath, text, 'utf8'); fs.chmodSync(cfgPath, 0o666); } catch (_) { fs.writeFileSync(cfgPath, text, 'utf8'); }
}


// 只读返回当前连接配置（供前端启动时回填，即使 /api/meta 连不上也能拿到 server）
function handleConfig(req, res) {
  const c = CUR_CONFIG || CONFIG.db;
  sendJSON(res, 200, {
    server: c.server || '', user: c.user || '',
    password: c.password || '', database: c.database || '',
    // 当前生效的备份目录（首次弹窗/保存配置写入 config.js 后即为真实值）
    backupDir: CONFIG.backupDir || ''
  });
}
// 备份路径：GET 返回当前值；POST 不传 dir 时弹出原生目录选择框
const FIRST_OPEN_FLAG = () => path.join(BASE_DIR, 'first_open.flag');

// 首次打开标记：跟着配置目录走（便携版=exe 旁，安装版=用户数据目录）
async function handleFirstOpen(req, res) {
  if (req.method === 'GET') {
    return sendJSON(res, 200, { ok: true, seen: fs.existsSync(FIRST_OPEN_FLAG()) });
  }
  try {
    fs.writeFileSync(FIRST_OPEN_FLAG(), new Date().toISOString(), 'utf8');
    sendJSON(res, 200, { ok: true });
  } catch (e) {
    sendJSON(res, 500, { error: '写入首次打开标记失败: ' + e.message });
  }
}

async function handleBackupDir(req, res) {
  if (req.method === 'GET') {
    return sendJSON(res, 200, { ok: true, backupDir: CONFIG.backupDir || '' });
  }
  let body = {};
  try { body = JSON.parse((await readBody(req)) || '{}') || {}; } catch (_) { body = {}; }
  let dir = String(body.dir || '').trim();
  if (!dir) {
    let electron = null;
    try { electron = require('electron'); } catch (_) {}
    if (!electron || !electron.dialog) {
      return sendJSON(res, 400, { error: '当前运行方式不支持目录选择框' });
    }
    let win = null;
    try { win = electron.BrowserWindow.getFocusedWindow(); } catch (_) {}
    const opts = { title: '选择数据库备份目录', properties: ['openDirectory', 'createDirectory'] };
    const r = win ? await electron.dialog.showOpenDialog(win, opts) : await electron.dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths || !r.filePaths[0]) {
      return sendJSON(res, 200, { ok: true, canceled: true, backupDir: CONFIG.backupDir || '' });
    }
    dir = r.filePaths[0];
  }
  try {
    const cfg = CUR_CONFIG || CONFIG.db;
    writeConfigFile(path.join(BASE_DIR, 'config.js'), cfg, dir, CONFIG.httpPort);
    CONFIG.backupDir = dir;
    if (CUR_CONFIG) CUR_CONFIG.backupDir = dir;
    sendJSON(res, 200, { ok: true, backupDir: dir });
  } catch (e) {
    sendJSON(res, 500, { error: '保存备份路径失败: ' + e.message });
  }
}

async function handleSaveConfig(req, res) {
  const b = JSON.parse(await readBody(req));
  const { server, user, password, database } = b;
  if (!server || !user) return sendJSON(res, 400, { error: '缺少 server 或 user' });
  try {
    const cfgPath = path.join(BASE_DIR, 'config.js');
    // 整体重写 config.js（不再用正则替换，避免格式差异导致改不动）
    writeConfigFile(cfgPath, {
      server, user,
      password: password || '',
      database: database || (CUR_CONFIG ? CUR_CONFIG.database : CONFIG.db.database),
      options: (CUR_CONFIG && CUR_CONFIG.options) || CONFIG.db.options
    },
    (CUR_CONFIG && CUR_CONFIG.backupDir) || CONFIG.backupDir,
    CONFIG.httpPort
    );
    CONFIG.db.server = server; CONFIG.db.user = user; CONFIG.db.password = password || '';
    if (database) CONFIG.db.database = database;
    if (CUR_CONFIG) { CUR_CONFIG.server = server; CUR_CONFIG.user = user; CUR_CONFIG.password = password || ''; if (database) CUR_CONFIG.database = database; }
    // 保存后立即按新配置重连：不能只改配置对象，否则会出现“配置是 DSB、连接池还是 XBK”
    try {
      await switchPool(makeConnConfig({ database: database || CONFIG.db.database }));
    } catch (re) {
      return sendJSON(res, 500, { error: '配置已保存，但按新配置重连失败: ' + re.message });
    }
    const actualDb = await poolDbName(await getPool());
    if (database && actualDb && actualDb.toLowerCase() !== String(database).toLowerCase()) {
      return sendJSON(res, 500, { error: '配置已保存，但实际连接=' + actualDb + '，目标=' + database });
    }
    sendJSON(res, 200, { ok: true, database: actualDb || database || CONFIG.db.database });
    // 按服务器记忆偏好账套：prefs[server] = {user, pass, db}，只在点「保存配置」时写入
    try {
      const f = CREDS_FILE();
      let exist = {}; if (fs.existsSync(f)) { try { exist = JSON.parse(fs.readFileSync(f, 'utf8')) || {}; } catch (_) {} }
      exist.prefs = exist.prefs || {};
      exist.prefs[server] = { user: user || '', pass: password || '', db: database || '' };
      exist._lastServer = server;
      const dir = path.dirname(f); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(f, JSON.stringify(exist, null, 2));
    } catch (_) {}
  } catch (e) { sendJSON(res, 500, { error: '保存失败: ' + e.message }); }
}

// 持久化凭据记忆：{server → {user, pass}}。固定存到用户配置目录，不跟随备份目录，
// 避免备份目录指向共享盘/公共目录时，把服务器账号密码一起暴露出去。
function credsFileInUserDir() {
  const appData = process.env.APPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Roaming') : '');
  return appData ? path.join(appData, 'Momo传值助手', 'creds.json') : path.join(BASE_DIR, 'creds.json');
}
function credsFileLegacy() {
  return path.join((CUR_CONFIG && CUR_CONFIG.backupDir) || CONFIG.backupDir || 'D:\\TPA\\SQL2008', 'creds.json');
}
// 旧版本把 creds.json 写在备份目录。首次访问时迁到用户目录，并删除旧文件（含明文密码）。
function migrateLegacyCreds() {
  const next = credsFileInUserDir();
  try {
    if (fs.existsSync(next)) return next;
    const old = credsFileLegacy();
    if (!old || old === next || !fs.existsSync(old)) return next;
    fs.mkdirSync(path.dirname(next), { recursive: true });
    try { fs.renameSync(old, next); }
    catch (_) { fs.copyFileSync(old, next); try { fs.unlinkSync(old); } catch (_) {} }
    dbg('[creds] migrated from ' + old + ' to ' + next);
    return next;
  } catch (e) {
    dbg('[creds] migrate failed: ' + e.message);
    return next;
  }
}
const CREDS_FILE = () => migrateLegacyCreds();

async function handleGetCreds(req, res) {
  try {
    const f = CREDS_FILE();
    let m = {};
    if (fs.existsSync(f)) { try { m = JSON.parse(fs.readFileSync(f, 'utf8')) || {}; } catch (_) {} }
    sendJSON(res, 200, { ok: true, data: m });
  } catch (e) { sendJSON(res, 200, { ok: true, data: {} }); }
}

async function handleSaveCreds(req, res) {
  const b = JSON.parse(await readBody(req));
  const m = b || {};
  try {
    const f = CREDS_FILE();
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // 合并已有内容
    let exist = {};
    if (fs.existsSync(f)) { try { exist = JSON.parse(fs.readFileSync(f, 'utf8')) || {}; } catch (_) {} }
    const merged = Object.assign({}, exist, m);
    // 额外记一份 '_last'（最近一次保存的账号密码，供界面启动时自动回填）
    const firstKey = Object.keys(m).filter(k=>k!=='_last')[0];
    if(firstKey){ merged._last = m[firstKey]; }
    fs.writeFileSync(f, JSON.stringify(merged, null, 2), 'utf8');
    sendJSON(res, 200, { ok: true });
  } catch (e) { sendJSON(res, 500, { error: '保存凭据失败: ' + e.message }); }
}


// 永久删除某台服务器的凭据记忆（磁盘 creds.json + 若该 key 是 _last 来源则一并清 _last）
async function handleDropCred(req, res) {
  const b = JSON.parse(await readBody(req));
  const key = String((b && b.key) || '').trim();
  if (!key) return sendJSON(res, 400, { error: '缺少 key' });
  try {
    const f = CREDS_FILE();
    let exist = {};
    if (fs.existsSync(f)) { try { exist = JSON.parse(fs.readFileSync(f, 'utf8')) || {}; } catch (_) {} }
    delete exist[key];
    // 若 _last 指向的就是被删项，则清掉 _last（避免自动带出已删项）
    if (exist._last && exist._last.user === (exist[key]||{}).user) { /* 已删，标记 */ }
    if (Object.keys(exist).length === 0 || !exist._last) { /* _last 保留其它仍有效项 */ }
    // 重新计算 _last：若还存在其它 key，取第一个；否则删 _last
    const remainKeys = Object.keys(exist).filter(k => k !== '_last');
    if (remainKeys.length === 0) delete exist._last;
    else { /* 保留现有 _last，若它是被删的则换成剩余第一项 */
      const stillValid = exist._last && remainKeys.some(k => true);
      if (!stillValid) exist._last = exist[remainKeys[0]];
    }
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f, JSON.stringify(exist, null, 2), 'utf8');
    sendJSON(res, 200, { ok: true, remaining: remainKeys });
  } catch (e) { sendJSON(res, 500, { error: '删除失败: ' + e.message }); }
}


const router = {
  '/api/meta': handleMeta,
  '/api/run': handleRun,
  '/api/clear-target': handleClearTarget,
  '/api/databases': handleDatabases,
  '/api/switch-db': handleSwitchDb,
  '/api/test-conn': handleTestConn,
  '/api/triggers': trigList,
  '/api/triggers/build': trigBuild,
  '/api/triggers/create': trigCreate,
  '/api/triggers/toggle': trigToggle,
  '/api/triggers/drop': trigDrop,
  '/api/config': handleConfig,
  '/api/save-config': handleSaveConfig,
  '/api/backup-dir': handleBackupDir,
  '/api/first-open': handleFirstOpen,
  '/api/chains': handleChains,
  '/api/field-dicts': handleFieldDicts,
  '/api/chains/path': handleChainPath,
  '/api/chains/preview': handleChainPreview,
  '/api/chains/paths': handleChainPaths,
  '/api/creds': handleGetCreds,
  '/api/creds/save': handleSaveCreds,
  '/api/creds/drop': handleDropCred
};

// ====== HTTP 服务 ======
let server = null;

function handleRequest(req, res) {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname.startsWith('/api/')) {
    const fn = router[u.pathname];
    if (!fn) return sendJSON(res, 404, { error: 'not found' });
    (async () => {
      try { await fn(req, res); }
      catch (e) {
        dbg('[route] ' + u.pathname + ' error: ' + e.message);
        if (!res.headersSent) sendJSON(res, 500, { error: e.message });
        else { try { res.end(); } catch (_) {} }
      }
    })();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  try {
    // 优先用内联页面（exe 打包模式，无外部文件依赖）
    res.end(PUBLIC_HTML);
  } catch (e4) {
    res.writeHead(500, {'Content-Type':'text/plain; charset=utf-8'});
    res.end('读取界面文件失败: ' + e4.message);
  }
}

// ====== 启动应用窗口（Edge → Chrome → 系统默认浏览器，不硬依赖 Edge） ======
function openEdgeApp() {
  
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chrome32Path = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
  let launched = false;

  const tryBrowser = (browserPath, label) => {
    if (!fs.existsSync(browserPath)) return false;
    const args = [
      '--app=' + APP_URL,
      '--window-size=1200,800',
      '--disable-features=Translate',
      '--no-first-run',
      '--no-default-browser-check'
    ];
    if (browserPath.toLowerCase().includes('edge')) {
      args.push('--user-data-dir=' + path.join(BASE_DIR, '.edge-profile'));
    }
    const proc = spawn(browserPath, args, { detached: true, stdio: 'ignore', windowsHide: false });
    proc.unref();
    console.log('[传值工具] 已用 ' + label + ' 打开应用窗口');
    // Poll: exit when window closes (server no longer reachable from browser)
    const pollInterval = setInterval(async () => {
      try {
        const alive = await new Promise((resolve) => {
          http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 1000 }, (resp) => {
            resp.resume(); resolve(true);
          }).on('error', () => resolve(false)).on('timeout', function(){ this.destroy(); resolve(false); });
        });
        if (!alive) {
          clearInterval(pollInterval);
          console.log('[传值工具] 窗口已关闭，正在退出...');
          setTimeout(() => process.exit(0), 1000);
        }
      } catch (e) {}
    }, 3000);
    pollInterval.unref && pollInterval.unref();
    return true;
  };

  // 优先级：Edge → Chrome(64) → Chrome(32) → 系统默认
  if (!tryBrowser(edgePath, 'Edge')) {
    if (!tryBrowser(chromePath, 'Chrome')) {
      if (!tryBrowser(chrome32Path, 'Chrome(32位)')) {
        const { exec } = require('child_process');
        exec('start "" "' + APP_URL + '"');
        console.log('[传值工具] 已用系统默认浏览器打开 ' + APP_URL);
        launched = true;
      } else { launched = true; }
    } else { launched = true; }
  } else { launched = true; }

  if (!launched) console.log('[传值工具] 未找到浏览器，请手动打开 ' + APP_URL);
}

process.on('unhandledRejection', (e) => {
  dbg('[unhandledRejection] ' + (e && e.message));
  console.error('[unhandledRejection]', e && e.message);
  if (e && /Connection|ECONNCLOSED|ECONNRESET/i.test(e.message || '')) markBroken();
});

// 启动时若端口被占用，自动尝试 8788~8797；成功监听后把实际端口写入 port.txt 供 Electron 主进程读取
function tryListen(port, tries) {
  return new Promise((resolve, reject) => {
    // 每次尝试新建 server，避免上一次监听失败后残留监听器
    const s = http.createServer(handleRequest);
    server = s;
    // 只监听本机回环地址，避免局域网其他机器访问带数据库权限的接口
    s.listen(port, '127.0.0.1', () => {
      const actualPort = s.address().port;
      try { fs.writeFileSync(require('path').join(BASE_DIR, 'port.txt'), String(actualPort)); } catch (_) {}
      console.log('[传值工具 应用版] http://localhost:' + actualPort);
      resolve(actualPort);
    });
    s.once('error', async (e) => {
      try { s.close(); } catch (_) {}
      if (e.code === 'EADDRINUSE' && tries > 1) {
        console.log('[端口 ' + port + ' 被占用，尝试 ' + (port + 1) + ']');
        try { resolve(await tryListen(port + 1, tries - 1)); } catch (err) { reject(err); }
      } else {
        reject(e);
      }
    });
  });
}

(async () => {
  let actualPort;
  try { actualPort = await tryListen(PORT, 10); }
  catch (e) {
    console.error('[启动失败] 无法监听端口 ' + PORT + '~' + (PORT + 9) + ': ' + e.message);
    if (!process.env.CHZ_ELECTRON) { process.exit(1); }
    else {
      try {
        const electron = require('electron');
        electron.dialog.showErrorBox('端口冲突', '端口 ' + PORT + ' 被占用，请关闭旧的传值工具进程后重试。\n\n错误: ' + e.message);
      } catch (_) {}
      setTimeout(() => process.exit(1), 4000);
      return;
    }
  }
  try {
    await getPool();
    console.log('[数据库] 已连接 ' + (CUR_CONFIG || CONFIG.db).server + ' / ' + (CUR_CONFIG || CONFIG.db).database);
    dbg('[boot] connected ' + (CUR_CONFIG || CONFIG.db).database);
  } catch (e) {
    console.warn('[数据库] 连接失败: ' + e.message + '（打开界面后可点测试连接重试）');
    dbg('[boot] conn failed: ' + e.message);
  }
  if (!process.env.CHZ_ELECTRON && !process.argv.includes('--no-browser')) {
    setTimeout(openEdgeApp, 500);
  } else {
    console.log('[传值工具] 后端就绪，等待前端窗口连接 http://localhost:' + actualPort);
  }
})();

// Ctrl+C 或窗口关闭时清理
process.on('SIGINT', () => { try { server.close(); } catch (_) {} process.exit(0); });
process.on('SIGTERM', () => { try { server.close(); } catch (_) {} process.exit(0); });
