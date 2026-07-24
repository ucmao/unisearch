import { workflowDefinitionSchema, type WorkflowStatus, type WorkflowStepStatus } from '../core/workflows/types';
import { skillRegistry } from '../skills/registry';
import { WorkflowRepository } from './workflow-repository';

interface ResearchWorkflowInput {
  goal: string;
  platforms: string[];
  keywords: string[];
  targets?: string[];
  capability?: string;
  connectorOptions?: Record<string, Record<string, unknown>>;
}

export interface WorkflowStepHandlerContext {
  workflowId: string;
  stepKey: string;
  signal: AbortSignal;
}

export type WorkflowStepHandler = (
  input: Record<string, unknown>,
  context: WorkflowStepHandlerContext,
) => Promise<Record<string, unknown>>;

const AGENT_STEP_STATUS: Record<string, WorkflowStepStatus> = {
  queued: 'queued',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  stopped: 'cancelled',
};

export class WorkflowEngine {
  private readonly handlers = new Map<string, WorkflowStepHandler>();

  constructor(private readonly repository = new WorkflowRepository()) {}

  registerHandler(usesId: string, handler: WorkflowStepHandler): void {
    if (this.handlers.has(usesId)) throw new Error(`Workflow handler already registered: ${usesId}`);
    this.handlers.set(usesId, handler);
  }

  async tick(workflowId: string): Promise<any> {
    for (const candidate of this.repository.listReadySteps(workflowId)) {
      const handler = this.handlers.get(candidate.uses_id);
      if (!handler) continue; // External Connector steps are synchronized by the Agent compatibility layer.
      const step = this.repository.claimStep(workflowId, candidate.step_key);
      if (!step) continue;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Number(step.timeout_ms) || 300_000);
      timeout.unref();
      try {
        const output = await handler(step.input, {
          workflowId,
          stepKey: step.step_key,
          signal: controller.signal,
        });
        this.repository.finishStep(workflowId, step.step_key, output);
      } catch (error: any) {
        const timedOut = controller.signal.aborted;
        this.repository.failStep(
          workflowId,
          step.step_key,
          timedOut ? `步骤执行超时（${step.timeout_ms}ms）` : error.message || 'Workflow step failed',
          !timedOut,
        );
      } finally {
        clearTimeout(timeout);
      }
    }
    return this.finalizeIfTerminal(workflowId);
  }

  ensureResearchWorkflow(planId: string, threadId: string, input: ResearchWorkflowInput): any {
    const existing = this.repository.getByPlan(planId);
    if (existing) {
      if (['failed', 'partially_completed', 'cancelled', 'interrupted'].includes(existing.status)) {
        this.repository.resetForRetry(existing.workflow_id);
      }
      return this.repository.get(existing.workflow_id);
    }

    const skill = skillRegistry.get('multi-source-research');
    const capability = input.capability || 'keyword_search';
    if (!skill.workflow.connectorCapabilities.includes(capability)) {
      throw new Error(`Skill ${skill.id} 不支持 Connector 能力 ${capability}`);
    }
    const connectorSteps = input.platforms.map((platform) => ({
      key: `collect:${platform}`,
      kind: 'connector' as const,
      uses: `connector.${platform}.${capability}`,
      dependsOn: [],
      input: {
        keywords: input.keywords,
        targets: input.targets || [],
        options: input.connectorOptions?.[platform] || {},
      },
      maxAttempts: 2,
      externalRef: platform,
    }));
    const definition = workflowDefinitionSchema.parse({
      skillId: skill.id,
      skillVersion: skill.version,
      input: {
        goal: input.goal,
        platforms: input.platforms,
        keywords: input.keywords,
        targets: input.targets || [],
        capability,
      },
      steps: [
        ...connectorSteps,
        {
          key: 'normalize-documents',
          kind: 'processor',
          uses: 'pipeline.document.ingestion',
          dependsOn: connectorSteps.map((step) => step.key),
          input: { processors: skill.workflow.itemProcessors },
          maxAttempts: 1,
        },
      ],
    });
    return this.repository.create(planId, threadId, definition);
  }

  syncResearchPlan(plan: { plan_id: string; status: string; steps: any[] }): any {
    const workflow = this.repository.getByPlan(plan.plan_id);
    if (!workflow) return null;
    for (const step of plan.steps) {
      const status = AGENT_STEP_STATUS[step.status];
      if (!status) continue;
      this.repository.setStepStatus(
        workflow.workflow_id,
        `collect:${step.platform}`,
        status,
        step.run_id ? { runId: step.run_id } : {},
        step.error_message || undefined,
      );
    }

    const terminal = plan.steps.every((step) => ['completed', 'failed', 'stopped'].includes(step.status));
    const completed = plan.steps.filter((step) => step.status === 'completed').length;
    if (terminal) {
      this.repository.setStepStatus(
        workflow.workflow_id,
        'normalize-documents',
        completed ? 'completed' : 'skipped',
        { processorsAppliedDuringIngestion: true },
      );
    }

    const statusMap: Record<string, WorkflowStatus> = {
      stopped: 'cancelled',
      partially_completed: 'partially_completed',
      queued: 'queued',
      running: 'running',
      completed: 'completed',
      failed: 'failed',
    };
    const workflowStatus = statusMap[plan.status] || 'created';
    this.repository.setStatus(workflow.workflow_id, workflowStatus);
    return this.repository.get(workflow.workflow_id);
  }

  cancelByPlan(planId: string): void {
    const workflow = this.repository.getByPlan(planId);
    if (workflow) this.repository.requestCancel(workflow.workflow_id);
  }

  getByPlan(planId: string): any {
    return this.repository.getByPlan(planId);
  }

  reconcileInterrupted(): number {
    return this.repository.reconcileInterrupted();
  }

  private finalizeIfTerminal(workflowId: string): any {
    const workflow = this.repository.get(workflowId);
    if (!workflow) return null;
    const statuses = workflow.steps.map((step: any) => step.status);
    if (statuses.some((status: string) => ['queued', 'running', 'waiting_for_user'].includes(status))) return workflow;
    const completed = statuses.filter((status: string) => ['completed', 'skipped'].includes(status)).length;
    const finalStatus: WorkflowStatus = completed === statuses.length
      ? 'completed'
      : completed
        ? 'partially_completed'
        : workflow.cancel_requested
          ? 'cancelled'
          : 'failed';
    this.repository.setStatus(workflowId, finalStatus);
    return this.repository.get(workflowId);
  }
}

export const workflowEngine = new WorkflowEngine();
