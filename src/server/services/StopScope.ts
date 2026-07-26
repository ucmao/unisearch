export interface RunningCrawlerState {
  status?: string;
  run_id?: string | null;
}

const ACTIVE_STATUSES = new Set(['running', 'stopping']);

/**
 * Which plans own the crawlers that a platform-level stop would kill.
 *
 * Stopping a plan's crawler process without cancelling the plan is worse than
 * doing nothing: the workflow marks that step cancelled and immediately starts
 * the next queued platform, so the user sees collection continue after pressing
 * stop. Callers must cancel these plans instead of only killing the process.
 */
export function planIdsForRunningCrawlers(
  states: RunningCrawlerState[],
  workflowIdOfRun: (runId: string) => string | null | undefined,
): string[] {
  const planIds = new Set<string>();
  for (const state of states) {
    if (!state?.run_id || !ACTIVE_STATUSES.has(String(state.status))) continue;
    const workflowId = workflowIdOfRun(state.run_id);
    if (workflowId) planIds.add(workflowId);
  }
  return [...planIds];
}
