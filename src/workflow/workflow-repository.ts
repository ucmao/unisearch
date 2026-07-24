import { randomUUID } from 'crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '../database/connection';
import {
  workflowDefinitionSchema,
  workflowStatusSchema,
  workflowStepStatusSchema,
  type WorkflowDefinition,
  type WorkflowStatus,
  type WorkflowStepStatus,
} from '../core/workflows/types';

function id(): string {
  return randomUUID().replace(/-/g, '');
}

function json(value: string): any {
  try { return JSON.parse(value); } catch { return {}; }
}

function validateDependencies(definition: WorkflowDefinition): void {
  const keys = new Set(definition.steps.map((step) => step.key));
  if (keys.size !== definition.steps.length) throw new Error('Workflow step keys must be unique');
  for (const step of definition.steps) {
    for (const dependency of step.dependsOn) {
      if (!keys.has(dependency)) throw new Error(`Unknown workflow dependency: ${dependency}`);
      if (dependency === step.key) throw new Error(`Workflow step cannot depend on itself: ${step.key}`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byKey = new Map(definition.steps.map((step) => [step.key, step]));
  const visit = (key: string): void => {
    if (visiting.has(key)) throw new Error(`Workflow contains a dependency cycle at ${key}`);
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of byKey.get(key)?.dependsOn || []) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of keys) visit(key);
}

export class WorkflowRepository {
  constructor(private readonly databaseProvider: () => Database = getDb) {}

  private get db(): Database {
    return this.databaseProvider();
  }

  create(planId: string | null, threadId: string | null, definitionInput: WorkflowDefinition): any {
    const definition = workflowDefinitionSchema.parse(definitionInput);
    validateDependencies(definition);
    if (planId) {
      const existing = this.getByPlan(planId);
      if (existing) return existing;
    }
    const workflowId = id();
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO workflow_runs (
          workflow_id, plan_id, thread_id, skill_id, skill_version, status,
          input_json, output_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'queued', ?, '{}', ?, ?)
      `).run(
        workflowId,
        planId,
        threadId,
        definition.skillId,
        definition.skillVersion,
        JSON.stringify(definition.input),
        now,
        now,
      );
      const insert = this.db.prepare(`
        INSERT INTO workflow_steps (
          step_id, workflow_id, step_key, kind, uses_id, depends_on_json,
          input_json, output_json, status, max_attempts, timeout_ms, external_ref, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', 'queued', ?, ?, ?, ?, ?)
      `);
      for (const step of definition.steps) {
        insert.run(
          id(),
          workflowId,
          step.key,
          step.kind,
          step.uses,
          JSON.stringify(step.dependsOn),
          JSON.stringify(step.input),
          step.maxAttempts,
          step.timeoutMs,
          step.externalRef || null,
          now,
          now,
        );
      }
    })();
    return this.get(workflowId);
  }

  get(workflowId: string): any {
    const run = this.db.prepare('SELECT * FROM workflow_runs WHERE workflow_id=?').get(workflowId) as any;
    if (!run) return null;
    const steps = (this.db.prepare(`
      SELECT * FROM workflow_steps WHERE workflow_id=? ORDER BY rowid
    `).all(workflowId) as any[]).map((step) => ({
      ...step,
      depends_on: json(step.depends_on_json),
      input: json(step.input_json),
      output: json(step.output_json),
    }));
    return {
      ...run,
      input: json(run.input_json),
      output: json(run.output_json),
      cancel_requested: Boolean(run.cancel_requested),
      steps,
    };
  }

  getByPlan(planId: string): any {
    const row = this.db.prepare('SELECT workflow_id FROM workflow_runs WHERE plan_id=?').get(planId) as any;
    return row ? this.get(row.workflow_id) : null;
  }

  setStatus(workflowId: string, statusInput: WorkflowStatus, errorMessage?: string): void {
    const status = workflowStatusSchema.parse(statusInput);
    const now = new Date().toISOString();
    const terminal = ['completed', 'partially_completed', 'failed', 'cancelled', 'interrupted'].includes(status);
    this.db.prepare(`
      UPDATE workflow_runs SET
        status=?,
        error_message=?,
        updated_at=?,
        started_at=CASE WHEN ?='running' THEN COALESCE(started_at, ?) ELSE started_at END,
        finished_at=CASE WHEN ? THEN COALESCE(finished_at, ?) ELSE finished_at END
      WHERE workflow_id=?
    `).run(status, errorMessage || null, now, status, now, terminal ? 1 : 0, now, workflowId);
  }

  setStepStatus(
    workflowId: string,
    stepKey: string,
    statusInput: WorkflowStepStatus,
    output: Record<string, unknown> = {},
    errorMessage?: string,
  ): void {
    const status = workflowStepStatusSchema.parse(statusInput);
    const now = new Date().toISOString();
    const terminal = ['completed', 'failed', 'cancelled', 'skipped'].includes(status);
    this.db.prepare(`
      UPDATE workflow_steps SET
        status=?,
        output_json=?,
        error_message=?,
        attempt=CASE WHEN ?='running' AND status!='running' THEN attempt + 1 ELSE attempt END,
        updated_at=?,
        started_at=CASE WHEN ?='running' THEN COALESCE(started_at, ?) ELSE started_at END,
        finished_at=CASE WHEN ? THEN COALESCE(finished_at, ?) ELSE finished_at END
      WHERE workflow_id=? AND step_key=?
    `).run(
      status,
      JSON.stringify(output),
      errorMessage || null,
      status,
      now,
      status,
      now,
      terminal ? 1 : 0,
      now,
      workflowId,
      stepKey,
    );
  }

  requestCancel(workflowId: string): void {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE workflow_runs SET cancel_requested=1, status='cancelled', updated_at=?, finished_at=? WHERE workflow_id=?
      `).run(now, now, workflowId);
      this.db.prepare(`
        UPDATE workflow_steps SET status='cancelled', updated_at=?, finished_at=?
        WHERE workflow_id=? AND status IN ('queued','running','waiting_for_user')
      `).run(now, now, workflowId);
    })();
  }

  resetForRetry(workflowId: string): void {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE workflow_runs SET status='queued', cancel_requested=0, error_message=NULL,
          output_json='{}', updated_at=?, started_at=NULL, finished_at=NULL
        WHERE workflow_id=?
      `).run(now, workflowId);
      this.db.prepare(`
        UPDATE workflow_steps SET status='queued', error_message=NULL, output_json='{}',
          updated_at=?, started_at=NULL, finished_at=NULL
        WHERE workflow_id=? AND status!='completed'
      `).run(now, workflowId);
    })();
  }

  listReadySteps(workflowId: string): any[] {
    const workflow = this.get(workflowId);
    if (!workflow || workflow.cancel_requested) return [];
    const statusByKey = new Map(workflow.steps.map((step: any) => [step.step_key, step.status]));
    return workflow.steps.filter((step: any) =>
      step.status === 'queued'
      && step.attempt < step.max_attempts
      && step.depends_on.every((dependency: string) => ['completed', 'skipped'].includes(String(statusByKey.get(dependency)))),
    );
  }

  claimStep(workflowId: string, stepKey: string): any | null {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE workflow_steps SET status='running', attempt=attempt+1,
        updated_at=?, started_at=COALESCE(started_at, ?)
      WHERE workflow_id=? AND step_key=? AND status='queued' AND attempt < max_attempts
        AND (SELECT cancel_requested FROM workflow_runs WHERE workflow_id=?)=0
    `).run(now, now, workflowId, stepKey, workflowId);
    if (!result.changes) return null;
    this.setStatus(workflowId, 'running');
    return this.get(workflowId)?.steps.find((step: any) => step.step_key === stepKey) || null;
  }

  finishStep(
    workflowId: string,
    stepKey: string,
    output: Record<string, unknown>,
  ): void {
    this.setStepStatus(workflowId, stepKey, 'completed', output);
  }

  failStep(workflowId: string, stepKey: string, errorMessage: string, retryable: boolean): void {
    const step = this.get(workflowId)?.steps.find((item: any) => item.step_key === stepKey);
    if (!step) return;
    if (retryable && step.attempt < step.max_attempts) {
      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE workflow_steps SET status='queued', error_message=?, updated_at=?,
          started_at=NULL, finished_at=NULL WHERE workflow_id=? AND step_key=?
      `).run(errorMessage, now, workflowId, stepKey);
      return;
    }
    this.setStepStatus(workflowId, stepKey, 'failed', {}, errorMessage);
  }

  reconcileInterrupted(): number {
    const now = new Date().toISOString();
    return this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE workflow_runs SET status='interrupted',
          error_message=COALESCE(error_message, '应用重启或执行进程中断'),
          updated_at=?, finished_at=COALESCE(finished_at, ?)
        WHERE status IN ('queued','running','waiting_for_user')
      `).run(now, now);
      this.db.prepare(`
        UPDATE workflow_steps SET status='failed',
          error_message=COALESCE(error_message, '应用重启或执行进程中断'),
          updated_at=?, finished_at=COALESCE(finished_at, ?)
        WHERE status IN ('running','waiting_for_user')
      `).run(now, now);
      return Number(result.changes);
    })();
  }
}
