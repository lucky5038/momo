/** 05 培训：按模块的流程地图 + 单据六问（What / Why / Who / When / Where / How） */

export interface TrainNode {
  key: string
  name: string
  role: string
  qcOnly?: boolean
}

export interface TrainChain {
  key: string
  name: string
  nodes: string[]
  qcOnly?: boolean
}

/** 5W1H：做什么 / 为什么做 / 谁做 / 什么时候做 / 交给谁 / 怎么做对 */
export interface TrainDoc {
  key: string
  what: string
  why: string
  who: string[]
  when: string
  where: string
  how: string[]
}

export interface TrainForm {
  code: string
  name: string
  file?: string
}

export interface TrainModule {
  key: string
  name: string
  nodes: TrainNode[]
  chains: TrainChain[]
  docs: Record<string, TrainDoc>
  forms: TrainForm[]
  qcToggle?: boolean
}

const BUY_NODES: TrainNode[] = [
  { key: 'req', name: '请购单', role: '仓管 / 使用部门' },
  { key: 'po', name: '采购单', role: '采购' },
  { key: 'qc', name: '检验', role: 'QC', qcOnly: true },
  { key: 'recv', name: '进货单', role: '仓管 / 采购' },
  { key: 'so', name: '订单', role: '业务' },
  { key: 'mrp', name: '物料需求', role: 'PMC' },
  { key: 'draft', name: '采购底稿', role: '采购' },
]

const BUY_DOCS: Record<string, TrainDoc> = {
  req: {
    key: 'req',
    what: '缺料或额外要用料时，提的申请单',
    why: '告诉采购要买什么、买多少、什么时候要',
    who: ['仓管 / 使用部门'],
    when: '发现缺料时，或知道下周要生产时',
    where: '交给采购，比价后下采购单',
    how: ['写清料号、数量、需要日期', '先查库存和未结采购，避免重复买'],
  },
  po: {
    key: 'po',
    what: '向供应商正式下单',
    why: '价格、数量、交期写在这张单上，是对供应商的承诺',
    who: ['采购'],
    when: '请购审批完，或采购底稿出来之后',
    where: '供应商送货来，仓管做进货单',
    how: ['供应商、单价、交期要核对清楚', '一次下单、分批到货的，收货时要拆着收'],
  },
  qc: {
    key: 'qc',
    what: '来料先检，合格才让入库',
    why: '把不合格的料挡在仓库外，别让它上生产线',
    who: ['QC'],
    when: '货到之后、入库之前',
    where: '合格转进货单入库；不合格退供应商',
    how: ['抽检比例按客户自己的规定', '不合格要留证据（照片、检验记录）'],
  },
  recv: {
    key: 'recv',
    what: '记录这一次实际收到多少',
    why: '供应商把料送来了，进货单是采购这笔生意落地的凭据',
    who: ['仓管：收货点数、录实际到货数量', '采购：核对单价与供应商'],
    when: '货到当天，或第二天上班先补',
    where: '审核后这张单就生效，采购这一段结束；质量问题退回走退货',
    how: ['照实收货，按实际到货数量录', '和采购单不一致时，先跟采购确认', '单价默认带采购单的'],
  },
  so: {
    key: 'so',
    what: '记下客户要什么、要多少、什么时候要',
    why: '客户下单了，后面买料、排产全都从这里开始',
    who: ['业务'],
    when: '客户确认订单之后立刻录',
    where: 'PMC 按订单跑物料需求',
    how: ['数量和交期跟客户确认清楚', '订单改了要同步改，不然后面全错'],
  },
  mrp: {
    key: 'mrp',
    what: '按订单算出这一批要买多少',
    why: '买多少由订单决定，不是凭经验估',
    who: ['PMC'],
    when: '接到订单、排产之前',
    where: '结果生成采购底稿，交给采购',
    how: ['现有库存和未结采购要扣掉，避免多买', '按客户习惯确认是否含损耗'],
  },
  draft: {
    key: 'draft',
    what: '把要采购的料汇总成一张清单',
    why: '多料号、多供应商先汇总，避免漏买和重复买',
    who: ['采购'],
    when: '物料需求算完之后',
    where: '从底稿生成采购单',
    how: ['核对料号、数量和需求日期', '单价以采购单为准'],
  },
  insp: {
    key: 'insp',
    what: '记下这一批来料的检验结果',
    why: '结果落在单据上，后面追责、退货才有依据',
    who: ['QC'],
    when: '到货后逐批检',
    where: '判定后把合格数量回写进货单',
    how: ['检验单要挂到对应的进货单上', '一批到货一次检验，不要混批'],
  },
  judge: {
    key: 'judge',
    what: '决定这一批料收还是不收',
    why: '决定这批料能不能进仓库、能不能投产',
    who: ['QC'],
    when: '检验完成之后',
    where: '合格入库；不合格退供应商，采购去谈',
    how: ['不合格要通知采购和供应商', '让步接收要有人签字确认'],
  },
}

export const TRAIN_MODULES: TrainModule[] = [
  {
    key: 'buy',
    name: '采购',
    nodes: BUY_NODES,
    qcToggle: true,
    chains: [
      { key: 'kit', name: '套料采购', nodes: ['so', 'mrp', 'draft', 'po', 'qc', 'recv'] },
      { key: 'casual', name: '零星采购', nodes: ['req', 'po', 'qc', 'recv'] },
    ],
    docs: BUY_DOCS,
    forms: [
      { code: 'SI-501', name: '关键用户培训计划表', file: '易助实施方法V8.3\\5. 教育训练\\SI-501 关键用户培训计划表.docx' },
      { code: 'SI-502', name: '企业内部训练计划表', file: '易助实施方法V8.3\\5. 教育训练\\SI-502 企业内部训练计划表.xlsx' },
      { code: 'SI-503', name: '培训签到表', file: '易助实施方法V8.3\\5. 教育训练\\SI-503 教育训练签到表.docx' },
      { code: 'SI-505', name: '操作手册', file: '易助实施方法V8.3\\5. 教育训练\\SI-505 易助ERP操作手册.pdf' },
      { code: 'SI-507', name: '课后练习剧本', file: '易助实施方法V8.3\\5. 教育训练\\SI-507 易助ERP课后练习剧本.xlsx' },
      { code: 'SI-508', name: '月度经营会报表', file: '易助实施方法V8.3\\5. 教育训练\\SI-508 月度经营会必看报表.docx' },
      { code: 'MANUAL-BUY', name: '采购模块操作手册', file: '易助客户各模块操作手册2023\\采购模块.pdf' },
    ],
  },
]