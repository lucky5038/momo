/** 应用级常量与模块清单（侧栏与路由共用，避免两处维护）
 * 顺序沿用旧界面侧栏：跨表带值 → 触发器管理 → 系统设置 → 一句话带值 → 数据清洗 → 数据体检 */
export const APP_VERSION = '2.4.3'

export interface ModuleDef {
  key: string
  path: string
  title: string
  icon: string
  desc: string
  stage: string
}

export const MODULES: ModuleDef[] = [
  {
    key: 'run',
    path: '/run',
    title: '跨表带值',
    icon: '📌',
    desc: '选择目标表与来源表，配置字段映射后批量带值，支持预览与清列。',
    stage: 'P2 迁移中',
  },
  {
    key: 'triggers',
    path: '/triggers',
    title: '触发器管理',
    icon: '🔧',
    desc: '查看、安装与卸载数据库触发器，处理跨表带值的自动同步。',
    stage: 'P4 迁移中',
  },
  {
    key: 'settings',
    path: '/settings',
    title: '系统设置',
    icon: '⚙️',
    desc: '数据库连接、账套切换、备份目录与运行参数。',
    stage: 'P5 迁移中',
  },
  {
    key: 'chat',
    path: '/chat',
    title: '一句话带值',
    icon: '💬',
    desc: '用自然语言描述带值需求，自动生成可执行的字段映射方案。',
    stage: 'P5 迁移中',
  },
  {
    key: 'cleaning',
    path: '/cleaning',
    title: '数据清洗',
    icon: '🧹',
    desc: '导入清洗模板、映射主档字段，按模板批量整理业务数据。',
    stage: 'P3 迁移中',
  },
  {
    key: 'diagnose',
    path: '/diagnose',
    title: '数据体检',
    icon: '🩺',
    desc: '检查字段字典、空值与映射完整性，提前发现带值隐患。',
    stage: 'P5 迁移中',
  },
]
