// 自动构建单据链路注册表（只读诊断用）
// 依据: 每张单据的「来源类型 / 来源单号 / 来源序号」字段组合，配合样本单号匹配候选单头表
'use strict';

const SAFE = /^[A-Za-z0-9_]+$/;
const q = (name) => '[' + name + ']';
const REGISTRY_VERSION = 27;
const FIELD_DICTS = require('./source-dict');
const SOURCE_LABELS = FIELD_DICTS.Source || {};
// 只有这些“字段名”才使用 [Source] 代码表；主要来源/科目来源/数据来源/客户来源/来源码等
// 属于各自字段，绝不参与来源链路。
const SOURCE_FIELDS = new Set([
  '来源', '前置来源', '单据来源', '来源类别', '来源类型',
  '发票来源', '计划来源', '源工单来源', '原源工单来源',
  '来源(预留)', '前置来源(预留)'
]);
function registryRequest(pool) {
  const request = pool.request();
  request.timeout = 60000;
  return request;
}

// 已验证的来源编码 → 单头表（优先于自动匹配，避免同号串表）
const KNOWN_CODES = {
  '14': 'DCSHDB', // 采购
  '18': 'JSKJDB', // 进货
  '19': 'JSKJFB', // 退货
  '21': 'YSFGSA', // 蓝字进货发票
  '81': 'SGMRAB', // 工单
  '86': 'SGMREA', // 委外
  '89': 'SGMRGB', // 委外进货
  'A0': 'QMSMFB', // 进货检验
  'A3': 'QMSMCB'  // 委外进货检验
};

// 单头显式引用的上游单据；按字段说明统一识别，避免逐张单据硬编码。
const HEAD_REF_TARGETS = {
  '采购单号': 'DCSHDA',
  '订单单号': 'DCSIBA',
  '源工单单号': 'SGMRAA',
  '发放单号': 'SGMRIB',
  '入库单号': 'JSKLHA',
  '出库单号': 'JSKLIA'
};

// ERP 后台来源代码 → 目标单身表。
// 依据《易助match.txt》[Source] 权威代码表；代码含义与旧映射冲突时以该表为准。
const SOURCE_CODE_MAP = {
  '01': 'JSKLCB',  // 调拨
  '02': 'JSKLBB',  // 调整
  '03': 'JSKLDB',  // 盘点
  '12': 'DCSHBB',  // 请购
  '13': 'DCSHCB',  // 采购底稿
  '14': 'DCSHDB',  // 采购
  '15': 'JSKJCB',  // 收料
  '16': 'JSKJDB',  // 验收
  '17': 'JSKJDB',  // 验退退回
  '18': 'JSKJDB',  // 进货
  '19': 'JSKJFB',  // 退货
  '21': 'YSFGSA',  // 蓝字进货发票
  '31': 'DCSIAB',  // 报价
  '32': 'DCSIBB',  // 订单
  '33': 'JSKKEB',  // 销货单
  '45': 'JSKLHB',  // 入库单
  '46': 'JSKLIB',  // 出库单
  '54': 'YSFGDB',  // 收款
  '58': 'YSFGQB',  // 付款
  '59': 'YSFGGB',  // 蓝字销货发票
  '60': 'YSFGGB',  // 红字发票（销货）
  '60A': 'YSFGSB', // 红字发票（采购）
  '81': 'SGMRAB',  // 工单
  '82': 'SGMRBB',  // 领料
  '83': 'SGMRBB',  // 退料
  '8A': 'SGMRBB',  // 超耗领料
  '8C': 'SGMRBB',  // 超领单
  '84': 'SGMRCB',  // 生产入库
  '85': 'SGMRCB',  // 生产退回
  '86': 'SGMREA',  // 委外
  '87': 'SGMRFB',  // 送料
  '8B': 'SGMRFB',  // 超耗送料
  '88': 'SGMRFB',  // 退料（送/退料）
  '89': 'SGMRGB',  // 委外进货
  '89A': 'SGMRGB', // 委外进货成本分录
  '89C': 'SGMRGB', // 委外暂估回冲
  '90': 'SGMRGB',  // 委外退货
  '91': 'SGMRIB',  // 需求计划
  '92': 'SGMRBB',  // 工艺投料
  '94': 'SGMRCB',  // 工艺入库
  '95': 'SGMRHB',  // 报工
  '96': 'SGMSAA',  // 生产计划
  '97': 'SGMRKB',  // 重工单
  '98': 'SGMRLB',  // 副产品入库
  'A0': 'QMSMFB',  // 进货检验
  'A1': 'QMSMAB',  // 生产入库检验
  'A2': 'QMSMBB',  // 委外进货收料
  'A3': 'QMSMCB',  // 委外进货检验
  'A4': 'QMSMDB',  // 委外进货验退退回
  'A5': 'QMSMEB'   // 库存检验
};

const SOURCE_CODE_OVERRIDES = {
  'KJSNDB.NDB017:21': 'YSFGSA', // 会计凭证单身来源21=蓝字进货发票（权威代码表）
  'YSFGQC.GQC004:21': 'YSFGSA', // 付款冲账档中的来源21为采购发票
  'QMSMBB.MBB010:86': 'SGMREA',  // 委外进货收料中的来源86为委外单（全局86=调整单）
  'SGMRCB.RCB021:81': 'SGMRAB',  // 生产入库单身来源81为工单（全局81=进货单）
  'SGMRCC.RCC003:81': 'SGMRAB'   // 生产入库工单信息档来源81为工单
};

// 同一代码在不同表里指向同一张单据、但单号/序号列不同时的字段级修正。
const LINK_FIELD_OVERRIDES = {
  'SGMRCB.RCB021:81': { fromNo: 'RCB026', fromSeq: 'RCB027' },
  // 生产入库工单信息档：来源序号列是 000，行序号在 RCC022
  'SGMRCC.RCC003:81': { fromNo: 'RCC013', fromSeq: 'RCC022' },
  // 收款核销单的发票序号常为空，按发票单号匹配开票单身
  'YSFGHC.GHC003:59': { fromNo: 'GHC004', fromSeq: null }
};

const IGNORED_SOURCE_CODES = new Set(['18A', '18B', '35']);

function descOf(c) { return String(c.desc || '').trim(); }

// 在一张表的列里找出所有「来源三件套」
function findTriplets(cols) {
  const codes = cols.filter(c => SOURCE_FIELDS.has(descOf(c)));
  const nos = cols.filter(c => /^(前置单号|前置单据|前置来源单号|来源单号|前置单号\(预留\))$/.test(descOf(c)));
  const seqs = cols.filter(c => /^(前置序号|来源序号|前置序号\(预留\))$/.test(descOf(c)));
  const out = [];
  for (const c of codes) {
    const no = nos.slice().sort((a, b) => Math.abs(a.id - c.id) - Math.abs(b.id - c.id))[0];
    if (!no || Math.abs(no.id - c.id) > 8) continue;
    const seq = seqs.slice().sort((a, b) => Math.abs(a.id - no.id) - Math.abs(b.id - no.id))[0];
    out.push({
      code: c.col,
      no: no.col,
      seq: (seq && Math.abs(seq.id - no.id) <= 5) ? seq.col : null,
      label: descOf(c)
    });
  }
  return out;
}

function pickDocNo(cols) {
  const exact = cols.find(c => descOf(c) === '单号');
  if (exact) return exact.col;
  const any = cols.find(c => /(单号|号码)/.test(descOf(c)) && !/来源|前置/.test(descOf(c)));
  if (any) return any.col;
  const first = cols.find(c => c.id === 1);
  return first ? first.col : null;
}
function pickDocSeq(cols) {
  const exact = cols.find(c => descOf(c) === '序号') || cols.find(c => descOf(c) === '单身序号');
  return exact ? exact.col : null;
}
function pickDate(cols) {
  const exact = cols.find(c => descOf(c) === '日期');
  if (exact) return exact.col;
  const any = cols.find(c => /日期/.test(descOf(c)) && !/来源|前置/.test(descOf(c)));
  return any ? any.col : null;
}
function pickType(cols) {
  const exact = cols.find(c => ['类别', '单据来源', '来源类别'].includes(descOf(c)) && !/前置/.test(descOf(c)));
  return exact ? exact.col : null;
}

async function buildRegistry(pool) {
  const meta = (await registryRequest(pool).query(`
    SELECT t.name tbl, c.name col, c.column_id id, CONVERT(varchar(200),s.value) [desc]
    FROM sys.columns c
    JOIN sys.tables t ON c.object_id = t.object_id
    LEFT JOIN sys.extended_properties s
      ON s.major_id = t.object_id AND s.minor_id = c.column_id AND s.name = N'MS_Description'
    WHERE t.is_ms_shipped = 0
    ORDER BY t.name, c.column_id`)).recordset;

  const rows = (await registryRequest(pool).query(`
    SELECT t.name tbl, SUM(p.rows) n
    FROM sys.tables t JOIN sys.partitions p
      ON p.object_id = t.object_id AND p.index_id IN (0,1)
    GROUP BY t.name`)).recordset;
  const rowCount = {};
  rows.forEach(r => rowCount[r.tbl] = Number(r.n || 0));

  const byTable = {};
  meta.forEach(r => {
    if (!SAFE.test(r.tbl) || !SAFE.test(r.col)) return;
    (byTable[r.tbl] = byTable[r.tbl] || []).push(r);
  });

  const docs = {};
  const triplets = [];
  for (const [tbl, cols] of Object.entries(byTable)) {
    const docNo = pickDocNo(cols);
    docs[tbl] = {
      docNo,
      docSeq: pickDocSeq(cols),
      date: pickDate(cols),
      typeCol: pickType(cols),
      rows: rowCount[tbl] || 0
    };
    if (!docNo) continue;
    const ts = findTriplets(cols);
    ts.forEach(t => triplets.push({ tbl, ...t }));
  }

  // 采样来源单号
  const groups = [];
  const samples = [];
  const allCodes = {};
  for (const t of triplets) {
    if (!docs[t.tbl] || docs[t.tbl].rows <= 0) continue;
    try {
      const cr = (await registryRequest(pool).query(
        `SELECT DISTINCT ${q(t.code)} code FROM ${q('dbo')}.${q(t.tbl)} WHERE ISNULL(${q(t.code)},'') <> ''`
      )).recordset;
      for (const row of cr) {
        const code = String(row.code || '');
        if (!code) continue;
        allCodes[code] = (allCodes[code] || 0) + 1;
        if (IGNORED_SOURCE_CODES.has(code)) continue;
        const esc = code.replace(/'/g, "''");
        const nr = (await registryRequest(pool).query(
          `SELECT TOP 5 ${q(t.no)} no FROM ${q('dbo')}.${q(t.tbl)} ` +
          `WHERE ${q(t.code)}=N'${esc}' AND ISNULL(${q(t.no)},'') <> ''`
        )).recordset;
        const uniq = [...new Set(nr.map(x => String(x.no)))];
        if (!uniq.length) continue;
        groups.push({ from: t.tbl, code, codeCol: t.code, no: t.no, seq: t.seq, label: t.label, nos: uniq });
        uniq.forEach(n => samples.push(n));
      }
    } catch (_) {}
  }
  const uniqSamples = [...new Set(samples)].slice(0, 400);

  // 候选单头表匹配
  const found = {};
  if (uniqSamples.length) {
    const inList = uniqSamples.map(n => "N'" + String(n).replace(/'/g, "''") + "'").join(',');
    for (const [tbl, d] of Object.entries(docs)) {
      if (!d.docNo || d.rows <= 0) continue;
      try {
        const r = (await registryRequest(pool).query(
          `SELECT DISTINCT ${q(d.docNo)} no FROM ${q('dbo')}.${q(tbl)} WHERE ${q(d.docNo)} IN (${inList})`
        )).recordset;
        r.forEach(x => { (found[String(x.no)] = found[String(x.no)] || []).push(tbl); });
      } catch (_) {}
    }
  }

  const links = [];
  for (const g of groups) {
    const score = {};
    for (const no of g.nos) {
      (found[no] || []).forEach(tbl => { score[tbl] = (score[tbl] || 0) + 1; });
    }
    const candidates = Object.entries(score)
      .sort((a, b) => b[1] - a[1])
      .map(([tbl, hits]) => ({ tbl, hits }));
    let chosen = null, status = 'ambiguous';
    const mapped = SOURCE_CODE_OVERRIDES[`${g.from}.${g.codeCol}:${g.code}`] || SOURCE_CODE_MAP[g.code];
    if (mapped && docs[mapped]) {
      chosen = mapped;
      status = 'code-map';
    }
    if (!chosen && !candidates.length) continue;
    // 再按候选表自身的类型字段验证（完全由数据驱动，不依赖硬编码）
    if (!chosen) {
      for (const c of candidates) {
        const td = docs[c.tbl];
        if (!td || !td.typeCol) continue;
        try {
          const chk = await registryRequest(pool).query(
            `SELECT TOP 1 1 ok FROM ${q('dbo')}.${q(c.tbl)} WHERE ${q(td.typeCol)}=N'${String(g.code).replace(/'/g, "''")}'`
          );
          if (chk.recordset.length) { chosen = c.tbl; status = 'type'; break; }
        } catch (_) {}
      }
    }
    // 再退到已验证编码，最后才是唯一候选
    if (!chosen && KNOWN_CODES[g.code] && candidates.some(c => c.tbl === KNOWN_CODES[g.code])) {
      chosen = KNOWN_CODES[g.code];
      status = 'seed';
    } else if (!chosen && candidates.length === 1) {
      chosen = candidates[0].tbl;
      status = 'resolved';
    }
    const to = chosen || candidates[0].tbl;
    links.push({
      from: g.from,
      code: g.code,
      codeLabel: g.code ? (SOURCE_LABELS[g.code] || '未收录') : '字段引用',
      codeKnown: g.code ? !!SOURCE_LABELS[g.code] : true,
      fromCode: g.codeCol,
      fromNo: g.no,
      fromSeq: g.seq,
      to,
      toNo: docs[to] ? docs[to].docNo : null,
      toDate: docs[to] ? docs[to].date : null,
      hits: (candidates.find(c => c.tbl === to) || {}).hits || 0,
      samples: g.nos.length,
      status,
      candidateTables: candidates.map(c => c.tbl),
      candidates: candidates.slice(0, 6)
    });
  }

  // 非标准链路适配器（字段不是标准「来源三件套」）
  const ADAPTERS = [
    // 进货检验单 -> 收料单（收料单号/序号）
    { from: 'QMSMFB', to: 'JSKJCB', fromNo: 'MFB005', fromSeq: 'MFB006', fromCode: null, code: null, status: 'adapter', hits: 1, samples: 1 },
    // 委外进/退货单 -> 委外单（委外单号/序号）
    { from: 'SGMRGB', to: 'SGMREB', fromNo: 'RGB025', fromSeq: 'RGB026', fromCode: null, code: null, status: 'adapter', hits: 1, samples: 1 },
    // 采购单 -> 采购底稿（底稿单号/序号）
    { from: 'DCSHDB', to: 'DCSHCB', fromNo: 'HDB016', fromSeq: 'HDB017', fromCode: null, code: null, status: 'adapter', hits: 1, samples: 1 },
    // 委外进货检验 -> 委外进货收料（收料单号/序号）
    { from: 'QMSMCB', to: 'QMSMBB', fromNo: 'MCB005', fromSeq: 'MCB006', fromCode: null, code: null, status: 'adapter', hits: 1, samples: 1 },
    // 委外送料 -> 委外单（委外单号/序号）
    { from: 'SGMRFB', to: 'SGMREB', fromNo: 'RFB010', fromSeq: 'RFB011', fromCode: null, code: null, status: 'adapter', hits: 1, samples: 1 },
    { from: 'SGMRCB', to: 'SGMRAB', fromNo: 'RCB026', fromSeq: 'RCB027', fromCode: null, code: null, status: 'adapter', hits: 1, samples: 1 },
    // 生产检验单身 -> 工单（来源单号，81=工单）
    { from: 'QMSMAB', to: 'SGMRAA', fromNo: 'MAB006', fromSeq: null, fromCode: null, code: null, status: 'adapter', hits: 1, samples: 1 },
    { from: 'SGMRBB', to: 'SGMRAB', fromNo: 'RBB010', fromSeq: 'RBB011', fromCode: null, code: null, status: 'adapter', hits: 1, samples: 1 },
    // 报工单 -> 移转单：两者不是上下游，共享同一工单；
    // 报工单身 RHB004 / 移转单身 RDB004 都是工单单号。
    // 不能经移转单头转接，否则一张移转单对应多张工单时会按单号错配。
    { from: 'SGMRHB', to: 'SGMRDB', fromNo: 'RHB004', fromSeq: null, toJoinCol: 'RDB004', fromCode: null, code: null, status: 'adapter', hits: 1, samples: 1 },
    // 工单头 -> 品号主档：工单界面的品名/规格不是头表字段，按主件品号查 TPADEA
    { from: 'SGMRAA', to: 'TPADEA', fromNo: 'RAA015', fromSeq: null, toJoinCol: 'DEA001', fromCode: null, code: null, status: 'master-lookup', hits: 1, samples: 1 },
    // 移转单身 -> 工单头：RDB004 是工单单号；不能经移转单头（单头没有工单号）
    { from: 'SGMRDB', to: 'SGMRAA', fromNo: 'RDB004', fromSeq: null, toJoinCol: 'RAA001', fromCode: null, code: null, status: 'adapter', prefer: true, hits: 1, samples: 1 },
    // 工单主件 -> 工艺路线：主件品号的 DEA045 指向 SGMQBB.QBB001
    { from: 'TPADEA', to: 'SGMQBB', fromNo: 'DEA045', fromSeq: null, toJoinCol: 'QBB001', fromCode: null, code: null, status: 'adapter', prefer: true, hits: 1, samples: 1 },
    // 工艺路线的主要材料 -> 品号主档
    { from: 'SGMQBB', to: 'TPADEA', fromNo: 'QBB003', fromSeq: null, toJoinCol: 'DEA001', fromCode: null, code: null, status: 'master-lookup', prefer: true, hits: 1, samples: 1 },
    // 移转单身 -> 工艺路线：经工单主件找路线；用于取 QBB003 主要材料
    {
      from: 'SGMRDB', to: 'SGMQBB',
      joinSql: '{a}.[QBB001] = (SELECT TOP 1 d.[DEA045] FROM [dbo].[SGMRAA] wa JOIN [dbo].[TPADEA] d ON d.[DEA001] = wa.[RAA015] WHERE wa.[RAA001] = {b}.[RDB004])',
      status: 'adapter', hits: 1, samples: 1
    },
    // 移转单身 -> 主要材料品号主档：工单主件 -> 工艺路线 -> QBB003 -> TPADEA.DEA057
    {
      from: 'SGMRDB', to: 'TPADEA',
      joinSql: '{a}.[DEA001] = (SELECT TOP 1 q.[QBB003] FROM [dbo].[SGMRAA] wa JOIN [dbo].[TPADEA] d ON d.[DEA001] = wa.[RAA015] JOIN [dbo].[SGMQBB] q ON q.[QBB001] = d.[DEA045] WHERE wa.[RAA001] = {b}.[RDB004])',
      status: 'adapter', hits: 1, samples: 1
    },
    // 重工单 -> 工单（来源工单单号）；反向边供“工单取重工单”使用
    { from: 'SGMRKA', to: 'SGMRAA', fromNo: 'RKA010', fromSeq: null, fromCode: null, code: null, status: 'adapter', hits: 1, samples: 1 },
    { from: 'SGMRAA', to: 'SGMRKA', fromNo: 'RAA001', fromSeq: null, toJoinCol: 'RKA010', fromCode: null, code: null, status: 'adapter', prefer: true, hits: 1, samples: 1 },
    { from: 'SGMRAA', to: 'SGMRNA', fromNo: 'RAA001', fromSeq: null, toJoinCol: 'RNA023', fromCode: null, code: null, status: 'adapter', prefer: true, hits: 1, samples: 1 },
    // 物料需求计划发放：委外单/工单都挂同一计划编号，经 SGMRIB 互为来源
    { from: 'SGMREA', to: 'SGMRIB', fromNo: 'REA049', fromSeq: 'REA050', toJoinCol: 'RIB001', toSeqCol: 'RIB002', fromCode: null, code: null, status: 'adapter', hits: 1, samples: 1 },
    { from: 'SGMRAA', to: 'SGMRIB', fromNo: 'RAA026', fromSeq: 'RAA027', toJoinCol: 'RIB001', toSeqCol: 'RIB002', fromCode: null, code: null, status: 'adapter', hits: 1, samples: 1 },
    { from: 'SGMRIB', to: 'SGMRAA', fromNo: 'RIB001', fromSeq: 'RIB002', toJoinCol: 'RAA026', toSeqCol: 'RAA027', fromCode: null, code: null, status: 'adapter', hits: 1, samples: 1 },
    { from: 'SGMRIB', to: 'SGMREA', fromNo: 'RIB001', fromSeq: 'RIB002', toJoinCol: 'REA049', toSeqCol: 'REA050', fromCode: null, code: null, status: 'adapter', hits: 1, samples: 1 },
    // 收款核销 -> 销售开票单头；销售开票 -> 订单单头（来源序号为空时按单头取）
    { from: 'YSFGHC', to: 'YSFGGA', fromNo: 'GHC004', fromSeq: null, toJoinCol: 'GGA001', fromCode: null, code: null, status: 'adapter', hits: 1, samples: 1 }
  ];
  // 单头显式引用上游单据时自动接边，覆盖付款单、收款单、计划建议等同类结构。
  for (const [tbl, cols] of Object.entries(byTable)) {
    if (!/[A-Z0-9]A$/.test(tbl) || !docs[tbl]) continue;
    for (const ref of cols) {
      const to = HEAD_REF_TARGETS[descOf(ref)];
      if (!to || ref.col === docs[tbl].docNo || !docs[to]) continue;
      if (links.some(l => l.from === tbl && l.to === to)) continue;
      ADAPTERS.push({
        from: tbl, to, fromNo: ref.col, fromSeq: null,
        ...(to === 'SGMRIB' ? { toJoinCol: 'RIB001' } : {}),
        fromCode: null, code: null, status: 'head-reference', hits: 1, samples: 1
      });
    }
  }
  if (docs.YSFGQA && docs.YSFGSA && !links.some(l => l.from === 'YSFGQA' && l.to === 'YSFGSA')) {
    ADAPTERS.push({
      from: 'YSFGQA', to: 'YSFGSA', fromNo: 'GQA001', fromSeq: null,
      toJoinCol: 'GSA028', fromCode: null, code: null,
      status: 'head-reference', hits: 1, samples: 1
    });
  }
  for (const a of ADAPTERS) {
    if (!docs[a.from] || !docs[a.to]) continue;
    if (links.some(l => l.from === a.from && l.to === a.to)) continue;
    links.push(a);
  }

  // 同一来源类型应指向同一种单据。先用已确定链路投票；
  // 没有投票时，取该类型所有歧义链路的候选交集，仅当交集落在唯一一个“单头/单身族”时采用。
  // 字段级修正：同一代码指向同一单据，但承载单号/序号的列不同
  for (const l of links) {
    const fo = LINK_FIELD_OVERRIDES[`${l.from}.${l.fromCode}:${l.code}`];
    if (fo) { Object.assign(l, fo); l.status = 'field-override'; }
  }
  // 盘点单没有前置单据；会计凭证/应付异动不进入付款链路；付款单的发票来源走 YSFGQC
  const LINK_DROP = new Set(['JSKLNA.LNA025:03']);
  const DROP_PAIRS = new Set(['KJSNDA->KJSNBA', 'YSFGPA->KJSNBA', 'YSFGQA->DCSHDA', 'YSFGQA->YSFGSA']);
  for (let i = links.length - 1; i >= 0; i--) {
    const l = links[i];
    if (LINK_DROP.has(`${l.from}.${l.fromCode}:${l.code}`) || DROP_PAIRS.has(`${l.from}->${l.to}`)) links.splice(i, 1);
  }

  const linksByCode = {};
  links.forEach(l => {
    if (!l.code) return;
    (linksByCode[l.code] = linksByCode[l.code] || []).push(l);
  });
  for (const [code, codeLinks] of Object.entries(linksByCode)) {
    const votedTables = Object.keys(codeLinks
      .filter(l => l.status !== 'ambiguous')
      .reduce((acc, l) => { acc[l.to] = true; return acc; }, {}));
    let target = votedTables.length === 1 ? votedTables[0] : null;
    let consensus = 'resolved-code';
    if (!target) {
      const ambiguous = codeLinks.filter(l => l.status === 'ambiguous');
      if (ambiguous.length >= 2) {
        let common = new Set(ambiguous[0].candidateTables || []);
        for (const link of ambiguous.slice(1)) {
          const next = new Set(link.candidateTables || []);
          common = new Set([...common].filter(tbl => next.has(tbl)));
        }
        const tables = [...common];
        const families = {};
        tables.forEach(tbl => {
          const key = tbl.slice(0, 5);
          (families[key] = families[key] || []).push(tbl);
        });
        const familyKeys = Object.keys(families);
        if (familyKeys.length === 1) {
          const familyTables = families[familyKeys[0]];
          const line = familyTables.find(tbl => /B$/.test(tbl) && docs[tbl] && docs[tbl].docSeq &&
            ambiguous.some(l => l.fromSeq));
          target = line || familyTables.find(tbl => /A$/.test(tbl)) || familyTables[0];
          consensus = 'code-family';
        }
      }
    }
    if (!target || !docs[target]) continue;
    codeLinks.filter(l => l.status === 'ambiguous').forEach(link => {
      link.to = target;
      link.toNo = docs[target].docNo;
      link.toDate = docs[target].date;
      link.hits = ((link.candidates || []).find(c => c.tbl === target) || {}).hits || 0;
      link.status = consensus;
    });
  }

  // 少数中间表没有「单号」列（如计划单据来源档），用其固定的来源单号/序号列补全目标键。
  const TARGET_KEY_DEFAULTS = {
    SGMRIB: { col: 'RIB001', seq: 'RIB002' }
  };
  for (const l of links) {
    const def = TARGET_KEY_DEFAULTS[l.to];
    if (def && !l.toNo && !l.toJoinCol) {
      l.toJoinCol = def.col;
      if (!l.toSeqCol) l.toSeqCol = def.seq;
    }
  }

  const linkCount = {};
  links.forEach(l => { linkCount[l.code] = (linkCount[l.code] || 0) + 1; });
  const sourceCodes = Object.keys(SOURCE_LABELS).map(code => ({
    code,
    label: SOURCE_LABELS[code],
    table: SOURCE_CODE_MAP[code] || null,
    links: linkCount[code] || 0,
    status: SOURCE_CODE_MAP[code] ? (linkCount[code] ? 'linked' : 'mapped-no-link') : 'no-table'
  }));
  const unknownSourceCodes = [...new Set(links.filter(l => l.code && !l.codeKnown).map(l => l.code))]
    .map(code => ({ code, label: '未收录', links: linkCount[code] || 0 }));
  return {
    version: REGISTRY_VERSION,
    generatedAt: new Date().toISOString(),
    docs,
    links,
    allCodes,
    sourceDict: SOURCE_LABELS,
    sourceFields: [...SOURCE_FIELDS],
    sourceCodes,
    unknownSourceCodes,
    stats: {
      tables: Object.keys(docs).length,
      tripletTables: new Set(triplets.map(t => t.tbl)).size,
      triplets: triplets.length,
      groups: groups.length,
      links: links.length,
      resolved: links.filter(l => l.status !== 'ambiguous').length,
      ambiguous: links.filter(l => l.status === 'ambiguous').length
      ,codes: Object.keys(allCodes).length
    }
  };
}

// 基于已解析链路构建有向图（含同单据头↔身内部边），BFS 找最短链路
function buildAdj(registry) {
  const adj = {};
  const add = (a, b, info) => { (adj[a] = adj[a] || []).push({ to: b, ...info }); };
  (registry.links || []).forEach(l => {
    if (l.status === 'ambiguous') return;
    add(l.from, l.to, {
      code: l.code,
      fromCode: l.fromCode,
      fromNo: l.fromNo,
      fromSeq: l.fromSeq,
      toJoinCol: l.toJoinCol,
      toSeqCol: l.toSeqCol,
      joinSql: l.joinSql,
      prefer: l.prefer,
      link: l
    });
  });
  Object.keys(registry.docs || {}).forEach(tbl => {
    if (/A$/.test(tbl)) {
      const line = tbl.slice(0, -1) + 'B';
      if (registry.docs[line]) {
        add(tbl, line, { internal: true });
        add(line, tbl, { internal: true });
      }
    }
  });
  // 付款/收款/采购发票的冲账档通过单号挂回对应单头。
  for (const [head, offset] of Object.entries({ YSFGQA: 'YSFGQC', YSFGDA: 'YSFGDC', YSFGSA: 'YSFGSC' })) {
    if (registry.docs[head] && registry.docs[offset]) {
      add(head, offset, { internal: true });
      add(offset, head, { internal: true });
    }
  }
  return adj;
}

function findPath(registry, from, to) {
  if (!registry || !from || !to) return null;
  const adj = buildAdj(registry);
  const queue = [{ node: from, path: [] }];
  const seen = new Set([from]);
  while (queue.length) {
    const cur = queue.shift();
    if (cur.node === to) return cur.path;
    for (const e of (adj[cur.node] || [])) {
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      queue.push({ node: e.to, path: cur.path.concat([{ from: cur.node, to: e.to, ...e }]) });
    }
  }
  return null;
}

function findAllPaths(registry, from, to, maxDepth = 9, maxPaths = 50) {
  if (!registry || !from || !to) return [];
  const adj = buildAdj(registry);
  const out = [];
  // BFS 按路径长度递增枚举，避免“先碰到一堆长路径把正确短路径挤掉”
  const queue = [{ node: from, path: [], visited: new Set([from]) }];
  while (queue.length && out.length < maxPaths) {
    const cur = queue.shift();
    if (cur.path.length > maxDepth) continue;
    if (cur.path.length && cur.node === to) { out.push(cur.path); continue; }
    for (const e of (adj[cur.node] || [])) {
      if (cur.visited.has(e.to)) continue;
      const visited = new Set(cur.visited); visited.add(e.to);
      queue.push({ node: e.to, path: cur.path.concat([{ from: cur.node, ...e }]), visited });
    }
  }
  return out;
}

module.exports = { REGISTRY_VERSION, buildRegistry, findPath, findAllPaths };
