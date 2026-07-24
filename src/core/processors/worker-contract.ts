import { z } from 'zod';
import { documentSchema, artifactSchema } from '../documents/types';

export const processorWorkerRequestSchema = z.object({
  schemaVersion: z.literal(1),
  jobId: z.string().min(1),
  processorIds: z.array(z.string().min(1)).min(1),
  documents: z.array(documentSchema).min(1).max(25),
  runId: z.string().optional(),
}).strict();

export const processorWorkerResultSchema = z.object({
  schemaVersion: z.literal(1),
  jobId: z.string().min(1),
  documents: z.array(documentSchema),
  artifacts: z.array(artifactSchema),
}).strict();

export type ProcessorWorkerRequest = z.infer<typeof processorWorkerRequestSchema>;
export type ProcessorWorkerResult = z.infer<typeof processorWorkerResultSchema>;

