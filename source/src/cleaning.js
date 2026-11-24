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
// 每个模板独立保存一份批注规则；版本号变化时重新生成，避免旧规则残留。
const RULES_VERSION = 2;

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
          required = (($comment -match '必须输入|必须|必填|必需|必要|不可空白|不能为空|不允许为空') -and
            ($comment -notmatch '非必要|非必须|不必要|非必填') -and
            ($comment -notmatch '否则[^。；\n]{0,30}(空白|为空|不输入)|空白不需要输入'))
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
      # 低置信度/简称匹配的单元格标黄，提示人工确认；硬错误不会走到这里。
      foreach ($m in @($in.marks)) {
        if ($null -eq $m) { continue }
        try {
          $ws.Cells.Item([int]$m.row, [int]$m.col).Interior.Color = [int]$m.color
        } catch {}
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
  const ratio = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*:\s*([0-9]+(?:\.[0-9]+)?)$/);
  if (ratio) {
    const b = Number(ratio[2]);
    if (b) return { value: Number(ratio[1]) / b };
  }
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
  if (kind === 'deptFlag') {
    if (/^[TtFf]$/.test(v)) return { value: v.toUpperCase() };
    if (/单一|单部门|一个部门/.test(v)) return { value: 'F' };
    if (/多部门|多人|分摊/.test(v)) return { value: 'T' };
    return { value: v };
  }
  if (kind === 'number') return parseNumber(v);
  if (kind === 'date') return parseDate(v);
  if (kind === 'phone') return { value: v.replace(/[^\d+\-() ]/g, '').trim() };
  return { value: v };
}

const SYNONYMS = {
  '客户编码': ['客户编码', '客户编号', '客户代码', '客户号', '客户id'],
  '客户简称': ['客户简称', '客户名称', '客户名', '客户', '简称'],
  '国外客户否': ['国外客户否', '是否国外客户', '国外客户', '海外客户', '出口客户'],
  '业务员': ['业务员', '销售员', '业务人员', '销售'],
  '联系人': ['联系人', '联络人', '对接人', '联系人姓名'],
  '电话': ['电话', '联系电话', '手机', '手机号', '联系方式'],
  '地址': ['地址', '客户地址', '联系地址', '送货地址', '收货地址', '注册地址'],
  '邮箱': ['email', '邮箱', '电子邮箱', '邮件', '电子邮件'],
  '商品编号': ['商品编号', '品号', '料号', '料品编号', '物料编码', '物料号', '产品编码', '产品料号', '存货编码', '存货编号', '商品编码'],
  '商品名称': ['商品名称', '品名', '料品名称', '物料名称', '产品名称', '存货名称', '商品名'],
  '单位': ['库存单位', '单位', '计量单位', '主单位'],
  '主件品号': ['主件', '主件品号', '母件', '父件', '主产品'],
  '子件品号': ['元件', '子件', '子件品号', '组件', '用料'],
  '组成用量': ['组成用量', '用量', '组成量', '单位用量'],
  '替代料': ['替代料', '替代件', '替代物料'],
  '人工分摊权数': ['人工权数', '人工分摊权数', '人工费用权数'],
  '制费分摊权数': ['制费权数', '制造费用权数', '制费分摊权数'],
  '主要来源': ['主要来源', '商品来源', '货源', '来源类型', '商品主要来源', '物料来源'],
  '主供应商': ['主供应商', '主供货商', '供应商', '默认供应商', '委外供应商', '默认供应商或委外供应商', '供应商名称', '厂商'],
  '商品分类': ['商品分类', '存货分类', '物料分类', '产品分类'],
  '是否含税': ['是否含税', '含税', '含税否'],
  // 固定资产期初卡片
  '资产编号': ['资产编号', '财产编码', '资产编码', '固定资产编号', '财产编号'],
  '资产名称': ['资产名称', '财产名称', '固定资产名称', '资产名'],
  '资产类别': ['资产类别', '资产分类', '固定资产类别', '财产类别'],
  '折旧方法': ['折旧方法', '折旧方式', '折旧法'],
  '使用年限': ['使用年限', '总年数', '总年数以月表示', '总年数(以月表示)', '折旧年限'],
  '已计提月份': ['已计提月份', '已使用年数', '已使用年数以月表示', '已使用年数(以月表示)', '已使用月数'],
  '计量单位': ['计量单位', '计数单位', '单位'],
  '本币原值': ['本币原值', '原始成本', '原始成本计价单位元', '原值', '资产原值'],
  '累计折旧': ['累计折旧', '已提折旧'],
  '残值率': ['残值率', '净残值率'],
  '多部门使用': ['多部门使用', '费用分摊方式', '分摊方式'],
  '使用部门': ['使用部门', '使用部门编码', '部门编码', '部门'],
  '保管人': ['保管人', '保管员', '责任人'],
  '增加方式': ['增加方式', '增加方式代码', '取得方式']
};

// 系统资料档：字段有“需存在于 XX 档”或字段名明确指向主档时，界面用数据库现有值做下拉。
// 这里只登记能确定代码/名称列的只读主档，查询时仍按白名单校验表名。
const MASTER_TABLES = {
  TPADAA: { table: 'TPADAA', code: 'DAA001', name: 'DAA002', label: '部门' },
  TPADBA: { table: 'TPADBA', code: 'DBA001', name: 'DBA002', label: '人员' },
  TPADEA: { table: 'TPADEA', code: 'DEA001', name: 'DEA002', label: '商品' },
  TPADED: { table: 'TPADED', code: 'DED001', name: 'DED002', label: '商品分类' },
  TPADFA: { table: 'TPADFA', code: 'DFA001', name: 'DFA002', label: '客户' },
  TPADGA: { table: 'TPADGA', code: 'DGA001', name: 'DGA002', label: '供应商' },
  ZCSTAA: { table: 'ZCSTAA', code: 'TAA001', name: 'TAA002', label: '增减方式' },
  ZCSTBA: { table: 'ZCSTBA', code: 'TBA001', name: 'TBA002', label: '资产类别' },
  ZCSTCA: { table: 'ZCSTCA', code: 'TCA001', name: 'TCA002', label: '使用状况' },
  ZCSTEA: { table: 'ZCSTEA', code: 'TEA001', name: 'TEA002', label: '折旧方法' }
};

function masterForField(fieldName, comment) {
  const n = cleanText(fieldName);
  const text = cleanText(comment);
  if (!n && !text) return null;
  // 选项控制类字段不是主档；避免把“指定主供应商”之类 T/F 字段做成资料档下拉。
  if (/^(指定|是否|按需|控制|管理)/.test(n)) return null;
  const hints = [
    [/资产类别|资产分类|固定资产类别|财产类别/, 'ZCSTBA'],
    [/折旧方法|折旧方式|折旧法/, 'ZCSTEA'],
    [/增加方式|增减方式|取得方式/, 'ZCSTAA'],
    [/使用状况/, 'ZCSTCA'],
    [/使用部门|部门编码|部门$/, 'TPADAA'],
    [/供应商|厂商|主供货商|主供应商/, 'TPADGA'],
    [/保管人|责任人|人员信息/, 'TPADBA'],
    [/商品分类|商品类别|存货分类/, 'TPADED'],
    [/客户(?:编号|编码|名称)?$/, 'TPADFA'],
    [/(?:^|[^指])商品(?:编号|编码|品号|名称)?$/, 'TPADEA']
  ];
  // 先按字段名判断，避免“使用年限”批注里提到折旧方法就被误当主档。
  let key = null;
  for (const [re, k] of hints) if (re.test(n)) { key = k; break; }
  if (!key) {
    // 只有明确的“需存在 XX 档”才算主档；泛泛提到表名不算。
    const table = text.match(/(?:需存在|必须存在|需存在于|必须存在于|存在于)\s*(TPAD[A-Z]{2}|ZCST[A-Z]{2})\s*档/i);
    if (table) key = table[1].toUpperCase();
  }
  if (!key || !MASTER_TABLES[key]) return null;
  const def = MASTER_TABLES[key];
  // 名称类字段（供应商名称、保管人姓名）要用名称值；编号类字段用代码值。
  return { ...def, valueField: /名称|姓名/.test(n) ? 'name' : 'code' };
}

// 从模板批注里提炼规则：必填、可选值、固定值。
// 例：T：是、F：否；1.零售价 / 2.定价一；请一律给预设值F。
function parseCommentRule(comment) {
  // 批注里的换行是“一行一个选项”的天然分隔，不能用 cleanText 把换行折叠掉。
  const text = String(comment == null ? '' : comment)
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\r/g, '')
    .replace(/\n+/g, ' / ')
    .replace(/[ \t]+/g, ' ')
    .trim();
  if (!text) return { required: false, options: [], fixed: false, defaultValue: '', sameAs: '' };
  const required = /必须输入|必须|必填|必需|必要|不可空白|不能为空|不允许为空/.test(text) &&
    !/非必要|非必须|不必要|非必填/.test(text) &&
    !/否则[^。；\n]{0,30}(空白|为空|不输入)|空白不需要输入/.test(text);
  const options = [];
  const add = (value, label) => {
    const v = cleanText(value);
    if (!v || v.length > 8) return;
    if (!options.some(o => o.value === v)) options.push({ value: v, label: cleanText(label || '') });
  };
  // “选项值 : + , -”这种写法
  const optionLine = text.match(/选项值\s*[:：]\s*([^\/]+)/);
  if (optionLine) {
    optionLine[1].split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean).forEach(x => add(x, ''));
  }
  for (const part of text.split(/[\/；;、，,\n\r]+/).map(x => x.trim()).filter(Boolean)) {
    let m = part.match(/^([A-Za-z0-9+\-]+)\s*[：:＝=.]\s*(.+)$/);
    if (m) { add(m[1], m[2]); continue; }
    // 只接受“数字 1 先进先出”这类数字枚举；不接受“EMAIL 40 非必要”这种列宽说明。
    m = part.match(/^([0-9]+(?:\.[0-9]+)?)\s+(.+)$/);
    if (m && !/非必要|必要|非必须|必须|长度|字段/.test(m[2])) add(m[1], m[2]);
  }
  if (!options.length) {
    // 只有整段都是纯代码（例如 T / F）才当作枚举，避免把说明文字误判。
    const tokens = text.split(/[\/、,，;；\s]+/).filter(Boolean);
    if (tokens.length >= 2 && tokens.length <= 8 && tokens.every(x => /^[A-Za-z0-9+\-]+$/.test(x))) {
      tokens.forEach(x => add(x, ''));
    }
  }
  // “只能为T或F”“只能1或2”这种夹在说明文字里的枚举。
  if (!options.length) {
    const only = text.match(/只能(?:为|是|填|输入)?\s*([A-Za-z0-9+\-]+)\s*或\s*([A-Za-z0-9+\-]+)/);
    if (only) { add(only[1], ''); add(only[2], ''); }
  }
  const fixedMatch = text.match(/(?:一律|统一|固定|预设值|只可|只允许|必须为|必须填|必须使用)\s*(?:(?:给|填|为|是|使用|设置|设为|预设值)\s*)*([A-Za-z0-9+\-]+)/);
  let fixed = !!fixedMatch;
  let defaultValue = fixedMatch ? fixedMatch[1] : '';
  if (!fixed && options.length === 1 && /(一律|统一|只能|固定|预设值|只可)/.test(text)) {
    fixed = true;
    defaultValue = options[0].value;
  }
  if (!defaultValue) {
    const d = options.find(o => /缺省|默认/.test(o.label || ''));
    if (d) defaultValue = d.value;
  }
  if (fixed && !options.some(o => o.value === defaultValue)) {
    options.unshift({ value: defaultValue, label: '' });
  }
  // “需要与库存单位相同”这类批注不写死具体字段代码，按字段名在当前模板内解析。
  const same = text.match(/(?:与|同)\s*([^\s\/、,，;；:：]{2,20}?)\s*相同/)
    || text.match(/填入当前([^\s，,。;；:：]{2,20})/);
  // 条件必填：IF 寄售客户=‘T’ 则必须要填 否则为空；也支持“当多部门使用='T'时”。
  const ifMatch = text.match(/IF\s*([^\s=＝]+)\s*[=＝]\s*['‘’"]?([^'"‘’\s]+)/i)
    || text.match(/(?:当)?\s*([^\s=＝，,。;；:：]{2,20})\s*[=＝]\s*['‘’"]?([A-Za-z0-9]+)['"‘’]?\s*时/);
  const multiDept = text.match(/多部门使用\s*[=＝]\s*['‘’"]?([TF])['"‘’]?\s*时/i);
  const requiredIf = ifMatch
    ? { fieldName: cleanText(ifMatch[1]).replace(/^当/, ''), value: cleanText(ifMatch[2]) }
    : (multiDept ? { fieldName: '多部门使用', value: multiDept[1].toUpperCase() } : null);
  // “否则填入0”这类规则：条件不满足时应写固定值，而不是报必填。
  const elseMatch = text.match(/否则\s*(?:填入|填|为|设为)?\s*([A-Za-z0-9+\-]+)/);
  const otherwise = elseMatch ? elseMatch[1] : '';
  return { required, options, fixed, defaultValue, sameAs: same ? cleanText(same[1]) : '', requiredIf, otherwise, master: null };
}

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
    // “累计折旧科目”不能拿“累计折旧”金额列去填，只有来源列本身是科目才允许。
    if (/科目$/.test(tn) && !/科目/.test(sn)) return;
    if (sn === tn || aliases.some(a => sn === normText(a))) candidates.push({ col: sc, score: 100 });
    else if (aliases.some(a => sn.includes(normText(a)) || normText(a).includes(sn))) candidates.push({ col: sc, score: 80 });
    else if (tn && (sn.includes(tn) || tn.includes(sn))) candidates.push({ col: sc, score: 60 });
  });
  candidates.sort((a, b) => b.score - a.score || a.col.index - b.col.index);
  if (candidates.length) return candidates[0].col.index;
  // 固定资产来源表里“使用部门”列常因 M:N 合并而没有表头，
  // 但它紧挨在“保管人”列前面；只在这种情况下按位置兜底。
  if (/使用部门/.test(tn)) {
    const keeper = sourceCols.find(sc => /保管人/.test(normText(sc.name)));
    const prev = keeper ? sourceCols.find(sc => sc.index === keeper.index - 1) : null;
    if (prev && !normText(prev.name)) return prev.index;
  }
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

function templateKey(template) {
  const sig = (template.columns || []).map(c => [c.code, c.name, c.comment || ''].join(':')).join('|');
  return crypto.createHash('sha256').update(sig).digest('hex').slice(0, 24);
}

function transformFor(templateCol) {
  const n = templateCol.name || '';
  if (/多部门使用/.test(n)) return 'deptFlag';
  if (/日期/.test(n)) return 'date';
  if (/(金额|价格|税率|比例|数量|用量|权数|额度|天数|月数|人数|注册资本|营业额)/.test(n)) return 'number';
  if (/(电话|手机)/.test(n)) return 'phone';
  return 'text';
}

function inspectService(baseDir, options) {
  const root = path.join(baseDir, 'cleaning');
  // 模板库和模板记忆必须跨版本稳定：放在 Electron userData 下，而不是便携版 exe 旁边。
  // 旧调用不传 options 时仍退回 baseDir，避免影响测试脚本。
  const profilesDir = (options && options.templatesDir) || path.join(root, 'templates');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(profilesDir, { recursive: true });
  const profilePath = key => path.join(profilesDir, key + '.json');
  const readProfile = key => {
    try {
      const f = profilePath(key);
      return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    } catch (_) { return null; }
  };
  const writeProfile = (key, templateName, defaults) => {
    const body = { key, templateName, defaults, updatedAt: new Date().toISOString() };
    fs.writeFileSync(profilePath(key), JSON.stringify(body, null, 2), 'utf8');
    return body;
  };
  // 规则按模板内容 hash 独立保存；不同模板绝不会共用同一份规则。
  const rulesPath = key => path.join(profilesDir, 'rules-' + key + '.json');
  const readRules = key => {
    try {
      const f = rulesPath(key);
      if (!fs.existsSync(f)) return null;
      const body = JSON.parse(fs.readFileSync(f, 'utf8'));
      return body && body.version === RULES_VERSION ? body : null;
    } catch (_) { return null; }
  };
  const writeRules = (key, templateName, fields) => {
    const body = { version: RULES_VERSION, key, templateName, fields, updatedAt: new Date().toISOString() };
    fs.writeFileSync(rulesPath(key), JSON.stringify(body, null, 2), 'utf8');
    return body;
  };

  // 已保存的导入模板库：复制模板文件到软件数据目录，按模板内容 hash 去重。
  // 模板基本不更新，用户下次从下拉框选择即可，不再反复找文件。
  const libraryDir = path.join(profilesDir, 'library');
  fs.mkdirSync(libraryDir, { recursive: true });
  const libraryPath = id => path.join(libraryDir, String(id || ''));
  function readLibraryMeta(id) {
    if (!/^[a-f0-9]{24}$/.test(String(id || ''))) return null;
    try {
      const f = path.join(libraryPath(id), 'meta.json');
      return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    } catch (_) { return null; }
  }
  function listLibraryTemplates() {
    try {
      return fs.readdirSync(libraryDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && /^[a-f0-9]{24}$/.test(d.name))
        .map(d => readLibraryMeta(d.name))
        .filter(Boolean)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
    } catch (_) { return []; }
  }
  function loadLibraryTemplate(id) {
    const meta = readLibraryMeta(id);
    if (!meta) throw new Error('模板库中的模板不存在，请重新选择模板文件');
    const p = path.join(libraryPath(id), 'template' + (meta.ext || '.xls'));
    if (!fs.existsSync(p)) throw new Error('模板文件已丢失，请重新导入模板');
    return { ...meta, path: p };
  }
  function saveLibraryTemplate(filePath, originalName, template) {
    const id = templateKey(template);
    const dir = libraryPath(id);
    fs.mkdirSync(dir, { recursive: true });
    const ext = extOf(originalName) || '.xls';
    fs.copyFileSync(filePath, path.join(dir, 'template' + ext));
    const old = readLibraryMeta(id);
    const meta = {
      id,
      name: String(originalName || '').replace(/\.(xls|xlsx|xlsm)$/i, ''),
      fileName: originalName,
      ext,
      updatedAt: new Date().toISOString(),
      createdAt: (old && old.createdAt) || new Date().toISOString()
    };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
    return meta;
  }

  return {
    root,
    listTemplates() { return listLibraryTemplates(); },
    deleteTemplate(id) {
      const key = String(id || '');
      if (!/^[a-f0-9]{24}$/i.test(key)) throw new Error('模板 ID 无效');
      const dir = libraryPath(key);
      if (!fs.existsSync(dir)) throw new Error('模板不存在或已删除');
      fs.rmSync(dir, { recursive: true, force: true });
      return { ok: true };
    },
    async importTemplate(body) {
      const file = body && body.template;
      if (!file || !file.data) throw new Error('缺少模板文件');
      const name = safeName(file.name, 'template.xls');
      const ext = extOf(name);
      if (!['.xls', '.xlsx', '.xlsm'].includes(ext)) throw new Error('模板仅支持 .xls / .xlsx');
      const buf = Buffer.from(String(file.data), 'base64');
      if (buf.length > MAX_UPLOAD) throw new Error('模板文件超过 30MB');
      const tmpDir = path.join(root, 'imports', crypto.randomUUID());
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmpFile = path.join(tmpDir, 'template' + ext);
      fs.writeFileSync(tmpFile, buf);
      try {
        const template = await this.runExcel('parse', { file: tmpFile, template: true });
        const meta = saveLibraryTemplate(tmpFile, name, template);
        return { ok: true, ...meta, columns: (template.columns || []).length };
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
      }
    },
    async runExcel(action, input) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-clean-'));
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
      const profile = profileOf(template);
      const keys = keyCodes(template);
      const byName = new Map();
      template.columns.forEach(c => {
        const n = normText(c.name);
        if (n && !byName.has(n)) byName.set(n, c.code);
      });
      const columns = template.columns.map(c => {
        const rule = c.rule || parseCommentRule(c.comment);
        const master = rule.master || masterForField(c.name, c.comment);
        const options = (rule.options || []).map(o => ({ ...o }));
        const defaultValue = rule.defaultValue || '';
        let derivedFrom = rule.sameAs ? (byName.get(normText(rule.sameAs)) || '') : '';
        if (derivedFrom === c.code) derivedFrom = '';
        const exactSource = source.columns.find(sc =>
          normText(sc.name || sc.code) === normText(c.name) || normText(sc.code) === normText(c.code));
        // 有枚举/固定值的字段只接受精确匹配，避免“客户简称”误配到“寄售客户”等选项列。
        let sourceIndex = rule.fixed || derivedFrom
          ? null
          : (rule.options.length
            ? (exactSource ? exactSource.index : sourceMatch(c, source.columns, source.rows))
            : sourceMatch(c, source.columns, source.rows));
        if (defaultValue && options.length && !options.some(o => o.value === defaultValue)) {
          options.unshift({ value: defaultValue, label: '' });
        }
        return {
          code: c.code,
          name: c.name,
          comment: c.comment,
          index: c.index,
          green: !!c.green,
          required: !!c.required || !!rule.required,
          requiredIf: rule.requiredIf || null,
          sourceIndex,
          transform: transformFor(c),
          defaultValue,
          otherwise: rule.otherwise || '',
          derivedFrom,
          options,
          master: master || null,
          fixed: !!rule.fixed,
          editable: !rule.fixed,
          note: ''
        };
      });
      return {
        profile,
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
      const sFile = save('source', body.source);
      let tFile;
      let libraryTemplate = null;
      if (body.templateId) {
        libraryTemplate = loadLibraryTemplate(body.templateId);
        const ext = libraryTemplate.ext || '.xls';
        const p = path.join(jobDir, 'template' + ext);
        fs.copyFileSync(libraryTemplate.path, p);
        tFile = { path: p, name: libraryTemplate.fileName || libraryTemplate.name };
      } else {
        tFile = save('template', body.template);
      }
      try {
        // 模板和客户数据必须是两个不同文件。误把模板选成来源时，源行会变成
        // “品名/主要来源”等表头文字，后续枚举校验会产生大量假错误。
        const fileHash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
        if (fileHash(sFile.path) === fileHash(tFile.path)) {
          throw new Error('来源文件不能与模板文件相同，请重新选择客户数据文件');
        }
        const template = await this.runExcel('parse', { file: tFile.path, template: true });
        const source = await this.runExcel('parse', { file: sFile.path, template: false });
        // Excel 解析拿到的是临时文件名，界面必须显示用户实际选择的文件名。
        template.fileName = tFile.name;
        source.fileName = sFile.name;
        // 每个模板按内容 hash 单独保存规则；不同模板不共享任何规则。
        const key = templateKey(template);
        let ruleSet = readRules(key);
        if (!ruleSet) {
          const fields = {};
          (template.columns || []).forEach(c => { fields[c.code] = parseCommentRule(c.comment); });
          ruleSet = writeRules(key, tFile.name, fields);
        }
        template.columns = (template.columns || []).map(c => ({
          ...c,
          rule: ruleSet.fields[c.code] || parseCommentRule(c.comment)
        }));
        const storedTemplate = body.templateId
          ? libraryTemplate
          : saveLibraryTemplate(tFile.path, tFile.name, template);
        const saved = readProfile(key);
        const suggested = this.suggest(template, source);
        suggested.profileKey = key;
        suggested.rememberedCount = 0;
        if (saved && saved.defaults) {
          suggested.columns.forEach(c => {
            if (c.fixed || c.derivedFrom) return;
            if (saved.defaults[c.code] == null || saved.defaults[c.code] === '') return;
            c.defaultValue = String(saved.defaults[c.code]);
            suggested.rememberedCount++;
            if (c.options && c.options.length && !c.options.some(o => String(o.value) === c.defaultValue)) {
              c.options.unshift({ value: c.defaultValue, label: '上次使用' });
            }
          });
        }
        const manifest = {
          jobId, createdAt: Date.now(),
          templatePath: tFile.path, sourcePath: sFile.path,
          templateId: key, templateName: storedTemplate.name || tFile.name,
          templateNameRaw: tFile.name, sourceName: sFile.name,
          template, source, suggested, profileKey: key,
          masterMap: Array.isArray(body.masterMap) ? body.masterMap : null
        };
        fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify(manifest), 'utf8');
        return {
          ok: true, jobId,
          templateId: key, templateName: storedTemplate.name || tFile.name,
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
      const byNameCode = new Map(cols.map(c => [normText(c.name), c.code]));
      const srcCols = job.source.columns;
      const keyCols = keyCodes(job.template);
      const sourceRows = job.source.rows || [];
      const resultRows = [];
      const issues = [];
      const keySeen = new Map();
      let skippedRows = 0;

      const getSourceValue = (row, sourceIndex) => {
        if (sourceIndex == null || sourceIndex === '') return '';
        const idx = Number(sourceIndex) - 1;
        if (idx < 0) return '';
        return row[idx] == null ? '' : row[idx];
      };
      const matchOption = (raw, options) => {
        if (!options || !options.length) return null;
        const s = cleanText(raw);
        if (!s) return null;
        const byCode = options.find(o => cleanText(o.value).toUpperCase() === s.toUpperCase());
        if (byCode) return { value: byCode.value, ambiguous: false };
        const sn = normText(s);
        const byLabel = options.find(o => o.label && normText(o.label) === sn);
        if (byLabel) return { value: byLabel.value, ambiguous: false };
        // “平均年限法”对“平均年限法(一)”这类主档标签，选第一项但标黄提示人工确认。
        const labelPrefix = options.find(o => o.label && normText(o.label).startsWith(sn));
        if (labelPrefix) return { value: labelPrefix.value, ambiguous: true };
        // 业务口语常与模板标签不完全一致：厂内件/厂内生产件、委外/委外生产件、外购/采购件。
        const canonical = v => normText(v)
          .replace(/外购|外协|外发/g, '委外')
          .replace(/自制/g, '厂内')
          .replace(/生产|加工|制造|件/g, '');
        const sCore = canonical(s);
        if (sCore) {
          const byCore = options.find(o => o.label && canonical(o.label) === sCore);
          if (byCore) return { value: byCore.value, ambiguous: true };
        }
        // “委外件”与“委外生产件”这类业务简称，用前缀匹配兜底。
        if (sn.length >= 2) {
          const byPrefix = options.find(o => o.label && normText(o.label).startsWith(sn.slice(0, 2)));
          if (byPrefix) return { value: byPrefix.value, ambiguous: true };
        }
        return null;
      };
      // 供应商字段在 ERP 里存厂商代码（TPADGA.DGA001），来源表常写名称。
      // 只读转换；没有资料档时保留名称并警告，不静默写错代码。
      const resolveMaster = (raw) => {
        const s = cleanText(raw);
        if (!s) return null;
        const list = Array.isArray(job.masterMap) ? job.masterMap : [];
        if (!list.length) return null;
        const code = list.find(x => cleanText(x.code).toUpperCase() === s.toUpperCase());
        if (code) return { value: code.code, ambiguous: false, name: code.name };
        const exact = list.find(x => normText(x.name) === normText(s));
        if (exact) return { value: exact.code, ambiguous: false, name: exact.name };
        const part = list.filter(x => normText(x.name).includes(normText(s)) || normText(s).includes(normText(x.name)));
        if (part.length === 1) return { value: part[0].code, ambiguous: true, name: part[0].name };
        if (s.length >= 3) {
          const chars = a => Array.from(normText(a));
          const diff = (a, b) => {
            const x = chars(a), y = chars(b);
            if (x.length !== y.length) return 99;
            return x.reduce((n, ch, i) => n + (ch === y[i] ? 0 : 1), 0);
          };
          const near = list.filter(x => diff(s, x.name) <= 1);
          if (near.length === 1) return { value: near[0].code, ambiguous: true };
        }
        return null;
      };
      const colByCode = new Map(cols.map(c => [c.code, c]));
      const suggestedByCode = new Map((job.suggested && job.suggested.columns || []).map(c => [c.code, c]));
      const keySourceIndexes = keyCols
        .map(k => (byCode.get(k) || {}).sourceIndex ?? (suggestedByCode.get(k) || {}).sourceIndex)
        .filter(i => i != null && i !== '');

      sourceRows.forEach((src, ri) => {
        const rowNo = ri + 1;
        // Excel 末尾的“合计/汇总”行通常只有金额，没有业务主键；不能当资产/商品数据导入。
        if (keySourceIndexes.length && keySourceIndexes.every(i => !String(getSourceValue(src, i)).trim())) {
          skippedRows++;
          return;
        }
        const values = {};
        const errors = [];
        const warnings = [];
        // 先处理直接来源与默认值
        cols.forEach(c => {
          const m = byCode.get(c.code) || {};
          let raw = '';
          if (!m.fixed && m.sourceIndex != null && m.sourceIndex !== '') raw = getSourceValue(src, m.sourceIndex);
          if ((raw == null || String(raw).trim() === '') && m.defaultValue != null) raw = m.defaultValue;
          if (raw == null || String(raw).trim() === '') {
            values[c.code] = '';
            return;
          }
          const tr = transformValue(raw, m.transform || transformFor(c));
          if (tr.error) {
            errors.push({ row: rowNo, code: c.code, name: c.name, severity: 'error', message: tr.error });
            values[c.code] = '';
          } else if (tr.empty) {
            values[c.code] = '';
          } else if (c.code === 'DEA010' || /^(主供应商|主供货商|供应商)$/.test(normText(c.name || ''))) {
            const master = resolveMaster(tr.value);
            if (!master) {
              errors.push({
                row: rowNo, code: c.code, name: c.name, severity: 'error',
                message: '供应商「' + tr.value + '」不在厂商资料档 TPADGA，请先补厂商资料或修正名称'
              });
              values[c.code] = '';
            } else {
              values[c.code] = master.value;
              if (master.ambiguous) {
                warnings.push({
                  row: rowNo, code: c.code, name: c.name, severity: 'warning',
                  message: master.name
                    ? '供应商「' + tr.value + '」按近似名称匹配为「' + master.value + '（' + master.name + '）」，已标黄，请人工确认'
                    : '未连接厂商资料，暂保留供应商「' + tr.value + '」原值，导入前请确认'
                });
              }
            }
          } else if (m.options && m.options.length) {
            const option = matchOption(tr.value, m.options);
            if (option == null) {
              errors.push({
                row: rowNo, code: c.code, name: c.name, severity: 'error',
                message: '值「' + tr.value + '」无法匹配选项：' + m.options.map(o => o.value + (o.label ? '（' + o.label + '）' : '')).join(' / ')
              });
              values[c.code] = '';
            } else {
              values[c.code] = option.value;
              if (option.ambiguous) {
                warnings.push({
                  row: rowNo, code: c.code, name: c.name, severity: 'warning',
                  message: '值「' + tr.value + '」按简称匹配为「' + option.value + '」，已标黄，请人工确认'
                });
              }
            }
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
          let required = m.required != null ? m.required : c.required;
          const requiredIf = m.requiredIf || (c.rule && c.rule.requiredIf);
          let conditionTrue = true;
          if (requiredIf) {
            const depCode = byNameCode.get(normText(requiredIf.fieldName));
            const depVal = depCode ? String(values[depCode] == null ? '' : values[depCode]).trim() : '';
            conditionTrue = depVal === String(requiredIf.value).trim();
            required = conditionTrue;
          }
          if (!conditionTrue && m.otherwise !== undefined && m.otherwise !== '') {
            if (values[c.code] == null || String(values[c.code]).trim() === '') values[c.code] = String(m.otherwise);
            return;
          }
          if (!required) return;
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

      if (skippedRows) {
        issues.push({ row: 0, code: '', name: '来源数据', severity: 'info', message: '已跳过 ' + skippedRows + ' 行没有主键的汇总/空行，不参与导入' });
      }
      // 模板中非必填但完全未映射的字段给出提示（最多 12 条）
      let unmapped = 0;
      cols.forEach(c => {
        const m = byCode.get(c.code) || {};
        const required = m.required != null ? m.required : c.required;
        if (!required && (m.sourceIndex == null || m.sourceIndex === '') && !m.defaultValue && !m.derivedFrom) unmapped++;
      });
      if (unmapped) issues.push({ row: 0, code: '', name: '字段映射', severity: 'info', message: '有 ' + unmapped + ' 个非必填字段未映射，生成后保持模板原值/空白' });

      // 必填缺失是“字段配置”问题，不是每一行独立错误；按字段去重，
      // 避免 39 行 × 26 字段产生上千条重复提示，用户无法定位。
      const missingSeen = new Set();
      const visibleIssues = issues.filter(x => {
        if (x.severity === 'error' && x.message === '必填字段为空') {
          if (missingSeen.has(x.code)) return false;
          missingSeen.add(x.code);
          x.row = 0;
        }
        return true;
      });
      const errors = visibleIssues.filter(x => x.severity === 'error');
      const warnings = visibleIssues.filter(x => x.severity === 'warning');
      return {
        rows: resultRows,
        issues: visibleIssues,
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
            transform: m.transform || transformFor(c),
            defaultValue: m.defaultValue || '',
            derivedFrom: m.derivedFrom || '',
            options: m.options || [],
            fixed: !!m.fixed,
            editable: m.editable !== false,
            note: m.note || ''
          };
        })
      };
    },
    rememberDefaults(job, mapping) {
      const key = job.profileKey || (job.suggested && job.suggested.profileKey) || templateKey(job.template);
      const defaults = {};
      (Array.isArray(mapping) ? mapping : []).forEach(m => {
        if (!m || m.fixed || m.derivedFrom) return;
        if (m.defaultValue == null || String(m.defaultValue) === '') return;
        defaults[m.code] = String(m.defaultValue);
      });
      writeProfile(key, job.templateName || '', defaults);
      job.profileKey = key;
      return defaults;
    },
    async remember(body) {
      const job = this.loadJob(body.jobId);
      const defaults = this.rememberDefaults(job, body.mapping);
      return { ok: true, profileKey: job.profileKey, defaults };
    },
    async preview(body) {
      const job = this.loadJob(body.jobId);
      this.rememberDefaults(job, body.mapping);
      return this.applyMapping(job, body.mapping, body.options || {});
    },
    async generate(body) {
      const job = this.loadJob(body.jobId);
      this.rememberDefaults(job, body.mapping);
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
      const isPreview = !!(opts && opts.preview);
      const base = profile === 'GENERIC' ? '数据导入包' : profile + '_导入包';
      const xlsPath = path.join(outDir, (isPreview ? '预览_' : '') + base + '_' + stamp + '.xls');

      // 只写入“有映射/默认/派生”的列；保留模板其它列原有内容
      const outputCols = [];
      const types = [];
      const templateCols = job.template.columns;
      const byCode = new Map((body.mapping || []).map(m => [String(m.code), m]));
      templateCols.forEach(c => {
        const m = byCode.get(c.code) || {};
        if (m.sourceIndex != null && m.sourceIndex !== '' || m.defaultValue || m.derivedFrom) {
          outputCols.push(c.index);
          types.push(m.transform || transformFor(c));
        }
      });
      const rows = result.rows.map(r => outputCols.map((idx, i) => {
        const c = templateCols.find(x => x.index === idx);
        return c ? r.values[c.code] : '';
      }));
      const marks = result.issues
        .filter(x => x.severity === 'warning' && x.row > 0 && x.code)
        .map(x => {
          const c = templateCols.find(y => y.code === x.code);
          return c ? { row: (job.template.dataStartRow || 3) + x.row - 1, col: c.index, color: 65535 } : null;
        })
        .filter(Boolean);
      await this.runExcel('generate', {
        template: job.templatePath,
        output: xlsPath,
        dataStart: job.template.dataStartRow || 3,
        columns: outputCols,
        types,
        rows,
        marks
      });

      const manifestPath = path.join(outDir, isPreview ? 'preview.json' : 'result.json');
      fs.writeFileSync(manifestPath, JSON.stringify({ xlsPath, stats: result.stats, preview: isPreview, createdAt: Date.now() }), 'utf8');
      return { ok: true, jobId: job.jobId, xlsPath, stats: result.stats, issues: result.issues.slice(0, 100), mapping: result.mapping };
    }
  };
}

module.exports = { createCleaningService: inspectService, MASTER_TABLES, _internals: { cleanText, parseNumber, parseDate, transformValue, keyCodes, profileOf, parseCommentRule, masterForField } };
