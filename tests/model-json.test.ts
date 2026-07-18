import assert from 'node:assert/strict';
import test from 'node:test';
import { parseModelJson, stripModelReasoning } from '../src/server/services/ModelService';

test('removes model reasoning from visible replies', () => {
  assert.equal(stripModelReasoning('<think>只需回复连接成功</think>\n连接成功'), '连接成功');
});

test('parses JSON after hidden reasoning or markdown fences', () => {
  assert.deepEqual(parseModelJson('<think>先分析一下</think>\n```json\n{"action":"chat","reply":"你好"}\n```'), {
    action: 'chat',
    reply: '你好',
  });
});

test('parses the first balanced JSON object without greedy matching', () => {
  assert.deepEqual(parseModelJson('说明文字 {"reply":"带有 } 字符","plan":{"goal":"测试"}} 尾部'), {
    reply: '带有 } 字符',
    plan: { goal: '测试' },
  });
});
