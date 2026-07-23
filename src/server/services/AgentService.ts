import fs from 'fs';
import { crawlerManager } from './CrawlerManager';
import { agentRepository, type ResearchPlan } from './AgentRepository';
import { inferCollectionDepth, inferResearchKeywords, inferResearchPlatforms, isSimpleConversation, localIntentDecision, type AgentDecision } from './AgentIntent';
import { modelService, type ConversationMaterials } from './ModelService';
import { connectorLabels, getConnectorManifest, listConnectorManifests } from '../../connectors/registry';
import { fallbackTitleFromText, isMeaningfulTitleInput, sanitizeThreadTitle, titleFromPlan } from './ThreadTitle';
import { normalizeAnalysisGoals } from './ResearchAnalysis';
import { directParserService } from './DirectParserService';

const SUPPORTED = listConnectorManifests().map((connector) => connector.id);
const LABELS = connectorLabels();

function normalizePlan(input: any, userText: string, fallbackPlan?: ResearchPlan): ResearchPlan {
  const platformAliases: Record<string, string> = {
    小红书: 'xhs', 抖音: 'dy', 快手: 'ks', B站: 'bili', 哔哩哔哩: 'bili', 微博: 'wb', 百度贴吧: 'tieba', 贴吧: 'tieba', 知乎: 'zhihu',
    百度: 'baidu', 百度搜索: 'baidu', 必应: 'bing', 必应中国: 'bing', '360': 'so360', '360搜索': 'so360', 搜狗: 'sogou', 搜狗搜索: 'sogou',
  };
  const platforms = Array.from(new Set((Array.isArray(input?.platforms) ? input.platforms : [])
    .map((p: any) => platformAliases[String(p)] || String(p))
    .filter((p: string) => SUPPORTED.includes(p)))) as string[];
  const inferredPlatforms = inferResearchPlatforms(userText);
  const rawKeywords = (Array.isArray(input?.keywords) ? input.keywords : [])
    .map((value: any) => String(value).trim()).filter(Boolean);
  let keywords = Array.from(new Set(rawKeywords.flatMap((keyword: string) => {
    // Models occasionally echo the merged clarification scaffold into a keyword,
    // e.g. "采集抖音 用户补充：codex学习". Re-run only command-like values
    // through the deterministic subject extractor.
    if (/用户补充|^(?:请|帮我|采集|收集|抓取|搜索|调研)|(?:小红书|抖音|快手|哔哩哔哩|微博|贴吧|知乎|百度|必应|360|搜狗).*(?:采集|搜索)/i.test(keyword)) {
      return inferResearchKeywords(keyword);
    }
    return [keyword];
  }))).slice(0, 12) as string[];

  if (!keywords.length && fallbackPlan?.keywords?.length) {
    keywords = fallbackPlan.keywords;
  }
  const capabilityIds = ['keyword_search', 'content_detail', 'creator_profile', 'comments', 'url_resolve'];
  const inferredCapability = /解析.*(?:链接|URL)|短链|真实链接/i.test(userText)
    ? 'url_resolve'
    : /(?:作者|博主|UP主|创作者|用户|主页).*(?:作品|内容|帖子|视频)|采集.*主页/i.test(userText)
      ? 'creator_profile'
      : /(?:这个|这些|指定|链接|URL).*(?:评论|回复|楼层)/i.test(userText)
        ? 'comments'
        : /(?:详情|指定作品|指定内容)|https?:\/\//i.test(userText)
          ? 'content_detail'
          : 'keyword_search';
  const capability = capabilityIds.includes(String(input?.capability)) ? input.capability : inferredCapability;
  const inputTargets = Array.isArray(input?.targets) ? input.targets : [];
  const textTargets = Array.from(userText.matchAll(/https?:\/\/[^\s，。；;]+/g)).map((match) => match[0]);
  const targets = Array.from(new Set([...inputTargets, ...textTargets].map((value) => String(value).trim()).filter(Boolean))).slice(0, 30);
  const goal = String(input?.goal || userText).slice(0, 300);
  const suppliedAnalysis = Array.isArray(input?.analysis) && input.analysis.some((value: unknown) => String(value).trim());
  const analysisSource = ['ai', 'fallback', 'user'].includes(String(input?.analysisSource))
    ? input.analysisSource
    : suppliedAnalysis ? 'ai' : 'fallback';

  const collectionDepth: 'quick' | 'standard' | 'deep' | 'custom' = input?.collectSubComments === true
    ? 'deep'
    : input?.collectComments === false
      ? 'quick'
      : input?.collectComments === true
        ? 'standard'
        : ['quick', 'standard', 'deep', 'custom'].includes(String(input?.collectionDepth))
          ? input.collectionDepth
          : inferCollectionDepth(userText);

  let collectComments = input?.collectComments !== undefined ? Boolean(input.collectComments) : true;
  let collectSubComments = Boolean(input?.collectSubComments);
  let startPage = Math.max(1, Math.min(20, Number(input?.startPage) || 1));

  if (collectionDepth === 'quick') {
    collectComments = false;
    collectSubComments = false;
    startPage = 1;
  } else if (collectionDepth === 'standard') {
    collectComments = true;
    collectSubComments = false;
    startPage = 1;
  } else if (collectionDepth === 'deep') {
    collectComments = true;
    collectSubComments = true;
    startPage = 1;
  }

  const selectedPlatforms = platforms.length ? platforms : inferredPlatforms;
  const requiresAuth = selectedPlatforms.some((pid) => getConnectorManifest(pid)?.auth.required);
  const loginType = requiresAuth ? 'qrcode' : 'none';

  return {
    goal,
    platforms: selectedPlatforms,
    keywords,
    capability,
    targets,
    connectorOptions: input?.connectorOptions && typeof input.connectorOptions === 'object' ? input.connectorOptions : {},
    collectionDepth,
    collectComments,
    collectSubComments,
    startPage,
    loginType,
    headless: Boolean(input?.headless),
    analysis: normalizeAnalysisGoals(input?.analysis, goal),
    analysisSource,
    outputs: Array.isArray(input?.outputs) ? input.outputs.map(String).slice(0, 5) : ['csv'],
  };
}

function isAnalysisIntent(text: string) {
  return /分析|总结|结论|对比|洞察|报告|原因|评价|评价如何|怎么看|舆情|趋势|正负面|正面|负面|都要|全都要|侧重/.test(text);
}

function mergePlan(base: ResearchPlan, patch: Partial<ResearchPlan>): ResearchPlan {
  const collectionDepth = patch.collectSubComments === true
    ? 'deep'
    : patch.collectComments === false
      ? 'quick'
      : patch.collectComments === true
        ? 'standard'
        : patch.collectionDepth || base.collectionDepth;
  return {
    ...base,
    ...patch,
    platforms: Array.isArray(patch.platforms) ? patch.platforms : base.platforms,
    keywords: Array.isArray(patch.keywords) ? patch.keywords : base.keywords,
    targets: Array.isArray(patch.targets) ? patch.targets : base.targets,
    connectorOptions: patch.connectorOptions && typeof patch.connectorOptions === 'object' ? patch.connectorOptions : base.connectorOptions,
    collectionDepth,
    analysis: Array.isArray(patch.analysis) ? patch.analysis : base.analysis,
    outputs: Array.isArray(patch.outputs) ? patch.outputs : base.outputs,
  };
}

function conversationalTurnsSinceReminder(messages: any[]): number {
  let turns = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    if (message.metadata?.redirect_reminded || message.metadata?.action !== 'chat') break;
    turns++;
  }
  return turns;
}

export class AgentService {
  private timer: NodeJS.Timeout;
  constructor() {
    this.timer = setInterval(() => this.tick().catch((error) => console.error('[AgentService]', error)), 1500);
    this.timer.unref();
  }

  private collectMaterials(thread: any, includePlanId?: string): ConversationMaterials {
    const attachmentIds = new Set<string>();
    const referenceMap = new Map<string, Set<string>>();
    for (const message of thread.messages || []) {
      if (message.role !== 'user') continue;
      for (const attachment of message.metadata?.attachments || []) {
        if (typeof attachment?.attachment_id === 'string') attachmentIds.add(attachment.attachment_id);
      }
      for (const reference of message.metadata?.task_references || []) {
        if (typeof reference?.plan_id !== 'string') continue;
        const selected = referenceMap.get(reference.plan_id) || new Set<string>();
        for (const platform of reference.platforms || []) if (SUPPORTED.includes(platform)) selected.add(platform);
        referenceMap.set(reference.plan_id, selected);
      }
    }
    const autoPlanId = includePlanId || agentRepository.getLatestPlan(thread.thread_id)?.plan_id;
    if (autoPlanId && !referenceMap.has(autoPlanId)) {
      const targetPlan = agentRepository.getPlan(autoPlanId);
      if (targetPlan && ['completed', 'partially_completed'].includes(targetPlan.status)) {
        referenceMap.set(autoPlanId, new Set());
      }
    }

    const texts: ConversationMaterials['texts'] = [];
    const images: ConversationMaterials['images'] = [];
    let remainingChars = 90_000;
    for (const attachment of agentRepository.getAttachments(thread.thread_id, [...attachmentIds])) {
      if (attachment.kind === 'image' && attachment.storage_path) {
        try {
          const data = fs.readFileSync(attachment.storage_path).toString('base64');
          images.push({ label: attachment.file_name, dataUrl: `data:${attachment.mime_type};base64,${data}` });
        } catch {}
        continue;
      }
      if (remainingChars <= 0) break;
      const value = attachment.text_content.slice(0, remainingChars);
      if (value) texts.push({ label: `上传文件：${attachment.file_name}`, content: value });
      remainingChars -= value.length;
    }
    for (const [planId, platforms] of referenceMap) {
      if (remainingChars <= 0) break;
      const plan = agentRepository.getPlan(planId);
      if (!plan || !['completed', 'partially_completed'].includes(plan.status)) continue;
      const rows = agentRepository.getPlanContents(planId, 60, [...platforms]);
      const value = JSON.stringify({ goal: plan.goal, selected_platforms: [...platforms], records: rows }).slice(0, remainingChars);
      texts.push({ label: `采集任务：${plan.goal}`, content: value });
      remainingChars -= value.length;
    }
    return { texts, images: images.slice(0, 5) };
  }

  private isExplicitMemoryRequest(text: string): boolean {
    return /记住|记得我|请记得|别忘了|忘记|删除.*记忆|以后(?:叫我|称呼我|回复|回答)|我叫|我的名字是|你叫/.test(text);
  }

  private scheduleMemoryCapture(threadId: string, latestUserText: string) {
    const settings = agentRepository.getMemorySettings();
    if (!settings.enabled || !settings.autoCapture) return;

    // 过滤无实质意义的简单字符
    const trimmed = latestUserText.trim();
    if (!trimmed || /^(好|嗯|对|是的|收到|ok|1|666|Thanks|谢谢)$/i.test(trimmed)) return;

    const thread = agentRepository.getThread(threadId);
    const userMessages = (thread?.messages || []).filter((message: any) => message.role === 'user');
    if (!userMessages.length) return;

    const recent = userMessages.slice(-6).map((message: any) => ({
      messageId: String(message.message_id),
      content: String(message.content).slice(0, 1200),
    }));
    const source = userMessages.at(-1);
    void modelService.extractMemories(recent).then((memories) => {
      for (const memory of memories) {
        if (!['add', 'update', 'delete'].includes(memory.action)) continue;
        const memoryKey = String(memory.key || '').trim().slice(0, 120);
        if (!memoryKey) continue;
        if (memory.action === 'delete') {
          agentRepository.deleteMemoryByKey(memoryKey);
          continue;
        }
        const category = ['identity', 'preference', 'context', 'rule'].includes(memory.category)
          ? memory.category
          : 'context';
        const confidence = Math.max(0, Math.min(1, Number(memory.confidence) || 0));
        const importance = Math.max(0, Math.min(1, Number(memory.importance) || 0.5));
        
        // 智能提取出的记忆，置信度达到 0.6 即可直接置为 active (生效)，无需用户手动确认
        const status = confidence >= 0.6 ? 'active' : 'candidate';
        
        agentRepository.upsertMemory({
          category: category as 'identity' | 'preference' | 'context' | 'rule',
          memoryKey,
          content: String(memory.content || ''),
          confidence,
          importance,
          status,
          sourceThreadId: threadId,
          sourceMessageId: source?.message_id,
        });
      }
    }).catch((error) => console.warn('[MemoryCapture]', error.message || error));
  }

  private scheduleThreadTitle(threadId: string) {
    const thread = agentRepository.getThread(threadId);
    if (!thread || thread.title_locked || ['manual', 'generated'].includes(String(thread.title_source))) return;
    const conversation = (thread.messages || [])
      .filter((message: any) => ['user', 'assistant'].includes(message.role))
      .map((message: any) => ({
        role: message.role as 'user' | 'assistant',
        content: String(message.content),
      }));
    const firstMeaningfulUser = conversation.findIndex((message: any) =>
      message.role === 'user' && isMeaningfulTitleInput(message.content),
    );
    if (firstMeaningfulUser < 0) return;
    const messages = conversation
      .slice(firstMeaningfulUser)
      .slice(0, 6)
      .filter((message: any) => message.role !== 'user' || isMeaningfulTitleInput(message.content));

    void modelService.generateThreadTitle(messages).then((value) => {
      const title = sanitizeThreadTitle(value);
      if (title && isMeaningfulTitleInput(title)) agentRepository.updateAutomaticTitle(threadId, title, 'generated');
    }).catch((error) => console.warn('[ThreadTitle]', error.message || error));
  }

  async sendMessage(
    threadId: string,
    content: string,
    context: { attachment_ids?: string[]; task_references?: Array<{ plan_id: string; platforms?: string[] }> } = {},
  ) {
    const thread = agentRepository.getThread(threadId);
    if (!thread) throw new Error('任务不存在');
    const attachmentIds = Array.from(new Set((context.attachment_ids || []).map(String))).slice(0, 5);
    const attachments = agentRepository.getAttachments(threadId, attachmentIds);
    if (attachments.length !== attachmentIds.length) throw new Error('部分附件不存在或不属于当前任务');
    const taskReferences = (context.task_references || []).slice(0, 3).map((reference) => {
      const plan = agentRepository.getPlan(String(reference.plan_id || ''));
      if (!plan || !['completed', 'partially_completed'].includes(plan.status)) throw new Error('引用的采集任务不存在或尚未产生可分析结果');
      const available = new Set(plan.steps.map((step: any) => step.platform));
      const platforms = Array.from(new Set((reference.platforms || []).map(String)))
        .filter((platform) => SUPPORTED.includes(platform) && available.has(platform));
      return { plan_id: plan.plan_id, goal: plan.goal, platforms };
    });
    const messageMetadata = {
      attachments: attachments.map((attachment) => ({
        attachment_id: attachment.attachment_id, file_name: attachment.file_name,
        mime_type: attachment.mime_type, kind: attachment.kind, size_bytes: attachment.size_bytes,
      })),
      task_references: taskReferences,
    };
    agentRepository.addMessage(threadId, 'user', 'text', content, messageMetadata);
    const previousMeaningfulMessage = thread.messages.some((message: any) =>
      message.role === 'user' && isMeaningfulTitleInput(String(message.content)),
    );
    if (!previousMeaningfulMessage && isMeaningfulTitleInput(content) && !thread.title_locked) {
      agentRepository.updateAutomaticTitle(threadId, fallbackTitleFromText(content), 'fallback');
    }

    const latest = agentRepository.getLatestPlan(threadId);
    const previousMessage = thread.messages.at(-1);
    const lastUserMessage = [...thread.messages].reverse().find((message: any) => message.role === 'user');
    const lastAssistantMessage = [...thread.messages].reverse().find((message: any) => message.role === 'assistant');
    const awaitingClarification = previousMessage?.role === 'assistant' && previousMessage?.kind === 'clarify';
    const previousUserMessage = awaitingClarification
      ? lastUserMessage
      : null;
    const planningText = previousUserMessage ? `${previousUserMessage.content}\n用户补充：${content}` : content;
    const localDecision = localIntentDecision(content, {
      planStatus: latest?.status,
      awaitingClarification,
      previousUserText: lastUserMessage?.content,
      previousAssistantText: lastAssistantMessage?.content,
      hasPreviousPlanKeywords: Boolean(latest?.plan?.keywords?.length),
    });

    if (localDecision.action === 'direct_parse') {
      try {
        const result = await directParserService.parseSingleText(content);
        const reply = directParserService.formatMarkdownReply(content, result);
        agentRepository.addMessage(threadId, 'assistant', 'text', reply, {
          action: 'direct_parse',
          succ: result.succ,
        });
        this.scheduleThreadTitle(threadId);
        this.scheduleMemoryCapture(threadId, content);
        return agentRepository.getThread(threadId);
      } catch (error: any) {
        agentRepository.addMessage(threadId, 'assistant', 'status', `无水印解析请求发生异常：${error.message || '系统错误'}`, {
          action: 'direct_parse_error',
        });
        return agentRepository.getThread(threadId);
      }
    }

    const onRetry = (retryCount: number, maxRetries: number, delaySec: number, reason: string) => {
      crawlerManager.emit('log', {
        id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
        level: 'warning',
        message: `AI 接口调用失败，正在自动重试 ${retryCount} / ${maxRetries}（等待 ${delaySec}s）...`,
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        platform: 'system',
        thread_id: threadId,
        retry_count: retryCount,
        max_retries: maxRetries,
        delay_sec: delaySec,
        retry_reason: reason,
      });
    };

    const profile = modelService.getProfile(false);
    if (!profile.apiKeyConfigured) {
      agentRepository.addMessage(threadId, 'assistant', 'text', '还没有配置 AI 模型 API Key。请打开“模型设置”完成配置，然后重新发送这条问题。', {
        action: 'model_setup_required',
        error: 'unconfigured',
      });
      return agentRepository.getThread(threadId);
    }

    let decision: AgentDecision;
    if (localDecision.action === 'model_info') {
      decision = localDecision;
    } else if (localDecision.action === 'chat' && ((attachments.length > 0 || taskReferences.length > 0) || isSimpleConversation(content))) {
      try {
        const updatedThread = agentRepository.getThread(threadId);
        const messages = updatedThread.messages
          .filter((message: any) => ['user', 'assistant'].includes(message.role))
          .map((message: any) => ({ role: message.role as 'user' | 'assistant', content: String(message.content) }));
        const redirectToResearch = conversationalTurnsSinceReminder(updatedThread.messages) + 1 >= 3;
        const materials = this.collectMaterials(updatedThread);
        const memories = agentRepository.retrieveMemories(content).map((memory) => ({ category: memory.category, content: memory.content }));
        const reply = (await modelService.converse(messages, { redirectToResearch, materials, memories, onRetry })).trim();
        if (!reply) throw new Error('模型没有返回文本内容');
        agentRepository.addMessage(threadId, 'assistant', 'text', reply, {
          action: 'chat',
          redirect_reminded: redirectToResearch,
        });
        this.scheduleThreadTitle(threadId);
        this.scheduleMemoryCapture(threadId, content);
        return agentRepository.getThread(threadId);
      } catch (error: any) {
        const reason = modelService.getRuntimeStatus().lastError || error.message || '未知错误';
        agentRepository.addMessage(threadId, 'assistant', 'status', `AI 服务连接失败：${reason}\n\n本次没有生成 AI 回复，请到“模型设置”检查配置并测试连接。`, {
          action: 'model_error',
          error: reason,
        });
        return agentRepository.getThread(threadId);
      }
    } else {
      const updatedThread = agentRepository.getThread(threadId);
      const messages = updatedThread.messages
        .filter((message: any) => ['user', 'assistant'].includes(message.role))
        .map((message: any) => ({ role: message.role as 'user' | 'assistant', content: String(message.content) }));
      try {
        decision = await modelService.decide(messages, latest ? { status: latest.status, plan: latest.plan } : null, onRetry);
        if (localDecision.action === 'create_plan' && decision.action === 'chat') {
          const generated = await modelService.createPlan(messages, planningText, onRetry);
          decision = { action: 'create_plan', reply: '', plan: generated };
        } else if (localDecision.action === 'create_plan' && decision.action === 'revise_plan' && latest && !['awaiting_confirmation', 'queued', 'running'].includes(latest.status)) {
          decision = { ...decision, action: 'create_plan' };
        } else if (['status', 'analyze', 'export'].includes(localDecision.action)) {
          // These intents are backed by local state.  Do not let a model turn a
          // request to inspect real results into ordinary chat (and then claim it
          // cannot see the very records the application has just loaded).
          decision = localDecision;
        } else if (decision.action === 'create_plan' && localDecision.action !== 'create_plan') {
          // Creating a plan changes persistent state. The model may use the full
          // conversation for semantic routing, but it must not turn assistant
          // introductions or ordinary chat into collection parameters.
          decision = localDecision;
        }
      } catch (error: any) {
        if (localDecision.action === 'create_plan') {
          try {
            const generated = await modelService.createPlan(messages, planningText, onRetry);
            decision = { action: 'create_plan', reply: '', plan: generated };
          } catch (planError: any) {
            const reason = modelService.getRuntimeStatus().lastError || planError.message || error.message || '未知错误';
            agentRepository.addMessage(threadId, 'assistant', 'status', `AI 计划解析失败：${reason}\n\n本次没有创建或执行任何任务，请重新描述采集平台和关键词后再试。`, {
              action: 'model_error', error: reason,
            });
            return agentRepository.getThread(threadId);
          }
        } else if (localDecision.action === 'clarify') {
          decision = localDecision;
        } else if (localDecision.action === 'status') {
          // Status is read-only, so the deterministic result is a safe fallback
          // when the model cannot return a valid structured decision.
          decision = localDecision;
        } else {
          const reason = modelService.getRuntimeStatus().lastError || error.message || '未知错误';
          agentRepository.addMessage(threadId, 'assistant', 'status', `AI 服务连接失败：${reason}\n\n本次没有生成 AI 回复，请到“模型设置”检查配置并测试连接。`, {
            action: 'model_error', error: reason,
          });
          return agentRepository.getThread(threadId);
        }
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
      this.scheduleThreadTitle(threadId);
      this.scheduleMemoryCapture(threadId, content);
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

    if (decision.action === 'export') {
      if (!latest || !latest.steps.some((step: any) => step.run_id)) {
        agentRepository.addMessage(threadId, 'assistant', 'text', '当前还没有可以导出的采集数据。请先完成一次采集任务。', { action: 'export' });
      } else {
        const stats = agentRepository.getPlanStats(latest.plan_id);
        agentRepository.addMessage(
          threadId,
          'assistant',
          'export',
          `当前任务的 CSV 已准备好，共 ${stats.content_count} 条内容。点击下方按钮下载；桌面版会保存到系统“下载”目录，并在完成后自动定位文件。`,
          { action: 'export', plan_id: latest.plan_id, record_count: stats.content_count },
        );
      }
      return agentRepository.getThread(threadId);
    }

    if (decision.action === 'analyze' || (latest && ['completed', 'partially_completed'].includes(latest.status) && isAnalysisIntent(content))) {
      if (!latest || !['completed', 'partially_completed'].includes(latest.status)) {
        agentRepository.addMessage(threadId, 'assistant', 'text', '当前还没有已完成的采集结果可以分析。', { action: 'chat' });
        return agentRepository.getThread(threadId);
      }
      // Prefer the specialised analysis request whenever this plan has records.
      // `collectMaterials` is also used for normal chat and includes the whole
      // conversation, which makes some compatible models overlook the records
      // and answer as if they had no access to the completed task.
      const rows = agentRepository.getPlanContents(latest.plan_id, 100);
      if (rows.length) {
        try {
          const answer = await modelService.analyze(latest.goal, latest.plan.analysis, content, rows, onRetry);
          agentRepository.addMessage(threadId, 'assistant', 'analysis', answer, { sampled_records: rows.length });
        } catch (error: any) {
          agentRepository.addMessage(threadId, 'assistant', 'status', `AI 分析失败：${error.message}`, { action: 'model_error', error: error.message });
        }
        return agentRepository.getThread(threadId);
      }

      const updatedThread = agentRepository.getThread(threadId);
      const referencedMaterials = this.collectMaterials(updatedThread, latest.plan_id);
      if (referencedMaterials.texts.length || referencedMaterials.images.length) {
        try {
          const messages = updatedThread.messages
            .filter((message: any) => ['user', 'assistant'].includes(message.role))
            .map((message: any) => ({ role: message.role as 'user' | 'assistant', content: String(message.content) }));
          const answer = await modelService.converse(messages, { materials: referencedMaterials, analysisGoals: latest.plan.analysis, onRetry });
          agentRepository.addMessage(threadId, 'assistant', 'analysis', answer, { action: 'material_analysis' });
        } catch (error: any) {
          agentRepository.addMessage(threadId, 'assistant', 'status', `AI 分析失败：${error.message}`, {
            action: 'model_error',
            error: error.message,
          });
        }
      } else {
        agentRepository.addMessage(threadId, 'assistant', 'analysis', '当前任务没有可分析的数据。可以先检查采集结果，或重试失败的平台。');
      }
      return agentRepository.getThread(threadId);
    }

    if (decision.action === 'create_plan' && latest) {
      if (latest.status === 'awaiting_confirmation') {
        agentRepository.addMessage(threadId, 'assistant', 'text', '当前轮次仍在等待确认。你可以继续修改范围，或确认后开始执行。', {
          action: 'plan_already_exists', plan_id: latest.plan_id,
        });
        return agentRepository.getThread(threadId);
      }
      if (['queued', 'running'].includes(latest.status)) {
        agentRepository.addMessage(threadId, 'assistant', 'text', '当前采集轮次仍在执行。完成后可以直接在这个任务里发起下一轮采集。', {
          action: 'plan_round_active', plan_id: latest.plan_id,
        });
        return agentRepository.getThread(threadId);
      }
    }

    let plan: ResearchPlan;
    if (decision.action === 'revise_plan' && latest?.status === 'awaiting_confirmation') {
      let patch = decision.plan;
      if (!patch || typeof patch !== 'object') {
        const fallbackPlatforms = inferResearchPlatforms(planningText);
        const fallbackKeywords = inferResearchKeywords(planningText);
        const fallbackDepth = inferCollectionDepth(planningText);
        patch = {
          ...(fallbackPlatforms.length ? { platforms: fallbackPlatforms } : {}),
          ...(fallbackKeywords.length ? { keywords: fallbackKeywords } : {}),
          collectionDepth: fallbackDepth,
        };
      }
      const candidate = mergePlan(latest.plan, patch);
      plan = normalizePlan(candidate, latest.goal, latest?.plan);
    } else if (decision.action === 'create_plan') {
      if (decision.plan) plan = normalizePlan(decision.plan, planningText, latest?.plan);
      else {
        const updatedThread = agentRepository.getThread(threadId);
        const messages = updatedThread.messages
          .filter((message: any) => ['user', 'assistant'].includes(message.role))
          .map((message: any) => ({ role: message.role as 'user' | 'assistant', content: String(message.content) }));
        try {
          const generated = await modelService.createPlan(messages, planningText, onRetry);
          plan = normalizePlan(generated, planningText, latest?.plan);
        }
        catch (error: any) {
          const fallbackKeywords = inferResearchKeywords(planningText);
          plan = normalizePlan({
            platforms: inferResearchPlatforms(planningText),
            keywords: fallbackKeywords,
          }, planningText, latest?.plan);
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
    if (!plan.platforms.length) {
      if (latest && ['completed', 'partially_completed'].includes(latest.status)) {
        const updatedThread = agentRepository.getThread(threadId);
        const referencedMaterials = this.collectMaterials(updatedThread, latest.plan_id);
        if (referencedMaterials.texts.length || referencedMaterials.images.length) {
          try {
            const messages = updatedThread.messages
              .filter((message: any) => ['user', 'assistant'].includes(message.role))
              .map((message: any) => ({ role: message.role as 'user' | 'assistant', content: String(message.content) }));
            const answer = await modelService.converse(messages, { materials: referencedMaterials, analysisGoals: latest.plan.analysis, onRetry });
            agentRepository.addMessage(threadId, 'assistant', 'analysis', answer, { action: 'material_analysis' });
            return agentRepository.getThread(threadId);
          } catch (error: any) {}
        }
      }
      agentRepository.addMessage(threadId, 'assistant', 'clarify', '你想采集哪些平台？可以直接说“小红书和微博”或“全部平台”。', {
        action: 'clarify', missing_fields: ['platforms'],
      });
      return agentRepository.getThread(threadId);
    }
    if (plan.capability === 'keyword_search' && !plan.keywords.length) {
      agentRepository.addMessage(threadId, 'assistant', 'clarify', '你最想调研的具体品牌、产品、事件或主题是什么？', {
        action: 'clarify', missing_fields: ['subject'],
      });
      return agentRepository.getThread(threadId);
    }
    if (plan.capability && plan.capability !== 'keyword_search' && !(plan.targets || []).length) {
      agentRepository.addMessage(threadId, 'assistant', 'clarify', '这个任务需要明确的内容链接、作品 ID 或主页链接。请把要处理的目标发给我。', {
        action: 'clarify', missing_fields: ['targets'], capability: plan.capability,
      });
      return agentRepository.getThread(threadId);
    }
    const created = decision.action === 'revise_plan' && latest
      ? agentRepository.updatePendingPlan(latest.plan_id, plan)
      : agentRepository.createPlan(threadId, plan);
    const platformNames = plan.platforms.map((p) => LABELS[p]).join('、');
    const capabilityLabel = plan.platforms
      .map((platform) => getConnectorManifest(platform)?.capabilities.find((capability) => capability.id === (plan.capability || 'keyword_search'))?.label)
      .find(Boolean) || '关键词搜索';
    const lead = decision.action === 'revise_plan'
      ? '已按你的补充更新采集范围。'
      : '已识别并创建待确认的采集计划。';
    const messageKind = 'plan';
    const targetDescription = plan.capability === 'keyword_search'
      ? plan.keywords.join('、')
      : (plan.targets || []).join('、') || '待识别目标';
    const depth = plan.collectionDepth || (plan.collectSubComments ? 'deep' : plan.collectComments ? 'standard' : 'quick');
    const depthSummary = depth === 'deep'
      ? '每个关键词最多 100 条，并采集一级评论和回复评论'
      : depth === 'standard'
        ? '每个关键词最多 50 条，并采集一级评论'
        : '每个关键词最多 30 条，不采集评论';
    agentRepository.addMessage(threadId, 'assistant', messageKind, `${lead}\n平台：${platformNames}\n${plan.capability === 'keyword_search' ? '关键词' : '目标'}：${targetDescription}\n范围：${depthSummary}\n\n如果范围没问题，直接告诉我可以开始；需要调整也可以继续补充。`, { plan_id: created.plan_id, action: decision.action });
    if (!latest) agentRepository.updateAutomaticTitle(threadId, titleFromPlan(plan), 'plan');
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

  updatePlan(planId: string, updates: { keywords?: string[]; analysis?: string[]; collectionDepth?: 'quick' | 'standard' | 'deep' | 'custom' }) {
    const current = agentRepository.getPlan(planId);
    if (!current) throw new Error('计划不存在');
    if (current.status !== 'awaiting_confirmation') throw new Error('只有等待确认的计划可以修改参数');
    let updatedPlan = { ...current.plan };
    if (Array.isArray(updates.keywords)) {
      const keywords = Array.from(new Set(updates.keywords.map((v) => String(v).trim()).filter(Boolean))).slice(0, 12);
      if (keywords.length > 0) updatedPlan.keywords = keywords;
    }
    if (Array.isArray(updates.analysis)) {
      updatedPlan.analysis = normalizeAnalysisGoals(updates.analysis, current.plan.goal);
      updatedPlan.analysisSource = 'user';
    }
    if (updates.collectionDepth && ['quick', 'standard', 'deep', 'custom'].includes(updates.collectionDepth)) {
      const depth = updates.collectionDepth;
      updatedPlan.collectionDepth = depth;
      if (depth === 'quick') {
        updatedPlan.collectComments = false;
        updatedPlan.collectSubComments = false;
        updatedPlan.startPage = 1;
      } else if (depth === 'standard') {
        updatedPlan.collectComments = true;
        updatedPlan.collectSubComments = false;
        updatedPlan.startPage = 1;
      } else if (depth === 'deep') {
        updatedPlan.collectComments = true;
        updatedPlan.collectSubComments = true;
        updatedPlan.startPage = 1;
      }
    }
    return agentRepository.updatePendingPlan(planId, updatedPlan);
  }

  updatePlanAnalysis(planId: string, analysis: unknown) {
    const current = agentRepository.getPlan(planId);
    if (!current) throw new Error('计划不存在');
    if (current.status !== 'awaiting_confirmation') throw new Error('只有等待确认的计划可以修改分析目标');
    if (!Array.isArray(analysis)) throw new Error('分析目标格式不正确');
    const goals = normalizeAnalysisGoals(analysis, current.plan.goal);
    return agentRepository.updatePendingPlan(planId, { ...current.plan, analysis: goals, analysisSource: 'user' });
  }

  async tick() {
    crawlerManager.setMaxConcurrentTasks(agentRepository.getRuntimeSettings().maxConcurrentCrawlers);
    for (const plan of agentRepository.listActivePlans()) await this.tickPlan(plan);
  }

  private async tickPlan(plan: any) {
    for (const step of plan.steps) {
      if (step.status !== 'running') continue;
      const state = crawlerManager.getStatus(step.platform);
      if (state.status === 'running' || state.status === 'stopping') continue;
      const run = step.run_id ? agentRepository.getCrawlRun(step.run_id) : null;
      if (run?.status === 'completed') agentRepository.updateStep(step.step_id, 'completed', step.run_id, null);
      else agentRepository.updateStep(step.step_id, run?.status === 'stopped' ? 'stopped' : 'failed', step.run_id, run?.error_message || '采集进程未正常完成');
    }

    const refreshed = agentRepository.getPlan(plan.plan_id);
    for (const step of refreshed.steps.filter((s: any) => s.status === 'queued')) {
      if (!crawlerManager.hasCapacity()) break;
      const platformState = crawlerManager.getStatus(step.platform);
      if (platformState.status === 'running' || platformState.status === 'stopping') continue;
      const p = refreshed.plan as ResearchPlan;
      const capabilityId = p.capability || 'keyword_search';
      const manifest = getConnectorManifest(step.platform);
      const capability = manifest?.capabilities.find((item) => item.id === capabilityId);
      if (!capability) {
        agentRepository.updateStep(step.step_id, 'failed', null, `${manifest?.name || step.platform} 不支持能力 ${capabilityId}`);
        continue;
      }
      const depth = p.collectionDepth || 'standard';
      const maxCount = depth === 'quick' ? 30 : depth === 'deep' ? 100 : 50;
      const maxPages = depth === 'quick' ? 3 : depth === 'deep' ? 10 : 5;
      const connectorOptions = {
        collection_depth: depth,
        crawler_max_notes_count: maxCount,
        max_items: maxCount,
        max_pages: maxPages,
        ...(p.connectorOptions?.[step.platform] || {}),
        ...(capabilityId === 'creator_profile' ? { creator_ids: targets } : {}),
        ...(['content_detail', 'comments', 'url_resolve'].includes(capabilityId) ? { specified_ids: targets } : {}),
        enable_comments: capabilityId === 'comments' ? true : p.collectComments,
        enable_sub_comments: capabilityId === 'comments' ? true : p.collectSubComments,
      };
      let ok = false;
      try {
        ok = await crawlerManager.start({
          platform: step.platform, connector_id: step.platform, capability: capabilityId,
          login_type: p.loginType, crawler_type: capability.runtimeMode, keywords: p.keywords.join(','),
          specified_ids: ['content_detail', 'comments', 'url_resolve'].includes(capabilityId) ? targets.join(',') : '',
          creator_ids: capabilityId === 'creator_profile' ? targets.join(',') : '',
          connector_options: connectorOptions,
          start_page: p.startPage, collection_depth: depth, enable_comments: p.collectComments, enable_sub_comments: p.collectSubComments,
          cookies: '', headless: p.headless, loop_execution: false,
          thread_id: refreshed.thread_id, plan_id: refreshed.plan_id, task_title: refreshed.goal,
        });
      } catch (error: any) {
        agentRepository.updateStep(step.step_id, 'failed', null, error.message || 'Connector 参数校验失败');
        continue;
      }
      if (ok) {
        const state = crawlerManager.getStatus(step.platform);
        agentRepository.updateStep(step.step_id, 'running', state.run_id, null);
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
      const totalItems = final.stats?.content_count ?? 0;
      const text = status === 'completed'
        ? `采集完成：${completed} 个平台均已成功，共采集到 ${totalItems} 条数据。你可以继续问我“分析这些结果”，或前往结果看板查看和导出。`
        : `采集已结束：${completed} 个平台成功，${statuses.length - completed} 个平台失败或停止，共采集到 ${totalItems} 条数据。成功数据仍可分析，也可以重试失败步骤。`;
      agentRepository.addMessage(final.thread_id, 'assistant', 'status', text, { plan_id: final.plan_id, status });
    }
  }
}

export const agentService = new AgentService();
