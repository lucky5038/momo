/** Electron preload 暴露的原生桥（src/preload.js），只用于清洗产物的另存为/打开。 */
export {}

declare global {
  interface Window {
    nb?: {
      saveCleaningFile?: (
        sourcePath: string,
        suggestedName?: string,
      ) => Promise<{ ok?: boolean; path?: string; canceled?: boolean }>
      openCleaningFile?: (target: string) => Promise<{ ok?: boolean }>
    }
  }
}
