import { getConnectorManifest } from '../connectors/registry';
import { analyticsRepository } from '../database/repository';
import { resolveDepthPreset } from '../connectors/depth';
import { documentEngine } from '../document/document-engine';
import { processorWorkerExecutor } from '../processor/processor-worker-executor';
import { agentRepository, type ResearchPlan } from '../server/services/AgentRepository';
import { crawlerManager } from '../server/services/CrawlerManager';
import { workflowEngine, type WorkflowStepHandlerContext } from './workflow-engine';
import { knowledgeIndex } from '../knowledge/knowledge-index';
import { analysisService } from '../analyzers/registry';
import { exportService, exporterRegistry } from '../exporters/registry';
import { skillRegistry } from '../skills/registry';
import type { DatasetProfile } from '../analyzers/dataset-profiler';
import { quickReportGenerator } from '../analyzers/quick-report-generator';

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
    workflowEngine.registerHandler('processor.search-results.select', (input, context) =>
      this.selectSearchUrls(input, context));
    workflowEngine.registerHandler('analyzer.knowledge.index', (_input, context) =>
      Promise.resolve(knowledgeIndex.rebuild({ workflowId: context.workflowId })));
    workflowEngine.registerHandler('analyzer.dataset.profile', (input, context) =>
      analysisService.run('dataset.profile', context.workflowId, input));
    workflowEngine.registerHandler('analyzer.business.insight', (_input, context) =>
      this.createBusinessAnalysis(context));
    for (const exporter of exporterRegistry.list()) {
      workflowEngine.registerHandler(`exporter.${exporter.id}`, (_input, context) =>
        exportService.run(exporter.id, context.workflowId));
    }
  }

  private async createBusinessAnalysis(
    context: WorkflowStepHandlerContext,
  ): Promise<Record<string, unknown>> {
    const workflow = agentRepository.getPlan(context.workflowId);
    if (!workflow) throw new Error('Workflow 不存在');
    const skill = skillRegistry.find(workflow.plan.skillId);
    const isBusinessAnalysis = Boolean(skill?.execution.autoAnalyzeOnCompletion);
    if (!isBusinessAnalysis && !workflow.plan.analysis?.length) {
      return { skipped: true, reason: '计划未要求自动分析' };
    }

    const analysisAction = isBusinessAnalysis ? 'auto_skill_analysis' : 'auto_plan_analysis';
    const reportName = isBusinessAnalysis ? skill?.name || '业务调研' : '采集结果';
    const existing = agentRepository.getThread(workflow.thread_id)?.messages?.some((message: any) =>
      ['auto_skill_analysis', 'auto_plan_analysis'].includes(message.metadata?.action)
        && message.metadata?.plan_id === workflow.plan_id,
    );
    if (existing) return { skipped: true, reason: '自动分析已生成' };

    const profileStepOutput = agentRepository.getStepOutput(workflow.plan_id, 'profile-dataset');
    const datasetProfile = (profileStepOutput.metadata as { datasetProfile?: DatasetProfile } | undefined)?.datasetProfile;
    if (!datasetProfile) throw new Error('数据集全量统计结果不存在');
    const datasetProfileReportId = String(profileStepOutput.report_id || '');
    const documentCount = datasetProfile.documentCount;
    if (!documentCount) return { skipped: true, reason: '没有可分析的数据', recordCount: 0 };

    try {
      const analysisGoals = workflow.plan.analysis || [];
      const result = await quickReportGenerator.generate({
        threadId: workflow.thread_id,
        workflowId: workflow.plan_id,
        workflowGoal: workflow.goal,
        reportName,
        userRequest: `生成本次“${reportName}”的最终分析报告`,
        analysisGoals,
        skillName: skill?.name,
        skillInstructions: isBusinessAnalysis ? skill?.analysisInstructions : undefined,
        datasetProfile,
        signal: context.signal,
      });
      context.signal.throwIfAborted();
      const analysisReport = analysisService.saveReport({
        analyzerId: 'quick.report',
        analyzerVersion: '1.0.0',
        workflowId: workflow.plan_id,
        title: result.title,
        content: result.answer,
        metadata: {
          datasetProfileReportId,
          coverage: result.coverage,
          evidenceSelection: result.evidenceSelection,
          sources: result.sources,
        },
      });
      const startTime = new Date(workflow.created_at || workflow.started_at || Date.now()).getTime();
      const endTime = Date.now();
      const totalSeconds = Math.max(1, Math.round((endTime - startTime) / 1000));
      const formattedTotalTime = totalSeconds >= 60
        ? `${Math.floor(totalSeconds / 60)}分${totalSeconds % 60}秒`
        : `${totalSeconds}秒`;

      const finalReportAnswer = result.answer;

      agentRepository.addMessage(workflow.thread_id, 'assistant', 'analysis', finalReportAnswer, {
        action: analysisAction,
        plan_id: workflow.plan_id,
        skill_id: skill?.id,
        retrieval: 'stratified_hybrid_rag',
        sources: result.sources,
        analysis_coverage: result.coverage,
        evidence_selection: result.evidenceSelection,
        dataset_profile_report_id: datasetProfileReportId,
        analysis_report_id: analysisReport.report_id,
        total_duration_sec: totalSeconds,
        total_duration_formatted: formattedTotalTime,
      });
      return {
        recordCount: documentCount,
        sourceCount: result.sources.length,
        coverage: result.coverage,
        datasetProfileReportId,
        analysisReportId: analysisReport.report_id,
        totalDurationSec: totalSeconds,
      };
    } catch (error: any) {
      context.signal.throwIfAborted();
      agentRepository.addMessage(
        workflow.thread_id,
        'assistant',
        'status',
        `采集数据已保存，但“${reportName}”自动分析失败：${error.message || '未知错误'}。你可以稍后直接说“分析这些结果”重试。`,
        { action: `${analysisAction}_error`, plan_id: workflow.plan_id, skill_id: skill?.id },
      );
      return { failed: true, error: error.message || '未知错误', recordCount: documentCount };
    }
  }

  queue(workflowId: string): any {
    const workflow = agentRepository.getPlan(workflowId);
    if (!workflow) throw new Error('Workflow 不存在');
    // A connector that exits cleanly without collecting anything is 'completed',
    // so an all-empty plan reads as 'completed' too. Treat those steps as retryable.
    const emptyStepKeys = collectEmptyStepKeys(workflow);
    // 'stopped' is retryable too: a user who aborts mid-run should be able to
    // resume the platforms that never finished, without rebuilding the plan.
    const isRetryableStatus = ['awaiting_confirmation', 'failed', 'partially_completed', 'interrupted', 'stopped']
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
      if (state.status === 'running' || state.status === 'stopping') {
        // item_count is otherwise only written when the run finishes, leaving the
        // dashboard blank for the whole duration of a slow platform.
        if (step.run_id) analyticsRepository.refreshRunCounts(step.run_id);
        continue;
      }
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
      if (!agentRepository.isStepReady(workflow.plan_id, step.step_key)) continue;
      if (!crawlerManager.hasCapacity()) break;
      const platformState = crawlerManager.getStatus(step.platform);
      if (platformState.status === 'running' || platformState.status === 'stopping') continue;
      const plan = workflow.plan as ResearchPlan;
      const stepInput = step.input && typeof step.input === 'object' ? step.input : {};
      const targetOutput = typeof stepInput.targetsFromStep === 'string'
        ? agentRepository.getStepOutput(workflow.plan_id, stepInput.targetsFromStep)
        : null;
      const targets = Array.isArray(targetOutput?.targets)
        ? targetOutput.targets.map(String)
        : Array.isArray(stepInput.targets) ? stepInput.targets.map(String) : plan.targets || [];
      const capabilityId = String(stepInput.capability || plan.capability || 'keyword_search') as NonNullable<ResearchPlan['capability']>;
      const manifest = getConnectorManifest(step.platform);
      const capability = manifest?.capabilities.find((item) => item.id === capabilityId);
      if (!capability) {
        agentRepository.updateStep(step.step_id, 'failed', null, `${manifest?.name || step.platform} 不支持能力 ${capabilityId}`);
        continue;
      }
      const depth = plan.collectionDepth || 'quick';
      const preset = resolveDepthPreset(capability, depth);
      const maxItemsDefault = capability.inputFields.find((field) => field.key === 'max_items')?.default;
      // The 'comments' capability exists solely to fetch comments, so it forces them on
      // regardless of depth. Every other combination comes from the capability's own preset.
      const resolvedComments = capabilityId === 'comments' ? true : Boolean(preset.collectComments);
      const connectorOptions = {
        collection_depth: depth,
        ...(preset.maxItems !== undefined ? { max_items: preset.maxItems }
          : maxItemsDefault !== undefined ? { max_items: Number(maxItemsDefault) } : {}),
        ...(stepInput.options && typeof stepInput.options === 'object' ? stepInput.options : {}),
        ...(capabilityId === 'creator_profile' ? { creator_ids: targets } : {}),
        ...(['content_detail', 'comments', 'url_resolve'].includes(capabilityId) ? { specified_ids: targets } : {}),
        enable_comments: resolvedComments,
      };
      if (['content_detail', 'comments', 'url_resolve'].includes(capabilityId) && !targets.length) {
        agentRepository.updateStep(step.step_id, 'skipped', null, null);
        continue;
      }
      try {
        const started = await crawlerManager.start({
          platform: step.platform,
          connector_id: step.platform,
          capability: capabilityId,
          login_type: plan.loginType,
          crawler_type: capability.runtimeMode,
          keywords: Array.isArray(stepInput.keywords) ? stepInput.keywords.map(String).join(',') : plan.keywords.join(','),
          specified_ids: ['content_detail', 'comments', 'url_resolve'].includes(capabilityId) ? targets.join(',') : '',
          creator_ids: capabilityId === 'creator_profile' ? targets.join(',') : '',
          connector_options: connectorOptions,
          // Only true_pagination capabilities declare a start_page input field; for
          // everyone else this stays 1 and the connector ignores it anyway.
          start_page: Number((connectorOptions as Record<string, unknown>).start_page) || 1,
          collection_depth: depth,
          enable_comments: resolvedComments,
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
          agentRepository.updatePlanStatus(workflow.plan_id, 'running');
        }
      } catch (error: any) {
        agentRepository.updateStep(step.step_id, 'failed', null, error.message || 'Connector 参数校验失败');
      }
    }
  }

  private async selectSearchUrls(
    input: Record<string, unknown>,
    context: WorkflowStepHandlerContext,
  ): Promise<Record<string, unknown>> {
    context.signal.throwIfAborted();
    const maxReadItems = Math.max(1, Math.min(100, Number(input.maxReadItems || 8)));
    const maxPerDomain = Math.max(1, Math.min(20, Number(input.maxPerDomain || 2)));
    const selected = agentRepository.selectSearchUrls(context.workflowId, { maxReadItems, maxPerDomain });
    return {
      targets: selected.map((item) => item.url),
      selected,
      selectedCount: selected.length,
    };
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
