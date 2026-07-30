import { chromium, type Response } from 'playwright';
import {
  parseBossDetailHtml,
  parseBossSearchPayload,
  type BossJobRecord,
} from '../src/crawler/platforms/bossParsing';

const SEARCH_RESPONSE_PATTERN = /\/wapi\/zpgeek\/search\/joblist(?:\.json)?(?:[?#]|$)/i;

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
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages.find((candidate) => {
    try {
      const hostname = new URL(candidate.url()).hostname;
      return hostname === 'zhipin.com' || hostname.endsWith('.zhipin.com');
    } catch {
      return false;
    }
  });

  if (!page) {
    throw new Error('CDP 已连接，但没有发现已打开的 zhipin.com 页面；请在独立测试 Profile 中手动打开获准页面后重试');
  }

  console.log(`[BOSS Probe] Attached to ${safePageUrl(page.url())}`);
  console.log(`[BOSS Probe] Observing for ${durationMs}ms. Please navigate or reload manually in the isolated Chrome window.`);
  console.log('[BOSS Probe] The probe does not navigate, click, read cookies, save HTML, or print response bodies.');

  const pending = new Set<Promise<void>>();
  const onResponse = (response: Response) => {
    if (!SEARCH_RESPONSE_PATTERN.test(response.url())) return;
    const task = (async () => {
      const payload = await response.json();
      const parsed = parseBossSearchPayload(payload);
      console.log(JSON.stringify({
        event: 'boss_search_shape',
        state: parsed.state,
        reason: parsed.reason,
        item_count: parsed.jobs.length,
        sample: parsed.jobs.slice(0, 3).map(jobSummary),
      }));
    })().catch((error: any) => {
      console.warn(`[BOSS Probe] Search response could not be parsed: ${error.message}`);
    });
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };

  page.on('response', onResponse);
  try {
    if (/\/job_detail\//i.test(page.url())) {
      const parsed = parseBossDetailHtml(await page.content(), page.url());
      console.log(JSON.stringify({
        event: 'boss_detail_shape',
        state: parsed.state,
        reason: parsed.reason,
        item: parsed.job ? jobSummary(parsed.job) : null,
      }));
    }
    await page.waitForTimeout(durationMs);
  } finally {
    page.off('response', onResponse);
    await Promise.allSettled(Array.from(pending));
  }

  console.log('[BOSS Probe] Observation completed. The Chrome process and isolated profile were left open.');
  process.exit(0);
}

main().catch((error) => {
  console.error(`[BOSS Probe] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
