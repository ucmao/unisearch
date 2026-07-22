import { create } from 'zustand'
import type { LogEntry, CrawlerConfig } from '@/types/crawler'

interface RunningDetails {
  crawlerType: string | null
  startedAt: string | null
  runId: string | null
}

interface CrawlerState {
  // Statuses by platform
  statuses: { [platform: string]: 'idle' | 'running' | 'stopping' | 'error' }
  runningInfo: { [platform: string]: RunningDetails }

  // Logs by platform
  logs: { [platform: string]: LogEntry[] }
  clearedAfterLogId: { [platform: string]: number | null }

  // Selection & UI Tab
  selectedPlatforms: string[]
  activePlatformTab: string

  // Config template
  config: CrawlerConfig
  platformCookies: { [platform: string]: string }
  connectorOptions: { [platform: string]: Record<string, unknown> }

  // Actions
  setStatus: (platform: string, status: 'idle' | 'running' | 'stopping' | 'error') => void
  setRunningInfo: (platform: string, crawlerType: string | null, startedAt: string | null, runId: string | null) => void
  setBulkStatus: (platformStates: { [platform: string]: any }) => void
  addLog: (log: LogEntry) => void
  setLogs: (platform: string, logs: LogEntry[]) => void
  clearLogs: (platform: string) => void
  restoreLogs: (platform: string) => void
  updateConfig: (config: Partial<CrawlerConfig>) => void
  setPlatformCookie: (platform: string, cookies: string) => void
  setConnectorOption: (platform: string, key: string, value: unknown) => void
  setSelectedPlatforms: (platforms: string[]) => void
  setActivePlatformTab: (platform: string) => void
  reset: (platform?: string) => void
}

const CLEARED_LOG_ID_PREFIX = 'unisearch_cleared_log_id_'

function getClearedLogIdFromStorage(platform: string): number | null {
  const stored = localStorage.getItem(`${CLEARED_LOG_ID_PREFIX}${platform}`)
  if (stored === null) return null
  const value = parseInt(stored, 10)
  return isNaN(value) ? null : value
}

function saveClearedLogIdToStorage(platform: string, id: number | null): void {
  if (id === null) {
    localStorage.removeItem(`${CLEARED_LOG_ID_PREFIX}${platform}`)
  } else {
    localStorage.setItem(`${CLEARED_LOG_ID_PREFIX}${platform}`, id.toString())
  }
}

const defaultConfig: CrawlerConfig = {
  platform: 'bili',
  connector_id: 'bili',
  capability: 'keyword_search',
  connector_options: {},
  login_type: 'qrcode',
  crawler_type: 'search',
  keywords: '',
  specified_ids: '',
  creator_ids: '',
  start_page: 1,
  enable_comments: false,
  enable_sub_comments: false,
  cookies: '',
  headless: false,
  loop_execution: false,
}

const SUPPORTED_PLATFORMS = ['xhs', 'dy', 'ks', 'bili', 'wb', 'tieba', 'zhihu', 'baidu', 'bing', 'so360', 'sogou']

const initialStatuses = SUPPORTED_PLATFORMS.reduce((acc, p) => ({ ...acc, [p]: 'idle' as const }), {})
const initialRunningInfo = SUPPORTED_PLATFORMS.reduce(
  (acc, p) => ({ ...acc, [p]: { crawlerType: null, startedAt: null, runId: null } }),
  {}
)
const initialLogs = SUPPORTED_PLATFORMS.reduce((acc, p) => ({ ...acc, [p]: [] }), {})
const initialClearedLogIds = SUPPORTED_PLATFORMS.reduce(
  (acc, p) => ({ ...acc, [p]: getClearedLogIdFromStorage(p) }),
  {}
)

export const useCrawlerStore = create<CrawlerState>((set, get) => ({
  statuses: initialStatuses,
  runningInfo: initialRunningInfo,
  logs: initialLogs,
  clearedAfterLogId: initialClearedLogIds,
  selectedPlatforms: ['bili'],
  activePlatformTab: 'bili',
  config: defaultConfig,
  platformCookies: {},
  connectorOptions: {},

  setStatus: (platform, status) => {
    set((state) => {
      const nextStatuses = { ...state.statuses, [platform]: status }
      const nextClearedLogId = { ...state.clearedAfterLogId }
      
      if (status === 'running') {
        nextClearedLogId[platform] = null
        saveClearedLogIdToStorage(platform, null)
      }
      
      return {
        statuses: nextStatuses,
        clearedAfterLogId: nextClearedLogId,
      }
    })
  },

  setRunningInfo: (platform, crawlerType, startedAt, runId) => {
    set((state) => {
      const nextInfo = {
        ...state.runningInfo,
        [platform]: { crawlerType, startedAt, runId },
      }
      const nextClearedLogId = { ...state.clearedAfterLogId }

      if (startedAt !== null) {
        nextClearedLogId[platform] = null
        saveClearedLogIdToStorage(platform, null)
      }

      return {
        runningInfo: nextInfo,
        clearedAfterLogId: nextClearedLogId,
      }
    })
  },

  setBulkStatus: (platformStates) => {
    set((state) => {
      const nextStatuses = { ...state.statuses }
      const nextRunningInfo = { ...state.runningInfo }

      Object.entries(platformStates).forEach(([platform, data]: [string, any]) => {
        nextStatuses[platform] = data.status
        nextRunningInfo[platform] = {
          crawlerType: data.crawler_type,
          startedAt: data.started_at,
          runId: data.run_id,
        }
      })

      return {
        statuses: nextStatuses,
        runningInfo: nextRunningInfo,
      }
    })
  },

  addLog: (log) => {
    // Route log to its platform. If platform is not specified in log, fall back to activePlatformTab
    const platform = log.platform || get().activePlatformTab
    const currentClearedId = get().clearedAfterLogId[platform]
    const platformLogs = get().logs[platform] || []

    if (currentClearedId !== null && log.id <= currentClearedId) {
      return
    }

    if (platformLogs.length > 0 && platformLogs[platformLogs.length - 1].id === log.id) {
      return
    }

    if (platformLogs.some((existing) => existing.id === log.id)) {
      return
    }

    set((state) => {
      const pLogs = state.logs[platform] || []
      return {
        logs: {
          ...state.logs,
          [platform]: [...pLogs.slice(-499), log],
        },
      }
    })
  },

  setLogs: (platform, logs) => {
    const currentClearedId = get().clearedAfterLogId[platform]
    const filteredLogs = currentClearedId !== null
      ? logs.filter((log) => log.id > currentClearedId)
      : logs
    set((state) => ({
      logs: {
        ...state.logs,
        [platform]: filteredLogs,
      },
    }))
  },

  clearLogs: (platform) => {
    const platformLogs = get().logs[platform] || []
    const maxLogId = platformLogs.length > 0 ? Math.max(...platformLogs.map((l) => l.id)) : 0
    
    set((state) => ({
      logs: {
        ...state.logs,
        [platform]: [],
      },
      clearedAfterLogId: {
        ...state.clearedAfterLogId,
        [platform]: maxLogId,
      },
    }))
    
    saveClearedLogIdToStorage(platform, maxLogId)
  },

  restoreLogs: (platform) => {
    set((state) => ({
      clearedAfterLogId: {
        ...state.clearedAfterLogId,
        [platform]: null,
      },
    }))
    saveClearedLogIdToStorage(platform, null)
    window.location.reload()
  },

  updateConfig: (config) =>
    set((state) => ({
      config: { ...state.config, ...config },
    })),

  setPlatformCookie: (platform, cookies) =>
    set((state) => ({
      platformCookies: { ...state.platformCookies, [platform]: cookies },
    })),

  setConnectorOption: (platform, key, value) =>
    set((state) => ({
      connectorOptions: {
        ...state.connectorOptions,
        [platform]: { ...(state.connectorOptions[platform] || {}), [key]: value },
      },
    })),

  setSelectedPlatforms: (selectedPlatforms) => {
    set({ selectedPlatforms })
    if (selectedPlatforms.length > 0 && !selectedPlatforms.includes(get().activePlatformTab)) {
      set({ activePlatformTab: selectedPlatforms[0] })
    }
  },

  setActivePlatformTab: (activePlatformTab) => set({ activePlatformTab }),

  reset: (platform) => {
    if (platform) {
      set((state) => ({
        statuses: { ...state.statuses, [platform]: 'idle' as const },
        runningInfo: {
          ...state.runningInfo,
          [platform]: { crawlerType: null, startedAt: null, runId: null },
        },
      }))
    } else {
      set({
        statuses: initialStatuses,
        runningInfo: initialRunningInfo,
      })
    }
  },
}))
