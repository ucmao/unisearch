import { crawlerManager } from './CrawlerManager';
import { agentRepository, type ResearchPlan } from './AgentRepository';
import { localIntentDecision, type AgentDecision } from './AgentIntent';
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

function isAnalysisIntent(text: string) {
  return /分析|总结|结论|对比|洞察|报告|原因|评价如何|怎么看/.test(text);
}

function mergePlan(base: ResearchPlan, patch: Partial<ResearchPlan>): ResearchPlan {
  return {
    ...base,
    ...patch,
    platforms: Array.isArray(patch.platforms) ? patch.platforms : base.platforms,
    keywords: Array.isArray(patch.keywords) ? patch.keywords : base.keywords,
    analysis: Array.isArray(patch.analysis) ? patch.analysis : base.analysis,
    outputs: Array.isArray(patch.outputs) ? patch.outputs : base.outputs,
  };
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

    const profile = modelService.getProfile(false);
    if (!profile.apiKeyConfigured || !profile.connectionVerified || profile.lastError) {
      const reason = !profile.apiKeyConfigured
        ? 'AI 模型尚未配置'
        : profile.lastError
          ? `AI 模型连接不可用：${profile.lastError}`
          : 'AI 模型尚未通过连接测试';
      agentRepository.addMessage(threadId, 'assistant', 'status', `${reason}，无法进行思考和对话。请打开“模型设置”并成功测试连接。`, {
        action: 'model_error',
        error: !profile.apiKeyConfigured ? 'unconfigured' : profile.lastError || 'unverified',
      });
      return agentRepository.getThread(threadId);
    }

    const latest = agentRepository.getLatestPlan(threadId);
    const previousMessage = thread.messages.at(-1);
    const lastUserMessage = [...thread.messages].reverse().find((message: any) => message.role === 'user');
    const awaitingClarification = previousMessage?.role === 'assistant' && previousMessage?.kind === 'clarify';
    const previousUserMessage = awaitingClarification
      ? lastUserMessage
      : null;
    const planningText = previousUserMessage ? `${previousUserMessage.content}\n用户补充：${content}` : content;
    const localDecision = localIntentDecision(content, {
      planStatus: latest?.status,
      awaitingClarification,
      previousUserText: lastUserMessage?.content,
    });
    let decision: AgentDecision;

    if (['model_info', 'execute', 'stop', 'status', 'analyze'].includes(localDecision.action)) {
      decision = localDecision;
    } else {
      try {
        const updatedThread = agentRepository.getThread(threadId);
        const messages = updatedThread.messages
          .filter((message: any) => ['user', 'assistant'].includes(message.role))
          .slice(-12)
          .map((message: any) => ({ role: message.role as 'user' | 'assistant', content: String(message.content) }));
        decision = await modelService.decide(messages, latest ? { status: latest.status, plan: latest.plan } : null);
        if (localDecision.action === 'clarify' && ['create_plan', 'revise_plan'].includes(decision.action)) decision = localDecision;
      } catch (error: any) {
        const reason = modelService.getRuntimeStatus().lastError || error.message || '未知错误';
        agentRepository.addMessage(threadId, 'assistant', 'status', `AI 服务连接失败：${reason}\n\n本次没有生成 AI 回复，请到“模型设置”检查配置并测试连接。`, {
          action: 'model_error',
          error: reason,
        });
        return agentRepository.getThread(threadId);
      }
    }

    if (decision.action === 'model_info') {
      const profile = modelService.getProfile(false);
      const runtime = modelService.getRuntimeStatus();
      const providerName = profile.provider === 'custom' ? '自定义兼容接口' : profile.provider === 'minimax' ? 'MiniMax' : 'DeepSeek';
      const health = !profile.apiKeyConfigured
        ? '目前尚未配置 API Key，AI 对话不可用。'
        : runtime.lastError
          ? `不过最近一次模型调用失败：${runtime.lastError}。AI 对话当前不可用，请在“模型设置”中更新配置并测试连接。`
          : 'API Key 已配置；可以在“模型设置”中运行连接测试确认当前是否可用。';
      agentRepository.addMessage(threadId, 'assistant', 'text', `当前配置的是 ${profile.model}（${providerName}）。${health}`, { action: 'model_info' });
      return agentRepository.getThread(threadId);
    }

    if (decision.action === 'chat' || decision.action === 'clarify') {
      const reply = decision.reply.trim();
      if (!reply) {
        agentRepository.addMessage(threadId, 'assistant', 'status', 'AI 模型没有返回有效回复。本次没有生成本地兜底内容，请检查模型配置后重试。', {
          action: 'model_error',
          error: 'empty_response',
        });
        return agentRepository.getThread(threadId);
      }
      agentRepository.addMessage(threadId, 'assistant', decision.action === 'clarify' ? 'clarify' : 'text', reply, {
        action: decision.action,
        missing_fields: decision.missingFields || [],
      });
      return agentRepository.getThread(threadId);
    }

    if (decision.action === 'execute') {
      if (!latest || latest.status !== 'awaiting_confirmation') {
        agentRepository.addMessage(threadId, 'assistant', 'text', '当前没有等待确认的计划。你可以先告诉我想采集的具体主题。', { action: 'chat' });
      } else {
        this.executePlan(latest.plan_id);
        agentRepository.addMessage(threadId, 'assistant', 'status', decision.reply || '好的，任务已进入本地执行队列。', { plan_id: latest.plan_id, action: 'execute' });
      }
      return agentRepository.getThread(threadId);
    }

    if (decision.action === 'stop') {
      if (!latest || !['queued', 'running'].includes(latest.status)) {
        agentRepository.addMessage(threadId, 'assistant', 'text', '当前没有正在执行的采集任务。', { action: 'chat' });
      } else {
        await this.stopPlan(latest);
        agentRepository.addMessage(threadId, 'assistant', 'status', decision.reply || '当前采集任务已停止。', { plan_id: latest.plan_id, action: 'stop' });
      }
      return agentRepository.getThread(threadId);
    }

    if (decision.action === 'status') {
      if (!latest) {
        agentRepository.addMessage(threadId, 'assistant', 'status', '当前还没有采集任务，因此暂时没有已采集的信息。你可以先告诉我想调研的主题。', { action: 'status' });
      } else {
        agentRepository.addMessage(threadId, 'assistant', 'status', this.describePlanStatus(latest), { plan_id: latest.plan_id, action: 'status' });
      }
      return agentRepository.getThread(threadId);
    }

    if (decision.action === 'analyze' || (latest && ['completed', 'partially_completed'].includes(latest.status) && isAnalysisIntent(content))) {
      if (!latest || !['completed', 'partially_completed'].includes(latest.status)) {
        agentRepository.addMessage(threadId, 'assistant', 'text', '当前还没有已完成的采集结果可以分析。', { action: 'chat' });
        return agentRepository.getThread(threadId);
      }
      const rows = agentRepository.getPlanContents(latest.plan_id);
      if (!rows.length) {
        agentRepository.addMessage(threadId, 'assistant', 'analysis', '当前任务没有可分析的数据。可以先检查采集结果，或重试失败的平台。');
      } else {
        try {
          const answer = await modelService.analyze(latest.goal, content, rows);
          agentRepository.addMessage(threadId, 'assistant', 'analysis', answer, { sampled_records: rows.length });
        } catch (error: any) {
          agentRepository.addMessage(threadId, 'assistant', 'status', `AI 分析失败：${error.message}\n\n本次没有生成本地兜底分析，请检查模型配置并测试连接。`, {
            action: 'model_error',
            error: error.message,
          });
        }
      }
      return agentRepository.getThread(threadId);
    }

    let plan: ResearchPlan;
    if (decision.action === 'revise_plan' && latest?.status === 'awaiting_confirmation') {
      if (!decision.plan) {
        agentRepository.addMessage(threadId, 'assistant', 'status', 'AI 模型没有返回有效的计划修改内容。本次未修改计划，请重试。', {
          action: 'model_error',
          error: 'missing_plan',
        });
        return agentRepository.getThread(threadId);
      }
      const candidate = mergePlan(latest.plan, decision.plan);
      plan = normalizePlan(candidate, latest.goal);
    } else if (decision.action === 'create_plan') {
      if (decision.plan) plan = normalizePlan(decision.plan, content);
      else {
        try { plan = normalizePlan(await modelService.createPlan(planningText), planningText); }
        catch (error: any) {
          agentRepository.addMessage(threadId, 'assistant', 'status', `AI 计划生成失败：${error.message}\n\n本次没有生成本地兜底计划，请检查模型配置并测试连接。`, {
            action: 'model_error',
            error: error.message,
          });
          return agentRepository.getThread(threadId);
        }
      }
    } else {
      const reply = decision.reply.trim();
      if (!reply) {
        agentRepository.addMessage(threadId, 'assistant', 'status', 'AI 模型没有返回有效回复，请检查模型配置后重试。', {
          action: 'model_error',
          error: 'empty_response',
        });
        return agentRepository.getThread(threadId);
      }
      agentRepository.addMessage(threadId, 'assistant', 'text', reply, { action: 'chat' });
      return agentRepository.getThread(threadId);
    }
    const created = agentRepository.createPlan(threadId, plan);
    const platformNames = plan.platforms.map((p) => LABELS[p]).join('、');
    const lead = decision.reply.trim() || (decision.action === 'revise_plan' ? '我已按你的要求更新采集计划。' : '我已根据你的目标生成采集计划。');
    agentRepository.addMessage(threadId, 'assistant', 'plan', `${lead}\n将从 ${platformNames} 搜索 ${plan.keywords.join('、')}。确认后才会开始执行。`, { plan_id: created.plan_id, action: decision.action });
    return agentRepository.getThread(threadId);
  }

  private async stopPlan(plan: any) {
    for (const step of plan.steps) {
      if (step.status === 'running') await crawlerManager.stop(step.platform);
      if (['queued', 'running'].includes(step.status)) agentRepository.updateStep(step.step_id, 'stopped', step.run_id, null);
    }
    agentRepository.updatePlanStatus(plan.plan_id, 'stopped');
  }

  private describePlanStatus(plan: any): string {
    const stats = agentRepository.getPlanStats(plan.plan_id);
    const completed = plan.steps.filter((step: any) => step.status === 'completed').length;
    const distribution = stats.by_platform.length
      ? `\n平台分布：${stats.by_platform.map((item) => `${item.platform_label || LABELS[item.platform] || item.platform} ${item.count} 条`).join('，')}。`
      : '';

    if (plan.status === 'awaiting_confirmation') return '当前计划还在等待确认，尚未开始采集，所以已入库 0 条内容。';
    if (plan.status === 'queued') return `任务正在排队，目前已入库 ${stats.content_count} 条内容。${distribution}`.trim();
    if (plan.status === 'running') return `任务仍在采集中，目前已入库 ${stats.content_count} 条内容，已完成 ${completed}/${plan.steps.length} 个平台。${distribution}`.trim();
    if (plan.status === 'completed' && stats.content_count === 0) {
      return '任务状态显示已完成，但实际入库为 0 条内容。这通常表示爬虫进程正常退出了，但没有搜到结果或数据没有成功写入；建议查看采集控制台日志。';
    }
    if (plan.status === 'completed') return `本次任务已完成，共采集到 ${stats.content_count} 条内容。${distribution}`.trim();
    if (plan.status === 'partially_completed') return `本次任务部分完成，共采集到 ${stats.content_count} 条内容，成功 ${completed}/${plan.steps.length} 个平台。${distribution}`.trim();
    if (plan.status === 'failed') return `本次任务执行失败，目前实际入库 ${stats.content_count} 条内容。建议查看采集控制台日志后重试。${distribution}`.trim();
    if (plan.status === 'stopped') return `任务已停止，停止前共入库 ${stats.content_count} 条内容。${distribution}`.trim();
    return `当前任务状态为 ${plan.status}，已入库 ${stats.content_count} 条内容。${distribution}`.trim();
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
}

export const agentService = new AgentService();
