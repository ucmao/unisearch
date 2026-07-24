import { z } from 'zod';

export const workflowStepKindSchema = z.enum(['connector', 'processor', 'analyzer', 'exporter']);
export const workflowStatusSchema = z.enum([
  'created',
  'queued',
  'running',
  'waiting_for_user',
  'completed',
  'partially_completed',
  'failed',
  'cancelled',
  'interrupted',
]);
export const workflowStepStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_for_user',
  'completed',
  'failed',
  'cancelled',
  'skipped',
]);

export const workflowStepDefinitionSchema = z.object({
  key: z.string().min(1),
  kind: workflowStepKindSchema,
  uses: z.string().min(1),
  dependsOn: z.array(z.string()).default([]),
  input: z.record(z.unknown()).default({}),
  maxAttempts: z.number().int().min(1).max(10).default(1),
  timeoutMs: z.number().int().min(100).max(86_400_000).default(300_000),
  externalRef: z.string().optional(),
}).strict();

export const workflowDefinitionSchema = z.object({
  skillId: z.string().min(1),
  skillVersion: z.string().min(1),
  input: z.record(z.unknown()).default({}),
  steps: z.array(workflowStepDefinitionSchema).min(1),
}).strict();

export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;
export type WorkflowStepStatus = z.infer<typeof workflowStepStatusSchema>;
export type WorkflowStepDefinition = z.infer<typeof workflowStepDefinitionSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
