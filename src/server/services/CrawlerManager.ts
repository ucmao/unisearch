import { fork, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { activeConfig, applyConfig } from '../../tools/config';
import { analyticsRepository } from '../../database/repository';
import { getDatabasePath } from '../../database/connection';
import type { LogEntry } from '@/lib/api';
import { normalizeConnectorRequest } from '../../connectors/registry';
import type { ConnectorStartRequest } from '../../connectors/types';

export type CrawlerStartRequest = ConnectorStartRequest;

export interface CrawlerWindowCoordinator {
  prepareCrawlerWindow?: (platform: string) => Promise<boolean> | boolean;
}

export class CrawlerTask {
  public platform: string;
  public config: CrawlerStartRequest;
  public process: ChildProcess | null = null;
  public status: 'idle' | 'running' | 'stopping' | 'error' = 'idle';
  public startedAt: string | null = null;
  public currentRunId: string | null = null;
  public lastRunId: string | null = null;
  public logs: LogEntry[] = [];
  private logId = 0;
  public shouldLoop: boolean;
  private loopTimeout: NodeJS.Timeout | null = null;

  constructor(platform: string, config: CrawlerStartRequest) {
    this.platform = platform;
    this.config = config;
    this.shouldLoop = config.loop_execution;
  }

  private addLog(message: string, level: LogEntry['level'], manager: CrawlerManager): void {
    this.logId++;
    const entry: LogEntry = {
      id: this.logId,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      level,
      message,
      platform: this.platform,
    };

    if (this.currentRunId) {
      try {
        entry.id = analyticsRepository.appendRunLog(this.currentRunId, entry);
      } catch (error: any) {
        console.error(`[CrawlerTask] Failed to persist execution log: ${error.message}`);
      }
    }

    this.logs.push(entry);
    if (this.logs.length > 500) {
      this.logs.shift();
    }

    manager.addGlobalLog(entry);
  }

  private collectRunContents(runId: string): any[] {
    try {
      // In JS migration, platform-specific tables can be queried to get crawled contents.
      // For simplicity, we query the latest contents ingested during this run.
      if (!runId) return [];
      const res = analyticsRepository.queryContents({
        run_id: runId,
        platform: this.platform,
        page: 1,
        page_size: 1000000,
      });
      return res.items;
    } catch (err) {
      console.error('[CrawlerTask] Error collecting run contents:', err);
      return [];
    }
  }

  private async finalizeRun(
    status: 'completed' | 'failed' | 'stopped',
    exitCode: number | null,
    manager: CrawlerManager,
    errorMessage = ''
  ): Promise<void> {
    if (!this.currentRunId) {
      return;
    }
    const runId = this.currentRunId;
    this.lastRunId = runId;

    try {
      const contents = this.collectRunContents(runId);
      analyticsRepository.finishRun(runId, status, exitCode, contents, errorMessage);
      this.addLog(
        `运行分析已保存: 任务 ${runId.slice(0, 8)}, 包含 ${contents.length} 条记录`,
        status === 'completed' ? 'success' : 'info',
        manager
      );
    } catch (err: any) {
      analyticsRepository.finishRun(runId, 'failed', exitCode, [], String(err));
      this.addLog(`保存分析结果失败: ${err.message}`, 'error', manager);
    } finally {
      this.currentRunId = null;
    }
  }

  public startProcess(manager: CrawlerManager): void {
    // Save configuration options as dynamic config overrides
    const configData: any = { ...this.config };
    configData.cookies = ''; // Clear secret values before persisting config log

    const runId = analyticsRepository.createRun(configData);
    this.currentRunId = runId;
    this.startedAt = new Date().toISOString();

    const isPackaged = process.env.NODE_ENV === 'production' || require('electron').app?.isPackaged;
    let workerPath = '';
    
    if (isPackaged) {
      workerPath = path.join(process.resourcesPath, 'app.asar.unpacked/dist/crawler/worker.js');
      if (!fs.existsSync(workerPath)) {
        workerPath = path.join(__dirname, '../crawler/worker.js');
      }
    } else {
      workerPath = path.join(process.cwd(), 'dist/crawler/worker.js');
    }

    this.addLog(`启动爬虫循环 (平台: ${this.platform}, 任务ID: ${runId.slice(0, 8)})`, 'info', manager);

    try {
      // Get main process database directory to share database file with worker subprocess
      const dbPath = getDatabasePath();
      const dbDir = path.dirname(dbPath);

      // Spawn node worker subprocess
      this.process = fork(workerPath, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: {
          ...process.env,
          UNISEARCH_RUN_ID: runId,
          NODE_ENV: process.env.NODE_ENV,
          UNISEARCH_USER_DATA_DIR: dbDir,
        },
      });

      this.status = 'running';

      if (!this.process.stdin) {
        throw new Error('Worker subprocess stdin is unavailable');
      }

      // Pipe configuration to worker stdin
      this.process.stdin.write(JSON.stringify(this.config) + '\n');
      this.process.stdin.end();

      // Read stdout line-by-line
      this.process.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          const cleanLine = line.trim();
          if (cleanLine) {
            const level = manager.parseLogLevel(cleanLine);
            this.addLog(cleanLine, level, manager);
          }
        }
      });

      // Read stderr line-by-line
      this.process.stderr?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          const cleanLine = line.trim();
          if (cleanLine) {
            this.addLog(cleanLine, 'error', manager);
          }
        }
      });

      this.process.on('message', (msg: any) => {
        if (msg && msg.type === 'LOGIN_QRCODE_REQUIRED') {
          this.addLog(`检测到 ${this.platform} 需扫码登录，已提取二维码推送至界面`, 'warning', manager);
          manager.emit('qrcode_required', msg);
        } else if (msg && msg.type === 'LOGIN_SUCCESS') {
          this.addLog(`${this.platform} 登录成功！`, 'success', manager);
          manager.emit('login_success', msg);
        } else if (msg && msg.type === 'MANUAL_VERIFICATION_REQUIRED') {
          this.addLog(`检测到 ${this.platform} 图形验证，请在内置浏览器中手动完成`, 'warning', manager);
          manager.emit('manual_verification_required', msg);
        } else if (msg && msg.type === 'MANUAL_VERIFICATION_SUCCESS') {
          this.addLog(`${this.platform} 图形验证已完成`, 'success', manager);
          manager.emit('manual_verification_success', msg);
        }
      });

      this.process.on('error', (err) => {
        this.addLog(`子进程发生异常: ${err.message}`, 'error', manager);
      });


      this.process.on('exit', async (code) => {
        const exitCode = code ?? -1;
        this.process = null;

        let runStatus: 'completed' | 'failed' | 'stopped' = 'completed';
        if (this.status === 'stopping') {
          runStatus = 'stopped';
          this.addLog('爬虫循环已手动停止', 'warning', manager);
        } else if (exitCode === 0) {
          this.addLog('爬虫单次循环已成功结束', 'success', manager);
          runStatus = 'completed';
        } else {
          this.addLog(`爬虫进程异常退出，退出码: ${exitCode}`, 'error', manager);
          runStatus = 'failed';
        }

        await this.finalizeRun(runStatus, exitCode, manager);

        if (this.status !== 'stopping' && this.shouldLoop) {
          this.status = 'idle';
          this.addLog(`平台 ${this.platform} 循环中。5秒后执行下次抓取...`, 'info', manager);
          this.loopTimeout = setTimeout(() => {
            this.startProcess(manager);
          }, 5000);
        } else {
          this.status = 'idle';
          manager.emit('crawler_finished', { platform: this.platform, status: runStatus });
        }
      });
    } catch (err: any) {
      this.status = 'error';
      analyticsRepository.finishRun(runId, 'failed', null, [], err.message);
      this.currentRunId = null;
      this.addLog(`启动爬虫进程失败: ${err.message}`, 'error', manager);
    }
  }

  public async stop(manager: CrawlerManager): Promise<void> {
    this.shouldLoop = false;
    this.status = 'stopping';

    if (this.loopTimeout) {
      clearTimeout(this.loopTimeout);
      this.loopTimeout = null;
    }

    if (this.process) {
      this.addLog('发送停止信号 (SIGTERM) 给爬虫进程...', 'warning', manager);
      this.process.kill('SIGTERM');

      // Wait for process to exit
      let checks = 0;
      while (this.process && checks < 10) {
        await new Promise((r) => setTimeout(r, 500));
        checks++;
      }

      // Force kill if still running
      if (this.process) {
        this.addLog('进程未响应，发送强制停止信号 (SIGKILL)...', 'warning', manager);
        this.process.kill('SIGKILL');
      }
    }

    this.status = 'idle';
  }
}

export class CrawlerManager extends EventEmitter {
  private tasks: Map<string, CrawlerTask> = new Map();
  private globalLogs: LogEntry[] = [];
  private windowCoordinator: CrawlerWindowCoordinator = {};

  public setWindowCoordinator(coordinator: CrawlerWindowCoordinator): void {
    this.windowCoordinator = coordinator;
  }
  
  public get status(): 'idle' | 'running' | 'stopping' {
    const states = Array.from(this.tasks.values()).map((t) => t.status);
    if (states.includes('running')) return 'running';
    if (states.includes('stopping')) return 'stopping';
    return 'idle';
  }

  public get logs(): LogEntry[] {
    return this.globalLogs;
  }

  public addGlobalLog(entry: LogEntry): void {
    this.globalLogs.push(entry);
    if (this.globalLogs.length > 1000) {
      this.globalLogs.shift();
    }
    this.emit('log', entry);
  }

  public parseLogLevel(line: string): LogEntry['level'] {
    const upper = line.toUpperCase();
    if (upper.includes('ERROR') || upper.includes('FAILED') || upper.includes('ERR')) {
      return 'error';
    }
    if (upper.includes('WARNING') || upper.includes('WARN')) {
      return 'warning';
    }
    if (upper.includes('SUCCESS') || line.includes('完成') || line.includes('成功')) {
      return 'success';
    }
    if (upper.includes('DEBUG')) {
      return 'debug';
    }
    return 'info';
  }

  public async start(config: CrawlerStartRequest): Promise<boolean> {
    const normalizedConfig = normalizeConnectorRequest(config);
    const platform = normalizedConfig.platform;
    const existing = this.tasks.get(platform);
    
    if (existing && (existing.status === 'running' || existing.status === 'stopping')) {
      return false;
    }

    if (this.windowCoordinator.prepareCrawlerWindow) {
      const prepared = await this.windowCoordinator.prepareCrawlerWindow(platform);
      if (!prepared) throw new Error(`无法创建平台 ${platform} 的专用采集窗口`);
    }

    const task = new CrawlerTask(platform, normalizedConfig);
    this.tasks.set(platform, task);
    
    // Spawn background worker process
    task.startProcess(this);
    return true;
  }

  public async stop(platform?: string): Promise<boolean> {
    if (platform) {
      const task = this.tasks.get(platform);
      if (!task) return false;
      await task.stop(this);
      return true;
    }

    // Stop all tasks
    const activeTasks = Array.from(this.tasks.values()).filter(
      (t) => t.status === 'running' || t.status === 'stopping'
    );
    if (activeTasks.length === 0) return false;

    await Promise.all(activeTasks.map((t) => t.stop(this)));
    return true;
  }

  public async skip(platform: string): Promise<boolean> {
    const task = this.tasks.get(platform);
    if (!task || !task.process) return false;
    this.addLog(`收到用户指令，跳过平台 ${platform} 的抓取任务`, 'warning', this);
    if (task.process.send) {
      task.process.send({ type: 'SKIP_CONNECTOR' });
    } else {
      await task.stop(this);
    }
    this.emit('skipped', { platform });
    return true;
  }

  public getStatus(platform?: string): any {

    if (platform) {
      const task = this.tasks.get(platform);
      if (task) {
        return {
          status: task.status,
          platform: task.platform,
          crawler_type: task.config.crawler_type,
          started_at: task.startedAt,
          error_message: null,
          run_id: task.currentRunId || task.lastRunId,
        };
      }
      return {
        status: 'idle',
        platform,
        crawler_type: null,
        started_at: null,
        error_message: null,
        run_id: null,
      };
    }

    // Bulk state
    const states: Record<string, any> = {};
    for (const [p, t] of this.tasks.entries()) {
      states[p] = {
        status: t.status,
        platform: t.platform,
        crawler_type: t.config.crawler_type,
        started_at: t.startedAt,
        error_message: null,
        run_id: t.currentRunId || t.lastRunId,
      };
    }

    return {
      status: this.status,
      platform_states: states,
    };
  }

  public getLogs(platform?: string, limit = 100): LogEntry[] {
    if (platform) {
      const task = this.tasks.get(platform);
      if (task?.logs.length) return task.logs.slice(-limit);
      return analyticsRepository.listRunLogs(platform, limit) as LogEntry[];
    }
    if (this.globalLogs.length) return this.globalLogs.slice(-limit);
    return analyticsRepository.listRunLogs(undefined, limit) as LogEntry[];
  }
}

export const crawlerManager = new CrawlerManager();
