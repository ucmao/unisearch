import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import cors from '@fastify/cors';
import path from 'path';
import fs from 'fs';
import { crawlerManager } from './services/CrawlerManager';
import { analyticsRepository } from '../database/repository';
import { agentRepository } from './services/AgentRepository';
import { agentService } from './services/AgentService';
import { modelService } from './services/ModelService';
import { agentAttachmentService } from './services/AgentAttachmentService';
import type { AppConfig } from '../tools/config';
import { listConnectorManifests } from '../connectors/registry';
import type { ConnectorStartRequest } from '../connectors/types';

const fastify = Fastify({ logger: false, bodyLimit: 12 * 1024 * 1024 });

export async function startServer(port = 8080): Promise<number> {
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
    fastifyInstance.get('/api/ws/logs', { websocket: true }, (connection, req) => {
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

      socket.on('message', (message) => {
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
    fastifyInstance.get('/api/ws/status', { websocket: true }, (connection, req) => {
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

  // Env check
  fastify.get('/api/env/check', async () => {
    try {
      // Basic check to see if node_modules contains playwright
      const hasPlaywright = fs.existsSync(path.join(process.cwd(), 'node_modules/playwright'));
      return {
        success: true,
        message: 'UniSearch environment configured correctly',
        output: `Node.js ${process.version}; playwright ready: ${hasPlaywright}`,
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
    try {
      const { isCrawlerWindowVisible } = require('../main/index');
      return { success: true, visible: typeof isCrawlerWindowVisible === 'function' ? isCrawlerWindowVisible() : false };
    } catch {
      return { success: true, visible: false };
    }
  });

  fastify.post('/api/browser/window', async (request) => {
    try {
      const { action } = (request.body as any) || {};
      const main = require('../main/index');
      let visible = false;
      if (action === 'show' && typeof main.showCrawlerWindow === 'function') {
        visible = main.showCrawlerWindow();
      } else if (action === 'hide' && typeof main.hideCrawlerWindow === 'function') {
        visible = main.hideCrawlerWindow();
      } else if (action === 'toggle' && typeof main.toggleCrawlerWindow === 'function') {
        visible = main.toggleCrawlerWindow();
      } else if (typeof main.isCrawlerWindowVisible === 'function') {
        visible = main.isCrawlerWindowVisible();
      }
      return { success: true, visible };
    } catch (err: any) {
      return { success: false, error: err.message, visible: false };
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
        capabilities: connector.capabilities.map((capability) => capability.id),
      })),
    };
  });

  fastify.get('/api/config/connectors', async () => ({ connectors: listConnectorManifests() }));

  fastify.get('/api/config/options', async () => {
    return {
      login_types: [
        { value: 'qrcode', label: '二维码登录' },
        { value: 'cookie', label: 'Cookie 登录' },
      ],
      crawler_types: [
        { value: 'search', label: '关键词搜索' },
        { value: 'detail', label: '指定内容详情' },
        { value: 'creator', label: '创作者主页' },
      ],
    };
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
    const { title } = (request.body || {}) as { title?: string };
    try {
      const thread = agentRepository.renameThread(thread_id, String(title || ''));
      return thread || reply.status(404).send({ detail: 'Task not found' });
    } catch (error: any) {
      return reply.status(400).send({ detail: error.message || 'Invalid task name' });
    }
  });

  fastify.delete('/api/agent/threads/:thread_id', async (request, reply) => {
    const { thread_id } = request.params as { thread_id: string };
    const deleted = agentRepository.deleteThread(thread_id);
    if (deleted) agentAttachmentService.removeThreadFiles(thread_id);
    return deleted ? { status: 'ok' } : reply.status(404).send({ detail: 'Task not found' });
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

  fastify.post('/api/agent/threads/:thread_id/messages', async (request, reply) => {
    const { thread_id } = request.params as { thread_id: string };
    const { content, attachment_ids, task_references } = request.body as {
      content?: string;
      attachment_ids?: string[];
      task_references?: Array<{ plan_id: string; platforms?: string[] }>;
    };
    if (!content?.trim()) return reply.status(400).send({ detail: 'Message is required' });
    try { return await agentService.sendMessage(thread_id, content.trim(), { attachment_ids, task_references }); }
    catch (error: any) { return reply.status(400).send({ detail: error.message }); }
  });

  fastify.post('/api/agent/plans/:plan_id/execute', async (request, reply) => {
    const { plan_id } = request.params as { plan_id: string };
    try { return agentService.executePlan(plan_id); }
    catch (error: any) { return reply.status(400).send({ detail: error.message }); }
  });

  fastify.patch('/api/agent/plans/:plan_id', async (request, reply) => {
    const { plan_id } = request.params as { plan_id: string };
    const body = (request.body || {}) as { keywords?: string[]; analysis?: string[]; collectionDepth?: 'quick' | 'standard' | 'deep' | 'custom' };
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

  fastify.put('/api/agent/memory-settings', async (request) =>
    agentRepository.updateMemorySettings(request.body as any));

  fastify.get('/api/agent/memories', async () => ({ items: agentRepository.listMemories() }));

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

  fastify.get('/api/agent/plans/:plan_id/export', async (request, reply) => {
    const { plan_id } = request.params as { plan_id: string };
    const plan = agentRepository.getPlan(plan_id);
    if (!plan) return reply.status(404).send({ detail: 'Plan not found' });
    const rows = agentRepository.getPlanExportContents(plan_id);
    const columns = [
      ['platform_label', '平台'], ['keyword', '关键词'], ['title', '标题'], ['description', '正文'],
      ['creator_name', '作者'], ['likes', '点赞数'], ['saves', '收藏数'], ['comments', '评论数'],
      ['shares', '分享数'], ['views', '播放数'], ['published_at', '发布时间'], ['content_url', '内容链接'],
    ];
    const quote = (value: any) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    let csv = '\ufeff' + columns.map(([, header]) => quote(header)).join(',') + '\n';
    for (const row of rows) {
      csv += columns.map(([key]) => {
        const value = key === 'published_at' && row[key] ? new Date(row[key] * 1000).toLocaleString('zh-CN') : row[key];
        return quote(value);
      }).join(',') + '\n';
    }
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const filename = `UniSearch_${stamp}.csv`;
    return reply.header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(Buffer.from(csv, 'utf-8'));
  });

  fastify.get('/api/agent/model-profile', async () => modelService.getProfile(false));

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
    let success = false;
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
    const success = await crawlerManager.stop(query.platform);
    if (!success) {
      return reply.status(400).send({ detail: 'No crawler is running or stop failed' });
    }
    return { status: 'ok', message: `Crawler ${query.platform || 'all'} stopped successfully` };
  });

  fastify.post('/api/crawler/control', async (request, reply) => {
    const body = request.body as { platform: string; action: 'skip' | 'show_browser' };
    if (!body || !body.platform) {
      return reply.status(400).send({ detail: 'Missing platform parameter' });
    }
    if (body.action === 'skip') {
      const success = await crawlerManager.skip(body.platform);
      return { status: 'ok', success, message: `Skipped platform ${body.platform}` };
    }
    return { status: 'ok', message: 'Action processed' };
  });

  fastify.get('/api/crawler/events', (request, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();

    const onQrCode = (data: any) => {
      reply.raw.write(`event: qrcode_required\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const onLoginSuccess = (data: any) => {
      reply.raw.write(`event: login_success\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const onSkipped = (data: any) => {
      reply.raw.write(`event: skipped\ndata: ${JSON.stringify(data)}\n\n`);
    };

    crawlerManager.on('qrcode_required', onQrCode);
    crawlerManager.on('login_success', onLoginSuccess);
    crawlerManager.on('skipped', onSkipped);

    request.raw.on('close', () => {
      crawlerManager.off('qrcode_required', onQrCode);
      crawlerManager.off('login_success', onLoginSuccess);
      crawlerManager.off('skipped', onSkipped);
    });
  });

  fastify.get('/api/crawler/status', async (request) => {

    const query = request.query as { platform?: string };
    return crawlerManager.getStatus(query.platform);
  });

  fastify.get('/api/crawler/logs', async (request) => {
    const query = request.query as { platform?: string; limit?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 100;
    const logs = crawlerManager.getLogs(query.platform, limit);
    return { logs };
  });

  // Analytics routes
  fastify.get('/api/data/analytics/summary', async (request) => {
    const query = request.query as { run_id?: string; task_id?: string; platform?: string; keyword?: string };
    return analyticsRepository.summary(query.run_id, query.platform, query.keyword, query.task_id);
  });

  fastify.get('/api/data/analytics/contents', async (request) => {
    const query = request.query as {
      run_id?: string;
      task_id?: string;
      platform?: string;
      keyword?: string;
      query?: string;
      sort_by?: string;
      sort_order?: 'asc' | 'desc';
      page?: string;
      page_size?: string;
    };
    return analyticsRepository.queryContents({
      run_id: query.run_id,
      task_id: query.task_id,
      platform: query.platform,
      keyword: query.keyword,
      query: query.query,
      sort_by: query.sort_by,
      sort_order: query.sort_order,
      page: query.page ? parseInt(query.page, 10) : 1,
      page_size: query.page_size ? parseInt(query.page_size, 10) : 20,
    });
  });

  fastify.get('/api/data/analytics/comments', async (request) => {
    const query = request.query as {
      run_id?: string;
      task_id?: string;
      platform?: string;
      content_id?: string;
      level?: string;
      query?: string;
      page?: string;
      page_size?: string;
    };
    return analyticsRepository.queryComments({
      run_id: query.run_id,
      task_id: query.task_id,
      platform: query.platform,
      content_id: query.content_id,
      level: query.level ? parseInt(query.level, 10) : null,
      query: query.query,
      page: query.page ? parseInt(query.page, 10) : 1,
      page_size: query.page_size ? parseInt(query.page_size, 10) : 20,
    });
  });

  fastify.get('/api/data/analytics/comments/threads', async (request) => {
    const query = request.query as {
      platform: string;
      content_id: string;
      run_id?: string;
      task_id?: string;
      page?: string;
      page_size?: string;
    };
    return analyticsRepository.queryCommentThreads({
      platform: query.platform,
      content_id: query.content_id,
      run_id: query.run_id,
      task_id: query.task_id,
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

  fastify.delete('/api/data/analytics/runs/:run_id', async (request, reply) => {
    const params = request.params as { run_id: string };
    try {
      const deleted = analyticsRepository.deleteRun(params.run_id);
      if (!deleted) {
        return reply.status(404).send({ detail: 'Task not found' });
      }
      return { status: 'ok', run_id: params.run_id };
    } catch (err: any) {
      return reply.status(409).send({ detail: err.message });
    }
  });

  fastify.delete('/api/data/analytics/tasks/:task_id', async (request, reply) => {
    const params = request.params as { task_id: string };
    try {
      const deleted = analyticsRepository.deleteTask(params.task_id);
      if (!deleted) return reply.status(404).send({ detail: 'Task not found' });
      return { status: 'ok', task_id: params.task_id };
    } catch (err: any) {
      return reply.status(409).send({ detail: err.message });
    }
  });

  // Export CSV file stream
  fastify.get('/api/data/analytics/export', async (request, reply) => {
    const query = request.query as {
      run_id?: string;
      task_id?: string;
      platform?: string;
      keyword?: string;
      query?: string;
      sort_by?: string;
    };

    const res = analyticsRepository.queryContents({
      run_id: query.run_id,
      task_id: query.task_id,
      platform: query.platform,
      keyword: query.keyword,
      query: query.query,
      sort_by: query.sort_by || 'engagement',
      sort_order: 'desc',
      page: 1,
      page_size: 1000000,
    });

    const columns = [
      { key: 'run_id', header: '任务ID' },
      { key: 'platform_label', header: '平台' },
      { key: 'keyword', header: '关键词' },
      { key: 'content_id', header: '内容ID' },
      { key: 'title', header: '标题' },
      { key: 'creator_id', header: '创作者ID' },
      { key: 'creator_name', header: '创作者昵称' },
      { key: 'likes', header: '点赞数' },
      { key: 'saves', header: '收藏数' },
      { key: 'comments', header: '评论数' },
      { key: 'shares', header: '分享数' },
      { key: 'views', header: '播放数' },
      { key: 'engagement', header: '互动量' },
      { key: 'published_at', header: '发布时间' },
      { key: 'content_url', header: '内容链接' },
    ];

    // Build CSV string with UTF-8 BOM
    let csvContent = '\ufeff';
    csvContent += columns.map((c) => `"${c.header.replace(/"/g, '""')}"`).join(',') + '\n';
    
    for (const item of res.items) {
      const row = columns.map((col) => {
        let val = item[col.key];
        if (col.key === 'published_at' && val) {
          try {
            val = new Date(val * 1000).toLocaleString('zh-CN');
          } catch {
            val = String(val);
          }
        }
        val = val === null || val === undefined ? '' : String(val);
        // Escape quotes
        return `"${val.replace(/"/g, '""')}"`;
      });
      csvContent += row.join(',') + '\n';
    }

    const filename = `UniSearch结果_${new Date().toISOString().slice(0,10).replace(/-/g, '')}_${Date.now()}.csv`;

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
      .send(Buffer.from(csvContent, 'utf-8'));
  });

  // Serve static files (React frontend)
  const webuiDir = path.resolve(process.cwd(), 'api/webui');
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
