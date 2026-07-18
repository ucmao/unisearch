import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { getDatabasePath } from '../../database/connection';
import type { ResearchPlan } from './AgentRepository';

export interface ModelProfile {
  provider: 'minimax' | 'deepseek' | 'custom';
  baseUrl: string;
  model: string;
  apiKey?: string;
  temperature: number;
  timeoutMs: number;
}

const defaults: ModelProfile = {
  provider: 'minimax',
  baseUrl: 'https://api.minimax.io/v1',
  model: 'MiniMax-M2.7',
  temperature: 0.2,
  timeoutMs: 120000,
};

export class ModelService {
  private apiKeyMemory = '';
  private get configPath() { return path.join(path.dirname(getDatabasePath()), 'model-profile.json'); }

  private readRaw(): any {
    try { return JSON.parse(fs.readFileSync(this.configPath, 'utf8')); } catch { return {}; }
  }

  private decrypt(value?: string): string {
    if (!value) return this.apiKeyMemory;
    try {
      const { safeStorage } = require('electron');
      if (safeStorage?.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(value, 'base64'));
    } catch {}
    return this.apiKeyMemory;
  }

  private encrypt(value: string): string | undefined {
    try {
      const { safeStorage } = require('electron');
      if (safeStorage?.isEncryptionAvailable()) return safeStorage.encryptString(value).toString('base64');
    } catch {}
    return undefined;
  }

  getProfile(includeSecret = false): ModelProfile & { apiKeyConfigured: boolean } {
    const raw = this.readRaw();
    const apiKey = this.decrypt(raw.apiKeyEncrypted);
    const profile = { ...defaults, ...raw };
    delete profile.apiKeyEncrypted;
    return { ...profile, ...(includeSecret ? { apiKey } : {}), apiKeyConfigured: Boolean(apiKey) };
  }

  saveProfile(input: Partial<ModelProfile>) {
    const previous = this.readRaw();
    const next: any = {
      provider: input.provider || previous.provider || defaults.provider,
      baseUrl: String(input.baseUrl || previous.baseUrl || defaults.baseUrl).replace(/\/$/, ''),
      model: input.model || previous.model || defaults.model,
      temperature: Number.isFinite(input.temperature) ? input.temperature : (previous.temperature ?? defaults.temperature),
      timeoutMs: Number.isFinite(input.timeoutMs) ? input.timeoutMs : (previous.timeoutMs ?? defaults.timeoutMs),
      apiKeyEncrypted: previous.apiKeyEncrypted,
    };
    if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
      this.apiKeyMemory = input.apiKey.trim();
      next.apiKeyEncrypted = this.encrypt(this.apiKeyMemory);
    }
    fs.writeFileSync(this.configPath, JSON.stringify(next, null, 2), { mode: 0o600 });
    return this.getProfile(false);
  }

  private async chat(messages: any[], maxTokens = 3000): Promise<string> {
    const profile = this.getProfile(true);
    if (!profile.apiKey) throw new Error('请先配置模型 API Key');
    const response = await axios.post(`${profile.baseUrl}/chat/completions`, {
      model: profile.model,
      messages,
      temperature: profile.temperature,
      max_tokens: maxTokens,
      stream: false,
    }, {
      timeout: profile.timeoutMs,
      headers: { Authorization: `Bearer ${profile.apiKey}`, 'Content-Type': 'application/json' },
    });
    const content = response.data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map((part: any) => part.text || '').join('');
    throw new Error('模型没有返回文本内容');
  }

  async test() {
    const started = Date.now();
    const content = await this.chat([{ role: 'user', content: '只回复：连接成功' }], 32);
    return { success: true, message: content.trim(), latency_ms: Date.now() - started };
  }

  async createPlan(userText: string): Promise<ResearchPlan> {
    const platformHelp = '支持的平台代码：xhs=小红书，dy=抖音，ks=快手，bili=哔哩哔哩，wb=微博，tieba=百度贴吧，zhihu=知乎。';
    const content = await this.chat([
      { role: 'system', content: `你是UniSearch本地情报任务规划器。${platformHelp} 根据用户目标生成可执行计划。只输出JSON，不要Markdown。字段必须为 goal:string, platforms:string[], keywords:string[], collectComments:boolean, collectSubComments:boolean, startPage:number, loginType:"qrcode"|"cookie", headless:boolean, analysis:string[], outputs:string[]。platforms只能使用给定代码，至少一个；keywords为简短搜索词，至少一个；默认二维码登录、显示浏览器、从第1页开始。` },
      { role: 'user', content: userText },
    ]);
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('模型返回的计划不是有效 JSON');
    return JSON.parse(match[0]);
  }

  async analyze(goal: string, question: string, rows: any[]): Promise<string> {
    const payload = JSON.stringify(rows);
    return this.chat([
      { role: 'system', content: '你是企业情报分析师。只能依据给定采集数据回答；数据不足时明确说明。结论要简洁、分点，并在关键结论后引用对应的原始链接。不得虚构数字或来源。' },
      { role: 'user', content: `原任务目标：${goal}\n当前问题：${question}\n采集数据（按互动量排序，可能是抽样）：\n${payload}` },
    ], 4000);
  }
}

export const modelService = new ModelService();
