// 自动构建单据链路注册表（只读诊断用）
// 依据: 每张单据的「来源类型 / 来源单号 / 来源序号」字段组合，配合样本单号匹配候选单头表
'use strict';

const SAFE = /^[A-Za-z0-9_]+$/;
const q = (name) => '[' + name + ']';
const REGISTRY_VERSION = 16;
function registryRequest(pool) {
  const request = pool.request();
  request.timeout = 60000;
  return request;
}

// 已验证的来源编码 → 单头表（优先于自动匹配，避免同号串表）
const KNOWN_CODES = {
  '14': 'DCSHDB', // 采购单
  '18': 'JSKJDB', // 进货/验退单
  '19': 'JSKJFB', // 进货退出单
  '89': 'SGMRGB', // 委外进/退货单
  'A0': 'QMSMFB', // 进货检验单
  'A3': 'SGMREB'  // 委外单
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

// ERP 来源代码 → 目标单身表；具体表/字段例外优先于全局代码。
const SOURCE_CODE_MAP = {
  '12': 'DCSHBB',  // 请购单
  '18': 'JSKJDB',  // 进货/验退单
  '19': 'JSKJFB',  // 进货退出单
  '21': 'KJSNBA',  // 会计科目
  '31': 'DCSIAB',  // 报价单
  '32': 'DCSIBB',  // 订单
  '33': 'JSKKEB',  // 销货单
  '54': 'YSFGDB',  // 收款单
  '58': 'YSFGQB',  // 付款单
  '59': 'YSFGGB',  // 销售开票单
  '81': 'JSKJDB',  // 进货单
  '86': 'JSKLBB',  // 调整单
  '89': 'SGMRGB',  // 委外进/退货单
  '89A': 'SGMRGB', // 委外进/退货单的成本分录子类型
  '91': 'SGMRIB',  // 物料需求计划来源
  'A0': 'QMSMFB',  // 进货检验单
  'A1': 'QMSMAB',  // 生产检验单
  'A3': 'SGMREB'   // 委外单
};

const SOURCE_CODE_OVERRIDES = {
  'KJSNDB.NDB017:21': 'YSFGGB', // 会计凭证单身中的来源21为销售开票单
  'YSFGQC.GQC004:21': 'YSFGSA', // 付款冲账档中的来源21为采购发票
  'QMSMBB.MBB010:86': 'SGMREA',  // 委外进货收料中的来源86为委外单（全局86=调整单）
  'SGMRCB.RCB021:81': 'SGMRAB',  // 生产入库单身来源81为工单（全局81=进货单）
  'SGMRCC.RCC003:81': 'SGMRAB'   // 生产入库工单信息档来源81为工单
};

// 同一代码在不同表里指向同一张单据、但单号/序号列不同时的字段级修正。
const LINK_FIELD_OVERRIDES = {
  // 生产入库：来源序号列是 000，真正的工单序号在 RCB027
  'SGMRCB.RCB021:81': { fromCode: 'RCB025', fromNo: 'RCB026', fromSeq: 'RCB027' },
  // 生产入库工单信息档：来源序号列是 000，行序号在 RCC022
  'SGMRCC.RCC003:81': { fromCode: 'RCC012', fromNo: 'RCC013', fromSeq: 'RCC022' }
};

const IGNORED_SOURCE_CODES = new Set(['18A', '18B', '35']);

function descOf(c) { return String(c.desc || '').trim(); }

// 在一张表的列里找出所有「来源三件套」
function findTriplets(cols) {
  const codes = cols.filter(c => /^(前置来源|单据来源|来源|来源类别|前置来源\(预留\))$/.test(descOf(c)));
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
    { from: 'SGMRFA', to: 'SGMREA', fromNo: 'RFA006', fromSeq: null, fromCode: null, code: null, status: 'adapter', hits: 1, samples: 1 },
    // 委外单 -> 工单（源工单）
    { from: 'SGMREA', to: 'SGMRAA', fromNo: 'REA014', fromSeq: null, fromCode: null, code: null, status: 'adapter', hits: 1, samples: 1 },
    // 生产入库单 -> 工单（工单单号）
    { from: 'SGMRCA', to: 'SGMRAA', fromNo: 'RCA007', fromSeq: null, fromCode: null, code: null, status: 'adapter', hits: 1, samples: 1 },
    { from: 'SGMRCB', to: 'SGMRAB', fromNo: 'RCB026', fromSeq: 'RCB027', fromCode: null, code: null, status: 'adapter', hits: 1, samples: 1 },
    // 生产检验单身 -> 工单（来源单号，81=工单）
    { from: 'QMSMAB', to: 'SGMRAA', fromNo: 'MAB006', fromSeq: null, fromCode: null, code: null, status: 'adapter', hits: 1, samples: 1 },
    // 领/退料单 -> 工单
    { from: 'SGMRBA', to: 'SGMRAA', fromNo: 'RBA006', fromSeq: null, fromCode: null, code: null, status: 'adapter', hits: 1, samples: 1 },
    { from: 'SGMRBB', to: 'SGMRAB', fromNo: 'RBB010', fromSeq: 'RBB011', fromCode: null, code: null, status: 'adapter', hits: 1, samples: 1 },
    // 重工单 -> 工单（来源工单单号）
    { from: 'SGMRKA', to: 'SGMRAA', fromNo: 'RKA010', fromSeq: null, fromCode: null, code: null, status: 'adapter', hits: 1, samples: 1 }
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

  return {
    version: REGISTRY_VERSION,
    generatedAt: new Date().toISOString(),
    docs,
    links,
    allCodes,
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

function findAllPaths(registry, from, to, maxDepth = 9) {
  if (!registry || !from || !to) return [];
  const adj = buildAdj(registry);
  const out = [];
  const dfs = (node, path, visited) => {
    if (out.length >= 20 || path.length > maxDepth) return;
    if (node === to) { if (path.length) out.push(path); return; }
    for (const e of (adj[node] || [])) {
      if (visited.has(e.to)) continue;
      visited.add(e.to);
      dfs(e.to, path.concat([{ from: node, ...e }]), visited);
      visited.delete(e.to);
    }
  };
  dfs(from, [], new Set([from]));
  return out;
}

module.exports = { REGISTRY_VERSION, buildRegistry, findPath, findAllPaths };
