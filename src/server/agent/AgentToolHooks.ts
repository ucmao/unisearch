import type { AgentTool, AgentToolContext, AgentToolHook } from './AgentToolRegistry';
import { redactSensitiveText } from './AgentToolRegistry';

export class ReadOnlyPolicyHook implements AgentToolHook {
  beforeExecute(tool: AgentTool<unknown, unknown>): void {
    if (!tool.readOnly) throw new Error(`Research Loop 禁止调用非只读工具：${tool.name}`);
  }
}

export class SensitiveDataRedactionHook implements AgentToolHook {
  redactTrace(value: string): string {
    return redactSensitiveText(value);
  }
}

export class ToolAuditHook implements AgentToolHook {
  beforeExecute(tool: AgentTool<unknown, unknown>, _input: unknown, context: AgentToolContext): void {
    context.trace?.record({
      category: 'policy', tool: tool.name, status: 'selected', timestamp: new Date().toISOString(),
      outputSummary: `只读=${tool.readOnly}`,
    });
  }
}

export class RetryPolicyHook implements AgentToolHook {
  retryDelayMs(_tool: AgentTool<unknown, unknown>, error: Error, attempt: number): number | null {
    if (attempt > 1) return null;
    return /timeout|timed out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|429|rate.?limit|网络/i.test(error.message)
      ? 250
      : null;
  }
}
