import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import {
  AgentRunTrace,
  AgentToolExecutor,
  AgentToolRegistry,
} from '../src/server/agent/AgentToolRegistry';

test('tool executor validates input and records a compact trace', async () => {
  const registry = new AgentToolRegistry();
  let executions = 0;
  registry.register({
    name: 'echo_length',
    description: '测试工具',
    readOnly: true,
    inputSchema: z.object({ value: z.string().min(1) }).strict(),
    async execute(input) {
      executions++;
      return { length: input.value.length, raw: input.value };
    },
    summarizeInput: (input) => `字符数 ${input.value.length}`,
    summarizeOutput: (output) => `返回长度 ${output.length}`,
  });
  const trace = new AgentRunTrace('thread-1');
  const executor = new AgentToolExecutor(registry);
  const output = await executor.execute<{ value: string }, { length: number; raw: string }>(
    'echo_length',
    { value: '敏感正文不应进入轨迹' },
    { threadId: 'thread-1' },
    trace,
  );

  assert.equal(output.length, 10);
  assert.equal(executions, 1);
  const snapshot = trace.snapshot();
  assert.deepEqual(snapshot.events.map((event) => event.status), ['started', 'completed']);
  assert.doesNotMatch(JSON.stringify(snapshot), /敏感正文不应进入轨迹/);

  await assert.rejects(
    () => executor.execute('echo_length', { value: '' }, { threadId: 'thread-1' }),
    /String must contain at least 1 character/,
  );
  assert.equal(executions, 1);
});

test('tool executor runs lifecycle hooks for success and failure', async () => {
  const registry = new AgentToolRegistry();
  registry.register({
    name: 'sometimes_fails',
    description: '测试 Hook',
    readOnly: true,
    inputSchema: z.object({ fail: z.boolean() }).strict(),
    async execute(input) {
      if (input.fail) throw new Error('预期失败');
      return { ok: true };
    },
  });
  const calls: string[] = [];
  const executor = new AgentToolExecutor(registry, [{
    beforeExecute: () => { calls.push('before'); },
    afterExecute: () => { calls.push('after'); },
    onError: () => { calls.push('error'); },
  }]);

  await executor.execute('sometimes_fails', { fail: false }, { threadId: 'thread-1' });
  await assert.rejects(
    () => executor.execute('sometimes_fails', { fail: true }, { threadId: 'thread-1' }),
    /预期失败/,
  );
  assert.deepEqual(calls, ['before', 'after', 'before', 'error']);
});
