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
    onSuccess: (_, config) => {
      toast.success(`Crawler started successfully for ${config.platform}`)
      queryClient.invalidateQueries({ queryKey: ['crawlerStatus'] })
    },
    onError: (error: Error, config) => {
      setStatus(config.platform, 'idle')
      toast.error(`Failed to start crawler for ${config.platform}: ${error.message}`)
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
    onSuccess: (_, platform) => {
      toast.success(`Crawler stopped for ${platform || 'all'}`)
      if (platform) {
        setStatus(platform, 'idle')
      }
      queryClient.invalidateQueries({ queryKey: ['crawlerStatus'] })
    },
    onError: (error: Error, platform) => {
      toast.error(`Failed to stop crawler: ${error.message}`)
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
