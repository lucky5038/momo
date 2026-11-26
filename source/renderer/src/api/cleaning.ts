/** 数据清洗（期初导入）接口层：模板库 + 读取/校验/生成。
 *  文件以 base64 走 JSON（后端 cleaning.js 解析 30MB 上限），生成结果以本地绝对路径返回。 */
import { post } from './client'

export interface CleanTemplateItem {
  id: string
  name?: string
  fileName?: string
}

export interface CleanColOption {
  value: string
  label?: string
}

export interface CleanMappingColumn {
  code: string
  name?: string
  comment?: string
  required?: boolean
  fixed?: boolean
  derivedFrom?: string
  sourceIndex?: number | null
  transform?: string
  defaultValue?: string
  options?: CleanColOption[]
  otherwise?: string
  editable?: boolean
}

export interface CleanSourceColumn {
  index: number
  name?: string
}

export interface CleanTemplateMeta {
  fileName: string
  sheet?: string
  columns: { code: string; name?: string; index: number; comment?: string }[]
  rowCount?: number
  dataStartRow?: number
}

export interface CleanSourceMeta {
  fileName: string
  sheet?: string
  columns: CleanSourceColumn[]
  rowCount?: number
  sample?: unknown[]
}

export interface CleanSuggested {
  columns: CleanMappingColumn[]
  profile?: string
  profileKey?: string
  rememberedCount?: number
}

export interface CleanStats {
  sourceRows?: number
  outputRows?: number
  errors?: number
  warnings?: number
  unmapped?: number
}

export interface CleanIssue {
  severity: 'error' | 'warning' | 'info'
  code?: string
  message: string
  row?: number
}

export interface CleanInspectResult {
  ok?: boolean
  jobId: string
  templateId?: string
  templateName?: string
  template: CleanTemplateMeta
  source: CleanSourceMeta
  suggested: CleanSuggested
}

export interface CleanApplyResult {
  ok?: boolean
  jobId?: string
  xlsPath?: string
  stats: CleanStats
  issues: CleanIssue[]
  mapping?: CleanMappingColumn[]
}

/** 与旧界面一致的清洗方式取值 */
export const TRANSFORMS: { value: string; label: string }[] = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'date', label: '日期' },
  { value: 'phone', label: '电话（去空格/横线）' },
  { value: 'ratio', label: '比例（1:1 → 1）' },
]

export const MAX_UPLOAD = 30 * 1024 * 1024

/** File → base64（去掉 dataURL 前缀），旧界面 readFile 的同款实现 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('请选择文件'))
    if (file.size > MAX_UPLOAD) return reject(new Error(`${file.name} 超过 30MB`))
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '')
    fr.onerror = () => reject(new Error('读取文件失败'))
    fr.readAsDataURL(file)
  })
}

export const cleaningApi = {
  templates: () => post<{ ok?: boolean; templates: CleanTemplateItem[] }>('/api/cleaning/templates'),
  importTemplate: (name: string, data: string) =>
    post<{ id: string; name?: string }>('/api/cleaning/template-import', { template: { name, data } }),
  deleteTemplate: (id: string) => post<{ ok?: boolean }>('/api/cleaning/template-delete', { id }),
  inspect: (body: {
    source: { name: string; data: string }
    template?: { name: string; data: string }
    templateId?: string
  }) => post<CleanInspectResult>('/api/cleaning/inspect', body),
  remember: (jobId: string, mapping: CleanMappingColumn[]) =>
    post<{ ok?: boolean; defaults?: Record<string, string> }>('/api/cleaning/remember', { jobId, mapping }),
  preview: (jobId: string, mapping: CleanMappingColumn[]) =>
    post<CleanApplyResult>('/api/cleaning/preview', { jobId, mapping }),
  generate: (jobId: string, mapping: CleanMappingColumn[], preview: boolean) =>
    post<CleanApplyResult>('/api/cleaning/generate', {
      jobId,
      mapping,
      options: { allowErrors: false, preview },
    }),
  reveal: (path: string) => post<{ ok?: boolean; dir?: string }>('/api/cleaning/reveal', { path }),
}
