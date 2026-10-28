// 只读全链路审计：品号关联列 + 链路 SQL 执行。
// 用法：node tools/audit-all.js <server> <user> <password> <database>
// 不写业务数据；任何 SQL 错误或关联列错配都会返回非 0。
'use strict';

const path = require('path');
const Module = require('module');
const origLoad = Module._load;
const esmStub = new Proxy(function () { return esmStub; }, {
  get(t, p) { if (p === 'then') return undefined; if (p === 'default') return esmStub; return esmStub; },
  apply() { return esmStub; }, construct() { return esmStub; }, has() { return true; }
});
Module._load = function (req, parent, isMain) {
  if (typeof req === 'string' && (req.indexOf('@typespec/ts-http-runtime') === 0 || req.indexOf('@azure-rest/core-client') === 0)) return esmStub;
  return origLoad.call(this, req, parent, isMain);
};

const srcDir = path.join(__dirname, '..', 'source');
const sql = require(path.join(srcDir, 'node_modules', 'mssql'));
const makeSqlgen = require(path.join(srcDir, 'src', 'sqlgen.js'));
const chain = require(path.join(srcDir, 'src', 'chain.js'));

const [server, user, password, database] = process.argv.slice(2);
if (!server || !user || !database) {
  console.error('用法: node tools/audit-all.js <server> <user> <password> <database>');
  process.exit(2);
}
const CFG = { server, user, password: password || '', database, options: { encrypt: false, trustServerCertificate: true }, connectionTimeout: 8000, requestTimeout: 60000 };

(async () => {
  const pool = await new sql.ConnectionPool(CFG).connect();
  const g = makeSqlgen(sql);
  const docs = await g.scanDocs(pool);
  const reg = await chain.buildRegistry(pool);

  const meta = (await pool.request().query(`
    SELECT t.name tbl, c.name col, c.column_id cid, ty.name typ, CONVERT(nvarchar(120),ep.value) d,
           SUM(p.rows) n
    FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id
    JOIN sys.types ty ON ty.user_type_id=c.user_type_id
    LEFT JOIN sys.extended_properties ep ON ep.major_id=c.object_id AND ep.minor_id=c.column_id AND ep.name=N'MS_Description'
    JOIN sys.partitions p ON p.object_id=t.object_id AND p.index_id IN (0,1)
    WHERE t.is_ms_shipped=0 AND c.column_id <= 30
    GROUP BY t.name, c.name, c.column_id, ty.name, ep.value ORDER BY t.name, c.column_id`)).recordset;
  const byTbl = {}, textCol = {};
  for (const c of meta) {
    (byTbl[c.tbl] = byTbl[c.tbl] || []).push(c);
    if (!textCol[c.tbl] && ['varchar', 'nvarchar', 'char', 'nchar'].includes(c.typ) && c.cid > 3 && !/90[1245]$/.test(c.col)) textCol[c.tbl] = c.col;
  }

  let itemMismatch = 0, itemTested = 0;
  for (const doc of docs) {
    const cols = byTbl[doc.sub] || [];
    if (!cols.length || Number(cols[0].n) <= 0) continue;
    const items = cols.filter(c => ['品号', '主件品号', '子件品号', '商品', '产品品号', '需求品号'].includes(String(c.d || '').trim()));
    if (!items.length) continue;
    itemTested++;
    const cnt = async (col) => (await pool.request().query(`SELECT COUNT(*) n FROM [dbo].[${doc.sub}] b JOIN [dbo].[JSKLOA] s ON s.LOA001=b.[${col}]`)).recordset[0].n;
    if (Number(await cnt(doc.keyCol)) > 0) continue;
    for (const it of items) {
      if (it.col === doc.keyCol) continue;
      if (Number(await cnt(it.col)) > 0) { itemMismatch++; console.log(`[关联列] ${doc.sub} key=${doc.keyCol} 应为 ${it.col}(${it.d})`); break; }
    }
  }

  let errors = 0, zeros = 0, ok = 0;
  for (const l of reg.links) {
    if (l.status === 'ambiguous') continue;
    const p = chain.findPath(reg, l.from, l.to);
    const tc = textCol[l.from], sc = textCol[l.to];
    if (!p || !tc || !sc) continue;
    try {
      const b = g.buildChainSQL(l.from, tc, sc, 'fill', true, p, reg.docs);
      const n = Number((await pool.request().query(b.cntSql)).recordset[0].n);
      if (n > 0) ok++; else zeros++;
    } catch (e) { errors++; console.log(`[链路错误] ${l.from}->${l.to}: ${e.message}`); }
  }

  console.log(`\n摘要: 品号关联测试 ${itemTested}，错配 ${itemMismatch}；链路 通过 ${ok} / 零行 ${zeros} / 错误 ${errors}`);
  await pool.close();
  process.exit(itemMismatch || errors ? 1 : 0);
})().catch(e => { console.error('FATAL: ' + e.message); process.exit(1); });
