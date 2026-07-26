import { getConnectorManifest } from '../connectors/registry';
import { resolveDepthPreset } from '../connectors/depth';
import { documentEngine } from '../document/document-engine';
import { processorWorkerExecutor } from '../processor/processor-worker-executor';
import { agentRepository, type ResearchPlan } from '../server/services/AgentRepository';
import { crawlerManager } from '../server/services/CrawlerManager';
import { workflowEngine, type WorkflowStepHandlerContext } from './workflow-engine';
import { knowledgeIndex } from '../knowledge/knowledge-index';
import { analysisService } from '../analyzers/registry';
import { exportService, exporterRegistry } from '../exporters/registry';

export interface WorkflowTickResult {
  workflow: any;
  becameTerminal: boolean;
}

const TERMINAL_WORKFLOW_STATUSES = new Set([
  'completed', 'partially_completed', 'failed', 'cancelled', 'stopped', 'interrupted',
]);

function collectEmptyStepKeys(workflow: any): string[] {
  return (workflow.steps || [])
    .filter((step: any) => step.status === 'completed' && Number(step.item_count || 0) === 0)
    .map((step: any) => String(step.step_key));
}

export class WorkflowRuntime {
  constructor() {
    workflowEngine.registerHandler('processor.documents.finalize', (input, context) =>
      this.finalizeDocuments(input, context));
    workflowEngine.registerHandler('analyzer.knowledge.index', (_input, context) =>
      Promise.resolve(knowledgeIndex.rebuild(context.workflowId)));
    workflowEngine.registerHandler('analyzer.extractive.summary', (input, context) =>
      analysisService.run('extractive.summary', context.workflowId, input));
    for (const exporter of exporterRegistry.list()) {
      workflowEngine.registerHandler(`exporter.${exporter.id}`, (_input, context) =>
        exportService.run(exporter.id, context.workflowId));
    }
  }

  queue(workflowId: string): any {
    const workflow = agentRepository.getPlan(workflowId);
    if (!workflow) throw new Error('Workflow 不存在');
    // A connector that exits cleanly without collecting anything is 'completed',
    // so an all-empty plan reads as 'completed' too. Treat those steps as retryable.
    const emptyStepKeys = collectEmptyStepKeys(workflow);
    const isRetryableStatus = ['awaiting_confirmation', 'failed', 'partially_completed', 'interrupted']
      .includes(workflow.status);
    if (!isRetryableStatus && !(workflow.status === 'completed' && emptyStepKeys.length)) {
      throw new Error('当前 Workflow 不能执行');
    }
    if (workflow.status === 'awaiting_confirmation') agentRepository.updatePlanStatus(workflowId, 'queued');
    else workflowEngine.retry(workflowId, emptyStepKeys);
    return agentRepository.getPlan(workflowId);
  }

  async cancel(workflowId: string): Promise<void> {
    const workflow = agentRepository.getPlan(workflowId);
    if (!workflow) return;
    for (const step of workflow.steps) {
      if (step.status === 'running') await crawlerManager.stop(step.platform);
    }
    workflowEngine.cancel(workflowId);
    agentRepository.updatePlanStatus(workflowId, 'stopped');
  }

  async tickAll(): Promise<WorkflowTickResult[]> {
    crawlerManager.setMaxConcurrentTasks(agentRepository.getRuntimeSettings().maxConcurrentCrawlers);
    const results: WorkflowTickResult[] = [];
    for (const workflow of agentRepository.listActivePlans()) {
      const previousStatus = workflow.status;
      const current = await this.tickOne(workflow);
      results.push({
        workflow: current,
        becameTerminal: !TERMINAL_WORKFLOW_STATUSES.has(previousStatus)
          && TERMINAL_WORKFLOW_STATUSES.has(current.status),
      });
    }
    return results;
  }

  private async tickOne(workflow: any): Promise<any> {
    this.reconcileConnectorSteps(workflow);
    const refreshed = agentRepository.getPlan(workflow.plan_id);
    await this.startReadyConnectors(refreshed);
    return workflowEngine.tick(workflow.plan_id);
  }

  private reconcileConnectorSteps(workflow: any): void {
    for (const step of workflow.steps) {
      if (step.status !== 'running') continue;
      const state = crawlerManager.getStatus(step.platform);
      if (state.status === 'running' || state.status === 'stopping') continue;
      const run = step.run_id ? agentRepository.getCrawlRun(step.run_id) : null;
      if (run?.status === 'completed') agentRepository.updateStep(step.step_id, 'completed', step.run_id, null);
      else {
        const status = run?.status === 'stopped' ? 'cancelled' : 'failed';
        agentRepository.updateStep(step.step_id, status, step.run_id, run?.error_message || 'Connector 进程未正常完成');
      }
    }
  }

  private async startReadyConnectors(workflow: any): Promise<void> {
    for (const step of workflow.steps.filter((candidate: any) => candidate.status === 'queued')) {
      if (!crawlerManager.hasCapacity()) break;
      const platformState = crawlerManager.getStatus(step.platform);
      if (platformState.status === 'running' || platformState.status === 'stopping') continue;
      const plan = workflow.plan as ResearchPlan;
      const targets = plan.targets || [];
      const capabilityId = plan.capability || 'keyword_search';
      const manifest = getConnectorManifest(step.platform);
      const capability = manifest?.capabilities.find((item) => item.id === capabilityId);
      if (!capability) {
        agentRepository.updateStep(step.step_id, 'failed', null, `${manifest?.name || step.platform} 不支持能力 ${capabilityId}`);
        continue;
      }
      const depth = plan.collectionDepth || 'standard';
      const preset = resolveDepthPreset(capability.budgetModel, depth);
      const maxItemsDefault = capability.inputFields.find((field) => field.key === 'max_items')?.default;
      // The 'comments' capability exists solely to fetch comments, so it forces them on
      // regardless of depth. Every other combination comes from the capability's own preset.
      const resolvedComments = capabilityId === 'comments' ? true : Boolean(preset.collectComments);
      const resolvedSubComments = capabilityId === 'comments' ? true : Boolean(preset.collectSubComments);
      const connectorOptions = {
        collection_depth: depth,
        ...(preset.maxItems !== undefined ? { max_items: preset.maxItems }
          : maxItemsDefault !== undefined ? { max_items: Number(maxItemsDefault) } : {}),
        ...(plan.connectorOptions?.[step.platform] || {}),
        ...(capabilityId === 'creator_profile' ? { creator_ids: targets } : {}),
        ...(['content_detail', 'comments', 'url_resolve'].includes(capabilityId) ? { specified_ids: targets } : {}),
        enable_comments: resolvedComments,
        enable_sub_comments: resolvedSubComments,
      };
      try {
        const started = await crawlerManager.start({
          platform: step.platform,
          connector_id: step.platform,
          capability: capabilityId,
          login_type: plan.loginType,
          crawler_type: capability.runtimeMode,
          keywords: plan.keywords.join(','),
          specified_ids: ['content_detail', 'comments', 'url_resolve'].includes(capabilityId) ? targets.join(',') : '',
          creator_ids: capabilityId === 'creator_profile' ? targets.join(',') : '',
          connector_options: connectorOptions,
          // Only true_pagination capabilities declare a start_page input field; for
          // everyone else this stays 1 and the connector ignores it anyway.
          start_page: Number((connectorOptions as Record<string, unknown>).start_page) || 1,
          collection_depth: depth,
          enable_comments: resolvedComments,
          enable_sub_comments: resolvedSubComments,
          cookies: '',
          headless: plan.headless,
          loop_execution: false,
          thread_id: workflow.thread_id,
          workflow_id: workflow.plan_id,
          task_title: workflow.goal,
        });
        if (started) {
          const state = crawlerManager.getStatus(step.platform);
          agentRepository.updateStep(step.step_id, 'running', state.run_id, null);
        }
      } catch (error: any) {
        agentRepository.updateStep(step.step_id, 'failed', null, error.message || 'Connector 参数校验失败');
      }
    }
  }

  private async finalizeDocuments(
    input: Record<string, unknown>,
    context: WorkflowStepHandlerContext,
  ): Promise<Record<string, unknown>> {
    const workflow = workflowEngine.get(context.workflowId);
    const runIds = workflow.steps
      .filter((step: any) => step.kind === 'connector')
      .map((step: any) => String(step.output?.runId || ''))
      .filter(Boolean);
    const documentsById = new Map<string, any>();
    for (const runId of runIds) {
      for (const document of documentEngine.listByRun(runId, 5000)) documentsById.set(document.documentId, document);
    }
    const processorIds = Array.isArray(input.processorIds)
      ? input.processorIds.map(String)
      : ['metadata.normalize', 'document.clean_markdown'];
    const documents = [...documentsById.values()];
    for (let offset = 0; offset < documents.length; offset += 25) {
      const result = await processorWorkerExecutor.run(processorIds, documents.slice(offset, offset + 25), {
        signal: context.signal,
        timeoutMs: 300_000,
      });
      for (const document of result.documents) {
        documentEngine.saveProcessed(
          document,
          result.artifacts.filter((artifact) => artifact.documentId === document.documentId),
        );
      }
    }
    return { documentCount: documents.length, processorIds };
  }
}

export const workflowRuntime = new WorkflowRuntime();
