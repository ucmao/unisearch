import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import axios from 'axios';
import { buildRecentTurnContext, isRetryableModelError, ModelService } from '../src/server/services/ModelService';
import { AgentRunTrace, runWithAgentTrace } from '../src/server/agent/AgentToolRegistry';

test('recent turn context gives current user priority while preserving follow-up references', () => {
  const context = buildRecentTurnContext([
    { role: 'user', content: '我周末想在福州找点吃的和玩的' },
    { role: 'assistant', content: '可以帮你搜索福州好吃的，也可以看看好玩的。' },
    { role: 'user', content: '有啥吃的呢' },
  ]);

  assert.match(context, /当前用户消息（最高优先级[^）]*）[\s\S]*有啥吃的呢/);
  assert.match(context, /上一轮用户消息[\s\S]*我周末想在福州找点吃的和玩的/);
  assert.match(context, /上一轮助手回复[\s\S]*好吃的/);
  assert.match(context, /只有用户本轮明确选择后才算用户意图/);
  assert.match(context, /真实任务状态以 current_plan_data 或后端数据为准/);
});

test('model retries only transient failures', () => {
  for (const status of [408, 425, 429, 500, 502, 503]) {
    assert.equal(isRetryableModelError({ response: { status } }), true, `${status} should retry`);
  }
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(isRetryableModelError({ response: { status } }), false, `${status} should stop immediately`);
  }
  assert.equal(isRetryableModelError({ code: 'ETIMEDOUT' }), true);
  assert.equal(isRetryableModelError({ code: 'ENOTFOUND' }), true);
});

test('model providers keep isolated credentials and clearing one key does not affect another', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unisearch-model-profile-'));
  const configPath = path.join(directory, 'model-profile.json');

  try {
    const service = new ModelService(configPath);
    assert.equal(service.getProfile(false).provider, 'minimax');
    assert.equal(service.getProfile(false).apiKeyConfigured, false);

    service.saveProfile({ provider: 'minimax', apiKey: 'minimax-secret' });
    service.saveProfile({ provider: 'deepseek' });

    let profiles = service.getProfiles();
    assert.equal(profiles.activeProvider, 'deepseek');
    assert.equal(profiles.profiles.find((profile) => profile.provider === 'minimax')?.apiKeyConfigured, true);
    assert.equal(profiles.profiles.find((profile) => profile.provider === 'deepseek')?.apiKeyConfigured, false);

    service.saveProfile({ provider: 'deepseek', apiKey: 'deepseek-secret' });
    service.saveProfile({ provider: 'deepseek', clearApiKey: true });

    profiles = service.getProfiles();
    assert.equal(profiles.profiles.find((profile) => profile.provider === 'minimax')?.apiKeyConfigured, true);
    assert.equal(profiles.profiles.find((profile) => profile.provider === 'deepseek')?.apiKeyConfigured, false);

    const stored = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(stored.version, 2);
    assert.equal(stored.activeProvider, 'deepseek');
    assert.equal('apiKeyEncrypted' in stored, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy single-profile files are ignored instead of migrated', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unisearch-model-profile-'));
  const configPath = path.join(directory, 'model-profile.json');

  try {
    fs.writeFileSync(configPath, JSON.stringify({
      provider: 'deepseek',
      baseUrl: 'https://legacy.example.com',
      model: 'legacy-model',
      apiKeyEncrypted: 'legacy-key',
    }));

    const service = new ModelService(configPath);
    const profiles = service.getProfiles();
    assert.equal(profiles.activeProvider, 'minimax');
    assert.equal(profiles.profiles.every((profile) => !profile.apiKeyConfigured), true);
    assert.equal(profiles.profiles.find((profile) => profile.provider === 'deepseek')?.baseUrl, 'https://api.deepseek.com');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('public model profile checks do not decrypt the stored API key', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unisearch-model-profile-'));
  const configPath = path.join(directory, 'model-profile.json');

  try {
    fs.writeFileSync(configPath, JSON.stringify({
      version: 2,
      activeProvider: 'minimax',
      profiles: {
        minimax: {
          baseUrl: 'https://api.minimaxi.com/v1',
          model: 'MiniMax-M2.7-highspeed',
          temperature: 0.2,
          timeoutMs: 120000,
          apiKeyEncrypted: 'encrypted-key',
        },
        deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', temperature: 0.2, timeoutMs: 120000 },
        custom: { baseUrl: '', model: '', temperature: 0.2, timeoutMs: 120000 },
      },
    }));
    const service = new ModelService(configPath);
    (service as any).decrypt = () => { throw new Error('不应读取钥匙串'); };

    assert.equal(service.getProfile(false).apiKeyConfigured, true);
    assert.equal(service.getProfiles().profiles[0].apiKeyConfigured, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('model conversation respects an aborted request signal', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unisearch-model-abort-'));
  const configPath = path.join(directory, 'model-profile.json');

  try {
    const service = new ModelService(configPath);
    service.saveProfile({
      provider: 'custom',
      baseUrl: 'https://example.invalid',
      model: 'test-model',
      apiKey: 'test-secret',
    });
    const controller = new AbortController();
    controller.abort(new DOMException('用户已停止生成', 'AbortError'));

    await assert.rejects(
      service.converse([{ role: 'user', content: '测试停止' }], { signal: controller.signal }),
      (error: any) => error?.name === 'AbortError',
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('model conversation streams visible deltas and hides reasoning blocks', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unisearch-model-stream-'));
  const configPath = path.join(directory, 'model-profile.json');
  const originalPost = axios.post;

  try {
    const service = new ModelService(configPath);
    service.saveProfile({ provider: 'custom', baseUrl: 'https://stream.example', model: 'stream-model', apiKey: 'secret' });
    let requestedStream = false;
    (axios as any).post = async (_url: string, body: any) => {
      requestedStream = body.stream;
      return {
        data: (async function* () {
          yield Buffer.from('data: {"choices":[{"delta":{"content":"<think>内部"}}]}\n\n');
          yield Buffer.from('data: {"choices":[{"delta":{"content":"推理</think>你"}}]}\n\n');
          yield Buffer.from('data: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n');
        })(),
      };
    };
    const deltas: string[] = [];
    const answer = await service.converse([{ role: 'user', content: '打招呼' }], {
      onDelta: (delta) => deltas.push(delta),
    });

    assert.equal(requestedStream, true);
    assert.equal(answer, '你好');
    assert.equal(deltas.join(''), '你好');
  } finally {
    (axios as any).post = originalPost;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('model calls automatically contribute timing and context metrics to the active run trace', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unisearch-model-trace-'));
  const configPath = path.join(directory, 'model-profile.json');
  const originalPost = axios.post;
  try {
    const service = new ModelService(configPath);
    service.saveProfile({ provider: 'custom', baseUrl: 'https://trace.example', model: 'trace-model', apiKey: 'secret' });
    (axios as any).post = async () => ({ data: { choices: [{ message: { content: '追踪回答' } }] } });
    const trace = new AgentRunTrace('thread-1');
    await runWithAgentTrace(trace, () => service.converse([{ role: 'user', content: '测试模型轨迹' }]));
    trace.finish('测试完成');
    const snapshot = trace.snapshot();
    assert.equal(snapshot.metrics.model_calls, 1);
    assert.ok(snapshot.metrics.estimated_input_tokens > 0);
    assert.equal(snapshot.events.some((event) => event.tool === 'context_budget'), true);
  } finally {
    (axios as any).post = originalPost;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('thread title generation gives reasoning models enough output space and uses a short retry policy', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unisearch-model-title-'));
  const configPath = path.join(directory, 'model-profile.json');
  const originalPost = axios.post;

  try {
    const service = new ModelService(configPath);
    service.saveProfile({ provider: 'minimax', baseUrl: 'https://title.example', model: 'MiniMax-M2.7-highspeed', apiKey: 'secret' });
    let requestBody: any;
    (axios as any).post = async (_url: string, body: any) => {
      requestBody = body;
      return { data: { choices: [{ message: { content: '巴黎圣母院简介' } }] } };
    };

    const title = await service.generateThreadTitle([{ role: 'user', content: '你知道巴黎圣母院吗' }]);

    assert.equal(title, '巴黎圣母院简介');
    assert.equal(requestBody.max_tokens, 1024);
    assert.equal(requestBody.reasoning_split, true);
  } finally {
    (axios as any).post = originalPost;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('model retry attempts do not exceed the configured total', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unisearch-model-retry-'));
  const configPath = path.join(directory, 'model-profile.json');
  const originalPost = axios.post;

  try {
    const service = new ModelService(configPath);
    service.saveProfile({ provider: 'custom', baseUrl: 'https://retry.example', model: 'retry-model', apiKey: 'secret' });
    let calls = 0;
    (axios as any).post = async () => {
      calls += 1;
      return { data: { choices: [{ message: { content: '' } }] } };
    };

    await assert.rejects(
      (service as any).chat([{ role: 'user', content: '测试' }], 80, false, undefined, undefined, undefined, {
        maxAttempts: 2,
        retryBaseDelayMs: 0,
      }),
      /模型没有返回文本内容/,
    );
    assert.equal(calls, 2);
  } finally {
    (axios as any).post = originalPost;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('model conversation always receives active memories as user context', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unisearch-model-memory-'));
  const configPath = path.join(directory, 'model-profile.json');

  try {
    const service = new ModelService(configPath);
    let capturedMessages: Array<{ role: string; content: unknown }> = [];
    (service as any).chat = async (messages: Array<{ role: string; content: unknown }>) => {
      capturedMessages = messages;
      return 'ok';
    };

    await service.converse([{ role: 'user', content: '普通问题' }], {
      memories: [{ category: 'rule', content: '每次回答都要为科莱特三组加油' }],
    });

    const memoryPrompt = String(capturedMessages.find((message) =>
      message.role === 'system' && String(message.content).includes('用户长期画像与偏好记忆'),
    )?.content || '');
    assert.match(memoryPrompt, /每次回答都要为科莱特三组加油/);
    assert.match(memoryPrompt, /执行规则/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('automatic memory consolidation returns validated profile mutations only', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unisearch-model-consolidation-'));
  const configPath = path.join(directory, 'model-profile.json');

  try {
    const service = new ModelService(configPath);
    let capturedInput = '';
    (service as any).chat = async (messages: Array<{ role: string; content: unknown }>) => {
      capturedInput = String(messages.at(-1)?.content || '');
      return JSON.stringify({ updates: [
        {
          category: 'identity',
          content: '用户叫 Leo，是产品经理',
        },
      ] });
    };

    const result = await service.consolidateMemories(
      [{ content: '我现在负责产品工作' }],
      [{ category: 'identity', content: '用户从事互联网行业' }],
    );

    assert.equal(result?.mutations.length, 1);
    assert.equal(result?.mutations[0].category, 'identity');
    assert.equal(result?.mutations[0].content, '用户叫 Leo，是产品经理');
    assert.match(capturedInput, /existing_profiles/);
    assert.match(capturedInput, /recent_user_messages/);

    (service as any).chat = async () => JSON.stringify({ updates: [{
      category: 'unknown', content: '无效分类',
    }] });
    assert.deepEqual(await service.consolidateMemories([{ content: '测试' }], []), { mutations: [] });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
