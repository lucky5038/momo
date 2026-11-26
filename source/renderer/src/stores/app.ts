import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '../api/client'
import { errorMessage } from '../lib/error'

export type ConnState = 'unknown' | 'checking' | 'configured' | 'ready' | 'error'

export const useAppStore = defineStore('app', () => {
  const conn = ref<ConnState>('unknown')
  const connError = ref('')
  const server = ref('')
  const database = ref('')
  const backupDir = ref('')

  /** 连接代次：切账套/重新连接后自增，依赖字典的页面据此失效重载（旧界面靠 init() 手工重拉） */
  const generation = ref(0)

  const connLabel = computed(() => {
    switch (conn.value) {
      case 'ready':
        return '已就绪'
      case 'configured':
        return '已配置'
      case 'error':
        return '异常'
      case 'checking':
        return '检测中'
      default:
        return '未检测'
    }
  })

  /** 轻量探测：/api/config 只读本地配置，不建数据库连接 */
  async function loadConfig() {
    try {
      const cfg = await api.config()
      server.value = cfg.server || '本机'
      database.value = cfg.database || ''
      backupDir.value = cfg.backupDir || ''
      return cfg
    } catch (e) {
      conn.value = 'error'
      connError.value = errorMessage(e)
      return null
    }
  }

  async function checkConnection(): Promise<boolean> {
    conn.value = 'checking'
    connError.value = ''
    const cfg = await loadConfig()
    if (!cfg) return false
    if (!cfg.database) {
      conn.value = 'error'
      connError.value = '尚未选择账套，请到「系统设置」连接数据库'
      return false
    }
    conn.value = 'configured'
    return true
  }

  /** 真探活：/api/meta 能返回 docs 才算数据库可用（旧界面 loadConnBanner 同策略）。
   *  retry 次 × 2 秒：数据库往往比窗口晚就绪，一次失败就报错会让人以为工具坏了。 */
  async function probe(retry = 0) {
    if (!database.value) {
      conn.value = 'error'
      connError.value = '尚未选择账套，请到「系统设置」连接数据库'
      return
    }
    conn.value = 'checking'
    connError.value = ''
    let lastError: unknown = null
    for (let i = 0; i <= retry; i++) {
      try {
        const meta = (await api.meta({})) as { docs?: unknown[]; currentDb?: string; server?: string }
        if (!meta || !Array.isArray(meta.docs)) throw new Error('数据库未返回字典')
        if (meta.currentDb) database.value = meta.currentDb
        if (meta.server) server.value = meta.server
        conn.value = 'ready'
        return
      } catch (e) {
        lastError = e
        if (i < retry) await new Promise((r) => setTimeout(r, 2000))
      }
    }
    conn.value = 'error'
    connError.value = errorMessage(lastError)
  }

  /** 设置页改完备份目录后同步，避免确认框里还显示旧路径 */
  function applyBackupDir(dir: string) {
    backupDir.value = dir
  }

  /** 账套/服务器变了：标记新一代，所有持有旧字典的页面必须重新加载 */
  function bumpGeneration() {
    generation.value += 1
  }

  /** 顶栏「重新连接」：先真探活，再把字典代次推进 */
  async function reconnect() {
    await loadConfig()
    await probe()
    bumpGeneration()
  }

  return {
    conn,
    connError,
    connLabel,
    server,
    database,
    backupDir,
    generation,
    checkConnection,
    probe,
    reconnect,
    bumpGeneration,
    applyBackupDir,
  }
})
