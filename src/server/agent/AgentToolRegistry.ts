import { randomUUID } from 'crypto';
import { z } from 'zod';

export interface AgentToolContext {
  threadId: string;
  signal?: AbortSignal;
}

export interface AgentTool<TInput, TOutput> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  readOnly: boolean;
  execute(input: TInput, context: AgentToolContext): Promise<TOutput>;
  summarizeInput?(input: TInput): string;
  summarizeOutput?(output: TOutput): string;
}

export interface AgentToolTraceEvent {
  tool: string;
  status: 'started' | 'completed' | 'failed';
  timestamp: string;
  durationMs?: number;
  inputSummary?: string;
  outputSummary?: string;
  error?: string;
}

export class AgentRunTrace {
  readonly runId = randomUUID();
  readonly startedAt = new Date().toISOString();
  private readonly events: AgentToolTraceEvent[] = [];

  constructor(readonly threadId: string) {}

  record(event: AgentToolTraceEvent): void {
    this.events.push(event);
  }

  snapshot() {
    return {
      run_id: this.runId,
      started_at: this.startedAt,
      events: this.events.map((event) => ({ ...event })),
    };
  }
}

export interface AgentToolHook {
  beforeExecute?(tool: AgentTool<unknown, unknown>, input: unknown, context: AgentToolContext): Promise<void> | void;
  afterExecute?(tool: AgentTool<unknown, unknown>, output: unknown, context: AgentToolContext): Promise<void> | void;
  onError?(tool: AgentTool<unknown, unknown>, error: Error, context: AgentToolContext): Promise<void> | void;
}

export class AgentToolRegistry {
  private readonly tools = new Map<string, AgentTool<unknown, unknown>>();

  register<TInput, TOutput>(tool: AgentTool<TInput, TOutput>): void {
    if (this.tools.has(tool.name)) throw new Error(`Agent tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool as AgentTool<unknown, unknown>);
  }

  get<TInput, TOutput>(name: string): AgentTool<TInput, TOutput> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown agent tool: ${name}`);
    return tool as AgentTool<TInput, TOutput>;
  }

  list(): Array<Pick<AgentTool<unknown, unknown>, 'name' | 'description' | 'readOnly'>> {
    return [...this.tools.values()].map(({ name, description, readOnly }) => ({ name, description, readOnly }));
  }
}

export class AgentToolExecutor {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly hooks: AgentToolHook[] = [],
  ) {}

  async execute<TInput, TOutput>(
    name: string,
    rawInput: unknown,
    context: AgentToolContext,
    trace?: AgentRunTrace,
  ): Promise<TOutput> {
    const tool = this.registry.get<TInput, TOutput>(name);
    const input = tool.inputSchema.parse(rawInput);
    const started = Date.now();
    const inputSummary = tool.summarizeInput?.(input) || '输入已通过 Schema 校验';
    trace?.record({ tool: name, status: 'started', timestamp: new Date().toISOString(), inputSummary });
    try {
      for (const hook of this.hooks) await hook.beforeExecute?.(tool as AgentTool<unknown, unknown>, input, context);
      context.signal?.throwIfAborted();
      const output = await tool.execute(input, context);
      context.signal?.throwIfAborted();
      for (const hook of this.hooks) await hook.afterExecute?.(tool as AgentTool<unknown, unknown>, output, context);
      trace?.record({
        tool: name,
        status: 'completed',
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - started,
        outputSummary: tool.summarizeOutput?.(output) || '工具执行完成',
      });
      return output;
    } catch (value: unknown) {
      const error = value instanceof Error ? value : new Error(String(value));
      for (const hook of this.hooks) await hook.onError?.(tool as AgentTool<unknown, unknown>, error, context);
      trace?.record({
        tool: name,
        status: 'failed',
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - started,
        error: error.message.slice(0, 300),
      });
      throw error;
    }
  }
}
