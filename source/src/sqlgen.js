// sqlgen.js - SQL scanner + builder for 传值工具 应用版.
// Extracted from the legacy tools/server.js, made standalone:
//   const sqlgen = require('./src/sqlgen')(sql);   // sql = the mssql module
//   sqlgen.scanDocs(pool), sqlgen.scanSrcs(pool)   // dynamic DB scan
//   sqlgen.buildSQL(docId, tgtCol, srcId, srcValCol, partyKey, mode, force, chain, {docs, srcs})
'use strict';

module.exports = function makeSqlgen(sql) {

  const PARTY_HINT = { supplier: '供应商', customer: '客户' };

  // 单号列与序号列可能是同一列（信息档常见），ORDER BY 去重，避免 SQL Server 报“列重复”。
  function orderBy(showNo, noCol) {
    const cols = [...new Set([showNo, noCol].filter(Boolean))];
    return cols.map(c => 'b.[' + c + ']').join(', ');
  }

  function guessParty(mainDesc) {
    if (!mainDesc) return 'none';
    if (/供应商|请购|采购|进货|收料|借入/.test(mainDesc)) return 'supplier';
    if (/客户|销售|销货|借出|报价|订单/.test(mainDesc)) return 'customer';
    return 'none';
  }

  // 第4/5列里找 供应商编号/客户编号 列
  async function findPartyCol(p, mainTbl) {
    try {
      const r = await p.request()
        .input('t', sql.NVARCHAR, mainTbl)
        .query("SELECT c.name AS col, CONVERT(varchar(60),s.value) AS [desc] FROM sys.columns c JOIN sys.tables t ON c.object_id=t.object_id LEFT JOIN sys.extended_properties s ON s.major_id=t.object_id AND s.minor_id=c.column_id AND s.name=N'MS_Description' WHERE t.name=@t AND c.column_id IN (4,5,6,7) ORDER BY c.column_id");
      for (const row of r.recordset) {
        const d = row.desc || '';
        if (d === '供应商' || d === '供应商编号') return { col: row.col, party: 'supplier' };
        if (d === '客户' || d === '客户编号' || d === '请款客户') return { col: row.col, party: 'customer' };
      }
    } catch (e) {}
    return null;
  }

  async function scanDocs(p) {
    // 个别“信息档”的第 3 列不是品号（如 SGMRFD 第 3 列是委外单号），
    // 这里显式指定关联列，避免默认按第 3 列 JOIN 取不到库存。
    const DOC_REF_OVERRIDES = { SGMRFD: 'RFD007' };    // 1. One batched query: all user tables with a description, plus their
    //    col1 / col3 names, and main-table description.
    const base = await p.request().query(
      "SELECT t.name AS subTbl, CONVERT(varchar(120),s0.value) AS subDesc, " +
      "c1.name AS noCol, c3.name AS itemCol, " +
      "CONVERT(varchar(120),sm.value) AS mainDesc " +
      "FROM sys.tables t " +
      "JOIN sys.columns c1 ON c1.object_id=t.object_id AND c1.column_id=1 " +
      "LEFT JOIN sys.columns c3 ON c3.object_id=t.object_id AND c3.column_id=3 " +
      "LEFT JOIN sys.extended_properties s0 ON s0.major_id=t.object_id AND s0.minor_id=0 AND s0.name=N'MS_Description' " +
      "LEFT JOIN sys.tables tm ON tm.name = SUBSTRING(t.name,1,4) + 'A' " +
      "LEFT JOIN sys.extended_properties sm ON sm.major_id=tm.object_id AND sm.minor_id=0 AND sm.name=N'MS_Description' " +
      "WHERE t.name NOT IN (N'dtproperties', N'LSMD_T') AND s0.value IS NOT NULL " +
      "ORDER BY t.name"
    );
    // 2. One batched query: every column (id 1..29 + 4..7) description for all
    //    candidate sub-tables AND their main tables, in a single round-trip.
    const subNames = base.recordset.map(r => r.subTbl);
    const mainNames = subNames.map(n => n.replace(/B$/, 'A'));
    const allNames = Array.from(new Set([...subNames, ...mainNames]));
    const inList = allNames.map((n, i) => '@n' + i).join(',');
    const req = p.request();
    allNames.forEach((n, i) => req.input('n' + i, sql.NVarChar, n));
    const colsRes = await req.query(
      "SELECT t.name AS tbl, c.column_id AS cid, c.name AS col, CONVERT(varchar(120),s.value) AS d " +
      "FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id " +
      "LEFT JOIN sys.extended_properties s ON s.major_id=t.object_id AND s.minor_id=c.column_id AND s.name=N'MS_Description' " +
      "WHERE t.name IN (" + inList + ") AND c.column_id <= 30 " +
      "ORDER BY t.name, c.column_id"
    );
    // Group columns by table
    const byTbl = {};
    for (const row of colsRes.recordset) {
      (byTbl[row.tbl] = byTbl[row.tbl] || []).push(row);
    }
    const docs = [];
    for (const row of base.recordset) {
      const sub = row.subTbl;
      const pfx = sub.slice(3, 6);
      const mainGuess = sub.replace(/B$/, 'A');
      const mainKeyCol = mainGuess.slice(3, 6) + '001';
      const cols = byTbl[sub] || [];
      const mainCols = byTbl[mainGuess] || [];
      // pick pref / seq / colNo / colSeq from col 10-29
      let prefCol = null, seqCol = null, colNo = null, colSeq = null;
      for (const rr of cols) {
        const dd = rr.d || '';
        if (rr.cid >= 10 && rr.cid <= 29) {
          if ((dd.includes('前置单号') || dd.includes('工单单号') || dd === '单号') && !prefCol) prefCol = rr.col;
          if ((dd === '序号' || dd === '工单序号') && rr.col !== (pfx + '002') && !seqCol) seqCol = rr.col;
        }
        if (rr.cid <= 3) {
          const dd2 = rr.d || '';
          if (dd2.includes('单号') && !colNo) colNo = rr.col;
          if ((dd2 === '序号' || dd2 === '工单序号') && rr.cid !== 1 && !colSeq) colSeq = rr.col;
        }
      }
      // find party col from main table cols 4-7
      let party = 'none', partyCol = null;
      for (const rr of mainCols) {
        const d = rr.d || '';
        if (rr.cid >= 4 && rr.cid <= 7) {
          if (d === '供应商' || d === '供应商编号') { party = 'supplier'; partyCol = rr.col; break; }
          if (d === '客户' || d === '客户编号' || d === '请款客户') { party = 'customer'; partyCol = rr.col; break; }
        }
      }
      // 关联列默认取第 3 列，但信息档/检验单/头档的第 3 列常是序号、日期、单号、仓库。
      // 全库规则：只要表内存在明确的品号列，就用品号列作为“按品号取值”的关联列。
      const col3Desc = ((cols.find(c => c.cid === 3) || {}).d || '').trim();
      let keyCol = row.itemCol || (pfx + '003');
      for (const want of ['品号', '子件品号', '主件品号', '商品', '产品品号', '需求品号']) {
        const hit = cols.find(c => c.cid >= 1 && c.cid <= 20 && String(c.d || '').trim() === want);
        if (hit) { keyCol = hit.col; break; }
      }
      docs.push({
        id: sub,
        name: sub + ' ' + ((row.subDesc || row.mainDesc || '').trim()),
        main: mainGuess, mainKeyCol, sub,
        keyCol,
        refCol: DOC_REF_OVERRIDES[sub] || null,
        info: /信息档/.test(String(row.subDesc || '')),
        party, partyCol,
        prefCol, seqCol, colNo, colSeq
      });
    }
    return docs;
  }

  async function scanSrcs(p) {
    const r = await p.request().query(
      "SELECT t.name AS srcTbl, CONVERT(varchar(120),s0.value) AS srcDesc, c1.name AS c1Name, CONVERT(varchar(60),s1.value) AS c1Desc, c2.name AS c2Name, CONVERT(varchar(60),s2.value) AS c2Desc, c3.name AS c3Name, CONVERT(varchar(60),s3.value) AS c3Desc " +
      "FROM sys.tables t " +
      "JOIN sys.columns c1 ON c1.object_id=t.object_id AND c1.column_id=1 " +
      "LEFT JOIN sys.columns c2 ON c2.object_id=t.object_id AND c2.column_id=2 " +
      "LEFT JOIN sys.columns c3 ON c3.object_id=t.object_id AND c3.column_id=3 " +
      "LEFT JOIN sys.extended_properties s0 ON s0.major_id=t.object_id AND s0.minor_id=0 AND s0.name=N'MS_Description' " +
      "LEFT JOIN sys.extended_properties s1 ON s1.major_id=t.object_id AND s1.minor_id=c1.column_id AND s1.name=N'MS_Description' " +
      "LEFT JOIN sys.extended_properties s2 ON s2.major_id=t.object_id AND s2.minor_id=c2.column_id AND s2.name=N'MS_Description' " +
      "LEFT JOIN sys.extended_properties s3 ON s3.major_id=t.object_id AND s3.minor_id=c3.column_id AND s3.name=N'MS_Description' " +
      "WHERE t.name NOT IN (N'dtproperties', N'LSMD_T') AND s0.value IS NOT NULL " +
      "ORDER BY t.name");
    const srcs = [];
    for (const row of r.recordset) {
      const tbl = row.srcTbl;
      const c1d = row.c1Desc || '', c2d = row.c2Desc || '', c3d = row.c3Desc || '';
      let keyCol, keyDesc;
      if (c1d.includes("品号")) { keyCol = row.c1Name; keyDesc = c1d; }
      else if (c3d.includes("品号") || c3d.includes("商品")) { keyCol = row.c3Name; keyDesc = c3d; }
      else if (c2d.includes("品号")) { keyCol = row.c2Name; keyDesc = c2d; }
      else { keyCol = row.c1Name; keyDesc = c1d; }
      let party;
      if (c1d.includes("供应商") || c2d.includes("供应商") || c3d.includes("供应商") || tbl === 'TPADEG' || tbl === 'TPADGA') party = 'supplier';
      else if (c1d.includes("客户") || c2d.includes("客户") || c3d.includes("客户") || tbl === 'TPADEF' || tbl === 'TPADFA') party = 'customer';
      else party = 'item';
      const isSeqKey = (c1d.includes("单号") && c2d.includes("序号"));
      srcs.push({
        id: tbl,
        name: tbl + ' ' + (row.srcDesc || '').trim(),
        info: /信息档/.test(String(row.srcDesc || '')),
        party,
        key: [keyCol],
        keyDesc,
        seqKey: isSeqKey ? [row.c1Name, row.c2Name] : null,
        partyKeyCol: party !== 'item' ? row.c2Name : null,
        valDefault: null, valCol: null, vals: {}
      });
    }
    return srcs;
  }

  // ===== 方案A：业务编号键通道白名单（后台自动，前台无感）=====
  // 物料发放工单没有前置订单/工单，只能靠"计划编号"关联 计划单据来源档 SGMRIB
  // key: docId_srcId → 追加的通道（优先级高于默认键）
  const BIZ_KEY_CHANNELS = {
    // ===== 进货单(头/身) <- 采购单(头/身)/采购底稿(头/身)：统一解析采购源头 =====
    // 进货行 -> 检验单 QMSMFB(MFB001/002) -> 收料单 JSKJCB(MFB005/006)
    //        -> 采购单号/序号 = JCB010/JCB011；取不到时（免检）= JDB014/JDB015
    // 再按来源类型关联：采购单头 HDA001 / 采购单身 HDB001+002 /
    //                 采购底稿头 HCA001 / 采购底稿单身 HCB001+002（经采购单 HDB016+017 转接）
    'JSKJDA_DCSHDA': [ { name: '进货单关联采购源头', joins: [] } ],
    'JSKJDA_DCSHDB': [ { name: '进货单关联采购源头', joins: [] } ],
    'JSKJDA_DCSHCA': [ { name: '进货单关联采购源头', joins: [] } ],
    'JSKJDA_DCSHCB': [ { name: '进货单关联采购源头', joins: [] } ],
    'JSKJDB_DCSHDA': [ { name: '进货单关联采购源头', joins: [] } ],
    'JSKJDB_DCSHDB': [ { name: '进货单关联采购源头', joins: [] } ],
    'JSKJDB_DCSHCA': [ { name: '进货单关联采购源头', joins: [] } ],
    'JSKJDB_DCSHCB': [ { name: '进货单关联采购源头', joins: [] } ],

    // ===== 工单单头 SGMRAA <- 订单单头 DCSIBA：前置优先，无前置自动走需求计划（单条SQL自动分流）=====
    // 有前置订单(RAA011) -> 直接取前置订单 DCSIBA.IBA001
    // 无前置订单(RAA011为空, 物料发放工单) -> 走 需求计划 SGMRIB：RAA026=RIB001 -> RIB004=订单号
    // 一条 SQL 同时覆盖两种单据，前台无感
    'SGMRAA_DCSIBA': [ { name: '前置优先_计划兜底', joins: ['s.IBA001 = b.RAA011', 's.IBA001 = s2.RIB004', 's2.RIB001 = b.RAA026'], midTbl: { tbl: 'SGMRIB', on: 's2.RIB001 = b.RAA026' } } ],
    // 工单单头 SGMRAA <- 计划单据来源档 SGMRIB（直接取计划档字段，如 RIB004 来源单号）：
    'SGMRAA_SGMRIB': [ { name: '计划编号键', joins: ['s.RIB001 = b.RAA026'] } ],
  };

  function buildSQL(docId, tgtCol, srcId, srcValCol, partyKey, mode, force, chain, ctx) {
    const doc = ctx.docs.find(d => d.id === docId);
    const src = ctx.srcs.find(x => x.id === srcId);
    if (!doc || !tgtCol || !src || !srcValCol) throw new Error('参数不全');

    const pfx = doc.keyCol.slice(0, 3);
    const refCol = doc.refCol || doc.keyCol;
    const needMain = partyKey === 1 && src.party !== 'none' && src.party !== 'item' && doc.partyCol;

    const noCol = doc.colSeq || (pfx + '002');
    const showNo = doc.colNo || (pfx + '001');
    let channel = [
      { name: '默认键', joins: ['s.' + src.key[0] + ' = b.' + refCol] },
    ];
    if (src.seqKey && doc.prefCol) {
      if (doc.seqCol) {
        // 目标单有序号列（单身）：来源单号+序号 = 目标前置单号+目标序号，精确匹配
        channel.push({
          name: '单号+序号',
          joins: ['s.' + src.seqKey[0] + ' = b.' + doc.prefCol, 's.' + src.seqKey[1] + ' = b.' + doc.seqCol]
        });
      } else {
        // 目标单无序号列（单头）：来源单号 = 目标前置单号
        channel.push({
          name: '单号键',
          joins: ['s.' + src.seqKey[0] + ' = b.' + doc.prefCol]
        });
      }
    }
    // 前置单号键通道：目标单有 prefCol 时，找来源档的单号列匹配
    // 来源单身有 seqKey → 用 seqKey[0]（单号列）
    // 来源单头无 seqKey → 用 key[0]（尾号=1 时为单号列）
    // 只有来源键本身是“单号”时才加单号键通道；库存档/主档的键是品号，不能当单号用。
    if (doc.prefCol && !src.seqKey && /单号/.test(src.keyDesc || '')) {
      let srcNoCol = null;
      if (src.seqKey) {
        srcNoCol = src.seqKey[0]; // 单身：seqKey[0] = 单号
      } else if (src.key[0].slice(-1) === '1') {
        srcNoCol = src.key[0];     // 单头：key 尾号 1 = 单号列
      }
      if (srcNoCol && !(src.seqKey && doc.seqCol)) {
        // 单身←单身 已有"单号+序号"精确匹配，不再重复加单号键
        channel.push({
          name: '单号键',
          joins: ['s.' + srcNoCol + ' = b.' + doc.prefCol]
        });
      }
    }
      // 供应商/客户维度自动判断：来源档自带对方主档(如TPADGA供应商信息档/TPADFA客户信息档)，
      // 目标单据主表存在对应编号列时，自动加 m 主表 JOIN 并匹配 来源档.对方编号 = 主表.对方编号。
      // 前台无需手动勾选维度，后台自动完成。
    // 方案A：命中白名单则把业务编号键通道插入最前（优先级最高）
    const bizKey = BIZ_KEY_CHANNELS[docId + '_' + srcId];
    if (bizKey) {
      for (const bk of bizKey) {
        const dup = channel.some(c => c.joins.length === bk.joins.length && bk.joins.every(j => c.joins.includes(j)));
        if (!dup) channel.unshift({ name: bk.name, joins: bk.joins, midTbl: bk.midTbl });
      }
    }

    let chosen = channel[0];
    let channelNote = chosen.name === '默认键' ? '品号键匹配' : '单号+序号匹配';

    let dimJoins = []; // 维度 JOIN（party/chain），叠加到每个通道之上
    let chain2Sql = '';
    // ===== 自动链式取值：后台判断是否需要中间表，前台无感 =====
    // 规则：当来源表的键是品号(单键)，但取值列是"品号+仓库"才能唯一定位的场景
    // 已知映射：JSKLOA.LOA003(库存量) 需要 TPADEA.DEA008(主仓) 作为仓库维度
    // 扩展：未来可加更多映射，如 JSLIBA(领料库存) 等
    const AUTO_CHAIN = {
      'JSKLOA': { mid: 'TPADEA', midKey: 'DEA001', midWh: 'DEA008', srcWh: 'LOA002' },
    };
    let autoChainNote = '';
    const autoC = AUTO_CHAIN[srcId];
    const needAutoChain = autoC && srcValCol === autoC.srcWh + '001' || (autoC && (srcValCol === 'LOA003' || srcValCol === 'LOA004'));
    const effectiveChain = chain && chain.src2Id ? chain : (needAutoChain ? { src2Id: autoC.mid, src2Key: autoC.midKey, src2ValCol: autoC.midWh, srcJoinKey: autoC.srcWh } : null);
    if (effectiveChain && effectiveChain.src2Id) {
      const src2 = ctx.srcs.find(x => x.id === effectiveChain.src2Id);
      if (src2) {
        const s2Key = effectiveChain.src2Key || src2.key[0];
        chain2Sql = ' JOIN [dbo].[' + effectiveChain.src2Id + '] s2 ON s2.' + s2Key + ' = b.' + (doc.refCol || doc.keyCol);
        // 仓库列 JOIN：来源表.仓列 = 中间表.仓列
        const srcWhCol = effectiveChain.srcJoinKey || (src.id === 'JSKLOA' ? 'LOA002' : null);
        const s2WhCol = effectiveChain.src2ValCol || 'DEA008';
        if (srcWhCol && s2WhCol) {
          dimJoins.push('CAST(s.' + srcWhCol + ' AS varchar(50)) = CAST(s2.' + s2WhCol + ' AS varchar(50))');
        }
        if (!chain || !chain.src2Id) autoChainNote = '自动链式: 经 ' + effectiveChain.src2Id + '.' + (effectiveChain.src2ValCol||'DEA008') + ' 补仓库维度';
      }
    }
    if (needMain) {
      const partySrc = src.partyKeyCol || (src.id.slice(3, 6) + '002');
      dimJoins.push('s.' + partySrc + ' = m.' + doc.partyCol);
    }
    const partyNote = needMain ? ('已加 ' + (src.party === 'supplier' ? '供应商' : '客户') + ' 维度') : ('未加对方维度');

    const buildFor = (chName, chJoins) => {
      const mJoinSqlX = (needMain || chName === '检验分流') ? (' JOIN [dbo].[' + doc.main + '] m ON m.' + doc.mainKeyCol + ' = b.' + pfx + '001') : '';
      // ===== 进货单(头/身) <- 采购单(头/身)/采购底稿(头/身)：统一解析采购源头 =====
      if (chName === '进货单关联采购源头') {
        const isHead = doc.id === 'JSKJDA';
        const lineAlias = isHead ? 'b2' : 'b';
        // 前置单据类型判断：单号+序号+品号都匹配到检验单才算检验流程；
        // 否则视为免检，JDB014/JDB015 本身就是采购单号/序号。
        // 必须带品号，否则同号但不同品号的检验单会把值串走。
        const poJoins = ' LEFT JOIN [dbo].[QMSMFB] jy ON jy.[MFB001]=' + lineAlias + '.[JDB014] AND jy.[MFB002]=' + lineAlias + '.[JDB015] AND jy.[MFB007]=' + lineAlias + '.[JDB003]'
          + ' LEFT JOIN [dbo].[JSKJCB] jcb ON jcb.[JCB001]=jy.[MFB005] AND jcb.[JCB002]=jy.[MFB006] AND jcb.[JCB003]=' + lineAlias + '.[JDB003]';
        // JDB013 前置来源：14=采购单（免检直连），A0=检验单（走检验单→收料单）
        const srcType = lineAlias + '.[JDB013]';
        const isDirect = srcType + "=N'14'";
        const isInspect = srcType + "=N'A0'";
        const inspectByJoin = 'jy.[MFB001] IS NOT NULL';
        const poNo = 'CASE WHEN ' + isDirect + ' THEN ' + lineAlias + '.[JDB014]'
          + ' WHEN ' + isInspect + ' THEN jcb.[JCB010]'
          + ' WHEN ' + inspectByJoin + ' THEN jcb.[JCB010]'
          + ' ELSE ' + lineAlias + '.[JDB014] END';
        const poSeq = 'CASE WHEN ' + isDirect + ' THEN ' + lineAlias + '.[JDB015]'
          + ' WHEN ' + isInspect + ' THEN jcb.[JCB011]'
          + ' WHEN ' + inspectByJoin + ' THEN jcb.[JCB011]'
          + ' ELSE ' + lineAlias + '.[JDB015] END';
        const needPoRow = (src.id === 'DCSHCB' || src.id === 'DCSHCA');
        const poRowJoin = needPoRow ? (' JOIN [dbo].[DCSHDB] po ON po.[HDB001]=' + poNo + ' AND po.[HDB002]=' + poSeq) : '';
        let srcJoin;
        if (src.id === 'DCSHDA') srcJoin = ' JOIN [dbo].[DCSHDA] s ON s.[HDA001]=' + poNo;
        else if (src.id === 'DCSHDB') srcJoin = ' JOIN [dbo].[DCSHDB] s ON s.[HDB001]=' + poNo + ' AND s.[HDB002]=' + poSeq;
        else if (src.id === 'DCSHCA') srcJoin = ' JOIN [dbo].[DCSHCA] s ON s.[HCA001]=po.[HDB016]';
        else srcJoin = ' JOIN [dbo].[DCSHCB] s ON s.[HCB001]=po.[HDB016] AND s.[HCB002]=po.[HDB017]';
        const pathExpr = 'CASE WHEN ' + isDirect + " THEN N'免检流程'"
          + ' WHEN ' + isInspect + " THEN N'检验流程'"
          + ' WHEN ' + inspectByJoin + " THEN N'检验流程'"
          + " ELSE N'免检流程' END";
        const fromClause = isHead
          ? (' FROM [dbo].[JSKJDA] b OUTER APPLY (SELECT TOP 1 s.*, ' + pathExpr + ' AS [__path] FROM [dbo].[JSKJDB] b2'
              + poJoins + poRowJoin + srcJoin
              + ' WHERE b2.[JDB001]=b.[JDA001] ORDER BY b2.[JDB002]) s')
          : (' FROM [dbo].[JSKJDB] b JOIN [dbo].[JSKJDA] h ON h.[JDA001]=b.[JDB001]' + poJoins + poRowJoin + srcJoin);
        const pathOut = isHead ? 's.[__path]' : pathExpr;
        const valExpr = 's.[' + srcValCol + ']';
        const emptyCond = "(b.[" + tgtCol + "] IS NULL OR CAST(b.[" + tgtCol + "] AS nvarchar(max)) = N'')";
        const fixCond = "(b.[" + tgtCol + "] IS NOT NULL AND CAST(b.[" + tgtCol + "] AS nvarchar(max)) <> N'') AND " + valExpr + " IS NOT NULL AND CAST(b.[" + tgtCol + "] AS nvarchar(max)) <> CAST(" + valExpr + " AS nvarchar(max))";
        const cond = force ? '1=1' : (mode === 'fix' ? ('(' + emptyCond + ' OR ' + fixCond + ')') : emptyCond);
        const whereClause = ' WHERE ' + cond + ' AND ' + valExpr + ' IS NOT NULL AND CAST(' + valExpr + " AS nvarchar(max)) <> N''";
        const previewSqlX = 'SELECT TOP 200 b.[' + showNo + '] AS [单号], b.[' + noCol + '] AS [序号], b.[' + tgtCol + '] AS [现值], ' + valExpr + ' AS [应带], ' + pathOut + ' AS [路径]'
          + fromClause + whereClause + ' ORDER BY b.[' + showNo + ']';
        const updateSqlX = 'UPDATE b SET b.[' + tgtCol + ']=' + valExpr + fromClause + whereClause;
        const cntSqlX = 'SELECT COUNT(*) AS n' + fromClause + whereClause;
        return { channelName: chName, joins: chJoins, partyNote, previewSql: previewSqlX, updateSql: updateSqlX, cntSql: cntSqlX, mJoinSql: null, isPurchaseFlow: true };
      }
      // 进货单头 <- 采购单头：经进货单身 JDB014 前置采购单号关联
      if (chName === '进货单头经单身关联采购单头' || chName === '进货单头经单身关联采购底稿') {
        const isDraftHead = src.id === 'DCSHCA';
        const poNoExpr = "CASE WHEN b.[JDA058]=N'F' THEN b2.[JDB014] ELSE s4.[JCB010] END";
        const poSeqExpr = "CASE WHEN b.[JDA058]=N'F' THEN b2.[JDB015] ELSE s4.[JCB011] END";
        const fromClause = ' FROM [dbo].[' + doc.sub + '] b'
          + ' OUTER APPLY (SELECT TOP 1 s.* FROM [dbo].[JSKJDB] b2'
          // 检验流程：JDB014/015=检验单号/序号 -> 检验单 MFB005/006=收料单号/序号 -> 收料单 JCB010/011=采购单号/序号
          + ' LEFT JOIN [dbo].[QMSMFB] jy ON jy.[MFB001]=b2.[JDB014] AND jy.[MFB002]=b2.[JDB015]'
          + ' LEFT JOIN [dbo].[JSKJCB] s4 ON s4.[JCB001]=jy.[MFB005] AND s4.[JCB002]=jy.[MFB006]'
          + ' JOIN [dbo].[DCSHDB] po ON po.[HDB001]=' + poNoExpr + ' AND po.[HDB002]=' + poSeqExpr
          + (isDraftHead
              ? ' JOIN [dbo].[DCSHCA] s ON s.[HCA001]=po.[HDB016]'
              : ' JOIN [dbo].[DCSHDA] s ON s.[HDA001]=po.[HDB001]')
          + ' WHERE b2.[JDB001] = b.[' + showNo + '] ORDER BY b2.[JDB002]) s';
        const valExpr = 's.[' + srcValCol + ']';
        const emptyCond = "(b.[" + tgtCol + "] IS NULL OR CAST(b.[" + tgtCol + "] AS nvarchar(max)) = N'')";
        const fixCond = "(b.[" + tgtCol + "] IS NOT NULL AND CAST(b.[" + tgtCol + "] AS nvarchar(max)) <> N'') AND " + valExpr + " IS NOT NULL AND CAST(b.[" + tgtCol + "] AS nvarchar(max)) <> CAST(" + valExpr + " AS nvarchar(max))";
        const cond = force ? '1=1' : (mode === 'fix' ? ('(' + emptyCond + ' OR ' + fixCond + ')') : emptyCond);
        const whereClause = ' WHERE ' + cond + ' AND ' + valExpr + ' IS NOT NULL AND CAST(' + valExpr + " AS nvarchar(max)) <> N''";
        const previewSqlX = 'SELECT TOP 200 b.[' + showNo + '] AS [单号], b.[' + noCol + '] AS [序号], b.[' + tgtCol + '] AS [现值], ' + valExpr + ' AS [应带], (CASE WHEN b.[JDA058]=N\'F\' THEN N\'免检流程\' ELSE N\'检验流程\' END) AS [路径]'
          + fromClause + whereClause + ' ORDER BY b.[' + showNo + ']';
        const updateSqlX = 'UPDATE b SET b.[' + tgtCol + ']=' + valExpr + fromClause + whereClause;
        const cntSqlX = 'SELECT COUNT(*) AS n' + fromClause + whereClause;
        return { channelName: chName, joins: chJoins, partyNote, previewSql: previewSqlX, updateSql: updateSqlX, cntSql: cntSqlX, mJoinSql: null, isPurchaseHead: true };
      }
      // 前置优先_计划兜底：工单 SGMRAA <- 订单 DCSIBA，单条 SQL 自动分流
      //   有前置订单(RAA011) -> 直接 JOIN DCSIBA ON s.IBA001 = b.RAA011
      //   无前置订单(RAA011为空) -> 走 SGMRIB：RAA026=RIB001，RIB004=订单号
      //   前台无需切换，系统自动完成
      if (chName === '前置优先_计划兜底') {
        const fromClause = ' FROM [dbo].[' + doc.sub + '] b' + mJoinSqlX + chain2Sql +
          ' LEFT JOIN [dbo].[SGMRIB] s2 ON s2.RIB001 = b.RAA026' +
          ' LEFT JOIN [dbo].[' + src.id + '] s ON s.IBA001 = b.RAA011' +
          ' LEFT JOIN [dbo].[' + src.id + '] s3 ON s3.IBA001 = s2.RIB004';
        const fallbackVal = 'ISNULL(s.[' + srcValCol + '], s3.[' + srcValCol + '])';
        const emptyCond = "(b.[" + tgtCol + "] IS NULL OR CAST(b.[" + tgtCol + "] AS nvarchar(max)) = N'')";
        const fixCond = "(b.[" + tgtCol + "] IS NOT NULL AND CAST(b.[" + tgtCol + "] AS nvarchar(max)) <> N'') AND " + fallbackVal + " IS NOT NULL AND CAST(b.[" + tgtCol + "] AS nvarchar(max)) <> CAST(" + fallbackVal + " AS nvarchar(max))";
        const cond = force ? '1=1' : (mode === 'fix' ? ('(' + emptyCond + ' OR ' + fixCond + ')') : emptyCond);
        const whereClause = ' WHERE ' + cond + ' AND (' + fallbackVal + ' IS NOT NULL AND CAST(' + fallbackVal + ' AS varchar(200)) <> N\'\')';
        const previewSqlX = 'SELECT TOP 200 b.[' + showNo + '] AS [单号], b.[' + noCol + '] AS [序号], b.[' + tgtCol + '] AS [现值], ' + fallbackVal + ' AS [应带]' +
          fromClause + whereClause + ' ORDER BY ' + orderBy(showNo, noCol);
        const updateSqlX = 'UPDATE b SET b.[' + tgtCol + ']=' + fallbackVal +
          fromClause + whereClause;
        const cntSqlX = 'SELECT COUNT(*) AS n FROM [dbo].[' + doc.sub + '] b' +
          ' LEFT JOIN [dbo].[SGMRIB] s2 ON s2.RIB001 = b.RAA026' +
          ' LEFT JOIN [dbo].[' + src.id + '] s ON s.IBA001 = b.RAA011' +
          ' LEFT JOIN [dbo].[' + src.id + '] s3 ON s3.IBA001 = s2.RIB004' +
          ' WHERE ' + cond + ' AND (' + fallbackVal + ' IS NOT NULL AND CAST(' + fallbackVal + ' AS nvarchar(max)) <> N\'\')';
        return { channelName: chName, joins: chJoins, partyNote, previewSql: previewSqlX, updateSql: updateSqlX, cntSql: cntSqlX, mJoinSql: mJoinSqlX, isFallback: true };
      }
      // 检验分流：进货单 JSKJDB <- 采购单 DCSHDB / 采购底稿 DCSHCB，单条 SQL 自动分流
      //   免检(不走检验)：进货行前置 JDB014/015 直连采购单/底稿行 单号+序号
      //   非免检(走检验)：进货行前置 = 收料单 JSKJCB；经 进货检验单 QMSMFB(品号+收料单号+收料序号)
      //     桥接到收料行，再按 品号+供应商维度 取采购值
      // 检验分流：进货单 JSKJDB <- 采购单 DCSHDB / 采购底稿 DCSHCB，单条 SQL 自动分流
      //   直取(免检)：进货行前置 JDB014/015 = 采购单行 单号+序号 (src.seqKey)
      //   检验(非免检)：进货行前置 = 收料单 JSKJCB.JCB001/JCB002
      //     → QMSMFB(品号+收料单号+收料序号) 桥接 → DCSHDB 行(品号 HDB003) + 采购单头(供应商)
      if (chName === '检验分流') {
        const isDraft = src.id === 'DCSHCB';
        // 是否检验以进货单头 JDA058 为准：T=检验流程，F=免检流程
        // 检验：JDB014=收料单号 -> JSKJCB.JCB010=采购单号；免检：JDB014=采购单号
        // 取采购底稿时再经采购单 HDB016/HDB017 转接到底稿 HCB001/HCB002
        const poNoExpr = "CASE WHEN h.[JDA058]=N'F' THEN b.[JDB014] ELSE s4.[JCB010] END";
        const poSeqExpr = "CASE WHEN h.[JDA058]=N'F' THEN b.[JDB015] ELSE s4.[JCB011] END";
        const fromClause = ' FROM [dbo].[' + doc.sub + '] b'
          + ' JOIN [dbo].[JSKJDA] h ON h.[JDA001] = b.[JDB001]'
          // 检验：JDB014/015=检验单号/序号 -> QMSMFB -> 收料单 JSKJCB -> 采购单
          + ' LEFT JOIN [dbo].[QMSMFB] jy ON jy.[MFB001] = b.[JDB014] AND jy.[MFB002] = b.[JDB015]'
          + ' LEFT JOIN [dbo].[JSKJCB] s4 ON s4.[JCB001] = jy.[MFB005] AND s4.[JCB002] = jy.[MFB006]'
          + ' JOIN [dbo].[DCSHDB] po ON po.[HDB001] = ' + poNoExpr + ' AND po.[HDB002] = ' + poSeqExpr
          + (isDraft
              ? ' JOIN [dbo].[DCSHCB] s ON s.[HCB001] = po.[HDB016] AND s.[HCB002] = po.[HDB017]'
              : ' JOIN [dbo].[DCSHDB] s ON s.[HDB001] = po.[HDB001] AND s.[HDB002] = po.[HDB002]');
        const fallbackVal = 's.[' + srcValCol + ']';
        const emptyCond = "(b.[" + tgtCol + "] IS NULL OR CAST(b.[" + tgtCol + "] AS nvarchar(max)) = N'')";
        const fixCond = "(b.[" + tgtCol + "] IS NOT NULL AND CAST(b.[" + tgtCol + "] AS nvarchar(max)) <> N'') AND " + fallbackVal + " IS NOT NULL AND CAST(b.[" + tgtCol + "] AS nvarchar(max)) <> CAST(" + fallbackVal + " AS nvarchar(max))";
        const cond = force ? '1=1' : (mode === 'fix' ? ('(' + emptyCond + ' OR ' + fixCond + ')') : emptyCond);
        const whereClause = ' WHERE ' + cond + ' AND (' + fallbackVal + ' IS NOT NULL AND CAST(' + fallbackVal + ' AS varchar(200)) <> N\'\')';
        const previewSqlX = 'SELECT TOP 200 b.[' + showNo + '] AS [单号], b.[' + noCol + '] AS [序号], b.[' + tgtCol + '] AS [现值], ' + fallbackVal + ' AS [应带], (CASE WHEN h.[JDA058]=N\'F\' THEN N\'免检流程\' ELSE N\'检验流程\' END) AS [路径]' +
          fromClause + whereClause + ' ORDER BY ' + orderBy(showNo, noCol);
        const updateSqlX = 'UPDATE b SET b.[' + tgtCol + ']=' + fallbackVal +
          fromClause + whereClause;
        const cntSqlX = 'SELECT COUNT(*) AS n' + fromClause + whereClause;
        return { channelName: chName, joins: chJoins, partyNote, previewSql: previewSqlX, updateSql: updateSqlX, cntSql: cntSqlX, mJoinSql: mJoinSqlX, isFallback: true, isPoInspec: true };
      }
      // 普通通道：中间表 JOIN（原逻辑）
      const midTblMap = { '计划来源单号键': { tbl: 'SGMRIB', key: 'RIB001' } };
      const midSpec = midTblMap[chName];
      // 中间表：优先用通道自带的 midTbl 提示（检验分流/计划兜底），否则用静态 midTblMap
      const chosenCh = channel.find(c => c.name === chName) || {};
      const midSpec2 = chosenCh.midTbl ? { tbl: chosenCh.midTbl.tbl, on: chosenCh.midTbl.on } : (midSpec ? { tbl: midSpec.tbl, on: 's2.RIB001 = b.RAA026' } : null);
      const midJoinSql = midSpec2 ? (' JOIN [dbo].[' + midSpec2.tbl + '] s2 ON ' + midSpec2.on) : '';
      const whereX = [...(chJoins || []), ...dimJoins].join(' AND ');
      const emptyCondX = "(b.[" + tgtCol + "] IS NULL OR CAST(b.[" + tgtCol + "] AS nvarchar(max)) = N'')";
      const fixCondX = "(b.[" + tgtCol + "] IS NOT NULL AND CAST(b.[" + tgtCol + "] AS nvarchar(max)) <> N'') AND s.[" + srcValCol + "] IS NOT NULL AND CAST(b.[" + tgtCol + "] AS nvarchar(max)) <> CAST(s.[" + srcValCol + "] AS nvarchar(max))";
      const condX = force ? '1=1' : (mode === 'fix' ? ('(' + emptyCondX + ' OR ' + fixCondX + ')') : emptyCondX);
      const previewSqlX = 'SELECT TOP 200 b.[' + showNo + '] AS [单号], b.[' + noCol + '] AS [序号], b.[' + tgtCol + '] AS [现值], s.[' + srcValCol + '] AS [应带]' +
        ' FROM [dbo].[' + doc.sub + '] b' + mJoinSqlX + chain2Sql + midJoinSql +
        ' JOIN [dbo].[' + src.id + '] s ON ' + whereX +
        ' WHERE ' + condX + ' ORDER BY ' + orderBy(showNo, noCol);
      const updateSqlX = 'UPDATE b SET b.[' + tgtCol + ']=s.[' + srcValCol + ']' +
        ' FROM [dbo].[' + doc.sub + '] b' + mJoinSqlX + chain2Sql + midJoinSql +
        ' JOIN [dbo].[' + src.id + '] s ON ' + whereX +
        ' WHERE ' + condX;
      const cntSqlX = 'SELECT COUNT(*) AS n FROM [dbo].[' + doc.sub + '] b' +
        mJoinSqlX + chain2Sql + midJoinSql +
        ' JOIN [dbo].[' + src.id + '] s ON ' + whereX +
        ' WHERE ' + condX;
      return { channelName: chName, joins: chJoins, partyNote, previewSql: previewSqlX, updateSql: updateSqlX, cntSql: cntSqlX, mJoinSql: mJoinSqlX };
    };

    const single = buildFor(chosen.name, chosen.joins);
    // 附带自动链式说明，供前台直接展示，无需用户手动判断
    if (autoChainNote) single.chainNote = autoChainNote;
    if (channel.length === 1) return { ...single, channels: null };
    const chObjs = channel.map(c => buildFor(c.name, c.joins));
    const out = { ...chObjs[0], channels: chObjs, channelNote: '多通道候选: ' + channel.map(c => c.name).join(' / ') };
    if (autoChainNote) out.chainNote = autoChainNote;
    return out;
  }

  // ===== 采购发票单身：后台自动识别来源类型，再按用户选择的来源列正常取值 =====
  // ===== 通用自动链路 SQL（基于链路注册表 + BFS 路径）=====
  function buildChainSQL(tgtDocId, tgtCol, srcValCol, mode, force, path, docs) {
    if (!Array.isArray(path) || !path.length) throw new Error('链路为空');
    const esc = s => String(s).replace(/'/g, "''");
    const bt = s => '[' + s + ']';
    const tgtMeta = docs[tgtDocId] || {};
    const showNo = tgtMeta.docNo;
    const showSeq = tgtMeta.docSeq;
    if (!showNo) throw new Error('目标单据缺少单号列');
    let prevAlias = 'b';
    let prevTable = tgtDocId;
    const joins = [];
    let i = 0;
    for (const e of path) {
      const alias = 's' + (++i);
      const fromMeta = docs[prevTable] || {};
      const toMeta = docs[e.to] || {};
      let cond;
      if (e.internal) {
        cond = bt(alias) + '.' + bt(toMeta.docNo) + ' = ' + bt(prevAlias) + '.' + bt(fromMeta.docNo);
      } else {
        cond = bt(alias) + '.' + bt(e.toJoinCol || toMeta.docNo) + ' = ' + bt(prevAlias) + '.' + bt(e.fromNo);
        const toSeq = e.toSeqCol || toMeta.docSeq;
        if (toSeq && e.fromSeq) cond += ' AND ' + bt(alias) + '.' + bt(toSeq) + ' = ' + bt(prevAlias) + '.' + bt(e.fromSeq);
        if (e.fromCode) cond += " AND " + bt(prevAlias) + '.' + bt(e.fromCode) + " = N'" + esc(e.code) + "'";
      }
      joins.push(' JOIN [dbo].[' + e.to + '] ' + alias + ' ON ' + cond);
      prevAlias = alias;
      prevTable = e.to;
    }
    const valExpr = bt(prevAlias) + '.' + bt(srcValCol);
    const emptyCond = "(b.[" + tgtCol + "] IS NULL OR CAST(b.[" + tgtCol + "] AS nvarchar(max)) = N'')";
    const fixCond = "(b.[" + tgtCol + "] IS NOT NULL AND CAST(b.[" + tgtCol + "] AS nvarchar(max)) <> N'') AND " + valExpr + " IS NOT NULL AND CAST(b.[" + tgtCol + "] AS nvarchar(max)) <> CAST(" + valExpr + " AS nvarchar(max))";
    const cond = force ? '1=1' : (mode === 'fix' ? '(' + emptyCond + ' OR ' + fixCond + ')' : emptyCond);
    const fromClause = ' FROM [dbo].[' + tgtDocId + '] b' + joins.join('');
    const whereClause = ' WHERE ' + cond + ' AND ' + valExpr + ' IS NOT NULL';
    const seqSel = showSeq ? ('b.' + bt(showSeq)) : "N''";
    const previewSql = 'SELECT TOP 200 b.' + bt(showNo) + ' AS [单号], ' + seqSel + ' AS [序号], b.' + bt(tgtCol) + ' AS [现值], ' + valExpr + ' AS [应带]' + fromClause + whereClause + ' ORDER BY b.' + bt(showNo);
    const updateSql = 'UPDATE b SET b.' + bt(tgtCol) + '=' + valExpr + fromClause + whereClause;
    const cntSql = 'SELECT COUNT(*) AS n' + fromClause + whereClause;
    return {
      previewSql, updateSql, cntSql,
      channelName: '自动链路',
      channelNote: '自动链路: ' + path.map(x => x.from + (x.internal ? '→' : (x.code ? '[' + x.code + ']→' : '→')) + x.to).join(' / '),
      joins: [],
      partyNote: '自动链路',
      chainNote: '',
      previewParts: { showNo, showSeq, fromClause, whereClause, valExpr }
    };
  }

  function invoiceMixedNumberParts(bAlias = 'b') {
    const applies = [
      ` OUTER APPLY (SELECT TOP 1 d.HDB001,d.HDB902 FROM dbo.JSKJDB j JOIN dbo.DCSHDB d ON d.HDB001=j.JDB014 AND d.HDB002=j.JDB015 WHERE ${bAlias}.GSB003='18' AND j.JDB001=${bAlias}.GSB004 AND j.JDB002=${bAlias}.GSB005 AND j.JDB013='14') po_direct`,
      ` OUTER APPLY (SELECT TOP 1 d.HDB001,d.HDB902 FROM dbo.JSKJDB j JOIN dbo.QMSMFB q ON q.MFB001=j.JDB014 AND q.MFB002=j.JDB015 AND q.MFB007=j.JDB003 JOIN dbo.JSKJCB r ON r.JCB001=q.MFB005 AND r.JCB002=q.MFB006 AND r.JCB003=j.JDB003 JOIN dbo.DCSHDB d ON d.HDB001=r.JCB010 AND d.HDB002=r.JCB011 WHERE ${bAlias}.GSB003='18' AND j.JDB001=${bAlias}.GSB004 AND j.JDB002=${bAlias}.GSB005 AND j.JDB013='A0' AND r.JCB009='14') po_insp`,
      ` OUTER APPLY (SELECT TOP 1 d.HDB001,d.HDB902 FROM dbo.JSKJFB f JOIN dbo.DCSHDB d ON d.HDB001=f.JFB017 AND d.HDB002=f.JFB018 WHERE ${bAlias}.GSB003='19' AND f.JFB001=${bAlias}.GSB004 AND f.JFB002=${bAlias}.GSB005 AND f.JFB016='14') ret_direct`,
      ` OUTER APPLY (SELECT TOP 1 d.HDB001,d.HDB902 FROM dbo.JSKJFB f JOIN dbo.JSKJDB j ON j.JDB001=f.JFB014 AND j.JDB002=f.JFB015 AND f.JFB013='18' JOIN dbo.DCSHDB d ON d.HDB001=j.JDB014 AND d.HDB002=j.JDB015 WHERE ${bAlias}.GSB003='19' AND f.JFB001=${bAlias}.GSB004 AND f.JFB002=${bAlias}.GSB005 AND j.JDB013='14') ret_po_direct`,
      ` OUTER APPLY (SELECT TOP 1 d.HDB001,d.HDB902 FROM dbo.JSKJFB f JOIN dbo.JSKJDB j ON j.JDB001=f.JFB014 AND j.JDB002=f.JFB015 AND f.JFB013='18' JOIN dbo.QMSMFB q ON q.MFB001=j.JDB014 AND q.MFB002=j.JDB015 AND q.MFB007=j.JDB003 JOIN dbo.JSKJCB r ON r.JCB001=q.MFB005 AND r.JCB002=q.MFB006 AND r.JCB003=j.JDB003 JOIN dbo.DCSHDB d ON d.HDB001=r.JCB010 AND d.HDB002=r.JCB011 WHERE ${bAlias}.GSB003='19' AND f.JFB001=${bAlias}.GSB004 AND f.JFB002=${bAlias}.GSB005 AND j.JDB013='A0' AND r.JCB009='14') ret_po_insp`,
      ` OUTER APPLY (SELECT TOP 1 g.RGB002,g.RGB902 FROM dbo.SGMRGB g WHERE ${bAlias}.GSB003='89' AND g.RGB002=${bAlias}.GSB004 AND g.RGB028=${bAlias}.GSB005) out_in`,
      ` OUTER APPLY (SELECT TOP 1 e.REB001,e.REB902 FROM dbo.SGMREB e WHERE ${bAlias}.GSB003='A3' AND e.REB001=${bAlias}.GSB036 AND e.REB002=${bAlias}.GSB038) out_order`
    ].join('');
    const timeRawExpr = 'COALESCE(po_direct.HDB902,po_insp.HDB902,ret_direct.HDB902,ret_po_direct.HDB902,ret_po_insp.HDB902,out_in.RGB902,out_order.REB902)';
    return {
      applies,
      valueExpr: 'COALESCE(po_direct.HDB001,po_insp.HDB001,ret_direct.HDB001,ret_po_direct.HDB001,ret_po_insp.HDB001,out_in.RGB002,out_order.REB001)',
      timeRawExpr,
      timeExpr: 'CONVERT(varchar(23),' + timeRawExpr + ',121)'
    };
  }

  function buildInvoiceMixedNumberSQL(tgtCol, mode, force) {
    const parts = invoiceMixedNumberParts('b');
    const valExpr = parts.valueExpr;
    const fromClause = ' FROM [dbo].[YSFGSB] b' + parts.applies;
    const emptyCond = "(b.[" + tgtCol + "] IS NULL OR CAST(b.[" + tgtCol + "] AS nvarchar(max))=N'')";
    const fixCond = "(b.[" + tgtCol + "] IS NOT NULL AND CAST(b.[" + tgtCol + "] AS nvarchar(max))<>N'') AND " + valExpr + " IS NOT NULL AND CAST(b.[" + tgtCol + "] AS nvarchar(max))<>CAST(" + valExpr + " AS nvarchar(max))";
    const cond = force ? '1=1' : (mode === 'fix' ? '(' + emptyCond + ' OR ' + fixCond + ')' : emptyCond);
    const whereClause = ' WHERE ' + cond + ' AND ' + valExpr + ' IS NOT NULL';
    const previewSql = 'SELECT TOP 200 b.[GSB001] AS [单号], b.[GSB002] AS [序号], b.[GSB003] AS [来源类型], b.[GSB004] AS [来源单号], b.[' + tgtCol + '] AS [现值], ' + valExpr + ' AS [应带]' + fromClause + whereClause + ' ORDER BY b.[GSB001],b.[GSB002]';
    const updateSql = 'UPDATE b SET b.[' + tgtCol + ']=' + valExpr + fromClause + whereClause;
    const cntSql = 'SELECT COUNT(*) AS n' + fromClause + whereClause;
    return {
      previewSql, updateSql, cntSql,
      channelName: '采购发票混合来源单号',
      channelNote: '采购发票按行识别: 18/19→采购单，89→委外进退货单，A3→委外单',
      joins: [],
      partyNote: '混合来源自动分流',
      chainNote: ''
    };
  }

  function buildInvoiceMixedTimeSQL(tgtCol, mode, force) {
    const parts = invoiceMixedNumberParts('b');
    const valExpr = parts.timeExpr;
    const fromClause = ' FROM [dbo].[YSFGSB] b' + parts.applies;
    const emptyCond = "(b.[" + tgtCol + "] IS NULL OR CAST(b.[" + tgtCol + "] AS nvarchar(max))=N'')";
    const fixCond = "(b.[" + tgtCol + "] IS NOT NULL AND CAST(b.[" + tgtCol + "] AS nvarchar(max))<>N'') AND " + valExpr + " IS NOT NULL AND CAST(b.[" + tgtCol + "] AS nvarchar(max))<>CAST(" + valExpr + " AS nvarchar(max))";
    const cond = force ? '1=1' : (mode === 'fix' ? '(' + emptyCond + ' OR ' + fixCond + ')' : emptyCond);
    const whereClause = ' WHERE ' + cond + ' AND ' + parts.timeRawExpr + ' IS NOT NULL';
    const previewSql = 'SELECT TOP 200 b.[GSB001] AS [单号], b.[GSB002] AS [序号], b.[GSB003] AS [来源类型], b.[GSB004] AS [来源单号], b.[' + tgtCol + '] AS [现值], ' + valExpr + ' AS [应带]' + fromClause + whereClause + ' ORDER BY b.[GSB001],b.[GSB002]';
    const updateSql = 'UPDATE b SET b.[' + tgtCol + ']=' + valExpr + fromClause + whereClause;
    const cntSql = 'SELECT COUNT(*) AS n' + fromClause + whereClause;
    return {
      previewSql, updateSql, cntSql,
      channelName: '采购发票混合来源时间',
      channelNote: '采购发票按行识别: 18/19→采购单身时间，89→委外进退货时间，A3→委外单时间',
      joins: [],
      partyNote: '混合来源自动分流',
      chainNote: ''
    };
  }

  function buildInvoiceMixedNumberTriggerUpdateSQL(onTable, tgtCol, pkJoin, timeMode) {
    const parts = invoiceMixedNumberParts('b');
    const valExpr = parts.valueExpr;
    const timeModeSafe = ['separate', 'combined'].includes(timeMode) ? timeMode : 'none';
    const numberBlank = '(b.[' + tgtCol + "] IS NULL OR CAST(b.[" + tgtCol + "] AS nvarchar(max))=N'')";
    const timeBlank = "(b.[GSB961] IS NULL OR CAST(b.[GSB961] AS nvarchar(max))=N'')";
    const from = ' FROM [dbo].[' + onTable + '] b JOIN inserted i ON ' + pkJoin + parts.applies;
    let update;
    if (timeModeSafe === 'separate') {
      update = 'UPDATE b SET b.[' + tgtCol + ']=CASE WHEN ' + numberBlank + ' THEN ' + valExpr + ' ELSE b.[' + tgtCol + '] END,' +
        ' b.[GSB961]=CASE WHEN ' + timeBlank + ' THEN ' + parts.timeExpr + ' ELSE b.[GSB961] END' + from +
        ' WHERE (' + numberBlank + ' OR ' + timeBlank + ') AND (' + valExpr + ' IS NOT NULL OR ' + parts.timeRawExpr + ' IS NOT NULL);';
    } else if (timeModeSafe === 'combined') {
      const combined = "ISNULL(" + valExpr + ",'') + CASE WHEN " + valExpr + ' IS NOT NULL AND ' + parts.timeRawExpr + " IS NOT NULL THEN ' ' ELSE '' END + ISNULL(" + parts.timeExpr + ",'')";
      update = 'UPDATE b SET b.[' + tgtCol + ']=CASE WHEN ' + numberBlank + ' THEN ' + combined + ' ELSE b.[' + tgtCol + '] END' + from +
        ' WHERE ' + numberBlank + ' AND (' + valExpr + ' IS NOT NULL OR ' + parts.timeRawExpr + ' IS NOT NULL);';
    } else {
      update = 'UPDATE b SET b.[' + tgtCol + ']=' + valExpr + from +
        ' WHERE ' + numberBlank + ' AND ' + valExpr + ' IS NOT NULL;';
    }
    return update;
  }

  function buildTriggerFromStatements(onTable, trgName, statements) {
    const list = (statements || []).filter(Boolean);
    if (!list.length) throw new Error('没有可生成触发器的字段映射');
    return 'CREATE TRIGGER [dbo].[' + trgName + '] ON [dbo].[' + onTable + '] AFTER INSERT AS BEGIN SET NOCOUNT ON; SET XACT_ABORT ON; ' +
      list.join('; ') + '; END;';
  }

  function applyInsertedFilter(updateSql, pkJoin) {
    const marker = ' WHERE ';
    const at = updateSql.lastIndexOf(marker);
    if (at < 0) throw new Error('触发器更新 SQL 缺少 WHERE 条件');
    const where = updateSql.slice(at + marker.length);
    return updateSql.slice(0, at) + ' WHERE EXISTS (SELECT 1 FROM inserted i WHERE ' + pkJoin + ') AND (' + where + ')';
  }

  function extractTriggerBody(definition) {
    const match = String(definition || '').match(/AS\s+BEGIN([\s\S]*?)END\s*;?\s*$/i);
    if (!match) return '';
    return match[1]
      .replace(/^\s*SET\s+NOCOUNT\s+ON\s*;?/i, '')
      .replace(/^\s*SET\s+XACT_ABORT\s+ON\s*;?/i, '')
      .trim()
      .replace(/;+\s*$/, '');
  }

  function triggerTargetColumns(definition) {
    const out = [];
    for (const update of String(definition || '').matchAll(/UPDATE\s+b\s+SET\s+([\s\S]*?)\s+FROM\s+/gi)) {
      for (const match of update[1].matchAll(/b\.\[?([A-Za-z0-9_]+)\]?\s*=/gi)) out.push(match[1]);
    }
    return out;
  }

  function appendUpdateSql(updateSql, separator = ' ') {
    const source = String(updateSql || '');
    const updateMatches = [...source.matchAll(/\bUPDATE\s+b\s+SET\s+b\.\[([^\]]+)\]\s*=/gi)];
    if (!updateMatches.length) throw new Error('合并显示更新 SQL 解析失败');
    const updateMatch = updateMatches[updateMatches.length - 1];
    const updateAt = updateMatch.index;
    const prefix = source.slice(0, updateAt);
    const tail = source.slice(updateAt);
    const head = tail.match(/^\s*UPDATE\s+b\s+SET\s+b\.\[([^\]]+)\]\s*=\s*([\s\S]*?)\s+FROM\s+([\s\S]*)$/i);
    if (!head) throw new Error('合并显示更新 SQL 解析失败');
    const col = head[1];
    const valueExpr = head[2].trim();
    const fromPart = head[3];
    const at = fromPart.lastIndexOf(' WHERE ');
    if (at < 0) throw new Error('合并显示更新 SQL 缺少 WHERE 条件');
    const fromBody = fromPart.slice(0, at);
    const whereBody = fromPart.slice(at + 7);
    const current = 'CAST(b.[' + col + '] AS nvarchar(max))';
    const next = 'CONVERT(nvarchar(max),(' + valueExpr + '))';
    const sepLiteral = "N'" + String(separator).replace(/'/g, "''") + "'";
    const joined = "CASE WHEN b.[" + col + "] IS NULL OR " + current + "=N'' THEN " + next +
      ' ELSE ' + current + ' + ' + sepLiteral + ' + ' + next + ' END';
    // 重复值判断按“空格+值”匹配，兼容旧的单空格数据和新的三空格分隔
    const duplicateGuard = "(b.[" + col + "] IS NULL OR " + current + "=N'' OR CHARINDEX(N' '+" + next + ",N' '+" + current + ")=0)";
    return prefix + 'UPDATE b SET b.[' + col + ']=' + joined + ' FROM ' + fromBody +
      ' WHERE (' + whereBody + ') AND ' + duplicateGuard;
  }

  function mergeTriggerDefinitions(onTable, trgName, existing, newTriggerSql, options = {}) {
    const statements = [];
    const seen = new Set();
    const existingTargets = new Set();
    const replaceTargets = new Set(options.replaceTargets || []);
    for (const trigger of existing || []) {
      const body = extractTriggerBody(trigger.sql);
      if (!body) continue;
      for (const statement of body.split(/;\s*(?=UPDATE\s+b\s+SET\b)/i).map(s => s.trim()).filter(Boolean)) {
        const cols = triggerTargetColumns(statement);
        cols.forEach(col => existingTargets.add(col));
        if (cols.some(col => replaceTargets.has(col))) continue;
        const duplicate = cols.find(col => seen.has(col));
        if (duplicate) throw new Error('已有工具触发器重复写入字段 ' + duplicate + '，请先清理旧触发器');
        cols.forEach(col => seen.add(col));
        statements.push(statement);
      }
    }
    let newBody = extractTriggerBody(newTriggerSql);
    const newCols = triggerTargetColumns(newBody);
    const overlap = newCols.find(col => existingTargets.has(col));
    if (overlap) {
      if (!options.mergeTargets || !options.mergeTargets.includes(overlap)) {
        if (!replaceTargets.has(overlap)) throw new Error('字段 ' + overlap + ' 已存在于工具触发器，请修改原映射或使用合并显示');
      } else {
        newBody = appendUpdateSql(newBody, options.separator || ' ');
      }
    }
    if (newBody) statements.push(newBody);
    return buildTriggerFromStatements(onTable, trgName, statements);
  }

  function buildInvoiceMixedNumberTriggerSQL(onTable, trgName, tgtCol, pkJoin, timeMode) {
    return buildTriggerFromStatements(onTable, trgName, [
      buildInvoiceMixedNumberTriggerUpdateSQL(onTable, tgtCol, pkJoin, timeMode)
    ]);
  }

  function buildMultiFieldTriggerSQL(onTable, trgName, pkJoin, updateSqls) {
    return buildTriggerFromStatements(onTable, trgName, (updateSqls || []).filter(Boolean).map(updateSql => applyInsertedFilter(updateSql, pkJoin)));
  }

  // 多路径版本：免检直连 + 检验绕行等并行链路，预览 UNION，执行逐条 UPDATE
  function buildChainMultiSQL(tgtDocId, tgtCol, srcValCol, mode, force, paths, docs, options = {}) {
    const orderedPaths = (paths || []).filter(p => Array.isArray(p) && p.length)
      .sort((a, b) => a.length - b.length);
    const list = orderedPaths.map(p => buildChainSQL(tgtDocId, tgtCol, srcValCol, mode, force, p, docs));
    if (!list.length) throw new Error('链路为空');
    const symbol = s => '[' + s + ']';
    const candidates = list.map((item, index) => {
      const parts = item.previewParts;
      const seqExpr = parts.showSeq ? 'b.' + symbol(parts.showSeq) : "N''";
      return 'SELECT b.' + symbol(parts.showNo) + ' AS [_doc], ' + seqExpr + ' AS [_seq], ' +
        parts.valExpr + ' AS [_val], ' + (index + 1) + ' AS [_priority]' + parts.fromClause + parts.whereClause;
    }).join(' UNION ALL ');
    const tgtMeta = docs[tgtDocId] || {};
    const joinSeq = tgtMeta.docSeq ? ' AND b.' + symbol(tgtMeta.docSeq) + '=r.[_seq]' : '';
    const joinCond = 'b.' + symbol(tgtMeta.docNo) + '=r.[_doc]' + joinSeq;
    let cte, previewSql, updateSql, cntSql;
    if (options.aggregateDistinct) {
      const unique = 'unique_values AS (SELECT DISTINCT [_doc],[_seq],CONVERT(nvarchar(4000),[_val]) AS [_val] FROM candidates WHERE [_val] IS NOT NULL),';
      const aggregate =
        'aggregated AS (SELECT u.[_doc],u.[_seq],STUFF((' +
        'SELECT N\', \'+x.[_val] FROM (' +
        'SELECT DISTINCT u2.[_val] FROM unique_values u2 ' +
        'WHERE u2.[_doc]=u.[_doc] AND u2.[_seq]=u.[_seq]' +
        ') x ORDER BY x.[_val] FOR XML PATH(\'\'),TYPE).value(\'.\',\'nvarchar(max)\'),1,2,N\'\') AS [_val] ' +
        'FROM unique_values u GROUP BY u.[_doc],u.[_seq])';
      cte = 'WITH candidates AS (' + candidates + '),' + unique + aggregate;
      previewSql = cte + ' SELECT TOP 200 r.[_doc] AS [单号], r.[_seq] AS [序号], b.' + symbol(tgtCol) + ' AS [现值], r.[_val] AS [应带] FROM aggregated r JOIN [dbo].' + symbol(tgtDocId) + ' b ON ' + joinCond + ' ORDER BY r.[_doc],r.[_seq]';
      updateSql = cte + ' UPDATE b SET b.' + symbol(tgtCol) + '=r.[_val] FROM aggregated r JOIN [dbo].' + symbol(tgtDocId) + ' b ON ' + joinCond;
      cntSql = cte + ' SELECT COUNT(*) AS n FROM aggregated r JOIN [dbo].' + symbol(tgtDocId) + ' b ON ' + joinCond;
    } else {
      cte = 'WITH candidates AS (' + candidates + '), ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY [_doc],[_seq] ORDER BY [_priority]) rn FROM candidates)';
      previewSql = cte + ' SELECT TOP 200 r.[_doc] AS [单号], r.[_seq] AS [序号], b.' + symbol(tgtCol) + ' AS [现值], r.[_val] AS [应带] FROM ranked r JOIN [dbo].' + symbol(tgtDocId) + ' b ON ' + joinCond + ' WHERE r.rn=1 ORDER BY r.[_doc],r.[_seq]';
      updateSql = cte + ' UPDATE b SET b.' + symbol(tgtCol) + '=r.[_val] FROM ranked r JOIN [dbo].' + symbol(tgtDocId) + ' b ON ' + joinCond + ' WHERE r.rn=1';
      cntSql = cte + ' SELECT COUNT(*) AS n FROM ranked r WHERE r.rn=1';
    }
    return {
      previewSql, updateSql, cntSql,
      channelName: options.aggregateDistinct ? '自动链路(多路径去重汇总)' : '自动链路(多路径)',
      channelNote: (options.aggregateDistinct ? '多路径去重汇总: ' : '自动链路: ') + orderedPaths.map(p => p.map(x => x.from + (x.internal ? '→' : (x.code ? '[' + x.code + ']→' : '→')) + x.to).join('/')).join(' || '),
      joins: [],
      partyNote: '自动链路(多路径)',
      chainNote: ''
    };
  }

  return { scanDocs, scanSrcs, buildSQL, buildChainSQL, buildChainMultiSQL, buildInvoiceMixedNumberSQL, buildInvoiceMixedTimeSQL, buildInvoiceMixedNumberTriggerSQL, buildInvoiceMixedNumberTriggerUpdateSQL, buildMultiFieldTriggerSQL, applyInsertedFilter, appendUpdateSql, buildTriggerFromStatements, mergeTriggerDefinitions, triggerTargetColumns };
};
