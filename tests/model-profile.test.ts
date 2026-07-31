import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import axios from 'axios';
import { buildRecentTurnContext, isRetryableModelError, ModelService } from '../src/server/services/ModelService';

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
          model: 'MiniMax-M3',
          temperature: 0.2,
          timeoutMs: 120000,
          apiKeyEncrypted: 'encrypted-key',
        },
        deepseek: { baseUrl: 'https://api.deepseek.com', model: 'DeepSeek-V4-Flash', temperature: 0.2, timeoutMs: 120000 },
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
      memories: [{ category: 'rule', content: '用户保存的长期偏好', source: 'manual' }],
    });

    const memoryPrompt = String(capturedMessages.find((message) =>
      message.role === 'system' && String(message.content).includes('<user_memories_json>'),
    )?.content || '');
    assert.match(memoryPrompt, /用户手动保存，应优先采用/);
    assert.match(memoryPrompt, /用户保存的长期偏好/);
    assert.match(memoryPrompt, /"source":"manual"/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('automatic memory consolidation returns one validated summary per category', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unisearch-model-consolidation-'));
  const configPath = path.join(directory, 'model-profile.json');

  try {
    const service = new ModelService(configPath);
    let capturedInput = '';
    (service as any).chat = async (messages: Array<{ role: string; content: unknown }>) => {
      capturedInput = String(messages.at(-1)?.content || '');
      return JSON.stringify({ summaries: [
        { category: 'identity', content: '用户是产品经理' },
        { category: 'preference', content: '用户偏好简洁回答' },
        { category: 'context', content: '' },
        { category: 'rule', content: '' },
      ] });
    };

    const summaries = await service.consolidateMemories(
      [{ messageId: 'message-1', content: '我现在负责产品工作' }],
      [{ category: 'identity', content: '用户从事互联网行业' }],
      ['请使用简体中文'],
    );

    assert.equal(summaries?.length, 4);
    assert.equal(summaries?.find((summary) => summary.category === 'identity')?.content, '用户是产品经理');
    assert.match(capturedInput, /existing_summaries_json/);
    assert.match(capturedInput, /manual_memories_json/);

    (service as any).chat = async () => JSON.stringify({ summaries: [
      { category: 'identity', content: '缺少其他类别' },
    ] });
    assert.equal(await service.consolidateMemories([{ messageId: '2', content: '测试' }], [], []), null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
