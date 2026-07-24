import type { WorkflowDefinition, WorkflowStatus } from '../core/workflows/types';
import { WorkflowRepository } from './workflow-repository';

export interface WorkflowStepHandlerContext {
  workflowId: string;
  stepKey: string;
  signal: AbortSignal;
}

export type WorkflowStepHandler = (
  input: Record<string, unknown>,
  context: WorkflowStepHandlerContext,
) => Promise<Record<string, unknown>>;

export class WorkflowEngine {
  private readonly handlers = new Map<string, WorkflowStepHandler>();
  private readonly activeControllers = new Map<string, AbortController>();

  constructor(private readonly repository = new WorkflowRepository()) {}

  create(threadId: string | null, definition: WorkflowDefinition): any {
    return this.repository.create(threadId, definition);
  }

  get(workflowId: string): any {
    return this.repository.get(workflowId);
  }

  registerHandler(usesId: string, handler: WorkflowStepHandler): void {
    if (this.handlers.has(usesId)) throw new Error(`Workflow handler already registered: ${usesId}`);
    this.handlers.set(usesId, handler);
  }

  async tick(workflowId: string): Promise<any> {
    for (const candidate of this.repository.listReadySteps(workflowId)) {
      const handler = this.handlers.get(candidate.uses_id);
      if (!handler) continue;
      const step = this.repository.claimStep(workflowId, candidate.step_key);
      if (!step) continue;
      const controller = new AbortController();
      const controllerKey = `${workflowId}:${step.step_key}`;
      this.activeControllers.set(controllerKey, controller);
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
        this.repository.failStep(
          workflowId,
          step.step_key,
          controller.signal.aborted
            ? `步骤执行超时（${step.timeout_ms}ms）`
            : error.message || 'Workflow step failed',
          !controller.signal.aborted,
        );
      } finally {
        clearTimeout(timeout);
        this.activeControllers.delete(controllerKey);
      }
    }
    return this.finalizeIfTerminal(workflowId);
  }

  cancel(workflowId: string): void {
    for (const [key, controller] of this.activeControllers) {
      if (key.startsWith(`${workflowId}:`)) controller.abort();
    }
    this.repository.requestCancel(workflowId);
  }

  retry(workflowId: string): any {
    this.repository.resetForRetry(workflowId);
    return this.repository.get(workflowId);
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
    const status: WorkflowStatus = completed === statuses.length
      ? 'completed'
      : completed ? 'partially_completed' : workflow.cancel_requested ? 'cancelled' : 'failed';
    this.repository.setStatus(workflowId, status);
    return this.repository.get(workflowId);
  }
}

export const workflowEngine = new WorkflowEngine();
