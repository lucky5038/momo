/** 应用级常量与模块清单（侧栏与路由共用，避免两处维护）
 * 顺序：跨表带值 → 触发器管理 → 一句话带值 → 数据清洗 → 数据体检 → 系统设置（配置类放最后） */
export const APP_VERSION = '2.10.0'

/** 旧版界面里「规划中」的模块：只有说明文案，没有接口与逻辑 */
export interface PlannedDef {
  kicker: string
  badge: string
  sampleLabel: string
  sampleCode: string
  sampleArrow?: string
  sampleText?: string
  points: { b: string; t: string }[]
  note: string
}

export interface ModuleDef {
  key: string
  path: string
  title: string
  icon: string
  desc: string
  planned?: PlannedDef
}

export const MODULES: ModuleDef[] = [
  {
    key: 'run',
    path: '/run',
    title: '跨表带值',
    icon: '📌',
    desc: '选择目标表与来源表，配置字段映射后批量带值，支持预览与清列。',
  },
  {
    key: 'triggers',
    path: '/triggers',
    title: '触发器管理',
    icon: '🔧',
    desc: '查看、安装与卸载数据库触发器，处理跨表带值的自动同步。',
  },
  {
    key: 'chat',
    path: '/chat',
    title: '一句话带值',
    icon: '💬',
    desc: '用一句话描述目标字段和来源字段，解析成功后回填现有跨表带值表单。',
    planned: {
      kicker: 'MODULE 01 · 规划中',
      badge: '待开发',
      sampleLabel: '示例',
      sampleCode: '订单单身960 带 采购单单身单号',
      sampleArrow: '→',
      sampleText: '解析后回填目标、来源和字段',
      points: [
        { b: '识别单据', t: '按单据名称、单身/单头、别名匹配。' },
        { b: '识别字段', t: '支持 960 这类数字后缀和单号、序号等常用字段。' },
        { b: '拿不准先确认', t: '出现多个候选时不自动选，先让用户确认。' },
      ],
      note: '当前只增加板块，不接解析与执行逻辑；功能范围确认后再开发。',
    },
  },
  {
    key: 'cleaning',
    path: '/cleaning',
    title: '数据清洗',
    icon: '🧹',
    desc: '导入清洗模板、映射主档字段，按模板批量整理业务数据。',
  },
  {
    key: 'diagnose',
    path: '/diagnose',
    title: '数据体检',
    icon: '🩺',
    desc: '按业务规则检查系统数据，例如凭证完整性、生产/委外耗料异常、借出单未还等。',
    planned: {
      kicker: 'MODULE 03 · 规划中',
      badge: '待开发',
      sampleLabel: '流程',
      sampleCode: '选择检查 → 只读执行 → 问题清单 → 跟进处理',
      points: [
        { b: '只读检查', t: '默认不修改业务数据，先给出问题证据。' },
        { b: '问题清单', t: '按严重级别列出单号、差异、原因和建议。' },
        { b: '可扩展检查包', t: '不同账套按需启用，不把规则写死在页面里。' },
      ],
      note: '当前只增加板块，不接检查 SQL 和执行逻辑；功能范围确认后再开发。',
    },
  },
  {
    key: 'settings',
    path: '/settings',
    title: '系统设置',
    icon: '⚙️',
    desc: '数据库连接、账套切换、备份目录与运行参数。',
  },
]
