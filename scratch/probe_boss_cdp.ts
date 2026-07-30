import { chromium, type BrowserContext, type Frame, type Page, type Response } from 'playwright';
import {
  parseBossDetailHtml,
  parseBossSearchPayload,
  type BossJobRecord,
} from '../src/crawler/platforms/bossParsing';

const SEARCH_RESPONSE_PATTERN = /\/wapi\/zpgeek\/search\/joblist(?:\.json)?(?:[?#]|$)/i;

function isBossUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return hostname === 'zhipin.com' || hostname.endsWith('.zhipin.com');
  } catch {
    return false;
  }
}

function safePageUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
}

function jobSummary(job: BossJobRecord) {
  return {
    content_id: job.content_id,
    title: job.title,
    company_name: job.company_name,
    salary: job.salary,
    work_city: job.work_city,
  };
}

async function main(): Promise<void> {
  if (!String(process.env.BOSS_AUTHORIZATION_REFERENCE || '').trim()) {
    throw new Error('拒绝启动探针：请通过 BOSS_AUTHORIZATION_REFERENCE 提供官方书面授权或测试批准的引用编号');
  }

  const cdpUrl = process.env.BOSS_CDP_URL || 'http://127.0.0.1:9222';
  const requestedDuration = Number(process.env.BOSS_PROBE_DURATION_MS || 60_000);
  const durationMs = Math.max(5_000, Math.min(180_000, requestedDuration));
  const browser = await chromium.connectOverCDP(cdpUrl);
  const contexts = browser.contexts();
  const pages = contexts.flatMap((context) => context.pages());
  const bossPages = pages.filter((candidate) => isBossUrl(candidate.url()));

  if (!bossPages.length) {
    throw new Error('CDP 已连接，但没有发现已打开的 zhipin.com 页面；请在独立测试 Profile 中手动打开获准页面后重试');
  }

  console.log(`[BOSS Probe] Attached to ${bossPages.map((page) => safePageUrl(page.url())).join(', ')}`);
  console.log(`[BOSS Probe] Observing for ${durationMs}ms. Please navigate or reload manually in the isolated Chrome window.`);
  console.log('[BOSS Probe] Passive mode: the probe never navigates, reloads, clicks, scrolls, opens tabs, reads cookies, saves HTML, or prints response bodies.');

  const pending = new Set<Promise<void>>();
  const watched = new Map<Page, {
    onResponse: (response: Response) => void;
    onFrameNavigated: (frame: Frame) => void;
    onClose: () => void;
  }>();
  const contextPageHandlers = new Map<BrowserContext, (page: Page) => void>();
  const inspectingDetails = new Set<string>();
  const lastDetailStates = new Map<string, string>();

  const queue = (operation: () => Promise<void>, label: string) => {
    const task = operation().catch((error: any) => {
      console.warn(`[BOSS Probe] ${label}: ${error.message}`);
    });
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };

  const inspectDetail = async (page: Page) => {
    if (page.isClosed()) return;
    const url = page.url();
    if (!isBossUrl(url) || !/\/job_detail\//i.test(url) || inspectingDetails.has(url)) return;
    inspectingDetails.add(url);
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(750);
      const parsed = parseBossDetailHtml(await page.content(), page.url());
      if (parsed.state === 'page_changed' && !parsed.job) return;
      const stateSignature = `${parsed.state}:${parsed.job ? 'job' : 'empty'}`;
      if (lastDetailStates.get(url) === stateSignature) return;
      lastDetailStates.set(url, stateSignature);
      console.log(JSON.stringify({
        event: 'boss_detail_shape',
        state: parsed.state,
        reason: parsed.reason,
        item: parsed.job ? jobSummary(parsed.job) : null,
      }));
    } finally {
      inspectingDetails.delete(url);
    }
  };

  const watchPage = (page: Page) => {
    if (watched.has(page)) return;
    const onResponse = (response: Response) => {
      if (!isBossUrl(response.url()) || !SEARCH_RESPONSE_PATTERN.test(response.url())) return;
      queue(async () => {
        const payload = await response.json();
        const parsed = parseBossSearchPayload(payload);
        console.log(JSON.stringify({
          event: 'boss_search_shape',
          state: parsed.state,
          reason: parsed.reason,
          item_count: parsed.jobs.length,
          sample: parsed.jobs.slice(0, 3).map(jobSummary),
        }));
      }, 'Search response could not be parsed');
    };
    const onFrameNavigated = (frame: Frame) => {
      if (frame === page.mainFrame()) queue(() => inspectDetail(page), 'Detail page could not be parsed');
    };
    const onClose = () => watched.delete(page);
    watched.set(page, { onResponse, onFrameNavigated, onClose });
    page.on('response', onResponse);
    page.on('framenavigated', onFrameNavigated);
    page.on('close', onClose);
    queue(() => inspectDetail(page), 'Detail page could not be parsed');
  };

  for (const page of bossPages) watchPage(page);
  for (const context of contexts) {
    const onPage = (page: Page) => {
      queue(async () => {
        await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
        watchPage(page);
      }, 'New page could not be attached');
    };
    contextPageHandlers.set(context, onPage);
    context.on('page', onPage);
  }

  try {
    await new Promise((resolve) => setTimeout(resolve, durationMs));
  } finally {
    for (const [page, handlers] of watched) {
      page.off('response', handlers.onResponse);
      page.off('framenavigated', handlers.onFrameNavigated);
      page.off('close', handlers.onClose);
    }
    for (const [context, handler] of contextPageHandlers) context.off('page', handler);
    await Promise.allSettled(Array.from(pending));
  }

  console.log('[BOSS Probe] Observation completed. The Chrome process and isolated profile were left open.');
  process.exit(0);
}

main().catch((error) => {
  console.error(`[BOSS Probe] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
