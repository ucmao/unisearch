import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { z } from 'zod';
import type { ContextBudgetReport } from './ContextBudgetManager';

export interface AgentToolContext {
  threadId: string;
  signal?: AbortSignal;
  trace?: AgentRunTrace;
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
  category?: 'tool' | 'route' | 'model' | 'loop' | 'policy';
  tool: string;
  status: 'started' | 'completed' | 'failed' | 'selected' | 'stopped';
  timestamp: string;
  durationMs?: number;
  inputSummary?: string;
  outputSummary?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

const SECRET_PATTERNS = [
  /\b(?:sk|ak)-[A-Za-z0-9_-]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}\b/gi,
  /([?&](?:token|api_?key|auth|password|session)=)[^&#\s]+/gi,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /\b1[3-9]\d{9}\b/g,
];

export function redactSensitiveText(value: string): string {
  return SECRET_PATTERNS.reduce((text, pattern, index) => (
    index === 2 ? text.replace(pattern, '$1[已脱敏]') : text.replace(pattern, '[已脱敏]')
  ), value);
}

export class AgentRunTrace {
  readonly runId = randomUUID();
  readonly startedAt = new Date().toISOString();
  private readonly events: AgentToolTraceEvent[] = [];
  private route: { action: string; source: string } | null = null;
  private stopReason = '';

  constructor(readonly threadId: string) {}

  record(event: AgentToolTraceEvent): void {
    this.events.push({
      ...event,
      inputSummary: event.inputSummary ? redactSensitiveText(event.inputSummary) : undefined,
      outputSummary: event.outputSummary ? redactSensitiveText(event.outputSummary) : undefined,
      error: event.error ? redactSensitiveText(event.error) : undefined,
    });
  }

  recordRoute(action: string, source: string): void {
    this.route = { action, source };
    this.record({
      category: 'route', tool: 'router', status: 'selected', timestamp: new Date().toISOString(),
      outputSummary: `${source}:${action}`,
    });
  }

  recordContextBudget(report: ContextBudgetReport): void {
    this.record({
      category: 'model', tool: 'context_budget', status: 'completed', timestamp: new Date().toISOString(),
      outputSummary: report.compacted ? '上下文已压缩' : '上下文无需压缩',
      metadata: { ...report },
    });
  }

  recordModelCall(input: { durationMs: number; success: boolean; inputTokens: number; outputTokens?: number; error?: string }): void {
    this.record({
      category: 'model', tool: 'model', status: input.success ? 'completed' : 'failed', timestamp: new Date().toISOString(),
      durationMs: input.durationMs,
      outputSummary: input.success ? `模型返回约 ${input.outputTokens || 0} tokens` : undefined,
      error: input.error,
      metadata: { estimated_input_tokens: input.inputTokens, estimated_output_tokens: input.outputTokens || 0 },
    });
  }

  recordLoopStep(step: number, action: string, reason: string, newEvidence: number): void {
    this.record({
      category: 'loop', tool: action, status: 'completed', timestamp: new Date().toISOString(),
      inputSummary: `第 ${step} 步：${reason}`,
      outputSummary: `新增证据 ${newEvidence} 条`,
      metadata: { step, new_evidence: newEvidence },
    });
  }

  finish(reason: string): void {
    if (this.stopReason) return;
    this.stopReason = reason;
    this.record({
      category: 'loop', tool: 'finish', status: 'stopped', timestamp: new Date().toISOString(), outputSummary: reason,
    });
  }

  snapshot() {
    const finishedAt = new Date().toISOString();
    const toolEvents = this.events.filter((event) => (event.category || 'tool') === 'tool');
    const modelEvents = this.events.filter((event) => event.category === 'model' && event.tool === 'model');
    const contextEvents = this.events.filter((event) => event.tool === 'context_budget');
    return {
      run_id: this.runId,
      started_at: this.startedAt,
      finished_at: finishedAt,
      duration_ms: Math.max(0, Date.parse(finishedAt) - Date.parse(this.startedAt)),
      route: this.route,
      stop_reason: this.stopReason || undefined,
      metrics: {
        tool_calls: toolEvents.filter((event) => event.status === 'completed' || event.status === 'failed').length,
        model_calls: modelEvents.length,
        loop_steps: this.events.filter((event) => event.category === 'loop' && event.tool !== 'finish').length,
        context_compactions: contextEvents.filter((event) => Boolean(event.metadata?.compacted)).length,
        estimated_input_tokens: contextEvents.reduce((total, event) => total + Number(event.metadata?.estimatedInputTokensAfter || 0), 0),
      },
      events: this.events.map((event) => ({ ...event })),
    };
  }
}

const traceStorage = new AsyncLocalStorage<AgentRunTrace>();

export function runWithAgentTrace<T>(trace: AgentRunTrace, operation: () => Promise<T>): Promise<T> {
  return traceStorage.run(trace, operation);
}

export function currentAgentRunTrace(): AgentRunTrace | undefined {
  return traceStorage.getStore();
}

export interface AgentToolHook {
  beforeExecute?(tool: AgentTool<unknown, unknown>, input: unknown, context: AgentToolContext): Promise<void> | void;
  afterExecute?(tool: AgentTool<unknown, unknown>, output: unknown, context: AgentToolContext): Promise<void> | void;
  onError?(tool: AgentTool<unknown, unknown>, error: Error, context: AgentToolContext): Promise<void> | void;
  retryDelayMs?(tool: AgentTool<unknown, unknown>, error: Error, attempt: number, context: AgentToolContext): number | null;
  redactTrace?(value: string): string;
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
    const activeContext = { ...context, trace };
    const redact = (value: string) => this.hooks.reduce((text, hook) => hook.redactTrace?.(text) || text, redactSensitiveText(value));
    const inputSummary = redact(tool.summarizeInput?.(input) || '输入已通过 Schema 校验');
    trace?.record({ tool: name, status: 'started', timestamp: new Date().toISOString(), inputSummary });
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        for (const hook of this.hooks) await hook.beforeExecute?.(tool as AgentTool<unknown, unknown>, input, activeContext);
        activeContext.signal?.throwIfAborted();
        const output = await tool.execute(input, activeContext);
        activeContext.signal?.throwIfAborted();
        for (const hook of this.hooks) await hook.afterExecute?.(tool as AgentTool<unknown, unknown>, output, activeContext);
        trace?.record({
          tool: name,
          status: 'completed',
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - started,
          outputSummary: redact(tool.summarizeOutput?.(output) || '工具执行完成'),
          metadata: { attempts: attempt },
        });
        return output;
      } catch (value: unknown) {
        const error = value instanceof Error ? value : new Error(String(value));
        for (const hook of this.hooks) await hook.onError?.(tool as AgentTool<unknown, unknown>, error, activeContext);
        const delays = this.hooks
          .map((hook) => hook.retryDelayMs?.(tool as AgentTool<unknown, unknown>, error, attempt, activeContext))
          .filter((delay): delay is number => typeof delay === 'number' && delay >= 0);
        if (attempt < 2 && delays.length) {
          await new Promise((resolve) => setTimeout(resolve, Math.max(...delays)));
          continue;
        }
        trace?.record({
          tool: name,
          status: 'failed',
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - started,
          error: redact(error.message.slice(0, 300)),
          metadata: { attempts: attempt },
        });
        throw error;
      }
    }
    throw new Error('工具执行失败');
  }
}
