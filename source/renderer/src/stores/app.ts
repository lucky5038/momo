import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '../api/client'
import { errorMessage } from '../lib/error'

export type ConnState = 'unknown' | 'checking' | 'ok' | 'error'

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
      case 'ok':
        return '已就绪'
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

  async function checkConnection() {
    conn.value = 'checking'
    connError.value = ''
    const cfg = await loadConfig()
    if (!cfg) return
    if (!cfg.database) {
      conn.value = 'error'
      connError.value = '尚未选择账套'
      return
    }
    conn.value = 'ok'
  }

  /** 真探活：/api/meta 能返回 docs 才算数据库可用（旧界面 loadConnBanner 同策略） */
  async function probe() {
    conn.value = 'checking'
    connError.value = ''
    try {
      const meta = (await api.meta({})) as { docs?: unknown[]; currentDb?: string; server?: string }
      if (!meta || !Array.isArray(meta.docs)) throw new Error('数据库未返回字典')
      if (meta.currentDb) database.value = meta.currentDb
      if (meta.server) server.value = meta.server
      conn.value = 'ok'
    } catch (e) {
      conn.value = 'error'
      connError.value = errorMessage(e)
    }
  }

  /** 账套/服务器变了：标记新一代，所有持有旧字典的页面必须重新加载 */
  function bumpGeneration() {
    generation.value += 1
  }

  /** 顶栏「重新连接」：先真探活，再把字典代次推进 */
  async function reconnect() {
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
  }
})
