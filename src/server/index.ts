import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import cors from '@fastify/cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { crawlerManager } from './services/CrawlerManager';
import { analyticsRepository } from '../database/repository';
import { agentRepository } from './services/AgentRepository';
import { agentService } from './services/AgentService';
import { workflowEngine } from '../workflow/workflow-engine';
import { workflowRuntime } from '../workflow/workflow-runtime';
import { documentEngine } from '../document/document-engine';
import { skillRegistry } from '../skills/registry';
import { modelService } from './services/ModelService';
import { agentAttachmentService } from './services/AgentAttachmentService';
import { planIdsForRunningCrawlers, type RunningCrawlerState } from './services/StopScope';
import { listConnectorManifests } from '../connectors/registry';
import { getBrowserDataDir } from '../tools/runtimePaths';
import type { ConnectorStartRequest } from '../connectors/types';
import { processorWorkerExecutor } from '../processor/processor-worker-executor';
import { listProcessorCapabilities } from '../processor/capabilities';
import { documentProcessorRegistry } from '../document/processor-registry';
import { knowledgeIndex } from '../knowledge/knowledge-index';
import { retrievalService } from '../knowledge/retrieval-service';
import { ragService } from '../knowledge/rag-service';
import { analyzerRegistry, analysisService } from '../analyzers/registry';
import { graphService } from '../analyzers/graph-service';
import { reportArtifactService } from '../analyzers/report-artifact-service';
import { connectorHealthService } from '../connectors/health-service';
import { qualityGateService } from '../analyzers/quality-gate-service';
import { searchRelevanceService } from '../analyzers/search-relevance-service';
import { exporterRegistry, exportService } from '../exporters/registry';
import { zipDirectoryToBuffer } from '../exporters/zip';
import {
  canonicalDocumentsToXlsx,
  renderCanonicalExport,
  type CanonicalExportFieldMode,
  type CanonicalExportFormat,
} from '../exporters/canonical-export';

const fastify = Fastify({ logger: false, bodyLimit: 12 * 1024 * 1024 });
const activeAgentMessageRequests = new Map<string, AbortController>();

function runningWorkflowIds(platform?: string): string[] {
  const status = crawlerManager.getStatus(platform);
  const states = platform ? [status] : Object.values(status.platform_states || {});
  return planIdsForRunningCrawlers(
    states as RunningCrawlerState[],
    (runId) => agentRepository.getCrawlRun(runId)?.workflow_id,
  );
}

export interface ServerWindowControls {
  prepareCrawlerWindow?: (platform: string, preserveCurrentPage?: boolean) => Promise<boolean> | boolean;
  releaseCrawlerWindow?: (platform: string, status?: string, metrics?: any) => boolean;
  isCrawlerWindowVisible?: (platform?: string) => boolean;
  hasActiveCrawlerViews?: () => boolean;
  canOpenCrawlerWindow?: () => boolean;
  getActiveCrawlerPlatforms?: () => string[];
  showCrawlerWindow?: (platform?: string) => boolean;
  hideCrawlerWindow?: (platform?: string) => boolean;
  toggleCrawlerWindow?: (platform?: string) => boolean;
  clearCrawlerSessionData?: (platform?: string) => Promise<void> | void;
  openPlatformWindow?: (platform: string, url?: string) => Promise<boolean> | boolean;
  getCrawlerCredentialStatus?: (platform?: string) => Promise<Record<string, { hasCredentials: boolean; cookieCount: number }>> | Record<string, { hasCredentials: boolean; cookieCount: number }>;
}

export async function startServer(port = 8080, windowControls: ServerWindowControls = {}): Promise<number> {
  agentRepository.reconcileStuckTasks();
  crawlerManager.setWindowCoordinator({ prepareCrawlerWindow: windowControls.prepareCrawlerWindow });
  crawlerManager.setMaxConcurrentTasks(agentRepository.getRuntimeSettings().maxConcurrentCrawlers);
  crawlerManager.on('crawler_finished', (data: any) => windowControls.releaseCrawlerWindow?.(data.platform, data.status, data));
  crawlerManager.on('crawler_finished', () => {
    void agentService.tick();
    try { knowledgeIndex.rebuild(); } catch {}
  });

  // Error Handler
  fastify.setErrorHandler((error, request, reply) => {
    console.error('[Fastify Error Handler]', error);
    reply.status(500).send({ 
      error: 'Internal Server Error', 
      message: error.message, 
      stack: error.stack 
    });
  });

  // CORS Configuration
  await fastify.register(cors, {
    origin: [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:3000',
    ],
    credentials: true,
  });

  // WebSockets Configuration
  await fastify.register(fastifyWebsocket);

  // Register WebSocket routes
  fastify.register(async function (fastifyInstance) {
    // logs stream
    fastifyInstance.get('/api/ws/logs', { websocket: true }, (connection, _req) => {
      console.log('[WS] Client connected to logs stream');
      const socket = connection.socket || connection;

      // Send existing logs first
      const existingLogs = crawlerManager.getLogs();
      for (const log of existingLogs) {
        try {
          socket.send(JSON.stringify(log));
        } catch {}
      }

      // Send new logs in real-time
      const logListener = (log: any) => {
        try {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify(log));
          }
        } catch {}
      };
      crawlerManager.on('log', logListener);

      socket.on('message', (message: any) => {
        if (message.toString() === 'ping') {
          try {
            socket.send('pong');
          } catch {}
        }
      });

      socket.on('close', () => {
        console.log('[WS] Client disconnected from logs stream');
        crawlerManager.off('log', logListener);
      });
    });

    // status stream
    fastifyInstance.get('/api/ws/status', { websocket: true }, (connection, _req) => {
      console.log('[WS] Client connected to status stream');
      const socket = connection.socket || connection;
      
      const sendStatus = () => {
        try {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify(crawlerManager.getStatus()));
          }
        } catch {}
      };

      // Send immediately
      sendStatus();

      const timer = setInterval(sendStatus, 1000);

      socket.on('close', () => {
        console.log('[WS] Client disconnected from status stream');
        clearInterval(timer);
      });
    });
  });

  // Register API Endpoints
  
  // Health check
  fastify.get('/api/health', async () => {
    return { status: 'ok' };
  });

  fastify.get('/api/connectors/health', async () => ({ items: connectorHealthService.list() }));
  fastify.get('/api/quality', async (request) => {
    const query = request.query as { thread_id?: string; workflow_id?: string; run_id?: string };
    return { quality: qualityGateService.latestForScope({ threadId: query.thread_id, workflowId: query.workflow_id, runId: query.run_id }) };
  });

  // Env check
  fastify.get('/api/env/check', async () => {
    try {
      const resolveModule = (moduleName: string): boolean => {
        try {
          require.resolve(moduleName);
          return true;
        } catch {
          return false;
        }
      };
      const isPackaged = Boolean(require('electron').app?.isPackaged);
      const crawlerWorker = isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked/dist/crawler/worker.js')
        : path.join(process.cwd(), 'dist/crawler/worker.js');
      let electronChromium = !isPackaged;
      if (isPackaged) {
        const cdpPort = Number(process.env.UNISEARCH_CDP_PORT);
        if (Number.isInteger(cdpPort) && cdpPort > 0) {
          try {
            const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
              signal: AbortSignal.timeout(2000),
            });
            electronChromium = response.ok;
          } catch {
            electronChromium = false;
          }
        }
      }
      const checks = {
        playwright: resolveModule('playwright'),
        playwrightCore: resolveModule('playwright-core'),
        crawlerWorker: fs.existsSync(crawlerWorker),
        electronChromium,
      };
      const ready = Object.values(checks).every(Boolean);
      return {
        success: ready,
        message: ready ? 'UniSearch environment configured correctly' : 'UniSearch runtime is incomplete',
        output: `Node.js ${process.version}; playwright: ${checks.playwright}; playwright-core: ${checks.playwrightCore}; crawler worker: ${checks.crawlerWorker}; built-in Chromium: ${checks.electronChromium}`,
        checks,
      };
    } catch (err: any) {
      return {
        success: false,
        message: 'Environment check error',
        error: err.message,
      };
    }
  });

  // Browser Window Controller Endpoints
  fastify.get('/api/browser/window', async () => {
    return {
      success: true,
      visible: windowControls.isCrawlerWindowVisible?.() ?? false,
      has_views: windowControls.hasActiveCrawlerViews?.() ?? false,
      can_open: windowControls.canOpenCrawlerWindow?.() ?? false,
      active_platforms: windowControls.getActiveCrawlerPlatforms?.() ?? [],
    };
  });

  fastify.post('/api/browser/window', async (request) => {
    try {
      const { action, platform } = (request.body as any) || {};
      let toggled = false;
      if (action === 'show') {
        toggled = windowControls.showCrawlerWindow?.(platform) ?? false;
      } else if (action === 'hide') {
        toggled = windowControls.hideCrawlerWindow?.(platform) ?? false;
      } else if (action === 'toggle') {
        toggled = windowControls.toggleCrawlerWindow?.(platform) ?? false;
      }
      const visible = windowControls.isCrawlerWindowVisible?.(platform) ?? false;
      const hasViews = windowControls.hasActiveCrawlerViews?.() ?? false;
      const canOpen = windowControls.canOpenCrawlerWindow?.() ?? false;
      const activePlatforms = windowControls.getActiveCrawlerPlatforms?.() ?? [];
      return { success: true, visible, toggled, has_views: hasViews, can_open: canOpen, active_platforms: activePlatforms };
    } catch (err: any) {
      return { success: false, error: err.message, visible: false, has_views: false, can_open: false, active_platforms: [] };
    }
  });

  // Config options
  fastify.get('/api/config/platforms', async () => {
    return {
      platforms: listConnectorManifests().map((connector) => ({
        value: connector.id,
        label: connector.name,
        icon: connector.icon,
        category: connector.category,
        description: connector.description,
        capabilities: connector.capabilities.map((capability) => capability.id),
        requiresAuth: connector.auth.required,
        runtimeEngine: connector.runtime?.engine,
      })),
    };
  });

  fastify.get('/api/config/connectors', async () => ({ connectors: listConnectorManifests() }));

  fastify.get('/api/config/options', async () => {
    return {
      crawler_types: [
        { value: 'search', label: '关键词搜索' },
        { value: 'detail', label: '指定内容详情' },
        { value: 'creator', label: '创作者主页' },
      ],
    };
  });

  fastify.post('/api/config/auth/clear', async (request, reply) => {
    const body = (request.body as { platform?: string } | undefined) || {};
    const platform = body.platform?.trim();
    const connector = platform ? listConnectorManifests().find((c) => c.id === platform) : undefined;
    const platformLabel = connector?.name || platform;

    if (platform && !connector) {
      return reply.code(400).send({ detail: `未知采集平台：${platform}` });
    }

    const crawlerStatus = crawlerManager.getStatus();
    if (platform) {
      const state = crawlerStatus.platform_states?.[platform];
      if (state?.status === 'running') {
        return reply.code(400).send({ detail: `请先停止【${platformLabel}】平台的采集任务再清空凭证` });
      }
    } else {
      const isRunning = crawlerStatus.status === 'running' || Object.values(crawlerStatus.platform_states || {}).some((s: any) => s?.status === 'running');
      if (isRunning) {
        return reply.code(400).send({ detail: '请先停止当前正在运行的采集任务再清空身份凭证' });
      }
    }

    const browserDataDir = getBrowserDataDir();
    try {
      await windowControls.clearCrawlerSessionData?.(platform);

      if (!fs.existsSync(browserDataDir)) {
        await fs.promises.mkdir(browserDataDir, { recursive: true });
        return { status: 'ok', message: '已成功清空登录身份与状态缓存' };
      }

      if (platform) {
        const entries = await fs.promises.readdir(browserDataDir, { withFileTypes: true });
        const profileNames = new Set([`${platform}_user_data_dir`, `cdp_${platform}_user_data_dir`]);
        for (const entry of entries) {
          if (entry.isDirectory() && profileNames.has(entry.name)) {
            await fs.promises.rm(path.join(browserDataDir, entry.name), { recursive: true, force: true });
          }
        }
        return {
          status: 'ok',
          message: `已成功清空【${platformLabel}】平台的登录身份与缓存数据`,
        };
      } else {
        await fs.promises.rm(browserDataDir, { recursive: true, force: true });
        await fs.promises.mkdir(browserDataDir, { recursive: true });
        return { status: 'ok', message: '已成功清空所有采集平台的登录身份与状态缓存' };
      }
    } catch (err: any) {
      return reply.code(500).send({ detail: `清空登录身份凭证失败: ${err?.message || '文件系统异常'}` });
    }
  });

  fastify.post('/api/config/auth/open', async (request, reply) => {
    const body = (request.body as { platform?: string; url?: string } | undefined) || {};
    const platform = body.platform?.trim();
    if (!platform) {
      return reply.code(400).send({ detail: '请指定要打开登录的平台' });
    }
    const connector = listConnectorManifests().find((c) => c.id === platform);
    const platformLabel = connector?.name || platform;
    if (!connector) {
      return reply.code(400).send({ detail: `未知采集平台：${platform}` });
    }

    try {
      const opened = await windowControls.openPlatformWindow?.(platform, body.url);
      return {
        status: 'ok',
        opened: opened ?? true,
        platform,
        message: `已唤起【${platformLabel}】独立沙箱浏览器窗口，请在窗口中完成登录或换号`,
      };
    } catch (err: any) {
      return reply.code(500).send({ detail: `唤起平台登录窗口失败: ${err?.message || '未知错误'}` });
    }
  });

  fastify.get('/api/config/auth/status', async (request) => {
    const { platform } = (request.query as { platform?: string }) || {};
    try {
      const statuses = (await windowControls.getCrawlerCredentialStatus?.(platform?.trim() || undefined)) || {};
      return {
        status: 'ok',
        credentials: statuses,
      };
    } catch (err: any) {
      return {
        status: 'error',
        credentials: {},
        error: err?.message || '获取凭证状态失败',
      };
    }
  });

  // Local conversational agent routes
  fastify.get('/api/agent/threads', async () => ({ items: agentRepository.listThreads() }));

  fastify.get('/api/agent/referenceable-tasks', async () => ({ items: agentRepository.listReferenceableTasks() }));

  fastify.post('/api/agent/threads', async (request) => {
    const body = (request.body || {}) as { title?: string; add_welcome_message?: boolean };
    const title = body.title?.trim();
    const addWelcomeMessage = body.add_welcome_message !== false;
    return title
      ? agentRepository.createThread(title, true, addWelcomeMessage)
      : agentRepository.createThread(undefined, false, addWelcomeMessage);
  });

  fastify.get('/api/agent/threads/:thread_id', async (request, reply) => {
    await agentService.tick();
    const { thread_id } = request.params as { thread_id: string };
    const thread = agentRepository.getThread(thread_id);
    return thread || reply.status(404).send({ detail: 'Task not found' });
  });

  fastify.patch('/api/agent/threads/:thread_id', async (request, reply) => {
    const { thread_id } = request.params as { thread_id: string };
    const body = (request.body || {}) as { title?: string; pinned?: boolean };
    try {
      const thread = typeof body.pinned === 'boolean'
        ? agentRepository.setThreadPinned(thread_id, body.pinned)
        : agentRepository.renameThread(thread_id, String(body.title || ''));
      return thread || reply.status(404).send({ detail: 'Task not found' });
    } catch (error: any) {
      return reply.status(400).send({ detail: error.message || 'Invalid task name' });
    }
  });

  fastify.delete('/api/agent/threads/:thread_id', async (request, reply) => {
    const { thread_id } = request.params as { thread_id: string };
    const body = (request.body || {}) as { delete_analytics_data?: boolean };
    try {
      const result = agentRepository.deleteThread(thread_id, Boolean(body.delete_analytics_data));
      if (!result.deleted) return reply.status(404).send({ detail: 'Task not found' });
      agentAttachmentService.removeThreadFiles(thread_id);
      return { status: 'ok', ...result };
    } catch (error: any) {
      return reply.status(409).send({ detail: error.message });
    }
  });

  fastify.post('/api/agent/threads/:thread_id/attachments', async (request, reply) => {
    const { thread_id } = request.params as { thread_id: string };
    try {
      return await agentAttachmentService.upload(thread_id, request.body as any);
    } catch (error: any) {
      return reply.status(400).send({ detail: error.message });
    }
  });

  fastify.delete('/api/agent/threads/:thread_id/attachments/:attachment_id', async (request, reply) => {
    const { thread_id, attachment_id } = request.params as { thread_id: string; attachment_id: string };
    return agentAttachmentService.remove(thread_id, attachment_id)
      ? { status: 'ok' }
      : reply.status(404).send({ detail: 'Attachment not found' });
  });

  fastify.get('/api/agent/threads/:thread_id/attachments/:attachment_id/file', async (request, reply) => {
    const { thread_id, attachment_id } = request.params as { thread_id: string; attachment_id: string };
    const record = agentAttachmentService.getAttachmentRecord(thread_id, attachment_id);
    if (!record) return reply.status(404).send({ detail: 'Attachment file not found' });
    const stream = fs.createReadStream(record.filePath);
    return reply.type(record.mimeType).send(stream);
  });

  fastify.post('/api/agent/threads/:thread_id/messages', async (request, reply) => {
    const { thread_id } = request.params as { thread_id: string };
    const { content, attachment_ids, task_references, mentioned_connectors, mentioned_skills } = request.body as {
      content?: string;
      attachment_ids?: string[];
      task_references?: Array<{ plan_id: string; platforms?: string[] }>;
      mentioned_connectors?: string[];
      mentioned_skills?: string[];
    };
    if (!content?.trim()) return reply.status(400).send({ detail: 'Message is required' });
    const previous = activeAgentMessageRequests.get(thread_id);
    if (previous) return reply.status(409).send({ detail: '该任务已有消息正在处理中' });
    const controller = new AbortController();
    activeAgentMessageRequests.set(thread_id, controller);
    try { return await agentService.sendMessage(thread_id, content.trim(), { attachment_ids, task_references, mentioned_connectors, mentioned_skills }, controller.signal); }
    catch (error: any) {
      if (controller.signal.aborted) return reply.status(409).send({ detail: '已停止生成' });
      return reply.status(400).send({ detail: error.message });
    } finally {
      if (activeAgentMessageRequests.get(thread_id) === controller) activeAgentMessageRequests.delete(thread_id);
    }
  });

  fastify.post('/api/agent/threads/:thread_id/messages/stream', async (request, reply) => {
    const { thread_id } = request.params as { thread_id: string };
    const { content, attachment_ids, task_references, mentioned_connectors, mentioned_skills } = request.body as {
      content?: string;
      attachment_ids?: string[];
      task_references?: Array<{ plan_id: string; platforms?: string[] }>;
      mentioned_connectors?: string[];
      mentioned_skills?: string[];
    };
    if (!content?.trim()) return reply.status(400).send({ detail: 'Message is required' });
    if (activeAgentMessageRequests.has(thread_id)) {
      return reply.status(409).send({ detail: '该任务已有消息正在处理中' });
    }

    const controller = new AbortController();
    activeAgentMessageRequests.set(thread_id, controller);
    reply.hijack();
    reply.raw.statusCode = 200;
    reply.raw.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders?.();
    const write = (event: Record<string, unknown>) => {
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(`${JSON.stringify(event)}\n`);
    };

    try {
      const thread = await agentService.sendMessage(
        thread_id,
        content.trim(),
        { attachment_ids, task_references, mentioned_connectors, mentioned_skills },
        controller.signal,
        (delta) => write({ type: 'delta', delta }),
        (status) => write({ type: 'status', ...status }),
      );
      write({ type: 'complete', thread });
    } catch (error: any) {
      write({
        type: controller.signal.aborted ? 'stopped' : 'error',
        detail: controller.signal.aborted ? '已停止生成' : (error.message || 'AI 消息处理失败'),
      });
    } finally {
      if (activeAgentMessageRequests.get(thread_id) === controller) activeAgentMessageRequests.delete(thread_id);
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
    }
  });

  fastify.post('/api/agent/threads/:thread_id/messages/stop', async (request) => {
    const { thread_id } = request.params as any;
    const controller = activeAgentMessageRequests.get(thread_id);
    if (!controller) return { stopped: false };
    controller.abort(new DOMException('用户已停止生成', 'AbortError'));
    return { stopped: true };
  });

  fastify.post('/api/agent/threads/:thread_id/messages/:message_id/regenerate/stream', async (request, reply) => {
    const { thread_id, message_id } = request.params as { thread_id: string; message_id: string };
    if (activeAgentMessageRequests.has(thread_id)) {
      return reply.status(409).send({ detail: '该任务已有消息正在处理中' });
    }

    const controller = new AbortController();
    activeAgentMessageRequests.set(thread_id, controller);
    reply.hijack();
    reply.raw.statusCode = 200;
    reply.raw.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders?.();
    const write = (event: Record<string, unknown>) => {
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(`${JSON.stringify(event)}\n`);
    };

    try {
      const thread = await agentService.regenerateMessage(
        thread_id,
        message_id,
        controller.signal,
        (delta) => write({ type: 'delta', delta }),
        (status) => write({ type: 'status', ...status }),
      );
      write({ type: 'complete', thread });
    } catch (error: any) {
      write({
        type: controller.signal.aborted ? 'stopped' : 'error',
        detail: controller.signal.aborted ? '已停止生成' : (error.message || 'AI 消息处理失败'),
      });
    } finally {
      if (activeAgentMessageRequests.get(thread_id) === controller) activeAgentMessageRequests.delete(thread_id);
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
    }
  });

  fastify.post('/api/agent/threads/:thread_id/messages/:message_id/regenerate', async (request, reply) => {
    const { thread_id, message_id } = request.params as { thread_id: string; message_id: string };
    if (activeAgentMessageRequests.has(thread_id)) {
      return reply.status(409).send({ detail: '该任务已有消息正在处理中' });
    }
    const controller = new AbortController();
    activeAgentMessageRequests.set(thread_id, controller);
    try {
      return await agentService.regenerateMessage(thread_id, message_id, controller.signal);
    } catch (error: any) {
      if (controller.signal.aborted) return reply.status(409).send({ detail: '已停止生成' });
      return reply.status(400).send({ detail: error.message });
    } finally {
      if (activeAgentMessageRequests.get(thread_id) === controller) activeAgentMessageRequests.delete(thread_id);
    }
  });

  fastify.delete('/api/agent/threads/:thread_id/messages/:message_id', async (request, reply) => {
    const { thread_id, message_id } = request.params as { thread_id: string; message_id: string };
    const result = agentRepository.deleteMessagePair(thread_id, message_id);
    if (!result) return reply.status(404).send({ detail: 'Message not found' });
    for (const attachmentId of result.attachment_ids) agentAttachmentService.remove(thread_id, attachmentId);
    return agentRepository.getThread(thread_id);
  });

  fastify.post('/api/agent/plans/:plan_id/execute', async (request, reply) => {
    const { plan_id } = request.params as { plan_id: string };
    const body = (request.body || {}) as { stepKeys?: string[]; platforms?: string[] };
    try { return agentService.executePlan(plan_id, body); }
    catch (error: any) { return reply.status(400).send({ detail: error.message }); }
  });

  fastify.post('/api/agent/plans/:plan_id/incremental', async (request, reply) => {
    const { plan_id } = request.params as { plan_id: string };
    const body = (request.body || {}) as { execute?: boolean };
    try {
      const plan = agentRepository.createIncrementalPlan(plan_id);
      return body.execute ? agentService.executePlan(plan.plan_id) : plan;
    } catch (error: any) {
      return reply.status(400).send({ detail: error.message });
    }
  });

  // Stopping a plan must go through workflowRuntime: killing the crawler process
  // alone (POST /api/crawler/stop) only frees the slot and lets the runtime start
  // the next queued platform, which is not what "stop" means to the user.
  fastify.post('/api/agent/plans/:plan_id/stop', async (request, reply) => {
    const { plan_id } = request.params as { plan_id: string };
    const plan = agentRepository.getPlan(plan_id);
    if (!plan) return reply.status(404).send({ detail: 'Plan not found' });
    if (!['queued', 'running'].includes(plan.status)) {
      return { stopped: false, plan: agentRepository.getPlan(plan_id) };
    }
    await workflowRuntime.cancel(plan_id);
    return { stopped: true, plan: agentRepository.getPlan(plan_id) };
  });

  fastify.get('/api/agent/plans/:plan_id/workflow', async (request, reply) => {
    const { plan_id } = request.params as { plan_id: string };
    const workflow = workflowEngine.get(plan_id);
    if (!workflow) return reply.status(404).send({ detail: 'Workflow not found' });
    return workflow;
  });

  fastify.get('/api/skills', async () => ({ items: skillRegistry.list() }));
  fastify.get('/api/processors', async () => ({ items: listProcessorCapabilities() }));
  fastify.get('/api/analyzers', async () => ({ items: analyzerRegistry.list() }));
  fastify.get('/api/exporters', async () => ({ items: exporterRegistry.list(), exporters: exporterRegistry.list() }));

  fastify.get('/api/documents', async (request) => {
    const query = request.query as { run_id?: string; limit?: string };
    const limit = Math.max(1, Math.min(Number(query.limit) || 100, 1000));
    const items = query.run_id ? documentEngine.listByRun(query.run_id, limit) : documentEngine.list(limit);
    return { items, total: items.length };
  });

  fastify.get('/api/documents/:document_id', async (request, reply) => {
    const { document_id } = request.params as { document_id: string };
    const document = documentEngine.get(document_id);
    if (!document) return reply.status(404).send({ detail: 'Document not found' });
    return document;
  });

  fastify.get('/api/documents/:document_id/versions', async (request, reply) => {
    const { document_id } = request.params as { document_id: string };
    if (!documentEngine.get(document_id)) return reply.status(404).send({ detail: 'Document not found' });
    return { items: documentEngine.listVersions(document_id) };
  });

  fastify.post('/api/documents/:document_id/process', async (request, reply) => {
    const { document_id } = request.params as { document_id: string };
    const body = (request.body || {}) as { processor_ids?: string[] };
    const document = documentEngine.get(document_id);
    if (!document) return reply.status(404).send({ detail: 'Document not found' });
    const processorIds = Array.isArray(body.processor_ids) ? body.processor_ids.map(String) : [];
    if (!processorIds.length) return reply.status(400).send({ detail: 'processor_ids is required' });
    try {
      for (const processorId of processorIds) documentProcessorRegistry.get(processorId);
      const result = await processorWorkerExecutor.run(processorIds, [document]);
      const processed = documentEngine.saveProcessed(result.documents[0], result.artifacts);
      knowledgeIndex.indexDocument(document_id);
      await knowledgeIndex.embedMissing();
      return { document: processed, artifacts: result.artifacts };
    } catch (error: any) {
      return reply.status(400).send({ detail: error.message });
    }
  });

  fastify.get('/api/knowledge/search', async (request) => {
    const query = request.query as {
      q?: string;
      workflow_id?: string;
      thread_id?: string;
      platform?: string;
      kind?: string;
      subject_type?: string;
      keyword?: string;
      limit?: string;
    };
    return knowledgeIndex.searchDetailed(String(query.q || ''), {
        workflowId: query.workflow_id,
        threadId: query.thread_id,
        platform: query.platform,
        kind: query.kind,
        subjectType: query.subject_type,
        keyword: query.keyword,
        limit: Number(query.limit) || 8,
      });
  });

  fastify.post('/api/knowledge/rag', async (request, reply) => {
    const body = (request.body || {}) as {
      question?: string;
      workflow_id?: string;
      thread_id?: string;
      platform?: string;
      kind?: string;
      subject_type?: string;
      keyword?: string;
      limit?: number;
    };
    if (!body.question?.trim()) return reply.status(400).send({ detail: 'question is required' });
    try {
      return await ragService.answer(body.question.trim(), {
        workflowId: body.workflow_id,
        threadId: body.thread_id,
        platform: body.platform,
        kind: body.kind,
        subjectType: body.subject_type,
        keyword: body.keyword,
        limit: body.limit,
      });
    } catch (error: any) {
      return reply.status(400).send({ detail: error.message });
    }
  });

  fastify.post('/api/analyze', async (request, reply) => {
    const body = (request.body || {}) as { analyzer_id?: string; workflow_id?: string; options?: Record<string, unknown> };
    if (!body.analyzer_id) return reply.status(400).send({ detail: 'analyzer_id is required' });
    try {
      return await analysisService.run(body.analyzer_id, body.workflow_id, body.options);
    } catch (error: any) {
      return reply.status(400).send({ detail: error.message });
    }
  });

  fastify.get('/api/graph', async (request) => {
    const query = request.query as { thread_id?: string; workflow_id?: string; run_id?: string; rebuild?: string };
    const scope = { threadId: query.thread_id, workflowId: query.workflow_id, runId: query.run_id };
    const graph = query.rebuild === 'true' ? graphService.rebuild(scope) : graphService.latest(scope) || graphService.rebuild(scope);
    return { status: 'ok', graph };
  });

  fastify.post('/api/graph/rebuild', async (request) => {
    const body = (request.body || {}) as { thread_id?: string; workflow_id?: string; run_id?: string };
    return { status: 'ok', graph: graphService.rebuild({ threadId: body.thread_id, workflowId: body.workflow_id, runId: body.run_id }) };
  });

  fastify.get('/api/graph/:graph_id/evidence/:element_id', async (request, reply) => {
    const params = request.params as { graph_id: string; element_id: string };
    try {
      return { status: 'ok', ...graphService.evidence(params.graph_id, params.element_id) };
    } catch (error: any) {
      return reply.status(404).send({ detail: error.message });
    }
  });

  fastify.get('/api/graph/:graph_id/entity-rules', async (request, reply) => {
    try {
      return { status: 'ok', items: graphService.listEntityRules((request.params as { graph_id: string }).graph_id) };
    } catch (error: any) {
      return reply.status(404).send({ detail: error.message });
    }
  });

  fastify.post('/api/graph/:graph_id/entities/merge', async (request, reply) => {
    const graphId = (request.params as { graph_id: string }).graph_id;
    const body = (request.body || {}) as { node_ids?: string[]; target_label?: string };
    try {
      return { status: 'ok', graph: graphService.mergeEntities(graphId, body.node_ids || [], String(body.target_label || '')) };
    } catch (error: any) {
      return reply.status(400).send({ detail: error.message });
    }
  });

  fastify.post('/api/graph/:graph_id/entities/split', async (request, reply) => {
    const graphId = (request.params as { graph_id: string }).graph_id;
    const body = (request.body || {}) as { node_id?: string; document_ids?: string[]; target_label?: string };
    try {
      return { status: 'ok', graph: graphService.splitEntity(graphId, String(body.node_id || ''), body.document_ids || [], String(body.target_label || '')) };
    } catch (error: any) {
      return reply.status(400).send({ detail: error.message });
    }
  });

  fastify.post('/api/graph/:graph_id/entities/ignore', async (request, reply) => {
    const graphId = (request.params as { graph_id: string }).graph_id;
    const body = (request.body || {}) as { node_id?: string };
    try {
      return { status: 'ok', graph: graphService.ignoreEntity(graphId, String(body.node_id || '')) };
    } catch (error: any) {
      return reply.status(400).send({ detail: error.message });
    }
  });

  fastify.post('/api/graph/:graph_id/entities/link', async (request, reply) => {
    const graphId = (request.params as { graph_id: string }).graph_id;
    const body = (request.body || {}) as { from_node_id?: string; to_node_id?: string; relation?: string };
    try {
      return { status: 'ok', graph: graphService.linkEntities(graphId, String(body.from_node_id || ''), String(body.to_node_id || ''), body.relation) };
    } catch (error: any) {
      return reply.status(400).send({ detail: error.message });
    }
  });

  fastify.delete('/api/graph/:graph_id/entity-rules/:rule_id', async (request, reply) => {
    const params = request.params as { graph_id: string; rule_id: string };
    try {
      return { status: 'ok', graph: graphService.removeEntityRule(params.graph_id, params.rule_id) };
    } catch (error: any) {
      return reply.status(404).send({ detail: error.message });
    }
  });

  fastify.get('/api/reports', async (request) => {
    const query = request.query as { thread_id?: string; workflow_id?: string };
    return { items: reportArtifactService.list(query.thread_id, query.workflow_id) };
  });

  fastify.get('/api/reports/:artifact_id', async (request, reply) => {
    try {
      return reportArtifactService.get((request.params as { artifact_id: string }).artifact_id);
    } catch (error: any) {
      return reply.status(404).send({ detail: error.message });
    }
  });

  fastify.get('/api/reports/:artifact_id/compare', async (request, reply) => {
    const { artifact_id } = request.params as { artifact_id: string };
    const { against } = request.query as { against?: string };
    try {
      return reportArtifactService.compare(artifact_id, against);
    } catch (error: any) {
      return reply.status(400).send({ detail: error.message });
    }
  });

  fastify.delete('/api/reports/:artifact_id', async (request, reply) => {
    const { artifact_id } = request.params as { artifact_id: string };
    const success = reportArtifactService.delete(artifact_id);
    if (!success) return reply.status(404).send({ detail: '未找到指定研报文件' });
    return { status: 'ok', artifact_id };
  });

  fastify.patch('/api/reports/:artifact_id', async (request, reply) => {
    const { artifact_id } = request.params as { artifact_id: string };
    const body = (request.body || {}) as { title?: string };
    if (!body.title || !body.title.trim()) {
      return reply.status(400).send({ detail: '报告标题不能为空' });
    }
    try {
      const updated = reportArtifactService.updateTitle(artifact_id, body.title);
      return { status: 'ok', report: updated };
    } catch (error: any) {
      return reply.status(400).send({ detail: error.message });
    }
  });

  fastify.post('/api/reports/batch-delete', async (request, reply) => {
    const body = (request.body || {}) as { artifact_ids?: string[] };
    if (!Array.isArray(body.artifact_ids) || !body.artifact_ids.length) {
      return reply.status(400).send({ detail: '请选择要删除的研报文件' });
    }
    const deleted = reportArtifactService.deleteBatch(body.artifact_ids);
    return { status: 'ok', deleted };
  });

  fastify.get('/api/search-relevance', async (request) => {
    const { workflow_id } = request.query as { workflow_id?: string };
    return { items: workflow_id ? searchRelevanceService.list(workflow_id) : [] };
  });

  fastify.get('/api/reports/:artifact_id/download', async (request, reply) => {
    const { artifact_id } = request.params as { artifact_id: string };
    const query = request.query as { format?: string };
    const format = ['markdown', 'html', 'json', 'pdf', 'docx'].includes(query.format || '') ? query.format as 'markdown' | 'html' | 'json' | 'pdf' | 'docx' : 'html';
    try {
      const rendered = format === 'pdf' || format === 'docx'
        ? await reportArtifactService.renderFormal(artifact_id, format)
        : reportArtifactService.render(artifact_id, format);
      return reply.header('Content-Type', rendered.contentType)
        .header('Content-Disposition', `attachment; filename="${encodeURIComponent(rendered.filename)}"; filename*=UTF-8''${encodeURIComponent(rendered.filename)}`)
        .send(rendered.body);
    } catch (error: any) {
      return reply.status(404).send({ detail: error.message });
    }
  });

  fastify.post('/api/export', async (request, reply) => {
    const body = (request.body || {}) as { exporter_id?: string; workflow_id?: string };
    if (!body.exporter_id) return reply.status(400).send({ detail: 'exporter_id is required' });
    try {
      return await exportService.run(body.exporter_id, body.workflow_id);
    } catch (error: any) {
      return reply.status(400).send({ detail: error.message });
    }
  });

  fastify.patch('/api/agent/plans/:plan_id', async (request, reply) => {
    const { plan_id } = request.params as { plan_id: string };
    const body = (request.body || {}) as {
      keywords?: string[];
      analysis?: string[];
      collectionDepth?: 'quick' | 'standard' | 'deep' | 'custom';
      contentEnrichment?: {
        mode?: 'snippet' | 'auto' | 'full';
        maxReadItems?: number;
        maxPerDomain?: number;
        concurrency?: number;
        timeoutMsPerUrl?: number;
      };
    };
    try { return agentService.updatePlan(plan_id, body); }
    catch (error: any) { return reply.status(400).send({ detail: error.message }); }
  });

  fastify.patch('/api/agent/plans/:plan_id/analysis', async (request, reply) => {
    const { plan_id } = request.params as { plan_id: string };
    const { analysis } = (request.body || {}) as { analysis?: string[] };
    try { return agentService.updatePlanAnalysis(plan_id, analysis); }
    catch (error: any) { return reply.status(400).send({ detail: error.message }); }
  });

  fastify.get('/api/agent/memory-settings', async () => agentRepository.getMemorySettings());

  fastify.get('/api/knowledge/retrieval-profile', async () => retrievalService.getProfile(false));

  fastify.put('/api/knowledge/retrieval-profile', async (request, reply) => {
    try {
      const previous = retrievalService.getProfile(false);
      const profile = retrievalService.saveProfile(request.body as any);
      if (previous.provider !== profile.provider || previous.baseUrl !== profile.baseUrl || previous.embeddingModel !== profile.embeddingModel) {
        knowledgeIndex.clearEmbeddings();
      }
      return profile;
    } catch (error: any) {
      return reply.status(400).send({ detail: error.message });
    }
  });

  fastify.post('/api/knowledge/retrieval-profile/test', async (_request, reply) => {
    try {
      return await retrievalService.testConnection();
    } catch (error: any) {
      return reply.status(400).send({ detail: error.message });
    }
  });

  fastify.put('/api/agent/memory-settings', async (request) =>
    agentRepository.updateMemorySettings(request.body as any));

  fastify.get('/api/agent/runtime-settings', async () => agentRepository.getRuntimeSettings());

  fastify.put('/api/agent/runtime-settings', async (request) => {
    const settings = agentRepository.updateRuntimeSettings(request.body as any);
    crawlerManager.setMaxConcurrentTasks(settings.maxConcurrentCrawlers);
    return settings;
  });

  fastify.get('/api/agent/memories', async () => ({ items: agentRepository.listMemories() }));

  fastify.post('/api/agent/memories', async (request, reply) => {
    try {
      const body = request.body as any;
      const content = String(body?.content || '').trim();
      if (!content) return reply.status(400).send({ detail: '记忆内容不能为空' });
      const category = ['identity', 'preference', 'context', 'rule'].includes(body?.category)
        ? body.category
        : 'rule';
      const memoryKey = `user_manual_${crypto.randomUUID().replace(/-/g, '')}`;
      const memory = agentRepository.upsertMemory({
        category,
        memoryKey,
        content,
        confidence: 1.0,
        importance: 1.0,
        status: 'active',
      });
      return memory;
    } catch (error: any) {
      return reply.status(400).send({ detail: error.message });
    }
  });

  fastify.patch('/api/agent/memories/:memory_id', async (request, reply) => {
    const { memory_id } = request.params as { memory_id: string };
    try {
      const memory = agentRepository.updateMemory(memory_id, request.body as any);
      return memory || reply.status(404).send({ detail: 'Memory not found' });
    } catch (error: any) {
      return reply.status(400).send({ detail: error.message });
    }
  });

  fastify.delete('/api/agent/memories/:memory_id', async (request, reply) => {
    const { memory_id } = request.params as { memory_id: string };
    return agentRepository.deleteMemory(memory_id)
      ? { status: 'ok' }
      : reply.status(404).send({ detail: 'Memory not found' });
  });

  fastify.delete('/api/agent/memories', async () => ({ deleted: agentRepository.clearMemories() }));

  fastify.get('/api/agent/model-profile', async () => modelService.getProfile(false));

  fastify.get('/api/agent/model-profiles', async () => modelService.getProfiles());

  fastify.put('/api/agent/model-profile', async (request, reply) => {
    try { return modelService.saveProfile(request.body as any); }
    catch (error: any) { return reply.status(400).send({ detail: error.message }); }
  });

  fastify.post('/api/agent/model-profile/test', async (_request, reply) => {
    try { return await modelService.test(); }
    catch (error: any) { return reply.status(400).send({ detail: error.response?.data?.error?.message || error.message }); }
  });

  // Crawler routes
  fastify.post('/api/crawler/start', async (request, reply) => {
    const body = request.body as ConnectorStartRequest;
    let success: boolean;
    try {
      success = await crawlerManager.start(body);
    } catch (error: any) {
      return reply.status(400).send({ detail: error.message });
    }
    if (!success) {
      const status = crawlerManager.getStatus(body.platform);
      if (status.status === 'running' || status.status === 'stopping') {
        return reply.status(400).send({ detail: `Crawler for ${body.platform} is already running` });
      }
      return reply.status(500).send({ detail: `Failed to start crawler for ${body.platform}` });
    }

    const taskStatus = crawlerManager.getStatus(body.platform);
    return {
      status: 'ok',
      message: `Crawler for ${body.platform} started successfully`,
      run_id: taskStatus.run_id,
    };
  });

  fastify.post('/api/crawler/stop', async (request, reply) => {
    const query = request.query as { platform?: string };
    // Killing the crawler process is not enough when the run belongs to a plan:
    // the workflow would mark that step cancelled and immediately start the next
    // queued platform, so the user's "stop" would silently continue elsewhere.
    // Those runs have to be cancelled at the workflow level instead.
    const workflowIds = runningWorkflowIds(query.platform);
    for (const workflowId of workflowIds) await workflowRuntime.cancel(workflowId);
    // Ad-hoc crawls started outside a plan still need a direct stop, and
    // cancelling a workflow already stopped its own platforms.
    const stoppedDirectly = await crawlerManager.stop(query.platform);
    if (!workflowIds.length && !stoppedDirectly) {
      return reply.status(400).send({ detail: 'No crawler is running or stop failed' });
    }
    return {
      status: 'ok',
      message: `Crawler ${query.platform || 'all'} stopped successfully`,
      cancelled_plans: workflowIds,
    };
  });

  fastify.post('/api/crawler/control', async (request, reply) => {
    const body = request.body as { platform: string; action: 'show_browser' };
    if (!body || !body.platform) {
      return reply.status(400).send({ detail: 'Missing platform parameter' });
    }
    if (body.action !== 'show_browser') {
      return reply.status(400).send({ detail: 'Unsupported crawler control action' });
    }
    const success = windowControls.showCrawlerWindow?.(body.platform) ?? false;
    if (!success) {
      return reply.status(503).send({ detail: '内置采集浏览器仅可在桌面应用中打开' });
    }
    return { status: 'ok', success: true, message: 'Crawler browser opened' };
  });

  fastify.get('/api/crawler/events', (request, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();

    const onQrCode = (data: any) => {
      reply.raw.write(`event: qrcode_required\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const onLoginRequired = (data: any) => {
      reply.raw.write(`event: login_required\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const onLoginSuccess = (data: any) => {
      reply.raw.write(`event: login_success\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const onManualVerification = (data: any) => {
      reply.raw.write(`event: manual_verification_required\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const onManualVerificationSuccess = (data: any) => {
      reply.raw.write(`event: manual_verification_success\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const onCrawlerFinished = (data: any) => {
      reply.raw.write(`event: crawler_finished\ndata: ${JSON.stringify(data)}\n\n`);
    };

    crawlerManager.on('login_required', onLoginRequired);
    crawlerManager.on('qrcode_required', onQrCode);
    crawlerManager.on('login_success', onLoginSuccess);
    crawlerManager.on('manual_verification_required', onManualVerification);
    crawlerManager.on('manual_verification_success', onManualVerificationSuccess);
    crawlerManager.on('crawler_finished', onCrawlerFinished);

    request.raw.on('close', () => {
      crawlerManager.off('login_required', onLoginRequired);
      crawlerManager.off('qrcode_required', onQrCode);
      crawlerManager.off('login_success', onLoginSuccess);
      crawlerManager.off('manual_verification_required', onManualVerification);
      crawlerManager.off('manual_verification_success', onManualVerificationSuccess);
      crawlerManager.off('crawler_finished', onCrawlerFinished);
    });
  });

  fastify.get('/api/crawler/status', async (request) => {

    const query = request.query as { platform?: string };
    return crawlerManager.getStatus(query.platform);
  });

  fastify.get('/api/crawler/logs', async (request) => {
    const query = request.query as { platform?: string; limit?: string; thread_id?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 500;
    const logs = crawlerManager.getLogs(query.platform, limit, query.thread_id);
    return { logs };
  });

  // Analytics routes
  fastify.get('/api/data/analytics/summary', async (request) => {
    const query = request.query as {
      run_id?: string; workflow_id?: string; thread_id?: string; platform?: string;
      kind?: string; keyword?: string; subject_type?: string; query?: string;
    };
    return analyticsRepository.summary(query);
  });

  fastify.get('/api/data/analytics/documents', async (request) => {
    const query = request.query as {
      run_id?: string;
      workflow_id?: string;
      thread_id?: string;
      platform?: string;
      kind?: string;
      keyword?: string;
      subject_type?: string;
      parent_source_item_id?: string;
      query?: string;
      sort_by?: string;
      sort_order?: 'asc' | 'desc';
      page?: string;
      page_size?: string;
    };
    return analyticsRepository.queryDocuments({
      run_id: query.run_id,
      workflow_id: query.workflow_id,
      thread_id: query.thread_id,
      platform: query.platform,
      kind: query.kind,
      keyword: query.keyword,
      subject_type: query.subject_type,
      parent_source_item_id: query.parent_source_item_id,
      query: query.query,
      sort_by: query.sort_by,
      sort_order: query.sort_order,
      page: query.page ? parseInt(query.page, 10) : 1,
      page_size: query.page_size ? parseInt(query.page_size, 10) : 20,
    });
  });

  fastify.get('/api/data/analytics/runs', async (request) => {
    const query = request.query as { page?: string; page_size?: string };
    return analyticsRepository.listRuns(
      query.page ? parseInt(query.page, 10) : 1,
      query.page_size ? parseInt(query.page_size, 10) : 20
    );
  });

  fastify.get('/api/data/analytics/tasks', async () => analyticsRepository.listTaskHierarchy());

  fastify.get('/api/data/storage/summary', async () => analyticsRepository.storageSummary());

  fastify.get('/api/data/storage/preview', async (request) => {
    const query = (request.query || {}) as {
      crawl_days?: string | number;
      crawl_failed_days?: string | number;
      thread_days?: string | number;
      max_messages?: string | number;
    };
    return analyticsRepository.previewCleanup({
      crawl_days: query.crawl_days !== undefined ? Number(query.crawl_days) : undefined,
      crawl_failed_days: query.crawl_failed_days !== undefined ? Number(query.crawl_failed_days) : undefined,
      thread_days: query.thread_days !== undefined ? Number(query.thread_days) : undefined,
      max_messages: query.max_messages !== undefined ? Number(query.max_messages) : undefined,
    });
  });

  fastify.post('/api/data/storage/cleanup', async (request, reply) => {
    const { mode, days } = (request.body || {}) as { mode?: 'failed_empty' | 'older_than_30_days' | 'all'; days?: number };
    if (!mode || !['failed_empty', 'older_than_30_days', 'all'].includes(mode)) return reply.status(400).send({ detail: '不支持的清理范围' });
    return { status: 'ok', deleted: analyticsRepository.cleanupHistory(mode, { days }) };
  });

  fastify.post('/api/data/storage/cleanup-threads', async (request, reply) => {
    const { mode, days, max_messages, maxMessages } = (request.body || {}) as {
      mode?: 'empty_short' | 'older_than_30_days_no_crawl' | 'all_threads';
      days?: number;
      max_messages?: number;
      maxMessages?: number;
    };
    if (!mode || !['empty_short', 'older_than_30_days_no_crawl', 'all_threads'].includes(mode)) {
      return reply.status(400).send({ detail: '不支持的会话清理范围' });
    }
    return {
      status: 'ok',
      deleted: analyticsRepository.cleanupThreads(mode, {
        days,
        maxMessages: max_messages ?? maxMessages,
      }),
    };
  });

  fastify.post('/api/data/analytics/runs/batch-delete', async (request, reply) => {
    const body = (request.body || {}) as { run_ids?: string[]; with_reports?: boolean };
    if (!Array.isArray(body.run_ids) || !body.run_ids.length) return reply.status(400).send({ detail: '请选择要移除的执行记录' });
    try {
      return { status: 'ok', deleted: analyticsRepository.deleteRuns(body.run_ids, body.with_reports !== false) };
    } catch (err: any) {
      return reply.status(409).send({ detail: err.message });
    }
  });

  fastify.post('/api/data/analytics/tasks/batch-delete', async (request, reply) => {
    const body = (request.body || {}) as { thread_ids?: string[]; with_reports?: boolean };
    if (!Array.isArray(body.thread_ids) || !body.thread_ids.length) return reply.status(400).send({ detail: '请选择要移除的 AI 任务' });
    try {
      return { status: 'ok', deleted: analyticsRepository.deleteThreads(body.thread_ids, body.with_reports !== false) };
    } catch (err: any) {
      return reply.status(409).send({ detail: err.message });
    }
  });

  fastify.post('/api/data/analytics/rounds/batch-delete', async (request, reply) => {
    const body = (request.body || {}) as { plan_ids?: string[]; with_reports?: boolean };
    if (!Array.isArray(body.plan_ids) || !body.plan_ids.length) return reply.status(400).send({ detail: '请选择要移除的采集轮次' });
    try {
      return { status: 'ok', deleted: analyticsRepository.deletePlans(body.plan_ids, body.with_reports !== false) };
    } catch (err: any) {
      return reply.status(409).send({ detail: err.message });
    }
  });

  fastify.delete('/api/data/analytics/runs/:run_id', async (request, reply) => {
    const params = request.params as { run_id: string };
    const query = (request.query || {}) as { with_reports?: string };
    const withReports = query.with_reports !== 'false';
    try {
      const deleted = analyticsRepository.deleteRun(params.run_id, withReports);
      if (!deleted) {
        return reply.status(404).send({ detail: 'Task not found' });
      }
      return { status: 'ok', run_id: params.run_id };
    } catch (err: any) {
      return reply.status(409).send({ detail: err.message });
    }
  });

  fastify.delete('/api/data/analytics/tasks/:thread_id', async (request, reply) => {
    const params = request.params as { thread_id: string };
    const query = (request.query || {}) as { with_reports?: string };
    const withReports = query.with_reports !== 'false';
    try {
      const deleted = analyticsRepository.deleteThreads([params.thread_id], withReports);
      if (!deleted) return reply.status(404).send({ detail: 'Task not found' });
      return { status: 'ok', thread_id: params.thread_id };
    } catch (err: any) {
      return reply.status(409).send({ detail: err.message });
    }
  });

  fastify.delete('/api/data/analytics/rounds/:plan_id', async (request, reply) => {
    const params = request.params as { plan_id: string };
    try {
      const deleted = analyticsRepository.deletePlans([params.plan_id]);
      if (!deleted) return reply.status(404).send({ detail: 'Round not found' });
      return { status: 'ok', plan_id: params.plan_id };
    } catch (err: any) {
      return reply.status(409).send({ detail: err.message });
    }
  });

  // Unified Canonical Document export
  fastify.get('/api/data/analytics/export', async (request, reply) => {
    const query = request.query as {
      run_id?: string;
      workflow_id?: string;
      thread_id?: string;
      platform?: string;
      kind?: string;
      keyword?: string;
      subject_type?: string;
      query?: string;
      sort_by?: string;
      sort_order?: 'asc' | 'desc';
      format?: CanonicalExportFormat;
      field_mode?: CanonicalExportFieldMode;
      fields?: string;
    };

    const res = analyticsRepository.queryDocuments({
      run_id: query.run_id,
      workflow_id: query.workflow_id,
      thread_id: query.thread_id,
      platform: query.platform,
      kind: query.kind,
      keyword: query.keyword,
      subject_type: query.subject_type,
      query: query.query,
      sort_by: query.sort_by || 'updated_at',
      sort_order: query.sort_order === 'asc' ? 'asc' : 'desc',
      page: 1,
      page_size: 1000000,
    });

    const format: CanonicalExportFormat = ['xlsx', 'csv', 'json'].includes(query.format || '')
      ? query.format!
      : 'xlsx';
    const fieldMode: CanonicalExportFieldMode = ['recommended', 'visible', 'all'].includes(query.field_mode || '')
      ? query.field_mode!
      : 'recommended';
    const fields = query.fields?.split(',').map((field) => field.trim()).filter(Boolean);
    const exportOptions = {
      fieldMode,
      fields,
      metadata: {
        '平台筛选': query.platform,
        '内容类型筛选': query.kind,
        '关键词筛选': query.keyword,
        '主体类型筛选': query.subject_type,
        '搜索条件': query.query,
      },
    };
    const stamp = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${Date.now()}`;

    if (format === 'xlsx') {
      const content = await canonicalDocumentsToXlsx(res.items, exportOptions);
      const filename = `UniSearch_数据导出_${stamp}.xlsx`;
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
        .send(content);
    }

    const rendered = renderCanonicalExport(format, res.items, exportOptions);
    const filename = `UniSearch_数据导出_${stamp}.${rendered.extension}`;

    return reply
      .header('Content-Type', rendered.contentType)
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .send(Buffer.from(rendered.content, 'utf-8'));
  });

  // --- Knowledge Base endpoints ---
  fastify.get('/api/knowledge/documents', async (request, reply) => {
    const query = request.query as { workflow_id?: string; thread_id?: string };
    try {
      const documents = analysisService.documents(query.workflow_id, query.thread_id);
      return { status: 'ok', count: documents.length, documents };
    } catch (err: any) {
      return reply.status(500).send({ detail: err.message });
    }
  });

  fastify.post('/api/knowledge/rebuild', async (request, reply) => {
    const body = (request.body || {}) as { workflow_id?: string; thread_id?: string };
    try {
      const result = await knowledgeIndex.rebuildWithEmbeddings({ workflowId: body.workflow_id, threadId: body.thread_id });
      return { status: 'ok', ...result };
    } catch (err: any) {
      return reply.status(500).send({ detail: err.message });
    }
  });

  // --- Exporters Endpoints ---
  fastify.post('/api/exporters/run', async (request, reply) => {
    const body = request.body as { exporterId?: string; workflowId?: string };
    if (!body?.exporterId) return reply.status(400).send({ detail: 'exporterId is required' });
    try {
      const record = await exportService.run(body.exporterId, body.workflowId);
      return { status: 'ok', record };
    } catch (err: any) {
      return reply.status(500).send({ detail: err.message });
    }
  });

  fastify.get('/api/exporters/download', async (request, reply) => {
    const query = (request.query || {}) as {
      exporterId?: string;
      workflowId?: string;
      workflow_id?: string;
      thread_id?: string;
      threadId?: string;
      run_id?: string;
      platform?: string;
      kind?: string;
      keyword?: string;
      subject_type?: string;
      query?: string;
      sort_by?: string;
      sort_order?: 'asc' | 'desc';
    };

    const exporterId = query.exporterId;
    if (!exporterId) return reply.status(400).send({ detail: 'exporterId is required' });
    try {
      const effectiveWorkflowId = query.workflowId || query.workflow_id;
      const effectiveThreadId = query.thread_id || query.threadId;
      const record = await exportService.run(exporterId, {
        workflowId: effectiveWorkflowId,
        threadId: effectiveThreadId,
        filterParams: {
          run_id: query.run_id,
          workflow_id: effectiveWorkflowId,
          thread_id: effectiveThreadId,
          platform: query.platform,
          kind: query.kind,
          keyword: query.keyword,
          subject_type: query.subject_type,
          query: query.query,
          sort_by: query.sort_by,
          sort_order: query.sort_order,
        },
      });
      const targetPath = record.output_path;
      if (!fs.existsSync(targetPath)) return reply.status(4404).send({ detail: 'Export output not found' });
      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) {
        const zipBuffer = zipDirectoryToBuffer(targetPath);
        const name = path.basename(targetPath);
        const filename = `UniSearch_${name.replace(/\s+/g, '_')}.zip`;
        return reply
          .header('Content-Type', 'application/zip')
          .header('Content-Disposition', `attachment; filename="${filename}"`)
          .send(zipBuffer);
      } else {
        const fileBuffer = fs.readFileSync(targetPath);
        const base = path.basename(targetPath);
        const filename = base.startsWith('UniSearch_') ? base : `UniSearch_${base}`;
        return reply
          .header('Content-Type', 'text/markdown; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
          .send(fileBuffer);
      }
    } catch (err: any) {
      return reply.status(500).send({ detail: err.message });
    }
  });

  // Serve static files (React frontend)
  let appPath = process.cwd();
  try {
    const electron = require('electron');
    const app = electron.app || electron.remote?.app;
    if (app) appPath = app.getAppPath();
  } catch {}
  const webuiDir = path.resolve(appPath, 'api/webui');
  if (fs.existsSync(webuiDir)) {
    console.log(`[Fastify] Serving static files from: ${webuiDir}`);

    // Main assets static directory
    await fastify.register(fastifyStatic, {
      root: webuiDir,
      prefix: '/',
      wildcard: false,
    });

    // Subdirectories static fallback
    await fastify.register(fastifyStatic, {
      root: path.join(webuiDir, 'assets'),
      prefix: '/assets/',
      decorateReply: false,
    });

    await fastify.register(fastifyStatic, {
      root: path.join(webuiDir, 'logos'),
      prefix: '/logos/',
      decorateReply: false,
    });

    // Fallback single-page routing
    fastify.get('/*', async (request, reply) => {
      return reply.sendFile('index.html');
    });
  } else {
    console.warn(`[Fastify] React static build path not found at: ${webuiDir}. API mode only.`);
  }

  // Bind to 127.0.0.1 (local only)
  const address = await fastify.listen({ port, host: '127.0.0.1' });
  console.log(`[Fastify] Server is running on ${address}`);
  return port;
}

export async function stopServer(): Promise<void> {
  await crawlerManager.stop();
  processorWorkerExecutor.cancelAll();
  await fastify.close();
  console.log('[Fastify] Server stopped');
}

if (require.main === module && !process.versions.electron) {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
  startServer(port).catch((err) => {
    console.error('Server failed to start:', err);
    process.exit(1);
  });
}
