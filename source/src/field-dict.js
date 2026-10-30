// 字段字典覆盖：每个字段段只匹配自己的列，代码不跨字段复用。
'use strict';

const DICT = require('./source-dict');

// 字段名 → 数据库里可能的中文列说明。只做“候选列”，最终按样本值是否落在字典里确认。
const FIELD_HINTS = {
  InvoiceType: ['发票类型'],
  Purchased: ['采购状态', '采购别', '已采', '采购情况'],
  CustKind: ['客户性质'],
  CustPrice: ['客户售价', '售价', '价格类别', '售价类别'],
  Source: ['来源', '前置来源', '单据来源', '来源类别', '来源类型', '发票来源', '计划来源', '源工单来源', '原源工单来源', '来源(预留)', '前置来源(预留)'],
  storekind: ['仓库性质', '仓库类别'],
  MainSource: ['主要来源', '料件来源'],
  OwnerBy: ['归属', '归属类别', '统计归属'],
  AdjustKind: ['调整方式'],
  VoucherType: ['凭证类别'],
  CheckType: ['票据类型', '支票类别', '结算方式'],
  PayType: ['付款类型'],
  PCheckState: ['票据状态', '支票状态'],
  TableID: [], // 不是列，按表名存在性校验
  AccountType: ['账户类型', '存款类别'],
  AccountStatus: ['账户状态', '使用状态', '新使用状态', '原使用状态'],
  BankKind: ['存提类别', '银行类别', '存提'],
  SourceItem: ['来源项目', '存提来源'],
  ChangeType: ['异动类型', '异动类别', '票据异动'],
  FinishedStatus: ['完工状态', '完工码'],
  SubjectKind: ['科目类别', '科目性质'],
  BalanceWay: ['余额方向', '借贷方向'],
  SubjectType: ['科目类型'],
  CheckFirst: ['核对对象', '核算对象', '检查对象'],
  InvoiceProcess: ['发票处理', '作废状态'],
  SaleState: ['销售状态', '客户状态'],
  StringType: ['字符串类型', '字段类型'],
  IncreaseItem: ['增减项目', '增减项', '增减方向', '增减方式'],
  Mode: ['舍入方式', '取整方式', '进位方式'],
  ItemKind: ['项目类别', '项目类型'],
  BillType: ['账单类型', '票据类型', '资产异动类别'],
  ManhourType: ['工时类型'],
  TechnicsType: ['工艺类型', '工艺性质'],
  ShiftType: ['班别类型', '班别'],
  ChiceCond: ['选择条件'],
  ARKIND: ['应收冲账类别', '冲账类别'],
  APKIND: ['应付冲账类别', '冲账类别'],
  '付款类型': ['付款类型']
};

// 会计来源扩展码（KJSN 系列出现，区别于普通 [Source]）
const ACCOUNTING_SOURCE_CODES = new Set([
  '89A', '91A', '91B', '91C', '91D', '92A', '92B',
  '8D', '71A', '71B', '71C', '71D', '71E', '71F',
  '60B', '59A', '47A', '46A', '45A'
]);

module.exports = { DICT, FIELD_HINTS, ACCOUNTING_SOURCE_CODES };
