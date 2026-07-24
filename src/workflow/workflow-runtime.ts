import { getConnectorManifest } from '../connectors/registry';
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
    if (!['awaiting_confirmation', 'failed', 'partially_completed', 'interrupted'].includes(workflow.status)) {
      throw new Error('当前 Workflow 不能执行');
    }
    if (workflow.status === 'awaiting_confirmation') agentRepository.updatePlanStatus(workflowId, 'queued');
    else workflowEngine.retry(workflowId);
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
      const maxCount = depth === 'quick' ? 30 : depth === 'deep' ? 100 : 50;
      const maxPages = depth === 'quick' ? 3 : depth === 'deep' ? 10 : 5;
      const connectorOptions = {
        collection_depth: depth,
        crawler_max_notes_count: maxCount,
        max_items: maxCount,
        max_pages: maxPages,
        ...(plan.connectorOptions?.[step.platform] || {}),
        ...(capabilityId === 'creator_profile' ? { creator_ids: targets } : {}),
        ...(['content_detail', 'comments', 'url_resolve'].includes(capabilityId) ? { specified_ids: targets } : {}),
        enable_comments: capabilityId === 'comments' ? true : plan.collectComments,
        enable_sub_comments: capabilityId === 'comments' ? true : plan.collectSubComments,
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
          start_page: plan.startPage,
          collection_depth: depth,
          enable_comments: plan.collectComments,
          enable_sub_comments: plan.collectSubComments,
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
