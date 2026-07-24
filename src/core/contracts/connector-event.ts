import { z } from 'zod';
import { rawItemSchema } from './raw-item';

export const CONNECTOR_EVENT_SCHEMA_VERSION = 1 as const;

const eventBase = {
  schemaVersion: z.literal(CONNECTOR_EVENT_SCHEMA_VERSION),
  runId: z.string().min(1),
  source: z.string().min(1),
  timestamp: z.string().datetime(),
  sequence: z.number().int().nonnegative(),
};

export const connectorEventSchema = z.discriminatedUnion('type', [
  z.object({ ...eventBase, type: z.literal('ready') }),
  z.object({ ...eventBase, type: z.literal('started') }),
  z.object({ ...eventBase, type: z.literal('item'), item: rawItemSchema }),
  z.object({
    ...eventBase,
    type: z.literal('progress'),
    current: z.number().int().nonnegative(),
    total: z.number().int().nonnegative().optional(),
    message: z.string().optional(),
  }),
  z.object({
    ...eventBase,
    type: z.literal('warning'),
    code: z.string().min(1),
    message: z.string().min(1),
  }),
  z.object({
    ...eventBase,
    type: z.literal('auth_required'),
    reason: z.string().optional(),
  }),
  z.object({
    ...eventBase,
    type: z.literal('verification_required'),
    reason: z.string().optional(),
  }),
  z.object({
    ...eventBase,
    type: z.literal('completed'),
    itemCount: z.number().int().nonnegative(),
  }),
  z.object({
    ...eventBase,
    type: z.literal('failed'),
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
  z.object({ ...eventBase, type: z.literal('cancelled') }),
]);

export type ConnectorEvent = z.infer<typeof connectorEventSchema>;

export function parseConnectorEvent(value: unknown): ConnectorEvent {
  return connectorEventSchema.parse(value);
}
