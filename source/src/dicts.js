// Auto-extracted from tools/server.js — static dictionaries.
// 单据字典与来源档字典(跨表传值核心)。

// refCol: 该单据关联来源档(品号)应使用的主表列（默认取 sub 表第3列；工单/领退料单等关联列在第10/21列）
const docs = [
  // ===== 进货 =====
  { id:'JSKJDB', name:'JSKJDB 验收(退)/进货单',       main:'JSKJDA', mainKeyCol:'JDA001', sub:'JSKJDB', keyCol:'JDB003', party:'supplier', partyCol:'JDA004' },
  { id:'JSKJFB', name:'JSKJFB 进货退出单(前台:退货单)', main:'JSKJFA', mainKeyCol:'JFA001', sub:'JSKJFB', keyCol:'JFB003', party:'supplier', partyCol:'JFA004' },
  { id:'JSKJCB', name:'JSKJCB 收料单',                 main:'JSKJCA', mainKeyCol:'JCA001', sub:'JSKJCB', keyCol:'JCB003', party:'supplier', partyCol:'JCA004' },
  { id:'JSKJEB', name:'JSKJEB 验退退出单',             main:'JSKJEA', mainKeyCol:'JEA001', sub:'JSKJEB', keyCol:'JEB003', party:'supplier', partyCol:'JEA004' },
  { id:'JSKJAB', name:'JSKJAB 借入单',                 main:'JSKJAA', mainKeyCol:'JAA001', sub:'JSKJAB', keyCol:'JAB003', party:'supplier', partyCol:'JAA004' },
  { id:'JSKJBB', name:'JSKJBB 借入还出单',             main:'JSKJBA', mainKeyCol:'JBA001', sub:'JSKJBB', keyCol:'JBB003', party:'supplier', partyCol:'JBA004' },
  // ===== 出货 =====
  { id:'JSKKFB', name:'JSKKFB 销退单',                 main:'JSKKFA', mainKeyCol:'KFA001', sub:'JSKKFB', keyCol:'KFB003', party:'customer', partyCol:'KFA004' },
  { id:'JSKKEB', name:'JSKKEB 销货单',                 main:'JSKKEA', mainKeyCol:'KEA001', sub:'JSKKEB', keyCol:'KEB003', party:'customer', partyCol:'KEA004' },
  { id:'JSKKAB', name:'JSKKAB 借出单',                 main:'JSKKAA', mainKeyCol:'KAA001', sub:'JSKKAB', keyCol:'KAB003', party:'customer', partyCol:'KAA004' },
  { id:'JSKKBB', name:'JSKKBB 借出还入单',             main:'JSKKBA', mainKeyCol:'KBA001', sub:'JSKKBB', keyCol:'KBB003', party:'customer', partyCol:'KBA004' },
  // ===== 订单/采购/报价/询价 =====
  { id:'DCSIBB', name:'DCSIBB 订单',                   main:'DCSIBA', mainKeyCol:'IBA001', sub:'DCSIBB', keyCol:'IBB003', party:'customer', partyCol:'IBA004' },
  { id:'DCSICB', name:'DCSICB 订单变更单',             main:'DCSICA', mainKeyCol:'ICA001', sub:'DCSICB', keyCol:'ICB003', party:'customer', partyCol:null },
  { id:'DCSDAB', name:'DCSDAB 订单合同商品明细',       main:'DCSDAA', mainKeyCol:'DAA001', sub:'DCSDAB', keyCol:'DAB003', party:'customer', partyCol:'DAA005' },
  { id:'DCSHDB', name:'DCSHDB 采购单',                 main:'DCSHDA', mainKeyCol:'HDA001', sub:'DCSHDB', keyCol:'HDB003', party:'supplier', partyCol:'HDA004' },
  { id:'DCSHAB', name:'DCSHAB 询价单',                 main:'DCSHAA', mainKeyCol:'HAA001', sub:'DCSHAB', keyCol:'HAB003', party:'supplier', partyCol:'HAA004' },
  { id:'DCSHBB', name:'DCSHBB 请购单',                 main:'DCSHBA', mainKeyCol:'HBA001', sub:'DCSHBB', keyCol:'HBB003', party:'supplier', partyCol:null },
  { id:'DCSHCB', name:'DCSHCB 采购底稿单',             main:'DCSHCA', mainKeyCol:'HCA001', sub:'DCSHCB', keyCol:'HCB003', party:'supplier', partyCol:null },
  { id:'DCSIAB', name:'DCSIAB 报价单',                 main:'DCSIAA', mainKeyCol:'IAA001', sub:'DCSIAB', keyCol:'IAB003', party:'customer', partyCol:'IAA005' },
  { id:'DCSHFB', name:'DCSHFB 采购变更单',             main:'DCSHFA', mainKeyCol:'HFA001', sub:'DCSHFB', keyCol:'HFB003', party:'supplier', partyCol:'HFA004' },
  // ===== 检验 =====
  { id:'QMSMFB', name:'QMSMFB 进货检验单',             main:'QMSMFA', mainKeyCol:'MFA001', sub:'QMSMFB', keyCol:'MFB007', party:'supplier', partyCol:'MFA004' },
  { id:'QMSMAB', name:'QMSMAB 生产检验单',             main:'QMSMAA', mainKeyCol:'MAA001', sub:'QMSMAB', keyCol:'MAB007', party:'none',     partyCol:null },
  { id:'QMSMCB', name:'QMSMCB 委外进货检验单',         main:'QMSMCA', mainKeyCol:'MCA001', sub:'QMSMCB', keyCol:'MCB007', party:'supplier', partyCol:'MCA004' },
  { id:'QMSMEB', name:'QMSMEB 库存检验单',             main:'QMSMEA', mainKeyCol:'MEA001', sub:'QMSMEB', keyCol:'MEB006', party:'none',     partyCol:null },
  { id:'QMSMMB', name:'QMSMMB 委外进货收料单',         main:'QMSMBA', mainKeyCol:'MBA001', sub:'QMSMMB', keyCol:'MBB003', party:'supplier', partyCol:'MBA004' },
  { id:'QMSMDB', name:'QMSMDB 委外进货验退退回单',     main:'QMSMDA', mainKeyCol:'MDA001', sub:'QMSMDB', keyCol:'MDB003', party:'supplier', partyCol:'MDA004' },
  // ===== 工单/领退料/委外 =====
  { id:'SGMRAB', name:'SGMRAB 工单',                   main:'SGMRAA', mainKeyCol:'RAA001', sub:'SGMRAB', keyCol:'RAB003', party:'none',     partyCol:null },
  { id:'SGMRBB', name:'SGMRBB 领/退料单',             main:'SGMRBA', mainKeyCol:'RBA001', sub:'SGMRBB', keyCol:'RBB004', party:'none',     partyCol:null, refCol:'RBB010' },
  { id:'SGMRGB', name:'SGMRGB 委外进/退货单',         main:'SGMRGA', mainKeyCol:'RGA001', sub:'SGMRGB', keyCol:'RGB004', party:'supplier', partyCol:null, refCol:'RGB021' },
  { id:'SGMRFB', name:'SGMRFB 送/退料单',             main:'SGMRFA', mainKeyCol:'RFA001', sub:'SGMRFB', keyCol:'RFB004', party:'none',     partyCol:null, refCol:'RFB010' },
  { id:'SGMREB', name:'SGMREB 委外单',                 main:'SGMREA', mainKeyCol:'REA001', sub:'SGMREB', keyCol:'REB003', party:'supplier', partyCol:null },
  // ===== 维修 =====
  { id:'RMAVCB', name:'RMAVCB 销售服务单',             main:'RMAVCA', mainKeyCol:'VCA001', sub:'RMAVCB', keyCol:'VCB003', party:'none',     partyCol:null },
  { id:'RMAVBB', name:'RMAVBB 维修服务单',             main:'RMAVBA', mainKeyCol:'VBA001', sub:'RMAVBB', keyCol:'VBB003', party:'none',     partyCol:null }
];

const srcs = [
  // ===== 品号维度的来源档(跨表传值核心) =====
  { id:'TPADEG', name:'TPADEG 供应商品号档(供应商侧)', party:'supplier', key:['DEG001'], valDefault:'DEG003', valCol:'DEG002', vals:{DEG003:'供应商品号',DEG004:'供应商品名',DEG006:'供应商规格'} },
  { id:'TPADEF', name:'TPADEF 客户品号档(客户侧)',     party:'customer', key:['DEF001'], valDefault:'DEF003', valCol:'DEF002', vals:{DEF003:'客户品号',DEF004:'客户品名',DEF006:'客户规格'} },
  { id:'JSKLOA', name:'JSKLOA 库存档(品号+仓库)',       party:'none',     key:['LOA001'], valDefault:'LOA003', valCol:null, vals:{LOA003:'现有库存量',LOA004:'现有库存成本'} },
  { id:'TPADEA', name:'TPADEA 商品资料(品号主档)',       party:'none',     key:['DEA001'], valDefault:'DEA002', valCol:null, vals:{DEA002:'品名',DEA003:'库存单位',DEA004:'条码编号',DEA005:'商品分类',DEA006:'会计分类',DEA008:'主要仓库'} },
  { id:'TPADEH', name:'TPADEH 品号批号信息档',          party:'none',     key:['DEH001'], valDefault:'DEH002', valCol:null, vals:{DEH002:'批号',DEH003:'批号说明',DEH004:'最早入库日'} },
  // ===== 供应商/客户主档 =====
  { id:'TPADGA', name:'TPADGA 供应商信息档',             party:'supplier', key:['BGA001'], valDefault:'BGA002', valCol:null, vals:{BGA002:'供应商名称',BGA004:'负责人',BGA005:'电话'} },
  { id:'TPADFA', name:'TPADFA 客户信息档',              party:'customer', key:['BFA001'], valDefault:'BFA002', valCol:null, vals:{BFA002:'客户名称',BFA004:'负责人',BFA005:'电话'} }
];

module.exports = { docs, srcs };

