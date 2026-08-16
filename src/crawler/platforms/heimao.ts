import { BrowserContext, Page } from 'playwright';
import {
  AbstractCrawler,
  connectToElectronChromium,
  getElectronCrawlerPage,
  notifyManualVerificationRequired,
  notifyManualVerificationSuccess,
} from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';
import { systemHttpClient } from '../base/SystemHttpClient';
import { reportKeywordSearchCompletion, searchPageBudget } from '../base/connectorHelpers';
import { MANUAL_VERIFICATION_TIMEOUT_MS } from '../base/interactiveTimeouts';

function extractUrlsOrIds(input: string): string[] {
  if (!input) return [];
  return input
    .split(/[\n,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export class HeimaoCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;

  public async start(): Promise<void> {
    console.log('[Heimao] Connecting Heimao crawler to Electron built-in browser engine...');
    const p = require('playwright');
    this.browserContext = await connectToElectronChromium(p);
    this.page = await getElectronCrawlerPage(this.browserContext, 'heimao');

    const crawlerType = activeConfig.CRAWLER_TYPE || 'search';
    if (crawlerType === 'detail') {
      await this.parseDetails();
    } else {
      await this.search();
    }
  }

  private async checkCaptchaOrLogin(): Promise<boolean> {
    if (!this.page) return false;
    const pageUrl = this.page.url();
    if (
      pageUrl.includes('passport.sina') ||
      pageUrl.includes('passport.weibo') ||
      pageUrl.includes('login.sina')
    ) {
      return true;
    }

    const pageTitle = await this.page.title().catch(() => '');
    if (
      pageTitle.includes('新浪通行证') ||
      pageTitle.includes('微博登录') ||
      pageTitle.includes('安全验证') ||
      pageTitle === '登录'
    ) {
      return true;
    }

    // Check for visible captcha or login modal elements in DOM
    const isBlockedInDom = await this.page.evaluate(() => {
      const isVisible = (el: Element | null) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };

      const captchaEl = document.querySelector('.sec-captcha, .geetest_holder, .geetest_popup, iframe[src*="passport.sina"], #passport_login_box');
      if (captchaEl && isVisible(captchaEl)) return true;

      const hasSearchContent = !!document.querySelector('a[href*="/complaint/view/"], .m-list, .ts-list, .search-list');
      if (hasSearchContent) return false;

      const bodyText = document.body ? document.body.innerText || '' : '';
      if (bodyText.includes('请先登录新浪账号') || bodyText.includes('请先登录微博') || bodyText.includes('请先进行安全验证')) {
        return true;
      }

      return false;
    }).catch(() => false);

    return isBlockedInDom;
  }

  private async handleLoginOrVerificationIfNeeded(keyword: string): Promise<void> {
    if (!this.page) return;
    if (await this.checkCaptchaOrLogin()) {
      console.warn(`[Heimao] Login or captcha verification detected in built-in browser window. Waiting up to ${MANUAL_VERIFICATION_TIMEOUT_MS / 1000}s for user completion...`);
      notifyManualVerificationRequired('heimao', `黑猫投诉搜索“${keyword}”需要新浪/微博登录或验证，请在内置浏览器窗口中完成操作。`);

      const startTime = Date.now();
      let clearPasses = 0;
      while (Date.now() - startTime < MANUAL_VERIFICATION_TIMEOUT_MS) {
        await this.page.waitForTimeout(2000);
        const stillBlocked = await this.checkCaptchaOrLogin();
        if (stillBlocked) {
          clearPasses = 0;
        } else {
          clearPasses++;
          if (clearPasses >= 2) {
            console.log('[Heimao] Manual login/verification completed! Resuming crawler...');
            notifyManualVerificationSuccess('heimao');
            const safeKw = encodeURIComponent(keyword);
            const searchUrl = `https://tousu.sina.com.cn/index/search/?keywords=${safeKw}&t=1`;
            if (!this.page.url().includes('/index/search/')) {
              await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
              await this.humanDelay(this.page, 3);
            }
            return;
          }
        }
      }
      console.warn('[Heimao] Login/verification timeout. Will attempt public API fallback...');
    }
  }

  public async search(): Promise<void> {
    if (!this.page) throw new Error('[Heimao] Browser page is not initialized.');

    const keywords = extractUrlsOrIds(activeConfig.KEYWORDS || '');
    if (keywords.length === 0) {
      console.warn('[Heimao] No search keywords specified.');
      return;
    }

    const maxItems = Number(activeConfig.CRAWLER_MAX_NOTES_COUNT || 20);
    console.log(`[Heimao] Starting complaint search for ${keywords.length} keyword(s) via built-in browser, limit ${maxItems} per keyword...`);

    for (const keyword of keywords) {
      console.log(`[Heimao] Searching for keyword: "${keyword}"...`);
      const safeKw = encodeURIComponent(keyword);
      const searchUrl = `https://tousu.sina.com.cn/index/search/?keywords=${safeKw}&t=1`;
      console.log(`[Heimao] Built-in browser navigating to search page: ${searchUrl}`);

      const collectedItems: any[] = [];
      const seenIds = new Set<string>();

      try {
        await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await this.humanDelay(this.page, 3);

        await this.handleLoginOrVerificationIfNeeded(keyword);

        let scrollAttempts = 0;
        const maxScrolls = searchPageBudget(maxItems, 5, 8, 100);

        while (collectedItems.length < maxItems && scrollAttempts < maxScrolls) {
          let rawItems: any[] = [];
          try {
            rawItems = await this.page.evaluate(() => {
              const items: any[] = [];
              const seen = new Set<string>();

              // Strategy 1: Find all complaint links directly
              const linkEls = Array.from(document.querySelectorAll('a[href*="/complaint/view/"]'));
              linkEls.forEach((linkEl: any) => {
                const href = linkEl.getAttribute('href') || '';
                const match = href.match(/\/complaint\/view\/(\d+)/);
                const contentId = match ? match[1] : href;
                if (!contentId || seen.has(contentId)) return;
                seen.add(contentId);

                const card = linkEl.closest('li, div[class*="item"], div[class*="card"], div[class*="box"], article, tr') || linkEl.parentElement || linkEl;

                // 1. Meta / Date text (.ts-name is author/time line like "2026-06-07 于黑猫投诉平台发起")
                const metaNameEl = card.querySelector('.ts-name, .s-name, [class*="name"]');
                const metaText = metaNameEl ? (metaNameEl.innerText || metaNameEl.textContent || '').trim() : '';

                let publishedAt = '';
                const dateMatch = metaText.match(/\d{4}-\d{2}-\d{2}/) || (card.innerText || '').match(/\d{4}-\d{2}-\d{2}/);
                if (dateMatch) {
                  publishedAt = dateMatch[0];
                }

                // 2. Real title: Filter candidate title elements (exclude .ts-name and date/origin strings)
                let title = '';
                const titleCandidates = Array.from(card.querySelectorAll('h1, h2, h3, h4, .ts-title, .ts-tit, a.title, a.tit, .title, [class*="title"], [class*="tit"]'));
                for (const cand of titleCandidates) {
                  if ((cand as HTMLElement).classList.contains('ts-name')) continue;
                  const txt = ((cand as HTMLElement).innerText || (cand as HTMLElement).textContent || '').trim();
                  if (txt && !txt.includes('于黑猫投诉平台发起') && !/^\d{4}-\d{2}-\d{2}/.test(txt) && txt.length > 2) {
                    title = txt;
                    break;
                  }
                }

                // Fallback scan links/text inside card if title is missing or invalid
                if (!title || title.includes('于黑猫投诉平台发起') || /^\d{4}-\d{2}-\d{2}/.test(title)) {
                  const cardLinks = Array.from(card.querySelectorAll('a[href*="/complaint/view/"], a'));
                  for (const l of cardLinks) {
                    const txt = ((l as HTMLElement).innerText || (l as HTMLElement).textContent || '').trim();
                    if (txt && !txt.includes('于黑猫投诉平台发起') && !/^\d{4}-\d{2}-\d{2}/.test(txt) && txt.length > 2) {
                      title = txt;
                      break;
                    }
                  }
                }

                if (!title) title = '黑猫投诉事项';

                const merchantEl = card.querySelector('.ts-target, .merchant, .shop, .target, .s-target, [class*="target"], [class*="merchant"]');
                const statusEl = card.querySelector('.ts-status, .status, .state, .tag, .s-status, [class*="status"]');
                const descEl = card.querySelector('.ts-desc, .desc, p, .summary, [class*="desc"]');

                let description = descEl ? (descEl.innerText || descEl.textContent || '').trim() : title;
                if (description === title) {
                  const pEls = Array.from(card.querySelectorAll('p, div'));
                  for (const p of pEls) {
                    const txt = ((p as HTMLElement).innerText || (p as HTMLElement).textContent || '').trim();
                    if (txt && txt !== title && !txt.includes('于黑猫投诉平台发起') && txt.length > 15) {
                      description = txt;
                      break;
                    }
                  }
                }

                items.push({
                  content_id: contentId,
                  title: title,
                  description: description,
                  creator_name: merchantEl ? (merchantEl.innerText || merchantEl.textContent || '').trim() : '黑猫涉诉商家',
                  status: statusEl ? (statusEl.innerText || statusEl.textContent || '').trim() : '',
                  content_url: href.startsWith('http') ? href : `https://tousu.sina.com.cn${href}`,
                  published_at: publishedAt,
                });
              });

              // Strategy 2: Find generic list containers if Strategy 1 found few items
              if (items.length === 0) {
                const nodes = Array.from(document.querySelectorAll('.ts-list .ts-item, .m-list .item, .search-list li, .ts-item, li[data-id], .ts-m-list li, .m-product-list li, .ts-card, div[class*="item"], div[class*="complaint"], div[class*="card"]'));
                nodes.forEach((node: any) => {
                  const linkEl = node.querySelector('a[href*="/complaint/view/"]') || node.querySelector('a');
                  const href = linkEl ? linkEl.getAttribute('href') || '' : '';
                  let contentId = '';
                  const match = href.match(/\/complaint\/view\/(\d+)/);
                  if (match) contentId = match[1];
                  else if (node.dataset && node.dataset.id) contentId = node.dataset.id;
                  else if (href) contentId = href;

                  if (!contentId || seen.has(contentId)) return;
                  seen.add(contentId);

                  const metaNameEl = node.querySelector('.ts-name, .s-name');
                  const metaText = metaNameEl ? (metaNameEl.innerText || metaNameEl.textContent || '').trim() : '';

                  let publishedAt = '';
                  const dateMatch = metaText.match(/\d{4}-\d{2}-\d{2}/) || (node.innerText || '').match(/\d{4}-\d{2}-\d{2}/);
                  if (dateMatch) publishedAt = dateMatch[0];

                  let title = '';
                  const titleCandidates = Array.from(node.querySelectorAll('h1, h2, h3, h4, .ts-title, .ts-tit, a.title, a.tit, .title, [class*="title"], [class*="tit"]'));
                  for (const cand of titleCandidates) {
                    if ((cand as HTMLElement).classList.contains('ts-name')) continue;
                    const txt = ((cand as HTMLElement).innerText || (cand as HTMLElement).textContent || '').trim();
                    if (txt && !txt.includes('于黑猫投诉平台发起') && !/^\d{4}-\d{2}-\d{2}/.test(txt) && txt.length > 2) {
                      title = txt;
                      break;
                    }
                  }

                  if (!title || title.includes('于黑猫投诉平台发起') || /^\d{4}-\d{2}-\d{2}/.test(title)) {
                    const cardLinks = Array.from(node.querySelectorAll('a[href*="/complaint/view/"], a'));
                    for (const l of cardLinks) {
                      const txt = ((l as HTMLElement).innerText || (l as HTMLElement).textContent || '').trim();
                      if (txt && !txt.includes('于黑猫投诉平台发起') && !/^\d{4}-\d{2}-\d{2}/.test(txt) && txt.length > 2) {
                        title = txt;
                        break;
                      }
                    }
                  }

                  if (!title) title = '黑猫投诉事项';

                  const merchantEl = node.querySelector('.ts-target, .merchant, .shop, .target, .s-target');
                  const statusEl = node.querySelector('.ts-status, .status, .state, .tag, .s-status');
                  const descEl = node.querySelector('.ts-desc, .desc, p, .summary');

                  items.push({
                    content_id: contentId || `heimao_${Math.random().toString(36).substring(2, 9)}`,
                    title: title,
                    description: (descEl ? descEl.innerText || descEl.textContent || '' : title).trim(),
                    creator_name: merchantEl ? (merchantEl.innerText || merchantEl.textContent || '').trim() : '黑猫涉诉商家',
                    status: statusEl ? (statusEl.innerText || statusEl.textContent || '').trim() : '',
                    content_url: href.startsWith('http') ? href : href ? `https://tousu.sina.com.cn${href}` : '',
                    published_at: publishedAt,
                  });
                });
              }

              return items;
            });
          } catch (evalErr: any) {
            console.warn(`[Heimao] DOM evaluation warning: ${evalErr.message}`);
          }

          for (const item of rawItems) {
            if (item.content_id && !seenIds.has(item.content_id)) {
              seenIds.add(item.content_id);
              collectedItems.push(item);
              if (collectedItems.length >= maxItems) break;
            }
          }

          if (collectedItems.length >= maxItems) break;

          scrollAttempts++;
          try {
            await this.page.evaluate(() => {
              window.scrollTo(0, document.body.scrollHeight);
            });
          } catch {}
          await this.humanDelay(this.page, 2);
        }
      } catch (err: any) {
        console.warn(`[Heimao] Browser search scan interrupted for "${keyword}": ${err.message}`);
      }

      // Fallback Strategy: If browser page search extracted fewer items than maxItems, query public company main_search & feed APIs
      if (collectedItems.length < maxItems) {
        console.log(`[Heimao] Browser search collected ${collectedItems.length}/${maxItems} items for "${keyword}". Triggering public API fallback...`);
        let page = 1;
        while (collectedItems.length < maxItems && page <= 5) {
          try {
            const fetchSize = Math.min(maxItems - collectedItems.length, 50);
            const mainSearchUrl = `https://tousu.sina.com.cn/api/company/main_search?keyword=${safeKw}&page=${page}&page_size=${fetchSize}`;
            const res = await systemHttpClient.get(mainSearchUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://tousu.sina.com.cn/',
                'X-Requested-With': 'XMLHttpRequest',
              },
              timeout: 10000,
            });

            if (res.data?.result?.status?.code === 0 && res.data?.result?.data?.lists) {
              const companies = res.data.result.data.lists;
              if (!companies || companies.length === 0) break;
              for (const co of companies) {
                const coId = co.uid || co.id || `co_${Math.random().toString(36).substring(2, 9)}`;
                if (seenIds.has(coId)) continue;
                seenIds.add(coId);

                collectedItems.push({
                  content_id: coId,
                  title: `[涉诉商家] ${co.title || co.name || keyword}`,
                  description: `黑猫投诉涉诉商家: ${co.title || co.name} (UID: ${coId})。关键词: ${keyword}`,
                  creator_name: co.title || co.name || '黑猫涉诉商家',
                  status: '涉诉主体',
                  content_url: `https://tousu.sina.com.cn/company/view/?couid=${coId}`,
                  published_at: '',
                });
                if (collectedItems.length >= maxItems) break;
              }
              page++;
            } else {
              break;
            }
          } catch (apiErr: any) {
            console.warn(`[Heimao] API fallback warning for "${keyword}": ${apiErr.message}`);
            break;
          }
        }

        let feedPage = 1;
        while (collectedItems.length < maxItems && feedPage <= 10) {
          try {
            const fetchSize = Math.min(maxItems - collectedItems.length, 50);
            const feedUrl = `https://tousu.sina.com.cn/api/index/feed?type=1&page=${feedPage}&page_size=${fetchSize}`;
            const resFeed = await systemHttpClient.get(feedUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://tousu.sina.com.cn/',
              },
              timeout: 10000,
            });

            if (resFeed.data?.result?.status?.code === 0 && resFeed.data?.result?.data?.lists) {
              const feedLists = resFeed.data.result.data.lists;
              if (!feedLists || feedLists.length === 0) break;
              for (const feedItem of feedLists) {
                const main = feedItem.main || feedItem;
                const cId = main.sn || main.id || `feed_${Math.random().toString(36).substring(2, 9)}`;
                if (seenIds.has(cId)) continue;
                seenIds.add(cId);

                collectedItems.push({
                  content_id: cId,
                  title: main.title || '黑猫投诉事项',
                  description: main.summary || main.title || '',
                  creator_name: main.cou_name || '黑猫涉诉商家',
                  status: main.status_name || '',
                  content_url: `https://tousu.sina.com.cn/complaint/view/${cId}`,
                  published_at: main.datetime || '',
                });
                if (collectedItems.length >= maxItems) break;
              }
              feedPage++;
            } else {
              break;
            }
          } catch (feedErr: any) {
            console.warn(`[Heimao] Feed fallback warning: ${feedErr.message}`);
            break;
          }
        }
      }

      // Emit all collected items through the connector output boundary.
      let totalCollected = 0;
      for (const item of collectedItems) {
        await connectorOutput.emitHeimaoResult({
          content_id: item.content_id,
          title: item.title,
          desc: `${item.creator_name ? `[投诉商家: ${item.creator_name}] ` : ''}${item.status ? `[状态: ${item.status}] ` : ''}${item.description}`,
          creator_name: item.creator_name || '黑猫涉诉商家',
          merchant_name: item.creator_name || '黑猫涉诉商家',
          status: item.status || '',
          rank: totalCollected + 1,
          content_url: item.content_url || `https://tousu.sina.com.cn/index/search/?keywords=${safeKw}`,
          source_keyword: keyword,
          published_at: item.published_at || '',
          publish_time: Date.now(),
        });
        totalCollected++;
      }

      reportKeywordSearchCompletion(
        '黑猫投诉',
        keyword,
        totalCollected,
        maxItems,
        totalCollected < maxItems ? '平台可用公开结果已提取完毕或需要验证登录' : undefined,
      );

      console.log(`[Heimao] Completed search for "${keyword}", stored ${totalCollected} complaint notes.`);
    }
  }

  public async parseDetails(): Promise<void> {
    if (!this.page) throw new Error('[Heimao] Browser page is not initialized.');

    const targets = extractUrlsOrIds(activeConfig.SPECIFIED_IDS || '');
    if (targets.length === 0) {
      console.warn('[Heimao] No specified complaint IDs or URLs provided for detail parsing.');
      return;
    }

    console.log(`[Heimao] Parsing detail for ${targets.length} complaint target(s)...`);

    for (const target of targets) {
      const url = target.startsWith('http')
        ? target
        : `https://tousu.sina.com.cn/complaint/view/${target}`;

      console.log(`[Heimao] Built-in browser navigating to complaint detail: ${url}`);
      try {
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.humanDelay(this.page, 3);

        await this.handleLoginOrVerificationIfNeeded(target);

        const detail = await this.page.evaluate(() => {
          const titleEl = document.querySelector('.ts-title, h1, .title');
          const descEl = document.querySelector('.ts-content, .ts-desc, .main-content, .detail-content, .ts-detail');
          const merchantEl = document.querySelector('.ts-target, .merchant-name, .shop-name, .ts-name');
          const statusEl = document.querySelector('.ts-status, .status-name, .state');
          const timeEl = document.querySelector('.ts-time, .pub-time, .date');

          // Extract progression timeline & merchant replies / consumer supplements / comments
          const timelineNodes = Array.from(document.querySelectorAll('.ts-step, .ts-step-item, .u-reply-item, .timeline-item, .m-timeline li, .m-progress li, .ts-progress li, ul.u-step-list li, .ts-detail-step, div[class*="step"], div[class*="timeline"], div[class*="reply"]'));
          const timeline: Array<{ role: string; time: string; content: string }> = [];

          timelineNodes.forEach((node: any, idx: number) => {
            const roleEl = node.querySelector('.ts-step-title, .role, .name, .title, strong, h4, h5, .step-name');
            const timeElNode = node.querySelector('.ts-step-time, .time, .date, .pub-time, span.time');
            const contentElNode = node.querySelector('.ts-step-content, .content, .desc, .text, p, .u-txt');

            const role = roleEl ? (roleEl.innerText || roleEl.textContent || '').trim() : `沟通节点 ${idx + 1}`;
            const timeStr = timeElNode ? (timeElNode.innerText || timeElNode.textContent || '').trim() : '';
            const contentStr = contentElNode ? (contentElNode.innerText || contentElNode.textContent || '').trim() : (node.innerText || '').trim();

            if (contentStr && contentStr !== role && !timeline.some(t => t.content === contentStr)) {
              timeline.push({
                role: role || '黑猫沟通节点',
                time: timeStr,
                content: contentStr,
              });
            }
          });

          return {
            title: titleEl ? (titleEl as HTMLElement).innerText.trim() : '黑猫投诉单',
            desc: descEl ? (descEl as HTMLElement).innerText.trim() : '',
            merchant: merchantEl ? (merchantEl as HTMLElement).innerText.trim() : '涉诉商家',
            status: statusEl ? ((statusEl as HTMLElement).innerText || statusEl.textContent || '').trim() : '',
            time: timeEl ? (timeEl as HTMLElement).innerText.trim() : '',
            timeline,
          };
        });

        const idMatch = url.match(/\/complaint\/view\/(\d+)/);
        const complaintId = idMatch ? idMatch[1] : target;

        let formattedTimeline = '';
        if (detail.timeline && detail.timeline.length > 0) {
          formattedTimeline = '\n\n【投诉进度与回复过程】:\n' + detail.timeline.map((item, idx) => `${idx + 1}. ${item.time ? `[${item.time}] ` : ''}${item.role}: ${item.content}`).join('\n');
        }

        // Emit complaint detail
        await connectorOutput.emitHeimaoResult({
          content_id: complaintId,
          title: detail.title,
          desc: `[被投诉方: ${detail.merchant}] ${detail.status ? `[状态: ${detail.status}] ` : ''}${detail.desc}${formattedTimeline}`,
          creator_name: detail.merchant || '黑猫涉诉商家',
          merchant_name: detail.merchant || '黑猫涉诉商家',
          status: detail.status || '',
          content_url: url,
          source_keyword: activeConfig.KEYWORDS || '',
          published_at: detail.time || '',
          publish_time: Date.now(),
        });

        // Emit individual comment / timeline reply items
        if (detail.timeline && detail.timeline.length > 0) {
          for (let i = 0; i < detail.timeline.length; i++) {
            const item = detail.timeline[i];
            await connectorOutput.emitHeimaoResult({
              comment_id: `${complaintId}_c_${i + 1}`,
              content_id: complaintId,
              title: `[${item.role}] 投诉沟通回复`,
              summary: item.content.slice(0, 100),
              content: item.content,
              description: item.content,
              creator_name: item.role,
              published_at: item.time,
              content_url: url,
              publish_time: Date.now(),
            });
          }
        }

        console.log(`[Heimao] Parsed detail successfully for complaint ID: ${complaintId}, extracted ${detail.timeline.length} reply/progress comments.`);

        console.log(`[Heimao] Parsed detail successfully for complaint ID: ${complaintId}`);
      } catch (err: any) {
        console.error(`[Heimao] Error parsing detail for "${target}": ${err.message}`);
      }
    }
  }
}
