import { crawlerManager } from './CrawlerManager';
import { agentRepository, type ResearchPlan } from './AgentRepository';
import { modelService } from './ModelService';

const SUPPORTED = ['xhs', 'dy', 'ks', 'bili', 'wb', 'tieba', 'zhihu'];
const LABELS: Record<string, string> = { xhs: '小红书', dy: '抖音', ks: '快手', bili: '哔哩哔哩', wb: '微博', tieba: '百度贴吧', zhihu: '知乎' };

function normalizePlan(input: any, userText: string): ResearchPlan {
  const platformAliases: Record<string, string> = { 小红书: 'xhs', 抖音: 'dy', 快手: 'ks', B站: 'bili', 哔哩哔哩: 'bili', 微博: 'wb', 百度贴吧: 'tieba', 贴吧: 'tieba', 知乎: 'zhihu' };
  const platforms = Array.from(new Set((Array.isArray(input?.platforms) ? input.platforms : [])
    .map((p: any) => platformAliases[String(p)] || String(p))
    .filter((p: string) => SUPPORTED.includes(p)))) as string[];
  const keywords = Array.from(new Set((Array.isArray(input?.keywords) ? input.keywords : []).map((v: any) => String(v).trim()).filter(Boolean))).slice(0, 12) as string[];
  return {
    goal: String(input?.goal || userText).slice(0, 300),
    platforms: platforms.length ? platforms : ['xhs', 'bili'],
    keywords: keywords.length ? keywords : [userText.replace(/[，。！？\n]/g, ' ').trim().slice(0, 40)],
    collectComments: input?.collectComments !== false,
    collectSubComments: Boolean(input?.collectSubComments),
    startPage: Math.max(1, Math.min(20, Number(input?.startPage) || 1)),
    loginType: 'qrcode',
    headless: Boolean(input?.headless),
    analysis: Array.isArray(input?.analysis) ? input.analysis.map(String).slice(0, 8) : ['内容摘要', '用户观点与情感', '关键发现'],
    outputs: Array.isArray(input?.outputs) ? input.outputs.map(String).slice(0, 5) : ['xlsx', 'markdown'],
  };
}

function fallbackPlan(text: string): ResearchPlan {
  const aliases: [RegExp, string][] = [[/小红书/i, 'xhs'], [/抖音/i, 'dy'], [/快手/i, 'ks'], [/(B站|哔哩)/i, 'bili'], [/微博/i, 'wb'], [/贴吧/i, 'tieba'], [/知乎/i, 'zhihu']];
  const platforms = aliases.filter(([pattern]) => pattern.test(text)).map(([, code]) => code);
  const quoted = Array.from(text.matchAll(/[“"']([^”"']{1,30})[”"']/g)).map((m) => m[1]);
  const aboutMatch = text.match(/关于\s*([^的，。；;\n]{1,30})/);
  const keywordMatch = text.match(/关键词[:：]\s*([^，。；;\n]{1,50})/);
  return normalizePlan({
    goal: text,
    platforms,
    keywords: quoted.length ? quoted : keywordMatch ? keywordMatch[1].split(/[、,，和与]/) : aboutMatch ? [aboutMatch[1].trim()] : [],
    collectComments: /评论|评价|口碑|舆情|投诉|反馈/.test(text),
    collectSubComments: /二级|回复/.test(text),
    analysis: ['内容摘要', /负面|投诉|舆情/.test(text) ? '负面主题与风险' : '用户观点与情感', '跨平台对比'],
    outputs: ['xlsx', 'markdown'],
  }, text);
}

function isAnalysisIntent(text: string) {
  return /分析|总结|结论|对比|洞察|报告|原因|评价如何|怎么看/.test(text);
}

export class AgentService {
  private timer: NodeJS.Timeout;
  constructor() {
    this.timer = setInterval(() => this.tick().catch((error) => console.error('[AgentService]', error)), 1500);
    this.timer.unref();
  }

  async sendMessage(threadId: string, content: string) {
    const thread = agentRepository.getThread(threadId);
    if (!thread) throw new Error('任务不存在');
    agentRepository.addMessage(threadId, 'user', 'text', content);
    if (thread.messages.filter((m: any) => m.role === 'user').length === 0) {
      agentRepository.touchThread(threadId, content.slice(0, 24));
    }

    const latest = agentRepository.getLatestPlan(threadId);
    if (latest && ['completed', 'partially_completed'].includes(latest.status) && isAnalysisIntent(content)) {
      const rows = agentRepository.getPlanContents(latest.plan_id);
      if (!rows.length) {
        agentRepository.addMessage(threadId, 'assistant', 'analysis', '当前任务没有可分析的数据。可以先检查采集结果，或重试失败的平台。');
      } else {
        try {
          const answer = await modelService.analyze(latest.goal, content, rows);
          agentRepository.addMessage(threadId, 'assistant', 'analysis', answer, { sampled_records: rows.length });
        } catch (error: any) {
          const summary = this.localSummary(rows);
          agentRepository.addMessage(threadId, 'assistant', 'analysis', `模型分析暂不可用：${error.message}\n\n${summary}`, { fallback: true });
        }
      }
      return agentRepository.getThread(threadId);
    }

    let plan: ResearchPlan;
    let fallback = false;
    try { plan = normalizePlan(await modelService.createPlan(content), content); }
    catch { plan = fallbackPlan(content); fallback = true; }
    const created = agentRepository.createPlan(threadId, plan);
    const platformNames = plan.platforms.map((p) => LABELS[p]).join('、');
    agentRepository.addMessage(threadId, 'assistant', 'plan', `${fallback ? '尚未连接模型，已用本地规则生成计划。' : '我已根据你的目标生成采集计划。'}\n将从 ${platformNames} 搜索 ${plan.keywords.join('、')}。确认后开始执行。`, { plan_id: created.plan_id, fallback });
    return agentRepository.getThread(threadId);
  }

  executePlan(planId: string) {
    const plan = agentRepository.getPlan(planId);
    if (!plan) throw new Error('计划不存在');
    if (!['awaiting_confirmation', 'failed', 'partially_completed'].includes(plan.status)) throw new Error('当前计划不能执行');
    for (const step of plan.steps) {
      if (['failed', 'stopped'].includes(step.status)) agentRepository.updateStep(step.step_id, 'queued', null, null);
    }
    agentRepository.updatePlanStatus(planId, 'queued');
    void this.tick();
    return agentRepository.getPlan(planId);
  }

  async tick() {
    for (const plan of agentRepository.listActivePlans()) await this.tickPlan(plan);
  }

  private async tickPlan(plan: any) {
    let running = 0;
    for (const step of plan.steps) {
      if (step.status !== 'running') continue;
      const state = crawlerManager.getStatus(step.platform);
      if (state.status === 'running' || state.status === 'stopping') { running++; continue; }
      const run = step.run_id ? agentRepository.getCrawlRun(step.run_id) : null;
      if (run?.status === 'completed') agentRepository.updateStep(step.step_id, 'completed', step.run_id, null);
      else agentRepository.updateStep(step.step_id, run?.status === 'stopped' ? 'stopped' : 'failed', step.run_id, run?.error_message || '采集进程未正常完成');
    }

    const refreshed = agentRepository.getPlan(plan.plan_id);
    running = refreshed.steps.filter((s: any) => s.status === 'running').length;
    for (const step of refreshed.steps.filter((s: any) => s.status === 'queued')) {
      if (running >= 2) break;
      const platformState = crawlerManager.getStatus(step.platform);
      if (platformState.status === 'running' || platformState.status === 'stopping') continue;
      const p = refreshed.plan as ResearchPlan;
      const ok = await crawlerManager.start({
        platform: step.platform, login_type: p.loginType, crawler_type: 'search', keywords: p.keywords.join(','),
        start_page: p.startPage, enable_comments: p.collectComments, enable_sub_comments: p.collectSubComments,
        cookies: '', headless: p.headless, loop_execution: false,
      });
      if (ok) {
        const state = crawlerManager.getStatus(step.platform);
        agentRepository.updateStep(step.step_id, 'running', state.run_id, null);
        running++;
      }
    }

    const final = agentRepository.getPlan(plan.plan_id);
    const statuses = final.steps.map((s: any) => s.status);
    if (statuses.some((s: string) => ['running', 'queued'].includes(s))) {
      if (final.status !== 'running') agentRepository.updatePlanStatus(final.plan_id, 'running');
      return;
    }
    const completed = statuses.filter((s: string) => s === 'completed').length;
    const status = completed === statuses.length ? 'completed' : completed ? 'partially_completed' : 'failed';
    if (final.status !== status) {
      agentRepository.updatePlanStatus(final.plan_id, status);
      const text = status === 'completed'
        ? `采集完成，${completed} 个平台均已成功。你可以继续问我“分析这些结果”，或前往结果看板查看和导出。`
        : `采集已结束：${completed} 个平台成功，${statuses.length - completed} 个平台失败或停止。成功数据仍可分析，也可以重试失败步骤。`;
      agentRepository.addMessage(final.thread_id, 'assistant', 'status', text, { plan_id: final.plan_id, status });
    }
  }

  private localSummary(rows: any[]) {
    const byPlatform: Record<string, number> = {};
    let likes = 0, comments = 0;
    for (const row of rows) { byPlatform[row.platform_label] = (byPlatform[row.platform_label] || 0) + 1; likes += row.likes || 0; comments += row.comments || 0; }
    return `本地统计（前 ${rows.length} 条高互动内容）：\n- 平台分布：${Object.entries(byPlatform).map(([k, v]) => `${k} ${v}条`).join('，')}\n- 点赞合计：${likes}\n- 评论合计：${comments}\n\n配置可用的模型 API 后，可以继续进行主题、情感和竞品分析。`;
  }
}

export const agentService = new AgentService();
