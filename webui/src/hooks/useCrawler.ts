import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { crawlerApi, configApi } from '@/lib/api'
import { useCrawlerStore } from '@/store/crawlerStore'
import type { CrawlerConfig } from '@/types/crawler'

export function useCrawlerStatus() {
  const setBulkStatus = useCrawlerStore((state) => state.setBulkStatus)

  return useQuery({
    queryKey: ['crawlerStatus'],
    queryFn: async () => {
      const { data } = await crawlerApi.getStatus()
      if (data.platform_states) {
        setBulkStatus(data.platform_states)
      }
      return data
    },
    refetchInterval: 2000,
  })
}

export function useStartCrawler() {
  const queryClient = useQueryClient()
  const setStatus = useCrawlerStore((state) => state.setStatus)
  const clearLogs = useCrawlerStore((state) => state.clearLogs)

  return useMutation({
    mutationFn: (config: CrawlerConfig) => crawlerApi.start(config),
    onMutate: (config) => {
      clearLogs(config.platform)
      setStatus(config.platform, 'running')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crawlerStatus'] })
    },
    onError: (error: Error, config) => {
      setStatus(config.platform, 'idle')
      toast.error(`启动 ${config.platform} 采集失败：${error.message}`, { id: 'crawler-start-error' })
    },
  })
}

export function useStopCrawler() {
  const queryClient = useQueryClient()
  const setStatus = useCrawlerStore((state) => state.setStatus)

  return useMutation({
    mutationFn: (platform?: string) => crawlerApi.stop(platform),
    onMutate: (platform) => {
      if (platform) {
        setStatus(platform, 'stopping')
      }
    },
    onSuccess: ({ data }, platform) => {
      if (platform) {
        setStatus(platform, 'idle')
      }
      queryClient.invalidateQueries({ queryKey: ['crawlerStatus'] })
      // Stopping a crawler that belongs to a plan cancels the whole plan, since
      // otherwise the plan would just move on to its next platform. Say so.
      const cancelled = data?.cancelled_plans?.length || 0
      if (cancelled > 0) {
        toast.info(`已同时中止 ${cancelled} 个采集任务（该平台属于任务计划，仅停进程会继续跑下一个平台）`)
        queryClient.invalidateQueries({ queryKey: ['agent-threads'] })
        queryClient.invalidateQueries({ queryKey: ['agent-thread'] })
      }
    },
    onError: (error: Error, platform) => {
      toast.error(`停止采集失败：${error.message}`, { id: 'crawler-stop-error' })
      if (platform) {
        queryClient.invalidateQueries({ queryKey: ['crawlerStatus'] })
      }
    },
  })
}

export function useCrawlerLogs() {
  return useQuery({
    queryKey: ['crawlerLogs'],
    queryFn: async () => {
      const { data } = await crawlerApi.getLogs(undefined, 500)
      return data.logs
    },
    refetchInterval: false, // Use WebSocket instead
  })
}

export function useThreadLogs(threadId?: string, platform?: string) {
  return useQuery({
    queryKey: ['crawlerLogs', threadId, platform],
    queryFn: async () => {
      if (!threadId) return []
      const { data } = await crawlerApi.getLogs(platform, 500, threadId)
      return data.logs
    },
    enabled: Boolean(threadId),
  })
}

export function usePlatforms() {
  return useQuery({
    queryKey: ['platforms'],
    queryFn: async () => {
      const { data } = await configApi.getPlatforms()
      return data.platforms
    },
    staleTime: Infinity,
  })
}

export function useConnectors() {
  return useQuery({
    queryKey: ['connectors'],
    queryFn: async () => {
      const { data } = await configApi.getConnectors()
      return data.connectors
    },
    staleTime: Infinity,
  })
}

export function useConfigOptions() {
  return useQuery({
    queryKey: ['configOptions'],
    queryFn: async () => {
      const { data } = await configApi.getOptions()
      return data
    },
    staleTime: Infinity,
  })
}
