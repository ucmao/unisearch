import type { ItemPreview } from '@/types/crawler'

/**
 * Live crawler previews share one WebSocket/store, so every consumer must select
 * only records belonging to its own workflow round.
 */
export function selectPlanPreviews(
  previews: ItemPreview[],
  planId: string,
  afterSeq: number,
): ItemPreview[] {
  return previews.filter((item) => item.plan_id === planId && (item.seq || 0) > afterSeq)
}
