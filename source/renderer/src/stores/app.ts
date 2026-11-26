import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../api/client'
import { APP_VERSION } from '../config/app'

export type ConnState = 'unknown' | 'checking' | 'ok' | 'error'

export const useAppStore = defineStore('app', () => {
  const version = ref(APP_VERSION)
  const conn = ref<ConnState>('unknown')
  const connText = ref('未检测')
  const server = ref('')
  const database = ref('')

  /** 轻量探测：/api/config 只读本地配置，不建数据库连接，启动时调用安全 */
  async function checkConnection() {
    conn.value = 'checking'
    connText.value = '检测中…'
    try {
      const cfg = await api.config()
      // server 为空是合法值：后端默认连本机实例
      server.value = cfg.server || '本机'
      database.value = cfg.database || ''
      if (cfg.database) {
        conn.value = 'ok'
        connText.value = '已就绪'
      } else {
        conn.value = 'error'
        connText.value = '尚未选择账套'
      }
    } catch (e) {
      conn.value = 'error'
      connText.value = e instanceof Error ? e.message : '后端未响应'
    }
  }

  return { version, conn, connText, server, database, checkConnection }
})
