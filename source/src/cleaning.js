// 数据清洗模块：解析易助模板、映射来源列、校验并生成 XLS 导入包。
// 依赖本机 Excel（COM），不写业务数据库。
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const MAX_UPLOAD = 30 * 1024 * 1024;
const JOB_KEEP_MS = 7 * 24 * 3600 * 1000;

const PS_SCRIPT = String.raw`param(
  [string]$Action,
  [string]$InputJson,
  [string]$OutputJson
)
$ErrorActionPreference = 'Stop'
function Write-Result($obj) {
  $json = $obj | ConvertTo-Json -Depth 12 -Compress
  [IO.File]::WriteAllText($OutputJson, $json, (New-Object System.Text.UTF8Encoding($false)))
}
function Cell-Text($ws, $r, $c) {
  try { return [string]$ws.Cells.Item($r, $c).Text } catch { return '' }
}
function Fill-Green($cell) {
  try {
    $v = [int]$cell.Interior.Color
    $r = $v -band 255; $g = ($v -shr 8) -band 255; $b = ($v -shr 16) -band 255
    return ($g -ge 150 -and $g -gt ($r + 20) -and $g -gt ($b + 10))
  } catch { return $false }
}
$xl = $null
try {
  $in = Get-Content -LiteralPath $InputJson -Raw -Encoding UTF8 | ConvertFrom-Json
  $xl = New-Object -ComObject Excel.Application
  $xl.Visible = $false
  $xl.DisplayAlerts = $false
  $xl.AutomationSecurity = 3

  if ($Action -eq 'parse') {
    $file = [string]$in.file
    $wb = $xl.Workbooks.Open($file, 0, $true)
    try {
      $ws = $wb.Worksheets.Item(1)
      $used = $ws.UsedRange
      $firstRow = [int]$used.Row
      $lastRow = [Math]::Min([int]$used.Row + [int]$used.Rows.Count - 1, 20000)
      $lastCol = [Math]::Min([int]$used.Column + [int]$used.Columns.Count - 1, 300)
      $template = [bool]$in.template
      $headerRow = 1
      $nameRow = 2
      $dataStart = 3
      if (-not $template) {
        $dataStart = $firstRow + 1
        for ($r = $firstRow; $r -le [Math]::Min($firstRow + 9, $lastRow); $r++) {
          $nonEmpty = 0
          for ($c = 1; $c -le $lastCol; $c++) { if ((Cell-Text $ws $r $c).Trim() -ne '') { $nonEmpty++ } }
          if ($nonEmpty -ge 2) { $headerRow = $r; $nameRow = 0; $dataStart = $r + 1; break }
        }
      }
      $cols = @()
      for ($c = 1; $c -le $lastCol; $c++) {
        $cell = $ws.Cells.Item($headerRow, $c)
        $comment = ''
        try { if ($null -ne $cell.Comment) { $comment = [string]$cell.Comment.Text() } } catch {}
        $name = if ($nameRow -gt 0) { Cell-Text $ws $nameRow $c } else { Cell-Text $ws $headerRow $c }
        $name = ($name.Split([char]10)[0]).Replace([string][char]13,'').Trim()
        if ($name.Length -gt 60) { $name = $name.Substring(0,60) }
        $cols += [ordered]@{
          index = $c
          code = (Cell-Text $ws $headerRow $c).Trim()
          name = $name
          comment = $comment.Trim()
          green = (Fill-Green $cell)
          required = (($comment -match '必须输入|必须|必填|必需|必要') -and ($comment -notmatch '非必要|非必须|不必要|非必填'))
        }
      }
      $rows = @()
      for ($r = $dataStart; $r -le $lastRow; $r++) {
        $arr = @()
        $any = $false
        for ($c = 1; $c -le $lastCol; $c++) {
          $v = (Cell-Text $ws $r $c).Trim()
          if ($v -ne '') { $any = $true }
          $arr += $v
        }
        if ($any) { $rows += ,$arr }
      }
      $sample = @()
      for ($i = 0; $i -lt [Math]::Min($rows.Count, 30); $i++) { $sample += ,$rows[$i] }
      Write-Result ([ordered]@{
        ok = $true
        sheet = [string]$ws.Name
        fileName = [IO.Path]::GetFileName($file)
        template = $template
        headerRow = $headerRow
        dataStartRow = $dataStart
        columns = $cols
        rowCount = $rows.Count
        rows = $rows
        sample = $sample
      })
    } finally {
      $wb.Close($false)
    }
  }
  elseif ($Action -eq 'generate') {
    $out = [string]$in.output
    if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
    Copy-Item -LiteralPath ([string]$in.template) -Destination $out
    $wb = $xl.Workbooks.Open($out, 0, $false)
    try {
      $ws = $wb.Worksheets.Item(1)
      $start = [int]$in.dataStart
      $last = [int]$ws.UsedRange.Row + [int]$ws.UsedRange.Rows.Count - 1
      $lastCol = [Math]::Min([int]$ws.UsedRange.Column + [int]$ws.UsedRange.Columns.Count - 1, 300)
      if ($last -ge $start) {
        $ws.Range($ws.Cells.Item($start, 1), $ws.Cells.Item($last, $lastCol)).ClearContents()
      }
      $types = @($in.types)
      $cols = @($in.columns)
      for ($ri = 0; $ri -lt @($in.rows).Count; $ri++) {
        $row = @($in.rows[$ri])
        for ($ci = 0; $ci -lt $cols.Count; $ci++) {
          $v = $row[$ci]
          $cell = $ws.Cells.Item($start + $ri, [int]$cols[$ci])
          if ($null -eq $v -or [string]$v -eq '') {
            $cell.ClearContents()
          } else {
            $type = if ($ci -lt $types.Count) { [string]$types[$ci] } else { 'text' }
            try {
              if ($type -eq 'number' -and ($v -is [int] -or $v -is [long] -or $v -is [double] -or $v -is [decimal])) {
                $cell.Value2 = [double]$v
              } else {
                $sv = [string]$v
                if ($sv.StartsWith('=')) { $sv = "'" + $sv }
                $cell.Value2 = $sv
              }
            } catch {
              throw ("写入第 {0} 行第 {1} 列失败（type={2}, value={3}）：{4}" -f ($start + $ri), $cols[$ci], $type, $v, $_.Exception.Message)
            }
          }
        }
      }
      $wb.Save()
    } finally {
      $wb.Close($false)
    }
    Write-Result ([ordered]@{ ok = $true; output = $out })
  }
  else {
    throw ('未知动作: ' + $Action)
  }
}
catch {
  try { Write-Result ([ordered]@{ ok = $false; error = $_.Exception.Message; detail = $_.ScriptStackTrace }) }
  catch { Write-Output ('ERROR: ' + $_.Exception.Message) }
}
finally {
  if ($null -ne $xl) {
    try { $xl.Quit() } catch {}
    try { [Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null } catch {}
    [GC]::Collect()
  }
}
`;

function safeName(name, fallback) {
  const base = path.basename(String(name || fallback || 'file'));
  const clean = base.replace(/[\\/:*?"<>|]/g, '_').replace(/\.+$/, '');
  return clean || fallback || 'file';
}

function extOf(name) {
  return path.extname(String(name || '')).toLowerCase();
}

function normText(s) {
  return String(s == null ? '' : s)
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[（）()【】\[\]{}：:，,。.;；、_-]/g, '')
    .replace(/公司$|有限公司$/g, '')
    .toLowerCase();
}

function cleanText(s) {
  return String(s == null ? '' : s)
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumber(v) {
  if (v == null || String(v).trim() === '') return { empty: true };
  const s = cleanText(v).replace(/,/g, '').replace(/[¥￥元]/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { error: '不是有效数字: ' + v };
  return { value: Number(s) };
}

function parseDate(v) {
  if (v == null || String(v).trim() === '') return { empty: true };
  const s = cleanText(v).replace(/[年月]/g, '-').replace(/日/g, '').replace(/[./]/g, '-');
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return { error: '日期无法识别: ' + v };
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return { error: '日期无效: ' + v };
  return { value: y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0') };
}

function transformValue(raw, kind) {
  const v = cleanText(raw);
  if (!v) return { empty: true };
  if (kind === 'ratio') {
    const m = v.match(/^([0-9]+(?:\.[0-9]+)?)\s*:\s*([0-9]+(?:\.[0-9]+)?)$/);
    if (m) {
      const a = Number(m[1]), b = Number(m[2]);
      if (b) return { value: a / b };
    }
    return parseNumber(v);
  }
  if (kind === 'number') return parseNumber(v);
  if (kind === 'date') return parseDate(v);
  if (kind === 'phone') return { value: v.replace(/[^\d+\-() ]/g, '').trim() };
  return { value: v };
}

const SYNONYMS = {
  '客户编码': ['客户编码', '客户编号', '客户代码', '客户号', '客户id'],
  '客户简称': ['客户简称', '客户名称', '客户名', '客户', '简称'],
  '业务员': ['业务员', '销售员', '业务人员', '销售'],
  '联系人': ['联系人', '联络人', '对接人', '联系人姓名'],
  '电话': ['电话', '联系电话', '手机', '手机号', '联系方式'],
  '地址': ['地址', '客户地址', '联系地址', '送货地址', '收货地址', '注册地址'],
  '邮箱': ['email', '邮箱', '电子邮箱', '邮件', '电子邮件'],
  '商品编号': ['商品编号', '品号', '物料编码', '产品编码', '存货编码', '商品编码'],
  '商品名称': ['商品名称', '品名', '物料名称', '产品名称', '存货名称', '商品名'],
  '单位': ['库存单位', '单位', '计量单位', '主单位'],
  '主件品号': ['主件', '主件品号', '母件', '父件', '主产品'],
  '子件品号': ['元件', '子件', '子件品号', '组件', '用料'],
  '组成用量': ['组成用量', '用量', '组成量', '单位用量'],
  '替代料': ['替代料', '替代件', '替代物料'],
  '人工分摊权数': ['人工权数', '人工分摊权数', '人工费用权数'],
  '制费分摊权数': ['制费权数', '制造费用权数', '制费分摊权数']
};

function findSynonym(targetName) {
  const n = normText(targetName);
  if (!n) return null;
  for (const [key, list] of Object.entries(SYNONYMS)) {
    if (n === normText(key) || list.some(x => normText(x) === n)) return list;
  }
  return null;
}

function sourceMatch(templateCol, sourceCols, sourceRows) {
  const tName = templateCol.name || templateCol.code;
  const tn = normText(tName);
  const aliases = findSynonym(tName) || [];
  const candidates = [];
  sourceCols.forEach(sc => {
    const sn = normText(sc.name || sc.code);
    if (!sn) return;
    if (sn === tn || aliases.some(a => sn === normText(a))) candidates.push({ col: sc, score: 100 });
    else if (aliases.some(a => sn.includes(normText(a)) || normText(a).includes(sn))) candidates.push({ col: sc, score: 80 });
    else if (tn && (sn.includes(tn) || tn.includes(sn))) candidates.push({ col: sc, score: 60 });
  });
  candidates.sort((a, b) => b.score - a.score || a.col.index - b.col.index);
  if (candidates.length) return candidates[0].col.index;
  // 无表头列按内容识别邮箱/电话
  const lower = tn;
  if (lower.includes('邮件') || lower.includes('邮箱') || lower.includes('email')) {
    for (const sc of sourceCols) {
      if (sc.name || sc.code) continue;
      let hits = 0, non = 0;
      for (const row of sourceRows.slice(0, 30)) {
        const v = String(row[sc.index - 1] || '');
        if (!v) continue;
        non++;
        if (v.includes('@')) hits++;
      }
      if (non && hits / non >= 0.5) return sc.index;
    }
  }
  if (lower.includes('电话') || lower.includes('手机')) {
    for (const sc of sourceCols) {
      if (sc.name || sc.code) continue;
      let hits = 0, non = 0;
      for (const row of sourceRows.slice(0, 30)) {
        const v = String(row[sc.index - 1] || '');
        if (!v) continue;
        non++;
        if (v.replace(/\D/g, '').length >= 6) hits++;
      }
      if (non && hits / non >= 0.5) return sc.index;
    }
  }
  return null;
}

function profileOf(template) {
  const codes = new Set((template.columns || []).map(c => c.code));
  if (codes.has('DFA001')) return 'TPADFA';
  if (codes.has('DEA001')) return 'TPADEA';
  if (codes.has('QAA001')) return 'SGMQAA';
  return 'GENERIC';
}

function keyCodes(template) {
  const codes = (template.columns || []).map(c => c.code);
  if (codes.includes('DFA001')) return ['DFA001'];
  if (codes.includes('DEA001')) return ['DEA001'];
  if (codes.includes('QAA001') && codes.includes('QAB003')) return ['QAA001', 'QAB003'];
  const guess = codes.filter(c => /^\w{3}001$/.test(c));
  return guess.length ? [guess[0]] : [];
}

function presetFor(template) {
  const profile = profileOf(template);
  const p = { profile, defaults: {}, derived: {}, transforms: {}, note: {}, optional: new Set(), ignore: new Set(), noAuto: new Set(), autoAliases: {} };
  if (profile === 'TPADFA') {
    Object.assign(p.defaults, {
      DFA009: 'F', DFA029: 'RMB', DFA030: '0', DFA033: 'A', DFA034: '1',
      DFA035: '0', DFA036: '31', DFA037: '0', DFA038: '31', DFA039: '1',
      DFA040: '0', DFA041: '31', DFA042: '1', DFA043: '0', DFA044: '0',
      DFA045: '31', DFA048: '1', DFA073: '0.13', DFA074: '1', DFA121: 'F', DFA122: 'F'
    });
    p.autoAliases.DFA009 = ['国外客户否', '是否国外客户', '国外客户', '海外客户', '出口客户'];
    // 选项/开关字段只允许精确的专用别名，不能被“业务员/客户简称”等泛化列误配。
    p.noAuto = new Set(['DFA009', 'DFA007', 'DFA013', 'DFA030', 'DFA033', 'DFA043', 'DFA046',
      'DFA049', 'DFA051', 'DFA052', 'DFA055', 'DFA073', 'DFA074', 'DFA077', 'DFA105',
      'DFA110', 'DFA111', 'DFA112', 'DFA121', 'DFA122', 'DFA123']);
    p.optional = new Set(['DFA046', 'DFA105', 'DFA110', 'DFA111', 'DFA112', 'DFA123']);
    p.ignore = new Set(['DFA046', 'DFA105', 'DFA110', 'DFA111', 'DFA112', 'DFA123']);
    p.autoAliases.DFA003 = ['客户全称', '客户全名', '客户名称全称', '客户名称'];
    p.derived.DFA004 = 'DFA001';
    p.transforms.DFA016 = 'phone';
    p.transforms.DFA073 = 'number';
    p.transforms.DFA009 = 'text';
    p.note.DFA073 = '税率按用户确认填 0.13；易助存 0.130000';
    p.note.DFA046 = '伪必填，按用户要求留空';
    p.note.DFA105 = '伪必填，按用户要求留空';
    p.note.DFA110 = '伪必填，按用户要求留空';
    p.note.DFA111 = '伪必填，按用户要求留空';
    p.note.DFA112 = '伪必填，按用户要求留空';
  } else if (profile === 'TPADEA') {
    Object.assign(p.defaults, {
      DEA007: 'T', DEA013: 'F', DEA017: 'T', DEA030: 'B', DEA033: 'F',
      DEA043: 'T', DEA046: 'F', DEA049: 'F', DEA051: 'F', DEA052: 'F',
      DEA055: 'F', DEA073: 'F', DEA074: 'F', DEA077: 'T'
    });
    p.derived.DEA044 = 'DEA003';
    p.derived.DEA078 = 'DEA003';
    p.transforms.DEA047 = 'number';
    p.transforms.DEA048 = 'number';
    p.transforms.DEA073 = 'text';
    p.note.DEA047 = '人工权数，按来源数值写入';
    p.note.DEA048 = '制费权数，按来源数值写入';
  } else if (profile === 'SGMQAA') {
    Object.assign(p.defaults, { QAA003: '1', QAB005: '1', QAB006: '1', QAB007: '0' });
    p.transforms.QAA003 = 'number';
    p.transforms.QAB005 = 'ratio';
    p.transforms.QAB006 = 'number';
    p.transforms.QAB007 = 'number';
    p.note.QAA003 = '模板要求批量>0，默认 1';
    p.note.QAB005 = '源表组成用量 1:1，填 1';
    p.note.QAB006 = '模板默认底数 1';
    p.note.QAB007 = '损耗率默认 0';
  }
  return p;
}

function transformFor(templateCol, preset) {
  if (preset.transforms[templateCol.code]) return preset.transforms[templateCol.code];
  const n = templateCol.name || '';
  if (/日期/.test(n)) return 'date';
  if (/(金额|价格|税率|比例|数量|用量|权数|额度|天数|月数|人数|注册资本|营业额)/.test(n)) return 'number';
  if (/(电话|手机)/.test(n)) return 'phone';
  return 'text';
}

function inspectService(baseDir) {
  const root = path.join(baseDir, 'cleaning');
  fs.mkdirSync(root, { recursive: true });
  return {
    root,
    async runExcel(action, input) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'momo-clean-'));
      const script = path.join(tmp, 'excel.ps1');
      const inFile = path.join(tmp, 'in.json');
      const outFile = path.join(tmp, 'out.json');
      fs.writeFileSync(script, '\ufeff' + PS_SCRIPT, 'utf8');
      fs.writeFileSync(inFile, JSON.stringify(input), 'utf8');
      try {
        await new Promise((resolve, reject) => {
          const cp = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', action, '-InputJson', inFile, '-OutputJson', outFile], { windowsHide: true });
          let err = '';
          cp.stderr.on('data', d => { err += d.toString('utf8'); });
          const timer = setTimeout(() => { try { cp.kill(); } catch (_) {} reject(new Error('Excel 处理超时')); }, 120000);
          cp.on('error', e => { clearTimeout(timer); reject(e); });
          cp.on('exit', code => {
            clearTimeout(timer);
            if (code !== 0) return reject(new Error('Excel 处理失败: ' + (err || 'exit ' + code)));
            resolve();
          });
        });
        if (!fs.existsSync(outFile)) throw new Error('Excel 未返回结果');
        let raw = fs.readFileSync(outFile, 'utf8').replace(/^\uFEFF/, '');
        const out = JSON.parse(raw);
        if (!out.ok) throw new Error((out.error || 'Excel 处理失败') + (out.detail ? ' | ' + out.detail : ''));
        return out;
      } finally {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
      }
    },
    suggest(template, source) {
      const preset = presetFor(template);
      const keys = keyCodes(template);
      const columns = template.columns.map(c => {
        let defaultValue = preset.defaults[c.code] || '';
        let derivedFrom = preset.derived[c.code] || '';
        if (!derivedFrom && ['DFA023', 'DFA025', 'DFA027'].includes(c.code) && preset.defaults[c.code] == null) {
          // 地址三列统一：优先使用 DFA023 的来源
          if (c.code !== 'DFA023') derivedFrom = 'DFA023';
        }
        const exactSource = source.columns.find(sc =>
          normText(sc.name || sc.code) === normText(c.name) || normText(sc.code) === normText(c.code));
        let sourceIndex = preset.ignore.has(c.code)
          ? null
          : preset.noAuto.has(c.code)
            ? (exactSource ? exactSource.index : null)
            : sourceMatch(c, source.columns, source.rows);
        if (preset.autoAliases[c.code]) {
          const aliases = preset.autoAliases[c.code].map(normText);
          const hit = source.columns.find(sc => {
            const sn = normText(sc.name || sc.code);
            return sn && aliases.some(a => sn === a || sn.includes(a) || a.includes(sn));
          });
          sourceIndex = hit ? hit.index : null;
        }
        if (derivedFrom) sourceIndex = null;
        return {
          code: c.code,
          name: c.name,
          comment: c.comment,
          index: c.index,
          green: !!c.green,
          required: !!c.required && !preset.optional.has(c.code),
          sourceIndex,
          transform: transformFor(c, preset),
          defaultValue,
          derivedFrom,
          note: preset.note[c.code] || ''
        };
      });
      return {
        profile: preset.profile,
        keyCodes: keys,
        columns
      };
    },
    async inspect(body) {
      const jobId = crypto.randomUUID();
      const jobDir = path.join(root, 'jobs', jobId);
      fs.mkdirSync(jobDir, { recursive: true });
      const save = (key, file) => {
        if (!file || !file.data) throw new Error('缺少' + key + '文件');
        const name = safeName(file.name, key + '.xlsx');
        const ext = extOf(name);
        if (!['.xls', '.xlsx', '.xlsm'].includes(ext)) throw new Error(key + ' 仅支持 .xls / .xlsx');
        const buf = Buffer.from(String(file.data), 'base64');
        if (buf.length > MAX_UPLOAD) throw new Error(key + ' 文件超过 30MB');
        const p = path.join(jobDir, key + ext);
        fs.writeFileSync(p, buf);
        return { path: p, name };
      };
      const tFile = save('template', body.template);
      const sFile = save('source', body.source);
      try {
        const template = await this.runExcel('parse', { file: tFile.path, template: true });
        const source = await this.runExcel('parse', { file: sFile.path, template: false });
        const suggested = this.suggest(template, source);
        const manifest = {
          jobId, createdAt: Date.now(),
          templatePath: tFile.path, sourcePath: sFile.path,
          templateName: tFile.name, sourceName: sFile.name,
          template, source, suggested
        };
        fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify(manifest), 'utf8');
        return {
          ok: true, jobId,
          template: { fileName: template.fileName, sheet: template.sheet, columns: template.columns, rowCount: template.rowCount, dataStartRow: template.dataStartRow },
          source: { fileName: source.fileName, sheet: source.sheet, columns: source.columns, rowCount: source.rowCount, sample: source.sample },
          suggested
        };
      } catch (e) {
        throw new Error(e.message + '（请确认本机已安装 Microsoft Excel）');
      }
    },
    loadJob(jobId) {
      if (!/^[a-f0-9-]{20,}$/i.test(String(jobId || ''))) throw new Error('任务号无效');
      const f = path.join(root, 'jobs', jobId, 'job.json');
      if (!fs.existsSync(f)) throw new Error('任务不存在，请重新读取文件');
      return JSON.parse(fs.readFileSync(f, 'utf8'));
    },
    applyMapping(job, mappingIn, options) {
      const mapping = Array.isArray(mappingIn) ? mappingIn : [];
      const byCode = new Map(mapping.map(m => [String(m.code), m]));
      const cols = job.template.columns;
      const srcCols = job.source.columns;
      const preset = presetFor(job.template);
      const keyCols = keyCodes(job.template);
      const sourceRows = job.source.rows || [];
      const resultRows = [];
      const issues = [];
      const keySeen = new Map();

      const getSourceValue = (row, sourceIndex) => {
        if (sourceIndex == null || sourceIndex === '') return '';
        const idx = Number(sourceIndex) - 1;
        if (idx < 0) return '';
        return row[idx] == null ? '' : row[idx];
      };
      const colByCode = new Map(cols.map(c => [c.code, c]));

      sourceRows.forEach((src, ri) => {
        const rowNo = ri + 1;
        const values = {};
        const errors = [];
        const warnings = [];
        // 先处理直接来源与默认值
        cols.forEach(c => {
          const m = byCode.get(c.code) || {};
          let raw = '';
          if (m.sourceIndex != null && m.sourceIndex !== '') raw = getSourceValue(src, m.sourceIndex);
          if ((raw == null || String(raw).trim() === '') && m.defaultValue != null) raw = m.defaultValue;
          if (raw == null || String(raw).trim() === '') {
            values[c.code] = '';
            return;
          }
          const tr = transformValue(raw, m.transform || transformFor(c, preset));
          if (tr.error) {
            errors.push({ row: rowNo, code: c.code, name: c.name, severity: 'error', message: tr.error });
            values[c.code] = '';
          } else if (tr.empty) {
            values[c.code] = '';
          } else {
            values[c.code] = tr.value;
          }
        });
        // 派生字段（如 DFA004=DFA001、地址统一）
        cols.forEach(c => {
          const m = byCode.get(c.code) || {};
          if (!m.derivedFrom) return;
          const v = values[m.derivedFrom];
          if ((values[c.code] == null || values[c.code] === '') && v != null && String(v) !== '') values[c.code] = v;
        });
        // 必填校验（以映射后的 required 为准，模板伪必填可关闭）
        cols.forEach(c => {
          const m = byCode.get(c.code) || {};
          if (!(m.required != null ? m.required : c.required)) return;
          if (values[c.code] == null || String(values[c.code]).trim() === '') {
            errors.push({ row: rowNo, code: c.code, name: c.name, severity: 'error', message: '必填字段为空' });
          }
        });
        // 主键重复
        const keyVals = keyCols.map(k => String(values[k] == null ? '' : values[k]).trim());
        if (keyVals.length && keyVals.every(Boolean)) {
          const key = keyVals.join('\u0001');
          if (keySeen.has(key)) {
            errors.push({ row: rowNo, code: keyCols.join('+'), name: '主键', severity: 'error', message: '与第 ' + keySeen.get(key) + ' 行重复' });
          } else keySeen.set(key, rowNo);
        }
        issues.push(...errors, ...warnings);
        resultRows.push({ rowNo, values, errors, warnings });
      });

      // 模板中非必填但完全未映射的字段给出提示（最多 12 条）
      let unmapped = 0;
      cols.forEach(c => {
        const m = byCode.get(c.code) || {};
        const required = m.required != null ? m.required : c.required;
        if (!required && (m.sourceIndex == null || m.sourceIndex === '') && !m.defaultValue && !m.derivedFrom) unmapped++;
      });
      if (unmapped) issues.push({ row: 0, code: '', name: '字段映射', severity: 'info', message: '有 ' + unmapped + ' 个非必填字段未映射，生成后保持模板原值/空白' });

      const errors = issues.filter(x => x.severity === 'error');
      const warnings = issues.filter(x => x.severity === 'warning');
      return {
        rows: resultRows,
        issues,
        stats: {
          sourceRows: sourceRows.length,
          outputRows: resultRows.length,
          errors: errors.length,
          warnings: warnings.length,
          unmapped
        },
        keyCodes: keyCols,
        mapping: cols.map(c => {
          const m = byCode.get(c.code) || {};
          return {
            code: c.code, name: c.name, required: !!c.required, green: !!c.green,
            sourceIndex: m.sourceIndex == null ? null : Number(m.sourceIndex),
            transform: m.transform || transformFor(c, preset),
            defaultValue: m.defaultValue || '',
            derivedFrom: m.derivedFrom || '',
            note: m.note || ''
          };
        })
      };
    },
    async preview(body) {
      const job = this.loadJob(body.jobId);
      return this.applyMapping(job, body.mapping, body.options || {});
    },
    async generate(body) {
      const job = this.loadJob(body.jobId);
      const result = this.applyMapping(job, body.mapping, body.options || {});
      const opts = body.options || {};
      if (result.stats.errors > 0 && !opts.allowErrors) {
        const e = new Error('存在 ' + result.stats.errors + ' 条硬错误，请修正或勾选“忽略硬错误”后再生成');
        e.code = 'VALIDATION';
        e.validation = result;
        throw e;
      }
      const jobDir = path.join(root, 'jobs', job.jobId);
      const outDir = path.join(jobDir, 'out');
      fs.mkdirSync(outDir, { recursive: true });
      const ts = new Date();
      const pad = n => String(n).padStart(2, '0');
      const stamp = ts.getFullYear() + pad(ts.getMonth() + 1) + pad(ts.getDate()) + '_' + pad(ts.getHours()) + pad(ts.getMinutes()) + pad(ts.getSeconds());
      const profile = profileOf(job.template);
      const base = profile === 'GENERIC' ? '数据导入包' : profile + '_导入包';
      const xlsPath = path.join(outDir, base + '_' + stamp + '.xls');

      // 只写入“有映射/默认/派生”的列；保留模板其它列原有内容
      const outputCols = [];
      const types = [];
      const templateCols = job.template.columns;
      const byCode = new Map((body.mapping || []).map(m => [String(m.code), m]));
      templateCols.forEach(c => {
        const m = byCode.get(c.code) || {};
        if (m.sourceIndex != null && m.sourceIndex !== '' || m.defaultValue || m.derivedFrom) {
          outputCols.push(c.index);
          types.push(m.transform || transformFor(c, presetFor(job.template)));
        }
      });
      const rows = result.rows.map(r => outputCols.map((idx, i) => {
        const c = templateCols.find(x => x.index === idx);
        return c ? r.values[c.code] : '';
      }));
      await this.runExcel('generate', {
        template: job.templatePath,
        output: xlsPath,
        dataStart: job.template.dataStartRow || 3,
        columns: outputCols,
        types,
        rows
      });

      const manifestPath = path.join(outDir, 'result.json');
      fs.writeFileSync(manifestPath, JSON.stringify({ xlsPath, stats: result.stats, createdAt: Date.now() }), 'utf8');
      return { ok: true, jobId: job.jobId, xlsPath, stats: result.stats, issues: result.issues.slice(0, 100), mapping: result.mapping };
    }
  };
}

module.exports = { createCleaningService: inspectService, _internals: { cleanText, parseNumber, parseDate, transformValue, keyCodes, profileOf } };
