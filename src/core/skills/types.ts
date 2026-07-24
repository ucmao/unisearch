import { z } from 'zod';

export const skillDefinitionSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  inputs: z.array(z.object({
    key: z.string().min(1),
    required: z.boolean().default(false),
    description: z.string().default(''),
  }).strict()),
  workflow: z.object({
    connectorCapabilities: z.array(z.string()).default([]),
    itemProcessors: z.array(z.string()).default([]),
    analyzers: z.array(z.string()).default([]),
    exporters: z.array(z.string()).default([]),
    outputs: z.array(z.string()).default([]),
  }).strict(),
}).strict();

export type SkillDefinition = z.infer<typeof skillDefinitionSchema>;
